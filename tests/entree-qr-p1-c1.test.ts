// P1-C1 — Entrée QR → jeu : un seul champ obligatoire (téléphone OU e-mail) avec clavier adapté (inputmode +
// autocomplete), validation en direct, prénom optionnel partout et demandé APRÈS le tirage, « Continuer en tant que… »
// sans saisie, une seule case de consentement. La règle « 1 tirage / jour après visite validée » est revérifiée.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { attributsChamp, avecPrenom, etatSaisieContact, MESSAGE_CONTACT_INVALIDE, nomAffiche, virgulePrenom } from '../src/lib/inscriptionJeu.ts'
import { messageRelance, nouveauClient } from '../src/lib/fidelite.ts'
import { texteMessage } from '../src/lib/messages.ts'
import { nouveauCommerce } from '../src/data/defaults.ts'

const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const JOUR = 24 * 3600_000
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p1-c1-'))
after(() => rmSync(dossier, { recursive: true, force: true }))
const source = (f: string) => readFileSync(join(import.meta.dirname, '..', f), 'utf8')

/** Corps d'une fonction composant (de sa déclaration à la suivante) : pour vérifier ce qu'elle rend, pas tout le fichier. */
function corpsDe(code: string, nom: string): string {
  const debut = code.indexOf(`function ${nom}(`)
  assert.ok(debut >= 0, `function ${nom} introuvable`)
  const suite = code.slice(debut + 1).search(/\n(?:\/\*\*|\/\/|function |export function )/)
  return suite < 0 ? code.slice(debut) : code.slice(debut, debut + 1 + suite)
}

// ---------- Logique pure (src/lib/inscriptionJeu.ts) ----------

describe('Champ unique téléphone OU e-mail (logique pure)', () => {
  test('clavier : inputmode + autocomplete + type selon le choix', () => {
    assert.deepEqual(attributsChamp('tel'), { type: 'tel', inputMode: 'tel', autoComplete: 'tel', placeholder: '06 12 34 56 78' })
    assert.deepEqual(attributsChamp('email'), { type: 'email', inputMode: 'email', autoComplete: 'email', placeholder: 'marie@exemple.fr' })
  })

  test('validation en direct : vide, en cours, valide, faux ; erreur franche après une tentative d’envoi', () => {
    assert.deepEqual(etatSaisieContact(''), { niveau: 'vide', message: '' })
    assert.deepEqual(etatSaisieContact('   ', true), { niveau: 'erreur', message: MESSAGE_CONTACT_INVALIDE })
    assert.deepEqual(etatSaisieContact('06 12'), { niveau: 'encours', message: '4 chiffres sur 10' })
    assert.deepEqual(etatSaisieContact('0'), { niveau: 'encours', message: '1 chiffre sur 10' })
    assert.deepEqual(etatSaisieContact('06 12 34 56 78'), { niveau: 'ok', message: '✓ Numéro valide' })
    assert.deepEqual(etatSaisieContact('+33 6 12 34 56 78'), { niveau: 'ok', message: '✓ Numéro valide' })
    assert.equal(etatSaisieContact('06 12 34 56 78 90 12 34').niveau, 'erreur', 'trop de chiffres')
    assert.equal(etatSaisieContact('06/12').niveau, 'erreur', 'caractère interdit dans un numéro')
    assert.deepEqual(etatSaisieContact('marie@'), { niveau: 'encours', message: 'E-mail incomplet (ex. marie@exemple.fr).' })
    assert.equal(etatSaisieContact('marie').niveau, 'encours')
    assert.deepEqual(etatSaisieContact('Marie@Exemple.fr'), { niveau: 'ok', message: '✓ E-mail valide' })
    assert.equal(etatSaisieContact('ma rie@exemple.fr').niveau, 'erreur')
    assert.equal(etatSaisieContact('a@b@c.fr').niveau, 'erreur')
    // Après « C'est parti » avec une saisie incomplète : le message rouge habituel.
    assert.deepEqual(etatSaisieContact('06 12', true), { niveau: 'erreur', message: MESSAGE_CONTACT_INVALIDE })
    assert.equal(etatSaisieContact('06 12 34 56 78', true).niveau, 'ok')
  })

  test('phrases sans prénom : jamais « Bravo , » ni « Bonjour  ! »', () => {
    assert.equal(virgulePrenom('Marie'), ', Marie')
    assert.equal(virgulePrenom('  '), '')
    assert.equal(virgulePrenom(undefined), '')
    assert.equal(avecPrenom('Bravo', ' Marie '), 'Bravo Marie')
    assert.equal(avecPrenom('Bravo', ''), 'Bravo')
    assert.equal(nomAffiche(''), 'Client sans prénom')
    assert.equal(nomAffiche('Linh'), 'Linh')
  })

  test('messages automatiques et relance copiée : corrects sans prénom', () => {
    const commerce = nouveauCommerce('Chez Lin', 'restaurant', '')
    const sans = nouveauClient(commerce.id, '', { telephone: '0612345678' })
    const avec = nouveauClient(commerce.id, 'Linh', { telephone: '0612345678' })
    for (const type of ['bienvenue', 'presque', 'recompense', 'inactif', 'anniversaire', 'avis'] as const) {
      const t = texteMessage(type, sans, commerce)
      // « Bienvenue ! » est correct (espace avant « ! ») ; « Bienvenue  ! », « , cela fait » ou « Bravo , » ne le sont pas.
      assert.doesNotMatch(t, /^[\s,]|\s,|\s{2}/, `${type} : « ${t} »`)
      assert.match(t, /^[A-ZÀ-Ý]/, `${type} commence par une majuscule`)
      assert.match(texteMessage(type, avec, commerce), /Linh/)
    }
    assert.match(texteMessage('inactif', sans, commerce), /^Cela fait un moment/)
    assert.match(texteMessage('inactif', avec, commerce), /^Linh, cela fait un moment/)
    assert.match(messageRelance(sans, commerce), /^Bonjour, ça fait/)
    assert.match(messageRelance(avec, commerce), /^Bonjour Linh, ça fait/)
  })
})

// ---------- Écrans (tests de source, comme les lots précédents : node --test n'importe pas le .tsx) ----------

describe('Page de jeu et inscription en caisse (source)', () => {
  const jouer = source('src/pages/Jouer.tsx')
  const clients = source('src/pages/Clients.tsx')

  test('page de jeu : un seul champ obligatoire, inputmode + autocomplete tel / email, validation en direct', () => {
    const ident = corpsDe(jouer, 'Identification')
    assert.equal(ident.match(/<input\b/g)?.length, 2, 'le champ contact + la case de consentement, rien d’autre')
    assert.match(ident, /id="j-contact"/)
    assert.match(ident, /inputMode=\{attributs\.inputMode\}/)
    assert.match(ident, /autoComplete=\{attributs\.autoComplete\}/)
    assert.match(ident, /type=\{attributs\.type\}/)
    assert.match(ident, /attributsChamp\(mode\)/)
    assert.match(ident, /\(\['tel', 'email'\] as const\)/, 'choix Téléphone / E-mail')
    assert.match(ident, /aria-pressed=\{mode === m\}/)
    assert.match(ident, /noValidate/, 'le champ e-mail accepte aussi un numéro : pas de validation native')
    // Validation sous le champ dès la frappe (aria-live), plus seulement après l'envoi.
    assert.match(ident, /etatSaisieContact\(contactSaisi, essaye\)/)
    assert.match(ident, /id="j-contact-aide"[\s\S]*aria-live="polite"/)
    assert.match(ident, /aria-describedby="j-contact-aide"/)
  })

  test('page de jeu : prénom NI demandé NI envoyé avant le tirage, demandé après (optionnel)', () => {
    const ident = corpsDe(jouer, 'Identification')
    assert.doesNotMatch(ident, /prenom|Prénom|given-name/, 'aucun prénom dans le formulaire d’entrée')
    assert.match(ident, /onEnvoyer\(contactSaisi: string, consentementRelance: boolean\)/)
    // Le tirage serveur reçoit toujours le prénom connu (vide) : pas de changement de la route de tirage.
    assert.match(jouer, /lancerTirage\(api, commerce, joueur\.contact, joueur\.prenom\)/)
    // Demande du prénom : seulement dans le bloc affiché après le résultat (ou « déjà joué »), dans les deux modes.
    assert.equal(jouer.match(/<DemandePrenom\b/g)?.length, 2)
    assert.match(jouer, /\(etape === 'resultat' \|\| dejaJoue\) && \(\s*<>[\s\S]{0,120}<DemandePrenom prenom=\{joueur\.prenom\}/)
    assert.match(jouer, /\(etape === 'resultat' \|\| jeu\?\.statut === 'dejaJoue'\) && \(\s*<>[\s\S]{0,120}<DemandePrenom\s+prenom=\{joueur\.prenom\}/)
    assert.match(jouer, /api\.prenomCarte\(commerce\.id, joueur\.clientId, joueur\.contact, p\)/)
    assert.match(jouer, /nommerClient\(joueur\.id, p\)/)
    const demande = corpsDe(jouer, 'DemandePrenom')
    assert.match(demande, /\(optionnel\)/)
    assert.match(demande, /autoComplete="given-name"/)
    assert.match(demande, /if \(prenom\.trim\(\)\)/, 'rien à demander si la carte a déjà un prénom')
  })

  test('« Continuer en tant que… » : zéro saisie, avec ou sans prénom', () => {
    const continuer = corpsDe(jouer, 'Continuer')
    assert.doesNotMatch(continuer, /<input/)
    assert.match(continuer, /`Continuer en tant que \$\{p\}`/)
    assert.match(continuer, /'Continuer avec ma carte'/)
    // Les deux modes : le profil mémorisé est repris tel quel (aucun formulaire), « Ce n'est pas moi » l'oublie.
    assert.match(jouer, /<Continuer prenom=\{memorise\.prenom\} onContinuer=\{\(\) => choisirJoueur\(memorise\)\} onOublier=\{\(\) => \(memoriserJoueur\(commerce\.id, null\), setMemoriseId\(null\)\)\} \/>/)
    assert.match(jouer, /<Continuer prenom=\{memorise\.prenom\} onContinuer=\{\(\) => choisirJoueur\(memorise\)\} onOublier=\{\(\) => \(memoire\.memoriser\(null\), setMemorise\(null\)\)\} \/>/)
  })

  test('une seule case de consentement (pas de doublon), jamais pré-cochée', () => {
    for (const [f, s] of [['Jouer', jouer], ['Clients', clients]] as const) {
      assert.equal(s.match(/type="checkbox"/g)?.length, 1, `${f} : une seule case`)
      assert.equal(s.match(/désinscription à tout moment/g)?.length, 1, `${f} : une seule mention`)
      assert.doesNotMatch(s, /defaultChecked|useState\(true\)/)
    }
  })

  test('phrases du jeu sans prénom', () => {
    assert.doesNotMatch(jouer, /Bravo \$\{prenom\}|, \$\{joueur\.prenom\} !|Bonjour \{prenom\}|aujourd’hui, \{prenom\}/)
    assert.match(jouer, /`🎡 Tourner la roue\$\{virgulePrenom\(joueur\.prenom\)\} !`/)
  })

  test('inscription en caisse : prénom optionnel, contact obligatoire, pas d’autocomplétion avec les données de l’appareil', () => {
    const form = corpsDe(clients, 'FormulaireInscription')
    assert.match(form, /const valide = contact !== null/)
    assert.doesNotMatch(form, /prenom\.trim\(\)\.length > 0|!prenom\.trim\(\) \|\|/)
    assert.match(form, /Prénom \(optionnel\)/)
    assert.match(form, /disabled=\{!contactSaisi\.trim\(\) \|\| enCours\}/)
    assert.match(form, /id="ins-contact"[\s\S]*?autoComplete="off"/)
    assert.match(form, /etatSaisieContact\(contactSaisi, essaye\)/)
    // Noms affichés côté commerçant : jamais vides.
    for (const f of ['src/pages/Clients.tsx', 'src/pages/Caisse.tsx', 'src/pages/FicheClient.tsx']) assert.match(source(f), /nomAffiche\(/, f)
  })
})

// ---------- Serveur ----------

async function demarrer(nom: string) {
  const horloge = { t: new Date('2023-01-10T12:00:00Z') }
  const app = await creerServeur({
    fichierDb: join(dossier, nom),
    adminPin: '98765432',
    pinInitial: '1234',
    version: 'test',
    maintenant: () => horloge.t,
    limitesPubliques: { inscriptionParIp: 1000, inscriptionParContact: 1000, ficheClientParIp: 1000, lectureParIp: 1000, lectureParCarte: 1000, tirageParIp: 1000, tirageParContact: 1000 },
  })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(`${racine}/api/v1${chemin}`, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    return { statut: r.status, contenu: (await r.json()) as Record<string, any> }
  }
  return { app, api, horloge }
}

describe('Serveur : prénom optionnel partout, demandé après le tirage, règle du jeu inchangée', async () => {
  const s = await demarrer('p1-c1.db')
  after(() => s.app.fermer())
  const prenomDe = async (id: string) =>
    ((await s.api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.clients as { id: string; prenom: string }[]).find((c) => c.id === id)?.prenom

  test('inscription sans prénom : depuis le QR (public) ET par le commerçant (PIN)', async () => {
    const pub = await s.api('POST', `/commerces/${AH}/clients`, { prenom: '', contact: '06 10 00 00 01' })
    assert.equal(pub.statut, 201, JSON.stringify(pub.contenu))
    assert.equal(pub.contenu.client.prenom, '')
    assert.equal(pub.contenu.client.telephone, undefined, 'jamais de contact dans la réponse publique')
    const sansChamp = await s.api('POST', `/commerces/${AH}/clients`, { contact: 'sans.prenom@exemple.fr' })
    assert.equal(sansChamp.statut, 201)
    const commercant = await s.api('POST', `/commerces/${AH}/clients`, { prenom: '', contact: '06 10 00 00 02' }, PIN)
    assert.equal(commercant.statut, 201, JSON.stringify(commercant.contenu))
    assert.equal(commercant.contenu.client.prenom, '')
    assert.equal(commercant.contenu.client.telephone, '06 10 00 00 02')
    // Contact toujours obligatoire, des deux côtés.
    assert.equal((await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Marie' })).statut, 400)
    assert.equal((await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Marie', contact: '06 12' }, PIN)).statut, 400)
  })

  test('tirage : sans visite → 409 ; après visite validée → 1 tirage, le 2e du jour → 409 ; prénom ensuite', async () => {
    const contact = '06 10 00 00 03'
    const { client } = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: '', contact })).contenu
    const sansVisite = await s.api('POST', `/commerces/${AH}/tirages`, { contact })
    assert.equal(sansVisite.statut, 409)
    assert.match(sansVisite.contenu.erreur ?? JSON.stringify(sansVisite.contenu), /valider votre visite/)
    assert.equal((await s.api('POST', `/commerces/${AH}/clients/${client.id}/visite`, undefined, PIN)).statut, 200)
    const premier = await s.api('POST', `/commerces/${AH}/tirages`, { contact })
    assert.equal(premier.statut, 201, JSON.stringify(premier.contenu))
    assert.equal((await s.api('POST', `/commerces/${AH}/tirages`, { contact })).statut, 409, '1 tirage par jour')

    // Prénom APRÈS le tirage : preuve par le contact, une seule fois.
    const chemin = `/commerces/${AH}/clients/${client.id}/prenom`
    assert.equal((await s.api('POST', chemin, { prenom: 'Linh', contact: '06 99 99 99 99' })).statut, 403, 'mauvais contact')
    assert.equal((await s.api('POST', chemin, { prenom: 'Linh' })).statut, 403, 'sans contact')
    assert.equal((await s.api('POST', chemin, { prenom: '  ', contact })).statut, 400, 'prénom vide')
    assert.equal((await s.api('POST', chemin, { prenom: 'x'.repeat(41), contact })).statut, 400, 'trop long')
    assert.equal(await prenomDe(client.id), '', 'rien n’a changé')
    const ok = await s.api('POST', chemin, { prenom: ' Linh ', contact: '+33 6 10 00 00 03' })
    assert.equal(ok.statut, 200, JSON.stringify(ok.contenu))
    assert.equal(ok.contenu.client.prenom, 'Linh')
    assert.equal(ok.contenu.client.telephone, undefined)
    assert.equal(await prenomDe(client.id), 'Linh')
    // Déjà un prénom : personne ne peut le remplacer par cette route.
    assert.equal((await s.api('POST', chemin, { prenom: 'Autre', contact })).statut, 409)
    assert.equal(await prenomDe(client.id), 'Linh')
    // Carte inconnue → 404 ; le jeu du jour reste « déjà joué » (le prénom ne rouvre pas la roue).
    assert.equal((await s.api('POST', `/commerces/${AH}/clients/cl-inconnu/prenom`, { prenom: 'Linh', contact })).statut, 404)
    assert.equal((await s.api('GET', `/cartes/${client.id}`)).contenu.jeu.statut, 'dejaJoue')
    assert.equal((await s.api('POST', `/commerces/${AH}/tirages`, { contact })).statut, 409)
    // Le lendemain, sans nouvelle visite : pas de jeu.
    s.horloge.t = new Date(s.horloge.t.getTime() + JOUR)
    assert.equal((await s.api('POST', `/commerces/${AH}/tirages`, { contact })).statut, 409)
  })

  test('client inscrit avec un prénom : la route ne le modifie pas', async () => {
    const contact = 'marie@exemple.fr'
    const { client } = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Marie', contact })).contenu
    assert.equal((await s.api('POST', `/commerces/${AH}/clients/${client.id}/prenom`, { prenom: 'Pirate', contact })).statut, 409)
    assert.equal(await prenomDe(client.id), 'Marie')
  })
})

// P1-C6 — Écrans commerçant : caisse (code du jour + mode dégradé hors ligne, repli « Saisir le prénom », modale de
// confirmation au lieu de window.confirm, aide « encore X tampons »), pagination des clients, réaffichage unique d'un
// code équipe (PIN gérant, journalisé), Messages (copie en 1 tap, « rien n'est envoyé »), Avis (Google replié une fois
// lu), Réglages (grilles à 3 colonnes empilées sur mobile).
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { creerCodesDuJour, MAX_CODES_DU_JOUR, MESSAGE_MODE_DEGRADE } from '../src/lib/codeDuJour.ts'
import {
  aideTampons,
  cleGoogleLu,
  googleDejaLu,
  marquerGoogleLu,
  pageClients,
  recapitulatif,
  TAILLE_PAGE_CLIENTS,
  texteEtContacts,
} from '../src/lib/ecransCommercant.ts'

const AH = 'c-asian-home-paris'
const SECRET = 'secret-de-session-de-test-assez-long-0123456789'
const RACINE = join(import.meta.dirname, '..')
const source = (f: string) => readFileSync(join(RACINE, f), 'utf8')

class StockageMemoire {
  m = new Map<string, string>()
  getItem(k: string) {
    return this.m.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.m.set(k, v)
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
}

// ---------- Caisse : code du jour (mode dégradé) ----------

describe('Caisse : « code déjà vu » (empreinte du jour)', () => {
  const matin = new Date('2026-11-10T08:00:00Z')
  const soir = new Date('2026-11-10T22:30:00Z') // 23h30 à Paris : même journée
  const lendemain = new Date('2026-11-10T23:30:00Z') // 00h30 à Paris le 11

  test('reconnu le jour même après vérification en ligne, pas le lendemain ; un autre code n’est pas reconnu', async () => {
    const s = new StockageMemoire()
    const codes = creerCodesDuJour(s, 'cle')
    assert.equal(await codes.dejaVu('1234', matin), false, 'rien avant une vérification en ligne')
    await codes.memoriser('1234', matin)
    assert.equal(await codes.dejaVu('1234', soir), true)
    assert.equal(await codes.dejaVu('4321', soir), false)
    assert.equal(await codes.dejaVu('1234', lendemain), false, 'expire à minuit, heure de Paris')
    assert.equal(s.getItem('cle'), null, 'la mémoire d’un autre jour est effacée')
  })

  test('jamais de code en clair dans le stockage ; sel différent à chaque code ; plusieurs membres', async () => {
    const s = new StockageMemoire()
    const codes = creerCodesDuJour(s, 'cle')
    await codes.memoriser('1234', matin)
    await codes.memoriser('5678', matin)
    await codes.memoriser('1234', matin) // déjà là : pas de doublon
    const brut = s.getItem('cle')!
    assert.doesNotMatch(brut, /1234|5678/)
    const m = JSON.parse(brut) as { empreintes: { sel: string; h: string }[] }
    assert.equal(m.empreintes.length, 2)
    assert.notEqual(m.empreintes[0].sel, m.empreintes[1].sel)
    assert.equal(await codes.dejaVu('5678', soir), true)
    assert.ok(MAX_CODES_DU_JOUR >= 10)
  })

  test('oublier() (code refusé par le serveur) supprime tout mode dégradé ; formats invalides ignorés', async () => {
    const s = new StockageMemoire()
    const codes = creerCodesDuJour(s, 'cle')
    await codes.memoriser('1234', matin)
    codes.oublier()
    assert.equal(await codes.dejaVu('1234', matin), false)
    await codes.memoriser('12a4', matin)
    assert.equal(s.getItem('cle'), null)
    s.setItem('cle', '{abîmé')
    assert.equal(await codes.dejaVu('1234', matin), false)
    assert.equal(s.getItem('cle'), null)
  })

  test('sans stockage ou sans WebCrypto : aucun mode dégradé (jamais d’accès sans vérification)', async () => {
    assert.equal(creerCodesDuJour(null, 'cle').disponible, false)
    const sansCrypto = creerCodesDuJour(new StockageMemoire(), 'cle', null)
    await sansCrypto.memoriser('1234', matin)
    assert.equal(await sansCrypto.dejaVu('1234', matin), false)
  })

  test('Caisse.tsx : dégradé seulement hors ligne, marqué, revérifié au retour ; mémorisé seulement après le serveur', () => {
    const c = source('src/pages/Caisse.tsx')
    const dev = c.slice(c.indexOf('async function deverrouiller('), c.indexOf('async function verrouiller('))
    // Mémorisé après la réponse du serveur (api.caisse), jamais avant.
    assert.ok(dev.indexOf('await api.caisse(commerceId, a)') < dev.indexOf('codesDuJour.memoriser(saisi)'))
    // Consulté seulement si le serveur est injoignable.
    assert.match(dev, /if \(horsLigne && donnees && \(await codesDuJour\.dejaVu\(saisi\)\)\)/)
    assert.match(dev, /degradeRef\.current = true/)
    // Accès dégradé = code envoyé au serveur avec chaque action (X-Equipe-Code), donc revérifié.
    assert.match(dev, /const a: AccesCaisse = \{ code: saisi \}/)
    // Au retour du réseau : revérification d'abord ; 401 → oubli des empreintes.
    const sync = c.slice(c.indexOf('const synchroniser = useCallback('), c.indexOf('// Démarrage'))
    assert.ok(sync.indexOf('await charger()') < sync.indexOf('file.synchroniser(envoyer)'))
    assert.match(c, /if \('code' in a\) codesDuJour\.oublier\(\)/)
    // Marquage explicite.
    assert.match(c, /\{degrade && \([\s\S]*?\{MESSAGE_MODE_DEGRADE\}/)
    assert.match(MESSAGE_MODE_DEGRADE, /Mode dégradé/)
    assert.match(MESSAGE_MODE_DEGRADE, /vérifiées au retour du réseau/)
  })

  test('file hors ligne inchangée : identifiant d’action conservé (pas de double comptage), code gagnant jamais en file', () => {
    const c = source('src/pages/Caisse.tsx')
    assert.match(c, /actionId: a\.id/)
    assert.match(c, /Code gagnant de la roue : toujours en ligne \(jamais mis en file/)
  })
})

// ---------- Caisse : scanner, modale, aide tampons ----------

describe('Caisse : repli « Saisir le prénom », modale, aide tampons', () => {
  test('caméra refusée / indisponible : bouton « Saisir le prénom » DANS le panneau du scanner', () => {
    const s = source('src/components/ScannerQr.tsx')
    const bloc = s.slice(s.indexOf('{erreur ? ('))
    assert.match(bloc.slice(0, bloc.indexOf(') : (')), /onSaisieManuelle[\s\S]*Saisir le prénom/)
    assert.match(source('src/pages/Caisse.tsx'), /<ScannerQr [^\n]*onSaisieManuelle=\{/)
  })

  test('plus aucun window.confirm sur les parcours caisse (échange de points, récompenses)', () => {
    const c = source('src/pages/Caisse.tsx')
    assert.doesNotMatch(c, /window\.confirm|\bconfirm\(/)
    for (const d of [/setDemande\(\{ type: 'echange', recompense: r \}\)/, /setDemande\(\{ type: 'recompense' \}\)/, /setDemande\(\{ type: 'attente', attente: r \}\)/, /setDemande\(\{ type: 'reserve' \}\)/])
      assert.match(c, d)
    assert.match(c, /<Confirmation recap=\{recapitulatif\(demande, choisi, commerce\)\}/)
    const m = source('src/components/Confirmation.tsx')
    assert.match(m, /<dialog/)
    assert.match(m, /showModal/)
    assert.match(m, /onCancel=/)
  })

  test('récapitulatif de la modale : échange (coût, solde avant → après), récompense, en attente, réserve', () => {
    const client = { prenom: 'Lætitia', tampons: 11, points: 180 }
    const commerce = { seuilTampons: 10, recompense: 'Un plat offert' }
    const e = recapitulatif({ type: 'echange', recompense: { id: 'r1', nom: 'Dessert', cout: 120 } }, client, commerce)
    assert.equal(e.titre, 'Échanger des points ?')
    assert.deepEqual(Object.fromEntries(e.lignes), { Client: 'Lætitia', Récompense: 'Dessert', Coût: '120 points', Solde: '180 → 60 points' })
    assert.equal(e.confirmer, 'Échanger 120 points')
    const r = recapitulatif({ type: 'recompense' }, client, commerce)
    assert.deepEqual(Object.fromEntries(r.lignes), { Client: 'Lætitia', Récompense: 'Un plat offert', Tampons: '11 → 1' })
    assert.equal(recapitulatif({ type: 'attente', attente: { id: 'a', libelle: 'Boisson offerte' } }, client, commerce).lignes[1][1], 'Boisson offerte')
    assert.match(recapitulatif({ type: 'reserve' }, client, commerce).titre, /plat en réserve/)
    assert.equal(recapitulatif({ type: 'reserve' }, { ...client, prenom: '' }, commerce).lignes[0][1], 'Client sans prénom')
  })

  test('aide « encore X tampon(s) » : pluriel, débloquée au seuil, au-dessus du bouton désactivé', () => {
    const commerce = { seuilTampons: 10, recompense: 'Un plat offert' }
    assert.deepEqual(aideTampons({ tampons: 7 }, commerce), { debloquee: false, manque: 3, texte: 'Encore 3 tampons avant « Un plat offert » (7/10).' })
    assert.equal(aideTampons({ tampons: 9 }, commerce).texte, 'Encore 1 tampon avant « Un plat offert » (9/10).')
    assert.equal(aideTampons({ tampons: 10 }, commerce).debloquee, true)
    assert.equal(aideTampons({ tampons: 13 }, commerce).manque, 0)
    const c = source('src/pages/Caisse.tsx')
    const i = c.indexOf('const aide = aideTampons(choisi, commerce)')
    assert.ok(i > 0)
    const bloc = c.slice(i, c.indexOf('🎁 Valider une récompense', i))
    assert.match(bloc, /data-aide-tampons/, 'aide affichée avant le bouton')
    assert.match(bloc, /disabled=\{enCours \|\| !aide\.debloquee\}/)
    assert.match(bloc, /aria-describedby="caisse-aide-tampons"/)
  })
})

// ---------- Clients : pagination ----------

describe('Clients : « Charger plus » au-delà de 50', () => {
  const liste = Array.from({ length: 123 }, (_, i) => i)

  test('50 d’abord, puis par 50, jusqu’au bout', () => {
    assert.equal(TAILLE_PAGE_CLIENTS, 50)
    let p = pageClients(liste, TAILLE_PAGE_CLIENTS)
    assert.equal(p.visibles.length, 50)
    assert.equal(p.restants, 73)
    assert.equal(p.prochain, 50)
    p = pageClients(liste, p.visibles.length + p.prochain)
    assert.equal(p.visibles.length, 100)
    assert.equal(p.prochain, 23)
    p = pageClients(liste, p.visibles.length + p.prochain)
    assert.equal(p.visibles.length, 123)
    assert.equal(p.restants, 0)
    assert.deepEqual(pageClients(liste.slice(0, 12), 50), { visibles: liste.slice(0, 12), restants: 0, prochain: 0 })
  })

  test('Clients.tsx : seule la page est rendue, bouton « Charger plus », remise à 50 sur recherche / filtre', () => {
    const s = source('src/pages/Clients.tsx')
    assert.match(s, /page\.visibles\.map\(/)
    assert.doesNotMatch(s, /\{liste\.map\(/)
    assert.match(s, /page\.restants > 0 &&/)
    assert.match(s, /Charger \{page\.prochain\} de plus/)
    assert.match(s, /useEffect\(\(\) => setNbAffiches\(TAILLE_PAGE_CLIENTS\), \[recherche, filtre\]\)/)
    assert.doesNotMatch(s, /useState\(true\)|defaultChecked/)
  })
})

// ---------- Équipe : réaffichage unique (serveur réel) ----------

describe('Équipe : « Réafficher le code une fois » (PIN gérant requis)', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p1-c6-'))
  after(() => rmSync(dossier, { recursive: true, force: true }))

  test('route : 401 sans PIN, avec une session seule ou un PIN faux ; 200 avec le PIN, journalisé, aucun code renvoyé', async (t) => {
    const app = await creerServeur({ fichierDb: join(dossier, 'c6.db'), adminPin: '987654', pinInitial: '1234', version: 'test', secretSession: SECRET })
    t.after(() => app.fermer())
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
    const api = async (m: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) => {
      const r = await fetch(`${racine}${chemin}`, { method: m, headers: { 'Content-Type': 'application/json', ...entetes }, body: corps === undefined ? undefined : JSON.stringify(corps) })
      return { statut: r.status, texte: await r.text() }
    }
    const PIN = { 'X-Commerce-PIN': '1234' }
    const ajout = await api('POST', `/commerces/${AH}/equipe`, { nom: 'Mei', code: '4826' }, PIN)
    assert.equal(ajout.statut, 201)
    assert.doesNotMatch(ajout.texte, /4826/)
    const id = (JSON.parse(ajout.texte) as { membre: { id: string } }).membre.id
    const chemin = `/commerces/${AH}/equipe/${id}/reaffichage`

    assert.equal((await api('POST', chemin)).statut, 401, 'sans rien')
    const session = JSON.parse((await api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '1234' })).texte) as { jeton: string }
    assert.equal((await api('POST', chemin, undefined, { 'X-Session': session.jeton })).statut, 401, 'une session gérant ne suffit pas')
    assert.equal((await api('POST', chemin, undefined, { 'X-Session': session.jeton, 'X-Commerce-PIN': '0000' })).statut, 401, 'PIN faux, même avec une session')
    assert.equal((await api('POST', `/commerces/${AH}/equipe/mb-inconnu/reaffichage`, undefined, PIN)).statut, 404)
    const ok = await api('POST', chemin, undefined, PIN)
    assert.equal(ok.statut, 200)
    assert.doesNotMatch(ok.texte, /4826/, 'le serveur ne renvoie jamais le code')

    const etat = JSON.parse((await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).texte) as { journal: { action: string; details: string }[] }
    const ligne = etat.journal.find((j) => /réaffiché/.test(j.details))
    assert.ok(ligne, 'réaffichage journalisé')
    assert.equal(ligne.action, 'equipe')
    assert.match(ligne.details, /Code de Mei réaffiché une fois \(PIN gérant\)/)
    assert.doesNotMatch(JSON.stringify(etat.journal), /4826/)
  })

  test('Equipe.tsx : PIN gérant saisi et envoyé tel quel, code montré une fois puis oublié', () => {
    const s = source('src/pages/Equipe.tsx')
    assert.match(s, /Réafficher le code une fois/)
    assert.match(s, /PIN gérant \(requis pour réafficher le code\)/)
    assert.match(s, /api\.journaliserReaffichage\(membre\.commerceId, pin, membre\.id\)/)
    const f = s.slice(s.indexOf('async function reafficher('))
    // Affiché seulement si le serveur a accepté le PIN ; effacé de la mémoire aussitôt.
    assert.ok(f.indexOf('if (!r.ok) return') < f.indexOf('setAffiche(codeRecent)'))
    assert.ok(f.indexOf('setAffiche(codeRecent)') < f.indexOf('onConsomme()'))
    const a = source('src/data/api.ts')
    assert.match(a, /journaliserReaffichage: [\s\S]*?acces: \{ role: 'commerce', commerceId, pin: pinGerant \}/)
  })
})

// ---------- Messages, Avis, Réglages ----------

describe('Messages : texte + contacts en 1 tap, rien n’est envoyé', () => {
  test('texteEtContacts : texte puis destinataires, contacts vides retirés', () => {
    assert.equal(texteEtContacts(' Bonjour ! ', ['06 12 34 56 78', '', 'a@b.fr']), 'Bonjour !\n\n— Destinataires (2) :\n06 12 34 56 78, a@b.fr')
  })

  test('Messages.tsx : un seul bouton de copie, mention « rien n’est envoyé » sans clés', () => {
    const s = source('src/pages/Messages.tsx')
    assert.match(s, /<BoutonCopier texte=\{texteEtContacts\(texte, contacts\)\}/)
    assert.doesNotMatch(s, /libelle="Copier le texte"/)
    assert.doesNotMatch(s, /Copier les \$\{cibles\.length\} contact/)
    assert.match(s, /Rien n’est envoyé par SMS ni par e-mail[\s\S]*?clés des prestataires/)
  })
})

describe('Avis : « Connecter Google » replié une fois lu', () => {
  test('état persistant par commerce (localStorage), stockage bloqué toléré', () => {
    const s = new StockageMemoire()
    assert.equal(googleDejaLu(s, AH), false)
    marquerGoogleLu(s, AH)
    assert.equal(googleDejaLu(s, AH), true)
    assert.equal(googleDejaLu(s, 'autre'), false)
    assert.equal(s.getItem(cleGoogleLu(AH)), '1')
    const bloque = {
      getItem: () => {
        throw new Error('bloqué')
      },
      setItem: () => {
        throw new Error('bloqué')
      },
    }
    assert.equal(googleDejaLu(bloque, AH), false)
    marquerGoogleLu(bloque, AH)
    assert.equal(googleDejaLu(null, AH), false)
  })

  test('Avis.tsx : ouvert seulement si non lu ; refermer ou « J’ai lu » mémorise', () => {
    const s = source('src/pages/Avis.tsx')
    assert.match(s, /<details className="carte mb-4" open=\{branche && !lu\} onToggle=/)
    assert.match(s, /useState\(\(\) => googleDejaLu\(stockageLocal\(\), commerce\.id\)\)/)
    assert.match(s, /J’ai lu — replier/)
  })
})

describe('Réglages : grilles à 3 colonnes empilées à 375 px', () => {
  test('aucune grille grid-cols-3 sans repli mobile dans Réglages', () => {
    const s = source('src/pages/Reglages.tsx')
    assert.doesNotMatch(s, /className="grid grid-cols-3/)
    assert.equal(s.match(/grid grid-cols-1 gap-3 sm:grid-cols-3/g)?.length, 3)
    for (const l of s.split('\n').filter((x) => /grid-cols-3/.test(x))) assert.match(l, /sm:grid-cols-3/, l.trim())
  })

  test('aucun window.confirm ajouté par ce lot dans les nouveaux fichiers', () => {
    for (const f of ['src/components/Confirmation.tsx', 'src/lib/ecransCommercant.ts', 'src/lib/codeDuJour.ts']) assert.doesNotMatch(source(f), /window\.confirm/, f)
    assert.ok(readdirSync(join(RACINE, 'src/lib')).includes('ecransCommercant.ts'))
  })
})

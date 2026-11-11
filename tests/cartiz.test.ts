// Modules « Cartiz » (09/11/2026) : caisse + file hors ligne, points + catalogue, équipe + audit, messages automatiques,
// menu digital, tableau de bord, apparence de la carte. Vrai serveur HTTP + vraie base SQLite temporaire.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, type OptionsServeur } from '../server/app.ts'
import type { CategorieMenu, Client, EntreeJournal } from '../src/types.ts'
import { analyserMontant, pointsPourMontant } from '../src/lib/points.ts'
import { clientIdDepuisQr, creerFileCaisse, libelleFile, type ActionCaisse, type Envoi } from '../src/lib/fileCaisse.ts'
import { analyserAnniversaire, clientsCibles, genererMessages } from '../src/lib/messages.ts'
import { contraste, problemesApparence } from '../src/lib/apparence.ts'
import { ErreurMenu, compterPlats, menuDepuisCsv, menuEnCsv, validerMenu } from '../src/lib/menu.ts'
import { menuReelAsianHome } from '../src/data/menu-reel.ts'
import { calculerChiffresCartes } from '../src/lib/stats.ts'
import { nouveauCommerce } from '../src/data/defaults.ts'
import { nouveauClient, validerVisite } from '../src/lib/fidelite.ts'

const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
let horloge = new Date(2026, 10, 9, 12, 0)
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-cartiz-'))
after(() => rmSync(dossier, { recursive: true, force: true }))

async function demarrer(nom: string, options: Partial<OptionsServeur> = {}) {
  const app = await creerServeur({ fichierDb: join(dossier, nom), adminPin: ADMIN, pinInitial: '1234', version: 'test', maintenant: () => horloge, ...options })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, { method: methode, headers: { 'Content-Type': 'application/json', ...entetes }, body: corps === undefined ? undefined : JSON.stringify(corps) })
    return { statut: r.status, contenu: (r.headers.get('content-type') ?? '').includes('json') ? await r.json() : await r.text() }
  }
  return { app, api }
}

// ---------------------------------------------------------------------------------------------
// Logique pure
// ---------------------------------------------------------------------------------------------

describe('Points (logique)', () => {
  test('1 point par euro par défaut, réglable (1 point / 2 €), tranches entières', () => {
    assert.equal(pointsPourMontant(2350, {}), 23)
    assert.equal(pointsPourMontant(2350, { eurosParPoint: 2 }), 11)
    assert.equal(pointsPourMontant(199, { eurosParPoint: 2 }), 0)
    assert.equal(pointsPourMontant(-5, {}), 0)
    assert.equal(pointsPourMontant(1000, { eurosParPoint: 0.5 }), 20)
  })
  test('saisie du montant : virgule, point, espace, €', () => {
    assert.equal(analyserMontant('23,50'), 2350)
    assert.equal(analyserMontant('23.5 €'), 2350)
    assert.equal(analyserMontant(''), 0)
    assert.equal(analyserMontant('abc'), null)
    assert.equal(analyserMontant('1,234'), null)
  })
})

describe('File d’attente hors ligne (logique)', () => {
  const memoire = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
  }
  const action = (id: string, type: ActionCaisse['type'] = 'passage'): ActionCaisse => ({ id, type, commerceId: AH, clientId: 'cl-1', clientPrenom: 'Lina', faitLe: '2026-11-09T11:00:00Z' })

  test('réseau coupé : les actions restent en file (et dans le stockage), dans l’ordre', async () => {
    const s = memoire()
    const f = creerFileCaisse(s, 'cle')
    f.ajouter(action('a1'))
    f.ajouter(action('a2'))
    const e = await f.synchroniser(async () => ({ ok: false, reseau: true }))
    assert.deepEqual(e.attente.map((a) => a.id), ['a1', 'a2'])
    // Un nouvel onglet relit la file depuis le localStorage.
    assert.equal(creerFileCaisse(s, 'cle').lire().attente.length, 2)
    assert.equal(libelleFile(e, false), '2 actions en attente (hors ligne)')
  })

  test('retour du réseau : envoi dans l’ordre, file vidée, « Synchronisé »', async () => {
    const f = creerFileCaisse(memoire(), 'cle')
    f.ajouter(action('a1'))
    f.ajouter(action('a2'))
    const envoyees: string[] = []
    const e = await f.synchroniser(async (a) => (envoyees.push(a.id), { ok: true }))
    assert.deepEqual(envoyees, ['a1', 'a2'])
    assert.equal(e.attente.length, 0)
    assert.equal(libelleFile(e, true), 'Synchronisé')
  })

  test('refus du serveur : l’action sort de la file et apparaît comme refusée (jamais comptée réussie)', async () => {
    const f = creerFileCaisse(memoire(), 'cle')
    f.ajouter(action('a1'))
    f.ajouter(action('a2', 'recompense'))
    const e = await f.synchroniser(async (a): Promise<Envoi> => (a.id === 'a2' ? { ok: false, reseau: false, erreur: 'Récompense pas encore débloquée' } : { ok: true }))
    assert.equal(e.attente.length, 0)
    assert.deepEqual(e.refusees.map((r) => [r.action.id, r.erreur]), [['a2', 'Récompense pas encore débloquée']])
    assert.equal(f.oublierRefusees().refusees.length, 0)
  })

  test('deux synchronisations simultanées : chaque action n’est envoyée qu’une fois', async () => {
    const f = creerFileCaisse(memoire(), 'cle')
    f.ajouter(action('a1'))
    let n = 0
    await Promise.all([f.synchroniser(async () => (n++, { ok: true })), f.synchroniser(async () => (n++, { ok: true }))])
    assert.equal(n, 1)
  })

  // Trouvé par le test E2E (tests-e2e/) : la caisse se synchronise à l'ouverture, file vide. Avant le correctif, cette
  // synchronisation restait « en cours » pour toujours : les passages suivants restaient en file, jamais envoyés,
  // alors que l'écran disait « ✓ Passage enregistré » et « Synchronisé ».
  test('après une synchronisation à vide, une action ajoutée ensuite est bien envoyée', async () => {
    const f = creerFileCaisse(memoire(), 'cle')
    const envoyees: string[] = []
    const envoyer = async (a: ActionCaisse): Promise<Envoi> => (envoyees.push(a.id), { ok: true })
    assert.equal((await f.synchroniser(envoyer)).attente.length, 0)
    f.ajouter(action('a1'))
    const e = await f.synchroniser(envoyer)
    assert.deepEqual(envoyees, ['a1'])
    assert.equal(e.attente.length, 0)
    assert.equal(f.lire().attente.length, 0)
  })

  test('QR de la carte → identifiant client', () => {
    assert.equal(clientIdDepuisQr('https://asian-home-fidelite.onrender.com/#/carte/cl-abc-12'), 'cl-abc-12')
    assert.equal(clientIdDepuisQr('cl-xyz'), 'cl-xyz')
    assert.equal(clientIdDepuisQr('https://autre.site/'), null)
  })
})

describe('Messages automatiques (logique)', () => {
  const commerce = { ...nouveauCommerce('Chez Lin', 'restaurant', ''), seuilTampons: 4, messagesAuto: { bienvenue: true, recompense: true, presque: true, inactif: true, anniversaire: true, avis: true } }
  let n = 0
  const id = () => `m${++n}`
  test('règle désactivée → aucun message ; activée → une seule fois', () => {
    const c = nouveauClient(commerce.id, 'Lina', { telephone: '0611111111' })
    assert.equal(genererMessages(c, { ...commerce, messagesAuto: undefined }, 'inscription', new Date(), id).nouveaux.length, 0)
    const r = genererMessages(c, commerce, 'inscription', new Date(), id)
    assert.equal(r.nouveaux[0].type, 'bienvenue')
    assert.equal(genererMessages(r.client, commerce, 'inscription', new Date(), id).nouveaux.length, 0, 'pas de doublon')
  })
  test('passages : « plus que 2 », puis « récompense », puis demande d’avis (jamais liée à une récompense)', () => {
    let c = nouveauClient(commerce.id, 'Lina', { telephone: '0611111111' })
    const types: string[] = []
    for (let i = 0; i < 4; i++) {
      const r = genererMessages(validerVisite(c, commerce), commerce, 'passage', new Date(), id)
      c = r.client
      types.push(...r.nouveaux.map((m) => m.type))
    }
    assert.deepEqual(types, ['presque', 'avis', 'recompense'])
    const avis = c.messages!.find((m) => m.type === 'avis')!
    assert.match(avis.texte, /sans contrepartie/)
    assert.doesNotMatch(avis.texte, /offert|gagn|récompense/i)
  })
  test('ouverture : relance après 30 jours sans visite, anniversaire le bon jour', () => {
    const c: Client = { ...nouveauClient(commerce.id, 'Lina', { telephone: '0611111111' }), derniereVisite: '2026-09-01T12:00:00Z', anniversaire: '11-09' }
    const r = genererMessages(c, commerce, 'ouverture', new Date(2026, 10, 9, 12), id)
    assert.deepEqual(r.nouveaux.map((m) => m.type).sort(), ['anniversaire', 'inactif'])
  })
  test('anniversaire saisi « JJ/MM »', () => {
    assert.equal(analyserAnniversaire('21/03'), '03-21')
    assert.equal(analyserAnniversaire('31/02'), null)
    assert.equal(analyserAnniversaire(''), '')
  })
  test('ciblage : inactifs, proches de la récompense, nouveaux', () => {
    const maintenant = new Date(2026, 10, 9)
    const base = (p: Partial<Client>): Client => ({ ...nouveauClient(commerce.id, 'X', { telephone: '0600000000' }), creeLe: '2026-01-01T00:00:00Z', ...p })
    const clients = [base({ id: 'inactif', derniereVisite: '2026-09-01T00:00:00Z', tampons: 1 }), base({ id: 'proche', derniereVisite: '2026-11-08T00:00:00Z', tampons: 3 }), base({ id: 'nouveau', creeLe: '2026-11-01T00:00:00Z' })]
    const ids = (c: Parameters<typeof clientsCibles>[2]) => clientsCibles(clients, commerce, c, maintenant).map((x) => x.id)
    assert.deepEqual(ids('inactifs'), ['inactif'])
    assert.deepEqual(ids('proches'), ['proche'])
    assert.deepEqual(ids('nouveaux'), ['nouveau'])
    assert.equal(ids('tous').length, 3)
  })
})

describe('Apparence, menu, tableau de bord (logique)', () => {
  test('contrastes : charte par défaut conforme, couleur trop claire refusée', () => {
    assert.ok(contraste('#b3262d', '#ffffff') >= 4.5)
    assert.deepEqual(problemesApparence({ couleur: '#b3262d', fond: '#fbf8f3' }), [])
    assert.match(problemesApparence({ couleur: '#ffd700' })[0], /trop claire/)
    assert.match(problemesApparence({ fond: '#333333' })[0], /trop foncé/)
    assert.match(problemesApparence({ banniere: 'http://x' })[0], /https/)
  })
  test('menu : prix en centimes, allergènes connus, photo URL ou image compressée', () => {
    const m = validerMenu({ categories: [{ nom: 'Entrées', produits: [{ nom: 'Nems', prix: 650, allergenes: ['Gluten', 'Soja'], photo: 'https://x/n.jpg' }] }] }, AH, new Date())
    assert.equal(m.categories[0].produits[0].prix, 650)
    assert.throws(() => validerMenu({ categories: [{ nom: 'E', produits: [{ nom: 'N', prix: 6.5, allergenes: [] }] }] }, AH, new Date()), ErreurMenu)
    assert.throws(() => validerMenu({ categories: [{ nom: 'E', produits: [{ nom: 'N', prix: 1, allergenes: ['Cacahuète'] }] }] }, AH, new Date()), /allergène/)
    assert.throws(() => validerMenu({ categories: [{ nom: 'E', produits: [{ nom: 'N', prix: 1, allergenes: [], photo: 'javascript:alert(1)' }] }] }, AH, new Date()), /photo/)
  })
  test('tableau de bord : cartes émises, passages total / 30 j, récompenses, plus fidèles', () => {
    const t = new Date(2026, 10, 9)
    const c = (id: string, visites: string[], p: Partial<Client> = {}): Client => ({ ...nouveauClient(AH, id, { telephone: '0600000000' }), id, visites, ...p })
    const ch = calculerChiffresCartes(
      [c('a', ['2026-11-01T10:00:00Z', '2026-11-05T10:00:00Z'], { recompensesOffertes: [{ date: '', libelle: '' }], points: 10 }), c('b', ['2026-08-01T10:00:00Z']), c('c', [])],
      t,
    )
    assert.deepEqual([ch.cartesEmises, ch.passagesTotal, ch.passages30j, ch.recompensesDonnees], [3, 3, 2, 1])
    assert.deepEqual(ch.plusFideles.map((x) => x.prenom), ['a', 'b'])
  })
})

// ---------------------------------------------------------------------------------------------
// Serveur
// ---------------------------------------------------------------------------------------------

describe('Équipe, caisse, points, audit (serveur)', () => {
  let srv: Awaited<ReturnType<typeof demarrer>>
  let lina: Client
  let membreId = ''
  const CODE = { 'X-Equipe-Code': '2468' }
  before(async () => {
    horloge = new Date(2026, 10, 9, 12, 0)
    srv = await demarrer('caisse.db')
    lina = (await srv.api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '06 12 34 56 78' }, PIN)).contenu.client
  })
  after(() => srv.app.fermer())

  test('équipe : ajout (code 4 chiffres, unique), jamais de code renvoyé ; seul le gérant gère', async () => {
    const r = await srv.api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)
    assert.equal(r.statut, 201)
    membreId = r.contenu.membre.id
    assert.equal(JSON.stringify(r.contenu).includes('2468'), false)
    assert.equal((await srv.api('POST', `/commerces/${AH}/equipe`, { nom: 'Tom', code: '2468' }, PIN)).statut, 409, 'code déjà pris')
    assert.equal((await srv.api('POST', `/commerces/${AH}/equipe`, { nom: 'Tom', code: '12345' }, PIN)).statut, 400)
    assert.equal((await srv.api('POST', `/commerces/${AH}/equipe`, { nom: 'Tom', code: '1357' }, CODE)).statut, 401, 'un membre ne gère pas l’équipe')
    assert.equal((await srv.api('POST', `/commerces/${AH}/equipe`, { nom: 'Tom', code: '1357' }, PIN)).statut, 201)
    const etat = await srv.api('GET', `/commerces/${AH}/etat`, undefined, PIN)
    assert.deepEqual(etat.contenu.membres.map((m: { nom: string }) => m.nom), ['Mai', 'Tom'])
    assert.doesNotMatch(JSON.stringify(etat.contenu.membres), /2468|1357|hash|sel/)
  })

  test('caisse : code équipe exigé (mauvais code 401), le code identifie le membre', async () => {
    assert.equal((await srv.api('GET', `/commerces/${AH}/caisse`, undefined, { 'X-Equipe-Code': '0000' })).statut, 401)
    const r = await srv.api('GET', `/commerces/${AH}/caisse?q=Lina`, undefined, CODE)
    assert.equal(r.statut, 200)
    assert.deepEqual(r.contenu.auteur, { type: 'membre', id: membreId, nom: 'Mai' })
    assert.ok(r.contenu.clients.some((c: Client) => c.id === lina.id))
    assert.equal((await srv.api('GET', `/commerces/${AH}/caisse`, undefined, CODE)).contenu.clients.length, 0, 'P0-S14 : sans recherche, aucun client')
  })

  test('passage avec montant → 1 tampon + points ; 2e passage le même jour refusé ; réglage 1 point / 2 €', async () => {
    const r = await srv.api('POST', `/commerces/${AH}/caisse/passage`, { clientId: lina.id, montantCentimes: 2350, actionId: 'act-passage-1' }, CODE)
    assert.equal(r.statut, 200)
    assert.equal(r.contenu.client.tampons, 1)
    assert.equal(r.contenu.client.points, 73, '50 points de bienvenue + 23 points du passage')
    const deux = await srv.api('POST', `/commerces/${AH}/caisse/passage`, { clientId: lina.id, montantCentimes: 1000, actionId: 'act-passage-2' }, CODE)
    assert.equal(deux.statut, 409)
    assert.match(deux.contenu.erreur, /1 tampon par jour/)

    assert.equal((await srv.api('PATCH', `/commerces/${AH}`, { eurosParPoint: 2 }, PIN)).statut, 200)
    horloge = new Date(2026, 10, 10, 12, 0)
    const r2 = await srv.api('POST', `/commerces/${AH}/caisse/passage`, { clientId: lina.id, montantCentimes: 2350, actionId: 'act-passage-3' }, CODE)
    assert.equal(r2.contenu.client.points, 73 + 11)
    assert.equal((await srv.api('PATCH', `/commerces/${AH}`, { eurosParPoint: 0 }, PIN)).statut, 400)
  })

  test('file hors ligne rejouée : même actionId → aucun 2e tampon ni point (idempotence)', async () => {
    horloge = new Date(2026, 10, 11, 12, 0)
    const corps = { clientId: lina.id, montantCentimes: 500, actionId: 'act-horsligne-1', faitLe: new Date(2026, 10, 11, 11, 30).toISOString() }
    const a = await srv.api('POST', `/commerces/${AH}/caisse/passage`, corps, CODE)
    const b = await srv.api('POST', `/commerces/${AH}/caisse/passage`, corps, CODE)
    assert.equal(a.contenu.dejaTraite, false)
    assert.equal(b.statut, 200)
    assert.equal(b.contenu.dejaTraite, true)
    assert.equal(b.contenu.client.tampons, a.contenu.client.tampons)
    assert.equal(b.contenu.client.points, a.contenu.client.points)
    assert.equal(a.contenu.client.visites.at(-1), corps.faitLe, 'heure réelle de l’action hors ligne conservée')
  })

  test('catalogue + échange de points : solde insuffisant refusé, échange tracé (avant/après), idempotent', async () => {
    const cat = await srv.api('PATCH', `/commerces/${AH}`, { catalogue: [{ id: 'rp-nems', nom: '4 nems offerts', cout: 30 }, { id: 'rp-menu', nom: 'Menu offert', cout: 500, description: 'Entrée + plat' }] }, PIN)
    assert.equal(cat.statut, 200)
    assert.equal((await srv.api('PATCH', `/commerces/${AH}`, { catalogue: [{ nom: 'X', cout: 0 }] }, PIN)).statut, 400)
    const trop = await srv.api('POST', `/commerces/${AH}/caisse/echange`, { clientId: lina.id, recompenseId: 'rp-menu', actionId: 'act-echange-0' }, CODE)
    assert.equal(trop.statut, 409)
    assert.match(trop.contenu.erreur, /Solde insuffisant/)
    const avant = (await srv.api('GET', `/commerces/${AH}/caisse/clients/${lina.id}`, undefined, CODE)).contenu.client.points
    const ok = await srv.api('POST', `/commerces/${AH}/caisse/echange`, { clientId: lina.id, recompenseId: 'rp-nems', actionId: 'act-echange-1' }, CODE)
    assert.equal(ok.statut, 200)
    const e = ok.contenu.client.echangesPoints.at(-1)
    assert.deepEqual([e.libelle, e.cout, e.soldeAvant, e.soldeApres, e.auteur], ['4 nems offerts', 30, avant, avant - 30, 'Mai'])
    const rejoue = await srv.api('POST', `/commerces/${AH}/caisse/echange`, { clientId: lina.id, recompenseId: 'rp-nems', actionId: 'act-echange-1' }, CODE)
    assert.equal(rejoue.contenu.dejaTraite, true)
    assert.equal(rejoue.contenu.client.points, avant - 30, 'pas de double échange')
    assert.equal(rejoue.contenu.client.echangesPoints.length, 1)
  })

  test('récompense tampons en caisse : refusée avant le seuil', async () => {
    const r = await srv.api('POST', `/commerces/${AH}/caisse/recompense`, { clientId: lina.id, actionId: 'act-recomp-1' }, CODE)
    assert.equal(r.statut, 409)
  })

  test('journal d’audit : membre, client, action, date — jamais le code ; gérant tracé aussi', async () => {
    await srv.api('POST', `/commerces/${AH}/clients/${lina.id}/visite`, undefined, PIN)
    await srv.api('PATCH', `/commerces/${AH}/equipe/${membreId}`, { code: '9753' }, PIN)
    const j: EntreeJournal[] = (await srv.api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.journal
    const passages = j.filter((e) => e.action === 'passage')
    assert.ok(passages.some((e) => e.auteur.nom === 'Mai' && e.clientPrenom === 'Lina' && /23,50/.test(e.details)))
    assert.ok(passages.some((e) => e.auteur.type === 'gerant'))
    assert.ok(j.some((e) => e.action === 'echange' && /solde/.test(e.details)))
    assert.ok(j.some((e) => e.action === 'equipe' && /nouveau code/.test(e.details)))
    assert.doesNotMatch(JSON.stringify(j), /2468|9753|1357|1234/)
    // L'ancien code ne marche plus, le nouveau oui.
    assert.equal((await srv.api('GET', `/commerces/${AH}/caisse`, undefined, CODE)).statut, 401)
    assert.equal((await srv.api('GET', `/commerces/${AH}/caisse`, undefined, { 'X-Equipe-Code': '9753' })).statut, 200)
  })

  test('suppression d’un membre : son code n’ouvre plus la caisse', async () => {
    assert.equal((await srv.api('DELETE', `/commerces/${AH}/equipe/${membreId}`, undefined, PIN)).statut, 200)
    assert.equal((await srv.api('GET', `/commerces/${AH}/caisse`, undefined, { 'X-Equipe-Code': '9753' })).statut, 401)
  })
})

describe('Messages, menu, apparence (serveur)', () => {
  let srv: Awaited<ReturnType<typeof demarrer>>
  before(async () => {
    horloge = new Date(2026, 10, 9, 12, 0)
    srv = await demarrer('messages.db')
  })
  after(() => srv.app.fermer())

  test('règles activées dans Réglages → bienvenue à l’inscription, visible sur la carte publique, puis marqué lu', async () => {
    const regles = { bienvenue: true, recompense: true, presque: true, inactif: true, anniversaire: true, avis: true }
    assert.equal((await srv.api('PATCH', `/commerces/${AH}`, { messagesAuto: regles }, PIN)).statut, 200)
    const c: Client = (await srv.api('POST', `/commerces/${AH}/clients`, { prenom: 'Zoé', contact: 'zoe@exemple.fr' })).contenu.client
    const carte = await srv.api('GET', `/cartes/${c.id}`)
    assert.equal(carte.contenu.client.messages[0].type, 'bienvenue')
    assert.equal(carte.contenu.client.clesMessages, undefined, 'pas de données techniques sur la carte publique')
    assert.equal(carte.contenu.client.email, undefined)
    assert.equal((await srv.api('POST', `/cartes/${c.id}/lus`)).statut, 200)
    assert.equal((await srv.api('GET', `/cartes/${c.id}`)).contenu.client.messages[0].lu, true)
  })

  test('ouverture de la carte après 45 jours sans visite → rappel doux win-back (une seule fois) ; rien à 30 jours', async () => {
    const c: Client = (await srv.api('POST', `/commerces/${AH}/clients`, { prenom: 'Paul', contact: '0699999999' }, PIN)).contenu.client
    await srv.api('POST', `/commerces/${AH}/clients/${c.id}/visite`, undefined, PIN)
    horloge = new Date(2026, 11, 9, 12, 0) // 30 jours : trop tôt pour le win-back recalibré (rappel à 45 j)
    assert.ok(!(await srv.api('GET', `/cartes/${c.id}`)).contenu.client.messages.some((m: { type: string }) => m.type === 'inactif'))
    horloge = new Date(2026, 11, 25, 12, 0) // 46 jours : rappel doux, sans remise
    const types = (await srv.api('GET', `/cartes/${c.id}`)).contenu.client.messages.map((m: { type: string }) => m.type)
    assert.ok(types.includes('inactif'))
    const encore = (await srv.api('GET', `/cartes/${c.id}`)).contenu.client.messages.filter((m: { type: string }) => m.type === 'inactif')
    assert.equal(encore.length, 1)
    horloge = new Date(2026, 10, 9, 12, 0)
  })

  test('message ciblé du commerçant → déposé dans l’espace des clients ciblés seulement ; aucun SMS', async () => {
    const r = await srv.api('POST', `/commerces/${AH}/messages`, { cible: 'nouveaux', texte: 'Soirée dim sum vendredi !' }, PIN)
    assert.equal(r.statut, 200)
    assert.equal(r.contenu.destinataires, 2)
    assert.equal((await srv.api('POST', `/commerces/${AH}/messages`, { cible: 'tous', texte: 'x' })).statut, 401)
    assert.equal((await srv.api('POST', `/commerces/${AH}/messages`, { cible: 'vip', texte: 'x' }, PIN)).statut, 400)
    // Le commerçant retrouve les messages (auto + ciblés) avec le contact, texte prêt à copier ; pas sans PIN.
    const liste = await srv.api('GET', `/commerces/${AH}/messages`, undefined, PIN)
    assert.ok(liste.contenu.messages.some((x: { type: string; contact: string }) => x.type === 'bienvenue' && x.contact === 'zoe@exemple.fr'))
    assert.ok(liste.contenu.messages.some((x: { type: string; texte: string }) => x.type === 'commercant' && x.texte === 'Soirée dim sum vendredi !'))
    assert.equal((await srv.api('GET', `/commerces/${AH}/messages`)).statut, 401)
  })

  test('anniversaire saisi par le gérant (MM-JJ)', async () => {
    const c: Client = (await srv.api('POST', `/commerces/${AH}/clients`, { prenom: 'Ana', contact: '0688888888' }, PIN)).contenu.client
    assert.equal((await srv.api('PATCH', `/commerces/${AH}/clients/${c.id}`, { anniversaire: '13-40' }, PIN)).statut, 400)
    const r = await srv.api('PATCH', `/commerces/${AH}/clients/${c.id}`, { anniversaire: '11-09' }, PIN)
    assert.equal(r.contenu.client.anniversaire, '11-09')
    const carte = await srv.api('GET', `/cartes/${c.id}`)
    assert.ok(carte.contenu.client.messages.some((m: { type: string }) => m.type === 'anniversaire'))
  })

  test('menu : enregistré par le gérant, public en lecture, invalide refusé ; la carte signale le menu', async () => {
    const menu = { categories: [{ nom: 'Dim sum', produits: [{ nom: 'Har gow', prix: 790, allergenes: ['Crustacés', 'Gluten'], description: '4 pièces' }] }] }
    assert.equal((await srv.api('PUT', `/commerces/${AH}/menu`, menu)).statut, 401)
    assert.equal((await srv.api('PUT', `/commerces/${AH}/menu`, { categories: [{ nom: '', produits: [] }] }, PIN)).statut, 400)
    assert.equal((await srv.api('PUT', `/commerces/${AH}/menu`, menu, PIN)).statut, 200)
    const pub = await srv.api('GET', `/commerces/${AH}/menu`)
    assert.equal(pub.contenu.menu.categories[0].produits[0].nom, 'Har gow')
    const c: Client = (await srv.api('POST', `/commerces/${AH}/clients`, { prenom: 'Léo', contact: '0677777777' })).contenu.client
    assert.equal((await srv.api('GET', `/cartes/${c.id}`)).contenu.menuDisponible, true)
  })

  test('menu : prix null accepté (prix non vérifié, jamais 0 € inventé) et relu tel quel en public', async () => {
    const menu = { categories: [{ nom: 'Côté thaï', produits: [{ nom: 'Loc Lac', prix: null, description: 'Riz rouge, poulet ou bœuf caramélisé, œuf, salade.', allergenes: [], photo: '/visuels/menu-loc-lac.jpg' }] }] }
    assert.equal((await srv.api('PUT', `/commerces/${AH}/menu`, menu, PIN)).statut, 200)
    const pub = await srv.api('GET', `/commerces/${AH}/menu`)
    assert.equal(pub.contenu.menu.categories[0].produits[0].prix, null)
    assert.equal(pub.contenu.menu.categories[0].produits[0].photo, '/visuels/menu-loc-lac.jpg')
    // Photo locale hors /visuels/ ou URL non https refusée.
    assert.equal((await srv.api('PUT', `/commerces/${AH}/menu`, { categories: [{ nom: 'E', produits: [{ nom: 'N', prix: 100, allergenes: [], photo: '/autre/n.jpg' }] }] }, PIN)).statut, 400)
  })

  test('menu : carte officielle (81 plats, prix) enregistrée → relue en public à l’identique ; 61 plats acceptés, 121 refusés', async () => {
    const officiel = menuReelAsianHome()
    assert.equal((await srv.api('PUT', `/commerces/${AH}/menu`, { categories: officiel.categories }, PIN)).statut, 200)
    const pub = (await srv.api('GET', `/commerces/${AH}/menu`)).contenu.menu
    assert.equal(pub.categories.length, 16)
    assert.equal(compterPlats(pub), 81)
    const lus = pub.categories.flatMap((c: CategorieMenu) => c.produits.map((p) => [p.nom, p.prix]))
    assert.deepEqual(lus, officiel.categories.flatMap((c) => c.produits.map((p) => [p.nom, p.prix])))
    assert.equal(lus.filter(([, prix]: [string, number | null]) => prix === null).length, 5)
    assert.deepEqual(lus.find(([nom]: [string]) => nom === '6 Maki Gold'), ['6 Maki Gold', null])
    assert.deepEqual(lus.find(([nom]: [string]) => nom === 'Riz Thaï'), ['Riz Thaï', null])
    // Le même menu, réimporté depuis son export CSV, est accepté tel quel par le serveur.
    const csv = menuDepuisCsv(menuEnCsv(pub), AH, horloge)
    assert.equal((await srv.api('PUT', `/commerces/${AH}/menu`, { categories: csv.categories }, PIN)).statut, 200)
    assert.equal(compterPlats((await srv.api('GET', `/commerces/${AH}/menu`)).contenu.menu), 81)
    // L'ancienne limite (60) ne bloque plus ; la nouvelle (120) tient.
    const plats = (n: number) => ({ categories: [{ nom: 'Tout', produits: Array.from({ length: n }, (_, i) => ({ nom: `Plat ${i + 1}`, prix: 500, allergenes: [] })) }] })
    assert.equal((await srv.api('PUT', `/commerces/${AH}/menu`, plats(61), PIN)).statut, 200)
    const refus = await srv.api('PUT', `/commerces/${AH}/menu`, plats(121), PIN)
    assert.equal(refus.statut, 400)
    assert.match(JSON.stringify(refus.contenu), /120 produits maximum/)
    assert.equal(compterPlats((await srv.api('GET', `/commerces/${AH}/menu`)).contenu.menu), 61, 'le refus ne touche pas au menu enregistré')
  })

  test('apparence : couleur illisible refusée (contraste), couleur conforme acceptée et publique', async () => {
    assert.equal((await srv.api('PATCH', `/commerces/${AH}`, { apparence: { couleur: '#ffee00' } }, PIN)).statut, 400)
    assert.equal((await srv.api('PATCH', `/commerces/${AH}`, { apparence: { couleur: '#1d4ed8', banniere: 'https://exemple.fr/b.jpg' } }, PIN)).statut, 200)
    const pub = await srv.api('GET', `/commerces/${AH}`)
    assert.equal(pub.contenu.commerce.apparence.couleur, '#1d4ed8')
  })
})

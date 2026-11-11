// P0-S7 : authentification client (audit F-03, revue Codex points 4 et 5). Vrai serveur HTTP sur une base SQLite
// temporaire (comme tests/serveur.test.ts), horloge pilotée ; migration 0009 aller / retour sur Postgres (PGlite) ;
// logique du front (jetons rangés sur le téléphone, API qui les porte) avec des doubles.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { PGlite } from '@electric-sql/pglite'

import { creerServeur, emettreJeton, emettreJetonClient, lireJeton, lireJetonClient, DUREE_JETON_CLIENT_S, type OptionsServeur } from '../server/app.ts'
import { ErreurMigrationManquante, ouvrirStockage } from '../server/stockage.ts'
import { ouvrirStockageSupabase } from '../server/stockage-supabase.ts'
import type { Client } from '../src/types.ts'
import { estIdClientActuel, nouvelIdClient, nouveauClient } from '../src/lib/fidelite.ts'
import { hashSansLienAcces, idCarteDuParam, lienAccesDuHash, memoireJetons, RENOUVELER_AVANT_MS } from '../src/lib/jetonCarte.ts'
import { assurerJetonClient, avecJetonClient } from '../src/data/jeuApi.ts'
import { creerClientApi, ErreurApi, estVueLimitee, type ClientApi } from '../src/data/api.ts'

const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const SECRET = 'secret-de-test-p0-s7-au-moins-32-caracteres-0123456789'
const SITE = 'https://fidelite.exemple.fr'
const LARGES = { inscriptionParIp: 1000, inscriptionParContact: 1000, ficheClientParIp: 1000, lectureParIp: 1000, lectureParCarte: 1000, tirageParIp: 1000, tirageParContact: 1000 }
/** Ancien identifiant (`cl-<horodatage base36>-<4 car.>`), comme les cartes créées avant P0-S7. */
const ANCIEN_ID = 'cl-mh8v2k3p-4f2k'

const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p0s7-'))
after(() => rmSync(dossier, { recursive: true, force: true }))

type Reponse = { statut: number; contenu: any; texte: string; entetes: Headers }

/**
 * `ipParAppel` : chaque requête vient d'une IP différente (derrière proxy, X-Forwarded-For) — les suites qui enchaînent
 * des refus volontaires n'atteignent pas le seuil anti-bruteforce, testé à part avec une IP fixe.
 */
async function demarrer(nom: string, options: Partial<OptionsServeur> = {}, { ipParAppel = false } = {}) {
  const horloge = { t: new Date(2026, 10, 12, 12, 0) }
  const fichierDb = join(dossier, nom)
  const appels: { url: string; corps: string }[] = []
  const app = await creerServeur({
    fichierDb,
    adminPin: ADMIN,
    pinInitial: '1234',
    version: 'test',
    secretSession: SECRET,
    authClient: 'stricte',
    urlPublique: SITE,
    maintenant: () => horloge.t,
    limitesPubliques: LARGES,
    ...(ipParAppel ? { derriereProxy: true } : {}),
    ...options,
  })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
  let numeroIp = 0
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}): Promise<Reponse> {
    const r = await fetch(`${racine}/api/v1${chemin}`, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...(ipParAppel ? { 'X-Forwarded-For': `198.51.100.${++numeroIp % 250}, 10.0.0.${numeroIp % 250}` } : {}), ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      redirect: 'manual',
    })
    const texte = await r.text()
    let contenu: unknown = texte
    try {
      contenu = JSON.parse(texte)
    } catch {
      // CSV, texte brut
    }
    return { statut: r.status, contenu, texte, entetes: r.headers }
  }
  const bearer = (jeton: string) => ({ Authorization: `Bearer ${jeton}` })
  /** Inscription publique (page de jeu) → la carte et son jeton. */
  async function inscrire(contact: string, commerceId = AH) {
    const r = await api('POST', `/commerces/${commerceId}/clients`, { contact })
    assert.equal(r.statut, 201, r.texte)
    return { client: r.contenu.client as Client, jeton: r.contenu.jeton as string, expireLe: r.contenu.expireLe as string }
  }
  const visite = (clientId: string, commerceId = AH, pin: Record<string, string> = PIN) => api('POST', `/commerces/${commerceId}/clients/${clientId}/visite`, undefined, pin)
  const etat = async (commerceId = AH, pin: Record<string, string> = PIN) => (await api('GET', `/commerces/${commerceId}/etat`, undefined, pin)).contenu
  return { app, api, bearer, inscrire, visite, etat, horloge, fichierDb, racine, appels }
}

/** Carte à ANCIEN identifiant, écrite directement en base (comme une carte créée avant P0-S7). */
function ajouterAncienneCarte(fichierDb: string, id = ANCIEN_ID, contact = '0677777777') {
  const st = ouvrirStockage(fichierDb)
  try {
    st.ajouterClient({ ...nouveauClient(AH, 'Ancienne', { telephone: contact }, new Date(2026, 9, 1)), id, messages: [{ id: 'm1', type: 'commercant', texte: 'Bonjour', date: '2026-10-02T10:00:00.000Z' }] })
  } finally {
    st.fermer()
  }
}

/** Jeton modifié d'un caractère dans sa signature. */
const falsifier = (jeton: string) => jeton.slice(0, -2) + (jeton.at(-2) === 'A' ? 'B' : 'A') + jeton.at(-1)

describe('P0-S7 : identifiants imprévisibles', () => {
  test('nouvelle carte : `cl-` + UUID v4 ; l’ancien format est reconnu comme ancien', () => {
    const ids = new Set(Array.from({ length: 200 }, () => nouvelIdClient()))
    assert.equal(ids.size, 200)
    for (const id of ids) assert.ok(estIdClientActuel(id), id)
    assert.ok(estIdClientActuel(nouveauClient('c1', '', { telephone: '0612345678' }).id))
    for (const ancien of [ANCIEN_ID, 'cl-1', 'cl-mh8v2k3p-4f2k-x', 'k1', 'cl-00000000-0000-1000-8000-000000000000']) assert.equal(estIdClientActuel(ancien), false, ancien)
  })

  test('repli sans randomUUID (démo en http://) : toujours un UUID v4', () => {
    const d = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID') ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(globalThis.crypto), 'randomUUID')!
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      assert.ok(estIdClientActuel(nouvelIdClient()))
    } finally {
      delete (globalThis.crypto as { randomUUID?: unknown }).randomUUID
      if (!globalThis.crypto.randomUUID) Object.defineProperty(globalThis.crypto, 'randomUUID', d)
    }
    assert.equal(typeof globalThis.crypto.randomUUID, 'function')
  })
})

describe('P0-S7 : jetons client (format, séparation d’avec les sessions)', () => {
  test('signé, typé ; une session n’est jamais lue comme jeton client, ni l’inverse', () => {
    const c = { typ: 'client' as const, jti: 'j1', cid: 'cl-x', com: AH, ver: 0, exp: 2_000_000_000 }
    const jeton = emettreJetonClient(SECRET, c)
    assert.match(jeton, /^v1\.[\w-]+\.[\w-]+$/)
    assert.deepEqual(lireJetonClient(SECRET, jeton), c)
    assert.equal(lireJetonClient('un-autre-secret-de-trente-deux-caracteres-xx', jeton), null)
    assert.equal(lireJetonClient(SECRET, falsifier(jeton)), null)
    assert.equal(lireJeton(SECRET, jeton), null, 'jeton client refusé comme session')
    const session = emettreJeton(SECRET, { jti: 's1', role: 'commerce', commerceId: AH, exp: 2_000_000_000 })
    assert.equal(lireJetonClient(SECRET, session), null, 'session refusée comme jeton client')
  })
})

describe('P0-S7 : serveur en mode strict', () => {
  let s: Awaited<ReturnType<typeof demarrer>>
  before(async () => {
    s = await demarrer('strict.db', {}, { ipParAppel: true })
  })
  after(() => s.app.fermer())

  test('inscription : identifiant imprévisible + jeton client (30 jours) ; vue complète avec, vue limitée sans', async () => {
    const { client, jeton, expireLe } = await s.inscrire('0611111111')
    assert.ok(estIdClientActuel(client.id))
    assert.equal(new Date(expireLe).getTime(), s.horloge.t.getTime() + DUREE_JETON_CLIENT_S * 1000)
    assert.deepEqual(lireJetonClient(SECRET, jeton), { ...lireJetonClient(SECRET, jeton)!, typ: 'client', cid: client.id, com: AH, ver: 0 })

    const complete = await s.api('GET', `/cartes/${client.id}`, undefined, s.bearer(jeton))
    assert.equal(complete.statut, 200)
    assert.deepEqual(complete.contenu.acces, { vue: 'complete', jeton: true })
    assert.ok(Array.isArray(complete.contenu.client.visites))
    assert.ok(Array.isArray(complete.contenu.historiqueLots))

    const limitee = await s.api('GET', `/cartes/${client.id}`)
    assert.equal(limitee.statut, 200)
    assert.deepEqual(limitee.contenu.client, { id: client.id, commerceId: AH, tampons: 0 })
    assert.deepEqual(limitee.contenu.acces, { vue: 'limitee', jeton: false })
    assert.deepEqual(limitee.contenu.jeu, { statut: 'sansVisite', lotDuJour: null, codeDuJour: null, remisDuJour: false })
    assert.equal(limitee.contenu.historiqueLots, undefined)
    assert.doesNotMatch(limitee.texte, /visites|messages|prenom|demandes|telephone|email|0611/, 'ni historique, ni messages, ni contact')
  })

  test('accès refusé sans preuve : 401 uniforme (carte existante ou inconnue), et 404 identique pour une carte inconnue en lecture', async () => {
    const { client } = await s.inscrire('0622222222')
    const inconnue = nouvelIdClient()
    const protegees = (id: string): [string, string, unknown][] => [
      ['POST', `/cartes/${id}/lus`, undefined],
      ['POST', `/cartes/${id}/donnees`, { contact: '0622222222' }],
      ['POST', `/cartes/${id}/suppression`, { contact: '0622222222' }],
      ['POST', `/cartes/${id}/revocation`, undefined],
      ['POST', `/commerces/${AH}/clients/${id}/profil`, { platPrefere: 'Nems' }],
      ['POST', `/commerces/${AH}/clients/${id}/rattrapage`, { date: s.horloge.t.toISOString(), montantCentimes: 1000 }],
      ['POST', `/commerces/${AH}/clients/${id}/prenom`, { contact: '0622222222', prenom: 'Pirate' }],
      ['POST', `/commerces/${AH}/clients/${id}/message-prive`, { contact: '0622222222', note: 2, texte: 'Bof' }],
    ]
    for (const [m, chemin, corps] of protegees(client.id)) {
      const existante = await s.api(m, chemin, corps)
      const absente = await s.api(m, chemin.replace(client.id, inconnue), corps)
      assert.equal(existante.statut, 401, chemin)
      assert.deepEqual([absente.statut, absente.texte], [existante.statut, existante.texte], `${chemin} : même réponse que la carte existe ou non`)
    }
    // Rien n'a été écrit sur la carte.
    const fiche = (await s.etat()).clients.find((c: Client) => c.id === client.id)
    assert.equal(fiche.prenom, '')
    assert.equal(fiche.platPrefere, undefined)
    assert.equal(fiche.demandeSuppressionLe, undefined)
    assert.equal((await s.api('GET', `/cartes/${inconnue}`)).statut, 404)
  })

  test('accès accepté avec le jeton : prénom, message privé, profil, rattrapage, lus, RGPD (jeton ET contact)', async () => {
    const { client, jeton } = await s.inscrire('0633333333')
    const b = s.bearer(jeton)
    assert.equal((await s.api('POST', `/commerces/${AH}/clients/${client.id}/prenom`, { prenom: 'Lina' }, b)).statut, 200)
    assert.equal((await s.api('POST', `/commerces/${AH}/clients/${client.id}/message-prive`, { note: 2, texte: 'Un peu froid' }, b)).statut, 201)
    assert.equal((await s.api('POST', `/cartes/${client.id}/lus`, undefined, b)).statut, 200)
    // Profil après la 2e visite ; rattrapage selon les règles du commerce : la preuve passe, la règle métier décide.
    assert.equal((await s.api('POST', `/commerces/${AH}/clients/${client.id}/profil`, { platPrefere: 'Nems' }, b)).statut, 409)
    assert.notEqual((await s.api('POST', `/commerces/${AH}/clients/${client.id}/rattrapage`, { date: s.horloge.t.toISOString(), montantCentimes: 1000 }, b)).statut, 401)
    await s.visite(client.id)
    await s.visite(client.id)
    assert.equal((await s.api('POST', `/commerces/${AH}/clients/${client.id}/profil`, { platPrefere: 'Nems' }, b)).statut, 200)
    // RGPD : le jeton ne dispense pas du contact (403 sans), et le contact ne suffit pas sans jeton (401).
    assert.equal((await s.api('POST', `/cartes/${client.id}/donnees`, { contact: '0699999999' }, b)).statut, 403)
    assert.equal((await s.api('POST', `/cartes/${client.id}/donnees`, { contact: '06 33 33 33 33' }, b)).statut, 200)
    const fiche = (await s.etat()).clients.find((c: Client) => c.id === client.id)
    assert.deepEqual([fiche.prenom, fiche.platPrefere, fiche.messagesPrives?.length], ['Lina', 'Nems', 1])
  })

  test('preuve falsifiée, d’une autre carte, d’un autre commerce, de type « lien » : 401 ; expirée : 401', async () => {
    const a = await s.inscrire('0644444444')
    const bClient = await s.inscrire('0655555555')
    const lien = await s.api('POST', `/commerces/${AH}/clients/${a.client.id}/lien-acces`, undefined, PIN)
    const jetonLien = /acces=([\w.-]+)/.exec(lien.contenu.lien)![1]
    for (const preuve of [falsifier(a.jeton), bClient.jeton, jetonLien, 'nimporte-quoi', emettreJeton(SECRET, { jti: 's', role: 'admin', exp: 2_000_000_000 })]) {
      const r = await s.api('GET', `/cartes/${a.client.id}`, undefined, s.bearer(preuve))
      assert.equal(r.statut, 401, preuve.slice(0, 20))
    }
    const autreCommerce = await s.api('POST', '/commerces', { nom: 'Autre', type: 'restaurant', pin: '5555' }, { 'X-Admin-PIN': ADMIN })
    const dAilleurs = await s.inscrire('0644444444', autreCommerce.contenu.commerce.id)
    assert.equal((await s.api('POST', `/commerces/${AH}/clients/${dAilleurs.client.id}/prenom`, { prenom: 'X' }, s.bearer(dAilleurs.jeton))).statut, 401)
    assert.equal((await s.api('POST', `/commerces/${AH}/tirages`, {}, s.bearer(dAilleurs.jeton))).statut, 401, 'tirage avec le jeton d’un autre commerce')

    const avant = s.horloge.t
    s.horloge.t = new Date(avant.getTime() + DUREE_JETON_CLIENT_S * 1000 + 1000)
    try {
      assert.equal((await s.api('GET', `/cartes/${a.client.id}`, undefined, s.bearer(a.jeton))).statut, 401, 'jeton expiré')
      assert.equal((await s.api('POST', `/cartes/${a.client.id}/jeton`, {}, s.bearer(a.jeton))).statut, 401, 'pas de renouvellement après expiration')
      assert.equal((await s.api('GET', `/cartes/${a.client.id}`)).contenu.acces.vue, 'limitee', 'la vue limitée reste')
    } finally {
      s.horloge.t = avant
    }
  })

  test('renouvellement : un jeton valable en donne un neuf, plus tardif', async () => {
    const { client, jeton } = await s.inscrire('0656565656')
    s.horloge.t = new Date(s.horloge.t.getTime() + 20 * 24 * 3600_000)
    try {
      const r = await s.api('POST', `/cartes/${client.id}/jeton`, {}, s.bearer(jeton))
      assert.equal(r.statut, 201)
      assert.equal(new Date(r.contenu.expireLe).getTime(), s.horloge.t.getTime() + DUREE_JETON_CLIENT_S * 1000)
      assert.equal((await s.api('GET', `/cartes/${client.id}`, undefined, s.bearer(r.contenu.jeton))).contenu.acces.vue, 'complete')
    } finally {
      s.horloge.t = new Date(2026, 10, 12, 12, 0)
    }
  })

  test('tirage : sans jeton 401 ; avec jeton → la carte du jeton joue, 1 fois par jour après visite validée', async () => {
    const a = await s.inscrire('0666666666')
    const b = await s.inscrire('0667676767')
    assert.equal((await s.api('POST', `/commerces/${AH}/tirages`, { contact: '0666666666' })).statut, 401, 'le contact seul ne suffit plus')
    assert.equal((await s.api('POST', `/commerces/${AH}/tirages`, {}, s.bearer(a.jeton))).statut, 409, 'pas de visite du jour')
    await s.visite(a.client.id)
    await s.visite(b.client.id)
    // Contact de B dans le corps, jeton de A : c'est A qui joue (le contact n'est plus lu).
    const r = await s.api('POST', `/commerces/${AH}/tirages`, { contact: '0667676767' }, s.bearer(a.jeton))
    assert.equal(r.statut, 201)
    assert.match(r.contenu.code, /^[A-Z2-9]{6}$/)
    assert.equal((await s.api('POST', `/commerces/${AH}/tirages`, {}, s.bearer(a.jeton))).statut, 409, '1 tirage par jour')
    const tirages = (await s.etat()).tirages
    assert.deepEqual(tirages.filter((t: { clientId: string }) => [a.client.id, b.client.id].includes(t.clientId)).map((t: { clientId: string }) => t.clientId), [a.client.id])
    // B joue avec SON jeton ; le lendemain sans nouvelle visite : refusé.
    assert.equal((await s.api('POST', `/commerces/${AH}/tirages`, {}, s.bearer(b.jeton))).statut, 201)
    s.horloge.t = new Date(2026, 10, 13, 12, 0)
    try {
      assert.equal((await s.api('POST', `/commerces/${AH}/tirages`, {}, s.bearer(a.jeton))).statut, 409)
      await s.visite(a.client.id)
      assert.equal((await s.api('POST', `/commerces/${AH}/tirages`, {}, s.bearer(a.jeton))).statut, 201)
    } finally {
      s.horloge.t = new Date(2026, 10, 12, 12, 0)
    }
  })

  test('inscription d’un contact existant sans preuve : 409 sans aucune donnée de la carte, aucun doublon', async () => {
    const { client } = await s.inscrire('0677007700')
    const nombre = (await s.etat()).clients.length
    for (const contact of ['0677007700', '+33 6 77 00 77 00']) {
      const r = await s.api('POST', `/commerces/${AH}/clients`, { contact, prenom: 'Pirate', consentementRelance: true })
      assert.equal(r.statut, 409)
      assert.ok(!r.texte.includes(client.id), 'ni identifiant ni jeton')
      assert.deepEqual(Object.keys(r.contenu), ['erreur'])
    }
    const apres = await s.etat()
    assert.equal(apres.clients.length, nombre, 'aucun doublon')
    const fiche = apres.clients.find((c: Client) => c.id === client.id)
    assert.deepEqual([fiche.prenom, fiche.consentementRelance], ['', undefined], 'rien de modifié')
    // Le commerçant (PIN) retrouve toujours le client existant.
    assert.equal((await s.api('POST', `/commerces/${AH}/clients`, { contact: '0677007700' }, PIN)).contenu.client.id, client.id)
  })

  test('révocation par le client (tous ses appareils) puis par le commerce : les jetons tombent, journal « acces »', async () => {
    const { client, jeton } = await s.inscrire('0688888888')
    const second = (await s.api('POST', `/cartes/${client.id}/jeton`, {}, s.bearer(jeton))).contenu.jeton as string
    assert.equal((await s.api('POST', `/cartes/${client.id}/revocation`, undefined, s.bearer(second))).statut, 200)
    for (const j of [jeton, second]) assert.equal((await s.api('GET', `/cartes/${client.id}`, undefined, s.bearer(j))).statut, 401, 'révoqué')

    const lien = (await s.api('POST', `/commerces/${AH}/clients/${client.id}/lien-acces`, undefined, PIN)).contenu.lien as string
    const neuf = (await s.api('POST', `/cartes/${client.id}/jeton`, { lien: /acces=([\w.-]+)/.exec(lien)![1] })).contenu.jeton as string
    assert.equal((await s.api('GET', `/cartes/${client.id}`, undefined, s.bearer(neuf))).contenu.acces.vue, 'complete')
    assert.equal((await s.api('POST', `/commerces/${AH}/clients/${client.id}/revocation-acces`)).statut, 401, 'commerçant seulement')
    assert.equal((await s.api('POST', `/commerces/${AH}/clients/${client.id}/revocation-acces`, undefined, PIN)).statut, 200)
    assert.equal((await s.api('GET', `/cartes/${client.id}`, undefined, s.bearer(neuf))).statut, 401)
    const journal = (await s.etat()).journal.filter((e: { action: string; clientId?: string }) => e.action === 'acces' && e.clientId === client.id)
    assert.equal(journal.length, 3, 'révocation client, lien remis, révocation commerce')
    assert.doesNotMatch(JSON.stringify(journal), /v1\./, 'aucun jeton dans le journal')
  })

  test('lien d’accès du comptoir : 15 min, usage unique, propre à SA carte ; équipe autorisée', async () => {
    const { client } = await s.inscrire('0699000099')
    const autre = await s.inscrire('0699000098')
    const membre = await s.api('POST', `/commerces/${AH}/equipe`, { nom: 'Camille', code: '2468' }, PIN)
    assert.equal(membre.statut, 201)
    assert.equal((await s.api('POST', `/commerces/${AH}/clients/${client.id}/lien-acces`)).statut, 401)
    const r = await s.api('POST', `/commerces/${AH}/clients/${client.id}/lien-acces`, undefined, { 'X-Equipe-Code': '2468' })
    assert.equal(r.statut, 201)
    assert.ok(r.contenu.lien.startsWith(`${SITE}/#/carte/${client.id}?acces=`))
    const lien = /acces=([\w.-]+)/.exec(r.contenu.lien)![1]
    assert.equal((await s.api('POST', `/cartes/${autre.client.id}/jeton`, { lien })).statut, 401, 'pas pour une autre carte')
    const ok = await s.api('POST', `/cartes/${client.id}/jeton`, { lien })
    assert.equal(ok.statut, 201)
    assert.equal(ok.contenu.clientId, client.id)
    assert.equal((await s.api('POST', `/cartes/${client.id}/jeton`, { lien })).statut, 401, 'usage unique')
    const expire = /acces=([\w.-]+)/.exec((await s.api('POST', `/commerces/${AH}/clients/${client.id}/lien-acces`, undefined, PIN)).contenu.lien)![1]
    s.horloge.t = new Date(s.horloge.t.getTime() + 16 * 60_000)
    try {
      assert.equal((await s.api('POST', `/cartes/${client.id}/jeton`, { lien: expire })).statut, 401, 'expiré après 15 min')
    } finally {
      s.horloge.t = new Date(2026, 10, 12, 12, 0)
    }
    // Un lien d'accès n'est pas un jeton client : refusé en Authorization.
    const lien2 = /acces=([\w.-]+)/.exec((await s.api('POST', `/commerces/${AH}/clients/${client.id}/lien-acces`, undefined, PIN)).contenu.lien)![1]
    assert.equal((await s.api('GET', `/cartes/${client.id}`, undefined, s.bearer(lien2))).statut, 401)
  })

  test('une carte à identifiant NEUF ne s’obtient jamais avec son identifiant seul', async () => {
    const { client } = await s.inscrire('0611002200')
    assert.equal((await s.api('POST', `/cartes/${client.id}/jeton`, {})).statut, 401)
  })

  test('liens courts /c/<id> : vers la carte (vue limitée sans jeton) ; ?a=<lien> transmis à la page', async () => {
    const { client } = await s.inscrire('0611003300')
    const r = await fetch(`${s.racine}/c/${client.id}`, { redirect: 'manual' })
    assert.equal(r.status, 302)
    assert.equal(r.headers.get('location'), `/#/carte/${client.id}`)
    const avec = await fetch(`${s.racine}/c/${client.id}?a=v1.abc-_.def`, { redirect: 'manual' })
    assert.equal(avec.headers.get('location'), `/#/carte/${client.id}?acces=v1.abc-_.def`)
    const pirate = await fetch(`${s.racine}/c/${client.id}?a=%3Cscript%3E`, { redirect: 'manual' })
    assert.equal(pirate.headers.get('location'), `/#/carte/${client.id}`, 'caractères hors jeton ignorés')
  })

  test('suppression RGPD : la version d’accès de la carte disparaît avec elle', async () => {
    const { client, jeton } = await s.inscrire('0611004400')
    await s.api('POST', `/commerces/${AH}/clients/${client.id}/revocation-acces`, undefined, PIN)
    const st = ouvrirStockage(s.fichierDb)
    try {
      assert.equal(st.meta(`acces_client:${AH}:${client.id}`), '1')
      assert.equal((await s.api('DELETE', `/commerces/${AH}/clients/${client.id}`, { confirmation: 'SUPPRIMER' }, PIN)).statut, 200)
      assert.equal(st.meta(`acces_client:${AH}:${client.id}`), undefined)
    } finally {
      st.fermer()
    }
    assert.equal((await s.api('GET', `/cartes/${client.id}`, undefined, s.bearer(jeton))).statut, 401)
  })

  test('/sante inchangé ; /sante/acces-client : mode, jetons, migration, fin de grâce', async () => {
    const r = await s.api('GET', '/sante/acces-client')
    assert.equal(r.statut, 200)
    assert.deepEqual(r.contenu, { mode: 'stricte', jetons: true, migration: true, graceAnciensLiensJusquAu: '2027-02-09T23:00:00.000Z', accesSansJeton: 0 })
    assert.equal((await s.api('GET', '/sante')).contenu.authClient, undefined)
  })

  test('CORS : Authorization autorisé', async () => {
    const r = await fetch(`${s.racine}/api/v1/cartes/x`, { method: 'OPTIONS' })
    assert.match(r.headers.get('access-control-allow-headers') ?? '', /Authorization/)
  })
})

describe('P0-S7 : anciennes cartes (identifiant prévisible) et période de grâce', () => {
  let s: Awaited<ReturnType<typeof demarrer>>
  before(async () => {
    s = await demarrer('grace.db', { graceAnciensIdJusquAu: '2026-12-01T00:00:00+01:00' }, { ipParAppel: true })
    ajouterAncienneCarte(s.fichierDb)
  })
  after(() => s.app.fermer())

  test('pendant la grâce : l’ancien lien ouvre la vue limitée (avec la date butoir) et donne un jeton → vue complète', async () => {
    const limitee = await s.api('GET', `/cartes/${ANCIEN_ID}`)
    assert.equal(limitee.statut, 200)
    assert.deepEqual(limitee.contenu.acces, { vue: 'limitee', jeton: false, ancienLien: true, graceJusquAu: '2026-11-30T23:00:00.000Z' })
    assert.doesNotMatch(limitee.texte, /Ancienne|Bonjour/)
    const r = await s.api('POST', `/cartes/${ANCIEN_ID}/jeton`, {})
    assert.equal(r.statut, 201)
    const complete = await s.api('GET', `/cartes/${ANCIEN_ID}`, undefined, s.bearer(r.contenu.jeton))
    assert.equal(complete.contenu.acces.vue, 'complete')
    assert.equal(complete.contenu.client.prenom, 'Ancienne')
    assert.equal(complete.contenu.client.messages.length, 1)
  })

  test('après la grâce : l’ancien lien seul ne donne plus rien (404 comme une carte inconnue, 401 au jeton) ; un jeton obtenu reste valable', async () => {
    const jeton = (await s.api('POST', `/cartes/${ANCIEN_ID}/jeton`, {})).contenu.jeton as string
    s.horloge.t = new Date(2026, 11, 2, 12, 0)
    try {
      const lecture = await s.api('GET', `/cartes/${ANCIEN_ID}`)
      const inconnue = await s.api('GET', '/cartes/cl-mh8v2k3p-zzzz')
      assert.deepEqual([lecture.statut, lecture.texte], [inconnue.statut, inconnue.texte])
      assert.equal(lecture.statut, 404)
      assert.equal((await s.api('POST', `/cartes/${ANCIEN_ID}/jeton`, {})).statut, 401)
      assert.equal((await s.api('GET', `/cartes/${ANCIEN_ID}`, undefined, s.bearer(jeton))).contenu.acces.vue, 'complete', 'migrée avant la date : gardée')
      // La récupération (lien d'accès) fonctionne toujours.
      const lien = /acces=([\w.-]+)/.exec((await s.api('POST', `/commerces/${AH}/clients/${ANCIEN_ID}/lien-acces`, undefined, PIN)).contenu.lien)![1]
      assert.equal((await s.api('POST', `/cartes/${ANCIEN_ID}/jeton`, { lien })).statut, 201)
    } finally {
      s.horloge.t = new Date(2026, 10, 12, 12, 0)
    }
  })
})

describe('P0-S7 : récupération sans oracle, anti-bruteforce persistant', () => {
  test('« Retrouver ma carte » : même 202 pour tous ; seul le titulaire reçoit un lien d’accès à usage unique (24 h)', async () => {
    const appels: { url: string; corps: string }[] = []
    const fetchFaux = (async (url: string, init: RequestInit) => {
      appels.push({ url, corps: String(init.body) })
      return new Response(JSON.stringify({ messageId: `<m${appels.length}@brevo>` }), { status: 201 })
    }) as unknown as typeof globalThis.fetch
    const s = await demarrer('retrouver.db', { notifications: { brevo: { cleApi: 'cle-test', expediteurEmail: 'contact@exemple.fr', expediteurNom: 'Asian Home Paris' }, fetch: fetchFaux } })
    try {
      const { client } = await s.inscrire('marc@exemple.fr')
      const connu = await s.api('POST', '/cartes/retrouver', { contact: 'Marc@Exemple.fr' })
      const inconnu = await s.api('POST', '/cartes/retrouver', { contact: 'personne@exemple.fr' })
      assert.deepEqual([connu.statut, connu.texte], [inconnu.statut, inconnu.texte])
      assert.deepEqual(connu.contenu, { ok: true, envoi: true })
      assert.ok(!connu.texte.includes(client.id))
      await s.app.relancesEnCours()
      assert.equal(appels.length, 1)
      const texte = JSON.parse(appels[0].corps).textContent as string
      const lien = new RegExp(`${SITE.replace(/\./g, '\\.')}/#/carte/${client.id}\\?acces=([\\w.-]+)`).exec(texte)?.[1]
      assert.ok(lien, texte)
      assert.equal(lireJetonClient(SECRET, lien!)?.typ, 'lien')
      assert.equal((await s.api('POST', `/cartes/${client.id}/jeton`, { lien })).statut, 201)
      assert.equal((await s.api('POST', `/cartes/${client.id}/jeton`, { lien })).statut, 401, 'usage unique')
    } finally {
      await s.app.fermer()
    }
  })

  test('30 preuves fausses depuis une IP → 429, compté dans tentatives_auth (portée client) ; le PIN du gérant n’est pas bloqué', async () => {
    const s = await demarrer('bruteforce.db')
    try {
      const { client, jeton } = await s.inscrire('0612121212')
      for (let i = 0; i < 30; i++) assert.equal((await s.api('GET', `/cartes/${client.id}`, undefined, s.bearer(falsifier(jeton)))).statut, 401)
      const bloque = await s.api('GET', `/cartes/${client.id}`, undefined, s.bearer(jeton))
      assert.equal(bloque.statut, 429)
      assert.ok(Number(bloque.entetes.get('retry-after')) > 500)
      assert.match(bloque.contenu.erreur, /tentatives d’accès à une carte/)
      assert.equal((await s.api('GET', `/cartes/${nouvelIdClient()}`)).statut, 429, 'énumération bloquée aussi')
      assert.equal((await s.api('GET', `/commerces/${AH}/etat`, undefined, PIN)).statut, 200, 'compteur séparé des PIN')
      const st = ouvrirStockage(s.fichierDb)
      try {
        const t = st.tentativesAuth('client-ip:127.0.0.1')
        assert.equal(t?.portee, 'client')
        assert.equal(t?.echecs, 30)
        assert.ok(t?.bloqueJusqua)
      } finally {
        st.fermer()
      }
      // Le blocage survit au redémarrage (base).
      await s.app.fermer()
      const r = await demarrer('bruteforce.db')
      try {
        assert.equal((await r.api('GET', `/cartes/${client.id}`, undefined, r.bearer(jeton))).statut, 429)
      } finally {
        await r.app.fermer()
      }
    } catch (e) {
      await s.app.fermer().catch(() => {})
      throw e
    }
  })

  test('identifiants devinés (cartes inconnues) : comptés comme échecs', async () => {
    const s = await demarrer('enumeration.db')
    try {
      for (let i = 0; i < 30; i++) assert.equal((await s.api('GET', `/cartes/cl-mh8v2k3p-${i.toString(36).padStart(4, '0')}`)).statut, 404)
      assert.equal((await s.api('GET', '/cartes/cl-mh8v2k3p-zzzz')).statut, 429)
    } finally {
      await s.app.fermer()
    }
  })
})

describe('P0-S7 : mode transition (défaut) et configuration', () => {
  test('transition : jetons émis et honorés, mais l’accès d’avant P0-S7 reste admis et il est compté', async () => {
    const s = await demarrer('transition.db', { authClient: undefined })
    try {
      const { client, jeton } = await s.inscrire('0613131313')
      assert.ok(jeton, 'nouvelle carte : jeton quand même')
      const existant = await s.api('POST', `/commerces/${AH}/clients`, { contact: '0613131313' })
      assert.equal(existant.statut, 200)
      assert.equal(existant.contenu.client.id, client.id)
      assert.equal(existant.contenu.jeton, undefined, 'jamais de jeton pour un contact existant')
      assert.equal((await s.api('GET', `/cartes/${client.id}`)).contenu.acces.vue, 'complete')
      await s.visite(client.id)
      assert.equal((await s.api('POST', `/commerces/${AH}/tirages`, { contact: '0613131313' })).statut, 201)
      assert.equal((await s.api('GET', `/cartes/${client.id}`, undefined, s.bearer(falsifier(jeton)))).statut, 401, 'un jeton présent est toujours vérifié')
      const sante = (await s.api('GET', '/sante/acces-client')).contenu
      assert.equal(sante.mode, 'transition')
      assert.ok(sante.accesSansJeton >= 3)
    } finally {
      await s.app.fermer()
    }
  })

  test('strict sans SESSION_SECRET : démarrage refusé ; transition sans secret : pas de jeton, comme avant', async () => {
    await assert.rejects(() => creerServeur({ fichierDb: join(dossier, 'sans-secret.db'), adminPin: ADMIN, pinInitial: '1234', authClient: 'stricte' }), /SESSION_SECRET/)
    const s = await demarrer('sans-secret-transition.db', { authClient: 'transition', secretSession: undefined })
    try {
      const r = await s.api('POST', `/commerces/${AH}/clients`, { contact: '0614141414' })
      assert.equal(r.statut, 201)
      assert.equal(r.contenu.jeton, undefined)
      assert.equal((await s.api('POST', `/cartes/${r.contenu.client.id}/jeton`, {})).statut, 503)
    } finally {
      await s.app.fermer()
    }
  })
})

describe('P0-S7 : migration 0009 aller / retour sur Postgres (PGlite)', () => {
  const MIGRATIONS = join(import.meta.dirname, '..', 'supabase', 'migrations')
  const sql = (nom: string) => readFileSync(join(MIGRATIONS, nom), 'utf8')
  let db: PGlite
  const tentative = (cle: string, portee: string) =>
    db.query(`insert into public.tentatives_auth (cle, portee, echecs, bloque_jusqu_a, derniere_tentative) values ($1, $2, 1, null, now())`, [cle, portee])
  async function code(p: Promise<unknown>): Promise<string> {
    try {
      await p
    } catch (e) {
      return (e as { code?: string }).code ?? String(e)
    }
    return 'ok'
  }

  before(async () => {
    db = new PGlite()
    await db.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;')
    for (const f of ['0001_schema_initial', '0002_rls', '0003_cartiz', '0004_programme', '0005_sessions_revoquees', '0006_tentatives_auth', '0007_relances', '0008_mesure']) await db.exec(sql(`${f}.sql`))
  })
  after(() => db.close())

  test('avant 0009 : portée « client » refusée ; après : acceptée, rejouable, données gardées, RLS / droits inchangés', async () => {
    await tentative('ip:1', 'commerce')
    assert.equal(await code(tentative('client-ip:1', 'client')), '23514')
    await db.exec(sql('0009_auth_client.sql'))
    await db.exec(sql('0009_auth_client.sql'))
    assert.equal(await code(tentative('client-ip:1', 'client')), 'ok')
    assert.equal(await code(tentative('x', 'pigeon')), '23514', 'toujours une liste fermée')
    assert.deepEqual((await db.query<{ cle: string }>('select cle from public.tentatives_auth order by cle')).rows.map((r) => r.cle), ['client-ip:1', 'ip:1'])
    const rls = await db.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'tentatives_auth'`)
    assert.deepEqual(rls.rows.map((r) => r.relrowsecurity), [true])
    assert.equal((await db.query<{ n: number }>(`select count(*)::int as n from pg_policies where schemaname = 'public'`)).rows[0].n, 0)
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await db.query<{ ok: boolean }>(`select has_table_privilege($1, 'public.tentatives_auth', 'select') or has_table_privilege($1, 'public.tentatives_auth', 'insert') as ok`, [role])
      assert.equal(rows[0].ok, false, role)
    }
  })

  test('marqueur auth_client_active() : service_role seulement', async () => {
    for (const role of ['anon', 'authenticated', 'public']) {
      const { rows } = await db.query<{ ok: boolean }>(`select has_function_privilege($1, 'public.auth_client_active()', 'execute') as ok`, [role])
      assert.equal(rows[0].ok, false, role)
    }
    await db.exec('set role service_role')
    try {
      assert.deepEqual((await db.query<{ v: boolean }>('select public.auth_client_active() as v')).rows, [{ v: true }])
    } finally {
      await db.exec('reset role')
    }
    await db.exec('set role anon')
    try {
      assert.equal(await code(db.query('select public.auth_client_active()')), '42501')
    } finally {
      await db.exec('reset role')
    }
  })

  test('DOWN : compteurs « client » seuls retirés, contrainte et fonction d’origine rétablies ; rejouable ; ré-application OK', async () => {
    await db.query(`insert into public.meta (cle, valeur) values ('acces_client:c1:k1', '3')`)
    await db.exec(sql('0009_auth_client.down.sql'))
    await db.exec(sql('0009_auth_client.down.sql'))
    assert.deepEqual((await db.query<{ cle: string }>('select cle from public.tentatives_auth order by cle')).rows.map((r) => r.cle), ['ip:1'])
    assert.equal(await code(tentative('client-ip:2', 'client')), '23514')
    assert.equal((await db.query(`select 1 from pg_proc where proname = 'auth_client_active'`)).rows.length, 0)
    assert.deepEqual((await db.query<{ valeur: string }>(`select valeur from public.meta where cle = 'acces_client:c1:k1'`)).rows, [{ valeur: '3' }], 'versions d’accès gardées')
    await db.exec(sql('0009_auth_client.sql'))
    assert.equal(await code(tentative('client-ip:2', 'client')), 'ok')
  })
})

describe('P0-S7 : stockage Supabase sans / avec la migration 0009', () => {
  function supabase(appliquee: boolean) {
    const faux = (async (url: string | URL) => {
      const u = String(url)
      const json = (statut: number, corps: unknown) => new Response(JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/json' } })
      if (u.includes('/rpc/auth_client_active')) return appliquee ? json(200, true) : json(404, { code: 'PGRST202', message: 'Could not find the function public.auth_client_active' })
      if (u.includes('/tentatives_auth') && !appliquee) return json(400, { code: '23514', message: 'new row violates check constraint "tentatives_auth_portee_check"' })
      return json(200, [])
    }) as unknown as typeof fetch
    return ouvrirStockageSupabase({ url: 'https://projet-test.supabase.co', cleServiceRole: 'cle-de-test', fetch: faux })
  }

  test('marqueur absent → false ; portée « client » refusée (23514) → ErreurMigrationManquante 0009 (le serveur compte alors en mémoire)', async () => {
    const st = supabase(false)
    assert.equal(await st.schemaAuthClient(), false)
    await assert.rejects(
      async () => st.enregistrerTentativesAuth({ cle: 'client-ip:1', portee: 'client', echecs: 1, bloqueJusqua: null, derniereTentative: new Date().toISOString() }, new Date(0).toISOString()),
      (e: Error) => e instanceof ErreurMigrationManquante && /0009_auth_client\.sql/.test(e.message),
    )
    assert.equal(await supabase(true).schemaAuthClient(), true)
  })
})

describe('P0-S7 : front — jetons rangés sur le téléphone, API qui les porte', () => {
  function stockage() {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }
  }

  test('memoireJetons : lu tant que valable, effacé à l’expiration ; renouvellement sous 15 jours ; repli sans stockage', () => {
    let t = new Date('2026-11-12T12:00:00Z')
    const s = stockage()
    const j = memoireJetons(s, () => t)
    j.ecrire('cl-a', { jeton: 'v1.x.y', expireLe: '2026-12-12T12:00:00Z' })
    assert.deepEqual(j.lire('cl-a'), { jeton: 'v1.x.y', expireLe: '2026-12-12T12:00:00Z' })
    assert.equal(j.aRenouveler(j.lire('cl-a')!), false)
    t = new Date(Date.parse('2026-12-12T12:00:00Z') - RENOUVELER_AVANT_MS + 1000)
    assert.equal(j.aRenouveler(j.lire('cl-a')!), true)
    t = new Date('2026-12-13T00:00:00Z')
    assert.equal(j.lire('cl-a'), null)
    assert.equal(s.m.size, 0, 'expiré : effacé')
    const sansStockage = memoireJetons(null, () => new Date('2026-11-12T12:00:00Z'))
    sansStockage.ecrire('cl-b', { jeton: 'v1.b.b', expireLe: '2026-12-12T12:00:00Z' })
    assert.equal(sansStockage.lire('cl-b')?.jeton, 'v1.b.b', 'repli en mémoire')
    sansStockage.ecrire('cl-b', null)
    assert.equal(sansStockage.lire('cl-b'), null)
  })

  test('adresse de la carte : identifiant, lien d’accès, adresse nettoyée', () => {
    assert.equal(idCarteDuParam('cl-abc?acces=v1.x.y'), 'cl-abc')
    assert.equal(idCarteDuParam(undefined), undefined)
    assert.equal(lienAccesDuHash('#/carte/cl-abc?acces=v1.x-_.y'), 'v1.x-_.y')
    assert.equal(lienAccesDuHash('#/carte/cl-abc'), null)
    assert.equal(hashSansLienAcces('https://s.fr/#/carte/cl-abc?acces=v1.x.y'), 'https://s.fr/#/carte/cl-abc')
  })

  test('avecJetonClient : chaque appel « carte » porte le jeton de SA carte ; le tirage, celui du joueur actif', async () => {
    const vus: string[] = []
    const faux = new Proxy({} as ClientApi, {
      get: (_c, nom: string) => (...args: unknown[]) => (vus.push(`${nom}:${args.at(-1) ?? '∅'}`), Promise.resolve({})),
    })
    const s = stockage()
    const jetons = memoireJetons(s, () => new Date('2026-11-12T12:00:00Z'))
    jetons.ecrire('cl-a', { jeton: 'JA', expireLe: '2026-12-12T12:00:00Z' })
    const api = avecJetonClient(faux, jetons, () => 'cl-a')
    await api.carte('cl-a')
    await api.carte('cl-b')
    await api.tirer(AH, '0612345678', 'Lina')
    await api.prenomCarte(AH, 'cl-a', '0612345678', 'Lina')
    await api.messagePrive(AH, 'cl-a', '0612345678', 2, 'Bof')
    await api.marquerLus('cl-a')
    await api.profil(AH, 'cl-a', { platPrefere: 'Nems' })
    await api.declarerRattrapage(AH, 'cl-a', { date: 'x', montantCentimes: 1 })
    await api.donneesCarte('cl-a', '06')
    await api.demanderSuppression('cl-a', '06')
    assert.deepEqual(vus, ['carte:JA', 'carte:∅', 'tirer:JA', 'prenomCarte:JA', 'messagePrive:JA', 'marquerLus:JA', 'profil:JA', 'declarerRattrapage:JA', 'donneesCarte:JA', 'demanderSuppression:JA'])
  })

  test('assurerJetonClient : lien échangé, renouvellement, ancienne carte (une seule tentative), carte neuve sans preuve', async () => {
    const demandes: string[] = []
    let refuser = false
    const api = {
      jetonCarte: async (clientId: string, preuve: { jeton?: string | null; lien?: string } = {}) => {
        demandes.push(`${clientId}:${preuve.lien ? 'lien' : preuve.jeton ? 'jeton' : 'rien'}`)
        if (refuser) throw new ErreurApi(401, 'refusé')
        return { jeton: `J-${demandes.length}`, expireLe: '2026-12-12T12:00:00Z', clientId, commerceId: AH }
      },
    }
    let t = new Date('2026-11-12T12:00:00Z')
    const jetons = memoireJetons(stockage(), () => t)
    const neuve = nouvelIdClient()
    assert.deepEqual(await assurerJetonClient(api, jetons, neuve, { lien: 'v1.l.l' }), { jeton: 'J-1', lienRefuse: false })
    assert.deepEqual(await assurerJetonClient(api, jetons, neuve), { jeton: 'J-1', lienRefuse: false }, 'gardé, pas de requête')
    t = new Date('2026-12-01T12:00:00Z')
    assert.equal((await assurerJetonClient(api, jetons, neuve)).jeton, 'J-2', 'renouvelé')
    refuser = true
    t = new Date('2026-12-05T12:00:00Z')
    assert.equal((await assurerJetonClient(api, jetons, neuve)).jeton, null, 'révoqué : oublié')
    assert.equal(jetons.lire(neuve), null)
    assert.deepEqual(await assurerJetonClient(api, jetons, neuve, { lien: 'v1.vieux' }), { jeton: null, lienRefuse: true })
    const n = demandes.length
    assert.equal((await assurerJetonClient(api, jetons, nouvelIdClient())).jeton, null)
    assert.equal(demandes.length, n, 'carte neuve sans preuve : aucune demande')
    refuser = false
    const essais = new Set<string>()
    assert.equal((await assurerJetonClient(api, jetons, ANCIEN_ID, { dejaEssaye: essais })).jeton, `J-${n + 1}`, 'ancienne carte : jeton de grâce')
    jetons.ecrire(ANCIEN_ID, null)
    assert.equal((await assurerJetonClient(api, jetons, ANCIEN_ID, { dejaEssaye: essais })).jeton, null, 'une seule tentative par affichage')
  })

  test('client du front contre le vrai serveur strict : inscription → jeton → vue complète, vue limitée sans', async () => {
    const s = await demarrer('front.db')
    try {
      const api = creerClientApi(`${s.racine}/api/v1`)
      const { client, jeton } = await api.inscrirePublic(AH, '', '0615151515')
      assert.ok(jeton)
      const complete = await api.carte(client.id, jeton)
      const limitee = await api.carte(client.id)
      assert.equal(estVueLimitee(complete), false)
      assert.equal(estVueLimitee(limitee), true)
      await assert.rejects(api.tirer(AH, '0615151515'), (e: ErreurApi) => e.statut === 401)
      await assert.rejects(api.inscrirePublic(AH, '', '0615151515'), (e: ErreurApi) => e.statut === 409)
      const lien = await api.lienAccesCarte(AH, { role: 'commerce', commerceId: AH, pin: '1234' }, client.id)
      const echange = await api.jetonCarte(client.id, { lien: /acces=([\w.-]+)/.exec(lien.lien)![1] })
      assert.equal(echange.clientId, client.id)
      assert.deepEqual(await api.revoquerCarte(client.id, echange.jeton), { ok: true })
      await assert.rejects(api.carte(client.id, jeton), (e: ErreurApi) => e.statut === 401)
    } finally {
      await s.app.fermer()
    }
  })
})

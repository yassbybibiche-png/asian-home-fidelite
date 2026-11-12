// Roue v2 R3 — cycle de vie du gain (utilisable de J+1 à J+30) et code burn-on-reveal (fenêtre de 10 minutes après
// activation par le titulaire). Fonctions pures (src/lib/roulette.ts, src/data/jeuApi.ts) puis vrai serveur HTTP sur une
// base SQLite temporaire, mode strict, horloge pilotée.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import type { Client, Tirage } from '../src/types.ts'
import { ErreurApi } from '../src/data/api.ts'
import { activerCode } from '../src/data/jeuApi.ts'
import {
  cycleGain, fenetreActive, finActivation, finGain, FENETRE_ACTIVATION_MS, gainEnCours, instantParis, jourEnClair, MESSAGE_ACTIVATION, messageGain,
  refusActivation, statutGain, utilisableLe,
} from '../src/lib/roulette.ts'
import { codeEnBase } from './code-en-base.ts'

const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const CODE_EQUIPE = { 'X-Equipe-Code': '2468' }
const SECRET = 'secret-de-test-r3-cycle-gain-au-moins-32-caracteres-0123'
const LARGES = { inscriptionParIp: 1000, inscriptionParContact: 1000, ficheClientParIp: 1000, lectureParIp: 1000, lectureParCarte: 1000, tirageParIp: 1000, tirageParContact: 1000 }

/**
 * Tirage gagné le mardi 10 novembre 2026 à 9 h, heure de PARIS (revue Codex R3 F3 : les bornes sont des jours parisiens,
 * quel que soit le fuseau du processus) : J = 10/11, J+1 = 11/11, J+30 = 10/12, J+31 = 11/12.
 */
const J = instantParis(2026, 11, 10, 9, 0)
const gain: Tirage = { id: 'ti-1', commerceId: AH, clientId: 'c', lot: 'Nems offerts', lotId: 'lot-nems', typeLot: 'lot', date: J.toISOString(), code: 'ABCD23' }
const le = (jour: number, h = 0, min = 0) => instantParis(2026, 11, 10 + jour, h, min)

describe('R3 : cycle de vie (fonctions pures)', () => {
  test('matrice par date : J → enAttente ; J+1 → utilisable ; J+30 (fin de journée) → utilisable ; J+31 → expire', () => {
    const cas: [Date, string][] = [
      [le(0, 9, 1), 'enAttente'],
      [le(0, 23, 59), 'enAttente'],
      [le(1, 0, 0), 'utilisable'],
      [le(15, 12), 'utilisable'],
      [le(30, 0, 0), 'utilisable'],
      [new Date(le(31).getTime() - 1), 'utilisable'],
      [le(31, 0, 0), 'expire'],
      [le(60), 'expire'],
    ]
    for (const [quand, attendu] of cas) assert.equal(cycleGain(gain, quand), attendu, quand.toString())
    assert.equal(utilisableLe(gain).getTime(), le(1).getTime())
    assert.equal(finGain(gain).getTime(), le(31).getTime())
  })

  test('statut v2 : « utilisable » exige une fenêtre d’activation de moins de 10 minutes, sinon « inactif »', () => {
    assert.equal(statutGain(gain, le(1, 12)), 'inactif', 'jamais activé')
    const active = { ...gain, activeLe: le(1, 12).toISOString() }
    assert.equal(statutGain(active, le(1, 12)), 'utilisable')
    assert.equal(statutGain(active, le(1, 12, 9)), 'utilisable', '9 min')
    assert.equal(statutGain(active, le(1, 12, 10)), 'inactif', '10 min : échue')
    assert.equal(statutGain(active, le(1, 12, 11)), 'inactif', '11 min')
    assert.equal(statutGain(active, le(1, 11, 59)), 'inactif', 'activation dans le futur : ignorée')
    assert.equal(finActivation(active), new Date(le(1, 12).getTime() + FENETRE_ACTIVATION_MS).toISOString())
    assert.equal(finActivation(gain), null)
    assert.equal(fenetreActive(active, le(1, 12, 5)), true)
    // Le jour J et après J+30, l'activation ne change rien ; remis l'emporte toujours.
    assert.equal(statutGain({ ...gain, activeLe: le(0, 9, 30).toISOString() }, le(0, 9, 31)), 'enAttente')
    assert.equal(statutGain({ ...gain, activeLe: le(31).toISOString() }, le(31, 0, 1)), 'expire')
    assert.equal(statutGain({ ...active, remis: { le: le(1, 12, 1).toISOString(), par: { type: 'membre', nom: 'Mai' } } }, le(1, 12, 2)), 'remis')
    // Points / perdant : jamais de cycle.
    assert.equal(statutGain({ ...gain, typeLot: 'points' }, le(1)), 'consolation')
    assert.equal(statutGain({ ...gain, typeLot: 'perdant' }, le(1)), 'perdant')
    assert.deepEqual((['enAttente', 'utilisable', 'inactif', 'remis', 'expire', 'perdant', 'consolation'] as const).filter(gainEnCours), ['enAttente', 'utilisable', 'inactif'])
  })


  test('messages caisse v2 (maquettes §4) et refus d’activation vus par le client', () => {
    const base = { lot: 'Nems offerts', date: gain.date, remis: null }
    assert.equal(messageGain({ ...base, statut: 'utilisable' }), 'Gain à remettre : Nems offerts (gagné le mar. 10 nov. 2026).')
    assert.equal(messageGain({ ...base, statut: 'enAttente' }), 'Pas encore utilisable : ce gain gagné le mar. 10 nov. 2026 s’utilise à partir du mer. 11 nov. 2026.')
    assert.equal(messageGain({ ...base, statut: 'expire' }), 'Gain expiré le jeu. 10 déc. 2026 : rien à remettre.')
    assert.equal(messageGain({ ...base, statut: 'inactif' }), MESSAGE_ACTIVATION)
    assert.match(MESSAGE_ACTIVATION, /« Utiliser mon gain ».*10 minutes après activation/)
    assert.equal(messageGain({ ...base, lot: '+10 points', statut: 'consolation' }), 'Ce tirage n’a pas de lot à remettre (+10 points).')

    assert.deepEqual(refusActivation(gain, le(0, 12)), { statut: 409, message: `Votre gain sera utilisable dès demain, ${jourEnClair(le(1))}, et jusqu’au ${jourEnClair(le(30))}.` })
    assert.equal(refusActivation(gain, le(1)), null)
    assert.equal(refusActivation(gain, le(30, 23, 59)), null)
    assert.equal(refusActivation(gain, le(31))?.statut, 410)
    assert.equal(refusActivation({ ...gain, remis: { le: '', par: { type: 'membre', nom: 'Mai' } } }, le(1))?.statut, 409)
    assert.equal(refusActivation({ ...gain, typeLot: 'perdant' }, le(1))?.statut, 409)
    assert.equal(refusActivation({ ...gain, code: undefined }, le(1))?.statut, 409, 'sans code : rien à activer')
  })
})

describe('R3 : jeuApi.activerCode (client du front)', () => {
  const jetons = (j: string | null) => ({ lire: () => (j ? { jeton: j, expireLe: '2099-01-01T00:00:00Z' } : null) })
  const cible = { commerceId: AH, clientId: 'c', tirageId: 'ti-1' }

  test('jeton de la carte transmis ; code et fin de fenêtre rendus', async () => {
    const appels: unknown[] = []
    const api = {
      activerCode: async (...a: unknown[]) => {
        appels.push(a)
        return { tirageId: 'ti-1', lot: 'Nems offerts', code: 'ABCD23', activeLe: 'x', expireActivation: 'y' }
      },
    }
    const r = await activerCode(api, jetons('jeton-c'), cible)
    assert.deepEqual(appels, [[AH, 'ti-1', 'jeton-c']])
    assert.ok(r.ok && r.activation.code === 'ABCD23')
  })

  test('sans jeton sur ce téléphone : aucun appel, accès refusé ; 409/410 → refus lisible ; 401 → accès refusé ; réseau → hors ligne', async () => {
    let appele = false
    const sans = await activerCode({ activerCode: async () => ((appele = true), null as never) }, jetons(null), cible)
    assert.equal(appele, false)
    assert.ok(!sans.ok && sans.accesRefuse)
    for (const [statut, refus] of [[409, true], [410, true], [401, false]] as const) {
      const r = await activerCode({ activerCode: async () => Promise.reject(new ErreurApi(statut, `refus ${statut}`)) }, jetons('j'), cible)
      assert.ok(!r.ok)
      assert.equal(r.refus, refus, String(statut))
      assert.equal(r.message, `refus ${statut}`)
      assert.equal(!!r.accesRefuse, statut === 401)
    }
    const reseau = await activerCode({ activerCode: async () => Promise.reject(new TypeError('fetch failed')) }, jetons('j'), cible)
    assert.ok(!reseau.ok && reseau.horsLigne)
  })
})

describe('R3 : serveur (SQLite, mode strict)', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-r3-'))
  const horloge = { t: le(0, 12) }
  let app: Awaited<ReturnType<typeof creerServeur>>
  let racine = ''
  let numeroIp = 0

  type Reponse = { statut: number; contenu: any; texte: string }
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}): Promise<Reponse> {
    const r = await fetch(`${racine}/api/v1${chemin}`, {
      method: methode,
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${++numeroIp % 250}`, ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    const texte = await r.text()
    let contenu: unknown = texte
    try {
      contenu = JSON.parse(texte)
    } catch {
      // Texte brut
    }
    return { statut: r.status, contenu, texte }
  }
  const bearer = (jeton: string) => ({ Authorization: `Bearer ${jeton}` })
  const gains = (code: string) => `/commerces/${AH}/caisse/gains/${code}`
  const activer = (tirageId: string, jeton: string) => api('POST', `/commerces/${AH}/tirages/${tirageId}/activer`, undefined, bearer(jeton))

  /** Joueur inscrit (page de jeu), visite validée, roue tournée avec son jeton ; code lu en base (revue Codex R3 F1). */
  async function joueur(contact: string) {
    const ins = await api('POST', `/commerces/${AH}/clients`, { contact })
    assert.equal(ins.statut, 201, ins.texte)
    const { client, jeton } = ins.contenu as { client: Client; jeton: string }
    assert.equal((await api('POST', `/commerces/${AH}/clients/${client.id}/visite`, undefined, PIN)).statut, 200)
    const t = await api('POST', `/commerces/${AH}/tirages`, {}, bearer(jeton))
    assert.equal(t.statut, 201, t.texte)
    const tirageId = t.contenu.tirageId as string
    return { client, jeton, reponse: t, tirageId, code: codeEnBase(join(dossier, 'r3.db'), tirageId)!, date: t.contenu.date as string }
  }

  before(async () => {
    app = await creerServeur({
      fichierDb: join(dossier, 'r3.db'),
      adminPin: '98765432',
      pinInitial: '1234',
      version: 'test',
      secretSession: SECRET,
      authClient: 'stricte',
      derriereProxy: true,
      maintenant: () => horloge.t,
      limitesPubliques: LARGES,
    })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
    assert.equal((await api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)).statut, 201)
    // Prix et probabilités du commerce non modifiés ailleurs : ce commerce de test tire toujours le même lot physique.
    assert.equal((await api('PATCH', `/commerces/${AH}`, { lots: [{ libelle: 'Nems offerts', probabilite: 100 }] }, PIN)).statut, 200)
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('le code n’apparaît dans AUCUNE réponse publique : tirage, commerce public, carte (avec ou sans jeton), avant et après activation', async () => {
    horloge.t = le(0, 12)
    const j = await joueur('0610000001')
    assert.equal(j.reponse.contenu.code, undefined)
    assert.ok(!j.reponse.texte.includes(j.code), 'réponse du POST tirage')
    const publiques = async () => [
      // Revue Codex R3 (F1) : l'état commerçant et l'export CSV du client ne le portent pas non plus.
      await api('GET', `/commerces/${AH}/etat`, undefined, PIN),
      await api('GET', `/commerces/${AH}/clients/${j.client.id}/export.csv`, undefined, PIN),
      await api('POST', `/cartes/${j.client.id}/donnees`, { contact: '0610000001' }, bearer(j.jeton)),
      await api('GET', '/commerces'),
      await api('GET', `/commerces/${AH}`),
      await api('GET', `/commerces/${AH}/menu`),
      await api('GET', `/cartes/${j.client.id}`),
      await api('GET', `/cartes/${j.client.id}`, undefined, bearer(j.jeton)),
    ]
    for (const r of await publiques()) assert.ok(!r.texte.includes(j.code), r.texte.slice(0, 120))
    horloge.t = le(1, 12)
    assert.equal((await activer(j.tirageId, j.jeton)).contenu.code, j.code, 'seule l’activation sert le code')
    for (const r of await publiques()) assert.ok(!r.texte.includes(j.code), 'pas même après activation')
  })

  test('activation : refusée avant J+1 (409 « dès demain ») ; J+1 → code + fin de fenêtre (10 min) ; la carte liste le gain sans code', async () => {
    horloge.t = le(0, 12)
    const j = await joueur('0610000002')
    const carteJ = await api('GET', `/cartes/${j.client.id}`, undefined, bearer(j.jeton))
    assert.deepEqual(carteJ.contenu.gainsEnCours, [
      { tirageId: j.tirageId, lot: 'Nems offerts', date: j.date, statut: 'enAttente', utilisableLe: le(1).toISOString(), expireLe: le(31).toISOString(), expireActivation: null },
    ])
    const tot = await activer(j.tirageId, j.jeton)
    assert.equal(tot.statut, 409)
    assert.match(tot.contenu.erreur, /dès demain/)
    assert.ok(!tot.texte.includes(j.code))
    assert.equal((await api('GET', gains(j.code), undefined, CODE_EQUIPE)).contenu.gain.statut, 'enAttente')
    const remiseTot = await api('POST', `${gains(j.code)}/remise`, undefined, CODE_EQUIPE)
    assert.equal(remiseTot.statut, 409)
    assert.match(remiseTot.contenu.erreur, /Pas encore utilisable/)

    horloge.t = le(1, 9)
    assert.equal((await api('GET', `/cartes/${j.client.id}`, undefined, bearer(j.jeton))).contenu.gainsEnCours[0].statut, 'inactif')
    const ok = await activer(j.tirageId, j.jeton)
    assert.equal(ok.statut, 200, ok.texte)
    assert.deepEqual(ok.contenu, { tirageId: j.tirageId, lot: 'Nems offerts', code: j.code, activeLe: le(1, 9).toISOString(), expireActivation: le(1, 9, 10).toISOString() })
    const carte = await api('GET', `/cartes/${j.client.id}`, undefined, bearer(j.jeton))
    assert.deepEqual([carte.contenu.gainsEnCours[0].statut, carte.contenu.gainsEnCours[0].expireActivation], ['utilisable', le(1, 9, 10).toISOString()])
    assert.ok(!carte.texte.includes(j.code))
  })

  test('fenêtre : vérif caisse OK dans les 10 min ; échue (11 min) → « inactif » + message d’activation, remise 409 ; ré-activation OK puis remise ; double remise 409', async () => {
    horloge.t = le(0, 12)
    const j = await joueur('0610000003')
    horloge.t = le(2, 18)
    const sans = await api('GET', gains(j.code), undefined, CODE_EQUIPE)
    assert.equal(sans.contenu.gain.statut, 'inactif', 'utilisable mais jamais activé')
    assert.equal((await activer(j.tirageId, j.jeton)).statut, 200)
    horloge.t = le(2, 18, 4)
    const dedans = await api('GET', gains(j.code), undefined, CODE_EQUIPE)
    assert.deepEqual([dedans.statut, dedans.contenu.gain.statut], [200, 'utilisable'])
    assert.equal(messageGain(dedans.contenu.gain), `Gain à remettre : Nems offerts (gagné le ${jourEnClair(le(0))}).`)

    horloge.t = le(2, 18, 11)
    const echue = await api('GET', gains(j.code), undefined, CODE_EQUIPE)
    assert.equal(echue.contenu.gain.statut, 'inactif')
    assert.equal(messageGain(echue.contenu.gain), MESSAGE_ACTIVATION)
    const horsFenetre = await api('POST', `${gains(j.code)}/remise`, undefined, CODE_EQUIPE)
    assert.equal(horsFenetre.statut, 409, 'remise hors fenêtre refusée')
    assert.equal(horsFenetre.contenu.erreur, MESSAGE_ACTIVATION)
    assert.equal((await api('GET', gains(j.code), undefined, CODE_EQUIPE)).contenu.gain.remis, null, 'rien n’est écrit')

    // Le client ré-appuie : nouvelle fenêtre (l'activation précédente est écrasée).
    const re = await activer(j.tirageId, j.jeton)
    assert.equal(re.statut, 200)
    assert.equal(re.contenu.activeLe, le(2, 18, 11).toISOString())
    const remise = await api('POST', `${gains(j.code)}/remise`, undefined, CODE_EQUIPE)
    assert.equal(remise.statut, 200, remise.texte)
    assert.equal(remise.contenu.gain.statut, 'remis')
    const double = await api('POST', `${gains(j.code)}/remise`, undefined, PIN)
    assert.equal(double.statut, 409)
    assert.match(double.contenu.erreur, /déjà remis/)
    const apres = await activer(j.tirageId, j.jeton)
    assert.equal(apres.statut, 409, 'plus d’activation après la remise')
    assert.ok(!apres.texte.includes(j.code))
    const carte = await api('GET', `/cartes/${j.client.id}`, undefined, bearer(j.jeton))
    assert.deepEqual(carte.contenu.gainsEnCours, [], 'remis : terminal')
  })

  test('J+30 : dernier jour utilisable ; J+31 : activation 410, caisse « expire », remise 410', async () => {
    horloge.t = le(0, 12)
    const j = await joueur('0610000004')
    // Le jeton client vaut 30 jours : le téléphone le renouvelle en ouvrant la carte (moins de 15 jours restants).
    horloge.t = le(20, 12)
    const renouvele = await api('POST', `/cartes/${j.client.id}/jeton`, {}, bearer(j.jeton))
    assert.equal(renouvele.statut, 201, renouvele.texte)
    j.jeton = renouvele.contenu.jeton
    horloge.t = le(30, 23, 50)
    assert.equal((await activer(j.tirageId, j.jeton)).statut, 200)
    assert.equal((await api('GET', gains(j.code), undefined, CODE_EQUIPE)).contenu.gain.statut, 'utilisable')
    // Fenêtre activée à 23 h 50 le dernier jour : à minuit, le gain expire quand même.
    horloge.t = le(31, 0, 1)
    const tard = await activer(j.tirageId, j.jeton)
    assert.equal(tard.statut, 410)
    assert.match(tard.contenu.erreur, /expiré/)
    assert.ok(!tard.texte.includes(j.code))
    const g = await api('GET', gains(j.code), undefined, CODE_EQUIPE)
    assert.equal(g.contenu.gain.statut, 'expire')
    const r = await api('POST', `${gains(j.code)}/remise`, undefined, CODE_EQUIPE)
    assert.equal(r.statut, 410)
    assert.equal(r.contenu.erreur, `Gain expiré le ${jourEnClair(le(30))} : rien à remettre.`)
    assert.deepEqual((await api('GET', `/cartes/${j.client.id}`, undefined, bearer(j.jeton))).contenu.gainsEnCours, [], 'expiré : terminal')
  })

  test('tirage d’un autre client ou inconnu : 404 sans code ; carte supprimée / jeton absent : 401', async () => {
    horloge.t = le(0, 12)
    const a = await joueur('0610000005')
    const b = await joueur('0610000006')
    horloge.t = le(1, 12)
    const autre = await activer(a.tirageId, b.jeton)
    assert.equal(autre.statut, 404)
    assert.ok(!autre.texte.includes(a.code))
    assert.equal((await activer('ti-inconnu', a.jeton)).statut, 404)
    assert.equal((await api('POST', `/commerces/${AH}/tirages/${a.tirageId}/activer`)).statut, 401)
    // Remise d'un code activé par son titulaire : la caisse ne l'accepte que pour CE tirage.
    assert.equal((await activer(b.tirageId, b.jeton)).statut, 200)
    assert.equal((await api('GET', gains(a.code), undefined, CODE_EQUIPE)).contenu.gain.statut, 'inactif', 'A n’a rien activé')
  })
})

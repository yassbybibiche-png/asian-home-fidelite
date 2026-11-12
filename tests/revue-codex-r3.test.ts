// Revue Codex du lot R3 (roue v2, cycle de vie du gain) — F1 : le code ne circule que par l'activation (ni export CSV,
// ni état commerçant) ; F2 : les tirages d'avant la roue v2 restent sous l'ancienne règle (le jour même, sans
// activation, expirés ensuite — pas de résurrection) ; F3 : bornes J+1 / J+30 en jours calendaires de Paris, quel que
// soit le fuseau du processus ; F4 : la remise vérifie la fenêtre à l'heure de l'ÉCRITURE (condition en base).
// Fonctions pures, stockage SQLite, puis vrai serveur HTTP (SQLite, mode strict, horloge pilotée). La remise sous
// stockage lent (Supabase) : tests/supabase.test.ts, « Revue Codex R3 ».
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { ouvrirStockage } from '../server/stockage.ts'
import type { Client, Tirage } from '../src/types.ts'
import { rattachementsTirages } from '../src/lib/lots.ts'
import { exportClientCsv } from '../src/lib/rgpd.ts'
import {
  cycleGain, debutDuJourParis, dernierJourGain, finGain, instantParis, jourEnClair, MESSAGE_ACTIVATION, MESSAGE_ANCIENNE_REGLE, messageGain, minuitParis,
  numeroJourParis, refusActivation, statutGain, tirageHerite, utilisableLe,
} from '../src/lib/roulette.ts'
import { nouveauClient } from '../src/lib/fidelite.ts'

const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const SECRET = 'secret-de-test-revue-r3-au-moins-32-caracteres-0123456789'
const LARGES = { inscriptionParIp: 1000, inscriptionParContact: 1000, ficheClientParIp: 1000, lectureParIp: 1000, lectureParCarte: 1000, tirageParIp: 1000, tirageParContact: 1000 }
const iso = (s: string) => new Date(s)

/** Gain v2 (type figé au tirage) gagné le mardi 10/11/2026 à 23 h 30, heure de Paris (22 h 30 UTC). */
const tardif: Tirage = { id: 'ti-tard', commerceId: AH, clientId: 'c', lot: 'Nems offerts', lotId: 'lot-nems', typeLot: 'lot', date: '2026-11-10T22:30:00.000Z', code: 'ABCD23' }
/** Tirage d'avant la roue v2 : ni type ni id de lot. */
const herite = (date: string, o: Partial<Tirage> = {}): Tirage => ({ id: 'ti-old', commerceId: AH, clientId: 'c', lot: 'Thé glacé', date, code: 'ZZZZ22', ...o })

describe('Revue Codex R3 F3 : bornes du gain en jours calendaires de Paris', () => {
  test('numéro de jour parisien et minuit à Paris : hiver, été, jours de changement d’heure (journées de 23 h et 25 h)', () => {
    assert.equal(numeroJourParis(iso('2026-11-10T22:59:59Z')), numeroJourParis(iso('2026-11-10T00:00:00Z')), '23 h 59 Paris : même jour')
    assert.equal(numeroJourParis(iso('2026-11-10T23:00:00Z')) - numeroJourParis(iso('2026-11-10T12:00:00Z')), 1, 'minuit Paris = 23 h UTC en hiver')
    assert.equal(numeroJourParis(iso('2026-07-01T22:00:00Z')) - numeroJourParis(iso('2026-07-01T21:59:59Z')), 1, 'minuit Paris = 22 h UTC en été')
    // Dimanche 25/10/2026 (retour à l'heure d'hiver, journée de 25 h) et dimanche 28/03/2027 (passage à l'heure d'été, 23 h).
    assert.equal(minuitParis(numeroJourParis(iso('2026-10-25T12:00:00Z'))).toISOString(), '2026-10-24T22:00:00.000Z')
    assert.equal(minuitParis(numeroJourParis(iso('2026-10-25T12:00:00Z')) + 1).toISOString(), '2026-10-25T23:00:00.000Z')
    assert.equal(minuitParis(numeroJourParis(iso('2027-03-28T12:00:00Z'))).toISOString(), '2027-03-27T23:00:00.000Z')
    assert.equal(minuitParis(numeroJourParis(iso('2027-03-28T12:00:00Z')) + 1).toISOString(), '2027-03-28T22:00:00.000Z')
    assert.equal(numeroJourParis(iso('2026-10-25T22:59:59Z')) - numeroJourParis(iso('2026-10-24T22:00:00Z')), 0, '25 h dans la même journée')
    assert.equal(instantParis(2026, 10, 25, 12).toISOString(), '2026-10-25T11:00:00.000Z', 'midi après le changement : UTC+1')
    assert.equal(instantParis(2027, 3, 28, 12).toISOString(), '2027-03-28T10:00:00.000Z', 'midi après le changement : UTC+2')
    // Même base que la borne des plafonds (R2).
    assert.equal(minuitParis(numeroJourParis(iso('2026-11-10T22:30:00Z'))).toISOString(), debutDuJourParis(iso('2026-11-10T22:30:00Z')))
  })

  test('cas de la revue : tirage le 10/11 à 23 h 30 Paris (22 h 30 UTC) → utilisable dès 00 h 00 Paris le 11/11, expiré à 00 h 00 Paris le 11/12 (pas 01 h 00)', () => {
    assert.equal(utilisableLe(tardif).toISOString(), '2026-11-10T23:00:00.000Z')
    assert.equal(finGain(tardif).toISOString(), '2026-12-10T23:00:00.000Z', 'minuit à Paris, pas minuit UTC (01 h 00 à Paris)')
    assert.equal(cycleGain(tardif, iso('2026-11-10T22:59:00Z')), 'enAttente', '23 h 59 Paris le jour J')
    assert.equal(cycleGain(tardif, iso('2026-11-10T23:10:00Z')), 'utilisable', '00 h 10 Paris le 11/11 : J+1 (encore le 10/11 en UTC)')
    assert.equal(cycleGain(tardif, iso('2026-12-10T22:59:59Z')), 'utilisable', '23 h 59 Paris le 10/12 : J+30')
    assert.equal(cycleGain(tardif, iso('2026-12-10T23:30:00Z')), 'expire', '00 h 30 Paris le 11/12 (23 h 30 UTC le 10/12)')
    assert.equal(refusActivation(tardif, iso('2026-12-10T23:30:00Z'))?.statut, 410)
    // Dates des messages au jour de Paris, même sur un processus en UTC.
    assert.equal(jourEnClair(dernierJourGain(tardif)), 'jeu. 10 déc. 2026')
    assert.equal(jourEnClair(utilisableLe(tardif)), 'mer. 11 nov. 2026')
    assert.equal(messageGain({ statut: 'expire', lot: 'Nems offerts', date: tardif.date, remis: null }), 'Gain expiré le jeu. 10 déc. 2026 : rien à remettre.')
  })

  test('changements d’heure : J+1 et fin de J+30 restent des minuits parisiens', () => {
    // Gagné le samedi 24/10/2026 à 23 h 30 (heure d'été) ; J+1 = dimanche du retour à l'heure d'hiver ; J+30 = 23/11.
    const automne: Tirage = { ...tardif, date: instantParis(2026, 10, 24, 23, 30).toISOString() }
    assert.equal(automne.date, '2026-10-24T21:30:00.000Z')
    assert.equal(utilisableLe(automne).toISOString(), '2026-10-24T22:00:00.000Z')
    assert.equal(finGain(automne).toISOString(), '2026-11-23T23:00:00.000Z')
    assert.equal(cycleGain(automne, iso('2026-11-23T22:59:00Z')), 'utilisable')
    assert.equal(cycleGain(automne, iso('2026-11-23T23:00:00Z')), 'expire')
    // Gagné le samedi 27/03/2027 à 20 h (heure d'hiver) ; J+1 = dimanche du passage à l'heure d'été ; J+30 = 26/04.
    const printemps: Tirage = { ...tardif, date: instantParis(2027, 3, 27, 20).toISOString() }
    assert.equal(utilisableLe(printemps).toISOString(), '2027-03-27T23:00:00.000Z')
    assert.equal(finGain(printemps).toISOString(), '2027-04-26T22:00:00.000Z')
    assert.equal(cycleGain(printemps, iso('2027-04-26T21:59:00Z')), 'utilisable')
    assert.equal(cycleGain(printemps, iso('2027-04-26T22:00:00Z')), 'expire')
  })
})

describe('Revue Codex R3 F2 : tirages d’avant la roue v2 — ancienne règle, pas de résurrection', () => {
  test('critère : pas de type figé au tirage, ou type posé après coup par le rattachement R1 (`typeDeduit`)', () => {
    assert.equal(tirageHerite(herite('2026-11-09T11:00:00Z')), true)
    assert.equal(tirageHerite(tardif), false)
    const [rattache] = rattachementsTirages([{ id: 'lot-the', type: 'lot', libelle: 'Thé glacé' }], [herite('2026-11-09T11:00:00Z')])
    assert.deepEqual([rattache.lotId, rattache.typeLot, rattache.typeDeduit], ['lot-the', 'lot', true])
    assert.equal(tirageHerite(rattache), true, 'le rattachement ne fait pas passer un ancien tirage au cycle v2')
    // Un tirage qui avait déjà son type (créé R1+) garde son type, sans marque.
    const [avecType] = rattachementsTirages([{ id: 'lot-the', type: 'lot', libelle: 'Thé glacé' }], [herite('2026-11-09T11:00:00Z', { typeLot: 'lot' })])
    assert.equal(avecType.typeDeduit, undefined)
  })

  test('hérité d’hier non remis → expiré, activation refusée (410) ; hérité du jour même → remisable directement, sans activation', () => {
    const midi = instantParis(2026, 11, 10, 12)
    const hier = herite(instantParis(2026, 11, 9, 12).toISOString())
    assert.equal(statutGain(hier, midi), 'expire', 'avant R3 : « valable le jour du tirage seulement »')
    assert.deepEqual(refusActivation(hier, midi), { statut: 410, message: `Gain expiré le lun. 9 nov. 2026 (${MESSAGE_ANCIENNE_REGLE}).` })
    assert.equal(messageGain({ statut: 'expire', lot: 'Thé glacé', date: hier.date, remis: null, ancienneRegle: true }), `Gain expiré le lun. 9 nov. 2026 : rien à remettre (${MESSAGE_ANCIENNE_REGLE}).`)
    // Même avec une activation (impossible par la route, mais par sécurité) ou rattaché : expiré quand même.
    assert.equal(statutGain({ ...hier, activeLe: midi.toISOString() }, midi), 'expire')
    assert.equal(statutGain({ ...hier, typeLot: 'lot', typeDeduit: true }, midi), 'expire')
    assert.equal(statutGain(hier, instantParis(2026, 11, 20, 12)), 'expire', 'jamais ressuscité dans la fenêtre J+30')

    const duJour = herite(instantParis(2026, 11, 10, 9).toISOString())
    assert.equal(statutGain(duJour, midi), 'utilisable', 'ancienne règle : à remettre le jour même, sans fenêtre d’activation')
    assert.equal(statutGain(duJour, instantParis(2026, 11, 10, 23, 59)), 'utilisable')
    assert.equal(statutGain(duJour, instantParis(2026, 11, 11, 0, 0)), 'expire', 'minuit à Paris')
    assert.equal(refusActivation(duJour, midi)?.statut, 409, 'jamais activable : il se retire directement')
    assert.match(refusActivation(duJour, midi)!.message, /directement au comptoir aujourd’hui/)
    assert.equal(statutGain({ ...duJour, remis: { le: midi.toISOString(), par: { type: 'gerant', nom: 'Gérant' } } }, midi), 'remis')
    // Perdant hérité (libellé) : toujours perdant.
    assert.equal(statutGain(herite(duJour.date, { lot: 'Pas de chance' }), midi), 'perdant')
  })
})

describe('Revue Codex R3 F1 : export CSV — le statut du gain, jamais le code', () => {
  test('client et commerçant : même fonction, statut à la date de l’export, aucun code', () => {
    const client: Client = { ...nouveauClient(AH, 'Linh', { telephone: '0612345678' }), id: 'c' }
    const t = (id: string, jour: number, o: Partial<Tirage> = {}): Tirage => ({ ...tardif, id, code: `COD${id.toUpperCase()}`, date: instantParis(2026, 11, jour, 12).toISOString(), ...o })
    const csv = exportClientCsv(
      client,
      [
        t('aa1', 10),
        t('aa2', 5),
        t('aa3', 5, { remis: { le: instantParis(2026, 11, 6, 12).toISOString(), par: { type: 'gerant', nom: 'Gérant' } } }),
        t('aa4', 5, { typeLot: 'points', lot: '+10 points', code: undefined }),
        herite(instantParis(2026, 11, 1, 12).toISOString(), { id: 'aa5', code: 'COD5XX' }),
      ],
      [],
      instantParis(2026, 11, 10, 15),
    )
    for (const attendu of [
      'Nems offerts (gain utilisable à partir de demain)',
      'Nems offerts (gain à utiliser)',
      'Nems offerts — remis le 2026-11-06',
      '+10 points',
      'Thé glacé (gain expiré)',
    ]) assert.ok(csv.includes(attendu), attendu)
    assert.doesNotMatch(csv, /COD|code /, 'aucun code gagnant')
  })
})

describe('Revue Codex R3 F4 : remise conditionnelle à la fenêtre, vérifiée par la base (SQLite)', () => {
  test('marquerTirageRemis(t, activeApres) : rien écrit si la fenêtre est échue en base ou déjà remis ; sans condition : ancienne garde', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'fidelite-r3-f4-'))
    const st = ouvrirStockage(join(dossier, 'f4.db'))
    try {
      const actif: Tirage = { ...tardif, id: 'ti-f4', activeLe: '2026-11-11T12:00:00.000Z' }
      await st.ajouterTirage(actif)
      const remis = { ...actif, remis: { le: '2026-11-11T12:10:00.000Z', par: { type: 'gerant' as const, nom: 'Gérant' } } }
      assert.equal(await st.marquerTirageRemis(remis, '2026-11-11T12:00:00.000Z'), false, 'activé à 12 h, écriture à 12 h 10 : fenêtre échue (bornes strictes)')
      assert.equal((await st.tiragesParCode(AH, 'ABCD23'))[0].remis, undefined, 'rien écrit')
      assert.equal(await st.marquerTirageRemis(remis, '2026-11-11T11:59:59.999Z'), true, 'fenêtre encore ouverte')
      assert.equal(await st.marquerTirageRemis(remis, '2026-11-11T11:59:59.999Z'), false, 'déjà remis')
      // Sans activation en base (jamais activé) : la condition échoue toujours.
      await st.ajouterTirage({ ...tardif, id: 'ti-f4b', code: 'EFGH23' })
      assert.equal(await st.marquerTirageRemis({ ...tardif, id: 'ti-f4b', code: 'EFGH23', remis: remis.remis }, '2026-01-01T00:00:00.000Z'), false)
      // Sans `activeApres` (tirage hérité du jour même) : seule la garde « non remis ».
      assert.equal(await st.marquerTirageRemis({ ...tardif, id: 'ti-f4b', code: 'EFGH23', remis: remis.remis }), true)
    } finally {
      st.fermer()
      rmSync(dossier, { recursive: true, force: true })
    }
  })
})

describe('Revue Codex R3 : serveur (SQLite, mode strict) — tirages hérités et jours de Paris de bout en bout', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-r3-revue-'))
  const fichierDb = join(dossier, 'revue.db')
  const horloge = { t: instantParis(2026, 11, 10, 12) }
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

  /** Carte inscrite depuis la page de jeu (jeton client) + un tirage écrit directement en base pour cette carte. */
  async function carteAvecTirage(contact: string, t: Omit<Tirage, 'clientId' | 'commerceId'>) {
    const ins = await api('POST', `/commerces/${AH}/clients`, { contact })
    assert.equal(ins.statut, 201, ins.texte)
    const { client, jeton } = ins.contenu as { client: Client; jeton: string }
    const st = ouvrirStockage(fichierDb)
    try {
      await st.ajouterTirage({ ...t, commerceId: AH, clientId: client.id })
    } finally {
      st.fermer()
    }
    return { client, jeton }
  }

  before(async () => {
    app = await creerServeur({
      fichierDb,
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
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('F2 : hérité d’hier non remis → caisse « expire » (ancienne règle), remise 410, activation 410 — rien écrit', async () => {
    horloge.t = instantParis(2026, 11, 10, 12)
    const { client, jeton } = await carteAvecTirage('0620000001', { id: 'ti-hier', lot: 'Thé glacé', date: instantParis(2026, 11, 9, 19).toISOString(), code: 'HIER22' })
    const g = await api('GET', gains('HIER22'), undefined, PIN)
    assert.equal(g.statut, 200)
    assert.deepEqual([g.contenu.gain.statut, g.contenu.gain.ancienneRegle], ['expire', true])
    assert.equal(messageGain(g.contenu.gain), `Gain expiré le lun. 9 nov. 2026 : rien à remettre (${MESSAGE_ANCIENNE_REGLE}).`)
    const remise = await api('POST', `${gains('HIER22')}/remise`, undefined, PIN)
    assert.equal(remise.statut, 410)
    assert.equal(remise.contenu.erreur, `Gain expiré le lun. 9 nov. 2026 : rien à remettre (${MESSAGE_ANCIENNE_REGLE}).`)
    const a = await activer('ti-hier', jeton)
    assert.equal(a.statut, 410, a.texte)
    assert.ok(!a.texte.includes('HIER22'), 'aucun code servi')
    assert.equal((await api('GET', gains('HIER22'), undefined, PIN)).contenu.gain.remis, null)
    const carte = await api('GET', `/cartes/${client.id}`, undefined, bearer(jeton))
    assert.deepEqual(carte.contenu.gainsEnCours, [], 'pas de résurrection sur la carte')
    assert.equal(carte.contenu.historiqueLots[0].statut, 'expire')
  })

  test('F2 : hérité du jour même → remise directe (sans activation ni fenêtre) ; activation refusée (409) sans code', async () => {
    horloge.t = instantParis(2026, 11, 10, 12)
    const { client, jeton } = await carteAvecTirage('0620000002', { id: 'ti-auj', lot: 'Thé glacé', date: instantParis(2026, 11, 10, 11).toISOString(), code: 'AUJD22' })
    const a = await activer('ti-auj', jeton)
    assert.equal(a.statut, 409)
    assert.match(a.contenu.erreur, /directement au comptoir aujourd’hui, sans activation/)
    assert.ok(!a.texte.includes('AUJD22'))
    const carte = await api('GET', `/cartes/${client.id}`, undefined, bearer(jeton))
    assert.deepEqual(carte.contenu.gainsEnCours.map((x: { statut: string; expireActivation: string | null }) => [x.statut, x.expireActivation]), [['utilisable', null]])
    const g = await api('GET', gains('AUJD22'), undefined, PIN)
    assert.deepEqual([g.contenu.gain.statut, g.contenu.gain.ancienneRegle], ['utilisable', true])
    const remise = await api('POST', `${gains('AUJD22')}/remise`, undefined, PIN)
    assert.equal(remise.statut, 200, remise.texte)
    assert.equal(remise.contenu.gain.statut, 'remis')
    assert.equal((await api('POST', `${gains('AUJD22')}/remise`, undefined, PIN)).statut, 409, 'un code = une remise')
  })

  test('F3 : tirage v2 le 10/11 à 23 h 30 Paris — activation dès 00 h 10 Paris (23 h 10 UTC) ; activation, caisse et remise expirées à 00 h 30 Paris le 11/12', async () => {
    horloge.t = iso('2026-11-10T23:10:00Z')
    const { client, jeton } = await carteAvecTirage('0620000003', { id: 'ti-tard', lot: 'Nems offerts', lotId: 'lot-nems', typeLot: 'lot', date: tardif.date, code: 'TARD23' })
    const a = await activer('ti-tard', jeton)
    assert.equal(a.statut, 200, `J+1 à Paris (encore le 10/11 en UTC) : ${a.texte}`)
    assert.equal((await api('GET', gains('TARD23'), undefined, PIN)).contenu.gain.statut, 'utilisable')

    // Le jeton client vaut 30 jours : le téléphone le renouvelle en ouvrant la carte (moins de 15 jours restants).
    horloge.t = iso('2026-11-30T12:00:00Z')
    const renouvele = await api('POST', `/cartes/${client.id}/jeton`, {}, bearer(jeton))
    assert.equal(renouvele.statut, 201, renouvele.texte)
    const jeton2 = renouvele.contenu.jeton as string
    // Dernières minutes de J+30 (23 h 55 Paris le 10/12) : activation, puis le gain expire à minuit Paris, fenêtre ou pas.
    horloge.t = iso('2026-12-10T22:55:00Z')
    assert.equal((await activer('ti-tard', jeton2)).statut, 200)
    horloge.t = iso('2026-12-10T23:30:00Z')
    const tard = await activer('ti-tard', jeton2)
    assert.equal(tard.statut, 410, 'activation : même base de jours que la caisse')
    assert.equal(tard.contenu.erreur, `Gain expiré le ${jourEnClair(iso('2026-12-10T12:00:00Z'))} : il n’est plus utilisable.`)
    assert.equal((await api('GET', gains('TARD23'), undefined, PIN)).contenu.gain.statut, 'expire')
    const remise = await api('POST', `${gains('TARD23')}/remise`, undefined, PIN)
    assert.equal(remise.statut, 410)
    assert.equal(remise.contenu.erreur, 'Gain expiré le jeu. 10 déc. 2026 : rien à remettre.')
  })

  test('F4 : la remise suit l’heure de l’écriture — fenêtre échue → 409 « inactif » (message d’activation), rien écrit', async () => {
    horloge.t = instantParis(2026, 11, 12, 18)
    const { jeton } = await carteAvecTirage('0620000004', { id: 'ti-f4', lot: 'Nems offerts', lotId: 'lot-nems', typeLot: 'lot', date: instantParis(2026, 11, 11, 12).toISOString(), code: 'FENE23' })
    assert.equal((await activer('ti-f4', jeton)).statut, 200)
    horloge.t = new Date(horloge.t.getTime() + 10 * 60 * 1000)
    const r = await api('POST', `${gains('FENE23')}/remise`, undefined, PIN)
    assert.equal(r.statut, 409)
    assert.equal(r.contenu.erreur, MESSAGE_ACTIVATION)
    assert.equal((await api('GET', gains('FENE23'), undefined, PIN)).contenu.gain.remis, null)
  })
})

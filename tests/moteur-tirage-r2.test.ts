// Roue v2 R2 — Moteur de tirage : accès libre (défaut des nouveaux commerces), plafonds journaliers par lot, limite
// mensuelle de lots gagnés par client, consolation en points créditée dans la transaction du tirage (décision
// utilisateur du 12/11/2026). Logique pure, puis vrai serveur HTTP sur SQLite temporaire, hasard du tirage injecté.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { nouveauCommerce } from '../src/data/defaults.ts'
import { normaliserLots, rattachementsTirages } from '../src/lib/lots.ts'
import {
  debutDuJour,
  debutDuJourParis,
  gainsSur30Jours,
  LIMITE_GAINS_MOIS_DEFAUT,
  limiteGainsMois,
  lotsPlafonnes,
  lotsTirables,
  modeAccesRoue,
  statutJeu,
  tirerLot,
} from '../src/lib/roulette.ts'
import { commercePublic } from '../src/lib/vuePublique.ts'
import type { Client, Commerce, CommercePublic, Lot, Tirage } from '../src/types.ts'

const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const CODE = { 'X-Equipe-Code': '2468' }
const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')
const MIDI = new Date(2026, 10, 10, 12)
const ilYa = (jours: number) => new Date(MIDI.getTime() - jours * 24 * 3600 * 1000).toISOString()

const tirage = (o: Partial<Tirage>): Tirage => ({ id: `t-${Math.random()}`, commerceId: AH, clientId: 'cl', lot: 'Nems', date: MIDI.toISOString(), ...o })

describe('R2 : logique pure (src/lib/roulette.ts)', () => {
  const client: Client = { id: 'cl', commerceId: AH, prenom: 'Lin', tampons: 0, visites: [], derniereVisite: null, creeLe: ilYa(10) }

  test('mode d’accès : seul « libre » explicite ouvre sans visite ; absent / inconnu = visite ; 1 tirage par jour toujours', () => {
    assert.equal(modeAccesRoue({}), 'visite')
    assert.equal(modeAccesRoue({ modeAccesRoue: 'visite' }), 'visite')
    assert.equal(modeAccesRoue({ modeAccesRoue: 'autre' as never }), 'visite')
    assert.equal(modeAccesRoue({ modeAccesRoue: 'libre' }), 'libre')
    assert.equal(statutJeu(client, [], AH, MIDI), 'sansVisite', 'défaut du paramètre : visite (ancien modèle)')
    assert.equal(statutJeu(client, [], AH, MIDI, 'visite'), 'sansVisite')
    assert.equal(statutJeu(client, [], AH, MIDI, 'libre'), 'pret', 'libre : jamais « sansVisite »')
    assert.equal(statutJeu(client, [tirage({ date: ilYa(0.1) })], AH, MIDI, 'libre'), 'dejaJoue')
    assert.equal(statutJeu(client, [tirage({ date: ilYa(1) })], AH, MIDI, 'libre'), 'pret', 'tirage d’hier : rejouable')
  })

  test('limite de gains : défaut 4, 0 = illimité, valeur invalide = défaut', () => {
    assert.equal(LIMITE_GAINS_MOIS_DEFAUT, 4)
    assert.equal(limiteGainsMois({}), 4)
    assert.equal(limiteGainsMois({ limiteGainsMois: 0 }), 0)
    assert.equal(limiteGainsMois({ limiteGainsMois: 2 }), 2)
    assert.equal(limiteGainsMois({ limiteGainsMois: -1 }), 4)
    assert.equal(limiteGainsMois({ limiteGainsMois: 1.5 }), 4)
  })

  test('gains sur 30 jours glissants : lots physiques gagnés (remis ou non) ; ni points, ni perdant, ni au-delà de 30 jours', () => {
    const t = [
      tirage({ typeLot: 'lot', date: ilYa(1) }),
      tirage({ typeLot: 'lot', date: ilYa(29.9), remis: { le: ilYa(29), par: { type: 'gerant', nom: 'Gérant' } } }),
      tirage({ typeLot: 'points', lot: '+10 points', date: ilYa(2) }),
      tirage({ typeLot: 'perdant', date: ilYa(3) }),
      tirage({ lot: 'Dommage !', date: ilYa(4) }), // avant R1 : perdant par l'ancienne règle
      tirage({ lot: 'Nems offerts', date: ilYa(5) }), // avant R1 : lot
      tirage({ typeLot: 'lot', date: ilYa(30.1) }),
    ]
    assert.equal(gainsSur30Jours(t, MIDI), 3)
  })

  test('plafond du jour : compté par id (par libellé pour un tirage d’avant R1), tous clients, aujourd’hui seulement', () => {
    const lots = normaliserLots<Lot>([
      { id: 'lot-a', type: 'lot', libelle: 'Nems', probabilite: 50, plafondJour: 2 },
      { id: 'lot-b', type: 'lot', libelle: 'Thé', probabilite: 50, plafondJour: 1 },
      { id: 'lot-c', type: 'lot', libelle: 'Mochi', probabilite: 50 },
      { id: 'lot-p', type: 'points', points: 10, libelle: '+10 points', probabilite: 30, plafondJour: 1 },
    ])
    const jour = [
      tirage({ lotId: 'lot-a', clientId: 'x' }),
      tirage({ lot: 'Nems', clientId: 'y' }), // sans id : par libellé
      tirage({ lotId: 'lot-b', date: ilYa(1) }), // hier : ne compte pas
      tirage({ lotId: 'lot-c' }),
      tirage({ lotId: 'lot-c' }),
      tirage({ lotId: 'lot-p', typeLot: 'points' }),
    ]
    assert.deepEqual([...lotsPlafonnes(lots, jour, MIDI)], ['lot-a'], 'points jamais plafonnés, lot sans plafond jamais plafonné')
  })

  test('ensemble tirable : plafonnés retirés ; limite atteinte → plus aucun lot physique (repli points / perdant)', () => {
    const lots = normaliserLots<Lot>([
      { id: 'lot-a', type: 'lot', libelle: 'Nems', probabilite: 40 },
      { id: 'lot-b', type: 'lot', libelle: 'Thé', probabilite: 20 },
      { id: 'lot-p', type: 'points', points: 10, libelle: '+10 points', probabilite: 30 },
      { id: 'lot-x', type: 'perdant', libelle: 'Raté', probabilite: 10 },
    ])
    const ids = (l: { id: string }[]) => l.map((x) => x.id)
    assert.deepEqual(ids(lotsTirables(lots, { plafonnes: new Set(['lot-a']), gainsMois: 0, limite: 4 })), ['lot-b', 'lot-p', 'lot-x'])
    assert.deepEqual(ids(lotsTirables(lots, { plafonnes: new Set(), gainsMois: 3, limite: 4 })), ['lot-a', 'lot-b', 'lot-p', 'lot-x'])
    assert.deepEqual(ids(lotsTirables(lots, { plafonnes: new Set(), gainsMois: 4, limite: 4 })), ['lot-p', 'lot-x'])
    assert.deepEqual(ids(lotsTirables(lots, { plafonnes: new Set(), gainsMois: 99, limite: 0 })), ['lot-a', 'lot-b', 'lot-p', 'lot-x'], '0 = illimité')
    // Probabilités renormalisées au prorata sur le reste : points 30 / perdant 10 → 75 % / 25 %.
    const reste = lotsTirables(lots, { plafonnes: new Set(), gainsMois: 4, limite: 4 })
    assert.equal(reste[tirerLot(reste, 0.74)].id, 'lot-p')
    assert.equal(reste[tirerLot(reste, 0.76)].id, 'lot-x')
  })

  test('vue publique : les lots plafonnés du jour disparaissent ; jamais le plafond ni la limite publiés', () => {
    const c: Commerce = {
      ...nouveauCommerce('Chez Lin', 'restaurant', ''),
      limiteGainsMois: 3,
      lots: [
        { id: 'lot-a', type: 'lot', libelle: 'Nems', probabilite: 50, plafondJour: 7 },
        { id: 'lot-p', type: 'points', points: 10, libelle: '+10 points', probabilite: 50 },
      ],
    }
    assert.deepEqual(commercePublic(c).lots.map((l) => l.id), ['lot-a', 'lot-p'])
    assert.deepEqual(commercePublic(c, new Set(['lot-a'])).lots.map((l) => l.id), ['lot-p'])
    assert.doesNotMatch(JSON.stringify(commercePublic(c)), /plafond|limiteGains|modeAcces/)
  })

  test('début du jour : minuit local, en ISO (borne de lecture des tirages du jour)', () => {
    assert.equal(debutDuJour(MIDI), new Date(2026, 10, 10).toISOString())
  })
})

describe('R2 : serveur (SQLite) — accès libre, plafonds, limite mensuelle, consolation points', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-r2-'))
  const fichierDb = join(dossier, 'r2.db')
  let app: Awaited<ReturnType<typeof creerServeur>>
  let base = ''
  let n = 0
  let hasard = 0
  let ip = 0

  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    // Une IP par requête (derrière proxy) : les limites publiques par IP ne gênent pas les nombreux tirages du fichier.
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.0.${Math.floor(++ip / 250)}.${ip % 250}`, ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    return { statut: r.status, contenu: await r.json() }
  }
  const patch = async (corps: object) => {
    const r = await api('PATCH', `/commerces/${AH}`, corps, PIN)
    assert.equal(r.statut, 200, JSON.stringify(r.contenu))
    return r.contenu.commerce as Commerce
  }
  const etat = async () => (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu as { commerce: Commerce; clients: Client[]; tirages: Tirage[] }
  const nouveauContact = () => `06${String(20_000_000 + ++n).padStart(8, '0')}`
  async function inscrire(contact = nouveauContact()) {
    const c = (await api('POST', `/commerces/${AH}/clients`, { prenom: `R${n}`, contact }, PIN)).contenu.client as Client
    return { client: c, contact }
  }
  const visite = async (c: Client) =>
    assert.equal((await api('POST', `/commerces/${AH}/caisse/passage`, { clientId: c.id, actionId: `act-${c.id}-${++n}` }, CODE)).statut, 200)
  const tirer = (contact: string) => api('POST', `/commerces/${AH}/tirages`, { contact })
  /** Tirages passés écrits directement en base (jours précédents) : gains du mois d'un client. */
  function tiragesPasses(clientId: string, liste: Partial<Tirage>[]) {
    const db = new DatabaseSync(fichierDb)
    try {
      for (const o of liste) {
        const t: Tirage = { id: `ti-passe-${++n}`, commerceId: AH, clientId, lot: 'Nems offerts', typeLot: 'lot', date: ilYa(1), code: 'ABCDEF', ...o }
        db.prepare('INSERT INTO tirages (id, commerce_id, client_id, date, donnees) VALUES (?, ?, ?, ?, ?)').run(t.id, AH, clientId, t.date, JSON.stringify(t))
      }
    } finally {
      db.close()
    }
  }
  const solde = async (clientId: string) => (await etat()).clients.find((c) => c.id === clientId)!.points ?? 0

  before(async () => {
    app = await creerServeur({ fichierDb, adminPin: '98765432', pinInitial: '1234', version: 'test', maintenant: () => MIDI, alea: () => hasard, derriereProxy: true })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
    assert.equal((await api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)).statut, 201)
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('config sans les nouveaux champs (Asian Home) : ancien modèle — sans visite 409, statut « sansVisite » ; avec visite 201', async () => {
    const { commerce } = await etat()
    assert.equal(commerce.modeAccesRoue, undefined, 'réglage d’Asian Home inchangé')
    assert.equal(commerce.limiteGainsMois, undefined)
    const { client, contact } = await inscrire()
    assert.equal((await api('GET', `/cartes/${client.id}`)).contenu.jeu.statut, 'sansVisite')
    const refus = await tirer(contact)
    assert.equal(refus.statut, 409)
    assert.match(refus.contenu.erreur, /valider votre visite/)
    await visite(client)
    assert.equal((await tirer(contact)).statut, 201)
  })

  test('mode libre : tirage sans aucune visite → 201 ; 2e tirage le même jour → 409 (message unique) ; aucune visite créée', async () => {
    await patch({ modeAccesRoue: 'libre' })
    const { client, contact } = await inscrire()
    assert.equal((await api('GET', `/cartes/${client.id}`)).contenu.jeu.statut, 'pret', 'libre : prêt dès l’identification')
    const r = await tirer(contact)
    assert.equal(r.statut, 201, JSON.stringify(r.contenu))
    const r2 = await tirer(contact)
    assert.equal(r2.statut, 409)
    assert.match(r2.contenu.erreur, /Vous ne pouvez pas jouer pour le moment/)
    assert.equal((await api('GET', `/cartes/${client.id}`)).contenu.jeu.statut, 'dejaJoue')
    const fiche = (await etat()).clients.find((c) => c.id === client.id)!
    assert.equal(fiche.visites.length, 0, 'le jeu ne crée jamais de visite')
    // Nouveau client par contact seul (mode transition) : inscrit et joue dans la foulée.
    assert.equal((await tirer(nouveauContact())).statut, 201)
  })

  test('validation des réglages : modeAccesRoue, limiteGainsMois, plafondJour ; rien d’écrit en cas de refus', async () => {
    const avant = (await etat()).commerce
    for (const corps of [
      { modeAccesRoue: 'ouvert' },
      { modeAccesRoue: null },
      { limiteGainsMois: -1 },
      { limiteGainsMois: 32 },
      { limiteGainsMois: 2.5 },
      { limiteGainsMois: '4' },
      { lots: [{ type: 'lot', libelle: 'Nems', probabilite: 50, plafondJour: -1 }, { type: 'lot', libelle: 'Thé', probabilite: 50 }] },
      { lots: [{ type: 'lot', libelle: 'Nems', probabilite: 50, plafondJour: 1.5 }, { type: 'lot', libelle: 'Thé', probabilite: 50 }] },
    ]) {
      const r = await api('PATCH', `/commerces/${AH}`, corps, PIN)
      assert.equal(r.statut, 400, JSON.stringify(corps))
    }
    assert.deepEqual((await etat()).commerce, avant)
    const c = await patch({
      limiteGainsMois: 0,
      lots: [
        { id: 'lot-a', type: 'lot', libelle: 'Nems', probabilite: 50, plafondJour: 3 },
        { id: 'lot-b', type: 'lot', libelle: 'Thé', probabilite: 20, plafondJour: 0 },
        { id: 'lot-p', type: 'points', points: 10, libelle: '+10 points', probabilite: 30, plafondJour: 5 },
      ],
    })
    assert.equal(c.limiteGainsMois, 0)
    assert.deepEqual(
      c.lots.map((l) => [l.id, l.plafondJour ?? null, l.probabilite]),
      [['lot-a', 3, 50], ['lot-b', null, 20], ['lot-p', null, 30]],
      'plafond gardé sur un lot physique ; 0 = rien d’écrit ; jamais sur une consolation ; probabilités inchangées',
    )
    assert.equal((await patch({ modeAccesRoue: 'visite' })).modeAccesRoue, 'visite')
    assert.equal((await patch({ modeAccesRoue: 'libre', limiteGainsMois: 4 })).modeAccesRoue, 'libre')
  })

  test('plafond : lot à plafond 1 déjà sorti aujourd’hui → jamais retombé (hasard forcé sur lui), disparu de la roue publique', async () => {
    await patch({
      modeAccesRoue: 'libre',
      limiteGainsMois: 0,
      lots: [
        { id: 'lot-rare', type: 'lot', libelle: 'Menu offert', probabilite: 50, plafondJour: 1 },
        { id: 'lot-the', type: 'lot', libelle: 'Thé glacé', probabilite: 30 },
        { id: 'lot-pts', type: 'points', points: 10, libelle: '+10 points', probabilite: 20 },
      ],
    })
    const roue = async () => ((await api('GET', `/commerces/${AH}`)).contenu.commerce as CommercePublic).lots.map((l) => l.id)
    assert.deepEqual(await roue(), ['lot-rare', 'lot-the', 'lot-pts'])
    hasard = 0 // premier secteur : le lot rare
    const premier = await tirer(nouveauContact())
    assert.equal(premier.contenu.lotId, 'lot-rare')
    assert.deepEqual(await roue(), ['lot-the', 'lot-pts'], 'plafond atteint : retiré de la roue et de « À gagner aujourd’hui »')
    // Le hasard reste sur le 1er secteur (et balaie le reste) : le lot rare ne retombe jamais ce jour-là.
    for (const h of [0, 0, 0.3, 0.59, 0.99]) {
      hasard = h
      const r = await tirer(nouveauContact())
      assert.equal(r.statut, 201)
      assert.notEqual(r.contenu.lotId, 'lot-rare', `hasard ${h}`)
    }
    hasard = 0
    assert.equal((await tirer(nouveauContact())).contenu.lotId, 'lot-the', 'renormalisé : le 1er secteur restant')
    // La carte publique sert la même roue filtrée.
    const { client } = await inscrire()
    assert.deepEqual(((await api('GET', `/cartes/${client.id}`)).contenu.commerce as CommercePublic).lots.map((l) => l.id), ['lot-the', 'lot-pts'])
  })

  test('tous les lots physiques plafonnés → consolation points créditée (montant exact, solde renvoyé, aucun code)', async () => {
    await patch({
      lots: [
        { id: 'lot-u1', type: 'lot', libelle: 'Nems offerts', probabilite: 60, plafondJour: 1 },
        { id: 'lot-u2', type: 'lot', libelle: 'Mochi offert', probabilite: 30, plafondJour: 1 },
        { id: 'lot-p15', type: 'points', points: 15, libelle: '+15 points', probabilite: 10 },
      ],
    })
    hasard = 0
    assert.equal((await tirer(nouveauContact())).contenu.lotId, 'lot-u1')
    assert.equal((await tirer(nouveauContact())).contenu.lotId, 'lot-u2')
    const { client, contact } = await inscrire()
    const avant = await solde(client.id)
    const r = await tirer(contact)
    assert.equal(r.statut, 201)
    assert.deepEqual(
      [r.contenu.type, r.contenu.lotId, r.contenu.points, r.contenu.solde, r.contenu.code, r.contenu.perdant],
      ['points', 'lot-p15', 15, avant + 15, undefined, true],
    )
    assert.equal(await solde(client.id), avant + 15)
    const enBase = (await etat()).tirages.find((t) => t.clientId === client.id)!
    assert.deepEqual([enBase.typeLot, enBase.points, enBase.code], ['points', 15, undefined], 'le tirage porte le type et le montant, pas de code')
    // Plus aucun lot du tout (que des lots physiques, tous plafonnés) : refus explicite, rien d'enregistré.
    await patch({
      lots: [
        { id: 'lot-u1', type: 'lot', libelle: 'Nems offerts', probabilite: 60, plafondJour: 1 },
        { id: 'lot-u2', type: 'lot', libelle: 'Mochi offert', probabilite: 40, plafondJour: 1 },
      ],
    })
    const vide = await tirer(nouveauContact())
    assert.equal(vide.statut, 409)
    assert.match(vide.contenu.erreur, /Tous les lots du jour sont partis/)
  })

  test('limite mensuelle : 4 gains sur 30 jours → points / perdant seulement ; 3 gains → lot encore possible ; 0 = illimité', async () => {
    await patch({
      limiteGainsMois: 4,
      lots: [
        { id: 'lot-nems', type: 'lot', libelle: 'Nems offerts', probabilite: 70 },
        { id: 'lot-p10', type: 'points', points: 10, libelle: '+10 points', probabilite: 20 },
        { id: 'lot-rate', type: 'perdant', libelle: 'Raté', probabilite: 10 },
      ],
    })
    hasard = 0 // forcé sur le lot physique
    const a4 = await inscrire()
    // 4 lots gagnés (dont un remis) sur 30 jours, + un hors fenêtre, + consolation et perdant qui ne comptent pas.
    tiragesPasses(a4.client.id, [
      { date: ilYa(1) },
      { date: ilYa(7), remis: { le: ilYa(7), par: { type: 'gerant', nom: 'Gérant' } } },
      { date: ilYa(15) },
      { date: ilYa(29) },
      { date: ilYa(40) },
      { date: ilYa(2), typeLot: 'points', lot: '+10 points', code: undefined },
    ])
    const r4 = await tirer(a4.contact)
    assert.equal(r4.statut, 201)
    assert.equal(r4.contenu.lotId, 'lot-p10', 'limite atteinte : repli consolation même avec le hasard sur le lot')
    for (const h of [0.5, 0.99]) {
      hasard = h
      const autre = await inscrire()
      tiragesPasses(autre.client.id, [{ date: ilYa(1) }, { date: ilYa(2) }, { date: ilYa(3) }, { date: ilYa(4) }])
      const r = await tirer(autre.contact)
      assert.ok(['lot-p10', 'lot-rate'].includes(r.contenu.lotId), `hasard ${h} : ${r.contenu.lotId}`)
    }
    hasard = 0
    const a3 = await inscrire()
    tiragesPasses(a3.client.id, [{ date: ilYa(1) }, { date: ilYa(10) }, { date: ilYa(20) }, { date: ilYa(31) }, { date: ilYa(3), typeLot: 'perdant', lot: 'Raté' }])
    const r3 = await tirer(a3.contact)
    assert.equal(r3.contenu.lotId, 'lot-nems', '3 gains sur 30 jours : un lot est encore possible')
    // R3 (burn-on-reveal, décision du 12/11) : le code du lot physique est créé en base mais n'est plus dans la réponse
    // du tirage — le client l'obtient par l'activation, à partir du lendemain.
    assert.equal(r3.contenu.code, undefined)
    const enBase3 = ((await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.tirages as Tirage[]).find((t) => t.id === r3.contenu.tirageId)
    assert.match(enBase3?.code ?? '', /^[A-Z2-9]{6}$/, 'lot physique : code à montrer au comptoir')
    await patch({ limiteGainsMois: 0 })
    const illimite = await inscrire()
    tiragesPasses(illimite.client.id, [1, 2, 3, 4, 5, 6].map((j) => ({ date: ilYa(j) })))
    assert.equal((await tirer(illimite.contact)).contenu.lotId, 'lot-nems', '0 = illimité')
  })

  test('points : crédités une seule fois même en cas de double appel simultané (1 tirage par jour)', async () => {
    await patch({
      limiteGainsMois: 4,
      lots: [
        { id: 'lot-p25', type: 'points', points: 25, libelle: '+25 points', probabilite: 100 },
        { id: 'lot-z', type: 'lot', libelle: 'Nems offerts', probabilite: 0 },
      ],
    })
    const { client, contact } = await inscrire()
    const avant = await solde(client.id)
    const r = await Promise.all([tirer(contact), tirer(contact), tirer(contact)])
    assert.deepEqual(r.map((x) => x.statut).sort(), [201, 409, 409])
    assert.equal(await solde(client.id), avant + 25, 'crédité exactement une fois')
    assert.equal((await etat()).tirages.filter((t) => t.clientId === client.id).length, 1)
    // Le lendemain (nouveau jour) : nouveau tirage, nouveau crédit.
  })

  test('nouveau commerce (création admin) : accès libre par défaut ; défauts appliqués côté client et serveur', async () => {
    assert.equal(nouveauCommerce('Chez Lin', 'restaurant', '').modeAccesRoue, 'libre')
    const r = await api('POST', '/commerces', { nom: 'Chez Lin', type: 'restaurant', lienGoogle: '', pin: '4321' }, { 'X-Admin-PIN': '98765432' })
    assert.equal(r.statut, 201, JSON.stringify(r.contenu))
    assert.equal(r.contenu.commerce.modeAccesRoue, 'libre')
    const id = r.contenu.commerce.id as string
    const t = await api('POST', `/commerces/${id}/tirages`, { contact: nouveauContact() })
    assert.equal(t.statut, 201, 'nouveau commerce : tirage sans visite')
  })
})

describe('R2 : câblage (source)', () => {
  test('serveur : statut avec le mode du commerce, ensemble tirable du jour, crédit des points après l’insertion du tirage', () => {
    const app = lire('server/app.ts')
    assert.match(app, /statutJeu\(client, tiragesClient, id, t, modeAccesRoue\(commerce\)\)/)
    assert.match(app, /statut: statutJeu\(client, tirages, c\.id, t, modeAccesRoue\(c\)\)/)
    assert.match(app, /lotsTirables\(normalises, \{/)
    const insertion = app.indexOf('await st.ajouterTirage(tirage)')
    const credit = app.indexOf('points: soldePoints(frais) + points')
    assert.ok(insertion > 0 && credit > insertion, 'tirage enregistré (index unique) avant le crédit des points')
    // Les routes publiques servent la fiche filtrée des lots plafonnés, jamais la fiche brute.
    assert.doesNotMatch(app, /commercePublic\(c\)|commercePublic\(commerce\)|map\(commercePublic\)/)
  })

  test('page de jeu (mode local) : statut et tirage selon le mode, l’ensemble tirable du jour', () => {
    const jouer = lire('src/pages/Jouer.tsx')
    assert.match(jouer, /const mode = modeAccesRoue\(commerce\)/)
    assert.match(jouer, /statutJeu\(joueur, etat\.tirages, commerce\.id, new Date\(\), mode\)/)
    assert.match(jouer, /lotsTirables\(normalises, \{/)
  })
})

describe('Revue Codex R2 : journée des plafonds en Europe/Paris (F3), rattrapage des lotId (F4)', () => {
  test('F3 : minuit à Paris en ISO, quel que soit le fuseau du processus (hiver, été, jours de changement d’heure)', () => {
    assert.equal(debutDuJourParis(new Date('2026-11-10T00:30:00Z')), '2026-11-09T23:00:00.000Z', '01 h 30 à Paris le 10/11')
    assert.equal(debutDuJourParis(new Date('2026-11-10T22:59:59Z')), '2026-11-09T23:00:00.000Z', '23 h 59 à Paris le 10/11')
    assert.equal(debutDuJourParis(new Date('2026-11-10T23:00:00Z')), '2026-11-10T23:00:00.000Z', 'minuit à Paris : nouveau jour')
    assert.equal(debutDuJourParis(new Date('2026-07-01T10:00:00Z')), '2026-06-30T22:00:00.000Z', 'été : UTC+2')
    assert.equal(debutDuJourParis(new Date('2026-03-29T12:00:00Z')), '2026-03-28T23:00:00.000Z', 'passage à l’heure d’été (minuit encore en UTC+1)')
    assert.equal(debutDuJourParis(new Date('2026-10-25T12:00:00Z')), '2026-10-24T22:00:00.000Z', 'retour à l’heure d’hiver (minuit encore en UTC+2)')
  })

  test('F3 : plafonds comptés sur la journée parisienne — 00 h 30 Paris compte à 01 h 30 Paris, 23 h 30 la veille non', () => {
    const lots = normaliserLots<Lot>([
      { id: 'lot-a', type: 'lot', libelle: 'Nems', probabilite: 50, plafondJour: 1 },
      { id: 'lot-b', type: 'lot', libelle: 'Thé', probabilite: 50, plafondJour: 1 },
    ])
    const tirages = [
      tirage({ lotId: 'lot-a', date: '2026-11-09T23:30:00.000Z' }), // 00 h 30 à Paris le 10/11
      tirage({ lotId: 'lot-b', date: '2026-11-09T22:30:00.000Z' }), // 23 h 30 à Paris le 09/11
    ]
    assert.deepEqual([...lotsPlafonnes(lots, tirages, new Date('2026-11-10T00:30:00Z'))], ['lot-a'])
  })

  test('F4 : rattachement par libellé exact (espaces de bord + casse) à UN seul lot ; ambigu ou sans correspondance : rien', () => {
    const lots: Lot[] = [
      { id: 'lot-nems', type: 'lot', libelle: 'Nems offerts', probabilite: 40 },
      { id: 'lot-the1', type: 'lot', libelle: 'Thé', probabilite: 20 },
      { id: 'lot-the2', type: 'lot', libelle: ' thé ', probabilite: 20 }, // config d'avant la validation des doublons
      { id: 'lot-pts', type: 'points', points: 10, libelle: '+10 points', probabilite: 20 },
    ]
    const t = [
      tirage({ id: 'a', lot: '  NEMS offerts ' }),
      tirage({ id: 'b', lot: 'Thé' }), // ambigu : deux lots « thé »
      tirage({ id: 'c', lot: 'Lot disparu' }), // sans correspondance
      tirage({ id: 'd', lot: 'Nems  offerts' }), // espaces internes : pas exactement le même libellé
      tirage({ id: 'e', lot: '+10 points', typeLot: 'points' }),
      tirage({ id: 'f', lot: 'Nems offerts', lotId: 'lot-ancien' }), // déjà rattaché : jamais réécrit
    ]
    const r = rattachementsTirages(lots, t)
    assert.deepEqual(r.map((x) => [x.id, x.lotId, x.typeLot]), [['a', 'lot-nems', 'lot'], ['e', 'lot-pts', 'points']])
    assert.equal(r[0].lot, '  NEMS offerts ', 'le libellé du tirage n’est pas réécrit')
    // typeLot déjà présent : conservé tel quel (seul un type absent est complété).
    assert.equal(rattachementsTirages(lots, [tirage({ lot: 'Nems offerts', typeLot: 'perdant' })])[0].typeLot, 'perdant')
  })

  describe('serveur (SQLite, processus en UTC, horloge à 01 h 30 Paris)', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'fidelite-r2-revue-'))
    const fichierDb = join(dossier, 'r2-revue.db')
    const HORLOGE = new Date('2026-11-10T00:30:00Z') // 01 h 30 à Paris le 10/11 ; 00 h 30 le 10/11 en UTC
    let app: Awaited<ReturnType<typeof creerServeur>>
    let base = ''
    let n = 0
    let hasard = 0

    async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
      const r = await fetch(base + chemin, {
        method: methode,
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.8.0.${++n % 250}`, ...entetes },
        body: corps === undefined ? undefined : JSON.stringify(corps),
      })
      return { statut: r.status, contenu: await r.json() }
    }
    const patch = async (corps: object) => assert.equal((await api('PATCH', `/commerces/${AH}`, corps, PIN)).statut, 200)
    const nouveauContact = () => `06${String(30_000_000 + ++n).padStart(8, '0')}`
    const inscrire = async () => (await api('POST', `/commerces/${AH}/clients`, { prenom: `F${n}`, contact: nouveauContact() }, PIN)).contenu.client as Client
    const roue = async () => ((await api('GET', `/commerces/${AH}`)).contenu.commerce as CommercePublic).lots.map((l) => l.id)
    /** Tirage écrit directement en base (un client par tirage), comme un tirage d'avant R1 quand `lotId` manque. */
    async function inserer(o: Partial<Tirage>): Promise<Tirage> {
      const t: Tirage = { id: `ti-revue-${++n}`, commerceId: AH, clientId: (await inscrire()).id, lot: 'Nems offerts', date: HORLOGE.toISOString(), code: 'ABCDEF', ...o }
      const db = new DatabaseSync(fichierDb)
      try {
        db.prepare('INSERT INTO tirages (id, commerce_id, client_id, date, donnees) VALUES (?, ?, ?, ?, ?)').run(t.id, AH, t.clientId, t.date, JSON.stringify(t))
      } finally {
        db.close()
      }
      return t
    }
    function enBase(id: string): Tirage {
      const db = new DatabaseSync(fichierDb)
      try {
        return JSON.parse((db.prepare('SELECT donnees FROM tirages WHERE id = ?').get(id) as { donnees: string }).donnees) as Tirage
      } finally {
        db.close()
      }
    }

    before(async () => {
      app = await creerServeur({ fichierDb, adminPin: '98765432', pinInitial: '1234', version: 'test', maintenant: () => HORLOGE, alea: () => hasard, derriereProxy: true })
      await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
      base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
    })
    after(async () => {
      await app.fermer()
      rmSync(dossier, { recursive: true, force: true })
    })

    test('F3 : un tirage à 00 h 30 (Paris) atteint le plafond de la journée parisienne en cours à 01 h 30 (Paris)', async () => {
      await patch({
        modeAccesRoue: 'libre',
        limiteGainsMois: 0,
        lots: [
          { id: 'lot-rare', type: 'lot', libelle: 'Menu offert', probabilite: 40, plafondJour: 1 },
          { id: 'lot-veille', type: 'lot', libelle: 'Mochi offert', probabilite: 30, plafondJour: 1 },
          { id: 'lot-the', type: 'lot', libelle: 'Thé glacé', probabilite: 30 },
        ],
      })
      await inserer({ lot: 'Menu offert', lotId: 'lot-rare', typeLot: 'lot', date: '2026-11-09T23:30:00.000Z' }) // 00 h 30 Paris, le 10/11
      await inserer({ lot: 'Mochi offert', lotId: 'lot-veille', typeLot: 'lot', date: '2026-11-09T22:30:00.000Z' }) // 23 h 30 Paris, le 09/11
      assert.deepEqual(await roue(), ['lot-veille', 'lot-the'], 'plafond du jour parisien atteint ; la veille parisienne ne compte pas')
      hasard = 0 // premier secteur : le lot rare… s'il était encore tirable
      const r = await api('POST', `/commerces/${AH}/tirages`, { contact: nouveauContact() })
      assert.equal(r.statut, 201)
      assert.equal(r.contenu.lotId, 'lot-veille')
    })

    test('F4 : écriture des lots → tirages sans lotId rattachés (libellé exact) ; sans correspondance : intacts ; remise et type gardés ; renommage ensuite sans effet sur le plafond', async () => {
      const lots = (libelle: string) => [
        { id: 'lot-nems', type: 'lot', libelle, probabilite: 50, plafondJour: 1 },
        { id: 'lot-the', type: 'lot', libelle: 'Thé glacé', probabilite: 50 },
      ]
      const aujourdhui = await inserer({ lot: 'nems OFFERTS ', date: '2026-11-10T00:00:00.000Z' }) // 01 h Paris : aujourd'hui
      const remis = await inserer({ lot: 'Nems offerts', typeLot: 'lot', date: '2026-11-05T12:00:00.000Z', remis: { le: '2026-11-05T13:00:00.000Z', par: { type: 'gerant', nom: 'Gérant' } } })
      const orphelin = await inserer({ lot: 'Lot disparu', date: '2026-11-04T12:00:00.000Z' })
      await patch({ lots: lots('Nems offerts') })
      assert.deepEqual([enBase(aujourdhui.id).lotId, enBase(aujourdhui.id).typeLot], ['lot-nems', 'lot'])
      assert.equal(enBase(aujourdhui.id).lot, 'nems OFFERTS ', 'libellé du tirage inchangé')
      assert.equal(enBase(remis.id).lotId, 'lot-nems')
      assert.deepEqual(enBase(remis.id).remis, remis.remis, 'remise conservée')
      assert.deepEqual(enBase(orphelin.id), orphelin, 'sans correspondance : tirage intact')
      // Renommé ensuite : le tirage du jour compte toujours pour ce lot (par id) — plafond 1 atteint, absent de la roue.
      await patch({ lots: lots('Nems maison') })
      assert.deepEqual(await roue(), ['lot-the'])
    })
  })
})

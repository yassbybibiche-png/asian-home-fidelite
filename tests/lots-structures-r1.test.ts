// Roue v2 R1 — Lots structurés : id stable + type explicite ('lot' / 'points' / 'perdant'), fin de la détection
// « perdant » par libellé (décision utilisateur du 12/11/2026). Logique pure, vrai serveur HTTP sur SQLite temporaire,
// seed, et câblage des écrans vérifié sur le source (node --test n'importe pas le .tsx).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import seed from '../src/data/seed.json' with { type: 'json' }
import { nouveauCommerce } from '../src/data/defaults.ts'
import { secteurDuLot } from '../src/data/jeuApi.ts'
import { cleLibelle, idDeduit, libellesEnDouble, normaliserLots, nouvelIdLot, typeDeduitDuLibelle, typeLot, typeTirage } from '../src/lib/lots.ts'
import { lotAccroche } from '../src/lib/mesure.ts'
import { messageGain, secteurs, statutGain, tirageDuCode } from '../src/lib/roulette.ts'
import { commercePublic } from '../src/lib/vuePublique.ts'
import type { Client, Commerce, CommercePublic, Lot, Tirage } from '../src/types.ts'
import { codeEnBase } from './code-en-base.ts'

const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const CODE = { 'X-Equipe-Code': '2468' }
const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')

describe('R1 : type et id résolus à la lecture (rétro-compatibilité)', () => {
  test('lot sans type : ancienne règle (perdant par ancien libellé, lot sinon) ; type explicite : toujours lui', () => {
    for (const l of ['Dommage !', 'Pas de chance', 'Perdu', 'Rejouez demain']) assert.equal(typeLot({ libelle: l }), 'perdant', l)
    for (const l of ['Nems offerts', 'Thé glacé', '+10 points', 'Remise 10 %']) assert.equal(typeLot({ libelle: l }), 'lot', l)
    // Le type explicite l'emporte, dans les deux sens : le libellé ne décide plus rien.
    assert.equal(typeLot({ libelle: 'Dommage !', type: 'lot' }), 'lot')
    assert.equal(typeLot({ libelle: 'Nems offerts', type: 'perdant' }), 'perdant')
    assert.equal(typeLot({ libelle: 'Dommage !', type: 'points' }), 'points')
    // Type inconnu (donnée abîmée) : ancienne règle, jamais une valeur hors énumération.
    assert.equal(typeLot({ libelle: 'Dommage !', type: 'bonus' as never }), 'perdant')
    assert.equal(typeDeduitDuLibelle('DOMMAGE'), 'perdant')
  })

  test('tirage sans type (avant R1) : ancienne règle ; avec type figé : lui, même si le lot a été renommé depuis', () => {
    assert.equal(typeTirage({ lot: 'Dommage !' }), 'perdant')
    assert.equal(typeTirage({ lot: 'Nems offerts' }), 'lot')
    assert.equal(typeTirage({ lot: '+10 points', typeLot: 'points' }), 'points')
    assert.equal(typeTirage({ lot: 'Dommage !', typeLot: 'lot' }), 'lot')
  })

  test('id déduit : déterministe (même config → mêmes ids), dépend de la position et du libellé, unique', () => {
    const anciens: Lot[] = [
      { libelle: 'Nems offerts', probabilite: 20 },
      { libelle: 'Lot fantôme', probabilite: 0 },
      { libelle: 'Dommage !', probabilite: 30 },
    ]
    const a = normaliserLots(anciens)
    const b = normaliserLots(structuredClone(anciens))
    assert.deepEqual(a, b, 'deux lectures de la même config → mêmes ids')
    assert.deepEqual(a.map((l) => l.type), ['lot', 'lot', 'perdant'])
    assert.equal(a[0].id, idDeduit(0, 'Nems offerts'))
    assert.match(a[0].id, /^lot-1-[0-9a-f]{8}$/)
    assert.equal(new Set(a.map((l) => l.id)).size, 3)
    // Casse / espaces de bord sans effet sur l'id déduit ; position et libellé, si.
    assert.equal(idDeduit(0, ' nems OFFERTS '), idDeduit(0, 'Nems offerts'))
    assert.notEqual(idDeduit(1, 'Nems offerts'), idDeduit(0, 'Nems offerts'))
    assert.notEqual(idDeduit(0, 'Nems offert'), idDeduit(0, 'Nems offerts'))
    // La liste reçue n'est pas modifiée.
    assert.equal(anciens[0].id, undefined)
  })

  test('id explicite gardé (renommage sans effet), invalide ou en double → id déduit ; jamais deux lots sous le même id', () => {
    const lots = normaliserLots([
      { id: 'lot-a', type: 'lot', libelle: 'Nouveau nom', probabilite: 50 },
      { id: 'lot-a', type: 'lot', libelle: 'Autre', probabilite: 10 },
      { id: 'pas valable !', libelle: 'Dommage !', probabilite: 40 },
    ])
    assert.equal(lots[0].id, 'lot-a')
    assert.equal(lots[1].id, idDeduit(1, 'Autre'))
    assert.equal(lots[2].id, idDeduit(2, 'Dommage !'))
    assert.equal(lots[2].type, 'perdant')
    // Collision d'un id explicite avec un id déduit : suffixé.
    const piege = normaliserLots([{ libelle: 'X', probabilite: 1 }, { id: idDeduit(0, 'X'), libelle: 'Y', probabilite: 1 }])
    assert.equal(new Set(piege.map((l) => l.id)).size, 2)
    assert.match(nouvelIdLot(), /^lot-[\w-]+$/)
    assert.notEqual(nouvelIdLot(), nouvelIdLot())
  })

  test('libellés en double : casse et espaces (de bord et multiples) ignorés, libellés vides ignorés', () => {
    assert.equal(cleLibelle('  Nems   OFFERTS '), 'nems offerts')
    assert.deepEqual(libellesEnDouble([{ libelle: 'Nems offerts' }, { libelle: ' nems  Offerts ' }, { libelle: 'Thé' }]), ['nems  Offerts'])
    assert.deepEqual(libellesEnDouble([{ libelle: '' }, { libelle: ' ' }, { libelle: 'Thé' }]), [])
  })

  test('statut en caisse : perdant / consolation / gain (en attente le jour même, R3) selon le type figé du tirage, jamais selon le libellé', () => {
    const midi = new Date(2026, 10, 10, 12)
    const t: Tirage = { id: 't', commerceId: AH, clientId: 'c', lot: 'Dommage !', lotId: 'x', typeLot: 'lot', date: new Date(2026, 10, 10, 9).toISOString(), code: 'ABCD23' }
    // R3 (décision du 12/11) : un gain du jour est « enAttente » (utilisable dès demain), plus « valable ».
    assert.equal(statutGain(t, midi), 'enAttente', 'type explicite « lot » : le libellé « Dommage ! » ne le rend plus perdant')
    assert.equal(statutGain({ ...t, lot: 'Nems offerts', typeLot: 'perdant' }, midi), 'perdant')
    assert.equal(statutGain({ ...t, lot: '+10 points', typeLot: 'points' }, midi), 'consolation')
    assert.equal(statutGain({ id: 'v', commerceId: AH, clientId: 'c', lot: 'Dommage !', date: t.date }, midi), 'perdant', 'ancien tirage')
    // R3 : message v2 des maquettes (§4) pour un tirage points / perdant.
    assert.match(messageGain({ statut: 'consolation', lot: '+10 points', date: t.date, remis: null }), /pas de lot à remettre \(\+10 points\)/)
    // Même code le même jour : le lot physique passe avant la consolation.
    const conso: Tirage = { ...t, id: 'p', lot: '+10 points', typeLot: 'points' }
    assert.equal(tirageDuCode([conso, { ...t, id: 'l', lot: 'Nems offerts' }], midi)?.id, 'l')
  })

  test('accroche (test A/B) : cite le 1er lot physique, jamais une consolation ni un perdant', () => {
    assert.equal(lotAccroche([{ libelle: '+10 points', type: 'points' }, { libelle: 'Dommage !' }, { libelle: 'Nems offerts', type: 'lot' }]), 'Nems offerts')
    assert.equal(lotAccroche([{ libelle: '+10 points', type: 'points' }]), null)
  })

  test('vue publique : id + libellé + type des lots jouables, jamais probabilité, coût ni montant de points', () => {
    const c: Commerce = {
      ...nouveauCommerce('Chez Lin', 'restaurant', ''),
      lots: [
        { libelle: 'Nems offerts', probabilite: 60, coutCentimes: 150 },
        { libelle: 'Lot fantôme', probabilite: 0 },
        { id: 'lot-conso', type: 'points', points: 25, libelle: '+25 points', probabilite: 40 },
      ],
    }
    const pub = commercePublic(c)
    assert.deepEqual(pub.lots, [
      { id: idDeduit(0, 'Nems offerts'), libelle: 'Nems offerts', type: 'lot' },
      { id: 'lot-conso', libelle: '+25 points', type: 'points' },
    ])
    assert.doesNotMatch(JSON.stringify(pub), /probabilite|coutCentimes|"points":25|Lot fantôme/)
  })
})

describe('R1 : la roue retrouve le secteur par l’id du lot tiré', () => {
  const publics: CommercePublic['lots'] = [
    { id: 'lot-nems', libelle: 'Nems', type: 'lot' },
    { id: 'lot-nems-offerts', libelle: 'Nems offerts', type: 'lot' },
    { id: 'lot-the', libelle: 'Thé glacé', type: 'lot' },
  ]

  test('libellés proches : le secteur est celui de l’id, pas d’un libellé voisin', () => {
    const parts = secteurs(publics)
    assert.deepEqual(secteurDuLot(publics, { lot: 'Nems offerts', lotId: 'lot-nems-offerts' }), parts[1])
    assert.deepEqual(secteurDuLot(publics, { lot: 'Nems', lotId: 'lot-nems' }), parts[0])
  })

  test('lots renommés en cours de partie : l’id retrouve le bon secteur, le libellé (nouveau) ne trompe pas la roue', () => {
    const parts = secteurs(publics)
    // Le serveur a tiré « lot-nems » renommé depuis en « Thé glacé » : par libellé, la roue viserait le mauvais secteur.
    assert.deepEqual(secteurDuLot(publics, { lot: 'Thé glacé', lotId: 'lot-nems' }), parts[0])
    // Id inconnu de cette roue (lot ajouté après le chargement) : rien à viser, même si un libellé correspond.
    assert.deepEqual(secteurDuLot(publics, { lot: 'Thé glacé', lotId: 'lot-nouveau' }), null)
  })
})

describe('R1 : serveur (SQLite) — validation, tirage par id, consolation', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-r1-'))
  let app: Awaited<ReturnType<typeof creerServeur>>
  let base = ''
  let n = 0

  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    return { statut: r.status, contenu: await r.json() }
  }
  const patchLots = (lots: unknown) => api('PATCH', `/commerces/${AH}`, { lots }, PIN)
  const lotsEnregistres = async () => (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.commerce.lots as Lot[]
  /** Nouveau client, visite validée, roue tournée : réponse du tirage. */
  async function tirer() {
    const contact = `06${String(10_000_000 + ++n).padStart(8, '0')}`
    const c = (await api('POST', `/commerces/${AH}/clients`, { prenom: `J${n}`, contact }, PIN)).contenu.client as Client
    assert.equal((await api('POST', `/commerces/${AH}/caisse/passage`, { clientId: c.id, actionId: `act-${c.id}` }, CODE)).statut, 200)
    const t = await api('POST', `/commerces/${AH}/tirages`, { contact })
    assert.equal(t.statut, 201, JSON.stringify(t.contenu))
    return { client: c, tirage: t.contenu as { lot: string; lotId: string; type: string; code: string; perdant: boolean } }
  }

  before(async () => {
    app = await creerServeur({ fichierDb: join(dossier, 'r1.db'), adminPin: '98765432', pinInitial: '1234', version: 'test', maintenant: () => new Date(2026, 10, 10, 12) })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
    assert.equal((await api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)).statut, 201)
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('libellés en double refusés (400 explicite), casse et espaces différents compris ; rien n’est écrit', async () => {
    const avant = await lotsEnregistres()
    for (const [a, b] of [
      ['Nems offerts', 'NEMS OFFERTS'],
      ['Nems offerts', '  nems   offerts '],
    ]) {
      const r = await patchLots([
        { libelle: a, probabilite: 50 },
        { libelle: b, probabilite: 50 },
      ])
      assert.equal(r.statut, 400, `${a} / ${b}`)
      assert.match(r.contenu.erreur, /Libellé de lot en double : « nems|Libellé de lot en double : « NEMS/i)
      assert.match(r.contenu.erreur, /majuscules et espaces ne comptent pas/)
    }
    assert.deepEqual(await lotsEnregistres(), avant)
  })

  test('type validé dans l’énumération ; points entiers 1 à 10 000 exigés pour un lot « points »', async () => {
    const lots = (l: object) => [{ libelle: 'Nems offerts', probabilite: 50 }, { libelle: 'Bonus', probabilite: 50, ...l }]
    const bonus = await patchLots(lots({ type: 'bonus' }))
    assert.equal(bonus.statut, 400)
    assert.match(bonus.contenu.erreur, /Lot n° 2 : le type doit valoir lot, points, perdant/)
    for (const points of [undefined, 0, 10_001, 2.5, '10']) {
      const r = await patchLots(lots({ type: 'points', points }))
      assert.equal(r.statut, 400, String(points))
      assert.match(r.contenu.erreur, /Lot n° 2 : un lot « points » doit indiquer un nombre entier de points \(1 à 10/)
    }
    for (const points of [1, 10_000]) assert.equal((await patchLots(lots({ type: 'points', points }))).statut, 200, String(points))
  })

  test('écriture : id généré si absent (aléatoire), gardé s’il est fourni ; type écrit (déduit pour un client d’avant R1)', async () => {
    const r = await patchLots([
      { libelle: 'Nems offerts', probabilite: 40 },
      { id: 'lot-garde', type: 'lot', libelle: 'Thé glacé', probabilite: 30 },
      { libelle: 'Dommage !', probabilite: 20 },
      { id: 'lot-conso', type: 'points', points: 10, libelle: '+10 points', probabilite: 10 },
      { id: 'lot-garde', libelle: 'Mochi', probabilite: 0 },
    ])
    assert.equal(r.statut, 200, JSON.stringify(r.contenu))
    const lots = await lotsEnregistres()
    assert.deepEqual(
      lots.map((l) => [l.libelle, l.type, l.points ?? null]),
      [
        ['Nems offerts', 'lot', null],
        ['Thé glacé', 'lot', null],
        ['Dommage !', 'perdant', null],
        ['+10 points', 'points', 10],
        ['Mochi', 'lot', null],
      ],
    )
    assert.equal(lots[1].id, 'lot-garde')
    assert.equal(lots[3].id, 'lot-conso')
    assert.match(lots[0].id!, /^lot-[0-9a-f-]{13}$/, 'id généré par le serveur (crypto), jamais tiré du libellé')
    assert.notEqual(lots[4].id, 'lot-garde', 'id en double : un nouveau est généré')
    assert.equal(new Set(lots.map((l) => l.id)).size, 5)
    // Probabilités inchangées par la normalisation.
    assert.deepEqual(lots.map((l) => l.probabilite), [40, 30, 20, 10, 0])
  })

  test('tirage par id : lots renommés (et permutés) entre le chargement de la roue et le tirage → bon secteur', async () => {
    assert.equal(
      (
        await patchLots([
          { id: 'lot-a', type: 'lot', libelle: 'Nems offerts', probabilite: 100 },
          { id: 'lot-b', type: 'lot', libelle: 'Thé glacé', probabilite: 1e-9 },
        ])
      ).statut,
      200,
    )
    // La page de jeu a chargé cette roue…
    const roue = (await api('GET', `/commerces/${AH}`)).contenu.commerce as CommercePublic
    assert.deepEqual(roue.lots, [
      { id: 'lot-a', libelle: 'Nems offerts', type: 'lot' },
      { id: 'lot-b', libelle: 'Thé glacé', type: 'lot' },
    ])
    // …puis le commerçant permute les libellés (mêmes ids) avant que le client ne tourne.
    await patchLots([
      { id: 'lot-a', type: 'lot', libelle: 'Thé glacé', probabilite: 100 },
      { id: 'lot-b', type: 'lot', libelle: 'Nems offerts', probabilite: 1e-9 },
    ])
    const { tirage } = await tirer()
    assert.deepEqual([tirage.lot, tirage.lotId, tirage.type, tirage.perdant], ['Thé glacé', 'lot-a', 'lot', false])
    const secteur = secteurDuLot(roue.lots, tirage)
    assert.equal(secteur?.lot.id, 'lot-a', 'secteur du lot tiré (par libellé, la roue aurait visé « Thé glacé » = lot-b)')
    // Le tirage enregistré fige l'id et le type.
    const etat = (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu as { tirages: Tirage[] }
    // R3 : la réponse du tirage ne porte plus de code (burn-on-reveal) — le tirage est retrouvé par son id.
    const enBase = etat.tirages.find((t) => t.id === tirage.tirageId)!
    assert.deepEqual([enBase.lotId, enBase.typeLot], ['lot-a', 'lot'])
  })

  test('config d’avant R1 (sans id ni type) : ids déduits identiques entre la vue publique et le tirage', async () => {
    // Ancienne config écrite directement en base (le serveur, lui, écrit toujours id + type).
    const c = (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.commerce as Commerce
    const ancien = [
      { libelle: 'Lot fantôme', probabilite: 0 },
      { libelle: 'Dommage !', probabilite: 1e-9 },
      { libelle: 'Nems offerts', probabilite: 100 },
    ]
    const db = new DatabaseSync(join(dossier, 'r1.db'))
    try {
      db.prepare('UPDATE commerces SET donnees = ? WHERE id = ?').run(JSON.stringify({ ...c, lots: ancien }), AH)
    } finally {
      db.close()
    }
    assert.ok((await lotsEnregistres()).every((l) => l.id === undefined && l.type === undefined), 'config sans id ni type')
    const roue = (await api('GET', `/commerces/${AH}`)).contenu.commerce as CommercePublic
    assert.deepEqual(roue.lots, [
      { id: idDeduit(1, 'Dommage !'), libelle: 'Dommage !', type: 'perdant' },
      { id: idDeduit(2, 'Nems offerts'), libelle: 'Nems offerts', type: 'lot' },
    ])
    const { tirage } = await tirer()
    assert.deepEqual([tirage.lot, tirage.lotId, tirage.type], ['Nems offerts', idDeduit(2, 'Nems offerts'), 'lot'])
    assert.deepEqual(secteurDuLot(roue.lots, tirage), secteurs(roue.lots)[1])
    // Première écriture par Réglages (qui renvoie les lots normalisés) : les ids déduits sont figés tels quels.
    assert.equal((await patchLots(normaliserLots(ancien))).statut, 200)
    assert.deepEqual((await lotsEnregistres()).map((l) => l.id), normaliserLots(ancien).map((l) => l.id))
  })

  test('consolation « points » : rien à retirer (perdant: true, pas de code servi), statut « consolation » en caisse, pas compté comme gain', async () => {
    await patchLots([
      { id: 'lot-conso', type: 'points', points: 10, libelle: '+10 points', probabilite: 100 },
      { id: 'lot-zero', type: 'lot', libelle: 'Nems offerts', probabilite: 0 },
    ])
    const { client, tirage } = await tirer()
    assert.deepEqual([tirage.lot, tirage.lotId, tirage.type, tirage.perdant], ['+10 points', 'lot-conso', 'points', true])
    // R2 (brief : « aucun code généré pour un tirage points ») : plus de code à vérifier en caisse pour une consolation.
    assert.equal(tirage.code, undefined)
    const etat = (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu as { tirages: Tirage[] }
    const enBase = etat.tirages.find((t) => t.clientId === client.id)!
    assert.deepEqual([enBase.typeLot, enBase.code, statutGain(enBase)], ['points', undefined, 'consolation'])
    const carte = (await api('GET', `/cartes/${client.id}`)).contenu
    assert.equal(carte.jeu.codeDuJour, null)
    assert.deepEqual(carte.historiqueLots, [], 'pas de lot physique dans l’historique')
    // Un perdant explicite au libellé « gagnant » reste perdant ; un « Dommage ! » explicitement « lot » est un gain.
    await patchLots([
      { id: 'lot-p', type: 'perdant', libelle: 'Nems offerts', probabilite: 100 },
      { id: 'lot-z', type: 'lot', libelle: 'Thé', probabilite: 0 },
    ])
    assert.deepEqual((await tirer()).tirage.perdant, true)
    await patchLots([
      { id: 'lot-d', type: 'lot', libelle: 'Dommage !', probabilite: 100 },
      { id: 'lot-z', type: 'lot', libelle: 'Thé', probabilite: 0 },
    ])
    const d = (await tirer()).tirage
    assert.deepEqual([d.type, d.perdant], ['lot', false])
    // R3 : code plus dans la réponse du tirage ; revue Codex R3 (F1) : ni dans l'état commerçant — lu en base. Un gain du
    // jour est « enAttente » (dès demain).
    const codeD = codeEnBase(join(dossier, 'r1.db'), d.tirageId)
    assert.equal((await api('GET', `/commerces/${AH}/caisse/gains/${codeD}`, undefined, CODE)).contenu.gain.statut, 'enAttente')
  })

  test('revue Codex : un ancien client (sans type) ne renverse pas un type choisi ; type reçu prioritaire ; lot nouveau déduit', async () => {
    const config = [
      { id: 'lot-conso', type: 'points', points: 25, libelle: '+10 points', probabilite: 30 },
      { id: 'lot-dommage', type: 'lot', libelle: 'Dommage, encore un nem', probabilite: 20 },
      { id: 'lot-nems', type: 'lot', libelle: 'Nems offerts', probabilite: 50 },
    ]
    const etat = async () => (await lotsEnregistres()).map((l) => [l.id, l.libelle, l.type, l.points ?? null])
    assert.equal((await patchLots(config)).statut, 200)
    // (a) + (b) Ancien front : renvoie les lots sans type ni points (par id).
    const sansType = config.map(({ id, libelle, probabilite }) => ({ id, libelle, probabilite }))
    assert.equal((await patchLots(sansType)).statut, 200)
    const attendu = [
      ['lot-conso', '+10 points', 'points', 25],
      ['lot-dommage', 'Dommage, encore un nem', 'lot', null],
      ['lot-nems', 'Nems offerts', 'lot', null],
    ]
    assert.deepEqual(await etat(), attendu)
    // Sans id non plus (front encore plus ancien) : le libellé (casse et espaces ignorés) retrouve le lot actuel.
    assert.equal((await patchLots([
      { libelle: ' +10 POINTS ', probabilite: 30 },
      { libelle: 'dommage, encore un nem', probabilite: 20 },
      { libelle: 'Nems offerts', probabilite: 50 },
    ])).statut, 200)
    assert.deepEqual((await etat()).map((l) => [l[2], l[3]]), attendu.map((l) => [l[2], l[3]]))
    // Montant reçu sans type : il remplace l'ancien, le type reste hérité.
    const ids = (await lotsEnregistres()).map((l) => l.id)
    assert.equal((await patchLots([{ id: ids[0], libelle: '+10 points', points: 40, probabilite: 30 }, { id: ids[2], libelle: 'Nems offerts', probabilite: 50 }])).statut, 200)
    assert.deepEqual((await etat())[0].slice(2), ['points', 40])
    // (c) Type explicite différent : il gagne, dans les deux sens.
    assert.equal((await patchLots([
      { id: ids[0], type: 'perdant', libelle: '+10 points', probabilite: 30 },
      { id: 'lot-d2', type: 'lot', libelle: 'Dommage !', probabilite: 20 },
      { id: ids[2], type: 'points', points: 5, libelle: 'Nems offerts', probabilite: 50 },
    ])).statut, 200)
    assert.deepEqual((await etat()).map((l) => [l[2], l[3]]), [['perdant', null], ['lot', null], ['points', 5]])
    // (d) Lot entièrement nouveau (id et libellé inconnus) sans type : déduction depuis le libellé, comme avant.
    assert.equal((await patchLots([
      { libelle: 'Pas de chance', probabilite: 50 },
      { id: 'lot-inconnu', libelle: 'Thé glacé', probabilite: 50 },
    ])).statut, 200)
    assert.deepEqual((await etat()).map((l) => [l[1], l[2]]), [['Pas de chance', 'perdant'], ['Thé glacé', 'lot']])
  })
})

describe('R1 : seed, défauts et écrans', () => {
  const commerces = seed.commerces as unknown as Commerce[]

  test('seed : « Dommage ! » devenu la consolation « +10 points » (type points, 10 points, probabilité 30 inchangée)', () => {
    for (const id of ['c-asian-home-paris', 'c-atelier-camille']) {
      const c = commerces.find((x) => x.id === id)!
      const conso = c.lots.filter((l) => l.type === 'points')
      assert.deepEqual(conso, [{ id: 'lot-10-points', type: 'points', points: 10, libelle: '+10 points', probabilite: 30 }], id)
      assert.ok(!c.lots.some((l) => /dommage/i.test(l.libelle)), id)
    }
    // Probabilités du seed inchangées.
    assert.deepEqual(
      commerces.map((c) => c.lots.map((l) => l.probabilite)),
      [
        [20, 25, 15, 10, 30],
        [15, 30, 25, 30],
        [10, 20, 30, 40],
      ],
    )
  })

  test('seed : chaque lot a un id unique et un type ; chaque tirage fige l’id et le type d’un lot existant', () => {
    for (const c of commerces) {
      assert.equal(new Set(c.lots.map((l) => l.id)).size, c.lots.length, c.id)
      assert.ok(c.lots.every((l) => l.id && l.type), c.id)
    }
    const tirages = seed.tirages as unknown as Tirage[]
    for (const t of tirages) {
      const lot = commerces.find((c) => c.id === t.commerceId)!.lots.find((l) => l.id === t.lotId)
      assert.ok(lot, t.id)
      assert.deepEqual([lot.libelle, lot.type], [t.lot, t.typeLot], t.id)
    }
    assert.ok(tirages.some((t) => t.typeLot === 'points'), 'des consolations dans l’historique de démo')
  })

  test('défauts d’un nouveau commerce : ids et types écrits, consolation de 10 points à la place du perdant', () => {
    const lots = nouveauCommerce('Test', 'salon', '').lots
    assert.ok(lots.every((l) => l.id && l.type))
    assert.deepEqual(lots.at(-1), { id: 'lot-10-points', type: 'points', points: 10, libelle: '+10 points', probabilite: 30 })
  })

  test('ancienne règle par libellé : un seul endroit (roulette.ts), réservée aux données sans type', () => {
    for (const f of ['server/app.ts', 'src/pages/Jouer.tsx', 'src/lib/mesure.ts', 'src/data/jeuApi.ts', 'src/lib/lots.ts', 'src/lib/vuePublique.ts']) {
      assert.doesNotMatch(lire(f), /estPerdant|pas de chance\|perdu\|dommage/, f)
    }
    const roulette = lire('src/lib/roulette.ts')
    assert.doesNotMatch(roulette, /estPerdant/)
    assert.equal(roulette.match(/pas de chance\|perdu\|dommage/g)?.length, 1)
    // Le serveur n'applique l'ancienne règle qu'à un lot reçu SANS type (client d'avant R1).
    assert.match(lire('server/app.ts'), /o\.type != null \? \(o\.type as TypeLot\) : typeDeduitDuLibelle\(libelle\)/)
    // La roue en mode serveur vise le secteur par l'id du lot tiré.
    assert.match(lire('src/data/jeuApi.ts'), /secteur: secteurDuLot\(commerce\.lots, resultat\)/)
  })

  test('écrans : résultat selon le type (consolation sans code ni validité) ; Réglages écrit id + type', () => {
    const jouer = lire('src/pages/Jouer.tsx')
    assert.match(jouer, /<Resultat lot=\{gain\.lot\} type=\{gain\.type\}/)
    assert.match(jouer, /<Resultat lot=\{gain\.lot\} type=\{typeTirage\(gain\)\}/)
    assert.match(jouer, /\) : consolation \? \(\n\s*<p className="mt-2 text-sm text-gray-600" data-consolation>/)
    const reglages = lire('src/pages/Reglages.tsx')
    assert.match(reglages, /useState<Lot\[\]>\(\(\) => normaliserLots\(commerce\.lots\)\)/)
    assert.match(reglages, /\{ id: nouvelIdLot\(\), type: 'lot', libelle: '', probabilite: 10 \}/)
    assert.match(reglages, /libellesEnDouble\(lots\)/)
  })
})

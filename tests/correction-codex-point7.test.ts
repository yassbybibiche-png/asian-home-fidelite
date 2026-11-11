// Point Codex 7 — idempotence des actions de caisse au-delà de 50 identifiants. Les identifiants traités étaient
// plafonnés aux 50 derniers par client : un échange rejoué (file hors ligne resynchronisée tard) après plus de 50
// autres actions n'était plus reconnu et débitait une seconde fois. Le plafond couvre désormais la fenêtre de rejeu
// (72 h, `quandAction`). Logique pure (lib/points, lib/programme) + vrai serveur HTTP sur SQLite temporaire.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { ACTIONS_MEMORISEES, actionDejaTraitee, avecAction, echangerPoints, enregistrerPassage } from '../src/lib/points.ts'
import { appliquerVisiteProgramme } from '../src/lib/programme.ts'
import { nouveauClient } from '../src/lib/fidelite.ts'
import { nouveauCommerce } from '../src/data/defaults.ts'
import type { Client, RecompensePoints } from '../src/types.ts'

const JOUR = 86_400_000
const debut = new Date('2026-01-05T12:00:00Z')
const commerce = { ...nouveauCommerce('Test', 'restaurant', ''), id: 'c-test' }
const nems: RecompensePoints = { id: 'rp-nems', nom: '4 nems offerts', cout: 1 }
const id = (i: number) => `act-p7-${String(i).padStart(4, '0')}`

describe('Point 7 : plafond des identifiants d’actions (logique pure)', () => {
  test('le plafond couvre largement plus de 50 actions', () => {
    assert.ok(ACTIONS_MEMORISEES >= 500, `plafond ${ACTIONS_MEMORISEES}`)
  })

  test('60 passages (un par jour) : le rejeu de la toute première action est toujours reconnu', () => {
    let c: Client = nouveauClient(commerce.id, 'Lina', { telephone: '0612345678' }, debut)
    for (let i = 0; i < 60; i++) c = enregistrerPassage(c, commerce, 1000, new Date(debut.getTime() + i * JOUR), id(i))
    assert.equal(c.actionsTraitees?.length, 60, 'aucune éviction à 60')
    assert.equal(actionDejaTraitee(c, id(0)), true, 'la 1re action reste connue')
    assert.equal(actionDejaTraitee(c, id(59)), true)
    assert.equal(actionDejaTraitee(c, 'act-p7-jamais-vue'), false)
  })

  test('même garantie sur le chemin serveur des passages (appliquerVisiteProgramme)', () => {
    let c: Client = nouveauClient(commerce.id, 'Lina', { telephone: '0612345678' }, debut)
    for (let i = 0; i < 60; i++) c = appliquerVisiteProgramme(c, commerce, 1000, new Date(debut.getTime() + i * JOUR), id(i)).client
    assert.equal(c.actionsTraitees?.length, 60, 'programme.ts ne plafonne plus à 50 en dur')
    assert.equal(actionDejaTraitee(c, id(0)), true)
  })

  test('échange puis 60 autres actions : son rejeu est reconnu, donc jamais débité deux fois', () => {
    let c: Client = { ...nouveauClient(commerce.id, 'Lina', { telephone: '0612345678' }, debut), points: 1000 }
    c = echangerPoints(c, nems, 'Mai', debut, 'ech-0', id(0)).client
    for (let i = 1; i <= 60; i++) c = echangerPoints(c, nems, 'Mai', debut, `ech-${i}`, id(i)).client
    const solde = c.points
    assert.equal(solde, 1000 - 61)
    // Le serveur consulte `actionDejaTraitee` AVANT d'appliquer l'action : vrai = réponse « déjà traitée », pas de débit.
    assert.equal(actionDejaTraitee(c, id(0)), true, 'le rejeu du 1er échange est détecté')
  })

  test('le plafond reste un plafond : seuls les ACTIONS_MEMORISEES derniers identifiants sont gardés', () => {
    let c: Client = nouveauClient(commerce.id, 'Lina', { telephone: '0612345678' }, debut)
    for (let i = 0; i < ACTIONS_MEMORISEES + 3; i++) c = avecAction(c, id(i))
    assert.equal(c.actionsTraitees?.length, ACTIONS_MEMORISEES)
    assert.equal(actionDejaTraitee(c, id(2)), false, 'les plus anciens sortent')
    assert.equal(actionDejaTraitee(c, id(3)), true)
    assert.equal(actionDejaTraitee(c, id(ACTIONS_MEMORISEES + 2)), true)
  })
})

describe('Point 7 : serveur — échange rejoué après plus de 50 autres actions', () => {
  const ADMIN = '98765432'
  const AH = 'c-asian-home-paris'
  const PIN = { 'X-Commerce-PIN': '1234' }
  const CODE = { 'X-Equipe-Code': '2468' }
  const horloge = new Date(2026, 10, 9, 12, 0)
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-codex-p7-'))
  let app: Awaited<ReturnType<typeof creerServeur>>
  let base = ''
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, { method: methode, headers: { 'Content-Type': 'application/json', ...entetes }, body: corps === undefined ? undefined : JSON.stringify(corps) })
    return { statut: r.status, contenu: (r.headers.get('content-type') ?? '').includes('json') ? await r.json() : await r.text() }
  }

  before(async () => {
    app = await creerServeur({ fichierDb: join(dossier, 'p7.db'), adminPin: ADMIN, pinInitial: '1234', version: 'test', maintenant: () => horloge })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('le 1er échange, rejoué après 60 autres, répond « déjà traité » sans second débit', async () => {
    assert.equal((await api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)).statut, 201)
    assert.equal((await api('PATCH', `/commerces/${AH}`, { catalogue: [nems] }, PIN)).statut, 200)
    const lina: Client = (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '06 12 34 56 78' }, PIN)).contenu.client
    const faitLe = horloge.toISOString()
    const passage = await api('POST', `/commerces/${AH}/caisse/passage`, { clientId: lina.id, actionId: 'act-p7-passage', faitLe, montantCentimes: 50_000 }, CODE)
    assert.equal(passage.statut, 200)
    assert.ok(passage.contenu.client.points >= 100, `solde ${passage.contenu.client.points}`)

    const echanger = (actionId: string) => api('POST', `/commerces/${AH}/caisse/echange`, { clientId: lina.id, recompenseId: nems.id, actionId, faitLe }, CODE)
    const premier = await echanger(id(0))
    assert.equal(premier.statut, 200)
    for (let i = 1; i <= 60; i++) assert.equal((await echanger(id(i))).statut, 200, `échange ${i}`)
    const fiche = (await api('GET', `/commerces/${AH}/caisse/clients/${lina.id}`, undefined, CODE)).contenu.client
    const solde = fiche.points
    assert.equal(solde, passage.contenu.client.points - 61)
    assert.equal(fiche.echangesPoints.length, 61)

    const rejoue = await echanger(id(0))
    assert.equal(rejoue.statut, 200)
    assert.equal(rejoue.contenu.dejaTraite, true, 'rejeu reconnu malgré plus de 50 actions depuis')
    assert.equal(rejoue.contenu.client.points, solde, 'pas de second débit')
    assert.equal(rejoue.contenu.client.echangesPoints.length, 61, 'pas de second échange tracé')
  })
})

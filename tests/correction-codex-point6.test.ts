// Correction Codex, point 6 — `quandAction` : une action de caisse dont `faitLe` est illisible, trop ancienne (> 72 h)
// ou dans le futur (> 5 min) est refusée en 400 avec un message clair, au lieu d'être comptée « maintenant » en silence.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'

const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const CODE = { 'X-Equipe-Code': '2468' }
const HEURE = 3600_000
const horloge = new Date(2026, 10, 11, 12, 0)

describe('point 6 : date des actions de caisse (faitLe)', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-codex-p6-'))
  let app: Awaited<ReturnType<typeof creerServeur>>
  let base = ''
  const api = async (methode: string, chemin: string, corps: unknown, entetes: Record<string, string>) => {
    const r = await fetch(base + chemin, { method: methode, headers: { 'Content-Type': 'application/json', ...entetes }, body: JSON.stringify(corps) })
    return { statut: r.status, contenu: await r.json() }
  }
  const fiche = async (id: string) => (await fetch(`${base}/commerces/${AH}/caisse/clients/${id}`, { headers: CODE }).then((r) => r.json())).client
  // Un client neuf par test : aucun passage du jour ne vient fausser le résultat.
  let n = 0
  const nouveauClient = async () =>
    (await api('POST', `/commerces/${AH}/clients`, { prenom: `Client${++n}`, contact: `06 12 34 56 ${String(n).padStart(2, '0')}` }, PIN)).contenu.client
  const passage = (clientId: string, actionId: string, faitLe?: unknown) =>
    api('POST', `/commerces/${AH}/caisse/passage`, faitLe === undefined ? { clientId, actionId } : { clientId, actionId, faitLe }, CODE)

  before(async () => {
    app = await creerServeur({ fichierDb: join(dossier, 'p6.db'), adminPin: '98765432', pinInitial: '1234', version: 'test', maintenant: () => horloge })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
    assert.equal((await api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)).statut, 201)
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('faitLe d’il y a 24 h → accepté, visite enregistrée à cette date', async () => {
    const c = await nouveauClient()
    const hier = new Date(horloge.getTime() - 24 * HEURE).toISOString()
    const r = await passage(c.id, 'act-p6-hier', hier)
    assert.equal(r.statut, 200)
    assert.equal(r.contenu.client.tampons, 1)
    assert.deepEqual(r.contenu.client.visites, [hier])
  })

  test('faitLe d’il y a 10 jours → 400 explicite, aucune visite', async () => {
    const c = await nouveauClient()
    const r = await passage(c.id, 'act-p6-ancien', new Date(horloge.getTime() - 10 * 24 * HEURE).toISOString())
    assert.equal(r.statut, 400)
    assert.match(r.contenu.erreur, /trop ancienne/)
    assert.match(r.contenu.erreur, /pas été enregistrée/)
    assert.match(r.contenu.erreur, /fiche du client/)
    const f = await fiche(c.id)
    assert.equal(f.tampons, 0)
    assert.deepEqual(f.visites, [])
  })

  test('faitLe dans le futur (> 5 min) → 400 explicite, aucune visite ; 4 min d’avance tolérées', async () => {
    const c = await nouveauClient()
    const r = await passage(c.id, 'act-p6-futur', new Date(horloge.getTime() + 2 * HEURE).toISOString())
    assert.equal(r.statut, 400)
    assert.match(r.contenu.erreur, /futur/)
    assert.equal((await fiche(c.id)).tampons, 0)
    const proche = new Date(horloge.getTime() + 4 * 60_000).toISOString()
    const ok = await passage(c.id, 'act-p6-futur-proche', proche)
    assert.equal(ok.statut, 200)
    assert.deepEqual(ok.contenu.client.visites, [proche])
  })

  test('faitLe invalide (« nimportequoi ») → 400, aucune visite', async () => {
    const c = await nouveauClient()
    const r = await passage(c.id, 'act-p6-invalide', 'nimportequoi')
    assert.equal(r.statut, 400)
    assert.match(r.contenu.erreur, /illisible/)
    const f = await fiche(c.id)
    assert.equal(f.tampons, 0)
    assert.deepEqual(f.visites, [])
  })

  test('sans faitLe → accepté à l’heure du serveur', async () => {
    const c = await nouveauClient()
    const r = await passage(c.id, 'act-p6-sans-date')
    assert.equal(r.statut, 200)
    assert.deepEqual(r.contenu.client.visites, [horloge.toISOString()])
  })

  test('même actionId rejoué après un refus 400 → toujours refusé, jamais compté', async () => {
    const c = await nouveauClient()
    const ancien = new Date(horloge.getTime() - 10 * 24 * HEURE).toISOString()
    for (let i = 0; i < 3; i++) {
      const r = await passage(c.id, 'act-p6-rejoue', ancien)
      assert.equal(r.statut, 400, `rejeu ${i + 1}`)
    }
    const f = await fiche(c.id)
    assert.equal(f.tampons, 0)
    assert.deepEqual(f.visites, [])
  })

  test('action déjà comptée puis rejouée hors fenêtre → « déjà traitée », pas de 400 ni de double compte', async () => {
    const c = await nouveauClient()
    const hier = new Date(horloge.getTime() - 24 * HEURE).toISOString()
    assert.equal((await passage(c.id, 'act-p6-deja', hier)).statut, 200)
    const rejeu = await passage(c.id, 'act-p6-deja', new Date(horloge.getTime() - 10 * 24 * HEURE).toISOString())
    assert.equal(rejeu.statut, 200)
    assert.equal(rejeu.contenu.dejaTraite, true)
    assert.equal(rejeu.contenu.client.tampons, 1)
  })

  test('les autres actions de caisse (récompense) suivent la même règle', async () => {
    const c = await nouveauClient()
    const r = await api('POST', `/commerces/${AH}/caisse/recompense`, { clientId: c.id, actionId: 'act-p6-recomp', faitLe: 'nimportequoi' }, CODE)
    assert.equal(r.statut, 400)
  })
})

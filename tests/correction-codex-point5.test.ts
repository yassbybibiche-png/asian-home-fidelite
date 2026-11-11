// Correction Codex, point 5 — `validerVisite` : une visite rejouée hors ligne (plus ancienne que la dernière)
// ne fait plus reculer `derniereVisite`, et l'historique des visites reste chronologique.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { nouveauCommerce } from '../src/data/defaults.ts'
import { nouveauClient, validerVisite } from '../src/lib/fidelite.ts'
import { creerServeur } from '../server/app.ts'

const commerce = nouveauCommerce('Test', 'restaurant', '')
const ONZE = new Date('2026-11-11T12:00:00.000Z')
const DIX = new Date('2026-11-10T12:00:00.000Z')

describe('point 5 : validerVisite ne fait jamais reculer la dernière visite', () => {
  test('visite du 11 puis visite du 10 rejouée → dernière visite au 11, historique trié, 2 tampons', () => {
    const client = nouveauClient(commerce.id, 'Lina', { telephone: '06 12 34 56 78' }, DIX)
    const apres11 = validerVisite(client, commerce, ONZE)
    const apres10 = validerVisite(apres11, commerce, DIX)
    assert.equal(apres10.derniereVisite, ONZE.toISOString())
    assert.deepEqual(apres10.visites, [DIX.toISOString(), ONZE.toISOString()])
    assert.equal(apres10.tampons, 2)
  })

  test('client sans visite (derniereVisite null) : comportement inchangé', () => {
    const client = nouveauClient(commerce.id, 'Marc', { email: 'marc@exemple.fr' }, DIX)
    assert.equal(client.derniereVisite, null)
    const apres = validerVisite(client, commerce, DIX)
    assert.equal(apres.derniereVisite, DIX.toISOString())
    assert.deepEqual(apres.visites, [DIX.toISOString()])
    assert.equal(apres.tampons, 1)
  })

  test('visite plus récente : la dernière visite avance normalement', () => {
    const client = validerVisite(nouveauClient(commerce.id, 'Hélène', { telephone: '06 98 76 54 32' }, DIX), commerce, DIX)
    const apres = validerVisite(client, commerce, ONZE)
    assert.equal(apres.derniereVisite, ONZE.toISOString())
    assert.deepEqual(apres.visites, [DIX.toISOString(), ONZE.toISOString()])
    assert.equal(apres.tampons, 2)
  })
})

describe('point 5 : passage en caisse rejoué hors ligne (serveur)', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-codex-p5-'))
  after(() => rmSync(dossier, { recursive: true, force: true }))

  test('passage d’aujourd’hui puis passage rejoué avec faitLe hier → derniereVisite reste aujourd’hui', async () => {
    const AH = 'c-asian-home-paris'
    const PIN = { 'X-Commerce-PIN': '1234' }
    const CODE = { 'X-Equipe-Code': '2468' }
    const horloge = new Date(2026, 10, 11, 12, 0)
    const hier = new Date(horloge.getTime() - 24 * 3600_000)
    const app = await creerServeur({ fichierDb: join(dossier, 'p5.db'), adminPin: '98765432', pinInitial: '1234', version: 'test', maintenant: () => horloge })
    try {
      await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
      const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
      const api = async (methode: string, chemin: string, corps: unknown, entetes: Record<string, string>) => {
        const r = await fetch(base + chemin, { method: methode, headers: { 'Content-Type': 'application/json', ...entetes }, body: JSON.stringify(corps) })
        return { statut: r.status, contenu: await r.json() }
      }
      assert.equal((await api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)).statut, 201)
      const lina = (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '06 12 34 56 78' }, PIN)).contenu.client

      const aujourdhui = await api('POST', `/commerces/${AH}/caisse/passage`, { clientId: lina.id, actionId: 'act-p5-aujourdhui' }, CODE)
      assert.equal(aujourdhui.statut, 200)
      const rejoue = await api('POST', `/commerces/${AH}/caisse/passage`, { clientId: lina.id, actionId: 'act-p5-hier', faitLe: hier.toISOString() }, CODE)
      assert.equal(rejoue.statut, 200)

      const fiche = rejoue.contenu.client
      assert.equal(fiche.tampons, 2)
      assert.equal(fiche.derniereVisite, horloge.toISOString(), 'la visite rejouée ne fait pas reculer la dernière visite')
      assert.deepEqual(fiche.visites, [hier.toISOString(), horloge.toISOString()])
    } finally {
      await app.fermer()
    }
  })
})

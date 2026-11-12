// Item B (améliorations 12/11) : catalogue d'échange de points pré-rempli pour les commerces créés via `nouveauCommerce`,
// accepté tel quel par la validation serveur (`catalogue()` de server/app.ts), jamais injecté dans les commerces existants.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { nouveauCommerce } from '../src/data/defaults.ts'
import type { Commerce, RecompensePoints } from '../src/types.ts'

const ADMIN = '98765432'
const ASIAN_HOME = 'c-asian-home-paris'

describe('Catalogue par défaut — nouveauCommerce', () => {
  test('3 récompenses types, noms et coûts attendus, ids distincts non vides', () => {
    const c = nouveauCommerce('Test', 'restaurant', '')
    assert.ok(c.catalogue)
    assert.equal(c.catalogue.length, 3)
    assert.deepEqual(c.catalogue.map((r) => [r.nom, r.cout]), [['Boisson offerte', 100], ['Dessert offert', 150], ['Remise 10 %', 250]])
    const ids = c.catalogue.map((r) => r.id)
    assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0))
    assert.equal(new Set(ids).size, 3)
  })

  test('ids stables d’un appel à l’autre et chaque commerce a sa propre liste (pas de référence partagée)', () => {
    const a = nouveauCommerce('A', 'restaurant', '')
    const b = nouveauCommerce('B', 'salon', '')
    assert.deepEqual(a.catalogue, b.catalogue)
    assert.notEqual(a.catalogue, b.catalogue)
    a.catalogue![0].cout = 1
    assert.equal(b.catalogue![0].cout, 100)
  })

  test('bornes de la validation serveur respectées (vérification à la main)', () => {
    const cat = nouveauCommerce('Test', 'restaurant', '').catalogue as RecompensePoints[]
    assert.ok(cat.length <= 30)
    for (const r of cat) {
      assert.match(r.id, /^[\w-]{1,60}$/)
      assert.ok(Number.isInteger(r.cout) && r.cout >= 1 && r.cout <= 100_000)
      assert.ok(r.nom.trim().length > 0 && r.nom.length <= 80)
      assert.equal(r.description, undefined)
    }
  })
})

describe('Catalogue par défaut — serveur', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-catalogue-'))
  let app: Awaited<ReturnType<typeof creerServeur>>
  let base = ''

  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    return { statut: r.status, contenu: await r.json() }
  }

  before(async () => {
    app = await creerServeur({ fichierDb: join(dossier, 'fidelite.db'), adminPin: ADMIN, pinInitial: '1234', version: 'test' })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('POST /commerces : le commerce créé reçoit le catalogue par défaut, que la validation des réglages accepte tel quel', async () => {
    const attendu = nouveauCommerce('X', 'autre', '').catalogue
    const r = await api('POST', '/commerces', { nom: 'Chez Lin', type: 'restaurant', pin: '4321' }, { 'X-Admin-PIN': ADMIN })
    assert.equal(r.statut, 201)
    const cree = r.contenu.commerce as Commerce
    assert.deepEqual(cree.catalogue?.map((x) => x.id), ['boisson-offerte', 'dessert-offert', 'remise-10'])
    assert.deepEqual(cree.catalogue, attendu)

    // Renvoyé tel quel dans les réglages : validé par `catalogue()` sans erreur ni réécriture des ids.
    const maj = await api('PATCH', `/commerces/${cree.id}`, { catalogue: cree.catalogue }, { 'X-Commerce-PIN': '4321' })
    assert.equal(maj.statut, 200)
    assert.deepEqual(maj.contenu.commerce.catalogue, attendu)
  })

  test('commerce existant sans catalogue (Asian Home du seed) : rien n’est injecté à la lecture', async () => {
    const etat = await api('GET', `/commerces/${ASIAN_HOME}/etat`, undefined, { 'X-Commerce-PIN': '1234' })
    assert.equal(etat.statut, 200)
    const ah = etat.contenu.commerce as Commerce
    assert.equal(ah.id, ASIAN_HOME)
    assert.ok(ah.lots.length > 0, 'fiche complète relue')
    assert.equal('catalogue' in ah, false)
    assert.deepEqual(ah.catalogue ?? [], [])

    const pub = await api('GET', `/commerces/${ASIAN_HOME}`)
    assert.equal(pub.statut, 200)
    assert.deepEqual(pub.contenu.commerce.catalogue ?? [], [])
  })
})

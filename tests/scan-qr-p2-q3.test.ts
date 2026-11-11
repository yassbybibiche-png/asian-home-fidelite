// P2-Q3 (trou bouché) — Lien court du QR vitrine `/r/<commerceId>` : le scan est compté par le serveur AVANT la
// redirection, donc même si la page de jeu ne se charge jamais. Vrai serveur HTTP sur SQLite temporaire.
// Le QR encodé par l'app (QrVitrine, Roulette) est cette adresse courte ; la page de jeu ne re-signale pas le
// scan quand elle arrive par `?via=qr` (sinon double comptage).
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, type OptionsServeur } from '../server/app.ts'

const RACINE = join(import.meta.dirname, '..')
const source = (f: string) => readFileSync(join(RACINE, f), 'utf8')

const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-q3-r-'))
after(() => rmSync(dossier, { recursive: true, force: true }))
const horloge = new Date('2026-11-10T11:00:00Z')

async function demarrer(fichierDb: string, options: Partial<OptionsServeur> = {}) {
  const app = await creerServeur({ fichierDb, adminPin: ADMIN, pinInitial: '1234', version: 'test', maintenant: () => horloge, ...options })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(`${racine}/api/v1` + chemin, { method: methode, headers: { 'Content-Type': 'application/json', ...entetes }, body: corps === undefined ? undefined : JSON.stringify(corps) })
    return { statut: r.status, contenu: await r.json() }
  }
  return { app, api, racine }
}

async function compteurs(api: Awaited<ReturnType<typeof demarrer>>['api']) {
  const m = await api('GET', `/commerces/${AH}/mesures`, undefined, PIN)
  assert.equal(m.statut, 200)
  return m.contenu.compteurs as { jour: string; type: string; n: number }[]
}

describe('Lien court du QR vitrine /r/<commerceId> : scan compté avant la redirection', () => {
  test('GET /r/<id> : 302 vers /?via=qr#/jouer/<id> (no-store), scan compté une fois', async () => {
    const { app, api, racine } = await demarrer(join(dossier, 'r.db'))
    try {
      const r = await fetch(`${racine}/r/${AH}`, { redirect: 'manual' })
      assert.equal(r.status, 302)
      assert.equal(r.headers.get('location'), `/?via=qr#/jouer/${AH}`)
      assert.equal(r.headers.get('cache-control'), 'no-store')
      assert.deepEqual(await compteurs(api), [{ jour: '2026-11-10', type: 'scan', n: 1 }])
      // Deuxième scan : compté aussi (un scan = une ouverture, pas une déduplication par IP).
      await fetch(`${racine}/r/${AH}`, { redirect: 'manual' })
      assert.deepEqual(await compteurs(api), [{ jour: '2026-11-10', type: 'scan', n: 2 }])
    } finally {
      await app.fermer()
    }
  })

  test('commerce inconnu ou en pause : redirection quand même, rien compté', async () => {
    const { app, api, racine } = await demarrer(join(dossier, 'r-inconnu.db'))
    try {
      const r = await fetch(`${racine}/r/inconnu`, { redirect: 'manual' })
      assert.equal(r.status, 302)
      assert.equal(r.headers.get('location'), '/?via=qr#/jouer/inconnu')
      assert.deepEqual(await compteurs(api), [])
      assert.equal((await api('PATCH', `/commerces/${AH}`, { actif: false }, PIN)).statut, 200)
      assert.equal((await fetch(`${racine}/r/${AH}`, { redirect: 'manual' })).status, 302)
      assert.deepEqual(await compteurs(api), [])
    } finally {
      await app.fermer()
    }
  })

  test('HEAD : redirection sans compter (sonde) ; limite par IP dépassée : redirection sans compter, jamais d’erreur', async () => {
    const { app, api, racine } = await demarrer(join(dossier, 'r-limite.db'), { limitesPubliques: { evenementParIp: 2 } })
    try {
      assert.equal((await fetch(`${racine}/r/${AH}`, { method: 'HEAD', redirect: 'manual' })).status, 302)
      assert.deepEqual(await compteurs(api), [])
      assert.equal((await fetch(`${racine}/r/${AH}`, { redirect: 'manual' })).status, 302)
      assert.equal((await fetch(`${racine}/r/${AH}`, { redirect: 'manual' })).status, 302)
      assert.equal((await fetch(`${racine}/r/${AH}`, { redirect: 'manual' })).status, 302, 'au-delà de la limite : toujours 302')
      assert.deepEqual(await compteurs(api), [{ jour: '2026-11-10', type: 'scan', n: 2 }])
    } finally {
      await app.fermer()
    }
  })
})

describe('QR vitrine : l’app encode l’adresse courte /r/ (pas le fragment direct)', () => {
  test('router : urlQrJeu(<id>) = <origine>/r/<id>', () => {
    const router = source('src/router.ts')
    assert.match(router, /export function urlQrJeu\(commerceId: string\): string \{/)
    assert.match(router, /`\$\{window\.location\.origin\}\/r\/\$\{encodeURIComponent\(commerceId\)\}`/)
  })

  test('QrVitrine et Roulette : même QR (urlQrJeu), lien de test direct inchangé', () => {
    assert.match(source('src/pages/QrVitrine.tsx'), /const url = urlQrJeu\(commerce\.id\)/)
    assert.match(source('src/pages/QrVitrine.tsx'), /Chaque scan est compté, même si la page ne se charge pas/)
    assert.match(source('src/pages/Roulette.tsx'), /const url = urlQrJeu\(commerce\.id\)/)
    assert.match(source('src/pages/Roulette.tsx'), /href=\{`#\/jouer\/\$\{commerce\.id\}`\}/, 'le bouton « Ouvrir la page client » reste direct')
    // Le lien de parrainage (partage direct, avec ?parrain=) n'est pas le QR vitrine : inchangé.
    assert.match(source('src/components/CarteFidelite.tsx'), /urlAbsolue\('jouer', commerce\.id\)\}\?parrain=/)
  })

  test('robots.txt : /r/ interdit aux robots (un passage de robot ne doit pas compter comme un scan)', () => {
    const robots = source('public/robots.txt')
    assert.match(robots, /^Disallow: \/r\/$/m)
    assert.match(robots, /^Disallow: \/api\/$/m)
  })
})

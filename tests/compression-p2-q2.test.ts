// P2-Q2 — Performance : compression gzip / brotli côté serveur (server/app.ts, envoyerCorps).
// Requêtes HTTP brutes (node:http, sans décompression automatique) : l'en-tête Content-Encoding et le
// contenu décompressé sont vérifiés. Le build Vite est relancé ici (≈ 2 s), comme dans
// performance-bundle-p2-q2.test.ts. Le hors-ligne lui-même (CacheStorage, service worker) est couvert
// par les tests existants (performance-bundle-p2-q2, carte-pwa-p1-c3) : ce fichier vérifie le contrat
// côté serveur dont il dépend — sans Accept-Encoding, la réponse est en identité (le service worker
// met en cache l'original, jamais une variante compressée qu'il ne saurait décompresser).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { menuReelAsianHome } from '../src/data/menu-reel.ts'

const RACINE = join(import.meta.dirname, '..')
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p2-q2-compression-'))
const BUILD = join(dossier, 'dist')
after(() => rmSync(dossier, { recursive: true, force: true }))

const AH = 'c-asian-home-paris'
const FRONT = 'https://asian-home-fidelite.onrender.com'

/** Requête HTTP brute (pas de décompression automatique) : statut, en-têtes, corps tel qu'envoyé. */
function brut(
  racine: string,
  chemin: string,
  entetes: Record<string, string> = {},
  methode = 'GET',
): Promise<{ statut: number; entetes: Record<string, string | string[] | undefined>; corps: Buffer }> {
  return new Promise((ok, ko) => {
    const req = httpRequest(`${racine}${chemin}`, { method: methode, headers: entetes }, (res) => {
      const morceaux: Buffer[] = []
      res.on('data', (m: Buffer) => morceaux.push(m))
      res.on('end', () => ok({ statut: res.statusCode ?? 0, entetes: res.headers, corps: Buffer.concat(morceaux) }))
      res.on('error', ko)
    })
    req.on('error', ko)
    req.end()
  })
}

describe('P2-Q2 : compression gzip / brotli côté serveur', () => {
  before(async () => {
    const { build } = await import('vite')
    await build({ root: RACINE, configFile: join(RACINE, 'vite.config.ts'), logLevel: 'silent', build: { outDir: BUILD, emptyOutDir: true } })
  })

  // Le plus gros JS du build (chunk initial, > 100 Ko) et une image déjà compressée.
  const grosJs = () => {
    const fichiers = readdirSync(join(BUILD, 'assets')).filter((f) => f.endsWith('.js'))
    const trie = fichiers.map((f) => ({ f, octets: readFileSync(join(BUILD, 'assets', f)).length })).sort((a, b) => b.octets - a.octets)
    return trie[0]
  }
  const image = () => {
    const visuels = join(BUILD, 'visuels')
    if (!existsSync(visuels)) return null
    const fichiers = readdirSync(visuels).filter((f) => /\.(webp|png|jpg)$/.test(f))
    if (fichiers.length === 0) return null
    return { f: `visuels/${fichiers[0]}`, octets: readFileSync(join(BUILD, 'visuels', fichiers[0])).length }
  }

  test('statique : brotli préféré si accepté, gzip sinon, identité sans Accept-Encoding', async () => {
    const app = await creerServeur({ fichierDb: join(dossier, 'br.db'), adminPin: '98765432', pinInitial: '1234', version: 'test', dossierStatique: BUILD })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
    try {
      const { f, octets } = grosJs()
      const attendu = readFileSync(join(BUILD, 'assets', f))
      assert.ok(octets > 1024, `${f} : ${octets} o (seuil 1 024 o)`)

      const rBr = await brut(racine, `/assets/${f}`, { 'Accept-Encoding': 'br, gzip' })
      assert.equal(rBr.statut, 200, f)
      assert.equal(rBr.entetes['content-encoding'], 'br')
      assert.match(String(rBr.entetes.vary ?? ''), /Accept-Encoding/)
      assert.ok(rBr.corps.length < octets, `br ${rBr.corps.length} o < ${octets} o`)
      assert.equal(Number(rBr.entetes['content-length']), rBr.corps.length)
      assert.deepEqual(brotliDecompressSync(rBr.corps), attendu)

      // Deuxième demande : même variante (cache en mémoire, par ETag).
      const rBr2 = await brut(racine, `/assets/${f}`, { 'Accept-Encoding': 'br' })
      assert.deepEqual(rBr2.corps, rBr.corps)

      const rGzip = await brut(racine, `/assets/${f}`, { 'Accept-Encoding': 'gzip' })
      assert.equal(rGzip.entetes['content-encoding'], 'gzip')
      assert.ok(rGzip.corps.length < octets, `gzip ${rGzip.corps.length} o < ${octets} o`)
      assert.deepEqual(gunzipSync(rGzip.corps), attendu)

      // Sans Accept-Encoding (service worker hors ligne, fetchFaux des tests) : identité.
      const rNu = await brut(racine, `/assets/${f}`)
      assert.equal(rNu.entetes['content-encoding'], undefined)
      assert.deepEqual(rNu.corps, attendu)
      assert.match(String(rNu.entetes.vary ?? ''), /Accept-Encoding/, 'Vary présent même en identité')

      // q=0 respecté : br exclu, gzip exclu → identité ; br exclu, gzip accepté → gzip.
      const rQ0 = await brut(racine, `/assets/${f}`, { 'Accept-Encoding': 'br;q=0, gzip;q=0' })
      assert.equal(rQ0.entetes['content-encoding'], undefined)
      const rBrQ0 = await brut(racine, `/assets/${f}`, { 'Accept-Encoding': 'br;q=0, gzip' })
      assert.equal(rBrQ0.entetes['content-encoding'], 'gzip')
    } finally {
      await app.fermer()
    }
  })

  test('négociation : joker, casse, qualités mal formées, préférence client (revue Codex P2-Q2)', async () => {
    const app = await creerServeur({ fichierDb: join(dossier, 'nego.db'), adminPin: '98765432', pinInitial: '1234', version: 'test', dossierStatique: BUILD })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
    try {
      const { f } = grosJs()
      const codage = async (ae: string) => (await brut(racine, `/assets/${f}`, { 'Accept-Encoding': ae })).entetes['content-encoding']
      // L'explicite prime sur le joker : br et gzip exclus → identité, même avec `*`.
      assert.equal(await codage('*, br;q=0, gzip;q=0'), undefined)
      // Joker paramétré : n'importe quel codage à q=0,5 → brotli (préférence serveur à égalité).
      assert.equal(await codage('*;q=0.5'), 'br')
      // Casse ignorée (noms de codages insensibles à la casse, RFC 9110).
      assert.equal(await codage('BR, GZIP'), 'br')
      // Qualité mal formée : codage non accepté.
      assert.equal(await codage('br;q=oops'), undefined)
      assert.equal(await codage('br;q=-1'), undefined)
      // La plus forte qualité gagne : le client préfère gzip → gzip, pas brotli.
      assert.equal(await codage('br;q=0.1, gzip;q=1'), 'gzip')
      assert.equal(await codage('br;q=0.5, gzip;q=0.5'), 'br')
    } finally {
      await app.fermer()
    }
  })

  test('statique : 304 inchangée même avec Accept-Encoding ; HEAD sans corps', async () => {
    const app = await creerServeur({ fichierDb: join(dossier, '304.db'), adminPin: '98765432', pinInitial: '1234', version: 'test', dossierStatique: BUILD })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
    try {
      const { f } = grosJs()
      const r = await brut(racine, `/assets/${f}`, { 'Accept-Encoding': 'br' })
      const balise = String(r.entetes.etag ?? '')
      assert.ok(balise, 'ETag')
      const r304 = await brut(racine, `/assets/${f}`, { 'Accept-Encoding': 'br', 'If-None-Match': balise })
      assert.equal(r304.statut, 304)
      assert.equal(r304.entetes['content-encoding'], undefined, 'pas de compression sur une 304')
      assert.equal(r304.corps.length, 0)
      assert.match(String(r304.entetes.vary ?? ''), /Accept-Encoding/, 'Vary sur la 304 aussi')

      const rHead = await brut(racine, `/assets/${f}`, { 'Accept-Encoding': 'br' }, 'HEAD')
      assert.equal(rHead.statut, 200)
      // HEAD : exactement les mêmes en-têtes que GET (revue Codex P2-Q2) — Content-Encoding
      // et Content-Length compressé — sans corps.
      assert.equal(rHead.entetes['content-encoding'], 'br')
      assert.equal(rHead.entetes['content-length'], r.entetes['content-length'])
      assert.equal(rHead.corps.length, 0)
    } finally {
      await app.fermer()
    }
  })

  test('statique : images déjà compressées jamais recompressées', async () => {
    const img = image()
    if (!img) {
      // Pas de visuel dans ce build : le test ne peut rien vérifier.
      assert.ok(true, 'aucun visuel dans le build')
      return
    }
    const app = await creerServeur({ fichierDb: join(dossier, 'img.db'), adminPin: '98765432', pinInitial: '1234', version: 'test', dossierStatique: BUILD })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
    try {
      assert.ok(img.octets > 1024, `${img.f} : ${img.octets} o`)
      const r = await brut(racine, `/${img.f}`, { 'Accept-Encoding': 'br, gzip' })
      assert.equal(r.statut, 200)
      assert.equal(r.entetes['content-encoding'], undefined, `${img.f} : pas de compression`)
      assert.deepEqual(r.corps, readFileSync(join(BUILD, img.f)))
    } finally {
      await app.fermer()
    }
  })

  test('Vary : Accept-Encoding fusionné avec Vary: Origin du CORS, jamais remplacé', async () => {
    const app = await creerServeur({
      fichierDb: join(dossier, 'vary.db'),
      adminPin: '98765432',
      pinInitial: '1234',
      version: 'test',
      dossierStatique: BUILD,
      origineCors: FRONT,
    })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
    try {
      const { f } = grosJs()
      const r = await brut(racine, `/assets/${f}`, { 'Accept-Encoding': 'br', Origin: FRONT })
      assert.match(String(r.entetes.vary ?? ''), /Origin/, 'Vary: Origin conservé')
      assert.match(String(r.entetes.vary ?? ''), /Accept-Encoding/, 'Vary: Accept-Encoding ajouté')
      assert.equal(r.entetes['access-control-allow-origin'], FRONT)
    } finally {
      await app.fermer()
    }
  })

  test('API JSON : menu public compressé en brotli, petite réponse (/sante) en identité', async () => {
    const app = await creerServeur({
      fichierDb: join(dossier, 'api.db'),
      adminPin: '98765432',
      pinInitial: '1234',
      version: 'test',
      dossierStatique: BUILD,
      limitesPubliques: { inscriptionParIp: 1000, inscriptionParContact: 1000, ficheClientParIp: 1000, lectureParIp: 1000, lectureParCarte: 1000, tirageParIp: 1000, tirageParContact: 1000 },
    })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
    try {
      // Le menu en base est vide au départ (le front replie sur le menu réel en dur) : le gérant
      // publie d'abord la carte officielle (81 plats) pour obtenir une grosse réponse JSON.
      const officiel = menuReelAsianHome()
      const publie = await fetch(`${racine}/api/v1/commerces/${AH}/menu`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Commerce-PIN': '1234' },
        body: JSON.stringify({ categories: officiel.categories }),
      })
      assert.equal(publie.status, 200, 'publication du menu')
      await publie.arrayBuffer()

      const rMenu = await brut(racine, `/api/v1/commerces/${AH}/menu`, { 'Accept-Encoding': 'br, gzip' })
      assert.equal(rMenu.statut, 200, 'menu public')
      assert.equal(rMenu.entetes['content-encoding'], 'br')
      const menu = JSON.parse(brotliDecompressSync(rMenu.corps).toString('utf8')) as { menu: { categories: unknown[] } }
      assert.ok(Array.isArray(menu.menu.categories) && menu.menu.categories.length > 0, 'menu décompressé lisible')

      const rMenuGzip = await brut(racine, `/api/v1/commerces/${AH}/menu`, { 'Accept-Encoding': 'gzip' })
      assert.equal(rMenuGzip.entetes['content-encoding'], 'gzip')
      assert.deepEqual(JSON.parse(gunzipSync(rMenuGzip.corps).toString('utf8')), menu)

      // Petite réponse (< 1 024 o) : identité même si le client accepte brotli.
      const rSante = await brut(racine, '/api/v1/sante', { 'Accept-Encoding': 'br, gzip' })
      assert.equal(rSante.statut, 200)
      assert.equal(rSante.entetes['content-encoding'], undefined, `/sante : ${rSante.corps.length} o, sous le seuil`)
    } finally {
      await app.fermer()
    }
  })

  test('API CSV : export clients compressé en brotli (revue Codex P2-Q2)', async () => {
    const app = await creerServeur({
      fichierDb: join(dossier, 'csv.db'),
      adminPin: '98765432',
      pinInitial: '1234',
      version: 'test',
      dossierStatique: BUILD,
      limitesPubliques: { inscriptionParIp: 1000, inscriptionParContact: 1000, ficheClientParIp: 1000, lectureParIp: 1000, lectureParCarte: 1000, tirageParIp: 1000, tirageParContact: 1000 },
    })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
    try {
      // 20 clients pour dépasser le seuil de 1 024 o.
      for (let i = 1; i <= 20; i++) {
        const inscrit = await fetch(`${racine}/api/v1/commerces/${AH}/clients`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prenom: `Client${i}`, contact: `06 10 00 00 ${String(i).padStart(2, '0')}` }),
        })
        assert.equal(inscrit.status, 201, `inscription ${i}`)
        await inscrit.arrayBuffer()
      }
      const rCsv = await brut(racine, `/api/v1/commerces/${AH}/export.csv`, { 'Accept-Encoding': 'br, gzip', 'X-Commerce-PIN': '1234' })
      assert.equal(rCsv.statut, 200, 'export CSV')
      assert.equal(rCsv.entetes['content-encoding'], 'br')
      assert.match(String(rCsv.entetes['content-disposition'] ?? ''), /attachment; filename="clients-/)
      const csv = brotliDecompressSync(rCsv.corps).toString('utf8')
      assert.ok(csv.length > 1024, `CSV décompressé : ${csv.length} o`)
      assert.ok(csv.includes('Client1') && csv.includes('Client20'), 'les 20 clients dans le CSV')
    } finally {
      await app.fermer()
    }
  })
})

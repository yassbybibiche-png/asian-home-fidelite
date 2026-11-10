// P0-S4 (audit du 10/11/2026, faille F-08) : durcissement HTTP — en-têtes de sécurité sur toutes les réponses, CORS
// strict (CORS_ORIGIN), cache des fichiers statiques. Vrai serveur HTTP + base SQLite temporaire + un dossier statique
// temporaire qui imite dist/ (index.html, assets/ avec hash, visuels/).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, CSP, ENTETES_SECURITE, lireOrigineCors, type OptionsServeur } from '../server/app.ts'

const RACINE = join(import.meta.dirname, '..')
const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const FRONT = 'https://asian-home-fidelite.onrender.com'

const dossier = mkdtempSync(join(tmpdir(), 'fidelite-s4-'))
const statique = join(dossier, 'dist')
const JS = '/assets/index-Ab12Cd34.js'
mkdirSync(join(statique, 'assets'), { recursive: true })
mkdirSync(join(statique, 'visuels'))
writeFileSync(join(statique, 'index.html'), '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-Ab12Cd34.js"></script></head><body><div id="root"></div></body></html>')
writeFileSync(join(statique, JS.slice(1)), 'console.log("front")')
writeFileSync(join(statique, 'visuels', 'logo.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0]))

async function demarrer(nom: string, options: Partial<OptionsServeur> = {}) {
  const app = await creerServeur({ fichierDb: join(dossier, nom), adminPin: ADMIN, pinInitial: '1234', version: 'test', dossierStatique: statique, ...options })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
  const get = (chemin: string, init: RequestInit = {}) => fetch(racine + chemin, init)
  return { app, get }
}

function verifierSecurite(r: Response, quoi: string) {
  for (const [nom, valeur] of Object.entries(ENTETES_SECURITE)) assert.equal(r.headers.get(nom), valeur, `${quoi} : ${nom}`)
}

after(() => rmSync(dossier, { recursive: true, force: true }))

describe('P0-S4 : en-têtes de sécurité sur toutes les réponses', () => {
  let srv: Awaited<ReturnType<typeof demarrer>>
  before(async () => (srv = await demarrer('entetes.db')))
  after(() => srv.app.fermer())

  test('valeurs attendues (CSP, HSTS sans preload, DENY, nosniff, Referrer-Policy, caméra seule autorisée)', () => {
    assert.equal(ENTETES_SECURITE['Strict-Transport-Security'], 'max-age=31536000; includeSubDomains')
    assert.equal(ENTETES_SECURITE['X-Frame-Options'], 'DENY')
    assert.equal(ENTETES_SECURITE['X-Content-Type-Options'], 'nosniff')
    assert.equal(ENTETES_SECURITE['Referrer-Policy'], 'same-origin')
    const pp = ENTETES_SECURITE['Permissions-Policy']
    assert.match(pp, /(^|, )camera=\(self\)/)
    for (const coupee of ['microphone', 'geolocation', 'payment']) assert.match(pp, new RegExp(`${coupee}=\\(\\)`))
    const directives = new Map(CSP.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1).join(' ')]))
    assert.equal(directives.get('default-src'), "'self'")
    assert.equal(directives.get('script-src'), "'self'", 'aucun script inline ni eval')
    assert.equal(directives.get('style-src'), "'self'", "pas de 'unsafe-inline'")
    assert.equal(directives.get('img-src'), "'self' data: https:", 'photos base64 + adresses https des commerçants')
    assert.equal(directives.get('connect-src'), "'self'")
    assert.equal(directives.get('object-src'), "'none'")
    assert.equal(directives.get('frame-ancestors'), "'none'")
    assert.equal(directives.get('base-uri'), "'self'")
    assert.doesNotMatch(CSP, /unsafe-(inline|eval)/)
  })

  test('GET /api/v1/sante : en-têtes + no-store', async () => {
    const r = await srv.get('/api/v1/sante')
    assert.equal(r.status, 200)
    verifierSecurite(r, '/sante')
    assert.equal(r.headers.get('cache-control'), 'no-store')
  })

  test('route publique (GET /commerces/:id) : en-têtes + no-store', async () => {
    const r = await srv.get(`/api/v1/commerces/${AH}`)
    assert.equal(r.status, 200)
    verifierSecurite(r, 'route publique')
    assert.equal(r.headers.get('cache-control'), 'no-store')
  })

  test('erreurs JSON (404 API, 404 hors API, 401) : en-têtes + no-store', async () => {
    for (const [chemin, statut] of [['/api/v1/inconnue', 404], ['/api/autre', 404], [`/api/v1/commerces/${AH}/etat`, 401]] as const) {
      const r = await srv.get(chemin)
      assert.equal(r.status, statut, chemin)
      verifierSecurite(r, chemin)
      assert.equal(r.headers.get('cache-control'), 'no-store', chemin)
      assert.match(r.headers.get('content-type') ?? '', /json/)
    }
  })

  test('export CSV : en-têtes + no-store', async () => {
    const r = await srv.get(`/api/v1/commerces/${AH}/export.csv`, { headers: { 'X-Commerce-PIN': '1234' } })
    assert.equal(r.status, 200)
    assert.match(r.headers.get('content-type') ?? '', /text\/csv/)
    verifierSecurite(r, 'CSV')
    assert.equal(r.headers.get('cache-control'), 'no-store')
  })

  test('index.html servi (/ et route inconnue du front) : en-têtes + no-cache + ETag', async () => {
    for (const chemin of ['/', '/index.html', '/une/route/du/front']) {
      const r = await srv.get(chemin)
      assert.equal(r.status, 200, chemin)
      assert.match(r.headers.get('content-type') ?? '', /text\/html/)
      verifierSecurite(r, chemin)
      assert.equal(r.headers.get('cache-control'), 'no-cache', chemin)
      assert.match(r.headers.get('etag') ?? '', /^W\/"[0-9a-f]+-[0-9a-f]+"$/)
      assert.match(await r.text(), /id="root"/)
    }
  })

  test('asset JS avec hash : en-têtes + immutable 1 an, type JavaScript', async () => {
    const r = await srv.get(JS)
    assert.equal(r.status, 200)
    verifierSecurite(r, 'asset JS')
    assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    assert.equal(r.headers.get('content-type'), 'text/javascript; charset=utf-8')
    assert.equal(await r.text(), 'console.log("front")')
  })

  test('asset absent (ancien déploiement) : 404, pas index.html mis en cache', async () => {
    const r = await srv.get('/assets/index-Ancien00.js')
    assert.equal(r.status, 404)
    verifierSecurite(r, 'asset absent')
    assert.equal(r.headers.get('cache-control'), 'no-store')
  })

  test('visuel : max-age 1 h, type image/jpeg (nosniff exige le bon type), 304 sur If-None-Match', async () => {
    const r = await srv.get('/visuels/logo.jpg')
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('content-type'), 'image/jpeg')
    assert.equal(r.headers.get('cache-control'), 'public, max-age=3600')
    const balise = r.headers.get('etag')!
    assert.ok(balise)
    await r.arrayBuffer()
    for (const inm of [balise, balise.replace(/^W\//, ''), `"autre", ${balise}`]) {
      const r2 = await srv.get('/visuels/logo.jpg', { headers: { 'If-None-Match': inm } })
      assert.equal(r2.status, 304, inm)
      assert.equal(r2.headers.get('etag'), balise)
      assert.equal(r2.headers.get('cache-control'), 'public, max-age=3600')
      verifierSecurite(r2, '304')
      assert.equal(await r2.text(), '')
    }
    const r3 = await srv.get('/visuels/logo.jpg', { headers: { 'If-None-Match': 'W/"0-0"' } })
    assert.equal(r3.status, 200)
    await r3.arrayBuffer()
  })

  test('index.html : 304 sur If-None-Match (déploiement inchangé)', async () => {
    const r = await srv.get('/')
    await r.text()
    const r2 = await srv.get('/', { headers: { 'If-None-Match': r.headers.get('etag')! } })
    assert.equal(r2.status, 304)
    assert.equal(r2.headers.get('cache-control'), 'no-cache')
  })

  test('preflight OPTIONS : en-têtes de sécurité aussi, X-Session autorisé', async () => {
    const r = await srv.get('/api/v1/sessions', { method: 'OPTIONS' })
    assert.equal(r.status, 204)
    verifierSecurite(r, 'OPTIONS')
    assert.match(r.headers.get('access-control-allow-headers') ?? '', /X-Session/)
  })
})

describe('P0-S4 : CORS', () => {
  test('sans CORS_ORIGIN : * comme avant (développement)', async () => {
    const { app, get } = await demarrer('cors-ouvert.db')
    try {
      const r = await get('/api/v1/sante', { headers: { Origin: 'http://localhost:5173' } })
      assert.equal(r.headers.get('access-control-allow-origin'), '*')
    } finally {
      await app.fermer()
    }
  })

  describe(`avec CORS_ORIGIN = ${FRONT}`, () => {
    let srv: Awaited<ReturnType<typeof demarrer>>
    before(async () => (srv = await demarrer('cors-strict.db', { origineCors: FRONT })))
    after(() => srv.app.fermer())

    test('origine autorisée → Access-Control-Allow-Origin = cette origine, Vary: Origin', async () => {
      const r = await srv.get('/api/v1/sante', { headers: { Origin: FRONT } })
      assert.equal(r.status, 200)
      assert.equal(r.headers.get('access-control-allow-origin'), FRONT)
      assert.match(r.headers.get('vary') ?? '', /Origin/)
      verifierSecurite(r, 'CORS autorisé')
    })

    test('preflight de l’origine autorisée → 204 avec Allow-Origin, méthodes et X-Session', async () => {
      const r = await srv.get(`/api/v1/commerces/${AH}/etat`, {
        method: 'OPTIONS',
        headers: { Origin: FRONT, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-session' },
      })
      assert.equal(r.status, 204)
      assert.equal(r.headers.get('access-control-allow-origin'), FRONT)
      assert.match(r.headers.get('access-control-allow-headers') ?? '', /X-Session/)
      assert.match(r.headers.get('access-control-allow-methods') ?? '', /PATCH/)
    })

    test('origine étrangère (y compris préfixe / suffixe / http) → aucun en-tête CORS, jamais de reflet', async () => {
      for (const origine of ['https://pirate.example', `${FRONT}.pirate.example`, 'https://asian-home-fidelite.onrender.co', FRONT.replace('https:', 'http:'), 'null']) {
        for (const method of ['GET', 'OPTIONS']) {
          const r = await srv.get('/api/v1/sante', { method, headers: { Origin: origine } })
          assert.equal(r.headers.get('access-control-allow-origin'), null, `${method} ${origine}`)
          assert.equal(r.headers.get('access-control-allow-headers'), null, `${method} ${origine}`)
          verifierSecurite(r, `${method} ${origine}`)
          await r.arrayBuffer()
        }
      }
    })

    test('sans Origin (curl, même origine) → réponse normale', async () => {
      const r = await srv.get(`/api/v1/commerces/${AH}`)
      assert.equal(r.status, 200)
      assert.equal(r.headers.get('access-control-allow-origin'), null)
      assert.equal((await r.json()).commerce.id, AH)
      const f = await srv.get('/')
      assert.equal(f.status, 200)
      await f.text()
    })
  })

  test('lireOrigineCors : origine exacte normalisée, sinon erreur', () => {
    assert.equal(lireOrigineCors('*'), '*')
    assert.equal(lireOrigineCors(` ${FRONT} `), FRONT)
    assert.equal(lireOrigineCors(`${FRONT}/`), FRONT, '/ final toléré')
    assert.equal(lireOrigineCors('http://localhost:5173'), 'http://localhost:5173')
    for (const mauvaise of ['asian-home-fidelite.onrender.com', `${FRONT}/api/v1`, `${FRONT}?x=1`, 'ftp://exemple.fr', `${FRONT}, https://autre.fr`, 'null']) {
      assert.throws(() => lireOrigineCors(mauvaise), /CORS_ORIGIN invalide/, mauvaise)
    }
  })

  test('creerServeur refuse une origine invalide', async () => {
    await assert.rejects(creerServeur({ fichierDb: join(dossier, 'cors-ko.db'), adminPin: ADMIN, origineCors: 'pas une origine' }), /CORS_ORIGIN invalide/)
  })
})

describe('P0-S4 : server/index.ts et CORS_ORIGIN en production', () => {
  function lancer(variables: Record<string, string>) {
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      RENDER: '1',
      ADMIN_PIN: '24681357',
      PIN_ASIAN_HOME: '1357',
      SESSION_SECRET: 'x'.repeat(40),
      DB_FILE: join(dossier, `prod-${Object.keys(variables).length}-${Math.random().toString(36).slice(2)}.db`),
      STATIC_DIR: join(dossier, 'pas-de-front'),
      PORT: '0',
      ...variables,
    }
    const enfant = spawn(process.execPath, [join(RACINE, 'server', 'index.ts')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let sortie = ''
    enfant.stdout.on('data', (d) => (sortie += d))
    enfant.stderr.on('data', (d) => (sortie += d))
    const resultat = new Promise<{ demarre: boolean; code?: number | null }>((ok, ko) => {
      const minuterie = setTimeout(() => ko(new Error(`ni démarré ni arrêté : ${sortie}`)), 20_000)
      enfant.stdout.on('data', () => {
        if (sortie.includes('/api/v1/sante')) {
          clearTimeout(minuterie)
          ok({ demarre: true })
        }
      })
      enfant.on('exit', (code) => {
        clearTimeout(minuterie)
        ok({ demarre: false, code })
      })
    })
    return { enfant, resultat, sortie: () => sortie }
  }

  test('absente → démarre QUAND MÊME, avec avertissement', async () => {
    const l = lancer({})
    try {
      assert.equal((await l.resultat).demarre, true, l.sortie())
      assert.match(l.sortie(), /CORS_ORIGIN absente : CORS ouvert à tous les sites/)
    } finally {
      l.enfant.kill()
    }
  })

  test('définie et valide → démarre sans avertissement CORS', async () => {
    const l = lancer({ CORS_ORIGIN: FRONT })
    try {
      assert.equal((await l.resultat).demarre, true, l.sortie())
      assert.doesNotMatch(l.sortie(), /CORS_ORIGIN/)
    } finally {
      l.enfant.kill()
    }
  })

  test('invalide → refus de démarrer, message explicite', async () => {
    const l = lancer({ CORS_ORIGIN: `${FRONT}/api/v1` })
    try {
      const r = await l.resultat
      assert.equal(r.demarre, false)
      assert.equal(r.code, 1)
      assert.match(l.sortie(), /CORS_ORIGIN invalide/)
    } finally {
      l.enfant.kill()
    }
  })
})

describe('P0-S4 : garde-fou — le front reste compatible avec la CSP', () => {
  function fichiers(d: string): string[] {
    return readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? fichiers(join(d, e.name)) : [join(d, e.name)]))
  }
  const sources = fichiers(join(RACINE, 'src')).filter((f) => /\.(tsx?|css)$/.test(f))

  test('index.html : aucun script ni style inline, aucune ressource externe', () => {
    const html = readFileSync(join(RACINE, 'index.html'), 'utf8')
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      // P2-Q4 : seule exception, le bloc de données JSON-LD (type non JavaScript → jamais exécuté, hors script-src).
      // Il doit rester du JSON pur : un `</script>` ou du code dedans ferait échouer JSON.parse.
      if (m[1].trim() === 'type="application/ld+json"') {
        assert.doesNotThrow(() => JSON.parse(m[2]), 'JSON-LD : JSON valide')
        continue
      }
      assert.match(m[1], /\bsrc="\/[^/]/, 'script externe à la même origine uniquement')
      assert.equal(m[2].trim(), '', 'aucun script inline')
    }
    assert.doesNotMatch(html, /<style\b|\sstyle=|\son\w+=/i)
    // P2-Q4 : l'adresse canonique est absolue (recommandation Google) mais n'est pas une ressource chargée.
    assert.doesNotMatch(html.replace(/<link rel="canonical" href="https:\/\/[^"]+" \/>/, ''), /(src|href)="https?:/)
  })

  test('src/ : rien que la CSP bloquerait (style/script inline, eval, polices ou CSS distants, iframes)', () => {
    for (const f of sources) {
      const t = readFileSync(f, 'utf8')
      const nom = f.slice(RACINE.length + 1)
      assert.doesNotMatch(t, /<style\b|<script\b|dangerouslySetInnerHTML|\beval\(|new Function\(|<iframe\b|<object\b|<embed\b/, nom)
      assert.doesNotMatch(t, /@import\s+url\(\s*['"]?https?:|@font-face/, nom)
      assert.doesNotMatch(t, /createElement\(\s*['"](style|script)['"]/, nom)
    }
  })

  test('les appels réseau du front passent par l’API (connect-src self), pas de fetch vers un autre site', () => {
    for (const f of sources) {
      const t = readFileSync(f, 'utf8')
      assert.doesNotMatch(t, /fetch\(\s*['"`]https?:|new WebSocket|new EventSource|new Worker/, f.slice(RACINE.length + 1))
    }
  })
})

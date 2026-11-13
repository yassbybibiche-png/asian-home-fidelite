// P2-Q2 — Performance : découpage du bundle par page (React.lazy + Suspense), pages critiques gardées dans le bundle
// initial (#/jouer, #/carte, #/caisse), caisse hors ligne après découpage (service worker simulé sur le VRAI build),
// en-têtes de cache des fichiers du build (immutable + ETag, index.html no-cache).
// Le build Vite est relancé ici dans un dossier temporaire (≈ 2 s) : le test ne dépend pas d'un dist/ périmé.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { runInNewContext } from 'node:vm'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { creerFileCaisse, type ActionCaisse, type Envoi } from '../src/lib/fileCaisse.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p2-q2-'))
const BUILD = join(dossier, 'dist')
after(() => rmSync(dossier, { recursive: true, force: true }))

/** Taille du bundle initial avant P2-Q2 (mesurée sur master 1e40b68 : un seul fichier JS hors jsQR). */
const INITIAL_AVANT_OCTETS = 601_720

/**
 * Plafond du bundle initial, relevé le 12/11/2026 sur décision explicite de l'utilisateur (« tout débloquer ») :
 * strict nécessaire pour les trois chantiers du déblocage (mesure 482 374 o) + ~2 Ko de marge.
 * Ancien plafond effectif : INITIAL_AVANT_OCTETS * 0.8 = 481 376 o. Voir DEBLOCAGE-RAPPORT.md.
 */
const PLAFOND_BUNDLE_INITIAL = 484_422

/** Pages du back-office et pages publiques secondaires : chacune dans son propre fichier, hors bundle initial. */
const PAGES_DIFFEREES = ['TableauDeBord', 'Clients', 'Roulette', 'Avis', 'Reglages', 'Offre', 'Admin', 'Plus', 'FicheClient', 'QrVitrine', 'MenuPublic', 'Equipe', 'Messages', 'MenuCarte', 'Desinscription', 'Confidentialite', 'Reglement', 'Bienvenue', 'Commande', 'Cuisine', 'Vitrine']

// ---------- Source : App.tsx ----------

describe('P2-Q2 : découpage par page dans App.tsx', () => {
  const app = lire('src/App.tsx')

  test('pages critiques importées statiquement : jeu, carte, caisse', () => {
    for (const p of ['Jouer', 'CartePublique', 'Caisse']) assert.match(app, new RegExp(`^import ${p} from './pages/${p}'$`, 'm'), p)
  })

  test('toutes les autres pages en React.lazy, aucun import statique', () => {
    assert.match(app, /import \{ Component, Suspense, lazy,/)
    for (const p of PAGES_DIFFEREES) {
      assert.match(app, new RegExp(`\\(\\) => import\\('\\./pages/${p}'\\)`), `${p} : import() absent`)
      assert.doesNotMatch(app, new RegExp(`^import \\w+ from './pages/${p}'`, 'm'), `${p} importée statiquement`)
    }
    assert.equal([...app.matchAll(/= lazy\(IMPORTS\.\w+\)/g)].length, PAGES_DIFFEREES.length)
    // Les clés des tests précédents (relances, RGPD) restent dans la table des composants.
    assert.match(app, /desinscription: Desinscription/)
    assert.match(app, /confidentialite: Confidentialite/)
  })

  test('Suspense avec squelette (vague B) : back-office et pages publiques ; fichier introuvable → message + Recharger', () => {
    assert.match(app, /<Suspense fallback=\{<SquelettePage \/>\}>\s*<Contenu \/>\s*<\/Suspense>/)
    assert.match(app, /<Suspense fallback=\{<SquelettePublique page=\{page\} \/>\}>\s*<Contenu \/>\s*<\/Suspense>/)
    assert.match(app, /if \(page === 'menu'\) return <SqueletteMenu libelle=/)
    // Les squelettes passent par le composant Squelette (role="status", aria-busy), pas un texte nu.
    assert.equal([...app.matchAll(/<Squelette libelle="Chargement de la page…"/g)].length, 2)
    assert.equal([...app.matchAll(/<ErreurChargementPage key=\{page\}>/g)].length, 2)
    assert.match(app, /static getDerivedStateFromError\(\)/)
    assert.match(app, /onClick=\{\(\) => window\.location\.reload\(\)\}/)
  })

  test('préchargement du back-office seulement une fois l’espace commerçant ouvert (jamais sur une page cliente)', () => {
    assert.match(app, /const espaceOuvert = !publique && \(mode === 'local' \|\| \(accesPret && !!acces && !!commerce\)\)/)
    assert.match(app, /if \(espaceOuvert\) prechargerPagesCommercant\(\)/)
    assert.match(app, /if \(!PAGES_PUBLIQUES_DIFFEREES\.includes\(page as Page\)\) importer\(\)\.catch\(\(\) => \{\}\)/)
    assert.match(app, /requestIdleCallback/)
  })
})

// ---------- Build réel ----------

/** Fichiers JS chargés au premier affichage : script d'entrée + modulepreload, puis leurs imports statiques (pas les import()). */
function fichiersInitiaux(dist: string): string[] {
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const depart = [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)].map((m) => m[1])
  const vus = new Set<string>()
  const pile = [...depart]
  while (pile.length) {
    const f = pile.pop()!
    if (vus.has(f)) continue
    vus.add(f)
    const js = readFileSync(join(dist, 'assets', f), 'utf8')
    for (const m of js.matchAll(/(?:from|import)\s*"\.\/([^"]+\.js)"/g)) pile.push(m[1])
  }
  return [...vus]
}

describe('P2-Q2 : build Vite découpé', () => {
  let initiaux: string[] = []
  let tous: string[] = []
  const contenu = (f: string) => readFileSync(join(BUILD, 'assets', f), 'utf8')

  before(async () => {
    const { build } = await import('vite')
    await build({ root: RACINE, configFile: join(RACINE, 'vite.config.ts'), logLevel: 'silent', build: { outDir: BUILD, emptyOutDir: true } })
    initiaux = fichiersInitiaux(BUILD)
    tous = readdirSync(join(BUILD, 'assets')).filter((f) => f.endsWith('.js'))
  })

  test('une page différée = un fichier à part, absent du bundle initial', () => {
    for (const p of PAGES_DIFFEREES) {
      const f = tous.find((x) => x.startsWith(`${p}-`))
      assert.ok(f, `${p} : pas de fichier à part`)
      assert.ok(!initiaux.includes(f), `${p} dans le bundle initial`)
    }
  })

  test('bundle initial : jeu, carte, caisse et file hors ligne dedans ; nettement plus léger qu’avant', () => {
    const js = initiaux.map(contenu).join('\n')
    for (const marque of ['la roue arrive', 'votre carte arrive', 'Hors ligne et aucune donn', 'les actions seront gard']) assert.ok(js.includes(marque), marque)
    const octets = initiaux.reduce((n, f) => n + Buffer.byteLength(contenu(f)), 0)
    assert.ok(octets < PLAFOND_BUNDLE_INITIAL, `bundle initial ${octets} o, plafond ${PLAFOND_BUNDLE_INITIAL} o (avant : ${INITIAL_AVANT_OCTETS} o)`)
    // jsQR reste différé (chargé à la première ouverture du scanner).
    assert.ok(!initiaux.some((f) => f.startsWith('jsQR-')))
    // Plus d'avertissement Vite « chunk > 500 kB ».
    for (const f of tous) assert.ok(Buffer.byteLength(contenu(f)) < 500_000, f)
  })

  // ---------- Service worker simulé sur le build ----------

  type FauxReponse = { ok: boolean; status: number; type: string; redirected: boolean; url: string; headers: Headers; corps: string; clone(): FauxReponse }
  const ORIGINE = 'https://asian-home-fidelite.onrender.com'
  const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }

  function reponse(url: string, status: number, corps: string, type: string): FauxReponse {
    const r: FauxReponse = { ok: status < 400, status, type: 'basic', redirected: false, url, headers: new Headers({ 'content-type': type }), corps, clone: () => r }
    return r
  }

  /** sw.js du build exécuté dans un contexte isolé : caches en mémoire, réseau coupable, fichiers servis depuis le build. */
  function serviceWorker() {
    const reseau = { enLigne: true, appels: [] as string[] }
    const ecouteurs = new Map<string, (e: unknown) => void>()
    const stores = new Map<string, Map<string, FauxReponse>>()
    const cle = (r: string | { url: string }) => new URL(typeof r === 'string' ? r : r.url, ORIGINE).href
    const fetchFaux = async (r: string | { url: string }) => {
      const url = new URL(cle(r))
      reseau.appels.push(url.pathname)
      if (!reseau.enLigne) throw new TypeError('Failed to fetch')
      const chemin = url.pathname === '/' ? '/index.html' : url.pathname
      const fichier = join(BUILD, chemin)
      if (!existsSync(fichier)) return reponse(url.href, 404, '', 'text/plain')
      return reponse(url.href, 200, readFileSync(fichier, 'utf8'), TYPES[extname(fichier)] ?? 'application/octet-stream')
    }
    const ouvrir = (nom: string) => {
      if (!stores.has(nom)) stores.set(nom, new Map())
      const m = stores.get(nom)!
      return {
        match: async (r: string | { url: string }) => m.get(cle(r)),
        put: async (r: string | { url: string }, v: FauxReponse) => void m.set(cle(r), v),
        addAll: async (liste: string[]) => {
          for (const u of liste) {
            const v = await fetchFaux(u)
            if (!v.ok) throw new TypeError(`préchargement impossible : ${u}`)
            m.set(cle(u), v)
          }
        },
        keys: async () => [...m.keys()],
        delete: async (k: string) => m.delete(k),
      }
    }
    const caches = {
      open: async (nom: string) => ouvrir(nom),
      match: async (r: string | { url: string }) => {
        for (const m of stores.values()) if (m.has(cle(r))) return m.get(cle(r))
        return undefined
      },
      keys: async () => [...stores.keys()],
      delete: async (k: string) => stores.delete(k),
    }
    const self = {
      location: { origin: ORIGINE },
      addEventListener: (type: string, f: (e: unknown) => void) => void ecouteurs.set(type, f),
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    }
    runInNewContext(readFileSync(join(BUILD, 'sw.js'), 'utf8'), { self, caches, fetch: fetchFaux, URL, Response: { error: () => reponse('', 0, '', 'error') } })

    async function evenement(type: string) {
      let attente: Promise<unknown> = Promise.resolve()
      ecouteurs.get(type)!({ waitUntil: (p: Promise<unknown>) => (attente = p) })
      await attente
    }
    /** Requête du navigateur : `null` = non interceptée (le navigateur va au réseau lui-même). */
    async function requete(chemin: string, o: { method?: string; mode?: string } = {}): Promise<FauxReponse | null> {
      let r: Promise<FauxReponse> | null = null
      ecouteurs.get('fetch')!({ request: { url: ORIGINE + chemin, method: o.method ?? 'GET', mode: o.mode ?? 'cors' }, respondWith: (p: Promise<FauxReponse>) => (r = p) })
      return r
    }
    return { reseau, evenement, requete }
  }

  /** Première ouverture de la caisse en ligne : index.html, puis le JS et le CSS qu'il référence. */
  function fichiersDeLaPage(): string[] {
    const html = readFileSync(join(BUILD, 'index.html'), 'utf8')
    return [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]).concat(initiaux.map((f) => `/assets/${f}`)))]
  }

  test('caisse hors ligne après découpage : l’app et tout le code de la caisse viennent du cache du service worker', async () => {
    const sw = serviceWorker()
    await sw.evenement('install')
    await sw.evenement('activate')
    // En ligne : #/caisse ouverte une fois (navigation + fichiers du bundle initial).
    assert.ok((await (await sw.requete('/', { mode: 'navigate' }))!).ok)
    for (const f of fichiersDeLaPage()) assert.ok((await (await sw.requete(f))!).ok, f)

    // Réseau coupé : la page et tous ses fichiers sont servis par le cache, sans aucun fichier manquant.
    sw.reseau.enLigne = false
    const page = (await (await sw.requete('/', { mode: 'navigate' }))!)
    assert.ok(page.ok)
    assert.equal(page.corps, readFileSync(join(BUILD, 'index.html'), 'utf8'))
    let js = ''
    for (const f of fichiersDeLaPage()) {
      const r = (await (await sw.requete(f))!)
      assert.ok(r.ok, `${f} absent du cache hors ligne`)
      if (f.endsWith('.js')) js += r.corps
    }
    // Le code de la caisse et de sa file d'attente est dans ce que le cache a servi (pas dans un fichier différé).
    assert.ok(js.includes('Hors ligne et aucune donn'))
    assert.ok(js.includes('les actions seront gard'))
  })

  test('hors ligne : /api/ et les POST ne sont jamais servis par le cache → la file de la caisse garde l’action, envoyée une seule fois au retour', async () => {
    const sw = serviceWorker()
    await sw.evenement('install')
    sw.reseau.enLigne = false
    assert.equal(await sw.requete('/api/v1/commerces/c-asian-home-paris/caisse/passage', { method: 'POST' }), null)
    assert.equal(await sw.requete('/api/v1/commerces/c-asian-home-paris/caisse'), null)

    // Le navigateur va donc au réseau, qui est coupé : la file (src/lib/fileCaisse.ts) garde l'action.
    const m = new Map<string, string>()
    const f = creerFileCaisse({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }, 'file')
    const action: ActionCaisse = { id: 'a1', type: 'passage', commerceId: 'c-asian-home-paris', clientId: 'cl-1', clientPrenom: 'Lina', faitLe: '2026-11-10T11:00:00Z' }
    f.ajouter(action)
    const envoyees: string[] = []
    const envoyer = async (a: ActionCaisse): Promise<Envoi> => {
      if (!sw.reseau.enLigne) return { ok: false, reseau: true }
      envoyees.push(a.id)
      return { ok: true }
    }
    assert.deepEqual((await f.synchroniser(envoyer)).attente.map((a) => a.id), ['a1'])
    sw.reseau.enLigne = true
    await Promise.all([f.synchroniser(envoyer), f.synchroniser(envoyer)])
    assert.equal((await f.synchroniser(envoyer)).attente.length, 0)
    assert.deepEqual(envoyees, ['a1'], 'pas de double comptage')
  })

  test('pages différées : disponibles hors ligne après le préchargement de l’espace commerçant, pas avant', async () => {
    const sw = serviceWorker()
    await sw.evenement('install')
    const reglages = `/assets/${tous.find((x) => x.startsWith('Reglages-'))}`
    sw.reseau.enLigne = false
    await assert.rejects(sw.requete(reglages), /Failed to fetch/, 'jamais visitée : pas en cache')
    sw.reseau.enLigne = true
    for (const p of PAGES_DIFFEREES) assert.ok((await (await sw.requete(`/assets/${tous.find((x) => x.startsWith(`${p}-`))}`))!).ok, p)
    sw.reseau.enLigne = false
    assert.ok((await (await sw.requete(reglages))!).ok)
  })

  test('fichiers préchargés (boucle t2) : servis hors ligne sans visite préalable — le préchargement remplit CACHE_APP, `fichier()` doit aussi le consulter', async () => {
    const sw = serviceWorker()
    await sw.evenement('install')
    // Réseau coupé AVANT toute requête : seul le préchargement a rempli les caches.
    sw.reseau.enLigne = false
    for (const f of ['/visuels/logo-petit.webp', '/visuels/logo.png', '/icones/icone-192.png', '/hors-ligne.css', '/manifest.webmanifest']) {
      const r = await sw.requete(f)
      assert.ok(r && r.ok, `${f} : absent hors ligne après installation seule`)
    }
  })

  // ---------- En-têtes de cache sur le build ----------

  test('serveur : chaque fichier du build (y compris les pages différées) en immutable 1 an + ETag → 304 ; index.html et sw.js en no-cache', async () => {
    const app = await creerServeur({ fichierDb: join(dossier, 'cache.db'), adminPin: '98765432', pinInitial: '1234', version: 'test', dossierStatique: BUILD })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
    try {
      for (const f of readdirSync(join(BUILD, 'assets'))) {
        const r = await fetch(`${racine}/assets/${f}`)
        assert.equal(r.status, 200, f)
        assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000, immutable', f)
        const balise = r.headers.get('etag')
        assert.ok(balise, `${f} : ETag`)
        await r.arrayBuffer()
        const r2 = await fetch(`${racine}/assets/${f}`, { headers: { 'If-None-Match': balise } })
        assert.equal(r2.status, 304, f)
        await r2.arrayBuffer()
      }
      for (const chemin of ['/', '/index.html', '/sw.js']) {
        const r = await fetch(racine + chemin)
        assert.equal(r.status, 200, chemin)
        assert.equal(r.headers.get('cache-control'), 'no-cache', chemin)
        assert.ok(r.headers.get('etag'), chemin)
        await r.arrayBuffer()
      }
      // Ancien fichier de page (onglet ouvert avant un déploiement) : 404, jamais index.html → ErreurChargementPage.
      const vieux = await fetch(`${racine}/assets/Reglages-Ancien00.js`)
      assert.equal(vieux.status, 404)
      await vieux.arrayBuffer()
    } finally {
      await app.fermer()
    }
  })
})

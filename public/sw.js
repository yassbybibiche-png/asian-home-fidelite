// Service worker (P1-C3) : l'app s'ouvre sans réseau une fois visitée, et l'écran d'accueil l'installe comme une app.
// Copié tel quel dans dist/ par Vite (dossier public/), servi en `no-cache` par le serveur : une nouvelle version est
// prise au prochain chargement.
//
// Règles :
// - /api/… n'est JAMAIS intercepté ni mis en cache : la carte, les tampons et la file hors ligne de la caisse
//   (src/lib/fileCaisse.ts) parlent toujours directement au serveur, comme sans service worker.
// - Pages (navigation) : réseau d'abord (un déploiement est pris tout de suite), sinon l'app gardée en cache,
//   sinon la page hors ligne minimale. Une page prérendue (/menu/<id>, P2-Q4) est un autre document que la SPA :
//   elle est gardée sous sa propre adresse, jamais sous « / » (sinon la caisse hors ligne afficherait le menu).
// - /assets/… (noms avec hash, immuables) : cache d'abord. Autres fichiers (visuels, icônes, manifest) : cache puis
//   mise à jour en arrière-plan.
const VERSION = 'fideliz-v1'
const CACHE_APP = `${VERSION}-app`
const CACHE_FICHIERS = `${VERSION}-fichiers`
const PAGE_HORS_LIGNE = '/hors-ligne.html'
const A_PRECHARGER = ['/', PAGE_HORS_LIGNE, '/hors-ligne.css', '/manifest.webmanifest', '/icones/icone-192.png', '/visuels/logo.png']
/** Au-delà, les plus anciens fichiers en cache sont retirés (anciens déploiements). */
const MAX_FICHIERS = 120

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE_APP)
      .then((c) => c.addAll(A_PRECHARGER))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((cles) => Promise.all(cles.filter((k) => !k.startsWith(`${VERSION}-`)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

async function limiter(cache) {
  const cles = await cache.keys()
  for (const k of cles.slice(0, Math.max(0, cles.length - MAX_FICHIERS))) await cache.delete(k)
}

async function page(requete) {
  try {
    const r = await fetch(requete)
    // L'app (index.html) est la même pour toutes les routes du front : gardée sous « / ». Une page prérendue
    // (/menu/<id>) est un autre document : gardée sous sa propre adresse, sinon elle écraserait la SPA et la
    // caisse hors ligne afficherait le menu au lieu de l'application (P2-Q4, revue Codex).
    if (r.ok && !r.redirected && (r.headers.get('content-type') || '').includes('text/html')) {
      const copie = r.clone()
      const url = new URL(requete.url)
      caches.open(CACHE_APP).then((c) => c.put(url.pathname === '/' ? '/' : requete.url, copie))
    }
    return r
  } catch {
    return (await caches.match(requete)) || (await caches.match('/')) || (await caches.match(PAGE_HORS_LIGNE)) || Response.error()
  }
}

async function fichier(requete, immuable) {
  const cache = await caches.open(CACHE_FICHIERS)
  const enCache = await cache.match(requete)
  if (enCache && immuable) return enCache
  const reseau = fetch(requete).then(async (r) => {
    if (r.ok && r.type === 'basic') {
      await cache.put(requete, r.clone())
      await limiter(cache)
    }
    return r
  })
  if (enCache) {
    reseau.catch(() => {})
    return enCache
  }
  return reseau
}

self.addEventListener('fetch', (e) => {
  const requete = e.request
  if (requete.method !== 'GET') return
  const url = new URL(requete.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return
  if (requete.mode === 'navigate') {
    e.respondWith(page(requete))
    return
  }
  e.respondWith(fichier(requete, url.pathname.startsWith('/assets/')))
})

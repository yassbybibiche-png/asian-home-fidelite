// Mesure ponctuelle tour 4 — menu Asian Home (le protocole standard utilise un commerce
// générique, sans visuels : le héros du menu n'y apparaît pas). Commerce créé avec le nom
// « Asian Home Paris » (estAsianHome reconnaît le nom) : la page #/menu affiche alors le
// héros, comme pour le vrai restaurant. Même protocole par ailleurs : Pixel 7, Slow 4G +
// CPU ×4, serveur E2E local. Mesure : premier affichage #/menu (chargement direct) + LCP,
// et le poids du héros dans le journal des requêtes. 2 passes.
// Usage : node scripts/mesurer-menu-asian-home.mjs [--port 4361]
// Versionné (revue Codex t4) : la mesure standard (mesurer-scores.mjs) utilise un commerce
// générique sans visuels — ce script est le complément ciblé pour le héros du vrai menu.
import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { chromium, devices } from '@playwright/test'

const RACINE = resolve(import.meta.dirname, '..')
const { values } = parseArgs({ options: { port: { type: 'string' } } })
const PORT = Number(values.port ?? 4361)
const BASE = `http://127.0.0.1:${PORT}`

const serveur = spawn('node', ['tests-e2e/serveur.ts'], { cwd: RACINE, env: { ...process.env, E2E_PORT: String(PORT), VITE_API_URL: '/' }, stdio: 'pipe' })
const attendreSante = async () => {
  for (let i = 0; i < 240; i++) {
    try { const r = await fetch(`${BASE}/api/v1/sante`); if (r.ok) return } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('serveur E2E non prêt')
}

try {
  await attendreSante()
  const commerce = await (await fetch(`${BASE}/api/v1/commerces`, {
    method: 'POST', headers: { 'X-Admin-PIN': '000000', 'Content-Type': 'application/json' },
    body: JSON.stringify({ nom: 'Asian Home Paris', type: 'restaurant', pin: '4321', lots: [{ libelle: 'Nems offerts', probabilite: 100 }] }),
  })).json()
  const id = commerce.commerce.id
  console.log('commerce :', id, commerce.commerce.nom)
  for (let passe = 1; passe <= 2; passe++) {
    // Navigateur relancé à chaque passe : le cache HTTP est partagé entre les contextes
    // d'un même lancement — sans cela, la passe 2 servirait le héros depuis le cache.
    const navigateur = await chromium.launch()
    // Comme le protocole standard (mesurer-scores.mjs) : service workers bloqués —
    // sinon le SW intercepte les images (transferSize 0) et masque leur coût réseau.
    const contexte = await navigateur.newContext({ ...devices['Pixel 7'], reducedMotion: 'reduce', serviceWorkers: 'block' })
    const page = await contexte.newPage()
    const client = await contexte.newCDPSession(page)
    await client.send('Network.enable')
    // Cache désactivé : sans cela, le héros est servi depuis le cache (transferSize 0)
    // et la mesure sous-estime son coût réel à froid (premier chargement sur 4G lente).
    await client.send('Network.setCacheDisabled', { cacheDisabled: true })
    await client.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
    await client.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await page.addInitScript(() => {
      window.__chrono = {}
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__chrono.fcp = Math.round(e.startTime) }).observe({ entryTypes: ['paint'] })
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__chrono.lcp = { ms: Math.round(e.startTime), el: e.element?.className || e.element?.tagName } }).observe({ entryTypes: ['largest-contentful-paint'] })
    })
    const t0 = Date.now()
    await page.goto(`${BASE}/#/menu/${id}`, { waitUntil: 'load' })
    await page.waitForTimeout(3000)
    const chrono = await page.evaluate(() => window.__chrono)
    const hero = await page.evaluate(() => performance.getEntriesByType('resource')
      .filter((r) => r.name.includes('/visuels/'))
      .map((r) => ({ nom: r.name.split('/visuels/')[1], debut: Math.round(r.startTime), fin: Math.round(r.responseEnd), taille: r.transferSize })))
    const nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { domPret: Math.round(n.domContentLoadedEventEnd), charge: Math.round(n.loadEventEnd) } })
    console.log(`passe ${passe} :`, JSON.stringify({ ...chrono, ...nav, dureeTotaleMs: Date.now() - t0, visuels: hero }))
    await contexte.close()
    await navigateur.close()
  }
} finally {
  serveur.kill()
}

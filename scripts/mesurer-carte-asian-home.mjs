// Mesure ponctuelle tour 6 — carte de fidélité Asian Home (le protocole standard utilise
// un commerce générique, sans visuels : la bannière de la carte n'y apparaît pas).
// Commerce créé avec le nom « Asian Home Paris » (estAsianHome reconnaît le nom) : la carte
// affiche alors la bannière (hero-plats.jpg, 1024×683, 177 Ko, affichée 390×96 en
// object-cover), comme pour le vrai restaurant. Parcours complet (inscription → validation
// en caisse → tirage → gain → carte), même protocole par ailleurs : Pixel 7, Slow 4G +
// CPU ×4, serveur E2E local, service workers bloqués, cache désactivé, navigateur relancé
// par passe. Deux mesures de la carte : (1) la transition réelle (clic « Voir ma carte »
// depuis #/jouer → héros et bannière chargés — img.complete, pas décodage + peinture) ;
// (2) le chargement direct (nouvelle page du même contexte — le jeton client est dans le
// localStorage partagé — pour le LCP classique, le LCP d'une navigation par hash n'étant
// pas mesurable). 2 passes.
// Usage : node scripts/mesurer-carte-asian-home.mjs [--port 4371]
import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { chromium, devices } from '@playwright/test'

const RACINE = resolve(import.meta.dirname, '..')
const { values } = parseArgs({ options: { port: { type: 'string' } } })
const PORT = Number(values.port ?? 4371)
const BASE = `http://127.0.0.1:${PORT}`
const ADMIN_PIN = '000000'
const PIN_COMMERCE = '4321'
const CODE_EQUIPE = '2468'
// Un téléphone différent par passe : le même numéro deux fois sur le même commerce
// ne repasse pas par l'inscription ([data-attente="en-cours"] n'apparaît plus).
const telephonePasse = (passe) => `06 12 34 56 7${passe}`

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
    method: 'POST', headers: { 'X-Admin-PIN': ADMIN_PIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nom: 'Asian Home Paris', type: 'restaurant', pin: PIN_COMMERCE, lots: [{ libelle: 'Nems offerts', probabilite: 100 }] }),
  })).json()
  const id = commerce.commerce.id
  const membre = await fetch(`${BASE}/api/v1/commerces/${id}/equipe`, {
    method: 'POST', headers: { 'X-Commerce-PIN': PIN_COMMERCE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nom: 'Camille', code: CODE_EQUIPE }),
  })
  if (membre.status !== 201) throw new Error(`création du membre d'équipe : HTTP ${membre.status}`)
  console.log('commerce :', id, commerce.commerce.nom)
  for (let passe = 1; passe <= 2; passe++) {
    const navigateur = await chromium.launch()
    const contexte = await navigateur.newContext({ ...devices['Pixel 7'], baseURL: BASE, locale: 'fr-FR', timezoneId: 'Europe/Paris', reducedMotion: 'reduce', serviceWorkers: 'block' })
    const client = await contexte.newPage()
    const cdp = await contexte.newCDPSession(client)
    await cdp.send('Network.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await client.addInitScript(() => {
      window.__lcp = undefined
      window.__lcpElement = null
      window.__lcpEntrees = 0
      try {
        new PerformanceObserver((liste) => {
          for (const e of liste.getEntries()) {
            window.__lcp = e.startTime
            window.__lcpEntrees = (window.__lcpEntrees ?? 0) + 1
            const el = e.element
            window.__lcpElement = el ? `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ')[0]}` : ''}` : null
          }
        }).observe({ type: 'largest-contentful-paint', buffered: true })
      } catch {}
    })
    const erreurs = []
    client.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()) })
    client.on('pageerror', (e) => erreurs.push(`pageerror: ${e.message}`))
    const TELEPHONE = telephonePasse(passe)
    const t0 = Date.now()
    await client.goto(`/#/jouer/${id}`)
    await client.getByRole('heading', { name: 'Asian Home Paris' }).waitFor()
    await client.getByLabel('Téléphone ou e-mail').fill(TELEPHONE)
    await client.getByRole('button', { name: 'C’est parti' }).click()
    await client.locator('[data-attente="en-cours"]').waitFor()
    // Caisse (autre appareil).
    const tablette = await navigateur.newContext({ ...devices['Pixel 7'], baseURL: BASE, locale: 'fr-FR', timezoneId: 'Europe/Paris', reducedMotion: 'reduce', serviceWorkers: 'block' })
    const caisse = await tablette.newPage()
    const cdpCaisse = await tablette.newCDPSession(caisse)
    await cdpCaisse.send('Network.enable')
    await cdpCaisse.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
    await cdpCaisse.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await caisse.goto(`/#/caisse/${id}`)
    await caisse.getByLabel('Votre code équipe (4 chiffres)').fill(CODE_EQUIPE)
    await caisse.getByRole('button', { name: 'Ouvrir la caisse' }).click()
    await caisse.getByText('Connecté : Camille').waitFor()
    await caisse.getByLabel('Ou chercher : prénom, téléphone ou e-mail').fill('0612')
    await caisse.getByRole('button', { name: new RegExp(TELEPHONE.replace(/ /g, ' ?')) }).click()
    await caisse.getByRole('button', { name: '＋ Ajouter un passage' }).click()
    await caisse.getByText(/✓ Passage enregistré/).waitFor()
    // Client : vérification puis tirage puis carte.
    await client.getByRole('button', { name: 'C’est validé ? Vérifier maintenant' }).click()
    await client.locator('[data-attente="validee"]').waitFor()
    await client.getByRole('button', { name: /Tourner la roue/ }).click()
    await client.locator('[data-resultat="gain"]').waitFor()
    // (1) Transition réelle : clic « Voir ma carte » depuis #/jouer → héros et bannière
    // chargés (img.complete — le décodage puis la peinture ne sont pas attendus
    // explicitement ; « chargée » est plus exact que « affichée », revue Codex t7).
    // Le href est lu AVANT le clic : après la navigation, le lien n'existe plus.
    const hrefCarte = await client.getByRole('link', { name: 'Voir ma carte de fidélité' }).last().getAttribute('href')
    const tClic = Date.now()
    await client.getByRole('link', { name: 'Voir ma carte de fidélité' }).last().click()
    await client.locator('[data-tampons]').waitFor()
    const ouvertureCarteMs = Date.now() - tClic
    const imgComplete = (sel) => client.waitForFunction((s) => { const i = document.querySelector(s); return i && i.complete && i.naturalWidth > 0 }, sel, { timeout: 15000 })
    await imgComplete('img.h-80')
    const herosChargeApresClicMs = Date.now() - tClic
    await imgComplete('img.h-24')
    const banniereChargeeApresClicMs = Date.now() - tClic
    const srcReels = await client.evaluate(() => [...document.querySelectorAll('img.h-80, img.h-24')].map((i) => i.currentSrc.split('/').pop()))
    // (2) Chargement direct (nouvelle page du même contexte) pour le LCP classique.
    const pageCarte = await contexte.newPage()
    // Écouteurs d'erreurs aussi sur la page carte (revue Codex t6) : sans eux, le « zéro
    // erreur » ne couvrait que la page #/jouer, pas la carte.
    const erreursCarte = []
    pageCarte.on('console', (m) => { if (m.type() === 'error') erreursCarte.push(`carte: ${m.text()}`) })
    pageCarte.on('pageerror', (e) => erreursCarte.push(`carte pageerror: ${e.message}`))
    pageCarte.on('requestfailed', (r) => erreursCarte.push(`carte: ${r.url()} (${r.failure()?.errorText})`))
    pageCarte.on('response', (r) => { if (r.status() >= 400) erreursCarte.push(`carte: ${r.url()} → HTTP ${r.status()}`) })
    const cdpCarte = await contexte.newCDPSession(pageCarte)
    await cdpCarte.send('Network.enable')
    await cdpCarte.send('Network.setCacheDisabled', { cacheDisabled: true })
    await cdpCarte.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
    await cdpCarte.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await pageCarte.addInitScript(() => {
      window.__lcp = undefined
      window.__lcpElement = null
      window.__lcpEntrees = 0
      try {
        new PerformanceObserver((liste) => {
          for (const e of liste.getEntries()) {
            window.__lcp = e.startTime
            window.__lcpEntrees = (window.__lcpEntrees ?? 0) + 1
            const el = e.element
            window.__lcpElement = el ? `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ')[0]}` : ''}` : null
          }
        }).observe({ type: 'largest-contentful-paint', buffered: true })
      } catch {}
    })
    const tCarte = Date.now()
    await pageCarte.goto(`${BASE}/${hrefCarte}`, { waitUntil: 'load' })
    await pageCarte.locator('[data-tampons]').waitFor()
    const chargementCarteMs = Date.now() - tCarte
    await pageCarte.waitForTimeout(2000)
    const lcpCarte = await pageCarte.evaluate(() => ({ ms: typeof window.__lcp === 'number' ? Math.round(window.__lcp) : null, element: window.__lcpElement ?? null, entrees: window.__lcpEntrees ?? 0 }))
    const visuels = await pageCarte.evaluate(() => performance.getEntriesByType('resource')
      .filter((r) => r.name.includes('/visuels/'))
      .map((r) => ({ nom: r.name.split('/visuels/')[1], debut: Math.round(r.startTime), fin: Math.round(r.responseEnd), taille: r.transferSize })))
    console.log(`passe ${passe} carte :`, JSON.stringify({ transitionReelle: { ouvertureCarteMs, herosChargeApresClicMs, banniereChargeeApresClicMs, srcReels }, chargementCarteMs, lcpCarte, dureeTotaleMs: Date.now() - t0, visuels, erreurs: [...erreurs, ...erreursCarte] }))
    await pageCarte.close()
    await contexte.close()
    await navigateur.close()
  }
} finally {
  serveur.kill()
}

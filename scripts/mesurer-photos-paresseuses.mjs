// Mesure ponctuelle tour 10 — photos paresseuses Asian Home (le protocole standard
// ne les couvre pas : elles sont loading="lazy", sous le pli). Commerce « Asian Home
// Paris » (estAsianHome reconnaît le nom). Deux mesures : (1) la carte — parcours
// complet jusqu'à la carte, défilement jusqu'à la section « Le restaurant »,
// attente du chargement (img.complete) de interieur.jpg et interieur-salon.jpg ;
// (2) le menu — chargement direct, défilement jusqu'en bas, attente des photos de
// catégories (sushis-ardoise, cocktails, menu-plat-riz, menu-mango-sticky-rice).
// Pixel 7, Slow 4G + CPU ×4, serveur E2E local, SW bloqués, cache désactivé,
// navigateur relancé par passe. 2 passes.
// Usage : node scripts/mesurer-photos-paresseuses.mjs [--port 4411]
import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { chromium, devices } from '@playwright/test'

const RACINE = resolve(import.meta.dirname, '..')
const { values } = parseArgs({ options: { port: { type: 'string' } } })
const PORT = Number(values.port ?? 4411)
const BASE = `http://127.0.0.1:${PORT}`
const ADMIN_PIN = '000000'
const PIN_COMMERCE = '4321'
const CODE_EQUIPE = '2468'

const serveur = spawn('node', ['tests-e2e/serveur.ts'], { cwd: RACINE, env: { ...process.env, E2E_PORT: String(PORT), VITE_API_URL: '/' }, stdio: 'pipe' })
const attendreSante = async () => {
  for (let i = 0; i < 240; i++) {
    try { const r = await fetch(`${BASE}/api/v1/sante`); if (r.ok) return } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('serveur E2E non prêt')
}
const reglagePage = async (contexte, page) => {
  const cdp = await contexte.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
}
const visuels = (page) => page.evaluate(() => performance.getEntriesByType('resource')
  .filter((r) => r.name.includes('/visuels/'))
  .map((r) => ({ nom: r.name.split('/visuels/')[1], debut: Math.round(r.startTime), fin: Math.round(r.responseEnd), taille: r.transferSize })))

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
    // (1) Carte : parcours complet jusqu'au gain, puis défilement.
    const client = await contexte.newPage()
    await reglagePage(contexte, client)
    const erreurs = []
    client.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()) })
    client.on('pageerror', (e) => erreurs.push(`pageerror: ${e.message}`))
    await client.goto(`/#/jouer/${id}`)
    await client.getByRole('heading', { name: 'Asian Home Paris' }).waitFor()
    await client.getByLabel('Téléphone ou e-mail').fill(`06 12 34 56 8${passe}`)
    await client.getByRole('button', { name: 'C’est parti' }).click()
    await client.locator('[data-attente="en-cours"]').waitFor()
    const tablette = await navigateur.newContext({ ...devices['Pixel 7'], baseURL: BASE, locale: 'fr-FR', timezoneId: 'Europe/Paris', reducedMotion: 'reduce', serviceWorkers: 'block' })
    const caisse = await tablette.newPage()
    await reglagePage(tablette, caisse)
    await caisse.goto(`/#/caisse/${id}`)
    await caisse.getByLabel('Votre code équipe (4 chiffres)').fill(CODE_EQUIPE)
    await caisse.getByRole('button', { name: 'Ouvrir la caisse' }).click()
    await caisse.getByText('Connecté : Camille').waitFor()
    await caisse.getByLabel('Ou chercher : prénom, téléphone ou e-mail').fill('0612')
    await caisse.getByRole('button', { name: new RegExp(`06 ?12 ?34 ?56 ?8${passe}`) }).click()
    await caisse.getByRole('button', { name: '＋ Ajouter un passage' }).click()
    await caisse.getByText(/✓ Passage enregistré/).waitFor()
    await client.getByRole('button', { name: 'C’est validé ? Vérifier maintenant' }).click()
    await client.locator('[data-attente="validee"]').waitFor()
    await client.getByRole('button', { name: /Tourner la roue/ }).click()
    await client.locator('[data-resultat="gain"]').waitFor()
    await client.getByRole('link', { name: 'Voir ma carte de fidélité' }).last().click()
    await client.locator('[data-tampons]').waitFor()
    const tScrollCarte = Date.now()
    await client.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    const complete = (sel) => client.waitForFunction((s) => { const i = document.querySelector(s); return i && i.complete && i.naturalWidth > 0 }, sel, { timeout: 15000 })
    await complete('img.h-64')
    const interieurMs = Date.now() - tScrollCarte
    await complete('img.h-48')
    const salonMs = Date.now() - tScrollCarte
    const visuelsCarte = await visuels(client)
    const dureesCarte = {}
    for (const v of visuelsCarte) dureesCarte[v.nom] = { dureeMs: v.fin - v.debut, taille: v.taille }
    const srcCarte = await client.evaluate(() => [...document.querySelectorAll('img.h-64, img.h-48')].map((i) => i.currentSrc.split('/').pop()))
    console.log(`passe ${passe} carte :`, JSON.stringify({ interieurApresScrollMs: interieurMs, salonApresScrollMs: salonMs, durees: dureesCarte, src: srcCarte, visuels: visuelsCarte.filter((v) => v.nom.startsWith('interieur')), erreurs }))
    // (2) Menu : chargement direct, défilement jusqu'en bas.
    const pageMenu = await contexte.newPage()
    await reglagePage(contexte, pageMenu)
    await pageMenu.goto(`${BASE}/#/menu/${id}`, { waitUntil: 'load' })
    await pageMenu.waitForTimeout(1500)
    const tScrollMenu = Date.now()
    // État avant scroll : une image paresseuse peut déjà être en cours de chargement
    // (préchargement anticipé du lazy loading) — le départ des requêtes ne s'attribue
    // donc pas systématiquement au scroll (revue Codex t10, point 3).
    const etatAvantScroll = await pageMenu.evaluate(() => [...document.querySelectorAll('img[src*="sushis-ardoise"], img[src*="cocktails"], img[src*="menu-plat-riz"], img[src*="menu-mango-sticky-rice"]')].map((i) => ({ src: i.currentSrc.split('/').pop(), complet: i.complete && i.naturalWidth > 0 })))
    await pageMenu.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    // Les délais scroll → chargé sont ceux du parcours (attentes séquentielles,
    // cumulatives) : les latences indépendantes sont les durées de téléchargement
    // du journal (fin − debut) ci-dessous. Les timeouts ne sont PAS masqués :
    // un chargement qui n'aboutit pas fait échouer la mesure (revue Codex t10).
    const completeMenu = (sel) => pageMenu.waitForFunction((s) => { const i = document.querySelector(s); return i && i.complete && i.naturalWidth > 0 }, sel, { timeout: 15000 })
    const categories = ['sushis-ardoise', 'cocktails', 'menu-plat-riz', 'menu-mango-sticky-rice']
    const charges = {}
    for (const nom of categories) {
      const img = await pageMenu.$(`img[src*="${nom}"]`)
      if (!img) { charges[nom] = 'absente'; continue }
      await pageMenu.evaluate((n) => { const i = document.querySelector(`img[src*="${n}"]`); i?.scrollIntoView({ block: 'center' }) }, nom)
      await completeMenu(`img[src*="${nom}"]`)
      charges[nom] = Date.now() - tScrollMenu
    }
    const visuelsMenu = await visuels(pageMenu)
    const durees = {}
    for (const v of visuelsMenu) durees[v.nom] = { dureeMs: v.fin - v.debut, taille: v.taille }
    const srcApres = await pageMenu.evaluate(() => [...document.querySelectorAll('img[src*="sushis-ardoise"], img[src*="cocktails"], img[src*="menu-plat-riz"], img[src*="menu-mango-sticky-rice"]')].map((i) => i.currentSrc.split('/').pop()))
    console.log(`passe ${passe} menu :`, JSON.stringify({ charges, durees, etatAvantScroll, srcApres, visuels: visuelsMenu.filter((v) => categories.some((c) => v.nom.startsWith(c))) }))
    await contexte.close()
    await navigateur.close()
  }
} finally {
  serveur.kill()
}

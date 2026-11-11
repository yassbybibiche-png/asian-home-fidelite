#!/usr/bin/env node
// Mesure initiale des parcours (P0-U0) : scan → lot, menu public, caisse, back-office — dans un vrai Chromium
// (Pixel 7, 4G simulée + CPU ralenti ×4), serveur local + base SQLite temporaire (tests-e2e/serveur.ts).
// Résultats : SCORES.md (référence avant/après refonte). Relancer pour P1-U1 avec le même script.
// Usage : node scripts/mesurer-scores.mjs [--sortie <fichier-json>] [--port <port>]
// Sortie par défaut : node_modules/.cache/mesure-p0-u0/resultats.json (+ captures *.png dans le même dossier).
// Ne touche jamais à la production : serveur 127.0.0.1 uniquement, base temporaire effacée à l'arrêt.
// Conditions : le port doit être libre avant le lancement (sinon le script s'arrête : il ne mesure jamais un
// serveur déjà présent) ; toute requête navigateur hors de l'origine locale fait échouer la passe.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, devices } from '@playwright/test'

const RACINE = resolve(import.meta.dirname, '..')
const { values } = parseArgs({ options: { sortie: { type: 'string' }, port: { type: 'string' } } })
const PORT = Number(values.port ?? process.env.E2E_PORT ?? 4321)
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error(`--port invalide : ${values.port ?? process.env.E2E_PORT ?? 4321}`)
const BASE = `http://127.0.0.1:${PORT}`
const ADMIN_PIN = '000000'
const PIN_COMMERCE = '4321'
const CODE_EQUIPE = '2468'
const TELEPHONE = '06 12 34 56 78'
const LOT = 'Nems offerts'

// 4G lente (preset « Slow 4G » de Lighthouse) + CPU mobile ralenti ×4.
const RESEAU_4G = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 }
const CPU_RALENTI = 4
// Délai de stabilisation avant de lire le LCP : le dernier candidat peut arriver après l'élément attendu.
const DELAI_LCP_MS = 2000

const sortie = values.sortie ?? join(RACINE, 'node_modules', '.cache', 'mesure-p0-u0', 'resultats.json')
const dossier = join(sortie, '..')
mkdirSync(dossier, { recursive: true })

const resultats = { date: new Date().toISOString(), base: BASE, reseau: 'Slow 4G (1,6 Mbps / 750 kbps, 150 ms) + CPU ×4', pixel: 'Pixel 7', erreursConsole: [], requetesEchouees: [], etapes: {}, lcp: {}, captures: {} }
const horloge = () => Date.now()

async function portLibre() {
  try {
    await fetch(`${BASE}/api/v1/sante`, { signal: AbortSignal.timeout(2000) })
    return false
  } catch {
    return true
  }
}

async function attendreSante(delaiMs = 120_000) {
  const debut = horloge()
  for (;;) {
    try {
      const r = await fetch(`${BASE}/api/v1/sante`)
      if (r.ok) return
    } catch { /* serveur pas encore prêt */ }
    if (horloge() - debut > delaiMs) throw new Error(`serveur E2E non prêt après ${delaiMs} ms`)
    await new Promise((r) => setTimeout(r, 500))
  }
}

/** Commerce neuf (lot gagnant à 100 %, déterministe) + un membre d'équipe, via l'API. */
async function preparerCommerce() {
  const r = await fetch(`${BASE}/api/v1/commerces`, {
    method: 'POST',
    headers: { 'X-Admin-PIN': ADMIN_PIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nom: `Mesure ${Date.now()}`, type: 'restaurant', pin: PIN_COMMERCE, lots: [{ libelle: LOT, probabilite: 100 }, { libelle: 'Perdu', probabilite: 0 }] }),
  })
  if (r.status !== 201) throw new Error(`création du commerce : HTTP ${r.status} — ${await r.text()}`)
  const { commerce } = await r.json()
  const m = await fetch(`${BASE}/api/v1/commerces/${commerce.id}/equipe`, {
    method: 'POST',
    headers: { 'X-Commerce-PIN': PIN_COMMERCE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nom: 'Camille', code: CODE_EQUIPE }),
  })
  if (m.status !== 201) throw new Error(`création du membre d'équipe : HTTP ${m.status}`)
  return commerce
}

/** Mêmes collecteurs d'erreurs sur toutes les pages (client, caisse, back-office). */
function surveiller(page, nom) {
  page.on('console', (m) => { if (m.type() === 'error') resultats.erreursConsole.push(`${nom}: ${m.text()}`) })
  page.on('pageerror', (e) => resultats.erreursConsole.push(`${nom} pageerror: ${e.message}`))
  page.on('requestfailed', (r) => resultats.requetesEchouees.push(`${nom}: ${r.url()} (${r.failure()?.errorText})`))
  page.on('response', (r) => { if (r.status() >= 400) resultats.requetesEchouees.push(`${nom}: ${r.url()} → HTTP ${r.status()}`) })
  // Garde-fou : aucune requête hors de l'origine locale (un build avec VITE_API_URL distant fausserait la mesure).
  page.on('request', (r) => {
    if (!r.url().startsWith(BASE)) resultats.requetesEchouees.push(`${nom}: requête hors origine locale : ${r.url()}`)
  })
}

/** Ralentissement réseau + CPU (CDP) : à appliquer à CHAQUE page mesurée, pas seulement au client. */
async function ralentir(contexte, page) {
  const cdp = await contexte.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', RESEAU_4G)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_RALENTI })
}

async function lcp(page) {
  return page.evaluate(() => {
    const v = window.__lcp
    return { ms: typeof v === 'number' ? Math.round(v) : null, element: window.__lcpElement ?? null, entrees: window.__lcpEntrees ?? 0 }
  })
}

/** LCP : l'observateur doit être posé AVANT la navigation (sinon l'entrée est manquée). */
async function observerLcp(page) {
  await page.addInitScript(() => {
    const w = window
    w.__lcp = undefined // réinitialisé à chaque navigation (sinon la valeur de la page précédente persiste)
    w.__lcpElement = null
    w.__lcpEntrees = 0
    try {
      new PerformanceObserver((liste) => {
        for (const e of liste.getEntries()) {
          w.__lcp = e.startTime
          w.__lcpEntrees = (w.__lcpEntrees ?? 0) + 1
          const el = e.element
          w.__lcpElement = el ? `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ')[0]}` : ''}` : null
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true })
    } catch { /* navigateur sans LCP : la mesure reste null */ }
  })
}

/**
 * LCP d'une page en navigation par hash (même document) : l'observateur survit au changement de hash mais
 * `addInitScript` ne se réexécute pas — réinitialiser explicitement avant la navigation, puis attendre que
 * la page se stabilise avant de lire (le dernier candidat LCP peut arriver après l'élément attendu).
 */
async function lcpApresNavigation(page, attendre) {
  await page.evaluate(() => {
    window.__lcp = undefined
    window.__lcpElement = null
    window.__lcpEntrees = 0
  })
  await attendre()
  await page.waitForTimeout(DELAI_LCP_MS)
  return lcp(page)
}

async function navigationMs(page) {
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0]
    return n ? { reponse: Math.round(n.responseStart), domPret: Math.round(n.domContentLoadedEventEnd), charge: Math.round(n.loadEventEnd) } : null
  })
  return nav
}

async function main() {
  if (!(await portLibre())) throw new Error(`port ${PORT} déjà occupé — un autre serveur tourne ; la mesure refuse de s'y brancher`)
  // VITE_API_URL forcé à « / » : un export parasite dans l'environnement ne doit jamais diriger le
  // navigateur (ni le build du serveur E2E) vers une API distante.
  const serveur = spawn('node', ['tests-e2e/serveur.ts'], { cwd: RACINE, env: { ...process.env, E2E_PORT: String(PORT), VITE_API_URL: '/' }, stdio: 'pipe' })
  serveur.stdout.on('data', (c) => process.stderr.write(`[serveur] ${c}`))
  serveur.stderr.on('data', (c) => process.stderr.write(`[serveur:err] ${c}`))
  let serveurMort = null
  serveur.on('error', (e) => { serveurMort = e })
  serveur.on('exit', (code) => { serveurMort ??= new Error(`serveur E2E arrêté (code ${code})`) })
  try {
    await attendreSante()
    if (serveurMort) throw serveurMort
    const commerce = await preparerCommerce()
    resultats.commerce = commerce.id

    const navigateur = await chromium.launch()
    try {
      const contexte = await navigateur.newContext({ ...devices['Pixel 7'], baseURL: BASE, locale: 'fr-FR', timezoneId: 'Europe/Paris', reducedMotion: 'reduce', serviceWorkers: 'block' })
      const client = await contexte.newPage()
      await ralentir(contexte, client)
      surveiller(client, '#/jouer')
      // Journal des requêtes (pour situer une erreur : quelle étape a appelé quoi).
      const journalRequetes = []
      client.on('request', (r) => journalRequetes.push(`${new Date().toISOString().slice(11, 19)} ${r.method()} ${r.url().replace(BASE, '')}`))
      await observerLcp(client)

      // --- 1. Premier affichage de #/jouer, à froid (cache vide, 4G) ---
      let t0 = horloge()
      await client.goto(`/#/jouer/${commerce.id}`)
      await client.getByRole('heading', { name: commerce.nom }).waitFor()
      const premierAffichageMs = horloge() - t0
      resultats.etapes.premierAffichageJouerMs = premierAffichageMs
      await client.waitForTimeout(DELAI_LCP_MS)
      resultats.lcp.jouer = await lcp(client)
      resultats.etapes.navigationJouerMs = await navigationMs(client)
      await client.screenshot({ path: join(dossier, 'jouer.png') })
      resultats.captures.jouer = 'jouer.png'

      // --- 2. Parcours scan → lot (à chaud : visite à valider en caisse entre-temps) ---
      // Taps comptés : 1 clic = 1 tap ; 1 champ rempli = 1 saisie (frappes clavier comptées à part, voir SCORES.md).
      const taps = { clicsClient: 0, saisiesClient: 0, clicsCaisse: 0, saisiesCaisse: 0 }
      const parcours = {}
      t0 = horloge()
      await client.getByLabel('Téléphone ou e-mail').fill(TELEPHONE)
      taps.saisiesClient++
      await client.getByRole('button', { name: 'C’est parti' }).click()
      taps.clicsClient++
      await client.locator('[data-attente="en-cours"]').waitFor()
      parcours.inscriptionMs = horloge() - t0

      // Caisse (autre appareil) : code équipe, recherche, passage — mêmes conditions 4G + CPU ×4 que le client.
      const tablette = await navigateur.newContext({ ...devices['Pixel 7'], baseURL: BASE, locale: 'fr-FR', timezoneId: 'Europe/Paris', reducedMotion: 'reduce', serviceWorkers: 'block' })
      const caisse = await tablette.newPage()
      await ralentir(tablette, caisse)
      surveiller(caisse, '#/caisse')
      t0 = horloge()
      await caisse.goto(`/#/caisse/${commerce.id}`)
      await caisse.getByLabel('Votre code équipe (4 chiffres)').fill(CODE_EQUIPE)
      taps.saisiesCaisse++
      await caisse.getByRole('button', { name: 'Ouvrir la caisse' }).click()
      taps.clicsCaisse++
      await caisse.getByText('Connecté : Camille').waitFor()
      await caisse.getByLabel('Ou chercher : prénom, téléphone ou e-mail').fill('0612')
      taps.saisiesCaisse++
      await caisse.getByRole('button', { name: /06 ?12 ?34 ?56 ?78|\+33 ?6 ?12/ }).click()
      taps.clicsCaisse++
      await caisse.getByRole('button', { name: '＋ Ajouter un passage' }).click()
      taps.clicsCaisse++
      await caisse.getByText(/✓ Passage enregistré/).waitFor()
      parcours.validationCaisseMs = horloge() - t0
      await caisse.screenshot({ path: join(dossier, 'caisse.png') })
      resultats.captures.caisse = 'caisse.png'

      // Client : vérification puis tirage.
      t0 = horloge()
      await client.getByRole('button', { name: 'C’est validé ? Vérifier maintenant' }).click()
      taps.clicsClient++
      await client.locator('[data-attente="validee"]').waitFor()
      parcours.verificationMs = horloge() - t0
      t0 = horloge()
      await client.getByRole('button', { name: /Tourner la roue/ }).click()
      taps.clicsClient++
      const gain = client.locator('[data-resultat="gain"]')
      await gain.waitFor()
      parcours.tirageMs = horloge() - t0
      parcours.taps = taps
      resultats.etapes.parcoursScanLot = parcours
      await client.screenshot({ path: join(dossier, 'gain.png') })
      resultats.captures.gain = 'gain.png'

      // Carte de fidélité.
      t0 = horloge()
      await client.getByRole('link', { name: 'Voir ma carte de fidélité' }).last().click()
      taps.clicsClient++
      await client.locator('[data-tampons]').waitFor()
      resultats.etapes.ouvertureCarteMs = horloge() - t0
      await client.screenshot({ path: join(dossier, 'carte.png') })
      resultats.captures.carte = 'carte.png'

      // Menu public (navigation par hash : réinitialiser le LCP avant, sinon la valeur de #/jouer persiste).
      // Le LCP d'une navigation par hash n'est pas une mesure par page fiable (aucune nouvelle entrée si le plus
      // grand élément ne change pas) : mesurer aussi le menu par chargement direct (nouveau document).
      t0 = horloge()
      let affichageMenuMs = null
      const lcpMenu = await lcpApresNavigation(client, async () => {
        await client.goto(`/#/menu/${commerce.id}`)
        await client.getByRole('heading', { name: commerce.nom }).waitFor()
        affichageMenuMs = horloge() - t0
      })
      resultats.etapes.premierAffichageMenuMs = affichageMenuMs
      resultats.lcp.menu = lcpMenu
      await client.screenshot({ path: join(dossier, 'menu.png') })
      resultats.captures.menu = 'menu.png'
      const menuDirect = await contexte.newPage()
      await ralentir(contexte, menuDirect)
      surveiller(menuDirect, '#/menu-direct')
      await observerLcp(menuDirect)
      t0 = horloge()
      await menuDirect.goto(`/#/menu/${commerce.id}`)
      await menuDirect.getByRole('heading', { name: commerce.nom }).waitFor()
      resultats.etapes.premierAffichageMenuDirectMs = horloge() - t0
      await menuDirect.waitForTimeout(DELAI_LCP_MS)
      resultats.lcp.menuDirect = await lcp(menuDirect)
      await menuDirect.close()
      resultats.journalRequetes = journalRequetes

      // --- 3. Back-office : déverrouillage avec le PIN du commerce de test (onglet « Mon commerce », défaut) ---
      // L'onglet « Admin (tous) » n'est pas utilisé ici : ses boutons ont role="tab", pas role="button".
      const admin = await contexte.newPage()
      await ralentir(contexte, admin)
      surveiller(admin, '#back-office')
      await observerLcp(admin)
      try {
        await admin.goto('/#/accueil')
        // getByLabel('Commerce') est ambigu (le sélecteur d'en-tête « Commerce affiché ») : cibler l'id du champ.
        await admin.locator('#verrou-commerce').selectOption(commerce.id)
        await admin.locator('#verrou-pin').fill(PIN_COMMERCE)
        await admin.getByRole('button', { name: /Déverrouiller/i }).click()
        // « Tableau de bord » est le titre de la page, pas un lien de navigation.
        await admin.getByRole('heading', { name: 'Tableau de bord' }).waitFor({ timeout: 10_000 })
        resultats.etapes.deverrouillageCommerceMs = 'ok'
      } catch (e) {
        resultats.etapes.deverrouillageCommerceMs = `ÉCHEC : ${e instanceof Error ? e.message.split('\n')[0] : e}`
      }
      // Échec du déverrouillage = passe invalide pour le back-office : pas de captures « réussies » d'un écran verrouillé.
      const ecrans = [['tableau-de-bord', 'accueil', 'Tableau de bord'], ['clients', 'clients', 'Clients'], ['roulette', 'roulette', 'Roulette'], ['reglages', 'reglages', 'Réglages']]
      for (const [nom, route, titre] of ecrans) {
        if (resultats.etapes.deverrouillageCommerceMs !== 'ok') {
          resultats.captures[nom] = 'non capturé (déverrouillage en échec — passe back-office invalide)'
          continue
        }
        try {
          await admin.goto(`/#/${route}`)
          await admin.getByRole('heading', { name: titre }).waitFor({ timeout: 10_000 })
          await admin.screenshot({ path: join(dossier, `${nom}.png`) })
          resultats.captures[nom] = `${nom}.png`
        } catch (e) {
          resultats.captures[nom] = `ÉCHEC : ${e instanceof Error ? e.message.split('\n')[0] : e}`
        }
      }
      await tablette.close()
      await contexte.close()
    } finally {
      await navigateur.close()
    }
  } finally {
    serveur.kill('SIGTERM')
  }
  writeFileSync(sortie, JSON.stringify(resultats, null, 2))
  console.log(JSON.stringify(resultats, null, 2))
}

main().catch((e) => {
  console.error(`Erreur : ${e instanceof Error ? e.message : e}`)
  process.exitCode = 1
})

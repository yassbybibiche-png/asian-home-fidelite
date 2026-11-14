// Tableau de bord (P1-1) : section « Retours de demain » — état vide honnête sur un commerce neuf, puis liste
// nominative après un vrai gain (client inscrit avec prénom, roue libre, lot à 100 %).
// Serveur local + base SQLite temporaire (tests-e2e/serveur.ts), jamais la production.
import { expect, test, type APIRequestContext, type Browser } from '@playwright/test'

const ADMIN = { 'X-Admin-PIN': '000000' }
const PIN = '4321'
const TELEPHONE = '06 12 34 56 78'
const PRENOM = 'Camille'
const LOT = 'Nems offerts'

test.beforeEach(({ baseURL }) => {
  // Garde-fou : ce test n'écrit que sur un serveur local.
  expect(new URL(baseURL!).hostname).toBe('127.0.0.1')
})

/** Commerce neuf, accès libre explicite (lot gagnant à 100 %, pour un résultat déterministe), via l'API. */
async function preparerCommerce(request: APIRequestContext) {
  const r = await request.post('/api/v1/commerces', {
    headers: ADMIN,
    data: {
      nom: `E2E Retours ${Date.now()}`,
      type: 'restaurant',
      pin: PIN,
      modeAccesRoue: 'libre',
      lots: [
        { libelle: LOT, probabilite: 100 },
        { libelle: 'Perdu', probabilite: 0 },
      ],
    },
  })
  expect(r.status()).toBe(201)
  const { commerce } = await r.json()
  return commerce as { id: string; nom: string }
}

/** Tableau de bord commerçant, dans un autre contexte (autre appareil) : déverrouillage par le PIN. */
async function ouvrirTableauDeBord(browser: Browser, baseURL: string | undefined, commerce: { nom: string }) {
  const contexte = await browser.newContext({ baseURL, locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block', reducedMotion: 'reduce' })
  const page = await contexte.newPage()
  await page.goto('/#/reglages')
  await page.getByLabel('Commerce', { exact: true }).selectOption({ label: commerce.nom })
  await page.getByLabel('PIN du commerce (4 à 6 chiffres)').fill(PIN)
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await page.goto('#/')
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible()
  return { contexte, page }
}

test('commerce neuf : « Retours de demain » visible, état vide honnête', async ({ browser, request, baseURL }) => {
  const commerce = await preparerCommerce(request)
  const { contexte, page } = await ouvrirTableauDeBord(browser, baseURL, commerce)
  const section = page.locator('section[aria-labelledby="retours-demain-titre"]')
  await expect(section.getByRole('heading', { name: 'Retours de demain' })).toBeVisible()
  await expect(section).toContainText('Aucun gain en attente pour demain.')
  await contexte.close()
})

test('gain du jour : le client (prénom + lot) apparaît, utilisable dès demain', async ({ browser, page, request, baseURL }) => {
  const commerce = await preparerCommerce(request)

  // 1. Le client joue et gagne ; prénom donné après le tirage, pour que la liste soit nominative.
  await page.goto(`/#/jouer/${commerce.id}`)
  await page.getByLabel('Téléphone ou e-mail').fill(TELEPHONE)
  await page.getByRole('button', { name: 'C’est parti' }).click()
  await page.getByRole('button', { name: /Tourner la roue/ }).click()
  const resultat = page.locator('[data-resultat="gain"]')
  await expect(resultat).toBeVisible()
  await expect(resultat).toContainText(LOT)
  const formulairePrenom = page.locator('form[aria-label="Votre prénom (optionnel)"]')
  await formulairePrenom.locator('#j-prenom').fill(PRENOM)
  await formulairePrenom.getByRole('button', { name: 'OK' }).click()
  await expect(page.getByText(`Merci ${PRENOM}, votre carte est à votre nom.`)).toBeVisible()

  // 2. Le commerçant ouvre son tableau de bord (autre appareil) : le retour de demain y figure.
  const { contexte, page: tableau } = await ouvrirTableauDeBord(browser, baseURL, commerce)
  const section = tableau.locator('section[aria-labelledby="retours-demain-titre"]')
  await expect(section).toContainText(PRENOM)
  await expect(section).toContainText(LOT)
  await expect(section).toContainText('dès demain')
  await expect(section).toContainText('jusqu’au')
  await expect(section.getByRole('link', { name: PRENOM })).toBeVisible()
  await contexte.close()
})

// P2-4 dans Chromium : écran Messages — bandeau « Mode test » visible seulement quand /sante dit modeTest,
// placé au-dessus des interrupteurs ; chaque relance automatique porte son déclencheur dans sa phrase.
// Serveur local + base SQLite temporaire (tests-e2e/serveur.ts), jamais la production.
import { expect, test } from '@playwright/test'

const ADMIN = { 'X-Admin-PIN': '000000' }
const PIN = '4321'

test.beforeEach(({ baseURL }) => {
  expect(new URL(baseURL!).hostname).toBe('127.0.0.1')
})

async function ouvrirMessages(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext, modeTest?: boolean) {
  const nom = `E2E Relances ${Date.now()}`
  const r = await request.post('/api/v1/commerces', {
    headers: ADMIN,
    data: { nom, type: 'restaurant', pin: PIN, lots: [{ libelle: 'Nems offerts', type: 'lot', probabilite: 70 }, { libelle: 'Perdu', type: 'perdant', probabilite: 30 }] },
  })
  expect(r.status()).toBe(201)
  if (modeTest !== undefined) {
    // Le serveur E2E n'a pas de Brevo : /sante est simulée avec modeTest, comme en production en mode test.
    await page.route('**/api/v1/sante', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, integrations: { sms: true, email: true, modeTest }, migrations: { relances: true } }),
      }),
    )
  }
  await page.goto('/#/messages')
  await page.getByLabel('Commerce', { exact: true }).selectOption({ label: nom })
  await page.getByLabel('PIN du commerce (4 à 6 chiffres)').fill(PIN)
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await expect(page.getByRole('heading', { name: 'Relances SMS / e-mail' })).toBeVisible()
}

test('mode test : bandeau visible au-dessus des interrupteurs, 3 déclencheurs dans les libellés', async ({ page, request }) => {
  await ouvrirMessages(page, request, true)

  const bandeau = page.locator('[data-bandeau-mode-test]')
  await expect(bandeau).toBeVisible()
  await expect(bandeau).toContainText('Mode test : aucun SMS/e-mail ne part réellement.')
  // Au-dessus des interrupteurs : le bandeau précède le fieldset dans le document.
  const avant = await page.evaluate(() => {
    const b = document.querySelector('[data-bandeau-mode-test]')!
    const f = document.querySelector('fieldset')!
    return Boolean(b.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
  expect(avant).toBe(true)

  // Chaque relance automatique porte son déclencheur dans sa propre phrase.
  await expect(page.getByText(/à l’ouverture du tableau de bord/)).toHaveCount(3)
  await expect(page.getByText(/« Vous nous manquez ».*à l’ouverture du tableau de bord/)).toBeVisible()
  await expect(page.getByText(/Message d’anniversaire.*à l’ouverture du tableau de bord/)).toBeVisible()
  await expect(page.getByText(/« Votre gain expire bientôt ».*à l’ouverture du tableau de bord/)).toBeVisible()
})

test('sans mode test : pas de bandeau, les déclencheurs restent lisibles', async ({ page, request }) => {
  await ouvrirMessages(page, request)

  await expect(page.locator('[data-bandeau-mode-test]')).toHaveCount(0)
  await expect(page.getByText(/SMS : non branché/)).toBeVisible()
  await expect(page.getByText(/à l’ouverture du tableau de bord/)).toHaveCount(3)
})

// Menu visuel (13/11/2026) dans Chromium : rail « En photos », onglets, recherche, grande carte photo
// qui ouvre la fiche, et item du rail qui amène à la fiche ouverte du plat.
// Serveur local + base SQLite temporaire (tests-e2e/serveur.ts), jamais la production.
import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN = { 'X-Admin-PIN': '000000' }
const PIN = '4321'

test.beforeEach(({ baseURL }) => {
  // Garde-fou : ce test n'écrit que sur un serveur local.
  expect(new URL(baseURL!).hostname).toBe('127.0.0.1')
})

/** Commerce neuf + menu de 2 catégories (3 plats, dont 2 photographiés), via l'API. */
async function preparerMenu(request: APIRequestContext) {
  const r = await request.post('/api/v1/commerces', {
    headers: ADMIN,
    data: { nom: `E2E Menu visuel ${Date.now()}`, type: 'restaurant', pin: PIN },
  })
  expect(r.status()).toBe(201)
  const commerce = (await r.json()).commerce as { id: string }
  const m = await request.put(`/api/v1/commerces/${commerce.id}/menu`, {
    headers: { 'X-Commerce-PIN': PIN },
    data: {
      categories: [
        {
          nom: 'Plats thaï',
          produits: [
            {
              nom: 'Pad Thaï',
              prix: 1290,
              description: 'Nouilles de riz sautées, cacahuètes, citron vert.',
              photo: '/visuels/menu-pad-thai.webp',
              photoVignette: '/visuels/menu-pad-thai-vignette.webp',
              allergenes: ['Arachides', 'Soja'],
            },
            { nom: 'Curry Vert', prix: 1350, allergenes: [] },
          ],
        },
        {
          nom: 'Desserts',
          produits: [
            {
              nom: 'Mango Stick',
              prix: 690,
              photo: '/visuels/menu-mango-sticky-rice.jpg',
              photoVignette: '/visuels/menu-mango-sticky-rice-vignette.webp',
              allergenes: [],
            },
          ],
        },
      ],
    },
  })
  expect(m.status()).toBe(200)
  return commerce
}

test('menu visuel : rail « En photos », onglets, recherche, carte photo → fiche, rail → fiche ouverte', async ({ page, request }) => {
  const commerce = await preparerMenu(request)
  await page.goto(`/#/menu/${commerce.id}`)

  const rail = page.getByRole('region', { name: 'En photos' })
  const plat = (nom: string) => page.getByRole('listitem').filter({ hasText: nom })
  const onglet = (nom: string) => page.getByRole('navigation', { name: 'Catégories' }).getByRole('button', { name: nom, exact: true })

  // 1. Le rail montre les plats photographiés.
  await expect(rail).toBeVisible()
  await expect(rail.getByRole('button', { name: 'Voir le plat : Pad Thaï' })).toBeVisible()
  await expect(rail.getByRole('button', { name: 'Voir le plat : Mango Stick' })).toBeVisible()
  await expect(rail.getByRole('button', { name: /Curry Vert/ })).toHaveCount(0)

  // 2. Onglet « Desserts » : seul le dessert reste dans la liste.
  await onglet('Desserts').click()
  await expect(plat('Mango Stick')).toBeVisible()
  await expect(plat('Pad Thaï')).toHaveCount(0)
  await onglet('Toutes').click()
  await expect(plat('Pad Thaï')).toBeVisible()

  // 3. Recherche « curry » : seul Curry Vert, rail masqué ; effacer ramène tout.
  const recherche = page.getByLabel('Rechercher un plat')
  await recherche.fill('curry')
  await expect(page.getByRole('listitem')).toHaveCount(1)
  await expect(plat('Curry Vert')).toBeVisible()
  await expect(rail).toHaveCount(0)
  await recherche.fill('')
  await expect(page.getByRole('listitem')).toHaveCount(3)
  await expect(rail).toBeVisible()

  // 4. La grande carte photo de Pad Thaï ouvre la fiche (prix + allergènes), un second clic la referme.
  const carte = plat('Pad Thaï').getByRole('button', { name: 'Voir le plat : Pad Thaï' })
  await carte.click()
  await expect(carte).toHaveAttribute('aria-expanded', 'true')
  const fiche = plat('Pad Thaï').getByRole('img', { name: 'Photo du plat : Pad Thaï' })
  await expect(fiche).toBeVisible()
  await expect(plat('Pad Thaï').getByText('Prix :')).toBeVisible()
  await expect(plat('Pad Thaï').getByText('12,90', { exact: false }).first()).toBeVisible()
  await expect(plat('Pad Thaï').getByText('Allergènes : Arachides, Soja')).toBeVisible()
  await carte.click()
  await expect(fiche).toHaveCount(0)

  // 5. Depuis l'onglet « Desserts », l'item du rail ramène à « Toutes » et ouvre la fiche de Pad Thaï.
  await onglet('Desserts').click()
  await expect(plat('Pad Thaï')).toHaveCount(0)
  await rail.getByRole('button', { name: 'Voir le plat : Pad Thaï' }).click()
  await expect(fiche).toBeVisible()
  await expect(plat('Pad Thaï').getByText('Allergènes : Arachides, Soja')).toBeVisible()
  await expect(onglet('Toutes')).toHaveAttribute('aria-pressed', 'true')
})

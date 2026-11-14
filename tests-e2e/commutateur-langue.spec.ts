// Commutateur FR / EN sur #/bienvenue et #/commande (P1-3) — un client anglophone qui arrive directement sur la
// page d'accueil ou sur le QR de table doit pouvoir basculer de langue sur place, et son choix mémorisé doit
// suivre d'une page à l'autre. Serveur local + base SQLite temporaire (tests-e2e/serveur.ts), jamais la production.
import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN = { 'X-Admin-PIN': '000000' }
const PIN = '4321'
const GERANT = { 'X-Commerce-PIN': PIN }

test.beforeEach(({ baseURL }) => {
  // Garde-fou : ce test n'écrit que sur un serveur local.
  expect(new URL(baseURL!).hostname).toBe('127.0.0.1')
})

/** Commerce de test, module commande ACTIVÉ, 1 table (jeton tiré par le serveur). */
async function preparer(request: APIRequestContext) {
  const nom = `E2E Langue ${Date.now()}`
  const r = await request.post('/api/v1/commerces', { headers: ADMIN, data: { nom, type: 'restaurant', pin: PIN } })
  expect(r.status()).toBe(201)
  const commerce = (await r.json()).commerce as { id: string }
  const m = await request.put(`/api/v1/commerces/${commerce.id}/menu`, {
    headers: GERANT,
    data: { categories: [{ nom: 'Plats', produits: [{ nom: 'Pad Thaï', prix: 1290, allergenes: [] }] }] },
  })
  expect(m.status(), await m.text()).toBe(200)
  const p = await request.patch(`/api/v1/commerces/${commerce.id}`, {
    headers: GERANT,
    data: { commande: { active: true, tables: [{ nom: 'Table 1' }] } },
  })
  expect(p.status(), await p.text()).toBe(200)
  const tables = (await p.json()).commerce.commande.tables as { nom: string; jeton: string }[]
  return { id: commerce.id, nom, jeton: tables[0].jeton }
}

test.describe('commutateur FR / EN — #/bienvenue et #/commande', () => {
  test('#/bienvenue : FR par défaut, bascule EN puis retour FR', async ({ page, request }) => {
    const c = await preparer(request)
    await page.goto(`/#/bienvenue/${c.id}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(c.nom)
    await expect(page.getByText('Bienvenue chez', { exact: true })).toBeVisible()
    // Le commutateur est en tête de page, avant le logo (même placement que #/menu).
    await expect(page.getByRole('button', { name: 'English' })).toBeVisible()
    await page.getByRole('button', { name: 'English' }).click()
    await expect(page.getByText('Welcome to', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Discover the menu' })).toBeVisible()
    await page.getByRole('button', { name: 'Français' }).click()
    await expect(page.getByText('Bienvenue chez', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Découvrir la carte' })).toBeVisible()
  })

  test('#/commande : bascule EN puis retour FR ; le choix mémorisé suit de #/bienvenue à #/commande', async ({ page, request }) => {
    const c = await preparer(request)
    // Choix mémorisé sur #/bienvenue : #/commande l'applique sans nouveau clic.
    await page.goto(`/#/bienvenue/${c.id}`)
    await expect(page.getByText('Bienvenue chez', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'English' }).click()
    await expect(page.getByText('Welcome to', { exact: true })).toBeVisible()

    await page.goto(`/#/commande/${c.id}/${c.jeton}`)
    await expect(page.getByRole('heading', { name: 'Table 1' })).toBeVisible()
    await expect(page.getByText('Your table', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Français' }).click()
    await expect(page.getByText('Votre table', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'English' }).click()
    await expect(page.getByText('Your table', { exact: true })).toBeVisible()
  })
})

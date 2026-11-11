// P0-S7 dans Chromium : la carte ouverte sur un AUTRE téléphone (sans jeton) n'affiche que la vue limitée ; le QR
// d'accès remis au comptoir l'ouvre en entier, une seule fois, et disparaît de l'adresse. Serveur local en mode strict.
import { expect, test } from '@playwright/test'

const ADMIN = { 'X-Admin-PIN': '000000' }
const PIN = '4321'

test.beforeEach(({ baseURL }) => {
  expect(new URL(baseURL!).hostname).toBe('127.0.0.1')
})

test('autre téléphone : vue limitée ; QR d’accès du comptoir → carte complète, lien retiré de l’adresse, usage unique', async ({ page, browser, request, baseURL }) => {
  const r = await request.post('/api/v1/commerces', { headers: ADMIN, data: { nom: `E2E Accès ${Date.now()}`, type: 'restaurant', pin: PIN } })
  expect(r.status()).toBe(201)
  const { commerce } = await r.json()
  const inscription = await request.post(`/api/v1/commerces/${commerce.id}/clients`, { data: { contact: '06 98 76 54 32' } })
  expect(inscription.status()).toBe(201)
  const { client } = await inscription.json()
  // Une visite validée, pour voir un tampon des deux côtés.
  expect((await request.post(`/api/v1/commerces/${commerce.id}/clients/${client.id}/visite`, { headers: { 'X-Commerce-PIN': PIN } })).status()).toBe(200)

  // 1. Lien de la carte seul (autre téléphone) : vue limitée, sans prénom ni historique.
  await page.goto(`/#/carte/${client.id}`)
  await expect(page.locator('[data-vue="limitee"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Accès limité sur ce téléphone' })).toBeVisible()
  await expect(page.locator('[data-tampons]')).toHaveAttribute('aria-label', `Tampons : 1 sur ${commerce.seuilTampons}`)
  await expect(page.getByText('Historique des visites et des lots')).toHaveCount(0)

  // 2. Au comptoir : QR d'accès (lien à usage unique) ouvert sur ce téléphone → carte complète.
  const lien = (await (await request.post(`/api/v1/commerces/${commerce.id}/clients/${client.id}/lien-acces`, { headers: { 'X-Commerce-PIN': PIN } })).json()).lien as string
  const chemin = lien.slice(lien.indexOf('/#/'))
  await page.goto(chemin)
  await expect(page.getByText('Historique des visites et des lots')).toBeVisible()
  await expect(page.locator('[data-vue="limitee"]')).toHaveCount(0)
  await expect(page).not.toHaveURL(/acces=/)
  await expect(page.getByText('Sécurité de ma carte')).toBeVisible()

  // 3. Le même lien sur un 3e appareil : déjà utilisé → vue limitée + message.
  const autre = await browser.newContext({ baseURL, locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block' })
  const troisieme = await autre.newPage()
  await troisieme.goto(chemin)
  await expect(troisieme.locator('[data-vue="limitee"]')).toBeVisible()
  await expect(troisieme.getByText('Ce lien d’accès a expiré ou a déjà servi : demandez-en un nouveau.')).toBeVisible()
  await autre.close()
})

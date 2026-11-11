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

// Revue Codex P0-S7, points 3 et 4 : la carte récupérée par le QR du comptoir doit pouvoir rejouer sans ressaisir de
// contact ; un accès retiré pendant que la roue est affichée mène à « Retrouver ma carte », pas à une erreur sèche.
test('carte récupérée au comptoir → « Tourner la roue » sans ressaisie → gain ; accès retiré → « Retrouver ma carte »', async ({ page, request }) => {
  const r = await request.post('/api/v1/commerces', {
    headers: ADMIN,
    data: { nom: `E2E Rejouer ${Date.now()}`, type: 'restaurant', pin: PIN, lots: [{ libelle: 'Nems offerts', probabilite: 100 }, { libelle: 'Perdu', probabilite: 0 }] },
  })
  expect(r.status()).toBe(201)
  const { commerce } = await r.json()
  const caisse = { 'X-Commerce-PIN': PIN }
  const recuperer = async (contact: string) => {
    const { client } = await (await request.post(`/api/v1/commerces/${commerce.id}/clients`, { data: { contact } })).json()
    expect((await request.post(`/api/v1/commerces/${commerce.id}/clients/${client.id}/visite`, { headers: caisse })).status()).toBe(200)
    const lien = (await (await request.post(`/api/v1/commerces/${commerce.id}/clients/${client.id}/lien-acces`, { headers: caisse })).json()).lien as string
    // Nouveau téléphone : le QR du comptoir ouvre la carte complète, puis « Tourner la roue du jour ».
    await page.goto(lien.slice(lien.indexOf('/#/')))
    await expect(page.getByText('Historique des visites et des lots')).toBeVisible()
    await page.getByRole('link', { name: '🎡 Tourner la roue du jour' }).click()
    await page.getByRole('button', { name: 'Continuer avec ma carte' }).click()
    await expect(page.getByLabel('Téléphone ou e-mail')).toHaveCount(0)
    return client as { id: string }
  }

  // Point 3 : aucun contact ressaisi, le tirage part avec le jeton de la carte récupérée.
  const a = await recuperer('06 11 22 33 44')
  await page.getByRole('button', { name: /Tourner la roue/ }).click()
  await expect(page.locator('[data-resultat="gain"]')).toContainText('Nems offerts')

  // Point 4 : le commerce retire l'accès pendant que la roue est affichée → message + lien vers la carte.
  const b = await recuperer('06 55 66 77 88')
  expect(b.id).not.toBe(a.id)
  await expect(page.getByRole('button', { name: /Tourner la roue/ })).toBeVisible()
  expect((await request.post(`/api/v1/commerces/${commerce.id}/clients/${b.id}/revocation-acces`, { headers: caisse })).status()).toBe(200)
  await page.getByRole('button', { name: /Tourner la roue/ }).click()
  const perdu = page.locator('[data-acces="perdu"]')
  await expect(perdu).toContainText('Votre carte n’est plus ouverte sur ce téléphone')
  await expect(perdu.getByRole('link', { name: 'Retrouver ma carte' })).toHaveAttribute('href', `#/carte/${b.id}`)
  await perdu.getByRole('link', { name: 'Retrouver ma carte' }).click()
  await expect(page.locator('[data-vue="limitee"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Retrouver ma carte' })).toBeVisible()
})

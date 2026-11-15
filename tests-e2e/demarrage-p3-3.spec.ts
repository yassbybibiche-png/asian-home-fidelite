// P3-3 dans Chromium : Réglages → Commerce, encadré « Pour bien démarrer ». Les 3 vérifications sont lues sur
// l'état enregistré ; le QR se confirme par son propre bouton (PATCH du seul champ `qrImprime`) ; le plafond se
// règle dans l'onglet Roulette ; un enregistrement du formulaire principal n'efface pas la confirmation QR.
// Serveur local + base SQLite temporaire (tests-e2e/serveur.ts), jamais la production.
import { expect, test } from '@playwright/test'

const ADMIN = { 'X-Admin-PIN': '000000' }
const PIN = '4321'

test.beforeEach(({ baseURL }) => {
  expect(new URL(baseURL!).hostname).toBe('127.0.0.1')
})

async function creerCommerce(request: import('@playwright/test').APIRequestContext, nom: string, lots: unknown[]) {
  const r = await request.post('/api/v1/commerces', {
    headers: ADMIN,
    data: { nom, type: 'restaurant', pin: PIN, lots },
  })
  expect(r.status()).toBe(201)
  return (await r.json()).commerce as { id: string }
}

async function deverrouiller(page: import('@playwright/test').Page, nom: string) {
  await page.goto('/#/reglages')
  await page.getByLabel('Commerce', { exact: true }).selectOption({ label: nom })
  await page.getByLabel('PIN du commerce (4 à 6 chiffres)').fill(PIN)
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await expect(page.getByRole('heading', { name: 'Pour bien démarrer' })).toBeVisible()
}

test('Démarrage : lots et plafond lus sur l’enregistré, QR confirmé par son bouton, formulaire principal sans effet sur la confirmation', async ({ page, request }) => {
  const nom = `E2E Démarrage ${Date.now()}`
  const commerce = await creerCommerce(request, nom, [
    { libelle: 'Nems offerts', type: 'lot', probabilite: 70 },
    { libelle: 'Perdu', type: 'perdant', probabilite: 30 },
  ])

  await deverrouiller(page, nom)
  const encadre = page.locator('section', { has: page.getByRole('heading', { name: 'Pour bien démarrer' }) })

  // 1 lot à gagner, plafond à faire (Nems, sans plafond), QR à faire : 1/3.
  await expect(encadre.getByText(/1 vérification sur 3/)).toBeVisible()
  await expect(encadre.getByText('1 lot à gagner sur la roue')).toBeVisible()
  await expect(encadre.getByText(/donnez un plafond par jour à « Nems offerts »/)).toBeVisible()
  await expect(encadre.getByText(/Ouvrez la page QR vitrine/)).toBeVisible()
  await expect(encadre.getByRole('link', { name: 'Voir le QR à imprimer' })).toHaveAttribute('href', '#/qr')

  // Le bouton QR envoie le seul champ `qrImprime` ; l'encadré passe à 2/3, sans rechargement.
  const envoiQr = page.waitForRequest((q) => q.method() === 'PATCH' && q.url().endsWith(`/commerces/${commerce.id}`))
  await encadre.getByRole('button', { name: 'J’ai imprimé le QR' }).click()
  expect((await envoiQr).postDataJSON()).toEqual({ qrImprime: true })
  await expect(encadre.getByText(/2 vérifications sur 3/)).toBeVisible()
  await expect(encadre.getByText('Confirmé par vous.')).toBeVisible()
  await expect(encadre.getByRole('button', { name: 'Marquer comme non imprimé' })).toBeVisible()

  // Persisté après rechargement.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Pour bien démarrer' })).toBeVisible()
  await expect(encadre.getByText(/2 vérifications sur 3/)).toBeVisible()

  // Plafond réglé dans l'onglet Roulette, enregistré par le formulaire principal : 3/3.
  await page.getByRole('tab', { name: 'Roulette' }).click()
  await page.getByLabel('Plafond par jour du lot 1').fill('3')
  const enregistrer = page.getByRole('button', { name: 'Enregistrer', exact: true })
  await enregistrer.click()
  await expect(page.getByRole('button', { name: '✓ Enregistré' })).toBeVisible()
  await page.getByRole('tab', { name: 'Commerce' }).click()
  await expect(encadre.getByText(/Tout est prêt : 3 vérifications sur 3/)).toBeVisible()
  await expect(encadre.getByText('« Nems offerts » plafonné à 3 par jour')).toBeVisible()

  // Le formulaire principal n'efface pas la confirmation QR : nom modifié, enregistré, rechargé — toujours 3/3.
  await page.getByLabel('Nom du commerce').fill(`${nom} (renommé)`)
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(page.getByRole('button', { name: '✓ Enregistré' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Pour bien démarrer' })).toBeVisible()
  await expect(encadre.getByText(/Tout est prêt : 3 vérifications sur 3/)).toBeVisible()
  await expect(encadre.getByText('Confirmé par vous.')).toBeVisible()

  // Corriger la confirmation : le QR repasse à faire (2/3), persisté.
  const envoiQrNon = page.waitForRequest((q) => q.method() === 'PATCH' && q.url().endsWith(`/commerces/${commerce.id}`))
  await encadre.getByRole('button', { name: 'Marquer comme non imprimé' }).click()
  expect((await envoiQrNon).postDataJSON()).toEqual({ qrImprime: false })
  await expect(encadre.getByText(/2 vérifications sur 3/)).toBeVisible()
})

test('Démarrage : points seulement — plafond sans objet (1/2)', async ({ page, request }) => {
  const nom = `E2E Démarrage points ${Date.now()}`
  await creerCommerce(request, nom, [{ libelle: '10 points offerts', type: 'points', points: 10, probabilite: 100 }])

  await deverrouiller(page, nom)
  const encadre = page.locator('section', { has: page.getByRole('heading', { name: 'Pour bien démarrer' }) })
  await expect(encadre.getByText(/1 vérification sur 2/)).toBeVisible()
  await expect(encadre.getByText('1 lot à gagner sur la roue')).toBeVisible()
  await expect(encadre.getByText('Aucun lot physique à gagner : rien à plafonner.')).toBeVisible()
})

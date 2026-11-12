// Déblocage (12/11/2026) dans Chromium : les trois chantiers débloqués sur décision de l'utilisateur.
// a) prénom proposé dès l'inscription (optionnel) : avec prénom → résultat personnalisé, pas de « DemandePrenom » ;
//    sans prénom → le parcours continue ;
// b) badge « Bonus heures creuses actif » sur la page de jeu pendant un créneau ;
// c) bouton « Voir le menu » sur la page de jeu (dès l'arrivée) et sur la carte du client.
// Serveur local + base SQLite temporaire (tests-e2e/serveur.ts), jamais la production.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const ADMIN = { 'X-Admin-PIN': '000000' }
const PIN = '4321'
const LOT = 'Nems offerts'

test.beforeEach(({ baseURL }) => {
  // Garde-fou : ce test n'écrit que sur un serveur local.
  expect(new URL(baseURL!).hostname).toBe('127.0.0.1')
})

/** Commerce neuf, accès libre, lot gagnant à 100 % (résultat déterministe), via l'API. */
async function preparerCommerce(request: APIRequestContext, prefixe: string) {
  const r = await request.post('/api/v1/commerces', {
    headers: ADMIN,
    data: {
      nom: `E2E ${prefixe} ${Date.now()}`,
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
  return (await r.json()).commerce as { id: string; nom: string }
}

/** Inscription depuis la page de jeu (contact + prénom facultatif) puis tirage. */
async function inscrireEtTourner(page: Page, contact: string, prenom: string) {
  await page.getByLabel('Téléphone ou e-mail').fill(contact)
  if (prenom) await page.getByLabel('Votre prénom (optionnel)').fill(prenom)
  await page.getByRole('button', { name: 'C’est parti' }).click()
  await page.getByRole('button', { name: prenom ? `🎡 Tourner la roue, ${prenom} !` : '🎡 Tourner la roue !' }).click()
  const resultat = page.locator('[data-resultat="gain"]')
  await expect(resultat).toBeVisible()
  await expect(resultat).toContainText(LOT)
  return resultat
}

test('a) inscription avec prénom : résultat à son nom, pas de demande de prénom ; sans prénom : le parcours continue', async ({ page, browser, request, baseURL }) => {
  const commerce = await preparerCommerce(request, 'Prénom')

  // 1. Contact + prénom dès l'inscription.
  await page.goto(`/#/jouer/${commerce.id}`)
  await expect(page.getByRole('heading', { name: commerce.nom })).toBeVisible()
  const resultat = await inscrireEtTourner(page, '06 11 22 33 44', 'Linh')
  await expect(resultat).toContainText('Bravo Linh, vous avez gagné :')
  // Le prénom est déjà connu : la demande post-tirage (DemandePrenom) n'apparaît pas.
  await expect(page.getByRole('form', { name: 'Votre prénom (optionnel)' })).toHaveCount(0)
  await expect(page.getByText('Votre prénom, pour que l’équipe vous reconnaisse ? (optionnel)')).toHaveCount(0)
  // Côté commerçant : la carte créée porte ce prénom.
  const etat = await (await request.get(`/api/v1/commerces/${commerce.id}/etat`, { headers: { 'X-Commerce-PIN': PIN } })).json()
  const linh = (etat.clients as { prenom: string; telephone?: string }[]).filter((c) => c.prenom === 'Linh')
  expect(linh).toHaveLength(1)

  // 2. Autre téléphone, champ prénom laissé vide : l'inscription passe, la roue tourne, le prénom sera demandé après.
  const autre = await browser.newContext({ baseURL, locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block', reducedMotion: 'reduce' })
  const page2 = await autre.newPage()
  await page2.goto(`/#/jouer/${commerce.id}`)
  await expect(page2.getByLabel('Votre prénom (optionnel)')).toHaveValue('')
  const resultat2 = await inscrireEtTourner(page2, '06 55 66 77 88', '')
  await expect(resultat2).toContainText('Bravo, vous avez gagné :')
  await expect(page2.getByRole('form', { name: 'Votre prénom (optionnel)' })).toBeVisible()
  await autre.close()
  const etat2 = await (await request.get(`/api/v1/commerces/${commerce.id}/etat`, { headers: { 'X-Commerce-PIN': PIN } })).json()
  expect((etat2.clients as unknown[]).length).toBe(2)
})

test('b) créneau heures creuses toute la journée : badge « Bonus heures creuses actif » sur la page de jeu', async ({ page, request }) => {
  const commerce = await preparerCommerce(request, 'Creux')
  const r = await request.patch(`/api/v1/commerces/${commerce.id}`, {
    headers: { 'X-Commerce-PIN': PIN },
    data: {
      modeAccesRoue: 'libre',
      // Tous les jours, 00:00–23:59 (heure de Paris ; fin exclue : seule la minute 23:59 est hors créneau).
      creneauxCreux: [{ jours: [0, 1, 2, 3, 4, 5, 6], debut: '00:00', fin: '23:59' }],
      lots: [
        { libelle: LOT, probabilite: 50 },
        { libelle: 'Café des heures creuses', probabilite: 50, heuresCreuses: true },
      ],
    },
  })
  expect(r.status()).toBe(200)

  await page.goto(`/#/jouer/${commerce.id}`)
  const infos = page.locator('[data-lots-du-jour]')
  await expect(infos.locator('[data-bonus-creux]')).toBeVisible()
  await expect(infos.locator('[data-bonus-creux]')).toHaveText('⏰ Bonus heures creuses actif')
  // Le lot réservé au créneau est bien publié pendant celui-ci.
  await expect(infos.getByRole('listitem')).toHaveText([new RegExp(LOT), /Café des heures creuses/])
})

test('c) menu : « Voir le menu » sur la page de jeu dès l’arrivée → page menu avec le plat ; puis sur la carte du client', async ({ page, request }) => {
  const commerce = await preparerCommerce(request, 'Menu')
  const m = await request.put(`/api/v1/commerces/${commerce.id}/menu`, {
    headers: { 'X-Commerce-PIN': PIN },
    data: { categories: [{ nom: 'Entrées', produits: [{ nom: 'Raviolis vapeur', prix: 650, allergenes: [] }] }] },
  })
  expect(m.status()).toBe(200)

  // 1. Page de jeu, AVANT l'inscription : le bouton est là.
  await page.goto(`/#/jouer/${commerce.id}`)
  await expect(page.getByLabel('Téléphone ou e-mail')).toBeVisible()
  const voirMenu = page.getByRole('link', { name: '📖 Voir le menu', exact: true })
  await expect(voirMenu).toBeVisible()
  await voirMenu.click()
  await expect(page).toHaveURL(new RegExp(`#/menu/${commerce.id}$`))
  await expect(page.getByRole('heading', { name: 'Entrées' })).toBeVisible()
  await expect(page.getByText('Raviolis vapeur')).toBeVisible()

  // 2. Après l'inscription, la carte du client propose aussi le menu.
  await page.goto(`/#/jouer/${commerce.id}`)
  await inscrireEtTourner(page, '06 99 88 77 66', '')
  await page.getByRole('link', { name: 'Voir ma carte de fidélité' }).last().click()
  await expect(page).toHaveURL(/#\/carte\//)
  await expect(page.getByRole('link', { name: '📖 Voir le menu', exact: true })).toBeVisible()
})

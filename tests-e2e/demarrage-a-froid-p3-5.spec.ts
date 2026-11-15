// P3-5 — Démarrage à froid en vrai navigateur : le premier appel API reste sans réponse (11 s, comme un
// réveil Render) ; la balise anonyme part à la PREMIÈRE RÉPONSE reçue, avec la durée de l'épisode entier
// (`froid10a30s` ici), comptée par le serveur et lue dans le tableau de bord.
// Protocole corrigé le 15/11/2026 (audit expert) : l'ancienne spec attendait la balise AVANT le réessai,
// parce que l'ancien code l'envoyait dès l'abandon de l'appel, avec un délai plafonné et un abandon à 5 s
// — en conditions réelles, elle partait vers un serveur encore endormi et se perdait, et la tranche
// « 30 s ou plus » était inatteignable. La spec suit donc le protocole corrigé : abandon → épisode ouvert
// (rien ne part) → réessai réussi → épisode fermé → balise livrée.
// Serveur local + base SQLite temporaire (tests-e2e/serveur.ts), jamais la production.
import { expect, test } from '@playwright/test'

const ADMIN = { 'X-Admin-PIN': '000000' }
const PIN = '4321'

test.beforeEach(({ baseURL }) => {
  expect(new URL(baseURL!).hostname).toBe('127.0.0.1')
})

test('premier appel sans réponse (11 s) puis réessai → balise froid10a30s comptée et lue dans le tableau de bord', async ({ page, request }) => {
  const nom = `E2E Froid ${Date.now()}`
  const r = await request.post('/api/v1/commerces', {
    headers: ADMIN,
    data: { nom, type: 'restaurant', pin: PIN, lots: [{ libelle: 'Nems offerts', type: 'lot', probabilite: 70 }, { libelle: 'Perdu', type: 'perdant', probabilite: 30 }] },
  })
  expect(r.status()).toBe(201)
  const { commerce } = await r.json()

  // Premier appel de la fiche ralenti une seule fois (11 s) : le client abandonne à 10 s (son délai par
  // défaut) — l'épisode de réveil s'ouvre, aucune balise ne part encore ; la relecture ensuite passe sans délai.
  let retarde = true
  await page.route(`**/api/v1/commerces/${commerce.id}`, async (route) => {
    if (!retarde || route.request().method() !== 'GET') return route.continue()
    retarde = false
    await new Promise((ok) => setTimeout(ok, 11_000))
    try {
      const reponse = await route.fetch()
      await route.fulfill({ response: reponse })
    } catch {
      // Le navigateur a déjà abandonné la requête à 10 s : rien à servir.
    }
  })

  await page.goto(`/#/jouer/${commerce.id}`)

  // La page a affiché l'écran hors ligne (appel abandonné) : un nouvel essai charge le jeu — et c'est sa
  // réponse qui ferme l'épisode et déclenche la balise (attente totale ≈ 12 s : tranche 10–30 s).
  // Délai d'attente explicite : le bouton n'apparaît qu'après l'abandon du client (10 s après le début de
  // l'appel, lui-même postérieur au chargement de la page) — les 10 s par défaut de `expect` ne suffisent
  // pas (échec constaté à la première passe complète : page encore en chargement à 10,6 s).
  await expect(page.getByRole('button', { name: 'Réessayer' }).first()).toBeVisible({ timeout: 25_000 })
  const balise = page.waitForRequest(
    (q) => q.method() === 'POST' && q.url().endsWith(`/commerces/${commerce.id}/evenements`) && (q.postData() ?? '').includes('froid10a30s'),
    { timeout: 30_000 },
  )
  await page.getByRole('button', { name: 'Réessayer' }).first().click()
  const requeteBalise = await balise
  expect(requeteBalise.postDataJSON()).toEqual({ type: 'froid10a30s' })
  await expect(page.getByRole('list', { name: 'Lots de la roue' }).getByText('Nems offerts')).toBeVisible()

  // Compteur serveur : 1 événement froid10a30s aujourd'hui.
  const mesures = await request.get(`/api/v1/commerces/${commerce.id}/mesures`, { headers: { 'X-Commerce-PIN': PIN } })
  expect(mesures.status()).toBe(200)
  const compteurs = (await mesures.json()).compteurs as { jour: string; type: string; n: number }[]
  expect(compteurs).toContainEqual(expect.objectContaining({ type: 'froid10a30s', n: 1 }))

  // Tableau de bord : la section affiche les deux tranches (le compteur 1 est prouvé par l'API ci-dessus).
  await page.goto('/#/reglages')
  await page.getByLabel('Commerce', { exact: true }).selectOption({ label: nom })
  await page.getByLabel('PIN du commerce (4 à 6 chiffres)').fill(PIN)
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await page.goto('/#/accueil')
  const carte = page.locator('.carte', { hasText: 'Démarrages à froid' })
  await expect(carte).toBeVisible()
  await expect(carte.getByText('Premier appel lent de 10 à 30 s')).toBeVisible()
  await expect(carte.getByText('Premier appel lent de plus de 30 s')).toBeVisible()
  await expect(carte.getByText('docs/VEILLE-RENDER.md')).toBeVisible()
})

// Commande à table de bout en bout (Expérience 10/10, lot 3) — SIMULATION deux contextes navigateur (deux
// téléphones simulés, Pixel 7) : le téléphone du client (#/commande/<id>/<jetonTable>) et celui de la cuisine
// (#/cuisine, session PIN). Ce ne sont pas deux appareils réels : deux contextes isolés du même Chromium, sans
// stockage partagé, qui ne se parlent que par le serveur. Serveur local + base SQLite temporaire
// (tests-e2e/serveur.ts), jamais la production.
import { devices, expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'

const ADMIN = { 'X-Admin-PIN': '000000' }
const PIN = '4321'
const GERANT = { 'X-Commerce-PIN': PIN }

test.beforeEach(({ baseURL }) => {
  // Garde-fou : ce test n'écrit que sur un serveur local.
  expect(new URL(baseURL!).hostname).toBe('127.0.0.1')
})

/**
 * Commerce de test, module commande ACTIVÉ, 2 tables (jetons tirés par le serveur, relus par la route commerçant) et
 * un menu : 2 plats avec prix, 1 sans prix, 1 indisponible.
 */
async function preparer(request: APIRequestContext) {
  const nom = `E2E Commande ${Date.now()}`
  const r = await request.post('/api/v1/commerces', { headers: ADMIN, data: { nom, type: 'restaurant', pin: PIN } })
  expect(r.status()).toBe(201)
  const commerce = (await r.json()).commerce as { id: string }
  const m = await request.put(`/api/v1/commerces/${commerce.id}/menu`, {
    headers: GERANT,
    data: {
      categories: [
        {
          nom: 'Plats',
          produits: [
            { nom: 'Pad Thaï', prix: 1290, allergenes: [] },
            { nom: 'Curry Vert', prix: 1350, allergenes: [] },
            { nom: 'Plat du marché', prix: null, allergenes: [] },
            { nom: 'Bo Bun', prix: 1190, allergenes: [], indisponible: true },
          ],
        },
      ],
    },
  })
  expect(m.status(), await m.text()).toBe(200)
  const p = await request.patch(`/api/v1/commerces/${commerce.id}`, {
    headers: GERANT,
    data: { commande: { active: true, tables: [{ nom: 'Table 1' }, { nom: 'Table 2' }] } },
  })
  expect(p.status(), await p.text()).toBe(200)
  const tables = (await p.json()).commerce.commande.tables as { nom: string; jeton: string }[]
  expect(tables.map((t) => t.nom)).toEqual(['Table 1', 'Table 2'])
  return { id: commerce.id, nom, jetons: tables.map((t) => t.jeton) }
}

/** Second téléphone simulé : nouveau contexte isolé (pas de stockage partagé), mêmes réglages que le projet. */
async function telephone(browser: Browser, baseURL: string): Promise<Page> {
  const contexte = await browser.newContext({
    ...devices['Pixel 7'],
    baseURL,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  })
  return contexte.newPage()
}

/** Téléphone de la cuisine : #/cuisine, déverrouillé avec le PIN du commerce de test. */
async function ouvrirCuisine(cuisine: Page, nom: string) {
  await cuisine.goto('/#/cuisine')
  await cuisine.getByLabel('Commerce', { exact: true }).selectOption({ label: nom })
  await cuisine.getByLabel('PIN du commerce (4 à 6 chiffres)').fill(PIN)
  await cuisine.getByRole('button', { name: 'Déverrouiller' }).click()
  await expect(cuisine.getByRole('heading', { level: 1, name: 'Cuisine' })).toBeVisible()
}

async function commandesDuJour(request: APIRequestContext, id: string) {
  const r = await request.get(`/api/v1/commerces/${id}/commandes`, { headers: GERANT })
  expect(r.status()).toBe(200)
  return (await r.json()).commandes as { id: string; table: string; statut: string }[]
}

test.describe('commande à table — simulation deux contextes navigateur (deux téléphones simulés)', () => {
  test('client : 2 plats → « Reçue » ; cuisine : Nouveau → Accepter → En préparation → Servie ; client : « Servie »', async ({ page: client, browser, baseURL, request }) => {
    const c = await preparer(request)
    const cuisine = await telephone(browser, baseURL!)

    // Cuisine ouverte AVANT la commande : elle doit arriver d'elle-même (relecture 10 s).
    await ouvrirCuisine(cuisine, c.nom)
    await expect(cuisine.getByText('Aucune commande pour l’instant.', { exact: false })).toBeVisible()

    // Téléphone A (client) : table 1, 2 × Pad Thaï + 1 × Curry Vert.
    await client.goto(`/#/commande/${c.id}/${c.jetons[0]}`)
    await expect(client.getByRole('heading', { level: 1 })).toHaveText('Table 1')
    await client.getByRole('button', { name: 'Ajouter : Pad Thaï' }).click()
    await client.getByRole('button', { name: 'Un de plus : Pad Thaï' }).click()
    await client.getByRole('button', { name: 'Ajouter : Curry Vert' }).click()
    // Plat sans prix et plat indisponible : jamais ajoutables.
    await expect(client.getByRole('button', { name: 'Ajouter : Plat du marché' })).toHaveCount(0)
    await expect(client.getByRole('button', { name: 'Ajouter : Bo Bun' })).toHaveCount(0)
    await client.getByRole('button', { name: /Voir le panier/ }).click()
    await expect(client.getByRole('heading', { name: 'Votre panier' })).toBeVisible()
    await client.getByRole('button', { name: 'Confirmer la commande' }).click()
    await expect(client.getByRole('heading', { name: 'Votre commande' })).toBeVisible()
    await expect(client.getByText('Reçue').first()).toBeVisible()

    // Téléphone B (cuisine) : la commande apparaît par la relecture, signalée « Nouveau ».
    const carte = cuisine.getByRole('article', { name: /^Table 1, commande de / })
    await expect(carte).toBeVisible({ timeout: 20_000 })
    await expect(carte.getByText('Nouveau', { exact: true })).toBeVisible()
    await expect(cuisine.getByRole('region', { name: 'Nouvelles' })).toContainText('Table 1')
    await expect(carte).toContainText('2 ×')
    await expect(carte).toContainText('Pad Thaï')
    await expect(carte).toContainText('Curry Vert')
    // 2 × 12,90 € + 13,50 € (prix relus du menu par le serveur).
    await expect(carte).toContainText(/39,30\s€/)

    await carte.getByRole('button', { name: 'Accepter' }).click()
    await expect(cuisine.getByRole('region', { name: 'Acceptées' })).toContainText('Table 1')
    await carte.getByRole('button', { name: 'En préparation' }).click()
    await expect(cuisine.getByRole('region', { name: 'En préparation' })).toContainText('Table 1')
    await carte.getByRole('button', { name: 'Servie' }).click()
    // Servies : section repliée en bas, plus aucun bouton d'action.
    await expect(cuisine.getByText('Servies (1)')).toBeVisible()
    await expect(cuisine.getByText('Tout est servi : rien en attente.')).toBeVisible()
    expect((await commandesDuJour(request, c.id)).map((x) => x.statut)).toEqual(['servie'])

    // Téléphone A : le suivi passe à « Servie » par sa relecture (10 s).
    await expect(client.getByText('Votre commande a été servie. Bon appétit !')).toBeVisible({ timeout: 20_000 })
    await cuisine.context().close()
  })

  test('erreurs : QR de table inconnu → écran clair ; double appui sur « Confirmer » → une seule commande en cuisine', async ({ page: client, browser, baseURL, request }) => {
    const c = await preparer(request)

    // Jeton de table inconnu (format valide, jamais tiré par le serveur).
    await client.goto(`/#/commande/${c.id}/${'x'.repeat(24)}`)
    await expect(client.getByText('Ce QR code n’est plus valide, demandez au personnel.')).toBeVisible()

    // Table 2 : double appui simulé (deux clics dans la même tâche, avant tout nouveau rendu).
    await client.goto(`/#/commande/${c.id}/${c.jetons[1]}`)
    await client.reload()
    await expect(client.getByRole('heading', { level: 1 })).toHaveText('Table 2')
    await client.getByRole('button', { name: 'Ajouter : Curry Vert' }).click()
    await client.getByRole('button', { name: /Voir le panier/ }).click()
    await client.getByRole('button', { name: 'Confirmer la commande' }).evaluate((b: HTMLButtonElement) => {
      b.click()
      b.click()
    })
    await expect(client.getByRole('heading', { name: 'Votre commande' })).toBeVisible()
    const liste = await commandesDuJour(request, c.id)
    expect(liste.length).toBe(1)
    expect(liste[0].table).toBe('Table 2')

    // Côté cuisine aussi : une seule carte.
    const cuisine = await telephone(browser, baseURL!)
    await ouvrirCuisine(cuisine, c.nom)
    await expect(cuisine.getByRole('article', { name: /^Table 2, commande de / })).toHaveCount(1)
    await expect(cuisine.getByRole('region', { name: 'Nouvelles' })).toContainText('Nouvelles (1)')
    await cuisine.context().close()
  })

  test('cuisine : transition déjà faite sur un autre appareil → note discrète et liste relue, sans erreur bloquante', async ({ page: cuisine, request }) => {
    const c = await preparer(request)
    // Commande passée par l'API publique (même chemin que la page), table 1.
    const r = await request.post(`/api/v1/commerces/${c.id}/commandes`, {
      data: { jetonTable: c.jetons[0], cleIdempotence: `e2e-${Date.now()}`, secret: 'e2e-secret-de-suivi-0123456789abcd', lignes: [{ produitId: await idProduit(request, c.id, 'Pad Thaï'), quantite: 1 }] },
    })
    expect(r.status(), await r.text()).toBe(201)
    const commande = (await r.json()).commande as { id: string }

    // Horloge figée : la relecture automatique (10 s) ne passe pas avant le clic, le conflit est déterministe.
    await cuisine.clock.install()
    await ouvrirCuisine(cuisine, c.nom)
    const carte = cuisine.getByRole('article', { name: /^Table 1, commande de / })
    await expect(carte.getByRole('button', { name: 'Accepter' })).toBeVisible()

    // Un autre membre de l'équipe accepte depuis son appareil…
    const a = await request.post(`/api/v1/commerces/${c.id}/commandes/${commande.id}/statut`, { headers: GERANT, data: { vers: 'acceptee' } })
    expect(a.status()).toBe(200)
    // … puis ce téléphone tente « Refuser » sur l'ancien état : refus du serveur, relecture, note discrète.
    await carte.getByRole('button', { name: 'Refuser' }).click()
    await expect(cuisine.getByRole('status').filter({ hasText: 'déjà mise à jour sur un autre appareil' })).toBeVisible()
    await expect(cuisine.getByRole('region', { name: 'Acceptées' })).toContainText('Table 1')
    await expect(cuisine.getByRole('alert')).toHaveCount(0)
    expect((await commandesDuJour(request, c.id)).map((x) => x.statut)).toEqual(['acceptee'])
  })
})

async function idProduit(request: APIRequestContext, commerceId: string, nom: string): Promise<string> {
  const r = await request.get(`/api/v1/commerces/${commerceId}/menu`)
  expect(r.status()).toBe(200)
  const menu = (await r.json()).menu as { categories: { produits: { id: string; nom: string }[] }[] }
  const p = menu.categories.flatMap((x) => x.produits).find((x) => x.nom === nom)
  expect(p).toBeTruthy()
  return p!.id
}

// Parcours de bout en bout dans Chromium : scan du QR vitrine (#/jouer) → inscription → visite validée en caisse
// avec le code équipe → tirage → gain (code gagnant, vérifié puis remis en caisse) → carte de fidélité (1 tampon).
// Serveur local + base SQLite temporaire (tests-e2e/serveur.ts), jamais la production.
import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN = { 'X-Admin-PIN': '000000' }
const PIN = '4321'
const CODE_EQUIPE = '2468'
const TELEPHONE = '06 12 34 56 78'
const LOT = 'Nems offerts'

test.beforeEach(({ baseURL }) => {
  // Garde-fou : ce test n'écrit que sur un serveur local.
  expect(new URL(baseURL!).hostname).toBe('127.0.0.1')
})

/** Commerce neuf (lot gagnant à 100 %, pour un résultat déterministe) + un membre d'équipe, via l'API. */
async function preparerCommerce(request: APIRequestContext) {
  const r = await request.post('/api/v1/commerces', {
    headers: ADMIN,
    data: {
      nom: `E2E Resto ${Date.now()}`,
      type: 'restaurant',
      pin: PIN,
      // Roue v2 R2 : un nouveau commerce est en accès libre par défaut — ce parcours décrit l'accès « visite ».
      modeAccesRoue: 'visite',
      lots: [
        { libelle: LOT, probabilite: 100 },
        { libelle: 'Perdu', probabilite: 0 },
      ],
    },
  })
  expect(r.status()).toBe(201)
  const { commerce } = await r.json()
  const m = await request.post(`/api/v1/commerces/${commerce.id}/equipe`, {
    headers: { 'X-Commerce-PIN': PIN },
    data: { nom: 'Camille', code: CODE_EQUIPE },
  })
  expect(m.status()).toBe(201)
  return commerce as { id: string; nom: string; seuilTampons: number }
}

test('scan → inscription → visite validée en caisse (code équipe) → tirage → gain → carte', async ({ page, browser, request, baseURL }) => {
  const commerce = await preparerCommerce(request)

  // P0-D1 : le 404 jouer → carte (GET /api/v1/commerces/<id-client> à chaque « Voir ma carte »)
  // ne doit plus se produire — aucune requête échouée sur tout le parcours.
  const requetesEchouees: string[] = []
  page.on('response', (r) => {
    if (r.status() >= 400) requetesEchouees.push(`${r.status()} ${r.url()}`)
  })

  // 1. Le client scanne le QR vitrine : page de jeu, contact seul.
  await page.goto(`/#/jouer/${commerce.id}`)
  await expect(page.getByRole('heading', { name: commerce.nom })).toBeVisible()
  await page.getByLabel('Téléphone ou e-mail').fill(TELEPHONE)
  await page.getByRole('button', { name: 'C’est parti' }).click()

  // 2. Roue verrouillée tant que la caisse n'a pas validé la visite.
  await expect(page.locator('[data-attente="en-cours"]')).toBeVisible()
  await expect(page.getByRole('button', { name: /Tourner la roue/ })).toHaveCount(0)

  // 3. Caisse (autre appareil) : code équipe, recherche du client, « Ajouter un passage ».
  const tablette = await browser.newContext({ baseURL, locale: 'fr-FR', timezoneId: 'Europe/Paris',serviceWorkers: 'block', reducedMotion: 'reduce' })
  const caisse = await tablette.newPage()
  await caisse.goto(`/#/caisse/${commerce.id}`)
  await caisse.getByLabel('Votre code équipe (4 chiffres)').fill(CODE_EQUIPE)
  await caisse.getByRole('button', { name: 'Ouvrir la caisse' }).click()
  await expect(caisse.getByText('Connecté : Camille')).toBeVisible()
  await caisse.getByLabel('Ou chercher : prénom, téléphone ou e-mail').fill('0612')
  await caisse.getByRole('button', { name: /06 ?12 ?34 ?56 ?78|\+33 ?6 ?12/ }).click()
  await caisse.getByRole('button', { name: '＋ Ajouter un passage' }).click()
  await expect(caisse.getByText(/✓ Passage enregistré .*\+1 tampon \(1\//)).toBeVisible()
  // Vraiment envoyé : rien ne reste dans la file hors ligne de la tablette (régression trouvée par ce test).
  await expect(caisse.getByText('✓ Synchronisé')).toBeVisible()
  expect(await caisse.evaluate((id) => JSON.parse(localStorage.getItem(`fidelite:caisse:file:v1:${id}`) ?? '{"attente":[]}').attente.length, commerce.id)).toBe(0)

  // 4. Côté client : la roue se débloque (vérification immédiate plutôt que d'attendre le cycle de 10 s).
  await page.getByRole('button', { name: 'C’est validé ? Vérifier maintenant' }).click()
  await expect(page.locator('[data-attente="validee"]')).toBeVisible()
  await page.getByRole('button', { name: /Tourner la roue/ }).click()

  // 5. Gain : lot tiré par le serveur + code à montrer au comptoir.
  const resultat = page.locator('[data-resultat="gain"]')
  await expect(resultat).toBeVisible()
  await expect(resultat).toContainText(LOT)
  const code = (await resultat.locator('[data-code-gagnant] p.font-mono').textContent())!.trim()
  expect(code).toMatch(/^[A-Z0-9]{6}$/)

  // 6. La caisse vérifie le code puis remet le lot.
  await caisse.getByLabel('Code gagnant (6 caractères)').fill(code.toLowerCase())
  await caisse.getByRole('button', { name: 'Vérifier', exact: true }).click()
  await expect(caisse.getByText(LOT, { exact: true })).toBeVisible()
  await caisse.getByRole('button', { name: '🎁 Marquer remis' }).click()
  await expect(caisse.getByText(`Le code ne pourra plus resservir.`, { exact: false })).toBeVisible()
  await tablette.close()

  // 7. Carte de fidélité du client : 1 tampon.
  await page.getByRole('link', { name: 'Voir ma carte de fidélité' }).last().click()
  await expect(page).toHaveURL(/#\/carte\//)
  await expect(page.locator('[data-tampons]')).toHaveAttribute('aria-label', `Tampons : 1 sur ${commerce.seuilTampons}`)
  expect(requetesEchouees).toEqual([])
})

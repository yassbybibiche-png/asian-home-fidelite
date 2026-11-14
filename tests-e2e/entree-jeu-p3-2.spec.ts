// P3-2 dans Chromium : les tests de forme de l'écran de jeu (lignes JSX exactes et plafond de 120 caractères
// entre `<>` et `<DemandePrenom`) sont remplacés par du rendu réel.
// a) roue + légende : la roue annonce le nombre de lots, la légende liste les libellés, juste sous la roue ;
// b) « Continuer en tant que… » : zéro saisie, reprise sans contact, « Ce n'est pas moi » oublie le profil ;
// c) prénom redemandé sur l'écran « déjà joué » : visible après rechargement, enregistrable.
// Serveur local + base SQLite temporaire (tests-e2e/serveur.ts), jamais la production.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const ADMIN = { 'X-Admin-PIN': '000000' }
const PIN = '4321'

test.beforeEach(({ baseURL }) => {
  // Garde-fou : ce test n'écrit que sur un serveur local.
  expect(new URL(baseURL!).hostname).toBe('127.0.0.1')
})

/** Commerce neuf, accès libre, via l'API. */
async function preparerCommerce(request: APIRequestContext, prefixe: string, lots: { libelle: string; probabilite: number }[]) {
  const r = await request.post('/api/v1/commerces', {
    headers: ADMIN,
    data: { nom: `E2E P3-2 ${prefixe} ${Date.now()}`, type: 'restaurant', pin: PIN, modeAccesRoue: 'libre', lots },
  })
  expect(r.status()).toBe(201)
  return (await r.json()).commerce as { id: string; nom: string }
}

/** Inscription depuis la page de jeu (contact + prénom facultatif) ; la roue est ensuite prête. */
async function inscrire(page: Page, contact: string, prenom: string) {
  await page.getByLabel('Téléphone ou e-mail').fill(contact)
  if (prenom) await page.getByLabel('Votre prénom (optionnel)').fill(prenom)
  await page.getByRole('button', { name: 'C’est parti' }).click()
  await expect(page.getByRole('button', { name: prenom ? `🎡 Tourner la roue, ${prenom} !` : '🎡 Tourner la roue !' })).toBeVisible()
}

test('a) roue et légende : nombre de lots annoncé, libellés listés juste sous la roue', async ({ page, request }) => {
  const commerce = await preparerCommerce(request, 'Roue', [
    { libelle: 'Nems offerts', probabilite: 50 },
    { libelle: 'Mochi offert', probabilite: 50 },
  ])
  await page.goto(`/#/jouer/${commerce.id}`)
  await expect(page.getByRole('heading', { name: commerce.nom })).toBeVisible()
  // La roue est une image nommée (nombre de lots) ; la légende est une liste nommée.
  await expect(page.getByRole('img', { name: 'Roue de la chance : 2 lots à gagner, détaillés ci-dessous' })).toBeVisible()
  const legende = page.getByRole('list', { name: 'Lots de la roue' })
  await expect(legende).toBeVisible()
  await expect(legende.locator('li')).toHaveCount(2)
  await expect(legende).toContainText('Nems offerts')
  await expect(legende).toContainText('Mochi offert')
  // « Juste sous la roue » : la légende suit la roue dans le document rendu.
  const ordre = await page.evaluate(() => {
    const roue = document.querySelector('[aria-label^="Roue de la chance"]')
    const legende = document.querySelector('[aria-label="Lots de la roue"]')
    if (!roue || !legende) return 'absent'
    return roue.compareDocumentPosition(legende) & Node.DOCUMENT_POSITION_FOLLOWING ? 'roue-avant-legende' : 'autre'
  })
  expect(ordre).toBe('roue-avant-legende')
})

test('b) « Continuer en tant que… » : zéro saisie, reprise sans contact, oubli du profil', async ({ page, request }) => {
  const commerce = await preparerCommerce(request, 'Continuer', [
    { libelle: 'Nems offerts', probabilite: 100 },
    { libelle: 'Perdu', probabilite: 0 },
  ])
  await page.goto(`/#/jouer/${commerce.id}`)
  await inscrire(page, '06 11 22 33 44', 'Linh')

  // Rechargement : le profil mémorisé propose de continuer, sans aucun champ à remplir.
  await page.reload()
  const continuer = page.getByRole('button', { name: 'Continuer en tant que Linh' })
  await expect(continuer).toBeVisible()
  await expect(page.locator('input')).toHaveCount(0)
  await expect(page.getByLabel('Téléphone ou e-mail')).toHaveCount(0)

  // Reprise : la roue est prête, sans ressaisir le contact.
  await continuer.click()
  await expect(page.getByRole('button', { name: '🎡 Tourner la roue, Linh !' })).toBeVisible()
  await expect(page.getByLabel('Téléphone ou e-mail')).toHaveCount(0)

  // « Ce n'est pas moi » oublie le profil : le formulaire d'identification revient.
  await page.reload()
  await page.getByRole('button', { name: 'Ce n’est pas moi' }).click()
  await expect(page.getByLabel('Téléphone ou e-mail')).toBeVisible()
})

test('c) déjà joué : la demande de prénom apparaît, s’enregistre, et la carte porte le prénom', async ({ page, request }) => {
  const commerce = await preparerCommerce(request, 'DejaJoue', [
    { libelle: 'Nems offerts', probabilite: 100 },
    { libelle: 'Perdu', probabilite: 0 },
  ])
  await page.goto(`/#/jouer/${commerce.id}`)
  await inscrire(page, '06 55 66 77 88', '')
  await page.getByRole('button', { name: '🎡 Tourner la roue !' }).click()
  const resultat = page.locator('[data-resultat="gain"]')
  await expect(resultat).toBeVisible()
  await expect(resultat).toContainText('Nems offerts')
  // Branche « résultat » : la demande de prénom est là (point de départ, aussi couverte par deblocage).
  await expect(page.getByRole('form', { name: 'Votre prénom (optionnel)' })).toBeVisible()

  // Rechargement : écran « déjà joué », la demande de prénom est toujours là.
  await page.reload()
  await page.getByRole('button', { name: 'Continuer avec ma carte' }).click()
  await expect(page.getByText('Vous avez déjà joué aujourd’hui !')).toBeVisible()
  await expect(page.getByText('Résultat du jour :')).toBeVisible()
  const formulaire = page.getByRole('form', { name: 'Votre prénom (optionnel)' })
  await expect(formulaire).toBeVisible()

  // Enregistrement : le prénom est accepté et la carte le porte côté serveur.
  await formulaire.getByLabel('Votre prénom, pour que l’équipe vous reconnaisse ? (optionnel)').fill('Linh')
  await formulaire.getByRole('button', { name: 'OK' }).click()
  await expect(page.getByText('Merci Linh, votre carte est à votre nom.')).toBeVisible()
  const etat = await (await request.get(`/api/v1/commerces/${commerce.id}/etat`, { headers: { 'X-Commerce-PIN': PIN } })).json()
  const linh = (etat.clients as { prenom: string }[]).filter((c) => c.prenom === 'Linh')
  expect(linh).toHaveLength(1)
})

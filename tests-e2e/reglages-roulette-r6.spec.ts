// Roue v2 R6 dans Chromium : Réglages → Roulette. Un lot « points » sans montant est refusé avant l'envoi ; type, points,
// plafond par jour, mode d'accès et limite de gains partent dans le PATCH des réglages et sont relus ; l'aperçu tire au
// sort dans le navigateur — espion réseau : aucune requête vers les tirages, aucun tirage en base.
// Serveur local + base SQLite temporaire (tests-e2e/serveur.ts), jamais la production.
import { expect, test } from '@playwright/test'

const ADMIN = { 'X-Admin-PIN': '000000' }
const PIN = '4321'

test.beforeEach(({ baseURL }) => {
  expect(new URL(baseURL!).hostname).toBe('127.0.0.1')
})

test('Réglages → Roulette : points sans montant refusé, champs nouveaux envoyés et relus, tirage de test jamais enregistré', async ({ page, request }) => {
  const nom = `E2E Réglages ${Date.now()}`
  const r = await request.post('/api/v1/commerces', {
    headers: ADMIN,
    data: { nom, type: 'restaurant', pin: PIN, lots: [{ libelle: 'Nems offerts', type: 'lot', probabilite: 70 }, { libelle: 'Perdu', type: 'perdant', probabilite: 30 }] },
  })
  expect(r.status()).toBe(201)
  const { commerce } = await r.json()
  const etat = async () => (await (await request.get(`/api/v1/commerces/${commerce.id}/etat`, { headers: { 'X-Commerce-PIN': PIN } })).json()) as {
    commerce: { lots: { libelle: string; type: string; points?: number; plafondJour?: number }[]; modeAccesRoue?: string; limiteGainsMois?: number }
    tirages: unknown[]
  }

  // Espion réseau : toutes les requêtes de la page.
  const requetes: string[] = []
  page.on('request', (q) => requetes.push(`${q.method()} ${q.url()}`))

  await page.goto('/#/reglages')
  await page.getByLabel('Commerce', { exact: true }).selectOption({ label: nom })
  await page.getByLabel('PIN du commerce (4 à 6 chiffres)').fill(PIN)
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await page.getByRole('tab', { name: 'Roulette' }).click()
  const enregistrer = page.getByRole('button', { name: 'Enregistrer' })

  // 1. Lot « points » sans montant : message clair, « Enregistrer » désactivé (refus front).
  await page.getByRole('button', { name: '+ Ajouter un lot' }).click()
  await page.getByLabel('Lot 3', { exact: true }).fill('Points bonus')
  await page.getByLabel('Type du lot 3').selectOption('points')
  await expect(page.getByText(/indiquez le nombre de points offerts/).first()).toBeVisible()
  await expect(enregistrer).toBeDisabled()
  await page.getByLabel('Points offerts par le lot 3').fill('15')
  await expect(enregistrer).toBeEnabled()

  // 2. Libellé en double : message avant envoi.
  await page.getByLabel('Lot 3', { exact: true }).fill(' nems OFFERTS ')
  await expect(page.getByText(/libellé en double/).first()).toBeVisible()
  await expect(enregistrer).toBeDisabled()
  await page.getByLabel('Lot 3', { exact: true }).fill('15 points offerts')

  // 3. Plafond, règles du jeu, puis enregistrement : le PATCH porte les champs nouveaux.
  await page.getByLabel('Plafond par jour du lot 1').fill('3')
  // Au clavier (Espace) : le défilement automatique de Playwright pose le petit radio sous l'en-tête ou la barre de
  // navigation fixes du téléphone, et le clic est intercepté.
  const visite = page.getByLabel(/Après visite validée au comptoir/)
  await visite.focus()
  await page.keyboard.press('Space')
  await expect(visite).toBeChecked()
  await expect(page.getByLabel('Limite de gains par client (lots par mois)')).toHaveValue('4')
  await page.getByLabel('Limite de gains par client (lots par mois)').fill('2')
  const envoi = page.waitForRequest((q) => q.method() === 'PATCH' && q.url().endsWith(`/commerces/${commerce.id}`))
  await enregistrer.click()
  const corps = (await envoi).postDataJSON()
  expect(corps.modeAccesRoue).toBe('visite')
  expect(corps.limiteGainsMois).toBe(2)
  expect(corps.lots.map((l: { libelle: string; type: string; points?: number; plafondJour?: number }) => [l.libelle, l.type, l.points, l.plafondJour])).toEqual([
    ['Nems offerts', 'lot', undefined, 3],
    ['Perdu', 'perdant', undefined, undefined],
    ['15 points offerts', 'points', 15, undefined],
  ])
  await expect(page.getByRole('button', { name: '✓ Enregistré' })).toBeVisible()

  // Relus par le serveur, puis par l'écran après rechargement.
  const relu = (await etat()).commerce
  expect(relu.modeAccesRoue).toBe('visite')
  expect(relu.limiteGainsMois).toBe(2)
  expect(relu.lots.map((l) => [l.libelle, l.type, l.points, l.plafondJour])).toEqual(corps.lots.map((l: { libelle: string; type: string; points?: number; plafondJour?: number }) => [l.libelle, l.type, l.points, l.plafondJour]))
  await page.reload()
  await page.getByRole('tab', { name: 'Roulette' }).click()
  await expect(page.getByLabel('Type du lot 3')).toHaveValue('points')
  await expect(page.getByLabel('Points offerts par le lot 3')).toHaveValue('15')
  await expect(page.getByLabel('Plafond par jour du lot 1')).toHaveValue('3')
  await expect(page.getByLabel(/Après visite validée au comptoir/)).toBeChecked()
  await expect(page.getByLabel('Limite de gains par client (lots par mois)')).toHaveValue('2')

  // 4. Aperçu : tirage de test (mouvement réduit dans ce projet Playwright → résultat presque immédiat).
  requetes.length = 0
  const apercu = page.locator('[data-apercu-roue]')
  await expect(apercu.locator('[data-roue]')).toBeVisible()
  for (let i = 0; i < 3; i++) {
    await apercu.getByRole('button', { name: /Lancer un tirage de test/ }).click()
    await expect(apercu.locator('[data-bandeau-test]')).toHaveText('Tirage de test — rien n’est enregistré')
    await expect(apercu.locator('[data-resultat-test]')).toHaveText(/^(Gagné|Consolation|Perdu) : « (Nems offerts|15 points offerts|Perdu) »/)
  }
  expect(requetes.filter((q) => /tirage/i.test(q) || q.startsWith('POST') || q.startsWith('PATCH') || q.startsWith('PUT'))).toEqual([])
  expect((await etat()).tirages).toEqual([])
})

// Revue Codex R6 : une ligne au libellé vide est exclue de l'envoi ; ses champs chiffrés (plafond `min={0}`, points,
// chance, coût) sont désactivés, sinon leur validation native HTML bloquait la soumission alors que la validation de
// l'application l'autorisait. Une ligne gardée à l'envoi avec un plafond de -1 reste refusée par l'application.
test('Réglages → Roulette : une ligne de lot exclue de l’envoi (libellé vide) ne bloque plus l’enregistrement', async ({ page, request }) => {
  const nom = `E2E Lot exclu ${Date.now()}`
  const r = await request.post('/api/v1/commerces', {
    headers: ADMIN,
    data: { nom, type: 'restaurant', pin: PIN, lots: [{ libelle: 'Nems offerts', type: 'lot', probabilite: 70 }, { libelle: 'Perdu', type: 'perdant', probabilite: 30 }] },
  })
  expect(r.status()).toBe(201)
  const { commerce } = await r.json()
  const patchReglages = () => page.waitForRequest((q) => q.method() === 'PATCH' && q.url().endsWith(`/commerces/${commerce.id}`), { timeout: 5000 })

  await page.goto('/#/reglages')
  await page.getByLabel('Commerce', { exact: true }).selectOption({ label: nom })
  await page.getByLabel('PIN du commerce (4 à 6 chiffres)').fill(PIN)
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await page.getByRole('tab', { name: 'Roulette' }).click()
  const enregistrer = page.getByRole('button', { name: 'Enregistrer' })

  // Ligne gardée à l'envoi avec un plafond de -1 : refus de l'application (message + « Enregistrer » désactivé).
  await page.getByRole('button', { name: '+ Ajouter un lot' }).click()
  await page.getByLabel('Lot 3', { exact: true }).fill('Café offert')
  await page.getByLabel('Plafond par jour du lot 3').fill('-1')
  await expect(page.getByText(/Lot 3 : .*plafond par jour/)).toBeVisible()
  await expect(enregistrer).toBeDisabled()

  // Libellé vidé : ligne exclue, champs désactivés, l'enregistrement part avec les 2 autres lots.
  await page.getByLabel('Lot 3', { exact: true }).fill('')
  await expect(page.getByLabel('Plafond par jour du lot 3')).toBeDisabled()
  await expect(page.getByLabel('Chance du lot 3 en %')).toBeDisabled()
  await expect(page.getByLabel('Coût du lot 3 en euros')).toBeDisabled()
  await expect(enregistrer).toBeEnabled()
  const envoi = patchReglages()
  await enregistrer.click()
  expect((await envoi).postDataJSON().lots.map((l: { libelle: string }) => l.libelle)).toEqual(['Nems offerts', 'Perdu'])
  await expect(page.getByRole('button', { name: '✓ Enregistré' })).toBeVisible()

  // Même chose pour un lot « points » au montant invalide (champ `min={1}`).
  await page.getByRole('button', { name: '+ Ajouter un lot' }).click()
  await page.getByLabel('Lot 3', { exact: true }).fill('Bonus')
  await page.getByLabel('Type du lot 3').selectOption('points')
  await page.getByLabel('Points offerts par le lot 3').fill('0')
  await expect(enregistrer).toBeDisabled()
  await page.getByLabel('Lot 3', { exact: true }).fill('   ')
  await expect(page.getByLabel('Points offerts par le lot 3')).toBeDisabled()
  const envoi2 = patchReglages()
  await enregistrer.click()
  expect((await envoi2).postDataJSON().lots.map((l: { libelle: string }) => l.libelle)).toEqual(['Nems offerts', 'Perdu'])
})

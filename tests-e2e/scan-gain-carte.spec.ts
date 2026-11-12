// Parcours de bout en bout dans Chromium (roue v2, R4) : scan du QR vitrine (#/jouer) → lots du jour + lien règlement
// → inscription → accès LIBRE, tirage immédiat → gain (utilisable dès demain) → carte de fidélité : gain en attente →
// LENDEMAIN (date du tirage reculée d'un jour dans la base TEMPORAIRE du serveur de test) → « Utiliser mon gain » → code
// + compte à rebours → la caisse vérifie le code (code équipe) puis remet le lot → le gain quitte la carte.
// Serveur local + base SQLite temporaire (tests-e2e/serveur.ts), jamais la production.
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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

/** Commerce neuf, accès libre explicite (lot gagnant à 100 %, pour un résultat déterministe) + un membre d'équipe, via l'API. */
async function preparerCommerce(request: APIRequestContext) {
  const r = await request.post('/api/v1/commerces', {
    headers: ADMIN,
    data: {
      nom: `E2E Resto ${Date.now()}`,
      type: 'restaurant',
      pin: PIN,
      // Roue v2 : accès libre (défaut des nouveaux commerces depuis R2), donné explicitement — 1 tirage par jour, sans visite.
      modeAccesRoue: 'libre',
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

/**
 * « Le lendemain » : recule d'un jour la date des tirages de ce commerce, DANS LA BASE TEMPORAIRE du serveur E2E (chemin
 * publié par tests-e2e/serveur.ts). Garde-fous : le fichier est sous le dossier temporaire du système, et c'est le
 * fichier d'une base de test « fidelite-e2e-* ».
 */
function avancerAuLendemain(commerceId: string, port: number) {
  const { fichierDb } = JSON.parse(readFileSync(join(tmpdir(), `fidelite-e2e-base-${port}.json`), 'utf8')) as { fichierDb: string }
  expect(fichierDb.startsWith(tmpdir())).toBe(true)
  expect(fichierDb).toMatch(/fidelite-e2e-[^/]+\/e2e\.db$/)
  const db = new DatabaseSync(fichierDb)
  try {
    const lignes = db.prepare('SELECT id, date FROM tirages WHERE commerce_id = ?').all(commerceId) as { id: string; date: string }[]
    expect(lignes.length).toBe(1)
    for (const l of lignes) {
      const veille = new Date(new Date(l.date).getTime() - 24 * 3600 * 1000).toISOString()
      db.prepare("UPDATE tirages SET date = ?, donnees = json_set(donnees, '$.date', ?) WHERE id = ?").run(veille, veille, l.id)
    }
  } finally {
    db.close()
  }
}

test('scan → lots du jour + règlement → tirage libre → gain en attente → lendemain : activation, code, remise en caisse', async ({ page, browser, request, baseURL }) => {
  const commerce = await preparerCommerce(request)

  // P0-D1 : aucune requête échouée sur le parcours client (le refus d'activation n'est jamais provoqué ici).
  const requetesEchouees: string[] = []
  page.on('response', (r) => {
    if (r.status() >= 400) requetesEchouees.push(`${r.status()} ${r.url()}`)
  })

  // 1. Le client scanne le QR vitrine : lots du jour, règles en une ligne, lien vers le règlement.
  await page.goto(`/#/jouer/${commerce.id}`)
  await expect(page.getByRole('heading', { name: commerce.nom })).toBeVisible()
  const infos = page.locator('[data-lots-du-jour]')
  await expect(infos.getByRole('heading', { name: 'À gagner aujourd’hui' })).toBeVisible()
  await expect(infos.getByRole('listitem')).toHaveText([new RegExp(LOT)])
  await expect(infos).toContainText('1 tirage par jour · gain utilisable dès demain, pendant 30 jours')
  await infos.getByRole('link', { name: /Règlement du jeu/ }).click()
  await expect(page).toHaveURL(new RegExp(`#/reglement/${commerce.id}$`))
  await expect(page.locator('[data-reglement]')).toContainText(`Règlement du jeu « La roue ${commerce.nom} »`)
  await expect(page.locator('[data-reglement]')).toContainText('sans obligation d’achat')
  await page.getByRole('link', { name: '🎡 Retour au jeu' }).click()

  // 2. Inscription par le contact seul ; accès libre : la roue est prête tout de suite, sans écran d'attente.
  await page.getByLabel('Téléphone ou e-mail').fill(TELEPHONE)
  await page.getByRole('button', { name: 'C’est parti' }).click()
  await expect(page.locator('[data-attente]')).toHaveCount(0)
  await page.getByRole('button', { name: /Tourner la roue/ }).click()

  // 3. Gain tiré par le serveur : pas de code ce jour-là, utilisable dès demain.
  const resultat = page.locator('[data-resultat="gain"]')
  await expect(resultat).toBeVisible()
  await expect(resultat).toContainText(LOT)
  await expect(resultat.locator('[data-validite]')).toContainText('À utiliser dès demain et jusqu’au')
  await expect(resultat.locator('[data-code-gagnant]')).toHaveCount(0)
  await expect(page.locator('[data-lots-du-jour]')).toHaveCount(0)

  // 4. Carte de fidélité : gain en attente (fenêtre de dates), sans bouton d'activation.
  await page.getByRole('link', { name: 'Voir ma carte de fidélité' }).last().click()
  await expect(page).toHaveURL(/#\/carte\//)
  const bloc = page.locator('[data-gains-roue] section')
  await expect(bloc).toHaveAttribute('data-gain', 'enAttente')
  await expect(bloc).toContainText(`🎁 Votre gain : ${LOT}`)
  await expect(bloc).toContainText(/Utilisable du \d\d\/\d\d au \d\d\/\d\d\./)
  await expect(page.getByRole('button', { name: 'Utiliser mon gain' })).toHaveCount(0)

  // 5. Le lendemain (base de test seulement) : « Utiliser mon gain » → code + compte à rebours de 10 minutes.
  avancerAuLendemain(commerce.id, Number(new URL(baseURL!).port))
  await page.reload()
  await expect(bloc).toHaveAttribute('data-gain', 'aActiver')
  await page.getByRole('button', { name: 'Utiliser mon gain' }).click()
  await expect(bloc).toHaveAttribute('data-gain', 'code')
  const code = (await bloc.locator('[data-code-active] p.font-mono').textContent())!.trim()
  expect(code).toMatch(/^[A-Z0-9]{6}$/)
  await expect(bloc.locator('[data-compte-a-rebours]')).toContainText(/Il expire dans (10:00|09:[0-5]\d)/)

  // 6. La caisse (autre appareil, code équipe) vérifie le code puis remet le lot.
  const tablette = await browser.newContext({ baseURL, locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block', reducedMotion: 'reduce' })
  const caisse = await tablette.newPage()
  await caisse.goto(`/#/caisse/${commerce.id}`)
  await caisse.getByLabel('Votre code équipe (4 chiffres)').fill(CODE_EQUIPE)
  await caisse.getByRole('button', { name: 'Ouvrir la caisse' }).click()
  await expect(caisse.getByText('Connecté : Camille')).toBeVisible()
  await caisse.getByLabel('Code gagnant (6 caractères)').fill(code.toLowerCase())
  await caisse.getByRole('button', { name: 'Vérifier', exact: true }).click()
  await expect(caisse.getByText(LOT, { exact: true })).toBeVisible()
  await caisse.getByRole('button', { name: '🎁 Marquer remis' }).click()
  await expect(caisse.getByText(`Le code ne pourra plus resservir.`, { exact: false })).toBeVisible()
  await tablette.close()

  // 7. Le gain remis quitte la carte ; l'historique le garde.
  await page.reload()
  await expect(page.locator('[data-gains-roue]')).toHaveCount(0)
  await page.getByText('Historique des visites et des lots').click()
  await expect(page.getByText(`Roue : ${LOT} (retiré)`)).toBeVisible()
  expect(requetesEchouees).toEqual([])
})

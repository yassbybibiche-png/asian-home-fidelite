// P2-1 — erreurs serveur localisées, vues par le client en anglais : le serveur renvoie un code stable, la page
// affiche la traduction anglaise (dictionnaire ERREURS_EN) au lieu du message français du serveur.
// Trois parcours : inscription en double (409), commande désactivée (409), gain déjà remis en caisse (409).
// Serveur local + base SQLite temporaire (tests-e2e/serveur.ts), jamais la production.
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const ADMIN = { 'X-Admin-PIN': '000000' }
const PIN = '4321'
const CODE_EQUIPE = '2468'
const TELEPHONE = '06 12 34 56 78'
const LOT = 'Nems offerts'

test.beforeEach(({ baseURL }) => {
  // Garde-fou : ce test n'écrit que sur un serveur local.
  expect(new URL(baseURL!).hostname).toBe('127.0.0.1')
})

/** La page passe en anglais avant son premier chargement (la langue est lue au démarrage). */
async function enAnglais(page: Page) {
  await page.addInitScript(() => localStorage.setItem('fideliz:langue', 'en'))
}

/** Commerce neuf, accès libre explicite (lot gagnant à 100 %, pour un résultat déterministe) + un membre d'équipe, via l'API. */
async function preparerCommerce(request: APIRequestContext) {
  const r = await request.post('/api/v1/commerces', {
    headers: ADMIN,
    data: {
      nom: `E2E Erreurs ${Date.now()}`,
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
  const { commerce } = await r.json()
  const m = await request.post(`/api/v1/commerces/${commerce.id}/equipe`, {
    headers: { 'X-Commerce-PIN': PIN },
    data: { nom: 'Camille', code: CODE_EQUIPE },
  })
  expect(m.status()).toBe(201)
  return commerce as { id: string; nom: string }
}

/** Commerce avec module commande activé, 2 tables, un menu d'un plat à prix. */
async function preparerCommande(request: APIRequestContext) {
  const r = await request.post('/api/v1/commerces', { headers: ADMIN, data: { nom: `E2E Erreurs Cmd ${Date.now()}`, type: 'restaurant', pin: PIN } })
  expect(r.status()).toBe(201)
  const commerce = (await r.json()).commerce as { id: string }
  const m = await request.put(`/api/v1/commerces/${commerce.id}/menu`, {
    headers: { 'X-Commerce-PIN': PIN },
    data: { categories: [{ nom: 'Plats', produits: [{ nom: 'Pad Thaï', prix: 1290, allergenes: [] }] }] },
  })
  expect(m.status(), await m.text()).toBe(200)
  const p = await request.patch(`/api/v1/commerces/${commerce.id}`, {
    headers: { 'X-Commerce-PIN': PIN },
    data: { commande: { active: true, tables: [{ nom: 'Table 1' }, { nom: 'Table 2' }] } },
  })
  expect(p.status(), await p.text()).toBe(200)
  const tables = (await p.json()).commerce.commande.tables as { nom: string; jeton: string }[]
  return { id: commerce.id, jetons: tables.map((t) => t.jeton) }
}

/** Chemin de la base SQLite temporaire du serveur E2E (publié par tests-e2e/serveur.ts). */
function fichierBase(port: number): string {
  const { fichierDb } = JSON.parse(readFileSync(join(tmpdir(), `fidelite-e2e-base-${port}.json`), 'utf8')) as { fichierDb: string }
  expect(fichierDb.startsWith(tmpdir())).toBe(true)
  expect(fichierDb).toMatch(/fidelite-e2e-[^/]+\/e2e\.db$/)
  return fichierDb
}

/**
 * « Le lendemain » : recule d'un jour la date des tirages de ce commerce, DANS LA BASE TEMPORAIRE du serveur E2E
 * (même mécanisme que tests-e2e/scan-gain-carte.spec.ts).
 */
function avancerAuLendemain(commerceId: string, port: number) {
  const db = new DatabaseSync(fichierBase(port))
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

test('inscription en double : la 2e inscription affiche le refus en anglais, pas le message français du serveur', async ({ page, browser, request, baseURL }) => {
  const commerce = await preparerCommerce(request)

  // 1er téléphone : inscription réussie (français).
  await page.goto(`/#/jouer/${commerce.id}`)
  await page.getByLabel('Téléphone ou e-mail').fill(TELEPHONE)
  await page.getByRole('button', { name: 'C’est parti' }).click()
  await expect(page.getByRole('button', { name: /Tourner la roue/ })).toBeVisible()

  // 2e téléphone, en anglais : même contact → 409 CONTACT_DEJA_INSCRIT, traduit.
  const autre = await browser.newContext({ baseURL, locale: 'en-GB', timezoneId: 'Europe/Paris', serviceWorkers: 'block', reducedMotion: 'reduce' })
  const pageEn = await autre.newPage()
  await enAnglais(pageEn)
  await pageEn.goto(`/#/jouer/${commerce.id}`)
  await pageEn.getByLabel('Phone or e-mail').fill(TELEPHONE)
  await pageEn.getByRole('button', { name: 'Let’s go' }).click()
  await expect(pageEn.getByRole('alert')).toContainText(
    'This phone number or e-mail already has a card here. Open it on the phone you signed up with, ask for an access link at the counter, or use “Find my card”.',
  )
  await autre.close()
})

test('commande désactivée entre le panier et la confirmation : l’erreur s’affiche en anglais', async ({ page, request, baseURL }) => {
  const c = await preparerCommande(request)
  await enAnglais(page)

  await page.goto(`/#/commande/${c.id}/${c.jetons[0]}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Table 1')
  await page.getByRole('button', { name: 'Add: Pad Thaï' }).click()
  await page.getByRole('button', { name: 'View basket' }).click()
  await expect(page.getByRole('heading', { name: 'Your basket' })).toBeVisible()

  // Le commerçant désactive le module commande avant la confirmation.
  const p = await request.patch(`/api/v1/commerces/${c.id}`, {
    headers: { 'X-Commerce-PIN': PIN },
    data: { commande: { active: false, tables: [{ nom: 'Table 1', jeton: c.jetons[0] }, { nom: 'Table 2', jeton: c.jetons[1] }] } },
  })
  expect(p.status(), await p.text()).toBe(200)

  await page.getByRole('button', { name: 'Confirm the order' }).click()
  await expect(page.getByRole('alert')).toContainText('Online ordering is not enabled for this business.')
  await expect(page.getByRole('heading', { name: 'Your basket' })).toBeVisible()
  void baseURL
})

test('gain déjà remis en caisse : « Use my prize » affiche le refus en anglais', async ({ page, request, baseURL }) => {
  const commerce = await preparerCommerce(request)

  // Inscription + tirage gagnant (français).
  await page.goto(`/#/jouer/${commerce.id}`)
  await page.getByLabel('Téléphone ou e-mail').fill(TELEPHONE)
  await page.getByRole('button', { name: 'C’est parti' }).click()
  await page.getByRole('button', { name: /Tourner la roue/ }).click()
  const resultat = page.locator('[data-resultat="gain"]')
  await expect(resultat).toBeVisible()
  await expect(resultat).toContainText(LOT)

  // Le lendemain : la carte montre le gain à activer. Deux onglets de la même carte (même jeton : le lien partagé) —
  // le premier active, le second garde l'ancien état affiché. La langue se change avec le vrai commutateur de la
  // page (un rechargement remettrait la roue : le tirage est daté d'hier après le recul).
  avancerAuLendemain(commerce.id, Number(new URL(baseURL!).port))
  await page.getByRole('button', { name: 'English' }).click()
  await page.getByRole('link', { name: 'See my loyalty card' }).last().click()
  await expect(page).toHaveURL(/#\/carte\//)
  const bloc = page.locator('[data-gains-roue] section')
  await expect(bloc).toHaveAttribute('data-gain', 'aActiver')

  const deuxieme = await page.context().newPage()
  await deuxieme.goto(page.url())
  const bloc2 = deuxieme.locator('[data-gains-roue] section')
  await expect(bloc2).toHaveAttribute('data-gain', 'aActiver')

  // Onglet 1 : activation → code affiché 10 minutes.
  await page.getByRole('button', { name: 'Use my prize' }).click()
  await expect(bloc).toHaveAttribute('data-gain', 'code')
  const code = (await bloc.locator('[data-code-active] p.font-mono').textContent())!.trim()
  expect(code).toMatch(/^[A-Z0-9]{6}$/)

  // La caisse remet le lot avec ce code.
  const remise = await request.post(`/api/v1/commerces/${commerce.id}/caisse/gains/${code}/remise`, { headers: { 'X-Equipe-Code': CODE_EQUIPE } })
  expect(remise.status(), await remise.text()).toBe(200)

  // Onglet 2 (état périmé, bouton toujours là) : l'activation est refusée, en anglais.
  await deuxieme.getByRole('button', { name: 'Use my prize' }).click()
  await expect(deuxieme.getByRole('alert')).toContainText('This prize has already been collected at the counter.')
  await deuxieme.close()
})

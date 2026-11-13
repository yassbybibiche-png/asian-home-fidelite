// Recommandation R4 — écran vitrine / mode TV (#/vitrine/<commerceId>) : route publique, endpoint public
// GET /commerces/:id/derniers-gains (prénoms et lots seulement), page différée en rotation, lien depuis les Réglages.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { creerClientApi } from '../src/data/api.ts'
import { lireRoute, PAGES_PUBLIQUES } from '../src/router.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')

describe('R4 vitrine : routeur', () => {
  test('#/vitrine/<id> : page publique « vitrine », paramètre = id du commerce', () => {
    assert.deepEqual(lireRoute('#/vitrine/c-x'), { page: 'vitrine', param: 'c-x' })
    assert.ok(PAGES_PUBLIQUES.includes('vitrine'))
  })
})

describe('R4 vitrine : GET /commerces/:id/derniers-gains', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-r4-vitrine-'))
  const fichierDb = join(dossier, 'vitrine.db')
  const MAINTENANT = new Date('2026-11-13T15:00:00.000Z')
  const ADMIN = '98765432'
  let app: Awaited<ReturnType<typeof creerServeur>>
  let racine = ''
  let commerceId = ''

  const ilYa = (jours: number, minutes = 0) => new Date(MAINTENANT.getTime() - jours * 86_400_000 - minutes * 60_000).toISOString()

  async function http(methode: string, chemin: string, corpsJson?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(`${racine}/api/v1${chemin}`, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...entetes },
      ...(corpsJson !== undefined ? { body: JSON.stringify(corpsJson) } : {}),
    })
    const texte = await r.text()
    return { statut: r.status, contenu: texte ? JSON.parse(texte) : null, texte }
  }

  before(async () => {
    app = await creerServeur({ fichierDb, adminPin: ADMIN, pinInitial: '1234', version: 'test', maintenant: () => MAINTENANT })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
    const cree = await http('POST', '/commerces', { nom: 'Chez Vitrine', type: 'restaurant', pin: '4321' }, { 'X-Admin-PIN': ADMIN })
    assert.equal(cree.statut, 201, cree.texte)
    commerceId = cree.contenu.commerce.id

    // Données posées directement en base (même fichier SQLite) : clients avec et sans prénom, tirages variés.
    const db = new DatabaseSync(fichierDb)
    const client = (id: string, prenom: string, telephone: string) =>
      db.prepare('INSERT INTO clients (id, commerce_id, cle_contact, donnees) VALUES (?, ?, ?, ?)').run(id, commerceId, telephone, JSON.stringify({ id, commerceId, prenom, telephone, email: `${id}@exemple.fr`, tampons: 0, points: 0, creeLe: ilYa(60) }))
    const tirage = (id: string, clientId: string, date: string, lot: string, typeLot: string, extra: Record<string, unknown> = {}) =>
      db.prepare('INSERT INTO tirages (id, commerce_id, client_id, date, donnees) VALUES (?, ?, ?, ?, ?)').run(id, commerceId, clientId, date, JSON.stringify({ id, commerceId, clientId, lot, typeLot, date, ...extra }))
    client('cl-lea', 'Léa', '0611111111')
    client('cl-tom', 'Tom', '0622222222')
    client('cl-sans', '  ', '0633333333')
    // Les plus récents : consolation en points, perdant, gain d'un client sans prénom — tous omis.
    tirage('t-points', 'cl-lea', ilYa(0, 1), '+10 points', 'points', { points: 10 })
    tirage('t-perdu', 'cl-tom', ilYa(0, 2), 'Dommage', 'perdant')
    tirage('t-anonyme', 'cl-sans', ilYa(0, 3), 'Café offert', 'lot', { code: 'ANON01' })
    // 10 gains de lot avec prénom, du plus récent (j0) au plus ancien (j9) : seuls les 8 premiers sortent.
    for (let i = 0; i < 10; i++) tirage(`t-gain-${i}`, i % 2 ? 'cl-tom' : 'cl-lea', ilYa(i, 10), `Lot ${i}`, 'lot', { code: `CODE0${i}` })
    // Gain vieux de 31 jours : hors fenêtre.
    tirage('t-vieux', 'cl-lea', ilYa(31), 'Vieux lot', 'lot', { code: 'VIEUX1' })
    db.close()
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('8 derniers lots gagnés avec prénom, du plus récent au plus ancien ; ni points, ni perdant, ni sans prénom, ni > 30 j', async () => {
    const r = await http('GET', `/commerces/${commerceId}/derniers-gains`)
    assert.equal(r.statut, 200, r.texte)
    assert.deepEqual(r.contenu, {
      gains: Array.from({ length: 8 }, (_, i) => ({ prenom: i % 2 ? 'Tom' : 'Léa', lot: `Lot ${i}` })),
    })
    // Méthode cliente : même contenu.
    assert.deepEqual(await creerClientApi(`${racine}/api/v1`).derniersGains(commerceId), r.contenu.gains)
  })

  test('aucune donnée personnelle hormis le prénom : ni code, ni contact, ni id, ni date', async () => {
    const { texte } = await http('GET', `/commerces/${commerceId}/derniers-gains`)
    assert.doesNotMatch(texte, /code|CODE0|ANON01|telephone|0611111111|0622222222|email|exemple\.fr|clientId|cl-lea|cl-tom|t-gain|date|2026-/i)
    assert.doesNotMatch(texte, /Vieux lot|Café offert|\+10 points|Dommage/)
  })

  test('commerce inconnu → 404 ; autre méthode → 405', async () => {
    assert.equal((await http('GET', '/commerces/c-inconnu/derniers-gains')).statut, 404)
    assert.equal((await http('POST', `/commerces/${commerceId}/derniers-gains`, {})).statut, 405)
  })
})

describe('R4 vitrine : sources (App, page, Réglages)', () => {
  const app = lire('src/App.tsx')
  const page = lire('src/pages/Vitrine.tsx')
  const reglages = lire('src/pages/Reglages.tsx')

  test('App.tsx : page différée « vitrine » enregistrée comme bienvenue / reglement, publique et sombre', () => {
    assert.match(app, /vitrine: \(\) => import\('\.\/pages\/Vitrine'\)/)
    assert.match(app, /const Vitrine = lazy\(IMPORTS\.vitrine\)/)
    assert.match(app, /\n {2}vitrine: Vitrine,/)
    assert.match(app, /PAGES_PUBLIQUES_DIFFEREES: Page\[\] = \[[^\]]*'vitrine'/)
    assert.doesNotMatch(app, /^import Vitrine from/m)
  })

  test('Vitrine.tsx : derniers gains, rechargement 60 s et rotation 12 s (minuteurs nettoyés, onglet masqué), QR de jeu', () => {
    assert.match(page, /api\.derniersGains\(param\)/)
    assert.match(page, /export const RECHARGEMENT_MS = 60_000/)
    assert.match(page, /export const ROTATION_MS = 12_000/)
    assert.match(page, /useCycle\(RECHARGEMENT_MS, charger\)/)
    assert.match(page, /useCycle\(ROTATION_MS,/)
    assert.match(page, /const id = setInterval\([\s\S]*?if \(!document\.hidden\) action\(\)[\s\S]*?return \(\) => clearInterval\(id\)/)
    assert.match(page, /<QrCode texte=\{urlQrJeu\(commerce\.id\)\}/)
    assert.match(page, /Scannez pour jouer/)
    assert.match(page, /Ils ont gagné chez nous/)
    assert.match(page, /Les premiers gains du jour arrivent… à vous de jouer !/)
    // Plein écran sans clic : curseur masqué, aucun bouton.
    assert.match(page, /cursor-none/)
    assert.doesNotMatch(page, /<button\b|onClick=/)
  })

  test('mouvement réduit : roue immobile et sans fondu (JS et CSS)', () => {
    assert.match(page, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/)
    assert.match(page, /const fondu = reduit \? '' :/)
    assert.match(page, /tourne=\{!reduit\}/)
    const css = lire('src/index.css')
    assert.match(css, /\.vitrine-roue \{\s*animation: vitrine-rotation 60s linear infinite;/)
    assert.match(css, /@keyframes vitrine-rotation \{\s*from \{\s*transform: rotate\(0deg\);\s*\}\s*to \{\s*transform: rotate\(360deg\);/)
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.vitrine-roue \{\s*animation: none;/)
  })

  test('Réglages : bloc « Écran vitrine (TV) », URL absolue et lien dans un nouvel onglet', () => {
    assert.match(reglages, /Écran vitrine \(TV\)/)
    assert.match(reglages, /urlAbsolue\('vitrine', brouillon\.id\)/)
    assert.match(reglages, /<a href=\{urlAbsolue\('vitrine', brouillon\.id\)\} target="_blank" rel="noreferrer"[^>]*>\s*Ouvrir l’écran vitrine/)
  })
})

// P1-B5 — Logo du commerce : upload depuis les Réglages (PUT …/logo, fichier brut), affichage public (GET …/logo, champ
// `logo` de la vue publique), retour au logo par défaut (DELETE …/logo). Format lu dans les octets ; PNG / JPEG / WebP,
// 2 Mo, 100 à 4 096 px de côté. Stockage `meta` (aucune migration) — version Supabase : tests/supabase.test.ts.
import { test, describe, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import {
  dimensionsEnvoi,
  estLogoTeleverse,
  fondBlancOpaque,
  LIMITES_LOGO,
  lireEnTeteImage,
  MESSAGE_FORMAT_LOGO,
  problemeDimensions,
  urlLogo,
  validerLogo,
} from '../src/lib/logo.ts'
import { estLogoLocal, logoCommerce, VISUELS } from '../src/lib/visuels.ts'
import { creerClientApi } from '../src/data/api.ts'

const RACINE = join(import.meta.dirname, '..')
const VISUELS_DIR = join(RACINE, 'public', 'visuels')
const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }

// ---------- Fichiers de test ----------
// Vrais fichiers du dépôt (PNG 600×600, JPEG 1109×720, WebP VP8 341×225) + deux WebP réels générés par Pillow (sans
// perte VP8L 300×120 ; avec perte + transparence VP8X 257×129) + en-têtes synthétiques pour les bornes.
const PNG_REEL = readFileSync(join(VISUELS_DIR, 'logo.png'))
const JPEG_REEL = readFileSync(join(VISUELS_DIR, 'menu-loc-lac.jpg'))
const JPEG_PROGRESSIF = readFileSync(join(VISUELS_DIR, 'interieur.jpg'))
const WEBP_REEL = readFileSync(join(VISUELS_DIR, 'menu-dynamite.webp'))
const WEBP_VP8L = Buffer.from('UklGRiIAAABXRUJQVlA4TBYAAAAvK8EdEAcQEREQEiT8f28yov9p/3sC', 'base64')
const WEBP_VP8X = Buffer.from(
  'UklGRrQAAABXRUJQVlA4WAoAAAAQAAAAAAEAgAAAQUxQSAoAAAABB1DAiAhERP8DVlA4IIQAAACwCwCdASoBAYEAPm02mUmkIyKhIEgAgA2JaW7hdrEe3AAAJ7Xoq4QZBDVUmu20XCDIIaqk122i4QZBDVUmu20XCDIIaqk122i4QZBDVUmu20XCDIIaqk122i4QZBDVUmu20XCDIIaqk122i4QZBDVUmu20XCC9AAA/v9AA///6nH/ycf/Jx/X2//4cqfTtsAAAAAAAAA=',
  'base64',
)

/** PNG minimal : signature + bloc IHDR (seul l'en-tête est lu par le validateur). */
function png(l: number, h: number, total = 0): Buffer {
  const b = Buffer.alloc(Math.max(33, total))
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'ascii')
  b.writeUInt32BE(l, 16)
  b.writeUInt32BE(h, 20)
  b[24] = 8
  b[25] = 6
  return b
}
const GIF = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.from([0x2c, 0x01, 0x2c, 0x01]), Buffer.alloc(40)])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300"/></svg>')
const TEXTE = Buffer.from('Ceci est un fichier texte renommé logo.png\n'.repeat(5))

// ---------- Règles (logique pure, partagée front / serveur) ----------

describe('Logo : format lu dans les octets, poids et dimensions', () => {
  test('vrais fichiers PNG / JPEG (baseline et progressif) / WebP (VP8, VP8L, VP8X) : format et dimensions exacts', () => {
    assert.deepEqual(lireEnTeteImage(PNG_REEL), { type: 'image/png', largeur: 600, hauteur: 600 })
    assert.deepEqual(lireEnTeteImage(JPEG_REEL), { type: 'image/jpeg', largeur: 1109, hauteur: 720 })
    assert.deepEqual(lireEnTeteImage(JPEG_PROGRESSIF), { type: 'image/jpeg', largeur: 675, hauteur: 900 })
    assert.deepEqual(lireEnTeteImage(WEBP_REEL), { type: 'image/webp', largeur: 341, hauteur: 225 })
    assert.deepEqual(lireEnTeteImage(WEBP_VP8L), { type: 'image/webp', largeur: 300, hauteur: 120 })
    assert.deepEqual(lireEnTeteImage(WEBP_VP8X), { type: 'image/webp', largeur: 257, hauteur: 129 })
  })

  test('GIF, SVG, texte, fichier vide ou tronqué : refusés avec un message clair', () => {
    for (const f of [GIF, SVG, TEXTE, PNG_REEL.subarray(0, 10), JPEG_REEL.subarray(0, 3)]) assert.equal(lireEnTeteImage(f), null)
    assert.throws(() => validerLogo(GIF), { message: MESSAGE_FORMAT_LOGO })
    assert.throws(() => validerLogo(SVG), /PNG, JPEG ou WebP/)
    assert.throws(() => validerLogo(new Uint8Array()), /Aucun fichier/)
  })

  test('bornes : 100 px minimum et 4 096 px maximum de côté ; 2 Mo maximum (413)', () => {
    assert.equal(problemeDimensions(100, 100), null)
    assert.equal(problemeDimensions(4096, 4096), null)
    assert.match(problemeDimensions(99, 400)!, /trop petite : 100 px minimum.*99 × 400 px/)
    assert.match(problemeDimensions(4097, 200)!, /trop grande : 4096 px maximum.*4097 × 200 px/)
    assert.deepEqual(validerLogo(png(100, 100)), { type: 'image/png', largeur: 100, hauteur: 100 })
    assert.deepEqual(validerLogo(png(300, 300, LIMITES_LOGO.octetsMax)).largeur, 300, 'pile 2 Mo : accepté')
    assert.throws(() => validerLogo(png(300, 300, LIMITES_LOGO.octetsMax + 1)), (e: Error & { statut?: number }) => e.statut === 413 && /2 Mo maximum/.test(e.message))
    assert.equal(LIMITES_LOGO.octetsMax, 2 * 1024 * 1024)
  })

  test('réduction avant envoi : 512 px de grand côté, jamais d’agrandissement, petit côté jamais sous 100 px', () => {
    assert.deepEqual(dimensionsEnvoi(2000, 1000), { largeur: 512, hauteur: 256 })
    assert.deepEqual(dimensionsEnvoi(300, 200), { largeur: 300, hauteur: 200 })
    assert.deepEqual(dimensionsEnvoi(4000, 100), { largeur: 4000, hauteur: 100 }, 'bandeau très large : pas réduit sous le minimum')
    assert.deepEqual(dimensionsEnvoi(4000, 400), { largeur: 1000, hauteur: 100 })
  })

  test('fond blanc opaque repéré sur le pourtour ; transparent, sombre ou logo blanc sur noir : pas d’alerte', () => {
    const image = (l: number, h: number, bord: number[], centre: number[]) => {
      const px = new Uint8ClampedArray(l * h * 4)
      for (let y = 0; y < h; y++) for (let x = 0; x < l; x++) px.set(x === 0 || y === 0 || x === l - 1 || y === h - 1 ? bord : centre, (y * l + x) * 4)
      return px
    }
    assert.equal(fondBlancOpaque(image(20, 10, [255, 255, 255, 255], [200, 30, 40, 255]), 20, 10), true)
    assert.equal(fondBlancOpaque(image(20, 10, [250, 248, 240, 255], [0, 0, 0, 255]), 20, 10), true, 'blanc cassé opaque')
    assert.equal(fondBlancOpaque(image(20, 10, [255, 255, 255, 0], [255, 255, 255, 255]), 20, 10), false, 'fond transparent')
    assert.equal(fondBlancOpaque(image(20, 10, [17, 17, 17, 255], [255, 255, 255, 255]), 20, 10), false, 'blanc sur noir (comme le logo actuel)')
  })

  test('adresse versionnée du logo téléversé ; repli sur public/visuels/logo.png sans upload', () => {
    const url = urlLogo(AH, 'abc123')
    assert.equal(url, '/api/v1/commerces/c-asian-home-paris/logo?v=abc123')
    assert.equal(estLogoTeleverse(url), true)
    assert.equal(estLogoTeleverse(VISUELS.logo), false)
    assert.equal(estLogoTeleverse('https://exemple.fr/logo.png'), false)
    assert.equal(estLogoTeleverse(''), false)
    const ah = { id: AH, nom: 'Asian Home Paris' }
    assert.equal(logoCommerce({ ...ah, logo: url }), url)
    assert.equal(logoCommerce({ ...ah, logo: '' }), '/visuels/logo.png', 'sans upload / après suppression : le logo actuel')
    assert.equal(estLogoLocal(logoCommerce({ ...ah, logo: '' })), true)
  })
})

// ---------- Serveur ----------

const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p1-b5-'))
after(() => rmSync(dossier, { recursive: true, force: true }))

async function demarrer(nom: string) {
  const app = await creerServeur({ fichierDb: join(dossier, nom), adminPin: ADMIN, pinInitial: '1234', version: 'test' })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, { method: methode, headers: { 'Content-Type': 'application/json', ...entetes }, body: corps === undefined ? undefined : JSON.stringify(corps) })
    return { statut: r.status, contenu: await r.json() }
  }
  /** Envoi du fichier brut (comme le navigateur). */
  async function envoyer(octets: Uint8Array, entetes: Record<string, string> = PIN, type = 'image/png') {
    const r = await fetch(`${base}/commerces/${AH}/logo`, { method: 'PUT', headers: { 'Content-Type': type, ...entetes }, body: octets })
    return { statut: r.status, contenu: await r.json() }
  }
  /** GET d'une adresse de logo (`/api/v1/…`) : octets + en-têtes. */
  async function image(adresse: string, entetes: Record<string, string> = {}) {
    const r = await fetch(`${base}${adresse.slice('/api/v1'.length)}`, { headers: entetes })
    return { statut: r.status, type: r.headers.get('content-type'), cache: r.headers.get('cache-control'), etag: r.headers.get('etag'), octets: Buffer.from(await r.arrayBuffer()) }
  }
  return { app, api, envoyer, image, base }
}

describe('Serveur : PUT / GET / DELETE /commerces/:id/logo', () => {
  let srv: Awaited<ReturnType<typeof demarrer>>
  before(async () => {
    srv = await demarrer('logo.db')
  })
  after(() => srv.app.fermer())
  /** Aucun logo téléversé : la vue publique garde le logo par défaut (seed : `/visuels/logo.png` ; vide → même repli). */
  async function logoParDefaut() {
    const c = (await srv.api('GET', `/commerces/${AH}`)).contenu.commerce
    assert.equal(estLogoTeleverse(c.logo), false)
    assert.equal(logoCommerce(c), VISUELS.logo)
  }

  test('sans upload : logo par défaut dans la vue publique, GET …/logo → 404 (le front affiche public/visuels/logo.png)', async () => {
    await logoParDefaut()
    const r = await srv.image(`/api/v1/commerces/${AH}/logo`)
    assert.equal(r.statut, 404)
  })

  test('auth : sans PIN, mauvais PIN ou client public → 401, rien n’est enregistré', async () => {
    assert.equal((await srv.envoyer(PNG_REEL, {})).statut, 401)
    assert.equal((await srv.envoyer(PNG_REEL, { 'X-Commerce-PIN': '0000' })).statut, 401)
    // Un client inscrit (public) n'a aucun moyen de s'authentifier comme commerçant.
    const client = (await srv.api('POST', `/commerces/${AH}/clients`, { contact: '0611223344' })).contenu.client
    assert.ok(client.id)
    assert.equal((await srv.envoyer(PNG_REEL, { 'X-Session': 'faux-jeton' })).statut, 401)
    assert.equal((await srv.api('DELETE', `/commerces/${AH}/logo`)).statut, 401)
    await logoParDefaut()
    assert.equal((await srv.image(`/api/v1/commerces/${AH}/logo`)).statut, 404)
  })

  test('GIF / SVG / texte → 400 + message clair (même avec un Content-Type image/png menteur) ; logo inchangé', async () => {
    for (const [octets, type] of [[GIF, 'image/gif'], [SVG, 'image/svg+xml'], [TEXTE, 'text/plain'], [GIF, 'image/png'], [SVG, 'image/png']] as const) {
      const r = await srv.envoyer(octets, PIN, type)
      assert.equal(r.statut, 400, type)
      assert.equal(r.contenu.erreur, MESSAGE_FORMAT_LOGO)
    }
    await logoParDefaut()
  })

  test('fichier > 2 Mo → 413 « 2 Mo maximum » ; dimensions hors bornes → 400', async () => {
    const lourd = await srv.envoyer(png(300, 300, LIMITES_LOGO.octetsMax + 1))
    assert.equal(lourd.statut, 413)
    assert.match(lourd.contenu.erreur, /Logo trop lourd : 2 Mo maximum/)
    const petit = await srv.envoyer(png(64, 64))
    assert.equal(petit.statut, 400)
    assert.match(petit.contenu.erreur, /trop petite : 100 px minimum de côté \(image reçue : 64 × 64 px\)/)
    const geant = await srv.envoyer(png(5000, 300))
    assert.equal(geant.statut, 400)
    assert.match(geant.contenu.erreur, /trop grande : 4096 px maximum/)
    await logoParDefaut()
  })

  test('PNG accepté : vue publique (liste, fiche, carte, menu) → nouvelle adresse ; l’image est servie telle quelle, avec cache', async () => {
    const r = await srv.envoyer(PNG_REEL)
    assert.equal(r.statut, 200)
    const adresse: string = r.contenu.commerce.logo
    assert.match(adresse, /^\/api\/v1\/commerces\/c-asian-home-paris\/logo\?v=[0-9a-f]{16}$/)
    assert.deepEqual(r.contenu.logo, { type: 'image/png', largeur: 600, hauteur: 600, octets: PNG_REEL.length })

    assert.equal((await srv.api('GET', `/commerces/${AH}`)).contenu.commerce.logo, adresse)
    assert.equal((await srv.api('GET', '/commerces')).contenu.commerces.find((c: { id: string }) => c.id === AH).logo, adresse)
    assert.equal((await srv.api('GET', `/commerces/${AH}/menu`)).contenu.commerce.logo, adresse)
    const client = (await srv.api('POST', `/commerces/${AH}/clients`, { contact: '0611223344' })).contenu.client
    assert.equal((await srv.api('GET', `/cartes/${client.id}`)).contenu.commerce.logo, adresse, 'page carte')
    assert.equal((await srv.api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.commerce.logo, adresse)

    const img = await srv.image(adresse)
    assert.equal(img.statut, 200)
    assert.equal(img.type, 'image/png')
    assert.ok(img.octets.equals(PNG_REEL), 'octets identiques')
    assert.equal(img.cache, 'public, max-age=31536000, immutable', 'adresse versionnée : cache long')
    assert.equal((await srv.image(`/api/v1/commerces/${AH}/logo`)).cache, 'public, max-age=300', 'sans version : cache court')
    const revalide = await srv.image(adresse, { 'If-None-Match': img.etag! })
    assert.equal(revalide.statut, 304)
    assert.equal(revalide.octets.length, 0)
  })

  test('JPEG et WebP (VP8, VP8L, VP8X) acceptés et servis avec leur type ; chaque envoi change l’adresse', async () => {
    const vues = new Set<string>()
    for (const [octets, type] of [[JPEG_REEL, 'image/jpeg'], [WEBP_REEL, 'image/webp'], [WEBP_VP8L, 'image/webp'], [WEBP_VP8X, 'image/webp']] as const) {
      const r = await srv.envoyer(octets, PIN, 'application/octet-stream')
      assert.equal(r.statut, 200, type)
      vues.add(r.contenu.commerce.logo)
      const img = await srv.image(r.contenu.commerce.logo)
      assert.equal(img.type, type)
      assert.ok(img.octets.equals(octets))
    }
    assert.equal(vues.size, 4)
  })

  test('enregistrer les autres réglages (PATCH sans logo) ne touche pas au logo envoyé', async () => {
    const avant = (await srv.api('GET', `/commerces/${AH}`)).contenu.commerce.logo
    assert.ok(estLogoTeleverse(avant))
    assert.equal((await srv.api('PATCH', `/commerces/${AH}`, { coordonnees: '12 rue de la Paix' }, PIN)).statut, 200)
    assert.equal((await srv.api('GET', `/commerces/${AH}`)).contenu.commerce.logo, avant)
  })

  test('« Revenir au logo par défaut » : DELETE → champ vide partout, l’ancienne adresse répond 404', async () => {
    const avant = (await srv.api('GET', `/commerces/${AH}`)).contenu.commerce.logo
    const r = await srv.api('DELETE', `/commerces/${AH}/logo`, undefined, PIN)
    assert.equal(r.statut, 200)
    assert.equal(r.contenu.commerce.logo, '')
    assert.equal((await srv.api('GET', `/commerces/${AH}`)).contenu.commerce.logo, '')
    assert.equal(logoCommerce((await srv.api('GET', `/commerces/${AH}`)).contenu.commerce), VISUELS.logo, 'le front retombe sur public/visuels/logo.png')
    assert.equal((await srv.image(avant)).statut, 404)
    assert.equal((await srv.api('DELETE', `/commerces/${AH}/logo`, undefined, PIN)).statut, 200, 'idempotent')
  })

  test('méthode non prévue → 405 ; commerce inconnu → 404', async () => {
    assert.equal((await srv.api('POST', `/commerces/${AH}/logo`, {}, PIN)).statut, 405)
    assert.equal((await srv.image('/api/v1/commerces/inconnu/logo')).statut, 404)
  })

  test('non-régression : après un envoi de logo, 1 tirage par jour après visite validée (2e tirage → 409)', async () => {
    assert.equal((await srv.envoyer(PNG_REEL)).statut, 200)
    const client = (await srv.api('POST', `/commerces/${AH}/clients`, { contact: '0699887766' })).contenu.client
    assert.equal((await srv.api('POST', `/commerces/${AH}/tirages`, { contact: '0699887766' })).statut, 409, 'pas de visite validée : pas de tirage')
    assert.equal((await srv.api('POST', `/commerces/${AH}/clients/${client.id}/visite`, undefined, PIN)).statut, 200)
    assert.equal((await srv.api('POST', `/commerces/${AH}/tirages`, { contact: '0699887766' })).statut, 201)
    assert.equal((await srv.api('POST', `/commerces/${AH}/tirages`, { contact: '0699887766' })).statut, 409)
  })
})

test('le logo survit au redémarrage du serveur (relu dans `meta`, aucune migration)', async () => {
  const a = await demarrer('redemarrage.db')
  const adresse = (await a.envoyer(WEBP_VP8X)).contenu.commerce.logo
  await a.app.fermer()
  const b = await demarrer('redemarrage.db')
  try {
    assert.equal((await b.api('GET', `/commerces/${AH}`)).contenu.commerce.logo, adresse)
    const img = await b.image(adresse)
    assert.equal(img.statut, 200)
    assert.ok(img.octets.equals(WEBP_VP8X))
  } finally {
    await b.app.fermer()
  }
})

// ---------- Front ----------

describe('Front : client API, Réglages, affichage', () => {
  test('envoyerLogo : PUT du fichier brut avec la session, sans JSON ; supprimerLogo : DELETE', async () => {
    const appels: { url: string; init: RequestInit }[] = []
    const f = (async (url: string, init: RequestInit) => {
      appels.push({ url, init })
      return new Response(JSON.stringify({ commerce: { id: AH, logo: '/api/v1/commerces/c-asian-home-paris/logo?v=1' } }), { status: 200 })
    }) as typeof fetch
    const api = creerClientApi('https://app.test/api/v1', f)
    const fichier = new Blob([WEBP_REEL], { type: 'image/webp' })
    const c = await api.envoyerLogo(AH, { role: 'commerce', commerceId: AH, jeton: 'j' }, fichier)
    assert.equal(c.logo, '/api/v1/commerces/c-asian-home-paris/logo?v=1')
    assert.equal(appels[0].url, 'https://app.test/api/v1/commerces/c-asian-home-paris/logo')
    assert.equal(appels[0].init.method, 'PUT')
    assert.equal(appels[0].init.body, fichier)
    assert.deepEqual(appels[0].init.headers, { 'X-Session': 'j', 'Content-Type': 'image/webp' })
    await api.supprimerLogo(AH, { role: 'commerce', commerceId: AH, jeton: 'j' })
    assert.equal(appels[1].init.method, 'DELETE')
  })

  const source = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')

  test('Réglages : sélection de fichier (PNG / JPEG / WebP), aperçu sur fond nuit, alerte fond blanc, retour au défaut', () => {
    const champ = source('src/components/ChampLogo.tsx')
    assert.match(champ, /type="file"/)
    assert.match(champ, /accept="image\/png,image\/jpeg,image\/webp"/)
    assert.match(champ, /lireEnTeteImage[\s\S]*problemeDimensions/, 'mêmes contrôles que le serveur avant l’envoi')
    assert.match(champ, /messageTropLourd\(fichier\.size\)/)
    assert.match(champ, /data-apercu-logo/)
    assert.match(champ, /bg-nuit-950/)
    assert.match(champ, /fondBlanc && [\s\S]*fond blanc opaque/)
    assert.match(champ, /Revenir au logo par défaut/)
    assert.match(champ, /api\.envoyerLogo\(/)
    assert.match(champ, /api\.supprimerLogo\(/)
    const reglages = source('src/pages/Reglages.tsx')
    assert.match(reglages, /<ChampLogo commerce=\{brouillon\}/)
    assert.doesNotMatch(reglages, /URL d’image \(https:\/\/…\) ou initiales/, 'l’ancien champ texte a disparu')
  })

  test('enregistrer les réglages n’envoie plus `logo` (un brouillon ancien ne peut pas écraser le logo envoyé)', () => {
    const store = source('src/store.tsx')
    const bloc = store.slice(store.indexOf('majCommerce: (c: Commerce) =>'), store.indexOf('creerCommerce: (n: NouveauCommerce) =>\n        avecPin'))
    assert.ok(bloc.length > 100)
    assert.doesNotMatch(bloc.replace(/\/\/.*$/gm, ''), /\blogo\b/)
  })

  test('logo téléversé affiché sur le fond nuit de l’app, entier (object-contain)', () => {
    const ui = source('src/components/ui.tsx')
    assert.match(ui, /estLogoTeleverse\(logo\)[\s\S]*bg-nuit-950 object-contain/)
  })
})

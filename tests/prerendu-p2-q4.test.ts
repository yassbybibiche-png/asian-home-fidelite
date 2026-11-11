// P2-Q4 (trou bouché : prérendu) — La SPA vit dans le fragment (#/menu), invisible des moteurs de recherche :
// le serveur rend le menu en HTML statique à /menu/<commerceId> (titre, description, Open Graph et JSON-LD `Menu`
// propres à la page). Logique pure (server/prerendu.ts) + vrai serveur HTTP sur SQLite temporaire.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, ENTETES_SECURITE, type OptionsServeur } from '../server/app.ts'
import { echapperHtml, menuAffichePour, pageMenuIndisponible, pageMenuPrerendue, pageNonTrouvee } from '../server/prerendu.ts'
import { menuReelAsianHome } from '../src/data/menu-reel.ts'
import { nouveauCommerce } from '../src/data/defaults.ts'
import type { Commerce, Menu } from '../src/types.ts'

const RACINE = join(import.meta.dirname, '..')
const SITE = 'https://asian-home-fidelite.onrender.com'

const AH = { ...nouveauCommerce('Asian Home Paris', 'restaurant', ''), id: 'c-asian-home-paris', coordonnees: '11 rue André Joineau, 93310 Le Pré-Saint-Gervais' }
const AUTRE = { ...nouveauCommerce('Chez Lin', 'restaurant', ''), id: 'c-chez-lin' }

const menuVide = (id: string): Menu => ({ commerceId: id, categories: [], majLe: '' })
const menuTest = (id: string): Menu => ({
  commerceId: id,
  categories: [
    {
      id: 'cat-1',
      nom: 'Signatures',
      produits: [
        { id: 'p1', nom: 'Dynamite', description: 'Saumon snacké, sauce dynamite', prix: 1290, allergenes: [] },
        { id: 'p2', nom: 'Riz Thaï', description: '', prix: 890, allergenes: [] }, // prix non confirmé (P1-M1) : masqué
        { id: 'p3', nom: 'Soupe du jour', prix: null, allergenes: ['Gluten'] },
      ],
    },
  ],
  majLe: '',
})

function jsonLd(page: string) {
  const blocs = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  assert.equal(blocs.length, 1, 'un seul bloc JSON-LD')
  return JSON.parse(blocs[0][1])
}

// ---------- Logique pure ----------

describe('Prérendu : menu affiché (même règle que la page publique)', () => {
  test('menu enregistré avec des plats : il gagne ; vide + Asian Home : carte réelle ; vide + autre : vide', () => {
    const reel = menuReelAsianHome()
    assert.equal(reel.categories.reduce((n, c) => n + c.produits.length, 0), 81)
    assert.deepEqual(menuAffichePour(AH, menuTest(AH.id)).categories[0].produits.map((p) => p.nom), ['Dynamite', 'Riz Thaï', 'Soupe du jour'])
    const repli = menuAffichePour(AH, menuVide(AH.id))
    assert.equal(repli.categories.reduce((n, c) => n + c.produits.length, 0), 81, 'repli = carte réelle')
    assert.ok(repli.categories.some((c) => c.produits.some((p) => p.nom === 'Dynamite')))
    assert.deepEqual(menuAffichePour(AUTRE, menuVide(AUTRE.id)).categories, [])
  })

  test('prix non confirmés masqués (Riz Thaï 8,90 €, Maki Gold 100,00 €) ; prix corrigé affiché', () => {
    const masque = menuAffichePour(AH, menuTest(AH.id))
    assert.equal(masque.categories[0].produits[1].prix, null, 'Riz Thaï 8,90 € masqué')
    assert.equal(masque.categories[0].produits[0].prix, 1290)
    const corrige: Menu = { commerceId: AH.id, categories: [{ id: 'c', nom: 'C', produits: [{ id: 'p', nom: 'Riz Thaï', prix: 950, allergenes: [] }] }], majLe: '' }
    assert.equal(menuAffichePour(AH, corrige).categories[0].produits[0].prix, 950, 'prix corrigé (9,50 €) affiché')
  })
})

describe('Prérendu : page HTML du menu', () => {
  const page = pageMenuPrerendue(AH, menuAffichePour(AH, menuTest(AH.id)), SITE)

  test('titre, description, canonical et Open Graph propres à la page (adresses absolues)', () => {
    assert.match(page, /<title>Menu — Asian Home Paris<\/title>/)
    assert.match(page, /<meta name="description" content="Menu de Asian Home Paris : 3 plats en 1 catégorie\. Cuisine asiatique halal\."/)
    assert.match(page, new RegExp(`<link rel="canonical" href="${SITE}/menu/c-asian-home-paris">`))
    assert.match(page, /<meta property="og:type" content="website">/)
    assert.match(page, new RegExp(`<meta property="og:url" content="${SITE}/menu/c-asian-home-paris">`))
    assert.match(page, /<meta name="robots" content="index, follow">/)
  })

  test('plats et prix dans le corps : prix affiché en euros, « Prix sur place » sinon, allergènes repris', () => {
    assert.match(page, /<strong>Dynamite<\/strong> — Saumon snacké, sauce dynamite — 12,90 €/)
    assert.match(page, /<strong>Riz Thaï<\/strong> — Prix sur place/)
    assert.match(page, /<strong>Soupe du jour<\/strong> — Prix sur place<br><small>Allergènes : Gluten<\/small>/)
    assert.match(page, /Voir le menu interactif/)
    assert.match(page, /href="\/#\/menu\/c-asian-home-paris"/)
  })

  test('JSON-LD Menu : mêmes plats et prix que le corps, aucun prix masqué, halal seulement pour Asian Home', () => {
    const ld = jsonLd(page)
    assert.equal(ld['@type'], 'Menu')
    assert.equal(ld.url, `${SITE}/menu/c-asian-home-paris`)
    assert.equal(ld.hasMenuSection.length, 1)
    assert.equal(ld.hasMenuSection[0].hasMenuItem.length, 3)
    const [dynamite, riz, soupe] = ld.hasMenuSection[0].hasMenuItem
    assert.deepEqual(dynamite.offers, { '@type': 'Offer', price: '12.90', priceCurrency: 'EUR' })
    assert.equal(dynamite.suitableForDiet, 'https://schema.org/HalalDiet')
    assert.equal(riz.offers, undefined, 'prix masqué : aucune offre dans le JSON-LD')
    assert.equal(soupe.offers, undefined, 'sans prix : aucune offre')
    const autre = pageMenuPrerendue(AUTRE, menuAffichePour(AUTRE, menuTest(AUTRE.id)), SITE)
    assert.equal(jsonLd(autre).hasMenuSection[0].hasMenuItem[0].suitableForDiet, undefined, 'halal non revendiqué pour un autre commerce')
    assert.doesNotMatch(autre, /halal/i)
  })

  test('menu vide : page honnête, sans plat inventé, sans section dans le JSON-LD', () => {
    const vide = pageMenuPrerendue(AUTRE, menuAffichePour(AUTRE, menuVide(AUTRE.id)), SITE)
    assert.match(vide, /Le menu sera bientôt en ligne/)
    assert.equal(jsonLd(vide).hasMenuSection, undefined)
    assert.doesNotMatch(vide, /Dynamite/)
  })

  test('échappement : nom de plat hostile neutralisé dans le corps ET dans le JSON-LD', () => {
    const hostile: Menu = {
      commerceId: AH.id,
      categories: [{ id: 'c', nom: 'Cat <b>grasse</b>', produits: [{ id: 'p', nom: '</script><script>alert(1)</script>', description: 'a & b "c"', prix: 100, allergenes: [] }] }],
      majLe: '',
    }
    const p = pageMenuPrerendue(AH, hostile, SITE)
    assert.match(p, /Cat &lt;b&gt;grasse&lt;\/b&gt;/)
    assert.match(p, /&lt;\/script&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
    assert.match(p, /a &amp; b &quot;c&quot;/)
    assert.doesNotMatch(p, /<script>alert\(1\)/)
    assert.equal(jsonLd(p).hasMenuSection[0].hasMenuItem[0].name, '</script><script>alert(1)</script>', 'le JSON-LD reste parsable et fidèle')
    assert.equal(echapperHtml('<a href="x">&\'y\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;y&#39;&lt;/a&gt;')
  })

  test('sans style en ligne (CSP style-src self) : page lisible en HTML sémantique seul', () => {
    assert.doesNotMatch(page, /<style\b|\sstyle=|onclick=/i)
  })

  test('commerce en pause : noindex ; adresse inconnue : noindex', () => {
    assert.match(pageMenuIndisponible(AH, SITE), /<meta name="robots" content="noindex">/)
    assert.match(pageMenuIndisponible(AH, SITE), /Menu indisponible — Asian Home Paris/)
    assert.match(pageNonTrouvee(SITE), /<title>Page introuvable<\/title>/)
    assert.match(pageNonTrouvee(SITE), /<meta name="robots" content="noindex">/)
  })
})

// ---------- Serveur ----------

const ADMIN = '98765432'
const PIN = { 'X-Commerce-PIN': '1234' }
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-q4-'))
after(() => rmSync(dossier, { recursive: true, force: true }))
const horloge = new Date('2026-11-10T11:00:00Z')

async function demarrer(fichierDb: string, options: Partial<OptionsServeur> = {}) {
  const app = await creerServeur({ fichierDb, adminPin: ADMIN, pinInitial: '1234', version: 'test', maintenant: () => horloge, ...options })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(`${racine}/api/v1` + chemin, { method: methode, headers: { 'Content-Type': 'application/json', ...entetes }, body: corps === undefined ? undefined : JSON.stringify(corps) })
    return { statut: r.status, contenu: await r.json() }
  }
  return { app, api, racine }
}

describe('Serveur : GET /menu/<commerceId> (page prérendue)', () => {
  test('200 text/html, carte réelle en repli (Dynamite), canonical absolue, JSON-LD Menu, en-têtes de sécurité', async () => {
    const { app, racine } = await demarrer(join(dossier, 'menu.db'))
    try {
      const r = await fetch(`${racine}/menu/c-asian-home-paris`)
      assert.equal(r.status, 200)
      assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8')
      assert.equal(r.headers.get('cache-control'), 'public, max-age=300')
      assert.ok(r.headers.get('etag'), 'ETag présent')
      for (const [nom, valeur] of Object.entries(ENTETES_SECURITE)) assert.equal(r.headers.get(nom), valeur, nom)
      const page = await r.text()
      assert.match(page, /<title>Menu — Asian Home Paris<\/title>/)
      assert.match(page, new RegExp(`<link rel="canonical" href="${racine}/menu/c-asian-home-paris">`))
      assert.match(page, /Dynamite/)
      assert.equal(jsonLd(page).hasMenuSection.flatMap((s: { hasMenuItem: unknown[] }) => s.hasMenuItem).length, 81, 'carte réelle : 81 plats')
      assert.doesNotMatch(page, /Riz Thaï<\/strong> — 8,90 €/, 'prix non confirmé jamais affiché')
    } finally {
      await app.fermer()
    }
  })

  test('ETag : 304 si repris ; HEAD : mêmes en-têtes, sans corps', async () => {
    const { app, racine } = await demarrer(join(dossier, 'menu-etag.db'))
    try {
      const r1 = await fetch(`${racine}/menu/c-asian-home-paris`)
      const etag = r1.headers.get('etag')!
      assert.ok(etag)
      assert.equal((await fetch(`${racine}/menu/c-asian-home-paris`, { headers: { 'If-None-Match': etag } })).status, 304)
      assert.equal((await fetch(`${racine}/menu/c-asian-home-paris`, { headers: { 'If-None-Match': '"autre"' } })).status, 200)
      const head = await fetch(`${racine}/menu/c-asian-home-paris`, { method: 'HEAD' })
      assert.equal(head.status, 200)
      assert.equal(head.headers.get('etag'), etag)
      assert.equal(await head.text(), '')
    } finally {
      await app.fermer()
    }
  })

  test('menu enregistré : il remplace la carte réelle ; commerce en pause : noindex ; inconnu et /menu : 404', async () => {
    const { app, api, racine } = await demarrer(join(dossier, 'menu-enregistre.db'))
    try {
      assert.equal((await api('PUT', '/commerces/c-asian-home-paris/menu', menuTest('c-asian-home-paris'), PIN)).statut, 200)
      const page = await (await fetch(`${racine}/menu/c-asian-home-paris`)).text()
      assert.match(page, /<strong>Dynamite<\/strong>/)
      assert.doesNotMatch(page, /Loc Lac/, 'menu enregistré (3 plats) : pas la carte réelle de 81 plats')
      assert.match(page, /Riz Thaï<\/strong> — Prix sur place/)
    } finally {
      await app.fermer()
    }
    const pause = await demarrer(join(dossier, 'menu-pause.db'))
    try {
      assert.equal((await pause.api('PATCH', '/commerces/c-asian-home-paris', { actif: false }, PIN)).statut, 200)
      const r = await fetch(`${pause.racine}/menu/c-asian-home-paris`)
      assert.equal(r.status, 200)
      assert.match(await r.text(), /noindex/)
      assert.match(await (await fetch(`${pause.racine}/menu/inconnu`)).text(), /Page introuvable/)
      assert.equal((await fetch(`${pause.racine}/menu/inconnu`)).status, 404)
      assert.equal((await fetch(`${pause.racine}/menu`)).status, 404, '/menu sans id : 404, pas la SPA')
    } finally {
      await pause.app.fermer()
    }
  })

  test('sitemap : / et /menu/<id> prérendu (plus de fragment #/menu ni #/jouer) ; index.html : hasMenu = adresse prérendue', () => {
    const sitemap = readFileSync(join(RACINE, 'public/sitemap.xml'), 'utf8')
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    assert.deepEqual(locs, [`${SITE}/`, `${SITE}/menu/c-asian-home-paris`])
    assert.doesNotMatch(sitemap, /#\//)
    const html = readFileSync(join(RACINE, 'index.html'), 'utf8')
    assert.match(html, new RegExp(`"hasMenu": "${SITE}/menu/c-asian-home-paris"`))
  })
})

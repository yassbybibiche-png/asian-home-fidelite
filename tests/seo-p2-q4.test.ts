// P2-Q4 — Domaine & SEO : balises meta / Open Graph / Twitter Card / canonical / favicon et données structurées
// Restaurant dans index.html (une seule page HTML pour #/menu, #/jouer, #/carte), robots.txt + sitemap.xml + favicon
// servis par le vrai serveur. Les faits du JSON-LD sont recoupés avec ce que le code connaît déjà (rien d'inventé).
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, ENTETES_SECURITE } from '../server/app.ts'
import { CONTACT_ASIAN_HOME } from '../src/lib/menuClient.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (f: string) => readFileSync(join(RACINE, f), 'utf8')
const SITE = 'https://asian-home-fidelite.onrender.com'
const html = lire('index.html')
const seed = JSON.parse(lire('src/data/seed.json')) as { commerces: { nom: string; coordonnees: string }[] }
const AH = seed.commerces[0]

function meta(attribut: 'name' | 'property', cle: string): string {
  const m = html.match(new RegExp(`<meta ${attribut}="${cle.replace(/[.:]/g, '\\$&')}" content="([^"]*)" />`))
  assert.ok(m, `<meta ${attribut}="${cle}"> absente`)
  return m[1]
}

function jsonLd(source: string) {
  const blocs = [...source.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  assert.equal(blocs.length, 1, 'un seul bloc JSON-LD')
  return JSON.parse(blocs[0][1])
}

describe('P2-Q4 : balises SEO de index.html', () => {
  test('meta description (150-200 caractères environ), robots index/follow, canonical absolue', () => {
    const description = meta('name', 'description')
    assert.ok(description.length >= 80 && description.length <= 220, `longueur ${description.length}`)
    assert.match(description, /Asian Home/)
    assert.match(description, /Pré-Saint-Gervais/)
    assert.equal(meta('name', 'robots'), 'index, follow')
    assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}/" />`))
    // Une seule description, un seul titre (pas de doublon qui embrouillerait les moteurs).
    assert.equal(html.match(/<meta name="description"/g)?.length, 1)
    assert.equal(html.match(/<title>/g)?.length, 1)
  })

  test('Open Graph : title, description, image (fichier existant, dimensions exactes), url, type, locale', () => {
    assert.ok(meta('property', 'og:title').length > 0)
    assert.ok(meta('property', 'og:description').length > 0)
    assert.equal(meta('property', 'og:url'), `${SITE}/`)
    assert.equal(meta('property', 'og:locale'), 'fr_FR')
    assert.equal(meta('property', 'og:site_name'), AH.nom)
    const image = meta('property', 'og:image')
    assert.ok(image.startsWith(`${SITE}/`), 'og:image absolue (les réseaux sociaux ne résolvent pas les chemins relatifs)')
    const fichier = join(RACINE, 'public', image.slice(SITE.length))
    assert.ok(existsSync(fichier), `${fichier} absent`)
    // En-tête JPEG : dimensions dans le premier segment SOF (0xFFC0..0xFFC2).
    const octets = readFileSync(fichier)
    let i = 2
    while (i < octets.length && !(octets[i] === 0xff && octets[i + 1] >= 0xc0 && octets[i + 1] <= 0xc2)) i += 2 + octets.readUInt16BE(i + 2)
    assert.equal(octets.readUInt16BE(i + 7), Number(meta('property', 'og:image:width')))
    assert.equal(octets.readUInt16BE(i + 5), Number(meta('property', 'og:image:height')))
    assert.ok(meta('property', 'og:image:alt').length > 0)
  })

  test('Twitter Card : grande image, mêmes visuels que Open Graph', () => {
    assert.equal(meta('name', 'twitter:card'), 'summary_large_image')
    assert.ok(meta('name', 'twitter:title').length > 0)
    assert.ok(meta('name', 'twitter:description').length > 0)
    assert.equal(meta('name', 'twitter:image'), meta('property', 'og:image'))
  })

  test('favicon : .ico (16/32/48) et PNG 32 générés depuis le logo, référencés dans index.html', () => {
    assert.match(html, /<link rel="icon" href="\/favicon\.ico" sizes="48x48" \/>/)
    assert.match(html, /<link rel="icon" type="image\/png" sizes="32x32" href="\/icones\/favicon-32\.png" \/>/)
    const ico = readFileSync(join(RACINE, 'public/favicon.ico'))
    assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0], 'en-tête ICO')
    assert.equal(ico.readUInt16LE(4), 3, '3 tailles')
    const png = readFileSync(join(RACINE, 'public/icones/favicon-32.png'))
    assert.equal(png.toString('latin1', 1, 4), 'PNG')
    assert.equal(png.readUInt32BE(16), 32)
  })

  test('une seule adresse de site partout (index.html, robots.txt, sitemap.xml) : un domaine à soi = 3 fichiers à changer', () => {
    const origines = new Set([html, lire('public/robots.txt'), lire('public/sitemap.xml')].flatMap((t) => [...t.matchAll(/https:\/\/[a-z0-9.-]+\.onrender\.com/g)].map((m) => m[0])))
    assert.deepEqual([...origines], [SITE])
    assert.match(lire('docs/DOMAINE.md'), /index\.html[\s\S]*robots\.txt[\s\S]*sitemap\.xml/)
  })
})

describe('P2-Q4 : données structurées Restaurant (JSON-LD), uniquement des faits déjà dans le code', () => {
  const ld = jsonLd(html)

  test('type Restaurant, nom et URL du site', () => {
    assert.equal(ld['@context'], 'https://schema.org')
    assert.equal(ld['@type'], 'Restaurant')
    assert.equal(ld.name, AH.nom)
    assert.equal(ld.url, `${SITE}/`)
    assert.equal(ld.hasMenu, `${SITE}/#/menu`)
  })

  test('adresse et téléphone = coordonnées vérifiées (CONTACT_ASIAN_HOME, seed)', () => {
    assert.equal(ld.telephone, CONTACT_ASIAN_HOME.telephone)
    const a = ld.address
    assert.equal(a['@type'], 'PostalAddress')
    assert.equal(`${a.streetAddress}, ${a.postalCode} ${a.addressLocality}`, CONTACT_ASIAN_HOME.adresse)
    assert.equal(a.addressCountry, 'FR')
    assert.ok(AH.coordonnees.startsWith(CONTACT_ASIAN_HOME.adresse))
    assert.match(AH.coordonnees, /07 82 97 48 01/)
  })

  test('horaires = « Tous les jours 11h30-14h30 et 18h30-23h30 » du seed', () => {
    assert.match(AH.coordonnees, /Tous les jours 11h30-14h30 et 18h30-23h30/)
    const jours = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    const creneaux = ld.openingHoursSpecification.map((s: { dayOfWeek: string[]; opens: string; closes: string }) => {
      assert.deepEqual(s.dayOfWeek, jours)
      return `${s.opens}-${s.closes}`
    })
    assert.deepEqual(creneaux, ['11:30-14:30', '18:30-23:30'])
  })

  test('cuisine asiatique halal (seed « Halal », MenuPublic « Thaï, Japon, Vietnam, Chine »), Instagram du code', () => {
    assert.match(AH.coordonnees, /Halal/)
    assert.match(lire('src/pages/MenuPublic.tsx'), /Cuisine asiatique halal · Thaï, Japon, Vietnam, Chine/)
    assert.ok(ld.servesCuisine.includes('Asiatique') && ld.servesCuisine.includes('Halal'))
    assert.deepEqual(ld.sameAs, [`https://www.instagram.com/${CONTACT_ASIAN_HOME.instagram}/`])
  })

  test('rien d’inventé : ni coordonnées GPS, ni gamme de prix, ni note / avis agrégés', () => {
    for (const cle of ['geo', 'priceRange', 'aggregateRating', 'review', 'acceptsReservations', 'email']) assert.equal(ld[cle], undefined, cle)
  })

  test('images du JSON-LD : fichiers existants du dossier public/', () => {
    for (const url of [ld.logo, ld.image]) {
      assert.ok(url.startsWith(`${SITE}/`))
      assert.ok(existsSync(join(RACINE, 'public', url.slice(SITE.length))), url)
    }
  })
})

describe('P2-Q4 : robots.txt et sitemap.xml', () => {
  test('robots.txt : tout autorisé sauf /api/, lien vers le sitemap', () => {
    const robots = lire('public/robots.txt')
    assert.match(robots, /^User-agent: \*$/m)
    assert.match(robots, /^Allow: \/$/m)
    assert.match(robots, /^Disallow: \/api\/$/m)
    assert.match(robots, new RegExp(`^Sitemap: ${SITE}/sitemap\\.xml$`, 'm'))
    // Un Disallow: / bloquerait tout le site : jamais.
    assert.doesNotMatch(robots, /^Disallow: \/\s*$/m)
  })

  test('sitemap.xml : /, #/menu, #/jouer, limite du routeur par fragment documentée', () => {
    const sitemap = lire('public/sitemap.xml')
    assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/)
    assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/)
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    assert.deepEqual(locs, [`${SITE}/`, `${SITE}/#/menu`, `${SITE}/#/jouer`])
    // Aucune page privée (caisse, back-office, carte d'un client) dans le sitemap.
    assert.doesNotMatch(sitemap, /#\/(caisse|clients|reglages|admin|carte\/)/)
    assert.match(sitemap, /Google ignore tout ce qui suit « # »/)
    assert.match(lire('docs/SEO.md'), /fragment/)
  })
})

describe('P2-Q4 : fichiers SEO servis par le serveur (dossier statique = copie de public/ + index.html)', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-q4-'))
  const statique = join(dossier, 'dist')
  mkdirSync(join(statique, 'icones'), { recursive: true })
  writeFileSync(join(statique, 'index.html'), html)
  for (const f of ['robots.txt', 'sitemap.xml', 'favicon.ico', 'icones/favicon-32.png']) writeFileSync(join(statique, f), readFileSync(join(RACINE, 'public', f)))
  after(() => rmSync(dossier, { recursive: true, force: true }))

  test('robots.txt (text/plain), sitemap.xml (application/xml), favicon.ico (image/x-icon), favicon-32.png : 200, contenu exact, en-têtes de sécurité', async () => {
    const app = await creerServeur({ fichierDb: join(dossier, 'q4.db'), adminPin: '98765432', pinInitial: '1234', version: 'test', dossierStatique: statique })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
    try {
      const attendus: [string, string][] = [
        ['/robots.txt', 'text/plain; charset=utf-8'],
        ['/sitemap.xml', 'application/xml; charset=utf-8'],
        ['/favicon.ico', 'image/x-icon'],
        ['/icones/favicon-32.png', 'image/png'],
      ]
      for (const [chemin, type] of attendus) {
        const r = await fetch(racine + chemin)
        assert.equal(r.status, 200, chemin)
        assert.equal(r.headers.get('content-type'), type, chemin)
        assert.ok(Buffer.from(await r.arrayBuffer()).equals(readFileSync(join(RACINE, 'public', chemin))), `${chemin} : contenu`)
        for (const [nom, valeur] of Object.entries(ENTETES_SECURITE)) assert.equal(r.headers.get(nom), valeur, `${chemin} : ${nom}`)
      }
      // La page servie porte les balises SEO (aucun JS nécessaire pour les lire : robots et aperçus de liens).
      const page = await (await fetch(racine + '/')).text()
      assert.match(page, /<meta property="og:image" content="https:/)
      assert.equal(jsonLd(page)['@type'], 'Restaurant')
    } finally {
      await app.fermer()
    }
  })

  test('build (dist/) : Vite garde le bloc JSON-LD et copie robots.txt, sitemap.xml, favicon.ico', (t) => {
    if (!existsSync(join(RACINE, 'dist/index.html')) || !lire('dist/index.html').includes('application/ld+json')) return t.skip('dist/ absent ou périmé : lancer npm run build')
    assert.equal(jsonLd(lire('dist/index.html'))['@type'], 'Restaurant')
    for (const f of ['robots.txt', 'sitemap.xml', 'favicon.ico']) assert.ok(existsSync(join(RACINE, 'dist', f)), f)
  })
})

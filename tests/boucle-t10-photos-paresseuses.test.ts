/**
 * Boucle t10 — photos paresseuses en WebP léger : les 6 photos d'ambiance / de
 * catégorie (loading="lazy", sous le pli) sont servies en WebP recadré au ratio
 * d'affichage via <picture>, le JPEG restant le repli. Carte : interieur.jpg
 * (675×900, 131 Ko) et interieur-salon.jpg (320×240, 22 Ko). Menu : les 4 photos
 * de catégories (photoCategorie) — sushis-ardoise, cocktails, menu-plat-riz,
 * menu-mango-sticky-rice. Total ~350 Ko → ~83 Ko.
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { describe, test } from 'node:test'

const lire = (chemin: string) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')
const octets = (chemin: string) => readFileSync(new URL(`../${chemin}`, import.meta.url))

const VARIANTES: [string, number, number, number][] = [
  ['interieur-petit.webp', 675, 443, 60_000],
  ['interieur-salon-petit.webp', 320, 157, 15_000],
  ['sushis-ardoise-petit.webp', 614, 201, 25_000],
  ['cocktails-petit.webp', 640, 210, 25_000],
  ['menu-plat-riz-petit.webp', 424, 139, 15_000],
  ['menu-mango-sticky-rice-petit.webp', 411, 134, 25_000],
]

describe('Boucle t10 — photos paresseuses en WebP léger', () => {
  for (const [fichier, largeur, hauteur, plafond] of VARIANTES) {
    test(`${fichier} : WebP ${largeur}×${hauteur} valide, < ${plafond / 1000} Ko`, () => {
      const chemin = `public/visuels/${fichier}`
      assert.ok(existsSync(new URL(`../${chemin}`, import.meta.url)))
      const o = octets(chemin)
      assert.equal(o.subarray(0, 4).toString('ascii'), 'RIFF')
      assert.equal(o.subarray(8, 12).toString('ascii'), 'WEBP')
      assert.equal(o.subarray(12, 15).toString('ascii'), 'VP8')
      assert.equal(o.readUInt16LE(26) & 0x3fff, largeur)
      assert.equal(o.readUInt16LE(28) & 0x3fff, hauteur)
      assert.ok(statSync(new URL(`../${chemin}`, import.meta.url)).size < plafond, `variante < ${plafond} o`)
    })
  }

  test('CartePublique : <picture> WebP d’abord pour les deux photos du restaurant', () => {
    const tsx = lire('src/pages/CartePublique.tsx')
    assert.match(tsx, /<picture className="block">\s*<source srcSet=\{VISUELS\.interieurPetit\} type="image\/webp" \/>\s*<img\s*src=\{VISUELS\.interieur\}/)
    assert.match(tsx, /<picture className="block">\s*<source srcSet=\{VISUELS\.interieurSalonPetit\} type="image\/webp" \/>\s*<img\s*src=\{VISUELS\.interieurSalon\}/)
  })

  test('MenuPublic : <picture> WebP d’abord pour la photo de catégorie (srcPetit)', () => {
    const tsx = lire('src/pages/MenuPublic.tsx')
    assert.match(tsx, /<picture className="block">\s*<source srcSet=\{photo\.srcPetit\} type="image\/webp" \/>\s*<img src=\{photo\.src\} alt=\{photo\.alt\} loading="lazy"/)
  })

  test('photoCategorie : chaque branche renvoie srcPetit (variante WebP)', () => {
    const visuels = lire('src/lib/visuels.ts')
    for (const cle of ['sushisArdoisePetit', 'cocktailsPetit', 'menuPlatRizPetit', 'menuMangoStickyRicePetit']) {
      assert.ok(visuels.includes(`srcPetit: VISUELS.${cle}`), cle)
    }
    assert.match(visuels, /export interface PhotoCategorie \{[\s\S]*?srcPetit: string/)
  })

  test('provenance documentée dans SOURCES.md (6 variantes)', () => {
    const sources = lire('public/visuels/SOURCES.md')
    for (const [fichier] of VARIANTES) {
      assert.ok(sources.includes(fichier), fichier)
    }
    assert.ok(sources.includes('boucle t10'), 'SOURCES.md mentionne la boucle t10')
  })
})

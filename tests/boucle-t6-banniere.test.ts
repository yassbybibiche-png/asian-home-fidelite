/**
 * Boucle t6 — bannière de la carte (CarteFidelite) : la variante WebP légère du
 * plateau de plats (hero-plats-petit.webp, 720×480, ~76 Ko) est servie en premier
 * via <picture>, le JPEG 1024×683 (177 Ko) restant le repli. La bannière est
 * affichée 390×96 (h-24) en haut de la carte ; elle partage le tuyau 4G avec le
 * héros de la carte (table-sushis-petit.webp, élément LCP de #/carte) — la
 * variante allège la concurrence réseau. Seule la bannière par défaut est
 * concernée : une bannière configurée par le commerçant garde sa balise <img>
 * simple (le <picture> reste, sans <source>).
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { describe, test } from 'node:test'

const lire = (chemin: string) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')
const octets = (chemin: string) => readFileSync(new URL(`../${chemin}`, import.meta.url))

describe('Boucle t6 — bannière de la carte en WebP léger (CarteFidelite)', () => {
  test('hero-plats-petit.webp : WebP 720 px de large valide, < 120 Ko (dérivé du vrai plateau)', () => {
    const fichier = 'public/visuels/hero-plats-petit.webp'
    assert.ok(existsSync(new URL(`../${fichier}`, import.meta.url)))
    const o = octets(fichier)
    assert.equal(o.subarray(0, 4).toString('ascii'), 'RIFF')
    assert.equal(o.subarray(8, 12).toString('ascii'), 'WEBP')
    assert.equal(o.subarray(12, 15).toString('ascii'), 'VP8')
    const largeur = o.readUInt16LE(26) & 0x3fff
    const hauteur = o.readUInt16LE(28) & 0x3fff
    assert.equal(largeur, 720)
    assert.equal(hauteur, 480)
    assert.ok(statSync(new URL(`../${fichier}`, import.meta.url)).size < 120_000, 'variante < 120 Ko')
  })

  test('CarteFidelite : <picture> WebP d’abord, <img> JPEG inchangée en repli — bannière par défaut seulement', () => {
    const tsx = lire('src/components/CarteFidelite.tsx')
    assert.match(tsx, /<picture className="block">\s*\{banniere === VISUELS\.heroPlats && <source srcSet=\{VISUELS\.heroPlatsPetit\} type="image\/webp" \/>\}\s*<img\s*src=\{banniere\}/)
    // La bannière configurée par le commerçant (URL https) n'a pas de variante : l'<img>
    // reste, sans <source> WebP.
    assert.doesNotMatch(tsx, /heroPlatsPetit.*https|https.*heroPlatsPetit/)
  })

  test('provenance documentée dans SOURCES.md', () => {
    const sources = lire('public/visuels/SOURCES.md')
    assert.ok(sources.includes('hero-plats-petit.webp'), 'SOURCES.md mentionne la variante')
    assert.ok(sources.includes('bannière de la carte'), 'SOURCES.md mentionne son usage')
  })
})

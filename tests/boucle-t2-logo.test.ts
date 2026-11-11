// Boucle t2 — Logo de chargement optimisé : l'écran de chargement (index.html, affiché avant
// le JS) chargeait `/visuels/logo.png` (600×600, 74 451 o) affiché à 96×96 — 31 % des octets
// du premier affichage, en concurrence avec le JS sur la 4G lente. `logo-petit.webp` (192×192,
// WebP q80, ~4,9 Ko, dérivé du vrai logo) est servi en premier via `<picture>` ; le PNG reste
// le repli pour les navigateurs sans WebP (pas un repli en cas d'échec de chargement : `<picture>`
// ne rebascule pas sur erreur réseau) et le logo du commerce partout ailleurs —
// `logo.png` n'est ni modifié ni remplacé (fixtures de tests, logo du commerce).
// Le test P0-U1 (`chargement-p0-u1.test.ts`) continue de passer sans modification : il lit la
// balise `<img>` de repli, inchangée.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')

describe('Boucle t2 : logo de chargement optimisé', () => {
  test('logo-petit.webp : WebP valide 192×192, ~15× plus léger que logo.png', () => {
    const chemin = join(RACINE, 'public', 'visuels', 'logo-petit.webp')
    assert.ok(existsSync(chemin), 'public/visuels/logo-petit.webp introuvable')
    const octets = readFileSync(chemin)
    // En-tête RIFF…WEBP (VP8) : pas un PNG renommé. Le chunk est bien `VP8 ` (perte) avec sa
    // signature de trame (0x9d 0x01 0x2a) — les offsets des dimensions ci-dessous ne valent que
    // pour ce format (ni VP8L ni VP8X ; revue Codex t2, point 4).
    assert.equal(octets.subarray(0, 4).toString('latin1'), 'RIFF')
    assert.equal(octets.subarray(8, 12).toString('latin1'), 'WEBP')
    assert.equal(octets.subarray(12, 16).toString('latin1'), 'VP8 ')
    assert.deepEqual([...octets.subarray(23, 26)], [0x9d, 0x01, 0x2a])
    // Dimensions VP8 (octets 26–29, little-endian, 14 bits + 2 bits d'échelle) : 192×192.
    const largeur = octets.readUInt16LE(26) & 0x3fff
    const hauteur = octets.readUInt16LE(28) & 0x3fff
    assert.equal(largeur, 192)
    assert.equal(hauteur, 192)
    assert.ok(octets.length < 10_000, `logo-petit.webp : ${octets.length} o (attendu < 10 Ko)`)
    assert.ok(octets.length < statSync(join(RACINE, 'public', 'visuels', 'logo.png')).size / 10, 'au moins 10× plus léger que logo.png')
  })

  test('index.html : <picture> WebP d’abord, <img> PNG inchangée en repli', () => {
    const html = lire('index.html')
    assert.match(html, /<picture>\s*<source srcset="\/visuels\/logo-petit\.webp" type="image\/webp" \/>\s*<img class="chargement-initial__logo" src="\/visuels\/logo\.png" alt="Asian Home" width="96" height="96" \/>\s*<\/picture>/)
    // Le PNG reste le logo du commerce (seed, repli, JSON-LD) : aucune autre occurrence remplacée.
    assert.match(html, /"logo": "https:\/\/asian-home-fidelite\.onrender\.com\/visuels\/logo\.png"/)
  })

  test('service worker : la variante est préchargée (écran de chargement hors ligne), logo.png gardé', () => {
    const sw = lire('public/sw.js')
    assert.match(sw, /'\/visuels\/logo-petit\.webp'/)
    assert.match(sw, /'\/visuels\/logo\.png'/)
  })

  test('provenance documentée : logo-petit.webp est un dérivé de logo.png, pas une nouvelle source', () => {
    const sources = lire('public/visuels/SOURCES.md')
    assert.match(sources, /logo-petit\.webp.*Dérivé de `logo\.png`/s)
  })
})

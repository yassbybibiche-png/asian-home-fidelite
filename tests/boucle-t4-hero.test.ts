// Boucle t4 — Héros du menu optimisé : pour le vrai menu Asian Home, l'élément LCP est
// la photo d'en-tête `table-sushis.jpg` (788×1400, 195 989 o, affichée ~390×224 en
// `object-cover`) — à froid, sur Slow 4G, elle met ~1,46 s à se télécharger et le LCP
// du menu est à 3 376–3 428 ms (mesure ponctuelle, commerce « Asian Home Paris »,
// `node_modules/.cache/profil-t4/mesurer-menu-asian-home.mjs` — le protocole standard
// utilise un commerce générique, sans visuels : le héros n'y apparaît pas).
// `table-sushis-petit.webp` (720×1279, WebP q75, ~95 Ko, dérivé de la vraie photo) est
// servi en premier via `<picture>` (repli JPEG inchangé, navigateurs sans WebP) sur le
// menu ET sur la carte (même visuel, même motif) ; `table-sushis.jpg` reste intact
// partout (repli, OG, SOURCES.md). Le test P1-C5 (`menu-client-p1-c5.test.ts`) continue
// de passer sans modification : il lit la balise `<img>` de repli (seule image sans
// `loading="lazy"`, src `VISUELS.tableSushis`).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')

describe('Boucle t4 : héros du menu optimisé', () => {
  test('table-sushis-petit.webp : WebP valide 720 px de large, ~2× plus léger que table-sushis.jpg', () => {
    const chemin = join(RACINE, 'public', 'visuels', 'table-sushis-petit.webp')
    assert.ok(existsSync(chemin), 'public/visuels/table-sushis-petit.webp introuvable')
    const octets = readFileSync(chemin)
    // En-tête RIFF…WEBP, chunk VP8 (perte) + signature de trame — les offsets des dimensions
    // ne valent que pour ce format (ni VP8L ni VP8X ; même garde que boucle t2).
    assert.equal(octets.subarray(0, 4).toString('latin1'), 'RIFF')
    assert.equal(octets.subarray(8, 12).toString('latin1'), 'WEBP')
    assert.equal(octets.subarray(12, 16).toString('latin1'), 'VP8 ')
    assert.deepEqual([...octets.subarray(23, 26)], [0x9d, 0x01, 0x2a])
    const largeur = octets.readUInt16LE(26) & 0x3fff
    const hauteur = octets.readUInt16LE(28) & 0x3fff
    assert.equal(largeur, 720)
    assert.equal(hauteur, 1279)
    assert.ok(octets.length < 120_000, `table-sushis-petit.webp : ${octets.length} o (attendu < 120 Ko)`)
    assert.ok(octets.length < statSync(join(RACINE, 'public', 'visuels', 'table-sushis.jpg')).size / 1.5, 'au moins 1,5× plus léger que table-sushis.jpg')
  })

  test('MenuPublic + CartePublique : <picture> WebP d’abord, <img> JPEG inchangée en repli', () => {
    for (const fichier of ['src/pages/MenuPublic.tsx', 'src/pages/CartePublique.tsx']) {
      const tsx = lire(fichier)
      assert.match(tsx, /<picture[^>]*>\s*<source srcSet=\{VISUELS\.tableSushisPetit\} type="image\/webp" \/>\s*<img\s*src=\{VISUELS\.tableSushis\}/, fichier)
    }
    assert.match(lire('src/lib/visuels.ts'), /tableSushisPetit: '\/visuels\/table-sushis-petit\.webp'/)
  })

  test('service worker : la variante N’EST PAS préchargée (comme les photos de plats)', () => {
    // 95 Ko : le préchargement à l'installation alourdit le SW pendant le chargement.
    // Seuls les petits visuels de marque sont préchargés (logo, logo-petit) ; les photos
    // de contenu (menu-*.webp, table-sushis) sont mises en cache à la première visite,
    // comme les photos de plats. Hors ligne, le héros peut donc manquer s'il n'a pas
    // déjà été mis en cache par une visite en ligne (ou après éviction) — après mise
    // en cache, il reste disponible. Dégradation acceptable pour une photo d'ambiance.
    const sw = lire('public/sw.js')
    assert.doesNotMatch(sw, /table-sushis-petit\.webp/)
    assert.match(sw, /'\/visuels\/logo-petit\.webp'/)
  })

  test('provenance documentée : table-sushis-petit.webp est un dérivé de table-sushis.jpg, pas une nouvelle source', () => {
    const sources = lire('public/visuels/SOURCES.md')
    assert.match(sources, /table-sushis-petit\.webp.*Dérivé de `table-sushis\.jpg`/s)
  })
})

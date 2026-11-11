/**
 * Boucle t5 — logo du commerce (LogoCommerce) : la variante WebP légère du logo
 * par défaut (logo-petit.webp, 192×192, 4,9 Ko) est servie en premier via
 * <picture>, le PNG 600×600 (74 Ko) restant le repli. Le logo est affiché
 * 64×64 (taille lg) sur #/jouer et #/menu : le PNG télécharge ~870 ms sur
 * 4G lente, en parallèle du héros du menu. Seul le logo par défaut est
 * concerné : un logo téléversé ou renseigné par le commerçant garde sa
 * balise <img> simple.
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { describe, test } from 'node:test'

const lire = (chemin: string) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')
const octets = (chemin: string) => readFileSync(new URL(`../${chemin}`, import.meta.url))

describe('Boucle t5 — logo du commerce en WebP léger (LogoCommerce)', () => {
  test('logo-petit.webp : WebP 192×192 valide, < 10 Ko (dérivé du vrai logo)', () => {
    const fichier = 'public/visuels/logo-petit.webp'
    assert.ok(existsSync(new URL(`../${fichier}`, import.meta.url)))
    const o = octets(fichier)
    assert.equal(o.subarray(0, 4).toString('ascii'), 'RIFF')
    assert.equal(o.subarray(8, 12).toString('ascii'), 'WEBP')
    assert.equal(o.subarray(12, 15).toString('ascii'), 'VP8')
    const largeur = o.readUInt16LE(26) & 0x3fff
    const hauteur = o.readUInt16LE(28) & 0x3fff
    assert.equal(largeur, 192)
    assert.equal(hauteur, 192)
    assert.ok(statSync(new URL(`../${fichier}`, import.meta.url)).size < 10_000, 'variante légère < 10 Ko')
  })

  test('LogoCommerce : <picture> WebP d’abord, <img> PNG inchangée en repli — logo par défaut seulement', () => {
    const ui = lire('src/components/ui.tsx')
    assert.match(ui, /if \(logo === VISUELS\.logo\)/)
    assert.match(ui, /<picture className="block shrink-0">\s*<source srcSet=\{LOGO_DEFAUT_PETIT\} type="image\/webp" \/>\s*<img src=\{logo\} alt=\{`Logo \$\{commerce\.nom\}`\} className=\{`\$\{dims\} shrink-0 rounded-xl object-cover ring-1 ring-gray-200 bg-gray-950`\}/)
  })

  test('logo téléversé : branche inchangée (img simple, fond nuit, entier)', () => {
    const ui = lire('src/components/ui.tsx')
    assert.match(ui, /estLogoTeleverse\(logo\)[\s\S]*bg-nuit-950 object-contain/)
    // La branche téléversée retourne avant le <picture> : aucun <picture> ne l'entoure.
    const bloc = ui.slice(ui.indexOf('if (estLogoTeleverse(logo))'), ui.indexOf('if (logo === VISUELS.logo)'))
    assert.doesNotMatch(bloc, /<picture/)
  })

  test('constante LOGO_DEFAUT_PETIT documentée (hors VISUELS : garde > 10 Ko du test visuels)', () => {
    const visuels = lire('src/lib/visuels.ts')
    assert.match(visuels, /export const LOGO_DEFAUT_PETIT = '\/visuels\/logo-petit\.webp'/)
    assert.match(visuels, /Hors de VISUELS/)
    const sources = lire('public/visuels/SOURCES.md')
    assert.ok(sources.includes("logo du commerce dans l'app"), 'SOURCES.md mentionne l’usage LogoCommerce')
  })
})

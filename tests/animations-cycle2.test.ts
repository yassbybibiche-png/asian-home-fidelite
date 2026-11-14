// Boucle animations, cycle 2 — « typographie cinétique des moments » du menu Découverte (#/menu) : titre géant
// révélé mot à mot sur les en-têtes photo, mot fantôme en creux qui dérive derrière, révélation mot à mot à taille
// inchangée sur les en-têtes sans photo. Logique pure testée directement (src/lib/titreCinetique.ts) ; le .tsx et le
// CSS sont vérifiés sur le source (node --test n'importe pas le .tsx), comme les cycles précédents.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { motsTitre, plusLongMot } from '../src/lib/titreCinetique.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')
const css = lire('src/index.css')
const menu = lire('src/pages/MenuPublic.tsx')
/** Corps d'une règle CSS (sélecteur exact, première occurrence en début de ligne). */
const regle = (selecteur: string) => {
  const i = css.indexOf(`\n${selecteur} {`)
  assert.ok(i >= 0, `${selecteur} absent`)
  return css.slice(i, css.indexOf('\n}', i))
}
/** Bloc mouvement réduit du cycle 2 (celui qui suit la section du cycle). */
const blocReduitCycle2 = () => {
  const debut = css.indexOf('Boucle animations, cycle 2')
  assert.ok(debut > 0)
  const i = css.indexOf('@media (prefers-reduced-motion: reduce) {', debut)
  return css.slice(i, css.indexOf('\n}', i))
}

describe('Cycle 2 : découpage du nom (src/lib/titreCinetique.ts)', () => {
  test('mots dans l’ordre, espaces multiples ignorés', () => {
    assert.deepEqual(motsTitre('Entrées thaï'), ['Entrées', 'thaï'])
    assert.deepEqual(motsTitre('  Hors carte  (prix à confirmer) '), ['Hors', 'carte', '(prix', 'à', 'confirmer)'])
    assert.deepEqual(motsTitre(''), [])
  })

  test('plus long mot en caractères (accents comptés une fois), 1 au minimum', () => {
    assert.equal(plusLongMot('Maki Neige x6'), 5)
    assert.equal(plusLongMot('Spécialités du chef'), 11)
    assert.equal(plusLongMot('Entrées thaï'), 7)
    assert.equal(plusLongMot(''), 1)
  })
})

describe('Cycle 2 : en-têtes de catégorie (MenuPublic.tsx)', () => {
  test('sémantique intacte : h2 inchangé, sr-only sur les catégories photo, attributs conservés', () => {
    assert.match(menu, /<div className=\{photo \? 'sr-only' : 'flex flex-wrap items-center gap-2'\}>\s*<h2 className="font-titre text-xl font-bold">\{c\.nom\}<\/h2>/)
    assert.equal(menu.match(/<h2 /g)?.length, 1, 'un seul h2 par catégorie')
    assert.match(menu, /<section key=\{c\.id\} id=\{`m-\$\{c\.id\}`\} data-categorie=\{c\.id\}/)
    assert.match(menu, /<div className="relative h-56 overflow-hidden rounded-3xl shadow-relief" data-revelation>/)
  })

  test('photo : titre géant révélé mot à mot, taille réglée sur le plus long mot, décoratif', () => {
    assert.match(menu, /<span aria-hidden="true" className="titre-cadre absolute inset-x-5 bottom-4 flex flex-wrap items-end gap-2">\s*\{\/\*[^]*?\*\/\}\s*<span className="titre-geant text-white" style=\{\{ '--lettres': plusLongMot\(c\.nom\) \} as CSSProperties\}>\s*<MotsReveles nom=\{c\.nom\} \/>/)
  })

  test('photo : mot fantôme aria-hidden derrière le titre (avant lui dans le cadre)', () => {
    const fantome = menu.indexOf('<span aria-hidden="true" className="titre-fantome">')
    const titre = menu.indexOf('className="titre-geant')
    assert.ok(fantome > 0 && fantome < titre)
    assert.match(menu, /<span aria-hidden="true" className="titre-fantome">\s*<span className="titre-logo text-2xl text-white">\{c\.nom\}<\/span>\s*<\/span>/)
  })

  test('sans photo : calque mot à mot décoratif à taille inchangée (mêmes classes que le h2), révélé au défilement', () => {
    assert.match(menu, /\{!photo && \(\s*<span aria-hidden="true" className="titre-calque font-titre text-xl font-bold" data-revelation>\s*<MotsReveles nom=\{c\.nom\} \/>/)
  })

  test('mots : chacun dans son masque, séparés par une espace (retour à la ligne naturel)', () => {
    assert.match(menu, /function MotsReveles\(\{ nom \}: \{ nom: string \}\) \{\s*return motsTitre\(nom\)\.map\(\(mot, i\) => \(\s*<Fragment key=\{i\}>\s*\{i > 0 && ' '\}\s*<span className="mot-masque">\s*<span className="mot">\{mot\}<\/span>/)
  })

  test('révélation : mécanisme existant (preparerRevelations), aucun nouvel observateur', () => {
    assert.match(menu, /preparerRevelations\(liste\.current, dependancesNavigateur\(\)\)/)
    assert.equal(menu.match(/new IntersectionObserver/g)?.length, 1, 'seul l’observateur des onglets existait déjà')
  })
})

describe('Cycle 2 : CSS (src/index.css)', () => {
  test('masque par mot ; montée translateY → 0 en ~700 ms, 70 ms d’écart par mot', () => {
    assert.match(regle('.mot-masque'), /display: inline-block;\s*overflow: hidden;/)
    assert.match(regle('.revelation-attente .mot'), /transform: translateY\(130%\);/)
    assert.match(regle('.revelation-faite .mot'), /transition: transform 0\.7s cubic-bezier\(0\.22, 1, 0\.36, 1\) 0\.15s;/)
    const delais = [...css.matchAll(/\.revelation-faite \.mot-masque:nth-child\([^)]+\) \.mot \{\s*transition-delay: ([\d.]+)s;/g)].map((m) => Math.round(Number(m[1]) * 1000))
    assert.deepEqual(delais, [220, 290, 360, 430, 500])
  })

  test('titre géant : taille fluide clamp(2,6 → 4,6 rem) plafonnée par le plus long mot (cqw)', () => {
    assert.match(regle('.titre-cadre'), /container-type: inline-size;/)
    assert.match(regle('.titre-geant'), /font-size: min\(clamp\(2\.6rem, 13vw, 4\.6rem\), calc\(100cqw \/ \(var\(--lettres, 8\) \* 0\.8\)\)\);/)
  })

  test('fantôme : plus grand, en creux, dérive transform seul ~20 s en alternance, sans pointeur', () => {
    const f = regle('.titre-fantome')
    assert.match(f, /pointer-events: none;/)
    assert.match(f, /animation: fantome-derive 20s ease-in-out infinite alternate;/)
    assert.match(css, /@keyframes fantome-derive \{\s*from \{\s*transform: translateX\(3%\);\s*\}\s*to \{\s*transform: translateX\(-12%\);/)
    assert.match(regle('.titre-fantome .titre-logo'), /color: transparent;\s*-webkit-text-stroke: 1px rgb\(255 255 255 \/ 0\.\d+\);/)
  })

  test('sans photo : h2 transparent sous le calque (avec :has seulement), calque sans fondu propre', () => {
    assert.match(css, /@supports selector\(:has\(\*\)\) \{\s*\[data-categorie\] > div:has\(> \.titre-calque\) \{\s*position: relative;/)
    assert.match(css, /\[data-categorie\] > div:has\(> \.titre-calque\) > h2 \{\s*color: transparent;/)
    assert.match(css, /@supports not selector\(:has\(\*\)\) \{\s*\.titre-calque \{\s*display: none;/)
    assert.match(regle('.titre-calque.revelation-attente'), /opacity: 1;\s*transform: none;/)
  })

  test('aucune dimension animée : transitions et images clés du cycle en transform seulement', () => {
    const debut = css.indexOf('Boucle animations, cycle 2')
    const section = css.slice(debut, css.indexOf('@media (prefers-reduced-motion: reduce)', debut))
    for (const m of section.matchAll(/transition: (\w[\w-]*)/g)) assert.equal(m[1], 'transform')
    assert.doesNotMatch(section, /transition: (?:height|width|font-size|top|left)/)
  })

  test('mouvement réduit : aucun masque, aucune transition de mot, fantôme immobile — avant le dernier bloc', () => {
    const bloc = blocReduitCycle2()
    assert.match(bloc, /\.titre-fantome \{\s*animation: none;/)
    assert.match(bloc, /\.revelation-attente \.mot \{\s*transform: none;/)
    assert.match(bloc, /\.revelation-faite \.mot \{\s*transition: none;/)
    assert.ok(css.indexOf('Boucle animations, cycle 2') < css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    assert.notEqual(css.indexOf(bloc), css.lastIndexOf('@media (prefers-reduced-motion: reduce) {'), 'le dernier bloc reste celui des cycles précédents')
  })

  test('Commande et Cuisine intactes', () => {
    for (const f of ['src/pages/Commande.tsx', 'src/pages/Cuisine.tsx']) assert.doesNotMatch(lire(f), /titre-geant|titre-fantome|titre-calque|MotsReveles|mot-masque/, f)
  })
})

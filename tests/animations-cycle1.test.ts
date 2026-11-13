// Boucle animations, cycle 1 — « univers par catégorie » du menu Découverte (#/menu) : couche d'ambiance fixe à
// deux calques croisés, 6 univers sombres attribués par rang de catégorie, en-tête de la catégorie active mis en
// valeur, mouvement réduit coupé. Logique pure testée directement (src/lib/univers.ts) ; le .tsx et le CSS sont
// vérifiés sur le source (node --test n'importe pas le .tsx), comme les lots précédents.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { croiserCouches, NB_UNIVERS, universCategorie, type Couches } from '../src/lib/univers.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')
const css = lire('src/index.css')
const menu = lire('src/pages/MenuPublic.tsx')
/** Corps d'une règle CSS (sélecteur exact, première occurrence hors @media). */
const regle = (selecteur: string) => {
  const i = css.indexOf(`\n${selecteur} {`)
  assert.ok(i >= 0, `${selecteur} absent`)
  return css.slice(i, css.indexOf('\n}', i))
}

describe('Cycle 1 : attribution des univers (src/lib/univers.ts)', () => {
  const ids = ['entrees', 'sushis', 'makis', 'woks', 'bo-bun', 'desserts', 'boissons', 'menu-midi']

  test('par rang de catégorie, en cycle 0 → 5', () => {
    assert.equal(NB_UNIVERS, 6)
    assert.deepEqual(ids.map((id) => universCategorie(ids, id)), [0, 1, 2, 3, 4, 5, 0, 1])
  })

  test('haut de page (aucune catégorie en vue) ou catégorie inconnue : univers 0, la base magenta', () => {
    assert.equal(universCategorie(ids, null), 0)
    assert.equal(universCategorie(ids, 'inconnue'), 0)
    assert.equal(universCategorie([], 'sushis'), 0)
  })

  test('deux calques : le nouvel univers est posé sur le calque caché, qui passe devant', () => {
    let c: Couches = { a: 0, b: 0, devant: 'a' }
    c = croiserCouches(c, 2)
    assert.deepEqual(c, { a: 0, b: 2, devant: 'b' })
    c = croiserCouches(c, 4)
    assert.deepEqual(c, { a: 4, b: 2, devant: 'a' })
    // Même univers : aucun changement (même objet, React ne re-rend pas).
    assert.equal(croiserCouches(c, 4), c)
  })
})

describe('Cycle 1 : couche d’ambiance (MenuPublic.tsx, source)', () => {
  test('couche fixe aria-hidden, deux calques d’univers croisés, contenu au-dessus', () => {
    assert.match(menu, /<div aria-hidden="true" className="ambiance-univers" data-ambiance>/)
    assert.match(menu, /<div className=\{`ambiance-couche univers-\$\{couches\.a\}`\} data-visible=\{couches\.devant === 'a'\} \/>/)
    assert.match(menu, /<div className=\{`ambiance-couche univers-\$\{couches\.b\}`\} data-visible=\{couches\.devant === 'b'\} \/>/)
    assert.match(menu, /useEffect\(\(\) => setCouches\(\(c\) => croiserCouches\(c, univers\)\), \[univers\]\)/)
    // La couche précède le contenu, posé au-dessus (z-[1]).
    assert.match(menu, /<AmbianceUnivers univers=\{univers\} \/>\s*<div className="relative z-\[1\] mx-auto max-w-md space-y-5 px-4 pt-6 pb-10">/)
  })

  test('l’ambiance suit l’onglet indiqué (section en vue en « Toutes », catégorie filtrée sinon), rang sur la carte complète', () => {
    assert.match(menu, /const idsCategories = useMemo\(\(\) => menuAffiche\.categories\.filter\(\(c\) => c\.produits\.length\)\.map\(\(c\) => c\.id\), \[menuAffiche\]\)/)
    assert.match(menu, /const univers = universCategorie\(idsCategories, ongletIndique\)/)
    assert.match(menu, /const ongletIndique = active === 'toutes' \? enVue : active/)
  })

  test('en-tête de la catégorie active : marqueur conditionnel sur la section', () => {
    assert.match(menu, /data-categorie=\{c\.id\} data-univers-actif=\{ongletIndique === c\.id \|\| undefined\}/)
  })

  test('mode Commande, Cuisine et Vitrine : aucune ambiance d’univers', () => {
    for (const f of ['src/pages/Commande.tsx', 'src/pages/Cuisine.tsx', 'src/pages/Vitrine.tsx']) {
      assert.doesNotMatch(lire(f), /ambiance|univers|MenuAffiche|MenuPublic/, f)
    }
    // Le module n'est importé que par la page différée du menu (hors bundle initial).
    for (const f of ['src/App.tsx', 'src/store.tsx', 'src/pages/Jouer.tsx', 'src/pages/Bienvenue.tsx']) {
      assert.doesNotMatch(lire(f), /lib\/univers/, f)
    }
  })
})

describe('Cycle 1 : palettes et mouvements (src/index.css)', () => {
  test('couche fixe derrière le contenu, sans interaction, fondu de 900 ms entre calques', () => {
    const base = regle('.ambiance-univers')
    for (const d of ['position: fixed;', 'inset: 0;', 'z-index: 0;', 'pointer-events: none;', 'background-color: var(--color-nuit-950);']) assert.ok(base.includes(d), d)
    assert.match(regle('.ambiance-couche'), /opacity: 0;\s*transition: opacity 0\.9s ease-in-out;/)
    assert.match(regle(".ambiance-couche[data-visible='true']"), /opacity: 1;/)
  })

  test('6 univers sombres en dégradés radiaux translucides (le noir reste dominant, base magenta du thème)', () => {
    for (let i = 0; i < NB_UNIVERS; i++) {
      const r = regle(`.univers-${i}`)
      const degrades = [...r.matchAll(/radial-gradient\([^;]*?(?:\/ (0\.\d+)\)|(\d+)%, transparent\)), transparent 70%\)/g)]
      assert.equal(degrades.length, 2, `.univers-${i}`)
      for (const d of degrades) {
        const alpha = d[1] ? Number(d[1]) : Number(d[2]) / 100
        assert.ok(alpha > 0 && alpha <= 0.46, `.univers-${i} : opacité ${alpha} (teinte sombre seulement)`)
      }
    }
    assert.match(regle('.univers-0'), /var\(--color-magenta-700\)/)
    assert.equal(css.match(/\n\.univers-\d \{/g)?.length, NB_UNIVERS)
  })

  test('titre actif posé (scale 1,04 → 1), photo active en zoom lent 20 s (1 → 1,06), transform / scale seulement', () => {
    assert.match(css, /@keyframes univers-pose \{\s*from \{\s*scale: 1\.04;\s*\}\s*to \{\s*scale: 1;/)
    assert.match(regle('[data-univers-actif] .titre-logo'), /animation: univers-pose 0\.9s/)
    assert.match(regle('[data-categorie] .ken-burns img'), /animation: none;\s*transition: transform 1\.5s ease-out;/)
    assert.match(regle('[data-univers-actif] .ken-burns img'), /transform: scale\(1\.06\);\s*transition: transform 20s linear;/)
  })

  test('mouvement réduit : ni fondu, ni pose, ni zoom — bloc placé avant le dernier bloc mouvement réduit du fichier', () => {
    const i = css.indexOf('/* Mouvement réduit : univers changé sans fondu')
    assert.ok(i >= 0)
    const bloc = css.slice(i, css.indexOf('\n}\n', i))
    assert.match(bloc, /\.ambiance-couche \{\s*transition: none;/)
    assert.match(bloc, /\[data-univers-actif\] \.titre-logo \{\s*animation: none;/)
    assert.match(bloc, /\[data-categorie\] \.ken-burns img,\s*\[data-univers-actif\] \.ken-burns img \{\s*transform: none;\s*transition: none;/)
    assert.ok(i < css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
  })
})

// Expérience 10/10, lot 4 — onglet « Cuisine » masqué quand le module commande est désactivé (bureau : en-tête de
// App.tsx ; téléphone : liste de l'écran Plus). L'écran #/cuisine reste atteignable par son URL et explique comment
// activer le module. Vérifié sur la source (patron des lots 2–3) : la page ne se rend pas sans store.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { lireRoute, PAGES_PUBLIQUES } from '../src/router.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (f: string) => readFileSync(join(RACINE, f), 'utf8')

describe('Lot 4 — onglet Cuisine masqué si le module est désactivé', () => {
  const app = lire('src/App.tsx')
  const plus = lire('src/pages/Plus.tsx')

  test('bureau : l’onglet Cuisine n’est rendu que si commerce.commande?.active', () => {
    assert.match(app, /\{ONGLETS\.map\(\(o\) => o\.page == 'cuisine' && !commerce\.commande\?\.active \? null : \(\s*<a/)
    // Un seul rendu des onglets bureau, et c'est celui-là (pas de seconde liste qui afficherait Cuisine sans condition).
    assert.equal(app.match(/ONGLETS\.map\(/g)?.length, 1)
  })

  test('téléphone : l’entrée Cuisine de l’écran Plus n’est listée que si le module est actif', () => {
    assert.match(plus, /\{LIENS\.filter\(\(l\) => l\.page !== 'cuisine' \|\| commerce\.commande\?\.active\)\.map\(\(l\) => \(/)
    assert.doesNotMatch(plus, /\{LIENS\.map\(/)
    // La barre du bas ne liste pas Cuisine (elle passe par Plus).
    assert.doesNotMatch(app.match(/const ONGLETS_MOBILE[\s\S]*?\n\]/)![0], /cuisine/)
  })

  test('#/cuisine reste atteignable par son URL, avec l’écran explicatif si le module est désactivé', () => {
    assert.deepEqual(lireRoute('#/cuisine'), { page: 'cuisine', param: undefined })
    assert.ok(!PAGES_PUBLIQUES.includes('cuisine'))
    assert.match(app, /\n {2}cuisine: Cuisine,/)
    assert.match(lire('src/pages/Cuisine.tsx'), /if \(!commerce\.commande\?\.active\) \{/)
    // Le lien des Réglages « Commande à table » mène toujours à l'écran.
    assert.match(lire('src/components/ReglagesCommande.tsx'), /href="#\/cuisine"/)
  })
})

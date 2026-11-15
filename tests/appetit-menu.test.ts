// Mission « Menu Appétit », lot 3 (14/11/2026) : menu Découverte (#/menu) — rail « Signatures », lignes typographiques
// numérotées pour les plats sans photo. La séquence épinglée « photo d'en-tête → PlatStar → <ul> » reste couverte par
// tests/animations-cycle3.test.ts (non dupliquée ici).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { numerosPlats } from '../src/lib/menuClient.ts'
import { traduire } from '../src/lib/langue.ts'
import type { CategorieMenu } from '../src/types.ts'

const lire = (chemin: string) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')
const plat = (id: string) => ({ id, nom: id, prix: 100, allergenes: [] })
const categorie = (id: string, ...ids: string[]): CategorieMenu => ({ id, nom: id, produits: ids.map(plat) })

describe('numerosPlats : numérotation continue de la carte', () => {
  test('1..N dans l’ordre des catégories puis des plats', () => {
    const n = numerosPlats([categorie('a', 'p1', 'p2'), categorie('b'), categorie('c', 'p3'), categorie('d', 'p4', 'p5')])
    assert.deepEqual([...n], [['p1', 1], ['p2', 2], ['p3', 3], ['p4', 4], ['p5', 5]])
  })

  test('aucune catégorie → map vide', () => {
    assert.equal(numerosPlats([]).size, 0)
  })

  test('numéros fixés par l’ordre d’entrée : même carte → mêmes numéros ; un plat ajouté en fin ne décale rien', () => {
    const carte = [categorie('a', 'x', 'y'), categorie('b', 'z')]
    assert.deepEqual([...numerosPlats(carte)], [...numerosPlats(carte)])
    const avant = numerosPlats(carte)
    const apres = numerosPlats([...carte, categorie('c', 'w')])
    for (const [id, num] of avant) assert.equal(apres.get(id), num, id)
    assert.equal(apres.get('w'), 4)
    // Ordre inversé en entrée → numéros inversés : la fonction ne trie rien.
    assert.deepEqual([...numerosPlats([...carte].reverse())], [['z', 1], ['x', 2], ['y', 3]])
  })
})

describe('MenuPublic.tsx (source) : rail « Signatures »', () => {
  const menu = lire('src/pages/MenuPublic.tsx')
  const i = menu.indexOf('data-rail-signatures')
  const rail = menu.slice(menu.lastIndexOf('<section', i), menu.indexOf('</section>', i))

  test('section marquée data-rail-signatures, aria-label « En photos » conservé, titre visible « Signatures »', () => {
    assert.ok(i > 0)
    assert.ok(rail.startsWith("<section aria-label={t('En photos')}"))
    assert.match(rail, /<p className="font-titre text-lg font-bold">\s*<span aria-hidden="true">★ <\/span>\s*\{t\('Signatures'\)\}\s*<\/p>/)
    assert.doesNotMatch(rail, /<p [^>]*>\{t\('En photos'\)\}<\/p>/, 'ancien titre visible retiré')
    // Dans le dictionnaire initial : identite-accessibilite-p2-q1 exige chaque t('…') littéral de MenuPublic dans
    // TRADUCTIONS_EN (même libellé anglais que le rail de la Commande, lot 2).
    assert.equal(traduire('Signatures', 'en'), 'Signatures')
  })

  test('tuile : pastille « ★ Signature » des cartes, posée sur la photo, seulement pour un plat signature', () => {
    assert.match(
      rail,
      /\{estSignature\(p\.nom\) && \(\s*<span className="absolute top-2 left-2 rounded-full bg-magenta-500 px-2 py-0\.5 text-xs font-bold tracking-wide text-white uppercase">\{t\('★ Signature'\)\}<\/span>/,
    )
    // Rien d'autre ne change : même liste, même ordre (platsPhoto), mêmes pilotes.
    assert.match(rail, /\{platsPhoto\.map\(\(\{ categorieId, p \}\) => \(/)
    assert.match(menu, /defilerRail\(rail\.current, prefereMouvementReduit\(\)\)/)
    assert.match(menu, /animerRailVivant\(rail\.current, prefereMouvementReduit\(\)\)/)
  })
})

describe('MenuPublic.tsx (source) : lignes typographiques des plats sans photo', () => {
  const menu = lire('src/pages/MenuPublic.tsx')
  const debut = menu.indexOf('if (!p.photo && !p.illustration)')
  const ligne = menu.slice(debut, menu.indexOf('</li>', debut))

  test('numéros calculés sur la carte complète (avant recherche et onglet), affichés sur la seule ligne typo', () => {
    assert.match(menu, /const numeros = useMemo\(\(\) => numerosPlats\(menuAffiche\.categories\), \[menuAffiche\]\)/)
    assert.equal(menu.match(/numeros\.get\(/g)?.length, 1)
    assert.match(ligne, /numeros\.get\(p\.id\)/)
  })

  test('plat sans photo → <li data-ligne-typo> (ancre plat-<id>) dans l’UNIQUE liste de la catégorie ; plat photo → carte', () => {
    assert.equal(menu.match(/<ul className="cartes-echelonnees space-y-2">/g)?.length, 1)
    assert.match(ligne, /<li key=\{p\.id\} id=\{`plat-\$\{p\.id\}`\} className="ligne-typo [^"]*" data-revelation data-ligne-typo>/)
    assert.doesNotMatch(ligne, /(?<![:\w-])bg-white(?![\w/-])|rounded-3xl|shadow-douce|<img/, 'pas de carte blanche ni d’image')
    // La carte photo reste après la branche typo, inchangée.
    assert.ok(menu.indexOf('className="overflow-hidden rounded-3xl bg-white shadow-douce ring-1 ring-gray-900/5" data-revelation>') > debut)
  })

  test('rangée : bouton aria-expanded qui ouvre la fiche, nom font-titre, pastilles, pointillés, prix ou « Prix sur place », chevron', () => {
    assert.match(ligne, /<button\s+type="button"\s+className="[^"]*"\s+aria-expanded=\{detail\}\s+onClick=\{\(\) => setOuvert\(detail \? null : p\.id\)\}\s*>/)
    assert.match(ligne, /<span className="font-titre [^"]*text-white">\{p\.nom\}<\/span>\s*\{pastilles\}/)
    assert.match(ligne, /<span aria-hidden="true" className="[^"]*flex-1 border-b border-dotted border-white\/25" \/>/)
    assert.match(ligne, /\{t\('Prix sur place'\)\}/)
    assert.match(ligne, /className="ligne-typo__prix [^"]*">\{formaterPrix\(p\.prix\)\}/)
    assert.match(ligne, /\{p\.description && !detail && <span className="[^"]*line-clamp-2 [^"]*text-white\/70">\{p\.description\}<\/span>\}/)
    assert.match(ligne, /<span aria-hidden="true" className="chevron-detail shrink-0 text-gray-400">/)
  })

  test('pastilles et fiche dépliée : un seul code, partagé par la carte et la ligne', () => {
    assert.equal(menu.match(/<div className="depliage border-t border-gray-100">/g)?.length, 1)
    assert.equal(menu.match(/const fiche = detail && \(/g)?.length, 1)
    assert.equal(menu.match(/\{fiche\}/g)?.length, 2)
    assert.equal(menu.match(/\{pastilles\}/g)?.length, 2)
    assert.equal(menu.match(/title=\{t\('Déduit de la description — \{mention\}'/g)?.length, 1)
  })

  test('couleurs : prix magenta-300 par la feuille (texte large gras), fiche voilée sur le fond d’univers', () => {
    const css = lire('src/index.css')
    assert.match(css, /\.ligne-typo__prix \{\s*color: var\(--color-magenta-300\);/)
    assert.match(css, /\.ligne-typo \.depliage \{[^}]*background-color: color-mix\(in srgb, var\(--color-nuit-950\) 60%, transparent\);/)
    assert.match(ligne, /ligne-typo__prix shrink-0 text-lg font-bold/)
  })
})

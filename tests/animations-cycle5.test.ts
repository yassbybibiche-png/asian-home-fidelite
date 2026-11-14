// Boucle animations, cycle 5 — « transitions de navigation » des pages Découverte (#/bienvenue, #/menu) : la page entrante
// monte en fondu après une navigation interne, JAMAIS au premier chargement (QR de table → #/menu direct). Mécanisme :
// le routeur pose `navigue` sur <html> au premier `hashchange` (src/router.ts, `apresNavigation`), le CSS n'anime que sous
// cette classe. Changement d'onglet du menu : même entrée, plus rapide, rejouée sur la liste (src/lib/entreeScene.ts).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { rejouerEntree, suiviOnglet } from '../src/lib/entreeScene.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')
const routeur = lire('src/router.ts')
const menu = lire('src/pages/MenuPublic.tsx')
const bienvenue = lire('src/pages/Bienvenue.tsx')
const css = lire('src/index.css')

/** Tous les fichiers .ts/.tsx de src/. */
function sources(dossier = join(RACINE, 'src')): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) return sources(chemin)
    return /\.tsx?$/.test(nom) ? [chemin] : []
  })
}

/** Bloc CSS du cycle 5 : du commentaire d'en-tête jusqu'au dernier bloc mouvement réduit. */
const debutBloc = css.indexOf('Boucle animations, cycle 5')
const blocCycle5 = css.slice(debutBloc, css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))

describe('Cycle 5 : « déjà navigué » vit dans le routeur (jamais au premier chargement)', () => {
  test('importer le routeur et lire la route ne marque rien ; apresNavigation pose `navigue` sur <html> et remonte en haut', async () => {
    const classes = new Set<string>()
    const defilements: number[][] = []
    const g = globalThis as unknown as Record<string, unknown>
    const avant = { window: g.window, document: g.document }
    g.document = { documentElement: { classList: { add: (c: string) => classes.add(c) } } }
    g.window = { location: { hash: '#/menu/asian-home' }, scrollTo: (x: number, y: number) => defilements.push([x, y]) }
    try {
      const { apresNavigation, lireRoute } = await import('../src/router.ts')
      assert.deepEqual(lireRoute(), { page: 'menu', param: 'asian-home' })
      assert.equal(classes.size, 0, 'premier chargement : aucune classe posée')
      assert.equal(defilements.length, 0)
      apresNavigation()
      assert.deepEqual([...classes], ['navigue'])
      assert.deepEqual(defilements, [[0, 0]])
      apresNavigation()
      assert.deepEqual([...classes], ['navigue'], 'idempotent')
    } finally {
      g.window = avant.window
      g.document = avant.document
    }
  })

  test('apresNavigation n’est appelée QUE par le gestionnaire hashchange de useRoute (pas d’appel au montage)', () => {
    assert.match(
      routeur,
      /const surChangement = \(\) => \{\s*setRoute\(lireRoute\(\)\)\s*apresNavigation\(\)\s*\}\s*window\.addEventListener\('hashchange', surChangement\)/,
    )
    const appels = sources().flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/(?<!function )apresNavigation\(\)/g)].map(() => f))
    assert.deepEqual(appels.map((f) => f.slice(RACINE.length + 1)), ['src/router.ts'], 'un seul appel, dans le routeur')
    assert.equal([...routeur.matchAll(/(?<!function )apresNavigation\(\)/g)].length, 1)
    // L'état initial de la route est lu sans effet de bord.
    assert.match(routeur, /useState<Route>\(lireRoute\)/)
  })

  test('la classe `navigue` n’est posée nulle part ailleurs dans src/', () => {
    const poseurs = sources().filter((f) => /['"`]navigue['"`]/.test(readFileSync(f, 'utf8')))
    assert.deepEqual(poseurs.map((f) => f.slice(RACINE.length + 1)), ['src/router.ts'])
  })
})

describe('Cycle 5 : CSS de l’entrée en scène (src/index.css)', () => {
  test('keyframes `entree-page` : transform + opacity seulement, montée de 14 px depuis la transparence', () => {
    const k = css.match(/@keyframes entree-page \{([^]*?)\n\}/)
    assert.ok(k, 'keyframes entree-page présentes')
    assert.match(k[1], /opacity: 0;/)
    assert.match(k[1], /transform: translateY\(14px\);/)
    const proprietes = [...k[1].matchAll(/([a-z-]+):/g)].map((m) => m[1])
    assert.deepEqual([...new Set(proprietes)].sort(), ['opacity', 'transform'], 'CLS nul : aucune propriété de mise en page')
  })

  test('page entrante : 0,28 s, seulement sous html.navigue ; liste du menu : 0,18 s ; courbe du projet', () => {
    assert.match(blocCycle5, /\.navigue :is\(\.entree-page, \.ambiance-univers \+ div\) \{\s*animation: entree-page 0\.28s cubic-bezier\(0\.2, 0\.7, 0\.2, 1\);/)
    assert.match(blocCycle5, /\.entree-liste \{\s*animation: entree-page 0\.18s cubic-bezier\(0\.2, 0\.7, 0\.2, 1\);/)
    // Aucune règle n'anime `.entree-page` sans le préfixe `.navigue` (premier chargement jamais animé).
    for (const m of css.matchAll(/([^{}]*\.entree-page[^{}]*)\{([^}]*)\}/g)) {
      if (/animation:\s*entree-page/.test(m[2])) assert.match(m[1], /\.navigue /, m[1].trim())
    }
    assert.equal([...css.matchAll(/animation: entree-page/g)].length, 2)
  })

  test('aucun blocage d’interaction : ni pointer-events, ni remplissage persistant (`both`/`forwards`)', () => {
    assert.ok(debutBloc > 0)
    assert.doesNotMatch(blocCycle5, /pointer-events/)
    assert.doesNotMatch(blocCycle5, /animation: entree-page[^;]*(both|forwards|backwards)/)
  })

  test('mouvement réduit : les deux entrées sont coupées, AVANT le dernier bloc prefers-reduced-motion', () => {
    assert.match(
      blocCycle5,
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.navigue :is\(\.entree-page, \.ambiance-univers \+ div\),\s*\.entree-liste \{\s*animation: none;\s*\}\s*\}/,
    )
    assert.ok(debutBloc < css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
  })
})

describe('Cycle 5 : périmètre Découverte (#/bienvenue, #/menu) seulement', () => {
  test('accueil : racine de la page marquée `entree-page` (le héros et ses cascades dedans)', () => {
    assert.match(bienvenue, /<div ref=\{page\} className="entree-page">\s*<section className="hero-sombre/)
  })

  test('menu : le contenu suit directement le calque d’ambiance (cible `.ambiance-univers + div`), le calque fixe reste hors animation', () => {
    assert.match(menu, /<AmbianceUnivers univers=\{univers\} \/>\s*<div className="relative z-\[1\]/)
    assert.match(menu, /<div aria-hidden="true" className="ambiance-univers" data-ambiance>/)
  })

  test('les classes du cycle n’apparaissent dans aucune autre page (Commande, Cuisine, Caisse, Jouer, shell…)', () => {
    const porteurs = sources().filter((f) => /entree-page|entree-liste|ambiance-univers/.test(readFileSync(f, 'utf8')))
    assert.deepEqual(porteurs.map((f) => f.slice(RACINE.length + 1)).sort(), ['src/lib/entreeScene.ts', 'src/pages/Bienvenue.tsx', 'src/pages/MenuPublic.tsx', 'src/router.ts'])
    assert.equal([...bienvenue.matchAll(/entree-page/g)].length, 2, 'la classe + son commentaire')
    // Le routeur ne fait que la nommer dans son commentaire : aucune classe posée par le shell sur une page.
    assert.doesNotMatch(routeur.replace(/\/\*[^]*?\*\//g, ''), /entree-page/)
  })
})

describe('Cycle 5 : changement d’onglet du menu (src/lib/entreeScene.ts)', () => {
  test('suiviOnglet : le montage n’est pas un changement ; chaque nouvel onglet l’est, y compris le retour à l’initial', () => {
    const change = suiviOnglet('toutes')
    assert.equal(change('toutes'), false)
    assert.equal(change('toutes'), false, 'double effet (StrictMode) : rien')
    assert.equal(change('entrees'), true)
    assert.equal(change('entrees'), false)
    assert.equal(change('desserts'), true)
    assert.equal(change('toutes'), true)
  })

  test('rejouerEntree : retire la classe, force un recalcul (offsetWidth), la remet ; sans élément, rien', () => {
    const journal: string[] = []
    const el = {
      classList: { remove: (c: string) => journal.push(`-${c}`), add: (c: string) => journal.push(`+${c}`) },
      get offsetWidth() {
        journal.push('reflow')
        return 0
      },
    } as unknown as HTMLElement
    rejouerEntree(el)
    assert.deepEqual(journal, ['-entree-liste', 'reflow', '+entree-liste'])
    rejouerEntree(null)
    assert.equal(journal.length, 3)
  })

  test('branchement : suit l’onglet CHOISI (`categorie`), jamais la recherche ni l’onglet effectif ; même conteneur de liste', () => {
    assert.match(menu, /const \[ongletChange\] = useState\(\(\) => suiviOnglet\(categorie\)\)/)
    assert.match(menu, /useEffect\(\(\) => \{\s*if \(ongletChange\(categorie\)\) rejouerEntree\(liste\.current\)\s*\}, \[categorie\]\)/)
    // Révélations et parallaxe toujours branchées sur le même conteneur, avec leurs dépendances d'avant le cycle.
    assert.match(menu, /preparerRevelations\(liste\.current, dependancesNavigateur\(\)\) : undefined\), \[active, recherche, visibles\.length\]\)/)
    assert.match(menu, /activerParallaxe\(liste\.current, prefereMouvementReduit\(\)\) : undefined\), \[total === 0\]\)/)
    assert.match(menu, /<div ref=\{liste\} className="space-y-5">/)
    // La frappe dans la recherche ne touche pas l'onglet choisi.
    assert.match(menu, /onChange=\{\(e\) => \(setRecherche\(e\.target\.value\), setOuvert\(null\)\)\}/)
  })
})

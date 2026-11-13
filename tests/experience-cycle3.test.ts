// Expérience cycle 3, lot 1 — animations « niveau Ciao » sur les surfaces Découverte (#/bienvenue, #/menu) :
// bandeaux défilants, pastilles flottantes, ken burns, parallaxe, titres « moment » et cartes en cascade,
// micro-interactions. Logique pure testée directement (src/lib/parallaxe.ts, src/lib/bandeau.ts) ; les .tsx et le CSS
// sont vérifiés sur le source (node --test n'importe pas le .tsx), comme les lots précédents.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { activerParallaxe, deplacementParallaxe, FORCE_PARALLAXE, MAX_PARALLAXE } from '../src/lib/parallaxe.ts'
import { CATEGORIES_ASIAN_HOME, motsBandeauxAccueil, motsUniques, SIGNATURES_ASIAN_HOME } from '../src/lib/bandeau.ts'
import { menuReelAsianHome, PLATS_SIGNATURE } from '../src/data/menu-reel.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')
const css = lire('src/index.css')
const reduit = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
const accueil = lire('src/pages/Bienvenue.tsx')
const menu = lire('src/pages/MenuPublic.tsx')

describe('Cycle 3 : parallaxe (src/lib/parallaxe.ts)', () => {
  test('déplacement : retard sur le défilement, proportionnel à la force, borné à ±max, nul au centre', () => {
    assert.equal(deplacementParallaxe(400, 400, 0.12, 28), 0)
    // Cadre 100 px au-dessus du centre de la vue → l'image descend de 12 px (elle « traîne »).
    assert.equal(deplacementParallaxe(300, 400, 0.12, 28), 12)
    assert.equal(deplacementParallaxe(500, 400, 0.12, 28), -12)
    assert.equal(deplacementParallaxe(-2000, 400, 0.12, 28), 28)
    assert.equal(deplacementParallaxe(5000, 400, 0.12, 28), -28)
    assert.equal(deplacementParallaxe(401, 400, 0.12, 28), -0.1)
    assert.ok(Object.is(deplacementParallaxe(400.2, 400, 0.12, 28), 0), 'jamais -0')
    assert.equal(FORCE_PARALLAXE, 0.12)
    assert.equal(MAX_PARALLAXE, 28)
  })

  test('activation : écouteur passif, un calcul par image, cadre lu sur le parent, nettoyage complet', () => {
    const ecouteurs = new Map<string, { f: () => void; o: unknown }>()
    const images: (() => void)[] = []
    const annulees: number[] = []
    const g = globalThis as Record<string, unknown>
    const avant = { window: g.window, raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame }
    g.window = {
      innerHeight: 800,
      addEventListener: (n: string, f: () => void, o: unknown) => ecouteurs.set(n, { f, o }),
      removeEventListener: (n: string, f: () => void) => ecouteurs.get(n)?.f === f && ecouteurs.delete(n),
    }
    g.requestAnimationFrame = (f: () => void) => images.push(f)
    g.cancelAnimationFrame = (id: number) => annulees.push(id)
    try {
      // Cadre centré à 100 px au-dessus du centre de la vue ; un second, hors écran, n'est pas touché.
      let haut = 250
      const cible = (rect: () => { top: number; bottom: number; height: number }, force?: string) => ({
        style: { transform: '' },
        dataset: force ? { parallaxeForce: force } : {},
        parentElement: { getBoundingClientRect: rect },
        getBoundingClientRect: () => assert.fail('position lue sur l’élément déplacé'),
      })
      const visible = cible(() => ({ top: haut, bottom: haut + 100, height: 100 }))
      const forte = cible(() => ({ top: 250, bottom: 350, height: 100 }), '0.2')
      const loin = cible(() => ({ top: 3000, bottom: 3100, height: 100 }))
      const racine = { querySelectorAll: (s: string) => (assert.equal(s, '[data-parallaxe]'), [visible, forte, loin]) }
      const arreter = activerParallaxe(racine as unknown as ParentNode, false)
      assert.deepEqual(ecouteurs.get('scroll')?.o, { passive: true })
      assert.equal(images.length, 1, 'premier calcul planifié dès l’activation')
      images.shift()!()
      assert.equal(visible.style.transform, 'translateY(12px)')
      assert.equal(forte.style.transform, 'translateY(20px)')
      assert.equal(loin.style.transform, '', 'cadre hors écran : rien')
      // Plusieurs événements de défilement dans la même image → un seul calcul.
      haut = 450
      ecouteurs.get('scroll')!.f()
      ecouteurs.get('scroll')!.f()
      assert.equal(images.length, 1)
      images.shift()!()
      assert.equal(visible.style.transform, 'translateY(-12px)')
      ecouteurs.get('scroll')!.f()
      arreter()
      assert.equal(ecouteurs.size, 0, 'écouteurs scroll et resize retirés')
      assert.equal(annulees.length, 1, 'image en attente annulée')
      assert.equal(visible.style.transform, '')
      assert.equal(forte.style.transform, '')
    } finally {
      Object.assign(g, { window: avant.window, requestAnimationFrame: avant.raf, cancelAnimationFrame: avant.caf })
    }
  })

  test('mouvement réduit : ne fait rien (aucun écouteur, aucune image)', () => {
    const g = globalThis as Record<string, unknown>
    const avant = { window: g.window, raf: g.requestAnimationFrame }
    let appels = 0
    g.window = { innerHeight: 800, addEventListener: () => appels++, removeEventListener: () => appels++ }
    g.requestAnimationFrame = () => appels++
    try {
      const racine = { querySelectorAll: () => (appels++, []) }
      activerParallaxe(racine as unknown as ParentNode, true)()
      assert.equal(appels, 0)
    } finally {
      Object.assign(g, { window: avant.window, requestAnimationFrame: avant.raf })
    }
  })

  test('branchée sur l’accueil et le menu seulement (mouvement réduit transmis), jamais en mode Commande', () => {
    assert.match(accueil, /activerParallaxe\(page\.current, prefereMouvementReduit\(\)\)/)
    assert.match(menu, /activerParallaxe\(liste\.current, prefereMouvementReduit\(\)\)/)
    for (const f of ['src/pages/Commande.tsx', 'src/pages/Cuisine.tsx', 'src/pages/Jouer.tsx']) {
      assert.doesNotMatch(lire(f), /parallaxe|BandeauDefilant|bandeau-|flottant|ken-burns|\bpresse\b/, f)
    }
  })

  test('cadres prévus pour ne jamais montrer de bord : héros à 115 %, en-tête de catégorie débordant de 32 px (> 28)', () => {
    assert.match(accueil, /className="absolute inset-x-0 -top-\[7\.5%\] h-\[115%\] w-full object-cover" data-parallaxe \/>/)
    assert.match(menu, /<div className="relative h-56 overflow-hidden rounded-3xl shadow-relief" data-revelation>\s*\{\/\*[^]*?\*\/\}\s*<div className="cadre-parallaxe ken-burns absolute inset-x-0 -inset-y-8" data-parallaxe>/)
    assert.match(css, /\.cadre-parallaxe picture,\s*\.cadre-parallaxe img \{\s*height: 100%;/)
  })
})

describe('Cycle 3 : bandeaux défilants', () => {
  test('mots de l’accueil : plats signatures et familles de la carte réelle (Asian Home), rien ailleurs', () => {
    assert.deepEqual(SIGNATURES_ASIAN_HOME, [...PLATS_SIGNATURE], 'copie identique à menu-reel.ts')
    const carte = menuReelAsianHome()
    for (const c of CATEGORIES_ASIAN_HOME) {
      const reelle = carte.categories.some((k) => k.nom.startsWith(c)) || carte.categories.some((k) => k.produits.some((p) => p.nom.startsWith(c.replace(/s$/, ''))))
      assert.ok(reelle, `${c} : libellé présent sur la carte réelle`)
    }
    assert.deepEqual(motsBandeauxAccueil(true), { signatures: SIGNATURES_ASIAN_HOME, categories: CATEGORIES_ASIAN_HOME })
    assert.deepEqual(motsBandeauxAccueil(false), { signatures: [], categories: [] })
    assert.deepEqual(motsUniques(['Loc Lac', ' Dynamite ', 'Loc Lac', '']), ['Loc Lac', 'Dynamite'])
  })

  test('composant : deux copies exactement, la seconde aria-hidden, rien si aucun mot', () => {
    const c = lire('src/components/BandeauDefilant.tsx')
    assert.match(c, /if \(mots\.length === 0\) return null/)
    assert.match(c, /\{\[0, 1\]\.map\(\(copie\) =>/)
    assert.match(c, /aria-hidden=\{copie \? 'true' : undefined\}/)
    assert.match(c, /className=\{`bandeau-defilant overflow-hidden bg-nuit-950 py-4 text-white \$\{className\}`\}/)
    assert.match(c, /className="bandeau-moitie titre-logo text-lg"/)
    assert.match(c, /aria-hidden=\{libelle \? undefined : 'true'\}/, 'sans libellé : bandeau entièrement décoratif')
  })

  test('CSS : piste max-content, translateX(0 → -50 %) linéaire ~36 s, pause au survol et au focus', () => {
    assert.match(css, /@keyframes bandeau-defilement \{\s*from \{\s*transform: translateX\(0\);\s*\}\s*to \{\s*transform: translateX\(-50%\);/)
    assert.match(css, /\.bandeau-piste \{\s*display: flex;\s*width: max-content;\s*animation: bandeau-defilement 36s linear infinite;/)
    assert.match(css, /\.bandeau-defilant:hover \.bandeau-piste,\s*\.bandeau-defilant:focus-within \.bandeau-piste \{\s*animation-play-state: paused;/)
  })

  test('accueil : signatures entre le héros et les moments, catégories avant « À bientôt à table. »', () => {
    const heros = accueil.indexOf('</section>\n\n      <BandeauDefilant mots={bandeaux.signatures}')
    assert.ok(heros > 0 && heros < accueil.indexOf('<div id="moments">'))
    assert.match(accueil, /<BandeauDefilant mots=\{bandeaux\.categories\} libelle=\{t\('Au menu'\)\} className="bandeau-inverse" \/>\s*<section className="hero-sombre px-6 py-14 text-center" aria-labelledby="bienvenue-fin">/)
    assert.match(accueil, /const bandeaux = motsBandeauxAccueil\(asianHome\)/)
  })

  test('menu : bandeau des plats photographiés juste avant le rail, seulement quand le rail est affiché', () => {
    assert.match(menu, /\{avecRail && <BandeauDefilant mots=\{motsUniques\(platsPhoto\.map\(\(\{ p \}\) => p\.nom\)\)\} className="-mx-4" \/>\}\s*\{avecRail && \(\s*<section aria-label=\{t\('En photos'\)\}/)
  })
})

describe('Cycle 3 : mouvement sur l’accueil et le menu', () => {
  test('pastilles flottantes du héros : Asian Home seulement, décoratives, transform seulement (6 s / 7,5 s)', () => {
    const bloc = accueil.slice(accueil.indexOf('{asianHome && (\n          <>'), accueil.indexOf('</>', accueil.indexOf('{asianHome && (\n          <>')))
    for (const v of ['VISUELS.menuLocLacVignette', 'VISUELS.menuMangoStickyRiceVignette']) assert.ok(bloc.includes(v), v)
    assert.equal(bloc.match(/<img [^>]*alt="" aria-hidden="true" className="flottant[^"]*pointer-events-none absolute /g)?.length, 2)
    assert.ok(bloc.includes('flottant flottant-lent'))
    assert.match(css, /@keyframes flottement \{\s*from \{\s*transform: translateY\(-8px\);\s*\}\s*to \{\s*transform: translateY\(8px\);/)
    assert.match(css, /\.flottant \{\s*animation: flottement 6s ease-in-out infinite alternate;\s*\}\s*\.flottant-lent \{\s*animation-duration: 7\.5s;/)
  })

  test('ken burns (1 → 1.07, 16 s) sur les moments de l’accueil et les en-têtes de catégorie du menu', () => {
    assert.match(css, /@keyframes ken-burns \{\s*from \{\s*transform: scale\(1\);\s*\}\s*to \{\s*transform: scale\(1\.07\);/)
    assert.match(css, /\.ken-burns img \{\s*animation: ken-burns 16s ease-in-out infinite alternate;/)
    assert.match(accueil, /<picture className="ken-burns mt-6 block overflow-hidden rounded-3xl shadow-relief">/)
    assert.ok(menu.includes('cadre-parallaxe ken-burns'))
  })

  test('titres « moment » qui entrent en scène et cartes plats en cascade (plafond 240 ms)', () => {
    assert.match(css, /\.revelation-attente \.titre-logo \{\s*opacity: 0;\s*transform: translateX\(-28px\);/)
    assert.match(css, /\.revelation-faite \.titre-logo \{\s*transition:\s*opacity 0\.7s ease-out 0\.15s,/)
    assert.match(menu, /<ul className="cartes-echelonnees space-y-2">/)
    const delais = [...css.matchAll(/\.cartes-echelonnees > li\.revelation-faite:nth-child\([^)]+\) \{\s*transition-delay: (\d+)ms;/g)].map((m) => Number(m[1]))
    assert.deepEqual(delais, [60, 120, 180, 240])
  })

  test('micro-interactions : onglets, carte plat, boutons de l’accueil (classe locale, .bouton global intact)', () => {
    assert.match(menu, /className=\{`puce relative whitespace-nowrap active:scale-95 /)
    assert.match(menu, /text-left transition-transform active:scale-\[0\.99\] active:bg-gray-50"/)
    assert.equal(accueil.match(/<Actions commerce=\{commerce\} presse \/>/g)?.length, 2)
    assert.equal(accueil.match(/\$\{p\}`\}/g)?.length, 3)
    assert.match(css, /\.presse:active \{\s*scale: 0\.96;/)
    assert.doesNotMatch(css.slice(0, css.indexOf('Expérience cycle 3')), /\.presse\b/, '.bouton global non modifié')
  })

  test('mouvement réduit : toutes les nouvelles animations et transitions coupées', () => {
    for (const c of ['.bandeau-piste', '.flottant', '.ken-burns img', '.revelation-attente .titre-logo', '.revelation-faite .titre-logo', '.presse']) {
      assert.ok(reduit.includes(c), c)
    }
    assert.match(reduit, /\.depliage,\s*\.bandeau-piste,\s*\.flottant,\s*\.ken-burns img \{\s*animation: none;/)
  })
})

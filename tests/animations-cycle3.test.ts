// Boucle animations, cycle 3 — « plat-star plein cadre » du menu Découverte (#/menu) : chaque catégorie qui a un plat
// photographié le met en avant en très grand (photo du plat lui-même, nom, prix, description), entre son en-tête et sa
// liste ; la photo vit au défilement (parallaxe + zoom lent existants). Logique pure testée directement
// (src/lib/platStar.ts) ; le .tsx et le CSS sont vérifiés sur le source (node --test n'importe pas le .tsx).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { AGRANDISSEMENT_MAX_STAR, CADRE_STAR, DIMENSIONS_PHOTOS_PLATS, RATIO_CADRE_STAR, agrandissementStar, photoEligibleStar, platStar } from '../src/lib/platStar.ts'
import { lireEnTeteImage } from '../src/lib/logo.ts'
import { masquerPrixNonConfirmes, menuReelAsianHome, retirerPhotosDetachees } from '../src/data/menu-reel.ts'
import type { Produit } from '../src/types.ts'

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
/** Section CSS du cycle 3 (de son commentaire à son bloc mouvement réduit inclus). */
const sectionCycle3 = () => {
  const debut = css.indexOf('Boucle animations, cycle 3')
  assert.ok(debut > 0, 'section du cycle 3 absente')
  const reduit = css.indexOf('@media (prefers-reduced-motion: reduce) {', debut)
  return { avant: css.slice(debut, reduit), reduit: css.slice(reduit, css.indexOf('\n}', reduit)) }
}
/** Composant PlatStar (de sa déclaration au composant suivant). */
const composant = () => {
  const i = menu.indexOf('function PlatStar(')
  assert.ok(i > 0, 'PlatStar absent')
  return menu.slice(i, menu.indexOf('\nfunction ', i + 1))
}

const plat = (nom: string, photo?: string): Produit => ({ id: nom, nom, prix: 1000, allergenes: [], ...(photo ? { photo } : {}) })

describe('Cycle 3 : choix du plat-star (src/lib/platStar.ts)', () => {
  test('un plat signature photographié passe devant les autres plats photographiés', () => {
    const c = { produits: [plat('Bo Bun', '/b.webp'), plat('Pad Thaï', '/p.webp'), plat('Loc Lac', '/l.jpg')] }
    assert.equal(platStar(c)?.nom, 'Loc Lac')
  })

  test('sans signature photographiée : le premier plat photographié', () => {
    const c = { produits: [plat('Dynamite'), plat('Nems'), plat('Mango Stick', '/m.jpg'), plat('Perles coco', '/c.jpg')] }
    assert.equal(platStar(c)?.nom, 'Mango Stick', 'Dynamite est signature mais sans photo : écarté')
  })

  test('aucun plat photographié (ou photo vide) : null', () => {
    assert.equal(platStar({ produits: [plat('Nems'), { ...plat('Gyoza'), photo: '' }] }), null)
    assert.equal(platStar({ produits: [] }), null)
  })

  test('renvoie le plat lui-même (vraie photo, vrai nom, vrai prix, vraie description), jamais une copie', () => {
    const p = { ...plat('Poke Bowl', 'https://exemple.fr/poke.jpg'), description: 'Riz, saumon' }
    assert.equal(platStar({ produits: [p] }), p)
  })

  test('carte réelle : seules les photos qui supportent le plein cadre font un star (Plats thaï, Desserts)', () => {
    const m = retirerPhotosDetachees(masquerPrixNonConfirmes(menuReelAsianHome()))
    const stars = Object.fromEntries(m.categories.map((c) => [c.nom, platStar(c)?.nom ?? null]).filter(([, s]) => s))
    assert.deepEqual(stars, { 'Plats thaï': 'Loc Lac', Desserts: 'Mango Stick' })
    for (const c of m.categories) {
      const s = platStar(c)
      if (s) assert.ok(c.produits.includes(s) && s.photo, c.nom)
    }
  })
})

describe('Cycle 3 : seuil de résolution du plat-star (src/lib/platStar.ts)', () => {
  test('cadre de référence aligné sur .plat-star (clamp 20rem / 62vh / 34rem), ratio ≈ 0,73, seuil ×1,5', () => {
    assert.deepEqual(CADRE_STAR, { largeur: 380, hauteur: 520 })
    assert.ok(Math.abs(RATIO_CADRE_STAR - 380 / 520) < 1e-9)
    assert.equal(AGRANDISSEMENT_MAX_STAR, 1.5)
    assert.match(regle('.plat-star'), /height: clamp\(20rem, 62vh, 34rem\);/)
  })

  test('agrandissement : photo plus large que le cadre → hauteur limitante ; plus haute → largeur limitante', () => {
    assert.ok(Math.abs(agrandissementStar(1040, 520) - 1) < 1e-9, 'paysage, hauteur exacte : ×1')
    assert.ok(Math.abs(agrandissementStar(380, 2000) - 1) < 1e-9, 'portrait, largeur exacte : ×1')
    assert.ok(Math.abs(agrandissementStar(190, 260) - 2) < 1e-9, 'même ratio, moitié : ×2')
    assert.ok(Math.abs(agrandissementStar(341, 225) - 520 / 225) < 1e-9)
  })

  test('bornes : ×1,5 pile éligible, juste au-delà écarté', () => {
    const borne = 520 / 1.5 // hauteur limitante (paysage) donnant exactement ×1,5
    assert.equal(agrandissementStar(1000, borne), 1.5)
    assert.ok(agrandissementStar(1000, borne - 1) > 1.5)
    const t = DIMENSIONS_PHOTOS_PLATS as Record<string, readonly [number, number]>
    t['/test-borne.webp'] = [1000, borne]
    t['/test-au-dela.webp'] = [1000, borne - 1]
    try {
      assert.equal(photoEligibleStar('/test-borne.webp'), true)
      assert.equal(photoEligibleStar('/test-au-dela.webp'), false)
    } finally {
      delete t['/test-borne.webp']
      delete t['/test-au-dela.webp']
    }
  })

  test('photos réelles : Loc Lac (×0,72) et Mango Stick (×1,26) éligibles ; Dynamite (×2,3) et Poke Bowl (×3,9) écartés', () => {
    const f = (p: string) => agrandissementStar(...(DIMENSIONS_PHOTOS_PLATS[p] as [number, number]))
    assert.ok(f('/visuels/menu-loc-lac.jpg') < 0.75)
    assert.ok(f('/visuels/menu-mango-sticky-rice.jpg') < 1.3)
    assert.ok(f('/visuels/menu-dynamite.webp') > 2.3)
    assert.ok(f('/visuels/menu-poke-bowl.webp') > 3.9)
    for (const p of ['/visuels/menu-loc-lac.jpg', '/visuels/menu-mango-sticky-rice.jpg']) assert.equal(photoEligibleStar(p), true, p)
    for (const p of ['/visuels/menu-dynamite.webp', '/visuels/menu-poke-bowl.webp', '/visuels/menu-bo-bun.webp']) assert.equal(photoEligibleStar(p), false, p)
  })

  test('table : chaque photo de plat de la carte y figure, avec les dimensions RÉELLES du fichier', () => {
    const photos = new Set(menuReelAsianHome().categories.flatMap((c) => c.produits.flatMap((p) => (p.photo ? [p.photo] : []))))
    photos.add('/visuels/menu-makis.jpg') // détachée (P1-M3) mais encore présente dans des menus enregistrés
    assert.deepEqual([...photos].sort(), Object.keys(DIMENSIONS_PHOTOS_PLATS).sort())
    for (const [p, [l, h]] of Object.entries(DIMENSIONS_PHOTOS_PLATS)) {
      const infos = lireEnTeteImage(readFileSync(join(RACINE, 'public', p)))
      assert.deepEqual([infos?.largeur, infos?.hauteur], [l, h], p)
    }
  })

  test('photo inconnue de la table (URL d’un commerçant) : éligible par défaut', () => {
    assert.equal(photoEligibleStar('https://exemple.fr/photo-telephone.jpg'), true)
    assert.equal(platStar({ produits: [plat('Nems', 'https://exemple.fr/n.jpg')] })?.nom, 'Nems')
  })

  test('sélection parmi les éligibles : signature trop petite écartée au profit du suivant éligible', () => {
    const c = { produits: [plat('Dynamite', '/visuels/menu-dynamite.webp'), plat('Nems', '/visuels/menu-poke-bowl.webp'), plat('Gyoza', '/g.jpg'), plat('Bao', '/b.jpg')] }
    assert.equal(platStar(c)?.nom, 'Gyoza')
    const d = { produits: [plat('Mango Stick', '/visuels/menu-mango-sticky-rice.jpg'), plat('Loc Lac', '/visuels/menu-loc-lac.jpg')] }
    assert.equal(platStar(d)?.nom, 'Loc Lac', 'la signature éligible passe devant')
  })

  test('aucune photo éligible : null (pas de bloc)', () => {
    assert.equal(platStar({ produits: [plat('Dynamite', '/visuels/menu-dynamite.webp'), plat('Poke Bowl', '/visuels/menu-poke-bowl.webp')] }), null)
  })
})

describe('Cycle 3 : bloc plat-star (MenuPublic.tsx)', () => {
  test('entre l’en-tête de la catégorie et sa liste ; masqué pendant une recherche', () => {
    assert.match(menu, /const star = recherche \? null : platStar\(c\)/)
    assert.match(menu, /\{photo && \([^]*?<\/div>\s*\)\}\s*\{star && <PlatStar plat=\{star\} voir=\{\(\) => allerAuPlat\(c\.id, star\.id\)\} \/>\}\s*<ul className="cartes-echelonnees space-y-2">/)
  })

  test('un vrai bouton libellé « Voir le plat : {nom} », enfoncement tactile', () => {
    const b = composant()
    assert.match(b, /<button\s+type="button"\s+onClick=\{voir\}\s+aria-label=\{t\('Voir le plat : \{nom\}', \{ nom: plat\.nom \}\)\}/)
    assert.match(b, /className="relative block size-full overflow-hidden rounded-3xl [^"]*transition-transform active:scale-\[0\.98\]"/)
  })

  test('hauteur fixée par le cadre .plat-star, révélé au défilement', () => {
    assert.match(composant(), /<div className="plat-star" data-revelation data-plat-star>/)
  })

  test('photo du plat lui-même, paresseuse, en object-cover, dans le calque parallaxe + ken burns', () => {
    const b = composant()
    assert.match(b, /<span className="cadre-parallaxe ken-burns absolute inset-x-0 -inset-y-8" data-parallaxe>\s*<img src=\{plat\.photo\} alt="" loading="lazy" className="w-full object-cover" \/>/)
    assert.doesNotMatch(b, /photoCategorie|VISUELS/, 'jamais une image de catégorie ou d’ambiance')
  })

  test('nom géant révélé mot à mot, description 3 lignes max, prix, pastille Signature si signature', () => {
    const b = composant()
    assert.match(b, /<span className="titre-geant text-white" style=\{\{ '--lettres': plusLongMot\(plat\.nom\) \} as CSSProperties\}>\s*<MotsReveles nom=\{plat\.nom\} \/>/)
    assert.match(b, /\{plat\.description && <span className="line-clamp-3 [^"]*">\{plat\.description\}<\/span>\}/)
    assert.match(b, /\{plat\.prix == null \? <span className="text-sm italic">\{t\('Prix sur place'\)\}<\/span> : formaterPrix\(plat\.prix\)\}/)
    assert.match(b, /\{estSignature\(plat\.nom\) && \(\s*<span className="rounded-full bg-magenta-500[^"]*">\{t\('★ Signature'\)\}<\/span>/)
  })

  test('parallaxe et révélation : mécanismes existants, aucun nouvel observateur', () => {
    assert.match(menu, /activerParallaxe\(liste\.current, prefereMouvementReduit\(\)\)/)
    assert.equal(menu.match(/new IntersectionObserver/g)?.length, 1)
    assert.equal(menu.match(/<h2 /g)?.length, 1, 'le bloc n’ajoute aucun titre au plan de la page')
  })
})

describe('Cycle 3 : CSS (src/index.css)', () => {
  test('hauteur fixe bornée (vh entre deux rem) : jamais réglée par l’image', () => {
    assert.match(regle('.plat-star'), /^\n\.plat-star \{\s*height: clamp\(\d+rem, \d+vh, \d+rem\);$/)
  })

  test('entrée du calque photo en scale seul, aucune dimension animée', () => {
    assert.match(regle('.plat-star.revelation-attente .cadre-parallaxe'), /scale: 1\.\d+;/)
    assert.match(regle('.plat-star.revelation-faite .cadre-parallaxe'), /transition: scale 1\.4s/)
    const { avant } = sectionCycle3()
    for (const m of avant.matchAll(/transition: (\w[\w-]*)/g)) assert.match(m[1], /^(?:transform|scale)$/)
    assert.doesNotMatch(avant, /transition: (?:height|width|font-size|top|left|inset)/)
    assert.doesNotMatch(avant, /@keyframes/)
  })

  test('mouvement réduit : bloc statique — avant le dernier bloc mouvement réduit', () => {
    const { reduit } = sectionCycle3()
    assert.match(reduit, /\.plat-star \.cadre-parallaxe \{\s*scale: none;\s*transition: none;/)
    assert.ok(css.indexOf(reduit) < css.lastIndexOf('@media (prefers-reduced-motion: reduce) {'), 'le dernier bloc reste celui des cycles précédents')
    // Zoom lent et révélation déjà coupés par les blocs existants.
    assert.match(css, /\[data-categorie\] \.ken-burns img,\s*\[data-univers-actif\] \.ken-burns img \{\s*transform: none;\s*transition: none;/)
  })

  test('Commande et Cuisine intactes', () => {
    for (const f of ['src/pages/Commande.tsx', 'src/pages/Cuisine.tsx']) assert.doesNotMatch(lire(f), /PlatStar|platStar|plat-star/, f)
  })
})

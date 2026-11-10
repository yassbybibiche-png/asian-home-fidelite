// Vrai menu d'Asian Home Paris + interactivité du menu public + DA sombre :
// contenu exact (7 catégories, 39 plats, aucun prix inventé), photos rattachées
// aux bons plats, recherche/filtres, contrastes ≥ 4,5:1 des paires texte/fond utilisées.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'

import { COMPTE_CATEGORIES_REELLES, COMPTE_PLATS_REELS, PLATS_SIGNATURE, estSignature, menuReelAsianHome } from '../src/data/menu-reel.ts'
import { ID_ASIAN_HOME, VISUELS, photoCategorie } from '../src/lib/visuels.ts'
import { LIBELLE_PRIX_ABSENT, compterPlats, correspondPlat, filtrerMenu, validerMenu, ErreurMenu } from '../src/lib/menu.ts'
import { formaterPrix } from '../src/lib/points.ts'

const JSON_REEL = JSON.parse(readFileSync(new URL('../docs/menu-reel.json', import.meta.url), 'utf8')) as {
  categories: { nom: string; plats: { nom: string; prixCentimes: number | null; description: string; allergenes: string[]; photo: string | null }[] }[]
}

describe('Menu réel (docs/menu-reel.json → src/data/menu-reel.ts)', () => {
  test('7 catégories, 39 plats, noms et descriptions exacts (source Uber Eats)', () => {
    const menu = menuReelAsianHome()
    assert.equal(menu.commerceId, ID_ASIAN_HOME)
    assert.equal(COMPTE_CATEGORIES_REELLES, 7)
    assert.equal(COMPTE_PLATS_REELS, 39)
    assert.equal(menu.categories.length, JSON_REEL.categories.length)
    assert.equal(compterPlats(menu), 39)
    for (let i = 0; i < JSON_REEL.categories.length; i++) {
      assert.equal(menu.categories[i].nom, JSON_REEL.categories[i].nom)
      assert.equal(menu.categories[i].produits.length, JSON_REEL.categories[i].plats.length, menu.categories[i].nom)
      for (let j = 0; j < JSON_REEL.categories[i].plats.length; j++) {
        const reel = JSON_REEL.categories[i].plats[j]
        const plat = menu.categories[i].produits[j]
        assert.equal(plat.nom, reel.nom)
        // Tiramisu : cité dans des avis, absent de la carte Uber Eats — affiché sans
        // description inventée (la note « à confirmer » reste dans la doc, pas à l'écran).
        assert.equal(plat.description ?? '', reel.nom === 'Tiramisu' ? '' : reel.description)
        assert.deepEqual(plat.allergenes, [])
      }
    }
  })

  test('aucun prix inventé : les 39 plats sont à prix null, affichés « Prix sur place »', () => {
    const menu = menuReelAsianHome()
    for (const c of menu.categories) {
      for (const p of c.produits) {
        assert.equal(p.prix, null, p.nom)
        assert.equal(formaterPrix(p.prix), LIBELLE_PRIX_ABSENT)
      }
    }
    assert.equal(LIBELLE_PRIX_ABSENT, 'Prix sur place')
    assert.equal(formaterPrix(650), '6,50 €')
    // Le JSON source n'a lui non plus aucun prix.
    for (const c of JSON_REEL.categories) for (const p of c.plats) assert.equal(p.prixCentimes, null, p.nom)
  })

  test('le menu réel passe la validation serveur (prix null accepté) ; un prix non entier reste refusé', () => {
    const valide = validerMenu(menuReelAsianHome(), ID_ASIAN_HOME, new Date())
    assert.equal(compterPlats(valide), 39)
    assert.equal(valide.categories[0].produits[0].prix, null)
    assert.throws(() => validerMenu({ categories: [{ nom: 'E', produits: [{ nom: 'N', prix: 6.5, allergenes: [] }] }] }, ID_ASIAN_HOME, new Date()), ErreurMenu)
    assert.throws(() => validerMenu({ categories: [{ nom: 'E', produits: [{ nom: 'N', prix: -1, allergenes: [] }] }] }, ID_ASIAN_HOME, new Date()), ErreurMenu)
  })
})

describe('Photos rattachées aux bons plats (vraies photos du restaurant uniquement)', () => {
  const photoDe = (nom: string) => {
    for (const c of menuReelAsianHome().categories) {
      const p = c.produits.find((x) => x.nom === nom)
      if (p) return p.photo ?? null
    }
    return undefined
  }

  test('makis → menu-makis.jpg ; Loc Lac → menu-loc-lac.jpg ; Mango Stick → menu-mango-sticky-rice.jpg', () => {
    assert.equal(photoDe('8 Maki Dragon'), VISUELS.menuMakis)
    assert.equal(photoDe('8 Maki Tiger'), VISUELS.menuMakis)
    assert.equal(photoDe('Loc Lac'), VISUELS.menuLocLac)
    assert.equal(photoDe('Mango Stick'), VISUELS.menuMangoStickyRice)
  })
  test('Mi Prat → menu-nouilles-crevettes.jpg (identification probable, notée dans le code et la doc)', () => {
    assert.equal(photoDe('Mi Prat'), VISUELS.menuNouillesCrevettes)
  })
  test('menu-plat-riz.jpg n’est rattachée à aucun plat nommé (photo d’ambiance seulement)', () => {
    for (const c of menuReelAsianHome().categories) {
      for (const p of c.produits) assert.notEqual(p.photo, VISUELS.menuPlatRiz, p.nom)
    }
  })
  test('chaque photo de plat existe dans public/visuels/ et pèse ≤ 250 Ko', () => {
    const photos = new Set<string>()
    for (const c of menuReelAsianHome().categories) for (const p of c.produits) if (p.photo) photos.add(p.photo)
    assert.ok(photos.size >= 4)
    for (const chemin of photos) {
      const fichier = new URL(`../public${chemin}`, import.meta.url)
      assert.ok(existsSync(fichier), chemin)
      assert.ok(statSync(fichier).size <= 250_000, chemin)
    }
  })
  test('photos de catégories : thaï et desserts illustrés, les autres sans photo inventée', () => {
    assert.equal(photoCategorie('Côté thaï')?.src, VISUELS.menuPlatRiz)
    assert.equal(photoCategorie('Desserts')?.src, VISUELS.menuMangoStickyRice)
    assert.equal(photoCategorie('Côté Jap')?.src, VISUELS.sushisArdoise)
    assert.equal(photoCategorie('Nos Entrées'), null)
    assert.equal(photoCategorie('Asian Street Food'), null)
    assert.equal(photoCategorie('Nos Poke Bowl'), null)
  })
})

describe('Plats signature et recherche / filtres du menu public', () => {
  test('signatures : Dynamite, Thaï-sty Krusty, Duo Love Bao, Loc Lac, makis Dragon et Tiger', () => {
    assert.deepEqual([...PLATS_SIGNATURE], ['Dynamite', 'Thaï-sty Krusty', 'Duo Love Bao', 'Loc Lac', '8 Maki Dragon', '8 Maki Tiger'])
    for (const nom of PLATS_SIGNATURE) assert.equal(estSignature(nom), true, nom)
    assert.equal(estSignature('Choux'), false)
    assert.equal(estSignature('Pad Thai'), false)
  })

  test('recherche insensible aux accents et à la casse, sur le nom et la description', () => {
    const menu = menuReelAsianHome()
    const dynamite = menu.categories.flatMap((c) => c.produits).filter((p) => correspondPlat(p, 'dynamite'))
    assert.deepEqual(dynamite.map((p) => p.nom), ['Dynamite'])
    const makis = filtrerMenu(menu.categories, 'maki')
    assert.ok(makis.flatMap((c) => c.produits).some((p) => p.nom === '8 Maki Dragon'))
    assert.ok(makis.flatMap((c) => c.produits).some((p) => p.nom === 'Maki Pink par 6'))
    assert.equal(filtrerMenu(menu.categories, 'loc lac').flatMap((c) => c.produits).map((p) => p.nom).join(), 'Loc Lac')
    assert.equal(filtrerMenu(menu.categories, 'THAI').flatMap((c) => c.produits).length > 0, true)
    assert.equal(filtrerMenu(menu.categories, 'zzzintrouvable').length, 0)
    assert.equal(filtrerMenu(menu.categories, '').length, 7)
    assert.equal(compterPlats({ categories: filtrerMenu(menu.categories, '') }), 39)
  })
})

describe('DA sombre : contrastes texte/fond ≥ 4,5:1 (WCAG AA)', () => {
  // Contraste WCAG 2.1 : (L1 + 0,05) / (L2 + 0,05), luminances relatives.
  function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contraste = (a: string, b: string) => {
    const [clair, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (clair + 0.05) / (sombre + 0.05)
  }
  const NUIT = '#111111' // noir [ESTIMÉ] Instagram
  const OR = '#c9a227' // doré [ESTIMÉ] Instagram
  const LAQUE = '#b3262d' // rouge laque (valeur certifiée de la charte actuelle)

  test('titres dorés et texte blanc sur fond noir', () => {
    assert.ok(contraste('#ffffff', NUIT) >= 4.5, `blanc/noir : ${contraste('#ffffff', NUIT).toFixed(1)}`)
    assert.ok(contraste(OR, NUIT) >= 4.5, `or/noir : ${contraste(OR, NUIT).toFixed(1)}`)
    assert.ok(contraste('#f2d48a', NUIT) >= 4.5, `or clair/noir : ${contraste('#f2d48a', NUIT).toFixed(1)}`)
    assert.ok(contraste('#f5c2be', NUIT) >= 4.5, `laque claire/noir : ${contraste('#f5c2be', NUIT).toFixed(1)}`)
  })
  test('rouge laque conservé comme accent (texte blanc dessus, texte laque sur ivoire)', () => {
    assert.ok(contraste('#ffffff', LAQUE) >= 4.5, `blanc/laque : ${contraste('#ffffff', LAQUE).toFixed(1)}`)
    assert.ok(contraste('#7f1a1f', '#f7f5f2') >= 4.5, `laque foncée/ivoire : ${contraste('#7f1a1f', '#f7f5f2').toFixed(1)}`)
    assert.ok(contraste('#1f2937', '#f2d48a') >= 4.5, `encre/or clair (roue) : ${contraste('#1f2937', '#f2d48a').toFixed(1)}`)
  })
  test('texte doré foncé sur fond clair (badges, étoiles)', () => {
    assert.ok(contraste('#92400e', '#ffffff') >= 4.5, `amber-800/blanc : ${contraste('#92400e', '#ffffff').toFixed(1)}`)
    assert.ok(contraste('#92400e', '#fef3c7') >= 4.5, `amber-800/amber-100 : ${contraste('#92400e', '#fef3c7').toFixed(1)}`)
  })
})

// P1-M3 (préparation seulement) — Inventaire exact des photos des plats : 11 plats avec photo
// vérifiée, 70 sans photo (docs/PHOTOS-MANQUANTES.md) ; aucune photo inventée, aucune photo
// client ; la photo partagée menu-makis.jpg a été détachée (contribution client, deux plats).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'

import { menuReelAsianHome, retirerPhotosDetachees } from '../src/data/menu-reel.ts'
import { VISUELS } from '../src/lib/visuels.ts'

const plats = () => menuReelAsianHome().categories.flatMap((c) => c.produits)
const fichier = (chemin: string) => new URL(`../public${chemin}`, import.meta.url)
const doc = () => readFileSync(new URL('../docs/PHOTOS-MANQUANTES.md', import.meta.url), 'utf8')

// Liste exacte des 70 plats sans photo (ordre des catégories du menu) ; le test compare trié.
const SANS_PHOTO = [
  'Choux', 'Edamame', 'Wakame', 'Soupe Miso', 'Riz Nature', 'Riz Thaï',
  'California Saumon Avocat', 'California Saumon Cheese', 'California Thon Cuit Mayo Avocat Concombre', 'California Poulet Avocat', 'California Veggie Avocat Concombre', 'California Crevettes Tempura Avocat', 'California Foie Gras Figue Amande',
  'Maki Green Saumon Avocat Menthe Coriandre', 'Maki Green Thon Avocat Menthe Coriandre', 'Maki Green Saumon Cheese', 'Maki Green Avocat Cheese', 'Maki Green Tempura Avocat Mayo Menthe Coriandre', 'Maki Green Crevettes Tempura Avocat Sauce Curry',
  'Maki Black Saumon', 'Maki Black Avocat', 'Maki Black Thon', 'Maki Black Cheese', 'Maki Black Saumon Cheese', 'Maki Black Concombre',
  'Maki Neige Saumon Cheese', 'Maki Neige Saumon Avocat', 'Maki Neige Avocat Cheese', 'Maki Neige Thon Cuit Avocat Mayo',
  'Maki Pink Cheese', 'Maki Pink Avocat Cheese', 'Maki Pink Concombre Cheese', 'Maki Pink Saumon Mi-Cuit Cheese Oignon Frit', 'Maki Pink Avocat Cheese Tomate Séchée',
  'Sashimi Saumon 6 pièces', 'Sashimi Saumon 12 pièces', 'Sashimi Thon 6 pièces', 'Sashimi Thon 12 pièces',
  'Sushi Saumon x2', 'Sushi Thon x2', 'Sushi Saumon Avocat x2', 'Sushi Saumon Mi-Cuit x2',
  'Gyoza Crevette ou Légume x4', 'Nems au Poulet x4', 'Crevettes Tempura x4', 'Bœuf au Fromage Fait Maison x2', 'Boulettes de Poulet Fait Maison x2', 'Brochette de Poulet Fait Maison x2', 'Tartare Saumon Avocat', 'Love Bao',
  'Midi Asian', 'Asian Love', 'Banh Mi', 'Menu Enfant',
  '8 Maki Tiger', '8 Maki Chicken Dragon', '6 Maki Gold',
  'Tiramisu', 'Dessert du jour',
  'Evian / San Pellegrino', 'Soda', 'Asian Drink', 'Calypso', 'Bubble Tea', 'Piña Colada', 'Cocktail Kohsamui', 'Cocktail Tokyo',
  'Thaï-sty Krusty', 'Bœuf Basilic', 'Boisson 33cl',
]
const AVEC_PHOTO = ['Poke Bowl', 'Dynamite', 'Mi Prat', 'Pad Thaï', 'Crousti Poulet', 'Khao Prat', 'Curry Vert', 'Tigre qui pleure', 'Loc Lac', 'Bo Bun', 'Mango Stick']

describe('Inventaire exact : 11 plats avec photo, 70 sans photo (P1-M3)', () => {
  test('comptes : 81 plats, 11 avec photo, 70 sans photo', () => {
    assert.equal(plats().length, 81)
    assert.equal(SANS_PHOTO.length, 70)
    assert.equal(AVEC_PHOTO.length, 11)
    assert.deepEqual(plats().filter((p) => !p.photo).map((p) => p.nom).sort(), [...SANS_PHOTO].sort())
    assert.deepEqual(plats().filter((p) => p.photo).map((p) => p.nom).sort(), [...AVEC_PHOTO].sort())
    assert.equal(new Set([...SANS_PHOTO, ...AVEC_PHOTO]).size, 81)
  })

  test('chaque photo de plat existe dans public/visuels/ et pèse ≤ 250 Ko ; total des fiches ≤ 400 Ko', () => {
    const photos = new Set(plats().filter((p) => p.photo).map((p) => p.photo!))
    let total = 0
    for (const chemin of photos) {
      assert.ok(existsSync(fichier(chemin)), chemin)
      const taille = statSync(fichier(chemin)).size
      assert.ok(taille <= 250_000, `${chemin} : ${taille} o`)
      total += taille
    }
    assert.ok(total <= 400_000, `total fiches plats : ${total} o`)
  })

  test('aucun plat ne partage sa photo avec un autre plat', () => {
    const vues = plats().filter((p) => p.photo).map((p) => p.photo!)
    assert.equal(new Set(vues).size, vues.length, 'une photo est partagée entre plusieurs plats')
  })

  test('menu-makis.jpg, menu-nouilles-crevettes.jpg et menu-plat-riz.jpg ne sont rattachées à aucun plat nommé', () => {
    for (const chemin of [VISUELS.menuMakis, VISUELS.menuNouillesCrevettes, VISUELS.menuPlatRiz]) {
      assert.ok(existsSync(fichier(chemin)), `${chemin} : fichier gardé`)
      for (const p of plats()) assert.notEqual(p.photo, chemin, p.nom)
    }
  })

  test('retirerPhotosDetachees : un menu enregistré avant P1-M3 avec menu-makis.jpg ne l’affiche plus', () => {
    const ancien = {
      categories: [
        {
          id: 'c1',
          nom: 'Spécialités du chef',
          produits: [
            { id: 'p1', nom: '8 Maki Tiger', prix: 1390, allergenes: [], photo: '/visuels/menu-makis.jpg' },
            { id: 'p2', nom: '6 Maki Gold', prix: null, allergenes: [] },
          ],
        },
        { id: 'c2', nom: 'Plats thaï', produits: [{ id: 'p3', nom: 'Loc Lac', prix: 1490, allergenes: [], photo: '/visuels/menu-loc-lac.jpg' }] },
      ],
    }
    const nettoye = retirerPhotosDetachees(ancien as never)
    assert.equal(nettoye.categories[0].produits[0].photo, undefined)
    assert.equal(nettoye.categories[0].produits[0].nom, '8 Maki Tiger')
    assert.equal(nettoye.categories[1].produits[0].photo, '/visuels/menu-loc-lac.jpg')
    // Le menu d'origine n'est pas modifié ; la carte de repli est déjà nettoyée.
    assert.equal(ancien.categories[0].produits[0].photo, '/visuels/menu-makis.jpg')
    assert.deepEqual(retirerPhotosDetachees(menuReelAsianHome()), menuReelAsianHome())
  })

  test('#/menu applique le retrait des photos détachées au menu affiché (repli ou enregistré)', () => {
    const tsx = readFileSync(new URL('../src/pages/MenuPublic.tsx', import.meta.url), 'utf8')
    assert.match(tsx, /retirerPhotosDetachees\(masquerPrixNonConfirmes\(repliReel \? menuReelAsianHome\(\) : menu\)\)/)
  })

  test('aucune photo du restaurant en attente dans assets/source/photos/ (que le README)', () => {
    const fichiers = readdirSync(new URL('../assets/source/photos/', import.meta.url))
    assert.deepEqual(fichiers, ['README.md'])
  })
})

describe('docs/PHOTOS-MANQUANTES.md : la liste exacte à fournir au commerçant', () => {
  test('le fichier existe et cite les 70 plats sans photo et les 11 avec photo, avec les comptes', () => {
    assert.ok(existsSync(new URL('../docs/PHOTOS-MANQUANTES.md', import.meta.url)))
    const d = doc()
    for (const nom of SANS_PHOTO) assert.ok(d.includes(nom), `absent du doc : ${nom}`)
    for (const nom of AVEC_PHOTO) assert.ok(d.includes(nom), `absent du doc : ${nom}`)
    assert.match(d, /70/)
    assert.match(d, /\b11\b/)
  })

  test('le doc explique le détachement de menu-makis.jpg et le mode de dépôt des futures photos', () => {
    const d = doc()
    assert.match(d, /menu-makis\.jpg/)
    assert.match(d, /contribution client/)
    assert.match(d, /assets\/source\/photos\//)
    assert.match(d, /plat-<nom-du-plat>\.jpg/)
    assert.match(d, /jamais une photo\s+sur un plat qu'elle ne montre pas/i)
  })
})

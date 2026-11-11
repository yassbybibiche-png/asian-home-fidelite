// Carte officielle d'Asian Home Paris — 16 catégories, 81 plats.
// Source : carte officielle du restaurant publiée sur Heyzine (PDF 6 pages,
// https://cdnm.heyzine.com/files/uploaded/64e5dc5d723c717e149bb6d08eb6fee86589eb69.pdf),
// relevée le 10/11/2026 : 78 lignes tarifées sur la carte imprimée + 3 plats hors carte gardés de
// l'ancien menu (Uber Eats), sans prix. Détails : docs/MENU-OFFICIEL-2026-11-10.md.
//
// Prix en centimes. P1-M1 (11/11/2026) : 2 des 78 prix imprimés ne sont PAS confirmés par le
// commerçant — ils sont MASQUÉS (prix null, affichés « Prix sur place ») tant qu'il ne les
// confirme pas, et ne sont affichés nulle part dans le menu public. Leurs valeurs imprimées restent
// documentées dans PRIX_A_CONFIRMER ci-dessous (référence uniquement, jamais affichée en public —
// visible côté commerçant dans #/menuCarte pour confirmation ou correction).
// Il reste donc 76 prix affichés et 5 plats sans prix (2 à confirmer + 3 hors carte).
// Descriptions : texte de la carte uniquement (Dynamite et les 3 plats hors carte
// gardent leur description Uber Eats). Aucun allergène sur la carte : listes vides.
// Photos : uniquement les vraies photos du restaurant dans public/visuels/ (voir
// public/visuels/SOURCES.md).
//
// - 9 plats (PHOTOS_PDF, lot P1-B2) : photos recadrées du PDF de la carte, chacune
//   légendée du nom du plat par le restaurant (fiche + vignette WebP).
// - Loc Lac, Mango Stick : photos existantes gardées.
// - 8 Maki Tiger / 8 Maki Chicken Dragon : SANS photo depuis P1-M3 — la photo partagée
//   `menu-makis.jpg` (contribution client sur lacarte.menu, un seul rouleau pour deux plats
//   différents, impossible de dire lequel elle montre) a été détachée ; le fichier est gardé,
//   non rattaché, en attendant 2 photos distinctes du commerçant (voir docs/PHOTOS-MANQUANTES.md).
// - Sans photo, faute de photo qui montre CE plat : Love Bao (légende du PDF douteuse),
//   6 Maki Gold, Tiramisu, boissons, variantes makis / california / sashimi / sushi.
// - menu-nouilles-crevettes.jpg (ancienne photo PROBABLE de Mi Prat) et
//   menu-plat-riz.jpg (plat thaï non identifié) ne sont rattachées à aucun plat nommé.
// - Ids : les plats déjà présents dans l'ancien menu gardent leur id `reel-cN-pM` ;
//   les nouveaux plats ont un id `reel-o-…`.
import type { Menu, Produit } from '../types'
import { ID_ASIAN_HOME, PHOTOS_PDF, VISUELS } from '../lib/visuels.ts'

/** Plats signature mis en avant (best-sellers cités dans les avis et sur Instagram). */
export const PLATS_SIGNATURE = ['Dynamite', 'Thaï-sty Krusty', 'Love Bao', 'Loc Lac', '8 Maki Chicken Dragon', '8 Maki Tiger'] as const

/**
 * Prix imprimés sur la carte officielle mais NON confirmés par le commerçant (P1-M1) :
 * masqués dans le menu public (prix null → « Prix sur place ») tant qu'il ne les confirme pas.
 * Les valeurs imprimées sont conservées ici à titre de référence uniquement — elles ne sont
 * pas affichées dans le menu public ; elles restent visibles côté commerçant (#/menuCarte)
 * pour qu'il puisse les confirmer ou les corriger. Retirer une entrée de cette liste quand le
 * commerçant confirme le prix (alors seulement, le prix saisi s'affichera).
 */
export const PRIX_A_CONFIRMER = [
  { nom: 'Riz Thaï', prixImprime: 890, motif: 'Incohérent avec Riz Nature 2,50 € (même catégorie).' },
  { nom: '6 Maki Gold', prixImprime: 10000, motif: 'Environ 15× les autres makis (6,00–6,90 €) ; probable coquille pour 10,00 €.' },
] as const

/** Vrai si ce couple (nom, prix) est un prix imprimé non confirmé : il ne doit pas s'afficher. */
export function estPrixNonConfirme(nom: string, prix: number | null): boolean {
  return prix !== null && PRIX_A_CONFIRMER.some((p) => p.nom === nom && p.prixImprime === prix)
}

/**
 * Masque les prix non confirmés d'un menu quelconque (carte de repli ou menu enregistré par le
 * commerçant) : un menu enregistré AVANT ce lot avec les anciens montants ne les affiche plus
 * dans le menu public. Un prix différent de la valeur imprimée (ex. Maki Gold corrigé à 10,00 €)
 * n'est pas touché. Ne modifie pas le menu d'origine.
 */
export function masquerPrixNonConfirmes(menu: Menu): Menu {
  return {
    ...menu,
    categories: menu.categories.map((c) => ({
      ...c,
      produits: c.produits.map((p) => (estPrixNonConfirme(p.nom, p.prix) ? { ...p, prix: null } : p)),
    })),
  }
}

/**
 * Photos détachées (P1-M3) : ne doivent plus s'afficher sur un plat nommé, même si un menu
 * enregistré avant le lot les contient encore. Pour l'instant, la seule est `menu-makis.jpg`
 * (photo partagée entre 8 Maki Tiger et 8 Maki Chicken Dragon, contribution client, impossible
 * de dire quel plat elle montre). Ne modifie pas le menu d'origine.
 */
export const PHOTOS_DETACHEES = [VISUELS.menuMakis] as const

export function retirerPhotosDetachees(menu: Menu): Menu {
  return {
    ...menu,
    categories: menu.categories.map((c) => ({
      ...c,
      produits: c.produits.map((p) => {
        if (!p.photo || !(PHOTOS_DETACHEES as readonly string[]).includes(p.photo)) return p
        const { photo: _photo, photoVignette: _vignette, ...reste } = p
        return reste
      }),
    })),
  }
}

export const estSignature = (nom: string): boolean => (PLATS_SIGNATURE as readonly string[]).includes(nom)

const plat = (id: string, nom: string, prix: number | null, description?: string, photo?: string | Pick<Produit, 'photo' | 'photoVignette'>): Produit => ({
  id,
  nom,
  prix,
  ...(description ? { description } : {}),
  ...(typeof photo === 'string' ? { photo } : photo),
  allergenes: [],
})

const SASHIMI = 'Cru ou épicé.'
const SAUCE_CURRY_MAYO = 'Sauce curry ou mayo.'
const MIDI = 'Menu midi (lundi au vendredi) — 1 soda offert + 1 accompagnement au choix : soupe miso ou salade de choux.'

/** La carte officielle, prête à afficher ou à enregistrer comme menu du commerce. */
export function menuReelAsianHome(): Menu {
  return {
    commerceId: ID_ASIAN_HOME,
    majLe: '',
    categories: [
      {
        id: 'reel-cat-1',
        nom: 'Salades & accompagnements',
        produits: [
          plat('reel-c1-p1', 'Choux', 250),
          plat('reel-o-edamame', 'Edamame', 400),
          plat('reel-o-wakame', 'Wakame', 400),
          plat('reel-c1-p2', 'Soupe Miso', 250),
          plat('reel-c1-p3', 'Riz Nature', 250),
          // P1-M1 : prix imprimé 8,90 € non confirmé par le commerçant → masqué (« Prix sur place »).
          // Valeur imprimée conservée dans PRIX_A_CONFIRMER, jamais affichée.
          plat('reel-c1-p5', 'Riz Thaï', null),
        ],
      },
      {
        id: 'reel-cat-california',
        nom: 'California x6 — option Crispy +0,50 €',
        produits: [
          plat('reel-o-california-saumon-avocat', 'California Saumon Avocat', 650),
          plat('reel-o-california-saumon-cheese', 'California Saumon Cheese', 650),
          plat('reel-o-california-thon-cuit', 'California Thon Cuit Mayo Avocat Concombre', 650),
          plat('reel-o-california-poulet-avocat', 'California Poulet Avocat', 650, SAUCE_CURRY_MAYO),
          plat('reel-o-california-veggie', 'California Veggie Avocat Concombre', 650),
          plat('reel-o-california-crevettes-tempura', 'California Crevettes Tempura Avocat', 650, SAUCE_CURRY_MAYO),
          plat('reel-o-california-foie-gras', 'California Foie Gras Figue Amande', 700, 'Foie gras, confiture de figues, amande effilée.'),
        ],
      },
      {
        id: 'reel-cat-maki-green',
        nom: 'Maki Green x6',
        produits: [
          plat('reel-o-green-saumon-avocat', 'Maki Green Saumon Avocat Menthe Coriandre', 690),
          plat('reel-o-green-thon-avocat', 'Maki Green Thon Avocat Menthe Coriandre', 690),
          plat('reel-o-green-saumon-cheese', 'Maki Green Saumon Cheese', 690),
          plat('reel-o-green-avocat-cheese', 'Maki Green Avocat Cheese', 690),
          plat('reel-o-green-tempura', 'Maki Green Tempura Avocat Mayo Menthe Coriandre', 690),
          plat('reel-o-green-crevettes-tempura', 'Maki Green Crevettes Tempura Avocat Sauce Curry', 690),
        ],
      },
      {
        id: 'reel-cat-maki-black',
        nom: 'Maki Black x6',
        produits: [
          plat('reel-o-black-saumon', 'Maki Black Saumon', 600),
          plat('reel-o-black-avocat', 'Maki Black Avocat', 600),
          plat('reel-o-black-thon', 'Maki Black Thon', 600),
          plat('reel-o-black-cheese', 'Maki Black Cheese', 600),
          plat('reel-o-black-saumon-cheese', 'Maki Black Saumon Cheese', 600),
          plat('reel-o-black-concombre', 'Maki Black Concombre', 600),
        ],
      },
      {
        id: 'reel-cat-maki-neige',
        nom: 'Maki Neige x6',
        produits: [
          plat('reel-o-neige-saumon-cheese', 'Maki Neige Saumon Cheese', 650),
          plat('reel-o-neige-saumon-avocat', 'Maki Neige Saumon Avocat', 650),
          plat('reel-o-neige-avocat-cheese', 'Maki Neige Avocat Cheese', 650),
          plat('reel-o-neige-thon-cuit', 'Maki Neige Thon Cuit Avocat Mayo', 650),
        ],
      },
      {
        id: 'reel-cat-maki-pink',
        nom: 'Maki Pink x6',
        produits: [
          plat('reel-o-pink-cheese', 'Maki Pink Cheese', 690),
          plat('reel-o-pink-avocat-cheese', 'Maki Pink Avocat Cheese', 690),
          plat('reel-o-pink-concombre-cheese', 'Maki Pink Concombre Cheese', 690),
          plat('reel-o-pink-saumon-mi-cuit', 'Maki Pink Saumon Mi-Cuit Cheese Oignon Frit', 690),
          plat('reel-o-pink-tomate-sechee', 'Maki Pink Avocat Cheese Tomate Séchée', 690),
        ],
      },
      {
        id: 'reel-cat-sashimi',
        nom: 'Sashimi',
        produits: [
          plat('reel-c4-p6', 'Sashimi Saumon 6 pièces', 700, SASHIMI),
          plat('reel-o-sashimi-saumon-12', 'Sashimi Saumon 12 pièces', 1390, SASHIMI),
          plat('reel-c4-p7', 'Sashimi Thon 6 pièces', 800, SASHIMI),
          plat('reel-o-sashimi-thon-12', 'Sashimi Thon 12 pièces', 1450, SASHIMI),
        ],
      },
      {
        id: 'reel-cat-sushi',
        nom: 'Sushi x2',
        produits: [
          plat('reel-o-sushi-saumon', 'Sushi Saumon x2', 450),
          plat('reel-o-sushi-thon', 'Sushi Thon x2', 450),
          plat('reel-o-sushi-saumon-avocat', 'Sushi Saumon Avocat x2', 450),
          plat('reel-o-sushi-saumon-mi-cuit', 'Sushi Saumon Mi-Cuit x2', 450),
        ],
      },
      {
        id: 'reel-cat-5',
        nom: 'Poke Bowl',
        produits: [
          plat(
            'reel-c5-p1',
            'Poke Bowl',
            1450,
            'Servi avec du riz vinaigré. Base au choix : saumon mariné, saumon épicé, thon mariné, thon épicé, poulet crousti. Garnitures : salade iceberg, concombres, patate douce, salade de choux, avocat, edamame, choux rouge, mangue.',
            PHOTOS_PDF.pokeBowl,
          ),
        ],
      },
      {
        id: 'reel-cat-2',
        nom: 'Entrées thaï',
        produits: [
          plat('reel-c2-p6', 'Gyoza Crevette ou Légume x4', 690),
          plat('reel-c2-p5', 'Nems au Poulet x4', 690),
          plat('reel-c2-p7', 'Crevettes Tempura x4', 690, '4 pièces.'),
          plat('reel-c2-p4', 'Bœuf au Fromage Fait Maison x2', 490),
          plat('reel-o-boulettes-poulet', 'Boulettes de Poulet Fait Maison x2', 490),
          plat('reel-o-brochette-poulet', 'Brochette de Poulet Fait Maison x2', 490),
          plat('reel-c1-p4', 'Tartare Saumon Avocat', 890),
          plat(
            'reel-c2-p2',
            'Dynamite',
            890,
            'Dynamite Poulet ou Crevettes au choix, nos best-sellers ! Des bouchées croustillantes garnies de poulet ou de crevettes fondantes, enrobées dans une sauce dynamite maison légèrement épicée, crémeuse et addictive.',
            PHOTOS_PDF.dynamite,
          ),
          plat('reel-c2-p3', 'Love Bao', 990, 'Duo de bao à la dynamite poulet et crevette, concombre et oignon frit.'),
        ],
      },
      {
        id: 'reel-cat-3',
        nom: 'Plats thaï',
        produits: [
          plat('reel-c3-p7', 'Mi Prat', 1390, 'Poulet, bœuf ou crevette, nouilles sautées, légumes sautés.', PHOTOS_PDF.miPrat),
          plat('reel-c3-p4', 'Pad Thaï', 1390, 'Poulet, bœuf ou crevette, nouilles de riz, légumes sautés.', PHOTOS_PDF.padThai),
          plat('reel-c3-p8', 'Crousti Poulet', 1490, 'Poulet croustillant doré façon thaï, riz nature ou riz thaï.', PHOTOS_PDF.croustiPoulet),
          plat('reel-c3-p5', 'Khao Prat', 1390, 'Poulet, bœuf ou crevette, riz thaï sauté au wok.', PHOTOS_PDF.khaoPrat),
          plat('reel-c3-p6', 'Curry Vert', 1390, 'Poulet ou crevette, riz blanc, velouté de curry, légumes croquants.', PHOTOS_PDF.curryVert),
          plat('reel-c3-p3', 'Tigre qui pleure', 1590, 'Bœuf tranché et sa sauce thaï, riz nature ou riz thaï.', PHOTOS_PDF.tigreQuiPleure),
          // Photo existante (1109×720) gardée : le PDF montre le même plat en plus basse résolution.
          plat('reel-c3-p2', 'Loc Lac', 1490, 'Riz rouge, bœuf caramélisé, œuf, salade.', '/visuels/menu-loc-lac.jpg'),
          plat('reel-c3-p1', 'Bo Bun', 1390, 'Vermicelles de riz, bœuf, nems, légumes.', PHOTOS_PDF.boBun),
        ],
      },
      {
        id: 'reel-cat-midi',
        nom: 'Menu Midi (lundi au vendredi)',
        produits: [
          plat('reel-o-midi-asian', 'Midi Asian', 1390, `${MIDI} 6 California Saumon Avocat Concombre, 3 Sashimi Saumon, 3 Sushi Saumon.`),
          plat('reel-o-midi-asian-love', 'Asian Love', 1390, `${MIDI} 6 California Saumon Cheese, 2 Sushi Saumon, 3 brochettes : bœuf au fromage, boulette de poulet, poulet.`),
          plat('reel-o-midi-banh-mi', 'Banh Mi', 990, `${MIDI} Sandwich viet' — poulet ou bœuf.`),
          plat('reel-o-midi-enfant', 'Menu Enfant', 990, `${MIDI} Midi & soir — 6 Maki Neige Cheese, 1 brochette boulette de poulet, 1 brochette de bœuf.`),
        ],
      },
      {
        id: 'reel-cat-4',
        nom: 'Spécialités du chef',
        produits: [
          plat('reel-c4-p10', '8 Maki Tiger', 1390, 'Crevette tempura, avocat, cheese, recouvert de saumon mi-cuit, avocat, mayonnaise spicy.'),
          plat(
            'reel-c4-p9',
            '8 Maki Chicken Dragon',
            1390,
            "Poulet croustillant, avocat, cheese, sauce chili thaï, recouvert d'avocat, mayonnaise spicy et oignon frit.",
          ),
          // P1-M1 : prix imprimé 100,00 € non confirmé par le commerçant → masqué (« Prix sur place »).
          // Valeur imprimée conservée dans PRIX_A_CONFIRMER, jamais affichée.
          plat('reel-o-maki-gold', '6 Maki Gold', null),
        ],
      },
      {
        id: 'reel-cat-6',
        nom: 'Desserts',
        produits: [
          plat('reel-c6-p1', 'Mango Stick', 890, 'Mangue et riz coco.', '/visuels/menu-mango-sticky-rice.jpg'),
          plat('reel-c6-p2', 'Tiramisu', 890, 'Fait maison.'),
          plat('reel-o-dessert-du-jour', 'Dessert du jour', 890),
        ],
      },
      {
        id: 'reel-cat-7',
        nom: 'Boissons',
        produits: [
          plat('reel-o-eau', 'Evian / San Pellegrino', 290),
          plat('reel-o-soda', 'Soda', 350, 'Coca-Cola, Ice Tea…'),
          plat('reel-c7-p2', 'Asian Drink', 390),
          plat('reel-o-calypso', 'Calypso', 390),
          plat('reel-o-bubble-tea', 'Bubble Tea', 500),
          plat('reel-c7-p5', 'Piña Colada', 750),
          plat('reel-c7-p3', 'Cocktail Kohsamui', 750, 'Goyaves, ananas, kiwi.'),
          plat('reel-c7-p4', 'Cocktail Tokyo', 750, 'Passion, ananas, grenadine.'),
        ],
      },
      {
        id: 'reel-cat-hors-carte',
        nom: 'Hors carte (prix à confirmer)',
        produits: [
          plat(
            'reel-c2-p1',
            'Thaï-sty Krusty',
            null,
            "Un savoureux riz blanc ou thaï généreusement nappé de notre sauce maison, accompagné de crousti poulet fondant à l'intérieur, croustillant à l'extérieur, le tout relevé par une seconde sauce maison pleine de caractère. Servi avec une boisson.",
          ),
          plat('reel-c3-p9', 'Bœuf Basilic', null, 'Bœuf mariné façon thaï, légumes, basilic, riz nature.'),
          plat('reel-c7-p1', 'Boisson 33cl', null),
        ],
      },
    ],
  }
}

export const COMPTE_CATEGORIES_REELLES = 16
export const COMPTE_PLATS_REELS = 81

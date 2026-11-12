import type { Commerce } from '../types'

/**
 * Vraies photos d'Asian Home Paris, servies localement depuis public/visuels/
 * (provenance documentée dans public/visuels/SOURCES.md — aucune banque
 * d'images générique, aucun hotlink).
 *
 * Le commerce en production n'a ni logo ni bannière renseignés :
 * ces visuels sont utilisés en repli pour Asian Home uniquement, sans toucher
 * aux données ni au backend. Dès que le commerçant envoie son propre logo
 * (Réglages → Le commerce, lot P1-B5) ou renseigne sa bannière (Réglages →
 * Apparence), c'est le sien qui s'affiche ; « Revenir au logo par défaut »
 * rétablit ce repli.
 */
export const VISUELS = {
  /** Logo officiel ASIAN HOUSE, blanc sur noir : à afficher sur fond sombre uniquement. */
  logo: '/visuels/logo.png',
  /** Plateau de plats vu de dessus (sushis, makis, saumon, nouilles, riz, mangue). */
  heroPlats: '/visuels/hero-plats.jpg',
  /** Même plateau, recadré au ratio de la bannière (720×180, WebP q75, ~27 Ko) —
      le JPEG 1024×683 (177 Ko) reste le repli (boucle t6 : variante 720×480 ;
      boucle t7 : recadrage centré au ratio d'affichage 390×96 — l'object-cover
      jetait ~63 % des pixels de la variante 720×480 (bande visible 720×177),
      le rendu est très proche, avec des différences de redimensionnement et
      de compression). */
  heroPlatsPetit: '/visuels/hero-plats-petit.webp',
  /** Table dressée : bao buns, plateau de sushis, cocktails. */
  tableSushis: '/visuels/table-sushis.jpg',
  /** Même table dressée, recadrée au ratio de la carte (720×590, WebP q75, ~51 Ko)
      pour l'en-tête du menu et de la carte — le JPEG 788×1400 (196 Ko) reste le repli
      (boucle t4 : variante 720×1279 ; boucle t9 : recadrage centré à la bande visible
      de la carte 720×590 — le menu montre approximativement le centre 720×413 de cette
      bande à la largeur de référence ~390 px, la carte approximativement la bande
      entière ; le rendu est très proche sur les deux pages). */
  tableSushisPetit: '/visuels/table-sushis-petit.webp',
  /** Cocktails signature Kohsamui / Tokyo / Piña Colada. */
  cocktails: '/visuels/cocktails.jpg',
  /** Mêmes cocktails, recadrés au ratio de la photo de catégorie (640×210, WebP q75, ~12 Ko) —
      le JPEG 640×1136 (69 Ko) reste le repli (boucle t10, photo paresseuse). */
  cocktailsPetit: '/visuels/cocktails-petit.webp',
  /** Salle du restaurant : plafond d'ombrelles, tables dressées, sans personne. */
  interieur: '/visuels/interieur.jpg',
  /** Même salle, recadrée au ratio d'affichage (675×443, WebP q75, ~37 Ko) —
      le JPEG 675×900 (131 Ko) reste le repli (boucle t10, photo paresseuse). */
  interieurPetit: '/visuels/interieur-petit.webp',
  /** Rouleau de sushis sur ardoise. */
  sushisArdoise: '/visuels/sushis-ardoise.jpg',
  /** Même rouleau, recadré au ratio de la photo de catégorie (614×201, WebP q75, ~11 Ko) —
      le JPEG 614×408 (30 Ko) reste le repli (boucle t10, photo paresseuse). */
  sushisArdoisePetit: '/visuels/sushis-ardoise-petit.webp',
  /** Rouleau de makis sur ardoise, filigrane ASIAN HOME — NON rattaché à aucun plat depuis P1-M3 :
      contribution client sur lacarte.menu (pas une photo fournie par le restaurant), un seul rouleau
      pour deux plats différents (8 Maki Tiger / 8 Maki Chicken Dragon), impossible de dire lequel
      elle montre. Fichier gardé en attendant 2 photos distinctes du commerçant. */
  menuMakis: '/visuels/menu-makis.jpg',
  /** Loc Lac : bœuf caramélisé, riz rouge, œuf au plat. */
  menuLocLac: '/visuels/menu-loc-lac.jpg',
  /** Même plat, recadrage carré centré pour la liste du menu (192×192, WebP q75, ~6 Ko) —
      le JPEG 1109×720 (156 Ko) reste la photo de la fiche (item C). */
  menuLocLacVignette: '/visuels/menu-loc-lac-vignette.webp',
  /**
   * Nouilles sautées aux crevettes — rattachée à AUCUN plat depuis le lot P1-B2 : « Mi Prat » a désormais
   * la photo légendée « MI PRAT » par le restaurant dans son PDF. Gardée au cas où le commerçant confirme le plat montré.
   */
  menuNouillesCrevettes: '/visuels/menu-nouilles-crevettes.jpg',
  /** Mango sticky rice : mangue et riz gluant coco (Mango Stick). */
  menuMangoStickyRice: '/visuels/menu-mango-sticky-rice.jpg',
  /** Même dessert, recadrage carré centré pour la liste du menu (192×192, WebP q75, ~7 Ko) —
      le JPEG 411×412 (61 Ko) reste la photo de la fiche (item C). */
  menuMangoStickyRiceVignette: '/visuels/menu-mango-sticky-rice-vignette.webp',
  /** Même dessert, recadré au ratio de la photo de catégorie (411×134, WebP q75, ~12 Ko) —
      le JPEG 411×412 (61 Ko) reste le repli (boucle t10, photo paresseuse). */
  menuMangoStickyRicePetit: '/visuels/menu-mango-sticky-rice-petit.webp',
  /** Plat thaï non identifié précisément (riz + soupe en grès) : photo d'ambiance de catégorie uniquement, jamais d'un plat nommé. */
  menuPlatRiz: '/visuels/menu-plat-riz.jpg',
  /** Même plat, recadré au ratio de la photo de catégorie (424×139, WebP q75, ~6,6 Ko) —
      le JPEG 424×408 (39 Ko) reste le repli (boucle t10, photo paresseuse). */
  menuPlatRizPetit: '/visuels/menu-plat-riz-petit.webp',
  /** Coin salon : fauteuils velours bleu nuit, rideaux violets, sans personne. */
  interieurSalon: '/visuels/interieur-salon.jpg',
  /** Même salon, recadré au ratio d'affichage (320×157, WebP q75, ~5,6 Ko) —
      le JPEG 320×240 (22 Ko) reste le repli (boucle t10, photo paresseuse). */
  interieurSalonPetit: '/visuels/interieur-salon-petit.webp',
} as const

/**
 * Photos de plats recadrées du PDF officiel de la carte (assets/source/menu.pdf,
 * scripts/extraire-photos-menu.py) : chaque photo est LÉGENDÉE du nom du plat par le
 * restaurant lui-même. Fiche (largeur native ≤ 720 px) + vignette (≤ 192 px), en WebP.
 * Cadres, plats écartés et raisons : public/visuels/SOURCES.md.
 */
const photoPdf = (slug: string) => ({ photo: `/visuels/menu-${slug}.webp`, photoVignette: `/visuels/menu-${slug}-vignette.webp` })
export const PHOTOS_PDF = {
  pokeBowl: photoPdf('poke-bowl'),
  dynamite: photoPdf('dynamite'),
  miPrat: photoPdf('mi-prat'),
  padThai: photoPdf('pad-thai'),
  croustiPoulet: photoPdf('crousti-poulet'),
  khaoPrat: photoPdf('khao-prat'),
  curryVert: photoPdf('curry-vert'),
  tigreQuiPleure: photoPdf('tigre-qui-pleure'),
  boBun: photoPdf('bo-bun'),
} as const

/** Variante légère du logo par défaut (192×192, WebP q80, 4,9 Ko) : écran de
 * chargement (index.html, boucle t2) et logo du commerce dans l'app
 * (LogoCommerce, boucle t5 — le PNG 600×600 est affiché 64×64).
 * Hors de VISUELS : tests/visuels.test.ts exige > 10 000 o par entrée. */
export const LOGO_DEFAUT_PETIT = '/visuels/logo-petit.webp'

/** Identifiant stable du commerce Asian Home Paris (seed + production). */
export const ID_ASIAN_HOME = 'c-asian-home-paris'

export function estAsianHome(commerce: Pick<Commerce, 'id' | 'nom'>): boolean {
  return commerce.id === ID_ASIAN_HOME || commerce.nom.trim().toLowerCase() === 'asian home paris'
}

/** Logo à afficher : celui du commerce s'il est renseigné, sinon le vrai logo local pour Asian Home. */
export function logoCommerce(commerce: Pick<Commerce, 'id' | 'nom' | 'logo'>): string {
  const logo = commerce.logo?.trim() ?? ''
  if (logo) return logo
  return estAsianHome(commerce) ? VISUELS.logo : ''
}

/** Bannière de la carte de fidélité : celle configurée, sinon le plateau de plats pour Asian Home. */
export function banniereCommerce(commerce: Pick<Commerce, 'id' | 'nom' | 'apparence'>): string {
  const banniere = commerce.apparence?.banniere?.trim() ?? ''
  if (banniere) return banniere
  return estAsianHome(commerce) ? VISUELS.heroPlats : ''
}

/** Le logo servi localement est blanc sur noir : il faut un fond sombre derrière. */
export function estLogoLocal(logo: string): boolean {
  return logo.startsWith('/visuels/')
}

export interface PhotoCategorie {
  src: string
  /** Variante WebP légère, recadrée au ratio d'affichage (boucle t10) — le JPEG reste le repli. */
  srcPetit: string
  alt: string
}

/**
 * Photo d'illustration d'une catégorie de menu — uniquement quand la photo
 * montre vraiment la catégorie. Toute autre catégorie n'a pas de photo :
 * on ne met jamais une photo sur un plat qu'elle ne montre pas.
 */
export function photoCategorie(nom: string): PhotoCategorie | null {
  const n = nom.toLowerCase()
  if (n.includes('sushi') || n.includes('maki') || n.includes('sashimi') || n.includes('jap')) {
    return { src: VISUELS.sushisArdoise, srcPetit: VISUELS.sushisArdoisePetit, alt: 'Rouleau de sushis sur ardoise' }
  }
  if (n.includes('boisson') || n.includes('cocktail')) {
    return { src: VISUELS.cocktails, srcPetit: VISUELS.cocktailsPetit, alt: 'Cocktails signature : Kohsamui, Tokyo et Piña Colada' }
  }
  if (n.includes('thaï') || n.includes('thai')) {
    // Plat thaï non identifié précisément : illustre la catégorie, jamais un plat nommé.
    return { src: VISUELS.menuPlatRiz, srcPetit: VISUELS.menuPlatRizPetit, alt: 'Plat thaï : riz et soupe en grès' }
  }
  if (n.includes('dessert')) {
    // Le Mango Stick, dessert photographié du restaurant : illustre la catégorie.
    return { src: VISUELS.menuMangoStickyRice, srcPetit: VISUELS.menuMangoStickyRicePetit, alt: 'Mango sticky rice : mangue et riz gluant coco' }
  }
  return null
}

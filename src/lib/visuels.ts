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
  /** Même plateau, 720 px de large (WebP q75, ~76 Ko) pour la bannière de la carte —
      le JPEG 1024×683 (177 Ko) reste le repli (boucle t6 : il est affiché 390×96 et
      partage le tuyau 4G avec le héros de la carte, élément LCP). */
  heroPlatsPetit: '/visuels/hero-plats-petit.webp',
  /** Table dressée : bao buns, plateau de sushis, cocktails. */
  tableSushis: '/visuels/table-sushis.jpg',
  /** Même table dressée, 720 px de large (WebP q75, ~95 Ko) pour l'en-tête du menu et de la carte —
      le JPEG 788×1400 (196 Ko) reste le repli (boucle t4 : il est l'élément LCP du vrai menu). */
  tableSushisPetit: '/visuels/table-sushis-petit.webp',
  /** Cocktails signature Kohsamui / Tokyo / Piña Colada. */
  cocktails: '/visuels/cocktails.jpg',
  /** Salle du restaurant : plafond d'ombrelles, tables dressées, sans personne. */
  interieur: '/visuels/interieur.jpg',
  /** Rouleau de sushis sur ardoise. */
  sushisArdoise: '/visuels/sushis-ardoise.jpg',
  /** Rouleau de makis sur ardoise, filigrane ASIAN HOME — NON rattaché à aucun plat depuis P1-M3 :
      contribution client sur lacarte.menu (pas une photo fournie par le restaurant), un seul rouleau
      pour deux plats différents (8 Maki Tiger / 8 Maki Chicken Dragon), impossible de dire lequel
      elle montre. Fichier gardé en attendant 2 photos distinctes du commerçant. */
  menuMakis: '/visuels/menu-makis.jpg',
  /** Loc Lac : bœuf caramélisé, riz rouge, œuf au plat. */
  menuLocLac: '/visuels/menu-loc-lac.jpg',
  /**
   * Nouilles sautées aux crevettes — rattachée à AUCUN plat depuis le lot P1-B2 : « Mi Prat » a désormais
   * la photo légendée « MI PRAT » par le restaurant dans son PDF. Gardée au cas où le commerçant confirme le plat montré.
   */
  menuNouillesCrevettes: '/visuels/menu-nouilles-crevettes.jpg',
  /** Mango sticky rice : mangue et riz gluant coco (Mango Stick). */
  menuMangoStickyRice: '/visuels/menu-mango-sticky-rice.jpg',
  /** Plat thaï non identifié précisément (riz + soupe en grès) : photo d'ambiance de catégorie uniquement, jamais d'un plat nommé. */
  menuPlatRiz: '/visuels/menu-plat-riz.jpg',
  /** Coin salon : fauteuils velours bleu nuit, rideaux violets, sans personne. */
  interieurSalon: '/visuels/interieur-salon.jpg',
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
    return { src: VISUELS.sushisArdoise, alt: 'Rouleau de sushis sur ardoise' }
  }
  if (n.includes('boisson') || n.includes('cocktail')) {
    return { src: VISUELS.cocktails, alt: 'Cocktails signature : Kohsamui, Tokyo et Piña Colada' }
  }
  if (n.includes('thaï') || n.includes('thai')) {
    // Plat thaï non identifié précisément : illustre la catégorie, jamais un plat nommé.
    return { src: VISUELS.menuPlatRiz, alt: 'Plat thaï : riz et soupe en grès' }
  }
  if (n.includes('dessert')) {
    // Le Mango Stick, dessert photographié du restaurant : illustre la catégorie.
    return { src: VISUELS.menuMangoStickyRice, alt: 'Mango sticky rice : mangue et riz gluant coco' }
  }
  return null
}

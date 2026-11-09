import type { Commerce } from '../types'

/**
 * Vraies photos d'Asian Home Paris, servies localement depuis public/visuels/
 * (provenance documentée dans public/visuels/SOURCES.md — aucune banque
 * d'images générique, aucun hotlink).
 *
 * Le commerce en production n'a ni logo ni bannière renseignés :
 * ces visuels sont utilisés en repli pour Asian Home uniquement, sans toucher
 * aux données ni au backend. Si le commerçant renseigne un jour son propre
 * logo ou sa propre bannière (Réglages → Apparence), c'est la sienne qui
 * s'affiche.
 */
export const VISUELS = {
  /** Logo officiel ASIAN HOUSE, blanc sur noir : à afficher sur fond sombre uniquement. */
  logo: '/visuels/logo.png',
  /** Plateau de plats vu de dessus (sushis, makis, saumon, nouilles, riz, mangue). */
  heroPlats: '/visuels/hero-plats.jpg',
  /** Table dressée : bao buns, plateau de sushis, cocktails. */
  tableSushis: '/visuels/table-sushis.jpg',
  /** Cocktails signature Koh Samui / Tokyo / Piña Colada. */
  cocktails: '/visuels/cocktails.jpg',
  /** Salle du restaurant : plafond d'ombrelles, tables dressées, sans personne. */
  interieur: '/visuels/interieur.jpg',
  /** Rouleau de sushis sur ardoise. */
  sushisArdoise: '/visuels/sushis-ardoise.jpg',
} as const

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
  if (n.includes('sushi') || n.includes('maki') || n.includes('sashimi')) {
    return { src: VISUELS.sushisArdoise, alt: 'Rouleau de sushis sur ardoise' }
  }
  if (n.includes('boisson') || n.includes('cocktail')) {
    return { src: VISUELS.cocktails, alt: 'Cocktails signature : Koh Samui, Tokyo et Piña Colada' }
  }
  return null
}

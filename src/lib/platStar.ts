// Boucle animations, cycle 3 : « plat-star plein cadre » du menu Découverte (MenuPublic.tsx). Chaque catégorie qui a
// un plat photographié met UN plat en avant, en très grand, avec sa propre photo, son nom, son prix et sa description.
// Module importé par la seule page différée du menu : il reste dans son morceau, hors du bundle initial.
import type { CategorieMenu, Produit } from '../types'
import { estSignature } from '../data/menu-reel.ts'

/** Cadre de référence du bloc, aligné sur `.plat-star` (`height: clamp(20rem, 62vh, 34rem)`) sur un téléphone. */
export const CADRE_STAR = { largeur: 380, hauteur: 520 } as const
/** Ratio de recadrage `object-cover` (largeur / hauteur du cadre, ≈ 0,73). */
export const RATIO_CADRE_STAR = CADRE_STAR.largeur / CADRE_STAR.hauteur
/** Au-delà de cet agrandissement, la pixellisation se voit en plein cadre (vérifié en capture, cycle 3). */
export const AGRANDISSEMENT_MAX_STAR = 1.5

/**
 * Dimensions RÉELLES (px, mesurées sur les fichiers) des photos de plats du dépôt référencées par le champ `photo` de
 * la carte. Une photo absente (URL d'un commerçant) n'est pas jugée : éligible par défaut.
 */
export const DIMENSIONS_PHOTOS_PLATS: Readonly<Record<string, readonly [number, number]>> = {
  '/visuels/menu-loc-lac.jpg': [1109, 720],
  '/visuels/menu-mango-sticky-rice.jpg': [411, 412],
  '/visuels/menu-makis.jpg': [614, 408],
  '/visuels/menu-poke-bowl.webp': [203, 132],
  '/visuels/menu-dynamite.webp': [341, 225],
  '/visuels/menu-mi-prat.webp': [340, 223],
  '/visuels/menu-pad-thai.webp': [340, 223],
  '/visuels/menu-crousti-poulet.webp': [340, 224],
  '/visuels/menu-khao-prat.webp': [339, 223],
  '/visuels/menu-curry-vert.webp': [340, 223],
  '/visuels/menu-tigre-qui-pleure.webp': [339, 223],
  '/visuels/menu-bo-bun.webp': [341, 224],
}

/**
 * Agrandissement subi par une photo L×H recadrée au ratio du cadre puis étirée sur le cadre de référence :
 * max(380 / largeur utile, 520 / hauteur utile).
 */
export function agrandissementStar(largeur: number, hauteur: number): number {
  const utileL = Math.min(largeur, hauteur * RATIO_CADRE_STAR)
  const utileH = Math.min(hauteur, largeur / RATIO_CADRE_STAR)
  return Math.max(CADRE_STAR.largeur / utileL, CADRE_STAR.hauteur / utileH)
}

/** Vrai si la photo supporte le plein cadre (agrandissement ≤ 1,5) ; photo de dimensions inconnues : vrai. */
export function photoEligibleStar(photo: string): boolean {
  const d = DIMENSIONS_PHOTOS_PLATS[photo]
  return !d || agrandissementStar(d[0], d[1]) <= AGRANDISSEMENT_MAX_STAR
}

/**
 * Plat mis en avant dans la catégorie, parmi les plats dont la photo supporte le plein cadre : le premier plat
 * « signature », sinon le premier ; `null` si aucun. Toujours la photo du plat lui-même (`photo`), jamais une image
 * de catégorie ou d'ambiance.
 */
export function platStar(categorie: Pick<CategorieMenu, 'produits'>): Produit | null {
  const eligibles = categorie.produits.filter((p) => p.photo && photoEligibleStar(p.photo))
  return eligibles.find((p) => estSignature(p.nom)) ?? eligibles[0] ?? null
}

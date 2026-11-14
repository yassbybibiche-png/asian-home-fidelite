// Boucle animations, cycle 3 : « plat-star plein cadre » du menu Découverte (MenuPublic.tsx). Chaque catégorie qui a
// un plat photographié met UN plat en avant, en très grand, avec sa propre photo, son nom, son prix et sa description.
// Module importé par la seule page différée du menu : il reste dans son morceau, hors du bundle initial.
import type { CategorieMenu, Produit } from '../types'
import { estSignature } from '../data/menu-reel.ts'

/**
 * Plat mis en avant dans la catégorie : le premier plat « signature » photographié, sinon le premier plat
 * photographié ; `null` si aucun plat n'a de photo. Toujours la photo du plat lui-même (`photo`), jamais une image
 * de catégorie ou d'ambiance.
 */
export function platStar(categorie: Pick<CategorieMenu, 'produits'>): Produit | null {
  const photographies = categorie.produits.filter((p) => p.photo)
  return photographies.find((p) => estSignature(p.nom)) ?? photographies[0] ?? null
}

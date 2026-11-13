// Boucle animations, cycle 1 : « univers par catégorie » du menu Découverte (#/menu).
// Importé UNIQUEMENT par la page différée MenuPublic (hors bundle initial). Logique pure, testée
// (tests/animations-cycle1.test.ts) ; les 6 palettes sombres sont les classes .univers-0 … .univers-5 de src/index.css.

/** Nombre d'univers : attribués par rang de catégorie, en cycle (0 → 5, puis 0…). */
export const NB_UNIVERS = 6

/** Univers de la catégorie `id` d'après son rang dans `ids` (carte complète, hors recherche) ; 0 (magenta, la base) sinon. */
export function universCategorie(ids: readonly string[], id: string | null): number {
  const rang = id == null ? -1 : ids.indexOf(id)
  return rang < 0 ? 0 : rang % NB_UNIVERS
}

/** Deux calques empilés : `devant` est opaque, l'autre transparent ; le fondu croise leurs opacités. */
export interface Couches {
  a: number
  b: number
  devant: 'a' | 'b'
}

/** Nouvel univers : il est posé sur le calque caché, qui passe devant (inchangé si c'est déjà l'univers affiché). */
export function croiserCouches(c: Couches, univers: number): Couches {
  if (c[c.devant] === univers) return c
  return c.devant === 'a' ? { a: c.a, b: univers, devant: 'b' } : { a: univers, b: c.b, devant: 'a' }
}

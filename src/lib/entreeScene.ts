/**
 * Boucle animations, cycle 5 — entrée de la liste du menu Découverte au changement d'onglet (#/menu). L'entrée de page
 * elle-même vit dans le routeur (`apresNavigation`, src/router.ts) et dans le CSS (`.navigue .entree-page`).
 */

/**
 * Suivi de l'onglet choisi : la fonction rendue dit si l'onglet a changé depuis l'appel précédent (le premier montage
 * n'est jamais un changement). Seul l'onglet CHOISI est suivi, jamais l'onglet effectif : la frappe dans la recherche
 * (qui peut ramener l'affichage sur « Toutes ») ne rejoue rien.
 */
export function suiviOnglet(initial: string): (courant: string) => boolean {
  let precedent = initial
  return (courant) => {
    const change = courant !== precedent
    precedent = courant
    return change
  }
}

/** Relance l'animation CSS d'entrée de `el` : retire la classe, force un recalcul de style, la remet. */
export function rejouerEntree(el: Pick<HTMLElement, 'classList' | 'offsetWidth'> | null, classe = 'entree-liste') {
  if (!el) return
  el.classList.remove(classe)
  void el.offsetWidth
  el.classList.add(classe)
}

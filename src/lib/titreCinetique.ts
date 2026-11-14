// Boucle animations, cycle 2 : typographie cinétique des en-têtes de catégorie du menu Découverte (MenuPublic.tsx).
// Le nom est découpé en mots, chacun révélé depuis son propre masque (CSS `.mot-masque` / `.mot` dans src/index.css).
// Module importé par la seule page différée du menu : il reste dans son morceau, hors du bundle initial.

/** Mots du nom de catégorie, dans l'ordre (espaces multiples ignorés). */
export function motsTitre(nom: string): string[] {
  return nom.split(/\s+/).filter(Boolean)
}

/** Longueur (en caractères) du plus long mot : le titre géant se règle dessus pour qu'aucun mot ne déborde du cadre. */
export function plusLongMot(nom: string): number {
  return Math.max(1, ...motsTitre(nom).map((m) => [...m].length))
}

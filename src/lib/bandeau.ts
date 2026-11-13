// Bandeaux défilants des surfaces Découverte (#/bienvenue, #/menu) — Expérience cycle 3, lot 1.
// Logique pure, testée (tests/experience-cycle3.test.ts) ; le rendu est src/components/BandeauDefilant.tsx.
// Les mots défilés sont des DONNÉES du restaurant (noms de plats, de catégories) : jamais traduits, jamais inventés.

/**
 * Plats signatures d'Asian Home : copie de `PLATS_SIGNATURE` (src/data/menu-reel.ts), recopiée ici pour ne pas tirer
 * toute la carte dans la page d'accueil ; un test vérifie que les deux listes restent identiques.
 */
export const SIGNATURES_ASIAN_HOME = ['Dynamite', 'Thaï-sty Krusty', 'Love Bao', 'Loc Lac', '8 Maki Chicken Dragon', '8 Maki Tiger']

/** Familles de la carte officielle d'Asian Home (relevée le 10/11/2026), dans l'ordre du menu. */
export const CATEGORIES_ASIAN_HOME = ['Salades', 'California', 'Maki', 'Sashimi', 'Sushi', 'Poke Bowl', 'Entrées thaï', 'Plats thaï', 'Desserts', 'Cocktails']

/**
 * Mots des deux bandeaux de l'accueil. Hors Asian Home : aucun bandeau — le nom du commerce est déjà en grand juste
 * au-dessus et un « Découvrir la carte » qui défile sans être cliquable imiterait le vrai bouton ; rien d'autre de
 * factuel à faire défiler.
 */
export function motsBandeauxAccueil(asianHome: boolean): { signatures: string[]; categories: string[] } {
  return asianHome ? { signatures: SIGNATURES_ASIAN_HOME, categories: CATEGORIES_ASIAN_HOME } : { signatures: [], categories: [] }
}

/** Noms distincts, dans l'ordre (une même photo de plat peut revenir dans deux catégories). */
export function motsUniques(noms: string[]): string[] {
  return [...new Set(noms.map((n) => n.trim()).filter(Boolean))]
}

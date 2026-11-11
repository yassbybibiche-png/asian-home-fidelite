// Thème NOIR + MAGENTA (P0-D1, AUDIT.md §6) — source effective unique de la DA.
//
// Règle d'isolation : AUCUN hexadécimal de couleur n'existe ailleurs que dans ce fichier.
// `src/index.css` (`@theme`) n'en est que le miroir (même valeurs, vérifié par tests/theme.test.ts),
// `src/chargement.css` et `public/hors-ligne.css` (écrans avant JS) en reprennent deux valeurs,
// vérifiées elles aussi par le test. Changer de DA = changer ce fichier (+ le miroir), pas 30 fichiers.
// Les valeurs du thème n'existent sous AUCUNE autre forme ailleurs : pas de rgb()/rgba() d'une
// couleur du thème (les halos et ombres utilisent color-mix() sur les tokens @theme), sauf les
// neutres d'ombre rgb(17 24 39) = gris-900 Tailwind et blanc/noir. Le miroir reste manuel mais le
// test l'impose exact : toute dérive fait échouer la suite (revue Codex P0-D1, point 2 — la
// génération du CSS depuis ce fichier a été écartée : les feuilles avant-JS ne peuvent pas
// consommer de tokens TS au chargement, et le test rend la copie manuelle sûre).
//
// Règles de lisibilité (ratios WCAG recalculés par nos soins, P0-D1 — ne pas recopier les chiffres
// de l'ancien commentaire CSS, dont le « 8,9:1 » pour l'or était faux, vrai calcul 7,81:1) :
// - sur fond noir (#111111), le magenta CLAIR sert de TEXTE : #ff2e9a = 5,49:1, #ff4d6d = 5,88:1 (AA) ;
// - le magenta FONCÉ sert de FOND de bouton (texte blanc) : #d1006f = 5,33:1, #c4007a = 5,79:1,
//   #a1005e = 7,84:1 (AA) — jamais comme texte sur noir (3,54:1 / 3,26:1, insuffisant) ;
// - le magenta clair ne sert jamais de texte sur fond clair (#ff2e9a sur #f7f5f2 = 3,16:1) :
//   sur fond clair, le texte d'accent est #a1005e (7,21:1) ou #c4007a (5,32:1) ;
// - le rouge laque #b3262d (blanc dessus 6,5:1) ne reste qu'en réserve danger/erreur : il n'est
//   plus utilisé comme couleur primaire, titre ou décor — les états d'erreur actuels utilisent
//   déjà les rouges Tailwind (red-*), inchangés (on ne magenta-ifie pas les états) ;
// - la teinte magenta exacte de la carte du restaurant n'a pas été relevée du PDF (AUDIT.md §8 n° 4) :
//   la palette ci-dessous est un choix vérifié par le calcul, ajustable en 1 changement ici.
export const THEME = {
  blanc: '#ffffff',
  noir: '#111111',
  surface: '#1b1b22',
  surface2: '#26262e',
  fondClair: '#f7f5f2',
  ivoire: '#fbf8f3',
  ivoireRoue: '#fbf3e4',
  roseClair: '#fdf3f2',
  texteFonce: '#111827',
  encre: '#1f2937',
  // Magenta : 300/400 = texte sur noir ; 500/600/700 = fonds (texte blanc) ; 900 = fond sombre.
  magenta300: '#ff4d6d',
  magenta400: '#ff2e9a',
  magenta500: '#d1006f',
  magenta600: '#c4007a',
  magenta700: '#a1005e',
  magenta900: '#2a0a1e',
  // Rouge laque, échelle conservée comme réserve danger/erreur uniquement (voir ci-dessus).
  laque50: '#fdf3f2',
  laque100: '#fbe3e1',
  laque200: '#f5c2be',
  laque300: '#e98f89',
  laque500: '#b3262d',
  laque600: '#9c1f26',
  laque700: '#7f1a1f',
  laque800: '#5e1317',
  violetNuit: '#3b2d8f',
} as const

/** Secteurs de la roue (src/lib/roue.ts) : noir / magenta / ivoire, texte ≥ 4,5:1 sur chaque secteur. */
export const COULEURS_ROUE = [THEME.magenta700, THEME.noir, THEME.magenta400, THEME.ivoireRoue, THEME.surface2, THEME.roseClair] as const

/** Confettis du gain (src/lib/animationRoue.ts) : décor uniquement, jamais du texte. */
export const COULEURS_CONFETTIS = [THEME.magenta400, THEME.magenta300, THEME.magenta500, THEME.magenta700, THEME.blanc, THEME.surface2] as const

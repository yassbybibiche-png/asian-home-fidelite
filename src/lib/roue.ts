// Affichage de la roue (P0-U2) : couleurs des secteurs, libellés lisibles, légende. Aucune logique de tirage ici.
import { secteurs, type LotRoue } from './roulette.ts'
import { COULEURS_ROUE, THEME } from '../theme.ts'
import { assombrir, contraste, estCouleur, melanger, problemesApparence } from './apparence.ts'

/**
 * Règle d'affichage : un libellé de 12 caractères au plus tient en entier sur un secteur ≥ 30°, en police
 * 9 unités du viewBox (200) — soit ≥ 14 px dès que la roue fait 312 px de large. Sur #/jouer, la roue mesure
 * min(340 px, écran − 42,5 px) (racine à 17 px) : 14,3 px à 360 px d'écran, 15 px à 375 px, 15,3 px au-delà.
 * Au-delà, il est abrégé sur la roue ; la légende sous la roue montre toujours le libellé complet.
 */
export const MAX_CARACTERES_ROUE = 12
export const POLICE_ROUE = 9
/** Secteur assez large pour son libellé ; en dessous, seul son numéro de légende est écrit. */
export const ANGLE_MIN_LIBELLE = 30
/** En dessous, rien n'est écrit dans le secteur (le numéro ne tiendrait pas) : la légende suffit. */
export const ANGLE_MIN_NUMERO = 12
/** Longueur utile le long du rayon, centrée sur RAYON_LIBELLE : de r = 18 (moyeu r = 15) à r = 86 (bord r = 88). */
export const LONGUEUR_TEXTE_MAX = 68
/** Centre du libellé sur le rayon. */
export const RAYON_LIBELLE = 52

// Palette noir / magenta / ivoire (P0-D1) ; texte choisi pour un contraste ≥ 4,5:1 sur chaque secteur.
export const COULEURS = [...COULEURS_ROUE]

/** Couleur du secteur i sur n : jamais identique à sa voisine, même quand le dernier secteur rejoint le premier. */
export function couleurSecteur(i: number, n: number, palette: readonly string[] = COULEURS): string {
  return n > 1 && i === n - 1 && i % palette.length === 0 ? palette[2] : palette[i % palette.length]
}

const FONDS_CLAIRS: Set<string> = new Set([THEME.ivoireRoue, THEME.roseClair])

/**
 * Texte d'un secteur : le plus contrasté du blanc et du noir (magenta clair : noir 5,49:1, blanc 3,44:1 seulement),
 * encre sur les fonds clairs du thème. Vaut aussi pour les teintes dérivées d'une couleur de commerce (R5).
 */
export function couleurTexte(fond: string): string {
  if (contraste(fond, THEME.blanc) >= contraste(fond, THEME.noir)) return THEME.blanc
  return FONDS_CLAIRS.has(fond) ? THEME.encre : THEME.noir
}

/** Couleur d'accent de la roue (R5) : celle du commerce si elle est valide (blanc lisible dessus), sinon aucune. */
export function accentRoue(couleur: string | undefined): string | undefined {
  return estCouleur(couleur) && !problemesApparence({ couleur }).length ? couleur.toLowerCase() : undefined
}

/** Teinte claire de l'accent (filets, perles, pointeur) : mélange avec du blanc, toujours foncé-lisible. */
export const accentClair = (couleur: string) => melanger(couleur, THEME.blanc, 0.55)

/**
 * Palette des secteurs pour une couleur de commerce (R5) : mêmes rôles que COULEURS_ROUE (foncé, noir, clair,
 * ivoire, gris nuit, très clair) avec la couleur du commerce à la place du magenta. Texte ≥ 4,5:1 sur chacune.
 */
export function paletteRoue(couleur?: string): readonly string[] {
  const c = accentRoue(couleur)
  if (!c) return COULEURS
  // Couleur sombre : prise telle quelle (blanc lisible garanti) — l'assombrir la confondrait avec son voisin noir ;
  // les filets clairs (R8) séparent les deux. Quasi noire : éclaircie. Sinon, une nuance plus profonde (magenta 700 / 500).
  const k = contraste(c, THEME.noir)
  const fonce = k < 1.4 ? melanger(c, THEME.blanc, 0.75) : k < 2 ? c : assombrir(c, 0.8)
  // Teinte dans la bande où ni le blanc ni le noir n'atteignent 4,5:1 (luminance ≈ 0,18–0,2) : éclaircie de 15 %.
  return [fonce, THEME.noir, accentClair(c), THEME.ivoireRoue, THEME.surface2, melanger(c, THEME.blanc, 0.12)].map((f) =>
    contraste(f, couleurTexte(f)) < 4.5 ? melanger(f, THEME.blanc, 0.85) : f,
  )
}

/**
 * Teintes du décor fixe (R8), en variables CSS — anneau, perles, pointeur, moyeu, halo : dérivées de la couleur active (magenta du
 * thème par défaut, sinon celle du commerce). Jamais du texte : `clair` sert aux reflets et aux filets.
 */
export function teintesRoue(couleur?: string): Record<'--roue-vif' | '--roue-fonce' | '--roue-nuit' | '--roue-clair', string> {
  const c = accentRoue(couleur)
  const [vif, fonce, nuit, clair] = c ? [c, assombrir(c, 0.62), assombrir(c, 0.22), accentClair(c)] : [THEME.magenta500, THEME.magenta700, THEME.magenta900, THEME.magenta400]
  return { '--roue-vif': vif, '--roue-fonce': fonce, '--roue-nuit': nuit, '--roue-clair': clair }
}

/** Secteurs recolorés à la couleur du commerce (roue ET légende, mêmes couleurs). Sans couleur valide : inchangés. */
export function colorerSecteurs(parts: SecteurAffiche[], couleur?: string): SecteurAffiche[] {
  const palette = paletteRoue(couleur)
  if (palette === COULEURS) return parts
  return parts.map((s, i) => {
    const fond = couleurSecteur(i, parts.length, palette)
    return { ...s, couleur: fond, couleurTexte: couleurTexte(fond) }
  })
}

const caracteres = (texte: string) => Array.from(texte.trim())

export function longueurLibelle(texte: string): number {
  return caracteres(texte).length
}

/**
 * Libellé tel qu'écrit sur la roue : complet s'il tient, sinon coupé à la fin d'un mot quand c'est possible
 * (« Thé glacé maison offert » → « Thé glacé… ») et toujours marqué d'une ellipse — jamais tronqué en silence.
 */
export function abreger(texte: string, max = MAX_CARACTERES_ROUE): string {
  const c = caracteres(texte)
  if (c.length <= max) return c.join('')
  const debut = c.slice(0, max - 1).join('')
  const espace = debut.lastIndexOf(' ')
  const coupe = espace >= Math.ceil((max - 1) / 2) ? debut.slice(0, espace) : debut
  return `${coupe.replace(/[\s,;:.!?–—-]+$/, '')}…`
}

/** Largeur estimée (unités du viewBox) d'un texte gras en police système. */
export function largeurEstimee(texte: string, police = POLICE_ROUE): number {
  return longueurLibelle(texte) * police * 0.6
}

export type AffichageSecteur = 'libelle' | 'numero' | 'aucun'

export function affichageSecteur(etendue: number): AffichageSecteur {
  // Tolérance : 12 secteurs égaux font 30° « à l'arrondi flottant près ».
  if (etendue >= ANGLE_MIN_LIBELLE - 1e-6) return 'libelle'
  if (etendue >= ANGLE_MIN_NUMERO - 1e-6) return 'numero'
  return 'aucun'
}

export interface SecteurAffiche {
  numero: number
  /** Libellé complet (légende, écran de gain). */
  libelle: string
  /** Texte écrit dans le secteur ('' si le secteur est trop étroit). */
  texteRoue: string
  abrege: boolean
  affichage: AffichageSecteur
  debut: number
  fin: number
  couleur: string
  couleurTexte: string
}

/** Secteurs de la roue avec ce qui est écrit dedans ; même ordre et mêmes couleurs que la légende. */
export function secteursAffiches(lots: LotRoue[]): SecteurAffiche[] {
  const parts = secteurs(lots)
  return parts.map((s, i) => {
    const libelle = s.lot.libelle.trim()
    const affichage = affichageSecteur(s.fin - s.debut)
    const couleur = couleurSecteur(i, parts.length)
    const texteRoue = affichage === 'libelle' ? abreger(libelle) : affichage === 'numero' ? String(i + 1) : ''
    return { numero: i + 1, libelle, texteRoue, abrege: affichage === 'libelle' && texteRoue !== libelle, affichage, debut: s.debut, fin: s.fin, couleur, couleurTexte: couleurTexte(couleur) }
  })
}

/** Compteur de Réglages : « X/12 caractères affichés sur la roue ». */
export function compteurLibelle(texte: string): { longueur: number; max: number; depasse: boolean; texte: string } {
  const longueur = longueurLibelle(texte)
  return { longueur, max: MAX_CARACTERES_ROUE, depasse: longueur > MAX_CARACTERES_ROUE, texte: `${longueur}/${MAX_CARACTERES_ROUE} caractères affichés sur la roue` }
}

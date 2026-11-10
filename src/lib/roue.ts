// Affichage de la roue (P0-U2) : couleurs des secteurs, libellés lisibles, légende. Aucune logique de tirage ici.
import { secteurs, type LotRoue } from './roulette.ts'

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

// Palette laque / encre / ivoire / or ; texte choisi pour un contraste ≥ 4,5:1 sur chaque secteur.
export const COULEURS = ['#b3262d', '#fbf3e4', '#1f2937', '#f2d48a', '#7f1a1f', '#fdf3f2']
const FONDS_SOMBRES = new Set(['#b3262d', '#1f2937', '#7f1a1f'])

/** Couleur du secteur i sur n : jamais identique à sa voisine, même quand le dernier secteur rejoint le premier. */
export function couleurSecteur(i: number, n: number): string {
  return n > 1 && i === n - 1 && i % COULEURS.length === 0 ? COULEURS[2] : COULEURS[i % COULEURS.length]
}

export function couleurTexte(fond: string): string {
  return FONDS_SOMBRES.has(fond) ? '#fff' : '#1f2937'
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

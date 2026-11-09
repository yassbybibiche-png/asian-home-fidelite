// Apparence de la carte : couleurs vérifiées (contraste WCAG ≥ 4,5:1), charte par défaut inchangée.
import type { Apparence } from '../types'

export const COULEUR_DEFAUT = '#b3262d' // rouge laque
export const FOND_DEFAUT = '#fbf8f3' // ivoire
export const TEXTE_FONCE = '#111827'
export const CONTRASTE_MIN = 4.5

export const estCouleur = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s)

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contraste(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100
}

/** Problèmes de lisibilité (texte blanc sur la couleur, texte foncé sur le fond). Vide = conforme. */
export function problemesApparence(a: Apparence): string[] {
  const p: string[] = []
  if (a.couleur) {
    if (!estCouleur(a.couleur)) p.push('Couleur principale : format #rrggbb attendu.')
    else if (contraste(a.couleur, '#ffffff') < CONTRASTE_MIN) p.push(`Couleur principale trop claire : texte blanc illisible (contraste ${contraste(a.couleur, '#ffffff')}:1, il faut ${CONTRASTE_MIN}:1).`)
  }
  if (a.fond) {
    if (!estCouleur(a.fond)) p.push('Fond : format #rrggbb attendu.')
    else if (contraste(a.fond, TEXTE_FONCE) < CONTRASTE_MIN) p.push(`Fond trop foncé : texte illisible (contraste ${contraste(a.fond, TEXTE_FONCE)}:1, il faut ${CONTRASTE_MIN}:1).`)
  }
  if (a.banniere && !/^https:\/\/\S+$/i.test(a.banniere)) p.push('Bannière : adresse https://… d’une image attendue.')
  return p
}

/** Assombrit une couleur (dégradé du bandeau). */
export function assombrir(hex: string, facteur = 0.75): string {
  const c = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * facteur))
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

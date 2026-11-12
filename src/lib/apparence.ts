// Apparence de la carte : couleurs vérifiées (contraste WCAG ≥ 4,5:1). Défauts P0-D1 : magenta/noir (AUDIT.md §6.4).
import type { Apparence } from '../types'
import { THEME } from '../theme.ts'

export const COULEUR_DEFAUT = THEME.magenta500 // magenta bouton (blanc dessus : 5,33:1)
export const FOND_DEFAUT = THEME.ivoire // ivoire — voir JOURNAL P0-D1 : le noir n'est pas un fond de carte valide (texte foncé dessus)
export const TEXTE_FONCE = THEME.texteFonce
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
    else if (contraste(a.couleur, THEME.blanc) < CONTRASTE_MIN) p.push(`Couleur principale trop claire : texte blanc illisible (contraste ${contraste(a.couleur, THEME.blanc)}:1, il faut ${CONTRASTE_MIN}:1).`)
  }
  if (a.fond) {
    if (!estCouleur(a.fond)) p.push('Fond : format #rrggbb attendu.')
    else if (contraste(a.fond, TEXTE_FONCE) < CONTRASTE_MIN) p.push(`Fond trop foncé : texte illisible (contraste ${contraste(a.fond, TEXTE_FONCE)}:1, il faut ${CONTRASTE_MIN}:1).`)
  }
  if (a.banniere && !/^https:\/\/\S+$/i.test(a.banniere)) p.push('Bannière : adresse https://… d’une image attendue.')
  return p
}

/** Mélange `part` de la couleur `a` avec `b` (teintes claires de la roue, R5). */
export function melanger(a: string, b: string, part: number): string {
  const c = [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * part + parseInt(b.slice(i, i + 2), 16) * (1 - part)))
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

/** Assombrit une couleur (dégradé du bandeau). */
export function assombrir(hex: string, facteur = 0.75): string {
  const c = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * facteur))
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

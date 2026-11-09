// Invitation à l'avis Google (logique pure, testée dans tests/invitation-avis.test.ts).
//
// Limite Google : le lien « writereview » ne permet PAS de pré-sélectionner une note.
// Les 5 étoiles pré-remplies n'existent donc que DANS l'app ; le client confirme ses étoiles sur Google.
// Le lien du commerce est utilisé tel quel : aucun paramètre n'y est ajouté.
import type { Commerce } from '../types'

export const NOTE_PAR_DEFAUT = 5
export const NOTE_MAX = 5

/** Note choisie après un tap sur l'étoile n (bornée entre 1 et 5). */
export function choisirNote(n: number): number {
  if (!Number.isFinite(n)) return NOTE_PAR_DEFAUT
  return Math.min(NOTE_MAX, Math.max(1, Math.round(n)))
}

/** État de chaque étoile (true = remplie) pour une note donnée. */
export function etoilesRemplies(note: number): boolean[] {
  return Array.from({ length: NOTE_MAX }, (_, i) => i < note)
}

/** Lien Google du commerce, inchangé (ou null s'il n'est pas renseigné). */
export function lienAvisGoogle(commerce: Pick<Commerce, 'lienGoogle'>): string | null {
  const lien = commerce.lienGoogle?.trim() ?? ''
  return /^https?:\/\//i.test(lien) ? lien : null
}

export const TEXTE_INVITATION = 'Votre avis compte — touchez une étoile pour ajuster, puis laissez votre avis sur Google.'
export const TEXTE_CONFIRMATION_GOOGLE = 'Google s’ouvre dans un nouvel onglet : sélectionnez-y vos étoiles et publiez votre avis.'

export function libelleBoutonAvis(note: number): string {
  return `Laisser un avis ${choisirNote(note)}★ sur Google`
}

export function libelleNote(note: number): string {
  return ['', 'Décevant', 'Moyen', 'Bien', 'Très bien', 'Excellent'][choisirNote(note)]
}

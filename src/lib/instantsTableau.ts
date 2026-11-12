// Instants gagnants (D1) — affichage du tableau de bord. À part de `instants.ts` (Réglages, serveur) : un module
// partagé par deux pages paresseuses deviendrait un chunk commun, listé dans le bundle initial (plafond P2-Q2).
import type { Lot } from '../types'

/** Issue d'un instant passé, telle que la route commerçant la donne (`GET …/instants-gagnants`). */
export type StatutInstant = 'gagne' | 'bloque' | 'enCours' | 'sansGagnant'

export interface InstantPasse {
  heure: string
  lot: string
  statut: StatutInstant
  /** Prénom du gagnant (s'il en a un). */
  gagnant?: string
}

/** Le commerce a-t-il au moins un lot physique à instants gagnants ? (même règle que `lotsAInstants`) */
export const aDesInstants = (lots: Pick<Lot, 'type' | 'instantsParJour'>[]) => lots.some((l) => l.type === 'lot' && (l.instantsParJour ?? 0) > 0)

/** Ligne du tableau de bord : « Instant 12:04 — gagné (Thé glacé) par Lin » / « Instant 19:37 — passé sans gagnant ». */
export function texteInstant(i: InstantPasse): string {
  const heure = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(i.heure))
  if (i.statut === 'gagne') return `Instant ${heure} — gagné (${i.lot})${i.gagnant ? ` par ${i.gagnant}` : ''}`
  if (i.statut === 'bloque') return `Instant ${heure} — déclenché, mais « ${i.lot} » était indisponible (plafond du jour atteint) : tirage normal`
  if (i.statut === 'enCours') return `Instant ${heure} — en cours (${i.lot}), encore gagnable quelques minutes`
  return `Instant ${heure} — passé sans gagnant (${i.lot})`
}

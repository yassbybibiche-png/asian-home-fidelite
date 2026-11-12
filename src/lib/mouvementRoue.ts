// Mouvement de la roue (P1-C2) : durée, courbe, préférence « mouvement réduit ». Module SANS dépendance, importé par
// la roue (Roue.tsx) et réexporté par animationRoue.ts. Réglages → Roulette (R6) affiche aussi la roue : si Roue.tsx
// importait animationRoue (→ roulette.ts, theme.ts), le découpage du build sortait 3 petits chunks du bundle initial
// (+600 o d'imports, au-delà du plafond P2-Q2).

/** Rotation de la roue : 3,6 s (fourchette demandée 3 à 4 s). Animation CSS de `transform` seul (composité, 60 fps). */
export const DUREE_ROTATION_MS = 3600
/** Courbe de décélération : départ vif, longue fin qui ralentit sous le pointeur. */
export const COURBE_ROTATION = 'cubic-bezier(0.15, 0.85, 0.2, 1)'

export const REQUETE_MOUVEMENT_REDUIT = '(prefers-reduced-motion: reduce)'

/** Vrai si le téléphone demande moins d'animations (réglage d'accessibilité). Sans `matchMedia` : animation normale. */
export function prefereMouvementReduit(w: { matchMedia?: (q: string) => { matches: boolean } } | undefined = globalThis as never): boolean {
  try {
    return !!w?.matchMedia?.(REQUETE_MOUVEMENT_REDUIT).matches
  } catch {
    return false
  }
}

/** Durée de la rotation affichée. */
export function dureeRotation(reduit: boolean): number {
  return reduit ? 0 : DUREE_ROTATION_MS
}

/** Transition CSS de la couche qui tourne. */
export function transitionRoue(reduit: boolean): string {
  return reduit ? 'none' : `transform ${DUREE_ROTATION_MS}ms ${COURBE_ROTATION}`
}

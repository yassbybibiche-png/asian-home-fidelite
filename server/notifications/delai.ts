// Délai maximal d'un appel prestataire (Brevo e-mail / SMS, Twilio) — point Codex 10.
// Sans délai, une réponse bloquée immobiliserait la tournée de relances (séquentielle) et laisserait l'envoi réservé
// en `en_cours`. Passé ce délai, `fetch` rejette avec une erreur nommée `TimeoutError` (AbortSignal.timeout) : le
// serveur consigne alors l'envoi `incertain` (peut-être parti), jamais renvoyé automatiquement.
// 10 s : largement au-dessus d'une réponse normale des API (quelques centaines de ms), assez court pour la tournée.
export const DELAI_PRESTATAIRE_MS = 10_000

/** Erreur d'abandon d'un appel réseau (délai dépassé ou requête annulée) : l'envoi a pu partir ou non. */
export function estAbandon(e: unknown): boolean {
  const nom = typeof e === 'object' && e !== null ? (e as { name?: unknown }).name : undefined
  return nom === 'TimeoutError' || nom === 'AbortError'
}

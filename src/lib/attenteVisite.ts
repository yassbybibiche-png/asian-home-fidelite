// Attente de la visite validée au comptoir, sur #/jouer (P0-U4). Textes, rythme de vérification et détection du
// déblocage : logique pure, testée sans navigateur. Aucune règle métier ici : le serveur décide (visite du jour,
// 1 tirage par jour) ; la page ne fait que redemander son statut.
import type { StatutJeu } from './roulette.ts'

/** Étapes affichées au client qui a scanné avant que sa visite soit validée (ordre = ordre des gestes). */
export const ETAPES_VALIDATION = ['Présentez votre carte de fidélité en caisse.', 'Revenez ici : la roue se débloque toute seule.'] as const

export const INTRO_ATTENTE = 'Plus que deux petites étapes avant de tourner la roue :'
export const TEXTE_ATTENTE = 'En attente de validation…'
export const MESSAGE_VISITE_VALIDEE = 'Visite validée — à vous de jouer !'
export const MESSAGE_ATTENTE_HORS_LIGNE =
  'Connexion perdue : impossible de vérifier votre visite pour le moment. Nous réessayons automatiquement dès le retour du réseau.'

/** Rythme normal de vérification pendant l'attente (inchangé depuis la V2). */
export const INTERVALLE_VERIFICATION_MS = 10_000
/** Plafond après des échecs réseau répétés : on ne martèle pas un serveur endormi ou injoignable. */
export const INTERVALLE_MAX_MS = 60_000

/**
 * Délai avant la prochaine vérification : 10 s tant que le serveur répond, puis 20 s, 40 s, 60 s (plafond) après
 * 1, 2, 3+ échecs consécutifs. Le retour du réseau, du focus ou un tap « Vérifier maintenant » relancent tout de suite.
 */
export function delaiProchaineVerification(echecsConsecutifs: number): number {
  const n = Math.max(0, Math.floor(echecsConsecutifs))
  return Math.min(INTERVALLE_VERIFICATION_MS * 2 ** n, INTERVALLE_MAX_MS)
}

/** Vérifier en boucle seulement tant que la roue est verrouillée (statut inconnu ou visite pas encore validée). */
export function doitVerifier(statut: StatutJeu | null | undefined): boolean {
  return statut == null || statut === 'sansVisite'
}

/**
 * Après une vérification (statut reçu, ou null si le serveur n'a pas répondu) : nouveau compteur d'échecs et délai
 * avant la suivante, ou null quand la roue n'est plus verrouillée (prête ou déjà jouée) — la boucle s'arrête.
 */
export function apresVerification(statut: StatutJeu | null, echecs: number): { echecs: number; delai: number | null } {
  const suivants = statut ? 0 : echecs + 1
  return { echecs: suivants, delai: doitVerifier(statut) ? delaiProchaineVerification(suivants) : null }
}

/** Déblocage observé : le statut passe de « sans visite » à « prêt » (la caisse vient de valider la visite). */
export function visiteVientDEtreValidee(avant: StatutJeu | null | undefined, apres: StatutJeu | null | undefined): boolean {
  return avant === 'sansVisite' && apres === 'pret'
}

export interface SuiviVisite {
  statut: StatutJeu | null | undefined
  /** Reste vrai une fois le déblocage vu (jusqu'au tirage) : le message de confirmation ne clignote pas. */
  validee: boolean
}

/** Suit les statuts successifs vus par la page. Un client déjà validé à son arrivée ne voit pas de confirmation. */
export function suivreVisite(suivi: SuiviVisite, statut: StatutJeu | null | undefined): SuiviVisite {
  if (suivi.statut === statut) return suivi
  return { statut, validee: suivi.validee || visiteVientDEtreValidee(suivi.statut, statut) }
}

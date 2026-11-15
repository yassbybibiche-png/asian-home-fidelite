// Démarrages à froid Render (P3-5) — mesure, pas de décision.
//
// Le plan Free endort le service après ~15 min sans appel ; le premier appel ensuite attend le réveil du
// conteneur (~1 min, cf. l'écran d'attente honnête). Le serveur ne peut PAS mesurer ce délai lui-même : il
// ne voit la requête qu'une fois le conteneur réveillé. Seul le navigateur voit l'attente complète — c'est
// donc lui qui la mesure, sur son premier appel API, et qui signale UN événement anonyme par tranche de délai.
//
// Règles de comptage (toutes testées dans tests/demarrage-a-froid-p3-5.test.ts) :
// • seuil : un appel de 10 s ou plus compte comme démarrage à froid probable (la latence normale est très
//   inférieure ; le délai client par défaut est lui-même de 10 s, un appel qui l'atteint est exceptionnel) ;
// • tranches : 10–30 s (`froid10a30s`) et 30 s ou plus (`froidPlus30s`, proche de la minute annoncée) ;
// • attribution : seuls les appels sur un chemin `/commerces/<id>/…` sont comptés (l'entrée par QR,
//   `#/jouer/<id>`) — les ouvertures directes de carte (`/cartes/<id>`) n'ont pas d'identifiant de commerce
//   dans le chemin et ne sont PAS comptées (limite documentée dans docs/VEILLE-RENDER.md) ;
// • appels marchands exclus (`acces` présent : tableau de bord, caisse, réglages — ce ne sont pas des
//   clients) ; la balise elle-même (`POST …/evenements`) n'est jamais mesurée ;
// • au plus UN événement par quart d'heure et par onglet : les réessais d'un même réveil (`tenterPendant`,
//   toutes les 3 s) ne comptent qu'une fois, et un onglet laissé ouvert ne spamme pas les compteurs.
// La balise est un compteur anonyme par jour, comme `scan` : aucune identité, aucun délai exact stocké —
// seule la tranche. Sans la migration 0011, le serveur refuse le type (CHECK) et la balise est ignorée.

/** Durée d'un appel à partir de laquelle on parle de démarrage à froid probable. */
export const SEUIL_FROID_MS = 10_000
/** Durée à partir de laquelle le démarrage à froid est certain (proche de la minute annoncée). */
export const SEUIL_FROID_LONG_MS = 30_000
/** Entre deux signalements depuis le même onglet : un réveil ne compte qu'une fois. */
export const DELAI_MIN_ENTRE_SIGNAUX_MS = 15 * 60_000

/** Tranches de démarrage à froid, comptées comme des événements anonymes. */
export type TypeFroid = 'froid10a30s' | 'froidPlus30s'
export const TYPES_FROID: TypeFroid[] = ['froid10a30s', 'froidPlus30s']

/** Tranche du délai, ou null si l'appel n'a rien d'un démarrage à froid. */
export function trancheFroid(delaiMs: number): TypeFroid | null {
  if (!Number.isFinite(delaiMs) || delaiMs < SEUIL_FROID_MS) return null
  return delaiMs < SEUIL_FROID_LONG_MS ? 'froid10a30s' : 'froidPlus30s'
}

/** Identifiant du commerce dans un chemin d'API (`/commerces/<id>` ou `/commerces/<id>/…`), ou null (pas de commerce dans le chemin). */
export function extraireCommerceId(chemin: string): string | null {
  const m = /^\/commerces\/([^/?#]+)(?:\/|$|\?)/.exec(chemin)
  if (!m) return null
  try {
    return decodeURIComponent(m[1])
  } catch {
    return m[1]
  }
}

/** Un appel est mesurable : sur un commerce, et autre que la balise elle-même. */
export function cheminMesurable(chemin: string): boolean {
  if (chemin.endsWith('/evenements')) return false
  return extraireCommerceId(chemin) !== null
}

/** Garde « au plus un signalement par quart d'heure » (horloge injectable pour les tests). */
export function creerGardeFroid(maintenant: () => number = () => Date.now()): { peutSignaler: () => boolean; marquer: () => void } {
  let dernierSignal = Number.NEGATIVE_INFINITY
  return {
    peutSignaler: () => maintenant() - dernierSignal >= DELAI_MIN_ENTRE_SIGNAUX_MS,
    marquer: () => {
      dernierSignal = maintenant()
    },
  }
}

/** Type d'événement à signaler pour un appel, ou null (appel rapide, non attribuable, ou balise). */
export function evenementFroid(chemin: string, delaiMs: number): TypeFroid | null {
  if (!cheminMesurable(chemin)) return null
  return trancheFroid(delaiMs)
}

const gardeModule = creerGardeFroid()

/**
 * Signale un appel lent (démarrage à froid) en arrière-plan, via `envoyer` (le fetch du client API —
 * injecté pour les tests, le fetch global en production). Ne fait rien pour un appel rapide, marchand,
 * non attribuable, ou pour la balise elle-même (voir `signalerSiFroid`). La balise part avec le délai de
 * 5 s du client (`signalDelai`, avec son repli Safari iOS < 16 — voir `src/data/api.ts`) et n'est jamais
 * attendue. La garde est celle du module (un onglet = un module) sauf si le test en injecte une autre.
 */
export function noterAppelLent(
  chemin: string,
  debut: number,
  acces: boolean,
  base: string,
  envoyer: typeof fetch,
  signalDelai: (ms: number) => AbortSignal | undefined,
  garde: { peutSignaler: () => boolean; marquer: () => void } = gardeModule,
): void {
  if (acces) return
  signalerSiFroid(
    chemin,
    Date.now() - debut,
    (commerceId, tranche) => {
      void envoyer(`${base}/commerces/${encodeURIComponent(commerceId)}/evenements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: tranche }),
        signal: signalDelai(5_000),
      }).catch(() => {})
    },
    garde,
  )
}

/**
 * Signale un appel lent (démarrage à froid) via `envoyer`, au plus une fois par quart d'heure. La garde est
 * celle du module (un onglet = un module) sauf si le test en injecte une autre. Ne fait rien pour un appel
 * rapide, non attribuable, ou pour la balise elle-même.
 */
export function signalerSiFroid(
  chemin: string,
  delaiMs: number,
  envoyer: (commerceId: string, tranche: TypeFroid) => void,
  garde: { peutSignaler: () => boolean; marquer: () => void } = gardeModule,
): void {
  const tranche = evenementFroid(chemin, delaiMs)
  if (!tranche || !garde.peutSignaler()) return
  const commerceId = extraireCommerceId(chemin)
  if (!commerceId) return
  garde.marquer()
  envoyer(commerceId, tranche)
}

// Démarrages à froid Render (P3-5) — mesure, pas de décision.
//
// Le plan Free endort le service après ~15 min sans appel ; le premier appel ensuite attend le réveil du
// conteneur (~1 min, cf. l'écran d'attente honnête). Le serveur ne peut PAS mesurer ce délai lui-même : il
// ne voit la requête qu'une fois le conteneur réveillé. Seul le navigateur voit l'attente complète — c'est
// donc lui qui la mesure et qui signale UN événement anonyme par tranche de délai.
//
// Ce qui est mesuré (protocole corrigé le 15/11/2026 après l'audit expert — avant : la durée d'UN appel,
// plafonnée par le délai client de 10 s, plus le temps de chargement différé de ce module : la tranche
// « 30 s ou plus » n'était atteignable que par ce biais, et la balise partait avec un abandon à 5 s vers un
// serveur encore endormi, sans aucun renvoi) :
// • un ÉPISODE de réveil : il s'ouvre au premier appel public sans réponse (délai client expiré ou panne
//   réseau) et se ferme à la première réponse reçue pour le même commerce. La durée signalée est celle de
//   l'épisode entier — du premier essai à la première réponse — c'est-à-dire l'attente réellement subie par
//   le client (les réessais de `tenterPendant`, toutes les 3 s, font partie de l'épisode). Un appel lent
//   mais réussi du premier coup (délai propre ≥ seuil) est signalé avec sa durée propre, sans épisode.
// • la durée propre d'un appel est calculée par l'appelant (`src/data/api.ts`) AVANT le chargement différé
//   de ce module : le chargement ne fausse plus la mesure.
// • tranches : 10–30 s (`froid10a30s`) et 30 s ou plus (`froidPlus30s`, proche de la minute annoncée) ;
//   en dessous de 10 s, rien (la latence normale est très inférieure).
// • attribution : seuls les appels sur un chemin `/commerces/<id>/…` sont comptés (l'entrée par QR,
//   `#/jouer/<id>`) — les ouvertures directes de carte (`/cartes/<id>`) n'ont pas d'identifiant de commerce
//   dans le chemin et ne sont PAS comptées (limite documentée dans docs/VEILLE-RENDER.md) ;
// • appels marchands exclus (`acces` présent : tableau de bord, caisse, réglages — ce ne sont pas des
//   clients) ; la balise elle-même (`POST …/evenements`) n'est jamais mesurée.
//
// Livraison (le serveur est souvent encore endormi au moment où l'attente est constatée) :
// • la balise est d'abord déposée dans une FILE PERSISTÉE (`localStorage`) : elle survit à la fermeture de
//   l'onglet et au rechargement de la page ;
// • la livraison se fait par fetch `keepalive`, SANS délai d'abandon artificiel (l'ancien plafond de 5 s
//   tuait la balise avant le réveil complet) ; elle est tentée à chaque dépôt et à chaque appel public
//   réussi ensuite — donc aussi au chargement suivant, pour les balises des sessions passées ;
// • la garde « un signalement par quart d'heure » n'est marquée qu'APRÈS une livraison confirmée par le
//   serveur (avant : marquée avant l'envoi, un échec de livraison bloquait tout renvoi pendant 15 min) ;
//   un dépôt en file encore en attente vaut déduplication pour le même commerce pendant le même délai ;
// • si la page se ferme alors qu'un épisode est encore ouvert (le client repart sans réponse) ou qu'une
//   balise attend encore, un dernier envoi part par `sendBeacon` (accepté par le navigateur = remis ; la
//   garde est marquée à l'acceptation, faute de confirmation possible) avec la tranche de l'attente déjà
//   subie. Limite honnête : sans `sendBeacon` disponible et sans visite suivante, un épisode jamais fermé
//   n'est pas compté — les chiffres restent un minimum.
// La balise est un compteur anonyme par jour, comme `scan` : aucune identité, aucun délai exact stocké —
// seule la tranche. Sans la migration 0011, le serveur refuse le type (CHECK) : la livraison échoue, la
// balise reste en file et la garde n'est pas marquée (le compteur reste à 0, voir docs/VEILLE-RENDER.md).

/** Durée d'un appel à partir de laquelle on parle de démarrage à froid probable. */
export const SEUIL_FROID_MS = 10_000
/** Durée à partir de laquelle le démarrage à froid est certain (proche de la minute annoncée). */
export const SEUIL_FROID_LONG_MS = 30_000
/** Entre deux signalements depuis le même navigateur : un réveil ne compte qu'une fois. */
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

// ---------- Épisodes de réveil : du premier appel sans réponse à la première réponse ----------

/**
 * Suivi des épisodes de réveil, par commerce : `ouvrir` au premier appel resté sans réponse (le début le
 * plus ancien gagne — les réessais d'un même réveil ne repoussent pas le départ), `fermer` à la première
 * réponse reçue : rend la durée totale de l'épisode, ou null s'il n'y en avait pas.
 */
export function creerSuiviReveil(): {
  ouvrir: (commerceId: string, debut: number) => void
  fermer: (commerceId: string, fin: number) => number | null
  ouverts: () => [string, number][]
} {
  const episodes = new Map<string, number>()
  return {
    ouvrir: (commerceId, debut) => {
      const actuel = episodes.get(commerceId)
      if (actuel === undefined || debut < actuel) episodes.set(commerceId, debut)
    },
    fermer: (commerceId, fin) => {
      const debut = episodes.get(commerceId)
      if (debut === undefined) return null
      episodes.delete(commerceId)
      return fin - debut
    },
    ouverts: () => [...episodes.entries()],
  }
}

// ---------- File persistée des balises en attente de livraison ----------

/** Une balise déposée, en attente d'une livraison confirmée par le serveur. */
export interface BaliseFroid {
  commerceId: string
  tranche: TypeFroid
  creeLe: number
}

/** Stockage minimal de la file (injectable pour les tests ; `localStorage` en navigateur). */
export interface StockageBalises {
  lire: () => BaliseFroid[]
  ecrire: (balises: BaliseFroid[]) => void
}

const CLE_FILE_BALISES = 'fideliz:balises-froid:v1'

function baliseValide(v: unknown): v is BaliseFroid {
  if (!v || typeof v !== 'object') return false
  const b = v as Record<string, unknown>
  return typeof b.commerceId === 'string' && (b.tranche === 'froid10a30s' || b.tranche === 'froidPlus30s') && typeof b.creeLe === 'number' && Number.isFinite(b.creeLe)
}

/** Stockage navigateur : `localStorage` si disponible, mémoire de l'onglet sinon (jamais d'exception). */
export function stockageNavigateur(): StockageBalises {
  let memoire: BaliseFroid[] = []
  const ls = (): Storage | null => {
    try {
      return globalThis.localStorage ?? null
    } catch {
      return null
    }
  }
  return {
    lire: () => {
      const s = ls()
      if (!s) return [...memoire]
      try {
        const brut = s.getItem(CLE_FILE_BALISES)
        if (!brut) return []
        const arr: unknown = JSON.parse(brut)
        return Array.isArray(arr) ? arr.filter(baliseValide) : []
      } catch {
        return []
      }
    },
    ecrire: (balises) => {
      memoire = [...balises]
      const s = ls()
      if (!s) return
      try {
        if (balises.length) s.setItem(CLE_FILE_BALISES, JSON.stringify(balises))
        else s.removeItem(CLE_FILE_BALISES)
      } catch {
        // Navigation privée stricte ou quota : la mémoire de l'onglet prend le relais pour la session.
      }
    },
  }
}

/**
 * File des balises en attente. `ajouter` horodate le dépôt (horloge de la file) et refuse un doublon
 * récent pour le même commerce (une balise déjà en file vaut signalement du réveil en cours, même si sa
 * livraison n'est pas encore confirmée).
 */
export function creerFileBalises(
  stockage: StockageBalises,
  maintenant: () => number = () => Date.now(),
): {
  enAttente: () => BaliseFroid[]
  ajouter: (b: { commerceId: string; tranche: TypeFroid }) => boolean
  retirer: (b: BaliseFroid) => void
  marquerEnCours: (b: BaliseFroid) => void
  libererEnCours: (b: BaliseFroid) => void
  estEnCours: (b: BaliseFroid) => boolean
} {
  // Balises dont une livraison est en vol : ni une deuxième livraison ni l'envoi d'urgence de fermeture
  // ne doivent les renvoyer (le serveur compterait deux fois le même réveil).
  const enCours = new Set<string>()
  const cle = (b: BaliseFroid) => `${b.commerceId}|${b.tranche}|${b.creeLe}`
  return {
    enAttente: () => stockage.lire(),
    ajouter: (b) => {
      const file = stockage.lire()
      if (file.some((x) => x.commerceId === b.commerceId && maintenant() - x.creeLe < DELAI_MIN_ENTRE_SIGNAUX_MS)) return false
      file.push({ ...b, creeLe: maintenant() })
      stockage.ecrire(file)
      return true
    },
    retirer: (b) => {
      stockage.ecrire(stockage.lire().filter((x) => !(x.commerceId === b.commerceId && x.tranche === b.tranche && x.creeLe === b.creeLe)))
    },
    marquerEnCours: (b) => {
      enCours.add(cle(b))
    },
    libererEnCours: (b) => {
      enCours.delete(cle(b))
    },
    estEnCours: (b) => enCours.has(cle(b)),
  }
}

// ---------- Livraison ----------

const urlEvenements = (base: string, commerceId: string) => `${base}/commerces/${encodeURIComponent(commerceId)}/evenements`

/**
 * Dépose une balise dans la file (si la garde le permet et sans doublon récent). La garde n'est PAS
 * marquée ici : elle le sera à la livraison confirmée (ou à l'acceptation par `sendBeacon`).
 */
export function deposerBalise(
  commerceId: string,
  tranche: TypeFroid,
  file: ReturnType<typeof creerFileBalises>,
  garde: { peutSignaler: () => boolean; marquer: () => void },
): boolean {
  if (!garde.peutSignaler()) return false
  return file.ajouter({ commerceId, tranche })
}

/**
 * Livre les balises en attente, dans l'ordre, via `envoyer` (le fetch du client API) en `keepalive` et
 * sans délai d'abandon : le serveur peut mettre encore quelques secondes à finir son réveil. Au premier
 * échec (serveur injoignable, type refusé…), on s'arrête : la file reste pour le prochain essai. Chaque
 * livraison confirmée retire la balise de la file et marque la garde. Rend le nombre de balises livrées ;
 * ne rejette jamais.
 */
export async function livrerBalises(
  base: string,
  envoyer: typeof fetch,
  file: ReturnType<typeof creerFileBalises>,
  garde: { peutSignaler: () => boolean; marquer: () => void },
): Promise<number> {
  let livrees = 0
  for (const b of file.enAttente()) {
    if (file.estEnCours(b)) continue // une livraison de cette balise est déjà en vol (appel réussi simultané)
    file.marquerEnCours(b)
    let ok = false
    try {
      const r = await envoyer(urlEvenements(base, b.commerceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: b.tranche }),
        keepalive: true,
      })
      ok = r.ok
    } catch {
      ok = false
    } finally {
      file.libererEnCours(b)
    }
    if (!ok) break
    file.retirer(b)
    garde.marquer()
    livrees++
  }
  return livrees
}

/** Envoi « dernier recours » à la fermeture de la page : true si le navigateur a accepté la remise. */
export type EnvoyerBeacon = (url: string, corps: string) => boolean

/** `navigator.sendBeacon` s'il existe (le corps part en `application/json`, même origine). */
export function beaconNavigateur(): EnvoyerBeacon | null {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return null
    return (url, corps) => navigator.sendBeacon(url, new Blob([corps], { type: 'application/json' }))
  } catch {
    return null
  }
}

/**
 * Fermeture de page : signale les épisodes encore ouverts (tranche de l'attente déjà subie) et rejoue la
 * file en attente, le tout par `beacon`. Chaque envoi accepté marque la garde et nettoie (épisode fermé,
 * balise retirée) — pas de confirmation serveur possible par ce canal, l'acceptation du navigateur tient
 * lieu de remise.
 */
export function viderEnUrgence(
  base: string,
  beacon: EnvoyerBeacon,
  file: ReturnType<typeof creerFileBalises>,
  suivi: ReturnType<typeof creerSuiviReveil>,
  garde: { peutSignaler: () => boolean; marquer: () => void },
  maintenant: number = Date.now(),
): void {
  for (const [commerceId, debut] of suivi.ouverts()) {
    const tranche = trancheFroid(maintenant - debut)
    if (!tranche || !garde.peutSignaler()) continue
    if (beacon(urlEvenements(base, commerceId), JSON.stringify({ type: tranche }))) {
      garde.marquer()
      suivi.fermer(commerceId, maintenant)
    }
  }
  for (const b of file.enAttente()) {
    if (file.estEnCours(b)) continue // livraison fetch en vol : le beacon doublerait le comptage
    if (beacon(urlEvenements(base, b.commerceId), JSON.stringify({ type: b.tranche }))) {
      file.retirer(b)
      garde.marquer()
    }
  }
}

// ---------- Branchement (état du module : un onglet = un module) ----------

/** Dépendances de la mesure (injectables pour les tests ; état du module en production). */
export interface DependancesFroid {
  garde: ReturnType<typeof creerGardeFroid>
  suivi: ReturnType<typeof creerSuiviReveil>
  file: ReturnType<typeof creerFileBalises>
  beacon?: EnvoyerBeacon | null
}

const dependancesModule: DependancesFroid = {
  garde: creerGardeFroid(),
  suivi: creerSuiviReveil(),
  file: creerFileBalises(stockageNavigateur()),
}

/** Remplace les dépendances du module (tests : file en mémoire, garde neuve, suivi neuf). */
export function definirDependancesFroid(deps: DependancesFroid): void {
  dependancesModule.garde = deps.garde
  dependancesModule.suivi = deps.suivi
  dependancesModule.file = deps.file
  dependancesModule.beacon = deps.beacon
}

let urgenceInstallee = false

/** Enregistre (une seule fois, navigateur seulement) l'envoi d'urgence à la fermeture de la page. */
function installerEnvoiUrgence(base: string, deps: DependancesFroid): void {
  if (urgenceInstallee) return
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
  const beacon = deps.beacon !== undefined ? deps.beacon : beaconNavigateur()
  if (!beacon) return
  urgenceInstallee = true
  window.addEventListener('pagehide', () => viderEnUrgence(base, beacon, deps.file, deps.suivi, deps.garde))
}

/**
 * Note le résultat d'un appel API public pour la mesure des démarrages à froid. Appelée par
 * `src/data/api.ts` après chaque appel, avec la durée propre de l'appel (`delaiMs`, calculée par
 * l'appelant avant le chargement de ce module) et `recu` = une réponse est arrivée (en-têtes reçues).
 * Sans réponse : ouvre (ou prolonge) l'épisode de réveil du commerce, rien n'est envoyé — le serveur est
 * injoignable. Avec réponse : ferme l'épisode éventuel et signale sa durée totale ; à défaut d'épisode,
 * signale la durée propre si elle dépasse le seuil ; puis tente de livrer la file en attente (le serveur
 * vient de prouver qu'il est éveillé — c'est aussi le mécanisme de renvoi des sessions passées).
 * Ne fait rien pour un appel marchand, non attribuable, ou pour la balise elle-même. N'attend jamais rien.
 */
export function noterAppelLent(
  chemin: string,
  debut: number,
  delaiMs: number,
  recu: boolean,
  acces: boolean,
  base: string,
  envoyer: typeof fetch,
  deps: DependancesFroid = dependancesModule,
): void {
  if (acces) return
  installerEnvoiUrgence(base, deps)
  const commerceId = extraireCommerceId(chemin)
  if (!recu) {
    if (commerceId && cheminMesurable(chemin)) deps.suivi.ouvrir(commerceId, debut)
    return
  }
  if (commerceId && cheminMesurable(chemin)) {
    const dureeEpisode = deps.suivi.fermer(commerceId, debut + delaiMs)
    const tranche = trancheFroid(dureeEpisode ?? delaiMs)
    if (tranche) deposerBalise(commerceId, tranche, deps.file, deps.garde)
  }
  void livrerBalises(base, envoyer, deps.file, deps.garde).catch(() => {})
}

// P0-U5 — Connexion à l'espace commerçant : causes d'échec distinguées, délais bornés, journal de diagnostic.
//
// Le bug « ça bug dès que je me connecte » (09/11) n'a jamais été reproduit. Ce module ne le « corrige » pas :
// il ferme les cul-de-sac identifiés dans l'audit (serveur endormi confondu avec un PIN faux, attente sans fin,
// verrouillage silencieux, coffre illisible ignoré) et garde une trace locale de chaque échec, pour qu'on sache
// quoi regarder s'il revient.
//
// Logique pure (aucun React) : testée par `node --test` (tests/connexion-p0-u5.test.ts).
import { accesDeSession, echangerContreSession, ErreurApi, type Acces, type ClientApi } from '../data/api.ts'
import type { LectureCoffre } from '../data/coffrePin.ts'
import type { Etat } from '../types'

/** Aucune attente d'accès (relecture, déverrouillage, chargement de la liste) ne dépasse ceci sans message + « Réessayer ». */
export const DELAI_ACCES_MS = 30_000
/** Relire l'accès mémorisé est local (IndexedDB) : quelques secondes suffisent, au-delà c'est bloqué. */
export const DELAI_COFFRE_MS = 5_000
/** Pause entre deux essais quand le serveur ne répond pas encore (réveil Render). */
export const PAUSE_REVEIL_MS = 3_000
/** Au-delà, le bouton « Vérification… » explique que le serveur se réveille sans doute. */
export const DELAI_INDICE_REVEIL_MS = 5_000

export const MESSAGE_SERVEUR_INJOIGNABLE =
  'Serveur injoignable — vérifiez votre connexion. Le serveur se réveille peut-être (cela peut prendre une minute) : réessayez.'
export const MESSAGE_APPAREIL_HORS_LIGNE = 'Cet appareil n’est pas connecté à Internet — vérifiez le Wi-Fi ou les données mobiles, puis réessayez.'
export const MESSAGE_DELAI_DEPASSE = 'Le serveur ne répond toujours pas après 30 secondes — il se réveille peut-être (cela peut prendre une minute). Réessayez.'
export const MESSAGE_REVEIL_EN_COURS = 'Le serveur se réveille, cela peut prendre jusqu’à une minute…'
const RIEN_N_EST_PERDU = 'Rien n’est perdu : vos clients sont enregistrés sur le serveur et réapparaîtront dès le déverrouillage.'
export const MESSAGE_SESSION_EXPIREE = `Session expirée — veuillez saisir à nouveau votre code. ${RIEN_N_EST_PERDU}`
export const MESSAGE_PIN_CHANGE = `Votre PIN a été refusé (il a peut-être été changé) — veuillez saisir à nouveau votre code. ${RIEN_N_EST_PERDU}`
export const MESSAGE_COFFRE_ILLISIBLE = `Votre connexion mémorisée sur cet appareil n’a pas pu être relue — veuillez saisir à nouveau votre code. ${RIEN_N_EST_PERDU}`

/** Cause d'un échec de connexion, telle que journalisée. */
export type CauseEchec = 'reseau' | 'appareil-hors-ligne' | 'timeout' | '401' | 'coffre' | 'refus' | 'serveur'

export class ErreurDelai extends Error {
  constructor(message = MESSAGE_DELAI_DEPASSE) {
    super(message)
    this.name = 'ErreurDelai'
  }
}

export class ErreurCoffre extends Error {
  /** Pour le journal uniquement (ex. « cle-absente », « delai », « OperationError »). */
  raison: string
  constructor(raison: string) {
    super(MESSAGE_COFFRE_ILLISIBLE)
    this.name = 'ErreurCoffre'
    this.raison = raison
  }
}

/** `navigator.onLine` quand il existe (false = l'appareil lui-même n'a pas de réseau). */
export function appareilEnLigne(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

export function causeEchec(err: unknown, enLigne = appareilEnLigne()): CauseEchec {
  if (err instanceof ErreurDelai) return 'timeout'
  if (err instanceof ErreurCoffre) return 'coffre'
  if (err instanceof ErreurApi) {
    if (err.horsLigne) return enLigne ? 'reseau' : 'appareil-hors-ligne'
    if (err.statut === 401) return '401'
    return err.statut >= 500 ? 'serveur' : 'refus'
  }
  return 'serveur'
}

/**
 * Message affiché pour un échec de connexion. Réseau / délai : messages dédiés (jamais confondus avec un PIN faux).
 * 401 / 429 / autres refus : le message du serveur, tel quel (« PIN commerçant incorrect. », « Trop de PIN incorrects… »).
 */
export function messageEchec(err: unknown, enLigne = appareilEnLigne()): string {
  switch (causeEchec(err, enLigne)) {
    case 'reseau':
      return MESSAGE_SERVEUR_INJOIGNABLE
    case 'appareil-hors-ligne':
      return MESSAGE_APPAREIL_HORS_LIGNE
    case 'timeout':
      return MESSAGE_DELAI_DEPASSE
    case 'coffre':
      return MESSAGE_COFFRE_ILLISIBLE
    default:
      return err instanceof Error && err.message ? err.message : 'Une erreur est survenue. Réessayez.'
  }
}

/** L'échec mérite-t-il un bouton « Réessayer » (relancer la même tentative, PIN conservé) ? */
export function echecReessayable(err: unknown): boolean {
  const c = causeEchec(err)
  return c === 'reseau' || c === 'appareil-hors-ligne' || c === 'timeout' || c === 'serveur'
}

/** Rejette avec `ErreurDelai` si `p` n'a pas abouti en `ms` (la minuterie est toujours libérée). */
export function avecDelai<T>(p: Promise<T>, ms: number, erreur: () => Error = () => new ErreurDelai()): Promise<T> {
  let minuterie: ReturnType<typeof setTimeout> | undefined
  const delai = new Promise<never>((_, ko) => {
    minuterie = setTimeout(() => ko(erreur()), ms)
  })
  return Promise.race([p, delai]).finally(() => clearTimeout(minuterie))
}

const attendre = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))

/**
 * Lance `f` ; tant que le serveur est injoignable (statut 0 : réveil Render, 502/503/504, délai d'une requête),
 * réessaie toutes les `pauseMs`. Au-delà de `delaiMs` au total → `ErreurDelai`. Tout autre échec (401, 429, 500…)
 * est relancé aussitôt : un PIN faux n'est jamais réessayé. Appareil sans réseau : échec immédiat.
 */
export async function tenterPendant<T>(
  f: () => Promise<T>,
  o: { delaiMs?: number; pauseMs?: number; enLigne?: () => boolean; surNouvelEssai?: (essai: number, err: ErreurApi) => void } = {},
): Promise<T> {
  const delaiMs = o.delaiMs ?? DELAI_ACCES_MS
  const pauseMs = o.pauseMs ?? PAUSE_REVEIL_MS
  const enLigne = o.enLigne ?? appareilEnLigne
  let fini = false
  const boucle = async () => {
    for (let essai = 1; ; essai++) {
      try {
        return await f()
      } catch (e) {
        if (fini || !(e instanceof ErreurApi && e.horsLigne) || !enLigne()) throw e
        o.surNouvelEssai?.(essai, e)
        await attendre(pauseMs)
        if (fini) throw e
      }
    }
  }
  try {
    return await avecDelai(boucle(), delaiMs)
  } finally {
    fini = true
  }
}

/** Relecture de l'accès mémorisé, bornée : un IndexedDB bloqué (connu sur Safari iOS) ne laisse plus « Chargement… » à l'infini. */
export async function lireCoffreBorne(coffre: { lireDetaille(): Promise<LectureCoffre> }, ms = DELAI_COFFRE_MS): Promise<LectureCoffre> {
  try {
    return await avecDelai(coffre.lireDetaille(), ms)
  } catch (e) {
    return { statut: 'illisible', raison: e instanceof ErreurDelai ? 'delai' : e instanceof Error ? e.name : 'erreur' }
  }
}

/**
 * Déverrouillage : PIN → jeton de session (P0-S1, inchangé : `echangerContreSession` + repli PIN), puis état du serveur.
 * Le tout réessayé tant que le serveur se réveille, 30 s au plus.
 */
export function ouvrirAcces(
  api: Pick<ClientApi, 'ouvrirSession'>,
  depot: { chargerServeur(acces: Acces | null, commerceActifId?: string): Promise<Etat> },
  saisi: Acces,
  commerceActifId: string,
  o: Parameters<typeof tenterPendant>[1] = {},
): Promise<{ acces: Acces; etat: Etat }> {
  return tenterPendant(async () => {
    let a = saisi
    if (saisi.pin) {
      const s = await echangerContreSession(api, saisi.role === 'admin' ? { role: 'admin', pin: saisi.pin } : { role: 'commerce', commerceId: saisi.commerceId, pin: saisi.pin })
      a = (s && accesDeSession(s)) ?? saisi
    }
    const etat = await depot.chargerServeur(a, a.role === 'commerce' ? a.commerceId : commerceActifId)
    return { acces: a, etat }
  }, o)
}

/**
 * Que faire d'un rechargement échoué ?
 * - fait avec un autre accès que l'accès actuel (déverrouillage / verrouillage entre-temps) : ignoré ;
 * - 401 avec un accès : verrouiller AVEC un message persistant (session expirée ou PIN changé) ;
 * - serveur injoignable : hors ligne (le cache reste affiché) ;
 * - autre refus : message, sans verrouiller.
 */
export type IssueRechargement =
  | { type: 'ignorer' }
  | { type: 'verrouiller'; message: string }
  | { type: 'horsLigne'; message: string }
  | { type: 'erreur'; message: string }

export function issueRechargement(err: unknown, accesUtilise: Acces | null, accesActuel: Acces | null, enLigne = appareilEnLigne()): IssueRechargement {
  if (accesUtilise !== accesActuel) return { type: 'ignorer' }
  if (err instanceof ErreurApi && err.statut === 401 && accesUtilise) {
    return { type: 'verrouiller', message: accesUtilise.jeton ? MESSAGE_SESSION_EXPIREE : MESSAGE_PIN_CHANGE }
  }
  if (!(err instanceof ErreurApi) || err.horsLigne) return { type: 'horsLigne', message: enLigne ? MESSAGE_SERVEUR_INJOIGNABLE : MESSAGE_APPAREIL_HORS_LIGNE }
  return { type: 'erreur', message: err.message }
}

// ---------------------------------------------------------------------------------------------
// Journal de diagnostic (local à l'appareil) — jamais de PIN, de code ni de jeton.
// ---------------------------------------------------------------------------------------------

export type EtapeConnexion = 'demarrage' | 'deverrouillage' | 'rechargement' | 'caisse'

export interface EntreeDiagnostic {
  date: string
  etape: EtapeConnexion
  cause: CauseEchec
  /** Code HTTP (0 = injoignable), si connu. */
  statut?: number
  message: string
  /** `navigator.onLine` au moment de l'échec. */
  enLigne: boolean
  /** Détail technique sans donnée sensible (ex. raison d'un coffre illisible). */
  detail?: string
}

export const CLE_JOURNAL = 'fidelite:diagnostic-connexion:v1'
export const TAILLE_JOURNAL = 20

type Stockage = Pick<Storage, 'getItem' | 'setItem'>

/** Toute suite de 4 chiffres ou plus (PIN, code équipe) et tout jeton de session sont masqués avant d'être écrits. */
export function masquerSecrets(texte: string): string {
  return texte.replace(/v1\.[\w-]+\.[\w-]+/g, '[jeton]').replace(/\d{4,}/g, '••••')
}

export function lireJournal(stockage: Stockage | null): EntreeDiagnostic[] {
  try {
    const brut = stockage?.getItem(CLE_JOURNAL)
    const j: unknown = brut ? JSON.parse(brut) : []
    return Array.isArray(j) ? (j as EntreeDiagnostic[]) : []
  } catch {
    return []
  }
}

/**
 * Journalise un échec : console (visible avec l'inspecteur du téléphone) + 20 dernières entrées gardées sur l'appareil,
 * affichées dans « Détails pour l'assistance » sur l'écran de connexion. Renvoie l'entrée écrite.
 */
export function journaliserEchec(
  etape: EtapeConnexion,
  err: unknown,
  o: { stockage?: Stockage | null; maintenant?: () => Date; enLigne?: boolean; console?: Pick<Console, 'warn'> | null } = {},
): EntreeDiagnostic {
  const enLigne = o.enLigne ?? appareilEnLigne()
  const entree: EntreeDiagnostic = {
    date: (o.maintenant?.() ?? new Date()).toISOString(),
    etape,
    cause: causeEchec(err, enLigne),
    ...(err instanceof ErreurApi ? { statut: err.statut } : {}),
    message: masquerSecrets(messageEchec(err, enLigne)),
    enLigne,
    ...(err instanceof ErreurCoffre ? { detail: masquerSecrets(err.raison) } : {}),
  }
  const sortie = o.console === undefined ? globalThis.console : o.console
  sortie?.warn('[connexion] échec', entree)
  try {
    o.stockage?.setItem(CLE_JOURNAL, JSON.stringify([entree, ...lireJournal(o.stockage)].slice(0, TAILLE_JOURNAL)))
  } catch {
    // stockage plein ou désactivé : la console suffit
  }
  return entree
}

const LIBELLES_CAUSE: Record<CauseEchec, string> = {
  reseau: 'serveur injoignable',
  'appareil-hors-ligne': 'appareil hors ligne',
  timeout: 'délai dépassé (30 s)',
  '401': 'accès refusé (401)',
  coffre: 'connexion mémorisée illisible',
  refus: 'refusé par le serveur',
  serveur: 'erreur du serveur',
}

/** Une ligne lisible (à recopier ou photographier pour l'assistance). */
export function ligneDiagnostic(e: EntreeDiagnostic): string {
  const d = new Date(e.date)
  const date = Number.isNaN(d.getTime())
    ? e.date
    : new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Paris' }).format(d)
  const statut = e.statut !== undefined ? ` · HTTP ${e.statut}` : ''
  return `${date} · ${e.etape} · ${LIBELLES_CAUSE[e.cause] ?? e.cause}${statut}${e.enLigne ? '' : ' · hors ligne'}${e.detail ? ` · ${e.detail}` : ''} — ${e.message}`
}

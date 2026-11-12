// API REST /api/v1 (module `node:http`, aucune dépendance npm).
// Les règles métier ne sont PAS réécrites ici : elles viennent de `src/lib/*` (les mêmes que le front).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash, createHmac, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib'
import { extname, join, normalize, resolve, sep } from 'node:path'

import type { Apparence, Avis, Client, Commerce, CommerceCaisse, CommercePublic, DecisionParrainage, DemandeRattrapage, EntreeJournal, EnvoiRelance, InstantsDuJour, Lot, MembreEquipe, ModeleRelance, Parrainage, RecompensePoints, ReglesMessages, StatutEnvoi, TestsAB, Tirage, TypeCommerce, TypeEvenement, TypeLot } from '../src/types.ts'
import { nouveauCommerce, TYPES_COMMERCE } from '../src/data/defaults.ts'
import { seedRecale } from '../src/data/depot.ts'
import seed from '../src/data/seed.json' with { type: 'json' }
import { analyserContact, cleContact, estIdClientActuel, nouveauClient, offrirRecompense, recompenseDebloquee, tamponsAffiches } from '../src/lib/fidelite.ts'
import { canalDuClient, echecAutoDuJour, emailRelance, estModeleRelance, estMotStop, jourParis, lienCarte, lienCourtCarte, lienCourtDesinscription, MODELES_RELANCE, relanceAutoDue, smsRelance } from '../src/lib/relances.ts'
import { emailGainExpire, gainBientotExpire, gainsARelancer, relanceGainFaite, smsGainExpire } from '../src/lib/relanceGain.ts'
import {
  debutDuJourParis, DUREE_GAIN_JOURS, finActivation, finGain, gainEnCours, gainsSur30Jours, LIMITE_GAINS_MOIS_MAX, limiteGainsMois, lotsJouables,
  lotsPlafonnes, lotsTirables, messageGain, modeAccesRoue, normaliserCodeGagnant, PLAFOND_JOUR_MAX, refusActivation, statutGain, statutJeu, tirageDuCode, tirageDuJour,
  tirageHerite, tirerLot, utilisableLe, FENETRE_ACTIVATION_MS,
} from '../src/lib/roulette.ts'
import { cleLibelle, estGainPhysique, estTypeLot, FORMAT_ID_LOT, libellesEnDouble, normaliserLots, POINTS_LOT_MAX, POINTS_LOT_MIN, rattachementsTirages, TYPES_LOT, typeDeduitDuLibelle, typeTirage } from '../src/lib/lots.ts'
import { appliquerRegles, fusionnerImport, publicationAutomatique, refusPublication } from '../src/lib/avis.ts'
import { ajouterMessagePrive, validerMessagePrive } from '../src/lib/messagePrive.ts'
import { clientsEnCsv } from '../src/lib/csv.ts'
import { actionDejaTraitee, avecAction, echangerPoints, formaterPrix, soldePoints } from '../src/lib/points.ts'
import { analyserAnniversaire, clientsCibles, deposerMessage, genererMessages, marquerLus, TYPES_MESSAGES, type Cible, type Evenement } from '../src/lib/messages.ts'
import { chiffresRecherche, correspondRecherche } from '../src/lib/recherche.ts'
import {
  appliquerInscription,
  appliquerRattrapageValide,
  configParrainage,
  consommerRecompenseEnAttente,
  filleulRegle,
  genererCodeParrainage,
  niveauClient,
  parrainageDu,
  parrainSelonDecision,
  passageAvecProgramme,
  peutCompleterProfil,
  rattrapageRecevable,
  repriseParrainageDue,
  utiliserReserve,
  validerProgramme,
  type EvenementPassage,
} from '../src/lib/programme.ts'
import { problemesApparence } from '../src/lib/apparence.ts'
import { commercePublic } from '../src/lib/vuePublique.ts'
import { cleInstants, genererInstants, INSTANTS_JOUR_MAX, instantEnCours, instantsPasses, lotsAInstants, plagesOuverture, problemePlages, statutInstant } from '../src/lib/instants.ts'
import type { InstantPasse } from '../src/lib/instantsTableau.ts'
import { donneesReglement } from '../src/lib/reglement.ts'
import { ErreurMenu, validerMenu } from '../src/lib/menu.ts'
import { ErreurLogo, LIMITES_LOGO, messageTropLourd, urlLogo, validerLogo, type FormatLogo } from '../src/lib/logo.ts'
import { EVENEMENTS_PUBLICS, ajouterJours, basculerAccroche } from '../src/lib/mesure.ts'
import { CONSERVATION_MAX_MOIS, CONSERVATION_MIN_MOIS, dureeConservationMois, estPurgeable, exportClientCsv, libelleDuree, listePurge, nomFichierExportClient } from '../src/lib/rgpd.ts'
import { ErreurConflit, ErreurMigrationManquante, ouvrirStockage, type BilanSuppression, type CompteurPublic, type Pin, type PorteeAuth, type Stockage } from './stockage.ts'
import { modeleColonneEnvoi, ouvrirStockageSupabase, type ConfigSupabase } from './stockage-supabase.ts'
import { chiffrerSauvegarde, exporterSauvegarde, nomFichierSauvegarde } from './sauvegarde.ts'
import { ErreurWallet, lienGoogleWallet, walletConfigure, type ConfigGoogleWallet } from './wallet.ts'
import { menuAffichePour, pageMenuIndisponible, pageMenuPrerendue, pageNonTrouvee } from './prerendu.ts'
import { cheminMasquePourErreur, empreinte, journaliserRequete, routeMasquee } from './logs.ts'
import { creerFileParCle } from './file-par-cle.ts'
import { creerAlertes5xx } from './alertes.ts'
import { creerNotifications, echecConfirme, ErreurNonBranche, type Canal, type ConfigNotifications, type Message } from './notifications/index.ts'
import { estAbandon } from './notifications/delai.ts'
import {
  chiffrerJetons,
  dechiffrerJetons,
  echangerCode,
  emplacementAImporter,
  emplacementValide,
  ErreurGoogle,
  googleBusinessConfigure,
  jetonsFrais,
  listerAvisGoogle,
  lireEtat,
  MESSAGE_NON_BRANCHE,
  placeIdDuLien,
  publierReponseGoogle,
  revoquerJeton,
  signerEtat,
  trouverEmplacement,
  urlAutorisation,
  type ConfigGoogleBusiness,
  type ConfigGoogleComplete,
  type JetonsGoogle,
} from './google-business.ts'

// ---------- Seuils anti-abus (P0-S2) — à ajuster ici ; justification dans server/README.md ----------

/**
 * Routes publiques : nombre maximal de requêtes par fenêtre de FENETRE_PUBLIQUE_MS (au-delà : 429 + Retry-After).
 * Généreux exprès : plusieurs clients partagent souvent la même IP (wifi du restaurant, 4G), la page de jeu et la
 * tablette du gérant interrogent le serveur toutes les 10 s. Les routes authentifiées (caisse, gérant) ne sont pas
 * concernées : la file hors ligne de la caisse peut rejouer autant d'actions qu'il faut.
 */
export const LIMITES_PUBLIQUES = {
  /** GET /cartes/:id, POST /cartes/:id/lus, GET /commerces, GET /commerces/:id, GET /commerces/:id/menu — par IP. */
  lectureParIp: 120,
  /** GET /cartes/:id + POST /cartes/:id/lus — par carte (une page de jeu ouverte = 6 lectures / min). */
  lectureParCarte: 30,
  /** POST /commerces/:id/clients sans PIN — par IP, et par contact (téléphone / e-mail normalisé) dans ce commerce. */
  inscriptionParIp: 10,
  inscriptionParContact: 5,
  /** POST /commerces/:id/tirages — par IP, et par contact dans ce commerce. */
  tirageParIp: 20,
  tirageParContact: 5,
  /** POST /commerces/:id/clients/:clientId/profil, …/rattrapage (demande du client) et …/message-prive — par IP. */
  ficheClientParIp: 10,
  /**
   * POST /sessions (échange PIN → jeton) — par IP, en plus du blocage sur PIN faux ci-dessous. Borne le coût scrypt ;
   * large car toute l'équipe ouvre sa session depuis le même wifi en début de service.
   */
  sessionParIp: 30,
  /**
   * POST /commerces/:id/evenements (mesure anonyme P2-Q3 : page de jeu ouverte, clic vers Google) — par IP. Une page de
   * jeu en envoie 1 ou 2 ; au-delà, l'événement est refusé (429) et simplement pas compté.
   */
  evenementParIp: 30,
}
export type LimitesPubliques = typeof LIMITES_PUBLIQUES
const FENETRE_PUBLIQUE_MS = 60_000

/**
 * PIN / codes faux (anti-bruteforce, persistant en base : table `tentatives_auth`). Deux compteurs par échec :
 * - `ip:<ip>` (tous secrets confondus) : MAX_ECHECS_IP échecs sans pause de FENETRE_ECHECS_MS → cette IP est bloquée ;
 * - `cible:<commerceId>` ou `cible:admin` (toutes IP confondues, contre l'attaque distribuée) : MAX_ECHECS_CIBLE échecs
 *   → plus aucun PIN / code accepté pour cette cible pendant le blocage (les sessions déjà ouvertes continuent).
 * Blocage de BLOCAGE_INITIAL_MS, doublé à chaque nouvelle série d'échecs (progressif), plafonné à BLOCAGE_MAX_MS.
 * Un accès réussi remet à zéro le compteur de son IP (pas celui de la cible : une attaque distribuée en cours continue
 * d'être comptée même si le gérant se connecte entre-temps).
 */
const MAX_ECHECS_IP = 10
const MAX_ECHECS_CIBLE = 50
const FENETRE_ECHECS_MS = 10 * 60_000
const BLOCAGE_INITIAL_MS = 10 * 60_000
const BLOCAGE_MAX_MS = 24 * 3600_000
/** Lignes de `tentatives_auth` sans activité depuis ce délai (ni échec, ni blocage en cours) : supprimées au passage. */
const CONSERVATION_TENTATIVES_MS = 7 * 24 * 3600_000
/** Instant gagnant à rendre après un tirage échoué (D1, revue Codex F1) : relectures + écritures conditionnelles, au plus. */
export const ESSAIS_RESTITUTION = 4

export interface OptionsServeur {
  /** Fichier SQLite (créé au besoin) : stockage utilisé quand Supabase n'est pas configuré. */
  fichierDb: string
  /** Supabase (S1) : présent = base Postgres Supabase au lieu du fichier SQLite. */
  supabase?: ConfigSupabase
  /** PIN admin (création de commerces, réinitialisation des PIN). */
  adminPin: string
  /** PIN commerçant d'Asian Home Paris, utilisé UNE fois à l'initialisation de la base. */
  pinInitial?: string
  /** Ajoute les 2 commerces de démo (et leurs données fictives), étiquetés `demo: true`. */
  demo?: boolean
  production?: boolean
  /** Lire l'IP cliente dans X-Forwarded-For (derrière l'équilibreur de Render, par ex.). */
  derriereProxy?: boolean
  /** Origine autorisée en CORS, exacte (`https://hote`) ou '*' (défaut). Validée par `lireOrigineCors`. */
  origineCors?: string
  /** Dossier du front compilé à servir (ex. `dist/`) ; absent = API seule. */
  dossierStatique?: string
  version?: string
  /** Adresse publique du site (QR des passes Wallet) ; à défaut, déduite de l'en-tête Host. */
  urlPublique?: string
  /** Google Wallet (V3) : absent = 501 « à brancher ». */
  googleWallet?: ConfigGoogleWallet
  /** Prestataires SMS / e-mail (V3) : absents = 501 « à brancher », rien n'est envoyé. */
  notifications?: ConfigNotifications
  /** Google Business Profile (P1-B4) : sans client ID + client secret = 501 « à brancher », aucun appel à Google. */
  googleBusiness?: ConfigGoogleBusiness
  /** Secret de signature des jetons de session (SESSION_SECRET) ; absent = POST /sessions répond 503, le PIN en en-tête reste accepté. */
  secretSession?: string
  /**
   * Accès aux cartes (P0-S7) : 'stricte' = jeton client exigé (production) ; 'transition' (défaut) = jetons émis et
   * vérifiés, mais l'accès d'avant P0-S7 (identifiant ou contact seuls) reste admis — voir server/README.md.
   */
  authClient?: ModeAuthClient
  /** Fin de la période de grâce des anciens identifiants (ISO), si différente de GRACE_ANCIENS_ID_JUSQU_AU (tests). */
  graceAnciensIdJusquAu?: string
  /** Seuils des routes publiques, si différents de LIMITES_PUBLIQUES (tests). */
  limitesPubliques?: Partial<LimitesPubliques>
  /** Journal des lectures sensibles (P2-S15) : part des lectures `GET /cartes/:id` et `GET /commerces`
   * journalisées (0–1, défaut 0,1) ; 0 = rien, 1 = tout (tests). Échantillonnage obligatoire (volume).
   * `plafond` = lignes max par minute (défaut 600) : au-delà, les lignes sont comptées puis résumées en une
   * seule ligne à la minute suivante (l'attaque reste visible par son volume, sans noyer les logs). */
  journalLectures?: { taux?: number; plafond?: number }
  /**
   * Clé de chiffrement des sauvegardes (SAUVEGARDE_CLE_CHIFFREMENT, 64 hex), la même que pour le CLI : présente = la
   * sauvegarde téléchargée par l'admin (`GET /admin/sauvegarde`) est chiffrée AES-256-GCM ; absente = en clair + avertissement.
   */
  cleChiffrementSauvegarde?: string
  /** Destinataire de l'alerte e-mail sur rafale de 5xx (ALERTE_EMAIL, `server/alertes.ts`) ; absent = alerte désactivée. */
  alerteEmail?: string
  /** Horloge injectable (tests). */
  maintenant?: () => Date
  /** Hasard du tirage de la roue, dans [0, 1[ (tests) ; absent = Math.random. */
  alea?: () => number
}

class ErreurHttp extends Error {
  statut: number
  entetes?: Record<string, string>
  constructor(statut: number, message: string, entetes?: Record<string, string>) {
    super(message)
    this.statut = statut
    this.entetes = entetes
  }
}

const err = (statut: number, message: string) => new ErreurHttp(statut, message)

// ---------- PIN ----------

const PIN_VALIDE = /^\d{4,6}$/

// Format du hash (colonnes `pin_hash` / `code_hash`, aucune colonne en plus — voir server/README.md) :
// • actuel : `scrypt$v1$<128 hex>` = scrypt(PIN, sel, 64 o, N=16384, r=8, p=1) ;
// • ancien : 64 hex nus = SHA-256(`<sel>:<PIN>`), 1 itération. Toujours accepté, re-haché en scrypt au 1er accès réussi.
const PREFIXE_SCRYPT = 'scrypt$v1$'
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const LONGUEUR_SCRYPT = 64
const ANCIEN_HASH = /^[0-9a-f]{64}$/

function scryptHex(pin: string, sel: string): Promise<string> {
  return new Promise((ok, ko) => scrypt(pin, sel, LONGUEUR_SCRYPT, SCRYPT, (e, cle) => (e ? ko(e) : ok(cle.toString('hex')))))
}

export async function hacherPin(pin: string, sel = randomBytes(16).toString('hex')): Promise<Pin> {
  return { sel, hash: PREFIXE_SCRYPT + (await scryptHex(pin, sel)) }
}

/** Ancien format (SHA-256, 1 itération) : uniquement pour les tests de migration — ne plus jamais l'écrire. */
export function hacherPinAncien(pin: string, sel = randomBytes(16).toString('hex')): Pin {
  return { sel, hash: createHash('sha256').update(`${sel}:${pin}`).digest('hex') }
}

const egaux = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b)

/** Vérifie un PIN / code contre un hash des deux formats ; `rehacher` = hash ancien format, à remplacer par scrypt. */
export async function pinCorrect(pin: string, attendu: Pin | undefined): Promise<{ ok: boolean; rehacher: boolean }> {
  if (!attendu) return { ok: false, rehacher: false }
  if (attendu.hash.startsWith(PREFIXE_SCRYPT)) {
    const ok = egaux(Buffer.from(await scryptHex(pin, attendu.sel), 'hex'), Buffer.from(attendu.hash.slice(PREFIXE_SCRYPT.length), 'hex'))
    return { ok, rehacher: false }
  }
  if (ANCIEN_HASH.test(attendu.hash)) {
    const ok = egaux(Buffer.from(hacherPinAncien(pin, attendu.sel).hash, 'hex'), Buffer.from(attendu.hash, 'hex'))
    return { ok, rehacher: ok }
  }
  return { ok: false, rehacher: false }
}

// ---------- Jetons de session ----------
// `v1.<base64url(JSON)>.<base64url(HMAC-SHA256(SESSION_SECRET, <base64url(JSON)>))>` — signé, pas chiffré :
// le contenu (rôle, commerce, nom du membre) n'a rien de secret ; seul le secret du serveur permet d'en fabriquer un.

export type RoleSession = 'commerce' | 'admin' | 'equipe'

export interface ChargeSession {
  jti: string
  role: RoleSession
  commerceId?: string
  membreId?: string
  nom?: string
  /** Rôle `commerce` : version du PIN du commerce à l'émission (absente = 0, jetons émis avant son introduction). */
  vp?: number
  /** Expiration, en secondes unix. */
  exp: number
}

const DUREE_SESSION_S: Record<RoleSession, number> = { commerce: 8 * 3600, admin: 8 * 3600, equipe: 12 * 3600 }

const signature = (secret: string, charge: string) => createHmac('sha256', secret).update(charge).digest()

function signer(secret: string, contenu: object): string {
  const charge = Buffer.from(JSON.stringify(contenu)).toString('base64url')
  return `v1.${charge}.${signature(secret, charge).toString('base64url')}`
}

/** Contenu d'un jeton bien formé et signé par ce secret ; sinon null. La forme du contenu est vérifiée par l'appelant. */
function contenuSigne(secret: string, jeton: string): Record<string, unknown> | null {
  const parties = jeton.split('.')
  if (parties.length !== 3 || parties[0] !== 'v1' || jeton.length > 2048) return null
  if (!egaux(Buffer.from(parties[2], 'base64url'), signature(secret, parties[1]))) return null
  try {
    const c: unknown = JSON.parse(Buffer.from(parties[1], 'base64url').toString('utf8'))
    return c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function emettreJeton(secret: string, c: ChargeSession): string {
  return signer(secret, c)
}

/** Jeton bien formé et signé par ce secret (l'expiration et la révocation sont vérifiées à part) ; sinon null. */
export function lireJeton(secret: string, jeton: string): ChargeSession | null {
  const c = contenuSigne(secret, jeton) as ChargeSession | null
  if (!c) return null
  const roleOk = c.role === 'admin' || ((c.role === 'commerce' || c.role === 'equipe') && typeof c.commerceId === 'string')
  if (!roleOk || typeof c.jti !== 'string' || !Number.isInteger(c.exp) || (c.role === 'equipe' && typeof c.membreId !== 'string')) return null
  if (c.vp !== undefined && !Number.isInteger(c.vp)) return null
  return c
}

// ---------- Jetons client (P0-S7) ----------
// Même format et même secret que les sessions, contenu différent : `typ` au lieu de `role`. Un jeton client n'est donc
// jamais accepté comme session (pas de `role`), ni une session comme jeton client (pas de `typ`).
// • `client` : accès à UNE carte (`cid`) d'UN commerce (`com`), DUREE_JETON_CLIENT_S, renouvelable tant qu'il est valable ;
// • `lien` : lien d'accès à usage unique (comptoir : DUREE_LIEN_COMPTOIR_S ; « Retrouver ma carte » :
//   DUREE_LIEN_RECUPERATION_S), échangé contre un jeton `client` par POST /cartes/:id/jeton.
// `ver` = version d'accès de la carte (table `meta`) : la révocation l'incrémente, tout jeton d'une version antérieure
// est refusé.

export type ModeAuthClient = 'stricte' | 'transition'

export interface ChargeClient {
  typ: 'client' | 'lien'
  jti: string
  /** Identifiant de la carte (client). */
  cid: string
  /** Commerce de la carte. */
  com: string
  ver: number
  /** Expiration, en secondes unix. */
  exp: number
}

export const DUREE_JETON_CLIENT_S = 30 * 24 * 3600
export const DUREE_LIEN_COMPTOIR_S = 15 * 60
export const DUREE_LIEN_RECUPERATION_S = 24 * 3600
/**
 * Fin de la période de grâce des cartes à ANCIEN identifiant (`cl-<horodatage>-<4 car.>`, prévisible) : 90 jours après
 * le déploiement prévu de P0-S7 (12/11/2026). Jusque-là, l'ancien lien / QR seul ouvre la carte en vue limitée et
 * donne un jeton (migration au 1er accès) ; ensuite il ne donne plus rien. Déploiement décalé : décaler cette date
 * (et server/README.md, JOURNAL.md).
 */
export const GRACE_ANCIENS_ID_JUSQU_AU = '2027-02-10T00:00:00+01:00'
/** Échecs d'accès client par IP (jeton falsifié, carte d'un autre, identifiant deviné…) avant blocage. */
const MAX_ECHECS_CLIENT_IP = 30

/**
 * Exécute `fn` en réservant `cle` dans `reservees` : le test et la réservation sont synchrones (avant tout `await`),
 * donc un 2e appel concurrent pour la même clé obtient `refus()`. Libérée à la fin, succès ou échec. En mémoire : ne
 * vaut que pour UNE instance du serveur.
 */
export async function reserverPendant<T>(reservees: Set<string>, cle: string, refus: () => Promise<never>, fn: () => Promise<T>): Promise<T> {
  if (reservees.has(cle)) return refus()
  reservees.add(cle)
  try {
    return await fn()
  } finally {
    reservees.delete(cle)
  }
}

export function emettreJetonClient(secret: string, c: ChargeClient): string {
  return signer(secret, c)
}

/** Jeton client bien formé et signé par ce secret (expiration, version et usage unique vérifiés à part) ; sinon null. */
export function lireJetonClient(secret: string, jeton: string): ChargeClient | null {
  const c = contenuSigne(secret, jeton) as ChargeClient | null
  if (!c || 'role' in c || (c.typ !== 'client' && c.typ !== 'lien')) return null
  if (typeof c.jti !== 'string' || typeof c.cid !== 'string' || typeof c.com !== 'string' || !Number.isInteger(c.ver) || !Number.isInteger(c.exp)) return null
  return c
}

// ---------- Anti-abus des routes publiques (en mémoire, fenêtres fixes d'une minute) ----------

/**
 * Seuil de persistance (P0-S20) : un compteur n'est écrit en base qu'à partir de la moitié de son seuil — en trafic
 * normal, zéro écriture (une page qui se recharge toutes les 10 s fait 6 lectures/min pour un seuil de 30) ; un
 * compteur chaud ou bloqué, lui, survit à un redémarrage. Une ligne = 73 à 92 octets de JSON (mesuré) ; les écritures
 * ne bloquent jamais la requête (en mémoire d'abord, persistance en arrière-plan). Écritures par clé et par fenêtre :
 * bornées (le compteur sature à son seuil — une requête déjà bloquée ne ré-écrit pas : au plus
 * `seuil − seuil/2 + 1` écritures) et sérialisées par clé (une écriture ancienne ne peut pas écraser un blocage plus
 * récent). Une seule instance (Render aujourd'hui) : à plusieurs instances, chaque instance garderait ses propres
 * compteurs en mémoire — la base ne sert qu'au redémarrage, pas à la limitation distribuée, et l'écriture d'une autre
 * instance peut encore ramener un compteur en arrière (voir server/README.md).
 */
export const SEUIL_PERSISTANCE_COMPTEURS = 1 / 2

/** Persistance des compteurs publics (P0-S20, migration 0010) ; absente = mémoire seulement (comme avant). */
export interface PersistanceCompteurs {
  charger: () => Promise<CompteurPublic[]>
  enregistrer: (c: CompteurPublic, purgerAvant: string) => Promise<void>
  /** Vrai si la table existe (avertir dès le démarrage quand elle manque) ; absent = on ne sait pas. */
  schemaPresente?: () => Promise<boolean>
  /** Supprime les lignes périmées (au démarrage : aucune donnée ne traîne au-delà de sa fenêtre). */
  purger?: (avant: string) => Promise<void>
}

/** Compteurs par clé (`<catégorie>:<ip>`, `carte:<id>`, `inscription:<commerce>:<contact>`…) ; perdus au redémarrage sans persistance. */
function creerCompteursPublics(maintenant: () => Date, persistance?: PersistanceCompteurs) {
  const fenetres = new Map<string, { debut: number; n: number }>()
  /** Écritures en cours, par clé : les écritures d'une même clé partent dans l'ordre où elles ont été demandées. */
  const files = new Map<string, Promise<void>>()
  let averti = false
  function avertir(e: unknown) {
    if (averti) return
    averti = true
    console.warn(`[securite] compteurs publics comptés en mémoire seulement (perdus au redémarrage) : ${e instanceof Error ? e.message : e}`)
  }
  return {
    /** Compte une requête ; au-delà de `max` dans la fenêtre en cours → 429 avec Retry-After (secondes restantes). */
    consommer(cle: string, max: number, motif: string) {
      const t = maintenant().getTime()
      let f = fenetres.get(cle)
      if (!f || t - f.debut >= FENETRE_PUBLIQUE_MS || t < f.debut) {
        f = { debut: t, n: 0 }
        fenetres.set(cle, f)
      }
      // P0-S20 (revue Codex point 1) : le compteur sature à `max` — une requête déjà bloquée ne ré-incrémente pas
      // et ne ré-écrit pas (le blocage est déjà persisté : l'écriture a eu lieu quand n a atteint `max`) ; sinon
      // chaque requête bloquée écrirait, sans borne, tant que l'attaque continue.
      if (f.n >= max) {
        const s = Math.max(1, Math.ceil((f.debut + FENETRE_PUBLIQUE_MS - t) / 1000))
        throw new ErreurHttp(429, `${motif} Réessayez dans ${s} s.`, { 'Retry-After': String(s) })
      }
      f.n++
      // P0-S20 : un compteur chaud est persisté (en arrière-plan, sans bloquer la requête) ; un compteur froid
      // ne coûte aucune écriture — et ne peut pas provoquer de 429 juste après un redémarrage de toute façon.
      if (persistance && f.n >= Math.max(1, Math.ceil(max * SEUIL_PERSISTANCE_COMPTEURS))) {
        const ligne: CompteurPublic = { cle, debut: new Date(f.debut).toISOString(), n: f.n }
        const purgerAvant = new Date(t - FENETRE_PUBLIQUE_MS).toISOString()
        // P0-S20 (revue Codex point 4) : écritures sérialisées par clé — les écritures partent en arrière-plan et
        // leur ordre d'arrivée en base n'est pas garanti ; sans file, une écriture ancienne (n = 15) arrivant après
        // une récente (n = 30) annulerait le blocage au redémarrage suivant.
        const precedent = files.get(cle) ?? Promise.resolve()
        const ecriture = precedent.then(() => persistance.enregistrer(ligne, purgerAvant))
        const chaine = ecriture.catch(() => undefined)
        files.set(cle, chaine)
        void ecriture.catch(avertir)
        void chaine.then(() => {
          if (files.get(cle) === chaine) files.delete(cle)
        })
      }
    },
    purger() {
      const t = maintenant().getTime()
      for (const [cle, f] of fenetres) if (t - f.debut >= FENETRE_PUBLIQUE_MS || t < f.debut) fenetres.delete(cle)
    },
    /**
     * Recharge les compteurs persistés (redémarrage, réveil Render) : fenêtres encore valides seulement. Table
     * absente ou base indisponible : mémoire seulement, avec un avertissement — jamais de 500 au démarrage.
     * L'avertissement part dès le démarrage (pas seulement au premier compteur chaud), et les lignes périmées sont
     * purgées au passage : la clé contient un identifiant (IP, contact, identifiant de carte — comme `tentatives_auth`),
     * elle ne doit pas traîner au-delà de sa fenêtre d'une minute.
     */
    async restaurer() {
      if (!persistance) return
      const t = maintenant().getTime()
      if (persistance.schemaPresente && !(await persistance.schemaPresente().catch(() => false))) {
        avertir(new ErreurMigrationManquante('compteurs_publics', '0010_compteurs_publics.sql'))
        return
      }
      let lignes: CompteurPublic[]
      try {
        lignes = await persistance.charger()
      } catch (e) {
        avertir(e)
        return
      }
      for (const l of lignes) {
        const debut = Date.parse(l.debut)
        if (!Number.isFinite(debut) || debut > t || t - debut >= FENETRE_PUBLIQUE_MS || !Number.isInteger(l.n) || l.n <= 0) continue
        fenetres.set(l.cle, { debut, n: l.n })
      }
      if (persistance.purger) await persistance.purger(new Date(t - FENETRE_PUBLIQUE_MS).toISOString()).catch(avertir)
    },
  }
}

// ---------- Anti-bruteforce des PIN / codes (persistant : table `tentatives_auth`, cache en mémoire devant) ----------

interface EtatAuth {
  echecs: number
  /** ms epoch ; 0 = jamais. */
  bloqueJusqua: number
  derniere: number
}

/**
 * La base fait foi : à la 1re vérification d'une clé, son état est relu en base (un redémarrage ou un réveil Render ne
 * remet donc pas le blocage à zéro), puis gardé en mémoire — Render ne fait tourner qu'une instance, et tout échec passe
 * par ici. Base indisponible ou table absente (migration 0006 pas appliquée sous Supabase) : repli sur la mémoire seule,
 * jamais de 500.
 */
function creerLimiteurAuth(st: Stockage, maintenant: () => Date) {
  const etats = new Map<string, EtatAuth>()
  let averti = false

  function avertir(e: unknown) {
    if (averti) return
    averti = true
    console.warn(`[securite] tentatives d’accès comptées en mémoire seulement (perdues au redémarrage) : ${e instanceof Error ? e.message : e}`)
  }

  async function charger(cle: string): Promise<EtatAuth> {
    const connu = etats.get(cle)
    if (connu) return connu
    let lu: EtatAuth = { echecs: 0, bloqueJusqua: 0, derniere: 0 }
    try {
      const t = await st.tentativesAuth(cle)
      if (t) lu = { echecs: t.echecs, bloqueJusqua: t.bloqueJusqua ? Date.parse(t.bloqueJusqua) || 0 : 0, derniere: Date.parse(t.derniereTentative) || 0 }
    } catch (e) {
      avertir(e)
    }
    // Deux chargements simultanés de la même clé : le premier arrivé fait foi.
    if (!etats.has(cle)) etats.set(cle, lu)
    return etats.get(cle)!
  }

  async function enregistrerEchec(cle: string, max: number, portee: PorteeAuth): Promise<EtatAuth> {
    const e = await charger(cle)
    const t = maintenant().getTime()
    // Pause de FENETRE_ECHECS_MS depuis le dernier échec (ou la fin du dernier blocage) : on repart de zéro.
    if (t - Math.max(e.derniere, e.bloqueJusqua) > FENETRE_ECHECS_MS) e.echecs = 0
    e.echecs++
    e.derniere = t
    if (e.echecs % max === 0) {
      const duree = Math.min(BLOCAGE_MAX_MS, BLOCAGE_INITIAL_MS * 2 ** (e.echecs / max - 1))
      e.bloqueJusqua = t + duree
      console.warn(`[securite] BLOCAGE ${cle} (portée ${portee}) : ${e.echecs} échecs → ${Math.round(duree / 60_000)} min`)
    }
    try {
      await st.enregistrerTentativesAuth(
        {
          cle,
          portee,
          echecs: e.echecs,
          bloqueJusqua: e.bloqueJusqua ? new Date(e.bloqueJusqua).toISOString() : null,
          derniereTentative: new Date(t).toISOString(),
        },
        new Date(t - CONSERVATION_TENTATIVES_MS).toISOString(),
      )
    } catch (err) {
      avertir(err)
    }
    return e
  }

  return {
    /** 429 si l'une des clés est bloquée (Retry-After = secondes restantes du plus long blocage). */
    async verifier(cles: string[], motif = 'Trop de PIN incorrects.') {
      const t = maintenant().getTime()
      let fin = 0
      for (const cle of cles) fin = Math.max(fin, (await charger(cle)).bloqueJusqua)
      if (fin > t) {
        const s = Math.ceil((fin - t) / 1000)
        throw new ErreurHttp(429, `${motif} Réessayez dans ${Math.ceil(s / 60)} min.`, { 'Retry-After': String(s) })
      }
    },
    /**
     * Un échec de plus sur chaque clé ; bloque à chaque série de `max` (durée doublée à chaque série). Journal serveur :
     * une ligne par échec, une par blocage — jamais de PIN, de code ni de contact (clés, portée, compteurs).
     */
    async echec(cles: [cle: string, max: number][], portee: PorteeAuth) {
      const compteurs: string[] = []
      for (const [cle, max] of cles) {
        const e = await enregistrerEchec(cle, max, portee)
        compteurs.push(`${cle} ${e.echecs}/${max}`)
      }
      console.info(`[securite] échec ${portee} : ${compteurs.join(', ')}`)
    },
    /** Accès réussi : compteur de cette clé remis à zéro (rien à écrire s'il l'était déjà). */
    async succes(cle: string) {
      const e = await charger(cle)
      if (!e.echecs && !e.bloqueJusqua) return
      etats.set(cle, { echecs: 0, bloqueJusqua: 0, derniere: 0 })
      try {
        await st.effacerTentativesAuth(cle)
      } catch (err) {
        avertir(err)
      }
    },
    /** Oublie de la mémoire les clés sans blocage en cours ni échec récent (relues en base au besoin). */
    purger() {
      const t = maintenant().getTime()
      for (const [cle, e] of etats) if (e.bloqueJusqua <= t && t - e.derniere > FENETRE_ECHECS_MS) etats.delete(cle)
    },
  }
}

// ---------- Validation ----------

type Corps = Record<string, unknown>

function texte(v: unknown, champ: string, max: number, { requis = false } = {}): string {
  if (typeof v !== 'string') throw err(400, `« ${champ} » doit être un texte.`)
  const s = v.trim()
  if (requis && !s) throw err(400, `« ${champ} » est obligatoire.`)
  if (s.length > max) throw err(400, `« ${champ} » est trop long (${max} caractères maximum).`)
  return s
}

function booleen(v: unknown, champ: string): boolean {
  if (typeof v !== 'boolean') throw err(400, `« ${champ} » doit valoir true ou false.`)
  return v
}

function pinNeuf(v: unknown): string {
  if (typeof v !== 'string' || !PIN_VALIDE.test(v)) throw err(400, 'Le PIN commerçant doit contenir 4 à 6 chiffres.')
  return v
}

/**
 * Pagination d'une recherche (`?q=&page=&limite=`) : bornes strictes, 400 sinon. `q` vide = aucune recherche
 * (la route répond alors sans aucun client : on ne liste jamais les clients en vrac).
 */
function pageRecherche(params: URLSearchParams): { q: string; page: number; limite: number } {
  const q = (params.get('q') ?? '').trim()
  if (q.length > 80) throw err(400, '« q » : recherche de 80 caractères maximum.')
  const page = Number(params.get('page') ?? 1)
  const limite = Number(params.get('limite') ?? 20)
  if (!Number.isInteger(page) || page < 1) throw err(400, '« page » : numéro de page à partir de 1.')
  if (!Number.isInteger(limite) || limite < 1 || limite > 50) throw err(400, '« limite » : entre 1 et 50 résultats par page.')
  return { q, page, limite }
}

function lien(v: unknown): string {
  const s = texte(v, 'lienGoogle', 500)
  if (s && !/^https?:\/\/\S+$/i.test(s)) throw err(400, '« lienGoogle » doit être une adresse web (https://…).')
  return s
}

/** Lien de commande en ligne (P1-C5) : https uniquement ; vide = bouton masqué sur le menu public. */
function lienCommande(v: unknown, champ: string): string {
  const s = texte(v, champ, 500)
  if (s && !/^https:\/\/\S+$/i.test(s)) throw err(400, `« ${champ} » doit être une adresse web sécurisée (https://…).`)
  return s
}

function typeCommerce(v: unknown): TypeCommerce {
  const t = TYPES_COMMERCE.find((x) => x.valeur === v)
  if (!t) throw err(400, `« type » doit valoir : ${TYPES_COMMERCE.map((x) => x.valeur).join(', ')}.`)
  return t.valeur
}

/**
 * Lots de la roue (R1) : chaque lot écrit porte un `id` stable (le sien s'il est valable et unique, sinon un nouveau,
 * aléatoire) et un `type` validé. Type absent (client d'avant R1 encore en cache) : celui du lot actuel de même `id`,
 * sinon de même libellé (casse et espaces ignorés), et seulement à défaut déduit du libellé — un ancien client ne doit
 * jamais inverser un type choisi (« +10 points » devenu lot physique, lot gagnant « Dommage… » devenu perdant).
 * Libellés uniques (casse et espaces ignorés) : un libellé en double ne sert plus à rien pour le tirage, mais il
 * tromperait le client et le comptoir.
 */
function lots(v: unknown, existants: Lot[] = []): Lot[] {
  if (!Array.isArray(v) || v.length > 12) throw err(400, '« lots » doit être une liste de 12 lots maximum.')
  const actuels = normaliserLots(existants)
  const ids = new Set<string>()
  const liste = v.map((l: unknown, i) => {
    const o = (l ?? {}) as Corps
    const p = o.probabilite
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 100) throw err(400, `Lot n° ${i + 1} : la probabilité doit être un nombre entre 0 et 100.`)
    const libelle = texte(o.libelle, `lot n° ${i + 1}`, 80)
    if (o.type != null && !estTypeLot(o.type)) throw err(400, `Lot n° ${i + 1} : le type doit valoir ${TYPES_LOT.join(', ')}.`)
    // Lot actuel dont hérite un lot reçu sans type : même id, sinon même libellé. Type reçu : il fait foi.
    const actuel = o.type != null ? undefined
      : actuels.find((a) => typeof o.id === 'string' && a.id === o.id) ?? actuels.find((a) => cleLibelle(a.libelle) === cleLibelle(libelle))
    const type: TypeLot = actuel ? actuel.type : o.type != null ? (o.type as TypeLot) : typeDeduitDuLibelle(libelle)
    let id = typeof o.id === 'string' && FORMAT_ID_LOT.test(o.id) && !ids.has(o.id) ? o.id : ''
    while (!id || ids.has(id)) id = `lot-${randomUUID().slice(0, 13)}`
    ids.add(id)
    const lot: Lot = { id, type, libelle, probabilite: p }
    // Plafond journalier (R2) : lots physiques seulement ; absent / null / 0 = illimité (rien d'écrit).
    const plafond = o.plafondJour
    if (plafond != null) {
      if (typeof plafond !== 'number' || !Number.isInteger(plafond) || plafond < 0 || plafond > PLAFOND_JOUR_MAX) {
        throw err(400, `Lot n° ${i + 1} : le plafond du jour doit être un nombre entier (0 = illimité, ${PLAFOND_JOUR_MAX.toLocaleString('fr-FR')} au plus).`)
      }
      // Points / perdant ne sont jamais plafonnés : un plafond laissé sur un lot devenu consolation n'est pas gardé.
      if (plafond > 0 && type === 'lot') lot.plafondJour = plafond
    }
    // Instants gagnants (D1) : lots physiques seulement ; absent / null / 0 = désactivé (rien d'écrit).
    const instants = o.instantsParJour
    if (instants != null) {
      if (typeof instants !== 'number' || !Number.isInteger(instants) || instants < 0 || instants > INSTANTS_JOUR_MAX) {
        throw err(400, `Lot n° ${i + 1} : le nombre d’instants gagnants par jour doit être un entier de 0 à ${INSTANTS_JOUR_MAX}.`)
      }
      if (instants > 0 && type === 'lot') lot.instantsParJour = instants
    }
    if (type === 'points') {
      const n = o.points ?? actuel?.points
      if (typeof n !== 'number' || !Number.isInteger(n) || n < POINTS_LOT_MIN || n > POINTS_LOT_MAX) {
        throw err(400, `Lot n° ${i + 1} : un lot « points » doit indiquer un nombre entier de points (${POINTS_LOT_MIN} à ${POINTS_LOT_MAX.toLocaleString('fr-FR')}).`)
      }
      lot.points = n
    }
    // Coût unitaire (P2-Q3), en centimes : facultatif ; absent / null = non renseigné.
    const c = o.coutCentimes
    if (c != null) {
      if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c > 100_000) throw err(400, `Lot n° ${i + 1} : le coût doit être un nombre entier de centimes (0 à 100 000, soit 1 000 € au plus).`)
      lot.coutCentimes = c
    }
    return lot
  })
  const doubles = libellesEnDouble(liste)
  if (doubles.length) throw err(400, `Libellé de lot en double : ${doubles.map((d) => `« ${d} »`).join(', ')}. Chaque lot doit avoir un libellé différent (majuscules et espaces ne comptent pas).`)
  if (!lotsJouables(liste).length) throw err(400, 'Il faut au moins un lot avec un libellé et une probabilité > 0.')
  return liste
}

function catalogue(v: unknown): RecompensePoints[] {
  if (!Array.isArray(v) || v.length > 30) throw err(400, '« catalogue » doit être une liste de 30 récompenses maximum.')
  const ids = new Set<string>()
  return v.map((x: unknown, i) => {
    const o = (x ?? {}) as Corps
    const cout = o.cout
    if (typeof cout !== 'number' || !Number.isInteger(cout) || cout < 1 || cout > 100_000) throw err(400, `Récompense n° ${i + 1} : le coût doit être un nombre entier de points (1 à 100 000).`)
    const id = typeof o.id === 'string' && /^[\w-]{1,60}$/.test(o.id) ? o.id : `rp-${randomUUID().slice(0, 8)}`
    if (ids.has(id)) throw err(400, 'Identifiant de récompense en double.')
    ids.add(id)
    const r: RecompensePoints = { id, nom: texte(o.nom, `récompense n° ${i + 1}`, 80, { requis: true }), cout }
    const description = o.description == null ? '' : texte(o.description, `description de la récompense n° ${i + 1}`, 200)
    if (description) r.description = description
    return r
  })
}

function reglesMessages(v: unknown): ReglesMessages {
  const o = (v ?? {}) as Corps
  return Object.fromEntries(TYPES_MESSAGES.map(({ type }) => [type, booleen(o[type] ?? false, type)])) as ReglesMessages
}

function apparence(v: unknown): Apparence {
  const o = (v ?? {}) as Corps
  const a: Apparence = {}
  for (const k of ['couleur', 'fond', 'banniere'] as const) {
    const s = o[k] == null ? '' : texte(o[k], k, 500)
    if (s) a[k] = s
  }
  const p = problemesApparence(a)
  if (p.length) throw err(400, p.join(' '))
  return a
}

const CHAMPS_REGLAGES = ['nom', 'type', 'logo', 'lienGoogle', 'coordonnees', 'lienDeliveroo', 'lienUberEats', 'recompense', 'seuilTampons', 'lots', 'reglesReponseAuto', 'actif', 'eurosParPoint', 'catalogue', 'messagesAuto', 'apparence', 'programme', 'relancesAuto', 'conservationMois', 'testsAB', 'modeAccesRoue', 'limiteGainsMois', 'plagesOuverture']

/**
 * Tests A/B (P2-Q3) : le navigateur n'envoie que `{ accroche: { actif } }` ; les dates de début et de fin sont posées
 * ici (jour à Paris) au changement d'état, jamais reçues du navigateur.
 */
function testsAB(v: unknown, existant: TestsAB | undefined, aujourdhui: string): TestsAB {
  const o = (v ?? {}) as Corps
  const inconnus = Object.keys(o).filter((k) => k !== 'accroche')
  if (inconnus.length) throw err(400, `Test A/B inconnu : ${inconnus.join(', ')}.`)
  const r: TestsAB = { ...existant }
  if ('accroche' in o) {
    r.accroche = basculerAccroche(existant?.accroche, booleen(((o.accroche ?? {}) as Corps).actif, 'testsAB.accroche.actif'), aujourdhui)
  }
  return r
}

/** Fusion d'une configuration de programme partielle (PATCH) : chaque bloc est fusionné, pas remplacé. */
function fusionnerProgramme(existant: Commerce['programme'], patch: NonNullable<Commerce['programme']>): NonNullable<Commerce['programme']> {
  const r: Record<string, unknown> = { ...(existant ?? {}) }
  for (const [k, v] of Object.entries(patch)) {
    const ancien = r[k]
    r[k] = ancien && typeof ancien === 'object' && v && typeof v === 'object' ? { ...ancien, ...v } : v
  }
  return r as NonNullable<Commerce['programme']>
}

/** Réglages modifiables d'un commerce : tout autre champ est refusé (400). */
function appliquerReglages(c: Commerce, corps: Corps, autorises = CHAMPS_REGLAGES, aujourdhui = jourParis(new Date())): Commerce {
  const inconnus = Object.keys(corps).filter((k) => !autorises.includes(k))
  if (inconnus.length) throw err(400, `Champ non modifiable : ${inconnus.join(', ')}.`)
  const r: Commerce = { ...c }
  if ('nom' in corps) r.nom = texte(corps.nom, 'nom', 80, { requis: true })
  if ('type' in corps) r.type = typeCommerce(corps.type)
  if ('logo' in corps) r.logo = texte(corps.logo, 'logo', 500)
  if ('lienGoogle' in corps) r.lienGoogle = lien(corps.lienGoogle)
  if ('coordonnees' in corps) r.coordonnees = texte(corps.coordonnees, 'coordonnees', 300)
  if ('lienDeliveroo' in corps) r.lienDeliveroo = lienCommande(corps.lienDeliveroo, 'lienDeliveroo')
  if ('lienUberEats' in corps) r.lienUberEats = lienCommande(corps.lienUberEats, 'lienUberEats')
  if ('recompense' in corps) r.recompense = texte(corps.recompense, 'recompense', 120, { requis: true })
  if ('seuilTampons' in corps) {
    const s = corps.seuilTampons
    if (typeof s !== 'number' || !Number.isInteger(s) || s < 1 || s > 50) throw err(400, '« seuilTampons » doit être un nombre entier entre 1 et 50.')
    r.seuilTampons = s
  }
  if ('lots' in corps) r.lots = lots(corps.lots, c.lots ?? [])
  if ('testsAB' in corps) r.testsAB = testsAB(corps.testsAB, c.testsAB, aujourdhui)
  if ('reglesReponseAuto' in corps) {
    const o = (corps.reglesReponseAuto ?? {}) as Corps
    r.reglesReponseAuto = {
      auto5Etoiles: booleen(o.auto5Etoiles, 'auto5Etoiles'),
      auto4Etoiles: booleen(o.auto4Etoiles, 'auto4Etoiles'),
      brouillonAutres: booleen(o.brouillonAutres, 'brouillonAutres'),
    }
  }
  if ('actif' in corps) r.actif = booleen(corps.actif, 'actif')
  if ('eurosParPoint' in corps) {
    const e = corps.eurosParPoint
    if (typeof e !== 'number' || !Number.isFinite(e) || e < 0.1 || e > 1000 || Math.round(e * 100) !== e * 100) {
      throw err(400, '« eurosParPoint » : nombre d’euros pour 1 point, entre 0,10 et 1 000 (2 décimales maximum).')
    }
    r.eurosParPoint = e
  }
  if ('catalogue' in corps) r.catalogue = catalogue(corps.catalogue)
  if ('messagesAuto' in corps) r.messagesAuto = reglesMessages(corps.messagesAuto)
  if ('apparence' in corps) r.apparence = apparence(corps.apparence)
  if ('programme' in corps) {
    let programme
    try {
      programme = validerProgramme(corps.programme)
    } catch (e) {
      throw err(400, (e as Error).message)
    }
    r.programme = fusionnerProgramme(c.programme, programme)
  }
  if ('relancesAuto' in corps) {
    const o = (corps.relancesAuto ?? {}) as Corps
    const inconnus = Object.keys(o).filter((k) => k !== 'inactif' && k !== 'anniversaire' && k !== 'gainExpire')
    if (inconnus.length) throw err(400, `« relancesAuto » : champ inconnu (${inconnus.join(', ')}).`)
    r.relancesAuto = {
      inactif: booleen(o.inactif ?? false, 'inactif'),
      anniversaire: booleen(o.anniversaire ?? false, 'anniversaire'),
      // R7 : absent = activé (rien n'est écrit tant que le commerçant n'a pas choisi).
      ...(o.gainExpire != null ? { gainExpire: booleen(o.gainExpire, 'gainExpire') } : {}),
    }
  }
  if ('modeAccesRoue' in corps) {
    const v = corps.modeAccesRoue
    if (v !== 'libre' && v !== 'visite') throw err(400, '« modeAccesRoue » doit valoir « libre » (1 tirage par jour dès l’identification) ou « visite » (visite validée au comptoir le jour même).')
    r.modeAccesRoue = v
  }
  if ('limiteGainsMois' in corps) {
    const n = corps.limiteGainsMois
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > LIMITE_GAINS_MOIS_MAX) {
      throw err(400, `« limiteGainsMois » : nombre entier de lots gagnés par client sur 30 jours, de 0 (illimité) à ${LIMITE_GAINS_MOIS_MAX}.`)
    }
    r.limiteGainsMois = n
  }
  if ('plagesOuverture' in corps) {
    const p = problemePlages(corps.plagesOuverture)
    if (p) throw err(400, `« plagesOuverture » : ${p}.`)
    r.plagesOuverture = (corps.plagesOuverture as Corps[]).map((x) => ({ debut: x.debut as string, fin: x.fin as string }))
  }
  if ('conservationMois' in corps) {
    const n = corps.conservationMois
    if (typeof n !== 'number' || !Number.isInteger(n) || n < CONSERVATION_MIN_MOIS || n > CONSERVATION_MAX_MOIS) {
      throw err(400, `« conservationMois » : nombre entier de mois entre ${CONSERVATION_MIN_MOIS} et ${CONSERVATION_MAX_MOIS}.`)
    }
    r.conservationMois = n
  }
  return r
}

/** Consentement aux relances posé ou retiré, avec sa date et son origine (preuve RGPD). */
function avecConsentement(c: Client, valeur: boolean, origine: NonNullable<Client['consentementRelanceOrigine']>, t: Date): Client {
  return { ...c, consentementRelance: valeur, consentementRelanceLe: t.toISOString(), consentementRelanceOrigine: origine }
}

const CODE_EQUIPE = /^\d{4}$/

function codeEquipe(v: unknown): string {
  if (typeof v !== 'string' || !CODE_EQUIPE.test(v)) throw err(400, 'Le code équipe doit contenir exactement 4 chiffres.')
  return v
}

function contactOuErreur(v: unknown) {
  const contact = typeof v === 'string' ? analyserContact(v) : null
  if (!contact) throw err(400, 'Contact invalide : indiquez un numéro de téléphone (06 12 34 56 78) ou un e-mail.')
  return contact
}

// ---------- Représentations ----------
// Fiche publique d'un commerce : `commercePublic` (src/lib/vuePublique.ts), liste blanche sans probabilités,
// règles de réponse, taux de points ni réglages internes du programme. Le PIN est stocké à part.

/** Carte vue par le client lui-même (page publique) : sans téléphone, e-mail ni données techniques. */
function cartePublique(c: Client) {
  // Messages privés (P1-C4) : destinés au commerce seul, jamais renvoyés sur le lien de la carte.
  // `filleulsRegles` (point Codex 2) : ids d'autres clients, donnée technique du règlement de parrainage.
  // `parrainageEnAttente` (revue Codex finale) : décision interne du règlement, même traitement.
  const { telephone: _t, email: _e, actionsTraitees: _a, clesMessages: _k, messagesPrives: _p, filleulsRegles: _f, parrainageEnAttente: _r, ...reste } = c
  return reste
}

/** Client vu en caisse : contact (pour la recherche) et soldes, sans la boîte de réception ni les données techniques. */
function clientCaisse(c: Client) {
  // Revue Codex finale, point 6 : marqueur et décision de parrainage sont techniques (ids d'autres clients).
  const { messages: _m, clesMessages: _k, actionsTraitees: _a, filleulsRegles: _f, parrainageEnAttente: _r, ...reste } = c
  return reste
}

/**
 * Client vu par un membre de l'équipe en caisse (revue Codex P0-S14, point 1) : comme `clientCaisse`, sans les
 * messages privés au restaurant — réservés au gérant (page Avis, via GET …/etat qui garde `clientCaisse`).
 */
function clientCaisseEquipe(c: Client) {
  const { messagesPrives: _p, ...reste } = clientCaisse(c)
  return reste
}

/**
 * Commerce vu en caisse (P0-S14) : seulement ce que le comptoir affiche et calcule — nom, logo, seuil, récompense,
 * catalogue, taux de points, programme des niveaux. Jamais les lots (probabilités), ni les réglages internes
 * (réponses auto, messages auto, relances, tests A/B, conservation, dates, liens de commande, lien Google).
 */
function commerceCaisse(c: Commerce): CommerceCaisse {
  return {
    id: c.id,
    nom: c.nom,
    ...(c.logo !== undefined ? { logo: c.logo } : {}),
    seuilTampons: c.seuilTampons,
    recompense: c.recompense,
    ...(c.catalogue !== undefined ? { catalogue: c.catalogue } : {}),
    ...(c.eurosParPoint !== undefined ? { eurosParPoint: c.eurosParPoint } : {}),
    ...(c.programme !== undefined ? { programme: c.programme } : {}),
  }
}

/** Tirage sans son code gagnant (état commerçant, revue Codex R3 F1). */
function tirageSansCode(t: Tirage): Tirage {
  const { code: _code, ...reste } = t
  return reste
}

/**
 * Gain vu en caisse (P0-U3) : de quoi reconnaître le client (prénom seul, jamais son contact) et l'état du code (`code` :
 * celui que la caisse vient de saisir). `ancienneRegle` : tirage d'avant la roue v2 (`tirageHerite`, revue Codex F2).
 */
function gainCaisse(t: Tirage, client: Client | undefined, maintenant: Date) {
  return {
    code: t.code ?? '',
    lot: t.lot,
    date: t.date,
    statut: statutGain(t, maintenant),
    client: client ? { id: client.id, prenom: client.prenom } : null,
    remis: t.remis ? { le: t.remis.le, par: t.remis.par.nom } : null,
    ...(tirageHerite(t) ? { ancienneRegle: true as const } : {}),
  }
}

/**
 * Gains non terminaux d'un client, vus par sa carte (R3) : statut v2, dates d'utilisation, fin de la fenêtre
 * d'activation en cours — jamais le code. Du plus ancien au plus récent (le premier à expirer d'abord).
 */
function gainsEnCoursDe(tirages: Tirage[], maintenant: Date) {
  return tirages
    .filter((x) => estGainPhysique(typeTirage(x)) && gainEnCours(statutGain(x, maintenant)))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((x) => {
      const statut = statutGain(x, maintenant)
      return {
        tirageId: x.id,
        lot: x.lot,
        date: x.date,
        statut,
        utilisableLe: utilisableLe(x).toISOString(),
        // Premier instant expiré : minuit à la fin de J+30.
        expireLe: finGain(x).toISOString(),
        // Tirage hérité du jour même : utilisable sans activation, donc sans fenêtre.
        expireActivation: statut === 'utilisable' && !tirageHerite(x) ? finActivation(x) : null,
      }
    })
}

// ---------- Initialisation de la base ----------

/** Ignore un doublon (ligne déjà créée par un démarrage précédent ou une autre instance). */
async function sansDoublon(ecriture: unknown) {
  try {
    await ecriture
  } catch (e) {
    if (!(e instanceof ErreurConflit)) throw e
  }
}

async function initialiser(st: Stockage, o: OptionsServeur) {
  if (!(await st.meta('initialise'))) {
    if (!o.pinInitial || !PIN_VALIDE.test(o.pinInitial)) {
      throw new Error('Base vide : un PIN initial (4 à 6 chiffres) est requis pour Asian Home Paris (variable PIN_ASIAN_HOME).')
    }
    const [asianHome] = seed.commerces as unknown as Commerce[]
    // Haché avant la transaction : scrypt est asynchrone (pool de threads), rien ne doit attendre BEGIN … COMMIT.
    const pinAsianHome = await hacherPin(o.pinInitial)
    await st.transaction(async () => {
      // Le vrai commerce, SANS les clients / avis / tirages fictifs du seed.
      // (Déjà présent : démarrage précédent interrompu avant la ligne `meta` — possible sous Supabase, sans transaction.)
      if (!(await st.commerce(asianHome.id))) {
        await sansDoublon(st.ajouterCommerce({ ...asianHome, creeLe: new Date().toISOString(), demo: false }, pinAsianHome))
      }
      await st.majMeta('initialise', new Date().toISOString())
    })
  }
  if (o.demo && !(await st.meta('demo'))) {
    const pin = o.pinInitial && PIN_VALIDE.test(o.pinInitial) ? o.pinInitial : '1234'
    const demo = seedRecale()
    const ids = new Set(demo.commerces.slice(1).map((c) => c.id))
    const pinDemo = await hacherPin(pin)
    await st.transaction(async () => {
      for (const c of demo.commerces) if (ids.has(c.id) && !(await st.commerce(c.id))) await sansDoublon(st.ajouterCommerce({ ...c, demo: true }, pinDemo))
      for (const c of demo.clients) if (ids.has(c.commerceId)) await sansDoublon(st.ajouterClient(c))
      for (const t of demo.tirages) if (ids.has(t.commerceId)) await sansDoublon(st.ajouterTirage(t))
      for (const a of demo.avis) if (ids.has(a.commerceId)) await sansDoublon(st.ajouterAvis(a))
      await st.majMeta('demo', new Date().toISOString())
    })
  }
}

/**
 * P0-S11 : sous Supabase, le journal d'audit (0003) et les traces du programme (0004) ne sont jamais ignorés — le
 * stockage lève ErreurMigrationManquante sans leurs tables. Plutôt que des 503 au milieu d'une visite (fait métier écrit,
 * trace refusée), le serveur refuse de démarrer. SQLite crée tout son schéma au démarrage : rien à vérifier.
 */
async function exigerMigrationsAudit(st: Stockage) {
  if (st.type !== 'supabase') return
  const conseil = 'Faites d’abord une sauvegarde (node scripts/sauvegarde-base.mjs, voir server/README.md), puis appliquez-la dans le SQL Editor de Supabase.'
  if (!(await st.schemaCartiz())) {
    throw new Error(`Démarrage refusé : migration supabase/migrations/0003_cartiz.sql absente (journal d’audit). ${conseil}`)
  }
  if (!(await st.schemaProgramme())) {
    throw new Error(`Démarrage refusé : migration supabase/migrations/0004_programme.sql absente (traces de parrainage et de rattrapage). ${conseil}`)
  }
}

// ---------- En-têtes HTTP de sécurité (P0-S4, faille F-08) — sur TOUTES les réponses (API, front, erreurs) ----------

/**
 * CSP calibrée sur ce que le front compilé fait réellement (vérifié le 10/11/2026 dans dist/ et src/) :
 * - script-src 'self' : un seul `<script type="module" src="/assets/…">`, aucun script inline, ni eval / new Function ;
 *   jsQR est un morceau du même bundle chargé par `import()` (même origine).
 * - style-src 'self' : une seule feuille `/assets/*.css` (Tailwind compilé par Vite, aucun `<style>` injecté). Les props
 *   React `style={…}` (roue, barres de progression, couleur du commerce) passent par le CSSOM (`el.style.x = …`), que la
 *   CSP ne bloque pas : pas besoin de 'unsafe-inline'.
 * - img-src 'self' data: https: — ASSOUPLISSEMENT nécessaire : photos du menu importées en base64
 *   (`data:image/jpeg;base64,…`, src/lib/menu.ts) ; logo, bannière et photos peuvent être n'importe quelle adresse
 *   https://… saisie par le commerçant (src/lib/apparence.ts, src/lib/menu.ts). Le QR est un `<svg>` dessiné en DOM.
 * - connect-src 'self' : en production le front appelle l'API à la même adresse (VITE_API_URL=/, .env.api). Un front
 *   servi par Vite en développement n'est pas concerné (il ne reçoit pas ces en-têtes).
 * - Caméra de la caisse : `getUserMedia` + `video.srcObject` (pas d'URL chargée, rien à autoriser côté CSP) ; elle
 *   dépend de Permissions-Policy `camera=(self)` ci-dessous.
 * - frame-ancestors 'none' (= X-Frame-Options DENY), object-src 'none', base-uri / form-action 'self'.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

export const ENTETES_SECURITE: Record<string, string> = {
  'Content-Security-Policy': CSP,
  // Pas de `preload` : le domaine est un sous-domaine de onrender.com (décision à prendre avec un domaine à soi).
  // Ignoré par les navigateurs en http:// (développement local).
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  // Les routes du front sont dans le fragment (#/carte/…), jamais envoyé ; on ne transmet rien d'autre aux sites tiers.
  'Referrer-Policy': 'same-origin',
  // camera=(self) : scan du QR client à la caisse (src/components/ScannerQr.tsx). Tout le reste est coupé.
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
}

/**
 * Valeur de CORS_ORIGIN → origine exacte (`https://hote[:port]`), ou '*'. Lève une erreur si la valeur n'est pas une
 * origine (chemin, protocole autre que http(s), texte libre) : mieux vaut refuser de démarrer qu'autoriser autre chose.
 */
export function lireOrigineCors(valeur: string): string {
  const v = valeur.trim()
  if (v === '*') return '*'
  let origine: string | undefined
  try {
    const u = new URL(v)
    if ((u.protocol === 'https:' || u.protocol === 'http:') && u.origin === v.replace(/\/$/, '')) origine = u.origin
  } catch {
    // traité ci-dessous
  }
  if (!origine) throw new Error(`CORS_ORIGIN invalide : « ${v} ». Attendu : une origine exacte, ex. https://asian-home-fidelite.onrender.com (sans chemin).`)
  return origine
}

/**
 * En-têtes CORS. '*' (développement, ou CORS_ORIGIN absente) : comme avant. Sinon, seule l'origine configurée (comparaison
 * exacte) reçoit Access-Control-Allow-* ; une origine étrangère ne reçoit rien (le navigateur bloque), jamais de reflet.
 * Les requêtes sans Origin (curl, même origine en GET) sont servies normalement.
 */
function entetesCors(autorisee: string, origine: string | undefined): Record<string, string> {
  const autorisation = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Session, X-Commerce-PIN, X-Admin-PIN, X-Equipe-Code',
    'Access-Control-Max-Age': '600',
  }
  if (autorisee === '*') return { 'Access-Control-Allow-Origin': '*', ...autorisation }
  if (origine === autorisee) return { 'Access-Control-Allow-Origin': origine, ...autorisation, Vary: 'Origin' }
  return { Vary: 'Origin' }
}

// ---------- Fichiers statiques (front compilé, optionnel) ----------

const TYPES_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
}

/** Cache des fichiers statiques : voir server/README.md (« En-têtes HTTP »). */
const CACHE_IMMUABLE = 'public, max-age=31536000, immutable'
const CACHE_VISUELS = 'public, max-age=3600'

/** ETag faible taille + date de modification (comme `serve-static`) : suffit à répondre 304 sans relire le fichier. */
function etag(taille: number, mtimeMs: number): string {
  return `W/"${taille.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`
}

function etagCorrespond(entete: string | undefined, valeur: string): boolean {
  if (!entete) return false
  const sansFaible = (e: string) => e.trim().replace(/^W\//, '')
  return entete.split(',').some((e) => e.trim() === '*' || sansFaible(e) === sansFaible(valeur))
}

// ---------- Compression des réponses (P2-Q2) ----------

/** Seuil : en dessous, la compression coûte plus qu'elle ne rapporte (en-têtes + CPU). */
const SEUIL_COMPRESSION_OCTETS = 1024
/** Types compressibles (texte) : les images et polices sont déjà compressées, les recompresser serait inutile. */
const TYPES_COMPRESSIBLES = /^(text\/|application\/(json|manifest\+json|xml)|image\/svg\+xml)/
/** Garde-fou : le cache des variantes compressées ne grandit pas sans limite (un déploiement = ~25 fichiers). */
const CACHE_COMPRESSION_MAX = 128
/** Variantes compressées des fichiers statiques, par chemin absolu + ETag (le fichier change → l'ETag
 *  change ; deux fichiers différents ne partagent jamais une variante, revue Codex P2-Q2). */
const cacheCompression = new Map<string, { br?: Buffer; gzip?: Buffer }>()

/** Qualité d'un codage dans Accept-Encoding (RFC 9110 §12.5.3) : l'explicite prime sur le joker `*`
 *  (un `br;q=0` explicite n'est pas ressuscité par `*`), la casse est ignorée, une qualité mal
 *  formée (`q=oops`, `q=-1`) vaut 0 (codage non accepté), `q>1` est ramené à 1. */
function qualiteCodage(parties: string[], nom: string): number {
  const qualite = (p: string): number => {
    const m = /;\s*q=([^;,\s]+)/.exec(p)
    if (!m) return 1
    const q = Number(m[1])
    if (!Number.isFinite(q) || q < 0) return 0
    return q > 1 ? 1 : q
  }
  for (const p of parties) {
    if (p === nom || p.startsWith(`${nom};`)) return qualite(p)
  }
  for (const p of parties) {
    if (p === '*' || p.startsWith('*;')) return qualite(p)
  }
  return 0
}

/** Codage accepté par le client : la plus forte qualité, brotli préféré à égalité. */
function codageAccepte(req: IncomingMessage): 'br' | 'gzip' | null {
  const ae = req.headers['accept-encoding']
  if (!ae) return null
  const parties = ae.toLowerCase().split(',').map((p) => p.trim()).filter(Boolean)
  const qBr = qualiteCodage(parties, 'br')
  const qGzip = qualiteCodage(parties, 'gzip')
  if (qBr <= 0 && qGzip <= 0) return null
  return qGzip > qBr ? 'gzip' : 'br'
}

/** Ajoute `Accept-Encoding` au `Vary` existant (fusionné avec `Vary: Origin` du CORS, jamais remplacé). */
function avecVary(entetes: Record<string, string>): Record<string, string> {
  const vary = entetes.Vary
  if (!vary) return { ...entetes, Vary: 'Accept-Encoding' }
  if (/(^|,)\s*Accept-Encoding(\s|,|$)/i.test(vary)) return entetes
  return { ...entetes, Vary: `${vary}, Accept-Encoding` }
}

/** Calcule les en-têtes et le corps à envoyer (compressé ou non) — sans rien écrire.
 *  `cleCache` : clé des variantes compressées (fichiers statiques, chemin absolu + ETag : deux
 *  fichiers différents ne partagent jamais une variante, même à taille et mtime égales) ;
 *  sans clé, la compression est refaite à chaque fois (réponses JSON/CSV, corps différents à
 *  chaque requête). Sans `Accept-Encoding` (service worker hors ligne, `fetchFaux` des tests) :
 *  réponse d'identité, comme avant. */
function preparerCorps(
  req: IncomingMessage,
  entetes: Record<string, string>,
  type: string,
  corps: Buffer,
  cleCache?: string,
): { entetes: Record<string, string>; corps: Buffer } {
  const base = { ...entetes, 'Content-Type': type }
  if (!TYPES_COMPRESSIBLES.test(type) || corps.length < SEUIL_COMPRESSION_OCTETS) {
    return { entetes: { ...base, 'Content-Length': String(corps.length) }, corps }
  }
  const entetesVary = avecVary(base)
  const codage = codageAccepte(req)
  if (!codage) {
    return { entetes: { ...entetesVary, 'Content-Length': String(corps.length) }, corps }
  }
  let variantes = cleCache ? cacheCompression.get(cleCache) : undefined
  if (cleCache && !variantes) {
    variantes = {}
    if (cacheCompression.size >= CACHE_COMPRESSION_MAX) cacheCompression.clear()
    cacheCompression.set(cleCache, variantes)
  }
  let comprime = variantes?.[codage]
  if (!comprime) {
    comprime =
      codage === 'br'
        ? brotliCompressSync(corps, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } })
        : gzipSync(corps, { level: 6 })
    if (variantes) variantes[codage] = comprime
  }
  return { entetes: { ...entetesVary, 'Content-Encoding': codage, 'Content-Length': String(comprime.length) }, corps: comprime }
}

/** Envoie un corps en le compressant si le client l'accepte et que le type s'y prête ; sinon, identité. */
function envoyerCorps(
  req: IncomingMessage,
  res: ServerResponse,
  statut: number,
  entetes: Record<string, string>,
  type: string,
  corps: Buffer,
  cleCache?: string,
): void {
  const prep = preparerCorps(req, entetes, type, corps, cleCache)
  res.writeHead(statut, prep.entetes)
  res.end(prep.corps)
}

function servirStatique(dossier: string, chemin: string, req: IncomingMessage, res: ServerResponse, entetes: Record<string, string>): boolean {
  const racine = resolve(dossier)
  let decode: string
  try {
    decode = decodeURIComponent(chemin)
  } catch {
    return false
  }
  let fichier = resolve(join(racine, normalize(decode)))
  if (fichier !== racine && !fichier.startsWith(racine + sep)) return false
  // Les assets Vite (nom avec hash, dist/assets/) sont mis en cache un an : un asset absent (ancien déploiement) répond
  // 404 plutôt que index.html, qui serait refusé de toute façon comme script (nosniff).
  const asset = fichier.startsWith(join(racine, 'assets') + sep)
  if (!existsSync(fichier) || statSync(fichier).isDirectory()) {
    if (asset) return false
    fichier = join(racine, 'index.html')
  }
  if (!existsSync(fichier)) return false
  const infos = statSync(fichier)
  const balise = etag(infos.size, infos.mtimeMs)
  // Service worker et manifest (P1-C3) : revérifiés à chaque fois, comme index.html, sinon une ancienne version du
  // service worker resterait jusqu'à une heure en cache HTTP.
  const cache = [join(racine, 'index.html'), join(racine, 'sw.js'), join(racine, 'manifest.webmanifest')].includes(fichier)
      ? 'no-cache' // toujours revérifié (ETag → 304) : un nouveau déploiement est pris dès le rechargement
      : asset
        ? CACHE_IMMUABLE
        : CACHE_VISUELS
  const communs = { ...entetes, 'Cache-Control': cache, ETag: balise }
  const type = TYPES_MIME[extname(fichier)] ?? 'application/octet-stream'
  // La 304 porte le même Vary que la 200 (le client qui négocie doit savoir que la réponse varie).
  const communsVary = TYPES_COMPRESSIBLES.test(type) ? avecVary(communs) : communs
  if (etagCorrespond(req.headers['if-none-match'], balise)) {
    res.writeHead(304, communsVary).end()
    return true
  }
  const corps = readFileSync(fichier)
  if (req.method === 'HEAD') {
    // HEAD : exactement les mêmes en-têtes que GET (dont Content-Encoding et Content-Length
    // compressé, revue Codex P2-Q2), sans corps.
    const prep = preparerCorps(req, communsVary, type, corps, `${fichier}:${balise}`)
    res.writeHead(200, prep.entetes)
    res.end()
    return true
  }
  envoyerCorps(req, res, 200, communsVary, type, corps, `${fichier}:${balise}`)
  return true
}

// ---------- Serveur ----------

const TAILLE_MAX_CORPS = 64 * 1024
/** Le menu peut contenir des photos compressées (60 Ko chacune au plus). */
const TAILLE_MAX_MENU = 3 * 1024 * 1024

async function lireOctets(req: IncomingMessage, max: number, messageTrop = 'Requête trop volumineuse.'): Promise<Buffer> {
  let taille = 0
  const morceaux: Buffer[] = []
  for await (const m of req) {
    taille += (m as Buffer).length
    if (taille > max) throw err(413, messageTrop)
    morceaux.push(m as Buffer)
  }
  return Buffer.concat(morceaux)
}

async function lireBrut(req: IncomingMessage, max: number): Promise<string> {
  return (await lireOctets(req, max)).toString('utf8')
}

/** Corps `application/x-www-form-urlencoded` (webhooks Twilio). */
async function lireFormulaire(req: IncomingMessage): Promise<URLSearchParams> {
  return new URLSearchParams(await lireBrut(req, TAILLE_MAX_CORPS))
}

async function lireCorps(req: IncomingMessage, max = TAILLE_MAX_CORPS): Promise<Corps> {
  const brut = await lireBrut(req, max)
  if (!brut) return {}
  try {
    const v: unknown = JSON.parse(brut)
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error()
    return v as Corps
  } catch {
    throw err(400, 'Corps de requête invalide : un objet JSON est attendu.')
  }
}

function codeGagnant(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // sans 0/O, 1/I/L
  return Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('')
}

export async function creerServeur(o: OptionsServeur) {
  const origineCors = lireOrigineCors(o.origineCors ?? '*')
  const modeAuthClient: ModeAuthClient = o.authClient ?? 'transition'
  if (modeAuthClient === 'stricte' && !o.secretSession) {
    throw new Error('Accès client strict (AUTH_CLIENT=stricte) impossible sans SESSION_SECRET : les jetons client sont signés avec ce secret.')
  }
  const finGrace = Date.parse(o.graceAnciensIdJusquAu ?? GRACE_ANCIENS_ID_JUSQU_AU)
  if (Number.isNaN(finGrace)) throw new Error('Date de fin de grâce des anciens identifiants de carte illisible.')
  // Supabase seulement s'il est configuré ; sinon SQLite local (dev, tests, comportement d'avant S1).
  const st: Stockage = o.supabase ? ouvrirStockageSupabase(o.supabase) : ouvrirStockage(o.fichierDb)
  try {
    await initialiser(st, o)
    await exigerMigrationsAudit(st)
  } catch (e) {
    await st.fermer()
    throw e
  }
  // P2-Q6 (revue Codex 2e passe, point 1) : identifiants des commerces CONNUS, pour le masquage des logs —
  // seul un commerce connu reste en clair dans une ligne (un préfixe `c-…` ne prouve rien). Chargé après
  // `initialiser` (le commerce seed y est créé) ; complété à chaque création (POST /commerces). En cas
  // d'échec de lecture, l'ensemble reste vide : tous les identifiants de commerce sont alors masqués
  // (échec en sécurité, le serveur démarre quand même).
  const idsCommercesConnus = new Set<string>()
  try {
    for (const commerce of await st.commerces()) idsCommercesConnus.add(commerce.id)
  } catch {
    // Ensemble vide : masquage maximal, pas d'échec de démarrage pour les logs.
  }
  const maintenant = o.maintenant ?? (() => new Date())
  const alea = o.alea ?? Math.random
  // Tirages de la roue sérialisés PAR COMMERCE (revue Codex R2 point 1) — voir POST /commerces/:id/tirages.
  const fileTirages = creerFileParCle()
  const limiteur = creerLimiteurAuth(st, maintenant)
  // P0-S20 : persistance des compteurs publics (migration 0010). Table absente : `enregistrer` lève
  // ErreurMigrationManquante (avertissement une fois, mémoire seulement) ; `charger` renvoie [].
  const compteurs = creerCompteursPublics(maintenant, {
    charger: async () => st.compteursPublics(),
    enregistrer: async (c, purgerAvant) => {
      if (!(await schemaCompteursPublics())) throw new ErreurMigrationManquante('compteurs_publics', '0010_compteurs_publics.sql')
      await st.enregistrerCompteurPublic(c, purgerAvant)
    },
    schemaPresente: () => schemaCompteursPublics(),
    purger: async (avant) => {
      await st.purgerCompteursPublics(avant)
    },
  })
  const limites: LimitesPubliques = { ...LIMITES_PUBLIQUES, ...o.limitesPubliques }
  const nettoyage = setInterval(() => {
    compteurs.purger()
    limiteur.purger()
  }, FENETRE_PUBLIQUE_MS)
  nettoyage.unref()
  // En mémoire seulement : haché directement en scrypt à chaque démarrage.
  const adminPin = await hacherPin(o.adminPin)
  const notifications = creerNotifications(o.notifications)
  // Item E : alerte e-mail sur rafale de 5xx (inactive sans ALERTE_EMAIL), alimentée à la fin de chaque réponse.
  const alertes5xx = creerAlertes5xx({ destinataire: o.alerteEmail, notifications, maintenant })
  const integrations = () => ({
    googleWallet: walletConfigure(o.googleWallet),
    appleWallet: 'en_suspens',
    googleBusinessProfile: googleBusinessConfigure(o.googleBusiness),
    ...notifications.statut(),
    // Nom du prestataire SMS effectif (`Brevo` par défaut, `Twilio` en repli) : la page de confidentialité doit
    // nommer le bon sous-traitant. Absent tant que le SMS n'est pas configuré.
    ...(notifications.prestataire('sms') ? { smsPrestataire: notifications.prestataire('sms') } : {}),
    // Mode test (`BREVO_MODE_TEST=1`) : les relances sont simulées (e-mail en sandbox Brevo, SMS simulé) — aucun
    // envoi réel tant que cette variable vaut `1`. Visible ici pour que personne ne croie à un vrai envoi.
    ...(notifications.modeTest ? { modeTest: true } : {}),
  })

  const ipDe = (req: IncomingMessage) =>
    (o.derriereProxy && String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()) || req.socket?.remoteAddress || '?'

  /**
   * Journal des lectures sensibles (P2-S15) : un échantillon des lectures `GET /cartes/:id` et
   * `GET /commerces` (liste), pour détecter une énumération — beaucoup d'identifiants distincts, beaucoup
   * de 404, depuis une même IP (voir server/README.md « Journal des lectures sensibles »).
   * Échantillonnage obligatoire (volume) : `taux` = part journalisée (défaut 0,1, borné à [0, 1] — un taux
   * non fini, `NaN` par ex., retombe sur le défaut au lieu de tout journaliser, revue Codex point 4) ;
   * 1 en test. Plafond : 600 lignes/min (option `plafond`) — au-delà, les lignes sont comptées puis
   * résumées en une seule ligne à la minute suivante (revue Codex point 3). L'identifiant de carte n'est
   * jamais écrit en clair : empreinte SHA-256 tronquée (12 car. hex., 48 bits — assez pour compter les
   * identifiants distincts ; pseudonymisation, pas anonymisation : le hash sans sel permet de vérifier des
   * identifiants candidats, revue Codex point 6). Une ligne par lecture :
   * `[lecture-sensible] carte id=<empreinte> ip=… statut=…` ou
   * `[lecture-sensible] commerces ip=… statut=… nb=…` (console.info, comme les autres lignes `[securite]`).
   * La journalisation ne doit jamais faire échouer une lecture : toute erreur d'écriture est avalée.
   */
  const tauxBrut = o.journalLectures?.taux ?? 0.1
  const tauxJournalLectures = Number.isFinite(tauxBrut) ? Math.min(1, Math.max(0, tauxBrut)) : 0.1
  const plafondJournalLectures = Math.max(1, Math.floor(o.journalLectures?.plafond ?? 600))
  let fenetreJournalLectures = -1
  let lignesJournalLectures = 0
  let lignesSupprimeesJournalLectures = 0
  function journaliserLectureSensible(req: IncomingMessage, chemin: string[], statut: number, details?: string) {
    if (req.method !== 'GET') return
    const carte = chemin[0] === 'cartes' && chemin.length === 2
    const commerces = chemin[0] === 'commerces' && chemin.length === 1
    if (!carte && !commerces) return
    if (Math.random() >= tauxJournalLectures) return
    const minute = Math.floor(maintenant().getTime() / 60_000)
    if (minute !== fenetreJournalLectures) {
      if (lignesSupprimeesJournalLectures > 0) {
        try {
          console.info(`[lecture-sensible] plafond ${plafondJournalLectures} lignes/min atteint : ${lignesSupprimeesJournalLectures} ligne(s) supprimée(s) la minute précédente`)
        } catch {
          // La journalisation ne doit jamais faire échouer une lecture.
        }
      }
      fenetreJournalLectures = minute
      lignesJournalLectures = 0
      lignesSupprimeesJournalLectures = 0
    }
    if (lignesJournalLectures >= plafondJournalLectures) {
      lignesSupprimeesJournalLectures++
      return
    }
    lignesJournalLectures++
    const cible = carte ? `carte id=${createHash('sha256').update(chemin[1]).digest('hex').slice(0, 12)}` : 'commerces'
    try {
      console.info(`[lecture-sensible] ${cible} ip=${ipDe(req)} statut=${statut}${details ? ` ${details}` : ''}`)
    } catch {
      // La journalisation ne doit jamais faire échouer une lecture.
    }
  }

  // ---- Anti-abus des routes publiques (seuils : LIMITES_PUBLIQUES) ----
  const TROP = 'Trop de requêtes.'
  const limiterIp = (req: IncomingMessage, categorie: string, max: number) => compteurs.consommer(`${categorie}:${ipDe(req)}`, max, TROP)
  /** Par contact (téléphone / e-mail normalisé) dans un commerce ; contact illisible : rien à compter (la route répondra 400). */
  function limiterContact(categorie: string, commerceId: string, contactSaisi: unknown, max: number) {
    const contact = typeof contactSaisi === 'string' ? analyserContact(contactSaisi) : null
    if (contact) compteurs.consommer(`${categorie}:${commerceId}:${cleContact(contact)}`, max, 'Trop de tentatives pour ce contact.')
  }

  const enTete = (req: IncomingMessage, nom: string) => {
    const v = req.headers[nom]
    return typeof v === 'string' && v ? v : undefined
  }

  /**
   * Re-hachage scrypt d'un hash ancien format après un accès réussi : best-effort, ne fait jamais échouer l'accès.
   * `ecrire` est une écriture conditionnelle (revue Codex point 1) : elle ne remplace le hash que s'il est encore celui
   * qui vient d'être vérifié — un PIN / code changé entre-temps n'est jamais écrasé (re-hachage abandonné en silence).
   */
  async function rehacher(quoi: string, ecrire: (p: Pin) => unknown) {
    try {
      await ecrire(await hacherPin(quoi))
    } catch (e) {
      console.warn(`[serveur] re-hachage scrypt reporté au prochain accès : ${e instanceof Error ? e.message : e}`)
    }
  }

  // ---- Vérification des secrets (PIN admin, PIN commerce, code équipe) : limiteur anti-bruteforce + re-hachage ----

  // Clés du limiteur : l'IP (tous secrets confondus) et la cible (commerce ou admin, toutes IP confondues).
  const cleIp = (ip: string) => `ip:${ip}`
  const cleCible = (commerceId?: string) => `cible:${commerceId ?? 'admin'}`
  const cles = (ip: string, commerceId?: string) => [cleIp(ip), cleCible(commerceId)]
  const echecs = (ip: string, commerceId?: string): [string, number][] => [
    [cleIp(ip), MAX_ECHECS_IP],
    [cleCible(commerceId), MAX_ECHECS_CIBLE],
  ]

  async function verifierPinAdmin(ip: string, pin: string) {
    await limiteur.verifier(cles(ip))
    if (!(await pinCorrect(pin, adminPin)).ok) {
      await limiteur.echec(echecs(ip), 'admin')
      throw err(401, 'PIN admin incorrect.')
    }
    await limiteur.succes(cleIp(ip))
  }

  async function verifierPinCommerce(ip: string, commerceId: string, pin: string) {
    await limiteur.verifier(cles(ip, commerceId))
    const verifie = await st.pin(commerceId)
    const r = await pinCorrect(pin, verifie)
    if (!r.ok) {
      await limiteur.echec(echecs(ip, commerceId), 'commerce')
      throw err(401, 'PIN commerçant incorrect.')
    }
    await limiteur.succes(cleIp(ip))
    if (r.rehacher && verifie) await rehacher(pin, (p) => st.majPinSi(commerceId, verifie, p))
  }

  async function verifierCodeEquipe(ip: string, commerceId: string, code: string): Promise<MembreEquipe> {
    await limiteur.verifier(cles(ip, commerceId))
    let trouve: { membre: MembreEquipe; code: Pin; rehacher: boolean } | undefined
    if (CODE_EQUIPE.test(code)) {
      const membres = await st.membres(commerceId)
      const resultats = await Promise.all(membres.map((m) => pinCorrect(code, m.code)))
      const i = resultats.findIndex((r) => r.ok)
      if (i >= 0) trouve = { membre: membres[i].membre, code: membres[i].code, rehacher: resultats[i].rehacher }
    }
    if (!trouve) {
      if (!(await schemaCartiz())) throw new ErreurMigrationManquante('equipe')
      await limiteur.echec(echecs(ip, commerceId), 'equipe')
      throw err(401, 'Code équipe incorrect.')
    }
    await limiteur.succes(cleIp(ip))
    // Code seul, conditionné au hash vérifié : ni un nouveau code ni un nom changés entre-temps ne sont écrasés.
    if (trouve.rehacher) await rehacher(code, (p) => st.majCodeMembreSi(commerceId, trouve.membre.id, trouve.code, p))
    return trouve.membre
  }

  // ---- Sessions (X-Session) ----

  // Révocations connues de ce processus (jti → expiration en ms) : seule source tant que la table
  // `sessions_revoquees` (migration 0005) manque sous Supabase. `nonRevoquees` évite d'interroger la base à chaque
  // requête (5 min ; Render ne fait tourner qu'une instance, et toute révocation passe d'abord par `revoquees`).
  const revoquees = new Map<string, number>()
  const nonRevoquees = new Map<string, number>()
  const DELAI_CACHE_REVOCATION_MS = 5 * 60_000

  function purgerCaches(t: number) {
    for (const [jti, fin] of revoquees) if (fin <= t) revoquees.delete(jti)
    for (const [jti, fin] of nonRevoquees) if (fin <= t) nonRevoquees.delete(jti)
  }

  /** Session ou lien d'accès client (usage unique) déjà révoqué ? Même table, même cache (identifiant `jti`). */
  async function estRevoquee(c: { jti: string; exp: number }): Promise<boolean> {
    if (revoquees.has(c.jti)) return true
    const t = maintenant().getTime()
    if ((nonRevoquees.get(c.jti) ?? 0) > t) return false
    if (await st.sessionRevoquee(c.jti)) {
      revoquees.set(c.jti, c.exp * 1000)
      return true
    }
    nonRevoquees.set(c.jti, t + DELAI_CACHE_REVOCATION_MS)
    return false
  }

  async function revoquer(c: { jti: string; exp: number }) {
    revoquees.set(c.jti, c.exp * 1000)
    nonRevoquees.delete(c.jti)
    purgerCaches(maintenant().getTime())
    try {
      await st.revoquerSession(c.jti, new Date(c.exp * 1000).toISOString(), maintenant().toISOString())
    } catch (e) {
      // Base indisponible : la révocation reste en mémoire (perdue au redémarrage, le jeton expire de toute façon).
      console.warn(`[serveur] révocation de session gardée en mémoire seulement : ${e instanceof Error ? e.message : e}`)
    }
  }

  // Version du PIN par commerce, dans `meta` (clé `version_pin:<commerce>`, absente = 0) ; gardée en mémoire après la
  // 1re lecture (même principe que `versionAcces` : une instance qui a l'ancienne valeur en cache ne voit pas une
  // rotation faite par une autre — sans effet à une instance, docs/SECURITE.md § 4). Seul PUT /commerces/:id/pin
  // l'incrémente : les sessions `commerce` émises avant (champ `vp` du jeton) sont alors refusées. Sessions admin et
  // équipe non concernées.
  const cleVersionPin = (commerceId: string) => `version_pin:${commerceId}`
  const versionsPin = new Map<string, number>()
  async function versionPin(commerceId: string): Promise<number> {
    const cle = cleVersionPin(commerceId)
    const connue = versionsPin.get(cle)
    if (connue !== undefined) return connue
    const v = Number(await st.meta(cle)) || 0
    versionsPin.set(cle, v)
    return v
  }

  /**
   * Changement du PIN commerce (revue Codex points 3 et 4) : version + 1 PUIS nouveau PIN, dans une `transaction`, les
   * deux écritures conditionnées à ce qui a été relu dedans (`majMetaSi`, `majPinSi`). SQLite : tout ou rien. Supabase
   * (pas de transaction multi-requêtes) : une panne entre les deux laisse la version incrémentée et l'ancien PIN —
   * sessions mortes, jamais « nouveau PIN + anciennes sessions vivantes ». Deux rotations simultanées : la perdante
   * trouve la version ou le PIN déjà changés → ErreurConflit (409), jamais la même version écrite deux fois.
   * Le cache n'est mis à jour qu'une fois le PIN écrit (il retarde sur la base, jamais d'avance : `ouvrirSession`).
   */
  async function changerPinCommerce(commerceId: string, pinClair: string) {
    const cle = cleVersionPin(commerceId)
    await versionPin(commerceId) // cache chaud : pendant la rotation, les ouvertures de session lisent l'ancienne version
    const nouveau = await hacherPin(pinClair) // scrypt hors transaction (SQLite : ne pas la garder ouverte pendant le calcul)
    let versionEcrite = false
    try {
      const v = await st.transaction(async () => {
        const lue = await st.meta(cle)
        const ancien = await st.pin(commerceId)
        const suivante = (Number(lue) || 0) + 1
        if (!ancien) throw err(404, 'Commerce introuvable.')
        versionEcrite = true // une panne pendant l'écriture laisse un doute : relire la base ensuite
        if (!(await st.majMetaSi(cle, lue, String(suivante)))) {
          versionEcrite = false // rien écrit : une autre rotation est passée
          throw new ErreurConflit(`Version du PIN modifiée entre-temps (${commerceId}).`)
        }
        if (!(await st.majPinSi(commerceId, ancien, nouveau))) throw new ErreurConflit(`PIN modifié entre-temps (${commerceId}).`)
        return suivante
      })
      versionsPin.set(cle, v)
    } catch (e) {
      // Version peut-être écrite (Supabase) ou annulée (SQLite) : la base fait foi à la prochaine lecture.
      if (versionEcrite) versionsPin.delete(cle)
      throw e
    }
  }

  /** Session de l'en-tête X-Session (absente → undefined). Jeton falsifié, expiré, révoqué ou PIN changé depuis → 401. */
  async function session(req: IncomingMessage): Promise<ChargeSession | undefined> {
    const jeton = enTete(req, 'x-session')
    if (!jeton) return undefined
    const c = o.secretSession ? lireJeton(o.secretSession, jeton) : null
    if (!c) throw err(401, 'Session invalide : déverrouillez à nouveau.')
    if (c.exp * 1000 <= maintenant().getTime()) throw err(401, 'Session expirée : déverrouillez à nouveau.')
    if (await estRevoquee(c)) throw err(401, 'Session fermée : déverrouillez à nouveau.')
    if (c.role === 'commerce' && c.commerceId && (c.vp ?? 0) !== (await versionPin(c.commerceId))) {
      throw err(401, 'Session fermée : le code du commerce a changé, déverrouillez à nouveau.')
    }
    return c
  }

  const horsPortee = () => err(403, 'Cette session ne donne pas accès à cette ressource.')

  async function exigerAdmin(req: IncomingMessage) {
    const s = await session(req)
    if (s) {
      if (s.role !== 'admin') throw horsPortee()
      return
    }
    const pin = enTete(req, 'x-admin-pin')
    if (!pin) throw err(401, 'PIN admin manquant (en-tête X-Admin-PIN).')
    await verifierPinAdmin(ipDe(req), pin)
  }

  /**
   * Session (X-Session, prioritaire) ou PIN du commerce (X-Commerce-PIN) ; le PIN admin (X-Admin-PIN) ou une session
   * admin ouvrent aussi tous les commerces. Le PIN en en-tête reste accepté (compatibilité, à déprécier).
   * Retourne le nom de l'auteur pour le journal.
   */
  async function exigerCommercant(req: IncomingMessage, commerceId: string): Promise<'Admin' | 'Gérant'> {
    const s = await session(req)
    if (s) {
      if (s.role === 'admin') return 'Admin'
      if (s.role === 'commerce' && s.commerceId === commerceId) return 'Gérant'
      throw horsPortee()
    }
    if (enTete(req, 'x-admin-pin')) {
      await exigerAdmin(req)
      return 'Admin'
    }
    const pin = enTete(req, 'x-commerce-pin')
    if (!pin) throw err(401, 'PIN commerçant manquant (en-tête X-Commerce-PIN).')
    await verifierPinCommerce(ipDe(req), commerceId, pin)
    return 'Gérant'
  }

  const aUnPin = (req: IncomingMessage) => !!(enTete(req, 'x-commerce-pin') || enTete(req, 'x-admin-pin') || enTete(req, 'x-session'))

  type Auteur = EntreeJournal['auteur']

  /**
   * Auteur d'une action de caisse : membre de l'équipe (session équipe, ou X-Equipe-Code à 4 chiffres) ou gérant
   * (session / PIN commerce / admin). Le code n'est jamais renvoyé ni écrit dans le journal : seul le nom du membre l'est.
   */
  async function exigerAuteur(req: IncomingMessage, commerceId: string): Promise<{ auteur: Auteur; membre?: MembreEquipe }> {
    const s = await session(req)
    if (s?.role === 'equipe') {
      if (s.commerceId !== commerceId) throw horsPortee()
      // Membre retiré de l'équipe depuis l'ouverture de la session : la session ne vaut plus rien.
      const membre = (await st.membres(commerceId)).find((m) => m.membre.id === s.membreId)?.membre
      if (!membre) throw err(401, 'Session fermée : ce membre ne fait plus partie de l’équipe.')
      return { auteur: { type: 'membre', id: membre.id, nom: membre.nom }, membre }
    }
    const code = enTete(req, 'x-equipe-code')
    if (s || !code) return { auteur: { type: 'gerant', nom: await exigerCommercant(req, commerceId) } }
    const membre = await verifierCodeEquipe(ipDe(req), commerceId, code)
    return { auteur: { type: 'membre', id: membre.id, nom: membre.nom }, membre }
  }

  /** POST /sessions : échange un PIN / code équipe contre un jeton court. */
  async function ouvrirSession(req: IncomingMessage) {
    if (!o.secretSession) throw err(503, 'Sessions non configurées sur ce serveur (SESSION_SECRET absente) : le PIN reste utilisé.')
    const corps = await lireCorps(req)
    const ip = ipDe(req)
    const secret = (v: unknown, champ: string) => {
      if (typeof v !== 'string' || !v) throw err(400, `« ${champ} » est requis.`)
      return v
    }
    const c: ChargeSession = { jti: randomUUID(), role: 'admin', exp: 0 }
    if (corps.role === 'admin') {
      await verifierPinAdmin(ip, secret(corps.pin, 'pin'))
    } else if (corps.role === 'commerce' || corps.role === 'equipe') {
      const commerceId = texte(corps.commerceId, 'commerceId', 80, { requis: true })
      await commerceOu404(commerceId)
      c.role = corps.role
      c.commerceId = commerceId
      if (corps.role === 'commerce') {
        // Revue Codex point 2 : la version tamponnée est celle d'AVANT la vérification ; si une rotation s'est terminée
        // pendant (version changée), le PIN vérifié peut être l'ancien → refus, on se reconnecte avec le nouveau.
        // Aucun `await` entre ce dernier contrôle et la signature du jeton (plus bas).
        const avant = await versionPin(commerceId)
        await verifierPinCommerce(ip, commerceId, secret(corps.pin, 'pin'))
        if ((await versionPin(commerceId)) !== avant) throw err(401, 'Le code du commerce vient de changer : déverrouillez à nouveau.')
        c.vp = avant
      } else {
        const membre = await verifierCodeEquipe(ip, commerceId, secret(corps.code, 'code'))
        c.membreId = membre.id
        c.nom = membre.nom
      }
    } else throw err(400, '« role » doit valoir "commerce", "admin" ou "equipe".')
    c.exp = Math.floor(maintenant().getTime() / 1000) + DUREE_SESSION_S[c.role]
    return {
      statut: 201,
      json: {
        jeton: emettreJeton(o.secretSession, c),
        role: c.role,
        ...(c.commerceId ? { commerceId: c.commerceId } : {}),
        ...(c.nom ? { membreNom: c.nom } : {}),
        expireLe: new Date(c.exp * 1000).toISOString(),
      },
    }
  }

  /** DELETE /sessions : révoque le jeton de l'en-tête X-Session (idempotent ; un jeton déjà expiré n'a rien à révoquer). */
  async function fermerSession(req: IncomingMessage) {
    if (!o.secretSession) throw err(503, 'Sessions non configurées sur ce serveur (SESSION_SECRET absente).')
    const jeton = enTete(req, 'x-session')
    if (!jeton) throw err(401, 'Session manquante (en-tête X-Session).')
    const c = lireJeton(o.secretSession, jeton)
    if (!c) throw err(401, 'Session invalide.')
    if (c.exp * 1000 > maintenant().getTime()) await revoquer(c)
    return { json: { ok: true } }
  }

  // ---- Accès client aux cartes (P0-S7) : jeton `Authorization: Bearer`, version d'accès, échecs comptés ----

  const REFUS_CARTE = 'Accès à cette carte refusé : ouvrez-la sur le téléphone utilisé à l’inscription, demandez un lien d’accès au comptoir, ou retrouvez-la avec votre téléphone ou votre e-mail.'
  const CONTACT_DEJA_INSCRIT = 'Ce téléphone ou cet e-mail a déjà une carte ici. Ouvrez-la sur le téléphone utilisé à l’inscription, demandez un lien d’accès au comptoir, ou utilisez « Retrouver ma carte ».'
  /** Appels sans jeton acceptés en mode transition (GET /sante) : quand il n'en reste plus, passer en mode strict. */
  let accesSansJeton = 0

  // Version d'accès par carte, dans `meta` (clé `acces_client:<commerce>:<client>`, absente = 0) ; gardée en mémoire
  // après la 1re lecture (Render = une instance, et toute révocation passe par `revoquerAccesCarte`).
  const cleVersionAcces = (commerceId: string, clientId: string) => `acces_client:${commerceId}:${clientId}`
  const versionsAcces = new Map<string, number>()
  async function versionAcces(commerceId: string, clientId: string): Promise<number> {
    const cle = cleVersionAcces(commerceId, clientId)
    const connue = versionsAcces.get(cle)
    if (connue !== undefined) return connue
    const v = Number(await st.meta(cle)) || 0
    versionsAcces.set(cle, v)
    return v
  }
  /** Révoque TOUS les jetons et liens d'accès de la carte (version + 1, relue en base). */
  async function revoquerAccesCarte(commerceId: string, clientId: string) {
    const cle = cleVersionAcces(commerceId, clientId)
    const v = (Number(await st.meta(cle)) || 0) + 1
    await st.majMeta(cle, String(v))
    versionsAcces.set(cle, v)
  }

  const cleClientIp = (req: IncomingMessage) => `client-ip:${ipDe(req)}`
  const verifierBlocageClient = (req: IncomingMessage) => limiteur.verifier([cleClientIp(req)], 'Trop de tentatives d’accès à une carte.')
  /** Échec d'accès client (compté par IP dans `tentatives_auth`, portée `client`) → 401 uniforme, ou 404 « introuvable ». */
  async function refusCarte(req: IncomingMessage, statut: 401 | 404 = 401): Promise<never> {
    await limiteur.echec([[cleClientIp(req), MAX_ECHECS_CLIENT_IP]], 'client')
    throw err(statut, statut === 404 ? 'Carte de fidélité introuvable.' : REFUS_CARTE)
  }

  /**
   * Jeton client de l'en-tête `Authorization: Bearer` (absent → undefined). Falsifié, de type `lien`, d'une autre carte
   * ou d'un autre commerce → échec compté + 401 ; expiré ou révoqué → 401 (non compté : usure normale). Même réponse
   * dans tous les cas, que la carte existe ou non.
   */
  async function jetonClient(req: IncomingMessage, cible: { clientId?: string; commerceId?: string }): Promise<ChargeClient | undefined> {
    const brut = enTete(req, 'authorization')
    if (brut === undefined) return undefined
    await verifierBlocageClient(req)
    const jeton = /^Bearer\s+(\S+)$/i.exec(brut)?.[1]
    const c = jeton && o.secretSession ? lireJetonClient(o.secretSession, jeton) : null
    if (!c || c.typ !== 'client' || (cible.clientId && c.cid !== cible.clientId) || (cible.commerceId && c.com !== cible.commerceId)) return refusCarte(req)
    if (c.exp * 1000 <= maintenant().getTime() || c.ver !== (await versionAcces(c.com, c.cid))) throw err(401, REFUS_CARTE)
    return c
  }

  /**
   * Preuve exigée par les routes protégées d'une carte : jeton client. Mode transition : sans jeton, l'accès d'avant
   * P0-S7 reste admis (undefined, l'appelant applique alors ses anciennes vérifications) et il est compté.
   */
  async function exigerAccesCarte(req: IncomingMessage, cible: { clientId?: string; commerceId?: string }): Promise<ChargeClient | undefined> {
    const c = await jetonClient(req, cible)
    if (c) return c
    if (modeAuthClient === 'transition') {
      accesSansJeton++
      return undefined
    }
    await verifierBlocageClient(req)
    return refusCarte(req)
  }

  /** Carte désignée par un jeton valide ; supprimée depuis (ou commerce disparu) → 401 uniforme. */
  async function carteDuJeton(c: ChargeClient): Promise<{ commerce: Commerce; client: Client }> {
    const commerce = await st.commerce(c.com)
    const client = commerce && (await st.client(commerce.id, c.cid))
    if (!commerce || !client) throw err(401, REFUS_CARTE)
    return { commerce, client }
  }

  /** Jeton client neuf (version d'accès actuelle de la carte), à ranger par le navigateur. */
  async function accesClient(commerceId: string, clientId: string) {
    const exp = Math.floor(maintenant().getTime() / 1000) + DUREE_JETON_CLIENT_S
    const charge: ChargeClient = { typ: 'client', jti: randomUUID(), cid: clientId, com: commerceId, ver: await versionAcces(commerceId, clientId), exp }
    return { jeton: emettreJetonClient(o.secretSession!, charge), expireLe: new Date(exp * 1000).toISOString() }
  }

  /**
   * `jti` des liens d'accès en cours d'échange (POST /cartes/:id/jeton) : réservation synchrone, en mémoire, contre deux
   * échanges simultanés du même lien. Une seule instance (Render) ; à plusieurs instances, la fenêtre entre la lecture
   * et l'écriture de la révocation en base reviendrait (server/README.md).
   */
  const echangesEnCours = new Set<string>()

  /** Lien d'accès à usage unique (`lien`), à échanger contre un jeton client sur la page de la carte. */
  async function lienAcces(commerceId: string, clientId: string, dureeS: number) {
    const exp = Math.floor(maintenant().getTime() / 1000) + dureeS
    const charge: ChargeClient = { typ: 'lien', jti: randomUUID(), cid: clientId, com: commerceId, ver: await versionAcces(commerceId, clientId), exp }
    return { jeton: emettreJetonClient(o.secretSession!, charge), expireLe: new Date(exp * 1000).toISOString() }
  }

  /** Ancienne carte (identifiant prévisible) dont le lien seul n'ouvre plus rien : période de grâce terminée. */
  const graceTerminee = (clientId: string) => !estIdClientActuel(clientId) && maintenant().getTime() >= finGrace
  const infosGrace = (clientId: string) => (estIdClientActuel(clientId) ? {} : { ancienLien: true, graceJusquAu: new Date(finGrace).toISOString() })

  async function journaliser(commerceId: string, auteur: Auteur, action: EntreeJournal['action'], details: string, client?: Client, date = maintenant()) {
    const e: EntreeJournal = { id: `jr-${randomUUID()}`, commerceId, date: date.toISOString(), action, auteur, details }
    if (client) {
      e.clientId = client.id
      e.clientPrenom = client.prenom
    }
    await st.ajouterJournal(e)
  }

  const nouvelIdMessage = () => `msg-${randomUUID()}`

  // Vérifié au plus une fois par minute tant que la migration manque ; une fois présente, plus de vérification.
  let cartizPresent = false
  let cartizVerifieLe = 0
  async function schemaCartiz(): Promise<boolean> {
    if (cartizPresent || Date.now() - cartizVerifieLe < 60_000) return cartizPresent
    cartizVerifieLe = Date.now()
    try {
      cartizPresent = await st.schemaCartiz()
    } catch {
      cartizPresent = false
    }
    return cartizPresent
  }

  // Même principe pour la migration 0004 (parrainages, demandes de rattrapage — traces d'audit).
  let programmePresent = false
  let programmeVerifieLe = 0
  async function schemaProgramme(): Promise<boolean> {
    if (programmePresent || Date.now() - programmeVerifieLe < 60_000) return programmePresent
    programmeVerifieLe = Date.now()
    try {
      programmePresent = await st.schemaProgramme()
    } catch {
      programmePresent = false
    }
    return programmePresent
  }

  // Même principe pour la migration 0007 (journal des envois de relances).
  let relancesPresent = false
  let relancesVerifieLe = 0
  async function schemaRelances(): Promise<boolean> {
    if (relancesPresent || Date.now() - relancesVerifieLe < 60_000) return relancesPresent
    relancesVerifieLe = Date.now()
    try {
      relancesPresent = await st.schemaRelances()
    } catch {
      relancesPresent = false
    }
    return relancesPresent
  }

  // Même principe pour la migration 0008 (compteurs anonymes de la mesure, P2-Q3).
  let mesurePresent = false
  let mesureVerifieLe = 0
  async function schemaMesure(): Promise<boolean> {
    if (mesurePresent || Date.now() - mesureVerifieLe < 60_000) return mesurePresent
    mesureVerifieLe = Date.now()
    try {
      mesurePresent = await st.schemaMesure()
    } catch {
      mesurePresent = false
    }
    return mesurePresent
  }

  // Même principe pour la migration 0009 (portée `client` des échecs d'accès, P0-S7) ; lue par GET /sante seulement.
  let authClientPresent = false
  let authClientVerifieLe = 0
  async function schemaAuthClient(): Promise<boolean> {
    if (authClientPresent || Date.now() - authClientVerifieLe < 60_000) return authClientPresent
    authClientVerifieLe = Date.now()
    try {
      authClientPresent = await st.schemaAuthClient()
    } catch {
      authClientPresent = false
    }
    return authClientPresent
  }

  // Même principe pour la migration 0010 (compteurs des limites publiques, P0-S20) ; la persistance s'en sert pour
  // ne pas écrire dans une table absente, et le chargement au démarrage pour avertir une fois si elle manque.
  let compteursPublicsPresent = false
  let compteursPublicsVerifieLe = 0
  async function schemaCompteursPublics(): Promise<boolean> {
    if (compteursPublicsPresent || Date.now() - compteursPublicsVerifieLe < 60_000) return compteursPublicsPresent
    compteursPublicsVerifieLe = Date.now()
    try {
      compteursPublicsPresent = await st.schemaCompteursPublics()
    } catch {
      compteursPublicsPresent = false
    }
    return compteursPublicsPresent
  }

  // P0-S20 : recharge les compteurs persistés AVANT de servir (redémarrage, réveil Render). Placé ici, après les
  // helpers de schéma ci-dessus : les compteurs ont été créés plus haut, mais leur restauration attend que ces
  // vérifications existent (aucune requête n'est servie avant la fin de `creerServeur` de toute façon).
  await compteurs.restaurer()

  /** Cache des pages de menu prérendues (P2-Q4) : par commerce, 5 min (TTL) ; 64 entrées au plus. Déclaré ici (par
   *  serveur, pas au niveau du module) pour que les tests gardent des serveurs indépendants. */
  const cachePrerendu = new Map<string, { html: string; etag: string; statut: number; expire: number }>()

  /**
   * Mesure anonyme (P2-Q3) : +1 sur le compteur du jour. Jamais bloquant : migration absente, base en panne → l'événement
   * n'est pas compté, et la requête qui l'a déclenché (un tirage, par exemple) n'en est jamais affectée.
   */
  async function compter(commerceId: string, type: TypeEvenement): Promise<boolean> {
    try {
      if (!(await schemaMesure())) return false
      await st.compterEvenement(commerceId, jourParis(maintenant()), type)
      return true
    } catch (e) {
      console.warn(`[serveur] événement « ${type} » non compté : ${e instanceof Error ? e.message : e}`)
      return false
    }
  }

  // ---- Relances SMS / e-mail (P1-B3) ----

  /** Adresse publique du site (liens des SMS / e-mails, URL signée par Twilio) : PUBLIC_URL, sinon Host (+ X-Forwarded-Proto). */
  function sitePublic(req: IncomingMessage): string {
    if (o.urlPublique) return o.urlPublique.replace(/\/+$/, '')
    const proto = (o.derriereProxy && String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim()) || 'http'
    return `${proto}://${enTete(req, 'host') ?? 'localhost'}`
  }

  // Secret des liens de désinscription : tiré au hasard une fois, gardé dans `meta` (stable aux redémarrages, aucune
  // variable d'environnement à créer). Un lien = HMAC(commerce, client) : il ne sert qu'à retirer CE consentement.
  let secretDesinscription: Promise<string> | undefined
  function lireSecretDesinscription(): Promise<string> {
    secretDesinscription ??= (async () => {
      const lu = await st.meta('secret_desinscription')
      if (lu) return lu
      const s = randomBytes(32).toString('hex')
      await st.majMeta('secret_desinscription', s)
      return s
    })().catch((e) => {
      secretDesinscription = undefined
      throw e
    })
    return secretDesinscription
  }
  async function jetonDesinscription(commerceId: string, clientId: string): Promise<string> {
    return createHmac('sha256', await lireSecretDesinscription()).update(`desinscription:${commerceId}:${clientId}`).digest('base64url').slice(0, 32)
  }

  // ---- Google Business Profile (P1-B4) ----
  // Jetons OAuth rangés côté serveur uniquement : table `meta` (clé `google_business:<commerce>`, lisible par le seul
  // service_role, comme `secret_desinscription`), chiffrés en AES-256-GCM avec une clé dérivée du client secret.
  // Jamais renvoyés au navigateur. Le client secret ne vit que dans GOOGLE_CLIENT_SECRET.

  const fetchGoogle: typeof fetch = o.googleBusiness?.fetch ?? ((...a) => fetch(...a))
  /** Nonces des `state` émis et pas encore utilisés (une connexion = un aller-retour ; Render = une instance). */
  const etatsGoogle = new Map<string, number>()
  const cleMetaGoogle = (commerceId: string) => `google_business:${commerceId}`

  function exigerGoogle(): ConfigGoogleComplete {
    if (!googleBusinessConfigure(o.googleBusiness)) throw err(501, MESSAGE_NON_BRANCHE)
    return o.googleBusiness
  }
  const redirectionGoogle = (g: ConfigGoogleComplete, req: IncomingMessage, commerceId: string) =>
    g.redirectUri ?? `${sitePublic(req)}/api/v1/commerces/${encodeURIComponent(commerceId)}/google/callback`

  async function lireJetonsGoogle(g: ConfigGoogleComplete, commerceId: string) {
    return dechiffrerJetons(g.clientSecret, await st.meta(cleMetaGoogle(commerceId)))
  }
  async function ecrireJetonsGoogle(g: ConfigGoogleComplete, commerceId: string, j: JetonsGoogle | null) {
    // Pas de suppression dans `meta` : une valeur vide vaut « non connecté ».
    await st.majMeta(cleMetaGoogle(commerceId), j ? chiffrerJetons(g.clientSecret, j) : '')
  }

  /** Jetons valables (rafraîchis au besoin, puis réenregistrés). Refresh token refusé par Google : connexion effacée. */
  async function accesGoogle(g: ConfigGoogleComplete, commerceId: string): Promise<JetonsGoogle & { accessToken: string }> {
    const j = await lireJetonsGoogle(g, commerceId)
    if (!j) throw err(409, 'Google n’est pas connecté pour ce commerce : utilisez « Connecter Google » sur l’écran Avis.')
    try {
      const { jetons, rafraichi } = await jetonsFrais(g, fetchGoogle, j, maintenant())
      if (rafraichi) await ecrireJetonsGoogle(g, commerceId, jetons)
      return jetons as JetonsGoogle & { accessToken: string }
    } catch (e) {
      if (e instanceof ErreurGoogle && e.code === 'invalid_grant') await ecrireJetonsGoogle(g, commerceId, null)
      throw e
    }
  }

  /** Publie `a.reponse` sur Google et renvoie l'avis marqué « publié » (déjà enregistré). */
  async function publierSurGoogle(accessToken: string, a: Avis): Promise<Avis> {
    await publierReponseGoogle(fetchGoogle, accessToken, a.googleId!, a.reponse!)
    return st.transaction(async () => {
      const frais = await st.unAvis(a.commerceId, a.id)
      // Réponse modifiée entre-temps : la version publiée n'est plus celle en base, on ne la marque pas.
      if (!frais || frais.reponse !== a.reponse) return frais ?? a
      const publie: Avis = { ...frais, reponsePublieeLe: maintenant().toISOString() }
      await st.majAvis(publie)
      return publie
    })
  }

  interface Tentative {
    http: number
    message: string
    envoi: EnvoiRelance
  }

  const LIMITE_LIBRE_GAIN = 'sans migration, la base n’accepte qu’un message libre OU une relance de gain par client et par jour'
  const COLLISION_GAIN = `Relance « gain bientôt expiré » non envoyée : un message libre est déjà parti aujourd’hui vers ce client (${LIMITE_LIBRE_GAIN}). Nouvel essai à la prochaine tournée.`
  const COLLISION_LIBRE = `Message libre non envoyé : la relance « gain bientôt expiré » est déjà partie aujourd’hui vers ce client (${LIMITE_LIBRE_GAIN}). Réessayez demain.`
  /**
   * Le refus d'unicité vient-il de la colonne `modele` partagée (libre / gainExpire, Supabase) ? Oui si aucune ligne du
   * MÊME modèle n'occupe le créneau du jour mais qu'une ligne de l'autre modèle (même valeur de colonne) l'occupe.
   */
  async function collisionLibreGain(e: EnvoiRelance): Promise<boolean> {
    if (e.modele !== 'libre' && e.modele !== 'gainExpire') return false
    const occupe = (await st.envois(e.commerceId, 50, e.clientId)).filter((x) => x.jour === e.jour && (x.statut === 'en_cours' || x.statut === 'envoye'))
    return !occupe.some((x) => x.modele === e.modele) && occupe.some((x) => modeleColonneEnvoi(x.modele) === modeleColonneEnvoi(e.modele))
  }

  /**
   * Une tentative de relance, tracée dans `envois` quel qu'en soit le résultat :
   * 501 sans prestataire pour ce canal · 409 sans consentement, sans contact, ou déjà envoyée aujourd'hui (même modèle)
   * · 503 migration 0007 absente (rien ne part sans anti-doublon) · 502 refus 4xx du prestataire (`erreur`) ou issue
   * ambiguë après l'émission — délai, réseau, 5xx… (`incertain` : peut-être envoyé) · 200 envoyée.
   * L'envoi est RÉSERVÉ en base (`en_cours`) avant l'appel au prestataire : l'index unique empêche tout doublon.
   */
  async function relancer(
    commerce: Commerce,
    client: Client,
    demande: { modele: ModeleRelance | 'libre'; canal?: Canal; libre?: string; declencheur: EnvoiRelance['declencheur']; auteur: string } | { modele: 'gainExpire'; tirage: Tirage; declencheur: 'auto'; auteur: string; canal?: undefined },
    site: string,
  ): Promise<Tentative> {
    const t = maintenant()
    const canal: Canal = demande.canal ?? canalDuClient(client) ?? 'sms'
    const envoi: EnvoiRelance = {
      id: `en-${randomUUID()}`,
      commerceId: commerce.id,
      clientId: client.id,
      clientPrenom: client.prenom,
      date: t.toISOString(),
      jour: jourParis(t),
      modele: demande.modele,
      ...(demande.modele === 'gainExpire' ? { tirageId: demande.tirage.id } : {}),
      canal,
      statut: 'en_cours',
      declencheur: demande.declencheur,
      auteur: demande.auteur,
    }
    async function consigner(statut: StatutEnvoi, http: number, message: string, motif?: EnvoiRelance['motif']): Promise<Tentative> {
      const e: EnvoiRelance = { ...envoi, statut, raison: message, ...(motif ? { motif } : {}) }
      try {
        await st.ajouterEnvoi(e)
      } catch (err) {
        // Migration 0007 pas appliquée : le refus est répondu quand même, seule la trace manque.
        if (!(err instanceof ErreurMigrationManquante)) throw err
        console.warn(`[relances] tentative non tracée (${statut}) : ${err.message}`)
      }
      return { http, message, envoi: e }
    }

    if (!notifications.statut()[canal]) return consigner('non_branche', 501, new ErreurNonBranche(canal).message)
    if (client.consentementRelance !== true) return consigner('refuse', 409, 'Ce client n’a pas donné son consentement aux relances : rien n’a été envoyé.')
    // SMS : format international (06… → +336…, autres numéros : chiffres précédés de +).
    const cle = client.telephone ? cleContact({ telephone: client.telephone }) : ''
    const destinataire = canal === 'sms' ? cle && (/^0\d{9}$/.test(cle) ? `+33${cle.slice(1)}` : `+${cle}`) : client.email
    if (!destinataire) return consigner('refuse', 409, `Ce client n’a pas ${canal === 'sms' ? 'de téléphone' : 'd’e-mail'} : rien n’a été envoyé.`)
    if (!(await schemaRelances())) throw new ErreurMigrationManquante('envois', '0007_relances.sql')
    try {
      await st.ajouterEnvoi(envoi)
    } catch (e) {
      if (e instanceof ErreurConflit) {
        if (await collisionLibreGain(envoi)) {
          // Revue Codex F5 — limite sans migration (Supabase) : `gainExpire` est rangé sous `libre` dans la colonne
          // `envois.modele` (CHECK de 0007), l'index unique (commerce, client, modèle, jour) refuse donc le 2e des deux
          // le même jour. Refus tracé à part (motif + raison explicites), jamais confondu avec un vrai doublon ; une
          // relance de gain ainsi refusée est retentée à la tournée suivante (son marqueur est libéré).
          console.warn(`[relances] ${envoi.modele} refusé : message libre / relance de gain déjà parti aujourd'hui (colonne « modele » partagée, sans migration)`)
          return consigner('refuse', 409, envoi.modele === 'gainExpire' ? COLLISION_GAIN : COLLISION_LIBRE, 'collision_libre_gain')
        }
        return consigner('refuse', 409, 'Cette relance a déjà été envoyée à ce client aujourd’hui : rien n’a été renvoyé.')
      }
      throw e
    }

    const d = { client, commerce }
    let message: Message
    try {
      // Le jeton de désinscription sert aux deux canaux : e-mail (lien long + List-Unsubscribe) et SMS (lien court
      // /d/… — P1-B9 : « répondez STOP » est impossible avec l'expéditeur alphanumérique Brevo).
      const jeton = await jetonDesinscription(commerce.id, client.id)
      if (canal === 'sms') {
        const carte = lienCourtCarte(site, client.id)
        const stop = lienCourtDesinscription(site, client.id, jeton)
        const texte = demande.modele === 'gainExpire' ? smsGainExpire({ ...d, tirage: demande.tirage }, carte, stop) : smsRelance(demande.modele, d, carte, demande.libre, stop)
        message = { destinataire, texte }
      } else {
        const liens = { carte: lienCarte(site, client.id), desinscription: `${site}/#/desinscription/${client.id}/${jeton}` }
        const e = demande.modele === 'gainExpire' ? emailGainExpire({ ...d, tirage: demande.tirage }, liens) : emailRelance(demande.modele, d, liens, demande.libre)
        message = {
          destinataire,
          sujet: e.sujet,
          texte: e.texte,
          entetes: { 'List-Unsubscribe': `<${site}/api/v1/desinscription/${client.id}/${jeton}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        }
      }
    } catch (e) {
      // Panne AVANT l'appel au prestataire : rien n'est parti, la ligne réservée passe en « erreur » (best effort) au
      // lieu de rester « en_cours » — sinon elle bloquerait la reprise de la tournée automatique (point Codex 9).
      try {
        await st.majEnvoi({ ...envoi, statut: 'erreur', raison: 'Relance non préparée : rien n’a été envoyé.' })
      } catch {
        // La ligne reste « en_cours » : prudent (pas de reprise pour ce client aujourd'hui), jamais de doublon.
      }
      throw e
    }
    let fin: Tentative
    try {
      const r = await notifications.envoyer(canal, message)
      // Mode test (`BREVO_MODE_TEST=1`) : rien n'a été livré (e-mail en sandbox Brevo, SMS simulé) — statut `test`
      // explicite dans le journal, jamais `envoye`. La simulation n'occupe PAS le créneau anti-doublon du jour
      // (index partiel sur `en_cours` / `envoye` seulement) : un vrai envoi reste possible le même jour, une fois
      // le mode test coupé ; `relanceAutoDue` ne compte pas non plus les `test` comme des envois.
      fin = r.test
        ? { http: 200, message: 'Mode test : rien envoyé (simulation tracée dans le journal).', envoi: { ...envoi, statut: 'test', raison: 'Mode test Brevo : simulation, rien envoyé.', idPrestataire: 'test' } }
        : { http: 200, message: 'Relance envoyée.', envoi: { ...envoi, statut: 'envoye', ...(r.id ? { idPrestataire: r.id } : {}) } }
    } catch (e) {
      if (echecConfirme(e)) {
        // Refus CONFIRMÉ (réponse 4xx du prestataire, ou rien de branché) : rien n'est parti, `erreur` ne compte pas.
        const raison = e instanceof Error && e.message ? e.message : 'Le prestataire a refusé l’envoi.'
        fin = { http: 502, message: `Relance non envoyée : ${raison}`, envoi: { ...envoi, statut: 'erreur', raison } }
      } else {
        // Point Codex 10, étendu par la revue Codex 2 R7 (F2) — la requête est partie et l'issue n'est ni un succès ni
        // un refus confirmés : délai dépassé / appel abandonné, coupure réseau (TypeError), 5xx, corps illisible après
        // une réponse positive… Le prestataire a pu accepter le message. Statut `incertain` : `relanceAutoDue` le compte
        // comme un envoi (aucun renvoi automatique, ni le même jour ni pour la même absence) et la relance d'un gain
        // garde son marqueur. Le commerçant garde la main : l'index unique anti-doublon ne couvre que `en_cours` /
        // `envoye`, donc une relance MANUELLE reste possible (après vérification auprès du client), elle n'est jamais
        // bloquée par une ligne `incertain`.
        const raison = estAbandon(e)
          ? 'Le prestataire n’a pas répondu à temps : état de l’envoi inconnu (le message est peut-être parti). Il ne sera pas renvoyé automatiquement.'
          : `Réponse du prestataire incomplète ou en erreur (${e instanceof Error && e.message ? e.message : 'erreur inconnue'}) : état de l’envoi inconnu (le message est peut-être parti). Il ne sera pas renvoyé automatiquement.`
        fin = { http: 502, message: `Relance incertaine : ${raison}`, envoi: { ...envoi, statut: 'incertain', raison } }
      }
    }
    try {
      await st.majEnvoi(fin.envoi)
    } catch (e) {
      // La ligne reste « en_cours » : elle bloque toujours un doublon le même jour, rien n'est perdu côté client.
      console.warn(`[relances] statut final non écrit (${fin.envoi.statut}) : ${e instanceof Error ? e.message : e}`)
    }
    return fin
  }

  // Relances automatiques (réglage `relancesAuto` du commerce) : une tournée par commerce et par jour, lancée à
  // l'ouverture du tableau de bord (GET /etat), en arrière-plan. Pas à l'ouverture de la carte par le client : il est
  // justement là (« vous nous manquez » n'aurait aucun sens), et l'anniversaire y est déjà fêté dans sa boîte de réception.
  //
  // Point Codex 9 : `tournees` (commerce → jour) ne veut dire que « tournée MENÉE À BIEN ce jour-là » ; il n'est écrit
  // qu'en fin de boucle sans exception. Une tournée interrompue (lecture des clients, écriture d'un envoi…) ou sans
  // rien de branché / sans migration 0007 ne marque pas le jour : la prochaine ouverture du tableau de bord la relance.
  // L'anti-concurrence est `tourneesActives` (une seule tournée à la fois par commerce), pas la marque du jour.
  // Une reprise ne renvoie jamais un message déjà parti : pour chaque client, `relanceAutoDue` relit ses envois en base
  // et ignore le modèle s'il y a déjà une ligne `envoye` ou `en_cours` (même absence / même année), et l'index unique
  // partiel (commerce, client, modèle, jour) sur ces deux statuts refuse en dernier recours une 2e réservation le même
  // jour (ErreurConflit → « refuse », sans appel au prestataire). C'est déjà ce qui protégeait d'un redémarrage du
  // serveur (cette Map est en mémoire). Les échecs du prestataire (statut `erreur`) ne sont pas une panne de tournée :
  // on ne les retente pas dans la même tournée, ni à la reprise d'une tournée interrompue le même jour (`echecAutoDuJour`,
  // revue Codex finale ; le renvoi manuel reste possible). Un délai dépassé (statut `incertain`, point Codex 10 : chaque appel est
  // borné par DELAI_PRESTATAIRE_MS) compte comme un envoi pour `relanceAutoDue` : jamais de renvoi automatique.
  //
  // R7 — « gain bientôt expiré » (`gainExpire`, ACTIVÉ si absent) : lot physique de la roue non retiré qui expire dans
  // moins de 72 h (src/lib/relanceGain.ts). Une seule relance par tirage : le journal des envois porte `tirageId`, et
  // une ligne `envoye` / `en_cours` / `incertain` / `test` pour ce tirage suffit à ne plus rien envoyer. Toujours une
  // seule relance automatique par client et par tournée, dans l'ordre anniversaire (le jour J seulement), gain (la
  // tournée suivante a encore le temps : fenêtre de 72 h), inactif. La marque du jour porte les règles actives : une
  // règle activée en cours de journée a sa tournée le jour même (les anti-doublons ci-dessus restent les garde-fous).
  //
  // Revue Codex R7 — « une seule relance par gain » ne dépend plus d'une fenêtre de lecture ni de la sérialisation des
  // tournées (en mémoire, par processus) :
  // • F1 : avant l'envoi, les envois de CE tirage sont relus par `tirageId`, sans limite (`envoisDuTirage`) — les
  //   50 derniers envois du client ne servent plus qu'à présélectionner ;
  // • F2 : le tirage est RÉCLAMÉ par une écriture conditionnelle (`relanceGainLe` posé seulement s'il est absent en base,
  //   tirage non remis) : de deux tournées simultanées — deux instances, ou à cheval sur minuit (l'index unique des envois
  //   est par jour) — une seule passe ;
  // • 2e revue F1 : TOUTE écriture d'un tirage (activation, remise, réclamation, libération) applique son patch sur la
  //   ligne fraîche par comparaison-échange (`modifierTirage` / `Stockage.majTirageSi` : `activeLe` et `relanceGainLe`
  //   inchangés en base depuis la lecture, sinon relecture et nouvel essai) — une activation partie d'une lecture
  //   ancienne ne peut plus effacer le marqueur, et une réclamation ni une activation ni une remise ;
  // • F3 : la réclamation relit le tirage et revérifie, à l'heure de l'écriture, qu'il est toujours à relancer
  //   (`gainBientotExpire` : non remis, pas expiré aux bornes parisiennes, dans les 72 h). Sinon : ni marqueur ni envoi —
  //   un gain remis ou expiré ne redevient jamais éligible, rien à figer. 2e revue F4 : revérifié encore APRÈS la
  //   réclamation réussie, avant l'appel au prestataire (une écriture lente a pu passer minuit à Paris) : devenu expiré →
  //   marqueur libéré, rien envoyé ;
  // • échec APRÈS réclamation sans rien de parti (`erreur` = refus 4xx confirmé, `refuse` — dont la collision F5 —,
  //   `non_branche`, exception avant l'appel) : le marqueur est retiré et la tournée suivante retente, comme le prévoyait
  //   R7 (un refus ou une erreur ne comptent pas). 2e revue F3 : la libération ne dépend que du marqueur (NOTRE
  //   horodatage encore en base) — une activation concurrente ne la bloque plus. `envoye`, `test` et `incertain`
  //   (2e revue F2 : toute issue ambiguë après l'émission, peut-être partie) le gardent : jamais de renvoi automatique.
  async function reclamerRelanceGain(choisi: Tirage): Promise<Tirage | undefined> {
    if (relanceGainFaite(choisi.id, await st.envoisDuTirage(choisi.commerceId, choisi.clientId, choisi.id))) return undefined
    const relu = await st.tirage(choisi.commerceId, choisi.id)
    if (!relu) return undefined
    const quand = maintenant()
    const reclame = await modifierTirage(relu, (frais) => (frais.relanceGainLe || !gainBientotExpire(frais, quand) ? undefined : { ...frais, relanceGainLe: quand.toISOString() }))
    if (!reclame) return undefined
    if (!gainBientotExpire(reclame, maintenant())) {
      await libererRelanceGain(reclame)
      return undefined
    }
    return reclame
  }
  /** Retire le marqueur posé par CETTE réclamation (et lui seul) ; best effort : sinon il reste, jamais de doublon. */
  async function libererRelanceGain(reclame: Tirage) {
    const notre = reclame.relanceGainLe
    try {
      await modifierTirage(reclame, (frais) => {
        if (frais.relanceGainLe !== notre) return undefined
        const { relanceGainLe: _, ...libere } = frais
        return libere
      })
    } catch (e) {
      console.warn(`[relances] marqueur de relance du gain non retiré (pas de nouvel essai) : ${e instanceof Error ? e.message : e}`)
    }
  }
  async function relancerGain(commerce: Commerce, client: Client, reclame: Tirage, site: string) {
    let parti = true
    try {
      const r = await relancer(commerce, client, { modele: 'gainExpire', tirage: reclame, declencheur: 'auto', auteur: 'Automatique' }, site)
      parti = r.envoi.statut === 'envoye' || r.envoi.statut === 'test' || r.envoi.statut === 'incertain'
    } catch (e) {
      parti = false
      throw e
    } finally {
      if (!parti) await libererRelanceGain(reclame)
    }
  }
  /**
   * Écriture d'un tirage appliquée sur la ligne FRAÎCHE (revue Codex 2 R7, F1) : `patch(frais)` → nouvelle version (ou
   * undefined : plus rien à écrire ; peut lever un refus HTTP), écrite par comparaison-échange (`st.majTirageSi`). Si
   * une autre écriture est passée depuis la lecture (activation, marqueur de relance…), on relit et on réapplique le
   * patch — jamais un instantané ancien réécrit par-dessus. `lu` : lecture déjà faite par l'appelant (1er essai sans
   * relecture). Undefined : tirage remis ou disparu en base, condition `activeApres` refusée par la base (ligne
   * inchangée), ou trop d'écritures concurrentes.
   */
  async function modifierTirage(lu: Tirage, patch: (frais: Tirage) => Tirage | undefined, activeApres?: (frais: Tirage) => string | undefined): Promise<Tirage | undefined> {
    let frais: Tirage | undefined = lu
    for (let essai = 0; essai < 5 && frais; essai++) {
      const apres = patch(frais)
      if (!apres || frais.remis) return undefined
      if (await st.majTirageSi(apres, frais, activeApres?.(frais))) return apres
      const avant: Tirage = frais
      frais = await st.tirage(lu.commerceId, lu.id)
      if (frais && !frais.remis && frais.activeLe === avant.activeLe && frais.relanceGainLe === avant.relanceGainLe) return undefined
    }
    return undefined
  }
  const tournees = new Map<string, string>()
  const tourneesActives = new Set<string>()
  const tourneesEnCours = new Set<Promise<void>>()
  function lancerRelancesAuto(commerce: Commerce, site: string) {
    const regles = { inactif: false, anniversaire: false, ...commerce.relancesAuto }
    const gainExpire = regles.gainExpire !== false
    if (!regles.inactif && !regles.anniversaire && !gainExpire) return
    const t = maintenant()
    const marque = `${jourParis(t)}|${regles.inactif}|${regles.anniversaire}|${gainExpire}`
    if (tournees.get(commerce.id) === marque || tourneesActives.has(commerce.id)) return
    tourneesActives.add(commerce.id)
    const p = (async () => {
      const branche = notifications.statut()
      // Rien de branché, ou migration 0007 absente : pas de tournée (et pas de 501 en série dans le journal). Le jour
      // n'est pas marqué : si tout est branché plus tard dans la journée, la tournée part. Ce test ne coûte presque
      // rien à chaque ouverture (statut en mémoire, `schemaRelances` mis en cache 60 s).
      if ((!branche.sms && !branche.email) || !(await schemaRelances())) return
      // R7 : gains qui expirent dans moins de 72 h, par client (tirages des 32 derniers jours seulement).
      const gains = new Map<string, Tirage[]>()
      if (gainExpire) {
        for (const x of await st.tiragesDepuis(commerce.id, new Date(t.getTime() - (DUREE_GAIN_JOURS + 2) * 86_400_000).toISOString())) {
          if (gainBientotExpire(x, t)) gains.set(x.clientId, [...(gains.get(x.clientId) ?? []), x])
        }
      }
      // Gain seul activé : on ne lit que les clients concernés, pas tout le fichier.
      const clients =
        regles.inactif || regles.anniversaire
          ? await st.clients(commerce.id)
          : (await Promise.all([...gains.keys()].map((id) => st.client(commerce.id, id)))).filter((c): c is Client => !!c)
      for (const client of clients) {
        const canal = canalDuClient(client)
        if (client.consentementRelance !== true || !canal || !branche[canal]) continue
        if (!regles.inactif && !regles.anniversaire && !gains.has(client.id)) continue
        const deja = await st.envois(commerce.id, 50, client.id)
        const gain = gainsARelancer(gains.get(client.id) ?? [], deja, t)[0]
        // Une seule relance automatique par client et par tournée : l'anniversaire passe avant, puis le gain.
        for (const modele of ['anniversaire', 'gainExpire', 'inactif'] as const) {
          if (!(modele === 'gainExpire' ? !!gain : regles[modele] && relanceAutoDue(modele, client, deja, t))) continue
          // Revue Codex finale, point 5 : le modèle retenu a déjà échoué chez le prestataire aujourd'hui (tentative de la
          // tournée interrompue) → client déjà traité, rien de plus (ni ce modèle ni un autre en repli). Filtre posé ici,
          // à côté de la règle « une relance par client et par tournée » qu'il prolonge, et pas dans `relanceAutoDue`.
          if (echecAutoDuJour(modele, deja, t)) break
          if (modele !== 'gainExpire') {
            await relancer(commerce, client, { modele, declencheur: 'auto', auteur: 'Automatique' }, site)
            break
          }
          // Réclamation refusée (déjà relancé, remis, expiré entre-temps…) : la règle suivante (inactif) peut partir.
          const reclame = await reclamerRelanceGain(gain!)
          if (!reclame) continue
          await relancerGain(commerce, client, reclame, site)
          break
        }
      }
      tournees.set(commerce.id, marque)
    })()
      .catch((e) => console.warn(`[relances] tournée automatique interrompue (reprise à la prochaine ouverture) : ${e instanceof Error ? e.message : e}`))
      .finally(() => {
        tourneesActives.delete(commerce.id)
        tourneesEnCours.delete(p)
      })
    tourneesEnCours.add(p)
  }

  // ---- « Carte introuvable » → retrouver sa carte par téléphone / e-mail (P1-C3, audit F-12) ----
  // Réponse identique que le contact ait une carte ou non, et rendue AVANT la recherche (envoi en arrière-plan) : ni le
  // contenu ni le temps de réponse ne disent si quelqu'un est client. Sans prestataire configuré pour le canal, rien
  // n'est cherché ni envoyé. Au plus RECHERCHE_CARTE_MAX_JOUR envois par contact et par 24 h (pas de bombardement).
  const RECHERCHE_CARTE_MAX_JOUR = 3
  const recherchesCarte = new Map<string, number[]>()
  function envoyerLiensCarte(contact: { telephone?: string; email?: string }, canal: Canal, site: string) {
    const cle = cleContact(contact)
    const t = maintenant().getTime()
    const recentes = (recherchesCarte.get(cle) ?? []).filter((d) => t - d < 24 * 3600_000 && d <= t)
    if (recentes.length >= RECHERCHE_CARTE_MAX_JOUR) return
    if (recherchesCarte.size > 5000) for (const [k, v] of recherchesCarte) if (v.every((d) => t - d >= 24 * 3600_000)) recherchesCarte.delete(k)
    recherchesCarte.set(cle, [...recentes, t])
    const p = (async () => {
      for (const c of await st.commerces()) {
        if (!c.actif) continue
        const client = await st.clientParContact(c.id, contact)
        if (!client) continue
        const destinataire = canal === 'sms' ? (/^0\d{9}$/.test(cle) ? `+33${cle.slice(1)}` : `+${cle}`) : cle
        // P0-S7 : avec SESSION_SECRET, le lien porte un lien d'accès à usage unique (24 h) — seul le titulaire du
        // contact le reçoit ; ouvert, il donne le jeton client à ce téléphone. Sans secret : lien de la carte seul.
        const acces = o.secretSession ? (await lienAcces(c.id, client.id, DUREE_LIEN_RECUPERATION_S)).jeton : ''
        const message: Message =
          canal === 'sms'
            ? { destinataire, texte: `${c.nom} : votre carte de fidélité ${lienCourtCarte(site, client.id)}${acces ? `?a=${acces}` : ''}` }
            : {
                destinataire,
                sujet: `Votre carte de fidélité ${c.nom}`,
                texte: `Bonjour,\n\nVoici le lien de votre carte de fidélité ${c.nom} :\n${lienCarte(site, client.id)}${acces ? `?acces=${acces}\n\nCe lien ouvre votre carte complète sur votre téléphone (valable 24 h, une seule fois).` : ''}\n\nVous n’avez rien demandé ? Ignorez ce message.\n\nL’équipe de ${c.nom}`,
              }
        await notifications.envoyer(canal, message)
      }
    })()
      .catch((e) => console.warn(`[carte] lien de carte non envoyé : ${e instanceof Error ? e.message : e}`))
      .finally(() => tourneesEnCours.delete(p))
    tourneesEnCours.add(p)
  }

  /** Messages automatiques dus pour cet événement (règles du commerce). */
  const avecMessages = (client: Client, commerce: Commerce, evenement: Evenement, t = maintenant()) =>
    genererMessages(client, commerce, evenement, t, nouvelIdMessage).client

  /**
   * Heure réelle d'une action de caisse (`faitLe` envoyé par la tablette, file hors ligne comprise).
   * - absente (pas une chaîne) : maintenant — cas normal des appels sans date ;
   * - datée de 72 h au plus dans le passé et 5 min au plus dans le futur : conservée telle quelle ;
   * - illisible, trop ancienne ou dans le futur : refus 400 explicite (correction Codex, point 6). Avant, la date
   *   était remplacée en silence par maintenant : l'action pouvait être comptée le mauvais jour, ou refusée à
   *   cause d'une visite du jour, sans explication. Le refus 400 est un « refus définitif » affiché dans la file.
   */
  function quandAction(v: unknown): Date {
    const t = maintenant()
    if (typeof v !== 'string') return t
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) {
      throw err(400, 'Date de l’action illisible : elle n’a pas été enregistrée. Refaites le passage depuis la fiche du client.')
    }
    const ecart = t.getTime() - d.getTime()
    if (ecart > 72 * 3600_000) {
      throw err(400, 'Action trop ancienne (plus de 3 jours) pour être synchronisée telle quelle : elle n’a pas été enregistrée. Régularisez-la à la main, par exemple en refaisant le passage depuis la fiche du client.')
    }
    if (ecart < -5 * 60_000) {
      throw err(400, 'Action datée dans le futur (vérifiez l’heure de la tablette) : elle n’a pas été enregistrée. Régularisez-la à la main, par exemple en refaisant le passage depuis la fiche du client.')
    }
    return d
  }

  function idAction(v: unknown): string | undefined {
    if (v == null) return undefined
    if (typeof v !== 'string' || !/^[\w-]{8,80}$/.test(v)) throw err(400, '« actionId » invalide.')
    return v
  }

  async function verifierCodeLibre(commerceId: string, code: string, sauf?: string) {
    const autres = (await st.membres(commerceId)).filter((m) => m.membre.id !== sauf)
    if ((await Promise.all(autres.map((m) => pinCorrect(code, m.code)))).some((r) => r.ok)) {
      throw err(409, 'Ce code est déjà utilisé par un autre membre de l’équipe : choisissez-en un autre.')
    }
  }

  async function commerceOu404(id: string): Promise<Commerce> {
    const c = await st.commerce(id)
    if (!c) throw err(404, 'Commerce inconnu.')
    return c
  }

  /**
   * Lots physiques plafonnés aujourd'hui (R2). Les tirages du jour ne sont lus que si un lot a un plafond : une config
   * sans plafond (toutes celles d'avant R2) ne coûte aucune lecture de plus aux routes publiques. Journée : à Paris,
   * comme l'index unique quotidien des tirages (revue Codex R2 point 3).
   */
  async function plafonnesDuJour(c: Commerce, t = maintenant()): Promise<Set<string>> {
    const lots = normaliserLots(c.lots ?? [])
    if (!lots.some((l) => l.type === 'lot' && (l.plafondJour ?? 0) > 0)) return new Set()
    return lotsPlafonnes(lots, await st.tiragesDepuis(c.id, debutDuJourParis(t)), t)
  }

  /**
   * Instants gagnants du jour (D1), à Paris : lus dans `meta` ; absents et au moins un lot à instants → générés ICI, à
   * la 1re utilisation du jour (pas de cron garanti sur Render Free), avec le hasard crypto, puis persistés par une
   * insertion conditionnelle — deux générations simultanées : la 1re écrite fait foi, l'autre relit. Une fois écrits,
   * ils ne changent plus de la journée (un réglage modifié s'applique au lendemain). `generer: false` (tableau de bord)
   * : lecture seule. Le brut est rendu tel que lu : il sert de valeur attendue pour la consommation (`majMetaSi`).
   */
  async function instantsDuJour(c: Commerce, t: Date, generer = true): Promise<{ cle: string; brut: string; doc: InstantsDuJour } | null> {
    const jour = jourParis(t)
    const cle = cleInstants(c.id, jour)
    let brut = await st.meta(cle)
    if (brut === undefined) {
      const lots = lotsAInstants(normaliserLots(c.lots ?? []))
      if (!generer || !lots.length) return null
      const neuf = JSON.stringify(genererInstants(lots, plagesOuverture(c), jour, (n) => randomInt(n)))
      brut = (await st.majMetaSi(cle, undefined, neuf)) ? neuf : await st.meta(cle)
      if (brut === undefined) return null
    }
    return { cle, brut, doc: JSON.parse(brut) as InstantsDuJour }
  }

  /** Fiche publique (R2) : sans les lots plafonnés du jour — ils disparaissent de la roue et de « À gagner aujourd'hui ». */
  async function fichePublique(c: Commerce): Promise<CommercePublic> {
    return commercePublic(c, await plafonnesDuJour(c))
  }

  /**
   * Revue Codex R2 point 2 — crédit d'une consolation en points échoué APRÈS l'insertion du tirage. Sous Supabase,
   * `transaction` n'annule rien : le tirage resterait sans points et l'index unique (client + jour) refuserait le rejeu.
   * Compensation : le tirage est supprimé, le client peut retenter et sera crédité exactement une fois. 500 (pas
   * 502–504, que le front affiche « hors ligne ») avec un message lisible. SQLite : la transaction est de toute façon
   * annulée. Si la suppression échoue aussi : incohérence journalisée explicitement (ligne JSON, client en empreinte).
   */
  async function annulerTirageNonCredite(tirage: Tirage, cause: unknown): Promise<never> {
    const raison = cause instanceof Error ? cause.message : String(cause)
    try {
      await st.supprimerTirage(tirage.commerceId, tirage.id)
    } catch (e) {
      console.error(JSON.stringify({
        type: 'incoherence', niveau: 'erreur', horodatage: new Date().toISOString(), evenement: 'tirage-points-non-credites',
        commerce: tirage.commerceId, tirage: tirage.id, client: empreinte(tirage.clientId), points: tirage.points,
        causeCredit: raison, causeSuppression: e instanceof Error ? e.message : String(e),
      }))
      throw err(500, 'Votre tirage est enregistré mais vos points n’ont pas pu être crédités : montrez cet écran au comptoir.')
    }
    console.warn(`[tirage] crédit des points échoué, tirage annulé (le client peut rejouer) : ${raison}`)
    throw err(500, 'Vos points n’ont pas pu être crédités : votre tirage est annulé, vous pouvez retenter dès maintenant.')
  }

  /**
   * Revue Codex R2 point 4 — tirages d'avant R1 (sans `lotId`) rattachés au lot de la nouvelle configuration dont le
   * libellé est le leur, sans ambiguïté (`rattachementsTirages`) : sinon un renommage casserait le comptage des plafonds
   * (rapprochement par le libellé courant). Écriture conditionnelle (`lotId` toujours absent, remise inchangée) : une
   * remise simultanée n'est jamais écrasée.
   */
  async function rattraperLotsTirages(c: Commerce): Promise<void> {
    for (const t of rattachementsTirages(c.lots ?? [], await st.tiragesSansLot(c.id))) await st.completerLotTirage(t)
  }

  async function clientOu404(commerceId: string, id: string): Promise<Client> {
    const c = await st.client(commerceId, id)
    if (!c) throw err(404, 'Client inconnu dans ce commerce.')
    return c
  }

  /** Carte d'un jeton client valable, supprimée depuis : même refus qu'un jeton invalide (P0-S7). */
  async function clientOu401(commerceId: string, id: string): Promise<Client> {
    const c = await st.client(commerceId, id)
    if (!c) throw err(401, REFUS_CARTE)
    return c
  }

  function exigerActif(c: Commerce) {
    if (!c.actif) throw err(409, 'Ce commerce n’est pas actif pour le moment.')
  }

  /**
   * Récompense de parrainage après la 1re visite du filleul (jamais à l'inscription).
   * À appeler dans la transaction du passage : calcule le filleul avec ses points de parrainage et le texte à ajouter
   * au journal du passage. Rien n'est écrit ici : `ecrire()` (parrain, journal, trace d'audit 0004) s'appelle APRÈS
   * l'écriture du filleul (P0-S11) — si le filleul est en conflit (409), le parrain n'est pas crédité, et un nouvel
   * essai ne peut pas le créditer deux fois.
   */
  async function reglerParrainage(commerce: Commerce, filleulApres: Client, quand: Date): Promise<{ filleul: Client; texte: string; ecrire: () => Promise<string> }> {
    const rien = { filleul: filleulApres, texte: '', ecrire: async () => '' }
    if (!filleulApres.parrainId) return rien
    const parrain = await st.client(commerce.id, filleulApres.parrainId)
    if (!parrain) return rien
    if (filleulApres.parrainagePaye) return reprendreParrainage(commerce, filleulApres, parrain, quand)
    const r = parrainageDu(filleulApres, parrain, commerce, quand)
    if (!r) return rien
    const pointsFilleul = soldePoints(r.filleul) - soldePoints(filleulApres)
    const pointsParrain = r.parrain ? soldePoints(r.parrain) - soldePoints(parrain) : 0
    const texte = r.parrain
      ? `Parrainage : +${pointsFilleul} points pour ${filleulApres.prenom} (filleul) et +${pointsParrain} points pour ${parrain.prenom} (parrain)`
      : `Parrainage : +${pointsFilleul} points pour ${filleulApres.prenom} (filleul) — parrain au plafond annuel, rien pour ${parrain.prenom}`
    const ecrire = async (): Promise<string> => {
      let parrainCredite = r.parrain
      let points = pointsParrain
      let texteJournal = texte
      if (parrainCredite) {
        try {
          await st.majClient(parrainCredite)
        } catch (e) {
          // Le filleul est déjà marqué payé : sans reprise, le crédit du parrain serait perdu pour de bon (un nouvel essai
          // ne règle plus rien). Parrain modifié entre-temps (2 filleuls du même parrain en même temps, ou une caisse) :
          // relu frais (st.client mémorise sa nouvelle version), recalculé, réécrit UNE fois. Un 2e conflit remonte.
          if (!(e instanceof ErreurConflit)) throw e
          const frais = await st.client(commerce.id, parrain.id)
          // Point Codex 2 : une reprise concurrente (rejeu de caisse) a pu créditer ce filleul entre-temps — son marqueur
          // le dit, ne rien recréditer ni retracer.
          if (frais && filleulRegle(frais, filleulApres.id)) return ''
          // Plafond revérifié sur le parrain frais (deux filleuls simultanés ne le dépassent pas). Si ce recalcul passe
          // « au plafond », la décision persistée du filleul dit encore « crédit » : c'est la trace à 0 point écrite
          // juste après qui clôt le dossier. Seule une panne sur CETTE trace ferait exécuter la décision à la reprise
          // (un parrainage au-delà du plafond, jamais un crédit perdu) — risque assumé (revue Codex finale).
          const r2 = frais ? parrainageDu(filleulApres, frais, commerce, quand) : null
          if (!frais || !r2) throw e
          parrainCredite = r2.parrain
          points = r2.parrain ? soldePoints(r2.parrain) - soldePoints(frais) : 0
          texteJournal = r2.parrain
            ? `Parrainage : +${pointsFilleul} points pour ${filleulApres.prenom} (filleul) et +${points} points pour ${frais.prenom} (parrain)`
            : `Parrainage : +${pointsFilleul} points pour ${filleulApres.prenom} (filleul) — parrain au plafond annuel, rien pour ${frais.prenom}`
          if (parrainCredite) await st.majClient(parrainCredite)
        }
        if (parrainCredite) await journaliser(commerce.id, { type: 'gerant', nom: 'Gérant' }, 'parrainage', texteJournal, parrainCredite, quand)
      }
      const trace: Parrainage = {
        id: `pr-${randomUUID()}`,
        commerceId: commerce.id,
        parrainId: parrain.id,
        filleulId: filleulApres.id,
        date: quand.toISOString(),
        pointsParrain: points,
        pointsFilleul,
      }
      await st.ajouterParrainage(trace)
      // Texte FINAL du journal du passage (revue Codex P0-S11, point 5) : la reprise peut recalculer le crédit
      // (plafond atteint entre-temps) — le journal doit dire ce qui a vraiment été crédité, pas le calcul initial.
      return texteJournal
    }
    return { filleul: r.filleul, texte, ecrire }
  }

  /**
   * Reprise d'un règlement de parrainage interrompu (point Codex 2). Sous Supabase, pas de transaction multi-requêtes :
   * le filleul est écrit payé (`parrainagePaye`, ses points) PUIS le parrain, PUIS la trace `parrainages`. Une panne
   * (non-conflit) sur le parrain laissait le filleul payé et le parrain sans rien, pour toujours. Ici, un filleul déjà
   * payé dont le règlement n'est pas terminé est repris : on crédite le parrain seul (le filleul n'est pas retouché).
   *
   * « Terminé » se lit dans les données existantes, sans migration, avec des signes qui ne peuvent pas mentir :
   * 1. le marqueur `filleulsRegles` du parrain contient le filleul — écrit dans la même ligne que ses points, donc
   *    atomique : présent = crédit versé (dossiers d'après ce correctif) ;
   * 2. la trace `parrainages` du filleul existe — écrite en DERNIER dans le chemin normal : présente = règlement allé
   *    jusqu'au bout, y compris pour les dossiers d'avant le marqueur et pour un parrain au plafond (trace à 0 point) ;
   * 3. garde-fou pour les très anciens dossiers : avant P0-S11 la trace était ignorée si la migration 0004 manquait.
   *    Un parrain crédité alors porte dans `parrainagesGagnes` la date exacte du passage du filleul (même `quand`) :
   *    si une date de visite du filleul y figure, le crédit a été versé — ne pas recréditer.
   * Reprise seulement si AUCUN signe n'est présent. Plafond recalculé sur l'état frais du parrain : au plafond, la trace
   * est écrite à 0 point pour clore le dossier.
   *
   * Revue Codex finale : ce qui précède ne vaut plus que pour les DOSSIERS HÉRITÉS (filleul payé sans
   * `parrainageEnAttente`). Un filleul qui porte sa décision persistée est repris par `reprendreDecision` : montants,
   * plafond et date du passage initial, jamais ceux du jour du rejeu (points Codex 1 à 4).
   */
  async function reprendreParrainage(commerce: Commerce, filleul: Client, parrain: Client, quand: Date): Promise<{ filleul: Client; texte: string; ecrire: () => Promise<string> }> {
    const rien = { filleul, texte: '', ecrire: async () => '' }
    if (filleul.parrainageEnAttente) return reprendreDecision(commerce, filleul, parrain, filleul.parrainageEnAttente)
    const r = repriseParrainageDue(filleul, parrain, commerce, quand)
    if (!r) return rien
    // Signe 3 (dates) réservé aux parrains SANS marqueur (`filleulsRegles` absent) — point Codex 1 : chez un parrain déjà
    // passé par le marqueur, une date commune avec un AUTRE filleul (même horodatage, visite ultérieure commune) donnait
    // un faux « déjà payé » qui bloquait pour toujours un crédit dû. Ce parrain-là se lit sur son marqueur (signe 1,
    // dans `repriseParrainageDue`) et sur la trace (signe 2).
    // Risque résiduel assumé : un dossier d'avant P0-S11 sans trace (0004 absente à l'époque), dont le parrain a été
    // crédité alors (date dans `parrainagesGagnes`, aucun marqueur) PUIS crédité par le nouveau système pour un autre
    // filleul (le marqueur existe désormais, sans ce filleul) : le signe 3 ne s'applique plus et ce vieux dossier
    // serait recrédité une fois. Il faut cumuler panne d'avant P0-S11, migration 0004 absente et nouveau filleul payé
    // depuis : rare, et sans perte pour personne (un crédit en trop, jamais un crédit perdu).
    if (parrain.filleulsRegles === undefined && filleul.visites.some((v) => (parrain.parrainagesGagnes ?? []).includes(v))) return rien
    if (await st.parrainageDuFilleul(commerce.id, filleul.id)) return rien
    const texteReprise = (credite: Client | null, avant: Client) =>
      credite
        ? `Parrainage (reprise) : +${soldePoints(credite) - soldePoints(avant)} points pour ${avant.prenom} (parrain de ${filleul.prenom})`
        : `Parrainage (reprise) : parrain au plafond annuel, rien pour ${avant.prenom} (parrain de ${filleul.prenom})`
    const texte = texteReprise(r.parrain, parrain)
    const ecrire = async (): Promise<string> => {
      let parrainCredite = r.parrain
      let points = r.parrain ? soldePoints(r.parrain) - soldePoints(parrain) : 0
      let texteJournal = texte
      if (parrainCredite) {
        try {
          await st.majClient(parrainCredite)
        } catch (e) {
          // Même reprise sur conflit que le chemin normal : relu frais, marqueur revérifié (un autre règlement a pu
          // passer), recalculé, réécrit UNE fois.
          if (!(e instanceof ErreurConflit)) throw e
          const frais = await st.client(commerce.id, parrain.id)
          if (frais && filleulRegle(frais, filleul.id)) return ''
          const r2 = frais ? repriseParrainageDue(filleul, frais, commerce, quand) : null
          if (!frais || !r2) throw e
          parrainCredite = r2.parrain
          points = r2.parrain ? soldePoints(r2.parrain) - soldePoints(frais) : 0
          texteJournal = texteReprise(r2.parrain, frais)
          if (parrainCredite) await st.majClient(parrainCredite)
        }
        if (parrainCredite) await journaliser(commerce.id, { type: 'gerant', nom: 'Gérant' }, 'parrainage', texteJournal, parrainCredite, quand)
      }
      const trace: Parrainage = {
        id: `pr-${randomUUID()}`,
        commerceId: commerce.id,
        parrainId: parrain.id,
        filleulId: filleul.id,
        date: quand.toISOString(),
        pointsParrain: points,
        pointsFilleul: configParrainage(commerce).pointsFilleul,
      }
      await st.ajouterParrainage(trace)
      return texteJournal
    }
    return { filleul, texte, ecrire }
  }

  /**
   * Reprise sur décision persistée (revue Codex finale) : le filleul porte `parrainageEnAttente`, écrit avec ses points.
   * - trace d'audit présente → règlement terminé ; la décision est retirée du filleul (l'appelant qui écrit le filleul
   *   — passage suivant — l'efface ; le rejeu de caisse, qui ne réécrit pas le filleul, la laisse : sans effet) ;
   * - marqueur `filleulsRegles` du parrain contenant ce filleul → crédit versé, audit non (point Codex 2) : trace et
   *   journal seulement, aux montants et à la date de la décision, jamais un second crédit ;
   * - sinon → crédit du parrain exécuté tel que décidé (0 au plafond), même si les primes ont changé ou si le
   *   programme a été désactivé depuis (point 3), avec la date du passage initial pour le plafond annuel et la
   *   trace (point 4).
   */
  async function reprendreDecision(commerce: Commerce, filleul: Client, parrain: Client, d: DecisionParrainage): Promise<{ filleul: Client; texte: string; ecrire: () => Promise<string> }> {
    if (d.parrainId !== parrain.id) return { filleul, texte: '', ecrire: async () => '' }
    if (await st.parrainageDuFilleul(commerce.id, filleul.id)) {
      const { parrainageEnAttente: _d, ...termine } = filleul
      return { filleul: termine, texte: '', ecrire: async () => '' }
    }
    const date = new Date(d.date)
    const texte = d.auPlafond
      ? `Parrainage (reprise) : parrain au plafond annuel, rien pour ${parrain.prenom} (parrain de ${filleul.prenom})`
      : `Parrainage (reprise) : +${d.pointsParrain} points pour ${parrain.prenom} (parrain de ${filleul.prenom})`
    const ecrire = async (): Promise<string> => {
      if (!d.auPlafond) {
        let credite = parrain
        if (!filleulRegle(parrain, filleul.id)) {
          credite = parrainSelonDecision(parrain, filleul.id, d)
          try {
            await st.majClient(credite)
          } catch (e) {
            // Parrain modifié entre-temps : relu frais. Marqueur présent = un règlement concurrent vient de verser ce
            // crédit et écrit lui-même la trace — ne rien recréditer ni retracer. Sinon, décision réexécutée UNE fois.
            if (!(e instanceof ErreurConflit)) throw e
            const frais = await st.client(commerce.id, parrain.id)
            if (!frais) throw e
            if (filleulRegle(frais, filleul.id)) return ''
            credite = parrainSelonDecision(frais, filleul.id, d)
            await st.majClient(credite)
          }
        } else if (await st.parrainageDuFilleul(commerce.id, filleul.id)) {
          // Audit seul : relu juste avant d'écrire (une autre reprise a pu le compléter entre-temps).
          return ''
        }
        await journaliser(commerce.id, { type: 'gerant', nom: 'Gérant' }, 'parrainage', texte, credite, date)
      }
      const trace: Parrainage = {
        id: `pr-${randomUUID()}`,
        commerceId: commerce.id,
        parrainId: parrain.id,
        filleulId: filleul.id,
        date: d.date,
        pointsParrain: d.auPlafond ? 0 : d.pointsParrain,
        pointsFilleul: d.pointsFilleul,
      }
      await st.ajouterParrainage(trace)
      return texte
    }
    return { filleul, texte, ecrire }
  }

  /** Inscrit le client, ou retrouve celui qui a déjà ce téléphone / e-mail dans ce commerce. */
  /**
   * `consentement` : case « relances » cochée à l'inscription. Seulement pour un NOUVEAU client : un client retrouvé
   * garde son choix (sinon n'importe qui connaissant son numéro pourrait le réabonner après un STOP) — le gérant peut le
   * modifier sur la fiche.
   */
  async function inscrireOuRetrouver(commerce: Commerce, prenom: string, contactSaisi: unknown, parrainCode?: unknown, consentement = false) {
    const commerceId = commerce.id
    const contact = contactOuErreur(contactSaisi)
    const existant = await st.clientParContact(commerceId, contact)
    if (existant) return { client: existant, existant: true }
    // Parrainage : le code est résolu ici (un seul parrain par filleul, fixé à l'inscription).
    let parrainId: string | undefined
    const code = typeof parrainCode === 'string' ? parrainCode.trim().toUpperCase() : ''
    const clientsConnus = code ? await st.clients(commerceId) : []
    if (code) parrainId = clientsConnus.find((c) => (c.codeParrainage ?? '').toUpperCase() === code)?.id
    let client = appliquerInscription(nouveauClient(commerceId, prenom, contact, maintenant()), commerce, parrainId)
    // Code unique dans le commerce (collision quasi impossible, mais vérifiée).
    const codesPris = new Set(clientsConnus.map((c) => c.codeParrainage).filter(Boolean))
    for (let i = 0; i < 10 && codesPris.has(client.codeParrainage); i++) client = { ...client, codeParrainage: genererCodeParrainage() }
    if (consentement) client = avecConsentement(client, true, 'inscription', maintenant())
    client = avecMessages(client, commerce, 'inscription')
    try {
      await st.ajouterClient(client)
    } catch (e) {
      // Double inscription simultanée : la contrainte unique (commerce, contact) a refusé la 2e → on reprend la 1re.
      const gagnant = e instanceof ErreurConflit ? await st.clientParContact(commerceId, contact) : undefined
      if (!gagnant) throw e
      return { client: gagnant, existant: true }
    }
    return { client, existant: false }
  }

  // ---- RGPD (P1-B6) ----

  /**
   * Preuve d'identité du client sur les routes publiques RGPD (export, demande de suppression) : le lien de sa carte
   * (identifiant) ET son téléphone ou son e-mail, comparés avec la même normalisation que l'inscription.
   */
  function contactDuClient(client: Client, saisi: unknown): boolean {
    const contact = typeof saisi === 'string' ? analyserContact(saisi) : null
    if (!contact) return false
    const cle = cleContact(contact)
    return (!!client.telephone && cleContact({ telephone: client.telephone }) === cle) || (!!client.email && cleContact({ email: client.email }) === cle)
  }

  /** Client d'une carte (route publique /cartes/:id/…), tous commerces confondus ; 404 sinon. */
  async function clientDeCarte(clientId: string): Promise<{ commerce: Commerce; client: Client }> {
    for (const c of await st.commerces()) {
      const client = await st.client(c.id, clientId)
      if (client) return { commerce: c, client }
    }
    throw err(404, 'Carte de fidélité introuvable.')
  }

  /**
   * Suppression d'un client et de sa cascade (voir `Stockage.supprimerClient`). Avant : les filleuls de ce client
   * perdent leur lien `parrainId` vers lui (et leur décision de parrainage, qui le nomme), et son propre parrain perd
   * son id dans `filleulsRegles` (revue Codex finale, point 6) : plus aucune donnée ne pointe vers la carte supprimée.
   * Aucune entrée de journal ici : l'appelant journalise l'opération SANS prénom ni contact (sinon la trace garderait
   * la donnée effacée).
   */
  async function supprimerClientCascade(commerceId: string, clientId: string): Promise<BilanSuppression> {
    // Version d'accès de la carte (P0-S7) : plus rien à protéger une fois la carte supprimée.
    const cleAcces = cleVersionAcces(commerceId, clientId)
    for (const filleul of (await st.clients(commerceId)).filter((c) => c.parrainId === clientId)) {
      await st.transaction(async () => {
        const avant = await st.client(commerceId, filleul.id)
        if (!avant || avant.parrainId !== clientId) return
        const { parrainId: _p, parrainageEnAttente: _d, ...apres } = avant
        await st.majClient(apres)
      })
    }
    // Même prudence côté parrain : relu dans sa transaction, réécrit seulement s'il porte encore ce marqueur. Une liste
    // vidée reste `[]` (pas supprimée) : ce parrain reste « passé par le marqueur » pour `reprendreParrainage`.
    const supprime = await st.client(commerceId, clientId)
    if (supprime?.parrainId) {
      const parrainId = supprime.parrainId
      await st.transaction(async () => {
        const avant = await st.client(commerceId, parrainId)
        if (!avant || !(avant.filleulsRegles ?? []).includes(clientId)) return
        await st.majClient({ ...avant, filleulsRegles: avant.filleulsRegles!.filter((id) => id !== clientId) })
      })
    }
    const bilan = await st.transaction(() => st.supprimerClient(commerceId, clientId))
    if (bilan.client) {
      await st.supprimerMeta(cleAcces)
      versionsAcces.delete(cleAcces)
    }
    return bilan
  }

  const resumeBilan = (b: BilanSuppression) =>
    `${b.tirages} tirage(s), ${b.journal} entrée(s) de journal, ${b.parrainages} parrainage(s), ${b.rattrapages} demande(s) de rattrapage, ${b.envois} relance(s)`

  // ---- Logo téléversé (P1-B5) ----
  // Rangé dans `meta` (clé `logo:<commerce>`, valeur JSON { type, version, donnees base64 } ; vide = aucun) : pas de
  // migration, et la ligne JSONB du commerce ne garde que l'adresse versionnée. Gardé en mémoire après la 1re lecture
  // (Render = une instance) : chaque affichage public ne relit pas l'image en base.
  type LogoStocke = { type: FormatLogo; version: string; octets: Buffer }
  const cleMetaLogo = (commerceId: string) => `logo:${commerceId}`
  // Blob immuable d'un envoi précis (revue Codex P0-S11, point 2) : deux PUT simultanés d'images différentes
  // n'écrasent plus l'image gagnante — l'adresse `?v=<version>` retrouve toujours ses propres octets.
  const cleMetaLogoVersion = (commerceId: string, version: string) => `logo:${commerceId}:${version}`
  const logosEnMemoire = new Map<string, LogoStocke | null>()
  const logosVersionnesEnMemoire = new Map<string, LogoStocke>()

  function serialiserLogo(logo: LogoStocke): string {
    return JSON.stringify({ type: logo.type, version: logo.version, donnees: logo.octets.toString('base64') })
  }
  function deserialiserLogo(brut: string | undefined): LogoStocke | null {
    if (!brut) return null
    const v = JSON.parse(brut) as { type: FormatLogo; version: string; donnees: string }
    return { type: v.type, version: v.version, octets: Buffer.from(v.donnees, 'base64') }
  }
  /** Version désignée par une adresse de logo (`/logo?v=<version>`), null sinon (adresse vide ou statique). */
  function versionLogoAdresse(logo: string | undefined): string | null {
    if (!logo) return null
    try {
      return new URL(logo, 'http://localhost').searchParams.get('v')
    } catch {
      return null
    }
  }

  async function lireLogo(commerceId: string): Promise<LogoStocke | null> {
    if (logosEnMemoire.has(commerceId)) return logosEnMemoire.get(commerceId)!
    const logo = deserialiserLogo(await st.meta(cleMetaLogo(commerceId)))
    logosEnMemoire.set(commerceId, logo)
    return logo
  }
  async function lireLogoVersion(commerceId: string, version: string): Promise<LogoStocke | null> {
    const cle = `${commerceId}:${version}`
    if (logosVersionnesEnMemoire.has(cle)) return logosVersionnesEnMemoire.get(cle)!
    const logo = deserialiserLogo(await st.meta(cleMetaLogoVersion(commerceId, version)))
    if (logo) logosVersionnesEnMemoire.set(cle, logo)
    return logo
  }
  async function ecrireLogo(commerceId: string, logo: LogoStocke | null) {
    logosEnMemoire.delete(commerceId)
    if (logo) {
      await st.majMeta(cleMetaLogoVersion(commerceId, logo.version), serialiserLogo(logo))
      logosVersionnesEnMemoire.set(`${commerceId}:${logo.version}`, logo)
    }
    await st.majMeta(cleMetaLogo(commerceId), logo ? serialiserLogo(logo) : '')
    logosEnMemoire.set(commerceId, logo)
  }
  /** Supprime le blob d'une version (au mieux) : la version n'est plus désignée par aucune adresse. */
  async function supprimerLogoVersion(commerceId: string, version: string) {
    logosVersionnesEnMemoire.delete(`${commerceId}:${version}`)
    await st.majMeta(cleMetaLogoVersion(commerceId, version), '')
  }

  type Reponse = {
    statut?: number
    json?: unknown
    csv?: { nom: string; contenu: string }
    xml?: string
    redirection?: string
    image?: { type: string; octets: Buffer; etag: string; cache: string }
    /** Pièce jointe binaire déjà compressée (sauvegarde `.json.gz`) : envoyée telle quelle, jamais recompressée. */
    fichier?: { nom: string; type: string; octets: Buffer }
  }

  async function router(req: IncomingMessage, chemin: string[]): Promise<Reponse> {
    const m = req.method
    const [ressource, id, sous, sousId, action, extra] = chemin

    if (ressource === 'sante' && !id && m === 'GET') {
      return {
        json: {
          ok: true,
          version: o.version ?? '0.0.0',
          mode: o.production ? 'production' : 'developpement',
          stockage: st.type,
          demo: !!o.demo,
          integrations: integrations(),
          // P0-S9 : SQLite en production ne devrait plus arriver (server/index.ts refuse de démarrer sans
          // Supabase) — si c'est le cas (démarrage par un autre chemin), l'alerte est visible ici.
          ...(st.type === 'sqlite' && o.production
            ? { alerteStockage: 'Base SQLite en production : les données sont dans un fichier local éphémère (perdu à chaque redéploiement ou réveil). Définir SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY — le serveur refuse désormais de démarrer sans elles en production.' }
            : {}),
          // Migration 0003 (équipe, journal, menu) appliquée sur la base ?
          // Migration 0004 (parrainages, demandes de rattrapage) appliquée sur la base ?
          // Migration 0007 (journal des envois de relances) appliquée ? Sans elle, aucun envoi réel ne part.
          // Migration 0008 (compteurs anonymes de la mesure) appliquée ? Sans elle, l'entonnoir reste vide.
          migrations: { cartiz: await schemaCartiz(), programme: await schemaProgramme(), relances: await schemaRelances(), mesure: await schemaMesure() },
        },
      }
    }
    if (ressource === 'sante' && id === 'acces-client' && !sous && m === 'GET') {
      // P0-S7 (à part : le contenu de /sante est figé) — mode d'accès aux cartes, jetons possibles (SESSION_SECRET),
      // migration 0009 appliquée, fin de grâce des anciens liens, et appels encore faits SANS jeton depuis le démarrage
      // (mode transition) : quand ce compteur reste à 0, passer AUTH_CLIENT à `stricte`. Aucune donnée client.
      return {
        json: {
          mode: modeAuthClient,
          jetons: !!o.secretSession,
          migration: await schemaAuthClient(),
          graceAnciensLiensJusquAu: new Date(finGrace).toISOString(),
          accesSansJeton,
        },
      }
    }
    if (ressource === 'cartes' && id === 'retrouver' && !sous && m === 'POST') {
      // PUBLIC (P1-C3) : « Carte introuvable » → recevoir le lien de sa carte. Même réponse 202 que le contact ait une
      // carte ou non (audit F-12) ; `envoi` = un prestataire est configuré pour ce canal (état du serveur, déjà dans /sante).
      limiterIp(req, 'fiche', limites.ficheClientParIp)
      const contact = contactOuErreur((await lireCorps(req)).contact)
      const canal: Canal = contact.email ? 'email' : 'sms'
      const envoi = notifications.statut()[canal]
      if (envoi) envoyerLiensCarte(contact, canal, sitePublic(req))
      return { statut: 202, json: { ok: true, envoi } }
    }
    if (ressource === 'cartes' && id && sous === 'jeton' && !sousId && m === 'POST') {
      // PUBLIC (P0-S7) — obtenir / renouveler le jeton client de cette carte. Preuves acceptées, dans l'ordre :
      // 1. jeton client encore valable (Authorization) → renouvellement ;
      // 2. `{ lien }` : lien d'accès à usage unique (comptoir, « Retrouver ma carte ») → consommé ;
      // 3. rien : seulement une carte à ANCIEN identifiant, pendant la période de grâce (migration au 1er accès), et
      //    jamais révoquée (version d'accès 0) : une carte révoquée ne se rouvre que par un lien d'accès.
      // Tout le reste : échec compté + 401 uniforme (que la carte existe ou non).
      limiterIp(req, 'fiche', limites.ficheClientParIp)
      compteurs.consommer(`carte:${id}`, limites.lectureParCarte, TROP)
      if (!o.secretSession) throw err(503, 'Accès client non configuré sur ce serveur (SESSION_SECRET absente) : la carte reste ouverte par son lien.')
      await verifierBlocageClient(req)
      const corps = await lireCorps(req)
      const charge = await jetonClient(req, { clientId: id })
      let carte: { commerce: Commerce; client: Client } | undefined
      if (charge) carte = await carteDuJeton(charge)
      else if (typeof corps.lien === 'string' && corps.lien) {
        const l = lireJetonClient(o.secretSession, corps.lien)
        if (!l || l.typ !== 'lien' || l.cid !== id) return refusCarte(req)
        // Usage unique, aussi en concurrence : le `jti` est réservé dès ici, avant le 1er `await` ; un 2e échange
        // simultané du même lien est refusé. La révocation en base reste la garde durable.
        carte = await reserverPendant(echangesEnCours, l.jti, () => refusCarte(req), async () => {
          if (l.exp * 1000 <= maintenant().getTime() || (await estRevoquee(l))) return refusCarte(req)
          const commerce = await st.commerce(l.com)
          const client = commerce && (await st.client(commerce.id, id))
          if (!commerce || !client || l.ver !== (await versionAcces(commerce.id, id))) return refusCarte(req)
          await revoquer(l) // usage unique
          return { commerce, client }
        })
      } else {
        if (estIdClientActuel(id) || graceTerminee(id)) return refusCarte(req)
        carte = await clientDeCarte(id).catch(() => undefined)
        if (!carte || (await versionAcces(carte.commerce.id, carte.client.id)) > 0) return refusCarte(req)
      }
      exigerActif(carte.commerce)
      return { statut: 201, json: { ...(await accesClient(carte.commerce.id, carte.client.id)), clientId: carte.client.id, commerceId: carte.commerce.id } }
    }
    if (ressource === 'cartes' && id && sous === 'revocation' && !sousId && m === 'POST') {
      // PUBLIC (P0-S7) — « Déconnecter tous mes appareils » : le titulaire (jeton valable) révoque tous les jetons et
      // liens d'accès de sa carte, celui-ci compris. Le lien seul ne suffit jamais.
      limiterIp(req, 'fiche', limites.ficheClientParIp)
      const charge = await jetonClient(req, { clientId: id })
      if (!charge) {
        await verifierBlocageClient(req)
        return refusCarte(req)
      }
      const { commerce: c, client } = await carteDuJeton(charge)
      await revoquerAccesCarte(c.id, client.id)
      await journaliser(c.id, { type: 'client', nom: 'Client (depuis sa carte)' }, 'acces', 'Accès à la carte révoqué par le client (tous ses appareils)', client)
      return { json: { ok: true } }
    }
    if (ressource === 'cartes' && id && !sous && m === 'GET') {
      // PUBLIC (ajout V2) : la carte vue par le client (#/carte/<clientId>) et l'état de son jeu du jour.
      // Mêmes informations que POST /clients en public : jamais de téléphone ni d'e-mail. P0-S19 : le code gagnant
      // DU JOUR n'est servi qu'au titulaire authentifié (jeton client valable de CETTE carte) — jamais dans la vue
      // limitée, jamais non plus dans la vue complète obtenue sans jeton en mode transition : connaître un
      // `clientId` ne suffit plus à retirer le gain avant son titulaire. Le titulaire sur un autre téléphone /
      // au cache vidé récupère son code avec un jeton (lien d'accès du comptoir, « Retrouver ma carte », ou
      // renouvellement du jeton rangé sur son téléphone) ; la réponse de son propre tirage le lui donne aussi.
      // P0-S7 : vue COMPLÈTE avec un jeton client de cette carte (ou en mode transition) ; sinon vue LIMITÉE (tampons,
      // jeu du jour sans code, sans prénom, messages, historique ni demandes). Ancien
      // identifiant après la période de grâce, sans jeton : 404, comme une carte inconnue.
      limiterIp(req, 'lecture', limites.lectureParIp)
      compteurs.consommer(`carte:${id}`, limites.lectureParCarte, TROP)
      const charge = await jetonClient(req, { clientId: id })
      if (!charge) await verifierBlocageClient(req)
      const complete = !!charge || modeAuthClient === 'transition'
      const commerces = charge ? [(await carteDuJeton(charge)).commerce] : await st.commerces()
      for (const c of commerces) {
        let client = await st.client(c.id, id)
        if (!client) continue
        if (!complete && graceTerminee(id)) break
        exigerActif(c)
        const tirages = await st.tiragesClient(c.id, client.id)
        const t = maintenant()
        const duJour = tirageDuJour(tirages, c.id, client.id, t)
        const jeu = {
          statut: statutJeu(client, tirages, c.id, t, modeAccesRoue(c)),
          lotDuJour: duJour?.lot ?? null,
          // R3 (burn-on-reveal) : toujours null — champ gardé pour les pages d'avant R3. Le gain du jour ne s'utilise
          // qu'à partir de demain et le code n'est plus servi que par l'activation (POST …/tirages/:id/activer), au
          // titulaire authentifié (P0-S19 resserré), 10 minutes à la fois.
          codeDuJour: null,
          remisDuJour: !!duJour?.remis,
        }
        const acces = { vue: complete ? 'complete' : 'limitee', jeton: !!charge, ...infosGrace(id) }
        if (!complete) {
          const menu = await st.menu(c.id)
          return {
            json: {
              client: { id: client.id, commerceId: c.id, tampons: client.tampons },
              commerce: await fichePublique(c),
              jeu,
              menuDisponible: !!menu?.categories.some((cat) => cat.produits.length),
              acces,
            },
          }
        }
        if (!charge) accesSansJeton++
        // Ouverture de la carte : relance des inactifs / anniversaire, si ces règles sont activées (une seule fois chacune).
        const avec = avecMessages(client, c, 'ouverture', t)
        if (avec !== client) {
          try {
            await st.transaction(async () => {
              const frais = await clientOu404(c.id, id)
              const maj = avecMessages(frais, c, 'ouverture', t)
              if (maj !== frais) await st.majClient(maj)
            })
            client = avec
          } catch (e) {
            // Écriture concurrente : la carte s'affiche quand même, le message viendra à la prochaine ouverture.
            if (!(e instanceof ErreurConflit)) throw e
          }
        }
        const menu = await st.menu(c.id)
        return {
          json: {
            client: cartePublique(client),
            commerce: await fichePublique(c),
            jeu,
            menuDisponible: !!menu?.categories.some((cat) => cat.produits.length),
            // P1-C3 : historique des lots de la roue (gagnants seulement), sans aucun code. R3 : statut v2 (`statutGain`).
            historiqueLots: tirages
              .filter((x) => estGainPhysique(typeTirage(x)))
              .sort((a, b) => b.date.localeCompare(a.date))
              .slice(0, 20)
              .map((x) => ({ lot: x.lot, date: x.date, statut: statutGain(x, t) })),
            // R3 : gains non terminaux (en attente, utilisables, code activé ou non), sans code — de quoi afficher
            // « Utiliser mon gain » ; le code vient de l'activation, qui exige le jeton client.
            gainsEnCours: gainsEnCoursDe(tirages, t),
            acces,
          },
        }
      }
      // Carte supprimée depuis l'émission du jeton : même refus qu'un jeton invalide.
      if (charge) throw err(401, REFUS_CARTE)
      return refusCarte(req, 404)
    }
    if (ressource === 'cartes' && id && sous === 'lus' && m === 'POST') {
      // PUBLIC : le client marque ses messages comme lus (P0-S7 : jeton client de cette carte ; mode transition : lien seul).
      limiterIp(req, 'lecture', limites.lectureParIp)
      compteurs.consommer(`carte:${id}`, limites.lectureParCarte, TROP)
      const charge = await exigerAccesCarte(req, { clientId: id })
      for (const c of charge ? [(await carteDuJeton(charge)).commerce] : await st.commerces()) {
        if (!(await st.client(c.id, id))) continue
        exigerActif(c)
        await st.transaction(async () => {
          const avant = await clientOu404(c.id, id)
          const apres = marquerLus(avant)
          if (apres !== avant) await st.majClient(apres)
        })
        return { json: { ok: true } }
      }
      throw err(404, 'Carte de fidélité introuvable.')
    }
    if (ressource === 'cartes' && id && (sous === 'donnees' || sous === 'suppression') && !sousId && m === 'POST') {
      // PUBLIC (P1-B6, RGPD) — depuis la carte du client : « Recevoir mes données » (CSV de SES données) et « Demander
      // la suppression » (demande enregistrée ; la suppression elle-même est faite par le commerce, fiche client).
      // Identité : lien de la carte + téléphone ou e-mail du client (403 sinon). Le commerce inactif n'empêche pas ces
      // droits. Limité par IP et par carte (même seuil que les autres formulaires de la carte).
      // P0-S7 : jeton client de cette carte EN PLUS du contact (mode transition : lien + contact, comme avant).
      limiterIp(req, 'fiche', limites.ficheClientParIp)
      compteurs.consommer(`rgpd:${id}`, limites.ficheClientParIp, TROP)
      const charge = await exigerAccesCarte(req, { clientId: id })
      const corps = await lireCorps(req)
      const { commerce: c, client } = charge ? await carteDuJeton(charge) : await clientDeCarte(id)
      if (!contactDuClient(client, corps.contact)) {
        throw err(403, 'Ce téléphone ou cet e-mail ne correspond pas à cette carte : indiquez celui donné à l’inscription.')
      }
      const auteur: Auteur = { type: 'client', nom: 'Client (depuis sa carte)' }
      if (sous === 'donnees') {
        const csv = exportClientCsv(client, await st.tiragesClient(c.id, client.id), await st.envois(c.id, 500, client.id), maintenant())
        await journaliser(c.id, auteur, 'rgpd', 'Export de ses données téléchargé par le client', client)
        return { csv: { nom: nomFichierExportClient(client.id), contenu: csv } }
      }
      const apres = await st.transaction(async () => {
        const avant = await clientOu404(c.id, client.id)
        if (avant.demandeSuppressionLe) return avant
        const maj: Client = { ...avant, demandeSuppressionLe: maintenant().toISOString() }
        await st.majClient(maj)
        await journaliser(c.id, auteur, 'rgpd', 'Demande de suppression des données reçue depuis la carte', maj)
        return maj
      })
      return { json: { ok: true, demandeSuppressionLe: apres.demandeSuppressionLe, commerce: c.nom } }
    }
    if (ressource === 'sessions' && !id) {
      if (m === 'POST') {
        limiterIp(req, 'session', limites.sessionParIp)
        return ouvrirSession(req)
      }
      if (m === 'DELETE') return fermerSession(req)
      throw err(405, 'Méthode non autorisée.')
    }
    if (ressource === 'desinscription' && id && sous && !sousId && m === 'POST') {
      // PUBLIC — lien de désinscription des relances (page #/desinscription/…, lien des e-mails et lien court /d/…
      // des SMS, bouton « Se désabonner » des messageries via List-Unsubscribe-Post). Le corps n'est pas lu
      limiterIp(req, 'fiche', limites.ficheClientParIp)
      for (const c of await st.commerces()) {
        if (!(await st.client(c.id, id))) continue
        const attendu = Buffer.from(await jetonDesinscription(c.id, id))
        const recu = Buffer.from(sous)
        if (attendu.length !== recu.length || !timingSafeEqual(attendu, recu)) break
        await st.transaction(async () => {
          const avant = await clientOu404(c.id, id)
          if (avant.consentementRelance === false) return
          const apres = avecConsentement(avant, false, 'lien-email', maintenant())
          await st.majClient(apres)
          await journaliser(c.id, { type: 'client', nom: 'Client (lien de désinscription)' }, 'consentement', 'Consentement aux relances retiré : lien de désinscription', apres)
        })
        return { json: { ok: true, commerce: c.nom } }
      }
      throw err(404, 'Lien de désinscription invalide.')
    }

    if (ressource === 'admin' && id === 'sauvegarde' && !sous) {
      // ADMIN SEULEMENT — sauvegarde complète téléchargeable (écran Admin) : même export, même format et même
      // chiffrement que le CLI `scripts/sauvegarde-base.mjs` (docs/SAUVEGARDE.md), restaurable par
      // `scripts/restaurer-base.mjs`. Table métier absente ou illisible → erreur, AUCUNE archive partielle.
      if (m !== 'GET') throw err(405, 'Méthode non autorisée.')
      await exigerAdmin(req)
      let sauvegarde: Awaited<ReturnType<typeof exporterSauvegarde>>
      try {
        sauvegarde = await exporterSauvegarde((table) => st.lireTableSauvegarde(table), maintenant)
      } catch (e) {
        const cause = e instanceof Error ? e.message : String(e)
        console.error(`[sauvegarde] ERREUR SAUVEGARDE — ${cause}`)
        // 500 et non 503 : le front affiche le message d'une 500, alors qu'il traduit une 502-504 en « hors ligne ».
        throw err(500, `ERREUR SAUVEGARDE — ${cause}`)
      }
      const json = JSON.stringify(sauvegarde)
      const cle = o.cleChiffrementSauvegarde
      if (!cle) console.warn('[sauvegarde] AVERTISSEMENT — sauvegarde non chiffrée téléchargée par l’admin (SAUVEGARDE_CLE_CHIFFREMENT absente) : fichier sensible, à protéger.')
      const contenu = cle ? chiffrerSauvegarde(json, cle) : json
      const total = Object.values(sauvegarde.compteurs).reduce((a, b) => a + b, 0)
      console.log(`[sauvegarde] téléchargée par l’admin — ${total} lignes${cle ? ' — chiffrée AES-256-GCM' : ''}`)
      return { fichier: { nom: nomFichierSauvegarde(sauvegarde.creeLe), type: 'application/gzip', octets: gzipSync(Buffer.from(contenu, 'utf8')) } }
    }

    if (ressource !== 'commerces') throw err(404, 'Route inconnue.')

    // Lectures publiques d'un commerce (liste, fiche, menu) : par IP, avant toute lecture en base.
    if (m === 'GET' && (!sous || ((sous === 'menu' || sous === 'reglement') && !sousId))) limiterIp(req, 'lecture', limites.lectureParIp)

    if (!id) {
      if (m === 'GET') return { json: { commerces: await Promise.all((await st.commerces()).map(fichePublique)) } }
      if (m === 'POST') {
        await exigerAdmin(req)
        const corps = await lireCorps(req)
        const { pin, nom, type, lienGoogle, ...reglages } = corps
        const pinClair = pinNeuf(pin)
        const base = nouveauCommerce(texte(nom, 'nom', 80, { requis: true }), typeCommerce(type ?? 'autre'), lien(lienGoogle ?? ''))
        const commerce = appliquerReglages(base, reglages, CHAMPS_REGLAGES.filter((k) => !['nom', 'type', 'lienGoogle'].includes(k)))
        await st.ajouterCommerce(commerce, await hacherPin(pinClair))
        idsCommercesConnus.add(commerce.id) // P2-Q6 : le nouveau commerce reste lisible dans les logs.
        // Réponse à l'admin authentifié : fiche complète, comme PATCH et /etat (le PIN est stocké à part).
        return { statut: 201, json: { commerce } }
      }
      throw err(405, 'Méthode non autorisée.')
    }

    const commerce = await commerceOu404(id)

    if (!sous) {
      if (m === 'PATCH') {
        await exigerCommercant(req, id)
        const corps = await lireCorps(req)
        const jour = jourParis(maintenant())
        // Comme le front : enregistrer les réglages réapplique les règles aux avis en attente.
        // Commerce relu DANS la transaction (P0-S11) : sous Supabase, sa version y est mémorisée et `majCommerce` écrit
        // « WHERE version = <lue> » — deux enregistrements simultanés : l'un passe, l'autre 409 « réessayez ».
        const maj = await st.transaction(async () => {
          const frais = await commerceOu404(id)
          const maj = appliquerReglages(frais, corps, CHAMPS_REGLAGES, jour)
          await st.majCommerce(maj)
          for (const a of await st.avis(id)) {
            const r = appliquerRegles(a, maj)
            if (r !== a) await st.majAvis(r)
          }
          // Revue Codex R2 point 4 : lots réécrits → tirages d'avant R1 rattachés à leur lot quand c'est sans ambiguïté.
          if ('lots' in corps) await rattraperLotsTirages(maj)
          return maj
        })
        return { json: { commerce: maj } }
      }
      if (m === 'GET') return { json: { commerce: await fichePublique(commerce) } }
      throw err(405, 'Méthode non autorisée.')
    }

    // ---------- Règlement du jeu (R4) ----------
    // PUBLIC (page #/reglement/<id>) : mode d'accès, limite de gains par personne, lots actifs (libellé + type) —
    // jamais les probabilités, les coûts ni les plafonds. Limité par IP comme la fiche (ci-dessus, avant la lecture).
    if (sous === 'reglement' && !sousId) {
      if (m !== 'GET') throw err(405, 'Méthode non autorisée.')
      return { json: { reglement: donneesReglement(commerce) } }
    }

    // ---------- Logo téléversé (P1-B5) ----------
    // GET public (pages accueil / carte / menu) ; PUT et DELETE : commerçant. Le corps du PUT est le fichier brut
    // (PNG / JPEG / WebP, 2 Mo maximum) : le format est lu dans ses octets, le Content-Type envoyé est ignoré.
    if (sous === 'logo' && !sousId) {
      if (m === 'GET') {
        const versionDemandee = new URL(req.url ?? '/', 'http://localhost').searchParams.get('v')
        // Adresse versionnée : les octets de CETTE version, jamais ceux d'un autre envoi (revue Codex P0-S11,
        // point 2). Une vieille adresse ne sert plus les octets d'un nouvel envoi : 404, pas une mauvaise image.
        if (versionDemandee) {
          const parVersion = await lireLogoVersion(id, versionDemandee)
          if (parVersion) return { image: { type: parVersion.type, octets: parVersion.octets, etag: `"${parVersion.version}"`, cache: CACHE_IMMUABLE } }
          // Compatibilité : logo téléversé avant les blobs versionnés (seul le pointeur existe).
          const courant = await lireLogo(id)
          if (courant?.version === versionDemandee) return { image: { type: courant.type, octets: courant.octets, etag: `"${courant.version}"`, cache: CACHE_IMMUABLE } }
          throw err(404, 'Aucun logo téléversé pour ce commerce : le logo par défaut s’affiche.')
        }
        // Sans version : le pointeur, ou à défaut l'image désignée par la fiche du commerce — le pointeur a pu
        // être effacé par une suppression arrivée entre-temps (revue Codex P0-S11, point 3) alors que l'adresse
        // désigne toujours un envoi gagnant. La fiche fait foi, pas le pointeur.
        const versionAdresse = versionLogoAdresse(commerce.logo)
        const logo = (await lireLogo(id)) ?? (versionAdresse ? await lireLogoVersion(id, versionAdresse) : null)
        if (!logo) throw err(404, 'Aucun logo téléversé pour ce commerce : le logo par défaut s’affiche.')
        return { image: { type: logo.type, octets: logo.octets, etag: `"${logo.version}"`, cache: 'public, max-age=300' } }
      }
      if (m === 'PUT') {
        await exigerCommercant(req, id)
        const octets = await lireOctets(req, LIMITES_LOGO.octetsMax, messageTropLourd())
        let infos
        try {
          infos = validerLogo(octets)
        } catch (e) {
          if (e instanceof ErreurLogo) throw err(e.statut, e.message)
          throw e
        }
        const version = createHash('sha256').update(octets).digest('hex').slice(0, 16)
        // Fichier d'abord, adresse ensuite : un échec entre les deux laisse l'ancien logo affiché, jamais une image cassée.
        const ancien = await lireLogo(id)
        await ecrireLogo(id, { type: infos.type, version, octets })
        let maj: Commerce
        try {
          // Relecture dans la transaction (P0-S11) : verrou optimiste, ne réécrit pas des réglages enregistrés entre-temps.
          maj = await st.transaction(async () => {
            const maj: Commerce = { ...(await commerceOu404(id)), logo: urlLogo(id, version) }
            await st.majCommerce(maj)
            return maj
          })
        } catch (e) {
          // Envoi refusé (409 du verrou ou autre) : remettre le pointeur sur l'image que l'adresse désigne
          // (revue Codex P0-S11, point 2) — l'ancienne image si un PATCH a gagné, celle du PUT gagnant sinon
          // (lue dans son blob versionné, que cet envoi n'a pas écrasé). L'erreur d'origine est toujours renvoyée.
          try {
            const logoAdresse = (await st.commerce(id))?.logo
            if ((await lireLogo(id))?.version === version) {
              const adresse = versionLogoAdresse(logoAdresse)
              const cible =
                logoAdresse === ''
                  ? null
                  : !adresse || adresse === ancien?.version
                    ? ancien
                    : adresse === version
                      ? undefined
                      : (await lireLogoVersion(id, adresse)) ?? ancien
              if (cible !== undefined) await ecrireLogo(id, cible)
            }
            // Mon blob versionné n'est désigné par aucune adresse : le supprimer au mieux (sauf si un autre envoi
            // des mêmes octets a gagné entre-temps — même version).
            if (versionLogoAdresse(logoAdresse) !== version) await supprimerLogoVersion(id, version)
          } catch {
            // L'erreur d'origine reste celle renvoyée.
          }
          throw e
        }
        // Envoi accepté : le blob de l'image remplacée ne sert plus (au mieux, sauf si un envoi des mêmes octets
        // l'a repris entre-temps — fenêtre résiduelle, voir server/README.md « Atomicité (P0-S11) »).
        if (ancien && ancien.version !== version) {
          try {
            if (versionLogoAdresse((await st.commerce(id))?.logo) !== ancien.version) await supprimerLogoVersion(id, ancien.version)
          } catch {
            // Un blob orphelin ne gêne pas : aucune adresse ne le désigne.
          }
        }
        return { json: { commerce: maj, logo: { ...infos, octets: octets.length } } }
      }
      if (m === 'DELETE') {
        // « Revenir au logo par défaut » : champ vidé (repli sur public/visuels/logo.png pour Asian Home, initiales sinon).
        await exigerCommercant(req, id)
        // L'adresse remplacée est lue DANS la transaction (revue Codex P0-S11, point 3) : un PUT arrivé entre-temps
        // gagne et n'est pas effacé — l'effacement ne touche que l'image que ce DELETE a remplacée.
        const { maj, adresseAvant } = await st.transaction(async () => {
          const frais = await commerceOu404(id)
          const adresseAvant = frais.logo
          const maj: Commerce = { ...frais, logo: '' }
          await st.majCommerce(maj)
          return { maj, adresseAvant }
        })
        try {
          const versionAvant = versionLogoAdresse(adresseAvant)
          if (((await lireLogo(id))?.version ?? null) === (versionAvant ?? null)) await ecrireLogo(id, null)
          // Le blob de l'adresse remplacée ne sert plus — sauf si un nouvel envoi des mêmes octets l'a reprise.
          if (versionAvant && versionLogoAdresse((await st.commerce(id))?.logo) !== versionAvant) await supprimerLogoVersion(id, versionAvant)
        } catch {
          // Le champ est vidé ; un fichier orphelin ne gêne pas : aucune adresse ne le désigne.
        }
        return { json: { commerce: maj } }
      }
      throw err(405, 'Méthode non autorisée.')
    }

    if (sous === 'etat' && m === 'GET') {
      await exigerCommercant(req, id)
      // Ouverture du tableau de bord : relances automatiques du jour, si le commerce les a activées (arrière-plan).
      lancerRelancesAuto(commerce, sitePublic(req))
      return {
        json: {
          commerce,
          clients: (await st.clients(id)).map(clientCaisse),
          // Revue Codex R3 (F1) : sans le code — il ne circule que par l'activation du titulaire ; le tableau de bord et
          // l'écran Roulette n'affichent que lot, client et statut.
          tirages: (await st.tirages(id)).map(tirageSansCode),
          avis: await st.avis(id),
          membres: (await st.membres(id)).map((m) => m.membre),
          journal: await st.journal(id, 200),
          envois: await st.envois(id, 200),
        },
      }
    }

    if (sous === 'pin' && m === 'PUT') {
      await exigerCommercant(req, id)
      const corps = await lireCorps(req)
      await changerPinCommerce(id, pinNeuf(corps.pin))
      return { json: { ok: true } }
    }

    if (sous === 'export.csv' && m === 'GET') {
      await exigerCommercant(req, id)
      return { csv: { nom: `clients-${id}.csv`, contenu: clientsEnCsv(await st.clients(id)) } }
    }

    if (sous === 'clients' && !sousId && m === 'POST') {
      // Public (auto-inscription depuis la page de jeu) ou commerçant (PIN) : un PIN fourni est toujours vérifié.
      // Inscription simplifiée (recherche CX §1) : téléphone seul obligatoire, prénom optionnel, aucun mot de passe.
      const commercant = aUnPin(req)
      if (commercant) await exigerCommercant(req, id)
      else {
        exigerActif(commerce)
        limiterIp(req, 'inscription', limites.inscriptionParIp)
        await verifierBlocageClient(req)
      }
      const corps = await lireCorps(req)
      if (!commercant) limiterContact('inscription', id, corps.contact, limites.inscriptionParContact)
      const prenom = texte(corps.prenom ?? '', 'prenom', 40)
      // Consentement aux relances : case séparée, jamais pré-cochée ; absent = pas de consentement.
      const consentement = corps.consentementRelance == null ? false : booleen(corps.consentementRelance, 'consentementRelance')
      const { client, existant } = await st.transaction(() => inscrireOuRetrouver(commerce, prenom, corps.contact, corps.parrain, consentement))
      // Commerçant (PIN) : le personnel voit déjà tous les clients — `existant` et 200/201 restent (tests serveur).
      if (commercant) return { statut: existant ? 200 : 201, json: { client, existant } }
      // P2-S13 — signaux uniformisés côté public : la réponse a le MÊME statut 201 et la MÊME forme `{ client }`
      // que le contact ait déjà une carte ou non, sans champ `existant`. Nouvelle carte : son jeton (1re preuve,
      // sur le téléphone qui vient de s'inscrire). Carte existante : PAS de jeton — le titulaire la retrouve par
      // « Retrouver ma carte » ou un lien du comptoir, comme en mode strict.
      // Résiduels documentés (revue Codex P2-S13, points 1–2) : la présence du jeton distingue une création
      // d'une reprise pour qui observe la réponse, et la carte renvoyée permet de lire `jeu.statut` sans jeton
      // en mode transition (trou préexistant P0-S7, fermé en mode strict, production) — fermeture complète
      // impossible tant que l'amorçage du jeton se fait en ligne ; bornés par les limites par IP / par contact
      // et le journal P2-S15. Mode strict : inchangé (409 sans aucune donnée, P0-S7) — le 409 lui-même y reste
      // un signal d'existence, pour la même raison.
      if (existant) {
        if (modeAuthClient === 'stricte') {
          await limiteur.echec([[cleClientIp(req), MAX_ECHECS_CLIENT_IP]], 'client')
          throw err(409, CONTACT_DEJA_INSCRIT)
        }
        accesSansJeton++
        return { statut: 201, json: { client: cartePublique(client) } }
      }
      // Nouvelle carte : son jeton client (1re preuve = celui qui vient de s'inscrire sur ce téléphone).
      return { statut: 201, json: { client: cartePublique(client), ...(o.secretSession ? await accesClient(id, client.id) : {}) } }
    }

    if (sous === 'clients' && sousId && m === 'POST' && (action === 'visite' || action === 'recompense')) {
      const { auteur } = await exigerAuteur(req, id)
      const client = await st.transaction(async () => {
        const avant = await clientOu404(id, sousId)
        if (action === 'recompense' && !recompenseDebloquee(avant, commerce)) {
          throw err(409, `Récompense pas encore débloquée : ${avant.tampons}/${commerce.seuilTampons} tampons.`)
        }
        let apres: Client
        let texteJournal: string
        if (action === 'visite') {
          // Passage sans montant : paliers, défi, niveau et parrainage s'appliquent comme en caisse.
          // P1-S12 — même garde « 1 tampon par jour » que la caisse (`passageAvecProgramme`) : la route historique
          // l'autorisait, un 2e appel le même jour créditait un 2e tampon. La route est gardée (pas supprimée) :
          // le bouton « Valider une visite » de la fiche client est le passage rapide sans achat, distinct de
          // l'écran caisse (qui demande le code équipe et un montant).
          let evenements: EvenementPassage[] = []
          try {
            ;({ client: apres, evenements } = passageAvecProgramme(avant, commerce, 0, maintenant()))
          } catch (e) {
            throw err(409, (e as Error).message)
          }
          apres = avecMessages(apres, commerce, 'passage')
          const regle = await reglerParrainage(commerce, apres, maintenant())
          apres = regle.filleul
          await st.majClient(apres)
          const texteParrainage = await regle.ecrire()
          texteJournal =`+1 tampon (${tamponsAffiches(apres, commerce)}/${commerce.seuilTampons})${evenements.length ? ` · ${evenements.map((e) => e.texte).join(' · ')}` : ''}${texteParrainage ? ` · ${texteParrainage}` : ''}`
          await journaliser(id, auteur, 'passage', texteJournal, apres)
          if (texteParrainage) await journaliser(id, auteur, 'parrainage', texteParrainage, apres)
          return apres
        }
        apres = offrirRecompense(avant, commerce, maintenant())
        await st.majClient(apres)
        await journaliser(
          id,
          auteur,
          'recompense',
          `Récompense offerte : ${commerce.recompense}`,
          apres,
        )
        return apres
      })
      return { json: { client: clientCaisse(client) } }
    }

    // ---------- Caisse (code équipe ou PIN) ----------

    if (sous === 'caisse' && !sousId && m === 'GET') {
      const { auteur } = await exigerAuteur(req, id)
      exigerActif(commerce)
      // P0-S14 — vue caisse minimale : plus jamais la liste des clients ni le journal. Sans `q`, aucun client ;
      // avec `?q=`, seuls les clients correspondants, paginés côté serveur. La fiche complète d'un client s'obtient
      // à la demande (GET …/caisse/clients/:id : scan QR ou sélection). La recherche par nom / e-mail filtre côté
      // serveur sur tous les clients du commerce (lecture paginée complète, P0-S18).
      const { q, page, limite } = pageRecherche(new URL(req.url ?? '/', 'http://localhost').searchParams)
      // Point Codex 8 : une saisie de numéro (`chiffresRecherche` non nul : chiffres, espaces, + . - ( ) / seulement)
      // ne lit en base que les candidats (`clientsCandidatsNumero`, sur-ensemble filtré sur `cle_contact`) au lieu de
      // tous les clients ; nom, e-mail ou saisie mixte : balayage complet comme avant. Dans les deux cas le filtre final
      // est `correspondRecherche` : mêmes résultats, même ordre, même total.
      const chiffres = q ? chiffresRecherche(q) : null
      const candidats = !q ? [] : chiffres ? await st.clientsCandidatsNumero(id, chiffres, q.trim().toLowerCase()) : await st.clients(id)
      const trouves = candidats.filter((c) => correspondRecherche(c, q))
      const total = trouves.length
      const clients = trouves.slice((page - 1) * limite, page * limite).map(clientCaisseEquipe)
      return { json: { auteur, commerce: commerceCaisse(commerce), clients, total, page, limite } }
    }

    // Fiche client à la demande (P0-S14) : scan QR ou sélection dans les résultats de recherche. 404 si inconnu.
    if (sous === 'caisse' && sousId === 'clients' && action && !extra && m === 'GET') {
      await exigerAuteur(req, id)
      exigerActif(commerce)
      return { json: { client: clientCaisseEquipe(await clientOu404(id, action)) } }
    }

    if (sous === 'caisse' && (sousId === 'passage' || sousId === 'recompense' || sousId === 'echange' || sousId === 'attente' || sousId === 'reserve') && !action && m === 'POST') {
      const { auteur } = await exigerAuteur(req, id)
      exigerActif(commerce)
      const corps = await lireCorps(req)
      const clientId = texte(corps.clientId, 'clientId', 80, { requis: true })
      const actionId = idAction(corps.actionId)
      let centimes = 0
      if (sousId === 'passage' && corps.montantCentimes != null) {
        const v = corps.montantCentimes
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100_000_00) throw err(400, '« montantCentimes » : montant en centimes entre 0 et 100 000 €.')
        centimes = v
      }
      const resultat = await st.transaction(async () => {
        const avant = await clientOu404(id, clientId)
        // Idempotence : une action déjà reçue (file hors ligne rejouée, double tap) ne compte jamais deux fois.
        if (actionDejaTraitee(avant, actionId)) {
          // Point Codex 2 : le passage d'origine a pu échouer APRÈS l'écriture du filleul (panne sur le parrain). Le rejeu
          // termine le règlement en attente (parrain seul) ; le filleul et le journal du passage d'origine ne bougent pas.
          // Seulement la reprise (filleul déjà payé) : jamais un 1er règlement, qui supposerait d'écrire le filleul.
          const parrain = avant.parrainagePaye && avant.parrainId ? await st.client(id, avant.parrainId) : undefined
          if (parrain) await (await reprendreParrainage(commerce, avant, parrain, maintenant())).ecrire()
          return { client: avant, dejaTraite: true }
        }
        // Date contrôlée après l'idempotence : une action déjà comptée, rejouée tard, répond « déjà traitée », pas 400.
        const quand = quandAction(corps.faitLe)
        let apres: Client
        let details: string
        let journalAction: EntreeJournal['action'] = sousId === 'attente' ? 'recompense' : sousId === 'reserve' ? 'reserve' : sousId
        // Parrainage éventuel : écrit après le client (P0-S11, métier puis journal).
        let parrainage: { texte: string; ecrire: () => Promise<string> } | undefined
        if (sousId === 'passage') {
          // Paliers, défi, niveaux (multiplicateur), réserve et parrainage : décidés côté serveur.
          let evenements: EvenementPassage[] = []
          try {
            ;({ client: apres, evenements } = passageAvecProgramme(avant, commerce, centimes, quand, actionId))
          } catch (e) {
            throw err(409, (e as Error).message)
          }
          apres = avecMessages(apres, commerce, 'passage', quand)
          const regle = await reglerParrainage(commerce, apres, quand)
          apres = regle.filleul
          const gagnes = soldePoints(apres) - soldePoints(avant)
          const niveau = niveauClient(apres, commerce)
          details = `+1 tampon (${tamponsAffiches(apres, commerce)}/${commerce.seuilTampons})${centimes ? ` · ${formaterPrix(centimes)} → +${gagnes} point${gagnes > 1 ? 's' : ''} (solde ${soldePoints(apres)}, ${niveau.nom} ×${niveau.multiplicateur})` : ''}${evenements.length ? ` · ${evenements.map((e) => e.texte).join(' · ')}` : ''}`
          parrainage = regle
        } else if (sousId === 'recompense') {
          if (!recompenseDebloquee(avant, commerce)) throw err(409, `Récompense pas encore débloquée : ${avant.tampons}/${commerce.seuilTampons} tampons.`)
          apres = avecAction(offrirRecompense(avant, commerce, quand), actionId)
          details = `Récompense offerte : ${commerce.recompense}`
        } else if (sousId === 'attente') {
          // Récompense gagnée (palier, défi, anniversaire…) remise au comptoir.
          const recompenseId = texte(corps.recompenseId, 'recompenseId', 80, { requis: true })
          const attendue = (avant.recompensesEnAttente ?? []).find((r) => r.id === recompenseId)
          if (!attendue) throw err(404, 'Récompense en attente introuvable pour ce client.')
          try {
            apres = avecAction(consommerRecompenseEnAttente(avant, recompenseId, quand), actionId)
          } catch (e) {
            throw err(409, (e as Error).message)
          }
          details = `Récompense remise : ${attendue.libelle} (${attendue.origine})`
        } else if (sousId === 'reserve') {
          try {
            apres = avecAction(utiliserReserve(avant, quand), actionId)
          } catch (e) {
            throw err(409, (e as Error).message)
          }
          details = 'Plat en réserve utilisé'
        } else {
          const recompenseId = texte(corps.recompenseId, 'recompenseId', 80, { requis: true })
          const r = (commerce.catalogue ?? []).find((x) => x.id === recompenseId)
          if (!r) throw err(404, 'Récompense inconnue dans le catalogue.')
          try {
            apres = echangerPoints(avant, r, auteur.nom, quand, `ech-${randomUUID()}`, actionId).client
          } catch (e) {
            throw err(409, (e as Error).message)
          }
          const e = apres.echangesPoints!.at(-1)!
          details = `Échange : ${r.nom} (−${r.cout} points, solde ${e.soldeAvant} → ${e.soldeApres})`
          journalAction = 'echange'
        }
        await st.majClient(apres)
        // Texte final du parrainage (revue Codex P0-S11, point 5) : la reprise peut recalculer le crédit — le
        // journal du passage reprend ce texte, pas le calcul initial.
        const texteParrainage = (await parrainage?.ecrire()) ?? ''
        if (texteParrainage) {
          await journaliser(id, auteur, 'parrainage', texteParrainage, apres, quand)
          details += ` · ${texteParrainage}`
        }
        await journaliser(id, auteur, journalAction, details, apres, quand)
        return { client: apres, dejaTraite: false }
      })
      return { json: { client: clientCaisseEquipe(resultat.client), dejaTraite: resultat.dejaTraite } }
    }

    // ---------- Code gagnant de la roue (P0-U3, cycle de vie R3) : vérifié puis marqué « remis » en caisse ----------
    // GET  /commerces/:id/caisse/gains/:code         → le gain (lot, client, date, statut v2) ; 404 code inconnu.
    // POST /commerces/:id/caisse/gains/:code/remise  → 200 remis ; 409 pas encore utilisable / code non activé ou fenêtre
    //      de 10 min échue (« inactif ») / déjà remis / perdant ; 410 expiré (après J+30).

    if (sous === 'caisse' && sousId === 'gains' && action && ((!extra && m === 'GET') || (extra === 'remise' && m === 'POST'))) {
      const { auteur } = await exigerAuteur(req, id)
      exigerActif(commerce)
      const code = normaliserCodeGagnant(action)
      if (!code) throw err(400, 'Le code gagnant compte 6 caractères (lettres et chiffres).')
      const t = maintenant()
      const trouve = tirageDuCode(await st.tiragesParCode(id, code), t)
      if (!trouve) throw err(404, `Code inconnu : aucun tirage de ce commerce ne porte le code ${code}.`)
      const gain = async (x: Tirage) => gainCaisse(x, await st.client(id, x.clientId), t)
      if (m === 'GET') return { json: { gain: await gain(trouve) } }

      // R3 : remise seulement si le gain est utilisable (J+1 à J+30) ET son code activé il y a moins de 10 minutes
      // (statut 'utilisable'). Expiré : 410 ; tout le reste (en attente, inactif, remis, perdant, consolation) : 409.
      const refus = (x: Tirage, quand: Date) => {
        const g = gainCaisse(x, undefined, quand)
        if (g.statut !== 'utilisable') throw err(g.statut === 'expire' ? 410 : 409, messageGain(g))
      }
      // Revue Codex R3 (F4) : l'heure de vérité est celle de l'ÉCRITURE, pas celle d'avant la lecture (une lecture lente
      // laisserait passer une remise juste après la fin de la fenêtre ou du gain). Re-vérifié à l'heure de l'écriture,
      // et la base re-vérifie la fenêtre elle-même (`activeLe` dans les 10 dernières minutes, condition de l'UPDATE).
      const quand = maintenant()
      // Tirage hérité du jour même : remise directe, sans fenêtre (ancienne règle, revue Codex F2).
      const activeApres = (x: Tirage) => (tirageHerite(x) ? undefined : new Date(quand.getTime() - FENETRE_ACTIVATION_MS).toISOString())
      // Garde de la base : l'écriture n'a lieu que si personne ne l'a remis entre-temps (deux caisses au même moment) et
      // si la fenêtre d'activation est encore ouverte. Revue Codex 2 R7 (F1) : appliquée sur la ligne fraîche (une
      // activation ou un marqueur de relance posés depuis la lecture ne sont pas effacés).
      const remis = await modifierTirage(
        trouve,
        (frais) => {
          refus(frais, quand)
          return { ...frais, remis: { le: quand.toISOString(), par: auteur } }
        },
        activeApres,
      )
      if (!remis) {
        const relu = (await st.tiragesParCode(id, code)).find((x) => x.id === trouve.id)
        if (relu) refus(relu, maintenant())
        if (relu && !relu.remis) throw err(409, 'Le code vient de changer d’état : vérifiez-le à nouveau.')
        throw err(409, 'Lot déjà remis : un code ne sert qu’une fois.')
      }
      const client = await st.client(id, remis.clientId)
      await journaliser(id, auteur, 'gain', `Gain de la roue remis : ${remis.lot} (code ${code})`, client)
      return { json: { gain: gainCaisse(remis, client, quand) } }
    }

    // ---------- RGPD (P1-B6) : export individuel, suppression, purge de conservation — gérant / admin seulement ----------

    if (sous === 'clients' && sousId && action === 'export.csv' && !extra && m === 'GET') {
      // Toutes les données de CE client (profil, tampons, points, visites, tirages, consentement, messages, relances),
      // rien d'un autre client, jamais de PIN / hash / code équipe.
      const nom = await exigerCommercant(req, id)
      const client = await clientOu404(id, sousId)
      const csv = exportClientCsv(client, await st.tiragesClient(id, client.id), await st.envois(id, 500, client.id), maintenant())
      await journaliser(id, { type: 'gerant', nom }, 'rgpd', 'Export des données du client (CSV)', client)
      return { csv: { nom: nomFichierExportClient(client.id), contenu: csv } }
    }

    if (sous === 'clients' && sousId && !action && m === 'DELETE') {
      // Suppression définitive, sur demande du client ou décision du commerce. Garde-fou serveur en plus de la
      // confirmation saisie à l'écran : le corps doit contenir { "confirmation": "SUPPRIMER" }.
      const nom = await exigerCommercant(req, id)
      const corps = await lireCorps(req)
      if (corps.confirmation !== 'SUPPRIMER') throw err(400, 'Suppression non confirmée : envoyez { "confirmation": "SUPPRIMER" }.')
      const client = await clientOu404(id, sousId)
      const bilan = await supprimerClientCascade(id, client.id)
      const motif = client.demandeSuppressionLe ? 'à la demande du client' : 'décision du commerce'
      // Trace SANS prénom ni contact ni identifiant : seulement qui, quand, pourquoi et combien.
      await journaliser(id, { type: 'gerant', nom }, 'rgpd', `Client supprimé (${motif}) avec ${resumeBilan(bilan)}`)
      return { json: { ok: true, bilan } }
    }

    if (sous === 'purge' && !sousId) {
      // Durée de conservation (P1-B6). GET = avertissement : clients dont la date de purge est passée (« due ») ou
      // proche (« bientot », 30 jours), avec la date prévue et ce qui les protège. POST { clientIds } = exécution, pour
      // les seuls clients listés ET encore purgeables au moment de l'appel (revérifiés ici). Jamais lancée seule : le
      // gérant voit la liste puis confirme (aucune tâche planifiée sur Render Free).
      const nom = await exigerCommercant(req, id)
      const t = maintenant()
      const mois = dureeConservationMois(commerce)
      if (m === 'GET') return { json: { conservationMois: mois, maintenant: t.toISOString(), clients: listePurge(await st.clients(id), commerce, t) } }
      if (m === 'POST') {
        const corps = await lireCorps(req)
        const ids = corps.clientIds
        if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some((x) => typeof x !== 'string')) {
          throw err(400, '« clientIds » : liste des clients à purger (ceux affichés par GET …/purge).')
        }
        const supprimes: string[] = []
        const ignores: string[] = []
        const total: BilanSuppression = { client: true, tirages: 0, journal: 0, parrainages: 0, rattrapages: 0, envois: 0 }
        for (const cid of new Set(ids as string[])) {
          const client = await st.client(id, cid)
          if (!client || !estPurgeable(client, commerce, t)) {
            ignores.push(cid)
            continue
          }
          const b = await supprimerClientCascade(id, cid)
          for (const k of ['tirages', 'journal', 'parrainages', 'rattrapages', 'envois'] as const) total[k] += b[k]
          supprimes.push(cid)
        }
        if (supprimes.length) {
          await journaliser(
            id,
            { type: 'gerant', nom },
            'rgpd',
            `Purge de conservation (${libelleDuree(mois)} sans visite) : ${supprimes.length} client(s) supprimé(s) avec ${resumeBilan(total)}${ignores.length ? ` · ${ignores.length} ignoré(s) (plus purgeables)` : ''}`,
          )
        }
        return { json: { supprimes: supprimes.length, ignores: ignores.length, clientsSupprimes: supprimes } }
      }
      throw err(405, 'Méthode non autorisée.')
    }

    // ---------- Fiche client (gérant) : anniversaire, plat préféré, consentement, exclusion de la purge ----------

    if (sous === 'clients' && sousId && !action && m === 'PATCH') {
      const nom = await exigerCommercant(req, id)
      const corps = await lireCorps(req)
      const inconnus = Object.keys(corps).filter((k) => k !== 'anniversaire' && k !== 'platPrefere' && k !== 'consentementRelance' && k !== 'exclusPurge')
      if (inconnus.length) throw err(400, `Champ non modifiable : ${inconnus.join(', ')}.`)
      const a = corps.anniversaire == null ? '' : texte(corps.anniversaire, 'anniversaire', 5)
      if (a && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(a)) throw err(400, '« anniversaire » : format MM-JJ attendu (ex. 03-21).')
      const plat = corps.platPrefere == null ? '' : texte(corps.platPrefere, 'platPrefere', 80)
      const consentement = 'consentementRelance' in corps ? booleen(corps.consentementRelance, 'consentementRelance') : undefined
      const exclusPurge = 'exclusPurge' in corps ? booleen(corps.exclusPurge, 'exclusPurge') : undefined
      const client = await st.transaction(async () => {
        const avant = await clientOu404(id, sousId)
        let apres: Client = { ...avant }
        // Consentement aux relances : posé (le client l'a donné au gérant) ou retiré (« retirer le consentement »).
        if (consentement !== undefined && consentement !== (avant.consentementRelance === true)) {
          apres = avecConsentement(apres, consentement, 'commercant', maintenant())
          const texteJournal = consentement ? 'Consentement aux relances SMS / e-mail enregistré par le commerce' : 'Consentement aux relances SMS / e-mail retiré par le commerce'
          await journaliser(id, { type: 'gerant', nom }, 'consentement', texteJournal, apres)
        }
        if ('anniversaire' in corps) {
          if (a) apres.anniversaire = a
          else delete apres.anniversaire
        }
        if ('platPrefere' in corps) {
          if (plat) apres.platPrefere = plat
          else delete apres.platPrefere
        }
        if (exclusPurge !== undefined && exclusPurge !== !!avant.exclusPurge) {
          if (exclusPurge) apres.exclusPurge = true
          else delete apres.exclusPurge
          await journaliser(id, { type: 'gerant', nom }, 'rgpd', exclusPurge ? 'Client exclu de la purge de conservation' : 'Client de nouveau soumis à la purge de conservation', apres)
        }
        await st.majClient(apres)
        return apres
      })
      return { json: { client: clientCaisse(client) } }
    }

    // ---------- Accès du client à sa carte (P0-S7) : lien d'accès au comptoir, révocation ----------
    // Lien d'accès : l'équipe (code équipe ou gérant) le montre en QR au client présent au comptoir — c'est la preuve
    // de remplacement quand le téléphone d'inscription est perdu ou changé, sans SMS ni e-mail. 15 min, usage unique.
    // Révocation : gérant seulement ; tous les jetons et liens de la carte tombent (téléphone perdu, carte reprise).

    if (sous === 'clients' && sousId && action === 'lien-acces' && !extra && m === 'POST') {
      const { auteur } = await exigerAuteur(req, id)
      exigerActif(commerce)
      if (!o.secretSession) throw err(503, 'Accès client non configuré sur ce serveur (SESSION_SECRET absente).')
      const client = await clientOu404(id, sousId)
      const { jeton, expireLe } = await lienAcces(id, client.id, DUREE_LIEN_COMPTOIR_S)
      await journaliser(id, auteur, 'acces', 'Lien d’accès à la carte remis au comptoir (15 min, usage unique)', client)
      return { statut: 201, json: { lien: `${sitePublic(req)}/#/carte/${encodeURIComponent(client.id)}?acces=${jeton}`, expireLe } }
    }

    if (sous === 'clients' && sousId && action === 'revocation-acces' && !extra && m === 'POST') {
      const nom = await exigerCommercant(req, id)
      const client = await clientOu404(id, sousId)
      await revoquerAccesCarte(id, client.id)
      await journaliser(id, { type: 'gerant', nom }, 'acces', 'Accès à la carte révoqué par le commerce (jetons et liens d’accès en cours invalidés)', client)
      return { json: { ok: true } }
    }

    // ---------- Prénom demandé APRÈS le tirage (P1-C1) ----------
    // PUBLIC — l'inscription depuis le QR ne demande que le téléphone ou l'e-mail ; le prénom est proposé sur l'écran de
    // gain. Identité : lien de la carte + contact donné à l'inscription (403 sinon, comme les routes RGPD). Seulement si
    // la carte n'a pas encore de prénom (409 sinon) : personne ne peut renommer la carte d'un autre.

    if (sous === 'clients' && sousId && action === 'prenom' && m === 'POST') {
      exigerActif(commerce)
      limiterIp(req, 'fiche', limites.ficheClientParIp)
      // P0-S7 : jeton client de cette carte ; mode transition sans jeton : lien + contact, comme avant.
      const charge = await exigerAccesCarte(req, { clientId: sousId, commerceId: id })
      const corps = await lireCorps(req)
      const prenom = texte(corps.prenom ?? '', 'prenom', 40)
      if (!prenom) throw err(400, 'Indiquez votre prénom.')
      const client = await st.transaction(async () => {
        const avant = charge ? await clientOu401(id, sousId) : await clientOu404(id, sousId)
        if (!charge && !contactDuClient(avant, corps.contact)) {
          throw err(403, 'Ce téléphone ou cet e-mail ne correspond pas à cette carte : indiquez celui donné à l’inscription.')
        }
        if ((avant.prenom ?? '').trim()) throw err(409, 'Cette carte a déjà un prénom.')
        const apres: Client = { ...avant, prenom }
        await st.majClient(apres)
        return apres
      })
      return { json: { client: cartePublique(client) } }
    }

    // ---------- Message privé au restaurant (P1-C4) ----------
    // PUBLIC — proposé après le jeu quand le client choisit une note basse dans l'app, AVANT le lien Google (qui reste
    // accessible). Identité : lien de la carte + contact donné à l'inscription (403 sinon, comme …/prenom). Limité par IP
    // et par carte, plus MESSAGES_PAR_JOUR par carte. Stocké sur la fiche (visible dans #/avis), jamais expédié. La
    // réponse ne renvoie que l'identifiant et la date du message : ni la carte, ni le contact.

    if (sous === 'clients' && sousId && action === 'message-prive' && !extra && m === 'POST') {
      exigerActif(commerce)
      limiterIp(req, 'fiche', limites.ficheClientParIp)
      compteurs.consommer(`message-prive:${sousId}`, limites.ficheClientParIp, TROP)
      // P0-S7 : jeton client de cette carte ; mode transition sans jeton : lien + contact, comme avant.
      const charge = await exigerAccesCarte(req, { clientId: sousId, commerceId: id })
      const corps = await lireCorps(req)
      const valide = validerMessagePrive(corps)
      if (typeof valide === 'string') throw err(400, valide)
      const message = await st.transaction(async () => {
        const avant = charge ? await clientOu401(id, sousId) : await clientOu404(id, sousId)
        if (!charge && !contactDuClient(avant, corps.contact)) {
          throw err(403, 'Ce téléphone ou cet e-mail ne correspond pas à cette carte : indiquez celui donné à l’inscription.')
        }
        const t = maintenant()
        const nouveau = { id: `mp-${randomUUID()}`, note: valide.note, texte: valide.texte, creeLe: t.toISOString() }
        const apres = ajouterMessagePrive(avant, nouveau, t)
        if (typeof apres === 'string') throw err(429, apres)
        await st.majClient(apres)
        return nouveau
      })
      return { statut: 201, json: { ok: true, message: { id: message.id, creeLe: message.creeLe } } }
    }

    // ---------- Profil progressif (client) : anniversaire + plat préféré, après la 2e visite ----------
    // Jamais exigés à l'inscription (recherche CX §1 : chaque champ coûte ~10 % de conversion).

    if (sous === 'clients' && sousId && action === 'profil' && m === 'POST') {
      exigerActif(commerce)
      limiterIp(req, 'fiche', limites.ficheClientParIp)
      // P0-S7 : jeton client de cette carte (mode transition : lien seul, comme avant).
      const charge = await exigerAccesCarte(req, { clientId: sousId, commerceId: id })
      const corps = await lireCorps(req)
      const inconnus = Object.keys(corps).filter((k) => k !== 'anniversaire' && k !== 'platPrefere')
      if (inconnus.length) throw err(400, `Champ non modifiable : ${inconnus.join(', ')}.`)
      const anniversaire = corps.anniversaire == null ? '' : analyserAnniversaire(texte(corps.anniversaire, 'anniversaire', 10))
      if (anniversaire === null) throw err(400, '« anniversaire » : format JJ/MM attendu (ex. 21/03).')
      const plat = corps.platPrefere == null ? '' : texte(corps.platPrefere, 'platPrefere', 80)
      if (!anniversaire && !plat) throw err(400, 'Indiquez au moins votre anniversaire ou votre plat préféré.')
      const client = await st.transaction(async () => {
        const avant = charge ? await clientOu401(id, sousId) : await clientOu404(id, sousId)
        if (!peutCompleterProfil(avant)) throw err(409, 'Votre profil se complète après votre 2e visite : revenez nous voir !')
        const apres: Client = { ...avant }
        if (anniversaire) apres.anniversaire = anniversaire
        if (plat) apres.platPrefere = plat
        await st.majClient(apres)
        return apres
      })
      return { json: { client: cartePublique(client) } }
    }

    // ---------- Rattrapage d'une visite oubliée (Domino's FR : réclamation sous 30 jours) ----------

    if (sous === 'clients' && sousId && action === 'rattrapage' && !extra && m === 'POST') {
      // Public (depuis la carte du client) : le commerçant valide ou refuse ensuite.
      // P0-S7 : jeton client de cette carte (mode transition : lien seul, comme avant).
      exigerActif(commerce)
      limiterIp(req, 'fiche', limites.ficheClientParIp)
      const charge = await exigerAccesCarte(req, { clientId: sousId, commerceId: id })
      const corps = await lireCorps(req)
      const dateVisite = new Date(typeof corps.date === 'string' ? corps.date : '')
      const montant = typeof corps.montantCentimes === 'number' ? corps.montantCentimes : NaN
      const ticket = corps.ticket == null ? '' : texte(corps.ticket, 'ticket', 80)
      const client = await st.transaction(async () => {
        const avant = charge ? await clientOu401(id, sousId) : await clientOu404(id, sousId)
        const raison = rattrapageRecevable(avant, commerce, dateVisite, montant, maintenant())
        if (raison) throw err(409, raison)
        if ((avant.demandesRattrapage ?? []).some((d) => d.statut === 'en_attente' && new Date(d.date).toDateString() === dateVisite.toDateString())) {
          throw err(409, 'Une demande est déjà en attente pour cette date.')
        }
        const demande: DemandeRattrapage = {
          id: `rt-${randomUUID()}`,
          date: dateVisite.toISOString(),
          montantCentimes: montant,
          ...(ticket ? { ticket } : {}),
          statut: 'en_attente',
          creeLe: maintenant().toISOString(),
        }
        const apres: Client = { ...avant, demandesRattrapage: [...(avant.demandesRattrapage ?? []), demande] }
        await st.majClient(apres)
        return { client: apres, demande }
      })
      await st.ajouterDemandeRattrapage({ ...client.demande, commerceId: id, clientId: client.client.id })
      return { statut: 201, json: { demande: client.demande, client: cartePublique(client.client) } }
    }

    if (sous === 'clients' && sousId && action === 'rattrapage' && extra && m === 'POST') {
      // Décision du commerçant : validation = 1 visite + points crédités ; refus = demande classée.
      await exigerCommercant(req, id)
      const corps = await lireCorps(req)
      if (corps.decision !== 'valider' && corps.decision !== 'refuser') throw err(400, '« decision » doit valoir "valider" ou "refuser".')
      const t = maintenant()
      const client = await st.transaction(async () => {
        const avant = await clientOu404(id, sousId)
        const demande = (avant.demandesRattrapage ?? []).find((d) => d.id === extra)
        if (!demande) throw err(404, 'Demande de rattrapage introuvable.')
        if (demande.statut !== 'en_attente') throw err(409, 'Cette demande a déjà été traitée.')
        let apres: Client = {
          ...avant,
          demandesRattrapage: (avant.demandesRattrapage ?? []).map((d) => (d.id === extra ? { ...d, statut: corps.decision === 'valider' ? 'validee' : 'refusee', decideLe: t.toISOString() } : d)),
        }
        // Client d'abord, parrain et journal ensuite (P0-S11) : un conflit sur le client n'écrit rien d'autre.
        if (corps.decision === 'valider') {
          const raison = rattrapageRecevable(avant, commerce, new Date(demande.date), demande.montantCentimes, t)
          if (raison) throw err(409, raison)
          const { client: avecVisite, evenements } = appliquerRattrapageValide(apres, commerce, demande.montantCentimes, new Date(demande.date))
          apres = avecMessages(avecVisite, commerce, 'passage', t)
          const regle = await reglerParrainage(commerce, apres, t)
          apres = regle.filleul
          await st.majClient(apres)
          const texteParrainage = await regle.ecrire()
          await journaliser(
            id,
            { type: 'gerant', nom: 'Gérant' },
            'rattrapage',
            `Visite oubliée validée (${new Date(demande.date).toLocaleDateString('fr-FR')}${demande.montantCentimes ? `, ${formaterPrix(demande.montantCentimes)}` : ''}) : +1 tampon${evenements.length ? ` · ${evenements.map((e) => e.texte).join(' · ')}` : ''}${texteParrainage ? ` · ${texteParrainage}` : ''}`,
            apres,
            t,
          )
        } else {
          await st.majClient(apres)
          await journaliser(id, { type: 'gerant', nom: 'Gérant' }, 'rattrapage', `Visite oubliée refusée (${new Date(demande.date).toLocaleDateString('fr-FR')})`, apres, t)
        }
        return apres
      })
      return { json: { client: clientCaisse(client) } }
    }

    // ---------- Équipe (gérant uniquement) ----------

    if (sous === 'equipe') {
      await exigerCommercant(req, id)
      if (!sousId && m === 'GET') return { json: { membres: (await st.membres(id)).map((x) => x.membre) } }
      if (!sousId && m === 'POST') {
        const corps = await lireCorps(req)
        const nom = texte(corps.nom, 'nom', 40, { requis: true })
        const code = codeEquipe(corps.code)
        if ((await st.membres(id)).length >= 30) throw err(409, '30 membres maximum par commerce.')
        await verifierCodeLibre(id, code)
        const membre: MembreEquipe = { id: `mb-${randomUUID()}`, commerceId: id, nom, creeLe: maintenant().toISOString() }
        await st.ajouterMembre(membre, await hacherPin(code))
        await journaliser(id, { type: 'gerant', nom: 'Gérant' }, 'equipe', `Membre ajouté : ${nom}`)
        return { statut: 201, json: { membre } }
      }
      if (sousId && !action && (m === 'PATCH' || m === 'DELETE')) {
        const existant = (await st.membres(id)).find((x) => x.membre.id === sousId)
        if (!existant) throw err(404, 'Membre inconnu dans cette équipe.')
        if (m === 'DELETE') {
          await st.supprimerMembre(id, sousId)
          await journaliser(id, { type: 'gerant', nom: 'Gérant' }, 'equipe', `Membre retiré : ${existant.membre.nom}`)
          return { json: { ok: true } }
        }
        const corps = await lireCorps(req)
        const inconnus = Object.keys(corps).filter((k) => k !== 'nom' && k !== 'code')
        if (inconnus.length) throw err(400, `Champ non modifiable : ${inconnus.join(', ')}.`)
        const membre = { ...existant.membre }
        if ('nom' in corps) membre.nom = texte(corps.nom, 'nom', 40, { requis: true })
        let code: Pin | undefined
        if ('code' in corps) {
          const c = codeEquipe(corps.code)
          await verifierCodeLibre(id, c, sousId)
          code = await hacherPin(c)
        }
        await st.majMembre(membre, code)
        // Jamais le code dans le journal : seulement le fait qu'il a changé.
        await journaliser(id, { type: 'gerant', nom: 'Gérant' }, 'equipe', `Membre modifié : ${membre.nom}${code ? ' (nouveau code)' : ''}`)
        return { json: { membre } }
      }
      // Réaffichage unique d'un code (P1-C6) : le serveur n'a que le haché, il ne renvoie JAMAIS le code. Il exige le PIN
      // gérant lui-même (une session ne suffit pas : on revérifie la personne) et journalise le réaffichage ; le code est
      // montré par l'appareil qui vient de le saisir (mémoire de la page), une seule fois.
      if (sousId && action === 'reaffichage' && m === 'POST') {
        const pin = enTete(req, 'x-commerce-pin')
        if (!pin) throw err(401, 'PIN gérant requis pour réafficher un code.')
        await verifierPinCommerce(ipDe(req), id, pin)
        const existant = (await st.membres(id)).find((x) => x.membre.id === sousId)
        if (!existant) throw err(404, 'Membre inconnu dans cette équipe.')
        await journaliser(id, { type: 'gerant', nom: 'Gérant' }, 'equipe', `Code de ${existant.membre.nom} réaffiché une fois (PIN gérant)`)
        return { json: { ok: true } }
      }
      throw err(405, 'Méthode non autorisée.')
    }

    // ---------- Messagerie (gérant) : message déposé dans l'espace client des clients ciblés ----------

    if (sous === 'messages' && !sousId && m === 'GET') {
      // Les 100 messages les plus récents (automatiques et ciblés) avec le contact du client : texte prêt à copier.
      await exigerCommercant(req, id)
      const messages = (await st.clients(id))
        .flatMap((c) => (c.messages ?? []).map((msg) => ({ ...msg, clientId: c.id, prenom: c.prenom, contact: c.telephone ?? c.email ?? '' })))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 100)
      return { json: { messages } }
    }

    if (sous === 'messages' && !sousId && m === 'POST') {
      await exigerCommercant(req, id)
      const corps = await lireCorps(req)
      const cibles: Cible[] = ['tous', 'inactifs', 'proches', 'nouveaux']
      if (!cibles.includes(corps.cible as Cible)) throw err(400, `« cible » doit valoir : ${cibles.join(', ')}.`)
      const contenu = texte(corps.texte, 'texte', 600, { requis: true })
      const t = maintenant()
      let n = 0
      for (const c of clientsCibles(await st.clients(id), commerce, corps.cible as Cible, t)) {
        await st.transaction(async () => {
          const avant = await clientOu404(id, c.id)
          await st.majClient(deposerMessage(avant, { id: nouvelIdMessage(), type: 'commercant', texte: contenu, date: t.toISOString() }))
        })
        n++
      }
      await journaliser(id, { type: 'gerant', nom: 'Gérant' }, 'message', `Message déposé dans l’espace client de ${n} client${n > 1 ? 's' : ''} (cible : ${corps.cible})`)
      return { json: { destinataires: n } }
    }

    // ---------- Menu digital ----------

    if (sous === 'menu' && !sousId) {
      if (m === 'GET') {
        exigerActif(commerce)
        return { json: { menu: (await st.menu(id)) ?? { commerceId: id, categories: [], majLe: '' }, commerce: await fichePublique(commerce) } }
      }
      if (m === 'PUT') {
        await exigerCommercant(req, id)
        let menu
        try {
          menu = validerMenu(await lireCorps(req, TAILLE_MAX_MENU), id, maintenant())
        } catch (e) {
          if (e instanceof ErreurMenu) throw err(400, e.message)
          throw e
        }
        await st.majMenu(menu)
        const n = menu.categories.reduce((s, c) => s + c.produits.length, 0)
        await journaliser(id, { type: 'gerant', nom: 'Gérant' }, 'menu', `Menu enregistré : ${menu.categories.length} catégorie(s), ${n} produit(s)`)
        return { json: { menu } }
      }
      throw err(405, 'Méthode non autorisée.')
    }

    if (sous === 'clients' && sousId && action === 'pass.json' && m === 'GET') {
      // Google Wallet : génération réelle (JWT signé) derrière la configuration. Sans émetteur + clé de service → 501,
      // rien n'est généré. Clé illisible → 503, rien n'est généré.
      await exigerCommercant(req, id)
      const client = await clientOu404(id, sousId)
      if (!walletConfigure(o.googleWallet)) {
        throw err(501, 'Google Wallet à brancher : aucun compte émetteur ni clé de service configurés sur ce serveur. Aucun pass n’est généré.')
      }
      const site = (o.urlPublique || `http://${enTete(req, 'host') ?? 'localhost'}`).replace(/\/+$/, '')
      try {
        const { urlEnregistrement } = lienGoogleWallet(o.googleWallet, commerce, client, `${site}/#/carte/${client.id}`, site, maintenant())
        return { json: { signe: true, urlEnregistrement } }
      } catch (e) {
        if (e instanceof ErreurWallet) throw err(503, e.message)
        throw e
      }
    }

    if (sous === 'clients' && sousId && action === 'relance' && m === 'POST') {
      // P1-B3 — relance SMS / e-mail d'un client, de bout en bout : modèle (ou message libre), canal (défaut : selon le
      // contact du client), consentement exigé, anti-doublon du jour, tentative tracée dans `envois` (même refusée).
      // Envoi réel UNIQUEMENT si le prestataire du canal est configuré ; sinon 501, rien n'est envoyé.
      const auteur = await exigerCommercant(req, id)
      const client = await clientOu404(id, sousId)
      const corps = await lireCorps(req)
      if (corps.canal != null && corps.canal !== 'sms' && corps.canal !== 'email') throw err(400, '« canal » doit valoir "sms" ou "email".')
      if (corps.modele != null && !estModeleRelance(corps.modele)) throw err(400, `« modele » doit valoir : ${MODELES_RELANCE.map((x) => x.modele).join(', ')}.`)
      const libre = corps.message == null ? '' : texte(corps.message, 'message', 600, { requis: true })
      if (libre && corps.modele != null) throw err(400, 'Choisissez un modèle ou un message libre, pas les deux.')
      const modele: ModeleRelance | 'libre' = libre ? 'libre' : ((corps.modele as ModeleRelance | undefined) ?? 'inactif')
      const r = await relancer(commerce, client, { modele, canal: corps.canal as Canal | undefined, libre, declencheur: 'manuel', auteur }, sitePublic(req))
      if (r.http !== 200) throw err(r.http, r.message)
      return { json: { envoye: r.envoi.statut === 'envoye', test: r.envoi.statut === 'test', canal: r.envoi.canal, modele, id: r.envoi.idPrestataire ?? '', envoi: r.envoi } }
    }

    if (sous === 'envois' && !sousId && m === 'GET') {
      // Journal des envois de relances (gérant) : les 200 plus récents, ou ceux d'un client (?client=<id>).
      await exigerCommercant(req, id)
      const clientId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('client') || undefined
      return { json: { envois: await st.envois(id, 200, clientId), migration: await schemaRelances() } }
    }

    if (sous === 'stop-sms' && !sousId && m === 'POST') {
      // PUBLIC — webhook Twilio « A message comes in » (à régler sur le numéro expéditeur, voir server/README.md) :
      // une réponse STOP (ou ARRET, DESINSCRIPTION…) retire le consentement du client qui a ce numéro dans ce commerce.
      // Twilio non configuré → 501 ; signature X-Twilio-Signature fausse → 403 (personne d'autre ne peut désinscrire).
      // SMS via Brevo → 501 aussi : avec un expéditeur alphanumérique le client ne peut pas répondre au SMS, Brevo
      // gère le STOP dans sa propre base (liste noire) quand une réponse est possible, et l'app ne branche pas de
      // webhook Brevo pour les réponses ; le consentement se retire par le lien de désinscription porté par chaque
      // SMS (P1-B9, STOP : <lien court /d/…>), depuis la fiche client, ou auprès du commerçant — jamais par cette route.
      limiterIp(req, 'stop', limites.lectureParIp)
      if (!notifications.statut().sms) throw err(501, 'Réception des réponses STOP à brancher : Twilio n’est pas configuré sur ce serveur. Aucun consentement n’a été modifié.')
      if (notifications.prestataire('sms') === 'Brevo') {
        throw err(501, 'Réception des réponses STOP non applicable : les SMS partent via Brevo (expéditeur alphanumérique, pas de réponse possible) ; chaque SMS porte un lien de désinscription (STOP : lien en fin de message). Aucun consentement n’a été modifié.')
      }
      const params = await lireFormulaire(req)
      if (!notifications.signatureSmsValide(`${sitePublic(req)}${req.url ?? ''}`, params, enTete(req, 'x-twilio-signature'))) {
        throw err(403, 'Signature Twilio invalide : requête ignorée.')
      }
      const de = params.get('From') ?? ''
      if (estMotStop(params.get('Body') ?? '') && analyserContact(de)) {
        await st.transaction(async () => {
          const avant = await st.clientParContact(id, { telephone: de })
          if (!avant || avant.consentementRelance === false) return
          const apres = avecConsentement(avant, false, 'stop-sms', maintenant())
          await st.majClient(apres)
          await journaliser(id, { type: 'client', nom: 'Client (réponse STOP)' }, 'consentement', 'Consentement aux relances retiré : réponse STOP par SMS', apres)
        })
      }
      // TwiML vide : Twilio n'envoie aucune réponse automatique de plus.
      return { xml: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>' }
    }

    if (sous === 'tirages' && sousId && action === 'activer' && !extra && m === 'POST') {
      // PUBLIC, titulaire seulement (R3, burn-on-reveal) — « Utiliser mon gain » : pose `activeLe` et renvoie le code,
      // valable 10 minutes en caisse. SEULE route qui sert un code gagnant au client, et seulement avec le jeton client
      // (P0-S7) de la carte qui a gagné — jamais par contact, même en mode transition. Chaque appel écrase l'activation
      // précédente (le client peut ré-appuyer une fois la fenêtre échue). Refus : 409 pas encore utilisable (le jour du
      // tirage) ou déjà remis / sans lot ; 410 expiré (après J+30) ; 404 tirage inconnu de CETTE carte.
      limiterIp(req, 'lecture', limites.lectureParIp)
      if (!o.secretSession) throw err(503, 'Accès client non configuré sur ce serveur (SESSION_SECRET absente) : le code ne peut pas être activé.')
      const charge = await jetonClient(req, { commerceId: id })
      if (!charge) {
        await verifierBlocageClient(req)
        return refusCarte(req)
      }
      compteurs.consommer(`carte:${charge.cid}`, limites.lectureParCarte, TROP)
      exigerActif(commerce)
      await clientOu401(id, charge.cid)
      // Lu parmi les tirages du titulaire : l'id d'un tirage d'un autre client donne le même 404 qu'un id inconnu.
      const tirage = (await st.tiragesClient(id, charge.cid)).find((x) => x.id === sousId)
      if (!tirage) throw err(404, 'Gain introuvable sur cette carte.')
      const t = maintenant()
      // Même écriture conditionnelle que la remise : une caisse qui vient de remettre le lot gagne, l'activation échoue.
      // Revue Codex 2 R7 (F1) : appliquée sur la ligne fraîche — un marqueur de relance posé depuis la lecture survit.
      const active = await modifierTirage(tirage, (frais) => {
        const refus = refusActivation(frais, t)
        if (refus) throw err(refus.statut, refus.message)
        return { ...frais, activeLe: t.toISOString() }
      })
      if (!active) throw err(409, 'Ce gain a déjà été remis au comptoir.')
      return { json: { tirageId: active.id, lot: active.lot, code: active.code, activeLe: active.activeLe, expireActivation: finActivation(active) } }
    }

    if (sous === 'tirages' && !sousId && m === 'POST') {
      // PUBLIC : tout est décidé ici (visite du jour, 1 tirage par jour, lot tiré) — rien ne vient du navigateur.
      // P0-S7 : le joueur est le titulaire du jeton client (Authorization) de CE commerce, jamais « celui qui connaît le
      // contact ». Mode transition sans jeton : comme avant (contact → inscription ou carte retrouvée).
      exigerActif(commerce)
      limiterIp(req, 'tirage', limites.tirageParIp)
      const charge = await exigerAccesCarte(req, { commerceId: id })
      const corps = await lireCorps(req)
      if (charge) compteurs.consommer(`tirage:${id}:${charge.cid}`, limites.tirageParContact, 'Trop de tentatives pour ce contact.')
      else limiterContact('tirage', id, corps.contact, limites.tirageParContact)
      const prenom = corps.prenom == null ? '' : texte(corps.prenom, 'prenom', 40)
      // P2-S13 — message de refus uniformisé : UN SEUL message (409), identique que le client ait déjà joué
      // aujourd'hui ou n'ait pas encore validé sa visite — LE MESSAGE ne distingue plus les deux cas. Le
      // titulaire, lui, connaît déjà la raison précise via `jeu.statut` de GET /cartes/:id (MessageSansVisite /
      // MessageDejaJoue sur #/jouer) ; ce message ne fait que rappeler les deux issues possibles. Les deux
      // formulations historiques sont conservées à l'intérieur (« valider votre visite », « déjà tourné la roue »)
      // pour que le conseil reste utile au client légitime. Résiduel (revue Codex P2-S13, point 2) : en mode
      // transition, `jeu.statut` se lit sans jeton sur la carte — la fermeture complète du statut vient du
      // mode strict (production), pas de ce message.
      const refusJeu = 'Vous ne pouvez pas jouer pour le moment : faites valider votre visite du jour au comptoir — si vous avez déjà tourné la roue aujourd’hui, revenez lors de votre prochaine visite.'
      const resultat = await st.transaction(async () => {
        const client = charge ? await clientOu401(id, charge.cid) : (await inscrireOuRetrouver(commerce, prenom, corps.contact, corps.parrain)).client
        const t = maintenant()
        const tiragesClient = await st.tiragesClient(id, client.id)
        // R2 : mode 'libre' = prêt dès l'identification ; 'visite' (défaut des configs d'avant R2) = comme avant.
        const statut = statutJeu(client, tiragesClient, id, t, modeAccesRoue(commerce))
        if (statut === 'dejaJoue' || statut === 'sansVisite') return { refus: refusJeu }
        // R1 : lots normalisés (id + type résolus, mêmes ids que la vue publique) ; le tirage fige l'id et le type du lot.
        // R2 : ensemble tirable du jour — sans les lots physiques plafonnés aujourd'hui, ni aucun lot physique si le
        // client a atteint sa limite de gains sur 30 jours ; il reste alors points / perdant (repli consolation).
        // Probabilités renormalisées au prorata sur ce qui reste (`tirerLot`).
        const normalises = normaliserLots(commerce.lots)
        // Revue Codex R2 point 1 — comptage des plafonds → choix du lot → insertion → crédit : sérialisés PAR COMMERCE.
        // Sous Supabase, `transaction` n'isole rien : sans ce verrou, deux clients distincts lisent « 0 sortie » d'un lot
        // à plafond 1 et le gagnent tous les deux (l'index unique ne protège que le couple client + jour). HYPOTHÈSE :
        // instance unique du serveur (déploiement réel : un seul service Render) — le verrou est en mémoire du processus,
        // il ne protégerait plus rien avec deux instances (voir server/file-par-cle.ts). Les autres commerces ne
        // s'attendent pas entre eux. La lecture du statut (1 tirage par jour) reste avant le verrou : pour un même
        // client, c'est l'index unique (client + jour) de la base qui tranche entre deux appels simultanés, ci-dessous.
        return fileTirages(id, async () => {
          const plafonnes = await plafonnesDuJour(commerce, t)
          const tirables = lotsTirables(normalises, {
            plafonnes,
            gainsMois: gainsSur30Jours(tiragesClient, t),
            limite: limiteGainsMois(commerce),
          })
          const jouables = lotsJouables(tirables)
          if (!jouables.length) {
            return { refus: lotsJouables(normalises).length ? 'Tous les lots du jour sont partis : revenez demain !' : 'Aucun lot n’est configuré pour le moment.' }
          }
          const tirageId = `ti-${randomUUID()}`
          // D1 — instant gagnant en cours (non consommé, depuis moins de 5 min) : il attribue SON lot, avant le tirage
          // pondéré, si ce lot est encore tirable pour ce client (ni plafonné aujourd'hui, ni client à sa limite mensuelle,
          // chance > 0). Revue Codex D1 (F2) — lot indisponible pour TOUT LE MONDE (plafond du jour, chance 0, lot
          // retiré) : l'instant est consommé sans gain (`gagne: false`), le plafond protège le commerce. Client SEUL
          // bloqué (sa limite mensuelle) : l'instant n'est pas touché — le prochain client éligible dans la fenêtre peut
          // encore le gagner ; ce client-ci a son tirage normal, sans aucun signe de l'instant. Consommation AVANT
          // l'insertion, par écriture conditionnelle sur la valeur lue : un seul tirage peut la gagner, même hors du
          // verrou par commerce ; rendue si le tirage échoue ensuite. Aucune lecture de plus pour un commerce sans lot à
          // instants (désactiver les instants les arrête aussitôt).
          let instant: { cle: string; id: string } | undefined
          let tire: (typeof jouables)[number] | undefined
          const jourInstants = lotsAInstants(normalises).length ? await instantsDuJour(commerce, t) : null
          const enCours = jourInstants && instantEnCours(jourInstants.doc, t)
          if (jourInstants && enCours) {
            const gagnable = jouables.find((l) => l.id === enCours.lotId)
            const pourTous = lotsJouables(lotsTirables(normalises, { plafonnes, gainsMois: 0, limite: 0 })).some((l) => l.id === enCours.lotId)
            if (gagnable || !pourTous) {
              const doc = { ...jourInstants.doc, instants: jourInstants.doc.instants.map((x) => (x.id === enCours.id ? { ...x, consommePar: tirageId, gagne: !!gagnable } : x)) }
              if (await st.majMetaSi(jourInstants.cle, jourInstants.brut, JSON.stringify(doc))) {
                instant = { cle: jourInstants.cle, id: enCours.id }
                tire = gagnable
              }
            }
          }
          /**
           * Tirage refusé ou annulé après la consommation : l'instant redevient gagnable. Revue Codex D1 (F1) — le
           * document du jour porte TOUS les instants : un autre instant consommé entre-temps (autre instance du serveur)
           * fait échouer la comparaison. On relit donc le document frais et on n'y libère que CET instant, s'il est
           * toujours à ce tirage ; `ESSAIS_RESTITUTION` essais, puis incohérence journalisée (ligne JSON, comme
           * `annulerTirageNonCredite`) : l'instant resterait consommé sans tirage.
           */
          const rendreInstant = async () => {
            if (!instant) return
            let cause = 'document modifié à chaque essai'
            for (let essai = 1; essai <= ESSAIS_RESTITUTION; essai++) {
              try {
                const brut = await st.meta(instant.cle)
                if (brut === undefined) return
                const doc = JSON.parse(brut) as InstantsDuJour
                if (!doc.instants.some((x) => x.id === instant!.id && x.consommePar === tirageId)) return
                const libre = doc.instants.map((x) => {
                  if (x.id !== instant!.id) return x
                  const rendu = { ...x }
                  delete rendu.consommePar
                  delete rendu.gagne
                  return rendu
                })
                if (await st.majMetaSi(instant.cle, brut, JSON.stringify({ ...doc, instants: libre }))) return
              } catch (e) {
                cause = e instanceof Error ? e.message : String(e)
              }
            }
            console.error(JSON.stringify({
              type: 'incoherence', niveau: 'erreur', horodatage: new Date().toISOString(), evenement: 'instant-non-rendu',
              commerce: id, tirage: tirageId, instant: instant.id, cle: instant.cle, essais: ESSAIS_RESTITUTION, cause,
            }))
          }
          tire ??= jouables[tirerLot(jouables, alea())]
          const points = tire.type === 'points' ? tire.points : undefined
          const tirage: Tirage = {
            id: tirageId, commerceId: id, clientId: client.id, lot: tire.libelle, lotId: tire.id, typeLot: tire.type,
            ...(points ? { points } : {}),
            date: t.toISOString(),
            // R2 : aucun code pour une consolation en points (rien à retirer, rien à vérifier au comptoir). Un perdant garde
            // le sien : la caisse le vérifie et répond « perdant » (épinglé par P0-U3).
            ...(tire.type !== 'points' ? { code: codeGagnant() } : {}),
          }
          try {
            // Enregistré AVANT le crédit des points : l'index unique (client + jour) fait foi — un double appel simultané
            // est refusé ici et ne crédite jamais deux fois.
            await st.ajouterTirage(tirage)
          } catch (e) {
            // Deux tirages simultanés : la base (index unique client + jour) a refusé le 2e — même message unique.
            await rendreInstant()
            if (e instanceof ErreurConflit) return { refus: refusJeu }
            throw e
          }
          // R2 : consolation en points créditée dans la MÊME transaction (client relu juste avant l'écriture : sous
          // Supabase, verrou optimiste sur sa version — une écriture concurrente de la caisse fait relire et recommencer).
          let solde: number | undefined
          if (points) {
            try {
              for (let essai = 1; ; essai++) {
                const frais = await clientOu401(id, client.id)
                try {
                  await st.majClient({ ...frais, points: soldePoints(frais) + points })
                  solde = soldePoints(frais) + points
                  break
                } catch (e) {
                  if (!(e instanceof ErreurConflit) || essai >= 3) throw e
                }
              }
            } catch (e) {
              await rendreInstant()
              await annulerTirageNonCredite(tirage, e)
            }
          }
          return { tirage, solde }
        })
      })
      // Le client éventuellement créé reste inscrit même en cas de refus (la transaction est validée).
      if ('refus' in resultat) throw err(409, resultat.refus!)
      // R3 (burn-on-reveal) : jamais de code dans cette réponse — le gain ne s'utilise qu'à partir de demain, et son code
      // n'est servi au titulaire que par l'activation (POST …/tirages/:tirageId/activer), 10 minutes à la fois.
      const { id: tirageId, lot, lotId, typeLot, date, points } = resultat.tirage!
      // Lot physique seulement (R1) : une consolation en points n'a rien à retirer au comptoir — `perdant` reste le
      // drapeau « pas de code à montrer » des clients existants ; `type` dit si c'est une consolation.
      const physique = estGainPhysique(typeLot!)
      // Mesure anonyme (P2-Q3) : après le tirage enregistré, sans identité ; un échec ici ne change rien au tirage.
      await compter(id, 'tirage')
      if (physique) await compter(id, 'gain')
      // R2 : consolation en points → montant crédité et nouveau solde ; aucun code.
      const consolation = points ? { points, solde: resultat.solde } : {}
      return { statut: 201, json: { tirageId, lot, lotId, type: typeLot, date, perdant: !physique, ...consolation } }
    }

    if (sous === 'evenements' && !sousId && m === 'POST') {
      // PUBLIC — mesure anonyme (P2-Q3) : « page de jeu ouverte » (scan) ou « clic vers l'avis Google ». Le corps ne
      // contient QUE le type : tout autre champ (identifiant, contact…) est refusé, rien d'autre n'est lu ni stocké
      // (ni IP, ni appareil, ni heure : un compteur par jour). Limite par IP, comme les autres routes publiques.
      limiterIp(req, 'evenement', limites.evenementParIp)
      const corps = await lireCorps(req, 200)
      const inconnus = Object.keys(corps).filter((k) => k !== 'type')
      if (inconnus.length) throw err(400, `Champ refusé : ${inconnus.join(', ')}. Seul « type » est accepté (mesure anonyme).`)
      const type = corps.type as TypeEvenement
      if (!EVENEMENTS_PUBLICS.includes(type)) throw err(400, `« type » doit valoir : ${EVENEMENTS_PUBLICS.join(', ')}.`)
      // Commerce en pause : rien à compter (la page de jeu l'affiche déjà fermé).
      const compte = commerce.actif ? await compter(id, type) : false
      return { statut: 202, json: { ok: true, compte } }
    }

    if (sous === 'instants-gagnants' && !sousId && m === 'GET') {
      // Gérant (D1) — preuve et transparence : les instants gagnants du jour DÉJÀ PASSÉS (heure ≤ maintenant), avec leur
      // issue et le prénom du gagnant. Les instants futurs ne sortent jamais du serveur, pas même leur nombre. Ouvrir le
      // tableau de bord génère les instants du jour s'ils ne l'étaient pas encore (1re utilisation).
      await exigerCommercant(req, id)
      const t = maintenant()
      const jour = await instantsDuJour(commerce, t)
      const passes = jour ? instantsPasses(jour.doc, t) : []
      const gagnes = passes.filter((i) => i.consommePar && i.gagne)
      const tirages = gagnes.length ? await st.tiragesDepuis(id, debutDuJourParis(t)) : []
      const instants: InstantPasse[] = []
      for (const i of passes) {
        const tirage = i.gagne ? tirages.find((x) => x.id === i.consommePar) : undefined
        const gagnant = tirage ? (await st.client(id, tirage.clientId))?.prenom : undefined
        instants.push({ heure: i.heure, lot: i.lot, statut: statutInstant(i, t), ...(gagnant ? { gagnant } : {}) })
      }
      return { json: { jour: jourParis(t), instants } }
    }

    if (sous === 'mesures' && !sousId && m === 'GET') {
      // Gérant (P2-Q3) : compteurs anonymes par jour depuis ?depuis=AAAA-MM-JJ (défaut et minimum : 400 jours).
      await exigerCommercant(req, id)
      const aujourdhui = jourParis(maintenant())
      const plusTot = ajouterJours(aujourdhui, -400)
      const demande = new URL(req.url ?? '/', 'http://localhost').searchParams.get('depuis') ?? ''
      const depuis = /^\d{4}-\d{2}-\d{2}$/.test(demande) && demande > plusTot ? demande : plusTot
      const migration = await schemaMesure()
      return { json: { compteurs: migration ? await st.compteursEvenements(id, depuis) : [], migration, depuis, aujourdhui } }
    }

    // ---- Google Business Profile (P1-B4) : 501 tant que GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquent ----

    if (sous === 'google' && !sousId && m === 'GET') {
      // État de la connexion (gérant) : jamais de jeton, seulement « configuré / connecté depuis le … ».
      await exigerCommercant(req, id)
      if (!googleBusinessConfigure(o.googleBusiness)) return { json: { configure: false, connecte: false } }
      const j = await lireJetonsGoogle(o.googleBusiness, id)
      return { json: { configure: true, connecte: !!j, ...(j ? { connecteLe: j.connecteLe, fiche: !!(o.googleBusiness.emplacement ?? j.emplacement) } : {}) } }
    }

    if (sous === 'google' && sousId === 'auth' && !action && m === 'GET') {
      // Lien vers l'écran de consentement Google (scope business.manage, refresh token demandé). Le front appelle
      // `?format=json` avec sa session et ouvre l'URL reçue ; sinon redirection 302 directe.
      await exigerCommercant(req, id)
      const g = exigerGoogle()
      const t = maintenant()
      for (const [n, fin] of etatsGoogle) if (fin <= t.getTime()) etatsGoogle.delete(n)
      const { etat, nonce } = signerEtat(g.clientSecret, id, t)
      etatsGoogle.set(nonce, t.getTime() + 10 * 60_000)
      const url = urlAutorisation(g, redirectionGoogle(g, req, id), etat)
      const format = new URL(req.url ?? '/', 'http://localhost').searchParams.get('format')
      return format === 'json' ? { json: { url } } : { redirection: url }
    }

    if (sous === 'google' && sousId === 'callback' && !action && m === 'GET') {
      // PUBLIC — retour de Google après le consentement. Le `state` signé (commerce + nonce à usage unique, 10 min)
      // prouve que la connexion a été lancée par le gérant de CE commerce. Jetons rangés côté serveur, jamais renvoyés.
      limiterIp(req, 'lecture', limites.lectureParIp)
      const g = exigerGoogle()
      const q = new URL(req.url ?? '/', 'http://localhost').searchParams
      const etat = lireEtat(g.clientSecret, q.get('state') ?? '', maintenant())
      if (!etat || etat.commerceId !== id || !etatsGoogle.delete(etat.nonce)) {
        throw err(400, 'Lien de connexion Google invalide ou expiré : relancez « Connecter Google » depuis l’écran Avis.')
      }
      const site = sitePublic(req)
      if (q.get('error')) return { redirection: `${site}/#/avis/google-refuse` }
      const code = q.get('code')
      if (!code) throw err(400, 'Réponse de Google sans code d’autorisation : relancez « Connecter Google ».')
      const jetons = await echangerCode(g, fetchGoogle, code, redirectionGoogle(g, req, id), maintenant())
      await ecrireJetonsGoogle(g, id, jetons)
      await journaliser(id, { type: 'gerant', nom: 'Gérant' }, 'avisGoogle', 'Google Business Profile connecté (consentement donné sur Google)')
      return { redirection: `${site}/#/avis/google-connecte` }
    }

    if (sous === 'google' && sousId === 'deconnecter' && !action && m === 'POST') {
      // Révocation chez Google (best-effort) puis suppression des jetons rangés ici.
      const auteur = await exigerCommercant(req, id)
      const g = exigerGoogle()
      const j = await lireJetonsGoogle(g, id)
      const revoque = j ? await revoquerJeton(fetchGoogle, j.refreshToken) : false
      await ecrireJetonsGoogle(g, id, null)
      if (j) await journaliser(id, { type: 'gerant', nom: auteur }, 'avisGoogle', `Google Business Profile déconnecté${revoque ? ' (accès révoqué chez Google)' : ' (révocation chez Google non confirmée)'}`)
      return { json: { ok: true, revoque } }
    }

    if (sous === 'google' && sousId === 'import-avis' && !action && m === 'POST') {
      // Import des avis de la fiche : déduplication par identifiant Google, avis saisis à la main et brouillons
      // préservés, règles appliquées (auto 5★, brouillon sinon). Seule la réponse auto 5★ est publiée d'office, et
      // seulement si la règle est active ; tout le reste attend une validation manuelle.
      const auteur = await exigerCommercant(req, id)
      const g = exigerGoogle()
      // GOOGLE_BUSINESS_LOCATION mal renseignée → 409 explicite AVANT tout appel à Google (même le
      // rafraîchissement du jeton) ; sinon fiche mémorisée, sinon recherche parmi les fiches du compte.
      let emplacement = emplacementAImporter(g.emplacement, (await lireJetonsGoogle(g, id))?.emplacement)
      let jetons = await accesGoogle(g, id)
      if (!emplacementValide(emplacement)) {
        emplacement = await trouverEmplacement(fetchGoogle, jetons.accessToken, placeIdDuLien(commerce.lienGoogle))
        jetons = { ...jetons, emplacement }
        await ecrireJetonsGoogle(g, id, jetons)
      }
      const bruts = await listerAvisGoogle(fetchGoogle, jetons.accessToken, emplacement)
      const fusion = await st.transaction(async () => {
        const r = fusionnerImport(await st.avis(id), bruts, commerce)
        let ajoutes = 0
        for (const a of r.nouveaux) {
          try {
            await st.ajouterAvis(a)
            ajoutes++
          } catch (e) {
            // Import simultané : l'autre a déjà rangé cet avis (même identifiant).
            if (!(e instanceof ErreurConflit)) throw e
          }
        }
        for (const a of r.modifies) await st.majAvis(a)
        return { importes: ajoutes, misAJour: r.modifies.length, ignores: r.ignores }
      })
      let publiees = 0
      const echecs: string[] = []
      // Publication d'office limitée aux avis postés APRÈS la connexion : le premier import ne répond pas en rafale à
      // tout l'historique (ces réponses restent préparées, publiables d'un tap après relecture).
      const nouveauxDepuisConnexion = (x: Avis) => x.date >= jetons.connecteLe
      for (const a of (await st.avis(id)).filter((x) => nouveauxDepuisConnexion(x) && publicationAutomatique(x, commerce))) {
        try {
          await publierSurGoogle(jetons.accessToken, a)
          publiees++
        } catch (e) {
          // La réponse reste « préparée » : publiable plus tard depuis l'écran Avis.
          echecs.push(e instanceof Error ? e.message : String(e))
        }
      }
      await journaliser(
        id,
        { type: 'gerant', nom: auteur },
        'avisGoogle',
        `Import Google : ${fusion.importes} nouvel(s) avis, ${fusion.misAJour} mis à jour, ${publiees} réponse(s) auto 5★ publiée(s)${echecs.length ? `, ${echecs.length} échec(s) de publication` : ''}`,
      )
      return { json: { ...fusion, publiees, echecsPublication: echecs.length, ...(echecs.length ? { erreurPublication: echecs[0] } : {}), avis: await st.avis(id) } }
    }

    if (sous === 'avis' && sousId && action === 'publier-reponse' && !extra && m === 'POST') {
      // Publication d'une réponse sur Google : réponse validée à la main, ou réponse auto de la règle 5★ active.
      // Brouillon non validé, réponse auto hors règle 5★, avis saisi à la main → 409, rien n'est envoyé.
      const auteur = await exigerCommercant(req, id)
      const g = exigerGoogle()
      const a = await st.unAvis(id, sousId)
      if (!a) throw err(404, 'Avis inconnu dans ce commerce.')
      const refus = refusPublication(a, commerce)
      if (refus) throw err(409, refus)
      const { accessToken } = await accesGoogle(g, id)
      const avis = await publierSurGoogle(accessToken, a)
      await journaliser(id, { type: 'gerant', nom: auteur }, 'avisGoogle', `Réponse publiée sur Google (avis ${a.note}★ de ${a.auteur})`)
      return { json: { avis } }
    }

    if (sous === 'avis' && !sousId && m === 'POST') {
      await exigerCommercant(req, id)
      const corps = await lireCorps(req)
      const note = corps.note
      if (typeof note !== 'number' || !Number.isInteger(note) || note < 1 || note > 5) throw err(400, '« note » doit être un nombre entier de 1 à 5.')
      let date = maintenant().toISOString()
      if (corps.date != null) {
        const d = new Date(texte(corps.date, 'date', 40))
        if (Number.isNaN(d.getTime())) throw err(400, '« date » doit être une date ISO (2026-11-09T12:00:00Z).')
        date = d.toISOString()
      }
      const brut: Avis = {
        id: `av-${randomUUID()}`,
        commerceId: id,
        auteur: texte(corps.auteur, 'auteur', 60, { requis: true }),
        note,
        texte: texte(corps.texte ?? '', 'texte', 2000),
        date,
        source: 'manuel',
      }
      const avis = appliquerRegles(brut, commerce)
      await st.ajouterAvis(avis)
      return { statut: 201, json: { avis } }
    }

    if (sous === 'avis' && sousId && !action && m === 'PATCH') {
      await exigerCommercant(req, id)
      const corps = await lireCorps(req)
      const inconnus = Object.keys(corps).filter((k) => k !== 'reponse' && k !== 'brouillon')
      if (inconnus.length) throw err(400, `Champ non modifiable : ${inconnus.join(', ')}.`)
      const avis = await st.transaction(async () => {
        const a = await st.unAvis(id, sousId)
        if (!a) throw err(404, 'Avis inconnu dans ce commerce.')
        const r: Avis = { ...a }
        if ('brouillon' in corps) {
          const b = corps.brouillon === null ? '' : texte(corps.brouillon, 'brouillon', 2000)
          if (b) r.brouillon = b
          else delete r.brouillon
        }
        if ('reponse' in corps) {
          const rep = corps.reponse === null ? '' : texte(corps.reponse, 'reponse', 2000)
          // Réponse modifiée : la version publiée sur Google n'est plus à jour (à republier).
          if (rep !== (a.reponse ?? '')) delete r.reponsePublieeLe
          delete r.reponseAuto
          if (rep) {
            r.reponse = rep
            r.reponseAuto = false
            delete r.brouillon
          } else delete r.reponse
        }
        const final = appliquerRegles(r, commerce)
        await st.majAvis(final)
        return final
      })
      return { json: { avis } }
    }

    throw err(404, 'Route inconnue.')
  }

  /**
   * Chemin avec identifiants porteurs masqués, pour les logs d'erreur (P2-S15, revue Codex point 2) : un
   * identifiant de carte ou un jeton de désinscription ne doit pas apparaître en clair dans `console.error`
   * quand une exception non HTTP survient sur ces routes. Même marche que les logs JSON
   * (`cheminMasquePourErreur`, `server/logs.ts`), avec `…` au lieu de l'empreinte (format historique).
   * Le message de l'exception elle-même n'est pas masqué (les erreurs de stockage n'y incluent pas
   * d'identifiant aujourd'hui).
   */
  const masquerIdentifiantsChemin = (pathname: string) => cheminMasquePourErreur(pathname, idsCommercesConnus)

  const serveur = createServer(async (req, res) => {
    const debutRequete = Date.now()
    // P2-Q6 : l'IP est lue à la réception, quand le socket existe encore — au moment de `finish` il
    // peut déjà être détruit (corps abandonné après une 413, par exemple), et `req.socket` vaut `null`.
    const ipRequete = ipDe(req)
    // Une ligne JSON par réponse terminée (niveau, horodatage, route masquée, statut, durée). `finish` se
    // déclenche quand la réponse est envoyée, quel que soit le chemin de sortie (succès, erreur, 304,
    // redirection, statique) ; la ligne n'est jamais émise deux fois pour une même requête. Une connexion
    // interrompue avant la fin de la réponse ne produit aucune ligne (son statut serait inconnu). Le bloc
    // entier est protégé : une défaillance de journalisation ne doit jamais faire échouer une requête.
    res.on('finish', () => {
      try {
        let pathname = '/'
        try {
          pathname = new URL(req.url ?? '/', 'http://localhost').pathname
        } catch {
          pathname = '/'
        }
        journaliserRequete({ methode: req.method ?? '?', pathname, statut: res.statusCode, dureeMs: Date.now() - debutRequete, ip: ipRequete, commercesConnus: idsCommercesConnus })
        alertes5xx.enregistrer(res.statusCode, () => routeMasquee(pathname, idsCommercesConnus))
      } catch {
        // La journalisation ne doit jamais faire échouer une requête.
      }
    })
    const entetes: Record<string, string> = { ...ENTETES_SECURITE, ...entetesCors(origineCors, req.headers.origin) }
    const url = new URL(req.url ?? '/', 'http://localhost')
    // P2-S15 : le routeur a-t-il répondu (pour ne pas journaliser deux fois une lecture dont l'envoi échoue).
    let routeurTermine = false
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, entetes).end()
        return
      }
      // Lien court des SMS de relance (P1-B3) : /c/<clientId> → la carte du client (#/carte/<clientId>). Sans jeton, la
      // page n'en reçoit que la vue limitée (P0-S7). `?a=<lien d'accès>` (SMS « Retrouver ma carte ») : transmis à la
      // page, qui l'échange contre un jeton ; dans le fragment, il n'est jamais renvoyé à un serveur.
      const court = /^\/c\/([\w-]{1,80})$/.exec(url.pathname)
      if (court && (req.method === 'GET' || req.method === 'HEAD')) {
        const a = url.searchParams.get('a')
        const acces = a && /^[\w.-]{1,2048}$/.test(a) ? `?acces=${a}` : ''
        res.writeHead(302, { ...entetes, Location: `/#/carte/${court[1]}${acces}`, 'Cache-Control': 'no-store' }).end()
        return
      }
      // Lien court de désinscription des SMS de relance (P1-B9) : /d/<clientId>/<jeton> → la page de désinscription
      // (#/desinscription/<clientId>/<jeton>). Le jeton n'est pas vérifié ici : c'est la page qui appelle
      // POST /api/v1/desinscription/… (HMAC, idempotent), après un clic de confirmation.
      const courtDesinscription = /^\/d\/([\w-]{1,80})\/([A-Za-z0-9_-]{16,64})$/.exec(url.pathname)
      if (courtDesinscription && (req.method === 'GET' || req.method === 'HEAD')) {
        res.writeHead(302, { ...entetes, Location: `/#/desinscription/${courtDesinscription[1]}/${courtDesinscription[2]}`, 'Cache-Control': 'no-store' }).end()
        return
      }
      // Lien court du QR vitrine (P2-Q3) : /r/<commerceId> → la page de jeu (#/jouer/<id>). Le scan est compté ici,
      // AVANT la redirection : il l'est donc même si la page ne se charge jamais (réseau coupé, serveur endormi,
      // navigateur qui abandonne). Anonyme comme POST /evenements : un compteur par jour, sans identité ni IP
      // stockée ; même limite par IP (dépassée, on redirige quand même sans compter — jamais d'erreur affichée au
      // client). HEAD : sonde, pas comptée. Commerce inconnu ou en pause : redirection sans compteur (la page
      // affiche « fermé »). `?via=qr` dit à la page de ne pas re-signaler le scan (sinon double comptage).
      const courtJeu = /^\/r\/([\w-]{1,80})$/.exec(url.pathname)
      if (courtJeu && (req.method === 'GET' || req.method === 'HEAD')) {
        if (req.method === 'GET') {
          let compterCeScan = true
          try {
            limiterIp(req, 'evenement', limites.evenementParIp)
          } catch {
            compterCeScan = false
          }
          if (compterCeScan) {
            let commerce: Commerce | null = null
            try {
              commerce = (await st.commerce(courtJeu[1])) ?? null
            } catch {
              commerce = null // base en panne : on redirige quand même, sans compter
            }
            if (commerce?.actif) await compter(courtJeu[1], 'scan')
          }
        }
        res.writeHead(302, { ...entetes, Location: `/?via=qr#/jouer/${courtJeu[1]}`, 'Cache-Control': 'no-store' }).end()
        return
      }
      // Page publique prérendue (P2-Q4) : /menu/<commerceId> — le menu en HTML statique, lisible par les moteurs
      // de recherche (la SPA vit dans le fragment, invisible d'eux). Rendu à la demande, cache 5 min en mémoire
      // (le menu change rarement ; un changement met 5 min à apparaître ici comme chez les robots) ; ETag faible
      // sur le contenu (304 si repris). Limite par IP comme les autres lectures publiques. Commerce inconnu (ou
      // /menu sans id) : 404, pas la SPA en 200 (soft 404) ; commerce en pause : page « indisponible » (noindex).
      // Slash final accepté (/menu/<id>/) ; toute autre adresse sous /menu/ (/menu/a/b, /menu/%20) : 404 aussi
      // (revue Codex : ces formes retombaient sur la SPA en 200).
      const pageMenu = /^\/menu(?:\/([\w-]{1,80}))?\/?$/.exec(url.pathname)
      const menuInvalide = url.pathname.startsWith('/menu/') && !pageMenu
      if ((pageMenu || menuInvalide) && (req.method === 'GET' || req.method === 'HEAD')) {
        limiterIp(req, 'lecture', limites.lectureParIp)
        const site = sitePublic(req)
        const id = pageMenu?.[1]
        let page = id ? cachePrerendu.get(id) : undefined
        if (page && page.expire <= Date.now()) {
          if (id) cachePrerendu.delete(id) // page en cache ⇒ id défini
          page = undefined
        }
        if (!page) {
          let html: string
          let statut = 200
          if (!id) {
            html = pageNonTrouvee(site)
            statut = 404
          } else {
            let commerce: Commerce | null = null
            try {
              commerce = (await st.commerce(id)) ?? null
            } catch {
              commerce = null
            }
            if (!commerce) {
              html = pageNonTrouvee(site)
              statut = 404
            } else if (!commerce.actif) {
              html = pageMenuIndisponible(commerce, site)
            } else {
              const menuStocke = (await st.menu(id)) ?? { commerceId: id, categories: [], majLe: '' }
              html = pageMenuPrerendue(commerce, menuAffichePour(commerce, menuStocke), site)
            }
          }
          const etagPage = `W/"${createHash('sha256').update(html).digest('hex').slice(0, 16)}"`
          page = { html, etag: etagPage, statut, expire: Date.now() + 300_000 }
          if (statut === 200 && id) {
            if (cachePrerendu.size >= 64) cachePrerendu.clear()
            cachePrerendu.set(id, page)
          }
        }
        const cache = page.statut === 200 ? 'public, max-age=300' : 'no-store'
        const communs = { ...entetes, 'Cache-Control': cache, ETag: page.etag }
        if (etagCorrespond(req.headers['if-none-match'], page.etag)) {
          res.writeHead(304, communs).end()
          return
        }
        if (req.method === 'HEAD') {
          const prep = preparerCorps(req, communs, 'text/html; charset=utf-8', Buffer.from(page.html))
          res.writeHead(page.statut, prep.entetes).end()
          return
        }
        envoyerCorps(req, res, page.statut, communs, 'text/html; charset=utf-8', Buffer.from(page.html))
        return
      }
      if (!url.pathname.startsWith('/api/v1/') && url.pathname !== '/api/v1') {
        if (o.dossierStatique && (req.method === 'GET' || req.method === 'HEAD') && !url.pathname.startsWith('/api/')) {
          if (servirStatique(o.dossierStatique, url.pathname, req, res, entetes)) return
        }
        throw err(404, 'Route inconnue.')
      }
      const chemin = url.pathname.slice('/api/v1/'.length).split('/').filter(Boolean).map(decodeURIComponent)
      const r = await router(req, chemin)
      routeurTermine = true
      // P2-S15 : échantillon des lectures sensibles (énumération détectable dans les logs).
      const commercesLus = (r.json as { commerces?: unknown[] } | undefined)?.commerces
      journaliserLectureSensible(req, chemin, r.statut ?? 200, Array.isArray(commercesLus) ? `nb=${commercesLus.length}` : undefined)
      if (r.redirection) {
        res.writeHead(302, { ...entetes, Location: r.redirection, 'Cache-Control': 'no-store' }).end()
        return
      }
      if (r.csv) {
        // Export téléchargeable, comme le JSON : compressé si le client l'accepte (revue Codex P2-Q2).
        envoyerCorps(
          req,
          res,
          200,
          {
            ...entetes,
            'Content-Disposition': `attachment; filename="${r.csv.nom.replace(/[^\w.-]/g, '_')}"`,
            'Cache-Control': 'no-store',
          },
          'text/csv; charset=utf-8',
          Buffer.from(r.csv.contenu),
        )
        return
      }
      if (r.fichier) {
        res.writeHead(200, {
          ...entetes,
          'Content-Type': r.fichier.type,
          'Content-Length': String(r.fichier.octets.length),
          'Content-Disposition': `attachment; filename="${r.fichier.nom.replace(/[^\w.-]/g, '_')}"`,
          'Cache-Control': 'no-store',
        })
        res.end(r.fichier.octets)
        return
      }
      if (r.image) {
        const communs = { ...entetes, 'Cache-Control': r.image.cache, ETag: r.image.etag }
        if (etagCorrespond(req.headers['if-none-match'], r.image.etag)) {
          res.writeHead(304, communs).end()
          return
        }
        res.writeHead(200, { ...communs, 'Content-Type': r.image.type, 'Content-Length': String(r.image.octets.length) })
        res.end(r.image.octets)
        return
      }
      if (r.xml != null) {
        envoyerCorps(req, res, r.statut ?? 200, { ...entetes, 'Cache-Control': 'no-store' }, 'text/xml; charset=utf-8', Buffer.from(r.xml))
        return
      }
      envoyerCorps(req, res, r.statut ?? 200, { ...entetes, 'Cache-Control': 'no-store' }, 'application/json; charset=utf-8', Buffer.from(JSON.stringify(r.json)))
    } catch (erreur) {
      // Conflit d'écriture (doublon refusé par la base, ligne modifiée entre-temps) : 409, l'utilisateur peut réessayer.
      const e =
        erreur instanceof ErreurConflit
          ? err(409, 'Modification simultanée : réessayez.')
          : erreur instanceof ErreurMigrationManquante
            ? err(503, erreur.message)
            : erreur instanceof ErreurGoogle
              ? err(erreur.statut, erreur.message)
              : erreur
      const http = e instanceof ErreurHttp
      if (!http) console.error(`[serveur] ${req.method} ${masquerIdentifiantsChemin(url.pathname)} :`, e)
      const statut = http ? e.statut : 500
      // P2-S15 : lectures sensibles en échec (404 / 429 : signaux d'énumération) — seulement si l'erreur vient
      // du routeur (sinon la lecture a déjà été journalisée au retour du routeur, ci-dessus). Même décodage
      // que le chemin du succès (empreinte identique en succès et en échec, revue Codex point 1) ; encodage
      // invalide : pas de journalisation plutôt qu'une 500 de plus.
      if (!routeurTermine) {
        let cheminErreur: string[] = []
        try {
          cheminErreur = url.pathname.startsWith('/api/v1/') ? url.pathname.slice('/api/v1/'.length).split('/').filter(Boolean).map(decodeURIComponent) : []
        } catch {
          cheminErreur = []
        }
        journaliserLectureSensible(req, cheminErreur, statut)
      }
      envoyerCorps(
        req,
        res,
        statut,
        { ...entetes, ...(http ? e.entetes : {}), 'Cache-Control': 'no-store' },
        'application/json; charset=utf-8',
        Buffer.from(JSON.stringify({ erreur: http ? e.message : 'Erreur interne du serveur.' })),
      )
    }
  })

  return {
    serveur,
    /** Attend la fin des tournées de relances automatiques en cours (tests). */
    relancesEnCours: () => Promise.all([...tourneesEnCours]).then(() => undefined),
    async fermer() {
      clearInterval(nettoyage)
      await Promise.all([...tourneesEnCours])
      serveur.closeAllConnections()
      await new Promise<void>((ok) => serveur.close(() => ok()))
      await st.fermer()
    },
  }
}

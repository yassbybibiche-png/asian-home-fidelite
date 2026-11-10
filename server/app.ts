// API REST /api/v1 (module `node:http`, aucune dépendance npm).
// Les règles métier ne sont PAS réécrites ici : elles viennent de `src/lib/*` (les mêmes que le front).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash, createHmac, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'

import type { Apparence, Avis, Client, Commerce, DemandeRattrapage, EntreeJournal, EnvoiRelance, Lot, MembreEquipe, ModeleRelance, Parrainage, RecompensePoints, ReglesMessages, StatutEnvoi, Tirage, TypeCommerce } from '../src/types.ts'
import { nouveauCommerce, TYPES_COMMERCE } from '../src/data/defaults.ts'
import { seedRecale } from '../src/data/depot.ts'
import seed from '../src/data/seed.json' with { type: 'json' }
import { analyserContact, cleContact, nouveauClient, offrirRecompense, recompenseDebloquee, tamponsAffiches } from '../src/lib/fidelite.ts'
import { canalDuClient, emailRelance, estModeleRelance, estMotStop, jourParis, lienCarte, lienCourtCarte, MODELES_RELANCE, relanceAutoDue, smsRelance } from '../src/lib/relances.ts'
import { estPerdant, lotsJouables, messageGain, normaliserCodeGagnant, statutGain, statutJeu, tirageDuCode, tirageDuJour, tirerLot } from '../src/lib/roulette.ts'
import { appliquerRegles } from '../src/lib/avis.ts'
import { clientsEnCsv } from '../src/lib/csv.ts'
import { actionDejaTraitee, avecAction, echangerPoints, formaterPrix, soldePoints } from '../src/lib/points.ts'
import { analyserAnniversaire, clientsCibles, deposerMessage, genererMessages, marquerLus, TYPES_MESSAGES, type Cible, type Evenement } from '../src/lib/messages.ts'
import {
  appliquerInscription,
  appliquerRattrapageValide,
  appliquerVisiteProgramme,
  consommerRecompenseEnAttente,
  genererCodeParrainage,
  niveauClient,
  parrainageDu,
  passageAvecProgramme,
  peutCompleterProfil,
  rattrapageRecevable,
  utiliserReserve,
  validerProgramme,
  type EvenementPassage,
} from '../src/lib/programme.ts'
import { problemesApparence } from '../src/lib/apparence.ts'
import { commercePublic } from '../src/lib/vuePublique.ts'
import { ErreurMenu, validerMenu } from '../src/lib/menu.ts'
import { ErreurConflit, ErreurMigrationManquante, ouvrirStockage, type Pin, type PorteeAuth, type Stockage } from './stockage.ts'
import { ouvrirStockageSupabase, type ConfigSupabase } from './stockage-supabase.ts'
import { ErreurWallet, lienGoogleWallet, walletConfigure, type ConfigGoogleWallet } from './wallet.ts'
import { creerNotifications, ErreurNonBranche, type Canal, type ConfigNotifications, type Message } from './notifications/index.ts'

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
  /** POST /commerces/:id/clients/:clientId/profil et …/rattrapage (demande du client) — par IP. */
  ficheClientParIp: 10,
  /**
   * POST /sessions (échange PIN → jeton) — par IP, en plus du blocage sur PIN faux ci-dessous. Borne le coût scrypt ;
   * large car toute l'équipe ouvre sa session depuis le même wifi en début de service.
   */
  sessionParIp: 30,
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
  /** Secret de signature des jetons de session (SESSION_SECRET) ; absent = POST /sessions répond 503, le PIN en en-tête reste accepté. */
  secretSession?: string
  /** Seuils des routes publiques, si différents de LIMITES_PUBLIQUES (tests). */
  limitesPubliques?: Partial<LimitesPubliques>
  /** Horloge injectable (tests). */
  maintenant?: () => Date
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
  /** Expiration, en secondes unix. */
  exp: number
}

const DUREE_SESSION_S: Record<RoleSession, number> = { commerce: 8 * 3600, admin: 8 * 3600, equipe: 12 * 3600 }

const signature = (secret: string, charge: string) => createHmac('sha256', secret).update(charge).digest()

export function emettreJeton(secret: string, c: ChargeSession): string {
  const charge = Buffer.from(JSON.stringify(c)).toString('base64url')
  return `v1.${charge}.${signature(secret, charge).toString('base64url')}`
}

/** Jeton bien formé et signé par ce secret (l'expiration et la révocation sont vérifiées à part) ; sinon null. */
export function lireJeton(secret: string, jeton: string): ChargeSession | null {
  const parties = jeton.split('.')
  if (parties.length !== 3 || parties[0] !== 'v1' || jeton.length > 2048) return null
  if (!egaux(Buffer.from(parties[2], 'base64url'), signature(secret, parties[1]))) return null
  try {
    const c = JSON.parse(Buffer.from(parties[1], 'base64url').toString('utf8')) as ChargeSession
    const roleOk = c.role === 'admin' || ((c.role === 'commerce' || c.role === 'equipe') && typeof c.commerceId === 'string')
    if (!roleOk || typeof c.jti !== 'string' || !Number.isInteger(c.exp) || (c.role === 'equipe' && typeof c.membreId !== 'string')) return null
    return c
  } catch {
    return null
  }
}

// ---------- Anti-abus des routes publiques (en mémoire, fenêtres fixes d'une minute) ----------

/** Compteurs par clé (`<catégorie>:<ip>`, `carte:<id>`, `inscription:<commerce>:<contact>`…) ; perdus au redémarrage, sans gravité à la minute. */
function creerCompteursPublics(maintenant: () => Date) {
  const fenetres = new Map<string, { debut: number; n: number }>()
  return {
    /** Compte une requête ; au-delà de `max` dans la fenêtre en cours → 429 avec Retry-After (secondes restantes). */
    consommer(cle: string, max: number, motif: string) {
      const t = maintenant().getTime()
      let f = fenetres.get(cle)
      if (!f || t - f.debut >= FENETRE_PUBLIQUE_MS || t < f.debut) {
        f = { debut: t, n: 0 }
        fenetres.set(cle, f)
      }
      f.n++
      if (f.n > max) {
        const s = Math.max(1, Math.ceil((f.debut + FENETRE_PUBLIQUE_MS - t) / 1000))
        throw new ErreurHttp(429, `${motif} Réessayez dans ${s} s.`, { 'Retry-After': String(s) })
      }
    },
    purger() {
      const t = maintenant().getTime()
      for (const [cle, f] of fenetres) if (t - f.debut >= FENETRE_PUBLIQUE_MS || t < f.debut) fenetres.delete(cle)
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
    async verifier(cles: string[]) {
      const t = maintenant().getTime()
      let fin = 0
      for (const cle of cles) fin = Math.max(fin, (await charger(cle)).bloqueJusqua)
      if (fin > t) {
        const s = Math.ceil((fin - t) / 1000)
        throw new ErreurHttp(429, `Trop de PIN incorrects. Réessayez dans ${Math.ceil(s / 60)} min.`, { 'Retry-After': String(s) })
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

function lien(v: unknown): string {
  const s = texte(v, 'lienGoogle', 500)
  if (s && !/^https?:\/\/\S+$/i.test(s)) throw err(400, '« lienGoogle » doit être une adresse web (https://…).')
  return s
}

function typeCommerce(v: unknown): TypeCommerce {
  const t = TYPES_COMMERCE.find((x) => x.valeur === v)
  if (!t) throw err(400, `« type » doit valoir : ${TYPES_COMMERCE.map((x) => x.valeur).join(', ')}.`)
  return t.valeur
}

function lots(v: unknown): Lot[] {
  if (!Array.isArray(v) || v.length > 12) throw err(400, '« lots » doit être une liste de 12 lots maximum.')
  const liste = v.map((l: unknown, i) => {
    const o = (l ?? {}) as Corps
    const p = o.probabilite
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 100) throw err(400, `Lot n° ${i + 1} : la probabilité doit être un nombre entre 0 et 100.`)
    return { libelle: texte(o.libelle, `lot n° ${i + 1}`, 80), probabilite: p }
  })
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

const CHAMPS_REGLAGES = ['nom', 'type', 'logo', 'lienGoogle', 'coordonnees', 'recompense', 'seuilTampons', 'lots', 'reglesReponseAuto', 'actif', 'eurosParPoint', 'catalogue', 'messagesAuto', 'apparence', 'programme', 'relancesAuto']

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
function appliquerReglages(c: Commerce, corps: Corps, autorises = CHAMPS_REGLAGES): Commerce {
  const inconnus = Object.keys(corps).filter((k) => !autorises.includes(k))
  if (inconnus.length) throw err(400, `Champ non modifiable : ${inconnus.join(', ')}.`)
  const r: Commerce = { ...c }
  if ('nom' in corps) r.nom = texte(corps.nom, 'nom', 80, { requis: true })
  if ('type' in corps) r.type = typeCommerce(corps.type)
  if ('logo' in corps) r.logo = texte(corps.logo, 'logo', 500)
  if ('lienGoogle' in corps) r.lienGoogle = lien(corps.lienGoogle)
  if ('coordonnees' in corps) r.coordonnees = texte(corps.coordonnees, 'coordonnees', 300)
  if ('recompense' in corps) r.recompense = texte(corps.recompense, 'recompense', 120, { requis: true })
  if ('seuilTampons' in corps) {
    const s = corps.seuilTampons
    if (typeof s !== 'number' || !Number.isInteger(s) || s < 1 || s > 50) throw err(400, '« seuilTampons » doit être un nombre entier entre 1 et 50.')
    r.seuilTampons = s
  }
  if ('lots' in corps) r.lots = lots(corps.lots)
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
    const inconnus = Object.keys(o).filter((k) => k !== 'inactif' && k !== 'anniversaire')
    if (inconnus.length) throw err(400, `« relancesAuto » : champ inconnu (${inconnus.join(', ')}).`)
    r.relancesAuto = { inactif: booleen(o.inactif ?? false, 'inactif'), anniversaire: booleen(o.anniversaire ?? false, 'anniversaire') }
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
  const { telephone: _t, email: _e, actionsTraitees: _a, clesMessages: _k, ...reste } = c
  return reste
}

/** Client vu en caisse : contact (pour la recherche) et soldes, sans la boîte de réception ni les données techniques. */
function clientCaisse(c: Client) {
  const { messages: _m, clesMessages: _k, actionsTraitees: _a, ...reste } = c
  return reste
}

/** Gain vu en caisse (P0-U3) : de quoi reconnaître le client (prénom seul, jamais son contact) et l'état du code. */
function gainCaisse(t: Tirage, client: Client | undefined, maintenant: Date) {
  return {
    code: t.code ?? '',
    lot: t.lot,
    date: t.date,
    statut: statutGain(t, maintenant),
    client: client ? { id: client.id, prenom: client.prenom } : null,
    remis: t.remis ? { le: t.remis.le, par: t.remis.par.nom } : null,
  }
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
    'Access-Control-Allow-Headers': 'Content-Type, X-Session, X-Commerce-PIN, X-Admin-PIN, X-Equipe-Code',
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
  const cache =
    fichier === join(racine, 'index.html')
      ? 'no-cache' // toujours revérifié (ETag → 304) : un nouveau déploiement est pris dès le rechargement
      : asset
        ? CACHE_IMMUABLE
        : CACHE_VISUELS
  const communs = { ...entetes, 'Cache-Control': cache, ETag: balise }
  if (etagCorrespond(req.headers['if-none-match'], balise)) {
    res.writeHead(304, communs).end()
    return true
  }
  res.writeHead(200, { ...communs, 'Content-Type': TYPES_MIME[extname(fichier)] ?? 'application/octet-stream' })
  res.end(readFileSync(fichier))
  return true
}

// ---------- Serveur ----------

const TAILLE_MAX_CORPS = 64 * 1024
/** Le menu peut contenir des photos compressées (60 Ko chacune au plus). */
const TAILLE_MAX_MENU = 3 * 1024 * 1024

async function lireBrut(req: IncomingMessage, max: number): Promise<string> {
  let taille = 0
  const morceaux: Buffer[] = []
  for await (const m of req) {
    taille += (m as Buffer).length
    if (taille > max) throw err(413, 'Requête trop volumineuse.')
    morceaux.push(m as Buffer)
  }
  return Buffer.concat(morceaux).toString('utf8')
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
  // Supabase seulement s'il est configuré ; sinon SQLite local (dev, tests, comportement d'avant S1).
  const st: Stockage = o.supabase ? ouvrirStockageSupabase(o.supabase) : ouvrirStockage(o.fichierDb)
  try {
    await initialiser(st, o)
  } catch (e) {
    await st.fermer()
    throw e
  }
  const maintenant = o.maintenant ?? (() => new Date())
  const limiteur = creerLimiteurAuth(st, maintenant)
  const compteurs = creerCompteursPublics(maintenant)
  const limites: LimitesPubliques = { ...LIMITES_PUBLIQUES, ...o.limitesPubliques }
  const nettoyage = setInterval(() => {
    compteurs.purger()
    limiteur.purger()
  }, FENETRE_PUBLIQUE_MS)
  nettoyage.unref()
  // En mémoire seulement : haché directement en scrypt à chaque démarrage.
  const adminPin = await hacherPin(o.adminPin)
  const notifications = creerNotifications(o.notifications)
  const integrations = () => ({
    googleWallet: walletConfigure(o.googleWallet),
    appleWallet: 'en_suspens',
    googleBusinessProfile: false,
    ...notifications.statut(),
  })

  const ipDe = (req: IncomingMessage) =>
    (o.derriereProxy && String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()) || req.socket.remoteAddress || '?'

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

  /** Re-hachage scrypt d'un hash ancien format après un accès réussi : best-effort, ne fait jamais échouer l'accès. */
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
    const r = await pinCorrect(pin, await st.pin(commerceId))
    if (!r.ok) {
      await limiteur.echec(echecs(ip, commerceId), 'commerce')
      throw err(401, 'PIN commerçant incorrect.')
    }
    await limiteur.succes(cleIp(ip))
    if (r.rehacher) await rehacher(pin, (p) => st.majPin(commerceId, p))
  }

  async function verifierCodeEquipe(ip: string, commerceId: string, code: string): Promise<MembreEquipe> {
    await limiteur.verifier(cles(ip, commerceId))
    let trouve: { membre: MembreEquipe; rehacher: boolean } | undefined
    if (CODE_EQUIPE.test(code)) {
      const membres = await st.membres(commerceId)
      const resultats = await Promise.all(membres.map((m) => pinCorrect(code, m.code)))
      const i = resultats.findIndex((r) => r.ok)
      if (i >= 0) trouve = { membre: membres[i].membre, rehacher: resultats[i].rehacher }
    }
    if (!trouve) {
      if (!(await schemaCartiz())) throw new ErreurMigrationManquante('equipe')
      await limiteur.echec(echecs(ip, commerceId), 'equipe')
      throw err(401, 'Code équipe incorrect.')
    }
    await limiteur.succes(cleIp(ip))
    if (trouve.rehacher) await rehacher(code, (p) => st.majMembre(trouve.membre, p))
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

  async function estRevoquee(c: ChargeSession): Promise<boolean> {
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

  async function revoquer(c: ChargeSession) {
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

  /** Session de l'en-tête X-Session (absente → undefined). Jeton falsifié, expiré ou révoqué → 401. */
  async function session(req: IncomingMessage): Promise<ChargeSession | undefined> {
    const jeton = enTete(req, 'x-session')
    if (!jeton) return undefined
    const c = o.secretSession ? lireJeton(o.secretSession, jeton) : null
    if (!c) throw err(401, 'Session invalide : déverrouillez à nouveau.')
    if (c.exp * 1000 <= maintenant().getTime()) throw err(401, 'Session expirée : déverrouillez à nouveau.')
    if (await estRevoquee(c)) throw err(401, 'Session fermée : déverrouillez à nouveau.')
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
      if (corps.role === 'commerce') await verifierPinCommerce(ip, commerceId, secret(corps.pin, 'pin'))
      else {
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

  interface Tentative {
    http: number
    message: string
    envoi: EnvoiRelance
  }

  /**
   * Une tentative de relance, tracée dans `envois` quel qu'en soit le résultat :
   * 501 sans prestataire pour ce canal · 409 sans consentement, sans contact, ou déjà envoyée aujourd'hui (même modèle)
   * · 503 migration 0007 absente (rien ne part sans anti-doublon) · 502 prestataire en erreur · 200 envoyée.
   * L'envoi est RÉSERVÉ en base (`en_cours`) avant l'appel au prestataire : l'index unique empêche tout doublon.
   */
  async function relancer(
    commerce: Commerce,
    client: Client,
    demande: { modele: ModeleRelance | 'libre'; canal?: Canal; libre?: string; declencheur: EnvoiRelance['declencheur']; auteur: string },
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
      canal,
      statut: 'en_cours',
      declencheur: demande.declencheur,
      auteur: demande.auteur,
    }
    async function consigner(statut: StatutEnvoi, http: number, message: string): Promise<Tentative> {
      const e: EnvoiRelance = { ...envoi, statut, raison: message }
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
      if (e instanceof ErreurConflit) return consigner('refuse', 409, 'Cette relance a déjà été envoyée à ce client aujourd’hui : rien n’a été renvoyé.')
      throw e
    }

    const d = { client, commerce }
    let message: Message
    if (canal === 'sms') {
      message = { destinataire, texte: smsRelance(demande.modele, d, lienCourtCarte(site, client.id), demande.libre) }
    } else {
      const jeton = await jetonDesinscription(commerce.id, client.id)
      const e = emailRelance(demande.modele, d, { carte: lienCarte(site, client.id), desinscription: `${site}/#/desinscription/${client.id}/${jeton}` }, demande.libre)
      message = {
        destinataire,
        sujet: e.sujet,
        texte: e.texte,
        entetes: { 'List-Unsubscribe': `<${site}/api/v1/desinscription/${client.id}/${jeton}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      }
    }
    let fin: Tentative
    try {
      const r = await notifications.envoyer(canal, message)
      fin = { http: 200, message: 'Relance envoyée.', envoi: { ...envoi, statut: 'envoye', ...(r.id ? { idPrestataire: r.id } : {}) } }
    } catch (e) {
      const raison = e instanceof Error && e.message ? e.message : 'Le prestataire n’a pas répondu.'
      fin = { http: 502, message: `Relance non envoyée : ${raison}`, envoi: { ...envoi, statut: 'erreur', raison } }
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
  const tournees = new Map<string, string>()
  const tourneesEnCours = new Set<Promise<void>>()
  function lancerRelancesAuto(commerce: Commerce, site: string) {
    const regles = commerce.relancesAuto
    if (!regles?.inactif && !regles?.anniversaire) return
    const t = maintenant()
    const jour = jourParis(t)
    if (tournees.get(commerce.id) === jour) return
    tournees.set(commerce.id, jour)
    const p = (async () => {
      const branche = notifications.statut()
      // Rien de branché, ou migration 0007 absente : pas de tournée (et pas de 501 en série dans le journal).
      if ((!branche.sms && !branche.email) || !(await schemaRelances())) return
      for (const client of await st.clients(commerce.id)) {
        const canal = canalDuClient(client)
        if (client.consentementRelance !== true || !canal || !branche[canal]) continue
        const deja = await st.envois(commerce.id, 50, client.id)
        // Une seule relance automatique par client et par tournée : l'anniversaire passe avant.
        const modele = (['anniversaire', 'inactif'] as const).find((x) => regles[x] && relanceAutoDue(x, client, deja, t))
        if (modele) await relancer(commerce, client, { modele, declencheur: 'auto', auteur: 'Automatique' }, site)
      }
    })()
      .catch((e) => console.warn(`[relances] tournée automatique interrompue : ${e instanceof Error ? e.message : e}`))
      .finally(() => tourneesEnCours.delete(p))
    tourneesEnCours.add(p)
  }

  /** Messages automatiques dus pour cet événement (règles du commerce). */
  const avecMessages = (client: Client, commerce: Commerce, evenement: Evenement, t = maintenant()) =>
    genererMessages(client, commerce, evenement, t, nouvelIdMessage).client

  /** Heure réelle d'une action faite hors ligne : acceptée si elle date de moins de 72 h (sinon : maintenant). */
  function quandAction(v: unknown): Date {
    const t = maintenant()
    if (typeof v !== 'string') return t
    const d = new Date(v)
    const ecart = t.getTime() - d.getTime()
    return Number.isNaN(d.getTime()) || ecart > 72 * 3600_000 || ecart < -5 * 60_000 ? t : d
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

  async function clientOu404(commerceId: string, id: string): Promise<Client> {
    const c = await st.client(commerceId, id)
    if (!c) throw err(404, 'Client inconnu dans ce commerce.')
    return c
  }

  function exigerActif(c: Commerce) {
    if (!c.actif) throw err(409, 'Ce commerce n’est pas actif pour le moment.')
  }

  /**
   * Récompense de parrainage après la 1re visite du filleul (jamais à l'inscription).
   * À appeler dans la transaction du passage, une fois le filleul mis à jour : met à jour le parrain,
   * journalise des deux côtés et écrit la trace d'audit (0004, ignorée si la migration manque).
   * Retourne le filleul avec ses points de parrainage, et le texte à ajouter au journal du passage.
   */
  async function reglerParrainage(commerce: Commerce, filleulApres: Client, quand: Date): Promise<{ filleul: Client; texte: string }> {
    if (!filleulApres.parrainId || filleulApres.parrainagePaye) return { filleul: filleulApres, texte: '' }
    const parrain = await st.client(commerce.id, filleulApres.parrainId)
    if (!parrain) return { filleul: filleulApres, texte: '' }
    const r = parrainageDu(filleulApres, parrain, commerce, quand)
    if (!r) return { filleul: filleulApres, texte: '' }
    const pointsFilleul = soldePoints(r.filleul) - soldePoints(filleulApres)
    const pointsParrain = r.parrain ? soldePoints(r.parrain) - soldePoints(parrain) : 0
    const texte = r.parrain
      ? `Parrainage : +${pointsFilleul} points pour ${filleulApres.prenom} (filleul) et +${pointsParrain} points pour ${parrain.prenom} (parrain)`
      : `Parrainage : +${pointsFilleul} points pour ${filleulApres.prenom} (filleul) — parrain au plafond annuel, rien pour ${parrain.prenom}`
    if (r.parrain) {
      await st.majClient(r.parrain)
      await journaliser(commerce.id, { type: 'gerant', nom: 'Gérant' }, 'parrainage', texte, r.parrain, quand)
    }
    const trace: Parrainage = {
      id: `pr-${randomUUID()}`,
      commerceId: commerce.id,
      parrainId: parrain.id,
      filleulId: filleulApres.id,
      date: quand.toISOString(),
      pointsParrain,
      pointsFilleul,
    }
    await st.ajouterParrainage(trace)
    return { filleul: r.filleul, texte }
  }

  /** Inscrit le client, ou retrouve celui qui a déjà ce téléphone / e-mail dans ce commerce. */
  /**
   * `consentement` : case « relances » cochée à l'inscription. Seulement pour un NOUVEAU client : un client retrouvé
   * garde son choix (sinon n'importe qui connaissant son numéro pourrait le réabonner après un STOP) — le gérant peut le
   * modifier sur la fiche.
   */
  async function inscrireOuRetrouver(commerce: Commerce, prenom: string, contactSaisi: unknown, parrainCode?: string, consentement = false) {
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

  type Reponse = { statut?: number; json?: unknown; csv?: { nom: string; contenu: string }; xml?: string }

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
          // Migration 0003 (équipe, journal, menu) appliquée sur la base ?
          // Migration 0004 (parrainages, demandes de rattrapage) appliquée sur la base ?
          // Migration 0007 (journal des envois de relances) appliquée ? Sans elle, aucun envoi réel ne part.
          migrations: { cartiz: await schemaCartiz(), programme: await schemaProgramme(), relances: await schemaRelances() },
        },
      }
    }
    if (ressource === 'cartes' && id && !sous && m === 'GET') {
      // PUBLIC (ajout V2) : la carte vue par le client (#/carte/<clientId>) et l'état de son jeu du jour.
      // Mêmes informations que POST /clients en public : jamais de téléphone ni d'e-mail. Seule exception (P0-U3) : le
      // code gagnant DU JOUR de ce client, re-servi à son titulaire (autre téléphone, cache vidé) — jamais dans une liste.
      limiterIp(req, 'lecture', limites.lectureParIp)
      compteurs.consommer(`carte:${id}`, limites.lectureParCarte, TROP)
      for (const c of await st.commerces()) {
        let client = await st.client(c.id, id)
        if (!client) continue
        exigerActif(c)
        const tirages = await st.tiragesClient(c.id, client.id)
        const t = maintenant()
        const duJour = tirageDuJour(tirages, c.id, client.id, t)
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
            commerce: commercePublic(c),
            jeu: {
              statut: statutJeu(client, tirages, c.id, t),
              lotDuJour: duJour?.lot ?? null,
              codeDuJour: duJour?.code && !estPerdant(duJour.lot) ? duJour.code : null,
              remisDuJour: !!duJour?.remis,
            },
            menuDisponible: !!menu?.categories.some((cat) => cat.produits.length),
          },
        }
      }
      throw err(404, 'Carte de fidélité introuvable.')
    }
    if (ressource === 'cartes' && id && sous === 'lus' && m === 'POST') {
      // PUBLIC : le client marque ses messages comme lus (même niveau d'accès que la lecture de sa carte).
      limiterIp(req, 'lecture', limites.lectureParIp)
      compteurs.consommer(`carte:${id}`, limites.lectureParCarte, TROP)
      for (const c of await st.commerces()) {
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
    if (ressource === 'sessions' && !id) {
      if (m === 'POST') {
        limiterIp(req, 'session', limites.sessionParIp)
        return ouvrirSession(req)
      }
      if (m === 'DELETE') return fermerSession(req)
      throw err(405, 'Méthode non autorisée.')
    }
    if (ressource === 'desinscription' && id && sous && !sousId && m === 'POST') {
      // PUBLIC — lien de désinscription des e-mails de relance (page #/desinscription/…, et bouton « Se désabonner » des
      // messageries via List-Unsubscribe-Post). Le corps n'est pas lu (formulaire One-Click ou vide). Idempotent.
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
          await journaliser(c.id, { type: 'client', nom: 'Client (lien de désinscription)' }, 'consentement', 'Consentement aux relances retiré : lien de désinscription (e-mail)', apres)
        })
        return { json: { ok: true, commerce: c.nom } }
      }
      throw err(404, 'Lien de désinscription invalide.')
    }

    if (ressource !== 'commerces') throw err(404, 'Route inconnue.')

    // Lectures publiques d'un commerce (liste, fiche, menu) : par IP, avant toute lecture en base.
    if (m === 'GET' && (!sous || (sous === 'menu' && !sousId))) limiterIp(req, 'lecture', limites.lectureParIp)

    if (!id) {
      if (m === 'GET') return { json: { commerces: (await st.commerces()).map(commercePublic) } }
      if (m === 'POST') {
        await exigerAdmin(req)
        const corps = await lireCorps(req)
        const { pin, nom, type, lienGoogle, ...reglages } = corps
        const pinClair = pinNeuf(pin)
        const base = nouveauCommerce(texte(nom, 'nom', 80, { requis: true }), typeCommerce(type ?? 'autre'), lien(lienGoogle ?? ''))
        const commerce = appliquerReglages(base, reglages, CHAMPS_REGLAGES.filter((k) => !['nom', 'type', 'lienGoogle'].includes(k)))
        await st.ajouterCommerce(commerce, await hacherPin(pinClair))
        // Réponse à l'admin authentifié : fiche complète, comme PATCH et /etat (le PIN est stocké à part).
        return { statut: 201, json: { commerce } }
      }
      throw err(405, 'Méthode non autorisée.')
    }

    const commerce = await commerceOu404(id)

    if (!sous) {
      if (m === 'PATCH') {
        await exigerCommercant(req, id)
        const maj = appliquerReglages(commerce, await lireCorps(req))
        // Comme le front : enregistrer les réglages réapplique les règles aux avis en attente.
        await st.transaction(async () => {
          await st.majCommerce(maj)
          for (const a of await st.avis(id)) {
            const r = appliquerRegles(a, maj)
            if (r !== a) await st.majAvis(r)
          }
        })
        return { json: { commerce: maj } }
      }
      if (m === 'GET') return { json: { commerce: commercePublic(commerce) } }
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
          tirages: await st.tirages(id),
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
      await st.majPin(id, await hacherPin(pinNeuf(corps.pin)))
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
      }
      const corps = await lireCorps(req)
      if (!commercant) limiterContact('inscription', id, corps.contact, limites.inscriptionParContact)
      const prenom = texte(corps.prenom ?? '', 'prenom', 40)
      // Consentement aux relances : case séparée, jamais pré-cochée ; absent = pas de consentement.
      const consentement = corps.consentementRelance == null ? false : booleen(corps.consentementRelance, 'consentementRelance')
      const { client, existant } = await st.transaction(() => inscrireOuRetrouver(commerce, prenom, corps.contact, corps.parrain, consentement))
      return { statut: existant ? 200 : 201, json: { client: commercant ? client : cartePublique(client), existant } }
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
          // Sans la garde « 1 tampon par jour » de la caisse : cette route historique (« Valider une visite »
          // depuis la fiche client) l'a toujours autorisé, et le front affiche déjà l'avertissement.
          let evenements: EvenementPassage[] = []
          ;({ client: apres, evenements } = appliquerVisiteProgramme(avant, commerce, 0, maintenant()))
          apres = avecMessages(apres, commerce, 'passage')
          const regle = await reglerParrainage(commerce, apres, maintenant())
          apres = regle.filleul
          await st.majClient(apres)
          texteJournal = `+1 tampon (${tamponsAffiches(apres, commerce)}/${commerce.seuilTampons})${evenements.length ? ` · ${evenements.map((e) => e.texte).join(' · ')}` : ''}${regle.texte ? ` · ${regle.texte}` : ''}`
          await journaliser(id, auteur, 'passage', texteJournal, apres)
          if (regle.texte) await journaliser(id, auteur, 'parrainage', regle.texte, apres)
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
      return { json: { auteur, commerce, clients: (await st.clients(id)).map(clientCaisse) } }
    }

    if (sous === 'caisse' && (sousId === 'passage' || sousId === 'recompense' || sousId === 'echange' || sousId === 'attente' || sousId === 'reserve') && !action && m === 'POST') {
      const { auteur } = await exigerAuteur(req, id)
      exigerActif(commerce)
      const corps = await lireCorps(req)
      const clientId = texte(corps.clientId, 'clientId', 80, { requis: true })
      const actionId = idAction(corps.actionId)
      const quand = quandAction(corps.faitLe)
      let centimes = 0
      if (sousId === 'passage' && corps.montantCentimes != null) {
        const v = corps.montantCentimes
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100_000_00) throw err(400, '« montantCentimes » : montant en centimes entre 0 et 100 000 €.')
        centimes = v
      }
      const resultat = await st.transaction(async () => {
        const avant = await clientOu404(id, clientId)
        // Idempotence : une action déjà reçue (file hors ligne rejouée, double tap) ne compte jamais deux fois.
        if (actionDejaTraitee(avant, actionId)) return { client: avant, dejaTraite: true }
        let apres: Client
        let details: string
        let journalAction: EntreeJournal['action'] = sousId === 'attente' ? 'recompense' : sousId === 'reserve' ? 'reserve' : sousId
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
          details = `+1 tampon (${tamponsAffiches(apres, commerce)}/${commerce.seuilTampons})${centimes ? ` · ${formaterPrix(centimes)} → +${gagnes} point${gagnes > 1 ? 's' : ''} (solde ${soldePoints(apres)}, ${niveau.nom} ×${niveau.multiplicateur})` : ''}${evenements.length ? ` · ${evenements.map((e) => e.texte).join(' · ')}` : ''}${regle.texte ? ` · ${regle.texte}` : ''}`
          if (regle.texte) await journaliser(id, auteur, 'parrainage', regle.texte, apres, quand)
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
        await journaliser(id, auteur, journalAction, details, apres, quand)
        return { client: apres, dejaTraite: false }
      })
      return { json: { client: clientCaisse(resultat.client), dejaTraite: resultat.dejaTraite } }
    }

    // ---------- Code gagnant de la roue (P0-U3) : vérifié puis marqué « remis » en caisse ----------
    // GET  /commerces/:id/caisse/gains/:code         → le gain (lot, client, date, statut) ; 404 code inconnu.
    // POST /commerces/:id/caisse/gains/:code/remise  → 200 remis ; 409 déjà remis / perdant ; 410 expiré (pas du jour).

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

      // Perdant / déjà remis : 409 ; expiré (tirage d'un autre jour) : 410.
      const refus = (x: Tirage) => {
        const g = gainCaisse(x, undefined, t)
        if (g.statut !== 'valable') throw err(g.statut === 'expire' ? 410 : 409, messageGain(g))
      }
      refus(trouve)
      const remis: Tirage = { ...trouve, remis: { le: t.toISOString(), par: auteur } }
      // Garde de la base : l'écriture n'a lieu que si personne ne l'a remis entre-temps (deux caisses au même moment).
      if (!(await st.marquerTirageRemis(remis))) {
        const relu = (await st.tiragesParCode(id, code)).find((x) => x.id === trouve.id)
        if (relu) refus(relu)
        throw err(409, 'Lot déjà remis : un code ne sert qu’une fois.')
      }
      const client = await st.client(id, remis.clientId)
      await journaliser(id, auteur, 'gain', `Gain de la roue remis : ${remis.lot} (code ${code})`, client)
      return { json: { gain: gainCaisse(remis, client, t) } }
    }

    // ---------- Fiche client (gérant) : anniversaire, plat préféré ----------

    if (sous === 'clients' && sousId && !action && m === 'PATCH') {
      const nom = await exigerCommercant(req, id)
      const corps = await lireCorps(req)
      const inconnus = Object.keys(corps).filter((k) => k !== 'anniversaire' && k !== 'platPrefere' && k !== 'consentementRelance')
      if (inconnus.length) throw err(400, `Champ non modifiable : ${inconnus.join(', ')}.`)
      const a = corps.anniversaire == null ? '' : texte(corps.anniversaire, 'anniversaire', 5)
      if (a && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(a)) throw err(400, '« anniversaire » : format MM-JJ attendu (ex. 03-21).')
      const plat = corps.platPrefere == null ? '' : texte(corps.platPrefere, 'platPrefere', 80)
      const consentement = 'consentementRelance' in corps ? booleen(corps.consentementRelance, 'consentementRelance') : undefined
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
        await st.majClient(apres)
        return apres
      })
      return { json: { client: clientCaisse(client) } }
    }

    // ---------- Profil progressif (client) : anniversaire + plat préféré, après la 2e visite ----------
    // Jamais exigés à l'inscription (recherche CX §1 : chaque champ coûte ~10 % de conversion).

    if (sous === 'clients' && sousId && action === 'profil' && m === 'POST') {
      exigerActif(commerce)
      limiterIp(req, 'fiche', limites.ficheClientParIp)
      const corps = await lireCorps(req)
      const inconnus = Object.keys(corps).filter((k) => k !== 'anniversaire' && k !== 'platPrefere')
      if (inconnus.length) throw err(400, `Champ non modifiable : ${inconnus.join(', ')}.`)
      const anniversaire = corps.anniversaire == null ? '' : analyserAnniversaire(texte(corps.anniversaire, 'anniversaire', 10))
      if (anniversaire === null) throw err(400, '« anniversaire » : format JJ/MM attendu (ex. 21/03).')
      const plat = corps.platPrefere == null ? '' : texte(corps.platPrefere, 'platPrefere', 80)
      if (!anniversaire && !plat) throw err(400, 'Indiquez au moins votre anniversaire ou votre plat préféré.')
      const client = await st.transaction(async () => {
        const avant = await clientOu404(id, sousId)
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
      exigerActif(commerce)
      limiterIp(req, 'fiche', limites.ficheClientParIp)
      const corps = await lireCorps(req)
      const dateVisite = new Date(typeof corps.date === 'string' ? corps.date : '')
      const montant = typeof corps.montantCentimes === 'number' ? corps.montantCentimes : NaN
      const ticket = corps.ticket == null ? '' : texte(corps.ticket, 'ticket', 80)
      const client = await st.transaction(async () => {
        const avant = await clientOu404(id, sousId)
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
        if (corps.decision === 'valider') {
          const raison = rattrapageRecevable(avant, commerce, new Date(demande.date), demande.montantCentimes, t)
          if (raison) throw err(409, raison)
          const { client: avecVisite, evenements } = appliquerRattrapageValide(apres, commerce, demande.montantCentimes, new Date(demande.date))
          apres = avecMessages(avecVisite, commerce, 'passage', t)
          const regle = await reglerParrainage(commerce, apres, t)
          apres = regle.filleul
          await journaliser(
            id,
            { type: 'gerant', nom: 'Gérant' },
            'rattrapage',
            `Visite oubliée validée (${new Date(demande.date).toLocaleDateString('fr-FR')}${demande.montantCentimes ? `, ${formaterPrix(demande.montantCentimes)}` : ''}) : +1 tampon${evenements.length ? ` · ${evenements.map((e) => e.texte).join(' · ')}` : ''}${regle.texte ? ` · ${regle.texte}` : ''}`,
            apres,
            t,
          )
        } else {
          await journaliser(id, { type: 'gerant', nom: 'Gérant' }, 'rattrapage', `Visite oubliée refusée (${new Date(demande.date).toLocaleDateString('fr-FR')})`, apres, t)
        }
        await st.majClient(apres)
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
        return { json: { menu: (await st.menu(id)) ?? { commerceId: id, categories: [], majLe: '' }, commerce: commercePublic(commerce) } }
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
      return { json: { envoye: true, canal: r.envoi.canal, modele, id: r.envoi.idPrestataire ?? '', envoi: r.envoi } }
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
      limiterIp(req, 'stop', limites.lectureParIp)
      if (!notifications.statut().sms) throw err(501, 'Réception des réponses STOP à brancher : Twilio n’est pas configuré sur ce serveur. Aucun consentement n’a été modifié.')
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

    if (sous === 'tirages' && !sousId && m === 'POST') {
      // PUBLIC : tout est décidé ici (visite du jour, 1 tirage par jour, lot tiré) — rien ne vient du navigateur.
      exigerActif(commerce)
      limiterIp(req, 'tirage', limites.tirageParIp)
      const corps = await lireCorps(req)
      limiterContact('tirage', id, corps.contact, limites.tirageParContact)
      const prenom = corps.prenom == null ? '' : texte(corps.prenom, 'prenom', 40)
      const dejaJoue = 'Vous avez déjà tourné la roue aujourd’hui. Revenez lors de votre prochaine visite !'
      const resultat = await st.transaction(async () => {
        const { client } = await inscrireOuRetrouver(commerce, prenom, corps.contact, corps.parrain)
        const t = maintenant()
        const statut = statutJeu(client, await st.tiragesClient(id, client.id), id, t)
        if (statut === 'dejaJoue') return { refus: dejaJoue }
        if (statut === 'sansVisite') return { refus: 'Pour jouer, faites d’abord valider votre visite du jour au comptoir.' }
        const jouables = lotsJouables(commerce.lots)
        if (!jouables.length) return { refus: 'Aucun lot n’est configuré pour le moment.' }
        const lot = jouables[tirerLot(commerce.lots)].libelle
        const tirage: Tirage = { id: `ti-${randomUUID()}`, commerceId: id, clientId: client.id, lot, date: t.toISOString(), code: codeGagnant() }
        try {
          await st.ajouterTirage(tirage)
        } catch (e) {
          // Deux tirages simultanés : la base (index unique client + jour) a refusé le 2e.
          if (e instanceof ErreurConflit) return { refus: dejaJoue }
          throw e
        }
        return { tirage }
      })
      // Le client éventuellement créé reste inscrit même en cas de refus (la transaction est validée).
      if ('refus' in resultat) throw err(409, resultat.refus!)
      const { lot, code, date } = resultat.tirage!
      return { statut: 201, json: { lot, code, date, perdant: estPerdant(lot) } }
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

  const serveur = createServer(async (req, res) => {
    const entetes: Record<string, string> = { ...ENTETES_SECURITE, ...entetesCors(origineCors, req.headers.origin) }
    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, entetes).end()
        return
      }
      // Lien court des SMS de relance (P1-B3) : /c/<clientId> → la carte du client (#/carte/<clientId>).
      const court = /^\/c\/([\w-]{1,80})$/.exec(url.pathname)
      if (court && (req.method === 'GET' || req.method === 'HEAD')) {
        res.writeHead(302, { ...entetes, Location: `/#/carte/${court[1]}`, 'Cache-Control': 'no-store' }).end()
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
      if (r.csv) {
        res.writeHead(200, {
          ...entetes,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${r.csv.nom.replace(/[^\w.-]/g, '_')}"`,
          'Cache-Control': 'no-store',
        })
        res.end(r.csv.contenu)
        return
      }
      if (r.xml != null) {
        res.writeHead(r.statut ?? 200, { ...entetes, 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(r.xml)
        return
      }
      res.writeHead(r.statut ?? 200, { ...entetes, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(r.json))
    } catch (erreur) {
      // Conflit d'écriture (doublon refusé par la base, ligne modifiée entre-temps) : 409, l'utilisateur peut réessayer.
      const e =
        erreur instanceof ErreurConflit
          ? err(409, 'Modification simultanée : réessayez.')
          : erreur instanceof ErreurMigrationManquante
            ? err(503, erreur.message)
            : erreur
      const http = e instanceof ErreurHttp
      if (!http) console.error(`[serveur] ${req.method} ${url.pathname} :`, e)
      const statut = http ? e.statut : 500
      res.writeHead(statut, { ...entetes, ...(http ? e.entetes : {}), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ erreur: http ? e.message : 'Erreur interne du serveur.' }))
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

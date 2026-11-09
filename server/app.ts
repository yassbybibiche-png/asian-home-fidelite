// API REST /api/v1 (module `node:http`, aucune dépendance npm).
// Les règles métier ne sont PAS réécrites ici : elles viennent de `src/lib/*` (les mêmes que le front).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'

import type { Apparence, Avis, Client, Commerce, DemandeRattrapage, EntreeJournal, Lot, MembreEquipe, Parrainage, RecompensePoints, ReglesMessages, Tirage, TypeCommerce } from '../src/types.ts'
import { nouveauCommerce, TYPES_COMMERCE } from '../src/data/defaults.ts'
import { seedRecale } from '../src/data/depot.ts'
import seed from '../src/data/seed.json' with { type: 'json' }
import { analyserContact, cleContact, messageRelance, nouveauClient, offrirRecompense, recompenseDebloquee, tamponsAffiches } from '../src/lib/fidelite.ts'
import { estPerdant, lotsJouables, statutJeu, tirageDuJour, tirerLot } from '../src/lib/roulette.ts'
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
import { ErreurMenu, validerMenu } from '../src/lib/menu.ts'
import { ErreurConflit, ErreurMigrationManquante, ouvrirStockage, type Pin, type Stockage } from './stockage.ts'
import { ouvrirStockageSupabase, type ConfigSupabase } from './stockage-supabase.ts'
import { ErreurWallet, lienGoogleWallet, walletConfigure, type ConfigGoogleWallet } from './wallet.ts'
import { creerNotifications, ErreurNonBranche, type Canal, type ConfigNotifications } from './notifications/index.ts'

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
  /** Origine autorisée en CORS (défaut : *). */
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

export function hacherPin(pin: string, sel = randomBytes(16).toString('hex')): Pin {
  return { sel, hash: createHash('sha256').update(`${sel}:${pin}`).digest('hex') }
}

function pinCorrect(pin: string, attendu: Pin): boolean {
  const a = Buffer.from(hacherPin(pin, attendu.sel).hash, 'hex')
  const b = Buffer.from(attendu.hash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

// ---------- Anti-bruteforce (en mémoire) ----------

const FENETRE = 10 * 60 * 1000
const MAX_ECHECS = 10

function creerLimiteur() {
  const echecs = new Map<string, number[]>()
  const bloques = new Map<string, number>()
  const nettoyage = setInterval(() => {
    const t = Date.now()
    for (const [ip, fin] of bloques) if (fin <= t) bloques.delete(ip)
    for (const [ip, liste] of echecs) if (liste.every((x) => t - x > FENETRE)) echecs.delete(ip)
  }, FENETRE)
  nettoyage.unref()
  return {
    verifier(ip: string) {
      const fin = bloques.get(ip)
      if (fin && fin > Date.now()) {
        const s = Math.ceil((fin - Date.now()) / 1000)
        throw new ErreurHttp(429, `Trop de PIN incorrects. Réessayez dans ${Math.ceil(s / 60)} min.`, { 'Retry-After': String(s) })
      }
    },
    echec(ip: string) {
      const t = Date.now()
      const liste = (echecs.get(ip) ?? []).filter((x) => t - x <= FENETRE)
      liste.push(t)
      if (liste.length >= MAX_ECHECS) {
        bloques.set(ip, t + FENETRE)
        echecs.delete(ip)
      } else echecs.set(ip, liste)
    },
    arreter: () => clearInterval(nettoyage),
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

const CHAMPS_REGLAGES = ['nom', 'type', 'logo', 'lienGoogle', 'coordonnees', 'recompense', 'seuilTampons', 'lots', 'reglesReponseAuto', 'actif', 'eurosParPoint', 'catalogue', 'messagesAuto', 'apparence', 'programme']

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
  return r
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

/** Fiche publique d'un commerce (le PIN est stocké à part et n'en fait jamais partie). */
function commercePublic(c: Commerce) {
  const { id, nom, type, logo, actif, lienGoogle, coordonnees, recompense, seuilTampons, lots, reglesReponseAuto, demo, eurosParPoint, catalogue, apparence, programme } = c
  return { id, nom, type, logo, actif, lienGoogle, coordonnees, recompense, seuilTampons, lots, reglesReponseAuto, demo: !!demo, eurosParPoint, catalogue, apparence, programme }
}

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
    await st.transaction(async () => {
      // Le vrai commerce, SANS les clients / avis / tirages fictifs du seed.
      // (Déjà présent : démarrage précédent interrompu avant la ligne `meta` — possible sous Supabase, sans transaction.)
      if (!(await st.commerce(asianHome.id))) {
        await sansDoublon(st.ajouterCommerce({ ...asianHome, creeLe: new Date().toISOString(), demo: false }, hacherPin(o.pinInitial!)))
      }
      await st.majMeta('initialise', new Date().toISOString())
    })
  }
  if (o.demo && !(await st.meta('demo'))) {
    const pin = o.pinInitial && PIN_VALIDE.test(o.pinInitial) ? o.pinInitial : '1234'
    const demo = seedRecale()
    const ids = new Set(demo.commerces.slice(1).map((c) => c.id))
    await st.transaction(async () => {
      for (const c of demo.commerces) if (ids.has(c.id) && !(await st.commerce(c.id))) await sansDoublon(st.ajouterCommerce({ ...c, demo: true }, hacherPin(pin)))
      for (const c of demo.clients) if (ids.has(c.commerceId)) await sansDoublon(st.ajouterClient(c))
      for (const t of demo.tirages) if (ids.has(t.commerceId)) await sansDoublon(st.ajouterTirage(t))
      for (const a of demo.avis) if (ids.has(a.commerceId)) await sansDoublon(st.ajouterAvis(a))
      await st.majMeta('demo', new Date().toISOString())
    })
  }
}

// ---------- Fichiers statiques (front compilé, optionnel) ----------

const TYPES_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
}

function servirStatique(dossier: string, chemin: string, res: ServerResponse): boolean {
  const racine = resolve(dossier)
  let decode: string
  try {
    decode = decodeURIComponent(chemin)
  } catch {
    return false
  }
  let fichier = resolve(join(racine, normalize(decode)))
  if (fichier !== racine && !fichier.startsWith(racine + sep)) return false
  if (!existsSync(fichier) || statSync(fichier).isDirectory()) fichier = join(racine, 'index.html')
  if (!existsSync(fichier)) return false
  res.writeHead(200, { 'Content-Type': TYPES_MIME[extname(fichier)] ?? 'application/octet-stream' })
  res.end(readFileSync(fichier))
  return true
}

// ---------- Serveur ----------

const TAILLE_MAX_CORPS = 64 * 1024
/** Le menu peut contenir des photos compressées (60 Ko chacune au plus). */
const TAILLE_MAX_MENU = 3 * 1024 * 1024

async function lireCorps(req: IncomingMessage, max = TAILLE_MAX_CORPS): Promise<Corps> {
  let taille = 0
  const morceaux: Buffer[] = []
  for await (const m of req) {
    taille += (m as Buffer).length
    if (taille > max) throw err(413, 'Requête trop volumineuse.')
    morceaux.push(m as Buffer)
  }
  if (!taille) return {}
  try {
    const v: unknown = JSON.parse(Buffer.concat(morceaux).toString('utf8'))
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
  // Supabase seulement s'il est configuré ; sinon SQLite local (dev, tests, comportement d'avant S1).
  const st: Stockage = o.supabase ? ouvrirStockageSupabase(o.supabase) : ouvrirStockage(o.fichierDb)
  try {
    await initialiser(st, o)
  } catch (e) {
    await st.fermer()
    throw e
  }
  const limiteur = creerLimiteur()
  const maintenant = o.maintenant ?? (() => new Date())
  const adminPin = hacherPin(o.adminPin)
  const notifications = creerNotifications(o.notifications)
  const integrations = () => ({
    googleWallet: walletConfigure(o.googleWallet),
    appleWallet: 'en_suspens',
    googleBusinessProfile: false,
    ...notifications.statut(),
  })

  const ipDe = (req: IncomingMessage) =>
    (o.derriereProxy && String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()) || req.socket.remoteAddress || '?'

  const enTete = (req: IncomingMessage, nom: string) => {
    const v = req.headers[nom]
    return typeof v === 'string' && v ? v : undefined
  }

  function exigerAdmin(req: IncomingMessage) {
    const pin = enTete(req, 'x-admin-pin')
    if (!pin) throw err(401, 'PIN admin manquant (en-tête X-Admin-PIN).')
    const ip = ipDe(req)
    limiteur.verifier(ip)
    if (!pinCorrect(pin, adminPin)) {
      limiteur.echec(ip)
      throw err(401, 'PIN admin incorrect.')
    }
  }

  /** PIN du commerce (X-Commerce-PIN) ; le PIN admin (X-Admin-PIN) ouvre aussi tous les commerces. */
  async function exigerCommercant(req: IncomingMessage, commerceId: string) {
    if (enTete(req, 'x-admin-pin')) return exigerAdmin(req)
    const pin = enTete(req, 'x-commerce-pin')
    if (!pin) throw err(401, 'PIN commerçant manquant (en-tête X-Commerce-PIN).')
    const ip = ipDe(req)
    limiteur.verifier(ip)
    if (!pinCorrect(pin, (await st.pin(commerceId))!)) {
      limiteur.echec(ip)
      throw err(401, 'PIN commerçant incorrect.')
    }
  }

  const aUnPin = (req: IncomingMessage) => !!(enTete(req, 'x-commerce-pin') || enTete(req, 'x-admin-pin'))

  type Auteur = EntreeJournal['auteur']

  /**
   * Auteur d'une action de caisse : membre de l'équipe (X-Equipe-Code, 4 chiffres) ou gérant (PIN commerce / admin).
   * Le code n'est jamais renvoyé ni écrit dans le journal : seul le nom du membre l'est.
   */
  async function exigerAuteur(req: IncomingMessage, commerceId: string): Promise<{ auteur: Auteur; membre?: MembreEquipe }> {
    const code = enTete(req, 'x-equipe-code')
    if (!code) {
      await exigerCommercant(req, commerceId)
      return { auteur: { type: 'gerant', nom: enTete(req, 'x-admin-pin') ? 'Admin' : 'Gérant' } }
    }
    const ip = ipDe(req)
    limiteur.verifier(ip)
    const trouve = CODE_EQUIPE.test(code) ? (await st.membres(commerceId)).find((m) => pinCorrect(code, m.code)) : undefined
    if (!trouve) {
      if (!(await schemaCartiz())) throw new ErreurMigrationManquante('equipe')
      limiteur.echec(ip)
      throw err(401, 'Code équipe incorrect.')
    }
    return { auteur: { type: 'membre', id: trouve.membre.id, nom: trouve.membre.nom }, membre: trouve.membre }
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
    if ((await st.membres(commerceId)).some((m) => m.membre.id !== sauf && pinCorrect(code, m.code))) {
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
  async function inscrireOuRetrouver(commerce: Commerce, prenom: string, contactSaisi: unknown, parrainCode?: string) {
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

  type Reponse = { statut?: number; json?: unknown; csv?: { nom: string; contenu: string } }

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
          migrations: { cartiz: await schemaCartiz(), programme: await schemaProgramme() },
        },
      }
    }
    if (ressource === 'cartes' && id && !sous && m === 'GET') {
      // PUBLIC (ajout V2) : la carte vue par le client (#/carte/<clientId>) et l'état de son jeu du jour.
      // Mêmes informations que POST /clients en public : jamais de téléphone, d'e-mail ni de code gagnant.
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
            jeu: { statut: statutJeu(client, tirages, c.id, t), lotDuJour: duJour?.lot ?? null },
            menuDisponible: !!menu?.categories.some((cat) => cat.produits.length),
          },
        }
      }
      throw err(404, 'Carte de fidélité introuvable.')
    }
    if (ressource === 'cartes' && id && sous === 'lus' && m === 'POST') {
      // PUBLIC : le client marque ses messages comme lus (même niveau d'accès que la lecture de sa carte).
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
    if (ressource !== 'commerces') throw err(404, 'Route inconnue.')

    if (!id) {
      if (m === 'GET') return { json: { commerces: (await st.commerces()).map(commercePublic) } }
      if (m === 'POST') {
        exigerAdmin(req)
        const corps = await lireCorps(req)
        const { pin, nom, type, lienGoogle, ...reglages } = corps
        const pinClair = pinNeuf(pin)
        const base = nouveauCommerce(texte(nom, 'nom', 80, { requis: true }), typeCommerce(type ?? 'autre'), lien(lienGoogle ?? ''))
        const commerce = appliquerReglages(base, reglages, CHAMPS_REGLAGES.filter((k) => !['nom', 'type', 'lienGoogle'].includes(k)))
        await st.ajouterCommerce(commerce, hacherPin(pinClair))
        return { statut: 201, json: { commerce: commercePublic(commerce) } }
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
      return {
        json: {
          commerce,
          clients: (await st.clients(id)).map(clientCaisse),
          tirages: await st.tirages(id),
          avis: await st.avis(id),
          membres: (await st.membres(id)).map((m) => m.membre),
          journal: await st.journal(id, 200),
        },
      }
    }

    if (sous === 'pin' && m === 'PUT') {
      await exigerCommercant(req, id)
      const corps = await lireCorps(req)
      await st.majPin(id, hacherPin(pinNeuf(corps.pin)))
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
      else exigerActif(commerce)
      const corps = await lireCorps(req)
      const prenom = texte(corps.prenom ?? '', 'prenom', 40)
      const { client, existant } = await st.transaction(() => inscrireOuRetrouver(commerce, prenom, corps.contact, corps.parrain))
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

    // ---------- Fiche client (gérant) : anniversaire, plat préféré ----------

    if (sous === 'clients' && sousId && !action && m === 'PATCH') {
      await exigerCommercant(req, id)
      const corps = await lireCorps(req)
      const inconnus = Object.keys(corps).filter((k) => k !== 'anniversaire' && k !== 'platPrefere')
      if (inconnus.length) throw err(400, `Champ non modifiable : ${inconnus.join(', ')}.`)
      const a = corps.anniversaire == null ? '' : texte(corps.anniversaire, 'anniversaire', 5)
      if (a && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(a)) throw err(400, '« anniversaire » : format MM-JJ attendu (ex. 03-21).')
      const plat = corps.platPrefere == null ? '' : texte(corps.platPrefere, 'platPrefere', 80)
      const client = await st.transaction(async () => {
        const avant = await clientOu404(id, sousId)
        const apres: Client = { ...avant }
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
        await st.ajouterMembre(membre, hacherPin(code))
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
          code = hacherPin(c)
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
      // V3 — envoi SMS / e-mail préparé : 501 sans prestataire, et jamais sans consentement explicite du client.
      await exigerCommercant(req, id)
      const client = await clientOu404(id, sousId)
      const corps = await lireCorps(req)
      if (corps.canal !== 'sms' && corps.canal !== 'email') throw err(400, '« canal » doit valoir "sms" ou "email".')
      const canal = corps.canal as Canal
      if (!notifications.statut()[canal]) throw err(501, new ErreurNonBranche(canal).message)
      if (client.consentementRelance !== true) throw err(409, 'Ce client n’a pas donné son consentement aux relances : rien n’a été envoyé.')
      // SMS : format international (06… → +336…, autres numéros : chiffres précédés de +).
      const cle = client.telephone ? cleContact({ telephone: client.telephone }) : ''
      const destinataire = canal === 'sms' ? (cle && (/^0\d{9}$/.test(cle) ? `+33${cle.slice(1)}` : `+${cle}`)) : client.email
      if (!destinataire) throw err(409, `Ce client n’a pas ${canal === 'sms' ? 'de téléphone' : 'd’e-mail'} : rien n’a été envoyé.`)
      const texteMessage = corps.message == null ? messageRelance(client, commerce) : texte(corps.message, 'message', 600, { requis: true })
      const desinscription = canal === 'sms' ? ' STOP pour ne plus recevoir de messages.' : '\n\nPour ne plus recevoir ces messages, répondez « désinscription ».'
      const r = await notifications.envoyer(canal, { destinataire, texte: texteMessage + desinscription, sujet: commerce.nom })
      return { json: { envoye: true, canal, id: r.id } }
    }

    if (sous === 'tirages' && !sousId && m === 'POST') {
      // PUBLIC : tout est décidé ici (visite du jour, 1 tirage par jour, lot tiré) — rien ne vient du navigateur.
      exigerActif(commerce)
      const corps = await lireCorps(req)
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
    const entetes: Record<string, string> = {
      'Access-Control-Allow-Origin': o.origineCors ?? '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Commerce-PIN, X-Admin-PIN, X-Equipe-Code',
      'Access-Control-Max-Age': '600',
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, entetes).end()
        return
      }
      if (!url.pathname.startsWith('/api/v1/') && url.pathname !== '/api/v1') {
        if (o.dossierStatique && (req.method === 'GET' || req.method === 'HEAD') && !url.pathname.startsWith('/api/')) {
          if (servirStatique(o.dossierStatique, url.pathname, res)) return
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
      res.writeHead(statut, { ...entetes, ...(http ? e.entetes : {}), 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ erreur: http ? e.message : 'Erreur interne du serveur.' }))
    }
  })

  return {
    serveur,
    async fermer() {
      limiteur.arreter()
      serveur.closeAllConnections()
      await new Promise<void>((ok) => serveur.close(() => ok()))
      await st.fermer()
    },
  }
}

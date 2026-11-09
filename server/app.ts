// API REST /api/v1 (module `node:http`, aucune dépendance npm).
// Les règles métier ne sont PAS réécrites ici : elles viennent de `src/lib/*` (les mêmes que le front).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'

import type { Avis, Client, Commerce, Lot, Tirage, TypeCommerce } from '../src/types.ts'
import { nouveauCommerce, TYPES_COMMERCE } from '../src/data/defaults.ts'
import { seedRecale } from '../src/data/depot.ts'
import seed from '../src/data/seed.json' with { type: 'json' }
import { analyserContact, cleContact, messageRelance, nouveauClient, offrirRecompense, recompenseDebloquee, validerVisite } from '../src/lib/fidelite.ts'
import { estPerdant, lotsJouables, statutJeu, tirageDuJour, tirerLot } from '../src/lib/roulette.ts'
import { appliquerRegles } from '../src/lib/avis.ts'
import { clientsEnCsv } from '../src/lib/csv.ts'
import { ouvrirStockage, type Pin, type Stockage } from './stockage.ts'
import { payloadGoogleWallet, walletConfigure, type ConfigGoogleWallet } from './wallet.ts'
import { creerNotifications, ErreurNonBranche, type Canal, type ConfigNotifications } from './notifications/index.ts'

export interface OptionsServeur {
  /** Fichier SQLite (créé au besoin). */
  fichierDb: string
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

const CHAMPS_REGLAGES = ['nom', 'type', 'logo', 'lienGoogle', 'coordonnees', 'recompense', 'seuilTampons', 'lots', 'reglesReponseAuto', 'actif']

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
  return r
}

function contactOuErreur(v: unknown) {
  const contact = typeof v === 'string' ? analyserContact(v) : null
  if (!contact) throw err(400, 'Contact invalide : indiquez un numéro de téléphone (06 12 34 56 78) ou un e-mail.')
  return contact
}

// ---------- Représentations ----------

/** Fiche publique d'un commerce (le PIN est stocké à part et n'en fait jamais partie). */
function commercePublic(c: Commerce) {
  const { id, nom, type, logo, actif, lienGoogle, coordonnees, recompense, seuilTampons, lots, reglesReponseAuto, demo } = c
  return { id, nom, type, logo, actif, lienGoogle, coordonnees, recompense, seuilTampons, lots, reglesReponseAuto, demo: !!demo }
}

/** Carte vue par le client lui-même (page publique) : sans téléphone ni e-mail. */
function cartePublique(c: Client) {
  const { telephone: _t, email: _e, ...reste } = c
  return reste
}

// ---------- Initialisation de la base ----------

function initialiser(st: Stockage, o: OptionsServeur) {
  if (!st.meta('initialise')) {
    if (!o.pinInitial || !PIN_VALIDE.test(o.pinInitial)) {
      throw new Error('Base vide : un PIN initial (4 à 6 chiffres) est requis pour Asian Home Paris (variable PIN_ASIAN_HOME).')
    }
    const [asianHome] = seed.commerces as unknown as Commerce[]
    st.transaction(() => {
      // Le vrai commerce, SANS les clients / avis / tirages fictifs du seed.
      st.ajouterCommerce({ ...asianHome, creeLe: new Date().toISOString(), demo: false }, hacherPin(o.pinInitial!))
      st.majMeta('initialise', new Date().toISOString())
    })
  }
  if (o.demo && !st.meta('demo')) {
    const pin = o.pinInitial && PIN_VALIDE.test(o.pinInitial) ? o.pinInitial : '1234'
    const demo = seedRecale()
    const ids = new Set(demo.commerces.slice(1).map((c) => c.id))
    st.transaction(() => {
      for (const c of demo.commerces) if (ids.has(c.id) && !st.commerce(c.id)) st.ajouterCommerce({ ...c, demo: true }, hacherPin(pin))
      for (const c of demo.clients) if (ids.has(c.commerceId)) st.ajouterClient(c)
      for (const t of demo.tirages) if (ids.has(t.commerceId)) st.ajouterTirage(t)
      for (const a of demo.avis) if (ids.has(a.commerceId)) st.ajouterAvis(a)
      st.majMeta('demo', new Date().toISOString())
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

async function lireCorps(req: IncomingMessage): Promise<Corps> {
  let taille = 0
  const morceaux: Buffer[] = []
  for await (const m of req) {
    taille += (m as Buffer).length
    if (taille > TAILLE_MAX_CORPS) throw err(413, 'Requête trop volumineuse.')
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

export function creerServeur(o: OptionsServeur) {
  const st = ouvrirStockage(o.fichierDb)
  try {
    initialiser(st, o)
  } catch (e) {
    st.fermer()
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
  function exigerCommercant(req: IncomingMessage, commerceId: string) {
    if (enTete(req, 'x-admin-pin')) return exigerAdmin(req)
    const pin = enTete(req, 'x-commerce-pin')
    if (!pin) throw err(401, 'PIN commerçant manquant (en-tête X-Commerce-PIN).')
    const ip = ipDe(req)
    limiteur.verifier(ip)
    if (!pinCorrect(pin, st.pin(commerceId)!)) {
      limiteur.echec(ip)
      throw err(401, 'PIN commerçant incorrect.')
    }
  }

  const aUnPin = (req: IncomingMessage) => !!(enTete(req, 'x-commerce-pin') || enTete(req, 'x-admin-pin'))

  function commerceOu404(id: string): Commerce {
    const c = st.commerce(id)
    if (!c) throw err(404, 'Commerce inconnu.')
    return c
  }

  function clientOu404(commerceId: string, id: string): Client {
    const c = st.client(commerceId, id)
    if (!c) throw err(404, 'Client inconnu dans ce commerce.')
    return c
  }

  function exigerActif(c: Commerce) {
    if (!c.actif) throw err(409, 'Ce commerce n’est pas actif pour le moment.')
  }

  /** Inscrit le client, ou retrouve celui qui a déjà ce téléphone / e-mail dans ce commerce. */
  function inscrireOuRetrouver(commerceId: string, prenom: string, contactSaisi: unknown) {
    const contact = contactOuErreur(contactSaisi)
    const existant = st.clientParContact(commerceId, contact)
    if (existant) return { client: existant, existant: true }
    const client = nouveauClient(commerceId, prenom, contact, maintenant())
    st.ajouterClient(client)
    return { client, existant: false }
  }

  type Reponse = { statut?: number; json?: unknown; csv?: { nom: string; contenu: string } }

  async function router(req: IncomingMessage, chemin: string[]): Promise<Reponse> {
    const m = req.method
    const [ressource, id, sous, sousId, action] = chemin

    if (ressource === 'sante' && !id && m === 'GET') {
      return { json: { ok: true, version: o.version ?? '0.0.0', mode: o.production ? 'production' : 'developpement', stockage: 'sqlite', demo: !!o.demo, integrations: integrations() } }
    }
    if (ressource === 'cartes' && id && !sous && m === 'GET') {
      // PUBLIC (ajout V2) : la carte vue par le client (#/carte/<clientId>) et l'état de son jeu du jour.
      // Mêmes informations que POST /clients en public : jamais de téléphone, d'e-mail ni de code gagnant.
      for (const c of st.commerces()) {
        const client = st.client(c.id, id)
        if (!client) continue
        exigerActif(c)
        const tirages = st.tiragesClient(c.id, client.id)
        const t = maintenant()
        const duJour = tirageDuJour(tirages, c.id, client.id, t)
        return {
          json: {
            client: cartePublique(client),
            commerce: commercePublic(c),
            jeu: { statut: statutJeu(client, tirages, c.id, t), lotDuJour: duJour?.lot ?? null },
          },
        }
      }
      throw err(404, 'Carte de fidélité introuvable.')
    }
    if (ressource !== 'commerces') throw err(404, 'Route inconnue.')

    if (!id) {
      if (m === 'GET') return { json: { commerces: st.commerces().map(commercePublic) } }
      if (m === 'POST') {
        exigerAdmin(req)
        const corps = await lireCorps(req)
        const { pin, nom, type, lienGoogle, ...reglages } = corps
        const pinClair = pinNeuf(pin)
        const base = nouveauCommerce(texte(nom, 'nom', 80, { requis: true }), typeCommerce(type ?? 'autre'), lien(lienGoogle ?? ''))
        const commerce = appliquerReglages(base, reglages, CHAMPS_REGLAGES.filter((k) => !['nom', 'type', 'lienGoogle'].includes(k)))
        st.ajouterCommerce(commerce, hacherPin(pinClair))
        return { statut: 201, json: { commerce: commercePublic(commerce) } }
      }
      throw err(405, 'Méthode non autorisée.')
    }

    const commerce = commerceOu404(id)

    if (!sous) {
      if (m === 'PATCH') {
        exigerCommercant(req, id)
        const maj = appliquerReglages(commerce, await lireCorps(req))
        // Comme le front : enregistrer les réglages réapplique les règles aux avis en attente.
        st.transaction(() => {
          st.majCommerce(maj)
          for (const a of st.avis(id)) {
            const r = appliquerRegles(a, maj)
            if (r !== a) st.majAvis(r)
          }
        })
        return { json: { commerce: maj } }
      }
      if (m === 'GET') return { json: { commerce: commercePublic(commerce) } }
      throw err(405, 'Méthode non autorisée.')
    }

    if (sous === 'etat' && m === 'GET') {
      exigerCommercant(req, id)
      return { json: { commerce, clients: st.clients(id), tirages: st.tirages(id), avis: st.avis(id) } }
    }

    if (sous === 'pin' && m === 'PUT') {
      exigerCommercant(req, id)
      const corps = await lireCorps(req)
      st.majPin(id, hacherPin(pinNeuf(corps.pin)))
      return { json: { ok: true } }
    }

    if (sous === 'export.csv' && m === 'GET') {
      exigerCommercant(req, id)
      return { csv: { nom: `clients-${id}.csv`, contenu: clientsEnCsv(st.clients(id)) } }
    }

    if (sous === 'clients' && !sousId && m === 'POST') {
      // Public (auto-inscription depuis la page de jeu) ou commerçant (PIN) : un PIN fourni est toujours vérifié.
      const commercant = aUnPin(req)
      if (commercant) exigerCommercant(req, id)
      else exigerActif(commerce)
      const corps = await lireCorps(req)
      const prenom = texte(corps.prenom ?? '', 'prenom', 40, { requis: true })
      const { client, existant } = st.transaction(() => inscrireOuRetrouver(id, prenom, corps.contact))
      return { statut: existant ? 200 : 201, json: { client: commercant ? client : cartePublique(client), existant } }
    }

    if (sous === 'clients' && sousId && m === 'POST' && (action === 'visite' || action === 'recompense')) {
      exigerCommercant(req, id)
      const client = st.transaction(() => {
        const avant = clientOu404(id, sousId)
        if (action === 'recompense' && !recompenseDebloquee(avant, commerce)) {
          throw err(409, `Récompense pas encore débloquée : ${avant.tampons}/${commerce.seuilTampons} tampons.`)
        }
        const apres = action === 'visite' ? validerVisite(avant, commerce, maintenant()) : offrirRecompense(avant, commerce, maintenant())
        st.majClient(apres)
        return apres
      })
      return { json: { client } }
    }

    if (sous === 'clients' && sousId && action === 'pass.json' && m === 'GET') {
      // V3 — Google Wallet : architecture prête, NON branchée. Sans émetteur + clé de service → 501.
      // Même configuré, la charge utile renvoyée n'est PAS signée (signature JWT non implémentée).
      exigerCommercant(req, id)
      const client = clientOu404(id, sousId)
      if (!walletConfigure(o.googleWallet)) {
        throw err(501, 'Google Wallet à brancher : aucun compte émetteur ni clé de service configurés sur ce serveur. Aucun pass n’est généré.')
      }
      const site = (o.urlPublique || `http://${enTete(req, 'host') ?? 'localhost'}`).replace(/\/+$/, '')
      return {
        json: {
          avertissement: 'Charge utile NON signée : ce n’est pas un pass utilisable. La signature JWT « Save to Google Wallet » avec la clé de service n’est pas implémentée.',
          payload: payloadGoogleWallet(commerce, client, `${site}/#/carte/${client.id}`, o.googleWallet!.issuerId),
        },
      }
    }

    if (sous === 'clients' && sousId && action === 'relance' && m === 'POST') {
      // V3 — envoi SMS / e-mail préparé : 501 sans prestataire, et jamais sans consentement explicite du client.
      exigerCommercant(req, id)
      const client = clientOu404(id, sousId)
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
      const resultat = st.transaction(() => {
        const { client } = inscrireOuRetrouver(id, prenom, corps.contact)
        const t = maintenant()
        const statut = statutJeu(client, st.tiragesClient(id, client.id), id, t)
        if (statut === 'dejaJoue') return { refus: 'Vous avez déjà tourné la roue aujourd’hui. Revenez lors de votre prochaine visite !' }
        if (statut === 'sansVisite') return { refus: 'Pour jouer, faites d’abord valider votre visite du jour au comptoir.' }
        const jouables = lotsJouables(commerce.lots)
        if (!jouables.length) return { refus: 'Aucun lot n’est configuré pour le moment.' }
        const lot = jouables[tirerLot(commerce.lots)].libelle
        const tirage: Tirage = { id: `ti-${randomUUID()}`, commerceId: id, clientId: client.id, lot, date: t.toISOString(), code: codeGagnant() }
        st.ajouterTirage(tirage)
        return { tirage }
      })
      // Le client éventuellement créé reste inscrit même en cas de refus (la transaction est validée).
      if ('refus' in resultat) throw err(409, resultat.refus!)
      const { lot, code, date } = resultat.tirage!
      return { statut: 201, json: { lot, code, date, perdant: estPerdant(lot) } }
    }

    if (sous === 'avis' && !sousId && m === 'POST') {
      exigerCommercant(req, id)
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
      st.ajouterAvis(avis)
      return { statut: 201, json: { avis } }
    }

    if (sous === 'avis' && sousId && !action && m === 'PATCH') {
      exigerCommercant(req, id)
      const corps = await lireCorps(req)
      const inconnus = Object.keys(corps).filter((k) => k !== 'reponse' && k !== 'brouillon')
      if (inconnus.length) throw err(400, `Champ non modifiable : ${inconnus.join(', ')}.`)
      const avis = st.transaction(() => {
        const a = st.unAvis(id, sousId)
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
        st.majAvis(final)
        return final
      })
      return { json: { avis } }
    }

    throw err(404, 'Route inconnue.')
  }

  const serveur = createServer(async (req, res) => {
    const entetes: Record<string, string> = {
      'Access-Control-Allow-Origin': o.origineCors ?? '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Commerce-PIN, X-Admin-PIN',
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
    } catch (e) {
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
      st.fermer()
    },
  }
}

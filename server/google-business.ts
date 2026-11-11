// Google Business Profile (P1-B4) : OAuth 2.0 (scope business.manage), import des avis, publication des réponses.
// Préparé SANS compte Google : sans GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET, toutes les routes répondent 501 et rien
// n'est appelé chez Google. Le code d'appel est testé contre un Google SIMULÉ (fetch injecté) ; il n'a JAMAIS été
// exécuté contre les vraies API Google (aucun projet Cloud, aucune approbation, aucune clé).
//
// Points d'API (documentation Google relue le 10/11/2026, voir docs/GOOGLE-BUSINESS.md) :
// - OAuth : https://accounts.google.com/o/oauth2/v2/auth, https://oauth2.googleapis.com/token, …/revoke ;
// - comptes : GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts ;
// - fiches : GET https://mybusinessbusinessinformation.googleapis.com/v1/{accounts/*}/locations?readMask=… ;
// - avis : GET https://mybusiness.googleapis.com/v4/accounts/{a}/locations/{l}/reviews (pageSize ≤ 50, nextPageToken) ;
// - réponse : PUT https://mybusiness.googleapis.com/v4/accounts/{a}/locations/{l}/reviews/{r}/reply { comment }.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const SCOPE_BUSINESS = 'https://www.googleapis.com/auth/business.manage'
export const URL_AUTORISATION = 'https://accounts.google.com/o/oauth2/v2/auth'
export const URL_JETON = 'https://oauth2.googleapis.com/token'
export const URL_REVOCATION = 'https://oauth2.googleapis.com/revoke'
const URL_COMPTES = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts'
const URL_FICHES = 'https://mybusinessbusinessinformation.googleapis.com/v1'
const URL_AVIS = 'https://mybusiness.googleapis.com/v4'

export const MESSAGE_NON_BRANCHE =
  'Google Business à brancher : GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET ne sont pas configurés sur ce serveur (voir docs/GOOGLE-BUSINESS.md). Aucun appel n’a été fait à Google.'

export interface ConfigGoogleBusiness {
  clientId?: string
  clientSecret?: string
  /** URI de redirection déclarée chez Google ; absente = <adresse publique>/api/v1/commerces/<id>/google/callback. */
  redirectUri?: string
  /** Fiche à utiliser (`accounts/…/locations/…`) ; absente = trouvée à l'import (placeid du lien Google, ou fiche unique). */
  emplacement?: string
  /** Injectable pour les tests (aucun appel réseau réel dans les tests). */
  fetch?: typeof fetch
}

export type ConfigGoogleComplete = ConfigGoogleBusiness & { clientId: string; clientSecret: string }

/** GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET obligatoires ; GOOGLE_REDIRECT_URI et GOOGLE_BUSINESS_LOCATION facultatives. */
export function configGoogleBusinessDepuisEnv(env: Record<string, string | undefined>): ConfigGoogleBusiness {
  const v = (k: string) => env[k]?.trim() || undefined
  return { clientId: v('GOOGLE_CLIENT_ID'), clientSecret: v('GOOGLE_CLIENT_SECRET'), redirectUri: v('GOOGLE_REDIRECT_URI'), emplacement: v('GOOGLE_BUSINESS_LOCATION') }
}

export function googleBusinessConfigure(c: ConfigGoogleBusiness | undefined): c is ConfigGoogleComplete {
  return !!(c?.clientId && c.clientSecret)
}

/** Erreur côté Google (ou réponse illisible) : le message ne contient jamais de jeton ni le client secret. */
export class ErreurGoogle extends Error {
  statut: number
  /** `invalid_grant` : le refresh token n'est plus valable (accès retiré par le commerçant chez Google). */
  code?: string
  constructor(statut: number, message: string, code?: string) {
    super(message)
    this.statut = statut
    this.code = code
  }
}

// ---------- Jetons rangés côté serveur ----------

/** Ce qui est gardé en base (table `meta`, chiffré) : jamais renvoyé au navigateur. */
export interface JetonsGoogle {
  refreshToken: string
  accessToken?: string
  /** Fin de validité de l'access token (ISO). */
  expireLe?: string
  scope?: string
  connecteLe: string
  /** Fiche Google retrouvée au premier import (`accounts/…/locations/…`). */
  emplacement?: string
}

const cle = (secret: string, usage: string) => createHash('sha256').update(`fideliz:google-business:${usage}:${secret}`).digest()

/**
 * AES-256-GCM, clé dérivée du client secret : une copie de la base seule ne donne pas les jetons en clair. Changer de
 * client secret rend les jetons illisibles → le commerçant reconnecte Google (les anciens jetons ne servaient plus).
 */
export function chiffrerJetons(secret: string, j: JetonsGoogle): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', cle(secret, 'jetons'), iv)
  const chiffre = Buffer.concat([c.update(JSON.stringify(j), 'utf8'), c.final()])
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), chiffre.toString('base64url')].join('.')
}

/** null = rien de rangé, ou illisible (autre client secret, valeur altérée). */
export function dechiffrerJetons(secret: string, valeur: string | undefined): JetonsGoogle | null {
  if (!valeur) return null
  const [v, iv, tag, chiffre] = valeur.split('.')
  if (v !== 'v1' || !iv || !tag || !chiffre) return null
  try {
    const d = createDecipheriv('aes-256-gcm', cle(secret, 'jetons'), Buffer.from(iv, 'base64url'))
    d.setAuthTag(Buffer.from(tag, 'base64url'))
    const j = JSON.parse(Buffer.concat([d.update(Buffer.from(chiffre, 'base64url')), d.final()]).toString('utf8')) as JetonsGoogle
    return typeof j.refreshToken === 'string' && j.refreshToken ? j : null
  } catch {
    return null
  }
}

// ---------- Paramètre `state` (anti-CSRF) ----------

const DUREE_ETAT_MS = 10 * 60_000

/** `state` signé (HMAC, clé dérivée du client secret) : commerce + nonce + expiration (10 min). */
export function signerEtat(secret: string, commerceId: string, maintenant: Date): { etat: string; nonce: string } {
  const nonce = randomBytes(16).toString('base64url')
  const charge = Buffer.from(JSON.stringify({ c: commerceId, n: nonce, e: maintenant.getTime() + DUREE_ETAT_MS })).toString('base64url')
  return { etat: `${charge}.${createHmac('sha256', cle(secret, 'etat')).update(charge).digest('base64url')}`, nonce }
}

export function lireEtat(secret: string, etat: string, maintenant: Date): { commerceId: string; nonce: string } | null {
  const [charge, sig] = etat.split('.')
  if (!charge || !sig) return null
  const attendue = Buffer.from(createHmac('sha256', cle(secret, 'etat')).update(charge).digest('base64url'))
  const recue = Buffer.from(sig)
  if (attendue.length !== recue.length || !timingSafeEqual(attendue, recue)) return null
  try {
    const { c, n, e } = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8')) as { c: string; n: string; e: number }
    if (typeof c !== 'string' || typeof n !== 'string' || typeof e !== 'number' || e <= maintenant.getTime()) return null
    return { commerceId: c, nonce: n }
  } catch {
    return null
  }
}

// ---------- OAuth ----------

/** Écran de consentement Google : refresh token demandé (access_type=offline + prompt=consent). */
export function urlAutorisation(c: ConfigGoogleComplete, redirectUri: string, etat: string): string {
  const p = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE_BUSINESS,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: etat,
  })
  return `${URL_AUTORISATION}?${p}`
}

async function appelJeton(c: ConfigGoogleComplete, f: typeof fetch, params: Record<string, string>) {
  let r: Response
  try {
    r = await f(URL_JETON, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...params }).toString(),
    })
  } catch {
    throw new ErreurGoogle(502, 'Google injoignable (serveur d’authentification) : réessayez plus tard.')
  }
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string; error?: string }
  if (!r.ok || !j.access_token) {
    // Seul le code d'erreur OAuth (« invalid_grant »…) est repris : jamais le corps entier.
    const code = typeof j.error === 'string' ? j.error.replace(/[^\w.-]/g, '').slice(0, 40) : undefined
    if (code === 'invalid_grant') throw new ErreurGoogle(409, 'Connexion Google expirée ou retirée : reconnectez Google depuis l’écran Avis.', code)
    throw new ErreurGoogle(502, `Google a refusé la demande de jeton (HTTP ${r.status}${code ? `, ${code}` : ''}).`, code)
  }
  return j as { access_token: string; expires_in?: number; refresh_token?: string; scope?: string }
}

const finValidite = (maintenant: Date, expiresIn: number | undefined) => new Date(maintenant.getTime() + Math.max(0, (expiresIn ?? 3600) - 60) * 1000).toISOString()

/** Échange du code reçu sur la page de retour contre les jetons (refresh token exigé). */
export async function echangerCode(c: ConfigGoogleComplete, f: typeof fetch, code: string, redirectUri: string, maintenant: Date): Promise<JetonsGoogle> {
  const j = await appelJeton(c, f, { code, grant_type: 'authorization_code', redirect_uri: redirectUri })
  if (!j.refresh_token) {
    throw new ErreurGoogle(502, 'Google n’a pas fourni de jeton de rafraîchissement : retirez l’accès de l’app dans votre compte Google puis reconnectez-vous.')
  }
  return { refreshToken: j.refresh_token, accessToken: j.access_token, expireLe: finValidite(maintenant, j.expires_in), scope: j.scope, connecteLe: maintenant.toISOString() }
}

/** Jetons avec un access token valable : réutilisé s'il reste valable, sinon rafraîchi à partir du refresh token. */
export async function jetonsFrais(c: ConfigGoogleComplete, f: typeof fetch, j: JetonsGoogle, maintenant: Date): Promise<{ jetons: JetonsGoogle; rafraichi: boolean }> {
  if (j.accessToken && j.expireLe && new Date(j.expireLe).getTime() > maintenant.getTime()) return { jetons: j, rafraichi: false }
  const r = await appelJeton(c, f, { refresh_token: j.refreshToken, grant_type: 'refresh_token' })
  return {
    jetons: { ...j, accessToken: r.access_token, expireLe: finValidite(maintenant, r.expires_in), ...(r.refresh_token ? { refreshToken: r.refresh_token } : {}) },
    rafraichi: true,
  }
}

/** Révocation chez Google (best-effort : un jeton déjà invalide renvoie 400, ce n'est pas un échec pour nous). */
export async function revoquerJeton(f: typeof fetch, jeton: string): Promise<boolean> {
  try {
    const r = await f(URL_REVOCATION, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: jeton }).toString() })
    return r.ok
  } catch {
    return false
  }
}

// ---------- API Business Profile ----------

async function appelApi<T>(f: typeof fetch, accessToken: string, url: string, init: RequestInit = {}): Promise<T> {
  let r: Response
  try {
    r = await f(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${accessToken}` } })
  } catch {
    throw new ErreurGoogle(502, 'Google injoignable (API Business Profile) : réessayez plus tard.')
  }
  if (!r.ok) {
    const indice =
      r.status === 401 ? ' : accès refusé, reconnectez Google' : r.status === 403 ? ' : accès aux API Business Profile non accordé à ce projet (approbation Google ? API activées ?)' : r.status === 429 ? ' : quota dépassé (0 requête/min tant que Google n’a pas approuvé le projet)' : ''
    throw new ErreurGoogle(502, `L’API Google Business Profile a répondu HTTP ${r.status}${indice}.`)
  }
  return (await r.json().catch(() => ({}))) as T
}

/** Avis tel que renvoyé par l'API v4 (`accounts.locations.reviews`). */
export interface AvisGoogleBrut {
  name: string
  reviewId?: string
  reviewer?: { displayName?: string; isAnonymous?: boolean }
  starRating?: 'STAR_RATING_UNSPECIFIED' | 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE'
  comment?: string
  createTime?: string
  updateTime?: string
  reviewReply?: { comment?: string; updateTime?: string }
}

const PAGES_MAX = 40

/**
 * Réponse Google : 4 096 OCTETS au plus (limite de l'API Business Profile, référence Google
 * `ReviewReply.comment` — vérifié le 11/11/2026, pas des caractères : `'漢'.repeat(1400)` = 4 200 octets).
 * L'app plafonne ses réponses à 2 000 caractères (route PATCH avis) : une réponse de 2 000 caractères
 * multi-octets peut quand même dépasser 4 096 octets, d'où ce contrôle en octets ici.
 */
export const TAILLE_MAX_REPONSE_GOOGLE_OCTETS = 4096
/** Segments d'identifiant Google : lettres, chiffres, `.`, `_`, `-` — jamais `?`, `#`, `/` ni `.` / `..` (navigation). */
const SEGMENT_ID = String.raw`[A-Za-z0-9][A-Za-z0-9._-]*`
const NOM_AVIS_GOOGLE = new RegExp(`^accounts/${SEGMENT_ID}/locations/${SEGMENT_ID}/reviews/${SEGMENT_ID}$`)

/** Tous les avis d'une fiche (pages de 50, au plus 2 000 avis). */
export async function listerAvisGoogle(f: typeof fetch, accessToken: string, emplacement: string): Promise<AvisGoogleBrut[]> {
  if (!emplacementValide(emplacement)) {
    throw new ErreurGoogle(409, `Fiche Google invalide « ${emplacement} » : attendue « accounts/…/locations/… » (GOOGLE_BUSINESS_LOCATION, voir docs/GOOGLE-BUSINESS.md étape 6).`)
  }
  const tous: AvisGoogleBrut[] = []
  let page: string | undefined
  for (let i = 0; i < PAGES_MAX; i++) {
    const p = new URLSearchParams({ pageSize: '50' })
    if (page) p.set('pageToken', page)
    const r = await appelApi<{ reviews?: AvisGoogleBrut[]; nextPageToken?: string }>(f, accessToken, `${URL_AVIS}/${emplacement}/reviews?${p}`)
    tous.push(...(r.reviews ?? []).filter((a) => typeof a?.name === 'string' && a.name))
    page = r.nextPageToken
    if (!page) break
  }
  return tous
}

/** `https://…?placeid=ChIJ…` → `ChIJ…` (lien « écrire un avis » du commerce). */
export function placeIdDuLien(lien: string): string | undefined {
  try {
    return new URL(lien).searchParams.get('placeid') ?? undefined
  } catch {
    return undefined
  }
}

const EMPLACEMENT = new RegExp(`^accounts/${SEGMENT_ID}/locations/${SEGMENT_ID}$`)

/**
 * Fiche à utiliser : GOOGLE_BUSINESS_LOCATION si renseignée ; sinon parmi les fiches des comptes accessibles, celle dont
 * le placeId (`metadata.placeId`, champ à vérifier sur un vrai compte) est celui du lien Google, ou la seule fiche.
 */
export async function trouverEmplacement(f: typeof fetch, accessToken: string, placeId: string | undefined): Promise<string> {
  const comptes = (await appelApi<{ accounts?: { name?: string }[] }>(f, accessToken, `${URL_COMPTES}?pageSize=20`)).accounts ?? []
  const fiches: { emplacement: string; placeId?: string }[] = []
  for (const compte of comptes) {
    if (!compte.name) continue
    const p = new URLSearchParams({ readMask: 'name,title,metadata', pageSize: '100' })
    const r = await appelApi<{ locations?: { name?: string; metadata?: { placeId?: string } }[] }>(f, accessToken, `${URL_FICHES}/${compte.name}/locations?${p}`)
    for (const l of r.locations ?? []) {
      // L'API Business Information nomme la fiche `locations/{id}` ; l'API v4 des avis attend `accounts/{a}/locations/{l}`.
      const id = l.name?.split('/').pop()
      if (id) fiches.push({ emplacement: `${compte.name}/locations/${id}`, placeId: l.metadata?.placeId })
    }
  }
  const parPlace = placeId ? fiches.find((x) => x.placeId === placeId) : undefined
  if (parPlace) return parPlace.emplacement
  if (fiches.length === 1) return fiches[0].emplacement
  if (!fiches.length) throw new ErreurGoogle(409, 'Aucune fiche Google Business accessible avec ce compte Google : connectez le compte propriétaire ou gestionnaire de la fiche.')
  throw new ErreurGoogle(409, `${fiches.length} fiches Google accessibles et aucune ne correspond au lien Google du commerce : renseignez GOOGLE_BUSINESS_LOCATION (accounts/…/locations/…) sur le serveur.`)
}

export function emplacementValide(e: string | undefined): e is string {
  return !!e && EMPLACEMENT.test(e)
}

/**
 * Fiche à utiliser pour l'import : `GOOGLE_BUSINESS_LOCATION` si renseignée (sinon 409 explicite quand elle est
 * mal renseignée — jamais ignorée silencieusement), sinon la fiche mémorisée à la connexion, sinon `undefined`
 * (l'appelant cherche alors la fiche parmi celles du compte).
 */
export function emplacementAImporter(emplacementConfigure: string | undefined, emplacementStocke: string | undefined): string | undefined {
  if (emplacementConfigure !== undefined) {
    if (!emplacementValide(emplacementConfigure)) {
      throw new ErreurGoogle(409, `GOOGLE_BUSINESS_LOCATION mal renseignée : « ${emplacementConfigure} » — attendue « accounts/…/locations/… » (voir docs/GOOGLE-BUSINESS.md étape 6).`)
    }
    return emplacementConfigure
  }
  return emplacementValide(emplacementStocke) ? emplacementStocke : undefined
}

/** Publie (ou remplace) la réponse du propriétaire à un avis. `nomAvis` = `accounts/…/locations/…/reviews/…`. */
export async function publierReponseGoogle(f: typeof fetch, accessToken: string, nomAvis: string, commentaire: string): Promise<{ updateTime?: string }> {
  // Garde-fous avant tout appel à Google : une réponse vide ou trop longue serait refusée par l'API (502 opaque) ;
  // un identifiant d'avis mal formé aussi. Erreur explicite, aucun appel réseau.
  if (!NOM_AVIS_GOOGLE.test(nomAvis)) {
    throw new ErreurGoogle(400, `Identifiant d’avis Google invalide « ${nomAvis} » : attendu « accounts/…/locations/…/reviews/… ».`)
  }
  if (!commentaire.trim()) throw new ErreurGoogle(400, 'Réponse vide : rédigez et validez d’abord une réponse avant de la publier sur Google.')
  const octets = Buffer.byteLength(commentaire, 'utf8')
  if (octets > TAILLE_MAX_REPONSE_GOOGLE_OCTETS) {
    throw new ErreurGoogle(400, `Réponse trop longue (${octets} octets) : Google accepte au plus ${TAILLE_MAX_REPONSE_GOOGLE_OCTETS} octets.`)
  }
  return appelApi<{ updateTime?: string }>(f, accessToken, `${URL_AVIS}/${nomAvis}/reply`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment: commentaire }),
  })
}

// Google Wallet — génération RÉELLE, INACTIVE tant qu'aucun compte émetteur ni clé de service n'est fourni.
// • `payloadGoogleWallet` : classe + objet « Generic pass » d'une carte de fidélité (non signés).
// • `jwtGoogleWallet` : JWT « Save to Google Wallet » signé RS256 avec la clé du compte de service → lien
//   https://pay.google.com/gp/v/save/<jwt>. Sans GOOGLE_WALLET_ISSUER_ID + GOOGLE_WALLET_SERVICE_ACCOUNT_FILE,
//   la route renvoie 501 et RIEN n'est généré (aucun faux pass, aucun faux QR de pass).
// • `jetonAccesGoogle` / `enregistrerClasseGoogle` : appels REST à l'API Google Wallet (classe de carte), pour plus tard.
// Champs et adresses repris de la documentation Google Wallet (Generic pass, JWT « savetowallet ») ; à revérifier
// contre la console Google Pay & Wallet au moment de l'activation — aucun appel réel n'a pu être fait (pas de compte).
//
// Apple Wallet : EN SUSPENS (décision utilisateur) — voir `wallet-apple.ts` (code prêt, refuse sans certificat).
import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Client, Commerce } from '../src/types.ts'
import { tamponsAffiches } from '../src/lib/fidelite.ts'
import { COULEUR_DEFAUT } from '../src/lib/apparence.ts'

/** Valeur mise à la place de l'identifiant émetteur tant qu'aucun compte Google Wallet n'existe. */
export const ISSUER_PLACEHOLDER = 'ISSUER_ID_A_FOURNIR'
export const SCOPE_WALLET = 'https://www.googleapis.com/auth/wallet_object.issuer'
export const URL_API_WALLET = 'https://walletobjects.googleapis.com/walletobjects/v1'

export interface ConfigGoogleWallet {
  /** Identifiant émetteur (console Google Pay & Wallet) — variable GOOGLE_WALLET_ISSUER_ID. */
  issuerId?: string
  /** Chemin du fichier JSON de la clé du compte de service — variable GOOGLE_WALLET_SERVICE_ACCOUNT_FILE. */
  fichierCleService?: string
}

export interface CleService {
  client_email: string
  private_key: string
}

export class ErreurWallet extends Error {}

/** Vrai seulement si l'émetteur ET la clé de service sont fournis. */
export function walletConfigure(c: ConfigGoogleWallet | undefined): boolean {
  return !!(c?.issuerId && c.fichierCleService)
}

const texte = (valeur: string) => ({ defaultValue: { language: 'fr', value: valeur } })

/** Identifiant Google Wallet : `<issuerId>.<suffixe>`, suffixe limité à lettres, chiffres, `.`, `_`, `-`. */
const suffixe = (s: string) => s.replace(/[^\w.-]/g, '_')

/**
 * Classe + objet (NON signés) d'une carte de fidélité.
 * `urlCarte` = adresse publique de la carte (`<site>/#/carte/<clientId>`), encodée dans le QR.
 */
export function payloadGoogleWallet(commerce: Commerce, client: Client, urlCarte: string, issuerId = ISSUER_PLACEHOLDER) {
  const classId = `${issuerId}.${suffixe(`fidelite-${commerce.id}`)}`
  const tampons = tamponsAffiches(client, commerce)
  const modules = [
    { id: 'tampons', header: 'Tampons', body: `${tampons}/${commerce.seuilTampons}` },
    { id: 'recompense', header: 'Récompense', body: commerce.recompense },
  ]
  if (client.points != null) modules.push({ id: 'points', header: 'Points', body: String(client.points) })
  return {
    signe: false,
    genericClasses: [{ id: classId }],
    genericObjects: [
      {
        id: `${issuerId}.${suffixe(client.id)}`,
        classId,
        state: 'ACTIVE',
        cardTitle: texte(commerce.nom),
        subheader: texte('Carte de fidélité'),
        header: texte(client.prenom),
        hexBackgroundColor: commerce.apparence?.couleur ?? COULEUR_DEFAUT,
        textModulesData: modules,
        barcode: { type: 'QR_CODE', value: urlCarte, alternateText: client.prenom },
      },
    ],
  }
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')

/** JWT RS256 signé avec la clé privée du compte de service. */
export function signerJwt(revendications: object, cle: CleService): string {
  const tete = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const corps = b64url(JSON.stringify(revendications))
  const signature = createSign('RSA-SHA256').update(`${tete}.${corps}`).sign(cle.private_key)
  return `${tete}.${corps}.${b64url(signature)}`
}

/** Lit la clé de service (fichier JSON téléchargé depuis Google Cloud). Jamais de contenu de clé dans les messages. */
export function lireCleService(fichier: string): CleService {
  let cle: Partial<CleService>
  try {
    cle = JSON.parse(readFileSync(fichier, 'utf8')) as Partial<CleService>
  } catch {
    throw new ErreurWallet('Clé de service Google Wallet illisible (GOOGLE_WALLET_SERVICE_ACCOUNT_FILE) : aucun pass généré.')
  }
  if (typeof cle.client_email !== 'string' || typeof cle.private_key !== 'string' || !cle.private_key.includes('PRIVATE KEY')) {
    throw new ErreurWallet('Clé de service Google Wallet incomplète (client_email / private_key) : aucun pass généré.')
  }
  return cle as CleService
}

/** JWT « Save to Google Wallet » (classe + objet intégrés) et le lien d'ajout correspondant. */
export function jwtGoogleWallet(commerce: Commerce, client: Client, urlCarte: string, issuerId: string, cle: CleService, origine: string, maintenant = new Date()) {
  const { genericClasses, genericObjects } = payloadGoogleWallet(commerce, client, urlCarte, issuerId)
  const jwt = signerJwt(
    { iss: cle.client_email, aud: 'google', typ: 'savetowallet', iat: Math.floor(maintenant.getTime() / 1000), origins: [origine], payload: { genericClasses, genericObjects } },
    cle,
  )
  return { jwt, urlEnregistrement: `https://pay.google.com/gp/v/save/${jwt}` }
}

/** Lien d'ajout pour la route `pass.json` : lève ErreurWallet si la configuration manque ou est inutilisable. */
export function lienGoogleWallet(config: ConfigGoogleWallet | undefined, commerce: Commerce, client: Client, urlCarte: string, origine: string, maintenant = new Date()) {
  if (!walletConfigure(config)) throw new ErreurWallet('Google Wallet à brancher : aucun compte émetteur ni clé de service configurés sur ce serveur. Aucun pass n’est généré.')
  return jwtGoogleWallet(commerce, client, urlCarte, config!.issuerId!, lireCleService(config!.fichierCleService!), origine, maintenant)
}

/** Jeton OAuth 2.0 du compte de service (flux « JWT bearer ») pour l'API REST Google Wallet. */
export async function jetonAccesGoogle(cle: CleService, f: typeof fetch = fetch, maintenant = new Date()): Promise<string> {
  const iat = Math.floor(maintenant.getTime() / 1000)
  const assertion = signerJwt({ iss: cle.client_email, scope: SCOPE_WALLET, aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }, cle)
  const r = await f('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  })
  const j = (await r.json().catch(() => ({}))) as { access_token?: string }
  if (!r.ok || !j.access_token) throw new ErreurWallet(`Google OAuth a refusé la clé de service (HTTP ${r.status}).`)
  return j.access_token
}

/** Crée la classe de carte du commerce dans l'API Google Wallet (409 = existe déjà : accepté). */
export async function enregistrerClasseGoogle(commerce: Commerce, issuerId: string, jeton: string, f: typeof fetch = fetch): Promise<'creee' | 'existante'> {
  const id = `${issuerId}.${suffixe(`fidelite-${commerce.id}`)}`
  const r = await f(`${URL_API_WALLET}/genericClass`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  if (r.status === 409) return 'existante'
  if (!r.ok) throw new ErreurWallet(`API Google Wallet : création de la classe refusée (HTTP ${r.status}).`)
  return 'creee'
}

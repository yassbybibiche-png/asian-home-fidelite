// Page de jeu en mode API : le tirage est fait par le SERVEUR (POST /tirages). Le navigateur n'envoie
// qu'un contact et se contente d'animer la roue jusqu'au lot reçu. Logique pure, testée avec une API simulée.
import type { CommercePublic } from '../types'
import { ErreurApi, MESSAGE_HORS_LIGNE, type ActivationCode, type ClientApi, type ResultatTirage } from './api.ts'
import { secteurs, type LotRoue, type Secteur } from '../lib/roulette.ts'
import { estIdClientActuel } from '../lib/fidelite.ts'
import type { memoireJetons } from '../lib/jetonCarte.ts'

export type IssueTirage =
  | { ok: true; resultat: ResultatTirage; /** Secteur de la roue à amener sous le pointeur (null si les lots ont changé entre-temps). */ secteur: Secteur | null }
  | {
      ok: false
      message: string
      /** Serveur injoignable : rien n'a été joué. */ horsLigne: boolean
      /** Refus d'une règle (409) : sans visite du jour, déjà joué… */ refus: boolean
      /** 401 (P0-S7) : ce téléphone n'a plus de jeton valable pour la carte (expiré, révoqué) → « Retrouver ma carte ». */
      accesRefuse?: true
    }

/**
 * Secteur du lot tiré (R1) : retrouvé par l'id du lot que le serveur renvoie, jamais par son libellé — un lot renommé
 * entre le chargement de la page et le tirage, ou deux libellés proches, ne trompent pas la roue. Id inconnu de cette
 * roue (lots changés entre-temps) : null, la roue ne vise rien. Seule exception : réponse SANS id (serveur d'avant R1,
 * le temps d'un déploiement), où le libellé reste le seul repère.
 */
export function secteurDuLot(lots: LotRoue[], resultat: Pick<ResultatTirage, 'lot' | 'lotId'>): Secteur | null {
  const parts = secteurs(lots)
  if (resultat.lotId) return parts.find((s) => s.lot.id === resultat.lotId) ?? null
  return parts.find((s) => s.lot.libelle === resultat.lot) ?? null
}

/** `jeton` : jeton client du joueur (P0-S7) ; sans lui, un serveur en mode strict refuse le tirage (401). */
export async function lancerTirage(
  api: Pick<ClientApi, 'tirer'>,
  commerce: Pick<CommercePublic, 'id' | 'lots'>,
  contact: string,
  prenom?: string,
  jeton?: string | null,
): Promise<IssueTirage> {
  try {
    const resultat = await api.tirer(commerce.id, contact, prenom, undefined, jeton)
    return { ok: true, resultat, secteur: secteurDuLot(commerce.lots, resultat) }
  } catch (e) {
    if (e instanceof ErreurApi) return { ok: false, message: e.message, horsLigne: e.horsLigne, refus: e.statut === 409, ...(e.statut === 401 ? { accesRefuse: true as const } : {}) }
    return { ok: false, message: MESSAGE_HORS_LIGNE, horsLigne: true, refus: false }
  }
}

/** Joueur mémorisé sur SON téléphone (pour rejouer sans tout ressaisir) : son propre contact, rien d'autre. */
export interface JoueurMemorise {
  clientId: string
  prenom: string
  contact: string
}

/** Dernier gain sur ce téléphone, pour réafficher le code gagnant après un rechargement le même jour. */
export interface GainMemorise extends ResultatTirage {
  clientId: string
}

type Stockage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function lireJson<T>(s: Stockage | null, cle: string): T | null {
  try {
    const brut = s?.getItem(cle)
    return brut ? (JSON.parse(brut) as T) : null
  } catch {
    return null
  }
}

function ecrireJson(s: Stockage | null, cle: string, v: unknown | null) {
  try {
    if (v == null) s?.removeItem(cle)
    else s?.setItem(cle, JSON.stringify(v))
  } catch {
    // Stockage indisponible : on redemandera le prénom la prochaine fois.
  }
}

export function memoireJoueur(s: Stockage | null, commerceId: string) {
  const cleJoueur = `fidelite:joueur-api:${commerceId}`
  const cleGain = `fidelite:gain-api:${commerceId}`
  return {
    joueur: () => {
      const j = lireJson<JoueurMemorise>(s, cleJoueur)
      return j && typeof j.clientId === 'string' && typeof j.contact === 'string' ? j : null
    },
    memoriser: (j: JoueurMemorise | null) => ecrireJson(s, cleJoueur, j),
    gain: () => lireJson<GainMemorise>(s, cleGain),
    memoriserGain: (g: GainMemorise) => ecrireJson(s, cleGain, g),
  }
}

/** Marqueurs de scan déjà signalés dans CETTE page (repli quand sessionStorage est indisponible : navigation
 * privée stricte — le signal part alors une fois par affichage, pas à chaque remontage ; cf. StrictMode en dev). */
const scansSignalesMemoire = new Set<string>()

/**
 * Mesure anonyme (P2-Q3) : « page de jeu ouverte » (scan du QR ou lien), signalée UNE fois par onglet et par commerce
 * (`sessionStorage` : oublié à la fermeture de l'onglet, jamais envoyé). Rien d'autre que le type ne part : ni carte,
 * ni contact. Échec réseau / 429 : ignoré, la page n'attend jamais cette requête. Renvoie true si le signal est parti.
 */
export function signalerScan(api: Pick<ClientApi, 'signalerEvenement'>, commerceId: string, session: Stockage | null): boolean {
  const cle = `fidelite:scan:${commerceId}`
  if (scansSignalesMemoire.has(cle)) return false
  try {
    if (session?.getItem(cle)) return false
    session?.setItem(cle, '1')
  } catch {
    // Stockage indisponible (navigation privée stricte) : on s'appuie sur la garde mémoire ci-dessous.
  }
  scansSignalesMemoire.add(cle)
  api.signalerEvenement(commerceId, 'scan').catch(() => {})
  return true
}

/**
 * Scan déjà compté par le serveur (arrivée par la redirection courte `/r/` : `?via=qr`) : on pose le marqueur de
 * l'onglet SANS envoyer de signal, pour qu'un rechargement ou un remontage de la page ne recompte pas le scan
 * (P2-Q3, revue Codex : sans ce marqueur, le serveur comptait 1 puis la page 1 de plus au rechargement).
 */
export function marquerScanSignale(session: Stockage | null, commerceId: string): void {
  const cle = `fidelite:scan:${commerceId}`
  scansSignalesMemoire.add(cle)
  try {
    session?.setItem(cle, '1')
  } catch {
    // Stockage indisponible : la garde mémoire ci-dessus suffit pour cet affichage.
  }
}

// ---------- Activation du code gagnant (R3, burn-on-reveal) ----------

export type IssueActivation =
  | { ok: true; activation: ActivationCode }
  | {
      ok: false
      message: string
      horsLigne: boolean
      /** 409 / 410 : pas encore utilisable (dès demain), expiré, déjà remis — le message du serveur le dit. */
      refus: boolean
      /** 401 : plus de jeton valable sur ce téléphone pour cette carte → « Retrouver ma carte ». */
      accesRefuse?: true
    }

/**
 * « Utiliser mon gain » : demande au serveur le code du tirage, valable 10 minutes en caisse, avec le jeton client de
 * la carte rangé sur ce téléphone (seule façon d'obtenir un code depuis R3). Sans jeton : refus d'accès, sans appel.
 */
export async function activerCode(
  api: Pick<ClientApi, 'activerCode'>,
  jetons: Pick<Jetons, 'lire'>,
  gain: { commerceId: string; clientId: string; tirageId: string },
): Promise<IssueActivation> {
  const jeton = jetons.lire(gain.clientId)?.jeton
  if (!jeton) return { ok: false, message: 'Ouvrez votre carte sur ce téléphone pour utiliser votre gain.', horsLigne: false, refus: false, accesRefuse: true }
  try {
    return { ok: true, activation: await api.activerCode(gain.commerceId, gain.tirageId, jeton) }
  } catch (e) {
    if (e instanceof ErreurApi) {
      return { ok: false, message: e.message, horsLigne: e.horsLigne, refus: e.statut === 409 || e.statut === 410, ...(e.statut === 401 ? { accesRefuse: true as const } : {}) }
    }
    return { ok: false, message: MESSAGE_HORS_LIGNE, horsLigne: true, refus: false }
  }
}

// ---------- Jeton client (P0-S7) ----------

type Jetons = ReturnType<typeof memoireJetons>

/**
 * Carte ouverte EN ENTIER sur ce téléphone (jeton valable : inscription, QR du comptoir, « Retrouver ma carte ») : elle
 * devient le joueur de la page de jeu de son commerce, pour tourner la roue sans ressaisir de contact (le serveur fait
 * jouer la carte du jeton). Contact vide : il n'est plus lu quand le jeton est présent. La dernière carte ouverte
 * ainsi l'emporte sur un autre joueur mémorisé (« Ce n’est pas moi » reste possible). Renvoie true si la mémoire a changé.
 */
export function memoriserJoueurCarte(
  memoire: Pick<ReturnType<typeof memoireJoueur>, 'joueur' | 'memoriser'>,
  jetons: Pick<Jetons, 'lire'>,
  client: { id: string; prenom?: string },
): boolean {
  const actuel = memoire.joueur()
  if (actuel?.clientId === client.id) {
    if (actuel.prenom === (client.prenom ?? '') || !client.prenom) return false
    memoire.memoriser({ ...actuel, prenom: client.prenom })
    return true
  }
  if (!jetons.lire(client.id)) return false
  memoire.memoriser({ clientId: client.id, prenom: client.prenom ?? '', contact: '' })
  return true
}
type AppelsCarte = Pick<
  ClientApi,
  'carte' | 'tirer' | 'prenomCarte' | 'messagePrive' | 'profil' | 'declarerRattrapage' | 'donneesCarte' | 'demanderSuppression' | 'marquerLus'
>

/**
 * La même API, dont chaque appel « carte » porte le jeton client rangé sur ce téléphone (P0-S7) : celui de la carte
 * visée, ou — pour le tirage, qui ne nomme pas de carte — celui du joueur actif. Un jeton passé explicitement prime.
 */
export function avecJetonClient<A extends AppelsCarte>(api: A, jetons: Pick<Jetons, 'lire'>, joueurActif: () => string | null = () => null): A {
  const de = (clientId: string | null | undefined) => (clientId ? (jetons.lire(clientId)?.jeton ?? null) : null)
  return {
    ...api,
    carte: (clientId, jeton) => api.carte(clientId, jeton ?? de(clientId)),
    tirer: (commerceId, contact, prenom, parrain, jeton) => api.tirer(commerceId, contact, prenom, parrain, jeton ?? de(joueurActif())),
    prenomCarte: (commerceId, clientId, contact, prenom, jeton) => api.prenomCarte(commerceId, clientId, contact, prenom, jeton ?? de(clientId)),
    messagePrive: (commerceId, clientId, contact, note, texte, jeton) => api.messagePrive(commerceId, clientId, contact, note, texte, jeton ?? de(clientId)),
    profil: (commerceId, clientId, champs, jeton) => api.profil(commerceId, clientId, champs, jeton ?? de(clientId)),
    declarerRattrapage: (commerceId, clientId, champs, jeton) => api.declarerRattrapage(commerceId, clientId, champs, jeton ?? de(clientId)),
    donneesCarte: (clientId, contact, jeton) => api.donneesCarte(clientId, contact, jeton ?? de(clientId)),
    demanderSuppression: (clientId, contact, jeton) => api.demanderSuppression(clientId, contact, jeton ?? de(clientId)),
    marquerLus: (clientId, jeton) => api.marquerLus(clientId, jeton ?? de(clientId)),
  }
}

/**
 * Jeton client de cette carte sur ce téléphone, renouvelé ou obtenu au besoin, puis rangé :
 * • `lien` (adresse `?acces=…` : comptoir, « Retrouver ma carte ») → échangé (usage unique) ;
 * • jeton qui expire bientôt → renouvelé ; refusé (révoqué) → oublié ;
 * • aucun jeton, carte à ANCIEN identifiant → demandé sans preuve (accordé par le serveur pendant la période de grâce
 *   seulement), une seule fois par affichage (`dejaEssaye`) : une page qui se rafraîchit ne martèle pas le serveur.
 * Échec : le jeton gardé (ou null) — la page continue en vue limitée, ou sans jeton sur un serveur en mode transition.
 */
export async function assurerJetonClient(
  api: Pick<ClientApi, 'jetonCarte'>,
  jetons: Jetons,
  clientId: string,
  options: { lien?: string | null; dejaEssaye?: Set<string> } = {},
): Promise<{ jeton: string | null; lienRefuse: boolean }> {
  const ranger = (r: { jeton: string; expireLe: string }) => (jetons.ecrire(clientId, { jeton: r.jeton, expireLe: r.expireLe }), r.jeton)
  let lienRefuse = false
  if (options.lien) {
    try {
      return { jeton: ranger(await api.jetonCarte(clientId, { lien: options.lien })), lienRefuse }
    } catch (e) {
      lienRefuse = e instanceof ErreurApi && e.statut === 401
    }
  }
  const garde = jetons.lire(clientId)
  if (garde) {
    if (!jetons.aRenouveler(garde)) return { jeton: garde.jeton, lienRefuse }
    try {
      return { jeton: ranger(await api.jetonCarte(clientId, { jeton: garde.jeton })), lienRefuse }
    } catch (e) {
      if (e instanceof ErreurApi && e.statut === 401) {
        jetons.ecrire(clientId, null)
        return { jeton: null, lienRefuse }
      }
      return { jeton: garde.jeton, lienRefuse }
    }
  }
  if (estIdClientActuel(clientId) || options.dejaEssaye?.has(clientId)) return { jeton: null, lienRefuse }
  options.dejaEssaye?.add(clientId)
  try {
    return { jeton: ranger(await api.jetonCarte(clientId)), lienRefuse }
  } catch {
    return { jeton: null, lienRefuse }
  }
}

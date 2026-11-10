// Page de jeu en mode API : le tirage est fait par le SERVEUR (POST /tirages). Le navigateur n'envoie
// qu'un contact et se contente d'animer la roue jusqu'au lot reçu. Logique pure, testée avec une API simulée.
import type { CommercePublic } from '../types'
import { ErreurApi, MESSAGE_HORS_LIGNE, type ClientApi, type ResultatTirage } from './api.ts'
import { secteurs, type Secteur } from '../lib/roulette.ts'

export type IssueTirage =
  | { ok: true; resultat: ResultatTirage; /** Secteur de la roue à amener sous le pointeur (null si les lots ont changé entre-temps). */ secteur: Secteur | null }
  | { ok: false; message: string; /** Serveur injoignable : rien n'a été joué. */ horsLigne: boolean; /** Refus d'une règle (409) : sans visite du jour, déjà joué… */ refus: boolean }

export async function lancerTirage(api: Pick<ClientApi, 'tirer'>, commerce: Pick<CommercePublic, 'id' | 'lots'>, contact: string, prenom?: string): Promise<IssueTirage> {
  try {
    const resultat = await api.tirer(commerce.id, contact, prenom)
    return { ok: true, resultat, secteur: secteurs(commerce.lots).find((s) => s.lot.libelle === resultat.lot) ?? null }
  } catch (e) {
    if (e instanceof ErreurApi) return { ok: false, message: e.message, horsLigne: e.horsLigne, refus: e.statut === 409 }
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

/**
 * Mesure anonyme (P2-Q3) : « page de jeu ouverte » (scan du QR ou lien), signalée UNE fois par onglet et par commerce
 * (`sessionStorage` : oublié à la fermeture de l'onglet, jamais envoyé). Rien d'autre que le type ne part : ni carte,
 * ni contact. Échec réseau / 429 : ignoré, la page n'attend jamais cette requête. Renvoie true si le signal est parti.
 */
export function signalerScan(api: Pick<ClientApi, 'signalerEvenement'>, commerceId: string, session: Stockage | null): boolean {
  const cle = `fidelite:scan:${commerceId}`
  try {
    if (session?.getItem(cle)) return false
    session?.setItem(cle, '1')
  } catch {
    // Stockage indisponible (navigation privée stricte) : le signal part quand même, une fois par affichage.
  }
  api.signalerEvenement(commerceId, 'scan').catch(() => {})
  return true
}

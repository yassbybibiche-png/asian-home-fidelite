// Commandes à table (Expérience 10/10), rangées dans la table `meta` (aucune migration) :
// - `commande:<commerceId>:<id>`          → la commande (JSON) ;
// - `commandes:<commerceId>:<jourParis>`  → index du jour : liste JSON des ids, dans l'ordre d'arrivée ;
// - `commande-idem:<commerceId>:<clé>`    → id de la commande créée avec cette clé d'idempotence.
// Toute écriture d'une clé existante est conditionnelle (`majMetaSi` : comparaison-et-échange sur la valeur lue) ;
// une clé neuve est posée par `majMetaSi(cle, undefined, …)` (insertion seulement si absente). Les deux stockages le
// font en une requête atomique : SQLite `INSERT … ON CONFLICT DO NOTHING` / `UPDATE … WHERE valeur = ?`, Supabase
// INSERT (clé primaire : le second échoue) / `UPDATE … eq('valeur', attendue)`.
import type { Commande, StatutCommande } from '../src/types.ts'
import { jourParis, transitionValide } from '../src/lib/commande.ts'
import type { Stockage } from './stockage.ts'

/** Réessais de l'ajout à l'index du jour quand une autre commande l'a modifié entre la lecture et l'écriture. */
export const ESSAIS_INDEX = 8

export const cleCommande = (commerceId: string, id: string) => `commande:${commerceId}:${id}`
export const cleIndexCommandes = (commerceId: string, jour: string) => `commandes:${commerceId}:${jour}`
export const cleIdempotence = (commerceId: string, cle: string) => `commande-idem:${commerceId}:${cle}`

/** Écriture perdue face à une écriture simultanée (le routeur répond 409 « réessayez »). */
export class ConflitCommande extends Error {}
/** Transition de statut interdite (le routeur répond 400). */
export class TransitionInvalide extends Error {}
/** Commande absente de CE commerce (le routeur répond 404). */
export class CommandeIntrouvable extends Error {}

function lireJson<T>(brut: string | undefined): T | undefined {
  if (!brut) return undefined
  try {
    return JSON.parse(brut) as T
  } catch {
    return undefined
  }
}

const idsIndex = (brut: string | undefined) => {
  const v = lireJson<unknown>(brut)
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export async function lireCommande(st: Stockage, commerceId: string, id: string): Promise<Commande | undefined> {
  const c = lireJson<Commande>(await st.meta(cleCommande(commerceId, id)))
  // Défense en profondeur : la clé contient déjà le commerce, la commande lue doit aussi le dire.
  return c && c.commerceId === commerceId && c.id === id ? c : undefined
}

/** Commandes d'un jour (AAAA-MM-JJ, Paris), par `creeLe` croissant. */
export async function listerCommandes(st: Stockage, commerceId: string, jour: string): Promise<Commande[]> {
  const ids = idsIndex(await st.meta(cleIndexCommandes(commerceId, jour)))
  const commandes: Commande[] = []
  for (const id of ids) {
    const c = await lireCommande(st, commerceId, id)
    if (c) commandes.push(c)
  }
  return commandes.sort((a, b) => (a.creeLe < b.creeLe ? -1 : a.creeLe > b.creeLe ? 1 : 0))
}

async function ajouterAIndex(st: Stockage, commerceId: string, jour: string, id: string) {
  const cle = cleIndexCommandes(commerceId, jour)
  for (let i = 0; i < ESSAIS_INDEX; i++) {
    const lu = await st.meta(cle)
    const ids = idsIndex(lu)
    if (ids.includes(id)) return
    if (await st.majMetaSi(cle, lu, JSON.stringify([...ids, id]))) return
  }
  throw new ConflitCommande('Trop de commandes simultanées : réessayez.')
}

/**
 * Crée la commande (`commande.secret` déjà tiré par l'appelant). Clé d'idempotence déjà posée → aucune écriture : la
 * commande existante est rendue avec `doublon: true` (ConflitCommande si elle est encore en cours d'écriture par la
 * première requête). Échec après la pose de la clé → clé et commande retirées (au mieux) : un nouvel essai recrée.
 */
/** Commande déjà créée avec cette clé d'idempotence (lecture seule ; undefined = clé libre ou écriture en cours). */
export async function commandeDejaCreee(st: Stockage, commerceId: string, cle: string): Promise<Commande | undefined> {
  const id = await st.meta(cleIdempotence(commerceId, cle))
  return id ? lireCommande(st, commerceId, id) : undefined
}

export async function creerCommande(st: Stockage, commande: Commande, cle: string): Promise<{ commande: Commande; doublon: boolean }> {
  const { commerceId, id } = commande
  const cleIdem = cleIdempotence(commerceId, cle)
  if (!(await st.majMetaSi(cleIdem, undefined, id))) {
    const deja = await commandeDejaCreee(st, commerceId, cle)
    if (!deja) throw new ConflitCommande('Commande en cours d’enregistrement : réessayez dans un instant.')
    return { commande: deja, doublon: true }
  }
  let ecrite = false
  try {
    if (!(await st.majMetaSi(cleCommande(commerceId, id), undefined, JSON.stringify(commande)))) throw new ConflitCommande('Identifiant de commande déjà pris : réessayez.')
    ecrite = true
    await ajouterAIndex(st, commerceId, jourParis(new Date(commande.creeLe)), id)
  } catch (e) {
    // La commande n'est pas dans l'index (invisible en cuisine) : on défait, pour qu'un nouvel essai la recrée.
    for (const k of ecrite ? [cleCommande(commerceId, id), cleIdem] : [cleIdem]) {
      try {
        await st.supprimerMeta(k)
      } catch {
        // Au mieux : l'erreur d'origine est celle qui compte.
      }
    }
    throw e
  }
  return { commande, doublon: false }
}

/**
 * Passe la commande au statut `vers` : relue, transition vérifiée, écrite seulement si la valeur en base est encore
 * celle relue (une autre transition passée entre-temps → ConflitCommande). Aucune écriture sans comparaison-et-échange.
 */
export async function changerStatut(st: Stockage, commerceId: string, id: string, vers: StatutCommande, maintenant = new Date()): Promise<Commande> {
  const cle = cleCommande(commerceId, id)
  const brut = await st.meta(cle)
  const c = lireJson<Commande>(brut)
  if (!brut || !c || c.commerceId !== commerceId || c.id !== id) throw new CommandeIntrouvable('Commande introuvable.')
  if (!transitionValide(c.statut, vers)) throw new TransitionInvalide(`Transition impossible : « ${c.statut} » → « ${vers} ».`)
  const maj: Commande = { ...c, statut: vers, majLe: maintenant.toISOString() }
  if (!(await st.majMetaSi(cle, brut, JSON.stringify(maj)))) throw new ConflitCommande('La commande vient d’être modifiée par ailleurs : rechargez puis réessayez.')
  return maj
}

/** La commande telle qu'on la montre (client avec son secret, commerçant) : jamais le secret. */
export function sansSecret(c: Commande): Omit<Commande, 'secret'> {
  const reste: Partial<Commande> = { ...c }
  delete reste.secret
  return reste as Omit<Commande, 'secret'>
}

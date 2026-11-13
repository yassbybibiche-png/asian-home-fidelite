// Commandes à table (Expérience 10/10), rangées dans la table `meta` (aucune migration) :
// - `commande:<commerceId>:<id>`          → la commande (JSON) ;
// - `commandes:<commerceId>:<jourParis>`  → index du jour : liste JSON des ids, dans l'ordre d'arrivée ;
// - `commande-idem:<commerceId>:<clé>`    → id de la commande créée avec cette clé d'idempotence ;
// - `commandes-purge:<commerceId>:<jour>` → entrée de purge du jour (lot 4) : `{ commandes, idempotences }`, ids et clés
//   d'idempotence (sans préfixe) à supprimer avec le jour ;
// - `commandes-purge-faite:<commerceId>`  → date ISO de la dernière purge (une par 24 h, déclenchée à la création).
// Toute écriture d'une clé existante est conditionnelle (`majMetaSi` : comparaison-et-échange sur la valeur lue) ;
// une clé neuve est posée par `majMetaSi(cle, undefined, …)` (insertion seulement si absente). Les deux stockages le
// font en une requête atomique : SQLite `INSERT … ON CONFLICT DO NOTHING` / `UPDATE … WHERE valeur = ?`, Supabase
// INSERT (clé primaire : le second échoue) / `UPDATE … eq('valeur', attendue)`.
import type { Commande, StatutCommande } from '../src/types.ts'
import { jourParis, transitionValide } from '../src/lib/commande.ts'
import { ajouterJours } from '../src/lib/mesure.ts'
import type { Stockage } from './stockage.ts'

/** Réessais de l'ajout à l'index du jour quand une autre commande l'a modifié entre la lecture et l'écriture. */
export const ESSAIS_INDEX = 8

/** Jours de Paris gardés : un jour strictement plus vieux (J-31 et avant) est purgé — commandes, secrets, index. */
export const CONSERVATION_COMMANDES_JOURS = 30
/** Intervalle minimal entre deux purges d'un même commerce (déclenchées par la création d'une commande). */
export const INTERVALLE_PURGE_MS = 24 * 60 * 60 * 1000
/** Aucune commande avant ce jour (module livré en novembre 2026) : borne de la toute première purge d'un commerce. */
export const PREMIER_JOUR_COMMANDES = '2026-11-01'

export const cleCommande = (commerceId: string, id: string) => `commande:${commerceId}:${id}`
export const cleIndexCommandes = (commerceId: string, jour: string) => `commandes:${commerceId}:${jour}`
export const cleIdempotence = (commerceId: string, cle: string) => `commande-idem:${commerceId}:${cle}`
export const cleEntreePurge = (commerceId: string, jour: string) => `commandes-purge:${commerceId}:${jour}`
export const clePurgeFaite = (commerceId: string) => `commandes-purge-faite:${commerceId}`

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

interface EntreePurge {
  commandes: string[]
  idempotences: string[]
}

function lireEntreePurge(brut: string | undefined): EntreePurge {
  const v = lireJson<Partial<EntreePurge>>(brut)
  const chaines = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [])
  return { commandes: chaines(v?.commandes), idempotences: chaines(v?.idempotences) }
}

/** Ajoute l'id et la clé d'idempotence à l'entrée de purge du jour (même patron que l'index : CAS + réessai). */
async function ajouterAPurge(st: Stockage, commerceId: string, jour: string, id: string, cle: string) {
  const k = cleEntreePurge(commerceId, jour)
  for (let i = 0; i < ESSAIS_INDEX; i++) {
    const lu = await st.meta(k)
    const e = lireEntreePurge(lu)
    if (e.commandes.includes(id) && e.idempotences.includes(cle)) return
    const maj: EntreePurge = {
      commandes: e.commandes.includes(id) ? e.commandes : [...e.commandes, id],
      idempotences: e.idempotences.includes(cle) ? e.idempotences : [...e.idempotences, cle],
    }
    if (await st.majMetaSi(k, lu, JSON.stringify(maj))) return
  }
  throw new ConflitCommande('Trop de commandes simultanées : réessayez.')
}

/**
 * Commande déjà créée avec cette clé d'idempotence (lecture seule). undefined = clé libre, OU clé orpheline : elle
 * pointe une commande absente (purgée, ou création défaite dont la clé n'a pas pu être retirée) — `creerCommande` la
 * reprend. Il n'y a pas d'état « clé posée, commande pas encore écrite » : la commande est écrite AVANT la clé.
 */
export async function commandeDejaCreee(st: Stockage, commerceId: string, cle: string): Promise<Commande | undefined> {
  const id = await st.meta(cleIdempotence(commerceId, cle))
  return id ? lireCommande(st, commerceId, id) : undefined
}

async function supprimerAuMieux(st: Stockage, cles: string[]) {
  for (const k of cles) {
    try {
      await st.supprimerMeta(k)
    } catch {
      // Au mieux : l'erreur d'origine est celle qui compte (une commande hors index reste couverte par l'entrée de purge).
    }
  }
}

/**
 * Crée la commande (`commande.secret` fourni par le navigateur), dans cet ordre : (1) entrée de purge du jour (ids et clé
 * listés d'avance : tout ce qui sera écrit ensuite est purgeable, même après un échec), (2) la commande, (3) la clé
 * d'idempotence, (4) l'index du jour. Clé déjà posée vers une commande existante → la commande neuve est retirée et
 * l'existante rendue avec `doublon: true` ; clé orpheline (commande absente) → reprise par comparaison-et-échange.
 * Échec après la pose de la clé → clé PUIS commande retirées (au mieux) : un nouvel essai recrée.
 */
export async function creerCommande(st: Stockage, commande: Commande, cle: string): Promise<{ commande: Commande; doublon: boolean }> {
  const { commerceId, id } = commande
  const cleIdem = cleIdempotence(commerceId, cle)
  const cleCmd = cleCommande(commerceId, id)
  const jour = jourParis(new Date(commande.creeLe))
  await ajouterAPurge(st, commerceId, jour, id, cle)
  if (!(await st.majMetaSi(cleCmd, undefined, JSON.stringify(commande)))) throw new ConflitCommande('Identifiant de commande déjà pris : réessayez.')
  let posee = false
  try {
    for (let i = 0; i < ESSAIS_INDEX && !posee; i++) {
      // Insertion d'abord (cas courant : clé neuve) ; sinon on lit à qui elle est.
      if (await st.majMetaSi(cleIdem, undefined, id)) {
        posee = true
        break
      }
      const lu = await st.meta(cleIdem)
      if (lu === undefined) continue // retirée entre-temps (création défaite) : on retente l'insertion
      const deja = await lireCommande(st, commerceId, lu)
      if (deja) {
        await supprimerAuMieux(st, [cleCmd])
        return { commande: deja, doublon: true }
      }
      posee = await st.majMetaSi(cleIdem, lu, id) // orpheline : reprise, sauf si une autre requête l'a reprise avant
    }
    if (!posee) throw new ConflitCommande('Commande en cours d’enregistrement : réessayez dans un instant.')
    await ajouterAIndex(st, commerceId, jour, id)
  } catch (e) {
    // La commande n'est pas dans l'index (invisible en cuisine) : on défait, pour qu'un nouvel essai la recrée. La clé
    // d'abord : retirée avant la commande, elle ne pointe jamais, même un instant, une commande en train de disparaître.
    await supprimerAuMieux(st, posee ? [cleIdem, cleCmd] : [cleCmd])
    throw e
  }
  return { commande, doublon: false }
}

/**
 * Purge les jours de Paris strictement plus vieux que CONSERVATION_COMMANDES_JOURS (J-31 et avant), de `depuis`
 * (inclus) à J-31 : clés d'idempotence listées (seulement si elles pointent encore une commande du jour), commandes de
 * l'index ET de l'entrée de purge, puis l'index et l'entrée eux-mêmes en dernier (purge interrompue = reprise au
 * prochain passage). Rejouer la purge ne fait rien. Rend le nombre de commandes supprimées.
 */
export async function purgerCommandesAnciennes(st: Stockage, commerceId: string, maintenant: Date, depuis = PREMIER_JOUR_COMMANDES): Promise<number> {
  const dernier = ajouterJours(jourParis(maintenant), -(CONSERVATION_COMMANDES_JOURS + 1))
  let supprimees = 0
  for (let jour = depuis; jour <= dernier; jour = ajouterJours(jour, 1)) {
    const cleIndex = cleIndexCommandes(commerceId, jour)
    const clePurge = cleEntreePurge(commerceId, jour)
    const brutIndex = await st.meta(cleIndex)
    const brutPurge = await st.meta(clePurge)
    if (brutIndex === undefined && brutPurge === undefined) continue
    const entree = lireEntreePurge(brutPurge)
    const ids = [...new Set([...idsIndex(brutIndex), ...entree.commandes])]
    for (const cle of entree.idempotences) {
      const k = cleIdempotence(commerceId, cle)
      const pointe = await st.meta(k)
      if (pointe !== undefined && ids.includes(pointe)) await st.supprimerMeta(k)
    }
    for (const id of ids) {
      const k = cleCommande(commerceId, id)
      if ((await st.meta(k)) === undefined) continue
      await st.supprimerMeta(k)
      supprimees++
    }
    await st.supprimerMeta(cleIndex)
    await st.supprimerMeta(clePurge)
  }
  return supprimees
}

/**
 * Purge opportuniste (création d'une commande) : rien si la dernière date de moins de INTERVALLE_PURGE_MS ; sinon
 * purge depuis le dernier jour couvert (J-31 de la dernière purge, avec une semaine de recouvrement) puis marque.
 * Rend true si une purge a eu lieu. Les erreurs remontent : l'appelant les avale (une vente n'attend jamais la purge).
 */
export async function purgerSiDue(st: Stockage, commerceId: string, maintenant: Date): Promise<boolean> {
  const cle = clePurgeFaite(commerceId)
  const derniere = await st.meta(cle)
  const t = derniere ? Date.parse(derniere) : NaN
  if (Number.isFinite(t) && maintenant.getTime() - t < INTERVALLE_PURGE_MS) return false
  const depuis = Number.isFinite(t) ? ajouterJours(jourParis(new Date(t)), -(CONSERVATION_COMMANDES_JOURS + 8)) : PREMIER_JOUR_COMMANDES
  await purgerCommandesAnciennes(st, commerceId, maintenant, depuis < PREMIER_JOUR_COMMANDES ? PREMIER_JOUR_COMMANDES : depuis)
  await st.majMeta(cle, maintenant.toISOString())
  return true
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

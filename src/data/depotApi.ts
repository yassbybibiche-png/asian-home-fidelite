// Dépôt « API » : mêmes méthodes de lecture que `Depot` (charger / enregistrer / reinitialiser), qui
// travaillent sur un CACHE local (dernières données connues, pour afficher quelque chose hors ligne),
// plus `chargerServeur`, asynchrone, qui fait foi.
//
// Conflits : le serveur fait foi. Chaque chargement réussi REMPLACE entièrement le cache ; aucune
// modification n'est faite « en local d'abord » (pas de file d'attente hors ligne) : une action qui
// échoue faute de réseau est refusée avec un message, jamais simulée.
import type { Commerce, Etat } from '../types'
import type { Depot } from './depot'
import { ErreurApi, type Acces, type ClientApi } from './api.ts'

type Stockage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const etatVide = (): Etat => ({ commerces: [], clients: [], tirages: [], avis: [], commerceActifId: '' })

interface Cache {
  etat: Etat
  /** Date ISO du dernier chargement réussi depuis le serveur. */
  synchroLe: string
}

export interface DepotApi extends Depot {
  /** Date ISO de la dernière synchronisation réussie (celle des données en cache), ou null. */
  derniereSynchro(): string | null
  /** Charge depuis le serveur (fait foi), met le cache à jour. Lève `ErreurApi` en cas d'échec. */
  chargerServeur(acces: Acces | null, commerceActifId?: string): Promise<Etat>
}

/** Commerces dont les données privées sont accessibles avec ce PIN. */
export function commercesAccessibles(etat: { commerces: Pick<Commerce, 'id'>[] }, acces: Acces | null): string[] {
  if (!acces) return []
  return acces.role === 'admin' ? etat.commerces.map((c) => c.id) : etat.commerces.filter((c) => c.id === acces.commerceId).map((c) => c.id)
}

export function creerDepotApi(api: ClientApi, stockage: Stockage | null, maintenant = () => new Date()): DepotApi {
  const cle = `fidelite:cache-api:v1:${api.base}`

  function lire(): Cache | null {
    try {
      const brut = stockage?.getItem(cle)
      const c = brut ? (JSON.parse(brut) as Cache) : null
      return c && Array.isArray(c.etat?.commerces) && Array.isArray(c.etat.clients) ? c : null
    } catch {
      return null
    }
  }

  function ecrire(etat: Etat, synchroLe: string) {
    try {
      stockage?.setItem(cle, JSON.stringify({ etat, synchroLe } satisfies Cache))
    } catch {
      // Stockage plein ou désactivé : on garde simplement les données en mémoire.
    }
  }

  return {
    charger: () => lire()?.etat ?? etatVide(),
    // Le cache n'est écrit qu'avec des données venues du serveur (cf. chargerServeur) ;
    // `enregistrer` ne sert qu'à mémoriser le commerce affiché.
    enregistrer(etat) {
      const c = lire()
      if (c) ecrire({ ...c.etat, commerceActifId: etat.commerceActifId }, c.synchroLe)
    },
    /** « Verrouiller » : efface les données privées (clients, téléphones…) de ce navigateur. */
    reinitialiser() {
      try {
        stockage?.removeItem(cle)
      } catch {
        // rien à effacer
      }
      return etatVide()
    },
    derniereSynchro: () => lire()?.synchroLe ?? null,

    async chargerServeur(acces, commerceActifId) {
      const commerces = await api.commerces()
      const ids = commercesAccessibles({ commerces }, acces)
      if (acces?.role === 'commerce' && !ids.length) throw new ErreurApi(404, 'Commerce inconnu.')
      const etats = await Promise.all(ids.map((id) => api.etat(id, acces!)))
      // La fiche complète (renvoyée avec le PIN) remplace la fiche publique. Les commerces non accessibles gardent
      // leur fiche publique (sans réglages) : seuls id / nom / type / logo / demo / actif en sont lus (Verrou,
      // sélecteur), jamais une page commerçant — celles-ci exigent l'accès, donc la fiche complète.
      const complets = new Map(etats.map((e) => [e.commerce.id, e.commerce]))
      const actif = ids.includes(commerceActifId ?? '') ? commerceActifId! : (ids[0] ?? commerces[0]?.id ?? '')
      const etat: Etat = {
        commerces: commerces.map((c) => complets.get(c.id) ?? (c as unknown as Commerce)),
        clients: etats.flatMap((e) => e.clients),
        tirages: etats.flatMap((e) => e.tirages),
        avis: etats.flatMap((e) => e.avis),
        membres: etats.flatMap((e) => e.membres ?? []),
        journal: etats.flatMap((e) => e.journal ?? []),
        envois: etats.flatMap((e) => e.envois ?? []),
        commerceActifId: actif,
      }
      // Pas de PIN = pas de données privées : rien à mettre en cache.
      if (acces) ecrire(etat, maintenant().toISOString())
      return etat
    },
  }
}

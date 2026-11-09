// Couche de persistance. L'UI ne parle qu'à l'interface `Depot` : pour brancher
// une vraie base plus tard, il suffit d'écrire une autre implémentation.
import type { Donnees, Etat, Lot } from '../types'
// `with { type: 'json' }` : compris par Vite ET par Node (tests `npm test` sans bundler).
import seed from './seed.json' with { type: 'json' }

export interface Depot {
  charger(): Etat
  enregistrer(etat: Etat): void
  reinitialiser(): Etat
}

// v2 : seed Asian Home Paris (phase 3). Les données de la v1 (ancien seed) ne sont pas reprises.
const CLE = 'fidelite:etat:v2'

/**
 * Les dates du seed sont figées autour de `dateReference`. On les décale pour que
 * la démo paraisse toujours récente (« visites ce mois », clients actifs…).
 */
export function seedRecale(maintenant = Date.now()): Etat {
  const decalage = maintenant - new Date(seed.dateReference).getTime()
  const recale = (iso: string) => new Date(new Date(iso).getTime() + decalage).toISOString()
  const d = seed as unknown as Donnees
  return {
    commerces: d.commerces.map((c) => ({ ...c, creeLe: recale(c.creeLe) })),
    clients: d.clients.map((c) => ({
      ...c,
      visites: c.visites.map(recale),
      derniereVisite: c.derniereVisite ? recale(c.derniereVisite) : null,
      creeLe: recale(c.creeLe),
      ...(c.recompensesOffertes ? { recompensesOffertes: c.recompensesOffertes.map((r) => ({ ...r, date: recale(r.date) })) } : {}),
    })),
    tirages: d.tirages.map((t) => ({ ...t, date: recale(t.date) })),
    avis: d.avis.map((a) => ({ ...a, date: recale(a.date) })),
    commerceActifId: d.commerces[0].id,
  }
}

// Lien du seed avant FIX-C : une recherche Google Maps, remplacée par le lien direct « laisser un avis ».
const ANCIEN_LIEN_ASIAN_HOME =
  'https://www.google.com/maps/search/?api=1&query=Asian+Home+Paris+11+rue+Andr%C3%A9+Joineau+Le+Pr%C3%A9-Saint-Gervais'
const LIEN_AVIS_ASIAN_HOME = seed.commerces[0].lienGoogle

/**
 * Anciennes données enregistrées : lots en simple texte (phase 1) → chances égales ;
 * client sans visite dont `derniereVisite` valait la date d'inscription (avant FIX-B) → null ;
 * ancien lien Maps d'Asian Home Paris (avant FIX-C) → lien direct d'avis.
 */
export function migrer(etat: Etat): Etat {
  return {
    ...etat,
    clients: etat.clients.map((c) => {
      const derniereVisite = c.visites.at(-1) ?? null
      return c.derniereVisite === derniereVisite ? c : { ...c, derniereVisite }
    }),
    commerces: etat.commerces.map((commerce) => {
      const c = commerce.lienGoogle === ANCIEN_LIEN_ASIAN_HOME ? { ...commerce, lienGoogle: LIEN_AVIS_ASIAN_HOME } : commerce
      const lots = c.lots as unknown[]
      if (!lots.some((l) => typeof l === 'string')) return c
      const part = Math.round(100 / lots.length)
      return { ...c, lots: lots.map((l) => (typeof l === 'string' ? { libelle: l, probabilite: part } : (l as Lot))) }
    }),
  }
}

function estEtatValide(x: unknown): x is Etat {
  const e = x as Etat
  return !!e && Array.isArray(e.commerces) && Array.isArray(e.clients) && Array.isArray(e.tirages) && Array.isArray(e.avis) && typeof e.commerceActifId === 'string'
}

export const depotLocal: Depot = {
  charger() {
    try {
      const brut = localStorage.getItem(CLE)
      if (brut) {
        const etat: unknown = JSON.parse(brut)
        if (estEtatValide(etat)) return migrer(etat)
      }
    } catch {
      // Données illisibles : on repart du seed.
    }
    const etat = seedRecale()
    this.enregistrer(etat)
    return etat
  },
  enregistrer(etat) {
    try {
      localStorage.setItem(CLE, JSON.stringify(etat))
    } catch {
      // Stockage plein ou désactivé (navigation privée) : l'app reste utilisable en mémoire.
    }
  },
  reinitialiser() {
    const etat = seedRecale()
    this.enregistrer(etat)
    return etat
  },
}

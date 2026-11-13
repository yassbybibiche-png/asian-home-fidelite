import type { Avis, Client, Tirage } from '../types'
// Bundle initial au plafond (P2-Q2) : `memeJourParis` est déjà dans le bundle initial (comparateur jour de Paris).
import { memeJourParis } from './points.ts'

const JOUR = 24 * 60 * 60 * 1000
export const JOURS_INACTIVITE = 30

export function estCeMois(iso: string, maintenant = new Date()): boolean {
  const d = new Date(iso)
  return d.getFullYear() === maintenant.getFullYear() && d.getMonth() === maintenant.getMonth()
}

export function joursDepuis(iso: string, maintenant = Date.now()): number {
  return Math.floor((maintenant - new Date(iso).getTime()) / JOUR)
}

/** Actif = au moins une visite dans les 30 derniers jours (à la milliseconde près). */
export function estActif(client: Client, maintenant = Date.now()): boolean {
  return !!client.derniereVisite && maintenant - new Date(client.derniereVisite).getTime() <= JOURS_INACTIVITE * JOUR
}

/** À relancer = déjà venu au moins une fois, mais plus depuis plus de 30 jours. Un inscrit sans visite n'en fait pas partie. */
export function estARelancer(client: Client, maintenant = Date.now()): boolean {
  return !!client.derniereVisite && !estActif(client, maintenant)
}

export interface Chiffres {
  clientsActifs: number
  visitesCeMois: number
  avisCeMois: number
  /** Part des clients revenus au moins une 2e fois, en %. */
  tauxRetour: number
}

export function calculerChiffres(clients: Client[], avis: Avis[], maintenant = new Date()): Chiffres {
  const t = maintenant.getTime()
  const revenus = clients.filter((c) => c.visites.length >= 2).length
  return {
    clientsActifs: clients.filter((c) => estActif(c, t)).length,
    visitesCeMois: clients.reduce((n, c) => n + c.visites.filter((v) => estCeMois(v, maintenant)).length, 0),
    avisCeMois: avis.filter((a) => estCeMois(a.date, maintenant)).length,
    tauxRetour: clients.length ? Math.round((revenus / clients.length) * 100) : 0,
  }
}

export interface ChiffresCartes {
  cartesEmises: number
  passagesTotal: number
  passages30j: number
  /** Récompenses tampons offertes + échanges de points. */
  recompensesDonnees: number
  pointsEnCirculation: number
  plusFideles: { id: string; prenom: string; passages: number; points: number }[]
}

export function calculerChiffresCartes(clients: Client[], maintenant = new Date()): ChiffresCartes {
  const t = maintenant.getTime()
  return {
    cartesEmises: clients.length,
    passagesTotal: clients.reduce((n, c) => n + c.visites.length, 0),
    passages30j: clients.reduce((n, c) => n + c.visites.filter((v) => t - new Date(v).getTime() <= JOURS_INACTIVITE * JOUR).length, 0),
    recompensesDonnees: clients.reduce((n, c) => n + (c.recompensesOffertes?.length ?? 0) + (c.echangesPoints?.length ?? 0), 0),
    pointsEnCirculation: clients.reduce((n, c) => n + (c.points ?? 0), 0),
    plusFideles: clients
      .filter((c) => c.visites.length > 0)
      .sort((a, b) => b.visites.length - a.visites.length || (b.points ?? 0) - (a.points ?? 0))
      .slice(0, 5)
      .map((c) => ({ id: c.id, prenom: c.prenom, passages: c.visites.length, points: c.points ?? 0 })),
  }
}

/**
 * Parties par table (R3) : tirages du jour de Paris `jour` (AAAA-MM-JJ) venus d'un QR de table (`table` posé par le
 * serveur), comptés par table, triés par nombre décroissant puis par nom. Les tirages sans table sont ignorés.
 */
export function compterPartiesParTable(tirages: Tirage[], jour: string): [string, number][] {
  // Midi UTC du jour donné : toujours le même jour à Paris (UTC+1 / UTC+2).
  const midi = new Date(`${jour}T12:00:00Z`)
  const n = new Map<string, number>()
  for (const t of tirages) if (t.table && memeJourParis(new Date(t.date), midi)) n.set(t.table, (n.get(t.table) ?? 0) + 1)
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))
}

export function noteMoyenne(avis: Avis[]): number | null {
  if (!avis.length) return null
  return Math.round((avis.reduce((s, a) => s + a.note, 0) / avis.length) * 10) / 10
}

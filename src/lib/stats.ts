import type { Avis, Client } from '../types'

const JOUR = 24 * 60 * 60 * 1000
export const JOURS_INACTIVITE = 30

export function estCeMois(iso: string, maintenant = new Date()): boolean {
  const d = new Date(iso)
  return d.getFullYear() === maintenant.getFullYear() && d.getMonth() === maintenant.getMonth()
}

export function joursDepuis(iso: string, maintenant = Date.now()): number {
  return Math.floor((maintenant - new Date(iso).getTime()) / JOUR)
}

export function estActif(client: Client, maintenant = Date.now()): boolean {
  return joursDepuis(client.derniereVisite, maintenant) <= JOURS_INACTIVITE
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

export function noteMoyenne(avis: Avis[]): number | null {
  if (!avis.length) return null
  return Math.round((avis.reduce((s, a) => s + a.note, 0) / avis.length) * 10) / 10
}

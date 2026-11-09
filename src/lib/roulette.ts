// Logique pure de la roulette : tirage pondéré, anti-abus, géométrie de la roue.
import type { Client, Lot, Tirage } from '../types'

/** Lots réellement tirables (libellé non vide, probabilité > 0). */
export function lotsJouables(lots: Lot[]): Lot[] {
  return lots.filter((l) => l.libelle.trim() && l.probabilite > 0)
}

export function totalProbabilites(lots: Lot[]): number {
  return lotsJouables(lots).reduce((s, l) => s + l.probabilite, 0)
}

/** Tirage pondéré ; si le total ≠ 100 %, les chances sont recalculées au prorata. */
export function tirerLot(lots: Lot[], alea = Math.random()): number {
  const jouables = lotsJouables(lots)
  const total = totalProbabilites(lots)
  let seuil = alea * total
  for (let i = 0; i < jouables.length; i++) {
    seuil -= jouables[i].probabilite
    if (seuil < 0) return i
  }
  return jouables.length - 1
}

function memeJour(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** Anti-abus : 1 tirage par client et par jour (jour calendaire local). */
export function tirageDuJour(tirages: Tirage[], commerceId: string, clientId: string, maintenant = new Date()): Tirage | undefined {
  return tirages.find((t) => t.commerceId === commerceId && t.clientId === clientId && memeJour(new Date(t.date), maintenant))
}

/** Visite validée au comptoir aujourd'hui (jour calendaire local) dans ce commerce. */
export function aVisiteDuJour(client: Client, commerceId: string, maintenant = new Date()): boolean {
  return client.commerceId === commerceId && client.visites.some((v) => memeJour(new Date(v), maintenant))
}

export type StatutJeu = 'pret' | 'sansVisite' | 'dejaJoue'

/**
 * 1 participation par visite : il faut une visite validée par le commerçant le jour même,
 * et pas encore de tirage aujourd'hui. Le jeu ne crée jamais de visite lui-même.
 */
export function statutJeu(client: Client, tirages: Tirage[], commerceId: string, maintenant = new Date()): StatutJeu {
  if (tirageDuJour(tirages, commerceId, client.id, maintenant)) return 'dejaJoue'
  if (!aVisiteDuJour(client, commerceId, maintenant)) return 'sansVisite'
  return 'pret'
}

export function peutJouer(client: Client, tirages: Tirage[], commerceId: string, maintenant = new Date()): boolean {
  return statutJeu(client, tirages, commerceId, maintenant) === 'pret'
}

export interface Secteur {
  lot: Lot
  debut: number
  fin: number
}

/** Secteurs de la roue en degrés (0 = en haut, sens horaire), proportionnels aux chances. */
export function secteurs(lots: Lot[]): Secteur[] {
  const jouables = lotsJouables(lots)
  const total = totalProbabilites(lots)
  let angle = 0
  return jouables.map((lot) => {
    const debut = angle
    angle += (lot.probabilite / total) * 360
    return { lot, debut, fin: angle }
  })
}

/** Rotation finale pour que le secteur gagnant s'arrête sous le pointeur (en haut). */
export function rotationCible(rotationActuelle: number, secteur: Secteur, alea = Math.random(), tours = 5): number {
  const marge = (secteur.fin - secteur.debut) * 0.15
  const cible = secteur.debut + marge + alea * (secteur.fin - secteur.debut - 2 * marge)
  const restant = (((360 - cible - rotationActuelle) % 360) + 360) % 360
  return rotationActuelle + tours * 360 + restant
}

export function estPerdant(lot: string): boolean {
  return /pas de chance|perdu|dommage|rejouez/i.test(lot)
}

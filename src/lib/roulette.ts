// Logique pure de la roulette : tirage pondéré, anti-abus, géométrie de la roue.
import type { Client, Lot, Tirage, TypeLot } from '../types'

/**
 * Lot affichable sur la roue. Vue commerçant : avec sa probabilité. Vue publique (pages client) : libellé seul,
 * le serveur ne publiant que les lots jouables — chaque lot y compte alors pour 1 (secteurs égaux). `id` / `type` :
 * présents sur la vue publique et sur les lots normalisés (`normaliserLots`), absents d'une config d'avant R1 non normalisée.
 */
export type LotRoue = Pick<Lot, 'libelle'> & { probabilite?: number; id?: string; type?: TypeLot }

const poids = (l: LotRoue) => l.probabilite ?? 1

/** Lots réellement tirables (libellé non vide, probabilité > 0). */
export function lotsJouables<T extends LotRoue>(lots: T[]): T[] {
  return lots.filter((l) => l.libelle.trim() && poids(l) > 0)
}

export function totalProbabilites(lots: LotRoue[]): number {
  return lotsJouables(lots).reduce((s, l) => s + poids(l), 0)
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
  lot: LotRoue
  debut: number
  fin: number
}

/**
 * Secteurs de la roue en degrés (0 = en haut, sens horaire), proportionnels aux chances quand elles sont connues
 * (vue commerçant) ; égaux pour la vue publique, qui ne les publie pas (des secteurs proportionnels les révéleraient).
 */
export function secteurs(lots: LotRoue[]): Secteur[] {
  const jouables = lotsJouables(lots)
  const total = totalProbabilites(lots)
  let angle = 0
  return jouables.map((lot) => {
    const debut = angle
    angle += (poids(lot) / total) * 360
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

// ---- Type des lots (roue v2, R1 ; le reste de la normalisation : src/lib/lots.ts) ----

export const TYPES_LOT: readonly TypeLot[] = ['lot', 'points', 'perdant']
export const POINTS_LOT_MIN = 1
export const POINTS_LOT_MAX = 10_000

/** Ancienne règle (avant R1), réservée aux lots et tirages enregistrés sans type. */
const ANCIEN_LIBELLE_PERDANT = /pas de chance|perdu|dommage|rejouez/i

export function typeDeduitDuLibelle(libelle: string): TypeLot {
  return ANCIEN_LIBELLE_PERDANT.test(libelle) ? 'perdant' : 'lot'
}

export function estTypeLot(v: unknown): v is TypeLot {
  return TYPES_LOT.includes(v as TypeLot)
}

/** Type résolu d'un tirage : celui figé au tirage, à défaut l'ancienne règle sur le libellé (tirages d'avant R1). */
export function typeTirage(t: Pick<Tirage, 'lot' | 'typeLot'>): TypeLot {
  return estTypeLot(t.typeLot) ? t.typeLot : typeDeduitDuLibelle(t.lot)
}

/** Lot physique à remettre au comptoir (code gagnant, coût, statistiques de gains) : ni consolation en points, ni perdant. */
export function estGainPhysique(type: TypeLot): boolean {
  return type === 'lot'
}

// ---- Code gagnant vérifié en caisse (P0-U3) ----

/** Saisie du code en caisse : casse, espaces et tirets ignorés. null = pas un code à 6 caractères. */
export function normaliserCodeGagnant(saisi: string): string | null {
  const c = saisi.replace(/[\s-]/g, '').toUpperCase()
  return /^[A-Z0-9]{6}$/.test(c) ? c : null
}

/**
 * valable = gain du jour pas encore remis ; expire = gain d'un autre jour (le code ne vaut que le jour du tirage) ;
 * consolation = lot de type « points » (R1) : rien à remettre au comptoir. Le type vient du tirage (`typeTirage`).
 */
export type StatutGain = 'valable' | 'remis' | 'perdant' | 'consolation' | 'expire'

export function statutGain(t: Tirage, maintenant = new Date()): StatutGain {
  const type = typeTirage(t)
  if (type === 'perdant') return 'perdant'
  if (type === 'points') return 'consolation'
  if (t.remis) return 'remis'
  return memeJour(new Date(t.date), maintenant) ? 'valable' : 'expire'
}

/** Parmi les tirages portant ce code (collision possible d'un jour à l'autre), celui du jour d'abord. */
export function tirageDuCode(tirages: Tirage[], maintenant = new Date()): Tirage | undefined {
  const duJour = tirages.filter((t) => memeJour(new Date(t.date), maintenant))
  return duJour.find((t) => !t.remis && estGainPhysique(typeTirage(t))) ?? duJour[0] ?? tirages[0]
}

/** « mar. 10 nov. 2026 » : jour de validité affiché à côté du code gagnant. */
export function jourEnClair(d: Date): string {
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

/** Message de la caisse pour un code vérifié (`remis.par` = nom de qui l'a remis). */
export function messageGain(g: { statut: StatutGain; lot: string; date: string; remis: { le: string; par: string } | null }): string {
  if (g.statut === 'perdant') return `Tirage perdant (« ${g.lot} ») : aucun lot à remettre.`
  if (g.statut === 'consolation') return `Lot de consolation en points (« ${g.lot} ») : aucun lot à remettre au comptoir.`
  if (g.statut === 'expire') return `Code expiré : il n’était valable que le ${jourEnClair(new Date(g.date))}, jour du tirage. Rien à remettre.`
  if (g.statut === 'remis') {
    const le = g.remis ? new Date(g.remis.le) : null
    const quand = le ? ` le ${le.toLocaleDateString('fr-FR')} à ${le.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} par ${g.remis!.par}` : ''
    return `Lot déjà remis${quand} : un code ne sert qu’une fois.`
  }
  return `Gain du jour à remettre : ${g.lot}.`
}

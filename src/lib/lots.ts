// Lots de la roue structurés (roue v2, lot R1) : chaque lot a un identifiant stable et un type explicite. Le moteur ne
// déduit plus jamais « perdant » du libellé — sauf pour les données écrites AVANT ce lot (sans type), normalisées ici
// (lots) et dans roulette.ts (tirages, même règle `typeDeduitDuLibelle`), partagés par le front et le serveur.
import type { Lot, Tirage, TypeLot } from '../types'
// Résolution du type au tirage (ancienne règle comprise) : définie dans roulette.ts, que ce module complète — dans ce
// sens-là seulement (roulette.ts n'importe rien d'ici : un import roulette → lots découpait 3 petits chunks de plus).
import { estTypeLot, lotsJouables, typeDeduitDuLibelle } from './roulette.ts'
export { estGainPhysique, estTypeLot, POINTS_LOT_MAX, POINTS_LOT_MIN, typeDeduitDuLibelle, typeTirage, TYPES_LOT } from './roulette.ts'

/** Type résolu d'un lot : son type explicite, à défaut l'ancienne règle (configs enregistrées avant R1). */
export function typeLot(l: Pick<Lot, 'libelle' | 'type'>): TypeLot {
  return estTypeLot(l.type) ? l.type : typeDeduitDuLibelle(l.libelle)
}

/** Clé de comparaison des libellés : espaces de bord et multiples ignorés, casse ignorée. */
export function cleLibelle(libelle: string): string {
  return libelle.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr-FR')
}

/** Libellés en double (comparés par `cleLibelle`, libellés vides ignorés) : le 1er libellé de chaque doublon. */
export function libellesEnDouble(lots: Pick<Lot, 'libelle'>[]): string[] {
  const vus = new Set<string>()
  const doubles = new Map<string, string>()
  for (const l of lots) {
    const cle = cleLibelle(l.libelle)
    if (!cle) continue
    if (vus.has(cle) && !doubles.has(cle)) doubles.set(cle, l.libelle.trim())
    vus.add(cle)
  }
  return [...doubles.values()]
}

/** Format d'un identifiant de lot accepté à l'écriture (sinon le serveur en génère un). */
export const FORMAT_ID_LOT = /^[\w-]{1,60}$/

/** Hachage FNV-1a 32 bits (hex) : court, déterministe, sans dépendance — pas un secret. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * Identifiant d'un lot enregistré sans id (config d'avant R1) : dérivé de sa position dans la liste COMPLÈTE (lots à
 * 0 % compris) et de son libellé, donc identique d'une lecture à l'autre de la même config — le serveur (tirage, vue
 * publique) et le navigateur (roue) retrouvent le même. Il est figé à la première écriture (Réglages le renvoie tel quel).
 */
export function idDeduit(position: number, libelle: string): string {
  return `lot-${position + 1}-${fnv1a(cleLibelle(libelle))}`
}

export type LotNormalise<T extends Pick<Lot, 'libelle'> = Lot> = T & { id: string; type: TypeLot }

/**
 * Lecture : chaque lot reçoit un `id` (le sien s'il est valable et unique, sinon `idDeduit`) et un `type` résolu.
 * Ne modifie pas la liste reçue ; l'ordre et les autres champs sont conservés.
 */
export function normaliserLots<T extends Pick<Lot, 'libelle' | 'id' | 'type'>>(lots: T[]): LotNormalise<T>[] {
  const ids = new Set<string>()
  return lots.map((l, i) => {
    let id = typeof l.id === 'string' && FORMAT_ID_LOT.test(l.id) && !ids.has(l.id) ? l.id : idDeduit(i, l.libelle)
    // Collision improbable (id explicite égal à un id déduit) : on suffixe, jamais deux lots sous le même id.
    while (ids.has(id)) id = `${id}-${i + 1}`
    ids.add(id)
    return { ...l, id, type: typeLot(l) }
  })
}

/** Nouvel identifiant de lot (serveur, Réglages, défauts) : aléatoire, jamais dérivé du libellé. */
export function nouvelIdLot(): string {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return `lot-${c.randomUUID().slice(0, 13)}`
  // Contexte non sécurisé (http hors localhost) : pas de randomUUID ; l'unicité dans la liste suffit.
  return `lot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Rattrapage des tirages d'avant R1 (revue Codex R2 point 4) : pour chaque tirage SANS `lotId` dont le libellé
 * correspond EXACTEMENT (espaces de bord et casse ignorés) à UN SEUL lot de `lots`, le même tirage avec `lotId` (et
 * `typeLot` s'il manquait, marqué alors `typeDeduit` : le tirage reste sous l'ancienne règle de validité, revue Codex R3
 * F2) posés. Libellé ambigu (plusieurs lots) ou sans correspondance : tirage ignoré. Renvoie seulement les tirages à
 * réécrire.
 */
export function rattachementsTirages<T extends Pick<Tirage, 'lot' | 'lotId' | 'typeLot' | 'typeDeduit'>>(lots: Pick<Lot, 'libelle' | 'id' | 'type'>[], tirages: T[]): T[] {
  const cle = (s: string) => s.trim().toLocaleLowerCase('fr-FR')
  const parLibelle = new Map<string, LotNormalise<Pick<Lot, 'libelle' | 'id' | 'type'>>[]>()
  for (const l of normaliserLots(lots)) {
    const k = cle(l.libelle)
    if (k) parLibelle.set(k, [...(parLibelle.get(k) ?? []), l])
  }
  const rattaches: T[] = []
  for (const t of tirages) {
    if (t.lotId) continue
    const candidats = parLibelle.get(cle(t.lot ?? '')) ?? []
    if (candidats.length === 1) rattaches.push({ ...t, lotId: candidats[0].id, ...(t.typeLot ? {} : { typeLot: candidats[0].type, typeDeduit: true }) })
  }
  return rattaches
}

/** Lot affiché avant le tirage et dans le règlement (R4) : libellé + type — jamais la probabilité, le coût ni le plafond. */
export interface LotAffiche {
  libelle: string
  type: Exclude<TypeLot, 'perdant'>
}

/**
 * « À gagner aujourd'hui » (R4) : lots jouables, dans l'ordre de la roue, sans les secteurs perdants — un lot 'points'
 * est une consolation. Vue publique : les lots plafonnés du jour en sont déjà retirés par le serveur.
 */
export function lotsAGagner(lots: { libelle: string; id?: string; type?: TypeLot; probabilite?: number }[]): LotAffiche[] {
  return lotsJouables(normaliserLots(lots))
    .filter((l): l is typeof l & { type: LotAffiche['type'] } => l.type !== 'perdant')
    .map((l) => ({ libelle: l.libelle.trim(), type: l.type }))
}

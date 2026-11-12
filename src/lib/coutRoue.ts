// Simulateur de coût de la roue (roue v2, D3) — logique pure, utilisée par Réglages → Roulette seulement (page
// différée : un module importé par une seule page reste dans son chunk). Formule benchmark (guide Shopify) : coût
// attendu par tirage = Σ (probabilité normalisée × valeur). Rien n'est inventé : un lot physique sans coût renseigné
// rend le résultat PARTIEL (un minimum), et la liste de ces lots est rendue pour être affichée.
import type { Lot, Tirage } from '../types'
import { ajouterJours, jourParis } from './mesure.ts'

/** Fenêtre de la moyenne des tirages par jour : les 14 derniers jours COMPLETS (aujourd'hui, entamé, est exclu). */
export const JOURS_MOYENNE_TIRAGES = 14
/** Projection mensuelle : 30 jours. */
export const JOURS_PROJECTION = 30

type LotSimule = Pick<Lot, 'libelle' | 'type' | 'probabilite' | 'coutCentimes' | 'plafondJour'>

const coutConnu = (c: unknown): c is number => typeof c === 'number' && Number.isFinite(c) && c >= 0

/**
 * Lots tirables (même règle que `lotsJouables` : libellé non vide, chance > 0 — et finie), écrite ici : le bundle
 * initial est au plafond et chaque export qu'une page différée lit dans l'index le grossit.
 */
const jouables = (lots: LotSimule[]) => lots.filter((l) => l.libelle.trim() && Number.isFinite(l.probabilite) && l.probabilite > 0)

/**
 * Lot physique (coûteux) ? Les lots reçus sont ceux du brouillon de Réglages, normalisés (`normaliserLots` : `type`
 * toujours résolu) ; un type absent compte comme un lot physique — par prudence, un coût plutôt qu'un oubli.
 */
const physique = (l: LotSimule) => (l.type ?? 'lot') === 'lot'

export interface CoutParTirage {
  /** Centimes (non arrondi) : Σ sur les lots physiques jouables de (chance / total des chances) × coût unitaire. */
  centimes: number
  /** Au moins un lot physique jouable sans coût renseigné : `centimes` est alors un minimum. */
  partiel: boolean
  /** Libellés de ces lots, dans l'ordre de la roue. */
  lotsSansCout: string[]
}

/**
 * Coût attendu d'un tirage. Chances NORMALISÉES sur tous les lots jouables (libellé non vide, chance > 0), comme le
 * tirage (`tirerLot`) ; seuls les lots physiques (type 'lot') coûtent — une consolation en points ou un secteur perdu
 * valent 0 €. Aucun lot jouable : 0, jamais NaN.
 */
export function coutParTirage(lots: LotSimule[]): CoutParTirage {
  const lotsTirables = jouables(lots)
  const total = lotsTirables.reduce((s, l) => s + l.probabilite, 0)
  const r: CoutParTirage = { centimes: 0, partiel: false, lotsSansCout: [] }
  if (!(total > 0)) return r
  for (const l of lotsTirables) {
    if (!physique(l)) continue
    if (coutConnu(l.coutCentimes)) r.centimes += (l.probabilite / total) * l.coutCentimes
    else r.lotsSansCout.push(l.libelle.trim())
  }
  r.partiel = r.lotsSansCout.length > 0
  return r
}

/**
 * Tirages par jour : moyenne sur les 14 derniers jours complets à Paris (de J-14 à J-1), tous clients du commerce.
 * `tirages` : ceux du commerce (les autres jours sont ignorés).
 */
export function tiragesParJour(tirages: Pick<Tirage, 'date'>[], maintenant = new Date()): number {
  const fin = ajouterJours(jourParis(maintenant), -1)
  const debut = ajouterJours(fin, -(JOURS_MOYENNE_TIRAGES - 1))
  const n = tirages.filter((t) => {
    const j = jourParis(t.date)
    return j >= debut && j <= fin
  }).length
  return n / JOURS_MOYENNE_TIRAGES
}

/**
 * Pire cas journalier permis par les plafonds : Σ plafond × coût des lots physiques jouables. null (pas de borne) si
 * l'un d'eux n'a pas de plafond (illimité) ou pas de coût renseigné — `sansPlafond` liste les premiers.
 */
export function pireCasJour(lots: LotSimule[]): { centimes: number | null; sansPlafond: string[] } {
  const physiques = jouables(lots).filter(physique)
  const sansPlafond = physiques.filter((l) => !(typeof l.plafondJour === 'number' && l.plafondJour > 0)).map((l) => l.libelle.trim())
  if (sansPlafond.length || physiques.some((l) => !coutConnu(l.coutCentimes))) return { centimes: null, sansPlafond }
  return { centimes: physiques.reduce((s, l) => s + (l.plafondJour as number) * (l.coutCentimes as number), 0), sansPlafond }
}

export interface SimulationCout extends CoutParTirage {
  tiragesParJour: number
  /** Centimes : coût par tirage × tirages par jour × 30. */
  projectionMois: number
  /** Centimes par jour (Σ plafond × coût), null = pas de borne (lot illimité ou sans coût). */
  pireCasJour: number | null
  sansPlafond: string[]
  /** La projection dépasse le pire cas × 30 : ce sont les plafonds qui bornent le coût réel. */
  bornePlafonds: boolean
}

/** Simulation complète affichée dans Réglages, recalculée à chaque modification du brouillon (avant enregistrement). */
export function simulerCout(lots: LotSimule[], tirages: Pick<Tirage, 'date'>[], maintenant = new Date()): SimulationCout {
  const cout = coutParTirage(lots)
  const parJour = tiragesParJour(tirages, maintenant)
  const projectionMois = cout.centimes * parJour * JOURS_PROJECTION
  const pire = pireCasJour(lots)
  return {
    ...cout,
    tiragesParJour: parJour,
    projectionMois,
    pireCasJour: pire.centimes,
    sansPlafond: pire.sansPlafond,
    bornePlafonds: pire.centimes !== null && projectionMois > pire.centimes * JOURS_PROJECTION,
  }
}

/** « 6,3 » : tirages par jour, une décimale, virgule française. */
export function formaterParJour(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1).replace('.', ',')
}

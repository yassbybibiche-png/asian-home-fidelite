// Réglages → Roulette (roue v2, R6) : validation front des champs propres à chaque type de lot (mêmes bornes que le
// serveur, `lots()` dans server/app.ts), lot tel qu'envoyé, et tirage de TEST de l'aperçu — fait dans le navigateur,
// sur les probabilités configurées, sans plafond ni limite client, jamais enregistré. Logique pure, testable sans navigateur.
import type { Lot, TypeLot } from '../types'
import { normaliserLots, type LotNormalise } from './lots.ts'
import { PLAFOND_JOUR_MAX, POINTS_LOT_MAX, POINTS_LOT_MIN, secteurs, tirerLot, type Secteur } from './roulette.ts'

/** Libellés du sélecteur de type, dans l'ordre affiché. */
export const CHOIX_TYPE_LOT: readonly { valeur: TypeLot; libelle: string }[] = [
  { valeur: 'lot', libelle: 'Lot physique' },
  { valeur: 'points', libelle: 'Points' },
  { valeur: 'perdant', libelle: 'Perdu' },
]

const entierEntre = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max

/**
 * Problème des champs liés au type d'un lot (null = rien à corriger) : un lot « points » doit indiquer son montant
 * (entier de 1 à 10 000) ; le plafond par jour d'un lot physique est vide (illimité) ou un entier de 0 à 10 000.
 * Points / perdant : le plafond n'est pas envoyé, donc jamais bloquant.
 */
export function problemeLot(l: Pick<Lot, 'type' | 'points' | 'plafondJour'>): string | null {
  if (l.type === 'points' && !entierEntre(l.points, POINTS_LOT_MIN, POINTS_LOT_MAX)) {
    return `indiquez le nombre de points offerts (entier de ${POINTS_LOT_MIN} à ${POINTS_LOT_MAX.toLocaleString('fr-FR')})`
  }
  if ((l.type ?? 'lot') === 'lot' && l.plafondJour !== undefined && !entierEntre(l.plafondJour, 0, PLAFOND_JOUR_MAX)) {
    return `plafond par jour : nombre entier de 0 à ${PLAFOND_JOUR_MAX.toLocaleString('fr-FR')}, ou vide pour illimité`
  }
  return null
}

/**
 * Lot tel qu'envoyé au serveur : `points` seulement pour un lot « points », `plafondJour` seulement pour un lot physique
 * avec un plafond > 0 (vide / 0 = illimité, rien d'écrit). Le brouillon garde les valeurs saisies : changer de type et
 * revenir ne les perd pas.
 */
export function lotPourEnvoi(l: Lot): Lot {
  const { points, plafondJour, ...reste } = l
  return {
    ...reste,
    ...(l.type === 'points' && points !== undefined ? { points } : {}),
    ...((l.type ?? 'lot') === 'lot' && plafondJour ? { plafondJour } : {}),
  }
}

/**
 * Tirage de test de l'aperçu : le secteur gagnant, tiré par `tirerLot` sur les probabilités configurées (prorata si le
 * total ≠ 100 %), parmi les lots jouables. Aucun plafond ni limite de gains (il n'y a pas de client) ; rien n'est écrit.
 * null : aucun lot jouable.
 */
export function tirageDeTest(lots: Lot[], alea = Math.random()): { lot: LotNormalise; secteur: Secteur } | null {
  // Secteurs de la roue = lots jouables, dans l'ordre (`secteurs` filtre comme `lotsJouables`) : l'indice tiré est le secteur.
  const parts = secteurs(normaliserLots(lots))
  if (!parts.length) return null
  const secteur = parts[tirerLot(parts.map((s) => s.lot as LotNormalise), alea)]
  return { lot: secteur.lot as LotNormalise, secteur }
}

/** Résultat affiché sous l'aperçu, selon le type du lot tiré. */
export function texteTirageDeTest(lot: Pick<Lot, 'libelle' | 'type' | 'points'>): string {
  const libelle = lot.libelle.trim()
  if (lot.type === 'perdant') return `Perdu : « ${libelle} ». Le client aurait été invité à revenir demain.`
  if (lot.type === 'points') {
    const s = (lot.points ?? 0) > 1 ? 's' : ''
    const n = lot.points ? ` (${lot.points.toLocaleString('fr-FR')} point${s} crédité${s} sur sa carte)` : ''
    return `Consolation : « ${libelle} »${n}.`
  }
  return `Gagné : « ${libelle} ». Le client l’aurait reçu sur sa carte, utilisable dès le lendemain.`
}

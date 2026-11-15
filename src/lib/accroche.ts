// Accroche du jeu & jour à Paris (P2-Q3) : phrase sous le nom du commerce sur la page de jeu, et jour calendaire à Paris.
// Module SÉPARÉ de `src/lib/mesure.ts` : il n'est utilisé que par la page de jeu (bundle initial) ; `mesure.ts`
// (tableau de bord : totaux, séries, entonnoir) est une page différée et ne doit pas être dans le bundle initial
// (seuil du test de bundle P2-Q2). Les jours sont des jours calendaires à Paris (AAAA-MM-JJ), comme dans `mesure.ts`.
// Les 1-ligne `JOUR_MS` / `versDate` sont dupliquées ici comme dans `mesure-offre.ts` (même convention).
// Test A/B « accroche » : ARRÊTÉ le 14/11/2026 (P2-3) — l'accroche est unique (générique), voir `accrocheJeu` ;
// `varianteDuJour`, `lotAccroche` et `ACCROCHE_LOT` restent, testées, pour une éventuelle réactivation décidée.
import type { Lot } from '../types.ts'
import { lotsJouables } from './roulette.ts'
import { estGainPhysique, typeLot } from './lots.ts'

const JOUR_MS = 24 * 60 * 60 * 1000

/** Jour calendaire à Paris d'une date (ISO ou Date) : AAAA-MM-JJ. */
export function jourParis(d: Date | string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(typeof d === 'string' ? new Date(d) : d)
}

const versDate = (jour: string) => new Date(`${jour}T00:00:00Z`)

// ---------- Test A/B « accroche » (docs/TESTS-AB.md) ----------

export type Variante = 'A' | 'B'

/**
 * Variante du jour : jours pairs (comptés depuis le 1er janvier 1970) = A, impairs = B. Aucun identifiant, aucun
 * stockage, aucun hasard : tous les clients d'un même jour voient la même variante, et comme une semaine a 7 jours
 * (impair), chaque jour de la semaine passe d'une variante à l'autre d'une semaine sur l'autre (le lundi n'est pas
 * toujours A).
 */
export function varianteDuJour(jour: string): Variante {
  return Math.round(versDate(jour).getTime() / JOUR_MS) % 2 === 0 ? 'A' : 'B'
}

export const ACCROCHE_GENERIQUE = 'Tournez la roue et gagnez un cadeau !'
export const ACCROCHE_LOT = 'Tournez la roue : {lot} à gagner !'

/** Lot cité par la variante B : le 1er lot physique de la roue (jamais un perdant ni une consolation en points). */
export function lotAccroche(lots: Pick<Lot, 'libelle' | 'type'>[]): string | null {
  return lotsJouables(lots).find((l) => estGainPhysique(typeLot(l)))?.libelle ?? null
}

/**
 * Phrase sous le nom du commerce sur la page de jeu : l'accroche générique, toujours la même.
 * Le test A/B est arrêté depuis le 14/11/2026 (P2-3) : un seul commerce réel ne conclura jamais. Les paramètres
 * sont conservés (préfixés `_`) pour que le point d'appel ne change pas si le test est réactivé un jour dans un
 * cadre de mesure décidé — ils ne sont plus lus.
 */
export function accrocheJeu(
  _commerce: { lots: Pick<Lot, 'libelle' | 'type'>[] },
  _jour: string,
): { modele: string; valeurs?: { lot: string } } {
  return { modele: ACCROCHE_GENERIQUE }
}

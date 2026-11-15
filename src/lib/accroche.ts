// Accroche du jeu & jour à Paris (P2-Q3) : phrase sous le nom du commerce sur la page de jeu, et jour calendaire à Paris.
// Module SÉPARÉ de `src/lib/mesure.ts` : il n'est utilisé que par la page de jeu (bundle initial) ; `mesure.ts`
// (tableau de bord : totaux, séries, entonnoir) est une page différée et ne doit pas être dans le bundle initial
// (seuil du test de bundle P2-Q2). Les jours sont des jours calendaires à Paris (AAAA-MM-JJ), comme dans `mesure.ts`.
// Les 1-ligne `JOUR_MS` / `versDate` sont dupliquées ici comme dans `mesure-offre.ts` (même convention).
import type { CommercePublic, Lot, TestsAB } from '../types.ts'
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
 * Phrase sous le nom du commerce sur la page de jeu : modèle à traduire (`t`) et valeurs. Test actif = fiche publique
 * (`testAccroche`, mode serveur) ou réglage du commerce (`testsAB`, démo locale).
 */
export function accrocheJeu(
  commerce: Pick<CommercePublic, 'testAccroche'> & { lots: Pick<Lot, 'libelle' | 'type'>[]; testsAB?: TestsAB },
  jour: string,
): { modele: string; valeurs?: { lot: string } } {
  const lot = lotAccroche(commerce.lots)
  const actif = commerce.testAccroche || commerce.testsAB?.accroche?.actif
  if (actif && lot && varianteDuJour(jour) === 'B') return { modele: ACCROCHE_LOT, valeurs: { lot } }
  return { modele: ACCROCHE_GENERIQUE }
}

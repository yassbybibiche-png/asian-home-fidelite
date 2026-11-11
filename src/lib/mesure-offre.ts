// Test A/B « offre de la semaine » (P2-Q3, docs/TESTS-AB.md test 2) : visites par jour de semaine sur deux
// périodes de 4 semaines, et variation nette.
// Module SÉPARÉ de `src/lib/mesure.ts` : il n'est utilisé que par le tableau de bord (page différée, hors bundle
// initial) ; `mesure.ts` est importé par la page de jeu, il ne doit pas grossir (seuil du test de bundle P2-Q2).
// Les jours sont des jours calendaires à Paris (AAAA-MM-JJ), comme dans `mesure.ts`.
import type { Client } from '../types'
import { ajouterJours, dansIntervalle, jourParis, variation } from './mesure.ts'

const versDate = (jour: string) => new Date(`${jour}T00:00:00Z`)
const versJour = (d: Date) => d.toISOString().slice(0, 10)

/** Durée d'une période du test 2 : 4 semaines (28 jours), comme le protocole. */
export const DUREE_OFFRE_SEMAINES = 4
export const JOURS_OFFRE = DUREE_OFFRE_SEMAINES * 7

/** Libellés courts des jours de la semaine, lundi en premier (comme le tableau du test 2). */
export const JOURS_SEMAINE_COURTS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']

export interface VisitesParJourSemaine {
  /** Visites par jour de la semaine, lundi (indice 0) à dimanche (indice 6). */
  jours: [number, number, number, number, number, number, number]
  total: number
}

export interface ComparaisonOffre {
  A: VisitesParJourSemaine
  B: VisitesParJourSemaine
  /** Variation nette (total B − total A) en %, null si la période A est vide. */
  variationNette: number | null
}

const estJourValide = (jour: string) => /^\d{4}-\d{2}-\d{2}$/.test(jour) && !Number.isNaN(versDate(jour).getTime()) && versJour(versDate(jour)) === jour

/** Visites (validées au comptoir) de la fenêtre de 28 jours commençant à `debut`, par jour de semaine. */
export function visitesParJourSemaine(clients: Pick<Client, 'visites'>[], debut: string): VisitesParJourSemaine {
  const jours: [number, number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0, 0]
  const fin = ajouterJours(debut, JOURS_OFFRE - 1)
  for (const c of clients) {
    for (const v of c.visites) {
      const jour = jourParis(v)
      if (!dansIntervalle(jour, debut, fin)) continue
      jours[(versDate(jour).getUTCDay() + 6) % 7]++
    }
  }
  return { jours, total: jours.reduce((s, n) => s + n, 0) }
}

/**
 * Comparaison des deux périodes de 4 semaines du test 2 (offre le mardi, puis le jeudi — ou l'inverse) :
 * visites par jour de semaine et variation nette. Les deux fenêtres doivent être des jours valides et ne pas se
 * chevaucher : sinon null (on ne compare pas une période avec elle-même, ni deux fois les mêmes visites).
 * Données déjà en base (visites validées) : rien de nouveau n'est collecté pour ce test.
 */
export function comparerOffreSemaine(clients: Pick<Client, 'visites'>[], debutA: string, debutB: string): ComparaisonOffre | null {
  if (!estJourValide(debutA) || !estJourValide(debutB)) return null
  const finA = ajouterJours(debutA, JOURS_OFFRE - 1)
  const finB = ajouterJours(debutB, JOURS_OFFRE - 1)
  if (debutA <= finB && debutB <= finA) return null
  const A = visitesParJourSemaine(clients, debutA)
  const B = visitesParJourSemaine(clients, debutB)
  return { A, B, variationNette: variation(B.total, A.total) }
}

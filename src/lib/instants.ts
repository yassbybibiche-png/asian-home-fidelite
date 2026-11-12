// Instants gagnants (roue v2, D1 — benchmark Socialshaker / Qualifio / Adictiz) : chaque jour, N instants tirés au
// hasard dans les plages d'ouverture ; le 1er joueur dont le tirage tombe dans les 5 minutes qui suivent un instant
// non consommé gagne le lot de cet instant (avant le tirage pondéré), sous réserve des plafonds et de la limite
// mensuelle. Générés paresseusement par le serveur à la 1re utilisation du jour et PERSISTÉS (table `meta`), jamais
// publiés avant leur heure. Logique pure (hasard injecté), testable sans serveur.
import type { Commerce, InstantGagnant, InstantsDuJour, Lot, PlageOuverture } from '../types'
import { instantParis } from './roulette.ts'
import type { StatutInstant } from './instantsTableau.ts'

/** Durée pendant laquelle un instant reste « gagnable » après son heure. */
export const FENETRE_INSTANT_MS = 5 * 60 * 1000
/** Instants par jour et par lot, au plus. */
export const INSTANTS_JOUR_MAX = 20
/** Plages d'ouverture par jour, au plus. */
export const PLAGES_MAX = 6
/** Défaut produit : les deux services d'Asian Home (modifiable dans Réglages → Roulette). */
export const PLAGES_OUVERTURE_DEFAUT: readonly PlageOuverture[] = [
  { debut: '11:30', fin: '14:30' },
  { debut: '18:30', fin: '23:30' },
]

const FORMAT_HEURE = /^([01]\d|2[0-3]):[0-5]\d$/
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** Plages effectives : celles du commerce, sinon le défaut. Une liste vide explicite = aucune plage (aucun instant). */
export function plagesOuverture(c: Pick<Commerce, 'plagesOuverture'>): PlageOuverture[] {
  return Array.isArray(c.plagesOuverture) ? c.plagesOuverture : [...PLAGES_OUVERTURE_DEFAUT]
}

/**
 * Problème d'une liste de plages (null = valable) : au plus `PLAGES_MAX`, heures « HH:MM » (00:00 à 23:59), début
 * avant la fin (une plage ne passe pas minuit). Les chevauchements sont admis : les plages sont fusionnées.
 */
export function problemePlages(v: unknown): string | null {
  if (!Array.isArray(v) || v.length > PLAGES_MAX) return `plages d’ouverture : liste de ${PLAGES_MAX} plages au plus`
  for (const [i, p] of v.entries()) {
    const o = (p ?? {}) as Record<string, unknown>
    if (typeof o.debut !== 'string' || typeof o.fin !== 'string' || !FORMAT_HEURE.test(o.debut) || !FORMAT_HEURE.test(o.fin)) {
      return `plage n° ${i + 1} : heures au format HH:MM (00:00 à 23:59)`
    }
    if (minutes(o.debut) >= minutes(o.fin)) return `plage n° ${i + 1} : le début doit précéder la fin (une plage ne passe pas minuit)`
  }
  return null
}

/** Union des plages en minutes depuis minuit, triée, chevauchements fusionnés. */
export function unionPlages(plages: PlageOuverture[]): [number, number][] {
  const triees = plages.map((p) => [minutes(p.debut), minutes(p.fin)] as [number, number]).sort((a, b) => a[0] - b[0])
  const r: [number, number][] = []
  for (const [d, f] of triees) {
    const dernier = r[r.length - 1]
    if (dernier && d <= dernier[1]) dernier[1] = Math.max(dernier[1], f)
    else r.push([d, f])
  }
  return r
}

/** Lots physiques qui ont des instants gagnants (type 'lot', `instantsParJour` > 0). */
export function lotsAInstants<T extends Pick<Lot, 'type' | 'instantsParJour'>>(lots: T[]): T[] {
  return lots.filter((l) => l.type === 'lot' && (l.instantsParJour ?? 0) > 0)
}

/**
 * Instants du jour `jour` (AAAA-MM-JJ, à Paris) : pour chaque lot à instants, exactement `instantsParJour` instants
 * uniformes (à la seconde) dans l'union des plages, triés par heure. `hasard(n)` : entier uniforme dans [0, n[ —
 * `crypto.randomInt` côté serveur. Aucune plage → aucun instant.
 */
export function genererInstants(
  lots: { id: string; libelle: string; type?: Lot['type']; instantsParJour?: number }[],
  plages: PlageOuverture[],
  jour: string,
  hasard: (n: number) => number,
): InstantsDuJour {
  const union = unionPlages(plages)
  const secondes = union.reduce((s, [d, f]) => s + (f - d) * 60, 0)
  const [a, m, j] = jour.split('-').map(Number)
  const instants: Omit<InstantGagnant, 'id'>[] = []
  if (secondes > 0) {
    for (const l of lotsAInstants(lots)) {
      for (let k = 0; k < Math.min(l.instantsParJour!, INSTANTS_JOUR_MAX); k++) {
        // Seconde tirée dans l'union, puis ramenée à sa plage.
        let reste = hasard(secondes)
        let p = 0
        while (reste >= (union[p][1] - union[p][0]) * 60) {
          reste -= (union[p][1] - union[p][0]) * 60
          p++
        }
        const minute = union[p][0] + Math.floor(reste / 60)
        const heure = new Date(instantParis(a, m, j, Math.floor(minute / 60), minute % 60).getTime() + (reste % 60) * 1000)
        instants.push({ heure: heure.toISOString(), lotId: l.id, lot: l.libelle })
      }
    }
  }
  instants.sort((x, y) => x.heure.localeCompare(y.heure))
  return { jour, instants: instants.map((x, i) => ({ id: `ig-${jour}-${i + 1}`, ...x })) }
}

/** Clé `meta` des instants d'un commerce pour un jour (à Paris). Jamais lue par une route publique. */
export const cleInstants = (commerceId: string, jour: string) => `instants:${commerceId}:${jour}`

/** Instant « en cours » : non consommé, heure ≤ maintenant < heure + 5 min ; le plus ancien s'il y en a plusieurs. */
export function instantEnCours(d: InstantsDuJour, maintenant: Date): InstantGagnant | undefined {
  const t = maintenant.getTime()
  return d.instants.find((i) => !i.consommePar && Date.parse(i.heure) <= t && t < Date.parse(i.heure) + FENETRE_INSTANT_MS)
}

/** Instants déjà PASSÉS (heure ≤ maintenant) : les seuls jamais montrés, même au commerçant. Les futurs restent secrets. */
export function instantsPasses(d: InstantsDuJour, maintenant: Date): InstantGagnant[] {
  return d.instants.filter((i) => Date.parse(i.heure) <= maintenant.getTime())
}

/** Issue d'un instant PASSÉ à `maintenant` : gagné, bloqué (plafond / limite), encore gagnable, ou passé sans gagnant. */
export function statutInstant(i: InstantGagnant, maintenant: Date): StatutInstant {
  if (i.consommePar) return i.gagne ? 'gagne' : 'bloque'
  return maintenant.getTime() < Date.parse(i.heure) + FENETRE_INSTANT_MS ? 'enCours' : 'sansGagnant'
}

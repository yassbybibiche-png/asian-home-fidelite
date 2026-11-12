// Créneaux « heures creuses » (roue v2, D2 — inspiration Starbucks Summer Game, Socialshaker) : des tranches horaires
// par jour de la semaine, à l'heure de Paris. Pendant un créneau, les lots marqués `heuresCreuses` entrent dans
// l'ensemble tirable (et apparaissent sur la roue publique) et une consolation en points tirée est DOUBLÉE ; hors
// créneau, ces lots sont exclus, comme un lot à 0 %. Logique pure, partagée par le serveur et Réglages (jamais par le
// bundle initial : la page de jeu ne reçoit que le résultat, `bonusCreux` et les lots déjà filtrés).
import type { CreneauCreux, Lot } from '../types'

/** Créneaux par commerce, au plus. */
export const CRENEAUX_MAX = 6
/** Multiplicateur d'une consolation en points tirée pendant un créneau. */
export const MULTIPLICATEUR_POINTS_CREUX = 2
/** Jours de la semaine, 0 = dimanche … 6 = samedi (comme `Date.getDay`), dans l'ordre affiché (lundi d'abord). */
export const JOURS_CRENEAU: readonly { valeur: number; court: string }[] = [
  { valeur: 1, court: 'lun.' },
  { valeur: 2, court: 'mar.' },
  { valeur: 3, court: 'mer.' },
  { valeur: 4, court: 'jeu.' },
  { valeur: 5, court: 'ven.' },
  { valeur: 6, court: 'sam.' },
  { valeur: 0, court: 'dim.' },
]

const FORMAT_HEURE = /^([01]\d|2[0-3]):[0-5]\d$/
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/**
 * Problème d'une liste de créneaux (null = valable) : au plus `CRENEAUX_MAX` ; chacun a au moins un jour (entiers de 0
 * à 6, sans doublon) et des heures « HH:MM », début avant la fin (un créneau ne passe pas minuit).
 */
export function problemeCreneaux(v: unknown): string | null {
  if (!Array.isArray(v) || v.length > CRENEAUX_MAX) return `liste de ${CRENEAUX_MAX} créneaux au plus`
  for (const [i, c] of v.entries()) {
    const o = (c ?? {}) as Record<string, unknown>
    const jours = o.jours
    if (!Array.isArray(jours) || !jours.length || jours.some((j) => !Number.isInteger(j) || j < 0 || j > 6) || new Set(jours).size !== jours.length) {
      return `créneau n° ${i + 1} : choisissez au moins un jour`
    }
    if (typeof o.debut !== 'string' || typeof o.fin !== 'string' || !FORMAT_HEURE.test(o.debut) || !FORMAT_HEURE.test(o.fin)) {
      return `créneau n° ${i + 1} : heures au format HH:MM (00:00 à 23:59)`
    }
    if (minutes(o.debut) >= minutes(o.fin)) return `créneau n° ${i + 1} : le début doit précéder la fin (un créneau ne passe pas minuit)`
  }
  return null
}

/** Créneaux tels qu'écrits (après `problemeCreneaux`) : jours triés, aucun autre champ. */
export function nettoyerCreneaux(v: CreneauCreux[]): CreneauCreux[] {
  return v.map((c) => ({ jours: [...c.jours].sort((a, b) => a - b), debut: c.debut, fin: c.fin }))
}

const FORMAT_PARIS = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hourCycle: 'h23', weekday: 'short', hour: 'numeric', minute: 'numeric' })
const JOURS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Jour de la semaine (0 = dimanche) et minute du jour (0 à 1 439) à Paris, quel que soit le fuseau du processus. */
export function momentParis(d: Date): { jour: number; minute: number } {
  const p = Object.fromEntries(FORMAT_PARIS.formatToParts(d).map((x) => [x.type, x.value]))
  return { jour: JOURS_EN.indexOf(p.weekday), minute: Number(p.hour) * 60 + Number(p.minute) }
}

/**
 * Un créneau est-il en cours à `date` (heure de Paris) ? Jour de la semaine dans `jours` et début ≤ heure < fin :
 * début INCLUS, fin EXCLUE (créneau 14:00–17:00 : actif à 14:00:00, fini à 17:00:00). Liste absente / vide : jamais.
 */
export function creneauActif(creneaux: CreneauCreux[] | undefined, date: Date): boolean {
  if (!creneaux?.length) return false
  const { jour, minute } = momentParis(date)
  return creneaux.some((c) => c.jours.includes(jour) && minutes(c.debut) <= minute && minute < minutes(c.fin))
}

/** Ensemble du moment : hors créneau, les lots « heures creuses » sont retirés (comme un lot à 0 %) ; l'ordre est gardé. */
export function lotsDuCreneau<T extends Pick<Lot, 'heuresCreuses'>>(lots: T[], actif: boolean): T[] {
  return actif ? lots : lots.filter((l) => !l.heuresCreuses)
}

/** Points d'une consolation tirée : doublés pendant un créneau. */
export function pointsDuCreneau(points: number, actif: boolean): number {
  return actif ? points * MULTIPLICATEUR_POINTS_CREUX : points
}

/** « lun., mar. · 14:00–17:00 » : un créneau en clair (Réglages). */
export function texteCreneau(c: CreneauCreux): string {
  const jours = JOURS_CRENEAU.filter((j) => c.jours.includes(j.valeur)).map((j) => j.court)
  return `${jours.join(', ') || 'aucun jour'} · ${c.debut}–${c.fin}`
}

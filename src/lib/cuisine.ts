// Écran cuisine (Expérience 10/10, lot 3) — logique pure de #/cuisine : sections par statut, actions permises,
// ancienneté, jour précédent, repérage des nouvelles commandes. Module propre à la page différée (testable sans
// React) : n'importe rien du bundle initial, pour que l'écran ne coûte rien au premier chargement.
import type { Commande, StatutCommande } from '../types'

/** Commande telle que la liste du commerçant la renvoie (le serveur retire toujours le secret). */
export type CommandeCuisine = Omit<Commande, 'secret'>

/** Relecture automatique de la liste (page visible seulement). */
export const INTERVALLE_CUISINE_MS = 10_000

export interface SectionCuisine {
  statut: StatutCommande
  titre: string
  /** Section repliée par défaut (servies) ou discrète (refusées). */
  repliee?: true
  discrete?: true
}

/** Ordre d'affichage : le travail à faire d'abord, les commandes terminées en bas. */
export const SECTIONS_CUISINE: readonly SectionCuisine[] = [
  { statut: 'recue', titre: 'Nouvelles' },
  { statut: 'acceptee', titre: 'Acceptées' },
  { statut: 'en_preparation', titre: 'En préparation' },
  { statut: 'servie', titre: 'Servies', repliee: true },
  { statut: 'refusee', titre: 'Refusées', discrete: true },
]

/**
 * Commandes d'un statut, dans l'ordre de travail : les plus anciennes d'abord tant qu'il reste à faire (premier
 * arrivé, premier servi), les plus récentes d'abord une fois terminées (servies, refusées).
 */
export function commandesDeSection(commandes: readonly CommandeCuisine[], statut: StatutCommande): CommandeCuisine[] {
  const terminee = statut === 'servie' || statut === 'refusee'
  return commandes
    .filter((c) => c.statut === statut)
    .sort((a, b) => (terminee ? b.creeLe.localeCompare(a.creeLe) : a.creeLe.localeCompare(b.creeLe)))
}

export interface ActionCuisine {
  vers: StatutCommande
  libelle: string
  /** Action principale (bouton plein) ; sinon bouton secondaire (Refuser). */
  principale?: true
}

/** Boutons d'une carte selon son statut — les seules transitions acceptées par le serveur (`transitionValide`). */
export function actionsCuisine(statut: StatutCommande): ActionCuisine[] {
  switch (statut) {
    case 'recue':
      return [
        { vers: 'acceptee', libelle: 'Accepter', principale: true },
        { vers: 'refusee', libelle: 'Refuser' },
      ]
    case 'acceptee':
      return [{ vers: 'en_preparation', libelle: 'En préparation', principale: true }]
    case 'en_preparation':
      return [{ vers: 'servie', libelle: 'Servie', principale: true }]
    default:
      return []
  }
}

/** « à l'instant », « il y a 7 min », « il y a 1 h 05 » (horloge de l'appareil ; jamais négatif). */
export function anciennete(creeLe: string, maintenant: number): string {
  const min = Math.max(0, Math.floor((maintenant - Date.parse(creeLe)) / 60_000))
  if (min < 1) return 'à l’instant'
  if (min < 60) return `il y a ${min} min`
  return `il y a ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
}

const formatHeure = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })

/** Heure de la commande à Paris (« 12:34 »), quel que soit le fuseau de l'appareil. */
export const heureCommande = (creeLe: string): string => formatHeure.format(new Date(creeLe))

/**
 * Jour précédent d'un jour AAAA-MM-JJ, calculé sur la date elle-même (pas « maintenant − 24 h », faux le lendemain
 * d'un changement d'heure). Le jour de départ est celui renvoyé par le serveur : l'horloge de l'appareil n'entre pas
 * en jeu.
 */
export function jourPrecedent(jour: string): string {
  const d = new Date(`${jour}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** « jeudi 12 novembre » pour un jour AAAA-MM-JJ. */
export const jourLisible = (jour: string): string =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${jour}T12:00:00Z`))

/**
 * Nouvelles commandes à signaler (pastille « Nouveau ») : celles encore « reçues » qui n'étaient pas dans la liste
 * déjà affichée. `deja` = identifiants affichés jusqu'ici, `null` au premier affichage (rien n'est « nouveau » :
 * tout est déjà dans la section Nouvelles). Les signalées restent signalées tant qu'elles sont « reçues ».
 */
export function nouvellesCommandes(commandes: readonly CommandeCuisine[], deja: ReadonlySet<string> | null, signalees: ReadonlySet<string>): Set<string> {
  const r = new Set<string>()
  for (const c of commandes) {
    if (c.statut !== 'recue') continue
    if (signalees.has(c.id) || (deja && !deja.has(c.id))) r.add(c.id)
  }
  return r
}

/** Remplace une commande dans la liste (réponse d'une transition, ou affichage immédiat avant la réponse). */
export const remplacerCommande = (commandes: readonly CommandeCuisine[], c: CommandeCuisine): CommandeCuisine[] =>
  commandes.map((x) => (x.id === c.id ? c : x))

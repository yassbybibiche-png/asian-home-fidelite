// Points de fidélité et passages en caisse (logique pure, partagée par le serveur et le front).
// Le serveur est seul à appliquer ces fonctions aux données enregistrées : le front ne fait qu'afficher.
import type { Client, Commerce, EchangePoints, RecompensePoints } from '../types'
import { validerVisite } from './fidelite.ts'

export const EUROS_PAR_POINT_DEFAUT = 1
/** Nombre d'identifiants d'actions gardés par client pour l'idempotence (file hors ligne). */
export const ACTIONS_MEMORISEES = 50

export function eurosParPoint(commerce: Pick<Commerce, 'eurosParPoint'>): number {
  const e = commerce.eurosParPoint
  return typeof e === 'number' && Number.isFinite(e) && e > 0 ? e : EUROS_PAR_POINT_DEFAUT
}

/** Points gagnés pour un montant (en centimes) : 1 point par tranche entière de `eurosParPoint` €. */
export function pointsPourMontant(centimes: number, commerce: Pick<Commerce, 'eurosParPoint'>): number {
  if (!Number.isFinite(centimes) || centimes <= 0) return 0
  return Math.floor(Math.round(centimes) / Math.round(eurosParPoint(commerce) * 100))
}

export const soldePoints = (c: Pick<Client, 'points'>) => c.points ?? 0

/** « 12,50 » / « 12.5 » / « 12 » → 1250 centimes ; vide → 0 ; invalide → null. */
export function analyserMontant(saisie: string): number | null {
  const s = saisie.trim().replace(/\s|€/g, '').replace(',', '.')
  if (!s) return 0
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null
  return Math.round(Number(s) * 100)
}

/** Prix non vérifié : affiché tel quel, jamais remplacé par un montant inventé. */
export const LIBELLE_PRIX_ABSENT = 'Prix sur place'

export function formaterPrix(centimes: number | null): string {
  if (centimes == null) return LIBELLE_PRIX_ABSENT
  return (centimes / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
}

const memoriser = (c: Client, actionId?: string): string[] | undefined =>
  actionId ? [...(c.actionsTraitees ?? []), actionId].slice(-ACTIONS_MEMORISEES) : c.actionsTraitees

export const actionDejaTraitee = (c: Client, actionId?: string) => !!actionId && (c.actionsTraitees ?? []).includes(actionId)

/**
 * Même jour calendaire **à Paris** (revue Codex P1-S12) : le jour de la garde « 1 tampon par jour » est celui du
 * commerce, pas celui du fuseau du navigateur — un téléphone en voyage (ou un serveur sans TZ forcée) ne doit pas
 * désactiver le bouton à la mauvaise heure. Même définition que le serveur (`server/index.ts` force `TZ` à
 * Europe/Paris ; `programme.ts` utilise ce même comparateur).
 */
export const memeJourParis = (a: Date, b: Date): boolean => {
  const jour = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' })
  return jour.format(a) === jour.format(b)
}

export const passageCeJour = (c: Client, jour: Date) => c.visites.some((v) => memeJourParis(new Date(v), jour))

/**
 * Passage en caisse : 1 tampon (règle existante `validerVisite`) + points pour le montant.
 * `multiplicateur` : niveau de fidélité (Habitué ×1,5, VIP ×2 — voir `src/lib/programme.ts`).
 * Lève une erreur si le client a déjà un passage ce jour-là (1 visite = 1 tampon par jour).
 */
export function enregistrerPassage(client: Client, commerce: Commerce, centimes: number, quand: Date, actionId?: string, multiplicateur = 1): Client {
  if (passageCeJour(client, quand)) throw new Error(`${client.prenom} a déjà un passage enregistré ce jour-là : 1 tampon par jour maximum.`)
  const apresVisite = validerVisite(client, commerce, quand)
  const gagnes = Math.round(pointsPourMontant(centimes, commerce) * multiplicateur)
  return {
    ...apresVisite,
    points: soldePoints(client) + gagnes,
    depenseCentimes: (client.depenseCentimes ?? 0) + Math.max(0, Math.round(centimes)),
    actionsTraitees: memoriser(client, actionId),
  }
}

/** Échange de points contre une récompense du catalogue, tracé avec le solde avant / après. */
export function echangerPoints(client: Client, recompense: RecompensePoints, auteur: string, quand: Date, id: string, actionId?: string): { client: Client; echange: EchangePoints } {
  const avant = soldePoints(client)
  if (avant < recompense.cout) throw new Error(`Solde insuffisant : ${avant} point${avant > 1 ? 's' : ''} pour « ${recompense.nom} » (${recompense.cout} points).`)
  const echange: EchangePoints = { id, date: quand.toISOString(), recompenseId: recompense.id, libelle: recompense.nom, cout: recompense.cout, soldeAvant: avant, soldeApres: avant - recompense.cout, auteur }
  return {
    client: { ...client, points: echange.soldeApres, echangesPoints: [...(client.echangesPoints ?? []), echange], actionsTraitees: memoriser(client, actionId) },
    echange,
  }
}

/** Mémorise l'action (récompense tampons) pour l'idempotence. */
export const avecAction = (c: Client, actionId?: string): Client => ({ ...c, actionsTraitees: memoriser(c, actionId) })

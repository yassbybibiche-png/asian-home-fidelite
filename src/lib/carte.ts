// Carte de fidélité côté client (P1-C3) : textes et calculs de la page #/carte, testables sans React.
import type { Client, Commerce, CommercePublic, RecompenseEnAttente } from '../types'
import { recompensesEnAttenteValables } from './programme.ts'

type CommerceCarte = Pick<Commerce | CommercePublic, 'type' | 'recompense'>

/** « Encore 3 repas avant votre plat offert » (restaurant) ; « Encore 1 visite avant votre récompense » (autres). */
export function texteProgression(restants: number, commerce: CommerceCarte): string {
  if (restants <= 0) return 'Carte complète'
  const unite = commerce.type === 'restaurant' ? 'repas' : `visite${restants > 1 ? 's' : ''}`
  const cible = /plat offert/i.test(commerce.recompense) ? 'votre plat offert' : 'votre récompense'
  return `Encore ${restants} ${unite} avant ${cible}`
}

// ---- Animation à chaque nouveau tampon ----

/** Dernier nombre de tampons vu sur CE téléphone, par carte (localStorage) : sert à animer les tampons ajoutés depuis. */
export const cleTamponsVus = (clientId: string) => `fideliz:tampons-vus:${clientId}`

/**
 * Indices (0 = 1er tampon) des tampons à animer : ceux gagnés depuis la dernière ouverture de la carte sur ce téléphone.
 * 1re ouverture (rien de mémorisé) ou récompense retirée entre-temps (moins de tampons) : rien à animer.
 */
export function tamponsNouveaux(vus: number | null, tampons: number): number[] {
  if (vus === null || !Number.isFinite(vus) || vus < 0 || tampons <= vus) return []
  return Array.from({ length: tampons - vus }, (_, i) => vus + i)
}

// ---- Lots en attente (à retirer au comptoir) ----

/** Gain de la roue du jour encore à retirer (servi par GET /cartes/:id : `jeu.codeDuJour`, `jeu.remisDuJour`). */
export interface GainDuJour {
  lot: string
  code: string
}

export interface LotEnAttente {
  id: string
  libelle: string
  origine: RecompenseEnAttente['origine'] | 'roue'
  /** Dernier moment où le lot est retirable ; absent = sans expiration. */
  expireLe?: string
  /** Code à montrer en caisse (gain de la roue). */
  code?: string
}

/** Fin du jour calendaire local (23:59:59.999) : un gain de la roue ne vaut que le jour du tirage. */
export function finDuJour(d: Date): Date {
  const f = new Date(d)
  f.setHours(23, 59, 59, 999)
  return f
}

/** Récompenses valables (paliers, défi, anniversaire…) + gain de la roue du jour non remis, les plus urgents d'abord. */
export function lotsEnAttente(client: Client, gainDuJour: GainDuJour | null | undefined, maintenant: Date): LotEnAttente[] {
  const lots: LotEnAttente[] = recompensesEnAttenteValables(client, maintenant).map((r) => ({
    id: r.id,
    libelle: r.libelle,
    origine: r.origine,
    ...(r.expireLe ? { expireLe: r.expireLe } : {}),
  }))
  if (gainDuJour?.code) lots.push({ id: `roue-${gainDuJour.code}`, libelle: gainDuJour.lot, origine: 'roue', expireLe: finDuJour(maintenant).toISOString(), code: gainDuJour.code })
  const t = (l: LotEnAttente) => (l.expireLe ? new Date(l.expireLe).getTime() : Infinity)
  return lots.sort((a, b) => t(a) - t(b))
}

/** « Valable aujourd’hui seulement » / « Valable jusqu’au 12 nov. » / « Sans date limite ». */
export function texteExpiration(expireLe: string | undefined, maintenant: Date): string {
  if (!expireLe) return 'Sans date limite'
  const fin = new Date(expireLe)
  if (fin.getTime() <= finDuJour(maintenant).getTime()) return 'Valable aujourd’hui seulement'
  return `Valable jusqu’au ${fin.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
}

// ---- Historique des visites et des lots ----

/** Lot gagné à la roue, vu par son titulaire (GET /cartes/:id `historiqueLots`) : jamais le code d'un autre jour. */
export interface LotHistorique {
  lot: string
  date: string
  statut: 'valable' | 'remis' | 'expire'
}

export interface LigneHistorique {
  date: string
  type: 'visite' | 'recompense' | 'echange' | 'defi' | 'roue'
  libelle: string
}

/** Fil chronologique (le plus récent d'abord) : visites, récompenses remises, échanges de points, défis, lots de la roue. */
export function historiqueCarte(client: Client, lotsRoue: LotHistorique[] = [], max = 20): LigneHistorique[] {
  const lignes: LigneHistorique[] = [
    ...client.visites.map((date) => ({ date, type: 'visite' as const, libelle: 'Visite validée (+1 tampon)' })),
    ...(client.recompensesOffertes ?? []).map((r) => ({ date: r.date, type: 'recompense' as const, libelle: `Récompense remise : ${r.libelle}` })),
    ...(client.echangesPoints ?? []).map((e) => ({ date: e.date, type: 'echange' as const, libelle: `${e.libelle} (−${e.cout} points)` })),
    ...(client.defisReussis ?? []).map((d) => ({ date: d.date, type: 'defi' as const, libelle: `Défi réussi : ${d.recompense}` })),
    ...lotsRoue.map((l) => ({
      date: l.date,
      type: 'roue' as const,
      libelle: `Roue : ${l.lot}${l.statut === 'remis' ? ' (retiré)' : l.statut === 'expire' ? ' (non retiré, expiré)' : ' (à retirer aujourd’hui)'}`,
    })),
  ]
  return lignes.filter((l) => !Number.isNaN(new Date(l.date).getTime())).sort((a, b) => b.date.localeCompare(a.date)).slice(0, max)
}

// ---- « Carte introuvable » : retrouver sa carte (audit F-12) ----

/**
 * Réponse affichée après une recherche de carte par téléphone / e-mail : TOUJOURS la même, que le contact corresponde
 * à une carte ou non (audit F-12 : la page ne doit pas permettre de tester si quelqu'un est client). `envoi` = un
 * prestataire SMS / e-mail est configuré sur le serveur pour ce canal — information sur le serveur, pas sur le contact.
 */
export function messageRechercheCarte(envoi: boolean): string {
  return envoi
    ? 'Si ce numéro ou cet e-mail correspond à une carte, son lien vient de vous être envoyé. Rien reçu d’ici quelques minutes ? Demandez au comptoir : l’équipe retrouve votre carte avec votre numéro.'
    : 'Par sécurité, nous n’indiquons jamais si une carte existe pour un numéro ou un e-mail. L’envoi automatique du lien n’est pas encore disponible : demandez au comptoir, l’équipe retrouve votre carte avec votre numéro.'
}

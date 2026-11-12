// Carte de fidélité côté client (P1-C3) : textes et calculs de la page #/carte, testables sans React.
import type { Client, Commerce, CommercePublic, RecompenseEnAttente } from '../types'
import { recompensesEnAttenteValables } from './programme.ts'
import type { StatutGain } from './roulette.ts'

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

/** Gain de la roue du jour encore à retirer (servi par GET /cartes/:id, avec jeton client seulement — P0-S19 :
 * `jeu.codeDuJour`, `jeu.remisDuJour`). */
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

/** Lot gagné à la roue, vu par son titulaire (GET /cartes/:id `historiqueLots`) : jamais de code. Statut v2 (R3). */
export interface LotHistorique {
  lot: string
  date: string
  statut: StatutGain
}

/**
 * Gain non terminal du client (R3, GET /cartes/:id `gainsEnCours`), sans code : enAttente (utilisable dès `utilisableLe`),
 * inactif (utilisable, code à activer), utilisable (code activé jusqu'à `expireActivation`). Le code ne vient que de
 * l'activation (`activerCode`, src/data/jeuApi.ts).
 */
export interface GainEnCours {
  tirageId: string
  lot: string
  date: string
  statut: Extract<StatutGain, 'enAttente' | 'inactif' | 'utilisable'>
  utilisableLe: string
  /** Premier instant expiré (fin de J+30). */
  expireLe: string
  expireActivation: string | null
}

/** « 13/11 » : jour et mois à Paris (bornes des gains = minuits parisiens), au format de la langue affichée. */
export function jourMois(d: Date, locale: 'fr-FR' | 'en-GB' = 'fr-FR'): string {
  return d.toLocaleDateString(locale, { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit' })
}

/** Code obtenu sur ce téléphone par « Utiliser mon gain » (R3 `activerCode`), gardé le temps de l'affichage. */
export interface ActivationAffichee {
  code: string
  expireActivation: string
  /** Heure du serveur moins heure de ce téléphone, mesurée à la réception (revue Codex R4, F1) ; absent = 0. */
  decalageMs?: number
}

/**
 * Activation reçue à `recueLe` (heure du téléphone) : `activeLe` est l'heure du serveur au moment de l'activation, d'où
 * le décalage d'horloge du téléphone — le compte à rebours tourne ensuite sur l'heure du serveur, pas sur celle d'un
 * téléphone en avance ou en retard (à la latence de la réponse près).
 */
export function activationRecue(a: { code: string; activeLe: string; expireActivation: string }, recueLe: Date): ActivationAffichee {
  const decalageMs = new Date(a.activeLe).getTime() - recueLe.getTime()
  return { code: a.code, expireActivation: a.expireActivation, ...(Number.isFinite(decalageMs) ? { decalageMs } : {}) }
}

/**
 * Bloc d'un gain sur la carte (R4, maquettes §3) — enAttente : « Utilisable du … au … » ; aActiver : bouton « Utiliser
 * mon gain » (`reactiver` : un code a déjà été affiché, sa fenêtre est échue) ; code : code + temps restant ; direct :
 * gain d'avant la roue v2, à retirer au comptoir le jour même sans activation. null : expiré entre-temps (le bloc
 * disparaît, l'historique le garde). `au` = dernier jour d'utilisation (J+30).
 */
export type VueGain =
  | { etat: 'enAttente'; du: Date; au: Date }
  | { etat: 'aActiver'; au: Date; reactiver: boolean }
  | { etat: 'code'; code: string; au: Date; resteMs: number }
  | { etat: 'direct' }

export function vueGain(g: GainEnCours, activation: ActivationAffichee | undefined, maintenant: Date): VueGain | null {
  const fin = new Date(g.expireLe)
  if (maintenant.getTime() >= fin.getTime()) return null
  const au = new Date(fin.getTime() - 1)
  const du = new Date(g.utilisableLe)
  if (maintenant.getTime() < du.getTime()) return { etat: 'enAttente', du, au }
  // Tirage hérité du jour (revue Codex R3, F2) : « utilisable » sans fenêtre d'activation — jamais activable.
  if (g.statut === 'utilisable' && !g.expireActivation && !activation) return { etat: 'direct' }
  // Fenêtre de 10 minutes décomptée sur l'heure du serveur (heure du téléphone + décalage mesuré à l'activation).
  const resteMs = activation ? new Date(activation.expireActivation).getTime() - (maintenant.getTime() + (activation.decalageMs ?? 0)) : 0
  if (activation && resteMs > 0) return { etat: 'code', code: activation.code, au, resteMs }
  // Fenêtre en cours côté serveur mais code inconnu ici (page rechargée) : un nouvel appui le réaffiche.
  return { etat: 'aActiver', au, reactiver: !!activation }
}

/** Recalcul local des gains affichés sans code (revue Codex R4, F2) : assez fin pour franchir minuit sans attendre. */
export const RECALCUL_GAINS_MS = 30_000
/** Plus long délai d'attente d'une borne en une fois (setTimeout déborde au-delà de ~24,8 jours ; J+30 en est loin). */
const ATTENTE_MAX_MS = 6 * 3600_000

/**
 * Rafraîchissement du bloc des gains tant que la page reste ouverte (revue Codex R4, F2) : l'affichage relit l'heure
 * chaque seconde si un code est affiché, toutes les 30 s s'il reste un gain non terminal, sinon jamais (null).
 */
export function intervalleRecalcul(gains: GainEnCours[], codeAffiche: boolean): number | null {
  return codeAffiche ? 1000 : gains.length ? RECALCUL_GAINS_MS : null
}

/**
 * Prochain changement de statut côté serveur (utilisable dès minuit à Paris, expiré à J+30) : la carte se recharge UNE
 * fois à cet instant (pas de polling réseau). null : aucune borne à venir.
 */
export function prochaineBorne(gains: GainEnCours[], maintenant: Date): Date | null {
  const futures = gains
    .flatMap((g) => [g.utilisableLe, g.expireLe])
    .map((d) => new Date(d).getTime())
    .filter((t) => Number.isFinite(t) && t > maintenant.getTime())
  return futures.length ? new Date(Math.min(...futures)) : null
}

/** Attente avant de revérifier la borne : jusqu'à elle (+1 s, la borne serveur est alors franchie), plafonnée. */
export function attenteBorne(borne: Date, maintenant: Date): number {
  return Math.min(Math.max(0, borne.getTime() - maintenant.getTime()) + 1000, ATTENTE_MAX_MS)
}

/** Appelle `recharger` une seule fois, juste après `borne` (attente découpée par tranches de 6 h). Renvoie l'annulation. */
export function surveillerBorne(borne: Date, recharger: () => void): () => void {
  let minuterie: ReturnType<typeof setTimeout> | undefined
  const attendre = () => {
    const maintenant = new Date()
    if (maintenant.getTime() > borne.getTime()) return recharger()
    minuterie = setTimeout(attendre, attenteBorne(borne, maintenant))
  }
  attendre()
  return () => clearTimeout(minuterie)
}

/** « 09:47 » : minutes et secondes restantes (arrondi à la seconde supérieure, jamais négatif). */
export function compteARebours(resteMs: number): string {
  const s = Math.max(0, Math.ceil(resteMs / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
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

// Logique pure de la roulette : tirage pondéré, anti-abus, géométrie de la roue.
import type { Client, Commerce, Lot, ModeAccesRoue, Tirage, TypeLot } from '../types'

/**
 * Lot affichable sur la roue. Vue commerçant : avec sa probabilité. Vue publique (pages client) : libellé seul,
 * le serveur ne publiant que les lots jouables — chaque lot y compte alors pour 1 (secteurs égaux). `id` / `type` :
 * présents sur la vue publique et sur les lots normalisés (`normaliserLots`), absents d'une config d'avant R1 non normalisée.
 */
export type LotRoue = Pick<Lot, 'libelle'> & { probabilite?: number; id?: string; type?: TypeLot }

const poids = (l: LotRoue) => l.probabilite ?? 1

/** Lots réellement tirables (libellé non vide, probabilité > 0). */
export function lotsJouables<T extends LotRoue>(lots: T[]): T[] {
  return lots.filter((l) => l.libelle.trim() && poids(l) > 0)
}

export function totalProbabilites(lots: LotRoue[]): number {
  return lotsJouables(lots).reduce((s, l) => s + poids(l), 0)
}

/** Tirage pondéré ; si le total ≠ 100 %, les chances sont recalculées au prorata. */
export function tirerLot(lots: Lot[], alea = Math.random()): number {
  const jouables = lotsJouables(lots)
  const total = totalProbabilites(lots)
  let seuil = alea * total
  for (let i = 0; i < jouables.length; i++) {
    seuil -= jouables[i].probabilite
    if (seuil < 0) return i
  }
  return jouables.length - 1
}

function memeJour(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** Anti-abus : 1 tirage par client et par jour (jour calendaire local). */
export function tirageDuJour(tirages: Tirage[], commerceId: string, clientId: string, maintenant = new Date()): Tirage | undefined {
  return tirages.find((t) => t.commerceId === commerceId && t.clientId === clientId && memeJour(new Date(t.date), maintenant))
}

/** Visite validée au comptoir aujourd'hui (jour calendaire local) dans ce commerce. */
export function aVisiteDuJour(client: Client, commerceId: string, maintenant = new Date()): boolean {
  return client.commerceId === commerceId && client.visites.some((v) => memeJour(new Date(v), maintenant))
}

export type StatutJeu = 'pret' | 'sansVisite' | 'dejaJoue'

/** Mode d'accès effectif (R2) : seul 'libre' explicite ouvre la roue sans visite — absent = 'visite' (configs d'avant R2). */
export function modeAccesRoue(c: Pick<Commerce, 'modeAccesRoue'>): ModeAccesRoue {
  return c.modeAccesRoue === 'libre' ? 'libre' : 'visite'
}

/**
 * 1 tirage par client et par jour, toujours. Mode 'visite' (défaut) : il faut en plus une visite validée par le
 * commerçant le jour même — le jeu ne crée jamais de visite lui-même. Mode 'libre' (R2) : prêt dès l'identification,
 * jamais 'sansVisite'.
 */
export function statutJeu(client: Client, tirages: Tirage[], commerceId: string, maintenant = new Date(), mode: ModeAccesRoue = 'visite'): StatutJeu {
  if (tirageDuJour(tirages, commerceId, client.id, maintenant)) return 'dejaJoue'
  if (mode !== 'libre' && !aVisiteDuJour(client, commerceId, maintenant)) return 'sansVisite'
  return 'pret'
}

export function peutJouer(client: Client, tirages: Tirage[], commerceId: string, maintenant = new Date(), mode: ModeAccesRoue = 'visite'): boolean {
  return statutJeu(client, tirages, commerceId, maintenant, mode) === 'pret'
}

// ---- Ensemble tirable du jour (roue v2, R2) : plafonds journaliers et limite mensuelle de gains ----

export const LIMITE_GAINS_MOIS_DEFAUT = 4
export const LIMITE_GAINS_MOIS_MAX = 31
export const PLAFOND_JOUR_MAX = 10_000
/** Fenêtre de la limite de gains : 30 jours glissants. */
const FENETRE_GAINS_MS = 30 * 24 * 3600 * 1000

/** Limite effective de lots physiques gagnés par client sur 30 jours : absente (ou invalide) = 4 ; 0 = illimité. */
export function limiteGainsMois(c: Pick<Commerce, 'limiteGainsMois'>): number {
  const n = c.limiteGainsMois
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : LIMITE_GAINS_MOIS_DEFAUT
}

/** Début du jour calendaire local de `maintenant` (même jour que `tirageDuJour`), en ISO : borne de lecture des tirages du jour. */
export function debutDuJour(maintenant: Date): string {
  return new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate()).toISOString()
}

// Journée des plafonds (revue Codex R2 point 3) : jour calendaire à PARIS, comme l'index unique quotidien des tirages
// sous Supabase — quel que soit le fuseau du processus (UTC sur Render). Ne concerne que les plafonds R2 :
// `tirageDuJour` / `aVisiteDuJour` gardent le jour local (hors périmètre).
const FORMAT_JOUR_PARIS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' })
const FORMAT_HEURE_PARIS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
})
const jourParis = (d: Date) => FORMAT_JOUR_PARIS.format(d)

/** Avance de l'heure de Paris sur UTC à cet instant, en ms (+1 h en hiver, +2 h en été). */
function decalageParis(instant: number): number {
  const p = Object.fromEntries(FORMAT_HEURE_PARIS.formatToParts(new Date(instant)).map((x) => [x.type, Number(x.value)]))
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - (instant - (instant % 1000))
}

/** Minuit à Paris du jour parisien de `maintenant`, en ISO : borne de lecture des tirages du jour pour les plafonds. */
export function debutDuJourParis(maintenant: Date): string {
  const [a, m, j] = jourParis(maintenant).split('-').map(Number)
  const minuitUtc = Date.UTC(a, m - 1, j)
  // Deux passes : le décalage à prendre est celui de minuit à Paris (un changement d'heure a lieu à 2 h / 3 h, jamais à minuit).
  const approche = minuitUtc - decalageParis(minuitUtc)
  return new Date(minuitUtc - decalageParis(approche)).toISOString()
}

type LotType = Pick<Lot, 'libelle' | 'plafondJour'> & { id: string; type: TypeLot }

/** Le tirage `t` a-t-il donné ce lot ? Par id (R1+) ; tirages d'avant R1 (sans id) : par libellé. */
const tirageDuLot = (t: Tirage, l: LotType) => (t.lotId ? t.lotId === l.id : t.lot === l.libelle)

/**
 * Ids des lots physiques ayant atteint leur `plafondJour` aujourd'hui — jour à Paris — (tous clients du commerce
 * confondus). `tirages` : au moins ceux du jour du commerce (les autres jours sont ignorés). Lots 'points' / 'perdant' :
 * jamais plafonnés.
 */
export function lotsPlafonnes(lots: LotType[], tirages: Tirage[], maintenant = new Date()): Set<string> {
  const plafonnes = new Set<string>()
  const aujourdhui = jourParis(maintenant)
  const duJour = tirages.filter((t) => jourParis(new Date(t.date)) === aujourdhui)
  for (const l of lots) {
    const plafond = l.plafondJour ?? 0
    if (l.type !== 'lot' || !(plafond > 0)) continue
    if (duJour.filter((t) => tirageDuLot(t, l)).length >= plafond) plafonnes.add(l.id)
  }
  return plafonnes
}

/** Lots physiques GAGNÉS (remis ou non) par ce client sur les 30 derniers jours. `tiragesClient` : ses tirages. */
export function gainsSur30Jours(tiragesClient: Tirage[], maintenant = new Date()): number {
  const depuis = maintenant.getTime() - FENETRE_GAINS_MS
  return tiragesClient.filter((t) => estGainPhysique(typeTirage(t)) && new Date(t.date).getTime() > depuis).length
}

/**
 * Lots tirables pour ce client aujourd'hui (R2) : tous, sauf les lots physiques plafonnés du jour, et sauf TOUS les lots
 * physiques si le client a déjà gagné `limite` lots sur 30 jours (limite 0 = illimitée). Points et perdant ne sont jamais
 * retirés : c'est le repli consolation. L'ordre est conservé ; le tirage pondéré renormalise au prorata (`tirerLot`).
 */
export function lotsTirables<T extends LotType>(lots: T[], o: { plafonnes: ReadonlySet<string>; gainsMois: number; limite: number }): T[] {
  const limiteAtteinte = o.limite > 0 && o.gainsMois >= o.limite
  return lots.filter((l) => l.type !== 'lot' || (!limiteAtteinte && !o.plafonnes.has(l.id)))
}

export interface Secteur {
  lot: LotRoue
  debut: number
  fin: number
}

/**
 * Secteurs de la roue en degrés (0 = en haut, sens horaire), proportionnels aux chances quand elles sont connues
 * (vue commerçant) ; égaux pour la vue publique, qui ne les publie pas (des secteurs proportionnels les révéleraient).
 */
export function secteurs(lots: LotRoue[]): Secteur[] {
  const jouables = lotsJouables(lots)
  const total = totalProbabilites(lots)
  let angle = 0
  return jouables.map((lot) => {
    const debut = angle
    angle += (poids(lot) / total) * 360
    return { lot, debut, fin: angle }
  })
}

/** Rotation finale pour que le secteur gagnant s'arrête sous le pointeur (en haut). */
export function rotationCible(rotationActuelle: number, secteur: Secteur, alea = Math.random(), tours = 5): number {
  const marge = (secteur.fin - secteur.debut) * 0.15
  const cible = secteur.debut + marge + alea * (secteur.fin - secteur.debut - 2 * marge)
  const restant = (((360 - cible - rotationActuelle) % 360) + 360) % 360
  return rotationActuelle + tours * 360 + restant
}

// ---- Type des lots (roue v2, R1 ; le reste de la normalisation : src/lib/lots.ts) ----

export const TYPES_LOT: readonly TypeLot[] = ['lot', 'points', 'perdant']
export const POINTS_LOT_MIN = 1
export const POINTS_LOT_MAX = 10_000

/** Ancienne règle (avant R1), réservée aux lots et tirages enregistrés sans type. */
const ANCIEN_LIBELLE_PERDANT = /pas de chance|perdu|dommage|rejouez/i

export function typeDeduitDuLibelle(libelle: string): TypeLot {
  return ANCIEN_LIBELLE_PERDANT.test(libelle) ? 'perdant' : 'lot'
}

export function estTypeLot(v: unknown): v is TypeLot {
  return TYPES_LOT.includes(v as TypeLot)
}

/** Type résolu d'un tirage : celui figé au tirage, à défaut l'ancienne règle sur le libellé (tirages d'avant R1). */
export function typeTirage(t: Pick<Tirage, 'lot' | 'typeLot'>): TypeLot {
  return estTypeLot(t.typeLot) ? t.typeLot : typeDeduitDuLibelle(t.lot)
}

/** Lot physique à remettre au comptoir (code gagnant, coût, statistiques de gains) : ni consolation en points, ni perdant. */
export function estGainPhysique(type: TypeLot): boolean {
  return type === 'lot'
}

// ---- Code gagnant vérifié en caisse (P0-U3) ----

/** Saisie du code en caisse : casse, espaces et tirets ignorés. null = pas un code à 6 caractères. */
export function normaliserCodeGagnant(saisi: string): string | null {
  const c = saisi.replace(/[\s-]/g, '').toUpperCase()
  return /^[A-Z0-9]{6}$/.test(c) ? c : null
}

// ---- Cycle de vie d'un gain (roue v2, R3) : utilisable de J+1 à J+30, code activé 10 minutes (burn-on-reveal) ----

/** Dernier jour d'utilisation, compté depuis le jour du tirage (J+30 inclus). */
export const DUREE_GAIN_JOURS = 30
/** Durée de validité du code après chaque activation par le client (« Utiliser mon gain »). */
export const FENETRE_ACTIVATION_MS = 10 * 60 * 1000

/** Minuit (jour calendaire local, comme `memeJour`) du jour de `d` décalé de `n` jours — changements d'heure compris. */
export function ajouterJours(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

/** Premier instant où le gain s'utilise : minuit au début de J+1. */
export function utilisableLe(t: Pick<Tirage, 'date'>): Date {
  return ajouterJours(new Date(t.date), 1)
}

/** Dernier jour d'utilisation (J+30), à minuit : le gain expire à la fin de ce jour-là. */
export function dernierJourGain(t: Pick<Tirage, 'date'>): Date {
  return ajouterJours(new Date(t.date), DUREE_GAIN_JOURS)
}

/** Premier instant où le gain est expiré : minuit à la fin de J+30. */
export function finGain(t: Pick<Tirage, 'date'>): Date {
  return ajouterJours(new Date(t.date), DUREE_GAIN_JOURS + 1)
}

/** Fin de la fenêtre d'activation en cours (ISO), ou null si le code n'a jamais été activé. */
export function finActivation(t: Pick<Tirage, 'activeLe'>): string | null {
  return t.activeLe ? new Date(new Date(t.activeLe).getTime() + FENETRE_ACTIVATION_MS).toISOString() : null
}

/** Code activé il y a moins de 10 minutes. */
export function fenetreActive(t: Pick<Tirage, 'activeLe'>, maintenant = new Date()): boolean {
  if (!t.activeLe) return false
  const debut = new Date(t.activeLe).getTime()
  return debut <= maintenant.getTime() && maintenant.getTime() < debut + FENETRE_ACTIVATION_MS
}

/**
 * Cycle de vie d'un tirage (R3) — enAttente : le jour du tirage ; utilisable : de J+1 à J+30 inclus ; remis : remis en
 * caisse (terminal) ; expire : après J+30 sans remise. perdant / consolation (lot « points ») : rien à remettre. Le
 * type vient du tirage (`typeTirage`). S'applique à tous les tirages, ceux d'avant R3 compris.
 */
export type CycleGain = 'enAttente' | 'utilisable' | 'remis' | 'expire' | 'perdant' | 'consolation'

export function cycleGain(t: Tirage, maintenant = new Date()): CycleGain {
  const type = typeTirage(t)
  if (type === 'perdant') return 'perdant'
  if (type === 'points') return 'consolation'
  if (t.remis) return 'remis'
  if (maintenant < utilisableLe(t)) return 'enAttente'
  return maintenant < finGain(t) ? 'utilisable' : 'expire'
}

/**
 * Statut v2 d'un gain, vu par la caisse ET par la carte : le cycle de vie, où « utilisable » exige en plus une fenêtre
 * d'activation en cours — sinon `inactif` (gain utilisable, mais code pas activé ou activé il y a 10 minutes ou plus :
 * le client doit appuyer sur « Utiliser mon gain »). Seul `utilisable` se remet en caisse.
 */
export type StatutGain = CycleGain | 'inactif'

export function statutGain(t: Tirage, maintenant = new Date()): StatutGain {
  const cycle = cycleGain(t, maintenant)
  return cycle === 'utilisable' && !fenetreActive(t, maintenant) ? 'inactif' : cycle
}

/** Gain encore en jeu (rien de terminal) : à afficher sur la carte du client. */
export function gainEnCours(s: StatutGain): boolean {
  return s === 'enAttente' || s === 'utilisable' || s === 'inactif'
}

/**
 * Parmi les tirages portant ce code (collision possible d'un tirage à l'autre) : celui dont le code est activé en ce
 * moment d'abord, puis un gain physique encore en jeu, sinon le plus récent (`tirages` : du plus récent au plus ancien).
 */
export function tirageDuCode(tirages: Tirage[], maintenant = new Date()): Tirage | undefined {
  const physiques = tirages.filter((t) => estGainPhysique(typeTirage(t)) && !t.remis)
  return (
    physiques.find((t) => statutGain(t, maintenant) === 'utilisable') ??
    physiques.find((t) => gainEnCours(statutGain(t, maintenant))) ??
    tirages[0]
  )
}

/** « mar. 10 nov. 2026 » : jour en clair des messages du gain. */
export function jourEnClair(d: Date): string {
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

export const MESSAGE_ACTIVATION =
  'Demandez au client d’appuyer sur « Utiliser mon gain » dans son application : le code n’est valable que 10 minutes après activation.'

/** Message de la caisse pour un code vérifié, v2 (maquettes R3 §4 ; `remis.par` = nom de qui l'a remis). */
export function messageGain(g: { statut: StatutGain; lot: string; date: string; remis: { le: string; par: string } | null }): string {
  const gagneLe = jourEnClair(new Date(g.date))
  if (g.statut === 'perdant' || g.statut === 'consolation') return `Ce tirage n’a pas de lot à remettre (${g.lot}).`
  if (g.statut === 'enAttente') return `Pas encore utilisable : ce gain gagné le ${gagneLe} s’utilise à partir du ${jourEnClair(utilisableLe(g))}.`
  if (g.statut === 'expire') return `Gain expiré le ${jourEnClair(dernierJourGain(g))} : rien à remettre.`
  if (g.statut === 'inactif') return MESSAGE_ACTIVATION
  if (g.statut === 'remis') {
    const le = g.remis ? new Date(g.remis.le) : null
    const quand = le ? ` le ${le.toLocaleDateString('fr-FR')} à ${le.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} par ${g.remis!.par}` : ''
    return `Lot déjà remis${quand} : un code ne sert qu’une fois.`
  }
  return `Gain à remettre : ${g.lot} (gagné le ${gagneLe}).`
}

/** Refus d'activation vu par le CLIENT (route …/activer) : null = le gain peut être activé maintenant. */
export function refusActivation(t: Tirage, maintenant = new Date()): { statut: 409 | 410; message: string } | null {
  const cycle = cycleGain(t, maintenant)
  if (cycle === 'utilisable' && t.code) return null
  if (cycle === 'enAttente') return { statut: 409, message: `Votre gain sera utilisable dès demain, ${jourEnClair(utilisableLe(t))}, et jusqu’au ${jourEnClair(dernierJourGain(t))}.` }
  if (cycle === 'expire') return { statut: 410, message: `Gain expiré le ${jourEnClair(dernierJourGain(t))} : il n’est plus utilisable.` }
  if (cycle === 'remis') return { statut: 409, message: 'Ce gain a déjà été remis au comptoir.' }
  return { statut: 409, message: 'Ce tirage n’a pas de lot à retirer au comptoir.' }
}

// Tableau de bord & mesure (P2-Q3) — logique pure, testée sans React ni serveur.
// • Coût des lots : coût unitaire saisi dans Réglages (`Lot.coutCentimes`) × lots gagnés / distribués.
// • Séries par jour / semaine / mois, comparaison avec le mois précédent, export CSV.
// • Entonnoir ANONYME : compteurs du serveur (scan, tirage, gain, clic Google) sans aucune identité.
// • Test A/B « accroche » : variante décidée par le JOUR (jamais par le client).
// Tous les jours sont des jours calendaires à Paris (AAAA-MM-JJ), comme le serveur (index unique des tirages).
import type { Client, CommercePublic, CompteurEvenement, Lot, TestsAB, Tirage, TypeEvenement } from '../types'
import { celluleCsv } from './csv.ts'
import { estPerdant, lotsJouables } from './roulette.ts'

const JOUR_MS = 24 * 60 * 60 * 1000

/** Jour calendaire à Paris d'une date (ISO ou Date) : AAAA-MM-JJ. */
export function jourParis(d: Date | string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(typeof d === 'string' ? new Date(d) : d)
}

const versDate = (jour: string) => new Date(`${jour}T00:00:00Z`)
const versJour = (d: Date) => d.toISOString().slice(0, 10)

/** `jour` décalé de `n` jours (n négatif : en arrière). */
export function ajouterJours(jour: string, n: number): string {
  return versJour(new Date(versDate(jour).getTime() + n * JOUR_MS))
}

// ---------- Périodes ----------

export type Granularite = 'jour' | 'semaine' | 'mois'

/** Nombre de périodes affichées par défaut : 30 jours, 12 semaines, 12 mois. */
export const NB_PERIODES: Record<Granularite, number> = { jour: 30, semaine: 12, mois: 12 }

/** Premier jour de la période qui contient `jour` : le jour lui-même, le lundi de sa semaine, le 1er du mois. */
export function debutPeriode(jour: string, g: Granularite): string {
  if (g === 'jour') return jour
  if (g === 'mois') return `${jour.slice(0, 7)}-01`
  const lundi = (versDate(jour).getUTCDay() + 6) % 7 // 0 = lundi
  return ajouterJours(jour, -lundi)
}

/** Dernier jour de la période qui commence à `debut`. */
export function finPeriode(debut: string, g: Granularite): string {
  if (g === 'jour') return debut
  if (g === 'semaine') return ajouterJours(debut, 6)
  const d = versDate(debut)
  return versJour(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)))
}

/** Débuts des `n` dernières périodes, de la plus ancienne à celle d'aujourd'hui (incluse). */
export function periodes(g: Granularite, aujourdhui: string, n = NB_PERIODES[g]): string[] {
  const liste: string[] = []
  let debut = debutPeriode(aujourdhui, g)
  for (let i = 0; i < n; i++) {
    liste.unshift(debut)
    debut = debutPeriode(ajouterJours(debut, -1), g)
  }
  return liste
}

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']

/** « lun. 9 nov. », « sem. du 9 nov. », « nov. 2026 » (sans Intl : même rendu partout, y compris dans les tests). */
export function libellePeriode(debut: string, g: Granularite): string {
  const d = versDate(debut)
  const jourMois = `${d.getUTCDate()} ${MOIS_COURTS[d.getUTCMonth()]}`
  if (g === 'jour') return `${JOURS_COURTS[d.getUTCDay()]} ${jourMois}`
  if (g === 'semaine') return `sem. du ${jourMois}`
  return `${MOIS_COURTS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

// ---------- Coût des lots ----------

/**
 * Définitions affichées dans le tableau de bord :
 * • GAGNÉ = tirage dont le lot n'est pas perdant (« Dommage ! »…), retiré ou non au comptoir ;
 * • DISTRIBUÉ = lot gagné ET remis au comptoir (code vérifié en caisse, P0-U3) — c'est le coût réellement sorti.
 * Le coût appliqué est le coût unitaire ACTUEL du lot (Réglages), y compris pour les tirages passés.
 */
export const DEFINITION_GAGNE = 'Gagné : le tirage a donné un lot (pas « Dommage ! »), qu’il ait été retiré ou non.'
export const DEFINITION_DISTRIBUE = 'Distribué : lot gagné ET remis au comptoir (code vérifié en caisse) — le coût réellement sorti.'

/** Coût unitaire saisi : absent, ou entier de 0 à 100 000 centimes (1 000 €) — même règle que le serveur. */
export function coutLotValide(c: unknown): boolean {
  return c === undefined || (typeof c === 'number' && Number.isInteger(c) && c >= 0 && c <= 100_000)
}

/** Coût unitaire (centimes) du lot de ce libellé, ou null si le lot n'existe plus ou n'a pas de coût renseigné. */
export function coutUnitaire(lots: Lot[], libelle: string): number | null {
  const lot = lots.find((l) => l.libelle.trim() === libelle.trim())
  return lot && typeof lot.coutCentimes === 'number' && Number.isFinite(lot.coutCentimes) ? lot.coutCentimes : null
}

export interface LigneCoutLot {
  lot: string
  /** Centimes ; null = non renseigné (ou lot supprimé / renommé depuis le tirage). */
  coutUnitaire: number | null
  gagnes: number
  distribues: number
  /** Centimes (0 si le coût unitaire est inconnu). */
  coutGagnes: number
  coutDistribues: number
}

const dansIntervalle = (jour: string, debut: string, fin: string) => jour >= debut && jour <= fin

/** Jour dans [debut, fin] (jours à Paris, inclus) — aussi utilisé par le test 2 (`mesure-offre.ts`). */
export { dansIntervalle }

/** Gains de la période [debut, fin] (jours à Paris, inclus) regroupés par lot, du plus coûteux au moins coûteux. */
export function coutsParLot(tirages: Tirage[], lots: Lot[], debut: string, fin: string): LigneCoutLot[] {
  const parLot = new Map<string, LigneCoutLot>()
  for (const t of tirages) {
    if (estPerdant(t.lot) || !dansIntervalle(jourParis(t.date), debut, fin)) continue
    const cout = coutUnitaire(lots, t.lot)
    const l = parLot.get(t.lot) ?? { lot: t.lot, coutUnitaire: cout, gagnes: 0, distribues: 0, coutGagnes: 0, coutDistribues: 0 }
    l.gagnes++
    l.coutGagnes += cout ?? 0
    if (t.remis) {
      l.distribues++
      l.coutDistribues += cout ?? 0
    }
    parLot.set(t.lot, l)
  }
  return [...parLot.values()].sort((a, b) => b.coutGagnes - a.coutGagnes || b.gagnes - a.gagnes || a.lot.localeCompare(b.lot))
}

// ---------- Totaux, séries ----------

export interface DonneesMesure {
  clients: Pick<Client, 'visites'>[]
  tirages: Tirage[]
  lots: Lot[]
  /** Compteurs anonymes du serveur (vide en mode local, ou tant que la migration 0008 n'est pas appliquée). */
  compteurs: CompteurEvenement[]
}

export interface Totaux {
  /** Visites validées au comptoir (tampons). */
  visites: number
  /** Tirages enregistrés (table des tirages). */
  tirages: number
  gains: number
  distribues: number
  /** Centimes. */
  coutGagnes: number
  coutDistribues: number
  /** Gains dont le lot n'a pas de coût renseigné : le coût affiché est alors un minimum. */
  gainsSansCout: number
  /** Compteurs anonymes (événements). */
  evenements: Record<TypeEvenement, number>
}

const evenementsVides = (): Record<TypeEvenement, number> => ({ scan: 0, tirage: 0, gain: 0, clicGoogle: 0 })

/** Totaux de la période [debut, fin] (jours à Paris, inclus). */
export function totaux(d: DonneesMesure, debut: string, fin: string): Totaux {
  const r: Totaux = { visites: 0, tirages: 0, gains: 0, distribues: 0, coutGagnes: 0, coutDistribues: 0, gainsSansCout: 0, evenements: evenementsVides() }
  for (const c of d.clients) for (const v of c.visites) if (dansIntervalle(jourParis(v), debut, fin)) r.visites++
  for (const t of d.tirages) {
    if (!dansIntervalle(jourParis(t.date), debut, fin)) continue
    r.tirages++
    if (estPerdant(t.lot)) continue
    const cout = coutUnitaire(d.lots, t.lot)
    r.gains++
    r.coutGagnes += cout ?? 0
    if (cout === null) r.gainsSansCout++
    if (t.remis) {
      r.distribues++
      r.coutDistribues += cout ?? 0
    }
  }
  for (const c of d.compteurs) if (dansIntervalle(c.jour, debut, fin) && c.type in r.evenements) r.evenements[c.type] += c.n
  return r
}

export interface PointSerie extends Totaux {
  debut: string
  fin: string
  libelle: string
}

/** Série des `n` dernières périodes (jour / semaine / mois), la période en cours comprise (arrêtée à aujourd'hui). */
export function serie(d: DonneesMesure, g: Granularite, aujourdhui: string, n = NB_PERIODES[g]): PointSerie[] {
  return periodes(g, aujourdhui, n).map((debut) => {
    const fin = finPeriode(debut, g) < aujourdhui ? finPeriode(debut, g) : aujourdhui
    return { debut, fin, libelle: libellePeriode(debut, g), ...totaux(d, debut, fin) }
  })
}

// ---------- Comparaison avec le mois précédent ----------

export interface Comparaison {
  courant: { debut: string; fin: string; totaux: Totaux }
  precedent: { debut: string; fin: string; totaux: Totaux }
}

/**
 * Mois en cours (du 1er à aujourd'hui) comparé à la MÊME durée du mois précédent (du 1er au même quantième, ramené au
 * dernier jour du mois s'il est plus court) : comparer 10 jours à un mois entier ferait croire à une chute.
 */
export function comparaisonMoisPrecedent(d: DonneesMesure, aujourdhui: string): Comparaison {
  const debut = debutPeriode(aujourdhui, 'mois')
  const debutPrec = debutPeriode(ajouterJours(debut, -1), 'mois')
  const finMoisPrec = finPeriode(debutPrec, 'mois')
  const memeQuantieme = `${debutPrec.slice(0, 8)}${aujourdhui.slice(8)}`
  const finPrec = memeQuantieme > finMoisPrec ? finMoisPrec : memeQuantieme
  return {
    courant: { debut, fin: aujourdhui, totaux: totaux(d, debut, aujourdhui) },
    precedent: { debut: debutPrec, fin: finPrec, totaux: totaux(d, debutPrec, finPrec) },
  }
}

/** Variation en % (arrondie) ; null si la base est 0 (pas de pourcentage inventé). */
export function variation(courant: number, precedent: number): number | null {
  if (!precedent) return null
  return Math.round(((courant - precedent) / precedent) * 100)
}

/** « +12 % », « −8 % », « = », ou « nouveau » si rien le mois précédent. */
export function texteVariation(courant: number, precedent: number): string {
  const v = variation(courant, precedent)
  if (v === null) return courant ? 'nouveau' : '='
  if (v === 0) return '='
  return `${v > 0 ? '+' : '−'}${Math.abs(v)} %`
}

// ---------- Entonnoir, participation, retour après gain ----------

/** Taux en % arrondi, null si le dénominateur est 0. */
export function taux(numerateur: number, denominateur: number): number | null {
  return denominateur > 0 ? Math.round((numerateur / denominateur) * 100) : null
}

export interface EtapeEntonnoir {
  cle: TypeEvenement
  libelle: string
  n: number
  /** % de l'étape précédente (null pour la 1re, ou si l'étape précédente vaut 0). */
  tauxEtape: number | null
}

/**
 * Entonnoir anonyme de la période, entièrement tiré des compteurs du serveur (même source, mêmes dates de début) :
 * ouvertures de la page de jeu → tirages → gains → clics vers Google.
 */
export function entonnoir(t: Totaux): EtapeEntonnoir[] {
  const etapes: [TypeEvenement, string][] = [
    ['scan', 'Scans du QR (page chargée ou non)'],
    ['tirage', 'Tirages'],
    ['gain', 'Gains'],
    ['clicGoogle', 'Clics vers l’avis Google'],
  ]
  return etapes.map(([cle, libelle], i) => ({
    cle,
    libelle,
    n: t.evenements[cle],
    tauxEtape: i === 0 ? null : taux(t.evenements[cle], t.evenements[etapes[i - 1][0]]),
  }))
}

/** Taux de participation : tirages / visites validées de la période (une visite validée = un droit de jouer). */
export function tauxParticipation(t: Totaux): number | null {
  return taux(t.tirages, t.visites)
}

/** Fenêtre de retour après un gain, en jours. */
export const JOURS_RETOUR = 30

export interface RetourApresGain {
  /** Gains de la période dont la fenêtre de 30 jours est terminée (seuls ceux-là sont comptés). */
  gains: number
  /** Parmi eux : client revenu (visite validée un jour APRÈS celui du gain, dans les 30 jours). */
  revenus: number
  taux: number | null
}

/**
 * Retour après gain : parmi les gains (lots non perdants) de [debut, fin] dont la fenêtre de JOURS_RETOUR jours est
 * close à `aujourdhui`, part des gagnants qui ont fait valider au moins une visite le lendemain du gain ou plus tard,
 * dans les 30 jours. Le jour du gain est exclu (il faut une visite le jour même pour jouer). Calculé à partir des
 * données que le commerce a déjà (tirages + visites) : aucune nouvelle donnée n'est collectée pour cette mesure.
 */
export function retourApresGain(clients: Pick<Client, 'id' | 'visites'>[], tirages: Tirage[], debut: string, fin: string, aujourdhui: string): RetourApresGain {
  const finMure = ajouterJours(aujourdhui, -JOURS_RETOUR)
  const borne = fin < finMure ? fin : finMure
  const visites = new Map(clients.map((c) => [c.id, c.visites.map((v) => jourParis(v))]))
  let gains = 0
  let revenus = 0
  for (const t of tirages) {
    const jour = jourParis(t.date)
    if (estPerdant(t.lot) || !dansIntervalle(jour, debut, borne)) continue
    const jours = visites.get(t.clientId)
    if (!jours) continue // client supprimé (RGPD) : plus rien à mesurer
    gains++
    const limite = ajouterJours(jour, JOURS_RETOUR)
    if (jours.some((v) => v > jour && v <= limite)) revenus++
  }
  return { gains, revenus, taux: taux(revenus, gains) }
}

// ---------- Export CSV ----------

const euros = (centimes: number) => (centimes / 100).toFixed(2).replace('.', ',')

/** Série en CSV « à la française » (séparateur ;, BOM UTF-8, montants en euros avec virgule) : s'ouvre dans Excel. */
export function serieEnCsv(points: PointSerie[], g: Granularite): string {
  const entete = [
    g,
    'debut',
    'fin',
    'visites',
    'tirages',
    'gains',
    'lots_distribues',
    'cout_gagnes_eur',
    'cout_distribues_eur',
    'gains_sans_cout',
    'participation_pct',
    'scans',
    'clics_google',
  ]
  const lignes = points.map((p) =>
    [
      p.libelle,
      p.debut,
      p.fin,
      p.visites,
      p.tirages,
      p.gains,
      p.distribues,
      euros(p.coutGagnes),
      euros(p.coutDistribues),
      p.gainsSansCout,
      tauxParticipation(p) ?? '',
      p.evenements.scan,
      p.evenements.clicGoogle,
    ]
      .map(celluleCsv)
      .join(';'),
  )
  return '﻿' + [entete.join(';'), ...lignes].join('\r\n') + '\r\n'
}

export function nomFichierMesures(commerceId: string, g: Granularite, aujourdhui: string): string {
  return `mesures-${commerceId}-${g}-${aujourdhui}.csv`.replace(/[^\w.-]/g, '_')
}

/** « 12,50 € » (centimes → euros, virgule française). */
export function formaterEuros(centimes: number): string {
  return `${euros(centimes)} €`
}

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

/** Lot cité par la variante B : le 1er lot gagnant de la roue (jamais un « Dommage ! »). */
export function lotAccroche(lots: Pick<Lot, 'libelle'>[]): string | null {
  return lotsJouables(lots).find((l) => !estPerdant(l.libelle))?.libelle ?? null
}

/**
 * Phrase sous le nom du commerce sur la page de jeu : modèle à traduire (`t`) et valeurs. Test actif = fiche publique
 * (`testAccroche`, mode serveur) ou réglage du commerce (`testsAB`, démo locale).
 */
export function accrocheJeu(
  commerce: Pick<CommercePublic, 'lots' | 'testAccroche'> & { testsAB?: TestsAB },
  jour: string,
): { modele: string; valeurs?: { lot: string } } {
  const lot = lotAccroche(commerce.lots)
  const actif = commerce.testAccroche || commerce.testsAB?.accroche?.actif
  if (actif && lot && varianteDuJour(jour) === 'B') return { modele: ACCROCHE_LOT, valeurs: { lot } }
  return { modele: ACCROCHE_GENERIQUE }
}

/**
 * Activation / arrêt du test « accroche » : `depuis` = jour de l'activation (une réactivation repart de zéro),
 * `jusqua` = jour de l'arrêt. Même règle côté serveur (dates jamais reçues du navigateur) et en démo locale.
 */
export function basculerAccroche(avant: TestsAB['accroche'], actif: boolean, aujourdhui: string): NonNullable<TestsAB['accroche']> {
  if (actif && !avant?.actif) return { actif: true, depuis: aujourdhui }
  if (!actif && avant?.actif) return { ...avant, actif: false, jusqua: aujourdhui }
  return avant ? { ...avant, actif } : { actif }
}

export interface ResultatVariante {
  jours: number
  scans: number
  tirages: number
  /** Tirages / pages de jeu ouvertes, en %. */
  taux: number | null
}

export interface ResultatsAccroche {
  depuis: string
  jusqua: string
  A: ResultatVariante
  B: ResultatVariante
  /** Au moins MIN_SCANS_VARIANTE pages ouvertes dans chaque variante. */
  assezDeDonnees: boolean
  /** Écart significatif au seuil de 95 % (test z de deux proportions), seulement si assez de données. */
  significatif: boolean
}

export const MIN_SCANS_VARIANTE = 100

/** Résultats du test « accroche » sur [depuis, jusqua ou aujourd'hui], à partir des compteurs anonymes. */
export function resultatsAccroche(compteurs: CompteurEvenement[], test: TestsAB['accroche'], aujourdhui: string): ResultatsAccroche | null {
  if (!test?.depuis) return null
  const fin = test.jusqua && test.jusqua < aujourdhui ? test.jusqua : aujourdhui
  const r: Record<Variante, ResultatVariante> = { A: { jours: 0, scans: 0, tirages: 0, taux: null }, B: { jours: 0, scans: 0, tirages: 0, taux: null } }
  for (let j = test.depuis; j <= fin; j = ajouterJours(j, 1)) r[varianteDuJour(j)].jours++
  for (const c of compteurs) {
    if (!dansIntervalle(c.jour, test.depuis, fin)) continue
    if (c.type === 'scan') r[varianteDuJour(c.jour)].scans += c.n
    if (c.type === 'tirage') r[varianteDuJour(c.jour)].tirages += c.n
  }
  for (const v of ['A', 'B'] as const) r[v].taux = taux(r[v].tirages, r[v].scans)
  const assezDeDonnees = r.A.scans >= MIN_SCANS_VARIANTE && r.B.scans >= MIN_SCANS_VARIANTE
  let significatif = false
  if (assezDeDonnees) {
    const pA = Math.min(1, r.A.tirages / r.A.scans)
    const pB = Math.min(1, r.B.tirages / r.B.scans)
    const p = Math.min(1, (r.A.tirages + r.B.tirages) / (r.A.scans + r.B.scans))
    const ecart = Math.sqrt(p * (1 - p) * (1 / r.A.scans + 1 / r.B.scans))
    significatif = ecart > 0 && Math.abs(pB - pA) / ecart >= 1.96
  }
  return { depuis: test.depuis, jusqua: fin, A: r.A, B: r.B, assezDeDonnees, significatif }
}

// ---------- Test A/B « offre de la semaine » : voir `src/lib/mesure-offre.ts` (module du tableau de bord,
// page différée — hors bundle initial, cf. seuil du test de bundle P2-Q2). ----------

// ---------- Événements anonymes : types acceptés ----------

export const TYPES_EVENEMENT: TypeEvenement[] = ['scan', 'tirage', 'gain', 'clicGoogle']
/** Seuls événements que le navigateur peut signaler (POST public) ; tirage et gain sont comptés par le serveur lui-même. */
export const EVENEMENTS_PUBLICS: TypeEvenement[] = ['scan', 'clicGoogle']

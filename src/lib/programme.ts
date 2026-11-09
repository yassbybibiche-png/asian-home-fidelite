// Programme de fidélité — benchmark du 09/11/2026 (Domino's, Starbucks, KFC, McDonald's,
// Burger King, Sephora, Chick-fil-A, Decathlon, TheFork / Como).
// Logique pure (aucune dépendance React) : le serveur décide de tout, le front ne fait qu'afficher.
// Toute la configuration vit sur le commerce (`programme`, tout optionnel) : absent = défauts ci-dessous,
// un commerce existant sans configuration voit donc les défauts s'appliquer sans rien casser.
import type { Client, Commerce, ConfigProgramme, DefiEnCours, Palier, RecompenseEnAttente, Reserve } from '../types'
import { pointsPourMontant, soldePoints } from './points.ts'
import { validerVisite } from './fidelite.ts'

export const JOUR = 24 * 60 * 60 * 1000

// ---------- Valeurs par défaut (celles de la mission) ----------

export const PALIERS_DEFAUT: Palier[] = [
  { seuil: 3, libelle: 'Boisson, nems ou dessert offert' },
  { seuil: 6, libelle: 'Accompagnement offert' },
  { seuil: 10, libelle: 'Plat offert' },
]
export const PARRAINAGE_DEFAUT = { actif: true, pointsParrain: 50, pointsFilleul: 50, plafondAn: 12 }
export const BIENVENUE_DEFAUT = { actif: true, points: 50 }
export const DEFI_DEFAUT = { actif: true, visites: 3, jours: 14, recompense: 'Plat offert' }
export const NIVEAUX_DEFAUT = { actif: true, habitueSeuil: 10, habitueMultiplicateur: 1.5, vipSeuil: 25, vipMultiplicateur: 2 }
export const WINBACK_DEFAUT = { actif: true, rappelJours: 45, offreJours: 60, derniereJours: 90, offre: 'Produit offert' }
export const ANNIVERSAIRE_DEFAUT = { actif: true, validiteJours: 14, demiAnniversaire: true, adhesion: true }
export const OFFRE_HEBDO_DEFAUT = { actif: true, jour: 2, libelle: 'Boisson offerte', condition: 'dès 15 €' }
export const RESERVE_DEFAUT = { actif: true, montantMinCentimes: 2500, validiteJours: 30, parTrimestre: 1 }
export const RATTRAPAGE_DEFAUT = { actif: true, delaiJours: 30 }

export const JOURS_SEMAINE = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

const clamp = (v: unknown, defaut: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : defaut
const clampEntier = (v: unknown, defaut: number, min: number, max: number) => Math.round(clamp(v, defaut, min, max))

function config(commerce: Pick<Commerce, 'programme'>): ConfigProgramme {
  return commerce.programme ?? {}
}

export function configPaliers(commerce: Pick<Commerce, 'programme' | 'seuilTampons'>): { actif: boolean; liste: Palier[] } {
  const p = config(commerce).paliers
  const actif = p?.actif ?? true
  const liste = (p?.liste ?? PALIERS_DEFAUT)
    .filter((x) => x && Number.isInteger(x.seuil) && x.seuil >= 1 && typeof x.libelle === 'string' && x.libelle.trim())
    .map((x) => ({ seuil: x.seuil, libelle: x.libelle.trim() }))
    // Le palier égal au seuil de la carte principale est déjà couvert par la récompense existante : pas de double gain.
    .filter((x) => x.seuil < commerce.seuilTampons)
  const uniques = [...new Map(liste.map((x) => [x.seuil, x])).values()].sort((a, b) => a.seuil - b.seuil)
  return { actif, liste: uniques }
}

export function configParrainage(commerce: Pick<Commerce, 'programme'>) {
  const p = config(commerce).parrainage
  return {
    actif: p?.actif ?? PARRAINAGE_DEFAUT.actif,
    pointsParrain: clampEntier(p?.pointsParrain, PARRAINAGE_DEFAUT.pointsParrain, 0, 500),
    pointsFilleul: clampEntier(p?.pointsFilleul, PARRAINAGE_DEFAUT.pointsFilleul, 0, 500),
    plafondAn: clampEntier(p?.plafondAn, PARRAINAGE_DEFAUT.plafondAn, 1, 100),
  }
}

export function configBienvenue(commerce: Pick<Commerce, 'programme'>) {
  const p = config(commerce).bienvenue
  return { actif: p?.actif ?? BIENVENUE_DEFAUT.actif, points: clampEntier(p?.points, BIENVENUE_DEFAUT.points, 0, 500) }
}

export function configDefi(commerce: Pick<Commerce, 'programme'>) {
  const p = config(commerce).defi
  return {
    actif: p?.actif ?? DEFI_DEFAUT.actif,
    visites: clampEntier(p?.visites, DEFI_DEFAUT.visites, 2, 10),
    jours: clampEntier(p?.jours, DEFI_DEFAUT.jours, 3, 60),
    recompense: typeof p?.recompense === 'string' && p.recompense.trim() ? p.recompense.trim() : DEFI_DEFAUT.recompense,
  }
}

export function configNiveaux(commerce: Pick<Commerce, 'programme'>) {
  const p = config(commerce).niveaux
  const habitueSeuil = clampEntier(p?.habitueSeuil, NIVEAUX_DEFAUT.habitueSeuil, 2, 100)
  const vipSeuil = Math.max(habitueSeuil + 1, clampEntier(p?.vipSeuil, NIVEAUX_DEFAUT.vipSeuil, 3, 200))
  return {
    actif: p?.actif ?? NIVEAUX_DEFAUT.actif,
    habitueSeuil,
    habitueMultiplicateur: clamp(p?.habitueMultiplicateur, NIVEAUX_DEFAUT.habitueMultiplicateur, 1, 3),
    vipSeuil,
    vipMultiplicateur: clamp(p?.vipMultiplicateur, NIVEAUX_DEFAUT.vipMultiplicateur, 1, 3),
  }
}

export function configWinback(commerce: Pick<Commerce, 'programme'>) {
  const p = config(commerce).winback
  const rappel = clampEntier(p?.rappelJours, WINBACK_DEFAUT.rappelJours, 7, 180)
  const offre = Math.max(rappel + 1, clampEntier(p?.offreJours, WINBACK_DEFAUT.offreJours, 8, 240))
  const derniere = Math.max(offre + 1, clampEntier(p?.derniereJours, WINBACK_DEFAUT.derniereJours, 9, 300))
  return {
    actif: p?.actif ?? WINBACK_DEFAUT.actif,
    rappelJours: rappel,
    offreJours: offre,
    derniereJours: derniere,
    offre: typeof p?.offre === 'string' && p.offre.trim() ? p.offre.trim() : WINBACK_DEFAUT.offre,
  }
}

export function configAnniversaire(commerce: Pick<Commerce, 'programme'>) {
  const p = config(commerce).anniversaire
  return {
    actif: p?.actif ?? ANNIVERSAIRE_DEFAUT.actif,
    validiteJours: clampEntier(p?.validiteJours, ANNIVERSAIRE_DEFAUT.validiteJours, 7, 30),
    demiAnniversaire: p?.demiAnniversaire ?? ANNIVERSAIRE_DEFAUT.demiAnniversaire,
    adhesion: p?.adhesion ?? ANNIVERSAIRE_DEFAUT.adhesion,
  }
}

export function configOffreHebdo(commerce: Pick<Commerce, 'programme'>) {
  const p = config(commerce).offreHebdo
  return {
    actif: p?.actif ?? OFFRE_HEBDO_DEFAUT.actif,
    jour: clampEntier(p?.jour, OFFRE_HEBDO_DEFAUT.jour, 0, 6),
    libelle: typeof p?.libelle === 'string' && p.libelle.trim() ? p.libelle.trim() : OFFRE_HEBDO_DEFAUT.libelle,
    condition: typeof p?.condition === 'string' ? p.condition.trim() : OFFRE_HEBDO_DEFAUT.condition,
  }
}

export function configReserve(commerce: Pick<Commerce, 'programme'>) {
  const p = config(commerce).reserve
  return {
    actif: p?.actif ?? RESERVE_DEFAUT.actif,
    montantMinCentimes: clampEntier(p?.montantMinCentimes, RESERVE_DEFAUT.montantMinCentimes, 500, 100_000),
    validiteJours: clampEntier(p?.validiteJours, RESERVE_DEFAUT.validiteJours, 7, 90),
    parTrimestre: clampEntier(p?.parTrimestre, RESERVE_DEFAUT.parTrimestre, 1, 4),
  }
}

export function configRattrapage(commerce: Pick<Commerce, 'programme'>) {
  const p = config(commerce).rattrapage
  return { actif: p?.actif ?? RATTRAPAGE_DEFAUT.actif, delaiJours: clampEntier(p?.delaiJours, RATTRAPAGE_DEFAUT.delaiJours, 7, 90) }
}

// ---------- Validation de la configuration (serveur : 400 si hors bornes) ----------

type Corps = Record<string, unknown>

function validerSousConfig(nom: string, v: unknown, cles: string[]): Corps {
  if (v == null) return {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`« programme.${nom} » doit être un objet.`)
  const o = v as Corps
  const inconnues = Object.keys(o).filter((k) => !cles.includes(k))
  if (inconnues.length) throw new Error(`« programme.${nom} » : champ inconnu : ${inconnues.join(', ')}.`)
  return o
}

function nombre(nom: string, v: unknown, min: number, max: number, entier = true): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (entier && !Number.isInteger(v))) {
    throw new Error(`« ${nom} » doit être un nombre${entier ? ' entier' : ''} entre ${min} et ${max}.`)
  }
  return v
}

function texteCourt(nom: string, v: unknown, max: number): string {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max) throw new Error(`« ${nom} » doit être un texte non vide de ${max} caractères maximum.`)
  return v.trim()
}

function booleen(nom: string, v: unknown): boolean {
  if (typeof v !== 'boolean') throw new Error(`« ${nom} » doit valoir true ou false.`)
  return v
}

/** Configuration envoyée par le commerçant : rejette tout champ inconnu ou hors bornes. */
export function validerProgramme(v: unknown): ConfigProgramme {
  if (v == null) return {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('« programme » doit être un objet.')
  const o = v as Corps
  const cles = ['paliers', 'parrainage', 'bienvenue', 'defi', 'niveaux', 'winback', 'anniversaire', 'offreHebdo', 'reserve', 'rattrapage']
  const inconnues = Object.keys(o).filter((k) => !cles.includes(k))
  if (inconnues.length) throw new Error(`« programme » : champ inconnu : ${inconnues.join(', ')}.`)
  const r: ConfigProgramme = {}
  if ('paliers' in o) {
    const p = validerSousConfig('paliers', o.paliers, ['actif', 'liste'])
    const pal: NonNullable<ConfigProgramme['paliers']> = {}
    if ('actif' in p) pal.actif = booleen('programme.paliers.actif', p.actif)
    if ('liste' in p) {
      if (!Array.isArray(p.liste) || p.liste.length > 5) throw new Error('« programme.paliers.liste » : 5 paliers maximum.')
      pal.liste = (p.liste as unknown[]).map((x, i) => {
        const y = (x ?? {}) as Corps
        return { seuil: nombre(`palier n° ${i + 1} (seuil)`, y.seuil, 1, 49), libelle: texteCourt(`palier n° ${i + 1} (libellé)`, y.libelle, 80) }
      })
    }
    r.paliers = pal
  }
  const sous = (nom: string, clesSous: string[]) => validerSousConfig(nom, o[nom], clesSous)
  if ('parrainage' in o) {
    const p = sous('parrainage', ['actif', 'pointsParrain', 'pointsFilleul', 'plafondAn'])
    r.parrainage = {
      ...(p.actif !== undefined ? { actif: booleen('programme.parrainage.actif', p.actif) } : {}),
      ...(p.pointsParrain !== undefined ? { pointsParrain: nombre('programme.parrainage.pointsParrain', p.pointsParrain, 0, 500) } : {}),
      ...(p.pointsFilleul !== undefined ? { pointsFilleul: nombre('programme.parrainage.pointsFilleul', p.pointsFilleul, 0, 500) } : {}),
      ...(p.plafondAn !== undefined ? { plafondAn: nombre('programme.parrainage.plafondAn', p.plafondAn, 1, 100) } : {}),
    }
  }
  if ('bienvenue' in o) {
    const p = sous('bienvenue', ['actif', 'points'])
    r.bienvenue = {
      ...(p.actif !== undefined ? { actif: booleen('programme.bienvenue.actif', p.actif) } : {}),
      ...(p.points !== undefined ? { points: nombre('programme.bienvenue.points', p.points, 0, 500) } : {}),
    }
  }
  if ('defi' in o) {
    const p = sous('defi', ['actif', 'visites', 'jours', 'recompense'])
    r.defi = {
      ...(p.actif !== undefined ? { actif: booleen('programme.defi.actif', p.actif) } : {}),
      ...(p.visites !== undefined ? { visites: nombre('programme.defi.visites', p.visites, 2, 10) } : {}),
      ...(p.jours !== undefined ? { jours: nombre('programme.defi.jours', p.jours, 3, 60) } : {}),
      ...(p.recompense !== undefined ? { recompense: texteCourt('programme.defi.recompense', p.recompense, 80) } : {}),
    }
  }
  if ('niveaux' in o) {
    const p = sous('niveaux', ['actif', 'habitueSeuil', 'habitueMultiplicateur', 'vipSeuil', 'vipMultiplicateur'])
    r.niveaux = {
      ...(p.actif !== undefined ? { actif: booleen('programme.niveaux.actif', p.actif) } : {}),
      ...(p.habitueSeuil !== undefined ? { habitueSeuil: nombre('programme.niveaux.habitueSeuil', p.habitueSeuil, 2, 100) } : {}),
      ...(p.habitueMultiplicateur !== undefined ? { habitueMultiplicateur: nombre('programme.niveaux.habitueMultiplicateur', p.habitueMultiplicateur, 1, 3, false) } : {}),
      ...(p.vipSeuil !== undefined ? { vipSeuil: nombre('programme.niveaux.vipSeuil', p.vipSeuil, 3, 200) } : {}),
      ...(p.vipMultiplicateur !== undefined ? { vipMultiplicateur: nombre('programme.niveaux.vipMultiplicateur', p.vipMultiplicateur, 1, 3, false) } : {}),
    }
  }
  if ('winback' in o) {
    const p = sous('winback', ['actif', 'rappelJours', 'offreJours', 'derniereJours', 'offre'])
    r.winback = {
      ...(p.actif !== undefined ? { actif: booleen('programme.winback.actif', p.actif) } : {}),
      ...(p.rappelJours !== undefined ? { rappelJours: nombre('programme.winback.rappelJours', p.rappelJours, 7, 180) } : {}),
      ...(p.offreJours !== undefined ? { offreJours: nombre('programme.winback.offreJours', p.offreJours, 8, 240) } : {}),
      ...(p.derniereJours !== undefined ? { derniereJours: nombre('programme.winback.derniereJours', p.derniereJours, 9, 300) } : {}),
      ...(p.offre !== undefined ? { offre: texteCourt('programme.winback.offre', p.offre, 80) } : {}),
    }
  }
  if ('anniversaire' in o) {
    const p = sous('anniversaire', ['actif', 'validiteJours', 'demiAnniversaire', 'adhesion'])
    r.anniversaire = {
      ...(p.actif !== undefined ? { actif: booleen('programme.anniversaire.actif', p.actif) } : {}),
      ...(p.validiteJours !== undefined ? { validiteJours: nombre('programme.anniversaire.validiteJours', p.validiteJours, 7, 30) } : {}),
      ...(p.demiAnniversaire !== undefined ? { demiAnniversaire: booleen('programme.anniversaire.demiAnniversaire', p.demiAnniversaire) } : {}),
      ...(p.adhesion !== undefined ? { adhesion: booleen('programme.anniversaire.adhesion', p.adhesion) } : {}),
    }
  }
  if ('offreHebdo' in o) {
    const p = sous('offreHebdo', ['actif', 'jour', 'libelle', 'condition'])
    r.offreHebdo = {
      ...(p.actif !== undefined ? { actif: booleen('programme.offreHebdo.actif', p.actif) } : {}),
      ...(p.jour !== undefined ? { jour: nombre('programme.offreHebdo.jour', p.jour, 0, 6) } : {}),
      ...(p.libelle !== undefined ? { libelle: texteCourt('programme.offreHebdo.libelle', p.libelle, 80) } : {}),
      ...(p.condition !== undefined ? { condition: typeof p.condition === 'string' && p.condition.length <= 80 ? p.condition.trim() : (() => { throw new Error('« programme.offreHebdo.condition » : 80 caractères maximum.') })() } : {}),
    }
  }
  if ('reserve' in o) {
    const p = sous('reserve', ['actif', 'montantMinCentimes', 'validiteJours', 'parTrimestre'])
    r.reserve = {
      ...(p.actif !== undefined ? { actif: booleen('programme.reserve.actif', p.actif) } : {}),
      ...(p.montantMinCentimes !== undefined ? { montantMinCentimes: nombre('programme.reserve.montantMinCentimes', p.montantMinCentimes, 500, 100_000) } : {}),
      ...(p.validiteJours !== undefined ? { validiteJours: nombre('programme.reserve.validiteJours', p.validiteJours, 7, 90) } : {}),
      ...(p.parTrimestre !== undefined ? { parTrimestre: nombre('programme.reserve.parTrimestre', p.parTrimestre, 1, 4) } : {}),
    }
  }
  if ('rattrapage' in o) {
    const p = sous('rattrapage', ['actif', 'delaiJours'])
    r.rattrapage = {
      ...(p.actif !== undefined ? { actif: booleen('programme.rattrapage.actif', p.actif) } : {}),
      ...(p.delaiJours !== undefined ? { delaiJours: nombre('programme.rattrapage.delaiJours', p.delaiJours, 7, 90) } : {}),
    }
  }
  return r
}

// ---------- 1. Paliers bas ----------

/** Prochain palier (seuil + libellé + visites restantes), ou null si tous atteints. */
export function prochainPalier(client: Client, commerce: Commerce): { palier: Palier; restantes: number } | null {
  const { actif, liste } = configPaliers(commerce)
  if (!actif) return null
  const offerts = new Set(client.paliersOfferts ?? [])
  const enAttente = new Set((client.recompensesEnAttente ?? []).filter((r) => r.origine === 'palier' && r.seuil != null).map((r) => r.seuil!))
  for (const palier of liste) {
    if (client.tampons < palier.seuil && !offerts.has(palier.seuil) && !enAttente.has(palier.seuil)) {
      return { palier, restantes: palier.seuil - client.tampons }
    }
  }
  return null
}

/** Paliers atteints par cette carte et pas encore remis (seuils < seuil principal). */
export function paliersAtteints(client: Client, commerce: Commerce): Palier[] {
  const { actif, liste } = configPaliers(commerce)
  if (!actif) return []
  const offerts = new Set(client.paliersOfferts ?? [])
  const enAttente = new Set((client.recompensesEnAttente ?? []).filter((r) => r.origine === 'palier' && r.seuil != null).map((r) => r.seuil!))
  return liste.filter((p) => client.tampons >= p.seuil && !offerts.has(p.seuil) && !enAttente.has(p.seuil))
}

// ---------- 2. Parrainage ----------

const ALPHABET_CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** Code de parrainage unique (6 caractères, sans 0/O/1/I/L) : à vérifier contre les codes existants côté serveur. */
export function genererCodeParrainage(aleatoire: () => number = Math.random): string {
  return `AH-${Array.from({ length: 6 }, () => ALPHABET_CODE[Math.floor(aleatoire() * ALPHABET_CODE.length)]).join('')}`
}

/** Parrainages réussis par ce client sur les 365 derniers jours (plafond annuel). */
export function parrainagesAnnee(client: Client, maintenant: Date): number {
  const t = maintenant.getTime()
  return (client.parrainagesGagnes ?? []).filter((d) => t - new Date(d).getTime() <= 365 * JOUR).length
}

/**
 * Récompense de parrainage à verser après la 1re visite du filleul (jamais à l'inscription).
 * Retourne null si rien n'est dû (pas de parrain, déjà payé, programme désactivé, pas la 1re visite).
 * Si le parrain a atteint son plafond annuel, le filleul gagne quand même ses points, le parrain rien.
 */
export function parrainageDu(
  filleul: Client,
  parrain: Client,
  commerce: Commerce,
  quand: Date,
): { filleul: Client; parrain: Client | null; parrainAuPlafond: boolean } | null {
  const cfg = configParrainage(commerce)
  if (!cfg.actif || filleul.parrainId !== parrain.id || filleul.parrainagePaye || filleul.visites.length !== 1) return null
  const filleulApres: Client = { ...filleul, parrainagePaye: true, points: soldePoints(filleul) + cfg.pointsFilleul }
  if (parrainagesAnnee(parrain, quand) >= cfg.plafondAn) return { filleul: filleulApres, parrain: null, parrainAuPlafond: true }
  return {
    filleul: filleulApres,
    parrain: { ...parrain, points: soldePoints(parrain) + cfg.pointsParrain, parrainagesGagnes: [...(parrain.parrainagesGagnes ?? []), quand.toISOString()] },
    parrainAuPlafond: false,
  }
}

// ---------- 3. Points de bienvenue + inscription ----------

/** Inscription : code de parrainage, points de bienvenue (KFC FR : 50), parrain éventuel. */
export function appliquerInscription(client: Client, commerce: Commerce, parrainId?: string): Client {
  const cfg = configBienvenue(commerce)
  return {
    ...client,
    codeParrainage: genererCodeParrainage(),
    ...(cfg.actif && cfg.points > 0 ? { points: soldePoints(client) + cfg.points } : {}),
    ...(parrainId ? { parrainId } : {}),
  }
}

// ---------- 5. Niveaux (2 maximum) ----------

export type NomNiveau = 'Membre' | 'Habitué' | 'VIP'

export interface Niveau {
  nom: NomNiveau
  /** Seuil de visites pour ce niveau. */
  seuil: number
  multiplicateur: number
  avantages: string
}

/** Niveau du client (visites à vie). Le VIP reste rare : seuil haut, affiché comme tel. */
export function niveauClient(client: Client, commerce: Commerce): Niveau {
  const cfg = configNiveaux(commerce)
  const visites = client.visites.length
  if (!cfg.actif) return { nom: 'Membre', seuil: 0, multiplicateur: 1, avantages: '' }
  if (visites >= cfg.vipSeuil) {
    return { nom: 'VIP', seuil: cfg.vipSeuil, multiplicateur: cfg.vipMultiplicateur, avantages: `Points ×${cfg.vipMultiplicateur} · plat signature offert à l’anniversaire · avant-première du plat du mois` }
  }
  if (visites >= cfg.habitueSeuil) {
    return { nom: 'Habitué', seuil: cfg.habitueSeuil, multiplicateur: cfg.habitueMultiplicateur, avantages: `Points ×${cfg.habitueMultiplicateur} · récompense d’anniversaire valable 7 jours de plus` }
  }
  return { nom: 'Membre', seuil: 0, multiplicateur: 1, avantages: '' }
}

/** Récompense d'anniversaire : dessert pour tous, plat signature pour les VIP (Chick-fil-A). */
export function recompenseAnniversaire(client: Client, commerce: Commerce): string {
  return niveauClient(client, commerce).nom === 'VIP' ? 'Plat signature offert' : 'Dessert offert'
}

/** Validité de la récompense d'anniversaire : base 14 j, +7 j pour les Habitués, 30 j pour les VIP. */
export function validiteAnniversaire(client: Client, commerce: Commerce): number {
  const cfg = configAnniversaire(commerce)
  const nom = niveauClient(client, commerce).nom
  if (nom === 'VIP') return 30
  if (nom === 'Habitué') return Math.min(30, cfg.validiteJours + 7)
  return cfg.validiteJours
}

// ---------- 6. Win-back recalibré ----------

export type EtapeWinback = 'rappel' | 'offre' | 'derniere'

/**
 * Étape de la séquence win-back (recherche CX §5 : 2× l'intervalle habituel, pas 30 j fixes).
 * Rappel doux à 45 j (sans remise) → offre à 60 j (produit offert, pas un %) → dernière chance à 90 j,
 * puis ARRÊT à 120 j (sunset). Null = pas de relance (trop tôt, déjà revenu, ou sunset dépassé).
 */
export function etapeWinback(client: Client, commerce: Commerce, maintenant: Date): { etape: EtapeWinback; joursDepuis: number } | null {
  const cfg = configWinback(commerce)
  if (!cfg.actif || !client.derniereVisite) return null
  const jours = Math.floor((maintenant.getTime() - new Date(client.derniereVisite).getTime()) / JOUR)
  if (jours < cfg.rappelJours) return null
  if (jours < cfg.offreJours) return { etape: 'rappel', joursDepuis: jours }
  if (jours < cfg.derniereJours) return { etape: 'offre', joursDepuis: jours }
  if (jours <= cfg.derniereJours + 30) return { etape: 'derniere', joursDepuis: jours }
  return null
}

// ---------- 7. Anniversaire amélioré ----------

function dateDepuisMMJJ(mmjj: string, annee: number): Date | null {
  const m = /^(\d{2})-(\d{2})$/.exec(mmjj)
  if (!m) return null
  const d = new Date(annee, Number(m[1]) - 1, Number(m[2]), 12, 0)
  return d.getMonth() === Number(m[1]) - 1 ? d : null
}

function demiDate(mmjj: string, annee: number): Date | null {
  const m = /^(\d{2})-(\d{2})$/.exec(mmjj)
  if (!m) return null
  const mois = (Number(m[1]) - 1 + 6) % 12
  const an = annee + (Number(m[1]) - 1 + 6 >= 12 ? 1 : 0)
  const d = new Date(an, mois, Math.min(Number(m[2]), 28), 12, 0)
  return d
}

export interface FenetreAnniversaire {
  type: 'anniversaire' | 'demi-anniversaire' | 'adhesion'
  /** Date de l'événement. */
  date: Date
  /** Fin de validité de la récompense. */
  expireLe: Date
  libelle: string
}

/**
 * Fenêtre d'événement ouverte maintenant : anniversaire (J-7 → J+validité), demi-anniversaire
 * (boisson offerte, 6 mois après), anniversaire d'adhésion (1 an après l'inscription, puis chaque année).
 * Null hors fenêtre. L'anniversaire prime sur le reste.
 */
export function fenetreAnniversaire(client: Client, commerce: Commerce, maintenant: Date): FenetreAnniversaire | null {
  const cfg = configAnniversaire(commerce)
  if (!cfg.actif) return null
  const validite = validiteAnniversaire(client, commerce)
  const dansFenetre = (date: Date | null): boolean => !!date && maintenant.getTime() >= date.getTime() - 7 * JOUR && maintenant.getTime() <= date.getTime() + validite * JOUR
  const expire = (date: Date) => new Date(date.getTime() + validite * JOUR)
  if (client.anniversaire) {
    for (const annee of [maintenant.getFullYear() - 1, maintenant.getFullYear(), maintenant.getFullYear() + 1]) {
      const date = dateDepuisMMJJ(client.anniversaire, annee)
      if (dansFenetre(date) && date) return { type: 'anniversaire', date, expireLe: expire(date), libelle: recompenseAnniversaire(client, commerce) }
    }
    if (cfg.demiAnniversaire) {
      for (const annee of [maintenant.getFullYear() - 1, maintenant.getFullYear(), maintenant.getFullYear() + 1]) {
        const date = demiDate(client.anniversaire, annee)
        if (dansFenetre(date) && date) return { type: 'demi-anniversaire', date, expireLe: expire(date), libelle: 'Boisson offerte' }
      }
    }
  }
  if (cfg.adhesion) {
    const inscrit = new Date(client.creeLe)
    for (let k = 1; k <= 5; k++) {
      const date = new Date(inscrit.getTime())
      date.setFullYear(inscrit.getFullYear() + k)
      if (dansFenetre(date)) return { type: 'adhesion', date, expireLe: expire(date), libelle: 'Boisson offerte' }
    }
  }
  return null
}

// ---------- 8. Offre hebdomadaire récurrente ----------

/** Offre membres du jour (si aujourd'hui est le jour fixe), sinon null. */
export function offreHebdoDuJour(commerce: Commerce, maintenant: Date): { libelle: string; condition: string } | null {
  const cfg = configOffreHebdo(commerce)
  if (!cfg.actif) return null
  return maintenant.getDay() === cfg.jour ? { libelle: cfg.libelle, condition: cfg.condition } : null
}

// ---------- 4. Défis + 11. Réserve : appliqués à chaque visite ----------

export interface EvenementPassage {
  type: 'palier' | 'defi' | 'reserve' | 'niveau'
  texte: string
}

function avecEnAttente(client: Client, recompense: RecompenseEnAttente): Client {
  if ((client.recompensesEnAttente ?? []).some((r) => r.id === recompense.id)) return client
  return { ...client, recompensesEnAttente: [...(client.recompensesEnAttente ?? []), recompense] }
}

function reserveActive(client: Client, quand: Date): Reserve | undefined {
  const r = client.reserve
  return r && !r.utiliseLe && new Date(r.expireLe).getTime() > quand.getTime() ? r : undefined
}

/** Plat en réserve utilisable maintenant (gagné, pas utilisé, pas expiré). */
export function reserveUtilisable(client: Client, maintenant: Date): Reserve | undefined {
  return reserveActive(client, maintenant)
}

/**
 * Une visite (sans contrôle « 1 par jour » : l'appelant — caisse — le fait avant).
 * Tampon + points (multiplicateur de niveau) + paliers + défi + réserve + changement de niveau.
 */
export function appliquerVisiteProgramme(client: Client, commerce: Commerce, centimes: number, quand: Date, actionId?: string): { client: Client; evenements: EvenementPassage[] } {
  const niveauAvant = niveauClient(client, commerce)
  const apresVisite = validerVisite(client, commerce, quand)
  const gagnes = Math.round(pointsPourMontant(centimes, commerce) * niveauAvant.multiplicateur)
  let c: Client = {
    ...apresVisite,
    points: soldePoints(client) + gagnes,
    depenseCentimes: (client.depenseCentimes ?? 0) + Math.max(0, Math.round(centimes)),
    ...(actionId ? { actionsTraitees: [...(client.actionsTraitees ?? []), actionId].slice(-50) } : {}),
  }
  const evenements: EvenementPassage[] = []
  const iso = quand.toISOString()

  // Paliers : chaque seuil franchi met sa récompense en attente (à retirer au comptoir).
  for (const palier of paliersAtteints(c, commerce)) {
    c = avecEnAttente(c, { id: `palier-${palier.seuil}-${c.visites.length}`, libelle: palier.libelle, origine: 'palier', creeLe: iso, seuil: palier.seuil })
    evenements.push({ type: 'palier', texte: `Palier ${palier.seuil} visites atteint : ${palier.libelle}` })
  }

  // Défi : un seul actif à la fois ; progression = visites depuis son début.
  const cfgDefi = configDefi(commerce)
  if (cfgDefi.actif) {
    let defi: DefiEnCours | undefined = c.defi
    if (defi && quand.getTime() - new Date(defi.debut).getTime() > defi.jours * JOUR) defi = undefined // expiré : on repart à zéro
    if (!defi) {
      defi = { id: `defi-${quand.getTime().toString(36)}`, debut: iso, objectif: cfgDefi.visites, jours: cfgDefi.jours, recompense: cfgDefi.recompense }
      c = { ...c, defi }
    }
    const progression = c.visites.filter((v) => new Date(v).getTime() >= new Date(defi!.debut).getTime()).length
    if (progression >= defi.objectif) {
      c = avecEnAttente(
        { ...c, defi: undefined, defisReussis: [...(c.defisReussis ?? []), { date: iso, recompense: defi.recompense }] },
        { id: `defi-${defi.id}`, libelle: defi.recompense, origine: 'defi', creeLe: iso },
      )
      evenements.push({ type: 'defi', texte: `Défi réussi (${defi.objectif} visites en ${defi.jours} jours) : ${defi.recompense}` })
    }
  }

  // Plat en réserve : après une commande ≥ seuil, 1 par trimestre maximum, valable 30 jours.
  const cfgReserve = configReserve(commerce)
  if (cfgReserve.actif && centimes >= cfgReserve.montantMinCentimes && !reserveActive(c, quand)) {
    const gagnesTrimestre = (c.reservesGagnees ?? []).filter((d) => quand.getTime() - new Date(d).getTime() <= 90 * JOUR).length
    if (gagnesTrimestre < cfgReserve.parTrimestre) {
      c = {
        ...c,
        reserve: { gagneLe: iso, expireLe: new Date(quand.getTime() + cfgReserve.validiteJours * JOUR).toISOString() },
        reservesGagnees: [...(c.reservesGagnees ?? []), iso],
      }
      evenements.push({ type: 'reserve', texte: `Plat en réserve gagné (commande ≥ ${(cfgReserve.montantMinCentimes / 100).toLocaleString('fr-FR')} €, à utiliser sous ${cfgReserve.validiteJours} jours)` })
    }
  }

  // Changement de niveau.
  const niveauApres = niveauClient(c, commerce)
  if (niveauApres.nom !== niveauAvant.nom) {
    evenements.push({ type: 'niveau', texte: `Nouveau niveau : ${niveauApres.nom} (${niveauApres.avantages})` })
  }
  return { client: c, evenements }
}

/** Passage en caisse : 1 tampon par jour maximum (même garde que `enregistrerPassage`). */
export function passageAvecProgramme(client: Client, commerce: Commerce, centimes: number, quand: Date, actionId?: string): { client: Client; evenements: EvenementPassage[] } {
  const memeJour = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (client.visites.some((v) => memeJour(new Date(v), quand))) {
    throw new Error(`${client.prenom} a déjà un passage enregistré ce jour-là : 1 tampon par jour maximum.`)
  }
  return appliquerVisiteProgramme(client, commerce, centimes, quand, actionId)
}

// ---------- 9. Rattrapage d'une visite oubliée ----------

/** La demande est recevable : délai de 30 jours, date passée, montant plausible, pas déjà une visite ce jour-là. */
export function rattrapageRecevable(client: Client, commerce: Commerce, dateVisite: Date, montantCentimes: number, maintenant: Date): string | null {
  const cfg = configRattrapage(commerce)
  if (!cfg.actif) return 'Le rattrapage des visites oubliées n’est pas activé dans ce commerce.'
  if (Number.isNaN(dateVisite.getTime())) return 'Date de visite invalide.'
  if (dateVisite.getTime() > maintenant.getTime()) return 'La visite ne peut pas être dans le futur.'
  if (maintenant.getTime() - dateVisite.getTime() > cfg.delaiJours * JOUR) return `Trop tard : une visite oubliée doit être signalée sous ${cfg.delaiJours} jours.`
  if (!Number.isInteger(montantCentimes) || montantCentimes < 0 || montantCentimes > 100_000_00) return 'Montant invalide (0 à 100 000 €).'
  const memeJour = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (client.visites.some((v) => memeJour(new Date(v), dateVisite))) return 'Une visite est déjà enregistrée ce jour-là.'
  return null
}

/** Validation par le commerçant : 1 visite + points crédités (journalisé côté serveur). */
export function appliquerRattrapageValide(client: Client, commerce: Commerce, montantCentimes: number, dateVisite: Date): { client: Client; evenements: EvenementPassage[] } {
  const r = appliquerVisiteProgramme(client, commerce, montantCentimes, dateVisite)
  const apres = r.client
  // Visite antidatée : l'historique reste chronologique et la dernière visite ne régresse pas.
  const visites = [...apres.visites].sort()
  const derniereVisite = client.derniereVisite && new Date(client.derniereVisite).getTime() > dateVisite.getTime() ? client.derniereVisite : apres.derniereVisite
  return { ...r, client: { ...apres, visites, derniereVisite } }
}

// ---------- Consommation des récompenses en attente / réserve ----------

/** Retirer une récompense en attente au comptoir : elle passe dans les récompenses remises. */
export function consommerRecompenseEnAttente(client: Client, recompenseId: string, quand: Date): Client {
  const r = (client.recompensesEnAttente ?? []).find((x) => x.id === recompenseId)
  if (!r) throw new Error('Récompense en attente introuvable.')
  if (r.expireLe && new Date(r.expireLe).getTime() < quand.getTime()) throw new Error('Cette récompense a expiré.')
  return {
    ...client,
    recompensesEnAttente: (client.recompensesEnAttente ?? []).filter((x) => x.id !== recompenseId),
    recompensesOffertes: [...(client.recompensesOffertes ?? []), { date: quand.toISOString(), libelle: r.libelle }],
    ...(r.origine === 'palier' && r.seuil != null ? { paliersOfferts: [...(client.paliersOfferts ?? []), r.seuil] } : {}),
  }
}

/** Utiliser le plat en réserve (valable 30 jours). */
export function utiliserReserve(client: Client, quand: Date): Client {
  const r = reserveActive(client, quand)
  if (!r) throw new Error('Aucun plat en réserve utilisable (aucun gagné, déjà utilisé ou expiré).')
  return {
    ...client,
    reserve: { ...r, utiliseLe: quand.toISOString() },
    recompensesOffertes: [...(client.recompensesOffertes ?? []), { date: quand.toISOString(), libelle: 'Plat en réserve' }],
  }
}

// ---------- 10. Profiling progressif ----------

/** Après la 2e visite seulement : on peut demander anniversaire et plat préféré, jamais avant. */
export function peutCompleterProfil(client: Client): boolean {
  return client.visites.length >= 2
}

export function profilIncomplet(client: Client): boolean {
  return peutCompleterProfil(client) && (!client.anniversaire || !client.platPrefere)
}

/** Récompenses en attente encore valables (les expirées sont masquées, jamais supprimées silencieusement côté lecture). */
export function recompensesEnAttenteValables(client: Client, maintenant: Date): RecompenseEnAttente[] {
  return (client.recompensesEnAttente ?? []).filter((r) => !r.expireLe || new Date(r.expireLe).getTime() >= maintenant.getTime())
}

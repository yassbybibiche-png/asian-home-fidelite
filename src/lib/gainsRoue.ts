// KPI « Gains de la roue » du tableau de bord (roue v2, D3) — logique pure, importée par le tableau de bord seulement
// (un module partagé par deux pages différées deviendrait un chunk à part, référencé depuis le bundle initial).
// Statuts v2 (R3) : un lot physique gagné est en attente (jour J), utilisable (J+1 à J+30), remis ou expiré ; un
// tirage hérité suit l'ancienne règle (valable le jour J seulement). Tout est compté en JOURS DE PARIS, comme la
// mesure du tableau de bord (`mesure.ts`) et le cycle de vie des gains.
import type { Lot, Tirage } from '../types'
// Bundle initial au plafond (P2-Q2) : seuls `jourParis` / `ajouterJours`, déjà lus par la mesure du tableau de bord,
// viennent de l'index. `cycleGain` / `finGain` (serveur seulement) l'alourdissaient de ~360 o, `typeTirage` et
// `dernierJourGain` d'un export chacun : leurs règles sont écrites ici, vérifiées contre `cycleGain` / `typeTirage` par
// tests/cout-kpi-d3.test.ts (heure par heure, changements d'heure et tirages hérités compris).
import { ajouterJours, jourParis } from './mesure.ts'

/** Fenêtre du KPI : les 30 derniers jours de Paris, aujourd'hui compris. */
export const JOURS_KPI_GAINS = 30

/** Ancienne règle de type (avant R1) — même expression que `typeDeduitDuLibelle` (roulette.ts). */
const ANCIEN_LIBELLE_PERDANT = /pas de chance|perdu|dommage|rejouez/i
const TYPES = ['lot', 'points', 'perdant']

/** = `typeTirage(t) === 'lot'` : type figé au tirage, à défaut l'ancienne règle sur le libellé. */
export function estLotPhysique(t: Pick<Tirage, 'lot' | 'typeLot'>): boolean {
  return (t.typeLot && TYPES.includes(t.typeLot) ? t.typeLot : ANCIEN_LIBELLE_PERDANT.test(t.lot) ? 'perdant' : 'lot') === 'lot'
}

/**
 * Premier jour (Paris) où le gain est expiré : J+31 (v2 : utilisable jusqu'à J+30 inclus), J+1 pour un tirage hérité
 * (`tirageHerite` : sans type figé au tirage, ou type déduit après coup — valable le jour J seulement).
 */
export function jourExpiration(t: Pick<Tirage, 'date' | 'typeLot' | 'typeDeduit'>): string {
  const herite = !(t.typeLot && TYPES.includes(t.typeLot)) || t.typeDeduit === true
  return ajouterJours(jourParis(t.date), herite ? 1 : 31)
}

/** Lot physique non remis : 'enCours' (en attente du lendemain ou utilisable) ou 'expire'. */
export function etapeGain(t: Pick<Tirage, 'date' | 'typeLot' | 'typeDeduit'>, maintenant: Date): 'enCours' | 'expire' {
  return jourParis(maintenant) < jourExpiration(t) ? 'enCours' : 'expire'
}

/**
 * Définitions (affichées sous la carte), sur les 30 derniers jours de Paris (aujourd'hui compris) :
 * • GAGNÉS : lots physiques tirés (ni points, ni perdu), remis ou non ;
 * • REMIS : lots remis au comptoir (jour de la remise), quel que soit le jour du gain ;
 * • EXPIRÉS : gains dont la période d'utilisation s'est close sans remise (1er jour d'expiration dans la fenêtre) ;
 * • TAUX D'UTILISATION = remis ÷ (remis + expirés) : seuls les gains « échus » (fenêtre close ou remis) comptent — un
 *   gain encore utilisable n'est ni un succès ni un échec. null (affiché « — ») s'il n'y en a aucun ;
 * • EN ATTENTE : gains encore en jeu aujourd'hui (en attente du lendemain ou utilisables), quelle que soit leur date.
 */
export const DEFINITION_TAUX_UTILISATION =
  'Taux d’utilisation = remis ÷ (remis + expirés) sur 30 jours : seuls les gains dont la période est close (remis ou expirés) comptent.'

export interface KpiGains {
  gagnes: number
  remis: number
  expires: number
  /** En %, arrondi ; null si aucun gain échu (remis + expirés = 0). */
  tauxUtilisation: number | null
  enAttente: number
  /** Centimes : Σ des coûts unitaires des expirés dont le coût est renseigné. */
  valeurExpires: number
  /** Expirés dont le lot n'a pas (ou plus) de coût renseigné : la valeur est alors un minimum. */
  expiresSansCout: number
}

/** Coût unitaire (centimes) du lot d'un tirage : par id (R1+), à défaut par libellé ; null = non renseigné / lot supprimé. */
export function coutDuTirage(lots: Pick<Lot, 'id' | 'libelle' | 'coutCentimes'>[], t: Pick<Tirage, 'lot' | 'lotId'>): number | null {
  const lot = (t.lotId && lots.find((l) => l.id === t.lotId)) || lots.find((l) => l.libelle.trim() === t.lot.trim())
  const c = lot?.coutCentimes
  return typeof c === 'number' && Number.isFinite(c) && c >= 0 ? c : null
}

/** KPI des gains sur les 30 derniers jours (définitions : voir plus haut). `tirages` : ceux du commerce. */
export function kpiGains(tirages: Tirage[], lots: Pick<Lot, 'id' | 'libelle' | 'coutCentimes'>[], maintenant = new Date()): KpiGains {
  const aujourdhui = jourParis(maintenant)
  const debut = ajouterJours(aujourdhui, -(JOURS_KPI_GAINS - 1))
  const recent = (jour: string) => jour >= debut && jour <= aujourdhui
  const k: KpiGains = { gagnes: 0, remis: 0, expires: 0, tauxUtilisation: null, enAttente: 0, valeurExpires: 0, expiresSansCout: 0 }
  for (const t of tirages) {
    if (!estLotPhysique(t)) continue
    if (recent(jourParis(t.date))) k.gagnes++
    const fin = jourExpiration(t)
    if (t.remis) {
      if (recent(jourParis(t.remis.le))) k.remis++
    } else if (aujourdhui < fin) k.enAttente++
    else if (recent(fin)) {
      k.expires++
      const cout = coutDuTirage(lots, t)
      if (cout === null) k.expiresSansCout++
      else k.valeurExpires += cout
    }
  }
  const echus = k.remis + k.expires
  k.tauxUtilisation = echus > 0 ? Math.round((k.remis / echus) * 100) : null
  return k
}

// KPI « Gains de la roue » du tableau de bord (roue v2, D3) — logique pure, importée par le tableau de bord seulement
// (un module partagé par deux pages différées deviendrait un chunk à part, référencé depuis le bundle initial).
// Statuts v2 (R3) : un lot physique gagné est en attente (jour J), utilisable (J+1 à J+30), remis ou expiré ; un
// tirage hérité suit l'ancienne règle (valable le jour J seulement).
import type { Lot, Tirage } from '../types'
// Bornes lues avec `dernierJourGain` (déjà dans le bundle initial : écran de jeu) plutôt que `cycleGain` / `finGain`,
// que seul le serveur utilisait : les importer d'ici les ajoutait au bundle initial (+360 o). Même résultat (vérifié
// contre `cycleGain` heure par heure par tests/cout-kpi-d3.test.ts).
import { dernierJourGain, typeTirage } from './roulette.ts'

/** Fenêtre du KPI : les 30 derniers jours (glissants, à la milliseconde). */
export const JOURS_KPI_GAINS = 30
const FENETRE_MS = JOURS_KPI_GAINS * 24 * 3600 * 1000

/**
 * Premier instant où le gain est expiré (= `finGain`) : minuit à Paris au début du lendemain de son dernier jour.
 * Obtenu comme le « jour J » (`dernierJourGain` d'un tirage hérité, valable le jour même) d'un tirage daté 36 h après
 * le début de ce dernier jour, donc le lendemain vers midi — exact même les nuits de changement d'heure.
 */
const finUtilisation = (t: Pick<Tirage, 'date' | 'typeLot' | 'typeDeduit'>) =>
  dernierJourGain({ date: new Date(dernierJourGain(t).getTime() + 36 * 3600 * 1000).toISOString() })

/** Lot physique non remis : 'enCours' (en attente du lendemain ou utilisable) ou 'expire'. */
export function etapeGain(t: Pick<Tirage, 'date' | 'typeLot' | 'typeDeduit'>, maintenant: Date): 'enCours' | 'expire' {
  return maintenant.getTime() < finUtilisation(t).getTime() ? 'enCours' : 'expire'
}

/**
 * Définitions (affichées sous la carte) :
 * • GAGNÉS : lots physiques tirés ces 30 derniers jours (ni points, ni perdu), remis ou non ;
 * • REMIS : lots remis au comptoir ces 30 derniers jours (date de remise), quel que soit le jour du gain ;
 * • EXPIRÉS : gains dont la période d'utilisation s'est close sans remise ces 30 derniers jours ;
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
  const t0 = maintenant.getTime()
  const recent = (ms: number) => ms > t0 - FENETRE_MS && ms <= t0
  const k: KpiGains = { gagnes: 0, remis: 0, expires: 0, tauxUtilisation: null, enAttente: 0, valeurExpires: 0, expiresSansCout: 0 }
  for (const t of tirages) {
    // Lot physique seulement (= `estGainPhysique`, écrit en clair : un export de moins lu dans le bundle initial).
    if (typeTirage(t) !== 'lot') continue
    if (recent(new Date(t.date).getTime())) k.gagnes++
    if (t.remis) {
      if (recent(new Date(t.remis.le).getTime())) k.remis++
    } else if (etapeGain(t, maintenant) !== 'expire') k.enAttente++
    else if (recent(finUtilisation(t).getTime())) {
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

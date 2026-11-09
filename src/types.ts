// Modèle de données Fideliz. Volontairement générique : aucun champ propre à un
// secteur (restaurant, salon, boutique… utilisent exactement la même structure).

export type TypeCommerce = 'restaurant' | 'salon' | 'boutique' | 'boulangerie' | 'garage' | 'autre'

export interface ReglesReponseAuto {
  /** Publier automatiquement la réponse type pour les avis 5★. */
  auto5Etoiles: boolean
  /** Publier automatiquement la réponse type pour les avis 4★. */
  auto4Etoiles: boolean
  /** Préparer un brouillon (à valider) pour les autres avis. */
  brouillonAutres: boolean
}

export interface Commerce {
  id: string
  nom: string
  type: TypeCommerce
  /** URL d'image (http…) ou initiales (2-3 lettres). Vide = initiales du nom. */
  logo?: string
  lienGoogle: string
  recompense: string
  seuilTampons: number
  /** Lots de la roulette, en texte libre (probabilités égales pour l'instant). */
  lots: string[]
  reglesReponseAuto: ReglesReponseAuto
  actif: boolean
  creeLe: string
}

export interface Client {
  id: string
  commerceId: string
  prenom: string
  telephone?: string
  email?: string
  /** Tampons en cours (remis à zéro quand la récompense est atteinte). */
  tampons: number
  /** Historique des passages (dates ISO, ordre chronologique). */
  visites: string[]
  derniereVisite: string
  creeLe: string
}

export interface Tirage {
  id: string
  commerceId: string
  clientId: string
  lot: string
  date: string
}

export interface Avis {
  id: string
  commerceId: string
  auteur: string
  note: number
  texte: string
  date: string
  reponse?: string
}

export interface Donnees {
  commerces: Commerce[]
  clients: Client[]
  tirages: Tirage[]
  avis: Avis[]
}

export interface Etat extends Donnees {
  commerceActifId: string
}

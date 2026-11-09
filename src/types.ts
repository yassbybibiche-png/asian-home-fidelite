// Modèle de données de l'app. Volontairement générique : aucun champ propre à un
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

export interface Lot {
  libelle: string
  /** En %, ex. 30. Si le total ≠ 100, les chances sont recalculées au prorata. */
  probabilite: number
}

export interface Commerce {
  id: string
  nom: string
  type: TypeCommerce
  /** URL d'image (http…) ou initiales (2-3 lettres). Vide = initiales du nom. */
  logo?: string
  lienGoogle: string
  /** Adresse, téléphone, horaires… en texte libre, affiché sur les pages client (optionnel). */
  coordonnees?: string
  recompense: string
  seuilTampons: number
  /** Lots de la roulette : texte libre + probabilité simple. */
  lots: Lot[]
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
  /** Visites depuis la dernière récompense offerte (peut dépasser le seuil ; offrir la récompense en retire seuil). */
  tampons: number
  /** Historique des passages (dates ISO, ordre chronologique). */
  visites: string[]
  derniereVisite: string
  creeLe: string
  /** Récompenses fidélité déjà remises au client. */
  recompensesOffertes?: RecompenseOfferte[]
}

export interface RecompenseOfferte {
  date: string
  libelle: string
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
  /** Réponse publiée (simulée : rien n'est envoyé à Google). */
  reponse?: string
  /** Réponse publiée automatiquement par une règle de Réglages. */
  reponseAuto?: boolean
  /** Brouillon à relire avant publication. */
  brouillon?: string
}

export type StatutAvis = 'sansReponse' | 'brouillon' | 'repondu'

export interface Donnees {
  commerces: Commerce[]
  clients: Client[]
  tirages: Tirage[]
  avis: Avis[]
}

export interface Etat extends Donnees {
  commerceActifId: string
}

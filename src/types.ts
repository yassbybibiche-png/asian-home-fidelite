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

/** Un palier intermédiaire : petite récompense avant la récompense principale. */
export interface Palier {
  /** Nombre de visites (tampons) pour débloquer ce palier. */
  seuil: number
  libelle: string
}

/**
 * Configuration du programme de fidélité (benchmark 09/11/2026 : Domino's, Starbucks, KFC, McDonald's…).
 * Tout est optionnel : absent = valeurs par défaut (voir `src/lib/programme.ts`), un commerce existant
 * sans configuration voit donc les défauts s'appliquer sans rien casser. Chaque bloc a son `actif`.
 */
export interface ConfigProgramme {
  paliers?: { actif?: boolean; liste?: Palier[] }
  parrainage?: { actif?: boolean; pointsParrain?: number; pointsFilleul?: number; plafondAn?: number }
  bienvenue?: { actif?: boolean; points?: number }
  defi?: { actif?: boolean; visites?: number; jours?: number; recompense?: string }
  niveaux?: { actif?: boolean; habitueSeuil?: number; habitueMultiplicateur?: number; vipSeuil?: number; vipMultiplicateur?: number }
  winback?: { actif?: boolean; rappelJours?: number; offreJours?: number; derniereJours?: number; offre?: string }
  anniversaire?: { actif?: boolean; validiteJours?: number; demiAnniversaire?: boolean; adhesion?: boolean }
  offreHebdo?: { actif?: boolean; jour?: number; libelle?: string; condition?: string }
  reserve?: { actif?: boolean; montantMinCentimes?: number; validiteJours?: number; parTrimestre?: number }
  rattrapage?: { actif?: boolean; delaiJours?: number }
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
  /** Commerce de démonstration (données fictives) : à étiqueter « Démo » dans l'UI. */
  demo?: boolean
  /** Points : 1 point par tranche de `eurosParPoint` € dépensés (défaut 1 → 1 point par euro). */
  eurosParPoint?: number
  /** Catalogue de récompenses échangeables contre des points. */
  catalogue?: RecompensePoints[]
  /** Messages automatiques activés (absent = tous désactivés). */
  messagesAuto?: ReglesMessages
  /** Couleurs / bannière de la carte (absent = charte par défaut : rouge laque, fond ivoire). */
  apparence?: Apparence
  /** Programme de fidélité (paliers, parrainage, niveaux, défis…) : absent = défauts (voir `src/lib/programme.ts`). */
  programme?: ConfigProgramme
  /**
   * Relances SMS / e-mail automatiques (P1-B3), lancées à l'ouverture du tableau de bord du gérant, une fois par jour.
   * Absent = désactivées. Ne part que vers les clients qui ont consenti, et seulement si un prestataire est configuré.
   */
  relancesAuto?: ReglesRelancesAuto
  /**
   * Durée de conservation des données d'un client inactif (P1-B6, RGPD), en mois après sa dernière activité (dernière
   * visite, à défaut l'inscription). Absent = 36 mois (3 ans). Voir `src/lib/rgpd.ts`.
   */
  conservationMois?: number
}

/** Relances automatiques (P1-B3) : « inactif 30 jours » et « anniversaire ». */
export interface ReglesRelancesAuto {
  inactif: boolean
  anniversaire: boolean
}

/** Modèles de relance SMS / e-mail (P1-B3, `src/lib/relances.ts`) ; « libre » = texte saisi par le gérant. */
export type ModeleRelance = 'bienvenue' | 'proche' | 'inactif' | 'anniversaire'

/**
 * Statut d'une tentative de relance : `en_cours` (réservée, envoi en cours), `envoye` (accepté par le prestataire),
 * `refuse` (rien envoyé : pas de consentement, pas de contact, déjà envoyée aujourd'hui), `erreur` (le prestataire a
 * refusé ou ne répond pas), `non_branche` (aucun prestataire configuré : 501, rien envoyé).
 */
export type StatutEnvoi = 'en_cours' | 'envoye' | 'refuse' | 'erreur' | 'non_branche'

/** Journal des envois (migration 0007 : table `envois`). Jamais le téléphone ni l'e-mail, jamais le texte complet. */
export interface EnvoiRelance {
  id: string
  commerceId: string
  clientId: string
  clientPrenom: string
  date: string
  /** Jour à Paris (AAAA-MM-JJ) : une même relance part au plus une fois par client et par jour. */
  jour: string
  modele: ModeleRelance | 'libre'
  canal: 'sms' | 'email'
  statut: StatutEnvoi
  declencheur: 'manuel' | 'auto'
  /** « Gérant », « Admin » ou « Automatique ». */
  auteur: string
  /** Raison d'un refus / d'une erreur (texte affichable, sans secret). */
  raison?: string
  /** Identifiant du message chez le prestataire (Twilio SID, Brevo messageId). */
  idPrestataire?: string
}

export interface RecompensePoints {
  id: string
  nom: string
  cout: number
  description?: string
}

/**
 * Programme vu par le client (pages publiques) : uniquement les blocs que la carte publique affiche, avec les
 * valeurs EFFECTIVES (défauts déjà appliqués par le serveur, pour que le front n'en invente pas). Jamais les
 * réglages internes : relance des inactifs, bienvenue, anniversaire, réserve, points du parrain, plafond annuel.
 */
export interface ProgrammePublic {
  paliers: { actif: boolean; liste: Palier[] }
  parrainage: { actif: boolean; pointsFilleul: number }
  defi: { actif: boolean }
  niveaux: { actif: boolean; habitueSeuil: number; habitueMultiplicateur: number; vipSeuil: number; vipMultiplicateur: number }
  offreHebdo: { actif: boolean; jour: number; libelle: string; condition: string }
  rattrapage: { actif: boolean; delaiJours: number }
}

/**
 * Fiche publique d'un commerce (GET /commerces, /commerces/:id, /commerces/:id/menu, /cartes/:id), lisible sans
 * authentification : ce que les pages client affichent, rien d'autre (voir `src/lib/vuePublique.ts`). Le commerçant
 * reçoit le `Commerce` complet via GET /commerces/:id/etat.
 */
export interface CommercePublic {
  id: string
  nom: string
  type: TypeCommerce
  logo?: string
  lienGoogle: string
  coordonnees?: string
  recompense: string
  seuilTampons: number
  /** Libellés des lots jouables, dans l'ordre de la roue — sans probabilité (le tirage est fait par le serveur). */
  lots: Pick<Lot, 'libelle'>[]
  actif: boolean
  demo: boolean
  catalogue?: Pick<RecompensePoints, 'nom' | 'cout' | 'description'>[]
  apparence?: Apparence
  programme: ProgrammePublic
  /** Durée de conservation EFFECTIVE en mois (défaut appliqué), affichée sur la page de confidentialité (P1-B6). */
  conservationMois: number
}

export type TypeMessageAuto = 'bienvenue' | 'recompense' | 'presque' | 'inactif' | 'anniversaire' | 'avis'
export type ReglesMessages = Record<TypeMessageAuto, boolean>

export interface Apparence {
  /** Couleur principale (bandeau de la carte), #rrggbb. Texte blanc dessus : contraste ≥ 4,5:1 exigé. */
  couleur?: string
  /** Fond de la carte, #rrggbb. Texte foncé dessus : contraste ≥ 4,5:1 exigé. */
  fond?: string
  /** Bannière : adresse https d'une image. */
  banniere?: string
}

export interface MessageClient {
  id: string
  type: TypeMessageAuto | 'commercant'
  texte: string
  date: string
  lu?: boolean
}

export interface EchangePoints {
  id: string
  date: string
  recompenseId: string
  libelle: string
  cout: number
  soldeAvant: number
  soldeApres: number
  /** Nom de l'auteur (membre de l'équipe ou « Gérant »). */
  auteur: string
}

export interface MembreEquipe {
  id: string
  commerceId: string
  nom: string
  creeLe: string
}

export type ActionJournal = 'passage' | 'recompense' | 'echange' | 'message' | 'equipe' | 'menu' | 'parrainage' | 'rattrapage' | 'palier' | 'reserve' | 'defi' | 'gain' | 'consentement' | 'avisGoogle' | 'rgpd'

/** Parrainage réussi (trace d'audit ; les points sont sur les cartes des deux clients). */
export interface Parrainage {
  id: string
  commerceId: string
  parrainId: string
  filleulId: string
  date: string
  pointsParrain: number
  pointsFilleul: number
}

/** Demande de rattrapage d'une visite oubliée (Domino's FR : réclamation sous 30 jours). */
export interface DemandeRattrapage {
  id: string
  /** Date de la visite oubliée (ISO). */
  date: string
  montantCentimes: number
  /** Numéro de ticket / justificatif saisi par le client (optionnel). */
  ticket?: string
  statut: 'en_attente' | 'validee' | 'refusee'
  creeLe: string
  decideLe?: string
}

/** Message privé laissé au restaurant après le jeu (P1-C4), proposé avant Google pour une note basse. Stocké, jamais expédié. */
export interface MessagePrive {
  id: string
  /** Note choisie dans l'app (1 à 5). */
  note: number
  texte: string
  creeLe: string
}

/** Récompense gagnée, à retirer au comptoir (palier, défi, anniversaire…). */
export interface RecompenseEnAttente {
  id: string
  libelle: string
  origine: 'palier' | 'defi' | 'anniversaire' | 'demi-anniversaire' | 'adhesion'
  creeLe: string
  /** Au-delà : la récompense n'est plus retirable (anniversaire). Absent = sans expiration. */
  expireLe?: string
  /** Seuil du palier (origine « palier » uniquement). */
  seuil?: number
}

/** Défi en cours (un seul à la fois) : objectif de visites sur une durée courte. */
export interface DefiEnCours {
  id: string
  debut: string
  objectif: number
  jours: number
  recompense: string
}

/** Plat offert « en réserve » (Domino's Emergency Pizza) : gagné d'avance, à utiliser sous 30 jours. */
export interface Reserve {
  gagneLe: string
  expireLe: string
  utiliseLe?: string
}

/** Journal d'audit : qui a fait quoi, pour quel client, quand. Jamais de code équipe ni de PIN. */
export interface EntreeJournal {
  id: string
  commerceId: string
  date: string
  action: ActionJournal
  /** `client` : action du client lui-même (réponse STOP, lien de désinscription). */
  auteur: { type: 'membre' | 'gerant' | 'client'; id?: string; nom: string }
  clientId?: string
  clientPrenom?: string
  details: string
}

export interface Produit {
  id: string
  nom: string
  description?: string
  /**
   * Prix en centimes. `null` = prix non vérifié : jamais inventé, affiché
   * « Prix sur place » (carte réelle d'Asian Home, relevée sans prix le 10/11/2026).
   */
  prix: number | null
  /** https://… ou image compressée (data:image/jpeg;base64,…). */
  photo?: string
  /** Petite version pour la liste du menu (même format que `photo`) ; absente = `photo` est utilisée. */
  photoVignette?: string
  allergenes: string[]
}

export interface CategorieMenu {
  id: string
  nom: string
  produits: Produit[]
}

export interface Menu {
  commerceId: string
  categories: CategorieMenu[]
  majLe: string
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
  /** Date de la dernière visite validée ; null tant qu'aucune visite (ni actif, ni à relancer). */
  derniereVisite: string | null
  creeLe: string
  /** Récompenses fidélité déjà remises au client. */
  recompensesOffertes?: RecompenseOfferte[]
  /**
   * Consentement explicite aux relances SMS / e-mail (RGPD) : case NON pré-cochée à l'inscription (page de jeu, caisse,
   * écran Clients), modifiable ensuite par le gérant ; retiré par une réponse STOP ou le lien de désinscription.
   * Tant qu'il n'est pas vrai, le serveur refuse tout envoi de relance, même avec un prestataire configuré.
   */
  consentementRelance?: boolean
  /** Date (ISO) du dernier changement de `consentementRelance` (preuve du consentement / du retrait). */
  consentementRelanceLe?: string
  /** Origine de ce dernier changement. */
  consentementRelanceOrigine?: 'inscription' | 'commercant' | 'stop-sms' | 'lien-email'
  /** Solde de points (calculé et stocké par le serveur). */
  points?: number
  /** Total dépensé déclaré en caisse, en centimes. */
  depenseCentimes?: number
  echangesPoints?: EchangePoints[]
  /** Boîte de réception du client (messages automatiques et messages du commerçant). */
  messages?: MessageClient[]
  /** Clés des messages automatiques déjà envoyés (anti-doublon). */
  clesMessages?: string[]
  /** Anniversaire « MM-JJ » (optionnel). */
  anniversaire?: string
  /** Identifiants des dernières actions de caisse traitées (idempotence de la file hors ligne). */
  actionsTraitees?: string[]
  // ---- Programme de fidélité (benchmark 09/11/2026) : champs ajoutés, jamais exigés ----
  /** Code de parrainage unique du client (ex. « AH-K7Q2P9 »), partageable en lien / QR. */
  codeParrainage?: string
  /** Client qui l'a parrainé (un seul parrain par filleul, fixé à l'inscription). */
  parrainId?: string
  /** Récompense de parrainage déjà versée (après la 1re visite du filleul). */
  parrainagePaye?: boolean
  /** Dates (ISO) des parrainages réussis de ce client (plafond annuel). */
  parrainagesGagnes?: string[]
  /** Paliers déjà remis au comptoir (seuils). */
  paliersOfferts?: number[]
  /** Récompenses gagnées, à retirer au comptoir. */
  recompensesEnAttente?: RecompenseEnAttente[]
  /** Défi en cours (un seul à la fois). */
  defi?: DefiEnCours
  /** Défis réussis (date + récompense). */
  defisReussis?: { date: string; recompense: string }[]
  /** Plat offert en réserve (gagné après une commande ≥ seuil, à utiliser sous 30 jours). */
  reserve?: Reserve
  /** Dates (ISO) des plats en réserve gagnés (plafond : 1 par trimestre). */
  reservesGagnees?: string[]
  /** Demandes de rattrapage de visites oubliées. */
  demandesRattrapage?: DemandeRattrapage[]
  /** Messages privés laissés au restaurant (P1-C4) : visibles par le commerce (#/avis), jamais sur la carte publique. */
  messagesPrives?: MessagePrive[]
  /** Plat préféré, collecté après la 2e visite (profiling progressif, jamais à l'inscription). */
  platPrefere?: string
  // ---- RGPD (P1-B6) ----
  /** Exclu de la purge de conservation par le commerce (ex. client connu qui ne passe plus au comptoir). */
  exclusPurge?: boolean
  /** Date (ISO) de la demande de suppression faite par le client depuis sa carte ; la suppression est faite par le commerce. */
  demandeSuppressionLe?: string
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
  /** Code gagnant à montrer au comptoir (tirages faits par le serveur). */
  code?: string
  /** Lot remis au comptoir après vérification du code en caisse (P0-U3) : un code = une remise. */
  remis?: { le: string; par: EntreeJournal['auteur'] }
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
  /** Réponse préparée automatiquement par une règle de Réglages (rien n'est publié). */
  reponseAuto?: boolean
  /** Brouillon à relire avant publication. */
  brouillon?: string
  /** Provenance (P1-B4) : importé de Google Business Profile, ou saisi à la main (absent = saisi à la main). */
  source?: 'google' | 'manuel'
  /** Avis importé : nom Google de l'avis (`accounts/…/locations/…/reviews/…`), clé de déduplication. */
  googleId?: string
  /** Date de publication de `reponse` sur Google (absente = pas publiée ; effacée si la réponse est modifiée). */
  reponsePublieeLe?: string
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
  /** Mode serveur uniquement : équipe et journal d'audit des commerces déverrouillés. */
  membres?: MembreEquipe[]
  journal?: EntreeJournal[]
  /** Mode serveur uniquement : journal des envois de relances SMS / e-mail (P1-B3). */
  envois?: EnvoiRelance[]
}

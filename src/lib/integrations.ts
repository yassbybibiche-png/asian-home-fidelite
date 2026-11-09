// Textes des intégrations « à brancher » (V3) et mentions RGPD : regroupés ici pour être testés
// (aucun écran ne doit promettre un envoi, un pass ou une connexion Google qui n'existe pas).

export const LIBELLE_WALLET = 'Carte Wallet : bientôt'

export const ETATS_WALLET = ['Apple Wallet : en suspens.', 'Google Wallet : à brancher (aucun compte émetteur pour l’instant).']

export const EXPLICATION_WALLET =
  'Aucun pass Wallet n’est créé pour l’instant. En attendant, gardez cette carte en favori ou ajoutez-la à l’écran d’accueil : son QR code suffit au comptoir.'

export const MENTION_ENVOI = 'Envoi SMS/e-mail à brancher'

export const TEXTE_AVIS_DEMO = 'Démo — avis simulés, aucune connexion à Google'

export const TEXTE_AVIS_VIDE_PRODUCTION = 'Connectez Google Business Profile pour importer vos avis.'

/** Scope OAuth des API Google Business Profile (doc Google « Basic setup », vérifiée le 09/11/2026). */
export const SCOPE_GOOGLE_BUSINESS = 'https://www.googleapis.com/auth/business.manage'

export const ETAPES_CONNEXION_GOOGLE = [
  'Le compte Google propriétaire (ou gestionnaire) de la fiche Google du commerce — fourni par le commerce.',
  'Un projet Google Cloud, puis la demande d’accès aux API Business Profile (formulaire Google, examen par Google) : sans approbation, les API ne sont pas utilisables.',
  'Activer les API Business Profile dans la console Google Cloud (dont « Google My Business API », qui sert à lire les avis et à y répondre).',
  'Créer un identifiant OAuth 2.0 (client web) avec le scope « business.manage » : ' + SCOPE_GOOGLE_BUSINESS + '.',
  'Le commerce se connecte et donne son consentement sur l’écran Google.',
  'Import des avis puis publication des réponses — pas encore développé dans l’app.',
]

/** Bloc RGPD affiché dans Plus et Offre (et repris dans le README). */
export const MENTIONS_RGPD = [
  'Données collectées : prénom + téléphone ou e-mail du client, ses visites, tampons, récompenses et gains de la roulette.',
  'Finalité : la carte de fidélité et la roulette du commerce. Aucune revente, aucune publicité tierce.',
  'Relances SMS / e-mail : seulement avec le consentement explicite du client et un moyen de se désinscrire (envoi automatique pas encore branché).',
  'Conservation : tant que le client utilise sa carte ; durée maximale à fixer par le commerce (par exemple 3 ans après la dernière visite).',
  'Export ou suppression sur simple demande au commerçant (export CSV disponible ; la suppression n’a pas encore de bouton : l’administrateur la fait à la main dans la base).',
  'Hébergement : à préciser selon le déploiement choisi — dans l’Union européenne de préférence.',
]

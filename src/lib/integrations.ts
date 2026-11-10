// Textes des intégrations « à brancher » (V3), état des relances (P1-B3) et mentions RGPD : regroupés ici pour être testés
// (aucun écran ne doit promettre un envoi, un pass ou une connexion Google qui n'existe pas).

export const LIBELLE_WALLET = 'Carte Wallet : bientôt'

export const ETATS_WALLET = ['Apple Wallet : en suspens.', 'Google Wallet : à brancher (aucun compte émetteur pour l’instant).']

export const EXPLICATION_WALLET =
  'Aucun pass Wallet n’est créé pour l’instant. En attendant, gardez cette carte en favori ou ajoutez-la à l’écran d’accueil : son QR code suffit au comptoir.'

/**
 * Relances SMS / e-mail (P1-B3) : branchées de bout en bout côté serveur, mais un envoi réel n'a lieu que si le
 * prestataire du canal est configuré (Twilio pour les SMS, Brevo pour les e-mails) ET que le client a consenti.
 */
export const MENTION_ENVOI =
  'Relance SMS / e-mail depuis la fiche du client : envoi réel seulement si Twilio (SMS) ou Brevo (e-mail) est configuré sur le serveur et que le client a consenti'

/** État des relances affiché dans Messages, selon `GET /sante` (`null` = état inconnu, serveur injoignable). */
export function etatRelances(s: { sms?: boolean; email?: boolean; migration?: boolean } | null): string[] {
  if (!s) return ['État des prestataires inconnu (serveur injoignable) : aucune relance ne part sans prestataire configuré.']
  const lignes = [
    s.sms ? 'SMS : Twilio configuré — envois réels possibles.' : 'SMS : non branché (Twilio non configuré) — aucun SMS n’est envoyé.',
    s.email ? 'E-mail : Brevo configuré — envois réels possibles.' : 'E-mail : non branché (Brevo non configuré) — aucun e-mail n’est envoyé.',
  ]
  if (s.migration === false) lignes.push('Journal des envois : migration 0007 non appliquée sur la base — aucune relance ne part tant qu’elle manque.')
  return lignes
}

export const TEXTE_AVIS_DEMO = 'Démo — avis simulés, aucune connexion à Google'

export const TEXTE_AVIS_VIDE_PRODUCTION = 'Connectez Google Business Profile pour importer vos avis.'

/** Scope OAuth des API Google Business Profile (doc Google « Basic setup », vérifiée le 09/11/2026). */
export const SCOPE_GOOGLE_BUSINESS = 'https://www.googleapis.com/auth/business.manage'

/** Résumé à l'écran du guide complet `docs/GOOGLE-BUSINESS.md` (P1-B4). */
export const ETAPES_CONNEXION_GOOGLE = [
  'Le compte Google propriétaire (ou gestionnaire) de la fiche Google du commerce — fourni par le commerce.',
  'Un projet Google Cloud, puis la demande d’accès aux API Business Profile (formulaire Google « Application for Basic API Access », examen par Google, délai inconnu) : sans approbation, les API ne sont pas utilisables (quota 0).',
  'Activer les API Business Profile dans la console Google Cloud (dont « Google My Business API », qui sert à lire les avis et à y répondre).',
  'Créer un identifiant OAuth 2.0 (application Web) avec le scope « business.manage » : ' + SCOPE_GOOGLE_BUSINESS + ', et y déclarer l’URI de redirection de l’app.',
  'Renseigner sur Render GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET et GOOGLE_REDIRECT_URI (jamais dans le code).',
  'Ici, « Connecter Google » : le commerce donne son consentement sur l’écran Google ; l’app peut alors importer les avis et publier les réponses validées.',
]

export const GUIDE_GOOGLE_BUSINESS = 'Guide pas à pas : docs/GOOGLE-BUSINESS.md (dans le dépôt de l’app).'

/**
 * État de Google Business Profile affiché sur l'écran Avis. `configure` vient du serveur (`GET …/google`) ; `null` =
 * état inconnu (mode local, serveur injoignable). Rien n'est promis tant que le serveur n'est pas configuré.
 */
export function etatGoogleBusiness(s: { configure: boolean; connecte: boolean } | null): { badge: string; texte: string } {
  if (!s || !s.configure) {
    return {
      badge: 'à brancher',
      texte:
        'Connexion à Google : à brancher (aucun identifiant Google configuré sur le serveur). Aucun avis n’est importé et aucune réponse n’est publiée : recopiez un avis reçu à la main, puis copiez vous-même votre réponse sur Google.',
    }
  }
  if (!s.connecte) {
    return {
      badge: 'à connecter',
      texte: 'Google est configuré sur le serveur mais pas encore connecté : utilisez « Connecter Google » (compte propriétaire ou gestionnaire de la fiche).',
    }
  }
  return {
    badge: 'connecté',
    texte:
      'Google connecté : importez vos avis ; seule la réponse automatique aux nouveaux avis 5★ (si la règle est active) part d’office, toute autre réponse est publiée après votre validation.',
  }
}

/** Bloc RGPD affiché dans Plus et Offre (et repris dans le README). */
export const MENTIONS_RGPD = [
  'Données collectées : prénom + téléphone ou e-mail du client, ses visites, tampons, récompenses et gains de la roulette.',
  'Finalité : la carte de fidélité et la roulette du commerce. Aucune revente, aucune publicité tierce.',
  'Relances SMS / e-mail : seulement avec le consentement explicite du client (case non pré-cochée, date et origine conservées) ; désinscription à tout moment (réponse STOP par SMS, lien dans chaque e-mail, ou auprès du commerçant). Aucun envoi tant qu’aucun prestataire n’est configuré.',
  'Conservation : tant que le client utilise sa carte ; durée maximale à fixer par le commerce (par exemple 3 ans après la dernière visite).',
  'Export ou suppression sur simple demande au commerçant (export CSV disponible ; la suppression n’a pas encore de bouton : l’administrateur la fait à la main dans la base).',
  'Hébergement : à préciser selon le déploiement choisi — dans l’Union européenne de préférence.',
]

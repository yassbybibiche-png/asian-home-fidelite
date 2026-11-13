// P2-Q6 — Logs structurés JSON : une ligne par requête HTTP, lisible par machine
// (filtre / tri dans les journaux Render, `jq` en local). Une ligne = un objet JSON sur une seule
// ligne, émis sur stdout (`console.info`, comme les lignes `[securite]` et `[lecture-sensible]`) :
//   {"type":"requete","niveau":"info","horodatage":"2026-11-11T13:00:00.000Z","methode":"GET",
//    "route":"/api/v1/sante","statut":200,"dureeMs":3,"ip":"127.0.0.1"}
// Champs : `niveau` (info < 400, avertissement 4xx, erreur 5xx), `horodatage` (ISO, horloge réelle),
// `methode`, `route` (chemin masqué, sans requête), `statut`, `dureeMs` (réponse envoyée − réception),
// `ip` (déjà journalisée par les lignes `[securite]`, nécessaire pour enquêter sur une rafale).
//
// Ce qui ne figure JAMAIS dans ces lignes : aucun secret, PIN, jeton, téléphone ou e-mail brut,
// aucun identifiant de carte ou de client brut, aucun code gagnant. La requête (`?…`) est jetée :
// elle peut porter un jeton d'accès (`?acces=…`) ou un contact (`?q=…`). Dans le chemin, seuls
// restent en clair les mots littéraux des routes et l'identifiant d'un commerce CONNU du serveur à sa
// place (un préfixe `c-…` seul ne prouve rien) ; tout autre segment est remplacé par son empreinte SHA-256 tronquée (12 car. hex., même
// procédé que P2-S15) : on peut compter les identifiants distincts sans les lire. Aucun en-tête ni
// corps n'est journalisé. Une ligne par réponse terminée (une connexion interrompue avant la fin de
// la réponse ne produit aucune ligne : son statut serait inconnu).
// La journalisation ne doit jamais faire échouer une requête : toute erreur d'écriture est avalée.
import { createHash } from 'node:crypto'

export type NiveauLog = 'info' | 'avertissement' | 'erreur'

export function niveauPourStatut(statut: number): NiveauLog {
  if (statut >= 500) return 'erreur'
  if (statut >= 400) return 'avertissement'
  return 'info'
}

/** Empreinte SHA-256 tronquée (12 car. hex., 48 bits), comme P2-S15 : pseudonymisation, pas anonymisation. */
export function empreinte(valeur: string): string {
  return createHash('sha256').update(valeur).digest('hex').slice(0, 12)
}

/**
 * Chemin masqué pour les logs. Normalisation exactement comme le routeur (`server/app.ts`) : segments
 * vides supprimés, décodage par segment (repli sur le brut si l'encodage est invalide) — sinon un nom
 * encodé (`/api/v1/%63artes/<id>`) ou un segment vide (`/api/v1/cartes//<id>`) contourne le masquage
 * (revue Codex P2-Q6 point 1). Ensuite, seuls restent en clair :
 * - les mots littéraux des routes (`SEGMENTS_PUBLICS`, relevés du routeur + liens courts + `/api/v1`) ;
 * - l'identifiant de commerce, mais seulement s'il s'agit d'un commerce CONNU du serveur (ensemble
 *   chargé au démarrage et complété à chaque création) et à sa place (après `commerces`, `r` ou `menu`) :
 *   un préfixe `c-…` ne prouve pas qu'un segment est un commerce public (ex. un e-mail forgé
 *   `c-alice@example.com` dans un chemin 404) — il est alors masqué comme les autres ;
 * - un mot littéral à la place d'un identifiant (ex. `POST /cartes/retrouver`) : c'est le nom de la
 *   route, pas une donnée.
 * Tout le reste (identifiant de carte ou de client, jeton, code gagnant, et n'importe quel segment
 * inconnu — téléphone, e-mail, secret glissé dans un chemin 404) est remplacé par son empreinte
 * SHA-256 tronquée (revue Codex P2-Q6 point 2). La liste blanche échoue donc en sécurité : oublier
 * un littéral dans `SEGMENTS_PUBLICS` ne fait que rendre une ligne moins lisible, jamais fuiter.
 */
const SEGMENTS_PUBLICS = new Set([
  'api', 'v1',
  'sante', 'acces-client', 'commerces', 'cartes', 'retrouver', 'jeton', 'revocation', 'lus', 'donnees',
  'suppression', 'sessions', 'desinscription', 'clients', 'tirages', 'caisse', 'gains', 'remise',
  'passage', 'recompense', 'echange', 'visite', 'rattrapage', 'relance', 'message-prive', 'prenom',
  'profil', 'reaffichage', 'revocation-acces', 'lien-acces', 'export.csv', 'pass.json', 'equipe',
  'messages', 'envois', 'etat', 'logo', 'menu', 'evenements', 'mesures', 'google', 'auth', 'callback',
  'deconnecter', 'import-avis', 'avis', 'publier-reponse', 'purge', 'stop-sms', 'attente', 'reserve', 'pin',
  'admin', 'sauvegarde', 'instants-gagnants', 'derniers-gains',
  'c', 'd', 'r',
])

/**
 * Marche le chemin normalisé et décide pour chaque segment : le garder tel quel ou le remplacer.
 * Normalisation exactement comme le routeur (`server/app.ts`) : segments vides supprimés, décodage par
 * segment (repli sur le brut si l'encodage est invalide) — sinon un nom encodé (`/api/v1/%63artes/<id>`)
 * ou un segment vide (`/api/v1/cartes//<id>`) contourne le masquage (revue Codex P2-Q6 point 1). Le
 * masquage se décide segment par segment, AVANT de réunir le chemin : un séparateur encodé (`%2F`, `%3F`)
 * à l'intérieur d'un segment ne peut donc pas casser une frontière (revue Codex P2-Q6 2e passe, point 2).
 * Règles (revue Codex P2-Q6 points 1 et 2, 2e passe point 1) :
 * - seuls restent en clair les mots littéraux des routes (`SEGMENTS_PUBLICS`, relevés du routeur +
 *   liens courts + `/api/v1`), et un mot littéral à la place d'un identifiant (ex. `POST /cartes/retrouver`) ;
 * - l'identifiant de commerce ne reste en clair que s'il s'agit d'un commerce CONNU du serveur
 *   (`commercesConnus`, chargé au démarrage et complété à chaque création) et à sa place (après
 *   `commerces`, `r` ou `menu`) : un préfixe `c-…` ne prouve pas qu'un segment est un commerce public
 *   (ex. `c-alice@example.com` forgé dans un chemin 404) ;
 * - tout le reste (identifiant de carte ou de client, jeton, code gagnant, et n'importe quel segment
 *   inconnu — téléphone, e-mail, secret glissé dans un chemin 404) est remplacé par `masquerSegment`.
 * La liste blanche échoue en sécurité : oublier un littéral ne fait que rendre une ligne moins lisible.
 */
function parcourirChemin(
  pathname: string,
  masquerSegment: (segment: string) => string,
  commercesConnus: ReadonlySet<string>,
): string {
  const brut = pathname.split('?')[0] ?? ''
  const segments = brut.split('/').filter(Boolean).map(decoder)
  let masquer = 0 // segments identifiants à masquer (après cartes/clients/c, desinscription/d, gains)
  let commerce = 0 // 1 identifiant de commerce attendu (après commerces, r, menu)
  const sortis: string[] = []
  for (const segment of segments) {
    if (masquer > 0) {
      sortis.push(SEGMENTS_PUBLICS.has(segment) ? segment : masquerSegment(segment))
      masquer--
      continue
    }
    if (commerce > 0) {
      sortis.push(commercesConnus.has(segment) ? segment : masquerSegment(segment))
      commerce--
      continue
    }
    if (segment === 'cartes' || segment === 'clients' || segment === 'c') masquer = 1
    else if (segment === 'desinscription' || segment === 'd') masquer = 2
    else if (segment === 'gains') masquer = 1
    else if (segment === 'commerces' || segment === 'r' || segment === 'menu') commerce = 1
    sortis.push(SEGMENTS_PUBLICS.has(segment) ? segment : masquerSegment(segment))
  }
  return `/${sortis.join('/')}`
}

export function routeMasquee(pathname: string, commercesConnus: ReadonlySet<string> = new Set()): string {
  return parcourirChemin(pathname, empreinte, commercesConnus)
}

/**
 * Chemin masqué pour les logs d'erreur (`console.error`) : même marche que `routeMasquee`, mais chaque
 * segment sensible est remplacé par `…` (format historique, test P2-S15). Le message de l'exception
 * elle-même n'est pas masqué (les erreurs de stockage n'y incluent pas d'identifiant aujourd'hui).
 */
export function cheminMasquePourErreur(pathname: string, commercesConnus: ReadonlySet<string> = new Set()): string {
  return parcourirChemin(pathname, () => '…', commercesConnus)
}

function decoder(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export type LigneRequete = {
  type: 'requete'
  niveau: NiveauLog
  horodatage: string
  methode: string
  route: string
  statut: number
  dureeMs: number
  ip: string
}

/** Construit la ligne (sans l'émettre) : testable sans capter `console.info`. */
export function ligneRequete(o: {
  methode: string
  pathname: string
  statut: number
  dureeMs: number
  ip: string
  horodatage?: string
  commercesConnus?: ReadonlySet<string>
}): LigneRequete {
  return {
    type: 'requete',
    niveau: niveauPourStatut(o.statut),
    horodatage: o.horodatage ?? new Date().toISOString(),
    methode: o.methode,
    route: routeMasquee(o.pathname, o.commercesConnus),
    statut: o.statut,
    dureeMs: Math.max(0, Math.floor(o.dureeMs)),
    ip: o.ip,
  }
}

/** Émet la ligne sur stdout. Ne lève jamais (une défaillance de journalisation ne fait jamais échouer une requête). */
export function journaliserRequete(o: {
  methode: string
  pathname: string
  statut: number
  dureeMs: number
  ip: string
  horodatage?: string
  commercesConnus?: ReadonlySet<string>
}): void {
  try {
    console.info(JSON.stringify(ligneRequete(o)))
  } catch {
    // La journalisation ne doit jamais faire échouer une requête.
  }
}

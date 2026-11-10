// Client HTTP de l'API /api/v1 (server/). Aucune règle métier ici : le serveur décide de tout
// (tampons, récompense, tirage). `fetch` est injectable pour les tests (aucun vrai serveur dans `npm test`).
import type { Avis, Client, Commerce, CommercePublic, EntreeJournal, EnvoiRelance, MembreEquipe, Menu, MessageClient, ModeleRelance, Tirage, TypeCommerce } from '../types'
import type { StatutGain, StatutJeu } from '../lib/roulette'
import type { Cible } from '../lib/messages'
import type { ClientAPurger } from '../lib/rgpd'
import type { LotHistorique } from '../lib/carte'

export const MESSAGE_HORS_LIGNE = 'Serveur injoignable — vérifiez la connexion.'

export class ErreurApi extends Error {
  /** Code HTTP ; 0 = serveur injoignable (réseau coupé, serveur arrêté, délai dépassé). */
  statut: number
  constructor(statut: number, message: string) {
    super(message)
    this.name = 'ErreurApi'
    this.statut = statut
  }
  get horsLigne(): boolean {
    return this.statut === 0
  }
}

/**
 * Preuve d'accès envoyée au serveur : jeton de session (X-Session, obtenu une fois contre le PIN) ou, en repli
 * (serveur sans sessions, ancien serveur), le PIN lui-même à chaque requête.
 */
type Preuve = { pin: string; jeton?: undefined } | { jeton: string; expireLe?: string; pin?: undefined }

/** Commerce (PIN X-Commerce-PIN) ou admin (PIN X-Admin-PIN, ouvre tous les commerces) ; PIN ou jeton de session. */
export type Acces = ({ role: 'commerce'; commerceId: string } | { role: 'admin' }) & Preuve

/** Session d'un membre de l'équipe (caisse), obtenue contre son code. */
export type AccesEquipe = { role: 'equipe'; commerceId: string; jeton: string; expireLe?: string; membreNom?: string }

export interface Session {
  jeton: string
  role: 'commerce' | 'admin' | 'equipe'
  commerceId?: string
  membreNom?: string
  expireLe: string
}

export type DemandeSession = { role: 'commerce'; commerceId: string; pin: string } | { role: 'admin'; pin: string } | { role: 'equipe'; commerceId: string; code: string }

export interface EtatCommerce {
  commerce: Commerce
  clients: Client[]
  tirages: Tirage[]
  avis: Avis[]
  membres?: MembreEquipe[]
  journal?: EntreeJournal[]
  envois?: EnvoiRelance[]
}

/** Accès à la caisse : session équipe, code équipe (4 chiffres, repli) ou accès du gérant. */
export type AccesCaisse = { code: string } | AccesEquipe | Acces

export interface ReponseCaisse {
  auteur: EntreeJournal['auteur']
  commerce: Commerce
  clients: Client[]
}

export interface MessageCommercant extends MessageClient {
  clientId: string
  prenom: string
  contact: string
}

export interface ResultatTirage {
  lot: string
  code: string
  date: string
  perdant: boolean
}

/** GET …/google : `configure` = variables Google présentes sur le serveur ; `connecte` = consentement donné. */
export interface EtatGoogle {
  configure: boolean
  connecte: boolean
  connecteLe?: string
  /** Fiche Google déjà trouvée (après un premier import, ou GOOGLE_BUSINESS_LOCATION). */
  fiche?: boolean
}

export interface ResultatImportGoogle {
  importes: number
  misAJour: number
  ignores: number
  publiees: number
  echecsPublication: number
  erreurPublication?: string
  avis: Avis[]
}

/** Carte publique : jamais de téléphone ni d'e-mail. */
export type CartePublique = Omit<Client, 'telephone' | 'email'>

export interface ReponseCarte {
  client: CartePublique
  /** Vue publique (sans probabilités, règles d'avis, taux de points ni réglages internes du programme). */
  commerce: CommercePublic
  /** codeDuJour / remisDuJour : absents sur un serveur d'avant P0-U3. */
  jeu: { statut: StatutJeu; lotDuJour: string | null; codeDuJour?: string | null; remisDuJour?: boolean }
  menuDisponible?: boolean
  /** P1-C3 : lots gagnés à la roue (sans code), pour l'historique de la carte. Absent sur un serveur plus ancien. */
  historiqueLots?: LotHistorique[]
}

/** Gain de la roue vu en caisse (GET / POST …/caisse/gains/:code). */
export interface GainCaisse {
  code: string
  lot: string
  date: string
  statut: StatutGain
  client: { id: string; prenom: string } | null
  remis: { le: string; par: string } | null
}

export type ChampsReglages = Partial<
  Pick<
    Commerce,
    | 'nom'
    | 'type'
    | 'logo'
    | 'lienGoogle'
    | 'coordonnees'
    | 'lienDeliveroo'
    | 'lienUberEats'
    | 'recompense'
    | 'seuilTampons'
    | 'lots'
    | 'reglesReponseAuto'
    | 'actif'
    | 'eurosParPoint'
    | 'catalogue'
    | 'messagesAuto'
    | 'apparence'
    | 'programme'
    | 'relancesAuto'
    | 'conservationMois'
  >
>

/**
 * `VITE_API_URL` → base de l'API. Absente ou vide → null (mode local, localStorage).
 * Accepte « https://hote », « https://hote/api/v1 » ou « / » (même origine que le front).
 */
export function baseApi(valeur: string | undefined): string | null {
  const v = valeur?.trim()
  if (!v) return null
  const sansSlash = v.replace(/\/+$/, '')
  return sansSlash.endsWith('/api/v1') ? sansSlash : `${sansSlash}/api/v1`
}

function entetesAcces(acces: AccesCaisse | null | undefined): Record<string, string> {
  if (!acces) return {}
  if ('code' in acces) return { 'X-Equipe-Code': acces.code }
  if (acces.jeton) return { 'X-Session': acces.jeton }
  if (acces.role === 'equipe' || acces.pin === undefined) return {}
  return acces.role === 'admin' ? { 'X-Admin-PIN': acces.pin } : { 'X-Commerce-PIN': acces.pin }
}

/**
 * Échange un PIN / code contre un jeton de session. Renvoie null si le serveur ne sait pas en délivrer
 * (503 : SESSION_SECRET absente ; 404 / 405 : serveur d'avant les sessions ; 0 : injoignable) : l'appelant garde
 * alors le PIN en en-tête, comme avant. Un PIN refusé (401) ou un blocage (429) est relancé tel quel.
 */
export async function echangerContreSession(api: Pick<ClientApi, 'ouvrirSession'>, demande: DemandeSession): Promise<Session | null> {
  try {
    return await api.ouvrirSession(demande)
  } catch (e) {
    if (e instanceof ErreurApi && [0, 404, 405, 503].includes(e.statut)) return null
    throw e
  }
}

/** Accès « jeton » correspondant à une session ouverte par le gérant ou l'admin. */
export function accesDeSession(s: Session): Acces | null {
  if (s.role === 'admin') return { role: 'admin', jeton: s.jeton, expireLe: s.expireLe }
  if (s.role === 'commerce' && s.commerceId) return { role: 'commerce', commerceId: s.commerceId, jeton: s.jeton, expireLe: s.expireLe }
  return null
}

const enc = encodeURIComponent

/**
 * Signal qui annule la requête après `ms`. `AbortSignal.timeout` manque sur des navigateurs encore répandus
 * (Safari iOS < 16) : sans repli, une requête vers un serveur endormi pourrait y attendre indéfiniment.
 */
export function signalDelai(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined') return undefined
  if ('timeout' in AbortSignal) return AbortSignal.timeout(ms)
  if (typeof AbortController === 'undefined') return undefined
  const c = new AbortController()
  setTimeout(() => c.abort(), ms)
  return c.signal
}

export function creerClientApi(base: string, f: typeof fetch = (...a) => fetch(...a), delaiMs = 10_000) {
  async function requete(methode: string, chemin: string, options: { acces?: AccesCaisse | null; corps?: unknown; fichier?: Blob; texte?: boolean; delaiMs?: number } = {}) {
    const entetes: Record<string, string> = { ...entetesAcces(options.acces) }
    if (options.corps !== undefined) entetes['Content-Type'] = 'application/json'
    // Fichier brut (logo) : envoyé tel quel ; le serveur lit le format dans les octets, pas dans cet en-tête.
    if (options.fichier) entetes['Content-Type'] = options.fichier.type || 'application/octet-stream'
    let r: Response
    try {
      r = await f(base + chemin, {
        method: methode,
        headers: entetes,
        body: options.fichier ?? (options.corps === undefined ? undefined : JSON.stringify(options.corps)),
        cache: 'no-store',
        signal: signalDelai(options.delaiMs ?? delaiMs),
      })
    } catch {
      throw new ErreurApi(0, MESSAGE_HORS_LIGNE)
    }
    if (!r.ok) {
      let message = `Erreur du serveur (${r.status}).`
      try {
        const j = (await r.json()) as { erreur?: unknown }
        if (typeof j.erreur === 'string') message = j.erreur
      } catch {
        // Réponse non JSON (proxy, page d'erreur de l'hébergeur…) : message générique.
      }
      // 502/503/504 : l'hébergeur répond mais le serveur de l'app est arrêté ou en réveil.
      throw new ErreurApi(r.status >= 502 && r.status <= 504 ? 0 : r.status, r.status >= 502 && r.status <= 504 ? MESSAGE_HORS_LIGNE : message)
    }
    try {
      // `r.text()` retirerait le BOM UTF-8 du CSV, indispensable pour qu'Excel lise les accents.
      return options.texte ? new TextDecoder('utf-8', { ignoreBOM: true }).decode(await r.arrayBuffer()) : await r.json()
    } catch {
      throw new ErreurApi(0, MESSAGE_HORS_LIGNE)
    }
  }

  return {
    base,
    sante: () =>
      requete('GET', '/sante') as Promise<{
        ok: boolean
        version: string
        demo: boolean
        integrations?: { sms?: boolean; email?: boolean; googleBusinessProfile?: boolean; googleWallet?: boolean }
        migrations?: { relances?: boolean }
      }>,

    // ---- Sessions : le PIN / code n'est envoyé qu'ici, une fois ; ensuite seul le jeton circule (X-Session) ----
    ouvrirSession: (demande: DemandeSession) => requete('POST', '/sessions', { corps: demande }) as Promise<Session>,
    /** Révoque le jeton côté serveur (« Verrouiller »). */
    fermerSession: (jeton: string) => requete('DELETE', '/sessions', { acces: { role: 'admin', jeton } }) as Promise<{ ok: boolean }>,

    // ---- Public ----
    // Fiches publiques seulement : le commerce complet (réglages) vient de `etat`, avec PIN ou session.
    commerces: async () => ((await requete('GET', '/commerces')) as { commerces: CommercePublic[] }).commerces,
    commerce: async (id: string) => ((await requete('GET', `/commerces/${enc(id)}`)) as { commerce: CommercePublic }).commerce,
    carte: (clientId: string) => requete('GET', `/cartes/${enc(clientId)}`) as Promise<ReponseCarte>,
    /**
     * « Carte introuvable » (P1-C3, audit F-12) : réponse identique que le contact ait une carte ou non. `envoi` dit
     * seulement si le serveur sait envoyer un lien sur ce canal (prestataire SMS / e-mail configuré).
     */
    retrouverCarte: (contact: string) => requete('POST', '/cartes/retrouver', { corps: { contact } }) as Promise<{ ok: boolean; envoi: boolean }>,
    /** Auto-inscription depuis la page de jeu (sans PIN) : renvoie la carte sans téléphone ni e-mail. Prénom optionnel, parrainage en option. */
    // `consentementRelance` : case des relances SMS / e-mail, jamais pré-cochée (envoyée seulement si cochée).
    inscrirePublic: (commerceId: string, prenom: string, contact: string, parrain?: string, consentementRelance = false) =>
      requete('POST', `/commerces/${enc(commerceId)}/clients`, {
        corps: { prenom, contact, ...(parrain ? { parrain } : {}), ...(consentementRelance ? { consentementRelance: true } : {}) },
      }) as Promise<{ client: CartePublique; existant: boolean }>,
    /** Désinscription des relances depuis le lien d'un e-mail (page #/desinscription/…). */
    desinscrire: (clientId: string, jeton: string) =>
      requete('POST', `/desinscription/${enc(clientId)}/${enc(jeton)}`) as Promise<{ ok: boolean; commerce: string }>,
    // RGPD (P1-B6), depuis la carte : identité = lien de la carte + téléphone ou e-mail donné à l'inscription (403 sinon).
    /** « Recevoir mes données » : CSV de toutes les données du client. */
    donneesCarte: (clientId: string, contact: string) => requete('POST', `/cartes/${enc(clientId)}/donnees`, { corps: { contact }, texte: true }) as Promise<string>,
    /** « Demander la suppression » : demande enregistrée, la suppression est faite par le commerce. */
    demanderSuppression: (clientId: string, contact: string) =>
      requete('POST', `/cartes/${enc(clientId)}/suppression`, { corps: { contact } }) as Promise<{ ok: boolean; demandeSuppressionLe: string; commerce: string }>,
    /** Prénom donné après le tirage (P1-C1) : seulement si la carte n'en a pas ; identité = carte + contact (403 sinon). */
    prenomCarte: (commerceId: string, clientId: string, contact: string, prenom: string) =>
      requete('POST', `/commerces/${enc(commerceId)}/clients/${enc(clientId)}/prenom`, { corps: { contact, prenom } }) as Promise<{ client: CartePublique }>,
    /** Message privé au restaurant après le jeu (P1-C4) : stocké, jamais expédié ; identité = carte + contact (403 sinon). */
    messagePrive: (commerceId: string, clientId: string, contact: string, note: number, texte: string) =>
      requete('POST', `/commerces/${enc(commerceId)}/clients/${enc(clientId)}/message-prive`, { corps: { contact, note, texte } }) as Promise<{
        ok: boolean
        message: { id: string; creeLe: string }
      }>,
    /** Le navigateur n'envoie qu'un contact : la visite du jour, le tirage du jour et le lot sont décidés par le serveur. */
    tirer: (commerceId: string, contact: string, prenom?: string, parrain?: string) =>
      requete('POST', `/commerces/${enc(commerceId)}/tirages`, { corps: { contact, ...(prenom ? { prenom } : {}), ...(parrain ? { parrain } : {}) } }) as Promise<ResultatTirage>,
    /** Profil progressif (client, après sa 2e visite) : anniversaire « JJ/MM » et/ou plat préféré. */
    profil: (commerceId: string, clientId: string, champs: { anniversaire?: string; platPrefere?: string }) =>
      requete('POST', `/commerces/${enc(commerceId)}/clients/${enc(clientId)}/profil`, { corps: champs }) as Promise<{ client: CartePublique }>,
    /** Visite oubliée signalée par le client (date ISO + montant en centimes + ticket éventuel). */
    declarerRattrapage: (commerceId: string, clientId: string, champs: { date: string; montantCentimes: number; ticket?: string }) =>
      requete('POST', `/commerces/${enc(commerceId)}/clients/${enc(clientId)}/rattrapage`, { corps: champs }) as Promise<{ demande: import('../types').DemandeRattrapage; client: CartePublique }>,

    // ---- Commerçant (PIN du commerce ou PIN admin) ----
    etat: (commerceId: string, acces: Acces) => requete('GET', `/commerces/${enc(commerceId)}/etat`, { acces }) as Promise<EtatCommerce>,
    inscrire: (commerceId: string, acces: Acces, prenom: string, contact: string, parrain?: string, consentementRelance = false) =>
      requete('POST', `/commerces/${enc(commerceId)}/clients`, {
        acces,
        corps: { prenom, contact, ...(parrain ? { parrain } : {}), ...(consentementRelance ? { consentementRelance: true } : {}) },
      }) as Promise<{ client: Client; existant: boolean }>,
    visite: async (commerceId: string, acces: Acces, clientId: string) =>
      ((await requete('POST', `/commerces/${enc(commerceId)}/clients/${enc(clientId)}/visite`, { acces })) as { client: Client }).client,
    recompense: async (commerceId: string, acces: Acces, clientId: string) =>
      ((await requete('POST', `/commerces/${enc(commerceId)}/clients/${enc(clientId)}/recompense`, { acces })) as { client: Client }).client,
    majCommerce: async (commerceId: string, acces: Acces, champs: ChampsReglages) =>
      ((await requete('PATCH', `/commerces/${enc(commerceId)}`, { acces, corps: champs })) as { commerce: Commerce }).commerce,
    /** Logo téléversé (P1-B5) : PNG / JPEG / WebP, 2 Mo maximum ; renvoie le commerce avec la nouvelle adresse du logo. */
    envoyerLogo: async (commerceId: string, acces: Acces, fichier: Blob) =>
      ((await requete('PUT', `/commerces/${enc(commerceId)}/logo`, { acces, fichier, delaiMs: 60_000 })) as { commerce: Commerce }).commerce,
    /** « Revenir au logo par défaut ». */
    supprimerLogo: async (commerceId: string, acces: Acces) =>
      ((await requete('DELETE', `/commerces/${enc(commerceId)}/logo`, { acces })) as { commerce: Commerce }).commerce,
    majPin: (commerceId: string, acces: Acces, pin: string) => requete('PUT', `/commerces/${enc(commerceId)}/pin`, { acces, corps: { pin } }),
    ajouterAvis: async (commerceId: string, acces: Acces, avis: { auteur: string; note: number; texte: string }) =>
      ((await requete('POST', `/commerces/${enc(commerceId)}/avis`, { acces, corps: avis })) as { avis: Avis }).avis,
    majAvis: async (commerceId: string, acces: Acces, avisId: string, maj: { reponse?: string | null; brouillon?: string | null }) =>
      ((await requete('PATCH', `/commerces/${enc(commerceId)}/avis/${enc(avisId)}`, { acces, corps: maj })) as { avis: Avis }).avis,
    // ---- Google Business Profile (P1-B4) : 501 tant que le serveur n'a pas GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET ----
    /** État de la connexion (aucun jeton n'est jamais renvoyé au navigateur). */
    etatGoogle: (commerceId: string, acces: Acces) =>
      requete('GET', `/commerces/${enc(commerceId)}/google`, { acces }) as Promise<EtatGoogle>,
    /** URL de l'écran de consentement Google, à ouvrir dans le navigateur. */
    lienConnexionGoogle: async (commerceId: string, acces: Acces) =>
      ((await requete('GET', `/commerces/${enc(commerceId)}/google/auth?format=json`, { acces })) as { url: string }).url,
    deconnecterGoogle: (commerceId: string, acces: Acces) =>
      requete('POST', `/commerces/${enc(commerceId)}/google/deconnecter`, { acces }) as Promise<{ ok: boolean; revoque: boolean }>,
    importerAvisGoogle: (commerceId: string, acces: Acces) =>
      requete('POST', `/commerces/${enc(commerceId)}/google/import-avis`, { acces }) as Promise<ResultatImportGoogle>,
    /** Publie la réponse validée (ou la réponse auto 5★) sur Google ; 409 si elle n'est pas validée. */
    publierReponse: async (commerceId: string, acces: Acces, avisId: string) =>
      ((await requete('POST', `/commerces/${enc(commerceId)}/avis/${enc(avisId)}/publier-reponse`, { acces })) as { avis: Avis }).avis,
    exportCsv: (commerceId: string, acces: Acces) => requete('GET', `/commerces/${enc(commerceId)}/export.csv`, { acces, texte: true }) as Promise<string>,
    majClient: async (commerceId: string, acces: Acces, clientId: string, champs: { anniversaire?: string; platPrefere?: string; consentementRelance?: boolean; exclusPurge?: boolean }) =>
      ((await requete('PATCH', `/commerces/${enc(commerceId)}/clients/${enc(clientId)}`, { acces, corps: champs })) as { client: Client }).client,
    // ---- RGPD (P1-B6) ----
    /** CSV de toutes les données d'un client (droit d'accès / portabilité). */
    exportClient: (commerceId: string, acces: Acces, clientId: string) =>
      requete('GET', `/commerces/${enc(commerceId)}/clients/${enc(clientId)}/export.csv`, { acces, texte: true }) as Promise<string>,
    /** Suppression définitive (cascade : tirages, journal, parrainages, rattrapages, relances). */
    supprimerClient: (commerceId: string, acces: Acces, clientId: string) =>
      requete('DELETE', `/commerces/${enc(commerceId)}/clients/${enc(clientId)}`, { acces, corps: { confirmation: 'SUPPRIMER' } }) as Promise<{ ok: boolean; bilan: Record<string, number | boolean> }>,
    /** Avertissement avant purge : clients dont la durée de conservation est dépassée ou presque. */
    listePurge: (commerceId: string, acces: Acces) =>
      requete('GET', `/commerces/${enc(commerceId)}/purge`, { acces }) as Promise<{ conservationMois: number; maintenant: string; clients: ClientAPurger[] }>,
    purger: (commerceId: string, acces: Acces, clientIds: string[]) =>
      requete('POST', `/commerces/${enc(commerceId)}/purge`, { acces, corps: { clientIds } }) as Promise<{ supprimes: number; ignores: number }>,
    /** Relance SMS / e-mail (P1-B3) : 501 sans prestataire, 409 sans consentement / déjà envoyée aujourd'hui. */
    relancer: (commerceId: string, acces: Acces, clientId: string, demande: { modele: ModeleRelance; canal?: 'sms' | 'email' }) =>
      requete('POST', `/commerces/${enc(commerceId)}/clients/${enc(clientId)}/relance`, { acces, corps: demande }) as Promise<{ envoye: boolean; canal: 'sms' | 'email'; envoi: EnvoiRelance }>,
    /** Décision du commerçant sur une visite oubliée : validation = 1 visite + points ; refus = demande classée. */
    deciderRattrapage: async (commerceId: string, acces: Acces, clientId: string, demandeId: string, decision: 'valider' | 'refuser') =>
      ((await requete('POST', `/commerces/${enc(commerceId)}/clients/${enc(clientId)}/rattrapage/${enc(demandeId)}`, { acces, corps: { decision } })) as { client: Client }).client,

    // ---- Caisse (code équipe ou PIN) ----
    caisse: (commerceId: string, acces: AccesCaisse) => requete('GET', `/commerces/${enc(commerceId)}/caisse`, { acces }) as Promise<ReponseCaisse>,
    actionCaisse: (
      commerceId: string,
      acces: AccesCaisse,
      type: 'passage' | 'recompense' | 'echange' | 'attente' | 'reserve',
      corps: { clientId: string; actionId: string; faitLe?: string; montantCentimes?: number; recompenseId?: string },
    ) => requete('POST', `/commerces/${enc(commerceId)}/caisse/${type}`, { acces, corps }) as Promise<{ client: Client; dejaTraite: boolean }>,
    /** Code gagnant de la roue (6 caractères, déjà normalisé) : vérification, puis remise du lot (une seule fois). */
    verifierGain: async (commerceId: string, acces: AccesCaisse, code: string) =>
      ((await requete('GET', `/commerces/${enc(commerceId)}/caisse/gains/${enc(code)}`, { acces })) as { gain: GainCaisse }).gain,
    remettreGain: async (commerceId: string, acces: AccesCaisse, code: string) =>
      ((await requete('POST', `/commerces/${enc(commerceId)}/caisse/gains/${enc(code)}/remise`, { acces })) as { gain: GainCaisse }).gain,

    // ---- Équipe, messages, menu (gérant) ----
    equipe: async (commerceId: string, acces: Acces) => ((await requete('GET', `/commerces/${enc(commerceId)}/equipe`, { acces })) as { membres: MembreEquipe[] }).membres,
    ajouterMembre: (commerceId: string, acces: Acces, nom: string, code: string) =>
      requete('POST', `/commerces/${enc(commerceId)}/equipe`, { acces, corps: { nom, code } }) as Promise<{ membre: MembreEquipe }>,
    majMembre: (commerceId: string, acces: Acces, membreId: string, champs: { nom?: string; code?: string }) =>
      requete('PATCH', `/commerces/${enc(commerceId)}/equipe/${enc(membreId)}`, { acces, corps: champs }) as Promise<{ membre: MembreEquipe }>,
    supprimerMembre: (commerceId: string, acces: Acces, membreId: string) => requete('DELETE', `/commerces/${enc(commerceId)}/equipe/${enc(membreId)}`, { acces }),
    messages: async (commerceId: string, acces: Acces) =>
      ((await requete('GET', `/commerces/${enc(commerceId)}/messages`, { acces })) as { messages: MessageCommercant[] }).messages,
    envoyerMessage: async (commerceId: string, acces: Acces, cible: Cible, texte: string) =>
      ((await requete('POST', `/commerces/${enc(commerceId)}/messages`, { acces, corps: { cible, texte } })) as { destinataires: number }).destinataires,
    menu: (commerceId: string) => requete('GET', `/commerces/${enc(commerceId)}/menu`) as Promise<{ menu: Menu; commerce: CommercePublic }>,
    majMenu: async (commerceId: string, acces: Acces, menu: Pick<Menu, 'categories'>) =>
      ((await requete('PUT', `/commerces/${enc(commerceId)}/menu`, { acces, corps: menu })) as { menu: Menu }).menu,
    /** Public : le client marque ses messages comme lus. */
    marquerLus: (clientId: string) => requete('POST', `/cartes/${enc(clientId)}/lus`),

    // ---- Admin ----
    /** `admin` : accès admin (PIN ou session), ou le PIN admin seul. */
    creerCommerce: async (admin: string | Acces, champs: { nom: string; type: TypeCommerce; lienGoogle: string; pin: string }) =>
      ((await requete('POST', '/commerces', { acces: typeof admin === 'string' ? { role: 'admin', pin: admin } : admin, corps: champs })) as { commerce: Commerce }).commerce,
  }
}

export type ClientApi = ReturnType<typeof creerClientApi>

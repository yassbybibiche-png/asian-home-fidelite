// Client HTTP de l'API /api/v1 (server/). Aucune règle métier ici : le serveur décide de tout
// (tampons, récompense, tirage). `fetch` est injectable pour les tests (aucun vrai serveur dans `npm test`).
import type { Avis, Client, Commerce, Tirage, TypeCommerce } from '../types'
import type { StatutJeu } from '../lib/roulette'

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

/** PIN d'un commerce (X-Commerce-PIN) ou PIN admin (X-Admin-PIN, ouvre tous les commerces). */
export type Acces = { role: 'commerce'; commerceId: string; pin: string } | { role: 'admin'; pin: string }

export interface EtatCommerce {
  commerce: Commerce
  clients: Client[]
  tirages: Tirage[]
  avis: Avis[]
}

export interface ResultatTirage {
  lot: string
  code: string
  date: string
  perdant: boolean
}

/** Carte publique : jamais de téléphone ni d'e-mail. */
export type CartePublique = Omit<Client, 'telephone' | 'email'>

export interface ReponseCarte {
  client: CartePublique
  commerce: Commerce
  jeu: { statut: StatutJeu; lotDuJour: string | null }
}

export type ChampsReglages = Partial<
  Pick<Commerce, 'nom' | 'type' | 'logo' | 'lienGoogle' | 'coordonnees' | 'recompense' | 'seuilTampons' | 'lots' | 'reglesReponseAuto' | 'actif'>
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

function entetesAcces(acces: Acces | null | undefined): Record<string, string> {
  if (!acces) return {}
  return acces.role === 'admin' ? { 'X-Admin-PIN': acces.pin } : { 'X-Commerce-PIN': acces.pin }
}

const enc = encodeURIComponent

export function creerClientApi(base: string, f: typeof fetch = (...a) => fetch(...a), delaiMs = 10_000) {
  async function requete(methode: string, chemin: string, options: { acces?: Acces | null; corps?: unknown; texte?: boolean } = {}) {
    const entetes: Record<string, string> = { ...entetesAcces(options.acces) }
    if (options.corps !== undefined) entetes['Content-Type'] = 'application/json'
    let r: Response
    try {
      r = await f(base + chemin, {
        method: methode,
        headers: entetes,
        body: options.corps === undefined ? undefined : JSON.stringify(options.corps),
        cache: 'no-store',
        signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(delaiMs) : undefined,
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
    sante: () => requete('GET', '/sante') as Promise<{ ok: boolean; version: string; demo: boolean }>,

    // ---- Public ----
    commerces: async () => ((await requete('GET', '/commerces')) as { commerces: Commerce[] }).commerces,
    commerce: async (id: string) => ((await requete('GET', `/commerces/${enc(id)}`)) as { commerce: Commerce }).commerce,
    carte: (clientId: string) => requete('GET', `/cartes/${enc(clientId)}`) as Promise<ReponseCarte>,
    /** Auto-inscription depuis la page de jeu (sans PIN) : renvoie la carte sans téléphone ni e-mail. */
    inscrirePublic: (commerceId: string, prenom: string, contact: string) =>
      requete('POST', `/commerces/${enc(commerceId)}/clients`, { corps: { prenom, contact } }) as Promise<{ client: CartePublique; existant: boolean }>,
    /** Le navigateur n'envoie qu'un contact : la visite du jour, le tirage du jour et le lot sont décidés par le serveur. */
    tirer: (commerceId: string, contact: string, prenom?: string) =>
      requete('POST', `/commerces/${enc(commerceId)}/tirages`, { corps: { contact, ...(prenom ? { prenom } : {}) } }) as Promise<ResultatTirage>,

    // ---- Commerçant (PIN du commerce ou PIN admin) ----
    etat: (commerceId: string, acces: Acces) => requete('GET', `/commerces/${enc(commerceId)}/etat`, { acces }) as Promise<EtatCommerce>,
    inscrire: (commerceId: string, acces: Acces, prenom: string, contact: string) =>
      requete('POST', `/commerces/${enc(commerceId)}/clients`, { acces, corps: { prenom, contact } }) as Promise<{ client: Client; existant: boolean }>,
    visite: async (commerceId: string, acces: Acces, clientId: string) =>
      ((await requete('POST', `/commerces/${enc(commerceId)}/clients/${enc(clientId)}/visite`, { acces })) as { client: Client }).client,
    recompense: async (commerceId: string, acces: Acces, clientId: string) =>
      ((await requete('POST', `/commerces/${enc(commerceId)}/clients/${enc(clientId)}/recompense`, { acces })) as { client: Client }).client,
    majCommerce: async (commerceId: string, acces: Acces, champs: ChampsReglages) =>
      ((await requete('PATCH', `/commerces/${enc(commerceId)}`, { acces, corps: champs })) as { commerce: Commerce }).commerce,
    majPin: (commerceId: string, acces: Acces, pin: string) => requete('PUT', `/commerces/${enc(commerceId)}/pin`, { acces, corps: { pin } }),
    ajouterAvis: async (commerceId: string, acces: Acces, avis: { auteur: string; note: number; texte: string }) =>
      ((await requete('POST', `/commerces/${enc(commerceId)}/avis`, { acces, corps: avis })) as { avis: Avis }).avis,
    majAvis: async (commerceId: string, acces: Acces, avisId: string, maj: { reponse?: string | null; brouillon?: string | null }) =>
      ((await requete('PATCH', `/commerces/${enc(commerceId)}/avis/${enc(avisId)}`, { acces, corps: maj })) as { avis: Avis }).avis,
    exportCsv: (commerceId: string, acces: Acces) => requete('GET', `/commerces/${enc(commerceId)}/export.csv`, { acces, texte: true }) as Promise<string>,

    // ---- Admin ----
    creerCommerce: async (pinAdmin: string, champs: { nom: string; type: TypeCommerce; lienGoogle: string; pin: string }) =>
      ((await requete('POST', '/commerces', { acces: { role: 'admin', pin: pinAdmin }, corps: champs })) as { commerce: Commerce }).commerce,
  }
}

export type ClientApi = ReturnType<typeof creerClientApi>

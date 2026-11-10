import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Avis, Client, Commerce, Etat, Tirage, TypeCommerce } from './types'
import { depotLocal, type Depot } from './data/depot'
import { creerDepotApi, etatVide, type DepotApi } from './data/depotApi'
import { baseApi, creerClientApi, ErreurApi, type Acces, type ClientApi } from './data/api'
import { creerCoffrePin, rangementIndexedDb, type CoffrePin } from './data/coffrePin'
import {
  avecDelai,
  causeEchec,
  DELAI_COFFRE_MS,
  ErreurCoffre,
  issueRechargement,
  journaliserEchec,
  lireCoffreBorne,
  messageEchec,
  MESSAGE_COFFRE_ILLISIBLE,
  ouvrirAcces,
} from './lib/connexion'
import { analyserContact, nouveauClient, offrirRecompense, trouverClientParContact, validerVisite } from './lib/fidelite'
import { appliquerInscription } from './lib/programme'
import { appliquerRegles } from './lib/avis'
import { clientsEnCsv, nomFichierCsv } from './lib/csv'
import { nouveauCommerce } from './data/defaults'

/**
 * Deux modes :
 * - « local » (VITE_API_URL absente) : démo dans ce navigateur (localStorage), comme avant ;
 * - « api » : données partagées sur le serveur (`server/`). Le serveur fait foi : chaque chargement
 *   remplace tout l'état local ; aucune action n'est appliquée en local avant la réponse du serveur
 *   (donc jamais de fausse réussite hors ligne). Rechargement toutes les 10 s, au retour au premier plan
 *   et après chaque action.
 */
export type Mode = 'local' | 'api'
export type Connexion = 'local' | 'chargement' | 'enLigne' | 'horsLigne'

export const INTERVALLE_RECHARGEMENT_MS = 10_000

export interface NouveauCommerce {
  nom: string
  type: TypeCommerce
  lienGoogle: string
  /** PIN commerçant (mode API uniquement). */
  pin?: string
}

interface Store {
  mode: Mode
  etat: Etat
  /** Commerce affiché. En mode API, les pages commerçant ne s'affichent qu'une fois déverrouillées (cf. App). */
  commerce: Commerce
  /** Données fictives affichées : mode local, ou commerce de démo du serveur (DEMO=1). */
  estDemo: boolean
  connexion: Connexion
  /** Dernier chargement réussi depuis le serveur (ISO). */
  derniereSynchro: string | null
  erreurConnexion: string | null
  /**
   * Pourquoi l'écran de déverrouillage est revenu sans que l'utilisateur ait appuyé sur « Verrouiller »
   * (session expirée, PIN changé, connexion mémorisée illisible). Reste affiché jusqu'au prochain déverrouillage.
   */
  verrouillage: Verrouillage | null
  acces: Acces | null
  /** Le PIN mémorisé (chiffré) a été relu : on sait s'il faut afficher l'écran de déverrouillage. */
  accesPret: boolean
  api: ClientApi | null
  deverrouiller(acces: Acces): Promise<void>
  /** Sans message : « Verrouiller » volontaire. Avec : verrouillage subi, expliqué par `verrouillage.message`. */
  verrouiller(message?: string): Promise<void>
  /** Relit l'accès mémorisé sur cet appareil (après un échec ou une attente trop longue). */
  relireAcces(): Promise<void>
  recharger(): Promise<void>
  choisirCommerce(id: string): void
  majCommerce(commerce: Commerce): Promise<void>
  /** Crée un commerce (en mode API : avec son PIN, en une seule requête) et l'affiche. */
  creerCommerce(n: NouveauCommerce): Promise<Commerce>
  basculerActif(id: string): Promise<void>
  changerPin(commerceId: string, pin: string): Promise<void>
  reinitialiserDemo(): void
  /** Inscrit un client, ou retrouve celui qui a déjà ce téléphone / e-mail dans ce commerce. */
  inscrireClient(commerceId: string, prenom: string, contactSaisi: string): Promise<{ client: Client; existant: boolean }>
  validerVisite(clientId: string): Promise<void>
  offrirRecompense(clientId: string): Promise<void>
  /** Mode local uniquement : en mode API, le tirage est fait par le serveur. */
  enregistrerTirage(tirage: Tirage): void
  /** Ajoute un avis en appliquant aussitôt les règles automatiques du commerce. */
  ajouterAvis(commerceId: string, avis: { auteur: string; note: number; texte: string }): Promise<void>
  /** `brouillon` (null = supprimer) ou `reponse` (marque comme répondu). */
  majAvis(avis: Avis, maj: { reponse?: string; brouillon?: string | null }): Promise<void>
  /** Applique les règles automatiques aux avis sans réponse du commerce. */
  appliquerReglesAvis(commerceId: string): Promise<void>
  exporterCsv(commerceId: string): Promise<{ nom: string; contenu: string }>
  /** Mode serveur : appel avec le PIN mémorisé, puis rechargement de l'état. Mode local : refusé (fonction serveur). */
  avecPin<T>(f: (a: Acces, api: ClientApi) => Promise<T>): Promise<T>
}

export interface Verrouillage {
  message: string
  /** Rôle de l'accès perdu : l'écran de déverrouillage le présélectionne. */
  role?: Acces['role']
  /** La connexion mémorisée n'a pas pu être relue : « Réessayer » la relit. */
  coffre?: boolean
}

export const MESSAGE_MODE_SERVEUR ='Disponible avec le serveur (données partagées) : pas dans la démo locale.'

const Contexte = createContext<Store | null>(null)

/** Réapplique les règles : seuls les avis sans réponse NI brouillon changent (cf. `appliquerRegles`). */
function avecReglesAppliquees(e: Etat, commerceId: string): Etat {
  const commerce = e.commerces.find((c) => c.id === commerceId)
  if (!commerce) return e
  return { ...e, avis: e.avis.map((a) => (a.commerceId === commerceId ? appliquerRegles(a, commerce) : a)) }
}

/** Message affichable pour une erreur d'action (toujours en français). */
export function messageErreur(e: unknown): string {
  if (e instanceof ErreurApi) return e.message
  if (e instanceof Error && e.message) return e.message
  return 'Une erreur est survenue. Réessayez.'
}

function stockage(type: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    return window[type]
  } catch {
    return null
  }
}

const URL_API = baseApi(import.meta.env.VITE_API_URL)

export function FournisseurStore({ children, depot = depotLocal }: { children: ReactNode; depot?: Depot }) {
  const api = useMemo(() => (URL_API ? creerClientApi(URL_API) : null), [])
  return api ? <StoreApi api={api}>{children}</StoreApi> : <StoreLocal depot={depot}>{children}</StoreLocal>
}

// ---------------------------------------------------------------------------------------------
// Mode local (démo, localStorage)
// ---------------------------------------------------------------------------------------------

function StoreLocal({ children, depot }: { children: ReactNode; depot: Depot }) {
  const [etat, setEtat] = useState<Etat>(() => depot.charger())

  useEffect(() => {
    depot.enregistrer(etat)
  }, [depot, etat])

  // Démo dans un seul navigateur : une visite validée dans l'onglet commerçant débloque aussitôt
  // la roue déjà ouverte dans un autre onglet (et inversement, sans écraser les données de l'autre onglet).
  useEffect(() => {
    const recharger = (e: StorageEvent) => {
      if (e.key?.startsWith('fidelite:etat:')) setEtat(depot.charger())
    }
    window.addEventListener('storage', recharger)
    return () => window.removeEventListener('storage', recharger)
  }, [depot])

  const majClient = useCallback(
    (clientId: string, maj: (client: Client, commerce: Commerce) => Client) =>
      setEtat((e) => ({
        ...e,
        clients: e.clients.map((c) => {
          const commerce = e.commerces.find((co) => co.id === c.commerceId)
          return c.id === clientId && commerce ? maj(c, commerce) : c
        }),
      })),
    [],
  )

  const actions = useMemo(
    () => ({
      deverrouiller: async () => {},
      verrouiller: async () => {},
      relireAcces: async () => {},
      recharger: async () => setEtat(depot.charger()),
      choisirCommerce: (id: string) => setEtat((e) => ({ ...e, commerceActifId: id })),
      // Enregistrer les réglages applique aussitôt les règles de réponse automatique aux avis en attente.
      majCommerce: async (commerce: Commerce) =>
        setEtat((e) => avecReglesAppliquees({ ...e, commerces: e.commerces.map((c) => (c.id === commerce.id ? commerce : c)) }, commerce.id)),
      creerCommerce: async (n: NouveauCommerce) => {
        const commerce = nouveauCommerce(n.nom, n.type, n.lienGoogle)
        setEtat((e) => ({ ...e, commerces: [...e.commerces, commerce], commerceActifId: commerce.id }))
        return commerce
      },
      basculerActif: async (id: string) =>
        setEtat((e) => ({ ...e, commerces: e.commerces.map((c) => (c.id === id ? { ...c, actif: !c.actif } : c)) })),
      changerPin: async () => {
        throw new Error('Pas de PIN en démo locale.')
      },
      reinitialiserDemo: () => setEtat(depot.reinitialiser()),
      validerVisite: async (clientId: string) => majClient(clientId, (c, co) => validerVisite(c, co)),
      offrirRecompense: async (clientId: string) => majClient(clientId, (c, co) => offrirRecompense(c, co)),
      enregistrerTirage: (tirage: Tirage) => setEtat((e) => ({ ...e, tirages: [tirage, ...e.tirages] })),
      ajouterAvis: async (commerceId: string, a: { auteur: string; note: number; texte: string }) =>
        setEtat((e) => {
          const commerce = e.commerces.find((c) => c.id === commerceId)
          const avis: Avis = {
            id: `av-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            commerceId,
            ...a,
            date: new Date().toISOString(),
          }
          return { ...e, avis: [commerce ? appliquerRegles(avis, commerce) : avis, ...e.avis] }
        }),
      majAvis: async (avis: Avis, maj: { reponse?: string; brouillon?: string | null }) => {
        const nouveau: Avis =
          maj.reponse !== undefined
            ? { ...avis, reponse: maj.reponse, reponseAuto: false, brouillon: undefined }
            : { ...avis, brouillon: maj.brouillon || undefined }
        setEtat((e) => ({ ...e, avis: e.avis.map((a) => (a.id === avis.id ? nouveau : a)) }))
      },
      appliquerReglesAvis: async (commerceId: string) => setEtat((e) => avecReglesAppliquees(e, commerceId)),
      avecPin: async () => {
        throw new Error(MESSAGE_MODE_SERVEUR)
      },
    }),
    [depot, majClient],
  )

  const inscrireClient = useCallback(
    async (commerceId: string, prenom: string, contactSaisi: string) => {
      const contact = analyserContact(contactSaisi)
      if (!contact) throw new Error('Saisissez un numéro (10 chiffres) ou un e-mail valide.')
      const existant = trouverClientParContact(etat.clients, commerceId, contact)
      if (existant) return { client: existant, existant: true }
      const commerce = etat.commerces.find((c) => c.id === commerceId)
      const client = commerce ? appliquerInscription(nouveauClient(commerceId, prenom, contact), commerce) : nouveauClient(commerceId, prenom, contact)
      setEtat((e) => ({ ...e, clients: [...e.clients, client] }))
      return { client, existant: false }
    },
    [etat.clients],
  )

  const exporterCsv = useCallback(
    async (commerceId: string) => ({ nom: nomFichierCsv(commerceId), contenu: clientsEnCsv(etat.clients.filter((c) => c.commerceId === commerceId)) }),
    [etat.clients],
  )

  const commerce = etat.commerces.find((c) => c.id === etat.commerceActifId) ?? etat.commerces[0]

  const valeur = useMemo<Store>(
    () => ({
      mode: 'local',
      etat,
      commerce,
      estDemo: true,
      connexion: 'local',
      derniereSynchro: null,
      erreurConnexion: null,
      verrouillage: null,
      acces: null,
      accesPret: true,
      api: null,
      ...actions,
      inscrireClient,
      exporterCsv,
    }),
    [etat, commerce, actions, inscrireClient, exporterCsv],
  )
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>
}

// ---------------------------------------------------------------------------------------------
// Mode API (données partagées)
// ---------------------------------------------------------------------------------------------

function StoreApi({ children, api }: { children: ReactNode; api: ClientApi }) {
  const depot = useMemo<DepotApi>(() => creerDepotApi(api, stockage('localStorage')), [api])
  const coffre = useMemo<CoffrePin>(() => creerCoffrePin(stockage('sessionStorage'), rangementIndexedDb()), [])

  const [etat, setEtat] = useState<Etat>(etatVide)
  const [acces, setAcces] = useState<Acces | null>(null)
  const [accesPret, setAccesPret] = useState(false)
  const [connexion, setConnexion] = useState<Connexion>('chargement')
  const [derniereSynchro, setDerniereSynchro] = useState<string | null>(null)
  const [erreurConnexion, setErreurConnexion] = useState<string | null>(null)
  const [verrouillage, setVerrouillage] = useState<Verrouillage | null>(null)

  // Références lues par les chargements asynchrones (évite les fermetures périmées).
  const accesRef = useRef<Acces | null>(null)
  const actifRef = useRef('')
  const numero = useRef(0)
  const dernierApplique = useRef(0)
  // Dernière cause d'échec de rechargement journalisée : hors ligne, on ne remplit pas le journal toutes les 10 s.
  const causeJournalisee = useRef<string | null>(null)
  const journal = useMemo(() => ({ stockage: stockage('localStorage') }), [])

  const appliquer = useCallback(
    (e: Etat) => {
      actifRef.current = e.commerceActifId
      setEtat(e)
      setDerniereSynchro(depot.derniereSynchro())
      setConnexion('enLigne')
      setErreurConnexion(null)
      causeJournalisee.current = null
    },
    [depot],
  )

  const verrouiller = useCallback(
    async (message?: string) => {
      const role = accesRef.current?.role
      // Révocation côté serveur, sans attendre ni bloquer (hors ligne : le jeton expirera seul).
      const jeton = accesRef.current?.jeton
      if (jeton) void api.fermerSession(jeton).catch(() => {})
      accesRef.current = null
      // Les chargements encore en cours (faits avec l'ancien PIN) seront ignorés.
      dernierApplique.current = ++numero.current
      setAcces(null)
      // Verrouillage subi (session expirée, PIN changé) : l'explication reste affichée jusqu'au prochain déverrouillage
      // (les rechargements périodiques ne l'effacent pas). « Verrouiller » volontaire : aucun message.
      setVerrouillage(message ? { message, role } : null)
      setErreurConnexion(null)
      // Efface du navigateur les données privées (clients, téléphones) ; garde la liste publique des commerces.
      // Rien n'est perdu : en mode serveur, le cache n'est qu'une copie des données du serveur.
      depot.reinitialiser()
      setEtat((e) => ({ ...etatVide(), commerces: e.commerces.map((c) => ({ ...c })), commerceActifId: e.commerceActifId }))
      // Après les mises à jour d'écran : un IndexedDB bloqué ne doit pas retenir le verrouillage.
      await avecDelai(coffre.oublier(), DELAI_COFFRE_MS).catch(() => {})
    },
    [api, coffre, depot],
  )

  const recharger = useCallback(async () => {
    const n = ++numero.current
    // L'accès utilisé pour CE chargement : si un déverrouillage (ou un verrouillage) a lieu pendant la requête,
    // le résultat est périmé — sans ce contrôle, une liste publique chargée sans accès pouvait arriver APRÈS
    // le déverrouillage et remplacer les données privées tout juste chargées (réponses lentes au réveil du serveur).
    const a = accesRef.current
    try {
      const e = await depot.chargerServeur(a, actifRef.current)
      if (n <= dernierApplique.current || a !== accesRef.current) return
      dernierApplique.current = n
      appliquer(e)
    } catch (err) {
      if (n <= dernierApplique.current) return
      const issue = issueRechargement(err, a, accesRef.current)
      if (issue.type === 'ignorer') return
      const cause = causeEchec(err)
      if (causeJournalisee.current !== cause) {
        causeJournalisee.current = cause
        journaliserEchec('rechargement', err, journal)
      }
      if (issue.type === 'verrouiller') {
        await verrouiller(issue.message)
        return
      }
      // « Hors ligne » seulement si le serveur est vraiment injoignable (pas pour un refus 429 ou une erreur 500).
      if (issue.type === 'horsLigne') setConnexion('horsLigne')
      setErreurConnexion(issue.message)
    }
  }, [appliquer, depot, journal, verrouiller])

  /**
   * Démarrage : accès mémorisé (chiffré) dans cet onglet ? Si oui, cache affiché tout de suite, puis serveur.
   * La relecture est bornée (DELAI_COFFRE_MS) et un échec est expliqué (plus de « Chargement… » sans fin ni
   * de retour muet à l'écran de déverrouillage). Le cache local n'est pas effacé dans ce cas.
   */
  const demarrer = useCallback(
    async (estAnnule: () => boolean = () => false) => {
      setAccesPret(false)
      const lu = await lireCoffreBorne(coffre)
      if (estAnnule()) return
      if (lu.statut === 'illisible') {
        journaliserEchec('demarrage', new ErreurCoffre(lu.raison), journal)
        setVerrouillage({ message: MESSAGE_COFFRE_ILLISIBLE, coffre: true })
      }
      const a = lu.statut === 'ok' && lu.contenu.role !== 'equipe' ? lu.contenu : null
      if (a) {
        accesRef.current = a
        setAcces(a)
        setVerrouillage(null)
        const cache = depot.charger()
        actifRef.current = cache.commerceActifId
        setEtat(cache)
        setDerniereSynchro(depot.derniereSynchro())
      }
      setAccesPret(true)
      void recharger()
    },
    [coffre, depot, journal, recharger],
  )

  useEffect(() => {
    let annule = false
    void demarrer(() => annule)
    return () => {
      annule = true
    }
  }, [demarrer])

  const relireAcces = useCallback(() => demarrer(), [demarrer])

  // Rechargement périodique (page visible) + au retour au premier plan.
  useEffect(() => {
    const siVisible = () => {
      if (document.visibilityState === 'visible') void recharger()
    }
    const minuterie = window.setInterval(siVisible, INTERVALLE_RECHARGEMENT_MS)
    document.addEventListener('visibilitychange', siVisible)
    window.addEventListener('focus', siVisible)
    window.addEventListener('online', siVisible)
    return () => {
      window.clearInterval(minuterie)
      document.removeEventListener('visibilitychange', siVisible)
      window.removeEventListener('focus', siVisible)
      window.removeEventListener('online', siVisible)
    }
  }, [recharger])

  const deverrouiller = useCallback(
    async (saisi: Acces) => {
      // Le PIN part une seule fois (POST /sessions) contre un jeton court ; ensuite seul le jeton circule.
      // Serveur sans sessions (503 : SESSION_SECRET absente, ancien serveur) : repli sur le PIN en en-tête, comme avant.
      // Serveur endormi : nouveaux essais pendant 30 s au plus (cf. `ouvrirAcces`), puis échec expliqué.
      const n = ++numero.current
      let r: Awaited<ReturnType<typeof ouvrirAcces>>
      try {
        r = await ouvrirAcces(api, depot, saisi, actifRef.current)
      } catch (err) {
        journaliserEchec('deverrouillage', err, journal)
        throw err
      }
      dernierApplique.current = Math.max(dernierApplique.current, n)
      accesRef.current = r.acces
      setAcces(r.acces)
      setVerrouillage(null)
      appliquer(r.etat)
      // Mémoriser est un confort (éviter de ressaisir le PIN au rechargement) : jamais bloquant.
      await avecDelai(coffre.memoriser(r.acces), DELAI_COFFRE_MS).catch(() => false)
    },
    [api, appliquer, coffre, depot, journal],
  )

  /** Toute action passe par le serveur avec le PIN, puis l'état est rechargé (le serveur fait foi). */
  const avecPin = useCallback(
    async <T,>(f: (a: Acces) => Promise<T>): Promise<T> => {
      const a = accesRef.current
      if (!a) throw new Error('Déverrouillez d’abord avec votre PIN.')
      try {
        const r = await f(a)
        await recharger()
        return r
      } catch (err) {
        if (err instanceof ErreurApi && err.horsLigne) {
          setConnexion('horsLigne')
          setErreurConnexion(messageEchec(err))
        }
        throw err
      }
    },
    [recharger],
  )

  const commerceDe = useCallback((clientId: string) => etat.clients.find((c) => c.id === clientId)?.commerceId ?? '', [etat.clients])

  const actions = useMemo(
    () => ({
      deverrouiller,
      verrouiller,
      relireAcces,
      recharger,
      choisirCommerce: (id: string) => {
        actifRef.current = id
        setEtat((e) => {
          const suivant = { ...e, commerceActifId: id }
          depot.enregistrer(suivant)
          return suivant
        })
      },
      majCommerce: (c: Commerce) =>
        avecPin(async (a) => {
          await api.majCommerce(c.id, a, {
            nom: c.nom,
            type: c.type,
            logo: c.logo ?? '',
            lienGoogle: c.lienGoogle,
            coordonnees: c.coordonnees ?? '',
            recompense: c.recompense,
            seuilTampons: c.seuilTampons,
            lots: c.lots,
            reglesReponseAuto: c.reglesReponseAuto,
            ...(c.eurosParPoint !== undefined ? { eurosParPoint: c.eurosParPoint } : {}),
            ...(c.catalogue ? { catalogue: c.catalogue } : {}),
            ...(c.messagesAuto ? { messagesAuto: c.messagesAuto } : {}),
            ...(c.apparence ? { apparence: c.apparence } : {}),
            ...(c.programme ? { programme: c.programme } : {}),
          })
        }),
      creerCommerce: (n: NouveauCommerce) =>
        avecPin(async (a) => {
          if (a.role !== 'admin') throw new Error('Seul l’admin peut créer un commerce.')
          const c = await api.creerCommerce(a, { nom: n.nom, type: n.type, lienGoogle: n.lienGoogle, pin: n.pin ?? '' })
          actifRef.current = c.id
          return c
        }),
      basculerActif: (id: string) =>
        avecPin(async (a) => {
          const c = etat.commerces.find((x) => x.id === id)
          if (c) await api.majCommerce(id, a, { actif: !c.actif })
        }),
      changerPin: (commerceId: string, pin: string) => avecPin((a) => api.majPin(commerceId, a, pin).then(() => undefined)),
      reinitialiserDemo: () => {},
      inscrireClient: (commerceId: string, prenom: string, contactSaisi: string) =>
        avecPin((a) => api.inscrire(commerceId, a, prenom, contactSaisi)),
      validerVisite: (clientId: string) => avecPin((a) => api.visite(commerceDe(clientId), a, clientId).then(() => undefined)),
      offrirRecompense: (clientId: string) => avecPin((a) => api.recompense(commerceDe(clientId), a, clientId).then(() => undefined)),
      enregistrerTirage: () => {
        throw new Error('En mode serveur, le tirage est fait par le serveur.')
      },
      ajouterAvis: (commerceId: string, avis: { auteur: string; note: number; texte: string }) =>
        avecPin((a) => api.ajouterAvis(commerceId, a, avis).then(() => undefined)),
      majAvis: (avis: Avis, maj: { reponse?: string; brouillon?: string | null }) =>
        avecPin((a) => api.majAvis(avis.commerceId, a, avis.id, maj).then(() => undefined)),
      // PATCH sans champ : le serveur réapplique les règles aux avis en attente.
      appliquerReglesAvis: (commerceId: string) => avecPin((a) => api.majCommerce(commerceId, a, {}).then(() => undefined)),
      exporterCsv: async (commerceId: string) => {
        const a = accesRef.current
        if (!a) throw new Error('Déverrouillez d’abord avec votre PIN.')
        return { nom: nomFichierCsv(commerceId), contenu: await api.exportCsv(commerceId, a) }
      },
      avecPin: <T,>(f: (a: Acces, api: ClientApi) => Promise<T>) => avecPin((a) => f(a, api)),
    }),
    [api, avecPin, commerceDe, depot, deverrouiller, etat.commerces, recharger, relireAcces, verrouiller],
  )

  const commerce = (etat.commerces.find((c) => c.id === etat.commerceActifId) ?? etat.commerces[0]) as Commerce

  const valeur = useMemo<Store>(
    () => ({
      mode: 'api',
      etat,
      commerce,
      estDemo: !!commerce?.demo,
      connexion,
      derniereSynchro,
      erreurConnexion,
      verrouillage,
      acces,
      accesPret,
      api,
      ...actions,
    }),
    [etat, commerce, connexion, derniereSynchro, erreurConnexion, verrouillage, acces, accesPret, api, actions],
  )
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>
}

// ---------------------------------------------------------------------------------------------

export function useStore(): Store {
  const s = useContext(Contexte)
  if (!s) throw new Error('useStore doit être utilisé dans <FournisseurStore>')
  return s
}

/** Données du commerce actif uniquement. */
export function useDonneesCommerce() {
  const { etat, commerce } = useStore()
  return useMemo(
    () => ({
      commerce,
      clients: etat.clients.filter((c) => c.commerceId === commerce.id),
      tirages: etat.tirages.filter((t) => t.commerceId === commerce.id).sort((a, b) => b.date.localeCompare(a.date)),
      avis: etat.avis.filter((a) => a.commerceId === commerce.id).sort((a, b) => b.date.localeCompare(a.date)),
      membres: (etat.membres ?? []).filter((m) => m.commerceId === commerce.id),
      journal: (etat.journal ?? []).filter((j) => j.commerceId === commerce.id).sort((a, b) => b.date.localeCompare(a.date)),
    }),
    [etat, commerce],
  )
}

/**
 * Exécute une action et garde son état pour l'affichage : en cours, erreur en français.
 * `ok: false` si l'action a échoué : ne jamais afficher de succès dans ce cas.
 */
export function useAction() {
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const executer = useCallback(async <T,>(f: () => Promise<T>): Promise<{ ok: true; valeur: T } | { ok: false; valeur?: undefined }> => {
    setEnCours(true)
    setErreur(null)
    try {
      return { ok: true, valeur: await f() }
    } catch (e) {
      setErreur(messageErreur(e))
      return { ok: false }
    } finally {
      setEnCours(false)
    }
  }, [])
  return { executer, enCours, erreur, effacerErreur: useCallback(() => setErreur(null), []) }
}

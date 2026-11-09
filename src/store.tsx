import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Avis, Client, Commerce, Etat, Tirage } from './types'
import { depotLocal, type Depot } from './data/depot'
import { nouveauClient, offrirRecompense, trouverClientParContact, validerVisite, type Contact } from './lib/fidelite'
import { appliquerRegles } from './lib/avis'

interface Store {
  etat: Etat
  commerce: Commerce
  choisirCommerce(id: string): void
  majCommerce(commerce: Commerce): void
  ajouterCommerce(commerce: Commerce): void
  basculerActif(id: string): void
  reinitialiserDemo(): void
  /** Inscrit un client, ou retrouve celui qui a déjà ce téléphone / e-mail dans ce commerce. */
  inscrireClient(commerceId: string, prenom: string, contact: Contact): { client: Client; existant: boolean }
  validerVisite(clientId: string): void
  offrirRecompense(clientId: string): void
  enregistrerTirage(tirage: Tirage): void
  /** Ajoute un avis (démo) en appliquant aussitôt les règles automatiques du commerce. */
  ajouterAvis(avis: Avis): void
  majAvis(avis: Avis): void
  /** Applique les règles automatiques aux avis sans réponse du commerce. */
  appliquerReglesAvis(commerceId: string): void
}

const Contexte = createContext<Store | null>(null)

/** Réapplique les règles : seuls les avis sans réponse NI brouillon changent (cf. `appliquerRegles`). */
function avecReglesAppliquees(e: Etat, commerceId: string): Etat {
  const commerce = e.commerces.find((c) => c.id === commerceId)
  if (!commerce) return e
  return { ...e, avis: e.avis.map((a) => (a.commerceId === commerceId ? appliquerRegles(a, commerce) : a)) }
}

export function FournisseurStore({ children, depot = depotLocal }: { children: ReactNode; depot?: Depot }) {
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

  const choisirCommerce = useCallback((id: string) => setEtat((e) => ({ ...e, commerceActifId: id })), [])
  // Enregistrer les réglages applique aussitôt les règles de réponse automatique aux avis en attente.
  const majCommerce = useCallback(
    (commerce: Commerce) =>
      setEtat((e) => avecReglesAppliquees({ ...e, commerces: e.commerces.map((c) => (c.id === commerce.id ? commerce : c)) }, commerce.id)),
    [],
  )
  const ajouterCommerce = useCallback(
    (commerce: Commerce) => setEtat((e) => ({ ...e, commerces: [...e.commerces, commerce], commerceActifId: commerce.id })),
    [],
  )
  const basculerActif = useCallback(
    (id: string) => setEtat((e) => ({ ...e, commerces: e.commerces.map((c) => (c.id === id ? { ...c, actif: !c.actif } : c)) })),
    [],
  )
  const reinitialiserDemo = useCallback(() => setEtat(depot.reinitialiser()), [depot])

  const inscrireClient = useCallback(
    (commerceId: string, prenom: string, contact: Contact) => {
      const existant = trouverClientParContact(etat.clients, commerceId, contact)
      if (existant) return { client: existant, existant: true }
      const client = nouveauClient(commerceId, prenom, contact)
      setEtat((e) => ({ ...e, clients: [...e.clients, client] }))
      return { client, existant: false }
    },
    [etat.clients],
  )

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
  const validerVisiteClient = useCallback((clientId: string) => majClient(clientId, (c, co) => validerVisite(c, co)), [majClient])
  const offrirRecompenseClient = useCallback((clientId: string) => majClient(clientId, (c, co) => offrirRecompense(c, co)), [majClient])

  const enregistrerTirage = useCallback((tirage: Tirage) => setEtat((e) => ({ ...e, tirages: [tirage, ...e.tirages] })), [])

  const ajouterAvis = useCallback(
    (avis: Avis) =>
      setEtat((e) => {
        const commerce = e.commerces.find((c) => c.id === avis.commerceId)
        return { ...e, avis: [commerce ? appliquerRegles(avis, commerce) : avis, ...e.avis] }
      }),
    [],
  )
  const majAvis = useCallback((avis: Avis) => setEtat((e) => ({ ...e, avis: e.avis.map((a) => (a.id === avis.id ? avis : a)) })), [])
  const appliquerReglesAvis = useCallback((commerceId: string) => setEtat((e) => avecReglesAppliquees(e, commerceId)), [])

  const commerce = etat.commerces.find((c) => c.id === etat.commerceActifId) ?? etat.commerces[0]

  const valeur = useMemo(
    () => ({
      etat,
      commerce,
      choisirCommerce,
      majCommerce,
      ajouterCommerce,
      basculerActif,
      reinitialiserDemo,
      inscrireClient,
      validerVisite: validerVisiteClient,
      offrirRecompense: offrirRecompenseClient,
      enregistrerTirage,
      ajouterAvis,
      majAvis,
      appliquerReglesAvis,
    }),
    [
      etat,
      commerce,
      choisirCommerce,
      majCommerce,
      ajouterCommerce,
      basculerActif,
      reinitialiserDemo,
      inscrireClient,
      validerVisiteClient,
      offrirRecompenseClient,
      enregistrerTirage,
      ajouterAvis,
      majAvis,
      appliquerReglesAvis,
    ],
  )
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>
}

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
    }),
    [etat, commerce],
  )
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Commerce, Etat } from './types'
import { depotLocal, type Depot } from './data/depot'

interface Store {
  etat: Etat
  commerce: Commerce
  choisirCommerce(id: string): void
  majCommerce(commerce: Commerce): void
  ajouterCommerce(commerce: Commerce): void
  basculerActif(id: string): void
  reinitialiserDemo(): void
}

const Contexte = createContext<Store | null>(null)

export function FournisseurStore({ children, depot = depotLocal }: { children: ReactNode; depot?: Depot }) {
  const [etat, setEtat] = useState<Etat>(() => depot.charger())

  useEffect(() => {
    depot.enregistrer(etat)
  }, [depot, etat])

  const choisirCommerce = useCallback((id: string) => setEtat((e) => ({ ...e, commerceActifId: id })), [])
  const majCommerce = useCallback(
    (commerce: Commerce) => setEtat((e) => ({ ...e, commerces: e.commerces.map((c) => (c.id === commerce.id ? commerce : c)) })),
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

  const commerce = etat.commerces.find((c) => c.id === etat.commerceActifId) ?? etat.commerces[0]

  const valeur = useMemo(
    () => ({ etat, commerce, choisirCommerce, majCommerce, ajouterCommerce, basculerActif, reinitialiserDemo }),
    [etat, commerce, choisirCommerce, majCommerce, ajouterCommerce, basculerActif, reinitialiserDemo],
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

import { useEffect, useState } from 'react'

// Routeur minimal par hash (#/clients) : fonctionne sur n'importe quel hébergement
// statique, et le bouton « retour » du téléphone marche.
export type Page = 'accueil' | 'clients' | 'roulette' | 'avis' | 'reglages' | 'offre' | 'admin' | 'plus'

const PAGES: Page[] = ['accueil', 'clients', 'roulette', 'avis', 'reglages', 'offre', 'admin', 'plus']

function lirePage(): Page {
  const p = window.location.hash.replace(/^#\/?/, '') as Page
  return PAGES.includes(p) ? p : 'accueil'
}

export function aller(page: Page) {
  window.location.hash = `/${page}`
}

export function usePage(): Page {
  const [page, setPage] = useState<Page>(lirePage)
  useEffect(() => {
    const surChangement = () => {
      setPage(lirePage())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', surChangement)
    return () => window.removeEventListener('hashchange', surChangement)
  }, [])
  return page
}

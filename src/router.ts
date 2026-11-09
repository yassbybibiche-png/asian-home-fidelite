import { useEffect, useState } from 'react'

// Routeur minimal par hash (#/clients, #/client/<id>, #/jouer/<commerceId>) :
// fonctionne sur n'importe quel hébergement statique, et le bouton « retour » du téléphone marche.
export type Page = 'accueil' | 'clients' | 'client' | 'roulette' | 'qr' | 'avis' | 'reglages' | 'offre' | 'admin' | 'plus' | 'jouer' | 'carte'

const PAGES: Page[] = ['accueil', 'clients', 'client', 'roulette', 'qr', 'avis', 'reglages', 'offre', 'admin', 'plus', 'jouer', 'carte']

/** Pages publiques côté client final : pas d'en-tête ni de navigation commerçant. */
export const PAGES_PUBLIQUES: Page[] = ['jouer', 'carte']

export interface Route {
  page: Page
  /** Identifiant passé dans l'URL (client ou commerce). */
  param?: string
}

function lireRoute(): Route {
  const [p, param] = window.location.hash.replace(/^#\/?/, '').split('/')
  const page = p as Page
  return PAGES.includes(page) ? { page, param: param ? decodeURIComponent(param) : undefined } : { page: 'accueil' }
}

export function aller(page: Page, param?: string) {
  window.location.hash = param ? `/${page}/${encodeURIComponent(param)}` : `/${page}`
}

/** URL absolue d'une page (pour les QR codes). */
export function urlAbsolue(page: Page, param: string): string {
  return `${window.location.origin}${window.location.pathname}#/${page}/${encodeURIComponent(param)}`
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(lireRoute)
  useEffect(() => {
    const surChangement = () => {
      setRoute(lireRoute())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', surChangement)
    return () => window.removeEventListener('hashchange', surChangement)
  }, [])
  return route
}

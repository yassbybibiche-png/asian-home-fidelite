import { useEffect, useState } from 'react'

// Routeur minimal par hash (#/clients, #/client/<id>, #/jouer/<commerceId>) :
// fonctionne sur n'importe quel hébergement statique, et le bouton « retour » du téléphone marche.
export type Page =
  | 'accueil'
  | 'clients'
  | 'client'
  | 'roulette'
  | 'qr'
  | 'avis'
  | 'reglages'
  | 'offre'
  | 'admin'
  | 'plus'
  | 'jouer'
  | 'carte'
  | 'caisse'
  | 'menu'
  | 'equipe'
  | 'messages'
  | 'menuCarte'
  | 'desinscription'
  | 'confidentialite'
  | 'reglement'
  | 'bienvenue'
  | 'commande'
  | 'cuisine'

const PAGES: Page[] = [
  'accueil',
  'clients',
  'client',
  'roulette',
  'qr',
  'avis',
  'reglages',
  'offre',
  'admin',
  'plus',
  'jouer',
  'carte',
  'caisse',
  'menu',
  'equipe',
  'messages',
  'menuCarte',
  'desinscription',
  'confidentialite',
  'reglement',
  'bienvenue',
  'commande',
  'cuisine',
]

/**
 * Pages sans en-tête ni navigation commerçant : pages du client final (jeu, carte, menu, désinscription des relances,
 * politique de confidentialité, règlement du jeu, accueil #/bienvenue et commande à table #/commande/<id>/<jetonTable>)
 * et la caisse (tablette du comptoir, déverrouillée par le code équipe et non par le PIN du gérant).
 */
export const PAGES_PUBLIQUES: Page[] = ['jouer', 'carte', 'menu', 'caisse', 'desinscription', 'confidentialite', 'reglement', 'bienvenue', 'commande']

export interface Route {
  page: Page
  /** Identifiant passé dans l'URL (client ou commerce). */
  param?: string
  /** Second segment (#/desinscription/<clientId>/<jeton>, #/commande/<commerceId>/<jetonTable>). */
  param2?: string
}

export function lireRoute(hash = window.location.hash): Route {
  const [p, param, param2] = hash.replace(/^#\/?/, '').split('/')
  const page = p as Page
  return PAGES.includes(page)
    ? { page, param: param ? decodeURIComponent(param) : undefined, ...(param2 ? { param2: decodeURIComponent(param2) } : {}) }
    : { page: 'accueil' }
}

export function aller(page: Page, param?: string) {
  window.location.hash = param ? `/${page}/${encodeURIComponent(param)}` : `/${page}`
}

/** URL absolue d'une page (pour les QR codes). */
export function urlAbsolue(page: Page, param: string): string {
  return `${window.location.origin}${window.location.pathname}#/${page}/${encodeURIComponent(param)}`
}

/**
 * URL du QR vitrine (page de jeu) : redirection courte `/r/<commerceId>` (P2-Q3) — le serveur compte le scan puis
 * renvoie vers `#/jouer/<id>`. Le scan est donc compté même si la page ne se charge jamais (réseau coupé, serveur
 * endormi). En développement local (Vite, sans serveur), `/r/` n'existe pas : le QR s'imprime depuis l'adresse
 * publique définitive, comme l'indique la page QR vitrine.
 */
export function urlQrJeu(commerceId: string): string {
  return `${window.location.origin}/r/${encodeURIComponent(commerceId)}`
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

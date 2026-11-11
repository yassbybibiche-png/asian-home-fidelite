import { Component, Suspense, lazy, useEffect, type ComponentType, type ReactNode } from 'react'
import { useStore } from './store'
import { aller, useRoute, PAGES_PUBLIQUES, type Page } from './router'
import { BadgeDemo, Icone, LogoCommerce } from './components/ui'
import { useDepasse, Verrou } from './components/Verrou'
import { DELAI_ACCES_MS } from './lib/connexion'
import { Bloc, Squelette, SqueletteCommercant, SqueletteMenu } from './components/Squelette'
import { useLangue } from './components/Langue'
import { NOM_APP, libelleType } from './data/defaults'
// Chargées tout de suite (P2-Q2) : le parcours client après un scan de QR (#/jouer, #/carte) et la caisse, qui doit
// s'ouvrir hors ligne sans dépendre d'un fichier pas encore en cache.
import Jouer from './pages/Jouer'
import CartePublique from './pages/CartePublique'
import Caisse from './pages/Caisse'

// Chargées à la demande (P2-Q2) : back-office et pages publiques secondaires, chacune dans son propre fichier.
// Les fonctions d'import servent aussi au préchargement des pages commerçant (voir `prechargerPagesCommercant`).
const IMPORTS = {
  accueil: () => import('./pages/TableauDeBord'),
  clients: () => import('./pages/Clients'),
  roulette: () => import('./pages/Roulette'),
  avis: () => import('./pages/Avis'),
  reglages: () => import('./pages/Reglages'),
  offre: () => import('./pages/Offre'),
  admin: () => import('./pages/Admin'),
  plus: () => import('./pages/Plus'),
  client: () => import('./pages/FicheClient'),
  qr: () => import('./pages/QrVitrine'),
  menu: () => import('./pages/MenuPublic'),
  equipe: () => import('./pages/Equipe'),
  messages: () => import('./pages/Messages'),
  menuCarte: () => import('./pages/MenuCarte'),
  desinscription: () => import('./pages/Desinscription'),
  confidentialite: () => import('./pages/Confidentialite'),
} satisfies Partial<Record<Page, () => Promise<{ default: ComponentType }>>>

const TableauDeBord = lazy(IMPORTS.accueil)
const Clients = lazy(IMPORTS.clients)
const Roulette = lazy(IMPORTS.roulette)
const AvisPage = lazy(IMPORTS.avis)
const Reglages = lazy(IMPORTS.reglages)
const Offre = lazy(IMPORTS.offre)
const Admin = lazy(IMPORTS.admin)
const Plus = lazy(IMPORTS.plus)
const FicheClient = lazy(IMPORTS.client)
const QrVitrine = lazy(IMPORTS.qr)
const MenuPublic = lazy(IMPORTS.menu)
const Equipe = lazy(IMPORTS.equipe)
const Messages = lazy(IMPORTS.messages)
const MenuCarte = lazy(IMPORTS.menuCarte)
const Desinscription = lazy(IMPORTS.desinscription)
const Confidentialite = lazy(IMPORTS.confidentialite)

const PAGES_PUBLIQUES_DIFFEREES: Page[] = ['menu', 'desinscription', 'confidentialite']

/**
 * Pages client à corps sombres (P1-D2, AUDIT.md §6.2/§6.3) : fond noir, surfaces sombres
 * (règles `.page-client`, `src/index.css`, correspondances `src/theme.ts` PAGE_CLIENT_SOMBRE).
 * #/roulette n'en fait PAS partie : c'est une page commerçant (configuration de la roue), elle
 * reste claire — comme la caisse (#/caisse, pourtant publique, car utilisée au comptoir) et les
 * pages de texte (#/desinscription, #/confidentialite, lecture longue sur fond clair).
 */
const PAGES_CLIENT_SOMBRES: Page[] = ['jouer', 'carte', 'menu']

/**
 * Une fois l'espace commerçant ouvert, les autres pages du back-office sont téléchargées en arrière-plan (navigateur
 * au repos) : le service worker les garde en cache, la navigation reste immédiate et marche ensuite sans réseau.
 * Jamais sur les pages clientes : un client qui scanne un QR ne télécharge pas le back-office.
 */
function prechargerPagesCommercant() {
  const lancer = () => {
    for (const [page, importer] of Object.entries(IMPORTS)) {
      if (!PAGES_PUBLIQUES_DIFFEREES.includes(page as Page)) importer().catch(() => {})
    }
  }
  if ('requestIdleCallback' in window) window.requestIdleCallback(lancer, { timeout: 5000 })
  else setTimeout(lancer, 2000)
}

/** En attendant le fichier d'une page du back-office : quelques cartes grisées (l'en-tête reste affiché). */
function SquelettePage() {
  return (
    <Squelette libelle="Chargement de la page…" className="space-y-4">
      <Bloc className="h-8 w-1/2 rounded-lg" />
      <Bloc className="h-28 w-full rounded-2xl" />
      <Bloc className="h-28 w-full rounded-2xl" />
    </Squelette>
  )
}

/** Pages publiques différées : squelette du menu pour #/menu, forme simple pour les pages de texte. */
function SquelettePublique({ page }: { page: Page }) {
  const { t } = useLangue()
  if (page === 'menu') return <SqueletteMenu libelle={t('Un instant, le menu arrive.')} />
  return (
    <Squelette libelle="Chargement de la page…" className="mx-auto max-w-md space-y-4 px-4 pt-6 pb-10">
      <Bloc className="h-8 w-2/3 rounded-lg" />
      <Bloc className="h-32 w-full rounded-2xl" />
    </Squelette>
  )
}

/**
 * Fichier d'une page introuvable (hors ligne avant toute visite, ou ancien onglet après un déploiement : les anciens
 * fichiers n'existent plus) : message et bouton pour recharger, au lieu d'un écran blanc.
 */
class ErreurChargementPage extends Component<{ children: ReactNode }, { erreur: boolean }> {
  state = { erreur: false }
  static getDerivedStateFromError() {
    return { erreur: true }
  }
  render() {
    if (!this.state.erreur) return this.props.children
    return (
      <div className="mx-auto max-w-md space-y-4 px-4 py-10 text-center" role="alert">
        <p className="text-gray-700">Cette page n’a pas pu être chargée. Vérifiez la connexion puis rechargez.</p>
        <button type="button" className="bouton w-full" onClick={() => window.location.reload()}>
          Recharger
        </button>
      </div>
    )
  }
}

const ONGLETS: { page: Page; libelle: string }[] = [
  { page: 'accueil', libelle: 'Tableau de bord' },
  { page: 'clients', libelle: 'Clients' },
  { page: 'roulette', libelle: 'Roulette' },
  { page: 'avis', libelle: 'Avis' },
  { page: 'messages', libelle: 'Messages' },
  { page: 'menuCarte', libelle: 'Menu' },
  { page: 'equipe', libelle: 'Équipe' },
  { page: 'reglages', libelle: 'Réglages' },
  { page: 'offre', libelle: 'Offre' },
  { page: 'admin', libelle: 'Admin' },
]

// Sur téléphone, 5 entrées max en bas d'écran ; le reste passe par « Plus ».
const ONGLETS_MOBILE: { page: Page; libelle: string }[] = [
  { page: 'accueil', libelle: 'Accueil' },
  { page: 'clients', libelle: 'Clients' },
  { page: 'roulette', libelle: 'Roulette' },
  { page: 'avis', libelle: 'Avis' },
  { page: 'plus', libelle: 'Plus' },
]
const PAGES_SOUS_PLUS: Page[] = ['plus', 'reglages', 'offre', 'admin', 'equipe', 'messages', 'menuCarte']

const COMPOSANTS: Record<Page, ComponentType> = {
  accueil: TableauDeBord,
  clients: Clients,
  roulette: Roulette,
  avis: AvisPage,
  reglages: Reglages,
  offre: Offre,
  admin: Admin,
  plus: Plus,
  client: FicheClient,
  qr: QrVitrine,
  jouer: Jouer,
  carte: CartePublique,
  caisse: Caisse,
  menu: MenuPublic,
  equipe: Equipe,
  messages: Messages,
  menuCarte: MenuCarte,
  desinscription: Desinscription,
  confidentialite: Confidentialite,
}

/** Onglet surligné pour les sous-pages (fiche client → Clients, QR vitrine → Roulette). */
const ONGLET_PARENT: Partial<Record<Page, Page>> = { client: 'clients', qr: 'roulette' }

function SelecteurCommerce() {
  const { etat, commerce, choisirCommerce, mode, acces } = useStore()
  // Mode API avec le PIN d'un seul commerce : pas de liste (les autres commerces restent verrouillés).
  const choix = mode === 'local' || acces?.role === 'admin'
  return (
    <label className={`relative flex min-w-0 flex-1 items-center gap-3 rounded-xl py-1 pr-2 ${choix ? 'active:bg-white/10' : ''}`}>
      <LogoCommerce commerce={commerce} taille="sm" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-bold leading-tight text-white">{commerce.nom}</span>
          {mode === 'api' && commerce.demo && <BadgeDemo />}
        </span>
        <span className="block text-sm text-white/70">
          {libelleType(commerce.type)}
          {choix ? ' · changer de commerce ▾' : ''}
        </span>
      </span>
      {/* Select natif invisible par-dessus : 1 tap ouvre la liste système du téléphone. */}
      {choix && (
        <select
          aria-label="Commerce affiché"
          value={commerce.id}
          onChange={(e) => choisirCommerce(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          {etat.commerces.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nom}
              {c.actif ? '' : ' (inactif)'}
            </option>
          ))}
        </select>
      )}
    </label>
  )
}

const heure = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Bandeau d'état des données : démo locale, ou hors ligne (dernières données connues). */
function BandeauDonnees() {
  const { mode, connexion, derniereSynchro, recharger } = useStore()
  if (mode === 'local') {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
        <BadgeDemo /> Démo locale — données sur cet appareil seulement
      </p>
    )
  }
  if (connexion !== 'horsLigne') return null
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-gray-800 px-3 py-2 text-sm text-white" role="status">
      <span>
        <strong>Hors ligne</strong> — dernières données connues{derniereSynchro ? ` (${heure.format(new Date(derniereSynchro))})` : ''}. Serveur injoignable —
        vérifiez la connexion.
      </span>
      <button className="min-h-11 shrink-0 px-1 font-semibold underline" onClick={() => void recharger()}>
        Réessayer
      </button>
    </div>
  )
}

export default function App() {
  const { page } = useRoute()
  const { commerce, mode, acces, accesPret, verrouiller, relireAcces } = useStore()
  const Contenu = COMPOSANTS[page]
  // <html lang> suit la langue affichée : anglais possible sur les pages clientes seulement (P2-Q1).
  const { langue } = useLangue()
  useEffect(() => {
    document.documentElement.lang = langue
  }, [langue])
  const onglet = ONGLET_PARENT[page] ?? page
  // Filet de sécurité : la relecture de l'accès est déjà bornée (5 s), mais aucune attente ne doit dépasser 30 s sans issue.
  const accesLent = useDepasse(mode === 'api' && !accesPret, DELAI_ACCES_MS)
  const publique = PAGES_PUBLIQUES.includes(page)
  const espaceOuvert = !publique && (mode === 'local' || (accesPret && !!acces && !!commerce))
  useEffect(() => {
    if (espaceOuvert) prechargerPagesCommercant()
  }, [espaceOuvert])

  // Pages vues par le client final (QR code scanné) : ni en-tête ni navigation commerçant.
  // La bascule `.page-client` est sur <main>, autour de la frontière d'erreur : la vue
  // d'erreur de chargement (import différé en échec) reste sombre, elle aussi.
  if (publique) {
    return (
      <main className={PAGES_CLIENT_SOMBRES.includes(page) ? 'page-client' : 'min-h-dvh'}>
        <ErreurChargementPage key={page}>
          <Suspense fallback={<SquelettePublique page={page} />}>
            <Contenu />
          </Suspense>
        </ErreurChargementPage>
      </main>
    )
  }

  // Mode API : pages commerçant derrière le PIN.
  if (mode === 'api' && !accesPret && accesLent) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-4 py-10 text-center" role="alert">
        <p className="text-gray-700">L’ouverture de votre espace prend plus de 30 secondes. Vous pouvez réessayer ; si cela se répète, rechargez la page.</p>
        <button type="button" className="bouton w-full" onClick={() => void relireAcces()}>
          Réessayer
        </button>
      </div>
    )
  }
  if (mode === 'api' && !accesPret) return <SqueletteCommercant libelle="Chargement…" />
  if (mode === 'api' && (!acces || !commerce)) return <Verrou />

  return (
    <div className="min-h-dvh pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-8">
      <header className="hero-sombre sticky top-0 z-20 border-b border-white/10 shadow-[0_1px_8px_-4px_rgb(0_0_0/0.5)] print:hidden">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2">
          <SelecteurCommerce />
          <span className="titre-magenta hidden shrink-0 text-lg sm:block">{NOM_APP}</span>
          {mode === 'api' && (
            <button
              className="min-h-11 shrink-0 rounded-xl px-3 text-sm font-semibold text-white ring-1 ring-white/30 active:bg-white/10"
              onClick={() => void verrouiller()}
              title="Verrouiller / changer de commerce"
            >
              🔒 Verrouiller
            </button>
          )}
        </div>
        <nav className="mx-auto hidden max-w-5xl gap-1 overflow-x-auto px-3 md:flex" aria-label="Navigation principale">
          {ONGLETS.map((o) => (
            <a
              key={o.page}
              href={`#/${o.page}`}
              aria-current={onglet === o.page ? 'page' : undefined}
              className={`border-b-2 px-3 py-2.5 font-medium whitespace-nowrap transition-colors ${
                onglet === o.page ? 'border-magenta-400 text-magenta-300' : 'border-transparent text-white/70 hover:text-white'
              }`}
            >
              {o.libelle}
            </a>
          ))}
        </nav>
      </header>

      <div className="mx-auto max-w-5xl px-4 pt-3 empty:hidden print:hidden">
        <BandeauDonnees />
      </div>

      {!commerce.actif && (
        <div className="mx-auto max-w-5xl px-4 pt-3 print:hidden">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-gray-800 px-4 py-3 text-sm text-white">
            <span>Ce commerce est désactivé : son QR code et sa carte de fidélité ne sont plus accessibles aux clients.</span>
            <button className="min-h-11 shrink-0 px-1 font-semibold text-magenta-300 underline" onClick={() => aller('admin')}>
              Gérer
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4 py-5">
        <ErreurChargementPage key={page}>
          <Suspense fallback={<SquelettePage />}>
            <Contenu />
          </Suspense>
        </ErreurChargementPage>
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-gray-900/5 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_-8px_rgb(17_24_39/0.15)] backdrop-blur-md md:hidden print:hidden"
        aria-label="Navigation principale"
      >
        {ONGLETS_MOBILE.map((o) => {
          const actif = o.page === 'plus' ? PAGES_SOUS_PLUS.includes(page) : onglet === o.page
          return (
            <a
              key={o.page}
              href={`#/${o.page}`}
              className={`flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${actif ? 'text-magenta-700' : 'text-gray-600'}`}
              aria-current={actif ? 'page' : undefined}
            >
              <span className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors ${actif ? 'bg-magenta-500/10' : ''}`}>
                <Icone nom={o.page} />
              </span>
              {o.libelle}
            </a>
          )
        })}
      </nav>
    </div>
  )
}

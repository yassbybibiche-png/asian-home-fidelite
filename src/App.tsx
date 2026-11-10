import type { ComponentType } from 'react'
import { useStore } from './store'
import { aller, useRoute, PAGES_PUBLIQUES, type Page } from './router'
import { BadgeDemo, Icone, LogoCommerce } from './components/ui'
import { useDepasse, Verrou } from './components/Verrou'
import { DELAI_ACCES_MS } from './lib/connexion'
import { SqueletteCommercant } from './components/Squelette'
import { NOM_APP, libelleType } from './data/defaults'
import TableauDeBord from './pages/TableauDeBord'
import Clients from './pages/Clients'
import Roulette from './pages/Roulette'
import AvisPage from './pages/Avis'
import Reglages from './pages/Reglages'
import Offre from './pages/Offre'
import Admin from './pages/Admin'
import Plus from './pages/Plus'
import FicheClient from './pages/FicheClient'
import QrVitrine from './pages/QrVitrine'
import Jouer from './pages/Jouer'
import CartePublique from './pages/CartePublique'
import Caisse from './pages/Caisse'
import MenuPublic from './pages/MenuPublic'
import Equipe from './pages/Equipe'
import Messages from './pages/Messages'
import MenuCarte from './pages/MenuCarte'
import Desinscription from './pages/Desinscription'

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
        <span className="block text-xs text-white/70">
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
  const onglet = ONGLET_PARENT[page] ?? page
  // Filet de sécurité : la relecture de l'accès est déjà bornée (5 s), mais aucune attente ne doit dépasser 30 s sans issue.
  const accesLent = useDepasse(mode === 'api' && !accesPret, DELAI_ACCES_MS)

  // Pages vues par le client final (QR code scanné) : ni en-tête ni navigation commerçant.
  if (PAGES_PUBLIQUES.includes(page)) {
    return (
      <main className="min-h-dvh">
        <Contenu />
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
          <span className="titre-or hidden shrink-0 text-lg sm:block">{NOM_APP}</span>
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
                onglet === o.page ? 'border-or-400 text-or-300' : 'border-transparent text-white/70 hover:text-white'
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
            <button className="min-h-11 shrink-0 px-1 font-semibold text-marque-200 underline" onClick={() => aller('admin')}>
              Gérer
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4 py-5">
        <Contenu />
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
              className={`flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${actif ? 'text-marque-600' : 'text-gray-600'}`}
              aria-current={actif ? 'page' : undefined}
            >
              <span className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors ${actif ? 'bg-marque-50' : ''}`}>
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

import type { ComponentType } from 'react'
import { useStore } from './store'
import { aller, usePage, type Page } from './router'
import { Icone, LogoCommerce } from './components/ui'
import { libelleType } from './data/defaults'
import TableauDeBord from './pages/TableauDeBord'
import Clients from './pages/Clients'
import Roulette from './pages/Roulette'
import AvisPage from './pages/Avis'
import Reglages from './pages/Reglages'
import Offre from './pages/Offre'
import Admin from './pages/Admin'
import Plus from './pages/Plus'

const ONGLETS: { page: Page; libelle: string }[] = [
  { page: 'accueil', libelle: 'Tableau de bord' },
  { page: 'clients', libelle: 'Clients' },
  { page: 'roulette', libelle: 'Roulette' },
  { page: 'avis', libelle: 'Avis' },
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
const PAGES_SOUS_PLUS: Page[] = ['plus', 'reglages', 'offre', 'admin']

const COMPOSANTS: Record<Page, ComponentType> = {
  accueil: TableauDeBord,
  clients: Clients,
  roulette: Roulette,
  avis: AvisPage,
  reglages: Reglages,
  offre: Offre,
  admin: Admin,
  plus: Plus,
}

function SelecteurCommerce() {
  const { etat, commerce, choisirCommerce } = useStore()
  return (
    <label className="relative flex min-w-0 flex-1 items-center gap-3 rounded-xl py-1 pr-2 active:bg-gray-100">
      <LogoCommerce commerce={commerce} taille="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold leading-tight">{commerce.nom}</span>
        <span className="block text-xs text-gray-500">
          {libelleType(commerce.type)} · changer de commerce ▾
        </span>
      </span>
      {/* Select natif invisible par-dessus : 1 tap ouvre la liste système du téléphone. */}
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
    </label>
  )
}

export default function App() {
  const page = usePage()
  const { commerce } = useStore()
  const Contenu = COMPOSANTS[page]

  return (
    <div className="min-h-dvh pb-24 md:pb-8">
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2">
          <SelecteurCommerce />
          <span className="hidden shrink-0 text-lg font-extrabold text-marque-500 sm:block">Fideliz</span>
        </div>
        <nav className="mx-auto hidden max-w-5xl gap-1 overflow-x-auto px-3 md:flex" aria-label="Navigation principale">
          {ONGLETS.map((o) => (
            <a
              key={o.page}
              href={`#/${o.page}`}
              className={`border-b-2 px-3 py-2.5 font-medium whitespace-nowrap ${
                page === o.page ? 'border-marque-500 text-marque-600' : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {o.libelle}
            </a>
          ))}
        </nav>
      </header>

      {!commerce.actif && (
        <div className="mx-auto max-w-5xl px-4 pt-3">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-gray-800 px-4 py-3 text-sm text-white">
            <span>Ce commerce est désactivé : son QR code et sa carte de fidélité ne sont plus accessibles aux clients.</span>
            <button className="shrink-0 font-semibold text-marque-200 underline" onClick={() => aller('admin')}>
              Gérer
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4 py-5">
        <Contenu />
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="Navigation principale"
      >
        {ONGLETS_MOBILE.map((o) => {
          const actif = o.page === 'plus' ? PAGES_SOUS_PLUS.includes(page) : page === o.page
          return (
            <a
              key={o.page}
              href={`#/${o.page}`}
              className={`flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-medium ${actif ? 'text-marque-500' : 'text-gray-500'}`}
              aria-current={actif ? 'page' : undefined}
            >
              <Icone nom={o.page} />
              {o.libelle}
            </a>
          )
        })}
      </nav>
    </div>
  )
}

import { useStore } from '../store'
import type { Page } from '../router'
import { EnTete, Icone, LogoCommerce } from '../components/ui'
import { NOM_APP } from '../data/defaults'

const LIENS: { page: Page; titre: string; aide: string }[] = [
  { page: 'reglages', titre: 'Réglages', aide: 'Nom, logo, lien Google, récompense, lots, réponses auto' },
  { page: 'offre', titre: `L’offre ${NOM_APP}`, aide: 'Gratuit · kit de lancement (flyers, étiquettes QR, vitrine)' },
  { page: 'admin', titre: 'Admin', aide: 'Tous les commerces, ajout, activation, réinitialisation de la démo' },
]

const SIMULE = [
  'Les données sont stockées dans ce navigateur (localStorage) : aucun serveur.',
  'Les avis Google sont des exemples ; aucune réponse n’est publiée sur Google.',
  'Aucun SMS ni e-mail n’est envoyé ; Apple Wallet / Google Wallet sont simulés.',
  'Aucun paiement ni souscription réelle.',
  'Asian Home Paris : vraies coordonnées publiques, mais clients, avis et tirages fictifs.',
]

export default function Plus() {
  const { commerce } = useStore()

  return (
    <div className="space-y-5">
      <EnTete titre="Plus" />

      <section className="carte">
        <div className="flex items-center gap-3">
          <LogoCommerce commerce={commerce} />
          <div className="min-w-0">
            <h2 className="font-bold">QR code vitrine</h2>
            <p className="truncate text-sm text-gray-500">{commerce.nom}</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-gray-600">
          Le QR code à imprimer (étiquettes de table, adhésif vitrine) mène vers la roulette de ce commerce.
        </p>
        <a href="#/qr" className="bouton mt-3 w-full">
          Afficher le QR vitrine
        </a>
      </section>

      <nav className="carte divide-y divide-gray-100 py-1" aria-label="Autres pages">
        {LIENS.map((l) => (
          <a key={l.page} href={`#/${l.page}`} className="flex min-h-16 items-center gap-4 py-3 active:bg-gray-50">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-marque-50 text-marque-500">
              <Icone nom={l.page} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{l.titre}</span>
              <span className="block text-sm text-gray-500">{l.aide}</span>
            </span>
            <span className="text-gray-400" aria-hidden>
              ›
            </span>
          </a>
        ))}
      </nav>

      <section className="carte">
        <h2 className="font-bold">À propos de cette démo</h2>
        <p className="mt-1 text-sm text-gray-600">{NOM_APP} — fidélité, roulette et avis Google pour tous les commerces. Ce qui est simulé :</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600">
          {SIMULE.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}

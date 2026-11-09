import { BadgeDemo, EnTete } from '../components/ui'

const MISE_EN_PLACE = [
  { quantite: '2 500', libelle: 'flyers', detail: 'pour les sacs à emporter, la livraison ou le comptoir' },
  { quantite: '✓', libelle: 'étiquettes de table QR code', detail: 'le client scanne, joue et rejoint la carte de fidélité' },
  { quantite: '1', libelle: 'adhésif vitrine 100 × 70 cm', detail: 'visible depuis la rue, avec le QR code du commerce' },
]

const INCLUS = [
  'Carte de fidélité digitale (tampons, récompense, relance des clients inactifs)',
  'Roulette par QR code et invitation à laisser un avis Google',
  'Réponses aux avis Google (modèles prêts, réponse auto réglable)',
  'Tableau de bord : clients actifs, visites, avis, taux de retour',
]

export default function Offre() {
  return (
    <div className="space-y-5">
      <EnTete titre="L’offre Fideliz" sousTitre="Un seul produit, pour tous les commerces." action={<BadgeDemo />} />

      <section className="carte overflow-hidden p-0">
        <div className="bg-marque-500 px-5 py-6 text-white">
          <p className="text-sm font-semibold uppercase tracking-wide text-marque-100">Abonnement</p>
          <p className="mt-1">
            <span className="text-5xl font-extrabold">90 €</span>
            <span className="ml-1 text-lg font-semibold">TTC / mois</span>
          </p>
          <p className="mt-2 font-medium">Engagement 12 mois</p>
        </div>
        <ul className="space-y-3 px-5 py-4">
          {INCLUS.map((l) => (
            <li key={l} className="flex gap-3">
              <span className="font-bold text-marque-500" aria-hidden>
                ✓
              </span>
              <span>{l}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="carte">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold">Mise en place</h2>
          <p className="text-xl font-extrabold">
            500 € <span className="text-base font-semibold text-gray-600">TTC</span>
          </p>
        </div>
        <p className="mt-1 text-gray-600">Payée une seule fois, au démarrage. Elle comprend :</p>
        <ul className="mt-3 divide-y divide-gray-100">
          {MISE_EN_PLACE.map((m) => (
            <li key={m.libelle} className="flex items-center gap-4 py-3">
              <span className="flex h-12 min-w-12 shrink-0 items-center justify-center rounded-xl bg-marque-50 px-2 font-extrabold text-marque-600">
                {m.quantite}
              </span>
              <span>
                <span className="block font-semibold">{m.libelle.charAt(0).toUpperCase() + m.libelle.slice(1)}</span>
                <span className="block text-sm text-gray-500">{m.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="carte text-sm text-gray-600">
        <h2 className="mb-1 text-base font-bold text-gray-900">En résumé</h2>
        <p>
          Première année : 500 € + 12 × 90 € = <strong className="text-gray-900">1 580 € TTC</strong>.
        </p>
      </section>

      <p className="rounded-xl bg-amber-50 px-4 py-3 text-center font-semibold text-amber-800 ring-1 ring-amber-200">
        Démo — aucune souscription réelle
      </p>
    </div>
  )
}

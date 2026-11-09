import { useStore } from '../store'
import { BadgeDemo, BlocRgpd, EnTete } from '../components/ui'
import { NOM_APP } from '../data/defaults'

const KIT_LANCEMENT = [
  { quantite: '2 500', libelle: 'flyers', detail: 'pour les sacs à emporter, la livraison ou le comptoir' },
  { quantite: '✓', libelle: 'étiquettes de table QR code', detail: 'le client scanne, joue et rejoint la carte de fidélité' },
  { quantite: '1', libelle: 'adhésif vitrine 100 × 70 cm', detail: 'visible depuis la rue, avec le QR code du commerce' },
]

const INCLUS = [
  'Carte de fidélité digitale (tampons, récompense, liste des clients inactifs et message de relance à copier)',
  'Roulette par QR code et invitation à laisser un avis Google',
  'Aide aux réponses aux avis Google (modèles prêts, réponse auto réglable) — à copier sur Google ; connexion directe à Google à brancher',
  'Tableau de bord : clients actifs, visites, avis, taux de retour',
]

export default function Offre() {
  const { estDemo } = useStore()
  return (
    <div className="space-y-5">
      <EnTete titre={`L’offre ${NOM_APP}`} sousTitre="Un seul produit, pour tous les commerces." action={estDemo ? <BadgeDemo /> : undefined} />

      <section className="carte overflow-hidden p-0">
        <div className="bg-marque-500 px-5 py-6 text-white">
          <p className="text-sm font-semibold tracking-wide text-marque-100 uppercase">Abonnement</p>
          <p className="mt-1 text-5xl font-extrabold">Gratuit</p>
          <p className="mt-2 font-medium">Sans engagement, sans frais de mise en place</p>
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
        <h2 className="text-lg font-bold">Kit de lancement</h2>
        <p className="mt-1 text-gray-600">De quoi faire connaître la carte et la roulette dès le premier jour :</p>
        <ul className="mt-3 divide-y divide-gray-100">
          {KIT_LANCEMENT.map((m) => (
            <li key={m.libelle} className="flex items-center gap-4 py-3">
              <span className="flex h-12 min-w-12 shrink-0 items-center justify-center rounded-xl bg-marque-50 px-2 font-extrabold text-marque-600">
                {m.quantite}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{m.libelle.charAt(0).toUpperCase() + m.libelle.slice(1)}</span>
                <span className="block text-sm text-gray-500">{m.detail}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm text-gray-500">
          Le QR code à imprimer est généré par l’app (page « QR vitrine »). L’impression des supports n’est pas incluse dans l’app.
        </p>
      </section>

      <BlocRgpd />

      <p className="rounded-xl bg-amber-50 px-4 py-3 text-center font-semibold text-amber-800 ring-1 ring-amber-200">
        {estDemo ? 'Démo — ' : ''}Aucune souscription ni aucun paiement dans l’app
      </p>
    </div>
  )
}

import { useStore } from '../store'
import type { Page } from '../router'
import { BlocRgpd, EnTete, Icone, LogoCommerce } from '../components/ui'
import { NOM_APP } from '../data/defaults'

const LIENS: { page: Page; titre: string; aide: string }[] = [
  { page: 'equipe', titre: 'Équipe et caisse', aide: 'Membres, codes à 4 chiffres, lien de la caisse du comptoir' },
  { page: 'messages', titre: 'Messages', aide: 'Messages automatiques et ciblés, texte prêt à copier' },
  { page: 'menuCarte', titre: 'Menu', aide: 'Catégories, produits, prix, photos, allergènes, QR du menu' },
  { page: 'cuisine', titre: 'Cuisine', aide: 'Commandes à table du jour : accepter, préparer, servir' },
  { page: 'reglages', titre: 'Réglages', aide: 'Récompenses, points, messages auto, apparence de la carte, lots, avis' },
  { page: 'offre', titre: `L’offre ${NOM_APP}`, aide: 'Gratuit · kit de lancement (flyers, étiquettes QR, vitrine)' },
  { page: 'admin', titre: 'Admin', aide: 'Tous les commerces, ajout, activation, réinitialisation de la démo' },
]

const SIMULE_LOCAL = [
  'Les données sont stockées dans ce navigateur (localStorage) : aucun serveur.',
  'Les avis Google sont des exemples ; aucune réponse n’est publiée sur Google.',
  'Aucun SMS ni e-mail n’est envoyé ; Apple Wallet / Google Wallet : à brancher (aucun pass créé).',
  'Aucun paiement ni souscription réelle.',
  'Asian Home Paris : vraies coordonnées publiques, mais clients, avis et tirages fictifs.',
]

const SIMULE_API = [
  'Données partagées sur le serveur : le comptoir et le téléphone du client voient les mêmes cartes et tirages.',
  'Avis Google : pas de connexion à Google (à brancher) ; avis saisis à la main, aucune réponse n’est publiée sur Google.',
  'Messages ciblés : affichés dans l’espace client (sur sa carte) et à copier-coller, sans SMS ni e-mail.',
  'Relances SMS / e-mail : envoyées seulement si Brevo (SMS et e-mail) ou Twilio (SMS, en repli) est configuré sur le serveur et que le client a consenti ; sinon refusées, rien n’est envoyé (voir Messages).',
  'Caisse : fonctionne hors ligne sur l’appareil du comptoir ; les actions sont envoyées au retour du réseau, sans double comptage.',
  'Wallet : bientôt — Apple Wallet en suspens, Google Wallet sans compte émetteur ; aucun pass créé.',
  'Aucun paiement ni souscription réelle.',
]

export default function Plus() {
  const { commerce, mode, estDemo } = useStore()
  const simule = mode === 'local' ? SIMULE_LOCAL : estDemo ? [...SIMULE_API, 'Ce commerce est un commerce de démonstration : ses données sont fictives.'] : SIMULE_API

  return (
    <div className="space-y-5">
      <EnTete titre="Plus" />

      <section className="carte">
        <div className="flex items-center gap-3">
          <LogoCommerce commerce={commerce} />
          <div className="min-w-0">
            <h2 className="titre-carte">QR code vitrine</h2>
            <p className="truncate text-sm text-gray-600">{commerce.nom}</p>
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
        {LIENS.filter((l) => l.page !== 'cuisine' || commerce.commande?.active).map((l) => (
          <a key={l.page} href={`#/${l.page}`} className="-mx-2 flex min-h-16 items-center gap-4 rounded-xl px-2 py-3 transition-colors hover:bg-gray-50 active:bg-gray-100">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-magenta-500/10 text-magenta-600">
              <Icone nom={l.page} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{l.titre}</span>
              <span className="block text-sm text-gray-600">{l.aide}</span>
            </span>
            <span className="text-xl text-gray-600" aria-hidden>
              ›
            </span>
          </a>
        ))}
      </nav>

      <section className="carte">
        <h2 className="titre-carte">{mode === 'local' ? 'À propos de cette démo' : 'Ce qui est réel, ce qui ne l’est pas encore'}</h2>
        <p className="mt-1 text-sm text-gray-600">{NOM_APP} — fidélité, roulette et avis Google pour tous les commerces. {mode === 'local' ? 'Ce qui est simulé :' : 'En bref :'}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600">
          {simule.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      <BlocRgpd commerceId={commerce.id} />
    </div>
  )
}

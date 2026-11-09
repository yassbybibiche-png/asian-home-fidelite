import { useStore } from '../store'
import { useRoute } from '../router'
import { CarteFidelite } from '../components/CarteFidelite'
import { BadgeDemo, BoutonWallet } from '../components/ui'
import { MessagePublic } from './Jouer'

/** Page publique #/carte/<clientId> : la carte de fidélité sur le téléphone du client. */
export default function CartePublique() {
  const { param } = useRoute()
  const { etat } = useStore()
  const client = etat.clients.find((c) => c.id === param)
  const commerce = client && etat.commerces.find((c) => c.id === client.commerceId)

  if (!client || !commerce) return <MessagePublic titre="Carte introuvable">Ce lien ne correspond à aucune carte de fidélité.</MessagePublic>
  if (!commerce.actif) return <MessagePublic titre={commerce.nom}>La carte de fidélité de ce commerce n’est plus disponible.</MessagePublic>

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <CarteFidelite client={client} commerce={commerce} />
      <BoutonWallet />
      <a href={`#/jouer/${commerce.id}`} className="bouton-secondaire w-full">
        🎡 Tourner la roue du jour
      </a>
      {commerce.coordonnees && <p className="text-center text-sm text-gray-600">{commerce.coordonnees}</p>}
      <p className="text-center text-xs text-gray-500">
        <BadgeDemo>Démo</BadgeDemo> Données stockées dans ce navigateur uniquement.
      </p>
    </div>
  )
}

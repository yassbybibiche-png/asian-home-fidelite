import { useState } from 'react'
import { useStore } from '../store'
import { useRoute } from '../router'
import { ErreurApi } from '../data/api'
import { MessagePublic } from './Jouer'

/**
 * Page publique #/desinscription/<clientId>/<jeton> : lien en pied de chaque e-mail de relance (P1-B3).
 * Le consentement n'est retiré qu'au clic (un lien ouvert par un antivirus ou un aperçu de messagerie ne désinscrit pas).
 */
export default function Desinscription() {
  const { api } = useStore()
  const { param: clientId, param2: jeton } = useRoute()
  const [etat, setEtat] = useState<'pret' | 'enCours' | 'fait' | 'invalide' | 'erreur'>('pret')
  const [commerce, setCommerce] = useState('')

  if (!api) return <MessagePublic titre="Désinscription">La désinscription n’est possible que sur le site du commerce.</MessagePublic>
  if (!clientId || !jeton || etat === 'invalide') {
    return (
      <MessagePublic titre="Lien invalide">
        Ce lien de désinscription n’est pas valide. Vous pouvez aussi demander au commerce de retirer votre consentement, ou répondre STOP à un SMS.
      </MessagePublic>
    )
  }
  if (etat === 'fait') {
    return (
      <MessagePublic titre="C’est fait">
        Vous ne recevrez plus de relances par SMS ou e-mail{commerce ? ` de ${commerce}` : ''}. Votre carte de fidélité reste active.
      </MessagePublic>
    )
  }

  async function confirmer() {
    setEtat('enCours')
    try {
      const r = await api!.desinscrire(clientId!, jeton!)
      setCommerce(r.commerce)
      setEtat('fait')
    } catch (e) {
      setEtat(e instanceof ErreurApi && e.statut === 404 ? 'invalide' : 'erreur')
    }
  }

  return (
    <MessagePublic titre="Ne plus recevoir nos messages">
      <p>Vous ne recevrez plus de relances par SMS ni par e-mail. Votre carte de fidélité et vos tampons sont conservés.</p>
      {etat === 'erreur' && (
        <p className="mt-3 text-sm text-red-700" role="alert">
          Le serveur n’a pas répondu : rien n’a été modifié. Réessayez dans un instant.
        </p>
      )}
      <button className="bouton mt-4 w-full" disabled={etat === 'enCours'} onClick={() => void confirmer()}>
        {etat === 'enCours' ? 'Un instant…' : 'Me désinscrire'}
      </button>
    </MessagePublic>
  )
}

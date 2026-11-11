import { useState } from 'react'
import { useStore } from '../store'
import { useRoute } from '../router'
import { ErreurApi } from '../data/api'
import { enregistrerTraductions } from '../lib/langue'
import { useLangue } from '../components/Langue'
import { MessagePublic } from './Jouer'

/** Traductions de cette page différée : hors du dictionnaire initial (P2-Q1, bundle P2-Q2). */
enregistrerTraductions({
  'Désinscription': 'Unsubscribe',
  'Lien invalide': 'Invalid link',
  'C’est fait': 'Done',
  'Ne plus recevoir nos messages': 'Stop receiving our messages',
  'Vous ne recevrez plus de relances par SMS ni par e-mail. Votre carte de fidélité et vos tampons sont conservés.': 'You will no longer receive reminders by text or e-mail. Your loyalty card and stamps are kept.',
  'La désinscription n’est possible que sur le site du commerce.': 'Unsubscribing is only possible on the business’s website.',
  'Ce lien de désinscription n’est pas valide. Vous pouvez aussi demander au commerce de retirer votre consentement.': 'This unsubscribe link is not valid. You can also ask the business to withdraw your consent.',
  'Vous ne recevrez plus de relances par SMS ou e-mail{commerce}. Votre carte de fidélité reste active.': 'You will no longer receive reminders by text or e-mail{commerce}. Your loyalty card stays active.',
  'Le serveur n’a pas répondu : rien n’a été modifié. Réessayez dans un instant.': 'The server did not respond: nothing was changed. Try again in a moment.',
  'Me désinscrire': 'Unsubscribe me',
})

/**
 * Page publique #/desinscription/<clientId>/<jeton> : lien en pied de chaque e-mail de relance (P1-B3) et en fin de
 * chaque SMS de relance (P1-B9, lien court /d/… — « répondez STOP » est impossible avec l'expéditeur Brevo).
 * Le consentement n'est retiré qu'au clic (un lien ouvert par un antivirus ou un aperçu de messagerie ne désinscrit pas).
 */
export default function Desinscription() {
  const { api } = useStore()
  const { param: clientId, param2: jeton } = useRoute()
  const { langue, t } = useLangue()
  const [etat, setEtat] = useState<'pret' | 'enCours' | 'fait' | 'invalide' | 'erreur'>('pret')
  const [commerce, setCommerce] = useState('')

  if (!api) return <MessagePublic titre="Désinscription">La désinscription n’est possible que sur le site du commerce.</MessagePublic>
  if (!clientId || !jeton || etat === 'invalide') {
    return (
      <MessagePublic titre="Lien invalide">
        Ce lien de désinscription n’est pas valide. Vous pouvez aussi demander au commerce de retirer votre consentement.
      </MessagePublic>
    )
  }
  if (etat === 'fait') {
    return (
      <MessagePublic titre="C’est fait">
        {t('Vous ne recevrez plus de relances par SMS ou e-mail{commerce}. Votre carte de fidélité reste active.', {
          // Le nom du commerce est une donnée ; la préposition, elle, se traduit (« de » / « from »).
          commerce: commerce ? (langue === 'en' ? ` from ${commerce}` : ` de ${commerce}`) : '',
        })}
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
      <p>{t('Vous ne recevrez plus de relances par SMS ni par e-mail. Votre carte de fidélité et vos tampons sont conservés.')}</p>
      {etat === 'erreur' && (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {t('Le serveur n’a pas répondu : rien n’a été modifié. Réessayez dans un instant.')}
        </p>
      )}
      <button className="bouton mt-4 w-full" disabled={etat === 'enCours'} onClick={() => void confirmer()}>
        {etat === 'enCours' ? t('Un instant…') : t('Me désinscrire')}
      </button>
    </MessagePublic>
  )
}

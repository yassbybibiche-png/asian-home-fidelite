import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useStore } from '../store'
import { useRoute } from '../router'
import type { Client, Commerce } from '../types'
import { ErreurApi, type ClientApi } from '../data/api'
import { CarteFidelite } from '../components/CarteFidelite'
import { BadgeDemo, BoutonWallet } from '../components/ui'
import { HorsLignePublic, MessagePublic } from './Jouer'

/** Page publique #/carte/<clientId> : la carte de fidélité sur le téléphone du client. */
export default function CartePublique() {
  const { api } = useStore()
  return api ? <CarteApi api={api} /> : <CarteLocale />
}

function Carte({ client, commerce, demo, pied }: { client: Client; commerce: Commerce; demo: boolean; pied: ReactNode }) {
  if (!commerce.actif) return <MessagePublic titre={commerce.nom}>La carte de fidélité de ce commerce n’est plus disponible.</MessagePublic>
  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <CarteFidelite client={client} commerce={commerce} />
      <BoutonWallet demo={demo} />
      <a href={`#/jouer/${commerce.id}`} className="bouton-secondaire w-full">
        🎡 Tourner la roue du jour
      </a>
      {commerce.coordonnees && <p className="text-center text-sm text-gray-600">{commerce.coordonnees}</p>}
      <p className="text-center text-xs text-gray-500">{pied}</p>
    </div>
  )
}

function CarteLocale() {
  const { param } = useRoute()
  const { etat } = useStore()
  const client = etat.clients.find((c) => c.id === param)
  const commerce = client && etat.commerces.find((c) => c.id === client.commerceId)

  if (!client || !commerce) return <MessagePublic titre="Carte introuvable">Ce lien ne correspond à aucune carte de fidélité.</MessagePublic>
  return (
    <Carte
      client={client}
      commerce={commerce}
      demo
      pied={
        <>
          <BadgeDemo>Démo</BadgeDemo> Données stockées dans ce navigateur uniquement.
        </>
      }
    />
  )
}

/** Mode API : la carte vient du serveur (sans téléphone ni e-mail), rafraîchie au retour sur la page. */
function CarteApi({ api }: { api: ClientApi }) {
  const { param } = useRoute()
  const [donnees, setDonnees] = useState<{ client: Client; commerce: Commerce } | null>(null)
  const [erreur, setErreur] = useState<'introuvable' | 'inactif' | 'horsLigne' | null>(null)

  const charger = useCallback(() => {
    if (!param) return setErreur('introuvable')
    api.carte(param).then(
      (r) => {
        setDonnees({ client: r.client, commerce: r.commerce })
        setErreur(null)
      },
      (e) => setErreur(e instanceof ErreurApi && e.statut === 404 ? 'introuvable' : e instanceof ErreurApi && e.statut === 409 ? 'inactif' : 'horsLigne'),
    )
  }, [api, param])

  useEffect(() => {
    charger()
    const siVisible = () => document.visibilityState === 'visible' && charger()
    document.addEventListener('visibilitychange', siVisible)
    window.addEventListener('focus', siVisible)
    return () => {
      document.removeEventListener('visibilitychange', siVisible)
      window.removeEventListener('focus', siVisible)
    }
  }, [charger])

  if (erreur === 'introuvable') return <MessagePublic titre="Carte introuvable">Ce lien ne correspond à aucune carte de fidélité.</MessagePublic>
  if (erreur === 'inactif') return <MessagePublic titre="Carte indisponible">La carte de fidélité de ce commerce n’est plus disponible.</MessagePublic>
  // Hors ligne sans carte déjà affichée : message clair (une carte déjà affichée reste visible).
  if (erreur === 'horsLigne' && !donnees) return <HorsLignePublic onReessayer={charger} />
  if (!donnees) return <MessagePublic titre="Chargement…">Un instant, votre carte arrive.</MessagePublic>
  return (
    <Carte
      client={donnees.client}
      commerce={donnees.commerce}
      demo={!!donnees.commerce.demo}
      pied={
        <>
          {donnees.commerce.demo && <BadgeDemo>Démo</BadgeDemo>}
          {erreur === 'horsLigne' ? ' Hors ligne : carte affichée telle qu’au dernier chargement.' : ' Carte à jour.'}
        </>
      }
    />
  )
}

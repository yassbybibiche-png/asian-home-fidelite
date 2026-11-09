import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useStore } from '../store'
import { useRoute } from '../router'
import type { Client, Commerce, MessageClient } from '../types'
import { ErreurApi, type ClientApi } from '../data/api'
import { CarteFidelite } from '../components/CarteFidelite'
import { InvitationAvis } from '../components/InvitationAvis'
import { BadgeDemo, EncartWallet } from '../components/ui'
import { dateRelative } from '../lib/format'
import { estAsianHome, VISUELS } from '../lib/visuels'
import { HorsLignePublic, MessagePublic } from './Jouer'

/** Page publique #/carte/<clientId> : la carte de fidélité sur le téléphone du client. */
export default function CartePublique() {
  const { api } = useStore()
  return api ? <CarteApi api={api} /> : <CarteLocale />
}

/** Boîte de réception du client : messages automatiques et messages du commerce (les plus récents d'abord). */
function BoiteReception({ messages, commerce }: { messages: MessageClient[]; commerce: Commerce }) {
  if (!messages.length) return null
  const tries = [...messages].sort((a, b) => b.date.localeCompare(a.date))
  const nonLus = messages.filter((m) => !m.lu).length
  return (
    <section className="carte space-y-3" aria-label="Messages">
      <h2 className="titre-carte">
        Messages {nonLus > 0 && <span className="ml-1 rounded-full bg-marque-600 px-2 py-0.5 text-xs font-bold text-white">{nonLus} nouveau{nonLus > 1 ? 'x' : ''}</span>}
      </h2>
      <ul className="space-y-3">
        {tries.slice(0, 10).map((m) => (
          <li key={m.id} className={`rounded-xl p-3 ring-1 ${m.lu ? 'bg-gray-50 ring-gray-900/5' : 'bg-amber-50 ring-amber-200'}`}>
            <p className="text-gray-900">{m.texte}</p>
            <p className="mt-1 text-xs text-gray-600">
              {commerce.nom} · {dateRelative(m.date)}
            </p>
            {m.type === 'avis' && (
              <div className="mt-3">
                <InvitationAvis commerce={commerce} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Carte({ client, commerce, demo, pied, menu }: { client: Client; commerce: Commerce; demo: boolean; pied: ReactNode; menu?: boolean }) {
  if (!commerce.actif) return <MessagePublic titre={commerce.nom}>La carte de fidélité de ce commerce n’est plus disponible.</MessagePublic>
  return (
    <div className="mx-auto max-w-md space-y-4 px-4 pt-6 pb-10">
      {estAsianHome(commerce) && (
        <img
          src={VISUELS.tableSushis}
          alt="Table dressée chez Asian Home Paris : bao buns, plateau de sushis et cocktails"
          className="h-80 w-full rounded-3xl object-cover shadow-relief ring-1 ring-gray-900/5"
        />
      )}
      <CarteFidelite client={client} commerce={commerce} />
      <BoiteReception messages={client.messages ?? []} commerce={commerce} />
      <a href={`#/jouer/${commerce.id}`} className="bouton w-full">
        🎡 Tourner la roue du jour
      </a>
      {menu && (
        <a href={`#/menu/${commerce.id}`} className="bouton-secondaire w-full">
          📖 Voir le menu
        </a>
      )}
      {estAsianHome(commerce) && (
        <section className="carte space-y-3" aria-label="Le restaurant">
          <h2 className="titre-carte">Le restaurant</h2>
          <img
            src={VISUELS.interieur}
            alt="Salle d’Asian Home Paris : plafond d’ombrelles et tables dressées"
            loading="lazy"
            className="h-64 w-full rounded-2xl object-cover"
          />
          <p className="text-sm text-gray-700">Restaurant asiatique halal, au Pré-Saint-Gervais.</p>
        </section>
      )}
      <EncartWallet demo={demo} />
      {commerce.coordonnees && <p className="text-center text-sm text-gray-600">{commerce.coordonnees}</p>}
      <p className="text-center text-xs text-gray-600">{pied}</p>
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
  const [donnees, setDonnees] = useState<{ client: Client; commerce: Commerce; menu: boolean } | null>(null)
  const [erreur, setErreur] = useState<'introuvable' | 'inactif' | 'horsLigne' | null>(null)

  const charger = useCallback(() => {
    if (!param) return setErreur('introuvable')
    api.carte(param).then(
      (r) => {
        setDonnees({ client: r.client, commerce: r.commerce, menu: !!r.menuDisponible })
        setErreur(null)
        // Messages affichés = lus (le badge « nouveau » reste visible pendant cette ouverture).
        if (r.client.messages?.some((m) => !m.lu)) api.marquerLus(param).catch(() => {})
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
      menu={donnees.menu}
      pied={
        <>
          {donnees.commerce.demo && <BadgeDemo>Démo</BadgeDemo>}
          {erreur === 'horsLigne' ? ' Hors ligne : carte affichée telle qu’au dernier chargement.' : ' Carte à jour.'}
        </>
      }
    />
  )
}

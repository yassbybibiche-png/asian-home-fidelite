import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useStore } from '../store'
import { useRoute } from '../router'
import type { Client, Commerce, Tirage } from '../types'
import { analyserContact } from '../lib/fidelite'
import { estPerdant, lotsJouables, rotationCible, secteurs, tirageDuJour, tirerLot } from '../lib/roulette'
import { DUREE_ROTATION_MS, Roue } from '../components/Roue'
import { BadgeDemo, LogoCommerce } from '../components/ui'

export function MessagePublic({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">{titre}</h1>
      <p className="mt-3 text-gray-600">{children}</p>
    </div>
  )
}

// Ce téléphone se souvient du dernier profil utilisé (comme le ferait un cookie en production).
const cleJoueur = (commerceId: string) => `fidelite:joueur:${commerceId}`
function lireJoueurMemorise(commerceId: string): string | null {
  try {
    return localStorage.getItem(cleJoueur(commerceId))
  } catch {
    return null
  }
}
function memoriserJoueur(commerceId: string, clientId: string | null) {
  try {
    if (clientId) localStorage.setItem(cleJoueur(commerceId), clientId)
    else localStorage.removeItem(cleJoueur(commerceId))
  } catch {
    // Stockage indisponible : on redemandera le prénom la prochaine fois.
  }
}

/** Page publique #/jouer/<commerceId>, ouverte en scannant le QR vitrine. */
export default function Jouer() {
  const { param } = useRoute()
  const { etat } = useStore()
  const commerce = etat.commerces.find((c) => c.id === param)

  if (!commerce) return <MessagePublic titre="QR code inconnu">Ce QR code ne correspond à aucun commerce.</MessagePublic>
  if (!commerce.actif) return <MessagePublic titre={commerce.nom}>Le jeu de ce commerce n’est plus disponible.</MessagePublic>
  if (lotsJouables(commerce.lots).length === 0) return <MessagePublic titre={commerce.nom}>Aucun lot n’est configuré pour le moment.</MessagePublic>
  return <Partie key={commerce.id} commerce={commerce} />
}

type Etape = 'pret' | 'rotation' | 'resultat'

function Partie({ commerce }: { commerce: Commerce }) {
  const { etat, enregistrerTirage } = useStore()
  const [joueurId, setJoueurId] = useState<string | null>(null)
  const [memoriseId, setMemoriseId] = useState(() => lireJoueurMemorise(commerce.id))
  const [etape, setEtape] = useState<Etape>('pret')
  const [rotation, setRotation] = useState(0)
  const [gain, setGain] = useState<Tirage | null>(null)
  const minuterie = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(minuterie.current), [])

  const trouver = (id: string | null) => (id ? etat.clients.find((c) => c.id === id && c.commerceId === commerce.id) : undefined)
  const joueur = trouver(joueurId)
  const memorise = trouver(memoriseId)
  const dejaJoue = joueur && etape === 'pret' ? tirageDuJour(etat.tirages, commerce.id, joueur.id) : undefined

  function choisirJoueur(client: Client) {
    setJoueurId(client.id)
    memoriserJoueur(commerce.id, client.id)
  }

  function tourner() {
    if (!joueur || etape !== 'pret' || tirageDuJour(etat.tirages, commerce.id, joueur.id)) return
    const parts = secteurs(commerce.lots)
    const secteur = parts[tirerLot(commerce.lots)]
    const tirage: Tirage = {
      id: `ti-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      commerceId: commerce.id,
      clientId: joueur.id,
      lot: secteur.lot.libelle,
      date: new Date().toISOString(),
    }
    // Enregistré dès le lancement : recharger la page pendant l'animation ne permet pas de rejouer.
    enregistrerTirage(tirage)
    setGain(tirage)
    setRotation((r) => rotationCible(r, secteur))
    setEtape('rotation')
    minuterie.current = window.setTimeout(() => setEtape('resultat'), DUREE_ROTATION_MS + 200)
  }

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 py-6">
      <header className="flex items-center gap-3">
        <LogoCommerce commerce={commerce} />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{commerce.nom}</h1>
          <p className="text-sm text-gray-600">Tournez la roue et gagnez un cadeau !</p>
        </div>
      </header>

      {commerce.coordonnees && <p className="-mt-2 text-sm text-gray-500">{commerce.coordonnees}</p>}

      <Roue lots={commerce.lots} rotation={rotation} />

      {!joueur ? (
        memorise ? (
          <section className="carte space-y-2 text-center">
            <p className="text-lg">
              Re-bonjour <strong>{memorise.prenom}</strong> 👋
            </p>
            <button className="bouton w-full" onClick={() => choisirJoueur(memorise)}>
              Continuer en tant que {memorise.prenom}
            </button>
            <button
              className="min-h-11 w-full text-sm font-semibold text-gray-600 underline"
              onClick={() => (memoriserJoueur(commerce.id, null), setMemoriseId(null))}
            >
              Ce n’est pas moi
            </button>
          </section>
        ) : (
          <Identification commerce={commerce} onIdentifie={choisirJoueur} />
        )
      ) : etape === 'resultat' && gain ? (
        <Resultat lot={gain.lot} prenom={joueur.prenom} />
      ) : dejaJoue ? (
        <section className="carte text-center" role="status">
          <p className="text-lg font-bold">Vous avez déjà joué aujourd’hui, {joueur.prenom} !</p>
          <p className="mt-1 text-gray-600">
            Résultat du jour : <strong>{dejaJoue.lot}</strong>
          </p>
          <p className="mt-2 text-sm text-gray-500">1 tirage par personne et par jour. Revenez demain !</p>
        </section>
      ) : (
        <button className="bouton w-full py-4 text-lg" onClick={tourner} disabled={etape !== 'pret'}>
          {etape === 'rotation' ? 'La roue tourne…' : `🎡 Tourner la roue, ${joueur.prenom} !`}
        </button>
      )}

      {joueur && (etape === 'resultat' || dejaJoue) && (
        <>
          <InvitationAvis commerce={commerce} />
          <a href={`#/carte/${joueur.id}`} className="bouton-secondaire w-full">
            Voir ma carte de fidélité
          </a>
        </>
      )}

      <p className="text-center text-xs text-gray-500">
        <BadgeDemo>Démo</BadgeDemo> Données stockées dans ce navigateur uniquement. 1 tirage par personne et par jour.
      </p>
    </div>
  )
}

function Identification({ commerce, onIdentifie }: { commerce: Commerce; onIdentifie(client: Client): void }) {
  const { inscrireClient } = useStore()
  const [prenom, setPrenom] = useState('')
  const [contactSaisi, setContactSaisi] = useState('')
  const [essaye, setEssaye] = useState(false)
  const contact = analyserContact(contactSaisi)

  function envoyer(e: FormEvent) {
    e.preventDefault()
    setEssaye(true)
    if (!prenom.trim() || !contact) return
    onIdentifie(inscrireClient(commerce.id, prenom, contact).client)
  }

  return (
    <form onSubmit={envoyer} className="carte space-y-3">
      <p className="font-semibold">Pour jouer, dites-nous qui vous êtes :</p>
      <div>
        <label className="etiquette" htmlFor="j-prenom">
          Prénom
        </label>
        <input id="j-prenom" className="champ" autoComplete="given-name" value={prenom} onChange={(e) => setPrenom(e.target.value)} />
      </div>
      <div>
        <label className="etiquette" htmlFor="j-contact">
          Téléphone ou e-mail
        </label>
        <input
          id="j-contact"
          className="champ"
          inputMode="email"
          placeholder="06 12 34 56 78 ou marie@exemple.fr"
          value={contactSaisi}
          onChange={(e) => setContactSaisi(e.target.value)}
        />
        {essaye && !contact && <p className="mt-1 text-sm text-red-600">Saisissez un numéro (10 chiffres) ou un e-mail valide.</p>}
        <p className="mt-1 text-xs text-gray-500">Déjà client ? Le même numéro ou e-mail retrouve votre carte de fidélité.</p>
      </div>
      <button type="submit" className="bouton w-full" disabled={!prenom.trim() || !contactSaisi.trim()}>
        C’est parti
      </button>
    </form>
  )
}

function Resultat({ lot, prenom }: { lot: string; prenom: string }) {
  const perdu = estPerdant(lot)
  return (
    <section className={`carte text-center ${perdu ? '' : 'ring-2 ring-green-400'}`} role="status" aria-live="polite">
      <p className="text-4xl" aria-hidden>
        {perdu ? '🍀' : '🎉'}
      </p>
      <p className="mt-1 text-lg font-bold">{perdu ? `Pas cette fois, ${prenom}…` : `Bravo ${prenom}, vous avez gagné :`}</p>
      <p className="mt-1 text-2xl font-extrabold text-marque-600">{lot}</p>
      {!perdu && <p className="mt-2 text-sm text-gray-600">Montrez cet écran au comptoir pour profiter de votre lot.</p>}
    </section>
  )
}

/** Invitation à l'avis Google, toujours APRÈS le jeu et jamais en condition du lot. */
function InvitationAvis({ commerce }: { commerce: Commerce }) {
  return (
    <section className="carte space-y-2 text-center">
      <p className="font-semibold">Vous avez aimé votre passage ?</p>
      <p className="text-sm text-gray-600">Le lot n’est pas conditionné à l’avis — gagnez d’abord, avis libre ensuite.</p>
      {commerce.lienGoogle ? (
        <a href={commerce.lienGoogle} target="_blank" rel="noopener noreferrer" className="bouton-secondaire w-full">
          ⭐ Laisser un avis Google ↗
        </a>
      ) : (
        <p className="text-sm text-gray-500">(Le commerce n’a pas encore renseigné son lien Google.)</p>
      )}
    </section>
  )
}

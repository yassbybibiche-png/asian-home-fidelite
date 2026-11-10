import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useStore } from '../store'
import { useRoute } from '../router'
import type { Client, Commerce, CommercePublic, Tirage } from '../types'
import { analyserContact } from '../lib/fidelite'
import { estPerdant, jourEnClair, lotsJouables, peutJouer, rotationCible, secteurs, statutJeu, tirageDuJour, tirerLot } from '../lib/roulette'
import { ErreurApi, MESSAGE_HORS_LIGNE, type ClientApi, type ReponseCarte, type ResultatTirage } from '../data/api'
import { lancerTirage, memoireJoueur, type JoueurMemorise } from '../data/jeuApi'
import { DUREE_ROTATION_MS, LegendeRoue, Roue } from '../components/Roue'
import { InvitationAvis } from '../components/InvitationAvis'
import { SqueletteJeu } from '../components/Squelette'
import { BadgeDemo, BoutonCopier, LogoCommerce, MessageErreur } from '../components/ui'

export function MessagePublic({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="carte px-6 py-8 text-center">
        <h1 className="font-titre text-2xl font-bold">{titre}</h1>
        <div className="mt-3 text-gray-600">{children}</div>
      </div>
    </div>
  )
}

/** Serveur injoignable sur une page publique : message clair + nouvel essai, jamais de faux résultat. */
export function HorsLignePublic({ onReessayer }: { onReessayer(): void }) {
  return (
    <MessagePublic titre="Serveur injoignable">
      <p>{MESSAGE_HORS_LIGNE}</p>
      <button className="bouton mt-4 w-full" onClick={onReessayer}>
        Réessayer
      </button>
    </MessagePublic>
  )
}

/** Page publique #/jouer/<commerceId>, ouverte en scannant le QR vitrine. */
export default function Jouer() {
  const { api } = useStore()
  return api ? <JouerApi api={api} /> : <JouerLocal />
}

/** Démo locale : commerce complet ; mode API : fiche publique (libellés des lots sans probabilité). */
type CommerceJeu = Commerce | CommercePublic

function verifierCommerce(commerce: CommerceJeu): ReactNode {
  if (!commerce.actif) return <MessagePublic titre={commerce.nom}>Le jeu de ce commerce n’est plus disponible.</MessagePublic>
  if (lotsJouables(commerce.lots).length === 0) return <MessagePublic titre={commerce.nom}>Aucun lot n’est configuré pour le moment.</MessagePublic>
  return null
}

type Etape = 'pret' | 'rotation' | 'resultat'

/** En-tête + roue, communs aux deux modes. */
function Cadre({ commerce, rotation, children, pied }: { commerce: CommerceJeu; rotation: number; children: ReactNode; pied: ReactNode }) {
  return (
    <div className="mx-auto max-w-md space-y-5 px-4 pt-6 pb-10">
      <header className="hero-sombre -mx-4 rounded-b-3xl px-4 pt-6 pb-8 text-center shadow-relief">
        <div className="flex justify-center">
          <LogoCommerce commerce={commerce} taille="lg" />
        </div>
        <h1 className="titre-or mt-3 text-2xl">{commerce.nom}</h1>
        <p className="mt-1 font-semibold text-or-300">Tournez la roue et gagnez un cadeau !</p>
        {commerce.coordonnees && <p className="mt-1 text-sm text-white/70">{commerce.coordonnees}</p>}
      </header>

      <div className="hero-sombre -mx-1 rounded-3xl px-2 py-4 ring-1 ring-or-400/30">
        <Roue lots={commerce.lots} rotation={rotation} />
        <LegendeRoue lots={commerce.lots} />
      </div>

      {children}

      <p className="text-center text-xs text-gray-600">{pied}</p>
    </div>
  )
}

function MessageSansVisite({ prenom, lienCarte }: { prenom: string; lienCarte: string }) {
  return (
    <section className="carte space-y-3 text-center" role="status">
      <p className="titre-carte">Bonjour {prenom} !</p>
      <p className="text-gray-700">Pour jouer, validez d’abord votre visite du jour au comptoir.</p>
      <p className="text-sm text-gray-600">Présentez votre carte de fidélité en caisse : 1 visite validée = 1 participation.</p>
      <a href={lienCarte} className="bouton-secondaire w-full">
        Voir ma carte de fidélité
      </a>
    </section>
  )
}

function MessageDejaJoue({ prenom, lot, code, remis }: { prenom: string; lot: string | null; code?: string; remis?: boolean }) {
  return (
    <section className="carte text-center" role="status">
      <p className="titre-carte">Vous avez déjà joué aujourd’hui, {prenom} !</p>
      {lot && (
        <p className="mt-1 text-gray-600">
          Résultat du jour : <strong className="text-gray-900">{lot}</strong>
        </p>
      )}
      {remis ? <p className="mt-2 font-semibold text-green-800">✓ Lot déjà remis au comptoir. Bon appétit !</p> : code && <CodeGagnant code={code} />}
      <p className="mt-2 text-sm text-gray-600">1 tirage par personne et par jour. Revenez lors de votre prochaine visite !</p>
    </section>
  )
}

function Continuer({ prenom, onContinuer, onOublier }: { prenom: string; onContinuer(): void; onOublier(): void }) {
  return (
    <section className="carte space-y-2 text-center">
      <p className="text-lg">
        Re-bonjour <strong>{prenom}</strong> 👋
      </p>
      <button className="bouton w-full" onClick={onContinuer}>
        Continuer en tant que {prenom}
      </button>
      <button className="min-h-11 w-full text-sm font-semibold text-gray-600 underline" onClick={onOublier}>
        Ce n’est pas moi
      </button>
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// Mode local (démo dans ce navigateur)
// ---------------------------------------------------------------------------------------------

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

function JouerLocal() {
  const { param } = useRoute()
  const { etat } = useStore()
  const commerce = etat.commerces.find((c) => c.id === param)

  if (!commerce) return <MessagePublic titre="QR code inconnu">Ce QR code ne correspond à aucun commerce.</MessagePublic>
  return verifierCommerce(commerce) ?? <PartieLocale key={commerce.id} commerce={commerce} />
}

function PartieLocale({ commerce }: { commerce: Commerce }) {
  const { etat, enregistrerTirage, inscrireClient } = useStore()
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
  const statut = joueur && etape === 'pret' ? statutJeu(joueur, etat.tirages, commerce.id) : undefined
  const dejaJoue = joueur && statut === 'dejaJoue' ? tirageDuJour(etat.tirages, commerce.id, joueur.id) : undefined

  function choisirJoueur(client: Client) {
    setJoueurId(client.id)
    memoriserJoueur(commerce.id, client.id)
  }

  function tourner() {
    // Pas de visite validée aujourd'hui ou déjà joué : rien ne se passe (le jeu ne crée jamais de visite).
    if (!joueur || etape !== 'pret' || !peutJouer(joueur, etat.tirages, commerce.id)) return
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
    <Cadre
      commerce={commerce}
      rotation={rotation}
      pied={
        <>
          <BadgeDemo>Démo</BadgeDemo> Données stockées dans ce navigateur uniquement. 1 participation par visite validée, 1 tirage par jour.
        </>
      }
    >
      {!joueur ? (
        memorise ? (
          <Continuer prenom={memorise.prenom} onContinuer={() => choisirJoueur(memorise)} onOublier={() => (memoriserJoueur(commerce.id, null), setMemoriseId(null))} />
        ) : (
          <Identification
            onEnvoyer={async (prenom, contactSaisi) => {
              choisirJoueur((await inscrireClient(commerce.id, prenom, contactSaisi)).client)
            }}
          />
        )
      ) : etape === 'resultat' && gain ? (
        <Resultat lot={gain.lot} prenom={joueur.prenom} />
      ) : dejaJoue ? (
        <MessageDejaJoue prenom={joueur.prenom} lot={dejaJoue.lot} />
      ) : statut === 'sansVisite' ? (
        <MessageSansVisite prenom={joueur.prenom} lienCarte={`#/carte/${joueur.id}`} />
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
    </Cadre>
  )
}

// ---------------------------------------------------------------------------------------------
// Mode API : le serveur vérifie la visite du jour, le tirage du jour, et tire le lot
// ---------------------------------------------------------------------------------------------

function stockageLocal(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

function JouerApi({ api }: { api: ClientApi }) {
  const { param } = useRoute()
  const [commerce, setCommerce] = useState<CommercePublic | null>(null)
  const [erreur, setErreur] = useState<'inconnu' | 'horsLigne' | null>(null)

  const charger = useCallback(() => {
    if (!param) return setErreur('inconnu')
    setErreur(null)
    api.commerce(param).then(setCommerce, (e) => setErreur(e instanceof ErreurApi && e.statut === 404 ? 'inconnu' : 'horsLigne'))
  }, [api, param])
  useEffect(charger, [charger])

  if (erreur === 'inconnu') return <MessagePublic titre="QR code inconnu">Ce QR code ne correspond à aucun commerce.</MessagePublic>
  if (erreur === 'horsLigne') return <HorsLignePublic onReessayer={charger} />
  if (!commerce) return <SqueletteJeu libelle="Un instant, la roue arrive." />
  return verifierCommerce(commerce) ?? <PartieApi key={commerce.id} api={api} commerce={commerce} />
}

function PartieApi({ api, commerce }: { api: ClientApi; commerce: CommercePublic }) {
  const memoire = useMemo(() => memoireJoueur(stockageLocal(), commerce.id), [commerce.id])
  // Code de parrainage dans le lien partagé (#/jouer/<id>?parrain=AH-XXXXXX) : attaché à l'inscription.
  const parrain = useMemo(() => /[?&]parrain=([A-Za-z0-9-]+)/.exec(window.location.hash)?.[1], [])
  const [joueur, setJoueur] = useState<JoueurMemorise | null>(null)
  const [memorise, setMemorise] = useState(() => memoire.joueur())
  const [jeu, setJeu] = useState<ReponseCarte['jeu'] | null>(null)
  const [etape, setEtape] = useState<Etape>('pret')
  const [rotation, setRotation] = useState(0)
  const [gain, setGain] = useState<ResultatTirage | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  const minuterie = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(minuterie.current), [])

  // État du jeu du jour, vu par le serveur (visite validée ? déjà joué ?).
  const majStatut = useCallback(
    async (j: JoueurMemorise) => {
      try {
        const r = await api.carte(j.clientId)
        setJeu(r.jeu)
        setMessage(null)
      } catch (e) {
        if (e instanceof ErreurApi && e.statut === 404) {
          // Carte effacée côté serveur : on oublie ce profil sur ce téléphone.
          memoire.memoriser(null)
          setJoueur(null)
          setMemorise(null)
          setJeu(null)
        } else setMessage(e instanceof ErreurApi ? e.message : MESSAGE_HORS_LIGNE)
      }
    },
    [api, memoire],
  )

  useEffect(() => {
    if (!joueur || etape !== 'pret') return
    void majStatut(joueur)
    // En attente de la visite validée au comptoir : la roue se débloque toute seule (toutes les 10 s / au retour).
    const siVisible = () => document.visibilityState === 'visible' && void majStatut(joueur)
    const minuterieStatut = window.setInterval(siVisible, 10_000)
    document.addEventListener('visibilitychange', siVisible)
    window.addEventListener('focus', siVisible)
    return () => {
      window.clearInterval(minuterieStatut)
      document.removeEventListener('visibilitychange', siVisible)
      window.removeEventListener('focus', siVisible)
    }
  }, [joueur, etape, majStatut])

  function choisirJoueur(j: JoueurMemorise) {
    setJoueur(j)
    memoire.memoriser(j)
  }

  async function tourner() {
    if (!joueur || etape !== 'pret' || enCours) return
    setEnCours(true)
    setMessage(null)
    const issue = await lancerTirage(api, commerce, joueur.contact, joueur.prenom)
    setEnCours(false)
    if (!issue.ok) {
      // Refusé par le serveur ou serveur injoignable : la roue ne tourne pas, aucun lot n'est affiché.
      setMessage(issue.message)
      if (issue.refus) void majStatut(joueur)
      return
    }
    setGain(issue.resultat)
    memoire.memoriserGain({ ...issue.resultat, clientId: joueur.clientId })
    if (issue.secteur) setRotation((r) => rotationCible(r, issue.secteur!))
    setEtape('rotation')
    minuterie.current = window.setTimeout(() => setEtape('resultat'), issue.secteur ? DUREE_ROTATION_MS + 200 : 0)
  }

  const gainMemorise = memoire.gain()
  const codeDuJour =
    gainMemorise && joueur && gainMemorise.clientId === joueur.clientId && new Date(gainMemorise.date).toDateString() === new Date().toDateString()
      ? gainMemorise
      : null

  return (
    <Cadre
      commerce={commerce}
      rotation={rotation}
      pied={
        <>
          {commerce.demo && <BadgeDemo>Démo</BadgeDemo>} 1 participation par visite validée au comptoir, 1 tirage par jour. Tirage effectué par le serveur.
        </>
      }
    >
      {!joueur ? (
        memorise ? (
          <Continuer prenom={memorise.prenom} onContinuer={() => choisirJoueur(memorise)} onOublier={() => (memoire.memoriser(null), setMemorise(null))} />
        ) : (
          <Identification
            parrain={parrain}
            onEnvoyer={async (prenom, contactSaisi) => {
              const { client } = await api.inscrirePublic(commerce.id, prenom, contactSaisi, parrain)
              choisirJoueur({ clientId: client.id, prenom: client.prenom, contact: contactSaisi.trim() })
            }}
          />
        )
      ) : etape !== 'pret' && gain ? (
        etape === 'resultat' ? (
          <Resultat lot={gain.lot} prenom={joueur.prenom} code={gain.perdant ? undefined : gain.code} />
        ) : (
          <button className="bouton w-full py-4 text-lg" disabled>
            La roue tourne…
          </button>
        )
      ) : !jeu ? (
        message ? <MessageErreur>{message}</MessageErreur> : <p className="text-center text-gray-500">Vérification de votre carte…</p>
      ) : jeu.statut === 'dejaJoue' ? (
        <MessageDejaJoue
          prenom={joueur.prenom}
          lot={jeu.lotDuJour}
          // Code re-servi par le serveur (autre téléphone, cache vidé) ; mémoire du téléphone en repli (serveur d'avant P0-U3).
          code={jeu.codeDuJour ?? (codeDuJour && !codeDuJour.perdant ? codeDuJour.code : undefined)}
          remis={jeu.remisDuJour}
        />
      ) : jeu.statut === 'sansVisite' ? (
        <>
          <MessageSansVisite prenom={joueur.prenom} lienCarte={`#/carte/${joueur.clientId}`} />
          <MessageErreur>{message}</MessageErreur>
        </>
      ) : (
        <>
          <MessageErreur>{message}</MessageErreur>
          <button className="bouton w-full py-4 text-lg" onClick={() => void tourner()} disabled={enCours}>
            {enCours ? 'Tirage en cours…' : `🎡 Tourner la roue, ${joueur.prenom} !`}
          </button>
        </>
      )}

      {joueur && (etape === 'resultat' || jeu?.statut === 'dejaJoue') && (
        <>
          <InvitationAvis commerce={commerce} />
          <a href={`#/carte/${joueur.clientId}`} className="bouton-secondaire w-full">
            Voir ma carte de fidélité
          </a>
        </>
      )}
    </Cadre>
  )
}

// ---------------------------------------------------------------------------------------------

function Identification({ onEnvoyer, parrain }: { onEnvoyer(prenom: string, contactSaisi: string): Promise<void>; parrain?: string }) {
  const [prenom, setPrenom] = useState('')
  const [contactSaisi, setContactSaisi] = useState('')
  const [essaye, setEssaye] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const contact = analyserContact(contactSaisi)

  async function envoyer(e: FormEvent) {
    e.preventDefault()
    setEssaye(true)
    if (!contact || enCours) return
    setEnCours(true)
    setErreur(null)
    try {
      await onEnvoyer(prenom.trim(), contactSaisi)
    } catch (err) {
      setErreur(err instanceof Error ? err.message : MESSAGE_HORS_LIGNE)
    } finally {
      setEnCours(false)
    }
  }

  return (
    <form onSubmit={envoyer} className="carte space-y-3">
      <p className="titre-carte">Pour jouer, dites-nous qui vous êtes</p>
      {parrain && (
        <p className="rounded-xl bg-green-50 p-3 text-sm text-green-900 ring-1 ring-green-200">
          👥 Vous êtes parrainé(e) ! Inscrivez-vous : vous gagnerez 50 points à votre 1re visite, et votre ami aussi.
        </p>
      )}
      <div>
        <label className="etiquette" htmlFor="j-prenom">
          Prénom (optionnel)
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
        {essaye && !contact && <p className="mt-1 text-sm text-red-700">Saisissez un numéro (10 chiffres) ou un e-mail valide.</p>}
        <p className="mt-1 text-xs text-gray-600">Déjà client ? Le même numéro ou e-mail retrouve votre carte de fidélité.</p>
      </div>
      <MessageErreur>{erreur}</MessageErreur>
      <button type="submit" className="bouton w-full" disabled={!contactSaisi.trim() || enCours}>
        {enCours ? 'Un instant…' : 'C’est parti'}
      </button>
    </form>
  )
}

function CodeGagnant({ code }: { code: string }) {
  return (
    <div className="mt-3 space-y-2">
      <p className="text-sm text-gray-600">Code gagnant à montrer au comptoir :</p>
      <p className="rounded-xl border-2 border-dashed border-or-500 bg-amber-50 py-3 font-mono text-3xl font-extrabold tracking-[0.3em] text-gray-900 select-all">
        {code}
      </p>
      {/* Le code n'est accepté en caisse que le jour du tirage (P0-U3). */}
      <p className="text-sm font-semibold text-gray-800">Valable aujourd’hui, {jourEnClair(new Date())}</p>
      <BoutonCopier texte={code} libelle="Copier le code" className="bouton-secondaire w-full" />
    </div>
  )
}

function Resultat({ lot, prenom, code }: { lot: string; prenom: string; code?: string }) {
  const perdu = estPerdant(lot)
  return (
    <section
      className={`carte apparition text-center ${perdu ? '' : 'bg-gradient-to-b from-amber-50 to-white ring-2 ring-or-500'}`}
      role="status"
      aria-live="polite"
    >
      <p className="text-5xl" aria-hidden>
        {perdu ? '🍀' : '🎉'}
      </p>
      <p className="mt-2 text-lg font-bold">{perdu ? `Pas cette fois, ${prenom}…` : `Bravo ${prenom}, vous avez gagné :`}</p>
      <p className="mt-1 font-titre text-3xl font-bold text-marque-600">{lot}</p>
      {!perdu && !code && <p className="mt-2 text-sm text-gray-600">Montrez cet écran au comptoir pour profiter de votre lot.</p>}
      {!perdu && code && <CodeGagnant code={code} />}
    </section>
  )
}

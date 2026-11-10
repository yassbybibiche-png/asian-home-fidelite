import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { useStore } from '../store'
import { useRoute } from '../router'
import type { Client, Commerce, CommercePublic, Tirage } from '../types'
import { analyserContact } from '../lib/fidelite'
import { estPerdant, lotsJouables, peutJouer, rotationCible, secteurs, statutJeu, tirageDuJour, tirerLot, type StatutJeu } from '../lib/roulette'
import {
  apresVerification,
  ETAPES_VALIDATION,
  INTRO_ATTENTE,
  MESSAGE_ATTENTE_HORS_LIGNE,
  MESSAGE_VISITE_VALIDEE,
  suivreVisite,
  TEXTE_ATTENTE,
  type SuiviVisite,
} from '../lib/attenteVisite'
import { estAsianHome } from '../lib/visuels'
import { attributsChamp, avecPrenom, etatSaisieContact, virgulePrenom, type ModeContact } from '../lib/inscriptionJeu'
import { ErreurApi, MESSAGE_HORS_LIGNE, type ClientApi, type ReponseCarte, type ResultatTirage } from '../data/api'
import { lancerTirage, memoireJoueur, type JoueurMemorise } from '../data/jeuApi'
import {
  delaiResultat,
  detecterPlateforme,
  dureeConfettis,
  estInstallee,
  etapesEcranAccueil,
  genererConfettis,
  MOTIF_VIBRATION_GAIN,
  MOTIF_VIBRATION_PERDU,
  NOTE_WALLET,
  TEXTE_CODE_A_MONTRER,
  TEXTE_CODE_UNE_FOIS,
  TEXTE_DEJA_JOUE,
  TEXTE_GAIN_SANS_CODE,
  TEXTE_PERDU_PROCHAINE,
  TEXTE_PERDU_TAMPON,
  texteValidite,
  TITRE_PERDU,
  toursRotation,
  vibrer,
} from '../lib/animationRoue'
import { LegendeRoue, Roue, useMouvementReduit } from '../components/Roue'
import { InvitationAvis } from '../components/InvitationAvis'
import { SqueletteJeu } from '../components/Squelette'
import { BadgeDemo, BoutonCopier, LienConfidentialite, LogoCommerce, MessageErreur, PiedPublic } from '../components/ui'

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
      <PiedPublic commerceId={commerce.id} />
    </div>
  )
}

/**
 * Scan avant la validation de la visite (P0-U4) : les deux gestes dans l'ordre, un état d'attente animé tant que la
 * caisse n'a pas validé, et toujours une action possible (carte, menu, nouvelle vérification).
 */
export function MessageSansVisite({
  prenom,
  lienCarte,
  lienMenu,
  horsLigne = false,
  onVerifier,
}: {
  prenom: string
  lienCarte: string
  lienMenu?: string
  horsLigne?: boolean
  onVerifier?: () => void
}) {
  return (
    <section className="carte space-y-4" aria-labelledby="attente-titre">
      <div className="text-center">
        <p id="attente-titre" className="titre-carte">
          {avecPrenom('Bonjour', prenom)} !
        </p>
        <p className="mt-1 text-gray-700">{INTRO_ATTENTE}</p>
      </div>
      <ol className="space-y-2" aria-label="Pour débloquer la roue">
        {ETAPES_VALIDATION.map((etape, i) => (
          <li key={etape} className="flex items-start gap-3 rounded-xl bg-fond p-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-nuit-950 font-bold text-or-400" aria-hidden>
              {i + 1}
            </span>
            <span className="pt-1 text-gray-800">{etape}</span>
          </li>
        ))}
      </ol>
      {horsLigne ? (
        <div className="space-y-1 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200" role="alert" data-attente="hors-ligne">
          <p>{MESSAGE_ATTENTE_HORS_LIGNE}</p>
          {onVerifier && (
            <button type="button" className="lien" onClick={onVerifier}>
              Réessayer maintenant
            </button>
          )}
        </div>
      ) : (
        <div className="hero-sombre flex items-center justify-center gap-3 rounded-xl px-4 py-3" role="status" aria-live="polite" aria-busy="true" data-attente="en-cours">
          <span className="attente-pulse" aria-hidden />
          <span className="font-semibold text-or-300">{TEXTE_ATTENTE}</span>
        </div>
      )}
      <p className="text-center text-sm text-gray-600">1 visite validée = 1 participation par jour.</p>
      <div className="grid gap-2">
        <a href={lienCarte} className="bouton w-full">
          Voir ma carte de fidélité
        </a>
        {lienMenu && (
          <a href={lienMenu} className="bouton-secondaire w-full">
            📖 Voir le menu en attendant
          </a>
        )}
        {onVerifier && !horsLigne && (
          <button type="button" className="min-h-11 w-full text-sm font-semibold text-gray-600 underline" onClick={onVerifier}>
            C’est validé ? Vérifier maintenant
          </button>
        )}
      </div>
    </section>
  )
}

/** Transition visible quand la caisse vient de valider la visite : la roue est débloquée. */
export function VisiteValidee() {
  return (
    <p className="alerte-succes apparition text-center text-base" role="status" aria-live="polite" data-attente="validee">
      ✓ {MESSAGE_VISITE_VALIDEE}
    </p>
  )
}

/** Vrai dès que le statut du jeu passe de « sans visite » à « prêt » sous les yeux du client (et le reste). */
function useVisiteValidee(statut: StatutJeu | null | undefined): boolean {
  const [suivi, setSuivi] = useState<SuiviVisite>({ statut, validee: false })
  if (suivi.statut !== statut) setSuivi(suivreVisite(suivi, statut))
  return suivi.validee
}

function MessageDejaJoue({ prenom, lot, code, remis }: { prenom: string; lot: string | null; code?: string; remis?: boolean }) {
  return (
    <section className="carte text-center" role="status">
      <p className="titre-carte">Vous avez déjà joué aujourd’hui{virgulePrenom(prenom)} !</p>
      {lot && (
        <p className="mt-1 text-gray-600">
          Résultat du jour : <strong className="text-gray-900">{lot}</strong>
        </p>
      )}
      {remis ? <p className="mt-2 font-semibold text-green-800">✓ Lot déjà remis au comptoir. Bon appétit !</p> : code && <CodeGagnant code={code} />}
      <p className="mt-2 text-sm text-gray-600">{TEXTE_DEJA_JOUE}</p>
    </section>
  )
}

/** Client déjà connu sur ce téléphone : zéro saisie, un seul bouton (avec ou sans prénom sur la carte). */
function Continuer({ prenom, onContinuer, onOublier }: { prenom: string; onContinuer(): void; onOublier(): void }) {
  const p = prenom.trim()
  return (
    <section className="carte space-y-2 text-center">
      <p className="text-lg">
        Re-bonjour{p && <> <strong>{p}</strong></>} 👋
      </p>
      <button className="bouton w-full" onClick={onContinuer}>
        {p ? `Continuer en tant que ${p}` : 'Continuer avec ma carte'}
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
  const { etat, enregistrerTirage, inscrireClient, nommerClient } = useStore()
  const [joueurId, setJoueurId] = useState<string | null>(null)
  const [memoriseId, setMemoriseId] = useState(() => lireJoueurMemorise(commerce.id))
  const [etape, setEtape] = useState<Etape>('pret')
  const [rotation, setRotation] = useState(0)
  const [gain, setGain] = useState<Tirage | null>(null)
  const minuterie = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(minuterie.current), [])
  const reduit = useMouvementReduit()

  const trouver = (id: string | null) => (id ? etat.clients.find((c) => c.id === id && c.commerceId === commerce.id) : undefined)
  const joueur = trouver(joueurId)
  const memorise = trouver(memoriseId)
  const statut = joueur && etape === 'pret' ? statutJeu(joueur, etat.tirages, commerce.id) : undefined
  const dejaJoue = joueur && statut === 'dejaJoue' ? tirageDuJour(etat.tirages, commerce.id, joueur.id) : undefined
  const visiteValidee = useVisiteValidee(statut)

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
    setRotation((r) => rotationCible(r, secteur, Math.random(), toursRotation(reduit)))
    setEtape('rotation')
    minuterie.current = window.setTimeout(() => setEtape('resultat'), delaiResultat(reduit))
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
            commerceId={commerce.id}
            nomCommerce={commerce.nom}
            onEnvoyer={async (contactSaisi, consentementRelance) => {
              choisirJoueur((await inscrireClient(commerce.id, '', contactSaisi, consentementRelance)).client)
            }}
          />
        )
      ) : etape === 'resultat' && gain ? (
        <Resultat lot={gain.lot} prenom={joueur.prenom} lienCarte={`#/carte/${joueur.id}`} />
      ) : dejaJoue ? (
        <MessageDejaJoue prenom={joueur.prenom} lot={dejaJoue.lot} />
      ) : statut === 'sansVisite' ? (
        <MessageSansVisite prenom={joueur.prenom} lienCarte={`#/carte/${joueur.id}`} />
      ) : (
        <>
          {visiteValidee && etape === 'pret' && <VisiteValidee />}
          <button className="bouton w-full py-4 text-lg" onClick={tourner} disabled={etape !== 'pret'}>
            {etape === 'rotation' ? 'La roue tourne…' : `🎡 Tourner la roue${virgulePrenom(joueur.prenom)} !`}
          </button>
        </>
      )}

      {joueur && (etape === 'resultat' || dejaJoue) && (
        <>
          <InvitationAvis commerce={commerce} />
          <DemandePrenom prenom={joueur.prenom} onEnregistrer={async (p) => nommerClient(joueur.id, p)} />
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
  const [horsLigne, setHorsLigne] = useState(false)
  const [menuDisponible, setMenuDisponible] = useState(() => estAsianHome(commerce))
  const minuterie = useRef<number | undefined>(undefined)
  const verifierMaintenant = useRef<() => void>(() => {})
  useEffect(() => () => window.clearTimeout(minuterie.current), [])
  const reduit = useMouvementReduit()
  const visiteValidee = useVisiteValidee(jeu?.statut)

  // État du jeu du jour, vu par le serveur (visite validée ? déjà joué ?). Renvoie le statut, ou null en cas d'échec.
  const majStatut = useCallback(
    async (j: JoueurMemorise): Promise<StatutJeu | null> => {
      try {
        const r = await api.carte(j.clientId)
        setJeu(r.jeu)
        setMenuDisponible((m) => m || !!r.menuDisponible)
        setMessage(null)
        setHorsLigne(false)
        return r.jeu.statut
      } catch (e) {
        if (e instanceof ErreurApi && e.statut === 404) {
          // Carte effacée côté serveur : on oublie ce profil sur ce téléphone.
          memoire.memoriser(null)
          setJoueur(null)
          setMemorise(null)
          setJeu(null)
        } else {
          setHorsLigne(!(e instanceof ErreurApi) || e.horsLigne)
          setMessage(e instanceof ErreurApi ? e.message : MESSAGE_HORS_LIGNE)
        }
        return null
      }
    },
    [api, memoire],
  )

  useEffect(() => {
    if (!joueur || etape !== 'pret') return
    // En attente de la visite validée au comptoir : la roue se débloque toute seule. Vérification toutes les 10 s
    // tant que la roue est verrouillée (espacée jusqu'à 60 s si le réseau ou le serveur ne répond pas), et tout de
    // suite au retour sur l'onglet, au retour du réseau ou sur « Vérifier maintenant ». Arrêt dès que la roue est prête.
    let actif = true
    let enVol = false
    let echecs = 0
    let prochaine: number | undefined
    const verifier = async () => {
      if (enVol) return
      window.clearTimeout(prochaine)
      enVol = true
      const statut = await majStatut(joueur)
      enVol = false
      if (!actif) return
      const suite = apresVerification(statut, echecs)
      echecs = suite.echecs
      if (suite.delai !== null) prochaine = window.setTimeout(siVisible, suite.delai)
    }
    // Onglet caché : pas de requête ; la vérification reprend au retour (visibilitychange).
    function siVisible() {
      if (document.visibilityState === 'visible') void verifier()
    }
    verifierMaintenant.current = () => void verifier()
    void verifier()
    document.addEventListener('visibilitychange', siVisible)
    window.addEventListener('focus', siVisible)
    window.addEventListener('online', siVisible)
    return () => {
      actif = false
      window.clearTimeout(prochaine)
      verifierMaintenant.current = () => {}
      document.removeEventListener('visibilitychange', siVisible)
      window.removeEventListener('focus', siVisible)
      window.removeEventListener('online', siVisible)
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
    if (issue.secteur) setRotation((r) => rotationCible(r, issue.secteur!, Math.random(), toursRotation(reduit)))
    setEtape('rotation')
    minuterie.current = window.setTimeout(() => setEtape('resultat'), delaiResultat(reduit, !!issue.secteur))
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
            commerceId={commerce.id}
            nomCommerce={commerce.nom}
            onEnvoyer={async (contactSaisi, consentementRelance) => {
              const { client } = await api.inscrirePublic(commerce.id, '', contactSaisi, parrain, consentementRelance)
              choisirJoueur({ clientId: client.id, prenom: client.prenom, contact: contactSaisi.trim() })
            }}
          />
        )
      ) : etape !== 'pret' && gain ? (
        etape === 'resultat' ? (
          <Resultat lot={gain.lot} prenom={joueur.prenom} code={gain.perdant ? undefined : gain.code} lienCarte={`#/carte/${joueur.clientId}`} />
        ) : (
          <button className="bouton w-full py-4 text-lg" disabled>
            La roue tourne…
          </button>
        )
      ) : !jeu ? (
        message ? (
          // Jamais d'écran figé : l'erreur dit quoi faire, la vérification reprend seule et ce bouton la relance.
          <>
            <MessageErreur>{message}</MessageErreur>
            <button className="bouton-secondaire w-full" onClick={() => verifierMaintenant.current()}>
              Réessayer
            </button>
          </>
        ) : (
          <p className="text-center text-gray-500">Vérification de votre carte…</p>
        )
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
          <MessageSansVisite
            prenom={joueur.prenom}
            lienCarte={`#/carte/${joueur.clientId}`}
            lienMenu={menuDisponible ? `#/menu/${commerce.id}` : undefined}
            horsLigne={horsLigne}
            onVerifier={() => verifierMaintenant.current()}
          />
          {!horsLigne && <MessageErreur>{message}</MessageErreur>}
        </>
      ) : (
        <>
          {visiteValidee && <VisiteValidee />}
          <MessageErreur>{message}</MessageErreur>
          <button className="bouton w-full py-4 text-lg" onClick={() => void tourner()} disabled={enCours}>
            {enCours ? 'Tirage en cours…' : `🎡 Tourner la roue${virgulePrenom(joueur.prenom)} !`}
          </button>
        </>
      )}

      {joueur && (etape === 'resultat' || jeu?.statut === 'dejaJoue') && (
        <>
          <InvitationAvis commerce={commerce} />
          <DemandePrenom
            prenom={joueur.prenom}
            onEnregistrer={async (p) => {
              const { client } = await api.prenomCarte(commerce.id, joueur.clientId, joueur.contact, p)
              choisirJoueur({ ...joueur, prenom: client.prenom })
            }}
          />
          <a href={`#/carte/${joueur.clientId}`} className="bouton-secondaire w-full">
            Voir ma carte de fidélité
          </a>
        </>
      )}
    </Cadre>
  )
}

// ---------------------------------------------------------------------------------------------

/**
 * Entrée depuis le QR (P1-C1) : UN seul champ obligatoire, téléphone OU e-mail. Le choix « Téléphone / E-mail » ne
 * change que le clavier du téléphone (inputmode + autocomplete) : le champ accepte toujours les deux. Le prénom n'est
 * pas demandé ici, mais après le tirage (`DemandePrenom`).
 */
function Identification({
  onEnvoyer,
  parrain,
  commerceId,
  nomCommerce,
}: {
  onEnvoyer(contactSaisi: string, consentementRelance: boolean): Promise<void>
  parrain?: string
  commerceId: string
  nomCommerce: string
}) {
  const [mode, setMode] = useState<ModeContact>('tel')
  const [contactSaisi, setContactSaisi] = useState('')
  // Relances SMS / e-mail (P1-B3) : case séparée, jamais pré-cochée.
  const [consentement, setConsentement] = useState(false)
  const [essaye, setEssaye] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const champ = useRef<HTMLInputElement>(null)
  const contact = analyserContact(contactSaisi)
  const saisie = etatSaisieContact(contactSaisi, essaye)
  const attributs = attributsChamp(mode)

  function choisirMode(m: ModeContact) {
    setMode(m)
    champ.current?.focus()
  }

  async function envoyer(e: FormEvent) {
    e.preventDefault()
    setEssaye(true)
    if (!contact || enCours) return
    setEnCours(true)
    setErreur(null)
    try {
      await onEnvoyer(contactSaisi, consentement)
    } catch (err) {
      setErreur(err instanceof Error ? err.message : MESSAGE_HORS_LIGNE)
    } finally {
      setEnCours(false)
    }
  }

  return (
    // noValidate : le champ « email » accepte aussi un numéro ; la validation est celle affichée sous le champ.
    <form onSubmit={envoyer} className="carte space-y-3" noValidate>
      <p className="titre-carte">Pour jouer, votre téléphone ou votre e-mail suffit</p>
      {parrain && (
        <p className="rounded-xl bg-green-50 p-3 text-sm text-green-900 ring-1 ring-green-200">
          👥 Vous êtes parrainé(e) ! Inscrivez-vous : vous gagnerez 50 points à votre 1re visite, et votre ami aussi.
        </p>
      )}
      <div>
        <div className="mb-2 grid grid-cols-2 gap-2" role="group" aria-label="Clavier du champ">
          {(['tel', 'email'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => choisirMode(m)}
              className={`min-h-11 rounded-xl text-sm font-semibold ring-1 ${mode === m ? 'bg-nuit-950 text-or-300 ring-nuit-950' : 'bg-white text-gray-700 ring-gray-300'}`}
            >
              {m === 'tel' ? '📱 Téléphone' : '✉️ E-mail'}
            </button>
          ))}
        </div>
        <label className="etiquette" htmlFor="j-contact">
          Téléphone ou e-mail
        </label>
        <input
          ref={champ}
          id="j-contact"
          className="champ"
          type={attributs.type}
          inputMode={attributs.inputMode}
          autoComplete={attributs.autoComplete}
          autoCapitalize="off"
          spellCheck={false}
          placeholder={attributs.placeholder}
          aria-invalid={saisie.niveau === 'erreur'}
          aria-describedby="j-contact-aide"
          value={contactSaisi}
          onChange={(e) => setContactSaisi(e.target.value)}
        />
        <p
          id="j-contact-aide"
          aria-live="polite"
          className={`mt-1 min-h-5 text-sm ${saisie.niveau === 'erreur' ? 'text-red-700' : saisie.niveau === 'ok' ? 'font-semibold text-green-800' : 'text-gray-600'}`}
        >
          {saisie.message}
        </p>
        <p className="mt-1 text-xs text-gray-600">Déjà client ? Le même numéro ou e-mail retrouve votre carte de fidélité.</p>
      </div>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" className="mt-0.5" checked={consentement} onChange={(e) => setConsentement(e.target.checked)} />
        <span>J’accepte de recevoir les offres de {nomCommerce} par SMS ou e-mail (désinscription à tout moment).</span>
      </label>
      <p className="text-xs text-gray-600">
        Vos données servent uniquement à votre carte de fidélité, jamais revendues : <LienConfidentialite commerceId={commerceId} />.
      </p>
      <MessageErreur>{erreur}</MessageErreur>
      <button type="submit" className="bouton w-full" disabled={!contactSaisi.trim() || enCours}>
        {enCours ? 'Un instant…' : 'C’est parti'}
      </button>
    </form>
  )
}

/**
 * Prénom demandé APRÈS le tirage (P1-C1), jamais avant : optionnel, une seule fois (la carte n'en a pas encore).
 * Après l'envoi : remerciement tant que l'écran reste ouvert.
 */
function DemandePrenom({ prenom, onEnregistrer }: { prenom: string; onEnregistrer(prenom: string): Promise<void> }) {
  const [saisie, setSaisie] = useState('')
  const [enregistre, setEnregistre] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  if (prenom.trim()) {
    return enregistre ? (
      <p className="alerte-succes text-center" role="status">
        Merci {prenom.trim()}, votre carte est à votre nom.
      </p>
    ) : null
  }

  async function envoyer(e: FormEvent) {
    e.preventDefault()
    const p = saisie.trim()
    if (!p || enCours) return
    setEnCours(true)
    setErreur(null)
    try {
      await onEnregistrer(p)
      setEnregistre(true)
    } catch (err) {
      setErreur(err instanceof Error ? err.message : MESSAGE_HORS_LIGNE)
    } finally {
      setEnCours(false)
    }
  }

  return (
    <form onSubmit={envoyer} className="carte space-y-2" aria-label="Votre prénom (optionnel)">
      <label className="etiquette" htmlFor="j-prenom">
        Votre prénom, pour que l’équipe vous reconnaisse ? (optionnel)
      </label>
      <div className="flex gap-2">
        <input
          id="j-prenom"
          className="champ min-w-0 flex-1"
          autoComplete="given-name"
          autoCapitalize="words"
          maxLength={40}
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
        />
        <button type="submit" className="bouton shrink-0" disabled={!saisie.trim() || enCours}>
          {enCours ? '…' : 'OK'}
        </button>
      </div>
      <MessageErreur>{erreur}</MessageErreur>
    </form>
  )
}

function CodeGagnant({ code }: { code: string }) {
  return (
    <div className="mt-3 space-y-2" data-code-gagnant>
      <p className="text-sm text-gray-600">{TEXTE_CODE_A_MONTRER}</p>
      <p className="rounded-xl border-2 border-dashed border-or-500 bg-amber-50 py-4 font-mono text-4xl font-extrabold tracking-[0.3em] text-gray-900 select-all">
        {code}
      </p>
      {/* Le code n'est accepté en caisse que le jour du tirage (P0-U3). */}
      <p className="text-base font-bold text-gray-900" data-validite>
        🗓️ {texteValidite(new Date())}
      </p>
      <p className="text-xs text-gray-600">{TEXTE_CODE_UNE_FOIS}</p>
      <BoutonCopier texte={code} libelle="Copier le code" className="bouton-secondaire w-full" />
    </div>
  )
}

/** Pluie de confettis au gain (CSS maison, aucune dépendance) ; rien en mouvement réduit. Décorative. */
function Confettis() {
  const reduit = useMouvementReduit()
  const confettis = useMemo(() => genererConfettis(reduit), [reduit])
  const [termine, setTermine] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setTermine(true), dureeConfettis(confettis) + 100)
    return () => window.clearTimeout(t)
  }, [confettis])
  if (termine || confettis.length === 0) return null
  return (
    <div className="confettis" aria-hidden>
      {confettis.map((c, i) => (
        <span
          key={i}
          className={c.rond ? 'confetti rounded-full' : 'confetti'}
          style={
            {
              left: `${c.gauche}%`,
              backgroundColor: c.couleur,
              animationDelay: `${c.delai}ms`,
              animationDuration: `${c.duree}ms`,
              '--derive': `${c.derive}px`,
              '--rotation': `${c.rotation}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}

/**
 * « Garder ma carte » : en attendant Apple / Google Wallet, ajout de la carte web à l'écran d'accueil, avec les
 * gestes propres à l'iPhone ou à Android. Rien à proposer si la page est déjà ouverte depuis l'écran d'accueil.
 */
export function GarderCarte({ lienCarte }: { lienCarte: string }) {
  const [ouvert, setOuvert] = useState(false)
  const plateforme = useMemo(() => detecterPlateforme(navigator.userAgent, navigator.maxTouchPoints ?? 0), [])
  if (estInstallee()) return null
  return (
    <div className="mt-3 text-left" data-garder-carte={plateforme}>
      <button type="button" className="bouton w-full" aria-expanded={ouvert} aria-controls="garder-carte" onClick={() => setOuvert((o) => !o)}>
        📲 Garder ma carte sur mon téléphone
      </button>
      {ouvert && (
        <div id="garder-carte" className="apparition mt-3 space-y-2 rounded-xl bg-fond p-3 text-sm text-gray-800">
          <p className="font-semibold text-gray-900">
            {plateforme === 'ios' ? 'Sur iPhone' : plateforme === 'android' ? 'Sur Android' : 'Sur votre téléphone'} : ajoutez votre carte à l’écran d’accueil
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            {etapesEcranAccueil(plateforme).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ol>
          <a href={lienCarte} className="bouton-secondaire w-full">
            Ouvrir ma carte
          </a>
          <p className="text-xs text-gray-600">{NOTE_WALLET}</p>
        </div>
      )}
    </div>
  )
}

export function Resultat({ lot, prenom, code, lienCarte }: { lot: string; prenom: string; code?: string; lienCarte: string }) {
  const perdu = estPerdant(lot)
  // Retour tactile à l'apparition du résultat (Android ; sans effet sur iPhone, qui n'a pas l'API).
  useEffect(() => void vibrer(perdu ? MOTIF_VIBRATION_PERDU : MOTIF_VIBRATION_GAIN), [perdu])
  if (perdu)
    return (
      <section className="carte apparition text-center" role="status" aria-live="polite" data-resultat="perdu">
        <p className="text-5xl" aria-hidden>
          🍀
        </p>
        <p className="mt-2 text-lg font-bold">
          {TITRE_PERDU}
          {virgulePrenom(prenom)}… mais votre visite compte !
        </p>
        <p className="mt-2 rounded-xl bg-green-50 p-3 text-sm font-semibold text-green-900 ring-1 ring-green-200">✓ {TEXTE_PERDU_TAMPON}</p>
        <p className="mt-2 text-sm text-gray-700">{TEXTE_PERDU_PROCHAINE}</p>
        <GarderCarte lienCarte={lienCarte} />
      </section>
    )
  return (
    <section className="carte apparition bg-gradient-to-b from-amber-50 to-white text-center ring-2 ring-or-500" role="status" aria-live="polite" data-resultat="gain">
      <Confettis />
      <p className="text-5xl" aria-hidden>
        🎉
      </p>
      <p className="mt-2 text-lg font-bold">{`${avecPrenom('Bravo', prenom)}, vous avez gagné :`}</p>
      <p className="mt-1 font-titre text-4xl leading-tight font-bold break-words text-marque-600">{lot}</p>
      {code ? (
        <CodeGagnant code={code} />
      ) : (
        <>
          <p className="mt-2 text-sm text-gray-600">{TEXTE_GAIN_SANS_CODE}</p>
          <p className="mt-1 text-base font-bold text-gray-900" data-validite>
            🗓️ {texteValidite(new Date())}
          </p>
        </>
      )}
      <GarderCarte lienCarte={lienCarte} />
    </section>
  )
}

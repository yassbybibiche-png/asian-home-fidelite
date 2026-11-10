import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useStore } from '../store'
import { useRoute } from '../router'
import type { Client, Commerce, CommercePublic, MessageClient } from '../types'
import { ErreurApi, type ClientApi } from '../data/api'
import { CarteFidelite } from '../components/CarteFidelite'
import { InvitationAvis } from '../components/InvitationAvis'
import { SqueletteCarte } from '../components/Squelette'
import { BadgeDemo, BoutonCopier, EncartWallet, LienConfidentialite, MessageErreur, PiedPublic, telecharger } from '../components/ui'
import { dateRelative } from '../lib/format'
import { historiqueCarte, messageRechercheCarte, type GainDuJour, type LotHistorique } from '../lib/carte'
import { lienCourtCarte } from '../lib/relances'
import { estAsianHome, VISUELS } from '../lib/visuels'
import { configRattrapage, peutCompleterProfil } from '../lib/programme'
import { nomFichierExportClient } from '../lib/rgpd'
import { HorsLignePublic, MessagePublic } from './Jouer'

/** Page publique #/carte/<clientId> : la carte de fidélité sur le téléphone du client. */
export default function CartePublique() {
  const { api } = useStore()
  return api ? <CarteApi api={api} /> : <CarteLocale />
}

/** Démo locale : commerce complet ; mode API : fiche publique du serveur. */
type CommerceCarte = Commerce | CommercePublic

/** Boîte de réception du client : messages automatiques et messages du commerce (les plus récents d'abord). */
function BoiteReception({ messages, commerce }: { messages: MessageClient[]; commerce: CommerceCarte }) {
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

/** Historique des visites et des lots (P1-C3), replié : la carte et ses boutons restent en haut de page. */
function Historique({ client, lotsRoue }: { client: Client; lotsRoue: LotHistorique[] }) {
  const lignes = historiqueCarte(client, lotsRoue)
  return (
    <details className="carte">
      <summary className="titre-carte min-h-11 cursor-pointer">Historique des visites et des lots</summary>
      {lignes.length ? (
        <ul className="mt-3 divide-y divide-gray-100">
          {lignes.map((l, i) => (
            <li key={`${l.date}-${i}`} className="flex items-baseline justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 text-gray-900">{l.libelle}</span>
              <span className="shrink-0 text-xs text-gray-600">{new Date(l.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-gray-600">Aucune visite pour l’instant : votre premier tampon arrive au comptoir.</p>
      )}
    </details>
  )
}

/** Lien court personnel (P1-C3) : /c/<id> redirige vers la carte ; à garder ou à s'envoyer. */
function LienCourt({ lien }: { lien: string }) {
  return (
    <section className="carte space-y-2" aria-label="Votre lien personnel">
      <p className="text-sm text-gray-700">
        Votre lien personnel : <span className="font-mono font-semibold break-all text-gray-900">{lien.replace(/^https?:\/\//, '')}</span>
      </p>
      <BoutonCopier texte={lien} libelle="Copier mon lien" className="bouton-secondaire w-full" />
    </section>
  )
}

function Carte({
  client,
  commerce,
  demo,
  pied,
  menu,
  actions,
  gainDuJour,
  lotsRoue = [],
  lienCourt,
}: {
  client: Client
  commerce: CommerceCarte
  demo: boolean
  pied: ReactNode
  menu?: boolean
  actions?: ReactNode
  gainDuJour?: GainDuJour | null
  lotsRoue?: LotHistorique[]
  lienCourt?: string
}) {
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
      <CarteFidelite client={client} commerce={commerce} animer gainDuJour={gainDuJour} />
      {lienCourt && <LienCourt lien={lienCourt} />}
      {actions}
      <BoiteReception messages={client.messages ?? []} commerce={commerce} />
      <Historique client={client} lotsRoue={lotsRoue} />
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
          <img
            src={VISUELS.interieurSalon}
            alt="Coin salon d’Asian Home Paris : fauteuils velours bleu nuit et rideaux violets"
            loading="lazy"
            className="h-48 w-full rounded-2xl object-cover"
          />
          <p className="text-sm text-gray-700">Restaurant asiatique halal, au Pré-Saint-Gervais.</p>
        </section>
      )}
      <EncartWallet demo={demo} replie />
      {commerce.coordonnees && <p className="text-center text-sm text-gray-600">{commerce.coordonnees}</p>}
      <p className="text-center text-xs text-gray-600">{pied}</p>
      <PiedPublic commerceId={commerce.id} />
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
  const [donnees, setDonnees] = useState<{ client: Client; commerce: CommercePublic; menu: boolean; gainDuJour: GainDuJour | null; lots: LotHistorique[] } | null>(null)
  const [erreur, setErreur] = useState<'introuvable' | 'inactif' | 'horsLigne' | null>(null)

  const charger = useCallback(() => {
    if (!param) return setErreur('introuvable')
    api.carte(param).then(
      (r) => {
        // Asian Home : le menu public affiche la vraie carte en repli tant que le
        // commerçant n'a pas enregistré son propre menu — le lien est donc visible.
        setDonnees({
          client: r.client,
          commerce: r.commerce,
          menu: !!r.menuDisponible || estAsianHome(r.commerce),
          // Gain de la roue du jour pas encore retiré (P1-C3) : rappelé sur la carte avec son code, valable aujourd'hui.
          gainDuJour: r.jeu.codeDuJour && r.jeu.lotDuJour && !r.jeu.remisDuJour ? { lot: r.jeu.lotDuJour, code: r.jeu.codeDuJour } : null,
          lots: r.historiqueLots ?? [],
        })
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

  if (erreur === 'introuvable')
    return (
      <>
        <MessagePublic titre="Carte introuvable">Ce lien ne correspond à aucune carte de fidélité.</MessagePublic>
        <RetrouverCarte api={api} />
      </>
    )
  if (erreur === 'inactif') return <MessagePublic titre="Carte indisponible">La carte de fidélité de ce commerce n’est plus disponible.</MessagePublic>
  // Hors ligne sans carte déjà affichée : message clair (une carte déjà affichée reste visible).
  if (erreur === 'horsLigne' && !donnees) return <HorsLignePublic onReessayer={charger} />
  if (!donnees) return <SqueletteCarte libelle="Un instant, votre carte arrive." />
  return (
    <Carte
      client={donnees.client}
      commerce={donnees.commerce}
      demo={!!donnees.commerce.demo}
      menu={donnees.menu}
      gainDuJour={donnees.gainDuJour}
      lotsRoue={donnees.lots}
      lienCourt={lienCourtCarte(window.location.origin, donnees.client.id)}
      actions={
        <>
          <FormulairesProgramme api={api} client={donnees.client} commerce={donnees.commerce} onMaj={charger} />
          <MesDonnees api={api} client={donnees.client} commerce={donnees.commerce} onMaj={charger} />
        </>
      }
      pied={
        <>
          {donnees.commerce.demo && <BadgeDemo>Démo</BadgeDemo>}
          {erreur === 'horsLigne' ? ' Hors ligne : carte affichée telle qu’au dernier chargement.' : ' Carte à jour.'}
        </>
      }
    />
  )
}

/** Rattrapage d'une visite oubliée + profil progressif (après la 2e visite). */
function FormulairesProgramme({ api, client, commerce, onMaj }: { api: ClientApi; client: Client; commerce: CommercePublic; onMaj(): void }) {
  const [anniversaire, setAnniversaire] = useState('')
  const [plat, setPlat] = useState('')
  const [date, setDate] = useState('')
  const [montant, setMontant] = useState('')
  const [ticket, setTicket] = useState('')
  const [message, setMessage] = useState('')
  const [erreur, setErreur] = useState('')
  const [enCours, setEnCours] = useState(false)
  const rattrapage = configRattrapage(commerce)
  const enAttente = (client.demandesRattrapage ?? []).filter((d) => d.statut === 'en_attente')

  async function envoyerProfil(e: FormEvent) {
    e.preventDefault()
    if (enCours) return
    setErreur('')
    setMessage('')
    setEnCours(true)
    try {
      await api.profil(commerce.id, client.id, { ...(anniversaire.trim() ? { anniversaire: anniversaire.trim() } : {}), ...(plat.trim() ? { platPrefere: plat.trim() } : {}) })
      setMessage('Merci, votre profil est à jour !')
      setAnniversaire('')
      setPlat('')
      onMaj()
    } catch (err) {
      setErreur(err instanceof ErreurApi ? err.message : 'Envoi impossible pour le moment.')
    } finally {
      setEnCours(false)
    }
  }

  async function envoyerRattrapage(e: FormEvent) {
    e.preventDefault()
    if (enCours) return
    setErreur('')
    setMessage('')
    const centimes = Math.round(Number(montant.replace(',', '.')) * 100)
    if (!date || !Number.isFinite(centimes) || centimes < 0) return setErreur('Indiquez la date de la visite et le montant payé.')
    setEnCours(true)
    try {
      await api.declarerRattrapage(commerce.id, client.id, { date: new Date(`${date}T12:00:00`).toISOString(), montantCentimes: centimes, ...(ticket.trim() ? { ticket: ticket.trim() } : {}) })
      setMessage('Demande envoyée : le restaurant la validera et votre visite sera créditée.')
      setDate('')
      setMontant('')
      setTicket('')
      onMaj()
    } catch (err) {
      setErreur(err instanceof ErreurApi ? err.message : 'Envoi impossible pour le moment.')
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div className="space-y-4">
      {peutCompleterProfil(client) && (
        <form onSubmit={envoyerProfil} className="carte space-y-3">
          <h2 className="titre-carte">Votre profil</h2>
          <p className="text-sm text-gray-600">Pour recevoir votre récompense d’anniversaire et des offres sur vos plats préférés.</p>
          <div>
            <label className="etiquette" htmlFor="cp-anniversaire">
              Anniversaire (JJ/MM){client.anniversaire ? ` — enregistré : ${client.anniversaire.slice(3)}/${client.anniversaire.slice(0, 2)}` : ''}
            </label>
            <input id="cp-anniversaire" className="champ" inputMode="numeric" placeholder="21/03" value={anniversaire} onChange={(e) => setAnniversaire(e.target.value)} />
          </div>
          <div>
            <label className="etiquette" htmlFor="cp-plat">
              Plat préféré{client.platPrefere ? ` — enregistré : ${client.platPrefere}` : ''}
            </label>
            <input id="cp-plat" className="champ" maxLength={80} placeholder="ex : poulet satay" value={plat} onChange={(e) => setPlat(e.target.value)} />
          </div>
          <button type="submit" className="bouton-secondaire w-full" disabled={enCours || (!anniversaire.trim() && !plat.trim())}>
            Enregistrer mon profil
          </button>
        </form>
      )}
      {rattrapage.actif && (
        <form onSubmit={envoyerRattrapage} className="carte space-y-3">
          <h2 className="titre-carte">J’ai oublié de scanner</h2>
          <p className="text-sm text-gray-600">Signalez une visite oubliée (sous {rattrapage.delaiJours} jours) : le restaurant la validera et votre tampon + vos points seront crédités.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="etiquette" htmlFor="cp-date">
                Date de la visite
              </label>
              <input id="cp-date" className="champ" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div>
              <label className="etiquette" htmlFor="cp-montant">
                Montant payé (€)
              </label>
              <input id="cp-montant" className="champ" inputMode="decimal" placeholder="24,50" value={montant} onChange={(e) => setMontant(e.target.value)} required />
            </div>
          </div>
          <div>
            <label className="etiquette" htmlFor="cp-ticket">
              N° de ticket (optionnel)
            </label>
            <input id="cp-ticket" className="champ" maxLength={80} placeholder="ex : T-1234" value={ticket} onChange={(e) => setTicket(e.target.value)} />
          </div>
          <button type="submit" className="bouton-secondaire w-full" disabled={enCours}>
            Envoyer ma demande
          </button>
          {enAttente.length > 0 && (
            <p className="text-sm text-gray-700">
              {enAttente.length} demande{enAttente.length > 1 ? 's' : ''} en attente de validation par le restaurant.
            </p>
          )}
        </form>
      )}
      {message && <p className="rounded-xl bg-green-50 p-3 text-sm text-green-900 ring-1 ring-green-200">{message}</p>}
      {erreur && <MessageErreur>{erreur}</MessageErreur>}
    </div>
  )
}

/**
 * Droits RGPD depuis la carte (P1-B6) : « Recevoir mes données » (CSV téléchargé) et « Demander la suppression »
 * (demande enregistrée, le restaurant supprime la carte depuis sa fiche client). Le lien de la carte ne suffit pas :
 * le client confirme avec le téléphone ou l'e-mail donné à l'inscription.
 */
function MesDonnees({ api, client, commerce, onMaj }: { api: ClientApi; client: Client; commerce: CommercePublic; onMaj(): void }) {
  const [contact, setContact] = useState('')
  const [message, setMessage] = useState('')
  const [erreur, setErreur] = useState('')
  const [enCours, setEnCours] = useState(false)

  async function agir(action: 'donnees' | 'suppression') {
    if (enCours) return
    setErreur('')
    setMessage('')
    if (!contact.trim()) return setErreur('Indiquez le téléphone ou l’e-mail donné à l’inscription.')
    if (action === 'suppression' && !window.confirm('Demander la suppression de votre carte et de toutes vos données (tampons, points, historique) ? Le restaurant la supprimera définitivement.')) return
    setEnCours(true)
    try {
      if (action === 'donnees') {
        telecharger(nomFichierExportClient(client.id), await api.donneesCarte(client.id, contact.trim()))
        setMessage('Vos données ont été téléchargées (fichier CSV, lisible dans un tableur).')
      } else {
        await api.demanderSuppression(client.id, contact.trim())
        setMessage('Demande enregistrée : le restaurant supprimera votre carte et vos données.')
        onMaj()
      }
    } catch (err) {
      setErreur(err instanceof ErreurApi ? err.message : 'Envoi impossible pour le moment.')
    } finally {
      setEnCours(false)
    }
  }

  return (
    <details className="carte">
      <summary className="titre-carte min-h-11 cursor-pointer">Mes données personnelles</summary>
      <div className="mt-3 space-y-3">
        <p className="text-sm text-gray-600">
          Recevez une copie de vos données ou demandez leur suppression. <LienConfidentialite commerceId={commerce.id} />
        </p>
        {client.demandeSuppressionLe && (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
            Demande de suppression enregistrée le {new Date(client.demandeSuppressionLe).toLocaleDateString('fr-FR')} : le restaurant va supprimer votre carte.
          </p>
        )}
        <div>
          <label className="etiquette" htmlFor="cp-contact-rgpd">
            Votre téléphone ou e-mail (celui de l’inscription)
          </label>
          <input id="cp-contact-rgpd" className="champ" inputMode="email" autoComplete="off" value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="bouton-secondaire min-h-11" disabled={enCours} onClick={() => void agir('donnees')}>
            Recevoir mes données
          </button>
          <button type="button" className="bouton-secondaire min-h-11" disabled={enCours || !!client.demandeSuppressionLe} onClick={() => void agir('suppression')}>
            Demander la suppression
          </button>
        </div>
        {message && <p className="rounded-xl bg-green-50 p-3 text-sm text-green-900 ring-1 ring-green-200">{message}</p>}
        {erreur && <MessageErreur>{erreur}</MessageErreur>}
      </div>
    </details>
  )
}

/**
 * « Carte introuvable » (P1-C3) : retrouver sa carte avec le téléphone ou l'e-mail de l'inscription. La réponse est
 * TOUJOURS la même message générique (audit F-12) : la page ne dit jamais si ce contact a une carte.
 */
function RetrouverCarte({ api }: { api: ClientApi }) {
  const [contact, setContact] = useState('')
  const [reponse, setReponse] = useState('')
  const [erreur, setErreur] = useState('')
  const [enCours, setEnCours] = useState(false)

  async function envoyer(e: FormEvent) {
    e.preventDefault()
    if (enCours) return
    setErreur('')
    setReponse('')
    if (!contact.trim()) return setErreur('Indiquez le téléphone ou l’e-mail donné à l’inscription.')
    setEnCours(true)
    try {
      const r = await api.retrouverCarte(contact.trim())
      setReponse(messageRechercheCarte(r.envoi))
    } catch (err) {
      // 400 (format du contact) et 429 seulement : jamais un « contact inconnu ».
      setErreur(err instanceof ErreurApi ? err.message : 'Envoi impossible pour le moment.')
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div className="mx-auto -mt-10 max-w-md px-4 pb-16">
      <form onSubmit={envoyer} className="carte space-y-3">
        <h2 className="titre-carte">Retrouver ma carte</h2>
        <div>
          <label className="etiquette" htmlFor="cp-retrouver">
            Téléphone ou e-mail donné à l’inscription
          </label>
          <input id="cp-retrouver" className="champ" inputMode="email" autoComplete="off" value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
        <button type="submit" className="bouton w-full" disabled={enCours}>
          Retrouver ma carte
        </button>
        {reponse && (
          <p className="rounded-xl bg-gray-50 p-3 text-sm text-gray-800 ring-1 ring-gray-200" role="status">
            {reponse}
          </p>
        )}
        {erreur && <MessageErreur>{erreur}</MessageErreur>}
      </form>
    </div>
  )
}

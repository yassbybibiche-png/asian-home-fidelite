import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useStore } from '../store'
import { useRoute } from '../router'
import type { Client, Commerce, CommercePublic, MessageClient } from '../types'
import { ErreurApi, estVueLimitee, type AccesCarte, type ClientApi, type ReponseCarte } from '../data/api'
import { activerCode, assurerJetonClient, avecJetonClient, memoireJoueur, memoriserJoueurCarte } from '../data/jeuApi'
import { hashSansLienAcces, idCarteDuParam, lienAccesDuHash, memoireJetons } from '../lib/jetonCarte'
import { CarteFidelite } from '../components/CarteFidelite'
import { InvitationAvis } from '../components/InvitationAvis'
import { SqueletteCarte } from '../components/Squelette'
import { BadgeDemo, BoutonCopier, EncartWallet, LienConfidentialite, LogoCommerce, MessageErreur, PiedPublic, telecharger } from '../components/ui'
import { dateRelative } from '../lib/format'
import {
  activationRecue,
  compteARebours,
  historiqueCarte,
  intervalleRecalcul,
  jourMois,
  messageRechercheCarte,
  prochaineBorne,
  surveillerBorne,
  vueGain,
  type ActivationAffichee,
  type GainDuJour,
  type GainEnCours,
  type LigneHistorique,
  type LotHistorique,
} from '../lib/carte'
import { lienCourtCarte } from '../lib/relances'
import { estAsianHome, VISUELS } from '../lib/visuels'
import { configRattrapage, peutCompleterProfil } from '../lib/programme'
import { nomFichierExportClient } from '../lib/rgpd'
import { HorsLignePublic, MessagePublic } from './Jouer'
import { CommutateurLangue, useLangue } from '../components/Langue'
import { localeDate } from '../lib/langue'
import { Confirmation } from '../components/Confirmation'
import { TEXTE_GAIN_SANS_CODE } from '../lib/animationRoue'

/** Texte traduit dans la langue choisie (pages clientes). */
function Traduit({ texte }: { texte: string }) {
  return <>{useLangue().t(texte)}</>
}

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
  const { t } = useLangue()
  return (
    <section className="carte space-y-3" aria-label={t('Messages')}>
      <h2 className="titre-carte">
        {t('Messages')}{' '}
        {/* Pastille « nouveau » : étiquette, text-xs conservé (P2-Q1). */}
        {nonLus > 0 && <span className="ml-1 rounded-full bg-magenta-600 px-2 py-0.5 text-xs font-bold text-white">{nonLus} nouveau{nonLus > 1 ? 'x' : ''}</span>}
      </h2>
      <ul className="space-y-3">
        {tries.slice(0, 10).map((m) => (
          <li key={m.id} className={`rounded-xl p-3 ring-1 ${m.lu ? 'bg-gray-50 ring-gray-900/5' : 'bg-amber-50 ring-amber-200'}`}>
            <p className="text-gray-900">{m.texte}</p>
            <p className="mt-1 text-sm text-gray-600">
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

/** Libellé d'historique affiché (P2-Q1, revue Codex point 5) : les préfixes fixes sont traduits, les noms
 *  (récompense, lot) ne le sont pas. historiqueCarte() reste en français (épinglé par
 *  carte-pwa-p1-c3.test.ts:346) — l'adaptation se fait ici, par type ; l'échange n'a rien à traduire
 *  (libellé du catalogue + « (−N points) », identique en anglais). Le contrat entre les libellés FR et
 *  cet adaptateur est testé dans tests/vouvoiement-couverture-p2-q1.test.ts. */
function libelleHistorique(l: LigneHistorique, t: (fr: string, valeurs?: Record<string, string | number>) => string): string {
  switch (l.type) {
    case 'visite':
      return t('Visite validée (+1 tampon)')
    case 'recompense':
      return t('Récompense remise : {libelle}', { libelle: l.libelle.replace('Récompense remise : ', '') })
    case 'defi':
      return t('Défi réussi : {recompense}', { recompense: l.libelle.replace('Défi réussi : ', '') })
    case 'roue': {
      const m = /^Roue : (.*) \((retiré|non retiré, expiré|à retirer aujourd’hui)\)$/.exec(l.libelle)
      if (!m) return l.libelle
      return t('Roue : {lot} ({statut})', { lot: m[1], statut: t(m[2]) })
    }
    default:
      return l.libelle
  }
}

/** Historique des visites et des lots (P1-C3), replié : la carte et ses boutons restent en haut de page. */
function Historique({ client, lotsRoue }: { client: Client; lotsRoue: LotHistorique[] }) {
  const lignes = historiqueCarte(client, lotsRoue)
  const { langue, t } = useLangue()
  return (
    <details className="carte">
      <summary className="titre-carte min-h-11 cursor-pointer">{t('Historique des visites et des lots')}</summary>
      {lignes.length ? (
        <ul className="mt-3 divide-y divide-gray-100">
          {lignes.map((l, i) => (
            <li key={`${l.date}-${i}`} className="flex items-baseline justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 text-gray-900">{libelleHistorique(l, t)}</span>
              <span className="shrink-0 text-sm text-gray-600">{new Date(l.date).toLocaleDateString(localeDate(langue), { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-gray-600">{t('Aucune visite pour l’instant : votre premier tampon arrive au comptoir.')}</p>
      )}
    </details>
  )
}

/** Lien court personnel (P1-C3) : /c/<id> redirige vers la carte ; à garder ou à s'envoyer. */
function LienCourt({ lien }: { lien: string }) {
  const { t } = useLangue()
  return (
    <section className="carte space-y-2" aria-label={t('Votre lien personnel')}>
      <p className="text-sm text-gray-700">
        {t('Votre lien personnel :')} <span className="font-mono font-semibold break-all text-gray-900">{lien.replace(/^https?:\/\//, '')}</span>
      </p>
      <BoutonCopier texte={lien} libelle={t('Copier mon lien')} className="bouton-secondaire w-full" />
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
  gains,
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
  /** Gains de la roue en cours (R4), juste sous la carte : en attente, à utiliser, code affiché. */
  gains?: ReactNode
}) {
  const { t } = useLangue()
  if (!commerce.actif) return <MessagePublic titre={commerce.nom}>La carte de fidélité de ce commerce n’est plus disponible.</MessagePublic>
  return (
    <div className="mx-auto max-w-md space-y-4 px-4 pt-2 pb-10">
      <CommutateurLangue />
      {estAsianHome(commerce) && (
        <picture className="block">
          <source srcSet={VISUELS.tableSushisPetit} type="image/webp" />
          <img
            src={VISUELS.tableSushis}
            alt="Table dressée chez Asian Home Paris : bao buns, plateau de sushis et cocktails"
            className="h-80 w-full rounded-3xl object-cover shadow-relief ring-1 ring-gray-900/5"
          />
        </picture>
      )}
      <CarteFidelite client={client} commerce={commerce} animer gainDuJour={gainDuJour} />
      {gains}
      {lienCourt && <LienCourt lien={lienCourt} />}
      {actions}
      <BoiteReception messages={client.messages ?? []} commerce={commerce} />
      <Historique client={client} lotsRoue={lotsRoue} />
      <a href={`#/jouer/${commerce.id}`} className="bouton w-full">
        {t('🎡 Tourner la roue du jour')}
      </a>
      {menu && (
        <a href={`#/menu/${commerce.id}`} className="bouton-secondaire w-full">
          {t('📖 Voir le menu')}
        </a>
      )}
      {estAsianHome(commerce) && (
        <section className="carte space-y-3" aria-label="Le restaurant">
          <h2 className="titre-carte">{t('Le restaurant')}</h2>
          <picture className="block">
            <source srcSet={VISUELS.interieurPetit} type="image/webp" />
            <img
              src={VISUELS.interieur}
              alt="Salle d’Asian Home Paris : plafond d’ombrelles et tables dressées"
              loading="lazy"
              className="h-64 w-full rounded-2xl object-cover"
            />
          </picture>
          <picture className="block">
            <source srcSet={VISUELS.interieurSalonPetit} type="image/webp" />
            <img
              src={VISUELS.interieurSalon}
              alt="Coin salon d’Asian Home Paris : fauteuils velours bleu nuit et rideaux violets"
              loading="lazy"
              className="h-48 w-full rounded-2xl object-cover"
            />
          </picture>
          <p className="text-sm text-gray-700">Restaurant asiatique halal, au Pré-Saint-Gervais.</p>
        </section>
      )}
      <EncartWallet demo={demo} replie />
      {commerce.coordonnees && <p className="text-center text-sm text-gray-600">{commerce.coordonnees}</p>}
      <p className="text-center text-sm text-gray-600">{pied}</p>
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
          <BadgeDemo>Démo</BadgeDemo> <Traduit texte="Données stockées dans ce navigateur uniquement." />
        </>
      }
    />
  )
}

function stockageLocal(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

/** Mode API : la carte vient du serveur (sans téléphone ni e-mail), rafraîchie au retour sur la page. */
function CarteApi({ api: apiServeur }: { api: ClientApi }) {
  const { param } = useRoute()
  // `#/carte/<id>?acces=<lien>` (P0-S7) : l'identifiant, et le lien d'accès à usage unique à échanger une fois.
  const id = idCarteDuParam(param)
  const jetons = useMemo(() => memoireJetons(stockageLocal()), [])
  const api = useMemo(() => avecJetonClient(apiServeur, jetons), [apiServeur, jetons])
  const essaisJeton = useRef(new Set<string>())
  const [lienRefuse, setLienRefuse] = useState(false)
  const [donnees, setDonnees] = useState<{
    client: Client
    commerce: CommercePublic
    menu: boolean
    gainDuJour: GainDuJour | null
    lots: LotHistorique[]
    gains: GainEnCours[]
    acces?: AccesCarte
  } | null>(null)
  const [limitee, setLimitee] = useState<{ tampons: number; commerce: CommercePublic; gainDuJour: GainDuJour | null; acces: AccesCarte } | null>(null)
  const [erreur, setErreur] = useState<'introuvable' | 'inactif' | 'horsLigne' | null>(null)
  const { t } = useLangue()

  const charger = useCallback(() => {
    if (!id) return setErreur('introuvable')
    // Relu à chaque chargement : le QR d'accès peut arriver sur une carte déjà ouverte (même onglet, nouveau fragment).
    const lien = lienAccesDuHash(window.location.hash)
    if (lien) {
      // Usage unique : retiré de l'adresse avant même l'échange (ni historique, ni favori, ni partage).
      window.history.replaceState(window.history.state, '', hashSansLienAcces(window.location.href))
      setLienRefuse(false)
    }
    void (async () => {
      const { lienRefuse: refuse } = await assurerJetonClient(api, jetons, id, { lien, dejaEssaye: essaisJeton.current })
      if (refuse) setLienRefuse(true)
      let r: ReponseCarte
      try {
        r = await api.carte(id)
      } catch (e) {
        // Jeton refusé (révoqué depuis un autre appareil, ou par le commerce) : oublié, la carte se relit sans.
        if (!(e instanceof ErreurApi && e.statut === 401 && jetons.lire(id))) throw e
        jetons.ecrire(id, null)
        r = await api.carte(id)
      }
      // Gain de la roue du jour pas encore retiré (P1-C3) : rappelé sur la carte avec son code, valable aujourd'hui.
      const gainDuJour = r.jeu.codeDuJour && r.jeu.lotDuJour && !r.jeu.remisDuJour ? { lot: r.jeu.lotDuJour, code: r.jeu.codeDuJour } : null
      setErreur(null)
      if (estVueLimitee(r)) {
        setDonnees(null)
        setLimitee({ tampons: r.client.tampons, commerce: r.commerce, gainDuJour, acces: r.acces })
        return
      }
      setLimitee(null)
      // Carte ouverte avec le jeton de ce téléphone (P0-S7, ex. récupérée au comptoir) : la page de jeu la reprend.
      if (r.acces?.jeton) memoriserJoueurCarte(memoireJoueur(stockageLocal(), r.commerce.id), jetons, r.client)
      // Asian Home : le menu public affiche la vraie carte en repli tant que le
      // commerçant n'a pas enregistré son propre menu — le lien est donc visible.
      setDonnees({
        client: r.client,
        commerce: r.commerce,
        menu: !!r.menuDisponible || estAsianHome(r.commerce),
        gainDuJour,
        lots: r.historiqueLots ?? [],
        gains: r.gainsEnCours ?? [],
        acces: r.acces,
      })
      // Messages affichés = lus (le badge « nouveau » reste visible pendant cette ouverture).
      if (r.client.messages?.some((m) => !m.lu)) api.marquerLus(id).catch(() => {})
    })().catch((e) => setErreur(e instanceof ErreurApi && e.statut === 404 ? 'introuvable' : e instanceof ErreurApi && e.statut === 409 ? 'inactif' : 'horsLigne'))
    // `param` (et non `id` seul) : `#/carte/<id>?acces=…` sur la même carte doit relancer le chargement.
  }, [api, id, jetons, param])

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
  // Vue limitée (P0-S7) déjà affichée : elle reste affichée hors ligne, comme une carte complète.
  if (limitee) return <VueLimitee api={api} {...limitee} lienRefuse={lienRefuse} />
  if (erreur === 'horsLigne' && !donnees) return <HorsLignePublic onReessayer={charger} />
  if (!donnees) return <SqueletteCarte libelle={t('Un instant, votre carte arrive.')} />
  return (
    <Carte
      client={donnees.client}
      commerce={donnees.commerce}
      demo={!!donnees.commerce.demo}
      menu={donnees.menu}
      gainDuJour={donnees.gainDuJour}
      lotsRoue={donnees.lots}
      lienCourt={lienCourtCarte(window.location.origin, donnees.client.id)}
      gains={<GainsRoue api={api} jetons={jetons} commerceId={donnees.commerce.id} clientId={donnees.client.id} gains={donnees.gains} onBorne={charger} />}
      actions={
        <>
          {donnees.acces?.ancienLien && donnees.acces.graceJusquAu && <BandeauGrace jusquAu={donnees.acces.graceJusquAu} />}
          <FormulairesProgramme api={api} client={donnees.client} commerce={donnees.commerce} onMaj={charger} />
          <MesDonnees api={api} client={donnees.client} commerce={donnees.commerce} onMaj={charger} />
          {donnees.acces?.jeton && <DeconnecterAppareils api={api} clientId={donnees.client.id} jeton={jetons.lire(donnees.client.id)?.jeton ?? null} onFait={() => (jetons.ecrire(donnees.client.id, null), charger())} />}
        </>
      }
      pied={
        <>
          {donnees.commerce.demo && <BadgeDemo>Démo</BadgeDemo>}
          {' '}
          {t(erreur === 'horsLigne' ? 'Hors ligne : carte affichée telle qu’au dernier chargement.' : 'Carte à jour.')}
        </>
      }
    />
  )
}

/** Heure courante, relue toutes les `intervalleMs` (1 s : compte à rebours d'un code ; 30 s : gains en cours ; null : jamais). */
function useMaintenant(intervalleMs: number | null): Date {
  const [maintenant, setMaintenant] = useState(() => new Date())
  useEffect(() => {
    setMaintenant(new Date())
    if (intervalleMs === null) return
    const minuterie = window.setInterval(() => setMaintenant(new Date()), intervalleMs)
    return () => window.clearInterval(minuterie)
  }, [intervalleMs])
  return maintenant
}

/**
 * Rechargement unique de la carte à la prochaine borne de statut (revue Codex R4, F2) : le serveur passe alors le gain
 * à « inactif » (minuit) ou l'expire (J+30). Borne calculée à la réception des gains : un recalcul local qui la franchit
 * avant le minuteur n'annule pas ce rechargement.
 */
function useRechargementAuxBornes(gains: GainEnCours[], recharger: () => void) {
  const borne = useMemo(() => prochaineBorne(gains, new Date())?.getTime() ?? null, [gains])
  useEffect(() => (borne === null ? undefined : surveillerBorne(new Date(borne), recharger)), [borne, recharger])
}

/**
 * Gains de la roue sur la carte (R4, maquettes §3) : en attente (« Utilisable du … au … »), à utiliser (bouton
 * « Utiliser mon gain » → activation, jeton client de ce téléphone exigé), code affiché avec son compte à rebours de
 * 10 minutes, puis réactivable tant que le gain est valable. Un gain expiré disparaît : l'historique le garde.
 */
function GainsRoue({
  api,
  jetons,
  commerceId,
  clientId,
  gains,
  onBorne,
}: {
  api: ClientApi
  jetons: ReturnType<typeof memoireJetons>
  commerceId: string
  clientId: string
  gains: GainEnCours[]
  /** Recharge la carte (une fois par borne de statut franchie, page restée ouverte). */
  onBorne(): void
}) {
  const [activations, setActivations] = useState<Record<string, ActivationAffichee>>({})
  const [enCours, setEnCours] = useState<string | null>(null)
  const [erreurs, setErreurs] = useState<Record<string, string>>({})
  const maintenant = useMaintenant(intervalleRecalcul(gains, Object.keys(activations).length > 0))
  useRechargementAuxBornes(gains, onBorne)
  const { langue, t } = useLangue()
  const vues = gains.flatMap((g) => {
    const vue = vueGain(g, activations[g.tirageId], maintenant)
    return vue ? [{ g, vue }] : []
  })
  if (!vues.length) return null
  const date = (d: Date) => jourMois(d, localeDate(langue))

  async function utiliser(tirageId: string) {
    if (enCours) return
    setEnCours(tirageId)
    setErreurs((e) => ({ ...e, [tirageId]: '' }))
    const issue = await activerCode(api, jetons, { commerceId, clientId, tirageId })
    setEnCours(null)
    // Décalage d'horloge mesuré à la réception : le compte à rebours suit l'heure du serveur (revue Codex R4, F1).
    if (issue.ok) setActivations((a) => ({ ...a, [tirageId]: activationRecue(issue.activation, new Date()) }))
    else setErreurs((e) => ({ ...e, [tirageId]: issue.message }))
  }

  return (
    <div className="space-y-3" data-gains-roue>
      {vues.map(({ g, vue }) => (
        <section key={g.tirageId} className="carte space-y-2 text-center" aria-label={t('Votre gain de la roue')} data-gain={vue.etat}>
          <p className="titre-carte">{t('🎁 Votre gain : {lot}', { lot: g.lot })}</p>
          {vue.etat === 'enAttente' ? (
            <>
              <p className="font-semibold text-gray-900">{t('Utilisable du {du} au {au}.', { du: date(vue.du), au: date(vue.au) })}</p>
              <p className="text-sm text-gray-600">{t('Le code s’affichera quand vous serez au comptoir.')}</p>
            </>
          ) : vue.etat === 'direct' ? (
            <>
              <p className="font-semibold text-gray-900">{t('À retirer directement au comptoir aujourd’hui.')}</p>
              <p className="text-sm text-gray-600">{t(TEXTE_GAIN_SANS_CODE)}</p>
            </>
          ) : vue.etat === 'code' ? (
            <div className="space-y-2" data-code-active>
              <p className="text-sm text-gray-600">{t('Présentez ce code au comptoir :')}</p>
              <p className="rounded-xl border-2 border-dashed border-magenta-500 bg-magenta-500/10 py-4 font-mono text-4xl font-extrabold tracking-[0.3em] text-gray-900 select-all">
                {vue.code}
              </p>
              <p className="text-base font-bold text-gray-900" role="timer" data-compte-a-rebours>
                {t('Il expire dans {reste} — passé ce délai, réactivez-le ici.', { reste: compteARebours(vue.resteMs) })}
              </p>
            </div>
          ) : (
            <>
              <p className="font-semibold text-gray-900">{t('Utilisable jusqu’au {au}.', { au: date(vue.au) })}</p>
              {vue.reactiver && <p className="text-sm text-gray-600">{t('Code expiré : appuyez de nouveau au comptoir pour en afficher un nouveau.')}</p>}
              <button type="button" className="bouton w-full" disabled={enCours !== null} onClick={() => void utiliser(g.tirageId)} data-utiliser-gain>
                {enCours === g.tirageId ? t('Un instant…') : t('Utiliser mon gain')}
              </button>
              <p className="text-sm text-gray-600">{t('Appuyez au comptoir : le code ne s’affiche que 10 minutes.')}</p>
            </>
          )}
          {/* Message du serveur (en français, comme les autres erreurs de l'API). */}
          {erreurs[g.tirageId] && <MessageErreur>{erreurs[g.tirageId]}</MessageErreur>}
        </section>
      ))}
    </div>
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
  const { t } = useLangue()

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
          <h2 className="titre-carte">{t('Votre profil')}</h2>
          <p className="text-sm text-gray-600">{t('Pour recevoir votre récompense d’anniversaire et des offres sur vos plats préférés.')}</p>
          <div>
            <label className="etiquette" htmlFor="cp-anniversaire">
              {t('Anniversaire (JJ/MM)')}
              {client.anniversaire ? t(' — enregistré : {valeur}', { valeur: `${client.anniversaire.slice(3)}/${client.anniversaire.slice(0, 2)}` }) : ''}
            </label>
            <input id="cp-anniversaire" className="champ" inputMode="numeric" placeholder="21/03" value={anniversaire} onChange={(e) => setAnniversaire(e.target.value)} />
          </div>
          <div>
            <label className="etiquette" htmlFor="cp-plat">
              {t('Plat préféré')}
              {client.platPrefere ? t(' — enregistré : {valeur}', { valeur: client.platPrefere }) : ''}
            </label>
            <input id="cp-plat" className="champ" maxLength={80} placeholder="ex : poulet satay" value={plat} onChange={(e) => setPlat(e.target.value)} />
          </div>
          <button type="submit" className="bouton-secondaire w-full" disabled={enCours || (!anniversaire.trim() && !plat.trim())}>
            {t('Enregistrer mon profil')}
          </button>
        </form>
      )}
      {rattrapage.actif && (
        <form onSubmit={envoyerRattrapage} className="carte space-y-3">
          <h2 className="titre-carte">{t('J’ai oublié de scanner')}</h2>
          <p className="text-sm text-gray-600">{t('Signalez une visite oubliée (sous {jours} jours) : le restaurant la validera et votre tampon + vos points seront crédités.', { jours: rattrapage.delaiJours })}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="etiquette" htmlFor="cp-date">
                {t('Date de la visite')}
              </label>
              <input id="cp-date" className="champ" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div>
              <label className="etiquette" htmlFor="cp-montant">
                {t('Montant payé (€)')}
              </label>
              <input id="cp-montant" className="champ" inputMode="decimal" placeholder="24,50" value={montant} onChange={(e) => setMontant(e.target.value)} required />
            </div>
          </div>
          <div>
            <label className="etiquette" htmlFor="cp-ticket">
              {t('N° de ticket (optionnel)')}
            </label>
            <input id="cp-ticket" className="champ" maxLength={80} placeholder="ex : T-1234" value={ticket} onChange={(e) => setTicket(e.target.value)} />
          </div>
          <button type="submit" className="bouton-secondaire w-full" disabled={enCours}>
            {t('Envoyer ma demande')}
          </button>
          {enAttente.length > 0 && (
            <p className="text-sm text-gray-700">
              {t('{n} demande{s} en attente de validation par le restaurant.', { n: enAttente.length, s: enAttente.length > 1 ? 's' : '' })}
            </p>
          )}
        </form>
      )}
      {message && <p className="rounded-xl bg-green-50 p-3 text-sm text-green-900 ring-1 ring-green-200">{t(message)}</p>}
      {erreur && <MessageErreur>{t(erreur)}</MessageErreur>}
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
  const [demande, setDemande] = useState(false)

  const { langue, t } = useLangue()

  async function agir(action: 'donnees' | 'suppression') {
    if (enCours) return
    setErreur('')
    setMessage('')
    if (!contact.trim()) return setErreur('Indiquez le téléphone ou l’e-mail donné à l’inscription.')
    if (action === 'suppression') return setDemande(true)
    setEnCours(true)
    try {
      telecharger(nomFichierExportClient(client.id), await api.donneesCarte(client.id, contact.trim()))
      setMessage('Vos données ont été téléchargées (fichier CSV, lisible dans un tableur).')
    } catch (err) {
      setErreur(err instanceof ErreurApi ? err.message : 'Envoi impossible pour le moment.')
    } finally {
      setEnCours(false)
    }
  }

  async function confirmerSuppression() {
    if (enCours) return
    setDemande(false)
    setErreur('')
    setMessage('')
    if (!contact.trim()) return setErreur('Indiquez le téléphone ou l’e-mail donné à l’inscription.')
    setEnCours(true)
    try {
      await api.demanderSuppression(client.id, contact.trim())
      setMessage('Demande enregistrée : le restaurant supprimera votre carte et vos données.')
      onMaj()
    } catch (err) {
      setErreur(err instanceof ErreurApi ? err.message : 'Envoi impossible pour le moment.')
    } finally {
      setEnCours(false)
    }
  }

  return (
    <details className="carte">
      <summary className="titre-carte min-h-11 cursor-pointer">{t('Mes données personnelles')}</summary>
      <div className="mt-3 space-y-3">
        <p className="text-sm text-gray-600">
          {t('Recevez une copie de vos données ou demandez leur suppression.')} <LienConfidentialite commerceId={commerce.id} />
        </p>
        {client.demandeSuppressionLe && (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
            {t('Demande de suppression enregistrée le {date} : le restaurant va supprimer votre carte.', { date: new Date(client.demandeSuppressionLe).toLocaleDateString(localeDate(langue)) })}
          </p>
        )}
        <div>
          <label className="etiquette" htmlFor="cp-contact-rgpd">
            {t('Votre téléphone ou e-mail (celui de l’inscription)')}
          </label>
          <input id="cp-contact-rgpd" className="champ" inputMode="email" autoComplete="off" value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="bouton-secondaire min-h-11" disabled={enCours} onClick={() => void agir('donnees')}>
            {t('Recevoir mes données')}
          </button>
          <button type="button" className="bouton-secondaire min-h-11" disabled={enCours || !!client.demandeSuppressionLe} onClick={() => void agir('suppression')}>
            {t('Demander la suppression')}
          </button>
        </div>
        {demande && (
          <Confirmation
            recap={{
              titre: 'Demander la suppression ?',
              lignes: [['Données', 'Carte, tampons, points, historique']],
              confirmer: 'Demander la suppression',
              avertissement: 'Le restaurant la supprimera définitivement.',
            }}
            enCours={enCours}
            onConfirmer={() => void confirmerSuppression()}
            onAnnuler={() => setDemande(false)}
          />
        )}
        {message && <p className="rounded-xl bg-green-50 p-3 text-sm text-green-900 ring-1 ring-green-200">{message}</p>}
        {erreur && <MessageErreur>{erreur}</MessageErreur>}
      </div>
    </details>
  )
}

/**
 * Vue limitée (P0-S7) : carte ouverte SANS preuve d'accès sur ce téléphone (lien seul, lien court d'un SMS de relance,
 * autre téléphone) — le compteur de tampons et le gain du jour seulement. Le reste (prénom, points, messages,
 * historique, formulaires) demande le jeton de ce téléphone : lien d'accès du comptoir ou « Retrouver ma carte ».
 */
function VueLimitee({
  api,
  tampons,
  commerce,
  gainDuJour,
  acces,
  lienRefuse,
}: {
  api: ClientApi
  tampons: number
  commerce: CommercePublic
  gainDuJour: GainDuJour | null
  acces: AccesCarte
  lienRefuse: boolean
}) {
  const { langue, t } = useLangue()
  if (!commerce.actif) return <MessagePublic titre={commerce.nom}>La carte de fidélité de ce commerce n’est plus disponible.</MessagePublic>
  const affiches = Math.min(tampons, commerce.seuilTampons)
  const date = acces.graceJusquAu ? new Date(acces.graceJusquAu).toLocaleDateString(localeDate(langue)) : ''
  return (
    <>
      <div className="mx-auto max-w-md space-y-4 px-4 pt-2 pb-12">
        <CommutateurLangue />
        <section className="carte space-y-2 text-center" data-vue="limitee">
          <div className="flex justify-center">
            <LogoCommerce commerce={commerce} taille="md" />
          </div>
          <h1 className="titre-carte">{commerce.nom}</h1>
          <p className="text-3xl font-bold text-gray-900" data-tampons aria-label={`Tampons : ${affiches} sur ${commerce.seuilTampons}`}>
            {affiches} / {commerce.seuilTampons}
          </p>
          <p className="text-sm text-gray-600">{t('tampons sur cette carte')}</p>
          {gainDuJour && (
            <p className="alerte-succes">
              {t('Gain du jour à retirer : {lot}, code {code}', { lot: gainDuJour.lot, code: gainDuJour.code })}
            </p>
          )}
        </section>
        <section className="carte space-y-2" data-acces="limite">
          <h2 className="titre-carte">{t('Accès limité sur ce téléphone')}</h2>
          {lienRefuse && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200" role="alert">
              {t('Ce lien d’accès a expiré ou a déjà servi : demandez-en un nouveau.')}
            </p>
          )}
          <p className="text-sm text-gray-700">
            {t('Pour voir votre carte complète (points, messages, historique), ouvrez-la sur le téléphone utilisé à l’inscription, ou demandez au comptoir de vous montrer le QR d’accès à votre carte.')}
          </p>
          {acces.ancienLien && date && <p className="text-sm text-gray-700">{t('Ce lien ne suffira plus à ouvrir la carte après le {date}.', { date })}</p>}
        </section>
        <PiedPublic commerceId={commerce.id} />
      </div>
      <RetrouverCarte api={api} />
    </>
  )
}

/** Carte à ancien identifiant (P0-S7) : protégée sur ce téléphone ; son ancien lien seul n'ouvrira plus rien après la grâce. */
function BandeauGrace({ jusquAu }: { jusquAu: string }) {
  const { langue, t } = useLangue()
  return (
    <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200" role="note" data-grace>
      {t('Votre carte est maintenant protégée sur ce téléphone. Après le {date}, son ancien lien ou son ancien QR ne l’ouvriront plus seuls : gardez-la ici (ou ajoutez-la à l’écran d’accueil).', {
        date: new Date(jusquAu).toLocaleDateString(localeDate(langue)),
      })}
    </p>
  )
}

/** « Déconnecter tous mes appareils » (P0-S7) : révoque tous les jetons de la carte, celui de ce téléphone compris. */
function DeconnecterAppareils({ api, clientId, jeton, onFait }: { api: ClientApi; clientId: string; jeton: string | null; onFait(): void }) {
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState('')
  const [demande, setDemande] = useState(false)
  const { t } = useLangue()

  async function agir() {
    if (!jeton || enCours) return
    setDemande(false)
    setEnCours(true)
    setErreur('')
    try {
      await api.revoquerCarte(clientId, jeton)
      onFait()
    } catch (err) {
      setErreur(err instanceof ErreurApi ? err.message : 'Envoi impossible pour le moment.')
    } finally {
      setEnCours(false)
    }
  }

  return (
    <details className="carte">
      <summary className="titre-carte min-h-11 cursor-pointer">{t('Sécurité de ma carte')}</summary>
      <div className="mt-3 space-y-3">
        <p className="text-sm text-gray-600">{t('Téléphone perdu ou carte ouverte ailleurs ? Déconnectez-la partout : seul un lien d’accès du comptoir la rouvrira.')}</p>
        <button type="button" className="bouton-secondaire min-h-11 w-full" disabled={enCours || !jeton} onClick={() => setDemande(true)}>
          {t('Déconnecter tous mes appareils')}
        </button>
        {demande && (
          <Confirmation
            recap={{
              titre: t('Déconnecter tous mes appareils'),
              lignes: [['Téléphones', 'Tous, celui-ci compris']],
              confirmer: t('Déconnecter tous mes appareils'),
              avertissement: t('Déconnecter cette carte de tous les téléphones, celui-ci compris ? Pour la rouvrir en entier, il faudra un lien d’accès du comptoir.'),
            }}
            enCours={enCours}
            onConfirmer={() => void agir()}
            onAnnuler={() => setDemande(false)}
          />
        )}
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

  const { t } = useLangue()

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
        <h2 className="titre-carte">{t('Retrouver ma carte')}</h2>
        <div>
          <label className="etiquette" htmlFor="cp-retrouver">
            {t('Téléphone ou e-mail donné à l’inscription')}
          </label>
          <input id="cp-retrouver" className="champ" inputMode="email" autoComplete="off" value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
        <button type="submit" className="bouton w-full" disabled={enCours}>
          {t('Retrouver ma carte')}
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

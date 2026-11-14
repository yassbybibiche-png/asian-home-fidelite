import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MESSAGE_MODE_SERVEUR, useStore } from '../store'
import { useRoute } from '../router'
import type { CategorieMenu, CommercePublic, Menu, Produit, StatutCommande } from '../types'
import { ErreurApi, MESSAGE_HORS_LIGNE, type ClientApi, type CommandeClient } from '../data/api'
import { formaterPrix } from '../lib/points'
import { LogoCommerce, PiedPublic } from '../components/ui'
import { SqueletteMenu } from '../components/Squelette'
import { masquerPrixNonConfirmes, retirerPhotosDetachees } from '../data/menu-reel'
import { enregistrerTraductions, traduireErreur } from '../lib/langue'
import {
  ajouter,
  ajouterService,
  changerQuantite,
  cleLigne,
  clesStockage,
  empreintePanier,
  estCommandable,
  estTerminee,
  ETAPES_SUIVI,
  INSTRUCTIONS_MAX,
  lignesAEnvoyer,
  lirePanier,
  majInstructions,
  nombreArticles,
  preparerEnvoi,
  prixLigne,
  prixUnitaire,
  QUANTITE_MAX,
  reconstruirePanier,
  retirer,
  suggestionApres,
  totalPanier,
  type EnvoiEnCours,
  type LignePanier,
} from '../lib/panier'
import { SERVICES_COMMANDE } from '../lib/servicesCommande'
import { animerAjoutPanier, prefereMouvementReduit, pulserPanier } from '../lib/volPanier'
import { HorsLignePublic, MessagePublic } from './Jouer'
import { CommutateurLangue, useLangue } from '../components/Langue'

/** Traductions de cette page différée : hors du dictionnaire initial (P2-Q1, bundle P2-Q2). */
enregistrerTraductions({
  // Écrans d’erreur (MessagePublic traduit le titre et le texte).
  'Commande à table': 'Order at your table',
  'QR code invalide': 'Invalid QR code',
  'Ce QR code n’est plus valide, demandez au personnel.': 'This QR code is no longer valid, please ask the staff.',
  'Commande indisponible': 'Ordering unavailable',
  'La commande à table n’est pas disponible pour le moment : adressez-vous au personnel.': 'Ordering at the table is not available right now: please ask the staff.',
  // En-tête, menu, panier.
  'Votre table': 'Your table',
  'Jouer et gagner': 'Play and win',
  'Ajouter': 'Add',
  'Ajouter : {nom}': 'Add: {nom}',
  'Choisir': 'Choose',
  'Indisponible': 'Unavailable',
  'Ce plat n’est pas disponible pour le moment.': 'This dish is not available right now.',
  'Ce plat se commande directement auprès du personnel.': 'Please order this dish directly from the staff.',
  'Options': 'Options',
  'inclus': 'included',
  'Instructions pour ce plat (optionnel)': 'Instructions for this dish (optional)',
  'ex : sans coriandre': 'e.g. no coriander',
  'Ajouter au panier · {prix}': 'Add to basket · {prix}',
  'Quantité : {nom}': 'Quantity: {nom}',
  'Un de moins : {nom}': 'One less: {nom}',
  'Un de plus : {nom}': 'One more: {nom}',
  'Retirer du panier : {nom}': 'Remove from basket: {nom}',
  'Voir le panier': 'View basket',
  '{n} article · {total}': '{n} item · {total}',
  '{n} articles · {total}': '{n} items · {total}',
  '← Continuer ma commande': '← Continue my order',
  'Votre panier': 'Your basket',
  'Votre panier est vide.': 'Your basket is empty.',
  '{prix} l’unité': '{prix} each',
  'Retirer': 'Remove',
  'Instructions pour la cuisine (optionnel)': 'Instructions for the kitchen (optional)',
  'Total': 'Total',
  'Le total est confirmé par le restaurant à la réception de la commande. Le paiement se fait sur place.':
    'The total is confirmed by the restaurant when it receives the order. Payment is made on site.',
  'Confirmer la commande': 'Confirm the order',
  'Envoi de la commande…': 'Sending the order…',
  'Votre panier est conservé : réessayez, la commande ne sera pas envoyée deux fois.': 'Your basket is kept: try again, the order will not be sent twice.',
  'Suivre ma commande': 'Track my order',
  // Suivi.
  'Votre commande': 'Your order',
  'Étapes de la commande': 'Order steps',
  'Hors ligne : statut affiché tel qu’au dernier chargement.': 'Offline: status shown as last loaded.',
  'Commander autre chose': 'Order something else',
  'Reçue': 'Received',
  'Acceptée': 'Accepted',
  'En préparation': 'Being prepared',
  'Servie': 'Served',
  'Refusée': 'Declined',
  'Votre commande est arrivée en cuisine : elle va être confirmée.': 'Your order has reached the kitchen: it will be confirmed shortly.',
  'La cuisine a accepté votre commande.': 'The kitchen has accepted your order.',
  'Vos plats sont en préparation.': 'Your dishes are being prepared.',
  'Votre commande a été servie. Bon appétit !': 'Your order has been served. Enjoy your meal!',
  'Nous sommes désolés : votre commande n’a pas pu être acceptée. Merci de vous adresser au personnel.':
    'We are sorry: your order could not be accepted. Please speak to the staff.',
  // Menu Appétit, lot 2 : fiche plat, rail, services, « Encore la même ».
  'Fermer': 'Close',
  'Quantité': 'Quantity',
  'À découvrir aussi': 'Also worth trying',
  'À votre service': 'At your service',
  'La demande part en cuisine, comme une commande — c’est gratuit.': 'The request goes to the kitchen like an order — it’s free.',
  'Demander': 'Request',
  'Demander : {nom}': 'Request: {nom}',
  'Service': 'Service',
  'Gratuit': 'Free',
  'Appeler le serveur': 'Call the waiter',
  'De l’eau': 'Some water',
  'Des baguettes': 'Chopsticks',
  'L’addition': 'The bill',
  'Encore la même': 'Same again',
  'Certains articles ne sont plus disponibles et n’ont pas été repris : {noms}': 'Some items are no longer available and were not added back: {noms}',
})

type Traduire = ReturnType<typeof useLangue>['t']

/** Statut en langage clair (titre du suivi et étapes). */
function libelleStatut(statut: StatutCommande, t: Traduire): string {
  if (statut === 'recue') return t('Reçue')
  if (statut === 'acceptee') return t('Acceptée')
  if (statut === 'en_preparation') return t('En préparation')
  if (statut === 'servie') return t('Servie')
  return t('Refusée')
}

/** Phrase sous le statut. Refus : excuse générique, sans motif (le personnel l'explique à la table). */
function messageStatut(statut: StatutCommande, t: Traduire): string {
  if (statut === 'recue') return t('Votre commande est arrivée en cuisine : elle va être confirmée.')
  if (statut === 'acceptee') return t('La cuisine a accepté votre commande.')
  if (statut === 'en_preparation') return t('Vos plats sont en préparation.')
  if (statut === 'servie') return t('Votre commande a été servie. Bon appétit !')
  return t('Nous sommes désolés : votre commande n’a pas pu être acceptée. Merci de vous adresser au personnel.')
}

/** Relecture du suivi : toutes les 10 s, onglet visible seulement. */
const INTERVALLE_SUIVI_MS = 10_000

/** Stockage de session (panier, envoi en cours, secret de suivi) : absent ou bloqué = mémoire de la page seulement. */
function session(): Storage | null {
  try {
    return sessionStorage
  } catch {
    return null
  }
}
const lire = (cle: string) => {
  try {
    return session()?.getItem(cle) ?? null
  } catch {
    return null
  }
}
const ecrire = (cle: string, valeur: string | null) => {
  try {
    if (valeur === null) session()?.removeItem(cle)
    else session()?.setItem(cle, valeur)
  } catch {
    // Stockage plein ou interdit : la commande reste possible, sa reprise après rechargement non.
  }
}

type Chargement = { table: string; menu: Menu; commerce: CommercePublic }
type Suivi = { commande: CommandeClient; secret: string }
/** « Encore la même » : panier rebâti depuis la commande suivie, et ce qui n'a pas pu être repris. */
type Reprise = ReturnType<typeof reconstruirePanier>
type SetPanier = (f: (p: LignePanier[]) => LignePanier[]) => void

/** Nom d'une demande de service dans la langue de la page ; `undefined` pour un plat. */
function nomService(id: string, t: Traduire): string | undefined {
  if (id === 'service-serveur') return t('Appeler le serveur')
  if (id === 'service-eau') return t('De l’eau')
  if (id === 'service-baguettes') return t('Des baguettes')
  if (id === 'service-addition') return t('L’addition')
  return undefined
}

/**
 * Commande à table #/commande/<commerceId>/<jetonTable> (Expérience 10/10, lot 2) : MODE COMMANDE, rapide et
 * utilitaire — aucune animation décorative sur le chemin d'action. Le serveur valide le jeton de la table et
 * recalcule tout le panier depuis le menu en base ; ici, on n'affiche que des montants indicatifs.
 */
export default function Commande() {
  const { api } = useStore()
  const { param, param2 } = useRoute()
  if (!api) return <MessagePublic titre="Commande à table">{MESSAGE_MODE_SERVEUR}</MessagePublic>
  if (!param || !param2) return <QrInvalide />
  return <CommandeApi key={`${param}/${param2}`} api={api} commerceId={param} jetonTable={param2} />
}

function QrInvalide() {
  return <MessagePublic titre="QR code invalide">Ce QR code n’est plus valide, demandez au personnel.</MessagePublic>
}

function CommandeApi({ api, commerceId, jetonTable }: { api: ClientApi; commerceId: string; jetonTable: string }) {
  const [donnees, setDonnees] = useState<Chargement | null>(null)
  const [erreur, setErreur] = useState<'qr' | 'indisponible' | 'horsLigne' | null>(null)
  const [suivi, setSuivi] = useState<Suivi | null>(null)
  const [vue, setVue] = useState<'menu' | 'panier' | 'suivi'>('menu')
  const [reprise, setReprise] = useState<Reprise | null>(null)
  const { t } = useLangue()

  const charger = useCallback(() => {
    setErreur(null)
    Promise.all([api.tableCommande(commerceId, jetonTable), api.menu(commerceId)]).then(
      ([{ table }, { menu, commerce }]) => setDonnees({ table, menu, commerce }),
      (e) => setErreur(e instanceof ErreurApi && e.statut === 404 ? 'qr' : e instanceof ErreurApi && e.statut === 409 ? 'indisponible' : 'horsLigne'),
    )
  }, [api, commerceId, jetonTable])
  useEffect(charger, [charger])

  // Reprise après rechargement : la dernière commande passée depuis cette table sur ce téléphone (stockage de
  // session seulement : l'URL reste celle de la table).
  useEffect(() => {
    const id = lire(clesStockage.derniere(commerceId, jetonTable))
    const secret = id && lire(clesStockage.secret(commerceId, id))
    if (!id || !secret) return
    api.suiviCommande(commerceId, id, secret).then(
      (commande) => (setSuivi({ commande, secret }), setVue('suivi')),
      (e) => {
        // Secret refusé / commande disparue : on oublie ce suivi ; panne réseau : on le garde pour plus tard.
        if (e instanceof ErreurApi && e.statut === 404) ecrire(clesStockage.derniere(commerceId, jetonTable), null)
      },
    )
  }, [api, commerceId, jetonTable])

  if (erreur === 'qr') return <QrInvalide />
  if (erreur === 'indisponible') return <MessagePublic titre="Commande indisponible">La commande à table n’est pas disponible pour le moment : adressez-vous au personnel.</MessagePublic>
  if (erreur === 'horsLigne' && !donnees) return <HorsLignePublic onReessayer={charger} />
  if (!donnees) return <SqueletteMenu libelle={t('Un instant, le menu arrive.')} />

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 pt-4 pb-32">
      <header className="hero-sombre -mx-4 rounded-b-3xl px-4 pt-2 pb-4 shadow-relief">
        {/* Commutateur FR / EN (P1-3) : en tête de l'en-tête sombre, comme sur #/menu — le parcours de commande est le moment où l'erreur coûte un plat. */}
        <CommutateurLangue sombre />
        <div className="flex items-center gap-3">
        <LogoCommerce commerce={donnees.commerce} taille="md" />
        <div className="min-w-0 flex-1">
          <p className="titre-magenta truncate text-lg">{donnees.commerce.nom}</p>
          <p className="surtitre-sombre">{t('Votre table')}</p>
          <h1 className="truncate text-2xl font-bold text-white">{donnees.table}</h1>
          {/* R3 : la roue depuis la même table — le tirage retiendra la table d'origine (jeton du QR). Un lien simple. */}
          <a href={`#/jouer/${encodeURIComponent(commerceId)}/${encodeURIComponent(jetonTable)}`} className="mt-1 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-magenta-300 underline" data-lien-jeu-table>
            <span aria-hidden>🎡</span> {t('Jouer et gagner')}
          </a>
        </div>
        </div>
      </header>
      {vue === 'suivi' && suivi ? (
        <VueSuivi
          api={api}
          commerceId={commerceId}
          suivi={suivi}
          onMaj={setSuivi}
          onNouvelle={() => setVue('menu')}
          onRecommander={() => {
            // Même menu que celui affiché par Prise (prix non confirmés masqués = non commandables) ; l'envoi suit
            // ensuite le flux normal, avec une nouvelle clé d'idempotence (l'envoi précédent a été soldé et effacé).
            setReprise(reconstruirePanier(suivi.commande.lignes, masquerPrixNonConfirmes(donnees.menu), !!donnees.commerce.servicesCommande))
            setVue('panier')
            window.scrollTo(0, 0)
          }}
        />
      ) : (
        <Prise
          api={api}
          donnees={donnees}
          commerceId={commerceId}
          jetonTable={jetonTable}
          vue={vue === 'panier' ? 'panier' : 'menu'}
          setVue={setVue}
          suiviEnCours={suivi}
          reprise={reprise}
          onRepriseAppliquee={() => setReprise(null)}
          onCommandee={(s) => {
            setSuivi(s)
            setVue('suivi')
            window.scrollTo(0, 0)
          }}
          onQrInvalide={() => setErreur('qr')}
        />
      )}
      <PiedPublic commerceId={commerceId} />
    </div>
  )
}

/** Menu en mode Commande + panier : de l'ajout du premier plat à la confirmation. */
function Prise({
  api,
  donnees,
  commerceId,
  jetonTable,
  vue,
  setVue,
  suiviEnCours,
  reprise,
  onRepriseAppliquee,
  onCommandee,
  onQrInvalide,
}: {
  api: ClientApi
  donnees: Chargement
  commerceId: string
  jetonTable: string
  vue: 'menu' | 'panier'
  setVue: (v: 'menu' | 'panier' | 'suivi') => void
  suiviEnCours: Suivi | null
  reprise?: Reprise | null
  onRepriseAppliquee?: () => void
  onCommandee: (s: Suivi) => void
  onQrInvalide: () => void
}) {
  const { langue, t } = useLangue()
  const clePanier = clesStockage.panier(commerceId, jetonTable)
  const cleEnvoi = clesStockage.envoi(commerceId, jetonTable)
  const [panier, setPanier] = useState<LignePanier[]>(() => lirePanier(lire(clePanier)))
  const [instructions, setInstructions] = useState('')
  const [envoiEnCours, setEnvoiEnCours] = useState(false)
  const verrou = useRef(false)
  const [erreur, setErreur] = useState<{ reseau: boolean; message: string } | null>(null)
  useEffect(() => ecrire(clePanier, panier.length ? JSON.stringify(panier) : null), [clePanier, panier])
  // Plat dont la fiche (feuille basse) est ouverte, depuis une ligne de catégorie ou le rail Signatures.
  const [fiche, setFiche] = useState<Produit | null>(null)

  // « Encore la même » : panier remplacé UNE fois par la reprise (garde par identité), puis la reprise est rendue à
  // CommandeApi pour qu'un retour plus tard sur cette vue ne l'applique pas une seconde fois. Les articles non repris
  // restent signalés tant que la vue panier est ouverte.
  const repriseAppliquee = useRef<Reprise | null>(null)
  const [nonRepris, setNonRepris] = useState<string[]>([])
  useEffect(() => {
    if (!reprise || repriseAppliquee.current === reprise) return
    repriseAppliquee.current = reprise
    setPanier(reprise.panier)
    setNonRepris(reprise.ignores)
    setErreur(null)
    onRepriseAppliquee?.()
  }, [reprise, onRepriseAppliquee])
  useEffect(() => {
    if (vue !== 'panier') setNonRepris([])
  }, [vue])

  // Mêmes données et photos que #/menu (prix non confirmés masqués, photos détachées retirées) : uniquement le menu
  // ENREGISTRÉ — c'est celui que le serveur relit pour calculer la commande.
  const categories = useMemo(
    () => retirerPhotosDetachees(masquerPrixNonConfirmes(donnees.menu)).categories.filter((c) => c.produits.length),
    [donnees.menu],
  )
  // Tous les plats dans l'ordre du menu (un plat présent dans deux catégories compte une fois) ; rail Signatures =
  // ceux qui ont une vraie photo et se commandent.
  const plats = useMemo(() => {
    const tous = categories.flatMap((c) => c.produits)
    return tous.filter((p, i) => tous.findIndex((x) => x.id === p.id) === i)
  }, [categories])
  const signatures = useMemo(() => plats.filter((p) => p.photo && estCommandable(p)), [plats])
  const articles = nombreArticles(panier)
  const total = totalPanier(panier)

  async function confirmer() {
    if (verrou.current || !panier.length) return
    verrou.current = true
    setEnvoiEnCours(true)
    setErreur(null)
    // Clé d'idempotence + secret de suivi : tirés AVANT le premier envoi, rangés, et réutilisés tels quels tant que
    // le panier ne change pas — un nouvel essai après une réponse perdue retrouve la même commande et son suivi.
    let precedent: EnvoiEnCours | null = null
    try {
      precedent = JSON.parse(lire(cleEnvoi) ?? 'null')
    } catch {
      precedent = null
    }
    const envoi = preparerEnvoi(precedent, empreintePanier(panier, instructions))
    ecrire(cleEnvoi, JSON.stringify(envoi))
    try {
      const { commande } = await api.commander(commerceId, {
        jetonTable,
        lignes: lignesAEnvoyer(panier),
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        cleIdempotence: envoi.cleIdempotence,
        secret: envoi.secret,
      })
      ecrire(clesStockage.secret(commerceId, commande.id), envoi.secret)
      ecrire(clesStockage.derniere(commerceId, jetonTable), commande.id)
      ecrire(cleEnvoi, null)
      setPanier([])
      setInstructions('')
      onCommandee({ commande, secret: envoi.secret })
    } catch (e) {
      if (e instanceof ErreurApi && e.statut === 404) return onQrInvalide()
      // Refus du serveur (plat devenu indisponible…) : le panier se rouvre avec son message ; réseau : réessayer.
      setErreur({ reseau: e instanceof ErreurApi && e.horsLigne, message: e instanceof ErreurApi ? traduireErreur(e.code, e.message, langue, e.details) : e instanceof Error ? e.message : MESSAGE_HORS_LIGNE })
      setVue('panier')
    } finally {
      verrou.current = false
      setEnvoiEnCours(false)
    }
  }

  if (vue === 'panier')
    return (
      <section className="space-y-4" aria-labelledby="titre-panier">
        <button type="button" className="lien" onClick={() => (setErreur(null), setVue('menu'))}>
          {t('← Continuer ma commande')}
        </button>
        <h2 id="titre-panier" className="font-titre text-2xl font-bold">
          {t('Votre panier')}
        </h2>
        {erreur && (
          <div className="rounded-2xl bg-red-50 p-4 text-red-800 ring-1 ring-red-200" role="alert">
            <p>{erreur.reseau ? t(MESSAGE_HORS_LIGNE) : erreur.message}</p>
            {erreur.reseau && <p className="mt-1 text-sm">{t('Votre panier est conservé : réessayez, la commande ne sera pas envoyée deux fois.')}</p>}
          </div>
        )}
        {nonRepris.length > 0 && (
          <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200" role="status">
            {t('Certains articles ne sont plus disponibles et n’ont pas été repris : {noms}', { noms: nonRepris.join(', ') })}
          </p>
        )}
        {panier.length === 0 ? (
          <p className="carte text-center text-gray-600">{t('Votre panier est vide.')}</p>
        ) : (
          <ul className="space-y-3">
            {panier.map((l) => {
              // Demande de service : pastille, et « — » au lieu des prix (0 €, le total n'en bouge pas).
              const service = nomService(l.produitId, t)
              return (
              <li key={l.cle} className="carte space-y-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {service ?? l.nom}
                      {service && <PastilleService />}
                    </p>
                    {l.options.length > 0 && <p className="text-sm text-gray-600">{l.options.map((o) => o.nom).join(' · ')}</p>}
                    {service ? (
                      <p className="text-sm text-gray-600">
                        <Gratuit />
                      </p>
                    ) : (
                      <p className="text-sm text-gray-600 tabular-nums">{t('{prix} l’unité', { prix: formaterPrix(prixUnitaire(l)) })}</p>
                    )}
                  </div>
                  <p className="shrink-0 font-semibold text-magenta-700 tabular-nums">{service ? <Gratuit /> : formaterPrix(prixLigne(l))}</p>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Quantite
                    quantite={l.quantite}
                    nom={service ?? l.nom}
                    onMoins={() => setPanier((p) => (l.quantite > 1 ? changerQuantite(p, l.cle, l.quantite - 1) : retirer(p, l.cle)))}
                    onPlus={() => setPanier((p) => changerQuantite(p, l.cle, l.quantite + 1))}
                  />
                  <button type="button" className="min-h-11 px-2 text-sm font-semibold text-red-700 underline" onClick={() => setPanier((p) => retirer(p, l.cle))}>
                    {t('Retirer')}
                  </button>
                </div>
                <div>
                  <label className="etiquette" htmlFor={`instr-${l.cle}`}>
                    {t('Instructions pour ce plat (optionnel)')}
                  </label>
                  <input
                    id={`instr-${l.cle}`}
                    className="champ"
                    maxLength={INSTRUCTIONS_MAX}
                    placeholder={t('ex : sans coriandre')}
                    value={l.instructions ?? ''}
                    onChange={(e) => setPanier((p) => majInstructions(p, l.cle, e.target.value))}
                  />
                </div>
              </li>
              )
            })}
          </ul>
        )}
        {panier.length > 0 && (
          <>
            <div>
              <label className="etiquette" htmlFor="instructions-commande">
                {t('Instructions pour la cuisine (optionnel)')}
              </label>
              <textarea
                id="instructions-commande"
                className="champ min-h-24"
                maxLength={INSTRUCTIONS_MAX}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </div>
            <p className="flex items-baseline justify-between text-lg font-bold">
              <span>{t('Total')}</span>
              <span className="tabular-nums">{formaterPrix(total)}</span>
            </p>
            <p className="text-sm text-gray-600">{t('Le total est confirmé par le restaurant à la réception de la commande. Le paiement se fait sur place.')}</p>
            <button type="button" className="bouton w-full text-lg" disabled={envoiEnCours} aria-busy={envoiEnCours} onClick={() => void confirmer()}>
              {envoiEnCours ? t('Envoi de la commande…') : erreur?.reseau ? t('Réessayer') : t('Confirmer la commande')}
            </button>
          </>
        )}
      </section>
    )

  return (
    <>
      {suiviEnCours && (
        <button type="button" className="bouton-secondaire w-full" onClick={() => setVue('suivi')}>
          {t('Suivre ma commande')}
        </button>
      )}
      {signatures.length > 0 && (
        <section className="space-y-2" aria-labelledby="titre-signatures" data-rail-signatures>
          <h2 id="titre-signatures" className="font-titre text-xl font-bold">
            {t('Signatures')}
          </h2>
          {/* Rangée défilée au doigt seulement : mode Commande, rien ne bouge tout seul. */}
          <ul className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1">
            {signatures.map((p) => (
              <li key={p.id} className="flex w-44 shrink-0 snap-start flex-col overflow-hidden rounded-2xl bg-white shadow-douce ring-1 ring-gray-900/5">
                <button type="button" className="block w-full flex-1 text-left" aria-haspopup="dialog" onClick={() => setFiche(p)}>
                  <img src={p.photoVignette ?? p.photo} alt="" loading="lazy" className="h-28 w-full object-cover" />
                  <span className="block px-3 pt-2 leading-snug font-semibold">{p.nom}</span>
                  <span className="block px-3 font-semibold text-magenta-700 tabular-nums">{formaterPrix(p.prix ?? 0)}</span>
                </button>
                <div className="flex justify-end px-3 pt-1 pb-3">
                  <ActionAjout produit={p} panier={panier} setPanier={setPanier} ouvrir={setFiche} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {categories.length === 0 ? (
        <MessagePublic titre="Menu à venir">Le commerce n’a pas encore publié son menu.</MessagePublic>
      ) : (
        <>
          <nav className="sticky top-0 z-20 -mx-4 flex gap-2 overflow-x-auto bg-fond/95 px-4 py-2 backdrop-blur" aria-label={t('Catégories')}>
            {categories.map((c) => (
              <button key={c.id} type="button" className="puce whitespace-nowrap" onClick={() => document.getElementById(`cmd-${c.id}`)?.scrollIntoView({ block: 'start' })}>
                {c.nom}
              </button>
            ))}
          </nav>
          {categories.map((c) => (
            <Categorie key={c.id} categorie={c} panier={panier} setPanier={setPanier} ouvrir={setFiche} />
          ))}
        </>
      )}
      {donnees.commerce.servicesCommande && (
        <section className="space-y-2" aria-labelledby="titre-services" data-services>
          <h2 id="titre-services" className="font-titre text-xl font-bold">
            {t('À votre service')}
          </h2>
          <p className="text-sm text-gray-600">{t('La demande part en cuisine, comme une commande — c’est gratuit.')}</p>
          <ul className="space-y-2">
            {SERVICES_COMMANDE.map((s) => {
              const nom = nomService(s.id, t) ?? s.nom
              const ligne = panier.find((l) => l.cle === s.id)
              return (
                <li key={s.id} className="flex items-center gap-3 rounded-2xl bg-white px-3 py-3 shadow-douce ring-1 ring-gray-900/5">
                  <span aria-hidden="true" className="w-8 shrink-0 text-center text-2xl">
                    {s.icone}
                  </span>
                  <span className="min-w-0 flex-1 font-semibold">{nom}</span>
                  {ligne ? (
                    <Quantite
                      quantite={ligne.quantite}
                      nom={nom}
                      onMoins={() => (setPanier((pa) => (ligne.quantite > 1 ? changerQuantite(pa, s.id, ligne.quantite - 1) : retirer(pa, s.id))), pulserPanier())}
                      onPlus={() => (setPanier((pa) => changerQuantite(pa, s.id, ligne.quantite + 1)), pulserPanier())}
                    />
                  ) : (
                    <button
                      type="button"
                      className="bouton min-h-11 shrink-0 px-4 py-2 text-sm"
                      aria-label={t('Demander : {nom}', { nom })}
                      onClick={(e) => (setPanier((pa) => ajouterService(pa, s)), animerAjoutPanier(e.currentTarget))}
                    >
                      {t('Demander')}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {fiche && <FichePlat key={fiche.id} produit={fiche} suggestion={suggestionApres(plats, fiche)} setPanier={setPanier} onFermer={() => setFiche(null)} onVoir={setFiche} />}
      {articles > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 bg-nuit-950/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-4px_16px_-8px_rgb(0_0_0/0.6)] backdrop-blur" data-barre-panier>
          <button type="button" className="bouton mx-auto flex w-full max-w-md justify-between" data-bouton-panier onClick={() => (setVue('panier'), window.scrollTo(0, 0))}>
            <span>{t('Voir le panier')}</span>
            <span className="tabular-nums">{t(articles > 1 ? '{n} articles · {total}' : '{n} article · {total}', { n: articles, total: formaterPrix(total) })}</span>
          </button>
        </div>
      )}
    </>
  )
}

function Categorie({ categorie, panier, setPanier, ouvrir }: { categorie: CategorieMenu; panier: LignePanier[]; setPanier: SetPanier; ouvrir: (p: Produit) => void }) {
  return (
    <section id={`cmd-${categorie.id}`} className="scroll-mt-20 space-y-2" aria-labelledby={`titre-cmd-${categorie.id}`}>
      <h2 id={`titre-cmd-${categorie.id}`} className="font-titre text-xl font-bold">
        {categorie.nom}
      </h2>
      <ul className="space-y-2">
        {categorie.produits.map((p) => (
          <LigneProduit key={p.id} produit={p} panier={panier} setPanier={setPanier} ouvrir={ouvrir} />
        ))}
      </ul>
    </section>
  )
}

/**
 * Un plat : vignette, nom, prix — le toucher ouvre sa fiche (feuille basse) ; commandable → bouton rapide (« Ajouter »
 * puis − / +, ou « Choisir » s'il a des options) ; sinon badge honnête et aucun bouton d'ajout.
 */
function LigneProduit({ produit: p, panier, setPanier, ouvrir }: { produit: Produit; panier: LignePanier[]; setPanier: SetPanier; ouvrir: (p: Produit) => void }) {
  const { t } = useLangue()
  const commandable = estCommandable(p)
  const vignette = p.photoVignette ?? p.photo

  return (
    <li className="overflow-hidden rounded-2xl bg-white shadow-douce ring-1 ring-gray-900/5">
      <div className="flex items-center gap-3 px-3 py-3">
        <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left" aria-haspopup="dialog" onClick={() => ouvrir(p)}>
          {vignette ? <img src={vignette} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-xl object-cover" /> : null}
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{p.nom}</span>
            {p.prix == null ? (
              <span className="block text-sm text-gray-600 italic">{t('Prix sur place')}</span>
            ) : (
              <span className="block font-semibold text-magenta-700 tabular-nums">{formaterPrix(p.prix)}</span>
            )}
          </span>
        </button>
        {!commandable ? (
          // Pastille (étiquette décorative) : text-xs, exception documentée (P2-Q1).
          p.indisponible ? <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">{t('Indisponible')}</span> : null
        ) : (
          <ActionAjout produit={p} panier={panier} setPanier={setPanier} ouvrir={ouvrir} />
        )}
      </div>
    </li>
  )
}

/**
 * Bouton rapide d'un plat commandable (ligne de catégorie, rail Signatures) : « Choisir » s'il a des options (ouvre
 * la fiche) ; sinon « Ajouter » (vol vers la barre panier), puis − / + sur sa ligne simple (pulsation seulement).
 */
function ActionAjout({ produit: p, panier, setPanier, ouvrir }: { produit: Produit; panier: LignePanier[]; setPanier: SetPanier; ouvrir: (p: Produit) => void }) {
  const { t } = useLangue()
  // Ligne « simple » (sans option) de ce plat : celle que le − / + modifie.
  const simple = panier.find((l) => l.cle === p.id)
  if (p.options?.length)
    return (
      <button type="button" className="bouton min-h-11 shrink-0 px-4 py-2 text-sm" aria-haspopup="dialog" onClick={() => ouvrir(p)}>
        {t('Choisir')}
      </button>
    )
  if (simple)
    return (
      <Quantite
        quantite={simple.quantite}
        nom={p.nom}
        onMoins={() => (setPanier((pa) => (simple.quantite > 1 ? changerQuantite(pa, simple.cle, simple.quantite - 1) : retirer(pa, simple.cle))), pulserPanier())}
        onPlus={() => (setPanier((pa) => changerQuantite(pa, simple.cle, simple.quantite + 1)), pulserPanier())}
      />
    )
  return (
    <button
      type="button"
      className="bouton min-h-11 shrink-0 px-4 py-2 text-sm"
      aria-label={t('Ajouter : {nom}', { nom: p.nom })}
      onClick={(e) => (setPanier((pa) => ajouter(pa, p)), animerAjoutPanier(e.currentTarget, { image: p.photoVignette ?? p.photo }))}
    >
      {t('Ajouter')}
    </button>
  )
}

/**
 * Fiche d'un plat en feuille basse (Menu Appétit, lot 2) : grande photo (la vraie, sinon rien), description, options,
 * note, quantité à ajouter, et le bouton d'ajout collé en bas. Voile, Échap ou « Fermer » referment ; montée courte,
 * sauf mouvement réduit (affichée d'emblée). En bas, un autre plat photographié à découvrir (`suggestionApres`).
 */
function FichePlat({
  produit: p,
  suggestion,
  setPanier,
  onFermer,
  onVoir,
}: {
  produit: Produit
  suggestion: Produit | null
  setPanier: SetPanier
  onFermer: () => void
  onVoir: (p: Produit) => void
}) {
  const { t } = useLangue()
  const [choix, setChoix] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [quantite, setQuantite] = useState(1)
  const [mouvement] = useState(() => !prefereMouvementReduit())
  const fermer = useRef<HTMLButtonElement>(null)
  const boutonAjout = useRef<HTMLButtonElement>(null)
  const surFermeture = useRef(onFermer)
  surFermeture.current = onFermer
  const commandable = estCommandable(p)
  const avecOptions = !!p.options?.length
  // Options cochées, dans l'ordre du menu (prix affiché sur le bouton d'ajout).
  const options = (p.options ?? []).filter((o) => choix.includes(o.nom))

  // Ouverture : focus sur « Fermer », page figée dessous, Échap ferme ; fermeture : focus rendu à l'élément d'origine.
  useEffect(() => {
    const origine = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const defilement = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    fermer.current?.focus()
    const clavier = (e: KeyboardEvent) => e.key === 'Escape' && surFermeture.current()
    document.addEventListener('keydown', clavier)
    return () => {
      document.removeEventListener('keydown', clavier)
      document.body.style.overflow = defilement
      origine?.focus({ preventScroll: true })
    }
  }, [])

  function ajouterDepuisFiche() {
    const cle = cleLigne(p.id, options)
    setPanier((avant) => {
      const apres = ajouter(avant, p, choix, quantite)
      return note.trim() ? majInstructions(apres, cle, note) : apres
    })
    animerAjoutPanier(boutonAjout.current, { image: p.photoVignette ?? p.photo })
    onFermer()
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <button type="button" tabIndex={-1} aria-hidden="true" className="absolute inset-0 h-full w-full cursor-default bg-black/60" onClick={onFermer} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={p.nom}
        className={`relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-relief${mouvement ? ' feuille-montee' : ''}`}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {p.photo && <img src={p.photo} alt="" className="h-60 w-full object-cover" />}
          <div className="space-y-4 px-4 pt-4 pb-5">
            <div className="flex items-start gap-3">
              <h2 className="min-w-0 flex-1 font-titre text-2xl font-bold">{p.nom}</h2>
              <button ref={fermer} type="button" className="lien shrink-0" onClick={onFermer}>
                {t('Fermer')}
              </button>
            </div>
            {p.prix == null ? (
              <p className="text-gray-600 italic">{t('Prix sur place')}</p>
            ) : (
              <p className="text-lg font-semibold text-magenta-700 tabular-nums">{formaterPrix(p.prix)}</p>
            )}
            {p.description && <p className="text-gray-700">{p.description}</p>}
            {!commandable && (
              <p className="text-sm text-gray-600">{p.indisponible ? t('Ce plat n’est pas disponible pour le moment.') : t('Ce plat se commande directement auprès du personnel.')}</p>
            )}
            {commandable && avecOptions && (
              <fieldset className="space-y-1">
                <legend className="etiquette">{t('Options')}</legend>
                {p.options!.map((o) => (
                  <label key={o.nom} className="flex min-h-11 cursor-pointer items-center gap-3">
                    <span className="zone-case my-0">
                      <input
                        type="checkbox"
                        className="case-a-cocher"
                        checked={choix.includes(o.nom)}
                        onChange={(e) => setChoix((c) => (e.target.checked ? [...c, o.nom] : c.filter((x) => x !== o.nom)))}
                      />
                    </span>
                    <span className="min-w-0 flex-1">{o.nom}</span>
                    <span className="shrink-0 text-sm text-gray-700 tabular-nums">{o.prix ? `+ ${formaterPrix(o.prix)}` : t('inclus')}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {commandable && (
              <>
                <div>
                  <label className="etiquette" htmlFor={`note-${p.id}`}>
                    {t('Instructions pour ce plat (optionnel)')}
                  </label>
                  <input id={`note-${p.id}`} className="champ" maxLength={INSTRUCTIONS_MAX} placeholder={t('ex : sans coriandre')} value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{t('Quantité')}</span>
                  <Quantite
                    quantite={quantite}
                    nom={p.nom}
                    plancher
                    onMoins={() => setQuantite((q) => Math.max(1, q - 1))}
                    onPlus={() => setQuantite((q) => Math.min(QUANTITE_MAX, q + 1))}
                  />
                </div>
              </>
            )}
            {suggestion && (
              <div className="space-y-2 border-t border-gray-100 pt-4">
                <h3 className="font-semibold">{t('À découvrir aussi')}</h3>
                <button type="button" className="flex min-h-11 w-full items-center gap-3 rounded-2xl p-2 text-left ring-1 ring-gray-900/10" onClick={() => onVoir(suggestion)}>
                  <img src={suggestion.photoVignette ?? suggestion.photo} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{suggestion.nom}</span>
                    <span className="block font-semibold text-magenta-700 tabular-nums">{formaterPrix(suggestion.prix ?? 0)}</span>
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
        {commandable && (
          <div className="border-t border-gray-100 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <button ref={boutonAjout} type="button" className="bouton w-full text-lg" onClick={ajouterDepuisFiche}>
              {t('Ajouter au panier · {prix}', { prix: formaterPrix(prixUnitaire({ prix: p.prix ?? 0, options }) * quantite) })}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** − / + d'une quantité. `plancher` (fiche plat) : le − s'arrête à 1 au lieu de retirer la ligne du panier. */
function Quantite({ quantite, nom, plancher, onMoins, onPlus }: { quantite: number; nom: string; plancher?: boolean; onMoins: () => void; onPlus: () => void }) {
  const { t } = useLangue()
  const rond = 'inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-xl font-bold text-white ring-1 ring-white/30 active:scale-95 disabled:opacity-40'
  return (
    <div className="flex shrink-0 items-center gap-1" role="group" aria-label={t('Quantité : {nom}', { nom })}>
      <button
        type="button"
        className={rond}
        aria-label={quantite > 1 || plancher ? t('Un de moins : {nom}', { nom }) : t('Retirer du panier : {nom}', { nom })}
        disabled={plancher && quantite <= 1}
        onClick={onMoins}
      >
        −
      </button>
      <span className="min-w-8 text-center font-semibold tabular-nums">{quantite}</span>
      <button type="button" className={rond} aria-label={t('Un de plus : {nom}', { nom })} disabled={quantite >= QUANTITE_MAX} onClick={onPlus}>
        +
      </button>
    </div>
  )
}

/** Pastille « Service » d'une demande à 0 € (panier, suivi). Étiquette décorative : text-xs, exception documentée (P2-Q1). */
function PastilleService() {
  const { t } = useLangue()
  return <span className="ml-2 inline-block rounded-full bg-magenta-500 px-2 py-0.5 align-middle text-xs font-semibold text-white">{t('Service')}</span>
}

/** « — » à la place d'un prix (demande de service, 0 €), lu « Gratuit » par les lecteurs d'écran. */
function Gratuit() {
  const { t } = useLangue()
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{t('Gratuit')}</span>
    </>
  )
}

/** Suivi : statut en langage clair, relu toutes les 10 s (pause si l'onglet est caché), annoncé poliment. */
function VueSuivi({
  api,
  commerceId,
  suivi,
  onMaj,
  onNouvelle,
  onRecommander,
}: {
  api: ClientApi
  commerceId: string
  suivi: Suivi
  onMaj: (s: Suivi) => void
  onNouvelle: () => void
  /** « Encore la même » : panier rebâti depuis cette commande (CommandeApi). */
  onRecommander?: () => void
}) {
  const { t } = useLangue()
  const [horsLigne, setHorsLigne] = useState(false)
  const { commande, secret } = suivi
  const terminee = estTerminee(commande.statut)

  const relire = useCallback(() => {
    api.suiviCommande(commerceId, commande.id, secret).then(
      (c) => (onMaj({ commande: c, secret }), setHorsLigne(false)),
      () => setHorsLigne(true),
    )
  }, [api, commerceId, commande.id, secret, onMaj])

  useEffect(() => {
    if (terminee) return
    const minuterie = setInterval(() => document.visibilityState === 'visible' && relire(), INTERVALLE_SUIVI_MS)
    const siVisible = () => document.visibilityState === 'visible' && relire()
    document.addEventListener('visibilitychange', siVisible)
    return () => {
      clearInterval(minuterie)
      document.removeEventListener('visibilitychange', siVisible)
    }
  }, [terminee, relire])

  const etape = ETAPES_SUIVI.indexOf(commande.statut as (typeof ETAPES_SUIVI)[number])
  return (
    <section className="space-y-4" aria-labelledby="titre-suivi">
      <h2 id="titre-suivi" className="font-titre text-2xl font-bold">
        {t('Votre commande')}
      </h2>
      <div className="carte space-y-3" aria-live="polite" aria-atomic="true">
        <p className="text-xl font-bold">{libelleStatut(commande.statut, t)}</p>
        <p className={commande.statut === 'refusee' ? 'text-red-700' : 'text-gray-700'}>{messageStatut(commande.statut, t)}</p>
      </div>
      {commande.statut !== 'refusee' && (
        <ol className="space-y-2" aria-label={t('Étapes de la commande')}>
          {ETAPES_SUIVI.map((s, i) => (
            <li key={s} className={`flex min-h-11 items-center gap-3 rounded-xl px-4 py-2 font-semibold ring-1 ${i <= etape ? 'bg-magenta-500 text-white ring-magenta-500' : 'text-gray-600 ring-gray-300'}`} aria-current={i === etape ? 'step' : undefined}>
              <span aria-hidden="true" className="w-5 shrink-0 text-center tabular-nums">
                {i < etape ? '✓' : i + 1}
              </span>
              {libelleStatut(s, t)}
            </li>
          ))}
        </ol>
      )}
      {horsLigne && (
        <div className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200" role="status">
          <p>{t('Hors ligne : statut affiché tel qu’au dernier chargement.')}</p>
          <button type="button" className="lien" onClick={relire}>
            {t('Réessayer')}
          </button>
        </div>
      )}
      <ul className="carte divide-y divide-gray-100">
        {commande.lignes.map((l, i) => (
          <li key={i} className="flex gap-3 py-2">
            <span className="shrink-0 font-semibold tabular-nums">{l.quantite} ×</span>
            <span className="min-w-0 flex-1">
              {l.service ? (nomService(l.produitId, t) ?? l.nom) : l.nom}
              {l.service && <PastilleService />}
              {l.options.length > 0 && <span className="block text-sm text-gray-600">{l.options.map((o) => o.nom).join(' · ')}</span>}
              {l.instructions && <span className="block text-sm text-gray-600 italic">{l.instructions}</span>}
            </span>
            <span className="shrink-0 tabular-nums">{l.service ? <Gratuit /> : formaterPrix((l.prixUnitaire + l.options.reduce((s, o) => s + o.prix, 0)) * l.quantite)}</span>
          </li>
        ))}
        <li className="flex justify-between py-2 font-bold">
          <span>{t('Total')}</span>
          <span className="tabular-nums">{formaterPrix(commande.total)}</span>
        </li>
      </ul>
      <button type="button" className="bouton-secondaire w-full" onClick={onNouvelle}>
        {t('Commander autre chose')}
      </button>
      {onRecommander && commande.statut !== 'refusee' && commande.lignes.length > 0 && (
        <button type="button" className="bouton-secondaire w-full" onClick={onRecommander}>
          {t('Encore la même')}
        </button>
      )}
    </section>
  )
}

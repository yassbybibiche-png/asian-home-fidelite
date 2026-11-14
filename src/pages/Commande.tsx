import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MESSAGE_MODE_SERVEUR, useStore } from '../store'
import { useRoute } from '../router'
import type { CategorieMenu, CommercePublic, Menu, Produit, StatutCommande } from '../types'
import { ErreurApi, MESSAGE_HORS_LIGNE, type ClientApi, type CommandeClient } from '../data/api'
import { formaterPrix } from '../lib/points'
import { LogoCommerce, PiedPublic } from '../components/ui'
import { SqueletteMenu } from '../components/Squelette'
import { masquerPrixNonConfirmes, retirerPhotosDetachees } from '../data/menu-reel'
import { enregistrerTraductions } from '../lib/langue'
import {
  ajouter,
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
  retirer,
  totalPanier,
  type EnvoiEnCours,
  type LignePanier,
} from '../lib/panier'
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
        <VueSuivi api={api} commerceId={commerceId} suivi={suivi} onMaj={setSuivi} onNouvelle={() => setVue('menu')} />
      ) : (
        <Prise
          api={api}
          donnees={donnees}
          commerceId={commerceId}
          jetonTable={jetonTable}
          vue={vue === 'panier' ? 'panier' : 'menu'}
          setVue={setVue}
          suiviEnCours={suivi}
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
  onCommandee: (s: Suivi) => void
  onQrInvalide: () => void
}) {
  const { t } = useLangue()
  const clePanier = clesStockage.panier(commerceId, jetonTable)
  const cleEnvoi = clesStockage.envoi(commerceId, jetonTable)
  const [panier, setPanier] = useState<LignePanier[]>(() => lirePanier(lire(clePanier)))
  const [instructions, setInstructions] = useState('')
  const [envoiEnCours, setEnvoiEnCours] = useState(false)
  const verrou = useRef(false)
  const [erreur, setErreur] = useState<{ reseau: boolean; message: string } | null>(null)
  useEffect(() => ecrire(clePanier, panier.length ? JSON.stringify(panier) : null), [clePanier, panier])

  // Mêmes données et photos que #/menu (prix non confirmés masqués, photos détachées retirées) : uniquement le menu
  // ENREGISTRÉ — c'est celui que le serveur relit pour calculer la commande.
  const categories = useMemo(
    () => retirerPhotosDetachees(masquerPrixNonConfirmes(donnees.menu)).categories.filter((c) => c.produits.length),
    [donnees.menu],
  )
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
      setErreur({ reseau: e instanceof ErreurApi && e.horsLigne, message: e instanceof Error ? e.message : MESSAGE_HORS_LIGNE })
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
        {panier.length === 0 ? (
          <p className="carte text-center text-gray-600">{t('Votre panier est vide.')}</p>
        ) : (
          <ul className="space-y-3">
            {panier.map((l) => (
              <li key={l.cle} className="carte space-y-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{l.nom}</p>
                    {l.options.length > 0 && <p className="text-sm text-gray-600">{l.options.map((o) => o.nom).join(' · ')}</p>}
                    <p className="text-sm text-gray-600 tabular-nums">{t('{prix} l’unité', { prix: formaterPrix(prixUnitaire(l)) })}</p>
                  </div>
                  <p className="shrink-0 font-semibold text-magenta-700 tabular-nums">{formaterPrix(prixLigne(l))}</p>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Quantite
                    quantite={l.quantite}
                    nom={l.nom}
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
            ))}
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
            <Categorie key={c.id} categorie={c} panier={panier} setPanier={setPanier} />
          ))}
        </>
      )}
      {articles > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 bg-nuit-950/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-4px_16px_-8px_rgb(0_0_0/0.6)] backdrop-blur">
          <button type="button" className="bouton mx-auto flex w-full max-w-md justify-between" onClick={() => (setVue('panier'), window.scrollTo(0, 0))}>
            <span>{t('Voir le panier')}</span>
            <span className="tabular-nums">{t(articles > 1 ? '{n} articles · {total}' : '{n} article · {total}', { n: articles, total: formaterPrix(total) })}</span>
          </button>
        </div>
      )}
    </>
  )
}

function Categorie({ categorie, panier, setPanier }: { categorie: CategorieMenu; panier: LignePanier[]; setPanier: (f: (p: LignePanier[]) => LignePanier[]) => void }) {
  return (
    <section id={`cmd-${categorie.id}`} className="scroll-mt-20 space-y-2" aria-labelledby={`titre-cmd-${categorie.id}`}>
      <h2 id={`titre-cmd-${categorie.id}`} className="font-titre text-xl font-bold">
        {categorie.nom}
      </h2>
      <ul className="space-y-2">
        {categorie.produits.map((p) => (
          <LigneProduit key={p.id} produit={p} panier={panier} setPanier={setPanier} />
        ))}
      </ul>
    </section>
  )
}

/** Un plat : vignette, nom, prix ; commandable → « Ajouter » puis − / + ; sinon badge honnête et aucun bouton d'ajout. */
function LigneProduit({ produit: p, panier, setPanier }: { produit: Produit; panier: LignePanier[]; setPanier: (f: (p: LignePanier[]) => LignePanier[]) => void }) {
  const { t } = useLangue()
  const [ouvert, setOuvert] = useState(false)
  const [choix, setChoix] = useState<string[]>([])
  const [note, setNote] = useState('')
  const commandable = estCommandable(p)
  const avecOptions = !!p.options?.length
  // Ligne « simple » (sans option) de ce plat : celle que le − / + de la liste modifie.
  const simple = panier.find((l) => l.cle === p.id)
  const vignette = p.photoVignette ?? p.photo

  // Options cochées, dans l'ordre du menu (prix affiché sur le bouton d'ajout).
  const options = (p.options ?? []).filter((o) => choix.includes(o.nom))

  function ajouterDepuisFiche() {
    const cle = cleLigne(p.id, options)
    setPanier((avant) => {
      const apres = ajouter(avant, p, choix)
      return note.trim() ? majInstructions(apres, cle, note) : apres
    })
    setChoix([])
    setNote('')
    setOuvert(false)
  }

  return (
    <li className="overflow-hidden rounded-2xl bg-white shadow-douce ring-1 ring-gray-900/5">
      <div className="flex items-center gap-3 px-3 py-3">
        <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)}>
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
        ) : avecOptions ? (
          <button type="button" className="bouton min-h-11 shrink-0 px-4 py-2 text-sm" aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)}>
            {t('Choisir')}
          </button>
        ) : simple ? (
          <Quantite
            quantite={simple.quantite}
            nom={p.nom}
            onMoins={() => setPanier((pa) => (simple.quantite > 1 ? changerQuantite(pa, simple.cle, simple.quantite - 1) : retirer(pa, simple.cle)))}
            onPlus={() => setPanier((pa) => changerQuantite(pa, simple.cle, simple.quantite + 1))}
          />
        ) : (
          <button type="button" className="bouton min-h-11 shrink-0 px-4 py-2 text-sm" aria-label={t('Ajouter : {nom}', { nom: p.nom })} onClick={() => setPanier((pa) => ajouter(pa, p))}>
            {t('Ajouter')}
          </button>
        )}
      </div>
      {ouvert && (
        <div className="space-y-3 border-t border-gray-100 px-4 py-3">
          {p.description && <p className="text-sm text-gray-700">{p.description}</p>}
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
              <button type="button" className="bouton w-full" onClick={ajouterDepuisFiche}>
                {t('Ajouter au panier · {prix}', { prix: formaterPrix(prixUnitaire({ prix: p.prix ?? 0, options })) })}
              </button>
            </>
          )}
        </div>
      )}
    </li>
  )
}

function Quantite({ quantite, nom, onMoins, onPlus }: { quantite: number; nom: string; onMoins: () => void; onPlus: () => void }) {
  const { t } = useLangue()
  const rond = 'inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-xl font-bold text-white ring-1 ring-white/30 active:scale-95 disabled:opacity-40'
  return (
    <div className="flex shrink-0 items-center gap-1" role="group" aria-label={t('Quantité : {nom}', { nom })}>
      <button type="button" className={rond} aria-label={quantite > 1 ? t('Un de moins : {nom}', { nom }) : t('Retirer du panier : {nom}', { nom })} onClick={onMoins}>
        −
      </button>
      <span className="min-w-8 text-center font-semibold tabular-nums">{quantite}</span>
      <button type="button" className={rond} aria-label={t('Un de plus : {nom}', { nom })} disabled={quantite >= QUANTITE_MAX} onClick={onPlus}>
        +
      </button>
    </div>
  )
}

/** Suivi : statut en langage clair, relu toutes les 10 s (pause si l'onglet est caché), annoncé poliment. */
function VueSuivi({ api, commerceId, suivi, onMaj, onNouvelle }: { api: ClientApi; commerceId: string; suivi: Suivi; onMaj: (s: Suivi) => void; onNouvelle: () => void }) {
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
              {l.nom}
              {l.options.length > 0 && <span className="block text-sm text-gray-600">{l.options.map((o) => o.nom).join(' · ')}</span>}
              {l.instructions && <span className="block text-sm text-gray-600 italic">{l.instructions}</span>}
            </span>
            <span className="shrink-0 tabular-nums">{formaterPrix((l.prixUnitaire + l.options.reduce((s, o) => s + o.prix, 0)) * l.quantite)}</span>
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
    </section>
  )
}

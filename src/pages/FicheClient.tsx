import { useState, type FormEvent } from 'react'
import { useAction, useDonneesCommerce, useStore } from '../store'
import { aller, useRoute } from '../router'
import type { Client, Commerce, ModeleRelance } from '../types'
import { canalDuClient, libelleModele, MODELES_RELANCE, modelesSuggeres } from '../lib/relances'
import { MENTION_ENVOI } from '../lib/integrations'
import { JournalEnvois } from './Messages'
import { recompenseDebloquee } from '../lib/fidelite'
import { nomAffiche } from '../lib/inscriptionJeu'
import { passageCeJour, soldePoints, formaterPrix } from '../lib/points'
import { analyserAnniversaire, anniversaireAffiche } from '../lib/messages'
import { nouvelIdAction } from '../lib/fileCaisse'
import { dateCourte, dateRelative } from '../lib/format'
import { CarteFidelite } from '../components/CarteFidelite'
import { EncartWallet, EnTete, MessageErreur, telecharger, Vide } from '../components/ui'
import { QrCode } from '../components/QrCode'
import { datePurge, dureeConservationMois, libelleDuree, nomFichierExportClient, protectionPurge } from '../lib/rgpd'
import { recapitulatif, type DemandeConfirmation } from '../lib/ecransCommercant'
import { Confirmation } from '../components/Confirmation'

/** Mode serveur : points (échange contre le catalogue), historique des échanges, anniversaire, plat préféré. */
function PointsEtAnniversaire({ client, commerce }: { client: Client; commerce: Commerce }) {
  const { avecPin } = useStore()
  const { executer, enCours, erreur } = useAction()
  const [anniv, setAnniv] = useState(anniversaireAffiche(client.anniversaire))
  const [plat, setPlat] = useState(client.platPrefere ?? '')
  const [annonce, setAnnonce] = useState('')
  const [demande, setDemande] = useState<DemandeConfirmation | null>(null)
  const valeur = analyserAnniversaire(anniv)
  const solde = soldePoints(client)

  async function confirmerEchange() {
    const d = demande
    setDemande(null)
    if (!d || d.type !== 'echange') return
    const res = await executer(() => avecPin((a, api) => api.actionCaisse(commerce.id, a, 'echange', { clientId: client.id, recompenseId: d.recompense.id, actionId: nouvelIdAction() })))
    if (res.ok) setAnnonce(`✓ Échange enregistré : ${d.recompense.nom}`)
  }

  async function enregistrerAnniv(e: FormEvent) {
    e.preventDefault()
    if (valeur === null) return
    const r = await executer(() => avecPin((a, api) => api.majClient(commerce.id, a, client.id, { anniversaire: valeur, platPrefere: plat.trim() })))
    if (r.ok) setAnnonce('✓ Anniversaire et plat préféré enregistrés')
  }

  return (
    <section className="carte space-y-3">
      <h2 className="titre-carte">Points : {solde}</h2>
      <p className="text-sm text-gray-600">
        Dépensé au total : {formaterPrix(client.depenseCentimes ?? 0)}. Les points se gagnent en caisse (montant du passage).
      </p>
      {!!commerce.catalogue?.length && (
        <ul className="space-y-2">
          {commerce.catalogue.map((r) => (
            <li key={r.id}>
              <button
                className="bouton-secondaire min-h-12 w-full justify-between"
                disabled={enCours || solde < r.cout}
                onClick={() => setDemande({ type: 'echange', recompense: r })}
              >
                <span>Échanger : {r.nom}</span>
                <span className="tabular-nums">{r.cout} pts</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!!client.echangesPoints?.length && (
        <ul className="divide-y divide-gray-100 text-sm">
          {[...client.echangesPoints].reverse().slice(0, 10).map((e) => (
            <li key={e.id} className="flex justify-between gap-3 py-2">
              <span>
                🔁 {e.libelle} (−{e.cout} pts, {e.soldeAvant} → {e.soldeApres}) · {e.auteur}
              </span>
              <span className="shrink-0 text-gray-600">{dateRelative(e.date)}</span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={enregistrerAnniv} className="space-y-3 border-t border-gray-100 pt-3">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label className="etiquette" htmlFor="anniv">
              Anniversaire (JJ/MM, optionnel)
            </label>
            <input id="anniv" className="champ" inputMode="numeric" placeholder="21/03" value={anniv} onChange={(e) => (setAnniv(e.target.value), setAnnonce(''))} />
          </div>
          <button className="bouton-secondaire h-12 shrink-0" disabled={enCours || valeur === null}>
            Enregistrer
          </button>
        </div>
        <div>
          <label className="etiquette" htmlFor="plat-prefere">
            Plat préféré (optionnel)
          </label>
          <input id="plat-prefere" className="champ" maxLength={80} placeholder="ex : poulet satay" value={plat} onChange={(e) => (setPlat(e.target.value), setAnnonce(''))} />
        </div>
      </form>
      {valeur === null && <p className="text-sm text-red-700">Format attendu : JJ/MM (ex : 21/03).</p>}
      <MessageErreur>{erreur}</MessageErreur>
      {annonce && (
        <p className="alerte-succes" role="status">
          {annonce}
        </p>
      )}
      {demande && <Confirmation recap={recapitulatif(demande, client, commerce)} enCours={enCours} onConfirmer={() => void confirmerEchange()} onAnnuler={() => setDemande(null)} />}
    </section>
  )
}

const ORIGINE_CONSENTEMENT: Record<NonNullable<Client['consentementRelanceOrigine']>, string> = {
  inscription: 'case cochée à l’inscription',
  commercant: 'par le commerce',
  'stop-sms': 'réponse STOP par SMS',
  'lien-email': 'lien de désinscription (e-mail)',
}

/** Relances SMS / e-mail (P1-B3) : consentement (poser / retirer), relance manuelle, envois de ce client. */
function Relances({ client, commerce }: { client: Client; commerce: Commerce }) {
  const { avecPin, recharger } = useStore()
  const { envois } = useDonneesCommerce()
  const { executer, enCours, erreur } = useAction()
  const [annonce, setAnnonce] = useState('')
  const [demande, setDemande] = useState<DemandeConfirmation | null>(null)
  const [modele, setModele] = useState<ModeleRelance>(() => modelesSuggeres(client, commerce, new Date())[0] ?? 'bienvenue')
  const consenti = client.consentementRelance === true
  const canal = canalDuClient(client)
  const duClient = envois.filter((e) => e.clientId === client.id)

  async function changerConsentement() {
    const d = demande
    setDemande(null)
    if (!d || d.type !== 'consentement') return
    const valeur = d.valeur
    setAnnonce('')
    const r = await executer(() => avecPin((a, api) => api.majClient(commerce.id, a, client.id, { consentementRelance: valeur })))
    if (r.ok) setAnnonce(valeur ? '✓ Consentement enregistré.' : '✓ Consentement retiré : plus aucune relance ne partira.')
  }

  async function relancer() {
    setAnnonce('')
    const r = await executer(() => avecPin((a, api) => api.relancer(commerce.id, a, client.id, { modele })))
    if (r.ok) setAnnonce(r.valeur.test ? `✓ Mode test — rien envoyé (${libelleModele(modele)}).` : `✓ ${r.valeur.canal === 'sms' ? 'SMS' : 'E-mail'} envoyé (${libelleModele(modele)}).`)
    // Refus (409, 501…) : la tentative est quand même journalisée côté serveur — on relit le journal.
    else void recharger()
  }

  return (
    <section className="carte space-y-3">
      <h2 className="titre-carte">Relances SMS / e-mail</h2>
      <p className="text-sm text-gray-700">
        {consenti ? '✅ Consentement donné' : client.consentementRelanceOrigine ? '⛔ Consentement retiré' : '— Pas de consentement'}
        {client.consentementRelanceLe && client.consentementRelanceOrigine && (
          <span className="text-gray-600">
            {' '}
            · {dateCourte(client.consentementRelanceLe)}, {ORIGINE_CONSENTEMENT[client.consentementRelanceOrigine]}
          </span>
        )}
      </p>
      <button className="bouton-secondaire w-full" disabled={enCours} onClick={() => setDemande({ type: 'consentement', valeur: !consenti })}>
        {consenti ? 'Retirer le consentement' : 'Le client accepte les relances'}
      </button>
      {consenti && canal && (
        <div className="space-y-2 border-t border-gray-100 pt-3">
          <label className="etiquette" htmlFor="modele-relance">
            Modèle ({canal === 'sms' ? 'SMS' : 'e-mail'})
          </label>
          <select id="modele-relance" className="champ" value={modele} onChange={(e) => (setModele(e.target.value as ModeleRelance), setAnnonce(''))}>
            {MODELES_RELANCE.map((m) => (
              <option key={m.modele} value={m.modele}>
                {m.libelle}
              </option>
            ))}
          </select>
          <p className="text-sm text-gray-600">{MODELES_RELANCE.find((m) => m.modele === modele)!.aide}</p>
          <button className="bouton w-full" disabled={enCours} onClick={() => void relancer()}>
            {enCours ? 'Envoi…' : 'Envoyer la relance'}
          </button>
          <p className="text-sm text-gray-600">{MENTION_ENVOI}. Une même relance part au plus une fois par jour.</p>
        </div>
      )}
      <MessageErreur>{erreur && `Rien n’a été envoyé ni modifié : ${erreur}`}</MessageErreur>
      {annonce && (
        <p className="alerte-succes" role="status">
          {annonce}
        </p>
      )}
      <div className="border-t border-gray-100 pt-3">
        <h3 className="etiquette">Envois à ce client</h3>
        <JournalEnvois envois={duClient} avecClient={false} />
      </div>
      {demande && <Confirmation recap={recapitulatif(demande, client, commerce)} enCours={enCours} onConfirmer={() => void changerConsentement()} onAnnuler={() => setDemande(null)} />}
    </section>
  )
}

/** Visites oubliées signalées par le client : le commerçant valide (+1 visite + points) ou refuse. */
function Rattrapages({ client, commerce }: { client: Client; commerce: Commerce }) {
  const { avecPin } = useStore()
  const { executer, enCours, erreur } = useAction()
  const [annonce, setAnnonce] = useState('')
  const [demande, setDemande] = useState<DemandeConfirmation | null>(null)
  const enAttente = (client.demandesRattrapage ?? []).filter((d) => d.statut === 'en_attente')
  if (!enAttente.length) return null

  async function confirmerRefus() {
    const d = demande
    setDemande(null)
    if (!d || d.type !== 'rattrapage-refus') return
    const r = await executer(() => avecPin((a, api) => api.deciderRattrapage(commerce.id, a, client.id, d.id, 'refuser')))
    if (r.ok) setAnnonce('Demande refusée.')
  }
  return (
    <section className="carte space-y-3">
      <h2 className="titre-carte">Visites oubliées à valider</h2>
      <p className="text-sm text-gray-600">Le client a signalé avoir oublié de scanner. Valider crédite 1 tampon + les points du montant ; refuser classe la demande.</p>
      <ul className="space-y-3">
        {enAttente.map((d) => (
          <li key={d.id} className="rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
            <p className="font-semibold">
              {new Date(d.date).toLocaleDateString('fr-FR')} · {formaterPrix(d.montantCentimes)}
              {d.ticket ? ` · ticket ${d.ticket}` : ''}
            </p>
            <p className="text-sm text-gray-600">Signalée {dateRelative(d.creeLe)}</p>
            <div className="mt-2 flex gap-2">
              <button
                className="bouton min-h-11 flex-1"
                disabled={enCours}
                onClick={async () => {
                  const r = await executer(() => avecPin((a, api) => api.deciderRattrapage(commerce.id, a, client.id, d.id, 'valider')))
                  if (r.ok) setAnnonce('✓ Visite validée : +1 tampon et points crédités.')
                }}
              >
                Valider
              </button>
              <button
                className="bouton-secondaire min-h-11 flex-1"
                disabled={enCours}
                onClick={() =>
                  setDemande({ type: 'rattrapage-refus', id: d.id, date: new Date(d.date).toLocaleDateString('fr-FR'), montant: formaterPrix(d.montantCentimes) })
                }
              >
                Refuser
              </button>
            </div>
          </li>
        ))}
      </ul>
      <MessageErreur>{erreur}</MessageErreur>
      {annonce && (
        <p className="alerte-succes" role="status">
          {annonce}
        </p>
      )}
      {demande && <Confirmation recap={recapitulatif(demande, client, commerce)} enCours={enCours} onConfirmer={() => void confirmerRefus()} onAnnuler={() => setDemande(null)} />}
    </section>
  )
}

/**
 * Données personnelles (P1-B6, RGPD) : export CSV de ce client, exclusion de la purge de conservation, suppression
 * définitive. La suppression demande de SAISIR « SUPPRIMER » (aucune modale dans l'app : confirmation par saisie, plus
 * sûre qu'un simple OK) ; le serveur exige aussi cette confirmation et journalise l'opération sans données du client.
 */
function DonneesPersonnelles({ client, commerce }: { client: Client; commerce: Commerce }) {
  const { avecPin } = useStore()
  const { executer, enCours, erreur } = useAction()
  const [annonce, setAnnonce] = useState('')
  const [suppression, setSuppression] = useState(false)
  const [saisie, setSaisie] = useState('')
  const mois = dureeConservationMois(commerce)
  const purge = datePurge(client, mois)
  const protection = protectionPurge(client, new Date())

  async function exporter() {
    setAnnonce('')
    const r = await executer(() => avecPin((a, api) => api.exportClient(commerce.id, a, client.id)))
    if (r.ok) {
      telecharger(nomFichierExportClient(client.id), r.valeur)
      setAnnonce('✓ Export téléchargé : à transmettre au client s’il l’a demandé.')
    }
  }

  async function basculerExclusion() {
    setAnnonce('')
    const r = await executer(() => avecPin((a, api) => api.majClient(commerce.id, a, client.id, { exclusPurge: !client.exclusPurge })))
    if (r.ok) setAnnonce(client.exclusPurge ? '✓ Le client sera de nouveau purgé après la durée de conservation.' : '✓ Client exclu de la purge de conservation.')
  }

  async function supprimer() {
    if (saisie.trim() !== 'SUPPRIMER') return
    const r = await executer(() => avecPin((a, api) => api.supprimerClient(commerce.id, a, client.id)))
    if (r.ok) aller('clients')
  }

  return (
    <section className="carte space-y-3">
      <h2 className="titre-carte">Données personnelles (RGPD)</h2>
      {client.demandeSuppressionLe && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200" role="status">
          ⚠️ Le client a demandé la suppression de ses données le {dateCourte(client.demandeSuppressionLe)} (depuis sa carte). Remettez-lui d’abord une
          éventuelle récompense en attente, puis supprimez-le ci-dessous.
        </p>
      )}
      <p className="text-sm text-gray-600">
        Conservation : {libelleDuree(mois)} après la dernière visite — {protection ? `pas de purge (${protection.toLowerCase()})` : `purge possible à partir du ${dateCourte(purge.toISOString())}`}.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="bouton-secondaire min-h-11" disabled={enCours} onClick={() => void exporter()}>
          Exporter ses données (CSV)
        </button>
        <button type="button" className="bouton-secondaire min-h-11" disabled={enCours} onClick={() => void basculerExclusion()}>
          {client.exclusPurge ? 'Réinclure dans la purge' : 'Exclure de la purge'}
        </button>
      </div>
      {!suppression ? (
        <button type="button" className="bouton-secondaire w-full text-red-700" disabled={enCours} onClick={() => (setSuppression(true), setSaisie(''))}>
          Supprimer ce client…
        </button>
      ) : (
        <div className="space-y-2 rounded-xl bg-red-50 p-3 ring-1 ring-red-200">
          <p className="text-sm text-red-900">
            Suppression <strong>définitive</strong> de {client.prenom || 'ce client'} : sa carte, ses tampons et points, ses visites, ses gains de la roue, ses
            messages, ses demandes, ses parrainages et ses entrées du journal. Impossible à annuler. Pensez à exporter ses données s’il les a demandées.
          </p>
          <label className="etiquette" htmlFor="confirmer-suppression">
            Tapez SUPPRIMER pour confirmer
          </label>
          <input id="confirmer-suppression" className="champ" autoComplete="off" value={saisie} onChange={(e) => setSaisie(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="bouton-secondaire min-h-11" disabled={enCours} onClick={() => setSuppression(false)}>
              Annuler
            </button>
            <button type="button" className="bouton min-h-11 bg-red-700 hover:bg-red-800 active:bg-red-900" disabled={enCours || saisie.trim() !== 'SUPPRIMER'} onClick={() => void supprimer()}>
              {enCours ? 'Suppression…' : 'Supprimer définitivement'}
            </button>
          </div>
        </div>
      )}
      <MessageErreur>{erreur && `Rien n’a été modifié : ${erreur}`}</MessageErreur>
      {annonce && (
        <p className="alerte-succes" role="status">
          {annonce}
        </p>
      )}
    </section>
  )
}

/**
 * Accès du client à sa carte (P0-S7). QR d'accès : à montrer au client PRÉSENT au comptoir (téléphone changé, carte
 * effacée) — il le scanne et retrouve sa carte complète sur son téléphone (15 min, une seule fois, journalisé).
 * Révocation : tous ses téléphones perdent l'accès complet (téléphone perdu, carte ouverte par quelqu'un d'autre).
 */
function AccesCarteClient({ client, commerce }: { client: Client; commerce: Commerce }) {
  const { avecPin } = useStore()
  const { executer, enCours, erreur } = useAction()
  const [lien, setLien] = useState<{ lien: string; expireLe: string } | null>(null)
  const [confirmer, setConfirmer] = useState(false)
  const [annonce, setAnnonce] = useState('')

  async function afficherQr() {
    setAnnonce('')
    const r = await executer(() => avecPin((a, api) => api.lienAccesCarte(commerce.id, a, client.id)))
    if (r.ok) setLien(r.valeur)
  }

  async function revoquer() {
    const r = await executer(() => avecPin((a, api) => api.revoquerAccesCarte(commerce.id, a, client.id)))
    if (!r.ok) return
    setLien(null)
    setConfirmer(false)
    setAnnonce('✓ Accès révoqué : plus aucun téléphone n’ouvre la carte complète. Remettez un QR d’accès au client quand il se présente.')
  }

  return (
    <section className="carte space-y-3">
      <h2 className="titre-carte">Accès du client à sa carte</h2>
      <p className="text-sm text-gray-600">
        Nouveau téléphone, carte effacée ? Montrez ce QR au client présent au comptoir : il le scanne et retrouve sa carte complète (valable 15 min, une seule
        fois).
      </p>
      {lien ? (
        <div className="flex flex-col items-center gap-2">
          <QrCode texte={lien.lien} titre="QR d’accès à la carte du client" />
          <p className="text-sm text-gray-600">Valable jusqu’à {new Date(lien.expireLe).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}, une seule fois.</p>
          {/* Expiré ou déjà scanné : un nouveau lien remplace ce QR à l'écran. L'ancien n'est pas révoqué (le serveur
              ne le permet pas sans révoquer toute la carte) : il reste à usage unique et tombe à son expiration (15 min),
              sans avoir quitté cet écran du comptoir. */}
          <button type="button" className="bouton-secondaire min-h-11 w-full" disabled={enCours} onClick={() => void afficherQr()}>
            Générer un nouveau lien d’accès
          </button>
        </div>
      ) : (
        <button type="button" className="bouton-secondaire min-h-11 w-full" disabled={enCours} onClick={() => void afficherQr()}>
          Afficher le QR d’accès à sa carte
        </button>
      )}
      {!confirmer ? (
        <button type="button" className="bouton-secondaire min-h-11 w-full text-red-700" disabled={enCours} onClick={() => setConfirmer(true)}>
          Révoquer tous ses accès…
        </button>
      ) : (
        <div className="space-y-2 rounded-xl bg-red-50 p-3 ring-1 ring-red-200">
          <p className="text-sm text-red-900">
            Tous les téléphones de ce client perdent l’accès complet à sa carte (ses tampons et points ne changent pas). Pour la rouvrir, il faudra un nouveau
            QR d’accès.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="bouton-secondaire min-h-11" disabled={enCours} onClick={() => setConfirmer(false)}>
              Annuler
            </button>
            <button type="button" className="bouton min-h-11 bg-red-700 hover:bg-red-800 active:bg-red-900" disabled={enCours} onClick={() => void revoquer()}>
              Révoquer
            </button>
          </div>
        </div>
      )}
      <MessageErreur>{erreur && `Rien n’a été modifié : ${erreur}`}</MessageErreur>
      {annonce && (
        <p className="alerte-succes" role="status">
          {annonce}
        </p>
      )}
    </section>
  )
}

/** Fiche client côté commerçant : la carte + les actions de caisse. */
export default function FicheClient() {
  const { param } = useRoute()
  const { etat, validerVisite, offrirRecompense, estDemo, mode } = useStore()
  const [annonce, setAnnonce] = useState('')
  const { executer, enCours, erreur } = useAction()
  const client = etat.clients.find((c) => c.id === param)
  const commerce = client && etat.commerces.find((c) => c.id === client.commerceId)

  if (!client || !commerce) {
    return (
      <div>
        <EnTete titre="Client introuvable" />
        <Vide>
          Ce client n’existe pas (ou la démo a été réinitialisée).{' '}
          <a href="#/clients" className="font-semibold text-magenta-700 underline">
            Retour à la liste
          </a>
        </Vide>
      </div>
    )
  }

  const debloquee = recompenseDebloquee(client, commerce)
  const gains = etat.tirages.filter((t) => t.clientId === client.id).sort((a, b) => b.date.localeCompare(a.date))
  const annoncer = (texte: string) => {
    setAnnonce(texte)
    setTimeout(() => setAnnonce(''), 2500)
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <a href="#/clients" className="lien no-underline">
        ‹ Clients
      </a>
      <EnTete titre={nomAffiche(client.prenom)}sousTitre={`${client.telephone ?? client.email} · client depuis le ${dateCourte(client.creeLe)}`} />

      <CarteFidelite client={client} commerce={commerce} />

      <section className="carte space-y-2">
        <h2 className="titre-carte">En caisse</h2>
        <button
          className="bouton w-full"
          disabled={enCours || passageCeJour(client, new Date())}
          onClick={async () => {
            if (!(await executer(() => validerVisite(client.id))).ok) return
            annoncer(
              debloquee
                ? 'Visite enregistrée (+1 tampon, reporté sur la carte suivante) — offrez la récompense.'
                : '✓ Visite validée : +1 tampon',
            )
          }}
        >
          Valider une visite (+1 tampon)
        </button>
        {passageCeJour(client, new Date()) && <p className="text-sm text-gray-700">Déjà un passage aujourd’hui : 1 tampon par jour maximum.</p>}
        {debloquee && (
          <button
            className="bouton w-full bg-green-700 hover:bg-green-800 active:bg-green-900"
            disabled={enCours}
            onClick={async () => {
              if (!(await executer(() => offrirRecompense(client.id))).ok) return
              const reportes = client.tampons - commerce.seuilTampons
              annoncer(
                `🎁 Récompense offerte : ${commerce.recompense}. ${
                  reportes > 0 ? `${reportes} tampon${reportes > 1 ? 's' : ''} reporté${reportes > 1 ? 's' : ''} sur la nouvelle carte.` : 'Carte remise à zéro.'
                }`,
              )
            }}
          >
            🎁 Offrir la récompense
          </button>
        )}
        <MessageErreur>{erreur && `Rien n’a été enregistré : ${erreur}`}</MessageErreur>
        {annonce && (
          <p className="alerte-succes apparition" role="status">
            {annonce}
          </p>
        )}
        <p className="text-sm text-gray-600">
          {debloquee
            ? 'Tant que la récompense n’est pas offerte, les visites sont enregistrées mais la carte reste pleine.'
            : mode === 'local'
              ? 'En vrai, vous scannez le QR du client ; dans la démo, un tap suffit.'
              : 'Vérifiez la carte du client (son QR ou son numéro) avant de valider.'}
        </p>
      </section>

      {mode === 'api' && <PointsEtAnniversaire client={client} commerce={commerce} />}
      {mode === 'api' && <Rattrapages client={client} commerce={commerce} />}
      {mode === 'api' && <Relances client={client} commerce={commerce} />}
      {mode === 'api' && <AccesCarteClient client={client} commerce={commerce} />}
      {mode === 'api' && <DonneesPersonnelles client={client} commerce={commerce} />}

      <EncartWallet demo={estDemo} lienCarte={`#/carte/${client.id}`} />

      <a href={`#/carte/${client.id}`} className="bouton-secondaire w-full">
        Voir la carte comme le client ↗
      </a>

      <section className="carte">
        <h2 className="titre-carte">Historique</h2>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-gray-50 py-2">
            <dt className="text-sm text-gray-600">Visites</dt>
            <dd className="text-xl font-bold tabular-nums">{client.visites.length}</dd>
          </div>
          <div className="rounded-xl bg-gray-50 py-2">
            <dt className="text-sm text-gray-600">Récompenses</dt>
            <dd className="text-xl font-bold tabular-nums">{client.recompensesOffertes?.length ?? 0}</dd>
          </div>
          <div className="rounded-xl bg-gray-50 py-2">
            <dt className="text-sm text-gray-600">Gains roulette</dt>
            <dd className="text-xl font-bold tabular-nums">{gains.length}</dd>
          </div>
        </dl>
        <ul className="mt-3 divide-y divide-gray-100 text-sm">
          {[...(client.recompensesOffertes ?? []).map((r) => ({ date: r.date, texte: `🎁 Récompense offerte : ${r.libelle}` })), ...gains.map((g) => ({ date: g.date, texte: `🎡 Roulette : ${g.lot}${g.code ? ` (code ${g.code})` : ''}` }))]
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 10)
            .map((l, i) => (
              <li key={i} className="flex justify-between gap-3 py-2">
                <span>{l.texte}</span>
                <span className="shrink-0 text-gray-600">{dateRelative(l.date)}</span>
              </li>
            ))}
        </ul>
      </section>
    </div>
  )
}

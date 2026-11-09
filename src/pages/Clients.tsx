import { useState, type FormEvent } from 'react'
import { useAction, useDonneesCommerce, useStore } from '../store'
import type { Client } from '../types'
import { estActif, estARelancer, joursDepuis } from '../lib/stats'
import { dateRelative } from '../lib/format'
import { analyserContact, messageRelance, recompenseDebloquee, tamponsAffiches } from '../lib/fidelite'
import { correspondRecherche } from '../lib/recherche'
import { MENTION_ENVOI } from '../lib/integrations'
import { BoutonCopier, EnTete, MessageErreur, telecharger, Vide } from '../components/ui'

type Filtre = 'tous' | 'actifs' | 'relancer'

export default function Clients() {
  const { commerce, clients } = useDonneesCommerce()
  const [recherche, setRecherche] = useState('')
  const [filtre, setFiltre] = useState<Filtre>('tous')
  const [inscription, setInscription] = useState(false)
  const [annonce, setAnnonce] = useState<{ client: Client; existant: boolean } | null>(null)

  const liste = clients
    .filter((c) => (filtre === 'tous' ? true : filtre === 'actifs' ? estActif(c) : estARelancer(c)))
    // Téléphone quel que soit le format (06…, +33, 0033, espaces, points), prénom sans accents.
    .filter((c) => correspondRecherche(c, recherche))
    // Sans visite (null) : en fin de liste « Tous » ; jamais dans « À relancer ».
    .sort((a, b) => {
      const da = a.derniereVisite ?? ''
      const db = b.derniereVisite ?? ''
      return filtre === 'relancer' ? da.localeCompare(db) : db.localeCompare(da)
    })

  const nbActifs = clients.filter((c) => estActif(c)).length
  const nbARelancer = clients.filter((c) => estARelancer(c)).length

  return (
    <div>
      <EnTete titre="Clients" sousTitre={`${clients.length} clients · récompense : ${commerce.recompense}`} />

      {inscription ? (
        <FormulaireInscription
          onFermer={() => setInscription(false)}
          onInscrit={(r) => {
            setAnnonce(r)
            setInscription(false)
            setFiltre('tous')
            setRecherche('')
          }}
        />
      ) : (
        <button className="bouton mb-4 w-full" onClick={() => (setInscription(true), setAnnonce(null))}>
          + Inscrire un client
        </button>
      )}

      {annonce && (
        <p className="alerte-succes apparition mb-4 font-normal" role="status">
          {annonce.existant ? `${annonce.client.prenom} était déjà inscrit(e) avec ce contact.` : `✓ ${annonce.client.prenom} est inscrit(e).`}{' '}
          <a href={`#/client/${annonce.client.id}`} className="font-semibold underline">
            Voir sa carte
          </a>
        </p>
      )}

      <label className="sr-only" htmlFor="recherche-clients">
        Rechercher un client
      </label>
      <input
        id="recherche-clients"
        className="champ"
        type="search"
        placeholder="Rechercher un prénom, un téléphone…"
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
      />

      <div className="mt-3 mb-4 flex gap-2 overflow-x-auto" role="tablist">
        {(
          [
            ['tous', `Tous (${clients.length})`],
            ['actifs', `Actifs (${nbActifs})`],
            ['relancer', `À relancer (${nbARelancer})`],
          ] as [Filtre, string][]
        ).map(([valeur, libelle]) => (
          <button
            key={valeur}
            role="tab"
            aria-selected={filtre === valeur}
            onClick={() => setFiltre(valeur)}
            className="puce"
          >
            {libelle}
          </button>
        ))}
      </div>

      <BoutonExport />

      {filtre === 'relancer' && (
        <p className="mb-3 text-sm text-gray-600">
          Clients déjà venus, mais sans visite depuis plus de 30 jours. Copiez le message et envoyez-le vous-même (SMS, WhatsApp, e-mail) : l’app n’envoie rien.{' '}
          <span className="font-semibold">{MENTION_ENVOI}.</span>
        </p>
      )}

      {liste.length === 0 ? (
        <Vide>{filtre === 'relancer' ? 'Personne à relancer : aucun client n’est absent depuis plus de 30 jours.' : 'Aucun client ne correspond.'}</Vide>
      ) : (
        <ul className="space-y-2">
          {liste.map((c) => (filtre === 'relancer' ? <LigneRelance key={c.id} client={c} /> : <LigneClient key={c.id} client={c} />))}
        </ul>
      )}
    </div>
  )
}

/** Export de la liste des clients : depuis le serveur en mode API, généré dans le navigateur en mode local. */
function BoutonExport() {
  const { commerce, exporterCsv } = useStore()
  const { executer, enCours, erreur } = useAction()
  return (
    <div className="mb-4">
      <button
        type="button"
        className="bouton-secondaire w-full"
        disabled={enCours}
        onClick={async () => {
          const r = await executer(() => exporterCsv(commerce.id))
          if (r.ok) telecharger(r.valeur.nom, r.valeur.contenu)
        }}
      >
        {enCours ? 'Export en cours…' : 'Exporter (CSV)'}
      </button>
      {erreur && (
        <div className="mt-2">
          <MessageErreur>Export impossible : {erreur}</MessageErreur>
        </div>
      )}
    </div>
  )
}

function FormulaireInscription({ onFermer, onInscrit }: { onFermer(): void; onInscrit(r: { client: Client; existant: boolean }): void }) {
  const { commerce, inscrireClient } = useStore()
  const [prenom, setPrenom] = useState('')
  const [contactSaisi, setContactSaisi] = useState('')
  const [essaye, setEssaye] = useState(false)
  const { executer, enCours, erreur } = useAction()
  const contact = analyserContact(contactSaisi)
  const valide = prenom.trim().length > 0 && contact !== null

  async function envoyer(e: FormEvent) {
    e.preventDefault()
    setEssaye(true)
    if (!valide || enCours) return
    const r = await executer(() => inscrireClient(commerce.id, prenom, contactSaisi))
    if (r.ok) onInscrit(r.valeur)
  }

  return (
    <form onSubmit={envoyer} className="carte mb-4 space-y-3">
      <h2 className="titre-carte">Nouveau client</h2>
      <div>
        <label className="etiquette" htmlFor="ins-prenom">
          Prénom
        </label>
        <input id="ins-prenom" className="champ" autoComplete="given-name" value={prenom} onChange={(e) => setPrenom(e.target.value)} autoFocus />
      </div>
      <div>
        <label className="etiquette" htmlFor="ins-contact">
          Téléphone ou e-mail (un seul suffit)
        </label>
        <input
          id="ins-contact"
          className="champ"
          inputMode="email"
          autoComplete="tel"
          placeholder="06 12 34 56 78 ou marie@exemple.fr"
          value={contactSaisi}
          onChange={(e) => setContactSaisi(e.target.value)}
        />
        {essaye && !contact && <p className="mt-1 text-sm text-red-700">Saisissez un numéro (10 chiffres) ou un e-mail valide.</p>}
      </div>
      <MessageErreur>{erreur && `Inscription non enregistrée : ${erreur}`}</MessageErreur>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="bouton-secondaire" onClick={onFermer}>
          Annuler
        </button>
        <button type="submit" className="bouton" disabled={!prenom.trim() || !contactSaisi.trim() || enCours}>
          {enCours ? 'Inscription…' : 'Inscrire'}
        </button>
      </div>
    </form>
  )
}

function LigneClient({ client: c }: { client: Client }) {
  const { commerce, validerVisite } = useStore()
  const [valide, setValide] = useState(false)
  const { executer, enCours, erreur } = useAction()
  const tampons = tamponsAffiches(c, commerce)
  const pct = Math.round((tampons / commerce.seuilTampons) * 100)
  const debloquee = recompenseDebloquee(c, commerce)

  return (
    <li className="carte">
      <div className="flex items-start justify-between gap-3">
        <a href={`#/client/${c.id}`} className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-lg font-semibold text-gray-900 underline decoration-gray-300 underline-offset-4">{c.prenom}</span>
            {estARelancer(c) && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-700">inactif</span>}
            {debloquee && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">récompense</span>}
          </span>
          <span className="block truncate text-sm text-gray-600">{c.telephone ?? c.email}</span>
        </a>
        <div className="shrink-0 text-right">
          <div className="text-lg font-extrabold tabular-nums">
            {tampons}
            <span className="text-sm font-semibold text-gray-600">/{commerce.seuilTampons}</span>
          </div>
          <div className="text-xs text-gray-600">tampons</div>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100" aria-hidden>
        <div className={`h-full rounded-full transition-all duration-500 ${debloquee ? 'bg-or-500' : 'bg-marque-500'}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 flex justify-between gap-3 text-xs text-gray-600">
        <span>Dernière visite : {c.derniereVisite ? dateRelative(c.derniereVisite) : 'aucune'}</span>
        <span>
          {c.visites.length} visite{c.visites.length > 1 ? 's' : ''}
        </span>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          className="bouton min-h-11 flex-1 py-2"
          disabled={enCours}
          onClick={async () => {
            // Le « ✓ » ne s'affiche qu'une fois la visite réellement enregistrée.
            if (!(await executer(() => validerVisite(c.id))).ok) return
            setValide(true)
            setTimeout(() => setValide(false), 1500)
          }}
        >
          {enCours ? 'Enregistrement…' : valide ? '✓ Tampon ajouté' : 'Valider une visite (+1)'}
        </button>
        {debloquee && (
          <a href={`#/client/${c.id}`} className="bouton-secondaire min-h-11 border-or-500 bg-amber-50 py-2 text-amber-900 hover:bg-amber-100">
            🎁 Récompense
          </a>
        )}
      </div>
      {erreur && (
        <div className="mt-2">
          <MessageErreur>Visite non enregistrée : {erreur}</MessageErreur>
        </div>
      )}
    </li>
  )
}

function LigneRelance({ client: c }: { client: Client }) {
  const { commerce } = useStore()
  const message = messageRelance(c, commerce)
  return (
    <li className="carte">
      <div className="flex items-baseline justify-between gap-3">
        <a href={`#/client/${c.id}`} className="text-lg font-semibold underline decoration-gray-300 underline-offset-4">
          {c.prenom}
        </a>
        <span className="shrink-0 text-sm text-gray-600">sans visite depuis {c.derniereVisite ? joursDepuis(c.derniereVisite) : '?'} j</span>
      </div>
      <div className="truncate text-sm text-gray-600">{c.telephone ?? c.email}</div>
      <p className="mt-2 rounded-xl bg-gray-50 p-3 text-sm text-gray-800 select-all">{message}</p>
      <BoutonCopier texte={message} className="bouton-secondaire mt-2 w-full" />
    </li>
  )
}

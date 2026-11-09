import { useState, type FormEvent } from 'react'
import { useDonneesCommerce, useStore } from '../store'
import type { Client } from '../types'
import { estActif, joursDepuis } from '../lib/stats'
import { dateRelative } from '../lib/format'
import { analyserContact, messageRelance, recompenseDebloquee, tamponsAffiches } from '../lib/fidelite'
import { BoutonCopier, EnTete, Vide } from '../components/ui'

type Filtre = 'tous' | 'actifs' | 'relancer'

export default function Clients() {
  const { commerce, clients } = useDonneesCommerce()
  const [recherche, setRecherche] = useState('')
  const [filtre, setFiltre] = useState<Filtre>('tous')
  const [inscription, setInscription] = useState(false)
  const [annonce, setAnnonce] = useState<{ client: Client; existant: boolean } | null>(null)

  const q = recherche.trim().toLowerCase()
  const liste = clients
    .filter((c) => (filtre === 'tous' ? true : filtre === 'actifs' ? estActif(c) : !estActif(c)))
    .filter((c) => !q || [c.prenom, c.telephone, c.email].some((v) => v?.toLowerCase().includes(q)))
    .sort((a, b) => (filtre === 'relancer' ? a.derniereVisite.localeCompare(b.derniereVisite) : b.derniereVisite.localeCompare(a.derniereVisite)))

  const nbInactifs = clients.filter((c) => !estActif(c)).length

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
        <p className="mb-4 rounded-xl bg-green-50 p-3 text-sm text-green-900 ring-1 ring-green-200" role="status">
          {annonce.existant ? `${annonce.client.prenom} était déjà inscrit(e) avec ce contact.` : `✓ ${annonce.client.prenom} est inscrit(e).`}{' '}
          <a href={`#/client/${annonce.client.id}`} className="font-semibold underline">
            Voir sa carte
          </a>
        </p>
      )}

      <input className="champ" type="search" placeholder="Rechercher un prénom, un téléphone…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />

      <div className="mt-3 mb-4 flex gap-2 overflow-x-auto" role="tablist">
        {(
          [
            ['tous', `Tous (${clients.length})`],
            ['actifs', `Actifs (${clients.length - nbInactifs})`],
            ['relancer', `À relancer (${nbInactifs})`],
          ] as [Filtre, string][]
        ).map(([valeur, libelle]) => (
          <button
            key={valeur}
            role="tab"
            aria-selected={filtre === valeur}
            onClick={() => setFiltre(valeur)}
            className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold ${filtre === valeur ? 'bg-marque-500 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-300'}`}
          >
            {libelle}
          </button>
        ))}
      </div>

      {filtre === 'relancer' && (
        <p className="mb-3 text-sm text-gray-600">
          Clients sans visite depuis plus de 30 jours. Copiez le message et envoyez-le vous-même (SMS, WhatsApp, e-mail) : Fideliz n’envoie rien.
        </p>
      )}

      {liste.length === 0 ? (
        <Vide>{filtre === 'relancer' ? 'Personne à relancer : tous vos clients sont venus ce mois-ci.' : 'Aucun client ne correspond.'}</Vide>
      ) : (
        <ul className="space-y-2">
          {liste.map((c) => (filtre === 'relancer' ? <LigneRelance key={c.id} client={c} /> : <LigneClient key={c.id} client={c} />))}
        </ul>
      )}
    </div>
  )
}

function FormulaireInscription({ onFermer, onInscrit }: { onFermer(): void; onInscrit(r: { client: Client; existant: boolean }): void }) {
  const { commerce, inscrireClient } = useStore()
  const [prenom, setPrenom] = useState('')
  const [contactSaisi, setContactSaisi] = useState('')
  const [essaye, setEssaye] = useState(false)
  const contact = analyserContact(contactSaisi)
  const valide = prenom.trim().length > 0 && contact !== null

  function envoyer(e: FormEvent) {
    e.preventDefault()
    setEssaye(true)
    if (!valide || !contact) return
    onInscrit(inscrireClient(commerce.id, prenom, contact))
  }

  return (
    <form onSubmit={envoyer} className="carte mb-4 space-y-3">
      <h2 className="text-lg font-bold">Nouveau client</h2>
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
        {essaye && !contact && <p className="mt-1 text-sm text-red-600">Saisissez un numéro (10 chiffres) ou un e-mail valide.</p>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="bouton-secondaire" onClick={onFermer}>
          Annuler
        </button>
        <button type="submit" className="bouton" disabled={!prenom.trim() || !contactSaisi.trim()}>
          Inscrire
        </button>
      </div>
    </form>
  )
}

function LigneClient({ client: c }: { client: Client }) {
  const { commerce, validerVisite } = useStore()
  const [valide, setValide] = useState(false)
  const tampons = tamponsAffiches(c, commerce)
  const pct = Math.round((tampons / commerce.seuilTampons) * 100)
  const debloquee = recompenseDebloquee(c, commerce)

  return (
    <li className="carte">
      <div className="flex items-start justify-between gap-3">
        <a href={`#/client/${c.id}`} className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-lg font-semibold text-gray-900 underline decoration-gray-300 underline-offset-4">{c.prenom}</span>
            {!estActif(c) && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-600">inactif</span>}
          </span>
          <span className="block truncate text-sm text-gray-500">{c.telephone ?? c.email}</span>
        </a>
        <div className="shrink-0 text-right">
          <div className="font-bold">
            {tampons}/{commerce.seuilTampons}
          </div>
          <div className="text-xs text-gray-500">tampons</div>
        </div>
      </div>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-gray-100" aria-hidden>
        <div className="h-full rounded-full bg-marque-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-xs text-gray-500">
        <span>Dernière visite : {c.visites.length ? dateRelative(c.derniereVisite) : 'aucune'}</span>
        <span>
          {c.visites.length} visite{c.visites.length > 1 ? 's' : ''}
        </span>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          className="bouton min-h-11 flex-1 py-2"
          onClick={() => {
            validerVisite(c.id)
            setValide(true)
            setTimeout(() => setValide(false), 1500)
          }}
        >
          {valide ? '✓ Tampon ajouté' : 'Valider une visite (+1)'}
        </button>
        {debloquee && (
          <a href={`#/client/${c.id}`} className="bouton-secondaire min-h-11 border-green-300 bg-green-50 py-2 text-green-800">
            🎁 Récompense
          </a>
        )}
      </div>
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
        <span className="text-sm text-gray-500">sans visite depuis {joursDepuis(c.derniereVisite)} j</span>
      </div>
      <div className="truncate text-sm text-gray-500">{c.telephone ?? c.email}</div>
      <p className="mt-2 rounded-xl bg-gray-50 p-3 text-sm text-gray-800 select-all">{message}</p>
      <BoutonCopier texte={message} className="bouton-secondaire mt-2 w-full" />
    </li>
  )
}

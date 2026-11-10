import { useEffect, useState, type FormEvent } from 'react'
import { useAction, useDonneesCommerce, useStore } from '../store'
import type { Client } from '../types'
import { estActif, estARelancer, joursDepuis } from '../lib/stats'
import { dateCourte, dateRelative } from '../lib/format'
import { libelleDuree, type ClientAPurger } from '../lib/rgpd'
import { analyserContact, messageRelance, recompenseDebloquee, tamponsAffiches } from '../lib/fidelite'
import { correspondRecherche } from '../lib/recherche'
import { etatSaisieContact, nomAffiche } from '../lib/inscriptionJeu'
import { MENTION_ENVOI } from '../lib/integrations'
import { pageClients, TAILLE_PAGE_CLIENTS } from '../lib/ecransCommercant'
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

  // Au-delà de 50 clients : « Charger plus » (la liste repart à 50 quand la recherche ou le filtre change).
  const [nbAffiches, setNbAffiches] = useState(TAILLE_PAGE_CLIENTS)
  useEffect(() => setNbAffiches(TAILLE_PAGE_CLIENTS), [recherche, filtre])
  const page = pageClients(liste, nbAffiches)

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
          {annonce.existant ? `${nomAffiche(annonce.client.prenom)} était déjà inscrit(e) avec ce contact.` : `✓ ${nomAffiche(annonce.client.prenom)} est inscrit(e).`}{' '}
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

      <ConservationDonnees />

      {filtre === 'relancer' && (
        <p className="mb-3 text-sm text-gray-600">
          Clients déjà venus, mais sans visite depuis plus de 30 jours. Copiez le message et envoyez-le vous-même (SMS, WhatsApp, e-mail).{' '}
          <span className="font-semibold">{MENTION_ENVOI}.</span>
        </p>
      )}

      {liste.length === 0 ? (
        <Vide>{filtre === 'relancer' ? 'Personne à relancer : aucun client n’est absent depuis plus de 30 jours.' : 'Aucun client ne correspond.'}</Vide>
      ) : (
        <>
          <ul className="space-y-2">
            {page.visibles.map((c) => (filtre === 'relancer' ? <LigneRelance key={c.id} client={c} /> : <LigneClient key={c.id} client={c} />))}
          </ul>
          {page.restants > 0 && (
            <div className="mt-3 space-y-1 text-center">
              <p className="text-sm text-gray-600" role="status">
                {page.visibles.length} affichés sur {liste.length}
              </p>
              <button type="button" className="bouton-secondaire w-full" onClick={() => setNbAffiches(page.visibles.length + page.prochain)}>
                Charger {page.prochain} de plus
              </button>
            </div>
          )}
        </>
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

/**
 * RGPD (P1-B6) — demandes de suppression reçues depuis les cartes, et purge de conservation : AVERTISSEMENT d'abord
 * (clients dont la durée est dépassée ou le sera sous 30 jours, avec la date prévue et ce qui les protège), puis
 * purge lancée par le commerçant après saisie de « PURGER ». Rien n'est jamais supprimé sans cette confirmation.
 */
function ConservationDonnees() {
  const { mode, api, acces, avecPin } = useStore()
  const { commerce, clients } = useDonneesCommerce()
  const { executer, enCours, erreur } = useAction()
  const [liste, setListe] = useState<{ conservationMois: number; clients: ClientAPurger[] } | null>(null)
  const [version, setVersion] = useState(0)
  const [confirmation, setConfirmation] = useState(false)
  const [saisie, setSaisie] = useState('')
  const [annonce, setAnnonce] = useState('')
  const demandes = clients.filter((c) => c.demandeSuppressionLe)

  useEffect(() => {
    if (mode !== 'api' || !api || !acces) return
    let actif = true
    // Lecture seule : appel direct (pas `avecPin`, qui rechargerait tout l'état et relancerait cet effet).
    api.listePurge(commerce.id, acces).then(
      (r) => actif && setListe(r),
      () => actif && setListe(null),
    )
    return () => {
      actif = false
    }
    // Relue quand la liste des clients change de taille (suppression, inscription) ou après une action ici.
  }, [mode, api, acces, commerce.id, clients.length, version])

  if (mode !== 'api') return null
  const dus = (liste?.clients ?? []).filter((c) => c.statut === 'due' && !c.protection)

  async function exclure(id: string) {
    setAnnonce('')
    const r = await executer(() => avecPin((a, x) => x.majClient(commerce.id, a, id, { exclusPurge: true })))
    if (r.ok) setVersion((v) => v + 1)
  }

  async function purger() {
    if (saisie.trim() !== 'PURGER') return
    const r = await executer(() => avecPin((a, x) => x.purger(commerce.id, a, dus.map((c) => c.id))))
    if (r.ok) {
      setAnnonce(`✓ ${r.valeur.supprimes} client(s) supprimé(s)${r.valeur.ignores ? `, ${r.valeur.ignores} ignoré(s) (revenus entre-temps ou protégés)` : ''}. Purge enregistrée dans le journal.`)
      setConfirmation(false)
      setSaisie('')
      setVersion((v) => v + 1)
    }
  }

  return (
    <section className="carte mb-4 space-y-3" aria-label="Données personnelles">
      <h2 className="titre-carte">Données personnelles (RGPD)</h2>
      {demandes.length > 0 && (
        <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
          <p className="font-semibold">
            {demandes.length} demande{demandes.length > 1 ? 's' : ''} de suppression reçue{demandes.length > 1 ? 's' : ''} depuis la carte :
          </p>
          <ul className="mt-1 space-y-1">
            {demandes.map((c) => (
              <li key={c.id}>
                <a href={`#/client/${c.id}`} className="inline-flex min-h-11 items-center font-semibold underline">
                  {c.prenom || 'Client sans prénom'} — le {dateCourte(c.demandeSuppressionLe!)}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-1">Ouvrez la fiche pour exporter ses données si besoin, puis « Supprimer ce client ».</p>
        </div>
      )}
      {!liste ? (
        <p className="text-sm text-gray-600">Durée de conservation : liste des cartes à purger indisponible pour le moment.</p>
      ) : (
        <>
          <p className="text-sm text-gray-600">
            Conservation : {libelleDuree(liste.conservationMois)} après la dernière visite (modifiable dans Réglages).{' '}
            {liste.clients.length ? 'Cartes concernées maintenant ou dans les 30 jours :' : 'Aucune carte à purger pour le moment.'}
          </p>
          {liste.clients.length > 0 && (
            <ul className="divide-y divide-gray-100 text-sm">
              {liste.clients.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <a href={`#/client/${c.id}`} className="font-semibold underline">
                      {c.prenom || 'Sans prénom'}
                    </a>
                    <span className="block text-sm text-gray-600">
                      Dernière activité {dateCourte(c.derniereActivite)} · purge {c.statut === 'due' ? 'possible depuis' : 'prévue le'} {dateCourte(c.purgeLe)}
                      {c.protection ? ` · conservé : ${c.protection.toLowerCase()}` : ''}
                    </span>
                  </span>
                  {!c.protection && (
                    <button type="button" className="bouton-secondaire min-h-11 shrink-0 px-3 text-sm" disabled={enCours} onClick={() => void exclure(c.id)}>
                      Exclure
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {dus.length > 0 &&
            (!confirmation ? (
              <button type="button" className="bouton-secondaire w-full text-red-700" disabled={enCours} onClick={() => (setConfirmation(true), setSaisie(''), setAnnonce(''))}>
                Purger {dus.length} client{dus.length > 1 ? 's' : ''} inactif{dus.length > 1 ? 's' : ''}…
              </button>
            ) : (
              <div className="space-y-2 rounded-xl bg-red-50 p-3 ring-1 ring-red-200">
                <p className="text-sm text-red-900">
                  Suppression <strong>définitive</strong> de {dus.length} client{dus.length > 1 ? 's' : ''} (cartes, historique, gains, journal) : impossible à annuler.
                </p>
                <label className="etiquette" htmlFor="confirmer-purge">
                  Tapez PURGER pour confirmer
                </label>
                <input id="confirmer-purge" className="champ" autoComplete="off" value={saisie} onChange={(e) => setSaisie(e.target.value)} />
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className="bouton-secondaire min-h-11" disabled={enCours} onClick={() => setConfirmation(false)}>
                    Annuler
                  </button>
                  <button type="button" className="bouton min-h-11 bg-red-700 hover:bg-red-800 active:bg-red-900" disabled={enCours || saisie.trim() !== 'PURGER'} onClick={() => void purger()}>
                    {enCours ? 'Purge…' : 'Purger'}
                  </button>
                </div>
              </div>
            ))}
        </>
      )}
      <MessageErreur>{erreur && `Rien n’a été supprimé : ${erreur}`}</MessageErreur>
      {annonce && (
        <p className="alerte-succes" role="status">
          {annonce}
        </p>
      )}
    </section>
  )
}

function FormulaireInscription({ onFermer, onInscrit }: { onFermer(): void; onInscrit(r: { client: Client; existant: boolean }): void }) {
  const { commerce, inscrireClient } = useStore()
  const [prenom, setPrenom] = useState('')
  const [contactSaisi, setContactSaisi] = useState('')
  // Relances SMS / e-mail (P1-B3) : à cocher seulement si le client l'accepte de vive voix — jamais pré-cochée.
  const [consentement, setConsentement] = useState(false)
  const [essaye, setEssaye] = useState(false)
  const { executer, enCours, erreur } = useAction()
  const contact = analyserContact(contactSaisi)
  const saisie = etatSaisieContact(contactSaisi, essaye)
  // Prénom optionnel, comme sur la page de jeu (P1-C1) : seul le téléphone ou l'e-mail est obligatoire.
  const valide = contact !== null

  async function envoyer(e: FormEvent) {
    e.preventDefault()
    setEssaye(true)
    if (!valide || enCours) return
    const r = await executer(() => inscrireClient(commerce.id, prenom, contactSaisi, consentement))
    if (r.ok) onInscrit(r.valeur)
  }

  return (
    <form onSubmit={envoyer} className="carte mb-4 space-y-3">
      <h2 className="titre-carte">Nouveau client</h2>
      <div>
        <label className="etiquette" htmlFor="ins-contact">
          Téléphone ou e-mail (un seul suffit)
        </label>
        {/* autocomplete off : ce sont les coordonnées du CLIENT, pas celles de l'appareil du commerce. */}
        <input
          id="ins-contact"
          className="champ"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="06 12 34 56 78 ou marie@exemple.fr"
          aria-invalid={saisie.niveau === 'erreur'}
          aria-describedby="ins-contact-aide"
          value={contactSaisi}
          onChange={(e) => setContactSaisi(e.target.value)}
          autoFocus
        />
        <p
          id="ins-contact-aide"
          aria-live="polite"
          className={`mt-1 min-h-5 text-sm ${saisie.niveau === 'erreur' ? 'text-red-700' : saisie.niveau === 'ok' ? 'font-semibold text-green-800' : 'text-gray-600'}`}
        >
          {saisie.message}
        </p>
      </div>
      <div>
        <label className="etiquette" htmlFor="ins-prenom">
          Prénom (optionnel)
        </label>
        <input id="ins-prenom" className="champ" autoComplete="off" value={prenom} onChange={(e) => setPrenom(e.target.value)} />
      </div>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-gray-700">
        <span className="zone-case">
          <input type="checkbox" className="case-a-cocher" checked={consentement} onChange={(e) => setConsentement(e.target.checked)} />
        </span>
        <span>Le client accepte de recevoir nos offres par SMS ou e-mail (désinscription à tout moment).</span>
      </label>
      <MessageErreur>{erreur && `Inscription non enregistrée : ${erreur}`}</MessageErreur>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="bouton-secondaire" onClick={onFermer}>
          Annuler
        </button>
        <button type="submit" className="bouton" disabled={!contactSaisi.trim() || enCours}>
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
            <span className="text-lg font-semibold text-gray-900 underline decoration-gray-300 underline-offset-4">{nomAffiche(c.prenom)}</span>
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
      <div className="mt-2 flex justify-between gap-3 text-sm text-gray-600">
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
          {nomAffiche(c.prenom)}
        </a>
        <span className="shrink-0 text-sm text-gray-600">sans visite depuis {c.derniereVisite ? joursDepuis(c.derniereVisite) : '?'} j</span>
      </div>
      <div className="truncate text-sm text-gray-600">{c.telephone ?? c.email}</div>
      <p className="mt-2 rounded-xl bg-gray-50 p-3 text-sm text-gray-800 select-all">{message}</p>
      <BoutonCopier texte={message} className="bouton-secondaire mt-2 w-full" />
    </li>
  )
}

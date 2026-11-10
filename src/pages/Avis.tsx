import { createContext, useCallback, useContext, useEffect, useState, type FormEvent } from 'react'
import { useAction, useDonneesCommerce, useStore } from '../store'
import { useRoute } from '../router'
import type { Avis, StatutAvis } from '../types'
import type { EtatGoogle } from '../data/api'
import { noteMoyenne } from '../lib/stats'
import { dateRelative } from '../lib/format'
import { LIBELLE_SOURCE, MODELES, appliquerRegles, modeleSuggere, refusPublication, sourceAvis, statutAvis, texteModele } from '../lib/avis'
import { ETAPES_CONNEXION_GOOGLE, GUIDE_GOOGLE_BUSINESS, TEXTE_AVIS_DEMO, TEXTE_AVIS_VIDE_PRODUCTION, etatGoogleBusiness } from '../lib/integrations'
import { BadgeDemo, EnTete, Etoiles, MessageErreur, Vide } from '../components/ui'
import { InvitationAvis } from '../components/InvitationAvis'
import { messagesPrivesDuCommerce, type MessagePriveCommerce } from '../lib/messagePrive'
import { googleDejaLu, marquerGoogleLu } from '../lib/ecransCommercant'

/** État Google Business Profile (P1-B4) : null = non configuré sur le serveur, mode local ou état inconnu. */
const ContexteGoogle = createContext<{ etat: EtatGoogle | null; relire(): void }>({ etat: null, relire: () => {} })

/** `configure` d'abord lu dans /sante (sans PIN) ; l'état de connexion n'est demandé que si Google est configuré. */
function useEtatGoogle(commerceId: string) {
  const { api, avecPin, estDemo } = useStore()
  const [etat, setEtat] = useState<EtatGoogle | null>(null)
  const [tour, setTour] = useState(0)
  useEffect(() => {
    if (!api || estDemo) return
    let actif = true
    api
      .sante()
      .then((s) => (s.integrations?.googleBusinessProfile ? avecPin((a, x) => x.etatGoogle(commerceId, a)) : null))
      .then(
        (e) => actif && setEtat(e),
        () => actif && setEtat(null),
      )
    return () => {
      actif = false
    }
  }, [api, avecPin, estDemo, commerceId, tour])
  return { etat, relire: useCallback(() => setTour((t) => t + 1), []) }
}

type Filtre = 'tous' | 'aTraiter' | 'negatifs'

const STATUTS: Record<StatutAvis, { libelle: string; classe: string }> = {
  sansReponse: { libelle: 'Sans réponse', classe: 'bg-red-50 text-red-700 ring-red-200' },
  brouillon: { libelle: 'Brouillon', classe: 'bg-amber-50 text-amber-800 ring-amber-200' },
  repondu: { libelle: 'Répondu', classe: 'bg-green-50 text-green-800 ring-green-200' },
}

export default function AvisPage() {
  const { commerce, avis, clients } = useDonneesCommerce()
  const messagesPrives = messagesPrivesDuCommerce(clients)
  const { appliquerReglesAvis, mode, estDemo } = useStore()
  const regles = useAction()
  const google = useEtatGoogle(commerce.id)
  const { param } = useRoute()
  const [filtre, setFiltre] = useState<Filtre>('tous')
  const [simulation, setSimulation] = useState(false)
  const moyenne = noteMoyenne(avis)
  const nbATraiter = avis.filter((a) => !a.reponse).length
  // Avis que les règles actuelles modifieraient (réponse auto ou brouillon manquant).
  const nbConcernes = avis.filter((a) => appliquerRegles(a, commerce) !== a).length

  const liste = avis.filter((a) => (filtre === 'aTraiter' ? !a.reponse : filtre === 'negatifs' ? a.note <= 3 : true))

  return (
    <ContexteGoogle.Provider value={google}>
      <EnTete
        titre="Avis Google"
        sousTitre={moyenne === null ? 'Aucun avis' : `${moyenne.toLocaleString('fr-FR')} ★ de moyenne · ${avis.length} avis · ${nbATraiter} sans réponse`}
      />

      <p className="mb-4">
        {estDemo ? (
          <BadgeDemo>{TEXTE_AVIS_DEMO}</BadgeDemo>
        ) : (
          <span className="text-sm text-gray-600">{etatGoogleBusiness(google.etat).texte}</span>
        )}
      </p>

      {/* Retour de l'écran de consentement Google (redirection du serveur vers #/avis/google-connecte ou google-refuse). */}
      {param === 'google-connecte' && <p className="carte mb-4 text-sm font-semibold text-green-800">Google est connecté. Vous pouvez importer vos avis.</p>}
      {param === 'google-refuse' && <p className="carte mb-4 text-sm font-semibold text-amber-800">Connexion Google annulée : aucun accès n’a été donné.</p>}

      {!estDemo && <ConnecterGoogle />}

      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        {commerce.lienGoogle && (
          <a href={commerce.lienGoogle} target="_blank" rel="noopener noreferrer" className="bouton-secondaire">
            Ouvrir le lien Google ↗
          </a>
        )}
        <button className="bouton-secondaire" onClick={() => setSimulation((s) => !s)} aria-expanded={simulation}>
          {mode === 'local' ? '+ Simuler un nouvel avis' : '+ Saisir un avis reçu'}
        </button>
      </div>

      {simulation && <FormulaireSimulation onFermer={() => setSimulation(false)} />}

      <MessagesPrives messages={messagesPrives} />

      <ApercuInvitation />

      <div className="carte mb-4 text-sm text-gray-600 sm:p-4">
        Règles actives :{' '}
        {[
          commerce.reglesReponseAuto.auto5Etoiles && 'réponse auto aux 5★',
          commerce.reglesReponseAuto.auto4Etoiles && 'réponse auto aux 4★',
          commerce.reglesReponseAuto.brouillonAutres && 'brouillon proposé pour les autres',
        ]
          .filter(Boolean)
          .join(' · ') || 'aucune'}{' '}
        —{' '}
        <a href="#/reglages" className="lien">
          modifier
        </a>
        {nbConcernes > 0 && (
          <button
            className="bouton mt-2 min-h-11 w-full py-2"
            disabled={regles.enCours}
            onClick={() => void regles.executer(() => appliquerReglesAvis(commerce.id))}
          >
            Appliquer les règles à {nbConcernes} avis en attente
          </button>
        )}
        {regles.erreur && (
          <div className="mt-2">
            <MessageErreur>Règles non appliquées : {regles.erreur}</MessageErreur>
          </div>
        )}
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto">
        {(
          [
            ['tous', 'Tous'],
            ['aTraiter', `À traiter (${nbATraiter})`],
            ['negatifs', '3★ et moins'],
          ] as [Filtre, string][]
        ).map(([valeur, libelle]) => (
          <button
            key={valeur}
            onClick={() => setFiltre(valeur)}
            aria-pressed={filtre === valeur}
            className="puce"
          >
            {libelle}
          </button>
        ))}
      </div>

      {avis.length === 0 && !estDemo ? (
        <Vide>{TEXTE_AVIS_VIDE_PRODUCTION}</Vide>
      ) : liste.length === 0 ? (
        <Vide>Aucun avis dans cette catégorie.</Vide>
      ) : (
        <ul className="space-y-3">
          {liste.map((a) => (
            <CarteAvis key={a.id} avis={a} />
          ))}
        </ul>
      )}
    </ContexteGoogle.Provider>
  )
}

/**
 * Messages privés laissés après le jeu (P1-C4) : note basse dans l'app → le client a écrit au restaurant avant (ou au
 * lieu de) Google. Prénom et lien vers la fiche seulement ; rien n'est publié ni expédié.
 */
function MessagesPrives({ messages }: { messages: MessagePriveCommerce[] }) {
  return (
    <details className="carte mb-4" open={messages.length > 0} data-messages-prives>
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 font-bold">
        Messages privés des clients <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">{messages.length}</span>
      </summary>
      <p className="mt-2 text-sm text-gray-600">
        Après la roue, un client qui choisit 3★ ou moins peut vous écrire en privé avant de publier sur Google (le lien Google lui reste proposé). Ces messages ne
        sont pas publiés.
      </p>
      {messages.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">Aucun message privé pour le moment.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {messages.map((m) => (
            <li key={m.id} className="rounded-xl bg-fond p-3">
              <div className="flex items-center justify-between gap-2">
                <a href={`#/client/${m.clientId}`} className="min-w-0 truncate font-semibold underline">
                  {m.prenom.trim() || 'Client sans prénom'}
                </a>
                <Etoiles note={m.note} />
              </div>
              <p className="mt-1 text-xs text-gray-600">{dateRelative(m.creeLe)}</p>
              <p className="mt-2 whitespace-pre-line break-words text-gray-800">{m.texte}</p>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}

/** Ce que voit le client après la roue : 5 étoiles pré-remplies DANS l'app, puis le lien Google direct. */
function ApercuInvitation() {
  const { commerce } = useStore()
  return (
    <details className="carte mb-4">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 font-bold">
        Invitation à l’avis vue par le client <span className="text-sm font-semibold text-marque-600">aperçu</span>
      </summary>
      <p className="mt-2 text-sm text-gray-600">
        Après la roue, le client voit 5 étoiles déjà sélectionnées dans l’app (modifiables d’un tap), puis ouvre votre lien Google. Google ne permet pas de
        pré-remplir la note : le client confirme ses étoiles sur Google avant de publier.
      </p>
      <div className="mt-3">
        <InvitationAvis commerce={commerce} />
      </div>
    </details>
  )
}

/**
 * Google Business Profile : étapes à suivre tant que le serveur n'est pas configuré (rien n'est appelé chez Google),
 * puis connexion (consentement sur l'écran Google), import des avis et déconnexion une fois configuré.
 */
function ConnecterGoogle() {
  const { commerce, avecPin } = useStore()
  const { etat, relire } = useContext(ContexteGoogle)
  const { executer, enCours, erreur } = useAction()
  const [bilan, setBilan] = useState<string | null>(null)
  const { badge } = etatGoogleBusiness(etat)
  const branche = !!etat?.configure
  // Replié une fois lu (P1-C6) : mémorisé sur l'appareil, le badge d'état reste visible dans le titre.
  const [lu, setLu] = useState(() => googleDejaLu(stockageLocal(), commerce.id))
  const marquerLu = () => {
    marquerGoogleLu(stockageLocal(), commerce.id)
    setLu(true)
  }

  async function connecter() {
    const r = await executer(() => avecPin((a, api) => api.lienConnexionGoogle(commerce.id, a)))
    if (r.ok) window.location.assign(r.valeur)
  }
  async function importer() {
    setBilan(null)
    const r = await executer(() => avecPin((a, api) => api.importerAvisGoogle(commerce.id, a)))
    if (r.ok) {
      const v = r.valeur
      setBilan(
        `${v.importes} nouvel(s) avis, ${v.misAJour} mis à jour, ${v.publiees} réponse(s) auto 5★ publiée(s)` +
          (v.echecsPublication ? ` — ${v.echecsPublication} publication(s) en échec : ${v.erreurPublication ?? ''}` : '') +
          '.',
      )
      relire()
    }
  }
  async function deconnecter() {
    if (!window.confirm('Déconnecter Google ? Les avis déjà importés restent dans l’app.')) return
    if ((await executer(() => avecPin((a, api) => api.deconnecterGoogle(commerce.id, a)))).ok) relire()
  }

  return (
    <details className="carte mb-4" open={branche && !lu} onToggle={(e) => !e.currentTarget.open && !lu && marquerLu()} data-google-lu={lu}>
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 font-bold">
        Connecter Google <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">{badge}</span>
      </summary>
      {branche ? (
        <div className="mt-2 space-y-2">
          {etat?.connecte ? (
            <>
              <p className="text-sm text-gray-600">
                Connecté{etat.connecteLe ? ` ${dateRelative(etat.connecteLe)}` : ''}. L’import applique vos règles : réponse auto publiée d’office seulement pour les
                nouveaux avis 5★ (postés après la connexion) et si la règle est active ; brouillon à valider pour les autres.
              </p>
              <button className="bouton w-full" disabled={enCours} onClick={() => void importer()}>
                {enCours ? 'Import…' : 'Importer les avis Google'}
              </button>
              <button className="bouton-secondaire w-full" disabled={enCours} onClick={() => void deconnecter()}>
                Déconnecter Google
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600">Connectez le compte Google propriétaire ou gestionnaire de la fiche : Google vous demandera votre accord.</p>
              <button className="bouton w-full" disabled={enCours} onClick={() => void connecter()}>
                Connecter Google
              </button>
            </>
          )}
          {bilan && <p className="text-sm font-semibold text-gray-700">{bilan}</p>}
          <MessageErreur>{erreur}</MessageErreur>
        </div>
      ) : (
        <p className="mt-2 text-sm text-gray-600">
          Aucun identifiant Google n’est configuré : rien n’est importé et aucun appel n’est fait à Google. Pour importer vos avis et publier vos réponses, il
          faudra :
        </p>
      )}
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-600">
        {ETAPES_CONNEXION_GOOGLE.map((e) => (
          <li key={e} className="break-words">
            {e}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-gray-600">{GUIDE_GOOGLE_BUSINESS}</p>
      {commerce.lienGoogle && (
        <p className="mt-3 text-sm text-gray-700">
          En attendant, le moyen réel de recevoir des avis est le lien « laisser un avis » (QR de la roulette) :{' '}
          <a href={commerce.lienGoogle} target="_blank" rel="noopener noreferrer" className="font-semibold text-marque-600 underline">
            ouvrir le lien ↗
          </a>
        </p>
      )}
      {!lu && (
        <button type="button" className="mt-3 min-h-11 text-sm font-semibold text-gray-700 underline" onClick={(e) => (marquerLu(), e.currentTarget.closest('details')?.removeAttribute('open'))}>
          J’ai lu — replier
        </button>
      )}
    </details>
  )
}

function stockageLocal(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function CarteAvis({ avis: a }: { avis: Avis }) {
  const { commerce, majAvis, estDemo, avecPin } = useStore()
  const { etat: google } = useContext(ContexteGoogle)
  const statut = statutAvis(a)
  const [edition, setEdition] = useState(false)
  const [texte, setTexte] = useState('')
  const { executer, enCours, erreur } = useAction()
  const source = sourceAvis(a)
  // Publication sur Google : avis importé, Google connecté, réponse validée (ou auto 5★ de la règle active), pas déjà publiée.
  const publiable = !!google?.connecte && !a.reponsePublieeLe && refusPublication(a, commerce) === null
  const aValider = source === 'google' && !!google?.connecte && !a.reponsePublieeLe && !!a.reponse && !publiable

  const publier = () => executer(() => avecPin((acc, api) => api.publierReponse(a.commerceId, acc, a.id)))

  async function enregistrer(maj: { reponse?: string; brouillon?: string | null }) {
    // L'éditeur ne se ferme qu'une fois la réponse réellement enregistrée.
    if ((await executer(() => majAvis(a, maj))).ok) setEdition(false)
  }

  function ouvrir() {
    setTexte(a.reponse ?? a.brouillon ?? texteModele(modeleSuggere(a), a, commerce))
    setEdition(true)
  }

  return (
    <li className="carte">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-semibold">{a.auteur}</span>
        <Etoiles note={a.note} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
        <span>{dateRelative(a.date)}</span>
        <span className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${STATUTS[statut].classe}`}>{STATUTS[statut].libelle}</span>
        {a.reponseAuto && <span className="rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-gray-600">auto</span>}
        <span className="rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-gray-600">{LIBELLE_SOURCE[source]}</span>
      </div>
      <p className="mt-2 text-gray-800">{a.texte || <em className="text-gray-500">Note sans commentaire</em>}</p>

      {edition ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-semibold text-gray-700">Modèles (1 tap) :</p>
          <div className="flex flex-wrap gap-2">
            {MODELES.map((m) => (
              <button
                key={m.cle}
                type="button"
                onClick={() => setTexte(texteModele(m.cle, a, commerce))}
                className={`min-h-11 rounded-full px-3 text-sm font-semibold ring-1 ${
                  modeleSuggere(a) === m.cle ? 'bg-marque-50 text-marque-700 ring-marque-200' : 'bg-white text-gray-700 ring-gray-300'
                }`}
              >
                {m.libelle}
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor={`rep-${a.id}`}>
            Réponse à {a.auteur}
          </label>
          <textarea id={`rep-${a.id}`} className="champ min-h-32" value={texte} onChange={(e) => setTexte(e.target.value)} />
          <MessageErreur>{erreur && `Non enregistré : ${erreur}`}</MessageErreur>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="bouton-secondaire"
              onClick={() => void enregistrer({ brouillon: texte.trim() || null })}
              disabled={!!a.reponse || enCours}
              title={a.reponse ? 'Déjà répondu' : undefined}
            >
              Garder en brouillon
            </button>
            <button type="button" className="bouton" disabled={!texte.trim() || enCours} onClick={() => void enregistrer({ reponse: texte.trim() })}>
              Marquer comme répondu
            </button>
          </div>
          <button type="button" className="min-h-11 w-full text-sm font-semibold text-gray-600" onClick={() => setEdition(false)}>
            Annuler
          </button>
        </div>
      ) : (
        <>
          {(a.reponse || a.brouillon) && (
            <div className={`mt-3 rounded-xl p-3 text-sm ${a.reponse ? 'bg-gray-50' : 'bg-amber-50'}`}>
              <span className="font-semibold text-gray-700">{a.reponse
                  ? a.reponsePublieeLe
                    ? `Réponse publiée sur Google ${dateRelative(a.reponsePublieeLe)}`
                    : a.reponseAuto
                      ? `Réponse automatique préparée (${estDemo ? 'démo — ' : ''}${publiable ? 'pas encore publiée' : 'rien n’est publié sur Google'})`
                      : 'Votre réponse'
                  : 'Brouillon proposé (à valider avant toute publication)'}</span>
              <p className="mt-1 text-gray-700">{a.reponse ?? a.brouillon}</p>
            </div>
          )}
          {publiable && (
            <button className="bouton mt-3 w-full" disabled={enCours} onClick={() => void publier()}>
              {enCours ? 'Publication…' : 'Publier sur Google'}
            </button>
          )}
          {aValider && <p className="mt-2 text-sm text-amber-800">{refusPublication(a, commerce)}</p>}
          <MessageErreur>{erreur && `Non publié : ${erreur}`}</MessageErreur>
          <button className={`${a.reponse ? 'bouton-secondaire' : 'bouton'} mt-3 w-full`} onClick={ouvrir}>
            {a.reponse ? 'Modifier la réponse' : a.brouillon ? 'Relire et valider le brouillon' : 'Répondre'}
          </button>
        </>
      )}
    </li>
  )
}

function FormulaireSimulation({ onFermer }: { onFermer(): void }) {
  const { commerce, ajouterAvis, mode } = useStore()
  const [auteur, setAuteur] = useState('')
  const [note, setNote] = useState(5)
  const [texte, setTexte] = useState('')
  const { executer, enCours, erreur } = useAction()

  async function envoyer(e: FormEvent) {
    e.preventDefault()
    if (!auteur.trim() || enCours) return
    if ((await executer(() => ajouterAvis(commerce.id, { auteur: auteur.trim(), note, texte: texte.trim() }))).ok) onFermer()
  }

  return (
    <form onSubmit={envoyer} className="carte mb-4 space-y-3">
      <h2 className="text-lg font-bold">{mode === 'local' ? 'Simuler l’arrivée d’un avis' : 'Saisir un avis reçu sur Google'}</h2>
      <p className="text-sm text-gray-600">
        {mode === 'local'
          ? 'Pour la démo : l’avis apparaît comme s’il venait de Google, et vos règles automatiques s’appliquent aussitôt.'
          : 'Recopiez un avis lu sur votre fiche Google : vos règles automatiques s’appliquent aussitôt (rien n’est publié sur Google).'}
      </p>
      <div>
        <label className="etiquette" htmlFor="sim-auteur">
          Auteur
        </label>
        <input id="sim-auteur" className="champ" placeholder="ex : Marie D." value={auteur} onChange={(e) => setAuteur(e.target.value)} autoFocus />
      </div>
      <fieldset>
        <legend className="etiquette">Note</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNote(n)}
              aria-pressed={note === n}
              aria-label={`${n} étoile${n > 1 ? 's' : ''}`}
              className={`h-12 flex-1 rounded-xl text-2xl ${n <= note ? 'text-amber-500' : 'text-gray-300'} ${note === n ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-white ring-1 ring-gray-200'}`}
            >
              ★
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="etiquette" htmlFor="sim-texte">
          Texte (optionnel)
        </label>
        <textarea id="sim-texte" className="champ min-h-24" value={texte} onChange={(e) => setTexte(e.target.value)} />
      </div>
      <MessageErreur>{erreur && `Avis non ajouté : ${erreur}`}</MessageErreur>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="bouton-secondaire" onClick={onFermer}>
          Annuler
        </button>
        <button type="submit" className="bouton" disabled={!auteur.trim() || enCours}>
          {enCours ? 'Ajout…' : 'Ajouter l’avis'}
        </button>
      </div>
    </form>
  )
}

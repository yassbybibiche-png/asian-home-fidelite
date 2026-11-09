import { useState, type FormEvent } from 'react'
import { useAction, useDonneesCommerce, useStore } from '../store'
import type { Avis, StatutAvis } from '../types'
import { noteMoyenne } from '../lib/stats'
import { dateRelative } from '../lib/format'
import { MODELES, appliquerRegles, modeleSuggere, statutAvis, texteModele } from '../lib/avis'
import { ETAPES_CONNEXION_GOOGLE, TEXTE_AVIS_DEMO, TEXTE_AVIS_VIDE_PRODUCTION } from '../lib/integrations'
import { BadgeDemo, EnTete, Etoiles, MessageErreur, Vide } from '../components/ui'

type Filtre = 'tous' | 'aTraiter' | 'negatifs'

const STATUTS: Record<StatutAvis, { libelle: string; classe: string }> = {
  sansReponse: { libelle: 'Sans réponse', classe: 'bg-red-50 text-red-700 ring-red-200' },
  brouillon: { libelle: 'Brouillon', classe: 'bg-amber-50 text-amber-800 ring-amber-200' },
  repondu: { libelle: 'Répondu', classe: 'bg-green-50 text-green-800 ring-green-200' },
}

export default function AvisPage() {
  const { commerce, avis } = useDonneesCommerce()
  const { appliquerReglesAvis, mode, estDemo } = useStore()
  const regles = useAction()
  const [filtre, setFiltre] = useState<Filtre>('tous')
  const [simulation, setSimulation] = useState(false)
  const moyenne = noteMoyenne(avis)
  const nbATraiter = avis.filter((a) => !a.reponse).length
  // Avis que les règles actuelles modifieraient (réponse auto ou brouillon manquant).
  const nbConcernes = avis.filter((a) => appliquerRegles(a, commerce) !== a).length

  const liste = avis.filter((a) => (filtre === 'aTraiter' ? !a.reponse : filtre === 'negatifs' ? a.note <= 3 : true))

  return (
    <div>
      <EnTete
        titre="Avis Google"
        sousTitre={moyenne === null ? 'Aucun avis' : `${moyenne.toLocaleString('fr-FR')} ★ de moyenne · ${avis.length} avis · ${nbATraiter} sans réponse`}
      />

      <p className="mb-4">
        {estDemo ? (
          <BadgeDemo>{TEXTE_AVIS_DEMO}</BadgeDemo>
        ) : (
          <span className="text-sm text-gray-600">
            Connexion à Google : à brancher. En attendant, aucun avis n’est importé : vous pouvez recopier un avis reçu à la main, et aucune réponse n’est
            publiée sur Google (copiez-la vous-même).
          </span>
        )}
      </p>

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

      <div className="mb-4 rounded-xl bg-white p-3 text-sm text-gray-600 ring-1 ring-gray-200">
        Règles actives :{' '}
        {[
          commerce.reglesReponseAuto.auto5Etoiles && 'réponse auto aux 5★',
          commerce.reglesReponseAuto.auto4Etoiles && 'réponse auto aux 4★',
          commerce.reglesReponseAuto.brouillonAutres && 'brouillon proposé pour les autres',
        ]
          .filter(Boolean)
          .join(' · ') || 'aucune'}{' '}
        —{' '}
        <a href="#/reglages" className="inline-flex min-h-11 items-center font-semibold text-marque-600 underline">
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
            className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold ${filtre === valeur ? 'bg-marque-500 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-300'}`}
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
    </div>
  )
}

/** Étapes exactes pour connecter Google Business Profile — rien n'est appelé chez Google sans identifiants. */
function ConnecterGoogle() {
  const { commerce } = useStore()
  return (
    <details className="carte mb-4">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 font-bold">
        Connecter Google <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">à brancher</span>
      </summary>
      <p className="mt-2 text-sm text-gray-600">
        Aucun identifiant Google n’est configuré : rien n’est importé et aucun appel n’est fait à Google. Pour importer vos avis et publier vos réponses, il
        faudra :
      </p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-600">
        {ETAPES_CONNEXION_GOOGLE.map((e) => (
          <li key={e} className="break-words">
            {e}
          </li>
        ))}
      </ol>
      {commerce.lienGoogle && (
        <p className="mt-3 text-sm text-gray-700">
          En attendant, le moyen réel de recevoir des avis est le lien « laisser un avis » (QR de la roulette) :{' '}
          <a href={commerce.lienGoogle} target="_blank" rel="noopener noreferrer" className="font-semibold text-marque-600 underline">
            ouvrir le lien ↗
          </a>
        </p>
      )}
    </details>
  )
}

function CarteAvis({ avis: a }: { avis: Avis }) {
  const { commerce, majAvis, estDemo } = useStore()
  const statut = statutAvis(a)
  const [edition, setEdition] = useState(false)
  const [texte, setTexte] = useState('')
  const { executer, enCours, erreur } = useAction()

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
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span>{dateRelative(a.date)}</span>
        <span className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${STATUTS[statut].classe}`}>{STATUTS[statut].libelle}</span>
        {a.reponseAuto && <span className="rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-gray-600">auto</span>}
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
                  ? a.reponseAuto
                    ? `Réponse automatique préparée (${estDemo ? 'démo — ' : ''}rien n’est publié sur Google)`
                    : 'Votre réponse'
                  : 'Brouillon proposé'}</span>
              <p className="mt-1 text-gray-700">{a.reponse ?? a.brouillon}</p>
            </div>
          )}
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

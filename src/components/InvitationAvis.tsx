import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { Commerce } from '../types'
import { MESSAGE_HORS_LIGNE } from '../data/api'
import {
  proposerMessagePrive,
  TEXTE_GOOGLE_APRES_PRIVE,
  TEXTE_MAX,
  TEXTE_MESSAGE_ENVOYE,
  TEXTE_MESSAGE_PRIVE,
  TITRE_MESSAGE_PRIVE,
} from '../lib/messagePrive'
import { MessageErreur } from './ui'
import { useLangue } from './Langue'
import { useStore } from '../store'
import { useRoute } from '../router'
import {
  NOTE_PAR_DEFAUT,
  TEXTE_CONFIRMATION_GOOGLE,
  TEXTE_INVITATION,
  choisirNote,
  etoilesRemplies,
  libelleBoutonAvis,
  libelleNote,
  lienAvisGoogle,
} from '../lib/invitationAvis'

/**
 * 5 étoiles dorées, déjà remplies par défaut ; un tap sur une étoile ajuste la note (1 à 5).
 * Clavier (P2-Q1, motif « radiogroup ») : une seule étoile dans l'ordre de tabulation, flèches pour changer la note.
 */
export function SelecteurEtoiles({ note, onChange }: { note: number; onChange(n: number): void }) {
  const groupe = useRef<HTMLDivElement>(null)
  const { t } = useLangue()
  function clavier(e: KeyboardEvent) {
    const pas = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
    const cible = e.key === 'Home' ? 1 : e.key === 'End' ? 5 : pas ? choisirNote(note + pas) : 0
    if (!cible) return
    e.preventDefault()
    onChange(cible)
    groupe.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[cible - 1]?.focus()
  }
  return (
    <div ref={groupe} className="flex justify-center gap-1" role="radiogroup" aria-label={t('Votre note')} onKeyDown={clavier}>
      {etoilesRemplies(note).map((remplie, i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={note === i + 1}
          tabIndex={note === i + 1 ? 0 : -1}
          aria-label={t(i ? '{n} étoiles' : '{n} étoile', { n: i + 1 })}
          onClick={() => onChange(choisirNote(i + 1))}
          className={`etoile ${remplie ? 'text-amber-400' : 'text-gray-300'}`}
        >
          <svg viewBox="0 0 24 24" className="h-9 w-9" aria-hidden>
            <path
              d="M12 2.8l2.83 5.73 6.32.92-4.57 4.46 1.08 6.3L12 17.24l-5.66 2.97 1.08-6.3-4.57-4.46 6.32-.92z"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth={1}
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ))}
    </div>
  )
}

/**
 * Message privé au restaurant (P1-C4), proposé AVANT Google quand la note choisie est basse. Sans `onEnvoyer`
 * (aperçu de la page Avis), le formulaire est affiché mais ne peut pas être envoyé.
 */
function MessagePriveRestaurant({ note, onEnvoyer }: { note: number; onEnvoyer?(note: number, texte: string): Promise<void> }) {
  const [texte, setTexte] = useState('')
  const [envoye, setEnvoye] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  if (envoye)
    return (
      <p className="alerte-succes" role="status" data-message-prive="envoye">
        ✓ {TEXTE_MESSAGE_ENVOYE}
      </p>
    )

  async function envoyer(e: FormEvent) {
    e.preventDefault()
    if (!onEnvoyer || !texte.trim() || enCours) return
    setEnCours(true)
    setErreur(null)
    try {
      await onEnvoyer(note, texte.trim())
      setEnvoye(true)
    } catch (err) {
      setErreur(err instanceof Error ? err.message : MESSAGE_HORS_LIGNE)
    } finally {
      setEnCours(false)
    }
  }

  return (
    <form onSubmit={envoyer} className="space-y-2 rounded-xl bg-fond p-3 text-left" aria-label="Message privé au restaurant" data-message-prive="formulaire">
      <label className="etiquette" htmlFor="avis-message-prive">
        {TITRE_MESSAGE_PRIVE}
      </label>
      <p className="text-sm text-gray-600">{TEXTE_MESSAGE_PRIVE}</p>
      <textarea id="avis-message-prive" className="champ min-h-24" maxLength={TEXTE_MAX} value={texte} onChange={(e) => setTexte(e.target.value)} />
      <MessageErreur>{erreur}</MessageErreur>
      <button type="submit" className="bouton w-full" disabled={!onEnvoyer || !texte.trim() || enCours}>
        {enCours ? 'Envoi…' : 'Envoyer au restaurant'}
      </button>
      {!onEnvoyer && <p className="text-sm text-gray-600">Aperçu : le client écrit ici depuis la page de jeu.</p>}
    </form>
  )
}

/**
 * Invitation à l'avis Google, toujours APRÈS le jeu et jamais en condition du lot.
 * Les étoiles ne sont pré-remplies que dans l'app : Google ne permet pas de pré-sélectionner une note.
 * Note basse (≤ SEUIL_NOTE_BASSE) : le message privé au restaurant est proposé d'abord, le lien Google reste juste en
 * dessous. Le clic vers Google est compté ANONYMEMENT (P2-Q3) : seulement depuis la page de jeu en mode serveur (pas
 * l'aperçu de #/avis ni la démo locale), et seul le type d'événement part — ni carte, ni contact, ni note.
 */
export function InvitationAvis({
  commerce,
  onMessagePrive,
  lienCarte,
}: {
  commerce: Pick<Commerce, 'lienGoogle'> & { id?: string }
  onMessagePrive?(note: number, texte: string): Promise<void>
  /** Après l'ouverture de Google (nouvel onglet) : lien de retour vers la carte du client. */
  lienCarte?: string
}) {
  const [note, setNote] = useState(NOTE_PAR_DEFAUT)
  const [ouvert, setOuvert] = useState(false)
  const lien = lienAvisGoogle(commerce)
  const prive = proposerMessagePrive(note)
  const { t } = useLangue()
  const { api } = useStore()
  const { page } = useRoute()
  function ouvrirGoogle() {
    setOuvert(true)
    if (page === 'jouer' && api && commerce.id) api.signalerEvenement(commerce.id, 'clicGoogle').catch(() => {})
  }
  return (
    <section className="carte space-y-3 text-center">
      <div>
        <p className="titre-carte">{t('Vous avez aimé votre passage ?')}</p>
        <p className="mt-1 text-sm text-gray-600">{t(TEXTE_INVITATION)}</p>
      </div>
      <SelecteurEtoiles note={note} onChange={setNote} />
      <p className="text-sm font-semibold text-amber-800" aria-live="polite">
        {note}/5 · {t(libelleNote(note))}
      </p>
      {prive && <MessagePriveRestaurant note={note} onEnvoyer={onMessagePrive} />}
      {prive && lien && <p className="text-sm text-gray-600">{TEXTE_GOOGLE_APRES_PRIVE}</p>}
      {lien ? (
        <a
          href={lien}
          target="_blank"
          rel="noopener noreferrer"
          className={`${prive ? 'bouton-secondaire' : 'bouton'} w-full`}
          onClick={ouvrirGoogle}
        >
          {t(libelleBoutonAvis(note))} ↗
        </a>
      ) : (
        <p className="text-sm text-gray-600">(Le commerce n’a pas encore renseigné son lien Google.)</p>
      )}
      <p className="text-sm text-gray-600">{t(ouvert ? TEXTE_CONFIRMATION_GOOGLE : 'Sur Google, vous confirmez vous-même vos étoiles avant de publier.')}</p>
      {ouvert && lienCarte && (
        <a href={lienCarte} className="lien block text-sm" data-retour-carte>
          {t('Avis publié ? Revenir à ma carte de fidélité')}
        </a>
      )}
      <p className="text-sm text-gray-600">{t('Le lot n’est pas conditionné à l’avis — gagnez d’abord, avis libre ensuite.')}</p>
    </section>
  )
}

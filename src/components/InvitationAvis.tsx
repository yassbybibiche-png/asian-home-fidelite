import { useState } from 'react'
import type { Commerce } from '../types'
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

/** 5 étoiles dorées, déjà remplies par défaut ; un tap sur une étoile ajuste la note (1 à 5). */
export function SelecteurEtoiles({ note, onChange }: { note: number; onChange(n: number): void }) {
  return (
    <div className="flex justify-center gap-1" role="radiogroup" aria-label="Votre note">
      {etoilesRemplies(note).map((remplie, i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={note === i + 1}
          aria-label={`${i + 1} étoile${i ? 's' : ''}`}
          onClick={() => onChange(choisirNote(i + 1))}
          className={`etoile ${remplie ? 'text-amber-400' : 'text-gray-300'}`}
        >
          <svg viewBox="0 0 24 24" className="h-9 w-9" aria-hidden>
            <path
              d="M12 2.8l2.83 5.73 6.32.92-4.57 4.46 1.08 6.3L12 17.24l-5.66 2.97 1.08-6.3-4.57-4.46 6.32-.92z"
              fill="currentColor"
              stroke={remplie ? '#d97706' : '#d1d5db'}
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
 * Invitation à l'avis Google, toujours APRÈS le jeu et jamais en condition du lot.
 * Les étoiles ne sont pré-remplies que dans l'app : Google ne permet pas de pré-sélectionner une note.
 */
export function InvitationAvis({ commerce }: { commerce: Pick<Commerce, 'lienGoogle'> }) {
  const [note, setNote] = useState(NOTE_PAR_DEFAUT)
  const [ouvert, setOuvert] = useState(false)
  const lien = lienAvisGoogle(commerce)
  return (
    <section className="carte space-y-3 text-center">
      <div>
        <p className="titre-carte">Vous avez aimé votre passage ?</p>
        <p className="mt-1 text-sm text-gray-600">{TEXTE_INVITATION}</p>
      </div>
      <SelecteurEtoiles note={note} onChange={setNote} />
      <p className="text-sm font-semibold text-amber-800" aria-live="polite">
        {note}/5 · {libelleNote(note)}
      </p>
      {lien ? (
        <a
          href={lien}
          target="_blank"
          rel="noopener noreferrer"
          className="bouton w-full"
          onClick={() => setOuvert(true)}
        >
          {libelleBoutonAvis(note)} ↗
        </a>
      ) : (
        <p className="text-sm text-gray-500">(Le commerce n’a pas encore renseigné son lien Google.)</p>
      )}
      <p className="text-xs text-gray-500">{ouvert ? TEXTE_CONFIRMATION_GOOGLE : 'Sur Google, vous confirmez vous-même vos étoiles avant de publier.'}</p>
      <p className="text-xs text-gray-500">Le lot n’est pas conditionné à l’avis — gagnez d’abord, avis libre ensuite.</p>
    </section>
  )
}

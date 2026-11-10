import { useEffect, useRef } from 'react'
import type { Recapitulatif } from '../lib/ecransCommercant'

/**
 * Modale de confirmation (P1-C6) : remplace la boîte de confirmation native du navigateur à la caisse. Élément `dialog` natif ouvert avec
 * showModal() : focus gardé dans la modale, Échap = Annuler. Récapitulatif lisible avant de valider.
 */
export function Confirmation({ recap, enCours, onConfirmer, onAnnuler }: { recap: Recapitulatif; enCours?: boolean; onConfirmer(): void; onAnnuler(): void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal?.()
    return () => d?.close?.()
  }, [])
  return (
    <dialog
      ref={ref}
      className="m-auto w-[min(92vw,26rem)] rounded-2xl bg-white p-0 shadow-xl backdrop:bg-black/50"
      aria-labelledby="confirmation-titre"
      onCancel={(e) => {
        e.preventDefault()
        onAnnuler()
      }}
    >
      <div className="space-y-4 p-5">
        <h2 id="confirmation-titre" className="font-titre text-xl font-bold">
          {recap.titre}
        </h2>
        <dl className="divide-y divide-gray-100 rounded-xl bg-gray-50 px-3 ring-1 ring-gray-200">
          {recap.lignes.map(([libelle, valeur]) => (
            <div key={libelle} className="flex justify-between gap-3 py-2 text-sm">
              <dt className="text-gray-600">{libelle}</dt>
              <dd className="text-right font-semibold tabular-nums">{valeur}</dd>
            </div>
          ))}
        </dl>
        {recap.avertissement && <p className="text-sm text-gray-600">{recap.avertissement}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="bouton-secondaire min-h-12" onClick={onAnnuler} disabled={enCours}>
            Annuler
          </button>
          <button type="button" className="bouton min-h-12 bg-green-700 hover:bg-green-800 active:bg-green-900" onClick={onConfirmer} disabled={enCours} autoFocus>
            {recap.confirmer}
          </button>
        </div>
      </div>
    </dialog>
  )
}

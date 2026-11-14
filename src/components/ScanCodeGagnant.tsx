import { useCallback, useState } from 'react'
import { ScannerQr } from './ScannerQr'
import { normaliserCodeGagnant } from '../lib/roulette'

/**
 * Scan du code gagnant en caisse (P1-4) : la caméra lit le QR affiché sous le code, sur le téléphone du client.
 * Module différé (hors bundle initial) : il ne se charge que quand la caisse appuie sur « Scanner le code ».
 * Un QR d'autre chose (carte du client, QR vitrine…) n'est pas un code : refus explicite dans le panneau, sans
 * appel serveur, avec un nouveau scan possible. La lecture valide est remise à l'appelant (`onCode`), qui la
 * vérifie auprès du serveur.
 */
export function ScanCodeGagnant({ onCode, onFermer, onSaisieManuelle }: { onCode(code: string): void; onFermer(): void; onSaisieManuelle(): void }) {
  const [erreur, setErreur] = useState<string | null>(null)
  // Chaque tentative remonte le scanner (la lecture s'arrête après un QR lu, même invalide).
  const [tentative, setTentative] = useState(0)

  // Mémorisé : le scanner redémarre sa caméra à chaque changement d'`onLu`, il ne doit pas bouger pendant le scan.
  const surLu = useCallback(
    (texte: string) => {
      const code = normaliserCodeGagnant(texte)
      if (!code) {
        setErreur('Ce QR n’est pas un code gagnant : visez le QR affiché sous le code, sur le téléphone du client.')
        return
      }
      setErreur(null)
      onCode(code)
    },
    [onCode],
  )

  if (erreur) {
    return (
      <div className="carte space-y-3">
        <h2 className="titre-carte">Scanner le code gagnant</h2>
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200" role="alert">
          {erreur}
        </p>
        <button type="button" className="bouton w-full" onClick={() => (setErreur(null), setTentative((n) => n + 1))}>
          📷 Scanner à nouveau
        </button>
        <button type="button" className="bouton-secondaire w-full" onClick={onSaisieManuelle}>
          ⌨ Saisir le code
        </button>
      </div>
    )
  }

  return (
    <ScannerQr
      key={tentative}
      titre="Scanner le code gagnant"
      instruction="Visez le QR affiché sous le code, sur le téléphone du client."
      libelleSaisieManuelle="⌨ Saisir le code"
      onLu={surLu}
      onFermer={onFermer}
      onSaisieManuelle={onSaisieManuelle}
    />
  )
}

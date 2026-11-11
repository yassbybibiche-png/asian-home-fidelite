import { useEffect, useRef, useState } from 'react'
import { creerLecteurQr, ErreurScanQr, MESSAGE_DECODEUR_INDISPONIBLE, type ConstructeurDetecteur, type LecteurQr } from '../lib/scanQr'

// Lecture d'un QR avec la caméra (getUserMedia). Décodage : `BarcodeDetector` du navigateur s'il existe (Chrome Android),
// sinon `jsqr` chargé à la demande (morceau séparé, jamais téléchargé si le navigateur sait déjà lire les QR).
// En cas de refus de la caméra ou d'échec, la saisie manuelle reste toujours possible (page Caisse).

export function ScannerQr({ onLu, onFermer, onSaisieManuelle }: { onLu(texte: string): void; onFermer(): void; onSaisieManuelle?(): void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [pret, setPret] = useState(false)

  useEffect(() => {
    let flux: MediaStream | null = null
    let fini = false
    let minuterie = 0
    const canvas = document.createElement('canvas')

    async function demarrer() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErreur('Caméra indisponible sur cet appareil ou ce navigateur (il faut une page en https). Utilisez la recherche manuelle.')
        return
      }
      try {
        flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      } catch {
        setErreur('Accès à la caméra refusé. Autorisez la caméra dans le navigateur, ou utilisez la recherche manuelle.')
        return
      }
      if (fini || !video.current) return flux.getTracks().forEach((t) => t.stop())
      video.current.srcObject = flux
      await video.current.play().catch(() => {})
      setPret(true)

      // Décodeur avec repli (src/lib/scanQr.ts) : natif → jsQR ; si rien n'est utilisable, ou si la lecture échoue sans
      // cesse, on coupe la caméra et on affiche l'erreur avec la saisie manuelle (plus de caméra ouverte sans lecture).
      const Natif = (globalThis as unknown as { BarcodeDetector?: ConstructeurDetecteur<HTMLVideoElement> }).BarcodeDetector
      let lecteur: LecteurQr
      try {
        lecteur = await creerLecteurQr<HTMLVideoElement>({
          Natif,
          chargerJsQr: async () => (await import('jsqr')).default,
          source: () => video.current!,
          image: () => {
            const v = video.current
            if (!v?.videoWidth) return null
            const l = Math.min(640, v.videoWidth)
            const h = Math.round((v.videoHeight / v.videoWidth) * l)
            canvas.width = l
            canvas.height = h
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!
            ctx.drawImage(v, 0, 0, l, h)
            return { donnees: ctx.getImageData(0, 0, l, h).data, largeur: l, hauteur: h }
          },
        })
      } catch (e) {
        return abandonner(e)
      }
      const boucle = async () => {
        if (fini) return
        try {
          const t = await lecteur.lire()
          if (t && !fini) {
            fini = true
            onLu(t)
            return
          }
        } catch (e) {
          return abandonner(e)
        }
        minuterie = window.setTimeout(boucle, 250)
      }
      void boucle()
    }

    function abandonner(e: unknown) {
      if (fini) return
      fini = true
      window.clearTimeout(minuterie)
      flux?.getTracks().forEach((t) => t.stop())
      setErreur(e instanceof ErreurScanQr ? e.message : MESSAGE_DECODEUR_INDISPONIBLE)
    }
    void demarrer()
    return () => {
      fini = true
      window.clearTimeout(minuterie)
      flux?.getTracks().forEach((t) => t.stop())
    }
  }, [onLu])

  return (
    <div className="carte space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="titre-carte">Scanner la carte du client</h2>
        <button type="button" className="min-h-11 px-2 font-semibold text-gray-700 underline" onClick={onFermer}>
          Fermer
        </button>
      </div>
      {erreur ? (
        <>
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200" role="alert">
            {erreur}
          </p>
          {/* Caméra refusée / indisponible : la saisie manuelle est proposée ici même, pas seulement après « Fermer ». */}
          {onSaisieManuelle && (
            <button type="button" className="bouton w-full" onClick={onSaisieManuelle}>
              ⌨ Saisir le prénom
            </button>
          )}
        </>
      ) : (
        <>
          <video ref={video} className="aspect-square w-full rounded-2xl bg-gray-900 object-cover" muted playsInline aria-label="Image de la caméra" />
          <p className="text-sm text-gray-600" role="status">
            {pret ? 'Visez le QR code de la carte du client.' : 'Ouverture de la caméra…'}
          </p>
        </>
      )}
    </div>
  )
}

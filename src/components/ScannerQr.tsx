import { useEffect, useRef, useState } from 'react'

// Lecture d'un QR avec la caméra (getUserMedia). Décodage : `BarcodeDetector` du navigateur s'il existe (Chrome Android),
// sinon `jsqr` chargé à la demande (morceau séparé, jamais téléchargé si le navigateur sait déjà lire les QR).
// En cas de refus de la caméra ou d'échec, la saisie manuelle reste toujours possible (page Caisse).

interface Detecteur {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}
type ConstructeurDetecteur = new (o: { formats: string[] }) => Detecteur

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

      const Natif = (globalThis as unknown as { BarcodeDetector?: ConstructeurDetecteur }).BarcodeDetector
      let lire: () => Promise<string | null>
      if (Natif) {
        const d = new Natif({ formats: ['qr_code'] })
        lire = async () => (await d.detect(video.current!))[0]?.rawValue ?? null
      } else {
        const jsQR = (await import('jsqr')).default
        lire = async () => {
          const v = video.current!
          if (!v.videoWidth) return null
          const l = Math.min(640, v.videoWidth)
          const h = Math.round((v.videoHeight / v.videoWidth) * l)
          canvas.width = l
          canvas.height = h
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!
          ctx.drawImage(v, 0, 0, l, h)
          return jsQR(ctx.getImageData(0, 0, l, h).data, l, h)?.data ?? null
        }
      }
      const boucle = async () => {
        if (fini) return
        try {
          const t = await lire()
          if (t && !fini) {
            fini = true
            onLu(t)
            return
          }
        } catch {
          // image illisible : on réessaie
        }
        minuterie = window.setTimeout(boucle, 250)
      }
      void boucle()
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

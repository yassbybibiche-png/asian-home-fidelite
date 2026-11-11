// QR code dessiné en SVG, généré localement (aucun appel réseau).
// Module à part (boucle t1) : `qrcode-generator` (~21 Ko minifiés) ne doit pas peser sur le bundle
// initial — `CarteFidelite` le charge en différé (`React.lazy`), les pages différées (Equipe,
// MenuCarte, FicheClient, QrVitrine, Roulette) l'importent directement. Le rendu est identique
// (même SVG, mêmes props) ; pendant le chargement du fichier, `CarteFidelite` affiche un
// carré blanc de même taille pour éviter tout saut de mise en page.
import { useMemo } from 'react'
import qrcode from 'qrcode-generator'
import { THEME } from '../theme.ts'

export function QrCode({ texte, className = 'h-48 w-48', titre }: { texte: string; className?: string; titre?: string }) {
  const { d, taille } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(texte)
    qr.make()
    const n = qr.getModuleCount()
    let chemin = ''
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) chemin += `M${x + 4} ${y + 4}h1v1h-1z`
    // Marge blanche de 4 modules autour (zone de silence exigée par la norme QR).
    return { d: chemin, taille: n + 8 }
  }, [texte])
  return (
    <svg viewBox={`0 0 ${taille} ${taille}`} className={`${className} bg-white`} role="img" aria-label={titre ?? 'QR code'} shapeRendering="crispEdges">
      <path d={d} fill={THEME.texteFonce} />
    </svg>
  )
}

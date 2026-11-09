import type { Lot } from '../types'
import { secteurs } from '../lib/roulette'

const COULEURS = ['#ff5a00', '#ffc49e', '#1f2937', '#fff4ed', '#e64f00', '#fde68a']
const TEXTE_CLAIR = new Set(['#ff5a00', '#1f2937', '#e64f00'])
export const DUREE_ROTATION_MS = 4500

/** Point sur le cercle ; angle en degrés, 0 = en haut, sens horaire. */
function point(angle: number, r: number): string {
  const rad = (angle * Math.PI) / 180
  return `${(r * Math.sin(rad)).toFixed(2)} ${(-r * Math.cos(rad)).toFixed(2)}`
}

function abreger(texte: string, max = 17): string {
  return texte.length > max ? `${texte.slice(0, max - 1)}…` : texte
}

/** Roue en SVG : la taille de chaque secteur est proportionnelle à la chance du lot. */
export function Roue({ lots, rotation }: { lots: Lot[]; rotation: number }) {
  const parts = secteurs(lots)
  const R = 96
  return (
    <div className="relative mx-auto aspect-square w-full max-w-80">
      {/* Pointeur fixe en haut */}
      <div className="absolute top-0 left-1/2 z-10 -translate-x-1/2 -translate-y-1" aria-hidden>
        <div className="h-0 w-0 border-x-[14px] border-t-[26px] border-x-transparent border-t-gray-900 drop-shadow" />
      </div>
      <div
        className="h-full w-full rounded-full shadow-lg ring-4 ring-white"
        style={{ transform: `rotate(${rotation}deg)`, transition: `transform ${DUREE_ROTATION_MS}ms cubic-bezier(0.15, 0.85, 0.2, 1)` }}
      >
        <svg viewBox="-100 -100 200 200" className="h-full w-full" aria-hidden>
          {parts.map((s, i) => {
            const couleur = COULEURS[i % COULEURS.length]
            const etendue = s.fin - s.debut
            const milieu = s.debut + etendue / 2
            const forme =
              etendue >= 359.99 ? (
                <circle r={R} fill={couleur} />
              ) : (
                <path d={`M0 0 L${point(s.debut, R)} A${R} ${R} 0 ${etendue > 180 ? 1 : 0} 1 ${point(s.fin, R)} Z`} fill={couleur} stroke="#fff" strokeWidth={1} />
              )
            return (
              <g key={i}>
                {forme}
                {etendue >= 12 && (
                  <text
                    transform={`rotate(${milieu}) translate(0 -54) rotate(-90)`}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={etendue < 30 ? 6.5 : 8}
                    fontWeight={700}
                    fill={TEXTE_CLAIR.has(couleur) ? '#fff' : '#1f2937'}
                  >
                    {abreger(s.lot.libelle)}
                  </text>
                )}
              </g>
            )
          })}
          <circle r={13} fill="#fff" stroke="#e5e7eb" strokeWidth={2} />
          <circle r={5} fill="#ff5a00" />
        </svg>
      </div>
    </div>
  )
}

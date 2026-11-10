import { secteurs, type LotRoue } from '../lib/roulette'

// Palette laque / encre / ivoire / or ; texte choisi pour un contraste ≥ 4,5:1 sur chaque secteur.
const COULEURS = ['#b3262d', '#fbf3e4', '#1f2937', '#f2d48a', '#7f1a1f', '#fdf3f2']
const TEXTE_CLAIR = new Set(['#b3262d', '#1f2937', '#7f1a1f'])
export const DUREE_ROTATION_MS = 4500

/** Point sur le cercle ; angle en degrés, 0 = en haut, sens horaire. */
function point(angle: number, r: number): string {
  const rad = (angle * Math.PI) / 180
  return `${(r * Math.sin(rad)).toFixed(2)} ${(-r * Math.cos(rad)).toFixed(2)}`
}

function abreger(texte: string, max = 17): string {
  return texte.length > max ? `${texte.slice(0, max - 1)}…` : texte
}

/**
 * Roue en SVG : secteurs proportionnels aux chances quand elles sont connues (aperçu commerçant, démo locale) ;
 * égaux sur la page publique, qui ne reçoit que les libellés (le tirage est fait par le serveur).
 */
export function Roue({ lots, rotation }: { lots: LotRoue[]; rotation: number }) {
  const parts = secteurs(lots)
  const R = 88
  // Une couleur jamais identique à sa voisine, même quand le dernier secteur rejoint le premier.
  const couleur = (i: number) => (parts.length > 1 && i === parts.length - 1 && i % COULEURS.length === 0 ? COULEURS[2] : COULEURS[i % COULEURS.length])
  return (
    <div className="relative mx-auto aspect-square w-full max-w-80">
      {/* Pointeur fixe en haut */}
      <div className="absolute top-0 left-1/2 z-10 -translate-x-1/2 -translate-y-2 drop-shadow-md" aria-hidden>
        <svg viewBox="0 0 32 40" className="h-10 w-8">
          <path d="M16 39 L3 12 A14 14 0 1 1 29 12 Z" fill="#1f2937" stroke="#f2d48a" strokeWidth={2} />
          <circle cx={16} cy={13} r={4.5} fill="#f2d48a" />
        </svg>
      </div>
      {/* Anneau laqué fixe avec ses perles dorées. */}
      <svg viewBox="-100 -100 200 200" className="h-full w-full rounded-full shadow-relief" aria-hidden>
        <defs>
          <radialGradient id="roue-anneau" cx="0" cy="0" r="100" gradientUnits="userSpaceOnUse">
            <stop offset="0.86" stopColor="#7f1a1f" />
            <stop offset="1" stopColor="#5e1317" />
          </radialGradient>
        </defs>
        <circle r={99} fill="url(#roue-anneau)" />
        {Array.from({ length: 16 }, (_, i) => {
          const [x, y] = point(i * 22.5, 93.5).split(' ')
          return <circle key={i} cx={x} cy={y} r={2.2} fill={i % 2 ? '#f2d48a' : '#fff7e0'} />
        })}
      </svg>
      {/* Secteurs : seule cette couche tourne. */}
      <div
        className="absolute inset-0"
        style={{ transform: `rotate(${rotation}deg)`, transition: `transform ${DUREE_ROTATION_MS}ms cubic-bezier(0.15, 0.85, 0.2, 1)` }}
      >
        <svg viewBox="-100 -100 200 200" className="h-full w-full" aria-hidden>
          <g>
            {parts.map((s, i) => {
              const c = couleur(i)
              const etendue = s.fin - s.debut
              const milieu = s.debut + etendue / 2
              const forme =
                etendue >= 359.99 ? (
                  <circle r={R} fill={c} />
                ) : (
                  <path d={`M0 0 L${point(s.debut, R)} A${R} ${R} 0 ${etendue > 180 ? 1 : 0} 1 ${point(s.fin, R)} Z`} fill={c} stroke="#d4a73c" strokeWidth={0.8} />
                )
              return (
                <g key={i}>
                  {forme}
                  {etendue >= 12 && (
                    <text
                      transform={`rotate(${milieu}) translate(0 -52) rotate(-90)`}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={etendue < 30 ? 6.5 : 7.8}
                      fontWeight={700}
                      letterSpacing={0.2}
                      fill={TEXTE_CLAIR.has(c) ? '#fff' : '#1f2937'}
                    >
                      {abreger(s.lot.libelle)}
                    </text>
                  )}
                </g>
              )
            })}
            <circle r={R} fill="none" stroke="#d4a73c" strokeWidth={1.6} />
          </g>
        </svg>
      </div>
      {/* Moyeu doré fixe. */}
      <svg viewBox="-100 -100 200 200" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <radialGradient id="roue-moyeu" cx="-4" cy="-4" r="18" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#fff7e0" />
            <stop offset="1" stopColor="#d4a73c" />
          </radialGradient>
        </defs>
        <circle r={15} fill="url(#roue-moyeu)" stroke="#fff" strokeWidth={2} />
        <circle r={5.5} fill="#b3262d" />
      </svg>
    </div>
  )
}

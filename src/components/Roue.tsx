import { useEffect, useState } from 'react'
import { LONGUEUR_TEXTE_MAX, POLICE_ROUE, RAYON_LIBELLE, largeurEstimee, secteursAffiches } from '../lib/roue'
import type { LotRoue } from '../lib/roulette'
import { prefereMouvementReduit, REQUETE_MOUVEMENT_REDUIT, transitionRoue } from '../lib/animationRoue'

/** Réglage « réduire les animations » du téléphone, suivi en direct. */
export function useMouvementReduit(): boolean {
  const [reduit, setReduit] = useState(() => prefereMouvementReduit(typeof window === 'undefined' ? undefined : window))
  useEffect(() => {
    const requete = window.matchMedia?.(REQUETE_MOUVEMENT_REDUIT)
    if (!requete) return
    const suivre = () => setReduit(requete.matches)
    requete.addEventListener?.('change', suivre)
    return () => requete.removeEventListener?.('change', suivre)
  }, [])
  return reduit
}

/** Point sur le cercle ; angle en degrés, 0 = en haut, sens horaire. */
function point(angle: number, r: number): string {
  const rad = (angle * Math.PI) / 180
  return `${(r * Math.sin(rad)).toFixed(2)} ${(-r * Math.cos(rad)).toFixed(2)}`
}

/**
 * Roue en SVG : secteurs proportionnels aux chances quand elles sont connues (aperçu commerçant, démo locale) ;
 * égaux sur la page publique, qui ne reçoit que les libellés (le tirage est fait par le serveur).
 * Libellés ≤ 12 caractères en police ≥ 14 px ; secteur < 30° : numéro de légende ; < 12° : rien (voir LegendeRoue).
 */
export function Roue({ lots, rotation }: { lots: LotRoue[]; rotation: number }) {
  const parts = secteursAffiches(lots)
  const R = 88
  const reduit = useMouvementReduit()
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
      {/* Secteurs : seule cette couche tourne (transform seul, couche composée : 60 fps sans repeindre le SVG). */}
      <div className="absolute inset-0 will-change-transform" style={{ transform: `rotate(${rotation}deg)`, transition: transitionRoue(reduit) }}>
        <svg viewBox="-100 -100 200 200" className="h-full w-full" aria-hidden>
          <g>
            {parts.map((s) => {
              const etendue = s.fin - s.debut
              const milieu = s.debut + etendue / 2
              const forme =
                etendue >= 359.99 ? (
                  <circle r={R} fill={s.couleur} />
                ) : (
                  <path d={`M0 0 L${point(s.debut, R)} A${R} ${R} 0 ${etendue > 180 ? 1 : 0} 1 ${point(s.fin, R)} Z`} fill={s.couleur} stroke="#d4a73c" strokeWidth={0.8} />
                )
              // Garde-fou : un libellé large (majuscules…) est resserré plutôt que de déborder du secteur.
              const serre = s.affichage === 'libelle' && largeurEstimee(s.texteRoue) > LONGUEUR_TEXTE_MAX
              return (
                <g key={s.numero}>
                  {forme}
                  {s.affichage !== 'aucun' && (
                    <text
                      transform={s.affichage === 'libelle' ? `rotate(${milieu}) translate(0 -${RAYON_LIBELLE}) rotate(-90)` : `rotate(${milieu}) translate(0 -72)`}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={POLICE_ROUE}
                      fontWeight={700}
                      letterSpacing={0.2}
                      fill={s.couleurTexte}
                      {...(serre ? { textLength: LONGUEUR_TEXTE_MAX, lengthAdjust: 'spacingAndGlyphs' } : {})}
                    >
                      {s.texteRoue}
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

/**
 * Légende sous la roue : tous les lots, libellé complet, pastille à la couleur (et au numéro) du secteur.
 * C'est la version lisible par les lecteurs d'écran : la roue elle-même est décorative (aria-hidden).
 */
export function LegendeRoue({ lots }: { lots: LotRoue[] }) {
  const parts = secteursAffiches(lots)
  return (
    <div className="mt-4 px-2">
      <h2 className="text-center text-base font-semibold text-or-300">À gagner</h2>
      <ol className="mt-2 grid gap-2 text-base text-white" aria-label="Lots de la roue">
        {parts.map((s) => (
          <li key={s.numero} className="flex items-center gap-3" data-legende-lot>
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ring-1 ring-or-400/60"
              style={{ backgroundColor: s.couleur, color: s.couleurTexte }}
              aria-hidden
            >
              {s.numero}
            </span>
            <span className="min-w-0 break-words">{s.libelle}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

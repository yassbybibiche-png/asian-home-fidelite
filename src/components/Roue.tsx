import { createContext, useContext, useEffect, useRef, useState, type CSSProperties } from 'react'
import { colorerSecteurs, LONGUEUR_TEXTE_MAX, POLICE_ROUE, RAYON_LIBELLE, largeurEstimee, secteursAffiches, styleLegende, teintesRoue } from '../lib/roue'
import type { LotRoue } from '../lib/roulette'
import type { SceneRoue } from '../lib/animationRoue'
// Pas animationRoue (→ roulette, theme) : la roue est aussi importée par Réglages (aperçu R6), voir mouvementRoue.ts.
import { dureeRotation, prefereMouvementReduit, REQUETE_MOUVEMENT_REDUIT, transitionRoue } from '../lib/mouvementRoue'
import { useLangue } from './Langue'
import { THEME } from '../theme.ts'
import type { TypeLot } from '../types'

/**
 * Habillage de la roue fourni par la page de jeu (R5/R8) — un contexte plutôt que des props : la roue et sa légende
 * prennent la couleur du commerce ensemble. Hors contexte : magenta du thème, moyeu sans initiale, aucun son.
 */
export interface DecorRoue {
  /** `apparence.couleur` du commerce (ignorée si illisible : `accentRoue`). */
  couleur?: string
  /** Logo (adresse d'image) au centre, sinon `initiale`. */
  logo?: string
  initiale?: string
  /** Scène sonore ouverte par le clic « Tourner » (`ouvrirScene`) ; tics et inclinaison du pointeur en dépendent. */
  scene?: { current: Promise<SceneRoue | null> | null }
  /** Résultat affiché : rayons derrière la roue (pleins pour un lot, allégés pour des points). */
  fete?: TypeLot
}

export const ContexteRoue = createContext<DecorRoue>({})

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
  const decor = useContext(ContexteRoue)
  const parts = colorerSecteurs(secteursAffiches(lots), decor.couleur)
  const R = 88
  const reduit = useMouvementReduit()
  const { t } = useLangue()
  const pointeur = useRef<HTMLDivElement>(null)
  const avant = useRef(rotation)
  // Poursuite lumineuse pendant la rotation, puis rebond du pointeur à l'arrêt (classes CSS, couches fixes).
  const [phase, setPhase] = useState('')
  useEffect(() => {
    const de = avant.current
    avant.current = rotation
    // Mouvement réduit activé pendant la rotation : le nettoyage ci-dessous a annulé tics et inclinaisons du pointeur.
    if (rotation === de) return setPhase('')
    const duree = dureeRotation(reduit)
    const debut = Date.now()
    let annuler: (() => void) | undefined | false
    // Tics (son + inclinaison du pointeur) calculés depuis l'angle animé ; mouvement réduit : durée nulle, aucun tic.
    void decor.scene?.current?.then((s) => annuler !== false && (annuler = s?.planifier(de, rotation, parts.map((p) => p.debut), duree, pointeur.current, Date.now() - debut)))
    // Mouvement réduit : rien ne tourne, donc ni poursuite ni rebond.
    if (duree) setPhase('roue-tourne')
    const fin = setTimeout(() => duree && setPhase('roue-arret'), duree)
    return () => {
      if (annuler) annuler()
      annuler = false
      clearTimeout(fin)
    }
  }, [rotation, reduit])
  const filets = parts.length > 1 ? parts.map((s) => `M0 0L${point(s.debut, R)}`).join('') : ''
  // Lecteur d'écran : la roue est une image nommée (nombre de lots) ; le détail des lots est dans LegendeRoue.
  return (
    <div
      className={`roue relative isolate mx-auto aspect-square w-full max-w-80 ${phase}`}
      style={teintesRoue(decor.couleur) as CSSProperties}
      data-fete={decor.fete}
      role="img" aria-label={t('Roue de la chance : {n} lots à gagner, détaillés ci-dessous', { n: parts.length })}
      data-roue
    >
      {/* Décor fixe en CSS (index.css, « roue premium ») : halo et rayons du gain, anneau en relief, 16 ampoules. */}
      <div className="roue-halo" />
      <div className="roue-anneau" />
      {Array.from({ length: 16 }, (_, i) => (
        <span key={i} className="roue-perle" style={{ '--i': i } as CSSProperties} />
      ))}
      {/* Pointeur fixe en haut (goutte dessinée en CSS, aux teintes de la roue) ; il bute à chaque secteur franchi et
          rebondit à l'arrêt. */}
      <div ref={pointeur} className="roue-pointeur" />
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
                  <path d={`M0 0 L${point(s.debut, R)} A${R} ${R} 0 ${etendue > 180 ? 1 : 0} 1 ${point(s.fin, R)} Z`} fill={s.couleur} />
                )
              // Garde-fou : un libellé large (majuscules…) est resserré plutôt que de déborder du secteur.
              // Moitié gauche (R-t1) : libellé retourné sur l'axe du secteur (+90° au lieu de −90°), lisible au repos.
              const serre = s.affichage === 'libelle' && largeurEstimee(s.texteRoue) > LONGUEUR_TEXTE_MAX
              return (
                <g key={s.numero}>
                  {forme}
                  {s.affichage !== 'aucun' && (
                    <text
                      transform={s.affichage === 'libelle' ? `rotate(${milieu}) translate(0 -${RAYON_LIBELLE}) rotate(${milieu > 180 ? 90 : -90})` : `rotate(${milieu}) translate(0 -72)`}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={POLICE_ROUE}
                      fontWeight={800}
                      letterSpacing={0.2}
                      fill={s.couleurTexte}
                      // Liseré de la teinte opposée (index.css) : le libellé se détache du secteur et du reflet.
                      className={s.couleurTexte === THEME.blanc ? undefined : 'roue-texte-fonce'}
                      {...(serre ? { textLength: LONGUEUR_TEXTE_MAX, lengthAdjust: 'spacingAndGlyphs' } : {})}
                    >
                      {s.texteRoue}
                    </text>
                  )}
                </g>
              )
            })}
            {/* Filets nets du moyeu au bord : trait sombre puis trait clair ; liseré clair du bord. */}
            <path d={filets} className="roue-filet" />
            <path d={filets} className="roue-filet roue-filet-clair" />
            <circle r={R} className="roue-filet roue-bord" />
          </g>
        </svg>
      </div>
      {/* Couche fixe du dessus (CSS) : brillant bombé des secteurs, ombre interne du moyeu et du bord, reflet de verre. */}
      <div className="roue-verre" />
      {/* Moyeu fixe : anneau dégradé et reflet (CSS), logo du commerce ou son initiale. */}
      <div className="roue-moyeu">
        {decor.logo ? <img src={decor.logo} alt="" /> : <span className="font-titre">{decor.initiale}</span>}
      </div>
    </div>
  )
}

/**
 * Légende sous la roue : tous les lots, libellé complet, pastille à la couleur (et au numéro) du secteur.
 * C'est la version lisible par les lecteurs d'écran : la roue elle-même est décorative (aria-hidden).
 */
export function LegendeRoue({ lots }: { lots: LotRoue[] }) {
  const parts = colorerSecteurs(secteursAffiches(lots), useContext(ContexteRoue).couleur)
  const { t } = useLangue()
  // Teintes de la roue aussi sur la légende (R-t1) : titre, anneau des pastilles et, en CSS, cadre du jeu
  // (mise en forme dans index.css, « [data-roue] + div »).
  return (
    <div style={styleLegende(useContext(ContexteRoue).couleur)}>
      <h2>{t('À gagner')}</h2>
      <ol className="mt-2 grid gap-2 text-base text-white" aria-label={t('Lots de la roue')}>
        {parts.map((s) => (
          <li key={s.numero} className="flex items-center gap-3" data-legende-lot>
            <span
              className="pastille-roue"
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

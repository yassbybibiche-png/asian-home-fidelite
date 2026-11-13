// Rail « En photos » du menu (Expérience 10/10, lot 2, mode Découverte) : défilement automatique lent, en
// aller-retour, par le défilement natif du rail (aucune copie des cartes : chaque plat reste une seule fois dans
// l'ordre de lecture, aucun élément dupliqué pour les lecteurs d'écran). Pause au toucher, au survol, au focus
// clavier et quand l'onglet est caché ; jamais lancé si l'appareil demande un mouvement réduit.

/** Vitesse en pixels par seconde : lente, on peut lire les noms des plats. */
export const VITESSE_RAIL = 24
/** Reprise après une interaction (toucher, survol, focus). */
export const REPRISE_RAIL_MS = 3500

export interface EtatRail {
  /** Position flottante (le navigateur arrondit `scrollLeft`). */
  position: number
  sens: 1 | -1
}

/**
 * Pas suivant : avance de `vitesse × dt`, rebondit aux extrémités. `actuel` = `scrollLeft` lu : si le client a fait
 * défiler le rail à la main, on repart de là où il l'a laissé.
 */
export function pasRail(e: EtatRail, actuel: number, max: number, dtMs: number, vitesse = VITESSE_RAIL): EtatRail {
  if (max <= 0) return { position: 0, sens: 1 }
  let position = Math.abs(actuel - e.position) > 2 ? actuel : e.position
  let sens = e.sens
  position += (sens * vitesse * Math.min(dtMs, 100)) / 1000
  if (position >= max) [position, sens] = [max, -1]
  else if (position <= 0) [position, sens] = [0, 1]
  return { position, sens }
}

/** Lance le défilement automatique du rail ; renvoie l'arrêt. Mouvement réduit : ne fait rien. */
export function defilerRail(el: HTMLElement, mouvementReduit: boolean): () => void {
  if (mouvementReduit || typeof requestAnimationFrame === 'undefined') return () => {}
  let etat: EtatRail = { position: el.scrollLeft, sens: 1 }
  let pauseJusqua = 0
  let enPause = false
  let avant = 0
  let image = 0
  const boucle = (t: number) => {
    const dt = avant ? t - avant : 0
    avant = t
    if (!enPause && t >= pauseJusqua && document.visibilityState === 'visible') {
      etat = pasRail(etat, el.scrollLeft, el.scrollWidth - el.clientWidth, dt)
      el.scrollLeft = etat.position
    } else etat = { ...etat, position: el.scrollLeft }
    image = requestAnimationFrame(boucle)
  }
  const pause = () => (enPause = true)
  const reprise = () => ((enPause = false), (pauseJusqua = performance.now() + REPRISE_RAIL_MS))
  const evenements: [string, () => void][] = [
    ['pointerenter', pause],
    ['pointerdown', pause],
    ['focusin', pause],
    ['pointerleave', reprise],
    ['pointerup', reprise],
    ['pointercancel', reprise],
    ['focusout', reprise],
  ]
  for (const [type, f] of evenements) el.addEventListener(type, f)
  image = requestAnimationFrame(boucle)
  return () => {
    cancelAnimationFrame(image)
    for (const [type, f] of evenements) el.removeEventListener(type, f)
  }
}

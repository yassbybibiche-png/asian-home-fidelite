// Rail « En photos » vivant (boucle animations, cycle 4, menu Découverte) : la tuile la plus proche du centre du rail
// devient le point focal — son contenu grandit légèrement et sa photo s'éclaire ; les autres s'atténuent en s'éloignant.
// Importé UNIQUEMENT par la page différée MenuPublic (hors bundle initial). Transform / filter seulement, posés sur des
// éléments INTERNES des tuiles (le bouton garde son `active:scale` tactile) ; ne touche jamais à `scrollLeft` : c'est
// `defilerRail` qui conduit. Rien du tout si l'appareil demande un mouvement réduit.

/** Hausse d'échelle du contenu de la tuile au centre (1 → 1,05). */
export const AMPLITUDE_ECHELLE = 0.05
/** Luminosité de la photo d'une tuile loin du centre (le centre est à 1). */
export const LUMINOSITE_REPOS = 0.82
/** Portée de l'effet, en largeurs de tuile : au-delà d'une tuile et demie du centre, la tuile est au repos. */
export const PORTEE_TUILES = 1.5

/**
 * Facteur de mise au point 0..1 d'une tuile dont le centre est à `distanceCentre` px du centre du rail ;
 * `demiLargeur` = demi-largeur d'une tuile. 1 au centre, 0 au-delà d'une tuile et demie, courbe en cosinus
 * (dérivée nulle aux deux bornes : ni à-coup au centre, ni cassure à l'entrée de la zone).
 */
export function miseAuPointRail(distanceCentre: number, demiLargeur: number): number {
  const portee = 2 * demiLargeur * PORTEE_TUILES
  if (!(portee > 0)) return 0
  const d = Math.abs(distanceCentre)
  if (!(d < portee)) return 0
  return (1 + Math.cos((Math.PI * d) / portee)) / 2
}

/** Échelle du contenu de la tuile : 1 au repos, 1,05 au centre. */
export const echelleTuile = (facteur: number) => 1 + AMPLITUDE_ECHELLE * facteur

/** Luminosité de la photo : 0,82 au repos, 1 au centre. */
export const luminositePhoto = (facteur: number) => LUMINOSITE_REPOS + (1 - LUMINOSITE_REPOS) * facteur

/** Facteur arrondi au centième : on n'écrit dans le style que si cette valeur change. */
export const arrondiFacteur = (facteur: number) => Math.round(facteur * 100) / 100

/**
 * Anime les `[data-rail-vivant]` (conteneur interne de chaque tuile) du `rail` : à chaque image où la position du rail
 * ou sa largeur a changé, échelle sur le conteneur et luminosité sur son image. Boucle active seulement quand le rail
 * est à l'écran (IntersectionObserver). Renvoie l'arrêt : image annulée, observateur coupé, styles effacés.
 */
export function animerRailVivant(rail: HTMLElement, mouvementReduit: boolean): () => void {
  if (mouvementReduit || typeof requestAnimationFrame === 'undefined') return () => {}
  const poses = new Map<HTMLElement, number>()
  let image = 0
  let derniere = ''
  const appliquer = () => {
    image = requestAnimationFrame(appliquer)
    const cle = `${rail.scrollLeft}|${rail.clientWidth}|${rail.childElementCount}`
    if (cle === derniere) return
    derniere = cle
    const r = rail.getBoundingClientRect()
    const centre = r.left + r.width / 2
    rail.querySelectorAll<HTMLElement>('[data-rail-vivant]').forEach((e) => {
      // Rect du bouton (jamais transformé par le pilote), pas du conteneur mis à l'échelle.
      const t = (e.parentElement ?? e).getBoundingClientRect()
      const f = arrondiFacteur(miseAuPointRail(t.left + t.width / 2 - centre, t.width / 2))
      if (poses.get(e) === f) return
      poses.set(e, f)
      e.style.transform = `scale(${echelleTuile(f).toFixed(4)})`
      const img = e.querySelector('img')
      if (img) img.style.filter = `brightness(${luminositePhoto(f).toFixed(4)})`
    })
  }
  const lancer = () => {
    if (image) return
    derniere = ''
    image = requestAnimationFrame(appliquer)
  }
  const arreter = () => {
    if (image) cancelAnimationFrame(image)
    image = 0
  }
  let obs: IntersectionObserver | undefined
  if (typeof IntersectionObserver === 'undefined') lancer()
  else {
    obs = new IntersectionObserver((entrees) => (entrees[entrees.length - 1].isIntersecting ? lancer() : arreter()))
    obs.observe(rail)
  }
  return () => {
    arreter()
    obs?.disconnect()
    poses.forEach((_, e) => {
      e.style.transform = ''
      const img = e.querySelector('img')
      if (img) img.style.filter = ''
    })
  }
}

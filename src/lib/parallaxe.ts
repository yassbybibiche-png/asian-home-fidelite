// Parallaxe léger des surfaces Découverte (#/bienvenue, #/menu) — Expérience cycle 3, lot 1.
// Importé UNIQUEMENT par les pages différées Bienvenue et MenuPublic (hors bundle initial). Transform seulement
// (aucune mise en page touchée → CLS nul) ; rien du tout si l'appareil demande un mouvement réduit.

export const FORCE_PARALLAXE = 0.12
/** Déplacement maximal (px) : les cadres prévoient au moins cette marge de chaque côté (jamais de bord visible). */
export const MAX_PARALLAXE = 28

/**
 * Translation verticale (px) d'une image dont le cadre est centré en `centreElement`, la vue en `centreVue` : l'image
 * prend du retard sur le défilement (vers le bas quand le cadre est au-dessus du centre), bornée à ±`max`.
 */
export function deplacementParallaxe(centreElement: number, centreVue: number, force: number, max: number): number {
  const d = Math.max(-max, Math.min(max, (centreVue - centreElement) * force))
  return Math.round(d * 10) / 10 || 0
}

/**
 * Anime les `[data-parallaxe]` de `racine` (force optionnelle : `data-parallaxe-force`) au défilement : écouteur passif,
 * au plus un calcul par image (rAF). La position est lue sur le cadre (parent), jamais sur l'élément déplacé. Renvoie
 * le nettoyage : écouteurs retirés, image en attente annulée, transforms effacés.
 */
export function activerParallaxe(racine: ParentNode, mouvementReduit: boolean): () => void {
  if (mouvementReduit || typeof window === 'undefined' || typeof requestAnimationFrame === 'undefined') return () => {}
  const touches = new Set<HTMLElement>()
  let image = 0
  const appliquer = () => {
    image = 0
    const hauteur = window.innerHeight
    racine.querySelectorAll<HTMLElement>('[data-parallaxe]').forEach((e) => {
      const r = (e.parentElement ?? e).getBoundingClientRect()
      if (r.bottom < 0 || r.top > hauteur) return
      const force = Number(e.dataset.parallaxeForce) || FORCE_PARALLAXE
      e.style.transform = `translateY(${deplacementParallaxe(r.top + r.height / 2, hauteur / 2, force, MAX_PARALLAXE)}px)`
      touches.add(e)
    })
  }
  const planifier = () => {
    if (!image) image = requestAnimationFrame(appliquer)
  }
  window.addEventListener('scroll', planifier, { passive: true })
  window.addEventListener('resize', planifier, { passive: true })
  planifier()
  return () => {
    window.removeEventListener('scroll', planifier)
    window.removeEventListener('resize', planifier)
    if (image) cancelAnimationFrame(image)
    touches.forEach((e) => (e.style.transform = ''))
  }
}

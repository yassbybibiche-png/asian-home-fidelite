// Révélations au défilement (Expérience 10/10, lot 2) : mécanisme partagé par le menu (#/menu, mode Découverte) et
// l'accueil (#/bienvenue). Classes CSS dans src/index.css (`.revelation-attente`, `.revelation-faite`).
// Principe : le contenu est TOUJOURS présent et visible par défaut (sans JS, sans IntersectionObserver, mouvement
// réduit) ; seuls les éléments encore SOUS l'écran au moment de la mise en place sont masqués puis révélés à leur
// entrée (opacité + légère translation, aucune dimension modifiée → aucun décalage de mise en page). Un élément déjà
// à l'écran n'est jamais masqué (pas de clignotement au chargement).
import { prefereMouvementReduit } from './menuClient.ts'

/** Attribut posé sur chaque élément à révéler. */
export const ATTRIBUT_REVELATION = 'data-revelation'

export interface DependancesRevelation {
  /** Absent = navigateur sans IntersectionObserver : rien n'est masqué. */
  Observateur?: typeof IntersectionObserver
  mouvementReduit: boolean
  /** Hauteur de la fenêtre (px) : un élément dont le haut est au-dessus est « déjà à l'écran ». */
  hauteurVue: number
}

/**
 * Prépare les éléments marqués `data-revelation` sous `racine` et renvoie la fonction de nettoyage. Sans observateur
 * ou en mouvement réduit : aucun masquage (apparition immédiate). Un élément déjà préparé n'est pas repris.
 */
export function preparerRevelations(racine: ParentNode, d: DependancesRevelation): () => void {
  if (!d.Observateur || d.mouvementReduit) return () => {}
  const obs = new d.Observateur(
    (entrees) => {
      for (const e of entrees) {
        if (!e.isIntersecting) continue
        e.target.classList.replace('revelation-attente', 'revelation-faite')
        obs.unobserve(e.target)
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  )
  for (const el of racine.querySelectorAll<HTMLElement>(`[${ATTRIBUT_REVELATION}]`)) {
    if (el.classList.contains('revelation-attente') || el.classList.contains('revelation-faite')) continue
    if (el.getBoundingClientRect().top < d.hauteurVue) continue
    el.classList.add('revelation-attente')
    obs.observe(el)
  }
  return () => {
    obs.disconnect()
    // Rien ne reste masqué après démontage ou changement de liste (recherche, onglet).
    for (const el of racine.querySelectorAll('.revelation-attente')) el.classList.replace('revelation-attente', 'revelation-faite')
  }
}

/** Dépendances réelles du navigateur. */
export function dependancesNavigateur(): DependancesRevelation {
  return {
    Observateur: typeof IntersectionObserver === 'undefined' ? undefined : IntersectionObserver,
    mouvementReduit: prefereMouvementReduit(),
    hauteurVue: typeof window === 'undefined' ? 0 : window.innerHeight,
  }
}

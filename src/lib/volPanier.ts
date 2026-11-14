// Micro-animation d'ajout au panier (Menu Appétit, lot 2) : une vignette du plat (ou une pastille « + ») file vers la
// barre panier de la commande à table, puis le bouton de la barre pulse. Rien en mouvement réduit, rien sans barre.
// La barre est `[data-barre-panier]` (son bouton : `[data-bouton-panier]`), dans src/pages/Commande.tsx.
// Styles posés par le CSSOM (élément.style), autorisés par la CSP `style-src 'self'` ; pulsation : src/index.css.

/** Même règle que `prefereMouvementReduit` (src/lib/menuClient.ts), recopiée : l'importer ici sortait menuClient.ts
    dans un chunk partagé de plus (+41 o de JS initial, mesuré au lot 2). */
export const prefereMouvementReduit = (): boolean => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

const DUREE_VOL_MS = 450
const DUREE_PULSE_MS = 500
let minuteriePulse: ReturnType<typeof setTimeout> | undefined

const barrePanier = () => document.querySelector<HTMLElement>('[data-barre-panier]')

/** Pulsation du bouton de la barre panier (stepper +/− en place, fin du vol). */
export function pulserPanier(): void {
  if (prefereMouvementReduit()) return
  const barre = barrePanier()
  if (!barre) return
  // Relance si une pulsation est déjà en cours (reflow entre le retrait et l'ajout de la classe).
  barre.classList.remove('panier-pulse')
  void barre.offsetWidth
  barre.classList.add('panier-pulse')
  clearTimeout(minuteriePulse)
  minuteriePulse = setTimeout(() => barre.classList.remove('panier-pulse'), DUREE_PULSE_MS)
}

/**
 * Vol de `source` vers la barre panier. Position de départ lue tout de suite (le bouton « Ajouter » est remplacé par
 * le stepper au rendu suivant) ; barre cherchée à l'image suivante, car le premier ajout la fait apparaître.
 */
export function animerAjoutPanier(source: HTMLElement | null, opts: { image?: string | null } = {}): void {
  if (prefereMouvementReduit() || !source) return
  const depart = source.getBoundingClientRect()
  requestAnimationFrame(() => {
    const barre = barrePanier()
    if (!barre) return
    const cible = (barre.querySelector('[data-bouton-panier]') ?? barre).getBoundingClientRect()
    const taille = opts.image ? 56 : 36
    const x = depart.left + depart.width / 2 - taille / 2
    const y = depart.top + depart.height / 2 - taille / 2
    const clone = document.createElement(opts.image ? 'img' : 'span')
    if (clone instanceof HTMLImageElement) {
      clone.src = opts.image!
      clone.alt = ''
    } else clone.textContent = '+'
    clone.setAttribute('aria-hidden', 'true')
    Object.assign(clone.style, {
      position: 'fixed',
      left: `${x}px`,
      top: `${y}px`,
      width: `${taille}px`,
      height: `${taille}px`,
      margin: '0',
      zIndex: '60',
      pointerEvents: 'none',
      borderRadius: opts.image ? '0.75rem' : '9999px',
      objectFit: 'cover',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: opts.image ? 'transparent' : 'var(--color-magenta-500)',
      color: 'white',
      fontWeight: '700',
      fontSize: '1.25rem',
    })
    document.body.append(clone)
    if (typeof clone.animate !== 'function') {
      clone.remove()
      return pulserPanier()
    }
    const dx = cible.left + cible.width / 2 - (x + taille / 2)
    const dy = cible.top + cible.height / 2 - (y + taille / 2)
    const vol = clone.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.1)`, opacity: 0 },
      ],
      { duration: DUREE_VOL_MS, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'forwards' },
    )
    vol.onfinish = () => {
      clone.remove()
      pulserPanier()
    }
    vol.oncancel = () => clone.remove()
  })
}

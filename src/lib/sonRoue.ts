// Scène sonore de la roue (R5) : WebAudio pur (oscillateurs, aucun fichier son), chargée à la demande au clic
// « Tourner » (`ouvrirScene`, animationRoue.ts) — hors bundle initial. Un tic par secteur franchi sous le pointeur,
// calculé depuis l'angle animé : même durée et même courbe que la transition CSS de la roue. Aucune logique de
// tirage ici : le point d'arrêt est celui envoyé par le serveur (ou tiré par la démo), rien n'est fabriqué.
import type { SceneRoue } from './animationRoue.ts'
// Directement depuis mouvementRoue.ts (R6) : via animationRoue, le découpage du build sortait roulette et theme de l'index.
import { COURBE_ROTATION, DUREE_ROTATION_MS } from './mouvementRoue.ts'

/** Deux tics plus rapprochés que ça ne font qu'un (début de rotation) : un cliquetis net, pas un bourdonnement. */
export const ECART_MIN_TICS_MS = 45

const [X1, Y1, X2, Y2] = (COURBE_ROTATION.match(/[\d.]+/g) ?? []).map(Number)
const bezier = (p1: number, p2: number, s: number) => 3 * (1 - s) ** 2 * s * p1 + 3 * (1 - s) * s * s * p2 + s ** 3

/** Instant (0..1) où la progression de la courbe CSS atteint `p` (0..1). */
function instantPour(p: number): number {
  let [bas, haut] = [0, 1]
  for (let i = 0; i < 40; i++) {
    const s = (bas + haut) / 2
    if (bezier(Y1, Y2, s) < p) bas = s
    else haut = s
  }
  return bezier(X1, X2, (bas + haut) / 2)
}

/**
 * Instants (ms depuis le départ) où une limite de secteur passe sous le pointeur, pendant la rotation de `de` à `a`
 * degrés. `limites` : angles de début des secteurs (repère de la roue). Durée nulle (mouvement réduit) : aucun tic.
 */
export function ticsRotation(de: number, a: number, limites: number[], duree = DUREE_ROTATION_MS, ecartMin = ECART_MIN_TICS_MS): number[] {
  if (!(duree > 0) || !(a > de)) return []
  const instants: number[] = []
  for (const b of limites) {
    // La limite b est sous le pointeur (en haut) quand la rotation vaut 360k − b.
    for (let r = Math.ceil((de + b) / 360) * 360 - b; r <= a; r += 360) {
      if (r > de) instants.push(Math.round(instantPour((r - de) / (a - de)) * duree))
    }
  }
  instants.sort((x, y) => x - y)
  return instants.filter((t, i) => i === 0 || t - instants[i - 1] >= ecartMin)
}

/** Motif de gain : trois notes montantes courtes (do, mi, sol) ; allégé (deux notes, plus doux) pour les points. */
export const NOTES_GAIN = [523.25, 659.25, 783.99]

/**
 * `ctx` : contexte ouvert par le clic « Tourner » (null si le son était coupé) ; `ouvrir` : en ouvre un dans le geste
 * du bouton son (`muet = false` pendant la partie), sinon une partie commencée en muet resterait silencieuse.
 * Toutes les notes passent par un gain maître : couper le son tait aussi les notes déjà programmées (motif de gain).
 */
export function creerScene(ctx?: AudioContext | null | false, ouvrir: () => AudioContext | undefined = () => undefined): SceneRoue {
  let muet = false
  let maitre: GainNode | undefined
  const actifs = new Set<OscillatorNode>()
  function note(frequence: number, debut: number, duree: number, volume: number, forme: OscillatorType) {
    if (!ctx || muet) return
    try {
      if (!maitre) (maitre = ctx.createGain()).connect(ctx.destination)
      const t = ctx.currentTime + debut
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = forme
      o.frequency.setValueAtTime(frequence, t)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(volume, t + 0.006)
      g.gain.exponentialRampToValueAtTime(0.0001, t + duree)
      o.connect(g).connect(maitre)
      o.onended = () => actifs.delete(o)
      actifs.add(o)
      o.start(t)
      o.stop(t + duree + 0.02)
    } catch {
      // WebAudio refusé ou incomplet : silence, la roue tourne quand même.
    }
  }
  return {
    get muet() {
      return muet
    },
    set muet(v) {
      muet = v
      if (v) {
        // Silence immédiat : gain maître à zéro et arrêt des oscillateurs déjà programmés.
        if (maitre) maitre.gain.value = 0
        for (const o of actifs) {
          try {
            o.stop()
          } catch {
            // Déjà arrêté.
          }
        }
        actifs.clear()
        return
      }
      if (maitre) maitre.gain.value = 1
      // Réactivé (dans le geste du bouton son) : ouvre le contexte s'il manquait, sinon le réveille.
      if (!ctx) ctx = ouvrir()
      else void ctx.resume?.()?.catch?.(() => {})
    },
    planifier(de, a, limites, duree, pointeur, ecoule = 0) {
      const animations: (Animation | undefined)[] = []
      const minuteries = ticsRotation(de, a, limites, duree)
        .filter((t) => t >= ecoule)
        .map((t) =>
          setTimeout(() => {
            note(1500, 0, 0.04, 0.09, 'triangle')
            try {
              // Le pointeur bute sur le secteur franchi : brève inclinaison (transform seul, composité).
              animations.push(pointeur?.animate?.([{ rotate: '0deg' }, { rotate: '-14deg' }, { rotate: '0deg' }], { duration: 110, easing: 'ease-out' }))
            } catch {
              // Web Animations indisponible : pas d'inclinaison.
            }
          }, t - ecoule),
        )
      // Annulation (nouvelle rotation, démontage, mouvement réduit activé en cours) : tics à venir ET inclinaison en cours.
      return () => {
        minuteries.forEach(clearTimeout)
        for (const x of animations) x?.cancel?.()
      }
    },
    fanfare(leger) {
      for (const [i, f] of NOTES_GAIN.slice(leger ? 1 : 0).entries()) note(f, i * 0.11, 0.22, leger ? 0.1 : 0.16, 'sine')
    },
  }
}

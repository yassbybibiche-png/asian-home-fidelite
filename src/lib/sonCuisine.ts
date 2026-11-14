// Alerte sonore de l'écran cuisine (produit cycle 2, P1-2) : WebAudio pur (oscillateurs, aucun fichier son), deux
// notes courtes à l'arrivée d'une commande « reçue ». Le contexte audio n'est créé que dans un geste du personnel
// (premier appui ou touche) : hors geste, les navigateurs le gardent suspendu et le son ne part pas. Ne lève
// jamais : sans WebAudio, l'écran fonctionne en silence et l'alerte visuelle prend le relais.

/** Clé par appareil (pas par commerce) ; absente = son activé. */
export const CLE_SON_CUISINE = 'fidelite:son-cuisine'

/** Accès au stockage déjà protégé par l'appelant (`stockageLocal`) ; sans stockage : son activé. */
export function sonCuisineActif(stockage: Pick<Storage, 'getItem'> | null | undefined): boolean {
  return stockage?.getItem(CLE_SON_CUISINE) !== '0'
}

export function memoriserSonCuisine(stockage: Pick<Storage, 'setItem'> | null | undefined, actif: boolean): void {
  try {
    stockage?.setItem(CLE_SON_CUISINE, actif ? '1' : '0')
  } catch {
    // Stockage indisponible : le choix vaut pour cette page seulement.
  }
}

/** Deux notes courtes, distinctes du motif de gain de la roue : la (880 Hz) puis ré (1 174,66 Hz). */
export const NOTES_ALERTE_CUISINE = [880, 1174.66]

/** Écart entre les deux notes et durée de chacune. */
export const DELAI_NOTES_ALERTE_MS = 130
export const DUREE_NOTE_ALERTE_MS = 180

type FenetreAudio = { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext }

/**
 * Crée (ou réveille) le contexte audio. À appeler dans un geste, sinon le navigateur le laisse suspendu. Ne lève
 * jamais ; sans WebAudio : undefined, l'alerte reste muette.
 */
export function ouvrirContexteAudio(w: FenetreAudio = globalThis as never): AudioContext | undefined {
  try {
    const ctx = new (w.AudioContext ?? w.webkitAudioContext)!()
    ctx.resume().catch(() => {})
    return ctx
  } catch {
    return undefined
  }
}

export interface AlerteCuisine {
  actif: boolean
  /** Appelé dans un geste du personnel (appui, touche) : ouvre le contexte, sinon le son resterait bloqué. */
  deverrouiller(): void
  /** Deux notes, si le son est activé et le contexte ouvert. Ne lève jamais. */
  alerter(): void
}

/** Un seul contexte par écran, ouvert au premier geste ; `actif` reflète le choix de l'équipe (défaut : oui). */
export function creerAlerteCuisine(ouvrir: () => AudioContext | undefined = ouvrirContexteAudio): AlerteCuisine {
  let ctx: AudioContext | undefined
  let actif = true
  function note(frequence: number, debut: number) {
    if (!ctx) return
    try {
      const t = ctx.currentTime + debut
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.setValueAtTime(frequence, t)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.006)
      g.gain.exponentialRampToValueAtTime(0.0001, t + DUREE_NOTE_ALERTE_MS / 1000)
      o.connect(g).connect(ctx.destination)
      o.start(t)
      o.stop(t + DUREE_NOTE_ALERTE_MS / 1000 + 0.02)
    } catch {
      // WebAudio refusé ou incomplet : silence, la cuisine continue.
    }
  }
  return {
    get actif() {
      return actif
    },
    set actif(v) {
      actif = v
    },
    deverrouiller() {
      if (!ctx) ctx = ouvrir()
      // Réveillé dans le geste, que le contexte vienne d'être créé ou non (resume est sans effet s'il tourne déjà).
      void ctx?.resume?.()?.catch?.(() => {})
    },
    alerter() {
      if (!actif || !ctx) return
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
      NOTES_ALERTE_CUISINE.forEach((f, i) => note(f, (i * DELAI_NOTES_ALERTE_MS) / 1000))
    },
  }
}

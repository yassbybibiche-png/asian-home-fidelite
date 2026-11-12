// Mise en scène de la roue (P1-C2) : durée de rotation, mouvement réduit, vibration, confettis, textes des écrans
// de résultat et parcours « garder ma carte ». Logique pure, testable sans navigateur ; aucune logique de tirage ici.
import { jourEnClair } from './roulette.ts'
import type { Langue } from './langue.ts'
import { COULEURS_CONFETTIS } from '../theme.ts'

export { COULEURS_CONFETTIS }

/** Rotation de la roue : 3,6 s (fourchette demandée 3 à 4 s). Animation CSS de `transform` seul (composité, 60 fps). */
export const DUREE_ROTATION_MS = 3600
/** Courbe de décélération : départ vif, longue fin qui ralentit sous le pointeur. */
export const COURBE_ROTATION = 'cubic-bezier(0.15, 0.85, 0.2, 1)'
/** Petite pause après l'arrêt de la roue avant l'écran de résultat. */
export const PAUSE_RESULTAT_MS = 200
/** Mouvement réduit : la roue saute directement sur le lot, sans tours ; l'écran de résultat suit presque aussitôt. */
export const DELAI_RESULTAT_REDUIT_MS = 150

export const REQUETE_MOUVEMENT_REDUIT = '(prefers-reduced-motion: reduce)'

/** Vrai si le téléphone demande moins d'animations (réglage d'accessibilité). Sans `matchMedia` : animation normale. */
export function prefereMouvementReduit(w: { matchMedia?: (q: string) => { matches: boolean } } | undefined = globalThis as never): boolean {
  try {
    return !!w?.matchMedia?.(REQUETE_MOUVEMENT_REDUIT).matches
  } catch {
    return false
  }
}

/** Durée de la rotation affichée. */
export function dureeRotation(reduit: boolean): number {
  return reduit ? 0 : DUREE_ROTATION_MS
}

/** Délai entre le lancement et l'écran de résultat. `avecRoue` = faux si le lot n'est pas sur la roue (rien ne tourne). */
export function delaiResultat(reduit: boolean, avecRoue = true): number {
  if (!avecRoue) return 0
  return reduit ? DELAI_RESULTAT_REDUIT_MS : DUREE_ROTATION_MS + PAUSE_RESULTAT_MS
}

/** Transition CSS de la couche qui tourne. */
export function transitionRoue(reduit: boolean): string {
  return reduit ? 'none' : `transform ${DUREE_ROTATION_MS}ms ${COURBE_ROTATION}`
}

/** Nombre de tours complets avant l'arrêt : 5 normalement, 0 en mouvement réduit (le secteur gagnant reste exact). */
export function toursRotation(reduit: boolean): number {
  return reduit ? 0 : 5
}

// ---- Son (R5) : préférence de l'appareil, AudioContext ouvert dans le geste, synthèse chargée à la demande ----

/** Clé par appareil (pas par commerce) ; absente = son activé. */
export const CLE_SON = 'fidelite:son-roue'

/** Accès au stockage déjà protégé par l'appelant (`stockageLocal`) ; sans stockage : son activé. */
export function sonActive(stockage: Pick<Storage, 'getItem'> | null | undefined): boolean {
  return stockage?.getItem(CLE_SON) !== '0'
}

export function memoriserSon(stockage: Pick<Storage, 'setItem'> | null | undefined, actif: boolean): void {
  try {
    stockage?.setItem(CLE_SON, actif ? '1' : '0')
  } catch {
    // Stockage indisponible : le choix vaut pour cette page seulement.
  }
}

/** Tics, inclinaison du pointeur et motif de gain : `src/lib/sonRoue.ts`, hors bundle initial. */
export interface SceneRoue {
  /** Son coupé en cours de partie : les notes se taisent, l'inclinaison du pointeur continue. */
  muet: boolean
  planifier(de: number, a: number, limites: number[], duree: number, pointeur?: Element | null, ecoule?: number): () => void
  fanfare(leger: boolean): void
}

type FenetreAudio = { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext }

/**
 * À appeler UNIQUEMENT dans le clic « Tourner » : crée (ou réveille) l'AudioContext pendant le geste si le son est
 * activé, puis charge la scène. Ne lève jamais ; sans WebAudio, la scène tourne en silence.
 */
export function ouvrirScene(son: boolean, w: FenetreAudio = globalThis as never): Promise<SceneRoue | null> {
  let ctx: AudioContext | null = null
  try {
    const C = w.AudioContext ?? w.webkitAudioContext
    if (son && C) void (ctx = new C()).resume?.()?.catch?.(() => {})
  } catch {
    ctx = null
  }
  return import('./sonRoue.ts').then(
    (m) => m.creerScene(ctx),
    () => null,
  )
}

// ---- Vibration ----

/** Motif de vibration au gain : deux impulsions courtes. */
export const MOTIF_VIBRATION_GAIN = [80, 60, 140]
/** Perdu : une seule impulsion brève (le résultat est quand même annoncé). */
export const MOTIF_VIBRATION_PERDU = [40]

/** Fait vibrer le téléphone si possible (Android/Chrome ; iOS Safari n'a pas l'API). Ne lève jamais. */
export function vibrer(motif: number[], nav: { vibrate?: (m: number[]) => boolean } | undefined = globalThis.navigator as never): boolean {
  try {
    return typeof nav?.vibrate === 'function' ? nav.vibrate(motif) : false
  } catch {
    return false
  }
}

// ---- Confettis (CSS maison, aucune dépendance) ----

export const NOMBRE_CONFETTIS = 36
/** Consolation en points (R5) : même pluie, allégée. */
export const NOMBRE_CONFETTIS_LEGER = 14

export interface Confetti {
  /** Position de départ horizontale, en % de la largeur. */
  gauche: number
  /** Délai et durée de chute, en ms. */
  delai: number
  duree: number
  /** Dérive horizontale finale (px) et rotation finale (deg). */
  derive: number
  rotation: number
  couleur: string
  rond: boolean
}

/** Confettis déterministes pour un `alea` donné (tests) ; aucun en mouvement réduit. */
export function genererConfettis(reduit: boolean, n = NOMBRE_CONFETTIS, alea: () => number = Math.random): Confetti[] {
  if (reduit) return []
  return Array.from({ length: n }, (_, i) => ({
    gauche: Math.round(alea() * 1000) / 10,
    delai: Math.round(alea() * 400),
    duree: 1600 + Math.round(alea() * 900),
    derive: Math.round((alea() - 0.5) * 160),
    rotation: Math.round(360 + alea() * 540),
    couleur: COULEURS_CONFETTIS[i % COULEURS_CONFETTIS.length],
    rond: i % 3 === 0,
  }))
}

/** Durée maximale de la pluie de confettis : au-delà, le calque est retiré du DOM. */
export function dureeConfettis(confettis: Confetti[]): number {
  return confettis.reduce((m, c) => Math.max(m, c.delai + c.duree), 0)
}

// ---- Textes des écrans ----

export const TITRE_PERDU = 'Pas de lot cette fois'
/** Écran « perdu » positif : la visite compte quand même, et il y a une prochaine chance. */
export const TEXTE_PERDU_TAMPON = 'Votre visite du jour est bien enregistrée sur votre carte de fidélité : un tampon de plus vers votre récompense.'
export const TEXTE_PERDU_PROCHAINE = 'Prochaine chance à votre prochaine visite validée au comptoir, dès demain.'
export const TEXTE_GAIN_SANS_CODE = 'Montrez cet écran au comptoir pour profiter de votre lot.'
/** Gain physique (R4) : utilisable de J+1 à J+30, code affiché 10 minutes depuis la carte (« Utiliser mon gain »). */
export const TEXTE_GAIN_ACTIVATION = 'Le jour venu, ouvrez votre carte au comptoir et appuyez sur « Utiliser mon gain » : votre code s’affiche pendant 10 minutes.'
/** Consolation en points (R1) : rien à retirer au comptoir ; la visite compte toujours. */
export const TEXTE_CONSOLATION = 'Rien à retirer au comptoir : votre visite du jour compte sur votre carte de fidélité.'
export const TEXTE_CODE_A_MONTRER = 'Montrez ce code au serveur :'
export const TEXTE_CODE_UNE_FOIS = 'Le code est vérifié en caisse et ne sert qu’une fois.'
export const TEXTE_DEJA_JOUE = '1 tirage par personne et par jour. Prochaine chance à votre prochaine visite validée, dès demain.'

/** « Valable aujourd'hui, mar. 10 nov. 2026 » : le code n'est accepté en caisse que le jour du tirage (P0-U3). */
export function texteValidite(maintenant: Date): string {
  return `Valable aujourd’hui, ${jourEnClair(maintenant)}`
}

// ---- « Garder ma carte » : ajout à l'écran d'accueil en attendant le Wallet ----

export type Plateforme = 'ios' | 'android' | 'autre'

/** Plateforme d'après le user-agent (iPadOS 13+ se présente comme un Mac tactile). */
export function detecterPlateforme(userAgent: string, pointsTactiles = 0): Plateforme {
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && pointsTactiles > 1)) return 'ios'
  if (/Android/i.test(userAgent)) return 'android'
  return 'autre'
}

/** Page déjà ouverte depuis l'écran d'accueil (rien à proposer). */
export function estInstallee(w: { matchMedia?: (q: string) => { matches: boolean }; navigator?: { standalone?: boolean } } | undefined = globalThis as never): boolean {
  try {
    return !!w?.navigator?.standalone || !!w?.matchMedia?.('(display-mode: standalone)').matches
  } catch {
    return false
  }
}

/** Instructions pas à pas pour ajouter la carte à l'écran d'accueil. */
export function etapesEcranAccueil(p: Plateforme): string[] {
  if (p === 'ios')
    return [
      'Ouvrez votre carte avec le bouton ci-dessous, dans Safari.',
      'Touchez le bouton Partager (le carré avec une flèche vers le haut).',
      'Choisissez « Sur l’écran d’accueil », puis « Ajouter ».',
    ]
  if (p === 'android')
    return [
      'Ouvrez votre carte avec le bouton ci-dessous, dans Chrome.',
      'Touchez le menu ⋮ en haut à droite.',
      'Choisissez « Ajouter à l’écran d’accueil » (ou « Installer »), puis confirmez.',
    ]
  return [
    'Ouvrez votre carte avec le bouton ci-dessous.',
    'Ajoutez la page à vos favoris, ou à l’écran d’accueil depuis le menu du navigateur de votre téléphone.',
  ]
}

/** Étapes en anglais (P2-Q1) : même ordre que `etapesEcranAccueil`, hors dictionnaire — elles ne sont pas
 *  traduites par `t()` mais choisies par la langue, comme `texteProgressionLangue`. Cela évite 8 clés
 *  (FR + EN) dans le dictionnaire initial du bundle (P2-Q2). */
const ETAPES_ECRAN_ACCUEIL_EN: Record<Plateforme, string[]> = {
  ios: [
    'Open your card with the button below, in Safari.',
    'Tap the Share button (the square with an upward arrow).',
    'Choose “Add to Home Screen”, then “Add”.',
  ],
  android: [
    'Open your card with the button below, in Chrome.',
    'Tap the ⋮ menu at the top right.',
    'Choose “Add to Home screen” (or “Install”), then confirm.',
  ],
  autre: [
    'Open your card with the button below.',
    'Bookmark the page, or add it to your home screen from your phone browser’s menu.',
  ],
}

/** Instructions pas à pas pour ajouter la carte à l’écran d’accueil, dans la langue courante. */
export function etapesEcranAccueilLangue(p: Plateforme, langue: Langue): string[] {
  if (langue === 'fr') return etapesEcranAccueil(p)
  return ETAPES_ECRAN_ACCUEIL_EN[p]
}

export const NOTE_WALLET = 'Apple Wallet et Google Wallet arrivent bientôt ; en attendant, l’icône sur votre écran d’accueil ouvre directement votre carte.'

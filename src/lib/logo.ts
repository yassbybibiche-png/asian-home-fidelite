// Logo téléversé par le commerçant (lot P1-B5) : règles communes au front (avant envoi) et au serveur (qui fait foi).
// Le format est lu dans les premiers octets du fichier (signature + en-tête), jamais déduit du nom ni du Content-Type :
// un GIF renommé en .png, un SVG (qui peut contenir du script) ou un texte sont refusés.
//
// Stockage (server/app.ts) : table `meta`, clé `logo:<commerceId>`, aucune migration. Le champ `logo` du commerce
// contient alors l'adresse versionnée du fichier (`/api/v1/commerces/<id>/logo?v=<empreinte>`), courte : la liste
// publique des commerces ne transporte jamais l'image elle-même.

export const FORMATS_LOGO = ['image/png', 'image/jpeg', 'image/webp'] as const
export type FormatLogo = (typeof FORMATS_LOGO)[number]

/**
 * - 2 Mo : un logo net n'a pas besoin de plus ; au-delà, la base et chaque premier chargement de la carte en pâtissent.
 * - 100 px de côté minimum : en dessous, le logo est flou dès l'en-tête (64 px affichés, ×2 sur écran Retina).
 * - 4 096 px de côté maximum : au-delà, le décodage coûte cher aux téléphones pour un affichage de 64 px.
 */
export const LIMITES_LOGO = { octetsMax: 2 * 1024 * 1024, coteMin: 100, coteMax: 4096 } as const

export interface InfosLogo {
  type: FormatLogo
  largeur: number
  hauteur: number
}

export class ErreurLogo extends Error {
  /** 413 : fichier trop lourd ; 400 : format ou dimensions refusés. */
  statut: 400 | 413
  constructor(message: string, statut: 400 | 413 = 400) {
    super(message)
    this.statut = statut
  }
}

export const MESSAGE_FORMAT_LOGO = 'Format refusé : le logo doit être une image PNG, JPEG ou WebP (GIF, SVG et autres fichiers ne sont pas acceptés).'

const mo = (octets: number) => `${(octets / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`
export const messageTropLourd = (octets?: number) => `Logo trop lourd : 2 Mo maximum${octets ? ` (fichier choisi : ${mo(octets)})` : ''}. Réduisez l’image ou exportez-la en WebP / JPEG.`

const u16be = (o: Uint8Array, i: number) => (o[i] << 8) | o[i + 1]
const u16le = (o: Uint8Array, i: number) => o[i] | (o[i + 1] << 8)
const u24le = (o: Uint8Array, i: number) => o[i] | (o[i + 1] << 8) | (o[i + 2] << 16)
const u32be = (o: Uint8Array, i: number) => ((o[i] << 24) >>> 0) + ((o[i + 1] << 16) | (o[i + 2] << 8) | o[i + 3])
const ascii = (o: Uint8Array, i: number, n: number) => String.fromCharCode(...o.subarray(i, i + n))

/** Format et dimensions lus dans l'en-tête ; null si ce n'est pas un PNG / JPEG / WebP lisible. */
export function lireEnTeteImage(o: Uint8Array): InfosLogo | null {
  // PNG : signature 89 50 4E 47 0D 0A 1A 0A, puis le bloc IHDR (largeur, hauteur sur 4 octets).
  if (o.length >= 24 && o[0] === 0x89 && ascii(o, 1, 3) === 'PNG' && o[4] === 0x0d && o[5] === 0x0a && o[6] === 0x1a && o[7] === 0x0a && ascii(o, 12, 4) === 'IHDR') {
    return { type: 'image/png', largeur: u32be(o, 16), hauteur: u32be(o, 20) }
  }
  // JPEG : FF D8 FF, puis segments jusqu'au premier SOFn (hauteur puis largeur sur 2 octets).
  if (o.length >= 4 && o[0] === 0xff && o[1] === 0xd8 && o[2] === 0xff) {
    let i = 2
    while (i + 9 < o.length) {
      if (o[i] !== 0xff) return null
      const marqueur = o[i + 1]
      if (marqueur === 0xff) {
        i++ // octet de remplissage
        continue
      }
      if (marqueur === 0xd8 || marqueur === 0x01 || (marqueur >= 0xd0 && marqueur <= 0xd7)) {
        i += 2
        continue
      }
      if (marqueur === 0xd9 || marqueur === 0xda) return null // fin d'image / données avant toute dimension
      const sof = marqueur >= 0xc0 && marqueur <= 0xcf && marqueur !== 0xc4 && marqueur !== 0xc8 && marqueur !== 0xcc
      if (sof) return { type: 'image/jpeg', largeur: u16be(o, i + 7), hauteur: u16be(o, i + 5) }
      i += 2 + u16be(o, i + 2)
    }
    return null
  }
  // WebP : RIFF….WEBP puis un bloc VP8 (avec perte), VP8L (sans perte) ou VP8X (étendu : transparence, animation).
  if (o.length >= 30 && ascii(o, 0, 4) === 'RIFF' && ascii(o, 8, 4) === 'WEBP') {
    const bloc = ascii(o, 12, 4)
    if (bloc === 'VP8 ' && o[23] === 0x9d && o[24] === 0x01 && o[25] === 0x2a) {
      return { type: 'image/webp', largeur: u16le(o, 26) & 0x3fff, hauteur: u16le(o, 28) & 0x3fff }
    }
    if (bloc === 'VP8L' && o[20] === 0x2f) {
      const b = o[21] | (o[22] << 8) | (o[23] << 16) | (o[24] << 24)
      return { type: 'image/webp', largeur: (b & 0x3fff) + 1, hauteur: ((b >>> 14) & 0x3fff) + 1 }
    }
    if (bloc === 'VP8X') return { type: 'image/webp', largeur: u24le(o, 24) + 1, hauteur: u24le(o, 27) + 1 }
    return null
  }
  return null
}

/** Dimensions acceptées ? Message clair sinon. */
export function problemeDimensions(largeur: number, hauteur: number): string | null {
  const recu = `image reçue : ${largeur} × ${hauteur} px`
  if (Math.min(largeur, hauteur) < LIMITES_LOGO.coteMin) return `Image trop petite : ${LIMITES_LOGO.coteMin} px minimum de côté (${recu}). Le logo serait flou.`
  if (Math.max(largeur, hauteur) > LIMITES_LOGO.coteMax) return `Image trop grande : ${LIMITES_LOGO.coteMax} px maximum de côté (${recu}). Réduisez-la avant de l’envoyer.`
  return null
}

/** Valide un fichier de logo complet (poids, format réel, dimensions) ; lève ErreurLogo avec le message à afficher. */
export function validerLogo(o: Uint8Array): InfosLogo {
  if (o.length > LIMITES_LOGO.octetsMax) throw new ErreurLogo(messageTropLourd(o.length), 413)
  if (!o.length) throw new ErreurLogo('Aucun fichier reçu : choisissez une image PNG, JPEG ou WebP.')
  const infos = lireEnTeteImage(o)
  if (!infos) throw new ErreurLogo(MESSAGE_FORMAT_LOGO)
  const p = problemeDimensions(infos.largeur, infos.hauteur)
  if (p) throw new ErreurLogo(p)
  return infos
}

/**
 * Taille d'envoi : le navigateur réduit le logo à 512 px de grand côté (64 px affichés au plus, ×2 Retina, marge
 * pour un usage futur) — sans jamais faire passer le petit côté sous le minimum, ni agrandir l'image.
 */
export const COTE_ENVOI_LOGO = 512
export function dimensionsEnvoi(largeur: number, hauteur: number, cible = COTE_ENVOI_LOGO): { largeur: number; hauteur: number } {
  let echelle = Math.min(1, cible / Math.max(largeur, hauteur))
  echelle = Math.min(1, Math.max(echelle, LIMITES_LOGO.coteMin / Math.min(largeur, hauteur)))
  return { largeur: Math.round(largeur * echelle), hauteur: Math.round(hauteur * echelle) }
}

/** Adresse publique du logo téléversé ; `version` (empreinte du fichier) change à chaque envoi → pas de vieux cache. */
export function urlLogo(commerceId: string, version: string): string {
  return `/api/v1/commerces/${encodeURIComponent(commerceId)}/logo?v=${encodeURIComponent(version)}`
}

/** Le logo du commerce est-il un fichier téléversé (servi par l'API) ? */
export function estLogoTeleverse(logo: string | undefined): boolean {
  return !!logo && /^\/api\/v1\/commerces\/[^/]+\/logo(\?|$)/.test(logo)
}

/**
 * Fond blanc opaque ? (pixels RGBA du logo, tels que dessinés sur un canvas) — on regarde le pourtour : si au moins 90 %
 * des pixels du bord sont blancs ou presque ET opaques, le logo apparaîtra comme un carré blanc sur le fond noir de l'app.
 * Simple avertissement au commerçant, aucun traitement de l'image.
 */
export function fondBlancOpaque(rgba: Uint8ClampedArray | Uint8Array, largeur: number, hauteur: number): boolean {
  if (largeur < 1 || hauteur < 1 || rgba.length < largeur * hauteur * 4) return false
  let total = 0
  let blancs = 0
  const examiner = (x: number, y: number) => {
    const i = (y * largeur + x) * 4
    total++
    if (rgba[i + 3] >= 250 && rgba[i] >= 235 && rgba[i + 1] >= 235 && rgba[i + 2] >= 235) blancs++
  }
  for (let x = 0; x < largeur; x++) {
    examiner(x, 0)
    if (hauteur > 1) examiner(x, hauteur - 1)
  }
  for (let y = 1; y < hauteur - 1; y++) {
    examiner(0, y)
    if (largeur > 1) examiner(largeur - 1, y)
  }
  return blancs / total >= 0.9
}

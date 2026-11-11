// Décodeur de QR pour le scanner de la caisse, avec repli : `BarcodeDetector` du navigateur s'il existe et se construit,
// sinon jsQR (chargé à la demande). Logique sans DOM : la source d'image, les pixels et le chargement de jsQR sont
// injectés par le composant (ScannerQr.tsx), ce qui permet de tester les bascules.

export interface DetecteurNatif<S> {
  detect(source: S): Promise<{ rawValue: string }[]>
}
export type ConstructeurDetecteur<S> = new (o: { formats: string[] }) => DetecteurNatif<S>
export type FonctionJsQr = (donnees: Uint8ClampedArray, largeur: number, hauteur: number) => { data: string } | null
export interface ImageQr {
  donnees: Uint8ClampedArray
  largeur: number
  hauteur: number
}

export interface DependancesDecodeur<S> {
  /** Constructeur `BarcodeDetector` du navigateur, s'il existe. */
  Natif?: ConstructeurDetecteur<S>
  /** Import dynamique de jsQR (morceau séparé). */
  chargerJsQr(): Promise<FonctionJsQr>
  /** Source passée au détecteur natif (la vidéo). */
  source(): S
  /** Pixels de l'image courante pour jsQR, ou null si la vidéo n'est pas encore prête. */
  image(): ImageQr | null
}

export interface DecodeurQr {
  type: 'natif' | 'jsqr'
  lire(): Promise<string | null>
}

/** Au-delà de ce nombre d'erreurs de détection consécutives : bascule sur jsQR, puis abandon. */
export const SEUIL_ERREURS_DETECTION = 10
export const MESSAGE_DECODEUR_INDISPONIBLE =
  'Lecture des QR codes impossible sur cet appareil ou ce navigateur. Utilisez la recherche manuelle.'
export const MESSAGE_LECTURE_EN_ECHEC = 'La lecture du QR code échoue sans cesse sur cet appareil. Utilisez la recherche manuelle.'

export class ErreurScanQr extends Error {}

/** Décodeur natif si possible, sinon jsQR ; lève `ErreurScanQr` si aucun n'est utilisable (jamais de rejet silencieux). */
export async function creerDecodeur<S>(d: DependancesDecodeur<S>, sansNatif = false): Promise<DecodeurQr> {
  if (d.Natif && !sansNatif) {
    try {
      const detecteur = new d.Natif({ formats: ['qr_code'] })
      return { type: 'natif', lire: async () => (await detecteur.detect(d.source()))[0]?.rawValue ?? null }
    } catch {
      // constructeur en échec (format non pris en charge, implémentation instable) : repli sur jsQR
    }
  }
  let jsQR: FonctionJsQr
  try {
    jsQR = await d.chargerJsQr()
    if (typeof jsQR !== 'function') throw new Error('jsQR introuvable')
  } catch {
    throw new ErreurScanQr(MESSAGE_DECODEUR_INDISPONIBLE)
  }
  return {
    type: 'jsqr',
    lire: async () => {
      const i = d.image()
      return i ? (jsQR(i.donnees, i.largeur, i.hauteur)?.data ?? null) : null
    },
  }
}

export interface LecteurQr {
  readonly type: DecodeurQr['type']
  /** Une tentative : le texte lu, ou null (rien vu / erreur passagère). Lève `ErreurScanQr` quand il faut abandonner. */
  lire(): Promise<string | null>
}

/** Lecteur avec compteur d'erreurs consécutives : natif → jsQR une fois au-delà du seuil, puis abandon. */
export async function creerLecteurQr<S>(d: DependancesDecodeur<S>, seuil = SEUIL_ERREURS_DETECTION): Promise<LecteurQr> {
  let decodeur = await creerDecodeur(d)
  let erreurs = 0
  return {
    get type() {
      return decodeur.type
    },
    async lire() {
      try {
        const texte = await decodeur.lire()
        erreurs = 0
        return texte
      } catch {
        erreurs++
        if (erreurs < seuil) return null
        if (decodeur.type === 'natif') {
          try {
            decodeur = await creerDecodeur(d, true)
            erreurs = 0
            return null
          } catch {
            // jsQR indisponible aussi : abandon ci-dessous
          }
        }
        throw new ErreurScanQr(MESSAGE_LECTURE_EN_ECHEC)
      }
    },
  }
}

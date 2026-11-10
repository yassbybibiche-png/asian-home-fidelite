import { useEffect, useState } from 'react'
import { MESSAGE_MODE_SERVEUR, useAction, useStore } from '../store'
import type { Commerce } from '../types'
import { LogoCommerce, MessageErreur } from './ui'
import {
  dimensionsEnvoi,
  estLogoTeleverse,
  FORMATS_LOGO,
  fondBlancOpaque,
  LIMITES_LOGO,
  lireEnTeteImage,
  MESSAGE_FORMAT_LOGO,
  messageTropLourd,
  problemeDimensions,
} from '../lib/logo'

interface Choix {
  /** Fichier envoyé au serveur (réduit à 512 px en WebP si le navigateur sait le faire et que c'est plus léger). */
  envoi: Blob
  apercu: string
  largeur: number
  hauteur: number
  fondBlanc: boolean
}

/** Vérifie le fichier choisi (mêmes règles que le serveur), le réduit et repère un fond blanc opaque. */
async function preparer(fichier: File): Promise<Choix> {
  if (fichier.size > LIMITES_LOGO.octetsMax) throw new Error(messageTropLourd(fichier.size))
  const infos = lireEnTeteImage(new Uint8Array(await fichier.arrayBuffer()))
  if (!infos) throw new Error(MESSAGE_FORMAT_LOGO)
  const probleme = problemeDimensions(infos.largeur, infos.hauteur)
  if (probleme) throw new Error(probleme)
  const image = await createImageBitmap(fichier)
  const cible = dimensionsEnvoi(image.width, image.height)
  const canvas = document.createElement('canvas')
  canvas.width = cible.largeur
  canvas.height = cible.hauteur
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(image, 0, 0, cible.largeur, cible.hauteur)
  const fondBlanc = fondBlancOpaque(ctx.getImageData(0, 0, cible.largeur, cible.hauteur).data, cible.largeur, cible.hauteur)
  // WebP garde la transparence ; un navigateur qui ne sait pas l'encoder renvoie du PNG (accepté aussi).
  const reduit = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/webp', 0.9))
  const garderReduit = !!reduit && (FORMATS_LOGO as readonly string[]).includes(reduit.type) && reduit.size < fichier.size
  const envoi = garderReduit ? reduit! : fichier
  return { envoi, apercu: URL.createObjectURL(envoi), largeur: infos.largeur, hauteur: infos.hauteur, fondBlanc }
}

/**
 * Logo du commerce (Réglages) : choix d'un fichier, aperçu sur le fond nuit de l'app, envoi, retour au logo par défaut.
 * Indépendant du bouton « Enregistrer » du formulaire : le logo part dès « Utiliser ce logo ».
 */
export function ChampLogo({ commerce, onChange }: { commerce: Commerce; onChange(logo: string): void }) {
  const { mode, avecPin } = useStore()
  const { executer, enCours, erreur } = useAction()
  const [choix, setChoix] = useState<Choix | null>(null)
  const [refus, setRefus] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const televerse = estLogoTeleverse(commerce.logo)
  const personnalise = !!commerce.logo?.trim()

  useEffect(() => () => {
    if (choix) URL.revokeObjectURL(choix.apercu)
  }, [choix])

  async function choisir(fichier: File | undefined) {
    setRefus(null)
    setMessage(null)
    setChoix(null)
    if (!fichier) return
    try {
      setChoix(await preparer(fichier))
    } catch (e) {
      setRefus(e instanceof Error && e.message ? e.message : MESSAGE_FORMAT_LOGO)
    }
  }

  async function envoyer() {
    if (!choix) return
    const r = await executer(() => avecPin((a, api) => api.envoyerLogo(commerce.id, a, choix.envoi)))
    if (r.ok) {
      onChange(r.valeur.logo ?? '')
      setChoix(null)
      setMessage('✓ Logo enregistré : il s’affiche maintenant sur la carte, le jeu et le menu.')
    }
  }

  async function revenirAuDefaut() {
    const r = await executer(() => avecPin((a, api) => api.supprimerLogo(commerce.id, a)))
    if (r.ok) {
      onChange('')
      setChoix(null)
      setMessage('✓ Logo par défaut rétabli.')
    }
  }

  return (
    <div data-champ-logo>
      <p className="etiquette" id="logo-titre">
        Logo
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <LogoCommerce commerce={commerce} taille="lg" />
        <div className="min-w-0 flex-1 text-sm text-gray-600">
          {televerse ? 'Logo envoyé depuis cet écran.' : personnalise ? 'Logo personnalisé (adresse).' : 'Logo par défaut.'}
        </div>
      </div>
      {mode === 'local' ? (
        <p className="mt-2 text-sm text-gray-600">{MESSAGE_MODE_SERVEUR}</p>
      ) : (
        <>
          <label className="bouton-secondaire mt-3 inline-flex cursor-pointer" htmlFor="logo-fichier">
            Choisir une image…
          </label>
          <input
            id="logo-fichier"
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-describedby="logo-aide"
            onChange={(e) => {
              void choisir(e.target.files?.[0])
              e.target.value = '' // rechoisir le même fichier redéclenche la vérification
            }}
          />
          <p id="logo-aide" className="mt-1 text-sm text-gray-600">
            PNG, JPEG ou WebP · 2 Mo maximum · entre {LIMITES_LOGO.coteMin} et {LIMITES_LOGO.coteMax} px de côté. Idéal : logo carré, clair, sur fond
            transparent ou sombre (l’app est noire et dorée).
          </p>
          {refus && <div className="mt-2"><MessageErreur>{refus}</MessageErreur></div>}
          {choix && (
            <div className="mt-3 space-y-3 rounded-xl bg-nuit-950 p-4 text-white" data-apercu-logo>
              <p className="text-sm font-medium">Aperçu (tel qu’il apparaîtra aux clients)</p>
              <div className="flex items-center gap-4">
                <img src={choix.apercu} alt="Aperçu du logo choisi" className="h-16 w-16 rounded-xl object-contain ring-1 ring-white/20" />
                <img src={choix.apercu} alt="" className="h-28 w-28 rounded-xl object-contain ring-1 ring-white/20" />
                <span className="text-sm text-gray-300">
                  {choix.largeur} × {choix.hauteur} px
                </span>
              </div>
              {choix.fondBlanc && (
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status" data-alerte-fond-blanc>
                  Ce logo a un fond blanc opaque : il apparaîtra comme un carré blanc sur le fond noir de l’app. Si vous l’avez, préférez une version
                  sur fond transparent ou sombre (fichier PNG ou WebP).
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="bouton" onClick={envoyer} disabled={enCours}>
                  {enCours ? 'Envoi…' : 'Utiliser ce logo'}
                </button>
                <button type="button" className="bouton-secondaire" onClick={() => setChoix(null)} disabled={enCours}>
                  Annuler
                </button>
              </div>
            </div>
          )}
          {personnalise && !choix && (
            <button type="button" className="bouton-secondaire mt-3" onClick={revenirAuDefaut} disabled={enCours}>
              Revenir au logo par défaut
            </button>
          )}
          {erreur && <div className="mt-2"><MessageErreur>{erreur}</MessageErreur></div>}
          {message && !erreur && (
            <p className="mt-2 text-sm text-green-700" role="status">
              {message}
            </p>
          )}
        </>
      )}
    </div>
  )
}

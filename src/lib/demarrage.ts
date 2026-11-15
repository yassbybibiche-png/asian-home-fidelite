// Parcours « premiers réglages » (P3-3) : encadré de démarrage de Réglages — 3 vérifications lues sur l'état
// ENREGISTRÉ du commerce (jamais sur le brouillon du formulaire : le jeu tourne sur la config enregistrée).
// Définitions : « lot à gagner » = lot de type 'lot' ou 'points' avec une probabilité > 0 (le secteur 'perdant'
// n'est pas un gain) ; « lot principal » = premier lot PHYSIQUE ('lot') TIRABLE (probabilité > 0) dans l'ordre de
// la roue — c'est lui dont le plafond borne le coût du jeu ; « QR imprimé » = déclaration du commerçant, persistée
// — l'app ne peut pas vérifier une impression papier, l'encadré l'affiche comme une confirmation, pas comme un
// fait mesuré. Logique pure, testable sans navigateur.
import type { Commerce } from '../types'
import { lotsAGagner, normaliserLots } from './lots.ts'
import { lotsJouables } from './roulette.ts'

export type EtatVerification = 'fait' | 'aFaire' | 'sansObjet'

export interface VerificationDemarrage {
  id: 'lots' | 'plafond' | 'qr'
  etat: EtatVerification
  /** Libellé affiché dans tous les cas. */
  libelle: string
  /** Détail affiché quand c'est fait (ou sans objet). */
  detail: string
  /** Aide affichée quand c'est à faire (où corriger). */
  aide?: string
}

export interface EtatDemarrage {
  verifications: VerificationDemarrage[]
  /** Vérifications faites, parmi les applicables. */
  faites: number
  /** Vérifications applicables (hors « sans objet »). */
  applicables: number
}

/** Encadré de démarrage d'un commerce : lots, plafond du lot principal, QR — depuis son état enregistré. */
export function etatDemarrage(commerce: Pick<Commerce, 'lots' | 'qrImprime'>): EtatDemarrage {
  const lots = commerce.lots ?? []
  const gagnables = lotsAGagner(lots)
  // Lot principal = premier lot physique TIRABLE (probabilité > 0) : un lot à 0 % ne sort jamais, son plafond est sans
  // objet — même règle `lotsJouables` que la roue (probabilité absente = 1).
  const principal = lotsJouables(normaliserLots(lots)).find((l) => l.type === 'lot')
  const verifications: VerificationDemarrage[] = [
    gagnables.length > 0
      ? {
          id: 'lots',
          etat: 'fait',
          libelle: 'Au moins un lot à gagner',
          detail: `${gagnables.length} lot${gagnables.length > 1 ? 's' : ''} à gagner sur la roue`,
        }
      : {
          id: 'lots',
          etat: 'aFaire',
          libelle: 'Au moins un lot à gagner',
          detail: '',
          aide: 'Ajoutez un lot dans l’onglet Roulette, avec une probabilité supérieure à 0.',
        },
    !principal
      ? { id: 'plafond', etat: 'sansObjet', libelle: 'Plafond du lot principal', detail: 'Aucun lot physique à gagner : rien à plafonner.' }
      : typeof principal.plafondJour === 'number' && principal.plafondJour > 0
        ? {
            id: 'plafond',
            etat: 'fait',
            libelle: 'Plafond du lot principal',
            detail: `« ${principal.libelle.trim()} » plafonné à ${principal.plafondJour} par jour`,
          }
        : {
            id: 'plafond',
            etat: 'aFaire',
            libelle: 'Plafond du lot principal',
            detail: '',
            aide: `Dans l’onglet Roulette, donnez un plafond par jour à « ${principal.libelle.trim()} » (premier lot physique de la roue) : sans plafond, il peut sortir sans limite.`,
          },
    commerce.qrImprime === true
      ? { id: 'qr', etat: 'fait', libelle: 'QR imprimé et posé en boutique', detail: 'Confirmé par vous.' }
      : {
          id: 'qr',
          etat: 'aFaire',
          libelle: 'QR imprimé et posé en boutique',
          detail: '',
          aide: 'Ouvrez la page QR vitrine, imprimez-la et posez-la en salle : c’est par là que vos clients jouent.',
        },
  ]
  const applicables = verifications.filter((v) => v.etat !== 'sansObjet')
  return { verifications, faites: applicables.filter((v) => v.etat === 'fait').length, applicables: applicables.length }
}

// Règlement du jeu (roue v2, R4) : page publique #/reglement/<commerceId>, générée depuis la configuration du commerce.
// Logique pure (testée sans React), partagée par le serveur (GET /commerces/:id/reglement) et la démo locale.
// Textes sobres et exacts : jamais de promesse de gain, le hasard toujours mentionné, aucune valeur inventée — les
// lots n'ont pas de champ « valeur » : libellés seuls, la valeur étant le prix habituel en boutique.
// Module chargé avec la page différée #/reglement (et par le serveur) : la page de jeu n'en importe rien — elle
// utilise `lotsAGagner` (src/lib/lots.ts) — pour garder ce texte hors du bundle initial (P2-Q2).
import type { Commerce, ModeAccesRoue } from '../types'
import { DUREE_GAIN_JOURS, limiteGainsMois, lotsJouables, modeAccesRoue } from './roulette.ts'
import { lotsAGagner, normaliserLots, type LotAffiche } from './lots.ts'

/** Ce que publie GET /commerces/:id/reglement : rien d'autre que ce que le règlement affiche. */
export interface DonneesReglement {
  commerceId: string
  nom: string
  coordonnees?: string
  actif: boolean
  modeAccesRoue: ModeAccesRoue
  /** Lots physiques gagnés au plus par personne sur 30 jours glissants ; 0 = illimité. */
  limiteGainsMois: number
  /** Lots actifs (types lot / points), plafonnés du jour compris : le règlement décrit la dotation, pas la journée. */
  dotations: LotAffiche[]
  /** Un secteur de la roue ne fait rien gagner. */
  secteurPerdant: boolean
}

export function donneesReglement(c: Commerce): DonneesReglement {
  const jouables = lotsJouables(normaliserLots(c.lots ?? []))
  return {
    commerceId: c.id,
    nom: c.nom,
    ...(c.coordonnees?.trim() ? { coordonnees: c.coordonnees.trim() } : {}),
    actif: c.actif,
    modeAccesRoue: modeAccesRoue(c),
    limiteGainsMois: limiteGainsMois(c),
    dotations: lotsAGagner(c.lots ?? []),
    secteurPerdant: jouables.some((l) => l.type === 'perdant'),
  }
}

/** Une section : paragraphes (texte) et listes à puces (tableau de textes), dans l'ordre. */
export interface SectionReglement {
  titre: string
  contenu: (string | string[])[]
}

/** Texte du règlement (modèle reglement-modele.md), variantes « libre » / « visite » selon le mode d'accès. */
export function reglementDuJeu(d: DonneesReglement): { titre: string; sections: SectionReglement[] } {
  const physiques = d.dotations.filter((l) => l.type === 'lot')
  const points = d.dotations.some((l) => l.type === 'points')
  const organisateur = `Le jeu est organisé par ${d.nom}${d.coordonnees ? ` (${d.coordonnees})` : ''}, ci-après « l’organisateur ».`
  const acces =
    d.modeAccesRoue === 'libre'
      ? 'La participation est ouverte à toute personne cliente ou visiteuse du commerce, sans obligation d’achat.'
      : 'La participation est réservée aux clients du commerce : elle se débloque après une visite validée au comptoir le jour même. L’achat porte uniquement sur les produits ou services du commerce, jamais sur l’accès au jeu, qui reste gratuit.'
  const dotations: (string | string[])[] = [
    'Les lots susceptibles d’être gagnés le jour du tirage sont affichés sur la page du jeu avant le tirage. La dotation comprend :',
    d.dotations.map((l) => (l.type === 'points' ? `${l.libelle} (points de fidélité)` : l.libelle)),
  ]
  if (physiques.length) dotations.push('La valeur d’un lot est son prix de vente habituel dans le commerce.')
  if (points) dotations.push('Certains tirages attribuent des points de fidélité, crédités immédiatement sur la carte du participant.')
  if (d.secteurPerdant) dotations.push('Un tirage peut aussi ne faire gagner aucun lot.')
  dotations.push(
    'L’organisateur peut limiter le nombre de lots d’un même type attribués chaque jour ; un lot dont le quota quotidien est atteint n’est plus proposé ce jour-là. Les lots sont attribués dans la limite des stocks disponibles. Aucun lot ne peut être échangé contre sa valeur en espèces.',
  )
  const utilisation: (string | string[])[] = [
    [
      `Un lot gagné est utilisable à partir du lendemain du tirage et pendant ${DUREE_GAIN_JOURS} jours (dates exactes affichées sur la carte de fidélité du gagnant).`,
      'Pour l’utiliser, le gagnant présente sa carte dans l’application et appuie sur « Utiliser mon gain » : un code à usage unique s’affiche alors pendant 10 minutes. Le lot est remis au comptoir après vérification de ce code.',
      `Passé le délai de ${DUREE_GAIN_JOURS} jours, le gain est définitivement perdu. Un code non présenté pendant ses 10 minutes d’affichage peut être réaffiché depuis la carte tant que le gain est valable.`,
    ],
  ]
  if (d.limiteGainsMois > 0) {
    utilisation.push(
      `Le nombre de lots gagnés par une même personne est limité à ${d.limiteGainsMois} sur 30 jours glissants ; au-delà, le tirage ne peut plus attribuer que des points de fidélité${d.secteurPerdant ? ' ou aucun lot' : ''}.`,
    )
  }
  return {
    titre: `Règlement du jeu « La roue ${d.nom} »`,
    sections: [
      { titre: '1. Organisateur', contenu: [organisateur] },
      { titre: '2. Principe du jeu', contenu: ['Le jeu est une loterie publicitaire gratuite, fondée sur le hasard.', acces] },
      {
        titre: '3. Modalités de participation',
        contenu: [
          [
            'Le participant scanne le QR code affiché dans le commerce (ou ouvre le lien du jeu) et s’identifie avec son numéro de téléphone ou son adresse e-mail.',
            'Un seul tirage par personne et par jour.',
            'Le résultat du tirage est déterminé de manière aléatoire par le serveur au moment du lancer ; il est définitif. Une capture d’écran de la roue ne vaut pas preuve de gain : seul le résultat enregistré et, pour un lot, le code de gain activé dans l’application font foi.',
          ],
        ],
      },
      { titre: '4. Dotations', contenu: dotations },
      { titre: '5. Utilisation d’un gain', contenu: utilisation },
      {
        titre: '6. Avis en ligne',
        contenu: [
          'Le participant peut, s’il le souhaite, laisser un avis sur la fiche publique du commerce. Laisser un avis n’est jamais une condition pour jouer ni pour gagner, et ne modifie ni les chances ni la valeur des lots.',
        ],
      },
      {
        titre: '7. Données personnelles',
        contenu: [
          'Les données collectées (identité de contact, historique des tirages et des gains) servent uniquement au fonctionnement du jeu et du programme de fidélité. Les relances commerciales ne sont envoyées qu’aux personnes qui y ont consenti. Voir la politique de confidentialité du commerce pour le détail (durée de conservation, droits d’accès et de suppression).',
        ],
      },
      {
        titre: '8. Durée et modification',
        contenu: [
          'Le jeu est proposé sans date de fin prédéterminée. L’organisateur peut le modifier ou l’interrompre à tout moment ; les gains déjà attribués restent utilisables jusqu’à leur date d’expiration.',
        ],
      },
      {
        titre: '9. Litiges',
        contenu: ['Toute difficulté d’interprétation du présent règlement est tranchée par l’organisateur, dans le respect du droit de la consommation.'],
      },
    ],
  }
}

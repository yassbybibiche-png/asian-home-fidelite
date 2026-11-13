// Règlement du jeu (roue v2, R4) : page publique #/reglement/<commerceId>, générée depuis la configuration du commerce.
// Logique pure (testée sans React), partagée par le serveur (GET /commerces/:id/reglement) et la démo locale.
// Textes sobres et exacts : jamais de promesse de gain, le hasard toujours mentionné, aucune valeur inventée — les
// lots n'ont pas de champ « valeur » : libellés seuls, la valeur étant le prix habituel en boutique.
// Module chargé avec la page différée #/reglement (et par le serveur) : la page de jeu n'en importe rien — elle
// utilise `lotsAGagner` (src/lib/lots.ts) — pour garder ce texte hors du bundle initial (P2-Q2).
import type { Commerce, CreneauCreux, ModeAccesRoue } from '../types'
import type { Langue } from './langue.ts'
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
  /**
   * Instants gagnants (recommandation R1) : un item par lot à instants (D1), dans l'ordre de la config. Seulement le
   * nombre par jour — jamais les heures tirées ni les plages d'ouverture. Absent si aucun lot n'en a.
   */
  instantsGagnants?: { lot: string; parJour: number }[]
  /** Heures creuses (R1, mécanique D2) : lots réservés aux créneaux et créneaux du commerce. Absent si non configuré. */
  heuresCreuses?: { lots: string[]; creneaux: CreneauCreux[] }
}

export function donneesReglement(c: Commerce): DonneesReglement {
  const normalises = normaliserLots(c.lots ?? [])
  const jouables = lotsJouables(normalises)
  const physiques = normalises.filter((l) => l.type === 'lot')
  const instants = physiques
    .filter((l) => (l.instantsParJour ?? 0) > 0)
    .map((l) => ({ lot: l.libelle.trim(), parJour: l.instantsParJour as number }))
  const creux = physiques.filter((l) => l.heuresCreuses === true).map((l) => l.libelle.trim())
  const creneaux = c.creneauxCreux ?? []
  return {
    commerceId: c.id,
    nom: c.nom,
    ...(c.coordonnees?.trim() ? { coordonnees: c.coordonnees.trim() } : {}),
    actif: c.actif,
    modeAccesRoue: modeAccesRoue(c),
    limiteGainsMois: limiteGainsMois(c),
    dotations: lotsAGagner(c.lots ?? []),
    secteurPerdant: jouables.some((l) => l.type === 'perdant'),
    ...(instants.length ? { instantsGagnants: instants } : {}),
    ...(creneaux.length && creux.length
      ? { heuresCreuses: { lots: creux, creneaux: creneaux.map((cr) => ({ jours: [...cr.jours], debut: cr.debut, fin: cr.fin })) } }
      : {}),
  }
}

const JOURS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const JOURS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Jours d'un créneau triés : suite consécutive (≥ 2), jour seul, ou énumération. */
function joursCreneau(jours: number[], noms: string[], fr: boolean): string {
  const tries = [...new Set(jours)].sort((a, b) => a - b)
  const j = tries.map((n) => noms[n] ?? String(n))
  if (tries.length === 1) return fr ? `le ${j[0]}` : `on ${j[0]}`
  if (tries.every((n, i) => i === 0 || n === tries[i - 1] + 1)) return fr ? `du ${j[0]} au ${j.at(-1)}` : `from ${j[0]} to ${j.at(-1)}`
  const enum_ = `${j.slice(0, -1).join(', ')} ${fr ? 'et' : 'and'} ${j.at(-1)}`
  return fr ? `les ${enum_}` : enum_
}

/** « 15:00 » → « 15 h », « 15:30 » → « 15 h 30 ». */
function heureFr(h: string): string {
  const [hh, mm] = h.split(':')
  return `${Number(hh)} h${mm && mm !== '00' ? ` ${mm}` : ''}`
}

function creneauFr(c: CreneauCreux): string {
  return `${joursCreneau(c.jours, JOURS_FR, true)} de ${heureFr(c.debut)} à ${heureFr(c.fin)}`
}

function creneauEn(c: CreneauCreux): string {
  return `${joursCreneau(c.jours, JOURS_EN, false)} from ${c.debut} to ${c.fin}`
}

/** Une section : paragraphes (texte) et listes à puces (tableau de textes), dans l'ordre. */
export interface SectionReglement {
  titre: string
  contenu: (string | string[])[]
}

export interface TexteReglement {
  titre: string
  sections: SectionReglement[]
}

/**
 * Texte du règlement (modèle reglement-modele.md), variantes « libre » / « visite » selon le mode d'accès, dans la
 * langue du client (revue Codex R4, F3) : la version anglaise reprend les mêmes sections et les mêmes faits ; la
 * version française fait foi. Les libellés des lots (saisis par le commerçant) ne sont pas traduits.
 */
export function reglementDuJeu(d: DonneesReglement, langue: Langue = 'fr'): TexteReglement {
  return langue === 'en' ? reglementAnglais(d) : reglementFrancais(d)
}

function reglementFrancais(d: DonneesReglement): TexteReglement {
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
  for (const i of d.instantsGagnants ?? []) {
    dotations.push(
      `Instants gagnants — chaque jour, ${i.parJour} instants sont tirés au hasard pendant les horaires d’ouverture, sans être annoncés à l’avance : le premier tirage effectué dans les 5 minutes qui suivent l’un de ces instants remporte le lot « ${i.lot} » (un seul lot par instant).`,
    )
  }
  if (d.heuresCreuses) {
    const liste = d.heuresCreuses.creneaux.map(creneauFr).join(' ; ')
    dotations.push(
      `Heures creuses — pendant les créneaux ${liste} (heure de Paris), le lot « ${d.heuresCreuses.lots.join(' », « ')} » entre dans la roue et les points de fidélité attribués en consolation sont doublés.`,
    )
  }
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

/** Même règlement en anglais : section pour section, phrase conditionnelle pour phrase conditionnelle. */
function reglementAnglais(d: DonneesReglement): TexteReglement {
  const physiques = d.dotations.filter((l) => l.type === 'lot')
  const points = d.dotations.some((l) => l.type === 'points')
  const organisateur = `The game is organised by ${d.nom}${d.coordonnees ? ` (${d.coordonnees})` : ''}, hereinafter “the organiser”.`
  const acces =
    d.modeAccesRoue === 'libre'
      ? 'Participation is open to anyone who is a customer of or visitor to the business, with no purchase necessary.'
      : 'Participation is reserved for customers of the business: it is unlocked after a visit validated at the counter on the same day. Purchases only ever concern the products or services of the business, never access to the game, which remains free.'
  const dotations: (string | string[])[] = [
    'The prizes that can be won on the day of the draw are shown on the game page before the draw. The prizes include:',
    d.dotations.map((l) => (l.type === 'points' ? `${l.libelle} (loyalty points)` : l.libelle)),
  ]
  if (physiques.length) dotations.push('The value of a prize is its usual selling price in the business.')
  if (points) dotations.push('Some draws award loyalty points, credited immediately to the participant’s card.')
  if (d.secteurPerdant) dotations.push('A draw may also win no prize at all.')
  dotations.push(
    'The organiser may limit the number of prizes of the same type awarded each day; a prize whose daily quota has been reached is no longer offered that day. Prizes are awarded while stocks last. No prize can be exchanged for its cash value.',
  )
  for (const i of d.instantsGagnants ?? []) {
    dotations.push(
      `Winning moments — each day, ${i.parJour} moments are drawn at random during opening hours, without being announced in advance: the first draw made within 5 minutes after one of these moments wins the prize “${i.lot}” (only one prize per moment).`,
    )
  }
  if (d.heuresCreuses) {
    const liste = d.heuresCreuses.creneaux.map(creneauEn).join(' ; ')
    dotations.push(
      `Off-peak hours — during the slots ${liste} (Paris time), the prize “${d.heuresCreuses.lots.join('”, “')}” joins the wheel and the loyalty points awarded as consolation are doubled.`,
    )
  }
  const utilisation: (string | string[])[] = [
    [
      `A prize won can be used from the day after the draw and for ${DUREE_GAIN_JOURS} days (exact dates shown on the winner’s loyalty card).`,
      'To use it, the winner opens their card in the app and taps “Use my prize”: a single-use code is then displayed for 10 minutes. The prize is handed over at the counter once this code has been checked.',
      `After ${DUREE_GAIN_JOURS} days, the prize is permanently lost. A code not presented during its 10 minutes on screen can be displayed again from the card as long as the prize is still valid.`,
    ],
  ]
  if (d.limiteGainsMois > 0) {
    utilisation.push(
      `The number of prizes won by the same person is limited to ${d.limiteGainsMois} over a rolling 30 days; beyond that, the draw can only award loyalty points${d.secteurPerdant ? ' or no prize' : ''}.`,
    )
  }
  return {
    titre: `Rules of the game “The ${d.nom} wheel”`,
    sections: [
      { titre: '1. Organiser', contenu: [organisateur] },
      { titre: '2. Principle of the game', contenu: ['The game is a free promotional lottery, based on chance.', acces] },
      {
        titre: '3. How to take part',
        contenu: [
          [
            'The participant scans the QR code displayed in the business (or opens the game link) and identifies themselves with their phone number or email address.',
            'Only one draw per person per day.',
            'The result of the draw is determined at random by the server at the moment of the spin; it is final. A screenshot of the wheel is not proof of a win: only the recorded result and, for a prize, the winning code activated in the app are authoritative.',
          ],
        ],
      },
      { titre: '4. Prizes', contenu: dotations },
      { titre: '5. Using a prize', contenu: utilisation },
      {
        titre: '6. Online reviews',
        contenu: [
          'The participant may, if they wish, leave a review on the public listing of the business. Leaving a review is never a condition for playing or winning, and changes neither the odds nor the value of the prizes.',
        ],
      },
      {
        titre: '7. Personal data',
        contenu: [
          'The data collected (contact details, history of draws and prizes) is used solely to run the game and the loyalty programme. Marketing messages are only sent to people who have consented to them. See the business’s privacy policy for details (retention period, rights of access and deletion).',
        ],
      },
      {
        titre: '8. Duration and changes',
        contenu: [
          'The game has no predetermined end date. The organiser may change or stop it at any time; prizes already awarded remain usable until their expiry date.',
        ],
      },
      {
        titre: '9. Disputes',
        contenu: ['Any difficulty in interpreting these rules is settled by the organiser, in compliance with consumer law. In case of discrepancy between versions, the French version prevails.'],
      },
    ],
  }
}

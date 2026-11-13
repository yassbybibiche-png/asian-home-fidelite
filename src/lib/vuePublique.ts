// Vue publique d'un commerce (audit 10/11/2026, F-05 / lot P0-S3) : ce que GET /commerces, /commerces/:id,
// /commerces/:id/menu et /cartes/:id renvoient à tout internaute, sans authentification.
// Liste BLANCHE, champ par champ : un champ ajouté plus tard à `Commerce` n'est jamais publié par défaut.
// Le commerçant reçoit le commerce complet via GET /commerces/:id/etat (PIN ou session).
//
// Retirés : probabilités (et coûts) des lots, `reglesReponseAuto`, `eurosParPoint`, `messagesAuto`, `creeLe`, identifiants du
// catalogue, et tout le programme qui n'est pas affiché au client (relance des inactifs, bienvenue, anniversaire,
// réserve, points du parrain, plafond annuel de parrainage).
// Conservés parce que la carte publique les affiche (CarteFidelite / CartePublique) :
// - catalogue : nom + coût en points + description — le client voit ce qu'il peut échanger, c'est l'offre elle-même ;
// - programme : uniquement paliers, niveaux, défi (actif), offre de la semaine, parrainage (points du filleul) et
//   rattrapage, avec les valeurs EFFECTIVES (défauts appliqués ici) : sans elles, le front appliquerait ses propres
//   défauts et afficherait au client des paliers ou offres que le commerce n'a peut-être pas.
import type { Commerce, CommercePublic, ProgrammePublic } from '../types'
import { configDefi, configNiveaux, configOffreHebdo, configPaliers, configParrainage, configRattrapage } from './programme.ts'
import { lotsJouables, modeAccesRoue } from './roulette.ts'
import { normaliserLots } from './lots.ts'
import { dureeConservationMois } from './rgpd.ts'

export function programmePublic(c: Pick<Commerce, 'programme' | 'seuilTampons'>): ProgrammePublic {
  const parrainage = configParrainage(c)
  return {
    paliers: configPaliers(c),
    parrainage: { actif: parrainage.actif, pointsFilleul: parrainage.pointsFilleul },
    defi: { actif: configDefi(c).actif },
    niveaux: configNiveaux(c),
    offreHebdo: configOffreHebdo(c),
    rattrapage: configRattrapage(c),
  }
}

/**
 * `plafonnes` (R2) : ids des lots physiques ayant atteint leur plafond du jour (`lotsPlafonnes`, calculé par le
 * serveur) — retirés de la roue et de la liste « À gagner aujourd'hui » jusqu'au lendemain.
 * `creux` (D2) : un créneau heures creuses est en cours (`creneauActif`, calculé par le serveur) — les lots
 * `heuresCreuses` sont publiés et `bonusCreux` est posé ; hors créneau, ces lots sont absents comme un lot à 0 %.
 * `menuDisponible` (Déblocage C-bis) : le menu public a au moins un produit — seule GET /commerces/:id le calcule.
 * `commandeActive` (Expérience 10/10) : module commande à table activé avec au moins une table.
 */
export function commercePublic(c: Commerce, plafonnes: ReadonlySet<string> = new Set(), creux = false, menuDisponible = false): CommercePublic {
  const { couleur, fond, banniere } = c.apparence ?? {}
  return {
    id: c.id,
    nom: c.nom,
    type: c.type,
    ...(c.logo !== undefined ? { logo: c.logo } : {}),
    lienGoogle: c.lienGoogle,
    ...(c.coordonnees !== undefined ? { coordonnees: c.coordonnees } : {}),
    // Liens de commande (P1-C5) : publiés seulement s'ils sont renseignés (le menu public affiche alors le bouton).
    ...(c.lienDeliveroo ? { lienDeliveroo: c.lienDeliveroo } : {}),
    ...(c.lienUberEats ? { lienUberEats: c.lienUberEats } : {}),
    recompense: c.recompense,
    seuilTampons: c.seuilTampons,
    // Jouables seulement (un lot à 0 % n'apparaît pas sur la roue), dans l'ordre : la roue publique a des secteurs égaux.
    // R1 : id (la roue retrouve le lot tiré par son id, jamais par son libellé) + type résolu (consolation affichée
    // comme telle). Jamais la probabilité, ni le coût, ni le montant de points (liste blanche, audit F-05).
    // R2 : jamais le plafond ni la limite de gains — seulement l'absence des lots plafonnés aujourd'hui.
    lots: lotsJouables(normaliserLots(c.lots))
      .filter((l) => !plafonnes.has(l.id) && (creux || !l.heuresCreuses))
      .map((l) => ({ id: l.id, libelle: l.libelle, type: l.type })),
    // R4 : mode d'accès effectif (défaut appliqué) — la page de jeu et le règlement l'annoncent au client.
    modeAccesRoue: modeAccesRoue(c),
    // D2 : seulement l'indicateur « créneau en cours » — jamais les créneaux eux-mêmes ni le drapeau des lots.
    ...(creux ? { bonusCreux: true as const } : {}),
    // Déblocage C-bis : seulement « le menu a au moins un produit » (calculé par la route qui a lu le menu).
    ...(menuDisponible ? { menuDisponible: true as const } : {}),
    // Commande à table : seulement « activée avec au moins une table » — jamais les tables ni leurs jetons.
    ...(c.commande?.active && c.commande.tables.length ? { commandeActive: true as const } : {}),
    actif: c.actif,
    demo: !!c.demo,
    ...(c.catalogue ? { catalogue: c.catalogue.map((r) => ({ nom: r.nom, cout: r.cout, ...(r.description ? { description: r.description } : {}) })) } : {}),
    // Couleurs et bannière seulement (`Apparence` ne contient rien d'autre aujourd'hui ; un ajout futur resterait privé).
    ...(c.apparence ? { apparence: { ...(couleur ? { couleur } : {}), ...(fond ? { fond } : {}), ...(banniere ? { banniere } : {}) } } : {}),
    programme: programmePublic(c),
    // Durée de conservation effective (P1-B6) : publiée sur la page de confidentialité.
    conservationMois: dureeConservationMois(c),
    // Test A/B « accroche » (P2-Q3) : seulement l'indicateur « en cours » ; jamais les dates ni les coûts des lots.
    ...(c.testsAB?.accroche?.actif ? { testAccroche: true as const } : {}),
  }
}

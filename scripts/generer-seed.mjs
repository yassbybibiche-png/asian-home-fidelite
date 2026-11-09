// Génère src/data/seed.json : 3 commerces démo (restaurant, salon, boutique).
// Déterministe (graine fixe) : relancer le script donne toujours le même fichier.
// Les dates sont calculées par rapport à DATE_REFERENCE ; l'app les décale au
// chargement pour que la démo paraisse toujours « récente ».
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DATE_REFERENCE = '2026-11-09T12:00:00.000Z'
const REF = new Date(DATE_REFERENCE).getTime()
const JOUR = 24 * 60 * 60 * 1000

let graine = 20261109
function alea() {
  graine |= 0
  graine = (graine + 0x6d2b79f5) | 0
  let t = Math.imul(graine ^ (graine >>> 15), 1 | graine)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const entre = (min, max) => Math.floor(alea() * (max - min + 1)) + min
const choisir = (liste) => liste[Math.floor(alea() * liste.length)]

/**
 * Date ISO il y a `jours` jours, à une heure plausible (heure de Paris, UTC+1 en novembre).
 * `creneaux` : plages d'ouverture [heureMin, heureMax]. Jamais dans le futur.
 */
function ilYa(jours, creneaux = [[9, 19]]) {
  const [heureMin, heureMax] = choisir(creneaux)
  const d = new Date(REF - jours * JOUR)
  d.setUTCHours(entre(heureMin, heureMax) - 1, entre(0, 59), 0, 0)
  if (d.getTime() > REF) return new Date(REF - entre(10, 120) * 60 * 1000).toISOString()
  return d.toISOString()
}

// Asian Home Paris : service du midi et du soir (11h30-14h30, 18h30-23h30).
const HORAIRES = {
  'c-asian-home-paris': [
    [12, 13],
    [19, 22],
  ],
  'c-atelier-camille': [[9, 18]],
  'c-maison-lila': [[10, 18]],
}

const commerces = [
  {
    // Commerce vitrine : vraies coordonnées publiques (vérifiées le 09/11/2026).
    // Clients, avis et tirages restent FICTIFS (démo).
    id: 'c-asian-home-paris',
    nom: 'Asian Home Paris',
    type: 'restaurant',
    logo: '',
    // Lien de recherche Google Maps (public). Le vrai lien « laisser un avis » s'obtient
    // depuis la fiche Google Business Profile du restaurant.
    lienGoogle: 'https://www.google.com/maps/search/?api=1&query=Asian+Home+Paris+11+rue+Andr%C3%A9+Joineau+Le+Pr%C3%A9-Saint-Gervais',
    coordonnees:
      '11 rue André Joineau, 93310 Le Pré-Saint-Gervais · 07 82 97 48 01 · Instagram @asianhomeparis · Tous les jours 11h30-14h30 et 18h30-23h30 · Halal',
    recompense: 'Un plat offert au 10e repas',
    seuilTampons: 10,
    lots: [
      { libelle: 'Nems offerts', probabilite: 20 },
      { libelle: 'Thé glacé maison offert', probabilite: 25 },
      { libelle: 'Mochi offert', probabilite: 15 },
      { libelle: '-10 % sur l’addition', probabilite: 10 },
      { libelle: 'Pas de chance, à la prochaine !', probabilite: 30 },
    ],
    reglesReponseAuto: { auto5Etoiles: true, auto4Etoiles: false, brouillonAutres: true },
    actif: true,
    creeLe: ilYa(210),
  },
  {
    id: 'c-atelier-camille',
    nom: 'Atelier Coiff’ Camille',
    type: 'salon',
    logo: '',
    lienGoogle: 'https://g.page/r/demo-atelier-coiff-camille/review',
    recompense: '-20 % sur la 8e prestation',
    seuilTampons: 8,
    lots: [
      { libelle: 'Soin profond offert', probabilite: 15 },
      { libelle: '-10 % sur la prochaine coupe', probabilite: 30 },
      { libelle: 'Shampoing format voyage offert', probabilite: 25 },
      { libelle: 'Pas de chance, à la prochaine !', probabilite: 30 },
    ],
    reglesReponseAuto: { auto5Etoiles: true, auto4Etoiles: true, brouillonAutres: true },
    actif: true,
    creeLe: ilYa(150),
  },
  {
    id: 'c-maison-lila',
    nom: 'Maison Lila',
    type: 'boutique',
    logo: '',
    lienGoogle: 'https://g.page/r/demo-maison-lila/review',
    recompense: 'Bon d’achat de 15 € après 6 achats',
    seuilTampons: 6,
    lots: [
      { libelle: '-15 % sur un article', probabilite: 10 },
      { libelle: 'Tote bag offert', probabilite: 20 },
      { libelle: 'Emballage cadeau offert', probabilite: 30 },
      { libelle: '-5 % sur le prochain achat', probabilite: 40 },
    ],
    reglesReponseAuto: { auto5Etoiles: false, auto4Etoiles: false, brouillonAutres: true },
    actif: true,
    creeLe: ilYa(95),
  },
]

const prenomsParCommerce = {
  'c-asian-home-paris': ['Karim', 'Sophie', 'Linh', 'Nathalie', 'Thomas', 'Aïcha', 'Mehdi', 'Isabelle', 'Kevin', 'Chloé', 'Samir', 'Inès'],
  'c-atelier-camille': ['Manon', 'Sarah', 'Émilie', 'Yasmine', 'Lucas', 'Camille', 'Aurélie', 'Nadia', 'Hugo', 'Margaux'],
  'c-maison-lila': ['Claire', 'Élodie', 'Fatima', 'Pauline', 'Marc', 'Juliette', 'Sandrine', 'Océane', 'Romain'],
}

const domaines = ['gmail.com', 'orange.fr', 'free.fr', 'hotmail.fr', 'laposte.net']
const sansAccent = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const clients = []
for (const commerce of commerces) {
  prenomsParCommerce[commerce.id].forEach((prenom, i) => {
    // Profils variés : habitués, occasionnels, clients perdus de vue (> 30 j).
    const profil = i % 4 === 3 ? 'inactif' : i % 3 === 0 ? 'habitue' : 'occasionnel'
    // Le 1er habitué de chaque commerce a une carte pleine : la récompense l'attend (démo du bouton « Offrir »).
    const cartePleine = i === 0
    const seuil = commerce.seuilTampons
    const nbVisites = cartePleine ? seuil : profil === 'habitue' ? entre(7, 16) : profil === 'occasionnel' ? entre(2, 6) : entre(1, 4)
    const derniere = profil === 'inactif' ? entre(35, 90) : entre(0, 20)
    const premiere = derniere + entre(nbVisites * 5, nbVisites * 9 + 10)
    const jours = new Set(nbVisites === 1 ? [derniere] : [derniere, premiere])
    while (jours.size < nbVisites) jours.add(entre(derniere, premiere))
    // Ordre chronologique (du plus ancien au plus récent), comme dans l'app.
    const visites = [...jours].sort((a, b) => b - a).map((j) => ilYa(j, HORAIRES[commerce.id]))
    // Mêmes règles que l'app : 1 visite = 1 tampon ; offrir la récompense retire seuil tampons (excédent reporté).
    // Récompense remise à la visite suivante celle qui a rempli la carte (ce tampon-là passe sur la nouvelle carte).
    const cyclesOfferts = cartePleine ? 0 : Math.floor((visites.length - 1) / seuil)
    const recompensesOffertes = Array.from({ length: cyclesOfferts }, (_, k) => ({ date: visites[(k + 1) * seuil], libelle: commerce.recompense }))
    const tampons = visites.length - cyclesOfferts * seuil
    const parEmail = i % 2 === 1
    clients.push({
      id: `${commerce.id}-cl-${i + 1}`,
      commerceId: commerce.id,
      prenom,
      telephone: parEmail ? undefined : `06 ${entre(10, 99)} ${entre(10, 99)} ${entre(10, 99)} ${entre(10, 99)}`,
      email: parEmail ? `${sansAccent(prenom)}.${entre(10, 99)}@${choisir(domaines)}` : undefined,
      tampons,
      visites,
      derniereVisite: visites[visites.length - 1],
      creeLe: visites[0],
      ...(recompensesOffertes.length ? { recompensesOffertes } : {}),
    })
  })
}

const avisParCommerce = {
  // Avis FICTIFS (démo) : aucun n'est tiré de la vraie fiche Google du restaurant.
  'c-asian-home-paris': [
    ['Sophie M.', 5, 'Pad thaï et bo bun excellents, portions généreuses. Service rapide et souriant.', 2, 'Merci beaucoup Sophie ! Toute l’équipe d’Asian Home est ravie, à très bientôt.'],
    ['Karim B.', 5, 'Enfin un asiatique halal avec autant de choix. La carte de fidélité sur le téléphone, c’est top.', 6],
    ['Nathalie R.', 4, 'Très bon repas, un peu d’attente le vendredi soir mais ça valait le coup.', 9, 'Merci Nathalie, on renforce l’équipe le week-end. Au plaisir de vous revoir !'],
    ['Jean-Pierre L.', 2, 'Commande à emporter prête avec 20 minutes de retard, nems un peu tièdes.', 14],
    ['Laura T.', 5, '', 21],
    ['Mathieu D.', 4, 'Bon rapport qualité-prix, les sushis sont frais.', 33, 'Merci Mathieu, à bientôt !'],
    ['Agnès P.', 5, 'Le mochi gagné à la roulette était délicieux 😄', 44],
  ],
  'c-atelier-camille': [
    ['Manon G.', 5, 'Camille a parfaitement compris ce que je voulais. Je ressors ravie !', 1],
    ['Yasmine K.', 5, 'Accueil chaleureux, balayage réussi, je recommande.', 8, 'Merci Yasmine, ce fut un plaisir !'],
    ['Lucas F.', 3, 'Coupe correcte mais rendez-vous décalé de 20 minutes.', 12],
    ['Delphine A.', 5, '', 19],
    ['Hélène V.', 4, 'Très professionnelle, prix un peu élevés mais qualité au rendez-vous.', 27, 'Merci Hélène pour votre retour et votre fidélité.'],
    ['Romane C.', 1, 'Couleur pas du tout conforme à ce que j’avais demandé.', 40],
  ],
  'c-maison-lila': [
    ['Claire B.', 5, 'Boutique adorable, plein d’idées cadeaux et conseils au top.', 3],
    ['Pauline S.', 4, 'Jolie sélection de vêtements, j’aurais aimé plus de tailles.', 10],
    ['Bertrand M.', 5, 'Emballage cadeau soigné, ma femme a adoré.', 16, 'Merci Bertrand, ravies que le cadeau ait plu !'],
    ['Océane L.', 5, '', 23],
    ['Sylvie R.', 2, 'Article échangé difficilement, accueil un peu froid ce jour-là.', 31],
  ],
}

const avis = []
for (const commerce of commerces) {
  avisParCommerce[commerce.id].forEach(([auteur, note, texte, jours, reponse], i) => {
    avis.push({
      id: `${commerce.id}-av-${i + 1}`,
      commerceId: commerce.id,
      auteur,
      note,
      texte,
      date: ilYa(jours, [[10, 22]]),
      ...(reponse ? { reponse } : {}),
    })
  })
}

/** Lot tiré selon les mêmes probabilités que l'app. */
function lotPondere(lots) {
  let seuil = alea() * lots.reduce((s, l) => s + l.probabilite, 0)
  for (const l of lots) if ((seuil -= l.probabilite) < 0) return l.libelle
  return lots[lots.length - 1].libelle
}

// Un tirage a lieu pendant une visite (le client scanne le QR sur place), 1 max par client et par jour,
// quelques minutes après la visite validée.
const tirages = []
for (const commerce of commerces) {
  const visitesRecentes = clients
    .filter((c) => c.commerceId === commerce.id)
    .flatMap((c) => c.visites.map((v) => ({ clientId: c.id, date: v })))
    .filter((v) => REF - new Date(v.date).getTime() <= 25 * JOUR)
  const nb = Math.min(entre(4, 7), visitesRecentes.length)
  const deja = new Set()
  while (tirages.filter((t) => t.commerceId === commerce.id).length < nb) {
    const v = choisir(visitesRecentes)
    const cle = `${v.clientId}|${v.date.slice(0, 10)}`
    if (deja.has(cle)) continue
    deja.add(cle)
    const date = Math.min(new Date(v.date).getTime() + entre(2, 40) * 60 * 1000, REF - 60 * 1000)
    tirages.push({
      id: `${commerce.id}-ti-${deja.size}`,
      commerceId: commerce.id,
      clientId: v.clientId,
      lot: lotPondere(commerce.lots),
      date: new Date(date).toISOString(),
    })
  }
}
tirages.sort((a, b) => b.date.localeCompare(a.date))

const sortie = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'seed.json')
mkdirSync(dirname(sortie), { recursive: true })
writeFileSync(sortie, JSON.stringify({ dateReference: DATE_REFERENCE, commerces, clients, tirages, avis }, null, 2) + '\n')
console.log(`seed.json : ${commerces.length} commerces, ${clients.length} clients, ${avis.length} avis, ${tirages.length} tirages`)

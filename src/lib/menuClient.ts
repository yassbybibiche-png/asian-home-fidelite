// Menu public côté client (lot P1-C5) : badges, catégorie active, bandeau « Menu Midi », boutons de contact.
// Logique pure, testée (tests/menu-client-p1-c5.test.ts) ; la page est src/pages/MenuPublic.tsx.
import type { CategorieMenu, Commerce, Produit } from '../types'
import { sansAccents } from './recherche.ts'
import { VISUELS } from './visuels.ts'

// ---------- Menu visuel : photo des grandes cartes, mouvement réduit ----------

/** Photo affichée sur la grande carte d'un plat : la fiche du plat, sauf le Loc Lac dont le
    JPEG (156 Ko) a une variante WebP légère (le détail déplié garde la fiche d'origine). */
export function photoCartePlat(p: Pick<Produit, 'photo'>): string | undefined {
  if (!p.photo) return undefined
  return p.photo === VISUELS.menuLocLac ? VISUELS.menuLocLacPetit : p.photo
}

/** Mouvement réduit demandé par l'appareil (défilements doux désactivés). */
export function prefereMouvementReduit(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

// ---------- Badges « épicé » / « végétarien » ----------
// La carte officielle ne marque aucun plat épicé ni végétarien : ces badges sont DÉDUITS des mots du nom ou de la
// description (rien d'autre), et toujours affichés « à confirmer ». Règles volontairement étroites :
// - « Épicé » : le texte dit épicé / épicée, spicy, pimenté, ou cite la sauce dynamite (décrite « légèrement épicée »
//   par la carte) ;
// - « Option épicée » : l'épicé n'est qu'un choix (« cru ou épicé », « saumon épicé » parmi les bases au choix) ;
// - « Végétarien » : le nom dit « veggie » / « végétarien » ; « Option végétarienne » : « … ou légume(s) ».
// Pas de déduction depuis une liste d'ingrédients (une sauce, un bouillon peuvent contenir viande ou poisson).

export type Badge = 'epice' | 'optionEpicee' | 'vegetarien' | 'optionVegetarienne'

export const LIBELLES_BADGES: Record<Badge, string> = {
  epice: '🌶 Épicé',
  optionEpicee: '🌶 Option épicée',
  vegetarien: '🌱 Végétarien',
  optionVegetarienne: '🌱 Option végétarienne',
}

/** Mention affichée avec chaque badge déduit. */
export const MENTION_BADGE_DEDUIT = 'à confirmer'

export function badgesPlat(produit: Pick<Produit, 'nom' | 'description'>): Badge[] {
  const nom = sansAccents(produit.nom)
  const texte = `${nom} ${sansAccents(produit.description ?? '')}`
  const badges: Badge[] = []
  if (/\bou epice|\b(?:saumon|thon|poulet|boeuf) epice/.test(texte)) badges.push('optionEpicee')
  else if (/\bepicee?s?\b|\bspicy\b|\bpimente|\bdynamite\b/.test(texte)) badges.push('epice')
  if (/\bveggie\b|\bvegetarien/.test(nom)) badges.push('vegetarien')
  else if (/\bou legumes?\b/.test(texte)) badges.push('optionVegetarienne')
  return badges
}

// ---------- Catégories en onglets ----------

/**
 * Catégorie réellement affichée : celle choisie si elle a encore des plats après la recherche, sinon « toutes ».
 * La recherche ne réinitialise donc pas le choix : effacer la saisie ramène l'onglet choisi.
 */
export function categorieEffective(categories: Pick<CategorieMenu, 'id'>[], choisie: string): string {
  return choisie !== 'toutes' && categories.some((c) => c.id === choisie) ? choisie : 'toutes'
}

// ---------- Bandeau « Menu Midi » ----------

const JOURS_OUVRES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
/** Créneau du midi, en minutes depuis minuit (heure de Paris) : 11h30 inclus → 14h30 exclu. */
export const CRENEAU_MIDI = { debut: 11 * 60 + 30, fin: 14 * 60 + 30 }

/** Vrai du lundi au vendredi, de 11h30 à 14h30 (14h30 exclu), heure de Paris — quel que soit le fuseau de l'appareil. */
export function estHeureMenuMidi(date: Date): boolean {
  const parties = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const val = (t: string) => parties.find((p) => p.type === t)?.value ?? ''
  const minutes = Number(val('hour')) * 60 + Number(val('minute'))
  return JOURS_OUVRES.includes(val('weekday')) && minutes >= CRENEAU_MIDI.debut && minutes < CRENEAU_MIDI.fin
}

/** Catégorie des formules midi (nom contenant « menu midi » ou « formule(s) midi »), ou null. */
export function categorieMidi<C extends Pick<CategorieMenu, 'nom'>>(categories: C[]): C | null {
  return categories.find((c) => /\b(?:menu|formules?) midi\b/.test(sansAccents(c.nom))) ?? null
}

// ---------- Boutons : appeler, itinéraire, Instagram, commander ----------

/** Coordonnées vérifiées d'Asian Home Paris (seed, docs/MENU-OFFICIEL-2026-11-10.md, DA Instagram). */
export const CONTACT_ASIAN_HOME = {
  telephone: '+33782974801',
  adresse: '11 rue André Joineau, 93310 Le Pré-Saint-Gervais',
  instagram: 'asianhomeparis',
} as const

export interface BoutonMenu {
  id: 'appeler' | 'itineraire' | 'instagram' | 'deliveroo' | 'uberEats'
  libelle: string
  href: string
  /** Lien externe : nouvel onglet. */
  externe: boolean
}

/** Lien Google Maps « itinéraire » vers une adresse (aucune coordonnée GPS inventée). */
export const lienItineraire = (adresse: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(adresse)}`

/** Lien de commande utilisable : https uniquement, sinon ignoré (jamais affiché). */
const lienCommande = (v: string | undefined) => {
  const s = v?.trim() ?? ''
  return /^https:\/\/\S+$/i.test(s) ? s : ''
}

/**
 * Boutons du menu public. Appeler / itinéraire / Instagram : seulement pour Asian Home (coordonnées vérifiées).
 * Deliveroo / Uber Eats : seulement si le commerçant a renseigné le lien dans ses réglages — jamais de lien inventé.
 */
export function boutonsMenu(commerce: Pick<Commerce, 'lienDeliveroo' | 'lienUberEats'>, asianHome: boolean): BoutonMenu[] {
  const boutons: BoutonMenu[] = []
  if (asianHome) {
    boutons.push(
      { id: 'appeler', libelle: '📞 Appeler', href: `tel:${CONTACT_ASIAN_HOME.telephone}`, externe: false },
      { id: 'itineraire', libelle: '📍 Itinéraire', href: lienItineraire(CONTACT_ASIAN_HOME.adresse), externe: true },
      { id: 'instagram', libelle: `📸 @${CONTACT_ASIAN_HOME.instagram}`, href: `https://www.instagram.com/${CONTACT_ASIAN_HOME.instagram}/`, externe: true },
    )
  }
  const deliveroo = lienCommande(commerce.lienDeliveroo)
  const uberEats = lienCommande(commerce.lienUberEats)
  if (deliveroo) boutons.push({ id: 'deliveroo', libelle: '🛵 Commander sur Deliveroo', href: deliveroo, externe: true })
  if (uberEats) boutons.push({ id: 'uberEats', libelle: '🛵 Commander sur Uber Eats', href: uberEats, externe: true })
  return boutons
}

// Logique pure de la carte de fidélité (aucune dépendance React : testable seule).
import type { Client, Commerce } from '../types'

export type Contact = { telephone: string; email?: undefined } | { email: string; telephone?: undefined }

/** « 06 12 34 56 78 », « +33 6… » ou « marie@exemple.fr » → contact ; sinon null. */
export function analyserContact(saisie: string): Contact | null {
  const s = saisie.trim()
  if (s.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? { email: s.toLowerCase() } : null
  const chiffres = s.replace(/\D/g, '')
  return chiffres.length >= 10 && chiffres.length <= 13 && /^[+\d][\d\s.\-()]*$/.test(s) ? { telephone: s } : null
}

/**
 * Clé de comparaison : chiffres seuls, tout numéro français ramené à « 06… »
 * (+33 6…, 0033 6…, +33 (0)6…) ; autres numéros inchangés ; e-mail en minuscules.
 */
export function cleContact(c: { telephone?: string; email?: string }): string {
  if (c.email) return c.email.trim().toLowerCase()
  const chiffres = (c.telephone ?? '').replace(/\D/g, '')
  const francais = /^(?:00)?330?(\d{9})$/.exec(chiffres)
  return francais ? `0${francais[1]}` : chiffres
}

export function trouverClientParContact(clients: Client[], commerceId: string, contact: Contact): Client | undefined {
  const cle = cleContact(contact)
  return clients.find(
    (c) =>
      c.commerceId === commerceId &&
      ((!!c.email && cleContact({ email: c.email }) === cle) || (!!c.telephone && cleContact({ telephone: c.telephone }) === cle)),
  )
}

/**
 * Identifiant de carte (P0-S7) : `cl-` + UUID v4 aléatoire (122 bits, `crypto`), impossible à deviner. Remplace
 * l'ancien `cl-<horodatage base36>-<4 caractères>` (prévisible), encore porté par les cartes créées avant P0-S7.
 */
export function nouvelIdClient(): string {
  const c = globalThis.crypto
  // randomUUID manque hors contexte sécurisé (démo locale servie en http:// sur le réseau) : même UUID v4 à la main.
  if (typeof c.randomUUID === 'function') return `cl-${c.randomUUID()}`
  const o = c.getRandomValues(new Uint8Array(16))
  o[6] = (o[6] & 0x0f) | 0x40
  o[8] = (o[8] & 0x3f) | 0x80
  const h = Array.from(o, (x) => x.toString(16).padStart(2, '0')).join('')
  return `cl-${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const ID_CLIENT_ACTUEL = /^cl-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Carte créée avec un identifiant imprévisible (P0-S7) ; sinon : ancien identifiant, soumis à la période de grâce. */
export function estIdClientActuel(id: string): boolean {
  return ID_CLIENT_ACTUEL.test(id)
}

export function nouveauClient(commerceId: string, prenom: string, contact: Contact, maintenant = new Date()): Client {
  const iso = maintenant.toISOString()
  return {
    id: nouvelIdClient(),
    commerceId,
    prenom: prenom.trim(),
    ...contact,
    tampons: 0,
    visites: [],
    // Pas encore de visite validée : ni actif, ni à relancer (cf. stats.ts).
    derniereVisite: null,
    creeLe: iso,
  }
}

export function tamponsAffiches(client: Client, commerce: Pick<Commerce, 'seuilTampons'>): number {
  return Math.min(client.tampons, commerce.seuilTampons)
}

export function recompenseDebloquee(client: Client, commerce: Pick<Commerce, 'seuilTampons'>): boolean {
  return client.tampons >= commerce.seuilTampons
}

/**
 * 1 visite = 1 tampon, jamais plafonné : au-delà du seuil, l'excédent sera reporté sur la carte
 * suivante quand la récompense sera offerte (seul l'affichage est plafonné, cf. tamponsAffiches).
 * Visite rejouée hors ligne (plus ancienne que la dernière) : l'historique reste chronologique et la
 * dernière visite ne recule pas (même règle que appliquerRattrapageValide).
 */
export function validerVisite(client: Client, _commerce: Commerce, maintenant = new Date()): Client {
  const iso = maintenant.toISOString()
  const derniereVisite = client.derniereVisite && new Date(client.derniereVisite).getTime() > maintenant.getTime() ? client.derniereVisite : iso
  return {
    ...client,
    tampons: client.tampons + 1,
    visites: [...client.visites, iso].sort(),
    derniereVisite,
  }
}

/**
 * Consomme une carte (seuil tampons) et garde la trace de la récompense remise. Les tampons
 * excédentaires restent sur la nouvelle carte (encore débloquée s'il en reste au moins seuil).
 */
export function offrirRecompense(client: Client, commerce: Commerce, maintenant = new Date()): Client {
  if (!recompenseDebloquee(client, commerce)) return client
  return {
    ...client,
    tampons: client.tampons - commerce.seuilTampons,
    recompensesOffertes: [...(client.recompensesOffertes ?? []), { date: maintenant.toISOString(), libelle: commerce.recompense }],
  }
}

export function messageRelance(client: Client, commerce: Commerce): string {
  const restants = commerce.seuilTampons - tamponsAffiches(client, commerce)
  const progression =
    restants <= 0
      ? `Bonne nouvelle : votre récompense vous attend (${commerce.recompense}).`
      : `Il ne vous manque plus que ${restants} tampon${restants > 1 ? 's' : ''} pour : ${commerce.recompense}.`
  // Prénom optionnel (P1-C1) : « Bonjour, ça fait… » sans prénom.
  return `Bonjour${client.prenom?.trim() ? ` ${client.prenom.trim()}` : ''}, ça fait un moment qu’on ne vous a pas vu chez ${commerce.nom} ! ${progression} Au plaisir de vous revoir très vite.`
}

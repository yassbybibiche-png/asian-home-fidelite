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

export function nouveauClient(commerceId: string, prenom: string, contact: Contact, maintenant = new Date()): Client {
  const iso = maintenant.toISOString()
  return {
    id: `cl-${maintenant.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
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
 */
export function validerVisite(client: Client, _commerce: Commerce, maintenant = new Date()): Client {
  const iso = maintenant.toISOString()
  return {
    ...client,
    tampons: client.tampons + 1,
    visites: [...client.visites, iso],
    derniereVisite: iso,
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

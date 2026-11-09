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

/** Clé de comparaison : chiffres seuls, +33 6… → 06…, e-mail en minuscules. */
export function cleContact(c: { telephone?: string; email?: string }): string {
  if (c.email) return c.email.trim().toLowerCase()
  const chiffres = (c.telephone ?? '').replace(/\D/g, '')
  return chiffres.startsWith('33') && chiffres.length === 11 ? `0${chiffres.slice(2)}` : chiffres
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
    // Pas encore de visite validée : la date d'inscription sert de point de départ pour les relances.
    derniereVisite: iso,
    creeLe: iso,
  }
}

export function tamponsAffiches(client: Client, commerce: Commerce): number {
  return Math.min(client.tampons, commerce.seuilTampons)
}

export function recompenseDebloquee(client: Client, commerce: Commerce): boolean {
  return client.tampons >= commerce.seuilTampons
}

/** +1 tampon (plafonné au seuil tant que la récompense n'est pas offerte) et la visite est enregistrée. */
export function validerVisite(client: Client, commerce: Commerce, maintenant = new Date()): Client {
  const iso = maintenant.toISOString()
  return {
    ...client,
    tampons: Math.min(client.tampons + 1, commerce.seuilTampons),
    visites: [...client.visites, iso],
    derniereVisite: iso,
  }
}

/** Remet la carte à zéro et garde la trace de la récompense remise. */
export function offrirRecompense(client: Client, commerce: Commerce, maintenant = new Date()): Client {
  if (!recompenseDebloquee(client, commerce)) return client
  return {
    ...client,
    tampons: 0,
    recompensesOffertes: [...(client.recompensesOffertes ?? []), { date: maintenant.toISOString(), libelle: commerce.recompense }],
  }
}

export function messageRelance(client: Client, commerce: Commerce): string {
  const restants = commerce.seuilTampons - tamponsAffiches(client, commerce)
  const progression =
    restants <= 0
      ? `Bonne nouvelle : votre récompense vous attend (${commerce.recompense}).`
      : `Il ne vous manque plus que ${restants} tampon${restants > 1 ? 's' : ''} pour : ${commerce.recompense}.`
  return `Bonjour ${client.prenom}, ça fait un moment qu’on ne vous a pas vu chez ${commerce.nom} ! ${progression} Au plaisir de vous revoir très vite.`
}

// Recherche dans la liste des clients (logique pure, testée).
import type { Client } from '../types'

/** Minuscules sans accents : « Hélène » → « helene ». */
export function sansAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/**
 * Chiffres d'un numéro saisi, ramenés au format « 06… » comme `cleContact`, même partiels :
 * « +33 6 12 », « 0033 (0)6 12 », « 06.12-34 » → « 0612… ». Null si la saisie n'est pas un numéro.
 */
export function chiffresRecherche(saisie: string): string | null {
  const s = saisie.trim()
  if (!/^[+\d][\d\s.\-()/]*$/.test(s)) return null
  const chiffres = s.replace(/\D/g, '')
  if (!chiffres) return null
  // Indicatif français tapé explicitement (+33 / 0033), avec ou sans le 0 entre parenthèses.
  const indicatif = /^(?:\+|00)\s*33/.test(s) ? /^(?:00)?330?(\d*)$/.exec(chiffres) : null
  return indicatif ? `0${indicatif[1]}` : chiffres
}

/** Chiffres d'un numéro enregistré, au format « 06… » (même règle que `cleContact`). */
function chiffresClient(telephone: string): string {
  const chiffres = telephone.replace(/\D/g, '')
  const francais = /^(?:00)?330?(\d{9})$/.exec(chiffres)
  return francais ? `0${francais[1]}` : chiffres
}

/**
 * Vrai si le client correspond à la recherche : prénom insensible aux accents et à la casse,
 * e-mail en minuscules, téléphone quel que soit le format (espaces, points, tirets, +33, 0033).
 */
export function correspondRecherche(client: Pick<Client, 'prenom' | 'telephone' | 'email'>, saisie: string): boolean {
  const q = saisie.trim()
  if (!q) return true
  const texte = sansAccents(q)
  if (sansAccents(client.prenom).includes(texte)) return true
  if (client.email?.toLowerCase().includes(q.toLowerCase())) return true
  const chiffres = chiffresRecherche(q)
  return !!chiffres && !!client.telephone && chiffresClient(client.telephone).includes(chiffres)
}

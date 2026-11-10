// Entrée QR → jeu (P1-C1) : un seul champ obligatoire (téléphone OU e-mail), clavier adapté sur mobile, validation en
// direct sous le champ, prénom demandé APRÈS le tirage. Logique pure (testée sans React).
import { analyserContact } from './fidelite.ts'

/** Clavier proposé pour le champ unique : le client choisit, le champ accepte toujours les deux. */
export type ModeContact = 'tel' | 'email'

export interface AttributsChamp {
  type: 'tel' | 'email'
  inputMode: 'tel' | 'email'
  autoComplete: 'tel' | 'email'
  placeholder: string
}

export function attributsChamp(mode: ModeContact): AttributsChamp {
  return mode === 'tel'
    ? { type: 'tel', inputMode: 'tel', autoComplete: 'tel', placeholder: '06 12 34 56 78' }
    : { type: 'email', inputMode: 'email', autoComplete: 'email', placeholder: 'marie@exemple.fr' }
}

export const MESSAGE_CONTACT_INVALIDE = 'Saisissez un numéro (10 chiffres) ou un e-mail valide.'

/** `ok` : valide ; `encours` : pas encore fini (indication neutre) ; `erreur` : faux, ou envoi tenté avec une saisie incomplète. */
export interface EtatSaisie {
  niveau: 'vide' | 'ok' | 'encours' | 'erreur'
  message: string
}

/** Retour affiché sous le champ dès la frappe. `essaye` : le client a déjà tenté d'envoyer. */
export function etatSaisieContact(saisie: string, essaye = false): EtatSaisie {
  const s = saisie.trim()
  if (!s) return essaye ? { niveau: 'erreur', message: MESSAGE_CONTACT_INVALIDE } : { niveau: 'vide', message: '' }
  const contact = analyserContact(s)
  if (contact) return { niveau: 'ok', message: contact.email ? '✓ E-mail valide' : '✓ Numéro valide' }
  if (essaye) return { niveau: 'erreur', message: MESSAGE_CONTACT_INVALIDE }
  if (s.includes('@') || /[a-z]/i.test(s)) {
    return /\s/.test(s) || (s.match(/@/g)?.length ?? 0) > 1
      ? { niveau: 'erreur', message: 'Cet e-mail n’a pas l’air valide (ex. marie@exemple.fr).' }
      : { niveau: 'encours', message: 'E-mail incomplet (ex. marie@exemple.fr).' }
  }
  const chiffres = s.replace(/\D/g, '').length
  if (!/^[+\d][\d\s.\-()]*$/.test(s) || chiffres > 13) return { niveau: 'erreur', message: 'Ce numéro n’a pas l’air valide (ex. 06 12 34 56 78).' }
  return { niveau: 'encours', message: `${chiffres} chiffre${chiffres > 1 ? 's' : ''} sur 10` }
}

/** « , Marie » ou rien : les phrases restent correctes sans prénom (« Bravo, vous avez gagné »). */
export function virgulePrenom(prenom: string | undefined): string {
  const p = (prenom ?? '').trim()
  return p ? `, ${p}` : ''
}

/** « Bravo Marie » ou « Bravo » : début de phrase suivi du prénom s'il est connu. */
export function avecPrenom(debut: string, prenom: string | undefined): string {
  const p = (prenom ?? '').trim()
  return p ? `${debut} ${p}` : debut
}

/** Nom affiché côté commerçant (caisse, fiche) : le prénom est optionnel partout. */
export function nomAffiche(prenom: string | undefined): string {
  return (prenom ?? '').trim() || 'Client sans prénom'
}

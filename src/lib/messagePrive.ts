// Message privé au restaurant (P1-C4) : logique pure, partagée par le front et le serveur.
//
// Après le jeu, un client qui choisit une note basse dans l'app (3★ ou moins) se voit proposer D'ABORD d'écrire au
// restaurant, en privé. Le lien Google reste toujours accessible (jamais caché, jamais conditionné) et le lot ne dépend
// jamais ni de la note ni du message. Le message est seulement STOCKÉ sur la fiche du client (visible par le commerce
// dans #/avis) : rien n'est envoyé par SMS ou e-mail.
import type { Client, MessagePrive } from '../types'

/** Note à partir de laquelle (et en dessous) le message privé est proposé avant Google. */
export const SEUIL_NOTE_BASSE = 3
export const TEXTE_MAX = 1000
/** Messages acceptés par carte et par jour (en plus du rate limiting par IP / par carte du serveur). */
export const MESSAGES_PAR_JOUR = 3
/** Messages conservés sur une fiche : au-delà, les plus anciens sont retirés. */
export const MESSAGES_CONSERVES = 20

export const proposerMessagePrive = (note: number): boolean => Number.isFinite(note) && note <= SEUIL_NOTE_BASSE

export const TITRE_MESSAGE_PRIVE = 'Dites-nous ce qui n’a pas été'
export const TEXTE_MESSAGE_PRIVE = 'Votre message va directement à l’équipe du restaurant, en privé. Il n’est pas publié.'
export const TEXTE_MESSAGE_ENVOYE = 'Merci, votre message a bien été transmis au restaurant.'
export const TEXTE_GOOGLE_APRES_PRIVE = 'Vous pouvez aussi laisser votre avis sur Google :'

/** Corps de la requête (note entière 1 à 5, texte 1 à TEXTE_MAX caractères) → valeurs propres, ou message d'erreur. */
export function validerMessagePrive(corps: { note?: unknown; texte?: unknown }): { note: number; texte: string } | string {
  const note = corps.note
  if (typeof note !== 'number' || !Number.isInteger(note) || note < 1 || note > 5) return '« note » doit être un nombre entier de 1 à 5.'
  if (typeof corps.texte !== 'string') return 'Écrivez votre message.'
  // Caractères de contrôle retirés (sauf retours à la ligne), espaces de bord supprimés.
  const texte = corps.texte.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim()
  if (!texte) return 'Écrivez votre message.'
  if (texte.length > TEXTE_MAX) return `Message trop long (${TEXTE_MAX} caractères au maximum).`
  return { note, texte }
}

/** Ajoute le message à la fiche (les MESSAGES_CONSERVES plus récents gardés), ou dit pourquoi c'est refusé. */
export function ajouterMessagePrive(client: Client, message: MessagePrive, maintenant: Date): Client | string {
  const existants = client.messagesPrives ?? []
  const duJour = existants.filter((m) => new Date(m.creeLe).toDateString() === maintenant.toDateString()).length
  if (duJour >= MESSAGES_PAR_JOUR) return 'Vous avez déjà envoyé plusieurs messages aujourd’hui : le restaurant les a bien reçus.'
  return { ...client, messagesPrives: [...existants, message].slice(-MESSAGES_CONSERVES) }
}

/** Message privé vu par le commerce dans #/avis : prénom seulement, jamais le téléphone ni l'e-mail. */
export interface MessagePriveCommerce extends MessagePrive {
  clientId: string
  prenom: string
}

/** Tous les messages privés des clients du commerce, les plus récents d'abord. */
export function messagesPrivesDuCommerce(clients: Pick<Client, 'id' | 'prenom' | 'messagesPrives'>[]): MessagePriveCommerce[] {
  return clients
    .flatMap((c) => (c.messagesPrives ?? []).map((m) => ({ ...m, clientId: c.id, prenom: c.prenom })))
    .sort((a, b) => b.creeLe.localeCompare(a.creeLe))
}

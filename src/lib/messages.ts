// Messages automatiques et ciblage (logique pure, partagée serveur / front).
// Les messages vont dans la boîte de réception du client (visible à l'ouverture de sa carte) et le texte est proposé
// au commerçant prêt à copier. Aucun envoi SMS / e-mail ici : l'envoi reste « à brancher » (server/notifications).
import type { Client, Commerce, MessageClient, ReglesMessages, TypeMessageAuto } from '../types'
import { recompenseDebloquee, tamponsAffiches } from './fidelite.ts'

const JOUR = 24 * 60 * 60 * 1000
export const JOURS_INACTIF = 30
export const JOURS_NOUVEAU = 30
export const MESSAGES_GARDES = 30
const CLES_GARDEES = 200

export const TYPES_MESSAGES: { type: TypeMessageAuto; libelle: string; aide: string }[] = [
  { type: 'bienvenue', libelle: 'Bienvenue', aide: 'À l’inscription d’un nouveau client.' },
  { type: 'presque', libelle: 'Plus que 2 tampons', aide: 'Quand il ne manque plus que 2 tampons.' },
  { type: 'recompense', libelle: 'Récompense atteinte', aide: 'Quand la carte est complète.' },
  { type: 'inactif', libelle: 'Relance des inactifs (30 jours)', aide: 'Affiché quand le client rouvre sa carte après 30 jours sans visite.' },
  { type: 'anniversaire', libelle: 'Anniversaire', aide: 'Le jour de l’anniversaire du client (s’il est renseigné).' },
  { type: 'avis', libelle: 'Demande d’avis Google', aide: 'Après le 2e passage, une seule fois. Jamais liée à une récompense.' },
]

export const reglesVides = (): ReglesMessages => ({ bienvenue: false, recompense: false, presque: false, inactif: false, anniversaire: false, avis: false })

export function texteMessage(type: TypeMessageAuto, client: Pick<Client, 'prenom'>, commerce: Pick<Commerce, 'nom' | 'recompense'>): string {
  const p = client.prenom
  switch (type) {
    case 'bienvenue':
      return `Bienvenue ${p} ! Votre carte de fidélité ${commerce.nom} est prête : 1 tampon à chaque passage, et ${commerce.recompense.toLowerCase()} à la clé.`
    case 'presque':
      return `${p}, plus que 2 tampons avant votre récompense chez ${commerce.nom} : ${commerce.recompense}.`
    case 'recompense':
      return `Bravo ${p} ! Votre carte est complète : ${commerce.recompense}. Demandez-la lors de votre prochain passage chez ${commerce.nom}.`
    case 'inactif':
      return `${p}, cela fait un moment ! Toute l’équipe de ${commerce.nom} serait ravie de vous revoir. Votre carte vous attend.`
    case 'anniversaire':
      return `Joyeux anniversaire ${p} ! Toute l’équipe de ${commerce.nom} vous souhaite une très belle journée.`
    case 'avis':
      return `Merci pour vos visites ${p} ! Si vous avez aimé, un avis sur Google aide beaucoup ${commerce.nom}. C’est libre et sans contrepartie.`
  }
}

export type Evenement = 'inscription' | 'passage' | 'ouverture'

const jourMois = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Messages dus pour cet événement (règles activées, sans doublon) : renvoie le client mis à jour et les nouveaux messages. */
export function genererMessages(client: Client, commerce: Commerce, evenement: Evenement, maintenant: Date, nouvelId: () => string): { client: Client; nouveaux: MessageClient[] } {
  const regles = commerce.messagesAuto
  if (!regles) return { client, nouveaux: [] }
  const deja = new Set(client.clesMessages ?? [])
  const dus: { type: TypeMessageAuto; cle: string }[] = []
  const cycle = client.recompensesOffertes?.length ?? 0
  const ajouter = (type: TypeMessageAuto, cle: string) => regles[type] && !deja.has(cle) && dus.push({ type, cle })

  if (evenement === 'inscription') ajouter('bienvenue', 'bienvenue')
  if (evenement === 'passage') {
    const restants = commerce.seuilTampons - tamponsAffiches(client, commerce)
    if (recompenseDebloquee(client, commerce)) ajouter('recompense', `recompense:${cycle}`)
    else if (restants === 2) ajouter('presque', `presque:${cycle}`)
    if (client.visites.length >= 2) ajouter('avis', 'avis')
  }
  if (evenement === 'ouverture') {
    if (client.derniereVisite && maintenant.getTime() - new Date(client.derniereVisite).getTime() > JOURS_INACTIF * JOUR) {
      ajouter('inactif', `inactif:${client.derniereVisite}`)
    }
    if (client.anniversaire && client.anniversaire === jourMois(maintenant)) ajouter('anniversaire', `anniversaire:${maintenant.getFullYear()}`)
  }
  if (!dus.length) return { client, nouveaux: [] }
  const date = maintenant.toISOString()
  const nouveaux: MessageClient[] = dus.map((d) => ({ id: nouvelId(), type: d.type, texte: texteMessage(d.type, client, commerce), date }))
  return {
    client: {
      ...client,
      messages: [...(client.messages ?? []), ...nouveaux].slice(-MESSAGES_GARDES),
      clesMessages: [...(client.clesMessages ?? []), ...dus.map((d) => d.cle)].slice(-CLES_GARDEES),
    },
    nouveaux,
  }
}

/** Ajoute un message du commerçant dans la boîte du client. */
export function deposerMessage(client: Client, message: MessageClient): Client {
  return { ...client, messages: [...(client.messages ?? []), message].slice(-MESSAGES_GARDES) }
}

export function marquerLus(client: Client): Client {
  if (!(client.messages ?? []).some((m) => !m.lu)) return client
  return { ...client, messages: client.messages!.map((m) => (m.lu ? m : { ...m, lu: true })) }
}

// ---------- Ciblage ----------

export type Cible = 'tous' | 'inactifs' | 'proches' | 'nouveaux'

export const CIBLES: { cible: Cible; libelle: string; aide: string }[] = [
  { cible: 'tous', libelle: 'Tous les clients', aide: 'Tous les inscrits.' },
  { cible: 'inactifs', libelle: 'Inactifs', aide: 'Déjà venus, mais pas depuis plus de 30 jours.' },
  { cible: 'proches', libelle: 'Proches de la récompense', aide: 'Plus que 1 ou 2 tampons, ou carte complète.' },
  { cible: 'nouveaux', libelle: 'Nouveaux', aide: 'Inscrits ces 30 derniers jours.' },
]

export function clientsCibles(clients: Client[], commerce: Commerce, cible: Cible, maintenant: Date): Client[] {
  const t = maintenant.getTime()
  return clients.filter((c) => {
    if (c.commerceId !== commerce.id) return false
    switch (cible) {
      case 'tous':
        return true
      case 'inactifs':
        return !!c.derniereVisite && t - new Date(c.derniereVisite).getTime() > JOURS_INACTIF * JOUR
      case 'proches':
        return commerce.seuilTampons - tamponsAffiches(c, commerce) <= 2
      case 'nouveaux':
        return t - new Date(c.creeLe).getTime() <= JOURS_NOUVEAU * JOUR
    }
  })
}

export function texteCible(cible: Cible, commerce: Pick<Commerce, 'nom' | 'recompense'>): string {
  switch (cible) {
    case 'tous':
      return `Bonjour ! Toute l’équipe de ${commerce.nom} vous remercie de votre fidélité. À très vite !`
    case 'inactifs':
      return `Cela fait un moment ! ${commerce.nom} serait ravi de vous revoir : votre carte de fidélité vous attend.`
    case 'proches':
      return `Votre récompense approche chez ${commerce.nom} : ${commerce.recompense}. Plus que quelques tampons !`
    case 'nouveaux':
      return `Merci de votre inscription chez ${commerce.nom} ! 1 tampon à chaque passage : ${commerce.recompense.toLowerCase()} à la clé.`
  }
}

/** Anniversaire saisi « JJ/MM » → « MM-JJ » ; vide → '' ; invalide → null. */
export function analyserAnniversaire(saisie: string): string | null {
  const s = saisie.trim()
  if (!s) return ''
  const m = /^(\d{1,2})[/.\- ](\d{1,2})$/.exec(s)
  if (!m) return null
  const j = Number(m[1])
  const mo = Number(m[2])
  const max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]
  if (!max || j < 1 || j > max) return null
  return `${String(mo).padStart(2, '0')}-${String(j).padStart(2, '0')}`
}

export const anniversaireAffiche = (a?: string) => (a ? `${a.slice(3)}/${a.slice(0, 2)}` : '')

// Messages automatiques et ciblage (logique pure, partagée serveur / front).
// Les messages vont dans la boîte de réception du client (visible à l'ouverture de sa carte) et le texte est proposé
// au commerçant prêt à copier. Aucun envoi SMS / e-mail ici : l'envoi reste « à brancher » (server/notifications).
import type { Client, Commerce, MessageClient, RecompenseEnAttente, ReglesMessages, TypeMessageAuto } from '../types'
import { recompenseDebloquee, tamponsAffiches } from './fidelite.ts'
import { configBienvenue, configWinback, etapeWinback, fenetreAnniversaire } from './programme.ts'

const JOUR = 24 * 60 * 60 * 1000
export const JOURS_INACTIF = 30
export const JOURS_NOUVEAU = 30
export const MESSAGES_GARDES = 30
const CLES_GARDEES = 200

export const TYPES_MESSAGES: { type: TypeMessageAuto; libelle: string; aide: string }[] = [
  { type: 'bienvenue', libelle: 'Bienvenue', aide: 'À l’inscription d’un nouveau client.' },
  { type: 'presque', libelle: 'Plus que 2 tampons', aide: 'Quand il ne manque plus que 2 tampons.' },
  { type: 'recompense', libelle: 'Récompense atteinte', aide: 'Quand la carte est complète.' },
  { type: 'inactif', libelle: 'Relance des inactifs (45 / 60 / 90 jours)', aide: 'Séquence en 3 temps : rappel doux à 45 j (sans remise), offre à 60 j, dernière chance à 90 j puis arrêt.' },
  { type: 'anniversaire', libelle: 'Anniversaire', aide: 'Le jour de l’anniversaire du client (s’il est renseigné).' },
  { type: 'avis', libelle: 'Demande d’avis Google', aide: 'Après le 2e passage, une seule fois. Jamais liée à une récompense.' },
]

export const reglesVides = (): ReglesMessages => ({ bienvenue: false, recompense: false, presque: false, inactif: false, anniversaire: false, avis: false })

// Prénom optionnel (P1-C1 : demandé après le tirage, souvent absent) : les phrases restent correctes sans lui.
/** « Bienvenue Marie » / « Bienvenue ». */
const suiviDuPrenom = (debut: string, prenom: string | undefined) => (prenom?.trim() ? `${debut} ${prenom.trim()}` : debut)
/** « Marie, cela fait… » / « Cela fait… ». */
const ouvertParPrenom = (prenom: string | undefined, suite: string) => (prenom?.trim() ? `${prenom.trim()}, ${suite}` : suite.charAt(0).toUpperCase() + suite.slice(1))

export function texteMessage(type: TypeMessageAuto, client: Pick<Client, 'prenom'>, commerce: Pick<Commerce, 'nom' | 'recompense' | 'programme'>): string {
  const p = client.prenom
  switch (type) {
    case 'bienvenue': {
      const points = configBienvenue(commerce).actif ? configBienvenue(commerce).points : 0
      const amorce = points > 0 ? `${points} points de bienvenue déjà crédités, 1 tampon à chaque passage, et` : '1 tampon à chaque passage, et'
      return `${suiviDuPrenom('Bienvenue', p)} ! Votre carte de fidélité ${commerce.nom} est prête : ${amorce} ${commerce.recompense.toLowerCase()} à la clé.`
    }
    case 'presque':
      return ouvertParPrenom(p, `plus que 2 tampons avant votre récompense chez ${commerce.nom} : ${commerce.recompense}.`)
    case 'recompense':
      return `${suiviDuPrenom('Bravo', p)} ! Votre carte est complète : ${commerce.recompense}. Demandez-la lors de votre prochain passage chez ${commerce.nom}.`
    case 'inactif':
      return ouvertParPrenom(p, `cela fait un moment ! Toute l’équipe de ${commerce.nom} serait ravie de vous revoir. Votre carte vous attend.`)
    case 'anniversaire':
      return `${suiviDuPrenom('Joyeux anniversaire', p)} ! Toute l’équipe de ${commerce.nom} vous souhaite une très belle journée.`
    case 'avis':
      return `${suiviDuPrenom('Merci pour vos visites', p)} ! Si vous avez aimé, un avis sur Google aide beaucoup ${commerce.nom}. C’est libre et sans contrepartie.`
  }
}

export type Evenement = 'inscription' | 'passage' | 'ouverture'

/** Messages dus pour cet événement (règles activées, sans doublon) : renvoie le client mis à jour et les nouveaux messages. */
export function genererMessages(client: Client, commerce: Commerce, evenement: Evenement, maintenant: Date, nouvelId: () => string): { client: Client; nouveaux: MessageClient[] } {
  const regles = commerce.messagesAuto
  if (!regles) return { client, nouveaux: [] }
  const deja = new Set(client.clesMessages ?? [])
  const dus: { type: TypeMessageAuto; cle: string; texte?: string; recompense?: RecompenseEnAttente }[] = []
  const cycle = client.recompensesOffertes?.length ?? 0
  const ajouter = (type: TypeMessageAuto, cle: string) => regles[type] && !deja.has(cle) && dus.push({ type, cle })
  const ajouterTexte = (type: TypeMessageAuto, cle: string, texte: string, recompense?: RecompenseEnAttente) =>
    regles[type] && !deja.has(cle) && dus.push({ type, cle, texte, recompense })

  if (evenement === 'inscription') ajouter('bienvenue', 'bienvenue')
  if (evenement === 'passage') {
    const restants = commerce.seuilTampons - tamponsAffiches(client, commerce)
    if (recompenseDebloquee(client, commerce)) ajouter('recompense', `recompense:${cycle}`)
    else if (restants === 2) ajouter('presque', `presque:${cycle}`)
    if (client.visites.length >= 2) ajouter('avis', 'avis')
  }
  if (evenement === 'passage' || evenement === 'ouverture') {
    // Win-back recalibré (recherche CX §5) : 45 j rappel doux, 60 j offre, 90 j dernière chance, puis arrêt.
    // Le 30 j unique d'avant était trop précoce pour des réguliers qui viennent toutes les 2-3 semaines.
    if (evenement === 'ouverture') {
      const wb = etapeWinback(client, commerce, maintenant)
      if (wb && client.derniereVisite) {
        const offre = configWinback(commerce).offre
        const texte =
          wb.etape === 'rappel'
            ? ouvertParPrenom(client.prenom, `cela fait un moment qu’on ne vous a pas vu chez ${commerce.nom} ! Toute l’équipe serait ravie de vous revoir — votre carte vous attend.`)
            : wb.etape === 'offre'
              ? ouvertParPrenom(client.prenom, `on vous a gardé une attention : ${offre} lors de votre prochaine visite chez ${commerce.nom}. À très vite !`)
              : ouvertParPrenom(client.prenom, `dernière chance : ${offre} vous attend chez ${commerce.nom} — après quoi nous ne vous relancerons plus. À très vite !`)
        ajouterTexte('inactif', `winback:${wb.etape}:${client.derniereVisite}`, texte)
      }
    }
    // Anniversaire : J-7 + jour J (même clé qu'avant pour le jour J), demi-anniversaire, anniversaire d'adhésion.
    // La récompense (dessert, plat signature pour les VIP) est mise en attente, valable 7 à 30 jours selon le niveau.
    const fen = fenetreAnniversaire(client, commerce, maintenant)
    if (fen) {
      const cle = `${fen.type}:${fen.date.getFullYear()}`
      const texte =
        fen.type === 'anniversaire'
          ? `${suiviDuPrenom('Joyeux anniversaire', client.prenom)} ! Toute l’équipe de ${commerce.nom} vous souhaite une très belle journée — ${fen.libelle.toLowerCase()} à retirer au comptoir.`
          : fen.type === 'demi-anniversaire'
            ? ouvertParPrenom(client.prenom, `c’est votre demi-anniversaire chez ${commerce.nom} ! Une boisson vous attend au comptoir.`)
            : ouvertParPrenom(client.prenom, `cela fait déjà 1 an que vous êtes membre chez ${commerce.nom} ! Une boisson vous attend au comptoir pour fêter ça.`)
      ajouterTexte('anniversaire', cle, texte, {
        id: `anniv-${fen.type}-${fen.date.getFullYear()}`,
        libelle: fen.libelle,
        origine: fen.type,
        creeLe: maintenant.toISOString(),
        expireLe: fen.expireLe.toISOString(),
      })
    }
  }
  if (!dus.length) return { client, nouveaux: [] }
  const date = maintenant.toISOString()
  const nouveaux: MessageClient[] = dus.map((d) => ({ id: nouvelId(), type: d.type, texte: d.texte ?? texteMessage(d.type, client, commerce), date }))
  const recompenses = dus.flatMap((d) => (d.recompense ? [d.recompense] : []))
  const enAttente = [...(client.recompensesEnAttente ?? [])]
  for (const r of recompenses) if (!enAttente.some((x) => x.id === r.id)) enAttente.push(r)
  return {
    client: {
      ...client,
      messages: [...(client.messages ?? []), ...nouveaux].slice(-MESSAGES_GARDES),
      clesMessages: [...(client.clesMessages ?? []), ...dus.map((d) => d.cle)].slice(-CLES_GARDEES),
      ...(recompenses.length ? { recompensesEnAttente: enAttente } : {}),
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

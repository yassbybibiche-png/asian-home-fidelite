// Relances SMS / e-mail (P1-B3) : modèles de messages et règles de déclenchement — logique pure, partagée serveur / front.
// Le serveur choisit le canal, vérifie le consentement, l'anti-doublon (table `envois`) et appelle le prestataire
// (server/notifications) ; ici, seulement les textes et les règles, testables sans réseau.
//
// SMS : textes écrits dans l'alphabet GSM 7 bits (pas d'apostrophe typographique, ni ê / â / ç…) pour tenir en
// 160 caractères = 1 SMS facturé ; un seul caractère hors alphabet ferait passer le message en Unicode (70 car. par SMS).
// Chaque SMS se termine par la mention de désinscription `STOP : <lien court>` (P1-B9) : avec l'expéditeur
// alphanumérique Brevo, le client NE PEUT PAS répondre STOP (pas de numéro destinataire) — le lien, qui ouvre la page
// #/desinscription/<client>/<jeton HMAC> (même jeton que les e-mails), est le seul mécanisme utilisable. Le lien
// allonge le SMS : la plupart des relances SMS font désormais 2 segments (facturés 2 SMS).
// E-mail : objet + corps en texte, lien vers la carte et lien de désinscription en pied de message.
import type { Client, Commerce, EnvoiRelance, ModeleRelance } from '../types'
import { tamponsAffiches } from './fidelite.ts'

export const MODELES_RELANCE: { modele: ModeleRelance; libelle: string; aide: string }[] = [
  { modele: 'bienvenue', libelle: 'Bienvenue', aide: 'Après l’inscription : lien vers la carte.' },
  { modele: 'proche', libelle: 'Récompense proche', aide: 'Plus que 1 ou 2 tampons (ex. 8 ou 9 sur 10), ou carte complète.' },
  { modele: 'inactif', libelle: 'Inactif depuis 30 jours', aide: 'Déjà venu, mais pas depuis plus de 30 jours.' },
  { modele: 'anniversaire', libelle: 'Anniversaire', aide: 'Le jour de l’anniversaire du client (s’il est renseigné).' },
]

export const estModeleRelance = (v: unknown): v is ModeleRelance => MODELES_RELANCE.some((m) => m.modele === v)

export const libelleModele = (m: ModeleRelance | 'libre') => (m === 'libre' ? 'Message libre' : MODELES_RELANCE.find((x) => x.modele === m)!.libelle)

/** Statut d'une tentative, tel qu'affiché au gérant (journal des envois) : ne jamais laisser croire à un envoi qui n'a pas eu lieu. */
export function libelleStatutEnvoi(s: EnvoiRelance['statut']): string {
  switch (s) {
    case 'envoye':
      return 'Envoyé'
    case 'en_cours':
      return 'En cours (non confirmé)'
    case 'refuse':
      return 'Refusé — rien envoyé'
    case 'erreur':
      return 'Erreur du prestataire — non envoyé'
    case 'non_branche':
      return 'Non branché (501) — rien envoyé'
    case 'test':
      return 'Test — rien envoyé'
  }
}

/**
 * Mention de désinscription de chaque SMS (P1-B9, alphabet GSM : « é » en fait partie).
 * Le mot STOP est conservé (mention légale des SMS marketing) mais il ne promet plus de réponse : il pointe vers le
 * lien de désinscription, seul mécanisme utilisable avec un expéditeur alphanumérique (Brevo). Sans lien (appel
 * direct sans passer par le serveur), repli honnête : désinscription auprès du commerce, jamais « répondez STOP ».
 */
export function mentionDesinscriptionSms(lien: string): string {
  return lien ? `STOP : ${lien}` : 'STOP : désinscription auprès du commerce'
}

/** Lien court de désinscription, pour les SMS (le serveur redirige `/d/<id>/<jeton>` vers `/#/desinscription/<id>/<jeton>`). */
export const lienCourtDesinscription = (site: string, clientId: string, jeton: string) => `${site.replace(/\/+$/, '')}/d/${clientId}/${jeton}`

/** Lien court vers la carte, pour les SMS (le serveur redirige `/c/<id>` vers `/#/carte/<id>`). */
export const lienCourtCarte = (site: string, clientId: string) => `${site.replace(/\/+$/, '')}/c/${clientId}`
/** Lien complet vers la carte (e-mails). */
export const lienCarte = (site: string, clientId: string) => `${site.replace(/\/+$/, '')}/#/carte/${clientId}`

// ---------- Dates à Paris ----------

/** Jour calendaire à Paris, « AAAA-MM-JJ » (clé de l'anti-doublon, comme l'index unique de la table `envois`). */
export const jourParis = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d)

/** « MM-JJ » du jour à Paris (même format que `Client.anniversaire`). */
export const mmjjParis = (d: Date) => jourParis(d).slice(5)

// ---------- Textes ----------

const JOUR = 24 * 3600_000

interface Destinataire {
  client: Pick<Client, 'prenom' | 'tampons'>
  commerce: Pick<Commerce, 'nom' | 'recompense' | 'seuilTampons'>
}

const restants = ({ client, commerce }: Destinataire) => commerce.seuilTampons - tamponsAffiches(client as Client, commerce)
const prenomDe = (c: Pick<Client, 'prenom'>) => (c.prenom ?? '').trim()

/** Texte du SMS (mention de désinscription par lien comprise). `libre` : texte saisi par le gérant, précédé du nom du commerce. */
export function smsRelance(modele: ModeleRelance | 'libre', d: Destinataire, lienCarte: string, libre = '', lienDesinscription = ''): string {
  const p = prenomDe(d.client)
  const n = d.commerce.nom
  const virgule = p ? `${p}, ` : ''
  let corps: string
  switch (modele) {
    case 'bienvenue':
      corps = `bienvenue${p ? ` ${p}` : ''} ! Votre carte de fidélité : ${lienCarte}`
      break
    case 'proche': {
      const r = restants(d)
      corps = r <= 0 ? `${virgule}votre récompense vous attend ! ${lienCarte}` : `${virgule}plus que ${r} tampon${r > 1 ? 's' : ''} avant votre récompense ! ${lienCarte}`
      break
    }
    case 'inactif':
      corps = `${virgule}vous nous manquez ! Votre carte : ${lienCarte}`
      break
    case 'anniversaire':
      corps = `joyeux anniversaire${p ? ` ${p}` : ''}, belle journée à vous ! ${lienCarte}`
      break
    case 'libre':
      corps = libre.trim()
      break
  }
  return `${n} : ${corps} ${mentionDesinscriptionSms(lienDesinscription)}`
}

export interface EmailRelance {
  sujet: string
  texte: string
}

/** E-mail (objet + corps en texte) avec le lien vers la carte et, en pied, le lien de désinscription. */
export function emailRelance(modele: ModeleRelance | 'libre', d: Destinataire, liens: { carte: string; desinscription: string }, libre = ''): EmailRelance {
  const p = prenomDe(d.client)
  const { nom: n, recompense } = d.commerce
  let sujet: string
  let paragraphe: string
  switch (modele) {
    case 'bienvenue':
      sujet = `Bienvenue chez ${n} : votre carte de fidélité`
      paragraphe = `Merci de votre inscription ! Votre carte de fidélité ${n} est créée : 1 tampon à chaque passage, et ${recompense.charAt(0).toLowerCase()}${recompense.slice(1)} à la clé.`
      break
    case 'proche': {
      const r = restants(d)
      sujet = r <= 0 ? `Votre récompense vous attend chez ${n}` : `Votre récompense approche chez ${n}`
      paragraphe =
        r <= 0
          ? `Bonne nouvelle : votre carte est complète ! ${recompense} vous attend lors de votre prochain passage.`
          : `Plus que ${r} tampon${r > 1 ? 's' : ''} avant votre récompense : ${recompense}. Nous serons ravis de vous accueillir pour compléter votre carte.`
      break
    }
    case 'inactif':
      sujet = `${n} : vous nous manquez`
      paragraphe = `Cela fait un moment que nous ne vous avons pas vu ! Toute l’équipe de ${n} serait ravie de vous accueillir à nouveau : votre carte de fidélité vous attend (${tamponsAffiches(d.client as Client, d.commerce)}/${d.commerce.seuilTampons} tampons).`
      break
    case 'anniversaire':
      sujet = `Joyeux anniversaire de la part de ${n}`
      paragraphe = `Toute l’équipe de ${n} vous souhaite un très joyeux anniversaire et une belle journée !`
      break
    case 'libre':
      sujet = n
      paragraphe = libre.trim()
      break
  }
  const texte = [
    p ? `Bonjour ${p},` : 'Bonjour,',
    paragraphe,
    `Votre carte de fidélité : ${liens.carte}`,
    `À très bientôt,\nL’équipe de ${n}`,
    `—\nVous recevez cet e-mail car vous avez accepté de recevoir les messages de ${n}. Pour ne plus en recevoir : ${liens.desinscription}`,
  ].join('\n\n')
  return { sujet, texte }
}

// ---------- Longueur d'un SMS ----------

const GSM7 = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
)
/** Caractères de l'extension GSM : comptent double. */
const GSM7_EXTENSION = new Set('^{}\\[~]|€\f')

/** Nombre de caractères facturés, alphabet (GSM 7 bits ou Unicode) et nombre de SMS (segments) d'un texte. */
export function analyseSms(texte: string): { caracteres: number; gsm7: boolean; segments: number } {
  const chars = [...texte]
  const gsm7 = chars.every((c) => GSM7.has(c) || GSM7_EXTENSION.has(c))
  if (gsm7) {
    const caracteres = chars.reduce((n, c) => n + (GSM7_EXTENSION.has(c) ? 2 : 1), 0)
    return { caracteres, gsm7, segments: caracteres <= 160 ? 1 : Math.ceil(caracteres / 153) }
  }
  const caracteres = texte.length // unités UTF-16
  return { caracteres, gsm7, segments: caracteres <= 70 ? 1 : Math.ceil(caracteres / 67) }
}

// ---------- Canal ----------

/** Téléphone → SMS, e-mail → e-mail (un client a l'un ou l'autre) ; aucun contact → null. */
export const canalDuClient = (c: Pick<Client, 'telephone' | 'email'>): 'sms' | 'email' | null => (c.telephone ? 'sms' : c.email ? 'email' : null)

// ---------- STOP ----------

/** Mots-clés de désinscription par SMS (insensibles à la casse et aux accents) : le 1er mot du message compte. */
export const MOTS_STOP = ['STOP', 'STOPALL', 'ARRET', 'ARRETER', 'DESINSCRIPTION', 'DESINSCRIRE', 'DESABONNEMENT', 'DESABONNER', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']

export function estMotStop(texte: string): boolean {
  const premier = texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim()
    .split(/[^A-Z]+/)
    .find(Boolean)
  return !!premier && MOTS_STOP.includes(premier)
}

// ---------- Règles de déclenchement ----------

export const JOURS_RELANCE_INACTIF = 30
/** Au-delà, plus de relance automatique (même arrêt que la séquence win-back) : pas de SMS à d'anciens clients perdus de vue. */
export const JOURS_RELANCE_INACTIF_MAX = 120

/** Plus que 1 ou 2 tampons, ou carte complète. */
export function procheDeLaRecompense(client: Pick<Client, 'tampons'>, commerce: Pick<Commerce, 'seuilTampons'>): boolean {
  return commerce.seuilTampons - tamponsAffiches(client as Client, commerce) <= 2
}

/** Déjà venu, et pas depuis 30 jours ou plus (et moins de 120 jours). */
export function inactifARelancer(client: Pick<Client, 'derniereVisite'>, maintenant: Date): boolean {
  if (!client.derniereVisite) return false
  const ecart = maintenant.getTime() - new Date(client.derniereVisite).getTime()
  return ecart >= JOURS_RELANCE_INACTIF * JOUR && ecart < JOURS_RELANCE_INACTIF_MAX * JOUR
}

/** C'est aujourd'hui (à Paris) son anniversaire ; un 29 février est fêté le 28 les années non bissextiles. */
export function anniversaireAujourdhui(client: Pick<Client, 'anniversaire'>, maintenant: Date): boolean {
  if (!client.anniversaire) return false
  const jour = mmjjParis(maintenant)
  if (client.anniversaire === jour) return true
  const annee = Number(jourParis(maintenant).slice(0, 4))
  const bissextile = (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0
  return client.anniversaire === '02-29' && !bissextile && jour === '02-28'
}

/** Modèles pertinents pour ce client aujourd'hui (proposés en premier au gérant). */
export function modelesSuggeres(client: Client, commerce: Pick<Commerce, 'seuilTampons'>, maintenant: Date): ModeleRelance[] {
  const r: ModeleRelance[] = []
  if (anniversaireAujourdhui(client, maintenant)) r.push('anniversaire')
  if (inactifARelancer(client, maintenant)) r.push('inactif')
  if (procheDeLaRecompense(client, commerce)) r.push('proche')
  if (!client.visites.length) r.push('bienvenue')
  return r
}

const occupe = (e: Pick<EnvoiRelance, 'statut'>) => e.statut === 'envoye' || e.statut === 'en_cours'

/**
 * Relance automatique due pour ce client (déjà filtrée sur le consentement par le serveur) ?
 * - inactif : une seule fois par période d'absence (rien d'envoyé depuis la dernière visite) ;
 * - anniversaire : le jour J, une fois par an.
 */
export function relanceAutoDue(modele: 'inactif' | 'anniversaire', client: Client, envoisDuClient: Pick<EnvoiRelance, 'modele' | 'statut' | 'date' | 'jour'>[], maintenant: Date): boolean {
  const deja = envoisDuClient.filter((e) => e.modele === modele && occupe(e))
  if (modele === 'inactif') {
    if (!inactifARelancer(client, maintenant)) return false
    const depuis = new Date(client.derniereVisite!).getTime()
    return !deja.some((e) => new Date(e.date).getTime() > depuis)
  }
  if (!anniversaireAujourdhui(client, maintenant)) return false
  const annee = jourParis(maintenant).slice(0, 4)
  return !deja.some((e) => e.jour.startsWith(annee))
}

// Relance automatique « gain bientôt expiré » (roue v2, R7) — logique pure, utilisée par la tournée automatique du
// serveur (`lancerRelancesAuto`). Le client a gagné un lot physique à la roue, il ne l'a pas encore retiré, et le gain
// expire (fin de J+30, `finGain`) dans moins de 72 h : un seul message par gain, sur le canal et avec le consentement
// des autres relances (vérifiés par le serveur). Jamais proposé en relance manuelle (il faut un tirage précis).
import type { Client, Commerce, EnvoiRelance, Tirage } from '../types'
import { cycleGain, dernierJourGain, estGainPhysique, finGain, tirageHerite, typeTirage } from './roulette.ts'
import { corpsEmail, mentionDesinscriptionSms, type EmailRelance } from './relances.ts'

/** Délai avant l'expiration du gain à partir duquel la relance part. */
export const DELAI_RELANCE_GAIN_MS = 72 * 3600_000

/**
 * Gain à relancer : lot physique (type 'lot') tiré avec la roue v2 (pas un tirage hérité, valable le jour même), dans sa
 * période d'utilisation (J+1 à J+30, pas remis, pas expiré) et qui expire dans moins de 72 h.
 */
export function gainBientotExpire(t: Tirage, maintenant: Date): boolean {
  if (!estGainPhysique(typeTirage(t)) || tirageHerite(t) || cycleGain(t, maintenant) !== 'utilisable') return false
  const reste = finGain(t).getTime() - maintenant.getTime()
  return reste > 0 && reste <= DELAI_RELANCE_GAIN_MS
}

/**
 * Une relance `gainExpire` existe déjà pour CE tirage : envoyée, en cours, incertaine (peut-être partie) — ou simulée
 * (`test`). Contrairement aux autres relances automatiques, la simulation compte : le message est unique par gain, et
 * le mode test ne doit pas le rejouer à chaque tournée pendant les 72 h. Un refus ou une erreur ne comptent pas.
 */
export function relanceGainFaite(tirageId: string, envoisDuClient: Pick<EnvoiRelance, 'modele' | 'statut' | 'tirageId'>[]): boolean {
  return envoisDuClient.some(
    (e) => e.modele === 'gainExpire' && e.tirageId === tirageId && (e.statut === 'envoye' || e.statut === 'en_cours' || e.statut === 'incertain' || e.statut === 'test'),
  )
}

/** Gains de ce client à relancer maintenant, l'expiration la plus proche d'abord. */
export function gainsARelancer(tiragesClient: Tirage[], envoisDuClient: Pick<EnvoiRelance, 'modele' | 'statut' | 'tirageId'>[], maintenant: Date): Tirage[] {
  return tiragesClient
    .filter((t) => gainBientotExpire(t, maintenant) && !relanceGainFaite(t.id, envoisDuClient))
    .sort((a, b) => finGain(a).getTime() - finGain(b).getTime())
}

/** « jeudi 12 novembre » : dernier jour du gain, à Paris. */
export function dateExpirationGain(t: Pick<Tirage, 'date' | 'typeLot' | 'typeDeduit'>): string {
  return dernierJourGain(t).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' })
}

interface DestinataireGain {
  client: Pick<Client, 'prenom'>
  commerce: Pick<Commerce, 'nom'>
  tirage: Pick<Tirage, 'lot' | 'date' | 'typeLot' | 'typeDeduit'>
}

/** SMS (alphabet GSM : « É » / « é » en font partie, guillemets droits), mention de désinscription par lien comprise. */
export function smsGainExpire(d: DestinataireGain, lienCarte: string, lienDesinscription = ''): string {
  const p = (d.client.prenom ?? '').trim()
  return `${d.commerce.nom} : ${p ? `${p}, v` : 'V'}otre gain "${d.tirage.lot}" expire le ${dateExpirationGain(d.tirage)}. Présentez votre carte au comptoir : ${lienCarte} ${mentionDesinscriptionSms(lienDesinscription)}`
}

/** E-mail (objet + corps), même pied que les autres relances. */
export function emailGainExpire(d: DestinataireGain, liens: { carte: string; desinscription: string }): EmailRelance {
  const n = d.commerce.nom
  return {
    sujet: `${n} : votre gain expire bientôt`,
    texte: corpsEmail(
      (d.client.prenom ?? '').trim(),
      n,
      `Votre gain « ${d.tirage.lot} » chez ${n} expire le ${dateExpirationGain(d.tirage)} : présentez votre carte au comptoir pour en profiter.`,
      liens,
    ),
  }
}

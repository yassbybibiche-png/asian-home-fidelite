// Envoi SMS / e-mail (P1-B3 : relances de bout en bout — consentement, modèles, journal `envois`, STOP).
// Sans clé configurée, `envoyer` lève une erreur 501 « à brancher » et n'appelle aucun prestataire.
// Avec les variables d'environnement (server/README.md), le code d'appel est prêt et testé contre des prestataires
// SIMULÉS (fetch injecté) ; il n'a JAMAIS été exécuté contre le vrai Twilio ni le vrai Brevo : aucune clé n'a été créée.
import { adaptateurTwilio, configTwilio, signatureTwilio, type ConfigTwilio } from './twilio.ts'
import { adaptateurBrevo, adaptateurBrevoSms, configBrevo, configBrevoSms, type ConfigBrevo, type ConfigBrevoSms } from './brevo.ts'
import { timingSafeEqual } from 'node:crypto'

export type Canal = 'sms' | 'email'

export interface Message {
  /** Numéro (format international +33…) ou adresse e-mail. */
  destinataire: string
  texte: string
  /** E-mail seulement. */
  sujet?: string
  /** E-mail seulement : en-têtes ajoutés (List-Unsubscribe…). */
  entetes?: Record<string, string>
}

export interface Adaptateur {
  canal: Canal
  prestataire: string
  configure: boolean
  /**
   * Envoi. `test: true` = mode test : rien n'a été livré (e-mail en sandbox Brevo, SMS simulé) — l'appelant trace
   * le statut `test` (« rien envoyé »), jamais `envoye`.
   */
  envoyer(m: Message): Promise<{ id: string; test?: boolean }>
}

export class ErreurNonBranche extends Error {
  statut = 501
  constructor(canal: Canal) {
    super(`Envoi ${canal === 'sms' ? 'SMS' : 'e-mail'} à brancher : aucun prestataire n’est configuré sur ce serveur. Rien n’a été envoyé.`)
  }
}

export interface ConfigNotifications {
  twilio?: ConfigTwilio
  brevo?: ConfigBrevo
  /** SMS via Brevo (même clé API que l'e-mail) : prioritaire sur Twilio quand il est configuré. */
  brevoSms?: ConfigBrevoSms
  /** Mode test Brevo (`BREVO_MODE_TEST=1`) : aucun SMS / e-mail réel ne part (voir `brevo.ts`). */
  modeTest?: boolean
  /** Injectable pour les tests (aucun appel réseau réel dans les tests). */
  fetch?: typeof fetch
}

/** Lit la configuration dans les variables d'environnement (absente = rien n'est envoyé). */
export function configDepuisEnv(env: Record<string, string | undefined>): ConfigNotifications {
  return { twilio: configTwilio(env), brevo: configBrevo(env), brevoSms: configBrevoSms(env), modeTest: env.BREVO_MODE_TEST === '1' }
}

export function creerNotifications(c: ConfigNotifications = {}) {
  const f = c.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const adaptateurs: Record<Canal, Adaptateur> = {
    // SMS : Brevo d'abord (fournisseur choisi), Twilio en repli s'il est configuré seul. Aucun des deux : 501.
    sms: c.brevoSms ? adaptateurBrevoSms(c.brevoSms, f) : adaptateurTwilio(c.twilio, f),
    email: adaptateurBrevo(c.brevo, f),
  }
  return {
    statut: () => ({ sms: adaptateurs.sms.configure, email: adaptateurs.email.configure }),
    /** Mode test actif (`BREVO_MODE_TEST=1`) : aucun envoi réel, même si les prestataires sont configurés. */
    modeTest: !!c.modeTest,
    /** Nom du prestataire du canal (`Brevo` / `Twilio`), ou `undefined` si rien n'est configuré. */
    prestataire: (canal: Canal) => (adaptateurs[canal].configure ? adaptateurs[canal].prestataire : undefined),
    async envoyer(canal: Canal, m: Message) {
      const a = adaptateurs[canal]
      if (!a.configure) throw new ErreurNonBranche(canal)
      return a.envoyer(m)
    },
    /**
     * Webhook des SMS entrants (STOP) : signature `X-Twilio-Signature` calculée avec le jeton Twilio sur l'URL exacte
     * appelée et les paramètres reçus. Twilio non configuré → false (la route répond 501 avant d'en arriver là).
     */
    signatureSmsValide(url: string, params: URLSearchParams, signature: string | undefined) {
      if (!c.twilio || !signature) return false
      const attendue = Buffer.from(signatureTwilio(c.twilio.authToken, url, params))
      const recue = Buffer.from(signature)
      return attendue.length === recue.length && timingSafeEqual(attendue, recue)
    },
  }
}

export type Notifications = ReturnType<typeof creerNotifications>

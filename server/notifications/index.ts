// Envoi SMS / e-mail — BRANCHEMENTS PRÉPARÉS, AUCUN ENVOI DANS CETTE VERSION (V3).
// Sans clé configurée, `envoyer` lève une erreur 501 « à brancher » et n'appelle aucun prestataire.
// Avec les variables d'environnement (server/README.md), le code d'appel est prêt mais n'a JAMAIS été
// exécuté contre un vrai prestataire : aucune clé n'a été créée ni configurée.
import { adaptateurTwilio, configTwilio, type ConfigTwilio } from './twilio.ts'
import { adaptateurBrevo, configBrevo, type ConfigBrevo } from './brevo.ts'

export type Canal = 'sms' | 'email'

export interface Message {
  /** Numéro (format international +33…) ou adresse e-mail. */
  destinataire: string
  texte: string
  /** E-mail seulement. */
  sujet?: string
}

export interface Adaptateur {
  canal: Canal
  prestataire: string
  configure: boolean
  envoyer(m: Message): Promise<{ id: string }>
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
  /** Injectable pour les tests (aucun appel réseau réel dans les tests). */
  fetch?: typeof fetch
}

/** Lit la configuration dans les variables d'environnement (absente = rien n'est envoyé). */
export function configDepuisEnv(env: Record<string, string | undefined>): ConfigNotifications {
  return { twilio: configTwilio(env), brevo: configBrevo(env) }
}

export function creerNotifications(c: ConfigNotifications = {}) {
  const f = c.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const adaptateurs: Record<Canal, Adaptateur> = {
    sms: adaptateurTwilio(c.twilio, f),
    email: adaptateurBrevo(c.brevo, f),
  }
  return {
    statut: () => ({ sms: adaptateurs.sms.configure, email: adaptateurs.email.configure }),
    async envoyer(canal: Canal, m: Message) {
      const a = adaptateurs[canal]
      if (!a.configure) throw new ErreurNonBranche(canal)
      return a.envoyer(m)
    },
  }
}

export type Notifications = ReturnType<typeof creerNotifications>

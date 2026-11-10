// Adaptateur e-mail Brevo (API « transactional email »). Prêt, jamais exécuté contre Brevo : aucune clé configurée.
import type { Adaptateur, Message } from './index.ts'

export interface ConfigBrevo {
  cleApi: string
  /** Adresse expéditrice, à valider dans le compte Brevo (domaine du commerce de préférence). */
  expediteurEmail: string
  expediteurNom: string
}

/** BREVO_API_KEY + BREVO_SENDER_EMAIL obligatoires ; BREVO_SENDER_NAME optionnel. */
export function configBrevo(env: Record<string, string | undefined>): ConfigBrevo | undefined {
  const { BREVO_API_KEY: cleApi, BREVO_SENDER_EMAIL: expediteurEmail } = env
  return cleApi && expediteurEmail ? { cleApi, expediteurEmail, expediteurNom: env.BREVO_SENDER_NAME || 'Asian Home Fidélité' } : undefined
}

export function adaptateurBrevo(c: ConfigBrevo | undefined, f: typeof fetch): Adaptateur {
  return {
    canal: 'email',
    prestataire: 'Brevo',
    configure: !!c,
    async envoyer(m: Message) {
      if (!c) throw new Error('Brevo non configuré.')
      const r = await f('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': c.cleApi, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: c.expediteurNom, email: c.expediteurEmail },
          to: [{ email: m.destinataire }],
          subject: m.sujet ?? 'Votre carte de fidélité',
          textContent: m.texte,
          // List-Unsubscribe (+ One-Click, RFC 8058) : bouton « Se désabonner » natif des messageries. Brevo n'ajoute pas
          // de lien de désinscription aux e-mails transactionnels : c'est la route de l'app qui retire le consentement.
          ...(m.entetes && Object.keys(m.entetes).length ? { headers: m.entetes } : {}),
        }),
      })
      if (!r.ok) throw new Error(`Brevo a refusé l’envoi (HTTP ${r.status}).`)
      const j = (await r.json()) as { messageId?: string }
      return { id: j.messageId ?? '' }
    },
  }
}

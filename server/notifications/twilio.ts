// Adaptateur SMS Twilio (API REST « Messages »). Prêt, jamais exécuté contre Twilio : aucune clé configurée.
import type { Adaptateur, Message } from './index.ts'

export interface ConfigTwilio {
  accountSid: string
  authToken: string
  /** Numéro expéditeur Twilio (+33…) ou identifiant d'un Messaging Service (MG…). */
  expediteur: string
}

/** TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM, tous obligatoires. */
export function configTwilio(env: Record<string, string | undefined>): ConfigTwilio | undefined {
  const { TWILIO_ACCOUNT_SID: accountSid, TWILIO_AUTH_TOKEN: authToken, TWILIO_FROM: expediteur } = env
  return accountSid && authToken && expediteur ? { accountSid, authToken, expediteur } : undefined
}

export function adaptateurTwilio(c: ConfigTwilio | undefined, f: typeof fetch): Adaptateur {
  return {
    canal: 'sms',
    prestataire: 'Twilio',
    configure: !!c,
    async envoyer(m: Message) {
      if (!c) throw new Error('Twilio non configuré.')
      const corps = new URLSearchParams({ To: m.destinataire, Body: m.texte })
      corps.set(c.expediteur.startsWith('MG') ? 'MessagingServiceSid' : 'From', c.expediteur)
      const r = await f(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.accountSid)}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: corps.toString(),
      })
      if (!r.ok) throw new Error(`Twilio a refusé l’envoi (HTTP ${r.status}).`)
      const j = (await r.json()) as { sid?: string }
      return { id: j.sid ?? '' }
    },
  }
}

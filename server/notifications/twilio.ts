// Adaptateur SMS Twilio (API REST « Messages »). Prêt, jamais exécuté contre Twilio : aucune clé configurée.
import { createHmac } from 'node:crypto'
import type { Adaptateur, Message } from './index.ts'

/**
 * Signature d'une requête webhook Twilio (en-tête X-Twilio-Signature, doc Twilio « Webhooks security ») :
 * HMAC-SHA1 (clé : jeton d'authentification) de l'URL complète suivie des paramètres POST triés par nom (nom + valeur
 * concaténés, sans séparateur), en base64.
 */
export function signatureTwilio(authToken: string, url: string, params: URLSearchParams): string {
  const noms = [...new Set(params.keys())].sort()
  const donnees = url + noms.map((n) => params.getAll(n).map((v) => n + v).join('')).join('')
  return createHmac('sha1', authToken).update(donnees, 'utf8').digest('base64')
}

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

// Adaptateur e-mail Brevo (API « transactional email ») + SMS Brevo (API « transactional SMS »).
// Prêts, jamais exécutés contre le vrai Brevo : aucune clé configurée.
import type { Adaptateur, Message } from './index.ts'

export interface ConfigBrevo {
  cleApi: string
  /** Adresse expéditrice, à valider dans le compte Brevo (domaine du commerce de préférence). */
  expediteurEmail: string
  expediteurNom: string
  /**
   * Mode test Brevo (`BREVO_MODE_TEST=1`, consigne du 10/11/2026 : aucun envoi réel pendant le développement) :
   * l'e-mail part en sandbox Brevo (`X-Sib-Sandbox: drop`, doc Brevo « Using sandbox mode », lue le 10/11/2026) —
   * Brevo valide l'authentification, le format et l'expéditeur, répond 201 + `messageId`, mais ne livre rien et ne
   * journalise rien. L'envoi est tracé dans le journal de l'app avec le statut `test` (« rien envoyé »).
   */
  bacASable?: boolean
}

/** BREVO_API_KEY + BREVO_SENDER_EMAIL obligatoires ; BREVO_SENDER_NAME optionnel. */
export function configBrevo(env: Record<string, string | undefined>): ConfigBrevo | undefined {
  const { BREVO_API_KEY: cleApi, BREVO_SENDER_EMAIL: expediteurEmail } = env
  return cleApi && expediteurEmail
    ? { cleApi, expediteurEmail, expediteurNom: env.BREVO_SENDER_NAME || 'Asian Home Fidélité', ...(env.BREVO_MODE_TEST === '1' ? { bacASable: true } : {}) }
    : undefined
}

export interface ConfigBrevoSms {
  cleApi: string
  /** Nom d'expéditeur affiché sur le téléphone du client (alphanumérique, 11 caractères max). */
  expediteurSms: string
  /**
   * Mode test Brevo (`BREVO_MODE_TEST=1`) : Brevo ne propose AUCUN sandbox pour les SMS — l'envoi est donc simulé
   * (aucun appel réseau, `{ id: 'test', test: true }`) et tracé dans le journal de l'app avec le statut `test`
   * (« rien envoyé »). Jamais un vrai SMS tant que cette variable vaut `1`.
   */
  modeTest?: boolean
}

/**
 * Nom d'expéditeur SMS accepté par Brevo (doc « Send transactional SMS », lue le 10/11/2026) : lettres et chiffres
 * seulement, 11 caractères maximum ; un expéditeur numérique (12 à 15 chiffres) est aussi accepté.
 * Un nom invalide (espace, tiret, trop long…) = SMS Brevo non configuré (le serveur répond 501, rien n'est envoyé).
 */
export function expediteurSmsValide(nom: string): boolean {
  return /^[A-Za-z0-9]{1,11}$/.test(nom) || /^\d{12,15}$/.test(nom)
}

/** BREVO_API_KEY + BREVO_SMS_SENDER obligatoires ; même clé API que pour l'e-mail. */
export function configBrevoSms(env: Record<string, string | undefined>): ConfigBrevoSms | undefined {
  const { BREVO_API_KEY: cleApi, BREVO_SMS_SENDER: expediteurSms } = env
  return cleApi && expediteurSms && expediteurSmsValide(expediteurSms)
    ? { cleApi, expediteurSms, ...(env.BREVO_MODE_TEST === '1' ? { modeTest: true } : {}) }
    : undefined
}

export function adaptateurBrevo(c: ConfigBrevo | undefined, f: typeof fetch): Adaptateur {
  return {
    canal: 'email',
    prestataire: 'Brevo',
    configure: !!c,
    async envoyer(m: Message) {
      if (!c) throw new Error('Brevo non configuré.')
      const entetes = { ...(m.entetes ?? {}), ...(c.bacASable ? { 'X-Sib-Sandbox': 'drop' } : {}) }
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
          ...(Object.keys(entetes).length ? { headers: entetes } : {}),
        }),
      })
      if (!r.ok) throw new Error(`Brevo a refusé l’envoi (HTTP ${r.status}).`)
      const j = (await r.json()) as { messageId?: string }
      // Sandbox : Brevo a validé la requête (201 + messageId) sans rien livrer — l'appelant trace `test`, pas `envoye`.
      return { id: j.messageId ?? '', ...(c.bacASable ? { test: true } : {}) }
    },
  }
}

/**
 * Adaptateur SMS Brevo (API « transactional SMS », `POST /v3/transactionalSMS/send` — route actuelle de la doc
 * Brevo, lue le 10/11/2026 ; l'ancienne route `/v3/transactionalSMS/sms` est dépréciée).
 *
 * - Même clé API que l'e-mail (`BREVO_API_KEY`), expéditeur `BREVO_SMS_SENDER` (ex. `ASIANHOME`).
 * - `type: 'transactional'` : les relances partent en transactionnel ; la mention STOP en fin de message les fait
 *   basculer automatiquement en `marketing` côté Brevo (c'est Brevo qui le décide, la mention STOP est obligatoire
 *   en France pour un SMS marketing — nos SMS la portent, sous la forme `STOP : <lien de désinscription>` (P1-B9),
 *   voir `mentionDesinscriptionSms`).
 * - Réponse : `{ messageId: <nombre> }` (pas une chaîne comme pour l'e-mail).
 * - LIMITE — pas de réponse STOP possible : avec un expéditeur alphanumérique, le client ne peut pas répondre au
 *   SMS (pas de numéro destinataire) ; Brevo ne reçoit donc aucun STOP sur ces envois. Brevo met bien en liste
 *   noire les contacts qui répondent STOP quand c'est possible (expéditeur numérique), mais ici c'est le
 *   consentement de l'app qui fait foi : retrait par le lien de désinscription porté par chaque SMS (P1-B9, lien
 *   court `/d/<client>/<jeton HMAC>` → page #/desinscription, même jeton que les e-mails), depuis la fiche client,
 *   ou auprès du commerçant. Le webhook `stop-sms` de l'app reste réservé à Twilio (voir `server/app.ts`).
 */
export function adaptateurBrevoSms(c: ConfigBrevoSms | undefined, f: typeof fetch): Adaptateur {
  return {
    canal: 'sms',
    prestataire: 'Brevo',
    configure: !!c,
    async envoyer(m: Message) {
      if (!c) throw new Error('Brevo non configuré.')
      // Mode test : Brevo ne propose pas de sandbox SMS — simulation pure, aucun appel réseau. Le journal de l'app
      // trace l'envoi avec le statut `test` (« rien envoyé »), jamais `envoye`.
      if (c.modeTest) return { id: 'test', test: true }
      const r = await f('https://api.brevo.com/v3/transactionalSMS/send', {
        method: 'POST',
        headers: { 'api-key': c.cleApi, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          sender: c.expediteurSms,
          recipient: m.destinataire,
          content: m.texte,
          type: 'transactional',
          tag: 'fidelite',
        }),
      })
      if (!r.ok) throw new Error(`Brevo a refusé l’envoi (HTTP ${r.status}).`)
      const j = (await r.json()) as { messageId?: string | number }
      return { id: j.messageId == null ? '' : String(j.messageId) }
    },
  }
}

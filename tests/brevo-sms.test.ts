// SMS via Brevo — adaptateur `server/notifications/brevo.ts` (lot « Brancher Brevo ») : configuration,
// requête bien formée (route actuelle `/v3/transactionalSMS/send`), `messageId` numérique → chaîne, erreurs.
// AUCUN appel réseau réel : `fetch` injecté.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { adaptateurBrevo, adaptateurBrevoSms, configBrevoSms, expediteurSmsValide } from '../server/notifications/brevo.ts'
import { configDepuisEnv, creerNotifications } from '../server/notifications/index.ts'

const CLE = 'cle-test'
const EXPEDITEUR = 'ASIANHOME'

function fauxFetch(reponse: { statut: number; corps: unknown }) {
  const appels: { url: string; init: RequestInit }[] = []
  const fetch = (async (url: string, init: RequestInit) => {
    appels.push({ url, init })
    return new Response(JSON.stringify(reponse.corps), { status: reponse.statut })
  }) as unknown as typeof fetch
  return { fetch, appels }
}

describe('configBrevoSms : BREVO_API_KEY + BREVO_SMS_SENDER, expéditeur validé', () => {
  test('expéditeur alphanumérique 1–11 caractères, ou numérique 12–15 chiffres', () => {
    for (const nom of ['A', 'ASIANHOME', 'AsianHome1', '123456789012345']) assert.equal(expediteurSmsValide(nom), true, nom)
    for (const nom of ['', 'ASIAN HOME', 'ASIAN-HOME', 'ASIANHOME1234', '1234567890123456', 'ASIAN_HOME']) assert.equal(expediteurSmsValide(nom), false, nom)
  })

  test('configBrevoSms : clé + expéditeur valides → configuré ; sinon undefined', () => {
    assert.deepEqual(configBrevoSms({ BREVO_API_KEY: CLE, BREVO_SMS_SENDER: EXPEDITEUR }), { cleApi: CLE, expediteurSms: EXPEDITEUR })
    assert.equal(configBrevoSms({ BREVO_API_KEY: CLE }), undefined, 'expéditeur manquant')
    assert.equal(configBrevoSms({ BREVO_SENDER_EMAIL: 'a@b.fr', BREVO_SMS_SENDER: EXPEDITEUR }), undefined, 'clé manquante')
    assert.equal(configBrevoSms({ BREVO_API_KEY: CLE, BREVO_SMS_SENDER: 'ASIAN HOME' }), undefined, 'expéditeur invalide (espace)')
    assert.equal(configBrevoSms({ BREVO_API_KEY: CLE, BREVO_SMS_SENDER: 'ASIANHOME1234' }), undefined, 'expéditeur invalide (12 car. alphanumériques)')
    assert.equal(configBrevoSms({}), undefined)
  })

  test('configDepuisEnv : SMS Brevo seul suffit pour `sms: true` (e-mail reste false sans BREVO_SENDER_EMAIL)', () => {
    assert.deepEqual(creerNotifications(configDepuisEnv({ BREVO_API_KEY: CLE, BREVO_SMS_SENDER: EXPEDITEUR })).statut(), { sms: true, email: false })
    assert.deepEqual(creerNotifications(configDepuisEnv({ BREVO_API_KEY: CLE, BREVO_SMS_SENDER: 'ASIAN HOME' })).statut(), { sms: false, email: false })
  })

  test('BREVO_MODE_TEST=1 : mode test lu dans l’environnement (e-mail sandbox, SMS simulé, Twilio simulé)', () => {
    const c = configDepuisEnv({ BREVO_API_KEY: CLE, BREVO_SENDER_EMAIL: 'a@b.fr', BREVO_SMS_SENDER: EXPEDITEUR, TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: '+33700000000', BREVO_MODE_TEST: '1' })
    assert.equal(c.modeTest, true)
    assert.equal(c.brevo?.bacASable, true)
    assert.equal(c.brevoSms?.modeTest, true)
    assert.equal(c.twilio?.modeTest, true)
    assert.equal(creerNotifications(c).modeTest, true)
    const sans = configDepuisEnv({ BREVO_API_KEY: CLE, BREVO_SENDER_EMAIL: 'a@b.fr' })
    assert.equal(sans.modeTest, false)
    assert.equal(creerNotifications(sans).modeTest, false)
  })
})

describe('adaptateurBrevoSms : requête Brevo bien formée, réponse lue, erreurs', () => {
  test('POST /v3/transactionalSMS/send, en-tête api-key, JSON (sender, recipient, content, type, tag) ; messageId numérique → chaîne', async () => {
    const { fetch, appels } = fauxFetch({ statut: 201, corps: { messageId: 987654321 } })
    const a = adaptateurBrevoSms({ cleApi: CLE, expediteurSms: EXPEDITEUR }, fetch)
    assert.deepEqual([a.canal, a.prestataire, a.configure], ['sms', 'Brevo', true])
    assert.deepEqual(await a.envoyer({ destinataire: '+33611111111', texte: 'Bonjour !' }), { id: '987654321' })
    assert.equal(appels.length, 1)
    assert.equal(appels[0].url, 'https://api.brevo.com/v3/transactionalSMS/send')
    assert.equal((appels[0].init.headers as Record<string, string>)['api-key'], CLE)
    assert.equal(appels[0].init.method, 'POST')
    assert.deepEqual(JSON.parse(String(appels[0].init.body)), {
      sender: EXPEDITEUR,
      recipient: '+33611111111',
      content: 'Bonjour !',
      type: 'transactional',
      tag: 'fidelite',
    })
  })

  test('mode test SMS : aucune appel réseau, `{ id: "test", test: true }`', async () => {
    const { fetch, appels } = fauxFetch({ statut: 201, corps: { messageId: 1 } })
    const a = adaptateurBrevoSms({ cleApi: CLE, expediteurSms: EXPEDITEUR, modeTest: true }, fetch)
    assert.deepEqual(await a.envoyer({ destinataire: '+33611111111', texte: 'x' }), { id: 'test', test: true })
    assert.equal(appels.length, 0, 'aucun appel réseau en mode test')
  })

  test('refus Brevo : erreur avec le statut HTTP, sans la clé ; non configuré : erreur claire, aucun appel', async () => {
    const { fetch, appels } = fauxFetch({ statut: 400, corps: { code: 'bad_request', message: 'sender invalid' } })
    const a = adaptateurBrevoSms({ cleApi: CLE, expediteurSms: EXPEDITEUR }, fetch)
    await assert.rejects(a.envoyer({ destinataire: '+33611111111', texte: 'x' }), (e: unknown) => {
      assert.match((e as Error).message, /Brevo a refusé l’envoi \(HTTP 400\)/)
      assert.doesNotMatch((e as Error).message, /cle-test/, 'aucun secret dans l’erreur')
      return true
    })
    const non = adaptateurBrevoSms(undefined, fetch)
    assert.equal(non.configure, false)
    await assert.rejects(non.envoyer({ destinataire: '+33611111111', texte: 'x' }), /Brevo non configuré/)
    assert.equal(appels.length, 1, 'aucun appel quand non configuré')
  })
})

describe('adaptateurBrevo (e-mail) : sandbox Brevo (mode test)', () => {
  test('bacASable : en-tête X-Sib-Sandbox dans le corps, List-Unsubscribe conservé, retour `test: true`', async () => {
    const { fetch, appels } = fauxFetch({ statut: 201, corps: { messageId: '<m1@brevo>' } })
    const a = adaptateurBrevo({ cleApi: CLE, expediteurEmail: 'contact@exemple.fr', expediteurNom: 'Asian Home Paris', bacASable: true }, fetch)
    assert.deepEqual(await a.envoyer({ destinataire: 'marc@exemple.fr', sujet: 'Bonjour', texte: 'x', entetes: { 'List-Unsubscribe': '<https://exemple.fr/desinscription>' } }), { id: '<m1@brevo>', test: true })
    assert.equal(appels.length, 1)
    const corps = JSON.parse(String(appels[0].init.body))
    assert.equal(corps.headers['X-Sib-Sandbox'], 'drop')
    assert.equal(corps.headers['List-Unsubscribe'], '<https://exemple.fr/desinscription>')
  })

  test('sans bacASable : pas d’en-tête sandbox, pas de `test`', async () => {
    const { fetch, appels } = fauxFetch({ statut: 201, corps: { messageId: '<m1@brevo>' } })
    const a = adaptateurBrevo({ cleApi: CLE, expediteurEmail: 'contact@exemple.fr', expediteurNom: 'Asian Home Paris' }, fetch)
    assert.deepEqual(await a.envoyer({ destinataire: 'marc@exemple.fr', texte: 'x' }), { id: '<m1@brevo>' })
    assert.deepEqual(JSON.parse(String(appels[0].init.body)).headers ?? {}, {})
  })
})

describe('Priorité SMS : Brevo d’abord, Twilio en repli', () => {
  test('Brevo SMS configuré → prestataire « Brevo » ; Twilio seul → « Twilio » ; aucun → 501', async () => {
    const { fetch, appels } = fauxFetch({ statut: 201, corps: { messageId: 1 } })
    const brevo = creerNotifications({ brevoSms: { cleApi: CLE, expediteurSms: EXPEDITEUR }, twilio: { accountSid: 'AC', authToken: 't', expediteur: '+33700000000' }, fetch })
    assert.equal(brevo.prestataire('sms'), 'Brevo')
    assert.deepEqual(brevo.statut(), { sms: true, email: false })
    await brevo.envoyer('sms', { destinataire: '+33611111111', texte: 'x' })
    assert.equal(appels[0].url, 'https://api.brevo.com/v3/transactionalSMS/send')

    const twilio = creerNotifications({ twilio: { accountSid: 'AC', authToken: 't', expediteur: '+33700000000' }, fetch })
    assert.equal(twilio.prestataire('sms'), 'Twilio')
    await twilio.envoyer('sms', { destinataire: '+33611111111', texte: 'x' })
    assert.match(appels[1].url, /api\.twilio\.com/)

    const aucun = creerNotifications({ fetch })
    assert.equal(aucun.prestataire('sms'), undefined)
    assert.deepEqual(aucun.statut(), { sms: false, email: false })
    await assert.rejects(aucun.envoyer('sms', { destinataire: '+33611111111', texte: 'x' }), /à brancher/)
  })
})

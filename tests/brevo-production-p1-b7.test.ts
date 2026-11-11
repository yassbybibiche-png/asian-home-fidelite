// P1-B7 — Brevo en production : validation SIMULÉE de bout en bout (mode test `BREVO_MODE_TEST=1`).
// Ce fichier ne couvre que la validation simulée : e-mail + SMS Brevo configurés ensemble, `/sante` combiné
// (`sms: true, email: true, smsPrestataire: 'Brevo', modeTest: true`), relances simulées des deux canaux
// (journal statut `test`, aucun envoi réel), et lecture des 5 variables depuis l'environnement.
// La recette RÉELLE (hors mode test, destinataires définis et consentants) n'est pas exécutée ici : elle est
// documentée pas à pas dans docs/BREVO.md §5 B et attend les clés + l'accord explicite de l'utilisateur.
// AUCUN appel réseau réel : le fetch Brevo est injecté (comme dans tests/relances-p1-b3.test.ts).
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { configDepuisEnv, creerNotifications } from '../server/notifications/index.ts'
import type { Client, EnvoiRelance } from '../src/types.ts'

const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const SITE = 'https://asian-home-fidelite.onrender.com'
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p1-b7-'))
after(() => rmSync(dossier, { recursive: true, force: true }))

/** Les 5 variables Render de docs/BREVO.md §4, lues depuis l'environnement. */
const ENV_COMPLET = {
  BREVO_API_KEY: 'xkeysib-test',
  BREVO_SENDER_EMAIL: 'contact@asianhomeparis.fr',
  BREVO_SENDER_NAME: 'Asian Home Paris',
  BREVO_SMS_SENDER: 'ASIANHOME',
  BREVO_MODE_TEST: '1',
}

describe('configDepuisEnv : les 5 variables Brevo ensemble (docs/BREVO.md §4)', () => {
  test('env complet + mode test → sms + e-mail Brevo, prestataire « Brevo », modeTest vrai', () => {
    const c = configDepuisEnv(ENV_COMPLET)
    // Les valeurs lues (clé, expéditeurs, drapeaux mode test) sont celles transmises aux adaptateurs.
    assert.deepEqual(c.brevo, { cleApi: 'xkeysib-test', expediteurEmail: 'contact@asianhomeparis.fr', expediteurNom: 'Asian Home Paris', bacASable: true })
    assert.deepEqual(c.brevoSms, { cleApi: 'xkeysib-test', expediteurSms: 'ASIANHOME', modeTest: true })
    assert.equal(c.modeTest, true)
    const n = creerNotifications(c)
    assert.deepEqual(n.statut(), { sms: true, email: true })
    assert.equal(n.prestataire('sms'), 'Brevo')
    assert.equal(n.prestataire('email'), 'Brevo')
    assert.equal(n.modeTest, true)
  })

  test('sans BREVO_MODE_TEST → même configuration, modeTest faux (c’est la variable qui bloque les envois réels)', () => {
    const { BREVO_MODE_TEST: _retiree, ...sansModeTest } = ENV_COMPLET
    const n = creerNotifications(configDepuisEnv(sansModeTest))
    assert.deepEqual(n.statut(), { sms: true, email: true })
    assert.equal(n.prestataire('sms'), 'Brevo')
    assert.equal(n.modeTest, false)
  })

  test('expéditeur SMS invalide (> 11 car.) → sms false, e-mail intact (canaux indépendants)', () => {
    const n = creerNotifications(configDepuisEnv({ ...ENV_COMPLET, BREVO_SMS_SENDER: 'ASIAN HOME PARIS' }))
    assert.deepEqual(n.statut(), { sms: false, email: true })
  })
})

/** Serveur SQLite + fetch Brevo injecté (enregistre les appels, ne touche jamais le réseau). */
async function demarrer(nom: string) {
  const horloge = { t: new Date('2026-11-10T11:00:00Z') }
  const appels: { url: string; corps: string; entetes: Record<string, string> }[] = []
  const fetch = (async (url: string, init: RequestInit) => {
    appels.push({ url, corps: String(init.body), entetes: init.headers as Record<string, string> })
    return new Response(JSON.stringify({ messageId: `<m${appels.length}@brevo>` }), { status: 201 })
  }) as unknown as typeof globalThis.fetch
  const app = await creerServeur({
    fichierDb: join(dossier, nom),
    adminPin: '98765432',
    pinInitial: '1234',
    version: 'test',
    urlPublique: SITE,
    maintenant: () => horloge.t,
    limitesPubliques: { inscriptionParIp: 1000, inscriptionParContact: 1000, ficheClientParIp: 1000, lectureParIp: 1000 },
    notifications: {
      // La même configuration que `configDepuisEnv(ENV_COMPLET)` (variables Render) : le serveur de test est branché
      // comme la production le sera, pas avec une configuration réécrite à la main.
      ...configDepuisEnv(ENV_COMPLET),
      fetch,
    },
  })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await globalThis.fetch(`${racine}/api/v1${chemin}`, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    const type = r.headers.get('content-type') ?? ''
    return { statut: r.status, contenu: type.includes('json') ? await r.json() : await r.text() }
  }
  const envois = async () => (await api('GET', `/commerces/${AH}/envois`, undefined, PIN)).contenu.envois as EnvoiRelance[]
  return { app, api, envois, appels }
}

describe('Validation simulée de bout en bout (mode test, e-mail + SMS Brevo)', () => {
  test('/sante combiné : sms true, email true, smsPrestataire Brevo, modeTest true', async () => {
    const s = await demarrer('brevo-prod-sante.db')
    try {
      const sante = (await s.api('GET', '/sante')).contenu
      assert.deepEqual(sante.integrations, { googleWallet: false, appleWallet: 'en_suspens', googleBusinessProfile: false, sms: true, email: true, smsPrestataire: 'Brevo', modeTest: true })
    } finally {
      await s.app.fermer()
    }
  })

  test('relance bienvenue e-mail puis SMS : 200 test, journal « test », sandbox e-mail, zéro appel SMS', async () => {
    const s = await demarrer('brevo-prod-simule.db')
    try {
      const mail = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Yassine', contact: 'yassbybibiche@gmail.com', consentementRelance: true }, PIN)).contenu.client as Client
      const okMail = await s.api('POST', `/commerces/${AH}/clients/${mail.id}/relance`, { modele: 'bienvenue', canal: 'email' }, PIN)
      assert.equal(okMail.statut, 200)
      assert.deepEqual([okMail.contenu.envoye, okMail.contenu.test, okMail.contenu.canal], [false, true, 'email'])
      assert.equal(s.appels.length, 1, 'un seul appel : la sandbox e-mail Brevo')
      assert.equal(s.appels[0].url, 'https://api.brevo.com/v3/smtp/email')
      assert.equal(JSON.parse(s.appels[0].corps).headers['X-Sib-Sandbox'], 'drop')
      const tel = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Yassine', contact: '0611111111', consentementRelance: true }, PIN)).contenu.client as Client
      const sms = await s.api('POST', `/commerces/${AH}/clients/${tel.id}/relance`, { modele: 'bienvenue', canal: 'sms' }, PIN)
      assert.equal(sms.statut, 200)
      assert.deepEqual([sms.contenu.envoye, sms.contenu.test, sms.contenu.canal], [false, true, 'sms'])
      assert.equal(s.appels.length, 1, 'le SMS simulé n’ajoute aucun appel réseau')
      // La simulation n'occupe pas le créneau anti-doublon du jour : la même relance simulée repasse (200, `test`).
      const sms2 = await s.api('POST', `/commerces/${AH}/clients/${tel.id}/relance`, { modele: 'bienvenue', canal: 'sms' }, PIN)
      assert.equal(sms2.statut, 200)
      assert.deepEqual([sms2.contenu.envoye, sms2.contenu.test], [false, true])
      assert.deepEqual((await s.envois()).map((x) => [x.canal, x.statut]).sort(), [
        ['email', 'test'],
        ['sms', 'test'],
        ['sms', 'test'],
      ])
    } finally {
      await s.app.fermer()
    }
  })
})

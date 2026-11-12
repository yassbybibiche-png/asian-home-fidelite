// Correction Codex point 10 — Brevo/Twilio : délai d'expiration sur chaque appel prestataire + statut « incertain ».
// Un appel qui dépasse le délai a PEUT-ÊTRE abouti : il est consigné `incertain` (502), jamais renvoyé automatiquement,
// mais le commerçant peut toujours relancer à la main. Prestataires simulés (fetch injecté), horloge figée : AUCUN
// appel réseau réel.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { ouvrirStockage } from '../server/stockage.ts'
import { statutColonneEnvoi } from '../server/stockage-supabase.ts'
import { adaptateurBrevo, adaptateurBrevoSms } from '../server/notifications/brevo.ts'
import { adaptateurTwilio } from '../server/notifications/twilio.ts'
import { DELAI_PRESTATAIRE_MS, estAbandon } from '../server/notifications/delai.ts'
import { libelleStatutEnvoi, relanceAutoDue } from '../src/lib/relances.ts'
import type { Client, EnvoiRelance, StatutEnvoi } from '../src/types.ts'

const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const SITE = 'https://asian-home-fidelite.onrender.com'
const JOUR = 24 * 3600_000
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-codex-10-'))
after(() => rmSync(dossier, { recursive: true, force: true }))

const MESSAGE = { destinataire: '+33611111111', texte: 'Bonjour', sujet: 'Test' }
const ADAPTATEURS = {
  'Brevo e-mail': (f: typeof fetch, delai?: number) => adaptateurBrevo({ cleApi: 'cle', expediteurEmail: 'a@b.fr', expediteurNom: 'AH' }, f, delai),
  'Brevo SMS': (f: typeof fetch, delai?: number) => adaptateurBrevoSms({ cleApi: 'cle', expediteurSms: 'ASIANHOME' }, f, delai),
  Twilio: (f: typeof fetch, delai?: number) => adaptateurTwilio({ accountSid: 'ACtest', authToken: 'jeton', expediteur: '+33700000000' }, f, delai),
}

describe('Point Codex 10 — adaptateurs : chaque appel prestataire est borné dans le temps', () => {
  test('délai par défaut nommé, de l’ordre de 10 s', () => {
    assert.equal(DELAI_PRESTATAIRE_MS, 10_000)
  })

  for (const [nom, creer] of Object.entries(ADAPTATEURS)) {
    test(`${nom} : l’init passé à fetch porte un signal d’abandon`, async () => {
      const inits: RequestInit[] = []
      const f = (async (_url: string, init: RequestInit) => {
        inits.push(init)
        return new Response(JSON.stringify({ messageId: 'x', sid: 'SM1' }), { status: 201 })
      }) as unknown as typeof fetch
      await creer(f).envoyer(MESSAGE)
      assert.equal(inits.length, 1)
      assert.ok(inits[0].signal instanceof AbortSignal, 'signal présent')
      assert.equal(inits[0].signal.aborted, false)
    })

    test(`${nom} : un prestataire qui ne répond jamais → rejet TimeoutError en temps borné`, async () => {
      // Faux fetch « pendu » : ne répond jamais, mais respecte le signal (comme le vrai fetch).
      const pendu = ((_url: string, init: RequestInit) =>
        new Promise((_ok, ko) => init.signal!.addEventListener('abort', () => ko(init.signal!.reason)))) as unknown as typeof fetch
      // Le minuteur d'AbortSignal.timeout ne retient pas le processus : un minuteur ordinaire le garde en vie le temps du test.
      const garde = setTimeout(() => {}, 5000)
      const debut = Date.now()
      try {
        await assert.rejects(creer(pendu, 30).envoyer(MESSAGE), (e: unknown) => estAbandon(e) && (e as Error).name === 'TimeoutError')
      } finally {
        clearTimeout(garde)
      }
      assert.ok(Date.now() - debut < 2000, 'échec en temps borné')
    })
  }

  test('mode test : toujours aucun appel réseau (Brevo SMS et Twilio)', async () => {
    let appels = 0
    const f = (async () => {
      appels++
      return new Response('{}')
    }) as unknown as typeof fetch
    assert.deepEqual(await adaptateurBrevoSms({ cleApi: 'cle', expediteurSms: 'ASIANHOME', modeTest: true }, f).envoyer(MESSAGE), { id: 'test', test: true })
    assert.deepEqual(await adaptateurTwilio({ accountSid: 'AC', authToken: 'j', expediteur: '+337', modeTest: true }, f).envoyer(MESSAGE), { id: 'test', test: true })
    assert.equal(appels, 0)
  })

  test('estAbandon : TimeoutError / AbortError seulement', () => {
    assert.equal(estAbandon(new DOMException('délai', 'TimeoutError')), true)
    assert.equal(estAbandon(new DOMException('annulé', 'AbortError')), true)
    assert.equal(estAbandon(new TypeError('fetch failed')), false)
    assert.equal(estAbandon(new Error('Brevo a refusé l’envoi (HTTP 500).')), false)
    assert.equal(estAbandon(undefined), false)
  })
})

describe('Point Codex 10 — statut « incertain »', () => {
  const client = (derniereVisite: string): Client => ({ id: 'k1', derniereVisite, visites: [derniereVisite] }) as unknown as Client
  const envoi = (statut: StatutEnvoi, date: string): Pick<EnvoiRelance, 'modele' | 'statut' | 'date' | 'jour'> => ({ modele: 'inactif', statut, date, jour: date.slice(0, 10) })

  test('relanceAutoDue : un envoi `incertain` bloque l’automatique comme `envoye` ; `erreur` non', () => {
    const t = new Date('2026-11-10T11:00:00Z')
    const c = client(new Date(t.getTime() - 40 * JOUR).toISOString())
    const ce_matin = '2026-11-10T08:00:00.000Z'
    assert.equal(relanceAutoDue('inactif', c, [], t), true)
    assert.equal(relanceAutoDue('inactif', c, [envoi('incertain', ce_matin)], t), false)
    assert.equal(relanceAutoDue('inactif', c, [envoi('envoye', ce_matin)], t), false)
    assert.equal(relanceAutoDue('inactif', c, [envoi('erreur', ce_matin)], t), true)
  })

  test('libellé du journal : dit que l’envoi a peut-être eu lieu', () => {
    assert.match(libelleStatutEnvoi('incertain'), /peut-être/)
    assert.doesNotMatch(libelleStatutEnvoi('incertain'), /rien envoyé|non envoyé/)
  })

  test('Supabase sans migration : la colonne `statut` reste dans la contrainte CHECK de 0007, hors de l’index anti-doublon', () => {
    const sql = readFileSync(new URL('../supabase/migrations/0007_relances.sql', import.meta.url), 'utf8')
    const check = /check \(statut in \(([^)]*)\)\)/.exec(sql)![1].split(',').map((s) => s.trim().replace(/'/g, ''))
    const tous: StatutEnvoi[] = ['en_cours', 'envoye', 'refuse', 'erreur', 'non_branche', 'test', 'incertain']
    for (const s of tous) assert.ok(check.includes(statutColonneEnvoi(s)), `${s} → ${statutColonneEnvoi(s)} accepté par la contrainte`)
    for (const s of tous) if (check.includes(s)) assert.equal(statutColonneEnvoi(s), s, 'statuts historiques inchangés')
    assert.ok(!['en_cours', 'envoye'].includes(statutColonneEnvoi('incertain')), 'incertain n’occupe pas l’index unique')
  })
})

type Mode = 'ok' | 'delai' | 'erreur'

async function demarrer(fichierDb: string, horloge: { t: Date }, etat: { mode: Mode; appels: number }) {
  const fetch = (async () => {
    etat.appels++
    if (etat.mode === 'delai') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    return new Response(JSON.stringify({ sid: `SM${etat.appels}` }), { status: etat.mode === 'erreur' ? 500 : 201 })
  }) as unknown as typeof globalThis.fetch
  const app = await creerServeur({
    fichierDb,
    adminPin: ADMIN,
    pinInitial: '1234',
    version: 'test',
    urlPublique: SITE,
    maintenant: () => horloge.t,
    limitesPubliques: { inscriptionParIp: 1000, inscriptionParContact: 1000, ficheClientParIp: 1000, lectureParIp: 1000 },
    notifications: { twilio: { accountSid: 'ACtest', authToken: 'jeton-twilio-test', expediteur: '+33700000000' }, fetch },
  })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
  async function api(methode: string, chemin: string, corps?: unknown) {
    const r = await globalThis.fetch(`${racine}/api/v1${chemin}`, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...PIN },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    return { statut: r.status, contenu: await r.json() }
  }
  const envois = async () => (await api('GET', `/commerces/${AH}/envois`)).contenu.envois as EnvoiRelance[]
  async function ouvrirTableau() {
    assert.equal((await api('GET', `/commerces/${AH}/etat`)).statut, 200)
    await app.relancesEnCours()
  }
  return { app, api, envois, ouvrirTableau }
}

/** Un client consentant absent depuis 40 jours : relance « inactif » due. */
async function clientInactif(s: Awaited<ReturnType<typeof demarrer>>, fichierDb: string, horloge: { t: Date }) {
  const il40 = new Date(horloge.t.getTime() - 40 * JOUR).toISOString()
  const c = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Ines', contact: '0611111111', consentementRelance: true })).contenu.client as Client
  const st = ouvrirStockage(fichierDb)
  st.majClient({ ...st.client(AH, c.id)!, derniereVisite: il40, visites: [il40], tampons: 1 })
  st.fermer()
  return c.id
}

describe('Point Codex 10 — serveur : délai dépassé = `incertain`, jamais renvoyé automatiquement', () => {
  test('relance manuelle qui expire → 502 « état inconnu », statut `incertain` ; le commerçant peut relancer à la main', async () => {
    const fichierDb = join(dossier, 'manuel.db')
    const horloge = { t: new Date('2026-11-10T11:00:00Z') }
    const etat = { mode: 'delai' as Mode, appels: 0 }
    const s = await demarrer(fichierDb, horloge, etat)
    try {
      const id = await clientInactif(s, fichierDb, horloge)
      const r = await s.api('POST', `/commerces/${AH}/clients/${id}/relance`, { modele: 'inactif' })
      assert.equal(r.statut, 502)
      assert.match(r.contenu.erreur ?? r.contenu.message, /inconnu/)
      assert.match(r.contenu.erreur ?? r.contenu.message, /ne sera pas renvoyé automatiquement/)
      assert.deepEqual((await s.envois()).map((e) => e.statut), ['incertain'])

      // Régularisation manuelle le même jour, même modèle : pas bloquée par l'index anti-doublon (409).
      etat.mode = 'ok'
      const r2 = await s.api('POST', `/commerces/${AH}/clients/${id}/relance`, { modele: 'inactif' })
      assert.equal(r2.statut, 200)
      assert.equal(r2.contenu.envoye, true)
      assert.equal(etat.appels, 2)
    } finally {
      await s.app.fermer()
    }
  })

  test('tournée automatique qui expire → `incertain` ; une reprise le même jour (redémarrage) et le lendemain ne renvoient rien', async () => {
    const fichierDb = join(dossier, 'auto.db')
    const horloge = { t: new Date('2026-11-10T11:00:00Z') }
    const etat = { mode: 'delai' as Mode, appels: 0 }
    let s = await demarrer(fichierDb, horloge, etat)
    try {
      await clientInactif(s, fichierDb, horloge)
      await s.api('PATCH', `/commerces/${AH}`, { relancesAuto: { inactif: true } })
      await s.ouvrirTableau()
      assert.equal(etat.appels, 1)
      assert.deepEqual((await s.envois()).map((e) => [e.statut, e.declencheur]), [['incertain', 'auto']])
      assert.equal((await s.envois())[0].statut === 'en_cours', false, 'la ligne réservée ne reste pas « en_cours »')
    } finally {
      await s.app.fermer()
    }

    // Redémarrage le même jour (la marque « tournée faite » en mémoire est perdue) : `relanceAutoDue` relit la base.
    etat.mode = 'ok'
    s = await demarrer(fichierDb, horloge, etat)
    try {
      await s.ouvrirTableau()
      assert.equal(etat.appels, 1, 'aucun renvoi automatique le même jour')
      horloge.t = new Date(horloge.t.getTime() + JOUR)
      await s.ouvrirTableau()
      assert.equal(etat.appels, 1, 'ni le lendemain (même période d’absence)')
      assert.deepEqual((await s.envois()).map((e) => e.statut), ['incertain'])
    } finally {
      await s.app.fermer()
    }
  })

  test('erreur ordinaire du prestataire (HTTP 500) → statut `erreur`, inchangé', async () => {
    const fichierDb = join(dossier, 'erreur.db')
    const horloge = { t: new Date('2026-11-10T11:00:00Z') }
    const etat = { mode: 'erreur' as Mode, appels: 0 }
    const s = await demarrer(fichierDb, horloge, etat)
    try {
      const id = await clientInactif(s, fichierDb, horloge)
      const r = await s.api('POST', `/commerces/${AH}/clients/${id}/relance`, { modele: 'inactif' })
      assert.equal(r.statut, 502)
      assert.match(r.contenu.erreur ?? r.contenu.message, /Relance non envoyée/)
      assert.deepEqual((await s.envois()).map((e) => e.statut), ['erreur'])
    } finally {
      await s.app.fermer()
    }
  })
})

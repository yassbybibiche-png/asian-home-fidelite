// Revue Codex vague nov12 (2/2) : une alerte 5xx échouée ne bloque plus toute nouvelle tentative pendant 1 heure.
// Plafond « 1 par heure » = alertes LIVRÉES (posé au succès) ; après un échec (rejet du prestataire) ou sans
// prestataire, nouvelle tentative après DELAI_REPRISE_ALERTE_5XX_MS (5 min), seuil (> 10 en 15 min) toujours exigé.
// Horloge injectée, adaptateur Brevo réel avec fetch injecté : aucun appel réseau.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { creerAlertes5xx, DELAI_REPRISE_ALERTE_5XX_MS, INTERVALLE_ALERTES_5XX_MS } from '../server/alertes.ts'
import { configDepuisEnv, creerNotifications } from '../server/notifications/index.ts'

const ALERTE = 'exploitant@example.com'
const BREVO = { BREVO_API_KEY: 'xkeysib-test', BREVO_SENDER_EMAIL: 'contact@asianhomeparis.fr', BREVO_SENDER_NAME: 'Asian Home Paris' }
const MINUTE = 60_000

/** Brevo simulé : en panne (rejet) ou rétabli (201) selon `panne` ; compte les tentatives. */
function brevoCommutable() {
  const etat = { panne: true, appels: 0 }
  const fetch = (async () => {
    etat.appels++
    if (etat.panne) throw new Error('réseau coupé')
    return new Response(JSON.stringify({ messageId: '<m@brevo>' }), { status: 201 })
  }) as unknown as typeof globalThis.fetch
  return { etat, fetch }
}

async function vider() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
}

function monter(notifications = creerNotifications({})) {
  const horloge = { t: Date.parse('2026-11-12T10:00:00Z') }
  const alertes = creerAlertes5xx({ destinataire: ALERTE, notifications, maintenant: () => new Date(horloge.t) })
  /** `k` réponses 503 à l'instant courant, puis laisse l'envoi en tâche de fond se terminer. */
  const erreurs = async (k: number) => {
    for (let i = 0; i < k; i++) alertes.enregistrer(503, () => '/api/v1/sessions')
    await vider()
  }
  const avancer = (ms: number) => (horloge.t += ms)
  return { erreurs, avancer }
}

const lignesAlerte = (m: { mock: { calls: { arguments: unknown[] }[] } }) =>
  m.mock.calls.map((c) => String(c.arguments[0])).filter((l) => l.startsWith('[alerte-5xx]'))

describe('Revue Codex nov12 — reprise bornée après échec d’une alerte 5xx', () => {
  test('constantes : reprise 5 min, plafond 1 h', () => {
    assert.equal(DELAI_REPRISE_ALERTE_5XX_MS, 5 * MINUTE)
    assert.equal(INTERVALLE_ALERTES_5XX_MS, 60 * MINUTE)
  })

  test('prestataire en échec à T : 1 tentative ; T+1 min : toujours 1 ; T+5 min (seuil toujours dépassé) : 2e tentative', async (t) => {
    const avert = t.mock.method(console, 'warn', () => {})
    const b = brevoCommutable()
    const s = monter(creerNotifications({ ...configDepuisEnv(BREVO), fetch: b.fetch }))
    await s.erreurs(15)
    assert.equal(b.etat.appels, 1, 'une rafale instantanée = une seule tentative')
    s.avancer(MINUTE)
    await s.erreurs(3)
    assert.equal(b.etat.appels, 1, 'T+1 min : reprise pas encore permise')
    s.avancer(4 * MINUTE - 1)
    await s.erreurs(1)
    assert.equal(b.etat.appels, 1, '1 ms avant les 5 minutes : toujours rien')
    s.avancer(1)
    await s.erreurs(1)
    assert.equal(b.etat.appels, 2, 'T+5 min : nouvelle tentative (et non 1 heure plus tard)')
    assert.deepEqual(lignesAlerte(avert), [
      '[alerte-5xx] alerte non envoyée : réseau coupé (11 réponses 5xx en 15 min)', // tentative à la 11e
      '[alerte-5xx] alerte non envoyée : réseau coupé (20 réponses 5xx en 15 min)',
    ])
  })

  test('sous le seuil, pas de reprise : l’échec n’autorise une tentative que si la fenêtre compte encore > 10 erreurs', async (t) => {
    t.mock.method(console, 'warn', () => {})
    const b = brevoCommutable()
    const s = monter(creerNotifications({ ...configDepuisEnv(BREVO), fetch: b.fetch }))
    await s.erreurs(11)
    assert.equal(b.etat.appels, 1)
    s.avancer(15 * MINUTE) // la fenêtre se vide
    await s.erreurs(10)
    assert.equal(b.etat.appels, 1, '10 erreurs dans la fenêtre : seuil non dépassé, pas de tentative')
    await s.erreurs(1)
    assert.equal(b.etat.appels, 2)
  })

  test('prestataire en échec puis rétabli : l’alerte finit livrée, et le plafond d’1 h court à partir de la livraison', async (t) => {
    t.mock.method(console, 'warn', () => {})
    const infos = t.mock.method(console, 'info', () => {})
    const b = brevoCommutable()
    const s = monter(creerNotifications({ ...configDepuisEnv(BREVO), fetch: b.fetch }))
    await s.erreurs(11) // T : échec
    assert.equal(b.etat.appels, 1)
    b.etat.panne = false
    s.avancer(DELAI_REPRISE_ALERTE_5XX_MS) // T+5 min : reprise, livrée
    await s.erreurs(1)
    assert.equal(b.etat.appels, 2)
    assert.deepEqual(lignesAlerte(infos), ['[alerte-5xx] alerte envoyée (12 réponses 5xx en 15 min)'])
    // Plafond compté depuis la livraison (T+5 min), pas depuis le premier échec (T).
    s.avancer(INTERVALLE_ALERTES_5XX_MS - 1) // T+65 min - 1 ms : plus d'1 h après l'échec, < 1 h après la livraison
    await s.erreurs(11)
    assert.equal(b.etat.appels, 2, 'moins d’1 h après la livraison : plafonné')
    s.avancer(1)
    await s.erreurs(1)
    assert.equal(b.etat.appels, 3, '1 h après la livraison : nouvelle alerte')
  })

  test('livrée en mode test (BREVO_MODE_TEST=1) : compte comme livrée, plafond d’1 h (pas de reprise à 5 min)', async (t) => {
    t.mock.method(console, 'info', () => {})
    const b = brevoCommutable()
    b.etat.panne = false
    const s = monter(creerNotifications({ ...configDepuisEnv({ ...BREVO, BREVO_MODE_TEST: '1' }), fetch: b.fetch }))
    await s.erreurs(11)
    assert.equal(b.etat.appels, 1)
    s.avancer(DELAI_REPRISE_ALERTE_5XX_MS)
    await s.erreurs(11)
    s.avancer(30 * MINUTE)
    await s.erreurs(11)
    assert.equal(b.etat.appels, 1, 'alerte simulée livrée : plafonnée 1 h')
  })

  test('aucun prestataire : 1 ligne par tentative — T, T+1 min : 1 ligne ; T+5 min : 2e ligne', async (t) => {
    const avert = t.mock.method(console, 'warn', () => {})
    const s = monter()
    await s.erreurs(12)
    assert.equal(lignesAlerte(avert).length, 1)
    s.avancer(MINUTE)
    await s.erreurs(5)
    assert.equal(lignesAlerte(avert).length, 1)
    s.avancer(4 * MINUTE)
    await s.erreurs(1)
    assert.deepEqual(lignesAlerte(avert), [
      '[alerte-5xx] alerte non envoyée (aucun prestataire e-mail configuré) : 11 réponses 5xx en 15 min',
      '[alerte-5xx] alerte non envoyée (aucun prestataire e-mail configuré) : 18 réponses 5xx en 15 min',
    ])
  })

  test('une seule tentative à la fois ; envoi lent : le plafond part de la livraison, pas du départ de l’envoi', async (t) => {
    t.mock.method(console, 'info', () => {})
    let liberer!: () => void
    let appels = 0
    const fetch = (async () => {
      appels++
      await new Promise<void>((ok) => (liberer = ok))
      return new Response('{}', { status: 201 })
    }) as unknown as typeof globalThis.fetch
    const s = monter(creerNotifications({ ...configDepuisEnv(BREVO), fetch }))
    await s.erreurs(11) // T : envoi parti, suspendu
    s.avancer(DELAI_REPRISE_ALERTE_5XX_MS)
    await s.erreurs(11)
    assert.equal(appels, 1, 'envoi en cours : aucune autre tentative')
    liberer() // livrée à T+5 min
    await vider()
    s.avancer(INTERVALLE_ALERTES_5XX_MS - DELAI_REPRISE_ALERTE_5XX_MS) // T+1 h : 55 min après la livraison
    await s.erreurs(11)
    assert.equal(appels, 1, 'moins d’1 h après la livraison : plafonné')
    s.avancer(DELAI_REPRISE_ALERTE_5XX_MS) // T+1 h 05 : 1 h après la livraison
    await s.erreurs(1)
    assert.equal(appels, 2)
    liberer()
    await vider()
  })
})

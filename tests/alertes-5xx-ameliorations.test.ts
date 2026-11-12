// Item E — Alerte e-mail sur rafale d'erreurs 5xx (`server/alertes.ts`, branchée sur `res.on('finish')` de
// `server/app.ts`, au même point que les logs structurés P2-Q6).
// Seuil : > 10 réponses 5xx en 15 min glissantes ; au plus 1 alerte par heure ; `ALERTE_EMAIL` absente = rien.
// AUCUN appel réseau réel : le fetch Brevo est injecté (comme dans tests/brevo-production-p1-b7.test.ts).
// Les 5xx sont de vraies réponses HTTP : `POST /api/v1/sessions` répond 503 quand SESSION_SECRET est absente.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { creerAlertes5xx, FENETRE_ALERTE_5XX_MS, INTERVALLE_ALERTES_5XX_MS } from '../server/alertes.ts'
import { empreinte } from '../server/logs.ts'
import { configDepuisEnv, creerNotifications, type ConfigNotifications } from '../server/notifications/index.ts'

const dossier = mkdtempSync(join(tmpdir(), 'fidelite-alertes-5xx-'))
after(() => rmSync(dossier, { recursive: true, force: true }))

const ALERTE = 'exploitant@example.com'
const BREVO = { BREVO_API_KEY: 'xkeysib-test', BREVO_SENDER_EMAIL: 'contact@asianhomeparis.fr', BREVO_SENDER_NAME: 'Asian Home Paris' }
const MINUTE = 60_000

type Appel = { url: string; corps: { to: { email: string }[]; subject: string; textContent: string; headers?: Record<string, string> } }
type Fetch = typeof globalThis.fetch

/** Faux fetch Brevo : enregistre les appels, ne touche jamais le réseau. */
function fauxBrevo(reponse: () => Promise<Response> = async () => new Response(JSON.stringify({ messageId: '<m@brevo>' }), { status: 201 })) {
  const appels: Appel[] = []
  const fetch = (async (url: string, init: RequestInit) => {
    appels.push({ url, corps: JSON.parse(String(init.body)) })
    return reponse()
  }) as unknown as Fetch
  return { appels, fetch }
}

/** Laisse passer le `finish` et l'envoi en tâche de fond (quelques tours de boucle). */
async function vider() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
  await new Promise((r) => setTimeout(r, 20))
}

let n = 0
async function demarrer(o: { alerteEmail?: string; notifications?: ConfigNotifications } = {}) {
  const horloge = { t: new Date('2026-11-12T10:00:00Z') }
  const app = await creerServeur({
    fichierDb: join(dossier, `alertes-${++n}.db`),
    adminPin: '98765432',
    pinInitial: '1234',
    version: 'test',
    maintenant: () => horloge.t,
    // Pas de SESSION_SECRET : POST /sessions → 503 (5xx réelle, sans rien casser).
    limitesPubliques: { sessionParIp: 100_000, ficheClientParIp: 100_000, lectureParCarte: 100_000, lectureParIp: 100_000 },
    ...(o.alerteEmail !== undefined ? { alerteEmail: o.alerteEmail } : {}),
    ...(o.notifications ? { notifications: o.notifications } : {}),
  })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
  const requete = async (methode: string, chemin: string) => {
    const r = await globalThis.fetch(`${racine}${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json' }, body: methode === 'GET' ? undefined : '{}' })
    await r.arrayBuffer()
    return r.status
  }
  /** `k` réponses 503 réelles. */
  const erreurs = async (k: number, chemin = '/api/v1/sessions') => {
    for (let i = 0; i < k; i++) assert.equal(await requete('POST', chemin), 503)
    await vider()
  }
  const avancer = (ms: number) => {
    horloge.t = new Date(horloge.t.getTime() + ms)
  }
  return { app, requete, erreurs, avancer }
}

describe('Alerte 5xx de bout en bout (serveur HTTP réel, fetch Brevo injecté)', () => {
  test('1. seuil : 10 réponses 5xx → aucune alerte ; la 11e → exactement 1 e-mail à ALERTE_EMAIL', async () => {
    const b = fauxBrevo()
    const s = await demarrer({ alerteEmail: ALERTE, notifications: { ...configDepuisEnv(BREVO), fetch: b.fetch } })
    try {
      await s.erreurs(10)
      assert.equal(b.appels.length, 0, '10 erreurs = seuil non dépassé')
      await s.erreurs(1)
      assert.equal(b.appels.length, 1)
      const { url, corps } = b.appels[0]
      assert.equal(url, 'https://api.brevo.com/v3/smtp/email')
      assert.deepEqual(corps.to, [{ email: ALERTE }])
      assert.match(corps.subject, /11 erreurs serveur \(5xx\) en 15 min/)
      assert.match(corps.textContent, /^11 réponses en erreur serveur \(5xx\) en 15 minutes/)
      assert.match(corps.textContent, /- \/api\/v1\/sessions : 11/)
      assert.match(corps.textContent, /Fenêtre : 2026-11-12T09:45:00\.000Z → 2026-11-12T10:00:00\.000Z/)
      assert.equal(corps.headers?.['X-Sib-Sandbox'], undefined, 'hors mode test : pas de sandbox')
    } finally {
      await s.app.fermer()
    }
  })

  test('2. rafale : 30 de plus dans l’heure → toujours 1 alerte ; 1 h plus tard, une nouvelle rafale → 1 de plus', async () => {
    const b = fauxBrevo()
    const s = await demarrer({ alerteEmail: ALERTE, notifications: { ...configDepuisEnv(BREVO), fetch: b.fetch } })
    try {
      await s.erreurs(11)
      assert.equal(b.appels.length, 1)
      for (let i = 0; i < 3; i++) {
        s.avancer(10 * MINUTE) // 30 min au total, toujours < 1 h depuis l'alerte
        await s.erreurs(10)
      }
      assert.equal(b.appels.length, 1, 'plafond : 1 alerte par heure, même si les 5xx continuent')
      s.avancer(INTERVALLE_ALERTES_5XX_MS - 30 * MINUTE - 1)
      await s.erreurs(11)
      assert.equal(b.appels.length, 1, 'encore 1 ms avant l’heure : toujours plafonné')
      s.avancer(FENETRE_ALERTE_5XX_MS) // l'heure est passée et la fenêtre précédente est vide
      await s.erreurs(10)
      assert.equal(b.appels.length, 1, 'l’heure est passée mais la nouvelle rafale (10) n’a pas franchi le seuil')
      await s.erreurs(1)
      assert.equal(b.appels.length, 2, 'nouvelle rafale au-delà du seuil, plus d’une heure après : 1 nouvelle alerte')
    } finally {
      await s.app.fermer()
    }
  })

  test('3. fenêtre glissante : des 5xx espacés de plus de 15 min ne s’accumulent pas', async () => {
    const b = fauxBrevo()
    const s = await demarrer({ alerteEmail: ALERTE, notifications: { ...configDepuisEnv(BREVO), fetch: b.fetch } })
    try {
      // 4 paquets de 10 erreurs espacés de 15 min : 40 au total, jamais plus de 10 dans une fenêtre.
      for (let i = 0; i < 4; i++) {
        await s.erreurs(10)
        s.avancer(FENETRE_ALERTE_5XX_MS)
      }
      assert.equal(b.appels.length, 0)
      // Glissement : 6 erreurs, 14 min, 5 erreurs → 11 dans la fenêtre → alerte.
      await s.erreurs(6)
      s.avancer(14 * MINUTE)
      await s.erreurs(5)
      assert.equal(b.appels.length, 1, '11 erreurs dans les 15 dernières minutes')
    } finally {
      await s.app.fermer()
    }
  })

  test('4. sans ALERTE_EMAIL (absente ou vide) : rafale de 5xx → aucun envoi', async () => {
    for (const alerteEmail of [undefined, '', '   ']) {
      const b = fauxBrevo()
      const s = await demarrer({ alerteEmail, notifications: { ...configDepuisEnv(BREVO), fetch: b.fetch } })
      try {
        await s.erreurs(40)
        assert.equal(b.appels.length, 0, `ALERTE_EMAIL=${JSON.stringify(alerteEmail)}`)
      } finally {
        await s.app.fermer()
      }
    }
  })

  test('5. les réponses non-5xx (200, 404, 400) ne comptent pas', async () => {
    const b = fauxBrevo()
    const s = await demarrer({ alerteEmail: ALERTE, notifications: { ...configDepuisEnv(BREVO), fetch: b.fetch } })
    try {
      for (let i = 0; i < 15; i++) {
        assert.equal(await s.requete('GET', '/api/v1/sante'), 200)
        assert.equal(await s.requete('GET', '/api/v1/inconnue'), 404)
        assert.equal(await s.requete('POST', '/api/v1/commerces/c-asian-home-paris/caisse/passage'), 401)
      }
      await s.erreurs(10)
      assert.equal(b.appels.length, 0, '45 non-5xx + 10 5xx : seuil non dépassé')
      await s.erreurs(1)
      assert.equal(b.appels.length, 1)
    } finally {
      await s.app.fermer()
    }
  })

  test('6. mode test (BREVO_MODE_TEST=1) : chemin simulé — sandbox Brevo, rien livré, ligne de log « mode test »', async (t) => {
    const infos = t.mock.method(console, 'info', () => {})
    const b = fauxBrevo()
    const s = await demarrer({ alerteEmail: ALERTE, notifications: { ...configDepuisEnv({ ...BREVO, BREVO_MODE_TEST: '1' }), fetch: b.fetch } })
    try {
      await s.erreurs(11)
      // Même chemin que les relances en mode test : un seul appel, au faux fetch, marqué sandbox (`drop` = rien livré).
      assert.equal(b.appels.length, 1)
      assert.equal(b.appels[0].corps.headers?.['X-Sib-Sandbox'], 'drop')
      const lignes = infos.mock.calls.map((c) => String(c.arguments[0])).filter((l) => l.startsWith('[alerte-5xx]'))
      assert.deepEqual(lignes, ['[alerte-5xx] mode test : alerte simulée, rien envoyé (11 réponses 5xx en 15 min)'])
      assert.ok(!lignes.some((l) => l.includes(ALERTE)), 'l’adresse du destinataire n’est jamais journalisée')
    } finally {
      await s.app.fermer()
    }
  })
})

describe('Alerte 5xx : robustesse et contenu', () => {
  test('sans prestataire e-mail : alerte journalisée « non envoyée », réponses 503 intactes, aucune exception', async (t) => {
    const avert = t.mock.method(console, 'warn', () => {})
    const s = await demarrer({ alerteEmail: ALERTE })
    try {
      await s.erreurs(12) // chaque réponse reste un 503 (vérifié dans `erreurs`)
      const lignes = avert.mock.calls.map((c) => String(c.arguments[0])).filter((l) => l.startsWith('[alerte-5xx]'))
      assert.deepEqual(lignes, ['[alerte-5xx] alerte non envoyée (aucun prestataire e-mail configuré) : 11 réponses 5xx en 15 min'])
    } finally {
      await s.app.fermer()
    }
  })

  test('prestataire bloqué (fetch qui ne répond jamais) : la réponse HTTP n’attend pas l’envoi', async () => {
    let liberer!: () => void
    const bloque = new Promise<Response>((ok) => (liberer = () => ok(new Response('{}', { status: 201 }))))
    const b = fauxBrevo(() => bloque)
    const s = await demarrer({ alerteEmail: ALERTE, notifications: { ...configDepuisEnv(BREVO), fetch: b.fetch } })
    try {
      await s.erreurs(10)
      const debut = Date.now()
      assert.equal(await s.requete('POST', '/api/v1/sessions'), 503)
      await vider()
      assert.equal(b.appels.length, 1, 'l’envoi est parti (et reste suspendu)')
      assert.equal(await s.requete('GET', '/api/v1/sante'), 200, 'le serveur continue de répondre')
      assert.ok(Date.now() - debut < 2000)
    } finally {
      liberer()
      await s.app.fermer()
    }
  })

  test('prestataire en erreur (HTTP 500 / rejet) : journalisé, jamais propagé à la requête', async (t) => {
    const avert = t.mock.method(console, 'warn', () => {})
    const b = fauxBrevo(async () => {
      throw new Error('réseau coupé')
    })
    const s = await demarrer({ alerteEmail: ALERTE, notifications: { ...configDepuisEnv(BREVO), fetch: b.fetch } })
    try {
      await s.erreurs(11)
      assert.equal(b.appels.length, 1)
      assert.equal(await s.requete('GET', '/api/v1/sante'), 200)
      const lignes = avert.mock.calls.map((c) => String(c.arguments[0])).filter((l) => l.startsWith('[alerte-5xx]'))
      assert.deepEqual(lignes, ['[alerte-5xx] alerte non envoyée : réseau coupé (11 réponses 5xx en 15 min)'])
    } finally {
      await s.app.fermer()
    }
  })

  test('routes de l’e-mail masquées comme dans les logs : aucun identifiant brut, ni requête', async () => {
    const b = fauxBrevo()
    const s = await demarrer({ alerteEmail: ALERTE, notifications: { ...configDepuisEnv(BREVO), fetch: b.fetch } })
    try {
      const id = 'cl-secret-0612345678'
      await s.erreurs(6, `/api/v1/cartes/${id}/jeton?acces=jeton-tres-secret`)
      await s.erreurs(5)
      assert.equal(b.appels.length, 1)
      const texte = b.appels[0].corps.textContent
      assert.ok(!texte.includes(id) && !texte.includes('0612345678') && !texte.includes('jeton-tres-secret') && !texte.includes('acces='))
      assert.match(texte, new RegExp(`- /api/v1/cartes/${empreinte(id)}/jeton : 6\n- /api/v1/sessions : 5`))
    } finally {
      await s.app.fermer()
    }
  })
})

describe('creerAlertes5xx (unité)', () => {
  test('sans destinataire : inactif, la route n’est même pas calculée', () => {
    const notifications = creerNotifications({})
    const a = creerAlertes5xx({ destinataire: undefined, notifications, maintenant: () => new Date() })
    assert.equal(a.actif, false)
    a.enregistrer(500, () => assert.fail('route calculée alors que l’alerte est inactive'))
  })

  test('statut < 500 : route non calculée ; erreur interne avalée (jamais d’exception vers la requête)', () => {
    const a = creerAlertes5xx({ destinataire: ALERTE, notifications: creerNotifications({}), maintenant: () => new Date() })
    assert.equal(a.actif, true)
    a.enregistrer(499, () => assert.fail('route calculée pour un non-5xx'))
    assert.doesNotThrow(() =>
      a.enregistrer(500, () => {
        throw new Error('masquage en panne')
      }),
    )
  })
})

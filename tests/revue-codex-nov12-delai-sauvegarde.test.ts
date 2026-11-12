// Revue Codex vague nov12 (1/2) : le téléchargement de sauvegarde (item D) a son propre délai (120 s, celui des
// pièces jointes binaires — la ligne d'appel de `sauvegarde()` est épinglée telle quelle par
// sauvegarde-admin-ameliorations) au lieu du délai générique du client API, et l'expiration de NOTRE délai a un message distinct d'une panne réseau.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { creerClientApi, DELAI_TELECHARGEMENT_MS, ErreurApi, MESSAGE_DELAI_REQUETE, MESSAGE_HORS_LIGNE, type Acces } from '../src/data/api.ts'

const ADMIN: Acces = { role: 'admin', jeton: 'j' }

/** Faux fetch qui répond après `ms` (comme un serveur lent) et respecte l'annulation du signal, comme le vrai. */
function fetchLent(ms: number): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const signal = init?.signal ?? undefined
    await new Promise<void>((ok, ko) => {
      const minuterie = setTimeout(ok, ms)
      signal?.addEventListener('abort', () => {
        clearTimeout(minuterie)
        ko(signal.reason)
      })
    })
    if (String(url).endsWith('/admin/sauvegarde')) {
      return new Response(new Uint8Array([0x1f, 0x8b, 1, 2]), { headers: { 'Content-Disposition': 'attachment; filename="asian-home-test.json.gz"' } })
    }
    return Response.json({ commerces: [] })
  }) as typeof fetch
}

describe('Revue Codex nov12 — délai propre du téléchargement de sauvegarde', () => {
  test('client au délai par défaut très court : sauvegarde() aboutit, un appel ordinaire du même client expire', async () => {
    const api = creerClientApi('http://x/api/v1', fetchLent(80), 20)
    const r = await api.sauvegarde(ADMIN)
    assert.equal(r.nom, 'asian-home-test.json.gz')
    assert.deepEqual([...new Uint8Array(await r.contenu.arrayBuffer())], [0x1f, 0x8b, 1, 2])
    await assert.rejects(api.commerces(), (e: ErreurApi) => e instanceof ErreurApi && e.horsLigne && e.message === MESSAGE_DELAI_REQUETE)
  })

  test('sauvegarde() : délai de 120 s (pièce jointe binaire), un `delaiMs` explicite garde la priorité', async () => {
    assert.equal(DELAI_TELECHARGEMENT_MS, 120_000)
    const source = readFileSync(new URL('../src/data/api.ts', import.meta.url), 'utf8')
    assert.match(source, /signalDelai\(options\.delaiMs \?\? \(options\.binaire \? DELAI_TELECHARGEMENT_MS : delaiMs\)\)/)
    assert.match(source, /requete\('GET', '\/admin\/sauvegarde', \{ acces, binaire: true \}\)/)
  })
})

describe('Revue Codex nov12 — délai dépassé ≠ panne réseau', () => {
  test('expiration de notre délai → message « délai dépassé », statut 0 (réessais de réveil inchangés)', async () => {
    const api = creerClientApi('http://x/api/v1', fetchLent(80), 20)
    await assert.rejects(api.commerces(), (e: ErreurApi) => {
      assert.ok(e instanceof ErreurApi)
      assert.equal(e.statut, 0)
      assert.equal(e.horsLigne, true)
      assert.equal(e.message, MESSAGE_DELAI_REQUETE)
      assert.equal(MESSAGE_DELAI_REQUETE, 'Délai dépassé : le serveur met trop longtemps à répondre. Réessayez.')
      return true
    })
  })

  test('panne réseau (TypeError de fetch) → message hors ligne habituel', async () => {
    const api = creerClientApi('http://x/api/v1', async () => {
      throw new TypeError('fetch failed')
    })
    await assert.rejects(api.commerces(), (e: ErreurApi) => e instanceof ErreurApi && e.horsLigne && e.message === MESSAGE_HORS_LIGNE)
  })

  test('délai expiré pendant la lecture du corps (en-têtes reçus, corps lent) → « délai dépassé »', async () => {
    const api = creerClientApi(
      'http://x/api/v1',
      (async (_url: string, init?: RequestInit) => {
        const signal = init!.signal!
        const corps = new ReadableStream({
          start(c) {
            const minuterie = setTimeout(() => {
              c.enqueue(new TextEncoder().encode('[]'))
              c.close()
            }, 80)
            signal.addEventListener('abort', () => {
              clearTimeout(minuterie)
              c.error(signal.reason)
            })
          },
        })
        return new Response(corps, { headers: { 'Content-Type': 'application/json' } })
      }) as typeof fetch,
      20,
    )
    await assert.rejects(api.commerces(), (e: ErreurApi) => e instanceof ErreurApi && e.message === MESSAGE_DELAI_REQUETE)
  })

  test('erreur de lecture du corps sans délai expiré (JSON invalide) → message hors ligne habituel', async () => {
    const api = creerClientApi('http://x/api/v1', async () => new Response('pas du json', { headers: { 'Content-Type': 'application/json' } }))
    await assert.rejects(api.commerces(), (e: ErreurApi) => e instanceof ErreurApi && e.message === MESSAGE_HORS_LIGNE)
  })
})

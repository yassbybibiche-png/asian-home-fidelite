// P1-B8 — Google Business (configuration + recette) : garde-fous côté code, Google SIMULÉ (fetch injecté).
// La configuration réelle (projet Cloud, OAuth, approbation Google) et la recette réelle (import + 1 réponse de
// test sur la vraie fiche) ne sont pas exécutées ici : elles sont documentées pas à pas dans
// docs/GOOGLE-BUSINESS.md et attendent le compte Google du restaurant. AUCUN appel réseau réel.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, type OptionsServeur } from '../server/app.ts'
import {
  emplacementAImporter,
  ErreurGoogle,
  listerAvisGoogle,
  publierReponseGoogle,
  TAILLE_MAX_REPONSE_GOOGLE_OCTETS,
} from '../server/google-business.ts'

const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const CLES = { clientId: 'id-client-test.apps.googleusercontent.com', clientSecret: 'SECRET-CLIENT-DE-TEST-ne-doit-jamais-sortir' }
const EMPLACEMENT = 'accounts/111/locations/222'
const NOM_AVIS = `${EMPLACEMENT}/reviews/r1`
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p1-b8-'))
after(() => rmSync(dossier, { recursive: true, force: true }))

/** Faux fetch qui enregistre les appels et refuse tout le reste (aucun appel réseau réel). */
function fauxFetch() {
  const appels: { url: string; methode: string; corps?: string }[] = []
  const f = (async (url: string, init: RequestInit = {}) => {
    appels.push({ url, methode: init.method ?? 'GET', corps: init.body ? String(init.body) : undefined })
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === 'https://oauth2.googleapis.com/token') {
      const p = new URLSearchParams(String(init.body))
      if (p.get('grant_type') === 'authorization_code' && p.get('code') === 'bon-code') {
        return json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, scope: 'https://www.googleapis.com/auth/business.manage' })
      }
      if (p.get('grant_type') === 'refresh_token' && p.get('refresh_token') === 'rt-1') return json({ access_token: 'at-2', expires_in: 3600 })
      return json({ error: 'invalid_grant' }, 400)
    }
    if (url === 'https://mybusiness.googleapis.com/v4/accounts/111/locations/222/reviews?pageSize=50') {
      return json({ reviews: [{ name: NOM_AVIS, reviewId: 'r1', reviewer: { displayName: 'Client 1' }, starRating: 'FIVE', comment: 'Super !', createTime: '2026-11-09T12:00:00Z' }] })
    }
    if (url === `https://mybusiness.googleapis.com/v4/${NOM_AVIS}/reply` && init.method === 'PUT') {
      return json({ updateTime: '2026-11-10T10:00:00Z' })
    }
    return json({ error: 'inconnu' }, 404)
  }) as typeof fetch
  return { f, appels }
}

describe('publierReponseGoogle : garde-fous avant tout appel à Google', () => {
  test('réponse valable → PUT …/reply avec le commentaire, jeton Bearer, updateTime lu', async () => {
    const g = fauxFetch()
    const r = await publierReponseGoogle(g.f, 'at-1', NOM_AVIS, 'Merci beaucoup !')
    assert.deepEqual(r, { updateTime: '2026-11-10T10:00:00Z' })
    assert.equal(g.appels.length, 1)
    assert.equal(g.appels[0].url, `https://mybusiness.googleapis.com/v4/${NOM_AVIS}/reply`)
    assert.equal(JSON.parse(g.appels[0].corps!).comment, 'Merci beaucoup !')
  })

  test('réponse vide ou espaces seuls → 400 explicite, AUCUN appel à Google', async () => {
    for (const vide of ['', '   ', '\n']) {
      const g = fauxFetch()
      await assert.rejects(publierReponseGoogle(g.f, 'at-1', NOM_AVIS, vide), (e: unknown) => {
        assert.ok(e instanceof ErreurGoogle && e.statut === 400 && /vide/.test(e.message))
        return true
      })
      assert.equal(g.appels.length, 0)
    }
  })

  test('réponse > 4 096 OCTETS (limite Google, pas caractères) → 400 explicite, aucun appel', async () => {
    assert.equal(TAILLE_MAX_REPONSE_GOOGLE_OCTETS, 4096)
    const g = fauxFetch()
    await assert.rejects(publierReponseGoogle(g.f, 'at-1', NOM_AVIS, 'x'.repeat(4097)), (e: unknown) => {
      assert.ok(e instanceof ErreurGoogle && e.statut === 400 && /4096 octets/.test(e.message) && /4097 octets/.test(e.message))
      return true
    })
    // Multi-octets : 1 400 caractères chinois = 4 200 octets → refusé, même sous le plafond de 2 000 caractères.
    await assert.rejects(publierReponseGoogle(g.f, 'at-1', NOM_AVIS, '漢'.repeat(1400)), (e: unknown) => {
      assert.ok(e instanceof ErreurGoogle && e.statut === 400 && /4200 octets/.test(e.message))
      return true
    })
    assert.equal(g.appels.length, 0)
    // À la limite exacte en octets : l'appel part (4 096 × « x », ou 2 048 × « é » = 4 096 octets).
    assert.ok(await publierReponseGoogle(g.f, 'at-1', NOM_AVIS, 'x'.repeat(4096)))
    assert.ok(await publierReponseGoogle(g.f, 'at-1', NOM_AVIS, 'é'.repeat(2048)))
    assert.equal(g.appels.length, 2)
  })

  test('identifiant d’avis mal formé → 400 explicite, aucun appel', async () => {
    const g = fauxFetch()
    for (const nom of ['reviews/r1', `${EMPLACEMENT}/reviews/r1?x=1`, `${EMPLACEMENT}/reviews/r1#ancre`, `${EMPLACEMENT}/reviews/..`, 'accounts/111/locations/222/reviews/']) {
      await assert.rejects(publierReponseGoogle(g.f, 'at-1', nom, 'Merci'), (e: unknown) => {
        assert.ok(e instanceof ErreurGoogle && e.statut === 400 && /Identifiant d’avis Google invalide/.test(e.message))
        return true
      })
    }
    assert.equal(g.appels.length, 0)
  })
})

describe('listerAvisGoogle et emplacementAImporter : fiche invalide refusée explicitement', () => {
  test('emplacement mal formé → 409 explicite, aucun appel à Google', async () => {
    const g = fauxFetch()
    for (const fiche of ['nimporte-quoi', 'accounts/111/locations/222?x=1', 'accounts/111/locations/..', 'accounts/111/locations/222#ancre']) {
      await assert.rejects(listerAvisGoogle(g.f, 'at-1', fiche), (e: unknown) => {
        assert.ok(e instanceof ErreurGoogle && e.statut === 409 && /Fiche Google invalide/.test(e.message))
        return true
      })
    }
    assert.equal(g.appels.length, 0)
  })

  test('emplacement valable → appel à la bonne URL, avis lus', async () => {
    const g = fauxFetch()
    const avis = await listerAvisGoogle(g.f, 'at-1', EMPLACEMENT)
    assert.equal(avis.length, 1)
    assert.equal(avis[0].reviewId, 'r1')
  })

  test('emplacementAImporter : configuré valable > stocké ; configuré mal renseigné → 409 (jamais ignoré silencieusement) ; sinon stocké, sinon undefined', () => {
    assert.equal(emplacementAImporter(EMPLACEMENT, 'accounts/999/locations/888'), EMPLACEMENT)
    assert.equal(emplacementAImporter(undefined, EMPLACEMENT), EMPLACEMENT)
    assert.equal(emplacementAImporter(undefined, undefined), undefined)
    assert.equal(emplacementAImporter(undefined, 'nimporte-quoi'), undefined)
    assert.throws(() => emplacementAImporter('nimporte-quoi', EMPLACEMENT), (e: unknown) => {
      assert.ok(e instanceof ErreurGoogle && e.statut === 409 && /GOOGLE_BUSINESS_LOCATION mal renseignée/.test(e.message))
      return true
    })
  })
})

// ---------- Serveur (Google simulé, parcours OAuth complet) ----------

async function demarrer(nom: string, options: Partial<OptionsServeur> = {}) {
  const horloge = { t: new Date('2026-11-10T10:00:00Z') }
  const app = await creerServeur({ fichierDb: join(dossier, nom), adminPin: '98765432', pinInitial: '1234', version: 'test', urlPublique: 'https://app.test', maintenant: () => horloge.t, ...options })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, { method: methode, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...entetes }, body: corps === undefined ? undefined : JSON.stringify(corps) })
    const texte = await r.text()
    let contenu: unknown = texte
    try {
      contenu = JSON.parse(texte)
    } catch {
      // réponse vide (302)
    }
    return { statut: r.status, contenu: contenu as { erreur?: string; importes?: number }, texte }
  }
  async function connecter() {
    const url = new URL((await api('GET', `/commerces/${AH}/google/auth?format=json`, undefined, PIN)).contenu.url as string)
    return api('GET', `/commerces/${AH}/google/callback?code=bon-code&state=${encodeURIComponent(url.searchParams.get('state')!)}`)
  }
  return { app, api, connecter, horloge }
}

describe('Route import-avis (Google simulé) : GOOGLE_BUSINESS_LOCATION mal renseignée → 409 explicite', () => {
  test('import refusé avant tout appel aux API Business Profile ; une valeur valable importe', async () => {
    const g = fauxFetch()
    const s = await demarrer('emplacement-invalide.db', { googleBusiness: { ...CLES, emplacement: 'nimporte-quoi', fetch: g.f } })
    try {
      await s.connecter()
      // Jeton expiré : sous l'ancien ordre, l'import aurait rafraîchi le jeton avant de refuser la fiche.
      s.horloge.t = new Date(s.horloge.t.getTime() + 2 * 3600_000)
      const appelsApresConnexion = g.appels.length
      const r = await s.api('POST', `/commerces/${AH}/google/import-avis`, undefined, PIN)
      assert.equal(r.statut, 409)
      assert.match(r.contenu.erreur ?? '', /GOOGLE_BUSINESS_LOCATION mal renseignée/)
      assert.equal(g.appels.length, appelsApresConnexion, 'aucun appel à Google (ni rafraîchissement) avant le refus')
      for (const secret of ['at-1', 'rt-1', CLES.clientSecret]) assert.ok(!r.texte.includes(secret), secret)
    } finally {
      await s.app.fermer()
    }
    const g2 = fauxFetch()
    const s2 = await demarrer('emplacement-valable.db', { googleBusiness: { ...CLES, emplacement: EMPLACEMENT, fetch: g2.f } })
    try {
      await s2.connecter()
      const r = await s2.api('POST', `/commerces/${AH}/google/import-avis`, undefined, PIN)
      assert.equal(r.statut, 200)
      assert.equal(r.contenu.importes, 1)
    } finally {
      await s2.app.fermer()
    }
  })
})

describe('Écran Avis et documentation (P1-B8)', () => {
  test('Avis.tsx : réponse plafonnée à 2 000 caractères côté front (comme la route PATCH avis)', () => {
    const src = readFileSync('src/pages/Avis.tsx', 'utf8')
    assert.match(src, /id=\{`rep-\$\{a\.id\}`\}.*maxLength=\{2000\}/s)
  })

  test('docs/GOOGLE-BUSINESS.md : état P1-B8, recette réelle (import + 1 réponse de test) marquée « attend le compte », garde-fous documentés', () => {
    const doc = readFileSync('docs/GOOGLE-BUSINESS.md', 'utf8')
    assert.match(doc, /État au 11\/11\/2026 \(lot P1-B8\)/)
    assert.match(doc, /attend le compte/)
    assert.match(doc, /4 096 octets/)
    assert.match(doc, /GOOGLE_BUSINESS_LOCATION`?\s+mal renseignée/)
    assert.match(doc, /Réponse vide/)
  })
})

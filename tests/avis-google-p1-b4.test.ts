// P1-B4 — Avis Google : OAuth Business Profile (scope business.manage), import des avis, réponses selon
// `reglesReponseAuto`, publication après validation manuelle. AUCUN appel à Google : sans clés → 501 ; avec des clés de
// test, Google est SIMULÉ (fetch injecté). Supabase (jetons dans `meta`, import) : voir la fin du fichier.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, type OptionsServeur } from '../server/app.ts'
import { ouvrirStockage } from '../server/stockage.ts'
import {
  chiffrerJetons,
  configGoogleBusinessDepuisEnv,
  dechiffrerJetons,
  ErreurGoogle,
  googleBusinessConfigure,
  jetonsFrais,
  lireEtat,
  MESSAGE_NON_BRANCHE,
  placeIdDuLien,
  signerEtat,
  urlAutorisation,
  type AvisGoogleBrut,
} from '../server/google-business.ts'
import {
  appliquerRegles,
  appliquerReglesImport,
  avisDepuisGoogle,
  fusionnerImport,
  idAvisGoogle,
  LIBELLE_SOURCE,
  publicationAutomatique,
  refusPublication,
  sourceAvis,
} from '../src/lib/avis.ts'
import { etatGoogleBusiness, ETAPES_CONNEXION_GOOGLE, GUIDE_GOOGLE_BUSINESS } from '../src/lib/integrations.ts'
import { nouveauCommerce } from '../src/data/defaults.ts'
import type { Avis, Commerce } from '../src/types.ts'

const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const PLACE_ID = 'ChIJAV70Kqxt5kcRnhPY0L6yaf0'
const CLES = { clientId: 'id-client-test.apps.googleusercontent.com', clientSecret: 'SECRET-CLIENT-DE-TEST-ne-doit-jamais-sortir' }
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p1-b4-'))
after(() => rmSync(dossier, { recursive: true, force: true }))

const commerceAvec = (regles: Partial<Commerce['reglesReponseAuto']> = {}): Commerce => {
  const c = nouveauCommerce('Asian Home Paris', 'restaurant', `https://search.google.com/local/writereview?placeid=${PLACE_ID}`)
  return { ...c, reglesReponseAuto: { auto5Etoiles: true, auto4Etoiles: false, brouillonAutres: true, ...regles } }
}

const NOMS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'] as const
const revue = (n: number, note: number, extra: Partial<AvisGoogleBrut> = {}): AvisGoogleBrut => ({
  name: `accounts/111/locations/222/reviews/r${n}`,
  reviewId: `r${n}`,
  reviewer: { displayName: `Client ${n}` },
  starRating: NOMS[note - 1],
  comment: `Avis numéro ${n}`,
  createTime: `2026-11-0${(n % 9) + 1}T12:00:00Z`,
  updateTime: `2026-11-0${(n % 9) + 1}T12:00:00Z`,
  ...extra,
})

// ---------- Règles de réponse (logique pure) ----------

describe('Règles de réponse à l’import : auto 5★, brouillon pour le reste, jamais de publication hors règle', () => {
  const c = commerceAvec()
  const importe = (note: number) => appliquerReglesImport(avisDepuisGoogle(revue(note, note), c.id)!, c)

  test('5★ + règle auto 5★ → réponse automatique préparée, publiable (et publiée d’office à l’import)', () => {
    const a = importe(5)
    assert.equal(a.reponseAuto, true)
    assert.match(a.reponse!, /Merci beaucoup Client pour ce superbe avis/)
    assert.equal(a.brouillon, undefined)
    assert.equal(refusPublication(a, c), null)
    assert.equal(publicationAutomatique(a, c), true)
  })

  test('4★ (même avec la règle auto 4★), 3★, 1★ → brouillon, ni publiable ni publié automatiquement', () => {
    for (const regles of [{}, { auto4Etoiles: true }]) {
      const cc = commerceAvec(regles)
      for (const note of [4, 3, 1]) {
        const a = appliquerReglesImport(avisDepuisGoogle(revue(note, note), cc.id)!, cc)
        assert.equal(a.reponse, undefined, `${note}★`)
        assert.ok(a.brouillon, `${note}★ : brouillon proposé`)
        assert.match(refusPublication(a, cc)!, /Brouillon non validé/)
        assert.equal(publicationAutomatique(a, cc), false)
      }
    }
  })

  test('règle 5★ désactivée → brouillon pour les 5★ aussi ; aucune règle → rien de préparé', () => {
    assert.ok(appliquerReglesImport(avisDepuisGoogle(revue(1, 5), 'x')!, commerceAvec({ auto5Etoiles: false })).brouillon)
    const rien = appliquerReglesImport(avisDepuisGoogle(revue(1, 5), 'x')!, commerceAvec({ auto5Etoiles: false, brouillonAutres: false }))
    assert.equal(rien.reponse ?? rien.brouillon, undefined)
  })

  test('appliquerRegles (Réglages, saisie) délègue aux règles d’import pour un avis Google : pas de réponse auto 4★', () => {
    const cc = commerceAvec({ auto4Etoiles: true })
    const google = appliquerRegles(avisDepuisGoogle(revue(1, 4), cc.id)!, cc)
    assert.equal(google.reponseAuto, undefined)
    assert.ok(google.brouillon)
    // Avis saisi à la main : comportement d'avant inchangé (réponse auto 4★ préparée, jamais publiable).
    const manuel = appliquerRegles({ id: 'av-1', commerceId: cc.id, auteur: 'Marie', note: 4, texte: 'Bien', date: '2026-11-01T00:00:00Z' }, cc)
    assert.equal(manuel.reponseAuto, true)
    assert.match(refusPublication(manuel, cc)!, /saisi à la main/)
  })

  test('refus de publication : avis manuel, sans réponse, réponse auto hors règle 5★ ; réponse validée → autorisée', () => {
    const base = avisDepuisGoogle(revue(1, 4), c.id)!
    assert.match(refusPublication({ ...base, source: 'manuel' }, c)!, /saisi à la main/)
    assert.match(refusPublication(base, c)!, /Aucune réponse à publier/)
    assert.match(refusPublication({ ...base, reponse: 'Merci', reponseAuto: true }, c)!, /hors règle 5★/)
    const cinq = { ...avisDepuisGoogle(revue(2, 5), c.id)!, reponse: 'Merci', reponseAuto: true }
    assert.match(refusPublication(cinq, commerceAvec({ auto5Etoiles: false }))!, /hors règle 5★/, 'règle 5★ désactivée depuis')
    assert.equal(refusPublication({ ...base, reponse: 'Merci pour votre retour', reponseAuto: false }, c), null, 'validée à la main')
    assert.equal(publicationAutomatique({ ...base, reponse: 'Merci', reponseAuto: false }, c), false, 'jamais d’office hors règle auto')
  })
})

describe('Import : conversion, déduplication, avis manuels et brouillons préservés', () => {
  const c = commerceAvec()

  test('avis Google → avis de l’app : note, auteur, source « google », identifiant stable, réponse existante reprise', () => {
    const a = avisDepuisGoogle(revue(7, 3, { reviewReply: { comment: 'Merci !', updateTime: '2026-11-08T00:00:00Z' } }), c.id)!
    assert.equal(a.note, 3)
    assert.equal(a.auteur, 'Client 7')
    assert.equal(a.source, 'google')
    assert.equal(a.googleId, 'accounts/111/locations/222/reviews/r7')
    assert.equal(a.id, idAvisGoogle(a.googleId!))
    assert.match(a.id, /^av-g-[0-9a-f]{16}$/)
    assert.notEqual(idAvisGoogle('a'), idAvisGoogle('b'))
    assert.deepEqual([a.reponse, a.reponseAuto, a.reponsePublieeLe], ['Merci !', false, '2026-11-08T00:00:00Z'])
    assert.equal(avisDepuisGoogle({ ...revue(1, 5), starRating: 'STAR_RATING_UNSPECIFIED' }, c.id), null)
    assert.equal(avisDepuisGoogle(revue(1, 5, { reviewer: { displayName: 'X', isAnonymous: true } }), c.id)!.auteur, 'Client Google')
    assert.equal(LIBELLE_SOURCE[sourceAvis({})], 'Saisi à la main')
    assert.equal(LIBELLE_SOURCE[sourceAvis(a)], 'Google')
  })

  test('fusion : 2 fois le même avis = 1 ; avis manuel jamais touché ; brouillon local conservé, texte mis à jour', () => {
    const manuel: Avis = { id: 'av-m', commerceId: c.id, auteur: 'Marie', note: 2, texte: 'Saisi', date: '2026-11-01T00:00:00Z', brouillon: 'Mon brouillon' }
    const premier = fusionnerImport([manuel], [revue(1, 4), revue(1, 4), revue(2, 5)], c)
    assert.equal(premier.nouveaux.length, 2)
    assert.equal(premier.ignores, 1, 'doublon dans la même réponse')
    const enBase = [manuel, ...premier.nouveaux.map((a) => (a.note === 4 ? { ...a, brouillon: 'Brouillon retouché' } : a))]
    const second = fusionnerImport(enBase, [revue(1, 4, { comment: 'Avis modifié par le client' }), revue(2, 5)], c)
    assert.equal(second.nouveaux.length, 0)
    assert.equal(second.modifies.length, 1)
    assert.equal(second.modifies[0].texte, 'Avis modifié par le client')
    assert.equal(second.modifies[0].brouillon, 'Brouillon retouché', 'brouillon local conservé')
    assert.ok(!second.modifies.some((a) => a.id === manuel.id))
  })
})

// ---------- OAuth : jetons, state, URL ----------

describe('OAuth Google : configuration, URL de consentement, state signé, jetons chiffrés, rafraîchissement mocké', () => {
  test('configuration : client ID + client secret obligatoires', () => {
    assert.equal(googleBusinessConfigure(configGoogleBusinessDepuisEnv({})), false)
    assert.equal(googleBusinessConfigure(configGoogleBusinessDepuisEnv({ GOOGLE_CLIENT_ID: 'x' })), false)
    const c = configGoogleBusinessDepuisEnv({ GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', GOOGLE_REDIRECT_URI: 'https://a.fr/cb ', GOOGLE_BUSINESS_LOCATION: 'accounts/1/locations/2' })
    assert.equal(googleBusinessConfigure(c), true)
    assert.equal(c.redirectUri, 'https://a.fr/cb')
    assert.equal(placeIdDuLien(`https://search.google.com/local/writereview?placeid=${PLACE_ID}`), PLACE_ID)
  })

  test('URL : scope business.manage, access_type=offline, prompt=consent, state ; jamais le client secret', () => {
    const u = new URL(urlAutorisation(CLES, 'https://app.fr/cb', 'etat-1'))
    assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
    const p = u.searchParams
    assert.equal(p.get('scope'), 'https://www.googleapis.com/auth/business.manage')
    assert.equal(p.get('access_type'), 'offline')
    assert.equal(p.get('prompt'), 'consent')
    assert.equal(p.get('response_type'), 'code')
    assert.equal(p.get('client_id'), CLES.clientId)
    assert.equal(p.get('redirect_uri'), 'https://app.fr/cb')
    assert.equal(p.get('state'), 'etat-1')
    assert.ok(!u.href.includes(CLES.clientSecret))
  })

  test('state : signé, lié au commerce, expiré après 10 min, refusé s’il est altéré ou signé avec un autre secret', () => {
    const t = new Date('2026-11-10T10:00:00Z')
    const { etat, nonce } = signerEtat('s', AH, t)
    assert.deepEqual(lireEtat('s', etat, t), { commerceId: AH, nonce })
    assert.equal(lireEtat('s', etat, new Date(t.getTime() + 11 * 60_000)), null)
    assert.equal(lireEtat('autre', etat, t), null)
    assert.equal(lireEtat('s', etat.replace(/^./, (x) => (x === 'a' ? 'b' : 'a')), t), null)
    assert.equal(lireEtat('s', 'nimporte', t), null)
  })

  test('jetons chiffrés (AES-GCM) : aller-retour, illisibles sans le bon secret, jamais en clair', () => {
    const j = { refreshToken: 'rt-secret', accessToken: 'at-secret', connecteLe: '2026-11-10T10:00:00Z' }
    const v = chiffrerJetons('s', j)
    assert.ok(!v.includes('rt-secret') && !v.includes('at-secret'))
    assert.deepEqual(dechiffrerJetons('s', v), j)
    assert.equal(dechiffrerJetons('autre', v), null)
    assert.equal(dechiffrerJetons('s', ''), null)
    assert.equal(dechiffrerJetons('s', v.slice(0, -2) + 'AA'), null)
  })

  test('rafraîchissement : access token encore valable réutilisé ; expiré → POST token (refresh_token) ; invalid_grant signalé', async () => {
    const appels: URLSearchParams[] = []
    const f = (async (url: string, init?: RequestInit) => {
      assert.equal(url, 'https://oauth2.googleapis.com/token')
      const p = new URLSearchParams(String(init?.body))
      appels.push(p)
      if (p.get('refresh_token') !== 'rt-1') return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }), { status: 400 })
      return new Response(JSON.stringify({ access_token: 'at-neuf', expires_in: 3599, token_type: 'Bearer' }))
    }) as typeof fetch
    const t = new Date('2026-11-10T10:00:00Z')
    const valable = { refreshToken: 'rt-1', accessToken: 'at-1', expireLe: '2026-11-10T10:30:00Z', connecteLe: '' }
    assert.equal((await jetonsFrais(CLES, f, valable, t)).rafraichi, false)
    assert.equal(appels.length, 0)
    const r = await jetonsFrais(CLES, f, { ...valable, expireLe: '2026-11-10T09:59:00Z' }, t)
    assert.equal(r.rafraichi, true)
    assert.equal(r.jetons.accessToken, 'at-neuf')
    assert.equal(r.jetons.refreshToken, 'rt-1', 'refresh token conservé')
    assert.ok(new Date(r.jetons.expireLe!).getTime() > t.getTime())
    assert.deepEqual(Object.fromEntries(appels[0]), { client_id: CLES.clientId, client_secret: CLES.clientSecret, refresh_token: 'rt-1', grant_type: 'refresh_token' })
    await assert.rejects(
      () => jetonsFrais(CLES, f, { ...valable, refreshToken: 'mort', accessToken: undefined }, t),
      (e: unknown) => e instanceof ErreurGoogle && e.code === 'invalid_grant' && !e.message.includes('expired or revoked'),
    )
  })
})

// ---------- Google simulé ----------

function fauxGoogle(avis: AvisGoogleBrut[] = [], { locations = [{ name: 'locations/222', metadata: { placeId: PLACE_ID } }] as unknown[] } = {}) {
  const appels: { url: string; methode: string; auth?: string; corps?: string }[] = []
  const reponses: { nom: string; comment: string; auth?: string }[] = []
  let refusApi = 0
  const f = (async (url: string, init: RequestInit = {}) => {
    const auth = (init.headers as Record<string, string> | undefined)?.Authorization
    appels.push({ url, methode: init.method ?? 'GET', auth, corps: init.body ? String(init.body) : undefined })
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === 'https://oauth2.googleapis.com/token') {
      const p = new URLSearchParams(String(init.body))
      if (p.get('client_secret') !== CLES.clientSecret) return json({ error: 'invalid_client' }, 401)
      if (p.get('grant_type') === 'authorization_code') {
        return p.get('code') === 'bon-code' ? json({ access_token: 'at-1', expires_in: 3599, refresh_token: 'rt-1', scope: 'https://www.googleapis.com/auth/business.manage', token_type: 'Bearer' }) : json({ error: 'invalid_grant' }, 400)
      }
      return p.get('refresh_token') === 'rt-1' ? json({ access_token: 'at-2', expires_in: 3599, token_type: 'Bearer' }) : json({ error: 'invalid_grant' }, 400)
    }
    if (url === 'https://oauth2.googleapis.com/revoke') return json({})
    if (!auth?.startsWith('Bearer at-')) return json({ error: { code: 401 } }, 401)
    if (refusApi) {
      refusApi--
      return json({ error: { code: 403, message: `PERMISSION_DENIED ${auth}` } }, 403)
    }
    if (url.startsWith('https://mybusinessaccountmanagement.googleapis.com/v1/accounts')) return json({ accounts: [{ name: 'accounts/111' }] })
    if (url.startsWith('https://mybusinessbusinessinformation.googleapis.com/v1/accounts/111/locations')) {
      assert.match(url, /readMask=name%2Ctitle%2Cmetadata/)
      return json({ locations })
    }
    const u = new URL(url)
    if (u.pathname === '/v4/accounts/111/locations/222/reviews') {
      // Deux pages pour vérifier la pagination.
      const debut = u.searchParams.get('pageToken') === 'page2' ? 2 : 0
      return json({ reviews: avis.slice(debut, debut + 2), ...(debut === 0 && avis.length > 2 ? { nextPageToken: 'page2' } : {}), totalReviewCount: avis.length })
    }
    const rep = /^\/v4\/(accounts\/111\/locations\/222\/reviews\/[^/]+)\/reply$/.exec(u.pathname)
    if (rep && init.method === 'PUT') {
      reponses.push({ nom: rep[1], comment: JSON.parse(String(init.body)).comment, auth })
      return json({ comment: JSON.parse(String(init.body)).comment, updateTime: '2026-11-10T10:00:00Z' })
    }
    return json({ error: 'inconnu' }, 404)
  }) as typeof fetch
  return { f, appels, reponses, refuser: (n: number) => (refusApi = n) }
}

let horloge = new Date('2026-11-10T10:00:00Z')

async function demarrer(nom: string, options: Partial<OptionsServeur> = {}) {
  const fichierDb = join(dossier, nom)
  const app = await creerServeur({ fichierDb, adminPin: ADMIN, pinInitial: '1234', version: 'test', urlPublique: 'https://app.test', maintenant: () => horloge, ...options })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, {
      method: methode,
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    const texte = await r.text()
    let contenu: any = texte
    try {
      contenu = JSON.parse(texte)
    } catch {
      // réponse vide (302)
    }
    return { statut: r.status, contenu, texte, location: r.headers.get('location') }
  }
  /** Parcours complet : lien de consentement → retour de Google avec `code`. */
  async function connecter(code = 'bon-code') {
    const url = new URL((await api('GET', `/commerces/${AH}/google/auth?format=json`, undefined, PIN)).contenu.url)
    return api('GET', `/commerces/${AH}/google/callback?code=${code}&state=${encodeURIComponent(url.searchParams.get('state')!)}`)
  }
  return { app, api, connecter, fichierDb }
}

// ---------- Sans clés : 501 partout, aucun appel ----------

describe('Sans GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET : 501 propre, aucun appel à Google', () => {
  test('auth, callback, import, publication, déconnexion → 501 « Google Business à brancher » ; /sante false', async () => {
    let appels = 0
    const { app, api } = await demarrer('sans-cles.db', { googleBusiness: { fetch: async () => (appels++, new Response('{}')) } })
    try {
      const avis = (await api('POST', `/commerces/${AH}/avis`, { auteur: 'Marie', note: 5, texte: 'Top' }, PIN)).contenu.avis as Avis
      assert.equal(avis.source, 'manuel', 'avis saisi : source marquée')
      const routes: [string, string][] = [
        ['GET', `/commerces/${AH}/google/auth`],
        ['GET', `/commerces/${AH}/google/auth?format=json`],
        ['GET', `/commerces/${AH}/google/callback?code=x&state=y`],
        ['POST', `/commerces/${AH}/google/import-avis`],
        ['POST', `/commerces/${AH}/google/deconnecter`],
        ['POST', `/commerces/${AH}/avis/${avis.id}/publier-reponse`],
      ]
      for (const [m, chemin] of routes) {
        const r = await api(m, chemin, undefined, PIN)
        assert.equal(r.statut, 501, `${m} ${chemin}`)
        assert.equal(r.contenu.erreur, MESSAGE_NON_BRANCHE)
        assert.match(r.contenu.erreur, /^Google Business à brancher : /)
      }
      assert.equal(appels, 0, 'aucun appel réseau')
      assert.equal((await api('GET', '/sante')).contenu.integrations.googleBusinessProfile, false)
      assert.deepEqual((await api('GET', `/commerces/${AH}/google`, undefined, PIN)).contenu, { configure: false, connecte: false })
      // Routes du gérant : PIN exigé avant tout.
      assert.equal((await api('POST', `/commerces/${AH}/google/import-avis`)).statut, 401)
      assert.equal((await api('GET', `/commerces/${AH}/google/auth`)).statut, 401)
    } finally {
      await app.fermer()
    }
  })

  test('seul GOOGLE_CLIENT_ID (sans secret) : toujours 501', async () => {
    const { app, api } = await demarrer('id-seul.db', { googleBusiness: { clientId: 'x' } })
    try {
      assert.equal((await api('GET', `/commerces/${AH}/google/auth`, undefined, PIN)).statut, 501)
    } finally {
      await app.fermer()
    }
  })
})

// ---------- Avec des clés de test et Google simulé ----------

describe('Connexion OAuth (Google simulé) : jetons côté serveur uniquement', () => {
  test('auth : 302 vers Google ; callback : jetons échangés et chiffrés dans `meta`, jamais renvoyés au navigateur', async () => {
    const g = fauxGoogle()
    const { app, api, connecter, fichierDb } = await demarrer('connexion.db', { googleBusiness: { ...CLES, fetch: g.f } })
    try {
      assert.equal((await api('GET', '/sante')).contenu.integrations.googleBusinessProfile, true)
      const r302 = await api('GET', `/commerces/${AH}/google/auth`, undefined, PIN)
      assert.equal(r302.statut, 302)
      const u = new URL(r302.location!)
      assert.equal(u.host, 'accounts.google.com')
      assert.equal(u.searchParams.get('redirect_uri'), `https://app.test/api/v1/commerces/${AH}/google/callback`, 'défaut : URL publique + chemin callback')
      assert.ok(!r302.location!.includes(CLES.clientSecret))

      const retour = await connecter()
      assert.equal(retour.statut, 302)
      assert.equal(retour.location, 'https://app.test/#/avis/google-connecte')
      const echange = g.appels.find((a) => a.url === 'https://oauth2.googleapis.com/token')!
      const p = new URLSearchParams(echange.corps)
      assert.deepEqual([p.get('grant_type'), p.get('code'), p.get('redirect_uri')], ['authorization_code', 'bon-code', `https://app.test/api/v1/commerces/${AH}/google/callback`])

      const etat = await api('GET', `/commerces/${AH}/google`, undefined, PIN)
      assert.equal(etat.contenu.connecte, true)
      assert.equal(etat.contenu.connecteLe, horloge.toISOString())
      // Aucun jeton ni secret dans ce que voit le navigateur (état, /etat complet).
      const complet = (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).texte + etat.texte + retour.texte
      for (const s of ['at-1', 'rt-1', CLES.clientSecret]) assert.ok(!complet.includes(s), s)
      // En base : chiffré.
      const st = ouvrirStockage(fichierDb)
      const brut = st.meta(`google_business:${AH}`)!
      st.fermer()
      assert.ok(brut.startsWith('v1.'))
      assert.ok(!brut.includes('rt-1') && !brut.includes('at-1'))
      assert.equal(dechiffrerJetons(CLES.clientSecret, brut)!.refreshToken, 'rt-1')
    } finally {
      await app.fermer()
    }
  })

  test('callback : state absent, falsifié, d’un autre commerce ou déjà utilisé → 400 ; refus sur Google → retour « refusé »', async () => {
    const g = fauxGoogle()
    const { app, api } = await demarrer('callback.db', { googleBusiness: { ...CLES, fetch: g.f } })
    try {
      const lien = async () => new URL((await api('GET', `/commerces/${AH}/google/auth?format=json`, undefined, PIN)).contenu.url).searchParams.get('state')!
      assert.equal((await api('GET', `/commerces/${AH}/google/callback?code=bon-code`)).statut, 400)
      const etranger = signerEtat(CLES.clientSecret, AH, horloge).etat // signé mais jamais émis par ce serveur
      assert.equal((await api('GET', `/commerces/${AH}/google/callback?code=bon-code&state=${encodeURIComponent(etranger)}`)).statut, 400)
      const s = await lien()
      const autre = await api('POST', '/commerces', { nom: 'Autre', type: 'autre', lienGoogle: '', pin: '5678' }, { 'X-Admin-PIN': ADMIN })
      assert.equal((await api('GET', `/commerces/${autre.contenu.commerce.id}/google/callback?code=bon-code&state=${encodeURIComponent(s)}`)).statut, 400)
      const s2 = await lien()
      const refus = await api('GET', `/commerces/${AH}/google/callback?error=access_denied&state=${encodeURIComponent(s2)}`)
      assert.equal(refus.location, 'https://app.test/#/avis/google-refuse')
      assert.equal((await api('GET', `/commerces/${AH}/google/callback?code=bon-code&state=${encodeURIComponent(s2)}`)).statut, 400, 'state à usage unique')
      const s3 = await lien()
      const mauvais = await api('GET', `/commerces/${AH}/google/callback?code=mauvais-code&state=${encodeURIComponent(s3)}`)
      assert.equal(mauvais.statut, 409)
      assert.ok(!mauvais.texte.includes(CLES.clientSecret))
      assert.equal((await api('GET', `/commerces/${AH}/google`, undefined, PIN)).contenu.connecte, false)
      assert.equal(g.appels.filter((a) => a.url.includes('mybusiness')).length, 0)
    } finally {
      await app.fermer()
    }
  })

  test('déconnecter : révocation chez Google + jetons effacés ; import ensuite → 409 « pas connecté »', async () => {
    const g = fauxGoogle()
    const { app, api, connecter } = await demarrer('deconnexion.db', { googleBusiness: { ...CLES, fetch: g.f } })
    try {
      await connecter()
      const r = await api('POST', `/commerces/${AH}/google/deconnecter`, undefined, PIN)
      assert.deepEqual(r.contenu, { ok: true, revoque: true })
      const rev = g.appels.find((a) => a.url === 'https://oauth2.googleapis.com/revoke')!
      assert.equal(new URLSearchParams(rev.corps).get('token'), 'rt-1')
      assert.equal((await api('GET', `/commerces/${AH}/google`, undefined, PIN)).contenu.connecte, false)
      const imp = await api('POST', `/commerces/${AH}/google/import-avis`, undefined, PIN)
      assert.equal(imp.statut, 409)
      assert.match(imp.contenu.erreur, /pas connecté/)
    } finally {
      await app.fermer()
    }
  })
})

describe('Import des avis (Google simulé)', () => {
  test('2 imports = pas de doublon ; manuels et brouillons préservés ; source marquée ; seule la 5★ auto est publiée', async () => {
    horloge = new Date('2026-11-10T10:00:00Z')
    // r1 : 5★ posté après la connexion (publié d'office) ; r4 : 5★ d'avant la connexion (préparé, pas publié d'office).
    const g = fauxGoogle([revue(1, 5, { createTime: '2026-11-10T11:00:00Z' }), revue(2, 4), revue(3, 2), revue(4, 5)])
    const { app, api, connecter } = await demarrer('import.db', { googleBusiness: { ...CLES, fetch: g.f } })
    try {
      const manuel = (await api('POST', `/commerces/${AH}/avis`, { auteur: 'Marie', note: 3, texte: 'Saisi à la main' }, PIN)).contenu.avis as Avis
      await connecter()
      const r1 = await api('POST', `/commerces/${AH}/google/import-avis`, undefined, PIN)
      assert.equal(r1.statut, 200, r1.texte)
      assert.deepEqual([r1.contenu.importes, r1.contenu.misAJour, r1.contenu.publiees, r1.contenu.echecsPublication], [4, 0, 1, 0])
      assert.equal(g.appels.filter((a) => a.url.includes('/reviews?')).length, 2, 'deux pages lues')
      // Réponse auto 5★ publiée avec le bon jeton, rien d'autre.
      assert.equal(g.reponses.length, 1)
      assert.equal(g.reponses[0].nom, 'accounts/111/locations/222/reviews/r1')
      assert.equal(g.reponses[0].auth, 'Bearer at-1')
      assert.match(g.reponses[0].comment, /Merci beaucoup Client/)

      const avis = (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.avis as Avis[]
      assert.equal(avis.length, 5)
      const parNote = (n: number) => avis.find((a) => a.source === 'google' && a.note === n)!
      const r = (n: number) => avis.find((a) => a.googleId === `accounts/111/locations/222/reviews/r${n}`)!
      assert.ok(r(1).reponseAuto && r(1).reponsePublieeLe)
      assert.ok(r(4).reponseAuto && !r(4).reponsePublieeLe, 'historique : préparée, pas publiée d’office')
      assert.ok(parNote(4).brouillon && !parNote(4).reponse)
      assert.ok(parNote(2).brouillon && !parNote(2).reponse)
      assert.deepEqual(avis.find((a) => a.id === manuel.id), manuel, 'avis manuel intact')

      // Brouillon retouché par le gérant, puis 2e import des mêmes avis.
      await api('PATCH', `/commerces/${AH}/avis/${parNote(4).id}`, { brouillon: 'Brouillon retouché' }, PIN)
      g.reponses.length = 0
      const r2 = await api('POST', `/commerces/${AH}/google/import-avis`, undefined, PIN)
      assert.deepEqual([r2.contenu.importes, r2.contenu.publiees], [0, 0], 'rien de neuf, rien republié')
      const apres = (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.avis as Avis[]
      assert.equal(apres.length, 5, 'aucun doublon')
      assert.equal(apres.find((a) => a.note === 4 && a.source === 'google')!.brouillon, 'Brouillon retouché')
      assert.equal(g.reponses.length, 0)
      // La 5★ historique (réponse auto de la règle active) se publie d'un tap, sans autre validation.
      const pub = await api('POST', `/commerces/${AH}/avis/${r(4).id}/publier-reponse`, undefined, PIN)
      assert.equal(pub.statut, 200, pub.texte)
      assert.equal(g.reponses.length, 1)
    } finally {
      await app.fermer()
    }
  })

  test('mise à jour d’un avis modifié par le client sur Google ; brouillon conservé', async () => {
    const liste = [revue(1, 4)]
    const g = fauxGoogle(liste)
    const { app, api, connecter } = await demarrer('import-maj.db', { googleBusiness: { ...CLES, fetch: g.f } })
    try {
      await connecter()
      await api('POST', `/commerces/${AH}/google/import-avis`, undefined, PIN)
      liste[0] = revue(1, 4, { comment: 'Texte modifié par le client' })
      const r = await api('POST', `/commerces/${AH}/google/import-avis`, undefined, PIN)
      assert.deepEqual([r.contenu.importes, r.contenu.misAJour], [0, 1])
      const [a] = r.contenu.avis as Avis[]
      assert.equal(a.texte, 'Texte modifié par le client')
      assert.ok(a.brouillon)
    } finally {
      await app.fermer()
    }
  })

  test('fiche introuvable (plusieurs fiches sans le placeid) → 409 explicite ; API refusée (403) → 502 sans jeton ni secret', async () => {
    const g = fauxGoogle([revue(1, 5)], { locations: [{ name: 'locations/1' }, { name: 'locations/2' }] })
    const { app, api, connecter } = await demarrer('fiches.db', { googleBusiness: { ...CLES, fetch: g.f } })
    try {
      await connecter()
      const r = await api('POST', `/commerces/${AH}/google/import-avis`, undefined, PIN)
      assert.equal(r.statut, 409)
      assert.match(r.contenu.erreur, /GOOGLE_BUSINESS_LOCATION/)
      g.refuser(1)
      const refus = await api('POST', `/commerces/${AH}/google/import-avis`, undefined, PIN)
      assert.equal(refus.statut, 502)
      assert.match(refus.contenu.erreur, /HTTP 403/)
      for (const s of ['at-1', 'rt-1', CLES.clientSecret, 'PERMISSION_DENIED']) assert.ok(!refus.texte.includes(s), s)
    } finally {
      await app.fermer()
    }
  })

  test('GOOGLE_BUSINESS_LOCATION renseignée : utilisée telle quelle (pas de recherche de fiche)', async () => {
    const g = fauxGoogle([revue(1, 3)])
    const { app, api, connecter } = await demarrer('emplacement.db', { googleBusiness: { ...CLES, emplacement: 'accounts/111/locations/222', fetch: g.f } })
    try {
      await connecter()
      assert.equal((await api('POST', `/commerces/${AH}/google/import-avis`, undefined, PIN)).contenu.importes, 1)
      assert.equal(g.appels.filter((a) => a.url.includes('mybusinessaccountmanagement')).length, 0)
    } finally {
      await app.fermer()
    }
  })
})

describe('Publication d’une réponse (Google simulé) : validation manuelle obligatoire', () => {
  test('brouillon non validé → 409 et rien d’envoyé ; validé → PUT …/reply avec le bon jeton ; avis manuel → 409', async () => {
    horloge = new Date('2026-11-10T10:00:00Z')
    const g = fauxGoogle([revue(2, 4)])
    const { app, api, connecter } = await demarrer('publication.db', { googleBusiness: { ...CLES, fetch: g.f } })
    try {
      await connecter()
      await api('POST', `/commerces/${AH}/google/import-avis`, undefined, PIN)
      const [quatre] = (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.avis as Avis[]
      assert.ok(quatre.brouillon)
      const refus = await api('POST', `/commerces/${AH}/avis/${quatre.id}/publier-reponse`, undefined, PIN)
      assert.equal(refus.statut, 409)
      assert.match(refus.contenu.erreur, /Brouillon non validé/)
      assert.equal(g.reponses.length, 0, 'rien publié sans validation')
      assert.equal((await api('POST', `/commerces/${AH}/avis/${quatre.id}/publier-reponse`)).statut, 401)

      // Validation manuelle (« Marquer comme répondu »), puis publication — 2 h plus tard : jeton rafraîchi d'abord.
      await api('PATCH', `/commerces/${AH}/avis/${quatre.id}`, { reponse: 'Merci pour votre retour, à bientôt !' }, PIN)
      horloge = new Date('2026-11-10T12:00:00Z')
      const ok = await api('POST', `/commerces/${AH}/avis/${quatre.id}/publier-reponse`, undefined, PIN)
      assert.equal(ok.statut, 200, ok.texte)
      assert.equal(ok.contenu.avis.reponsePublieeLe, horloge.toISOString())
      assert.deepEqual(g.reponses, [{ nom: 'accounts/111/locations/222/reviews/r2', comment: 'Merci pour votre retour, à bientôt !', auth: 'Bearer at-2' }])
      const refresh = g.appels.filter((a) => a.url === 'https://oauth2.googleapis.com/token').map((a) => new URLSearchParams(a.corps).get('grant_type'))
      assert.deepEqual(refresh, ['authorization_code', 'refresh_token'])
      assert.ok(!ok.texte.includes('at-2'))

      // Réponse modifiée ensuite : plus marquée « publiée » (à republier).
      const modif = await api('PATCH', `/commerces/${AH}/avis/${quatre.id}`, { reponse: 'Nouvelle réponse' }, PIN)
      assert.equal(modif.contenu.avis.reponsePublieeLe, undefined)

      const manuel = (await api('POST', `/commerces/${AH}/avis`, { auteur: 'Marie', note: 5, texte: 'Top' }, PIN)).contenu.avis as Avis
      const m = await api('POST', `/commerces/${AH}/avis/${manuel.id}/publier-reponse`, undefined, PIN)
      assert.equal(m.statut, 409)
      assert.match(m.contenu.erreur, /saisi à la main/)
      assert.equal((await api('POST', `/commerces/${AH}/avis/inconnu/publier-reponse`, undefined, PIN)).statut, 404)
      assert.equal(g.reponses.length, 1)
    } finally {
      await app.fermer()
    }
  })

  test('règle auto 4★ activée : la réponse auto préparée sur un avis Google 4★ n’est jamais publiable sans validation', async () => {
    const g = fauxGoogle([revue(3, 4)])
    const { app, api, connecter } = await demarrer('regle4.db', { googleBusiness: { ...CLES, fetch: g.f } })
    try {
      await api('PATCH', `/commerces/${AH}`, { reglesReponseAuto: { auto5Etoiles: true, auto4Etoiles: true, brouillonAutres: false } }, PIN)
      await connecter()
      const r = await api('POST', `/commerces/${AH}/google/import-avis`, undefined, PIN)
      assert.equal(r.contenu.publiees, 0)
      const [a] = r.contenu.avis as Avis[]
      assert.ok(a.brouillon && !a.reponse, 'brouillon, pas de réponse auto')
      assert.equal((await api('POST', `/commerces/${AH}/avis/${a.id}/publier-reponse`, undefined, PIN)).statut, 409)
      assert.equal(g.reponses.length, 0)
    } finally {
      await app.fermer()
    }
  })

  test('refresh token retiré chez Google (invalid_grant) : 409 « reconnectez », jetons effacés', async () => {
    horloge = new Date('2026-11-10T10:00:00Z')
    const g = fauxGoogle([revue(1, 5)])
    const { app, api, connecter, fichierDb } = await demarrer('invalid-grant.db', { googleBusiness: { ...CLES, fetch: g.f } })
    try {
      await connecter()
      // Jetons remplacés par un refresh token que Google refuse, access token expiré.
      const st = ouvrirStockage(fichierDb)
      st.majMeta(`google_business:${AH}`, chiffrerJetons(CLES.clientSecret, { refreshToken: 'revoque', connecteLe: '' }))
      st.fermer()
      const r = await api('POST', `/commerces/${AH}/google/import-avis`, undefined, PIN)
      assert.equal(r.statut, 409)
      assert.match(r.contenu.erreur, /reconnectez Google/)
      assert.equal((await api('GET', `/commerces/${AH}/google`, undefined, PIN)).contenu.connecte, false)
    } finally {
      await app.fermer()
    }
  })
})

// ---------- Écran Avis et textes ----------

describe('Écran Avis honnête et documentation', () => {
  const source = (f: string) => readFileSync(join(import.meta.dirname, '..', f), 'utf8')

  test('état « à brancher » sans configuration, « à connecter » puis « connecté » ; jamais de promesse sans config', () => {
    assert.equal(etatGoogleBusiness(null).badge, 'à brancher')
    assert.match(etatGoogleBusiness({ configure: false, connecte: false }).texte, /à brancher.*aucune réponse n’est publiée/)
    assert.equal(etatGoogleBusiness({ configure: true, connecte: false }).badge, 'à connecter')
    assert.match(etatGoogleBusiness({ configure: true, connecte: true }).texte, /après votre validation/)
    assert.ok(ETAPES_CONNEXION_GOOGLE.some((e) => e.includes('GOOGLE_CLIENT_SECRET')))
    assert.ok(!ETAPES_CONNEXION_GOOGLE.some((e) => /pas encore développé/.test(e)))
    assert.match(GUIDE_GOOGLE_BUSINESS, /docs\/GOOGLE-BUSINESS\.md/)
  })

  test('Avis.tsx : source affichée, « Publier sur Google » seulement si publiable, import/connexion seulement si configuré', () => {
    const s = source('src/pages/Avis.tsx')
    assert.match(s, /LIBELLE_SOURCE\[source\]/)
    assert.match(s, /const publiable = !!google\?\.connecte && !a\.reponsePublieeLe && refusPublication\(a, commerce\) === null/)
    assert.match(s, /\{publiable && \(\s*<button[^\n]*onClick=\{\(\) => void publier\(\)\}>\s*\{enCours \? 'Publication…' : 'Publier sur Google'\}/)
    assert.match(s, /branche \? \(/)
    assert.match(s, /s\.integrations\?\.googleBusinessProfile \? avecPin/)
    assert.match(s, /\{GUIDE_GOOGLE_BUSINESS\}/)
    assert.doesNotMatch(s, /refreshToken|accessToken|client_secret/i, 'aucun jeton côté front')
  })

  test('aucun jeton ni secret Google dans le front (src/)', () => {
    for (const f of ['src/data/api.ts', 'src/lib/avis.ts', 'src/lib/integrations.ts', 'src/pages/Avis.tsx']) {
      assert.doesNotMatch(source(f), /GOOGLE_CLIENT_SECRET.*=|clientSecret|refresh_token/, f)
    }
  })

  test('docs/GOOGLE-BUSINESS.md : démarche complète, variables Render, points « à vérifier »', () => {
    assert.ok(existsSync(join(import.meta.dirname, '..', 'docs', 'GOOGLE-BUSINESS.md')))
    const d = source('docs/GOOGLE-BUSINESS.md')
    for (const m of [
      /Google Cloud/,
      /Google My Business API/,
      /My Business Account Management API/,
      /My Business Business Information API/,
      /Application for Basic API Access/,
      /business\.manage/,
      /GOOGLE_CLIENT_ID/,
      /GOOGLE_CLIENT_SECRET/,
      /GOOGLE_REDIRECT_URI/,
      /\/api\/v1\/commerces\/c-asian-home-paris\/google\/callback/,
      /délai/i,
      /à vérifier/,
      /propriétaire ou gestionnaire/,
    ])
      assert.match(d, m)
  })
})

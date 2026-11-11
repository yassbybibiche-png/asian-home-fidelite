// P0-S1 (audit du 10/11/2026, failles F-02 et F-09) : PIN haché en scrypt (avec migration des anciens hash SHA-256)
// et jetons de session courts à la place du PIN envoyé à chaque requête. Vrai serveur HTTP + vraie base SQLite temporaire.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AddressInfo } from 'node:net'

import { creerServeur, emettreJeton, hacherPin, hacherPinAncien, lireJeton, pinCorrect, type OptionsServeur } from '../server/app.ts'
import { accesDeSession, creerClientApi, echangerContreSession, ErreurApi, type ClientApi } from '../src/data/api.ts'
import { creerCoffrePin, type RangementCle } from '../src/data/coffrePin.ts'
import { demarrerFauxSupabaseHttp } from './faux-supabase-http.ts'
import type { Client } from '../src/types.ts'

const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const SECRET = 'secret-de-session-de-test-assez-long-0123456789'

let horloge = new Date(2026, 10, 10, 9, 0)

async function demarrer(fichierDb: string, options: Partial<OptionsServeur> = {}) {
  const app = await creerServeur({ fichierDb, adminPin: ADMIN, pinInitial: '1234', version: 'test', secretSession: SECRET, maintenant: () => horloge, ...options })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    const type = r.headers.get('content-type') ?? ''
    return { statut: r.status, contenu: type.includes('json') ? await r.json() : await r.text(), entetes: r.headers }
  }
  return { app, api, base }
}

/** Lecture directe de la base SQLite (format réellement stocké). */
function lireBase<T>(fichierDb: string, requete: string, ...args: string[]): T | undefined {
  const db = new DatabaseSync(fichierDb)
  try {
    return db.prepare(requete).get(...args) as T | undefined
  } finally {
    db.close()
  }
}

function ecrireBase(fichierDb: string, requete: string, ...args: string[]) {
  const db = new DatabaseSync(fichierDb)
  try {
    db.prepare(requete).run(...args)
  } finally {
    db.close()
  }
}

describe('P0-S1 : hachage scrypt', () => {
  test('format `scrypt$v1$<128 hex>`, sel aléatoire 16 o ; bon PIN accepté, mauvais refusé', async () => {
    const p = await hacherPin('482916')
    assert.match(p.hash, /^scrypt\$v1\$[0-9a-f]{128}$/)
    assert.match(p.sel, /^[0-9a-f]{32}$/)
    assert.notEqual((await hacherPin('482916')).hash, p.hash, 'sel différent → hash différent')
    assert.deepEqual(await pinCorrect('482916', p), { ok: true, rehacher: false })
    assert.deepEqual(await pinCorrect('482917', p), { ok: false, rehacher: false })
    assert.deepEqual(await pinCorrect('482916', undefined), { ok: false, rehacher: false })
    assert.deepEqual(await pinCorrect('482916', { sel: p.sel, hash: 'n-importe-quoi' }), { ok: false, rehacher: false }, 'format inconnu refusé')
  })

  test('ancien format SHA-256 (64 hex nus) toujours accepté, et signalé « à re-hacher »', async () => {
    const ancien = hacherPinAncien('1234')
    assert.match(ancien.hash, /^[0-9a-f]{64}$/)
    assert.deepEqual(await pinCorrect('1234', ancien), { ok: true, rehacher: true })
    assert.deepEqual(await pinCorrect('4321', ancien), { ok: false, rehacher: false })
  })
})

describe('P0-S1 : serveur (SQLite) — migration des hash et sessions', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-s1-'))
  const fichierDb = join(dossier, 'fidelite.db')
  let srv: Awaited<ReturnType<typeof demarrer>>
  let client: Client
  let membreId = ''

  before(async () => {
    srv = await demarrer(fichierDb)
    const m = await srv.api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)
    assert.equal(m.statut, 201)
    membreId = m.contenu.membre.id
    client = (await srv.api('POST', `/commerces/${AH}/clients`, { prenom: 'Linh', contact: '0612345678' }, PIN)).contenu.client
  })
  after(async () => {
    await srv.app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('les nouveaux PIN et codes sont stockés en scrypt', () => {
    assert.match(lireBase<{ h: string }>(fichierDb, 'SELECT pin_hash AS h FROM commerces WHERE id = ?', AH)!.h, /^scrypt\$v1\$/)
    assert.match(lireBase<{ h: string }>(fichierDb, 'SELECT code_hash AS h FROM equipe WHERE id = ?', membreId)!.h, /^scrypt\$v1\$/)
  })

  test('hash SHA-256 existant : accepté au 1er accès réussi puis re-haché en scrypt (commerce et équipe) ; un mauvais PIN ne réécrit rien', async () => {
    const ancienPin = hacherPinAncien('1234')
    const ancienCode = hacherPinAncien('2468')
    ecrireBase(fichierDb, 'UPDATE commerces SET pin_hash = ?, pin_sel = ? WHERE id = ?', ancienPin.hash, ancienPin.sel, AH)
    ecrireBase(fichierDb, 'UPDATE equipe SET code_hash = ?, code_sel = ? WHERE id = ?', ancienCode.hash, ancienCode.sel, membreId)

    assert.equal((await srv.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Commerce-PIN': '0000' })).statut, 401)
    assert.equal(lireBase<{ h: string }>(fichierDb, 'SELECT pin_hash AS h FROM commerces WHERE id = ?', AH)!.h, ancienPin.hash)

    assert.equal((await srv.api('GET', `/commerces/${AH}/etat`, undefined, PIN)).statut, 200)
    const apres = lireBase<{ h: string; s: string }>(fichierDb, 'SELECT pin_hash AS h, pin_sel AS s FROM commerces WHERE id = ?', AH)!
    assert.match(apres.h, /^scrypt\$v1\$[0-9a-f]{128}$/, 'format changé en base')
    assert.notEqual(apres.s, ancienPin.sel)

    assert.equal((await srv.api('GET', `/commerces/${AH}/caisse`, undefined, { 'X-Equipe-Code': '2468' })).statut, 200)
    assert.match(lireBase<{ h: string }>(fichierDb, 'SELECT code_hash AS h FROM equipe WHERE id = ?', membreId)!.h, /^scrypt\$v1\$/)
    const membre = JSON.parse(lireBase<{ d: string }>(fichierDb, 'SELECT donnees AS d FROM equipe WHERE id = ?', membreId)!.d)
    assert.equal(membre.nom, 'Mai', 'le re-hachage ne touche pas au membre')

    // Après migration, les mêmes PIN / codes marchent toujours.
    assert.equal((await srv.api('GET', `/commerces/${AH}/etat`, undefined, PIN)).statut, 200)
    assert.equal((await srv.api('GET', `/commerces/${AH}/caisse`, undefined, { 'X-Equipe-Code': '2468' })).statut, 200)
    assert.equal((await srv.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Admin-PIN': ADMIN })).statut, 200, 'PIN admin (scrypt en mémoire)')
  })

  test('POST /sessions : commerce 8 h, admin 8 h, équipe 12 h ; jeton signé, sans secret dedans', async () => {
    const t0 = horloge.getTime()
    const c = await srv.api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '1234' })
    assert.equal(c.statut, 201)
    assert.match(c.contenu.jeton, /^v1\.[\w-]+\.[\w-]+$/)
    assert.equal(c.contenu.role, 'commerce')
    assert.equal(c.contenu.commerceId, AH)
    assert.equal(Date.parse(c.contenu.expireLe) - t0, 8 * 3600_000)
    const charge = JSON.parse(Buffer.from(c.contenu.jeton.split('.')[1], 'base64url').toString())
    assert.deepEqual(Object.keys(charge).sort(), ['commerceId', 'exp', 'jti', 'role'])
    assert.match(charge.jti, /^[0-9a-f-]{36}$/)
    assert.doesNotMatch(JSON.stringify(c.contenu), /1234/)

    const a = await srv.api('POST', '/sessions', { role: 'admin', pin: ADMIN })
    assert.deepEqual([a.statut, a.contenu.role, a.contenu.commerceId], [201, 'admin', undefined])
    assert.equal(Date.parse(a.contenu.expireLe) - t0, 8 * 3600_000)

    const e = await srv.api('POST', '/sessions', { role: 'equipe', commerceId: AH, code: '2468' })
    assert.deepEqual([e.statut, e.contenu.role, e.contenu.membreNom], [201, 'equipe', 'Mai'])
    assert.equal(Date.parse(e.contenu.expireLe) - t0, 12 * 3600_000)
    assert.doesNotMatch(JSON.stringify(e.contenu), /2468/)

    // Refus : mauvais PIN / code, rôle inconnu, commerce inconnu, champs manquants.
    assert.equal((await srv.api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '0000' })).statut, 401)
    assert.equal((await srv.api('POST', '/sessions', { role: 'equipe', commerceId: AH, code: '1357' })).statut, 401)
    assert.equal((await srv.api('POST', '/sessions', { role: 'admin', pin: '11111111' })).statut, 401)
    assert.equal((await srv.api('POST', '/sessions', { role: 'root', pin: ADMIN })).statut, 400)
    assert.equal((await srv.api('POST', '/sessions', { role: 'commerce', commerceId: 'inconnu', pin: '1234' })).statut, 404)
    assert.equal((await srv.api('POST', '/sessions', { role: 'commerce', commerceId: AH })).statut, 400)
    assert.equal((await srv.api('GET', '/sessions')).statut, 405)
  })

  test('jeton accepté sur /etat et /caisse (gérant, admin, équipe) ; hors de sa portée → 403', async () => {
    const commerce = (await srv.api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '1234' })).contenu.jeton
    const admin = (await srv.api('POST', '/sessions', { role: 'admin', pin: ADMIN })).contenu.jeton
    const equipe = (await srv.api('POST', '/sessions', { role: 'equipe', commerceId: AH, code: '2468' })).contenu.jeton

    const etat = await srv.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': commerce })
    assert.equal(etat.statut, 200)
    assert.equal(etat.contenu.clients.length, 1)
    assert.equal((await srv.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': admin })).statut, 200)

    const caisseGerant = await srv.api('GET', `/commerces/${AH}/caisse`, undefined, { 'X-Session': commerce })
    assert.deepEqual([caisseGerant.statut, caisseGerant.contenu.auteur], [200, { type: 'gerant', nom: 'Gérant' }])
    const caisseAdmin = await srv.api('GET', `/commerces/${AH}/caisse`, undefined, { 'X-Session': admin })
    assert.deepEqual(caisseAdmin.contenu.auteur, { type: 'gerant', nom: 'Admin' })
    const caisse = await srv.api('GET', `/commerces/${AH}/caisse`, undefined, { 'X-Session': equipe })
    assert.deepEqual([caisse.statut, caisse.contenu.auteur.type, caisse.contenu.auteur.nom], [200, 'membre', 'Mai'])

    // Action de caisse avec le jeton équipe : tracée au nom du membre.
    const p = await srv.api('POST', `/commerces/${AH}/caisse/passage`, { clientId: client.id, actionId: 'act-s1-0001' }, { 'X-Session': equipe })
    assert.equal(p.statut, 200)
    assert.equal(p.contenu.client.tampons, 1)
    const journal = (await srv.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': commerce })).contenu.journal
    assert.equal(journal[0].auteur.nom, 'Mai')

    // Portée : la session équipe n'ouvre pas le tableau de bord ; une session commerce n'ouvre pas un autre commerce
    // ni l'admin ; un jeton d'admin ouvre la création de commerce.
    assert.equal((await srv.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': equipe })).statut, 403)
    const autre = await srv.api('POST', '/commerces', { nom: 'Chez Lin', type: 'restaurant', lienGoogle: '', pin: '5555' }, { 'X-Session': admin })
    assert.equal(autre.statut, 201)
    assert.equal((await srv.api('GET', `/commerces/${autre.contenu.commerce.id}/etat`, undefined, { 'X-Session': commerce })).statut, 403)
    assert.equal((await srv.api('GET', `/commerces/${autre.contenu.commerce.id}/caisse`, undefined, { 'X-Session': equipe })).statut, 403)
    assert.equal((await srv.api('POST', '/commerces', { nom: 'X', type: 'autre', lienGoogle: '', pin: '5555' }, { 'X-Session': commerce })).statut, 403)
  })

  test('jeton falsifié (signature, contenu, autre secret, tronqué) → 401', async () => {
    const jeton = (await srv.api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '1234' })).contenu.jeton as string
    const [v, charge, sig] = jeton.split('.')
    const chargeAdmin = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(charge, 'base64url').toString()), role: 'admin' })).toString('base64url')
    const sigAbimee = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)
    const exp = Math.floor(horloge.getTime() / 1000) + 3600
    for (const faux of [
      `${v}.${charge}.${sigAbimee}`,
      `${v}.${chargeAdmin}.${sig}`,
      emettreJeton('un-autre-secret-tout-aussi-long-0123456789', { jti: 'x', role: 'admin', exp }),
      `${v}.${charge}`,
      `v2.${charge}.${sig}`,
      'n-importe-quoi',
    ]) {
      const r = await srv.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': faux })
      assert.equal(r.statut, 401, faux)
      assert.match(r.contenu.erreur, /Session/)
    }
    assert.equal(lireJeton(SECRET, `${v}.${chargeAdmin}.${sig}`), null)
    assert.equal(lireJeton(SECRET, jeton)?.role, 'commerce')
  })

  test('jeton expiré → 401 (8 h gérant ; 12 h équipe)', async () => {
    const debut = horloge
    try {
      const commerce = (await srv.api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '1234' })).contenu.jeton
      const equipe = (await srv.api('POST', '/sessions', { role: 'equipe', commerceId: AH, code: '2468' })).contenu.jeton
      horloge = new Date(debut.getTime() + 8 * 3600_000 - 1000)
      assert.equal((await srv.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': commerce })).statut, 200)
      horloge = new Date(debut.getTime() + 8 * 3600_000)
      const r = await srv.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': commerce })
      assert.equal(r.statut, 401)
      assert.match(r.contenu.erreur, /expirée/)
      assert.equal((await srv.api('GET', `/commerces/${AH}/caisse`, undefined, { 'X-Session': equipe })).statut, 200)
      horloge = new Date(debut.getTime() + 12 * 3600_000)
      assert.equal((await srv.api('GET', `/commerces/${AH}/caisse`, undefined, { 'X-Session': equipe })).statut, 401)
      // Fermer un jeton déjà expiré : rien à faire, pas d'erreur.
      assert.equal((await srv.api('DELETE', '/sessions', undefined, { 'X-Session': equipe })).statut, 200)
    } finally {
      horloge = debut
    }
  })

  test('DELETE /sessions révoque le jeton courant (→ 401 ensuite), sans toucher aux autres ; idempotent', async () => {
    const j1 = (await srv.api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '1234' })).contenu.jeton
    const j2 = (await srv.api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '1234' })).contenu.jeton
    assert.equal((await srv.api('DELETE', '/sessions', undefined, { 'X-Session': j1 })).statut, 200)
    const r = await srv.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': j1 })
    assert.equal(r.statut, 401)
    assert.match(r.contenu.erreur, /fermée/)
    assert.equal((await srv.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': j2 })).statut, 200, 'l’autre session reste ouverte')
    assert.equal((await srv.api('DELETE', '/sessions', undefined, { 'X-Session': j1 })).statut, 200)
    assert.equal((await srv.api('DELETE', '/sessions')).statut, 401)
    assert.equal((await srv.api('DELETE', '/sessions', undefined, { 'X-Session': 'v1.abc.def' })).statut, 401)
    // Persistée en base (survit à un redémarrage) : jti + expiration, rien d'autre.
    const jti = JSON.parse(Buffer.from(j1.split('.')[1], 'base64url').toString()).jti
    assert.ok(lireBase(fichierDb, 'SELECT expire_le FROM sessions_revoquees WHERE jti = ?', jti))
  })

  test('révocation relue en base après redémarrage du serveur', async () => {
    const autre = join(dossier, 'redemarrage.db')
    let s = await demarrer(autre)
    const jeton = (await s.api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '1234' })).contenu.jeton
    await s.api('DELETE', '/sessions', undefined, { 'X-Session': jeton })
    await s.app.fermer()
    s = await demarrer(autre)
    try {
      assert.equal((await s.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': jeton })).statut, 401)
    } finally {
      await s.app.fermer()
    }
  })

  test('PIN en en-tête toujours accepté (compatibilité) ; X-Session, quand présent, décide seul', async () => {
    assert.equal((await srv.api('GET', `/commerces/${AH}/etat`, undefined, PIN)).statut, 200)
    assert.equal((await srv.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Admin-PIN': ADMIN })).statut, 200)
    assert.equal((await srv.api('GET', `/commerces/${AH}/caisse`, undefined, { 'X-Equipe-Code': '2468' })).statut, 200)
    assert.equal((await srv.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Commerce-PIN': '0000' })).statut, 401)
    assert.equal((await srv.api('GET', `/commerces/${AH}/etat`, undefined, { ...PIN, 'X-Session': 'v1.faux.faux' })).statut, 401)
  })

  test('membre retiré de l’équipe : sa session tombe aussitôt', async () => {
    const m = await srv.api('POST', `/commerces/${AH}/equipe`, { nom: 'Tom', code: '8642' }, PIN)
    const jeton = (await srv.api('POST', '/sessions', { role: 'equipe', commerceId: AH, code: '8642' })).contenu.jeton
    assert.equal((await srv.api('GET', `/commerces/${AH}/caisse`, undefined, { 'X-Session': jeton })).statut, 200)
    assert.equal((await srv.api('DELETE', `/commerces/${AH}/equipe/${m.contenu.membre.id}`, undefined, PIN)).statut, 200)
    assert.equal((await srv.api('GET', `/commerces/${AH}/caisse`, undefined, { 'X-Session': jeton })).statut, 401)
  })

  test('CORS : X-Session autorisé', async () => {
    const r = await fetch(`${srv.base}/sessions`, { method: 'OPTIONS' })
    assert.equal(r.status, 204)
    assert.match(r.headers.get('access-control-allow-headers') ?? '', /X-Session/)
  })

  test('/sante inchangé (aucune info de session exposée)', async () => {
    const r = await srv.api('GET', '/sante')
    assert.deepEqual(Object.keys(r.contenu).sort(), ['demo', 'integrations', 'migrations', 'mode', 'ok', 'stockage', 'version'])
    assert.doesNotMatch(JSON.stringify(r.contenu), /session/i)
  })
})

describe('P0-S1 : anti-bruteforce et serveur sans SESSION_SECRET', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-s1b-'))
  after(() => rmSync(dossier, { recursive: true, force: true }))

  test('10 PIN faux sur POST /sessions → 429, même avec le bon PIN ensuite (limiteur partagé avec les en-têtes)', async () => {
    const { app, api } = await demarrer(join(dossier, 'bf.db'))
    try {
      for (let i = 0; i < 5; i++) assert.equal((await api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '9999' })).statut, 401)
      for (let i = 0; i < 5; i++) assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Commerce-PIN': '9999' })).statut, 401)
      const r = await api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '1234' })
      assert.equal(r.statut, 429)
      assert.ok(Number(r.entetes.get('retry-after')) > 500)
      assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).statut, 429)
      assert.equal((await api('POST', '/sessions', { role: 'equipe', commerceId: AH, code: '2468' })).statut, 429)
    } finally {
      await app.fermer()
    }
  })

  test('sans SESSION_SECRET : POST /sessions → 503 explicite, le PIN en en-tête marche, X-Session → 401', async () => {
    const { app, api } = await demarrer(join(dossier, 'sans-secret.db'), { secretSession: undefined })
    try {
      const r = await api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '1234' })
      assert.equal(r.statut, 503)
      assert.match(r.contenu.erreur, /SESSION_SECRET/)
      assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).statut, 200)
      const jeton = emettreJeton(SECRET, { jti: 'x', role: 'admin', exp: Math.floor(horloge.getTime() / 1000) + 3600 })
      assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': jeton })).statut, 401)
    } finally {
      await app.fermer()
    }
  })

  test('server/index.ts : SESSION_SECRET absente en production (Supabase configuré, P0-S9) → refus de démarrer (code 1, correction Codex point 1)', async () => {
    // Supabase configuré (faux HTTP) pour isoler le motif du refus : le test porte sur SESSION_SECRET, pas sur la base
    // (P0-S9 refuse aussi la production sans Supabase).
    const faux = await demarrerFauxSupabaseHttp()
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      RENDER: '1',
      ADMIN_PIN: '24681357',
      PIN_ASIAN_HOME: '1357',
      SUPABASE_URL: faux.url,
      SUPABASE_SERVICE_ROLE_KEY: 'cle-service-factice-test',
      DB_FILE: join(dossier, 'prod.db'),
      STATIC_DIR: join(dossier, 'pas-de-front'),
      PORT: '0',
    }
    const enfant = spawn(process.execPath, [join(import.meta.dirname, '..', 'server', 'index.ts')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let sortie = ''
    let erreurs = ''
    enfant.stderr.on('data', (d) => (erreurs += d))
    enfant.stdout.on('data', (d) => (sortie += d))
    try {
      const code = await new Promise<number | null>((ok, ko) => {
        const minuterie = setTimeout(() => ko(new Error(`pas arrêté : ${sortie}${erreurs}`)), 20_000)
        // `close` (et non `exit`) : la sortie standard / d'erreur est entièrement lue avant les assertions.
        enfant.on('close', (c) => {
          clearTimeout(minuterie)
          ok(c)
        })
      })
      assert.equal(code, 1, sortie + erreurs)
      assert.doesNotMatch(sortie, /\/api\/v1\/sante/)
      assert.match(sortie + erreurs, /SESSION_SECRET est obligatoire en production/)
    } finally {
      enfant.kill()
      await faux.fermer()
    }
  })
})

// ---------- Front : client API, échange PIN → jeton, coffre ----------

function rangementMemoire(): RangementCle {
  let cle: CryptoKey | null = null
  return { lire: async () => cle, ecrire: async (c) => void (cle = c), effacer: async () => void (cle = null) }
}

function sessionMemoire() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }
}

describe('P0-S1 : front (src/data/api.ts, coffrePin.ts) contre le vrai serveur', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-s1c-'))
  let app: Awaited<ReturnType<typeof demarrer>>['app']
  let api: ClientApi
  before(async () => {
    const s = await demarrer(join(dossier, 'front.db'))
    app = s.app
    api = creerClientApi(s.base)
    await s.api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('échange PIN → jeton, puis le PIN ne circule plus : seul X-Session est envoyé', async () => {
    const envoyes: Record<string, string>[] = []
    const espion = creerClientApi(api.base, (url, init) => {
      envoyes.push({ ...(init?.headers as Record<string, string>) })
      return fetch(url, init)
    })
    const s = await echangerContreSession(espion, { role: 'commerce', commerceId: AH, pin: '1234' })
    assert.ok(s)
    const acces = accesDeSession(s)!
    assert.deepEqual(Object.keys(acces).sort(), ['commerceId', 'expireLe', 'jeton', 'role'])
    const etat = await espion.etat(AH, acces)
    assert.equal(etat.commerce.id, AH)
    assert.deepEqual(envoyes.at(-1), { 'X-Session': s.jeton })
    assert.ok(!JSON.stringify(envoyes.slice(1)).includes('1234'))

    // Admin : jeton aussi pour créer un commerce.
    const adm = accesDeSession((await echangerContreSession(api, { role: 'admin', pin: ADMIN }))!)!
    assert.equal((await api.creerCommerce(adm, { nom: 'Chez Lin', type: 'restaurant', lienGoogle: '', pin: '5555' })).nom, 'Chez Lin')

    // « Verrouiller » : fermeture côté serveur, puis le jeton est refusé.
    await espion.fermerSession(s.jeton)
    await assert.rejects(api.etat(AH, acces), (e: ErreurApi) => e.statut === 401)
  })

  test('caisse : jeton équipe pour charger et agir ; code en repli toujours accepté', async () => {
    const s = (await echangerContreSession(api, { role: 'equipe', commerceId: AH, code: '2468' }))!
    assert.equal(s.membreNom, 'Mai')
    const acces = { role: 'equipe' as const, commerceId: AH, jeton: s.jeton }
    const c = await api.caisse(AH, acces)
    assert.equal(c.auteur.nom, 'Mai')
    const client = (await api.inscrire(AH, { role: 'commerce', commerceId: AH, pin: '1234' }, 'Linh', '0611223344')).client
    const r = await api.actionCaisse(AH, acces, 'passage', { clientId: client.id, actionId: 'act-front-s1-01' })
    assert.equal(r.client.tampons, 1)
    assert.equal((await api.caisse(AH, { code: '2468' })).auteur.nom, 'Mai')
  })

  test('repli transparent : 503 (pas de secret), 404 (ancien serveur) ou réseau → null ; PIN faux (401) relancé', async () => {
    const reponse = (statut: number) => creerClientApi('http://x/api/v1', async () => new Response(JSON.stringify({ erreur: 'x' }), { status: statut }))
    for (const statut of [503, 404, 405]) assert.equal(await echangerContreSession(reponse(statut), { role: 'admin', pin: ADMIN }), null, String(statut))
    const horsLigne = creerClientApi('http://x/api/v1', async () => {
      throw new TypeError('fetch failed')
    })
    assert.equal(await echangerContreSession(horsLigne, { role: 'admin', pin: ADMIN }), null)
    await assert.rejects(echangerContreSession(api, { role: 'commerce', commerceId: AH, pin: '0000' }), (e: ErreurApi) => e.statut === 401)
  })

  test('coffre : garde { jeton } comme { pin }, chiffré ; rejette toute autre forme', async () => {
    const session = sessionMemoire()
    const rangement = rangementMemoire()
    const coffre = creerCoffrePin(session, rangement)
    const jeton = 'v1.eyJhIjoxfQ.c2lnbmF0dXJl'
    const accesJeton = { role: 'commerce' as const, commerceId: AH, jeton, expireLe: '2026-11-10T17:00:00.000Z' }
    assert.equal(await coffre.memoriser(accesJeton), true)
    assert.ok(![...session.m.values()].some((v) => v.includes(jeton)), 'jamais en clair')
    assert.deepEqual(await coffre.lire(), accesJeton)
    const equipe = { role: 'equipe' as const, commerceId: AH, jeton, membreNom: 'Mai' }
    assert.equal(await coffre.memoriser(equipe), true)
    assert.deepEqual(await coffre.lire(), equipe)
    assert.equal(await coffre.memoriser({ role: 'admin', pin: ADMIN }), true)
    assert.deepEqual(await coffre.lire(), { role: 'admin', pin: ADMIN })

    // Formes inconnues : refusées à l'écriture et à la lecture.
    const inconnues: unknown[] = [
      { role: 'admin' },
      { role: 'admin', pin: ADMIN, jeton },
      { role: 'equipe', commerceId: AH, pin: '2468' },
      { role: 'commerce', jeton },
      { role: 'root', jeton },
      { role: 'admin', jeton: 'pas-un-jeton' },
      { role: 'admin', pin: 'abcd' },
      'texte',
      null,
    ]
    for (const x of inconnues) assert.equal(await coffre.memoriser(x as never), false, JSON.stringify(x))
    // Une forme inconnue déjà chiffrée dans le stockage (ancienne version, altération) n'est pas relue.
    const k = await rangement.lire()
    for (const x of inconnues.slice(0, 6)) {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const chiffre = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k!, new TextEncoder().encode(JSON.stringify(x)))
      const b64 = (o: ArrayBuffer | Uint8Array) => Buffer.from(o instanceof Uint8Array ? o : new Uint8Array(o)).toString('base64')
      session.setItem('fidelite:acces', JSON.stringify({ iv: b64(iv), donnees: b64(chiffre) }))
      assert.equal(await coffre.lire(), null, JSON.stringify(x))
    }
  })
})

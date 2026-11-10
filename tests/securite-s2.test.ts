// P0-S2 (audit du 10/11/2026, failles F-04 et F-06) : limitation des routes publiques (par IP, par carte, par contact)
// et anti-bruteforce des PIN / codes persistant en base (table `tentatives_auth`, migration Supabase 0006).
// Vrai serveur HTTP + vraie base SQLite temporaire ; migration 0006 exécutée sur Postgres (PGlite).
import { test, describe, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AddressInfo } from 'node:net'
import { PGlite } from '@electric-sql/pglite'

import { creerServeur, LIMITES_PUBLIQUES, type OptionsServeur } from '../server/app.ts'

const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const SECRET = 'secret-de-session-de-test-assez-long-0123456789'
const MIN = 60_000

const dossier = mkdtempSync(join(tmpdir(), 'fidelite-s2-'))
after(() => rmSync(dossier, { recursive: true, force: true }))

let horloge = new Date(2026, 10, 10, 9, 0)
const avancer = (ms: number) => (horloge = new Date(horloge.getTime() + ms))

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
    return { statut: r.status, contenu: await r.json(), retry: Number(r.headers.get('retry-after') ?? NaN) }
  }
  return { app, api }
}

function lignes(fichierDb: string) {
  const db = new DatabaseSync(fichierDb)
  try {
    return db.prepare('SELECT * FROM tentatives_auth ORDER BY cle').all() as { cle: string; portee: string; echecs: number; bloque_jusqu_a: string | null; derniere_tentative: string }[]
  } finally {
    db.close()
  }
}

/** Numéro de téléphone français valide et distinct pour chaque n. */
const tel = (n: number) => `06${String(10_000_000 + n).slice(-8)}`

describe('P0-S2 : routes publiques limitées (F-04)', () => {
  test('seuils par défaut documentés et cohérents', () => {
    assert.deepEqual(LIMITES_PUBLIQUES, {
      lectureParIp: 120,
      lectureParCarte: 30,
      inscriptionParIp: 10,
      inscriptionParContact: 5,
      tirageParIp: 20,
      tirageParContact: 5,
      ficheClientParIp: 10,
      sessionParIp: 30,
    })
    const readme = readFileSync(join(import.meta.dirname, '..', 'server', 'README.md'), 'utf8')
    for (const [k, v] of Object.entries(LIMITES_PUBLIQUES)) assert.match(readme, new RegExp(`\`${k}\`[^\\n]*\\b${v}\\b`), `${k} documenté dans server/README.md`)
    assert.match(readme, /0006_tentatives_auth\.sql/)
  })

  test('inscription publique : 10 / min / IP → 429 + Retry-After, puis de nouveau permis la minute suivante', async () => {
    const { app, api } = await demarrer(join(dossier, 'inscription.db'))
    try {
      for (let i = 0; i < 10; i++) assert.equal((await api('POST', `/commerces/${AH}/clients`, { contact: tel(i) })).statut, 201, `inscription ${i + 1}`)
      const r = await api('POST', `/commerces/${AH}/clients`, { contact: tel(99) })
      assert.equal(r.statut, 429)
      assert.match(r.contenu.erreur, /Trop de requêtes/)
      assert.ok(r.retry >= 1 && r.retry <= 60, `Retry-After = ${r.retry}`)
      // Le gérant (PIN) n'est pas concerné : sa tablette inscrit autant qu'il faut.
      assert.equal((await api('POST', `/commerces/${AH}/clients`, { contact: tel(50) }, PIN)).statut, 201)
      avancer(MIN)
      assert.equal((await api('POST', `/commerces/${AH}/clients`, { contact: tel(99) })).statut, 201)
    } finally {
      await app.fermer()
    }
  })

  test('par contact : 5 / min pour un même numéro (tous formats confondus), même depuis plusieurs IP', async () => {
    const { app, api } = await demarrer(join(dossier, 'contact.db'), { derriereProxy: true })
    try {
      const formats = ['0612345678', '+33612345678', '06 12 34 56 78', '0033612345678', '06.12.34.56.78']
      for (const [i, contact] of formats.entries()) {
        const r = await api('POST', `/commerces/${AH}/clients`, { contact }, { 'X-Forwarded-For': `10.0.0.${i}` })
        assert.equal(r.statut, i === 0 ? 201 : 200, contact)
      }
      const r = await api('POST', `/commerces/${AH}/clients`, { contact: '0612345678' }, { 'X-Forwarded-For': '10.0.0.9' })
      assert.equal(r.statut, 429)
      assert.match(r.contenu.erreur, /ce contact/)
      assert.doesNotMatch(r.contenu.erreur, /0612345678/)
      // Un autre numéro passe ; le même numéro dans un autre commerce aussi (compteur par commerce).
      assert.equal((await api('POST', `/commerces/${AH}/clients`, { contact: '0700000001' }, { 'X-Forwarded-For': '10.0.0.9' })).statut, 201)
      // Tirages : compteur par contact distinct de l'inscription.
      for (let i = 0; i < 5; i++) assert.equal((await api('POST', `/commerces/${AH}/tirages`, { contact: '0612345678' }, { 'X-Forwarded-For': `10.0.1.${i}` })).statut, 409, 'sans visite du jour')
      assert.equal((await api('POST', `/commerces/${AH}/tirages`, { contact: '0612345678' }, { 'X-Forwarded-For': '10.0.1.9' })).statut, 429)
    } finally {
      await app.fermer()
    }
  })

  test('lectures : par carte (30 / min) et par IP ; tirage, fiche client et sessions par IP ; seuils réglables', async () => {
    const { app, api } = await demarrer(join(dossier, 'lectures.db'), {
      limitesPubliques: { lectureParIp: 40, tirageParIp: 3, ficheClientParIp: 2, sessionParIp: 4 },
    })
    try {
      const client = (await api('POST', `/commerces/${AH}/clients`, { contact: '0611111111' }, PIN)).contenu.client
      for (let i = 0; i < 30; i++) assert.equal((await api('GET', `/cartes/${client.id}`)).statut, 200)
      assert.equal((await api('GET', `/cartes/${client.id}`)).statut, 429, '31e lecture de la même carte')
      assert.equal((await api('POST', `/cartes/${client.id}/lus`)).statut, 429, 'même compteur pour « lus »')
      // Lectures par IP : 32 déjà comptées (dont les 2 refusées) ; 8 de plus passent, puis 429 sur toute lecture publique.
      for (let i = 0; i < 8; i++) assert.equal((await api('GET', `/commerces/${AH}`)).statut, 200)
      assert.equal((await api('GET', '/commerces')).statut, 429)
      assert.equal((await api('GET', `/commerces/${AH}/menu`)).statut, 429)
      // Les routes authentifiées ne sont jamais limitées par ces compteurs.
      assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).statut, 200)

      for (let i = 0; i < 3; i++) assert.equal((await api('POST', `/commerces/${AH}/tirages`, { contact: tel(200 + i) })).statut, 409)
      assert.equal((await api('POST', `/commerces/${AH}/tirages`, { contact: tel(210) })).statut, 429)

      for (let i = 0; i < 2; i++) assert.equal((await api('POST', `/commerces/${AH}/clients/${client.id}/profil`, { platPrefere: 'Pho' })).statut, 409)
      assert.equal((await api('POST', `/commerces/${AH}/clients/${client.id}/rattrapage`, {})).statut, 429)

      for (let i = 0; i < 4; i++) assert.equal((await api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '1234' })).statut, 201)
      assert.equal((await api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '1234' })).statut, 429)

      avancer(MIN)
      assert.equal((await api('GET', `/cartes/${client.id}`)).statut, 200, 'nouvelle fenêtre')
    } finally {
      await app.fermer()
    }
  })
})

describe('P0-S2 : anti-bruteforce persistant (F-06)', () => {
  test('blocage relu en base après redémarrage, levé à l’échéance, puis doublé (progressif)', async () => {
    const fichier = join(dossier, 'persistance.db')
    let { app, api } = await demarrer(fichier)
    try {
      for (let i = 0; i < 10; i++) assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Commerce-PIN': '9999' })).statut, 401)
      assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).statut, 429)
    } finally {
      await app.fermer()
    }
    ;({ app, api } = await demarrer(fichier))
    try {
      const r = await api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '1234' })
      assert.equal(r.statut, 429, 'toujours bloqué après redémarrage')
      assert.ok(r.retry > 9 * 60 && r.retry <= 10 * 60, `Retry-After = ${r.retry}`)
      // Fin du blocage, et nouvelle série aussitôt (sans accès réussi entre-temps) : le 2e blocage dure 20 min.
      avancer(10 * MIN)
      for (let i = 0; i < 10; i++) assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Commerce-PIN': '9999' })).statut, 401)
      const r2 = await api('GET', `/commerces/${AH}/etat`, undefined, PIN)
      assert.equal(r2.statut, 429)
      assert.ok(r2.retry > 19 * 60 && r2.retry <= 20 * 60, `2e blocage : Retry-After = ${r2.retry}`)
      assert.equal(lignes(fichier).find((l) => l.cle === 'ip:127.0.0.1')?.echecs, 20)
      avancer(20 * MIN)
      assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).statut, 200, 'blocage terminé')
      assert.equal(lignes(fichier).find((l) => l.cle === 'ip:127.0.0.1'), undefined, 'accès réussi : compteur de l’IP effacé')
      assert.equal(lignes(fichier).find((l) => l.cle === `cible:${AH}`)?.echecs, 20, 'celui de la cible reste')
    } finally {
      await app.fermer()
      avancer(24 * 60 * MIN)
    }
  })

  test('attaque distribuée : 50 échecs depuis 50 IP bloquent ce commerce seulement (autres commerces et admin intacts)', async () => {
    const fichier = join(dossier, 'distribue.db')
    const { app, api } = await demarrer(fichier, { derriereProxy: true })
    try {
      const autre = await api('POST', '/commerces', { nom: 'Chez Lin', type: 'restaurant', lienGoogle: '', pin: '5555' }, { 'X-Admin-PIN': ADMIN, 'X-Forwarded-For': '10.9.9.9' })
      assert.equal(autre.statut, 201)
      for (let i = 0; i < 50; i++) {
        const corps = i % 2 ? { role: 'equipe', commerceId: AH, code: '0000' } : { role: 'commerce', commerceId: AH, pin: '0000' }
        assert.equal((await api('POST', '/sessions', corps, { 'X-Forwarded-For': `10.1.${i}.1` })).statut, 401, `essai ${i + 1}`)
      }
      const r = await api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '1234' }, { 'X-Forwarded-For': '10.2.0.1' })
      assert.equal(r.statut, 429, 'IP neuve, bon PIN : refusé tant que la cible est bloquée')
      assert.equal((await api('POST', '/sessions', { role: 'commerce', commerceId: autre.contenu.commerce.id, pin: '5555' }, { 'X-Forwarded-For': '10.2.0.1' })).statut, 201)
      assert.equal((await api('POST', '/sessions', { role: 'admin', pin: ADMIN }, { 'X-Forwarded-For': '10.2.0.1' })).statut, 201)
      const cible = lignes(fichier).find((l) => l.cle === `cible:${AH}`)!
      assert.equal(cible.echecs, 50)
      assert.ok(cible.bloque_jusqu_a)
    } finally {
      await app.fermer()
      avancer(24 * 60 * MIN)
    }
  })

  test('journal des échecs : table et logs serveur sans PIN, code ni contact', async (t) => {
    const fichier = join(dossier, 'journal.db')
    const info = t.mock.method(console, 'info', () => {})
    const warn = t.mock.method(console, 'warn', () => {})
    const { app, api } = await demarrer(fichier)
    try {
      assert.equal((await api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)).statut, 201)
      assert.equal((await api('GET', `/commerces/${AH}/caisse`, undefined, { 'X-Equipe-Code': '1357' })).statut, 401)
      for (let i = 0; i < 9; i++) await api('POST', '/sessions', { role: 'admin', pin: '11112222' })
      const l = lignes(fichier)
      assert.deepEqual(
        l.map((x) => [x.cle, x.portee, x.echecs, x.bloque_jusqu_a === null]),
        [
          ['cible:admin', 'admin', 9, true],
          [`cible:${AH}`, 'equipe', 1, true],
          ['ip:127.0.0.1', 'admin', 10, false],
        ],
      )
      assert.equal(l[0].derniere_tentative, horloge.toISOString())
      const logs = [...info.mock.calls, ...warn.mock.calls].map((c) => c.arguments.join(' ')).join('\n')
      assert.match(logs, /\[securite\] échec equipe : ip:127\.0\.0\.1 1\/10, cible:c-asian-home-paris 1\/50/)
      assert.match(logs, /\[securite\] BLOCAGE ip:127\.0\.0\.1 \(portée admin\) : 10 échecs → 10 min/)
      assert.doesNotMatch(logs, /1357|11112222|2468|1234/)
    } finally {
      await app.fermer()
      avancer(24 * 60 * MIN)
    }
  })

  test('table illisible (base indisponible) : repli en mémoire, jamais de 500', async () => {
    const fichier = join(dossier, 'sans-table.db')
    const { app, api } = await demarrer(fichier)
    const warn = mock.method(console, 'warn', () => {})
    try {
      const db = new DatabaseSync(fichier)
      db.exec('DROP TABLE tentatives_auth')
      db.close()
      for (let i = 0; i < 10; i++) assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Commerce-PIN': '9999' })).statut, 401)
      assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).statut, 429, 'bloqué en mémoire')
      assert.ok(warn.mock.calls.some((c) => /en mémoire seulement/.test(String(c.arguments[0]))))
    } finally {
      warn.mock.restore()
      await app.fermer()
      avancer(24 * 60 * MIN)
    }
  })
})

describe('P0-S2 : migration Supabase 0006 sur Postgres (PGlite)', () => {
  const MIGRATIONS = join(import.meta.dirname, '..', 'supabase', 'migrations')
  const sql = (nom: string) => readFileSync(join(MIGRATIONS, nom), 'utf8')

  test('passe après 0001–0005, rejouable ; RLS sans policy, fermée à anon ; contraintes ; le DOWN la retire', async () => {
    const db = new PGlite()
    try {
      await db.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;')
      for (const f of ['0001_schema_initial.sql', '0002_rls.sql', '0003_cartiz.sql', '0004_programme.sql', '0005_sessions_revoquees.sql']) await db.exec(sql(f))
      await db.exec(sql('0006_tentatives_auth.sql'))
      await db.exec(sql('0006_tentatives_auth.sql'))
      const rls = await db.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'tentatives_auth'`)
      assert.equal(rls.rows[0].relrowsecurity, true)
      assert.equal((await db.query(`select 1 from pg_policies where tablename = 'tentatives_auth'`)).rows.length, 0)
      for (const role of ['anon', 'authenticated']) {
        const { rows } = await db.query<{ ok: boolean }>(`select has_table_privilege($1, 'public.tentatives_auth', 'select') or has_table_privilege($1, 'public.tentatives_auth', 'insert') as ok`, [role])
        assert.equal(rows[0].ok, false, role)
      }
      assert.equal((await db.query<{ ok: boolean }>(`select has_table_privilege('service_role', 'public.tentatives_auth', 'delete') as ok`)).rows[0].ok, true)

      await db.query(`insert into public.tentatives_auth (cle, portee, echecs, bloque_jusqu_a, derniere_tentative) values ('ip:1.2.3.4', 'commerce', 10, now() + interval '10 minutes', now())`)
      // Upsert sur la clé (comme enregistrerTentativesAuth).
      await db.query(`insert into public.tentatives_auth (cle, portee, echecs, derniere_tentative) values ('ip:1.2.3.4', 'equipe', 11, now())
        on conflict (cle) do update set portee = excluded.portee, echecs = excluded.echecs, bloque_jusqu_a = excluded.bloque_jusqu_a`)
      const l = (await db.query<{ portee: string; echecs: number; bloque_jusqu_a: string | null }>(`select portee, echecs, bloque_jusqu_a from public.tentatives_auth`)).rows
      assert.deepEqual(l, [{ portee: 'equipe', echecs: 11, bloque_jusqu_a: null }])
      const code = async (q: string) => db.query(q).then(() => 'ok', (e: { code?: string }) => e.code)
      assert.equal(await code(`insert into public.tentatives_auth (cle, portee, echecs, derniere_tentative) values ('x', 'pirate', 1, now())`), '23514', 'portée inconnue')
      assert.equal(await code(`insert into public.tentatives_auth (cle, portee, echecs, derniere_tentative) values ('x', 'admin', -1, now())`), '23514', 'échecs négatifs')
      assert.equal(await code(`insert into public.tentatives_auth (cle, portee, echecs) values ('x', 'admin', 1)`), '23502', 'dernière tentative obligatoire')

      await db.exec(sql('0006_tentatives_auth.down.sql'))
      await db.exec(sql('0006_tentatives_auth.down.sql'))
      assert.equal((await db.query(`select 1 from pg_class where relnamespace = 'public'::regnamespace and relname = 'tentatives_auth'`)).rows.length, 0)
      const restantes = await db.query<{ t: string | null }>(`select to_regclass('public.commerces')::text as t union all select to_regclass('public.sessions_revoquees')::text`)
      assert.deepEqual(restantes.rows.map((r) => r.t), ['commerces', 'sessions_revoquees'], 'autres tables intactes')
    } finally {
      await db.close()
    }
  })
})

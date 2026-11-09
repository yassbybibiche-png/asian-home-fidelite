// Phase S2 : la migration Supabase exécutée par un VRAI moteur Postgres, sans Supabase ni réseau.
// PGlite (@electric-sql/pglite, dépendance de dev) = Postgres compilé en WebAssembly, lancé en mémoire dans Node.
// Limites honnêtes : ce n'est pas Supabase (pas de PostgREST, pas d'extensions ni de rôles Supabase : `anon`,
// `authenticated` et `service_role` sont recréés ici à l'identique de leurs attributs utiles) et la version de Postgres
// de PGlite peut différer de celle du projet Supabase. La migration reste à exécuter dans le SQL Editor du vrai projet.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const MIGRATIONS = join(import.meta.dirname, '..', 'supabase', 'migrations')
const sql = (nom: string) => readFileSync(join(MIGRATIONS, nom), 'utf8')
const TABLES = ['avis', 'clients', 'commerces', 'meta', 'tirages']

/** Code SQLSTATE d'une requête qui doit échouer. */
async function codeErreur(promesse: Promise<unknown>): Promise<string> {
  try {
    await promesse
  } catch (e) {
    return (e as { code?: string }).code ?? String(e)
  }
  assert.fail('la requête aurait dû échouer')
}

describe('Migration Supabase exécutée sur Postgres (PGlite)', () => {
  let db: PGlite

  before(async () => {
    db = new PGlite()
    // Rôles que Supabase crée d'office (service_role a BYPASSRLS).
    await db.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;')
    await db.exec(sql('0001_schema_initial.sql'))
    await db.exec(sql('0002_rls.sql'))
    await db.exec(`insert into public.commerces (id, donnees, pin_hash, pin_sel) values
      ('c1', '{"id":"c1"}', 'h', 's'), ('c2', '{"id":"c2"}', 'h', 's');
      insert into public.clients (id, commerce_id, cle_contact, donnees) values
      ('k1', 'c1', '0612345678', '{"id":"k1","commerceId":"c1"}');`)
  })
  after(() => db.close())

  test('0001 puis 0002 passent, et sont rejouables (2e exécution sans erreur, données gardées)', async () => {
    await db.exec(sql('0001_schema_initial.sql'))
    await db.exec(sql('0002_rls.sql'))
    const { rows } = await db.query<{ n: number }>('select count(*)::int as n from public.commerces')
    assert.equal(rows[0].n, 2)
  })

  test('les 5 tables existent, RLS activée partout, aucune policy', async () => {
    const tables = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)
    assert.deepEqual(tables.rows.map((t) => t.relname), TABLES)
    assert.ok(tables.rows.every((t) => t.relrowsecurity))
    const policies = await db.query<{ n: number }>(`select count(*)::int as n from pg_policies where schemaname = 'public'`)
    assert.equal(policies.rows[0].n, 0)
  })

  test('anon et authenticated n’ont aucun droit ; service_role lit et écrit', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const t of TABLES) {
        const { rows } = await db.query<{ ok: boolean }>(
          `select has_table_privilege($1, $2, 'select') or has_table_privilege($1, $2, 'insert') or has_table_privilege($1, $2, 'update') or has_table_privilege($1, $2, 'delete') as ok`,
          [role, `public.${t}`])
        assert.equal(rows[0].ok, false, `${role} sur ${t}`)
      }
      await db.exec(`set role ${role}`)
      try {
        assert.equal(await codeErreur(db.query('select * from public.clients')), '42501') // permission refusée
      } finally {
        await db.exec('reset role')
      }
    }
    await db.exec('set role service_role')
    try {
      const { rows } = await db.query<{ id: string }>('select id from public.clients')
      assert.deepEqual(rows.map((r) => r.id), ['k1'])
    } finally {
      await db.exec('reset role')
    }
  })

  test('anti-doublon : même contact dans le même commerce refusé (23505), accepté dans un autre commerce', async () => {
    const insert = (id: string, commerce: string) => db.query(
      `insert into public.clients (id, commerce_id, cle_contact, donnees) values ($1, $2, '0612345678', $3)`,
      [id, commerce, JSON.stringify({ id, commerceId: commerce })])
    assert.equal(await codeErreur(insert('k-doublon', 'c1')), '23505')
    await insert('k-autre', 'c2')
  })

  test('1 tirage par client et par jour À PARIS (index unique sur une expression timestamptz → date)', async () => {
    const tirage = (id: string, date: string) => db.query(
      `insert into public.tirages (id, commerce_id, client_id, date, donnees) values ($1, 'c1', 'k1', $2, $3)`,
      [id, date, JSON.stringify({ id, clientId: 'k1' })])
    await tirage('t1', '2026-11-09T10:00:00Z')
    // 22:30 UTC = 23:30 à Paris, toujours le 9 → refusé.
    assert.equal(await codeErreur(tirage('t2', '2026-11-09T22:30:00Z')), '23505')
    // 23:30 UTC = 00:30 à Paris le 10 → nouveau jour, accepté.
    await tirage('t3', '2026-11-09T23:30:00Z')
    // Heure d'été (UTC+2) : 22:30 UTC le 1er juillet = 00:30 le 2 à Paris.
    await tirage('t4', '2026-07-01T21:30:00Z')
    await tirage('t5', '2026-07-01T22:30:00Z')
  })

  test('contraintes de cohérence id / donnees et clés étrangères', async () => {
    assert.equal(await codeErreur(db.query(
      `insert into public.commerces (id, donnees, pin_hash, pin_sel) values ('c3', '{"id":"autre"}', 'h', 's')`)), '23514')
    assert.equal(await codeErreur(db.query(
      `insert into public.clients (id, commerce_id, cle_contact, donnees) values ('k9', 'inconnu', 'x', '{"id":"k9","commerceId":"inconnu"}')`)), '23503')
  })

  test('version : +1 à chaque UPDATE (trigger) ; UPDATE conditionné à une version périmée → 0 ligne', async () => {
    const lire = async () => (await db.query<{ version: number }>(`select version from public.clients where id = 'k1'`)).rows[0].version
    const v = await lire()
    await db.query(`update public.clients set donnees = donnees where id = 'k1'`)
    assert.equal(await lire(), v + 1)
    const r = await db.query(`update public.clients set donnees = donnees where id = 'k1' and version = $1`, [v])
    assert.equal(r.affectedRows, 0)
  })

  test('meta : upsert sur la clé (comme majMeta)', async () => {
    await db.query(`insert into public.meta (cle, valeur) values ('initialise', '1') on conflict (cle) do update set valeur = excluded.valeur`)
    await db.query(`insert into public.meta (cle, valeur) values ('initialise', '2') on conflict (cle) do update set valeur = excluded.valeur`)
    const { rows } = await db.query<{ valeur: string }>(`select valeur from public.meta where cle = 'initialise'`)
    assert.equal(rows[0].valeur, '2')
  })

  test('0003_cartiz : passe après 0001/0002, rejouable ; equipe / journal / menus avec RLS, sans policy, fermées à anon', async () => {
    await db.exec(sql('0003_cartiz.sql'))
    await db.exec(sql('0003_cartiz.sql'))
    const t = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname in ('equipe', 'journal', 'menus') order by 1`)
    assert.deepEqual(t.rows.map((r) => [r.relname, r.relrowsecurity]), [['equipe', true], ['journal', true], ['menus', true]])
    assert.equal((await db.query<{ n: number }>(`select count(*)::int as n from pg_policies where schemaname = 'public'`)).rows[0].n, 0)
    for (const role of ['anon', 'authenticated']) {
      for (const table of ['equipe', 'journal', 'menus']) {
        const { rows } = await db.query<{ ok: boolean }>(`select has_table_privilege($1, $2, 'select') or has_table_privilege($1, $2, 'insert') as ok`, [role, `public.${table}`])
        assert.equal(rows[0].ok, false, `${role} sur ${table}`)
      }
    }
    // Un code en clair dans `donnees` est refusé par la base ; menu : un seul par commerce ; version incrémentée.
    assert.equal(await codeErreur(db.query(`insert into public.equipe (id, commerce_id, donnees, code_hash, code_sel) values ('m0', 'c2', '{"id":"m0","commerceId":"c2","code":"1234"}', 'h', 's')`)), '23514')
    await db.query(`insert into public.equipe (id, commerce_id, donnees, code_hash, code_sel) values ('m1', 'c2', '{"id":"m1","commerceId":"c2","nom":"Mai"}', 'h', 's')`)
    await db.query(`insert into public.journal (id, commerce_id, date, donnees) values ('j1', 'c2', now(), '{"id":"j1","commerceId":"c2"}')`)
    await db.query(`insert into public.menus (commerce_id, donnees) values ('c2', '{"commerceId":"c2","categories":[]}') on conflict (commerce_id) do update set donnees = excluded.donnees`)
    await db.query(`insert into public.menus (commerce_id, donnees) values ('c2', '{"commerceId":"c2","categories":[1]}') on conflict (commerce_id) do update set donnees = excluded.donnees`)
    const menu = await db.query<{ version: number }>(`select version from public.menus where commerce_id = 'c2'`)
    assert.deepEqual(menu.rows.map((r) => r.version), [2])
    await db.query(`delete from public.commerces where id = 'c2'`)
    const { rows } = await db.query<{ n: number }>(`select (select count(*) from public.equipe) + (select count(*) from public.journal) + (select count(*) from public.menus) as n`)
    assert.equal(Number(rows[0].n), 0, 'suppression en cascade')
  })

  test('suppression d’un commerce : clients et tirages supprimés en cascade', async () => {
    await db.query(`delete from public.commerces where id = 'c1'`)
    const { rows } = await db.query<{ n: number }>(
      `select (select count(*) from public.clients where commerce_id = 'c1') + (select count(*) from public.tirages where commerce_id = 'c1') as n`)
    assert.equal(Number(rows[0].n), 0)
  })
})

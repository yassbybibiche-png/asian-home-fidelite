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

  test('0004_programme : passe après 0001/0002/0003, rejouable ; parrainages / demandes_rattrapage avec RLS, sans policy, fermées à anon', async () => {
    await db.exec(sql('0004_programme.sql'))
    await db.exec(sql('0004_programme.sql'))
    const t = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname in ('parrainages', 'demandes_rattrapage') order by 1`)
    assert.deepEqual(t.rows.map((r) => [r.relname, r.relrowsecurity]), [['demandes_rattrapage', true], ['parrainages', true]])
    assert.equal((await db.query<{ n: number }>(`select count(*)::int as n from pg_policies where schemaname = 'public'`)).rows[0].n, 0)
    for (const role of ['anon', 'authenticated']) {
      for (const table of ['parrainages', 'demandes_rattrapage']) {
        const { rows } = await db.query<{ ok: boolean }>(`select has_table_privilege($1, $2, 'select') or has_table_privilege($1, $2, 'insert') as ok`, [role, `public.${table}`])
        assert.equal(rows[0].ok, false, `${role} sur ${table}`)
      }
    }
    // Un parrain ne peut pas se parrainer lui-même ; demande de rattrapage : une seule par client et par jour.
    await db.query(`insert into public.commerces (id, donnees, pin_hash, pin_sel) values ('c3', '{"id":"c3"}', 'h', 's')`)
    assert.equal(await codeErreur(db.query(`insert into public.parrainages (id, commerce_id, parrain_id, filleul_id, date, donnees) values ('p0', 'c3', 'cl1', 'cl1', now(), '{}')`)), '23514')
    await db.query(`insert into public.parrainages (id, commerce_id, parrain_id, filleul_id, date, donnees) values ('p1', 'c3', 'cl1', 'cl2', now(), '{"id":"p1","commerceId":"c3","pointsParrain":50,"pointsFilleul":50}')`)
    await db.query(`insert into public.demandes_rattrapage (id, commerce_id, client_id, date, donnees) values ('r1', 'c3', 'cl2', now(), '{"id":"r1","statut":"en_attente"}')`)
    await db.query(`delete from public.commerces where id = 'c3'`)
    const { rows } = await db.query<{ n: number }>(`select (select count(*) from public.parrainages) + (select count(*) from public.demandes_rattrapage) as n`)
    assert.equal(Number(rows[0].n), 0, 'suppression en cascade')
  })

  test('0005_sessions_revoquees : passe après 0001–0004, rejouable ; RLS sans policy, fermée à anon ; le DOWN la retire', async () => {
    await db.exec(sql('0005_sessions_revoquees.sql'))
    await db.exec(sql('0005_sessions_revoquees.sql'))
    const t = await db.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'sessions_revoquees'`)
    assert.deepEqual(t.rows.map((r) => r.relrowsecurity), [true])
    assert.equal((await db.query<{ n: number }>(`select count(*)::int as n from pg_policies where schemaname = 'public'`)).rows[0].n, 0)
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await db.query<{ ok: boolean }>(`select has_table_privilege($1, 'public.sessions_revoquees', 'select') or has_table_privilege($1, 'public.sessions_revoquees', 'insert') as ok`, [role])
      assert.equal(rows[0].ok, false, role)
    }
    const { rows } = await db.query<{ ok: boolean }>(`select has_table_privilege('service_role', 'public.sessions_revoquees', 'delete') as ok`)
    assert.equal(rows[0].ok, true)
    await db.query(`insert into public.sessions_revoquees (jti, expire_le) values ('j1', now() + interval '8 hours')`)
    assert.equal(await codeErreur(db.query(`insert into public.sessions_revoquees (jti, expire_le) values ('j1', now())`)), '23505')
    assert.equal(await codeErreur(db.query(`insert into public.sessions_revoquees (jti) values ('j2')`)), '23502', 'expire_le obligatoire')
    await db.exec(sql('0005_sessions_revoquees.down.sql'))
    await db.exec(sql('0005_sessions_revoquees.down.sql'))
    assert.equal((await db.query(`select 1 from pg_class where relnamespace = 'public'::regnamespace and relname = 'sessions_revoquees'`)).rows.length, 0)
    await db.exec(sql('0005_sessions_revoquees.sql'))
  })

  test('0007_relances : rejouable ; RLS fermée à anon ; 1 relance envoyée par client / modèle / jour (index partiel) ; DOWN', async () => {
    await db.exec(sql('0007_relances.sql'))
    await db.exec(sql('0007_relances.sql'))
    const t = await db.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'envois'`)
    assert.deepEqual(t.rows.map((r) => r.relrowsecurity), [true])
    assert.equal((await db.query<{ n: number }>(`select count(*)::int as n from pg_policies where schemaname = 'public'`)).rows[0].n, 0)
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await db.query<{ ok: boolean }>(`select has_table_privilege($1, 'public.envois', 'select') or has_table_privilege($1, 'public.envois', 'insert') as ok`, [role])
      assert.equal(rows[0].ok, false, role)
    }
    await db.query(`insert into public.commerces (id, donnees, pin_hash, pin_sel) values ('c7', '{"id":"c7"}', 'h', 's')`)
    const envoi = (id: string, statut: string, modele = 'inactif', jour = '2026-11-10') =>
      db.query(`insert into public.envois (id, commerce_id, client_id, modele, canal, statut, jour, date, donnees) values ($1, 'c7', 'k1', $2, 'sms', $3, $4, now(), $5)`, [
        id,
        modele,
        statut,
        jour,
        JSON.stringify({ id, commerceId: 'c7' }),
      ])
    await envoi('e1', 'refuse')
    await envoi('e2', 'refuse') // les refus ne bloquent rien
    await envoi('e3', 'en_cours')
    assert.equal(await codeErreur(envoi('e4', 'envoye')), '23505', 'même client, modèle et jour : refusé')
    await db.query(`update public.envois set statut = 'envoye' where id = 'e3'`)
    assert.equal(await codeErreur(envoi('e5', 'en_cours')), '23505')
    await envoi('e6', 'en_cours', 'anniversaire') // autre modèle
    await envoi('e7', 'en_cours', 'inactif', '2026-11-11') // autre jour
    await db.query(`update public.envois set statut = 'erreur' where id = 'e7'`)
    await envoi('e8', 'en_cours', 'inactif', '2026-11-11') // une erreur libère la place
    assert.equal(await codeErreur(envoi('e9', 'envoye', 'pigeon')), '23514', 'modèle inconnu')
    assert.equal(await codeErreur(db.query(`insert into public.envois (id, commerce_id, client_id, modele, canal, statut, jour, date, donnees) values ('e10', 'c7', 'k1', 'inactif', 'sms', 'refuse', '2026-11-10', now(), '{"id":"autre","commerceId":"c7"}')`)), '23514')
    await db.query(`delete from public.commerces where id = 'c7'`)
    assert.equal((await db.query<{ n: number }>(`select count(*)::int as n from public.envois`)).rows[0].n, 0, 'suppression en cascade')
    await db.exec(sql('0007_relances.down.sql'))
    await db.exec(sql('0007_relances.down.sql'))
    assert.equal((await db.query(`select 1 from pg_class where relnamespace = 'public'::regnamespace and relname = 'envois'`)).rows.length, 0)
    await db.exec(sql('0007_relances.sql'))
  })

  test('0008_mesure : rejouable ; RLS fermée à anon (table ET fonction) ; incrément atomique ; aucune colonne d’identité ; DOWN', async () => {
    await db.exec(sql('0008_mesure.sql'))
    await db.exec(sql('0008_mesure.sql'))
    const colonnes = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'evenements_jour' order by ordinal_position`)
    assert.deepEqual(colonnes.rows.map((r) => r.column_name), ['commerce_id', 'jour', 'type', 'n'], 'ni client, ni contact, ni IP, ni heure')
    const t = await db.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'evenements_jour'`)
    assert.deepEqual(t.rows.map((r) => r.relrowsecurity), [true])
    assert.equal((await db.query<{ n: number }>(`select count(*)::int as n from pg_policies where schemaname = 'public'`)).rows[0].n, 0)
    const fonction = 'public.incrementer_evenement(text, date, text)'
    for (const role of ['anon', 'authenticated', 'public']) {
      const { rows } = await db.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fonction])
      assert.equal(rows[0].ok, false, `${role} ne peut pas exécuter la fonction`)
    }
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await db.query<{ ok: boolean }>(`select has_table_privilege($1, 'public.evenements_jour', 'select') or has_table_privilege($1, 'public.evenements_jour', 'insert') as ok`, [role])
      assert.equal(rows[0].ok, false, role)
    }
    await db.query(`insert into public.commerces (id, donnees, pin_hash, pin_sel) values ('c8', '{"id":"c8"}', 'h', 's')`)
    await db.exec('set role service_role')
    try {
      const plus1 = (type: string, jour = '2026-11-10') => db.query(`select public.incrementer_evenement('c8', $1::date, $2)`, [jour, type])
      await Promise.all([plus1('scan'), plus1('scan'), plus1('scan'), plus1('tirage'), plus1('scan', '2026-11-11')])
      const { rows } = await db.query<{ jour: string; type: string; n: number }>(`select to_char(jour, 'YYYY-MM-DD') as jour, type, n from public.evenements_jour where commerce_id = 'c8' order by jour, type`)
      assert.deepEqual(rows, [
        { jour: '2026-11-10', type: 'scan', n: 3 },
        { jour: '2026-11-10', type: 'tirage', n: 1 },
        { jour: '2026-11-11', type: 'scan', n: 1 },
      ])
      assert.equal(await codeErreur(plus1('pigeon')), '23514', 'type inconnu refusé')
      assert.equal(await codeErreur(db.query(`select public.incrementer_evenement('inconnu', '2026-11-10'::date, 'scan')`)), '23503', 'commerce inconnu refusé')
    } finally {
      await db.exec('reset role')
    }
    await db.exec('set role anon')
    try {
      assert.equal(await codeErreur(db.query(`select public.incrementer_evenement('c8', '2026-11-10'::date, 'scan')`)), '42501', 'anon : exécution refusée')
    } finally {
      await db.exec('reset role')
    }
    await db.query(`delete from public.commerces where id = 'c8'`)
    assert.equal((await db.query<{ n: number }>(`select count(*)::int as n from public.evenements_jour`)).rows[0].n, 0, 'suppression en cascade')
    await db.exec(sql('0008_mesure.down.sql'))
    await db.exec(sql('0008_mesure.down.sql'))
    assert.equal((await db.query(`select 1 from pg_class where relnamespace = 'public'::regnamespace and relname = 'evenements_jour'`)).rows.length, 0)
    assert.equal((await db.query(`select 1 from pg_proc where proname = 'incrementer_evenement'`)).rows.length, 0)
    await db.exec(sql('0008_mesure.sql'))
  })

  test('0010_compteurs_publics : rejouable ; RLS fermée à anon ; upsert + purge ; aucune colonne d’identité ; DOWN', async () => {
    await db.exec(sql('0010_compteurs_publics.sql'))
    await db.exec(sql('0010_compteurs_publics.sql'))
    const colonnes = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'compteurs_publics' order by ordinal_position`)
    assert.deepEqual(colonnes.rows.map((r) => r.column_name), ['cle', 'debut', 'n'], 'ni nom, ni code gagnant, ni contenu client — la clé seule (identifiant déjà utilisé par l’anti-bruteforce)')
    const t = await db.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'compteurs_publics'`)
    assert.deepEqual(t.rows.map((r) => r.relrowsecurity), [true])
    assert.equal((await db.query<{ n: number }>(`select count(*)::int as n from pg_policies where schemaname = 'public'`)).rows[0].n, 0)
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await db.query<{ ok: boolean }>(`select has_table_privilege($1, 'public.compteurs_publics', 'select') or has_table_privilege($1, 'public.compteurs_publics', 'insert') as ok`, [role])
      assert.equal(rows[0].ok, false, role)
    }
    const { rows } = await db.query<{ ok: boolean }>(`select has_table_privilege('service_role', 'public.compteurs_publics', 'delete') as ok`)
    assert.equal(rows[0].ok, true)
    // Upsert sur la clé (comme enregistrerCompteurPublic), puis purge des fenêtres passées.
    const ecrire = (cle: string, debut: string, n: number) =>
      db.query(`insert into public.compteurs_publics (cle, debut, n) values ($1, $2, $3) on conflict (cle) do update set debut = excluded.debut, n = excluded.n`, [cle, debut, n])
    await ecrire('carte:cl-1', '2026-11-11T10:00:00Z', 15)
    await ecrire('carte:cl-1', '2026-11-11T10:00:00Z', 16)
    await ecrire('lecture:203.0.113.7', '2026-11-11T09:00:00Z', 60)
    assert.equal((await db.query<{ n: number }>(`select count(*)::int as n from public.compteurs_publics`)).rows[0].n, 2, 'upsert : une seule ligne par clé')
    assert.equal((await db.query<{ n: number }>(`select n from public.compteurs_publics where cle = 'carte:cl-1'`)).rows[0].n, 16)
    assert.equal(await codeErreur(ecrire('carte:cl-2', '2026-11-11T10:00:00Z', -1)), '23514', 'n négatif refusé')
    await db.query(`delete from public.compteurs_publics where debut < '2026-11-11T10:00:00Z'`)
    assert.equal((await db.query<{ n: number }>(`select count(*)::int as n from public.compteurs_publics`)).rows[0].n, 1, 'fenêtre passée purgée')
    await db.exec(sql('0010_compteurs_publics.down.sql'))
    await db.exec(sql('0010_compteurs_publics.down.sql'))
    assert.equal((await db.query(`select 1 from pg_class where relnamespace = 'public'::regnamespace and relname = 'compteurs_publics'`)).rows.length, 0)
    await db.exec(sql('0010_compteurs_publics.sql'))
  })

  test('suppression d’un commerce : clients et tirages supprimés en cascade', async () => {
    await db.query(`delete from public.commerces where id = 'c1'`)
    const { rows } = await db.query<{ n: number }>(
      `select (select count(*) from public.clients where commerce_id = 'c1') + (select count(*) from public.tirages where commerce_id = 'c1') as n`)
    assert.equal(Number(rows[0].n), 0)
  })
})

// Correctif 09/11/2026 — la 0003 a échoué en production avec « function public.incrementer_version()
// does not exist » (42883) : la base live n'avait jamais reçu l'intégralité de la 0001 (fonction et
// triggers de version absents — 1re exécution d'un ancien schéma, puis ajout manuel de `ordre`).
// La 0003 corrigée doit donc passer SEULE sur une base qui a les tables (avec `donnees`) mais sans
// la fonction ni les triggers de version, et y recréer les deux.
describe('Migration 0003 autonome sur une base « live » (tables sans fonction ni triggers)', () => {
  let db: PGlite

  before(async () => {
    db = new PGlite()
    await db.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;')
    // 0001 SANS sa section « version » : tables + index + contraintes, mais ni incrementer_version()
    // ni les triggers commerces_version / clients_version / avis_version — l'état de la base live.
    const sql0001SansVersion = sql('0001_schema_initial.sql').split('-- ---------- version')[0]
    assert.ok(!sql0001SansVersion.includes('incrementer_version'), 'la 0001 tronquée ne doit pas définir la fonction')
    await db.exec(sql0001SansVersion)
    await db.exec(sql('0002_rls.sql'))
    await db.exec(`insert into public.commerces (id, donnees, pin_hash, pin_sel) values ('c1', '{"id":"c1"}', 'h', 's');
      insert into public.clients (id, commerce_id, cle_contact, donnees) values ('k1', 'c1', '0612345678', '{"id":"k1","commerceId":"c1"}');
      insert into public.avis (id, commerce_id, date, donnees) values ('a1', 'c1', now(), '{"id":"a1"}');`)
  })
  after(() => db.close())

  test('avant 0003 : la fonction et les triggers de version sont bien absents (état live reproduit)', async () => {
    const f = await db.query<{ n: number }>(`select count(*)::int as n from pg_proc where proname = 'incrementer_version'`)
    assert.equal(f.rows[0].n, 0)
    const t = await db.query<{ n: number }>(`select count(*)::int as n from pg_trigger where tgname in ('commerces_version', 'clients_version', 'avis_version') and not tgisinternal`)
    assert.equal(t.rows[0].n, 0)
  })

  test('0003 corrigée passe seule, rejouable, et recrée fonction + triggers sur les 5 tables versionnées', async () => {
    await db.exec(sql('0003_cartiz.sql'))
    await db.exec(sql('0003_cartiz.sql'))
    const f = await db.query<{ n: number }>(`select count(*)::int as n from pg_proc where proname = 'incrementer_version' and pronamespace = 'public'::regnamespace`)
    assert.equal(f.rows[0].n, 1)
    const triggers = await db.query<{ tgname: string }>(
      `select tgname from pg_trigger where tgname in ('commerces_version', 'clients_version', 'avis_version', 'equipe_version', 'menus_version') and not tgisinternal order by 1`)
    assert.deepEqual(triggers.rows.map((r) => r.tgname), ['avis_version', 'clients_version', 'commerces_version', 'equipe_version', 'menus_version'])
    const t = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname in ('equipe', 'journal', 'menus') order by 1`)
    assert.deepEqual(t.rows.map((r) => [r.relname, r.relrowsecurity]), [['equipe', true], ['journal', true], ['menus', true]])
  })

  test('les triggers recréés incrémentent bien `version` sur commerces, clients et avis', async () => {
    for (const [table, id] of [['commerces', 'c1'], ['clients', 'k1'], ['avis', 'a1']] as const) {
      const lire = async () => (await db.query<{ version: number }>(`select version from public.${table} where id = $1`, [id])).rows[0].version
      const v = await lire()
      await db.query(`update public.${table} set donnees = donnees where id = $1`, [id])
      assert.equal(await lire(), v + 1, `${table} : version +1`)
      // Verrou optimiste : UPDATE conditionné à l'ancienne version ne touche plus rien.
      const r = await db.query(`update public.${table} set donnees = donnees where id = $1 and version = $2`, [id, v])
      assert.equal(r.affectedRows, 0, `${table} : version périmée → 0 ligne`)
    }
  })
})

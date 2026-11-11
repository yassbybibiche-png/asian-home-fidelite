// P0-S5 : sauvegarde complète (14 tables) et restauration testée sur un vrai Postgres local (PGlite), sans Supabase
// ni réseau. Le CLI de sauvegarde est lancé contre un faux PostgREST local (plafond de 1 000 lignes par réponse,
// comme Supabase) ; le CLI de restauration recharge le fichier produit dans une PGlite en mémoire.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { PGlite } from '@electric-sql/pglite'
import {
  PREFIXE_CHIFFRE, SQL_ROLES_SUPABASE, TABLES_SAUVEGARDE, chiffrerSauvegarde, dechiffrerSauvegarde, ecrireTableSql,
  exporterSauvegarde, lireTableSql, migrationsARejouer, purgerAnciennesSauvegardes, restaurerSauvegarde,
  validerSauvegarde, type Ligne, type Sauvegarde,
} from '../server/sauvegarde.ts'
import { ErreurMigrationManquante } from '../server/stockage.ts'

const RACINE = join(import.meta.dirname, '..')
const MIGRATIONS = join(RACINE, 'supabase', 'migrations')
const CLE = 'a1'.repeat(32) // clé de test (64 hex), jamais une vraie clé
const AUTRE_CLE = 'b2'.repeat(32)
const CLE_SERVICE = 'cle-service-de-test-ne-doit-jamais-apparaitre'

/** PGlite avec les rôles Supabase et les migrations 0001… (sans les .down.sql), éventuellement tronquées. */
async function baseVide(jusqua = '9999'): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(SQL_ROLES_SUPABASE)
  for (const f of migrationsARejouer(readdirSync(MIGRATIONS))) if (f.slice(0, 4) <= jusqua) await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'))
  return db
}

const requete = (db: PGlite) => (sql: string, params?: unknown[]) => db.query(sql, params)

const CLIENT = { id: 'k1', commerceId: 'c1', prenom: 'Léa', telephone: '0612345678', tampons: 3, historique: [{ date: '2026-11-09T10:00:00.000Z', type: 'visite' }], consentementRelance: true }
const TIRAGE = { id: 't1', clientId: 'k1', commerceId: 'c1', date: '2026-11-09T10:05:00.000Z', lot: 'Nem offert', code: 'AB12', remis: null }
const AVIS = { id: 'a1', commerceId: 'c1', note: 5, texte: 'Très bon « bœuf » 🍜', date: '2026-11-09T12:00:00.000Z' }

/** Au moins une ligne dans chacune des 14 tables (colonnes obligatoires d'après les migrations). */
async function remplir(db: PGlite) {
  const j = JSON.stringify
  await db.query(`insert into public.meta (cle, valeur) values ('initialise', '1'), ('secret_desinscription', 'xyz')`)
  await db.query(`insert into public.commerces (id, donnees, pin_hash, pin_sel) values ('c1', $1, 'hash-pin', 'sel-pin'), ('c2', $2, 'h2', 's2')`,
    [j({ id: 'c1', nom: 'Asian Home Test', lots: [{ libelle: 'Nem offert', poids: 3 }] }), j({ id: 'c2', nom: 'Autre' })])
  await db.query(`insert into public.clients (id, commerce_id, cle_contact, donnees) values ('k1', 'c1', '0612345678', $1), ('k2', 'c1', 'k2@exemple.fr', $2)`,
    [j(CLIENT), j({ id: 'k2', commerceId: 'c1', prenom: 'Tom' })])
  await db.query(`update public.clients set donnees = donnees where id = 'k1'`) // version 2 : doit être conservée telle quelle
  await db.query(`insert into public.tirages (id, commerce_id, client_id, date, donnees) values ('t1', 'c1', 'k1', '2026-11-09T10:05:00Z', $1)`, [j(TIRAGE)])
  await db.query(`insert into public.avis (id, commerce_id, date, donnees) values ('a1', 'c1', '2026-11-09T12:00:00Z', $1)`, [j(AVIS)])
  await db.query(`insert into public.equipe (id, commerce_id, donnees, code_hash, code_sel) values ('e1', 'c1', $1, 'hash-code', 'sel-code')`,
    [j({ id: 'e1', commerceId: 'c1', nom: 'Sam' })])
  await db.query(`insert into public.journal (id, commerce_id, date, donnees) values ('j1', 'c1', '2026-11-09T10:00:00Z', $1)`,
    [j({ id: 'j1', commerceId: 'c1', action: 'visite' })])
  await db.query(`insert into public.menus (commerce_id, donnees) values ('c1', $1)`, [j({ commerceId: 'c1', categories: [{ nom: 'Entrées', produits: [] }] })])
  await db.query(`insert into public.parrainages (id, commerce_id, parrain_id, filleul_id, date, donnees) values ('p1', 'c1', 'k1', 'k2', '2026-11-09T11:00:00Z', $1)`,
    [j({ id: 'p1', commerceId: 'c1', parrainId: 'k1', filleulId: 'k2' })])
  await db.query(`insert into public.demandes_rattrapage (id, commerce_id, client_id, date, donnees) values ('r1', 'c1', 'k1', '2026-11-08T19:00:00Z', $1)`,
    [j({ id: 'r1', statut: 'enAttente', montantCentimes: 2350 })])
  await db.query(`insert into public.sessions_revoquees (jti, expire_le) values ('jti-1', '2026-11-12T08:00:00Z')`)
  await db.query(`insert into public.tentatives_auth (cle, portee, echecs, bloque_jusqu_a, derniere_tentative) values
    ('ip:203.0.113.5', 'commerce', 3, '2026-11-11T10:15:00Z', '2026-11-11T10:00:00Z'), ('cible:admin', 'admin', 1, null, '2026-11-11T09:00:00Z')`)
  await db.query(`insert into public.envois (id, commerce_id, client_id, modele, canal, statut, jour, date, donnees) values
    ('v1', 'c1', 'k1', 'bienvenue', 'sms', 'envoye', '2026-11-09', '2026-11-09T10:01:00Z', $1)`, [j({ id: 'v1', commerceId: 'c1', modele: 'bienvenue' })])
  await db.query(`insert into public.evenements_jour (commerce_id, jour, type, n) values ('c1', '2026-11-09', 'scan', 7), ('c1', '2026-11-09', 'tirage', 1)`)
}

async function compter(db: PGlite): Promise<Record<string, number>> {
  const r: Record<string, number> = {}
  for (const { nom } of TABLES_SAUVEGARDE) r[nom] = (await db.query<{ n: number }>(`select count(*)::int as n from public.${nom}`)).rows[0].n
  return r
}

describe('P0-S5 : export complet puis restauration sur Postgres (PGlite)', () => {
  let source: PGlite
  let cible: PGlite
  let sauvegarde: Sauvegarde

  before(async () => {
    source = await baseVide()
    await remplir(source)
    sauvegarde = await exporterSauvegarde(lireTableSql(requete(source)), () => new Date('2026-11-11T03:00:00Z'))
    cible = await baseVide()
  })
  after(async () => {
    await source.close()
    await cible.close()
  })

  test('les 14 tables sauvegardées = exactement les tables créées par les migrations, dans l’ordre demandé', async () => {
    assert.deepEqual(TABLES_SAUVEGARDE.map((t) => t.nom), ['meta', 'commerces', 'clients', 'tirages', 'avis', 'equipe', 'journal',
      'menus', 'parrainages', 'demandes_rattrapage', 'sessions_revoquees', 'tentatives_auth', 'envois', 'evenements_jour'])
    const { rows } = await source.query<{ relname: string }>(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)
    assert.deepEqual(rows.map((r) => r.relname), TABLES_SAUVEGARDE.map((t) => t.nom).sort())
    assert.deepEqual(migrationsARejouer(readdirSync(MIGRATIONS)).map((f) => f.slice(0, 4)), ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008'])
  })

  test('format de l’export : en-tête, 14 tables, compteurs = lignes, toutes les colonnes (hash des PIN inclus)', () => {
    assert.equal(sauvegarde.format, 'asian-home-sauvegarde')
    assert.equal(sauvegarde.version, 1)
    assert.equal(sauvegarde.creeLe, '2026-11-11T03:00:00.000Z')
    assert.equal(Object.keys(sauvegarde.tables).length, 14)
    for (const { nom } of TABLES_SAUVEGARDE) {
      assert.ok(sauvegarde.tables[nom].length >= 1, nom)
      assert.equal(sauvegarde.compteurs[nom], sauvegarde.tables[nom].length, nom)
    }
    const c1 = sauvegarde.tables.commerces.find((c) => c.id === 'c1')!
    assert.deepEqual(Object.keys(c1).sort(), ['donnees', 'id', 'ordre', 'pin_hash', 'pin_sel', 'version'])
    assert.equal(sauvegarde.tables.equipe[0].code_hash, 'hash-code')
    assert.deepEqual(validerSauvegarde(JSON.parse(JSON.stringify(sauvegarde))), { manquantes: [] })
  })

  test('restauration dans une 2e PGlite vide : compteurs identiques, client / tirage / avis exacts, colonnes conservées', async () => {
    const ecrits = await cible.transaction((tx) => restaurerSauvegarde(JSON.parse(JSON.stringify(sauvegarde)), ecrireTableSql((s, p) => tx.query(s, p))))
    assert.deepEqual(ecrits, sauvegarde.compteurs)
    assert.deepEqual(await compter(cible), await compter(source))
    assert.equal(Object.values(ecrits).reduce((a, b) => a + b, 0), Object.values(sauvegarde.compteurs).reduce((a, b) => a + b, 0))

    const donnees = async (table: string, id: string) =>
      (await cible.query<{ donnees: unknown }>(`select donnees from public.${table} where id = $1`, [id])).rows[0]?.donnees
    assert.deepEqual(await donnees('clients', 'k1'), CLIENT)
    assert.deepEqual(await donnees('tirages', 't1'), TIRAGE)
    assert.deepEqual(await donnees('avis', 'a1'), AVIS)

    // Toutes les lignes, toutes les colonnes : relecture complète identique à l'export (dates, version, ordre, hash…).
    for (const { nom } of TABLES_SAUVEGARDE) assert.deepEqual(await lireTableSql(requete(cible))(nom), sauvegarde.tables[nom], nom)
    const k1 = (await cible.query<{ version: number; date: Date }>(`select c.version, t.date from public.clients c join public.tirages t on t.client_id = c.id where c.id = 'k1'`)).rows[0]
    assert.equal(k1.version, 2)
    assert.equal(k1.date.toISOString(), '2026-11-09T10:05:00.000Z')
  })

  test('après restauration, la base fonctionne : nouvelle inscription après les anciennes, 1 tirage/jour toujours garanti', async () => {
    const max = (await cible.query<{ m: number }>('select max(ordre)::int as m from public.clients')).rows[0].m
    await cible.query(`insert into public.clients (id, commerce_id, cle_contact, donnees) values ('k3', 'c1', '0700000000', '{"id":"k3","commerceId":"c1"}')`)
    const k3 = (await cible.query<{ o: number }>(`select ordre::int as o from public.clients where id = 'k3'`)).rows[0].o
    assert.ok(k3 > max, `ordre ${k3} > ${max}`)
    await assert.rejects(cible.query(`insert into public.tirages (id, commerce_id, client_id, date, donnees) values ('t2', 'c1', 'k1', '2026-11-09T18:00:00Z', '{"id":"t2","clientId":"k1"}')`),
      (e: { code?: string }) => e.code === '23505')
  })

  test('restaurer deux fois la même sauvegarde (upsert sur la clé de conflit) ne duplique rien', async () => {
    const avant = await compter(cible)
    await cible.transaction((tx) => restaurerSauvegarde(sauvegarde, ecrireTableSql((s, p) => tx.query(s, p))))
    assert.deepEqual(await compter(cible), avant)
  })
})

describe('P0-S5 : jamais de sauvegarde ni de restauration incomplète', () => {
  test('export avec une table absente (migration 0008 non appliquée) → erreur nommant la table', async () => {
    const db = await baseVide('0007')
    try {
      await assert.rejects(exporterSauvegarde(lireTableSql(requete(db))), /table « evenements_jour » absente/)
    } finally {
      await db.close()
    }
  })

  test('export : lecteur qui lève ErreurMigrationManquante ou « table inconnue » → erreur nommant la table', async () => {
    await assert.rejects(exporterSauvegarde(async (t) => {
      if (t === 'envois') throw new ErreurMigrationManquante('envois', '0007_relances.sql')
      return []
    }), /table « envois » absente/)
    await assert.rejects(exporterSauvegarde(async (t) => {
      if (t === 'menus') throw new Error('table inconnue « menus »')
      return []
    }), /table « menus » absente/)
    // Autre erreur de lecture : l'export échoue aussi, en nommant la table.
    await assert.rejects(exporterSauvegarde(async (t) => {
      if (t === 'clients') throw new Error('réseau coupé')
      return []
    }), /« clients » impossible : réseau coupé/)
  })

  test('restauration d’un export sans une table → erreur listant les tables manquantes, rien n’est écrit', async () => {
    const tables = Object.fromEntries(TABLES_SAUVEGARDE.map((t) => [t.nom, [] as Ligne[]]))
    delete tables.tirages
    ;(tables as Record<string, unknown>).avis = 'pas un tableau'
    const incomplete = { format: 'asian-home-sauvegarde', version: 1, creeLe: '2026-11-11T00:00:00Z', tables, compteurs: {} }
    assert.deepEqual(validerSauvegarde(incomplete), { manquantes: ['tirages', 'avis'] })
    let ecritures = 0
    await assert.rejects(restaurerSauvegarde(incomplete, async () => ++ecritures), /table\(s\) manquante\(s\) : tirages, avis/)
    assert.equal(ecritures, 0)
  })

  test('format ou version inconnus → refus explicite', () => {
    assert.throws(() => validerSauvegarde(null), /illisible/)
    assert.throws(() => validerSauvegarde({ format: 'autre', version: 1, tables: {} }), /format de sauvegarde inconnu/)
    assert.throws(() => validerSauvegarde({ format: 'asian-home-sauvegarde', version: 2, tables: {} }), /version de sauvegarde 2/)
  })
})

describe('P0-S5 : chiffrement AES-256-GCM', () => {
  const texte = JSON.stringify({ format: 'asian-home-sauvegarde', client: 'Léa — 06 12 34 56 78 🍜' })

  test('aller-retour : déchiffrer(chiffrer(x)) = x ; deux chiffrements du même texte diffèrent (sel et IV aléatoires)', () => {
    const a = chiffrerSauvegarde(texte, CLE)
    const b = chiffrerSauvegarde(texte, CLE)
    assert.ok(a.startsWith(PREFIXE_CHIFFRE))
    assert.notEqual(a, b)
    assert.ok(!a.includes('Léa') && !a.includes(CLE))
    assert.equal(dechiffrerSauvegarde(a, CLE), texte)
    assert.equal(dechiffrerSauvegarde(b, CLE.toUpperCase()), texte)
  })

  test('mauvaise clé ou fichier altéré → erreur', () => {
    const c = chiffrerSauvegarde(texte, CLE)
    assert.throws(() => dechiffrerSauvegarde(c, AUTRE_CLE), /mauvaise clé ou fichier altéré/)
    const brut = Buffer.from(c.slice(PREFIXE_CHIFFRE.length), 'base64')
    brut[brut.length - 1] ^= 1
    assert.throws(() => dechiffrerSauvegarde(PREFIXE_CHIFFRE + brut.toString('base64'), CLE), /mauvaise clé ou fichier altéré/)
    assert.throws(() => dechiffrerSauvegarde(texte, CLE), /pas une sauvegarde chiffrée/)
  })

  test('clé invalide (longueur, caractères) → erreur explicite, sans la clé dans le message', () => {
    for (const cle of ['', 'a1'.repeat(16), 'a1'.repeat(33), 'z'.repeat(64)]) {
      assert.throws(() => chiffrerSauvegarde(texte, cle), (e: Error) => /64 caractères hexadécimaux/.test(e.message) && (!cle || !e.message.includes(cle)))
    }
    assert.throws(() => dechiffrerSauvegarde(chiffrerSauvegarde(texte, CLE), 'abc'), /64 caractères hexadécimaux/)
  })
})

describe('P0-S5 : rétention', () => {
  const JOUR = 24 * 60 * 60 * 1000
  const maintenant = Date.UTC(2026, 10, 11, 3)
  const fichier = (jours: number) => ({ nom: `f-${jours}`, dateMs: maintenant - jours * JOUR })

  test('défauts 30 jours / 30 fichiers : 45 sauvegardes quotidiennes (0 à 44 j) → les 14 de plus de 30 j supprimées', () => {
    const fichiers = Array.from({ length: 45 }, (_, i) => fichier(i)) // 0 à 44 jours
    const supprimes = purgerAnciennesSauvegardes(fichiers, undefined, undefined, maintenant)
    assert.deepEqual(supprimes.sort(), Array.from({ length: 14 }, (_, i) => `f-${i + 31}`).sort())
    assert.ok(!supprimes.includes('f-30'), 'exactement 30 jours : gardé')
  })

  test('un fichier est gardé s’il satisfait l’un des deux critères', () => {
    // Peu de fichiers mais très vieux : gardés (dans les 30 plus récents).
    assert.deepEqual(purgerAnciennesSauvegardes([fichier(400), fichier(200)], 30, 30, maintenant), [])
    // Beaucoup de fichiers récents : gardés (moins de 30 jours), même au-delà du nombre.
    assert.deepEqual(purgerAnciennesSauvegardes(Array.from({ length: 50 }, (_, i) => fichier(i / 10)), 30, 30, maintenant), [])
    // Limite exacte en jours : gardé ; 1 ms de plus : supprimé (au-delà du nombre).
    const limite = { nom: 'limite', dateMs: maintenant - 30 * JOUR }
    const juste = { nom: 'juste-apres', dateMs: maintenant - 30 * JOUR - 1 }
    assert.deepEqual(purgerAnciennesSauvegardes([fichier(0), limite, juste], 30, 1, maintenant), ['juste-apres'])
    // Ordre d'entrée indifférent : ce sont les plus RÉCENTS qui comptent pour le nombre.
    assert.deepEqual(purgerAnciennesSauvegardes([fichier(90), fichier(60), fichier(120)], 1, 2, maintenant), ['f-120'])
  })
})

// ---------- CLI ----------

type Sortie = { code: number; stdout: string; stderr: string }

/** Lance un script avec un environnement MINIMAL (aucune variable héritée hormis PATH / HOME). Asynchrone : le faux serveur tourne pendant ce temps. */
function lancer(script: string, args: string[], env: Record<string, string> = {}): Promise<Sortie> {
  return new Promise((ok) => {
    execFile(process.execPath, [join(RACINE, 'scripts', script), ...args], {
      cwd: RACINE, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env }, timeout: 60_000,
    }, (err, stdout, stderr) => ok({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr }))
  })
}

describe('P0-S5 : CLI sauvegarde-base.mjs / restaurer-base.mjs', () => {
  let tables: Record<string, Ligne[]>
  let serveur: Server
  let url = ''
  let absente: string | undefined
  /** Plafond de lignes par réponse du faux PostgREST (1 000 comme Supabase ; modifiable par test pour simuler un plafond plus bas). */
  let plafond = 1000
  const requetes: string[] = []
  const dossiers: string[] = []
  const dossier = () => {
    const d = mkdtempSync(join(tmpdir(), 'p0-s5-'))
    dossiers.push(d)
    return d
  }

  before(async () => {
    const db = await baseVide()
    await remplir(db)
    // > 1 000 lignes dans une table : la pagination doit tout récupérer malgré le plafond PostgREST.
    for (let i = 0; i < 1500; i += 500) {
      await db.query(`insert into public.journal (id, commerce_id, date, donnees)
        select 'jx' || g, 'c1', '2026-11-10T08:00:00Z', jsonb_build_object('id', 'jx' || g, 'commerceId', 'c1') from generate_series($1::int, $2::int) g`, [i, i + 499])
    }
    tables = (await exporterSauvegarde(lireTableSql(requete(db)))).tables
    await db.close()

    // Faux PostgREST : GET /rest/v1/<table>?offset=&limit=, au plus 1 000 lignes par réponse ; table absente → 404 PGRST205.
    serveur = createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://x')
      requetes.push(`${req.method} ${u.pathname}${u.search} auth=${req.headers.apikey === CLE_SERVICE}`)
      const table = u.pathname.replace('/rest/v1/', '')
      res.setHeader('content-type', 'application/json')
      if (!tables[table] || table === absente) {
        res.statusCode = 404
        res.end(JSON.stringify({ code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` }))
        return
      }
      const offset = Number(u.searchParams.get('offset') ?? 0)
      const tranche = tables[table].slice(offset, offset + Math.min(Number(u.searchParams.get('limit') ?? 1000), plafond))
      // Compteur exact (PostgREST : en-tête Content-Range) — le script le vérifie à chaque page.
      res.setHeader('content-range', tranche.length ? `${offset}-${offset + tranche.length - 1}/${tables[table].length}` : `*/${tables[table].length}`)
      res.end(JSON.stringify(tranche))
    })
    await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok))
    url = `http://127.0.0.1:${(serveur.address() as { port: number }).port}`
  })
  after(() => {
    serveur.close()
    for (const d of dossiers) rmSync(d, { recursive: true, force: true })
  })

  const envSupabase = () => ({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: CLE_SERVICE })
  const sansSecret = (s: Sortie) => {
    for (const secret of [CLE_SERVICE, CLE, CLE_SERVICE.slice(0, 8)]) assert.ok(!(s.stdout + s.stderr).includes(secret), 'secret affiché')
  }

  test('--aide / --help : usage, sortie 0, sans aucune variable d’environnement', async () => {
    assert.ok(existsSync(join(RACINE, 'scripts', 'sauvegarde-base.mjs')))
    for (const option of ['--aide', '--help']) {
      const s = await lancer('sauvegarde-base.mjs', [option])
      assert.equal(s.code, 0, s.stderr)
      assert.match(s.stdout, /Usage : node scripts\/sauvegarde-base\.mjs/)
      assert.match(s.stdout, /SAUVEGARDE_CLE_CHIFFREMENT/)
    }
    const r = await lancer('restaurer-base.mjs', ['--aide'])
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /--cible pglite/)
  })

  test('sans SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY : erreur explicite, sortie 1, aucun secret', async () => {
    const s = await lancer('sauvegarde-base.mjs', [])
    assert.equal(s.code, 1)
    assert.match(s.stderr, /^ERREUR SAUVEGARDE — variable\(s\) d'environnement manquante\(s\) : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY\./)
    const t = await lancer('sauvegarde-base.mjs', [], { SUPABASE_URL: 'https://x.supabase.co' })
    assert.match(t.stderr, /manquante\(s\) : SUPABASE_SERVICE_ROLE_KEY\./)
    const u = await lancer('sauvegarde-base.mjs', [], { ...envSupabase(), SAUVEGARDE_CLE_CHIFFREMENT: 'trop-courte' })
    assert.equal(u.code, 1)
    assert.match(u.stderr, /SAUVEGARDE_CLE_CHIFFREMENT invalide/)
    assert.ok(!u.stderr.includes('trop-courte'))
    sansSecret(u)
  })

  test('sauvegarde chiffrée de bout en bout (pagination > 1 000 lignes) puis restauration PGlite --verifier', async () => {
    const dir = dossier()
    requetes.length = 0
    const s = await lancer('sauvegarde-base.mjs', ['--dir', dir], { ...envSupabase(), SAUVEGARDE_CLE_CHIFFREMENT: CLE })
    assert.equal(s.code, 0, s.stderr)
    sansSecret(s)
    const fichiers = readdirSync(dir)
    assert.equal(fichiers.length, 1, 'un seul fichier, pas de .tmp')
    assert.match(fichiers[0], /^asian-home-\d{4}-\d{2}-\d{2}T\d{6}\.json\.gz$/)
    const total = Object.values(tables).reduce((a, l) => a + l.length, 0)
    assert.match(s.stdout, new RegExp(`^SAUVEGARDE OK — ${join(dir, fichiers[0]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — ${total} lignes \\(meta 2, commerces 2, clients 2, .*journal 1501,`))
    assert.ok(requetes.every((r) => r.endsWith('auth=true')))
    assert.ok(requetes.some((r) => r.startsWith('GET /rest/v1/journal') && r.includes('offset=1000')), 'page 2 du journal lue')

    const contenu = gunzipSync(readFileSync(join(dir, fichiers[0]))).toString('utf8')
    assert.ok(contenu.startsWith(PREFIXE_CHIFFRE), 'chiffré')
    assert.ok(!contenu.includes('0612345678') && !contenu.includes('hash-pin'), 'aucune donnée en clair')
    const relu = JSON.parse(dechiffrerSauvegarde(contenu, CLE)) as Sauvegarde
    assert.deepEqual(relu.tables, tables)

    const r = await lancer('restaurer-base.mjs', [join(dir, fichiers[0]), '--cible', 'pglite', '--verifier'], { SAUVEGARDE_CLE_CHIFFREMENT: CLE })
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, new RegExp(`RESTAURATION OK \\(PGlite en mémoire\\) — sauvegarde du ${relu.creeLe} — ${total} lignes`))
    assert.match(r.stdout, /journal\s+1501/)
    assert.match(r.stdout, /VÉRIFICATION OK/)
    sansSecret(r)

    // Sans la clé, ou avec une autre : refus explicite.
    const sansCle = await lancer('restaurer-base.mjs', [join(dir, fichiers[0]), '--cible', 'pglite'])
    assert.equal(sansCle.code, 1)
    assert.match(sansCle.stderr, /^ERREUR RESTAURATION — sauvegarde chiffrée : définissez SAUVEGARDE_CLE_CHIFFREMENT/)
    const mauvaise = await lancer('restaurer-base.mjs', [join(dir, fichiers[0]), '--cible', 'pglite'], { SAUVEGARDE_CLE_CHIFFREMENT: AUTRE_CLE })
    assert.equal(mauvaise.code, 1)
    assert.match(mauvaise.stderr, /mauvaise clé ou fichier altéré/)
  })

  test('sans clé : sauvegarde en clair + avertissement ; --sans-chiffrement force le clair même avec une clé', async () => {
    const dir = dossier()
    const s = await lancer('sauvegarde-base.mjs', [], { ...envSupabase(), SAUVEGARDE_DIR: dir })
    assert.equal(s.code, 0, s.stderr)
    assert.match(s.stderr, /AVERTISSEMENT — sauvegarde non chiffrée/)
    const [f] = readdirSync(dir)
    assert.equal(JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString('utf8')).format, 'asian-home-sauvegarde')

    const dir2 = dossier()
    const t = await lancer('sauvegarde-base.mjs', ['--dir', dir2, '--sans-chiffrement'], { ...envSupabase(), SAUVEGARDE_CLE_CHIFFREMENT: CLE })
    assert.equal(t.code, 0, t.stderr)
    assert.match(t.stderr, /AVERTISSEMENT — --sans-chiffrement : sauvegarde écrite EN CLAIR/)
    sansSecret(t)
    const [g] = readdirSync(dir2)
    assert.ok(gunzipSync(readFileSync(join(dir2, g))).toString('utf8').startsWith('{'))
  })

  test('table absente côté Supabase → ERREUR SAUVEGARDE nommant la table, sortie 1, aucun fichier', async () => {
    const dir = dossier()
    absente = 'tentatives_auth'
    try {
      const s = await lancer('sauvegarde-base.mjs', ['--dir', dir], envSupabase())
      assert.equal(s.code, 1)
      assert.match(s.stderr, /^ERREUR SAUVEGARDE — table « tentatives_auth » absente/)
      assert.doesNotMatch(s.stdout, /SAUVEGARDE OK/)
      assert.deepEqual(readdirSync(dir), [])
      sansSecret(s)
    } finally {
      absente = undefined
    }
  })

  test('plafond API inférieur à 1 000 → export refusé (compteur exact), aucun fichier (revue Codex P0-S5)', async () => {
    const dir = dossier()
    plafond = 500 // le journal a 1 501 lignes : la 1re page n'en rend que 500, le compteur dit 1 501
    try {
      const s = await lancer('sauvegarde-base.mjs', ['--dir', dir], envSupabase())
      assert.equal(s.code, 1)
      assert.match(s.stderr, /table « journal » : 500 lignes lues pour 1501 comptées/)
      assert.doesNotMatch(s.stdout, /SAUVEGARDE OK/)
      assert.deepEqual(readdirSync(dir), [])
      sansSecret(s)
    } finally {
      plafond = 1000
    }
  })

  test('restauration : cible déjà initialisée refusée avant toute modification, données intactes (revue Codex P0-S5)', async () => {
    const dir = dossier()
    const sauvegardeDir = dossier()
    const s = await lancer('sauvegarde-base.mjs', ['--dir', sauvegardeDir], envSupabase())
    assert.equal(s.code, 0, s.stderr)
    const [f] = readdirSync(sauvegardeDir)
    const cible = join(dir, 'pglite')
    const ok = await lancer('restaurer-base.mjs', [join(sauvegardeDir, f), '--cible', 'pglite', '--fichier', cible])
    assert.equal(ok.code, 0, ok.stderr)
    const refuse = await lancer('restaurer-base.mjs', [join(sauvegardeDir, f), '--cible', 'pglite', '--fichier', cible])
    assert.equal(refuse.code, 1)
    assert.match(refuse.stderr, /cible est déjà initialisée/)
    // La 2e tentative n'a rien modifié : les lignes de la 1re restauration sont toujours là.
    const db = new PGlite(cible)
    try {
      assert.equal((await db.query<{ n: number }>('select count(*)::int as n from public.clients')).rows[0].n, 2)
      assert.equal((await db.query<{ n: number }>('select count(*)::int as n from public.journal')).rows[0].n, 1501)
    } finally {
      await db.close()
    }
  })

  test('--verifier en échec : transaction annulée, cible vide (revue Codex P0-S5)', async () => {
    const dir = dossier()
    const sauvegardeDir = dossier()
    const s = await lancer('sauvegarde-base.mjs', ['--dir', sauvegardeDir], envSupabase())
    assert.equal(s.code, 0, s.stderr)
    const [f] = readdirSync(sauvegardeDir)
    const faussee = JSON.parse(gunzipSync(readFileSync(join(sauvegardeDir, f))).toString('utf8')) as Sauvegarde
    faussee.compteurs.clients = 999 // compteur falsifié : la base restaurée ne peut pas l'égaler
    const chemin = join(dir, 'faussee.json.gz')
    writeFileSync(chemin, gzipSync(JSON.stringify(faussee)))
    const cible = join(dir, 'pglite')
    const r = await lancer('restaurer-base.mjs', [chemin, '--cible', 'pglite', '--fichier', cible, '--verifier'])
    assert.equal(r.code, 1)
    assert.match(r.stderr, /vérification échouée — clients : base 2, fichier 2, compteur 999/)
    // Échec DANS la transaction : le schéma existe (migrations rejouées) mais aucune ligne n'est validée.
    const db = new PGlite(cible)
    try {
      assert.equal((await db.query<{ n: number }>('select count(*)::int as n from public.clients')).rows[0].n, 0)
      assert.equal((await db.query<{ n: number }>('select count(*)::int as n from public.journal')).rows[0].n, 0)
    } finally {
      await db.close()
    }
  })

  test('rétention appliquée après la sauvegarde : seuls les vieux fichiers de sauvegarde sont supprimés', async () => {
    const dir = dossier()
    for (const n of ['asian-home-2020-01-01T030000.json.gz', 'asian-home-2020-01-02T030000.json.gz', 'notes.txt', 'asian-home-copie.json.gz']) {
      writeFileSync(join(dir, n), 'x')
    }
    const s = await lancer('sauvegarde-base.mjs', ['--dir', dir], { ...envSupabase(), SAUVEGARDE_RETENTION_NOMBRE: '2', SAUVEGARDE_RETENTION_JOURS: '30' })
    assert.equal(s.code, 0, s.stderr)
    assert.match(s.stdout, /Rétention — supprimé : asian-home-2020-01-01T030000\.json\.gz/)
    const restants = readdirSync(dir).sort()
    assert.equal(restants.length, 4)
    assert.ok(restants.includes('asian-home-2020-01-02T030000.json.gz'), 'gardé : dans les 2 plus récents')
    assert.ok(restants.includes('notes.txt') && restants.includes('asian-home-copie.json.gz'), 'fichiers étrangers jamais touchés')
  })

  test('restauration : cible Supabase / Postgres refusée sans afficher le DSN ; fichier incomplet refusé', async () => {
    const dir = dossier()
    const chemin = join(dir, 'incomplete.json.gz')
    const incomplete = { format: 'asian-home-sauvegarde', version: 1, creeLe: '2026-11-11T00:00:00Z', tables: { ...tables }, compteurs: {} }
    delete (incomplete.tables as Record<string, unknown>).clients
    writeFileSync(chemin, gzipSync(JSON.stringify(incomplete)))

    for (const cible of ['supabase', 'postgresql://postgres:motdepasse-secret@db.x.supabase.co:5432/postgres']) {
      const r = await lancer('restaurer-base.mjs', [chemin, '--cible', cible])
      assert.equal(r.code, 1)
      assert.match(r.stderr, /^ERREUR RESTAURATION — cible refusée .*docs\/SAUVEGARDE\.md/)
      assert.ok(!r.stderr.includes('motdepasse-secret'))
    }
    const r = await lancer('restaurer-base.mjs', [chemin, '--cible', 'pglite'])
    assert.equal(r.code, 1)
    assert.match(r.stderr, /table\(s\) manquante\(s\) : clients\./)
  })
})

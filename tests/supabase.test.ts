// Supabase S1 : couche de stockage Supabase testée SANS vrai projet Supabase (aucun compte n'existe).
// Le client officiel `@supabase/supabase-js` parle à un faux PostgREST en mémoire (transport `fetch` injecté) qui reproduit
// le contrat HTTP de PostgREST et les contraintes de `supabase/migrations/0001_schema_initial.sql` (vérifiées plus bas
// dans le fichier SQL lui-même). Ce n'est PAS un test contre Postgres : voir JOURNAL.md.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, hacherPinAncien, type OptionsServeur } from '../server/app.ts'
import { ErreurConflit } from '../server/stockage.ts'
import { configSupabaseDepuisEnv, ouvrirStockageSupabase } from '../server/stockage-supabase.ts'
import { nouveauCommerce } from '../src/data/defaults.ts'
import { cleContact, nouveauClient, offrirRecompense, validerVisite } from '../src/lib/fidelite.ts'
import type { Client, Commerce, Tirage } from '../src/types.ts'

const URL_SB = 'https://projet-factice.supabase.co'
const CLE = 'cle-service-role-factice' // pas une vraie clé
const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }

// ---------- Faux PostgREST (mémoire) ----------

type Ligne = Record<string, unknown>
type Unicite = { nom: string; cle: (l: Ligne) => string }

/** Jour calendaire à Paris, comme `((date at time zone 'Europe/Paris')::date)` dans l'index unique des tirages. */
const jourParis = (iso: unknown) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(String(iso)))

// Contraintes de 0001_schema_initial.sql (clés primaires, uniques, clés étrangères, colonnes `version` / `ordre`).
const SCHEMA: Record<string, { pk: string; uniques: Unicite[]; fk?: [string, string][]; ordre?: boolean; version?: boolean }> = {
  meta: { pk: 'cle', uniques: [] },
  commerces: { pk: 'id', uniques: [], ordre: true, version: true },
  clients: {
    pk: 'id',
    uniques: [{ nom: 'clients_commerce_contact_unique', cle: (l) => `${l.commerce_id}|${l.cle_contact}` }],
    fk: [['commerce_id', 'commerces']],
    ordre: true,
    version: true,
  },
  tirages: {
    pk: 'id',
    uniques: [{ nom: 'tirages_un_par_jour', cle: (l) => `${l.commerce_id}|${l.client_id}|${jourParis(l.date)}` }],
    fk: [['commerce_id', 'commerces'], ['client_id', 'clients']],
  },
  avis: { pk: 'id', uniques: [], fk: [['commerce_id', 'commerces']], version: true },
  // 0003_cartiz.sql
  equipe: { pk: 'id', uniques: [], fk: [['commerce_id', 'commerces']], ordre: true, version: true },
  journal: { pk: 'id', uniques: [], fk: [['commerce_id', 'commerces']] },
  menus: { pk: 'commerce_id', uniques: [], fk: [['commerce_id', 'commerces']], version: true },
  // 0004_programme.sql
  parrainages: { pk: 'id', uniques: [], fk: [['commerce_id', 'commerces']] },
  demandes_rattrapage: { pk: 'id', uniques: [], fk: [['commerce_id', 'commerces']] },
  // 0005_sessions_revoquees.sql
  sessions_revoquees: { pk: 'jti', uniques: [] },
  // 0006_tentatives_auth.sql
  tentatives_auth: { pk: 'cle', uniques: [] },
}

interface Requete {
  methode: string
  table: string
  params: URLSearchParams
  entetes: Headers
  corps: unknown
}

/** `sans0003` : base de production AVANT la migration 0003 (tables equipe / journal / menus absentes). `sans0004` à `sans0006` : idem pour 0004 à 0006. */
function fauxPostgrest({ sans0003 = false, sans0004 = false, sans0005 = false, sans0006 = false } = {}) {
  const absentes = new Set([
    ...(sans0003 ? ['equipe', 'journal', 'menus'] : []),
    ...(sans0004 ? ['parrainages', 'demandes_rattrapage'] : []),
    ...(sans0005 ? ['sessions_revoquees'] : []),
    ...(sans0006 ? ['tentatives_auth'] : []),
  ])
  const tables: Record<string, Ligne[]> = Object.fromEntries(Object.keys(SCHEMA).map((t) => [t, []]))
  const requetes: Requete[] = []
  const rejets: string[] = []
  let compteur = 0
  let panne = false
  let barriere: { methode: string; table: string; n: number; enAttente: (() => void)[] } | undefined

  const json = (statut: number, corps?: unknown) =>
    new Response(corps === undefined ? null : JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } })
  const erreur = (statut: number, code: string, message: string) => json(statut, { code, message, details: null, hint: null })

  function filtrer(table: string, params: URLSearchParams): Ligne[] {
    let lignes = tables[table]
    for (const [col, v] of params) {
      if (['select', 'order', 'on_conflict', 'limit'].includes(col)) continue
      if (v.startsWith('lt.')) {
        // Seul usage : dates (timestamptz) — nettoyage des sessions révoquées et des tentatives d'accès. NULL < x : faux.
        lignes = lignes.filter((l) => l[col] != null && Date.parse(String(l[col])) < Date.parse(v.slice(3)))
        continue
      }
      if (v === 'is.null') {
        lignes = lignes.filter((l) => l[col] == null)
        continue
      }
      if (!v.startsWith('eq.')) throw new Error(`Opérateur non géré par le faux PostgREST : ${col}=${v}`)
      lignes = lignes.filter((l) => String(l[col]) === v.slice(3))
    }
    const ordre = params.get('order')
    if (ordre) {
      const [col, sens] = ordre.split('.')
      const val = (l: Ligne) => (col === 'date' ? Date.parse(String(l[col])) : Number(l[col]))
      lignes = [...lignes].sort((a, b) => (val(a) - val(b)) * (sens === 'desc' ? -1 : 1))
    }
    const limite = params.get('limit')
    return limite ? lignes.slice(0, Number(limite)) : lignes
  }

  const projeter = (lignes: Ligne[], select: string | null) =>
    lignes.map((l) => (select && select !== '*' ? Object.fromEntries(select.split(',').map((c) => [c, structuredClone(l[c])])) : structuredClone(l)))

  /** Première contrainte violée par `l` (en ignorant la ligne `soi` lors d'un UPDATE), sinon undefined. */
  function violation(table: string, l: Ligne, soi?: Ligne): [number, string, string] | undefined {
    const s = SCHEMA[table]
    const autres = tables[table].filter((x) => x !== soi)
    if (autres.some((x) => x[s.pk] === l[s.pk])) return [409, '23505', `duplicate key value violates unique constraint "${table}_pkey"`]
    for (const u of s.uniques) if (autres.some((x) => u.cle(x) === u.cle(l))) return [409, '23505', `duplicate key value violates unique constraint "${u.nom}"`]
    for (const [col, cible] of s.fk ?? []) {
      if (!tables[cible].some((x) => x.id === l[col])) return [409, '23503', `insert or update on table "${table}" violates foreign key constraint`]
    }
    return undefined
  }

  async function traiter(methode: string, table: string, params: URLSearchParams, entetes: Headers, corps: unknown): Promise<Response> {
    if (entetes.get('apikey') !== CLE || entetes.get('authorization') !== `Bearer ${CLE}`) return erreur(401, 'PGRST301', 'clé absente')
    if (panne) return erreur(500, 'XX000', 'base indisponible') // (503 / 520 : supabase-js réessaie seul les lectures)
    if (!SCHEMA[table] || absentes.has(table)) return erreur(404, 'PGRST205', `Could not find the table 'public.${table}' in the schema cache`)
    const s = SCHEMA[table]
    const representation = (entetes.get('prefer') ?? '').includes('return=representation')

    if (methode === 'GET') return json(200, projeter(filtrer(table, params), params.get('select')))

    if (methode === 'POST') {
      const fusion = (entetes.get('prefer') ?? '').includes('resolution=merge-duplicates')
      const ignorer = (entetes.get('prefer') ?? '').includes('resolution=ignore-duplicates')
      for (const brute of Array.isArray(corps) ? corps : [corps]) {
        const l: Ligne = { ...structuredClone(brute as Ligne) }
        const existante = fusion || ignorer ? tables[table].find((x) => x[params.get('on_conflict') ?? s.pk] === l[params.get('on_conflict') ?? s.pk]) : undefined
        if (existante) {
          if (fusion) Object.assign(existante, l)
          continue
        }
        if (s.ordre) l.ordre = ++compteur
        if (s.version) l.version = 1
        const v = violation(table, l)
        if (v) {
          rejets.push(`${table}:${v[1]}`)
          return erreur(...v)
        }
        tables[table].push(l)
      }
      return new Response(null, { status: 201 })
    }

    if (methode === 'PATCH') {
      const cibles = filtrer(table, params)
      for (const l of cibles) {
        const apres = { ...l, ...structuredClone(corps as Ligne) }
        if (s.version) apres.version = Number(l.version) + 1 // trigger `incrementer_version`
        const v = violation(table, apres, l)
        if (v) {
          rejets.push(`${table}:${v[1]}`)
          return erreur(...v)
        }
        Object.assign(l, apres)
      }
      return representation ? json(200, projeter(cibles, params.get('select'))) : new Response(null, { status: 204 })
    }

    if (methode === 'DELETE') {
      const cibles = new Set(filtrer(table, params))
      tables[table] = tables[table].filter((l) => !cibles.has(l))
      return new Response(null, { status: 204 })
    }
    return erreur(405, 'PGRST000', 'méthode non gérée')
  }

  async function fauxFetch(entree: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(String(entree))
    assert.equal(url.origin, URL_SB)
    const [, rest, v1, table] = url.pathname.split('/')
    assert.equal(`${rest}/${v1}`, 'rest/v1', 'uniquement l’API REST (PostgREST), jamais de connexion Postgres directe')
    const methode = init?.method ?? 'GET'
    const entetes = new Headers(init?.headers)
    const corps = init?.body ? JSON.parse(String(init.body)) : undefined
    requetes.push({ methode, table, params: url.searchParams, entetes, corps })
    if (barriere && barriere.methode === methode && barriere.table === table) {
      // Retient les n premières requêtes visées puis les libère ensemble : simule deux requêtes vraiment simultanées.
      const b = barriere
      await new Promise<void>((ok) => {
        b.enAttente.push(ok)
        if (b.enAttente.length >= b.n) {
          barriere = undefined
          b.enAttente.forEach((f) => f())
        }
      })
    }
    return traiter(methode, table, url.searchParams, entetes, corps)
  }

  return {
    fetch: fauxFetch as typeof fetch,
    tables,
    requetes,
    rejets,
    panne: (v: boolean) => void (panne = v),
    barriere: (methode: string, table: string, n = 2) => void (barriere = { methode, table, n, enAttente: [] }),
  }
}

const ouvrir = (f: ReturnType<typeof fauxPostgrest>) => ouvrirStockageSupabase({ url: URL_SB, cleServiceRole: CLE, fetch: f.fetch })

// ---------- Schéma SQL ----------

const MIGRATIONS = join(import.meta.dirname, '..', 'supabase', 'migrations')
const sql = (nom: string) => readFileSync(join(MIGRATIONS, nom), 'utf8')
const sansCommentaires = (s: string) => s.replace(/--.*$/gm, '')

describe('Supabase : migration SQL et RLS', () => {
  test('tables, colonnes, contraintes et index attendus (ceux que reproduit le faux PostgREST)', () => {
    const s = sansCommentaires(sql('0001_schema_initial.sql'))
    for (const t of ['meta', 'commerces', 'clients', 'tirages', 'avis']) assert.match(s, new RegExp(`create table if not exists public\\.${t} \\(`))
    assert.match(s, /pin_hash text not null,\s+pin_sel\s+text not null/)
    for (const t of ['commerces', 'clients', 'tirages', 'avis']) assert.match(s, new RegExp(`public\\.${t} \\([\\s\\S]*?donnees\\s+jsonb not null`))
    assert.match(s, /constraint clients_commerce_contact_unique unique \(commerce_id, cle_contact\)/)
    assert.match(s, /create index if not exists tirages_client on public\.tirages \(commerce_id, client_id\)/)
    assert.match(s, /create index if not exists avis_commerce on public\.avis \(commerce_id, date desc\)/)
    assert.match(
      s,
      /create unique index if not exists tirages_un_par_jour\s+on public\.tirages \(commerce_id, client_id, \(\(date at time zone 'Europe\/Paris'\)::date\)\)/,
    )
    assert.match(s, /new\.version := old\.version \+ 1/)
    for (const t of ['commerces', 'clients', 'avis']) assert.match(s, new RegExp(`create trigger ${t}_version before update on public\\.${t}`))
  })

  test('rejouable : uniquement des IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS', () => {
    const s = sansCommentaires(sql('0001_schema_initial.sql') + sql('0002_rls.sql'))
    assert.doesNotMatch(s, /create table (?!if not exists)/i)
    assert.doesNotMatch(s, /create (unique )?index (?!if not exists)/i)
    assert.doesNotMatch(s, /create function/i)
    const declencheurs = s.match(/create trigger (\w+)/g) ?? []
    for (const d of declencheurs) assert.match(s, new RegExp(`drop trigger if exists ${d.split(' ')[2]}`))
  })

  test('RLS activée sur les 5 tables, aucune policy, anon / authenticated sans aucun droit', () => {
    const s = sansCommentaires(sql('0002_rls.sql'))
    for (const t of ['meta', 'commerces', 'clients', 'tirages', 'avis']) assert.match(s, new RegExp(`alter table public\\.${t}\\s+enable row level security`))
    assert.doesNotMatch(s + sansCommentaires(sql('0001_schema_initial.sql')), /create policy/i)
    assert.match(s, /revoke all on table public\.meta, public\.commerces, public\.clients, public\.tirages, public\.avis from anon, authenticated/)
    assert.doesNotMatch(s, /grant [^;]* to (anon|authenticated)/i)
  })
})

// ---------- Adaptateur : mapping des requêtes ----------

describe('Supabase : adaptateur de stockage (faux PostgREST)', () => {
  const commerce: Commerce = { ...nouveauCommerce('Chez Lin', 'restaurant', ''), id: 'c-chez-lin' }

  test('commerce + PIN : bonnes tables, colonnes et filtres ; le PIN reste hors de `donnees`', async () => {
    const f = fauxPostgrest()
    const st = ouvrir(f)
    assert.equal(st.type, 'supabase')
    await st.ajouterCommerce(commerce, { hash: 'h'.repeat(64), sel: 's'.repeat(32) })
    const ins = f.requetes.at(-1)!
    assert.equal(ins.methode, 'POST')
    assert.equal(ins.table, 'commerces')
    assert.deepEqual(ins.corps, { id: commerce.id, donnees: commerce, pin_hash: 'h'.repeat(64), pin_sel: 's'.repeat(32) })
    assert.equal(ins.entetes.get('apikey'), CLE)

    assert.deepEqual(await st.pin(commerce.id), { hash: 'h'.repeat(64), sel: 's'.repeat(32) })
    const lecture = f.requetes.at(-1)!
    assert.equal(lecture.params.get('select'), 'pin_hash,pin_sel')
    assert.equal(lecture.params.get('id'), `eq.${commerce.id}`)
    assert.deepEqual(await st.commerce(commerce.id), commerce)
    assert.equal(await st.commerce('inconnu'), undefined)
    assert.equal(await st.pin('inconnu'), undefined)
    assert.deepEqual(await st.commerces(), [commerce])
    assert.equal(f.requetes.at(-1)!.params.get('order'), 'ordre.asc')

    await st.majCommerce({ ...commerce, nom: 'Chez Lin 2' })
    const maj = f.requetes.at(-1)!
    assert.equal(maj.methode, 'PATCH')
    assert.equal(maj.params.get('id'), `eq.${commerce.id}`)
    assert.equal((await st.commerce(commerce.id))!.nom, 'Chez Lin 2')

    await st.majMeta('initialise', 'x')
    await st.majMeta('initialise', 'y')
    assert.equal(await st.meta('initialise'), 'y')
    assert.equal(f.requetes.at(-2)!.params.get('on_conflict'), 'cle')
    assert.equal(f.tables.meta.length, 1)
  })

  test('clients, tirages, avis : filtres commerce_id / client_id / cle_contact, tri par date décroissante', async () => {
    const f = fauxPostgrest()
    const st = ouvrir(f)
    await st.ajouterCommerce(commerce, { hash: 'h', sel: 's' })
    const lina = nouveauClient(commerce.id, 'Lina', { telephone: '06 12 34 56 78' })
    await st.ajouterClient(lina)
    assert.deepEqual(f.requetes.at(-1)!.corps, { id: lina.id, commerce_id: commerce.id, cle_contact: '0612345678', donnees: lina })

    assert.deepEqual(await st.clientParContact(commerce.id, { telephone: '+33 6 12 34 56 78' }), lina)
    const q = f.requetes.at(-1)!.params
    assert.equal(q.get('commerce_id'), `eq.${commerce.id}`)
    assert.equal(q.get('cle_contact'), 'eq.0612345678')
    assert.deepEqual(await st.client(commerce.id, lina.id), lina)
    assert.equal(await st.client('autre-commerce', lina.id), undefined, 'un client n’est lu que dans son commerce')
    assert.deepEqual(await st.clients(commerce.id), [lina])

    const t1: Tirage = { id: 'ti-1', commerceId: commerce.id, clientId: lina.id, lot: 'Nems', date: '2026-11-07T12:00:00.000Z', code: 'ABC234' }
    const t2: Tirage = { ...t1, id: 'ti-2', date: '2026-11-08T12:00:00.000Z' }
    await st.ajouterTirage(t1)
    assert.deepEqual(f.requetes.at(-1)!.corps, { id: 'ti-1', commerce_id: commerce.id, client_id: lina.id, date: t1.date, donnees: t1 })
    await st.ajouterTirage(t2)
    assert.deepEqual(await st.tirages(commerce.id), [t2, t1])
    assert.equal(f.requetes.at(-1)!.params.get('order'), 'date.desc')
    assert.deepEqual(await st.tiragesClient(commerce.id, lina.id), [t1, t2])
    assert.equal(f.requetes.at(-1)!.params.get('client_id'), `eq.${lina.id}`)

    const avis = { id: 'av-1', commerceId: commerce.id, auteur: 'Marc', note: 5, texte: 'Top', date: '2026-11-08T10:00:00.000Z' }
    await st.ajouterAvis(avis)
    assert.deepEqual(await st.unAvis(commerce.id, 'av-1'), avis)
    await st.majAvis({ ...avis, reponse: 'Merci !' })
    assert.equal((await st.avis(commerce.id))[0].reponse, 'Merci !')
  })

  test('déduplication par cleContact (0033 / +33 / 06, e-mail en minuscules) garantie par la contrainte de la base', async () => {
    const f = fauxPostgrest()
    const st = ouvrir(f)
    await st.ajouterCommerce(commerce, { hash: 'h', sel: 's' })
    const lina = nouveauClient(commerce.id, 'Lina', { telephone: '06 12 34 56 78' })
    await st.ajouterClient(lina)
    for (const telephone of ['0033612345678', '+33 6 12 34 56 78', '06.12.34.56.78']) {
      assert.equal((await st.clientParContact(commerce.id, { telephone }))?.id, lina.id, telephone)
    }
    // Même si le serveur ne vérifiait pas avant, la base refuse le doublon.
    await assert.rejects(st.ajouterClient(nouveauClient(commerce.id, 'Lina bis', { telephone: '+33612345678' })), ErreurConflit)
    const marc = nouveauClient(commerce.id, 'Marc', { email: 'Marc@Exemple.fr' })
    await st.ajouterClient(marc)
    assert.equal(f.tables.clients.at(-1)!.cle_contact, cleContact({ email: 'marc@exemple.fr' }))
    await assert.rejects(st.ajouterClient(nouveauClient(commerce.id, 'Marc', { email: ' marc@exemple.FR ' })), ErreurConflit)
    assert.equal(f.tables.clients.length, 2)
    assert.deepEqual(f.rejets, ['clients:23505', 'clients:23505'])
    // Le même contact reste libre dans un autre commerce.
    await st.ajouterCommerce({ ...commerce, id: 'c-autre' }, { hash: 'h', sel: 's' })
    await st.ajouterClient(nouveauClient('c-autre', 'Lina', { telephone: '0612345678' }))
  })

  test('1 tirage par client et par jour (heure de Paris) : le 2e est rejeté par la base', async () => {
    const f = fauxPostgrest()
    const st = ouvrir(f)
    await st.ajouterCommerce(commerce, { hash: 'h', sel: 's' })
    const lina = nouveauClient(commerce.id, 'Lina', { telephone: '0612345678' })
    const marc = nouveauClient(commerce.id, 'Marc', { telephone: '0699999999' })
    await st.ajouterClient(lina)
    await st.ajouterClient(marc)
    const tirage = (id: string, clientId: string, date: string): Tirage => ({ id, commerceId: commerce.id, clientId, lot: 'Nems', date })
    await st.ajouterTirage(tirage('t1', lina.id, '2026-11-09T08:00:00.000Z')) // 9 h à Paris
    await assert.rejects(st.ajouterTirage(tirage('t2', lina.id, '2026-11-09T22:30:00.000Z')), ErreurConflit) // 23 h 30 à Paris, même jour
    await st.ajouterTirage(tirage('t3', lina.id, '2026-11-09T23:30:00.000Z')) // 0 h 30 le 10/11 à Paris : nouveau jour
    await st.ajouterTirage(tirage('t4', marc.id, '2026-11-09T09:00:00.000Z')) // autre client, même jour
    assert.deepEqual(f.rejets, ['tirages:23505'])
    assert.deepEqual(f.tables.tirages.map((t) => t.id), ['t1', 't3', 't4'])
  })

  test('erreur Supabase : message clair, sans la clé', async () => {
    const f = fauxPostgrest()
    const st = ouvrir(f)
    f.panne(true)
    await assert.rejects(Promise.resolve(st.commerces()), (e: Error) => {
      assert.match(e.message, /^Supabase \(commerces\) : base indisponible/)
      assert.ok(!e.message.includes(CLE))
      return !(e instanceof ErreurConflit)
    })
  })
})

// ---------- Serveur complet sur le faux Supabase ----------

describe('Supabase : serveur /api/v1 complet (règles métier inchangées)', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-supabase-'))
  after(() => rmSync(dossier, { recursive: true, force: true }))
  const horloge = new Date(2026, 10, 9, 12, 0)

  async function demarrer(f: ReturnType<typeof fauxPostgrest> | undefined, options: Partial<OptionsServeur> = {}) {
    const app = await creerServeur({
      fichierDb: join(dossier, 'ne-doit-pas-exister.db'),
      supabase: f && { url: URL_SB, cleServiceRole: CLE, fetch: f.fetch },
      adminPin: ADMIN,
      pinInitial: '1234',
      version: 'test',
      maintenant: () => horloge,
      ...options,
    })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
    async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
      const r = await fetch(base + chemin, {
        method: methode,
        headers: { 'Content-Type': 'application/json', ...entetes },
        body: corps === undefined ? undefined : JSON.stringify(corps),
      })
      return { statut: r.status, contenu: await r.json() }
    }
    return { app, api }
  }

  test('sans variables Supabase → SQLite ; avec → Supabase (champ `stockage` de /sante)', async () => {
    assert.equal(configSupabaseDepuisEnv({}), undefined)
    assert.equal(configSupabaseDepuisEnv({ SUPABASE_ANON_KEY: 'x', DB_FILE: 'a.db' }), undefined, 'la clé anon seule ne suffit pas (et ne sert pas)')
    assert.deepEqual(configSupabaseDepuisEnv({ SUPABASE_URL: `${URL_SB}/`, SUPABASE_SERVICE_ROLE_KEY: ` ${CLE} ` }), { url: URL_SB, cleServiceRole: CLE })
    assert.throws(() => configSupabaseDepuisEnv({ SUPABASE_URL: URL_SB }), /SUPABASE_SERVICE_ROLE_KEY/)
    assert.throws(() => configSupabaseDepuisEnv({ SUPABASE_SERVICE_ROLE_KEY: CLE }), /SUPABASE_URL/)
    assert.throws(() => configSupabaseDepuisEnv({ SUPABASE_URL: 'projet.supabase.co', SUPABASE_SERVICE_ROLE_KEY: CLE }), /adresse web/)
    // server/index.ts passe bien la config issue de l'environnement à creerServeur.
    assert.match(readFileSync(join(import.meta.dirname, '..', 'server', 'index.ts'), 'utf8'), /supabase = configSupabaseDepuisEnv\(env\)[\s\S]*creerServeur\(\{[\s\S]*supabase,/)

    const sqlite = await demarrer(undefined, { fichierDb: join(dossier, 'local.db') })
    try {
      assert.equal((await sqlite.api('GET', '/sante')).contenu.stockage, 'sqlite')
    } finally {
      await sqlite.app.fermer()
    }
    const f = fauxPostgrest()
    const sb = await demarrer(f)
    try {
      assert.equal((await sb.api('GET', '/sante')).contenu.stockage, 'supabase')
      assert.ok(!existsSync(join(dossier, 'ne-doit-pas-exister.db')), 'aucun fichier SQLite sous Supabase')
      // Initialisation : Asian Home seul, PIN haché (jamais en clair), 0 client.
      assert.deepEqual(f.tables.commerces.map((c) => c.id), [AH])
      assert.match(String(f.tables.commerces[0].pin_hash), /^scrypt\$v1\$[0-9a-f]{128}$/)
      assert.ok(!JSON.stringify(f.tables.commerces).includes('"1234"'))
      assert.equal(f.tables.clients.length, 0)
      assert.ok(f.tables.meta.some((m) => m.cle === 'initialise'))
    } finally {
      await sb.app.fermer()
    }
    // Redémarrage sur la même base : pas de 2e initialisation.
    const encore = await demarrer(f)
    await encore.app.fermer()
    assert.equal(f.tables.commerces.length, 1)
  })

  test('S3 : base Supabase neuve en production = Asian Home Paris réel et vide (0 client / avis / tirage), rien de démo', async () => {
    const f = fauxPostgrest()
    // Sans PIN_ASIAN_HOME en production, le serveur refuse d'initialiser (aucun PIN par défaut) et n'écrit rien.
    await assert.rejects(demarrer(f, { production: true, pinInitial: undefined }), /PIN_ASIAN_HOME/)
    assert.equal(f.tables.commerces.length, 0)
    assert.equal(f.tables.meta.length, 0)

    const { app, api } = await demarrer(f, { production: true, pinInitial: '4826' })
    try {
      const sante = (await api('GET', '/sante')).contenu
      assert.deepEqual([sante.stockage, sante.mode, sante.demo], ['supabase', 'production', false])
      assert.deepEqual(f.tables.commerces.map((c) => c.id), [AH])
      const ah = f.tables.commerces[0].donnees as Commerce
      assert.equal(ah.nom, 'Asian Home Paris')
      assert.equal(ah.demo, false)
      assert.equal(ah.actif, true)
      assert.equal(ah.lienGoogle, 'https://search.google.com/local/writereview?placeid=ChIJAV70Kqxt5kcRnhPY0L6yaf0')
      assert.match(ah.coordonnees ?? '', /André Joineau/)
      for (const t of ['clients', 'tirages', 'avis'] as const) assert.equal(f.tables[t].length, 0, `${t} vide`)
      assert.deepEqual(f.tables.meta.map((m) => m.cle), ['initialise'], 'pas de ligne meta « demo »')
      const etat = (await api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Commerce-PIN': '4826' })).contenu
      assert.deepEqual([etat.clients.length, etat.tirages.length, etat.avis.length], [0, 0, 0])
    } finally {
      await app.fermer()
    }
  })

  test('production AVANT la migration 0003 : l’existant marche (visite, récompense, état, roue), les nouveautés → 503 explicite', async () => {
    const f = fauxPostgrest({ sans0003: true })
    const { app, api } = await demarrer(f)
    try {
      assert.equal((await api('GET', '/sante')).contenu.migrations.cartiz, false)
      const c = (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0612345678' }, PIN)).contenu.client as Client
      const v = await api('POST', `/commerces/${AH}/clients/${c.id}/visite`, undefined, PIN)
      assert.equal(v.statut, 200, 'la visite reste enregistrée (seule la trace du journal manque)')
      assert.equal(v.contenu.client.tampons, 1)
      const etat = await api('GET', `/commerces/${AH}/etat`, undefined, PIN)
      assert.deepEqual([etat.statut, etat.contenu.membres, etat.contenu.journal], [200, [], []])
      assert.equal((await api('POST', `/commerces/${AH}/tirages`, { contact: '0612345678' })).statut, 201)
      assert.equal((await api('GET', `/cartes/${c.id}`)).statut, 200)
      const m = await api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)
      assert.equal(m.statut, 503)
      assert.match(m.contenu.erreur, /0003_cartiz\.sql/)
      assert.equal((await api('PUT', `/commerces/${AH}/menu`, { categories: [] }, PIN)).statut, 503)
      assert.equal((await api('GET', `/commerces/${AH}/caisse`, undefined, { 'X-Equipe-Code': '2468' })).statut, 503, 'pas « code incorrect »')
      assert.equal((await api('GET', `/commerces/${AH}/menu`)).statut, 200)
    } finally {
      await app.fermer()
    }
    // Après la migration : /sante le dit.
    const g = fauxPostgrest()
    const apres = await demarrer(g)
    try {
      assert.equal((await apres.api('GET', '/sante')).contenu.migrations.cartiz, true)
    } finally {
      await apres.app.fermer()
    }
  })

  test('Cartiz sous Supabase : équipe (code haché hors donnees), caisse + points, journal, menu, suppression d’un membre', async () => {
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      const m = await api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)
      assert.equal(m.statut, 201)
      assert.match(String(f.tables.equipe[0].code_hash), /^scrypt\$v1\$[0-9a-f]{128}$/)
      assert.ok(!JSON.stringify(f.tables.equipe).includes('2468'), 'code jamais stocké en clair')
      const c = (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0612345678' }, PIN)).contenu.client as Client
      const p = await api('POST', `/commerces/${AH}/caisse/passage`, { clientId: c.id, montantCentimes: 1200, actionId: 'act-sb-0001' }, { 'X-Equipe-Code': '2468' })
      assert.deepEqual([p.statut, p.contenu.client.tampons, p.contenu.client.points], [200, 1, 62], '12 points du passage + 50 points de bienvenue')
      const bis = await api('POST', `/commerces/${AH}/caisse/passage`, { clientId: c.id, montantCentimes: 1200, actionId: 'act-sb-0001' }, { 'X-Equipe-Code': '2468' })
      assert.equal(bis.contenu.dejaTraite, true)
      assert.equal((f.tables.clients[0].donnees as Client).points, 62)
      assert.equal(f.tables.journal.length, 2, 'ajout du membre + 1 passage (le rejeu n’est pas journalisé)')
      assert.equal((await api('PUT', `/commerces/${AH}/menu`, { categories: [{ nom: 'Plats', produits: [{ nom: 'Pho', prix: 1290, allergenes: [] }] }] }, PIN)).statut, 200)
      assert.equal((await api('PUT', `/commerces/${AH}/menu`, { categories: [{ nom: 'Plats', produits: [{ nom: 'Pho', prix: 1390, allergenes: [] }] }] }, PIN)).statut, 200)
      assert.equal(f.tables.menus.length, 1, 'upsert : un seul menu par commerce')
      assert.equal(((await api('GET', `/commerces/${AH}/menu`)).contenu.menu.categories[0].produits[0].prix), 1390)
      const etat = (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu
      assert.deepEqual(etat.journal.map((e: { action: string }) => e.action).sort(), ['equipe', 'menu', 'menu', 'passage'])
      assert.equal((await api('DELETE', `/commerces/${AH}/equipe/${m.contenu.membre.id}`, undefined, PIN)).statut, 200)
      assert.equal(f.tables.equipe.length, 0)
    } finally {
      await app.fermer()
    }
  })

  test('parcours : inscription dédupliquée, roulette = visite du jour obligatoire, 1 visite = 1 tampon, récompense avec report', async () => {
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      const ins = await api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '06 12 34 56 78' })
      assert.equal(ins.statut, 201)
      const id = ins.contenu.client.id as string
      assert.equal(ins.contenu.client.telephone, undefined, 'réponse publique sans téléphone')
      const bis = await api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '+33 6 12 34 56 78' })
      assert.deepEqual([bis.statut, bis.contenu.existant, bis.contenu.client.id], [200, true, id])

      const sansVisite = await api('POST', `/commerces/${AH}/tirages`, { contact: '0612345678' })
      assert.equal(sansVisite.statut, 409)
      assert.match(sansVisite.contenu.erreur, /valider votre visite/)

      const etat = async () => (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu as { commerce: Commerce; clients: Client[] }
      const avant = (await etat()).clients[0]
      const visite = await api('POST', `/commerces/${AH}/clients/${id}/visite`, undefined, PIN)
      assert.equal(visite.statut, 200)
      // Mêmes fonctions pures que le front et que SQLite : rien n'est réécrit dans la couche Supabase.
      // (La route visite applique aussi le programme — défi démarré — que `validerVisite` ne connaît pas.)
      const { defi, depenseCentimes, ...sansProgramme } = visite.contenu.client as Client & { defi?: unknown }
      assert.deepEqual(sansProgramme, validerVisite(avant, (await etat()).commerce, horloge))
      assert.equal((visite.contenu.client.defi as { objectif: number }).objectif, 3)
      assert.equal(visite.contenu.client.depenseCentimes, 0, 'visite sans montant')
      assert.deepEqual(f.tables.clients[0].donnees, visite.contenu.client)

      const jeu = await api('POST', `/commerces/${AH}/tirages`, { contact: '0033612345678' })
      assert.equal(jeu.statut, 201)
      assert.match(jeu.contenu.code, /^[A-Z2-9]{6}$/)
      assert.equal((await api('POST', `/commerces/${AH}/tirages`, { contact: '0612345678' })).statut, 409)
      assert.equal(f.tables.tirages.length, 1)

      // Seuil 2 : 3 visites → récompense → 1 tampon reporté.
      assert.equal((await api('PATCH', `/commerces/${AH}`, { seuilTampons: 2 }, PIN)).statut, 200)
      await api('POST', `/commerces/${AH}/clients/${id}/visite`, undefined, PIN)
      await api('POST', `/commerces/${AH}/clients/${id}/visite`, undefined, PIN)
      const { commerce, clients } = await etat()
      assert.equal(clients[0].tampons, 3)
      const rec = await api('POST', `/commerces/${AH}/clients/${id}/recompense`, undefined, PIN)
      assert.equal(rec.statut, 200)
      assert.deepEqual(rec.contenu.client, offrirRecompense(clients[0], commerce, horloge))
      assert.equal(rec.contenu.client.tampons, 1)
      assert.equal((await api('POST', `/commerces/${AH}/clients/${id}/recompense`, undefined, PIN)).statut, 409)
      assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Commerce-PIN': '9999' })).statut, 401)
    } finally {
      await app.fermer()
    }
  })

  test('requêtes simultanées : double tirage rejeté par la base, double visite sans tampon perdu, double inscription = 1 client', async () => {
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      // Double inscription au même instant (deux formats du même numéro).
      f.barriere('GET', 'clients')
      const [a, b] = await Promise.all([
        api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0612345678' }),
        api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '+33612345678' }),
      ])
      assert.deepEqual([a.statut, b.statut].sort(), [200, 201])
      assert.equal(a.contenu.client.id, b.contenu.client.id)
      assert.equal(f.tables.clients.length, 1)
      assert.deepEqual(f.rejets, ['clients:23505'], 'c’est la contrainte de la base qui a tranché')
      const id = a.contenu.client.id

      // Double « valider la visite » au même instant : l'une passe, l'autre 409 (verrou optimiste), aucun tampon perdu.
      f.barriere('GET', 'clients')
      const visites = await Promise.all([1, 2].map(() => api('POST', `/commerces/${AH}/clients/${id}/visite`, undefined, PIN)))
      const reussies = visites.filter((v) => v.statut === 200).length
      assert.deepEqual(visites.map((v) => v.statut).sort(), [200, 409])
      assert.match(visites.find((v) => v.statut === 409)!.contenu.erreur, /réessayez/)
      assert.equal((f.tables.clients[0].donnees as Client).tampons, reussies)

      // Double tirage au même instant : les deux lectures ne voient aucun tirage, la base refuse le 2e INSERT.
      f.barriere('GET', 'tirages')
      const jeux = await Promise.all([1, 2].map(() => api('POST', `/commerces/${AH}/tirages`, { contact: '0612345678' })))
      assert.deepEqual(jeux.map((j) => j.statut).sort(), [201, 409])
      assert.match(jeux.find((j) => j.statut === 409)!.contenu.erreur, /déjà tourné la roue/)
      assert.equal(f.tables.tirages.length, 1)
      assert.ok(f.rejets.includes('tirages:23505'), 'c’est l’index unique de la base qui a refusé le 2e tirage')
    } finally {
      await app.fermer()
    }
  })

  test('DEMO=1 sous Supabase : commerces de démo ajoutés une seule fois, même après redémarrage', async () => {
    const f = fauxPostgrest()
    for (let i = 0; i < 2; i++) {
      const { app } = await demarrer(f, { demo: true })
      await app.fermer()
    }
    assert.deepEqual(f.tables.commerces.map((c) => [c.id, (c.donnees as Commerce).demo]), [[AH, false], ['c-atelier-camille', true], ['c-maison-lila', true]])
    assert.ok(f.tables.clients.length > 0 && f.tables.tirages.length > 0 && f.tables.avis.length > 0)
    assert.ok(!f.tables.clients.some((c) => c.commerce_id === AH))
  })

  // ---------- P0-S1 : PIN scrypt + sessions sous Supabase ----------

  const SECRET = 'secret-de-session-de-test-assez-long-0123456789'

  test('P0-S1 : hash SHA-256 existant en base (pin_hash, code_hash) accepté puis re-haché en scrypt au 1er accès', async () => {
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f, { secretSession: SECRET })
    try {
      assert.equal((await api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)).statut, 201)
      // État de la production avant P0-S1 : hash SHA-256 (64 hex nus).
      const ancienPin = hacherPinAncien('1234')
      const ancienCode = hacherPinAncien('2468')
      Object.assign(f.tables.commerces[0], { pin_hash: ancienPin.hash, pin_sel: ancienPin.sel })
      Object.assign(f.tables.equipe[0], { code_hash: ancienCode.hash, code_sel: ancienCode.sel })
      assert.equal((await api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '9999' })).statut, 401)
      assert.equal(f.tables.commerces[0].pin_hash, ancienPin.hash, 'mauvais PIN : rien n’est réécrit')
      assert.equal((await api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '1234' })).statut, 201)
      assert.match(String(f.tables.commerces[0].pin_hash), /^scrypt\$v1\$[0-9a-f]{128}$/)
      assert.notEqual(f.tables.commerces[0].pin_sel, ancienPin.sel, 'nouveau sel')
      assert.equal((await api('GET', `/commerces/${AH}/caisse`, undefined, { 'X-Equipe-Code': '2468' })).statut, 200)
      assert.match(String(f.tables.equipe[0].code_hash), /^scrypt\$v1\$/)
      // Et ça marche toujours après la migration.
      assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).statut, 200)
      assert.equal((await api('GET', `/commerces/${AH}/caisse`, undefined, { 'X-Equipe-Code': '2468' })).statut, 200)
    } finally {
      await app.fermer()
    }
  })

  test('P0-S1 : révocation persistée dans sessions_revoquees (survit au redémarrage) ; révocations expirées nettoyées', async () => {
    const f = fauxPostgrest()
    let jeton = ''
    let { app, api } = await demarrer(f, { secretSession: SECRET })
    try {
      jeton = (await api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '1234' })).contenu.jeton
      assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': jeton })).statut, 200)
      assert.equal((await api('DELETE', '/sessions', undefined, { 'X-Session': jeton })).statut, 200)
      assert.equal(f.tables.sessions_revoquees.length, 1)
      assert.deepEqual(Object.keys(f.tables.sessions_revoquees[0]).sort(), ['expire_le', 'jti'], 'ni PIN ni jeton complet en base')
      assert.equal((await api('DELETE', '/sessions', undefined, { 'X-Session': jeton })).statut, 200, 'idempotent')
      assert.equal(f.tables.sessions_revoquees.length, 1)
    } finally {
      await app.fermer()
    }
    ;({ app, api } = await demarrer(f, { secretSession: SECRET }))
    try {
      assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': jeton })).statut, 401, 'révocation relue en base après redémarrage')
      // Une révocation déjà expirée est supprimée à la révocation suivante.
      f.tables.sessions_revoquees.push({ jti: 'vieux', expire_le: '2026-11-01T00:00:00.000Z' })
      const autre = (await api('POST', '/sessions', { role: 'admin', pin: ADMIN })).contenu.jeton
      assert.equal((await api('DELETE', '/sessions', undefined, { 'X-Session': autre })).statut, 200)
      assert.deepEqual(f.tables.sessions_revoquees.map((l) => l.jti).includes('vieux'), false)
      assert.equal(f.tables.sessions_revoquees.length, 2)
    } finally {
      await app.fermer()
    }
  })

  test('P0-S1 : production AVANT la migration 0005 — sessions et révocation en mémoire, jamais de 500', async () => {
    const f = fauxPostgrest({ sans0005: true })
    const { app, api } = await demarrer(f, { secretSession: SECRET })
    try {
      const s = await api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '1234' })
      assert.equal(s.statut, 201)
      const entete = { 'X-Session': s.contenu.jeton }
      assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, entete)).statut, 200)
      assert.equal((await api('DELETE', '/sessions', undefined, entete)).statut, 200)
      assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, entete)).statut, 401, 'révoquée en mémoire')
      assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).statut, 200, 'le PIN en en-tête marche toujours')
      assert.deepEqual(Object.keys((await api('GET', '/sante')).contenu.migrations), ['cartiz', 'programme'], '/sante inchangé')
    } finally {
      await app.fermer()
    }
  })

  test('P0-S2 : blocage PIN écrit dans `tentatives_auth` (sans PIN ni contact) et relu après redémarrage', async () => {
    const f = fauxPostgrest()
    let { app, api } = await demarrer(f)
    try {
      for (let i = 0; i < 10; i++) assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Commerce-PIN': '9999' })).statut, 401)
      assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).statut, 429)
    } finally {
      await app.fermer()
    }
    const ip = f.tables.tentatives_auth.find((l) => l.cle === 'ip:127.0.0.1')!
    assert.deepEqual([ip.portee, ip.echecs], ['commerce', 10])
    assert.ok(Date.parse(String(ip.bloque_jusqu_a)) > horloge.getTime())
    assert.equal(f.tables.tentatives_auth.find((l) => l.cle === `cible:${AH}`)!.echecs, 10)
    assert.doesNotMatch(JSON.stringify(f.tables.tentatives_auth), /9999|1234/)
    ;({ app, api } = await demarrer(f))
    try {
      assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).statut, 429, 'blocage relu en base')
    } finally {
      await app.fermer()
    }
  })

  test('P0-S2 : production AVANT la migration 0006 — comptage en mémoire, blocage quand même, jamais de 500', async () => {
    const f = fauxPostgrest({ sans0006: true })
    const { app, api } = await demarrer(f)
    try {
      assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).statut, 200)
      for (let i = 0; i < 10; i++) assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Commerce-PIN': '9999' })).statut, 401)
      assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).statut, 429)
      assert.equal((await api('GET', '/sante')).statut, 200)
    } finally {
      await app.fermer()
    }
  })
})

// ---------- Secrets et configuration ----------

describe('Supabase : variables d’environnement et secrets', () => {
  const racine = join(import.meta.dirname, '..')

  test('.env.example : exactement les variables Supabase, placeholders seulement', () => {
    const exemple = readFileSync(join(racine, '.env.example'), 'utf8')
    const variables = [...exemple.matchAll(/^([A-Z_]+)=(.*)$/gm)]
    assert.deepEqual(variables.map((v) => v[1]), ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'])
    assert.equal(variables[0][2], 'https://VOTRE-PROJET.supabase.co')
    assert.equal(variables[1][2], 'A_REMPLIR_SERVEUR_UNIQUEMENT')
    assert.doesNotMatch(exemple, /eyJ[\w-]{10,}|sb_secret_\w{8,}|sb_publishable_\w{8,}/, 'aucune vraie clé')
    assert.match(readFileSync(join(racine, '.gitignore'), 'utf8'), /^\.env$/m)
  })

  test('la clé service_role et le client Supabase ne sont jamais dans le front (src/)', () => {
    const fichiers = (d: string): string[] =>
      readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? fichiers(join(d, n)) : [join(d, n)]))
    for (const f of fichiers(join(racine, 'src'))) {
      const contenu = readFileSync(f, 'utf8')
      assert.doesNotMatch(contenu, /SUPABASE|supabase-js|service_role/i, f)
    }
  })

  test('la couche Supabase réutilise cleContact et ne réécrit aucune règle métier', () => {
    const code = readFileSync(join(racine, 'server', 'stockage-supabase.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    assert.match(code, /import \{ cleContact \} from '\.\.\/src\/lib\/fidelite\.ts'/)
    assert.doesNotMatch(code, /tampons|seuilTampons|visites|statutJeu|tirerLot|0033|\\D/)
    assert.doesNotMatch(code, /from 'pg'|postgres:\/\//, 'pas de connexion Postgres directe')
  })
})

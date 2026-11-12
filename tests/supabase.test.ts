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
import { ErreurConflit, ErreurMigrationManquante } from '../server/stockage.ts'
import { configSupabaseDepuisEnv, ouvrirStockageSupabase } from '../server/stockage-supabase.ts'
import { nouveauCommerce } from '../src/data/defaults.ts'
import { cleContact, nouveauClient, offrirRecompense, validerVisite } from '../src/lib/fidelite.ts'
import { calculerChiffresCartes } from '../src/lib/stats.ts'
import { soldePoints } from '../src/lib/points.ts'
import { MESSAGE_ACTIVATION } from '../src/lib/roulette.ts'
import type { Client, Commerce, EnvoiRelance, Tirage } from '../src/types.ts'

const URL_SB = 'https://projet-factice.supabase.co'
const CLE = 'cle-service-role-factice' // pas une vraie clé
const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }

// ---------- Faux PostgREST (mémoire) ----------

type Ligne = Record<string, unknown>
/** `cle` renvoie null pour une ligne hors du champ de l'index (index unique partiel, ex. `envois` … where statut in …). */
type Unicite = { nom: string; cle: (l: Ligne) => string | null }

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
  // 0007_relances.sql
  envois: {
    pk: 'id',
    uniques: [{ nom: 'envois_un_par_jour', cle: (l) => (l.statut === 'en_cours' || l.statut === 'envoye' ? `${l.commerce_id}|${l.client_id}|${l.modele}|${l.jour}` : null) }],
    fk: [['commerce_id', 'commerces']],
  },
  // 0008_mesure.sql — écrite seulement par la fonction `incrementer_evenement` (POST /rpc/…), clé (commerce_id, jour, type).
  evenements_jour: { pk: 'jour', uniques: [], fk: [['commerce_id', 'commerces']] },
  // 0010_compteurs_publics.sql — clé du compteur (`lecture:<ip>`, `carte:<id>`…), fenêtre d'une minute, nombre.
  compteurs_publics: { pk: 'cle', uniques: [] },
}

interface Requete {
  methode: string
  table: string
  params: URLSearchParams
  entetes: Headers
  corps: unknown
}

/** `sans0003` : base de production AVANT la migration 0003 (tables equipe / journal / menus absentes). `sans0004` à `sans0008` : idem pour 0004 à 0008. `sans0010` : idem pour 0010 (compteurs publics). */
function fauxPostgrest({ sans0003 = false, sans0004 = false, sans0005 = false, sans0006 = false, sans0007 = false, sans0008 = false, sans0010 = false } = {}) {
  const absentes = new Set([
    ...(sans0003 ? ['equipe', 'journal', 'menus'] : []),
    ...(sans0004 ? ['parrainages', 'demandes_rattrapage'] : []),
    ...(sans0005 ? ['sessions_revoquees'] : []),
    ...(sans0006 ? ['tentatives_auth'] : []),
    ...(sans0007 ? ['envois'] : []),
    ...(sans0008 ? ['evenements_jour'] : []),
    ...(sans0010 ? ['compteurs_publics'] : []),
  ])
  const tables: Record<string, Ligne[]> = Object.fromEntries(Object.keys(SCHEMA).map((t) => [t, []]))
  const requetes: Requete[] = []
  const rejets: string[] = []
  let compteur = 0
  let panne = false
  let barriere: { methode: string; table: string; n: number; enAttente: (() => void)[] } | undefined
  // Revue Codex R2 : échecs ponctuels (500, consommés un par un) et lenteur simulée de certaines requêtes.
  const echecs: { methode: string; table: string }[] = []
  let lenteur: { ms: number; vise: (methode: string, table: string, params: URLSearchParams) => boolean } | undefined

  const json = (statut: number, corps?: unknown) =>
    new Response(corps === undefined ? null : JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } })
  const erreur = (statut: number, code: string, message: string) => json(statut, { code, message, details: null, hint: null })

  /** Colonne, ou chemin JSONB d'un niveau (`donnees->>code` : texte ; `donnees->remis` : json) ; clé absente = NULL. */
  function valeur(l: Ligne, col: string): unknown {
    const m = /^(\w+)->(>?)(\w+)$/.exec(col)
    if (!m) return l[col]
    const v = (l[m[1]] as Record<string, unknown> | null | undefined)?.[m[3]]
    return v == null ? null : m[2] && typeof v === 'object' ? JSON.stringify(v) : v
  }

  function filtrer(table: string, params: URLSearchParams): Ligne[] {
    let lignes = tables[table]
    for (const [col, v] of params) {
      if (['select', 'order', 'on_conflict', 'limit', 'offset'].includes(col)) continue
      if (v.startsWith('gte.')) {
        // Seul usage : jours AAAA-MM-JJ (compteurs de la mesure, P2-Q3) — l'ordre alphabétique est l'ordre chronologique.
        lignes = lignes.filter((l) => l[col] != null && String(l[col]) >= v.slice(4))
        continue
      }
      if (v.startsWith('gt.')) {
        // Seul usage : `donnees->>activeLe` (revue Codex R3 F4), texte ISO comparé comme texte, comme Postgres ; NULL : faux.
        lignes = lignes.filter((l) => valeur(l, col) != null && String(valeur(l, col)) > v.slice(3))
        continue
      }
      if (v.startsWith('lt.')) {
        // Seul usage : dates (timestamptz) — nettoyage des sessions révoquées et des tentatives d'accès. NULL < x : faux.
        lignes = lignes.filter((l) => l[col] != null && Date.parse(String(l[col])) < Date.parse(v.slice(3)))
        continue
      }
      if (v === 'is.null') {
        lignes = lignes.filter((l) => valeur(l, col) == null)
        continue
      }
      if (!v.startsWith('eq.')) throw new Error(`Opérateur non géré par le faux PostgREST : ${col}=${v}`)
      lignes = lignes.filter((l) => valeur(l, col) != null && String(valeur(l, col)) === v.slice(3))
    }
    const ordre = params.get('order')
    if (ordre) {
      // Plusieurs clés possibles (`jour.asc,type.asc`) ; dates comparées en temps, nombres en nombres, sinon en texte.
      const cles = ordre.split(',').map((o) => o.split('.'))
      const val = (l: Ligne, col: string) => (col === 'date' ? Date.parse(String(l[col])) : typeof l[col] === 'string' ? (l[col] as string) : Number(l[col]))
      lignes = [...lignes].sort((a, b) => {
        for (const [col, sens] of cles) {
          const x = val(a, col)
          const y = val(b, col)
          const d = x < y ? -1 : x > y ? 1 : 0
          if (d) return sens === 'desc' ? -d : d
        }
        return 0
      })
    }
    const debut = Number(params.get('offset') ?? 0)
    const limite = params.get('limit')
    // P0-S18 (revue Codex point 4) : PostgREST plafonne une réponse à 1 000 lignes même sans `limit` (max-rows par
    // défaut) ; le faux le reproduit, sinon un test HTTP ne verrait jamais une lecture non paginée. Une lecture
    // sans `limit` qui attend plus de 1 000 lignes est donc un bug du code testé, pas du faux.
    return lignes.slice(debut, debut + (limite ? Number(limite) : 1000))
  }

  const projeter = (lignes: Ligne[], select: string | null) =>
    lignes.map((l) => (select && select !== '*' ? Object.fromEntries(select.split(',').map((c) => [c, structuredClone(l[c])])) : structuredClone(l)))

  /** Première contrainte violée par `l` (en ignorant la ligne `soi` lors d'un UPDATE), sinon undefined. */
  function violation(table: string, l: Ligne, soi?: Ligne): [number, string, string] | undefined {
    const s = SCHEMA[table]
    const autres = tables[table].filter((x) => x !== soi)
    if (autres.some((x) => x[s.pk] === l[s.pk])) return [409, '23505', `duplicate key value violates unique constraint "${table}_pkey"`]
    for (const u of s.uniques) {
      const cle = u.cle(l)
      if (cle !== null && autres.some((x) => u.cle(x) === cle)) return [409, '23505', `duplicate key value violates unique constraint "${u.nom}"`]
    }
    for (const [col, cible] of s.fk ?? []) {
      if (!tables[cible].some((x) => x.id === l[col])) return [409, '23503', `insert or update on table "${table}" violates foreign key constraint`]
    }
    return undefined
  }

  async function traiter(methode: string, table: string, params: URLSearchParams, entetes: Headers, corps: unknown): Promise<Response> {
    if (entetes.get('apikey') !== CLE || entetes.get('authorization') !== `Bearer ${CLE}`) return erreur(401, 'PGRST301', 'clé absente')
    if (panne) return erreur(500, 'XX000', 'base indisponible') // (503 / 520 : supabase-js réessaie seul les lectures)
    if (table === 'rpc') return appeler(params.get('__fonction') ?? '', corps as Ligne)
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
      // `.delete().select(…)` (P1-B6 : bilan de la suppression d'un client) : PostgREST renvoie les lignes supprimées.
      return representation ? json(200, projeter([...cibles], params.get('select'))) : new Response(null, { status: 204 })
    }
    return erreur(405, 'PGRST000', 'méthode non gérée')
  }

  /** Fonctions SQL appelées par `sb.rpc(…)` (POST /rest/v1/rpc/<nom>) : seule `incrementer_evenement` (0008) existe. */
  function appeler(nom: string, args: Ligne): Response {
    if (nom !== 'incrementer_evenement' || absentes.has('evenements_jour')) {
      return erreur(404, 'PGRST202', `Could not find the function public.${nom} in the schema cache`)
    }
    if (!tables.commerces.some((c) => c.id === args.p_commerce_id)) return erreur(409, '23503', 'violates foreign key constraint')
    if (!['scan', 'tirage', 'gain', 'clicGoogle'].includes(String(args.p_type))) return erreur(400, '23514', 'violates check constraint')
    // insert … on conflict (commerce_id, jour, type) do update set n = n + 1 — atomique (un seul appel synchrone ici).
    const l = tables.evenements_jour.find((x) => x.commerce_id === args.p_commerce_id && x.jour === args.p_jour && x.type === args.p_type)
    if (l) l.n = Number(l.n) + 1
    else tables.evenements_jour.push({ commerce_id: args.p_commerce_id, jour: args.p_jour, type: args.p_type, n: 1 })
    return new Response(null, { status: 204 })
  }

  async function fauxFetch(entree: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(String(entree))
    assert.equal(url.origin, URL_SB)
    const [, rest, v1, table, fonction] = url.pathname.split('/')
    if (table === 'rpc') url.searchParams.set('__fonction', fonction ?? '')
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
    const echec = echecs.findIndex((e) => e.methode === methode && e.table === table)
    if (echec >= 0) {
      echecs.splice(echec, 1)
      rejets.push(`${table}:echec-${methode}`)
      return erreur(500, 'XX000', 'panne ponctuelle')
    }
    const reponse = await traiter(methode, table, url.searchParams, entetes, corps)
    // Lecture lente : l'instantané est pris tout de suite, la réponse n'arrive que `ms` plus tard (latence réseau).
    if (lenteur?.vise(methode, table, url.searchParams)) await new Promise((ok) => setTimeout(ok, lenteur!.ms))
    return reponse
  }

  return {
    fetch: fauxFetch as typeof fetch,
    tables,
    requetes,
    rejets,
    panne: (v: boolean) => void (panne = v),
    barriere: (methode: string, table: string, n = 2) => void (barriere = { methode, table, n, enAttente: [] }),
    /** La prochaine requête `methode` sur `table` échoue (500), une seule fois par appel. */
    echouer: (methode: string, table: string) => void echecs.push({ methode, table }),
    /** Réponses des requêtes visées retardées de `ms` (stockage lent, instantané pris à l'arrivée) ; sans argument : plus de lenteur. */
    ralentir: (o?: { ms: number; vise: (methode: string, table: string, params: URLSearchParams) => boolean }) => void (lenteur = o),
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
    assert.equal(f.requetes.at(-1)!.params.get('order'), 'date.desc,id.asc')
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

  test('P0-S11 : majCommerce conditionné à la version relue dans une transaction ; inconditionnel hors transaction', async () => {
    const f = fauxPostgrest()
    const st = ouvrir(f)
    await st.ajouterCommerce(commerce, { hash: 'h', sel: 's' })
    await st.majCommerce({ ...commerce, nom: 'Hors transaction' })
    assert.equal(f.requetes.at(-1)!.params.get('version'), null, 'hors transaction : pas de garde (comportement inchangé)')
    // Lecture dans la transaction, écriture concurrente entre-temps → ErreurConflit, la ligne garde l'autre écriture.
    await assert.rejects(
      st.transaction(async () => {
        const lu = (await st.commerce(commerce.id))!
        await ouvrir(f).majCommerce({ ...lu, nom: 'Autre requête' })
        await st.majCommerce({ ...lu, nom: 'Perdant' })
      }),
      (e: Error) => e instanceof ErreurConflit && /réessayez/.test(e.message),
    )
    assert.equal((f.tables.commerces[0].donnees as Commerce).nom, 'Autre requête')
    // Deux écritures successives dans la même transaction : la version suivie est celle renvoyée par la 1re.
    await st.transaction(async () => {
      const lu = (await st.commerce(commerce.id))!
      await st.majCommerce({ ...lu, nom: 'Un' })
      await st.majCommerce({ ...lu, nom: 'Deux' })
    })
    assert.equal((f.tables.commerces[0].donnees as Commerce).nom, 'Deux')
  })

  test('P0-S11 : journal et traces programme jamais ignorés — ErreurMigrationManquante sans la 0003 / 0004', async () => {
    const sans3 = fauxPostgrest({ sans0003: true })
    const st3 = ouvrir(sans3)
    await st3.ajouterCommerce(commerce, { hash: 'h', sel: 's' })
    const entree = { id: 'jr-1', commerceId: commerce.id, date: '2026-11-11T10:00:00.000Z', action: 'passage' as const, auteur: { type: 'gerant' as const, nom: 'Gérant' }, details: '+1 tampon' }
    await assert.rejects(Promise.resolve(st3.ajouterJournal(entree)), (e: Error) => e instanceof ErreurMigrationManquante && /0003_cartiz\.sql/.test(e.message))

    const sans4 = fauxPostgrest({ sans0004: true })
    const st4 = ouvrir(sans4)
    await st4.ajouterCommerce(commerce, { hash: 'h', sel: 's' })
    const p = { id: 'pr-1', commerceId: commerce.id, parrainId: 'cl-a', filleulId: 'cl-b', date: '2026-11-11T10:00:00.000Z', pointsParrain: 50, pointsFilleul: 50 }
    await assert.rejects(Promise.resolve(st4.ajouterParrainage(p)), (e: Error) => e instanceof ErreurMigrationManquante && /0004_programme\.sql/.test(e.message))
    const d = { id: 'rt-1', commerceId: commerce.id, clientId: 'cl-b', date: '2026-11-11T10:00:00.000Z', montantCentimes: 0, statut: 'en_attente' as const, creeLe: '2026-11-11T10:00:00.000Z' }
    await assert.rejects(Promise.resolve(st4.ajouterDemandeRattrapage(d)), ErreurMigrationManquante)
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
  let horloge = new Date(2026, 10, 9, 12, 0) // `let` : le test « parcours » avance d'un jour par visite (P1-S12).

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

  test('production AVANT la migration 0003 : démarrage refusé (journal d’audit obligatoire) ; après la migration, /sante le dit', async () => {
    // Mis à jour par P0-S11 : ce test affirmait qu'une visite passait sans la 0003 (journal ignoré en silence). P0-S11
    // interdit de perdre le journal sans le dire : le serveur refuse désormais de démarrer en Supabase sans la 0003,
    // avec un message qui nomme la migration et la sauvegarde à faire avant.
    const f = fauxPostgrest({ sans0003: true })
    await assert.rejects(demarrer(f), (e: Error) => {
      assert.match(e.message, /0003_cartiz\.sql/)
      assert.match(e.message, /sauvegarde-base\.mjs/)
      return true
    })
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
      // P2-S13 — oracle fermé (changement de contrat) : même statut 201 et même forme que la création,
      // sans `existant` et sans jeton ; seule la carte (même id) est renvoyée.
      assert.equal(bis.statut, 201)
      assert.equal('existant' in bis.contenu, false)
      assert.equal(bis.contenu.jeton, undefined)
      assert.equal(bis.contenu.client.id, id)

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
      // R3 (burn-on-reveal, décision du 12/11) : plus de code dans la réponse du tirage (servi par l'activation seulement).
      assert.equal(jeu.contenu.code, undefined)
      assert.equal((await api('POST', `/commerces/${AH}/tirages`, { contact: '0612345678' })).statut, 409)
      assert.equal(f.tables.tirages.length, 1)

      // Seuil 2 : 3 visites → récompense → 1 tampon reporté. P1-S12 : 1 tampon par jour — une visite par jour.
      assert.equal((await api('PATCH', `/commerces/${AH}`, { seuilTampons: 2 }, PIN)).statut, 200)
      horloge = new Date(2026, 10, 10, 12, 0)
      await api('POST', `/commerces/${AH}/clients/${id}/visite`, undefined, PIN)
      horloge = new Date(2026, 10, 11, 12, 0)
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
      horloge = new Date(2026, 10, 9, 12, 0)
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
      // P2-S13 — oracle fermé (changement de contrat) : les deux réponses sont 201, création ou reprise.
      assert.deepEqual([a.statut, b.statut].sort(), [201, 201])
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

  test('P0-S11 : deux enregistrements simultanés des réglages d’un commerce → 200 + 409, une seule valeur retenue', async () => {
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      const ligne = () => f.tables.commerces.find((c) => c.id === AH)!
      const versionInitiale = Number(ligne().version)
      // Les deux PATCH ne partent qu'une fois les deux arrivés : chacun a relu le commerce (même version) dans sa
      // transaction avant que l'autre n'écrive. Sans verrou, les deux passeraient et le 2e écraserait le 1er en silence.
      f.barriere('PATCH', 'commerces')
      const reponses = await Promise.all([7, 8].map((seuilTampons) => api('PATCH', `/commerces/${AH}`, { seuilTampons }, PIN)))
      assert.deepEqual(reponses.map((r) => r.statut).sort(), [200, 409])
      assert.match(reponses.find((r) => r.statut === 409)!.contenu.erreur, /réessayez/)
      const gagnant = reponses.find((r) => r.statut === 200)!.contenu.commerce as Commerce
      assert.equal(Number(ligne().version), versionInitiale + 1, 'une seule écriture a eu lieu')
      assert.equal((ligne().donnees as Commerce).seuilTampons, gagnant.seuilTampons)
      const maj = f.requetes.filter((r) => r.table === 'commerces' && r.methode === 'PATCH')
      for (const r of maj) assert.equal(r.params.get('version'), `eq.${versionInitiale}`, 'garde de version dans la requête elle-même')
      // Un nouvel essai (après le 409) relit la version à jour et passe.
      assert.equal((await api('PATCH', `/commerces/${AH}`, { seuilTampons: 9 }, PIN)).statut, 200)
      assert.equal((ligne().donnees as Commerce).seuilTampons, 9)
    } finally {
      await app.fermer()
    }
  })

  test('P0-S11 : logo envoyé pendant un enregistrement des réglages — le verrou empêche d’écraser l’un par l’autre', async () => {
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      const png = readFileSync(join(import.meta.dirname, '..', 'public', 'visuels', 'logo.png')) // vrai PNG 600×600
      const port = (app.serveur.address() as AddressInfo).port
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/commerces/${AH}/logo`)).status, 404, 'aucun logo téléversé avant la course')
      f.barriere('PATCH', 'commerces')
      const [reglages, logo] = await Promise.all([
        api('PATCH', `/commerces/${AH}`, { seuilTampons: 6 }, PIN),
        fetch(`http://127.0.0.1:${port}/api/v1/commerces/${AH}/logo`, { method: 'PUT', headers: PIN, body: png }).then(async (r) => ({ statut: r.status })),
      ])
      assert.deepEqual([reglages.statut, logo.statut].sort(), [200, 409])
      const d = f.tables.commerces.find((c) => c.id === AH)!.donnees as Commerce
      // Jamais un mélange silencieux : soit les réglages, soit le logo — l'autre a reçu 409 et peut réessayer.
      assert.equal(reglages.statut === 200, d.seuilTampons === 6)
      assert.equal(logo.statut === 200, /\/logo\?v=/.test(d.logo ?? ''))
      // L'image publique suit l'adresse retenue : un envoi refusé (409) ne remplace pas les octets servis (revue Codex).
      const servi = await fetch(`http://127.0.0.1:${port}/api/v1/commerces/${AH}/logo`)
      if (logo.statut === 200) {
        assert.equal(servi.status, 200)
        assert.ok(Buffer.from(await servi.arrayBuffer()).equals(png), 'octets identiques au PNG envoyé')
      } else {
        assert.equal(servi.status, 404, 'aucun logo téléversé avant la course : toujours aucun après le refus')
        assert.equal(f.tables.meta.find((m) => m.cle === `logo:${AH}`)?.valeur ?? '', '')
      }
    } finally {
      await app.fermer()
    }
  })

  test('P0-S11 : premières visites simultanées de deux filleuls du même parrain → parrain crédité deux fois (reprise sur conflit)', async () => {
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      const bob = (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Bob', contact: '0611111111' }, PIN)).contenu.client as Client
      const filleuls = [
        (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Alice', contact: '0622222222', parrain: bob.codeParrainage }, PIN)).contenu.client as Client,
        (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Chloé', contact: '0633333333', parrain: bob.codeParrainage }, PIN)).contenu.client as Client,
      ]
      const donnees = (id: string) => f.tables.clients.find((l) => l.id === id)!.donnees as Client
      assert.equal(soldePoints(donnees(bob.id)), 50, 'bienvenue')
      // Les deux filleuls sont écrits ensemble (barrière sur leurs PATCH) : chaque requête a relu le parrain à la même
      // version, donc le 1er crédit passe et le 2e fait 409. Sans reprise, le 2e filleul resterait payé sans crédit parrain.
      f.barriere('PATCH', 'clients')
      const visites = await Promise.all(filleuls.map((c) => api('POST', `/commerces/${AH}/clients/${c.id}/visite`, undefined, PIN)))
      assert.deepEqual(visites.map((v) => v.statut), [200, 200], JSON.stringify(visites.map((v) => v.contenu)))
      assert.equal(soldePoints(donnees(bob.id)), 50 + 50 + 50, 'bienvenue + 2 parrainages')
      assert.equal(donnees(bob.id).parrainagesGagnes?.length, 2)
      for (const c of filleuls) assert.equal(donnees(c.id).parrainagePaye, true)
      const traces = f.tables.parrainages.filter((l) => l.parrain_id === bob.id)
      assert.deepEqual(traces.map((l) => l.filleul_id).sort(), filleuls.map((c) => c.id).sort())
      assert.ok(traces.every((l) => (l.donnees as { pointsParrain: number }).pointsParrain === 50), JSON.stringify(traces))
      assert.equal(f.tables.journal.filter((l) => (l.donnees as { action?: string; clientId?: string }).action === 'parrainage' && (l.donnees as { clientId?: string }).clientId === bob.id).length, 2, 'un seul journal par crédit')
    } finally {
      await app.fermer()
    }
  })

  test('P0-S11 (revue Codex) : deux logos envoyés simultanément — l’adresse gagnante sert l’image gagnante', async () => {
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      const png = readFileSync(join(import.meta.dirname, '..', 'public', 'visuels', 'logo.png')) // vrai PNG 600×600
      const jpg = readFileSync(join(import.meta.dirname, '..', 'public', 'visuels', 'interieur.jpg')) // vrai JPEG
      const port = (app.serveur.address() as AddressInfo).port
      const base = `http://127.0.0.1:${port}/api/v1`
      f.barriere('GET', 'meta') // instantanés simultanés : les deux PUT voient l'absence de logo
      const [a, b] = await Promise.all([
        fetch(`${base}/commerces/${AH}/logo`, { method: 'PUT', headers: PIN, body: png }).then(async (r) => ({ statut: r.status, contenu: await r.json() })),
        fetch(`${base}/commerces/${AH}/logo`, { method: 'PUT', headers: PIN, body: jpg }).then(async (r) => ({ statut: r.status, contenu: await r.json() })),
      ])
      assert.deepEqual([a.statut, b.statut].sort(), [200, 409])
      const gagnant = a.statut === 200 ? a : b
      const octetsGagnant = a.statut === 200 ? png : jpg
      const adresse = (gagnant.contenu as { commerce: Commerce }).commerce.logo!
      assert.match(adresse, /\/logo\?v=/)
      // L'adresse versionnée sert les octets de l'envoi gagnant, pas ceux du perdant ni les anciens.
      const servi = await fetch(`http://127.0.0.1:${port}${adresse}`)
      assert.equal(servi.status, 200)
      assert.ok(Buffer.from(await servi.arrayBuffer()).equals(octetsGagnant), 'octets identiques à l’image gagnante')
      // Sans version non plus : le pointeur suit l'adresse retenue.
      const sansVersion = await fetch(`${base}/commerces/${AH}/logo`)
      assert.equal(sansVersion.status, 200)
      assert.ok(Buffer.from(await sansVersion.arrayBuffer()).equals(octetsGagnant))
    } finally {
      await app.fermer()
    }
  })

  test('P0-S11 (revue Codex) : logo envoyé pendant sa suppression — la suppression n’efface pas l’envoi gagnant', async () => {
    const f = fauxPostgrest()
    // Retient l'effacement du fichier par le DELETE : un envoi qui gagne entre-temps ne doit pas être effacé.
    // (L'effacement est l'upsert `meta` qui vide `logo:<id>` ; sans lui, la course ne se produit jamais.)
    let effacementRetenu = false
    let libererEffacement: (() => void) | undefined
    const fetchRetarde = async (entree: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const corps = init?.body ? (JSON.parse(String(init.body)) as { cle?: string; valeur?: string }) : undefined
      if ((init?.method ?? 'GET') === 'POST' && corps?.cle === `logo:${AH}` && corps?.valeur === '') {
        effacementRetenu = true
        await new Promise<void>((ok) => {
          libererEffacement = ok
        })
      }
      return f.fetch(entree, init)
    }
    const { app, api } = await demarrer({ ...f, fetch: fetchRetarde as typeof fetch })
    try {
      const png = readFileSync(join(import.meta.dirname, '..', 'public', 'visuels', 'logo.png'))
      const jpg = readFileSync(join(import.meta.dirname, '..', 'public', 'visuels', 'interieur.jpg'))
      const port = (app.serveur.address() as AddressInfo).port
      const base = `http://127.0.0.1:${port}/api/v1`
      assert.equal((await fetch(`${base}/commerces/${AH}/logo`, { method: 'PUT', headers: PIN, body: png })).status, 200, 'un logo est déjà en place')
      // Le DELETE vide le champ puis efface le fichier : on retient l'effacement.
      const suppr = api('DELETE', `/commerces/${AH}/logo`, undefined, PIN)
      for (let i = 0; i < 100 && !effacementRetenu; i++) await new Promise((r) => setTimeout(r, 50))
      assert.ok(effacementRetenu, 'le DELETE a atteint son effacement de fichier')
      // Entre-temps, un nouvel envoi gagne : son adresse est enregistrée.
      assert.equal((await fetch(`${base}/commerces/${AH}/logo`, { method: 'PUT', headers: PIN, body: jpg })).status, 200)
      libererEffacement?.()
      assert.equal((await suppr).statut, 200)
      // La suppression n'a pas effacé l'envoi gagnant : son adresse sert ses octets.
      const commerce = (await api('GET', `/commerces/${AH}`, undefined, PIN)).contenu.commerce as Commerce
      assert.match(commerce.logo ?? '', /\/logo\?v=/)
      const servi = await fetch(`http://127.0.0.1:${port}${commerce.logo!}`)
      assert.equal(servi.status, 200)
      assert.ok(Buffer.from(await servi.arrayBuffer()).equals(jpg), 'octets identiques au JPEG envoyé')
      const sansVersion = await fetch(`${base}/commerces/${AH}/logo`)
      assert.equal(sansVersion.status, 200)
      assert.ok(Buffer.from(await sansVersion.arrayBuffer()).equals(jpg))
    } finally {
      libererEffacement?.()
      await app.fermer()
    }
  })

  test('P0-S11 (revue Codex) : plafond atteint pendant la reprise du crédit parrain — le journal dit ce qui a vraiment été crédité', async () => {
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      // Plafond annuel à 1 parrainage : le 2e crédit simultané est recalculé à 0 pendant la reprise.
      assert.equal((await api('PATCH', `/commerces/${AH}`, { programme: { parrainage: { plafondAn: 1 } } }, PIN)).statut, 200)
      const bob = (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Bob', contact: '0611111111' }, PIN)).contenu.client as Client
      const filleuls = [
        (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Alice', contact: '0622222222', parrain: bob.codeParrainage }, PIN)).contenu.client as Client,
        (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Chloé', contact: '0633333333', parrain: bob.codeParrainage }, PIN)).contenu.client as Client,
      ]
      const donnees = (id: string) => f.tables.clients.find((l) => l.id === id)!.donnees as Client
      f.barriere('PATCH', 'clients')
      const visites = await Promise.all(filleuls.map((c) => api('POST', `/commerces/${AH}/clients/${c.id}/visite`, undefined, PIN)))
      assert.deepEqual(visites.map((v) => v.statut), [200, 200], JSON.stringify(visites.map((v) => v.contenu)))
      assert.equal(soldePoints(donnees(bob.id)), 50 + 50, 'bienvenue + un seul parrainage (plafond 1)')
      assert.equal(donnees(bob.id).parrainagesGagnes?.length, 1)
      const traces = f.tables.parrainages.filter((l) => l.parrain_id === bob.id)
      assert.deepEqual(traces.map((l) => (l.donnees as { pointsParrain: number }).pointsParrain).sort(), [0, 50])
      // Le journal du passage de chaque filleul dit la vérité : l'un annonce +50 pour le parrain, l'autre le plafond.
      const passages = f.tables.journal.filter((l) => (l.donnees as { action?: string }).action === 'passage')
      assert.equal(passages.length, 2)
      const textes = passages.map((l) => (l.donnees as { details?: string }).details ?? '')
      assert.equal(textes.filter((t) => t.includes('+50 points pour Bob (parrain)')).length, 1, JSON.stringify(textes))
      assert.equal(textes.filter((t) => t.includes('parrain au plafond annuel, rien pour Bob')).length, 1, JSON.stringify(textes))
    } finally {
      await app.fermer()
    }
  })

  test('P0-S11 : démarrage Supabase refusé sans la migration 0003 ou 0004 (journal et traces programme obligatoires)', async () => {
    await assert.rejects(demarrer(fauxPostgrest({ sans0003: true })), /0003_cartiz/)
    await assert.rejects(demarrer(fauxPostgrest({ sans0004: true })), /0004_programme/)
    // Les autres migrations restent facultatives au démarrage (repli documenté) : 0005 à 0008.
    const { app } = await demarrer(fauxPostgrest({ sans0005: true, sans0006: true, sans0007: true, sans0008: true }))
    await app.fermer()
  })

  test('P0-U3 : code gagnant remis une seule fois (UPDATE conditionnel), même simultanément ; persistant ; sans 0005/0006', async () => {
    // R3 (décision du 12/11) : le gain s'utilise à partir de J+1, et le code ne vient que de l'activation par le titulaire
    // (jeton client) — d'où le secret de session, le jeton et le lendemain ; l'intention (une seule remise) est inchangée.
    const f = fauxPostgrest({ sans0005: true, sans0006: true })
    const CODE = { 'X-Equipe-Code': '2468' }
    let code = ''
    try {
      {
        const { app, api } = await demarrer(f, { secretSession: SECRET })
        try {
          assert.equal((await api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)).statut, 201)
          assert.equal((await api('PATCH', `/commerces/${AH}`, { lots: [{ libelle: 'Nems offerts', probabilite: 100 }] }, PIN)).statut, 200)
          const ins = (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0612345678' })).contenu as { client: Client; jeton: string }
          const bearer = { Authorization: `Bearer ${ins.jeton}` }
          await api('POST', `/commerces/${AH}/clients/${ins.client.id}/visite`, undefined, PIN)
          const tirage = (await api('POST', `/commerces/${AH}/tirages`, {}, bearer)).contenu
          assert.equal(tirage.code, undefined)
          horloge = new Date(horloge.getTime() + 24 * 3600 * 1000)
          const activation = await api('POST', `/commerces/${AH}/tirages/${tirage.tirageId}/activer`, undefined, bearer)
          assert.equal(activation.statut, 200, JSON.stringify(activation.contenu))
          code = activation.contenu.code
          assert.ok(code)
          const patchActivation = f.requetes.findLast((r) => r.table === 'tirages' && r.methode === 'PATCH')!
          assert.equal(patchActivation.params.get('donnees->remis'), 'is.null', 'activation : même garde que la remise')

          const verif = await api('GET', `/commerces/${AH}/caisse/gains/${code.toLowerCase()}`, undefined, CODE)
          assert.deepEqual([verif.statut, verif.contenu.gain.statut, verif.contenu.gain.lot, verif.contenu.gain.client.prenom], [200, 'utilisable', 'Nems offerts', 'Lina'])
          const lecture = f.requetes.findLast((r) => r.table === 'tirages' && r.methode === 'GET')!
          assert.equal(lecture.params.get('donnees->>code'), `eq.${code}`)

          // Deux caisses valident le même code au même instant : les deux lisent « utilisable », la base n'en laisse passer qu'une.
          const avant = f.requetes.filter((r) => r.table === 'tirages' && r.methode === 'PATCH').length
          f.barriere('PATCH', 'tirages')
          const remises = await Promise.all([1, 2].map(() => api('POST', `/commerces/${AH}/caisse/gains/${code}/remise`, undefined, CODE)))
          assert.deepEqual(remises.map((r) => r.statut).sort(), [200, 409])
          assert.match(remises.find((r) => r.statut === 409)!.contenu.erreur, /déjà remis/)
          const maj = f.requetes.filter((r) => r.table === 'tirages' && r.methode === 'PATCH').slice(avant)
          assert.equal(maj.length, 2)
          for (const r of maj) assert.equal(r.params.get('donnees->remis'), 'is.null', 'garde dans la requête elle-même')
          assert.equal(f.tables.tirages.length, 1)
          assert.equal((f.tables.tirages[0].donnees as Tirage).remis?.par.nom, 'Mai')
          // Une activation après la remise est refusée (409), rien n'est réécrit.
          assert.equal((await api('POST', `/commerces/${AH}/tirages/${tirage.tirageId}/activer`, undefined, bearer)).statut, 409)
        } finally {
          await app.fermer()
        }
      }
      // Redémarrage (Render qui se réveille) : le statut est en base, pas en mémoire.
      const { app, api } = await demarrer(f, { secretSession: SECRET })
      try {
        const r = await api('POST', `/commerces/${AH}/caisse/gains/${code}/remise`, undefined, CODE)
        assert.equal(r.statut, 409)
        assert.equal((await api('GET', `/commerces/${AH}/caisse/gains/${code}`, undefined, CODE)).contenu.gain.statut, 'remis')
      } finally {
        await app.fermer()
      }
    } finally {
      horloge = new Date(2026, 10, 9, 12, 0)
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
      assert.deepEqual(Object.keys((await api('GET', '/sante')).contenu.migrations), ['cartiz', 'programme', 'relances', 'mesure'], '/sante : 0005 / 0006 n’y figurent pas (P1-B3 ajoute `relances`, migration 0007 ; P2-Q3 `mesure`, 0008)')
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

  // ---------- P1-B3 : relances SMS / e-mail sous Supabase (table `envois`, migration 0007) ----------

  /** Twilio simulé (aucune vraie clé, aucun appel réseau) : compte les SMS « envoyés ». */
  function twilioSimule() {
    const sms: URLSearchParams[] = []
    const fetch = (async (_url: string, init: RequestInit) => {
      sms.push(new URLSearchParams(String(init.body)))
      return new Response(JSON.stringify({ sid: `SM${sms.length}` }), { status: 201 })
    }) as unknown as typeof globalThis.fetch
    return { sms, notifications: { twilio: { accountSid: 'ACtest', authToken: 'jeton-test', expediteur: '+33700000000' }, fetch } }
  }

  test('P1-B3 : chaque tentative tracée dans `envois` (501, 409, envoyé) ; anti-doublon tenu par l’index unique, même simultané', async () => {
    const f = fauxPostgrest()
    const tw = twilioSimule()
    const { app, api } = await demarrer(f, { notifications: tw.notifications })
    try {
      const avec = (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0612345678', consentementRelance: true }, PIN)).contenu.client as Client
      const sans = (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Marc', contact: '0698765432' }, PIN)).contenu.client as Client
      assert.equal((f.tables.clients.find((c) => c.id === avec.id)!.donnees as Client).consentementRelance, true)
      assert.equal((f.tables.clients.find((c) => c.id === sans.id)!.donnees as Client).consentementRelance, undefined)

      assert.equal((await api('POST', `/commerces/${AH}/clients/${avec.id}/relance`, { modele: 'bienvenue', canal: 'email' }, PIN)).statut, 501, 'Brevo non configuré')
      assert.equal((await api('POST', `/commerces/${AH}/clients/${sans.id}/relance`, { modele: 'bienvenue' }, PIN)).statut, 409, 'sans consentement')
      // Deux clics simultanés : la base n'accepte qu'une réservation (index unique partiel) → un seul SMS.
      f.barriere('POST', 'envois')
      const deux = await Promise.all([1, 2].map(() => api('POST', `/commerces/${AH}/clients/${avec.id}/relance`, { modele: 'bienvenue' }, PIN)))
      assert.deepEqual(deux.map((r) => r.statut).sort(), [200, 409])
      assert.match(deux.find((r) => r.statut === 409)!.contenu.erreur, /déjà été envoyée à ce client aujourd’hui/)
      assert.equal(tw.sms.length, 1)
      assert.ok(f.rejets.includes('envois:23505'))

      const lignes = f.tables.envois.map((l) => [l.client_id, l.modele, l.canal, l.statut])
      assert.deepEqual(lignes.sort(), [
        [avec.id, 'bienvenue', 'email', 'non_branche'],
        [avec.id, 'bienvenue', 'sms', 'envoye'],
        [avec.id, 'bienvenue', 'sms', 'refuse'],
        [sans.id, 'bienvenue', 'sms', 'refuse'],
      ].sort())
      assert.ok(f.tables.envois.every((l) => l.jour === '2026-11-09'))
      assert.doesNotMatch(JSON.stringify(f.tables.envois), /0612345678|0698765432|\+336/, 'jamais le contact dans le journal')
      const journal = (await api('GET', `/commerces/${AH}/envois`, undefined, PIN)).contenu
      assert.equal(journal.migration, true)
      assert.equal(journal.envois.length, 4)
      assert.equal((await api('GET', '/sante')).contenu.migrations.relances, true)
    } finally {
      await app.fermer()
    }
  })

  test('P1-B3 : production AVANT la migration 0007 — journal vide, refus répondus, AUCUN envoi réel (503), jamais de 500', async () => {
    const f = fauxPostgrest({ sans0007: true })
    const tw = twilioSimule()
    const { app, api } = await demarrer(f, { notifications: tw.notifications })
    try {
      const avec = (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0612345678', consentementRelance: true }, PIN)).contenu.client as Client
      const sans = (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Marc', contact: '0698765432' }, PIN)).contenu.client as Client
      assert.equal((await api('POST', `/commerces/${AH}/clients/${sans.id}/relance`, { modele: 'inactif' }, PIN)).statut, 409)
      const r = await api('POST', `/commerces/${AH}/clients/${avec.id}/relance`, { modele: 'inactif' }, PIN)
      assert.equal(r.statut, 503)
      assert.match(r.contenu.erreur, /0007_relances\.sql/)
      assert.equal(tw.sms.length, 0, 'rien ne part sans anti-doublon')
      assert.deepEqual((await api('GET', `/commerces/${AH}/envois`, undefined, PIN)).contenu, { envois: [], migration: false })
      const etat = await api('GET', `/commerces/${AH}/etat`, undefined, PIN)
      assert.equal(etat.statut, 200)
      assert.deepEqual(etat.contenu.envois, [])
      assert.equal((await api('GET', '/sante')).contenu.migrations.relances, false)
      // Le consentement, lui, est dans `clients.donnees` : modifiable sans la migration.
      assert.equal((await api('PATCH', `/commerces/${AH}/clients/${avec.id}`, { consentementRelance: false }, PIN)).statut, 200)
    } finally {
      await app.fermer()
    }
  })

  test('P1-B4 : jetons Google chiffrés dans `meta` (aucune migration), import dédupliqué, publication validée (Google simulé)', async () => {
    const f = fauxPostgrest()
    const secret = 'secret-client-google-de-test'
    const publies: string[] = []
    const google = (async (url: string, init: RequestInit = {}) => {
      const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } })
      if (url === 'https://oauth2.googleapis.com/token') return json({ access_token: 'at-sb', expires_in: 3599, refresh_token: 'rt-sb' })
      if (url.includes('/reviews?')) {
        return json({
          reviews: [
            { name: 'accounts/1/locations/2/reviews/a', starRating: 'FOUR', comment: 'Bien', reviewer: { displayName: 'Léa' }, createTime: '2026-11-01T12:00:00Z' },
            { name: 'accounts/1/locations/2/reviews/b', starRating: 'FIVE', comment: 'Top', reviewer: { displayName: 'Tom' }, createTime: '2026-11-02T12:00:00Z' },
          ],
        })
      }
      if (url.endsWith('/reply') && init.method === 'PUT') {
        publies.push(url)
        return json({})
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch
    const { app, api } = await demarrer(f, { googleBusiness: { clientId: 'id', clientSecret: secret, emplacement: 'accounts/1/locations/2', fetch: google } })
    try {
      const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
      const url = new URL((await api('GET', `/commerces/${AH}/google/auth?format=json`, undefined, PIN)).contenu.url)
      const retour = await fetch(`${base}/commerces/${AH}/google/callback?code=c&state=${encodeURIComponent(url.searchParams.get('state')!)}`, { redirect: 'manual' })
      assert.equal(retour.status, 302)
      const ligne = f.tables.meta.find((m) => m.cle === `google_business:${AH}`)!
      assert.ok(String(ligne.valeur).startsWith('v1.') && !String(ligne.valeur).includes('rt-sb'), 'chiffré en base')

      for (let i = 0; i < 2; i++) assert.equal((await api('POST', `/commerces/${AH}/google/import-avis`, undefined, PIN)).statut, 200)
      const avis = (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.avis as { id: string; note: number; source: string; brouillon?: string }[]
      assert.equal(avis.length, 2, 'deux imports, aucun doublon')
      assert.ok(avis.every((a) => a.source === 'google'))
      const quatre = avis.find((a) => a.note === 4)!
      assert.equal((await api('POST', `/commerces/${AH}/avis/${quatre.id}/publier-reponse`, undefined, PIN)).statut, 409)
      await api('PATCH', `/commerces/${AH}/avis/${quatre.id}`, { reponse: 'Merci Léa !' }, PIN)
      assert.equal((await api('POST', `/commerces/${AH}/avis/${quatre.id}/publier-reponse`, undefined, PIN)).statut, 200)
      assert.deepEqual(publies, ['https://mybusiness.googleapis.com/v4/accounts/1/locations/2/reviews/a/reply'], '5★ d’avant la connexion : pas publiée d’office')
    } finally {
      await app.fermer()
    }
  })

  test('P1-B5 : logo téléversé rangé dans `meta` (aucune migration), relu après redémarrage, supprimé par « logo par défaut »', async () => {
    const f = fauxPostgrest()
    const png = readFileSync(join(import.meta.dirname, '..', 'public', 'visuels', 'logo.png'))
    const a = await demarrer(f)
    let adresse: string
    try {
      const base = `http://127.0.0.1:${(a.app.serveur.address() as AddressInfo).port}/api/v1`
      const r = await fetch(`${base}/commerces/${AH}/logo`, { method: 'PUT', headers: { 'Content-Type': 'image/png', ...PIN }, body: png })
      assert.equal(r.status, 200)
      adresse = ((await r.json()) as { commerce: Commerce }).commerce.logo!
      const ligne = f.tables.meta.find((m) => m.cle === `logo:${AH}`)!
      assert.equal(JSON.parse(String(ligne.valeur)).type, 'image/png')
      assert.equal((f.tables.commerces.find((c) => c.id === AH)!.donnees as Commerce).logo, adresse, 'le JSONB du commerce ne garde que l’adresse')
      assert.ok(String(JSON.stringify(f.tables.commerces)).length < 20_000, 'pas d’image dans la ligne commerce')
    } finally {
      await a.app.fermer()
    }
    const b = await demarrer(f)
    try {
      const base = `http://127.0.0.1:${(b.app.serveur.address() as AddressInfo).port}`
      const img = await fetch(base + adresse)
      assert.equal(img.status, 200)
      assert.ok(Buffer.from(await img.arrayBuffer()).equals(png))
      assert.equal((await b.api('DELETE', `/commerces/${AH}/logo`, undefined, PIN)).statut, 200)
      assert.equal(f.tables.meta.find((m) => m.cle === `logo:${AH}`)!.valeur, '')
      assert.equal((await fetch(base + adresse)).status, 404)
    } finally {
      await b.app.fermer()
    }
  })

  test('suppression d’un client : cascade dans chaque table (journal filtré sur donnees->>clientId), autres clients intacts', async () => {
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      const bob = (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Bob', contact: '0611111111' }, PIN)).contenu.client as Client
      const alice = (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Alice', contact: '0622222222', parrain: bob.codeParrainage }, PIN)).contenu.client as Client
      for (const c of [bob, alice]) assert.equal((await api('POST', `/commerces/${AH}/clients/${c.id}/visite`, undefined, PIN)).statut, 200)
      assert.equal((await api('POST', `/commerces/${AH}/tirages`, { contact: '0611111111' })).statut, 201)
      assert.equal((await api('POST', `/commerces/${AH}/tirages`, { contact: '0622222222' })).statut, 201)
      assert.equal((await api('POST', `/commerces/${AH}/clients/${bob.id}/relance`, { modele: 'inactif' }, PIN)).statut, 501)
      const deBob = () => ({
        tirages: f.tables.tirages.filter((l) => l.client_id === bob.id).length,
        journal: f.tables.journal.filter((l) => (l.donnees as { clientId?: string }).clientId === bob.id).length,
        parrainages: f.tables.parrainages.filter((l) => l.parrain_id === bob.id || l.filleul_id === bob.id).length,
        envois: f.tables.envois.filter((l) => l.client_id === bob.id).length,
      })
      const avant = deBob()
      for (const [k, n] of Object.entries(avant)) assert.ok(n > 0, k)
      const r = await api('DELETE', `/commerces/${AH}/clients/${bob.id}`, { confirmation: 'SUPPRIMER' }, PIN)
      assert.equal(r.statut, 200, JSON.stringify(r.contenu))
      assert.deepEqual(r.contenu.bilan, { ...avant, rattrapages: 0, client: true })
      assert.deepEqual(deBob(), { tirages: 0, journal: 0, parrainages: 0, envois: 0 })
      assert.equal(f.tables.clients.some((l) => l.id === bob.id), false)
      const restante = f.tables.clients.find((l) => l.id === alice.id)!.donnees as Client
      assert.equal(restante.parrainId, undefined, 'le filleul ne pointe plus vers la carte supprimée')
      assert.equal(f.tables.tirages.filter((l) => l.client_id === alice.id).length, 1)
      const journal = f.tables.journal.find((l) => /Client supprimé/.test(String((l.donnees as { details: string }).details)))!
      assert.ok(journal && !JSON.stringify(journal).includes('Bob'))
      const del = f.requetes.find((q) => q.methode === 'DELETE' && q.table === 'journal')!
      assert.equal(del.params.get('donnees->>clientId'), `eq.${bob.id}`)
      assert.equal((await api('GET', `/cartes/${bob.id}`)).statut, 404)
    } finally {
      await app.fermer()
    }
  })

  test('P2-Q3 : compteurs anonymes via la fonction incrementer_evenement (0008) — aucune identité, lecture paginée', async () => {
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      const lots = [{ libelle: 'Nems offerts', probabilite: 100, coutCentimes: 150 }, { libelle: 'Dommage !', probabilite: 0 }]
      assert.equal((await api('PATCH', `/commerces/${AH}`, { lots }, PIN)).statut, 200)
      const ins = await api('POST', `/commerces/${AH}/clients`, { contact: '06 12 34 56 78' })
      await api('POST', `/commerces/${AH}/clients/${ins.contenu.client.id}/visite`, undefined, PIN)
      assert.equal((await api('POST', `/commerces/${AH}/tirages`, { contact: '0612345678' })).statut, 201)
      for (const type of ['scan', 'scan', 'clicGoogle']) assert.equal((await api('POST', `/commerces/${AH}/evenements`, { type })).contenu.compte, true)
      const jour = '2026-11-09'
      const n = (type: string) => f.tables.evenements_jour.find((l) => l.jour === jour && l.type === type)?.n
      assert.deepEqual([n('scan'), n('tirage'), n('gain'), n('clicGoogle')], [2, 1, 1, 1])
      for (const l of f.tables.evenements_jour) assert.deepEqual(Object.keys(l).sort(), ['commerce_id', 'jour', 'n', 'type'], 'aucune colonne d’identité')
      const appels = f.requetes.filter((r) => r.table === 'rpc')
      assert.equal(appels.length, 5)
      for (const a of appels) assert.deepEqual(Object.keys(a.corps as object).sort(), ['p_commerce_id', 'p_jour', 'p_type'])
      assert.ok(!JSON.stringify(appels.map((a) => a.corps)).includes('0612345678'))

      // 400 jours × 4 types = 1 600 lignes > 1 000 (plafond PostgREST) : lecture en 2 pages, rien de perdu.
      f.tables.evenements_jour.length = 0
      const debut = new Date('2025-10-06T00:00:00Z')
      for (let i = 0; i < 400; i++) {
        const j = new Date(debut.getTime() + i * 86_400_000).toISOString().slice(0, 10)
        for (const type of ['scan', 'tirage', 'gain', 'clicGoogle']) f.tables.evenements_jour.push({ commerce_id: AH, jour: j, type, n: 1 })
      }
      const m = await api('GET', `/commerces/${AH}/mesures`, undefined, PIN)
      assert.equal(m.statut, 200)
      assert.equal(m.contenu.migration, true)
      assert.equal(m.contenu.compteurs.length, 1600)
      assert.deepEqual(m.contenu.compteurs[0], { jour: '2025-10-06', type: 'clicGoogle', n: 1 })
      const lectures = f.requetes.filter((r) => r.table === 'evenements_jour' && r.methode === 'GET' && r.params.get('select') === 'jour,type,n')
      assert.deepEqual(lectures.map((r) => r.params.get('offset')), ['0', '1000'])
      assert.equal((await api('GET', `/commerces/${AH}/mesures`)).statut, 401, 'gérant seulement')
      assert.equal((await api('GET', '/sante')).contenu.migrations.mesure, true)
    } finally {
      await app.fermer()
    }
  })

  test('P2-Q3 : production AVANT la migration 0008 — tirage inchangé, événements ignorés (202), mesures vides, jamais de 500', async () => {
    const f = fauxPostgrest({ sans0008: true })
    const { app, api } = await demarrer(f)
    try {
      const ins = await api('POST', `/commerces/${AH}/clients`, { contact: '06 12 34 56 78' })
      await api('POST', `/commerces/${AH}/clients/${ins.contenu.client.id}/visite`, undefined, PIN)
      const jeu = await api('POST', `/commerces/${AH}/tirages`, { contact: '0612345678' })
      assert.equal(jeu.statut, 201, 'le tirage ne dépend pas de la mesure')
      assert.equal(f.tables.tirages.length, 1)
      const e = await api('POST', `/commerces/${AH}/evenements`, { type: 'scan' })
      assert.deepEqual([e.statut, e.contenu.compte], [202, false])
      const m = await api('GET', `/commerces/${AH}/mesures`, undefined, PIN)
      assert.deepEqual([m.statut, m.contenu.migration, m.contenu.compteurs], [200, false, []])
      assert.equal((await api('GET', '/sante')).contenu.migrations.mesure, false)
      assert.equal((await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).statut, 200)
    } finally {
      await app.fermer()
    }
  })

  test('sans la migration 0007 : suppression quand même (table absente = rien à supprimer), jamais de 500', async () => {
    // Mis à jour par P0-S11 : ce test tournait aussi sans 0003 / 0004, mais le serveur refuse désormais de démarrer en
    // Supabase sans elles (journal et traces du programme jamais perdus en silence). Seule l'absence de la 0007 (envois,
    // que la suppression lit sans les écrire) reste un état de démarrage possible.
    const f = fauxPostgrest({ sans0007: true })
    const { app, api } = await demarrer(f)
    try {
      const c = (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0612345678' }, PIN)).contenu.client as Client
      const r = await api('DELETE', `/commerces/${AH}/clients/${c.id}`, { confirmation: 'SUPPRIMER' }, PIN)
      assert.equal(r.statut, 200, JSON.stringify(r.contenu))
      assert.deepEqual(r.contenu.bilan, { client: true, tirages: 0, journal: 0, parrainages: 0, rattrapages: 0, envois: 0 })
      assert.equal(f.tables.clients.length, 0)
      assert.equal((await api('GET', `/commerces/${AH}/purge`, undefined, PIN)).statut, 200)
    } finally {
      await app.fermer()
    }
  })
})

// ---------- P0-S18 : pagination serveur Supabase (plafond PostgREST de 1 000 lignes) ----------

describe('P0-S18 : pagination serveur Supabase (plafond PostgREST de 1 000 lignes)', () => {
  const commerce: Commerce = { ...nouveauCommerce('Chez Lin', 'restaurant', ''), id: 'c-chez-lin' }
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-s18-'))
  after(() => rmSync(dossier, { recursive: true, force: true }))
  const horloge = new Date(2026, 10, 9, 12, 0)

  // Serveur HTTP sur le faux PostgREST (copie locale du `demarrer` du describe serveur, qui lui est local).
  async function demarrer(f: ReturnType<typeof fauxPostgrest>) {
    const app = await creerServeur({
      fichierDb: join(dossier, 'ne-doit-pas-exister.db'),
      supabase: { url: URL_SB, cleServiceRole: CLE, fetch: f.fetch },
      adminPin: ADMIN,
      pinInitial: '1234',
      version: 'test',
      maintenant: () => horloge,
    })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
    async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
      const r = await fetch(base + chemin, { method: methode, headers: { 'Content-Type': 'application/json', ...entetes }, body: corps === undefined ? undefined : JSON.stringify(corps) })
      return { statut: r.status, contenu: await r.json() }
    }
    return { app, api }
  }

  /** `n` clients / tirages / avis semés directement dans les tables du faux PostgREST (la lecture, elle, passe par
   * le client officiel). Lignes complètes, comme un POST les écrirait (ordre, version) ; chaque client a 1 visite. */
  function semer(f: ReturnType<typeof fauxPostgrest>, n: number, commerceId: string) {
    for (let i = 0; i < n; i++) {
      const id = `cl-s18-${String(i).padStart(4, '0')}`
      const date = new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString()
      const c = { ...nouveauClient(commerceId, `Client ${String(i).padStart(4, '0')}`, { telephone: `06${String(10000000 + i)}` }), id, visites: [date], derniereVisite: date }
      f.tables.clients.push({ id, commerce_id: commerceId, cle_contact: cleContact(c), donnees: c, ordre: i + 1, version: 1 })
      const t: Tirage = { id: `ti-s18-${i}`, commerceId, clientId: id, lot: 'Nems', date }
      f.tables.tirages.push({ id: t.id, commerce_id: commerceId, client_id: id, date, donnees: t })
      const avis = { id: `av-s18-${i}`, commerceId, auteur: `Client ${i}`, note: 5, texte: 'Top', date }
      f.tables.avis.push({ id: avis.id, commerce_id: commerceId, date, donnees: avis, version: 1 })
    }
  }

  test('clients, tirages et avis lus en entier au-delà du plafond (1 200 lignes, pages de 1 000)', async () => {
    const f = fauxPostgrest()
    const st = ouvrir(f)
    await st.ajouterCommerce(commerce, { hash: 'h', sel: 's' })
    semer(f, 1200, commerce.id)
    const clients = await st.clients(commerce.id)
    assert.equal(clients.length, 1200)
    assert.equal(clients.at(-1)?.prenom, 'Client 1199')
    assert.equal((await st.tirages(commerce.id)).length, 1200)
    assert.equal((await st.avis(commerce.id)).length, 1200)
    // Preuve que la lecture a bien paginé : sans `.range()`, le faux renverrait tout (pas de plafond simulé)
    // et ce test passerait à tort — les offsets prouvent les deux pages.
    for (const table of ['clients', 'tirages', 'avis']) {
      const lectures = f.requetes.filter((r) => r.table === table && r.methode === 'GET')
      assert.deepEqual(lectures.map((r) => r.params.get('offset')), ['0', '1000'], table)
      assert.ok(lectures.every((r) => r.params.get('limit') === '1000'), table)
    }
  })

  test('tirages d’un seul client : lus en entier au-delà du plafond (1 050 tirages, ordre stable)', async () => {
    const f = fauxPostgrest()
    const st = ouvrir(f)
    await st.ajouterCommerce(commerce, { hash: 'h', sel: 's' })
    const c = { ...nouveauClient(commerce.id, 'Fidèle', { telephone: '0612345678' }), id: 'cl-s18-fidele' }
    f.tables.clients.push({ id: c.id, commerce_id: commerce.id, cle_contact: cleContact(c), donnees: c, ordre: 1, version: 1 })
    // Lignes semées dans l'ordre inverse de leur date : sans le tri par date, le faux renverrait l'ordre
    // d'insertion et le test échouerait (revue Codex point 3).
    for (let i = 1049; i >= 0; i--) {
      const date = new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString()
      const t: Tirage = { id: `ti-f-${i}`, commerceId: commerce.id, clientId: c.id, lot: 'Nems', date }
      f.tables.tirages.push({ id: t.id, commerce_id: commerce.id, client_id: c.id, date, donnees: t })
    }
    const lus = await st.tiragesClient(commerce.id, c.id)
    assert.equal(lus.length, 1050)
    assert.deepEqual(
      lus.map((t) => t.id),
      Array.from({ length: 1050 }, (_, i) => `ti-f-${i}`),
      'séquence complète, triée par date croissante (pas seulement les extrémités)',
    )
    assert.deepEqual(
      f.requetes.filter((r) => r.table === 'tirages' && r.methode === 'GET').map((r) => r.params.get('offset')),
      ['0', '1000'],
    )
  })

  test('dates identiques à la frontière des pages : aucune ligne perdue ni lue deux fois (1 001 tirages, même date)', async () => {
    const f = fauxPostgrest()
    const st = ouvrir(f)
    await st.ajouterCommerce(commerce, { hash: 'h', sel: 's' })
    // 1 001 clients, un tirage chacun, tous à la même milliseconde, semés dans l'ordre inverse des ids : sans le
    // départage par `id`, l'ordre des lignes de même date à cheval sur la frontière n'est pas garanti d'une
    // requête à l'autre (le tri Postgres n'est pas stable) — le test échouerait. Ids à 4 chiffres pour que l'ordre
    // lexicographique soit l'ordre numérique.
    const date = '2026-11-08T12:00:00.000Z'
    for (let i = 1000; i >= 0; i--) {
      const id = String(i).padStart(4, '0')
      const c = { ...nouveauClient(commerce.id, `Client ${i}`, { telephone: `06${10000000 + i}` }), id: `cl-eg-${id}` }
      f.tables.clients.push({ id: c.id, commerce_id: commerce.id, cle_contact: cleContact(c), donnees: c, ordre: i + 1, version: 1 })
      const t: Tirage = { id: `ti-eg-${id}`, commerceId: commerce.id, clientId: c.id, lot: 'Nems', date }
      f.tables.tirages.push({ id: t.id, commerce_id: commerce.id, client_id: c.id, date, donnees: t })
    }
    const lus = await st.tirages(commerce.id)
    assert.equal(lus.length, 1001)
    assert.equal(new Set(lus.map((t) => t.id)).size, 1001, 'aucun doublon')
    assert.deepEqual(
      lus.map((t) => t.id),
      Array.from({ length: 1001 }, (_, i) => `ti-eg-${String(i).padStart(4, '0')}`),
      'départage par id croissant',
    )
    assert.deepEqual(
      f.requetes.filter((r) => r.table === 'tirages' && r.methode === 'GET').map((r) => r.params.get('offset')),
      ['0', '1000'],
    )
  })

  test('/etat, statistiques et export CSV complets au-delà du plafond (1 050 clients)', async () => {
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      semer(f, 1050, AH)
      const etat = await api('GET', `/commerces/${AH}/etat`, undefined, PIN)
      assert.equal(etat.statut, 200)
      assert.equal(etat.contenu.clients.length, 1050)
      assert.equal(etat.contenu.tirages.length, 1050)
      // Statistiques (TableauDeBord, src/lib/stats.ts) calculées sur la liste complète, pas sur 1 000 lignes.
      const cartes = calculerChiffresCartes(etat.contenu.clients)
      assert.equal(cartes.cartesEmises, 1050)
      assert.equal(cartes.passagesTotal, 1050)
      // Export CSV : une ligne par client, y compris le 1 050e.
      const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
      const csv = await fetch(`${base}/commerces/${AH}/export.csv`, { headers: PIN })
      assert.equal(csv.status, 200)
      const texte = await csv.text()
      assert.equal(texte.split('\r\n').filter(Boolean).length, 1051, 'en-tête + 1 050 clients')
      assert.ok(texte.includes('Client 1049'), 'le dernier client est dans l’export')
    } finally {
      await app.fermer()
    }
  })
})

// ---------- Persistance des compteurs publics (P0-S20) ----------

describe('P0-S20 : compteurs publics persistants (Supabase)', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p0s20-'))
  after(() => rmSync(dossier, { recursive: true, force: true }))
  const maintenant = new Date(2026, 10, 9, 12, 0)
  const iso = (d: Date) => d.toISOString()
  const DEBUT = iso(maintenant)

  /** Serveur HTTP sur le faux PostgREST `f`, horloge pilotée, seuil de lecture par carte = 3 (seuil de persistance : 2). */
  async function demarrerSb(f: ReturnType<typeof fauxPostgrest>, horloge: { t: Date }, transport?: typeof fetch) {
    const app = await creerServeur({
      fichierDb: join(dossier, 'ne-doit-pas-exister.db'),
      supabase: { url: URL_SB, cleServiceRole: CLE, fetch: transport ?? f.fetch },
      adminPin: ADMIN,
      pinInitial: '1234',
      version: 'test',
      maintenant: () => horloge.t,
      limitesPubliques: { lectureParCarte: 3 },
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

  test('stockage : upsert + lecture + purge des fenêtres passées, clé seule (identifiant, sans contenu client)', async () => {
    const f = fauxPostgrest()
    const st = ouvrir(f)
    assert.equal(await st.schemaCompteursPublics(), true)
    assert.deepEqual(await st.compteursPublics(), [])
    await st.enregistrerCompteurPublic({ cle: 'lecture:203.0.113.7', debut: DEBUT, n: 60 }, iso(new Date(maintenant.getTime() - 60_000)))
    await st.enregistrerCompteurPublic({ cle: 'carte:cl-abc', debut: DEBUT, n: 15 }, iso(new Date(maintenant.getTime() - 60_000)))
    assert.deepEqual(await st.compteursPublics(), [
      { cle: 'carte:cl-abc', debut: DEBUT, n: 15 },
      { cle: 'lecture:203.0.113.7', debut: DEBUT, n: 60 },
    ], 'lecture triée par clé (ordre déterministe de la pagination)')
    // Upsert : même clé, nouvelle fenêtre, nouveau nombre — une seule ligne.
    await st.enregistrerCompteurPublic({ cle: 'carte:cl-abc', debut: iso(new Date(maintenant.getTime() + 60_000)), n: 1 }, iso(new Date(maintenant.getTime() - 60_000)))
    assert.equal((await st.compteursPublics()).length, 2)
    assert.equal(f.tables.compteurs_publics.find((l) => l.cle === 'carte:cl-abc')!.n, 1)
    for (const l of f.tables.compteurs_publics) assert.deepEqual(Object.keys(l).sort(), ['cle', 'debut', 'n'], 'ni nom, ni code gagnant, ni contenu client — la clé seule (identifiant déjà utilisé par l’anti-bruteforce)')
    // Purge : une écriture supprime les lignes dont la fenêtre est passée (début < purgerAvant).
    await st.enregistrerCompteurPublic({ cle: 'lecture:203.0.113.8', debut: iso(new Date(maintenant.getTime() + 120_000)), n: 1 }, iso(new Date(maintenant.getTime() + 60_000)))
    assert.deepEqual(
      (await st.compteursPublics()).map((l) => l.cle).sort(),
      ['carte:cl-abc', 'lecture:203.0.113.8'],
      'la fenêtre de 12:00 est purgée, celles de 12:01 et 12:02 gardées',
    )
  })

  test('stockage : lecture paginée au-delà du plafond PostgREST (1 000 lignes)', async () => {
    const f = fauxPostgrest()
    const st = ouvrir(f)
    // 1 001 lignes, insérées dans l'ordre inverse du tri : la lecture doit toutes les rendre, triées par clé.
    for (let i = 1000; i >= 0; i--) {
      f.tables.compteurs_publics.push({ cle: `carte:cl-${String(i).padStart(4, '0')}`, debut: DEBUT, n: 1 })
    }
    const lignes = await st.compteursPublics()
    assert.equal(lignes.length, 1001, 'sans pagination, la 1 001e ligne serait perdue (plafond PostgREST)')
    assert.deepEqual(lignes.map((l) => l.cle), lignes.map((l) => l.cle).sort(), 'tri déterministe par clé (pages stables)')
    assert.equal(lignes.at(-1)!.cle, 'carte:cl-1000')
  })

  test('stockage sans la migration 0010 : lecture vide, écriture refusée, repli mémoire', async () => {
    const f = fauxPostgrest({ sans0010: true })
    const st = ouvrir(f)
    assert.equal(await st.schemaCompteursPublics(), false)
    assert.deepEqual(await st.compteursPublics(), [])
    await assert.rejects(st.enregistrerCompteurPublic({ cle: 'lecture:1.2.3.4', debut: DEBUT, n: 1 }, DEBUT), (e: Error) => e instanceof ErreurMigrationManquante && /0010_compteurs_publics/.test(e.message))
  })

  test('HTTP : compteur chaud survit au redémarrage, blocage aussi ; sans migration, mémoire seulement', async () => {
    const f = fauxPostgrest()
    const horloge = { t: new Date(2026, 10, 9, 12, 0) }
    let srv = await demarrerSb(f, horloge)
    let clientId: string
    try {
      const c = (await srv.api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0612345678' }, PIN)).contenu.client as Client
      clientId = c.id
      assert.equal((await srv.api('GET', `/cartes/${clientId}`)).statut, 200)
      assert.equal((await srv.api('GET', `/cartes/${clientId}`)).statut, 200)
      // 2 lectures = moitié du seuil (3) → persisté ; on laisse l'écriture arriver avant le redémarrage.
      await new Promise((r) => setTimeout(r, 50))
      assert.deepEqual(f.tables.compteurs_publics.map((l) => [l.cle, l.n]), [[`carte:${clientId}`, 2]])
    } finally {
      await srv.app.fermer()
    }
    srv = await demarrerSb(f, horloge)
    try {
      assert.equal((await srv.api('GET', `/cartes/${clientId}`)).statut, 200, '3e lecture de la fenêtre : rechargée depuis la base')
      assert.equal((await srv.api('GET', `/cartes/${clientId}`)).statut, 429, '4e lecture : toujours bloquée après redémarrage')
      assert.equal((await srv.api('GET', `/cartes/${clientId}`)).statut, 429, 'blocage rechargé : immédiat après redémarrage')
    } finally {
      await srv.app.fermer()
    }

    // Sans la migration : le serveur démarre quand même, compte en mémoire, et perd tout au redémarrage.
    // L'absence de la table est avertie DÈS le démarrage (revue Codex point 6), pas au premier compteur chaud.
    const g = fauxPostgrest({ sans0010: true })
    const alertes: string[] = []
    const warnOrigine = console.warn
    console.warn = (...a: unknown[]) => {
      alertes.push(a.map(String).join(' '))
    }
    let srvG: Awaited<ReturnType<typeof demarrerSb>>
    try {
      srvG = await demarrerSb(g, horloge)
    } finally {
      console.warn = warnOrigine
    }
    assert.ok(
      alertes.some((m) => /compteurs publics comptés en mémoire seulement/.test(m)),
      `avertissement de démarrage attendu, reçu : ${JSON.stringify(alertes)}`,
    )
    try {
      const c = (await srvG.api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0612345678' }, PIN)).contenu.client as Client
      clientId = c.id
      assert.equal((await srvG.api('GET', `/cartes/${clientId}`)).statut, 200)
      assert.equal((await srvG.api('GET', `/cartes/${clientId}`)).statut, 200)
    } finally {
      await srvG.app.fermer()
    }
    srvG = await demarrerSb(g, horloge)
    try {
      for (let i = 0; i < 3; i++) assert.equal((await srvG.api('GET', `/cartes/${clientId}`)).statut, 200, 'compteur perdu au redémarrage : 3 lectures passent à nouveau')
      assert.equal((await srvG.api('GET', `/cartes/${clientId}`)).statut, 429)
    } finally {
      await srvG.app.fermer()
    }
  })

  test('HTTP : une écriture ancienne retardée ne peut pas annuler un blocage récent (sérialisation par clé)', async () => {
    const f = fauxPostgrest()
    const horloge = { t: new Date(2026, 10, 9, 12, 0) }
    // Le 1er upsert (n = 2) est retardé de 150 ms, le 2e (n = 3) passe immédiatement : sans sérialisation par clé,
    // l'ancienne écriture arriverait après et la base finirait à n = 2 (revue Codex point 4).
    let retarderPremierUpsert = true
    const transport: typeof fetch = async (url, init) => {
      if (retarderPremierUpsert && String(url).includes('/rest/v1/compteurs_publics') && init?.method === 'POST') {
        retarderPremierUpsert = false
        await new Promise((r) => setTimeout(r, 150))
      }
      return f.fetch(url, init)
    }
    const srv = await demarrerSb(f, horloge, transport)
    try {
      const c = (await srv.api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0612345678' }, PIN)).contenu.client as Client
      assert.equal((await srv.api('GET', `/cartes/${c.id}`)).statut, 200)
      assert.equal((await srv.api('GET', `/cartes/${c.id}`)).statut, 200)
      assert.equal((await srv.api('GET', `/cartes/${c.id}`)).statut, 200)
      await new Promise((r) => setTimeout(r, 300))
      assert.deepEqual(f.tables.compteurs_publics.map((l) => [l.cle, l.n]), [[`carte:${c.id}`, 3]], 'l’écriture n = 3, partie après, est bien la dernière appliquée')
    } finally {
      await srv.app.fermer()
    }
  })
})

// ---------- Secrets et configuration ----------

describe('Revue Codex R2 : tirages de la roue sous Supabase (plafonds sous concurrence, crédit exactement-une-fois)', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-r2-revue-'))
  after(() => rmSync(dossier, { recursive: true, force: true }))
  let hasard = 0
  let ip = 0
  const LOTS = [
    { id: 'lot-rare', type: 'lot', libelle: 'Menu offert', probabilite: 50, plafondJour: 1 },
    { id: 'lot-pts', type: 'points', points: 10, libelle: '+10 points', probabilite: 50 },
  ]
  /** Lecture des compteurs de plafond (`tiragesDepuis` : date >= début du jour) — la seule lecture DANS le verrou. */
  const lecturePlafonds = (methode: string, table: string, params: URLSearchParams) => methode === 'GET' && table === 'tirages' && (params.get('date') ?? '').startsWith('gte.')

  // Serveur HTTP sur le faux PostgREST, accès libre et lots plafonnés ; hasard du tirage injecté ; une IP par requête.
  async function demarrer(f: ReturnType<typeof fauxPostgrest>) {
    const app = await creerServeur({
      fichierDb: join(dossier, 'ne-doit-pas-exister.db'),
      supabase: { url: URL_SB, cleServiceRole: CLE, fetch: f.fetch },
      adminPin: ADMIN,
      pinInitial: '1234',
      version: 'test',
      maintenant: () => new Date(2026, 10, 10, 12),
      alea: () => hasard,
      derriereProxy: true,
    })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
    async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
      const r = await fetch(base + chemin, {
        method: methode,
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.9.0.${++ip % 250}`, ...entetes },
        body: corps === undefined ? undefined : JSON.stringify(corps),
      })
      return { statut: r.status, contenu: await r.json() }
    }
    const r = await api('PATCH', `/commerces/${AH}`, { modeAccesRoue: 'libre', limiteGainsMois: 0, lots: LOTS }, PIN)
    assert.equal(r.statut, 200, JSON.stringify(r.contenu))
    return { app, api }
  }
  const tiragesDe = (f: ReturnType<typeof fauxPostgrest>, filtre: (t: Tirage) => boolean) => f.tables.tirages.map((l) => l.donnees as Tirage).filter(filtre)
  const pointsDe = (f: ReturnType<typeof fauxPostgrest>, id: string) => soldePoints(f.tables.clients.find((l) => l.id === id)!.donnees as Client)

  test('F1 : deux clients tirent au même instant un lot à plafond 1 (stockage lent) → un seul gagnant de ce lot', async () => {
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      hasard = 0 // les deux tombent sur le lot rare… s'ils lisent tous deux « 0 sortie »
      // Les deux requêtes passent ensemble la lecture de leurs tirages (barrière), puis la lecture des compteurs de
      // plafond est lente : sans sérialisation, les deux lisent « 0 sortie » avant qu'aucune n'écrive.
      f.barriere('GET', 'tirages')
      f.ralentir({ ms: 40, vise: lecturePlafonds })
      const r = await Promise.all(['0611111111', '0622222222'].map((contact) => api('POST', `/commerces/${AH}/tirages`, { contact })))
      assert.deepEqual(r.map((x) => x.statut), [201, 201], JSON.stringify(r.map((x) => x.contenu)))
      assert.deepEqual(r.map((x) => x.contenu.lotId).sort(), ['lot-pts', 'lot-rare'], 'le 2e est servi en consolation')
      assert.equal(tiragesDe(f, (t) => t.lotId === 'lot-rare').length, 1, 'plafond 1 : au plus 1 gagnant')
      assert.equal(f.requetes.filter((q) => lecturePlafonds(q.methode, q.table, q.params)).length, 2, 'les deux tirages ont bien compté les plafonds')
    } finally {
      f.ralentir()
      await app.fermer()
    }
  })

  test('F1 : même client, trois appels simultanés (stockage lent) → 201 + 409 + 409, un seul tirage, points crédités une fois', async () => {
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      const client = (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0633333333' }, PIN)).contenu.client as Client
      const avant = pointsDe(f, client.id)
      hasard = 0.99 // consolation en points
      f.barriere('GET', 'tirages', 3)
      f.ralentir({ ms: 40, vise: lecturePlafonds })
      const r = await Promise.all([1, 2, 3].map(() => api('POST', `/commerces/${AH}/tirages`, { contact: '0633333333' })))
      assert.deepEqual(r.map((x) => x.statut).sort(), [201, 409, 409])
      assert.equal(tiragesDe(f, (t) => t.clientId === client.id).length, 1)
      assert.equal(pointsDe(f, client.id), avant + 10, 'crédité exactement une fois')
      assert.ok(f.rejets.includes('tirages:23505'), 'l’index unique client + jour a tranché')
    } finally {
      f.ralentir()
      await app.fermer()
    }
  })

  test('F1 : un commerce n’attend pas les tirages d’un autre (verrou par commerce)', async () => {
    const { creerFileParCle } = await import('../server/file-par-cle.ts')
    const file = creerFileParCle()
    const ordre: string[] = []
    let libererA!: () => void
    const a = file('c-a', () => new Promise<void>((ok) => (libererA = () => ok(void ordre.push('a1')))))
    const a2 = file('c-a', async () => void ordre.push('a2'))
    await file('c-b', async () => void ordre.push('b')) // n'attend pas c-a, toujours bloqué
    assert.deepEqual(ordre, ['b'])
    libererA()
    await Promise.all([a, a2])
    assert.deepEqual(ordre, ['b', 'a1', 'a2'], 'même commerce : un par un, dans l’ordre d’arrivée')
    // Une section en échec ne bloque pas la suivante.
    await assert.rejects(file('c-a', async () => Promise.reject(new Error('boum'))), /boum/)
    assert.equal(await file('c-a', async () => 42), 42)
  })

  test('F2 : crédit des points en échec après l’insertion → 500 lisible, tirage supprimé, nouveau tirage crédité une fois', async (t) => {
    const avertissements = t.mock.method(console, 'warn', () => {})
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      const client = (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0644444444' }, PIN)).contenu.client as Client
      const avant = pointsDe(f, client.id)
      hasard = 0.99 // consolation en points
      f.echouer('PATCH', 'clients') // le crédit échoue une fois
      const r1 = await api('POST', `/commerces/${AH}/tirages`, { contact: '0644444444' })
      assert.equal(r1.statut, 500, 'pas 502–504 : le front les afficherait « hors ligne »')
      assert.match(r1.contenu.erreur, /points n’ont pas pu être crédités.*tirage est annulé.*retenter/)
      assert.ok(f.rejets.includes('clients:echec-PATCH'))
      assert.equal(tiragesDe(f, (x) => x.clientId === client.id).length, 0, 'aucun tirage résiduel')
      assert.equal(pointsDe(f, client.id), avant, 'aucun point crédité')
      assert.ok(avertissements.mock.calls.some((c) => /tirage annulé/.test(String(c.arguments[0]))))
      const r2 = await api('POST', `/commerces/${AH}/tirages`, { contact: '0644444444' })
      assert.equal(r2.statut, 201, JSON.stringify(r2.contenu))
      assert.deepEqual([r2.contenu.points, r2.contenu.solde], [10, avant + 10])
      assert.equal(tiragesDe(f, (x) => x.clientId === client.id).length, 1)
      assert.equal(pointsDe(f, client.id), avant + 10, 'crédité exactement une fois')
      assert.equal((await api('POST', `/commerces/${AH}/tirages`, { contact: '0644444444' })).statut, 409, 'puis 1 tirage par jour, comme toujours')
    } finally {
      await app.fermer()
    }
  })

  test('F2 : crédit ET suppression en échec → incohérence journalisée explicitement (ligne JSON), 500 qui le dit', async (t) => {
    const erreurs = t.mock.method(console, 'error', () => {})
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      const client = (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0655555555' }, PIN)).contenu.client as Client
      hasard = 0.99
      f.echouer('PATCH', 'clients')
      f.echouer('DELETE', 'tirages')
      const r = await api('POST', `/commerces/${AH}/tirages`, { contact: '0655555555' })
      assert.equal(r.statut, 500)
      assert.match(r.contenu.erreur, /tirage est enregistré mais vos points n’ont pas pu être crédités/)
      const restant = tiragesDe(f, (x) => x.clientId === client.id)
      assert.equal(restant.length, 1)
      const lignes = erreurs.mock.calls.map((c) => String(c.arguments[0])).filter((l) => l.includes('tirage-points-non-credites'))
      assert.equal(lignes.length, 1)
      const ligne = JSON.parse(lignes[0])
      assert.deepEqual([ligne.type, ligne.niveau, ligne.commerce, ligne.tirage, ligne.points], ['incoherence', 'erreur', AH, restant[0].id, 10])
      assert.doesNotMatch(lignes[0], new RegExp(client.id), 'identifiant client en empreinte seulement')
    } finally {
      await app.fermer()
    }
  })

  test('F4 : rattrapage du lotId — écriture conditionnelle (lotId déjà posé ou remise arrivée entre-temps : rien écrit)', async () => {
    const f = fauxPostgrest()
    const st = ouvrir(f)
    await st.ajouterCommerce({ ...nouveauCommerce('Chez Lin', 'restaurant', ''), id: 'c-lin' }, { hash: 'h', sel: 's' })
    const cl = { ...nouveauClient('c-lin', 'Lina', { telephone: '0612345678' }), id: 'cl-lin' }
    await st.ajouterClient(cl)
    const ancien = (id: string, date: string): Tirage => ({ id, commerceId: 'c-lin', clientId: cl.id, lot: 'Nems', date, code: 'ABCDEF' })
    await st.ajouterTirage(ancien('t1', '2026-11-01T12:00:00.000Z'))
    await st.ajouterTirage(ancien('t2', '2026-11-02T12:00:00.000Z'))
    await st.ajouterTirage({ ...ancien('t3', '2026-11-03T12:00:00.000Z'), lotId: 'lot-x' })
    assert.deepEqual((await st.tiragesSansLot('c-lin')).map((t) => t.id).sort(), ['t1', 't2'])
    // t2 remis entre la lecture (sans remise) et l'écriture du rattrapage : la remise n'est pas écrasée.
    const lu = (await st.tiragesSansLot('c-lin')).find((t) => t.id === 't2')!
    assert.equal(await st.marquerTirageRemis({ ...lu, remis: { le: '2026-11-02T13:00:00.000Z', par: { type: 'gerant', nom: 'Gérant' } } }), true)
    assert.equal(await st.completerLotTirage({ ...lu, lotId: 'lot-nems', typeLot: 'lot' }), false)
    assert.ok((f.tables.tirages.find((l) => l.id === 't2')!.donnees as Tirage).remis, 'remise conservée')
    assert.equal(await st.completerLotTirage({ ...ancien('t1', '2026-11-01T12:00:00.000Z'), lotId: 'lot-nems', typeLot: 'lot' }), true)
    assert.equal(await st.completerLotTirage({ ...ancien('t1', '2026-11-01T12:00:00.000Z'), lotId: 'lot-autre', typeLot: 'lot' }), false, 'déjà rattaché')
    assert.equal((f.tables.tirages.find((l) => l.id === 't1')!.donnees as Tirage).lotId, 'lot-nems')
    await st.supprimerTirage('c-lin', 't1')
    assert.deepEqual(f.tables.tirages.map((l) => l.id).sort(), ['t2', 't3'])
  })
})

describe('Revue Codex R3 (F4) : remise d’un gain — l’heure de vérité est celle de l’écriture (stockage lent)', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-sb-r3-'))
  after(() => rmSync(dossier, { recursive: true, force: true }))
  const ACTIVE = new Date('2026-11-12T17:00:00.000Z')
  const horloge = { t: ACTIVE }
  /** Lecture du tirage par son code (route de remise) : `GET tirages?donnees->>code=eq.…`. */
  const lectureParCode = (methode: string, table: string, params: URLSearchParams) => methode === 'GET' && table === 'tirages' && params.has('donnees->>code')

  async function demarrer(f: ReturnType<typeof fauxPostgrest>) {
    const app = await creerServeur({
      fichierDb: join(dossier, 'ne-doit-pas-exister.db'),
      supabase: { url: URL_SB, cleServiceRole: CLE, fetch: f.fetch },
      adminPin: ADMIN,
      pinInitial: '1234',
      version: 'test',
      maintenant: () => horloge.t,
    })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
    const remettre = async (code: string) => {
      const r = await fetch(`${base}/commerces/${AH}/caisse/gains/${code}/remise`, { method: 'POST', headers: PIN })
      return { statut: r.status, contenu: await r.json() }
    }
    // Gain v2 gagné hier, code activé par le client à 17 h 00 UTC : fenêtre jusqu'à 17 h 10.
    const st = ouvrir(f)
    await st.ajouterClient({ ...nouveauClient(AH, 'Lina', { telephone: '0612345678' }), id: 'cl-r3' })
    await st.ajouterTirage({
      id: 'ti-r3', commerceId: AH, clientId: 'cl-r3', lot: 'Nems offerts', lotId: 'lot-nems', typeLot: 'lot',
      date: '2026-11-11T12:00:00.000Z', code: 'LENT23', activeLe: ACTIVE.toISOString(),
    })
    return { app, remettre }
  }
  const tirage = (f: ReturnType<typeof fauxPostgrest>) => f.tables.tirages.find((l) => l.id === 'ti-r3')!.donnees as Tirage

  test('lecture lente : la fenêtre se ferme entre la lecture du tirage et l’écriture → remise refusée (409, message d’activation), rien écrit', async () => {
    const f = fauxPostgrest()
    horloge.t = new Date(ACTIVE.getTime() + 9 * 60_000 + 50_000) // 17 h 09 min 50 s : encore dans la fenêtre
    const { app, remettre } = await demarrer(f)
    try {
      // La lecture par code est servie à 17 h 09 min 50 s (fenêtre ouverte) mais sa réponse met « 20 s » à revenir :
      // l'horloge avance pendant le trajet, l'écriture arrive à 17 h 10 min 10 s.
      f.ralentir({
        ms: 20,
        vise: (m, t, p) => {
          if (!lectureParCode(m, t, p)) return false
          horloge.t = new Date(ACTIVE.getTime() + 10 * 60_000 + 10_000)
          return true
        },
      })
      const r = await remettre('LENT23')
      assert.equal(r.statut, 409, JSON.stringify(r.contenu))
      assert.equal(r.contenu.erreur, MESSAGE_ACTIVATION, 'statut à jour : « inactif »')
      assert.equal(tirage(f).remis, undefined, 'rien écrit')
    } finally {
      f.ralentir()
      await app.fermer()
    }
  })

  test('témoin : même lecture lente, fenêtre encore ouverte à l’écriture → remise 200 ; la condition de la fenêtre part bien à la base', async () => {
    const f = fauxPostgrest()
    horloge.t = new Date(ACTIVE.getTime() + 5 * 60_000)
    const { app, remettre } = await demarrer(f)
    try {
      f.ralentir({
        ms: 20,
        vise: (m, t, p) => {
          if (!lectureParCode(m, t, p)) return false
          horloge.t = new Date(ACTIVE.getTime() + 9 * 60_000)
          return true
        },
      })
      const r = await remettre('LENT23')
      assert.equal(r.statut, 200, JSON.stringify(r.contenu))
      assert.equal(tirage(f).remis?.le, new Date(ACTIVE.getTime() + 9 * 60_000).toISOString(), 'heure de remise = heure de l’écriture')
      const ecriture = f.requetes.find((q) => q.methode === 'PATCH' && q.table === 'tirages')!
      assert.equal(ecriture.params.get('donnees->>activeLe'), `gt.${new Date(ACTIVE.getTime() - 60_000).toISOString()}`, 'activeLe > écriture − 10 min')
      assert.equal(ecriture.params.get('donnees->remis'), 'is.null')
    } finally {
      f.ralentir()
      await app.fermer()
    }
  })

  test('stockage seul : UPDATE conditionnel — fenêtre échue en base → false, rien écrit ; ouverte → true', async () => {
    const f = fauxPostgrest()
    const st = ouvrir(f)
    await st.ajouterCommerce({ ...nouveauCommerce('Asian Home', 'restaurant', ''), id: AH }, { hash: 'h', sel: 's' })
    await st.ajouterClient({ ...nouveauClient(AH, 'Lina', { telephone: '0612345678' }), id: 'c' })
    await st.ajouterTirage({ id: 'ti-st', commerceId: AH, clientId: 'c', lot: 'Nems', typeLot: 'lot', date: '2026-11-11T12:00:00.000Z', code: 'STOK23', activeLe: ACTIVE.toISOString() })
    const remis: Tirage = {
      id: 'ti-st', commerceId: AH, clientId: 'c', lot: 'Nems', typeLot: 'lot', date: '2026-11-11T12:00:00.000Z', code: 'STOK23', activeLe: ACTIVE.toISOString(),
      remis: { le: '2026-11-12T17:10:00.000Z', par: { type: 'gerant', nom: 'Gérant' } },
    }
    assert.equal(await st.marquerTirageRemis(remis, ACTIVE.toISOString()), false, 'activé à 17 h 00, écriture à 17 h 10 : échue')
    assert.equal((f.tables.tirages.find((l) => l.id === 'ti-st')!.donnees as Tirage).remis, undefined)
    assert.equal(await st.marquerTirageRemis(remis, new Date(ACTIVE.getTime() - 1).toISOString()), true)
    assert.equal(await st.marquerTirageRemis(remis, new Date(ACTIVE.getTime() - 1).toISOString()), false, 'déjà remis')
  })
})

describe('Revue Codex R7 : relance « gain bientôt expiré » sous Supabase (réclamation, statut revérifié, colonne `libre`)', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-sb-r7-'))
  after(() => rmSync(dossier, { recursive: true, force: true }))
  const MAINTENANT = new Date('2026-11-10T11:00:00Z')
  const JOUR = 24 * 3600_000
  /** Tirage v2 (lot physique) de Lina, gagné `jours` jours avant MAINTENANT (30 → dernier jour le 10/11, fin à 23 h UTC). */
  const gain = (jours: number): Tirage => ({
    id: 'ti-r7', commerceId: AH, clientId: 'cl-r7', lot: 'Un dessert offert', lotId: 'lot-dessert', typeLot: 'lot',
    date: new Date(MAINTENANT.getTime() - jours * JOUR).toISOString(), code: 'R7SB23',
  })
  const lu = (f: ReturnType<typeof fauxPostgrest>) => f.tables.tirages.find((l) => l.id === 'ti-r7')!.donnees as Tirage
  const envoisGain = (f: ReturnType<typeof fauxPostgrest>) =>
    f.tables.envois.map((l) => l.donnees as EnvoiRelance).filter((e) => e.modele === 'gainExpire')

  /** Serveur sur le faux PostgREST `f`, horloge propre, SMS simulés (Twilio factice, aucun appel réseau). */
  async function demarrer(f: ReturnType<typeof fauxPostgrest>, horloge: { t: Date }, sms: URLSearchParams[]) {
    const fetchSms = (async (_url: string, init: RequestInit) => {
      sms.push(new URLSearchParams(String(init.body)))
      return new Response(JSON.stringify({ sid: `SM${sms.length}` }), { status: 201 })
    }) as unknown as typeof globalThis.fetch
    const app = await creerServeur({
      fichierDb: join(dossier, 'ne-doit-pas-exister.db'),
      supabase: { url: URL_SB, cleServiceRole: CLE, fetch: f.fetch },
      adminPin: ADMIN,
      pinInitial: '1234',
      version: 'test',
      maintenant: () => horloge.t,
      notifications: { twilio: { accountSid: 'ACtest', authToken: 'jeton-test', expediteur: '+33700000000' }, fetch: fetchSms },
    })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
    async function api(methode: string, chemin: string, corps?: unknown) {
      const r = await fetch(base + chemin, { method: methode, headers: { 'Content-Type': 'application/json', ...PIN }, body: corps === undefined ? undefined : JSON.stringify(corps) })
      return { statut: r.status, contenu: await r.json() }
    }
    const tournee = async () => {
      await api('GET', `/commerces/${AH}/etat`)
      await app.relancesEnCours()
    }
    return { app, api, tournee }
  }
  async function preparer(f: ReturnType<typeof fauxPostgrest>, t: Tirage) {
    const st = ouvrir(f)
    await st.ajouterClient({ ...nouveauClient(AH, 'Lina', { telephone: '0612345678' }), id: 'cl-r7', consentementRelance: true })
    await st.ajouterTirage(t)
  }

  test('F2 : deux tournées simultanées à cheval sur minuit (deux instances) → une seule réclamation passe, un seul SMS', async () => {
    const f = fauxPostgrest()
    const sms: URLSearchParams[] = []
    // 23 h 59 min 30 s et 0 h 00 min 30 s à Paris : deux jours différents, l'index unique des envois ne les départage pas.
    const a = await demarrer(f, { t: new Date('2026-11-10T22:59:30Z') }, sms)
    const b = await demarrer(f, { t: new Date('2026-11-10T23:00:30Z') }, sms)
    try {
      await preparer(f, gain(29))
      // Les deux réclamations ont relu le tirage (sans marqueur) avant que l'une n'écrive.
      f.barriere('PATCH', 'tirages')
      await Promise.all([a.tournee(), b.tournee()])
      assert.equal(sms.length, 1, 'un seul SMS pour le gain')
      assert.deepEqual(envoisGain(f).map((e) => e.statut), ['envoye'])
      const reclamations = f.requetes.filter((q) => q.methode === 'PATCH' && q.table === 'tirages')
      assert.equal(reclamations.length, 2)
      for (const q of reclamations) assert.deepEqual([q.params.get('donnees->relanceGainLe'), q.params.get('donnees->remis'), q.params.get('donnees->activeLe')], ['is.null', 'is.null', 'is.null'])
      assert.ok(lu(f).relanceGainLe)
    } finally {
      await a.app.fermer()
      await b.app.fermer()
    }
  })

  /** Lecture de présélection de la tournée (tirages des 32 derniers jours) : instantané pris, puis `pendant` s'exécute. */
  const selection = (horloge: { t: Date }, pendant: () => void) => {
    const depuis = `gte.${new Date(horloge.t.getTime() - 32 * JOUR).toISOString()}`
    return { ms: 20, vise: (m: string, t: string, p: URLSearchParams) => (m === 'GET' && t === 'tirages' && p.get('date') === depuis ? (pendant(), true) : false) }
  }

  test('F3 : gain remis en caisse entre la sélection et l’envoi → ni SMS, ni marqueur, remise intacte', async () => {
    const f = fauxPostgrest()
    const sms: URLSearchParams[] = []
    const horloge = { t: MAINTENANT }
    const s = await demarrer(f, horloge, sms)
    try {
      await preparer(f, gain(28))
      const remis = { le: MAINTENANT.toISOString(), par: { type: 'gerant' as const, nom: 'Gérant' } }
      f.ralentir(selection(horloge, () => void ((f.tables.tirages.find((l) => l.id === 'ti-r7')!.donnees as Tirage).remis = remis)))
      await s.tournee()
      assert.equal(sms.length, 0)
      assert.deepEqual(envoisGain(f), [])
      assert.deepEqual([lu(f).relanceGainLe, lu(f).remis], [undefined, remis])
    } finally {
      f.ralentir()
      await s.app.fermer()
    }
  })

  test('F3 : gain expiré (minuit à Paris passé) entre la sélection et l’envoi → ni SMS, ni marqueur, aucune écriture', async () => {
    const f = fauxPostgrest()
    const sms: URLSearchParams[] = []
    const horloge = { t: new Date('2026-11-10T22:59:00Z') } // 23 h 59 à Paris, dernier jour du gain
    const s = await demarrer(f, horloge, sms)
    try {
      await preparer(f, gain(30))
      f.ralentir(selection(horloge, () => void (horloge.t = new Date('2026-11-10T23:01:00Z'))))
      await s.tournee()
      assert.equal(sms.length, 0)
      assert.deepEqual(envoisGain(f), [])
      assert.equal(lu(f).relanceGainLe, undefined)
      assert.equal(f.requetes.filter((q) => q.methode === 'PATCH' && q.table === 'tirages').length, 0, 'statut revérifié avant la réclamation')
    } finally {
      f.ralentir()
      await s.app.fermer()
    }
  })

  test('F5 : message libre et relance de gain le même jour (colonne `libre` partagée) → refus tracé avec un motif distinct, gain retenté le lendemain', async () => {
    const f = fauxPostgrest()
    const sms: URLSearchParams[] = []
    const horloge = { t: MAINTENANT }
    const s = await demarrer(f, horloge, sms)
    try {
      await preparer(f, gain(28))
      assert.equal((await s.api('POST', `/commerces/${AH}/clients/cl-r7/relance`, { message: 'Bonjour Lina' })).statut, 200)
      // Vrai doublon du message libre : refus ordinaire, sans motif.
      const doublon = await s.api('POST', `/commerces/${AH}/clients/cl-r7/relance`, { message: 'Encore' })
      assert.equal(doublon.statut, 409)
      assert.match(doublon.contenu.erreur, /déjà été envoyée à ce client aujourd’hui/)

      await s.tournee()
      assert.equal(sms.length, 1)
      const [refus] = envoisGain(f)
      assert.deepEqual([refus.statut, refus.motif], ['refuse', 'collision_libre_gain'])
      assert.match(refus.raison!, /^Relance « gain bientôt expiré » non envoyée : un message libre est déjà parti aujourd’hui/)
      assert.equal(lu(f).relanceGainLe, undefined, 'réclamation libérée : nouvel essai à la tournée suivante')
      assert.equal(f.tables.envois.filter((l) => (l.donnees as EnvoiRelance).motif).length, 1, 'le vrai doublon n’a pas de motif')

      horloge.t = new Date(MAINTENANT.getTime() + JOUR)
      await s.tournee()
      assert.equal(sms.length, 2)
      assert.deepEqual(envoisGain(f).map((e) => e.statut).sort(), ['envoye', 'refuse'])
      // L'inverse, le même jour : le message libre est refusé avec le même motif.
      const libre = await s.api('POST', `/commerces/${AH}/clients/cl-r7/relance`, { message: 'Bonjour' })
      assert.equal(libre.statut, 409)
      assert.match(libre.contenu.erreur, /^Message libre non envoyé : la relance « gain bientôt expiré » est déjà partie aujourd’hui/)
      const dernier = f.tables.envois.map((l) => l.donnees as EnvoiRelance).filter((e) => e.modele === 'libre').at(-1)!
      assert.deepEqual([dernier.statut, dernier.motif], ['refuse', 'collision_libre_gain'])
      assert.equal(sms.length, 2)
    } finally {
      await s.app.fermer()
    }
  })
})

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
      // « Supabase » peut être NOMMÉ (hébergement, page de confidentialité P1-B6) : seuls les variables, le client
      // `@supabase/supabase-js` et la clé service_role sont interdits côté front.
      assert.doesNotMatch(contenu, /SUPABASE_[A-Z]|supabase-js|@supabase|service_role/i, f)
    }
  })

  test('la couche Supabase réutilise cleContact et ne réécrit aucune règle métier', () => {
    const code = readFileSync(join(racine, 'server', 'stockage-supabase.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    assert.match(code, /import \{ cleContact \} from '\.\.\/src\/lib\/fidelite\.ts'/)
    assert.doesNotMatch(code, /tampons|seuilTampons|visites|statutJeu|tirerLot|0033|\\D/)
    assert.doesNotMatch(code, /from 'pg'|postgres:\/\//, 'pas de connexion Postgres directe')
  })
})

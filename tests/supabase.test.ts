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
import { soldePoints } from '../src/lib/points.ts'
import type { Client, Commerce, Tirage } from '../src/types.ts'

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
}

interface Requete {
  methode: string
  table: string
  params: URLSearchParams
  entetes: Headers
  corps: unknown
}

/** `sans0003` : base de production AVANT la migration 0003 (tables equipe / journal / menus absentes). `sans0004` à `sans0008` : idem pour 0004 à 0008. */
function fauxPostgrest({ sans0003 = false, sans0004 = false, sans0005 = false, sans0006 = false, sans0007 = false, sans0008 = false } = {}) {
  const absentes = new Set([
    ...(sans0003 ? ['equipe', 'journal', 'menus'] : []),
    ...(sans0004 ? ['parrainages', 'demandes_rattrapage'] : []),
    ...(sans0005 ? ['sessions_revoquees'] : []),
    ...(sans0006 ? ['tentatives_auth'] : []),
    ...(sans0007 ? ['envois'] : []),
    ...(sans0008 ? ['evenements_jour'] : []),
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
    return limite ? lignes.slice(debut, debut + Number(limite)) : lignes.slice(debut)
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

  test('P0-S11 : démarrage Supabase refusé sans la migration 0003 ou 0004 (journal et traces programme obligatoires)', async () => {
    await assert.rejects(demarrer(fauxPostgrest({ sans0003: true })), /0003_cartiz/)
    await assert.rejects(demarrer(fauxPostgrest({ sans0004: true })), /0004_programme/)
    // Les autres migrations restent facultatives au démarrage (repli documenté) : 0005 à 0008.
    const { app } = await demarrer(fauxPostgrest({ sans0005: true, sans0006: true, sans0007: true, sans0008: true }))
    await app.fermer()
  })

  test('P0-U3 : code gagnant remis une seule fois (UPDATE conditionnel), même simultanément ; persistant ; sans 0005/0006', async () => {
    const f = fauxPostgrest({ sans0005: true, sans0006: true })
    const CODE = { 'X-Equipe-Code': '2468' }
    let code = ''
    {
      const { app, api } = await demarrer(f)
      try {
        assert.equal((await api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)).statut, 201)
        assert.equal((await api('PATCH', `/commerces/${AH}`, { lots: [{ libelle: 'Nems offerts', probabilite: 100 }] }, PIN)).statut, 200)
        const c = (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0612345678' }, PIN)).contenu.client as Client
        await api('POST', `/commerces/${AH}/clients/${c.id}/visite`, undefined, PIN)
        code = (await api('POST', `/commerces/${AH}/tirages`, { contact: '0612345678' })).contenu.code
        assert.ok(code)

        const verif = await api('GET', `/commerces/${AH}/caisse/gains/${code.toLowerCase()}`, undefined, CODE)
        assert.deepEqual([verif.statut, verif.contenu.gain.statut, verif.contenu.gain.lot, verif.contenu.gain.client.prenom], [200, 'valable', 'Nems offerts', 'Lina'])
        const lecture = f.requetes.findLast((r) => r.table === 'tirages' && r.methode === 'GET')!
        assert.equal(lecture.params.get('donnees->>code'), `eq.${code}`)

        // Deux caisses valident le même code au même instant : les deux lisent « valable », la base n'en laisse passer qu'une.
        f.barriere('PATCH', 'tirages')
        const remises = await Promise.all([1, 2].map(() => api('POST', `/commerces/${AH}/caisse/gains/${code}/remise`, undefined, CODE)))
        assert.deepEqual(remises.map((r) => r.statut).sort(), [200, 409])
        assert.match(remises.find((r) => r.statut === 409)!.contenu.erreur, /déjà remis/)
        const maj = f.requetes.filter((r) => r.table === 'tirages' && r.methode === 'PATCH')
        assert.equal(maj.length, 2)
        for (const r of maj) assert.equal(r.params.get('donnees->remis'), 'is.null', 'garde dans la requête elle-même')
        assert.equal(f.tables.tirages.length, 1)
        assert.equal((f.tables.tirages[0].donnees as Tirage).remis?.par.nom, 'Mai')
      } finally {
        await app.fermer()
      }
    }
    // Redémarrage (Render qui se réveille) : le statut est en base, pas en mémoire.
    const { app, api } = await demarrer(f)
    try {
      const r = await api('POST', `/commerces/${AH}/caisse/gains/${code}/remise`, undefined, CODE)
      assert.equal(r.statut, 409)
      assert.equal((await api('GET', `/commerces/${AH}/caisse/gains/${code}`, undefined, CODE)).contenu.gain.statut, 'remis')
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

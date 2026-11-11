// Point Codex 8 — recherche caisse par numéro : la route ne lit plus tous les clients du commerce pour une saisie de
// téléphone. `Stockage.clientsCandidatsNumero` filtre en base sur `cle_contact` (sur-ensemble), la route refiltre avec
// `correspondRecherche`. Deux preuves : (1) équivalence — sur quelques centaines de clients variés, résultats, ordre et
// total de la route sont identiques à `correspondRecherche` appliquée à TOUS les clients (SQLite et Supabase) ;
// (2) volume — avec le faux PostgREST, une recherche de numéro ne sert que les lignes candidates.
// Le faux PostgREST est recopié de tests/supabase.test.ts et étendu (`or=(…)`, `like`, `match`, `not.is.null`).
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { ouvrirStockage, type Stockage } from '../server/stockage.ts'
import { ouvrirStockageSupabase } from '../server/stockage-supabase.ts'
import { nouveauClient } from '../src/lib/fidelite.ts'
import { chiffresRecherche, correspondRecherche } from '../src/lib/recherche.ts'
import type { Client } from '../src/types.ts'

const URL_SB = 'https://projet-factice.supabase.co'
const CLE = 'cle-service-role-factice' // pas une vraie clé
const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const horloge = new Date(2026, 10, 11, 12, 0)
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-codex8-'))
after(() => rmSync(dossier, { recursive: true, force: true }))

// ---------- Faux PostgREST (recopié de tests/supabase.test.ts, étendu) ----------

type Ligne = Record<string, unknown>
type Unicite = { nom: string; cle: (l: Ligne) => string | null }

const jourParis = (iso: unknown) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(String(iso)))

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
  equipe: { pk: 'id', uniques: [], fk: [['commerce_id', 'commerces']], ordre: true, version: true },
  journal: { pk: 'id', uniques: [], fk: [['commerce_id', 'commerces']] },
  menus: { pk: 'commerce_id', uniques: [], fk: [['commerce_id', 'commerces']], version: true },
  parrainages: { pk: 'id', uniques: [], fk: [['commerce_id', 'commerces']] },
  demandes_rattrapage: { pk: 'id', uniques: [], fk: [['commerce_id', 'commerces']] },
  sessions_revoquees: { pk: 'jti', uniques: [] },
  tentatives_auth: { pk: 'cle', uniques: [] },
  envois: {
    pk: 'id',
    uniques: [{ nom: 'envois_un_par_jour', cle: (l) => (l.statut === 'en_cours' || l.statut === 'envoye' ? `${l.commerce_id}|${l.client_id}|${l.modele}|${l.jour}` : null) }],
    fk: [['commerce_id', 'commerces']],
  },
  evenements_jour: { pk: 'jour', uniques: [], fk: [['commerce_id', 'commerces']] },
  compteurs_publics: { pk: 'cle', uniques: [] },
}

/** Termes d'un `or=(…)` PostgREST : virgules de premier niveau, hors parenthèses et hors guillemets. */
function decouper(s: string): string[] {
  const termes: string[] = []
  let profondeur = 0
  let guillemets = false
  let courant = ''
  for (const ch of s) {
    if (ch === '"') guillemets = !guillemets
    else if (!guillemets && ch === '(') profondeur++
    else if (!guillemets && ch === ')') profondeur--
    if (ch === ',' && !guillemets && profondeur === 0) {
      termes.push(courant)
      courant = ''
    } else courant += ch
  }
  termes.push(courant)
  return termes
}

const sansGuillemets = (v: string) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v)

function fauxPostgrest() {
  const tables: Record<string, Ligne[]> = Object.fromEntries(Object.keys(SCHEMA).map((t) => [t, []]))
  /** Lignes servies par chaque GET (table, nombre, filtre `or`) : mesure du volume réellement téléchargé. */
  const servies: { table: string; n: number; ou: string | null }[] = []
  let compteur = 0

  const json = (statut: number, corps?: unknown) =>
    new Response(corps === undefined ? null : JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } })
  const erreur = (statut: number, code: string, message: string) => json(statut, { code, message, details: null, hint: null })

  function valeur(l: Ligne, col: string): unknown {
    const m = /^(\w+)->(>?)(\w+)$/.exec(col)
    if (!m) return l[col]
    const v = (l[m[1]] as Record<string, unknown> | null | undefined)?.[m[3]]
    return v == null ? null : m[2] && typeof v === 'object' ? JSON.stringify(v) : v
  }

  /** Un filtre `opérateur.valeur` sur une colonne (NULL : faux, sauf `is.null`). */
  function verifie(l: Ligne, col: string, v: string): boolean {
    const x = valeur(l, col)
    if (v === 'is.null') return x == null
    if (v === 'not.is.null') return x != null
    if (x == null) return false
    if (v.startsWith('gte.')) return String(x) >= v.slice(4)
    if (v.startsWith('lt.')) return Date.parse(String(x)) < Date.parse(v.slice(3))
    if (v.startsWith('eq.')) return String(x) === v.slice(3)
    if (v.startsWith('like.')) {
      // LIKE Postgres (sensible à la casse) ; `*` = `%` côté PostgREST. `%`, `_` et `\` refusés : jamais envoyés ici.
      const motif = sansGuillemets(v.slice(5))
      assert.doesNotMatch(motif, /[%_\\]/, 'motif LIKE sans caractère spécial')
      return new RegExp(`^${motif.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')).join('.*')}$`, 's').test(String(x))
    }
    if (v.startsWith('match.')) return new RegExp(sansGuillemets(v.slice(6))).test(String(x))
    throw new Error(`Opérateur non géré par le faux PostgREST : ${col}=${v}`)
  }

  /** Terme d'un `or` / `and` : `col.op.valeur` ou `and(…)` / `or(…)` imbriqué. */
  function terme(l: Ligne, t: string): boolean {
    const logique = /^(and|or)\((.*)\)$/s.exec(t)
    if (logique) {
      const sous = decouper(logique[2])
      return logique[1] === 'and' ? sous.every((s) => terme(l, s)) : sous.some((s) => terme(l, s))
    }
    const point = t.indexOf('.')
    return verifie(l, t.slice(0, point), t.slice(point + 1))
  }

  function filtrer(table: string, params: URLSearchParams): Ligne[] {
    let lignes = tables[table]
    for (const [col, v] of params) {
      if (['select', 'order', 'on_conflict', 'limit', 'offset'].includes(col)) continue
      if (col === 'or') {
        assert.match(v, /^\(.*\)$/s)
        lignes = lignes.filter((l) => terme(l, `or${v}`))
        continue
      }
      lignes = lignes.filter((l) => verifie(l, col, v))
    }
    const ordre = params.get('order')
    if (ordre) {
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
    return lignes.slice(debut, debut + (limite ? Number(limite) : 1000))
  }

  const projeter = (lignes: Ligne[], select: string | null) =>
    lignes.map((l) => (select && select !== '*' ? Object.fromEntries(select.split(',').map((c) => [c, structuredClone(l[c])])) : structuredClone(l)))

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

  function traiter(methode: string, table: string, params: URLSearchParams, entetes: Headers, corps: unknown): Response {
    if (entetes.get('apikey') !== CLE || entetes.get('authorization') !== `Bearer ${CLE}`) return erreur(401, 'PGRST301', 'clé absente')
    if (table === 'rpc') return appeler(params.get('__fonction') ?? '', corps as Ligne)
    if (!SCHEMA[table]) return erreur(404, 'PGRST205', `Could not find the table 'public.${table}' in the schema cache`)
    const s = SCHEMA[table]
    const representation = (entetes.get('prefer') ?? '').includes('return=representation')

    if (methode === 'GET') {
      const lignes = filtrer(table, params)
      servies.push({ table, n: lignes.length, ou: params.get('or') })
      return json(200, projeter(lignes, params.get('select')))
    }

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
        if (v) return erreur(...v)
        tables[table].push(l)
      }
      return new Response(null, { status: 201 })
    }

    if (methode === 'PATCH') {
      const cibles = filtrer(table, params)
      for (const l of cibles) {
        const apres = { ...l, ...structuredClone(corps as Ligne) }
        if (s.version) apres.version = Number(l.version) + 1
        const v = violation(table, apres, l)
        if (v) return erreur(...v)
        Object.assign(l, apres)
      }
      return representation ? json(200, projeter(cibles, params.get('select'))) : new Response(null, { status: 204 })
    }

    if (methode === 'DELETE') {
      const cibles = new Set(filtrer(table, params))
      tables[table] = tables[table].filter((l) => !cibles.has(l))
      return representation ? json(200, projeter([...cibles], params.get('select'))) : new Response(null, { status: 204 })
    }
    return erreur(405, 'PGRST000', 'méthode non gérée')
  }

  function appeler(nom: string, args: Ligne): Response {
    if (nom !== 'incrementer_evenement') return erreur(404, 'PGRST202', `Could not find the function public.${nom} in the schema cache`)
    const l = tables.evenements_jour.find((x) => x.commerce_id === args.p_commerce_id && x.jour === args.p_jour && x.type === args.p_type)
    if (l) l.n = Number(l.n) + 1
    else tables.evenements_jour.push({ commerce_id: args.p_commerce_id, jour: args.p_jour, type: args.p_type, n: 1 })
    return new Response(null, { status: 204 })
  }

  async function fauxFetch(entree: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(String(entree))
    assert.equal(url.origin, URL_SB)
    const [, , , table, fonction] = url.pathname.split('/')
    if (table === 'rpc') url.searchParams.set('__fonction', fonction ?? '')
    const entetes = new Headers(init?.headers)
    const corps = init?.body ? JSON.parse(String(init.body)) : undefined
    return traiter(init?.method ?? 'GET', table, url.searchParams, entetes, corps)
  }

  return { fetch: fauxFetch as typeof fetch, tables, servies }
}

// ---------- Serveur et population ----------

type Base = { nom: string; demarrer: () => Promise<{ api: (chemin: string) => Promise<{ statut: number; contenu: any }>; st: Stockage; f?: ReturnType<typeof fauxPostgrest>; fermer: () => Promise<void> }> }

async function lancer(options: Parameters<typeof creerServeur>[0], st: Stockage, f?: ReturnType<typeof fauxPostgrest>) {
  const app = await creerServeur(options)
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
  const api = async (chemin: string) => {
    const r = await fetch(base + chemin, { headers: PIN })
    return { statut: r.status, contenu: await r.json() }
  }
  return { api, st, f, fermer: async () => void (await app.fermer(), await st.fermer()) }
}

const BASES: Base[] = [
  {
    nom: 'SQLite',
    demarrer: async () => {
      const fichierDb = join(dossier, `codex8-${Math.random().toString(36).slice(2)}.db`)
      const options = { fichierDb, adminPin: ADMIN, pinInitial: '1234', version: 'test', maintenant: () => horloge }
      const app = await creerServeur(options)
      await app.fermer() // base initialisée (commerce AH) ; on la rouvre ci-dessous avec une 2e connexion pour semer
      return lancer(options, ouvrirStockage(fichierDb))
    },
  },
  {
    nom: 'Supabase (faux PostgREST)',
    demarrer: async () => {
      const f = fauxPostgrest()
      const options = {
        fichierDb: join(dossier, 'ne-doit-pas-exister.db'),
        supabase: { url: URL_SB, cleServiceRole: CLE, fetch: f.fetch },
        adminPin: ADMIN,
        pinInitial: '1234',
        version: 'test',
        maintenant: () => horloge,
      }
      return lancer(options, ouvrirStockageSupabase({ url: URL_SB, cleServiceRole: CLE, fetch: f.fetch }), f)
    },
  },
]

const PRENOMS = ['Hélène', 'Zoé', 'Œdipe', 'Lina', 'Marc', 'Éloïse', 'Bœuf', 'Noé', 'Ana', 'Jean2', 'Client 0612', 'Ines 33']

/** Chiffres pseudo-aléatoires mais déterministes (8 après l'indicatif 06 / 07). */
const huit = (i: number) => String((i * 7919 + 12345) % 100_000_000).padStart(8, '0')
const espacer = (s: string) => s.replace(/(\d{2})(?=\d)/g, '$1 ')

/** Clients variés : formats de numéro (espaces, points, +33, 0033, étranger), e-mails avec chiffres, prénoms accentués
 * ou contenant des chiffres, et quelques anomalies (téléphone ET e-mail : la clé est l'e-mail). */
function population(n: number, { prenomsAvecChiffres = true } = {}): Client[] {
  const prenoms = prenomsAvecChiffres ? PRENOMS : PRENOMS.filter((p) => !/\d/.test(p))
  const clients: Client[] = []
  for (let i = 0; i < n; i++) {
    const prenom = prenoms[i % prenoms.length]
    const tel = `0${6 + (i % 2)}${huit(i)}`
    let contact: { telephone: string } | { email: string }
    switch (i % 7) {
      case 0: contact = { telephone: espacer(tel) }; break
      case 1: contact = { telephone: `+33 ${espacer(tel.slice(1))}` }; break
      case 2: contact = { telephone: `0033${tel.slice(1)}` }; break
      case 3: contact = { telephone: `06.12.${huit(i).slice(0, 2)}.${huit(i).slice(2, 4)}.${huit(i).slice(4, 6)}` }; break
      case 4: contact = { email: i % 3 ? `client${i}@exemple.fr` : `jean0612.${i}@exemple.fr` }; break
      case 5: contact = { telephone: `+44 7700 ${String(900000 + i)}` }; break
      default: contact = { telephone: tel }
    }
    clients.push(nouveauClient(AH, prenom, contact as never, horloge))
  }
  // Anomalies (aucune route ne les crée, mais rien ne les interdit en base) : les deux contacts, clé = e-mail.
  if (prenomsAvecChiffres) {
    clients.push({ ...nouveauClient(AH, 'Double', { telephone: '06 12 99 88 77' }, horloge), email: 'double@exemple.fr' })
    clients.push({ ...nouveauClient(AH, 'Double Bis', { email: 'bis0612@exemple.fr' }, horloge), telephone: '+33 7 61 23 45 67' })
  }
  return clients
}

async function semer(st: Stockage, clients: Client[]) {
  for (const c of clients) await st.ajouterClient(c)
}

const SAISIES = [
  '0612', '06 12', '06.12', '+33 6 12', '+33612', '0033 6 12', '(0)6 12', '12', '2', '33', '0', '7700', '+44 7700 900',
  '0761', '07 61 23 45 67', '+33 7 61 23 45 67', '06 12 99 88 77', '0612998877',
  // téléphone complet au format +33 d'un client semé au format « 06 … » (rang 0)
  `+33 ${espacer(`06${huit(0)}`.slice(1))}`,
  // noms / e-mails / mixtes : chemin historique (balayage), doit rester identique
  'helene', 'HÉL', 'zoe', 'oedipe', 'bœuf', 'boeuf', 'jean', 'client 0612', 'jean0612', '0612.', '@exemple', 'exemple.fr', 'double@', 'ines 33',
]

describe('Point Codex 8 : recherche caisse par numéro poussée en base', () => {
  for (const base of BASES) {
    test(`${base.nom} : résultats, ordre et total identiques à correspondRecherche sur tous les clients`, async () => {
      const srv = await base.demarrer()
      try {
        await semer(srv.st, population(320))
        const tous = await srv.st.clients(AH)
        assert.ok(tous.length >= 320)
        let poussees = 0
        for (const saisie of SAISIES) {
          const q = saisie.trim()
          if (chiffresRecherche(q)) poussees++
          const attendus = tous.filter((c) => correspondRecherche(c, q)).map((c) => c.id)
          // Toutes les pages de 50 : la liste complète, dans l'ordre.
          const lus: string[] = []
          for (let page = 1; ; page++) {
            const r = await srv.api(`/commerces/${AH}/caisse?q=${encodeURIComponent(saisie)}&page=${page}&limite=50`)
            assert.equal(r.statut, 200, saisie)
            assert.equal(r.contenu.total, attendus.length, `total pour « ${saisie} »`)
            lus.push(...r.contenu.clients.map((c: Client) => c.id))
            if (r.contenu.clients.length < 50) break
          }
          assert.deepEqual(lus, attendus, `résultats pour « ${saisie} »`)
          // Page 2 de 8 (taille réelle de l'écran caisse).
          const p2 = await srv.api(`/commerces/${AH}/caisse?q=${encodeURIComponent(saisie)}&page=2&limite=8`)
          assert.deepEqual(p2.contenu.clients.map((c: Client) => c.id), attendus.slice(8, 16), `page 2 pour « ${saisie} »`)
          assert.equal(p2.contenu.total, attendus.length)
        }
        assert.ok(poussees >= 15, 'le panier exerce bien le chemin poussé')
        // Le panier couvre bien les cas limites : une saisie purement numérique (« 0612 ») est censée trouver un prénom
        // à chiffres et un e-mail à chiffres (référence), et la route — identique à la référence ci-dessus — les trouve.
        const ids = async (s: string) => (await srv.api(`/commerces/${AH}/caisse?q=${encodeURIComponent(s)}&limite=50`)).contenu.clients.map((c: Client) => c.id)
        const par = (pred: (c: Client) => boolean) => tous.filter(pred).map((c) => c.id)
        const ref0612 = tous.filter((c) => correspondRecherche(c, '0612'))
        assert.ok(ref0612.some((c) => !correspondRecherche({ ...c, prenom: '' }, '0612')), 'trouvé par le seul prénom à chiffres')
        assert.ok(ref0612.some((c) => !!c.email?.startsWith('jean0612')), 'e-mail à chiffres')
        assert.equal(await ids('0612').then((l: string[]) => l.length), Math.min(50, ref0612.length))
        assert.deepEqual(await ids('06 12 99 88 77'), par((c) => c.prenom === 'Double'), 'téléphone d’un client dont la clé est l’e-mail')
        assert.deepEqual(await ids('0033 7 61 23 45 67'), par((c) => c.prenom === 'Double Bis'))
      } finally {
        await srv.fermer()
      }
    })
  }

  test('Supabase : une recherche de numéro ne télécharge que les lignes candidates, pas tout le commerce', async () => {
    const srv = await BASES[1].demarrer()
    const f = srv.f!
    try {
      const clients = population(900, { prenomsAvecChiffres: false })
      // Deux prénoms à chiffres et une anomalie double contact : candidats obligatoires, mais en petit nombre.
      clients.push(nouveauClient(AH, 'Paul 2', { telephone: '0700000001' }, horloge), nouveauClient(AH, 'Léa 9', { email: 'lea@exemple.fr' }, horloge))
      clients.push({ ...nouveauClient(AH, 'Double', { email: 'double@exemple.fr' }, horloge), telephone: '0700000002' })
      await semer(srv.st, clients)
      const tous = await srv.st.clients(AH)
      assert.ok(tous.length >= 903)

      const mesurer = async (saisie: string) => {
        f.servies.length = 0
        const r = await srv.api(`/commerces/${AH}/caisse?q=${encodeURIComponent(saisie)}&limite=8`)
        assert.equal(r.statut, 200)
        const lectures = f.servies.filter((s) => s.table === 'clients')
        return { r, lignes: lectures.reduce((n, s) => n + s.n, 0), lectures }
      }

      const saisie = `06 ${huit(6).slice(0, 4)}` // fragment du numéro du client de rang 6 (format compact « 06… »)
      const attendus = tous.filter((c) => correspondRecherche(c, saisie))
      assert.ok(attendus.length >= 1 && attendus.length < 20, `peu de correspondances (${attendus.length})`)
      const { r, lignes, lectures } = await mesurer(saisie)
      assert.equal(r.contenu.total, attendus.length)
      assert.deepEqual(r.contenu.clients.map((c: Client) => c.id), attendus.slice(0, 8).map((c) => c.id))
      // Une seule lecture, filtrée en base sur `cle_contact` (fragment normalisé « 06… »).
      assert.equal(lectures.length, 1)
      assert.match(lectures[0].ou ?? '', new RegExp(`cle_contact\\.like\\."\\*${chiffresRecherche(saisie)}\\*"`))
      // Lignes servies = correspondances + les 3 candidats obligatoires (prénoms à chiffres, double contact) au plus.
      assert.ok(lignes >= attendus.length && lignes <= attendus.length + 3, `${lignes} lignes servies pour ${attendus.length} correspondances`)
      assert.ok(lignes < tous.length / 50, `${lignes} lignes sur ${tous.length} clients`)

      // Témoin : une recherche par nom garde le balayage complet (chemin historique, comportement inchangé).
      const nom = await mesurer('helene')
      assert.ok(nom.lignes >= tous.length, 'recherche par nom : toujours tous les clients lus')
      assert.equal(nom.lectures.every((s) => s.ou === null), true)
    } finally {
      await srv.fermer()
    }
  })
})

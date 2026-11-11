// Correction Codex point 4 — Caisse : une erreur serveur ambiguë (5xx) n'est plus affichée « refus définitif ».
// Le serveur écrit le client (fait métier) PUIS le journal : sous Supabase (pas de transaction multi-requêtes), une
// panne sur le journal répond 500 alors que le passage EST enregistré. Le front garde donc toute 5xx en file et la
// rejoue avec le même actionId ; le serveur répond `dejaTraite` et ne compte rien deux fois. Faux PostgREST recopié de
// tests/supabase.test.ts (même contrat HTTP), avec une panne ciblée : la prochaine requête (méthode, table) répond 500.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AddressInfo } from 'node:net'

import { creerServeur, type OptionsServeur } from '../server/app.ts'
import { ouvrirStockage } from '../server/stockage.ts'
import { ErreurApi } from '../src/data/api.ts'
import { classerErreur, creerFileCaisse, type ActionCaisse } from '../src/lib/fileCaisse.ts'
import { soldePoints } from '../src/lib/points.ts'
import type { Client } from '../src/types.ts'

const URL_SB = 'https://projet-factice.supabase.co'
const CLE = 'cle-service-role-factice' // pas une vraie clé
const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const message = (e: unknown) => (e instanceof Error ? e.message : 'Une erreur est survenue. Réessayez.')

// ---------- Classification (pure) ----------

describe('Correction Codex point 4 : classification des échecs d’envoi de la caisse', () => {
  test('5xx = issue inconnue → gardée en file (réseau)', () => {
    for (const s of [500, 502, 503, 504]) assert.deepEqual(classerErreur(new ErreurApi(s, 'Erreur serveur'), message), { ok: false, reseau: true }, String(s))
  })

  test('hors ligne, 401, 429 → gardée (comportements conservés)', () => {
    for (const s of [0, 401, 429]) assert.deepEqual(classerErreur(new ErreurApi(s, 'x'), message), { ok: false, reseau: true }, String(s))
  })

  test('autres 4xx → refus définitif, avec le message du serveur', () => {
    for (const s of [400, 404, 409]) {
      assert.deepEqual(classerErreur(new ErreurApi(s, `refus ${s}`), message), { ok: false, reseau: false, erreur: `refus ${s}` }, String(s))
    }
    // Erreur inattendue (pas une ErreurApi) : refus, comme avant.
    assert.deepEqual(classerErreur(new TypeError('bug'), message), { ok: false, reseau: false, erreur: 'bug' })
  })

  test('file : une 500 garde l’action (même identifiant), le rejeu réussi la retire sans refus', async () => {
    const f = creerFileCaisse(null, 'cle')
    const a: ActionCaisse = { id: 'act-p4-file', type: 'passage', commerceId: AH, clientId: 'cl-x', clientPrenom: 'Lina', faitLe: '2026-11-11T12:00:00Z' }
    f.ajouter(a)
    const e1 = await f.synchroniser(async () => classerErreur(new ErreurApi(500, 'Erreur interne'), message))
    assert.deepEqual(e1.attente.map((x) => x.id), ['act-p4-file'])
    assert.equal(e1.refusees.length, 0, 'jamais « rien n’a été enregistré » sur une 500')
    const vus: string[] = []
    const e2 = await f.synchroniser(async (x) => (vus.push(x.id), { ok: true }))
    assert.deepEqual(vus, ['act-p4-file'], 'rejoué avec le même identifiant')
    assert.deepEqual(e2, { attente: [], refusees: [] })
  })

  test('Caisse.tsx utilise la classification extraite', () => {
    const c = readFileSync(new URL('../src/pages/Caisse.tsx', import.meta.url), 'utf8')
    const envoyer = c.slice(c.indexOf('const envoyer = useCallback('), c.indexOf('const synchroniser = useCallback('))
    assert.match(envoyer, /return classerErreur\(e, messageErreur\)/)
    assert.match(envoyer, /actionId: a\.id/)
  })
})

// ---------- Faux PostgREST (mémoire), recopié de tests/supabase.test.ts ----------

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

function fauxPostgrest() {
  const tables: Record<string, Ligne[]> = Object.fromEntries(Object.keys(SCHEMA).map((t) => [t, []]))
  let compteur = 0
  /** Panne ciblée : la prochaine requête `methode` sur `table` répond 500 (une seule fois). */
  let panneCiblee: { methode: string; table: string } | undefined
  let pannesServies = 0

  const json = (statut: number, corps?: unknown) =>
    new Response(corps === undefined ? null : JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } })
  const erreur = (statut: number, code: string, message: string) => json(statut, { code, message, details: null, hint: null })

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
        lignes = lignes.filter((l) => l[col] != null && String(l[col]) >= v.slice(4))
        continue
      }
      if (v.startsWith('lt.')) {
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

  async function traiter(methode: string, table: string, params: URLSearchParams, entetes: Headers, corps: unknown): Promise<Response> {
    if (entetes.get('apikey') !== CLE || entetes.get('authorization') !== `Bearer ${CLE}`) return erreur(401, 'PGRST301', 'clé absente')
    if (panneCiblee && panneCiblee.methode === methode && panneCiblee.table === table) {
      // 500 non-conflit (panne réseau / erreur PostgREST), une seule fois. Pas 503/520 : supabase-js réessaierait.
      panneCiblee = undefined
      pannesServies++
      return erreur(500, 'XX000', 'base indisponible')
    }
    if (table === 'rpc') return new Response(null, { status: 204 })
    if (!SCHEMA[table]) return erreur(404, 'PGRST205', `Could not find the table 'public.${table}' in the schema cache`)
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

  async function fauxFetch(entree: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(String(entree))
    assert.equal(url.origin, URL_SB)
    const [, , , table] = url.pathname.split('/')
    const methode = init?.method ?? 'GET'
    const corps = init?.body ? JSON.parse(String(init.body)) : undefined
    return traiter(methode, table, url.searchParams, new Headers(init?.headers), corps)
  }

  return {
    fetch: fauxFetch as typeof fetch,
    tables,
    panne: (methode: string, table: string) => void (panneCiblee = { methode, table }),
    pannesServies: () => pannesServies,
  }
}

// ---------- Serveur complet ----------

const dossier = mkdtempSync(join(tmpdir(), 'codex-point4-'))
after(() => rmSync(dossier, { recursive: true, force: true }))
const horloge = { t: new Date(2026, 10, 11, 12, 0) }

async function demarrer(options: Partial<OptionsServeur>) {
  const app = await creerServeur({ adminPin: ADMIN, pinInitial: '1234', version: 'test', maintenant: () => horloge.t, ...options } as OptionsServeur)
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
  async function api(methode: string, chemin: string, corps?: unknown) {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...PIN },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    return { statut: r.status, contenu: await r.json() }
  }
  const nouveauClient = async (prenom: string, contact: string) => (await api('POST', `/commerces/${AH}/clients`, { prenom, contact })).contenu.client as Client
  const passage = (clientId: string, actionId: string) =>
    api('POST', `/commerces/${AH}/caisse/passage`, { clientId, actionId, montantCentimes: 2500, faitLe: horloge.t.toISOString() })
  return { app, api, nouveauClient, passage }
}

describe('Correction Codex point 4 : panne du journal APRÈS l’écriture du client, puis rejeu', () => {
  test('Supabase : 500 alors que le tampon est écrit ; le rejeu du même actionId répond dejaTraite, rien n’est compté deux fois', async () => {
    horloge.t = new Date(2026, 10, 11, 12, 0)
    const f = fauxPostgrest()
    const { app, nouveauClient, passage } = await demarrer({
      fichierDb: join(dossier, 'ne-doit-pas-exister.db'),
      supabase: { url: URL_SB, cleServiceRole: CLE, fetch: f.fetch },
    })
    try {
      const lina = await nouveauClient('Lina', '0644444444')
      const donnees = () => f.tables.clients.find((l) => l.id === lina.id)!.donnees as Client
      const avant = donnees()
      const journalAvant = f.tables.journal.length

      // 1. Panne sur l'écriture du JOURNAL (POST /journal) pendant le passage.
      f.panne('POST', 'journal')
      const p = await passage(lina.id, 'act-p4-sb-1')
      assert.equal(f.pannesServies(), 1, 'la panne a bien visé le journal')
      assert.equal(p.statut, 500, JSON.stringify(p.contenu))
      const apresPanne = donnees()
      assert.equal(apresPanne.tampons, avant.tampons + 1, 'le passage EST enregistré malgré la 500')
      assert.equal(apresPanne.visites.length, avant.visites.length + 1)
      const gagnes = soldePoints(apresPanne) - soldePoints(avant)
      assert.ok(gagnes > 0, 'montant → points crédités')
      assert.equal(f.tables.journal.length, journalAvant, 'entrée de journal perdue (jamais un journal mensonger)')

      // 2. Le front a gardé l'action (5xx = ambigu) et la rejoue avec le même actionId.
      horloge.t = new Date(2026, 10, 11, 12, 3)
      const r = await passage(lina.id, 'act-p4-sb-1')
      assert.equal(r.statut, 200, JSON.stringify(r.contenu))
      assert.equal(r.contenu.dejaTraite, true)
      assert.equal(r.contenu.client.tampons, avant.tampons + 1)
      const apresRejeu = donnees()
      assert.equal(apresRejeu.tampons, avant.tampons + 1, 'un seul tampon')
      assert.equal(apresRejeu.visites.length, avant.visites.length + 1, 'une seule visite')
      assert.equal(soldePoints(apresRejeu), soldePoints(avant) + gagnes, 'les points d’un seul passage')

      // 3. Un 2e rejeu ne change toujours rien.
      assert.equal((await passage(lina.id, 'act-p4-sb-1')).contenu.dejaTraite, true)
      assert.equal(donnees().tampons, avant.tampons + 1)
      assert.equal(soldePoints(donnees()), soldePoints(avant) + gagnes)
    } finally {
      await app.fermer()
    }
  })

  test('SQLite : la panne du journal annule toute la transaction (500, rien écrit) ; le rejeu compte alors une seule fois', async () => {
    horloge.t = new Date(2026, 10, 11, 12, 0)
    const fichierDb = join(dossier, 'sqlite.db')
    const { app, nouveauClient, passage } = await demarrer({ fichierDb })
    try {
      const lina = await nouveauClient('Lina', '0655555555')
      const donnees = () => {
        const st = ouvrirStockage(fichierDb)
        try {
          return st.client(AH, lina.id)!
        } finally {
          st.fermer()
        }
      }
      const avant = donnees()
      const db = new DatabaseSync(fichierDb)
      db.exec(`CREATE TRIGGER panne_journal BEFORE INSERT ON journal BEGIN SELECT RAISE(ABORT, 'panne simulée du journal'); END`)
      db.close()
      const p = await passage(lina.id, 'act-p4-sq-1')
      assert.equal(p.statut, 500, JSON.stringify(p.contenu))
      assert.equal(donnees().tampons, avant.tampons, 'transaction annulée : rien d’enregistré')
      const db2 = new DatabaseSync(fichierDb)
      db2.exec('DROP TRIGGER panne_journal')
      db2.close()

      const r = await passage(lina.id, 'act-p4-sq-1')
      assert.equal(r.statut, 200, JSON.stringify(r.contenu))
      assert.equal(r.contenu.dejaTraite, false, 'rien n’avait été compté : le rejeu compte')
      assert.equal(donnees().tampons, avant.tampons + 1)
      assert.equal((await passage(lina.id, 'act-p4-sq-1')).contenu.dejaTraite, true)
      assert.equal(donnees().tampons, avant.tampons + 1, 'un seul tampon')
      assert.equal(donnees().visites.length, avant.visites.length + 1)
    } finally {
      await app.fermer()
    }
  })
})

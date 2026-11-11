// Correction Codex point 2 : parrainage — une panne entre l'écriture du filleul et celle du parrain ne doit plus
// faire perdre le crédit du parrain. Sous Supabase (pas de transaction multi-requêtes), le filleul est écrit payé PUIS
// le parrain ; le règlement doit rester RÉCUPÉRABLE (rejeu de l'action de caisse, ou passage suivant), sans jamais
// créditer deux fois. Faux PostgREST recopié de tests/supabase.test.ts (même contrat HTTP), avec en plus une panne
// ciblée : une seule requête (méthode, table, ligne visée) échoue en 500.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, type OptionsServeur } from '../server/app.ts'
import { configParrainage } from '../src/lib/programme.ts'
import { soldePoints } from '../src/lib/points.ts'
import type { Client, Commerce } from '../src/types.ts'

const URL_SB = 'https://projet-factice.supabase.co'
const CLE = 'cle-service-role-factice' // pas une vraie clé
const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }

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
  /** Panne ciblée : la prochaine requête `methode` sur `table` visant la ligne `id` (filtre id=eq.<id>) répond 500. */
  let panneCiblee: { methode: string; table: string; id: string } | undefined
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
    if (panneCiblee && panneCiblee.methode === methode && panneCiblee.table === table && params.get('id') === `eq.${panneCiblee.id}`) {
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
    panne: (methode: string, table: string, id: string) => void (panneCiblee = { methode, table, id }),
    pannesServies: () => pannesServies,
  }
}

// ---------- Serveur complet sur le faux ----------

const dossier = mkdtempSync(join(tmpdir(), 'codex-point2-'))
after(() => rmSync(dossier, { recursive: true, force: true }))
let horloge = new Date(2026, 10, 9, 12, 0)

async function demarrer(f: ReturnType<typeof fauxPostgrest>, options: Partial<OptionsServeur> = {}) {
  const app = await creerServeur({
    fichierDb: join(dossier, 'ne-doit-pas-exister.db'),
    supabase: { url: URL_SB, cleServiceRole: CLE, fetch: f.fetch },
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

/** Parrain Bob, filleule Alice (inscrite avec le code de Bob) ; accès direct aux lignes du faux. */
async function scenario(f: ReturnType<typeof fauxPostgrest>, api: Awaited<ReturnType<typeof demarrer>>['api']) {
  const bob = (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Bob', contact: '0611111111' }, PIN)).contenu.client as Client
  const alice = (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Alice', contact: '0622222222', parrain: bob.codeParrainage }, PIN)).contenu.client as Client
  assert.equal(alice.parrainId, bob.id)
  const donnees = (id: string) => f.tables.clients.find((l) => l.id === id)!.donnees as Client
  const cfg = configParrainage(f.tables.commerces.find((l) => l.id === AH)!.donnees as Commerce)
  assert.ok(cfg.actif && cfg.pointsParrain > 0 && cfg.pointsFilleul > 0, 'commerce de test standard : parrainage actif')
  const traces = () => f.tables.parrainages.filter((l) => l.filleul_id === alice.id)
  const passage = (actionId: string) => api('POST', `/commerces/${AH}/caisse/passage`, { clientId: alice.id, actionId }, PIN)
  return { bob, alice, donnees, cfg, traces, passage, bienvenueBob: soldePoints(donnees(bob.id)), bienvenueAlice: soldePoints(donnees(alice.id)) }
}

describe('Correction Codex point 2 : règlement de parrainage récupérable après une panne', () => {
  test('chemin normal intact : parrain et filleul crédités une fois, marqueur et trace écrits', async () => {
    horloge = new Date(2026, 10, 9, 12, 0)
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      const s = await scenario(f, api)
      const p = await s.passage('act-p2-normal-1')
      assert.equal(p.statut, 200, JSON.stringify(p.contenu))
      assert.equal(soldePoints(s.donnees(s.alice.id)), s.bienvenueAlice + s.cfg.pointsFilleul)
      assert.equal(s.donnees(s.alice.id).parrainagePaye, true)
      assert.equal(soldePoints(s.donnees(s.bob.id)), s.bienvenueBob + s.cfg.pointsParrain)
      assert.deepEqual(s.donnees(s.bob.id).parrainagesGagnes, [horloge.toISOString()])
      assert.deepEqual(s.donnees(s.bob.id).filleulsRegles, [s.alice.id], 'marqueur écrit avec le crédit')
      assert.equal(s.traces().length, 1)
      assert.equal((s.traces()[0].donnees as { pointsParrain: number }).pointsParrain, s.cfg.pointsParrain)
      // Passage suivant : rien de plus.
      horloge = new Date(2026, 10, 10, 12, 0)
      assert.equal((await s.passage('act-p2-normal-2')).statut, 200)
      assert.equal(soldePoints(s.donnees(s.bob.id)), s.bienvenueBob + s.cfg.pointsParrain)
      assert.equal(s.traces().length, 1)
    } finally {
      await app.fermer()
    }
  })

  test('panne sur l’écriture du parrain → erreur ; le rejeu du même actionId termine le règlement, une seule fois', async () => {
    horloge = new Date(2026, 10, 9, 12, 0)
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      const s = await scenario(f, api)
      // 1. Panne entre les deux écritures : le PATCH du PARRAIN échoue une fois (500, pas un conflit).
      f.panne('PATCH', 'clients', s.bob.id)
      const p = await s.passage('act-p2-panne-1')
      assert.equal(f.pannesServies(), 1, 'la panne a bien visé l’écriture du parrain')
      assert.ok(p.statut >= 500, `réponse en erreur attendue, reçu ${p.statut}`)
      assert.equal(s.donnees(s.alice.id).parrainagePaye, true, 'filleule déjà écrite payée')
      assert.equal(soldePoints(s.donnees(s.alice.id)), s.bienvenueAlice + s.cfg.pointsFilleul)
      assert.equal(soldePoints(s.donnees(s.bob.id)), s.bienvenueBob, 'le parrain n’a rien reçu')
      assert.equal(s.donnees(s.bob.id).parrainagesGagnes, undefined)
      assert.equal(s.traces().length, 0)

      // 2. Reprise : rejeu du même actionId (file hors ligne de la caisse) → OK, déjà traité, parrain crédité.
      horloge = new Date(2026, 10, 9, 12, 5)
      const r = await s.passage('act-p2-panne-1')
      assert.equal(r.statut, 200, JSON.stringify(r.contenu))
      assert.equal(r.contenu.dejaTraite, true)
      assert.equal(soldePoints(s.donnees(s.bob.id)), s.bienvenueBob + s.cfg.pointsParrain, 'parrain crédité')
      assert.equal(s.donnees(s.bob.id).parrainagesGagnes?.length, 1, 'une seule date au plafond annuel')
      assert.deepEqual(s.donnees(s.bob.id).filleulsRegles, [s.alice.id])
      assert.equal(s.traces().length, 1, 'trace de parrainage écrite')
      assert.equal(soldePoints(s.donnees(s.alice.id)), s.bienvenueAlice + s.cfg.pointsFilleul, 'filleule pas recréditée')
      assert.equal(s.donnees(s.alice.id).visites.length, 1, 'le rejeu ne recompte pas le passage')

      // 3. Pas de double crédit : 2e rejeu, puis passage un autre jour.
      assert.equal((await s.passage('act-p2-panne-1')).contenu.dejaTraite, true)
      horloge = new Date(2026, 10, 10, 12, 0)
      assert.equal((await s.passage('act-p2-panne-2')).statut, 200)
      assert.equal(soldePoints(s.donnees(s.bob.id)), s.bienvenueBob + s.cfg.pointsParrain, 'solde du parrain inchangé')
      assert.equal(s.donnees(s.bob.id).parrainagesGagnes?.length, 1)
      assert.equal(s.traces().length, 1)
      assert.equal(s.donnees(s.alice.id).visites.length, 2)
    } finally {
      await app.fermer()
    }
  })

  test('sans rejeu : le passage suivant de la filleule termine le règlement en attente, une seule fois', async () => {
    horloge = new Date(2026, 10, 9, 12, 0)
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      const s = await scenario(f, api)
      f.panne('PATCH', 'clients', s.bob.id)
      assert.ok((await s.passage('act-p2-suiv-1')).statut >= 500)
      assert.equal(soldePoints(s.donnees(s.bob.id)), s.bienvenueBob)
      horloge = new Date(2026, 10, 10, 12, 0)
      const p = await s.passage('act-p2-suiv-2')
      assert.equal(p.statut, 200, JSON.stringify(p.contenu))
      assert.equal(soldePoints(s.donnees(s.bob.id)), s.bienvenueBob + s.cfg.pointsParrain)
      assert.equal(s.traces().length, 1)
      assert.equal(soldePoints(s.donnees(s.alice.id)), s.bienvenueAlice + s.cfg.pointsFilleul, 'filleule créditée une seule fois')
      horloge = new Date(2026, 10, 11, 12, 0)
      assert.equal((await s.passage('act-p2-suiv-3')).statut, 200)
      assert.equal(soldePoints(s.donnees(s.bob.id)), s.bienvenueBob + s.cfg.pointsParrain)
      assert.equal(s.traces().length, 1)
    } finally {
      await app.fermer()
    }
  })

  test('anciens dossiers (sans marqueur) : jamais recrédités — trace présente, ou date du passage déjà dans parrainagesGagnes', async () => {
    horloge = new Date(2026, 10, 9, 12, 0)
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      const s = await scenario(f, api)
      assert.equal((await s.passage('act-p2-ancien-1')).statut, 200)
      const credite = soldePoints(s.donnees(s.bob.id))
      assert.equal(credite, s.bienvenueBob + s.cfg.pointsParrain)
      // Parrain crédité AVANT ce correctif : pas de marqueur (la trace, écrite en dernier, est là).
      delete (f.tables.clients.find((l) => l.id === s.bob.id)!.donnees as Client).filleulsRegles
      horloge = new Date(2026, 10, 10, 12, 0)
      assert.equal((await s.passage('act-p2-ancien-2')).statut, 200)
      assert.equal(soldePoints(s.donnees(s.bob.id)), credite, 'trace présente = règlement terminé')
      // Encore plus ancien : trace jamais écrite (avant P0-S11, ignorée sans la 0004) — la date du passage de la
      // filleule dans parrainagesGagnes du parrain prouve le crédit.
      f.tables.parrainages.length = 0
      horloge = new Date(2026, 10, 11, 12, 0)
      assert.equal((await s.passage('act-p2-ancien-3')).statut, 200)
      assert.equal(soldePoints(s.donnees(s.bob.id)), credite, 'date du passage déjà comptée = crédit versé')
      assert.equal(s.donnees(s.bob.id).parrainagesGagnes?.length, 1)
      assert.equal(f.tables.parrainages.length, 0)
    } finally {
      await app.fermer()
    }
  })
})

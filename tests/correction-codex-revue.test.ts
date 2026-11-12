// Revue Codex finale — 6 points sur le diff des corrections Codex :
// A. parrainage : la reprise exécute la décision persistée avec le filleul (`parrainageEnAttente` : montants, plafond,
//    date du passage initial) au lieu de tout recalculer au jour du rejeu ; « crédit versé » et « audit terminé » sont
//    distingués ; l'heuristique des dates est réservée aux parrains sans marqueur (points 1 à 4) ;
// B. relances : la reprise d'une tournée interrompue ne rappelle pas le prestataire pour un échec du jour (point 5) ;
// C. suppression / vues : le marqueur `filleulsRegles` ne survit pas au filleul et ne sort pas en caisse (point 6).
// Parrainage : faux PostgREST recopié de tests/correction-codex-point2.test.ts, avec une panne ciblée qui peut viser
// une table entière (POST parrainages). Relances : base SQLite + trigger de panne, prestataire simulé (fetch injecté).
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AddressInfo } from 'node:net'

import { creerServeur, type OptionsServeur } from '../server/app.ts'
import { ouvrirStockage } from '../server/stockage.ts'
import { configParrainage } from '../src/lib/programme.ts'
import { soldePoints } from '../src/lib/points.ts'
import { echecAutoDuJour } from '../src/lib/relances.ts'
import type { Client, Commerce, EnvoiRelance, Parrainage } from '../src/types.ts'

const URL_SB = 'https://projet-factice.supabase.co'
const CLE = 'cle-service-role-factice' // pas une vraie clé
const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const JOUR = 24 * 3600_000

// ---------- Faux PostgREST (mémoire), recopié de tests/correction-codex-point2.test.ts ----------

type Ligne = Record<string, unknown>
type Unicite = { nom: string; cle: (l: Ligne) => string | null }

const jourParisIso = (iso: unknown) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(String(iso)))

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
    uniques: [{ nom: 'tirages_un_par_jour', cle: (l) => `${l.commerce_id}|${l.client_id}|${jourParisIso(l.date)}` }],
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
  /** Panne ciblée : la prochaine requête `methode` sur `table` (et la ligne `id` si donnée) répond 500, une fois. */
  let panneCiblee: { methode: string; table: string; id?: string } | undefined
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
    if (panneCiblee && panneCiblee.methode === methode && panneCiblee.table === table && (panneCiblee.id === undefined || params.get('id') === `eq.${panneCiblee.id}`)) {
      // 500 non-conflit, une seule fois. Pas 503/520 : supabase-js réessaierait.
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
    panne: (methode: string, table: string, id?: string) => void (panneCiblee = { methode, table, id }),
    pannesServies: () => pannesServies,
  }
}

// ---------- Serveur complet sur le faux ----------

const dossier = mkdtempSync(join(tmpdir(), 'codex-revue-'))
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
  const commerce = () => f.tables.commerces.find((l) => l.id === AH)!.donnees as Commerce
  const cfg = configParrainage(commerce())
  assert.ok(cfg.actif && cfg.pointsParrain > 0 && cfg.pointsFilleul > 0, 'commerce de test standard : parrainage actif')
  const traces = () => f.tables.parrainages.filter((l) => l.filleul_id === alice.id).map((l) => l.donnees as Parrainage)
  const journalReprise = () => f.tables.journal.filter((l) => String((l.donnees as { details: string }).details).startsWith('Parrainage (reprise)'))
  const passage = (actionId: string) => api('POST', `/commerces/${AH}/caisse/passage`, { clientId: alice.id, actionId }, PIN)
  return { bob, alice, donnees, commerce, cfg, traces, journalReprise, passage, bienvenueBob: soldePoints(donnees(bob.id)), bienvenueAlice: soldePoints(donnees(alice.id)) }
}

describe('Revue Codex finale — A. parrainage : reprise sur décision persistée', () => {
  test('la décision est écrite avec les points du filleul (montants, plafond, date), puis effacée une fois la trace écrite', async () => {
    horloge = new Date(2026, 10, 9, 12, 0)
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      const s = await scenario(f, api)
      assert.equal((await s.passage('act-rv-dec-1')).statut, 200)
      assert.deepEqual(s.donnees(s.alice.id).parrainageEnAttente, {
        parrainId: s.bob.id,
        pointsFilleul: s.cfg.pointsFilleul,
        pointsParrain: s.cfg.pointsParrain,
        auPlafond: false,
        date: horloge.toISOString(),
      })
      horloge = new Date(2026, 10, 10, 12, 0)
      assert.equal((await s.passage('act-rv-dec-2')).statut, 200)
      assert.equal(s.donnees(s.alice.id).parrainageEnAttente, undefined, 'règlement terminé (trace) : décision effacée au passage suivant')
      assert.equal(s.traces().length, 1)
    } finally {
      await app.fermer()
    }
  })

  test('point 1 : le marqueur d’un AUTRE filleul et une date commune ne bloquent plus le crédit dû', async () => {
    horloge = new Date(2026, 10, 9, 12, 0)
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      const s = await scenario(f, api)
      f.panne('PATCH', 'clients', s.bob.id)
      assert.ok((await s.passage('act-rv-p1-1')).statut >= 500)
      assert.equal(f.pannesServies(), 1)
      assert.ok(s.donnees(s.alice.id).parrainageEnAttente, 'décision persistée')
      // Bob a été crédité entre-temps pour un autre filleul, à la MÊME date que la visite d'Alice.
      const visite = s.donnees(s.alice.id).visites[0]
      const bob = s.donnees(s.bob.id)
      bob.filleulsRegles = ['c-autre-filleul']
      bob.parrainagesGagnes = [visite]
      bob.points = s.bienvenueBob + s.cfg.pointsParrain
      horloge = new Date(2026, 10, 9, 12, 5)
      const r = await s.passage('act-rv-p1-1')
      assert.equal(r.statut, 200, JSON.stringify(r.contenu))
      assert.equal(soldePoints(s.donnees(s.bob.id)), s.bienvenueBob + 2 * s.cfg.pointsParrain, 'crédit d’Alice versé (pas de faux « déjà payé »)')
      assert.deepEqual(s.donnees(s.bob.id).filleulsRegles, ['c-autre-filleul', s.alice.id])
      assert.equal(s.traces().length, 1)
    } finally {
      await app.fermer()
    }
  })

  test('point 1, dossier hérité (sans décision) : l’heuristique des dates ne s’applique plus à un parrain qui a un marqueur', async () => {
    horloge = new Date(2026, 10, 9, 12, 0)
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      const s = await scenario(f, api)
      f.panne('PATCH', 'clients', s.bob.id)
      assert.ok((await s.passage('act-rv-p1h-1')).statut >= 500)
      // Filleule payée AVANT ce correctif : pas de décision persistée.
      delete s.donnees(s.alice.id).parrainageEnAttente
      const bob = s.donnees(s.bob.id)
      bob.filleulsRegles = ['c-autre-filleul']
      bob.parrainagesGagnes = [s.donnees(s.alice.id).visites[0]]
      horloge = new Date(2026, 10, 10, 12, 0)
      assert.equal((await s.passage('act-rv-p1h-2')).statut, 200)
      assert.equal(soldePoints(s.donnees(s.bob.id)), s.bienvenueBob + s.cfg.pointsParrain, 'crédit repris')
      assert.ok(s.donnees(s.bob.id).filleulsRegles?.includes(s.alice.id))
      assert.equal(s.traces().length, 1)
    } finally {
      await app.fermer()
    }
  })

  test('point 2 : panne APRÈS le crédit du parrain (marqueur présent, trace absente) → la reprise écrit trace et journal, sans second crédit', async () => {
    horloge = new Date(2026, 10, 9, 12, 0)
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      const s = await scenario(f, api)
      const initial = horloge.toISOString()
      f.panne('POST', 'parrainages')
      assert.ok((await s.passage('act-rv-p2-1')).statut >= 500)
      assert.equal(f.pannesServies(), 1, 'la panne a visé la trace')
      assert.equal(soldePoints(s.donnees(s.bob.id)), s.bienvenueBob + s.cfg.pointsParrain, 'crédit versé')
      assert.deepEqual(s.donnees(s.bob.id).filleulsRegles, [s.alice.id])
      assert.equal(s.traces().length, 0, 'audit incomplet')

      horloge = new Date(2026, 10, 9, 12, 5)
      const r = await s.passage('act-rv-p2-1')
      assert.equal(r.statut, 200, JSON.stringify(r.contenu))
      assert.equal(r.contenu.dejaTraite, true)
      assert.equal(soldePoints(s.donnees(s.bob.id)), s.bienvenueBob + s.cfg.pointsParrain, 'aucun second crédit')
      assert.equal(s.donnees(s.bob.id).parrainagesGagnes?.length, 1)
      assert.equal(s.traces().length, 1, 'trace réparée')
      assert.equal(s.traces()[0].pointsParrain, s.cfg.pointsParrain)
      assert.equal(s.traces()[0].pointsFilleul, s.cfg.pointsFilleul)
      assert.equal(s.traces()[0].date, initial, 'date du passage initial')
      assert.equal(s.journalReprise().length, 1, 'journal de la reprise écrit')

      // Plus rien ensuite : ni crédit, ni trace, ni journal.
      assert.equal((await s.passage('act-rv-p2-1')).contenu.dejaTraite, true)
      horloge = new Date(2026, 10, 10, 12, 0)
      assert.equal((await s.passage('act-rv-p2-2')).statut, 200)
      assert.equal(soldePoints(s.donnees(s.bob.id)), s.bienvenueBob + s.cfg.pointsParrain)
      assert.equal(s.traces().length, 1)
      assert.equal(s.journalReprise().length, 1)
    } finally {
      await app.fermer()
    }
  })

  test('point 3 : primes modifiées ET programme désactivé après la panne → la reprise verse le montant INITIAL', async () => {
    horloge = new Date(2026, 10, 9, 12, 0)
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      const s = await scenario(f, api)
      const initial = horloge.toISOString()
      f.panne('PATCH', 'clients', s.bob.id)
      assert.ok((await s.passage('act-rv-p3-1')).statut >= 500)
      assert.equal(soldePoints(s.donnees(s.bob.id)), s.bienvenueBob)
      // Réglages changés entre la panne et la reprise.
      const c = s.commerce()
      c.programme = { ...c.programme, parrainage: { ...c.programme?.parrainage, actif: false, pointsParrain: s.cfg.pointsParrain + 77, pointsFilleul: s.cfg.pointsFilleul + 33, plafondAn: s.cfg.plafondAn } }
      assert.equal(configParrainage(s.commerce()).actif, false)

      horloge = new Date(2026, 10, 9, 18, 0)
      const r = await s.passage('act-rv-p3-1')
      assert.equal(r.statut, 200, JSON.stringify(r.contenu))
      assert.equal(soldePoints(s.donnees(s.bob.id)), s.bienvenueBob + s.cfg.pointsParrain, 'montant initial, programme désactivé ou non')
      assert.deepEqual(s.donnees(s.bob.id).parrainagesGagnes, [initial])
      assert.equal(s.traces().length, 1)
      assert.equal(s.traces()[0].pointsParrain, s.cfg.pointsParrain)
      assert.equal(s.traces()[0].pointsFilleul, s.cfg.pointsFilleul)
      assert.equal(s.traces()[0].date, initial)
      assert.equal(soldePoints(s.donnees(s.alice.id)), s.bienvenueAlice + s.cfg.pointsFilleul, 'filleule inchangée')
    } finally {
      await app.fermer()
    }
  })

  test('point 4 : règlement décidé « au plafond » → reprise bien plus tard (anciens parrainages expirés) : toujours 0, trace à la date initiale', async () => {
    horloge = new Date(2026, 10, 9, 12, 0)
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      const s = await scenario(f, api)
      const initial = horloge.toISOString()
      // Bob au plafond annuel le jour J (parrainages d'il y a 300 jours).
      const anciens = Array.from({ length: s.cfg.plafondAn }, (_, i) => new Date(horloge.getTime() - 300 * JOUR + i * 1000).toISOString())
      s.donnees(s.bob.id).parrainagesGagnes = [...anciens]
      f.panne('POST', 'parrainages')
      assert.ok((await s.passage('act-rv-p4-1')).statut >= 500)
      assert.equal(f.pannesServies(), 1)
      assert.equal(s.donnees(s.alice.id).parrainageEnAttente?.auPlafond, true)
      assert.equal(s.donnees(s.alice.id).parrainageEnAttente?.pointsParrain, 0)
      assert.equal(soldePoints(s.donnees(s.bob.id)), s.bienvenueBob)

      // 100 jours plus tard, les anciens parrainages ont plus d'un an : un recalcul le créditerait.
      horloge = new Date(horloge.getTime() + 100 * JOUR)
      const r = await s.passage('act-rv-p4-1')
      assert.equal(r.statut, 200, JSON.stringify(r.contenu))
      assert.equal(r.contenu.dejaTraite, true)
      assert.equal(soldePoints(s.donnees(s.bob.id)), s.bienvenueBob, 'toujours rien pour le parrain')
      assert.deepEqual(s.donnees(s.bob.id).parrainagesGagnes, anciens)
      assert.equal(s.traces().length, 1)
      assert.equal(s.traces()[0].pointsParrain, 0)
      assert.equal(s.traces()[0].date, initial, 'trace à la date du passage, pas du rejeu')
      // Passage suivant : rien de plus.
      assert.equal((await s.passage('act-rv-p4-2')).statut, 200)
      assert.equal(soldePoints(s.donnees(s.bob.id)), s.bienvenueBob)
      assert.equal(s.traces().length, 1)
    } finally {
      await app.fermer()
    }
  })
})

describe('Revue Codex finale — C. suppression et vues caisse', () => {
  test('la vue caisse ne contient ni `filleulsRegles` ni `parrainageEnAttente` ; la suppression du filleul nettoie le marqueur du parrain', async () => {
    horloge = new Date(2026, 10, 9, 12, 0)
    const f = fauxPostgrest()
    const { app, api } = await demarrer(f)
    try {
      const s = await scenario(f, api)
      const p = await s.passage('act-rv-sup-1')
      assert.equal(p.statut, 200)
      assert.deepEqual(s.donnees(s.bob.id).filleulsRegles, [s.alice.id])
      assert.ok(s.donnees(s.alice.id).parrainageEnAttente)
      const technique = (c: Record<string, unknown>) => ['filleulsRegles', 'parrainageEnAttente'].filter((k) => k in c)
      assert.deepEqual(technique(p.contenu.client), [], 'réponse du passage')
      for (const id of [s.bob.id, s.alice.id]) {
        const fiche = await api('GET', `/commerces/${AH}/caisse/clients/${id}`, undefined, PIN)
        assert.equal(fiche.statut, 200)
        assert.deepEqual(technique(fiche.contenu.client), [], `fiche caisse ${id}`)
      }
      const etat = await api('GET', `/commerces/${AH}/etat`, undefined, PIN)
      assert.equal(etat.statut, 200)
      for (const c of etat.contenu.clients as Record<string, unknown>[]) assert.deepEqual(technique(c), [], 'état du gérant')

      const sup = await api('DELETE', `/commerces/${AH}/clients/${s.alice.id}`, { confirmation: 'SUPPRIMER' }, PIN)
      assert.equal(sup.statut, 200, JSON.stringify(sup.contenu))
      assert.equal(f.tables.clients.some((l) => l.id === s.alice.id), false)
      assert.deepEqual(s.donnees(s.bob.id).filleulsRegles, [], 'id du filleul supprimé retiré du marqueur')
      assert.equal(soldePoints(s.donnees(s.bob.id)), s.bienvenueBob + s.cfg.pointsParrain, 'solde du parrain intact')
    } finally {
      await app.fermer()
    }
  })
})

// ---------- B. Relances (SQLite + trigger de panne, comme tests/correction-codex-point9.test.ts) ----------

describe('Revue Codex finale — B. reprise d’une tournée interrompue', () => {
  test('echecAutoDuJour : seulement un échec AUTOMATIQUE du même modèle, aujourd’hui (à Paris)', () => {
    const t = new Date('2026-11-10T11:00:00Z')
    const e = (o: Partial<Pick<EnvoiRelance, 'modele' | 'statut' | 'jour' | 'declencheur'>>) => ({ modele: 'inactif' as const, statut: 'erreur' as const, jour: '2026-11-10', declencheur: 'auto' as const, ...o })
    assert.equal(echecAutoDuJour('inactif', [e({})], t), true)
    assert.equal(echecAutoDuJour('inactif', [e({ declencheur: 'manuel' })], t), false, 'un échec manuel ne bloque pas l’automatique')
    assert.equal(echecAutoDuJour('inactif', [e({ jour: '2026-11-09' })], t), false, 'échec d’un autre jour')
    assert.equal(echecAutoDuJour('inactif', [e({ modele: 'anniversaire' })], t), false, 'autre modèle')
    assert.equal(echecAutoDuJour('inactif', [e({ statut: 'test' })], t), false)
    assert.equal(echecAutoDuJour('inactif', [e({ statut: 'refuse' })], t), false)
  })

  test('A échoue chez le prestataire, panne de stockage sur B → après réparation, le prestataire n’est PAS rappelé pour A, B est relancé', async () => {
    const t = new Date('2026-11-10T11:00:00Z')
    const appels: string[] = []
    // Prestataire simulé : refuse (HTTP 400, refus confirmé) tout envoi vers le numéro d'Ines (A).
    const fetchPrestataire = (async (_url: string, init: RequestInit) => {
      const corps = String(init.body)
      appels.push(corps)
      return corps.includes('611111111')
        ? new Response(JSON.stringify({ message: 'refusé' }), { status: 400 })
        : new Response(JSON.stringify({ sid: `SM${appels.length}` }), { status: 201 })
    }) as unknown as typeof globalThis.fetch
    const fichierDb = join(dossier, 'relances-revue.db')
    const app = await creerServeur({
      fichierDb,
      adminPin: ADMIN,
      pinInitial: '1234',
      version: 'test',
      urlPublique: 'https://asian-home-fidelite.onrender.com',
      maintenant: () => t,
      limitesPubliques: { inscriptionParIp: 1000, inscriptionParContact: 1000, ficheClientParIp: 1000, lectureParIp: 1000 },
      notifications: { twilio: { accountSid: 'ACtest', authToken: 'jeton-twilio-test', expediteur: '+33700000000' }, fetch: fetchPrestataire },
    })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
    const api = async (methode: string, chemin: string, corps?: unknown) => {
      const r = await globalThis.fetch(racine + chemin, { method: methode, headers: { 'Content-Type': 'application/json', ...PIN }, body: corps === undefined ? undefined : JSON.stringify(corps) })
      return { statut: r.status, contenu: await r.json() }
    }
    const ouvrirTableau = async () => {
      assert.equal((await api('GET', `/commerces/${AH}/etat`)).statut, 200)
      await app.relancesEnCours()
    }
    const versA = () => appels.filter((c) => c.includes('611111111')).length
    const versB = () => appels.filter((c) => c.includes('622222222')).length
    try {
      const il40 = new Date(t.getTime() - 40 * JOUR).toISOString()
      const ids: string[] = []
      for (const [prenom, contact] of [['Ines', '0611111111'], ['Jade', '0622222222']]) {
        const c = (await api('POST', `/commerces/${AH}/clients`, { prenom, contact, consentementRelance: true })).contenu.client as Client
        const st = ouvrirStockage(fichierDb)
        st.majClient({ ...st.client(AH, c.id)!, derniereVisite: il40, visites: [il40], tampons: 1 })
        st.fermer()
        ids.push(c.id)
      }
      const [a, b] = ids
      // Panne de stockage : la réservation de l'envoi de B (Jade) échoue.
      const db = new DatabaseSync(fichierDb)
      db.exec(`CREATE TRIGGER panne_b BEFORE INSERT ON envois WHEN NEW.client_id = '${b}' BEGIN SELECT RAISE(ABORT, 'panne simulée de la base'); END`)
      db.close()
      await api('PATCH', `/commerces/${AH}`, { relancesAuto: { inactif: true } })

      await ouvrirTableau()
      assert.equal(versA(), 1, 'A tenté une fois (échec prestataire)')
      assert.equal(versB(), 0, 'tournée interrompue sur B')
      const envoisA = ((await api('GET', `/commerces/${AH}/envois`)).contenu.envois as EnvoiRelance[]).filter((e) => e.clientId === a)
      assert.deepEqual(envoisA.map((e) => [e.statut, e.declencheur]), [['erreur', 'auto']])

      const db2 = new DatabaseSync(fichierDb)
      db2.exec('DROP TRIGGER panne_b')
      db2.close()
      await ouvrirTableau()
      assert.equal(versA(), 1, 'le prestataire n’est PAS rappelé pour A')
      assert.equal(versB(), 1, 'B est relancé')
      // Tournée menée à bien : plus rien le même jour.
      await ouvrirTableau()
      assert.equal(appels.length, 2)

      // Le renvoi MANUEL de A par le commerçant reste possible (il ne passe pas par la décision automatique).
      const manuel = await api('POST', `/commerces/${AH}/clients/${a}/relance`, { modele: 'inactif' })
      assert.notEqual(manuel.statut, 409, JSON.stringify(manuel.contenu))
      assert.equal(versA(), 2, 'appel manuel parti vers le prestataire')
    } finally {
      await app.fermer()
    }
  })
})

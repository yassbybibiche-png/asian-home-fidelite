// Correction Codex point 3 — changer le PIN d'un commerce (PUT /commerces/:id/pin) invalide les sessions
// `commerce` de CE commerce ouvertes avant : le jeton porte la version du PIN (`vp`), comparée à chaque requête à
// la version stockée dans `meta` (`version_pin:<commerce>`, absente = 0). Les sessions des autres commerces, les
// sessions admin et équipe ne sont pas touchées ; un jeton sans `vp` (émis avant la correction) vaut version 0.
//
// Revue Codex finale des points 1-3 (fin de fichier) : rotation dans une transaction, écritures conditionnelles
// (`majMetaSi`, `majPinSi`, `majCodeMembreSi`) — panne injectée (trigger SQLite `RAISE(ABORT)` ; 500 ciblé du faux
// PostgREST), deux rotations simultanées (barrière du faux PostgREST), re-hachage legacy et ouverture de session
// entrelacés avec une rotation (réponse du faux PostgREST retenue pendant la rotation).
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AddressInfo } from 'node:net'

import { creerServeur, emettreJeton, hacherPinAncien, lireJeton, type OptionsServeur } from '../server/app.ts'
import { ouvrirStockage } from '../server/stockage.ts'

const AH = 'c-asian-home-paris'
const ADMIN = '98765432'
const SECRET = 'secret-de-test-point3-au-moins-32-caracteres-0123456789'
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-point3-'))
const horloge = { t: new Date('2023-01-10T12:00:00Z') }

async function demarrer(nom: string, options: Partial<OptionsServeur> = {}) {
  const app = await creerServeur({
    fichierDb: join(dossier, nom),
    adminPin: ADMIN,
    pinInitial: '1234',
    version: 'test',
    secretSession: SECRET,
    authClient: 'stricte',
    maintenant: () => horloge.t,
    ...options,
  })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(`${racine}/api/v1${chemin}`, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    return { statut: r.status, contenu: (await r.json()) as Record<string, any> }
  }
  return { app, api }
}

describe('Correction Codex point 3 : changement de PIN commerçant ⇒ sessions invalidées', async () => {
  after(() => rmSync(dossier, { recursive: true, force: true }))

  test('le PUT /pin tue les sessions commerce de CE commerce, pas celles des autres, ni admin ni équipe', async () => {
    const s = await demarrer('point3.db')
    let avantRotation = ''
    let apresRotation = ''
    try {
      const etat = (id: string, jeton: string) => s.api('GET', `/commerces/${id}/etat`, undefined, { 'X-Session': jeton })
      const ouvrir = (corps: Record<string, string>) => s.api('POST', '/sessions', corps)

      const admin = (await ouvrir({ role: 'admin', pin: ADMIN })).contenu.jeton as string
      const autreId = (await s.api('POST', '/commerces', { nom: 'Chez Lin', type: 'restaurant', lienGoogle: '', pin: '5555' }, { 'X-Admin-PIN': ADMIN })).contenu.commerce.id as string
      const sessionAutre = (await ouvrir({ role: 'commerce', commerceId: autreId, pin: '5555' })).contenu.jeton as string
      const membre = await s.api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, { 'X-Commerce-PIN': '1234' })
      assert.equal(membre.statut, 201)
      const ouvertureEquipe = await ouvrir({ role: 'equipe', commerceId: AH, code: '2468' })
      assert.equal(ouvertureEquipe.statut, 201, 'session équipe ouverte')
      const equipe = ouvertureEquipe.contenu.jeton as string
      const ouverte = await ouvrir({ role: 'commerce', commerceId: AH, pin: '1234' })
      assert.equal(ouverte.statut, 201)
      assert.ok(!('vp' in ouverte.contenu), 'la charge du jeton n’est pas renvoyée')
      const session = ouverte.contenu.jeton as string
      avantRotation = session

      assert.equal((await etat(AH, session)).statut, 200)
      assert.equal((await etat(autreId, sessionAutre)).statut, 200)
      assert.equal((await etat(AH, admin)).statut, 200)
      assert.equal((await s.api('GET', `/commerces/${AH}/caisse`, undefined, { 'X-Session': equipe })).statut, 200)

      assert.equal((await s.api('PUT', `/commerces/${AH}/pin`, { pin: '5678' }, { 'X-Session': session })).statut, 200)

      const apres = await etat(AH, session)
      assert.equal(apres.statut, 401, 'la session d’avant le changement est morte')
      assert.match(apres.contenu.erreur ?? JSON.stringify(apres.contenu), /code du commerce a changé/)
      assert.equal((await ouvrir({ role: 'commerce', commerceId: AH, pin: '1234' })).statut, 401, 'ancien PIN mort')
      const nouvelle = await ouvrir({ role: 'commerce', commerceId: AH, pin: '5678' })
      assert.equal(nouvelle.statut, 201, 'nouveau PIN OK')
      assert.equal((await etat(AH, nouvelle.contenu.jeton)).statut, 200, 'la nouvelle session marche')
      apresRotation = nouvelle.contenu.jeton as string

      assert.equal((await etat(autreId, sessionAutre)).statut, 200, 'autre commerce non touché')
      assert.equal((await etat(AH, admin)).statut, 200, 'session admin non touchée')
      assert.equal((await s.api('GET', `/commerces/${AH}/caisse`, undefined, { 'X-Session': equipe })).statut, 200, 'session équipe non touchée')
    } finally {
      await s.app.fermer()
    }

    // Revue Codex point 6 — la version vit en base : après réouverture de la même base (cache mémoire vide), les MÊMES
    // jetons gardent leur sort. Celui d'avant la rotation (vp 0) reste refusé : la version relue vaut 1, pas 0 (si elle
    // repartait à 0, il redeviendrait valable et celui d'après tomberait). Celui d'après (vp 1) reste accepté.
    const s2 = await demarrer('point3.db')
    try {
      const etat2 = (jeton: string) => s2.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': jeton })
      assert.equal((await etat2(avantRotation)).statut, 401, 'jeton d’avant la rotation : toujours refusé après redémarrage')
      assert.equal((await etat2(apresRotation)).statut, 200, 'jeton d’après la rotation : toujours accepté après redémarrage')
      const nouvelle = (await s2.api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '5678' })).contenu.jeton as string
      assert.equal((await etat2(nouvelle)).statut, 200)
    } finally {
      await s2.app.fermer()
    }
  })

  test('jeton sans `vp` (émis avant la correction) = version 0 ; `vp` non entier refusé', async () => {
    const s = await demarrer('point3-ancien.db')
    try {
      const exp = Math.floor(horloge.t.getTime() / 1000) + 3600
      const ancien = emettreJeton(SECRET, { jti: randomUUID(), role: 'commerce', commerceId: AH, exp })
      assert.equal((await s.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': ancien })).statut, 200, 'ancien jeton accepté tant que le PIN n’a pas changé')
      const bidon = emettreJeton(SECRET, { jti: randomUUID(), role: 'commerce', commerceId: AH, exp, vp: '0' as unknown as number })
      assert.equal(lireJeton(SECRET, bidon), null)
      assert.equal((await s.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': bidon })).statut, 401)

      assert.equal((await s.api('PUT', `/commerces/${AH}/pin`, { pin: '5678' }, { 'X-Admin-PIN': ADMIN })).statut, 200)
      assert.equal((await s.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': ancien })).statut, 401, 'ancien jeton mort après changement de PIN')
      const ancienV1 = emettreJeton(SECRET, { jti: randomUUID(), role: 'commerce', commerceId: AH, exp, vp: 1 })
      assert.equal((await s.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': ancienV1 })).statut, 200, 'version courante acceptée')
    } finally {
      await s.app.fermer()
    }
  })

  // ---------- Revue Codex finale (points 3 et 4), SQLite ----------

  test('revue Codex : écritures conditionnelles du stockage SQLite (majMetaSi)', () => {
    const st = ouvrirStockage(':memory:')
    try {
      assert.equal(st.majMetaSi('k', undefined, '1'), true, 'clé absente : insérée')
      assert.equal(st.majMetaSi('k', undefined, '1'), false, 'clé déjà présente : refusé')
      assert.equal(st.majMetaSi('k', '0', '2'), false, 'valeur attendue périmée : refusé')
      assert.equal(st.meta('k'), '1')
      assert.equal(st.majMetaSi('k', '1', '2'), true)
      assert.equal(st.meta('k'), '2')
    } finally {
      st.fermer()
    }
  })

  test('revue Codex point 3 (SQLite) : panne pendant la rotation → tout est annulé (ancien PIN, anciennes sessions), jamais l’état intermédiaire', async () => {
    const s = await demarrer('point3-panne.db')
    const db = new DatabaseSync(join(dossier, 'point3-panne.db'))
    try {
      const ouvrir = (pin: string) => s.api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin })
      const etat = (jeton: string) => s.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': jeton })
      const version = () => (db.prepare('SELECT valeur FROM meta WHERE cle = ?').get(`version_pin:${AH}`) as { valeur: string } | undefined)?.valeur
      const panneMeta = [
        `CREATE TRIGGER panne_meta_i BEFORE INSERT ON meta WHEN NEW.cle LIKE 'version_pin:%' BEGIN SELECT RAISE(ABORT, 'panne injectée'); END`,
        `CREATE TRIGGER panne_meta_u BEFORE UPDATE ON meta WHEN NEW.cle LIKE 'version_pin:%' BEGIN SELECT RAISE(ABORT, 'panne injectée'); END`,
      ]
      const pannePin = [`CREATE TRIGGER panne_pin BEFORE UPDATE OF pin_hash ON commerces BEGIN SELECT RAISE(ABORT, 'panne injectée'); END`]
      const reparer = () => ['panne_meta_i', 'panne_meta_u', 'panne_pin'].forEach((t) => db.exec(`DROP TRIGGER IF EXISTS ${t}`))

      /** Rotation `pinActuel` → `pinVise` en panne : l'état observable doit rester exactement celui d'avant. */
      async function rotationEnPanne(quoi: string, triggers: string[], session: string, pinActuel: string, pinVise: string) {
        const versionAvant = version()
        triggers.forEach((t) => db.exec(t))
        try {
          const r = await s.api('PUT', `/commerces/${AH}/pin`, { pin: pinVise }, { 'X-Session': session })
          assert.equal(r.statut, 500, `${quoi} : la rotation échoue`)
        } finally {
          reparer()
        }
        assert.equal(version(), versionAvant, `${quoi} : version inchangée (transaction annulée)`)
        assert.equal((await etat(session)).statut, 200, `${quoi} : session d'avant toujours valable (le PIN n'a pas changé)`)
        assert.equal((await ouvrir(pinActuel)).statut, 201, `${quoi} : l'ancien PIN reste le PIN`)
        assert.equal((await ouvrir(pinVise)).statut, 401, `${quoi} : le nouveau PIN n'a pas été écrit`)
      }

      const session = (await ouvrir('1234')).contenu.jeton as string
      await rotationEnPanne('panne sur la version (clé absente : INSERT)', panneMeta, session, '1234', '5678')
      await rotationEnPanne('panne sur le PIN, après la version', pannePin, session, '1234', '5678')

      // Réparé : la rotation passe, puis panne sur la version déjà présente (chemin UPDATE).
      assert.equal((await s.api('PUT', `/commerces/${AH}/pin`, { pin: '5678' }, { 'X-Session': session })).statut, 200)
      assert.equal(version(), '1')
      assert.equal((await etat(session)).statut, 401, 'rotation réussie : la session d’avant tombe')
      const session2 = (await ouvrir('5678')).contenu.jeton as string
      await rotationEnPanne('panne sur la version (clé présente : UPDATE)', panneMeta, session2, '5678', '2468')
      await rotationEnPanne('panne sur le PIN, version présente', pannePin, session2, '5678', '2468')
    } finally {
      db.close()
      await s.app.fermer()
    }
  })

  test('revue Codex point 4 (SQLite) : deux rotations simultanées sont sérialisées — deux versions distinctes, le dernier PIN gagne', async () => {
    const s = await demarrer('point3-concurrence.db')
    const db = new DatabaseSync(join(dossier, 'point3-concurrence.db'))
    try {
      const ouvrir = (pin: string) => s.api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin })
      const session = (await ouvrir('1234')).contenu.jeton as string
      const [a, b] = await Promise.all(['1111', '2222'].map((pin) => s.api('PUT', `/commerces/${AH}/pin`, { pin }, { 'X-Admin-PIN': ADMIN })))
      assert.deepEqual([a.statut, b.statut], [200, 200])
      const v = db.prepare('SELECT valeur FROM meta WHERE cle = ?').get(`version_pin:${AH}`) as { valeur: string }
      assert.equal(v.valeur, '2', 'chaque rotation a sa propre version (relue dans la transaction)')
      const ok = [(await ouvrir('1111')).statut, (await ouvrir('2222')).statut].sort()
      assert.deepEqual(ok, [201, 401], 'exactement un des deux PIN est en place')
      assert.equal((await s.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': session })).statut, 401)
    } finally {
      db.close()
      await s.app.fermer()
    }
  })
})

// ---------- Revue Codex finale (points 1 à 4), Supabase : faux PostgREST ----------
// Recopié de tests/correction-codex-revue.test.ts (lui-même de correction-codex-point2), avec trois ajouts : panne
// ciblée (500 une fois sur méthode + table), barrière (retient les n premières requêtes visées puis les libère ensemble,
// comme `f.barriere` de tests/supabase.test.ts) et réponse retenue (`retenir` : la requête est servie — instantané pris —
// mais sa réponse n'est rendue qu'à `liberer()`, ce qui force un entrelacement précis avec une autre requête HTTP).

type Ligne = Record<string, unknown>
type Unicite = { nom: string; cle: (l: Ligne) => string | null }
const URL_SB = 'https://projet-factice.supabase.co'
const CLE = 'cle-service-role-factice' // pas une vraie clé
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
  let panneCiblee: { methode: string; table: string } | undefined
  let barriere: { methode: string; table: string; n: number; enAttente: (() => void)[] } | undefined
  type Filtre = (methode: string, table: string, params: URLSearchParams) => boolean
  let retenue: { filtre: Filtre; arrivee: () => void; liberation: Promise<void> } | undefined

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

  function traiter(methode: string, table: string, params: URLSearchParams, entetes: Headers, corps: unknown): Response {
    if (entetes.get('apikey') !== CLE || entetes.get('authorization') !== `Bearer ${CLE}`) return erreur(401, 'PGRST301', 'clé absente')
    if (panneCiblee && panneCiblee.methode === methode && panneCiblee.table === table) {
      panneCiblee = undefined // 500 non-conflit, une seule fois. Pas 503/520 : supabase-js réessaierait.
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
    if (barriere && barriere.methode === methode && barriere.table === table) {
      const b = barriere
      await new Promise<void>((ok) => {
        b.enAttente.push(ok)
        if (b.enAttente.length >= b.n) {
          barriere = undefined
          b.enAttente.forEach((f) => f())
        }
      })
    }
    const reponse = traiter(methode, table, url.searchParams, new Headers(init?.headers), corps)
    if (retenue && retenue.filtre(methode, table, url.searchParams)) {
      const r = retenue
      retenue = undefined
      r.arrivee()
      await r.liberation
    }
    return reponse
  }

  return {
    fetch: fauxFetch as typeof fetch,
    tables,
    panne: (methode: string, table: string) => void (panneCiblee = { methode, table }),
    barriere: (methode: string, table: string, n = 2) => void (barriere = { methode, table, n, enAttente: [] }),
    /** La 1re requête qui passe `filtre` est servie, mais sa réponse attend `liberer()` ; `arrivee` : elle a été servie. */
    retenir(filtre: Filtre) {
      let arrivee!: () => void
      let liberer!: () => void
      const servie = new Promise<void>((ok) => (arrivee = ok))
      retenue = { filtre, arrivee, liberation: new Promise<void>((ok) => (liberer = ok)) }
      return { arrivee: servie, liberer }
    },
  }
}

describe('Revue Codex finale points 1-4 (Supabase, faux PostgREST) : rotation fermée, re-hachage et ouverture de session entrelacés', () => {
  const dossierSb = mkdtempSync(join(tmpdir(), 'fidelite-point3-sb-'))
  after(() => rmSync(dossierSb, { recursive: true, force: true }))

  async function demarrerSb(f: ReturnType<typeof fauxPostgrest>) {
    const app = await creerServeur({
      fichierDb: join(dossierSb, 'ne-doit-pas-exister.db'),
      supabase: { url: URL_SB, cleServiceRole: CLE, fetch: f.fetch },
      adminPin: ADMIN,
      pinInitial: '1234',
      version: 'test',
      secretSession: SECRET,
      authClient: 'stricte',
      maintenant: () => horloge.t,
    })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
    async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
      const r = await fetch(racine + chemin, {
        method: methode,
        headers: { 'Content-Type': 'application/json', ...entetes },
        body: corps === undefined ? undefined : JSON.stringify(corps),
      })
      return { statut: r.status, contenu: (await r.json()) as Record<string, any> }
    }
    const ouvrir = (pin: string) => api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin })
    const ouvrirEquipe = (code: string) => api('POST', '/sessions', { role: 'equipe', commerceId: AH, code })
    const etat = (jeton: string) => api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': jeton })
    const changerPin = (pin: string) => api('PUT', `/commerces/${AH}/pin`, { pin }, { 'X-Admin-PIN': ADMIN })
    const version = () => f.tables.meta.find((l) => l.cle === `version_pin:${AH}`)?.valeur
    return { app, api, ouvrir, ouvrirEquipe, etat, changerPin, version }
  }

  test('point 4 : deux rotations simultanées (même version relue) → une seule passe, l’autre 409 ; jamais la même version écrite deux fois', async () => {
    const f = fauxPostgrest()
    const s = await demarrerSb(f)
    try {
      const session = (await s.ouvrir('1234')).contenu.jeton as string
      // Les deux rotations ont relu la version (absente) avant que l'une n'écrive : leurs écritures arrivent ensemble.
      f.barriere('POST', 'meta')
      const [a, b] = await Promise.all([s.changerPin('1111'), s.changerPin('2222')])
      assert.deepEqual([a.statut, b.statut].sort(), [200, 409], 'la perdante échoue proprement')
      assert.equal(s.version(), '1')
      const [gagnant, perdant] = a.statut === 200 ? ['1111', '2222'] : ['2222', '1111']
      assert.equal((await s.ouvrir(gagnant)).statut, 201, 'le PIN de la gagnante est en place')
      assert.equal((await s.ouvrir(perdant)).statut, 401, 'celui de la perdante n’a pas été écrit')
      assert.equal((await s.etat(session)).statut, 401, 'la session d’avant est morte')

      // Même chose quand la version existe déjà (chemin UPDATE conditionnel) : relue à 1 par les deux, une seule passe à 2.
      f.barriere('PATCH', 'meta')
      const [c, d] = await Promise.all([s.changerPin('3333'), s.changerPin('4444')])
      assert.deepEqual([c.statut, d.statut].sort(), [200, 409])
      assert.equal(s.version(), '2')
    } finally {
      await s.app.fermer()
    }
  })

  test('point 4 : rotation B complète entre la version et le PIN de la rotation A → A échoue (409), son PIN n’écrase pas celui de B', async () => {
    const f = fauxPostgrest()
    const s = await demarrerSb(f)
    try {
      // A a écrit la version (0 → 1) ; sa réponse est retenue avant l'écriture de son PIN.
      const tenue = f.retenir((m, t) => m === 'POST' && t === 'meta')
      const rotationA = s.changerPin('1111')
      await tenue.arrivee
      // B relit la version 1 et le PIN d'origine, passe la version à 2 et écrit son PIN.
      assert.equal((await s.changerPin('2222')).statut, 200)
      const sessionB = (await s.ouvrir('2222')).contenu.jeton as string
      tenue.liberer()
      // A attendait encore le PIN d'origine : il a changé → conflit, rien n'est écrasé.
      assert.equal((await rotationA).statut, 409)
      assert.equal(s.version(), '2')
      assert.equal((await s.ouvrir('1111')).statut, 401, 'le PIN de A n’a pas été écrit')
      assert.equal((await s.etat(sessionB)).statut, 200, 'la session ouverte avec le PIN en place reste valable')
    } finally {
      await s.app.fermer()
    }
  })

  test('point 3 : panne sur l’une des deux écritures → état fermé (version écrite d’abord : sessions mortes, jamais nouveau PIN + sessions vivantes)', async () => {
    const f = fauxPostgrest()
    const s = await demarrerSb(f)
    try {
      const session = (await s.ouvrir('1234')).contenu.jeton as string

      // Panne sur la version (1re écriture) : rien n'est écrit — ancien PIN, anciennes sessions.
      f.panne('POST', 'meta')
      assert.equal((await s.changerPin('5678')).statut, 500)
      assert.equal(s.version(), undefined)
      assert.equal((await s.etat(session)).statut, 200, 'rien n’a changé : la session vit')
      assert.equal((await s.ouvrir('5678')).statut, 401, 'nouveau PIN pas écrit')

      // Panne sur le PIN (2e écriture, Supabase n'a pas de transaction multi-requêtes) : la version est déjà passée,
      // les sessions sont mortes, l'ancien PIN reste le PIN. Jamais l'inverse.
      f.panne('PATCH', 'commerces')
      assert.equal((await s.changerPin('5678')).statut, 500)
      assert.equal(s.version(), '1')
      assert.equal((await s.etat(session)).statut, 401, 'sessions d’avant mortes')
      assert.equal((await s.ouvrir('5678')).statut, 401, 'nouveau PIN pas écrit')
      const nouvelle = await s.ouvrir('1234')
      assert.equal(nouvelle.statut, 201, 'l’ancien PIN reste le PIN : le gérant se reconnecte et refait le changement')
      assert.equal((await s.etat(nouvelle.contenu.jeton)).statut, 200)
      assert.equal((await s.changerPin('5678')).statut, 200, 'la rotation rejouée passe')
      assert.equal(s.version(), '2')
      assert.equal((await s.etat(nouvelle.contenu.jeton)).statut, 401)
    } finally {
      await s.app.fermer()
    }
  })

  test('points 1 et 2 : connexion à l’ancien PIN (format legacy) entrelacée avec une rotation → nouveau PIN pas écrasé, aucun jeton émis', async () => {
    const f = fauxPostgrest()
    const s = await demarrerSb(f)
    try {
      const ancien = hacherPinAncien('1234')
      Object.assign(f.tables.commerces.find((l) => l.id === AH)!, { pin_hash: ancien.hash, pin_sel: ancien.sel })

      // La connexion lit le PIN (ancien format) ; sa réponse est retenue pendant toute une rotation.
      const tenue = f.retenir((m, t, p) => m === 'GET' && t === 'commerces' && p.get('select') === 'pin_hash,pin_sel')
      const ouverture = s.ouvrir('1234')
      await tenue.arrivee
      assert.equal((await s.changerPin('5678')).statut, 200, 'rotation terminée pendant la vérification')
      tenue.liberer()
      const r = await ouverture

      // Point 2 : le PIN vérifié était l'ancien, la version a changé pendant → pas de jeton (sinon il porterait vp 1).
      assert.equal(r.statut, 401)
      assert.match(String(r.contenu.erreur), /vient de changer/)
      // Point 1 : le re-hachage (conditionné au hash vérifié) n'a pas écrasé le nouveau PIN.
      assert.equal((await s.ouvrir('1234')).statut, 401, 'l’ancien PIN ne revient pas')
      const nouvelle = await s.ouvrir('5678')
      assert.equal(nouvelle.statut, 201, 'le nouveau PIN est toujours en place')
      assert.equal((await s.etat(nouvelle.contenu.jeton)).statut, 200)
      assert.equal(s.version(), '1')
    } finally {
      await s.app.fermer()
    }
  })

  test('point 1 (code équipe) : re-hachage legacy entrelacé avec un changement de code → le nouveau code n’est pas écrasé, la connexion réussit', async () => {
    const f = fauxPostgrest()
    const s = await demarrerSb(f)
    try {
      const cree = await s.api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, { 'X-Admin-PIN': ADMIN })
      assert.equal(cree.statut, 201)
      const id = cree.contenu.membre.id as string
      const ancien = hacherPinAncien('2468')
      Object.assign(f.tables.equipe.find((l) => l.id === id)!, { code_hash: ancien.hash, code_sel: ancien.sel })

      const tenue = f.retenir((m, t, p) => m === 'GET' && t === 'equipe' && p.get('select') === 'donnees,code_hash,code_sel')
      const ouverture = s.ouvrirEquipe('2468')
      await tenue.arrivee
      const maj = await s.api('PATCH', `/commerces/${AH}/equipe/${id}`, { nom: 'Mai L.', code: '1357' }, { 'X-Admin-PIN': ADMIN })
      assert.equal(maj.statut, 200, 'code changé pendant la vérification')
      tenue.liberer()
      // La connexion a réussi sur l'état vérifié : on ne la fait pas échouer (sessions équipe hors version de PIN).
      assert.equal((await ouverture).statut, 201)

      assert.equal((await s.ouvrirEquipe('2468')).statut, 401, 'l’ancien code ne revient pas')
      const nouvelle = await s.ouvrirEquipe('1357')
      assert.equal(nouvelle.statut, 201, 'le nouveau code est toujours en place')
      assert.equal(nouvelle.contenu.membreNom, 'Mai L.', 'le nom changé n’a pas été écrasé non plus')
    } finally {
      await s.app.fermer()
    }
  })
})

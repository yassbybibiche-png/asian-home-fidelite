// Item D (améliorations 12/11) : sauvegarde complète téléchargeable par l'admin (`GET /api/v1/admin/sauvegarde`,
// bouton de l'écran Admin). Même export (`exporterSauvegarde`), même format `.json.gz` et même chiffrement que le CLI
// `scripts/sauvegarde-base.mjs` ; l'archive reçue se restaure avec `restaurerSauvegarde` / `scripts/restaurer-base.mjs`.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { gunzipSync } from 'node:zlib'
import type { AddressInfo } from 'node:net'
import { PGlite } from '@electric-sql/pglite'

import { creerServeur } from '../server/app.ts'
import {
  FORMAT_SAUVEGARDE, PREFIXE_CHIFFRE, SQL_ROLES_SUPABASE, TABLES_SAUVEGARDE, dechiffrerSauvegarde, ecrireTableSql,
  exporterSauvegarde, lireTableSql, migrationsARejouer, restaurerSauvegarde, validerSauvegarde, type Ligne, type Sauvegarde,
} from '../server/sauvegarde.ts'
import { ouvrirStockageSupabase } from '../server/stockage-supabase.ts'
import { nomPieceJointe } from '../src/data/api.ts'

const RACINE = join(import.meta.dirname, '..')
const MIGRATIONS = join(RACINE, 'supabase', 'migrations')
const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const CLE = 'c3'.repeat(32) // clé de test (64 hex), jamais une vraie clé
const CHEMIN = '/admin/sauvegarde'

type Serveur = Awaited<ReturnType<typeof creerServeur>>

async function demarrer(dossier: string, cle?: string): Promise<{ app: Serveur; base: string; fichierDb: string }> {
  const fichierDb = join(dossier, 'fidelite.db')
  const app = await creerServeur({
    fichierDb, adminPin: ADMIN, pinInitial: '1234', version: 'test', secretSession: 's'.repeat(40), cleChiffrementSauvegarde: cle,
  })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  return { app, base: `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`, fichierDb }
}

function appel(base: string, methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
  return fetch(base + chemin, {
    method: methode,
    headers: { 'Content-Type': 'application/json', ...entetes },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  })
}

/** Remplit la base par l'API : un membre d'équipe (code haché), deux clients, une visite, des entrées de journal. */
async function remplir(base: string) {
  assert.equal((await appel(base, 'POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)).status, 201)
  const lea = await appel(base, 'POST', `/commerces/${AH}/clients`, { prenom: 'Léa', contact: '0612345678' }, PIN)
  assert.equal(lea.status, 201)
  const id = ((await lea.json()) as { client: { id: string } }).client.id
  assert.equal((await appel(base, 'POST', `/commerces/${AH}/clients`, { prenom: 'Tom', contact: 'tom@exemple.fr' }, PIN)).status, 201)
  assert.equal((await appel(base, 'POST', `/commerces/${AH}/clients/${id}/visite`, undefined, PIN)).status, 200)
}

/** PGlite avec les rôles Supabase et toutes les migrations (même patron que tests/sauvegarde-p0-s5.test.ts). */
async function baseVide(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(SQL_ROLES_SUPABASE)
  for (const f of migrationsARejouer(readdirSync(MIGRATIONS))) await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'))
  return db
}

/** Dates ISO comparées en instant (SQLite garde le texte `…Z`, Postgres renvoie `…+00:00`). */
const normaliser = (v: unknown): unknown =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? new Date(v).getTime() : v

/** Lance un script avec un environnement minimal (asynchrone, comme dans sauvegarde-p0-s5). */
function lancer(script: string, args: string[], env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((ok) => {
    execFile(process.execPath, [join(RACINE, 'scripts', script), ...args], {
      cwd: RACINE, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env }, timeout: 60_000,
    }, (err, stdout, stderr) => ok({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr }))
  })
}

describe('Item D : GET /admin/sauvegarde — réservé à l’admin', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'sauvegarde-admin-garde-'))
  let s: Awaited<ReturnType<typeof demarrer>>
  before(async () => {
    s = await demarrer(dossier)
    assert.equal((await appel(s.base, 'POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)).status, 201)
  })
  after(async () => {
    await s.app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  const sansArchive = async (r: Response) => {
    assert.equal(r.headers.get('content-disposition'), null)
    assert.match(r.headers.get('content-type') ?? '', /^application\/json/)
    return ((await r.json()) as { erreur: string }).erreur
  }

  test('sans authentification, PIN commerce en en-tête ou mauvais PIN admin → 401, aucune archive', async () => {
    for (const entetes of [{}, PIN, { 'X-Admin-PIN': '11111111' }]) {
      const r = await appel(s.base, 'GET', CHEMIN, undefined, entetes)
      assert.equal(r.status, 401, JSON.stringify(entetes))
      await sansArchive(r)
    }
  })

  test('session commerce ou session équipe → 403 (convention de exigerAdmin), aucune archive', async () => {
    const commerce = await appel(s.base, 'POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '1234' })
    const equipe = await appel(s.base, 'POST', '/sessions', { role: 'equipe', commerceId: AH, code: '2468' })
    for (const ouverte of [commerce, equipe]) {
      assert.equal(ouverte.status, 201)
      const { jeton } = (await ouverte.json()) as { jeton: string }
      const r = await appel(s.base, 'GET', CHEMIN, undefined, { 'X-Session': jeton })
      assert.equal(r.status, 403)
      assert.match(await sansArchive(r), /ne donne pas accès/)
    }
  })

  test('PIN admin en en-tête ou session admin → 200, pièce jointe .json.gz', async () => {
    const session = (await (await appel(s.base, 'POST', '/sessions', { role: 'admin', pin: ADMIN })).json()) as { jeton: string }
    for (const entetes of [{ 'X-Admin-PIN': ADMIN }, { 'X-Session': session.jeton }]) {
      const r = await appel(s.base, 'GET', CHEMIN, undefined, entetes)
      assert.equal(r.status, 200)
      assert.equal(r.headers.get('content-type'), 'application/gzip')
      assert.equal(r.headers.get('cache-control'), 'no-store')
      assert.match(r.headers.get('content-disposition') ?? '', /^attachment; filename="asian-home-\d{4}-\d{2}-\d{2}T\d{6}\.json\.gz"$/)
      assert.equal(JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8')).format, FORMAT_SAUVEGARDE)
    }
  })

  test('autre méthode que GET → 405', async () => {
    assert.equal((await appel(s.base, 'POST', CHEMIN, {}, { 'X-Admin-PIN': ADMIN })).status, 405)
  })
})

describe('Item D : archive en clair (sans SAUVEGARDE_CLE_CHIFFREMENT) — format, restauration, avertissement', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'sauvegarde-admin-clair-'))
  let s: Awaited<ReturnType<typeof demarrer>>
  let octets: Buffer
  let nom = ''
  let sauvegarde: Sauvegarde
  const avertissements: string[] = []
  let cible: PGlite

  before(async () => {
    s = await demarrer(dossier)
    await remplir(s.base)
    const warn = console.warn
    console.warn = (...args: unknown[]) => void avertissements.push(args.map(String).join(' '))
    try {
      const r = await appel(s.base, 'GET', CHEMIN, undefined, { 'X-Admin-PIN': ADMIN })
      assert.equal(r.status, 200)
      nom = nomPieceJointe(r.headers.get('content-disposition'))
      octets = Buffer.from(await r.arrayBuffer())
    } finally {
      console.warn = warn
    }
    sauvegarde = JSON.parse(gunzipSync(octets).toString('utf8')) as Sauvegarde
    cible = await baseVide()
  })
  after(async () => {
    await cible.close()
    await s.app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('JSON gzip en clair, format du CLI : en-tête, les 15 tables, compteurs = lignes', () => {
    assert.match(nom, /^asian-home-\d{4}-\d{2}-\d{2}T\d{6}\.json\.gz$/)
    assert.equal(nom, `asian-home-${sauvegarde.creeLe.slice(0, 19).replace(/:/g, '')}.json.gz`, 'nom = horodatage de l’export, comme le CLI')
    assert.ok(gunzipSync(octets).toString('utf8').startsWith('{'), 'pas de préfixe de chiffrement')
    assert.equal(sauvegarde.format, FORMAT_SAUVEGARDE)
    assert.equal(sauvegarde.version, 1)
    assert.deepEqual(Object.keys(sauvegarde.tables), TABLES_SAUVEGARDE.map((t) => t.nom))
    assert.equal(Object.keys(sauvegarde.tables).length, 15)
    for (const { nom: t } of TABLES_SAUVEGARDE) assert.equal(sauvegarde.compteurs[t], sauvegarde.tables[t].length, t)
    assert.deepEqual(validerSauvegarde(sauvegarde), { manquantes: [] })
    // Données réellement présentes, colonnes sensibles comprises (sauvegarde complète).
    assert.equal(sauvegarde.tables.clients.length, 2)
    assert.equal(sauvegarde.tables.equipe.length, 1)
    assert.match(String(sauvegarde.tables.equipe[0].code_hash), /^scrypt\$v1\$/)
    assert.match(String(sauvegarde.tables.commerces[0].pin_hash), /^scrypt\$v1\$/)
    assert.ok(sauvegarde.tables.journal.length >= 2, 'journal : membre ajouté + visite')
    assert.ok(sauvegarde.tables.meta.some((l) => l.cle === 'initialise'))
  })

  test('une ligne d’avertissement « non chiffrée » dans le journal serveur', () => {
    assert.equal(avertissements.filter((l) => /\[sauvegarde\] AVERTISSEMENT — sauvegarde non chiffrée téléchargée/.test(l)).length, 1)
  })

  test('restauration par `restaurerSauvegarde` dans une PGlite vide : compteurs et données identiques', async () => {
    const ecrits = await cible.transaction((tx) => restaurerSauvegarde(sauvegarde, ecrireTableSql((q, p) => tx.query(q, p))))
    assert.deepEqual(ecrits, sauvegarde.compteurs)
    for (const t of TABLES_SAUVEGARDE) {
      const relues = await lireTableSql((q, p) => cible.query(q, p))(t.nom)
      assert.equal(relues.length, sauvegarde.tables[t.nom].length, t.nom)
      for (const ligne of sauvegarde.tables[t.nom]) {
        const cle = (l: Ligne) => t.cle.map((c) => String(l[c])).join('|')
        const restauree = relues.find((l) => cle(l) === cle(ligne))
        assert.ok(restauree, `${t.nom} ${cle(ligne)} restaurée`)
        // Toutes les colonnes de l'archive, à l'identique (objets `donnees` compris ; dates comparées en instant).
        for (const [col, v] of Object.entries(ligne)) {
          if (col === 'donnees') assert.deepEqual(restauree[col], v, `${t.nom}.${col}`)
          else assert.deepEqual(normaliser(restauree[col]), normaliser(v), `${t.nom}.${col}`)
        }
      }
    }
    // Ordre d'inscription conservé (colonne `ordre` recréée par Postgres dans l'ordre de l'archive).
    const ordre = await cible.query<{ prenom: string }>(`select donnees->>'prenom' as prenom from public.clients order by ordre`)
    assert.deepEqual(ordre.rows.map((r) => r.prenom), ['Léa', 'Tom'])
  })

  test('l’archive téléchargée se restaure aussi avec scripts/restaurer-base.mjs --verifier, comme celle du CLI', async () => {
    const fichier = join(dossier, nom)
    writeFileSync(fichier, octets)
    const r = await lancer('restaurer-base.mjs', [fichier, '--cible', 'pglite', '--verifier'])
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /RESTAURATION OK/)
    assert.match(r.stdout, /VÉRIFICATION OK — compteurs de la base = compteurs du fichier, pour les 15 tables\./)
  })
})

describe('Item D : archive chiffrée (SAUVEGARDE_CLE_CHIFFREMENT définie)', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'sauvegarde-admin-chiffree-'))
  let s: Awaited<ReturnType<typeof demarrer>>
  after(async () => {
    await s.app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('archive chiffrée AES-256-GCM, sans donnée en clair ni avertissement ; déchiffrable et restaurable', async () => {
    s = await demarrer(dossier, CLE)
    await remplir(s.base)
    const avertissements: string[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]) => void avertissements.push(args.map(String).join(' '))
    let r: Response
    let octets: Buffer
    try {
      r = await appel(s.base, 'GET', CHEMIN, undefined, { 'X-Admin-PIN': ADMIN })
      octets = Buffer.from(await r.arrayBuffer())
    } finally {
      console.warn = warn
    }
    assert.equal(r.status, 200)
    assert.deepEqual(avertissements.filter((l) => /\[sauvegarde\]/.test(l)), [])
    const contenu = gunzipSync(octets).toString('utf8')
    assert.ok(contenu.startsWith(PREFIXE_CHIFFRE), 'chiffré')
    assert.ok(!contenu.includes('0612345678') && !contenu.includes('scrypt$v1$') && !contenu.includes(CLE), 'aucune donnée ni clé en clair')
    const relue = JSON.parse(dechiffrerSauvegarde(contenu, CLE)) as Sauvegarde
    assert.equal(relue.format, FORMAT_SAUVEGARDE)
    assert.equal(Object.keys(relue.tables).length, 15)
    assert.equal(relue.tables.clients.length, 2)

    // Même procédé que le CLI : restaurer-base.mjs le déchiffre avec la clé, le refuse sans.
    const fichier = join(dossier, nomPieceJointe(r.headers.get('content-disposition')))
    writeFileSync(fichier, octets)
    const ok = await lancer('restaurer-base.mjs', [fichier, '--cible', 'pglite', '--verifier'], { SAUVEGARDE_CLE_CHIFFREMENT: CLE })
    assert.equal(ok.code, 0, ok.stderr)
    assert.match(ok.stdout, /VÉRIFICATION OK/)
    assert.ok(!(ok.stdout + ok.stderr).includes(CLE))
    const sansCle = await lancer('restaurer-base.mjs', [fichier, '--cible', 'pglite'])
    assert.equal(sansCle.code, 1)
    assert.match(sansCle.stderr, /sauvegarde chiffrée : définissez SAUVEGARDE_CLE_CHIFFREMENT/)
  })
})

describe('Item D : jamais d’archive partielle', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'sauvegarde-admin-partielle-'))
  let s: Awaited<ReturnType<typeof demarrer>>
  before(async () => {
    s = await demarrer(dossier)
  })
  after(async () => {
    await s.app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('table métier absente (SQLite) → 500 « ERREUR SAUVEGARDE » nommant la table, aucune archive', async () => {
    const db = new DatabaseSync(s.fichierDb)
    db.exec('DROP TABLE envois')
    db.close()
    const erreurs: string[] = []
    const error = console.error
    console.error = (...args: unknown[]) => void erreurs.push(args.map(String).join(' '))
    let r: Response
    try {
      r = await appel(s.base, 'GET', CHEMIN, undefined, { 'X-Admin-PIN': ADMIN })
    } finally {
      console.error = error
    }
    assert.equal(r.status, 500)
    assert.equal(r.headers.get('content-disposition'), null)
    assert.match(r.headers.get('content-type') ?? '', /^application\/json/)
    const { erreur } = (await r.json()) as { erreur: string }
    assert.match(erreur, /^ERREUR SAUVEGARDE — table « envois » absente \(migration non appliquée \?\) — sauvegarde refusée/)
    assert.ok(erreurs.some((l) => /\[sauvegarde\] ERREUR SAUVEGARDE — table « envois » absente/.test(l)))
  })

  test('stockage Supabase : même lecture que le CLI — table absente (PGRST205) → export refusé ; compteur faux → refusé', async () => {
    const lignes: Record<string, Ligne[]> = Object.fromEntries(TABLES_SAUVEGARDE.map((t) => [t.nom, [] as Ligne[]]))
    lignes.clients = [{ id: 'k1', commerce_id: 'c1', cle_contact: '0612345678', donnees: { id: 'k1' }, ordre: 1, version: 1 }]
    let absente: string | undefined
    let compteurFaux = false
    const requetes: string[] = []
    const fauxFetch = (async (entree: string | URL | Request) => {
      const u = new URL(entree instanceof Request ? entree.url : String(entree))
      const table = u.pathname.replace('/rest/v1/', '')
      requetes.push(`${table}${u.search}`)
      if (table === absente) {
        return new Response(JSON.stringify({ code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` }), { status: 404, headers: { 'content-type': 'application/json' } })
      }
      const n = lignes[table].length
      return new Response(JSON.stringify(lignes[table]), {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-range': n ? `0-${n - 1}/${compteurFaux ? n + 1 : n}` : `*/${n}` },
      })
    }) as typeof fetch
    const st = ouvrirStockageSupabase({ url: 'http://supabase.test', cleServiceRole: 'cle-de-test', fetch: fauxFetch })

    const ok = await exporterSauvegarde((t) => st.lireTableSauvegarde(t))
    assert.deepEqual(ok.tables.clients, lignes.clients)
    assert.equal(Object.keys(ok.tables).length, 15)
    assert.ok(requetes.some((q) => q.startsWith('clients?') && q.includes('order=id.asc') && q.includes('offset=0')), requetes.join('\n'))

    absente = 'tirages'
    await assert.rejects(exporterSauvegarde((t) => st.lireTableSauvegarde(t)), /table « tirages » absente/)
    absente = undefined
    compteurFaux = true
    await assert.rejects(exporterSauvegarde((t) => st.lireTableSauvegarde(t)), /table « clients » : 1 lignes lues pour 2 comptées/)
  })
})

describe('Item D : front (écran Admin, API)', () => {
  const source = (f: string) => readFileSync(join(RACINE, f), 'utf8')

  test('nomPieceJointe : nom du Content-Disposition, sinon nom daté du même format', () => {
    assert.equal(nomPieceJointe('attachment; filename="asian-home-2026-11-12T030000.json.gz"'), 'asian-home-2026-11-12T030000.json.gz')
    assert.equal(nomPieceJointe(null, new Date('2026-11-12T03:04:05Z')), 'asian-home-2026-11-12T030405.json.gz')
  })

  test('bouton « Télécharger une sauvegarde » (mode API) branché sur api.sauvegarde + telecharger (blob)', () => {
    const admin = source('src/pages/Admin.tsx')
    assert.match(admin, /Télécharger une sauvegarde/)
    assert.match(admin, /api\.sauvegarde\(acces\)/)
    assert.match(admin, /telecharger\(r\.valeur\.nom, r\.valeur\.contenu\)/)
    assert.match(admin, /mode === 'api' && <Sauvegarde \/>/)
    assert.match(source('src/data/api.ts'), /requete\('GET', '\/admin\/sauvegarde', \{ acces, binaire: true \}\)/)
  })
})

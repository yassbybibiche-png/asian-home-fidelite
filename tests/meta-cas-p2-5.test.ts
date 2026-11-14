// P2-5 — `meta.valeur` : toute écriture conditionnelle sur `meta` passe par `majMetaSi` (comparaison-et-échange,
// sûr que la colonne soit `text` ou `jsonb` — FIX-409) ; `majMeta` (upsert « dernier écrit gagne ») ne sert
// qu'aux écritures listées dans `docs/SCHEMA-META.md`. La révocation d'accès (`revoquerAccesCarte`) faisait
// lecture-modification-écriture via `majMeta` : deux révocations simultanées de la même carte lisaient N puis
// écrivaient N+1 toutes les deux — la version n'avançait que de 1 et un jeton émis entre les deux lectures
// survivait à la seconde révocation. Corrigée en CAS + réessai (8 essais, puis 409).
// Vrai serveur HTTP sur une base SQLite temporaire (comme tests/auth-client-p0-s7.test.ts).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, type OptionsServeur } from '../server/app.ts'
import { ouvrirStockage } from '../server/stockage.ts'
import type { Client } from '../src/types.ts'

const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const SECRET = 'secret-de-test-meta-cas-p2-5-au-moins-32-caracteres-0123456789'
const SITE = 'https://fidelite.exemple.fr'
const LARGES = { inscriptionParIp: 1000, inscriptionParContact: 1000, ficheClientParIp: 1000, lectureParIp: 1000, lectureParCarte: 1000, tirageParIp: 1000, tirageParContact: 1000 }

const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p2-5-'))
after(() => rmSync(dossier, { recursive: true, force: true }))

const source = (chemin: string) => readFileSync(join(process.cwd(), chemin), 'utf8')

describe('P2-5 : garde-fous source sur les écritures `meta`', () => {
  test('un seul UPDATE sur `meta` dans tout server/ : celui de `majMetaSi`', () => {
    const fichiers = readdirSync(join(process.cwd(), 'server')).filter((f) => f.endsWith('.ts'))
    const occurrences: string[] = []
    for (const f of fichiers) {
      const texte = source(`server/${f}`)
      for (const m of texte.matchAll(/\.from\('meta'\)\.update\(/g)) occurrences.push(`${f}:${texte.slice(0, m.index).split('\n').length}`)
    }
    assert.deepEqual(occurrences, ['stockage-supabase.ts:224'], 'tout UPDATE sur meta doit passer par majMetaSi')
    const corps = source('server/stockage-supabase.ts')
    const debut = corps.indexOf('majMetaSi: async')
    const fin = corps.indexOf('supprimerMeta:', debut)
    assert.ok(debut !== -1 && fin !== -1 && corps.slice(debut, fin).includes(".from('meta').update("), 'l’UPDATE doit vivre dans majMetaSi')
  })

  test('`revoquerAccesCarte` révocation en CAS (`majMetaSi`), jamais en `majMeta`', () => {
    const app = source('server/app.ts')
    const debut = app.indexOf('async function revoquerAccesCarte')
    assert.ok(debut !== -1, 'revoquerAccesCarte introuvable')
    const corps = app.slice(debut, app.indexOf('\n  }\n', debut))
    assert.match(corps, /majMetaSi\(cle, lue, String\(suivante\)\)/, 'la révocation doit comparer-et-échanger la version relue')
    assert.doesNotMatch(corps, /\bmajMeta\(/, 'aucune écriture inconditionnelle dans la révocation')
    assert.match(corps, /for \(let i = 0; i < 8; i\+\+\)/, 'réessai borné sur CAS perdu')
    assert.match(corps, /throw new ErreurConflit/, 'échec après 8 essais = conflit, pas de révocation silencieusement perdue')
  })

  test('`majMeta` (dernier écrit gagne) : seulement les 8 appels documentés dans docs/SCHEMA-META.md', () => {
    // Tout nouvel appel doit entrer dans l'inventaire du document et faire repasser ce test.
    const app = source('server/app.ts')
    const appelsApp = app.split('\n').filter((l) => /\bmajMeta\(/.test(l))
    assert.equal(appelsApp.length, 7, `7 appels majMeta attendus dans app.ts, trouvés : ${appelsApp.join(' | ')}`)
    for (const ligne of appelsApp) {
      assert.match(
        ligne,
        /majMeta\('(initialise|demo|secret_desinscription)'|majMeta\(cleMetaGoogle\(|majMeta\(cleMetaLogo(Version)?\(/,
        `appel majMeta non documenté dans app.ts : ${ligne.trim()}`,
      )
    }
    const commandes = source('server/commandes.ts')
    const appelsCommandes = commandes.split('\n').filter((l) => /\bmajMeta\(/.test(l))
    assert.equal(appelsCommandes.length, 1, '1 seul appel majMeta attendu dans commandes.ts (horodatage de purge)')
    assert.match(appelsCommandes[0], /majMeta\(cle, maintenant\.toISOString\(\)\)/, 'l’appel de commandes.ts doit rester l’horodatage de purge')
    const autres = readdirSync(join(process.cwd(), 'server'))
      .filter((f) => f.endsWith('.ts') && !['app.ts', 'commandes.ts', 'stockage.ts', 'stockage-supabase.ts'].includes(f))
      .filter((f) => /\bmajMeta\(/.test(source(`server/${f}`)))
    assert.deepEqual(autres, [], 'aucun autre fichier serveur ne doit écrire dans meta via majMeta')
  })

  test('docs/SCHEMA-META.md : la requête de confirmation et la règle sont écrites', () => {
    const doc = source('docs/SCHEMA-META.md')
    assert.match(doc, /select data_type from information_schema\.columns where table_name = 'meta' and column_name = 'valeur';/)
    assert.match(doc, /Toute écriture conditionnelle sur `meta` passe par `majMetaSi`/)
    assert.match(doc, /acces_client:<commerce>:<client>/)
    assert.match(doc, /cycle produit 9/)
  })
})

describe('P2-5 : révocation d’accès en CAS (HTTP, SQLite)', () => {
  type Reponse = { statut: number; contenu: any; texte: string }
  let s: Awaited<ReturnType<typeof demarrer>>
  before(async () => {
    s = await demarrer('revocation.db')
  })
  after(() => s.app.fermer())

  async function demarrer(nom: string, options: Partial<OptionsServeur> = {}) {
    const horloge = { t: new Date(2026, 10, 12, 12, 0) }
    const fichierDb = join(dossier, nom)
    const app = await creerServeur({
      fichierDb,
      adminPin: ADMIN,
      pinInitial: '1234',
      version: 'test',
      secretSession: SECRET,
      authClient: 'stricte',
      urlPublique: SITE,
      maintenant: () => horloge.t,
      limitesPubliques: LARGES,
      ...options,
    })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
    async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}): Promise<Reponse> {
      const r = await fetch(`${racine}/api/v1${chemin}`, {
        method: methode,
        headers: { 'Content-Type': 'application/json', ...entetes },
        body: corps === undefined ? undefined : JSON.stringify(corps),
        redirect: 'manual',
      })
      const texte = await r.text()
      let contenu: unknown = texte
      try {
        contenu = JSON.parse(texte)
      } catch {
        // texte brut
      }
      return { statut: r.status, contenu, texte }
    }
    const bearer = (jeton: string) => ({ Authorization: `Bearer ${jeton}` })
    async function inscrire(contact: string) {
      const r = await api('POST', `/commerces/${AH}/clients`, { contact })
      assert.equal(r.statut, 201, r.texte)
      return { client: r.contenu.client as Client, jeton: r.contenu.jeton as string }
    }
    return { app, api, bearer, inscrire, fichierDb }
  }

  function versionAcces(clientId: string) {
    const st = ouvrirStockage(s.fichierDb)
    try {
      return st.meta(`acces_client:${AH}:${clientId}`)
    } finally {
      st.fermer()
    }
  }

  test('révocations séquentielles : la version avance de 1 à chaque fois', async () => {
    const { client } = await s.inscrire('0611005500')
    assert.equal(versionAcces(client.id), undefined)
    assert.equal((await s.api('POST', `/commerces/${AH}/clients/${client.id}/revocation-acces`, undefined, PIN)).statut, 200)
    assert.equal(versionAcces(client.id), '1')
    assert.equal((await s.api('POST', `/commerces/${AH}/clients/${client.id}/revocation-acces`, undefined, PIN)).statut, 200)
    assert.equal(versionAcces(client.id), '2')
  })

  test('deux révocations en vol : les deux réussissent et la version avance de 2', async () => {
    // Sur SQLite les deux requêtes se sérialisent (base synchrone sous await) : ce test fixe le résultat final ;
    // l'entrelacement réel (deux instances, Supabase) est couvert par le garde-fou source : la révocation est
    // en CAS avec réessai, donc la seconde ne peut plus écraser la première.
    const { client } = await s.inscrire('0611006600')
    const [a, b] = await Promise.all([
      s.api('POST', `/commerces/${AH}/clients/${client.id}/revocation-acces`, undefined, PIN),
      s.api('POST', `/commerces/${AH}/clients/${client.id}/revocation-acces`, undefined, PIN),
    ])
    assert.equal(a.statut, 200, a.texte)
    assert.equal(b.statut, 200, b.texte)
    assert.equal(versionAcces(client.id), '2')
  })

  test('révocation par le client (« Déconnecter tous mes appareils ») : version 1, ancien jeton refusé', async () => {
    const { client, jeton } = await s.inscrire('0611007700')
    assert.equal((await s.api('POST', `/cartes/${client.id}/revocation`, undefined, s.bearer(jeton))).statut, 200)
    assert.equal(versionAcces(client.id), '1')
    assert.equal((await s.api('GET', `/cartes/${client.id}`, undefined, s.bearer(jeton))).statut, 401)
  })
})

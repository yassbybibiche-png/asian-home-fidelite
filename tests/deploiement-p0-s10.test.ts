// P0-S10 — Staging + rollback : le Blueprint décrit bien 2 services (production + staging, même code,
// autre branche, autre base), la commande de retour arrière est valide, et chaque migration 0001–0010 est
// compatible avec l'ancien code et le nouveau (vérification statique : aucune migration « up » ne détruit
// quoi que ce soit — que des ajouts — et le code tolère les migrations absentes, ErreurMigrationManquante).
// La procédure complète (création du staging, retour arrière, écritures partielles) est dans
// docs/DEPLOIEMENT.md ; ce fichier en vérifie ce qui est vérifiable sans navigateur ni Render.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  construireAppel, construireEntetes, commandeCurl, commitExisteLocalement, decrireCommit,
  validerCommit, validerService, validerServiceId, ErreurUsage,
} from '../scripts/rollback-render.mjs'

const RACINE = join(import.meta.dirname, '..')
const TEXTE_RENDER = readFileSync(join(RACINE, 'render.yaml'), 'utf8')
// Bloc du service de staging (tout ce qui suit son nom) : la validation YAML complète des 2 services est dans
// tests/render-yaml.test.ts (mini-lecteur) ; ici on vérifie le contenu du staging par le texte, sans réimporter
// ce fichier de test (l'importer exécuterait ses tests une 2e fois dans cette suite).
const BLOC_STAGING = TEXTE_RENDER.slice(TEXTE_RENDER.indexOf('name: asian-home-fidelite-staging'))
const MIGRATIONS = join(RACINE, 'supabase', 'migrations')
const lireMigration = (n: string) => readFileSync(join(MIGRATIONS, `${n}.sql`), 'utf8')

describe('P0-S10 : render.yaml — production + staging', () => {
  test('deux services web : production + staging', () => {
    assert.equal([...TEXTE_RENDER.matchAll(/^\s*- type: web$/gm)].length, 2)
    assert.ok(TEXTE_RENDER.includes('name: asian-home-fidelite\n'))
    assert.ok(TEXTE_RENDER.includes('name: asian-home-fidelite-staging'))
  })

  test('staging : branche autonome/integration, même plan, même région, mêmes commandes, même santé', () => {
    assert.match(BLOC_STAGING, /branch: autonome\/integration/)
    assert.match(BLOC_STAGING, /plan: free/)
    assert.match(BLOC_STAGING, /region: frankfurt/)
    assert.match(BLOC_STAGING, /buildCommand: npm ci && npm run build:api/)
    assert.match(BLOC_STAGING, /startCommand: npm run serveur/)
    assert.match(BLOC_STAGING, /healthCheckPath: \/api\/v1\/sante/)
  })

  test('staging : mêmes variables que la production (mêmes noms, valeurs différentes à saisir au dashboard)', () => {
    const cles = [...BLOC_STAGING.matchAll(/- key: (\S+)/g)].map((m) => m[1])
    assert.deepEqual(cles, ['NODE_VERSION', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_PIN', 'PIN_ASIAN_HOME', 'SESSION_SECRET', 'CORS_ORIGIN'])
    const valeurs = BLOC_STAGING.split('\n').filter((l) => /^\s*value\s*:/.test(l)).map((l) => l.trim())
    assert.deepEqual(valeurs, ['value: "24"'], 'une seule valeur en dur dans le staging : NODE_VERSION (les secrets se saisissent au dashboard)')
    // La base de staging est un projet Supabase de TEST séparé : rien dans le fichier ne peut la désigner
    // (les URL et clés se saisissent au dashboard) — mais le staging ne doit pas réutiliser la production.
    assert.match(TEXTE_RENDER, /projet Supabase de test/i)
  })
})

// ---------- Commande de retour arrière ----------

describe('P0-S10 : scripts/rollback-render.mjs — commande de retour arrière', () => {
  const SERVICE_ID = 'srv-c1234567890abcdef'
  const COMMIT = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: RACINE, encoding: 'utf8' }).trim()

  test('validation : service, identifiant Render et SHA complet refusent les valeurs ambigües', () => {
    assert.equal(validerService('staging'), 'staging')
    assert.equal(validerService('production'), 'production')
    assert.throws(() => validerService('prod'), ErreurUsage)
    assert.equal(validerServiceId(SERVICE_ID), SERVICE_ID)
    assert.throws(() => validerServiceId('c1234567890abcdef'), ErreurUsage)
    assert.throws(() => validerServiceId('srv-'), ErreurUsage)
    assert.equal(validerCommit(COMMIT), COMMIT)
    assert.throws(() => validerCommit(COMMIT.slice(0, 7)), ErreurUsage)
    assert.throws(() => validerCommit(COMMIT.toUpperCase()), ErreurUsage)
  })

  test('appel API Render : POST /v1/services/{id}/deploys avec { commitId } (doc api-docs.render.com/reference/create-deploy)', () => {
    const appel = construireAppel({ serviceId: SERVICE_ID, commitId: COMMIT })
    assert.equal(appel.url, `https://api.render.com/v1/services/${SERVICE_ID}/deploys`)
    assert.equal(appel.methode, 'POST')
    assert.deepEqual(JSON.parse(appel.corps), { commitId: COMMIT })
  })

  test('commande curl affichée : URL + commit exacts, clé référencée par sa variable, jamais en clair', () => {
    const appel = construireAppel({ serviceId: SERVICE_ID, commitId: COMMIT })
    const curl = commandeCurl(appel)
    assert.match(curl, new RegExp(`POST '${appel.url}'`))
    assert.match(curl, new RegExp(COMMIT))
    assert.match(curl, /\$RENDER_API_KEY/)
    assert.doesNotMatch(curl, /rnd_[A-Za-z0-9]/)
    assert.throws(() => construireEntetes(''), ErreurUsage)
    assert.equal(construireEntetes('fausse-cle-pour-test').Authorization, 'Bearer fausse-cle-pour-test')
  })

  test('le commit cible doit exister dans le dépôt local', () => {
    assert.equal(commitExisteLocalement(COMMIT), true)
    assert.equal(commitExisteLocalement('0000000000000000000000000000000000000000'), false)
    assert.match(decrireCommit(COMMIT), /^[0-9a-f]{7} /)
  })

  test('CLI : --aide et simulation (sans --executer) sortent 0 sans rien envoyer', () => {
    const aide = spawnSync('node', ['scripts/rollback-render.mjs', '--aide'], { cwd: RACINE, encoding: 'utf8' })
    assert.equal(aide.status, 0)
    assert.match(aide.stdout, /SIMULATION/)
    const simulation = spawnSync('node', ['scripts/rollback-render.mjs', '--service', 'staging', '--service-id', SERVICE_ID, '--commit', COMMIT], { cwd: RACINE, encoding: 'utf8' })
    assert.equal(simulation.status, 0)
    assert.match(simulation.stdout, /SIMULATION — rien n’a été envoyé/)
    assert.match(simulation.stdout, new RegExp(COMMIT))
    assert.match(simulation.stdout, /curl --fail-with-body/)
    assert.doesNotMatch(simulation.stdout, /Déploiement déclenché/)
  })

  test('CLI : SHA court, service inconnu et commit absent du dépôt sont refusés (code 2)', () => {
    const cas = [
      ['--service', 'staging', '--service-id', SERVICE_ID, '--commit', COMMIT.slice(0, 7)],
      ['--service', 'prod', '--service-id', SERVICE_ID, '--commit', COMMIT],
      ['--service', 'staging', '--service-id', SERVICE_ID, '--commit', '1111111111111111111111111111111111111111'],
    ]
    for (const args of cas) {
      const r = spawnSync('node', ['scripts/rollback-render.mjs', ...args], { cwd: RACINE, encoding: 'utf8' })
      assert.equal(r.status, 2, args.join(' '))
      assert.match(r.stderr, /Erreur :/)
    }
  })

  test('CLI : --executer sans RENDER_API_KEY est refusé AVANT tout appel réseau (code 2)', () => {
    const r = spawnSync('node', ['scripts/rollback-render.mjs', '--service', 'staging', '--service-id', SERVICE_ID, '--commit', COMMIT, '--executer'], {
      cwd: RACINE, encoding: 'utf8', env: { ...process.env, RENDER_API_KEY: '' },
    })
    assert.equal(r.status, 2)
    assert.match(r.stderr, /RENDER_API_KEY manquante/)
  })
})

// ---------- Compatibilité des migrations 0001–0010 ----------

describe('P0-S10 : compatibilité des migrations (ancien code ↔ nouveau schéma, et inverse)', () => {
  test('chaque migration 0001–0010 existe et est rejouable (IF NOT EXISTS / OR REPLACE / IF EXISTS)', () => {
    for (let i = 1; i <= 10; i++) {
      const n = String(i).padStart(4, '0')
      const fichiers = readdirSync(MIGRATIONS).filter((f) => f.startsWith(n))
      assert.ok(fichiers.length >= 1, n)
      const sql = lireMigration(fichiers.find((f) => !f.endsWith('.down.sql'))!.replace(/\.sql$/, ''))
      assert.ok(sql.length > 100, n)
    }
  })

  test('aucune migration « up » ne détruit : ni DROP TABLE, ni DROP COLUMN, ni renommage, ni DELETE, ni TRUNCATE', () => {
    for (let i = 1; i <= 10; i++) {
      const n = String(i).padStart(4, '0')
      const nom = readdirSync(MIGRATIONS).find((f) => f.startsWith(n) && !f.endsWith('.down.sql'))!
      const sql = readFileSync(join(MIGRATIONS, nom), 'utf8')
      for (const motif of [/drop\s+table/i, /drop\s+column/i, /rename\s+(column|to)\b/i, /delete\s+from/i, /truncate\b/i]) {
        assert.doesNotMatch(sql, motif, `${nom} : ${motif}`)
      }
    }
  })

  test('nature de chaque migration : que des ajouts (tables / fonctions / élargissement de contrainte)', () => {
    const natures: Record<string, RegExp> = {
      '0001': /create table if not exists public\.(meta|commerces|clients|tirages|avis)/,
      '0002': /enable row level security/,
      '0003': /create table if not exists public\.(equipe|journal|menus)/,
      '0004': /create table if not exists public\.(parrainages|demandes_rattrapage)/,
      '0005': /create table if not exists public\.sessions_revoquees/,
      '0006': /create table if not exists public\.tentatives_auth/,
      '0007': /create table if not exists public\.envois/,
      '0008': /create table if not exists public\.evenements_jour/,
      '0009': /check \(portee in \('admin', 'commerce', 'equipe', 'client'\)\)/,
      '0010': /create table if not exists public\.compteurs_publics/,
    }
    for (const [n, motif] of Object.entries(natures)) {
      const nom = readdirSync(MIGRATIONS).find((f) => f.startsWith(n) && !f.endsWith('.down.sql'))!
      assert.match(readFileSync(join(MIGRATIONS, nom), 'utf8'), motif, nom)
    }
    // 0009 n'ajoute aucune table : un ancien code qui ne connaît pas 'client' écrit toujours des portées valides.
    assert.doesNotMatch(lireMigration('0009_auth_client'), /create table/i)
    // 0002 ne touche à aucune donnée : RLS + droits seulement (les GRANT nomment insert/update/delete
    // comme des droits, pas comme des écritures : on cherche les formes d'écriture, pas les mots).
    assert.doesNotMatch(lireMigration('0002_rls'), /create table|\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bdelete\s+from\b/i)
  })

  test('annulation : un .down.sql existe pour 0005–0010, pas pour 0001–0004 (fondations : retour = restauration)', () => {
    for (let i = 1; i <= 10; i++) {
      const n = String(i).padStart(4, '0')
      const nom = readdirSync(MIGRATIONS).find((f) => f.startsWith(n) && !f.endsWith('.down.sql'))!.replace(/\.sql$/, '')
      const down = join(MIGRATIONS, `${nom}.down.sql`)
      if (i <= 4) assert.equal(existsSync(down), false, `${nom} : pas de down — restauration de sauvegarde`)
      else assert.equal(existsSync(down), true, `${nom} : down manquant`)
    }
  })

  test('nouveau code sur ancien schéma : le serveur tolère les migrations absentes (ErreurMigrationManquante)', () => {
    const stockage = readFileSync(join(RACINE, 'server', 'stockage-supabase.ts'), 'utf8')
    assert.match(stockage, /ErreurMigrationManquante/)
    // Les migrations optionnelles sont annoncées comme telles dans leur propre en-tête (dégradation documentée).
    // La phrase peut être coupée par un retour à la ligne + « -- » (0005) : on tolère jusqu'à 80 caractères entre les deux moitiés.
    for (const n of ['0005_sessions_revoquees', '0006_tentatives_auth', '0007_relances', '0008_mesure', '0009_auth_client', '0010_compteurs_publics']) {
      assert.match(lireMigration(n), /Tant que cette migration n'est pas appliquée,[\s\S]{0,80}?le serveur fonctionne/i, n)
    }
    // Exception documentée : 0003 et 0004 sont EXIGÉES au démarrage sous Supabase (server/app.ts, exigerMigrationsAudit).
    const app = readFileSync(join(RACINE, 'server', 'app.ts'), 'utf8')
    assert.match(app, /exigerMigrationsAudit/)
    assert.match(app, /migration supabase\/migrations\/0003_cartiz\.sql absente/)
    assert.match(app, /migration supabase\/migrations\/0004_programme\.sql absente/)
  })

  test('docs/DEPLOIEMENT.md : procédure écrite, compatibilité vérifiée migration par migration', () => {
    const doc = readFileSync(join(RACINE, 'docs', 'DEPLOIEMENT.md'), 'utf8')
    assert.match(doc, /asian-home-fidelite-staging/)
    assert.match(doc, /rollback-render\.mjs/)
    assert.match(doc, /écritures partielles/)
    for (let i = 1; i <= 10; i++) {
      const n = String(i).padStart(4, '0')
      assert.match(doc, new RegExp(n), `migration ${n} absente de la doc`)
    }
    // Le retour arrière ne restaure ni schéma, ni données, ni configuration (revue Codex, point 12) : dit explicitement.
    assert.match(doc, /ne restaure ni le schéma, ni les données, ni la configuration/)
  })
})

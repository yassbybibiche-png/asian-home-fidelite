// Phase Supabase S3 : le Blueprint Render (`render.yaml`) est du YAML valide, conforme à la procédure de
// server/README.md (étape d), et ne contient aucun secret.
// Pas de parseur YAML dans Node ni dans les dépendances : on n'en ajoute pas. Le mini-lecteur ci-dessous ne
// connaît que le sous-ensemble utilisé (mappings / séquences en bloc, scalaires simples, commentaires sur
// leur propre ligne) et REFUSE tout le reste (tabulations, styles flow, ancres, multi-documents…) : un fichier
// qu'il accepte est donc du YAML valide qui a exactement le sens lu ici. (Contrôle croisé fait à la main avec
// PyYAML 6.0.1 le 09/11/2026 : même structure.)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pkg from '../package.json' with { type: 'json' }

const RACINE = join(import.meta.dirname, '..')
const TEXTE = readFileSync(join(RACINE, 'render.yaml'), 'utf8')

type Valeur = string | number | boolean | null | Valeur[] | { [cle: string]: Valeur }
type Ligne = { indent: number; texte: string; numero: number }

function scalaire(brut: string, numero: number): Valeur {
  const s = brut.trim()
  if (/^"[^"\\]*"$/.test(s) || /^'[^']*'$/.test(s)) return s.slice(1, -1)
  if (/^["'{[&*!|>%@`]/.test(s) || /\s#/.test(s)) throw new Error(`ligne ${numero} : syntaxe YAML hors du sous-ensemble accepté : ${s}`)
  if (s === 'true' || s === 'false') return s === 'true'
  if (s === '' || s === 'null' || s === '~') return null
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  return s
}

export function lireYamlSimple(texte: string): Valeur {
  if (texte.includes('\t')) throw new Error('tabulation interdite en YAML')
  const lignes: Ligne[] = []
  texte.split('\n').forEach((l, i) => {
    if (/^\s*(#.*)?$/.test(l)) return
    if (/^(---|\.\.\.)/.test(l)) throw new Error(`ligne ${i + 1} : un seul document attendu`)
    lignes.push({ indent: l.length - l.trimStart().length, texte: l.trim(), numero: i + 1 })
  })
  let pos = 0

  function bloc(indent: number): Valeur {
    const premiere = lignes[pos]
    if (!premiere || premiere.indent !== indent) throw new Error(`ligne ${premiere?.numero ?? 'fin'} : indentation inattendue`)
    if (premiere.texte === '-' || premiere.texte.startsWith('- ')) {
      const liste: Valeur[] = []
      while (pos < lignes.length && lignes[pos].indent === indent && lignes[pos].texte.startsWith('- ')) {
        // « - cle: valeur » = un mapping dont le contenu est indenté de 2 de plus.
        lignes[pos] = { ...lignes[pos], indent: indent + 2, texte: lignes[pos].texte.slice(2).trimStart() }
        liste.push(/^[\w-]+:(\s|$)/.test(lignes[pos].texte) ? bloc(indent + 2) : scalaire(lignes[pos++].texte, lignes[pos - 1].numero))
      }
      return liste
    }
    const objet: { [cle: string]: Valeur } = {}
    while (pos < lignes.length && lignes[pos].indent === indent) {
      const { texte: t, numero } = lignes[pos]
      const m = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(t)
      if (!m) throw new Error(`ligne ${numero} : « cle: valeur » attendu, lu : ${t}`)
      if (m[1] in objet) throw new Error(`ligne ${numero} : clé en double ${m[1]}`)
      pos++
      if (m[2] !== undefined && m[2] !== '') objet[m[1]] = scalaire(m[2], numero)
      else if (pos < lignes.length && lignes[pos].indent > indent) objet[m[1]] = bloc(lignes[pos].indent)
      // Séquence au même niveau que la clé (« cle:\n- a ») : forme YAML valide, acceptée aussi.
      else if (pos < lignes.length && lignes[pos].indent === indent && lignes[pos].texte.startsWith('- ')) objet[m[1]] = bloc(indent)
      else objet[m[1]] = null
    }
    return objet
  }

  const racine = bloc(0)
  if (pos !== lignes.length) throw new Error(`ligne ${lignes[pos].numero} : indentation incohérente`)
  return racine
}

describe('render.yaml (Blueprint Render, phase S3)', () => {
  const bp = lireYamlSimple(TEXTE) as { services: Record<string, Valeur>[] }

  test('le mini-lecteur YAML refuse ce qu’il ne sait pas lire (pas de faux « valide »)', () => {
    assert.throws(() => lireYamlSimple('a:\n\tb: 1'), /tabulation/)
    assert.throws(() => lireYamlSimple('a: {b: 1}'), /sous-ensemble/)
    assert.throws(() => lireYamlSimple('a: &x 1'), /sous-ensemble/)
    assert.throws(() => lireYamlSimple('a: 1\na: 2'), /double/)
    assert.throws(() => lireYamlSimple('a:\n  b: 1\n c: 2'), /indentation/)
    assert.deepEqual(lireYamlSimple('# c\nx:\n  - k: "24"\n    s: false\n  - k: b\n'), { x: [{ k: '24', s: false }, { k: 'b' }] })
  })

  test('YAML valide : un service web Node Free à Frankfurt, commandes de la procédure S2', () => {
    assert.deepEqual(Object.keys(bp), ['services'])
    assert.equal(bp.services.length, 1)
    const s = bp.services[0]
    assert.equal(s.type, 'web')
    assert.equal(s.runtime, 'node', '`runtime` (le champ `env` est déprécié)')
    assert.equal(s.plan, 'free')
    assert.equal(s.region, 'frankfurt', 'même ville que Supabase eu-central-1 ; non modifiable après création')
    assert.equal(s.buildCommand, 'npm ci && npm run build:api')
    assert.equal(s.startCommand, 'npm run serveur')
    assert.equal(s.healthCheckPath, '/api/v1/sante')
    assert.equal(s.branch, undefined, 'pas de branche en dur : celle choisie à la création du Blueprint')
  })

  test('variables : NODE_VERSION=24 et exactement les 5 secrets en `sync: false`, sans valeur', () => {
    const vars = bp.services[0].envVars as Record<string, Valeur>[]
    assert.deepEqual(vars.find((v) => v.key === 'NODE_VERSION'), { key: 'NODE_VERSION', value: '24' })
    const secrets = vars.filter((v) => v.key !== 'NODE_VERSION')
    assert.deepEqual(secrets.map((v) => v.key), ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_PIN', 'PIN_ASIAN_HOME', 'SESSION_SECRET'])
    for (const v of secrets) assert.deepEqual(v, { key: v.key, sync: false }, `${v.key} : aucune valeur dans le fichier`)
    // Jamais en production (voir server/README.md) ; NODE_ENV=production au build retirerait les devDependencies.
    for (const interdite of ['DEMO', 'DB_FILE', 'NODE_ENV', 'PORT', 'SUPABASE_ANON_KEY']) {
      assert.ok(!vars.some((v) => v.key === interdite), `${interdite} ne doit pas être dans render.yaml`)
    }
  })

  test('aucun secret en dur dans le fichier', () => {
    assert.doesNotMatch(TEXTE, /sb_secret_|sb_publishable_|eyJ[\w-]{10,}/, 'aucune clé Supabase')
    assert.doesNotMatch(TEXTE, /https?:\/\/[\w-]+\.supabase\.co/, 'aucune URL de projet')
    const code = TEXTE.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
    assert.doesNotMatch(code, /\b\d{4,}\b/, 'aucun nombre de 4 chiffres ou plus (PIN) hors commentaires')
    assert.doesNotMatch(code, /^\s*(generateValue|fromDatabase|fromService)\s*:/m)
    const valeurs = TEXTE.split('\n').filter((l) => /^\s*value\s*:/.test(l))
    assert.deepEqual(valeurs.map((l) => l.trim()), ['value: "24"'], 'une seule valeur en dur : NODE_VERSION')
  })

  test('cohérent avec le dépôt : scripts npm, .env.api, lockfile, version de Node', () => {
    assert.ok(pkg.scripts['build:api'].includes('--mode api'))
    assert.match(readFileSync(join(RACINE, '.env.api'), 'utf8'), /^VITE_API_URL=\/$/m, 'front servi à la même adresse que l’API')
    assert.ok(pkg.scripts.serveur.startsWith('node ') && pkg.scripts.serveur.endsWith('server/index.ts'))
    assert.ok(existsSync(join(RACINE, 'package-lock.json')), '`npm ci` exige package-lock.json')
    const [majeur] = process.versions.node.split('.').map(Number)
    assert.ok(majeur >= 24, 'les tests tournent sous Node 24 comme NODE_VERSION')
    // Les 5 secrets sont bien ceux que lit le serveur.
    const index = readFileSync(join(RACINE, 'server', 'index.ts'), 'utf8') + readFileSync(join(RACINE, 'server', 'stockage-supabase.ts'), 'utf8')
    for (const cle of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_PIN', 'PIN_ASIAN_HOME', 'SESSION_SECRET']) assert.ok(index.includes(cle), cle)
  })
})

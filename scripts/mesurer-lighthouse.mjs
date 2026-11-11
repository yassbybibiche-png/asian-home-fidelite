#!/usr/bin/env node
// Lighthouse performance (mobile, throttling simulé — méthode distincte du ralentissement CDP direct de
// scripts/mesurer-scores.mjs) sur #/jouer, serveur E2E local + base SQLite temporaire.
// Lighthouse est une devDependency épinglée (package.json) : `node_modules/.bin/lighthouse`.
// Usage : node scripts/mesurer-lighthouse.mjs [--sortie <fichier-json>] [--port <port>]
// Sortie par défaut : node_modules/.cache/mesure-p0-u0/lighthouse-jouer.json.
// Ne touche jamais à la production : serveur 127.0.0.1 uniquement, base temporaire effacée à l'arrêt.
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'

const exec = promisify(execFile)
const RACINE = resolve(import.meta.dirname, '..')
const { values } = parseArgs({ options: { sortie: { type: 'string' }, port: { type: 'string' } } })
const PORT = Number(values.port ?? process.env.E2E_PORT ?? 4321)
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error(`--port invalide : ${values.port ?? process.env.E2E_PORT ?? 4321}`)
const BASE = `http://127.0.0.1:${PORT}`
const SORTIE = values.sortie ?? join(RACINE, 'node_modules', '.cache', 'mesure-p0-u0', 'lighthouse-jouer.json')
const CHROME = join(process.env.HOME ?? '', '.cache', 'ms-playwright', 'chromium-1254', 'chrome-linux64', 'chrome')

async function portLibre() {
  try {
    await fetch(`${BASE}/api/v1/sante`, { signal: AbortSignal.timeout(2000) })
    return false
  } catch {
    return true
  }
}

async function attendreSante(delaiMs = 120_000) {
  const debut = Date.now()
  for (;;) {
    try {
      const r = await fetch(`${BASE}/api/v1/sante`)
      if (r.ok) return
    } catch { /* serveur pas encore prêt */ }
    if (Date.now() - debut > delaiMs) throw new Error(`serveur E2E non prêt après ${delaiMs} ms`)
    await new Promise((r) => setTimeout(r, 500))
  }
}

async function main() {
  if (!(await portLibre())) throw new Error(`port ${PORT} déjà occupé — un autre serveur tourne ; la mesure refuse de s'y brancher`)
  const serveur = spawn('node', ['tests-e2e/serveur.ts'], { cwd: RACINE, env: { ...process.env, E2E_PORT: String(PORT), VITE_API_URL: '/' }, stdio: 'pipe' })
  serveur.stdout.on('data', (c) => process.stderr.write(`[serveur] ${c}`))
  serveur.stderr.on('data', (c) => process.stderr.write(`[serveur:err] ${c}`))
  try {
    await attendreSante()
    const r = await fetch(`${BASE}/api/v1/commerces`, {
      method: 'POST',
      headers: { 'X-Admin-PIN': '000000', 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom: 'Lighthouse', type: 'restaurant', pin: '4321', lots: [{ libelle: 'Nems offerts', probabilite: 100 }] }),
    })
    if (r.status !== 201) throw new Error(`création du commerce : HTTP ${r.status}`)
    const { commerce } = await r.json()
    await exec(join(RACINE, 'node_modules', '.bin', 'lighthouse'), [`${BASE}/#/jouer/${commerce.id}`, '--only-categories=performance', '--output=json', `--output-path=${SORTIE}`, '--chrome-flags=--headless=new --no-sandbox', '--quiet'], {
      cwd: RACINE,
      env: { ...process.env, CHROME_PATH: CHROME },
      timeout: 240_000,
    })
    const j = JSON.parse(readFileSync(SORTIE, 'utf8'))
    const a = j.audits
    const resume = {
      score: Math.round(j.categories.performance.score * 100),
      fcp: a['first-contentful-paint']?.displayValue,
      lcp: a['largest-contentful-paint']?.displayValue,
      tbt: a['total-blocking-time']?.displayValue,
      cls: a['cumulative-layout-shift']?.displayValue,
      speedIndex: a['speed-index']?.displayValue,
      tti: a['interactive']?.displayValue,
    }
    console.log(JSON.stringify(resume, null, 2))
  } finally {
    serveur.kill('SIGTERM')
  }
}

main().catch((e) => {
  console.error(`Erreur : ${e instanceof Error ? e.message : e}`)
  process.exitCode = 1
})

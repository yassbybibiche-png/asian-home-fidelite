// P0-S9 — Refuser SQLite en production (AUDIT.md §7) : en production, démarrer sans Supabase = erreur au lieu
// d'une bascule silencieuse vers un SQLite vide et éphémère (sur Render, le fichier est perdu à chaque
// redéploiement — clients et tirages avec) ; `/sante` signale le stockage effectif et alerte si SQLite en production.
// Hors production, SQLite reste le défaut (développement local, tests).
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { demarrerFauxSupabaseHttp } from './faux-supabase-http.ts'

const RACINE = join(import.meta.dirname, '..')
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p0s9-'))
after(() => rmSync(dossier, { recursive: true, force: true }))

/** Lance `node server/index.ts` en enfant, avec l'environnement donné (sans rien hériter : insensible à un `.env`). */
function lancer(variables: Record<string, string>) {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    ADMIN_PIN: '12345678',
    PIN_ASIAN_HOME: '1234',
    DB_FILE: join(dossier, `db-${Math.random().toString(36).slice(2)}.db`),
    STATIC_DIR: join(dossier, 'pas-de-front'),
    PORT: '0',
    ...variables,
  }
  const enfant = spawn(process.execPath, [join(RACINE, 'server', 'index.ts')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let sortie = ''
  enfant.stdout.on('data', (d) => (sortie += d))
  enfant.stderr.on('data', (d) => (sortie += d))
  const resultat = new Promise<{ demarre: boolean; code?: number | null }>((ok, ko) => {
    const minuterie = setTimeout(() => ko(new Error(`ni démarré ni arrêté : ${sortie}`)), 20_000)
    enfant.stdout.on('data', () => {
      if (sortie.includes('/api/v1/sante')) {
        clearTimeout(minuterie)
        ok({ demarre: true })
      }
    })
    enfant.on('exit', (code) => {
      clearTimeout(minuterie)
      ok({ demarre: false, code })
    })
  })
  return { enfant, resultat, sortie: () => sortie }
}

/** Attend qu'un motif apparaisse dans la sortie (les lignes du `listen` arrivent après la ligne `/api/v1/sante`). */
async function attendre(l: ReturnType<typeof lancer>, motif: RegExp, delai = 5000): Promise<string> {
  const fin = Date.now() + delai
  while (Date.now() < fin) {
    if (motif.test(l.sortie())) return l.sortie()
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`motif ${motif} absent après ${delai} ms : ${l.sortie()}`)
}

describe('P0-S9 : server/index.ts refuse SQLite en production', () => {
  test('NODE_ENV=production sans Supabase → refus de démarrer (code 1, message explicite)', async () => {
    const l = lancer({ NODE_ENV: 'production' })
    try {
      const r = await l.resultat
      assert.equal(r.demarre, false, l.sortie())
      assert.equal(r.code, 1)
      assert.match(l.sortie(), /En production, Supabase est obligatoire/)
      assert.match(l.sortie(), /SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY/)
      assert.match(l.sortie(), /refus de démarrer sur SQLite vide/)
    } finally {
      l.enfant.kill()
    }
  })

  test('RENDER=1 sans Supabase → même refus (Render = production)', async () => {
    const l = lancer({ RENDER: '1' })
    try {
      const r = await l.resultat
      assert.equal(r.demarre, false, l.sortie())
      assert.equal(r.code, 1)
      assert.match(l.sortie(), /En production, Supabase est obligatoire/)
    } finally {
      l.enfant.kill()
    }
  })

  test('production AVEC Supabase → démarre (la garde ne refuse que l’absence)', async () => {
    const faux = await demarrerFauxSupabaseHttp()
    const l = lancer({ NODE_ENV: 'production', SUPABASE_URL: faux.url, SUPABASE_SERVICE_ROLE_KEY: 'cle-service-factice-test' })
    try {
      assert.equal((await l.resultat).demarre, true, l.sortie())
      const sortie = await attendre(l, /mode production/)
      assert.doesNotMatch(sortie, /Supabase est obligatoire/)
    } finally {
      l.enfant.kill()
      await faux.fermer()
    }
  })

  test('développement sans Supabase → démarre (SQLite reste le défaut hors production)', async () => {
    const l = lancer({})
    try {
      assert.equal((await l.resultat).demarre, true, l.sortie())
      await attendre(l, /mode développement/)
    } finally {
      l.enfant.kill()
    }
  })

  test('une seule variable Supabase → refus (demi-configuration, garde antérieure à P0-S9)', async () => {
    const l = lancer({ NODE_ENV: 'production', SUPABASE_URL: 'https://projet.supabase.co' })
    try {
      const r = await l.resultat
      assert.equal(r.demarre, false, l.sortie())
      assert.equal(r.code, 1)
      assert.match(l.sortie(), /Supabase à moitié configuré/)
    } finally {
      l.enfant.kill()
    }
  })
})

describe('P0-S9 : /sante alerte si SQLite en production', () => {
  async function sante(production: boolean) {
    const app = await creerServeur({ fichierDb: join(dossier, `sante-${production}.db`), adminPin: '98765432', pinInitial: '1234', version: 'test', production })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
    try {
      const r = await fetch(`${base}/sante`)
      assert.equal(r.status, 200)
      return (await r.json()) as Record<string, unknown>
    } finally {
      await app.fermer()
    }
  }

  test('SQLite + production → clé alerteStockage (message explicite, en français)', async () => {
    const s = await sante(true)
    assert.equal(s.stockage, 'sqlite')
    assert.equal(s.mode, 'production')
    assert.equal(typeof s.alerteStockage, 'string')
    assert.match(s.alerteStockage as string, /Base SQLite en production/)
    assert.match(s.alerteStockage as string, /SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY/)
  })

  test('SQLite + développement → pas de clé alerteStockage (clés de /sante inchangées)', async () => {
    const s = await sante(false)
    assert.equal(s.stockage, 'sqlite')
    assert.equal(s.mode, 'developpement')
    assert.ok(!('alerteStockage' in s))
    assert.deepEqual(Object.keys(s).sort(), ['demo', 'integrations', 'migrations', 'mode', 'ok', 'stockage', 'version'])
  })
})

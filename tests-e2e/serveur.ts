// Serveur des tests de bout en bout (`npm run test:e2e`) : front compilé en mode API + vraie API, sur une base
// SQLite TEMPORAIRE créée pour l'occasion et effacée à l'arrêt. Jamais de production : aucune variable
// SUPABASE_* n'est lue, aucune URL distante, écoute sur 127.0.0.1 uniquement. PIN de développement seulement.
process.env.TZ ||= 'Europe/Paris'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import { creerServeur } from '../server/app.ts'

// Mêmes valeurs que playwright.config.ts (ce fichier lance le serveur dès son import : rien à importer d'ici).
const PORT_E2E = Number(process.env.E2E_PORT ?? 4317)
const ADMIN_PIN_E2E = '000000'

const racine = resolve(import.meta.dirname, '..')
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-e2e-'))
const statique = join(dossier, 'dist')

// Front en mode API (`.env.api` : VITE_API_URL=/) → il appelle CE serveur, même origine.
await build({ root: racine, configFile: join(racine, 'vite.config.ts'), mode: 'api', logLevel: 'warn', build: { outDir: statique, emptyOutDir: true } })

const app = await creerServeur({
  fichierDb: join(dossier, 'e2e.db'),
  adminPin: ADMIN_PIN_E2E,
  pinInitial: '1234',
  secretSession: 'e2e-secret-de-session-local-uniquement-0123456789',
  // P0-S7 : comme en production — le parcours n'avance qu'avec le jeton client obtenu par la page à l'inscription.
  authClient: 'stricte',
  production: false,
  dossierStatique: statique,
  version: 'e2e',
})

app.serveur.listen(PORT_E2E, '127.0.0.1', () => {
  console.log(`[e2e] http://127.0.0.1:${PORT_E2E} · base temporaire ${dossier}`)
})

let arret = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (arret) return
    arret = true
    app.fermer().finally(() => {
      rmSync(dossier, { recursive: true, force: true })
      process.exit(0)
    })
  })
}

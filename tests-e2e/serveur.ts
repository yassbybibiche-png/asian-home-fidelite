// Serveur des tests de bout en bout (`npm run test:e2e`) : front compilé en mode API + vraie API, sur une base
// SQLite TEMPORAIRE créée pour l'occasion et effacée à l'arrêt. Jamais de production : aucune variable
// SUPABASE_* n'est lue, aucune URL distante, écoute sur 127.0.0.1 uniquement. PIN de développement seulement.
process.env.TZ ||= 'Europe/Paris'

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
const fichierDb = join(dossier, 'e2e.db')
// Roue v2 R4 : le parcours « remise le lendemain » recule la date d'un tirage DANS CETTE base temporaire (jamais en
// production) — le chemin de la base est publié aux specs par ce fichier (même nom calculé dans la spec : rien ne
// s'importe d'ici), effacé à l'arrêt.
const infoBaseE2E = (port: number) => join(tmpdir(), `fidelite-e2e-base-${port}.json`)
writeFileSync(infoBaseE2E(PORT_E2E), JSON.stringify({ fichierDb }))

// Front en mode API (`.env.api` : VITE_API_URL=/) → il appelle CE serveur, même origine.
await build({ root: racine, configFile: join(racine, 'vite.config.ts'), mode: 'api', logLevel: 'warn', build: { outDir: statique, emptyOutDir: true } })

const app = await creerServeur({
  fichierDb,
  adminPin: ADMIN_PIN_E2E,
  pinInitial: '1234',
  secretSession: 'e2e-secret-de-session-local-uniquement-0123456789',
  // P0-S7 : comme en production — le parcours n'avance qu'avec le jeton client obtenu par la page à l'inscription.
  authClient: 'stricte',
  production: false,
  dossierStatique: statique,
  version: 'e2e',
  // P3-2 : toute la passe partage une seule IP (127.0.0.1) et une fenêtre de 60 s — les limites de production
  // (10 inscriptions/min) seraient atteintes par la passe elle-même, sans rapport avec le produit. Relevées ici
  // seulement ; les limites de production restent épinglées par les tests unitaires (compteurs-publics-p0-s20).
  limitesPubliques: { inscriptionParIp: 1000, inscriptionParContact: 1000, ficheClientParIp: 1000, lectureParIp: 1000, lectureParCarte: 1000, tirageParIp: 1000, tirageParContact: 1000 },
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
      rmSync(infoBaseE2E(PORT_E2E), { force: true })
      process.exit(0)
    })
  })
}

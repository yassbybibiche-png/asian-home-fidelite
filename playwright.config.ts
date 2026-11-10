import { defineConfig, devices } from '@playwright/test'

// Tests de bout en bout dans un vrai Chromium (`npm run test:e2e`), hors de `npm test` : ils exigent le navigateur
// de Playwright (`npx playwright install chromium`). Serveur local + base SQLite temporaire (tests-e2e/serveur.ts) :
// jamais la production.
const port = Number(process.env.E2E_PORT ?? 4317)
const base = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: 'tests-e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: 'node_modules/.cache/playwright-resultats',
  use: {
    baseURL: base,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    // Animation de la roue courte (préférence « mouvement réduit » respectée par l'app) et pas de service worker.
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Pixel 7'], browserName: 'chromium' } }],
  webServer: {
    command: 'node tests-e2e/serveur.ts',
    url: `${base}/api/v1/sante`,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    // SIGTERM (et non SIGKILL) : tests-e2e/serveur.ts ferme la base et efface son dossier temporaire.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
})

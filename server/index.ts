// Point d'entrée : `npm run serveur` (Node 24 exécute le TypeScript directement).
// Toutes les variables d'environnement sont décrites dans server/README.md.

// « Visite du jour » et « 1 tirage par jour » se comptent en jours calendaires de l'heure de Paris,
// même sur un hébergeur réglé en UTC. À fixer avant toute manipulation de date.
process.env.TZ ||= 'Europe/Paris'

import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import pkg from '../package.json' with { type: 'json' }
import { creerServeur } from './app.ts'
import { configDepuisEnv } from './notifications/index.ts'
import { configSupabaseDepuisEnv } from './stockage-supabase.ts'

const env = process.env
const production = env.NODE_ENV === 'production' || !!env.RENDER

function arreter(message: string): never {
  console.error(`[serveur] ${message}`)
  process.exit(1)
}

let adminPin = env.ADMIN_PIN
if (!adminPin) {
  if (production) arreter('ADMIN_PIN est obligatoire en production (aucun PIN par défaut n’est accepté).')
  adminPin = '000000'
  console.warn('[serveur] ADMIN_PIN absent : PIN admin de DÉVELOPPEMENT « 000000 ». À ne jamais utiliser en production.')
}
if (!/^\d{4,12}$/.test(adminPin)) arreter('ADMIN_PIN doit contenir 4 à 12 chiffres.')
if (production && (adminPin.length < 8 || /^(\d)\1+$/.test(adminPin))) arreter('ADMIN_PIN trop simple pour la production : 8 chiffres minimum, pas tous identiques.')

// Jetons de session (P0-S1). Absent en production : on démarre QUAND MÊME (sinon le déploiement casserait avant que
// la variable soit créée sur Render) — POST /api/v1/sessions répond 503 et le front reste sur le PIN en en-tête.
let secretSession = env.SESSION_SECRET?.trim() || undefined
if (secretSession && secretSession.length < 32) {
  if (production) arreter('SESSION_SECRET trop court : 32 caractères minimum (ex. `openssl rand -base64 48`).')
  console.warn('[serveur] SESSION_SECRET court (< 32 caractères) : acceptable en développement seulement.')
}
if (!secretSession) {
  if (production) {
    console.warn('[serveur] SESSION_SECRET absente : jetons de session DÉSACTIVÉS (POST /api/v1/sessions → 503), le PIN en en-tête reste utilisé. Créez la variable sur Render.')
  } else {
    secretSession = randomBytes(32).toString('base64url')
    console.warn('[serveur] SESSION_SECRET absente : secret de session ÉPHÉMÈRE de développement (les sessions tombent à chaque redémarrage).')
  }
}

let pinInitial = env.PIN_ASIAN_HOME
if (!pinInitial && !production) pinInitial = '1234'

const dossierStatique = resolve(env.STATIC_DIR ?? 'dist')
const fichierDb = resolve(env.DB_FILE ?? 'data/fidelite.db')
let supabase: ReturnType<typeof configSupabaseDepuisEnv>

let app
try {
  // Supabase (S1) seulement si SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY sont définies ; sinon SQLite (DB_FILE).
  supabase = configSupabaseDepuisEnv(env)
  app = await creerServeur({
    fichierDb,
    supabase,
    adminPin,
    pinInitial,
    secretSession,
    demo: env.DEMO === '1',
    production,
    derriereProxy: env.TRUST_PROXY === '1' || !!env.RENDER,
    origineCors: env.CORS_ORIGIN || '*',
    dossierStatique: existsSync(resolve(dossierStatique, 'index.html')) ? dossierStatique : undefined,
    version: pkg.version,
    urlPublique: env.PUBLIC_URL,
    // V3 : intégrations préparées, inactives tant que ces variables sont absentes (aucune n'est configurée).
    googleWallet: { issuerId: env.GOOGLE_WALLET_ISSUER_ID, fichierCleService: env.GOOGLE_WALLET_SERVICE_ACCOUNT_FILE },
    notifications: configDepuisEnv(env),
  })
} catch (e) {
  arreter(e instanceof Error ? e.message : String(e))
}

const port = Number(env.PORT ?? 3001)
app.serveur.listen(port, () => {
  console.log(`[serveur] Asian Home Fidélité ${pkg.version} — http://localhost:${port}/api/v1/sante`)
  console.log(`[serveur] mode ${production ? 'production' : 'développement'} · base ${supabase ? `Supabase ${new URL(supabase.url).host}` : fichierDb} · démo ${env.DEMO === '1' ? 'oui' : 'non'} · fuseau ${env.TZ}`)
  console.log('[serveur] intégrations : voir /api/v1/sante (Apple Wallet en suspens ; Google Wallet, SMS, e-mail actifs seulement si leurs variables sont définies)')
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.fermer().then(() => process.exit(0))
  })
}

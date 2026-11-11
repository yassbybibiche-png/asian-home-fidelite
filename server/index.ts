// Point d'entrée : `npm run serveur` (Node 24 exécute le TypeScript directement).
// Toutes les variables d'environnement sont décrites dans server/README.md.

// « Visite du jour » et « 1 tirage par jour » se comptent en jours calendaires de l'heure de Paris,
// même sur un hébergeur réglé en UTC. À fixer avant toute manipulation de date.
process.env.TZ ||= 'Europe/Paris'

import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import pkg from '../package.json' with { type: 'json' }
import { creerServeur, lireOrigineCors } from './app.ts'
import { configDepuisEnv } from './notifications/index.ts'
import { configGoogleBusinessDepuisEnv } from './google-business.ts'
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

// Accès client aux cartes (P0-S7, server/README.md « Accès client ») : `stricte` = jeton client exigé ; `transition` =
// jetons émis et vérifiés, mais l'accès d'avant P0-S7 (lien ou contact seuls) reste admis. Défaut : `stricte` en
// production quand SESSION_SECRET existe (les jetons en dépendent), `transition` sinon.
const authClientDemande = env.AUTH_CLIENT?.trim()
if (authClientDemande && authClientDemande !== 'stricte' && authClientDemande !== 'transition') arreter('AUTH_CLIENT doit valoir « stricte » ou « transition ».')
if (authClientDemande === 'stricte' && !secretSession) arreter('AUTH_CLIENT=stricte exige SESSION_SECRET (signature des jetons client).')
const authClient: 'stricte' | 'transition' = (authClientDemande as 'stricte' | 'transition' | undefined) ?? (production && secretSession ? 'stricte' : 'transition')
if (authClient === 'transition') {
  console.warn(
    production
      ? '[serveur] ACCÈS CLIENT EN MODE TRANSITION : le lien ou le contact seuls ouvrent encore une carte (comportement d’avant P0-S7). Passer en mode strict dès que /api/v1/sante → authClient.accesSansJeton reste à 0.'
      : '[serveur] Accès client en mode transition (développement) : AUTH_CLIENT=stricte pour essayer le mode de production.',
  )
}

// CORS strict (P0-S4) : seule l'origine CORS_ORIGIN peut appeler l'API depuis un autre site. Absente : '*' comme avant,
// sans refuser de démarrer — en production le front est servi par CE serveur (même origine), le CORS ne le concerne pas.
let origineCors = '*'
if (env.CORS_ORIGIN?.trim()) {
  try {
    origineCors = lireOrigineCors(env.CORS_ORIGIN)
  } catch (e) {
    arreter(e instanceof Error ? e.message : String(e))
  }
}
if (origineCors === '*') {
  console.warn(
    production
      ? '[serveur] CORS_ORIGIN absente : CORS ouvert à tous les sites (*). Le front servi ici n’est pas concerné (même origine) ; créez la variable sur Render (origine exacte du front) pour fermer l’API aux autres sites.'
      : '[serveur] CORS_ORIGIN absente : CORS ouvert (*), acceptable en développement seulement.',
  )
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
  // P0-S9 : en production, démarrer sans Supabase = erreur, pas une bascule silencieuse vers un SQLite vide et
  // éphémère (sur Render, le fichier est perdu à chaque redéploiement ou réveil — clients et tirages avec).
  // Hors production, SQLite reste le défaut (développement local, tests).
  if (production && !supabase) {
    arreter('En production, Supabase est obligatoire : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définies (refus de démarrer sur SQLite vide).')
  }
  app = await creerServeur({
    fichierDb,
    supabase,
    adminPin,
    pinInitial,
    secretSession,
    authClient,
    demo: env.DEMO === '1',
    production,
    derriereProxy: env.TRUST_PROXY === '1' || !!env.RENDER,
    origineCors,
    dossierStatique: existsSync(resolve(dossierStatique, 'index.html')) ? dossierStatique : undefined,
    version: pkg.version,
    urlPublique: env.PUBLIC_URL,
    // V3 : intégrations préparées, inactives tant que ces variables sont absentes (aucune n'est configurée).
    googleWallet: { issuerId: env.GOOGLE_WALLET_ISSUER_ID, fichierCleService: env.GOOGLE_WALLET_SERVICE_ACCOUNT_FILE },
    notifications: configDepuisEnv(env),
    // P1-B4 : GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (+ GOOGLE_REDIRECT_URI, GOOGLE_BUSINESS_LOCATION facultatives).
    googleBusiness: configGoogleBusinessDepuisEnv(env),
  })
} catch (e) {
  arreter(e instanceof Error ? e.message : String(e))
}

const port = Number(env.PORT ?? 3001)
app.serveur.listen(port, () => {
  console.log(`[serveur] Asian Home Fidélité ${pkg.version} — http://localhost:${port}/api/v1/sante`)
  console.log(`[serveur] mode ${production ? 'production' : 'développement'} · base ${supabase ? `Supabase ${new URL(supabase.url).host}` : fichierDb} · démo ${env.DEMO === '1' ? 'oui' : 'non'} · fuseau ${env.TZ}`)
  console.log('[serveur] intégrations : voir /api/v1/sante (Apple Wallet en suspens ; Google Wallet, Google Business Profile, SMS, e-mail actifs seulement si leurs variables sont définies)')
  if (env.BREVO_MODE_TEST === '1') console.log('[serveur] MODE TEST Brevo actif (BREVO_MODE_TEST=1) : aucun SMS / e-mail réel ne part — e-mail en sandbox Brevo, SMS simulé.')
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.fermer().then(() => process.exit(0))
  })
}

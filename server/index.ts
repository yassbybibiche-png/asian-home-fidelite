// Point d'entrée : `npm run serveur` (Node 24 exécute le TypeScript directement).
// Toutes les variables d'environnement sont décrites dans server/README.md.

// « Visite du jour » et « 1 tirage par jour » se comptent en jours calendaires de l'heure de Paris,
// même sur un hébergeur réglé en UTC. À fixer avant toute manipulation de date.
process.env.TZ ||= 'Europe/Paris'

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import pkg from '../package.json' with { type: 'json' }
import { creerServeur } from './app.ts'

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

let pinInitial = env.PIN_ASIAN_HOME
if (!pinInitial && !production) pinInitial = '1234'

const dossierStatique = resolve(env.STATIC_DIR ?? 'dist')
const fichierDb = resolve(env.DB_FILE ?? 'data/fidelite.db')

let app
try {
  app = creerServeur({
    fichierDb,
    adminPin,
    pinInitial,
    demo: env.DEMO === '1',
    production,
    derriereProxy: env.TRUST_PROXY === '1' || !!env.RENDER,
    origineCors: env.CORS_ORIGIN || '*',
    dossierStatique: existsSync(resolve(dossierStatique, 'index.html')) ? dossierStatique : undefined,
    version: pkg.version,
  })
} catch (e) {
  arreter(e instanceof Error ? e.message : String(e))
}

const port = Number(env.PORT ?? 3001)
app.serveur.listen(port, () => {
  console.log(`[serveur] Asian Home Fidélité ${pkg.version} — http://localhost:${port}/api/v1/sante`)
  console.log(`[serveur] mode ${production ? 'production' : 'développement'} · base ${fichierDb} · démo ${env.DEMO === '1' ? 'oui' : 'non'} · fuseau ${env.TZ}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.fermer().then(() => process.exit(0))
  })
}

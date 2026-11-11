#!/usr/bin/env node
// Retour arrière Render en une commande (P0-S10) : redéployer un commit précédent sur un service.
// Procédure complète : docs/DEPLOIEMENT.md § 3. Ce script ne touche JAMAIS à la base (ni schéma, ni données,
// ni configuration) : il ne fait que demander à Render de déployer un autre commit — voir les limites § 3.3.
//
// Usage (simulation par défaut : rien n'est envoyé, la commande exacte est affichée) :
//   node scripts/rollback-render.mjs --service staging --service-id srv-xxxxxxxxxxxx --commit <sha-40> [--executer]
//   RENDER_API_KEY=... node scripts/rollback-render.mjs --service production --service-id srv-... --commit <sha-40> --executer
//
// Variables d'environnement : RENDER_API_KEY (obligatoire avec --executer, jamais affichée, même tronquée),
// RENDER_SERVICE_ID (repli si --service-id absent).
// Le commit doit exister dans le dépôt local (vérifié par `git rev-parse`) : on ne redéploie jamais un SHA inconnu.
// Sans --executer, le script s'arrête après avoir affiché la commande curl équivalente (code 0, aucun appel réseau).
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const RACINE = resolve(import.meta.dirname, '..')
const API = 'https://api.render.com/v1'

export const MOTIF_SERVICE_ID = /^srv-[A-Za-z0-9_-]+$/
export const MOTIF_COMMIT = /^[0-9a-f]{40}$/
export const SERVICES = ['staging', 'production']

/** Erreur d'usage : message clair, sans secret. */
export class ErreurUsage extends Error {}

/** Valide l'identifiant Render du service (`srv-…`, visible dans le dashboard Render). */
export function validerServiceId(serviceId) {
  if (typeof serviceId !== 'string' || !MOTIF_SERVICE_ID.test(serviceId)) {
    throw new ErreurUsage(`--service-id invalide : attendu « srv-… » (identifiant Render du service, dashboard → service → Settings), reçu « ${serviceId ?? ''} »`)
  }
  return serviceId
}

/** Valide le SHA complet (40 hex) du commit à redéployer. Un SHA court est refusé : ambigu. */
export function validerCommit(commit) {
  if (typeof commit !== 'string' || !MOTIF_COMMIT.test(commit)) {
    throw new ErreurUsage(`--commit invalide : attendu un SHA complet de 40 caractères hexadécimaux (git rev-parse HEAD~1), reçu « ${commit ?? ''} »`)
  }
  return commit
}

/** Valide le libellé du service : on nomme explicitement staging ou production avant tout retour arrière. */
export function validerService(service) {
  if (!SERVICES.includes(service)) {
    throw new ErreurUsage(`--service invalide : attendu « staging » ou « production », reçu « ${service ?? ''} »`)
  }
  return service
}

/** Le commit existe-t-il dans le dépôt local ? Refuse un SHA inconnu (jamais de redéploiement à l'aveugle). */
export function commitExisteLocalement(commit) {
  try {
    execFileSync('git', ['rev-parse', '--verify', `${commit}^{commit}`], { cwd: RACINE, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/** Une ligne de résumé du commit (sujet + date), pour confirmer avant d'exécuter. */
export function decrireCommit(commit) {
  try {
    return execFileSync('git', ['log', '-1', '--format=%h %ad %s', '--date=short', commit], { cwd: RACINE, encoding: 'utf8', stdio: 'pipe' }).trim()
  } catch {
    return commit
  }
}

/**
 * Construit l'appel « Trigger deploy » de l'API Render (doc officielle, api-docs.render.com/reference/create-deploy :
 * POST /v1/services/{serviceId}/deploys, corps { commitId }). La clé n'apparaît que dans l'en-tête Authorization
 * (construit au moment de l'envoi), jamais dans l'URL ni dans les messages.
 */
export function construireAppel({ serviceId, commitId }) {
  validerServiceId(serviceId)
  validerCommit(commitId)
  return {
    url: `${API}/services/${serviceId}/deploys`,
    methode: 'POST',
    corps: JSON.stringify({ commitId }),
  }
}

/** En-têtes de l'appel, clé lue dans RENDER_API_KEY (jamais affichée, même tronquée). */
export function construireEntetes(cleApi) {
  if (typeof cleApi !== 'string' || cleApi.length === 0) throw new ErreurUsage('RENDER_API_KEY manquante (variable d’environnement, créée dans le dashboard Render → Account Settings → API Keys)')
  return { Authorization: `Bearer ${cleApi}`, 'Content-Type': 'application/json', Accept: 'application/json' }
}

/** La commande curl équivalente, avec la clé référencée par sa variable (jamais en clair). */
export function commandeCurl(appel) {
  return `curl --fail-with-body --silent --show-error --request POST '${appel.url}' --header 'Authorization: Bearer '"$RENDER_API_KEY"'' --header 'Content-Type: application/json' --header 'Accept: application/json' --data '${appel.corps}'`
}

const AIDE = `Retour arrière Render en une commande (P0-S10) — docs/DEPLOIEMENT.md § 3

Usage : node scripts/rollback-render.mjs --service <staging|production> --service-id <srv-…> --commit <sha-40> [--executer]
        RENDER_API_KEY=... node scripts/rollback-render.mjs --service production --service-id srv-... --commit <sha-40> --executer

Sans --executer : SIMULATION — rien n'est envoyé, la commande curl exacte est affichée.
Avec --executer : l'appel est envoyé à l'API Render (clé lue dans RENDER_API_KEY, jamais affichée).

Le commit doit exister dans le dépôt local. Redéployer un commit ne restaure ni le schéma, ni les données,
ni la configuration : avant un retour arrière après écritures partielles, voir docs/DEPLOIEMENT.md § 4.
`

function lireArgs(argv) {
  const args = { service: undefined, serviceId: process.env.RENDER_SERVICE_ID, commit: undefined, executer: false, aide: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--aide' || a === '-h' || a === '--help') args.aide = true
    else if (a === '--executer') args.executer = true
    else if (a === '--service' || a === '--service-id' || a === '--commit') {
      const valeur = argv[++i]
      if (valeur === undefined || valeur.startsWith('--')) throw new ErreurUsage(`option ${a} : valeur manquante`)
      if (a === '--service') args.service = valeur
      else if (a === '--service-id') args.serviceId = valeur
      else args.commit = valeur
    } else throw new ErreurUsage(`option inconnue : ${a} (voir --aide)`)
  }
  return args
}

async function main(argv, env) {
  let args
  try {
    args = lireArgs(argv)
  } catch (e) {
    if (e instanceof ErreurUsage) {
      console.error(`Erreur : ${e.message}\n${AIDE}`)
      return 2
    }
    throw e
  }
  if (args.aide) {
    console.log(AIDE)
    return 0
  }
  try {
    const service = validerService(args.service)
    const serviceId = validerServiceId(args.serviceId)
    const commit = validerCommit(args.commit)
    if (!commitExisteLocalement(commit)) {
      console.error(`Erreur : le commit ${commit} n'existe pas dans le dépôt local (git rev-parse). Vérifiez le SHA (git log --oneline -5) avant tout retour arrière.`)
      return 2
    }
    const description = decrireCommit(commit)
    console.log(`Retour arrière ${service} (${serviceId}) → commit ${description}`)
    // Simulation : on construit l'appel (URL + corps) sans clé et sans rien envoyer.
    const appel = construireAppel({ serviceId, commitId: commit })
    if (!args.executer) {
      console.log('SIMULATION — rien n’a été envoyé. Commande exacte à exécuter (ou relancer avec --executer) :')
      console.log(commandeCurl(appel))
      console.log('Ensuite : attendre « Live », puis vérifier docs/DEPLOIEMENT.md § 3.4 (GET /api/v1/sante + parcours de base).')
      return 0
    }
    const entetes = construireEntetes(env.RENDER_API_KEY ?? '')
    const reponse = await fetch(appel.url, { method: appel.methode, headers: entetes, body: appel.corps })
    const texte = await reponse.text()
    if (!reponse.ok) {
      console.error(`Erreur : l’API Render a refusé (${reponse.status}) : ${texte.slice(0, 500)}`)
      return 1
    }
    let deployId = '?'
    try {
      deployId = JSON.parse(texte).deploy?.id ?? JSON.parse(texte).id ?? '?'
    } catch { /* réponse non JSON : on garde l'identifiant inconnu, le statut HTTP suffit */ }
    console.log(`Déploiement déclenché : deploy ${deployId} (statut HTTP ${reponse.status}).`)
    console.log('Attendre « Live » dans le dashboard Render, puis vérifier docs/DEPLOIEMENT.md § 3.4 (GET /api/v1/sante + parcours de base).')
    return 0
  } catch (e) {
    if (e instanceof ErreurUsage) {
      console.error(`Erreur : ${e.message}\n${AIDE}`)
      return 2
    }
    throw e
  }
}

// Point d'entrée CLI uniquement : importé par les tests, le module ne fait rien.
if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main(process.argv.slice(2), process.env)
}

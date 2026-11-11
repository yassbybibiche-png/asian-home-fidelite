#!/usr/bin/env node
// Sauvegarde complète de la base Supabase (P0-S5) : les 14 tables, via PostgREST et la clé service_role.
// Usage et procédure : `node scripts/sauvegarde-base.mjs --aide`, docs/SAUVEGARDE.md.
//
// Node 24 retire les types à la volée : ce script .mjs importe directement la logique pure de server/sauvegarde.ts
// (comme `npm run serveur` lance server/index.ts). Aucune dépendance en plus de @supabase/supabase-js.
// Jamais de secret dans les logs : ni la clé service_role ni la clé de chiffrement ne sont affichées, même tronquées.
import { mkdirSync, readdirSync, rmSync, writeFileSync, linkSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  COLONNES_SAUVEGARDE, TABLES_SAUVEGARDE, chiffrerSauvegarde, exporterSauvegarde, purgerAnciennesSauvegardes,
} from '../server/sauvegarde.ts'

const RACINE = resolve(import.meta.dirname, '..')
const PAGE = 1000 // PostgREST (Supabase) plafonne une réponse à 1 000 lignes
const MOTIF = /^asian-home-(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})\.json\.gz$/

const AIDE = `Sauvegarde complète de la base Supabase (14 tables) — docs/SAUVEGARDE.md

Usage : node scripts/sauvegarde-base.mjs [--dir <dossier>] [--sans-chiffrement]
        npm run sauvegarde -- [options]

Variables d'environnement :
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   obligatoires (accès en lecture à toutes les tables)
  SAUVEGARDE_DIR                            dossier de sortie (défaut : <dépôt>/sauvegardes/)
  SAUVEGARDE_CLE_CHIFFREMENT                64 caractères hexadécimaux (openssl rand -hex 32) → AES-256-GCM
  SAUVEGARDE_RETENTION_JOURS                défaut 30
  SAUVEGARDE_RETENTION_NOMBRE               défaut 30

Options :
  --dir <dossier>        dossier de sortie (prioritaire sur SAUVEGARDE_DIR)
  --sans-chiffrement     écrit en clair même si une clé est définie (avertissement)
  --aide, --help         cette aide

Fichier produit : asian-home-AAAA-MM-JJTHHMMSS.json.gz (heure UTC). Succès : « SAUVEGARDE OK — … », sortie 0.
Échec : « ERREUR SAUVEGARDE — <cause> » sur stderr, sortie 1, aucun fichier écrit.`

class ErreurUsage extends Error {}

function lireOptions(args) {
  const o = { aide: false, dir: undefined, sansChiffrement: false }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--aide' || a === '--help' || a === '-h') o.aide = true
    else if (a === '--sans-chiffrement') o.sansChiffrement = true
    else if (a === '--dir') {
      o.dir = args[++i]
      if (!o.dir) throw new ErreurUsage('--dir demande un dossier.')
    } else throw new ErreurUsage(`option inconnue : ${a} (voir --aide).`)
  }
  return o
}

function entier(env, nom, defaut) {
  const v = env[nom]?.trim()
  if (!v) return defaut
  if (!/^\d+$/.test(v)) throw new ErreurUsage(`${nom} doit être un entier positif.`)
  return Number(v)
}

/** AAAA-MM-JJTHHMMSS en UTC. */
function horodatage(d) {
  return d.toISOString().slice(0, 19).replace(/:/g, '')
}

async function principal() {
  const options = lireOptions(process.argv.slice(2))
  if (options.aide) {
    console.log(AIDE)
    return
  }
  const env = process.env
  const url = env.SUPABASE_URL?.trim()
  const cleService = env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const absentes = [!url && 'SUPABASE_URL', !cleService && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean)
  if (absentes.length) throw new ErreurUsage(`variable(s) d'environnement manquante(s) : ${absentes.join(', ')}.`)
  if (!/^https?:\/\/\S+$/.test(url)) throw new ErreurUsage('SUPABASE_URL doit être une adresse web (https://<projet>.supabase.co).')

  const cleChiffrement = env.SAUVEGARDE_CLE_CHIFFREMENT?.trim() || undefined
  if (cleChiffrement && !/^[0-9a-fA-F]{64}$/.test(cleChiffrement)) {
    throw new ErreurUsage('SAUVEGARDE_CLE_CHIFFREMENT invalide : 64 caractères hexadécimaux attendus (openssl rand -hex 32).')
  }
  const garderJours = entier(env, 'SAUVEGARDE_RETENTION_JOURS', 30)
  const garderNombre = entier(env, 'SAUVEGARDE_RETENTION_NOMBRE', 30)
  const dossier = resolve(options.dir ?? (env.SAUVEGARDE_DIR?.trim() || join(RACINE, 'sauvegardes')))

  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(url.replace(/\/+$/, ''), cleService, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  /**
   * Lit une table page par page (1 000 lignes), triée sur sa clé pour une pagination stable, jusqu'à épuisement.
   * Vérification d'intégrité (revue Codex P0-S5) : chaque page demande le compteur exact (`count: 'exact'`, en-tête
   * Content-Range de PostgREST). Si le compteur change d'une page à l'autre (écriture / suppression concurrente) ou
   * si le total lu diffère du compteur (plafond PostgREST configuré sous 1 000, ou ligne perdue entre deux pages),
   * l'export est REFUSÉ : jamais de sauvegarde silencieusement incomplète.
   */
  async function lireTable(table) {
    const { cle } = TABLES_SAUVEGARDE.find((t) => t.nom === table)
    const lignes = []
    let totalAttendu
    for (let debut = 0; ; debut += PAGE) {
      let requete = sb.from(table).select(COLONNES_SAUVEGARDE, { count: 'exact' })
      for (const c of cle) requete = requete.order(c, { ascending: true })
      const { data, count, error } = await requete.range(debut, debut + PAGE - 1)
      if (error) {
        const e = new Error(error.code === 'PGRST205' || error.code === '42P01'
          ? `table inconnue « ${table} »` : `Supabase (${table}) : ${error.message}${error.code ? ` [${error.code}]` : ''}`)
        e.code = error.code
        throw e
      }
      if (count == null) throw new Error(`table « ${table} » : compteur exact indisponible (en-tête Content-Range absent) — sauvegarde refusée.`)
      if (totalAttendu === undefined) totalAttendu = count
      else if (count !== totalAttendu) {
        throw new Error(`table « ${table} » : ${totalAttendu} lignes comptées puis ${count} — écriture concurrente pendant l'export, sauvegarde refusée (relancer restaurant fermé).`)
      }
      lignes.push(...data)
      if (data.length < PAGE) {
        if (lignes.length !== totalAttendu) {
          throw new Error(`table « ${table} » : ${lignes.length} lignes lues pour ${totalAttendu} comptées — plafond PostgREST inférieur à ${PAGE} ou ligne perdue entre deux pages, sauvegarde refusée.`)
        }
        return lignes
      }
    }
  }

  const sauvegarde = await exporterSauvegarde(lireTable)
  const json = JSON.stringify(sauvegarde)
  let contenu = json
  if (cleChiffrement && options.sansChiffrement) {
    console.warn('AVERTISSEMENT — --sans-chiffrement : sauvegarde écrite EN CLAIR malgré SAUVEGARDE_CLE_CHIFFREMENT (fichier sensible : contacts clients, hash des PIN).')
  } else if (cleChiffrement) {
    contenu = chiffrerSauvegarde(json, cleChiffrement)
  } else {
    console.warn('AVERTISSEMENT — sauvegarde non chiffrée (SAUVEGARDE_CLE_CHIFFREMENT absente) : fichier sensible, à protéger.')
  }

  mkdirSync(dossier, { recursive: true })
  const nom = `asian-home-${horodatage(new Date(sauvegarde.creeLe))}.json.gz`
  const final = join(dossier, nom)
  // Écriture en .tmp (nom unique par processus) puis lien atomique : jamais de fichier final partiel, et deux
  // sauvegardes dans la même seconde ne peuvent plus s'écraser (linkSync échoue EEXIST si le nom existe déjà).
  const temporaire = `${final}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    writeFileSync(temporaire, gzipSync(Buffer.from(contenu, 'utf8')), { mode: 0o600 })
    try {
      linkSync(temporaire, final)
    } catch (e) {
      if (e.code === 'EEXIST') throw new Error(`le fichier ${nom} existe déjà (deux sauvegardes dans la même seconde ?).`)
      throw e
    }
  } finally {
    rmSync(temporaire, { force: true })
  }

  const total = Object.values(sauvegarde.compteurs).reduce((a, b) => a + b, 0)
  const detail = Object.entries(sauvegarde.compteurs).map(([t, n]) => `${t} ${n}`).join(', ')
  console.log(`SAUVEGARDE OK — ${final} — ${total} lignes (${detail})${contenu === json ? '' : ' — chiffrée AES-256-GCM'}`)

  // Rétention : seulement les fichiers de sauvegarde de ce dossier (nom reconnu), jamais autre chose.
  const fichiers = readdirSync(dossier).flatMap((n) => {
    const m = MOTIF.exec(n)
    return m ? [{ nom: n, dateMs: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) }] : []
  })
  for (const n of purgerAnciennesSauvegardes(fichiers, garderJours, garderNombre)) {
    rmSync(join(dossier, n))
    console.log(`Rétention — supprimé : ${n}`)
  }
}

principal().catch((e) => {
  console.error(`ERREUR SAUVEGARDE — ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})

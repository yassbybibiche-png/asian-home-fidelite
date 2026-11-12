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
  chiffrerSauvegarde, exporterSauvegarde, lireTablePostgrest, nomFichierSauvegarde, purgerAnciennesSauvegardes,
} from '../server/sauvegarde.ts'

const RACINE = resolve(import.meta.dirname, '..')
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

  // Lecture page par page avec compteur exact (revue Codex P0-S5) : `lireTablePostgrest`, partagée avec la route
  // admin `GET /admin/sauvegarde` du serveur.
  const sauvegarde = await exporterSauvegarde(lireTablePostgrest(sb))
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
  const nom = nomFichierSauvegarde(sauvegarde.creeLe)
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

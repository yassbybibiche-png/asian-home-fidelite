#!/usr/bin/env node
// Restauration d'une sauvegarde (P0-S5) dans une base PGlite LOCALE et jetable — jamais dans Supabase.
// Usage : `node scripts/restaurer-base.mjs --aide` ; procédure complète (dont la restauration manuelle vers Supabase) :
// docs/SAUVEGARDE.md.
//
// Rôles et RLS : les migrations 0002+ font des `grant` / `revoke` sur anon, authenticated et service_role ; ces rôles
// sont donc créés AVANT (SQL_ROLES_SUPABASE, service_role BYPASSRLS comme sur Supabase). La restauration s'exécute
// ensuite en tant que propriétaire des tables (superutilisateur PGlite) : la RLS ne s'applique pas au propriétaire
// (aucune table n'est en FORCE ROW LEVEL SECURITY), donc rien à désactiver et le schéma restauré reste identique.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import {
  SQL_ROLES_SUPABASE, TABLES_SAUVEGARDE, dechiffrerSauvegarde, ecrireTableSql, estChiffre, migrationsARejouer,
  restaurerSauvegarde, validerSauvegarde,
} from '../server/sauvegarde.ts'

const RACINE = resolve(import.meta.dirname, '..')
const MIGRATIONS = join(RACINE, 'supabase', 'migrations')

const AIDE = `Restauration d'une sauvegarde dans une base PGlite locale (jamais Supabase) — docs/SAUVEGARDE.md

Usage : node scripts/restaurer-base.mjs <fichier-sauvegarde> --cible pglite [--fichier <dossier-pglite>] [--verifier]
        npm run restaurer -- <fichier> --cible pglite [options]

  --cible pglite         seule cible acceptée (une cible Supabase / Postgres est REFUSÉE dans cette version)
  --fichier <dossier>    base PGlite persistante (dossier) ; défaut : en mémoire, perdue à la fin
  --verifier             après restauration, recompte chaque table dans la base et compare au fichier (écart → sortie 1)
  --aide, --help         cette aide

Fichier chiffré : SAUVEGARDE_CLE_CHIFFREMENT (64 hex) doit contenir la clé utilisée à la sauvegarde.
Échec : « ERREUR RESTAURATION — <cause> » sur stderr, sortie 1, transaction annulée (aucune donnée partielle).`

class ErreurUsage extends Error {}

function lireOptions(args) {
  const o = { aide: false, fichierSauvegarde: undefined, cible: undefined, fichierPglite: undefined, verifier: false }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--aide' || a === '--help' || a === '-h') o.aide = true
    else if (a === '--verifier') o.verifier = true
    else if (a === '--cible') o.cible = args[++i]
    else if (a === '--fichier') o.fichierPglite = args[++i]
    else if (a.startsWith('--')) throw new ErreurUsage(`option inconnue : ${a} (voir --aide).`)
    else if (!o.fichierSauvegarde) o.fichierSauvegarde = a
    else throw new ErreurUsage(`argument en trop : ${a}.`)
  }
  return o
}

/** Lit le fichier : gunzip, puis déchiffre s'il est chiffré. */
function lireSauvegarde(chemin) {
  let texte = gunzipSync(readFileSync(chemin)).toString('utf8')
  if (estChiffre(texte)) {
    const cle = process.env.SAUVEGARDE_CLE_CHIFFREMENT?.trim()
    if (!cle) throw new Error('sauvegarde chiffrée : définissez SAUVEGARDE_CLE_CHIFFREMENT (la clé utilisée à la sauvegarde).')
    texte = dechiffrerSauvegarde(texte, cle)
  }
  try {
    return JSON.parse(texte)
  } catch {
    throw new Error('contenu illisible (JSON invalide après décompression / déchiffrement).')
  }
}

async function principal() {
  const o = lireOptions(process.argv.slice(2))
  if (o.aide) {
    console.log(AIDE)
    return
  }
  if (!o.fichierSauvegarde) throw new ErreurUsage('fichier de sauvegarde manquant (voir --aide).')
  if (!o.cible) throw new ErreurUsage('--cible manquante : seule « --cible pglite » est acceptée.')
  if (o.cible !== 'pglite') {
    // La valeur n'est jamais affichée : un DSN Postgres peut contenir un mot de passe.
    throw new ErreurUsage('cible refusée (seule « pglite » est acceptée) : '
      + 'la restauration vers Supabase n’est pas automatisée (risque d’écraser la production). '
      + 'Procédure manuelle : docs/SAUVEGARDE.md § Restaurer vers Supabase.')
  }
  if (!existsSync(o.fichierSauvegarde)) throw new ErreurUsage(`fichier introuvable : ${o.fichierSauvegarde}`)

  const sauvegarde = lireSauvegarde(o.fichierSauvegarde)
  const { manquantes } = validerSauvegarde(sauvegarde)
  if (manquantes.length) throw new Error(`sauvegarde incomplète, restauration refusée — table(s) manquante(s) : ${manquantes.join(', ')}.`)

  const { PGlite } = await import('@electric-sql/pglite')
  const db = o.fichierPglite ? new PGlite(resolve(o.fichierPglite)) : new PGlite()
  try {
    const roles = await db.query(`select count(*)::int as n from pg_roles where rolname in ('anon', 'authenticated', 'service_role')`)
    if (roles.rows[0].n === 0) await db.exec(SQL_ROLES_SUPABASE)
    for (const f of migrationsARejouer(readdirSync(MIGRATIONS))) await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'))

    // Base cible vide exigée : restaurer par-dessus des données existantes donnerait un mélange invérifiable.
    for (const { nom } of TABLES_SAUVEGARDE) {
      const { rows } = await db.query(`select count(*)::int as n from public.${nom}`)
      if (rows[0].n > 0) throw new Error(`la base PGlite cible n’est pas vide (table « ${nom} ») : utilisez un nouveau dossier.`)
    }

    // Une seule transaction : la moindre erreur annule tout (aucune donnée partielle).
    const compteurs = await db.transaction((tx) => restaurerSauvegarde(sauvegarde, ecrireTableSql((sql, p) => tx.query(sql, p))))

    for (const { nom } of TABLES_SAUVEGARDE) {
      if (compteurs[nom] !== sauvegarde.tables[nom].length) {
        throw new Error(`table « ${nom} » : ${compteurs[nom]} ligne(s) écrite(s) pour ${sauvegarde.tables[nom].length} dans le fichier.`)
      }
    }
    const total = Object.values(compteurs).reduce((a, b) => a + b, 0)
    console.log(`RESTAURATION OK (PGlite ${o.fichierPglite ? resolve(o.fichierPglite) : 'en mémoire'}) — sauvegarde du ${sauvegarde.creeLe} — ${total} lignes`)
    for (const { nom } of TABLES_SAUVEGARDE) console.log(`  ${nom.padEnd(20)} ${compteurs[nom]}`)

    if (o.verifier) {
      const ecarts = []
      for (const { nom } of TABLES_SAUVEGARDE) {
        const { rows } = await db.query(`select count(*)::int as n from public.${nom}`)
        if (rows[0].n !== sauvegarde.compteurs?.[nom] || rows[0].n !== sauvegarde.tables[nom].length) {
          ecarts.push(`${nom} : base ${rows[0].n}, fichier ${sauvegarde.tables[nom].length}, compteur ${sauvegarde.compteurs?.[nom]}`)
        }
      }
      if (ecarts.length) throw new Error(`vérification échouée — ${ecarts.join(' ; ')}`)
      console.log('VÉRIFICATION OK — compteurs de la base = compteurs du fichier, pour les 14 tables.')
    }
  } finally {
    await db.close()
  }
}

principal().catch((e) => {
  console.error(`ERREUR RESTAURATION — ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})

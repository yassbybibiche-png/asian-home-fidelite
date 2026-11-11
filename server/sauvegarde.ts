// Sauvegarde complète de la base (P0-S5, 11/11/2026). Logique pure : aucun accès réseau ni disque ici.
// Les lectures / écritures sont injectées (`lireTable`, `ecrireTable`) : PostgREST (Supabase) dans
// `scripts/sauvegarde-base.mjs`, PGlite dans `scripts/restaurer-base.mjs` et dans les tests.
// Procédure complète, RPO / RTO et limites : docs/SAUVEGARDE.md.
//
// Règle d'or : JAMAIS de sauvegarde silencieusement incomplète. Une table absente (migration non appliquée) ou
// illisible fait échouer l'export entier ; une sauvegarde à laquelle il manque une table est refusée à la restauration.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

export interface TableSauvegarde {
  nom: string
  /** Clé de conflit (upsert à la restauration) ; sert aussi d'ordre stable pour la pagination. */
  cle: string[]
  /** Colonnes `generated always as identity` : réinsérées avec OVERRIDING SYSTEM VALUE, jamais mises à jour. */
  generees: string[]
}

/** Les 14 tables de supabase/migrations 0001 à 0008, dans l'ordre des clés étrangères (parents d'abord). */
export const TABLES_SAUVEGARDE: readonly TableSauvegarde[] = [
  { nom: 'meta', cle: ['cle'], generees: [] },
  { nom: 'commerces', cle: ['id'], generees: ['ordre'] },
  { nom: 'clients', cle: ['id'], generees: ['ordre'] },
  { nom: 'tirages', cle: ['id'], generees: [] },
  { nom: 'avis', cle: ['id'], generees: [] },
  { nom: 'equipe', cle: ['id'], generees: ['ordre'] },
  { nom: 'journal', cle: ['id'], generees: [] },
  { nom: 'menus', cle: ['commerce_id'], generees: [] },
  { nom: 'parrainages', cle: ['id'], generees: [] },
  { nom: 'demandes_rattrapage', cle: ['id'], generees: [] },
  { nom: 'sessions_revoquees', cle: ['jti'], generees: [] },
  { nom: 'tentatives_auth', cle: ['cle'], generees: [] },
  { nom: 'envois', cle: ['id'], generees: [] },
  { nom: 'evenements_jour', cle: ['commerce_id', 'jour', 'type'], generees: [] },
]

/** Toutes les colonnes : `*` côté PostgREST, `select *` (via to_jsonb) côté Postgres / PGlite. */
export const COLONNES_SAUVEGARDE = '*'

export const FORMAT_SAUVEGARDE = 'asian-home-sauvegarde'
export const VERSION_SAUVEGARDE = 1

export type Ligne = Record<string, unknown>

export interface Sauvegarde {
  format: typeof FORMAT_SAUVEGARDE
  version: typeof VERSION_SAUVEGARDE
  creeLe: string
  tables: Record<string, Ligne[]>
  compteurs: Record<string, number>
}

/** Table absente : ErreurMigrationManquante du stockage, PostgREST PGRST205, Postgres 42P01, ou message explicite. */
function estTableAbsente(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const err = e as { name?: string; code?: string; message?: string; constructor?: { name?: string } }
  if (err.constructor?.name === 'ErreurMigrationManquante') return true
  if (err.code === 'PGRST205' || err.code === '42P01') return true
  return /table inconnue|n’existe pas|n'existe pas|does not exist|could not find the table/i.test(err.message ?? '')
}

/**
 * Lit les 14 tables. Une seule table absente ou illisible → erreur qui la nomme : aucune sauvegarde partielle.
 * `maintenant` : injectable pour les tests.
 */
export async function exporterSauvegarde(
  lireTable: (table: string) => Promise<Ligne[]>,
  maintenant: () => Date = () => new Date(),
): Promise<Sauvegarde> {
  const tables: Record<string, Ligne[]> = {}
  const compteurs: Record<string, number> = {}
  for (const { nom } of TABLES_SAUVEGARDE) {
    let lignes: Ligne[]
    try {
      lignes = await lireTable(nom)
    } catch (e) {
      if (estTableAbsente(e)) {
        throw new Error(`table « ${nom} » absente (migration non appliquée ?) — sauvegarde refusée : elle serait incomplète.`)
      }
      throw new Error(`lecture de la table « ${nom} » impossible : ${e instanceof Error ? e.message : String(e)}`)
    }
    if (!Array.isArray(lignes)) throw new Error(`lecture de la table « ${nom} » : réponse inattendue (pas une liste).`)
    tables[nom] = lignes
    compteurs[nom] = lignes.length
  }
  return { format: FORMAT_SAUVEGARDE, version: VERSION_SAUVEGARDE, creeLe: maintenant().toISOString(), tables, compteurs }
}

/** Vérifie format / version (erreur) et liste les tables absentes ou mal formées (tableau absent ou non-tableau). */
export function validerSauvegarde(donnees: unknown): { manquantes: string[] } {
  if (!donnees || typeof donnees !== 'object') throw new Error('fichier de sauvegarde illisible (pas un objet JSON).')
  const s = donnees as Partial<Sauvegarde>
  if (s.format !== FORMAT_SAUVEGARDE) throw new Error(`format de sauvegarde inconnu (attendu « ${FORMAT_SAUVEGARDE} »).`)
  if (s.version !== VERSION_SAUVEGARDE) throw new Error(`version de sauvegarde ${String(s.version)} non prise en charge (attendu ${VERSION_SAUVEGARDE}).`)
  const tables = s.tables && typeof s.tables === 'object' ? s.tables : {}
  return { manquantes: TABLES_SAUVEGARDE.map((t) => t.nom).filter((nom) => !Array.isArray((tables as Record<string, unknown>)[nom])) }
}

/** Écrit table par table (ordre des clés étrangères). Refuse d'écrire quoi que ce soit si une table manque. */
export async function restaurerSauvegarde(
  donnees: unknown,
  ecrireTable: (table: string, lignes: Ligne[]) => Promise<number>,
): Promise<Record<string, number>> {
  const { manquantes } = validerSauvegarde(donnees)
  if (manquantes.length) throw new Error(`sauvegarde incomplète, restauration refusée — table(s) manquante(s) : ${manquantes.join(', ')}.`)
  const tables = (donnees as Sauvegarde).tables
  const compteurs: Record<string, number> = {}
  for (const { nom } of TABLES_SAUVEGARDE) compteurs[nom] = tables[nom].length ? await ecrireTable(nom, tables[nom]) : 0
  return compteurs
}

// ---------- Adaptateurs SQL (Postgres / PGlite) : la requête est injectée, ce module n'ouvre aucune base ----------

export type RequeteSql = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }>

function definition(table: string): TableSauvegarde {
  const t = TABLES_SAUVEGARDE.find((x) => x.nom === table)
  if (!t) throw new Error(`table inconnue : « ${table} ».`)
  return t
}

/** Identifiant SQL sûr : uniquement des noms simples (les colonnes viennent d'un fichier, jamais interpolées brutes). */
function ident(nom: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(nom)) throw new Error(`nom de colonne refusé : « ${nom} ».`)
  return `"${nom}"`
}

/** Lecture d'une table en JSON (mêmes formes que PostgREST : dates en texte ISO, JSONB en objet). */
export function lireTableSql(requete: RequeteSql): (table: string) => Promise<Ligne[]> {
  return async (table) => {
    const t = definition(table)
    const { rows } = await requete(`select to_jsonb(x) as l from public.${ident(t.nom)} x order by ${t.cle.map((c) => `x.${ident(c)}`).join(', ')}`)
    return (rows as { l: Ligne }[]).map((r) => r.l)
  }
}

const PAQUET_SQL = 500

/**
 * Écriture par upsert sur la clé de conflit (`insert … on conflict do update`), par paquets de 500 lignes.
 * Les valeurs passent en un seul paramètre JSON converti par `jsonb_populate_recordset` (types de la table respectés,
 * JSONB réinséré tel quel). Les colonnes `ordre` (identity) gardent leur valeur d'origine (OVERRIDING SYSTEM VALUE)
 * puis la séquence est recalée au-delà du maximum, pour que les prochaines inscriptions restent après.
 */
export function ecrireTableSql(requete: RequeteSql): (table: string, lignes: Ligne[]) => Promise<number> {
  return async (table, lignes) => {
    const t = definition(table)
    const colonnes = [...new Set(lignes.flatMap((l) => Object.keys(l)))]
    const cols = colonnes.map(ident).join(', ')
    const maj = colonnes.filter((c) => !t.cle.includes(c) && !t.generees.includes(c))
    const conflit = `on conflict (${t.cle.map(ident).join(', ')}) do ${maj.length ? `update set ${maj.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(', ')}` : 'nothing'}`
    const surcharge = t.generees.some((g) => colonnes.includes(g)) ? ' overriding system value' : ''
    let ecrites = 0
    for (let i = 0; i < lignes.length; i += PAQUET_SQL) {
      const paquet = lignes.slice(i, i + PAQUET_SQL)
      const r = await requete(
        `insert into public.${ident(t.nom)} (${cols})${surcharge} select ${cols} from jsonb_populate_recordset(null::public.${ident(t.nom)}, $1::jsonb) ${conflit}`,
        [JSON.stringify(paquet)])
      ecrites += r.affectedRows ?? 0
    }
    for (const g of t.generees) {
      if (!colonnes.includes(g)) continue
      await requete(`select setval(pg_get_serial_sequence('public.${t.nom}', '${g}'), coalesce((select max(${ident(g)}) from public.${ident(t.nom)}), 0) + 1, false)`)
    }
    return ecrites
  }
}

/** Fichiers de migration à rejouer pour reconstruire le schéma : NNNN_*.sql triés, sans les annulations `.down.sql`. */
export function migrationsARejouer(fichiers: string[]): string[] {
  return fichiers.filter((f) => /^\d{4}_.+\.sql$/.test(f) && !f.endsWith('.down.sql')).sort()
}

/**
 * Rôles que Supabase crée d'office ; à recréer sur un Postgres nu (PGlite) AVANT les migrations, sinon leurs
 * `grant` / `revoke` échouent. service_role a BYPASSRLS, comme sur Supabase (cf. tests/migration-pglite.test.ts).
 */
export const SQL_ROLES_SUPABASE = 'create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;'

// ---------- Chiffrement : AES-256-GCM, clé maîtresse de 32 octets (64 hex) en variable d'environnement ----------

/** Préfixe du texte chiffré : reconnaissable, versionné. Ensuite base64(sel 16 | iv 12 | tag 16 | données). */
export const PREFIXE_CHIFFRE = 'asian-home-chiffre:v1:'
const INFO_HKDF = 'asian-home-sauvegarde'

/** Clé de fichier = HKDF-SHA256(clé maîtresse, sel aléatoire) : une clé différente par sauvegarde. Jamais de clé dans un message. */
function cleDeFichier(cleHex: string, sel: Buffer): Buffer {
  if (typeof cleHex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(cleHex.trim())) {
    throw new Error('clé de chiffrement invalide : 64 caractères hexadécimaux attendus (32 octets, `openssl rand -hex 32`).')
  }
  return Buffer.from(hkdfSync('sha256', Buffer.from(cleHex.trim(), 'hex'), sel, INFO_HKDF, 32))
}

export function estChiffre(texte: string): boolean {
  return texte.startsWith(PREFIXE_CHIFFRE)
}

export function chiffrerSauvegarde(texte: string, cleHex: string): string {
  const sel = randomBytes(16)
  const iv = randomBytes(12)
  const chiffreur = createCipheriv('aes-256-gcm', cleDeFichier(cleHex, sel), iv)
  const donnees = Buffer.concat([chiffreur.update(texte, 'utf8'), chiffreur.final()])
  return PREFIXE_CHIFFRE + Buffer.concat([sel, iv, chiffreur.getAuthTag(), donnees]).toString('base64')
}

export function dechiffrerSauvegarde(chiffre: string, cleHex: string): string {
  if (!estChiffre(chiffre)) throw new Error('ce contenu n’est pas une sauvegarde chiffrée (préfixe absent).')
  const brut = Buffer.from(chiffre.slice(PREFIXE_CHIFFRE.length), 'base64')
  if (brut.length < 16 + 12 + 16) throw new Error('sauvegarde chiffrée tronquée.')
  const cle = cleDeFichier(cleHex, brut.subarray(0, 16))
  const dechiffreur = createDecipheriv('aes-256-gcm', cle, brut.subarray(16, 28))
  dechiffreur.setAuthTag(brut.subarray(28, 44))
  try {
    return Buffer.concat([dechiffreur.update(brut.subarray(44)), dechiffreur.final()]).toString('utf8')
  } catch {
    throw new Error('déchiffrement impossible : mauvaise clé ou fichier altéré.')
  }
}

// ---------- Rétention ----------

const JOUR_MS = 24 * 60 * 60 * 1000

/**
 * Noms à supprimer. Un fichier est GARDÉ s'il a au plus `garderJours` jours (limite incluse) OU s'il fait partie des
 * `garderNombre` plus récents ; supprimé seulement s'il est à la fois trop vieux et au-delà du nombre.
 */
export function purgerAnciennesSauvegardes(
  fichiers: { nom: string; dateMs: number }[],
  garderJours = 30,
  garderNombre = 30,
  maintenantMs = Date.now(),
): string[] {
  const limite = maintenantMs - garderJours * JOUR_MS
  return [...fichiers]
    .sort((a, b) => b.dateMs - a.dateMs)
    .filter((f, rang) => rang >= garderNombre && f.dateMs < limite)
    .map((f) => f.nom)
}

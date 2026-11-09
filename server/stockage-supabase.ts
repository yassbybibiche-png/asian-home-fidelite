// Stockage Supabase (Postgres via l'API REST PostgREST, client officiel `@supabase/supabase-js`).
// Même contrat que `server/stockage.ts` (SQLite) : mêmes méthodes, mêmes formes de données (`src/types.ts`,
// colonne JSONB `donnees`). Schéma, contraintes et RLS : `supabase/migrations/`.
//
// Transactions — limite honnête : PostgREST n'offre pas de transaction sur plusieurs requêtes HTTP. Ici, `transaction`
// n'est donc PAS « tout ou rien » : chaque écriture est atomique à elle seule (un INSERT ou un UPDATE d'une ligne),
// et les écritures sensibles sont protégées par la base elle-même :
// • inscription : contrainte unique (commerce_id, cle_contact) → une double inscription simultanée est rejetée
//   (ErreurConflit), le serveur relit alors le client existant ;
// • tirage : index unique (commerce_id, client_id, jour à Paris) → un 2e tirage le même jour est rejeté par la base ;
// • visite / récompense / avis : verrou optimiste. Dans une `transaction`, chaque client ou avis lu garde sa `version` ;
//   l'écriture se fait « WHERE id = ? AND version = <lue> » (la base incrémente `version` à chaque UPDATE). Si une
//   autre requête a écrit entre-temps → 0 ligne → ErreurConflit (409 « réessayez ») : aucun tampon n'est perdu ni compté
//   deux fois en silence.
// Ce qui n'est PAS garanti : une suite d'écritures interrompue au milieu (panne réseau) n'est pas annulée — ex. le PATCH
// d'un commerce peut enregistrer les réglages puis échouer sur un des avis réévalués.
import { AsyncLocalStorage } from 'node:async_hooks'
import { createClient, type PostgrestError } from '@supabase/supabase-js'
import type { Avis, Client, Commerce, EntreeJournal, MembreEquipe, Menu, Tirage } from '../src/types.ts'
import { cleContact } from '../src/lib/fidelite.ts'
import { ErreurConflit, ErreurMigrationManquante, type Pin, type Stockage } from './stockage.ts'

const TABLES_0003 = ['equipe', 'journal', 'menus']

/** Lecture d'une table de la migration 0003 : vide tant que la migration n'est pas appliquée (l'existant continue de marcher). */
async function ouVide<T>(lecture: Promise<T>, vide: T): Promise<T> {
  try {
    return await lecture
  } catch (e) {
    if (e instanceof ErreurMigrationManquante) return vide
    throw e
  }
}

export interface ConfigSupabase {
  /** https://<projet>.supabase.co */
  url: string
  /** Clé service_role (ou clé secrète `sb_secret_…`) : serveur uniquement, jamais dans le navigateur. */
  cleServiceRole: string
  /** Transport HTTP injectable (tests). */
  fetch?: typeof fetch
}

/**
 * Supabase seulement si SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont définies ; aucune des deux → undefined (SQLite).
 * Une seule des deux → erreur : mieux vaut refuser de démarrer que d'écrire en silence dans un SQLite éphémère.
 */
export function configSupabaseDepuisEnv(env: Record<string, string | undefined>): ConfigSupabase | undefined {
  const url = env.SUPABASE_URL?.trim()
  const cle = env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url && !cle) return undefined
  if (!url || !cle) throw new Error('Supabase à moitié configuré : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont nécessaires toutes les deux.')
  if (!/^https?:\/\/\S+$/.test(url)) throw new Error('SUPABASE_URL doit être une adresse web (https://<projet>.supabase.co).')
  return { url: url.replace(/\/+$/, ''), cleServiceRole: cle }
}

type Ligne = { donnees: unknown; id?: string; version?: number }
type Resultat = { data: unknown; error: PostgrestError | null }

export function ouvrirStockageSupabase(config: ConfigSupabase): Stockage {
  const sb = createClient(config.url, config.cleServiceRole, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: config.fetch ? { fetch: config.fetch } : undefined,
  })

  // Versions lues pendant la `transaction` en cours (une carte par transaction, propre à chaque requête HTTP).
  const versions = new AsyncLocalStorage<Map<string, number>>()

  /** Vérifie la réponse ; une violation d'unicité (23505) devient ErreurConflit. Jamais de clé dans les messages. */
  async function ok<T>(table: string, requete: PromiseLike<Resultat>): Promise<T> {
    const { data, error } = await requete
    if (error) {
      if (error.code === '23505') throw new ErreurConflit(`Doublon refusé par la base (${table}) : ${error.message}`)
      // Table inconnue (PostgREST : PGRST205 ; Postgres : 42P01) → migration 0003 pas encore appliquée.
      if (TABLES_0003.includes(table) && (error.code === 'PGRST205' || error.code === '42P01')) throw new ErreurMigrationManquante(table)
      throw new Error(`Supabase (${table}) : ${error.message}${error.code ? ` [${error.code}]` : ''}`)
    }
    return data as T
  }

  /** Lit des objets métier ; mémorise la version de chaque ligne si on est dans une transaction. */
  async function lire<T>(table: string, requete: PromiseLike<Resultat>): Promise<T[]> {
    const lignes = await ok<Ligne[]>(table, requete)
    const carte = versions.getStore()
    if (carte) for (const l of lignes) if (l.id && l.version != null) carte.set(`${table}:${l.id}`, l.version)
    return lignes.map((l) => l.donnees as T)
  }

  /** UPDATE de `donnees`, conditionné à la version lue dans la transaction en cours (verrou optimiste). */
  async function majVersionnee(table: 'clients' | 'avis', id: string, donnees: unknown) {
    const lue = versions.getStore()?.get(`${table}:${id}`)
    let requete = sb.from(table).update({ donnees }).eq('id', id)
    if (lue != null) requete = requete.eq('version', lue)
    const lignes = await ok<{ version: number }[]>(table, requete.select('version'))
    if (lue != null) {
      if (!lignes.length) throw new ErreurConflit(`Modifié par une autre requête entre-temps (${table} ${id}) : réessayez.`)
      versions.getStore()!.set(`${table}:${id}`, lignes[0].version)
    }
  }

  const AVEC_VERSION = 'id,version,donnees'

  return {
    type: 'supabase',

    meta: async (cle) => (await ok<{ valeur: string }[]>('meta', sb.from('meta').select('valeur').eq('cle', cle)))[0]?.valeur,
    majMeta: async (cle, valeur) => void (await ok('meta', sb.from('meta').upsert({ cle, valeur }, { onConflict: 'cle' }))),

    commerces: () => lire<Commerce>('commerces', sb.from('commerces').select('donnees').order('ordre')),
    commerce: async (id) => (await lire<Commerce>('commerces', sb.from('commerces').select('donnees').eq('id', id)))[0],
    pin: async (id) => {
      const [l] = await ok<{ pin_hash: string; pin_sel: string }[]>('commerces', sb.from('commerces').select('pin_hash,pin_sel').eq('id', id))
      return l && ({ hash: l.pin_hash, sel: l.pin_sel } satisfies Pin)
    },
    ajouterCommerce: async (c, pin) =>
      void (await ok('commerces', sb.from('commerces').insert({ id: c.id, donnees: c, pin_hash: pin.hash, pin_sel: pin.sel }))),
    majCommerce: async (c) => void (await ok('commerces', sb.from('commerces').update({ donnees: c }).eq('id', c.id))),
    majPin: async (id, pin) => void (await ok('commerces', sb.from('commerces').update({ pin_hash: pin.hash, pin_sel: pin.sel }).eq('id', id))),

    clients: (commerceId) => lire<Client>('clients', sb.from('clients').select(AVEC_VERSION).eq('commerce_id', commerceId).order('ordre')),
    client: async (commerceId, id) =>
      (await lire<Client>('clients', sb.from('clients').select(AVEC_VERSION).eq('commerce_id', commerceId).eq('id', id)))[0],
    /** Déduplication : même règle que le front (`cleContact` : 0033 / +33 / 06…, e-mail en minuscules). */
    clientParContact: async (commerceId, contact) =>
      (await lire<Client>('clients', sb.from('clients').select(AVEC_VERSION).eq('commerce_id', commerceId).eq('cle_contact', cleContact(contact))))[0],
    ajouterClient: async (c) =>
      void (await ok('clients', sb.from('clients').insert({ id: c.id, commerce_id: c.commerceId, cle_contact: cleContact(c), donnees: c }))),
    majClient: (c) => majVersionnee('clients', c.id, c),

    tirages: (commerceId) => lire<Tirage>('tirages', sb.from('tirages').select('donnees').eq('commerce_id', commerceId).order('date', { ascending: false })),
    tiragesClient: (commerceId, clientId) =>
      lire<Tirage>('tirages', sb.from('tirages').select('donnees').eq('commerce_id', commerceId).eq('client_id', clientId)),
    ajouterTirage: async (t) =>
      void (await ok('tirages', sb.from('tirages').insert({ id: t.id, commerce_id: t.commerceId, client_id: t.clientId, date: t.date, donnees: t }))),

    avis: (commerceId) => lire<Avis>('avis', sb.from('avis').select(AVEC_VERSION).eq('commerce_id', commerceId).order('date', { ascending: false })),
    unAvis: async (commerceId, id) => (await lire<Avis>('avis', sb.from('avis').select(AVEC_VERSION).eq('commerce_id', commerceId).eq('id', id)))[0],
    ajouterAvis: async (a) => void (await ok('avis', sb.from('avis').insert({ id: a.id, commerce_id: a.commerceId, date: a.date, donnees: a }))),
    majAvis: (a) => majVersionnee('avis', a.id, a),

    // ---- Cartiz (0003_cartiz.sql) ----
    membres: async (commerceId) => {
      const lignes = await ouVide(
        ok<{ donnees: MembreEquipe; code_hash: string; code_sel: string }[]>(
          'equipe',
          sb.from('equipe').select('donnees,code_hash,code_sel').eq('commerce_id', commerceId).order('ordre'),
        ),
        [],
      )
      return lignes.map((l) => ({ membre: l.donnees, code: { hash: l.code_hash, sel: l.code_sel } }))
    },
    ajouterMembre: async (m, code) =>
      void (await ok('equipe', sb.from('equipe').insert({ id: m.id, commerce_id: m.commerceId, donnees: m, code_hash: code.hash, code_sel: code.sel }))),
    majMembre: async (m, code) =>
      void (await ok(
        'equipe',
        sb
          .from('equipe')
          .update({ donnees: m, ...(code ? { code_hash: code.hash, code_sel: code.sel } : {}) })
          .eq('id', m.id)
          .eq('commerce_id', m.commerceId),
      )),
    supprimerMembre: async (commerceId, id) => void (await ok('equipe', sb.from('equipe').delete().eq('commerce_id', commerceId).eq('id', id))),
    journal: (commerceId, limite) =>
      ouVide(lire<EntreeJournal>('journal', sb.from('journal').select('donnees').eq('commerce_id', commerceId).order('date', { ascending: false }).limit(limite)), []),
    ajouterJournal: async (e) => {
      try {
        await ok('journal', sb.from('journal').insert({ id: e.id, commerce_id: e.commerceId, date: e.date, donnees: e }))
      } catch (err) {
        // Migration 0003 pas appliquée : l'action (visite, récompense…) reste enregistrée, seule la trace manque.
        if (!(err instanceof ErreurMigrationManquante)) throw err
        console.warn(`[stockage] journal non écrit (${e.action}) : ${err.message}`)
      }
    },
    menu: async (commerceId) => (await ouVide(lire<Menu>('menus', sb.from('menus').select('donnees').eq('commerce_id', commerceId)), []))[0],
    schemaCartiz: async () => {
      try {
        for (const t of TABLES_0003) await ok(t, sb.from(t).select('*').limit(0))
        return true
      } catch (e) {
        if (e instanceof ErreurMigrationManquante) return false
        throw e
      }
    },
    majMenu: async (m) => void (await ok('menus', sb.from('menus').upsert({ commerce_id: m.commerceId, donnees: m }, { onConflict: 'commerce_id' }))),

    /** PAS de « tout ou rien » (voir l'en-tête du fichier) : verrou optimiste sur les lignes lues pendant `fn`. */
    transaction: (fn) => versions.run(new Map(), async () => fn()),
    fermer: () => {},
  }
}

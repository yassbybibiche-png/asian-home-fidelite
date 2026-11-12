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
// • remise d'un gain de la roue (P0-U3) : UPDATE conditionnel « … AND donnees->remis IS NULL » → une seule remise par code ;
// • visite / récompense / avis / réglages et logo du commerce (P0-S11) : verrou optimiste. Dans une `transaction`, chaque
//   commerce, client ou avis lu garde sa `version` ; l'écriture se fait « WHERE id = ? AND version = <lue> » (la base
//   incrémente `version` à chaque UPDATE, trigger `incrementer_version` de la 0001, recréé par la 0003). Si une autre
//   requête a écrit entre-temps → 0 ligne → ErreurConflit (409 « réessayez ») : aucun tampon n'est perdu ni compté deux
//   fois, aucun réglage n'en écrase un autre en silence. Hors `transaction` (ou ligne non relue dedans) : écriture
//   inconditionnelle — d'où la relecture DANS la transaction côté routes ;
// • caisse : `actionId` idempotent (un rejeu de la file hors ligne répond `dejaTraite`, rien n'est recompté) ;
// • journal d'audit (0003) et traces du programme (0004) : jamais ignorés. Sans leur table, `ajouterJournal` /
//   `ajouterParrainage` / `ajouterDemandeRattrapage` lèvent ErreurMigrationManquante, et `creerServeur` refuse de démarrer
//   en Supabase sans ces deux migrations (P0-S11).
// Ce qui n'est PAS garanti (compensation, pas transaction) : une suite d'écritures interrompue entre deux requêtes HTTP
// (panne réseau, crash) n'est pas annulée — ex. le PATCH d'un commerce peut enregistrer les réglages puis échouer sur un
// des avis réévalués. Les routes écrivent le fait métier PUIS le journal : une interruption peut perdre une entrée de
// journal, jamais créer un journal mensonger ni compter deux fois. Une fonction RPC transactionnelle générique a été
// écartée : elle réécrirait la logique métier en PL/pgSQL (double implémentation) sans gain sur les conflits observés.
// Détails : server/README.md, « Atomicité (P0-S11) ».
import { AsyncLocalStorage } from 'node:async_hooks'
import { createClient, type PostgrestError } from '@supabase/supabase-js'
import type { Avis, Client, Commerce, CompteurEvenement, EntreeJournal, EnvoiRelance, MembreEquipe, Menu, Parrainage, Tirage } from '../src/types.ts'
import { cleContact } from '../src/lib/fidelite.ts'
import { ErreurConflit, ErreurMigrationManquante, type DemandeRattrapageTrace, type Pin, type Stockage, type TentativesAuth } from './stockage.ts'
import { lireTablePostgrest, type ClientPostgrest } from './sauvegarde.ts'

const TABLES_0003 = ['equipe', 'journal', 'menus']
const TABLES_0004 = ['parrainages', 'demandes_rattrapage']
const TABLES_0005 = ['sessions_revoquees']
const TABLES_0006 = ['tentatives_auth']
const TABLES_0007 = ['envois']
/** 0008_mesure.sql : la table et la fonction d'incrément (appelée par `rpc`, rangée sous le nom de la table). */
const TABLES_0008 = ['evenements_jour']
/** 0010_compteurs_publics.sql : la table des compteurs des limites publiques. */
const TABLES_0010 = ['compteurs_publics']
/** Lignes lues par requête (P0-S18) : PostgREST (Supabase) plafonne une réponse à 1 000 lignes par défaut — toute
 * lecture de liste passe donc par `lirePages` (boucle `.range()`), sinon listes, exports et statistiques seraient
 * silencieusement incomplets au-delà du plafond. Les lectures d'une seule ligne (`eq('id', …)`, `clientParContact`,
 * `journal` / `envois` à limite explicite) gardent `lire` (une requête). */
const PAGE = 1000

/**
 * Valeur de la COLONNE `envois.statut` (point Codex 10, sans migration) : la contrainte CHECK de 0007 n'accepte que
 * en_cours / envoye / refuse / erreur / non_branche. Les statuts venus après (`test`, `incertain`) sont rangés sous
 * `erreur` dans la colonne — hors de l'index unique anti-doublon (en_cours / envoye), comme eux — et le vrai statut
 * reste dans `donnees`, seule source relue par l'app (`envois` lit `donnees`, `relanceAutoDue` voit donc `incertain`).
 */
const STATUTS_COLONNE_0007: readonly string[] = ['en_cours', 'envoye', 'refuse', 'erreur', 'non_branche']
export const statutColonneEnvoi = (s: EnvoiRelance['statut']): string => (STATUTS_COLONNE_0007.includes(s) ? s : 'erreur')

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
      // Portée `client` refusée par la contrainte d'origine de la 0006 (23514) : migration 0009 pas encore appliquée.
      if (error.code === '23514' && table === 'tentatives_auth') throw new ErreurMigrationManquante(table, '0009_auth_client.sql')
      // Table inconnue (PostgREST : PGRST205 ; Postgres : 42P01) → migration 0003 / 0004 / 0005 pas encore appliquée.
      // Fonction inconnue (PostgREST : PGRST202 ; Postgres : 42883) → idem pour la fonction d'incrément de la 0008.
      if (error.code === 'PGRST205' || error.code === '42P01' || error.code === 'PGRST202' || error.code === '42883') {
        if (TABLES_0003.includes(table)) throw new ErreurMigrationManquante(table)
        if (TABLES_0004.includes(table)) throw new ErreurMigrationManquante(table, '0004_programme.sql')
        if (TABLES_0005.includes(table)) throw new ErreurMigrationManquante(table, '0005_sessions_revoquees.sql')
        if (TABLES_0006.includes(table)) throw new ErreurMigrationManquante(table, '0006_tentatives_auth.sql')
        if (TABLES_0007.includes(table)) throw new ErreurMigrationManquante(table, '0007_relances.sql')
        if (TABLES_0008.includes(table)) throw new ErreurMigrationManquante(table, '0008_mesure.sql')
        if (TABLES_0010.includes(table)) throw new ErreurMigrationManquante(table, '0010_compteurs_publics.sql')
      }
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

  /**
   * Lecture COMPLÈTE d'une liste, par pages de `PAGE` lignes (P0-S18) : la dernière page (< `PAGE` lignes) arrête
   * la boucle ; une liste d'exactement N × `PAGE` lignes coûte une requête vide de plus. `construire` refait une
   * requête neuve par page (mêmes filtres et même tri, seule la fenêtre `.range()` change) : le tri doit donc être
   * déterministe, sinon une ligne pourrait être lue deux fois ou jamais. Versions mémorisées comme dans `lire`.
   */
  async function lireLignesPages<T extends Ligne = Ligne>(table: string, construire: (debut: number, fin: number) => PromiseLike<Resultat>): Promise<T[]> {
    const tout: T[] = []
    for (let debut = 0; ; debut += PAGE) {
      const lignes = (await ok<Ligne[]>(table, construire(debut, debut + PAGE - 1))) as T[]
      const carte = versions.getStore()
      if (carte) for (const l of lignes) if (l.id && l.version != null) carte.set(`${table}:${l.id}`, l.version)
      tout.push(...lignes)
      if (lignes.length < PAGE) return tout
    }
  }

  /** Comme `lire`, mais sur toute la liste (toutes les pages). */
  async function lirePages<T>(table: string, construire: (debut: number, fin: number) => PromiseLike<Resultat>): Promise<T[]> {
    return (await lireLignesPages(table, construire)).map((l) => l.donnees as T)
  }

  /** UPDATE de `donnees`, conditionné à la version lue dans la transaction en cours (verrou optimiste). */
  async function majVersionnee(table: 'commerces' | 'clients' | 'avis', id: string, donnees: unknown) {
    const lue = versions.getStore()?.get(`${table}:${id}`)
    let requete = sb.from(table).update({ donnees }).eq('id', id)
    if (lue != null) requete = requete.eq('version', lue)
    const lignes = await ok<{ version: number }[]>(table, requete.select('version'))
    if (lue != null) {
      if (!lignes.length) throw new ErreurConflit(`Modifié par une autre requête entre-temps (${table} ${id}) : réessayez.`)
      versions.getStore()!.set(`${table}:${id}`, lignes[0].version)
    }
  }

  /** UPDATE de `donnees` d'un tirage seulement s'il n'est pas déjà remis (`tirages` n'a pas de colonne version). */
  async function majTirageNonRemis(t: Tirage, activeApres?: string): Promise<boolean> {
    let requete = sb.from('tirages').update({ donnees: t }).eq('id', t.id).eq('commerce_id', t.commerceId).is('donnees->remis', null)
    // Revue Codex R3 F4 : fenêtre d'activation vérifiée par la base, à l'écriture (texte ISO : ordre = ordre chronologique).
    if (activeApres !== undefined) requete = requete.gt('donnees->>activeLe', activeApres)
    return (await ok<unknown[]>('tirages', requete.select('id'))).length > 0
  }

  const AVEC_VERSION = 'id,version,donnees'

  return {
    type: 'supabase',

    meta: async (cle) => (await ok<{ valeur: string }[]>('meta', sb.from('meta').select('valeur').eq('cle', cle)))[0]?.valeur,
    majMeta: async (cle, valeur) => void (await ok('meta', sb.from('meta').upsert({ cle, valeur }, { onConflict: 'cle' }))),
    // Revue Codex (rotation du PIN) : clé absente → INSERT (la clé primaire refuse le 2e : ErreurConflit → false) ;
    // présente → UPDATE … WHERE valeur = <attendue> (0 ligne → false). Une requête, atomique pour Postgres.
    majMetaSi: async (cle, attendue, valeur) => {
      if (attendue === undefined) {
        try {
          await ok('meta', sb.from('meta').insert({ cle, valeur }))
          return true
        } catch (e) {
          if (e instanceof ErreurConflit) return false
          throw e
        }
      }
      return (await ok<unknown[]>('meta', sb.from('meta').update({ valeur }).eq('cle', cle).eq('valeur', attendue).select('cle'))).length > 0
    },
    supprimerMeta: async (cle) => void (await ok('meta', sb.from('meta').delete().eq('cle', cle))),

    commerces: () => lirePages<Commerce>('commerces', (debut, fin) => sb.from('commerces').select(AVEC_VERSION).order('ordre').range(debut, fin)),
    commerce: async (id) => (await lire<Commerce>('commerces', sb.from('commerces').select(AVEC_VERSION).eq('id', id)))[0],
    pin: async (id) => {
      const [l] = await ok<{ pin_hash: string; pin_sel: string }[]>('commerces', sb.from('commerces').select('pin_hash,pin_sel').eq('id', id))
      return l && ({ hash: l.pin_hash, sel: l.pin_sel } satisfies Pin)
    },
    ajouterCommerce: async (c, pin) =>
      void (await ok('commerces', sb.from('commerces').insert({ id: c.id, donnees: c, pin_hash: pin.hash, pin_sel: pin.sel }))),
    // Verrou optimiste (P0-S11) dans une `transaction` qui a relu le commerce ; hors transaction : écriture inconditionnelle.
    majCommerce: (c) => majVersionnee('commerces', c.id, c),
    majPin: async (id, pin) => void (await ok('commerces', sb.from('commerces').update({ pin_hash: pin.hash, pin_sel: pin.sel }).eq('id', id))),
    // UPDATE … WHERE pin_hash = <attendu> AND pin_sel = <attendu> : Postgres verrouille la ligne et réévalue la condition.
    majPinSi: async (id, attendu, pin) =>
      (
        await ok<unknown[]>(
          'commerces',
          sb.from('commerces').update({ pin_hash: pin.hash, pin_sel: pin.sel }).eq('id', id).eq('pin_hash', attendu.hash).eq('pin_sel', attendu.sel).select('id'),
        )
      ).length > 0,

    clients: (commerceId) =>
      lirePages<Client>('clients', (debut, fin) => sb.from('clients').select(AVEC_VERSION).eq('commerce_id', commerceId).order('ordre').range(debut, fin)),
    client: async (commerceId, id) =>
      (await lire<Client>('clients', sb.from('clients').select(AVEC_VERSION).eq('commerce_id', commerceId).eq('id', id)))[0],
    /** Déduplication : même règle que le front (`cleContact` : 0033 / +33 / 06…, e-mail en minuscules). */
    clientParContact: async (commerceId, contact) =>
      (await lire<Client>('clients', sb.from('clients').select(AVEC_VERSION).eq('commerce_id', commerceId).eq('cle_contact', cleContact(contact))))[0],
    // Point Codex 8 : filtre poussé à PostgREST (seules les lignes candidates voyagent), même tri que `clients`. Les
    // valeurs sont entre guillemets (la saisie peut contenir « ( ) . ») ; ni « * » ni « % » ni « _ » n'y passent
    // (`chiffresRecherche` n'accepte que chiffres, espaces, + . - ( ) /).
    clientsCandidatsNumero: (commerceId, chiffres, texte) => {
      const filtre = [
        `cle_contact.like."*${chiffres}*"`,
        `cle_contact.like."*${texte}*"`,
        'donnees->>prenom.match."[0-9]"',
        'and(donnees->>telephone.not.is.null,donnees->>email.not.is.null)',
      ].join(',')
      return lirePages<Client>('clients', (debut, fin) =>
        sb.from('clients').select(AVEC_VERSION).eq('commerce_id', commerceId).or(filtre).order('ordre').range(debut, fin),
      )
    },
    ajouterClient: async (c) =>
      void (await ok('clients', sb.from('clients').insert({ id: c.id, commerce_id: c.commerceId, cle_contact: cleContact(c), donnees: c }))),
    majClient: (c) => majVersionnee('clients', c.id, c),

    tirages: (commerceId) =>
      lirePages<Tirage>('tirages', (debut, fin) => sb.from('tirages').select('donnees').eq('commerce_id', commerceId).order('date', { ascending: false }).order('id').range(debut, fin)),
    tiragesClient: (commerceId, clientId) =>
      // Tri explicite (date croissante) : sans lui, l'ordre des pages ne serait pas stable d'une requête à l'autre.
      // Même ordre que l'ancienne lecture sans tri (insertion = dates croissantes dans les tests et en pratique).
      // Départage par `id` (P0-S18, revue Codex point 1) : sans lui, deux lignes de même date à cheval sur une
      // frontière de page pourraient être ordonnées différemment d'une requête à l'autre et lues deux fois ou jamais.
      lirePages<Tirage>('tirages', (debut, fin) =>
        sb.from('tirages').select('donnees').eq('commerce_id', commerceId).eq('client_id', clientId).order('date', { ascending: true }).order('id').range(debut, fin),
      ),
    tiragesDepuis: (commerceId, depuis) =>
      lirePages<Tirage>('tirages', (debut, fin) =>
        sb.from('tirages').select('donnees').eq('commerce_id', commerceId).gte('date', depuis).order('date', { ascending: false }).order('id').range(debut, fin),
      ),
    ajouterTirage: async (t) =>
      void (await ok('tirages', sb.from('tirages').insert({ id: t.id, commerce_id: t.commerceId, client_id: t.clientId, date: t.date, donnees: t }))),
    supprimerTirage: async (commerceId, id) => void (await ok('tirages', sb.from('tirages').delete().eq('commerce_id', commerceId).eq('id', id))),
    tiragesSansLot: (commerceId) =>
      lirePages<Tirage>('tirages', (debut, fin) =>
        sb.from('tirages').select('donnees').eq('commerce_id', commerceId).is('donnees->lotId', null).order('date', { ascending: false }).order('id').range(debut, fin),
      ),
    // Même procédé que la remise (P0-U3) : UPDATE conditionnel sur le JSONB, sans colonne `version`. Un tirage déjà
    // remis garde sa remise (`t` la porte, elle ne change plus) ; non remis : la condition empêche d'écraser une remise
    // arrivée entre la lecture et l'écriture.
    completerLotTirage: async (t) => {
      let requete = sb.from('tirages').update({ donnees: t }).eq('id', t.id).eq('commerce_id', t.commerceId).is('donnees->lotId', null)
      if (!t.remis) requete = requete.is('donnees->remis', null)
      return (await ok<unknown[]>('tirages', requete.select('id'))).length > 0
    },
    // Code gagnant et remise (P0-U3) : dans le JSONB `donnees`, sans migration. La table `tirages` n'a pas de colonne
    // `version` : la garde est la condition « donnees->remis IS NULL » de l'UPDATE lui-même. Postgres verrouille la ligne,
    // et une 2e requête simultanée réévalue la condition après la 1re → 0 ligne → false (jamais deux remises).
    tiragesParCode: (commerceId, code) =>
      lirePages<Tirage>('tirages', (debut, fin) =>
        sb.from('tirages').select('donnees').eq('commerce_id', commerceId).eq('donnees->>code', code).order('date', { ascending: false }).order('id').range(debut, fin),
      ),
    marquerTirageRemis: (t, activeApres) => majTirageNonRemis(t, activeApres),
    activerTirage: (t) => majTirageNonRemis(t),

    avis: (commerceId) =>
      lirePages<Avis>('avis', (debut, fin) => sb.from('avis').select(AVEC_VERSION).eq('commerce_id', commerceId).order('date', { ascending: false }).order('id').range(debut, fin)),
    unAvis: async (commerceId, id) => (await lire<Avis>('avis', sb.from('avis').select(AVEC_VERSION).eq('commerce_id', commerceId).eq('id', id)))[0],
    ajouterAvis: async (a) => void (await ok('avis', sb.from('avis').insert({ id: a.id, commerce_id: a.commerceId, date: a.date, donnees: a }))),
    majAvis: (a) => majVersionnee('avis', a.id, a),

    // ---- Cartiz (0003_cartiz.sql) ----
    membres: async (commerceId) => {
      const lignes = await ouVide(
        lireLignesPages<{ donnees: MembreEquipe; code_hash: string; code_sel: string }>(
          'equipe',
          (debut, fin) => sb.from('equipe').select('donnees,code_hash,code_sel').eq('commerce_id', commerceId).order('ordre').range(debut, fin),
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
    majCodeMembreSi: async (commerceId, id, attendu, code) =>
      (
        await ok<unknown[]>(
          'equipe',
          sb
            .from('equipe')
            .update({ code_hash: code.hash, code_sel: code.sel })
            .eq('id', id)
            .eq('commerce_id', commerceId)
            .eq('code_hash', attendu.hash)
            .eq('code_sel', attendu.sel)
            .select('id'),
        )
      ).length > 0,
    supprimerMembre: async (commerceId, id) => void (await ok('equipe', sb.from('equipe').delete().eq('commerce_id', commerceId).eq('id', id))),
    journal: (commerceId, limite) =>
      ouVide(lire<EntreeJournal>('journal', sb.from('journal').select('donnees').eq('commerce_id', commerceId).order('date', { ascending: false }).limit(limite)), []),
    // Jamais avalé (P0-S11) : sans la 0003, ErreurMigrationManquante remonte. Le serveur refuse d'ailleurs de démarrer
    // en Supabase sans elle (`creerServeur`), une trace d'audit ne peut donc plus manquer en silence.
    ajouterJournal: async (e) => void (await ok('journal', sb.from('journal').insert({ id: e.id, commerce_id: e.commerceId, date: e.date, donnees: e }))),
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

    // ---- Programme (0004_programme.sql) : traces d'audit. Sans la migration : ErreurMigrationManquante (P0-S11) ----
    ajouterParrainage: async (p: Parrainage) =>
      void (await ok('parrainages', sb.from('parrainages').insert({ id: p.id, commerce_id: p.commerceId, parrain_id: p.parrainId, filleul_id: p.filleulId, date: p.date, donnees: p }))),
    parrainageDuFilleul: async (commerceId, filleulId) =>
      (await lire<Parrainage>('parrainages', sb.from('parrainages').select('donnees').eq('commerce_id', commerceId).eq('filleul_id', filleulId).limit(1)))[0],
    ajouterDemandeRattrapage: async (d: DemandeRattrapageTrace) =>
      void (await ok('demandes_rattrapage', sb.from('demandes_rattrapage').insert({ id: d.id, commerce_id: d.commerceId, client_id: d.clientId, date: d.date, donnees: d }))),
    schemaProgramme: async () => {
      try {
        for (const t of TABLES_0004) await ok(t, sb.from(t).select('*').limit(0))
        return true
      } catch (e) {
        if (e instanceof ErreurMigrationManquante) return false
        throw e
      }
    },

    // ---- Sessions (0005_sessions_revoquees.sql) : tant que la migration manque, le serveur révoque en mémoire ----
    revoquerSession: async (jti, expireLe, maintenant) => {
      try {
        await ok('sessions_revoquees', sb.from('sessions_revoquees').delete().lt('expire_le', maintenant))
      } catch (err) {
        if (err instanceof ErreurMigrationManquante) throw err
        console.warn(`[stockage] nettoyage des sessions révoquées reporté : ${err instanceof Error ? err.message : err}`)
      }
      await ok('sessions_revoquees', sb.from('sessions_revoquees').upsert({ jti, expire_le: expireLe }, { onConflict: 'jti', ignoreDuplicates: true }))
    },
    sessionRevoquee: async (jti) =>
      (await ouVide(ok<unknown[]>('sessions_revoquees', sb.from('sessions_revoquees').select('jti').eq('jti', jti)), [])).length > 0,

    // ---- Anti-bruteforce (0006_tentatives_auth.sql) : tant que la migration manque, le serveur compte en mémoire ----
    tentativesAuth: async (cle) => {
      const [l] = await ok<{ cle: string; portee: TentativesAuth['portee']; echecs: number; bloque_jusqu_a: string | null; derniere_tentative: string }[]>(
        'tentatives_auth',
        sb.from('tentatives_auth').select('cle,portee,echecs,bloque_jusqu_a,derniere_tentative').eq('cle', cle),
      )
      return l && { cle: l.cle, portee: l.portee, echecs: l.echecs, bloqueJusqua: l.bloque_jusqu_a, derniereTentative: l.derniere_tentative }
    },
    enregistrerTentativesAuth: async (t, purgerAvant) => {
      try {
        // Lignes inactives depuis `purgerAvant` (dernière tentative ET fin de blocage) : plus utiles, supprimées.
        await ok('tentatives_auth', sb.from('tentatives_auth').delete().lt('derniere_tentative', purgerAvant).is('bloque_jusqu_a', null))
        await ok('tentatives_auth', sb.from('tentatives_auth').delete().lt('derniere_tentative', purgerAvant).lt('bloque_jusqu_a', purgerAvant))
      } catch (err) {
        if (err instanceof ErreurMigrationManquante) throw err
        console.warn(`[stockage] nettoyage des tentatives d’accès reporté : ${err instanceof Error ? err.message : err}`)
      }
      await ok(
        'tentatives_auth',
        sb.from('tentatives_auth').upsert(
          { cle: t.cle, portee: t.portee, echecs: t.echecs, bloque_jusqu_a: t.bloqueJusqua, derniere_tentative: t.derniereTentative },
          { onConflict: 'cle' },
        ),
      )
    },
    effacerTentativesAuth: async (cle) => void (await ok('tentatives_auth', sb.from('tentatives_auth').delete().eq('cle', cle))),
    // ---- Accès client (0009_auth_client.sql) : marqueur `auth_client_active()` (lecture seule, aucune ligne écrite) ----
    schemaAuthClient: async () => {
      const { error } = await sb.rpc('auth_client_active')
      if (!error) return true
      if (error.code === 'PGRST202' || error.code === '42883') return false
      throw new Error(`Supabase (auth_client_active) : ${error.message}${error.code ? ` [${error.code}]` : ''}`)
    },

    // ---- Compteurs publics (0010_compteurs_publics.sql) : tant que la migration manque, le serveur compte en mémoire ----
    // Lecture paginée (`lireLignesPages`, P0-S18) : PostgREST plafonne une réponse à 1 000 lignes — sans pagination,
    // des compteurs chauds ou bloqués ne seraient pas restaurés au-delà du plafond (revue Codex point 3).
    compteursPublics: async () => {
      const lignes = await ouVide(
        lireLignesPages('compteurs_publics', (debut, fin) => sb.from('compteurs_publics').select('cle,debut,n').order('cle').range(debut, fin)),
        [],
      )
      return (lignes as unknown as { cle: string; debut: string; n: number }[]).map((l) => ({ cle: l.cle, debut: l.debut, n: Number(l.n) }))
    },
    enregistrerCompteurPublic: async (c, purgerAvant) => {
      try {
        // Fenêtres passées : plus utiles, supprimées au passage.
        await ok('compteurs_publics', sb.from('compteurs_publics').delete().lt('debut', purgerAvant))
      } catch (err) {
        if (err instanceof ErreurMigrationManquante) throw err
        console.warn(`[stockage] nettoyage des compteurs publics reporté : ${err instanceof Error ? err.message : err}`)
      }
      await ok(
        'compteurs_publics',
        sb.from('compteurs_publics').upsert({ cle: c.cle, debut: c.debut, n: c.n }, { onConflict: 'cle' }),
      )
    },
    purgerCompteursPublics: async (avant) => {
      try {
        await ok('compteurs_publics', sb.from('compteurs_publics').delete().lt('debut', avant))
      } catch (err) {
        if (err instanceof ErreurMigrationManquante) return // table absente : rien à purger
        throw err
      }
    },
    schemaCompteursPublics: async () => {
      try {
        await ok('compteurs_publics', sb.from('compteurs_publics').select('*').limit(0))
        return true
      } catch (e) {
        if (e instanceof ErreurMigrationManquante) return false
        throw e
      }
    },

    // ---- Relances (0007_relances.sql) : tant que la migration manque, le journal se lit vide et aucun envoi ne part ----
    ajouterEnvoi: async (e) =>
      void (await ok(
        'envois',
        sb.from('envois').insert({ id: e.id, commerce_id: e.commerceId, client_id: e.clientId, modele: e.modele, canal: e.canal, statut: statutColonneEnvoi(e.statut), jour: e.jour, date: e.date, donnees: e }),
      )),
    majEnvoi: async (e) => void (await ok('envois', sb.from('envois').update({ statut: statutColonneEnvoi(e.statut), donnees: e }).eq('id', e.id).eq('commerce_id', e.commerceId))),
    envois: (commerceId, limite, clientId) => {
      let requete = sb.from('envois').select('donnees').eq('commerce_id', commerceId)
      if (clientId) requete = requete.eq('client_id', clientId)
      return ouVide(lire<EnvoiRelance>('envois', requete.order('date', { ascending: false }).limit(limite)), [])
    },
    schemaRelances: async () => {
      try {
        await ok('envois', sb.from('envois').select('*').limit(0))
        return true
      } catch (e) {
        if (e instanceof ErreurMigrationManquante) return false
        throw e
      }
    },

    // ---- Mesure anonyme (0008_mesure.sql) : tant que la migration manque, rien n'est compté et tout se lit vide ----
    // L'incrément passe par une fonction SQL (`insert … on conflict do update set n = n + 1`) : atomique pour la base,
    // deux événements simultanés ne s'écrasent jamais (un upsert PostgREST écrirait une valeur lue avant, et perdrait +1).
    compterEvenement: async (commerceId, jour, type) =>
      void (await ok('evenements_jour', sb.rpc('incrementer_evenement', { p_commerce_id: commerceId, p_jour: jour, p_type: type }))),
    compteursEvenements: async (commerceId, depuis) => {
      const tout: CompteurEvenement[] = []
      for (let debut = 0; ; debut += PAGE) {
        const requete = sb
          .from('evenements_jour')
          .select('jour,type,n')
          .eq('commerce_id', commerceId)
          .gte('jour', depuis)
          .order('jour', { ascending: true })
          .order('type', { ascending: true })
          .range(debut, debut + PAGE - 1)
        const lignes = await ouVide(ok<CompteurEvenement[]>('evenements_jour', requete), [])
        tout.push(...lignes.map((l) => ({ jour: String(l.jour).slice(0, 10), type: l.type, n: Number(l.n) })))
        if (lignes.length < PAGE) return tout
      }
    },
    schemaMesure: async () => {
      try {
        await ok('evenements_jour', sb.from('evenements_jour').select('*').limit(0))
        return true
      } catch (e) {
        if (e instanceof ErreurMigrationManquante) return false
        throw e
      }
    },

    // ---- RGPD (P1-B6) : suppression d'un client et de sa cascade ----
    // Pas de transaction (voir l'en-tête) : les dépendances partent d'abord, la ligne du client en dernier ; une
    // suppression interrompue laisse le client en place et se rejoue en entier. Table absente (migration pas
    // appliquée) : rien à supprimer, 0. Le journal n'a pas de colonne client : filtre sur `donnees->>clientId`.
    supprimerClient: async (commerceId, clientId) => {
      const suppr = async (table: string, colonne: string) => {
        const lignes = await ouVide(ok<unknown[] | null>(table, sb.from(table).delete().eq('commerce_id', commerceId).eq(colonne, clientId).select('id')), [])
        return lignes?.length ?? 0
      }
      const tirages = await suppr('tirages', 'client_id')
      const journal = await suppr('journal', 'donnees->>clientId')
      const parrainages = (await suppr('parrainages', 'parrain_id')) + (await suppr('parrainages', 'filleul_id'))
      const rattrapages = await suppr('demandes_rattrapage', 'client_id')
      const envois = await suppr('envois', 'client_id')
      const client = (await suppr('clients', 'id')) > 0
      return { client, tirages, journal, parrainages, rattrapages, envois }
    },

    // Sauvegarde admin : exactement la lecture du CLI (pages de 1 000 + compteur exact, table absente = erreur).
    lireTableSauvegarde: lireTablePostgrest(sb as unknown as ClientPostgrest),

    /** PAS de « tout ou rien » (voir l'en-tête du fichier) : verrou optimiste sur les lignes lues pendant `fn`. */
    transaction: (fn) => versions.run(new Map(), async () => fn()),
    fermer: () => {},
  }
}

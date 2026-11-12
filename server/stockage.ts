// Stockage SQLite (module intégré `node:sqlite`, aucune dépendance npm).
// Chaque objet métier est rangé tel quel en JSON (colonne `donnees`) : la forme des données reste
// celle de `src/types.ts`, partagée avec le front. Les colonnes à côté servent aux recherches.
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Avis, Client, Commerce, CompteurEvenement, DemandeRattrapage, EntreeJournal, EnvoiRelance, MembreEquipe, Menu, Parrainage, Tirage, TypeEvenement } from '../src/types.ts'
import { cleContact } from '../src/lib/fidelite.ts'
import { TABLES_SAUVEGARDE } from './sauvegarde.ts'

export interface Pin {
  hash: string
  sel: string
}

export interface MembreStocke {
  membre: MembreEquipe
  code: Pin
}

/** Trace d'audit d'une demande de rattrapage (migration 0004) : l'état de référence reste dans `clients.donnees`. */
export interface DemandeRattrapageTrace extends DemandeRattrapage {
  commerceId: string
  clientId: string
}

/**
 * Secret visé par le dernier échec enregistré sur un compteur (P0-S2) : PIN admin, PIN commerce ou code équipe ;
 * `client` (P0-S7, migration 0009) : preuve d'accès à une carte de fidélité (jeton client, lien d'accès).
 */
export type PorteeAuth = 'admin' | 'commerce' | 'equipe' | 'client'

/**
 * Compteur d'échecs d'authentification (migration 0006 : `tentatives_auth`). `cle` = `ip:<ip>` (tous secrets
 * confondus) ou `cible:<commerceId>` / `cible:admin` (toutes IP confondues) ; jamais de PIN, de code ni de contact.
 * Dates ISO UTC.
 */
export interface TentativesAuth {
  cle: string
  portee: PorteeAuth
  echecs: number
  bloqueJusqua: string | null
  derniereTentative: string
}

/**
 * Compteur d'une limite publique (migration 0010 : `compteurs_publics`). `cle` = clé du compteur en mémoire
 * (`lecture:<ip>`, `carte:<id>`, `inscription:<commerce>:<contact>`…) ; `debut` = début ISO de sa fenêtre d'une
 * minute ; `n` = requêtes dans cette fenêtre. Aucune donnée client : la clé, un horodatage, un nombre.
 */
export interface CompteurPublic {
  cle: string
  debut: string
  n: number
}

type P<T> = T | Promise<T>

/**
 * Bilan d'une suppression de client (P1-B6, RGPD) : nombre de lignes supprimées dans chaque table. `client` = la ligne
 * du client elle-même (avec tout ce qu'elle contient : messages, demandes de rattrapage, échanges, consentement…).
 */
export interface BilanSuppression {
  client: boolean
  tirages: number
  journal: number
  parrainages: number
  rattrapages: number
  envois: number
}

/**
 * Contrat commun aux deux stockages : SQLite (ici, synchrone) et Supabase (`stockage-supabase.ts`, asynchrone).
 * Le serveur attend (`await`) chaque appel, ce qui marche pour les deux ; les noms et les formes de données sont identiques.
 */
export interface Stockage {
  readonly type: 'sqlite' | 'supabase'
  meta(cle: string): P<string | undefined>
  majMeta(cle: string, valeur: string): P<void>
  /**
   * Écriture conditionnelle (revue Codex, rotation du PIN) : écrit `valeur` seulement si la valeur actuelle est encore
   * `attendue` (undefined = clé absente). Une seule requête, atomique pour la base ; false = changée entre-temps.
   */
  majMetaSi(cle: string, attendue: string | undefined, valeur: string): P<boolean>
  /** Supprime une clé de `meta` (P0-S7 : version d'accès d'une carte supprimée) ; absente : rien. */
  supprimerMeta(cle: string): P<void>
  commerces(): P<Commerce[]>
  commerce(id: string): P<Commerce | undefined>
  pin(id: string): P<Pin | undefined>
  ajouterCommerce(c: Commerce, pin: Pin): P<void>
  /**
   * Supabase (P0-S11) : dans une `transaction` qui a relu ce commerce, écriture conditionnée à la version lue
   * (ErreurConflit si une autre requête l'a modifié entre-temps) ; sinon inconditionnelle. SQLite : transactions réelles
   * et sérialisées (voir `transaction` plus bas), aucune autre écriture ne s'intercale — rien à vérifier.
   */
  majCommerce(c: Commerce): P<void>
  majPin(id: string, pin: Pin): P<void>
  /**
   * Remplace le PIN seulement si le hash et le sel stockés sont encore `attendu` (revue Codex : rotation, re-hachage).
   * Une seule requête, atomique pour la base ; false = PIN changé entre-temps (ou commerce absent), rien n'est écrit.
   */
  majPinSi(id: string, attendu: Pin, pin: Pin): P<boolean>
  clients(commerceId: string): P<Client[]>
  client(commerceId: string, id: string): P<Client | undefined>
  clientParContact(commerceId: string, contact: { telephone?: string; email?: string }): P<Client | undefined>
  /**
   * Recherche caisse par numéro (point Codex 8) : filtrée en base sur `cle_contact`, sans lire tous les clients.
   * Renvoie, dans l'ordre de `clients()`, un SUR-ENSEMBLE des clients que `correspondRecherche(c, saisie)` accepte
   * quand `chiffresRecherche(saisie) === chiffres` (`texte` = saisie sans espaces autour, en minuscules) : clé qui
   * contient `chiffres` (téléphone) ou `texte` (e-mail : la clé d'un client e-mail est son e-mail en minuscules),
   * prénom contenant un chiffre, et client ayant à la fois téléphone et e-mail (sa clé est l'e-mail : son numéro
   * n'est pas dans la colonne). L'appelant refiltre avec `correspondRecherche` : résultats, ordre et total identiques.
   */
  clientsCandidatsNumero(commerceId: string, chiffres: string, texte: string): P<Client[]>
  ajouterClient(c: Client): P<void>
  majClient(c: Client): P<void>
  tirages(commerceId: string): P<Tirage[]>
  tiragesClient(commerceId: string, clientId: string): P<Tirage[]>
  /** Tirages du commerce datés de `depuis` (ISO, inclus) ou après, du plus récent au plus ancien (R2 : plafonds du jour). */
  tiragesDepuis(commerceId: string, depuis: string): P<Tirage[]>
  ajouterTirage(t: Tirage): P<void>
  /** Tirages d'un commerce portant ce code gagnant (déjà normalisé), du plus récent au plus ancien. */
  tiragesParCode(commerceId: string, code: string): P<Tirage[]>
  /**
   * Remise d'un gain (P0-U3) : écrit `t` (avec `remis`) seulement si le tirage en base n'est PAS déjà remis — une seule
   * requête conditionnelle, atomique pour la base (UPDATE … WHERE remis IS NULL). false = déjà remis, y compris par une
   * requête simultanée : un code ne peut jamais être remis deux fois.
   */
  marquerTirageRemis(t: Tirage): P<boolean>
  avis(commerceId: string): P<Avis[]>
  unAvis(commerceId: string, id: string): P<Avis | undefined>
  ajouterAvis(a: Avis): P<void>
  majAvis(a: Avis): P<void>
  /** Équipe : le code (haché + salé) est rangé à part, jamais dans `donnees`. */
  membres(commerceId: string): P<MembreStocke[]>
  ajouterMembre(m: MembreEquipe, code: Pin): P<void>
  majMembre(m: MembreEquipe, code?: Pin): P<void>
  /** Comme `majPinSi`, pour le code d'un membre (re-hachage) : `donnees` n'est pas touché. false = code changé entre-temps. */
  majCodeMembreSi(commerceId: string, id: string, attendu: Pin, code: Pin): P<boolean>
  supprimerMembre(commerceId: string, id: string): P<void>
  /** Journal d'audit, du plus récent au plus ancien. */
  journal(commerceId: string, limite: number): P<EntreeJournal[]>
  /**
   * Jamais ignoré en silence (P0-S11) : Supabase sans la table (0003) lève ErreurMigrationManquante — le serveur refuse
   * d'ailleurs de démarrer en Supabase sans la 0003. Les routes l'appellent APRÈS l'écriture métier.
   */
  ajouterJournal(e: EntreeJournal): P<void>
  menu(commerceId: string): P<Menu | undefined>
  majMenu(m: Menu): P<void>
  /** Tables de la migration 0003 présentes (toujours vrai sous SQLite, le schéma est créé au démarrage). */
  schemaCartiz(): P<boolean>
  /**
   * Traces d'audit du programme (migration 0004 : parrainages, demandes de rattrapage). Jamais ignorées (P0-S11) :
   * Supabase sans les tables lève ErreurMigrationManquante ; le serveur refuse de démarrer en Supabase sans la 0004.
   */
  ajouterParrainage(p: Parrainage): P<void>
  /** Trace de parrainage de ce filleul, s'il y en a une (point Codex 2 : trace présente = règlement terminé). */
  parrainageDuFilleul(commerceId: string, filleulId: string): P<Parrainage | undefined>
  ajouterDemandeRattrapage(d: DemandeRattrapageTrace): P<void>
  /** Tables de la migration 0004 présentes (toujours vrai sous SQLite). */
  schemaProgramme(): P<boolean>
  /**
   * Révocation d'un jeton de session (migration 0005 : `sessions_revoquees`). `expireLe` = fin de validité du jeton ;
   * les révocations déjà expirées avant `maintenant` sont supprimées au passage (nettoyage opportuniste).
   * Supabase sans la table : lève ErreurMigrationManquante (le serveur garde alors la révocation en mémoire).
   */
  revoquerSession(jti: string, expireLe: string, maintenant: string): P<void>
  /** Jeton révoqué ? Supabase sans la table : false (le serveur consulte d'abord sa mémoire). */
  sessionRevoquee(jti: string): P<boolean>
  /**
   * Anti-bruteforce persistant (migration 0006 : `tentatives_auth`) : la base fait foi après un redémarrage.
   * `enregistrerTentativesAuth` écrit la ligne entière (upsert sur `cle`) et supprime au passage les lignes dont la
   * dernière tentative et le blocage sont antérieurs à `purgerAvant`.
   * Supabase sans la table : lève ErreurMigrationManquante (le serveur se replie alors sur sa mémoire).
   */
  tentativesAuth(cle: string): P<TentativesAuth | undefined>
  enregistrerTentativesAuth(t: TentativesAuth, purgerAvant: string): P<void>
  effacerTentativesAuth(cle: string): P<void>
  /**
   * Migration 0009 (P0-S7) appliquée : `tentatives_auth` accepte la portée `client`. Toujours vrai sous SQLite.
   * Supabase sans elle : les échecs d'accès client sont comptés en mémoire seulement (comme sans la 0006).
   */
  schemaAuthClient(): P<boolean>
  /**
   * Compteurs des limites publiques (migration 0010 : `compteurs_publics`) : toutes les lignes, fenêtres passées
   * comprises (le serveur ne garde que celles de la minute en cours). `enregistrerCompteurPublic` écrit la ligne
   * entière (upsert sur `cle`) et supprime au passage les lignes dont la fenêtre est antérieure à `purgerAvant`.
   * Supabase sans la table : lève ErreurMigrationManquante (le serveur se replie alors sur sa mémoire).
   */
  compteursPublics(): P<CompteurPublic[]>
  enregistrerCompteurPublic(c: CompteurPublic, purgerAvant: string): P<void>
  /** Supprime les lignes dont la fenêtre est antérieure à `avant` (purge au démarrage et à chaque écriture). */
  purgerCompteursPublics(avant: string): P<void>
  /** Table de la migration 0010 présente (toujours vrai sous SQLite). */
  schemaCompteursPublics(): P<boolean>
  /**
   * Journal des envois de relances (migration 0007 : `envois`). Index unique (commerce, client, modèle, jour) sur les
   * lignes `en_cours` / `envoye` : une 2e réservation de la même relance le même jour lève ErreurConflit.
   * Supabase sans la table : `ajouterEnvoi` / `majEnvoi` lèvent ErreurMigrationManquante, `envois` renvoie [].
   */
  ajouterEnvoi(e: EnvoiRelance): P<void>
  majEnvoi(e: EnvoiRelance): P<void>
  /** Du plus récent au plus ancien ; `clientId` : ceux de ce client seulement. */
  envois(commerceId: string, limite: number, clientId?: string): P<EnvoiRelance[]>
  /** Table de la migration 0007 présente (toujours vrai sous SQLite). */
  schemaRelances(): P<boolean>
  /**
   * Mesure anonyme (P2-Q3, migration 0008 : `evenements_jour`) : +1 sur le compteur (commerce, jour à Paris, type),
   * atomique pour la base. Aucune identité : ni client, ni contact, ni IP.
   * Supabase sans la migration : lève ErreurMigrationManquante (le serveur ignore alors l'événement).
   */
  compterEvenement(commerceId: string, jour: string, type: TypeEvenement): P<void>
  /** Compteurs du commerce depuis `depuis` (AAAA-MM-JJ, inclus), par jour croissant. Supabase sans la migration : []. */
  compteursEvenements(commerceId: string, depuis: string): P<CompteurEvenement[]>
  /** Table de la migration 0008 présente (toujours vrai sous SQLite). */
  schemaMesure(): P<boolean>
  /**
   * Suppression d'un client (P1-B6, RGPD) avec sa cascade : ses tirages, ses entrées de journal (`clientId`), les
   * parrainages où il est parrain OU filleul, ses demandes de rattrapage, ses envois de relances, puis sa ligne.
   * Dépendances d'abord, client en dernier : une suppression interrompue (Supabase, sans transaction) se rejoue.
   * Tables d'une migration absente (Supabase) : rien à supprimer, comptées 0.
   */
  supprimerClient(commerceId: string, clientId: string): P<BilanSuppression>
  /**
   * Sauvegarde téléchargeable par l'admin (`GET /admin/sauvegarde`) : toutes les lignes, toutes les colonnes d'une des
   * 15 tables de `TABLES_SAUVEGARDE`, sous la forme des lignes Postgres (`donnees` en objet). Supabase : même lecture
   * que le CLI (`lireTablePostgrest` : pages + compteur exact) ; table absente → erreur (export refusé, jamais partiel).
   * SQLite (développement) : pas de colonnes `ordre` / `version` — la restauration Postgres les recrée (ordre
   * d'insertion conservé : lignes lues dans l'ordre `rowid`).
   */
  lireTableSauvegarde(table: string): Promise<Record<string, unknown>[]>
  /** Pas d'imbrication. SQLite : vraie transaction. Supabase : voir `stockage-supabase.ts` (pas de transaction multi-requêtes). */
  transaction<T>(fn: () => P<T>): Promise<T>
  fermer(): P<void>
}

/**
 * Écriture refusée par une contrainte d'unicité de la base (client déjà inscrit avec ce contact, 2e tirage du jour…)
 * ou, sous Supabase, ligne modifiée par une autre requête entre la lecture et l'écriture. Le serveur répond 409.
 */
export class ErreurConflit extends Error {}

/**
 * Table d'une migration (0003 equipe / journal / menus par défaut, ou la migration nommée) absente de la base Supabase :
 * migration pas encore appliquée. Les lectures renvoient du vide ; les écritures lèvent cette erreur → 503 explicite.
 * Depuis P0-S11, le journal (0003) et les traces du programme (0004) ne sont plus ignorés : le serveur refuse de
 * démarrer en Supabase sans ces deux migrations.
 */
export class ErreurMigrationManquante extends Error {
  constructor(table: string, migration = '0003_cartiz.sql') {
    super(`Fonction pas encore activée : la table « ${table} » n’existe pas. Appliquez la migration supabase/migrations/${migration} dans le SQL Editor de Supabase.`)
  }
}

/** Insertion SQLite : une violation d'unicité devient une `ErreurConflit`, comme sous Supabase. */
function inserer(requete: StatementSync, ...args: SQLInputValue[]) {
  try {
    requete.run(...args)
  } catch (e) {
    if (e instanceof Error && /UNIQUE constraint failed/.test(e.message)) throw new ErreurConflit(e.message)
    throw e
  }
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS commerces (
    id TEXT PRIMARY KEY, donnees TEXT NOT NULL, pin_hash TEXT NOT NULL, pin_sel TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY, commerce_id TEXT NOT NULL, cle_contact TEXT NOT NULL, donnees TEXT NOT NULL,
    UNIQUE (commerce_id, cle_contact)
  );
  CREATE TABLE IF NOT EXISTS tirages (
    id TEXT PRIMARY KEY, commerce_id TEXT NOT NULL, client_id TEXT NOT NULL, date TEXT NOT NULL, donnees TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS tirages_client ON tirages (commerce_id, client_id);
  CREATE TABLE IF NOT EXISTS avis (
    id TEXT PRIMARY KEY, commerce_id TEXT NOT NULL, date TEXT NOT NULL, donnees TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS avis_commerce ON avis (commerce_id);
  CREATE TABLE IF NOT EXISTS equipe (
    id TEXT PRIMARY KEY, commerce_id TEXT NOT NULL, donnees TEXT NOT NULL, code_hash TEXT NOT NULL, code_sel TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS journal (
    id TEXT PRIMARY KEY, commerce_id TEXT NOT NULL, date TEXT NOT NULL, donnees TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS journal_commerce ON journal (commerce_id, date);
  CREATE TABLE IF NOT EXISTS menus (commerce_id TEXT PRIMARY KEY, donnees TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS parrainages (
    id TEXT PRIMARY KEY, commerce_id TEXT NOT NULL, parrain_id TEXT NOT NULL, filleul_id TEXT NOT NULL, date TEXT NOT NULL, donnees TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS parrainages_commerce ON parrainages (commerce_id, date);
  CREATE TABLE IF NOT EXISTS demandes_rattrapage (
    id TEXT PRIMARY KEY, commerce_id TEXT NOT NULL, client_id TEXT NOT NULL, date TEXT NOT NULL, donnees TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS rattrapages_commerce ON demandes_rattrapage (commerce_id, date);
  CREATE TABLE IF NOT EXISTS sessions_revoquees (jti TEXT PRIMARY KEY, expire_le TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS tentatives_auth (
    cle TEXT PRIMARY KEY, portee TEXT NOT NULL, echecs INTEGER NOT NULL, bloque_jusqu_a TEXT, derniere_tentative TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS tentatives_auth_derniere ON tentatives_auth (derniere_tentative);
  CREATE TABLE IF NOT EXISTS envois (
    id TEXT PRIMARY KEY, commerce_id TEXT NOT NULL, client_id TEXT NOT NULL, modele TEXT NOT NULL, canal TEXT NOT NULL,
    statut TEXT NOT NULL, jour TEXT NOT NULL, date TEXT NOT NULL, donnees TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS envois_un_par_jour ON envois (commerce_id, client_id, modele, jour) WHERE statut IN ('en_cours', 'envoye');
  CREATE INDEX IF NOT EXISTS envois_commerce ON envois (commerce_id, date);
  CREATE INDEX IF NOT EXISTS envois_client ON envois (commerce_id, client_id, date);
  CREATE TABLE IF NOT EXISTS evenements_jour (
    commerce_id TEXT NOT NULL, jour TEXT NOT NULL, type TEXT NOT NULL, n INTEGER NOT NULL,
    PRIMARY KEY (commerce_id, jour, type)
  );
  CREATE TABLE IF NOT EXISTS compteurs_publics (
    cle TEXT PRIMARY KEY, debut TEXT NOT NULL, n INTEGER NOT NULL CHECK (n >= 0)
  );
  CREATE INDEX IF NOT EXISTS compteurs_publics_debut ON compteurs_publics (debut);
`

type Ligne = { donnees: string }
const lire = <T>(lignes: unknown[]): T[] => (lignes as Ligne[]).map((l) => JSON.parse(l.donnees) as T)

export function ouvrirStockage(fichier: string) {
  if (fichier !== ':memory:') mkdirSync(dirname(fichier), { recursive: true })
  const db = new DatabaseSync(fichier)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;')
  db.exec(SCHEMA)

  const q = {
    meta: db.prepare('SELECT valeur FROM meta WHERE cle = ?'),
    majMeta: db.prepare('INSERT INTO meta (cle, valeur) VALUES (?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur'),
    insererMetaSiAbsente: db.prepare('INSERT INTO meta (cle, valeur) VALUES (?, ?) ON CONFLICT (cle) DO NOTHING'),
    majMetaSi: db.prepare('UPDATE meta SET valeur = ? WHERE cle = ? AND valeur = ?'),
    supprimerMeta: db.prepare('DELETE FROM meta WHERE cle = ?'),
    commerces: db.prepare('SELECT donnees FROM commerces ORDER BY rowid'),
    commerce: db.prepare('SELECT donnees FROM commerces WHERE id = ?'),
    pin: db.prepare('SELECT pin_hash AS hash, pin_sel AS sel FROM commerces WHERE id = ?'),
    ajoutCommerce: db.prepare('INSERT INTO commerces (id, donnees, pin_hash, pin_sel) VALUES (?, ?, ?, ?)'),
    majCommerce: db.prepare('UPDATE commerces SET donnees = ? WHERE id = ?'),
    majPin: db.prepare('UPDATE commerces SET pin_hash = ?, pin_sel = ? WHERE id = ?'),
    majPinSi: db.prepare('UPDATE commerces SET pin_hash = ?, pin_sel = ? WHERE id = ? AND pin_hash = ? AND pin_sel = ?'),
    clients: db.prepare('SELECT donnees FROM clients WHERE commerce_id = ? ORDER BY rowid'),
    client: db.prepare('SELECT donnees FROM clients WHERE commerce_id = ? AND id = ?'),
    clientParCle: db.prepare('SELECT donnees FROM clients WHERE commerce_id = ? AND cle_contact = ?'),
    // `instr` (et non LIKE) : sous-chaîne exacte, sensible à la casse comme `includes` (clés déjà en minuscules).
    candidatsNumero: db.prepare(
      `SELECT donnees FROM clients WHERE commerce_id = ? AND (instr(cle_contact, ?) > 0 OR instr(cle_contact, ?) > 0
        OR json_extract(donnees, '$.prenom') GLOB '*[0-9]*'
        OR (json_extract(donnees, '$.telephone') IS NOT NULL AND json_extract(donnees, '$.email') IS NOT NULL))
       ORDER BY rowid`,
    ),
    ajoutClient: db.prepare('INSERT INTO clients (id, commerce_id, cle_contact, donnees) VALUES (?, ?, ?, ?)'),
    majClient: db.prepare('UPDATE clients SET donnees = ? WHERE id = ?'),
    tirages: db.prepare('SELECT donnees FROM tirages WHERE commerce_id = ? ORDER BY date DESC'),
    tiragesClient: db.prepare('SELECT donnees FROM tirages WHERE commerce_id = ? AND client_id = ?'),
    tiragesDepuis: db.prepare('SELECT donnees FROM tirages WHERE commerce_id = ? AND date >= ? ORDER BY date DESC'),
    ajoutTirage: db.prepare('INSERT INTO tirages (id, commerce_id, client_id, date, donnees) VALUES (?, ?, ?, ?, ?)'),
    tiragesParCode: db.prepare("SELECT donnees FROM tirages WHERE commerce_id = ? AND json_extract(donnees, '$.code') = ? ORDER BY date DESC"),
    remettreTirage: db.prepare("UPDATE tirages SET donnees = ? WHERE id = ? AND commerce_id = ? AND json_extract(donnees, '$.remis') IS NULL"),
    avis: db.prepare('SELECT donnees FROM avis WHERE commerce_id = ? ORDER BY date DESC'),
    unAvis: db.prepare('SELECT donnees FROM avis WHERE commerce_id = ? AND id = ?'),
    ajoutAvis: db.prepare('INSERT INTO avis (id, commerce_id, date, donnees) VALUES (?, ?, ?, ?)'),
    majAvis: db.prepare('UPDATE avis SET donnees = ? WHERE id = ?'),
    membres: db.prepare('SELECT donnees, code_hash AS hash, code_sel AS sel FROM equipe WHERE commerce_id = ? ORDER BY rowid'),
    ajoutMembre: db.prepare('INSERT INTO equipe (id, commerce_id, donnees, code_hash, code_sel) VALUES (?, ?, ?, ?, ?)'),
    majMembre: db.prepare('UPDATE equipe SET donnees = ? WHERE id = ? AND commerce_id = ?'),
    majCodeMembre: db.prepare('UPDATE equipe SET code_hash = ?, code_sel = ? WHERE id = ? AND commerce_id = ?'),
    majCodeMembreSi: db.prepare('UPDATE equipe SET code_hash = ?, code_sel = ? WHERE id = ? AND commerce_id = ? AND code_hash = ? AND code_sel = ?'),
    supprimerMembre: db.prepare('DELETE FROM equipe WHERE commerce_id = ? AND id = ?'),
    journal: db.prepare('SELECT donnees FROM journal WHERE commerce_id = ? ORDER BY date DESC, rowid DESC LIMIT ?'),
    ajoutJournal: db.prepare('INSERT INTO journal (id, commerce_id, date, donnees) VALUES (?, ?, ?, ?)'),
    menu: db.prepare('SELECT donnees FROM menus WHERE commerce_id = ?'),
    majMenu: db.prepare('INSERT INTO menus (commerce_id, donnees) VALUES (?, ?) ON CONFLICT (commerce_id) DO UPDATE SET donnees = excluded.donnees'),
    ajoutParrainage: db.prepare('INSERT INTO parrainages (id, commerce_id, parrain_id, filleul_id, date, donnees) VALUES (?, ?, ?, ?, ?, ?)'),
    parrainageFilleul: db.prepare('SELECT donnees FROM parrainages WHERE commerce_id = ? AND filleul_id = ? LIMIT 1'),
    ajoutRattrapage: db.prepare('INSERT INTO demandes_rattrapage (id, commerce_id, client_id, date, donnees) VALUES (?, ?, ?, ?, ?)'),
    revoquerSession: db.prepare('INSERT INTO sessions_revoquees (jti, expire_le) VALUES (?, ?) ON CONFLICT (jti) DO NOTHING'),
    purgerRevocations: db.prepare('DELETE FROM sessions_revoquees WHERE expire_le < ?'),
    sessionRevoquee: db.prepare('SELECT 1 AS x FROM sessions_revoquees WHERE jti = ?'),
    tentativesAuth: db.prepare(
      'SELECT cle, portee, echecs, bloque_jusqu_a AS bloqueJusqua, derniere_tentative AS derniereTentative FROM tentatives_auth WHERE cle = ?',
    ),
    majTentativesAuth: db.prepare(
      `INSERT INTO tentatives_auth (cle, portee, echecs, bloque_jusqu_a, derniere_tentative) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (cle) DO UPDATE SET portee = excluded.portee, echecs = excluded.echecs, bloque_jusqu_a = excluded.bloque_jusqu_a, derniere_tentative = excluded.derniere_tentative`,
    ),
    purgerTentativesAuth: db.prepare('DELETE FROM tentatives_auth WHERE derniere_tentative < ? AND (bloque_jusqu_a IS NULL OR bloque_jusqu_a < ?)'),
    effacerTentativesAuth: db.prepare('DELETE FROM tentatives_auth WHERE cle = ?'),
    compteursPublics: db.prepare('SELECT cle, debut, n FROM compteurs_publics'),
    majCompteurPublic: db.prepare(
      `INSERT INTO compteurs_publics (cle, debut, n) VALUES (?, ?, ?)
       ON CONFLICT (cle) DO UPDATE SET debut = excluded.debut, n = excluded.n`,
    ),
    purgerCompteursPublics: db.prepare('DELETE FROM compteurs_publics WHERE debut < ?'),
    ajoutEnvoi: db.prepare('INSERT INTO envois (id, commerce_id, client_id, modele, canal, statut, jour, date, donnees) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    majEnvoi: db.prepare('UPDATE envois SET statut = ?, donnees = ? WHERE id = ? AND commerce_id = ?'),
    envois: db.prepare('SELECT donnees FROM envois WHERE commerce_id = ? ORDER BY date DESC, rowid DESC LIMIT ?'),
    envoisClient: db.prepare('SELECT donnees FROM envois WHERE commerce_id = ? AND client_id = ? ORDER BY date DESC, rowid DESC LIMIT ?'),
    compterEvenement: db.prepare(
      'INSERT INTO evenements_jour (commerce_id, jour, type, n) VALUES (?, ?, ?, 1) ON CONFLICT (commerce_id, jour, type) DO UPDATE SET n = n + 1',
    ),
    compteursEvenements: db.prepare('SELECT jour, type, n FROM evenements_jour WHERE commerce_id = ? AND jour >= ? ORDER BY jour, type'),
    // RGPD (P1-B6) : cascade de la suppression d'un client.
    supprTirages: db.prepare('DELETE FROM tirages WHERE commerce_id = ? AND client_id = ?'),
    supprJournal: db.prepare("DELETE FROM journal WHERE commerce_id = ? AND json_extract(donnees, '$.clientId') = ?"),
    supprParrainages: db.prepare('DELETE FROM parrainages WHERE commerce_id = ? AND (parrain_id = ? OR filleul_id = ?)'),
    supprRattrapages: db.prepare('DELETE FROM demandes_rattrapage WHERE commerce_id = ? AND client_id = ?'),
    supprEnvois: db.prepare('DELETE FROM envois WHERE commerce_id = ? AND client_id = ?'),
    supprClient: db.prepare('DELETE FROM clients WHERE commerce_id = ? AND id = ?'),
  }

  // Les transactions peuvent contenir des `await` (contrat commun avec Supabase) : elles passent une par une
  // (file d'attente). SQLite répondant sans attente réelle, aucune autre requête HTTP ne s'intercale pendant l'une d'elles.
  // P0-S11 : c'est pourquoi SQLite n'a ni colonne `version` ni verrou optimiste (commerces, clients, avis) — BEGIN
  // IMMEDIATE … COMMIT est déjà « tout ou rien » et sérialisé ; le verrou n'existe que sous Supabase.
  let file: Promise<unknown> = Promise.resolve()

  return {
    type: 'sqlite' as const,
    meta: (cle: string) => (q.meta.get(cle) as { valeur: string } | undefined)?.valeur,
    majMeta: (cle: string, valeur: string) => void q.majMeta.run(cle, valeur),
    majMetaSi: (cle: string, attendue: string | undefined, valeur: string) =>
      Number((attendue === undefined ? q.insererMetaSiAbsente.run(cle, valeur) : q.majMetaSi.run(valeur, cle, attendue)).changes) > 0,
    supprimerMeta: (cle: string) => void q.supprimerMeta.run(cle),

    commerces: () => lire<Commerce>(q.commerces.all()),
    commerce: (id: string) => lire<Commerce>(q.commerce.all(id))[0],
    pin: (id: string) => q.pin.get(id) as Pin | undefined,
    ajouterCommerce: (c: Commerce, pin: Pin) => inserer(q.ajoutCommerce, c.id, JSON.stringify(c), pin.hash, pin.sel),
    majCommerce: (c: Commerce) => void q.majCommerce.run(JSON.stringify(c), c.id),
    majPin: (id: string, pin: Pin) => void q.majPin.run(pin.hash, pin.sel, id),
    majPinSi: (id: string, attendu: Pin, pin: Pin) => Number(q.majPinSi.run(pin.hash, pin.sel, id, attendu.hash, attendu.sel).changes) > 0,

    clients: (commerceId: string) => lire<Client>(q.clients.all(commerceId)),
    client: (commerceId: string, id: string) => lire<Client>(q.client.all(commerceId, id))[0],
    /** Déduplication : même règle que le front (`cleContact` : 0033 / +33 / 06…, e-mail en minuscules). */
    clientParContact: (commerceId: string, contact: { telephone?: string; email?: string }) =>
      lire<Client>(q.clientParCle.all(commerceId, cleContact(contact)))[0],
    clientsCandidatsNumero: (commerceId: string, chiffres: string, texte: string) => lire<Client>(q.candidatsNumero.all(commerceId, chiffres, texte)),
    ajouterClient: (c: Client) => inserer(q.ajoutClient, c.id, c.commerceId, cleContact(c), JSON.stringify(c)),
    majClient: (c: Client) => void q.majClient.run(JSON.stringify(c), c.id),

    tirages: (commerceId: string) => lire<Tirage>(q.tirages.all(commerceId)),
    tiragesClient: (commerceId: string, clientId: string) => lire<Tirage>(q.tiragesClient.all(commerceId, clientId)),
    tiragesDepuis: (commerceId: string, depuis: string) => lire<Tirage>(q.tiragesDepuis.all(commerceId, depuis)),
    ajouterTirage: (t: Tirage) => inserer(q.ajoutTirage, t.id, t.commerceId, t.clientId, t.date, JSON.stringify(t)),
    tiragesParCode: (commerceId: string, code: string) => lire<Tirage>(q.tiragesParCode.all(commerceId, code)),
    marquerTirageRemis: (t: Tirage) => Number(q.remettreTirage.run(JSON.stringify(t), t.id, t.commerceId).changes) > 0,

    avis: (commerceId: string) => lire<Avis>(q.avis.all(commerceId)),
    unAvis: (commerceId: string, id: string) => lire<Avis>(q.unAvis.all(commerceId, id))[0],
    ajouterAvis: (a: Avis) => inserer(q.ajoutAvis, a.id, a.commerceId, a.date, JSON.stringify(a)),
    majAvis: (a: Avis) => void q.majAvis.run(JSON.stringify(a), a.id),

    membres: (commerceId: string) =>
      (q.membres.all(commerceId) as { donnees: string; hash: string; sel: string }[]).map((l) => ({
        membre: JSON.parse(l.donnees) as MembreEquipe,
        code: { hash: l.hash, sel: l.sel },
      })),
    ajouterMembre: (m: MembreEquipe, code: Pin) => inserer(q.ajoutMembre, m.id, m.commerceId, JSON.stringify(m), code.hash, code.sel),
    majMembre: (m: MembreEquipe, code?: Pin) => {
      q.majMembre.run(JSON.stringify(m), m.id, m.commerceId)
      if (code) q.majCodeMembre.run(code.hash, code.sel, m.id, m.commerceId)
    },
    majCodeMembreSi: (commerceId: string, id: string, attendu: Pin, code: Pin) =>
      Number(q.majCodeMembreSi.run(code.hash, code.sel, id, commerceId, attendu.hash, attendu.sel).changes) > 0,
    supprimerMembre: (commerceId: string, id: string) => void q.supprimerMembre.run(commerceId, id),
    journal: (commerceId: string, limite: number) => lire<EntreeJournal>(q.journal.all(commerceId, limite)),
    ajouterJournal: (e: EntreeJournal) => inserer(q.ajoutJournal, e.id, e.commerceId, e.date, JSON.stringify(e)),
    menu: (commerceId: string) => lire<Menu>(q.menu.all(commerceId))[0],
    majMenu: (m: Menu) => void q.majMenu.run(m.commerceId, JSON.stringify(m)),
    schemaCartiz: () => true,
    ajouterParrainage: (p: Parrainage) => inserer(q.ajoutParrainage, p.id, p.commerceId, p.parrainId, p.filleulId, p.date, JSON.stringify(p)),
    parrainageDuFilleul: (commerceId: string, filleulId: string) => lire<Parrainage>(q.parrainageFilleul.all(commerceId, filleulId))[0],
    ajouterDemandeRattrapage: (d: DemandeRattrapageTrace) => inserer(q.ajoutRattrapage, d.id, d.commerceId, d.clientId, d.date, JSON.stringify(d)),
    schemaProgramme: () => true,
    // Dates ISO UTC (`toISOString`) : l'ordre alphabétique est l'ordre chronologique.
    revoquerSession: (jti: string, expireLe: string, maintenant: string) => {
      q.purgerRevocations.run(maintenant)
      q.revoquerSession.run(jti, expireLe)
    },
    sessionRevoquee: (jti: string) => !!q.sessionRevoquee.get(jti),
    tentativesAuth: (cle: string) => {
      const l = q.tentativesAuth.get(cle) as TentativesAuth | undefined
      return l && { ...l }
    },
    enregistrerTentativesAuth: (t: TentativesAuth, purgerAvant: string) => {
      q.purgerTentativesAuth.run(purgerAvant, purgerAvant)
      q.majTentativesAuth.run(t.cle, t.portee, t.echecs, t.bloqueJusqua, t.derniereTentative)
    },
    effacerTentativesAuth: (cle: string) => void q.effacerTentativesAuth.run(cle),
    schemaAuthClient: () => true,
    compteursPublics: () => (q.compteursPublics.all() as unknown as CompteurPublic[]).map((l) => ({ cle: l.cle, debut: l.debut, n: Number(l.n) })),
    enregistrerCompteurPublic: (c: CompteurPublic, purgerAvant: string) => {
      q.purgerCompteursPublics.run(purgerAvant)
      q.majCompteurPublic.run(c.cle, c.debut, c.n)
    },
    purgerCompteursPublics: (avant: string) => void q.purgerCompteursPublics.run(avant),
    schemaCompteursPublics: () => true,
    ajouterEnvoi: (e: EnvoiRelance) => inserer(q.ajoutEnvoi, e.id, e.commerceId, e.clientId, e.modele, e.canal, e.statut, e.jour, e.date, JSON.stringify(e)),
    majEnvoi: (e: EnvoiRelance) => inserer(q.majEnvoi, e.statut, JSON.stringify(e), e.id, e.commerceId),
    envois: (commerceId: string, limite: number, clientId?: string) =>
      lire<EnvoiRelance>(clientId ? q.envoisClient.all(commerceId, clientId, limite) : q.envois.all(commerceId, limite)),
    schemaRelances: () => true,
    compterEvenement: (commerceId: string, jour: string, type: TypeEvenement) => void q.compterEvenement.run(commerceId, jour, type),
    compteursEvenements: (commerceId: string, depuis: string) =>
      (q.compteursEvenements.all(commerceId, depuis) as unknown as CompteurEvenement[]).map((l) => ({ jour: l.jour, type: l.type, n: Number(l.n) })),
    schemaMesure: () => true,
    supprimerClient: (commerceId: string, clientId: string) => {
      const n = (r: { changes: number | bigint }) => Number(r.changes)
      return {
        tirages: n(q.supprTirages.run(commerceId, clientId)),
        journal: n(q.supprJournal.run(commerceId, clientId)),
        parrainages: n(q.supprParrainages.run(commerceId, clientId, clientId)),
        rattrapages: n(q.supprRattrapages.run(commerceId, clientId)),
        envois: n(q.supprEnvois.run(commerceId, clientId)),
        client: n(q.supprClient.run(commerceId, clientId)) > 0,
      }
    },
    lireTableSauvegarde: async (table: string) => {
      // Nom vérifié contre la liste fermée des tables (jamais interpolé tel quel depuis une requête).
      if (!TABLES_SAUVEGARDE.some((t) => t.nom === table)) throw new Error(`table inconnue : « ${table} ».`)
      let lignes: Record<string, unknown>[]
      try {
        lignes = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all() as Record<string, unknown>[]
      } catch (e) {
        if (e instanceof Error && /no such table/i.test(e.message)) throw new Error(`table inconnue « ${table} »`)
        throw e
      }
      // Même forme que Postgres : `donnees` (texte JSON ici, JSONB là-bas) relu en objet.
      return lignes.map((l) => (typeof l.donnees === 'string' ? { ...l, donnees: JSON.parse(l.donnees) as unknown } : { ...l }))
    },

    /** Exécute `fn` d'un bloc : tout est écrit, ou rien. */
    transaction<T>(fn: () => T | Promise<T>): Promise<T> {
      const r = file.then(async () => {
        db.exec('BEGIN IMMEDIATE')
        try {
          const v = await fn()
          db.exec('COMMIT')
          return v
        } catch (e) {
          db.exec('ROLLBACK')
          throw e
        }
      })
      file = r.catch(() => {})
      return r
    },
    fermer: () => db.close(),
  } satisfies Stockage
}

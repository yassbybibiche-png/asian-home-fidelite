// Stockage SQLite (module intégré `node:sqlite`, aucune dépendance npm).
// Chaque objet métier est rangé tel quel en JSON (colonne `donnees`) : la forme des données reste
// celle de `src/types.ts`, partagée avec le front. Les colonnes à côté servent aux recherches.
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Avis, Client, Commerce, EntreeJournal, MembreEquipe, Menu, Tirage } from '../src/types.ts'
import { cleContact } from '../src/lib/fidelite.ts'

export interface Pin {
  hash: string
  sel: string
}

export interface MembreStocke {
  membre: MembreEquipe
  code: Pin
}

type P<T> = T | Promise<T>

/**
 * Contrat commun aux deux stockages : SQLite (ici, synchrone) et Supabase (`stockage-supabase.ts`, asynchrone).
 * Le serveur attend (`await`) chaque appel, ce qui marche pour les deux ; les noms et les formes de données sont identiques.
 */
export interface Stockage {
  readonly type: 'sqlite' | 'supabase'
  meta(cle: string): P<string | undefined>
  majMeta(cle: string, valeur: string): P<void>
  commerces(): P<Commerce[]>
  commerce(id: string): P<Commerce | undefined>
  pin(id: string): P<Pin | undefined>
  ajouterCommerce(c: Commerce, pin: Pin): P<void>
  majCommerce(c: Commerce): P<void>
  majPin(id: string, pin: Pin): P<void>
  clients(commerceId: string): P<Client[]>
  client(commerceId: string, id: string): P<Client | undefined>
  clientParContact(commerceId: string, contact: { telephone?: string; email?: string }): P<Client | undefined>
  ajouterClient(c: Client): P<void>
  majClient(c: Client): P<void>
  tirages(commerceId: string): P<Tirage[]>
  tiragesClient(commerceId: string, clientId: string): P<Tirage[]>
  ajouterTirage(t: Tirage): P<void>
  avis(commerceId: string): P<Avis[]>
  unAvis(commerceId: string, id: string): P<Avis | undefined>
  ajouterAvis(a: Avis): P<void>
  majAvis(a: Avis): P<void>
  /** Équipe : le code (haché + salé) est rangé à part, jamais dans `donnees`. */
  membres(commerceId: string): P<MembreStocke[]>
  ajouterMembre(m: MembreEquipe, code: Pin): P<void>
  majMembre(m: MembreEquipe, code?: Pin): P<void>
  supprimerMembre(commerceId: string, id: string): P<void>
  /** Journal d'audit, du plus récent au plus ancien. */
  journal(commerceId: string, limite: number): P<EntreeJournal[]>
  ajouterJournal(e: EntreeJournal): P<void>
  menu(commerceId: string): P<Menu | undefined>
  majMenu(m: Menu): P<void>
  /** Tables de la migration 0003 présentes (toujours vrai sous SQLite, le schéma est créé au démarrage). */
  schemaCartiz(): P<boolean>
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
 * Table de la migration 0003 (equipe / journal / menus) absente de la base Supabase : migration pas encore appliquée.
 * Les lectures renvoient du vide et le journal est ignoré (l'existant continue de marcher) ; les nouvelles écritures
 * (équipe, menu) lèvent cette erreur → 503 explicite.
 */
export class ErreurMigrationManquante extends Error {
  constructor(table: string) {
    super(`Fonction pas encore activée : la table « ${table} » n’existe pas. Appliquez la migration supabase/migrations/0003_cartiz.sql dans le SQL Editor de Supabase.`)
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
    commerces: db.prepare('SELECT donnees FROM commerces ORDER BY rowid'),
    commerce: db.prepare('SELECT donnees FROM commerces WHERE id = ?'),
    pin: db.prepare('SELECT pin_hash AS hash, pin_sel AS sel FROM commerces WHERE id = ?'),
    ajoutCommerce: db.prepare('INSERT INTO commerces (id, donnees, pin_hash, pin_sel) VALUES (?, ?, ?, ?)'),
    majCommerce: db.prepare('UPDATE commerces SET donnees = ? WHERE id = ?'),
    majPin: db.prepare('UPDATE commerces SET pin_hash = ?, pin_sel = ? WHERE id = ?'),
    clients: db.prepare('SELECT donnees FROM clients WHERE commerce_id = ? ORDER BY rowid'),
    client: db.prepare('SELECT donnees FROM clients WHERE commerce_id = ? AND id = ?'),
    clientParCle: db.prepare('SELECT donnees FROM clients WHERE commerce_id = ? AND cle_contact = ?'),
    ajoutClient: db.prepare('INSERT INTO clients (id, commerce_id, cle_contact, donnees) VALUES (?, ?, ?, ?)'),
    majClient: db.prepare('UPDATE clients SET donnees = ? WHERE id = ?'),
    tirages: db.prepare('SELECT donnees FROM tirages WHERE commerce_id = ? ORDER BY date DESC'),
    tiragesClient: db.prepare('SELECT donnees FROM tirages WHERE commerce_id = ? AND client_id = ?'),
    ajoutTirage: db.prepare('INSERT INTO tirages (id, commerce_id, client_id, date, donnees) VALUES (?, ?, ?, ?, ?)'),
    avis: db.prepare('SELECT donnees FROM avis WHERE commerce_id = ? ORDER BY date DESC'),
    unAvis: db.prepare('SELECT donnees FROM avis WHERE commerce_id = ? AND id = ?'),
    ajoutAvis: db.prepare('INSERT INTO avis (id, commerce_id, date, donnees) VALUES (?, ?, ?, ?)'),
    majAvis: db.prepare('UPDATE avis SET donnees = ? WHERE id = ?'),
    membres: db.prepare('SELECT donnees, code_hash AS hash, code_sel AS sel FROM equipe WHERE commerce_id = ? ORDER BY rowid'),
    ajoutMembre: db.prepare('INSERT INTO equipe (id, commerce_id, donnees, code_hash, code_sel) VALUES (?, ?, ?, ?, ?)'),
    majMembre: db.prepare('UPDATE equipe SET donnees = ? WHERE id = ? AND commerce_id = ?'),
    majCodeMembre: db.prepare('UPDATE equipe SET code_hash = ?, code_sel = ? WHERE id = ? AND commerce_id = ?'),
    supprimerMembre: db.prepare('DELETE FROM equipe WHERE commerce_id = ? AND id = ?'),
    journal: db.prepare('SELECT donnees FROM journal WHERE commerce_id = ? ORDER BY date DESC, rowid DESC LIMIT ?'),
    ajoutJournal: db.prepare('INSERT INTO journal (id, commerce_id, date, donnees) VALUES (?, ?, ?, ?)'),
    menu: db.prepare('SELECT donnees FROM menus WHERE commerce_id = ?'),
    majMenu: db.prepare('INSERT INTO menus (commerce_id, donnees) VALUES (?, ?) ON CONFLICT (commerce_id) DO UPDATE SET donnees = excluded.donnees'),
  }

  // Les transactions peuvent contenir des `await` (contrat commun avec Supabase) : elles passent une par une
  // (file d'attente). SQLite répondant sans attente réelle, aucune autre requête HTTP ne s'intercale pendant l'une d'elles.
  let file: Promise<unknown> = Promise.resolve()

  return {
    type: 'sqlite' as const,
    meta: (cle: string) => (q.meta.get(cle) as { valeur: string } | undefined)?.valeur,
    majMeta: (cle: string, valeur: string) => void q.majMeta.run(cle, valeur),

    commerces: () => lire<Commerce>(q.commerces.all()),
    commerce: (id: string) => lire<Commerce>(q.commerce.all(id))[0],
    pin: (id: string) => q.pin.get(id) as Pin | undefined,
    ajouterCommerce: (c: Commerce, pin: Pin) => inserer(q.ajoutCommerce, c.id, JSON.stringify(c), pin.hash, pin.sel),
    majCommerce: (c: Commerce) => void q.majCommerce.run(JSON.stringify(c), c.id),
    majPin: (id: string, pin: Pin) => void q.majPin.run(pin.hash, pin.sel, id),

    clients: (commerceId: string) => lire<Client>(q.clients.all(commerceId)),
    client: (commerceId: string, id: string) => lire<Client>(q.client.all(commerceId, id))[0],
    /** Déduplication : même règle que le front (`cleContact` : 0033 / +33 / 06…, e-mail en minuscules). */
    clientParContact: (commerceId: string, contact: { telephone?: string; email?: string }) =>
      lire<Client>(q.clientParCle.all(commerceId, cleContact(contact)))[0],
    ajouterClient: (c: Client) => inserer(q.ajoutClient, c.id, c.commerceId, cleContact(c), JSON.stringify(c)),
    majClient: (c: Client) => void q.majClient.run(JSON.stringify(c), c.id),

    tirages: (commerceId: string) => lire<Tirage>(q.tirages.all(commerceId)),
    tiragesClient: (commerceId: string, clientId: string) => lire<Tirage>(q.tiragesClient.all(commerceId, clientId)),
    ajouterTirage: (t: Tirage) => inserer(q.ajoutTirage, t.id, t.commerceId, t.clientId, t.date, JSON.stringify(t)),

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
    supprimerMembre: (commerceId: string, id: string) => void q.supprimerMembre.run(commerceId, id),
    journal: (commerceId: string, limite: number) => lire<EntreeJournal>(q.journal.all(commerceId, limite)),
    ajouterJournal: (e: EntreeJournal) => inserer(q.ajoutJournal, e.id, e.commerceId, e.date, JSON.stringify(e)),
    menu: (commerceId: string) => lire<Menu>(q.menu.all(commerceId))[0],
    majMenu: (m: Menu) => void q.majMenu.run(m.commerceId, JSON.stringify(m)),
    schemaCartiz: () => true,

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

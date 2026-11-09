// Stockage SQLite (module intégré `node:sqlite`, aucune dépendance npm).
// Chaque objet métier est rangé tel quel en JSON (colonne `donnees`) : la forme des données reste
// celle de `src/types.ts`, partagée avec le front. Les colonnes à côté servent aux recherches.
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Avis, Client, Commerce, Tirage } from '../src/types.ts'
import { cleContact } from '../src/lib/fidelite.ts'

export interface Pin {
  hash: string
  sel: string
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
  /** Pas d'imbrication. SQLite : vraie transaction. Supabase : voir `stockage-supabase.ts` (pas de transaction multi-requêtes). */
  transaction<T>(fn: () => P<T>): Promise<T>
  fermer(): P<void>
}

/**
 * Écriture refusée par une contrainte d'unicité de la base (client déjà inscrit avec ce contact, 2e tirage du jour…)
 * ou, sous Supabase, ligne modifiée par une autre requête entre la lecture et l'écriture. Le serveur répond 409.
 */
export class ErreurConflit extends Error {}

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

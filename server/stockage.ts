// Stockage SQLite (module intégré `node:sqlite`, aucune dépendance npm).
// Chaque objet métier est rangé tel quel en JSON (colonne `donnees`) : la forme des données reste
// celle de `src/types.ts`, partagée avec le front. Les colonnes à côté servent aux recherches.
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Avis, Client, Commerce, Tirage } from '../src/types.ts'
import { cleContact } from '../src/lib/fidelite.ts'

export interface Pin {
  hash: string
  sel: string
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

export type Stockage = ReturnType<typeof ouvrirStockage>

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

  return {
    meta: (cle: string) => (q.meta.get(cle) as { valeur: string } | undefined)?.valeur,
    majMeta: (cle: string, valeur: string) => void q.majMeta.run(cle, valeur),

    commerces: () => lire<Commerce>(q.commerces.all()),
    commerce: (id: string) => lire<Commerce>(q.commerce.all(id))[0],
    pin: (id: string) => q.pin.get(id) as Pin | undefined,
    ajouterCommerce: (c: Commerce, pin: Pin) => void q.ajoutCommerce.run(c.id, JSON.stringify(c), pin.hash, pin.sel),
    majCommerce: (c: Commerce) => void q.majCommerce.run(JSON.stringify(c), c.id),
    majPin: (id: string, pin: Pin) => void q.majPin.run(pin.hash, pin.sel, id),

    clients: (commerceId: string) => lire<Client>(q.clients.all(commerceId)),
    client: (commerceId: string, id: string) => lire<Client>(q.client.all(commerceId, id))[0],
    /** Déduplication : même règle que le front (`cleContact` : 0033 / +33 / 06…, e-mail en minuscules). */
    clientParContact: (commerceId: string, contact: { telephone?: string; email?: string }) =>
      lire<Client>(q.clientParCle.all(commerceId, cleContact(contact)))[0],
    ajouterClient: (c: Client) => void q.ajoutClient.run(c.id, c.commerceId, cleContact(c), JSON.stringify(c)),
    majClient: (c: Client) => void q.majClient.run(JSON.stringify(c), c.id),

    tirages: (commerceId: string) => lire<Tirage>(q.tirages.all(commerceId)),
    tiragesClient: (commerceId: string, clientId: string) => lire<Tirage>(q.tiragesClient.all(commerceId, clientId)),
    ajouterTirage: (t: Tirage) => void q.ajoutTirage.run(t.id, t.commerceId, t.clientId, t.date, JSON.stringify(t)),

    avis: (commerceId: string) => lire<Avis>(q.avis.all(commerceId)),
    unAvis: (commerceId: string, id: string) => lire<Avis>(q.unAvis.all(commerceId, id))[0],
    ajouterAvis: (a: Avis) => void q.ajoutAvis.run(a.id, a.commerceId, a.date, JSON.stringify(a)),
    majAvis: (a: Avis) => void q.majAvis.run(JSON.stringify(a), a.id),

    /** Exécute `fn` d'un bloc : tout est écrit, ou rien. */
    transaction<T>(fn: () => T): T {
      db.exec('BEGIN IMMEDIATE')
      try {
        const r = fn()
        db.exec('COMMIT')
        return r
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
    fermer: () => db.close(),
  }
}

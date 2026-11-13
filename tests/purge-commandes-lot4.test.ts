// Expérience 10/10, lot 4 — Purge des commandes à table anciennes (server/commandes.ts) : les jours de Paris strictement
// plus vieux que CONSERVATION_COMMANDES_JOURS (J-31 et avant) perdent leurs commandes (secrets compris), leurs clés
// d'idempotence, leur index et leur entrée de purge ; J-30, hier et aujourd'hui restent. Déclenchement opportuniste à la
// création (au plus une fois par 24 h et par commerce), jamais bloquant. Clé d'idempotence orpheline (commande purgée
// sans entrée de purge — commandes d'avant ce lot) : traitée comme libre.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { ouvrirStockage, type Stockage } from '../server/stockage.ts'
import {
  cleCommande, cleEntreePurge, cleIdempotence, cleIndexCommandes, clePurgeFaite, commandeDejaCreee, CONSERVATION_COMMANDES_JOURS,
  creerCommande, listerCommandes, purgerCommandesAnciennes, purgerSiDue,
} from '../server/commandes.ts'
import type { Commande, Menu } from '../src/types.ts'

const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
/** Mardi 15/12/2026, 12:00 à Paris. J-30 = 15/11, J-31 = 14/11, hier = 14/12. */
const MAINTENANT = new Date('2026-12-15T11:00:00Z')
const midiDe = (jour: string) => `${jour}T11:00:00.000Z`

const commande = (id: string, jour: string): Commande => ({
  id, commerceId: AH, table: 'T1', lignes: [], total: 0, statut: 'recue', creeLe: midiDe(jour), majLe: midiDe(jour), secret: `secret-${id}-aaaaaaaa`,
})

/** Toutes les lignes `meta` liées aux commandes, pour comparer avant / après. */
function lignesCommandes(st: Stockage, cles: string[]) {
  return Promise.all(cles.map(async (k) => [k, await st.meta(k)] as const))
}

describe('Purge des commandes : module', () => {
  test('constante : 30 jours gardés', () => {
    assert.equal(CONSERVATION_COMMANDES_JOURS, 30)
  })

  test('J-31 purgée (commande, idempotence, index, entrée de purge) ; J-30, hier et aujourd’hui intacts ; seconde purge sans effet', async () => {
    const st = ouvrirStockage(':memory:')
    await creerCommande(st, commande('vieille-a', '2026-11-14'), 'cle-vieille-a')
    await creerCommande(st, commande('vieille-b', '2026-11-14'), 'cle-vieille-b')
    await creerCommande(st, commande('plus-vieille', '2026-11-02'), 'cle-plus-vieille')
    await creerCommande(st, commande('limite', '2026-11-15'), 'cle-limite-aa')
    await creerCommande(st, commande('hier', '2026-12-14'), 'cle-hier-aaaa')
    await creerCommande(st, commande('ajd', '2026-12-15'), 'cle-ajd-aaaaa')
    assert.deepEqual(JSON.parse((await st.meta(cleEntreePurge(AH, '2026-11-14')))!), { commandes: ['vieille-a', 'vieille-b'], idempotences: ['cle-vieille-a', 'cle-vieille-b'] })

    assert.equal(await purgerCommandesAnciennes(st, AH, MAINTENANT), 3)
    for (const [jour, id, cle] of [['2026-11-14', 'vieille-a', 'cle-vieille-a'], ['2026-11-14', 'vieille-b', 'cle-vieille-b'], ['2026-11-02', 'plus-vieille', 'cle-plus-vieille']]) {
      assert.equal(await st.meta(cleCommande(AH, id)), undefined, id)
      assert.equal(await st.meta(cleIdempotence(AH, cle)), undefined, cle)
      assert.equal(await st.meta(cleIndexCommandes(AH, jour)), undefined, jour)
      assert.equal(await st.meta(cleEntreePurge(AH, jour)), undefined, jour)
    }
    // Gardés : J-30 (limite), hier (historique cuisine), aujourd'hui — avec index, idempotence et entrée de purge.
    for (const [jour, id, cle] of [['2026-11-15', 'limite', 'cle-limite-aa'], ['2026-12-14', 'hier', 'cle-hier-aaaa'], ['2026-12-15', 'ajd', 'cle-ajd-aaaaa']]) {
      assert.deepEqual((await listerCommandes(st, AH, jour)).map((c) => c.id), [id], jour)
      assert.equal(await st.meta(cleIdempotence(AH, cle)), id)
      assert.ok(await st.meta(cleEntreePurge(AH, jour)))
    }
    assert.equal((await commandeDejaCreee(st, AH, 'cle-hier-aaaa'))?.id, 'hier')

    const cles = ['2026-11-15', '2026-12-14', '2026-12-15'].flatMap((j) => [cleIndexCommandes(AH, j), cleEntreePurge(AH, j)])
      .concat(['limite', 'hier', 'ajd'].map((id) => cleCommande(AH, id)))
    const avant = await lignesCommandes(st, cles)
    assert.equal(await purgerCommandesAnciennes(st, AH, MAINTENANT), 0, 'seconde purge : rien à supprimer')
    assert.deepEqual(await lignesCommandes(st, cles), avant)
  })

  test('un autre commerce n’est pas touché', async () => {
    const st = ouvrirStockage(':memory:')
    await creerCommande(st, { ...commande('autre', '2026-11-03'), commerceId: 'c-autre' }, 'cle-autre-aaa')
    assert.equal(await purgerCommandesAnciennes(st, AH, MAINTENANT), 0)
    assert.equal((await listerCommandes(st, 'c-autre', '2026-11-03')).length, 1)
  })

  test('commande d’avant ce lot (sans entrée de purge) : commande et index purgés, la clé d’idempotence orpheline redevient libre', async () => {
    const st = ouvrirStockage(':memory:')
    // Format du lot 1 : commande + index + clé, aucune entrée de purge.
    const ancienne = commande('pre-lot', '2026-11-10')
    await st.majMeta(cleCommande(AH, 'pre-lot'), JSON.stringify(ancienne))
    await st.majMeta(cleIndexCommandes(AH, '2026-11-10'), JSON.stringify(['pre-lot']))
    await st.majMeta(cleIdempotence(AH, 'cle-pre-lot-aa'), 'pre-lot')
    assert.equal(await purgerCommandesAnciennes(st, AH, MAINTENANT), 1)
    assert.equal(await st.meta(cleCommande(AH, 'pre-lot')), undefined)
    assert.equal(await st.meta(cleIndexCommandes(AH, '2026-11-10')), undefined)
    assert.equal(await st.meta(cleIdempotence(AH, 'cle-pre-lot-aa')), 'pre-lot', 'clé orpheline restée (aucune liste pour la retrouver)')
    assert.equal(await commandeDejaCreee(st, AH, 'cle-pre-lot-aa'), undefined, 'orpheline = pas de doublon')
    // Réemploi de la clé : nouvelle commande créée (pas de « en cours » éternel), clé reprise.
    const r = await creerCommande(st, commande('neuve', '2026-12-15'), 'cle-pre-lot-aa')
    assert.equal(r.doublon, false)
    assert.equal(await st.meta(cleIdempotence(AH, 'cle-pre-lot-aa')), 'neuve')
    assert.deepEqual((await listerCommandes(st, AH, '2026-12-15')).map((c) => c.id), ['neuve'])
    // Et la clé reprise sert ensuite d'idempotence normale.
    const bis = await creerCommande(st, commande('neuve-bis', '2026-12-15'), 'cle-pre-lot-aa')
    assert.equal(bis.doublon, true)
    assert.equal(bis.commande.id, 'neuve')
    assert.equal(await st.meta(cleCommande(AH, 'neuve-bis')), undefined)
  })

  test('une clé d’idempotence listée mais reprise depuis par une autre commande n’est pas supprimée', async () => {
    const st = ouvrirStockage(':memory:')
    await creerCommande(st, commande('v1', '2026-11-14'), 'cle-reprise-aa')
    await st.majMeta(cleIdempotence(AH, 'cle-reprise-aa'), 'autre-commande')
    await purgerCommandesAnciennes(st, AH, MAINTENANT)
    assert.equal(await st.meta(cleIdempotence(AH, 'cle-reprise-aa')), 'autre-commande')
  })

  test('purgerSiDue : une fois par 24 h ; la suivante reprend une semaine avant la borne de la précédente', async () => {
    const st = ouvrirStockage(':memory:')
    await creerCommande(st, commande('a', '2026-11-14'), 'cle-due-a-aaa')
    assert.equal(await purgerSiDue(st, AH, MAINTENANT), true)
    assert.equal(await st.meta(clePurgeFaite(AH)), MAINTENANT.toISOString())
    assert.equal(await st.meta(cleCommande(AH, 'a')), undefined)
    // J-30 aujourd'hui : gardée ce jour, purgée le lendemain (24 h plus tard), pas avant.
    await creerCommande(st, commande('b', '2026-11-15'), 'cle-due-b-aaa')
    assert.equal(await purgerSiDue(st, AH, new Date(MAINTENANT.getTime() + 23 * 3600_000)), false)
    assert.ok(await st.meta(cleCommande(AH, 'b')))
    const demain = new Date(MAINTENANT.getTime() + 24 * 3600_000)
    assert.equal(await purgerSiDue(st, AH, demain), true)
    assert.equal(await st.meta(cleCommande(AH, 'b')), undefined)
    assert.equal(await st.meta(clePurgeFaite(AH)), demain.toISOString())
  })
})

describe('Purge des commandes : vrai serveur HTTP (SQLite)', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-purge-'))
  const fichierDb = join(dossier, 'purge.db')
  const MENU: Pick<Menu, 'categories'> = { categories: [{ id: 'cat', nom: 'Plats', produits: [{ id: 'p-nems', nom: 'Nems', prix: 650, allergenes: [] }] }] }
  let app: Awaited<ReturnType<typeof creerServeur>>
  let base = ''
  let ip = 0
  let n = 0
  let horloge = MAINTENANT
  let jeton = ''

  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.8.${Math.floor(++ip / 250)}.${ip % 250}`, ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    return { statut: r.status, contenu: await r.json() }
  }
  const commander = (cleIdempotence = `cle-http-${++n}-aaaa`) =>
    api('POST', `/commerces/${AH}/commandes`, { jetonTable: jeton, lignes: [{ produitId: 'p-nems', quantite: 1 }], cleIdempotence, secret: `secret-http-${++n}-aaaaaaaa` })
  /** Écrit une commande « ancienne » directement en base (fichier SQLite partagé avec le serveur). */
  async function semerAncienne(id: string, jour: string, cle: string, avecEntree = true) {
    const st = ouvrirStockage(fichierDb)
    if (avecEntree) await creerCommande(st, commande(id, jour), cle)
    else {
      await st.majMeta(cleCommande(AH, id), JSON.stringify(commande(id, jour)))
      await st.majMeta(cleIndexCommandes(AH, jour), JSON.stringify([id]))
      await st.majMeta(cleIdempotence(AH, cle), id)
    }
  }
  const metaDb = (cle: string) => {
    const db = new DatabaseSync(fichierDb)
    try {
      return (db.prepare('SELECT valeur FROM meta WHERE cle = ?').get(cle) as { valeur: string } | undefined)?.valeur
    } finally {
      db.close()
    }
  }

  before(async () => {
    app = await creerServeur({ fichierDb, adminPin: '98765432', pinInitial: '1234', version: 'test', maintenant: () => horloge, derriereProxy: true, limiteCommandesParIp: 1000 })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
    assert.equal((await api('PUT', `/commerces/${AH}/menu`, MENU, PIN)).statut, 200)
    assert.equal((await api('PATCH', `/commerces/${AH}`, { commande: { active: true, tables: [{ nom: 'Table 1' }] } }, PIN)).statut, 200)
    jeton = (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.commerce.commande.tables[0].jeton
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('la création n’échoue pas si la purge échoue (stockage fautif) ; la purge reprend à la création suivante', async (t) => {
    await semerAncienne('fautive', '2026-11-14', 'cle-fautive-aa')
    const db = new DatabaseSync(fichierDb)
    db.exec(`CREATE TRIGGER purge_en_panne BEFORE DELETE ON meta WHEN OLD.cle LIKE 'commande:%' BEGIN SELECT RAISE(ABORT, 'disque en panne'); END`)
    const avertissements: string[] = []
    t.mock.method(console, 'warn', (m: string) => void avertissements.push(m))
    try {
      const r = await commander()
      assert.equal(r.statut, 201, JSON.stringify(r.contenu))
      assert.equal(metaDb(cleCommande(AH, r.contenu.commande.id)) !== undefined, true, 'commande écrite')
      assert.ok(metaDb(cleCommande(AH, 'fautive')), 'purge échouée : rien de supprimé')
      assert.equal(metaDb(clePurgeFaite(AH)), undefined, 'purge non marquée faite')
      assert.ok(avertissements.some((m) => /\[commandes\] purge des commandes anciennes reportée/.test(m)), avertissements.join('\n'))
    } finally {
      db.exec('DROP TRIGGER purge_en_panne')
      db.close()
    }
    assert.equal((await commander()).statut, 201)
    assert.equal(metaDb(cleCommande(AH, 'fautive')), undefined, 'purge faite à la création suivante')
    assert.equal(metaDb(clePurgeFaite(AH)), horloge.toISOString())
  })

  test('purge au plus une fois par 24 h, déclenchée par la création ; commandes du jour et d’hier intactes', async () => {
    await semerAncienne('j31-bis', '2026-11-14', 'cle-j31-bis-a')
    const r = await commander()
    assert.equal(r.statut, 201)
    assert.ok(metaDb(cleCommande(AH, 'j31-bis')), 'moins de 24 h depuis la dernière purge : rien')
    horloge = new Date(MAINTENANT.getTime() + 25 * 3600_000) // 16/12 13:00 Paris
    await semerAncienne('hier-http', '2026-12-15', 'cle-hier-http')
    assert.equal((await commander()).statut, 201)
    assert.equal(metaDb(cleCommande(AH, 'j31-bis')), undefined)
    assert.equal(metaDb(cleIdempotence(AH, 'cle-j31-bis-a')), undefined)
    const cuisine = await api('GET', `/commerces/${AH}/commandes?jour=2026-12-15`, undefined, PIN)
    assert.ok(cuisine.contenu.commandes.some((c: Commande) => c.id === 'hier-http'), 'historique cuisine d’hier intact')
    assert.ok(cuisine.contenu.commandes.some((c: Commande) => c.id === r.contenu.commande.id))
  })

  test('clé d’idempotence d’une commande purgée d’avant ce lot : réutilisable (201, pas 409 « en cours »)', async () => {
    await semerAncienne('pre-lot-http', '2026-11-12', 'cle-pre-lot-http', false)
    horloge = new Date(horloge.getTime() + 25 * 3600_000)
    assert.equal((await commander()).statut, 201) // déclenche la purge
    assert.equal(metaDb(cleCommande(AH, 'pre-lot-http')), undefined)
    assert.equal(metaDb(cleIdempotence(AH, 'cle-pre-lot-http')), 'pre-lot-http', 'orpheline restée')
    const r = await commander('cle-pre-lot-http')
    assert.equal(r.statut, 201, JSON.stringify(r.contenu))
    assert.notEqual(r.contenu.commande.id, 'pre-lot-http')
    assert.equal(metaDb(cleIdempotence(AH, 'cle-pre-lot-http')), r.contenu.commande.id)
    const encore = await commander('cle-pre-lot-http')
    assert.equal(encore.statut, 200)
    assert.equal(encore.contenu.doublon, true)
    assert.equal(encore.contenu.commande.id, r.contenu.commande.id)
  })
})

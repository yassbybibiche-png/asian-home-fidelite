// Correction Codex point 9 — Relances automatiques : une tournée interrompue ne marque plus la journée comme faite.
// La panne est simulée par un trigger SQLite posé sur la base du serveur (connexion séparée) : il fait échouer la
// réservation d'un envoi au milieu de la tournée, comme une écriture qui tombe en panne en production. Prestataire
// simulé (fetch injecté), horloge figée : AUCUN appel réseau réel.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { ouvrirStockage } from '../server/stockage.ts'
import type { Client, EnvoiRelance } from '../src/types.ts'

const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const SITE = 'https://asian-home-fidelite.onrender.com'
const JOUR = 24 * 3600_000
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-codex-9-'))
after(() => rmSync(dossier, { recursive: true, force: true }))

async function demarrer(nom: string, o: { statut?: number; delai?: number } = {}) {
  const horloge = { t: new Date('2026-11-10T11:00:00Z') }
  const appels: { corps: string }[] = []
  const fetch = (async (_url: string, init: RequestInit) => {
    appels.push({ corps: String(init.body) })
    if (o.delai) await new Promise((r) => setTimeout(r, o.delai))
    return new Response(JSON.stringify({ sid: `SM${appels.length}` }), { status: o.statut ?? 201 })
  }) as unknown as typeof globalThis.fetch
  const fichierDb = join(dossier, nom)
  const app = await creerServeur({
    fichierDb,
    adminPin: ADMIN,
    pinInitial: '1234',
    version: 'test',
    urlPublique: SITE,
    maintenant: () => horloge.t,
    limitesPubliques: { inscriptionParIp: 1000, inscriptionParContact: 1000, ficheClientParIp: 1000, lectureParIp: 1000 },
    notifications: { twilio: { accountSid: 'ACtest', authToken: 'jeton-twilio-test', expediteur: '+33700000000' }, fetch },
  })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
  async function api(methode: string, chemin: string, corps?: unknown) {
    const r = await globalThis.fetch(`${racine}/api/v1${chemin}`, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...PIN },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    return { statut: r.status, contenu: await r.json() }
  }
  const envois = async () => ((await api('GET', `/commerces/${AH}/envois`)).contenu.envois as EnvoiRelance[]).filter((e) => e.declencheur === 'auto')
  /** Ouverture du tableau de bord (déclenche la tournée en arrière-plan), puis attente de sa fin. */
  async function ouvrirTableau() {
    assert.equal((await api('GET', `/commerces/${AH}/etat`)).statut, 200)
    await app.relancesEnCours()
  }
  /** Trois clients consentants absents depuis 40 jours : trois relances « inactif » dues aujourd'hui. */
  async function troisInactifs() {
    const il40 = new Date(horloge.t.getTime() - 40 * JOUR).toISOString()
    const ids: string[] = []
    for (const [prenom, contact] of [['Ines', '0611111111'], ['Jade', '0622222222'], ['Karim', '0633333333']]) {
      const c = (await api('POST', `/commerces/${AH}/clients`, { prenom, contact, consentementRelance: true })).contenu.client as Client
      const st = ouvrirStockage(fichierDb)
      st.majClient({ ...st.client(AH, c.id)!, derniereVisite: il40, visites: [il40], tampons: 1 })
      st.fermer()
      ids.push(c.id)
    }
    await api('PATCH', `/commerces/${AH}`, { relancesAuto: { inactif: true } })
    return ids
  }
  /** Panne simulée : toute réservation d'envoi échoue dès que `n` lignes actives existent déjà pour le commerce. */
  function panneApres(n: number) {
    const db = new DatabaseSync(fichierDb)
    db.exec(`CREATE TRIGGER panne_envois BEFORE INSERT ON envois
      WHEN (SELECT count(*) FROM envois WHERE commerce_id = NEW.commerce_id AND statut IN ('en_cours', 'envoye')) >= ${n}
      BEGIN SELECT RAISE(ABORT, 'panne simulée de la base'); END`)
    db.close()
  }
  function reparer() {
    const db = new DatabaseSync(fichierDb)
    db.exec('DROP TRIGGER panne_envois')
    db.close()
  }
  return { app, appels, horloge, envois, ouvrirTableau, troisInactifs, panneApres, reparer }
}

/** Nombre de relances réellement parties par client. */
const parClient = (e: EnvoiRelance[]) => {
  const n = new Map<string, number>()
  for (const x of e) if (x.statut === 'envoye') n.set(x.clientId, (n.get(x.clientId) ?? 0) + 1)
  return n
}

describe('Point Codex 9 — une panne en cours de tournée ne fait plus perdre les relances du jour', () => {
  test('panne au milieu (après un 1er envoi réussi) → la 2e ouverture du jour reprend, sans doublon pour le 1er client', async () => {
    const s = await demarrer('milieu.db')
    try {
      const ids = await s.troisInactifs()
      s.panneApres(1)
      await s.ouvrirTableau()
      // Un seul message est parti avant la panne ; la tournée s'est arrêtée là.
      assert.equal(s.appels.length, 1)
      const avant = await s.envois()
      assert.deepEqual(avant.map((e) => e.statut), ['envoye'])
      const premier = avant[0].clientId

      s.reparer()
      // Même jour, nouvelle ouverture : la tournée repart (avant le correctif, le jour était déjà marqué → rien).
      await s.ouvrirTableau()
      assert.equal(s.appels.length, 3, 'les deux relances restantes partent')
      const apres = await s.envois()
      const n = parClient(apres)
      assert.deepEqual([...n.keys()].sort(), [...ids].sort())
      for (const id of ids) assert.equal(n.get(id), 1, `une seule relance pour ${id}`)
      assert.equal(n.get(premier), 1, 'le client relancé avant la panne ne reçoit pas de doublon')
      assert.equal(apres.filter((e) => e.statut === 'en_cours').length, 0)

      // Tournée désormais menée à bien : plus rien le même jour.
      await s.ouvrirTableau()
      assert.equal(s.appels.length, 3)
    } finally {
      await s.app.fermer()
    }
  })

  test('panne dès la 1re réservation → rien n’est parti, la reprise envoie les trois relances dues', async () => {
    const s = await demarrer('debut.db')
    try {
      const ids = await s.troisInactifs()
      s.panneApres(0)
      await s.ouvrirTableau()
      assert.equal(s.appels.length, 0)
      assert.deepEqual(await s.envois(), [])
      // Panne toujours là : chaque ouverture retente, sans rien envoyer ni laisser de ligne bloquante.
      await s.ouvrirTableau()
      assert.equal(s.appels.length, 0)

      s.reparer()
      await s.ouvrirTableau()
      assert.equal(s.appels.length, 3)
      const n = parClient(await s.envois())
      for (const id of ids) assert.equal(n.get(id), 1)
    } finally {
      await s.app.fermer()
    }
  })

  test('tournée réussie → une 2e ouverture le même jour ne renvoie rien ; le lendemain non plus (déjà relancés)', async () => {
    const s = await demarrer('reussie.db')
    try {
      await s.troisInactifs()
      await s.ouvrirTableau()
      assert.equal(s.appels.length, 3)
      await s.ouvrirTableau()
      await s.ouvrirTableau()
      assert.equal(s.appels.length, 3)
      s.horloge.t = new Date(s.horloge.t.getTime() + JOUR)
      await s.ouvrirTableau()
      assert.equal(s.appels.length, 3)
      assert.equal((await s.envois()).length, 3)
    } finally {
      await s.app.fermer()
    }
  })

  test('deux ouvertures simultanées pendant une tournée lente → une seule tournée, un message par client', async () => {
    const s = await demarrer('concurrence.db', { delai: 30 })
    try {
      const ids = await s.troisInactifs()
      const etat = () => fetchEtat(s)
      await Promise.all([etat(), etat(), etat()])
      await s.app.relancesEnCours()
      assert.equal(s.appels.length, 3)
      const n = parClient(await s.envois())
      for (const id of ids) assert.equal(n.get(id), 1)
    } finally {
      await s.app.fermer()
    }
  })

  test('prestataire en échec (statut « erreur ») : pas une panne de tournée, aucune relance retentée automatiquement', async () => {
    const s = await demarrer('prestataire.db', { statut: 400 })
    try {
      await s.troisInactifs()
      await s.ouvrirTableau()
      assert.equal(s.appels.length, 3)
      assert.deepEqual((await s.envois()).map((e) => e.statut), ['erreur', 'erreur', 'erreur'])
      // Le message a pu partir malgré l'erreur (délai dépassé…) : jamais de renvoi automatique le même jour.
      await s.ouvrirTableau()
      assert.equal(s.appels.length, 3)
    } finally {
      await s.app.fermer()
    }
  })
})

/** GET /etat sans attendre la fin de la tournée (pour lancer plusieurs ouvertures en parallèle). */
async function fetchEtat(s: { app: { serveur: { address(): unknown } } }) {
  const port = (s.app.serveur.address() as AddressInfo).port
  const r = await globalThis.fetch(`http://127.0.0.1:${port}/api/v1/commerces/${AH}/etat`, { headers: PIN })
  assert.equal(r.status, 200)
  await r.arrayBuffer()
}

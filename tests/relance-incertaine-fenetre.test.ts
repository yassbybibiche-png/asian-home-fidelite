// Boucle roue v2 (revue Codex, point P1) — une relance automatique `incertain` (peut-être livrée) n'est jamais renvoyée,
// même quand plus de 50 envois plus récents la sortent de la fenêtre `st.envois(…, 50, client)` lue par la tournée.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { ouvrirStockage } from '../server/stockage.ts'
import { ouvrirStockageSupabase } from '../server/stockage-supabase.ts'
import type { Client, EnvoiRelance, StatutEnvoi } from '../src/types.ts'

const AH = 'c-asian-home-paris'
const SITE = 'https://asian-home-fidelite.onrender.com'
const JOUR = 24 * 3600_000
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-incertain-fenetre-'))
after(() => rmSync(dossier, { recursive: true, force: true }))

async function demarrer(fichierDb: string, horloge: { t: Date }, etat: { appels: number }) {
  const fetch = (async () => {
    etat.appels++
    return new Response(JSON.stringify({ sid: `SM${etat.appels}` }), { status: 201 })
  }) as unknown as typeof globalThis.fetch
  const app = await creerServeur({
    fichierDb,
    adminPin: '98765432',
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
      headers: { 'Content-Type': 'application/json', 'X-Commerce-PIN': '1234' },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    return { statut: r.status, contenu: await r.json() }
  }
  async function ouvrirTableau() {
    assert.equal((await api('GET', `/commerces/${AH}/etat`)).statut, 200)
    await app.relancesEnCours()
  }
  return { app, api, ouvrirTableau }
}

const envoi = (client: Client, modele: EnvoiRelance['modele'], statut: StatutEnvoi, date: Date): EnvoiRelance => ({
  id: crypto.randomUUID(),
  commerceId: AH,
  clientId: client.id,
  clientPrenom: client.prenom,
  date: date.toISOString(),
  jour: date.toISOString().slice(0, 10),
  modele,
  canal: 'sms',
  statut,
  declencheur: modele === 'libre' ? 'manuel' : 'auto',
  auteur: modele === 'libre' ? 'Gérant' : 'Automatique',
})

/**
 * Client consentant ; `modele` : relance automatique visée (seule règle activée). Une ancienne tentative de ce modèle
 * (`statutAncien`) puis 60 tentatives manuelles plus récentes (statut `test` : hors index anti-doublon).
 */
async function scenario(nom: string, modele: 'inactif' | 'anniversaire', statutAncien: StatutEnvoi) {
  const fichierDb = join(dossier, `${nom}.db`)
  const horloge = { t: new Date('2026-11-10T15:00:00Z') }
  const etat = { appels: 0 }
  const s = await demarrer(fichierDb, horloge, etat)
  try {
    const cree = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Ines', contact: '0611111111', consentementRelance: true })).contenu.client as Client
    const visite = new Date(horloge.t.getTime() - (modele === 'inactif' ? 40 : 2) * JOUR).toISOString()
    const st = ouvrirStockage(fichierDb)
    const client: Client = { ...st.client(AH, cree.id)!, derniereVisite: visite, visites: [visite], tampons: 1, ...(modele === 'anniversaire' ? { anniversaire: '11-10' } : {}) }
    st.majClient(client)
    // Ancienne tentative : ce matin pour `incertain`, la veille sinon (un `erreur` du jour bloque déjà via
    // `echecAutoDuJour`, un `envoye` du jour via l'index anti-doublon : le test ne mordrait pas sur la fenêtre).
    const ancienne = statutAncien === 'incertain' ? new Date('2026-11-10T08:00:00Z') : new Date('2026-11-09T08:00:00Z')
    st.ajouterEnvoi(envoi(client, modele, statutAncien, ancienne))
    for (let i = 1; i <= 60; i++) st.ajouterEnvoi(envoi(client, 'libre', 'test', new Date(Date.parse('2026-11-10T09:00:00Z') + i * 60_000)))
    const fenetre = st.envois(AH, 50, client.id)
    assert.equal(fenetre.length, 50)
    assert.ok(!fenetre.some((e) => e.modele === modele), 'la tentative ancienne est hors de la fenêtre des 50')
    st.fermer()

    await s.api('PATCH', `/commerces/${AH}`, { relancesAuto: { inactif: modele === 'inactif', anniversaire: modele === 'anniversaire' } })
    await s.ouvrirTableau()
    return etat.appels
  } finally {
    await s.app.fermer()
  }
}

describe('Revue Codex P1 — relance `incertain` hors de la fenêtre des 50 derniers envois', () => {
  test('inactif `incertain` suivi de 60 envois plus récents → aucun renvoi automatique', async () => {
    assert.equal(await scenario('inactif-incertain', 'inactif', 'incertain'), 0)
  })

  test('anniversaire `incertain` suivi de 60 envois plus récents → aucun renvoi automatique', async () => {
    assert.equal(await scenario('anniversaire-incertain', 'anniversaire', 'incertain'), 0)
  })

  test('inactif `envoye` hors fenêtre → toujours bloquant', async () => {
    assert.equal(await scenario('inactif-envoye', 'inactif', 'envoye'), 0)
  })

  test('contre-épreuve : un refus confirmé (`erreur`) de la veille hors fenêtre n’empêche pas la relance', async () => {
    assert.equal(await scenario('inactif-erreur', 'inactif', 'erreur'), 1)
    assert.equal(await scenario('anniversaire-erreur', 'anniversaire', 'erreur'), 1)
  })

  test('Supabase : `envoisDuModele` filtre commerce + client + colonne `modele` et lit toutes les pages, sans plafond', async () => {
    const urls: URL[] = []
    const f = (async (entree: string | URL | Request) => {
      const url = new URL(entree instanceof Request ? entree.url : String(entree))
      urls.push(url)
      const debut = Number(url.searchParams.get('offset') ?? 0)
      const n = debut === 0 ? 1000 : 3
      const lignes = Array.from({ length: n }, (_, i) => ({ donnees: { id: `e${debut + i}`, modele: 'inactif', statut: 'incertain' } }))
      return new Response(JSON.stringify(lignes), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as unknown as typeof fetch
    const st = ouvrirStockageSupabase({ url: 'https://faux.supabase.co', cleServiceRole: 'cle', fetch: f })
    const lus = await st.envoisDuModele(AH, 'k1', 'inactif')
    assert.equal(lus.length, 1003)
    assert.equal(urls.length, 2)
    for (const u of urls) {
      assert.match(u.pathname, /\/envois$/)
      assert.equal(u.searchParams.get('commerce_id'), `eq.${AH}`)
      assert.equal(u.searchParams.get('client_id'), 'eq.k1')
      assert.equal(u.searchParams.get('modele'), 'eq.inactif')
    }
    assert.deepEqual(urls.map((u) => u.searchParams.get('offset') ?? '0'), ['0', '1000'])
  })
})

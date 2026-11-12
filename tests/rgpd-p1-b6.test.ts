// P1-B6 — RGPD : export individuel, suppression d'un client (cascade), purge de conservation (avertissement, exclusion,
// journal), page de confidentialité. Serveur réel (SQLite temporaire, horloge injectée) ; Supabase : supabase.test.ts.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AddressInfo } from 'node:net'

import { creerServeur, type OptionsServeur } from '../server/app.ts'
import { nouveauClient } from '../src/lib/fidelite.ts'
import { nouveauCommerce } from '../src/data/defaults.ts'
import seed from '../src/data/seed.json' with { type: 'json' }
import {
  ajouterMois,
  CONSERVATION_DEFAUT_MOIS,
  datePurge,
  dureeConservationMois,
  estPurgeable,
  exportClientCsv,
  HEBERGEMENT_BASE,
  HEBERGEMENT_SERVEUR,
  libelleDuree,
  listePurge,
  politiqueConfidentialite,
  protectionPurge,
} from '../src/lib/rgpd.ts'
import { MENTIONS_RGPD } from '../src/lib/integrations.ts'
import { commercePublic } from '../src/lib/vuePublique.ts'
import { lireRoute, PAGES_PUBLIQUES } from '../src/router.ts'
import type { Client, Commerce, EntreeJournal } from '../src/types.ts'

const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const JOUR = 24 * 3600_000
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p1-b6-'))
after(() => rmSync(dossier, { recursive: true, force: true }))
const source = (f: string) => readFileSync(join(import.meta.dirname, '..', f), 'utf8')

// ---------- Logique pure (src/lib/rgpd.ts) ----------

describe('Durée de conservation et liste de purge (fonctions pures)', () => {
  const commerce = nouveauCommerce('Chez Lin', 'restaurant', '')
  const t = new Date('2026-11-10T12:00:00Z')
  const client = (o: Partial<Client>): Client => ({ ...nouveauClient(commerce.id, 'Linh', { telephone: '0612345678' }, new Date('2020-01-01T12:00:00Z')), ...o })

  test('défaut 3 ans (36 mois), bornes 6–120, libellés', () => {
    assert.equal(CONSERVATION_DEFAUT_MOIS, 36)
    assert.equal(dureeConservationMois({}), 36)
    assert.equal(dureeConservationMois({ conservationMois: 24 }), 24)
    for (const faux of [0, 5, 121, 12.5]) assert.equal(dureeConservationMois({ conservationMois: faux }), 36)
    assert.equal(libelleDuree(36), '3 ans')
    assert.equal(libelleDuree(12), '1 an')
    assert.equal(libelleDuree(18), '18 mois')
    assert.equal(ajouterMois('2026-01-31T10:00:00.000Z', 1).toISOString(), '2026-02-28T10:00:00.000Z')
  })

  test('date de purge = dernière visite (à défaut inscription) + durée', () => {
    assert.equal(datePurge(client({ derniereVisite: '2023-06-15T12:00:00.000Z' }), 36).toISOString(), '2026-06-15T12:00:00.000Z')
    assert.equal(datePurge(client({ derniereVisite: null }), 36).toISOString(), '2023-01-01T12:00:00.000Z')
  })

  test('due / bientôt (30 jours) / hors liste ; protections : exclusion, récompense en attente, réserve, rattrapage en attente', () => {
    const due = client({ id: 'due', derniereVisite: '2023-01-01T12:00:00.000Z' })
    const bientot = client({ id: 'bientot', derniereVisite: '2023-11-25T12:00:00.000Z' })
    const actif = client({ id: 'actif', derniereVisite: '2026-10-01T12:00:00.000Z' })
    const exclu = client({ id: 'exclu', derniereVisite: '2022-01-01T12:00:00.000Z', exclusPurge: true })
    const recompense = client({ id: 'recompense', recompensesEnAttente: [{ id: 'r1', libelle: 'Boisson', origine: 'palier', creeLe: '2022-01-01T00:00:00.000Z' }] })
    const reserve = client({ id: 'reserve', reserve: { gagneLe: '2026-11-01T00:00:00.000Z', expireLe: '2026-12-01T00:00:00.000Z' } })
    const litige = client({ id: 'litige', demandesRattrapage: [{ id: 'd', date: '2022-01-01T00:00:00.000Z', montantCentimes: 100, statut: 'en_attente', creeLe: '2022-01-02T00:00:00.000Z' }] })
    const liste = listePurge([actif, bientot, due, exclu, recompense, reserve, litige], commerce, t)
    assert.deepEqual(
      Object.fromEntries(liste.map((c) => [c.id, [c.statut, !!c.protection]])),
      { recompense: ['due', true], reserve: ['due', true], litige: ['due', true], exclu: ['due', true], due: ['due', false], bientot: ['bientot', false] },
    )
    assert.deepEqual(liste.map((c) => c.purgeLe), liste.map((c) => c.purgeLe).sort(), 'la plus ancienne date de purge d’abord')
    assert.ok(!liste.some((c) => c.id === 'actif'))
    assert.ok(estPurgeable(due, commerce, t))
    for (const c of [bientot, actif, exclu, recompense, reserve, litige]) assert.ok(!estPurgeable(c, commerce, t), c.id)
    assert.match(protectionPurge(exclu, t)!, /Exclu/)
    // Récompense expirée : ne protège plus.
    assert.equal(protectionPurge(client({ recompensesEnAttente: [{ id: 'r', libelle: 'x', origine: 'anniversaire', creeLe: '2022-01-01T00:00:00.000Z', expireLe: '2022-02-01T00:00:00.000Z' }] }), t), undefined)
    // Durée personnalisée : 12 mois → le client « actif » d'il y a 13 mois devient purgeable.
    assert.ok(estPurgeable(client({ derniereVisite: '2025-10-01T12:00:00.000Z' }), { conservationMois: 12 }, t))
    assert.ok(!estPurgeable(client({ derniereVisite: '2025-10-01T12:00:00.000Z' }), {}, t))
  })
})

describe('Export individuel (CSV)', () => {
  test('les données de ce client seulement, jamais de données techniques ni l’identifiant d’un autre client', () => {
    const c: Client = {
      ...nouveauClient('c-x', 'Linh', { telephone: '0612345678' }, new Date('2026-01-01T12:00:00Z')),
      id: 'cl-linh',
      email: undefined,
      tampons: 3,
      points: 42,
      visites: ['2026-02-01T12:00:00.000Z'],
      derniereVisite: '2026-02-01T12:00:00.000Z',
      parrainId: 'cl-parrain-secret',
      consentementRelance: true,
      consentementRelanceLe: '2026-01-01T12:00:00.000Z',
      consentementRelanceOrigine: 'inscription',
      actionsTraitees: ['action-technique-123'],
      clesMessages: ['cle-technique'],
      anniversaire: '03-21',
      messages: [{ id: 'm', type: 'commercant', texte: 'Bonjour Linh', date: '2026-02-02T12:00:00.000Z' }],
    }
    const csv = exportClientCsv(
      c,
      [
        { id: 't1', commerceId: 'c-x', clientId: 'cl-linh', lot: 'Boisson offerte', date: '2026-02-01T13:00:00.000Z', code: 'ABC234' },
        { id: 't2', commerceId: 'c-x', clientId: 'cl-autre', lot: 'Lot d’un autre', date: '2026-02-01T13:00:00.000Z' },
      ],
      [],
    )
    assert.ok(csv.startsWith('﻿rubrique;date;libelle;valeur\r\n'))
    // Revue Codex R3 (F1, modèle du 12/11) : plus jamais le code brut dans l'export — il ne circule que par l'activation ;
    // le statut du gain le remplace (ici un tirage d'avant la roue v2, valable le jour même seulement : expiré).
    for (const attendu of ['Linh', '0612345678', 'Tampons;3', 'Points;42', 'Visite validée', 'Boisson offerte (gain expiré)', 'Relances SMS / e-mail;oui', 'Bonjour Linh', '03-21']) assert.ok(csv.includes(attendu), attendu)
    for (const interdit of ['cl-parrain-secret', 'action-technique-123', 'cle-technique', 'Lot d’un autre', 'cl-autre', 'ABC234']) assert.ok(!csv.includes(interdit), interdit)
  })
})

// ---------- Serveur ----------

async function demarrer(nom: string, options: Partial<OptionsServeur> = {}) {
  const horloge = { t: new Date('2023-01-10T12:00:00Z') }
  const fichierDb = join(dossier, nom)
  const app = await creerServeur({
    fichierDb,
    adminPin: ADMIN,
    pinInitial: '1234',
    version: 'test',
    maintenant: () => horloge.t,
    limitesPubliques: { inscriptionParIp: 1000, inscriptionParContact: 1000, ficheClientParIp: 1000, lectureParIp: 1000, lectureParCarte: 1000, tirageParIp: 1000, tirageParContact: 1000 },
    ...options,
  })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(`${racine}/api/v1${chemin}`, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    const type = r.headers.get('content-type') ?? ''
    return { statut: r.status, type, entetes: r.headers, contenu: type.includes('json') ? await r.json() : await r.text() }
  }
  /** Lecture directe de la base SQLite (tables sans méthode de lecture : parrainages, demandes_rattrapage…). */
  function compter(table: string, filtre = '1 = 1', ...args: string[]): number {
    const db = new DatabaseSync(fichierDb)
    try {
      return Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${filtre}`).get(...args) as { n: number }).n)
    } finally {
      db.close()
    }
  }
  return { app, api, horloge, compter }
}

type Serveur = Awaited<ReturnType<typeof demarrer>>

async function inscrire(s: Serveur, prenom: string, contact: string, parrain?: string): Promise<Client> {
  const r = await s.api('POST', `/commerces/${AH}/clients`, { prenom, contact, ...(parrain ? { parrain } : {}) }, PIN)
  assert.ok(r.statut === 201 || r.statut === 200, JSON.stringify(r.contenu))
  return r.contenu.client
}
const visite = async (s: Serveur, id: string) => assert.equal((await s.api('POST', `/commerces/${AH}/clients/${id}/visite`, undefined, PIN)).statut, 200)
const journal = async (s: Serveur): Promise<EntreeJournal[]> => (await s.api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.journal

describe('Suppression d’un client : cascade définie', async () => {
  const s = await demarrer('suppression.db')
  after(() => s.app.fermer())

  test('client + tirages + journal + parrainages (parrain et filleul) + rattrapages + messages + relances supprimés ; autres clients intacts', async () => {
    await s.api('PATCH', `/commerces/${AH}`, { programme: { rattrapage: { actif: true }, parrainage: { actif: true } } }, PIN)
    const bob = await inscrire(s, 'Bob', '0611111111')
    const alice = await inscrire(s, 'Alice', 'alice@exemple.fr', bob.codeParrainage)
    const zoe = await inscrire(s, 'Zoé', '0633333333', bob.codeParrainage)
    const autre = await inscrire(s, 'Autre', '0622222222')
    // Visites (journal), 1re visite d'Alice = parrainage réglé (trace parrain + filleul), tirage du jour.
    await visite(s, bob.id)
    await visite(s, alice.id)
    await visite(s, autre.id)
    assert.equal((await s.api('POST', `/commerces/${AH}/tirages`, { contact: '0611111111' })).statut, 201)
    assert.equal((await s.api('POST', `/commerces/${AH}/tirages`, { contact: '0622222222' })).statut, 201)
    // Rattrapage (demande du client, trace 0004), message du commerce, relance tentée (501, tracée dans `envois`).
    s.horloge.t = new Date(s.horloge.t.getTime() + 2 * JOUR)
    const r = await s.api('POST', `/commerces/${AH}/clients/${bob.id}/rattrapage`, { date: new Date(s.horloge.t.getTime() - JOUR).toISOString(), montantCentimes: 1500 })
    assert.equal(r.statut, 201, JSON.stringify(r.contenu))
    assert.equal((await s.api('POST', `/commerces/${AH}/messages`, { cible: 'tous', texte: 'Bonjour à tous' }, PIN)).statut, 200)
    await s.api('PATCH', `/commerces/${AH}/clients/${bob.id}`, { consentementRelance: true }, PIN)
    assert.equal((await s.api('POST', `/commerces/${AH}/clients/${bob.id}/relance`, { modele: 'inactif' }, PIN)).statut, 501)

    const avant = {
      tirages: s.compter('tirages', 'client_id = ?', bob.id),
      journal: s.compter('journal', "json_extract(donnees, '$.clientId') = ?", bob.id),
      parrainages: s.compter('parrainages', 'parrain_id = ? OR filleul_id = ?', bob.id, bob.id),
      rattrapages: s.compter('demandes_rattrapage', 'client_id = ?', bob.id),
      envois: s.compter('envois', 'client_id = ?', bob.id),
    }
    for (const [k, n] of Object.entries(avant)) assert.ok(n > 0, `données de départ : ${k}`)
    const autreAvant = { tirages: s.compter('tirages', 'client_id = ?', autre.id), journal: s.compter('journal', "json_extract(donnees, '$.clientId') = ?", autre.id) }

    // Sans confirmation → 400, rien n'est supprimé.
    assert.equal((await s.api('DELETE', `/commerces/${AH}/clients/${bob.id}`, {}, PIN)).statut, 400)
    assert.equal(s.compter('clients', 'id = ?', bob.id), 1)

    const sup = await s.api('DELETE', `/commerces/${AH}/clients/${bob.id}`, { confirmation: 'SUPPRIMER' }, PIN)
    assert.equal(sup.statut, 200, JSON.stringify(sup.contenu))
    assert.deepEqual(sup.contenu.bilan, { ...avant, client: true })

    assert.equal(s.compter('clients', 'id = ?', bob.id), 0)
    assert.equal(s.compter('tirages', 'client_id = ?', bob.id), 0)
    assert.equal(s.compter('journal', "json_extract(donnees, '$.clientId') = ?", bob.id), 0)
    assert.equal(s.compter('parrainages', 'parrain_id = ? OR filleul_id = ?', bob.id, bob.id), 0)
    assert.equal(s.compter('demandes_rattrapage', 'client_id = ?', bob.id), 0)
    assert.equal(s.compter('envois', 'client_id = ?', bob.id), 0)
    // Messages : rangés dans la ligne du client → partis avec elle ; plus aucun dans la messagerie du gérant.
    const messages = (await s.api('GET', `/commerces/${AH}/messages`, undefined, PIN)).contenu.messages as { clientId: string }[]
    assert.ok(!messages.some((x) => x.clientId === bob.id))
    assert.ok(messages.some((x) => x.clientId === autre.id))

    // Autres clients intacts ; les filleuls ne pointent plus vers la carte supprimée.
    assert.equal(s.compter('tirages', 'client_id = ?', autre.id), autreAvant.tirages)
    assert.equal(s.compter('journal', "json_extract(donnees, '$.clientId') = ?", autre.id), autreAvant.journal)
    const etat = (await s.api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu
    assert.deepEqual(etat.clients.map((c: Client) => c.id).sort(), [alice.id, autre.id, zoe.id].sort())
    for (const c of etat.clients as Client[]) assert.notEqual(c.parrainId, bob.id)
    assert.equal(etat.clients.find((c: Client) => c.id === alice.id).visites.length, 1, 'visite et points d’Alice conservés')

    // Export global sans le client ; carte → 404 ; le contact ne retrouve plus rien (une nouvelle inscription crée une NOUVELLE carte).
    const csv = (await s.api('GET', `/commerces/${AH}/export.csv`, undefined, PIN)).contenu as string
    assert.ok(!csv.includes('Bob') && !csv.includes('0611111111'))
    assert.ok(csv.includes('Autre'))
    assert.equal((await s.api('GET', `/cartes/${bob.id}`)).statut, 404)
    const tirage = await s.api('POST', `/commerces/${AH}/tirages`, { contact: '0611111111' })
    assert.equal(tirage.statut, 409, 'nouvelle carte vierge : aucune visite du jour, pas de jeu')
    const nouveau = (await s.api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.clients.find((c: Client) => c.telephone === '0611111111')
    assert.ok(nouveau && nouveau.id !== bob.id && nouveau.visites.length === 0 && !nouveau.prenom)

    // Suppression journalisée sans prénom ni contact ni identifiant.
    const trace = (await journal(s)).find((e) => e.action === 'rgpd' && /Client supprimé/.test(e.details))!
    assert.ok(trace, 'suppression journalisée')
    assert.equal(trace.auteur.nom, 'Gérant')
    assert.equal(trace.clientId, undefined)
    assert.doesNotMatch(JSON.stringify(trace), /Bob|0611111111|alice|Alice/)
    assert.match(trace.details, /décision du commerce/)
  })

  test('auth : sans PIN 401, session équipe / code équipe refusés ; client inconnu 404', async () => {
    const c = await inscrire(s, 'Cible', '0644444444')
    assert.equal((await s.api('DELETE', `/commerces/${AH}/clients/${c.id}`, { confirmation: 'SUPPRIMER' })).statut, 401)
    assert.equal((await s.api('DELETE', `/commerces/${AH}/clients/${c.id}`, { confirmation: 'SUPPRIMER' }, { 'X-Commerce-PIN': '0000' })).statut, 401)
    await s.api('POST', `/commerces/${AH}/equipe`, { nom: 'Kim', code: '4321' }, PIN)
    assert.equal((await s.api('DELETE', `/commerces/${AH}/clients/${c.id}`, { confirmation: 'SUPPRIMER' }, { 'X-Equipe-Code': '4321' })).statut, 401)
    assert.equal(s.compter('clients', 'id = ?', c.id), 1)
    assert.equal((await s.api('DELETE', `/commerces/${AH}/clients/cl-inconnu`, { confirmation: 'SUPPRIMER' }, PIN)).statut, 404)
  })
})

describe('Demande du client depuis sa carte : export et suppression', async () => {
  const s = await demarrer('carte.db')
  after(() => s.app.fermer())

  test('export : CSV de SES données avec le bon contact ; 403 avec un autre contact ; 404 carte inconnue', async () => {
    const lina = await inscrire(s, 'Lina', '06 55 55 55 55')
    const autre = await inscrire(s, 'Autre', '0666666666')
    await visite(s, lina.id)
    await visite(s, autre.id)
    assert.equal((await s.api('POST', `/cartes/${lina.id}/donnees`, { contact: '0666666666' })).statut, 403)
    assert.equal((await s.api('POST', `/cartes/${lina.id}/donnees`, {})).statut, 403)
    assert.equal((await s.api('POST', `/cartes/cl-inconnu/donnees`, { contact: '0655555555' })).statut, 404)
    const r = await s.api('POST', `/cartes/${lina.id}/donnees`, { contact: '+33 6 55 55 55 55' })
    assert.equal(r.statut, 200)
    assert.match(r.type, /text\/csv/)
    assert.match(r.entetes.get('content-disposition') ?? '', new RegExp(`donnees-${lina.id}\\.csv`))
    assert.ok(r.contenu.includes('Lina') && r.contenu.includes('Visite validée'))
    assert.ok(!r.contenu.includes('Autre') && !r.contenu.includes('0666666666') && !r.contenu.includes(autre.id))
  })

  test('export commerçant : CSV individuel limité au client, refusé sans PIN', async () => {
    const etat = (await s.api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu
    const lina = etat.clients.find((c: Client) => c.prenom === 'Lina')
    assert.equal((await s.api('GET', `/commerces/${AH}/clients/${lina.id}/export.csv`)).statut, 401)
    const r = await s.api('GET', `/commerces/${AH}/clients/${lina.id}/export.csv`, undefined, PIN)
    assert.equal(r.statut, 200)
    assert.ok(r.contenu.includes('Lina') && r.contenu.includes('06 55 55 55 55'))
    assert.ok(!r.contenu.includes('Autre') && !r.contenu.includes('0666666666'))
    assert.doesNotMatch(r.contenu, /scrypt\$|pin_hash|pin_sel|code_hash/)
  })

  test('demande de suppression : enregistrée (date), journalisée, visible du commerçant ; la carte reste jusqu’à la suppression', async () => {
    const etat = (await s.api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu
    const lina = etat.clients.find((c: Client) => c.prenom === 'Lina')
    assert.equal((await s.api('POST', `/cartes/${lina.id}/suppression`, { contact: '0600000000' })).statut, 403)
    const r = await s.api('POST', `/cartes/${lina.id}/suppression`, { contact: '0655555555' })
    assert.equal(r.statut, 200)
    assert.equal(r.contenu.demandeSuppressionLe, s.horloge.t.toISOString())
    assert.equal((await s.api('GET', `/cartes/${lina.id}`)).contenu.client.demandeSuppressionLe, s.horloge.t.toISOString())
    const apres = (await s.api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu
    assert.ok(apres.clients.find((c: Client) => c.id === lina.id).demandeSuppressionLe)
    assert.ok(apres.journal.some((e: EntreeJournal) => e.action === 'rgpd' && /Demande de suppression/.test(e.details) && e.auteur.type === 'client'))
    // Le commerçant exécute : motif « à la demande du client ».
    assert.equal((await s.api('DELETE', `/commerces/${AH}/clients/${lina.id}`, { confirmation: 'SUPPRIMER' }, PIN)).statut, 200)
    assert.ok((await journal(s)).some((e) => e.action === 'rgpd' && /Client supprimé \(à la demande du client\)/.test(e.details)))
    assert.equal((await s.api('POST', `/cartes/${lina.id}/donnees`, { contact: '0655555555' })).statut, 404)
  })
})

describe('Purge de conservation : avertissement, exécution, exclusion, journal', async () => {
  const s = await demarrer('purge.db')
  after(() => s.app.fermer())

  test('inactif > durée → listé (date) puis purgé ; actif / récent conservés ; exclu conservé ; durée personnalisée ; journal', async () => {
    // 10/01/2023 : inscriptions + 1 visite.
    const vieux = await inscrire(s, 'Vieux', '0610000001')
    const exclu = await inscrire(s, 'Exclu', '0610000002')
    const litige = await inscrire(s, 'Litige', '0610000003')
    const actif = await inscrire(s, 'Actif', '0610000005')
    for (const c of [vieux, exclu, litige, actif]) await visite(s, c.id)
    // 01/06/2024 : un client inscrit plus tard.
    s.horloge.t = new Date('2024-06-01T12:00:00Z')
    const recent = await inscrire(s, 'Recent', '0610000004')
    await visite(s, recent.id)
    // 01/12/2025 : « Actif » revient.
    s.horloge.t = new Date('2025-12-01T12:00:00Z')
    await visite(s, actif.id)

    // 20/01/2026 : les clients de janvier 2023 ont dépassé 3 ans (purge prévue le 10/01/2026).
    s.horloge.t = new Date('2026-01-20T12:00:00Z')
    assert.equal((await s.api('PATCH', `/commerces/${AH}/clients/${exclu.id}`, { exclusPurge: true }, PIN)).statut, 200)
    assert.ok((await journal(s)).some((e) => e.action === 'rgpd' && /exclu de la purge/.test(e.details)))
    // Litige ouvert : visite oubliée du 15/01 signalée, pas encore décidée.
    const rt = await s.api('POST', `/commerces/${AH}/clients/${litige.id}/rattrapage`, { date: '2026-01-15T12:00:00.000Z', montantCentimes: 1200 })
    assert.equal(rt.statut, 201, JSON.stringify(rt.contenu))
    const avertissement = await s.api('GET', `/commerces/${AH}/purge`, undefined, PIN)
    assert.equal(avertissement.statut, 200)
    assert.equal(avertissement.contenu.conservationMois, 36)
    const liste = avertissement.contenu.clients as { id: string; statut: string; purgeLe: string; protection?: string }[]
    const parId = Object.fromEntries(liste.map((c) => [c.id, c]))
    assert.equal(parId[vieux.id].statut, 'due')
    assert.equal(parId[vieux.id].purgeLe, '2026-01-10T12:00:00.000Z')
    assert.equal(parId[vieux.id].protection, undefined)
    assert.match(parId[exclu.id].protection!, /Exclu/)
    assert.match(parId[litige.id].protection!, /Visite oubliée en attente/)
    assert.equal(parId[actif.id], undefined)
    assert.equal(parId[recent.id], undefined)

    // Exécution : seuls les purgeables (revérifiés) partent ; l'exclu et l'actif envoyés quand même sont ignorés.
    const r = await s.api('POST', `/commerces/${AH}/purge`, { clientIds: [vieux.id, exclu.id, litige.id, actif.id] }, PIN)
    assert.equal(r.statut, 200, JSON.stringify(r.contenu))
    assert.deepEqual(r.contenu.clientsSupprimes, [vieux.id])
    assert.equal(r.contenu.ignores, 3)
    const restants = ((await s.api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.clients as Client[]).map((c) => c.id)
    assert.deepEqual(restants.sort(), [exclu.id, litige.id, recent.id, actif.id].sort())
    assert.equal(s.compter('journal', "json_extract(donnees, '$.clientId') = ?", vieux.id), 0)
    const trace = (await journal(s)).find((e) => /Purge de conservation/.test(e.details))!
    assert.ok(trace, 'purge journalisée')
    assert.equal(trace.auteur.nom, 'Gérant')
    assert.match(trace.details, /3 ans sans visite\) : 1 client\(s\) supprimé\(s\)/)
    assert.equal(trace.date, s.horloge.t.toISOString())
    assert.doesNotMatch(trace.details, /Vieux/)

    // Durée personnalisée : 18 mois → le client de juin 2024 devient purgeable en décembre 2025 (déjà passé).
    assert.equal((await s.api('PATCH', `/commerces/${AH}`, { conservationMois: 18 }, PIN)).statut, 200)
    const liste18 = (await s.api('GET', `/commerces/${AH}/purge`, undefined, PIN)).contenu
    assert.equal(liste18.conservationMois, 18)
    assert.ok(liste18.clients.some((c: { id: string; statut: string }) => c.id === recent.id && c.statut === 'due'))
    // Ré-inclure l'exclu : il redevient purgeable.
    await s.api('PATCH', `/commerces/${AH}/clients/${exclu.id}`, { exclusPurge: false }, PIN)
    const r2 = await s.api('POST', `/commerces/${AH}/purge`, { clientIds: [recent.id, exclu.id] }, PIN)
    assert.deepEqual(r2.contenu.clientsSupprimes.sort(), [recent.id, exclu.id].sort())
    assert.deepEqual(((await s.api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.clients as Client[]).map((c) => c.id).sort(), [litige.id, actif.id].sort())
  })

  test('réglage validé (6–120 mois) ; purge refusée sans PIN ou sans liste ; aucune purge à l’ouverture de l’état', async () => {
    for (const faux of [5, 121, '36', 12.5]) assert.equal((await s.api('PATCH', `/commerces/${AH}`, { conservationMois: faux }, PIN)).statut, 400, String(faux))
    assert.equal((await s.api('GET', `/commerces/${AH}/purge`)).statut, 401)
    assert.equal((await s.api('POST', `/commerces/${AH}/purge`, { clientIds: ['x'] })).statut, 401)
    assert.equal((await s.api('POST', `/commerces/${AH}/purge`, {}, PIN)).statut, 400)
    assert.equal((await s.api('POST', `/commerces/${AH}/purge`, { clientIds: [] }, PIN)).statut, 400)
    // Très loin dans le futur : l'ouverture du tableau de bord ne supprime rien toute seule.
    s.horloge.t = new Date('2040-01-01T12:00:00Z')
    const n = s.compter('clients')
    await s.api('GET', `/commerces/${AH}/etat`, undefined, PIN)
    assert.equal(s.compter('clients'), n)
  })
})

describe('Non-régression : 1 tirage par jour après visite validée', async () => {
  const s = await demarrer('tirage.db')
  after(() => s.app.fermer())
  test('sans visite 409, après visite 201, 2e tirage du jour 409', async () => {
    const c = await inscrire(s, 'Joueur', '0677777777')
    assert.equal((await s.api('POST', `/commerces/${AH}/tirages`, { contact: '0677777777' })).statut, 409)
    await visite(s, c.id)
    assert.equal((await s.api('POST', `/commerces/${AH}/tirages`, { contact: '0677777777' })).statut, 201)
    assert.equal((await s.api('POST', `/commerces/${AH}/tirages`, { contact: '0677777777' })).statut, 409)
  })
})

// ---------- Page de confidentialité ----------

describe('Politique de confidentialité', () => {
  const ah = (seed.commerces as unknown as Commerce[])[0]

  test('coordonnées du responsable vérifiées dans le seed', () => {
    assert.match(ah.coordonnees!, /11 rue André Joineau, 93310 Le Pré-Saint-Gervais/)
    assert.match(ah.coordonnees!, /07 82 97 48 01/)
  })

  test('mentions obligatoires : données, finalité, aucune revente, conservation, droits, hébergement, responsable', () => {
    const texte = politiqueConfidentialite(commercePublic(ah), { sms: false, email: false })
      .map((s) => `${s.titre}\n${s.lignes.join('\n')}`)
      .join('\n')
    for (const motif of [
      /Responsable du traitement/,
      /Asian Home Paris — 11 rue André Joineau/,
      /prénom/,
      /téléphone et \/ ou votre e-mail/,
      /tampons/,
      /historique de vos visites/,
      /anniversaire/,
      /Finalité/,
      /uniquement avec votre consentement/,
      /Aucune revente/,
      /Aucun prestataire d’envoi configuré à ce jour/,
      /conservées 3 ans après votre dernière visite/,
      /Accès, rectification, export \(portabilité\), suppression/,
      /retrait du consentement/,
      /en caisse, ou par message au commerce/i,
      /Render, région Frankfurt/,
      /Supabase — région à confirmer/,
    ])
      assert.match(texte, motif)
    assert.doesNotMatch(texte, /Twilio|Brevo|Google/, 'aucun prestataire nommé tant qu’il n’est pas configuré')
  })

  test('prestataires nommés seulement quand ils sont configurés ; durée configurée reprise', () => {
    const t = (p: Parameters<typeof politiqueConfidentialite>[1], mois?: number) =>
      politiqueConfidentialite({ nom: 'X', conservationMois: mois }, p)
        .flatMap((s) => s.lignes)
        .join(' ')
    assert.match(t({ sms: true }), /Brevo \(envoi des SMS de relance\)/, 'repli : le prestataire choisi (Brevo)')
    assert.match(t({ sms: true, smsPrestataire: 'Brevo' }), /Brevo \(envoi des SMS de relance\)/)
    assert.match(t({ sms: true, smsPrestataire: 'Twilio' }), /Twilio \(envoi des SMS de relance\)/, 'repli Twilio nommé quand c’est lui')
    assert.doesNotMatch(t({ sms: true, smsPrestataire: 'Twilio' }), /Brevo \(envoi des SMS/)
    assert.match(t({ email: true }), /Brevo/)
    assert.match(t({ googleWallet: true }), /Google/)
    assert.match(t(null), /momentanément indisponible/)
    assert.match(t({}, 18), /conservées 18 mois/)
    assert.equal(HEBERGEMENT_SERVEUR.includes('Frankfurt'), true)
    assert.match(HEBERGEMENT_BASE, /à confirmer/)
    assert.match(source('render.yaml'), /region: frankfurt/)
  })

  test('route publique #/confidentialite/<commerceId>, liens depuis l’inscription et le pied de page des pages client', () => {
    assert.ok(PAGES_PUBLIQUES.includes('confidentialite'))
    assert.deepEqual(lireRoute('#/confidentialite/c-asian-home-paris'), { page: 'confidentialite', param: 'c-asian-home-paris' })
    const page = source('src/pages/Confidentialite.tsx')
    assert.match(page, /politiqueConfidentialite\(/)
    assert.match(source('src/App.tsx'), /confidentialite: Confidentialite/)
    // Inscription (formulaire « Pour jouer, dites-nous qui vous êtes ») : lien à côté de la case de consentement.
    const jouer = source('src/pages/Jouer.tsx')
    const identification = jouer.slice(jouer.indexOf('function Identification'), jouer.indexOf('function CodeGagnant'))
    assert.match(identification, /<LienConfidentialite/)
    // Pied de page des pages client (jeu, carte, menu).
    assert.match(source('src/components/ui.tsx'), /export function LienConfidentialite[\s\S]*#\/confidentialite\//)
    for (const f of ['src/pages/Jouer.tsx', 'src/pages/CartePublique.tsx', 'src/pages/MenuPublic.tsx']) assert.match(source(f), /<PiedPublic/, f)
    assert.match(source('src/components/ui.tsx'), /export function PiedPublic[\s\S]*<footer[\s\S]*<LienConfidentialite/)
  })

  test('mentions courtes (Plus, Offre) alignées : 3 ans par défaut, droits, boutons, hébergement', () => {
    const rgpd = MENTIONS_RGPD.join(' ')
    assert.match(rgpd, /3 ans après la dernière visite/)
    assert.match(rgpd, /Recevoir mes données/)
    assert.match(rgpd, /bouton « Supprimer ce client »/)
    assert.match(rgpd, /Render \(Frankfurt/)
    assert.match(rgpd, /Supabase \(région à confirmer/)
    assert.doesNotMatch(rgpd, /pas encore de bouton|à la main dans la base|à préciser/)
  })

  test('écrans : export + suppression (saisie de confirmation) sur la fiche, purge dans Clients, durée dans Réglages, boutons sur la carte', () => {
    const fiche = source('src/pages/FicheClient.tsx')
    assert.match(fiche, /exportClient\(/)
    assert.match(fiche, /supprimerClient\(/)
    assert.match(fiche, /SUPPRIMER/, 'confirmation par saisie')
    assert.match(source('src/pages/Clients.tsx'), /<ConservationDonnees/)
    assert.match(source('src/pages/Reglages.tsx'), /conservationMois/)
    const carte = source('src/pages/CartePublique.tsx')
    assert.match(carte, /Recevoir mes données/)
    assert.match(carte, /Demander la suppression/)
  })
})

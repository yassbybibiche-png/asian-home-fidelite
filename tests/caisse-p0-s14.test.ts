// P0-S14 — Vue caisse minimale (AUDIT.md §7, F-13) : `GET /caisse` ne renvoie plus tous les clients + journal
// à n'importe quel membre de l'équipe. Recherche paginée côté serveur, fiche client à la demande (scan QR / sélection).
// Vrai serveur HTTP + vraie base SQLite temporaire.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, type OptionsServeur } from '../server/app.ts'
import type { Client } from '../src/types.ts'

const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const CODE = { 'X-Equipe-Code': '2468' }
let horloge = new Date(2026, 10, 9, 12, 0)
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-caisse-s14-'))
after(() => rmSync(dossier, { recursive: true, force: true }))

async function demarrer(nom: string, options: Partial<OptionsServeur> = {}) {
  const app = await creerServeur({ fichierDb: join(dossier, nom), adminPin: ADMIN, pinInitial: '1234', version: 'test', maintenant: () => horloge, ...options })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, { method: methode, headers: { 'Content-Type': 'application/json', ...entetes }, body: corps === undefined ? undefined : JSON.stringify(corps) })
    return { statut: r.status, contenu: (r.headers.get('content-type') ?? '').includes('json') ? await r.json() : await r.text() }
  }
  return { app, api }
}

describe('P0-S14 : vue caisse minimale', () => {
  let srv: Awaited<ReturnType<typeof demarrer>>
  let lina: Client
  let helene: Client
  let marc: Client
  const pagines: Client[] = []

  before(async () => {
    srv = await demarrer('caisse-s14.db')
    await srv.api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)
    lina = (await srv.api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '06 12 34 56 78' }, PIN)).contenu.client
    helene = (await srv.api('POST', `/commerces/${AH}/clients`, { prenom: 'Hélène', contact: '06 98 76 54 32' }, PIN)).contenu.client
    marc = (await srv.api('POST', `/commerces/${AH}/clients`, { prenom: 'Marc', contact: 'marc@exemple.fr' }, PIN)).contenu.client
    // Message privé de Lina au restaurant (réservé au gérant, page Avis) : il ne doit jamais sortir en caisse.
    assert.equal((await srv.api('POST', `/commerces/${AH}/clients/${lina.id}/message-prive`, { contact: '06 12 34 56 78', note: 2, texte: 'Un peu froid' })).statut, 201)
    for (let i = 1; i <= 12; i++) {
      pagines.push(
        (await srv.api('POST', `/commerces/${AH}/clients`, { prenom: `Pag${String(i).padStart(2, '0')}`, contact: `06 11 00 00 ${String(i).padStart(2, '0')}` }, PIN)).contenu.client,
      )
    }
  })
  after(() => srv.app.fermer())

  test('ouverture sans recherche : aucun client, commerce minimal, pas de journal', async () => {
    assert.equal((await srv.api('GET', `/commerces/${AH}/caisse`)).statut, 401, 'code équipe exigé')
    const r = await srv.api('GET', `/commerces/${AH}/caisse`, undefined, CODE)
    assert.equal(r.statut, 200)
    assert.deepEqual(Object.keys(r.contenu).sort(), ['auteur', 'clients', 'commerce', 'limite', 'page', 'total'])
    assert.equal(r.contenu.auteur.nom, 'Mai')
    assert.deepEqual(r.contenu.clients, [])
    assert.equal(r.contenu.total, 0)
    assert.equal(r.contenu.page, 1)
    assert.equal(r.contenu.limite, 20)
    // Commerce minimal : ce que le comptoir affiche et calcule, rien d'autre.
    for (const k of ['id', 'nom', 'seuilTampons', 'recompense']) assert.ok(k in r.contenu.commerce, `${k} absent`)
    for (const k of ['lots', 'reglesReponseAuto', 'messagesAuto', 'relancesAuto', 'testsAB', 'conservationMois', 'creeLe', 'lienGoogle', 'coordonnees', 'lienDeliveroo', 'lienUberEats', 'actif', 'demo', 'type']) {
      assert.ok(!(k in r.contenu.commerce), `« ${k} » ne doit pas être servi en caisse`)
    }
    // Aucun contact client ne quitte le serveur à l'ouverture (15 clients en base).
    assert.doesNotMatch(JSON.stringify(r.contenu), /0612345678|0698765432|marc@exemple\.fr/)
  })

  test('messages privés : jamais en caisse (recherche, fiche, passage), toujours au gérant', async () => {
    const recherche = (await srv.api('GET', `/commerces/${AH}/caisse?q=Lina`, undefined, CODE)).contenu.clients[0]
    assert.ok(!('messagesPrives' in recherche), 'la recherche ne sert pas les messages privés')
    const fiche = (await srv.api('GET', `/commerces/${AH}/caisse/clients/${lina.id}`, undefined, CODE)).contenu.client
    assert.ok(!('messagesPrives' in fiche), 'la fiche ne sert pas les messages privés')
    const passage = await srv.api('POST', `/commerces/${AH}/caisse/passage`, { clientId: helene.id, actionId: 'act-s14-mp' }, CODE)
    assert.equal(passage.contenu.client.tampons, 1)
    assert.ok(!('messagesPrives' in passage.contenu.client), 'la réponse d’une action non plus')
    // Le gérant, lui, les voit toujours (page Avis, via GET …/etat) : le retrait est propre à la caisse.
    const etat = (await srv.api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu
    assert.equal(etat.clients.find((c: Client) => c.id === lina.id).messagesPrives?.length, 1)
  })

  test('recherche par prénom : seul le client cherché est renvoyé', async () => {
    const r = await srv.api('GET', `/commerces/${AH}/caisse?q=Lina`, undefined, CODE)
    assert.equal(r.statut, 200)
    assert.equal(r.contenu.total, 1)
    assert.deepEqual(r.contenu.clients.map((c: Client) => c.id), [lina.id])
    assert.equal(r.contenu.clients[0].telephone, '06 12 34 56 78', 'le contact du client cherché est là (il faut le reconnaître)')
    // Les autres clients ne fuient pas dans la réponse.
    assert.doesNotMatch(JSON.stringify(r.contenu), /0698765432|marc@exemple\.fr|Hélène/)
  })

  test('recherche insensible aux accents, par téléphone (+33) et par e-mail', async () => {
    assert.deepEqual((await srv.api('GET', `/commerces/${AH}/caisse?q=helene`, undefined, CODE)).contenu.clients.map((c: Client) => c.id), [helene.id])
    assert.deepEqual((await srv.api('GET', `/commerces/${AH}/caisse?q=${encodeURIComponent('+33 6 98 76 54 32')}`, undefined, CODE)).contenu.clients.map((c: Client) => c.id), [helene.id])
    assert.deepEqual((await srv.api('GET', `/commerces/${AH}/caisse?q=${encodeURIComponent('MARC@EXEMPLE.FR')}`, undefined, CODE)).contenu.clients.map((c: Client) => c.id), [marc.id])
    assert.equal((await srv.api('GET', `/commerces/${AH}/caisse?q=inexistant`, undefined, CODE)).contenu.total, 0)
  })

  test('recherche paginée : 12 correspondants, pages de 5 sans recouvrement ni perte', async () => {
    const page = async (p: number) => (await srv.api('GET', `/commerces/${AH}/caisse?q=pag&limite=5&page=${p}`, undefined, CODE)).contenu
    const p1 = await page(1)
    const p2 = await page(2)
    const p3 = await page(3)
    const p4 = await page(4)
    assert.equal(p1.total, 12)
    assert.deepEqual([p1.clients.length, p2.clients.length, p3.clients.length, p4.clients.length], [5, 5, 2, 0])
    assert.deepEqual([p1.page, p2.page, p3.page], [1, 2, 3])
    const vus = [...p1.clients, ...p2.clients, ...p3.clients].map((c: Client) => c.id)
    assert.equal(new Set(vus).size, 12, 'aucun doublon entre les pages')
    assert.deepEqual(new Set(vus), new Set(pagines.map((c) => c.id)), 'tous les correspondants, rien d’autre')
  })

  test('fiche à la demande : un seul client (scan QR), 404 si inconnu, 401 sans code', async () => {
    assert.equal((await srv.api('GET', `/commerces/${AH}/caisse/clients/${lina.id}`)).statut, 401)
    const r = await srv.api('GET', `/commerces/${AH}/caisse/clients/${lina.id}`, undefined, CODE)
    assert.equal(r.statut, 200)
    assert.equal(r.contenu.client.id, lina.id)
    assert.equal(r.contenu.client.telephone, '06 12 34 56 78')
    for (const k of ['messages', 'clesMessages', 'actionsTraitees']) assert.ok(!(k in r.contenu.client), `« ${k} » ne doit pas être servi en caisse`)
    assert.equal((await srv.api('GET', `/commerces/${AH}/caisse/clients/cl-inconnu`, undefined, CODE)).statut, 404)
  })

  test('paramètres de recherche invalides → 400', async () => {
    for (const qs of ['q=' + 'a'.repeat(81), 'q=lina&page=0', 'q=lina&page=abc', 'q=lina&limite=0', 'q=lina&limite=51', 'q=lina&limite=abc']) {
      assert.equal((await srv.api('GET', `/commerces/${AH}/caisse?${qs}`, undefined, CODE)).statut, 400, qs)
    }
  })

  test('parcours complet : recherche → fiche → passage en caisse', async () => {
    const trouve = (await srv.api('GET', `/commerces/${AH}/caisse?q=Lina`, undefined, CODE)).contenu.clients[0]
    assert.equal(trouve.id, lina.id)
    const fiche = (await srv.api('GET', `/commerces/${AH}/caisse/clients/${lina.id}`, undefined, CODE)).contenu.client
    assert.equal(fiche.id, lina.id)
    const passage = await srv.api('POST', `/commerces/${AH}/caisse/passage`, { clientId: lina.id, actionId: 'act-s14-1' }, CODE)
    assert.equal(passage.statut, 200)
    assert.equal(passage.contenu.client.tampons, 1)
    const relu = (await srv.api('GET', `/commerces/${AH}/caisse?q=Lina`, undefined, CODE)).contenu.clients[0]
    assert.equal(relu.tampons, 1, 'la recherche voit le tampon qui vient d’être ajouté')
  })
})

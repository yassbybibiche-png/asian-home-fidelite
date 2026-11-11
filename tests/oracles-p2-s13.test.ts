// P2-S13 — Oracles d'énumération : les signaux publics sont uniformisés (statut, champ `existant`, message 409).
// Garantie obtenue (revue Codex P2-S13) : RÉDUCTION des signaux, pas fermeture complète — deux résiduels
// documentés restent, inhérents à l'amorçage du jeton en ligne et au mode transition (voir JOURNAL P2-S13) :
// (a) la présence du jeton distingue une création d'une reprise ; (b) en mode transition, la carte renvoyée
// permet de lire `jeu.statut` sans jeton (trou préexistant P0-S7, fermé en mode strict, production).
// - POST /commerces/:id/clients (public) : même statut 201 et même forme `{ client }`, création ou reprise,
//   sans champ `existant` ; le jeton n'est remis qu'à la création.
// - POST /commerces/:id/tirages : UN SEUL message de refus 409, identique sans visite ou déjà joué.
// - 404 vs 409 : carte inconnue → 404, carte existante + mauvais contact → 403 sur les routes RGPD — résiduel
//   documenté (identifiants UUID non énumérables, limites par IP / par carte, journal P2-S15).
// Compromis conservés explicitement (voir JOURNAL P2-S13) :
// - le commerçant (PIN) garde `existant` et 200/201 : il voit déjà tous les clients ;
// - le titulaire voit la raison précise de son refus via `jeu.statut` de GET /cartes/:id (MessageSansVisite /
//   MessageDejaJoue) — le message 409 unique ne fait que rappeler les deux issues possibles ;
// - en mode strict, une réinscription sans preuve reste 409 sans aucune donnée (P0-S7) : le statut 409 lui-même
//   signale alors l'existence, borné par les limites par IP / par contact et le journal P2-S15.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'

const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p2-s13-'))

async function demarrer(nom: string) {
  const horloge = { t: new Date('2023-01-10T12:00:00Z') }
  const app = await creerServeur({
    fichierDb: join(dossier, nom),
    adminPin: '98765432',
    pinInitial: '1234',
    version: 'test',
    secretSession: 'secret-de-test-p2-s13-au-moins-32-caracteres-0123456789',
    maintenant: () => horloge.t,
    limitesPubliques: { inscriptionParIp: 1000, inscriptionParContact: 1000, ficheClientParIp: 1000, lectureParIp: 1000, lectureParCarte: 1000, tirageParIp: 1000, tirageParContact: 1000 },
  })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(`${racine}/api/v1${chemin}`, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    return { statut: r.status, contenu: (await r.json()) as Record<string, any> }
  }
  return { app, api, horloge }
}

describe('P2-S13 : oracles d’énumération', async () => {
  const s = await demarrer('p2-s13.db')
  after(() => {
    s.app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('inscription publique : création et reprise, même statut 201 et même forme, sans `existant` (résiduel : jeton remis à la création seulement)', async () => {
    const creation = await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '06 12 34 56 78' })
    assert.equal(creation.statut, 201)
    assert.equal('existant' in creation.contenu, false)
    assert.equal(typeof creation.contenu.jeton, 'string', 'nouvelle carte : jeton remis (amorçage)')
    const id = creation.contenu.client.id as string

    // Même contact, autre format : reprise — même statut, même forme, même carte, pas de jeton.
    const reprise = await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Autre', contact: '+33 6 12 34 56 78' })
    assert.equal(reprise.statut, 201)
    assert.equal('existant' in reprise.contenu, false)
    // Résiduel documenté (revue Codex P2-S13, point 1) : la présence du jeton distingue création et reprise
    // pour qui observe la réponse — inhérent à l'amorçage en ligne, borné par les limites et le journal P2-S15.
    assert.equal(reprise.contenu.jeton, undefined, 'carte existante : jamais de jeton sans preuve')
    assert.equal(reprise.contenu.expireLe, undefined)
    assert.equal(reprise.contenu.client.id, id)
    assert.equal(reprise.contenu.client.telephone, undefined, 'jamais de contact dans la réponse publique')
    // Mêmes clés que la création, à l'exception du jeton d'amorçage (résiduel documenté, voir ci-dessus) —
    // la comparaison ne porte QUE sur la forme, pas sur une indistinguabilité complète (le jeton distingue).
    assert.deepEqual(
      Object.keys(reprise.contenu).sort(),
      Object.keys(creation.contenu).sort().filter((k) => k !== 'jeton' && k !== 'expireLe'),
    )
    // Un contact vraiment nouveau reste une création (jeton remis) — la reprise ne crée pas de doublon.
    const autre = await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Marc', contact: '06 98 76 54 32' })
    assert.equal(autre.statut, 201)
    assert.equal(typeof autre.contenu.jeton, 'string')
    assert.notEqual(autre.contenu.client.id, id)
    const avant = (await s.api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.clients.length as number
    await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Autre', contact: '06 12 34 56 78' })
    const apres = (await s.api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.clients.length as number
    assert.equal(apres, avant, 'aucun doublon créé par la reprise')
  })

  test('inscription commerçant (PIN) : `existant` et 200/201 conservés — le personnel voit déjà les clients', async () => {
    const creation = await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Nadia', contact: '06 11 22 33 44' }, PIN)
    assert.equal(creation.statut, 201)
    assert.equal(creation.contenu.existant, false)
    const reprise = await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Nadia', contact: '+33611223344' }, PIN)
    assert.equal(reprise.statut, 200)
    assert.equal(reprise.contenu.existant, true)
    assert.equal(reprise.contenu.client.id, creation.contenu.client.id)
  })

  test('tirage : sans visite et déjà joué → même statut 409, même message, octet pour octet', async () => {
    const contact = '06 10 00 00 09'
    const { client } = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: '', contact })).contenu
    const sansVisite = await s.api('POST', `/commerces/${AH}/tirages`, { contact })
    assert.equal(sansVisite.statut, 409)
    assert.equal((await s.api('POST', `/commerces/${AH}/clients/${client.id}/visite`, undefined, PIN)).statut, 200)
    const premier = await s.api('POST', `/commerces/${AH}/tirages`, { contact })
    assert.equal(premier.statut, 201, JSON.stringify(premier.contenu))
    const dejaJoue = await s.api('POST', `/commerces/${AH}/tirages`, { contact })
    assert.equal(dejaJoue.statut, 409)
    // Indistinguable : le même message, qui rappelle les deux issues possibles au client légitime.
    assert.equal(dejaJoue.contenu.erreur, sansVisite.contenu.erreur)
    assert.match(dejaJoue.contenu.erreur, /valider votre visite/)
    assert.match(dejaJoue.contenu.erreur, /déjà tourné la roue/)
    // Le titulaire, lui, voit la raison précise via sa carte (statut du jeu) — l'info produit est conservée là.
    // (En mode transition, cette lecture se fait sans jeton : trou préexistant P0-S7, fermé en mode strict.)
    assert.equal((await s.api('GET', `/cartes/${client.id}`)).contenu.jeu.statut, 'dejaJoue')
  })

  test('double inscription simultanée : 1 seul client, et un seul jeton remis (la création, pas la reprise)', async () => {
    const contact = '06 10 00 00 10'
    const [a, b] = await Promise.all([
      s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact }),
      s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '+33610000010' }),
    ])
    assert.deepEqual([a.statut, b.statut].sort(), [201, 201])
    assert.equal(a.contenu.client.id, b.contenu.client.id)
    assert.equal([a.contenu.jeton, b.contenu.jeton].filter((j) => typeof j === 'string').length, 1, 'un seul jeton, pour la création')
  })

  test('404 vs 409 (résiduel documenté) : carte inconnue → 404, carte existante + mauvais contact → 403', async () => {
    assert.equal((await s.api('GET', `/cartes/cl-inconnu`)).statut, 404)
    assert.equal((await s.api('POST', `/cartes/cl-inconnu/donnees`, { contact: '0655555555' })).statut, 404)
    const { client } = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '06 12 34 56 79' })).contenu
    assert.equal((await s.api('POST', `/cartes/${client.id}/donnees`, { contact: '0655555555' })).statut, 403)
  })
})

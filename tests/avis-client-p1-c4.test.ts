// P1-C4 — Avis Google côté client + message privé au restaurant.
// Ordre : l'invitation n'apparaît qu'APRÈS le jeu (gain ou perte), jamais avant, jamais conditionnée au lot.
// Note basse dans l'app (≤ 3★) → message privé proposé d'abord, lien Google intact juste en dessous.
// Route publique POST /commerces/:id/clients/:clientId/message-prive : validation, identité carte + contact,
// rate limiting, aucune fuite de contact ; message stocké (visible dans #/avis), jamais expédié.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, type LimitesPubliques } from '../server/app.ts'
import seed from '../src/data/seed.json' with { type: 'json' }
import { lienAvisGoogle } from '../src/lib/invitationAvis.ts'
import {
  ajouterMessagePrive,
  MESSAGES_CONSERVES,
  MESSAGES_PAR_JOUR,
  messagesPrivesDuCommerce,
  proposerMessagePrive,
  SEUIL_NOTE_BASSE,
  TEXTE_MAX,
  validerMessagePrive,
} from '../src/lib/messagePrive.ts'
import { nouveauClient } from '../src/lib/fidelite.ts'
import { exportClientCsv } from '../src/lib/rgpd.ts'
import type { Client, MessagePrive } from '../src/types.ts'

const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const LIEN_AH = 'https://search.google.com/local/writereview?placeid=ChIJAV70Kqxt5kcRnhPY0L6yaf0'
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p1-c4-'))
after(() => rmSync(dossier, { recursive: true, force: true }))
const source = (f: string) => readFileSync(join(import.meta.dirname, '..', f), 'utf8')

const message = (creeLe: string, n = 0): MessagePrive => ({ id: `mp-${creeLe}-${n}`, note: 2, texte: `Message ${n}`, creeLe })

// ---------- Logique pure ----------

describe('Note basse → message privé proposé', () => {
  test('proposé à 3★ et moins, jamais à 4★ ni 5★ (la note par défaut est 5★)', () => {
    assert.equal(SEUIL_NOTE_BASSE, 3)
    for (const n of [1, 2, 3]) assert.equal(proposerMessagePrive(n), true, `${n}★`)
    for (const n of [4, 5]) assert.equal(proposerMessagePrive(n), false, `${n}★`)
    assert.equal(proposerMessagePrive(Number.NaN), false)
  })

  test('validation : note entière 1 à 5, texte non vide, borné, caractères de contrôle retirés', () => {
    assert.deepEqual(validerMessagePrive({ note: 2, texte: '  Plat froid.\nService lent.  ' }), { note: 2, texte: 'Plat froid.\nService lent.' })
    assert.deepEqual(validerMessagePrive({ note: 1, texte: 'a\u0000b\u0007c' }), { note: 1, texte: 'abc' })
    for (const note of [0, 6, 2.5, '3', null, undefined]) assert.equal(typeof validerMessagePrive({ note, texte: 'ok' }), 'string', String(note))
    for (const texte of ['', '   ', 42, null, undefined]) assert.equal(typeof validerMessagePrive({ note: 2, texte }), 'string', String(texte))
    assert.equal(typeof validerMessagePrive({ note: 2, texte: 'x'.repeat(TEXTE_MAX) }), 'object')
    assert.equal(typeof validerMessagePrive({ note: 2, texte: 'x'.repeat(TEXTE_MAX + 1) }), 'string')
  })

  test(`au plus ${MESSAGES_PAR_JOUR} par jour et par carte ; ${MESSAGES_CONSERVES} conservés au maximum`, () => {
    const t = new Date('2026-11-10T12:00:00Z')
    let c: Client = nouveauClient(AH, 'Linh', { telephone: '0610000001' })
    for (let i = 0; i < MESSAGES_PAR_JOUR; i++) {
      const r = ajouterMessagePrive(c, message(t.toISOString(), i), t)
      assert.equal(typeof r, 'object')
      c = r as Client
    }
    assert.equal(typeof ajouterMessagePrive(c, message(t.toISOString(), 9), t), 'string', 'refusé au-delà du plafond du jour')
    const lendemain = new Date('2026-11-11T12:00:00Z')
    assert.equal(typeof ajouterMessagePrive(c, message(lendemain.toISOString()), lendemain), 'object', 'de nouveau accepté le lendemain')

    const anciens = Array.from({ length: MESSAGES_CONSERVES }, (_, i) => message(new Date(Date.UTC(2026, 0, i + 1)).toISOString(), i))
    const plein = ajouterMessagePrive({ ...c, messagesPrives: anciens }, message(lendemain.toISOString(), 99), lendemain) as Client
    assert.equal(plein.messagesPrives!.length, MESSAGES_CONSERVES)
    assert.equal(plein.messagesPrives!.at(-1)!.id, `mp-${lendemain.toISOString()}-99`, 'le plus récent est gardé')
    assert.equal(plein.messagesPrives![0].id, anciens[1].id, 'le plus ancien est retiré')
  })

  test('vue commerce : prénom et identifiant de carte, jamais le téléphone ni l’e-mail ; plus récents d’abord', () => {
    const a = { ...nouveauClient(AH, 'Linh', { telephone: '0610000001' }), messagesPrives: [message('2026-11-09T10:00:00Z', 1)] }
    const b = { ...nouveauClient(AH, '', { email: 'x@exemple.fr' }), messagesPrives: [message('2026-11-10T10:00:00Z', 2)] }
    const vue = messagesPrivesDuCommerce([a, b, nouveauClient(AH, 'Sans', { telephone: '0610000009' })])
    assert.deepEqual(
      vue.map((m) => [m.clientId, m.prenom, m.texte]),
      [
        [b.id, '', 'Message 2'],
        [a.id, 'Linh', 'Message 1'],
      ],
    )
    assert.doesNotMatch(JSON.stringify(vue), /0610000001|x@exemple\.fr|telephone|email/)
  })

  test('export RGPD du client : ses messages privés y figurent', () => {
    const c = { ...nouveauClient(AH, 'Linh', { telephone: '0610000001' }), messagesPrives: [{ ...message('2026-11-10T10:00:00Z'), texte: 'Trop salé' }] }
    assert.match(exportClientCsv(c, [], []), /Message privé au restaurant \(2★\);Trop salé/)
  })
})

// ---------- Interface (sources : node --test ne charge pas les .tsx) ----------

describe('Page de jeu : ordre et lien Google', () => {
  const jouer = source('src/pages/Jouer.tsx')
  const invitation = source('src/components/InvitationAvis.tsx')

  test('aucune demande d’avis avant le gain : l’invitation n’existe que dans le bloc après le résultat', () => {
    const appels = [...jouer.matchAll(/<InvitationAvis\b/g)].map((m) => m.index!)
    assert.equal(appels.length, 2, 'modes local et API')
    const blocs = [
      jouer.indexOf("{joueur && (etape === 'resultat' || dejaJoue) && ("),
      jouer.indexOf("{joueur && (etape === 'resultat' || jeu?.statut === 'dejaJoue') && ("),
    ]
    for (const [i, debut] of blocs.entries()) {
      assert.ok(debut > 0, `bloc après résultat ${i}`)
      assert.ok(appels[i] > debut && appels[i] - debut < 120, `invitation ${i} dans le bloc après résultat`)
    }
    // Ni dans l'identification, ni à côté du bouton « Tourner la roue », ni dans l'attente de validation.
    for (const fonction of ['function Identification', 'function MessageSansVisite', 'function Continuer']) {
      const debut = jouer.indexOf(fonction)
      const corps = jouer.slice(debut, jouer.indexOf('\n}\n', debut))
      assert.doesNotMatch(corps, /InvitationAvis|lienGoogle|avis/i, fonction)
    }
  })

  test('jamais conditionnée au lot : le même rendu gagnant ou perdant, aucune dépendance au gain', () => {
    assert.doesNotMatch(jouer, /<InvitationAvis[^>]*(gain|lot|perdant|code)=/)
    assert.doesNotMatch(invitation, /\b(gain|perdant|tirage)\b/)
    assert.match(invitation, /Le lot n’est pas conditionné à l’avis/)
  })

  test('note basse : message privé rendu AVANT le lien Google, qui reste toujours affiché', () => {
    const prive = invitation.indexOf('{prive && <MessagePriveRestaurant')
    const google = invitation.indexOf('href={lien}')
    assert.ok(prive > 0 && google > prive, 'formulaire privé avant le bouton Google')
    assert.match(invitation, /const prive = proposerMessagePrive\(note\)/)
    // Le lien Google n'est jamais masqué par la note basse : seul son style change (secondaire).
    assert.match(invitation, /\{lien \? \(\s*<a\s+href=\{lien\}/)
    assert.match(invitation, /className=\{`\$\{prive \? 'bouton-secondaire' : 'bouton'\} w-full`\}/)
    assert.doesNotMatch(invitation, /!prive && lien|prive \? null/)
  })

  test('lien Google intact : celui du commerce, sans paramètre ajouté ; retour vers la carte après ouverture', () => {
    assert.equal(lienAvisGoogle(seed.commerces[0]), LIEN_AH)
    assert.match(invitation, /const lien = lienAvisGoogle\(commerce\)/)
    assert.match(invitation, /target="_blank"/)
    assert.doesNotMatch(invitation, /href=\{`/)
    assert.match(invitation, /\{ouvert && lienCarte && \(\s*<a href=\{lienCarte\}/)
    assert.match(jouer, /const carte = joueur \? `#\/carte\/\$\{joueur\.id\}` : ''/)
    assert.match(jouer, /const carte = joueur \? `#\/carte\/\$\{joueur\.clientId\}` : ''/)
  })

  test('mode API : message envoyé avec la carte et le contact du joueur ; clic Google non compté (P2-Q3)', () => {
    assert.match(jouer, /api\.messagePrive\(commerce\.id, joueur\.clientId, joueur\.contact, note, texte\)/)
    assert.match(invitation, /prévue au lot P2-Q3/)
    assert.doesNotMatch(invitation, /fetch\(|sendBeacon/)
  })

  test('garde consentement intacte dans Jouer.tsx', () => {
    assert.doesNotMatch(jouer, /useState\(true\)|defaultChecked/)
  })

  test('#/avis : les messages privés sont listés côté commerçant, sans contact', () => {
    const avis = source('src/pages/Avis.tsx')
    assert.match(avis, /const messagesPrives = messagesPrivesDuCommerce\(clients\)/)
    assert.match(avis, /<MessagesPrives messages=\{messagesPrives\} \/>/)
    const bloc = avis.slice(avis.indexOf('function MessagesPrives'), avis.indexOf('function ApercuInvitation'))
    assert.doesNotMatch(bloc, /telephone|email/)
  })
})

// ---------- Serveur ----------

async function demarrer(nom: string, limites: Partial<LimitesPubliques> = {}) {
  const horloge = { t: new Date('2023-01-10T12:00:00Z') }
  const app = await creerServeur({
    fichierDb: join(dossier, nom),
    adminPin: '98765432',
    pinInitial: '1234',
    version: 'test',
    maintenant: () => horloge.t,
    limitesPubliques: {
      inscriptionParIp: 1000,
      inscriptionParContact: 1000,
      ficheClientParIp: 1000,
      lectureParIp: 1000,
      lectureParCarte: 1000,
      tirageParIp: 1000,
      tirageParContact: 1000,
      ...limites,
    },
  })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(`${racine}/api/v1${chemin}`, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    const brut = await r.text()
    return { statut: r.status, brut, contenu: (brut ? JSON.parse(brut) : {}) as Record<string, any> }
  }
  return { app, api, horloge }
}

describe('Serveur : POST …/clients/:clientId/message-prive', async () => {
  const s = await demarrer('p1-c4.db')
  after(() => s.app.fermer())
  const inscrire = async (contact: string) => (await s.api('POST', `/commerces/${AH}/clients`, { prenom: '', contact })).contenu.client as { id: string }
  const chemin = (id: string) => `/commerces/${AH}/clients/${id}/message-prive`
  const messagesDe = async (id: string) =>
    ((await s.api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.clients as Client[]).find((c) => c.id === id)?.messagesPrives ?? []

  test('stocké sur la fiche, visible par le commerce ; réponse sans carte ni contact', async () => {
    const contact = '06 20 00 00 01'
    const { id } = await inscrire(contact)
    const r = await s.api('POST', chemin(id), { contact: '+33 6 20 00 00 01', note: 2, texte: '  Attente trop longue.  ' })
    assert.equal(r.statut, 201)
    assert.deepEqual(Object.keys(r.contenu).sort(), ['message', 'ok'])
    assert.deepEqual(Object.keys(r.contenu.message).sort(), ['creeLe', 'id'])
    assert.doesNotMatch(r.brut, /0620000001|\+33|telephone|email|Attente/)
    const stockes = await messagesDe(id)
    assert.equal(stockes.length, 1)
    assert.equal(stockes[0].note, 2)
    assert.equal(stockes[0].texte, 'Attente trop longue.')
    assert.equal(stockes[0].creeLe, s.horloge.t.toISOString())
  })

  test('la carte publique (lien partageable) ne renvoie jamais les messages privés ni le contact', async () => {
    const contact = 'carte.privee@exemple.fr'
    const { id } = await inscrire(contact)
    assert.equal((await s.api('POST', chemin(id), { contact, note: 1, texte: 'Secret pour le chef' })).statut, 201)
    const carte = await s.api('GET', `/cartes/${id}`)
    assert.equal(carte.statut, 200)
    assert.doesNotMatch(carte.brut, /messagesPrives|Secret pour le chef|carte\.privee@exemple\.fr/)
  })

  test('identité : carte + contact donné à l’inscription (403 sinon), carte inconnue → 404', async () => {
    const contact = '06 20 00 00 02'
    const { id } = await inscrire(contact)
    const autre = await inscrire('06 20 00 00 03')
    assert.equal((await s.api('POST', chemin(id), { note: 2, texte: 'x' })).statut, 403, 'sans contact')
    assert.equal((await s.api('POST', chemin(id), { contact: '06 99 99 99 99', note: 2, texte: 'x' })).statut, 403, 'mauvais contact')
    assert.equal((await s.api('POST', chemin(autre.id), { contact, note: 2, texte: 'x' })).statut, 403, 'contact d’une autre carte')
    const inconnu = await s.api('POST', chemin('cl-inconnu'), { contact, note: 2, texte: 'x' })
    assert.equal(inconnu.statut, 404)
    assert.equal((await messagesDe(id)).length, 0)
    assert.equal((await messagesDe(autre.id)).length, 0)
  })

  test('validation : note 1 à 5 entière, texte non vide et borné → 400, rien n’est stocké', async () => {
    const contact = '06 20 00 00 04'
    const { id } = await inscrire(contact)
    for (const corps of [
      { contact, note: 0, texte: 'x' },
      { contact, note: 6, texte: 'x' },
      { contact, note: '2', texte: 'x' },
      { contact, note: 2, texte: '   ' },
      { contact, note: 2 },
      { contact, note: 2, texte: 'x'.repeat(TEXTE_MAX + 1) },
    ]) {
      assert.equal((await s.api('POST', chemin(id), corps)).statut, 400, JSON.stringify(corps).slice(0, 60))
    }
    assert.equal((await messagesDe(id)).length, 0)
  })

  test(`plafond : ${MESSAGES_PAR_JOUR} messages par carte et par jour (429 ensuite), de nouveau possible le lendemain`, async () => {
    const contact = '06 20 00 00 05'
    const { id } = await inscrire(contact)
    for (let i = 0; i < MESSAGES_PAR_JOUR; i++) assert.equal((await s.api('POST', chemin(id), { contact, note: 3, texte: `m${i}` })).statut, 201)
    assert.equal((await s.api('POST', chemin(id), { contact, note: 3, texte: 'de trop' })).statut, 429)
    s.horloge.t = new Date(s.horloge.t.getTime() + 24 * 3600_000)
    assert.equal((await s.api('POST', chemin(id), { contact, note: 3, texte: 'lendemain' })).statut, 201)
    assert.equal((await messagesDe(id)).length, MESSAGES_PAR_JOUR + 1)
  })

  test('le message ne touche ni au jeu ni à la carte : aucune visite, aucun tirage, aucun PIN demandé', async () => {
    const contact = '06 20 00 00 06'
    const { id } = await inscrire(contact)
    const avant = (await s.api('GET', `/cartes/${id}`)).contenu
    assert.equal((await s.api('POST', chemin(id), { contact, note: 1, texte: 'Déçu' })).statut, 201)
    const apres = (await s.api('GET', `/cartes/${id}`)).contenu
    assert.deepEqual(apres.jeu, avant.jeu)
    assert.deepEqual(apres.client.visites, avant.client.visites)
    assert.equal(apres.client.tampons, avant.client.tampons)
  })
})

describe('Serveur : message privé limité par IP', async () => {
  const s = await demarrer('p1-c4-limite.db', { ficheClientParIp: 2 })
  after(() => s.app.fermer())

  test('au-delà du seuil « fiche » par IP → 429', async () => {
    const contact = '06 20 00 00 07'
    const { id } = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: '', contact })).contenu.client
    const chemin = `/commerces/${AH}/clients/${id}/message-prive`
    assert.equal((await s.api('POST', chemin, { contact, note: 2, texte: 'un' })).statut, 201)
    assert.equal((await s.api('POST', chemin, { contact, note: 2, texte: 'deux' })).statut, 201)
    const trop = await s.api('POST', chemin, { contact, note: 2, texte: 'trois' })
    assert.equal(trop.statut, 429)
  })
})

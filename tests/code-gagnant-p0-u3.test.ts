// P0-U3 — Code gagnant vérifiable en caisse : vrai serveur HTTP, vraie base SQLite temporaire, horloge pilotée.
// GET /commerces/:id/caisse/gains/:code et POST …/remise (auth caisse), code re-servi par GET /cartes/:id.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import type { Client, EntreeJournal, Tirage } from '../src/types.ts'
import { creerClientApi, ErreurApi } from '../src/data/api.ts'
import { jourEnClair, messageGain, normaliserCodeGagnant, statutGain, tirageDuCode } from '../src/lib/roulette.ts'

const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const CODE = { 'X-Equipe-Code': '2468' }
const GAGNANT = [{ libelle: 'Nems offerts', probabilite: 100 }]
const PERDANT = [{ libelle: 'Pas de chance', probabilite: 100 }]

// Mardi 10 novembre 2026, midi (heure locale).
let horloge = new Date(2026, 10, 10, 12, 0)

describe('P0-U3 : logique pure du code gagnant', () => {
  test('saisie normalisée : casse, espaces et tirets ignorés ; sinon null', () => {
    assert.equal(normaliserCodeGagnant(' ab c-d23 '), 'ABCD23')
    assert.equal(normaliserCodeGagnant('ABCD2'), null)
    assert.equal(normaliserCodeGagnant('ABCD234'), null)
    assert.equal(normaliserCodeGagnant('ABC!23'), null)
  })

  test('statut : perdant > remis > expiré (autre jour) > valable', () => {
    const t: Tirage = { id: 't', commerceId: AH, clientId: 'c', lot: 'Nems offerts', date: new Date(2026, 10, 10, 9).toISOString(), code: 'ABCD23' }
    const midi = new Date(2026, 10, 10, 12)
    assert.equal(statutGain(t, midi), 'valable')
    assert.equal(statutGain(t, new Date(2026, 10, 11, 0, 5)), 'expire', 'lendemain, même 5 min après minuit')
    assert.equal(statutGain({ ...t, remis: { le: midi.toISOString(), par: { type: 'membre', nom: 'Mai' } } }, midi), 'remis')
    assert.equal(statutGain({ ...t, lot: 'Pas de chance' }, midi), 'perdant')
  })

  test('même code un autre jour (collision) : le tirage du jour passe d’abord', () => {
    const hier: Tirage = { id: 'h', commerceId: AH, clientId: 'c', lot: 'Thé glacé', date: new Date(2026, 10, 9, 12).toISOString(), code: 'ABCD23' }
    const auj: Tirage = { ...hier, id: 'a', date: new Date(2026, 10, 10, 11).toISOString() }
    assert.equal(tirageDuCode([hier, auj], new Date(2026, 10, 10, 12))?.id, 'a')
    assert.equal(tirageDuCode([hier], new Date(2026, 10, 10, 12))?.id, 'h')
    assert.equal(tirageDuCode([], new Date()), undefined)
  })

  test('date en clair et messages de la caisse', () => {
    assert.equal(jourEnClair(new Date(2026, 10, 10)), 'mar. 10 nov. 2026')
    const base = { lot: 'Nems offerts', date: new Date(2026, 10, 9, 12).toISOString(), remis: null }
    assert.match(messageGain({ ...base, statut: 'expire' }), /expiré.*lun\. 9 nov\. 2026/)
    assert.match(messageGain({ ...base, statut: 'perdant' }), /aucun lot/)
    assert.match(messageGain({ ...base, statut: 'remis', remis: { le: new Date(2026, 10, 10, 12, 5).toISOString(), par: 'Mai' } }), /déjà remis le 10\/11\/2026 à 12:05 par Mai/)
  })
})

describe('P0-U3 : routes de la caisse (SQLite)', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p0u3-'))
  let app: Awaited<ReturnType<typeof creerServeur>>
  let base = ''

  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    return { statut: r.status, contenu: await r.json() }
  }
  const lots = async (l: typeof GAGNANT) => assert.equal((await api('PATCH', `/commerces/${AH}`, { lots: l }, PIN)).statut, 200)
  /** Client inscrit, visite validée en caisse, roue tournée : renvoie le client et la réponse du tirage. */
  async function joueur(prenom: string, contact: string) {
    const c = (await api('POST', `/commerces/${AH}/clients`, { prenom, contact }, PIN)).contenu.client as Client
    assert.equal((await api('POST', `/commerces/${AH}/caisse/passage`, { clientId: c.id, actionId: `act-${c.id}` }, CODE)).statut, 200)
    const t = await api('POST', `/commerces/${AH}/tirages`, { contact })
    assert.equal(t.statut, 201)
    return { client: c, tirage: t.contenu as { lot: string; code: string; date: string; perdant: boolean } }
  }
  const gains = (code: string) => `/commerces/${AH}/caisse/gains/${encodeURIComponent(code)}`

  let lina: Client
  let code = ''

  before(async () => {
    app = await creerServeur({ fichierDb: join(dossier, 'f.db'), adminPin: '98765432', pinInitial: '1234', version: 'test', maintenant: () => horloge })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
    assert.equal((await api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)).statut, 201)
    await lots(GAGNANT)
    const j = await joueur('Lina', '0612345678')
    lina = j.client
    code = j.tirage.code
    assert.equal(j.tirage.lot, 'Nems offerts')
    assert.match(code, /^[A-Z2-9]{6}$/)
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('auth caisse obligatoire : sans en-tête 401, mauvais code équipe 401 ; code équipe ou PIN gérant acceptés', async () => {
    assert.equal((await api('GET', gains(code))).statut, 401)
    assert.equal((await api('POST', `${gains(code)}/remise`)).statut, 401)
    assert.equal((await api('GET', gains(code), undefined, { 'X-Equipe-Code': '1111' })).statut, 401)
    assert.equal((await api('POST', `${gains(code)}/remise`, undefined, { 'X-Equipe-Code': '1111' })).statut, 401)
    assert.equal((await api('GET', gains(code), undefined, CODE)).statut, 200)
    assert.equal((await api('GET', gains(code), undefined, PIN)).statut, 200)
    // Rien n'a été remis par ces lectures.
    assert.equal((await api('GET', gains(code), undefined, CODE)).contenu.gain.statut, 'valable')
  })

  test('vérification : saisie insensible à la casse et aux espaces → lot, prénom, date ; jamais le contact', async () => {
    const r = await api('GET', gains(` ${code.slice(0, 3).toLowerCase()} ${code.slice(3)}`), undefined, CODE)
    assert.equal(r.statut, 200)
    assert.deepEqual(r.contenu.gain, { code, lot: 'Nems offerts', date: horloge.toISOString(), statut: 'valable', client: { id: lina.id, prenom: 'Lina' }, remis: null })
    assert.doesNotMatch(JSON.stringify(r.contenu), /0612345678|telephone/)
  })

  test('format impossible → 400 ; code inconnu → 404 (lecture et remise)', async () => {
    assert.equal((await api('GET', gains('ABC'), undefined, CODE)).statut, 400)
    const inconnu = code === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ'
    const g = await api('GET', gains(inconnu), undefined, CODE)
    assert.equal(g.statut, 404)
    assert.match(g.contenu.erreur, /Code inconnu/)
    assert.equal((await api('POST', `${gains(inconnu)}/remise`, undefined, CODE)).statut, 404)
  })

  test('autre téléphone / cache vidé : GET /cartes/:id re-sert le code du jour ; le 2e tirage reste refusé sans le révéler', async () => {
    const carte = await api('GET', `/cartes/${lina.id}`)
    assert.equal(carte.statut, 200)
    assert.deepEqual(carte.contenu.jeu, { statut: 'dejaJoue', lotDuJour: 'Nems offerts', codeDuJour: code, remisDuJour: false })
    const encore = await api('POST', `/commerces/${AH}/tirages`, { contact: '06 12 34 56 78' })
    assert.equal(encore.statut, 409)
    assert.match(encore.contenu.erreur, /déjà tourné la roue/)
    assert.ok(!JSON.stringify(encore.contenu).includes(code), 'route publique par contact : jamais le code')
    for (const chemin of ['/commerces', `/commerces/${AH}`, `/commerces/${AH}/menu`]) {
      assert.ok(!JSON.stringify((await api('GET', chemin)).contenu).includes(code), `${chemin} n’expose aucun code`)
    }
  })

  test('remise : 200 + traçabilité (qui / quand, journal) ; 2e remise du même code → 409 « déjà remis »', async () => {
    horloge = new Date(2026, 10, 10, 12, 5)
    const r = await api('POST', `${gains(code.toLowerCase())}/remise`, undefined, CODE)
    assert.equal(r.statut, 200)
    assert.deepEqual([r.contenu.gain.statut, r.contenu.gain.remis], ['remis', { le: horloge.toISOString(), par: 'Mai' }])

    const bis = await api('POST', `${gains(code)}/remise`, undefined, PIN)
    assert.equal(bis.statut, 409)
    assert.match(bis.contenu.erreur, /déjà remis le 10\/11\/2026 à 12:05 par Mai/)
    assert.equal((await api('GET', gains(code), undefined, CODE)).contenu.gain.statut, 'remis')

    const etat = (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu as { tirages: Tirage[]; journal: EntreeJournal[] }
    const t = etat.tirages.find((x) => x.code === code)!
    assert.equal(t.remis?.par.nom, 'Mai')
    assert.equal(t.remis?.par.type, 'membre')
    const gainsJournal = etat.journal.filter((e) => e.action === 'gain')
    assert.equal(gainsJournal.length, 1, 'une seule remise tracée')
    assert.deepEqual([gainsJournal[0].auteur.nom, gainsJournal[0].clientPrenom], ['Mai', 'Lina'])
    assert.match(gainsJournal[0].details, /Nems offerts/)

    const carte = (await api('GET', `/cartes/${lina.id}`)).contenu
    assert.equal(carte.jeu.remisDuJour, true)
  })

  test('code d’un tirage perdant : vérifiable (statut perdant), remise → 409 ; la carte ne montre aucun code', async () => {
    await lots(PERDANT)
    const { client, tirage } = await joueur('Tom', '0611111111')
    await lots(GAGNANT)
    assert.equal(tirage.perdant, true)
    assert.equal((await api('GET', gains(tirage.code), undefined, CODE)).contenu.gain.statut, 'perdant')
    const r = await api('POST', `${gains(tirage.code)}/remise`, undefined, CODE)
    assert.equal(r.statut, 409)
    assert.match(r.contenu.erreur, /perdant/)
    assert.equal((await api('GET', `/cartes/${client.id}`)).contenu.jeu.codeDuJour, null)
  })

  test('code d’hier : expiré → 410 (rien n’est écrit), statut « expire » à la vérification', async () => {
    const { tirage } = await joueur('Zoé', '0622222222')
    horloge = new Date(2026, 10, 11, 9, 0)
    try {
      const g = await api('GET', gains(tirage.code), undefined, CODE)
      assert.equal(g.contenu.gain.statut, 'expire')
      const r = await api('POST', `${gains(tirage.code)}/remise`, undefined, CODE)
      assert.equal(r.statut, 410)
      assert.match(r.contenu.erreur, /expiré.*mar\. 10 nov\. 2026/)
      assert.equal((await api('GET', gains(tirage.code), undefined, CODE)).contenu.gain.remis, null)
    } finally {
      horloge = new Date(2026, 10, 10, 12, 30)
    }
  })

  test('double appel simultané : une seule remise passe, l’autre 409 ; une seule entrée au journal', async () => {
    const { tirage } = await joueur('Hugo', '0633333333')
    const r = await Promise.all([api('POST', `${gains(tirage.code)}/remise`, undefined, CODE), api('POST', `${gains(tirage.code)}/remise`, undefined, PIN)])
    assert.deepEqual(r.map((x) => x.statut).sort(), [200, 409])
    const journal = (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.journal as EntreeJournal[]
    assert.equal(journal.filter((e) => e.action === 'gain' && e.details.includes(tirage.code)).length, 1)
  })

  test('client HTTP du front (caisse) : verifierGain / remettreGain, erreurs lisibles', async () => {
    const { tirage } = await joueur('Inès', '0644444444')
    const client = creerClientApi(base)
    const acces = { code: '2468' }
    const g = await client.verifierGain(AH, acces, tirage.code)
    assert.deepEqual([g.statut, g.client?.prenom], ['valable', 'Inès'])
    assert.equal((await client.remettreGain(AH, acces, tirage.code)).statut, 'remis')
    await assert.rejects(client.remettreGain(AH, acces, tirage.code), (e: unknown) => e instanceof ErreurApi && e.statut === 409 && /déjà remis/.test(e.message))
    await assert.rejects(client.verifierGain(AH, { code: '0000' }, tirage.code), (e: unknown) => e instanceof ErreurApi && e.statut === 401)
  })

  test('persistance : après redémarrage du serveur, le code reste remis', async () => {
    await app.fermer()
    app = await creerServeur({ fichierDb: join(dossier, 'f.db'), adminPin: '98765432', pinInitial: '1234', version: 'test', maintenant: () => horloge })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
    assert.equal((await api('GET', gains(code), undefined, CODE)).contenu.gain.statut, 'remis')
    assert.equal((await api('POST', `${gains(code)}/remise`, undefined, CODE)).statut, 409)
  })
})

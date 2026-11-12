// P0-U3 — Code gagnant vérifiable en caisse : vrai serveur HTTP, vraie base SQLite temporaire, horloge pilotée.
// GET /commerces/:id/caisse/gains/:code et POST …/remise (auth caisse).
// Roue v2 R3 (décision utilisateur du 12/11/2026) : le modèle « valable le jour du tirage » est remplacé par « utilisable
// de J+1 à J+30, code activé 10 minutes par le titulaire » (burn-on-reveal). L'intention de ces tests est gardée — un
// code = une remise, jamais de code en public — mais le code n'est plus re-servi par la carte : le client l'obtient par
// POST …/tirages/:id/activer (jeton client), d'où le secret de session et l'activation avant chaque remise.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, emettreJetonClient } from '../server/app.ts'
import type { Client, EntreeJournal, Tirage } from '../src/types.ts'
import { creerClientApi, ErreurApi } from '../src/data/api.ts'
import { jourEnClair, messageGain, normaliserCodeGagnant, statutGain, tirageDuCode } from '../src/lib/roulette.ts'
import { codeEnBase } from './code-en-base.ts'

const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const CODE = { 'X-Equipe-Code': '2468' }
const SECRET = 'secret-de-test-p0-u3-au-moins-32-caracteres-0123456789'
const GAGNANT = [{ libelle: 'Nems offerts', probabilite: 100 }]
const PERDANT = [{ libelle: 'Pas de chance', probabilite: 100 }]

// Mardi 10 novembre 2026, midi (heure locale).
let horloge = new Date(2026, 10, 10, 12, 0)
const plusJours = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes())

describe('P0-U3 : logique pure du code gagnant', () => {
  test('saisie normalisée : casse, espaces et tirets ignorés ; sinon null', () => {
    assert.equal(normaliserCodeGagnant(' ab c-d23 '), 'ABCD23')
    assert.equal(normaliserCodeGagnant('ABCD2'), null)
    assert.equal(normaliserCodeGagnant('ABCD234'), null)
    assert.equal(normaliserCodeGagnant('ABC!23'), null)
  })

  test('statut (R3) : perdant > remis > en attente (jour J) / inactif ou utilisable (J+1 à J+30) / expiré (après J+30)', () => {
    const t: Tirage = { id: 't', commerceId: AH, clientId: 'c', lot: 'Nems offerts', typeLot: 'lot', date: new Date(2026, 10, 10, 9).toISOString(), code: 'ABCD23' }
    const midi = new Date(2026, 10, 10, 12)
    assert.equal(statutGain(t, midi), 'enAttente', 'le jour du tirage : pas encore utilisable')
    assert.equal(statutGain(t, new Date(2026, 10, 11, 0, 5)), 'inactif', 'lendemain 0 h 05 : utilisable, code non activé')
    const active = { ...t, activeLe: new Date(2026, 10, 11, 0, 5).toISOString() }
    assert.equal(statutGain(active, new Date(2026, 10, 11, 0, 10)), 'utilisable', 'code activé il y a 5 min')
    assert.equal(statutGain(t, new Date(2026, 11, 11, 0, 5)), 'expire', 'J+31')
    assert.equal(statutGain({ ...active, remis: { le: midi.toISOString(), par: { type: 'membre', nom: 'Mai' } } }, midi), 'remis')
    assert.equal(statutGain({ ...t, lot: 'Pas de chance', typeLot: 'perdant' }, midi), 'perdant')
  })

  test('même code sur deux tirages (collision) : celui dont le code est activé passe d’abord, puis un gain encore en jeu', () => {
    const hier: Tirage = { id: 'h', commerceId: AH, clientId: 'c', lot: 'Thé glacé', typeLot: 'lot', date: new Date(2026, 10, 9, 12).toISOString(), code: 'ABCD23' }
    const auj: Tirage = { ...hier, id: 'a', date: new Date(2026, 10, 10, 11).toISOString() }
    const midi = new Date(2026, 10, 10, 12)
    assert.equal(tirageDuCode([auj, { ...hier, activeLe: new Date(2026, 10, 10, 11, 55).toISOString() }], midi)?.id, 'h', 'activé')
    assert.equal(tirageDuCode([auj, { ...hier, remis: { le: '', par: { type: 'membre', nom: 'Mai' } } }], midi)?.id, 'a', 'remis : passe après')
    assert.equal(tirageDuCode([hier], midi)?.id, 'h')
    assert.equal(tirageDuCode([], new Date()), undefined)
  })

  test('date en clair et messages de la caisse (v2, maquettes §4)', () => {
    assert.equal(jourEnClair(new Date(2026, 10, 10)), 'mar. 10 nov. 2026')
    const base = { lot: 'Nems offerts', date: new Date(2026, 10, 9, 12).toISOString(), remis: null }
    assert.match(messageGain({ ...base, statut: 'expire' }), /Gain expiré le mer\. 9 déc\. 2026 : rien à remettre/)
    assert.match(messageGain({ ...base, statut: 'enAttente' }), /Pas encore utilisable : ce gain gagné le lun\. 9 nov\. 2026 s’utilise à partir du mar\. 10 nov\. 2026/)
    assert.match(messageGain({ ...base, statut: 'inactif' }), /Utiliser mon gain.*10 minutes/)
    assert.match(messageGain({ ...base, statut: 'utilisable' }), /Gain à remettre : Nems offerts \(gagné le lun\. 9 nov\. 2026\)/)
    assert.match(messageGain({ ...base, statut: 'perdant' }), /pas de lot à remettre/)
    assert.match(messageGain({ ...base, statut: 'remis', remis: { le: new Date(2026, 10, 10, 12, 5).toISOString(), par: 'Mai' } }), /déjà remis le 10\/11\/2026 à 12:05 par Mai/)
  })
})

describe('P0-U3 : routes de la caisse (SQLite)', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p0u3-'))
  let app: Awaited<ReturnType<typeof creerServeur>>
  let base = ''
  const options = () => ({ fichierDb: join(dossier, 'f.db'), adminPin: '98765432', pinInitial: '1234', version: 'test', secretSession: SECRET, maintenant: () => horloge })

  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    return { statut: r.status, contenu: await r.json() }
  }
  const lots = async (l: typeof GAGNANT) => assert.equal((await api('PATCH', `/commerces/${AH}`, { lots: l }, PIN)).statut, 200)
  /** Jeton client de cette carte (version d'accès 0), comme celui rangé sur le téléphone du titulaire. */
  const jetonDe = (clientId: string) =>
    emettreJetonClient(SECRET, { typ: 'client', jti: randomUUID(), cid: clientId, com: AH, ver: 0, exp: Math.floor(horloge.getTime() / 1000) + 60 * 24 * 3600 })
  /**
   * Client inscrit, visite validée en caisse, roue tournée : le client, la réponse du tirage et le code — lu en base :
   * depuis la revue Codex R3 (F1), l'état commerçant ne le sert plus.
   */
  async function joueur(prenom: string, contact: string) {
    const c = (await api('POST', `/commerces/${AH}/clients`, { prenom, contact }, PIN)).contenu.client as Client
    assert.equal((await api('POST', `/commerces/${AH}/caisse/passage`, { clientId: c.id, actionId: `act-${c.id}` }, CODE)).statut, 200)
    const t = await api('POST', `/commerces/${AH}/tirages`, { contact })
    assert.equal(t.statut, 201)
    const tirage = t.contenu as { tirageId: string; lot: string; code?: string; date: string; perdant: boolean }
    assert.equal(tirage.code, undefined, 'R3 : jamais de code dans la réponse du tirage')
    return { client: c, tirage, code: codeEnBase(join(dossier, 'f.db'), tirage.tirageId) ?? '', jeton: jetonDe(c.id) }
  }
  /** Le titulaire appuie sur « Utiliser mon gain » : code valable 10 minutes en caisse. */
  async function activer(j: { tirage: { tirageId: string }; jeton: string }) {
    const r = await api('POST', `/commerces/${AH}/tirages/${j.tirage.tirageId}/activer`, undefined, { Authorization: `Bearer ${j.jeton}` })
    assert.equal(r.statut, 200, JSON.stringify(r.contenu))
    return r.contenu as { code: string; expireActivation: string }
  }
  const gains = (code: string) => `/commerces/${AH}/caisse/gains/${encodeURIComponent(code)}`

  let lina: Awaited<ReturnType<typeof joueur>>
  let code = ''

  before(async () => {
    app = await creerServeur(options())
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
    assert.equal((await api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)).statut, 201)
    await lots(GAGNANT)
    lina = await joueur('Lina', '0612345678')
    code = lina.code
    assert.equal(lina.tirage.lot, 'Nems offerts')
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
    // Rien n'a été remis par ces lectures (le jour du tirage : en attente).
    assert.equal((await api('GET', gains(code), undefined, CODE)).contenu.gain.statut, 'enAttente')
  })

  test('vérification : saisie insensible à la casse et aux espaces → lot, prénom, date ; jamais le contact', async () => {
    const r = await api('GET', gains(` ${code.slice(0, 3).toLowerCase()} ${code.slice(3)}`), undefined, CODE)
    assert.equal(r.statut, 200)
    assert.deepEqual(r.contenu.gain, { code, lot: 'Nems offerts', date: horloge.toISOString(), statut: 'enAttente', client: { id: lina.client.id, prenom: 'Lina' }, remis: null })
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

  test('autre téléphone / cache vidé : GET /cartes/:id ne sert jamais le code ; le 2e tirage reste refusé sans le révéler', async () => {
    const carte = await api('GET', `/cartes/${lina.client.id}`)
    assert.equal(carte.statut, 200)
    // R3 : le code ne vient plus que de l'activation (titulaire, jeton client) ; le lot reste affiché.
    assert.deepEqual(carte.contenu.jeu, { statut: 'dejaJoue', lotDuJour: 'Nems offerts', codeDuJour: null, remisDuJour: false })
    assert.ok(!JSON.stringify(carte.contenu).includes(code), 'aucun code sur la carte')
    const encore = await api('POST', `/commerces/${AH}/tirages`, { contact: '06 12 34 56 78' })
    assert.equal(encore.statut, 409)
    assert.match(encore.contenu.erreur, /déjà tourné la roue/)
    assert.ok(!JSON.stringify(encore.contenu).includes(code), 'route publique par contact : jamais le code')
    for (const chemin of ['/commerces', `/commerces/${AH}`, `/commerces/${AH}/menu`]) {
      assert.ok(!JSON.stringify((await api('GET', chemin)).contenu).includes(code), `${chemin} n’expose aucun code`)
    }
  })

  test('remise : refusée sans activation (409) ; activée → 200 + traçabilité (qui / quand, journal) ; 2e remise → 409 « déjà remis »', async () => {
    horloge = new Date(2026, 10, 11, 12, 0)
    const sans = await api('POST', `${gains(code)}/remise`, undefined, CODE)
    assert.equal(sans.statut, 409, 'utilisable mais code non activé')
    assert.match(sans.contenu.erreur, /Utiliser mon gain/)
    assert.equal((await activer(lina)).code, code)
    horloge = new Date(2026, 10, 11, 12, 5)
    const r = await api('POST', `${gains(code.toLowerCase())}/remise`, undefined, CODE)
    assert.equal(r.statut, 200)
    assert.deepEqual([r.contenu.gain.statut, r.contenu.gain.remis], ['remis', { le: horloge.toISOString(), par: 'Mai' }])

    const bis = await api('POST', `${gains(code)}/remise`, undefined, PIN)
    assert.equal(bis.statut, 409)
    assert.match(bis.contenu.erreur, /déjà remis le 11\/11\/2026 à 12:05 par Mai/)
    assert.equal((await api('GET', gains(code), undefined, CODE)).contenu.gain.statut, 'remis')

    const etat = (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu as { tirages: Tirage[]; journal: EntreeJournal[] }
    const t = etat.tirages.find((x) => x.id === lina.tirage.tirageId)!
    assert.equal(t.code, undefined, 'revue Codex R3 (F1) : l’état commerçant ne porte pas le code')
    assert.equal(t.remis?.par.nom, 'Mai')
    assert.equal(t.remis?.par.type, 'membre')
    const gainsJournal = etat.journal.filter((e) => e.action === 'gain')
    assert.equal(gainsJournal.length, 1, 'une seule remise tracée')
    assert.deepEqual([gainsJournal[0].auteur.nom, gainsJournal[0].clientPrenom], ['Mai', 'Lina'])
    assert.match(gainsJournal[0].details, /Nems offerts/)

    // La carte le montre remis (historique) ; une nouvelle activation est refusée.
    const carte = (await api('GET', `/cartes/${lina.client.id}`)).contenu
    assert.equal(carte.historiqueLots[0].statut, 'remis')
    assert.equal((await api('POST', `/commerces/${AH}/tirages/${lina.tirage.tirageId}/activer`, undefined, { Authorization: `Bearer ${lina.jeton}` })).statut, 409)
  })

  test('code d’un tirage perdant : vérifiable (statut perdant), remise → 409 ; la carte ne montre aucun code', async () => {
    await lots(PERDANT)
    const { client, tirage, code: codePerdant } = await joueur('Tom', '0611111111')
    await lots(GAGNANT)
    assert.equal(tirage.perdant, true)
    assert.equal((await api('GET', gains(codePerdant), undefined, CODE)).contenu.gain.statut, 'perdant')
    const r = await api('POST', `${gains(codePerdant)}/remise`, undefined, CODE)
    assert.equal(r.statut, 409)
    assert.match(r.contenu.erreur, /pas de lot à remettre \(Pas de chance\)/)
    const carte = await api('GET', `/cartes/${client.id}`)
    assert.equal(carte.contenu.jeu.codeDuJour, null)
    assert.ok(!JSON.stringify(carte.contenu).includes(codePerdant))
  })

  test('après J+30 : expiré → 410 (rien n’est écrit), statut « expire » à la vérification ; J+30 encore utilisable', async () => {
    const zoe = await joueur('Zoé', '0622222222')
    const jour = horloge
    try {
      horloge = plusJours(jour, 30)
      await activer(zoe)
      assert.equal((await api('GET', gains(zoe.code), undefined, CODE)).contenu.gain.statut, 'utilisable', 'J+30 : dernier jour')
      horloge = plusJours(jour, 31)
      const g = await api('GET', gains(zoe.code), undefined, CODE)
      assert.equal(g.contenu.gain.statut, 'expire')
      const r = await api('POST', `${gains(zoe.code)}/remise`, undefined, CODE)
      assert.equal(r.statut, 410)
      assert.ok(r.contenu.erreur.startsWith(`Gain expiré le ${jourEnClair(plusJours(jour, 30))} :`), r.contenu.erreur)
      assert.equal((await api('GET', gains(zoe.code), undefined, CODE)).contenu.gain.remis, null)
    } finally {
      horloge = jour
    }
  })

  test('double appel simultané : une seule remise passe, l’autre 409 ; une seule entrée au journal', async () => {
    const hugo = await joueur('Hugo', '0633333333')
    const jour = horloge
    try {
      horloge = plusJours(jour, 1)
      await activer(hugo)
      const r = await Promise.all([api('POST', `${gains(hugo.code)}/remise`, undefined, CODE), api('POST', `${gains(hugo.code)}/remise`, undefined, PIN)])
      assert.deepEqual(r.map((x) => x.statut).sort(), [200, 409])
      const journal = (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.journal as EntreeJournal[]
      assert.equal(journal.filter((e) => e.action === 'gain' && e.details.includes(hugo.code)).length, 1)
    } finally {
      horloge = jour
    }
  })

  test('client HTTP du front (caisse) : verifierGain / remettreGain, erreurs lisibles', async () => {
    const ines = await joueur('Inès', '0644444444')
    const client = creerClientApi(base)
    const acces = { code: '2468' }
    const jour = horloge
    try {
      const g = await client.verifierGain(AH, acces, ines.code)
      assert.deepEqual([g.statut, g.client?.prenom], ['enAttente', 'Inès'])
      await assert.rejects(client.remettreGain(AH, acces, ines.code), (e: unknown) => e instanceof ErreurApi && e.statut === 409 && /Pas encore utilisable/.test(e.message))
      horloge = plusJours(jour, 1)
      assert.equal((await client.activerCode(AH, ines.tirage.tirageId, ines.jeton)).code, ines.code)
      assert.equal((await client.remettreGain(AH, acces, ines.code)).statut, 'remis')
      await assert.rejects(client.remettreGain(AH, acces, ines.code), (e: unknown) => e instanceof ErreurApi && e.statut === 409 && /déjà remis/.test(e.message))
      await assert.rejects(client.verifierGain(AH, { code: '0000' }, ines.code), (e: unknown) => e instanceof ErreurApi && e.statut === 401)
    } finally {
      horloge = jour
    }
  })

  test('persistance : après redémarrage du serveur, le code reste remis', async () => {
    await app.fermer()
    app = await creerServeur(options())
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
    assert.equal((await api('GET', gains(code), undefined, CODE)).contenu.gain.statut, 'remis')
    assert.equal((await api('POST', `${gains(code)}/remise`, undefined, CODE)).statut, 409)
  })
})

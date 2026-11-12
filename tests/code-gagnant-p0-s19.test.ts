// P0-S19 — Code gagnant hors vue publique (AUDIT.md §7, revue Codex point 3). Vrai serveur HTTP, base SQLite
// temporaire, horloge pilotée.
// Roue v2 R3 (décision utilisateur du 12/11/2026, burn-on-reveal) : P0-S19 est RESSERRÉ. Le code n'est plus servi par
// GET /cartes/:id (`jeu.codeDuJour` vaut toujours null, même avec le jeton) ni par la réponse du tirage : seulement par
// POST /commerces/:id/tirages/:tirageId/activer, au titulaire authentifié (jeton client de CETTE carte), à partir de J+1.
// L'intention d'origine est gardée : le titulaire sur un autre téléphone / au cache vidé récupère son code avec un jeton
// (lien d'accès à usage unique) ; personne d'autre ne l'obtient.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, emettreJetonClient, type OptionsServeur } from '../server/app.ts'
import type { Client } from '../src/types.ts'
import { codeEnBase } from './code-en-base.ts'

const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const CODE_EQUIPE = { 'X-Equipe-Code': '2468' }
const SECRET = 'secret-de-test-p0-s19-au-moins-32-caracteres-0123456789'
const LARGES = { inscriptionParIp: 1000, inscriptionParContact: 1000, ficheClientParIp: 1000, lectureParIp: 1000, lectureParCarte: 1000, tirageParIp: 1000, tirageParContact: 1000 }
const GAGNANT = [{ libelle: 'Nems offerts', probabilite: 100 }]
const PERDANT = [{ libelle: 'Pas de chance', probabilite: 100 }]

const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p0s19-'))
after(() => rmSync(dossier, { recursive: true, force: true }))

type Reponse = { statut: number; contenu: any; texte: string }

/**
 * Chaque requête vient d'une IP différente (derrière proxy, X-Forwarded-For) : les refus volontaires (401) ne
 * déclenchent pas le blocage anti-bruteforce client, testé à part dans tests/auth-client-p0-s7.test.ts.
 */
async function demarrer(nom: string, options: Partial<OptionsServeur> = {}) {
  const horloge = { t: new Date(2026, 10, 10, 12, 0) }
  const app = await creerServeur({
    fichierDb: join(dossier, nom),
    adminPin: '98765432',
    pinInitial: '1234',
    version: 'test',
    secretSession: SECRET,
    authClient: 'stricte',
    derriereProxy: true,
    maintenant: () => horloge.t,
    limitesPubliques: LARGES,
    ...options,
  })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
  let numeroIp = 0
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}): Promise<Reponse> {
    const r = await fetch(`${racine}/api/v1${chemin}`, {
      method: methode,
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${++numeroIp % 250}`, ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    const texte = await r.text()
    let contenu: unknown = texte
    try {
      contenu = JSON.parse(texte)
    } catch {
      // Texte brut
    }
    return { statut: r.status, contenu, texte }
  }
  const bearer = (jeton: string) => ({ Authorization: `Bearer ${jeton}` })
  /** Inscription publique (page de jeu) → la carte et son jeton client. */
  async function inscrire(contact: string) {
    const r = await api('POST', `/commerces/${AH}/clients`, { contact })
    assert.equal(r.statut, 201, r.texte)
    return { client: r.contenu.client as Client, jeton: r.contenu.jeton as string }
  }
  const lots = async (l: typeof GAGNANT) => assert.equal((await api('PATCH', `/commerces/${AH}`, { lots: l }, PIN)).statut, 200)
  const visite = async (clientId: string) => assert.equal((await api('POST', `/commerces/${AH}/clients/${clientId}/visite`, undefined, PIN)).statut, 200)
  /**
   * Client inscrit, visite validée, roue tournée avec son jeton : le client, son jeton et le tirage. R3 : la réponse du
   * tirage ne porte plus de code ; revue Codex R3 (F1) : l'état commerçant non plus — `tirage.code` est lu en base, pour
   * vérifier qu'il ne fuit nulle part.
   */
  async function joueur(contact: string) {
    const { client, jeton } = await inscrire(contact)
    await visite(client.id)
    const t = await api('POST', `/commerces/${AH}/tirages`, {}, bearer(jeton))
    assert.equal(t.statut, 201, t.texte)
    assert.equal(t.contenu.code, undefined, 'R3 : aucun code dans la réponse du tirage')
    assert.ok(!t.texte.includes('"code"'))
    const r = t.contenu as { tirageId: string; lot: string; date: string; perdant: boolean }
    const etat = await api('GET', `/commerces/${AH}/etat`, undefined, PIN)
    // Tirage perdant : aucun code en base ; le texte de remplacement ne peut apparaître dans aucune réponse.
    const code = codeEnBase(join(dossier, nom), r.tirageId) ?? '(aucun code)'
    assert.ok(!etat.texte.includes(code), 'revue Codex R3 (F1) : pas de code dans l’état commerçant')
    return { client, jeton, tirage: { ...r, code } }
  }
  /** « Utiliser mon gain » (R3). */
  const activer = (tirageId: string, entetes: Record<string, string> = {}) => api('POST', `/commerces/${AH}/tirages/${tirageId}/activer`, undefined, entetes)
  /** Le lendemain du tirage : le gain devient utilisable. */
  const lendemain = () => {
    horloge.t = new Date(horloge.t.getTime() + 24 * 3600 * 1000)
  }
  return { app, api, bearer, inscrire, lots, visite, joueur, activer, lendemain, horloge }
}

describe('P0-S19 : code gagnant servi au titulaire authentifié seulement', () => {
  let s: Awaited<ReturnType<typeof demarrer>>

  before(async () => {
    s = await demarrer('strict.db')
    await s.lots(GAGNANT)
  })
  after(async () => {
    await s.app.fermer()
  })

  test('sans jeton (mode strict) : vue limitée, lot affiché mais code null — le code ne fuit pas dans le texte brut', async () => {
    const { client, tirage } = await s.joueur('0612345678')
    assert.equal(tirage.lot, 'Nems offerts')
    const carte = await s.api('GET', `/cartes/${client.id}`)
    assert.equal(carte.statut, 200)
    assert.deepEqual(carte.contenu.jeu, { statut: 'dejaJoue', lotDuJour: 'Nems offerts', codeDuJour: null, remisDuJour: false })
    assert.ok(!carte.texte.includes(tirage.code), 'aucun code gagnant dans la réponse sans jeton')
  })

  test('avec le jeton du titulaire : la carte liste le gain (sans code) ; le code vient de l’activation, à partir de demain', async () => {
    const { client, jeton, tirage } = await s.joueur('0622222222')
    const carte = await s.api('GET', `/cartes/${client.id}`, undefined, s.bearer(jeton))
    assert.equal(carte.statut, 200)
    assert.equal(carte.contenu.acces.vue, 'complete')
    assert.equal(carte.contenu.jeu.codeDuJour, null, 'R3 : plus de code sur la carte, même avec le jeton')
    assert.equal(carte.contenu.jeu.remisDuJour, false)
    assert.deepEqual(carte.contenu.gainsEnCours.map((g: { tirageId: string; statut: string }) => [g.tirageId, g.statut]), [[tirage.tirageId, 'enAttente']])
    assert.ok(!carte.texte.includes(tirage.code))
    assert.equal((await s.activer(tirage.tirageId, s.bearer(jeton))).statut, 409, 'le jour du tirage : pas encore')
    s.lendemain()
    const active = await s.activer(tirage.tirageId, s.bearer(jeton))
    assert.equal(active.statut, 200, active.texte)
    assert.equal(active.contenu.code, tirage.code, 'le titulaire reçoit son code par l’activation')
  })

  test('jeton d’une autre carte ou falsifié : 401 / 404, aucun code (carte et activation)', async () => {
    const a = await s.joueur('0633333333')
    const b = await s.joueur('0644444444')
    s.lendemain()
    const falsifie = `${a.jeton.slice(0, -2)}${a.jeton.at(-2) === 'A' ? 'B' : 'A'}${a.jeton.at(-1)}`
    for (const jeton of [b.jeton, falsifie]) {
      const carte = await s.api('GET', `/cartes/${a.client.id}`, undefined, s.bearer(jeton))
      assert.equal(carte.statut, 401, jeton === b.jeton ? 'jeton d’une autre carte' : 'jeton falsifié')
      assert.ok(!carte.texte.includes(a.tirage.code), 'aucun code dans un refus')
    }
    // Activation du gain de A avec le jeton de B : le tirage n'est pas sur la carte de B → 404, sans code.
    const autre = await s.activer(a.tirage.tirageId, s.bearer(b.jeton))
    assert.equal(autre.statut, 404)
    assert.ok(!autre.texte.includes(a.tirage.code))
    const faux = await s.activer(a.tirage.tirageId, s.bearer(falsifie))
    assert.equal(faux.statut, 401)
    assert.ok(!faux.texte.includes(a.tirage.code))
    const sans = await s.activer(a.tirage.tirageId)
    assert.equal(sans.statut, 401, 'sans jeton')
    assert.ok(!sans.texte.includes(a.tirage.code))
  })

  test('autre téléphone / cache vidé : lien d’accès à usage unique → jeton → activation → code ; le lien ne sert qu’une fois', async () => {
    const { client, tirage } = await s.joueur('0655555555')
    s.lendemain()
    // Lien d'accès du comptoir (15 min), fabriqué ici comme le ferait la fiche client (même signature, même secret).
    const lien = emettreJetonClient(SECRET, {
      typ: 'lien',
      jti: randomUUID(),
      cid: client.id,
      com: AH,
      ver: 0,
      exp: Math.floor(s.horloge.t.getTime() / 1000) + 15 * 60,
    })
    const echange = await s.api('POST', `/cartes/${client.id}/jeton`, { lien })
    assert.equal(echange.statut, 201, echange.texte)
    const active = await s.activer(tirage.tirageId, s.bearer(echange.contenu.jeton as string))
    assert.equal(active.contenu.code, tirage.code, 'le titulaire légitime obtient son code sur un autre téléphone')
    const bis = await s.api('POST', `/cartes/${client.id}/jeton`, { lien })
    assert.equal(bis.statut, 401, 'lien déjà échangé : usage unique')
  })

  test('tirage perdant : jamais de code, ni sur la carte ni par l’activation (409)', async () => {
    await s.lots(PERDANT)
    try {
      const { client, jeton, tirage } = await s.joueur('0666666666')
      assert.equal(tirage.perdant, true)
      const carte = await s.api('GET', `/cartes/${client.id}`, undefined, s.bearer(jeton))
      assert.equal(carte.contenu.jeu.codeDuJour, null)
      assert.ok(!carte.texte.includes(tirage.code), 'code d’un tirage perdant jamais publié')
      s.lendemain()
      const active = await s.activer(tirage.tirageId, s.bearer(jeton))
      assert.equal(active.statut, 409)
      assert.ok(!active.texte.includes(tirage.code), 'code d’un tirage perdant jamais publié')
    } finally {
      await s.lots(GAGNANT)
    }
  })

  test('remise en caisse : activation du titulaire puis remise ; ensuite plus aucun code servi (activation 409)', async () => {
    assert.equal((await s.api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)).statut, 201)
    const { client, jeton, tirage } = await s.joueur('0677777777')
    const gains = `/commerces/${AH}/caisse/gains/${encodeURIComponent(tirage.code)}`
    assert.equal((await s.api('GET', gains, undefined, CODE_EQUIPE)).contenu.gain.statut, 'enAttente')
    s.lendemain()
    assert.equal((await s.api('GET', gains, undefined, CODE_EQUIPE)).contenu.gain.statut, 'inactif')
    assert.equal((await s.activer(tirage.tirageId, s.bearer(jeton))).statut, 200)
    assert.equal((await s.api('GET', gains, undefined, CODE_EQUIPE)).contenu.gain.statut, 'utilisable')
    assert.equal((await s.api('POST', `${gains}/remise`, undefined, CODE_EQUIPE)).statut, 200)
    const carte = await s.api('GET', `/cartes/${client.id}`, undefined, s.bearer(jeton))
    assert.equal(carte.contenu.jeu.codeDuJour, null)
    assert.deepEqual(carte.contenu.gainsEnCours, [], 'gain remis : plus en cours')
    assert.equal(carte.contenu.historiqueLots[0].statut, 'remis')
    const apres = await s.activer(tirage.tirageId, s.bearer(jeton))
    assert.equal(apres.statut, 409)
    assert.ok(!apres.texte.includes(tirage.code))
    // Sans jeton, la remise ne révèle rien de plus.
    assert.ok(!(await s.api('GET', `/cartes/${client.id}`)).texte.includes(tirage.code))
  })

  test('2e tirage : refusé sans révéler le code', async () => {
    const { jeton, tirage } = await s.joueur('0688888888')
    const encore = await s.api('POST', `/commerces/${AH}/tirages`, {}, s.bearer(jeton))
    assert.equal(encore.statut, 409)
    assert.ok(!encore.texte.includes(tirage.code))
  })

  // Revue Codex R3 (F1), modèle décidé le 12/11 : le code ne circule QUE par l'activation (fenêtre de 10 min). L'export
  // du titulaire, qui le contenait (lecture P0-S19 « ses propres données »), donnait un code réutilisable hors fenêtre et
  // hors burn-on-reveal : il porte désormais le statut du gain à la place.
  test('sans jeton (mode strict) : tirage et export RGPD refusés sans révéler de code ; l’export du titulaire donne le statut, jamais le code', async () => {
    const { client, jeton, tirage } = await s.joueur('0610101010')
    // Revue Codex points 1–2 : en transition, ces deux routes par contact seul renvoient encore des codes ; en strict
    // (production par défaut), le jeton y est exigé — c'est ce que ce test verrouille.
    const tirageSansJeton = await s.api('POST', `/commerces/${AH}/tirages`, {})
    assert.equal(tirageSansJeton.statut, 401)
    assert.ok(!tirageSansJeton.texte.includes(tirage.code))
    const donnees = await s.api('POST', `/cartes/${client.id}/donnees`, { contact: '0610101010' })
    assert.equal(donnees.statut, 401, 'export RGPD sans jeton : 401')
    assert.ok(!donnees.texte.includes(tirage.code))
    const exportTitulaire = await s.api('POST', `/cartes/${client.id}/donnees`, { contact: '0610101010' }, s.bearer(jeton))
    assert.equal(exportTitulaire.statut, 200, exportTitulaire.texte)
    assert.ok(!exportTitulaire.texte.includes(tirage.code), 'export RGPD du titulaire : pas de code (seule l’activation le sert)')
    assert.match(exportTitulaire.texte, /Roue du jour;Nems offerts \(gain utilisable à partir de demain\)/)
    const exportCommercant = await s.api('GET', `/commerces/${AH}/clients/${client.id}/export.csv`, undefined, PIN)
    assert.equal(exportCommercant.statut, 200, exportCommercant.texte)
    assert.ok(!exportCommercant.texte.includes(tirage.code), 'export RGPD côté commerçant : pas de code non plus')
    assert.match(exportCommercant.texte, /Nems offerts \(gain utilisable à partir de demain\)/)
  })
})

describe('P0-S19 : sans SESSION_SECRET (transition, développement seulement — revue Codex point 4)', () => {
  let s: Awaited<ReturnType<typeof demarrer>>

  before(async () => {
    s = await demarrer('sans-secret.db', { authClient: 'transition', secretSession: undefined })
    await s.lots(GAGNANT)
  })
  after(async () => {
    await s.app.fermer()
  })

  test('sans secret, aucun jeton ne peut être émis : aucun code n’est jamais servi au client (activation 503)', async () => {
    const { client } = await s.inscrire('0612121212')
    await s.visite(client.id)
    // R3 : même le tirage par contact seul (transition) ne rend plus de code ; sans secret, l'activation (seule source
    // du code) est indisponible — développement seulement, la production exige SESSION_SECRET.
    const t = await s.api('POST', `/commerces/${AH}/tirages`, { contact: '0612121212' })
    assert.equal(t.statut, 201, t.texte)
    assert.equal(t.contenu.code, undefined)
    const carte = await s.api('GET', `/cartes/${client.id}`)
    assert.equal(carte.contenu.jeu.codeDuJour, null)
    assert.equal((await s.api('POST', `/cartes/${client.id}/jeton`, {})).statut, 503, 'aucun jeton sans SESSION_SECRET')
    s.lendemain()
    assert.equal((await s.activer(t.contenu.tirageId as string)).statut, 503, 'pas d’activation sans SESSION_SECRET')
  })
})

describe('P0-S19 : mode transition — vue complète sans jeton, mais sans code', () => {
  let s: Awaited<ReturnType<typeof demarrer>>

  before(async () => {
    s = await demarrer('transition.db', { authClient: 'transition' })
    await s.lots(GAGNANT)
  })
  after(async () => {
    await s.app.fermer()
  })

  test('sans jeton : vue complète (prénom visible) mais aucun code, activation refusée (401) ; avec jeton : code par l’activation', async () => {
    const { client, jeton, tirage } = await s.joueur('0699999999')
    const sans = await s.api('GET', `/cartes/${client.id}`)
    assert.equal(sans.statut, 200)
    assert.equal(sans.contenu.acces.vue, 'complete')
    assert.ok('prenom' in sans.contenu.client, 'vue complète en transition (prénom servi, pas seulement les tampons)')
    assert.equal(sans.contenu.jeu.codeDuJour, null, 'même en vue complète, pas de code sans jeton')
    assert.ok(!sans.texte.includes(tirage.code))
    s.lendemain()
    const activationSans = await s.activer(tirage.tirageId)
    assert.equal(activationSans.statut, 401, 'R3 : jeton exigé pour activer, même en mode transition')
    assert.ok(!activationSans.texte.includes(tirage.code))
    const avec = await s.api('GET', `/cartes/${client.id}`, undefined, s.bearer(jeton))
    assert.equal(avec.contenu.jeu.codeDuJour, null)
    assert.equal((await s.activer(tirage.tirageId, s.bearer(jeton))).contenu.code, tirage.code)
  })
})

// Correction Codex point 3 — changer le PIN d'un commerce (PUT /commerces/:id/pin) invalide les sessions
// `commerce` de CE commerce ouvertes avant : le jeton porte la version du PIN (`vp`), comparée à chaque requête à
// la version stockée dans `meta` (`version_pin:<commerce>`, absente = 0). Les sessions des autres commerces, les
// sessions admin et équipe ne sont pas touchées ; un jeton sans `vp` (émis avant la correction) vaut version 0.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, emettreJeton, lireJeton } from '../server/app.ts'

const AH = 'c-asian-home-paris'
const ADMIN = '98765432'
const SECRET = 'secret-de-test-point3-au-moins-32-caracteres-0123456789'
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-point3-'))
const horloge = { t: new Date('2023-01-10T12:00:00Z') }

async function demarrer(nom: string) {
  const app = await creerServeur({
    fichierDb: join(dossier, nom),
    adminPin: ADMIN,
    pinInitial: '1234',
    version: 'test',
    secretSession: SECRET,
    authClient: 'stricte',
    maintenant: () => horloge.t,
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
  return { app, api }
}

describe('Correction Codex point 3 : changement de PIN commerçant ⇒ sessions invalidées', async () => {
  after(() => rmSync(dossier, { recursive: true, force: true }))

  test('le PUT /pin tue les sessions commerce de CE commerce, pas celles des autres, ni admin ni équipe', async () => {
    const s = await demarrer('point3.db')
    try {
      const etat = (id: string, jeton: string) => s.api('GET', `/commerces/${id}/etat`, undefined, { 'X-Session': jeton })
      const ouvrir = (corps: Record<string, string>) => s.api('POST', '/sessions', corps)

      const admin = (await ouvrir({ role: 'admin', pin: ADMIN })).contenu.jeton as string
      const autreId = (await s.api('POST', '/commerces', { nom: 'Chez Lin', type: 'restaurant', lienGoogle: '', pin: '5555' }, { 'X-Admin-PIN': ADMIN })).contenu.commerce.id as string
      const sessionAutre = (await ouvrir({ role: 'commerce', commerceId: autreId, pin: '5555' })).contenu.jeton as string
      const membre = await s.api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, { 'X-Commerce-PIN': '1234' })
      assert.equal(membre.statut, 201)
      const ouvertureEquipe = await ouvrir({ role: 'equipe', commerceId: AH, code: '2468' })
      assert.equal(ouvertureEquipe.statut, 201, 'session équipe ouverte')
      const equipe = ouvertureEquipe.contenu.jeton as string
      const ouverte = await ouvrir({ role: 'commerce', commerceId: AH, pin: '1234' })
      assert.equal(ouverte.statut, 201)
      assert.ok(!('vp' in ouverte.contenu), 'la charge du jeton n’est pas renvoyée')
      const session = ouverte.contenu.jeton as string

      assert.equal((await etat(AH, session)).statut, 200)
      assert.equal((await etat(autreId, sessionAutre)).statut, 200)
      assert.equal((await etat(AH, admin)).statut, 200)
      assert.equal((await s.api('GET', `/commerces/${AH}/caisse`, undefined, { 'X-Session': equipe })).statut, 200)

      assert.equal((await s.api('PUT', `/commerces/${AH}/pin`, { pin: '5678' }, { 'X-Session': session })).statut, 200)

      const apres = await etat(AH, session)
      assert.equal(apres.statut, 401, 'la session d’avant le changement est morte')
      assert.match(apres.contenu.erreur ?? JSON.stringify(apres.contenu), /code du commerce a changé/)
      assert.equal((await ouvrir({ role: 'commerce', commerceId: AH, pin: '1234' })).statut, 401, 'ancien PIN mort')
      const nouvelle = await ouvrir({ role: 'commerce', commerceId: AH, pin: '5678' })
      assert.equal(nouvelle.statut, 201, 'nouveau PIN OK')
      assert.equal((await etat(AH, nouvelle.contenu.jeton)).statut, 200, 'la nouvelle session marche')

      assert.equal((await etat(autreId, sessionAutre)).statut, 200, 'autre commerce non touché')
      assert.equal((await etat(AH, admin)).statut, 200, 'session admin non touchée')
      assert.equal((await s.api('GET', `/commerces/${AH}/caisse`, undefined, { 'X-Session': equipe })).statut, 200, 'session équipe non touchée')
    } finally {
      await s.app.fermer()
    }

    // La version vit en base : après redémarrage (cache mémoire vide), l'ancienne session reste refusée.
    const s2 = await demarrer('point3.db')
    try {
      const nouvelle = (await s2.api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '5678' })).contenu.jeton as string
      assert.equal((await s2.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': nouvelle })).statut, 200)
    } finally {
      await s2.app.fermer()
    }
  })

  test('jeton sans `vp` (émis avant la correction) = version 0 ; `vp` non entier refusé', async () => {
    const s = await demarrer('point3-ancien.db')
    try {
      const exp = Math.floor(horloge.t.getTime() / 1000) + 3600
      const ancien = emettreJeton(SECRET, { jti: randomUUID(), role: 'commerce', commerceId: AH, exp })
      assert.equal((await s.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': ancien })).statut, 200, 'ancien jeton accepté tant que le PIN n’a pas changé')
      const bidon = emettreJeton(SECRET, { jti: randomUUID(), role: 'commerce', commerceId: AH, exp, vp: '0' as unknown as number })
      assert.equal(lireJeton(SECRET, bidon), null)
      assert.equal((await s.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': bidon })).statut, 401)

      assert.equal((await s.api('PUT', `/commerces/${AH}/pin`, { pin: '5678' }, { 'X-Admin-PIN': ADMIN })).statut, 200)
      assert.equal((await s.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': ancien })).statut, 401, 'ancien jeton mort après changement de PIN')
      const ancienV1 = emettreJeton(SECRET, { jti: randomUUID(), role: 'commerce', commerceId: AH, exp, vp: 1 })
      assert.equal((await s.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': ancienV1 })).statut, 200, 'version courante acceptée')
    } finally {
      await s.app.fermer()
    }
  })
})

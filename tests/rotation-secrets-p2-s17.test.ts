// P2-S17 — Rotation des secrets, testée en local (serveur de test, base SQLite temporaire) :
// - SESSION_SECRET : même base rouverte avec un nouveau secret — ancien jeton de session → 401,
//   ancien jeton client → 401, nouvelle session avec le PIN (inchangé) → 201, état métier conservé
//   (même commerce, même client, mêmes champs), retour arrière vérifié.
// - PIN commerce (PUT /pin) : ancien PIN → 401, nouveau PIN → 201, ET la session ouverte AVANT le
//   changement reste valable — la rotation du PIN ne révoque pas les sessions (docs/SECURITE.md § 4 :
//   seule une rotation de SESSION_SECRET les invalide toutes).
// Aucune rotation réelle : secrets de test seulement, aucune variable Render touchée, aucune clé
// Supabase / Brevo / Google manipulée. La rotation de SUPABASE_SERVICE_ROLE_KEY contre le vrai
// Supabase reste à tester sur staging (inexistant — docs/SECURITE.md § 8).
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'

const AH = 'c-asian-home-paris'
const SECRET_A = 'secret-de-test-p2-s17-A-au-moins-32-caracteres-0123456789'
const SECRET_B = 'secret-de-test-p2-s17-B-au-moins-32-caracteres-0123456789'
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p2-s17-'))

async function demarrer(nom: string, secretSession: string) {
  const horloge = { t: new Date('2023-01-10T12:00:00Z') }
  const app = await creerServeur({
    fichierDb: join(dossier, nom),
    adminPin: '98765432',
    pinInitial: '1234',
    version: 'test',
    secretSession,
    authClient: 'stricte',
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
  return { app, api }
}

describe('P2-S17 : rotation des secrets (test local)', async () => {
  after(() => rmSync(dossier, { recursive: true, force: true }))

  test('rotation SESSION_SECRET : anciens jetons morts (401), PIN inchangé, état conservé, retour arrière', async () => {
    const s1 = await demarrer('rotation-secret.db', SECRET_A)
    const session = (await s1.api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '1234' })).contenu.jeton as string
    const sessionAdmin = (await s1.api('POST', '/sessions', { role: 'admin', pin: '98765432' })).contenu.jeton as string
    const sessionEquipe = (await s1.api('POST', '/sessions', { role: 'equipe', commerceId: AH, code: '2468' })).contenu.jeton as string
    assert.equal((await s1.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': session })).statut, 200)
    const inscription = await s1.api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '06 12 34 56 78' })
    assert.equal(inscription.statut, 201)
    const clientId = inscription.contenu.client.id as string
    const jetonClient = inscription.contenu.jeton as string
    assert.equal(typeof jetonClient, 'string')
    assert.equal((await s1.api('GET', `/cartes/${clientId}`, undefined, { Authorization: `Bearer ${jetonClient}` })).statut, 200)
    // État métier de référence avant rotation (comparé après, pas seulement l'identifiant).
    const etatAvant = (await s1.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': session })).contenu as {
      commerce: { nom: string }
      clients: { id: string; prenom: string; tampons: number; points: number }[]
    }
    await s1.app.fermer()

    // Même base, nouveau secret : c'est la rotation (redémarrage avec la nouvelle variable Render).
    const s2 = await demarrer('rotation-secret.db', SECRET_B)
    try {
      assert.equal((await s2.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': session })).statut, 401, 'ancien jeton gérant mort')
      assert.equal((await s2.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': sessionAdmin })).statut, 401, 'ancien jeton admin mort')
      assert.equal((await s2.api('GET', `/commerces/${AH}/caisse`, undefined, { 'X-Session': sessionEquipe })).statut, 401, 'ancien jeton équipe mort')
      assert.equal((await s2.api('GET', `/cartes/${clientId}`, undefined, { Authorization: `Bearer ${jetonClient}` })).statut, 401, 'ancien jeton client mort')
      // Le PIN n'a pas changé : une nouvelle session s'ouvre avec lui.
      const nouvelle = await s2.api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '1234' })
      assert.equal(nouvelle.statut, 201)
      assert.equal((await s2.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': nouvelle.contenu.jeton })).statut, 200)
      // État conservé : même commerce, même client avec les mêmes champs.
      const etatApres = (await s2.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': nouvelle.contenu.jeton })).contenu as typeof etatAvant
      assert.equal(etatApres.commerce.nom, etatAvant.commerce.nom)
      assert.deepEqual(
        etatApres.clients.map((c) => ({ id: c.id, prenom: c.prenom, tampons: c.tampons, points: c.points })),
        etatAvant.clients.map((c) => ({ id: c.id, prenom: c.prenom, tampons: c.tampons, points: c.points })),
      )
    } finally {
      await s2.app.fermer()
    }

    // Retour arrière documenté (docs/SECURITE.md § 2) : l'ancien secret rouvre les anciens jetons non expirés.
    const s3 = await demarrer('rotation-secret.db', SECRET_A)
    try {
      assert.equal((await s3.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': session })).statut, 200, 'ancien secret remis : ancien jeton revit')
    } finally {
      await s3.app.fermer()
    }
  })

  test('rotation PIN commerce : ancien PIN mort, nouveau PIN OK, session d’avant toujours valable', async () => {
    const s = await demarrer('rotation-pin.db', SECRET_A)
    try {
      const session = (await s.api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '1234' })).contenu.jeton as string
      assert.equal((await s.api('PUT', `/commerces/${AH}/pin`, { pin: '5678' }, { 'X-Session': session })).statut, 200)
      assert.equal((await s.api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '1234' })).statut, 401, 'ancien PIN mort')
      assert.equal((await s.api('POST', '/sessions', { role: 'commerce', commerceId: AH, pin: '5678' })).statut, 201, 'nouveau PIN OK')
      assert.equal((await s.api('PUT', `/commerces/${AH}/pin`, { pin: '12' }, { 'X-Session': session })).statut, 400, 'PIN trop court refusé')
      // Nuance documentée (docs/SECURITE.md § 4) : la session ouverte AVANT le changement reste valable —
      // changer le PIN ne révoque pas les sessions, seule une rotation de SESSION_SECRET le fait.
      assert.equal((await s.api('GET', `/commerces/${AH}/etat`, undefined, { 'X-Session': session })).statut, 200)
    } finally {
      await s.app.fermer()
    }
  })
})

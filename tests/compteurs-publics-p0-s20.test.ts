// P0-S20 — Persistance des compteurs publics (AUDIT.md §7, revue Codex point 6). Vrai serveur HTTP, base SQLite
// temporaire, horloge pilotée. Les limites publiques (`LIMITES_PUBLIQUES`) ne sont plus remises à zéro au redémarrage :
// un compteur « chaud » (au moins la moitié de son seuil) est persisté en base (migration 0010) et rechargé au
// démarrage ; un compteur froid ne coûte aucune écriture — et ne peut pas provoquer de 429 juste après un redémarrage
// de toute façon. Les tests Supabase (faux PostgREST, table absente) sont dans tests/supabase.test.ts (describe P0-S20).
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, SEUIL_PERSISTANCE_COMPTEURS } from '../server/app.ts'
import { ouvrirStockage } from '../server/stockage.ts'
import type { Client } from '../src/types.ts'

const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
/** Seuil de lecture par carte = 3 → seuil de persistance = 2 (moitié, arrondie au-dessus). */
const LIMITES = { lectureParCarte: 3 }

const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p0s20-'))
after(() => rmSync(dossier, { recursive: true, force: true }))

async function demarrer(nom: string, horloge: { t: Date }) {
  const app = await creerServeur({
    fichierDb: join(dossier, nom),
    adminPin: '98765432',
    pinInitial: '1234',
    version: 'test',
    maintenant: () => horloge.t,
    limitesPubliques: LIMITES,
  })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    return { statut: r.status, contenu: await r.json(), entetes: r.headers }
  }
  /** Client inscrit (PIN gérant) : sa carte est la cible des lectures limitées. */
  async function client() {
    const r = await api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0612345678' }, PIN)
    assert.equal(r.statut, 201, JSON.stringify(r.contenu))
    return (r.contenu.client as Client).id
  }
  return { app, api, client, fichierDb: join(dossier, nom) }
}

/** Laisse les écritures de persistance (en arrière-plan) arriver avant le redémarrage. */
const laisserPersister = () => new Promise((r) => setTimeout(r, 50))

describe('P0-S20 : compteurs publics persistants (SQLite)', () => {
  test('seuil de persistance = moitié du seuil de la limite', () => {
    assert.equal(SEUIL_PERSISTANCE_COMPTEURS, 1 / 2)
  })

  test('compteur chaud survit au redémarrage : 2 lectures → redémarrage → 3e OK, 4e 429', async () => {
    const horloge = { t: new Date(2026, 10, 10, 12, 0) }
    let s = await demarrer('chaud.db', horloge)
    const id = await s.client()
    try {
      assert.equal((await s.api('GET', `/cartes/${id}`)).statut, 200)
      assert.equal((await s.api('GET', `/cartes/${id}`)).statut, 200)
      await laisserPersister()
      // Preuve du mécanisme : la ligne est en base, avec la clé et le nombre exacts.
      const st = ouvrirStockage(s.fichierDb)
      try {
        assert.deepEqual(await st.compteursPublics(), [{ cle: `carte:${id}`, debut: horloge.t.toISOString(), n: 2 }])
      } finally {
        st.fermer()
      }
    } finally {
      await s.app.fermer()
    }
    s = await demarrer('chaud.db', horloge)
    try {
      assert.equal((await s.api('GET', `/cartes/${id}`)).statut, 200, '3e lecture de la fenêtre : rechargée depuis la base')
      const bloque = await s.api('GET', `/cartes/${id}`)
      assert.equal(bloque.statut, 429, '4e lecture : toujours bloquée après redémarrage')
      assert.ok(Number(bloque.entetes.get('retry-after')) > 0)
    } finally {
      await s.app.fermer()
    }
  })

  test('blocage survit au redémarrage : 429 avant, 429 juste après — et le compteur saturé n’écrit plus', async () => {
    const horloge = { t: new Date(2026, 10, 10, 12, 0) }
    let s = await demarrer('blocage.db', horloge)
    const id = await s.client()
    try {
      for (let i = 0; i < 3; i++) assert.equal((await s.api('GET', `/cartes/${id}`)).statut, 200)
      assert.equal((await s.api('GET', `/cartes/${id}`)).statut, 429)
      // Requêtes déjà bloquées : toujours 429, mais plus aucune écriture (revue Codex point 1) — le compteur
      // sature à son seuil, sinon chaque requête d'une attaque en cours écrirait sans borne.
      for (let i = 0; i < 3; i++) assert.equal((await s.api('GET', `/cartes/${id}`)).statut, 429)
      await laisserPersister()
      const st = ouvrirStockage(s.fichierDb)
      try {
        assert.deepEqual(await st.compteursPublics(), [{ cle: `carte:${id}`, debut: horloge.t.toISOString(), n: 3 }], 'n reste à 3 malgré les 429 suivantes')
      } finally {
        st.fermer()
      }
    } finally {
      await s.app.fermer()
    }
    s = await demarrer('blocage.db', horloge)
    try {
      assert.equal((await s.api('GET', `/cartes/${id}`)).statut, 429, 'blocage rechargé : immédiat après redémarrage')
    } finally {
      await s.app.fermer()
    }
  })

  test('compteur froid (sous la moitié du seuil) : perdu au redémarrage — sans conséquence, documenté', async () => {
    const horloge = { t: new Date(2026, 10, 10, 12, 0) }
    let s = await demarrer('froid.db', horloge)
    const id = await s.client()
    try {
      assert.equal((await s.api('GET', `/cartes/${id}`)).statut, 200)
      await laisserPersister()
      const st = ouvrirStockage(s.fichierDb)
      try {
        assert.deepEqual(await st.compteursPublics(), [], '1 lecture < seuil de persistance (2) : aucune écriture')
      } finally {
        st.fermer()
      }
    } finally {
      await s.app.fermer()
    }
    s = await demarrer('froid.db', horloge)
    try {
      for (let i = 0; i < 3; i++) assert.equal((await s.api('GET', `/cartes/${id}`)).statut, 200, 'compteur reparti de zéro : 3 lectures passent')
      assert.equal((await s.api('GET', `/cartes/${id}`)).statut, 429)
    } finally {
      await s.app.fermer()
    }
  })

  test('fenêtre expirée : le compteur rechargé ne bloque pas', async () => {
    const horloge = { t: new Date(2026, 10, 10, 12, 0) }
    let s = await demarrer('expire.db', horloge)
    const id = await s.client()
    try {
      assert.equal((await s.api('GET', `/cartes/${id}`)).statut, 200)
      assert.equal((await s.api('GET', `/cartes/${id}`)).statut, 200)
      await laisserPersister()
    } finally {
      await s.app.fermer()
    }
    horloge.t = new Date(2026, 10, 10, 12, 1, 5) // +65 s : la fenêtre d'une minute est passée.
    s = await demarrer('expire.db', horloge)
    try {
      assert.equal((await s.api('GET', `/cartes/${id}`)).statut, 200, 'ligne persistée périmée : ignorée au rechargement')
    } finally {
      await s.app.fermer()
    }
  })
})

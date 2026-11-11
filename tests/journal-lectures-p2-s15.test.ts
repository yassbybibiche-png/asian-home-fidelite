// P2-S15 — Journal des lectures sensibles : un échantillon des lectures `GET /cartes/:id` et
// `GET /commerces` est journalisé (console.info, `[lecture-sensible]`) pour détecter une énumération —
// beaucoup d'identifiants distincts, beaucoup de 404, depuis une même IP. Échantillonnage obligatoire
// (volume) : `journalLectures.taux` (défaut 0,1) ; 1 = tout, 0 = rien. L'identifiant de carte n'est jamais
// écrit en clair : empreinte SHA-256 tronquée (12 car. hex.), stable par carte, distincte par carte.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'

const AH = 'c-asian-home-paris'
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p2-s15-'))

async function demarrer(nom: string, taux: number, journalSupp: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const horloge = { t: new Date('2023-01-10T12:00:00Z') }
  const app = await creerServeur({
    fichierDb: join(dossier, nom),
    adminPin: '98765432',
    pinInitial: '1234',
    version: 'test',
    secretSession: 'secret-de-test-p2-s15-au-moins-32-caracteres-0123456789',
    journalLectures: { taux, ...journalSupp },
    maintenant: () => horloge.t,
    limitesPubliques: { inscriptionParIp: 1000, inscriptionParContact: 1000, ficheClientParIp: 1000, lectureParIp: 1000, lectureParCarte: 1000, tirageParIp: 1000, tirageParContact: 1000 },
    ...extra,
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

/** Capture `console.info` pendant un bloc, puis restaure — ne garde que les lignes du journal des lectures. */
function capturer() {
  const lignes: string[] = []
  const origine = console.info
  console.info = (...a: unknown[]) => {
    lignes.push(a.map(String).join(' '))
  }
  return {
    lignes: () => lignes.filter((l) => l.startsWith('[lecture-sensible]')),
    restaurer: () => {
      console.info = origine
    },
  }
}

describe('P2-S15 : journal des lectures sensibles', async () => {
  after(() => rmSync(dossier, { recursive: true, force: true }))

  test('GET /cartes/:id : une ligne par lecture (taux 1), empreinte stable, jamais l’id en clair', async () => {
    const s = await demarrer('lecture-carte.db', 1)
    try {
      const { client } = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '06 12 34 56 78' })).contenu
      const id = client.id as string
      const c = capturer()
      try {
        assert.equal((await s.api('GET', `/cartes/${id}`)).statut, 200)
        assert.equal((await s.api('GET', `/cartes/${id}`)).statut, 200)
      } finally {
        c.restaurer()
      }
      const lignes = c.lignes()
      assert.equal(lignes.length, 2)
      for (const l of lignes) {
        assert.match(l, /\[lecture-sensible\] carte id=[0-9a-f]{12} ip=127\.0\.0\.1 statut=200/)
        assert.ok(!l.includes(id), 'identifiant de carte jamais écrit en clair dans les logs')
      }
      // Empreinte stable pour la même carte…
      const empreinte = (lignes[0].match(/id=([0-9a-f]{12})/) as RegExpMatchArray)[1]
      assert.equal((lignes[1].match(/id=([0-9a-f]{12})/) as RegExpMatchArray)[1], empreinte)
      // … distincte pour une autre carte.
      const autre = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Marc', contact: '06 98 76 54 32' })).contenu.client.id as string
      const c2 = capturer()
      try {
        assert.equal((await s.api('GET', `/cartes/${autre}`)).statut, 200)
      } finally {
        c2.restaurer()
      }
      assert.notEqual((c2.lignes()[0].match(/id=([0-9a-f]{12})/) as RegExpMatchArray)[1], empreinte)
    } finally {
      await s.app.fermer()
    }
  })

  test('GET /cartes/:id inconnue : ligne 404 ; GET /commerces : ligne avec le nombre de commerces', async () => {
    const s = await demarrer('lecture-404.db', 1)
    try {
      const c = capturer()
      let nbCommerces = -1
      try {
        assert.equal((await s.api('GET', '/cartes/cl-inconnu')).statut, 404)
        const commerces = await s.api('GET', '/commerces')
        assert.equal(commerces.statut, 200)
        assert.ok(Array.isArray(commerces.contenu.commerces))
        nbCommerces = commerces.contenu.commerces.length
      } finally {
        c.restaurer()
      }
      const lignes = c.lignes()
      assert.equal(lignes.length, 2)
      assert.match(lignes[0], /\[lecture-sensible\] carte id=[0-9a-f]{12} ip=127\.0\.0\.1 statut=404/)
      assert.match(lignes[1], new RegExp(`\\[lecture-sensible\\] commerces ip=127\\.0\\.0\\.1 statut=200 nb=${nbCommerces}`))
    } finally {
      await s.app.fermer()
    }
  })

  test('identifiant encodé : même empreinte en succès et en échec (décodage uniforme, revue Codex point 1)', async () => {
    const s = await demarrer('lecture-encode.db', 1)
    try {
      const attendue = createHash('sha256').update('cl-inconnu').digest('hex').slice(0, 12)
      const c = capturer()
      try {
        assert.equal((await s.api('GET', '/cartes/%63l-inconnu')).statut, 404)
      } finally {
        c.restaurer()
      }
      assert.equal(c.lignes().length, 1)
      assert.ok(c.lignes()[0].includes(`id=${attendue}`), `empreinte de l’id décodé attendue, reçu : ${c.lignes()[0]}`)
    } finally {
      await s.app.fermer()
    }
  })

  test('401 (jeton falsifié) et 429 (limite par IP) : journalisés aussi, avec leur statut', async () => {
    const s = await demarrer('lecture-401-429.db', 1, {}, { limitesPubliques: { lectureParIp: 3 } })
    try {
      const { client } = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '06 12 34 56 78' })).contenu
      const c = capturer()
      try {
        assert.equal((await s.api('GET', `/cartes/${client.id}`, undefined, { Authorization: 'Bearer faux' })).statut, 401)
        assert.equal((await s.api('GET', `/cartes/${client.id}`)).statut, 200)
        assert.equal((await s.api('GET', `/cartes/${client.id}`)).statut, 200)
        assert.equal((await s.api('GET', `/cartes/${client.id}`)).statut, 429)
      } finally {
        c.restaurer()
      }
      const lignes = c.lignes()
      assert.deepEqual(lignes.map((l) => (l.match(/statut=(\d+)/) as RegExpMatchArray)[1]), ['401', '200', '200', '429'])
    } finally {
      await s.app.fermer()
    }
  })

  test('taux intermédiaire (0,5) et bornes (2 → 1, -1 → 0) : échantillonnage déterministe', async () => {
    const s = await demarrer('taux-05.db', 0.5)
    try {
      const aleatoire = Math.random
      try {
        Math.random = () => 0.4
        const c1 = capturer()
        try {
          assert.equal((await s.api('GET', '/cartes/cl-inconnu')).statut, 404)
        } finally {
          c1.restaurer()
        }
        assert.equal(c1.lignes().length, 1, '0,4 < 0,5 : journalisé')
        Math.random = () => 0.6
        const c2 = capturer()
        try {
          assert.equal((await s.api('GET', '/cartes/cl-inconnu')).statut, 404)
        } finally {
          c2.restaurer()
        }
        assert.equal(c2.lignes().length, 0, '0,6 >= 0,5 : non journalisé')
      } finally {
        Math.random = aleatoire
      }
    } finally {
      await s.app.fermer()
    }
    const sHaut = await demarrer('taux-2.db', 2)
    try {
      const c = capturer()
      try {
        for (let i = 0; i < 3; i++) assert.equal((await sHaut.api('GET', `/cartes/cl-inconnu-${i}`)).statut, 404)
      } finally {
        c.restaurer()
      }
      assert.equal(c.lignes().length, 3, 'taux 2 borné à 1 : tout est journalisé')
    } finally {
      await sHaut.app.fermer()
    }
    const sBas = await demarrer('taux-moins1.db', -1)
    try {
      const c = capturer()
      try {
        assert.equal((await sBas.api('GET', '/cartes/cl-inconnu')).statut, 404)
      } finally {
        c.restaurer()
      }
      assert.equal(c.lignes().length, 0, 'taux -1 borné à 0 : rien n’est journalisé')
    } finally {
      await sBas.app.fermer()
    }
  })

  test('plafond : au-delà de N lignes/min, les suivantes sont comptées puis résumées à la minute suivante', async () => {
    const s = await demarrer('plafond.db', 1, { plafond: 2 })
    try {
      const c = capturer()
      try {
        for (let i = 0; i < 3; i++) assert.equal((await s.api('GET', `/cartes/cl-inconnu-${i}`)).statut, 404)
        assert.equal(c.lignes().length, 2, 'plafond 2 : la 3e ligne est supprimée, pas écrite')
        s.horloge.t = new Date(s.horloge.t.getTime() + 61_000)
        assert.equal((await s.api('GET', '/cartes/cl-inconnu-9')).statut, 404)
      } finally {
        c.restaurer()
      }
      const lignes = c.lignes()
      assert.equal(lignes.length, 4)
      assert.match(lignes[2], /\[lecture-sensible\] plafond 2 lignes\/min atteint : 1 ligne\(s\) supprimée\(s\) la minute précédente/)
      assert.match(lignes[3], /statut=404/)
    } finally {
      await s.app.fermer()
    }
  })

  test('erreur interne sur /cartes/:id : l’identifiant est masqué dans console.error (revue Codex point 2)', async () => {
    const s = await demarrer('erreur-masquee.db', 1)
    try {
      const erreurs: string[] = []
      const origine = console.error
      console.error = (...a: unknown[]) => {
        erreurs.push(a.map(String).join(' '))
      }
      try {
        // Encodage invalide : decodeURIComponent lève (erreur non HTTP → 500 + console.error).
        assert.equal((await s.api('GET', '/cartes/cl-test%ZZ')).statut, 500)
      } finally {
        console.error = origine
      }
      assert.ok(erreurs.length >= 1)
      assert.ok(erreurs.every((l) => !l.includes('cl-test')), `id en clair dans console.error : ${JSON.stringify(erreurs)}`)
      assert.ok(erreurs.some((l) => l.includes('/cartes/…')), `chemin masqué attendu, reçu : ${JSON.stringify(erreurs)}`)
    } finally {
      await s.app.fermer()
    }
  })

  test('énumération détectable : 20 identifiants distincts depuis une même IP → 20 lignes, 20 empreintes, 20 × 404', async () => {
    const s = await demarrer('enumeration.db', 1)
    try {
      const c = capturer()
      try {
        for (let i = 0; i < 20; i++) assert.equal((await s.api('GET', `/cartes/cl-inconnu-${i}`)).statut, 404)
      } finally {
        c.restaurer()
      }
      const lignes = c.lignes()
      assert.equal(lignes.length, 20)
      const empreintes = new Set(lignes.map((l) => (l.match(/id=([0-9a-f]{12})/) as RegExpMatchArray)[1]))
      assert.equal(empreintes.size, 20, 'chaque identifiant sondé a sa propre empreinte : la rafale se compte')
      assert.ok(lignes.every((l) => /statut=404/.test(l) && /ip=127\.0\.0\.1/.test(l)))
    } finally {
      await s.app.fermer()
    }
  })

  test('taux 0 : rien n’est journalisé ; autres routes : rien non plus', async () => {
    const s = await demarrer('taux-0.db', 0)
    try {
      const c = capturer()
      try {
        assert.equal((await s.api('GET', '/cartes/cl-inconnu')).statut, 404)
        assert.equal((await s.api('GET', '/commerces')).statut, 200)
        assert.equal((await s.api('GET', '/sante')).statut, 200)
      } finally {
        c.restaurer()
      }
      assert.equal(c.lignes().length, 0)
    } finally {
      await s.app.fermer()
    }
    const s1 = await demarrer('autres-routes.db', 1)
    try {
      const c = capturer()
      try {
        // Tirage sans visite (409) et santé : lectures sensibles, non — aucune ligne.
        assert.equal((await s1.api('POST', `/commerces/${AH}/tirages`, { contact: '06 12 34 56 78' })).statut, 409)
        assert.equal((await s1.api('GET', '/sante')).statut, 200)
      } finally {
        c.restaurer()
      }
      assert.equal(c.lignes().length, 0)
    } finally {
      await s1.app.fermer()
    }
  })
})

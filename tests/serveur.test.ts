// Tests HTTP du serveur (server/) : vrai serveur sur un port éphémère, vraie base SQLite temporaire, `fetch`.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, type OptionsServeur } from '../server/app.ts'
import type { Client, Commerce } from '../src/types.ts'

const ADMIN = '98765432'
const ASIAN_HOME = 'c-asian-home-paris'

// Horloge du serveur pilotée par le test : midi, 9 novembre 2026 (heure locale).
let horloge = new Date(2026, 10, 9, 12, 0)

async function demarrer(fichierDb: string, options: Partial<OptionsServeur> = {}) {
  const app = creerServeur({ fichierDb, adminPin: ADMIN, pinInitial: '1234', version: 'test', maintenant: () => horloge, ...options })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    const type = r.headers.get('content-type') ?? ''
    const contenu = type.includes('json') ? await r.json() : await r.text()
    return { statut: r.status, contenu, entetes: r.headers }
  }
  return { app, api }
}

describe('Serveur /api/v1', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-test-'))
  const fichierDb = join(dossier, 'fidelite.db')
  let srv: Awaited<ReturnType<typeof demarrer>>
  const pin = { 'X-Commerce-PIN': '4321' }
  let commerceId = ''
  let client: Client

  before(async () => {
    srv = await demarrer(fichierDb)
  })
  after(async () => {
    await srv.app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('node:sqlite est utilisable dans ce Node (sinon il faudrait le repli JSON)', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE t (x TEXT)')
    db.prepare('INSERT INTO t VALUES (?)').run('ok')
    assert.deepEqual({ ...(db.prepare('SELECT x FROM t').get() as object) }, { x: 'ok' })
    db.close()
  })

  test('santé', async () => {
    const r = await srv.api('GET', '/sante')
    assert.equal(r.statut, 200)
    assert.equal(r.contenu.ok, true)
    assert.equal(r.contenu.version, 'test')
    assert.ok(r.contenu.mode)
  })

  test('base neuve : Asian Home Paris seul, réel, vide, sans hash PIN exposé', async () => {
    const r = await srv.api('GET', '/commerces')
    assert.equal(r.statut, 200)
    assert.deepEqual(r.contenu.commerces.map((c: Commerce) => c.id), [ASIAN_HOME])
    const ah = r.contenu.commerces[0]
    assert.equal(ah.nom, 'Asian Home Paris')
    assert.equal(ah.demo, false)
    assert.equal(ah.lienGoogle, 'https://search.google.com/local/writereview?placeid=ChIJAV70Kqxt5kcRnhPY0L6yaf0')
    assert.match(ah.coordonnees, /11 rue André Joineau, 93310 Le Pré-Saint-Gervais/)
    assert.match(ah.coordonnees, /07 82 97 48 01/)
    assert.match(ah.coordonnees, /@asianhomeparis/)
    assert.deepEqual(ah.lots.map((l: { libelle: string }) => l.libelle).slice(0, 4), ['Nems offerts', 'Thé glacé maison offert', 'Mochi offert', '-10 % sur l’addition'])
    assert.doesNotMatch(JSON.stringify(r.contenu), /pin|hash|sel/i)

    const etat = await srv.api('GET', `/commerces/${ASIAN_HOME}/etat`, undefined, { 'X-Commerce-PIN': '1234' })
    assert.equal(etat.statut, 200)
    assert.deepEqual([etat.contenu.clients.length, etat.contenu.tirages.length, etat.contenu.avis.length], [0, 0, 0])
  })

  test('création d’un commerce : PIN admin obligatoire', async () => {
    const corps = { nom: 'Chez Lin', type: 'restaurant', lienGoogle: 'https://g.page/r/x/review', pin: '4321', seuilTampons: 3, recompense: 'Un dessert offert' }
    assert.equal((await srv.api('POST', '/commerces', corps)).statut, 401)
    assert.equal((await srv.api('POST', '/commerces', corps, { 'X-Admin-PIN': '11111111' })).statut, 401)
    assert.equal((await srv.api('POST', '/commerces', { ...corps, pin: '12' }, { 'X-Admin-PIN': ADMIN })).statut, 400)
    const r = await srv.api('POST', '/commerces', corps, { 'X-Admin-PIN': ADMIN })
    assert.equal(r.statut, 201)
    commerceId = r.contenu.commerce.id
    assert.equal(r.contenu.commerce.nom, 'Chez Lin')
    assert.equal(r.contenu.commerce.seuilTampons, 3)
    // Les défauts de `nouveauCommerce` sont repris (lots, règles).
    assert.ok(r.contenu.commerce.lots.length >= 2)
    assert.equal(r.contenu.commerce.reglesReponseAuto.auto5Etoiles, true)
    assert.doesNotMatch(JSON.stringify(r.contenu), /4321/)
  })

  test('PIN commerçant faux ou manquant → 401 ; le PIN d’un autre commerce ne marche pas', async () => {
    const faux = await srv.api('GET', `/commerces/${commerceId}/etat`, undefined, { 'X-Commerce-PIN': '0000' })
    assert.equal(faux.statut, 401)
    assert.match(faux.contenu.erreur, /PIN/)
    assert.equal((await srv.api('GET', `/commerces/${commerceId}/etat`)).statut, 401)
    assert.equal((await srv.api('GET', `/commerces/${ASIAN_HOME}/etat`, undefined, pin)).statut, 401)
    assert.equal((await srv.api('GET', `/commerces/${commerceId}/etat`, undefined, pin)).statut, 200)
    assert.equal((await srv.api('GET', `/commerces/inconnu/etat`, undefined, pin)).statut, 404)
  })

  test('inscription + déduplication 0033 / +33 / 06', async () => {
    const r1 = await srv.api('POST', `/commerces/${commerceId}/clients`, { prenom: 'Linh', contact: '06 12 34 56 78' }, pin)
    assert.equal(r1.statut, 201)
    assert.equal(r1.contenu.existant, false)
    client = r1.contenu.client
    for (const contact of ['+33 6 12 34 56 78', '0033612345678', '06.12.34.56.78']) {
      const r = await srv.api('POST', `/commerces/${commerceId}/clients`, { prenom: 'Autre', contact }, pin)
      assert.equal(r.statut, 200, contact)
      assert.equal(r.contenu.existant, true)
      assert.equal(r.contenu.client.id, client.id)
    }
    // Auto-inscription publique : même client, sans téléphone dans la réponse.
    const pub = await srv.api('POST', `/commerces/${commerceId}/clients`, { prenom: 'Linh', contact: '+33612345678' })
    assert.equal(pub.contenu.client.id, client.id)
    assert.equal(pub.contenu.client.telephone, undefined)
    assert.equal((await srv.api('POST', `/commerces/${commerceId}/clients`, { prenom: 'X', contact: '0612' })).statut, 400)
    const etat = await srv.api('GET', `/commerces/${commerceId}/etat`, undefined, pin)
    assert.equal(etat.contenu.clients.length, 1)
  })

  test('visite → tampon ; visite sans PIN → 401', async () => {
    assert.equal((await srv.api('POST', `/commerces/${commerceId}/clients/${client.id}/visite`)).statut, 401)
    const r = await srv.api('POST', `/commerces/${commerceId}/clients/${client.id}/visite`, undefined, pin)
    assert.equal(r.statut, 200)
    assert.equal(r.contenu.client.tampons, 1)
    assert.equal(r.contenu.client.visites.length, 1)
    assert.equal(r.contenu.client.derniereVisite, horloge.toISOString())
  })

  test('récompense : refusée avant le seuil, puis report des tampons excédentaires', async () => {
    const trop = await srv.api('POST', `/commerces/${commerceId}/clients/${client.id}/recompense`, undefined, pin)
    assert.equal(trop.statut, 409)
    for (let i = 0; i < 3; i++) await srv.api('POST', `/commerces/${commerceId}/clients/${client.id}/visite`, undefined, pin) // 4 tampons, seuil 3
    const r = await srv.api('POST', `/commerces/${commerceId}/clients/${client.id}/recompense`, undefined, pin)
    assert.equal(r.statut, 200)
    assert.equal(r.contenu.client.tampons, 1)
    assert.equal(r.contenu.client.recompensesOffertes.length, 1)
    assert.equal(r.contenu.client.recompensesOffertes[0].libelle, 'Un dessert offert')
  })

  test('tirage sans visite du jour → 409 (et la roue ne crée pas de visite)', async () => {
    const r = await srv.api('POST', `/commerces/${commerceId}/tirages`, { contact: 'nouveau@exemple.fr', prenom: 'Sam' })
    assert.equal(r.statut, 409)
    assert.match(r.contenu.erreur, /visite/)
    const etat = await srv.api('GET', `/commerces/${commerceId}/etat`, undefined, pin)
    const sam = etat.contenu.clients.find((c: Client) => c.email === 'nouveau@exemple.fr')
    assert.equal(sam.visites.length, 0)
    assert.equal(etat.contenu.tirages.length, 0)
  })

  test('tirage avec visite → lot + code ; 2e tirage → 409 ; autre format du même numéro → 409', async () => {
    const r = await srv.api('POST', `/commerces/${commerceId}/tirages`, { contact: '06 12 34 56 78' })
    assert.equal(r.statut, 201)
    const etat = await srv.api('GET', `/commerces/${commerceId}/etat`, undefined, pin)
    const libelles = etat.contenu.commerce.lots.map((l: { libelle: string }) => l.libelle)
    assert.ok(libelles.includes(r.contenu.lot))
    assert.match(r.contenu.code, /^[A-Z2-9]{6}$/)
    assert.equal(etat.contenu.tirages.length, 1)
    assert.equal(etat.contenu.tirages[0].code, r.contenu.code)

    const r2 = await srv.api('POST', `/commerces/${commerceId}/tirages`, { contact: '06 12 34 56 78' })
    assert.equal(r2.statut, 409)
    assert.match(r2.contenu.erreur, /déjà/)
    const r3 = await srv.api('POST', `/commerces/${commerceId}/tirages`, { contact: '+33 (0)6 12 34 56 78' })
    assert.equal(r3.statut, 409)
    const r4 = await srv.api('POST', `/commerces/${commerceId}/tirages`, { contact: '0033612345678' })
    assert.equal(r4.statut, 409)
  })

  test('le lendemain : sans nouvelle visite → 409 ; avec visite → nouveau tirage', async () => {
    horloge = new Date(2026, 10, 10, 12, 0)
    assert.equal((await srv.api('POST', `/commerces/${commerceId}/tirages`, { contact: '0612345678' })).statut, 409)
    await srv.api('POST', `/commerces/${commerceId}/clients/${client.id}/visite`, undefined, pin)
    assert.equal((await srv.api('POST', `/commerces/${commerceId}/tirages`, { contact: '0612345678' })).statut, 201)
    horloge = new Date(2026, 10, 9, 12, 0)
  })

  test('commerce inactif : jeu public refusé', async () => {
    assert.equal((await srv.api('PATCH', `/commerces/${commerceId}`, { actif: false }, pin)).statut, 200)
    assert.equal((await srv.api('POST', `/commerces/${commerceId}/tirages`, { contact: '0612345678' })).statut, 409)
    assert.equal((await srv.api('PATCH', `/commerces/${commerceId}`, { actif: true }, pin)).statut, 200)
  })

  test('réglages (PATCH) : validés, champ inconnu refusé', async () => {
    const r = await srv.api('PATCH', `/commerces/${commerceId}`, { nom: 'Chez Lin & Co', lots: [{ libelle: 'Thé offert', probabilite: 100 }] }, pin)
    assert.equal(r.statut, 200)
    assert.equal(r.contenu.commerce.nom, 'Chez Lin & Co')
    assert.equal((await srv.api('PATCH', `/commerces/${commerceId}`, { seuilTampons: 0 }, pin)).statut, 400)
    assert.equal((await srv.api('PATCH', `/commerces/${commerceId}`, { lots: [] }, pin)).statut, 400)
    assert.equal((await srv.api('PATCH', `/commerces/${commerceId}`, { id: 'pirate' }, pin)).statut, 400)
    assert.equal((await srv.api('PATCH', `/commerces/${commerceId}`, { nom: 'X' })).statut, 401)
  })

  test('avis : règles automatiques appliquées côté serveur', async () => {
    const cinq = await srv.api('POST', `/commerces/${commerceId}/avis`, { auteur: 'Sophie M.', note: 5, texte: 'Super !' }, pin)
    assert.equal(cinq.statut, 201)
    assert.equal(cinq.contenu.avis.reponseAuto, true)
    assert.match(cinq.contenu.avis.reponse, /Sophie/)
    const deux = await srv.api('POST', `/commerces/${commerceId}/avis`, { auteur: 'Marc', note: 2, texte: 'Bof' }, pin)
    assert.ok(deux.contenu.avis.brouillon)
    assert.equal(deux.contenu.avis.reponse, undefined)
    const rep = await srv.api('PATCH', `/commerces/${commerceId}/avis/${deux.contenu.avis.id}`, { reponse: 'Merci Marc, désolés.' }, pin)
    assert.equal(rep.statut, 200)
    assert.equal(rep.contenu.avis.reponse, 'Merci Marc, désolés.')
    assert.equal(rep.contenu.avis.reponseAuto, false)
    assert.equal(rep.contenu.avis.brouillon, undefined)
    assert.equal((await srv.api('POST', `/commerces/${commerceId}/avis`, { auteur: 'Z', note: 6 }, pin)).statut, 400)
  })

  test('export CSV : BOM UTF-8, en-têtes, une ligne par client', async () => {
    assert.equal((await srv.api('GET', `/commerces/${commerceId}/export.csv`)).statut, 401)
    const r = await fetch(`http://127.0.0.1:${(srv.app.serveur.address() as AddressInfo).port}/api/v1/commerces/${commerceId}/export.csv`, { headers: pin })
    assert.equal(r.status, 200)
    assert.match(r.headers.get('content-type') ?? '', /text\/csv; charset=utf-8/)
    const octets = new Uint8Array(await r.arrayBuffer())
    assert.deepEqual([...octets.slice(0, 3)], [0xef, 0xbb, 0xbf])
    const lignes = new TextDecoder().decode(octets.slice(3)).trim().split('\r\n')
    assert.equal(lignes[0], 'prenom;telephone;email;tampons;visites;derniereVisite;creeLe')
    assert.equal(lignes.length, 3) // Linh + Sam
    assert.match(lignes[1], /^Linh;06 12 34 56 78;;2;5;/)
    assert.match(lignes[2], /^Sam;;nouveau@exemple\.fr;0;0;;/)
  })

  test('persistance : données retrouvées après redémarrage du serveur', async () => {
    await srv.app.fermer()
    srv = await demarrer(fichierDb, { pinInitial: undefined })
    const etat = await srv.api('GET', `/commerces/${commerceId}/etat`, undefined, pin)
    assert.equal(etat.statut, 200)
    assert.equal(etat.contenu.commerce.nom, 'Chez Lin & Co')
    const linh = etat.contenu.clients.find((c: Client) => c.id === client.id)
    assert.equal(linh.tampons, 2)
    assert.equal(etat.contenu.tirages.length, 2)
    assert.equal(etat.contenu.avis.length, 2)
    // Asian Home Paris n'est pas recréé ni dupliqué.
    const liste = await srv.api('GET', '/commerces')
    assert.equal(liste.contenu.commerces.filter((c: Commerce) => c.id === ASIAN_HOME).length, 1)
    // La règle « 1 tirage par jour » survit au redémarrage.
    assert.equal((await srv.api('POST', `/commerces/${commerceId}/tirages`, { contact: '0612345678' })).statut, 409)
  })
})

describe('Serveur : DEMO=1 et anti-bruteforce', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-test-'))
  after(() => rmSync(dossier, { recursive: true, force: true }))

  test('DEMO=1 ajoute les 2 commerces de démo, étiquetés démo ; Asian Home reste vide', async () => {
    const { app, api } = await demarrer(join(dossier, 'demo.db'), { demo: true })
    try {
      const liste = (await api('GET', '/commerces')).contenu.commerces as (Commerce & { demo: boolean })[]
      assert.deepEqual(liste.map((c) => [c.id, c.demo]), [[ASIAN_HOME, false], ['c-atelier-camille', true], ['c-maison-lila', true]])
      const ah = await api('GET', `/commerces/${ASIAN_HOME}/etat`, undefined, { 'X-Admin-PIN': ADMIN })
      assert.equal(ah.contenu.clients.length, 0)
      const camille = await api('GET', '/commerces/c-atelier-camille/etat', undefined, { 'X-Admin-PIN': ADMIN })
      assert.ok(camille.contenu.clients.length > 0)
    } finally {
      await app.fermer()
    }
  })

  test('10 PIN faux en 10 min → 429, même avec le bon PIN ensuite', async () => {
    const { app, api } = await demarrer(join(dossier, 'bf.db'))
    try {
      for (let i = 0; i < 10; i++) {
        assert.equal((await api('GET', `/commerces/${ASIAN_HOME}/etat`, undefined, { 'X-Commerce-PIN': '9999' })).statut, 401)
      }
      const r = await api('GET', `/commerces/${ASIAN_HOME}/etat`, undefined, { 'X-Commerce-PIN': '1234' })
      assert.equal(r.statut, 429)
      assert.ok(Number(r.entetes.get('retry-after')) > 500)
      // Les routes publiques restent ouvertes.
      assert.equal((await api('GET', '/commerces')).statut, 200)
    } finally {
      await app.fermer()
    }
  })

  test('base vide sans PIN initial → démarrage refusé avec un message clair', () => {
    assert.throws(() => creerServeur({ fichierDb: join(dossier, 'vide.db'), adminPin: ADMIN }), /PIN_ASIAN_HOME/)
  })
})

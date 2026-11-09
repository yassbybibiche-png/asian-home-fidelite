// Tests V2 du front : recherche normalisée, export CSV, bascule local / API, dépôt API, tirage via l'API,
// PIN mémorisé chiffré. AUCUN vrai serveur ici : `fetch` est simulé (cf. tests/serveur.test.ts pour le vrai HTTP).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { chiffresRecherche, correspondRecherche, sansAccents } from '../src/lib/recherche.ts'
import { clientsEnCsv, nomFichierCsv } from '../src/lib/csv.ts'
import { baseApi, creerClientApi, ErreurApi, MESSAGE_HORS_LIGNE, type ClientApi, type EtatCommerce } from '../src/data/api.ts'
import { creerDepotApi } from '../src/data/depotApi.ts'
import { lancerTirage, memoireJoueur } from '../src/data/jeuApi.ts'
import { creerCoffrePin, type RangementCle } from '../src/data/coffrePin.ts'
import { nouveauCommerce } from '../src/data/defaults.ts'
import { analyserContact, cleContact, nouveauClient, trouverClientParContact, validerVisite } from '../src/lib/fidelite.ts'
import { statutJeu, tirerLot, lotsJouables } from '../src/lib/roulette.ts'
import type { Client, Commerce, Tirage } from '../src/types.ts'

/** localStorage / sessionStorage en mémoire. */
class StockageMemoire {
  m = new Map<string, string>()
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v))
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
}

const client = (prenom: string, contact: { telephone?: string; email?: string }, commerceId = 'c1'): Client => ({
  ...nouveauClient(commerceId, prenom, contact as never, new Date(2026, 10, 1)),
})

describe('Recherche clients normalisée', () => {
  const marie = client('Marie', { telephone: '06 12 34 56 78' })
  const helene = client('Hélène', { telephone: '+33 7 11 22 33 44' })
  const zoe = client('Zoé', { email: 'Zoe.Martin@exemple.fr' })

  test('0612345678 retrouve « 06 12 34 56 78 »', () => {
    assert.equal(correspondRecherche(marie, '0612345678'), true)
  })
  test('tous les formats tapés retrouvent le même numéro (+33, 0033, points, tirets, espaces, partiel)', () => {
    for (const q of ['+33612345678', '+33 6 12 34 56 78', '0033 6 12 34 56 78', '+33 (0)6 12 34 56 78', '06.12.34.56.78', '06-12-34', '12 34 56', '5678']) {
      assert.equal(correspondRecherche(marie, q), true, q)
    }
    assert.equal(correspondRecherche(marie, '0712345678'), false)
  })
  test('un numéro enregistré en +33 est retrouvé en tapant 07…', () => {
    assert.equal(correspondRecherche(helene, '07 11 22'), true)
    assert.equal(correspondRecherche(helene, '0711223344'), true)
  })
  test('prénom insensible aux accents et à la casse, dans les deux sens', () => {
    assert.equal(correspondRecherche(helene, 'helene'), true)
    assert.equal(correspondRecherche(helene, 'HÉL'), true)
    assert.equal(correspondRecherche(zoe, 'zoe'), true)
    assert.equal(correspondRecherche(client('Helene', { telephone: '0600000000' }), 'Hélène'), true)
    assert.equal(sansAccents('Ça Élodie'), 'ca elodie')
  })
  test('e-mail insensible à la casse ; recherche vide = tout le monde', () => {
    assert.equal(correspondRecherche(zoe, 'zoe.MARTIN@'), true)
    assert.equal(correspondRecherche(zoe, '   '), true)
    assert.equal(correspondRecherche(marie, 'zoe'), false)
  })
  test('même règle que cleContact pour un numéro complet', () => {
    for (const q of ['+33 6 12 34 56 78', '0033612345678', '06 12 34 56 78']) assert.equal(chiffresRecherche(q), cleContact({ telephone: q }))
    assert.equal(chiffresRecherche('marie'), null)
  })
})

describe('Export CSV', () => {
  test('contenu : BOM, en-tête, séparateur ;, une ligne par client, anti-formule, guillemets', () => {
    const a = { ...client('Marie', { telephone: '+33 6 12 34 56 78' }), tampons: 3, visites: ['2026-11-01T10:00:00.000Z', '2026-11-02T10:00:00.000Z'] }
    const b = client('=HYPERLINK("x")', { email: 'b@exemple.fr' })
    const c = client('Jean; "le grand"', { telephone: '0700000000' })
    const csv = clientsEnCsv([a, b, c])
    assert.ok(csv.startsWith('﻿'), 'BOM UTF-8 pour Excel')
    const lignes = csv.slice(1).split('\r\n')
    assert.equal(lignes.at(-1), '', 'fin de ligne finale')
    assert.equal(lignes[0], 'prenom;telephone;email;tampons;visites;derniereVisite;creeLe')
    assert.equal(lignes.length - 2, 3)
    assert.equal(lignes[1], `Marie;+33 6 12 34 56 78;;3;2;;${a.creeLe}`)
    assert.ok(lignes[2].startsWith(`"'=HYPERLINK(""x"")";;b@exemple.fr;0;0;`), 'formule neutralisée et guillemets doublés')
    assert.ok(lignes[3].startsWith('"Jean; ""le grand""";0700000000;'))
    assert.equal(nomFichierCsv('c-asian-home-paris'), 'clients-c-asian-home-paris.csv')
  })
  test('mode API : le CSV vient de /export.csv, avec le PIN en en-tête', async () => {
    const appels: { url: string; headers: Record<string, string> }[] = []
    const api = creerClientApi('http://srv/api/v1', async (url, init) => {
      appels.push({ url: String(url), headers: init?.headers as Record<string, string> })
      return new Response('﻿prenom;telephone\r\nMarie;0612345678\r\n', { headers: { 'Content-Type': 'text/csv; charset=utf-8' } })
    })
    const csv = await api.exportCsv('c1', { role: 'commerce', commerceId: 'c1', pin: '4321' })
    assert.equal(csv, '﻿prenom;telephone\r\nMarie;0612345678\r\n')
    assert.equal(appels[0].url, 'http://srv/api/v1/commerces/c1/export.csv')
    assert.equal(appels[0].headers['X-Commerce-PIN'], '4321')
  })
})

describe('Bascule local / API', () => {
  test('VITE_API_URL absente ou vide → mode local ; sinon base /api/v1', () => {
    assert.equal(baseApi(undefined), null)
    assert.equal(baseApi(''), null)
    assert.equal(baseApi('   '), null)
    assert.equal(baseApi('http://localhost:3001'), 'http://localhost:3001/api/v1')
    assert.equal(baseApi('https://x.onrender.com/'), 'https://x.onrender.com/api/v1')
    assert.equal(baseApi('https://x.onrender.com/api/v1/'), 'https://x.onrender.com/api/v1')
    assert.equal(baseApi('/'), '/api/v1')
  })

  test('client API : PIN admin / commerce en en-tête, erreurs en français, serveur injoignable', async () => {
    let reponse: () => Promise<Response> = async () => Response.json({ commerces: [] })
    const vus: RequestInit[] = []
    const api = creerClientApi('http://srv/api/v1', async (_u, init) => (vus.push(init!), reponse()))

    await api.etat('c1', { role: 'admin', pin: '98765432' }).catch(() => {})
    assert.equal((vus[0].headers as Record<string, string>)['X-Admin-PIN'], '98765432')

    reponse = async () => Response.json({ erreur: 'PIN commerçant incorrect.' }, { status: 401 })
    await assert.rejects(api.etat('c1', { role: 'commerce', commerceId: 'c1', pin: '0000' }), (e: ErreurApi) => e.statut === 401 && e.message === 'PIN commerçant incorrect.')

    reponse = async () => {
      throw new TypeError('Failed to fetch')
    }
    await assert.rejects(api.commerces(), (e: ErreurApi) => e.horsLigne && e.message === MESSAGE_HORS_LIGNE)
    assert.equal(MESSAGE_HORS_LIGNE, 'Serveur injoignable — vérifiez la connexion.')

    // Hébergeur qui répond 502/503 (serveur arrêté ou en réveil) = injoignable aussi.
    reponse = async () => new Response('<html>Bad gateway</html>', { status: 502 })
    await assert.rejects(api.commerces(), (e: ErreurApi) => e.horsLigne)
  })
})

// ---------- Dépôt API ----------

const C1: Commerce = { ...nouveauCommerce('Chez Lin', 'restaurant', ''), id: 'c1' }
const C2: Commerce = { ...nouveauCommerce('Salon Ana', 'salon', ''), id: 'c2', demo: true }

function apiSimulee(etats: Record<string, EtatCommerce>, pins: Record<string, string>, admin = '98765432') {
  let horsLigne = false
  const api = {
    base: 'http://srv/api/v1',
    async commerces() {
      if (horsLigne) throw new ErreurApi(0, MESSAGE_HORS_LIGNE)
      return Object.values(etats).map((e) => ({ ...e.commerce, reglesReponseAuto: e.commerce.reglesReponseAuto }))
    },
    async etat(id: string, acces: { role: string; pin: string; commerceId?: string }) {
      if (horsLigne) throw new ErreurApi(0, MESSAGE_HORS_LIGNE)
      const ok = acces.role === 'admin' ? acces.pin === admin : acces.pin === pins[id]
      if (!ok) throw new ErreurApi(401, 'PIN commerçant incorrect.')
      return structuredClone(etats[id])
    },
  }
  return { api: api as unknown as ClientApi, couper: (v: boolean) => (horsLigne = v) }
}

describe('Dépôt API (cache + serveur qui fait foi)', () => {
  const marie = client('Marie', { telephone: '0612345678' }, 'c1')
  const ana = client('Ana', { telephone: '0711111111' }, 'c2')
  const etats = {
    c1: { commerce: C1, clients: [marie], tirages: [], avis: [] },
    c2: { commerce: C2, clients: [ana], tirages: [], avis: [] },
  }

  test('PIN d’un commerce : seules SES données sont chargées, et mises en cache', async () => {
    const stockage = new StockageMemoire()
    const { api } = apiSimulee(etats, { c1: '1111', c2: '2222' })
    const depot = creerDepotApi(api, stockage, () => new Date('2026-11-09T12:00:00Z'))
    const e = await depot.chargerServeur({ role: 'commerce', commerceId: 'c1', pin: '1111' })
    assert.deepEqual(e.commerces.map((c) => c.id), ['c1', 'c2'], 'liste publique complète (écran de déverrouillage)')
    assert.deepEqual(e.clients.map((c) => c.prenom), ['Marie'], 'aucun client d’un autre commerce')
    assert.equal(e.commerceActifId, 'c1')
    assert.deepEqual(depot.charger().clients.map((c) => c.prenom), ['Marie'])
    assert.equal(depot.derniereSynchro(), '2026-11-09T12:00:00.000Z')
  })

  test('PIN admin : tous les commerces ; sans PIN : liste publique seulement, rien en cache', async () => {
    const stockage = new StockageMemoire()
    const { api } = apiSimulee(etats, { c1: '1111', c2: '2222' })
    const depot = creerDepotApi(api, stockage)
    const sansPin = await depot.chargerServeur(null)
    assert.equal(sansPin.clients.length, 0)
    assert.equal(stockage.m.size, 0, 'aucune donnée privée écrite sans PIN')
    const admin = await depot.chargerServeur({ role: 'admin', pin: '98765432' }, 'c2')
    assert.deepEqual(admin.clients.map((c) => c.prenom).sort(), ['Ana', 'Marie'])
    assert.equal(admin.commerceActifId, 'c2', 'commerce affiché conservé')
    assert.equal(admin.commerces.find((c) => c.id === 'c2')?.demo, true, 'étiquette démo transmise')
  })

  test('PIN faux → 401 (rien en cache) ; commerce inconnu → 404', async () => {
    const stockage = new StockageMemoire()
    const { api } = apiSimulee(etats, { c1: '1111' })
    const depot = creerDepotApi(api, stockage)
    await assert.rejects(depot.chargerServeur({ role: 'commerce', commerceId: 'c1', pin: '9999' }), (e: ErreurApi) => e.statut === 401)
    assert.equal(stockage.m.size, 0)
    await assert.rejects(depot.chargerServeur({ role: 'commerce', commerceId: 'zz', pin: '1111' }), (e: ErreurApi) => e.statut === 404)
  })

  test('conflit : le serveur fait foi (le cache est entièrement remplacé)', async () => {
    const stockage = new StockageMemoire()
    const { api } = apiSimulee(etats, { c1: '1111' })
    const depot = creerDepotApi(api, stockage)
    const acces = { role: 'commerce' as const, commerceId: 'c1', pin: '1111' }
    await depot.chargerServeur(acces)
    // Cache modifié « en local » (ex. ancien onglet) : un client que le serveur ne connaît pas, des tampons en trop.
    const cle = [...stockage.m.keys()][0]
    const cache = JSON.parse(stockage.getItem(cle)!)
    cache.etat.clients = [{ ...cache.etat.clients[0], tampons: 99 }, client('Fantôme', { telephone: '0699999999' }, 'c1')]
    stockage.setItem(cle, JSON.stringify(cache))
    assert.equal(depot.charger().clients.length, 2)
    const e = await depot.chargerServeur(acces)
    assert.deepEqual(e.clients.map((c) => [c.prenom, c.tampons]), [['Marie', 0]])
    assert.deepEqual(depot.charger().clients.map((c) => [c.prenom, c.tampons]), [['Marie', 0]])
  })

  test('hors ligne : erreur « Serveur injoignable », le cache (dernières données connues) reste lisible', async () => {
    const stockage = new StockageMemoire()
    const { api, couper } = apiSimulee(etats, { c1: '1111' })
    const depot = creerDepotApi(api, stockage)
    await depot.chargerServeur({ role: 'commerce', commerceId: 'c1', pin: '1111' })
    couper(true)
    await assert.rejects(depot.chargerServeur({ role: 'commerce', commerceId: 'c1', pin: '1111' }), (e: ErreurApi) => e.horsLigne)
    assert.deepEqual(depot.charger().clients.map((c) => c.prenom), ['Marie'])
  })

  test('« Verrouiller » efface les données privées du navigateur', async () => {
    const stockage = new StockageMemoire()
    const { api } = apiSimulee(etats, { c1: '1111' })
    const depot = creerDepotApi(api, stockage)
    await depot.chargerServeur({ role: 'commerce', commerceId: 'c1', pin: '1111' })
    assert.equal(depot.reinitialiser().clients.length, 0)
    assert.equal(stockage.m.size, 0)
    assert.equal(depot.charger().clients.length, 0)
    assert.equal(depot.derniereSynchro(), null)
  })
})

// ---------- Tirage via l'API (serveur simulé, mêmes règles que server/app.ts) ----------

/** Faux serveur en mémoire derrière `fetch` : visite du jour, 1 tirage par jour, lot tiré côté « serveur ». */
function serveurSimule(commerce: Commerce, alea = () => 0.1) {
  const clients: Client[] = []
  const tirages: Tirage[] = []
  const corpsRecus: unknown[] = []
  let coupe = false
  const f: typeof fetch = async (url, init) => {
    if (coupe) throw new TypeError('Failed to fetch')
    const chemin = String(url).replace('http://srv/api/v1', '')
    const corps = init?.body ? JSON.parse(String(init.body)) : {}
    corpsRecus.push(corps)
    if (init?.method === 'POST' && chemin === `/commerces/${commerce.id}/tirages`) {
      const contact = analyserContact(corps.contact)
      if (!contact) return Response.json({ erreur: 'Contact invalide.' }, { status: 400 })
      let c = trouverClientParContact(clients, commerce.id, contact)
      if (!c) clients.push((c = nouveauClient(commerce.id, corps.prenom ?? '', contact)))
      const statut = statutJeu(c, tirages, commerce.id)
      if (statut === 'dejaJoue') return Response.json({ erreur: 'Vous avez déjà tourné la roue aujourd’hui. Revenez lors de votre prochaine visite !' }, { status: 409 })
      if (statut === 'sansVisite') return Response.json({ erreur: 'Pour jouer, faites d’abord valider votre visite du jour au comptoir.' }, { status: 409 })
      const lot = lotsJouables(commerce.lots)[tirerLot(commerce.lots, alea())].libelle
      tirages.push({ id: `t${tirages.length}`, commerceId: commerce.id, clientId: c.id, lot, date: new Date().toISOString(), code: 'ABC234' })
      return Response.json({ lot, code: 'ABC234', date: new Date().toISOString(), perdant: false }, { status: 201 })
    }
    return Response.json({ erreur: 'Route inconnue.' }, { status: 404 })
  }
  return {
    api: creerClientApi('http://srv/api/v1', f),
    corpsRecus,
    tirages,
    /** Le commerçant valide la visite au comptoir. */
    validerVisite(contact: string) {
      const i = clients.findIndex((c) => cleContact(c) === cleContact(analyserContact(contact)!))
      clients[i] = validerVisite(clients[i], commerce)
    },
    couper: (v: boolean) => (coupe = v),
  }
}

describe('Tirage via l’API (le serveur décide, le navigateur anime)', () => {
  const commerce: Commerce = { ...nouveauCommerce('Chez Lin', 'restaurant', ''), id: 'c1' }

  test('sans visite → refus 409 affiché, aucun lot ; après visite → lot du serveur + secteur de la roue ; 2e tirage → refus', async () => {
    const srv = serveurSimule(commerce)
    const refus = await lancerTirage(srv.api, commerce, '06 12 34 56 78', 'Marie')
    assert.equal(refus.ok, false)
    assert.ok(!refus.ok && refus.refus && /valider votre visite/.test(refus.message))
    assert.equal(srv.tirages.length, 0)

    srv.validerVisite('0612345678')
    const gagne = await lancerTirage(srv.api, commerce, '+33 6 12 34 56 78', 'Marie')
    assert.ok(gagne.ok)
    assert.equal(gagne.resultat.lot, lotsJouables(commerce.lots)[0].libelle, 'le lot vient du serveur (aléa serveur 0,1 → 1er lot)')
    assert.equal(gagne.resultat.code, 'ABC234')
    assert.equal(gagne.secteur?.lot.libelle, gagne.resultat.lot, 'la roue s’arrête sur le lot du serveur')

    const encore = await lancerTirage(srv.api, commerce, '0033612345678', 'Marie')
    assert.ok(!encore.ok && encore.refus && /déjà tourné/.test(encore.message))
    assert.equal(srv.tirages.length, 1)
  })

  test('le navigateur n’envoie jamais de lot ni de résultat, seulement le contact (et le prénom)', async () => {
    const srv = serveurSimule(commerce)
    await lancerTirage(srv.api, commerce, '0612345678', 'Marie')
    for (const corps of srv.corpsRecus) assert.deepEqual(Object.keys(corps as object).sort(), ['contact', 'prenom'])
  })

  test('serveur injoignable : pas de faux résultat, message clair', async () => {
    const srv = serveurSimule(commerce)
    srv.couper(true)
    const r = await lancerTirage(srv.api, commerce, '0612345678', 'Marie')
    assert.deepEqual(r, { ok: false, message: 'Serveur injoignable — vérifiez la connexion.', horsLigne: true, refus: false })
  })

  test('lots modifiés entre-temps : le résultat du serveur est gardé, sans secteur à viser', async () => {
    const srv = serveurSimule(commerce)
    await lancerTirage(srv.api, commerce, '0612345678').catch(() => {})
    srv.validerVisite('0612345678')
    const autreVersion: Commerce = { ...commerce, lots: [{ libelle: 'Autre lot', probabilite: 100 }] }
    const r = await lancerTirage(srv.api, autreVersion, '0612345678')
    assert.ok(r.ok && r.secteur === null && r.resultat.lot === lotsJouables(commerce.lots)[0].libelle)
  })

  test('mémoire du joueur sur son téléphone : profil + code gagnant du jour', () => {
    const s = new StockageMemoire()
    const m = memoireJoueur(s, 'c1')
    assert.equal(m.joueur(), null)
    m.memoriser({ clientId: 'cl-1', prenom: 'Marie', contact: '0612345678' })
    m.memoriserGain({ clientId: 'cl-1', lot: 'Nems offerts', code: 'ABC234', date: '2026-11-09T12:00:00Z', perdant: false })
    assert.equal(memoireJoueur(s, 'c1').joueur()?.prenom, 'Marie')
    assert.equal(memoireJoueur(s, 'c1').gain()?.code, 'ABC234')
    assert.equal(memoireJoueur(s, 'c2').joueur(), null, 'propre à chaque commerce')
    m.memoriser(null)
    assert.equal(m.joueur(), null)
  })
})

// ---------- PIN mémorisé ----------

function rangementMemoire(): RangementCle & { cle: CryptoKey | null } {
  return {
    cle: null,
    async lire() {
      return this.cle
    },
    async ecrire(c) {
      this.cle = c
    },
    async effacer() {
      this.cle = null
    },
  }
}

describe('PIN mémorisé pour la session, jamais en clair', () => {
  test('aller-retour ; sessionStorage ne contient pas le PIN en clair ; clé non exportable', async () => {
    const session = new StockageMemoire()
    const rangement = rangementMemoire()
    const coffre = creerCoffrePin(session, rangement)
    assert.equal(coffre.disponible, true)
    assert.equal(await coffre.memoriser({ role: 'commerce', commerceId: 'c-asian-home-paris', pin: '482916' }), true)
    const brut = [...session.m.values()].join('')
    assert.ok(brut.length > 0)
    assert.ok(!brut.includes('482916') && !brut.includes('c-asian-home-paris'), 'rien de lisible')
    assert.equal(rangement.cle!.extractable, false)
    await assert.rejects(crypto.subtle.exportKey('raw', rangement.cle!))
    assert.deepEqual(await creerCoffrePin(session, rangement).lire(), { role: 'commerce', commerceId: 'c-asian-home-paris', pin: '482916' })
  })

  test('« Verrouiller » efface le PIN chiffré et la clé ; sans la clé, rien ne se relit', async () => {
    const session = new StockageMemoire()
    const rangement = rangementMemoire()
    const coffre = creerCoffrePin(session, rangement)
    await coffre.memoriser({ role: 'admin', pin: '98765432' })
    const copie = new Map(session.m)
    await coffre.oublier()
    assert.equal(session.m.size, 0)
    assert.equal(await coffre.lire(), null)
    session.m = copie // le texte chiffré seul ne suffit pas
    assert.equal(await coffre.lire(), null)
  })

  test('sans WebCrypto (http:// hors localhost) : rien n’est mémorisé', async () => {
    const session = new StockageMemoire()
    const coffre = creerCoffrePin(session, rangementMemoire(), null)
    assert.equal(coffre.disponible, false)
    assert.equal(await coffre.memoriser({ role: 'admin', pin: '98765432' }), false)
    assert.equal(session.m.size, 0)
  })
})

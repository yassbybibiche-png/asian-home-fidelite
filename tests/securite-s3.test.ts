// P0-S3 (audit du 10/11/2026, faille F-05) : vue publique minimale des commerces. Les routes publiques (liste, fiche,
// menu, carte client) ne publient plus la configuration commerciale ; GET /etat (PIN / session) la renvoie entière.
// Vrai serveur HTTP + vraie base SQLite temporaire, et le client HTTP du front pour le parcours public.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, type OptionsServeur } from '../server/app.ts'
import { creerClientApi, type ClientApi } from '../src/data/api.ts'
import { lancerTirage } from '../src/data/jeuApi.ts'
import { commercePublic } from '../src/lib/vuePublique.ts'
import { lotsJouables, secteurs } from '../src/lib/roulette.ts'
import { configDefi, configOffreHebdo, configParrainage, configRattrapage, niveauClient, offreHebdoDuJour, prochainPalier } from '../src/lib/programme.ts'
import { nouveauClient } from '../src/lib/fidelite.ts'
import { nouveauCommerce } from '../src/data/defaults.ts'
import type { Client, Commerce, CommercePublic } from '../src/types.ts'

const ADMIN = '98765432'
const ADMIN_PIN = { 'X-Admin-PIN': ADMIN }

let horloge = new Date(2026, 10, 10, 12, 0)

async function demarrer(fichierDb: string, options: Partial<OptionsServeur> = {}) {
  const app = await creerServeur({ fichierDb, adminPin: ADMIN, pinInitial: '1234', version: 'test', maintenant: () => horloge, ...options })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    const type = r.headers.get('content-type') ?? ''
    return { statut: r.status, contenu: type.includes('json') ? await r.json() : await r.text(), entetes: r.headers }
  }
  return { app, api, base }
}

// Configuration complète, avec des valeurs repérables : aucune ne doit sortir par une route publique.
const REGLAGES = {
  coordonnees: '12 rue des Lilas, 75011 Paris',
  recompense: 'Un plat offert',
  seuilTampons: 8,
  lots: [
    { libelle: 'Nems offerts', probabilite: 37 },
    { libelle: 'Lot fantôme', probabilite: 0 },
    { libelle: 'Mochi offert', probabilite: 13 },
    { libelle: 'Pas de chance', probabilite: 50 },
  ],
  reglesReponseAuto: { auto5Etoiles: true, auto4Etoiles: false, brouillonAutres: true },
  eurosParPoint: 2.5,
  catalogue: [
    { id: 'rp-interne-42', nom: 'Boisson offerte', cout: 80, description: 'Soda ou thé glacé' },
    { id: 'rp-interne-43', nom: 'Dessert offert', cout: 120 },
  ],
  messagesAuto: { bienvenue: true, recompense: true, presque: false, inactif: true, anniversaire: false, avis: true },
  apparence: { couleur: '#b3262d', fond: '#fbf3e4', banniere: 'https://exemple.fr/banniere.jpg' },
  programme: {
    paliers: { actif: true, liste: [{ seuil: 3, libelle: 'Boisson offerte au 3e passage' }] },
    parrainage: { actif: true, pointsParrain: 77, pointsFilleul: 33, plafondAn: 9 },
    bienvenue: { actif: true, points: 44 },
    defi: { actif: true, visites: 4, jours: 21, recompense: 'Défi interne réussi' },
    niveaux: { actif: true, habitueSeuil: 6, habitueMultiplicateur: 1.5, vipSeuil: 15, vipMultiplicateur: 2 },
    winback: { actif: true, rappelJours: 30, offreJours: 50, derniereJours: 80, offre: 'Relance confidentielle' },
    anniversaire: { actif: true, validiteJours: 21, demiAnniversaire: false, adhesion: true },
    offreHebdo: { actif: true, jour: 4, libelle: 'Thé offert le jeudi', condition: 'dès 12 €' },
    reserve: { actif: true, montantMinCentimes: 4200, validiteJours: 45, parTrimestre: 2 },
    rattrapage: { actif: true, delaiJours: 14 },
  },
}

/** Ce qu'une route publique ne doit JAMAIS contenir (recherché dans le JSON sérialisé). */
const INTERDITS: [string, RegExp][] = [
  ['probabilité des lots', /probabilite/],
  ['règles de réponse aux avis', /reglesReponseAuto|auto5Etoiles|brouillonAutres/],
  ['taux de points', /eurosParPoint/],
  ['messages automatiques', /messagesAuto/],
  ['relance des inactifs', /winback|Relance confidentielle|rappelJours/],
  ['points de bienvenue', /bienvenue/],
  ['anniversaire', /anniversaire"|validiteJours|demiAnniversaire/],
  ['réserve', /reserve|montantMinCentimes|parTrimestre/],
  ['réglages internes du parrainage', /pointsParrain|plafondAn/],
  ['détail interne du défi', /Défi interne réussi/],
  ['identifiants internes du catalogue', /rp-interne/],
  ['lot à 0 %', /Lot fantôme/],
  ['date de création', /creeLe/],
  ['secrets d’accès', /"(pin|hash|sel|pinHash)"\s*:/i],
]

function sansConfigurationPrivee(json: unknown, route: string) {
  const texte = JSON.stringify(json)
  for (const [nom, motif] of INTERDITS) assert.doesNotMatch(texte, motif, `${route} : ${nom} exposé(e)`)
}

const CLES_PUBLIQUES = ['actif', 'apparence', 'catalogue', 'coordonnees', 'demo', 'id', 'lienGoogle', 'logo', 'lots', 'nom', 'programme', 'recompense', 'seuilTampons', 'type']

function vuePubliqueAttendue(c: CommercePublic, route: string) {
  for (const k of Object.keys(c)) assert.ok(CLES_PUBLIQUES.includes(k), `${route} : champ inattendu « ${k} »`)
  assert.equal(c.nom, 'Chez Lin')
  assert.equal(c.seuilTampons, 8)
  assert.equal(c.recompense, 'Un plat offert')
  assert.equal(c.coordonnees, '12 rue des Lilas, 75011 Paris')
  assert.equal(c.actif, true)
  assert.equal(c.demo, false)
  // Libellés des lots jouables, dans l'ordre, sans probabilité.
  assert.deepEqual(c.lots, [{ libelle: 'Nems offerts' }, { libelle: 'Mochi offert' }, { libelle: 'Pas de chance' }])
  // Catalogue : ce que le client peut échanger (nom, coût, description) — affiché sur sa carte.
  assert.deepEqual(c.catalogue, [
    { nom: 'Boisson offerte', cout: 80, description: 'Soda ou thé glacé' },
    { nom: 'Dessert offert', cout: 120 },
  ])
  assert.deepEqual(c.apparence, { couleur: '#b3262d', fond: '#fbf3e4', banniere: 'https://exemple.fr/banniere.jpg' })
  // Programme : seulement les blocs affichés au client, valeurs effectives.
  assert.deepEqual(c.programme, {
    paliers: { actif: true, liste: [{ seuil: 3, libelle: 'Boisson offerte au 3e passage' }] },
    parrainage: { actif: true, pointsFilleul: 33 },
    defi: { actif: true },
    niveaux: { actif: true, habitueSeuil: 6, habitueMultiplicateur: 1.5, vipSeuil: 15, vipMultiplicateur: 2 },
    offreHebdo: { actif: true, jour: 4, libelle: 'Thé offert le jeudi', condition: 'dès 12 €' },
    rattrapage: { actif: true, delaiJours: 14 },
  })
}

describe('P0-S3 : vue publique minimale (routes HTTP)', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-s3-'))
  let srv: Awaited<ReturnType<typeof demarrer>>
  let commerceId = ''
  let clientId = ''

  before(async () => {
    horloge = new Date(2026, 10, 10, 12, 0)
    srv = await demarrer(join(dossier, 's3.db'))
    const cree = await srv.api('POST', '/commerces', { nom: 'Chez Lin', type: 'restaurant', lienGoogle: 'https://g.page/r/x/review', pin: '4321' }, ADMIN_PIN)
    assert.equal(cree.statut, 201)
    commerceId = cree.contenu.commerce.id
    const maj = await srv.api('PATCH', `/commerces/${commerceId}`, REGLAGES, ADMIN_PIN)
    assert.equal(maj.statut, 200, JSON.stringify(maj.contenu))
    const inscrit = await srv.api('POST', `/commerces/${commerceId}/clients`, { prenom: 'Linh', contact: '06 12 34 56 78' })
    assert.equal(inscrit.statut, 201, JSON.stringify(inscrit.contenu))
    clientId = inscrit.contenu.client.id
  })
  after(async () => {
    await srv.app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('GET /commerces : ni probabilités, ni règles d’avis, ni taux, ni réglages internes du programme', async () => {
    const r = await srv.api('GET', '/commerces')
    assert.equal(r.statut, 200)
    sansConfigurationPrivee(r.contenu, 'GET /commerces')
    const c = r.contenu.commerces.find((x: CommercePublic) => x.id === commerceId)
    vuePubliqueAttendue(c, 'GET /commerces')
    // Asian Home Paris (réel) : même vue, mêmes interdits.
    const ah = r.contenu.commerces.find((x: CommercePublic) => x.id === 'c-asian-home-paris')
    assert.ok(ah.lots.length >= 2 && ah.lots.every((l: object) => Object.keys(l).join() === 'libelle'))
    assert.ok(ah.lienGoogle && ah.coordonnees)
  })

  test('GET /commerces/:id : même vue minimale', async () => {
    const r = await srv.api('GET', `/commerces/${commerceId}`)
    assert.equal(r.statut, 200)
    sansConfigurationPrivee(r.contenu, 'GET /commerces/:id')
    vuePubliqueAttendue(r.contenu.commerce, 'GET /commerces/:id')
  })

  test('GET /commerces/:id/menu : le commerce joint est la vue minimale', async () => {
    const r = await srv.api('GET', `/commerces/${commerceId}/menu`)
    assert.equal(r.statut, 200)
    assert.ok(Array.isArray(r.contenu.menu.categories))
    sansConfigurationPrivee(r.contenu, 'GET /commerces/:id/menu')
    vuePubliqueAttendue(r.contenu.commerce, 'GET /commerces/:id/menu')
  })

  test('GET /cartes/:clientId : le commerce joint est la vue minimale (et toujours ni téléphone ni e-mail)', async () => {
    const r = await srv.api('GET', `/cartes/${clientId}`)
    assert.equal(r.statut, 200)
    // Le commerce joint seulement : la carte du client contient légitimement SES messages (« 44 points de bienvenue
    // déjà crédités ») et son solde, qui ne sont pas la configuration du commerce.
    sansConfigurationPrivee({ ...r.contenu, client: undefined }, 'GET /cartes/:id')
    vuePubliqueAttendue(r.contenu.commerce, 'GET /cartes/:id')
    assert.equal(r.contenu.client.prenom, 'Linh')
    assert.doesNotMatch(JSON.stringify(r.contenu), /0612|telephone|email/)
  })

  test('GET /etat authentifié : le commerçant reçoit TOUJOURS le commerce complet', async () => {
    for (const entetes of [{ 'X-Commerce-PIN': '4321' }, ADMIN_PIN]) {
      const r = await srv.api('GET', `/commerces/${commerceId}/etat`, undefined, entetes)
      assert.equal(r.statut, 200)
      const c = r.contenu.commerce as Commerce
      assert.deepEqual(c.lots, REGLAGES.lots, 'probabilités (et lot à 0 %) présentes')
      assert.deepEqual(c.reglesReponseAuto, REGLAGES.reglesReponseAuto)
      assert.equal(c.eurosParPoint, 2.5)
      assert.deepEqual(c.catalogue, REGLAGES.catalogue, 'catalogue avec ses identifiants')
      assert.deepEqual(c.messagesAuto, REGLAGES.messagesAuto)
      assert.deepEqual(c.programme, REGLAGES.programme, 'programme complet (relance, bienvenue, réserve, parrainage…)')
      assert.ok(c.creeLe)
    }
    // Sans PIN : refus (la vue complète n'est jamais publique).
    assert.equal((await srv.api('GET', `/commerces/${commerceId}/etat`)).statut, 401)
  })

  test('PATCH (réglages) renvoie le commerce complet au commerçant', async () => {
    const r = await srv.api('PATCH', `/commerces/${commerceId}`, { recompense: 'Un plat offert' }, { 'X-Commerce-PIN': '4321' })
    assert.equal(r.statut, 200)
    assert.equal(r.contenu.commerce.eurosParPoint, 2.5)
    assert.equal(r.contenu.commerce.programme.winback.offre, 'Relance confidentielle')
  })
})

describe('P0-S3 : parcours public avec le client du front (fiche publique uniquement)', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-s3-front-'))
  let app: Awaited<ReturnType<typeof demarrer>>['app']
  let api: ClientApi

  before(async () => {
    const srv = await demarrer(join(dossier, 'front.db'), { maintenant: () => new Date() })
    app = srv.app
    api = creerClientApi(srv.base)
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('inscription → visite → tirage : la roue publique (secteurs égaux) contient le lot tiré par le serveur', async () => {
    const complet = await api.creerCommerce(ADMIN, { nom: 'Chez Lin', type: 'restaurant', lienGoogle: '', pin: '5555' })
    const acces = { role: 'commerce' as const, commerceId: complet.id, pin: '5555' }
    await api.majCommerce(complet.id, acces, { lots: REGLAGES.lots, programme: REGLAGES.programme })

    // Ce que la page Jouer charge : la fiche publique.
    const publique = await api.commerce(complet.id)
    assert.doesNotMatch(JSON.stringify(publique), /probabilite/)
    assert.equal(lotsJouables(publique.lots).length, 3, 'la page Jouer ne dit pas « Aucun lot configuré »')
    const parts = secteurs(publique.lots)
    assert.deepEqual(parts.map((s) => s.lot.libelle), ['Nems offerts', 'Mochi offert', 'Pas de chance'])
    for (const s of parts) assert.ok(Math.abs(s.fin - s.debut - 120) < 1e-9, 'secteurs égaux : les chances ne sont pas révélées par la roue')

    const { client } = await api.inscrirePublic(complet.id, 'Linh', '06 12 34 56 78')
    const refus = await lancerTirage(api, publique, '0612345678', 'Linh')
    assert.ok(!refus.ok && refus.refus, 'sans visite du jour : refus du serveur')

    await api.visite(complet.id, acces, client.id)
    const carte = await api.carte(client.id)
    assert.equal(carte.jeu.statut, 'pret')
    assert.doesNotMatch(JSON.stringify(carte.commerce), /probabilite|eurosParPoint|reglesReponseAuto|winback/)

    const gagne = await lancerTirage(api, publique, '0612345678', 'Linh')
    assert.ok(gagne.ok)
    assert.ok(gagne.secteur, 'le lot du serveur est sur la roue publique')
    assert.equal(gagne.secteur!.lot.libelle, gagne.resultat.lot)
    assert.deepEqual((await api.carte(client.id)).jeu, {
      statut: 'dejaJoue',
      lotDuJour: gagne.resultat.lot,
      codeDuJour: gagne.resultat.perdant ? null : gagne.resultat.code,
      remisDuJour: false,
    })

    // Le commerçant garde ses probabilités pour régler la roue.
    const etat = await api.etat(complet.id, acces)
    assert.deepEqual(etat.commerce.lots, REGLAGES.lots)
  })

  test('menu public via le client du front : commerce joint sans configuration privée', async () => {
    const [premier] = await api.commerces()
    const r = await api.menu(premier.id)
    sansConfigurationPrivee(r, 'api.menu')
    assert.equal(r.commerce.id, premier.id)
  })
})

describe('P0-S3 : la vue publique affiche la même carte que le commerce complet', () => {
  // La carte publique (CarteFidelite / CartePublique) calcule niveau, palier, défi, offre du jour, parrainage et
  // rattrapage à partir du commerce : avec la vue publique, le résultat doit être identique, défauts compris.
  const configs: [string, Commerce['programme']][] = [
    ['sans programme (défauts)', undefined],
    ['programme configuré', REGLAGES.programme],
    ['tout désactivé', { paliers: { actif: false }, parrainage: { actif: false }, defi: { actif: false }, niveaux: { actif: false }, offreHebdo: { actif: false }, rattrapage: { actif: false } }],
  ]
  for (const [nom, programme] of configs) {
    test(nom, () => {
      const complet: Commerce = { ...nouveauCommerce('Chez Lin', 'restaurant', ''), seuilTampons: 8, ...(programme ? { programme } : {}) }
      const pub = commercePublic(complet)
      for (const visites of [0, 2, 5, 6, 14, 15, 30]) {
        const client: Client = { ...nouveauClient(complet.id, 'Linh', '0612345678'), tampons: visites % 8, visites: Array.from({ length: visites }, (_, i) => new Date(2026, 0, i + 1).toISOString()) }
        assert.deepEqual(niveauClient(client, pub), niveauClient(client, complet))
        assert.deepEqual(prochainPalier(client, pub), prochainPalier(client, complet))
      }
      for (let j = 8; j <= 14; j++) assert.deepEqual(offreHebdoDuJour(pub, new Date(2026, 10, j, 12)), offreHebdoDuJour(complet, new Date(2026, 10, j, 12)))
      assert.deepEqual(configOffreHebdo(pub), configOffreHebdo(complet))
      assert.equal(configDefi(pub).actif, configDefi(complet).actif)
      assert.equal(configParrainage(pub).actif, configParrainage(complet).actif)
      assert.equal(configParrainage(pub).pointsFilleul, configParrainage(complet).pointsFilleul)
      assert.deepEqual(configRattrapage(pub), configRattrapage(complet))
      sansConfigurationPrivee(pub, nom)
    })
  }

  test('liste blanche : un champ futur ajouté au commerce n’est jamais publié', () => {
    const complet = { ...nouveauCommerce('Chez Lin', 'restaurant', ''), champSecretFutur: 'confidentiel', apparence: { couleur: '#b3262d', interne: 'x' } } as unknown as Commerce
    const texte = JSON.stringify(commercePublic(complet))
    assert.doesNotMatch(texte, /champSecretFutur|confidentiel|interne/)
  })
})

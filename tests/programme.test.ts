// Programme de fidélité — benchmark du 09/11/2026 (paliers, parrainage, bienvenue, défis,
// niveaux, win-back, anniversaire, offre hebdo, réserve, rattrapage, inscription simplifiée).
// Logique pure + serveur HTTP (vraie base SQLite temporaire).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, type OptionsServeur } from '../server/app.ts'
import { nouveauCommerce } from '../src/data/defaults.ts'
import { nouveauClient, validerVisite } from '../src/lib/fidelite.ts'
import {
  appliquerInscription,
  appliquerRattrapageValide,
  appliquerVisiteProgramme,
  configAnniversaire,
  configBienvenue,
  configDefi,
  configNiveaux,
  configOffreHebdo,
  configPaliers,
  configParrainage,
  configReserve,
  configRattrapage,
  configWinback,
  consommerRecompenseEnAttente,
  etapeWinback,
  fenetreAnniversaire,
  genererCodeParrainage,
  niveauClient,
  offreHebdoDuJour,
  parrainageDu,
  passageAvecProgramme,
  peutCompleterProfil,
  prochainPalier,
  rattrapageRecevable,
  utiliserReserve,
  validerProgramme,
} from '../src/lib/programme.ts'
import type { Client, Commerce } from '../src/types.ts'

const JOUR = 24 * 60 * 60 * 1000
const MAINTENANT = new Date(2026, 10, 9, 12, 0) // lun. 9 novembre 2026, midi

function commerceTest(seuil = 10): Commerce {
  return { ...nouveauCommerce('Asian Home Paris', 'restaurant', ''), id: 'c-test', seuilTampons: seuil, recompense: 'Un plat offert' }
}

function clientTest(commerce: Commerce, visites = 0): Client {
  let c = nouveauClient(commerce.id, 'Linh', { telephone: '06 12 34 56 78' }, MAINTENANT)
  for (let i = 0; i < visites; i++) c = validerVisite(c, commerce, new Date(MAINTENANT.getTime() - (visites - i) * JOUR))
  return c
}

// ---------- Logique pure ----------

describe('Programme : défauts (commerce sans configuration)', () => {
  test('chaque bloc a ses défauts, sans rien configurer', () => {
    const c = commerceTest()
    assert.deepEqual(configPaliers(c).liste.map((p) => p.seuil), [3, 6])
    assert.equal(configPaliers(c).liste[0].libelle, 'Boisson, nems ou dessert offert')
    assert.deepEqual(configParrainage(c), { actif: true, pointsParrain: 50, pointsFilleul: 50, plafondAn: 12 })
    assert.deepEqual(configBienvenue(c), { actif: true, points: 50 })
    assert.deepEqual(configDefi(c), { actif: true, visites: 3, jours: 14, recompense: 'Plat offert' })
    assert.deepEqual(configNiveaux(c), { actif: true, habitueSeuil: 10, habitueMultiplicateur: 1.5, vipSeuil: 25, vipMultiplicateur: 2 })
    assert.deepEqual(configWinback(c), { actif: true, rappelJours: 45, offreJours: 60, derniereJours: 90, offre: 'Produit offert' })
    assert.deepEqual(configAnniversaire(c), { actif: true, validiteJours: 14, demiAnniversaire: true, adhesion: true })
    assert.deepEqual(configOffreHebdo(c), { actif: true, jour: 2, libelle: 'Boisson offerte', condition: 'dès 15 €' })
    assert.deepEqual(configReserve(c), { actif: true, montantMinCentimes: 2500, validiteJours: 30, parTrimestre: 1 })
    assert.deepEqual(configRattrapage(c), { actif: true, delaiJours: 30 })
  })

  test('le palier égal au seuil de la carte principale est exclu (pas de double récompense)', () => {
    const c = commerceTest(3)
    assert.deepEqual(configPaliers(c).liste, [])
    assert.equal(prochainPalier(clientTest(c), c), null)
  })

  test('configuration invalide rejetée (serveur : 400)', () => {
    assert.throws(() => validerProgramme({ parrainage: { pointsParrain: 999 } }), /pointsParrain/)
    assert.throws(() => validerProgramme({ defi: { visites: 1 } }), /visites/)
    assert.throws(() => validerProgramme({ niveaux: { vipSeuil: 2 } }), /vipSeuil/)
    assert.throws(() => validerProgramme({ surprise: true }), /inconnu/)
    assert.throws(() => validerProgramme({ paliers: { liste: [{ seuil: 0, libelle: 'x' }] } }), /seuil/)
    assert.deepEqual(validerProgramme({ parrainage: { pointsParrain: 100 } }), { parrainage: { pointsParrain: 100 } })
  })
})

describe('1. Paliers bas (Domino\'s 2023)', () => {
  test('« plus que 1 visite » avant le palier à 3, puis récompense en attente à retirer au comptoir', () => {
    const commerce = commerceTest()
    let client = clientTest(commerce, 2)
    assert.deepEqual(prochainPalier(client, commerce), { palier: { seuil: 3, libelle: 'Boisson, nems ou dessert offert' }, restantes: 1 })
    const r = appliquerVisiteProgramme(client, commerce, 0, MAINTENANT)
    client = r.client
    assert.equal(client.recompensesEnAttente?.length, 1)
    assert.equal(client.recompensesEnAttente![0].libelle, 'Boisson, nems ou dessert offert')
    assert.ok(r.evenements.some((e) => e.type === 'palier'))
    assert.deepEqual(prochainPalier(client, commerce), { palier: { seuil: 6, libelle: 'Accompagnement offert' }, restantes: 3 })
    // Remise au comptoir : la récompense passe dans les remises, le palier est marqué offert.
    client = consommerRecompenseEnAttente(client, client.recompensesEnAttente![0].id, MAINTENANT)
    assert.equal(client.recompensesEnAttente?.length, 0)
    assert.equal(client.recompensesOffertes?.length, 1)
    assert.deepEqual(client.paliersOfferts, [3])
    // Le palier ne se regagne pas à la visite suivante.
    const r2 = appliquerVisiteProgramme(client, commerce, 0, new Date(MAINTENANT.getTime() + JOUR))
    assert.equal(r2.client.recompensesEnAttente?.filter((x) => x.origine === 'palier').length, 0)
  })
})

describe('2. Parrainage bilatéral', () => {
  const commerce = commerceTest()
  const parrain = () => appliquerInscription(nouveauClient(commerce.id, 'Parrain', { telephone: '06 11 11 11 11' }, MAINTENANT), commerce)

  test('code unique + 50 points de bienvenue à l’inscription, rien pour le parrainage avant la 1re visite', () => {
    const code = genererCodeParrainage()
    assert.match(code, /^AH-[A-Z2-9]{6}$/)
    const p = parrain()
    const filleul = appliquerInscription(nouveauClient(commerce.id, 'Filleul', { telephone: '06 22 22 22 22' }, MAINTENANT), commerce, p.id)
    assert.match(filleul.codeParrainage!, /^AH-[A-Z2-9]{6}$/)
    assert.notEqual(filleul.codeParrainage, p.codeParrainage)
    assert.equal(filleul.points, 50)
    assert.equal(filleul.parrainId, p.id)
    assert.equal(parrainageDu(filleul, p, commerce, MAINTENANT), null, 'pas de 1re visite : rien n’est dû')
  })

  test('après la 1re visite du filleul : 50 points chacun, une seule fois', () => {
    const p = parrain()
    let filleul = appliquerInscription(nouveauClient(commerce.id, 'Filleul', { telephone: '06 22 22 22 22' }, MAINTENANT), commerce, p.id)
    filleul = appliquerVisiteProgramme(filleul, commerce, 2000, MAINTENANT).client
    const r = parrainageDu(filleul, p, commerce, MAINTENANT)!
    assert.equal(r.filleul.points, 50 + 20 + 50)
    assert.equal(r.parrain!.points, 50 + 50)
    assert.equal(r.parrain!.parrainagesGagnes?.length, 1)
    assert.equal(r.parrainAuPlafond, false)
    // 2e visite : plus rien (déjà payé).
    const filleul2 = appliquerVisiteProgramme(r.filleul, commerce, 2000, new Date(MAINTENANT.getTime() + JOUR)).client
    assert.equal(parrainageDu(filleul2, r.parrain!, commerce, new Date(MAINTENANT.getTime() + JOUR)), null)
  })

  test('anti-abus : plafond annuel — le filleul gagne quand même, le parrain rien', () => {
    const p = { ...parrain(), parrainagesGagnes: Array.from({ length: 12 }, (_, i) => new Date(MAINTENANT.getTime() - i * 30 * JOUR).toISOString()) }
    let filleul = appliquerInscription(nouveauClient(commerce.id, 'Filleul', { telephone: '06 22 22 22 22' }, MAINTENANT), commerce, p.id)
    filleul = appliquerVisiteProgramme(filleul, commerce, 2000, MAINTENANT).client
    const r = parrainageDu(filleul, p, commerce, MAINTENANT)!
    assert.equal(r.parrain, null)
    assert.equal(r.parrainAuPlafond, true)
    assert.equal(r.filleul.points, 50 + 20 + 50)
    assert.equal(r.filleul.parrainagePaye, true, 'marqué payé : pas de 2e tentative')
  })

  test('parrainage désactivé par le commerçant : rien n’est dû', () => {
    const sans = { ...commerce, programme: { parrainage: { actif: false } } }
    const p = parrain()
    let filleul = appliquerInscription(nouveauClient(commerce.id, 'F', { telephone: '06 22 22 22 22' }, MAINTENANT), sans, p.id)
    filleul = appliquerVisiteProgramme(filleul, sans, 2000, MAINTENANT).client
    assert.equal(parrainageDu(filleul, p, sans, MAINTENANT), null)
  })
})

describe('3. Points de bienvenue + 5. Niveaux', () => {
  test('bienvenue 50 points ; Habitué ×1,5 à 10 visites, VIP ×2 à 25 visites', () => {
    const commerce = commerceTest()
    assert.equal(appliquerInscription(nouveauClient(commerce.id, 'A', { telephone: '06 00 00 00 00' }, MAINTENANT), commerce).points, 50)
    assert.equal(niveauClient(clientTest(commerce, 9), commerce).nom, 'Membre')
    assert.equal(niveauClient(clientTest(commerce, 9), commerce).multiplicateur, 1)
    assert.equal(niveauClient(clientTest(commerce, 10), commerce).nom, 'Habitué')
    assert.equal(niveauClient(clientTest(commerce, 24), commerce).nom, 'Habitué')
    const vip = niveauClient(clientTest(commerce, 25), commerce)
    assert.equal(vip.nom, 'VIP')
    assert.equal(vip.multiplicateur, 2)
    assert.match(vip.avantages, /plat signature/)
    // Multiplicateur appliqué côté serveur : 20 € → 30 points pour un Habitué.
    const habitue = clientTest(commerce, 10)
    const r = appliquerVisiteProgramme(habitue, commerce, 2000, MAINTENANT)
    assert.equal(r.client.points, 30)
    assert.ok(r.evenements.some((e) => e.type === 'niveau') === false, 'déjà Habitué : pas de changement de niveau')
    const passeVip = appliquerVisiteProgramme(clientTest(commerce, 24), commerce, 2000, MAINTENANT)
    assert.ok(passeVip.evenements.some((e) => e.type === 'niveau' && /VIP/.test(e.texte)))
    assert.equal(passeVip.client.points, 30, 'le passage qui fait passer VIP est encore au taux Habitué (×1,5)')
  })
})

describe('4. Défis courts', () => {
  test('3 visites en 14 jours = plat offert ; un seul défi à la fois ; expiration puis redémarrage', () => {
    const commerce = commerceTest()
    let client = nouveauClient(commerce.id, 'A', { telephone: '06 00 00 00 00' }, MAINTENANT)
    let r = appliquerVisiteProgramme(client, commerce, 0, MAINTENANT)
    client = r.client
    assert.equal(client.defi?.objectif, 3)
    assert.equal(client.defi?.jours, 14)
    r = appliquerVisiteProgramme(client, commerce, 0, new Date(MAINTENANT.getTime() + JOUR))
    client = r.client
    assert.ok(client.defi, 'défi toujours en cours à 2/3')
    r = appliquerVisiteProgramme(client, commerce, 0, new Date(MAINTENANT.getTime() + 2 * JOUR))
    client = r.client
    assert.equal(client.defi, undefined, 'défi terminé')
    assert.equal(client.defisReussis?.length, 1)
    assert.ok(client.recompensesEnAttente?.some((x) => x.origine === 'defi' && x.libelle === 'Plat offert'))
    // Visite suivante : un nouveau défi démarre.
    r = appliquerVisiteProgramme(client, commerce, 0, new Date(MAINTENANT.getTime() + 3 * JOUR))
    assert.ok(r.client.defi, 'nouveau défi')
    // Défi expiré sans complétion : pas de récompense, on repart à zéro.
    let lent = nouveauClient(commerce.id, 'B', { telephone: '06 00 00 00 01' }, MAINTENANT)
    lent = appliquerVisiteProgramme(lent, commerce, 0, MAINTENANT).client
    lent = appliquerVisiteProgramme(lent, commerce, 0, new Date(MAINTENANT.getTime() + 20 * JOUR)).client
    assert.equal(lent.defisReussis?.length ?? 0, 0)
    assert.ok(lent.defi, 'nouveau défi après expiration')
  })
})

describe('6. Win-back recalibré', () => {
  test('30 j : rien ; 45 j : rappel sans remise ; 60 j : offre ; 90 j : dernière chance ; 121 j : arrêt', () => {
    const commerce = commerceTest()
    const client = { ...clientTest(commerce, 1), derniereVisite: MAINTENANT.toISOString() }
    const a = (jours: number) => etapeWinback(client, commerce, new Date(MAINTENANT.getTime() + jours * JOUR))?.etape ?? null
    assert.equal(a(30), null)
    assert.equal(a(44), null)
    assert.equal(a(45), 'rappel')
    assert.equal(a(59), 'rappel')
    assert.equal(a(60), 'offre')
    assert.equal(a(89), 'offre')
    assert.equal(a(90), 'derniere')
    assert.equal(a(120), 'derniere')
    assert.equal(a(121), null, 'sunset : plus aucun message')
    assert.equal(etapeWinback({ ...client, derniereVisite: null }, commerce, MAINTENANT), null, 'jamais venu : pas de relance')
  })
})

describe('7. Anniversaire amélioré', () => {
  test('J-7 + jour J, valable 14 j ; demi-anniversaire ; anniversaire d’adhésion', () => {
    const commerce = commerceTest()
    const client: Client = { ...clientTest(commerce, 2), anniversaire: '11-14', creeLe: new Date(2025, 5, 1, 12, 0).toISOString() }
    assert.equal(fenetreAnniversaire(client, commerce, new Date(2026, 10, 7, 12, 0))?.type, 'anniversaire', 'J-7 : la fenêtre ouvre')
    assert.equal(fenetreAnniversaire(client, commerce, new Date(2026, 10, 5, 12, 0)), null, '9 jours avant : rien')
    assert.equal(fenetreAnniversaire(client, commerce, new Date(2026, 10, 9, 12, 0))?.type, 'anniversaire', 'J-5 : déjà dans la fenêtre')
    assert.equal(fenetreAnniversaire(client, commerce, new Date(2026, 10, 14, 12, 0))?.libelle, 'Dessert offert')
    assert.equal(fenetreAnniversaire(client, commerce, new Date(2026, 10, 28, 12, 0))?.type, 'anniversaire', 'J+14 : encore valable')
    assert.equal(fenetreAnniversaire(client, commerce, new Date(2026, 10, 29, 12, 0)), null, 'J+15 : expiré')
    // Demi-anniversaire : 6 mois après le 14/11 → 14/05, boisson offerte.
    assert.equal(fenetreAnniversaire(client, commerce, new Date(2027, 4, 14, 12, 0))?.type, 'demi-anniversaire')
    assert.equal(fenetreAnniversaire(client, commerce, new Date(2027, 4, 14, 12, 0))?.libelle, 'Boisson offerte')
    // Anniversaire d'adhésion : 1 an après le 09/11/2025 → 09/11/2026, mais l'anniversaire (14/11) prime cette semaine-là.
    const sansAnniv: Client = { ...clientTest(commerce, 2), creeLe: new Date(2025, 9, 9, 12, 0).toISOString() }
    assert.equal(fenetreAnniversaire(sansAnniv, commerce, new Date(2026, 9, 9, 12, 0))?.type, 'adhesion')
    // VIP : plat signature, valable 30 jours.
    const vip: Client = { ...clientTest(commerce, 25), anniversaire: '11-09', creeLe: new Date(2025, 10, 9, 12, 0).toISOString() }
    assert.equal(fenetreAnniversaire(vip, commerce, MAINTENANT)?.libelle, 'Plat signature offert')
    assert.equal(fenetreAnniversaire(vip, commerce, new Date(2026, 11, 8, 12, 0))?.type, 'anniversaire', 'J+29 : encore valable pour un VIP')
  })
})

describe('8. Offre hebdomadaire + 10. Profil progressif', () => {
  test('mardi : boisson offerte dès 15 € ; mercredi : rien', () => {
    const commerce = commerceTest()
    assert.deepEqual(offreHebdoDuJour(commerce, new Date(2026, 10, 10, 12, 0)), { libelle: 'Boisson offerte', condition: 'dès 15 €' }, '10/11/2026 = mardi')
    assert.equal(offreHebdoDuJour(commerce, new Date(2026, 10, 11, 12, 0)), null)
    const sans = { ...commerce, programme: { offreHebdo: { actif: false } } }
    assert.equal(offreHebdoDuJour(sans, new Date(2026, 10, 10, 12, 0)), null)
  })

  test('profil complété après la 2e visite seulement, jamais à l’inscription', () => {
    const commerce = commerceTest()
    assert.equal(peutCompleterProfil(clientTest(commerce, 1)), false)
    assert.equal(peutCompleterProfil(clientTest(commerce, 2)), true)
  })
})

describe('11. Plat en réserve + 9. Rattrapage', () => {
  test('commande ≥ 25 € → plat en réserve 30 jours, 1 par trimestre ; utilisation puis refus d’un 2e', () => {
    const commerce = commerceTest()
    let client = nouveauClient(commerce.id, 'A', { telephone: '06 00 00 00 00' }, MAINTENANT)
    let r = appliquerVisiteProgramme(client, commerce, 2400, MAINTENANT)
    assert.equal(r.client.reserve, undefined, '24 € : sous le seuil')
    r = appliquerVisiteProgramme(r.client, commerce, 3000, new Date(MAINTENANT.getTime() + JOUR))
    client = r.client
    assert.ok(client.reserve, '30 € : plat en réserve gagné')
    assert.equal(client.reserve!.expireLe, new Date(MAINTENANT.getTime() + 31 * JOUR).toISOString())
    assert.ok(r.evenements.some((e) => e.type === 'reserve'))
    // 2e commande ≥ 25 € le mois suivant : pas de 2e réserve (1 par trimestre).
    r = appliquerVisiteProgramme(client, commerce, 3000, new Date(MAINTENANT.getTime() + 30 * JOUR))
    assert.equal(r.client.reservesGagnees?.length, 1)
    // Utilisation, puis plus rien d'utilisable.
    client = utiliserReserve(r.client, new Date(MAINTENANT.getTime() + 30 * JOUR))
    assert.ok(client.reserve!.utiliseLe)
    assert.throws(() => utiliserReserve(client, new Date(MAINTENANT.getTime() + 30 * JOUR)), /Aucun plat en réserve/)
    // Expiré : inutilisable.
    const expire = appliquerVisiteProgramme(nouveauClient(commerce.id, 'B', { telephone: '06 00 00 00 01' }, MAINTENANT), commerce, 3000, MAINTENANT).client
    assert.throws(() => utiliserReserve(expire, new Date(MAINTENANT.getTime() + 31 * JOUR)), /expiré|utilisable/)
  })

  test('rattrapage : 30 jours, pas le futur, pas de doublon le même jour ; validation = +1 visite + points, sans régression', () => {
    const commerce = commerceTest()
    const client: Client = { ...clientTest(commerce, 0), visites: [MAINTENANT.toISOString()], derniereVisite: MAINTENANT.toISOString(), tampons: 1 }
    assert.match(rattrapageRecevable(client, commerce, new Date(MAINTENANT.getTime() + JOUR), 2000, MAINTENANT)!, /futur/)
    assert.match(rattrapageRecevable(client, commerce, new Date(MAINTENANT.getTime() - 31 * JOUR), 2000, MAINTENANT)!, /30 jours/)
    assert.match(rattrapageRecevable(client, commerce, MAINTENANT, 2000, MAINTENANT)!, /déjà enregistrée/)
    assert.equal(rattrapageRecevable(client, commerce, new Date(MAINTENANT.getTime() - 5 * JOUR), 2000, MAINTENANT), null)
    const r = appliquerRattrapageValide(client, commerce, 2000, new Date(MAINTENANT.getTime() - 5 * JOUR))
    assert.equal(r.client.tampons, 2)
    assert.equal(r.client.points, 20)
    assert.equal(r.client.derniereVisite, MAINTENANT.toISOString(), 'la dernière visite reste la plus récente')
    assert.deepEqual(r.client.visites, [...r.client.visites].sort(), 'historique chronologique')
    // 1 tampon par jour : le passage le même jour que la visite rattrapée est refusé.
    assert.throws(() => passageAvecProgramme(r.client, commerce, 0, new Date(MAINTENANT.getTime() - 5 * JOUR)), /déjà un passage/)
  })
})

// ---------- Serveur ----------

const ADMIN = '98765432'
const AH = 'c-asian-home-paris'

let horloge = new Date(2026, 10, 9, 12, 0)

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
    return { statut: r.status, contenu: type.includes('json') ? await r.json() : await r.text() }
  }
  return { app, api }
}

describe('Serveur : programme de fidélité', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-programme-'))
  const fichierDb = join(dossier, 'fidelite.db')
  let srv: Awaited<ReturnType<typeof demarrer>>
  const pin = { 'X-Commerce-PIN': '1234' }

  before(async () => {
    horloge = new Date(2026, 10, 9, 12, 0)
    srv = await demarrer(fichierDb)
  })
  after(async () => {
    await srv.app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('/sante : migration programme appliquée (SQLite)', async () => {
    const r = await srv.api('GET', '/sante')
    assert.equal(r.contenu.migrations.programme, true)
    assert.equal(r.contenu.migrations.cartiz, true)
  })

  test('inscription simplifiée : téléphone seul, prénom optionnel, 50 points + code de parrainage', async () => {
    const r = await srv.api('POST', `/commerces/${AH}/clients`, { contact: '06 12 34 56 78' }, pin)
    assert.equal(r.statut, 201)
    assert.equal(r.contenu.client.prenom, '')
    assert.equal(r.contenu.client.points, 50)
    assert.match(r.contenu.client.codeParrainage, /^AH-[A-Z2-9]{6}$/)
    assert.equal((await srv.api('POST', `/commerces/${AH}/clients`, { contact: '+33 6 12 34 56 78' }, pin)).contenu.existant, true, 'déduplication inchangée')
  })

  test('parrainage de bout en bout : 50 points chacun à la 1re visite du filleul, une seule fois, tracé au journal', async () => {
    const parrain = (await srv.api('POST', `/commerces/${AH}/clients`, { prenom: 'Parrain', contact: '06 11 11 11 11' }, pin)).contenu.client as Client
    await srv.api('POST', `/commerces/${AH}/clients/${parrain.id}/visite`, undefined, pin)
    const filleul = (await srv.api('POST', `/commerces/${AH}/clients`, { prenom: 'Filleul', contact: '06 22 22 22 22', parrain: parrain.codeParrainage }, pin)).contenu.client as Client
    assert.equal(filleul.parrainId, parrain.id)
    assert.equal(filleul.points, 50)
    horloge = new Date(2026, 10, 10, 12, 0)
    const passage = await srv.api('POST', `/commerces/${AH}/caisse/passage`, { clientId: filleul.id, montantCentimes: 2000, actionId: 'act-par-2' }, { 'X-Commerce-PIN': '1234' })
    assert.equal(passage.statut, 200)
    assert.equal(passage.contenu.client.points, 120, '50 bienvenue + 20 passage + 50 parrainage')
    const etat = await srv.api('GET', `/commerces/${AH}/etat`, undefined, pin)
    const parrainApres = etat.contenu.clients.find((c: Client) => c.id === parrain.id)
    assert.equal(parrainApres.points, 100, '50 bienvenue + 50 parrainage (visite sans montant)')
    assert.equal(parrainApres.parrainagesGagnes.length, 1)
    assert.ok(etat.contenu.journal.some((e: { action: string }) => e.action === 'parrainage'))
    // 2e visite du filleul : plus aucun point de parrainage.
    horloge = new Date(2026, 10, 11, 12, 0)
    const p2 = await srv.api('POST', `/commerces/${AH}/caisse/passage`, { clientId: filleul.id, montantCentimes: 2000, actionId: 'act-par-3' }, { 'X-Commerce-PIN': '1234' })
    assert.equal(p2.contenu.client.points, 140)
    horloge = new Date(2026, 10, 9, 12, 0)
  })

  test('parrainage : code inconnu ignoré ; plafond annuel — le 2e filleul gagne, le parrain non', async () => {
    const commerce = (await srv.api('POST', '/commerces', { nom: 'Chez Plafond', type: 'restaurant', lienGoogle: 'https://g.page/r/x/review', pin: '4321', programme: { parrainage: { plafondAn: 1 } } }, { 'X-Admin-PIN': ADMIN })).contenu.commerce
    const p = { 'X-Commerce-PIN': '4321' }
    const parrain = (await srv.api('POST', `/commerces/${commerce.id}/clients`, { prenom: 'P', contact: '06 33 33 33 33' }, p)).contenu.client as Client
    const orphelin = (await srv.api('POST', `/commerces/${commerce.id}/clients`, { prenom: 'O', contact: '06 44 44 44 44', parrain: 'AH-XXXXXX' }, p)).contenu.client as Client
    assert.equal(orphelin.parrainId, undefined)
    const f1 = (await srv.api('POST', `/commerces/${commerce.id}/clients`, { prenom: 'F1', contact: '06 55 55 55 55', parrain: parrain.codeParrainage }, p)).contenu.client as Client
    const f2 = (await srv.api('POST', `/commerces/${commerce.id}/clients`, { prenom: 'F2', contact: '06 66 66 66 66', parrain: parrain.codeParrainage }, p)).contenu.client as Client
    await srv.api('POST', `/commerces/${commerce.id}/clients/${f1.id}/visite`, undefined, p)
    await srv.api('POST', `/commerces/${commerce.id}/clients/${f2.id}/visite`, undefined, p)
    const etat = await srv.api('GET', `/commerces/${commerce.id}/etat`, undefined, p)
    const parrainApres = etat.contenu.clients.find((c: Client) => c.id === parrain.id)
    assert.equal(parrainApres.points, 100, '50 bienvenue + 50 (1er filleul seulement)')
    assert.equal(etat.contenu.clients.find((c: Client) => c.id === f2.id).points, 100, '50 bienvenue + 50 parrainage malgré le plafond')
  })

  test('paliers + défi en caisse : récompenses en attente, remise au comptoir', async () => {
    const c = (await srv.api('POST', `/commerces/${AH}/clients`, { prenom: 'Defi', contact: '06 77 77 77 77' }, pin)).contenu.client as Client
    for (let j = 0; j < 3; j++) {
      horloge = new Date(2026, 10, 9 + j, 12, 0)
      const r = await srv.api('POST', `/commerces/${AH}/caisse/passage`, { clientId: c.id, montantCentimes: 0, actionId: `act-defi-${j}` }, { 'X-Commerce-PIN': '1234' })
      assert.equal(r.statut, 200)
    }
    const apres = (await srv.api('GET', `/commerces/${AH}/etat`, undefined, pin)).contenu.clients.find((x: Client) => x.id === c.id) as Client
    assert.equal(apres.tampons, 3)
    assert.ok(apres.recompensesEnAttente?.some((x) => x.origine === 'palier' && x.libelle === 'Boisson, nems ou dessert offert'))
    assert.ok(apres.recompensesEnAttente?.some((x) => x.origine === 'defi' && x.libelle === 'Plat offert'))
    assert.equal(apres.defisReussis?.length, 1)
    const palier = apres.recompensesEnAttente!.find((x) => x.origine === 'palier')!
    const remise = await srv.api('POST', `/commerces/${AH}/caisse/attente`, { clientId: c.id, recompenseId: palier.id, actionId: 'act-remise-1' }, { 'X-Commerce-PIN': '1234' })
    assert.equal(remise.statut, 200)
    assert.equal(remise.contenu.client.recompensesOffertes.length, 1)
    assert.deepEqual(remise.contenu.client.paliersOfferts, [3])
    horloge = new Date(2026, 10, 9, 12, 0)
  })

  test('niveaux : 10 visites → Habitué ×1,5 sur le passage suivant', async () => {
    const c = (await srv.api('POST', `/commerces/${AH}/clients`, { prenom: 'Habitue', contact: '06 88 88 88 88' }, pin)).contenu.client as Client
    for (let i = 0; i < 10; i++) assert.equal((await srv.api('POST', `/commerces/${AH}/clients/${c.id}/visite`, undefined, pin)).statut, 200)
    horloge = new Date(2026, 10, 10, 12, 0) // jour suivant : la garde « 1 tampon par jour » de la caisse s'applique
    const passage = await srv.api('POST', `/commerces/${AH}/caisse/passage`, { clientId: c.id, montantCentimes: 2000, actionId: 'act-niv-1' }, { 'X-Commerce-PIN': '1234' })
    assert.equal(passage.statut, 200)
    assert.equal(passage.contenu.client.points, 50 + 30, '50 bienvenue + 20 € × 1,5')
    horloge = new Date(2026, 10, 9, 12, 0)
  })

  test('win-back en 3 temps via la carte : rappel 45 j, offre 60 j, arrêt après 120 j', async () => {
    const regles = { bienvenue: false, recompense: false, presque: false, inactif: true, anniversaire: false, avis: false }
    assert.equal((await srv.api('PATCH', `/commerces/${AH}`, { messagesAuto: regles }, pin)).statut, 200)
    const c = (await srv.api('POST', `/commerces/${AH}/clients`, { prenom: 'Absent', contact: '06 99 99 99 99' }, pin)).contenu.client as Client
    await srv.api('POST', `/commerces/${AH}/clients/${c.id}/visite`, undefined, pin)
    horloge = new Date(2026, 11, 25, 12, 0) // +46 j : rappel doux
    let messages = (await srv.api('GET', `/cartes/${c.id}`)).contenu.client.messages as { type: string; texte: string }[]
    assert.equal(messages.filter((m) => m.type === 'inactif').length, 1)
    assert.doesNotMatch(messages[0].texte, /offert/)
    horloge = new Date(2027, 0, 9, 12, 0) // +61 j : offre
    messages = (await srv.api('GET', `/cartes/${c.id}`)).contenu.client.messages as { type: string; texte: string }[]
    assert.equal(messages.filter((m) => m.type === 'inactif').length, 2)
    assert.match(messages.find((m) => m.type === 'inactif' && /Produit offert/.test(m.texte))!.texte, /Produit offert/)
    horloge = new Date(2027, 2, 10, 12, 0) // +121 j : sunset, plus rien
    messages = (await srv.api('GET', `/cartes/${c.id}`)).contenu.client.messages as { type: string; texte: string }[]
    assert.equal(messages.filter((m) => m.type === 'inactif').length, 2)
    horloge = new Date(2026, 10, 9, 12, 0)
  })

  test('anniversaire : message + dessert offert en attente, valable 14 jours', async () => {
    const regles = { bienvenue: false, recompense: false, presque: false, inactif: false, anniversaire: true, avis: false }
    assert.equal((await srv.api('PATCH', `/commerces/${AH}`, { messagesAuto: regles }, pin)).statut, 200)
    const c = (await srv.api('POST', `/commerces/${AH}/clients`, { prenom: 'Anniv', contact: '06 10 10 10 10' }, pin)).contenu.client as Client
    assert.equal((await srv.api('PATCH', `/commerces/${AH}/clients/${c.id}`, { anniversaire: '11-09' }, pin)).statut, 200)
    const carte = await srv.api('GET', `/cartes/${c.id}`)
    assert.ok(carte.contenu.client.messages.some((m: { type: string }) => m.type === 'anniversaire'))
    assert.ok(carte.contenu.client.recompensesEnAttente?.some((r: { libelle: string }) => r.libelle === 'Dessert offert'))
  })

  test('plat en réserve : gagné à 30 €, 1 par trimestre, utilisable puis épuisé', async () => {
    const c = (await srv.api('POST', `/commerces/${AH}/clients`, { prenom: 'Reserve', contact: '06 12 12 12 12' }, pin)).contenu.client as Client
    const p1 = await srv.api('POST', `/commerces/${AH}/caisse/passage`, { clientId: c.id, montantCentimes: 3000, actionId: 'act-res-1' }, { 'X-Commerce-PIN': '1234' })
    assert.equal(p1.statut, 200)
    assert.ok(p1.contenu.client.reserve, 'plat en réserve gagné')
    assert.equal(p1.contenu.client.reserve.expireLe, new Date(2026, 11, 9, 12, 0).toISOString(), 'valable 30 jours')
    const use = await srv.api('POST', `/commerces/${AH}/caisse/reserve`, { clientId: c.id, actionId: 'act-res-2' }, { 'X-Commerce-PIN': '1234' })
    assert.equal(use.statut, 200)
    assert.ok(use.contenu.client.reserve.utiliseLe)
    assert.equal((await srv.api('POST', `/commerces/${AH}/caisse/reserve`, { clientId: c.id, actionId: 'act-res-3' }, { 'X-Commerce-PIN': '1234' })).statut, 409)
    horloge = new Date(2026, 10, 10, 12, 0)
    const p2 = await srv.api('POST', `/commerces/${AH}/caisse/passage`, { clientId: c.id, montantCentimes: 3000, actionId: 'act-res-4' }, { 'X-Commerce-PIN': '1234' })
    assert.equal(p2.contenu.client.reservesGagnees.length, 1, 'pas de 2e réserve dans le trimestre')
    horloge = new Date(2026, 10, 9, 12, 0)
  })

  test('rattrapage : déclaration, validation (+1 visite + points), refus, délais', async () => {
    const c = (await srv.api('POST', `/commerces/${AH}/clients`, { prenom: 'Oublie', contact: '06 13 13 13 13' }, pin)).contenu.client as Client
    await srv.api('POST', `/commerces/${AH}/clients/${c.id}/visite`, undefined, pin)
    const tropTard = await srv.api('POST', `/commerces/${AH}/clients/${c.id}/rattrapage`, { date: new Date(2026, 9, 1).toISOString(), montantCentimes: 2000 })
    assert.equal(tropTard.statut, 409, 'plus de 30 jours : refusé')
    const d = await srv.api('POST', `/commerces/${AH}/clients/${c.id}/rattrapage`, { date: new Date(2026, 10, 4, 12, 0).toISOString(), montantCentimes: 2000, ticket: 'T-42' })
    assert.equal(d.statut, 201)
    assert.equal(d.contenu.demande.statut, 'en_attente')
    const valide = await srv.api('POST', `/commerces/${AH}/clients/${c.id}/rattrapage/${d.contenu.demande.id}`, { decision: 'valider' }, pin)
    assert.equal(valide.statut, 200)
    assert.equal(valide.contenu.client.tampons, 2)
    assert.equal(valide.contenu.client.points, 70, '50 bienvenue + 20 rattrapage')
    assert.equal((await srv.api('POST', `/commerces/${AH}/clients/${c.id}/rattrapage/${d.contenu.demande.id}`, { decision: 'valider' }, pin)).statut, 409, 'déjà traitée')
    assert.equal((await srv.api('POST', `/commerces/${AH}/clients/${c.id}/rattrapage`, { date: new Date(2026, 10, 4, 12, 0).toISOString(), montantCentimes: 1000 })).statut, 409, 'une visite existe déjà ce jour-là')
    const d2 = await srv.api('POST', `/commerces/${AH}/clients/${c.id}/rattrapage`, { date: new Date(2026, 10, 5, 12, 0).toISOString(), montantCentimes: 1500 })
    assert.equal(d2.statut, 201)
    const refuse = await srv.api('POST', `/commerces/${AH}/clients/${c.id}/rattrapage/${d2.contenu.demande.id}`, { decision: 'refuser' }, pin)
    assert.equal(refuse.statut, 200)
    assert.equal(refuse.contenu.client.tampons, 2, 'refus : aucun tampon')
  })

  test('profil progressif : refusé avant la 2e visite, accepté ensuite', async () => {
    const c = (await srv.api('POST', `/commerces/${AH}/clients`, { prenom: 'Profil', contact: '06 14 14 14 14' }, pin)).contenu.client as Client
    assert.equal((await srv.api('POST', `/commerces/${AH}/clients/${c.id}/profil`, { anniversaire: '21/03', platPrefere: 'Satay' })).statut, 409)
    await srv.api('POST', `/commerces/${AH}/clients/${c.id}/visite`, undefined, pin)
    await srv.api('POST', `/commerces/${AH}/clients/${c.id}/visite`, undefined, pin)
    const r = await srv.api('POST', `/commerces/${AH}/clients/${c.id}/profil`, { anniversaire: '21/03', platPrefere: 'Satay' })
    assert.equal(r.statut, 200)
    assert.equal(r.contenu.client.anniversaire, '03-21')
    assert.equal(r.contenu.client.platPrefere, 'Satay')
  })

  test('réglages programme : invalide refusé, partiel accepté et fusionné', async () => {
    assert.equal((await srv.api('PATCH', `/commerces/${AH}`, { programme: { parrainage: { pointsParrain: 999 } } }, pin)).statut, 400)
    assert.equal((await srv.api('PATCH', `/commerces/${AH}`, { programme: { surprise: true } }, pin)).statut, 400)
    const r = await srv.api('PATCH', `/commerces/${AH}`, { programme: { parrainage: { pointsParrain: 100 } } }, pin)
    assert.equal(r.statut, 200)
    assert.equal(r.contenu.commerce.programme.parrainage.pointsParrain, 100)
    assert.equal(r.contenu.commerce.programme.parrainage.pointsFilleul, undefined, 'le reste garde ses défauts côté logique')
    const r2 = await srv.api('PATCH', `/commerces/${AH}`, { programme: { defi: { visites: 2 } } }, pin)
    assert.equal(r2.contenu.commerce.programme.parrainage.pointsParrain, 100, 'fusion : le bloc précédent est conservé')
  })
})

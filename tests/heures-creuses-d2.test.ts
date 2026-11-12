// Roue v2 D2 — Créneaux heures creuses : pendant un créneau (jours + début inclus–fin exclue, heure de Paris), les lots
// `heuresCreuses` sont tirables et publiés, la consolation en points tirée est doublée et la fiche publique porte
// `bonusCreux` ; hors créneau, ces lots sont exclus comme un lot à 0 %. Logique pure, puis vrai serveur HTTP sur SQLite
// temporaire (horloge et hasard du tirage injectés).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { CRENEAUX_MAX, creneauActif, lotsDuCreneau, momentParis, nettoyerCreneaux, pointsDuCreneau, problemeCreneaux, texteCreneau } from '../src/lib/creneaux.ts'
import { instantParis } from '../src/lib/roulette.ts'
import { commercePublic } from '../src/lib/vuePublique.ts'
import { nouveauCommerce } from '../src/data/defaults.ts'
import type { Commerce, CreneauCreux, Tirage } from '../src/types.ts'

const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')
/** Mardi 10/11/2026 à Paris (heure d'hiver, UTC+1). */
const mardi = (h: number, m = 0, s = 0) => new Date(instantParis(2026, 11, 10, h, m).getTime() + s * 1000)
const CRENEAU_MARDI: CreneauCreux = { jours: [2], debut: '14:00', fin: '17:00' }

describe('D2 : logique pure (src/lib/creneaux.ts)', () => {
  test('matrice jours / heures : début inclus, fin exclue, autres jours exclus', () => {
    const cas: [Date, boolean, string][] = [
      [mardi(13, 59, 59), false, 'mardi 13:59:59'],
      [mardi(14), true, 'mardi 14:00:00 (début inclus)'],
      [mardi(15, 30), true, 'mardi 15:30'],
      [mardi(16, 59, 59), true, 'mardi 16:59:59'],
      [mardi(17), false, 'mardi 17:00:00 (fin exclue)'],
      [new Date(mardi(15).getTime() - 24 * 3600 * 1000), false, 'lundi 15:00'],
      [new Date(mardi(15).getTime() + 24 * 3600 * 1000), false, 'mercredi 15:00'],
      [new Date(mardi(15).getTime() + 7 * 24 * 3600 * 1000), true, 'mardi suivant 15:00'],
    ]
    for (const [d, attendu, nom] of cas) assert.equal(creneauActif([CRENEAU_MARDI], d), attendu, nom)
    // Plusieurs jours, plusieurs créneaux.
    const semaine: CreneauCreux[] = [{ jours: [1, 2, 3], debut: '09:00', fin: '10:00' }, CRENEAU_MARDI]
    assert.equal(creneauActif(semaine, mardi(9, 30)), true)
    assert.equal(creneauActif(semaine, mardi(10)), false)
    assert.equal(creneauActif(semaine, mardi(14, 1)), true)
    assert.equal(creneauActif(undefined, mardi(15)), false)
    assert.equal(creneauActif([], mardi(15)), false)
  })

  test('jour et heure lus à PARIS, quel que soit le fuseau du processus (minuit, été comme hiver)', () => {
    // Lundi 00:30 à Paris = dimanche 23:30 UTC (hiver) ; samedi 01:30 à Paris en été = vendredi 23:30 UTC.
    const lundi0030 = instantParis(2026, 11, 9, 0, 30)
    assert.equal(lundi0030.getUTCDay(), 0)
    assert.deepEqual(momentParis(lundi0030), { jour: 1, minute: 30 })
    assert.equal(creneauActif([{ jours: [1], debut: '00:00', fin: '01:00' }], lundi0030), true)
    assert.equal(creneauActif([{ jours: [0], debut: '23:00', fin: '23:59' }], lundi0030), false)
    const samediEte = instantParis(2026, 7, 4, 1, 30)
    assert.deepEqual(momentParis(samediEte), { jour: 6, minute: 90 })
    assert.equal(creneauActif([{ jours: [6], debut: '01:00', fin: '02:00' }], samediEte), true)
  })

  test('validation : ≤ 6 créneaux, au moins un jour 0–6 sans doublon, HH:MM, début < fin ; nettoyage', () => {
    assert.equal(problemeCreneaux([]), null)
    assert.equal(problemeCreneaux([CRENEAU_MARDI, { jours: [0, 6], debut: '00:00', fin: '23:59' }]), null)
    for (const v of [
      'midi',
      null,
      Array.from({ length: CRENEAUX_MAX + 1 }, () => CRENEAU_MARDI),
      [{ jours: [], debut: '14:00', fin: '17:00' }],
      [{ jours: [7], debut: '14:00', fin: '17:00' }],
      [{ jours: [1.5], debut: '14:00', fin: '17:00' }],
      [{ jours: [2, 2], debut: '14:00', fin: '17:00' }],
      [{ jours: '2', debut: '14:00', fin: '17:00' }],
      [{ jours: [2], debut: '14h', fin: '17:00' }],
      [{ jours: [2], debut: '24:00', fin: '17:00' }],
      [{ jours: [2], debut: '17:00', fin: '17:00' }],
      [{ jours: [2], debut: '22:00', fin: '02:00' }],
    ]) {
      assert.ok(problemeCreneaux(v), JSON.stringify(v))
    }
    assert.deepEqual(nettoyerCreneaux([{ jours: [5, 1, 3], debut: '15:00', fin: '18:00', x: 1 } as CreneauCreux]), [{ jours: [1, 3, 5], debut: '15:00', fin: '18:00' }])
    assert.equal(texteCreneau({ jours: [0, 1, 2], debut: '15:00', fin: '18:00' }), 'lun., mar., dim. · 15:00–18:00')
  })

  test('ensemble tirable : lots creux retirés hors créneau (ordre gardé), tous pendant ; consolation doublée pendant', () => {
    const lots = [{ id: 'a' }, { id: 'b', heuresCreuses: true }, { id: 'c', heuresCreuses: false }]
    assert.deepEqual(lotsDuCreneau(lots, false).map((l) => l.id), ['a', 'c'])
    assert.deepEqual(lotsDuCreneau(lots, true).map((l) => l.id), ['a', 'b', 'c'])
    assert.equal(pointsDuCreneau(10, true), 20)
    assert.equal(pointsDuCreneau(10, false), 10)
  })

  test('vue publique : lots creux et bonusCreux seulement pendant un créneau ; ni créneaux ni drapeau des lots publiés', () => {
    const c: Commerce = {
      ...nouveauCommerce('Test', 'restaurant', ''),
      creneauxCreux: [CRENEAU_MARDI],
      lots: [
        { id: 'creux', type: 'lot', libelle: 'Mochi', probabilite: 20, heuresCreuses: true },
        { id: 'nems', type: 'lot', libelle: 'Nems', probabilite: 80 },
      ],
    }
    const hors = commercePublic(c)
    assert.deepEqual(hors.lots.map((l) => l.id), ['nems'])
    assert.equal('bonusCreux' in hors, false)
    const pendant = commercePublic(c, new Set(), true)
    assert.deepEqual(pendant.lots, [{ id: 'creux', libelle: 'Mochi', type: 'lot' }, { id: 'nems', libelle: 'Nems', type: 'lot' }])
    assert.equal(pendant.bonusCreux, true)
    assert.doesNotMatch(JSON.stringify(pendant), /creneauxCreux|heuresCreuses|14:00/)
    // Plafonné aujourd'hui : absent même pendant un créneau.
    assert.deepEqual(commercePublic(c, new Set(['creux']), true).lots.map((l) => l.id), ['nems'])
  })
})

describe('D2 : serveur (SQLite) — réglages, ensemble tirable, consolation doublée, fiche publique', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-d2-'))
  const fichierDb = join(dossier, 'd2.db')
  let app: Awaited<ReturnType<typeof creerServeur>>
  let base = ''
  let n = 0
  let ip = 0
  let horloge = mardi(10)
  let hasard = 0
  let soldeDepart = NaN

  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.3.${Math.floor(++ip / 250)}.${ip % 250}`, ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    return { statut: r.status, contenu: await r.json() }
  }
  const etat = async () => (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu as { commerce: Commerce; tirages: Tirage[] }
  const nouveauContact = () => `06${String(40_000_000 + ++n).padStart(8, '0')}`
  const tirer = async () => {
    const r = await api('POST', `/commerces/${AH}/tirages`, { contact: nouveauContact(), prenom: 'Joueur' })
    assert.equal(r.statut, 201, JSON.stringify(r.contenu))
    return r.contenu as { tirageId: string; lot: string; lotId: string; type: string; points?: number; solde?: number; pointsDoubles?: true }
  }
  const fiche = async () => (await api('GET', `/commerces/${AH}`)).contenu.commerce as { lots: { id: string }[]; bonusCreux?: true }

  before(async () => {
    app = await creerServeur({ fichierDb, adminPin: '98765432', pinInitial: '1234', version: 'test', maintenant: () => horloge, alea: () => hasard, derriereProxy: true })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('réglages : creneauxCreux et heuresCreuses validés (400 sans rien écrire), créneaux nettoyés, drapeau écrit seulement à true', async () => {
    const avant = (await etat()).commerce
    assert.equal(avant.creneauxCreux, undefined)
    for (const corps of [
      { creneauxCreux: [{ jours: [], debut: '14:00', fin: '17:00' }] },
      { creneauxCreux: [{ jours: [2], debut: '17:00', fin: '14:00' }] },
      { creneauxCreux: 'mardi' },
      { lots: [{ type: 'lot', libelle: 'Mochi', probabilite: 50, heuresCreuses: 'oui' }, { type: 'lot', libelle: 'Nems', probabilite: 50 }] },
      // Tous les lots jouables en heures creuses : la roue serait vide hors créneau.
      { lots: [{ type: 'lot', libelle: 'Mochi', probabilite: 50, heuresCreuses: true }, { type: 'lot', libelle: 'Nems', probabilite: 0 }] },
    ]) {
      const r = await api('PATCH', `/commerces/${AH}`, corps, PIN)
      assert.equal(r.statut, 400, JSON.stringify(corps))
    }
    assert.deepEqual((await etat()).commerce, avant)
    const r = await api('PATCH', `/commerces/${AH}`, {
      modeAccesRoue: 'libre',
      limiteGainsMois: 0,
      creneauxCreux: [{ jours: [2], debut: '14:00', fin: '17:00', ignore: true }],
      lots: [
        { id: 'lot-creux', type: 'lot', libelle: 'Mochi creux', probabilite: 50, heuresCreuses: true },
        { id: 'lot-nems', type: 'lot', libelle: 'Nems', probabilite: 0, heuresCreuses: false },
        { id: 'lot-pts', type: 'points', points: 10, libelle: '+10 points', probabilite: 50 },
      ],
    }, PIN)
    assert.equal(r.statut, 200, JSON.stringify(r.contenu))
    const c = r.contenu.commerce as Commerce
    assert.deepEqual(c.creneauxCreux, [{ jours: [2], debut: '14:00', fin: '17:00' }])
    assert.deepEqual(c.lots.map((l) => [l.id, l.heuresCreuses ?? null]), [['lot-creux', true], ['lot-nems', null], ['lot-pts', null]])
  })

  test('hors créneau : lot creux absent de la roue publique, jamais tiré même avec le hasard forcé dessus ; consolation simple', async () => {
    for (const h of [mardi(13, 59), mardi(17), new Date(mardi(15).getTime() + 24 * 3600 * 1000)]) {
      horloge = h
      const f = await fiche()
      assert.deepEqual(f.lots.map((l) => l.id), ['lot-pts'], h.toISOString())
      assert.equal(f.bonusCreux, undefined, 'pas de badge hors créneau')
      hasard = 0 // 1er lot de l'ensemble : le lot creux s'il y était
      const t = await tirer()
      assert.equal(t.lotId, 'lot-pts')
      assert.equal(t.points, 10)
      assert.equal(t.pointsDoubles, undefined)
      // Nouveau client à chaque tirage : solde = points de départ (bienvenue éventuelle) + 10.
      soldeDepart = t.solde! - 10
    }
  })

  test('pendant le créneau (bornes incluse) : lot creux publié et tirable, bonusCreux posé ; consolation doublée et tracée', async () => {
    horloge = mardi(14)
    const f = await fiche()
    assert.deepEqual(f.lots.map((l) => l.id), ['lot-creux', 'lot-pts'])
    assert.equal(f.bonusCreux, true)
    hasard = 0
    const gain = await tirer()
    assert.equal(gain.lotId, 'lot-creux')
    assert.equal(gain.type, 'lot')
    horloge = mardi(16, 59)
    hasard = 0.99
    const conso = await tirer()
    assert.equal(conso.lotId, 'lot-pts')
    assert.equal(conso.points, 20, 'montant effectif crédité : 10 × 2')
    assert.equal(conso.solde, soldeDepart + 20, 'crédité une fois, doublé')
    assert.equal(conso.pointsDoubles, true)
    const enBase = (await etat()).tirages.find((t) => t.id === conso.tirageId)!
    assert.equal(enBase.points, 20)
    assert.equal(enBase.pointsDoubles, true)
    // Fiche d'une carte (même vue publique) pendant le créneau.
    horloge = mardi(17)
    assert.equal((await fiche()).bonusCreux, undefined, '17:00 : fin exclue')
  })

  test('liste vide = plus aucun créneau : le lot creux ne sort plus', async () => {
    const r = await api('PATCH', `/commerces/${AH}`, { creneauxCreux: [] }, PIN)
    assert.equal(r.statut, 200)
    horloge = mardi(15)
    assert.deepEqual((await fiche()).lots.map((l) => l.id), ['lot-pts'])
    hasard = 0
    assert.equal((await tirer()).lotId, 'lot-pts')
  })
})

describe('D2 : Réglages, store et bundle initial', () => {
  test('Réglages → Roulette : case « Heures creuses seulement » par lot et éditeur de créneaux, validés avant l’envoi', () => {
    const r = lire('src/pages/Reglages.tsx')
    assert.match(r, /<CaseHeuresCreuses coche=\{!!lot\.heuresCreuses\} desactive=\{exclu\}/)
    assert.match(r, /<CreneauxCreux creneaux=\{creneaux\} erreur=\{erreurCreneaux\} onChange=\{\(v\) => maj\('creneauxCreux', v\)\} \/>/)
    assert.match(r, /&& !erreurCreneaux/)
    assert.match(r, /&& total > 0 && horsCreux/)
    const h = lire('src/components/HeuresCreuses.tsx')
    assert.match(h, /Heures creuses seulement/)
    assert.match(h, /type="time"/)
  })

  test('le store envoie creneauxCreux ; creneaux.ts reste hors du bundle initial (serveur + Réglages seulement)', () => {
    assert.match(lire('src/store.tsx'), /creneauxCreux: c\.creneauxCreux,/)
    for (const f of ['src/pages/Jouer.tsx', 'src/pages/CartePublique.tsx', 'src/pages/Caisse.tsx', 'src/App.tsx', 'src/store.tsx', 'src/lib/vuePublique.ts', 'src/lib/roulette.ts', 'src/lib/lots.ts']) {
      assert.doesNotMatch(lire(f), /lib\/creneaux/, f)
    }
  })
})

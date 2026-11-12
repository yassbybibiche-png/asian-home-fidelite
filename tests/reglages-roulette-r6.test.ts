// Roue v2 R6 — Réglages → Roulette complet : type de chaque lot (lot physique / points / perdu), montant des points,
// plafond par jour, règles du jeu (mode d'accès, limite de gains par mois) et aperçu de la roue avec un tirage de TEST
// fait dans le navigateur, jamais enregistré. Logique pure (src/lib/reglagesRoue.ts), garde-fous de source (le .tsx
// ne s'importe pas sous node --test), puis vrai serveur HTTP sur SQLite temporaire : les champs envoyés par Réglages
// sont acceptés et relus. Parcours navigateur complet : tests-e2e/reglages-roulette-r6.spec.ts.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { CHOIX_TYPE_LOT, lotPourEnvoi, problemeLot, texteTirageDeTest, tirageDeTest } from '../src/lib/reglagesRoue.ts'
import { secteurs, tirerLot } from '../src/lib/roulette.ts'
import { normaliserLots } from '../src/lib/lots.ts'
import type { Commerce, Lot, Tirage } from '../src/types.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')
const sansCommentaires = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const LOTS: Lot[] = [
  { id: 'lot-nems', type: 'lot', libelle: 'Nems offerts', probabilite: 20, plafondJour: 3 },
  { id: 'lot-the', type: 'lot', libelle: 'Thé glacé', probabilite: 0 },
  { id: 'lot-pts', type: 'points', points: 10, libelle: '10 points offerts', probabilite: 30 },
  { id: 'lot-perdu', type: 'perdant', libelle: 'Perdu', probabilite: 50 },
]

describe('R6 : validation front des lots (mêmes bornes que le serveur)', () => {
  test('sélecteur de type : Lot physique / Points / Perdu, dans cet ordre, les 3 types du serveur', () => {
    assert.deepEqual(CHOIX_TYPE_LOT.map((c) => c.valeur), ['lot', 'points', 'perdant'])
    assert.deepEqual(CHOIX_TYPE_LOT.map((c) => c.libelle), ['Lot physique', 'Points', 'Perdu'])
  })

  test('type « points » sans montant (ou montant hors bornes) → refus front ; avec un montant entier de 1 à 10 000 → accepté', () => {
    assert.match(problemeLot({ type: 'points' }) ?? '', /indiquez le nombre de points offerts/)
    for (const points of [0, -3, 1.5, 10_001, Number.NaN]) assert.ok(problemeLot({ type: 'points', points }), `points ${points}`)
    for (const points of [1, 10, 10_000]) assert.equal(problemeLot({ type: 'points', points }), null, `points ${points}`)
    assert.equal(problemeLot({ type: 'lot' }), null, 'un lot physique n’a pas de montant de points')
    assert.equal(problemeLot({ type: 'perdant' }), null)
  })

  test('plafond par jour : vide = illimité, entier de 0 à 10 000 ; jamais bloquant hors lot physique (pas envoyé)', () => {
    assert.equal(problemeLot({ type: 'lot', plafondJour: undefined }), null)
    for (const plafondJour of [0, 1, 10_000]) assert.equal(problemeLot({ type: 'lot', plafondJour }), null)
    for (const plafondJour of [-1, 2.5, 10_001, Number.NaN]) assert.match(problemeLot({ type: 'lot', plafondJour }) ?? '', /plafond par jour/)
    assert.equal(problemeLot({ type: 'perdant', plafondJour: Number.NaN }), null)
    assert.equal(problemeLot({ type: 'points', points: 5, plafondJour: -1 }), null)
  })

  test('lot envoyé : points seulement pour « points », plafond seulement pour un lot physique > 0 (vide / 0 = illimité)', () => {
    assert.deepEqual(lotPourEnvoi({ id: 'a', type: 'lot', libelle: 'A', probabilite: 10, plafondJour: 3, points: 9 }), { id: 'a', type: 'lot', libelle: 'A', probabilite: 10, plafondJour: 3 })
    assert.deepEqual(lotPourEnvoi({ id: 'a', type: 'lot', libelle: 'A', probabilite: 10, plafondJour: 0 }), { id: 'a', type: 'lot', libelle: 'A', probabilite: 10 })
    assert.deepEqual(lotPourEnvoi({ id: 'b', type: 'points', libelle: 'B', probabilite: 10, points: 15, plafondJour: 4 }), { id: 'b', type: 'points', libelle: 'B', probabilite: 10, points: 15 })
    assert.deepEqual(lotPourEnvoi({ id: 'c', type: 'perdant', libelle: 'C', probabilite: 10, points: 15, plafondJour: 4, coutCentimes: 0 }), { id: 'c', type: 'perdant', libelle: 'C', probabilite: 10, coutCentimes: 0 })
  })
})

describe('R6 : tirage de test de l’aperçu (navigateur, rien d’enregistré)', () => {
  test('même tirage pondéré que `tirerLot` sur les lots jouables, secteur gagnant = celui du lot (par id)', () => {
    const jouables = normaliserLots(LOTS).filter((l) => l.probabilite > 0)
    for (const alea of [0, 0.1, 0.19, 0.2, 0.49, 0.5, 0.75, 0.999]) {
      const t = tirageDeTest(LOTS, alea)!
      assert.equal(t.lot.id, jouables[tirerLot(jouables, alea)].id, `alea ${alea}`)
      assert.equal(t.secteur.lot.id, t.lot.id)
      assert.deepEqual(t.secteur, secteurs(normaliserLots(LOTS)).find((s) => s.lot.id === t.lot.id))
    }
    assert.equal(tirageDeTest(LOTS, 0.1)!.lot.id, 'lot-nems')
    assert.equal(tirageDeTest(LOTS, 0.3)!.lot.id, 'lot-pts')
    assert.equal(tirageDeTest(LOTS, 0.9)!.lot.id, 'lot-perdu')
  })

  test('un lot à 0 % ne sort jamais ; pas de plafond ni de limite client dans le test ; aucun lot jouable → null', () => {
    const vus = new Set<string>()
    for (let i = 0; i < 1000; i++) vus.add(tirageDeTest(LOTS, i / 1000)!.lot.id)
    assert.deepEqual([...vus].sort(), ['lot-nems', 'lot-perdu', 'lot-pts'])
    assert.equal(tirageDeTest([{ libelle: 'A', probabilite: 0 }, { libelle: '  ', probabilite: 50 }]), null)
    assert.equal(tirageDeTest([]), null)
  })

  test('fréquences proches des probabilités configurées (prorata si le total ≠ 100 %)', () => {
    const lots: Lot[] = [{ libelle: 'A', type: 'lot', probabilite: 1 }, { libelle: 'B', type: 'perdant', probabilite: 3 }]
    let a = 0
    for (let i = 0; i < 4000; i++) if (tirageDeTest(lots, (i + 0.5) / 4000)!.lot.libelle === 'A') a++
    assert.equal(a, 1000)
  })

  test('texte du résultat selon le type : gagné / consolation (montant) / perdu', () => {
    assert.match(texteTirageDeTest({ libelle: 'Nems offerts', type: 'lot' }), /^Gagné : « Nems offerts »/)
    assert.equal(texteTirageDeTest({ libelle: '+10', type: 'points', points: 10 }), 'Consolation : « +10 » (10 points crédités sur sa carte).')
    assert.equal(texteTirageDeTest({ libelle: '+1', type: 'points', points: 1 }), 'Consolation : « +1 » (1 point crédité sur sa carte).')
    assert.match(texteTirageDeTest({ libelle: 'Perdu', type: 'perdant' }), /^Perdu : « Perdu »/)
  })
})

describe('R6 : sources (Réglages, aperçu, store)', () => {
  const reglages = lire('src/pages/Reglages.tsx')
  const apercu = lire('src/components/ApercuRoue.tsx')
  const store = lire('src/store.tsx')

  test('l’aperçu ne crée aucun tirage : ni store, ni API, ni réseau — tirage par `tirageDeTest` (donc `tirerLot`)', () => {
    const code = sansCommentaires(apercu)
    for (const interdit of [/useStore|useAction|useDonneesCommerce/, /\bapi\b|jeuApi|depotApi|\/data\//, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket/, /enregistrerTirage|lancerTirage|tirages/i, /localStorage|indexedDB/]) {
      assert.doesNotMatch(code, interdit, String(interdit))
    }
    assert.match(code, /const t = tirageDeTest\(lots\)/)
    assert.match(code, /rotationCible\(r, t\.secteur, Math\.random\(\), toursRotation\(reduit\)\)/)
    assert.match(code, /Tirage de test — rien n’est enregistré/)
    assert.match(code, /<Roue lots=\{lots\} rotation=\{rotation\} \/>/)
    // Réglages lui passe le brouillon des lots (secteurs proportionnels : les probabilités sont transmises).
    assert.match(reglages, /<ApercuRoue lots=\{lots\}/)
  })

  test('Réglages : type, points, plafond par lot ; compteur X/12 conservé ; lot envoyé via `lotPourEnvoi`', () => {
    assert.match(reglages, /CHOIX_TYPE_LOT\.map/)
    assert.match(reglages, /htmlFor=\{`type-\$\{i\}`\}/)
    assert.match(reglages, /htmlFor=\{`points-\$\{i\}`\}/)
    assert.match(reglages, /htmlFor=\{`plafond-\$\{i\}`\}/)
    assert.match(reglages, /plafondJour: e\.target\.value === '' \? undefined : e\.target\.valueAsNumber/)
    assert.match(reglages, /<CompteurLibelle id=\{`lot-\$\{i\}-compteur`\} libelle=\{lot\.libelle\} \/>/)
    assert.match(reglages, /lots: lots\.map\(lotPourEnvoi\)/)
    // Validation : un lot en erreur (points sans montant, plafond invalide) désactive « Enregistrer ».
    assert.match(reglages, /const champsTypeValides = lots\.every\(\(l\) => !problemeLot\(l\)\)/)
    assert.match(reglages, /const lotsValides = lots\.length >= 2 && probasValides && coutsValides && champsTypeValides && !doublons\.length && total > 0/)
    assert.match(reglages, /disabled=\{!valide \|\| enCours\}/)
    // L'erreur du serveur reste affichée (libellé en double envoyé malgré tout, etc.).
    assert.match(reglages, /Réglages non enregistrés : \$\{erreur\}/)
  })

  test('revue Codex : une ligne exclue de l’envoi (libellé vide) a ses champs à validation native désactivés', () => {
    // Même critère d'exclusion que l'envoi (`lots` filtre les libellés vides après trim).
    assert.match(reglages, /const lots = lotsEdites\.map\(\(l\) => \(\{ \.\.\.l, libelle: l\.libelle\.trim\(\) \}\)\)\.filter\(\(l\) => l\.libelle\)/)
    assert.match(reglages, /const exclu = !lot\.libelle\.trim\(\)\n/)
    const ligne = reglages.slice(reglages.indexOf('{lotsEdites.map((lot, i) => {'), reglages.indexOf('+ Ajouter un lot'))
    const champs = ligne.match(/<input\b[\s\S]*?\/>/g) ?? []
    const avecContrainte = champs.filter((c) => /\b(min|max|step|required|pattern|minLength|maxLength)=/.test(c))
    // D1 (brief « instants gagnants ») : + le nombre d'instants gagnants par jour, même règle `disabled={exclu}`.
    assert.deepEqual(avecContrainte.map((c) => /id=\{`(\w+)-/.exec(c)?.[1]), ['proba', 'cout', 'points', 'plafond', 'instants'])
    for (const c of avecContrainte) assert.match(c, /\n\s+disabled=\{exclu\}\n/, c)
    // Le libellé reste toujours saisissable (sinon la ligne ne pourrait plus être réactivée).
    assert.doesNotMatch(champs.find((c) => c.includes('id={`lot-${i}`}')) ?? '', /disabled/)
    // Une ligne gardée à l'envoi reste soumise à la validation de l'application : plafond -1 → « Enregistrer » désactivé.
    assert.match(problemeLot({ type: 'lot', plafondJour: -1 }) ?? '', /plafond par jour/)
    assert.match(reglages, /const champsTypeValides = lots\.every\(\(l\) => !problemeLot\(l\)\)/)
  })

  test('Règles du jeu : mode d’accès (libre / visite) et limite de gains par mois (0 = illimité, défaut 4)', () => {
    assert.match(reglages, /name="modeAccesRoue"/)
    assert.match(reglages, /checked=\{modeAccesRoue\(brouillon\) === m\.valeur\}/)
    assert.match(reglages, /maj\('modeAccesRoue', m\.valeur\)/)
    assert.match(reglages, /valeur=\{brouillon\.limiteGainsMois\}\s+defaut=\{LIMITE_GAINS_MOIS_DEFAUT\}/)
    assert.match(reglages, /max=\{LIMITE_GAINS_MOIS_MAX\}/)
    assert.match(reglages, /limiteValide/)
  })

  test('store : le PATCH des réglages envoie le mode d’accès et la limite de gains', () => {
    const bloc = store.slice(store.indexOf('majCommerce: (c: Commerce) =>'), store.indexOf('creerCommerce: (n: NouveauCommerce) =>\n        avecPin'))
    assert.match(bloc, /\n\s+modeAccesRoue: c\.modeAccesRoue,\n/)
    assert.match(bloc, /\n\s+limiteGainsMois: c\.limiteGainsMois,\n/)
    assert.match(bloc, /lots: c\.lots,/)
    // Une valeur absente (`undefined`) n'est pas envoyée : le corps passe par JSON.stringify, qui omet ces clés.
    assert.match(lire('src/data/api.ts'), /options\.corps === undefined \? undefined : JSON\.stringify\(options\.corps\)/)
    assert.equal(JSON.stringify({ modeAccesRoue: undefined, limiteGainsMois: undefined, eurosParPoint: undefined }), '{}')
  })
})

describe('R6 : serveur (SQLite) — champs de Réglages envoyés puis relus', () => {
  const AH = 'c-asian-home-paris'
  const PIN = { 'X-Commerce-PIN': '1234' }
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-r6-'))
  let app: Awaited<ReturnType<typeof creerServeur>>
  let base = ''

  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, { method: methode, headers: { 'Content-Type': 'application/json', ...entetes }, body: corps === undefined ? undefined : JSON.stringify(corps) })
    return { statut: r.status, contenu: await r.json() }
  }
  const etat = async () => (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu as { commerce: Commerce; tirages: Tirage[] }

  before(async () => {
    app = await creerServeur({ fichierDb: join(dossier, 'r6.db'), adminPin: '98765432', pinInitial: '1234', version: 'test' })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('type, points, plafond, mode d’accès et limite : enregistrés tels qu’envoyés par Réglages, puis relus', async () => {
    const avant = (await etat()).commerce
    const brouillon: Lot[] = [
      { id: 'lot-nems', type: 'lot', libelle: 'Nems offerts', probabilite: 40, plafondJour: 3, points: 7 },
      { id: 'lot-pts', type: 'points', libelle: '15 points offerts', probabilite: 30, points: 15, plafondJour: 2 },
      { id: 'lot-perdu', type: 'perdant', libelle: 'Pas de chance', probabilite: 30, plafondJour: 0 },
    ]
    const r = await api('PATCH', `/commerces/${AH}`, { lots: brouillon.map(lotPourEnvoi), modeAccesRoue: 'visite', limiteGainsMois: 2 }, PIN)
    assert.equal(r.statut, 200, JSON.stringify(r.contenu))
    const relu = (await etat()).commerce
    assert.deepEqual(relu.lots, [
      { id: 'lot-nems', type: 'lot', libelle: 'Nems offerts', probabilite: 40, plafondJour: 3 },
      { id: 'lot-pts', type: 'points', libelle: '15 points offerts', probabilite: 30, points: 15 },
      { id: 'lot-perdu', type: 'perdant', libelle: 'Pas de chance', probabilite: 30 },
    ])
    assert.equal(relu.modeAccesRoue, 'visite')
    assert.equal(relu.limiteGainsMois, 2)
    // Rien d'autre n'a bougé (PIN, autres réglages).
    assert.equal(relu.nom, avant.nom)
    assert.equal(relu.seuilTampons, avant.seuilTampons)

    assert.equal((await api('PATCH', `/commerces/${AH}`, { modeAccesRoue: 'libre', limiteGainsMois: 0 }, PIN)).statut, 200)
    const relu2 = (await etat()).commerce
    assert.equal(relu2.modeAccesRoue, 'libre')
    assert.equal(relu2.limiteGainsMois, 0, '0 = illimité, conservé tel quel')
    assert.equal((await api('PATCH', `/commerces/${AH}`, { lots: relu2.lots.map((l) => lotPourEnvoi({ ...l, plafondJour: undefined })) }, PIN)).statut, 200)
    assert.equal((await etat()).commerce.lots[0].plafondJour, undefined, 'plafond vidé = illimité')
  })

  test('mêmes refus côté serveur que côté front : points sans montant, libellé en double (message affichable)', async () => {
    const points = await api('PATCH', `/commerces/${AH}`, { lots: [{ type: 'points', libelle: 'Bonus', probabilite: 50 }, { type: 'perdant', libelle: 'Perdu', probabilite: 50 }] }, PIN)
    assert.equal(points.statut, 400)
    assert.match(points.contenu.erreur, /un lot « points » doit indiquer un nombre entier de points/)
    assert.ok(problemeLot({ type: 'points' }), 'le front refuse avant l’envoi')
    const double = await api('PATCH', `/commerces/${AH}`, { lots: [{ type: 'lot', libelle: 'Nems', probabilite: 50 }, { type: 'lot', libelle: ' nems ', probabilite: 50 }] }, PIN)
    assert.equal(double.statut, 400)
    assert.match(double.contenu.erreur, /Libellé de lot en double : « nems »/)
  })

  test('espion réseau : 200 tirages de test n’envoient aucune requête et ne créent aucun tirage côté serveur', async () => {
    const avant = (await etat()).tirages.length
    const { lots } = (await etat()).commerce
    const fetchReel = globalThis.fetch
    let appels = 0
    globalThis.fetch = ((...a: Parameters<typeof fetch>) => (appels++, fetchReel(...a))) as typeof fetch
    try {
      for (let i = 0; i < 200; i++) assert.ok(tirageDeTest(lots))
    } finally {
      globalThis.fetch = fetchReel
    }
    assert.equal(appels, 0)
    assert.equal((await etat()).tirages.length, avant)
  })
})

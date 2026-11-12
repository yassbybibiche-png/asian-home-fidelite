// Roue v2 D3 — Simulateur de coût (Réglages → Roulette) et KPI « Gains de la roue » (tableau de bord). Logique pure
// (src/lib/coutRoue.ts, src/lib/gainsRoue.ts), puis branchement dans les deux pages différées (lecture du source).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { coutParTirage, formaterParJour, pireCasJour, simulerCout, tiragesParJour } from '../src/lib/coutRoue.ts'
import { coutDuTirage, etapeGain, kpiGains } from '../src/lib/gainsRoue.ts'
import { cycleGain, instantParis } from '../src/lib/roulette.ts'
import type { Lot, Tirage } from '../src/types.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')
/** Le 12/11/2026 à 15 h, Paris. */
const MAINTENANT = instantParis(2026, 11, 12, 15)
/** Midi à Paris, `n` jours avant le 12/11/2026. */
const ilYa = (n: number) => new Date(instantParis(2026, 11, 12, 12).getTime() - n * 24 * 3600 * 1000).toISOString()

describe('D3 : coût attendu par tirage', () => {
  // Total 200 % → chances normalisées : 0,25 / 0,15 / 0,10 / 0,50.
  const lots: Lot[] = [
    { id: 'nems', type: 'lot', libelle: 'Nems offerts', probabilite: 50, coutCentimes: 120 },
    { id: 'the', type: 'lot', libelle: 'Thé glacé', probabilite: 30, coutCentimes: 200 },
    { id: 'pts', type: 'points', libelle: '+10 points', probabilite: 20, points: 10, coutCentimes: 999 },
    { id: 'perdu', type: 'perdant', libelle: 'Perdu', probabilite: 100 },
  ]

  test('Σ (chance normalisée × coût) des lots physiques ; points et perdu valent 0', () => {
    const c = coutParTirage(lots)
    assert.ok(Math.abs(c.centimes - (0.25 * 120 + 0.15 * 200)) < 1e-9, String(c.centimes))
    assert.equal(c.partiel, false)
    assert.deepEqual(c.lotsSansCout, [])
  })

  test('lot à 0 %, sans libellé ou à chance invalide : ni tiré, ni compté, ni signalé sans coût', () => {
    const c = coutParTirage([...lots, { libelle: 'Rien', type: 'lot', probabilite: 0 }, { libelle: '  ', type: 'lot', probabilite: 40 }, { libelle: 'NaN', type: 'lot', probabilite: NaN }])
    assert.ok(Math.abs(c.centimes - 60) < 1e-9)
    assert.equal(c.partiel, false)
  })

  test('lot physique sans coût → coût partiel (un minimum) + liste des lots concernés, rien d’inventé', () => {
    const c = coutParTirage([{ ...lots[0], coutCentimes: undefined }, lots[1], { id: 'mochi', type: 'lot', libelle: ' Mochi ', probabilite: 50 }, lots[3]])
    assert.equal(c.partiel, true)
    assert.deepEqual(c.lotsSansCout, ['Nems offerts', 'Mochi'])
    // Seul le thé (30 / 230) est compté.
    assert.ok(Math.abs(c.centimes - (30 / 230) * 200) < 1e-9)
  })

  test('aucun lot jouable : 0 propre, jamais NaN', () => {
    assert.deepEqual(coutParTirage([]), { centimes: 0, partiel: false, lotsSansCout: [] })
    assert.equal(coutParTirage([{ libelle: 'A', type: 'lot', probabilite: 0, coutCentimes: 100 }]).centimes, 0)
  })
})

describe('D3 : tirages par jour, projection, pire cas des plafonds', () => {
  test('moyenne sur les 14 jours complets avant aujourd’hui (J-14 à J-1, Paris)', () => {
    const tirages = [
      ...Array.from({ length: 21 }, (_, i) => ({ date: ilYa(1 + (i % 14)) })), // 21 tirages dans la fenêtre
      { date: ilYa(0) }, // aujourd'hui : exclu (jour entamé)
      { date: ilYa(15) }, // trop ancien
    ]
    assert.equal(tiragesParJour(tirages, MAINTENANT), 21 / 14)
    assert.equal(formaterParJour(21 / 14), '1,5')
    assert.equal(formaterParJour(6.28), '6,3')
  })

  test('projection = coût/tirage × tirages/jour × 30 ; 0 tirage → 0 propre (pas de NaN)', () => {
    const lots: Lot[] = [
      { type: 'lot', libelle: 'A', probabilite: 50, coutCentimes: 100 },
      { type: 'perdant', libelle: 'B', probabilite: 50 },
    ]
    const vide = simulerCout(lots, [], MAINTENANT)
    assert.equal(vide.tiragesParJour, 0)
    assert.equal(vide.projectionMois, 0)
    assert.equal(vide.centimes, 50)
    const s = simulerCout(lots, Array.from({ length: 28 }, (_, i) => ({ date: ilYa(1 + (i % 14)) })), MAINTENANT)
    assert.equal(s.tiragesParJour, 2)
    assert.equal(s.projectionMois, 50 * 2 * 30)
    const rien = simulerCout([], [], MAINTENANT)
    assert.ok([rien.centimes, rien.tiragesParJour, rien.projectionMois].every((n) => n === 0))
  })

  test('pire cas journalier = Σ plafond × coût ; borne la projection quand elle la dépasse', () => {
    const lots: Lot[] = [
      { type: 'lot', libelle: 'A', probabilite: 50, coutCentimes: 300, plafondJour: 2 },
      { type: 'lot', libelle: 'B', probabilite: 10, coutCentimes: 100, plafondJour: 5 },
      { type: 'points', libelle: 'C', probabilite: 40, points: 5 },
    ]
    assert.deepEqual(pireCasJour(lots), { centimes: 2 * 300 + 5 * 100, sansPlafond: [] })
    const beaucoup = Array.from({ length: 14 * 20 }, (_, i) => ({ date: ilYa(1 + (i % 14)) }))
    const s = simulerCout(lots, beaucoup, MAINTENANT)
    // 20 tirages/jour × (0,5 × 300 + 0,1 × 100) = 3 200 c/jour > 1 100 c/jour permis par les plafonds.
    assert.equal(s.pireCasJour, 1100)
    assert.equal(s.bornePlafonds, true)
    assert.equal(simulerCout(lots, [], MAINTENANT).bornePlafonds, false)
  })

  test('pas de pire cas si un lot physique est illimité (listé) ou sans coût', () => {
    const illimite = pireCasJour([
      { type: 'lot', libelle: 'A', probabilite: 50, coutCentimes: 300, plafondJour: 2 },
      { type: 'lot', libelle: 'B', probabilite: 50, coutCentimes: 100 },
      { type: 'lot', libelle: 'Zéro', probabilite: 0, coutCentimes: 100 },
    ])
    assert.deepEqual(illimite, { centimes: null, sansPlafond: ['B'] })
    assert.deepEqual(pireCasJour([{ type: 'lot', libelle: 'A', probabilite: 50, plafondJour: 2 }]), { centimes: null, sansPlafond: [] })
  })
})

describe('D3 : KPI « Gains de la roue » sur tirages aux statuts v2 (R3)', () => {
  const lots: Lot[] = [
    { id: 'nems', type: 'lot', libelle: 'Nems offerts', probabilite: 50, coutCentimes: 150 },
    { id: 'the', type: 'lot', libelle: 'Thé glacé', probabilite: 30 },
  ]
  let n = 0
  const tirage = (jours: number, p: Partial<Tirage> = {}): Tirage => ({
    id: `t${++n}`,
    commerceId: 'c',
    clientId: `cl${n}`,
    lot: 'Nems offerts',
    lotId: 'nems',
    typeLot: 'lot',
    date: ilYa(jours),
    ...p,
  })
  const tirages: Tirage[] = [
    tirage(0), // en attente (jour J)
    tirage(3), // utilisable
    tirage(3, { activeLe: MAINTENANT.toISOString() }), // utilisable, code activé
    tirage(5, { remis: { le: ilYa(2), par: 'Gérant' } }), // remis dans la fenêtre
    tirage(40, { remis: { le: ilYa(35), par: 'Gérant' } }), // remis hors fenêtre : ignoré
    tirage(32), // expiré (fin de J+30 il y a 1 jour) : 1,50 €
    tirage(45, { lot: 'Thé glacé', lotId: 'the' }), // expiré il y a 14 jours, coût non renseigné
    tirage(70), // expiré il y a 39 jours : hors fenêtre
    tirage(2, { lot: '+10 points', lotId: 'pts', typeLot: 'points', points: 10 }), // consolation : ignorée
    tirage(2, { lot: 'Perdu', lotId: 'perdu', typeLot: 'perdant' }), // perdant : ignoré
    tirage(10, { typeLot: undefined, lotId: undefined }), // hérité (ancienne règle : J seulement) : expiré il y a 9 jours
  ]

  test('gagnés, remis, expirés, en attente, taux = remis ÷ (remis + expirés), valeur des expirés', () => {
    const k = kpiGains(tirages, lots, MAINTENANT)
    assert.equal(k.gagnes, 5) // J, J-3 ×2, J-5, J-10 (hérité) ; J-32 et plus : hors des 30 jours
    assert.equal(k.remis, 1)
    assert.equal(k.expires, 3) // J-32, J-45 (thé), J-10 hérité
    assert.equal(k.tauxUtilisation, 25) // 1 ÷ (1 + 3)
    assert.equal(k.enAttente, 3) // J, J-3, J-3 activé
    assert.equal(k.valeurExpires, 300) // 2 Nems à 1,50 €
    assert.equal(k.expiresSansCout, 1)
  })

  test('aucun gain échu : taux null (affiché « — »), jamais NaN ; aucun tirage : tout à 0', () => {
    const k = kpiGains([tirage(0), tirage(3)], lots, MAINTENANT)
    assert.equal(k.tauxUtilisation, null)
    assert.equal(k.enAttente, 2)
    assert.deepEqual(kpiGains([], lots, MAINTENANT), { gagnes: 0, remis: 0, expires: 0, tauxUtilisation: null, enAttente: 0, valeurExpires: 0, expiresSansCout: 0 })
  })

  test('etapeGain (bornes du bundle initial) = cycleGain (R3), heure par heure, changements d’heure et tirages hérités compris', () => {
    const attendu = { enAttente: 'enCours', utilisable: 'enCours', expire: 'expire' } as Record<string, string>
    const dates = [
      instantParis(2026, 2, 27, 23, 30), // fin J+30 = nuit du passage à l'heure d'été (29/03)
      instantParis(2026, 9, 24, 0, 10), // fin J+30 = nuit du passage à l'heure d'hiver (25/10)
      instantParis(2026, 10, 25, 1, 30),
      instantParis(2026, 11, 1, 12),
    ]
    let comparaisons = 0
    for (const d of dates) {
      for (const herite of [false, true]) {
        const t: Tirage = { id: 'x', commerceId: 'c', clientId: 'k', lot: 'Nems', date: d.toISOString(), ...(herite ? {} : { typeLot: 'lot' as const }) }
        for (let h = -2; h <= 33 * 24; h++) {
          const m = new Date(d.getTime() + h * 3600 * 1000 + 17 * 60 * 1000)
          assert.equal(etapeGain(t, m), attendu[cycleGain(t, m)], `${d.toISOString()} hérité=${herite} +${h} h`)
          comparaisons++
        }
      }
    }
    assert.ok(comparaisons > 6000)
  })

  test('coût d’un tirage : par id d’abord (lot renommé), puis par libellé (tirage d’avant R1), sinon null', () => {
    assert.equal(coutDuTirage(lots, { lot: 'Ancien nom', lotId: 'nems' }), 150)
    assert.equal(coutDuTirage(lots, { lot: 'Nems offerts' }), 150)
    assert.equal(coutDuTirage(lots, { lot: 'Thé glacé', lotId: 'the' }), null)
    assert.equal(coutDuTirage(lots, { lot: 'Supprimé', lotId: 'x' }), null)
  })
})

describe('D3 : branchement dans les pages commerçant (différées)', () => {
  test('Réglages → Roulette : simulateur sous les lots, calculé sur le brouillon (pas sur le commerce enregistré)', () => {
    const r = lire('src/pages/Reglages.tsx')
    assert.match(r, /<SimulateurCout simulation=\{simulerCout\(lots, /)
    const lotsFin = r.indexOf('</fieldset>', r.indexOf('Lots de la roulette'))
    const simu = r.indexOf('<SimulateurCout')
    assert.ok(lotsFin > 0 && simu > lotsFin && simu < r.indexOf('id="regles-jeu-titre"'), 'bloc juste sous les lots')
    assert.match(r, /coût partiel/)
    assert.match(r, /Coût non renseigné pour : \{s\.lotsSansCout\.join/)
  })

  test('Tableau de bord : carte « Gains de la roue » ; les modules D3 ne sont importés que par leur page', () => {
    const t = lire('src/pages/TableauDeBord.tsx')
    assert.match(t, /<GainsRoue kpi=\{kpiGains\(tirages, commerce\.lots\)\} \/>/)
    assert.match(t, /Gains de la roue/)
    assert.match(t, /non renseigné/)
    // Bundle initial au plafond : `cycleGain` / `finGain` (serveur seulement) ne doivent pas y entrer par ce module.
    assert.doesNotMatch(lire('src/lib/gainsRoue.ts'), /import \{[^}]*\b(cycleGain|finGain)\b/)
    for (const [module, page] of [['coutRoue', 'Reglages'], ['gainsRoue', 'TableauDeBord']]) {
      for (const f of ['src/pages/Jouer.tsx', 'src/pages/CartePublique.tsx', 'src/pages/Caisse.tsx', 'src/App.tsx', 'src/store.tsx', 'src/pages/Reglages.tsx', 'src/pages/TableauDeBord.tsx']) {
        if (f.includes(page)) assert.match(lire(f), new RegExp(`lib/${module}'`))
        else assert.doesNotMatch(lire(f), new RegExp(`lib/${module}`), `${module} importé par ${f}`)
      }
    }
  })
})

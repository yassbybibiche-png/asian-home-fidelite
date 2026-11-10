// P2-Q3 — Dashboard & mesure : coût des lots, séries jour / semaine / mois, comparaison au mois précédent, export CSV,
// entonnoir ANONYME (compteurs sans identité), retour après gain, test A/B « accroche » (variante par jour).
// Logique pure (`src/lib/mesure.ts`) + vrai serveur HTTP sur SQLite temporaire + sources du front (.tsx non chargeables).
// Supabase (faux PostgREST) : tests/supabase.test.ts ; migration 0008 sur Postgres : tests/migration-pglite.test.ts.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AddressInfo } from 'node:net'

import { creerServeur, type OptionsServeur } from '../server/app.ts'
import { commercePublic } from '../src/lib/vuePublique.ts'
import { signalerScan } from '../src/data/jeuApi.ts'
import { nouveauCommerce } from '../src/data/defaults.ts'
import {
  ACCROCHE_GENERIQUE,
  ACCROCHE_LOT,
  accrocheJeu,
  basculerAccroche,
  comparaisonMoisPrecedent,
  coutLotValide,
  coutsParLot,
  debutPeriode,
  entonnoir,
  finPeriode,
  jourParis,
  libellePeriode,
  periodes,
  resultatsAccroche,
  retourApresGain,
  serie,
  serieEnCsv,
  tauxParticipation,
  texteVariation,
  totaux,
  varianteDuJour,
  variation,
  type DonneesMesure,
} from '../src/lib/mesure.ts'
import { TRADUCTIONS_EN, traduire } from '../src/lib/langue.ts'
import type { Client, CompteurEvenement, Lot, Tirage } from '../src/types.ts'

const RACINE = join(import.meta.dirname, '..')
const source = (f: string) => readFileSync(join(RACINE, f), 'utf8')

const LOTS: Lot[] = [
  { libelle: 'Nems offerts', probabilite: 20, coutCentimes: 150 },
  { libelle: 'Thé glacé', probabilite: 30, coutCentimes: 80 },
  { libelle: 'Mochi offert', probabilite: 10 }, // coût non renseigné
  { libelle: 'Dommage !', probabilite: 40 },
]

let n = 0
const tirage = (date: string, lot: string, opts: { remis?: boolean; clientId?: string } = {}): Tirage => ({
  id: `t${++n}`,
  commerceId: 'c',
  clientId: opts.clientId ?? `k${n}`,
  lot,
  date,
  ...(opts.remis ? { remis: { le: date, par: { type: 'membre', nom: 'Lin' } } } : {}),
})

const vide = (p: Partial<DonneesMesure> = {}): DonneesMesure => ({ clients: [], tirages: [], lots: LOTS, compteurs: [], ...p })

// ---------- Coût des lots ----------

describe('Coût des lots : coût unitaire × gagnés / distribués', () => {
  const tirages = [
    tirage('2026-11-10T11:00:00Z', 'Nems offerts', { remis: true }),
    tirage('2026-11-10T12:00:00Z', 'Nems offerts'), // gagné, pas retiré
    tirage('2026-11-10T12:30:00Z', 'Thé glacé', { remis: true }),
    tirage('2026-11-10T13:00:00Z', 'Mochi offert', { remis: true }), // sans coût
    tirage('2026-11-10T13:30:00Z', 'Dommage !'), // perdant : jamais compté
    tirage('2026-11-09T12:00:00Z', 'Nems offerts', { remis: true }), // autre jour
  ]

  test('par lot sur la période : gagnés, distribués (= remis au comptoir), coûts en centimes', () => {
    const lignes = coutsParLot(tirages, LOTS, '2026-11-10', '2026-11-10')
    assert.deepEqual(lignes, [
      { lot: 'Nems offerts', coutUnitaire: 150, gagnes: 2, distribues: 1, coutGagnes: 300, coutDistribues: 150 },
      { lot: 'Thé glacé', coutUnitaire: 80, gagnes: 1, distribues: 1, coutGagnes: 80, coutDistribues: 80 },
      { lot: 'Mochi offert', coutUnitaire: null, gagnes: 1, distribues: 1, coutGagnes: 0, coutDistribues: 0 },
    ])
    assert.ok(!lignes.some((l) => l.lot === 'Dommage !'), 'un tirage perdant ne coûte rien')
  })

  test('totaux : gains sans coût signalés (le total est un minimum), tirages perdants comptés comme tirages', () => {
    const t = totaux(vide({ tirages }), '2026-11-10', '2026-11-10')
    assert.equal(t.tirages, 5)
    assert.equal(t.gains, 4)
    assert.equal(t.distribues, 3)
    assert.equal(t.coutGagnes, 380)
    assert.equal(t.coutDistribues, 230)
    assert.equal(t.gainsSansCout, 1)
    assert.equal(totaux(vide({ tirages }), '2026-11-09', '2026-11-10').coutDistribues, 380)
  })

  test('jour à Paris : un tirage à 23 h 30 UTC compte pour le lendemain (comme l’index unique des tirages)', () => {
    const t = tirage('2026-11-10T23:30:00Z', 'Nems offerts', { remis: true })
    assert.equal(jourParis(t.date), '2026-11-11')
    assert.equal(totaux(vide({ tirages: [t] }), '2026-11-10', '2026-11-10').gains, 0)
    assert.equal(totaux(vide({ tirages: [t] }), '2026-11-11', '2026-11-11').coutDistribues, 150)
  })

  test('lot renommé ou supprimé depuis le tirage : coût inconnu (null), jamais inventé', () => {
    const [l] = coutsParLot([tirage('2026-11-10T12:00:00Z', 'Ancien lot')], LOTS, '2026-11-10', '2026-11-10')
    assert.equal(l.coutUnitaire, null)
  })

  test('saisie valide : absent, ou entier de 0 à 100 000 centimes', () => {
    for (const ok of [undefined, 0, 150, 100_000]) assert.equal(coutLotValide(ok), true, String(ok))
    for (const ko of [-1, 1.5, 100_001, Number.NaN, '150', null]) assert.equal(coutLotValide(ko), false, String(ko))
  })
})

// ---------- Périodes, séries ----------

describe('Périodes jour / semaine / mois et séries', () => {
  test('débuts et fins de période (semaine du lundi au dimanche, mois civil, février bissextile)', () => {
    assert.equal(debutPeriode('2026-11-10', 'jour'), '2026-11-10')
    assert.equal(debutPeriode('2026-11-10', 'semaine'), '2026-11-09') // mardi → lundi
    assert.equal(debutPeriode('2026-11-15', 'semaine'), '2026-11-09') // dimanche → lundi précédent
    assert.equal(debutPeriode('2026-11-10', 'mois'), '2026-11-01')
    assert.equal(finPeriode('2026-11-09', 'semaine'), '2026-11-15')
    assert.equal(finPeriode('2028-02-01', 'mois'), '2028-02-29')
    assert.equal(finPeriode('2026-12-01', 'mois'), '2026-12-31')
  })

  test('n dernières périodes, la plus ancienne d’abord, la période en cours en dernier', () => {
    assert.deepEqual(periodes('mois', '2026-01-15', 3), ['2025-11-01', '2025-12-01', '2026-01-01'])
    assert.deepEqual(periodes('semaine', '2026-11-10', 2), ['2026-11-02', '2026-11-09'])
    assert.equal(periodes('jour', '2026-11-10').length, 30)
    assert.equal(libellePeriode('2026-11-09', 'jour'), 'lun. 9 nov.')
    assert.equal(libellePeriode('2026-11-09', 'semaine'), 'sem. du 9 nov.')
    assert.equal(libellePeriode('2026-11-01', 'mois'), 'nov. 2026')
  })

  test('série : visites, tirages, gains, coût et compteurs anonymes regroupés par période ; période en cours arrêtée à aujourd’hui', () => {
    const clients = [{ visites: ['2026-11-02T12:00:00Z', '2026-11-10T12:00:00Z'] }, { visites: ['2026-10-20T12:00:00Z'] }]
    const compteurs: CompteurEvenement[] = [
      { jour: '2026-11-10', type: 'scan', n: 7 },
      { jour: '2026-11-03', type: 'scan', n: 2 },
      { jour: '2026-11-10', type: 'clicGoogle', n: 1 },
    ]
    const tirages = [tirage('2026-11-10T12:00:00Z', 'Thé glacé', { remis: true })]
    const pts = serie(vide({ clients, tirages, compteurs }), 'semaine', '2026-11-10', 3)
    assert.deepEqual(pts.map((p) => [p.debut, p.fin, p.visites, p.tirages, p.coutDistribues, p.evenements.scan]), [
      ['2026-10-19', '2026-10-25', 1, 0, 0, 0],
      ['2026-10-26', '2026-11-01', 0, 0, 0, 0],
      ['2026-11-02', '2026-11-08', 1, 0, 0, 2],
      ['2026-11-09', '2026-11-10', 1, 1, 80, 7],
    ].slice(1))
    assert.equal(pts.at(-1)!.evenements.clicGoogle, 1)
  })
})

// ---------- Comparaison avec le mois précédent ----------

describe('Comparaison avec le mois précédent', () => {
  test('même nombre de jours : 1er → aujourd’hui contre 1er → même quantième du mois précédent', () => {
    const clients = [{ visites: ['2026-11-03T12:00:00Z', '2026-11-05T12:00:00Z', '2026-10-04T12:00:00Z', '2026-10-25T12:00:00Z'] }]
    const c = comparaisonMoisPrecedent(vide({ clients }), '2026-11-10')
    assert.deepEqual([c.courant.debut, c.courant.fin, c.precedent.debut, c.precedent.fin], ['2026-11-01', '2026-11-10', '2026-10-01', '2026-10-10'])
    assert.equal(c.courant.totaux.visites, 2)
    assert.equal(c.precedent.totaux.visites, 1, 'la visite du 25 octobre est hors de la période comparable')
  })

  test('mois précédent plus court : ramené à son dernier jour ; janvier → décembre de l’année d’avant', () => {
    const mars = comparaisonMoisPrecedent(vide(), '2026-03-31')
    assert.deepEqual([mars.precedent.debut, mars.precedent.fin], ['2026-02-01', '2026-02-28'])
    const janvier = comparaisonMoisPrecedent(vide(), '2026-01-05')
    assert.deepEqual([janvier.precedent.debut, janvier.precedent.fin], ['2025-12-01', '2025-12-05'])
  })

  test('variation en % ; base nulle : pas de pourcentage inventé', () => {
    assert.equal(variation(12, 10), 20)
    assert.equal(variation(5, 10), -50)
    assert.equal(variation(3, 0), null)
    assert.equal(texteVariation(12, 10), '+20 %')
    assert.equal(texteVariation(5, 10), '−50 %')
    assert.equal(texteVariation(3, 0), 'nouveau')
    assert.equal(texteVariation(0, 0), '=')
    assert.equal(texteVariation(10, 10), '=')
  })
})

// ---------- Entonnoir, participation, retour après gain ----------

describe('Entonnoir anonyme, participation, retour après gain', () => {
  test('entonnoir : pages ouvertes → tirages → gains → clics Google, % de l’étape précédente', () => {
    const compteurs: CompteurEvenement[] = [
      { jour: '2026-11-10', type: 'scan', n: 40 },
      { jour: '2026-11-10', type: 'tirage', n: 20 },
      { jour: '2026-11-10', type: 'gain', n: 12 },
      { jour: '2026-11-10', type: 'clicGoogle', n: 3 },
    ]
    const e = entonnoir(totaux(vide({ compteurs }), '2026-11-10', '2026-11-10'))
    assert.deepEqual(e.map((x) => [x.cle, x.n, x.tauxEtape]), [
      ['scan', 40, null],
      ['tirage', 20, 50],
      ['gain', 12, 60],
      ['clicGoogle', 3, 25],
    ])
    assert.deepEqual(entonnoir(totaux(vide(), '2026-11-10', '2026-11-10')).map((x) => x.tauxEtape), [null, null, null, null], 'aucune division par 0')
  })

  test('participation = tirages / visites validées de la période', () => {
    const clients = [{ visites: ['2026-11-10T10:00:00Z'] }, { visites: ['2026-11-10T11:00:00Z'] }, { visites: ['2026-11-10T12:00:00Z', '2026-11-09T12:00:00Z'] }]
    const tirages = [tirage('2026-11-10T10:05:00Z', 'Dommage !'), tirage('2026-11-10T11:05:00Z', 'Nems offerts')]
    assert.equal(tauxParticipation(totaux(vide({ clients, tirages }), '2026-11-10', '2026-11-10')), 67)
    assert.equal(tauxParticipation(totaux(vide(), '2026-11-10', '2026-11-10')), null)
  })

  test('retour après gain : visite un jour APRÈS le gain, sous 30 jours ; gains trop récents et clients supprimés exclus', () => {
    const c = (id: string, visites: string[]): Pick<Client, 'id' | 'visites'> => ({ id, visites })
    const clients = [
      c('revenu', ['2026-09-01T12:00:00Z', '2026-09-20T12:00:00Z']),
      c('memejour', ['2026-09-01T12:00:00Z', '2026-09-01T19:00:00Z']), // 2e visite le jour même : pas un retour
      c('tard', ['2026-09-01T12:00:00Z', '2026-10-15T12:00:00Z']), // revenu après 44 jours : hors fenêtre
      c('recent', ['2026-11-01T12:00:00Z', '2026-11-05T12:00:00Z']), // gain du 1er nov. : fenêtre pas finie
      c('perdant', ['2026-09-01T12:00:00Z', '2026-09-03T12:00:00Z']),
    ]
    const tirages = [
      tirage('2026-09-01T12:05:00Z', 'Nems offerts', { clientId: 'revenu' }),
      tirage('2026-09-01T12:05:00Z', 'Thé glacé', { clientId: 'memejour' }),
      tirage('2026-09-01T12:05:00Z', 'Mochi offert', { clientId: 'tard' }),
      tirage('2026-11-01T12:05:00Z', 'Nems offerts', { clientId: 'recent' }),
      tirage('2026-09-01T12:05:00Z', 'Dommage !', { clientId: 'perdant' }),
      tirage('2026-09-01T12:05:00Z', 'Nems offerts', { clientId: 'supprime' }),
    ]
    assert.deepEqual(retourApresGain(clients, tirages, '2026-08-01', '2026-11-10', '2026-11-10'), { gains: 3, revenus: 1, taux: 33 })
  })
})

// ---------- Export CSV ----------

describe('Export CSV des chiffres', () => {
  test('BOM, séparateur ;, une ligne par période, montants en euros à virgule, participation en %', () => {
    const clients = [{ visites: ['2026-11-10T10:00:00Z', '2026-11-09T10:00:00Z'] }]
    const tirages = [tirage('2026-11-10T10:05:00Z', 'Nems offerts', { remis: true })]
    const compteurs: CompteurEvenement[] = [{ jour: '2026-11-10', type: 'scan', n: 4 }]
    const csv = serieEnCsv(serie(vide({ clients, tirages, compteurs }), 'jour', '2026-11-10', 2), 'jour')
    assert.ok(csv.startsWith('﻿'))
    const lignes = csv.slice(1).trim().split('\r\n')
    assert.equal(lignes[0], 'jour;debut;fin;visites;tirages;gains;lots_distribues;cout_gagnes_eur;cout_distribues_eur;gains_sans_cout;participation_pct;scans;clics_google')
    assert.equal(lignes[1], 'lun. 9 nov.;2026-11-09;2026-11-09;1;0;0;0;0,00;0,00;0;0;0;0')
    assert.equal(lignes[2], 'mar. 10 nov.;2026-11-10;2026-11-10;1;1;1;1;1,50;1,50;0;100;4;0')
    assert.equal(lignes.length, 3)
  })
})

// ---------- Test A/B « accroche » ----------

describe('Test A/B « accroche » : variante par jour, sans identité', () => {
  test('un jour sur deux ; chaque jour de la semaine change de variante d’une semaine à l’autre', () => {
    const j = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'].map(varianteDuJour)
    assert.deepEqual(j, [j[0], j[0] === 'A' ? 'B' : 'A', j[0], j[0] === 'A' ? 'B' : 'A'])
    assert.notEqual(varianteDuJour('2026-11-09'), varianteDuJour('2026-11-16'), 'lundi suivant : autre variante')
    assert.equal(varianteDuJour('2026-11-09'), varianteDuJour('2026-11-23'))
  })

  test('accroche : générique hors test ; variante B = 1er lot gagnant (jamais « Dommage ! ») ; traduite en anglais', () => {
    const jourB = ['2026-11-09', '2026-11-10'].find((j) => varianteDuJour(j) === 'B')!
    const jourA = ['2026-11-09', '2026-11-10'].find((j) => varianteDuJour(j) === 'A')!
    const lots = [{ libelle: 'Dommage !' }, { libelle: 'Nems offerts' }]
    assert.deepEqual(accrocheJeu({ lots }, jourB), { modele: ACCROCHE_GENERIQUE })
    assert.deepEqual(accrocheJeu({ lots, testAccroche: true }, jourA), { modele: ACCROCHE_GENERIQUE })
    assert.deepEqual(accrocheJeu({ lots, testAccroche: true }, jourB), { modele: ACCROCHE_LOT, valeurs: { lot: 'Nems offerts' } })
    assert.deepEqual(accrocheJeu({ lots, testsAB: { accroche: { actif: true } } }, jourB).valeurs, { lot: 'Nems offerts' }, 'démo locale')
    assert.deepEqual(accrocheJeu({ lots: [{ libelle: 'Dommage !' }], testAccroche: true }, jourB), { modele: ACCROCHE_GENERIQUE })
    assert.ok(TRADUCTIONS_EN[ACCROCHE_LOT] && TRADUCTIONS_EN[ACCROCHE_GENERIQUE])
    assert.equal(traduire(ACCROCHE_LOT, 'en', { lot: 'Nems offerts' }), 'Spin the wheel: Nems offerts to win!')
  })

  test('activation / arrêt : dates posées au changement d’état, réactivation = nouveau départ', () => {
    const a = basculerAccroche(undefined, true, '2026-11-10')
    assert.deepEqual(a, { actif: true, depuis: '2026-11-10' })
    assert.deepEqual(basculerAccroche(a, true, '2026-11-12'), a, 'déjà actif : rien ne bouge')
    const b = basculerAccroche(a, false, '2026-11-20')
    assert.deepEqual(b, { actif: false, depuis: '2026-11-10', jusqua: '2026-11-20' })
    assert.deepEqual(basculerAccroche(b, true, '2026-12-01'), { actif: true, depuis: '2026-12-01' })
  })

  test('résultats par variante (jours, pages ouvertes, tirages, taux) ; conclusion seulement avec assez de données', () => {
    const jours = Array.from({ length: 14 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`)
    const compteurs: CompteurEvenement[] = jours.flatMap((jour) => {
      const b = varianteDuJour(jour) === 'B'
      return [
        { jour, type: 'scan' as const, n: 20 },
        { jour, type: 'tirage' as const, n: b ? 12 : 8 },
      ]
    })
    compteurs.push({ jour: '2026-10-31', type: 'scan', n: 999 }) // avant le test : ignoré
    const r = resultatsAccroche(compteurs, { actif: true, depuis: '2026-11-01' }, '2026-11-14')!
    assert.deepEqual([r.A.jours, r.B.jours, r.A.scans, r.B.scans, r.A.tirages, r.B.tirages, r.A.taux, r.B.taux], [7, 7, 140, 140, 56, 84, 40, 60])
    assert.equal(r.assezDeDonnees, true)
    assert.equal(r.significatif, true)
    const peu = resultatsAccroche(compteurs, { actif: false, depuis: '2026-11-01', jusqua: '2026-11-04' }, '2026-11-14')!
    assert.equal(peu.jusqua, '2026-11-04')
    assert.equal(peu.assezDeDonnees, false)
    assert.equal(peu.significatif, false)
    assert.equal(resultatsAccroche(compteurs, undefined, '2026-11-14'), null)
  })
})

// ---------- Front : signal anonyme ----------

describe('Signal « page de jeu ouverte » : une fois par onglet, rien que le type', () => {
  test('signalerScan envoie le type seul, une seule fois par onglet et par commerce ; échec réseau ignoré', async () => {
    const appels: unknown[][] = []
    const api = { signalerEvenement: async (...a: unknown[]) => void appels.push(a) as never }
    const memoire = new Map<string, string>()
    const session = { getItem: (k: string) => memoire.get(k) ?? null, setItem: (k: string, v: string) => void memoire.set(k, v), removeItem: (k: string) => void memoire.delete(k) }
    assert.equal(signalerScan(api as never, 'c1', session), true)
    assert.equal(signalerScan(api as never, 'c1', session), false)
    assert.equal(signalerScan(api as never, 'c2', session), true)
    assert.deepEqual(appels, [['c1', 'scan'], ['c2', 'scan']])
    const enPanne = { signalerEvenement: () => Promise.reject(new Error('hors ligne')) }
    assert.equal(signalerScan(enPanne as never, 'c3', null), true, 'sans stockage : envoyé quand même, jamais d’exception')
    await new Promise((r) => setImmediate(r))
  })

  test('client API : POST …/evenements avec { type } seulement', () => {
    const api = source('src/data/api.ts')
    assert.match(api, /requete\('POST', `\/commerces\/\$\{enc\(commerceId\)\}\/evenements`, \{ corps: \{ type \}, delaiMs: 5_000 \}\)/)
  })

  test('page de jeu : scan signalé à l’ouverture (mode serveur) ; accroche A/B ; garde consentement intacte', () => {
    const jouer = source('src/pages/Jouer.tsx')
    assert.match(jouer, /useEffect\(\(\) => void signalerScan\(api, commerce\.id, stockageSession\(\)\), \[api, commerce\.id\]\)/)
    assert.match(jouer, /const accroche = accrocheJeu\(commerce, jourParis\(new Date\(\)\)\)/)
    assert.match(jouer, /\{t\(accroche\.modele, accroche\.valeurs\)\}/)
    assert.doesNotMatch(jouer, /useState\(true\)|defaultChecked/)
    assert.match(jouer, /<InvitationAvis commerce=\{commerce\} onMessagePrive=\{messagePrive\} lienCarte=\{carte\} \/>/, 'ligne inchangée (limite de 120 caractères)')
  })

  test('clic Google : compté depuis la page de jeu seulement, sans carte ni note ; lien Google intact', () => {
    const inv = source('src/components/InvitationAvis.tsx')
    assert.match(inv, /api\.signalerEvenement\(commerce\.id, 'clicGoogle'\)/)
    assert.match(inv, /page === 'jouer'/)
    assert.match(inv, /href=\{lien\}/)
    assert.doesNotMatch(inv.slice(inv.indexOf('function ouvrirGoogle')), /signalerEvenement\([^)]*(note|clientId|contact|lienCarte)/)
  })
})

// ---------- Front : tableau de bord, réglages ----------

describe('Tableau de bord et réglages (sources)', () => {
  const mesure = source('src/components/Mesure.tsx')

  test('le tableau de bord affiche la mesure ; lecture directe des compteurs (pas avecPin dans un useEffect)', () => {
    assert.match(source('src/pages/TableauDeBord.tsx'), /<Mesure \/>/)
    assert.match(mesure, /api\.mesures\(commerce\.id, acces\)/)
    assert.match(mesure, /\}, \[mode, api, acces, commerce\.id\]\)/)
    assert.doesNotMatch(mesure, /avecPin\(|avecPin \}/)
  })

  test('jour / semaine / mois, séries visites / tirages / gains / coût, comparaison, export CSV, définitions affichées', () => {
    for (const g of ["'jour'", "'semaine'", "'mois'"]) assert.match(mesure, new RegExp(`valeur: ${g}`))
    for (const s of ['x.visites', 'x.tirages', 'x.gains', 'x.coutDistribues']) assert.ok(mesure.includes(`valeur={(x) => ${s}}`), s)
    assert.match(mesure, /comparaisonMoisPrecedent\(donnees, aujourdhui\)/)
    assert.match(mesure, /telecharger\(nomFichierMesures\(commerce\.id, g, aujourdhui\), serieEnCsv\(points, g\)\)/)
    assert.match(mesure, /\{DEFINITION_GAGNE\} \{DEFINITION_DISTRIBUE\}/)
    assert.match(mesure, /migration 0008/)
    assert.match(mesure, /aria-pressed=\{g === x\.valeur\}/)
  })

  test('réglages : coût de chaque lot en euros (converti en centimes), interrupteur du test A/B', () => {
    const r = source('src/pages/Reglages.tsx')
    assert.match(r, /htmlFor=\{`cout-\$\{i\}`\}/)
    assert.match(r, /coutCentimes: e\.target\.value === '' \? undefined : Math\.round\(e\.target\.valueAsNumber \* 100\)/)
    assert.match(r, /basculerAccroche\(brouillon\.testsAB\?\.accroche, v, jourParis\(new Date\(\)\)\)/)
    assert.equal(r.match(/grid grid-cols-1 gap-3 sm:grid-cols-3/g)?.length, 3, 'grilles mobiles inchangées')
    assert.doesNotMatch(mesure + r, /window\.confirm/)
  })
})

// ---------- Serveur (SQLite) ----------

const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-q3-'))
after(() => rmSync(dossier, { recursive: true, force: true }))
const horloge = new Date('2026-11-10T11:00:00Z')

async function demarrer(fichierDb: string, options: Partial<OptionsServeur> = {}) {
  const app = await creerServeur({ fichierDb, adminPin: ADMIN, pinInitial: '1234', version: 'test', maintenant: () => horloge, ...options })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, { method: methode, headers: { 'Content-Type': 'application/json', ...entetes }, body: corps === undefined ? undefined : JSON.stringify(corps) })
    return { statut: r.status, contenu: await r.json() }
  }
  return { app, api }
}

describe('Serveur : événements anonymes, mesures, coût des lots, test A/B', () => {
  test('POST /evenements : type seul ; tout autre champ refusé (aucune identité acceptée) ; tirage / gain réservés au serveur', async () => {
    const fichier = join(dossier, 'evenements.db')
    const { app, api } = await demarrer(fichier)
    try {
      assert.deepEqual((await api('POST', `/commerces/${AH}/evenements`, { type: 'scan' })).contenu, { ok: true, compte: true })
      assert.equal((await api('POST', `/commerces/${AH}/evenements`, { type: 'clicGoogle' })).statut, 202)
      for (const corps of [{ type: 'scan', clientId: 'cl-1' }, { type: 'scan', contact: '0612345678' }, { type: 'scan', note: 5 }]) {
        const r = await api('POST', `/commerces/${AH}/evenements`, corps)
        assert.equal(r.statut, 400, JSON.stringify(corps))
        assert.match(r.contenu.erreur, /Seul « type » est accepté/)
      }
      for (const type of ['tirage', 'gain', 'autre', undefined]) assert.equal((await api('POST', `/commerces/${AH}/evenements`, { type })).statut, 400, String(type))
      assert.equal((await api('POST', '/commerces/inconnu/evenements', { type: 'scan' })).statut, 404)
    } finally {
      await app.fermer()
    }
    const db = new DatabaseSync(fichier)
    try {
      const colonnes = (db.prepare('PRAGMA table_info(evenements_jour)').all() as { name: string }[]).map((c) => c.name)
      assert.deepEqual(colonnes, ['commerce_id', 'jour', 'type', 'n'], 'ni client, ni contact, ni IP, ni heure')
      assert.deepEqual(db.prepare('SELECT commerce_id, jour, type, n FROM evenements_jour ORDER BY type').all().map((l) => ({ ...l })), [
        { commerce_id: AH, jour: '2026-11-10', type: 'clicGoogle', n: 1 },
        { commerce_id: AH, jour: '2026-11-10', type: 'scan', n: 1 },
      ])
    } finally {
      db.close()
    }
  })

  test('limite par IP (evenementParIp) → 429, l’événement n’est pas compté ; commerce en pause : rien n’est compté', async () => {
    const { app, api } = await demarrer(join(dossier, 'limite.db'), { limitesPubliques: { evenementParIp: 3 } })
    try {
      for (let i = 0; i < 3; i++) assert.equal((await api('POST', `/commerces/${AH}/evenements`, { type: 'scan' })).statut, 202)
      assert.equal((await api('POST', `/commerces/${AH}/evenements`, { type: 'scan' })).statut, 429)
      const m = await api('GET', `/commerces/${AH}/mesures`, undefined, PIN)
      assert.deepEqual(m.contenu.compteurs, [{ jour: '2026-11-10', type: 'scan', n: 3 }])
    } finally {
      await app.fermer()
    }
    const pause = await demarrer(join(dossier, 'pause.db'))
    try {
      assert.equal((await pause.api('PATCH', `/commerces/${AH}`, { actif: false }, PIN)).statut, 200)
      assert.deepEqual((await pause.api('POST', `/commerces/${AH}/evenements`, { type: 'scan' })).contenu, { ok: true, compte: false })
    } finally {
      await pause.app.fermer()
    }
  })

  test('tirage : compteurs « tirage » et « gain » (lot gagnant seulement) ; le tirage reste identique ; GET /mesures gérant seulement', async () => {
    const { app, api } = await demarrer(join(dossier, 'tirage.db'))
    try {
      const lots = [{ libelle: 'Nems offerts', probabilite: 100, coutCentimes: 150 }, { libelle: 'Dommage !', probabilite: 0 }]
      assert.equal((await api('PATCH', `/commerces/${AH}`, { lots }, PIN)).statut, 200)
      for (const tel of ['0611111111', '0622222222']) {
        const ins = await api('POST', `/commerces/${AH}/clients`, { contact: tel })
        await api('POST', `/commerces/${AH}/clients/${ins.contenu.client.id}/visite`, undefined, PIN)
        const jeu = await api('POST', `/commerces/${AH}/tirages`, { contact: tel })
        assert.equal(jeu.statut, 201)
        assert.deepEqual(Object.keys(jeu.contenu).sort(), ['code', 'date', 'lot', 'perdant'], 'réponse du tirage inchangée')
      }
      // Tirage perdant : compté comme tirage, pas comme gain.
      assert.equal((await api('PATCH', `/commerces/${AH}`, { lots: [{ libelle: 'Dommage !', probabilite: 100 }] }, PIN)).statut, 200)
      const ins = await api('POST', `/commerces/${AH}/clients`, { contact: '0633333333' })
      await api('POST', `/commerces/${AH}/clients/${ins.contenu.client.id}/visite`, undefined, PIN)
      assert.equal((await api('POST', `/commerces/${AH}/tirages`, { contact: '0633333333' })).contenu.perdant, true)
      assert.equal((await api('POST', `/commerces/${AH}/tirages`, { contact: '0633333333' })).statut, 409, 'déjà joué : pas compté')

      assert.equal((await api('GET', `/commerces/${AH}/mesures`)).statut, 401)
      const m = await api('GET', `/commerces/${AH}/mesures`, undefined, PIN)
      assert.equal(m.contenu.migration, true)
      assert.deepEqual(m.contenu.compteurs, [
        { jour: '2026-11-10', type: 'gain', n: 2 },
        { jour: '2026-11-10', type: 'tirage', n: 3 },
      ])
      assert.equal(m.contenu.depuis, '2025-10-06', '400 jours par défaut')
      assert.equal((await api('GET', `/commerces/${AH}/mesures?depuis=2026-11-11`, undefined, PIN)).contenu.compteurs.length, 0)
      assert.equal((await api('GET', `/commerces/${AH}/mesures?depuis=2000-01-01`, undefined, PIN)).contenu.depuis, '2025-10-06', 'borné à 400 jours')
      assert.equal((await api('GET', '/sante')).contenu.migrations.mesure, true)
    } finally {
      await app.fermer()
    }
  })

  test('coût des lots : enregistré (centimes entiers 0 à 100 000), refusé sinon, jamais publié aux clients', async () => {
    const { app, api } = await demarrer(join(dossier, 'cout.db'))
    try {
      const ok = await api('PATCH', `/commerces/${AH}`, { lots: [{ libelle: 'Nems offerts', probabilite: 50, coutCentimes: 150 }, { libelle: 'Thé glacé', probabilite: 50 }] }, PIN)
      assert.equal(ok.statut, 200)
      assert.deepEqual(ok.contenu.commerce.lots, [{ libelle: 'Nems offerts', probabilite: 50, coutCentimes: 150 }, { libelle: 'Thé glacé', probabilite: 50 }])
      for (const coutCentimes of [-1, 1.5, 100_001, '150']) {
        const r = await api('PATCH', `/commerces/${AH}`, { lots: [{ libelle: 'Nems offerts', probabilite: 50, coutCentimes }] }, PIN)
        assert.equal(r.statut, 400, String(coutCentimes))
        assert.match(r.contenu.erreur, /coût/)
      }
      const pub = await api('GET', `/commerces/${AH}`)
      assert.deepEqual(pub.contenu.commerce.lots, [{ libelle: 'Nems offerts' }, { libelle: 'Thé glacé' }])
      assert.doesNotMatch(JSON.stringify(pub.contenu), /coutCentimes|testsAB/)
    } finally {
      await app.fermer()
    }
  })

  test('test A/B : dates posées par le serveur (jamais celles du navigateur) ; fiche publique = indicateur seul', async () => {
    const { app, api } = await demarrer(join(dossier, 'ab.db'))
    try {
      const r = await api('PATCH', `/commerces/${AH}`, { testsAB: { accroche: { actif: true, depuis: '2020-01-01' } } }, PIN)
      assert.equal(r.statut, 200)
      assert.deepEqual(r.contenu.commerce.testsAB, { accroche: { actif: true, depuis: '2026-11-10' } })
      assert.equal((await api('GET', `/commerces/${AH}`)).contenu.commerce.testAccroche, true)
      const arret = await api('PATCH', `/commerces/${AH}`, { testsAB: { accroche: { actif: false } } }, PIN)
      assert.deepEqual(arret.contenu.commerce.testsAB, { accroche: { actif: false, depuis: '2026-11-10', jusqua: '2026-11-10' } })
      assert.equal((await api('GET', `/commerces/${AH}`)).contenu.commerce.testAccroche, undefined)
      assert.equal((await api('PATCH', `/commerces/${AH}`, { testsAB: { prix: { actif: true } } }, PIN)).statut, 400)
      assert.equal((await api('PATCH', `/commerces/${AH}`, { testsAB: { accroche: { actif: 'oui' } } }, PIN)).statut, 400)
    } finally {
      await app.fermer()
    }
  })

  test('vue publique (fonction) : ni coût, ni dates de test', () => {
    const c = { ...nouveauCommerce('Chez Lin', 'restaurant', ''), lots: LOTS, testsAB: { accroche: { actif: true, depuis: '2026-11-10' } } }
    const pub = commercePublic(c)
    assert.ok(pub.lots.every((l) => Object.keys(l).join() === 'libelle'))
    assert.equal(pub.testAccroche, true)
    assert.doesNotMatch(JSON.stringify(pub), /coutCentimes|depuis|testsAB/)
  })
})

// ---------- Documentation ----------

describe('Documentation des tests A/B', () => {
  test('docs/TESTS-AB.md : 2 tests, mécanisme du test 1, protocole manuel du test 2 dit clairement', () => {
    const doc = source('docs/TESTS-AB.md')
    assert.match(doc, /Test 1/)
    assert.match(doc, /Test 2/)
    assert.match(doc, /mardi/)
    assert.match(doc, /jeudi/)
    assert.match(doc, /manuel/i)
    assert.match(doc, /varianteDuJour/)
    assert.match(doc, /aucune identité|Aucune identité/)
  })
})

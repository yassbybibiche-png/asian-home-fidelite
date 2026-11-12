// P0-U2 — Roue lisible : règle de longueur, abréviation, légende, compteur Réglages, secteurs étroits.
// Les composants .tsx ne sont pas importables par `node --test` : leur câblage est vérifié sur le source.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { nouveauCommerce } from '../src/data/defaults.ts'
import seed from '../src/data/seed.json' with { type: 'json' }
import {
  abreger,
  affichageSecteur,
  ANGLE_MIN_LIBELLE,
  ANGLE_MIN_NUMERO,
  COULEURS,
  compteurLibelle,
  couleurSecteur,
  largeurEstimee,
  LONGUEUR_TEXTE_MAX,
  MAX_CARACTERES_ROUE,
  POLICE_ROUE,
  RAYON_LIBELLE,
  secteursAffiches,
} from '../src/lib/roue.ts'
import { lotsJouables, secteurs, tirerLot } from '../src/lib/roulette.ts'
import { typeLot } from '../src/lib/lots.ts'
import type { Commerce } from '../src/types.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')

describe('P0-U2 : règle de longueur et abréviation', () => {
  test('12 caractères au plus sur la roue, police ≥ 14 px dès 360 px d’écran', () => {
    assert.equal(MAX_CARACTERES_ROUE, 12)
    // Racine 17 px ; #/jouer : px-4 (2 × 17) puis -mx-1 / px-2 (2 × (8,5 − 4,25)) ; roue max-w-80 = 340 px.
    const largeurRoue = (ecran: number) => Math.min(340, ecran - 34 + 8.5 - 17)
    const policePx = (ecran: number) => (POLICE_ROUE * largeurRoue(ecran)) / 200
    for (const ecran of [360, 375, 390, 414, 430]) assert.ok(policePx(ecran) >= 14, `${ecran} px → ${policePx(ecran)} px`)
    assert.match(lire('src/components/Roue.tsx'), /aspect-square w-full max-w-80/)
    assert.match(lire('src/pages/Jouer.tsx'), /<div className="mx-auto max-w-md space-y-5 px-4 pt-6 pb-10">/)
    assert.match(lire('src/pages/Jouer.tsx'), /<div className="hero-sombre -mx-1 rounded-3xl px-2 py-4 ring-1 ring-magenta-400\/30">/)
    // Un libellé de 12 caractères tient dans la longueur utile du rayon.
    assert.ok(largeurEstimee('Mochi offert') <= LONGUEUR_TEXTE_MAX)
    // …et la longueur utile reste entre le moyeu (r = 15) et le bord (r = 88).
    assert.ok(RAYON_LIBELLE - LONGUEUR_TEXTE_MAX / 2 > 15 && RAYON_LIBELLE + LONGUEUR_TEXTE_MAX / 2 < 88)
  })

  test('un libellé de 12 caractères ou moins est écrit en entier', () => {
    for (const l of ['Nems offerts', 'Mochi offert', 'Thé glacé', 'Dommage !', 'Café']) assert.equal(abreger(l), l)
    assert.equal(abreger('  Nems offerts  '), 'Nems offerts')
  })

  test('au-delà : coupé à la fin d’un mot, toujours avec une ellipse visible', () => {
    assert.equal(abreger('Thé glacé maison offert'), 'Thé glacé…')
    assert.equal(abreger('Pas de chance, à la prochaine !'), 'Pas de…')
    // Pas d'espace utilisable : coupe nette, ellipse quand même.
    assert.equal(abreger('Anticonstitutionnellement'), 'Anticonstit…')
    for (const l of ['Thé glacé maison offert', '-10 % sur le prochain passage', 'Shampoing format voyage offert']) {
      const a = abreger(l)
      assert.ok(a.endsWith('…'), a)
      assert.ok(Array.from(a).length <= MAX_CARACTERES_ROUE, a)
    }
  })

  test('caractères accentués et emoji comptés comme un seul caractère', () => {
    assert.equal(compteurLibelle('Thé glacé').longueur, 9)
    assert.equal(compteurLibelle('🍵 Thé offert').longueur, 12)
    assert.equal(abreger('🍵 Thé offert'), '🍵 Thé offert')
  })
})

describe('P0-U2 : libellés par défaut ≤ 12 caractères', () => {
  test('nouveau commerce (production, POST /commerces) : avant → après', () => {
    const libelles = nouveauCommerce('Test', 'restaurant', '').lots.map((l) => l.libelle)
    // Roue v2 R1 (décision utilisateur du 12/11/2026) : « Dommage ! » devient la consolation « +10 points ».
    assert.deepEqual(libelles, ['Remise 10 %', 'Petit cadeau', 'Remise 5 %', '+10 points'])
    for (const l of libelles) assert.ok(Array.from(l).length <= MAX_CARACTERES_ROUE, l)
  })

  test('seed (Asian Home à la 1re initialisation du serveur + démo) : tous les lots tiennent sur la roue', () => {
    for (const c of seed.commerces as unknown as Commerce[]) {
      for (const l of c.lots) assert.ok(Array.from(l.libelle).length <= MAX_CARACTERES_ROUE, `${c.nom} : ${l.libelle}`)
    }
    const [asianHome] = seed.commerces as unknown as Commerce[]
    assert.deepEqual(
      asianHome.lots.map((l) => l.libelle),
      ['Nems offerts', 'Thé glacé', 'Mochi offert', 'Remise 10 %', '+10 points'],
    )
  })

  test('les tirages du seed ne citent que des lots existants (historique cohérent)', () => {
    const lotsParCommerce = new Map((seed.commerces as unknown as Commerce[]).map((c) => [c.id, new Set(c.lots.map((l) => l.libelle))]))
    for (const t of seed.tirages as { commerceId: string; lot: string }[]) assert.ok(lotsParCommerce.get(t.commerceId)?.has(t.lot), t.lot)
  })

  // Roue v2 R1 (décision utilisateur du 12/11/2026) : le type est explicite, plus déduit du libellé. Intention gardée :
  // un perdant (explicite, ou ancien « Dommage ! » sans type) reste un perdant, les autres lots restent des lots.
  test('le lot perdant raccourci reste reconnu comme perdant (pas de code gagnant)', () => {
    assert.equal(typeLot({ libelle: 'Dommage !', type: 'perdant' }), 'perdant')
    assert.equal(typeLot({ libelle: 'Dommage !' }), 'perdant', 'config d’avant R1 sans type')
    for (const l of ['Remise 10 %', 'Petit cadeau', 'Remise 5 %', 'Thé glacé', 'Nems offerts']) assert.equal(typeLot({ libelle: l }), 'lot', l)
    assert.deepEqual(
      nouveauCommerce('Test', 'restaurant', '').lots.map((l) => l.type),
      ['lot', 'lot', 'lot', 'points'],
    )
  })
})

describe('P0-U2 : secteurs étroits', () => {
  test('≥ 30° : libellé ; 12–30° : numéro de légende ; < 12° : rien', () => {
    assert.equal(ANGLE_MIN_LIBELLE, 30)
    assert.equal(ANGLE_MIN_NUMERO, 12)
    assert.equal(affichageSecteur(90), 'libelle')
    assert.equal(affichageSecteur(30), 'libelle')
    assert.equal(affichageSecteur(360 / 12 - 1e-9), 'libelle')
    assert.equal(affichageSecteur(29.9), 'numero')
    assert.equal(affichageSecteur(12), 'numero')
    assert.equal(affichageSecteur(11.9), 'aucun')
  })

  test('vue commerçant : un lot à 2 % (7,2°) n’a rien sur la roue, un lot à 5 % (18°) son numéro, mais tous sont dans la légende', () => {
    const lots = [
      { libelle: 'Nems offerts', probabilite: 63 },
      { libelle: 'Thé glacé maison offert', probabilite: 30 },
      { libelle: 'Repas offert', probabilite: 5 },
      { libelle: 'Menu dégustation pour deux', probabilite: 2 },
    ]
    const parts = secteursAffiches(lots)
    assert.deepEqual(
      parts.map((s) => [s.numero, s.affichage, s.texteRoue, s.libelle]),
      [
        [1, 'libelle', 'Nems offerts', 'Nems offerts'],
        [2, 'libelle', 'Thé glacé…', 'Thé glacé maison offert'],
        [3, 'numero', '3', 'Repas offert'],
        [4, 'aucun', '', 'Menu dégustation pour deux'],
      ],
    )
    assert.deepEqual(
      parts.map((s) => s.abrege),
      [false, true, false, false],
    )
  })

  test('vue publique (12 lots max, secteurs égaux de 30°) : tous les libellés sont écrits', () => {
    const lots = Array.from({ length: 12 }, (_, i) => ({ libelle: `Lot ${i + 1}` }))
    assert.ok(secteursAffiches(lots).every((s) => s.affichage === 'libelle'))
  })

  test('affichage seul : mêmes secteurs, même ordre, même tirage que la logique de jeu', () => {
    const lots = [
      { libelle: 'Nems offerts', probabilite: 20 },
      { libelle: '', probabilite: 50 },
      { libelle: 'Mochi offert', probabilite: 0 },
      { libelle: 'Dommage !', probabilite: 30 },
    ]
    const parts = secteursAffiches(lots)
    assert.deepEqual(
      parts.map((s) => [s.libelle, s.debut, s.fin]),
      secteurs(lots).map((s) => [s.lot.libelle, s.debut, s.fin]),
    )
    assert.deepEqual(
      parts.map((s) => s.libelle),
      lotsJouables(lots).map((l) => l.libelle),
    )
    assert.equal(parts[tirerLot(lots, 0.1)].libelle, 'Nems offerts')
  })

  test('couleurs : la légende reprend celles des secteurs, jamais deux voisins identiques', () => {
    for (let n = 2; n <= 12; n++) {
      const parts = secteursAffiches(Array.from({ length: n }, (_, i) => ({ libelle: `L${i}` })))
      parts.forEach((s, i) => {
        assert.equal(s.couleur, couleurSecteur(i, n))
        assert.ok(COULEURS.includes(s.couleur))
        assert.notEqual(s.couleur, parts[(i + 1) % n].couleur, `n=${n}, i=${i}`)
      })
    }
  })
})

describe('P0-U2 : compteur dans Réglages', () => {
  test('« X/12 caractères affichés sur la roue », alerte au-delà de 12', () => {
    assert.deepEqual(compteurLibelle('Nems offerts'), { longueur: 12, max: 12, depasse: false, texte: '12/12 caractères affichés sur la roue' })
    const long = compteurLibelle('Thé glacé maison offert')
    assert.equal(long.texte, '23/12 caractères affichés sur la roue')
    assert.equal(long.depasse, true)
    assert.equal(compteurLibelle('').texte, '0/12 caractères affichés sur la roue')
  })

  test('affiché sous chaque libellé de lot, relié au champ, avec l’aide en cas de dépassement', () => {
    const reglages = lire('src/pages/Reglages.tsx')
    assert.match(reglages, /import \{ compteurLibelle, MAX_CARACTERES_ROUE \} from '\.\.\/lib\/roue'/)
    assert.match(reglages, /aria-describedby=\{`lot-\$\{i\}-compteur`\}/)
    assert.match(reglages, /<CompteurLibelle id=\{`lot-\$\{i\}-compteur`\} libelle=\{lot\.libelle\} \/>/)
    assert.match(reglages, /c\.depasse \? 'font-medium text-red-700' : 'text-gray-600'/)
    assert.match(reglages, /raccourcissez pour un affichage complet sur la roue/)
  })
})

describe('P0-U2 : roue et légende (source des composants)', () => {
  const roue = lire('src/components/Roue.tsx')
  const jouer = lire('src/pages/Jouer.tsx')

  test('la roue écrit le texte calculé par secteursAffiches, en police POLICE_ROUE (plus de 6,5 / 7,8)', () => {
    assert.match(roue, /secteursAffiches\(lots\)/)
    assert.match(roue, /fontSize=\{POLICE_ROUE\}/)
    assert.doesNotMatch(roue, /fontSize=\{etendue/)
    assert.match(roue, /\{s\.texteRoue\}/)
    // Plus d'abréviation locale à 17 caractères.
    assert.doesNotMatch(roue, /max = 17|abreger\(/)
  })

  test('légende : libellé complet + pastille couleur/numéro du secteur, police ≥ 14 px', () => {
    assert.match(roue, /export function LegendeRoue\(\{ lots \}: \{ lots: LotRoue\[\] \}\)/)
    assert.match(roue, /<ol className="mt-2 grid gap-2 text-base text-white" aria-label=\{t\('Lots de la roue'\)\}>/)
    assert.match(roue, /style=\{\{ backgroundColor: s\.couleur, color: s\.couleurTexte \}\}/)
    assert.match(roue, /<span className="min-w-0 break-words">\{s\.libelle\}<\/span>/)
    // html { font-size: 17px } : text-base = 17 px, text-sm = 16 px (P2-Q1).
    assert.match(lire('src/index.css'), /font-size: 17px/)
  })

  test('#/jouer affiche la légende juste sous la roue', () => {
    assert.match(jouer, /<Roue lots=\{commerce\.lots\} rotation=\{rotation\} \/>\n\s*<LegendeRoue lots=\{commerce\.lots\} \/>/)
  })
})

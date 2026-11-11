// P1-M2 — Allergènes : chaque plat a une liste d'allergènes (même vide explicite) ou la mention
// explicite « Allergènes : demander en caisse » ; rien n'est inventé (0 allergène fourni par le
// commerçant) ; la saisie côté commerçant (#/menuCarte : cases à cocher, import/export CSV) fonctionne.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { menuReelAsianHome } from '../src/data/menu-reel.ts'
import { ALLERGENES, ErreurMenu, LIBELLE_ALLERGENES_ABSENTS, libelleAllergenes, menuDepuisCsv, menuEnCsv, validerMenu } from '../src/lib/menu.ts'
import { TRADUCTIONS_EN, traduire } from '../src/lib/langue.ts'
import { ID_ASIAN_HOME } from '../src/lib/visuels.ts'

const MAINTENANT = new Date('2026-11-11T12:00:00Z')
const plats = () => menuReelAsianHome().categories.flatMap((c) => c.produits)
const source = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

describe('81/81 plats avec allergènes renseignés ou mention explicite (P1-M2)', () => {
  test('chaque plat a une liste d’allergènes (tableau, valeurs dans les 14 allergènes UE)', () => {
    assert.equal(plats().length, 81)
    for (const p of plats()) {
      assert.ok(Array.isArray(p.allergenes), p.nom)
      assert.ok(p.allergenes.every((a) => ALLERGENES.includes(a)), p.nom)
    }
    assert.equal(ALLERGENES.length, 14)
  })

  test('0 allergène fourni par le commerçant : les 81 plats affichent la mention explicite, jamais « sans allergène »', () => {
    assert.equal(plats().filter((p) => p.allergenes.length > 0).length, 0)
    assert.equal(LIBELLE_ALLERGENES_ABSENTS, 'Allergènes : demander en caisse')
    for (const p of plats()) assert.equal(libelleAllergenes(p), LIBELLE_ALLERGENES_ABSENTS, p.nom)
    assert.ok(!/sans allergène/i.test(source('src/data/menu-reel.ts')))
    assert.ok(!/sans allergène/i.test(source('src/pages/MenuPublic.tsx')))
  })

  test('libelleAllergenes : liste renseignée → « Allergènes : … » ; vide → mention explicite', () => {
    assert.equal(libelleAllergenes({ allergenes: ['Gluten', 'Soja'] }), 'Allergènes : Gluten, Soja')
    assert.equal(libelleAllergenes({ allergenes: ['Crustacés'] }), 'Allergènes : Crustacés')
    assert.equal(libelleAllergenes({ allergenes: [] }), 'Allergènes : demander en caisse')
  })

  test('la mention explicite est traduite en anglais', () => {
    assert.equal(TRADUCTIONS_EN[LIBELLE_ALLERGENES_ABSENTS], 'Allergens: please ask at the counter.')
    assert.equal(traduire(LIBELLE_ALLERGENES_ABSENTS, 'en'), 'Allergens: please ask at the counter.')
    assert.equal(traduire(LIBELLE_ALLERGENES_ABSENTS, 'fr'), LIBELLE_ALLERGENES_ABSENTS)
  })
})

describe('Validation et CSV : les allergènes saisis par le commerçant sont conservés', () => {
  test('validerMenu accepte une liste valide, refuse un allergène inconnu', () => {
    const ok = validerMenu({ categories: [{ nom: 'E', produits: [{ nom: 'N', prix: 100, allergenes: ['Gluten', 'Soja'] }] }] }, ID_ASIAN_HOME, MAINTENANT)
    assert.deepEqual(ok.categories[0].produits[0].allergenes, ['Gluten', 'Soja'])
    assert.throws(
      () => validerMenu({ categories: [{ nom: 'E', produits: [{ nom: 'N', prix: 100, allergenes: ['Gluten', 'Arachide'] }] }] }, ID_ASIAN_HOME, MAINTENANT),
      ErreurMenu,
    )
  })

  test('export → import CSV : les allergènes survivent (liste comme vide explicite)', () => {
    const menu = {
      categories: [
        {
          id: 'c',
          nom: 'Plats thaï',
          produits: [
            { id: 'p1', nom: 'Pad Thaï', prix: 1390, allergenes: ['Gluten', 'Crustacés', 'Arachides'] },
            { id: 'p2', nom: 'Riz Nature', prix: null, allergenes: [] },
          ],
        },
      ],
    }
    const relu = menuDepuisCsv(menuEnCsv(menu), ID_ASIAN_HOME, MAINTENANT)
    assert.deepEqual(relu.categories[0].produits[0].allergenes, ['Gluten', 'Crustacés', 'Arachides'])
    assert.deepEqual(relu.categories[0].produits[1].allergenes, [])
    assert.match(menuEnCsv(menu), /Pad Thaï;13,90;;[^;]*;Gluten\|Crustacés\|Arachides/)
  })

  test('carte officielle : aller-retour CSV exact, les 81 listes (vides) intactes', () => {
    const officiel = validerMenu(menuReelAsianHome(), ID_ASIAN_HOME, MAINTENANT)
    const relu = menuDepuisCsv(menuEnCsv(officiel), ID_ASIAN_HOME, MAINTENANT)
    assert.equal(relu.categories.flatMap((c) => c.produits).length, 81)
    assert.ok(relu.categories.flatMap((c) => c.produits).every((p) => Array.isArray(p.allergenes) && p.allergenes.length === 0))
  })

  test('import CSV : allergène inconnu → ErreurMenu avec le numéro de ligne', () => {
    assert.throws(() => menuDepuisCsv('categorie;nom;prix;description;photo;allergenes\nE;N;1;;;Arachide\n', ID_ASIAN_HOME, MAINTENANT), /Ligne 2 : allergène inconnu/)
  })
})

describe('Affichage et saisie (source)', () => {
  test('#/menu : la fiche dépliée de chaque plat affiche toujours la ligne allergènes (liste ou mention)', () => {
    const tsx = source('src/pages/MenuPublic.tsx')
    // Liste renseignée : préfixe traduit séparément ; vide : mention explicite traduite.
    assert.match(tsx, /\{t\('Allergènes :'\)\} \{p\.allergenes\.join\(', '\)\}/)
    assert.match(tsx, /\{t\(LIBELLE_ALLERGENES_ABSENTS\)\}/)
    // L'ancienne forme conditionnelle (ligne absente quand la liste est vide) a disparu,
    // comme la forme t(libelleAllergenes(p)) qui faisait retomber le préfixe en français en anglais.
    assert.ok(!tsx.includes("{p.allergenes.length > 0 && <p"), 'ligne allergènes conditionnelle encore présente')
    assert.ok(!tsx.includes('t(libelleAllergenes(p))'), 'libellé complet non traduisible encore présent')
    assert.equal(traduire('Allergènes :', 'en'), 'Allergens:')
    // Le pied de page général reste affiché.
    assert.match(tsx, /Allergènes : demandez conseil à l’équipe en cas de doute\./)
  })

  test('#/menuCarte : les 14 allergènes UE sont saisissables par cases à cocher, plat par plat', () => {
    const tsx = source('src/pages/MenuCarte.tsx')
    assert.match(tsx, /ALLERGENES\.map\(\(a\) =>/)
    assert.match(tsx, /type="checkbox"/)
    assert.match(tsx, /maj\('allergenes'/)
    assert.match(tsx, /Allergènes \(\{\s*produit\.allergenes\.length\s*\}\)/)
    assert.match(tsx, /Colonnes : categorie ; nom ; prix.*allergenes \(séparés par \|\)/)
  })
})

// P1-B1 — Import / export CSV du menu, limite relevée à 120 produits, sauvegarde de l'ancien menu
// (docs/menu-39-plats-avant-import-2026-11-10.csv) et sauvegarde automatique avant remplacement dans #/menuCarte.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { menuReelAsianHome } from '../src/data/menu-reel.ts'
import { ID_ASIAN_HOME } from '../src/lib/visuels.ts'
import { ErreurMenu, LIMITES_MENU, compterPlats, menuDepuisCsv, menuEnCsv, nomFichierMenuCsv, validerMenu } from '../src/lib/menu.ts'
import type { Menu } from '../src/types.ts'

const MAINTENANT = new Date('2026-11-10T12:00:00Z')
const ENTETE = 'categorie;nom;prix;description;photo;allergenes'
const importer = (texte: string) => menuDepuisCsv(texte, ID_ASIAN_HOME, MAINTENANT)
/** Contenu comparable d'un menu : sans ids (le CSV n'en porte pas) ni date. */
const contenu = (m: Pick<Menu, 'categories'>) => m.categories.map((c) => ({ nom: c.nom, produits: c.produits.map(({ id: _id, ...p }) => p) }))
const unPlat = (ligne: string) => importer(`${ENTETE}\n${ligne}\n`).categories[0].produits[0]
const menuDe = (n: number) => ({
  categories: Array.from({ length: Math.ceil(n / 10) }, (_, i) => ({
    nom: `Cat ${i + 1}`,
    produits: Array.from({ length: Math.min(10, n - i * 10) }, (_, j) => ({ nom: `Plat ${i * 10 + j + 1}`, prix: 650, allergenes: [] })),
  })),
})

describe('Export CSV du menu (menuEnCsv)', () => {
  test('format à la française : BOM, séparateur ;, CRLF, prix « 6,50 », allergènes séparés par |', () => {
    const csv = menuEnCsv({
      categories: [
        { id: 'c', nom: 'Entrées', produits: [{ id: 'p', nom: 'Nems', prix: 650, description: 'Croustillants; maison', photo: 'https://x/n.jpg', allergenes: ['Gluten', 'Soja'] }] },
        { id: 'd', nom: 'Hors carte', produits: [{ id: 'q', nom: 'Bœuf Basilic', prix: null, allergenes: [] }] },
      ],
    })
    assert.equal(csv, '﻿' + ENTETE + '\r\nEntrées;Nems;6,50;"Croustillants; maison";https://x/n.jpg;Gluten|Soja\r\nHors carte;Bœuf Basilic;;;;\r\n')
  })

  test('injection de formules neutralisée à l’export (comme celluleCsv), restaurée à l’import', () => {
    const menu = { categories: [{ id: 'c', nom: '=cmd|calc', produits: [{ id: 'p', nom: '@SOMME(A1)', prix: 100, description: '-2+3', allergenes: [] }] }] }
    const csv = menuEnCsv(menu)
    assert.match(csv, /\r\n'=cmd\|calc;'@SOMME\(A1\);1,00;'-2\+3;;\r\n/)
    assert.ok(!/(^|;|\n)[=@-]/.test(csv.replace(/^﻿/, '')))
    assert.deepEqual(contenu(importer(csv)), contenu(validerMenu(menu, ID_ASIAN_HOME, MAINTENANT)))
  })

  test('aller-retour exact sur la carte officielle (81 plats) : export → import → même menu', () => {
    const officiel = validerMenu(menuReelAsianHome(), ID_ASIAN_HOME, MAINTENANT)
    const relu = importer(menuEnCsv(officiel))
    assert.equal(compterPlats(relu), 81)
    assert.equal(relu.categories.length, 16)
    assert.equal(relu.commerceId, ID_ASIAN_HOME)
    assert.deepEqual(contenu(relu), contenu(officiel))
    // Et un second aller-retour ne change plus rien (ids compris).
    assert.deepEqual(importer(menuEnCsv(relu)), relu)
  })

  test('nom de fichier daté : menu-avant-remplacement-AAAA-MM-JJ.csv', () => {
    assert.equal(nomFichierMenuCsv(new Date(2026, 10, 10, 9, 5)), 'menu-avant-remplacement-2026-11-10.csv')
    assert.equal(nomFichierMenuCsv(new Date(2027, 0, 3)), 'menu-avant-remplacement-2027-01-03.csv')
  })
})

describe('Import CSV du menu (menuDepuisCsv)', () => {
  test('prix « 6,50 », « 6.50 », « 6 », « 6,5 », « 6,50 € » et « 100,00 » acceptés ; vide = prix null', () => {
    assert.equal(unPlat('E;N;6,50;;;').prix, 650)
    assert.equal(unPlat('E;N;6.50;;;').prix, 650)
    assert.equal(unPlat('E;N;6;;;').prix, 600)
    assert.equal(unPlat('E;N;6,5;;;').prix, 650)
    assert.equal(unPlat('E;N;6,50 €;;;').prix, 650)
    assert.equal(unPlat('E;N;100,00;;;').prix, 10000)
    assert.equal(unPlat('E;N;10000;;;').prix, 1_000_000)
    assert.equal(unPlat('E;N;;;;').prix, null)
    assert.equal(unPlat('E;N;0;;;').prix, 0)
  })

  test('guillemets doublés, retours à la ligne et ; dans un champ guillemeté ; lignes vides ignorées ; colonnes manquantes tolérées', () => {
    const m = importer(`\n${ENTETE}\r\n\r\nEntrées;"Nems ""maison""";6,90;"Ligne 1\nLigne 2; suite";;\r\n;;;;;\r\nEntrées;Gyoza;;;;\r\n`)
    assert.equal(compterPlats(m), 2)
    assert.equal(m.categories[0].produits[0].nom, 'Nems "maison"')
    assert.equal(m.categories[0].produits[0].description, 'Ligne 1\nLigne 2; suite')
    const court = importer('nom;categorie\nNems;Entrées\n')
    assert.deepEqual(contenu(court), [{ nom: 'Entrées', produits: [{ nom: 'Nems', prix: null, allergenes: [] }] }])
  })

  test('catégories regroupées dans l’ordre d’apparition', () => {
    const m = importer(`${ENTETE}\nA;a1;1;;;\nB;b1;1;;;\nA;a2;1;;;\n`)
    assert.deepEqual(m.categories.map((c) => [c.nom, c.produits.map((p) => p.nom)]), [['A', ['a1', 'a2']], ['B', ['b1']]])
  })

  test('allergènes séparés par |, insensibles à la casse et aux accents, normalisés', () => {
    assert.deepEqual(unPlat('E;N;1;;;soja | gluten|œufs').allergenes, ['Gluten', 'Œufs', 'Soja'])
    assert.deepEqual(unPlat('E;N;1;;;crustaces|Sésame').allergenes, ['Crustacés', 'Sésame'])
  })

  test('fichier Excel en virgules (aucun ;) accepté, champs guillemetés compris', () => {
    const m = importer('categorie,nom,prix,description,photo,allergenes\r\nEntrées,Nems,"6,90","Poulet, menthe",,Gluten\r\nEntrées,Gyoza,6.90,,,\r\n')
    assert.deepEqual(contenu(m), [
      {
        nom: 'Entrées',
        produits: [
          { nom: 'Nems', prix: 690, description: 'Poulet, menthe', allergenes: ['Gluten'] },
          { nom: 'Gyoza', prix: 690, allergenes: [] },
        ],
      },
    ])
  })

  test('ligne erronée → ErreurMenu avec le numéro de ligne (en-tête = ligne 1)', () => {
    const erreur = (ligneFautive: string, motif: RegExp) =>
      assert.throws(() => importer(`${ENTETE}\nEntrées;Nems;6,90;;;\n${ligneFautive}\n`), (e: unknown) => e instanceof ErreurMenu && /^Ligne 3 : /.test(e.message) && motif.test(e.message))
    erreur('Entrées;Gyoza;6,90;;;Cacahuète', /allergène inconnu « Cacahuète »/)
    erreur('Entrées;Gyoza;-1;;;', /prix « -1 » invalide/)
    erreur('Entrées;Gyoza;abc;;;', /prix « abc » invalide/)
    erreur('Entrées;;6,90;;;', /nom du plat est obligatoire/)
    erreur(';Gyoza;6,90;;;', /catégorie est obligatoire/)
    erreur('Entrées;Gyoza;10000,01;;;', /10 000 € maximum/)
    erreur('Entrées;Gyoza;6,90;;javascript:alert(1);', /photo/)
    erreur(`Entrées;${'x'.repeat(81)};6,90;;;`, /trop long/)
  })

  test('le numéro de ligne tient compte des retours à la ligne dans un champ guillemeté', () => {
    assert.throws(() => importer(`${ENTETE}\nE;N;1;"a\nb\nc";;\nE;M;abc;;;\n`), /Ligne 5 : prix « abc » invalide/)
  })

  test('en-tête absent, fichier vide ou guillemet non refermé → ErreurMenu explicite', () => {
    assert.throws(() => importer('Entrées;Nems;6,90;;;\n'), /Ligne 1 : en-tête attendu/)
    assert.throws(() => importer('\n\n'), /Fichier vide/)
    assert.throws(() => importer(`${ENTETE}\n`), /Aucun plat/)
    assert.throws(() => importer(`${ENTETE}\nE;"N;1;;;\n`), /Ligne 2 : guillemet/)
  })

  test('limites : 120 produits / 20 catégories, signalées à la ligne qui les dépasse', () => {
    const lignes = (n: number, cats = 1) => Array.from({ length: n }, (_, i) => `C${i % cats};P${i};1;;;`).join('\n')
    assert.equal(compterPlats(importer(`${ENTETE}\n${lignes(120)}\n`)), 120)
    assert.throws(() => importer(`${ENTETE}\n${lignes(121)}\n`), /Ligne 122 : 120 produits maximum/)
    assert.throws(() => importer(`${ENTETE}\n${lignes(21, 21)}\n`), /Ligne 22 : 20 catégories maximum/)
  })
})

describe('Limite du menu relevée à 120 produits (validation partagée front + serveur)', () => {
  test('LIMITES_MENU.produits = 120 : 81 et 120 plats acceptés, 121 refusés', () => {
    assert.equal(LIMITES_MENU.produits, 120)
    assert.equal(LIMITES_MENU.categories, 20)
    assert.equal(compterPlats(validerMenu(menuDe(81), ID_ASIAN_HOME, MAINTENANT)), 81)
    assert.equal(compterPlats(validerMenu(menuDe(120), ID_ASIAN_HOME, MAINTENANT)), 120)
    assert.throws(() => validerMenu(menuDe(121), ID_ASIAN_HOME, MAINTENANT), /120 produits maximum/)
  })
})

describe('Sauvegarde de l’ancien menu (docs/menu-39-plats-avant-import-2026-11-10.csv)', () => {
  const csv = readFileSync(new URL('../docs/menu-39-plats-avant-import-2026-11-10.csv', import.meta.url), 'utf8')

  test('en-tête + 39 lignes de données, prix tous vides, relisible par l’import', () => {
    const lignes = csv.replace(/^﻿/, '').split('\r\n').filter(Boolean)
    assert.equal(lignes[0], ENTETE)
    assert.equal(lignes.length, 40)
    const ancien = importer(csv)
    assert.equal(compterPlats(ancien), 39)
    assert.equal(ancien.categories.length, 7)
    for (const c of ancien.categories) for (const p of c.produits) assert.equal(p.prix, null, p.nom)
    const noms = ancien.categories.flatMap((c) => c.produits.map((p) => p.nom))
    for (const nom of ['Duo Love Bao', '8 Maki Dragon', 'Cocktail Koh Samui', 'California par 6', 'Nemus au poulet x4']) assert.ok(noms.includes(nom), nom)
  })
})

describe('#/menuCarte : sauvegarde CSV avant remplacement, export, import (source)', () => {
  const source = readFileSync(new URL('../src/pages/MenuCarte.tsx', import.meta.url), 'utf8')

  test('le remplacement télécharge d’abord le menu actuel (si non vide), puis demande confirmation', () => {
    const remplacer = source.slice(source.indexOf('function remplacer('), source.indexOf('function appliquerRemplacement('))
    assert.ok(remplacer.includes('if (editeurNonVide)'))
    // P1-C7 : plus de window.confirm — la sauvegarde CSV part avant la modale <Confirmation>, le remplacement
    // (setCategories) n'a lieu que dans appliquerRemplacement(), appelé par le bouton de confirmation.
    assert.ok(remplacer.indexOf('telechargerMenuCsv(categories!)') < remplacer.indexOf('setRemplacement({'))
    assert.doesNotMatch(remplacer, /setCategories\(/)
    // Le `return` après setRemplacement est critique : sans lui, la branche non vide appliquerait le
    // remplacement immédiatement ; appliquerRemplacement n'est appelé que là (éditeur vide) et par la modale.
    assert.ok(remplacer.indexOf('setRemplacement({') < remplacer.indexOf('return'))
    assert.ok(remplacer.indexOf('return') < remplacer.indexOf('appliquerRemplacement(nouvelles)'))
    assert.equal(source.match(/appliquerRemplacement\(/g)?.length, 3, 'définition + 2 appels (éditeur vide, confirmation)')
    assert.doesNotMatch(source, /window\.confirm/)
    const appliquer = source.slice(source.indexOf('function appliquerRemplacement('), source.indexOf('const recapRemplacement'))
    assert.match(appliquer, /setCategories\(versEdition\(nouvelles\)\)/)
    assert.match(source, /onConfirmer=\{\(\) => appliquerRemplacement\(remplacement\.nouvelles\)\}/)
  })
  test('« Charger la carte officielle » et l’import CSV passent par remplacer() ; seul « Enregistrer » publie', () => {
    assert.match(source, /onClick=\{\(\) => remplacer\(menuReelAsianHome\(\)\.categories/)
    assert.match(source, /remplacer\(menu\.categories, /)
    assert.match(source, /Charger la carte officielle d’Asian Home \(\{COMPTE_PLATS_REELS\} plats, prix inclus\)/)
    assert.match(source, /accept="\.csv,text\/csv"/)
    assert.match(source, /⬇ Exporter le menu actuel \(CSV\)/)
    assert.match(source, /⬆ Importer un menu \(CSV\)/)
    assert.equal(source.match(/cli\.majMenu\(/g)?.length, 1)
    assert.match(source, /async function enregistrer\(\)[\s\S]*?cli\.majMenu\(/)
  })
  test('une erreur d’import est affichée sans toucher à l’éditeur', () => {
    const importer = source.slice(source.indexOf('async function importerCsv'))
    const bloc = importer.slice(0, importer.indexOf('remplacer('))
    assert.match(bloc, /catch \(e\) \{\s*setErreurCsv\(`Fichier non importé : \$\{messageErreur\(e\)\}`\)\s*return/)
    assert.ok(!bloc.includes('setCategories('))
  })
})

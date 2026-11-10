// P1-B2 — Photos des plats recadrées du PDF officiel de la carte (fiche + vignette WebP),
// champ photoVignette (validation, CSV photo_vignette, affichage) et plats volontairement sans photo.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'

import { menuReelAsianHome } from '../src/data/menu-reel.ts'
import { ID_ASIAN_HOME, PHOTOS_PDF, VISUELS } from '../src/lib/visuels.ts'
import { COLONNES_CSV_MENU, ErreurMenu, menuDepuisCsv, menuEnCsv, validerMenu } from '../src/lib/menu.ts'

const MAINTENANT = new Date('2026-11-10T12:00:00Z')
const URL_PDF = 'https://cdnm.heyzine.com/files/uploaded/64e5dc5d723c717e149bb6d08eb6fee86589eb69.pdf'
const POIDS_MAX = 150_000

const SLUGS: Record<string, string> = {
  'Poke Bowl': 'poke-bowl',
  Dynamite: 'dynamite',
  'Mi Prat': 'mi-prat',
  'Pad Thaï': 'pad-thai',
  'Crousti Poulet': 'crousti-poulet',
  'Khao Prat': 'khao-prat',
  'Curry Vert': 'curry-vert',
  'Tigre qui pleure': 'tigre-qui-pleure',
  'Bo Bun': 'bo-bun',
}
const FICHIERS = Object.values(SLUGS).flatMap((s) => [`menu-${s}.webp`, `menu-${s}-vignette.webp`])
const fichier = (nom: string) => new URL(`../public/visuels/${nom}`, import.meta.url)
const plats = () => menuReelAsianHome().categories.flatMap((c) => c.produits)
const categorie = (nom: string) => menuReelAsianHome().categories.find((c) => c.nom === nom)!

/** Dimensions d'un WebP (en-têtes VP8, VP8L ou VP8X) ; lève si ce n'est pas un WebP. */
function dimensionsWebp(b: Buffer): { largeur: number; hauteur: number } {
  assert.equal(b.toString('ascii', 0, 4), 'RIFF')
  assert.equal(b.toString('ascii', 8, 12), 'WEBP')
  const morceau = b.toString('ascii', 12, 16)
  if (morceau === 'VP8 ') {
    assert.deepEqual([...b.subarray(23, 26)], [0x9d, 0x01, 0x2a], 'code de début VP8')
    return { largeur: b.readUInt16LE(26) & 0x3fff, hauteur: b.readUInt16LE(28) & 0x3fff }
  }
  if (morceau === 'VP8L') {
    const bits = b.readUInt32LE(21)
    return { largeur: (bits & 0x3fff) + 1, hauteur: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (morceau === 'VP8X') return { largeur: b.readUIntLE(24, 3) + 1, hauteur: b.readUIntLE(27, 3) + 1 }
  throw new Error(`morceau WebP inconnu : ${morceau}`)
}

describe('Fichiers WebP livrés (public/visuels/menu-*.webp)', () => {
  for (const nom of FICHIERS) {
    const vignette = nom.endsWith('-vignette.webp')
    test(`${nom} : WebP, ${vignette ? '≤ 192' : '≤ 720'} px de large, ≤ 150 Ko`, () => {
      assert.ok(existsSync(fichier(nom)), `${nom} introuvable`)
      const b = readFileSync(fichier(nom))
      const { largeur, hauteur } = dimensionsWebp(b)
      assert.ok(largeur <= (vignette ? 192 : 720), `${nom} : ${largeur} px de large`)
      assert.ok(largeur >= 150 && hauteur >= 100, `${nom} : ${largeur}×${hauteur}, recadrage suspect`)
      assert.ok(b.length <= POIDS_MAX, `${nom} : ${b.length} octets`)
    })
  }
  test('les vignettes font 192 px de large et gardent les proportions de leur fiche', () => {
    for (const s of Object.values(SLUGS)) {
      const f = dimensionsWebp(readFileSync(fichier(`menu-${s}.webp`)))
      const v = dimensionsWebp(readFileSync(fichier(`menu-${s}-vignette.webp`)))
      assert.equal(v.largeur, 192, s)
      assert.ok(Math.abs(v.hauteur / v.largeur - f.hauteur / f.largeur) < 0.02, s)
    }
  })
  test('aucun autre menu-*.webp que les 18 attendus', () => {
    const presents = readdirSync(new URL('../public/visuels/', import.meta.url)).filter((f) => f.endsWith('.webp'))
    assert.deepEqual(presents.sort(), [...FICHIERS].sort())
  })
  test('le script d’extraction couvre exactement ces 9 plats', () => {
    const script = readFileSync(new URL('../scripts/extraire-photos-menu.py', import.meta.url), 'utf8')
    const cadres = script.slice(script.indexOf('CADRES = {'), script.indexOf('}', script.indexOf('CADRES = {')))
    assert.deepEqual([...cadres.matchAll(/'([a-z-]+)': \(/g)].map((m) => m[1]).sort(), Object.values(SLUGS).sort())
    assert.ok(existsSync(new URL('../assets/source/menu.pdf', import.meta.url)), 'assets/source/menu.pdf')
    assert.ok(existsSync(new URL('../assets/source/photos/README.md', import.meta.url)))
  })
})

describe('Rattachements dans la carte officielle (menuReelAsianHome)', () => {
  for (const [nom, slug] of Object.entries(SLUGS)) {
    test(`${nom} → menu-${slug}.webp + vignette`, () => {
      const p = plats().find((x) => x.nom === nom)
      assert.ok(p, nom)
      assert.equal(p.photo, `/visuels/menu-${slug}.webp`)
      assert.equal(p.photoVignette, `/visuels/menu-${slug}-vignette.webp`)
    })
  }
  test('PHOTOS_PDF = exactement les 9 rattachements', () => {
    assert.deepEqual(
      Object.values(PHOTOS_PDF).map((x) => x.photo).sort(),
      Object.values(SLUGS).map((s) => `/visuels/menu-${s}.webp`).sort(),
    )
  })
  test('Loc Lac, Mango Stick et les 2 makis gardent leur photo existante, sans vignette', () => {
    const de = (nom: string) => plats().find((x) => x.nom === nom)!
    assert.equal(de('Loc Lac').photo, VISUELS.menuLocLac)
    assert.equal(de('Mango Stick').photo, VISUELS.menuMangoStickyRice)
    assert.equal(de('8 Maki Tiger').photo, VISUELS.menuMakis)
    assert.equal(de('8 Maki Chicken Dragon').photo, VISUELS.menuMakis)
    for (const nom of ['Loc Lac', 'Mango Stick', '8 Maki Tiger', '8 Maki Chicken Dragon']) assert.equal(de(nom).photoVignette, undefined, nom)
  })
  test('sans photo : Love Bao, 6 Maki Gold, Tiramisu, boissons, variantes makis / california / sashimi / sushi', () => {
    for (const nom of ['Love Bao', '6 Maki Gold', 'Tiramisu']) {
      const p = plats().find((x) => x.nom === nom)!
      assert.equal(p.photo, undefined, nom)
      assert.equal(p.photoVignette, undefined, nom)
    }
    for (const cat of ['California x6 — option Crispy +0,50 €', 'Maki Green x6', 'Maki Black x6', 'Maki Neige x6', 'Maki Pink x6', 'Sashimi', 'Sushi x2', 'Boissons']) {
      for (const p of categorie(cat).produits) assert.ok(!p.photo && !p.photoVignette, `${cat} / ${p.nom}`)
    }
  })
  test('aucune vignette sans photo, et une vignette n’est jamais celle d’un autre plat', () => {
    for (const p of plats()) {
      if (!p.photoVignette) continue
      assert.ok(p.photo, p.nom)
      assert.equal(p.photoVignette, p.photo!.replace(/\.webp$/, '-vignette.webp'), p.nom)
    }
  })
  test('menu-nouilles-crevettes.jpg n’est plus référencée par le code (fichier gardé, non rattaché)', () => {
    assert.ok(existsSync(fichier('menu-nouilles-crevettes.jpg')))
    for (const src of ['../src/data/menu-reel.ts', '../src/pages/MenuPublic.tsx', '../src/pages/MenuCarte.tsx']) {
      assert.ok(!readFileSync(new URL(src, import.meta.url), 'utf8').includes("'/visuels/menu-nouilles-crevettes.jpg'"), src)
    }
    assert.ok(!/identification probable/i.test(readFileSync(new URL('../src/lib/visuels.ts', import.meta.url), 'utf8')))
  })
})

describe('photoVignette : validation partagée (validerMenu)', () => {
  const menuAvec = (produit: Record<string, unknown>) => ({ categories: [{ nom: 'E', produits: [{ nom: 'N', prix: 100, allergenes: [], ...produit }] }] })
  const valider = (produit: Record<string, unknown>) => validerMenu(menuAvec(produit), ID_ASIAN_HOME, MAINTENANT).categories[0].produits[0]

  test('visuel local WebP, https et image compressée acceptés ; vide = pas de vignette', () => {
    assert.equal(valider({ photo: '/visuels/menu-dynamite.webp', photoVignette: '/visuels/menu-dynamite-vignette.webp' }).photoVignette, '/visuels/menu-dynamite-vignette.webp')
    assert.equal(valider({ photoVignette: 'https://exemple.fr/v.webp' }).photoVignette, 'https://exemple.fr/v.webp')
    assert.equal(valider({ photoVignette: 'data:image/webp;base64,UklGRg==' }).photoVignette, 'data:image/webp;base64,UklGRg==')
    assert.ok(!('photoVignette' in valider({ photoVignette: '  ' })))
    assert.ok(!('photoVignette' in valider({})))
  })
  test('adresse invalide, chemin hors /visuels/, type non texte ou image trop lourde → ErreurMenu', () => {
    const refus = (photoVignette: unknown, motif: RegExp) =>
      assert.throws(() => valider({ photoVignette }), (e: unknown) => e instanceof ErreurMenu && motif.test(e.message))
    refus('javascript:alert(1)', /vignette/)
    refus('http://exemple.fr/v.webp', /vignette/)
    refus('/autre/v.webp', /vignette/)
    refus('/visuels/../secret.webp', /vignette/)
    refus(42, /vignette/)
    refus(`data:image/jpeg;base64,${'A'.repeat(83_000)}`, /vignette/)
  })
  test('la carte officielle passe la validation serveur avec ses vignettes intactes', () => {
    const m = validerMenu(menuReelAsianHome(), ID_ASIAN_HOME, MAINTENANT)
    assert.equal(m.categories.flatMap((c) => c.produits).filter((p) => p.photoVignette).length, 9)
  })
})

describe('CSV : colonne optionnelle photo_vignette', () => {
  const importer = (texte: string) => menuDepuisCsv(texte, ID_ASIAN_HOME, MAINTENANT)
  const sansIds = (m: { categories: { nom: string; produits: { id: string }[] }[] }) =>
    m.categories.map((c) => ({ nom: c.nom, produits: c.produits.map(({ id: _id, ...p }) => p) }))

  test('menu sans vignette : export identique au format B1 (pas de colonne photo_vignette)', () => {
    const csv = menuEnCsv({ categories: [{ id: 'c', nom: 'E', produits: [{ id: 'p', nom: 'N', prix: 650, photo: '/visuels/menu-loc-lac.jpg', allergenes: [] }] }] })
    assert.equal(csv, '﻿' + COLONNES_CSV_MENU.join(';') + '\r\nE;N;6,50;;/visuels/menu-loc-lac.jpg;\r\n')
  })
  test('menu avec vignettes : colonne photo_vignette en dernier ; export → import → deepEqual', () => {
    const menu = {
      categories: [
        {
          id: 'c',
          nom: 'Plats thaï',
          produits: [
            { id: 'p1', nom: 'Bo Bun', prix: 1390, photo: '/visuels/menu-bo-bun.webp', photoVignette: '/visuels/menu-bo-bun-vignette.webp', allergenes: ['Gluten'] },
            { id: 'p2', nom: 'Loc Lac', prix: 1490, photo: '/visuels/menu-loc-lac.jpg', allergenes: [] },
          ],
        },
      ],
    }
    const csv = menuEnCsv(menu)
    assert.ok(csv.startsWith('﻿categorie;nom;prix;description;photo;allergenes;photo_vignette\r\n'))
    assert.match(csv, /\r\nPlats thaï;Bo Bun;13,90;;\/visuels\/menu-bo-bun\.webp;Gluten;\/visuels\/menu-bo-bun-vignette\.webp\r\n/)
    assert.match(csv, /\r\nPlats thaï;Loc Lac;14,90;;\/visuels\/menu-loc-lac\.jpg;;\r\n/)
    const relu = importer(csv)
    assert.deepEqual(sansIds(relu), sansIds(validerMenu(menu, ID_ASIAN_HOME, MAINTENANT)))
    assert.deepEqual(importer(menuEnCsv(relu)), relu)
  })
  test('carte officielle : aller-retour CSV exact, les 9 vignettes comprises', () => {
    const officiel = validerMenu(menuReelAsianHome(), ID_ASIAN_HOME, MAINTENANT)
    const relu = importer(menuEnCsv(officiel))
    assert.deepEqual(sansIds(relu), sansIds(officiel))
    assert.equal(relu.categories.flatMap((c) => c.produits).filter((p) => p.photoVignette).length, 9)
  })
  test('ancien CSV (sans la colonne) toujours accepté : pas de vignette ; colonne lue quel que soit son rang', () => {
    const ancien = importer(`${COLONNES_CSV_MENU.join(';')}\nE;N;1;;/visuels/menu-loc-lac.jpg;\n`)
    assert.ok(!('photoVignette' in ancien.categories[0].produits[0]))
    const ailleurs = importer('photo_vignette;categorie;nom\n/visuels/menu-dynamite-vignette.webp;E;N\n')
    assert.equal(ailleurs.categories[0].produits[0].photoVignette, '/visuels/menu-dynamite-vignette.webp')
  })
  test('vignette invalide → ErreurMenu avec le numéro de ligne', () => {
    assert.throws(() => importer(`${COLONNES_CSV_MENU.join(';')};photo_vignette\nE;N;1;;;;\nE;M;1;;;;javascript:alert(1)\n`), /Ligne 3 : « M » : vignette = /)
  })
})

describe('Affichage (source) : vignette dans la liste, photo dans la fiche', () => {
  const publicTsx = readFileSync(new URL('../src/pages/MenuPublic.tsx', import.meta.url), 'utf8')
  const carteTsx = readFileSync(new URL('../src/pages/MenuCarte.tsx', import.meta.url), 'utf8')

  test('#/menu : liste → photoVignette ?? photo ; fiche dépliée → photo', () => {
    assert.match(publicTsx, /<img src=\{p\.photoVignette \?\? p\.photo\} alt="" loading="lazy" className="h-16 w-16/)
    assert.match(publicTsx, /<img src=\{p\.photo\} alt=\{`Photo du plat : \$\{p\.nom\}`\}/)
  })
  test('#/menuCarte : champ vignette optionnel ; changer ou retirer la photo efface la vignette', () => {
    assert.match(carteTsx, /Vignette \(optionnelle — sinon la photo est utilisée\)/)
    assert.match(carteTsx, /const majPhoto = \(photo: string \| undefined\) => onChange\(\{ \.\.\.produit, photo, photoVignette: undefined \}\)/)
    assert.ok(!/maj\('photo'/.test(carteTsx), 'toute modification de photo passe par majPhoto')
  })
})

describe('Sources documentées (public/visuels/SOURCES.md)', () => {
  const sources = readFileSync(new URL('../public/visuels/SOURCES.md', import.meta.url), 'utf8')
  test('URL du PDF, chaque fichier livré, les plats écartés et la règle « aucune photo client Google »', () => {
    assert.ok(sources.includes(URL_PDF))
    for (const nom of FICHIERS) assert.ok(sources.includes(`\`${nom}\``), nom)
    for (const mot of ['Love Bao', 'Tiramisu', 'Maki Tiger', 'Boissons', 'menu-nouilles-crevettes.jpg', 'scripts/extraire-photos-menu.py']) assert.ok(sources.includes(mot), mot)
    assert.match(sources, /aucune photo prise par des clients sur Google/i)
  })
})

// Version finale (15/11/2026) : photos d'illustration des 70 plats sans vraie photo, étiquetées « Photo d’illustration »
// dans #/menu (MenuPublic.tsx) et #/commande (Commande.tsx). La vraie photo gagne toujours ; champ séparé
// (`illustration`), jamais `photo` ; rail Signatures, plat-star et héros de catégorie restent aux vraies photos.
// Source des plats : menuReelAsianHome() (carte officielle, 81 plats, 11 vraies photos) — docs/menu-reel.json est
// l'ancien menu de 39 plats, sans ids, il ne peut pas servir de référence.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { avecIllustrations, ILLUSTRATIONS, masquerPrixNonConfirmes, menuReelAsianHome, retirerPhotosDetachees } from '../src/data/menu-reel.ts'
import { traduire } from '../src/lib/langue.ts'
import { validerMenu } from '../src/lib/menu.ts'
import { platStar } from '../src/lib/platStar.ts'
import { suggestionApres } from '../src/lib/panier.ts'
import { ID_ASIAN_HOME } from '../src/lib/visuels.ts'
import type { Menu, Produit } from '../src/types.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')
const DOSSIER = join(RACINE, 'public/visuels/illustrations')
const plats = (m: Menu = menuReelAsianHome()) => m.categories.flatMap((c) => c.produits)
const menuDe = (...produits: Produit[]): Menu => ({ commerceId: 'x', majLe: '', categories: [{ id: 'c', nom: 'C', produits }] })
const plat = (nom: string, extra: Partial<Produit> = {}): Produit => ({ id: nom, nom, prix: 100, allergenes: [], ...extra })

describe('Données : table ILLUSTRATIONS complète, fichiers présents et légers', () => {
  test('70 entrées : exactement les plats sans photo de la carte officielle, ids repris tels quels', () => {
    const sans = plats().filter((p) => !p.photo)
    assert.equal(sans.length, 70)
    assert.equal(Object.keys(ILLUSTRATIONS).length, 70)
    for (const p of sans) assert.equal(ILLUSTRATIONS[p.nom], p.id, p.nom)
  })

  test('aucun des 11 plats photographiés n’a d’entrée', () => {
    const avec = plats().filter((p) => p.photo)
    assert.equal(avec.length, 11)
    for (const p of avec) assert.ok(!Object.hasOwn(ILLUSTRATIONS, p.nom), p.nom)
  })

  test('fiche (≤ 120 000 o) et vignette (≤ 40 000 o) présentes pour chaque entrée ; aucun fichier orphelin', () => {
    for (const id of Object.values(ILLUSTRATIONS)) {
      const fiche = join(DOSSIER, `${id}.webp`)
      const vignette = join(DOSSIER, `${id}-vignette.webp`)
      assert.ok(existsSync(fiche) && existsSync(vignette), id)
      assert.ok(statSync(fiche).size <= 120_000, `${id} : ${statSync(fiche).size} o`)
      assert.ok(statSync(vignette).size <= 40_000, `${id}-vignette : ${statSync(vignette).size} o`)
    }
    assert.equal(readdirSync(DOSSIER).length, 140)
  })
})

describe('avecIllustrations : pure, la vraie photo gagne toujours', () => {
  test('plat sans photo → les deux chemins attendus', () => {
    const [p] = plats(avecIllustrations(menuDe(plat('Tiramisu'))))
    assert.equal(p.illustration, '/visuels/illustrations/reel-c6-p2.webp')
    assert.equal(p.illustrationVignette, '/visuels/illustrations/reel-c6-p2-vignette.webp')
    assert.equal(p.photo, undefined)
  })

  test('vraie photo jamais écrasée : même nom qu’une entrée, aucun champ illustration posé', () => {
    const [p] = plats(avecIllustrations(menuDe(plat('Tiramisu', { photo: 'https://exemple.fr/t.jpg' }))))
    assert.equal(p.photo, 'https://exemple.fr/t.jpg')
    assert.ok(!('illustration' in p) && !('illustrationVignette' in p))
    for (const q of plats(avecIllustrations(menuReelAsianHome()))) if (q.photo) assert.ok(!('illustration' in q), q.nom)
  })

  test('plat inconnu (ou clé héritée d’Object) inchangé, même objet', () => {
    const inconnu = plat('Plat du commerçant')
    const proto = plat('toString')
    const [a, b] = plats(avecIllustrations(menuDe(inconnu, proto)))
    assert.equal(a, inconnu)
    assert.equal(b, proto)
  })

  test('entrée non mutée', () => {
    const entree = menuReelAsianHome()
    const copie = structuredClone(entree)
    const sortie = avecIllustrations(entree)
    assert.deepEqual(entree, copie)
    assert.notEqual(sortie, entree)
    assert.equal(plats(sortie).filter((p) => p.illustration).length, 70)
  })

  test('les 11 vraies photos et leurs rattachements strictement inchangés après la chaîne complète', () => {
    const avant = plats().filter((p) => p.photo).map((p) => [p.nom, p.photo, p.photoVignette])
    const apres = plats(avecIllustrations(retirerPhotosDetachees(masquerPrixNonConfirmes(menuReelAsianHome())))).filter((p) => p.photo).map((p) => [p.nom, p.photo, p.photoVignette])
    assert.deepEqual(apres, avant)
  })

  test('le serveur ne voit jamais ces champs : validerMenu les retire', () => {
    const m = validerMenu(avecIllustrations(menuReelAsianHome()), ID_ASIAN_HOME, new Date('2026-11-15T12:00:00Z'))
    for (const p of plats(m)) assert.ok(!('illustration' in p) && !('illustrationVignette' in p), p.nom)
  })
})

describe('Par construction : plat-star et suggestion de la fiche restent aux vraies photos', () => {
  const illustre = avecIllustrations(menuReelAsianHome())

  test('platStar ne choisit jamais un plat illustré', () => {
    for (const c of illustre.categories) {
      const star = platStar(c)
      if (star) assert.ok(star.photo && !star.illustration, `${c.nom} : ${star.nom}`)
    }
    // Catégorie entièrement illustrée : pas de plat-star.
    assert.equal(platStar(illustre.categories.find((c) => c.nom === 'Boissons')!), null)
  })

  test('suggestionApres (fiche commande) ne propose jamais un plat illustré', () => {
    const tous = plats(illustre)
    for (const p of tous) {
      const s = suggestionApres(tous, p)
      if (s) assert.ok(s.photo && !s.illustration, `${p.nom} → ${s.nom}`)
    }
  })
})

describe('Câblage (source) : MenuPublic.tsx', () => {
  const menu = lire('src/pages/MenuPublic.tsx')

  test('avecIllustrations par-dessus masquage des prix et retrait des photos détachées', () => {
    assert.match(menu, /avecIllustrations\(retirerPhotosDetachees\(masquerPrixNonConfirmes\(repliReel \? menuReelAsianHome\(\) : menu\)\)\)/)
  })

  test('ligne typo réservée aux plats sans photo NI illustration ; en-tête de carte : photo, sinon illustration', () => {
    assert.match(menu, /if \(!p\.photo && !p\.illustration\)/)
    assert.match(menu, /\{\(p\.photo \|\| p\.illustration\) && \(/)
    assert.match(menu, /\{p\.photo \? \(\s*<img src=\{photoCartePlat\(p\)\}[^>]*\/>\s*\) : \(\s*<img src=\{p\.illustration\} alt="" loading="lazy" className="h-44 w-full object-cover" \/>\s*\)\}/)
    assert.match(menu, /src=\{p\.photoVignette \?\? p\.photo \?\? p\.illustrationVignette\}/)
  })

  test('pastille liée à illustration (en-tête + fiche), jamais sur une vraie photo ; mention complète en fiche ; pied de menu', () => {
    assert.equal(menu.match(/\{!p\.photo && p\.illustration && <PastilleIllustration \/>\}/g)?.length, 1)
    assert.match(menu, /\{!p\.photo && p\.illustration && \(\s*<div className="relative">\s*<img src=\{p\.illustration\}[^>]*\/>\s*<PastilleIllustration \/>/)
    assert.equal(menu.match(/<PastilleIllustration \/>/g)?.length, 2)
    assert.match(menu, /<span className="absolute top-3 left-3 rounded-full bg-magenta-500 [^"]*text-white">\{t\('Photo d’illustration'\)\}<\/span>/)
    assert.match(menu, /\{!p\.photo && p\.illustration && <p [^>]*>\{t\('Cette image évoque le plat ; la présentation servie peut différer\.'\)\}<\/p>\}/)
    assert.match(menu, /\{avecIllustration && <p className="text-center text-sm text-gray-600">\{t\('Les images marquées « Photo d’illustration » évoquent les plats ; la présentation servie peut différer\.'\)\}<\/p>\}/)
  })

  test('rail Signatures, plat-star et héros de catégorie : filtres inchangés (vraies photos)', () => {
    assert.match(menu, /c\.produits\.filter\(\(p\) => p\.photo\)\.map\(\(p\) => \(\{ categorieId: c\.id, p \}\)\)/)
    assert.match(menu, /const photo = photoCategorie\(c\.nom\)/)
    assert.match(lire('src/lib/platStar.ts'), /categorie\.produits\.filter\(\(p\) => p\.photo && photoEligibleStar\(p\.photo\)\)/)
  })
})

describe('Câblage (source) : Commande.tsx', () => {
  const page = lire('src/pages/Commande.tsx')

  test('avecIllustrations par-dessus la chaîne ; rail Signatures toujours sur p.photo', () => {
    assert.match(page, /avecIllustrations\(retirerPhotosDetachees\(masquerPrixNonConfirmes\(donnees\.menu\)\)\)/)
    assert.match(page, /const signatures = useMemo\(\(\) => plats\.filter\(\(p\) => p\.photo && estCommandable\(p\)\), \[plats\]\)/)
  })

  test('ligne : vignette d’illustration + étiquette sous le nom ; fiche : image + pastille + mention complète', () => {
    assert.match(page, /const vignette = p\.photoVignette \?\? p\.photo \?\? p\.illustrationVignette/)
    assert.match(page, /\{!p\.photo && p\.illustration && <PastilleIllustration ligne \/>\}/)
    assert.match(page, /\{!p\.photo && p\.illustration && \(\s*<div className="relative">\s*<img src=\{p\.illustration\}[^>]*className="h-60 w-full object-cover" \/>\s*<PastilleIllustration \/>/)
    assert.match(page, /\{!p\.photo && p\.illustration && <p [^>]*>\{t\('Cette image évoque le plat ; la présentation servie peut différer\.'\)\}<\/p>\}/)
    assert.match(page, /rounded-full bg-magenta-500 [^`]*text-white`\}>\{t\('Photo d’illustration'\)\}<\/span>/)
  })
})

describe('Textes : traductions centrales, aucun chiffre marketing', () => {
  test('les 3 clés au dictionnaire central, traduites en anglais', () => {
    assert.equal(traduire('Photo d’illustration', 'en'), 'Illustration photo')
    assert.equal(traduire('Cette image évoque le plat ; la présentation servie peut différer.', 'en'), 'This image evokes the dish; the served presentation may differ.')
    assert.equal(
      traduire('Les images marquées « Photo d’illustration » évoquent les plats ; la présentation servie peut différer.', 'en'),
      'Images marked “Illustration photo” evoke the dishes; the served presentation may differ.',
    )
  })

  test('aucun littéral « 81 photos » dans les sources', () => {
    const fichiers = (dossier: string): string[] =>
      readdirSync(join(RACINE, dossier), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? fichiers(join(dossier, e.name)) : [join(dossier, e.name)]))
    for (const f of [...fichiers('src'), 'index.html']) assert.doesNotMatch(lire(f), /81\s+photos/i, f)
  })
})

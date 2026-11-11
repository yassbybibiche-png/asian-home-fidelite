// Carte officielle d'Asian Home Paris (relevée le 10/11/2026) + interactivité du menu public + DA sombre :
// contenu exact (16 catégories, 81 plats, prix officiels au centime près, 3 plats hors carte sans prix),
// photos rattachées aux bons plats, recherche/filtres, contrastes ≥ 4,5:1 des paires texte/fond utilisées.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'

import { COMPTE_CATEGORIES_REELLES, COMPTE_PLATS_REELS, PLATS_SIGNATURE, PRIX_A_CONFIRMER, estSignature, masquerPrixNonConfirmes, menuReelAsianHome } from '../src/data/menu-reel.ts'
import { ID_ASIAN_HOME, VISUELS, photoCategorie } from '../src/lib/visuels.ts'
import { LIBELLE_PRIX_ABSENT, bandeauPrixManquants, compterPlats, correspondPlat, filtrerMenu, validerMenu, ErreurMenu } from '../src/lib/menu.ts'
import { formaterPrix } from '../src/lib/points.ts'

// Retapé depuis la carte officielle (brief P1-B1), indépendamment de src/data/menu-reel.ts : [nom, prix en centimes].
const CARTE: [string, [string, number | null][]][] = [
  ['Salades & accompagnements', [['Choux', 250], ['Edamame', 400], ['Wakame', 400], ['Soupe Miso', 250], ['Riz Nature', 250], ['Riz Thaï', null]]],
  [
    'California x6 — option Crispy +0,50 €',
    [
      ['California Saumon Avocat', 650],
      ['California Saumon Cheese', 650],
      ['California Thon Cuit Mayo Avocat Concombre', 650],
      ['California Poulet Avocat', 650],
      ['California Veggie Avocat Concombre', 650],
      ['California Crevettes Tempura Avocat', 650],
      ['California Foie Gras Figue Amande', 700],
    ],
  ],
  [
    'Maki Green x6',
    [
      ['Maki Green Saumon Avocat Menthe Coriandre', 690],
      ['Maki Green Thon Avocat Menthe Coriandre', 690],
      ['Maki Green Saumon Cheese', 690],
      ['Maki Green Avocat Cheese', 690],
      ['Maki Green Tempura Avocat Mayo Menthe Coriandre', 690],
      ['Maki Green Crevettes Tempura Avocat Sauce Curry', 690],
    ],
  ],
  [
    'Maki Black x6',
    [['Maki Black Saumon', 600], ['Maki Black Avocat', 600], ['Maki Black Thon', 600], ['Maki Black Cheese', 600], ['Maki Black Saumon Cheese', 600], ['Maki Black Concombre', 600]],
  ],
  ['Maki Neige x6', [['Maki Neige Saumon Cheese', 650], ['Maki Neige Saumon Avocat', 650], ['Maki Neige Avocat Cheese', 650], ['Maki Neige Thon Cuit Avocat Mayo', 650]]],
  [
    'Maki Pink x6',
    [['Maki Pink Cheese', 690], ['Maki Pink Avocat Cheese', 690], ['Maki Pink Concombre Cheese', 690], ['Maki Pink Saumon Mi-Cuit Cheese Oignon Frit', 690], ['Maki Pink Avocat Cheese Tomate Séchée', 690]],
  ],
  ['Sashimi', [['Sashimi Saumon 6 pièces', 700], ['Sashimi Saumon 12 pièces', 1390], ['Sashimi Thon 6 pièces', 800], ['Sashimi Thon 12 pièces', 1450]]],
  ['Sushi x2', [['Sushi Saumon x2', 450], ['Sushi Thon x2', 450], ['Sushi Saumon Avocat x2', 450], ['Sushi Saumon Mi-Cuit x2', 450]]],
  ['Poke Bowl', [['Poke Bowl', 1450]]],
  [
    'Entrées thaï',
    [
      ['Gyoza Crevette ou Légume x4', 690],
      ['Nems au Poulet x4', 690],
      ['Crevettes Tempura x4', 690],
      ['Bœuf au Fromage Fait Maison x2', 490],
      ['Boulettes de Poulet Fait Maison x2', 490],
      ['Brochette de Poulet Fait Maison x2', 490],
      ['Tartare Saumon Avocat', 890],
      ['Dynamite', 890],
      ['Love Bao', 990],
    ],
  ],
  [
    'Plats thaï',
    [['Mi Prat', 1390], ['Pad Thaï', 1390], ['Crousti Poulet', 1490], ['Khao Prat', 1390], ['Curry Vert', 1390], ['Tigre qui pleure', 1590], ['Loc Lac', 1490], ['Bo Bun', 1390]],
  ],
  ['Menu Midi (lundi au vendredi)', [['Midi Asian', 1390], ['Asian Love', 1390], ['Banh Mi', 990], ['Menu Enfant', 990]]],
  ['Spécialités du chef', [['8 Maki Tiger', 1390], ['8 Maki Chicken Dragon', 1390], ['6 Maki Gold', null]]],
  ['Desserts', [['Mango Stick', 890], ['Tiramisu', 890], ['Dessert du jour', 890]]],
  [
    'Boissons',
    [['Evian / San Pellegrino', 290], ['Soda', 350], ['Asian Drink', 390], ['Calypso', 390], ['Bubble Tea', 500], ['Piña Colada', 750], ['Cocktail Kohsamui', 750], ['Cocktail Tokyo', 750]],
  ],
  ['Hors carte (prix à confirmer)', [['Thaï-sty Krusty', null], ['Bœuf Basilic', null], ['Boisson 33cl', null]]],
]

const MIDI = 'Menu midi (lundi au vendredi) — 1 soda offert + 1 accompagnement au choix : soupe miso ou salade de choux.'
// Descriptions de la carte (texte exact) ; les plats absents de cette liste n'ont pas de description.
const DESCRIPTIONS: Record<string, string> = {
  'California Poulet Avocat': 'Sauce curry ou mayo.',
  'California Crevettes Tempura Avocat': 'Sauce curry ou mayo.',
  'California Foie Gras Figue Amande': 'Foie gras, confiture de figues, amande effilée.',
  'Sashimi Saumon 6 pièces': 'Cru ou épicé.',
  'Sashimi Saumon 12 pièces': 'Cru ou épicé.',
  'Sashimi Thon 6 pièces': 'Cru ou épicé.',
  'Sashimi Thon 12 pièces': 'Cru ou épicé.',
  'Poke Bowl':
    'Servi avec du riz vinaigré. Base au choix : saumon mariné, saumon épicé, thon mariné, thon épicé, poulet crousti. Garnitures : salade iceberg, concombres, patate douce, salade de choux, avocat, edamame, choux rouge, mangue.',
  'Crevettes Tempura x4': '4 pièces.',
  Dynamite:
    'Dynamite Poulet ou Crevettes au choix, nos best-sellers ! Des bouchées croustillantes garnies de poulet ou de crevettes fondantes, enrobées dans une sauce dynamite maison légèrement épicée, crémeuse et addictive.',
  'Love Bao': 'Duo de bao à la dynamite poulet et crevette, concombre et oignon frit.',
  'Mi Prat': 'Poulet, bœuf ou crevette, nouilles sautées, légumes sautés.',
  'Pad Thaï': 'Poulet, bœuf ou crevette, nouilles de riz, légumes sautés.',
  'Crousti Poulet': 'Poulet croustillant doré façon thaï, riz nature ou riz thaï.',
  'Khao Prat': 'Poulet, bœuf ou crevette, riz thaï sauté au wok.',
  'Curry Vert': 'Poulet ou crevette, riz blanc, velouté de curry, légumes croquants.',
  'Tigre qui pleure': 'Bœuf tranché et sa sauce thaï, riz nature ou riz thaï.',
  'Loc Lac': 'Riz rouge, bœuf caramélisé, œuf, salade.',
  'Bo Bun': 'Vermicelles de riz, bœuf, nems, légumes.',
  'Midi Asian': `${MIDI} 6 California Saumon Avocat Concombre, 3 Sashimi Saumon, 3 Sushi Saumon.`,
  'Asian Love': `${MIDI} 6 California Saumon Cheese, 2 Sushi Saumon, 3 brochettes : bœuf au fromage, boulette de poulet, poulet.`,
  'Banh Mi': `${MIDI} Sandwich viet' — poulet ou bœuf.`,
  'Menu Enfant': `${MIDI} Midi & soir — 6 Maki Neige Cheese, 1 brochette boulette de poulet, 1 brochette de bœuf.`,
  '8 Maki Tiger': 'Crevette tempura, avocat, cheese, recouvert de saumon mi-cuit, avocat, mayonnaise spicy.',
  '8 Maki Chicken Dragon': "Poulet croustillant, avocat, cheese, sauce chili thaï, recouvert d'avocat, mayonnaise spicy et oignon frit.",
  'Mango Stick': 'Mangue et riz coco.',
  Tiramisu: 'Fait maison.',
  Soda: 'Coca-Cola, Ice Tea…',
  'Cocktail Kohsamui': 'Goyaves, ananas, kiwi.',
  'Cocktail Tokyo': 'Passion, ananas, grenadine.',
  'Thaï-sty Krusty':
    "Un savoureux riz blanc ou thaï généreusement nappé de notre sauce maison, accompagné de crousti poulet fondant à l'intérieur, croustillant à l'extérieur, le tout relevé par une seconde sauce maison pleine de caractère. Servi avec une boisson.",
  'Bœuf Basilic': 'Bœuf mariné façon thaï, légumes, basilic, riz nature.',
}

const plats = () => menuReelAsianHome().categories.flatMap((c) => c.produits)

describe('Carte officielle (Heyzine, relevée le 10/11/2026) → src/data/menu-reel.ts', () => {
  test('16 catégories, 81 plats, noms exacts de la carte dans l’ordre', () => {
    const menu = menuReelAsianHome()
    assert.equal(menu.commerceId, ID_ASIAN_HOME)
    assert.equal(COMPTE_CATEGORIES_REELLES, 16)
    assert.equal(COMPTE_PLATS_REELS, 81)
    assert.equal(menu.categories.length, 16)
    assert.equal(compterPlats(menu), 81)
    assert.deepEqual(
      menu.categories.map((c) => [c.nom, c.produits.map((p) => p.nom)]),
      CARTE.map(([nom, ps]) => [nom, ps.map(([n]) => n)]),
    )
  })

  test('tous les prix officiels exacts, au centime près', () => {
    const menu = menuReelAsianHome()
    assert.deepEqual(
      menu.categories.map((c) => c.produits.map((p) => [p.nom, p.prix])),
      CARTE.map(([, ps]) => ps),
    )
    // Double calcul : 76 lignes tarifées affichées (78 imprimées − 2 prix non confirmés masqués, P1-M1),
    // total 597,40 € (somme des prix affichés : 706,30 € imprimés − 8,90 € − 100,00 €).
    const prix = plats().map((p) => p.prix)
    assert.equal(prix.filter((p) => p !== null).length, 76)
    assert.equal(prix.reduce<number>((s, p) => s + (p ?? 0), 0), 59740)
    assert.equal(formaterPrix(650).replace(/\s/g, ' '), '6,50 €')
  })

  test('5 plats sans prix (« Prix sur place ») : les 2 prix non confirmés masqués (P1-M1) + les 3 hors carte', () => {
    const sansPrix = plats().filter((p) => p.prix === null)
    assert.deepEqual(sansPrix.map((p) => p.nom), ['Riz Thaï', '6 Maki Gold', 'Thaï-sty Krusty', 'Bœuf Basilic', 'Boisson 33cl'])
    for (const p of sansPrix) assert.equal(formaterPrix(p.prix), LIBELLE_PRIX_ABSENT)
    assert.equal(LIBELLE_PRIX_ABSENT, 'Prix sur place')
    // Les 3 hors carte restent seuls dans la dernière catégorie ; les 2 prix masqués restent dans leur catégorie d'origine.
    assert.deepEqual(menuReelAsianHome().categories.at(-1)!.produits.map((p) => p.nom), ['Thaï-sty Krusty', 'Bœuf Basilic', 'Boisson 33cl'])
    assert.equal(menuReelAsianHome().categories[0].produits.at(-1)!.nom, 'Riz Thaï')
    assert.equal(menuReelAsianHome().categories[12].produits.at(-1)!.nom, '6 Maki Gold')
  })

  test('prix « à vérifier » MASQUÉS (P1-M1) : Riz Thaï et 6 Maki Gold sans prix affiché, valeurs imprimées documentées seulement', () => {
    const riz = plats().find((p) => p.nom === 'Riz Thaï')!
    const gold = plats().find((p) => p.nom === '6 Maki Gold')!
    assert.equal(riz.prix, null)
    assert.equal(gold.prix, null)
    assert.equal(formaterPrix(riz.prix), LIBELLE_PRIX_ABSENT)
    assert.equal(formaterPrix(gold.prix), LIBELLE_PRIX_ABSENT)
    assert.equal(gold.description, undefined)
    // Les valeurs imprimées restent tracées (référence commerçant), jamais affichées dans le menu.
    assert.deepEqual(
      PRIX_A_CONFIRMER.map((p) => [p.nom, p.prixImprime]),
      [
        ['Riz Thaï', 890],
        ['6 Maki Gold', 10000],
      ],
    )
    assert.ok(PRIX_A_CONFIRMER.every((p) => p.motif.length > 0))
  })

  test('#/menu applique le masque au menu affiché (carte de repli ou menu enregistré)', () => {
    const tsx = readFileSync(new URL('../src/pages/MenuPublic.tsx', import.meta.url), 'utf8')
    assert.match(tsx, /masquerPrixNonConfirmes\(repliReel \? menuReelAsianHome\(\) : menu\)/)
  })

  test('masquerPrixNonConfirmes : un menu enregistré avant le lot avec les anciens montants ne les affiche plus', () => {
    const ancien = {
      categories: [
        {
          id: 'c1',
          nom: 'Salades & accompagnements',
          produits: [
            { id: 'p1', nom: 'Riz Thaï', prix: 890, allergenes: [] },
            { id: 'p2', nom: 'Riz Nature', prix: 250, allergenes: [] },
          ],
        },
        {
          id: 'c2',
          nom: 'Spécialités du chef',
          produits: [
            { id: 'p3', nom: '6 Maki Gold', prix: 10000, allergenes: [] },
            // Prix corrigé par le commerçant (10,00 €) : affiché, pas masqué.
            { id: 'p4', nom: '6 Maki Gold', prix: 1000, allergenes: [] },
          ],
        },
      ],
    }
    const masque = masquerPrixNonConfirmes(ancien as never)
    assert.equal(masque.categories[0].produits[0].prix, null)
    assert.equal(masque.categories[0].produits[1].prix, 250)
    assert.equal(masque.categories[1].produits[0].prix, null)
    assert.equal(masque.categories[1].produits[1].prix, 1000)
    // Le menu d'origine n'est pas modifié.
    assert.equal(ancien.categories[0].produits[0].prix, 890)
    assert.equal(ancien.categories[1].produits[0].prix, 10000)
    // La carte de repli est déjà masquée : l'application du masque ne change rien.
    assert.deepEqual(masquerPrixNonConfirmes(menuReelAsianHome()), menuReelAsianHome())
  })

  test('descriptions = texte de la carte uniquement ; aucun allergène inventé', () => {
    for (const p of plats()) {
      assert.equal(p.description, DESCRIPTIONS[p.nom], p.nom)
      assert.deepEqual(p.allergenes, [], p.nom)
    }
  })

  test('ids uniques ; les plats repris de l’ancien menu gardent leur id', () => {
    const ids = plats().map((p) => p.id)
    assert.equal(new Set(ids).size, 81)
    const id = (nom: string) => plats().find((p) => p.nom === nom)!.id
    assert.equal(id('Loc Lac'), 'reel-c3-p2')
    assert.equal(id('Love Bao'), 'reel-c2-p3')
    assert.equal(id('8 Maki Chicken Dragon'), 'reel-c4-p9')
    assert.equal(id('Cocktail Kohsamui'), 'reel-c7-p3')
  })

  test('le menu officiel passe la validation serveur (81 plats > ancienne limite de 60) ; un prix non entier reste refusé', () => {
    const valide = validerMenu(menuReelAsianHome(), ID_ASIAN_HOME, new Date())
    assert.equal(compterPlats(valide), 81)
    assert.equal(valide.categories[0].produits[5].prix, null)
    assert.throws(() => validerMenu({ categories: [{ nom: 'E', produits: [{ nom: 'N', prix: 6.5, allergenes: [] }] }] }, ID_ASIAN_HOME, new Date()), ErreurMenu)
    assert.throws(() => validerMenu({ categories: [{ nom: 'E', produits: [{ nom: 'N', prix: -1, allergenes: [] }] }] }, ID_ASIAN_HOME, new Date()), ErreurMenu)
  })

  test('bandeau « prix non renseignés » : affiché pour la carte officielle (5 plats sans prix), masqué si tous les prix sont là', () => {
    assert.match(bandeauPrixManquants(menuReelAsianHome())!, /Certains prix/)
    const complet = { categories: menuReelAsianHome().categories.map((c) => ({ ...c, produits: c.produits.map((p) => ({ ...p, prix: p.prix ?? 100 })) })) }
    assert.equal(bandeauPrixManquants(complet), null)
    const rien = { categories: [{ id: 'c', nom: 'E', produits: [{ id: 'p', nom: 'N', prix: null, allergenes: [] }] }] }
    assert.match(bandeauPrixManquants(rien)!, /les prix ne sont pas encore renseignés/)
  })
})

describe('Photos rattachées aux bons plats (vraies photos du restaurant uniquement)', () => {
  const photoDe = (nom: string) => {
    const p = plats().find((x) => x.nom === nom)
    return p ? (p.photo ?? null) : undefined
  }

  test('makis → menu-makis.jpg ; Loc Lac → menu-loc-lac.jpg ; Mango Stick → menu-mango-sticky-rice.jpg', () => {
    assert.equal(photoDe('8 Maki Chicken Dragon'), VISUELS.menuMakis)
    assert.equal(photoDe('8 Maki Tiger'), VISUELS.menuMakis)
    assert.equal(photoDe('Loc Lac'), VISUELS.menuLocLac)
    assert.equal(photoDe('Mango Stick'), VISUELS.menuMangoStickyRice)
  })
  test('Mi Prat → photo légendée du PDF (P1-B2), plus menu-nouilles-crevettes.jpg ; 13 plats photographiés, pas un de plus', () => {
    assert.equal(photoDe('Mi Prat'), '/visuels/menu-mi-prat.webp')
    for (const p of plats()) assert.notEqual(p.photo, VISUELS.menuNouillesCrevettes, p.nom)
    assert.deepEqual(
      plats().filter((p) => p.photo).map((p) => p.nom).sort(),
      ['8 Maki Chicken Dragon', '8 Maki Tiger', 'Bo Bun', 'Crousti Poulet', 'Curry Vert', 'Dynamite', 'Khao Prat', 'Loc Lac', 'Mango Stick', 'Mi Prat', 'Pad Thaï', 'Poke Bowl', 'Tigre qui pleure'],
    )
  })
  test('menu-plat-riz.jpg n’est rattachée à aucun plat nommé (photo d’ambiance seulement)', () => {
    for (const p of plats()) assert.notEqual(p.photo, VISUELS.menuPlatRiz, p.nom)
  })
  test('chaque photo de plat existe dans public/visuels/ et pèse ≤ 250 Ko', () => {
    const photos = new Set<string>()
    for (const p of plats()) if (p.photo) photos.add(p.photo)
    assert.ok(photos.size >= 4)
    for (const chemin of photos) {
      const fichier = new URL(`../public${chemin}`, import.meta.url)
      assert.ok(existsSync(fichier), chemin)
      assert.ok(statSync(fichier).size <= 250_000, chemin)
    }
  })
  test('photos de catégories : thaï et desserts illustrés, les autres sans photo inventée', () => {
    assert.equal(photoCategorie('Plats thaï')?.src, VISUELS.menuPlatRiz)
    assert.equal(photoCategorie('Desserts')?.src, VISUELS.menuMangoStickyRice)
    assert.equal(photoCategorie('Maki Pink x6')?.src, VISUELS.sushisArdoise)
    assert.equal(photoCategorie('Salades & accompagnements'), null)
    assert.equal(photoCategorie('Poke Bowl'), null)
    assert.equal(photoCategorie('Hors carte (prix à confirmer)'), null)
  })
})

describe('Plats signature et recherche / filtres du menu public', () => {
  test('signatures : Dynamite, Thaï-sty Krusty, Love Bao, Loc Lac, makis Chicken Dragon et Tiger (libellés de la carte)', () => {
    assert.deepEqual([...PLATS_SIGNATURE], ['Dynamite', 'Thaï-sty Krusty', 'Love Bao', 'Loc Lac', '8 Maki Chicken Dragon', '8 Maki Tiger'])
    for (const nom of PLATS_SIGNATURE) {
      assert.equal(estSignature(nom), true, nom)
      assert.ok(plats().some((p) => p.nom === nom), `signature absente du menu : ${nom}`)
    }
    assert.equal(estSignature('Choux'), false)
    assert.equal(estSignature('Duo Love Bao'), false)
  })

  test('recherche insensible aux accents et à la casse, sur le nom et la description', () => {
    const menu = menuReelAsianHome()
    const dynamite = plats().filter((p) => correspondPlat(p, 'dynamite'))
    // « Love Bao » cite la dynamite dans sa description.
    assert.deepEqual(dynamite.map((p) => p.nom), ['Dynamite', 'Love Bao'])
    const makis = filtrerMenu(menu.categories, 'maki').flatMap((c) => c.produits)
    assert.ok(makis.some((p) => p.nom === '8 Maki Chicken Dragon'))
    assert.ok(makis.some((p) => p.nom === 'Maki Pink Cheese'))
    assert.equal(filtrerMenu(menu.categories, 'loc lac').flatMap((c) => c.produits).map((p) => p.nom).join(), 'Loc Lac')
    assert.equal(filtrerMenu(menu.categories, 'PAD THAI').flatMap((c) => c.produits).map((p) => p.nom).join(), 'Pad Thaï')
    assert.equal(filtrerMenu(menu.categories, 'BASILIC').flatMap((c) => c.produits).map((p) => p.nom).join(), 'Bœuf Basilic')
    assert.equal(filtrerMenu(menu.categories, 'zzzintrouvable').length, 0)
    assert.equal(filtrerMenu(menu.categories, '').length, 16)
    assert.equal(compterPlats({ categories: filtrerMenu(menu.categories, '') }), 81)
  })
})

describe('DA sombre : contrastes texte/fond ≥ 4,5:1 (WCAG AA)', () => {
  // Contraste WCAG 2.1 : (L1 + 0,05) / (L2 + 0,05), luminances relatives.
  function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contraste = (a: string, b: string) => {
    const [clair, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (clair + 0.05) / (sombre + 0.05)
  }
  const NUIT = '#111111' // noir [ESTIMÉ] Instagram
  const MAGENTA = '#ff2e9a' // magenta clair, texte sur noir (P0-D1)
  const LAQUE = '#b3262d' // rouge laque (valeur certifiée de la charte actuelle)

  test('titres magenta et texte blanc sur fond noir', () => {
    assert.ok(contraste('#ffffff', NUIT) >= 4.5, `blanc/noir : ${contraste('#ffffff', NUIT).toFixed(1)}`)
    assert.ok(contraste(MAGENTA, NUIT) >= 4.5, `magenta/noir : ${contraste(MAGENTA, NUIT).toFixed(1)}`)
    assert.ok(contraste('#ff4d6d', NUIT) >= 4.5, `magenta doux/noir : ${contraste('#ff4d6d', NUIT).toFixed(1)}`)
    assert.ok(contraste('#f5c2be', NUIT) >= 4.5, `laque claire/noir : ${contraste('#f5c2be', NUIT).toFixed(1)}`)
  })
  test('rouge laque conservé comme accent (texte blanc dessus, texte laque sur ivoire)', () => {
    assert.ok(contraste('#ffffff', LAQUE) >= 4.5, `blanc/laque : ${contraste('#ffffff', LAQUE).toFixed(1)}`)
    assert.ok(contraste('#7f1a1f', '#f7f5f2') >= 4.5, `laque foncée/ivoire : ${contraste('#7f1a1f', '#f7f5f2').toFixed(1)}`)
    assert.ok(contraste('#111111', '#ff2e9a') >= 4.5, `noir/magenta clair (roue) : ${contraste('#111111', '#ff2e9a').toFixed(1)}`)
  })
  test('texte foncé sur fond clair (badges, étoiles)', () => {
    assert.ok(contraste('#92400e', '#ffffff') >= 4.5, `amber-800/blanc : ${contraste('#92400e', '#ffffff').toFixed(1)}`)
    assert.ok(contraste('#92400e', '#fef3c7') >= 4.5, `amber-800/amber-100 : ${contraste('#92400e', '#fef3c7').toFixed(1)}`)
  })
})

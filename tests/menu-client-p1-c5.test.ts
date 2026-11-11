// P1-C5 — Menu client : recherche « boeuf » → « Bœuf » (ligatures œ / æ), badges déduits « à confirmer »,
// onglets collants sans réinitialisation à la frappe, bandeau « Menu Midi » (lun–ven 11h30–14h30, Paris),
// boutons appeler / itinéraire / Instagram, liens Deliveroo / Uber Eats configurables et masqués s'ils sont vides.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { sansAccents, correspondRecherche } from '../src/lib/recherche.ts'
import { correspondPlat, filtrerMenu } from '../src/lib/menu.ts'
import {
  badgesPlat,
  boutonsMenu,
  categorieEffective,
  categorieMidi,
  CONTACT_ASIAN_HOME,
  estHeureMenuMidi,
  lienItineraire,
  LIBELLES_BADGES,
  MENTION_BADGE_DEDUIT,
} from '../src/lib/menuClient.ts'
import { commercePublic } from '../src/lib/vuePublique.ts'
import { menuReelAsianHome } from '../src/data/menu-reel.ts'
import seed from '../src/data/seed.json' with { type: 'json' }
import type { Commerce } from '../src/types.ts'

const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const source = (f: string) => readFileSync(join(import.meta.dirname, '..', f), 'utf8')
const reel = menuReelAsianHome()
const plats = reel.categories.flatMap((c) => c.produits)
const plat = (nom: string) => plats.find((p) => p.nom === nom)!

// ---------- Recherche : ligatures ----------

describe('sansAccents : œ / æ dépliés', () => {
  test('« Bœuf » → « boeuf », « Œuf » → « oeuf », « Æ » → « ae », accents toujours retirés', () => {
    assert.equal(sansAccents('Bœuf'), 'boeuf')
    assert.equal(sansAccents('ŒUF'), 'oeuf')
    assert.equal(sansAccents('Ægée cæcum'), 'aegee caecum')
    assert.equal(sansAccents('Hélène'), 'helene')
  })
  test('symétrique : la saisie et le texte passent par la même fonction', () => {
    assert.equal(correspondPlat({ nom: 'Bœuf Basilic' }, 'boeuf'), true)
    assert.equal(correspondPlat({ nom: 'Boeuf Basilic' }, 'bœuf'), true)
    assert.equal(correspondPlat({ nom: 'Pad Thaï', description: 'Poulet, bœuf ou crevette' }, 'BOEUF'), true)
    assert.equal(correspondRecherche({ prenom: 'Lætitia', telephone: '', email: '' }, 'laetitia'), true)
  })
})

describe('Recherche dans la carte officielle', () => {
  test('« boeuf » trouve les plats au bœuf (nom et description), dont « Bœuf Basilic »', () => {
    const noms = filtrerMenu(reel.categories, 'boeuf').flatMap((c) => c.produits.map((p) => p.nom))
    for (const n of ['Bœuf Basilic', 'Bœuf au Fromage Fait Maison x2', 'Loc Lac', 'Tigre qui pleure', 'Pad Thaï']) assert.ok(noms.includes(n), n)
    assert.deepEqual(filtrerMenu(reel.categories, 'bœuf'), filtrerMenu(reel.categories, 'boeuf'))
  })
})

// ---------- Badges ----------

describe('Badges « épicé » / « végétarien » : déduits du texte, jamais inventés', () => {
  test('épicé : description épicée / spicy / sauce dynamite', () => {
    for (const n of ['Dynamite', 'Love Bao', '8 Maki Tiger', '8 Maki Chicken Dragon']) assert.deepEqual(badgesPlat(plat(n)), ['epice'], n)
  })
  test('option épicée : « cru ou épicé », bases épicées au choix', () => {
    for (const n of ['Sashimi Saumon 6 pièces', 'Sashimi Thon 12 pièces', 'Poke Bowl']) assert.deepEqual(badgesPlat(plat(n)), ['optionEpicee'], n)
  })
  test('végétarien : « veggie » dans le nom ; option végétarienne : « … ou légume »', () => {
    assert.deepEqual(badgesPlat(plat('California Veggie Avocat Concombre')), ['vegetarien'])
    assert.deepEqual(badgesPlat(plat('Gyoza Crevette ou Légume x4')), ['optionVegetarienne'])
  })
  test('aucune déduction depuis une liste d’ingrédients : plats sans mot-clé = aucun badge', () => {
    for (const n of ['Maki Black Avocat', 'Edamame', 'Soupe Miso', 'Mi Prat', 'Curry Vert', 'Thaï-sty Krusty', 'Tiramisu']) assert.deepEqual(badgesPlat(plat(n)), [], n)
    const avecBadge = plats.filter((p) => badgesPlat(p).length).map((p) => p.nom)
    // 4 épicés, 5 options épicées (4 sashimis + Poke Bowl), 1 végétarien, 1 option végétarienne.
    assert.equal(avecBadge.length, 11, avecBadge.join(', '))
  })
  test('libellés et mention « à confirmer » ; allergènes toujours vides (rien d’inventé)', () => {
    assert.equal(MENTION_BADGE_DEDUIT, 'à confirmer')
    assert.match(LIBELLES_BADGES.epice, /Épicé/)
    assert.match(LIBELLES_BADGES.vegetarien, /Végétarien/)
    assert.ok(plats.every((p) => p.allergenes.length === 0))
  })
})

// ---------- Onglets ----------

describe('Catégorie active : la frappe ne la réinitialise pas', () => {
  const cats = [{ id: 'a' }, { id: 'b' }]
  test('catégorie choisie gardée tant qu’elle a des plats ; sinon « toutes » (sans perdre le choix)', () => {
    assert.equal(categorieEffective(cats, 'b'), 'b')
    assert.equal(categorieEffective([{ id: 'a' }], 'b'), 'toutes')
    assert.equal(categorieEffective(cats, 'toutes'), 'toutes')
  })
  test('source : la saisie ne remet plus la catégorie à « toutes »', () => {
    const tsx = source('src/pages/MenuPublic.tsx')
    assert.match(tsx, /onChange=\{\(e\) => \(setRecherche\(e\.target\.value\), setOuvert\(null\)\)\}/)
    assert.doesNotMatch(tsx, /setRecherche\(e\.target\.value\), setCategorie/)
    assert.match(tsx, /const active = categorieEffective\(categories, categorie\)/)
  })
  test('source : recherche + onglets collants, indicateur de l’onglet actif', () => {
    const tsx = source('src/pages/MenuPublic.tsx')
    assert.match(tsx, /className="sticky top-0 z-20[^"]*"/)
    assert.ok(tsx.indexOf('className="sticky top-0') < tsx.indexOf("aria-label={t('Catégories')}"), 'les onglets sont dans le bloc collant')
    assert.match(tsx, /aria-current=\{indique \? 'true' : undefined\}/)
    assert.match(tsx, /after:bg-magenta-400/)
    assert.match(tsx, /new IntersectionObserver/)
  })
})

// ---------- Bandeau Menu Midi ----------

describe('Bandeau « Menu Midi » : lun–ven 11h30–14h30, heure de Paris', () => {
  // Novembre 2026 : heure d'hiver, Paris = UTC+1. Lundi 9 → vendredi 13, samedi 14, dimanche 15.
  const paris = (iso: string) => new Date(`${iso}+01:00`)
  test('en semaine dans le créneau : affiché (bornes : 11h30 incluse, 14h30 exclue)', () => {
    for (const j of ['09', '10', '11', '12', '13']) assert.equal(estHeureMenuMidi(paris(`2026-11-${j}T12:15:00`)), true, j)
    assert.equal(estHeureMenuMidi(paris('2026-11-10T11:30:00')), true)
    assert.equal(estHeureMenuMidi(paris('2026-11-10T14:29:00')), true)
  })
  test('hors créneau ou le week-end : masqué', () => {
    for (const h of ['11:29', '14:30', '19:00', '00:00', '08:00']) assert.equal(estHeureMenuMidi(paris(`2026-11-10T${h}:00`)), false, h)
    for (const j of ['14', '15']) assert.equal(estHeureMenuMidi(paris(`2026-11-${j}T12:15:00`)), false, `samedi / dimanche ${j}`)
  })
  test('fuseau de Paris, pas celui de l’appareil ; heure d’été comprise', () => {
    // 10h45 UTC = 11h45 à Paris (hiver) ; 10h15 UTC = 11h15 → pas encore.
    assert.equal(estHeureMenuMidi(new Date('2026-11-10T10:45:00Z')), true)
    assert.equal(estHeureMenuMidi(new Date('2026-11-10T10:15:00Z')), false)
    // Juillet (UTC+2) : 12h20 UTC = 14h20 Paris → oui ; 12h40 UTC = 14h40 → non.
    assert.equal(estHeureMenuMidi(new Date('2026-07-15T12:20:00Z')), true)
    assert.equal(estHeureMenuMidi(new Date('2026-07-15T12:40:00Z')), false)
    // Vendredi 23h30 UTC = samedi 0h30 à Paris : week-end.
    assert.equal(estHeureMenuMidi(new Date('2026-11-13T23:30:00Z')), false)
  })
  test('catégorie des formules midi trouvée dans la carte officielle ; absente → pas de bandeau', () => {
    assert.equal(categorieMidi(reel.categories)?.id, 'reel-cat-midi')
    assert.equal(categorieMidi([{ nom: 'Desserts' }]), null)
  })
  test('source : bandeau conditionné à estHeureMenuMidi et à la présence des formules', () => {
    const tsx = source('src/pages/MenuPublic.tsx')
    assert.match(tsx, /const bandeauMidi = !!midi && estHeureMenuMidi\(maintenant\)/)
    assert.match(tsx, /\{bandeauMidi && midi && \(/)
  })
})

// ---------- Boutons ----------

describe('Boutons appeler / itinéraire / Instagram / commander', () => {
  test('Asian Home : appeler, itinéraire Google Maps vers l’adresse, Instagram ; rien d’autre sans lien de commande', () => {
    const b = boutonsMenu({}, true)
    assert.deepEqual(b.map((x) => x.id), ['appeler', 'itineraire', 'instagram'])
    assert.equal(b[0].href, 'tel:+33782974801')
    assert.equal(b[1].href, lienItineraire('11 rue André Joineau, 93310 Le Pré-Saint-Gervais'))
    assert.match(b[1].href, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=11%20rue%20Andr%C3%A9%20Joineau%2C%2093310%20Le%20Pr%C3%A9-Saint-Gervais$/)
    assert.equal(b[2].href, 'https://www.instagram.com/asianhomeparis/')
    // Mêmes coordonnées que le seed (aucune inventée).
    const coord = seed.commerces[0].coordonnees
    assert.ok(coord.includes(CONTACT_ASIAN_HOME.adresse) && coord.includes('07 82 97 48 01') && coord.includes(`@${CONTACT_ASIAN_HOME.instagram}`))
  })
  test('Deliveroo / Uber Eats masqués si vides, absents ou non https ; affichés si renseignés', () => {
    for (const vide of [{}, { lienDeliveroo: '', lienUberEats: '  ' }, { lienDeliveroo: 'http://x.fr', lienUberEats: 'javascript:alert(1)' }]) {
      assert.deepEqual(boutonsMenu(vide, false), [], JSON.stringify(vide))
      assert.ok(!boutonsMenu(vide, true).some((x) => x.id === 'deliveroo' || x.id === 'uberEats'))
    }
    const b = boutonsMenu({ lienDeliveroo: 'https://deliveroo.fr/menu/paris/x', lienUberEats: 'https://www.ubereats.com/fr/store/x' }, false)
    assert.deepEqual(b.map((x) => [x.id, x.href]), [
      ['deliveroo', 'https://deliveroo.fr/menu/paris/x'],
      ['uberEats', 'https://www.ubereats.com/fr/store/x'],
    ])
  })
  test('aucun lien Deliveroo / Uber Eats dans le code ni dans le seed (non fournis : rien d’inventé)', () => {
    for (const f of ['src/lib/menuClient.ts', 'src/pages/MenuPublic.tsx', 'src/data/seed.json', 'src/data/menu-reel.ts']) {
      assert.doesNotMatch(source(f), /https:\/\/(?:\w+\.)?(?:deliveroo\.\w+|ubereats\.com)/, f)
    }
  })
  test('vue publique : liens publiés seulement s’ils sont renseignés', () => {
    const base = seed.commerces[0] as unknown as Commerce
    assert.ok(!('lienDeliveroo' in commercePublic({ ...base, lienDeliveroo: '' })))
    assert.ok(!('lienUberEats' in commercePublic(base)))
    assert.equal(commercePublic({ ...base, lienUberEats: 'https://www.ubereats.com/fr/store/x' }).lienUberEats, 'https://www.ubereats.com/fr/store/x')
  })
})

describe('Réglages : PATCH lienDeliveroo / lienUberEats (liste blanche)', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p1-c5-'))
  after(() => rmSync(dossier, { recursive: true, force: true }))

  test('https accepté puis publié sur le menu ; http / javascript refusés ; vide = retiré', async (t) => {
    const app = await creerServeur({ fichierDb: join(dossier, 'c5.db'), adminPin: '987654', pinInitial: '1234', version: 'test' })
    t.after(() => app.fermer())
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
    const api = async (m: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) => {
      const r = await fetch(`${racine}${chemin}`, { method: m, headers: { 'Content-Type': 'application/json', ...entetes }, body: corps === undefined ? undefined : JSON.stringify(corps) })
      return { statut: r.status, contenu: await r.json() }
    }
    const menu = async () => (await api('GET', `/commerces/${AH}/menu`)).contenu.commerce

    assert.ok(!('lienDeliveroo' in (await menu())) && !('lienUberEats' in (await menu())), 'absents par défaut')
    assert.equal((await api('PATCH', `/commerces/${AH}`, { lienDeliveroo: 'https://deliveroo.fr/menu/x' })).statut, 401)
    for (const faux of ['http://deliveroo.fr/x', 'javascript:alert(1)', 'deliveroo.fr', 42]) {
      assert.equal((await api('PATCH', `/commerces/${AH}`, { lienDeliveroo: faux }, PIN)).statut, 400, String(faux))
      assert.equal((await api('PATCH', `/commerces/${AH}`, { lienUberEats: faux }, PIN)).statut, 400, String(faux))
    }
    assert.equal((await api('PATCH', `/commerces/${AH}`, { lienDeliveroo: 'https://deliveroo.fr/menu/x', lienUberEats: ' https://www.ubereats.com/fr/store/x ' }, PIN)).statut, 200)
    let pub = await menu()
    assert.equal(pub.lienDeliveroo, 'https://deliveroo.fr/menu/x')
    assert.equal(pub.lienUberEats, 'https://www.ubereats.com/fr/store/x')
    assert.equal((await api('PATCH', `/commerces/${AH}`, { lienDeliveroo: '' }, PIN)).statut, 200)
    pub = await menu()
    assert.ok(!('lienDeliveroo' in pub))
    assert.equal(pub.lienUberEats, 'https://www.ubereats.com/fr/store/x')
  })

  test('front : champs dans Réglages, envoyés par le store (vide = effacé)', () => {
    const reglages = source('src/pages/Reglages.tsx')
    assert.match(reglages, /onChange=\{\(e\) => maj\('lienDeliveroo', e\.target\.value\)\}/)
    assert.match(reglages, /onChange=\{\(e\) => maj\('lienUberEats', e\.target\.value\)\}/)
    const store = source('src/store.tsx')
    assert.match(store, /lienDeliveroo: c\.lienDeliveroo \?\? '',/)
    assert.match(store, /lienUberEats: c\.lienUberEats \?\? '',/)
  })
})

// ---------- Vérifications d'affichage (source) ----------

describe('Affichage : images paresseuses, descriptions sur 2 lignes, prix, allergènes', () => {
  const tsx = source('src/pages/MenuPublic.tsx')
  test('toutes les images de plats / catégories en loading="lazy" (seule la photo d’en-tête est immédiate)', () => {
    const imgs = tsx.match(/<img\b[^>]*>/gs) ?? []
    assert.equal(imgs.filter((i) => !i.includes('loading="lazy"')).length, 1)
    assert.ok(imgs.filter((i) => !i.includes('loading="lazy"'))[0].includes('VISUELS.tableSushis'))
  })
  test('description repliée à 2 lignes, prix ou « Prix sur place », « ★ Signature » gardé, allergènes : demander à l’équipe', () => {
    assert.match(tsx, /line-clamp-2/)
    assert.match(tsx, /formaterPrix\(p\.prix\)/)
    assert.match(tsx, /Prix sur place/)
    assert.match(tsx, /★ Signature/)
    assert.match(tsx, /Allergènes : demandez conseil à l’équipe en cas de doute\./)
    assert.match(tsx, /\{MENTION_BADGE_DEDUIT\} auprès de l’équipe/)
  })
})

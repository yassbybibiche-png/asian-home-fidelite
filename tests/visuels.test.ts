// Visuels réels d'Asian Home Paris : chemins référencés existants, poids mobile,
// et règles d'association (photo ↔ commerce / catégorie) sans invention.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'

import {
  ID_ASIAN_HOME,
  VISUELS,
  banniereCommerce,
  estAsianHome,
  estLogoLocal,
  logoCommerce,
  photoCategorie,
} from '../src/lib/visuels.ts'
import type { Commerce } from '../src/types.ts'
import { nouveauCommerce } from '../src/data/defaults.ts'

const POIDS_MAX_OCTETS = 250_000

function commerceAsianHome(patch: Partial<Commerce> = {}): Commerce {
  return { ...nouveauCommerce('Asian Home Paris', 'restaurant', ''), id: ID_ASIAN_HOME, ...patch }
}

describe('Fichiers visuels (public/visuels/)', () => {
  for (const [cle, chemin] of Object.entries(VISUELS)) {
    test(`${cle} (${chemin}) existe et pèse ≤ 250 Ko`, () => {
      const fichier = new URL(`../public${chemin}`, import.meta.url)
      assert.ok(existsSync(fichier), `${chemin} introuvable dans public/visuels/`)
      const taille = statSync(fichier).size
      assert.ok(taille <= POIDS_MAX_OCTETS, `${chemin} : ${taille} octets > ${POIDS_MAX_OCTETS}`)
      assert.ok(taille > 10_000, `${chemin} : ${taille} octets, fichier suspect (trop petit)`)
    })
  }
  test('tous les chemins sont servis localement (pas de hotlink)', () => {
    for (const chemin of Object.values(VISUELS)) {
      assert.ok(chemin.startsWith('/visuels/'), chemin)
      assert.ok(!/^https?:\/\//i.test(chemin), chemin)
    }
  })
})

describe('Association des visuels au commerce', () => {
  test('Asian Home (id de production) utilise les visuels locaux', () => {
    const c = commerceAsianHome({ logo: '' })
    assert.equal(estAsianHome(c), true)
    assert.equal(logoCommerce(c), VISUELS.logo)
    assert.equal(banniereCommerce(c), VISUELS.heroPlats)
    assert.equal(estLogoLocal(VISUELS.logo), true)
  })
  test('un autre commerce n’hérite d’aucun visuel Asian Home', () => {
    const c = { ...nouveauCommerce('Atelier Coiff’ Camille', 'salon', ''), id: 'c-autre', logo: '' }
    assert.equal(estAsianHome(c), false)
    assert.equal(logoCommerce(c), '')
    assert.equal(banniereCommerce(c), '')
  })
  test('le logo / la bannière renseignés par le commerçant priment sur le repli local', () => {
    const c = commerceAsianHome({ logo: 'https://exemple.fr/logo.png', apparence: { banniere: 'https://exemple.fr/banniere.jpg' } })
    assert.equal(logoCommerce(c), 'https://exemple.fr/logo.png')
    assert.equal(banniereCommerce(c), 'https://exemple.fr/banniere.jpg')
  })
  test('le logo local est blanc sur noir : fond sombre requis', () => {
    assert.equal(estLogoLocal(VISUELS.logo), true)
    assert.equal(estLogoLocal('https://exemple.fr/logo.png'), false)
  })
})

describe('Photo de catégorie de menu', () => {
  test('Sushis → rouleau sur ardoise ; Boissons / Cocktails → cocktails signature ; Thaï et Desserts illustrés', () => {
    assert.deepEqual(photoCategorie('Sushis & Makis'), { src: VISUELS.sushisArdoise, alt: 'Rouleau de sushis sur ardoise' })
    assert.deepEqual(photoCategorie('Boissons'), { src: VISUELS.cocktails, alt: 'Cocktails signature : Koh Samui, Tokyo et Piña Colada' })
    assert.equal(photoCategorie('Cocktails signature')?.src, VISUELS.cocktails)
    // Plat thaï non identifié : illustre la catégorie, jamais un plat nommé.
    assert.equal(photoCategorie('Côté thaï')?.src, VISUELS.menuPlatRiz)
    // Le Mango Stick photographié illustre la catégorie desserts.
    assert.equal(photoCategorie('Desserts')?.src, VISUELS.menuMangoStickyRice)
  })
  test('aucune photo inventée pour les autres catégories', () => {
    for (const nom of ['Entrées', 'Plats', 'Formules', 'Woks', 'Nouilles', 'Asian Street Food', 'Nos Poke Bowl']) {
      assert.equal(photoCategorie(nom), null, nom)
    }
  })
})

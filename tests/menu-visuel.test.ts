// Mission « Menu visuel » (13/11/2026) : grandes cartes photo, rail « En photos », en-têtes de catégorie enrichis.
// photoCartePlat (variante WebP légère du Loc Lac), fichier livré, présence du rail dans la page.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

import { photoCartePlat } from '../src/lib/menuClient.ts'
import { VISUELS } from '../src/lib/visuels.ts'

describe('photoCartePlat : photo de la grande carte d’un plat', () => {
  test('sans photo → undefined', () => {
    assert.equal(photoCartePlat({}), undefined)
    assert.equal(photoCartePlat({ photo: '' }), undefined)
  })
  test('photo du PDF → inchangée', () => {
    assert.equal(photoCartePlat({ photo: '/visuels/menu-pad-thai.webp' }), '/visuels/menu-pad-thai.webp')
  })
  test('Loc Lac (JPEG 156 Ko) → variante WebP légère', () => {
    assert.equal(photoCartePlat({ photo: VISUELS.menuLocLac }), VISUELS.menuLocLacPetit)
  })
  test('URL https externe → inchangée', () => {
    assert.equal(photoCartePlat({ photo: 'https://exemple.fr/plat.jpg' }), 'https://exemple.fr/plat.jpg')
  })
})

describe('VISUELS.menuLocLacPetit : fichier livré', () => {
  const fichier = new URL(`../public${VISUELS.menuLocLacPetit}`, import.meta.url)
  test('présent, WebP (RIFF/WEBP), entre 3 000 et 60 000 o', () => {
    assert.ok(existsSync(fichier), `${VISUELS.menuLocLacPetit} introuvable`)
    const b = readFileSync(fichier)
    assert.equal(b.toString('ascii', 0, 4), 'RIFF')
    assert.equal(b.toString('ascii', 8, 12), 'WEBP')
    assert.ok(b.length <= 60_000, `${b.length} octets`)
    assert.ok(b.length > 3_000, `${b.length} octets`)
  })
})

describe('MenuPublic (source) : rail « En photos » et grandes cartes', () => {
  const source = readFileSync(new URL('../src/pages/MenuPublic.tsx', import.meta.url), 'utf8')
  test('rail, liste des plats photographiés, photo des cartes et navigation vers un plat', () => {
    assert.ok(source.includes("<section aria-label={t('En photos')}"))
    assert.match(source, /\bplatsPhoto\b/)
    assert.ok(source.includes('photoCartePlat(p)'))
    assert.match(source, /\ballerAuPlat\b/)
  })
})

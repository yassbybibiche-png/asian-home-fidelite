// P3-1 — Mode d'accès à la roue : récapitulatif en clair dans Réglages > Règles du jeu, mesure de l'attente
// réelle en mode 'visite', et détermination documentée du mode d'Asian Home (docs/MODE-ACCES-ROUE.md).
// Logique pure (src/lib/roulette.ts pour la mesure, src/lib/reglagesRoue.ts pour le récapitulatif)
// Parcours navigateur : tests-e2e/reglages-roulette-r6.spec.ts (récapitulatif visible dans les deux modes).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { delaiValidationVisite, modeAccesRoue } from '../src/lib/roulette.ts'
import { resumeModeAcces } from '../src/lib/reglagesRoue.ts'
import type { Client, Commerce } from '../src/types.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')

describe('P3-1 : récapitulatif en clair du mode d’accès', () => {
  test('libre : le client joue dès l’identification, sans passer par le comptoir', () => {
    assert.equal(
      resumeModeAcces('libre', true),
      'Mode actuel : libre — 1 tirage par jour. Le client joue dès qu’il s’est identifié, sans passer par le comptoir.',
    )
  })

  test('visite : le client attend la validation, sans elle il ne joue pas aujourd’hui', () => {
    assert.equal(
      resumeModeAcces('visite', true),
      'Mode actuel : après visite validée au comptoir. Un client qui scanne le QR attend que vous ou votre équipe validiez sa visite avant de pouvoir tourner la roue — sans validation, il ne peut pas jouer aujourd’hui.',
    )
  })

  test('réglage jamais choisi : le récapitulatif dit que le mode par défaut s’applique', () => {
    assert.equal(
      resumeModeAcces('visite', false),
      'Ce réglage n’a jamais été choisi pour ce commerce : le mode par défaut s’applique. Mode actuel : après visite validée au comptoir. Un client qui scanne le QR attend que vous ou votre équipe validiez sa visite avant de pouvoir tourner la roue — sans validation, il ne peut pas jouer aujourd’hui.',
    )
    assert.match(resumeModeAcces('libre', false), /^Ce réglage n’a jamais été choisi pour ce commerce : le mode par défaut s’applique\. Mode actuel : libre/)
  })

  test('le récapitulatif ne promet rien d’autre que le mode effectif (aucun gain, aucun délai)', () => {
    for (const mode of ['libre', 'visite'] as const) {
      assert.doesNotMatch(resumeModeAcces(mode, true), /gagn|lot|point|minute|immédiat/)
    }
  })
})

describe('P3-1 : mesure de l’attente réelle en mode visite', () => {
  const client = (creeLe: string, visites: string[]): Pick<Client, 'creeLe' | 'visites'> => ({ creeLe, visites })

  test('délai = première visite validée le jour de l’identification, en minutes', () => {
    assert.equal(delaiValidationVisite(client('2026-11-14T12:00:00.000Z', ['2026-11-14T12:25:00.000Z'])), 25)
    assert.equal(delaiValidationVisite(client('2026-11-14T12:00:00.000Z', ['2026-11-14T12:00:00.000Z'])), 0)
    // Plusieurs visites le même jour : la première compte (c’est elle qui débloque la roue).
    assert.equal(
      delaiValidationVisite(client('2026-11-14T12:00:00.000Z', ['2026-11-14T12:40:00.000Z', '2026-11-14T12:10:00.000Z'])),
      10,
    )
  })

  test('rien à mesurer : aucune visite ce jour-là, ou visite un autre jour', () => {
    assert.equal(delaiValidationVisite(client('2026-11-14T12:00:00.000Z', [])), null)
    assert.equal(delaiValidationVisite(client('2026-11-14T12:00:00.000Z', ['2026-11-15T12:05:00.000Z'])), null)
    assert.equal(delaiValidationVisite(client('2026-11-14T12:00:00.000Z', ['2026-11-13T12:05:00.000Z'])), null)
  })

  test('données incohérentes : visite avant l’identification, ou dates invalides → null, jamais un nombre négatif', () => {
    assert.equal(delaiValidationVisite(client('2026-11-14T12:00:00.000Z', ['2026-11-14T11:00:00.000Z'])), null)
    assert.equal(delaiValidationVisite(client('pas-une-date', ['2026-11-14T12:05:00.000Z'])), null)
    assert.equal(delaiValidationVisite(client('2026-11-14T12:00:00.000Z', ['pas-une-date'])), null)
  })
})

describe('P3-1 : Réglages > Règles du jeu affiche le récapitulatif', () => {
  const reglages = lire('src/pages/Reglages.tsx')

  test('récapitulatif sous le groupe de radios, avant la limite de gains', () => {
    const iRadios = reglages.indexOf('role="radiogroup"')
    const iRecap = reglages.indexOf('data-recap-mode-acces')
    const iLimite = reglages.indexOf('id="limiteGainsMois"')
    assert.ok(iRadios > 0 && iRecap > iRadios, 'récapitulatif après le groupe de radios')
    assert.ok(iLimite > iRecap, 'récapitulatif avant la limite de gains')
    assert.match(reglages, /<p role="status" data-recap-mode-acces/)
    assert.match(reglages, /resumeModeAcces\(modeAccesRoue\(brouillon\), brouillon\.modeAccesRoue !== undefined\)/)
    assert.match(reglages, /resumeModeAcces \} from '\.\.\/lib\/reglagesRoue'/)
    // Le récapitulatif vit dans le module des Réglages (page différée), pas dans roulette.ts (bundle initial).
    assert.doesNotMatch(lire('src/lib/roulette.ts'), /resumeModeAcces/)  })
})

describe('P3-1 : détermination du mode d’Asian Home, documentée', () => {
  test('graine : Asian Home n’a pas de modeAccesRoue enregistré → effectif visite', () => {
    const graine = JSON.parse(lire('src/data/seed.json')) as { commerces: Pick<Commerce, 'id' | 'modeAccesRoue'>[] }
    const asianHome = graine.commerces.find((c) => c.id === 'c-asian-home-paris')
    assert.ok(asianHome, 'commerce c-asian-home-paris présent dans la graine')
    assert.equal(asianHome.modeAccesRoue, undefined, 'aucun mode enregistré dans la graine')
    assert.equal(modeAccesRoue(asianHome), 'visite', 'mode effectif à l’initialisation : visite')
  })

  test('doc : requête de confirmation production, méthode de mesure, état honnête', () => {
    const doc = lire('docs/MODE-ACCES-ROUE.md')
    assert.match(doc, /donnees->>'modeAccesRoue'/)
    assert.match(doc, /c-asian-home-paris/)
    assert.match(doc, /delaiValidationVisite/)
    assert.match(doc, /aucune mesure réelle à ce jour/)
    assert.match(doc, /présumée `visite`, non confirmée/)
  })
})

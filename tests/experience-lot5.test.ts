// Expérience 10/10, lot 5 — Réglages : la barre « Enregistrer » générale passe par-dessus la section « Commande à
// table », qui a son propre état et son propre bouton. La section le dit en tête, son bouton a un libellé explicite
// et porte lui-même son retour « ✓ … enregistrée ». Vérifié sur la source (patron des lots 2–4).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RACINE = join(import.meta.dirname, '..')
const lire = (f: string) => readFileSync(join(RACINE, f), 'utf8')
const espaces = (s: string) => s.replace(/\s+/g, ' ')

describe('Lot 5 — Réglages « Commande à table » : un seul bouton pour cette section', () => {
  const section = lire('src/components/ReglagesCommande.tsx')

  test('aide en tête de section (juste sous le titre) : bouton propre nommé, barre générale sans effet sur les tables', () => {
    const tete = section.slice(section.indexOf('data-reglages-commande'), section.indexOf('<Interrupteur'))
    assert.match(
      espaces(tete),
      /<\/h2> \{\/\*[^]*?\*\/\} <p className="text-sm font-semibold text-gray-700" data-aide-enregistrement> Cette section s’enregistre avec le bouton « Enregistrer la commande à table » ci-dessous — la barre d’enregistrement générale ne sauvegarde ni l’activation ni les tables\. <\/p>/,
    )
  })

  test('le bouton de la section porte le libellé cité par l’aide et son propre retour « ✓ … enregistrée »', () => {
    assert.match(section, /<button type="button" className="bouton w-full"[^>]*onClick=\{\(\) => void enregistrer\(\)\}>\s*\{enCours \? 'Enregistrement…' : enregistre && !modifie \? '✓ Commande à table enregistrée' : 'Enregistrer la commande à table'\}/)
    // Jamais le libellé nu de la barre générale (« Enregistrer » / « ✓ Enregistré ») dans la section.
    assert.doesNotMatch(section, /'Enregistrer'|'✓ Enregistré'/)
    // La barre générale des Réglages est inchangée : elle reste pour les autres réglages.
    assert.match(lire('src/pages/Reglages.tsx'), /\{enCours \? 'Enregistrement…' : enregistre \? '✓ Enregistré' : 'Enregistrer'\}/)
  })

  test('modification en cours : avertissement visible juste au-dessus du bouton de la section', () => {
    assert.match(
      section,
      /\{modifie && <p className="text-sm font-semibold text-amber-800">Commande à table modifiée, pas encore enregistrée : utilisez le bouton ci-dessous\.<\/p>\}\s*<MessageErreur>/,
    )
  })
})

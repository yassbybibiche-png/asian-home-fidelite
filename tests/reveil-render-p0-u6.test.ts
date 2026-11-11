// P0-U6 — Réveil Render : écran d'attente honnête (AUDIT.md §7, docs/DEPLOIEMENT.md § 7).
// Décision : ni plan payant (acheté), ni keep-alive — un message qui dit la vérité (« Le serveur se
// réveille, ~1 min ») + une progression figurée de 60 s. Le parcours < 30 s à froid reste impossible :
// c'est documenté explicitement dans docs/DEPLOIEMENT.md § 7.1, pas masqué.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')

const html = lire('index.html')
const css = lire('src/chargement.css')
const deploiement = lire('docs/DEPLOIEMENT.md')
const yaml = lire('render.yaml')

describe('P0-U6 : écran d’attente honnête (index.html)', () => {
  test('message de réveil : ~1 minute, pas « quelques secondes »', () => {
    assert.match(html, /Le serveur se réveille — environ 1 minute la première fois, merci de patienter\./)
    assert.doesNotMatch(html, /Connexion lente : merci de patienter quelques secondes\./)
    // « Chargement… » reste le texte initial (serveur éveillé : quelques secondes, écran remplacé avant 6 s).
    assert.match(html, />Chargement…</)
  })

  test('barre de progression figurée présente, sans JS (un seul élément, fond animé)', () => {
    assert.match(html, /<div class="chargement-initial__progression" aria-hidden="true"><\/div>/)
  })

  test('au-delà de 2 minutes : proposer de recharger, pas d’attendre indéfiniment', () => {
    assert.match(html, /Si rien ne s’affiche après 2 minutes, rechargez la page\./)
  })

  test('aucun script inline ajouté : toujours un seul module', () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => m[1].trim() !== 'type="application/ld+json"')
    assert.equal(scripts.length, 1)
    assert.doesNotMatch(html, /<style\b|\sstyle=/i)
  })
})

describe('P0-U6 : progression figurée 60 s (src/chargement.css)', () => {
  test('barre : fond magenta du thème, piste blanche translucide, remplissage 60 s', () => {
    assert.match(css, /\.chargement-initial__progression \{/)
    assert.match(css, /background-image: linear-gradient\(#ff2e9a, #ff2e9a\)/)
    assert.match(css, /animation: chargement-progression 60s linear forwards/)
    assert.match(css, /@keyframes chargement-progression \{/)
    assert.match(css, /to \{\s*background-size: 100% 100%;\s*\}/)
  })

  test('délais honnêtes : message de réveil à 6 s, proposition de recharger à 120 s', () => {
    assert.match(css, /\.chargement-initial__lent \{[\s\S]*?animation: chargement-apparition 0\.4s ease-out 6s forwards/)
    assert.match(css, /\.chargement-initial__long \{[\s\S]*?animation: chargement-apparition 0\.4s ease-out 120s forwards/)
  })

  test('mouvement réduit : barre masquée, texte conservé', () => {
    const reduit = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
    assert.match(reduit, /\.chargement-initial__progression \{\s*display: none;/)
  })

  test('la barre est figurée, pas mesurée : le commentaire le dit', () => {
    assert.match(css, /n'est PAS/)
    assert.match(css, /une mesure réelle/)
  })
})

describe('P0-U6 : décision documentée (docs/DEPLOIEMENT.md § 7, render.yaml)', () => {
  test('§ 7 : parcours < 30 s à froid explicitement impossible, pas un correctif manqué', () => {
    assert.match(deploiement, /## 7\. Réveil Render — décision P0-U6/)
    assert.match(deploiement, /Le parcours < 30 s à froid reste donc impossible/)
    assert.match(deploiement, /le seul correctif certain est le plan payant/)
  })

  test('§ 7 : option payante isolée — prix Starter 7 $/mois vérifié, rien acheté', () => {
    assert.match(deploiement, /plan Starter, 7 \$\/mois/)
    assert.match(deploiement, /Rien n'a été acheté/)
    assert.match(deploiement, /aucun plan n'a été changé/)
  })

  test('§ 7 : keep-alive écarté, avec les raisons chiffrées (quota 750 h)', () => {
    assert.match(deploiement, /Le keep-alive est écarté/)
    assert.match(deploiement, /750 h/)
    assert.match(deploiement, /~1 488 h\/mois/)
    assert.match(deploiement, /Il n'est pas garanti/)
  })

  test('§ 7 : mesure à froid non mesurée, dit honnêtement', () => {
    assert.match(deploiement, /Aucune mesure à froid réelle dans ce lot/)
    assert.match(deploiement, /la production n'a pas été touchée/)
  })

  test('render.yaml : plan free inchangé sur les deux services, option Starter en commentaire seulement', () => {
    assert.equal((yaml.match(/^    plan: free$/gm) ?? []).length, 2)
    assert.doesNotMatch(yaml, /^    plan: starter$/m)
    assert.match(yaml, /plan: starter/)
    assert.match(yaml, /~7 \$\/mois/)
    assert.match(yaml, /NE PAS le faire sans décision explicite/)
  })
})

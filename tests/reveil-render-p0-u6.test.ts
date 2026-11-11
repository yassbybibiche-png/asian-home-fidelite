// P0-U6 — Réveil Render : écran d'attente honnête (AUDIT.md §7, docs/DEPLOIEMENT.md § 7).
// Décision : ni plan payant (acheté), ni keep-alive — un message conditionnel qui n'affirme pas la
// cause (« le serveur PEUT mettre environ 1 minute à se réveiller ») + un indicateur indéterminé
// (il signale l'attente, il ne mesure rien — correctif revue Codex, points 2 et 3). Limite
// architecturale documentée (§ 7.1, point 1) : pendant le réveil, Render affiche sa propre page —
// cet écran n'est servi qu'une fois le serveur réveillé. Le parcours < 30 s à froid reste
// impossible : c'est documenté explicitement dans docs/DEPLOIEMENT.md § 7.1, pas masqué.
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

/** Bloc d'une règle CSS (`selecteur { … }`), pour affirmer les propriétés dans LA règle, pas ailleurs. */
function blocCss(selecteur: string): string {
  const m = css.match(new RegExp(`${selecteur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([\\s\\S]*?)\\n\\}`))
  assert.ok(m, `règle ${selecteur} absente de src/chargement.css`)
  return m[1]
}

describe('P0-U6 : écran d’attente honnête (index.html)', () => {
  test('message conditionnel : il n’affirme pas la cause, pas « la première fois »', () => {
    assert.match(html, /Le chargement prend plus de temps que prévu\. Après une période sans visite, le serveur peut mettre environ 1 minute à se réveiller — merci de patienter\./)
    assert.doesNotMatch(html, /Connexion lente : merci de patienter quelques secondes\./)
    assert.doesNotMatch(html, /la première fois/)
    // « Chargement… » reste le texte initial (serveur éveillé : quelques secondes, écran remplacé avant 6 s).
    assert.match(html, />Chargement…</)
  })

  test('barre de progression indéterminée présente, sans JS (un seul élément, fond animé)', () => {
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

describe('P0-U6 : indicateur indéterminé (src/chargement.css)', () => {
  test('barre : segment magenta du thème sur piste blanche translucide, va-et-vient infini', () => {
    const bloc = blocCss('.chargement-initial__progression')
    assert.match(bloc, /background-image: linear-gradient\(90deg, transparent, #ff2e9a, transparent\)/)
    assert.match(bloc, /background-size: 40% 100%/)
    assert.match(bloc, /animation: chargement-progression 1\.8s ease-in-out infinite alternate/)
    assert.doesNotMatch(bloc, /60s|forwards/, 'pas de remplissage déterminé de 60 s (revue Codex, point 3)')
    const images = blocCss('@keyframes chargement-progression')
    assert.match(images, /from \{\s*background-position: -40% 0;/)
    assert.match(images, /to \{\s*background-position: 140% 0;/)
  })

  test('délais : message de réveil à 6 s, proposition de recharger à 120 s (dans leurs règles)', () => {
    assert.match(blocCss('.chargement-initial__lent'), /animation: chargement-apparition 0\.4s ease-out 6s forwards/)
    assert.match(blocCss('.chargement-initial__long'), /animation: chargement-apparition 0\.4s ease-out 120s forwards/)
  })

  test('mouvement réduit : barre masquée, texte conservé', () => {
    const reduit = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
    assert.match(reduit, /\.chargement-initial__progression \{\s*display: none;/)
  })

  test('la barre est indéterminée, pas mesurée : le commentaire le dit', () => {
    assert.match(css, /INDÉTERMINÉ/)
    assert.match(css, /elle ne mesure rien/)
  })
})

describe('P0-U6 : décision documentée (docs/DEPLOIEMENT.md § 7, render.yaml)', () => {
  test('§ 7 : parcours < 30 s à froid explicitement impossible, pas un correctif manqué', () => {
    assert.match(deploiement, /## 7\. Réveil Render — décision P0-U6/)
    assert.match(deploiement, /Le parcours < 30 s à froid reste donc impossible/)
    assert.match(deploiement, /le seul correctif certain est le plan payant/)
  })

  test('§ 7.1 : limite architecturale — page Render pendant le réveil, écran servi après', () => {
    assert.match(deploiement, /Limite architecturale/)
    assert.match(deploiement, /sa propre page de chargement/)
    assert.match(deploiement, /n'arrive qu'une fois le serveur réveillé/)
  })

  test('§ 7 : option payante isolée — prix Starter indicatif, sources nommées, rien acheté', () => {
    assert.match(deploiement, /Prix indicatif/)
    assert.match(deploiement, /environ 7 \$\/mois/)
    assert.match(deploiement, /À confirmer dans le dashboard Render avant tout achat/)
    for (const source of ['kuberns.com/blogs/render-pricing/', 'budgetforge.dev/tools/render-pricing-2026', 'cloudpicked.com/render-review-en.html', 'agentdeals.dev/hosting-pricing', 'bex.co/blog/2026/09/20/free-tier-dead-2026-zero-to-free-side-project-paas']) {
      assert.ok(deploiement.includes(source), `source de corroboration absente : ${source}`)
    }
    assert.match(deploiement, /Rien n'a été acheté/)
    assert.match(deploiement, /aucun plan n'a été changé/)
  })

  test('§ 7 : keep-alive écarté, avec les raisons chiffrées (quota 750 h, mois de 31 et 30 jours)', () => {
    assert.match(deploiement, /Le keep-alive est écarté/)
    assert.match(deploiement, /750 h/)
    assert.match(deploiement, /~1 488 h\/mois pour un mois de 31 jours \(1 440 h pour un mois de 30 jours\)/)
    assert.match(deploiement, /le ping ne garantit donc pas une disponibilité continue/)
  })

  test('§ 7 : mesure à froid non mesurée, dit honnêtement', () => {
    assert.match(deploiement, /Aucune mesure à froid réelle dans ce lot/)
    assert.match(deploiement, /la production n'a pas été touchée/)
  })

  test('render.yaml : plan free sur chaque service (rattaché au nom du service), option Starter en commentaire seulement', () => {
    // Découpage par service, sans importer le mini-lecteur (un import exécuterait ses tests deux fois).
    const prod = yaml.slice(yaml.indexOf('name: asian-home-fidelite\n'), yaml.indexOf('name: asian-home-fidelite-staging'))
    const staging = yaml.slice(yaml.indexOf('name: asian-home-fidelite-staging'))
    // `plan: free` en clé YAML (début de ligne, pas dans le commentaire qui cite `plan: free` en texte).
    for (const [nom, bloc] of [['production', prod], ['staging', staging]] as const) {
      assert.equal((bloc.match(/^    plan: free$/gm) ?? []).length, 1, `${nom} : une seule clé plan: free`)
      assert.doesNotMatch(bloc, /^    plan: starter$/m, `${nom} : pas de plan starter`)
    }
    assert.doesNotMatch(yaml, /^    plan: starter$/m)
    assert.match(yaml, /plan: starter/)
    assert.match(yaml, /indicatif — à confirmer dans le dashboard/)
    assert.match(yaml, /NE PAS le faire sans décision explicite/)
  })
})

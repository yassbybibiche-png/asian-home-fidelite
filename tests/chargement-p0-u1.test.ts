// P0-U1 — Fin de la page blanche : écran de chargement inline dans index.html (CSS pur, compatible CSP),
// puis squelettes de chargement à la place des « Chargement… » en texte sur #/jouer, #/carte, #/menu et #/caisse.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')

const html = lire('index.html')
/** Contenu de <div id="root">…</div> (le loader n'a pas de <div> imbriqué au-delà de son conteneur). */
const racine = html.match(/<div id="root">([\s\S]*?)<\/div>\s*<\/div>/)?.[1] ?? ''

describe('P0-U1 : écran de chargement inline (index.html)', () => {
  test('logo + « Chargement… » visibles dans #root, sans JS', () => {
    assert.match(racine, /class="chargement-initial"/)
    assert.match(racine, /<img class="chargement-initial__logo" src="\/visuels\/logo\.png" alt="Asian Home" width="96" height="96"/)
    assert.ok(existsSync(join(RACINE, 'public', 'visuels', 'logo.png')), 'public/visuels/logo.png introuvable')
    assert.match(racine, />Chargement…</)
    assert.match(racine, /role="status" aria-busy="true"/)
  })

  test('aucun <script> inline ajouté : un seul script, le module de l’application', () => {
    // P2-Q4 : le bloc JSON-LD (données, jamais exécuté) n'est pas un script ; vérifié dans securite-s4 et seo-p2-q4.
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => m[1].trim() !== 'type="application/ld+json"')
    assert.equal(scripts.length, 1)
    assert.match(scripts[0][1], /type="module" src="\/src\/main\.tsx"/)
    assert.equal(scripts[0][2].trim(), '')
    assert.doesNotMatch(html, /\son\w+=/i, 'aucun gestionnaire d’événement inline')
  })

  test('CSS du loader dans une feuille liée (CSP style-src self) : ni <style> ni style=""', () => {
    assert.doesNotMatch(html, /<style\b|\sstyle=/i)
    assert.match(html, /<link rel="stylesheet" href="\/src\/chargement\.css" \/>/)
    const css = lire('src/chargement.css')
    for (const classe of ['.chargement-initial', '.chargement-initial__logo', '.chargement-initial__texte', '.chargement-initial__lent']) {
      assert.ok(css.includes(`${classe} {`), `${classe} absent de src/chargement.css`)
    }
    // DA nocturne : noir + doré.
    assert.match(css, /background: #111111/)
    assert.match(css, /color: #ff2e9a/)
    // CSS pur : pas de ressource externe, pas d'expression.
    assert.doesNotMatch(css, /url\(|@import|expression\(/)
    assert.match(css, /prefers-reduced-motion: reduce/)
  })

  test('disparition au montage : le loader est DANS #root, que React remplace (createRoot, pas d’hydratation)', () => {
    const main = lire('src/main.tsx')
    assert.match(main, /createRoot\(document\.getElementById\('root'\)!\)\.render\(/)
    assert.doesNotMatch(main, /hydrateRoot/, 'hydrateRoot garderait le HTML du loader et le mélangerait à l’app')
    // Rien du loader hors de #root : sinon il resterait affiché à côté de l'application.
    const horsRacine = html.replace(racine, '')
    assert.doesNotMatch(horsRacine, /chargement-initial/)
    // Et l'application ne le recrée nulle part (pas de doublon après montage).
    for (const f of ['src/App.tsx', 'src/components/Squelette.tsx', 'src/main.tsx']) assert.doesNotMatch(lire(f), /chargement-initial/, f)
  })
})

const squelette = lire('src/components/Squelette.tsx')

describe('P0-U1 : composant Squelette', () => {
  test('accessible : role="status" + aria-busy sur le conteneur, formes masquées aux lecteurs d’écran', () => {
    assert.match(squelette, /<div role="status" aria-busy="true" data-squelette/)
    assert.match(squelette, /<div aria-hidden className=\{`animate-pulse /)
    // Texte lisible sous les formes (annoncé par role="status").
    assert.match(squelette, /<p className="text-center text-sm text-gray-600">\{libelle\}<\/p>/)
  })

  test('purement visuel : aucun état, effet, appel réseau ni accès au stockage', () => {
    assert.doesNotMatch(squelette, /\buse(State|Effect|Store|Route|Memo|Callback|Ref)\b|fetch\(|api\.|localStorage|sessionStorage|indexedDB/)
    assert.deepEqual(
      [...squelette.matchAll(/^import .+$/gm)].map((m) => m[0]),
      ["import type { ReactNode } from 'react'"],
    )
  })

  test('un squelette par écran : jeu (roue grisée), carte, menu, caisse', () => {
    for (const nom of ['SqueletteJeu', 'SqueletteCarte', 'SqueletteMenu', 'SqueletteCaisse']) {
      assert.match(squelette, new RegExp(`export function ${nom}\\(\\{ libelle \\}: \\{ libelle: string \\}\\)`), nom)
    }
    // La roue : disque grisé de la taille de la vraie roue (components/Roue.tsx).
    assert.match(squelette, /aspect-square w-full max-w-80 rounded-full/)
  })
})

describe('P0-U1 : squelettes sur les 4 écrans, textes d’erreur inchangés', () => {
  const ECRANS = [
    {
      fichier: 'src/pages/Jouer.tsx',
      squelette: "<SqueletteJeu libelle={t('Un instant, la roue arrive.')} />",
      erreurs: ['<MessagePublic titre="QR code inconnu">Ce QR code ne correspond à aucun commerce.</MessagePublic>', '<HorsLignePublic onReessayer={charger} />'],
    },
    {
      fichier: 'src/pages/CartePublique.tsx',
      squelette: "<SqueletteCarte libelle={t('Un instant, votre carte arrive.')} />",
      erreurs: [
        '<MessagePublic titre="Carte introuvable">Ce lien ne correspond à aucune carte de fidélité.</MessagePublic>',
        '<MessagePublic titre="Carte indisponible">La carte de fidélité de ce commerce n’est plus disponible.</MessagePublic>',
        "if (erreur === 'horsLigne' && !donnees) return <HorsLignePublic onReessayer={charger} />",
      ],
    },
    {
      fichier: 'src/pages/MenuPublic.tsx',
      squelette: "<SqueletteMenu libelle={t('Un instant, le menu arrive.')} />",
      erreurs: [
        '<MessagePublic titre="Menu introuvable">Ce lien ne correspond à aucun commerce.</MessagePublic>',
        '<MessagePublic titre="Menu indisponible">Le menu de ce commerce n’est plus disponible.</MessagePublic>',
        "if (erreur === 'horsLigne' && !donnees) return <HorsLignePublic onReessayer={charger} />",
      ],
    },
    {
      fichier: 'src/pages/Caisse.tsx',
      squelette: '<SqueletteCaisse libelle="Chargement des clients…" />',
      erreurs: ['<MessagePublic titre="Caisse">Hors ligne et aucune donnée en mémoire sur cet appareil.</MessagePublic>'],
    },
  ]

  for (const e of ECRANS) {
    test(`${e.fichier} : squelette au lieu du texte, erreurs inchangées`, () => {
      const t = lire(e.fichier)
      assert.ok(t.includes(e.squelette), `${e.squelette} absent`)
      assert.doesNotMatch(t, /titre="Chargement…"|>Chargement…</, '« Chargement… » en texte nu')
      for (const m of e.erreurs) assert.ok(t.includes(m), `message d’erreur modifié : ${m}`)
    })
  }

  test('caisse : squelette seulement en ligne ; hors ligne sans données, le message reste', () => {
    const t = lire('src/pages/Caisse.tsx')
    assert.ok(t.includes('if (!pret) return <SqueletteCaisse libelle="Ouverture de la caisse…" />'))
    assert.ok(
      t.includes(
        'if (!donnees) return enLigne ? <SqueletteCaisse libelle="Chargement des clients…" /> : <MessagePublic titre="Caisse">Hors ligne et aucune donnée en mémoire sur cet appareil.</MessagePublic>',
      ),
    )
  })

  test('pages commerçant (mode API, accès en cours de lecture) : squelette aussi', () => {
    const t = lire('src/App.tsx')
    assert.ok(t.includes("if (mode === 'api' && !accesPret) return <SqueletteCommercant libelle=\"Chargement…\" />"))
    assert.doesNotMatch(t, />Chargement…</)
  })
})

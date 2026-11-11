// P1-D2 — Corps sombres côté client (AUDIT.md §6.2/§6.3, suite de P0-D1).
// #/jouer, #/carte, #/menu : fond #111111, surfaces #1B1B22 / #26262E, par `src/theme.ts`
// (PAGE_CLIENT_SOMBRE) et les règles `.page-client` de `src/index.css`, branchées dans
// `src/App.tsx`. #/roulette est une page commerçant : elle reste claire (comme la caisse et les
// pages de texte). La carte de fidélité reste un objet clair (`data-surface-claire`).
// Contrastes recalculés ici (WCAG, via `contraste`) — jamais recopiés d'un commentaire.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PAGE_CLIENT_SOMBRE, THEME } from '../src/theme.ts'
import { contraste } from '../src/lib/apparence.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')

const app = lire('src/App.tsx')
const css = lire('src/index.css')
const theme = lire('src/theme.ts')

describe('P1-D2 : périmètre — jouer / carte / menu sombres, roulette et caisse claires', () => {
  test('App.tsx : exactement ces trois pages, branchées dans la branche publique', () => {
    assert.match(app, /const PAGES_CLIENT_SOMBRES: Page\[\] = \['jouer', 'carte', 'menu'\]/)
    // La bascule est sur <main>, autour de la frontière d'erreur : la vue d'erreur de
    // chargement (import différé en échec) reste sombre, elle aussi.
    assert.match(app, /<main className=\{PAGES_CLIENT_SOMBRES\.includes\(page\) \? 'page-client' : 'min-h-dvh'\}>/)
    assert.match(app, /<main className=\{PAGES_CLIENT_SOMBRES[^]*?<ErreurChargementPage key=\{page\}>/s)
    // La liste est exhaustive : ni roulette (commerçant), ni caisse (comptoir), ni pages de texte.
    assert.doesNotMatch(app, /PAGES_CLIENT_SOMBRES[^;]*'(roulette|caisse|desinscription|confidentialite)'/)
  })

  test('le branchement est dans App.tsx seulement : aucune page ne se met elle-même en sombre', () => {
    for (const f of ['src/pages/Jouer.tsx', 'src/pages/CartePublique.tsx', 'src/pages/MenuPublic.tsx', 'src/pages/Roulette.tsx', 'src/components/CarteFidelite.tsx']) {
      assert.doesNotMatch(lire(f), /page-client/, f)
    }
    assert.doesNotMatch(lire('src/pages/Roulette.tsx'), /page-client|PAGE_CLIENT_SOMBRES/)
  })

  test('la carte de fidélité reste un îlot clair (objet, fond configurable par commerce)', () => {
    const fidelite = lire('src/components/CarteFidelite.tsx')
    assert.match(fidelite, /<section\n\s*data-surface-claire/)
    // Le QR garde son fond blanc (zone de silence) : le svg porte bg-white, restauré dans l'îlot.
    assert.match(lire('src/components/ui.tsx'), /className=\{`\$\{className\} bg-white`\}/)
  })
})

describe('P1-D2 : règles .page-client (src/index.css)', () => {
  test('base : fond noir du thème, texte blanc, toute la hauteur', () => {
    const base = css.match(/\.page-client \{([\s\S]*?)\n\}/)?.[1] ?? ''
    assert.match(base, /background-color: var\(--color-nuit-950\)/)
    assert.match(base, /color: var\(--color-white\)/)
    assert.match(base, /min-height: 100dvh/)
  })

  test('composants partagés convertis : carte, titre, surtitre, champ, étiquette, secondaire, lien, pilule', () => {
    for (const selecteur of ['.page-client .carte', '.page-client .titre-carte', '.page-client .surtitre', '.page-client .champ', '.page-client .etiquette', '.page-client .bouton-secondaire', '.page-client .lien', '.page-client .puce']) {
      assert.ok(css.includes(`${selecteur} {`), `${selecteur} absent`)
    }
    // Champ : fond surface2, texte blanc, focus magenta ; pilule sélectionnée : magenta bouton.
    assert.match(css, /\.page-client \.champ \{[\s\S]*?background-color: var\(--color-nuit-800\)/)
    assert.match(css, /\.page-client \.puce\[aria-selected='true'\]/)
    // Bouton primaire inchangé (magenta bouton, blanc) : pas de règle .page-client .bouton.
    assert.doesNotMatch(css, /\.page-client \.bouton \{/)
  })

  test('correspondances clair → sombre présentes (textes, fonds, filets)', () => {
    for (const selecteur of [
      '.page-client .text-gray-900', '.page-client .text-gray-800', '.page-client .text-gray-700', '.page-client .text-gray-600',
      '.page-client .text-magenta-700', '.page-client .text-red-700', '.page-client .text-green-800',
      '.page-client .bg-white', '.page-client .bg-gray-50', '.page-client .bg-gray-100', '.page-client .bg-gray-200',
      '.page-client .bg-fond', '.page-client .ring-gray-900\\/5', '.page-client .border-gray-200', '.page-client .divide-gray-100 > :not(:last-child)',
    ]) {
      assert.ok(css.includes(`${selecteur} {`), `${selecteur} absent`)
    }
  })

  test('alertes sémantiques non converties : aucun fond amber-50 / green-50 / red-50 sous .page-client', () => {
    // Interdit : convertir le fond de l'alerte elle-même (règle `.bg-…-50 {` directe). Autorisé :
    // cibler l'alerte comme ancêtre (le lien « Réessayer » garde le magenta foncé, voir ci-dessous).
    assert.doesNotMatch(css, /\.page-client \.bg-(amber|green|red)-50 \{/)
    assert.doesNotMatch(css, /\.page-client \.text-(amber|green|red)-900 \{/)
  })

  test('lien dans une alerte claire : magenta foncé, pas magenta clair (3,31:1 sur ambre-50)', () => {
    assert.ok(css.includes('.page-client .bg-amber-50 .lien,'), 'règle lien sur alerte ambre absente')
    assert.ok(css.includes('.page-client .bg-green-50 .lien,'), 'règle lien sur alerte verte absente')
    assert.ok(css.includes('.page-client .bg-red-50 .lien'), 'règle lien sur alerte rouge absente')
    const regle = css.match(/\.page-client \.bg-amber-50 \.lien,[\s\S]*?\{([\s\S]*?)\n\}/)?.[1] ?? ''
    assert.match(regle, /color: var\(--color-magenta-700\)/)
    // Contrastes recalculés (le magenta clair vaut 3,31:1 sur ambre-50 — il échoue AA).
    assert.equal(contraste('#ff2e9a', '#fffbeb'), 3.31)
    assert.equal(contraste('#a1005e', '#fffbeb'), 7.56)
    assert.equal(contraste('#a1005e', '#f0fdf4'), 7.49)
    assert.equal(contraste('#a1005e', '#fef2f2'), 7.17)
  })

  test('champ invalide : bordure rouge explicite (le socle aria-invalid était écrasé)', () => {
    assert.match(css, /\.page-client \.champ\[aria-invalid='true'\] \{[\s\S]*?border-color: var\(--color-red-400\)/)
    assert.match(css, /\.page-client \.champ\[aria-invalid='true'\]:focus \{[\s\S]*?border-color: var\(--color-red-400\)/)
    assert.match(css, /\.page-client \.champ\[aria-invalid='true'\]:focus \{[\s\S]*?--tw-ring-color: var\(--color-red-400\)/)
    assert.equal(contraste('#f87171', '#26262e'), 5.43)
  })

  test('restaurations de l’îlot clair : chaque correspondance annulée dans [data-surface-claire]', () => {
    for (const selecteur of [
      '[data-surface-claire] .text-gray-900', '[data-surface-claire] .text-gray-700', '[data-surface-claire] .text-gray-600',
      '[data-surface-claire] .text-magenta-700', '[data-surface-claire] .bg-white', '[data-surface-claire] .bg-gray-50',
      '[data-surface-claire] .bg-gray-100', '[data-surface-claire] .bg-gray-200', '[data-surface-claire] .surtitre',
    ]) {
      assert.ok(css.includes(`.page-client ${selecteur} {`), `${selecteur} absent`)
    }
    // L'élément porteur lui-même : `[data-surface-claire] .bg-white` ne cible que les descendants —
    // sans la règle accolée, le corps de la carte devenait sombre avec des textes gris foncé (illisible).
    assert.ok(css.includes(".page-client [data-surface-claire].bg-white {"), 'restauration de la section elle-même absente')
    assert.match(css, /\.page-client \[data-surface-claire\]\.bg-white \{[\s\S]*?background-color: var\(--color-white\)/)
    // Bouton secondaire dans l'îlot clair (parrainage) : sans restauration, texte blanc sur carte
    // blanche — invisible. Restauration à sa définition claire, survol compris.
    assert.match(css, /\.page-client \[data-surface-claire\] \.bouton-secondaire \{[\s\S]*?background-color: var\(--color-white\)/)
    assert.match(css, /\.page-client \[data-surface-claire\] \.bouton-secondaire \{[\s\S]*?color: var\(--color-gray-800\)/)
    assert.match(css, /\.page-client \[data-surface-claire\] \.bouton-secondaire:hover \{[\s\S]*?background-color: var\(--color-gray-50\)/)
  })

  test('carte de gain : dégradé clair remplacé par un dégradé sombre (seul dégradé clair côté client)', () => {
    assert.ok(css.includes(".page-client [data-resultat='gain'] {"), 'règle de la carte de gain absente')
    const regle = css.match(/\.page-client \[data-resultat='gain'\] \{([\s\S]*?)\n\}/)?.[1] ?? ''
    assert.match(regle, /background-image: linear-gradient\(to bottom/)
    assert.match(regle, /var\(--color-nuit-900\)/, 'le bas du dégradé doit être nuit (texte blanc 17,12:1)')
    assert.doesNotMatch(regle, /white|#fff/i, 'aucun blanc dans le dégradé de la carte de gain')
    // Le bas du dégradé est nuit-900, pas nuit-950 : blanc = 17,12:1 (18,88:1, c'est sur nuit-950).
    assert.equal(contraste('#ffffff', '#1b1b22'), 17.12)
  })

  test('aucun hex en dur dans le bloc .page-client (tokens et blancs translucides seulement)', () => {
    const bloc = css.slice(css.indexOf('Corps sombres côté client (P1-D2'))
    assert.ok(bloc.length > 1000, 'bloc P1-D2 introuvable dans index.css')
    assert.doesNotMatch(bloc, /#[0-9a-fA-F]{3,8}\b/, 'hex en dur dans le bloc P1-D2 — passer par theme.ts')
    // La garde ambre (P0-D1, tests/theme.test.ts) couvre déjà index.css : pas de doublon ici.
  })
})

describe('P1-D2 : contrastes AA recalculés (ne pas recopier les chiffres de l’AUDIT)', () => {
  test('table PAGE_CLIENT_SOMBRE : valeurs du thème + gris Tailwind centralisés', () => {
    assert.equal(PAGE_CLIENT_SOMBRE.fond, THEME.noir)
    assert.equal(PAGE_CLIENT_SOMBRE.surface, THEME.surface)
    assert.equal(PAGE_CLIENT_SOMBRE.surface2, THEME.surface2)
    assert.equal(PAGE_CLIENT_SOMBRE.texte, THEME.blanc)
    assert.equal(PAGE_CLIENT_SOMBRE.accent, THEME.magenta400)
    assert.equal(PAGE_CLIENT_SOMBRE.texteSecondaire, '#e5e7eb')
    assert.equal(PAGE_CLIENT_SOMBRE.texteAttenue, '#d1d5db')
    assert.equal(PAGE_CLIENT_SOMBRE.texteDiscret, '#9ca3af')
  })

  test('textes gris sur fond noir ET sur surface : tous ≥ 4,5:1', () => {
    const paires: [string, string][] = [
      [PAGE_CLIENT_SOMBRE.texte, PAGE_CLIENT_SOMBRE.fond],
      [PAGE_CLIENT_SOMBRE.texteSecondaire, PAGE_CLIENT_SOMBRE.fond],
      [PAGE_CLIENT_SOMBRE.texteAttenue, PAGE_CLIENT_SOMBRE.fond],
      [PAGE_CLIENT_SOMBRE.texteDiscret, PAGE_CLIENT_SOMBRE.fond],
      [PAGE_CLIENT_SOMBRE.texte, PAGE_CLIENT_SOMBRE.surface],
      [PAGE_CLIENT_SOMBRE.texteSecondaire, PAGE_CLIENT_SOMBRE.surface],
      [PAGE_CLIENT_SOMBRE.texteAttenue, PAGE_CLIENT_SOMBRE.surface],
      [PAGE_CLIENT_SOMBRE.texteDiscret, PAGE_CLIENT_SOMBRE.surface],
    ]
    for (const [texte, fond] of paires) assert.ok(contraste(texte, fond) >= 4.5, `${texte} sur ${fond} = ${contraste(texte, fond)}`)
    assert.equal(contraste('#ffffff', '#111111'), 18.88)
    assert.equal(contraste('#e5e7eb', '#111111'), 15.25)
    assert.equal(contraste('#d1d5db', '#111111'), 12.81)
    assert.equal(contraste('#9ca3af', '#111111'), 7.44)
    assert.equal(contraste('#9ca3af', '#1b1b22'), 6.74)
  })

  test('accent magenta clair en texte : AA sur fond et surface, jamais sur surface2', () => {
    assert.equal(contraste('#ff2e9a', '#111111'), 5.49)
    assert.equal(contraste('#ff2e9a', '#1b1b22'), 4.98)
    assert.equal(contraste('#ff4d6d', '#1b1b22'), 5.33)
    // Limite documentée (theme.ts) : 4,37:1 sur surface2 — aucun texte magenta sur un champ sombre.
    assert.equal(contraste('#ff2e9a', '#26262e'), 4.37)
    assert.ok(contraste('#ff2e9a', '#26262e') < 4.5)
    assert.doesNotMatch(css, /\.page-client \.champ \{[^}]*magenta/)
  })

  test('états colorés sur fond sombre : erreur, ok, note d’étoiles, placeholder', () => {
    assert.equal(contraste(PAGE_CLIENT_SOMBRE.erreur, '#111111'), 9.95)
    assert.equal(contraste(PAGE_CLIENT_SOMBRE.erreur, '#1b1b22'), 9.02)
    assert.equal(contraste(PAGE_CLIENT_SOMBRE.ok, '#111111'), 13.45)
    assert.equal(contraste(PAGE_CLIENT_SOMBRE.ok, '#1b1b22'), 12.19)
    assert.equal(contraste(PAGE_CLIENT_SOMBRE.noteEtoiles, '#111111'), 18.88)
    assert.equal(contraste(PAGE_CLIENT_SOMBRE.noteEtoiles, '#1b1b22'), 17.12)
    // Placeholder : blanc à 65 % sur surface2 = #b3b3b6 (mélange calculé, pas deviné).
    assert.equal(contraste('#b3b3b6', '#26262e'), 7.18)
  })

  test('écart à la spec tampon de l’AUDIT §6.3, conservé depuis P0-D1 (cercle #FF2E9A + coche blanche = 3,44:1, sous le seuil AA du texte courant)', () => {
    assert.equal(contraste('#ffffff', '#ff2e9a'), 3.44)
    assert.ok(contraste('#ffffff', '#ff2e9a') < 4.5, 'la spec AUDIT §6.3 est sous le seuil AA du texte (4,5:1)')
    // La coche est un indicateur graphique (seuil non-texte 3:1), mais le tampon est traité comme
    // texte par prudence : il garde donc blanc sur magenta bouton (5,33:1) ; le magenta clair
    // n’est qu’un contour.
    assert.equal(contraste('#ffffff', '#d1006f'), 5.33)
    assert.match(css, /\.tampon-nouveau \{[\s\S]*?box-shadow: 0 0 0 3px var\(--color-magenta-400\)/)
    assert.match(theme, /3,44:1/)
  })
})

describe('P1-D2 : note DA mise à jour (SCORES.md)', () => {
  test('section P1-D2 présente, avec une ligne par écran client', () => {
    const scores = lire('SCORES.md')
    assert.match(scores, /## Cohérence DA \/10 par écran — après P1-D2/)
    for (const ecran of ['Jouer', 'Carte', 'Menu public']) assert.ok(scores.includes(ecran), ecran)
  })
})

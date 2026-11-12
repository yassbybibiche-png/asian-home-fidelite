// Boucle roue v2 R-t1 (polish visuel) : libellés de la moitié gauche retournés (lisibles au repos), teintes du commerce
// étendues à la légende et au cadre du jeu (CSS), émoji 🎡 du bouton remplacé à l'affichage par un signe dessiné en CSS.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { accentRoue, styleLegende, teintesRoue } from '../src/lib/roue.ts'
import { contraste, melanger } from '../src/lib/apparence.ts'
import { THEME } from '../src/theme.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')
const roue = lire('src/components/Roue.tsx')
const css = lire('src/index.css')

describe('R-t1 : libellés de la moitié gauche lisibles', () => {
  test('secteur dont le milieu est à gauche (> 180°) : +90° au lieu de −90° (retournement sur l’axe du secteur)', () => {
    assert.match(roue, /rotate\(\$\{milieu\}\) translate\(0 -\$\{RAYON_LIBELLE\}\) rotate\(\$\{milieu > 180 \? 90 : -90\}\)/)
    // Géométrie et numéros inchangés.
    assert.match(roue, /`rotate\(\$\{milieu\}\) translate\(0 -72\)`/)
  })
})

describe('R-t1 : teintes du commerce sur la légende et le cadre', () => {
  test('la légende porte les variables de la roue ; le CSS les utilise pour le titre, les pastilles et le cadre', () => {
    assert.match(roue, /<div style=\{styleLegende\(useContext\(ContexteRoue\)\.couleur\)\}>/)
    assert.doesNotMatch(roue, /ring-magenta-400\/60|text-magenta-300/)
    assert.match(css, /\[data-roue\] \+ div > h2 \{[^}]*color: var\(--roue-texte\);/)
    assert.match(css, /\.pastille-roue \{[^}]*--tw-ring-color: color-mix\(in srgb, var\(--roue-clair\) 60%, transparent\);/)
    assert.match(css, /@supports selector\(:has\(a\)\) \{\s*\.hero-sombre:has\(> \[data-roue\]\) \{/)
  })

  test('sans couleur de commerce : magenta du thème (titre en magenta 400)', () => {
    assert.equal(teintesRoue()['--roue-clair'], THEME.magenta400)
    assert.equal(teintesRoue()['--roue-nuit'], THEME.magenta900)
    assert.equal(styleLegende()['--roue-texte'], THEME.magenta400)
  })

  test('titre en --roue-texte : ≥ 4,5:1 sur le cadre (fonds nuit sous le titre), pour toute couleur acceptée', () => {
    let essais = 0
    for (let r = 0; r <= 255; r += 51) {
      for (let g = 0; g <= 255; g += 51) {
        for (let b = 0; b <= 255; b += 51) {
          const c = `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`
          if (!accentRoue(c)) continue
          const s = styleLegende(c)
          // Le titre est hors des deux halos (fondus à 55 %) : fond = dégradé nuit 950 → nuit 900 → --roue-nuit.
          for (const fond of [THEME.surface, THEME.noir, s['--roue-nuit'], melanger(THEME.surface, s['--roue-nuit'], 0.5)]) {
            assert.ok(contraste(s['--roue-texte'], fond) >= 4.5, `${c} sur ${fond} : ${contraste(s['--roue-texte'], fond).toFixed(2)}`)
          }
          // Pas plus clair que nécessaire : la teinte du commerce est gardée quand elle suffit.
          if (contraste(s['--roue-clair'], THEME.surface) >= 4.5) assert.equal(s['--roue-texte'], s['--roue-clair'])
          essais++
        }
      }
    }
    assert.ok(essais > 50, `${essais} couleurs`)
  })
})

describe('R-t1 : signe du bouton « Tourner » sans émoji multicolore', () => {
  test('émoji réduit à rien (::first-letter du bouton actif) et signe dessiné en CSS à la couleur du texte', () => {
    assert.match(css, /\.bouton\.w-full\.py-4\.text-lg \{\s*display: block;\s*\}/)
    const regle = css.match(/\.bouton\.w-full\.py-4\.text-lg:enabled::first-letter \{([^}]*)\}/)?.[1] ?? ''
    assert.match(regle, /font-size: 0;/)
    assert.match(regle, /border: 2px solid;/)
    assert.equal(regle.match(/currentColor/g)?.length, 4, 'moyeu + trois diamètres à la couleur du texte')
    assert.doesNotMatch(regle, /#[0-9a-f]{3,8}\b|magenta/i)
  })

  test('seuls les boutons « Tourner » portent ces classes ; actifs = libellé à émoji, désactivés = texte d’attente', () => {
    const jouer = lire('src/pages/Jouer.tsx')
    const boutons = [...jouer.matchAll(/<button className="bouton w-full py-4 text-lg"([^\n]*)>\n\s*([^\n]*)/g)]
    assert.equal(boutons.length, 3)
    for (const [, attributs, contenu] of boutons) {
      // Un libellé qui ne commence pas par l'émoji n'est jamais affiché bouton actif.
      if (/disabled>/.test(attributs + '>')) assert.match(contenu, /La roue tourne…/)
      else assert.match(contenu, /\? t\('(La roue tourne…|Tirage en cours…)'\) : t\('🎡 Tourner la roue\{prenom\} !'/)
    }
    for (const f of ['src/pages/CartePublique.tsx', 'src/pages/Reglement.tsx', 'src/pages/Caisse.tsx', 'src/components/ApercuRoue.tsx']) {
      assert.doesNotMatch(lire(f), /bouton w-full py-4 text-lg/, f)
    }
  })
})

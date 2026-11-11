// P1-U1 — Mesure du parcours comptoir après refonte : SCORES.md contient la re-mesure
// (2 passes locales, même protocole que P0-U0), avec l'arithmétique exacte des totaux
// du parcours et les limites honnêtes (pas de téléphone réel, pas de mesure à froid).
// Aucun changement de code dans ce lot : ce fichier ne teste que le document de mesure.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RACINE = join(import.meta.dirname, '..')
const scores = readFileSync(join(RACINE, 'SCORES.md'), 'utf8')

describe('P1-U1 : re-mesure après refonte (SCORES.md)', () => {
  test('section DA après P1-U1 présente, moyenne 8,0/10 calculée depuis le tableau', () => {
    assert.match(scores, /## Cohérence DA \/10 par écran — après P1-U1/)
    const section = scores.split('## Cohérence DA /10 par écran — après P1-U1')[1].split('## Seuils de réussite')[0]
    assert.match(section, /Moyenne : 8,0\/10 \(inchangée depuis P1-D2\)/)
    const notes = [...section.matchAll(/^\| ([^|]+) \| (\d+)\/10 \|/gm)].map((m) => Number(m[2]))
    assert.equal(notes.length, 8, `8 notes DA attendues, lues : ${notes}`)
    const moyenne = notes.reduce((a, b) => a + b, 0) / notes.length
    assert.equal(moyenne, 8, `moyenne DA calculée ${moyenne} ≠ 8,0 publiée`)
    for (const ecran of ['Jouer', 'Carte', 'Caisse', 'Menu public', 'Tableau de bord', 'Clients', 'Roulette', 'Réglages']) {
      assert.ok(section.includes(ecran), ecran)
    }
  })

  test('parcours scan → lot P1-U1 : 2 passes, totaux extraits du tableau et re-calculés', () => {
    const section = scores.split('### Re-mesure P1-U1 (11/11/2026 ~08:45 UTC, 2 passes, même protocole)')[1].split('## Cohérence DA')[0]
    assert.ok(section, 'sous-section parcours P1-U1 absente')
    // Lignes « | Étape | <passe 1> ms | <passe 2> ms | » ; le total est re-calculé, pas recopié.
    const lignes = [...section.matchAll(/^\| ([^|]+) \| \*{0,2}(\d+) ms\*{0,2} \| \*{0,2}(\d+) ms\*{0,2} \|$/gm)]
    assert.equal(lignes.length, 5, `5 lignes attendues (4 étapes + total), lues : ${lignes.length}`)
    const total = lignes.find((l) => l[1].includes('Total des étapes'))
    assert.ok(total, 'ligne total absente')
    const etapes = lignes.filter((l) => l !== total)
    assert.equal(etapes.length, 4)
    assert.equal(etapes.reduce((n, l) => n + Number(l[2]), 0), Number(total[2]), 'total passe 1 incohérent avec ses étapes')
    assert.equal(etapes.reduce((n, l) => n + Number(l[3]), 0), Number(total[3]), 'total passe 2 incohérent avec ses étapes')
    assert.ok(Number(total[2]) < 30_000 && Number(total[3]) < 30_000, 'totaux sous 30 s')
    assert.match(section, /Taps identiques.*client \*\*4 clics \+ 1 saisie\*\*/)
    assert.match(section, /caisse \*\*3 clics \+ 2 saisies\*\*/)
    assert.match(section, /Parcours < 30 s à chaud : étapes scriptées sous 30 s, vérifié/)
    assert.match(section, /critère complet avec gestes et attente humains \*\*n'est pas vérifié\*\*/)
  })

  test('Lighthouse P1-U1 : score 79 identique sur les deux passes, pas de téléphone réel prétendu', () => {
    assert.match(scores, /Score performance : 79.*\(score identique sur les deux passes/)
    assert.match(scores, /pas de\s+mesure Lighthouse sur téléphone réel/)
  })

  test('limites honnêtes : à froid et téléphone réel non mesurés, protocole documenté', () => {
    assert.match(scores, /## Protocole téléphone réel \(P1-U1 — non exécuté sur cette VM, à faire sur staging\)/)
    assert.match(scores, /Délai à froid Render \(~60 s\) : \*\*toujours non mesuré\*\*/)
    assert.match(scores, /à froid\s+téléphone réel : \*\*non mesuré\*\*/i)
    assert.match(scores, /npm audit.*même 403, inchangé/s)
  })

  test('bundle P1-U1 : JS + CSS = total, dans la section Bundle', () => {
    const bundle = scores.split('## Bundle (build frais, mode par défaut, 11/11/2026 — après P1-U1)')[1].split('## Couverture de tests')[0]
    const js = Number(bundle.match(/JS initial non gzipé : (\d+) o/)?.[1])
    const css = Number(bundle.match(/CSS non gzipé : (\d+) o/)?.[1])
    const total = Number(bundle.match(/Total initial : (\d+) o/)?.[1])
    assert.equal(js + css, total, `${js} + ${css} ≠ ${total}`)
    assert.equal(js, 472745)
    assert.equal(css, 70664)
    assert.equal(total, 543409)
  })
})

// P0-D1 — Thème noir+magenta isolé (AUDIT.md §6) : `src/theme.ts` source effective unique,
// `src/index.css` (`@theme`) n'en est que le miroir ; garde anti-régression (aucun hex hors
// thème, aucun doré) et contrastes AA recalculés (ne pas recopier l'ancien « 8,9:1 », faux).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { COULEURS_CONFETTIS, COULEURS_ROUE, THEME } from '../src/theme.ts'
import { COULEUR_DEFAUT, FOND_DEFAUT, contraste, problemesApparence } from '../src/lib/apparence.ts'
import { COULEURS, couleurSecteur, couleurTexte } from '../src/lib/roue.ts'
import { COULEURS_CONFETTIS as CONFETTIS_ANIMATION } from '../src/lib/animationRoue.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')
const VALEURS_THEME = new Set(Object.values(THEME))
const HEX = /#[0-9a-fA-F]{3,8}\b/g

function fichiers(dossier: string, ext: RegExp): string[] {
  const sortis: string[] = []
  const visiter = (d: string) => {
    for (const e of readdirSync(join(RACINE, d))) {
      const p = join(d, e)
      if (statSync(join(RACINE, p)).isDirectory()) visiter(p)
      else if (ext.test(e)) sortis.push(p)
    }
  }
  visiter(dossier)
  return sortis.sort()
}

const TSX = fichiers('src', /\.(ts|tsx)$/)
const CSS_THEME = ['src/index.css', 'src/chargement.css', 'public/hors-ligne.css', 'index.html', 'public/manifest.webmanifest']

describe('P0-D1 : palette magenta retenue', () => {
  test('valeurs exactes (AUDIT.md §6.2) — la teinte est ajustable en 1 changement dans theme.ts', () => {
    assert.equal(THEME.magenta400, '#ff2e9a')
    assert.equal(THEME.magenta300, '#ff4d6d')
    assert.equal(THEME.magenta500, '#d1006f')
    assert.equal(THEME.magenta600, '#c4007a')
    assert.equal(THEME.magenta700, '#a1005e')
    assert.equal(THEME.magenta900, '#2a0a1e')
    assert.equal(THEME.noir, '#111111')
    assert.equal(THEME.surface, '#1b1b22')
    assert.equal(THEME.surface2, '#26262e')
    assert.equal(THEME.fondClair, '#f7f5f2')
    assert.equal(THEME.laque500, '#b3262d')
  })

  test('contrastes recalculés (WCAG) : magenta clair en texte sur noir, foncé en fond de bouton', () => {
    assert.equal(contraste('#ff2e9a', '#111111'), 5.49)
    assert.equal(contraste('#ff4d6d', '#111111'), 5.88)
    assert.equal(contraste('#ffffff', '#d1006f'), 5.33)
    assert.equal(contraste('#ffffff', '#c4007a'), 5.79)
    assert.equal(contraste('#ffffff', '#a1005e'), 7.84)
    assert.equal(contraste('#ffffff', '#b3262d'), 6.5)
    assert.equal(contraste('#a1005e', '#f7f5f2'), 7.21)
    assert.equal(contraste('#c4007a', '#f7f5f2'), 5.32)
    // Bandeau sombre gris-800 (App.tsx, commerce désactivé) : magenta doux dessus = 4,57:1, juste au-dessus d'AA.
    assert.equal(contraste('#ff4d6d', '#1f2937'), 4.57)
    // L'ancien commentaire CSS affirmait « or #c9a227 sur #111111 ≈ 8,9:1 » : faux, le vrai calcul donne 7,81:1.
    assert.equal(contraste('#c9a227', '#111111'), 7.81)
  })

  test('règles négatives : jamais l’inverse (magenta foncé en texte sur noir, clair sur fond clair)', () => {
    assert.ok(contraste('#d1006f', '#111111') < 4.5, 'magenta bouton en texte sur noir : 3,54:1')
    assert.ok(contraste('#c4007a', '#111111') < 4.5, 'magenta survol en texte sur noir : 3,26:1')
    assert.ok(contraste('#ff2e9a', '#f7f5f2') < 4.5, 'magenta clair en texte sur ivoire : 3,16:1')
    assert.ok(contraste('#ffffff', '#ff2e9a') < 4.5, 'blanc sur magenta clair : 3,44:1')
  })

  test('défauts apparence par commerce : couleur magenta, fond ivoire conservé', () => {
    assert.equal(COULEUR_DEFAUT, '#d1006f')
    assert.equal(FOND_DEFAUT, '#fbf8f3')
    assert.deepEqual(problemesApparence({ couleur: COULEUR_DEFAUT, fond: FOND_DEFAUT }), [])
  })
})

describe('P0-D1 : source unique — aucun hex hors theme.ts', () => {
  test('aucun hex dans src/**/*.ts(x) sauf theme.ts', () => {
    const fautifs = TSX.filter((f) => f !== 'src/theme.ts').flatMap((f) => {
      const m = lire(f).match(HEX)
      return m ? [`${f} : ${[...new Set(m)].join(', ')}`] : []
    })
    assert.deepEqual(fautifs, [])
  })

  test('aucun doré : ni token or-*, ni hex doré, ni .titre-or, ni neon-500', () => {
    const motif = /or-300|or-400|or-500|#c9a227|#d4a73c|#f2d48a|titre-or|neon-500/
    const fautifs = [...TSX, ...CSS_THEME].filter((f) => motif.test(lire(f)))
    assert.deepEqual(fautifs, [])
  })

  test('aucun usage marque-* (laque) dans les composants : l’échelle ne vit que dans theme.ts / @theme', () => {
    const fautifs = TSX.filter((f) => f !== 'src/theme.ts' && /marque-/.test(lire(f)))
    assert.deepEqual(fautifs, [])
  })

  test('@theme est le miroir exact de theme.ts (aucune valeur propre)', () => {
    const css = lire('src/index.css')
    const attendu: Record<string, string> = {
      'magenta-300': THEME.magenta300,
      'magenta-400': THEME.magenta400,
      'magenta-500': THEME.magenta500,
      'magenta-600': THEME.magenta600,
      'magenta-700': THEME.magenta700,
      'magenta-900': THEME.magenta900,
      'marque-50': THEME.laque50,
      'marque-100': THEME.laque100,
      'marque-200': THEME.laque200,
      'marque-300': THEME.laque300,
      'marque-500': THEME.laque500,
      'marque-600': THEME.laque600,
      'marque-700': THEME.laque700,
      'marque-800': THEME.laque800,
      'nuit-950': THEME.noir,
      'nuit-900': THEME.surface,
      'nuit-800': THEME.surface2,
      fond: THEME.fondClair,
      'violet-nuit': THEME.violetNuit,
    }
    const lus: Record<string, string> = {}
    for (const m of css.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6});/g)) lus[m[1]] = m[2]
    assert.deepEqual(lus, attendu)
  })

  test('chaque hex des feuilles miroirs (index.css, chargement, hors-ligne, index.html, manifest) est une valeur du thème', () => {
    for (const f of CSS_THEME) {
      const inconnus = [...new Set(lire(f).match(HEX) ?? [])].filter((h) => !VALEURS_THEME.has(h.toLowerCase() as never))
      assert.deepEqual(inconnus, [], f)
    }
  })
})

describe('P0-D1 : magenta clair en texte seulement sur fond sombre', () => {
  test('text-magenta-300/400 : fond sombre adjacent (hero-sombre, bg-nuit-950) ou contexte prouvé', () => {
    for (const f of TSX) {
      const s = lire(f)
      for (const m of s.matchAll(/\btext-magenta-(300|400)\b/g)) {
        const ligne = s.slice(0, m.index!).split('\n').at(-1) ?? ''
        const avant = s.slice(Math.max(0, m.index! - 1200), m.index)
        const ok = /bg-nuit-950/.test(ligne) || /hero-sombre|bg-nuit-950|bg-gray-800|from-nuit-950/.test(avant)
        // Exceptions prouvées par leur usage, pas par le voisinage :
        // - LegendeRoue (Roue.tsx) : rendue uniquement dans le hero-sombre de #/jouer (asserté ci-dessous) ;
        // - CommutateurLangue sombre (Langue.tsx) : rendu uniquement dans des en-têtes hero-sombre (asserté ci-dessous).
        const exception = f === 'src/components/Roue.tsx' || f === 'src/components/Langue.tsx'
        assert.ok(ok || exception, `${f} : text-magenta-${m[1]} sans fond sombre prouvé`)
      }
    }
  })

  test('LegendeRoue n’est rendue que dans le hero-sombre de #/jouer', () => {
    const usages = TSX.filter((f) => /<LegendeRoue /.test(lire(f)))
    assert.deepEqual(usages, ['src/pages/Jouer.tsx'])
    const jouer = lire('src/pages/Jouer.tsx')
    const debut = jouer.indexOf('<div className="hero-sombre -mx-1 rounded-3xl px-2 py-4 ring-1 ring-magenta-400/30">')
    const usage = jouer.indexOf('<LegendeRoue ')
    assert.ok(debut >= 0 && usage > debut, 'LegendeRoue hors hero-sombre')
  })

  test('CommutateurLangue sombre : rendu uniquement dans des en-têtes hero-sombre', () => {
    for (const f of TSX) {
      const s = lire(f)
      for (const m of s.matchAll(/<CommutateurLangue sombre \/>/g)) {
        assert.match(s.slice(Math.max(0, m.index! - 300), m.index), /hero-sombre/, `${f} : commutateur sombre hors hero-sombre`)
      }
    }
  })

  test('.titre-magenta : défini dans index.css, utilisé uniquement dans un hero-sombre', () => {
    assert.match(lire('src/index.css'), /\.titre-magenta \{/)
    for (const f of TSX) {
      const s = lire(f)
      for (const m of s.matchAll(/titre-magenta/g)) {
        assert.match(s.slice(Math.max(0, m.index! - 600), m.index), /hero-sombre/, `${f} : .titre-magenta hors fond sombre`)
      }
    }
  })
})

describe('P0-D1 : roue et confettis magenta', () => {
  test('secteurs : palette du thème, texte ≥ 4,5:1 sur chaque secteur, jamais deux voisins identiques', () => {
    assert.deepEqual([...COULEURS], [...COULEURS_ROUE])
    for (const c of COULEURS) assert.ok(contraste(couleurTexte(c), c) >= 4.5, `${c} / ${couleurTexte(c)}`)
    assert.equal(couleurTexte('#ff2e9a'), '#111111')
    for (let n = 2; n <= 12; n++) {
      for (let i = 0; i < n; i++) assert.notEqual(couleurSecteur(i, n), couleurSecteur((i + 1) % n, n), `n=${n}, i=${i}`)
    }
  })

  test('confettis : couleurs du thème, même liste dans animationRoue.ts et theme.ts', () => {
    assert.deepEqual([...CONFETTIS_ANIMATION], [...COULEURS_CONFETTIS])
    for (const c of COULEURS_CONFETTIS) assert.ok(VALEURS_THEME.has(c as never), c)
  })
})

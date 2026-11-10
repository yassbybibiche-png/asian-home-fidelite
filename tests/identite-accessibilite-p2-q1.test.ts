// P2-Q1 — Identité & accessibilité : typographie ≥ 16 px pour le contenu, version anglaise des pages clientes,
// contrastes AA, zones tactiles 44 px, lecteur d'écran / clavier. Les .tsx sont vérifiés sur le source.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { contraste } from '../src/lib/apparence.ts'
import {
  CLE_LANGUE,
  estPageTraduite,
  langueValide,
  lireLangue,
  memoriserLangue,
  texteProgressionLangue,
  texteValiditeLangue,
  TRADUCTIONS_EN,
  traduire,
} from '../src/lib/langue.ts'
import { ETAPES_VALIDATION, INTRO_ATTENTE, MESSAGE_ATTENTE_HORS_LIGNE, MESSAGE_VISITE_VALIDEE, TEXTE_ATTENTE } from '../src/lib/attenteVisite.ts'
import {
  NOTE_WALLET,
  TEXTE_CODE_A_MONTRER,
  TEXTE_CODE_UNE_FOIS,
  TEXTE_DEJA_JOUE,
  TEXTE_GAIN_SANS_CODE,
  TEXTE_PERDU_PROCHAINE,
  TEXTE_PERDU_TAMPON,
  texteValidite,
  TITRE_PERDU,
} from '../src/lib/animationRoue.ts'
import { MESSAGE_CONTACT_INVALIDE } from '../src/lib/inscriptionJeu.ts'
import { TEXTE_CONFIRMATION_GOOGLE, TEXTE_INVITATION, libelleBoutonAvis, libelleNote } from '../src/lib/invitationAvis.ts'
import { texteProgression } from '../src/lib/carte.ts'
import { MESSAGE_HORS_LIGNE } from '../src/data/api.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')

function fichiers(dossier: string, ext: RegExp): string[] {
  return readdirSync(join(RACINE, dossier), { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && ext.test(e.name))
    .map((e) => relative(RACINE, join(e.parentPath, e.name)))
}
const TSX = fichiers('src', /\.tsx$/)
const PAGES_CLIENTES = ['src/pages/Jouer.tsx', 'src/pages/CartePublique.tsx', 'src/pages/MenuPublic.tsx']

/** Lignes d'un fichier qui contiennent un motif (pour les messages d'échec). */
function lignes(fichier: string, motif: RegExp): string[] {
  return lire(fichier)
    .split('\n')
    .map((l, i) => [l, i + 1] as const)
    .filter(([l]) => motif.test(l))
    .map(([l, n]) => `${fichier}:${n}: ${l.trim().slice(0, 140)}`)
}

describe('P2-Q1 : typographie', () => {
  const css = lire('src/index.css')

  test('base 17 px ; text-sm relevé à 16 px (contenu) ; text-xs ≥ 12 px', () => {
    assert.match(css, /font-size: 17px/)
    const sm = Number(/--text-sm: ([\d.]+)rem;/.exec(css)?.[1])
    assert.ok(sm * 17 >= 15.99, `text-sm = ${(sm * 17).toFixed(2)} px`)
    // text-xs n'est pas redéfini : 0,75 rem × 17 px = 12,75 px ≥ 12 px.
    assert.doesNotMatch(css, /--text-xs:/)
    assert.ok(0.75 * 17 >= 12)
  })

  test('aucune taille de texte arbitraire sous 16 px (text-[11px], text-[0.8rem]…)', () => {
    const trop = TSX.flatMap((f) => lignes(f, /text-\[(\d+(\.\d+)?)px\]|text-\[0\.\d+rem\]/)).filter((l) => {
      const px = /text-\[(\d+(?:\.\d+)?)px\]/.exec(l)?.[1]
      const rem = /text-\[(0\.\d+)rem\]/.exec(l)?.[1]
      return (px && Number(px) < 16) || (rem && Number(rem) * 17 < 16)
    })
    assert.deepEqual(trop, [])
  })

  test('text-xs réservé aux étiquettes décoratives (exceptions listées dans la PR)', () => {
    const exceptions = [
      /rounded-full/, // pastilles (Démo, Signature, 🌶 / 🌱, statuts, compteurs)
      /min-h-16 flex-col/, // libellés de la barre de navigation basse (sous les icônes)
      /\{t\('Titulaire'\)\}|\{t\('tampons'\)\}|\{t\(points > 1/, // étiquettes de la carte de fidélité
      />tampons<\/div>/, // unité sous le nombre de tampons (liste clients)
      /text-xs conservé|exception documentée/, // commentaires qui documentent l'exception
    ]
    const restants = TSX.flatMap((f) => lignes(f, /\btext-xs\b/)).filter((l) => !exceptions.some((e) => e.test(l)))
    assert.deepEqual(restants, [])
    // Surtitres (capitales espacées) : seules classes CSS en text-xs.
    const css = lire('src/index.css')
    assert.equal(css.split('\n').filter((l) => /@apply[^;]*\btext-xs\b/.test(l)).length, 2)
    assert.match(css, /\.surtitre \{\s*@apply text-xs/)
    assert.match(css, /\.surtitre-sombre \{\s*@apply text-xs/)
  })

  test('pages clientes : pied, mentions et aides de formulaire en text-sm (16 px), plus en text-xs', () => {
    for (const f of PAGES_CLIENTES) assert.match(lire(f), /<p className="text-center text-sm text-gray-600">/, f)
    assert.match(lire('src/components/ui.tsx'), /<footer className="mt-2 border-t border-gray-200 pt-3 text-center text-sm text-gray-600">/)
    assert.match(lire('src/pages/Jouer.tsx'), /<p className="text-sm text-gray-600">\{t\(TEXTE_CODE_UNE_FOIS\)\}<\/p>/)
  })
})

describe('P2-Q1 : contrastes AA', () => {
  test('gris-500 sur fond ivoire < 4,5:1 ; gris-600 ≥ 4,5:1 sur le fond et sur blanc', () => {
    assert.ok(contraste('#6b7280', '#f7f5f2') < 4.5)
    assert.ok(contraste('#4b5563', '#f7f5f2') >= 4.5)
    assert.ok(contraste('#4b5563', '#ffffff') >= 4.5)
  })

  test('plus aucun texte gris-500 (hors placeholder / désactivé sur fond blanc, 4,8:1)', () => {
    assert.deepEqual(
      TSX.flatMap((f) => lignes(f, /(?<![:\w-])text-gray-500\b/)),
      [],
    )
    assert.ok(contraste('#6b7280', '#ffffff') >= 4.5, 'placeholder des champs (fond blanc)')
  })

  test('or #c9a227 jamais en texte sur blanc (2,4:1) : seulement sur fond sombre', () => {
    assert.ok(contraste('#c9a227', '#ffffff') < 3)
    assert.ok(contraste('#c9a227', '#111111') >= 4.5)
    const css = lire('src/index.css')
    assert.match(css, /--color-or-400: #c9a227;/)
    // Texte or direct : uniquement sur une pastille nuit (bg-nuit-950) dans la même classe.
    const textesOr = TSX.flatMap((f) => lignes(f, /\btext-or-(400|500)\b/))
    for (const l of textesOr) assert.match(l, /bg-nuit-950/, l)
    assert.doesNotMatch(TSX.map(lire).join('\n'), /#c9a227|color: ['"]?#c9a227/i)
    // Titre doré (.titre-or) : uniquement dans un en-tête .hero-sombre.
    for (const f of TSX) {
      const s = lire(f)
      for (const m of s.matchAll(/titre-or/g)) {
        const avant = s.slice(Math.max(0, m.index! - 600), m.index)
        assert.match(avant, /hero-sombre/, `${f} : .titre-or hors fond sombre`)
      }
    }
    // Feuille du chargement initial : doré sur noir.
    assert.match(lire('src/chargement.css'), /background: #111111;\s*color: #c9a227;/)
  })

  test('interrupteur éteint : rail gris-500 (≥ 3:1, contraste des composants) au lieu de gris-300', () => {
    const ui = lire('src/components/ui.tsx')
    assert.match(ui, /actif \? 'bg-marque-500' : 'bg-gray-500'/)
    assert.ok(contraste('#6b7280', '#ffffff') >= 3)
    assert.ok(contraste('#d1d5db', '#ffffff') < 3)
  })
})

describe('P2-Q1 : version anglaise des pages clientes', () => {
  test('langue mémorisée sur le téléphone, français par défaut, valeurs inconnues ignorées', () => {
    const memoire = new Map<string, string>()
    const stockage = { getItem: (k: string) => memoire.get(k) ?? null, setItem: (k: string, v: string) => void memoire.set(k, v) }
    assert.equal(lireLangue(stockage), 'fr')
    memoriserLangue(stockage, 'en')
    assert.equal(memoire.get(CLE_LANGUE), 'en')
    assert.equal(lireLangue(stockage), 'en')
    memoire.set(CLE_LANGUE, 'de')
    assert.equal(lireLangue(stockage), 'fr')
    assert.equal(lireLangue(null), 'fr')
    assert.equal(langueValide('en'), 'en')
    const casse = { getItem: () => { throw new Error('bloqué') }, setItem: () => { throw new Error('bloqué') } }
    assert.equal(lireLangue(casse), 'fr')
    assert.doesNotThrow(() => memoriserLangue(casse, 'en'))
  })

  test('anglais seulement sur #/jouer, #/carte, #/menu ; back-office en français', () => {
    for (const p of ['jouer', 'carte', 'menu']) assert.ok(estPageTraduite(p), p)
    for (const p of ['accueil', 'clients', 'roulette', 'reglages', 'caisse', 'avis', 'client']) assert.ok(!estPageTraduite(p), p)
    const langue = lire('src/components/Langue.tsx')
    assert.match(langue, /estPageTraduite\(lireRoute\(\)\.page\) \? lireLangue\(stockage\(\)\) : 'fr'/)
    assert.match(langue, /document\.documentElement\.lang = langue/)
    // <html lang> suit la langue affichée.
    assert.match(lire('src/App.tsx'), /document\.documentElement\.lang = langue/)
    assert.match(lire('index.html'), /<html lang="fr">/)
  })

  test('commutateur FR / EN visible sur les 3 pages clientes, absent du back-office', () => {
    for (const f of PAGES_CLIENTES) assert.match(lire(f), /<CommutateurLangue( sombre)? \/>/, f)
    for (const f of TSX.filter((f) => f.startsWith('src/pages/') && !PAGES_CLIENTES.includes(f))) assert.doesNotMatch(lire(f), /CommutateurLangue/, f)
    const langue = lire('src/components/Langue.tsx')
    assert.match(langue, /role="group" aria-label=\{t\('Langue'\)\}/)
    assert.match(langue, /aria-pressed=\{langue === l\}/)
    assert.match(langue, /lang=\{l\}/)
    assert.match(langue, /min-h-11 min-w-11/, 'zone tactile 44 px')
  })

  test('chaînes principales traduites : titres, boutons, gain / perdu, navigation', () => {
    const principales = [
      'Tournez la roue et gagnez un cadeau !',
      '🎡 Tourner la roue{prenom} !',
      'La roue tourne…',
      '{bravo}, vous avez gagné :',
      `${TITRE_PERDU}{prenom}… mais votre visite compte !`,
      'Voir ma carte de fidélité',
      '🎡 Tourner la roue du jour',
      '📖 Voir le menu',
      'Carte de fidélité',
      'Rechercher un plat',
      'Toutes',
      'Catégories',
      'Prix sur place',
      'C’est parti',
      'Politique de confidentialité',
      TEXTE_ATTENTE,
      INTRO_ATTENTE,
      MESSAGE_ATTENTE_HORS_LIGNE,
      MESSAGE_VISITE_VALIDEE,
      ...ETAPES_VALIDATION,
      TEXTE_PERDU_TAMPON,
      TEXTE_PERDU_PROCHAINE,
      TEXTE_GAIN_SANS_CODE,
      TEXTE_CODE_A_MONTRER,
      TEXTE_CODE_UNE_FOIS,
      TEXTE_DEJA_JOUE,
      NOTE_WALLET,
      MESSAGE_CONTACT_INVALIDE,
      MESSAGE_HORS_LIGNE,
      TEXTE_INVITATION,
      TEXTE_CONFIRMATION_GOOGLE,
      ...[1, 2, 3, 4, 5].flatMap((n) => [libelleBoutonAvis(n), libelleNote(n)]),
    ]
    for (const fr of principales) {
      const en = TRADUCTIONS_EN[fr]
      assert.ok(en?.trim(), `traduction manquante : ${fr}`)
    }
  })

  test('chaque t(\'…\') des écrans clients a sa traduction anglaise', () => {
    const sources = [...PAGES_CLIENTES, 'src/components/CarteFidelite.tsx', 'src/components/Roue.tsx', 'src/components/InvitationAvis.tsx', 'src/components/ui.tsx', 'src/components/Langue.tsx']
    const manquantes: string[] = []
    for (const f of sources) {
      const s = lire(f)
      const litteraux = [
        ...[...s.matchAll(/\bt\('((?:[^'\\]|\\.)+)'/g)].map((m) => m[1]),
        ...[...s.matchAll(/\bt\([\w.!? >=]+ \? '([^']+)' : '([^']+)'/g)].flatMap((m) => [m[1], m[2]]),
      ]
      for (const l of litteraux) if (!(l in TRADUCTIONS_EN)) manquantes.push(`${f} : ${l}`)
    }
    assert.deepEqual(manquantes, [])
  })

  test('traduire : modèles remplis, français inchangé, repli sur le français', () => {
    assert.equal(traduire('🎡 Tourner la roue{prenom} !', 'en', { prenom: ', Linh' }), '🎡 Spin the wheel, Linh!')
    assert.equal(traduire('🎡 Tourner la roue{prenom} !', 'fr', { prenom: '' }), '🎡 Tourner la roue !')
    assert.equal(traduire('{bravo}, vous avez gagné :', 'en', { bravo: traduire('Bravo', 'en') }), 'Well done, you won:')
    assert.equal(traduire('Texte sans traduction', 'en'), 'Texte sans traduction')
    assert.equal(traduire(`${TITRE_PERDU}{prenom}… mais votre visite compte !`, 'fr', { prenom: '' }), 'Pas de lot cette fois… mais votre visite compte !')
  })

  test('validité et progression en anglais ; en français, les fonctions d’origine', () => {
    const d = new Date(2026, 10, 10, 12)
    assert.equal(texteValiditeLangue(d, 'fr', texteValidite), texteValidite(d))
    assert.equal(texteValiditeLangue(d, 'en', texteValidite), 'Valid today, Tue, 10 Nov 2026')
    const resto = { type: 'restaurant', recompense: 'Un plat offert au 10e repas' }
    assert.equal(texteProgressionLangue(3, resto, 'fr', texteProgression), 'Encore 3 repas avant votre plat offert')
    assert.equal(texteProgressionLangue(3, resto, 'en', texteProgression), '3 more meals until your free dish')
    assert.equal(texteProgressionLangue(1, { type: 'boulangerie', recompense: 'Une baguette' }, 'en', texteProgression), '1 more visit until your reward')
  })

  test('noms des plats et des catégories jamais traduits (données du restaurant)', () => {
    const menu = lire('src/pages/MenuPublic.tsx')
    assert.match(menu, /<span className="font-semibold">\{p\.nom\}<\/span>/)
    assert.match(menu, /<h2 className="font-titre text-xl font-bold">\{c\.nom\}<\/h2>/)
    assert.doesNotMatch(menu, /\bt\(p\.nom\)|\bt\(c\.nom\)|\bt\(p\.description/)
    assert.doesNotMatch(lire('src/pages/Jouer.tsx'), /\bt\(lot\)|\bt\(gain\.lot\)|\bt\(s\.libelle\)/, 'libellés des lots non traduits')
  })
})

describe('P2-Q1 : zones tactiles 44 px', () => {
  test('interrupteur : bouton 44 × 64 px, rail visible 32 px dedans', () => {
    const ui = lire('src/components/ui.tsx')
    assert.match(ui, /role="switch"[\s\S]*className="relative inline-flex h-11 w-16 shrink-0 items-center justify-center rounded-full"/)
    assert.match(ui, /<span className=\{`relative h-8 w-14 rounded-full/)
    assert.match(ui, /aria-labelledby=\{`\$\{id\}-libelle`\}/)
  })

  test('chaque case à cocher : case 24 px dans une zone de 44 × 44 px', () => {
    const css = lire('src/index.css')
    assert.match(css, /\.zone-case \{\s*@apply -my-2\.5 -ml-2\.5 inline-flex h-11 w-11/)
    assert.match(css, /\.case-a-cocher \{\s*@apply h-6 w-6/)
    let total = 0
    for (const f of TSX) {
      const s = lire(f)
      const cases = [...s.matchAll(/<input\s+type="checkbox"\s+className="([^"]*)"/g)]
      assert.equal(cases.length, s.match(/type="checkbox"/g)?.length ?? 0, `${f} : className juste après type="checkbox"`)
      for (const c of cases) {
        assert.equal(c[1], 'case-a-cocher', f)
        assert.match(s.slice(Math.max(0, c.index! - 80), c.index), /<span className="zone-case[^"]*">\s*$/, `${f} : case hors zone tactile`)
      }
      total += cases.length
    }
    assert.ok(total >= 6, `${total} cases`)
  })
})

describe('P2-Q1 : lecteur d’écran et clavier', () => {
  test('roue : image nommée (nombre de lots), légende = liste des lots', () => {
    const roue = lire('src/components/Roue.tsx')
    assert.match(roue, /role="img" aria-label=\{t\('Roue de la chance : \{n\} lots à gagner, détaillés ci-dessous', \{ n: parts\.length \}\)\}/)
    assert.match(roue, /aria-label=\{t\('Lots de la roue'\)\}/)
  })

  test('tampons : liste nommée « Tampons : n sur total », état de chaque tampon lu', () => {
    const carte = lire('src/components/CarteFidelite.tsx')
    assert.match(carte, /role="list"\n\s*aria-label=\{t\('Tampons : \{n\} sur \{total\}', \{ n: tampons, total: commerce\.seuilTampons \}\)\}/)
    assert.match(carte, /<span className="sr-only">\{t\(plein \? 'Tampon \{i\} : obtenu' : dernier \? 'Tampon \{i\} : récompense' : 'Tampon \{i\} : à obtenir', \{ i: i \+ 1 \}\)\}<\/span>/)
    assert.doesNotMatch(carte, /data-tampons[\s\S]{0,20}aria-hidden/)
    assert.match(carte, /role="progressbar"/)
  })

  test('étoiles d’avis : motif radiogroup au clavier (flèches, Début / Fin, une seule étoile tabulable)', () => {
    const avis = lire('src/components/InvitationAvis.tsx')
    assert.match(avis, /role="radiogroup" aria-label=\{t\('Votre note'\)\} onKeyDown=\{clavier\}/)
    assert.match(avis, /tabIndex=\{note === i \+ 1 \? 0 : -1\}/)
    for (const k of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End']) assert.match(avis, new RegExp(`'${k}'`))
  })

  test('focus visible : liens, boutons, cases, champs', () => {
    const css = lire('src/index.css')
    assert.match(css, /:where\(a, button, select, summary, input\[type='checkbox'\], \[role='radio'\], \[role='tab'\], \[role='switch'\], \[tabindex\]\):focus-visible/)
    assert.match(css, /\.champ \{[^}]*focus:ring-2/)
  })

  test('écrans clients : pas d’élément cliquable non focusable (onClick seulement sur button / a)', () => {
    for (const f of [...PAGES_CLIENTES, 'src/components/CarteFidelite.tsx', 'src/components/InvitationAvis.tsx']) {
      const s = lire(f)
      for (const m of s.matchAll(/<(\w+)\b[^>]*\sonClick=/g)) assert.ok(['button', 'a', 'OngletCategorie'].includes(m[1]), `${f} : <${m[1]} onClick>`)
    }
  })

  test('tous les champs des pages clientes ont un libellé (label htmlFor ou aria-label)', () => {
    for (const f of [...PAGES_CLIENTES, 'src/components/InvitationAvis.tsx']) {
      const s = lire(f)
      for (const m of s.matchAll(/<(input|textarea|select)\b([^>]*?)\/?>/g)) {
        if (/type="checkbox"/.test(m[2])) {
          // Case dans un <label> englobant.
          const avant = s.slice(Math.max(0, m.index! - 300), m.index)
          assert.ok(avant.lastIndexOf('<label') > avant.lastIndexOf('</label>'), `${f} : case sans label`)
          continue
        }
        const id = /\bid="([^"]+)"/.exec(m[2])?.[1]
        assert.ok(/aria-label/.test(m[2]) || (id && s.includes(`htmlFor="${id}"`)), `${f} : champ sans libellé ${m[0].slice(0, 60)}`)
      }
    }
  })
})

// Roue v2 R5+R8 : son WebAudio (préférence de l'appareil, AudioContext seulement dans le geste, chargé à la demande),
// couleur du commerce sur la roue et sa légende, décor premium sur couches fixes (poursuite lumineuse, rayons, rebond
// du pointeur) et respect de prefers-reduced-motion.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CLE_SON, dureeRotation, memoriserSon, NOMBRE_CONFETTIS_LEGER, ouvrirScene, sonActive } from '../src/lib/animationRoue.ts'
import { creerScene, NOTES_GAIN, ticsRotation } from '../src/lib/sonRoue.ts'
import { accentRoue, colorerSecteurs, COULEURS, couleurTexte, paletteRoue, secteursAffiches, teintesRoue } from '../src/lib/roue.ts'
import { contraste } from '../src/lib/apparence.ts'
import { TRADUCTIONS_EN } from '../src/lib/langue.ts'
import { THEME } from '../src/theme.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')
const jouer = lire('src/pages/Jouer.tsx')
const roue = lire('src/components/Roue.tsx')
const css = lire('src/index.css')

/** Corps d'une fonction du fichier source (de sa déclaration à la suivante). */
function corpsDe(source: string, nom: string, depuis = 0): string {
  const debut = source.slice(depuis).search(new RegExp(`function ${nom}\\b`)) + depuis
  assert.ok(debut >= depuis, nom)
  const suite = source.slice(debut + 1).search(/\n(export )?(async )?function /)
  return suite < 0 ? source.slice(debut) : source.slice(debut, debut + 1 + suite)
}

/** Faux stockage clé → valeur. */
function stockage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}

/** Faux AudioContext qui compte ses constructions, les oscillateurs joués, leurs arrêts et les gains créés. */
function fauxAudio() {
  const journal = {
    contextes: 0,
    reveils: 0,
    notes: [] as number[],
    oscillateurs: [] as { arrets: (number | undefined)[] }[],
    gains: [] as { gain: { value: number } }[],
    destination: {},
  }
  class Ctx {
    currentTime = 0
    destination = journal.destination
    constructor() {
      journal.contextes++
    }
    resume() {
      journal.reveils++
      return Promise.resolve()
    }
    createOscillator() {
      const o = {
        type: '',
        arrets: [] as (number | undefined)[],
        frequency: { setValueAtTime: (f: number) => journal.notes.push(f) },
        connect: (g: unknown) => g,
        start() {},
        stop(t?: number) {
          o.arrets.push(t)
        },
      }
      journal.oscillateurs.push(o)
      return o
    }
    createGain() {
      const g = { gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (d: unknown) => ((g as { vers?: unknown }).vers = d) }
      journal.gains.push(g)
      return g
    }
  }
  return { journal, Ctx: Ctx as unknown as new () => AudioContext }
}

/** Gain maître = le seul gain branché directement sur la sortie du contexte. */
const gainMaitre = (j: ReturnType<typeof fauxAudio>['journal']) => j.gains.filter((g) => (g as { vers?: unknown }).vers === j.destination)

describe('R5 : préférence son (par appareil, défaut activé)', () => {
  test('défaut activé ; « 0 » en localStorage = coupé ; clé unique par appareil, pas par commerce', () => {
    assert.equal(sonActive(stockage()), true)
    assert.equal(sonActive(null), true)
    assert.equal(sonActive(stockage({ [CLE_SON]: '0' })), false)
    assert.equal(sonActive(stockage({ [CLE_SON]: '1' })), true)
    assert.doesNotMatch(CLE_SON, /commerce|\$\{/)
    const s = stockage()
    memoriserSon(s, false)
    assert.equal(s.m.get(CLE_SON), '0')
    memoriserSon(s, true)
    assert.equal(s.m.get(CLE_SON), '1')
    // Stockage plein ou refusé : pas d'erreur, le choix vaut pour la page.
    memoriserSon(
      {
        setItem() {
          throw new Error('quota')
        },
      },
      false,
    )
  })

  test('la page lit la préférence au montage et la mémorise au basculement (bouton nommé, état pressé)', () => {
    const hook = corpsDe(jouer, 'useJeuRoue')
    assert.match(hook, /useState\(\(\) => sonActive\(stockageLocal\(\)\)\)/)
    assert.match(hook, /memoriserSon\(stockageLocal\(\), !son\)/)
    assert.match(jouer, /className="bouton-son" aria-pressed=\{jeu\.son\} aria-label=\{t\('Son de la roue'\)\} onClick=\{jeu\.basculer\}/)
    assert.equal(TRADUCTIONS_EN['Son de la roue'], 'Wheel sound')
  })
})

describe('R5 : AudioContext uniquement dans le geste « Tourner »', () => {
  test('son coupé : aucun AudioContext créé ; la scène (tics visuels) se charge quand même', async () => {
    const { journal, Ctx } = fauxAudio()
    const scene = await ouvrirScene(false, { AudioContext: Ctx })
    assert.equal(journal.contextes, 0)
    assert.ok(scene)
    scene.fanfare(false)
    assert.deepEqual(journal.notes, [])
  })

  test('son activé : un AudioContext créé et réveillé dans l’appel ; motif de gain = 3 notes montantes', async () => {
    const { journal, Ctx } = fauxAudio()
    const promesse = ouvrirScene(true, { AudioContext: Ctx })
    // Créé de façon synchrone (pendant le geste), avant tout chargement asynchrone.
    assert.equal(journal.contextes, 1)
    assert.equal(journal.reveils, 1)
    const scene = (await promesse)!
    scene.fanfare(false)
    assert.deepEqual(journal.notes, NOTES_GAIN)
    assert.ok(NOTES_GAIN[0] < NOTES_GAIN[1] && NOTES_GAIN[1] < NOTES_GAIN[2])
    journal.notes = []
    scene.fanfare(true)
    assert.equal(journal.notes.length, 2, 'points : motif allégé')
    journal.notes = []
    scene.muet = true
    scene.fanfare(false)
    assert.deepEqual(journal.notes, [], 'son coupé en cours de partie : silence')
  })

  test('WebAudio absent ou refusé : échec silencieux', async () => {
    assert.ok(await ouvrirScene(true, {}))
    const scene = await ouvrirScene(true, {
      AudioContext: class {
        constructor() {
          throw new Error('refusé')
        }
      } as unknown as new () => AudioContext,
    })
    assert.ok(scene)
    scene.fanfare(false)
  })

  test('source : ouvrirScene n’est appelée que par le clic « Tourner » (avant toute attente réseau)', () => {
    assert.equal(jouer.match(/ouvrirScene\(/g)?.length, 1)
    assert.match(corpsDe(jouer, 'useJeuRoue'), /ouvrir: \(\) => void \(scene\.current = ouvrirScene\(son\)\)/)
    const local = corpsDe(jouer, 'tourner', jouer.indexOf('function PartieLocale'))
    assert.match(local, /jeuRoue\.ouvrir\(\)/)
    const distant = corpsDe(jouer, 'tourner', jouer.indexOf('function PartieApi'))
    assert.ok(distant.indexOf('jeuRoue.ouvrir()') > 0 && distant.indexOf('jeuRoue.ouvrir()') < distant.indexOf('await '), 'ouvrir avant le premier await')
    // Aucun autre endroit ne crée de contexte audio.
    for (const f of ['src/pages/Jouer.tsx', 'src/components/Roue.tsx', 'src/lib/sonRoue.ts']) assert.doesNotMatch(lire(f), /new (webkit)?AudioContext|AudioContext\(/, f)
  })

  test('bundle : la synthèse (sonRoue.ts) n’est chargée qu’à la demande', () => {
    const ani = lire('src/lib/animationRoue.ts')
    assert.equal(ani.match(/import\('\.\/sonRoue\.ts'\)/g)?.length, 1)
    for (const f of ['src/pages/Jouer.tsx', 'src/components/Roue.tsx', 'src/lib/animationRoue.ts', 'src/lib/roue.ts']) assert.doesNotMatch(lire(f), /from '[^']*sonRoue/, f)
  })
})

describe('R5 : tics calculés depuis l’angle animé', () => {
  const quarts = [0, 90, 180, 270]

  test('un tic par limite de secteur franchie, dans l’ordre, pendant la durée de la rotation', () => {
    const tics = ticsRotation(0, 5 * 360 + 45, quarts, 3600, 0)
    assert.equal(tics.length, 20)
    assert.deepEqual([...tics].sort((a, b) => a - b), tics)
    assert.ok(tics[0] >= 0 && tics.at(-1)! <= 3600)
    // Courbe de décélération : les tics s'espacent vers la fin.
    assert.ok(tics.at(-1)! - tics.at(-2)! > tics[1] - tics[0])
    // Départ d'une rotation déjà avancée (deuxième partie) : mêmes limites, rien avant 0.
    assert.equal(ticsRotation(720, 720 + 360, quarts, 3600, 0).length, 4)
  })

  test('mouvement réduit (durée 0) ou rien ne tourne : aucun tic planifié', (t) => {
    assert.equal(dureeRotation(true), 0)
    assert.deepEqual(ticsRotation(0, 1845, quarts, 0), [])
    assert.deepEqual(ticsRotation(100, 100, quarts), [])
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const espion = t.mock.method(globalThis, 'setTimeout')
    creerScene(null).planifier(0, 1845, quarts, dureeRotation(true))
    assert.equal(espion.mock.callCount(), 0)
  })

  test('rotation normale : tics planifiés, annulables ; déjà écoulés ignorés', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const appels: number[] = []
    const pointeur = { animate: () => void appels.push(1) } as unknown as Element
    const annuler = creerScene(null).planifier(0, 1845, quarts, 3600, pointeur)
    t.mock.timers.tick(1000)
    const avant = appels.length
    assert.ok(avant > 0, 'le pointeur bute dès les premiers secteurs')
    annuler()
    t.mock.timers.tick(5000)
    assert.equal(appels.length, avant, 'plus rien après annulation')
    const tous = ticsRotation(0, 1845, quarts)
    appels.length = 0
    creerScene(null).planifier(0, 1845, quarts, 3600, pointeur, 2000)
    t.mock.timers.tick(5000)
    assert.equal(appels.length, tous.filter((x) => x >= 2000).length)
  })

  test('la roue planifie depuis la rotation précédente, avec la durée du réglage (0 en mouvement réduit)', () => {
    assert.match(roue, /const duree = dureeRotation\(reduit\)/)
    assert.match(roue, /s\?\.planifier\(de, rotation, parts\.map\(\(p\) => p\.debut\), duree, pointeur\.current, Date\.now\(\) - debut\)/)
    assert.match(roue, /if \(duree\) setPhase\('roue-tourne'\)/)
  })
})

describe('R5 : couleur du commerce', () => {
  test('sans couleur (ou couleur illisible) : palette magenta inchangée', () => {
    assert.equal(paletteRoue(undefined), COULEURS)
    assert.equal(paletteRoue('#ffff00'), COULEURS, 'blanc illisible dessus : refusée')
    assert.equal(paletteRoue('rouge'), COULEURS)
    const parts = secteursAffiches([{ libelle: 'A' }, { libelle: 'B' }, { libelle: 'C' }])
    assert.equal(colorerSecteurs(parts, undefined), parts)
    assert.equal(teintesRoue()['--roue-vif'], THEME.magenta500)
  })

  test('couleur valide : secteurs ET légende recolorés, la couleur du commerce remplace le magenta', () => {
    const parts = colorerSecteurs(secteursAffiches([{ libelle: 'A' }, { libelle: 'B' }, { libelle: 'C' }, { libelle: 'D' }]), '#1E6B52')
    const couleurs = parts.map((s) => s.couleur)
    for (const m of [THEME.magenta400, THEME.magenta500, THEME.magenta700]) assert.ok(!couleurs.includes(m), m)
    assert.equal(couleurs[1], THEME.noir)
    assert.equal(teintesRoue('#1E6B52')['--roue-vif'], '#1e6b52')
    // Couleur presque noire : prise telle quelle (pas confondue avec le noir par un assombrissement).
    assert.equal(paletteRoue('#3b2d8f')[0], '#3b2d8f')
    assert.match(roue, /colorerSecteurs\(secteursAffiches\(lots\), decor\.couleur\)/)
    assert.match(roue, /colorerSecteurs\(secteursAffiches\(lots\), useContext\(ContexteRoue\)\.couleur\)/)
    assert.match(jouer, /couleur: commerce\.apparence\?\.couleur/)
  })

  test('toute couleur acceptée : texte ≥ 4,5:1 sur chaque secteur, voisins distincts', () => {
    let n = 0
    for (let r = 0; r < 256; r += 17)
      for (let g = 0; g < 256; g += 17)
        for (let b = 0; b < 256; b += 17) {
          const c = `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`
          if (!accentRoue(c)) continue
          n++
          const p = paletteRoue(c)
          for (const [i, f] of p.entries()) {
            assert.ok(contraste(f, couleurTexte(f)) >= 4.5, `${c} secteur ${i} ${f}`)
            // Voisins (y compris le dernier et le premier) nettement distincts, pas seulement différents.
            assert.ok(contraste(f, p[(i + 1) % p.length]) >= 1.25, `${c} : secteurs ${i} et ${(i + 1) % p.length} trop proches`)
          }
        }
    assert.ok(n > 1000, `${n} couleurs testées`)
    // Palette du thème : mêmes textes qu'avant R5.
    assert.deepEqual(COULEURS.map(couleurTexte), [THEME.blanc, THEME.blanc, THEME.noir, THEME.encre, THEME.blanc, THEME.encre])
  })
})

describe('R8 : décor premium sur couches fixes', () => {
  test('seule la couche des secteurs tourne ; décor = CSS, aucun asset image', () => {
    assert.equal(roue.match(/will-change-transform/g)?.length, 1)
    for (const c of ['roue-halo', 'roue-anneau', 'roue-perle', 'roue-pointeur', 'roue-verre', 'roue-moyeu']) {
      assert.match(roue, new RegExp(`className="${c}|className="${c} `), c)
      assert.match(css, new RegExp(`\\.${c}[ :,{]`), `${c} sans règle CSS`)
    }
    assert.equal(roue.match(/className="roue-perle"/g)?.length, 1)
    assert.match(roue, /Array\.from\(\{ length: 16 \}/)
    assert.doesNotMatch(roue, /\.(png|jpe?g|webp|gif|mp3|wav|ogg)['"]/)
  })

  test('les animations du décor n’animent que opacity / transform / rotate (composité, 60 fps)', () => {
    const images = [...css.matchAll(/@keyframes (roue-[\w-]+) \{([\s\S]*?)\n\}/g)]
    assert.deepEqual(images.map((m) => m[1]).sort(), ['roue-poursuite', 'roue-rayons-ouverture', 'roue-rayons-tour', 'roue-rebond'])
    for (const [, nom, corps] of images) {
      for (const p of corps.matchAll(/([a-z-]+):/g)) assert.ok(['opacity', 'transform', 'rotate'].includes(p[1]), `${nom} anime ${p[1]}`)
    }
  })

  test('poursuite pendant la rotation, rebond à l’arrêt, rayons au gain (allégés pour des points, rien si perdu)', () => {
    assert.match(css, /\.roue-tourne \.roue-perle::after \{\s*animation: roue-poursuite/)
    assert.match(css, /animation-delay: calc\(var\(--i\) \* 0\.05s\)/)
    assert.match(css, /\.roue-arret \.roue-pointeur \{\s*animation: roue-rebond/)
    assert.match(css, /\.roue\[data-fete='lot'\] \.roue-halo::after,\n\.roue\[data-fete='points'\] \.roue-halo::after \{/)
    assert.match(css, /\.roue\[data-fete='points'\] \{\s*--rayons: 18%;/)
    assert.match(roue, /data-fete=\{decor\.fete\}/)
    assert.match(jouer, /fete=\{etape === 'resultat' && gain \? typeTirage\(gain\) : undefined\}/)
    assert.match(jouer, /fete=\{etape === 'resultat' && gain \? typeTirage\(\{ lot: gain\.lot, typeLot: gain\.type \}\) : undefined\}/)
  })

  test('prefers-reduced-motion : ni poursuite, ni rebond, rayons immobiles', () => {
    const bloc = css.slice(css.indexOf('/* Mouvement réduit : pas de poursuite'))
    const media = bloc.slice(0, bloc.indexOf('\n}\n') + 3)
    assert.match(media, /@media \(prefers-reduced-motion: reduce\)/)
    assert.match(media, /\.roue-tourne \.roue-perle::after,\n\s*\.roue-arret \.roue-pointeur \{\s*animation: none;/)
    assert.match(media, /\.roue-halo::after \{\s*animation: none;\s*opacity: 1;\s*transform: none;/)
  })

  test('teintes du décor dérivées de la couleur active, jamais du magenta en dur', () => {
    const decor = css.slice(css.indexOf('/* #/jouer, roue premium (R8)'), css.indexOf('/* #/carte, nouveau tampon')).replace(/\/\*[\s\S]*?\*\//g, '')
    assert.ok(decor.length > 2000)
    assert.doesNotMatch(decor, /magenta|#[0-9a-f]{3,8}\b/i)
    assert.match(decor, /var\(--roue-clair\)/)
    assert.match(roue, /style=\{teintesRoue\(decor\.couleur\) as CSSProperties\}/)
    const t = teintesRoue('#1e6b52')
    assert.deepEqual(Object.keys(t).sort(), ['--roue-clair', '--roue-fonce', '--roue-nuit', '--roue-vif'])
  })

  test('moyeu : logo du commerce (petite variante du logo par défaut) ou son initiale', () => {
    assert.match(roue, /\{decor\.logo \? <img src=\{decor\.logo\} alt="" \/> : <span className="font-titre">\{decor\.initiale\}<\/span>\}/)
    assert.match(jouer, /logo: logo\.includes\('\/'\) \? \(logo === VISUELS\.logo \? LOGO_DEFAUT_PETIT : logo\) : undefined/)
  })
})

describe('R5+R8 revue Codex : couper le son, mouvement réduit en cours, réactivation pendant la partie', () => {
  const quarts = [0, 90, 180, 270]

  test('F1 : couper le son en plein motif de gain tait aussi les notes déjà programmées (gain maître à 0, oscillateurs arrêtés)', async () => {
    const { journal, Ctx } = fauxAudio()
    const scene = (await ouvrirScene(true, { AudioContext: Ctx }))!
    scene.fanfare(false)
    assert.equal(journal.oscillateurs.length, 3)
    const maitre = gainMaitre(journal)
    assert.equal(maitre.length, 1, 'un seul gain maître, partagé par toutes les notes')
    // Les notes sont programmées jusqu'à ~0,24 s : seul leur arrêt planifié est connu.
    for (const o of journal.oscillateurs) assert.equal(o.arrets.length, 1)
    scene.muet = true
    assert.equal(maitre[0].gain.value, 0)
    for (const o of journal.oscillateurs) assert.deepEqual(o.arrets.slice(1), [undefined], 'arrêt immédiat de chaque note programmée')
    // Réactivé : le même gain maître remonte, les nouvelles notes rejouent.
    scene.muet = false
    assert.equal(maitre[0].gain.value, 1)
    scene.fanfare(true)
    assert.equal(journal.oscillateurs.length, 5)
    assert.equal(gainMaitre(journal).length, 1)
  })

  test('F1 : couper le son en cours de rotation : plus aucun tic sonore, l’inclinaison du pointeur continue', async (t) => {
    const { journal, Ctx } = fauxAudio()
    const scene = (await ouvrirScene(true, { AudioContext: Ctx }))!
    t.mock.timers.enable({ apis: ['setTimeout'] })
    let inclinaisons = 0
    scene.planifier(0, 1845, quarts, 3600, { animate: () => void inclinaisons++ } as unknown as Element)
    t.mock.timers.tick(1000)
    const tics = journal.notes.length
    assert.ok(tics > 0)
    scene.muet = true
    for (const o of journal.oscillateurs) assert.ok(o.arrets.includes(undefined), 'tic en cours arrêté')
    const avant = inclinaisons
    t.mock.timers.tick(5000)
    assert.equal(journal.notes.length, tics, 'aucun nouveau tic sonore')
    assert.ok(inclinaisons > avant, 'le pointeur bute toujours')
  })

  test('F2 : l’annulation arrête les tics à venir ET les inclinaisons du pointeur en cours', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const animations: { annulee: boolean }[] = []
    const pointeur = {
      animate: () => {
        const a = { annulee: false, cancel: () => void (a.annulee = true) }
        animations.push(a)
        return a
      },
    } as unknown as Element
    const annuler = creerScene(null).planifier(0, 1845, quarts, 3600, pointeur)
    t.mock.timers.tick(1000)
    const n = animations.length
    assert.ok(n > 0)
    annuler()
    assert.ok(animations.every((a) => a.annulee), 'inclinaisons en cours annulées')
    t.mock.timers.tick(5000)
    assert.equal(animations.length, n, 'plus aucun tic planifié')
  })

  test('F2 : la roue relance son effet quand le mouvement réduit change : nettoyage (tics + pointeur), rien de replanifié', () => {
    const effet = roue.slice(roue.indexOf('const de = avant.current'), roue.indexOf('const filets'))
    assert.match(effet, /\}, \[rotation, reduit\]\)/)
    // Même rotation (seul `reduit` a changé) : aucune nouvelle planification, poursuite lumineuse arrêtée.
    assert.match(effet, /if \(rotation === de\) return setPhase\(''\)/)
    assert.match(effet, /if \(annuler\) annuler\(\)\n\s*annuler = false/)
  })

  test('F3 : partie lancée en muet, son réactivé pendant la rotation : contexte ouvert, tics restants et motif de gain joués', async (t) => {
    const { journal, Ctx } = fauxAudio()
    const scene = (await ouvrirScene(false, { AudioContext: Ctx }))!
    assert.equal(journal.contextes, 0)
    t.mock.timers.enable({ apis: ['setTimeout'] })
    scene.planifier(0, 1845, quarts, 3600)
    t.mock.timers.tick(1000)
    assert.deepEqual(journal.notes, [], 'muet : silence')
    // Clic sur le bouton son (un geste) : la page fait `s.muet = son` (son valait faux).
    scene.muet = false
    assert.equal(journal.contextes, 1, 'contexte ouvert par le geste du bouton son')
    assert.equal(journal.reveils, 1)
    t.mock.timers.tick(5000)
    assert.ok(journal.notes.length > 0 && journal.notes.every((f) => f === 1500), 'tics restants joués')
    journal.notes = []
    scene.fanfare(false)
    assert.deepEqual(journal.notes, NOTES_GAIN, 'motif de gain joué')
    // Recouper puis réactiver : le contexte existant est réveillé, jamais recréé.
    scene.muet = true
    scene.muet = false
    assert.equal(journal.contextes, 1)
    assert.equal(journal.reveils, 2)
    // Le bouton son de la page passe bien par ce setter, dans son clic.
    assert.match(corpsDe(jouer, 'useJeuRoue'), /basculer\(\) \{[\s\S]*?scene\.current\?\.then\(\(s\) => s && \(s\.muet = son\)\)/)
  })
})

describe('R5 : célébration', () => {
  test('confettis aussi sur des points, en version allégée ; motif sonore au résultat', () => {
    assert.equal(NOMBRE_CONFETTIS_LEGER, 14)
    assert.match(css, new RegExp(`\\[data-leger='true'\\] \\.confetti:nth-child\\(n \\+ ${NOMBRE_CONFETTIS_LEGER + 1}\\) \\{\\s*display: none;`))
    const resultat = corpsDe(jouer, 'Resultat')
    assert.match(resultat, /data-leger=\{consolation\} data-resultat="gain">/)
    assert.match(resultat, /!perdu && scene\?\.current\?\.then\(\(s\) => s\?\.fanfare\(consolation\)\)/)
  })
})

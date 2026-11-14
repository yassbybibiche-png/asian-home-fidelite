// Boucle animations, cycle 4 — « rail En photos vivant » du menu Découverte (#/menu) : la tuile la plus proche du centre
// du rail grandit légèrement et sa photo s'éclaire, les autres s'atténuent en s'éloignant. Logique pure et pilote testés
// directement (src/lib/railVivant.ts, faux rAF / IntersectionObserver / éléments) ; le .tsx est vérifié sur le source.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { AMPLITUDE_ECHELLE, LUMINOSITE_REPOS, PORTEE_TUILES, animerRailVivant, arrondiFacteur, echelleTuile, luminositePhoto, miseAuPointRail } from '../src/lib/railVivant.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')
const menu = lire('src/pages/MenuPublic.tsx')
const source = lire('src/lib/railVivant.ts')

describe('Cycle 4 : mathématique du rail vivant (src/lib/railVivant.ts)', () => {
  test('facteur 1 au centre, 0 à une tuile et demie et au-delà, symétrique', () => {
    assert.equal(miseAuPointRail(0, 72), 1)
    assert.equal(PORTEE_TUILES, 1.5)
    // Tuile de 144 px : portée = 1,5 × 144 = 216 px.
    assert.equal(miseAuPointRail(216, 72), 0)
    assert.equal(miseAuPointRail(500, 72), 0)
    assert.equal(miseAuPointRail(-216, 72), 0)
    assert.equal(miseAuPointRail(-100, 72), miseAuPointRail(100, 72))
    assert.ok(Math.abs(miseAuPointRail(108, 72) - 0.5) < 1e-12, 'moitié de la portée → 0,5 (cosinus)')
  })

  test('courbe douce et décroissante : plate au centre et au bord, toujours dans 0..1', () => {
    let avant = 1
    for (let d = 0; d <= 240; d += 4) {
      const f = miseAuPointRail(d, 72)
      assert.ok(f >= 0 && f <= 1, `d=${d}`)
      assert.ok(f <= avant + 1e-12, `décroissante à d=${d}`)
      avant = f
    }
    assert.ok(1 - miseAuPointRail(4, 72) < 0.005, 'pas d’à-coup au centre')
    assert.ok(miseAuPointRail(212, 72) < 0.005, 'pas de cassure à l’entrée de la zone')
  })

  test('demi-largeur nulle, négative ou invalide → repos (aucune division absurde)', () => {
    for (const l of [0, -10, Number.NaN]) assert.equal(miseAuPointRail(0, l), 0, String(l))
    assert.equal(miseAuPointRail(Number.NaN, 72), 0)
  })

  test('grandeurs dérivées aux bornes : échelle 1 → 1,05, luminosité 0,82 → 1', () => {
    assert.equal(AMPLITUDE_ECHELLE, 0.05)
    assert.equal(LUMINOSITE_REPOS, 0.82)
    assert.equal(echelleTuile(0), 1)
    assert.equal(echelleTuile(1), 1.05)
    assert.equal(luminositePhoto(0), 0.82)
    assert.equal(luminositePhoto(1), 1)
    assert.ok(Math.abs(luminositePhoto(0.5) - 0.91) < 1e-12)
    assert.equal(arrondiFacteur(0.12345), 0.12)
    assert.equal(arrondiFacteur(0.999), 1)
  })
})

/** Faux rail : `n` tuiles de 144 px tous les 156 px, rail de 380 px à x = 16 ; compte les écritures de style. */
function fauxRail(n: number) {
  const ecritures = { transform: 0, filter: 0, scrollLeft: 0 }
  const lectures = { rect: 0 }
  let scroll = 0
  const style = (cle: 'transform' | 'filter') => {
    let v = ''
    return Object.defineProperty({}, cle, { get: () => v, set: (x: string) => ((v = x), ecritures[cle]++), enumerable: true }) as Record<string, string>
  }
  const internes = Array.from({ length: n }, (_, i) => {
    const bouton = { getBoundingClientRect: () => ({ left: 16 + i * 156 - scroll, width: 144 }) }
    const img = { style: style('filter') }
    return { parentElement: bouton, style: style('transform'), querySelector: () => img, img }
  })
  const rail = {
    get scrollLeft() {
      return scroll
    },
    set scrollLeft(x: number) {
      scroll = x
      ecritures.scrollLeft++
    },
    clientWidth: 380,
    childElementCount: n,
    getBoundingClientRect: () => (lectures.rect++, { left: 16, width: 380 }),
    querySelectorAll: (sel: string) => (assert.equal(sel, '[data-rail-vivant]'), internes),
    defiler: (x: number) => (scroll = x),
  }
  return { rail, internes, ecritures, lectures }
}

/** Faux rAF manuel + faux IntersectionObserver, posés sur globalThis le temps du test. */
function fauxNavigateur(t: { after: (f: () => void) => void }) {
  let file: ((t: number) => void)[] = []
  const observateurs: { rappel: (e: { isIntersecting: boolean }[]) => void; coupe: boolean }[] = []
  const g = globalThis as Record<string, unknown>
  const avant = { raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame, io: g.IntersectionObserver }
  let id = 0
  const ids = new Map<number, (t: number) => void>()
  g.requestAnimationFrame = (f: (t: number) => void) => (ids.set(++id, f), file.push(f), id)
  g.cancelAnimationFrame = (i: number) => {
    const f = ids.get(i)
    file = file.filter((x) => x !== f)
  }
  g.IntersectionObserver = class {
    o: { rappel: (e: { isIntersecting: boolean }[]) => void; coupe: boolean }
    constructor(rappel: (e: { isIntersecting: boolean }[]) => void) {
      this.o = { rappel, coupe: false }
      observateurs.push(this.o)
    }
    observe() {}
    disconnect() {
      this.o.coupe = true
    }
  }
  t.after(() => ((g.requestAnimationFrame = avant.raf), (g.cancelAnimationFrame = avant.caf), (g.IntersectionObserver = avant.io)))
  return {
    image: () => {
      const f = file
      file = []
      f.forEach((x) => x(0))
    },
    enAttente: () => file.length,
    visible: (v: boolean) => observateurs.forEach((o) => o.rappel([{ isIntersecting: v }])),
    observateurs,
  }
}

describe('Cycle 4 : pilote animerRailVivant (faux navigateur)', () => {
  test('tuile au centre à 1,05 et éclairée, voisines atténuées ; seulement quand le rail est à l’écran', (t) => {
    const nav = fauxNavigateur(t)
    const { rail, internes } = fauxRail(6)
    const arret = animerRailVivant(rail as unknown as HTMLElement, false)
    assert.equal(nav.enAttente(), 0, 'aucune boucle avant que le rail soit à l’écran')
    nav.visible(true)
    // Centre du rail à 206 px : tuile 1 (centre 16 + 156 + 72 = 244) la plus proche à scroll 0 ; on centre la tuile 2.
    rail.defiler(2 * 156 + 72 + 16 - 206)
    nav.image()
    assert.equal(internes[2].style.transform, 'scale(1.0500)')
    assert.equal(internes[2].img.style.filter, 'brightness(1.0000)')
    const voisine = Number(/scale\(([\d.]+)\)/.exec(internes[1].style.transform)?.[1])
    assert.ok(voisine > 1 && voisine < 1.02, `voisine ${voisine}`)
    assert.equal(internes[0].style.transform, 'scale(1.0000)')
    assert.equal(internes[0].img.style.filter, 'brightness(0.8200)')
    arret()
  })

  test('écritures seulement quand la valeur arrondie change ; jamais de scrollLeft écrit', (t) => {
    const nav = fauxNavigateur(t)
    const { rail, ecritures, lectures } = fauxRail(6)
    const arret = animerRailVivant(rail as unknown as HTMLElement, false)
    nav.visible(true)
    nav.image()
    const apres1 = { ...ecritures }
    const rects = lectures.rect
    assert.equal(apres1.transform, 6)
    nav.image()
    nav.image()
    assert.deepEqual(ecritures, apres1, 'position inchangée → aucune écriture')
    assert.equal(lectures.rect, rects, 'position inchangée → image sautée, aucune mesure')
    rail.defiler(0.1)
    nav.image()
    assert.ok(ecritures.transform - apres1.transform < 6, 'défilement minime → seules les tuiles dont le centième change')
    rail.defiler(40)
    nav.image()
    assert.ok(ecritures.transform > apres1.transform)
    assert.equal(ecritures.scrollLeft, 0, 'le pilote ne conduit jamais le défilement')
    arret()
  })

  test('hors écran : boucle arrêtée ; démontage : image annulée, observateur coupé, styles effacés', (t) => {
    const nav = fauxNavigateur(t)
    const { rail, internes } = fauxRail(4)
    const arret = animerRailVivant(rail as unknown as HTMLElement, false)
    nav.visible(true)
    nav.image()
    assert.equal(nav.enAttente(), 1)
    nav.visible(false)
    assert.equal(nav.enAttente(), 0, 'rail sorti de l’écran → plus aucune image demandée')
    nav.visible(true)
    nav.image()
    arret()
    assert.equal(nav.enAttente(), 0)
    assert.ok(nav.observateurs.every((o) => o.coupe))
    for (const e of internes) assert.equal(e.style.transform + e.img.style.filter, '')
  })

  test('mouvement réduit : rien du tout (ni boucle, ni observateur, ni style posé)', (t) => {
    const nav = fauxNavigateur(t)
    const { rail, ecritures } = fauxRail(4)
    const arret = animerRailVivant(rail as unknown as HTMLElement, true)
    nav.visible(true)
    nav.image()
    assert.equal(nav.enAttente(), 0)
    assert.equal(nav.observateurs.length, 0)
    assert.deepEqual(ecritures, { transform: 0, filter: 0, scrollLeft: 0 })
    arret()
  })
})

describe('Cycle 4 : branchement (sources)', () => {
  test('MenuPublic : pilote branché sur le rail, coupé en mouvement réduit, à côté de defilerRail', () => {
    assert.match(menu, /import \{ animerRailVivant \} from '\.\.\/lib\/railVivant'/)
    assert.match(menu, /useEffect\(\(\) => \(avecRail && rail\.current \? animerRailVivant\(rail\.current, prefereMouvementReduit\(\)\) : undefined\), \[avecRail\]\)/)
    assert.match(menu, /defilerRail\(rail\.current, prefereMouvementReduit\(\)\)/)
  })

  test('tuile : bouton seul porteur de l’enfoncement tactile, conteneur interne [data-rail-vivant] autour de la photo et des textes', () => {
    const i = menu.indexOf('data-rail-photos>')
    const tuile = menu.slice(i, menu.indexOf('</section>', i))
    assert.match(
      tuile,
      /<button\s+key=\{p\.id\}\s+type="button"\s+onClick=\{\(\) => allerAuPlat\(categorieId, p\.id\)\}\s+aria-label=\{t\('Voir le plat : \{nom\}', \{ nom: p\.nom \}\)\}\s+className="[^"]*active:scale-\[0\.97\][^"]*"\s*>/,
    )
    assert.match(tuile, /<span className="block overflow-hidden rounded-2xl [^"]*" data-rail-vivant>\s*<img src=\{photoCartePlat\(p\)\} alt="" loading="lazy" className="h-24 w-full object-cover" \/>/)
    assert.equal(tuile.match(/<button/g)?.length, 1, 'une seule tuile par plat (aucune duplication)')
    assert.equal(tuile.match(/data-rail-vivant/g)?.length, 1)
  })

  test('module : transform / filter seulement, jamais scrollLeft écrit, ni écouteur de défilement', () => {
    assert.match(source, /if \(mouvementReduit \|\| typeof requestAnimationFrame === 'undefined'\) return \(\) => \{\}/)
    assert.doesNotMatch(source, /scrollLeft\s*=[^=]/)
    assert.doesNotMatch(source, /addEventListener/)
    assert.doesNotMatch(source, /\.style\.(?!transform|filter)\w+/)
    assert.match(source, /new IntersectionObserver/)
  })

  test('module importé par la seule page différée du menu (hors bundle initial), Commande intacte', () => {
    assert.doesNotMatch(lire('src/pages/Commande.tsx'), /railVivant|data-rail-vivant/)
    assert.doesNotMatch(lire('src/pages/Jouer.tsx'), /railVivant/)
    assert.doesNotMatch(lire('src/App.tsx'), /railVivant/)
    assert.match(lire('src/App.tsx'), /import\('\.\/pages\/MenuPublic'\)/)
  })
})

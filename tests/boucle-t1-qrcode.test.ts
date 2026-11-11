// Boucle t1 — QR code hors du bundle initial : `qrcode-generator` (~21 Ko minifiés) ne doit plus
// être dans le JS chargé au premier affichage de #/jouer. `QrCode` a déménagé de
// `components/ui.tsx` vers `components/QrCode.tsx`, chargé en différé par `CarteFidelite`
// (seul consommateur du graphe initial) ; les pages différées l'importent directement.
// Le rendu est identique (même SVG, mêmes props) — le repli `Suspense` est un carré blanc
// de même taille, sans saut de mise en page.
// Le build Vite est relancé ici dans un dossier temporaire (≈ 2 s) : le test ne dépend pas
// d'un dist/ périmé. Marqueur du générateur : `isDark` (méthode de `qrcode-generator`,
// absente de tout autre module du front — vérifié sur le build avant le tour).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-boucle-t1-'))
const BUILD = join(dossier, 'dist')
after(() => rmSync(dossier, { recursive: true, force: true }))

/** Même définition que tests/performance-bundle-p2-q2.test.ts : entrée + imports statiques, pas les import(). */
function fichiersInitiaux(dist: string): string[] {
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const depart = [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)].map((m) => m[1])
  const vus = new Set<string>()
  const pile = [...depart]
  while (pile.length) {
    const f = pile.pop()!
    if (vus.has(f)) continue
    vus.add(f)
    const js = readFileSync(join(dist, 'assets', f), 'utf8')
    for (const m of js.matchAll(/(?:from|import)\s*"\.\/([^"]+\.js)"/g)) pile.push(m[1])
  }
  return [...vus]
}

describe('Boucle t1 : QR code hors du bundle initial', () => {
  let initiaux: string[] = []
  let tous: string[] = []
  const contenu = (f: string) => readFileSync(join(BUILD, 'assets', f), 'utf8')

  before(async () => {
    const { build } = await import('vite')
    await build({ root: RACINE, configFile: join(RACINE, 'vite.config.ts'), logLevel: 'silent', build: { outDir: BUILD, emptyOutDir: true } })
    initiaux = fichiersInitiaux(BUILD)
    tous = readdirSync(join(BUILD, 'assets')).filter((f) => f.endsWith('.js'))
  })

  test('qrcode-generator absent du bundle initial, présent dans un fichier différé', () => {
    for (const f of initiaux) assert.doesNotMatch(contenu(f), /isDark/, `${f} : qrcode-generator dans le bundle initial`)
    const differes = tous.filter((f) => !initiaux.includes(f) && contenu(f).includes('isDark'))
    assert.equal(differes.length, 1, `un seul fichier différé doit porter le générateur QR, trouvé : ${differes.join(', ')}`)
    assert.match(differes[0], /^QrCode-/, 'le fichier différé est celui du composant QrCode')
  })

  test('source : QrCode déménagé, ui.tsx nettoyé, CarteFidelite en différé avec repli même taille', () => {
    const qr = lire('src/components/QrCode.tsx')
    assert.match(qr, /import qrcode from 'qrcode-generator'/)
    assert.match(qr, /export function QrCode\(/)
    assert.match(qr, /qr\.isDark\(/)
    const ui = lire('src/components/ui.tsx')
    assert.doesNotMatch(ui, /qrcode-generator/)
    assert.doesNotMatch(ui, /export function QrCode/)
    const carte = lire('src/components/CarteFidelite.tsx')
    assert.match(carte, /const QrCode = lazy\(\(\) => import\('\.\/QrCode'\)\.then\(\(m\) => \(\{\s*default: m\.QrCode\s*\}\)\)\)/)
    // Repli de chargement annoncé comme tel (revue Codex t1, point 2) : role="status" + texte visible,
    // jamais annoncé comme un QR utilisable ; frontière locale (point 1) : un import rejeté ne
    // remplace pas toute la carte, seule la case du QR affiche un repli.
    assert.match(carte, /\{t\('Chargement du QR code…'\)\}/)
    assert.match(carte, /role="status"/)
    assert.match(carte, /class ErreurQr extends Component/)
    assert.match(carte, /<ErreurQr message=\{t\('QR code indisponible pour le moment\. Rechargez la page pour réessayer\.'\)\}>/)
    assert.match(carte, /<QrCode texte=\{urlAbsolue\('carte', client\.id\)\} className="h-40 w-40" titre=\{`QR code personnel de \$\{client\.prenom\}`\} \/>/)
    // Traductions des deux libellés (P2-Q1 : aucun t('…') sans entrée EN).
    assert.match(lire('src/lib/langue.ts'), /'Chargement du QR code…': 'Loading the QR code…',/)
    assert.match(lire('src/lib/langue.ts'), /'QR code indisponible pour le moment\. Rechargez la page pour réessayer\.': 'QR code unavailable right now\. Reload the page to try again\.',/)
  })

  test('pages différées : QrCode importé depuis le nouveau module, jamais depuis ui', () => {
    for (const p of ['Equipe', 'MenuCarte', 'FicheClient', 'QrVitrine', 'Roulette']) {
      const src = lire(`src/pages/${p}.tsx`)
      assert.match(src, /import \{ QrCode \} from '\.\.\/components\/QrCode'/, p)
      assert.doesNotMatch(src, /QrCode.*from '\.\.\/components\/ui'|from '\.\.\/components\/ui'.*QrCode/, `${p} : QrCode encore importé depuis ui`)
    }
  })
})

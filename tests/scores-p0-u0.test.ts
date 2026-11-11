// P0-U0 — Mesure initiale avant refonte : SCORES.md existe, contient les sections attendues, et ses chiffres
// de bundle correspondent à un build frais à 5 % près. Discipline : SCORES.md est mis à jour à chaque lot ;
// ce test fait échouer la suite si un lot change le bundle sans mettre à jour SCORES.md.
// Le build Vite est relancé ici dans un dossier temporaire (≈ 2 s) : le test ne dépend pas d'un dist/ périmé.
// La tolérance de 5 % ne garantit pas le seuil « pas de régression » de SCORES.md : elle couvre la
// staleness du document, la non-régression reste une règle humaine vérifiée à la relecture du lot.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RACINE = join(import.meta.dirname, '..')
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-scores-p0-u0-'))
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

function nombre(scores: string, motif: RegExp, quoi: string): number {
  const m = scores.match(motif)
  assert.ok(m, `SCORES.md : « ${quoi} » introuvable`)
  return Number(m[1])
}

/** Écart relatif autorisé entre SCORES.md et le build frais (le bundle bouge d'un lot à l'autre). */
const ECART_MAX = 0.05

function ecartOk(annonce: number, mesure: number, quoi: string) {
  const ecart = Math.abs(mesure - annonce) / annonce
  assert.ok(ecart <= ECART_MAX, `${quoi} : SCORES.md annonce ${annonce}, build frais ${mesure} (écart ${(ecart * 100).toFixed(1)} % > 5 % — mettre à jour SCORES.md)`)
}

describe('P0-U0 : SCORES.md, référence avant refonte', () => {
  const chemin = join(RACINE, 'SCORES.md')
  assert.ok(existsSync(chemin), 'SCORES.md absent à la racine du repo')
  const scores = readFileSync(chemin, 'utf8')

  test('sections attendues présentes (titres Markdown, pas de simples mentions)', () => {
    for (const section of ['Protocole', 'Bundle', 'Couverture de tests', 'Erreurs console', 'npm audit', 'Temps de premier affichage', 'Lighthouse', 'Parcours scan → lot', 'Cohérence DA', 'Seuils de réussite']) {
      assert.match(scores, new RegExp(`^## ${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm'), `titre « ## ${section} » absent de SCORES.md`)
    }
  })

  test('seuils définis avant la refonte, dans le tableau des seuils', () => {
    const seuils = scores.split('## Seuils de réussite')[1]
    assert.ok(seuils, 'section Seuils absente')
    assert.match(seuils, /Scan → lot.*< 30 s/)
    assert.match(seuils, /Lighthouse mobile.*≥ 95/)
    assert.match(seuils, /Note DA moyenne.*≥ 9\/10/)
    assert.match(seuils, /Bundle initial.*pas de régression/)
  })

  test('parcours inexistants dits explicitement (menu → commande, réservation)', () => {
    assert.match(scores, /Menu → commande et réservation : n'existent pas dans l'app/)
  })

  test('Lighthouse mesuré localement, pas prétendu sur téléphone', () => {
    assert.match(scores, /Score performance : \d+/)
    assert.match(scores, /pas de\s+mesure Lighthouse sur téléphone réel/)
  })

  test('arithmétique exacte des chiffres publiés (JS + CSS = total)', () => {
    const js = nombre(scores, /JS initial non gzipé : (\d+) o/, 'JS initial')
    const css = nombre(scores, /CSS non gzipé : (\d+) o/, 'CSS')
    const total = nombre(scores, /Total initial : (\d+) o/, 'Total initial')
    assert.equal(js + css, total, `SCORES.md : ${js} + ${css} ≠ ${total} (total publié incohérent)`)
  })

  test('bundle SCORES.md = build frais à 5 % près (initial, total, chunks, plus gros chunk)', async () => {
    const { build } = await import('vite')
    await build({ root: RACINE, configFile: join(RACINE, 'vite.config.ts'), logLevel: 'silent', build: { outDir: BUILD, emptyOutDir: true } })
    const initiaux = fichiersInitiaux(BUILD)
    const jsInitial = initiaux.reduce((n, f) => n + statSync(join(BUILD, 'assets', f)).size, 0)
    const css = readdirSync(join(BUILD, 'assets')).filter((f) => f.endsWith('.css')).reduce((n, f) => n + statSync(join(BUILD, 'assets', f)).size, 0)
    const tousJs = readdirSync(join(BUILD, 'assets')).filter((f) => f.endsWith('.js'))
    const jsTotal = tousJs.reduce((n, f) => n + statSync(join(BUILD, 'assets', f)).size, 0)
    const plusGros = Math.max(...tousJs.map((f) => statSync(join(BUILD, 'assets', f)).size))
    ecartOk(nombre(scores, /JS initial non gzipé : (\d+) o/, 'JS initial'), jsInitial, 'JS initial non gzipé')
    ecartOk(nombre(scores, /CSS non gzipé : (\d+) o/, 'CSS'), css, 'CSS non gzipé')
    ecartOk(nombre(scores, /Total initial : (\d+) o/, 'Total initial'), jsInitial + css, 'Total initial')
    ecartOk(nombre(scores, /JS total \(tous chunks\) : (\d+) o/, 'JS total'), jsTotal, 'JS total (tous chunks)')
    ecartOk(nombre(scores, /plus gros chunk : (\d+) o/, 'plus gros chunk'), plusGros, 'plus gros chunk')
    assert.equal(nombre(scores, /; (\d+) chunks ;/, 'nombre de chunks'), tousJs.length, 'nombre de chunks JS')
  })
})

// P2-Q5 — Documentation : garde-fous sur les affirmations vérifiables des README et des docs.
// Le lot a corrigé les affirmations périmées après les lots P0/P1/P2 (production en ligne, Brevo branché
// en mode test, polling 30 s, egress mesuré, compression, prérendu du menu, migrations 0009/0010).
// Ces tests ne prouvent pas les faits eux-mêmes (production, compte Brevo) : ils empêchent seulement
// que la documentation retombe sur les anciennes affirmations — y compris les contradictions connues
// (revue Codex P2-Q5). Les nombres de tests ne sont jamais codés en dur : le total du README est
// recoupé avec celui de SCORES.md, et le nombre de fichiers est compté dans tests/.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const source = (f: string) => readFileSync(join(import.meta.dirname, '..', f), 'utf8')
const readme = () => source('README.md')
const serveur = () => source('server/README.md')
const nombreTestsReadme = () => {
  const m = /\*\*(\d+) tests/.exec(readme())
  assert.ok(m, 'README : nombre de tests introuvable')
  return Number(m[1])
}
const nombreTestsScores = () => {
  const m = /\*\*(\d+)\/(\d+)\*\*/.exec(source('SCORES.md'))
  assert.ok(m, 'SCORES.md : compteur de tests introuvable')
  assert.equal(m[1], m[2], 'SCORES.md : réussites ≠ total')
  return Number(m[1])
}
const nombreFichiersTests = () => readdirSync(join(import.meta.dirname)).filter((f) => f.endsWith('.test.ts')).length

describe('P2-Q5 : README racine — production et branchements à jour', () => {
  test('plus aucune affirmation « rien déployé / projet pas créé »', () => {
    assert.doesNotMatch(readme(), /projet PAS créé/)
    assert.doesNotMatch(readme(), /Rien n'a été créé ni déployé/)
    assert.doesNotMatch(readme(), /fait en local seulement\. Rien n'est déployé/)
    assert.doesNotMatch(readme(), /124 tests/)
  })

  test('production en ligne nommée, nombre de tests recoupé avec SCORES.md', () => {
    assert.match(readme(), /https:\/\/asian-home-fidelite\.onrender\.com/)
    assert.match(readme(), /En ligne depuis le 09\/11\/2026/)
    assert.equal(nombreTestsReadme(), nombreTestsScores(), 'README et SCORES.md annoncent deux totaux différents')
    assert.match(readme(), /migrations \*\*0001–0008 appliquées le 10\/11\/2026\*\*/)
  })

  test('nombre de fichiers de tests annoncé = fichiers présents', () => {
    const m = /(\d+) fichiers, suite verte/.exec(readme())
    assert.ok(m, 'README : nombre de fichiers de tests introuvable')
    assert.equal(Number(m[1]), nombreFichiersTests())
  })

  test('aucune des contradictions connues ne subsiste (revue Codex P2-Q5)', () => {
    assert.doesNotMatch(readme(), /4 tables RLS/)
    assert.doesNotMatch(readme(), /aucun écran ne le recueille encore/)
    assert.doesNotMatch(readme(), /aucun bouton « Envoyer » n'existe/)
    assert.doesNotMatch(serveur(), /aucun déploiement n'a été fait/)
    assert.doesNotMatch(serveur(), /en attente des clés/)
    assert.doesNotMatch(source('docs/BREVO.md'), /clés attendues/)
  })

  test('rechargement du store à 30 s (P1-P1), pas 10 s', () => {
    assert.match(readme(), /rechargement toutes les \*\*30 s\*\*/)
    assert.doesNotMatch(readme(), /recharge tout toutes les 10 s/)
  })

  test('egress mesuré, pas l’estimation ~8 Go/mois', () => {
    assert.match(readme(), /3,04 Go\/mois/)
    assert.match(readme(), /3,50 Go\/mois/)
    assert.doesNotMatch(readme(), /8 Go\/mois/)
  })

  test('Brevo branché en mode test, pas « à brancher » sans clé', () => {
    assert.match(readme(), /Branchés en mode test depuis le 11\/11\/2026/)
    assert.match(readme(), /modeTest: true/)
  })
})

describe('P2-Q5 : server/README.md — affirmations vérifiées dans le code', () => {
  test('compression documentée (P2-Q2 : brotli/gzip, seuil, cache) et recoupée avec le code', () => {
    assert.match(serveur(), /Compression des réponses \(P2-Q2\)/)
    assert.match(serveur(), /brotli \(qualité 5/)
    assert.match(serveur(), /gzip \(niveau 6\)/)
    assert.match(serveur(), /1 024 octets/)
    assert.match(serveur(), /128 entrées max/)
    assert.match(source('server/app.ts'), /const CACHE_COMPRESSION_MAX = 128/)
    assert.match(source('server/app.ts'), /const SEUIL_COMPRESSION_OCTETS = 1024/)
  })

  test('menu prérendu et lien court /r/ documentés (P2-Q4, P2-Q3)', () => {
    assert.match(serveur(), /GET \/menu\/:commerceId/)
    assert.match(serveur(), /Page menu prérendue/)
    assert.match(serveur(), /GET \/r\/:commerceId/)
    assert.match(serveur(), /Lien court du QR vitrine/)
  })

  test('/sante : les 4 clés de migrations, dont mesure (0008)', () => {
    assert.match(serveur(), /`migrations` : `\{ cartiz, programme, relances, mesure \}`/)
  })

  test('polling 30 s partout où il s’agit du store, 10 s seulement pour la boucle Jouer', () => {
    assert.doesNotMatch(serveur(), /recharge tout l'état toutes les 10 s/)
    assert.doesNotMatch(serveur(), /8 Go\/mois avant compression/)
    assert.match(serveur(), /toutes les 30 s tant qu'un écran commerçant est visible/)
  })

  test('limites honnêtes : journal d’audit et mode strict client', () => {
    assert.match(serveur(), /journal d'audit/)
    assert.doesNotMatch(serveur(), /pas de journal « qui a fait quoi »/)
    assert.match(serveur(), /En mode `stricte` \(production\), un jeton client est exigé/)
  })
})

describe('P2-Q5 : docs/ — Brevo et SEO cohérents avec le code et les fichiers publics', () => {
  test('docs/BREVO.md : compte créé le 11/11, 5 variables, plus « aucun compte »', () => {
    const brevo = source('docs/BREVO.md')
    assert.doesNotMatch(brevo, /Aucun compte Brevo n'existe/)
    assert.match(brevo, /créé et activé le 11\/11/)
    assert.match(brevo, /5 variables Render sont posées/)
    assert.match(brevo, /Variables Render \(5 variables, voir §4\)/)
  })

  test('docs/SEO.md : le sitemap liste l’adresse prérendue, pas les fragments', () => {
    const sitemap = source('public/sitemap.xml')
    assert.match(sitemap, /\/menu\/c-asian-home-paris/)
    assert.doesNotMatch(sitemap, /#\//)
    const seo = source('docs/SEO.md')
    assert.match(seo, /`\/`, `\/menu\/c-asian-home-paris`/)
    assert.doesNotMatch(seo, /`\/`, `\/\#\/menu`, `\/\#\/jouer`/)
  })
})

// P3-4 — Hygiène git : branches fusionnées supprimées, règle consignée.
// Garde-fous : le document existe et dit la règle, le critère et les
// suppressions ; le dépôt ne contient plus les deux branches témoins
// (fix/409-meta-cas, supprimée local + origin ; brevo-branchement,
// locale seule). Aucun accès réseau : `git branch` lit le dépôt local.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const RACINE = join(import.meta.dirname, '..')
const DOC = join(RACINE, 'docs', 'HYGIENE-BRANCHES.md')

function lireDoc(): string {
  return readFileSync(DOC, 'utf8')
}

function branchesLocales(): string[] {
  const sortie = execFileSync('git', ['branch', '--format=%(refname:short)'], {
    cwd: RACINE,
    encoding: 'utf8',
  })
  return sortie.split('\n').map((ligne) => ligne.trim()).filter(Boolean)
}

test('P3-4 : le document d’hygiène des branches existe', () => {
  assert.ok(existsSync(DOC), 'docs/HYGIENE-BRANCHES.md doit exister')
})

test('P3-4 : la règle « base master + worktree séparé » est consignée', () => {
  const doc = lireDoc()
  assert.match(doc, /base master \+ worktree séparé/)
  assert.match(doc, /worktree Git dédié/)
  assert.match(doc, /jamais de fusion vers `master` dans la\s+boucle produit/)
})

test('P3-4 : le critère de suppression est écrit (ancêtre de master, des deux côtés)', () => {
  const doc = lireDoc()
  assert.match(doc, /merge-base --is-ancestor <branche> master/)
  assert.match(doc, /ancêtre de `origin\/master`/)
  assert.match(doc, /fetch frais/)
  assert.match(doc, /aucun worktree/)
})

test('P3-4 : fix/409-meta-cas est consignée avec sa pointe et sa fusion', () => {
  const doc = lireDoc()
  assert.match(doc, /`fix\/409-meta-cas` — pointe `35a3e4b`/)
  assert.match(doc, /fusionnée par `60e6a58`/)
  assert.match(doc, /supprimée en local \*\*et\*\* sur `origin`/)
})

test('P3-4 : les branches protégées sont nommées', () => {
  const doc = lireDoc()
  assert.match(doc, /`master` — production/)
  assert.match(doc, /`autonome\/integration` — branche de staging/)
})

test('P3-4 : fix/409-meta-cas n’existe plus en local (suppression vérifiée)', () => {
  assert.ok(!branchesLocales().includes('fix/409-meta-cas'))
})

test('P3-4 : brevo-branchement n’existe plus en local (locale seule supprimée)', () => {
  assert.ok(!branchesLocales().includes('brevo-branchement'))
})

test('P3-4 : le bilan chiffré de la suppression est consigné', () => {
  const doc = lireDoc()
  assert.match(doc, /78 branches fusionnées supprimées/)
  assert.match(doc, /15 branches locales restantes/)
  assert.match(doc, /INVENTAIRE-BRANCHES-P3-4\.json/)
})

// Recommandation R3 — QR par table pour le JEU : #/jouer/<commerceId>/<jetonTable>. Le serveur résout le jeton parmi
// les tables configurées (commande active ou non) et pose `table` sur le tirage ; jeton inconnu ou absent : tirage
// normal, sans table. Le tableau de bord compte les parties du jour par table (`compterPartiesParTable`).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { compterPartiesParTable } from '../src/lib/stats.ts'
import { lienJeuTable } from '../src/lib/tablesCommande.ts'
import { lireRoute } from '../src/router.ts'
import type { Commerce, Tirage } from '../src/types.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }

describe('R3 : serveur — le tirage retient la table du QR (SQLite)', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-r3-table-'))
  const fichierDb = join(dossier, 'r3.db')
  let app: Awaited<ReturnType<typeof creerServeur>>
  let base = ''
  let ip = 0
  let n = 0

  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.33.${Math.floor(++ip / 250)}.${ip % 250}`, ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    return { statut: r.status, contenu: await r.json() }
  }
  const etat = async () => (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu as { commerce: Commerce; tirages: Tirage[] }
  const nouveauContact = () => `06${String(33_000_000 + ++n).padStart(8, '0')}`
  const tirer = (extra: Record<string, unknown> = {}) => api('POST', `/commerces/${AH}/tirages`, { contact: nouveauContact(), prenom: 'Joueur', ...extra })
  const tirageStocke = async (id: string) => (await etat()).tirages.find((t) => t.id === id)!

  before(async () => {
    app = await creerServeur({ fichierDb, adminPin: '98765432', pinInitial: '1234', version: 'test', maintenant: () => new Date('2026-11-10T11:00:00Z'), derriereProxy: true })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
    // Roue jouable sans visite (mode libre), un seul lot ; tables configurées, commande à table ÉTEINTE.
    const r = await api('PATCH', `/commerces/${AH}`, {
      modeAccesRoue: 'libre',
      limiteGainsMois: 0,
      lots: [{ id: 'lot-nems', type: 'lot', libelle: 'Nems', probabilite: 100 }],
      commande: { active: false, tables: [{ nom: 'Table 4' }, { nom: 'Terrasse' }] },
    }, PIN)
    assert.equal(r.statut, 200, JSON.stringify(r.contenu))
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('jeton d’une vraie table (commande éteinte) → 201, le tirage stocké porte le nom de la table', async () => {
    const tables = (await etat()).commerce.commande!.tables
    assert.equal(tables.length, 2)
    const jeton = tables.find((t) => t.nom === 'Terrasse')!.jeton
    const r = await tirer({ jetonTable: jeton })
    assert.equal(r.statut, 201, JSON.stringify(r.contenu))
    assert.equal(r.contenu.table, undefined, 'réponse publique inchangée')
    assert.equal((await tirageStocke(r.contenu.tirageId)).table, 'Terrasse')
  })

  test('jeton inconnu → 201, tirage normal sans table (jamais d’erreur, jamais un nom venu du client)', async () => {
    const r = await tirer({ jetonTable: 'jeton-invente-0000000000', table: 'Table VIP' })
    assert.equal(r.statut, 201, JSON.stringify(r.contenu))
    assert.equal('table' in (await tirageStocke(r.contenu.tirageId)), false)
    const nonTexte = await tirer({ jetonTable: { nom: 'Table 4' } })
    assert.equal(nonTexte.statut, 201, JSON.stringify(nonTexte.contenu))
    assert.equal('table' in (await tirageStocke(nonTexte.contenu.tirageId)), false)
  })

  test('sans jeton → 201, aucun table (parcours générique #/jouer/<id> inchangé)', async () => {
    const r = await tirer()
    assert.equal(r.statut, 201, JSON.stringify(r.contenu))
    assert.equal('table' in (await tirageStocke(r.contenu.tirageId)), false)
  })
})

describe('R3 : compterPartiesParTable (helper pur)', () => {
  const t = (id: string, date: string, table?: string): Tirage => ({ id, commerceId: AH, clientId: `cl-${id}`, lot: 'Nems', date, ...(table ? { table } : {}) })

  test('compte par table le jour de Paris donné seulement, ignore les tirages sans table', () => {
    const tirages = [
      t('1', '2026-11-10T09:00:00Z', 'Terrasse'),
      t('2', '2026-11-10T12:00:00Z', 'Table 4'),
      t('3', '2026-11-10T20:00:00Z', 'Terrasse'),
      t('4', '2026-11-10T13:00:00Z'), // sans table
      t('5', '2026-11-09T12:00:00Z', 'Table 4'), // la veille
      t('6', '2026-11-09T23:30:00Z', 'Table 4'), // 00 h 30 à Paris le 10
      t('7', '2026-11-10T23:30:00Z', 'Terrasse'), // 00 h 30 à Paris le 11
    ]
    // Égalité à 2 : ordre alphabétique (« Table 4 » avant « Terrasse »).
    assert.deepEqual(compterPartiesParTable(tirages, '2026-11-10'), [['Table 4', 2], ['Terrasse', 2]])
    assert.deepEqual(compterPartiesParTable(tirages, '2026-11-11'), [['Terrasse', 1]])
    assert.deepEqual(compterPartiesParTable(tirages, '2026-11-12'), [])
    assert.deepEqual(compterPartiesParTable([t('8', '2026-11-10T12:00:00Z')], '2026-11-10'), [])
  })

  test('tri : nombre décroissant, puis nom alphabétique ; heure d’été (Paris = UTC+2) prise en compte', () => {
    const tirages = [
      t('1', '2026-07-01T10:00:00Z', 'Bar'),
      t('2', '2026-07-01T10:00:00Z', 'Zinc'),
      t('3', '2026-07-01T11:00:00Z', 'Zinc'),
      t('4', '2026-07-01T12:00:00Z', 'Alcôve'),
      t('5', '2026-06-30T22:30:00Z', 'Bar'), // 00 h 30 à Paris le 1er juillet
      t('6', '2026-07-01T22:30:00Z', 'Alcôve'), // 00 h 30 à Paris le 2 juillet
    ]
    assert.deepEqual(compterPartiesParTable(tirages, '2026-07-01'), [['Bar', 2], ['Zinc', 2], ['Alcôve', 1]])
  })
})

describe('R3 : routeur et liens', () => {
  test('#/jouer/<commerce>/<jeton> → param2 ; #/jouer/<commerce> → pas de param2', () => {
    assert.deepEqual(lireRoute('#/jouer/c-x/jeton-y'), { page: 'jouer', param: 'c-x', param2: 'jeton-y' })
    const generique = lireRoute('#/jouer/c-x')
    assert.deepEqual(generique, { page: 'jouer', param: 'c-x' })
    assert.equal('param2' in generique, false)
  })

  test('lien du jeu d’une table (Réglages) : URL absolue #/jouer/<id>/<jeton>, segments encodés', () => {
    assert.equal(lienJeuTable('https://x.fr/', 'c-a', 'AbC_-1'), 'https://x.fr/#/jouer/c-a/AbC_-1')
    assert.equal(lienJeuTable('https://x.fr/', 'c a', 'j/1'), 'https://x.fr/#/jouer/c%20a/j%2F1')
  })
})

describe('R3 : sources', () => {
  test('Jouer.tsx : le jeton de table (param2) part avec le tirage ; nom résolu par api.tableCommande, échec silencieux', () => {
    const jouer = lire('src/pages/Jouer.tsx')
    assert.match(jouer, /const \{ param2: jetonTable \} = useRoute\(\)/)
    assert.match(jouer, /avecJetonClient\(apiServeur, jetons, \(\) => joueurActif\.current, jetonTable\)/)
    assert.match(jouer, /jetonTable && apiServeur\.tableCommande\(commerce\.id, jetonTable\)\.then\(\(x\) => setTable\(x\.table\), \(\) => \{\}\)/)
    assert.match(jouer, /\{table && <p className="pastille-table">🍽 \{table\}<\/p>\}/)
    // Le tirage lui-même : la ligne épinglée par les lots précédents est inchangée.
    assert.match(jouer, /lancerTirage\(api, commerce, joueur\.contact, joueur\.prenom\)/)
    const jeuApi = lire('src/data/jeuApi.ts')
    // Argument ajouté seulement s'il existe : sans QR de table, l'appel garde ses 5 arguments (P0-S7 lit le dernier).
    assert.match(jeuApi, /api\.tirer\(commerceId, contact, prenom, parrain, jeton \?\? de\(joueurActif\(\)\), \.\.\.\(jetonTable \? \[jetonTable\] : \[\]\)\)/)
    const api = lire('src/data/api.ts')
    assert.match(api, /corps: \{ contact, \.\.\.\(prenom \? \{ prenom \} : \{\}\), \.\.\.\(parrain \? \{ parrain \} : \{\}\), jetonTable \}/)
  })

  test('Commande.tsx : lien « Jouer et gagner » vers #/jouer/<commerce>/<jeton>, traduit, sans animation', () => {
    const page = lire('src/pages/Commande.tsx')
    assert.match(page, /href=\{`#\/jouer\/\$\{encodeURIComponent\(commerceId\)\}\/\$\{encodeURIComponent\(jetonTable\)\}`\}/)
    assert.match(page, /\{t\('Jouer et gagner'\)\}/)
    assert.match(page, /'Jouer et gagner': 'Play and win',/)
  })

  test('TableauDeBord.tsx : carte « Parties par table (aujourd’hui) » seulement s’il y a des parties, via compterPartiesParTable', () => {
    const tdb = lire('src/pages/TableauDeBord.tsx')
    assert.match(tdb, /const parTable = compterPartiesParTable\(tirages, jourParis\(new Date\(\)\)\)/)
    assert.match(tdb, /\{parTable\.length > 0 && \(/)
    assert.match(tdb, /Parties par table \(aujourd’hui\)/)
    assert.match(tdb, /\{nom\} — \{n\} partie\{n > 1 \? 's' : ''\}/)
  })

  test('Réglages → Commande à table : « Copier le lien du jeu » par table', () => {
    const section = lire('src/components/ReglagesCommande.tsx')
    assert.match(section, /<BoutonCopier texte=\{lienJeuTable\(baseApp\(\), commerce\.id, t\.jeton\)\} libelle="Copier le lien du jeu"/)
  })

  test('serveur : table résolue depuis le jeton parmi les tables configurées, jamais depuis un nom reçu', () => {
    const app = lire('server/app.ts')
    assert.match(app, /const table = typeof corps\.jetonTable === 'string' \? commerce\.commande\?\.tables\.find\(\(x\) => x\.jeton === corps\.jetonTable\)\?\.nom : undefined/)
    assert.doesNotMatch(app, /corps\.table\b/)
  })
})

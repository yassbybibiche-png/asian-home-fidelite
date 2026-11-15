// P3-3 — Parcours « premiers réglages » : encadré de démarrage de Réglages (lots, plafond du lot principal, QR),
// lu sur l'état ENREGISTRÉ du commerce. Logique pure (src/lib/demarrage.ts), puis vrai serveur HTTP sur SQLite
// temporaire : `qrImprime` accepté, validé et relu, jamais effacé par un PATCH qui ne le mentionne pas (le piège
// du formulaire principal : un brouillon ouvert avant la confirmation ne doit pas la remettre à zéro).
// Parcours navigateur complet : tests-e2e/demarrage-p3-3.spec.ts.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { etatDemarrage } from '../src/lib/demarrage.ts'
import type { Commerce, Lot, Tirage } from '../src/types.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')
const sansCommentaires = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

describe('P3-3 : état de démarrage (logique pure)', () => {
  const commerce = (lots: Lot[], qrImprime?: boolean): Pick<Commerce, 'lots' | 'qrImprime'> => ({ lots, qrImprime })

  test('sans lot : lots à faire, plafond sans objet (rien à plafonner), QR à faire — 0/2', () => {
    const e = etatDemarrage(commerce([]))
    assert.equal(e.faites, 0)
    assert.equal(e.applicables, 2)
    assert.deepEqual(
      e.verifications.map((v) => [v.id, v.etat]),
      [
        ['lots', 'aFaire'],
        ['plafond', 'sansObjet'],
        ['qr', 'aFaire'],
      ],
    )
    assert.equal(e.verifications[1].detail, 'Aucun lot physique à gagner : rien à plafonner.')
    assert.match(e.verifications[0].aide ?? '', /onglet Roulette/)
  })

  test('lots à 0 % ou perdants seulement : aucun lot à gagner', () => {
    const e = etatDemarrage(
      commerce([
        { libelle: 'Nems offerts', type: 'lot', probabilite: 0 },
        { libelle: 'Perdu', type: 'perdant', probabilite: 100 },
      ]),
    )
    assert.equal(e.verifications[0].etat, 'aFaire')
    assert.equal(e.verifications[1].etat, 'sansObjet', 'le seul lot physique est à 0 % : il ne sort jamais, son plafond est sans objet')
    assert.equal(e.verifications[1].detail, 'Aucun lot physique à gagner : rien à plafonner.')
  })

  test('lot physique sans plafond : lots fait, plafond à faire en nommant le lot', () => {
    const e = etatDemarrage(
      commerce([
        { libelle: 'Nems offerts', type: 'lot', probabilite: 70 },
        { libelle: 'Perdu', type: 'perdant', probabilite: 30 },
      ]),
    )
    assert.equal(e.verifications[0].etat, 'fait')
    assert.equal(e.verifications[0].detail, '1 lot à gagner sur la roue')
    assert.equal(e.verifications[1].etat, 'aFaire')
    assert.match(e.verifications[1].aide ?? '', /« Nems offerts ».*premier lot physique/)
    assert.match(e.verifications[1].aide ?? '', /sans plafond, il peut sortir sans limite/)
    assert.equal(e.faites, 1)
    assert.equal(e.applicables, 3)
  })

  test('plafond 0 = illimité : à faire ; plafond > 0 : fait, avec le nombre', () => {
    const sans = etatDemarrage(commerce([{ libelle: 'Nems offerts', type: 'lot', probabilite: 70, plafondJour: 0 }]))
    assert.equal(sans.verifications[1].etat, 'aFaire')
    const avec = etatDemarrage(commerce([{ libelle: 'Nems offerts', type: 'lot', probabilite: 70, plafondJour: 3 }]))
    assert.equal(avec.verifications[1].etat, 'fait')
    assert.equal(avec.verifications[1].detail, '« Nems offerts » plafonné à 3 par jour')
  })

  test('lot principal = PREMIER lot physique de la roue, pas le premier de la liste', () => {
    const e = etatDemarrage(
      commerce([
        { libelle: '10 points offerts', type: 'points', points: 10, probabilite: 30 },
        { libelle: 'Thé glacé', type: 'lot', probabilite: 20, plafondJour: 2 },
        { libelle: 'Nems offerts', type: 'lot', probabilite: 20 },
      ]),
    )
    assert.equal(e.verifications[1].etat, 'fait')
    assert.match(e.verifications[1].detail, /« Thé glacé » plafonné à 2 par jour/)
  })

  test('points seulement : lot à gagner (consolation), plafond sans objet — 1/2', () => {
    const e = etatDemarrage(commerce([{ libelle: '10 points offerts', type: 'points', points: 10, probabilite: 100 }]))
    assert.equal(e.verifications[0].etat, 'fait')
    assert.equal(e.verifications[0].detail, '1 lot à gagner sur la roue')
    assert.equal(e.verifications[1].etat, 'sansObjet')
    assert.equal(e.faites, 1)
    assert.equal(e.applicables, 2)
  })

  test('deux lots gagnables : pluriel ; QR confirmé : fait — 3/3', () => {
    const e = etatDemarrage(
      commerce(
        [
          { libelle: 'Nems offerts', type: 'lot', probabilite: 50, plafondJour: 3 },
          { libelle: '10 points offerts', type: 'points', points: 10, probabilite: 50 },
        ],
        true,
      ),
    )
    assert.equal(e.verifications[0].detail, '2 lots à gagner sur la roue')
    assert.equal(e.verifications[2].etat, 'fait')
    assert.equal(e.verifications[2].detail, 'Confirmé par vous.')
    assert.equal(e.faites, 3)
    assert.equal(e.applicables, 3)
  })

  test('config d’avant R1 sans type : type déduit du libellé (lot physique)', () => {
    const e = etatDemarrage(commerce([{ libelle: 'Mochi offert', probabilite: 20 }]))
    assert.equal(e.verifications[0].etat, 'fait')
    assert.equal(e.verifications[1].etat, 'aFaire')
    assert.match(e.verifications[1].aide ?? '', /« Mochi offert »/)
  })
})

describe('P3-3 : serveur (SQLite) — `qrImprime` accepté, validé, relu, jamais effacé par défaut', () => {
  const AH = 'c-asian-home-paris'
  const PIN = { 'X-Commerce-PIN': '1234' }
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p3-3-'))
  let app: Awaited<ReturnType<typeof creerServeur>>
  let base = ''

  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, { method: methode, headers: { 'Content-Type': 'application/json', ...entetes }, body: corps === undefined ? undefined : JSON.stringify(corps) })
    return { statut: r.status, contenu: await r.json() }
  }
  const etat = async () => (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu as { commerce: Commerce; tirages: Tirage[] }

  before(async () => {
    app = await creerServeur({ fichierDb: join(dossier, 'p3-3.db'), adminPin: '98765432', pinInitial: '1234', version: 'test' })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('qrImprime : accepté (true puis false), relu ; non booléen refusé (400)', async () => {
    assert.equal((await etat()).commerce.qrImprime, undefined, 'absent par défaut')
    assert.equal((await api('PATCH', `/commerces/${AH}`, { qrImprime: true }, PIN)).statut, 200)
    assert.equal((await etat()).commerce.qrImprime, true)
    assert.equal((await api('PATCH', `/commerces/${AH}`, { qrImprime: false }, PIN)).statut, 200)
    assert.equal((await etat()).commerce.qrImprime, false)
    const refus = await api('PATCH', `/commerces/${AH}`, { qrImprime: 'oui' }, PIN)
    assert.equal(refus.statut, 400)
    assert.match(refus.contenu.erreur, /qrImprime/)
    assert.equal((await etat()).commerce.qrImprime, false, 'le refus n’a rien changé')
  })

  test('un PATCH qui ne mentionne pas qrImprime ne l’efface pas (piège du formulaire principal)', async () => {
    assert.equal((await api('PATCH', `/commerces/${AH}`, { qrImprime: true }, PIN)).statut, 200)
    const r = await api('PATCH', `/commerces/${AH}`, { nom: 'Asian Home Paris', seuilTampons: 10 }, PIN)
    assert.equal(r.statut, 200, JSON.stringify(r.contenu))
    assert.equal((await etat()).commerce.qrImprime, true, 'la confirmation survit à un enregistrement des réglages')
    assert.equal((await etat()).commerce.seuilTampons, 10)
  })
})

describe('P3-3 : sources (Réglages, store, API, serveur)', () => {
  const reglages = lire('src/pages/Reglages.tsx')
  const store = lire('src/store.tsx')
  const api = lire('src/data/api.ts')
  const serveur = lire('server/app.ts')

  test('l’encadré est en haut de l’onglet Commerce, avec le titre et le bouton QR', () => {
    assert.match(reglages, /<EncadreDemarrage commerce=\{commerce\} \/>/)
    assert.ok(reglages.indexOf('<EncadreDemarrage commerce={commerce} />') < reglages.indexOf('Le commerce'), 'avant la section « Le commerce »')
    assert.match(reglages, /Pour bien démarrer/)
    assert.match(reglages, /J’ai imprimé le QR/)
    assert.match(reglages, /Voir le QR à imprimer/)
    assert.match(reglages, /href="#\/qr"/)
    assert.match(reglages, /Marquer comme non imprimé/)
    assert.match(reglages, /etatDemarrage\(\{ \.\.\.commerce, qrImprime \}\)/)
    // Les 3 libellés vivent dans la logique pure (src/lib/demarrage.ts), rendue par `{v.libelle}`.
    const demarrage = lire('src/lib/demarrage.ts')
    for (const libelle of ['Au moins un lot à gagner', 'Plafond du lot principal', 'QR imprimé et posé en boutique']) {
      assert.match(demarrage, new RegExp(libelle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), libelle)
    }
  })

  test('le bouton QR envoie le seul champ `qrImprime` (PATCH partiel, comme la commande à table)', () => {
    assert.match(reglages, /api\.majCommerce\(commerce\.id, a, \{ qrImprime: imprime \}\)/)
    assert.match(reglages, /MarquerQr|marquerQr/)
  })

  test('le formulaire principal n’envoie JAMAIS `qrImprime` (piège P1-B5 : un brouillon ouvert avant la confirmation ne doit pas l’effacer)', () => {
    // Le store envoie une liste de champs explicite : `qrImprime` n'en fait pas partie — la confirmation ne survit
    // que parce que le PATCH ne la mentionne pas. Garde-fou comportemental en E2E (démarrage-p3-3).
    assert.doesNotMatch(sansCommentaires(store), /qrImprime/)
  })

  test('`qrImprime` est un champ de réglages accepté côté front et côté serveur', () => {
    assert.match(api, /\| 'qrImprime'/)
    const ligne = serveur.split('\n').find((l) => l.includes('CHAMPS_REGLAGES ='))
    assert.ok(ligne?.includes("'qrImprime'"), 'CHAMPS_REGLAGES contient qrImprime')
    assert.match(serveur, /if \('qrImprime' in corps\) r\.qrImprime = booleen\(corps\.qrImprime, 'qrImprime'\)/)
  })
})

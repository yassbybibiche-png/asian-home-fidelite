// P1-G1 — RGPD : rappel de purge. Le tableau de bord (ouvert à chaque passage du commerçant) montre les cartes
// à purger (dues / dues sous 30 jours) avec le lien vers l'écran Clients ; la purge automatique est refusée
// explicitement (voir `src/lib/rgpd.ts`) : rien n'est jamais supprimé sans un geste du commerçant.
// La liste de purge elle-même et la route `GET …/purge` sont testées dans tests/rgpd-p1-b6.test.ts.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { nouveauClient } from '../src/lib/fidelite.ts'
import { nouveauCommerce } from '../src/data/defaults.ts'
import { listePurge, resumeRappelPurge } from '../src/lib/rgpd.ts'
import type { Client } from '../src/types.ts'

const source = (f: string) => readFileSync(join(import.meta.dirname, '..', f), 'utf8')
const commerce = nouveauCommerce('Chez Lin', 'restaurant', '')
const t = new Date('2026-11-10T12:00:00Z')
const client = (o: Partial<Client>): Client => ({ ...nouveauClient(commerce.id, 'Linh', { telephone: '0612345678' }, new Date('2020-01-01T12:00:00Z')), ...o })

describe('resumeRappelPurge : compteurs disjoints (due / bientôt / protégées)', () => {
  test('liste vide → zéros ; due, bientôt et protégées comptées séparément', () => {
    assert.deepEqual(resumeRappelPurge([]), { aPurger: 0, bientot: 0, proteges: 0 })
    assert.deepEqual(
      resumeRappelPurge([
        { id: 'a', prenom: 'A', derniereActivite: '2023-01-01', purgeLe: '2026-01-01', statut: 'due' },
        { id: 'b', prenom: 'B', derniereActivite: '2023-11-25', purgeLe: '2026-11-25', statut: 'bientot' },
        { id: 'c', prenom: 'C', derniereActivite: '2022-01-01', purgeLe: '2025-01-01', statut: 'due', protection: 'Exclu de la purge par le commerce' },
        { id: 'd', prenom: 'D', derniereActivite: '2023-11-20', purgeLe: '2026-11-20', statut: 'bientot', protection: 'Récompense gagnée pas encore retirée' },
      ]),
      { aPurger: 1, bientot: 1, proteges: 2 },
    )
  })

  test('composition avec listePurge : mêmes données que l’écran Clients, mêmes compteurs', () => {
    const due = client({ id: 'due', derniereVisite: '2023-01-01T12:00:00.000Z' })
    const bientot = client({ id: 'bientot', derniereVisite: '2023-11-25T12:00:00.000Z' })
    const actif = client({ id: 'actif', derniereVisite: '2026-10-01T12:00:00.000Z' })
    const exclu = client({ id: 'exclu', derniereVisite: '2022-01-01T12:00:00.000Z', exclusPurge: true })
    const recompense = client({ id: 'recompense', recompensesEnAttente: [{ id: 'r1', libelle: 'Boisson', origine: 'palier', creeLe: '2022-01-01T00:00:00.000Z' }] })
    const reserve = client({ id: 'reserve', reserve: { gagneLe: '2026-11-01T00:00:00.000Z', expireLe: '2026-12-01T00:00:00.000Z' } })
    const litige = client({ id: 'litige', demandesRattrapage: [{ id: 'd', date: '2022-01-01T00:00:00.000Z', montantCentimes: 100, statut: 'en_attente', creeLe: '2022-01-02T00:00:00.000Z' }] })
    const resume = resumeRappelPurge(listePurge([actif, bientot, due, exclu, recompense, reserve, litige], commerce, t))
    // 1 due sans protection, 1 bientôt sans protection, 4 protégées (exclu, récompense, réserve, litige) ; l'actif n'apparaît nulle part.
    assert.deepEqual(resume, { aPurger: 1, bientot: 1, proteges: 4 })
    // Sans aucune carte due : le rappel « bientôt » seul subsiste.
    assert.deepEqual(resumeRappelPurge(listePurge([actif, bientot], commerce, t)), { aPurger: 0, bientot: 1, proteges: 0 })
    // Durée personnalisée 12 mois : un client dont la dernière visite date d'il y a 13 mois devient « à purger ».
    assert.deepEqual(resumeRappelPurge(listePurge([client({ derniereVisite: '2025-10-01T12:00:00.000Z' })], { conservationMois: 12 }, t)), { aPurger: 1, bientot: 0, proteges: 0 })
  })
})

describe('Tableau de bord : rappel de purge visible, purge automatique refusée', () => {
  test('TableauDeBord.tsx : rappel calculé depuis les clients chargés (listePurge + resumeRappelPurge), lien vers Clients, en mode API seulement', () => {
    const src = source('src/pages/TableauDeBord.tsx')
    assert.match(src, /import \{ listePurge, resumeRappelPurge \} from '\.\.\/lib\/rgpd'/)
    assert.match(src, /mode === 'api' \? resumeRappelPurge\(listePurge\(clients, commerce, new Date\(\)\)\) : null/)
    assert.match(src, /rappelPurge\.aPurger > 0/)
    assert.match(src, /rappelPurge\.bientot > 0/)
    assert.match(src, /href="#\/clients"/)
    assert.match(src, /carte\{.*\} à purger/s)
    assert.match(src, /à purger dans moins de 30 jours/)
  })

  test('TableauDeBord.tsx : le rappel ne purge jamais — ni appel à purger, ni minuteur', () => {
    const src = source('src/pages/TableauDeBord.tsx')
    assert.doesNotMatch(src, /purger\(/)
    assert.doesNotMatch(src, /api\.purger/)
    assert.doesNotMatch(src, /setInterval/)
    assert.doesNotMatch(src, /setTimeout/)
  })

  test('Refus explicite de la purge automatique : documenté dans rgpd.ts et server/README.md', () => {
    assert.match(source('src/lib/rgpd.ts'), /refus explicite de la purge automatique/)
    assert.match(source('src/lib/rgpd.ts'), /RIEN n'est jamais supprimé sans un geste du/)
    assert.match(source('server/README.md'), /Purge automatique refusée explicitement \(P1-G1\)/)
    assert.match(source('server/README.md'), /Rappel périodique \(P1-G1\)/)
    // Portée qualifiée (revue Codex) : le rappel couvre les cartes purgeables en mode API ; les protégées
    // restent dans Clients, qui est la liste de référence.
    assert.match(source('server/README.md'), /l'écran Clients.*reste la liste de référence/s)
    assert.match(source('src/lib/rgpd.ts'), /Portée exacte de la garantie/)
  })
})

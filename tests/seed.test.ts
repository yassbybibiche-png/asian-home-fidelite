// Cohérence des données de démo et bouton « Réinitialiser la démo ».
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { depotLocal, seedRecale } from '../src/data/depot.ts'
import { calculerChiffres } from '../src/lib/stats.ts'
import { lotsJouables } from '../src/lib/roulette.ts'
import type { Etat } from '../src/types.ts'

const JOUR = 24 * 60 * 60 * 1000
const MAINTENANT = new Date(2026, 10, 15, 12, 0).getTime() // milieu de mois : « ce mois » non vide
const jourLocal = (iso: string) => new Date(iso).toDateString()

describe('Seed : 3 commerces cohérents', () => {
  const etat = seedRecale(MAINTENANT)

  test('3 commerces, Asian Home Paris en vitrine (commerce affiché par défaut)', () => {
    assert.equal(etat.commerces.length, 3)
    assert.equal(etat.commerces[0].nom, 'Asian Home Paris')
    assert.equal(etat.commerceActifId, etat.commerces[0].id)
    assert.match(etat.commerces[0].coordonnees ?? '', /11 rue André Joineau, 93310 Le Pré-Saint-Gervais/)
    assert.deepEqual(new Set(etat.commerces.map((c) => c.type)), new Set(['restaurant', 'salon', 'boutique']))
  })

  for (const commerce of seedRecale(MAINTENANT).commerces) {
    test(`${commerce.nom} : clients, visites, tampons, avis et tirages cohérents`, () => {
      const clients = etat.clients.filter((c) => c.commerceId === commerce.id)
      const avis = etat.avis.filter((a) => a.commerceId === commerce.id)
      const tirages = etat.tirages.filter((t) => t.commerceId === commerce.id)
      assert.ok(clients.length >= 5 && avis.length >= 5 && tirages.length >= 4)
      assert.ok(lotsJouables(commerce.lots).length >= 2)
      assert.ok(avis.some((a) => a.note <= 3), 'au moins un avis négatif (modèle « négatif »)')

      for (const c of clients) {
        assert.ok(c.visites.length >= 1, c.id)
        const t = c.visites.map((v) => new Date(v).getTime())
        assert.deepEqual([...t].sort((a, b) => a - b), t, `${c.id} : visites dans l’ordre`)
        assert.ok(t.every((x) => x <= MAINTENANT && x > MAINTENANT - 365 * JOUR), `${c.id} : dates récentes, jamais dans le futur`)
        assert.equal(c.derniereVisite, c.visites.at(-1))
        assert.equal(c.creeLe, c.visites[0])
        // Mêmes règles que l'app : 1 visite = 1 tampon, chaque récompense offerte consomme seuil tampons
        // (excédent reporté). Dans le seed, les récompenses dues sont remises : au plus 1 carte pleine en attente.
        const offertes = c.recompensesOffertes?.length ?? 0
        assert.equal(c.tampons, c.visites.length - offertes * commerce.seuilTampons, `${c.id} : tampons`)
        assert.ok(c.tampons >= 0 && c.tampons <= commerce.seuilTampons, `${c.id} : tampons dans [0, seuil]`)
        for (const r of c.recompensesOffertes ?? []) assert.ok(c.visites.includes(r.date), `${c.id} : récompense remise lors d’une visite`)
      }
      assert.ok(clients.some((c) => c.tampons === commerce.seuilTampons), 'un client a une récompense à offrir')
      assert.ok(clients.some((c) => MAINTENANT - new Date(c.derniereVisite).getTime() > 30 * JOUR), 'des clients à relancer')

      const parClientJour = new Set<string>()
      for (const ti of tirages) {
        const client = clients.find((c) => c.id === ti.clientId)
        assert.ok(client, `${ti.id} : client du même commerce`)
        assert.ok(client.visites.some((v) => jourLocal(v) === jourLocal(ti.date)), `${ti.id} : tirage un jour de visite`)
        assert.ok(new Date(ti.date).getTime() <= MAINTENANT)
        assert.ok(commerce.lots.some((l) => l.libelle === ti.lot), `${ti.id} : lot configuré`)
        const cle = `${ti.clientId}|${jourLocal(ti.date)}`
        assert.ok(!parClientJour.has(cle), `${ti.id} : 1 tirage par client et par jour`)
        parClientJour.add(cle)
      }

      const chiffres = calculerChiffres(clients, avis, new Date(MAINTENANT))
      assert.ok(chiffres.clientsActifs > 0 && chiffres.visitesCeMois > 0 && chiffres.tauxRetour > 0)
    })
  }
})

describe('Réinitialiser la démo', () => {
  const memoire = new Map<string, string>()
  beforeEach(() => {
    memoire.clear()
    Object.assign(globalThis, {
      localStorage: {
        getItem: (k: string) => memoire.get(k) ?? null,
        setItem: (k: string, v: string) => void memoire.set(k, v),
        removeItem: (k: string) => void memoire.delete(k),
      },
    })
  })

  test('premier chargement = seed ; les modifications sont conservées ; la réinitialisation restaure le seed', () => {
    const initial = depotLocal.charger()
    assert.equal(initial.commerces.length, 3)

    const modifie: Etat = {
      ...initial,
      commerces: [...initial.commerces, { ...initial.commerces[0], id: 'c-nouveau', nom: 'Nouveau commerce' }],
      clients: initial.clients.slice(1),
      avis: [],
      commerceActifId: 'c-nouveau',
    }
    depotLocal.enregistrer(modifie)
    assert.equal(depotLocal.charger().commerces.length, 4, 'les modifications survivent au rechargement')

    const remis = depotLocal.reinitialiser()
    assert.equal(remis.commerces.length, 3)
    assert.equal(remis.clients.length, initial.clients.length)
    assert.equal(remis.avis.length, initial.avis.length)
    assert.equal(remis.tirages.length, initial.tirages.length)
    assert.equal(remis.commerceActifId, initial.commerces[0].id)
    assert.equal(depotLocal.charger().commerces.length, 3, 'le seed restauré est bien enregistré')
  })

  test('données illisibles → on repart du seed', () => {
    memoire.set('fidelite:etat:v2', '{pas du json')
    assert.equal(depotLocal.charger().commerces.length, 3)
  })
})

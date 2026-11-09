// Tests de la logique métier pure (sans React ni navigateur).
// Lancés par `npm test` avec le lanceur intégré de Node (≥ 23.6 : TypeScript exécuté directement).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { nouveauCommerce } from '../src/data/defaults.ts'
import {
  analyserContact,
  messageRelance,
  nouveauClient,
  offrirRecompense,
  recompenseDebloquee,
  tamponsAffiches,
  trouverClientParContact,
  validerVisite,
} from '../src/lib/fidelite.ts'
import { lotsJouables, rotationCible, secteurs, tirageDuJour, tirerLot } from '../src/lib/roulette.ts'
import { appliquerRegles, modeleSuggere, statutAvis, texteModele } from '../src/lib/avis.ts'
import type { Avis, Commerce, Tirage } from '../src/types.ts'

const MAINTENANT = new Date(2026, 10, 9, 12, 0) // 9 novembre 2026, midi (heure locale)

function commerceTest(seuil = 3): Commerce {
  return { ...nouveauCommerce('  Asian Home Paris  ', 'restaurant', ''), id: 'c-test', seuilTampons: seuil, recompense: 'Un plat offert' }
}

describe('Création d’un commerce', () => {
  test('1 formulaire court suffit : le reste est pré-rempli, identique pour tous les secteurs', () => {
    const resto = nouveauCommerce('  Chez Lin  ', 'restaurant', ' https://g.page/r/x/review ')
    const garage = nouveauCommerce('Garage du Centre', 'garage', '')
    assert.equal(resto.nom, 'Chez Lin')
    assert.equal(resto.lienGoogle, 'https://g.page/r/x/review')
    assert.equal(resto.actif, true)
    assert.equal(resto.seuilTampons, 10)
    assert.ok(lotsJouables(resto.lots).length >= 2)
    assert.equal(resto.reglesReponseAuto.auto5Etoiles, true)
    // Aucune logique propre au secteur : mêmes réglages par défaut.
    assert.deepEqual(garage.lots, resto.lots)
    assert.equal(garage.recompense, resto.recompense)
    assert.notEqual(resto.id, garage.id)
  })
})

describe('Inscription d’un client', () => {
  test('téléphone ou e-mail, rien d’autre', () => {
    assert.deepEqual(analyserContact(' 06 12 34 56 78 '), { telephone: '06 12 34 56 78' })
    assert.deepEqual(analyserContact('+33 6 12 34 56 78'), { telephone: '+33 6 12 34 56 78' })
    assert.deepEqual(analyserContact('Marie@Exemple.FR'), { email: 'marie@exemple.fr' })
    assert.equal(analyserContact('0612'), null)
    assert.equal(analyserContact('marie@'), null)
    assert.equal(analyserContact(''), null)
  })

  test('carte vierge à l’inscription', () => {
    const client = nouveauClient('c-test', ' Linh ', { telephone: '06 12 34 56 78' }, MAINTENANT)
    assert.equal(client.prenom, 'Linh')
    assert.equal(client.tampons, 0)
    assert.deepEqual(client.visites, [])
    assert.equal(client.creeLe, MAINTENANT.toISOString())
  })

  test('le même contact retrouve le client existant (pas de doublon), dans ce commerce seulement', () => {
    const client = nouveauClient('c-test', 'Linh', { telephone: '06 12 34 56 78' }, MAINTENANT)
    const contact = analyserContact('+33612345678')!
    assert.equal(trouverClientParContact([client], 'c-test', contact)?.id, client.id)
    assert.equal(trouverClientParContact([client], 'c-autre', contact), undefined)
  })
})

describe('Tampons et progression', () => {
  test('+1 tampon par visite, jusqu’à la récompense', () => {
    const commerce = commerceTest(3)
    let client = nouveauClient(commerce.id, 'Karim', { email: 'karim@exemple.fr' }, MAINTENANT)
    client = validerVisite(client, commerce, MAINTENANT)
    assert.equal(tamponsAffiches(client, commerce), 1)
    assert.equal(client.visites.length, 1)
    assert.equal(client.derniereVisite, MAINTENANT.toISOString())
    assert.equal(recompenseDebloquee(client, commerce), false)
    assert.match(messageRelance(client, commerce), /plus que 2 tampons pour : Un plat offert/)

    client = validerVisite(validerVisite(client, commerce), commerce)
    assert.equal(tamponsAffiches(client, commerce), 3)
    assert.equal(recompenseDebloquee(client, commerce), true)
  })

  test('carte pleine : la visite est comptée mais les tampons restent plafonnés', () => {
    const commerce = commerceTest(2)
    let client = nouveauClient(commerce.id, 'Inès', { telephone: '0700000000' })
    for (let i = 0; i < 4; i++) client = validerVisite(client, commerce)
    assert.equal(client.tampons, 2)
    assert.equal(client.visites.length, 4)
  })

  test('offrir la récompense remet la carte à zéro et garde la trace', () => {
    const commerce = commerceTest(2)
    let client = nouveauClient(commerce.id, 'Inès', { telephone: '0700000000' })
    assert.equal(offrirRecompense(client, commerce), client, 'pas de récompense avant le seuil')
    client = validerVisite(validerVisite(client, commerce), commerce)
    client = offrirRecompense(client, commerce, MAINTENANT)
    assert.equal(client.tampons, 0)
    assert.deepEqual(client.recompensesOffertes, [{ date: MAINTENANT.toISOString(), libelle: 'Un plat offert' }])
  })
})

describe('Roulette', () => {
  const lots = [
    { libelle: 'Nems offerts', probabilite: 20 },
    { libelle: '', probabilite: 50 }, // ignoré : libellé vide
    { libelle: 'Thé offert', probabilite: 30 },
    { libelle: 'Pas de chance', probabilite: 50 },
  ]

  test('tirage pondéré, chances recalculées au prorata (total 100 ici sur 3 lots jouables)', () => {
    assert.equal(tirerLot(lots, 0), 0)
    assert.equal(tirerLot(lots, 0.19), 0)
    assert.equal(tirerLot(lots, 0.21), 1) // « Thé offert » (index parmi les lots jouables)
    assert.equal(tirerLot(lots, 0.99), 2)
    const compte = [0, 0, 0]
    for (let i = 0; i < 10000; i++) compte[tirerLot(lots, i / 10000)]++
    assert.deepEqual(compte, [2000, 3000, 5000])
  })

  test('la roue s’arrête dans le secteur gagnant', () => {
    const parts = secteurs(lots)
    assert.equal(Math.round(parts[parts.length - 1].fin), 360)
    for (const [i, alea] of [[0, 0], [1, 0.5], [2, 0.99]] as const) {
      const rotation = rotationCible(123, parts[i], alea)
      const sousLePointeur = (((360 - rotation) % 360) + 360) % 360
      assert.ok(sousLePointeur >= parts[i].debut && sousLePointeur <= parts[i].fin, `secteur ${i}`)
    }
  })

  test('1 tirage maximum par client et par jour', () => {
    const tirages: Tirage[] = [{ id: 't1', commerceId: 'c-test', clientId: 'cl-1', lot: 'Nems offerts', date: new Date(2026, 10, 9, 9, 30).toISOString() }]
    assert.ok(tirageDuJour(tirages, 'c-test', 'cl-1', MAINTENANT), 'déjà joué aujourd’hui')
    assert.equal(tirageDuJour(tirages, 'c-test', 'cl-2', MAINTENANT), undefined, 'un autre client peut jouer')
    assert.equal(tirageDuJour(tirages, 'c-autre', 'cl-1', MAINTENANT), undefined, 'autre commerce')
    assert.equal(tirageDuJour(tirages, 'c-test', 'cl-1', new Date(2026, 10, 10, 0, 5)), undefined, 'le lendemain, on rejoue')
  })
})

describe('Réponse à un avis', () => {
  const commerce = commerceTest()
  const avis = (note: number, texte = 'Très bon', extra: Partial<Avis> = {}): Avis => ({
    id: `a${note}`,
    commerceId: commerce.id,
    auteur: 'Sophie M.',
    note,
    texte,
    date: MAINTENANT.toISOString(),
    ...extra,
  })

  test('modèle adapté : 5★, 4★, négatif, sans texte', () => {
    assert.equal(modeleSuggere(avis(5)), 'cinq')
    assert.equal(modeleSuggere(avis(4)), 'quatre')
    assert.equal(modeleSuggere(avis(2)), 'negatif')
    assert.equal(modeleSuggere(avis(5, '  ')), 'sansTexte')
    assert.match(texteModele('cinq', avis(5), commerce), /^Merci beaucoup Sophie .*Asian Home Paris/)
  })

  test('règles : réponse auto aux 5★, brouillon pour les autres', () => {
    const auto = appliquerRegles(avis(5), commerce)
    assert.equal(statutAvis(auto), 'repondu')
    assert.equal(auto.reponseAuto, true)

    const quatre = appliquerRegles(avis(4), commerce) // auto4Etoiles désactivé par défaut
    assert.equal(statutAvis(quatre), 'brouillon')
    assert.equal(quatre.reponse, undefined)

    const negatif = appliquerRegles(avis(1, 'Décevant'), commerce)
    assert.equal(statutAvis(negatif), 'brouillon')
    assert.match(negatif.brouillon!, /désolés/)
  })

  test('une réponse déjà donnée n’est jamais écrasée ; sans règle, rien ne change', () => {
    const repondu = avis(5, 'Top', { reponse: 'Merci !' })
    assert.equal(appliquerRegles(repondu, commerce), repondu)
    const sansRegle = { ...commerce, reglesReponseAuto: { auto5Etoiles: false, auto4Etoiles: false, brouillonAutres: false } }
    const a = avis(5)
    assert.equal(appliquerRegles(a, sansRegle), a)
    assert.equal(statutAvis(a), 'sansReponse')
  })
})

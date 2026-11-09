// Tests de la logique métier pure (sans React ni navigateur).
// Lancés par `npm test` avec le lanceur intégré de Node (≥ 23.6 : TypeScript exécuté directement).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { nouveauCommerce } from '../src/data/defaults.ts'
import {
  analyserContact,
  cleContact,
  messageRelance,
  nouveauClient,
  offrirRecompense,
  recompenseDebloquee,
  tamponsAffiches,
  trouverClientParContact,
  validerVisite,
} from '../src/lib/fidelite.ts'
import { lotsJouables, peutJouer, rotationCible, secteurs, statutJeu, tirageDuJour, tirerLot } from '../src/lib/roulette.ts'
import { calculerChiffres, estActif, estARelancer } from '../src/lib/stats.ts'
import { migrer, seedRecale } from '../src/data/depot.ts'
import { appliquerRegles, modeleSuggere, statutAvis, texteModele } from '../src/lib/avis.ts'
import type { Avis, Client, Commerce, Tirage } from '../src/types.ts'

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

  test('non-régression : tous les formats français du même numéro retrouvent le même client', () => {
    const formats = [
      '06 12 34 56 78',
      '0612345678',
      '+33 6 12 34 56 78',
      '+33612345678',
      '0033 6 12 34 56 78',
      '0033612345678',
      '06.12.34.56.78',
      '06-12-34-56-78',
      '+33 (0)6 12 34 56 78',
    ]
    for (const inscrit of formats) {
      const client = nouveauClient('c-test', 'Linh', analyserContact(inscrit)!, MAINTENANT)
      for (const saisie of formats) {
        const contact = analyserContact(saisie)
        assert.ok(contact, `« ${saisie} » accepté`)
        assert.equal(cleContact(contact), '0612345678', `clé de « ${saisie} »`)
        assert.equal(trouverClientParContact([client], 'c-test', contact)?.id, client.id, `« ${inscrit} » retrouvé par « ${saisie} »`)
      }
    }
    // Numéro étranger : chiffres conservés tels quels, pas confondu avec un numéro français.
    assert.equal(cleContact({ telephone: '+44 7911 123456' }), '447911123456')
    assert.equal(cleContact({ telephone: '+32 470 12 34 56' }), '32470123456')
    assert.equal(cleContact({ email: ' Marie@Exemple.FR ' }), 'marie@exemple.fr')
  })

  test('non-régression : réinscription avec un autre format de numéro → pas de doublon', () => {
    // Même enchaînement que inscrireClient (store.tsx) : chercher l’existant avant de créer.
    const inscrire = (clients: Client[], saisie: string) => {
      const contact = analyserContact(saisie)!
      const existant = trouverClientParContact(clients, 'c-test', contact)
      return existant ? clients : [...clients, nouveauClient('c-test', 'Linh', contact, MAINTENANT)]
    }
    let clients = inscrire([], '06 12 34 56 78')
    clients = inscrire(clients, '0033612345678')
    clients = inscrire(clients, '+33 6 12 34 56 78')
    assert.equal(clients.length, 1)
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

  test('carte pleine : chaque visite compte un tampon, seul l’affichage est plafonné', () => {
    const commerce = commerceTest(2)
    let client = nouveauClient(commerce.id, 'Inès', { telephone: '0700000000' })
    for (let i = 0; i < 4; i++) client = validerVisite(client, commerce)
    assert.equal(client.tampons, 4)
    assert.equal(tamponsAffiches(client, commerce), 2)
    assert.equal(client.visites.length, 4)
  })

  test('non-régression : 11 visites, seuil 10 → le 11e tampon est reporté sur la nouvelle carte', () => {
    const commerce = commerceTest(10)
    let client = nouveauClient(commerce.id, 'Mehdi', { telephone: '06 12 34 56 78' })
    for (let i = 0; i < 11; i++) client = validerVisite(client, commerce)
    assert.equal(client.tampons, 11)
    assert.equal(tamponsAffiches(client, commerce), 10)
    assert.equal(recompenseDebloquee(client, commerce), true)
    client = offrirRecompense(client, commerce, MAINTENANT)
    assert.equal(client.tampons, 1)
    assert.equal(tamponsAffiches(client, commerce), 1)
    assert.equal(recompenseDebloquee(client, commerce), false)
    assert.equal(client.recompensesOffertes?.length, 1)
  })

  test('non-régression : 21 visites, seuil 10 → après 1 récompense, 11 tampons et récompense encore débloquée', () => {
    const commerce = commerceTest(10)
    let client = nouveauClient(commerce.id, 'Mehdi', { telephone: '06 12 34 56 78' })
    for (let i = 0; i < 21; i++) client = validerVisite(client, commerce)
    client = offrirRecompense(client, commerce, MAINTENANT)
    assert.equal(client.tampons, 11)
    assert.equal(recompenseDebloquee(client, commerce), true)
    client = offrirRecompense(client, commerce, MAINTENANT)
    assert.equal(client.tampons, 1)
    assert.equal(client.recompensesOffertes?.length, 2)
    // Invariant : tampons = visites − seuil × récompenses offertes.
    assert.equal(client.tampons, client.visites.length - 10 * client.recompensesOffertes!.length)
  })

  test('offrir la récompense à carte juste pleine la remet à zéro et garde la trace', () => {
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

  describe('non-régression : 1 participation = 1 visite validée le jour même', () => {
    const commerce = commerceTest()
    const inscrit = () => nouveauClient(commerce.id, 'Linh', { telephone: '06 12 34 56 78' }, new Date(2026, 10, 1, 10, 0))
    const tirage = (clientId: string, date: Date): Tirage => ({ id: 't', commerceId: commerce.id, clientId, lot: 'Thé offert', date: date.toISOString() })

    test('client sans aucune visite → ne peut pas jouer', () => {
      const client = inscrit()
      assert.equal(statutJeu(client, [], commerce.id, MAINTENANT), 'sansVisite')
      assert.equal(peutJouer(client, [], commerce.id, MAINTENANT), false)
    })

    test('visite validée aujourd’hui → peut jouer', () => {
      const client = validerVisite(inscrit(), commerce, new Date(2026, 10, 9, 9, 15))
      assert.equal(statutJeu(client, [], commerce.id, MAINTENANT), 'pret')
      assert.equal(peutJouer(client, [], commerce.id, MAINTENANT), true)
    })

    test('visite hier seulement → ne peut pas jouer aujourd’hui', () => {
      const client = validerVisite(inscrit(), commerce, new Date(2026, 10, 8, 23, 50))
      assert.equal(statutJeu(client, [], commerce.id, MAINTENANT), 'sansVisite')
      assert.equal(peutJouer(client, [], commerce.id, MAINTENANT), false)
    })

    test('déjà joué aujourd’hui → ne peut pas rejouer, même avec une 2e visite', () => {
      let client = validerVisite(inscrit(), commerce, new Date(2026, 10, 9, 9, 15))
      const tirages = [tirage(client.id, new Date(2026, 10, 9, 9, 20))]
      assert.equal(statutJeu(client, tirages, commerce.id, MAINTENANT), 'dejaJoue')
      client = validerVisite(client, commerce, new Date(2026, 10, 9, 11, 0))
      assert.equal(peutJouer(client, tirages, commerce.id, MAINTENANT), false)
    })

    test('une visite dans un autre commerce ne compte pas', () => {
      const client = validerVisite(inscrit(), commerce, new Date(2026, 10, 9, 9, 15))
      assert.equal(peutJouer(client, [], 'c-autre', MAINTENANT), false)
    })

    test('vérifier le droit de jouer ne crée jamais de visite', () => {
      const client = inscrit()
      statutJeu(client, [], commerce.id, MAINTENANT)
      assert.deepEqual(client.visites, [])
      assert.equal(client.tampons, 0)
    })
  })
})

describe('Clients actifs / à relancer', () => {
  const JOUR = 24 * 60 * 60 * 1000
  const commerce = commerceTest()
  const t = MAINTENANT.getTime()

  test('non-régression : nouveau client sans visite → ni actif, ni à relancer, pas compté dans les actifs', () => {
    const client = nouveauClient(commerce.id, 'Linh', { telephone: '06 12 34 56 78' }, MAINTENANT)
    assert.equal(client.derniereVisite, null)
    assert.equal(estActif(client, t), false)
    assert.equal(estARelancer(client, t), false)
    // Même inscrit il y a 3 mois sans jamais venir : toujours pas à relancer.
    const ancien = nouveauClient(commerce.id, 'Linh', { telephone: '06 12 34 56 78' }, new Date(t - 90 * JOUR))
    assert.equal(estARelancer(ancien, t), false)
    assert.equal(calculerChiffres([client, ancien], [], MAINTENANT).clientsActifs, 0)
  })

  test('après 1 visite → actif', () => {
    const client = validerVisite(nouveauClient(commerce.id, 'Linh', { telephone: '06 12 34 56 78' }), commerce, MAINTENANT)
    assert.equal(estActif(client, t), true)
    assert.equal(estARelancer(client, t), false)
    assert.equal(calculerChiffres([client], [], MAINTENANT).clientsActifs, 1)
  })

  test('« venus ces 30 derniers jours » : 30 j pile → actif ; 30 j + 1 h ou 31 j → inactif et à relancer', () => {
    const venuIlYa = (ms: number) => validerVisite(nouveauClient(commerce.id, 'Linh', { telephone: '06 12 34 56 78' }), commerce, new Date(t - ms))
    assert.equal(estActif(venuIlYa(30 * JOUR), t), true)
    for (const ms of [30 * JOUR + 60 * 60 * 1000, 31 * JOUR]) {
      const client = venuIlYa(ms)
      assert.equal(estActif(client, t), false)
      assert.equal(estARelancer(client, t), true)
    }
  })

  test('migration des anciennes données : derniereVisite = inscription sans visite → null', () => {
    const ancien = { ...nouveauClient(commerce.id, 'Linh', { telephone: '06 12 34 56 78' }, MAINTENANT), derniereVisite: MAINTENANT.toISOString() }
    const venu = validerVisite(nouveauClient(commerce.id, 'Karim', { email: 'k@exemple.fr' }), commerce, MAINTENANT)
    const etat = migrer({ commerces: [commerce], clients: [ancien, venu], tirages: [], avis: [], commerceActifId: commerce.id })
    assert.equal(etat.clients[0].derniereVisite, null)
    assert.equal(etat.clients[1], venu, 'client avec visites inchangé')
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

  test('non-régression : avis 5★ avec brouillon humain + auto5 activé → brouillon conservé, aucune réponse auto', () => {
    assert.equal(commerce.reglesReponseAuto.auto5Etoiles, true)
    const brouillonHumain = avis(5, 'Super soirée', { brouillon: 'Merci Sophie, à samedi pour le karaoké !' })
    const resultat = appliquerRegles(brouillonHumain, commerce)
    assert.equal(resultat, brouillonHumain)
    assert.equal(resultat.brouillon, 'Merci Sophie, à samedi pour le karaoké !')
    assert.equal(resultat.reponse, undefined)
    assert.equal(resultat.reponseAuto, undefined)
    // Même chose avec auto4 activé sur un 4★ (réapplication au réenregistrement des réglages).
    const avecAuto4 = { ...commerce, reglesReponseAuto: { ...commerce.reglesReponseAuto, auto4Etoiles: true } }
    const quatre = avis(4, 'Bien', { brouillon: 'Brouillon de l’équipe' })
    assert.equal(appliquerRegles(quatre, avecAuto4), quatre)
  })

  test('non-régression : le modèle d’avis négatif n’affirme aucun envoi', () => {
    const t = texteModele('negatif', avis(1, 'Décevant'), commerce)
    assert.doesNotMatch(t, /transmis/i)
    assert.doesNotMatch(t, /envoy/i)
    assert.match(t, /en parler en équipe/)
  })
})

describe('Lien Google d’Asian Home Paris', () => {
  test('lien direct « laisser un avis » ; les anciennes données Maps sont migrées', () => {
    const lien = 'https://search.google.com/local/writereview?placeid=ChIJAV70Kqxt5kcRnhPY0L6yaf0'
    const etat = seedRecale()
    assert.equal(etat.commerces[0].nom, 'Asian Home Paris')
    assert.equal(etat.commerces[0].lienGoogle, lien)
    const ancien = { ...etat, commerces: [{ ...etat.commerces[0], lienGoogle: 'https://www.google.com/maps/search/?api=1&query=Asian+Home+Paris+11+rue+Andr%C3%A9+Joineau+Le+Pr%C3%A9-Saint-Gervais' }] }
    assert.equal(migrer(ancien).commerces[0].lienGoogle, lien)
    // Un lien saisi par le commerçant n’est jamais touché.
    const perso = { ...etat, commerces: [{ ...etat.commerces[0], lienGoogle: 'https://g.page/r/x/review' }] }
    assert.equal(migrer(perso).commerces[0].lienGoogle, 'https://g.page/r/x/review')
  })
})

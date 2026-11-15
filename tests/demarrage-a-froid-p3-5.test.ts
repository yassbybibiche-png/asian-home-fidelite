// P3-5 — Démarrages à froid Render : mesure côté navigateur (tranches 10–30 s / 30 s+), balise anonyme,
// compteurs serveur, section tableau de bord, migration 0011 (Postgres : tests/migration-pglite.test.ts).
// Protocole de mesure corrigé le 15/11/2026 (audit expert : l’ancienne mesure plafonnait à ~10 s, la
// tranche 30 s+ n’était atteignable que par le temps d’import du module, et la balise partait avec un
// abandon à 5 s vers un serveur encore endormi, garde marquée avant l’envoi, sans renvoi) : épisodes de
// réveil (premier essai sans réponse → première réponse), durée propre figée avant l’import différé, file
// persistée, livraison keepalive, garde après livraison confirmée, sendBeacon à la fermeture de la page.
// Rappel : ce cycle instrumente seulement — aucune décision (plan payant ou statu quo) n'est prise ici,
// elle attend 2 semaines de données réelles (docs/VEILLE-RENDER.md).
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AddressInfo } from 'node:net'

import { creerServeur, type OptionsServeur } from '../server/app.ts'
import { creerClientApi } from '../src/data/api.ts'
import {
  cheminMesurable,
  creerFileBalises,
  creerGardeFroid,
  creerSuiviReveil,
  definirDependancesFroid,
  DELAI_MIN_ENTRE_SIGNAUX_MS,
  evenementFroid,
  extraireCommerceId,
  noterAppelLent,
  SEUIL_FROID_LONG_MS,
  SEUIL_FROID_MS,
  trancheFroid,
  TYPES_FROID,
  livrerBalises,
  viderEnUrgence,
  type BaliseFroid,
  type DependancesFroid,
  type StockageBalises,
} from '../src/lib/demarrageAFroid.ts'
import { entonnoir, EVENEMENTS_PUBLICS, totaux, TYPES_EVENEMENT, type DonneesMesure } from '../src/lib/mesure.ts'

const RACINE = join(import.meta.dirname, '..')
const source = (f: string) => readFileSync(join(RACINE, f), 'utf8')

// ---------- Logique pure : seuils, tranches, attribution, garde ----------

describe('Démarrage à froid : seuils et tranches', () => {
  test('moins de 10 s : rien ; 10–30 s : froid10a30s ; 30 s ou plus : froidPlus30s', () => {
    assert.equal(SEUIL_FROID_MS, 10_000)
    assert.equal(SEUIL_FROID_LONG_MS, 30_000)
    assert.deepEqual(TYPES_FROID, ['froid10a30s', 'froidPlus30s'])
    assert.equal(trancheFroid(0), null)
    assert.equal(trancheFroid(9_999), null)
    assert.equal(trancheFroid(10_000), 'froid10a30s')
    assert.equal(trancheFroid(29_999), 'froid10a30s')
    assert.equal(trancheFroid(30_000), 'froidPlus30s')
    assert.equal(trancheFroid(120_000), 'froidPlus30s')
    assert.equal(trancheFroid(Number.NaN), null, 'durée non mesurée : ignorée')
    assert.equal(trancheFroid(Number.POSITIVE_INFINITY), null, 'durée non finie : ignorée')
  })

  test('attribution : seul un chemin /commerces/<id>/… porte un commerce ; la balise elle-même exclue', () => {
    assert.equal(extraireCommerceId('/commerces/c-asian-home-paris'), 'c-asian-home-paris', 'fiche publique : chemin sans segment après l’id')
    assert.equal(extraireCommerceId('/commerces/c-asian-home-paris/'), 'c-asian-home-paris')
    assert.equal(extraireCommerceId('/commerces/c-asian-home-paris/tirages'), 'c-asian-home-paris')
    assert.equal(extraireCommerceId('/commerces/c%2Dasian/tirages'), 'c-asian')
    assert.equal(extraireCommerceId('/cartes/k-1'), null)
    assert.equal(extraireCommerceId('/sante'), null)
    assert.equal(extraireCommerceId('/commerces'), null)
    assert.equal(cheminMesurable('/commerces/c-asian-home-paris/'), true)
    assert.equal(cheminMesurable('/commerces/c-asian-home-paris/evenements'), false, 'la balise ne se mesure pas elle-même')
    assert.equal(cheminMesurable('/cartes/k-1'), false, 'ouverture directe de carte : non comptée (limite documentée)')
    assert.equal(evenementFroid('/commerces/c-asian-home-paris/', 12_000), 'froid10a30s')
    assert.equal(evenementFroid('/commerces/c-asian-home-paris/', 45_000), 'froidPlus30s')
    assert.equal(evenementFroid('/commerces/c-asian-home-paris/', 500), null)
    assert.equal(evenementFroid('/sante', 45_000), null)
  })

  test('suivi de réveil : le début le plus ancien gagne ; fermer rend la durée totale, une seule fois', () => {
    const suivi = creerSuiviReveil()
    assert.equal(suivi.fermer('c1', 50_000), null, 'aucun épisode ouvert : rien à fermer')
    suivi.ouvrir('c1', 10_000)
    suivi.ouvrir('c1', 13_000)
    assert.equal(suivi.fermer('c1', 52_000), 42_000, 'du premier essai (10 s) à la première réponse (52 s)')
    assert.equal(suivi.fermer('c1', 60_000), null, 'épisode fermé : pas de deuxième mesure')
    suivi.ouvrir('c1', 20_000)
    suivi.ouvrir('c1', 18_000)
    assert.equal(suivi.fermer('c1', 48_000), 30_000, 'un début plus ancien reçu après coup remplace')
    assert.deepEqual(suivi.ouverts(), [])
  })

  test('épisode complet : échecs puis première réponse à 42 s → une balise froidPlus30s, garde marquée après livraison', async () => {
    let t = 1_000_000
    const { deps, stockage } = depsDeTest(() => t)
    const envois: { url: string; init: RequestInit }[] = []
    const envoyer = (async (url: string | URL | Request, init?: RequestInit) => {
      envois.push({ url: String(url), init: init ?? {} })
      return new Response('{}', { status: 202 })
    }) as typeof fetch
    // Premier appel : délai client expiré (10 s), aucune réponse — le serveur dort.
    noterAppelLent('/commerces/c1/', t, 10_000, false, false, 'http://x/api/v1', envoyer, deps)
    await attendreLivraison()
    assert.equal(envois.length, 0, 'serveur injoignable : rien n’est envoyé, l’épisode s’ouvre')
    // Réessai 3 s plus tard (tenterPendant) : toujours aucune réponse, l’épisode garde son début.
    noterAppelLent('/commerces/c1/', t + 3_000, 10_000, false, false, 'http://x/api/v1', envoyer, deps)
    await attendreLivraison()
    assert.equal(envois.length, 0)
    // Première réponse à 42 s du premier essai : l’épisode se ferme et la balise part avec la durée totale.
    t += 42_000
    noterAppelLent('/commerces/c1/', t - 2_000, 2_000, true, false, 'http://x/api/v1', envoyer, deps)
    await attendreLivraison()
    assert.equal(envois.length, 1)
    assert.equal(envois[0].url, 'http://x/api/v1/commerces/c1/evenements')
    assert.equal(envois[0].init.method, 'POST')
    assert.equal(envois[0].init.body, JSON.stringify({ type: 'froidPlus30s' }), 'durée de l’épisode entier (42 s), pas celle du dernier appel (2 s)')
    assert.equal(envois[0].init.keepalive, true, 'livraison keepalive')
    assert.equal(envois[0].init.signal, undefined, 'aucun abandon artificiel à 5 s')
    assert.deepEqual(stockage.donnees(), [], 'balise livrée : file vide')
    assert.equal(deps.garde.peutSignaler(), false, 'garde marquée — après la livraison confirmée')
    // Un deuxième réveil dans le même quart d’heure ne compte pas.
    noterAppelLent('/commerces/c1/', t, 45_000, true, false, 'http://x/api/v1', envoyer, deps)
    await attendreLivraison()
    assert.equal(envois.length, 1)
  })

  test('succès lent direct (sans épisode) : balise de sa durée propre ; échec puis succès rapide : rien', async () => {
    let t = 5_000_000
    const { deps } = depsDeTest(() => t)
    const envois: string[] = []
    const envoyer = (async (url: string | URL | Request, init?: RequestInit) => {
      envois.push(String(init?.body ?? ''))
      return new Response('{}', { status: 202 })
    }) as typeof fetch
    // Panne réseau rapide puis réponse rapide : l’épisode entier reste sous le seuil.
    noterAppelLent('/commerces/c1/', t, 2_000, false, false, 'http://x/api/v1', envoyer, deps)
    noterAppelLent('/commerces/c1/', t + 3_000, 500, true, false, 'http://x/api/v1', envoyer, deps)
    await attendreLivraison()
    assert.equal(envois.length, 0, 'attente totale de 3,5 s : pas un démarrage à froid')
    // Appel lent mais réussi du premier coup (délai propre 12 s) : signalé sans épisode.
    t += DELAI_MIN_ENTRE_SIGNAUX_MS
    noterAppelLent('/commerces/c1/', t, 12_000, true, false, 'http://x/api/v1', envoyer, deps)
    await attendreLivraison()
    assert.deepEqual(envois, [JSON.stringify({ type: 'froid10a30s' })])
  })

  test('garde : au plus un signalement par quart d’heure (horloge injectée)', () => {
    assert.equal(DELAI_MIN_ENTRE_SIGNAUX_MS, 15 * 60_000)
    let t = 1_000_000
    const garde = creerGardeFroid(() => t)
    assert.equal(garde.peutSignaler(), true)
    garde.marquer()
    assert.equal(garde.peutSignaler(), false, 'les réessais du même réveil ne comptent qu’une fois')
    t += DELAI_MIN_ENTRE_SIGNAUX_MS - 1
    assert.equal(garde.peutSignaler(), false)
    t += 1
    assert.equal(garde.peutSignaler(), true, 'un réveil plus tard, un nouvel événement est compté')
  })

  test('livraison différée : envoi en échec → balise en file, garde NON marquée ; renvoi au prochain appel réussi', async () => {
    let t = 2_000_000
    const { deps, stockage } = depsDeTest(() => t)
    let joignable = false
    const envois: string[] = []
    const envoyer = (async (_url: string | URL | Request, init?: RequestInit) => {
      if (!joignable) throw new Error('serveur encore endormi')
      envois.push(String(init?.body ?? ''))
      return new Response('{}', { status: 202 })
    }) as typeof fetch
    // Appel lent réussi, mais la balise ne part pas (le serveur retombe / le réseau coupe) :
    noterAppelLent('/commerces/c1/', t, 12_000, true, false, 'http://x/api/v1', envoyer, deps)
    await attendreLivraison()
    assert.equal(envois.length, 0)
    assert.equal(stockage.donnees().length, 1, 'la balise attend dans la file persistée')
    assert.equal(stockage.donnees()[0].tranche, 'froid10a30s')
    assert.equal(deps.garde.peutSignaler(), true, 'garde non marquée : la livraison n’a pas été confirmée')
    // Un deuxième réveil pendant que la première balise attend : pas de doublon en file.
    noterAppelLent('/commerces/c1/', t, 20_000, true, false, 'http://x/api/v1', envoyer, deps)
    await attendreLivraison()
    assert.equal(stockage.donnees().length, 1, 'une balise en attente vaut signalement du réveil en cours')
    // Le prochain appel réussi (même rapide, même un autre chemin public) déclenche le renvoi.
    joignable = true
    noterAppelLent('/sante', t, 300, true, false, 'http://x/api/v1', envoyer, deps)
    await attendreLivraison()
    assert.deepEqual(envois, [JSON.stringify({ type: 'froid10a30s' })], 'balise renvoyée et livrée')
    assert.deepEqual(stockage.donnees(), [], 'file vidée après livraison')
    assert.equal(deps.garde.peutSignaler(), false, 'garde marquée seulement maintenant')
  })

  test('refus du serveur (migration 0011 absente) : la balise reste en file, la garde n’est pas marquée', async () => {
    const t = 3_000_000
    const { deps, stockage } = depsDeTest(() => t)
    const envoyer = (async () => new Response(JSON.stringify({ erreur: 'type refusé' }), { status: 400 })) as typeof fetch
    noterAppelLent('/commerces/c1/', t, 45_000, true, false, 'http://x/api/v1', envoyer, deps)
    await attendreLivraison()
    assert.equal(stockage.donnees().length, 1, 'réponse non ok = pas livrée')
    assert.equal(deps.garde.peutSignaler(), true)
  })

  test('livraison en vol : ni une deuxième livraison ni la fermeture de page ne renvoient la balise (pas de double comptage)', async () => {
    const t = 8_000_000
    const { deps, stockage } = depsDeTest(() => t)
    deps.file.ajouter({ commerceId: 'c1', tranche: 'froid10a30s' })
    const balise = deps.file.enAttente()[0]
    let resoudre!: (r: Response) => void
    let envois = 0
    const envoyer = (async () => {
      envois++
      return new Promise<Response>((ok) => (resoudre = ok))
    }) as typeof fetch
    const livraison = livrerBalises('http://x/api/v1', envoyer, deps.file, deps.garde)
    assert.equal(envois, 1, 'première livraison en vol')
    assert.equal(await livrerBalises('http://x/api/v1', envoyer, deps.file, deps.garde), 0, 'deuxième livraison simultanée : la balise en vol est sautée')
    assert.equal(envois, 1)
    const beacons: string[] = []
    viderEnUrgence('http://x/api/v1', (url) => (beacons.push(url), true), deps.file, deps.suivi, deps.garde, t)
    assert.equal(beacons.length, 0, 'fermeture de page pendant l’envoi : pas de beacon en double')
    assert.equal(stockage.donnees().length, 1, 'toujours en file tant que la livraison n’est pas confirmée')
    resoudre(new Response('{}', { status: 202 }))
    assert.equal(await livraison, 1, 'la livraison d’origine aboutit')
    assert.deepEqual(stockage.donnees(), [], 'retirée une fois livrée')
    assert.equal(deps.file.estEnCours(balise), false)
  })

  test('file persistée : une nouvelle instance sur le même stockage retrouve les balises (rechargement)', () => {
    let t = 4_000_000
    const stockage = fauxStockage()
    const file1 = creerFileBalises(stockage, () => t)
    assert.equal(file1.ajouter({ commerceId: 'c1', tranche: 'froidPlus30s' }), true)
    const file2 = creerFileBalises(stockage, () => t)
    assert.equal(file2.enAttente().length, 1, 'la balise survit au rechargement de la page')
    assert.equal(file2.ajouter({ commerceId: 'c1', tranche: 'froid10a30s' }), false, 'doublon récent, même après rechargement')
    t += DELAI_MIN_ENTRE_SIGNAUX_MS
    assert.equal(file2.ajouter({ commerceId: 'c1', tranche: 'froid10a30s' }), true, 'un quart d’heure plus tard : nouveau dépôt possible')
    assert.equal(file2.enAttente().length, 2)
  })

  test('fermeture de page : sendBeacon signale l’épisode encore ouvert et rejoue la file ; refusé = rien ne change', async () => {
    let t = 6_000_000
    const { deps, stockage } = depsDeTest(() => t)
    // Épisode ouvert (appel sans réponse), jamais fermé : le client repart.
    noterAppelLent('/commerces/c1/', t, 10_000, false, false, 'http://x/api/v1', (async () => new Response('{}')) as typeof fetch, deps)
    // Et une balise plus ancienne encore en file (livraison jamais confirmée).
    deps.file.ajouter({ commerceId: 'c2', tranche: 'froid10a30s' })
    t += 45_000
    const beacons: { url: string; corps: string }[] = []
    viderEnUrgence('http://x/api/v1', (url, corps) => (beacons.push({ url, corps }), true), deps.file, deps.suivi, deps.garde, t)
    assert.deepEqual(beacons, [
      { url: 'http://x/api/v1/commerces/c1/evenements', corps: JSON.stringify({ type: 'froidPlus30s' }) },
      { url: 'http://x/api/v1/commerces/c2/evenements', corps: JSON.stringify({ type: 'froid10a30s' }) },
    ])
    assert.deepEqual(deps.suivi.ouverts(), [], 'épisode signalé : fermé')
    assert.deepEqual(stockage.donnees(), [], 'file rejouée : vidée')
    // Beacon refusé par le navigateur : l’épisode reste ouvert, la balise reste en file.
    const { deps: deps2, stockage: stockage2 } = depsDeTest(() => t)
    deps2.suivi.ouvrir('c1', t)
    deps2.file.ajouter({ commerceId: 'c1', tranche: 'froid10a30s' })
    viderEnUrgence('http://x/api/v1', () => false, deps2.file, deps2.suivi, deps2.garde, t + 45_000)
    assert.equal(deps2.suivi.ouverts().length, 1)
    assert.equal(stockage2.donnees().length, 1)
  })

  test('noterAppelLent : rien pour un appel rapide, marchand, sans commerce ou la balise elle-même', async () => {
    const t = 7_000_000
    const envois: string[] = []
    const envoyer = (async (url: string | URL | Request) => {
      envois.push(String(url))
      return new Response('{}', { status: 202 })
    }) as typeof fetch
    const fraiches = () => depsDeTest(() => t).deps
    noterAppelLent('/commerces/c1/', t, 500, true, false, 'http://x/api/v1', envoyer, fraiches())
    noterAppelLent('/commerces/c1/', t, 45_000, true, true, 'http://x/api/v1', envoyer, fraiches())
    noterAppelLent('/sante', t, 45_000, true, false, 'http://x/api/v1', envoyer, fraiches())
    noterAppelLent('/commerces/c1/evenements', t, 45_000, true, false, 'http://x/api/v1', envoyer, fraiches())
    noterAppelLent('/cartes/k-1', t, 45_000, false, false, 'http://x/api/v1', envoyer, fraiches())
    await attendreLivraison()
    assert.equal(envois.length, 0, 'appel rapide, marchand, sans commerce ou balise : rien, pas même un épisode')
  })
})

/** Stockage en mémoire pour les tests de file (même contrat que le stockage navigateur). */
function fauxStockage(): StockageBalises & { donnees: () => BaliseFroid[] } {
  let donnees: BaliseFroid[] = []
  return {
    lire: () => [...donnees],
    ecrire: (b) => {
      donnees = [...b]
    },
    donnees: () => [...donnees],
  }
}

/** Dépendances neuves et isolées pour un test (garde et file sur l’horloge fournie). */
function depsDeTest(t: () => number): { deps: DependancesFroid; stockage: ReturnType<typeof fauxStockage> } {
  const stockage = fauxStockage()
  return {
    deps: { garde: creerGardeFroid(t), suivi: creerSuiviReveil(), file: creerFileBalises(stockage, t) },
    stockage,
  }
}

/** Laisse la livraison asynchrone (jamais attendue par l’appelant) se terminer. */
async function attendreLivraison(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
}

// ---------- Types : les tranches froid sont des événements anonymes comme les autres ----------

describe('Types d’événements : tranches froid intégrées, entonnoir inchangé', () => {
  test('TYPES_EVENEMENT et EVENEMENTS_PUBLICS contiennent les deux tranches ; tirage/gain restent serveur', () => {
    assert.deepEqual(TYPES_EVENEMENT, ['scan', 'tirage', 'gain', 'clicGoogle', 'froid10a30s', 'froidPlus30s'])
    assert.deepEqual(EVENEMENTS_PUBLICS, ['scan', 'clicGoogle', 'froid10a30s', 'froidPlus30s'])
  })

  test('totaux() additionne les tranches froid ; l’entonnoir reste à 4 étapes (pas une étape de funnel)', () => {
    const d: DonneesMesure = {
      clients: [],
      tirages: [],
      lots: [],
      compteurs: [
        { jour: '2026-11-10', type: 'scan', n: 20 },
        { jour: '2026-11-10', type: 'froid10a30s', n: 3 },
        { jour: '2026-11-10', type: 'froidPlus30s', n: 1 },
        { jour: '2026-11-09', type: 'froid10a30s', n: 5 },
      ],
    }
    const t = totaux(d, '2026-11-10', '2026-11-10')
    assert.equal(t.evenements.froid10a30s, 3)
    assert.equal(t.evenements.froidPlus30s, 1)
    assert.equal(t.evenements.scan, 20)
    assert.equal(entonnoir(t).length, 4)
    assert.deepEqual(
      entonnoir(t).map((e) => e.cle),
      ['scan', 'tirage', 'gain', 'clicGoogle'],
    )
  })
})

// ---------- Client API : le premier appel lent déclenche la balise, sans jamais bloquer ----------

describe('Client API : mesure du premier appel lent', () => {
  const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const dormir = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))

  test('appel lent (10,2 s) sur un commerce → balise froid10a30s, appel d’origine inchangé', async () => {
    definirDependancesFroid(depsDeTest(() => Date.now()).deps)
    const appels: { methode: string; url: string; corps: unknown }[] = []
    const fauxFetch: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const corps = init?.body ? JSON.parse(String(init.body)) : undefined
      appels.push({ methode: init?.method ?? 'GET', url: String(url), corps })
      if (String(url).endsWith('/evenements')) return json({ ok: true, compte: true })
      await dormir(10_200)
      return json({ commerce: { id: 'c1' } })
    }) as typeof fetch
    // Délai client 15 s : l’appel lent aboutit (pas d’abandon à 10 s), la balise part ensuite.
    const api = creerClientApi('http://x/api/v1', fauxFetch, 15_000)
    const commerce = await api.commerce('c1')
    assert.deepEqual(commerce, { id: 'c1' })
    for (let i = 0; i < 20 && !appels.some((a) => String(a.url).endsWith('/evenements')); i++) await dormir(100)
    assert.deepEqual(
      appels.filter((a) => String(a.url).endsWith('/evenements')),
      [{ methode: 'POST', url: 'http://x/api/v1/commerces/c1/evenements', corps: { type: 'froid10a30s' } }],
    )
  })

  test('premier appel abandonné (serveur endormi) puis réessai réussi → balise de l’épisode entier, rien avant la première réponse', async () => {
    definirDependancesFroid(depsDeTest(() => Date.now()).deps)
    const appels: { url: string; corps: unknown }[] = []
    let premier = true
    const fauxFetch: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const corps = init?.body ? JSON.parse(String(init.body)) : undefined
      appels.push({ url: String(url), corps })
      if (String(url).endsWith('/evenements')) return json({ ok: true, compte: true })
      if (premier) {
        premier = false
        await dormir(10_200)
        throw new Error('délai dépassé : le client abandonne, le serveur dort encore')
      }
      return json({ commerce: { id: 'c1' } })
    }) as typeof fetch
    const api = creerClientApi('http://x/api/v1', fauxFetch, 15_000)
    await assert.rejects(api.commerce('c1'), 'premier appel sans réponse : erreur réseau pour l’appelant')
    await dormir(300)
    assert.equal(appels.filter((a) => a.url.endsWith('/evenements')).length, 0, 'aucune balise tant qu’aucune réponse n’est arrivée')
    const commerce = await api.commerce('c1')
    assert.deepEqual(commerce, { id: 'c1' })
    for (let i = 0; i < 20 && !appels.some((a) => a.url.endsWith('/evenements')); i++) await dormir(100)
    assert.deepEqual(
      appels.filter((a) => a.url.endsWith('/evenements')),
      [{ url: 'http://x/api/v1/commerces/c1/evenements', corps: { type: 'froid10a30s' } }],
      'à la première réponse, la balise part avec la durée de l’épisode (≈10,5 s), pas avec un délai d’import',
    )
  })

  test('appel rapide, appel marchand et /sante lent : aucune balise', async () => {
    const appels: string[] = []
    const fauxFetch: typeof fetch = (async (url: string | URL | Request) => {
      appels.push(String(url))
      if (String(url).endsWith('/sante')) await dormir(10_200)
      return json({ ok: true, commerce: { id: 'c1' } })
    }) as typeof fetch
    const api = creerClientApi('http://x/api/v1', fauxFetch, 15_000)
    await api.commerce('c1')
    assert.equal(appels.filter((u) => u.endsWith('/evenements')).length, 0, 'appel rapide : rien à signaler')
    await api.sante()
    assert.equal(appels.filter((u) => u.endsWith('/evenements')).length, 0, '/sante lent : pas de commerce, pas de balise')
    const acces = { role: 'commerce', commerceId: 'c1', pin: '1234' } as const
    await api.mesures('c1', acces)
    assert.equal(appels.filter((u) => u.endsWith('/evenements')).length, 0, 'appel marchand lent : pas un client')
  })
})

// ---------- Serveur (SQLite) : balises acceptées, comptées, sans identité ----------

const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-froid-'))
after(() => rmSync(dossier, { recursive: true, force: true }))
const horloge = new Date('2026-11-10T11:00:00Z')

async function demarrer(fichierDb: string, options: Partial<OptionsServeur> = {}) {
  const app = await creerServeur({ fichierDb, adminPin: ADMIN, pinInitial: '1234', version: 'test', maintenant: () => horloge, ...options })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, { method: methode, headers: { 'Content-Type': 'application/json', ...entetes }, body: corps === undefined ? undefined : JSON.stringify(corps) })
    return { statut: r.status, contenu: await r.json() }
  }
  return { app, api }
}

describe('Serveur : balises de démarrage à froid', () => {
  test('POST /evenements accepte froid10a30s / froidPlus30s, les compte par jour ; tirage/gain toujours réservés', async () => {
    const fichier = join(dossier, 'froid.db')
    const { app, api } = await demarrer(fichier)
    try {
      assert.deepEqual((await api('POST', `/commerces/${AH}/evenements`, { type: 'froid10a30s' })).contenu, { ok: true, compte: true })
      assert.equal((await api('POST', `/commerces/${AH}/evenements`, { type: 'froidPlus30s' })).statut, 202)
      assert.equal((await api('POST', `/commerces/${AH}/evenements`, { type: 'froid10a30s' })).statut, 202)
      for (const type of ['tirage', 'gain', 'autre', undefined]) assert.equal((await api('POST', `/commerces/${AH}/evenements`, { type })).statut, 400, String(type))
      const m = await api('GET', `/commerces/${AH}/mesures`, undefined, PIN)
      assert.deepEqual(m.contenu.compteurs, [
        { jour: '2026-11-10', type: 'froid10a30s', n: 2 },
        { jour: '2026-11-10', type: 'froidPlus30s', n: 1 },
      ])
    } finally {
      await app.fermer()
    }
    const db = new DatabaseSync(fichier)
    try {
      assert.deepEqual(db.prepare('SELECT commerce_id, jour, type, n FROM evenements_jour ORDER BY type').all().map((l) => ({ ...l })), [
        { commerce_id: AH, jour: '2026-11-10', type: 'froid10a30s', n: 2 },
        { commerce_id: AH, jour: '2026-11-10', type: 'froidPlus30s', n: 1 },
      ])
    } finally {
      db.close()
    }
  })

  test('commerce en pause : balise acceptée mais non comptée (comme scan)', async () => {
    const { app, api } = await demarrer(join(dossier, 'pause.db'))
    try {
      assert.equal((await api('PATCH', `/commerces/${AH}`, { actif: false }, PIN)).statut, 200)
      assert.deepEqual((await api('POST', `/commerces/${AH}/evenements`, { type: 'froidPlus30s' })).contenu, { ok: true, compte: false })
    } finally {
      await app.fermer()
    }
  })
})

// ---------- Sources : branchement, tableau de bord, migration, protocole ----------

describe('Sources : branchement, affichage, migration 0011, protocole', () => {
  test('api.ts mesure chaque appel (durée propre calculée avant l’import différé) et signale en arrière-plan, jamais bloquant', () => {
    const api = source('src/data/api.ts')
    // Un seul point d'appel, dans le `finally` (réponse reçue ou abandon) : la librairie est chargée à la
    // demande, hors bundle initial (plafond).
    assert.match(api, /finally \{[\s\S]{0,900}?import\('\.\.\/lib\/demarrageAFroid\.ts'\)/)
    assert.match(api, /const delaiAppel = Date\.now\(\) - debutAppel/, 'durée propre calculée dans le finally')
    assert.ok(api.indexOf('const delaiAppel') < api.indexOf("import('../lib/demarrageAFroid.ts')"), 'la durée est figée AVANT le chargement du module : il ne la fausse plus')
    assert.match(api, /noterAppelLent\(chemin, debutAppel, delaiAppel, reponseRecue, !!options\.acces, base, f\)/)
    assert.equal(api.split('noterAppelLent').length - 1, 1, 'un seul appel à la mesure, dans le finally')
    assert.doesNotMatch(api, /await import\('\.\.\/lib\/demarrageAFroid\.ts'\)/, 'la balise n’est jamais attendue')
    assert.match(api, /type: 'scan' \| 'clicGoogle' \| 'froid10a30s' \| 'froidPlus30s'/)
    const module = source('src/lib/demarrageAFroid.ts')
    assert.match(module, /if \(acces\) return/, 'appels marchands exclus dans la librairie')
    assert.match(module, /`\$\{base\}\/commerces\/\$\{encodeURIComponent\(commerceId\)\}\/evenements`/)
    // Protocole corrigé (audit expert du 15/11/2026) : file persistée, livraison keepalive sans abandon
    // artificiel, garde marquée après livraison, envoi d’urgence à la fermeture de la page.
    assert.match(module, /localStorage/, 'file des balises persistée')
    assert.match(module, /keepalive: true/, 'livraison keepalive')
    assert.doesNotMatch(module, /signalDelai\(5_000\)/, 'plus d’abandon artificiel à 5 s de la balise')
    assert.match(module, /file\.retirer\(b\)\n    garde\.marquer\(\)/, 'garde marquée après le retrait de la balise livrée, jamais avant l’envoi')
    assert.match(module, /sendBeacon/, 'envoi d’urgence à la fermeture de la page')
  })

  test('tableau de bord : section « Démarrages à froid » avec les deux tranches, le total et la mention 0011', () => {
    const mesure = source('src/components/Mesure.tsx')
    assert.match(mesure, /Démarrages à froid/)
    assert.match(mesure, /courant\.evenements\.froid10a30s/)
    assert.match(mesure, /courant\.evenements\.froidPlus30s/)
    assert.match(mesure, /Premier appel lent de 10 à 30 s/)
    assert.match(mesure, /Premier appel lent de plus de 30 s/)
    assert.match(mesure, /Aucun démarrage à froid mesuré sur la période/)
    assert.match(mesure, /migration 0011/)
    assert.match(mesure, /docs\/VEILLE-RENDER\.md/)
  })

  test('migration 0011 : CHECK élargi aux 6 types, rejouable, dégradation documentée ; down de retour aux 4 types', () => {
    const up = source('supabase/migrations/0011_mesure_froid.sql')
    assert.match(up, /check \(type in \('scan', 'tirage', 'gain', 'clicGoogle', 'froid10a30s', 'froidPlus30s'\)\)/)
    assert.match(up, /drop constraint if exists evenements_jour_type_check/)
    assert.match(up, /Tant que cette migration n'est pas appliquée,[\s\S]{0,80}?le serveur fonctionne/i)
    assert.doesNotMatch(up, /drop\s+table|create table/i)
    const down = source('supabase/migrations/0011_mesure_froid.down.sql')
    assert.match(down, /check \(type in \('scan', 'tirage', 'gain', 'clicGoogle'\)\)/)
    const ligneCheck = down.split('\n').find((l) => l.includes('check (type in')) ?? ''
    assert.doesNotMatch(ligneCheck, /froid10a30s|froidPlus30s/, 'la contrainte restaurée ne contient plus les tranches')
  })

  test('scission accroche : la page de jeu importe le petit module, la mesure du tableau de bord reste hors bundle initial', () => {
    const jouer = source('src/pages/Jouer.tsx')
    assert.match(jouer, /import \{ accrocheJeu, jourParis \} from '\.\.\/lib\/accroche'/)
    assert.match(jouer, /const accroche = accrocheJeu\(commerce, jourParis\(new Date\(\)\)\)/, 'ligne d’appel inchangée')
    const accroche = source('src/lib/accroche.ts')
    assert.match(accroche, /export function jourParis/)
    assert.match(accroche, /export function accrocheJeu/)
    assert.match(accroche, /export function varianteDuJour/)
    const mesure = source('src/lib/mesure.ts')
    assert.doesNotMatch(mesure, /export function jourParis/, 'mesure.ts ne définit plus le jour (module accroche)')
    assert.doesNotMatch(mesure, /export function accrocheJeu/)
    assert.doesNotMatch(mesure, /export function varianteDuJour/)
    assert.doesNotMatch(mesure, /export const ACCROCHE_/)
    assert.match(
      mesure,
      /export \{ accrocheJeu, jourParis, lotAccroche, varianteDuJour, ACCROCHE_GENERIQUE, ACCROCHE_LOT, type Variante \} from '\.\/accroche\.ts'/,
      'ré-export pour compatibilité (tests, serveur, pages différées)',
    )
  })

  test('protocole : 2 semaines d’observation, décision en attente, aucun prix affirmé, limites nommées', () => {
    const doc = source('docs/VEILLE-RENDER.md')
    assert.match(doc, /2 semaines/)
    assert.match(doc, /Décision/)
    assert.match(doc, /En attente/)
    assert.match(doc, /pas de clients réels/)
    assert.match(doc, /ne sont \*\*pas comptées\*\*/)
    assert.doesNotMatch(doc, /Starter.*€|€.*Starter|7 ?\$|7 ?€/, 'aucun prix du plan Starter affirmé : à vérifier au moment de décider')
    assert.match(doc, /Rien n'est décidé par ce cycle/, 'aucune décision anticipée')
  })
})

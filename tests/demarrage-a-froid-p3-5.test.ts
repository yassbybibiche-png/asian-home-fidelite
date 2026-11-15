// P3-5 — Démarrages à froid Render : mesure côté navigateur (tranches 10–30 s / 30 s+), balise anonyme,
// compteurs serveur, section tableau de bord, migration 0011 (Postgres : tests/migration-pglite.test.ts).
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
  creerGardeFroid,
  DELAI_MIN_ENTRE_SIGNAUX_MS,
  evenementFroid,
  extraireCommerceId,
  noterAppelLent,
  SEUIL_FROID_LONG_MS,
  SEUIL_FROID_MS,
  signalerSiFroid,
  trancheFroid,
  TYPES_FROID,
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

  test('signalerSiFroid : un seul envoi par quart d’heure, jamais pour un appel rapide ou la balise', () => {
    let t = 2_000_000
    const garde = creerGardeFroid(() => t)
    const envois: [string, string][] = []
    const envoyer = (commerceId: string, tranche: string) => void envois.push([commerceId, tranche])
    signalerSiFroid('/commerces/c1/', 12_000, envoyer, garde)
    assert.deepEqual(envois, [['c1', 'froid10a30s']])
    signalerSiFroid('/commerces/c1/', 45_000, envoyer, garde)
    assert.equal(envois.length, 1, 'réessai du même réveil : pas de deuxième balise')
    signalerSiFroid('/commerces/c1/', 500, envoyer, creerGardeFroid(() => t))
    signalerSiFroid('/sante', 45_000, envoyer, creerGardeFroid(() => t))
    signalerSiFroid('/commerces/c1/evenements', 45_000, envoyer, creerGardeFroid(() => t))
    assert.equal(envois.length, 1, 'appel rapide, sans commerce ou balise : rien')
    t += DELAI_MIN_ENTRE_SIGNAUX_MS
    signalerSiFroid('/commerces/c1/', 45_000, envoyer, garde)
    assert.deepEqual(envois[1], ['c1', 'froidPlus30s'], 'un réveil plus tard : une nouvelle balise')
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

  test('noterAppelLent : balise POST avec l’URL, le corps et le délai ; rien sinon', () => {
    const envois: { url: string; init: RequestInit }[] = []
    const envoyer = ((url: string | URL | Request, init?: RequestInit) => {
      envois.push({ url: String(url), init: init ?? {} })
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as typeof fetch
    const delais: number[] = []
    const signalDelai = (ms: number) => {
      delais.push(ms)
      return undefined
    }
    const debut = Date.now() - 12_000
    const garde = creerGardeFroid(() => Date.now())
    noterAppelLent('/commerces/c1/', debut, false, 'http://x/api/v1', envoyer, signalDelai, garde)
    assert.equal(envois.length, 1)
    assert.equal(envois[0].url, 'http://x/api/v1/commerces/c1/evenements')
    assert.equal(envois[0].init.method, 'POST')
    assert.equal(envois[0].init.body, JSON.stringify({ type: 'froid10a30s' }))
    assert.deepEqual(delais, [5_000], 'balise limitée à 5 s')
    noterAppelLent('/commerces/c1/', Date.now() - 45_000, false, 'http://x/api/v1', envoyer, signalDelai, garde)
    assert.equal(envois.length, 1, 'réessai du même réveil : garde du module, pas de deuxième balise')
    noterAppelLent('/commerces/c1/', Date.now() - 500, false, 'http://x/api/v1', envoyer, signalDelai, creerGardeFroid())
    noterAppelLent('/commerces/c1/', Date.now() - 45_000, true, 'http://x/api/v1', envoyer, signalDelai, creerGardeFroid())
    noterAppelLent('/sante', Date.now() - 45_000, false, 'http://x/api/v1', envoyer, signalDelai, creerGardeFroid())
    noterAppelLent('/commerces/c1/evenements', Date.now() - 45_000, false, 'http://x/api/v1', envoyer, signalDelai, creerGardeFroid())
    assert.equal(envois.length, 1, 'appel rapide, marchand, sans commerce ou balise : rien')
  })
})

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
  test('api.ts mesure chaque appel lent (en-têtes reçues) et signale la tranche en arrière-plan, jamais bloquant', () => {
    const api = source('src/data/api.ts')
    // Un seul point d'appel, dans le `finally` (réponse reçue ou abandon) : la librairie est chargée à la
    // demande, hors bundle initial (plafond).
    assert.match(api, /finally \{[\s\S]{0,600}?import\('\.\.\/lib\/demarrageAFroid\.ts'\)/)
    assert.match(api, /noterAppelLent\(chemin, debutAppel, !!options\.acces, base, f, signalDelai\)/)
    assert.equal(api.split('noterAppelLent').length - 1, 1, 'un seul appel à la mesure, dans le finally')
    assert.doesNotMatch(api, /await import\('\.\.\/lib\/demarrageAFroid\.ts'\)/, 'la balise n’est jamais attendue')
    assert.match(api, /type: 'scan' \| 'clicGoogle' \| 'froid10a30s' \| 'froidPlus30s'/)
    const module = source('src/lib/demarrageAFroid.ts')
    assert.match(module, /if \(acces\) return/, 'appels marchands exclus dans la librairie')
    assert.match(module, /signalerSiFroid\(/, 'seuil, attribution et garde dans la librairie')
    assert.match(module, /`\$\{base\}\/commerces\/\$\{encodeURIComponent\(commerceId\)\}\/evenements`/)
    assert.match(module, /signal: signalDelai\(5_000\)/, 'balise limitée à 5 s')
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

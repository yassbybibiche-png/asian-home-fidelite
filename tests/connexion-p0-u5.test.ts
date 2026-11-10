// P0-U5 — Connexion à l'espace commerçant : robustesse + observabilité.
// Le bug du 09/11 (« ça bug dès que je me connecte ») n'a PAS été reproduit : ces tests couvrent les candidats de l'audit
// (serveur endormi confondu avec un PIN faux, attente sans fin, verrouillage muet sur 401, coffre illisible ignoré).
import { test, describe, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { creerClientApi, ErreurApi, signalDelai, type Acces, type Session } from '../src/data/api.ts'
import { creerCoffrePin, type RangementCle } from '../src/data/coffrePin.ts'
import {
  avecDelai,
  causeEchec,
  CLE_JOURNAL,
  DELAI_ACCES_MS,
  DELAI_COFFRE_MS,
  echecReessayable,
  ErreurCoffre,
  ErreurDelai,
  issueRechargement,
  journaliserEchec,
  ligneDiagnostic,
  lireCoffreBorne,
  lireJournal,
  masquerSecrets,
  MESSAGE_APPAREIL_HORS_LIGNE,
  MESSAGE_COFFRE_ILLISIBLE,
  MESSAGE_DELAI_DEPASSE,
  MESSAGE_PIN_CHANGE,
  MESSAGE_SERVEUR_INJOIGNABLE,
  MESSAGE_SESSION_EXPIREE,
  messageEchec,
  ouvrirAcces,
  PAUSE_REVEIL_MS,
  TAILLE_JOURNAL,
  tenterPendant,
} from '../src/lib/connexion.ts'
import type { Etat } from '../src/types.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')

/** Laisse s'exécuter les promesses en attente (setImmediate n'est pas simulé). */
const vider = async () => {
  for (let i = 0; i < 5; i++) await new Promise((ok) => setImmediate(ok))
}
async function avancer(t: TestContext, ms: number) {
  t.mock.timers.tick(ms)
  await vider()
}
function horlogeSimulee(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
}

class StockageMemoire {
  m = new Map<string, string>()
  getItem(k: string) {
    return this.m.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.m.set(k, v)
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
}

function rangementMemoire(): RangementCle & { cle: CryptoKey | null } {
  return {
    cle: null,
    async lire() {
      return this.cle
    },
    async ecrire(c) {
      this.cle = c
    },
    async effacer() {
      this.cle = null
    },
  }
}

const reponseJson = (statut: number, corps: unknown) => new Response(JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/json' } })
const etatVide = (): Etat => ({ commerces: [], clients: [], tirages: [], avis: [], commerceActifId: '' })

// ---------------------------------------------------------------------------------------------

describe('P0-U5 : hors ligne / serveur injoignable ≠ PIN faux', () => {
  test('client API réel : réseau coupé et 502 (Render endormi) → message « serveur injoignable », 401 → message du serveur', async () => {
    const coupe = creerClientApi('http://x/api/v1', async () => {
      throw new TypeError('Failed to fetch')
    })
    const endormi = creerClientApi('http://x/api/v1', async () => new Response('<html>Bad gateway</html>', { status: 502 }))
    const pinFaux = creerClientApi('http://x/api/v1', async () => reponseJson(401, { erreur: 'PIN commerçant incorrect.' }))
    const demande = { role: 'commerce', commerceId: 'c1', pin: '482916' } as const

    const e1 = await coupe.ouvrirSession(demande).catch((e: unknown) => e)
    const e2 = await endormi.ouvrirSession(demande).catch((e: unknown) => e)
    const e3 = await pinFaux.ouvrirSession(demande).catch((e: unknown) => e)

    assert.equal(messageEchec(e1, true), MESSAGE_SERVEUR_INJOIGNABLE)
    assert.equal(messageEchec(e2, true), MESSAGE_SERVEUR_INJOIGNABLE)
    assert.equal(messageEchec(e3, true), 'PIN commerçant incorrect.', 'message actuel conservé pour un PIN faux')
    assert.match(MESSAGE_SERVEUR_INJOIGNABLE, /^Serveur injoignable — vérifiez votre connexion/)
    assert.match(MESSAGE_SERVEUR_INJOIGNABLE, /se réveille.*une minute/)
    assert.doesNotMatch(MESSAGE_SERVEUR_INJOIGNABLE, /PIN/)
    assert.deepEqual([causeEchec(e1, true), causeEchec(e2, true), causeEchec(e3, true)], ['reseau', 'reseau', '401'])
  })

  test('appareil sans réseau (navigator.onLine = false) : message dédié', () => {
    const e = new ErreurApi(0, 'x')
    assert.equal(causeEchec(e, false), 'appareil-hors-ligne')
    assert.equal(messageEchec(e, false), MESSAGE_APPAREIL_HORS_LIGNE)
    assert.match(MESSAGE_APPAREIL_HORS_LIGNE, /Wi-Fi ou les données mobiles/)
  })

  test('« Réessayer » (PIN gardé) seulement pour réseau / délai / erreur serveur — jamais pour un PIN faux ou un blocage', () => {
    assert.equal(echecReessayable(new ErreurApi(0, '')), true)
    assert.equal(echecReessayable(new ErreurDelai()), true)
    assert.equal(echecReessayable(new ErreurApi(500, 'Erreur')), true)
    assert.equal(echecReessayable(new ErreurApi(401, 'PIN commerçant incorrect.')), false)
    assert.equal(echecReessayable(new ErreurApi(429, 'Trop de PIN incorrects. Réessayez dans 5 min.')), false)
    assert.equal(messageEchec(new ErreurApi(429, 'Trop de PIN incorrects. Réessayez dans 5 min.')), 'Trop de PIN incorrects. Réessayez dans 5 min.')
  })

  test('Verrou : le PIN n’est effacé que s’il est refusé ; message différencié + « Réessayer » qui relance la tentative', () => {
    const v = lire('src/components/Verrou.tsx')
    assert.ok(v.includes('if (!echecReessayable(e)) setPin(\'\')'))
    assert.ok(v.includes('const messageFormulaire = echec ? messageEchec(echec) : null'))
    assert.match(v, /reessayer && \(\s*<button type="button"[^>]*onClick=\{\(\) => void tenter\(\)\}/)
    assert.ok(v.includes('{MESSAGE_REVEIL_EN_COURS}'), 'indice « le serveur se réveille » pendant une vérification longue')
  })
})

describe('P0-U5 : délai de 30 s et nouveaux essais (horloge simulée)', () => {
  test('serveur qui se réveille : nouveaux essais toutes les 3 s, succès sans action de l’utilisateur', async (t) => {
    horlogeSimulee(t)
    let appels = 0
    const essais: number[] = []
    const p = tenterPendant(
      async () => {
        appels++
        if (appels < 3) throw new ErreurApi(0, 'injoignable')
        return 'ok'
      },
      { enLigne: () => true, surNouvelEssai: (n) => essais.push(n) },
    )
    await vider()
    assert.equal(appels, 1)
    await avancer(t, PAUSE_REVEIL_MS)
    assert.equal(appels, 2)
    await avancer(t, PAUSE_REVEIL_MS)
    assert.equal(await p, 'ok')
    assert.equal(appels, 3)
    assert.deepEqual(essais, [1, 2])
  })

  test('serveur toujours injoignable : échec « délai dépassé » à 30 s, puis plus aucun essai', async (t) => {
    horlogeSimulee(t)
    let appels = 0
    const p = tenterPendant(
      async () => {
        appels++
        throw new ErreurApi(0, 'injoignable')
      },
      { enLigne: () => true },
    )
    let fini: unknown = null
    p.catch((e: unknown) => (fini = e))
    for (let ms = 0; ms < DELAI_ACCES_MS - PAUSE_REVEIL_MS; ms += PAUSE_REVEIL_MS) await avancer(t, PAUSE_REVEIL_MS)
    assert.equal(fini, null, 'encore en cours avant 30 s')
    await avancer(t, PAUSE_REVEIL_MS)
    assert.ok(fini instanceof ErreurDelai)
    assert.equal(messageEchec(fini), MESSAGE_DELAI_DEPASSE)
    assert.equal(causeEchec(fini), 'timeout')
    const apres = appels
    assert.ok(apres >= 10 && apres <= 11, `≈ un essai toutes les 3 s (${apres})`)
    await avancer(t, 60_000)
    assert.equal(appels, apres, 'la boucle s’arrête après le délai')
  })

  test('requête qui ne répond jamais (pas d’AbortSignal.timeout) : jamais bloqué au-delà de 30 s', async (t) => {
    horlogeSimulee(t)
    let fini: unknown = null
    const p = tenterPendant(() => new Promise<never>(() => {}))
    p.catch((e: unknown) => (fini = e))
    await avancer(t, DELAI_ACCES_MS - 1)
    assert.equal(fini, null)
    await avancer(t, 1)
    assert.ok(fini instanceof ErreurDelai)
  })

  test('PIN faux : aucun nouvel essai, échec immédiat', async () => {
    let appels = 0
    await assert.rejects(
      tenterPendant(async () => {
        appels++
        throw new ErreurApi(401, 'PIN commerçant incorrect.')
      }),
      (e: ErreurApi) => e.statut === 401,
    )
    assert.equal(appels, 1)
  })

  test('appareil hors ligne : échec immédiat (inutile d’attendre 30 s)', async () => {
    let appels = 0
    await assert.rejects(
      tenterPendant(
        async () => {
          appels++
          throw new ErreurApi(0, 'injoignable')
        },
        { enLigne: () => false },
      ),
      (e: ErreurApi) => e.horsLigne,
    )
    assert.equal(appels, 1)
  })

  test('avecDelai : résultat transmis et minuterie libérée', async () => {
    assert.equal(await avecDelai(Promise.resolve(42), 10), 42)
    await assert.rejects(avecDelai(new Promise(() => {}), 5), ErreurDelai)
  })

  test('client API : repli quand AbortSignal.timeout manque (Safari iOS < 16) → la requête est annulée au délai', async (t) => {
    horlogeSimulee(t)
    const desc = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')!
    delete (AbortSignal as { timeout?: unknown }).timeout
    try {
      assert.equal('timeout' in AbortSignal, false)
      const s = signalDelai(10_000)!
      assert.equal(s.aborted, false)
      t.mock.timers.tick(10_000)
      assert.equal(s.aborted, true)
    } finally {
      Object.defineProperty(AbortSignal, 'timeout', desc)
    }
  })

  test('App / Verrou : au-delà de 30 s, message + « Réessayer » (relire l’accès / recharger la liste)', () => {
    const app = lire('src/App.tsx')
    assert.ok(app.includes('const accesLent = useDepasse(mode === \'api\' && !accesPret, DELAI_ACCES_MS)'))
    assert.match(app, /!accesPret && accesLent\)[\s\S]*?onClick=\{\(\) => void relireAcces\(\)\}[\s\S]*?Réessayer/)
    const v = lire('src/components/Verrou.tsx')
    assert.ok(v.includes("useDepasse(etat.commerces.length === 0 && connexion === 'chargement', DELAI_ACCES_MS)"))
    assert.match(v, /listeLente \?[\s\S]*?\{MESSAGE_DELAI_DEPASSE\}[\s\S]*?onClick=\{\(\) => void recharger\(\)\}/)
  })
})

describe('P0-U5 : déverrouillage (ouvrirAcces) — session P0-S1 inchangée', () => {
  const session = (s: Partial<Session> = {}): Session => ({ jeton: 'v1.abc.def', role: 'commerce', commerceId: 'c1', expireLe: '2026-11-10T20:00:00Z', ...s })

  test('cas normal : PIN échangé contre un jeton, état chargé avec le jeton', async () => {
    const appels: (Acces | null)[] = []
    const r = await ouvrirAcces({ ouvrirSession: async () => session() }, { chargerServeur: async (a) => (appels.push(a), etatVide()) }, { role: 'commerce', commerceId: 'c1', pin: '482916' }, '')
    assert.deepEqual(r.acces, { role: 'commerce', commerceId: 'c1', jeton: 'v1.abc.def', expireLe: '2026-11-10T20:00:00Z' })
    assert.deepEqual(appels, [r.acces])
  })

  test('serveur endormi puis réveillé : la tentative entière est relancée et aboutit avec un jeton', async () => {
    let reveille = 0
    const r = await ouvrirAcces(
      {
        ouvrirSession: async () => {
          if (reveille++ < 2) throw new ErreurApi(0, 'injoignable')
          return session()
        },
      },
      {
        chargerServeur: async (a) => {
          if (reveille <= 2) throw new ErreurApi(0, 'injoignable')
          assert.equal(a?.jeton, 'v1.abc.def')
          return etatVide()
        },
      },
      { role: 'commerce', commerceId: 'c1', pin: '482916' },
      '',
      { pauseMs: 1, enLigne: () => true },
    )
    assert.equal(r.acces.jeton, 'v1.abc.def')
    assert.equal(reveille, 3)
  })

  test('PIN faux (401 sur POST /sessions) : relancé tel quel, rien chargé, pas de nouvel essai', async () => {
    let charge = 0
    let sessions = 0
    await assert.rejects(
      ouvrirAcces(
        {
          ouvrirSession: async () => {
            sessions++
            throw new ErreurApi(401, 'PIN commerçant incorrect.')
          },
        },
        { chargerServeur: async () => (charge++, etatVide()) },
        { role: 'commerce', commerceId: 'c1', pin: '000000' },
        '',
      ),
      (e: ErreurApi) => e.statut === 401 && e.message === 'PIN commerçant incorrect.',
    )
    assert.equal(sessions, 1)
    assert.equal(charge, 0)
  })

  test('serveur sans sessions (503 → statut 0 / 404) : repli sur le PIN en en-tête, comme avant P0-U5', async () => {
    const r = await ouvrirAcces(
      {
        ouvrirSession: async () => {
          throw new ErreurApi(404, 'Route inconnue')
        },
      },
      { chargerServeur: async () => etatVide() },
      { role: 'admin', pin: '98765432' },
      'c1',
    )
    assert.deepEqual(r.acces, { role: 'admin', pin: '98765432' })
  })

  test('store : le déverrouillage passe par ouvrirAcces, journalise l’échec puis le relance (affiché par Verrou)', () => {
    const s = lire('src/store.tsx')
    assert.match(s, /r = await ouvrirAcces\(api, depot, saisi, actifRef\.current\)\s*\} catch \(err\) \{\s*journaliserEchec\('deverrouillage', err, journal\)\s*throw err/)
    assert.ok(s.includes('await avecDelai(coffre.memoriser(r.acces), DELAI_COFFRE_MS).catch(() => false)'), 'mémoriser ne bloque jamais')
  })
})

describe('P0-U5 : 401 → verrouillage expliqué, message persistant', () => {
  const jeton: Acces = { role: 'commerce', commerceId: 'c1', jeton: 'v1.a.b' }
  const pin: Acces = { role: 'admin', pin: '98765432' }

  test('session expirée (jeton) ou PIN changé : verrouiller avec un message clair', () => {
    assert.deepEqual(issueRechargement(new ErreurApi(401, 'Session expirée : déverrouillez à nouveau.'), jeton, jeton), { type: 'verrouiller', message: MESSAGE_SESSION_EXPIREE })
    assert.deepEqual(issueRechargement(new ErreurApi(401, 'PIN admin incorrect.'), pin, pin), { type: 'verrouiller', message: MESSAGE_PIN_CHANGE })
    assert.match(MESSAGE_SESSION_EXPIREE, /^Session expirée — veuillez saisir à nouveau votre code\./)
    for (const m of [MESSAGE_SESSION_EXPIREE, MESSAGE_PIN_CHANGE, MESSAGE_COFFRE_ILLISIBLE]) {
      assert.match(m, /Rien n’est perdu : vos clients sont enregistrés sur le serveur/)
      assert.doesNotMatch(m, /\b(tu|ton|ta|tes|toi)\b/i)
    }
  })

  test('chargement fait avec un autre accès (déverrouillage pendant la requête) : ignoré', () => {
    assert.deepEqual(issueRechargement(new ErreurApi(401, 'x'), null, jeton), { type: 'ignorer' })
    assert.deepEqual(issueRechargement(new ErreurApi(0, 'x'), jeton, null), { type: 'ignorer' })
  })

  test('injoignable → hors ligne (pas de verrouillage) ; autre refus → message seul', () => {
    assert.deepEqual(issueRechargement(new ErreurApi(0, 'x'), jeton, jeton, true), { type: 'horsLigne', message: MESSAGE_SERVEUR_INJOIGNABLE })
    assert.deepEqual(issueRechargement(new TypeError('x'), jeton, jeton, false), { type: 'horsLigne', message: MESSAGE_APPAREIL_HORS_LIGNE })
    assert.deepEqual(issueRechargement(new ErreurApi(429, 'Trop de requêtes.'), jeton, jeton), { type: 'erreur', message: 'Trop de requêtes.' })
    assert.deepEqual(issueRechargement(new ErreurApi(401, 'x'), null, null), { type: 'erreur', message: 'x' }, 'sans accès : pas de verrouillage')
  })

  test('store : le message vit dans `verrouillage`, que les rechargements réussis n’effacent pas', () => {
    const s = lire('src/store.tsx')
    assert.ok(s.includes('setVerrouillage(message ? { message, role } : null)'))
    const appliquer = s.slice(s.indexOf('const appliquer = useCallback('), s.indexOf('const verrouiller = useCallback('))
    assert.ok(appliquer.includes('setErreurConnexion(null)'))
    assert.ok(!appliquer.includes('setVerrouillage'), 'appliquer() (toutes les 10 s) ne touche pas au message de verrouillage')
    assert.ok(s.includes("if (issue.type === 'verrouiller') {\n        await verrouiller(issue.message)"))
    assert.ok(s.includes('await avecDelai(coffre.oublier(), DELAI_COFFRE_MS).catch(() => {})'), 'un IndexedDB bloqué ne retient plus le verrouillage')
    // Effacé seulement au prochain déverrouillage réussi.
    const deverrouiller = s.slice(s.indexOf('const deverrouiller = useCallback('), s.indexOf('const avecPin = useCallback('))
    assert.ok(deverrouiller.includes('setVerrouillage(null)'))
  })

  test('store : un chargement fait sans accès n’écrase plus les données d’un déverrouillage survenu entre-temps', () => {
    const s = lire('src/store.tsx')
    assert.ok(s.includes('if (n <= dernierApplique.current || a !== accesRef.current) return'))
    assert.ok(s.includes('const issue = issueRechargement(err, a, accesRef.current)'))
  })

  test('Verrou : message de verrouillage affiché (bandeau persistant) et rôle de l’accès perdu présélectionné', () => {
    const v = lire('src/components/Verrou.tsx')
    assert.match(v, /\{verrouillage && \([\s\S]*?\{verrouillage\.message\}/)
    assert.ok(v.includes("useState<'commerce' | 'admin'>(verrouillage?.role === 'admin' ? 'admin' : 'commerce')"))
  })
})

describe('P0-U5 : coffre illisible → échec explicite, rien d’effacé', () => {
  test('rien de mémorisé : « vide » (cas normal, pas une erreur)', async () => {
    assert.deepEqual(await creerCoffrePin(new StockageMemoire(), rangementMemoire()).lireDetaille(), { statut: 'vide' })
    assert.deepEqual(await creerCoffrePin(new StockageMemoire(), rangementMemoire(), null).lireDetaille(), { statut: 'vide' }, 'sans WebCrypto')
  })

  test('clé IndexedDB perdue : « illisible » (et plus un null muet) ; l’accès chiffré n’est pas effacé', async () => {
    const session = new StockageMemoire()
    const rangement = rangementMemoire()
    const coffre = creerCoffrePin(session, rangement)
    await coffre.memoriser({ role: 'commerce', commerceId: 'c1', jeton: 'v1.a.b' })
    await rangement.effacer()
    assert.deepEqual(await coffre.lireDetaille(), { statut: 'illisible', raison: 'cle-absente' })
    assert.equal(await coffre.lire(), null, 'lire() inchangé')
    assert.equal(session.m.size, 1)
  })

  test('données abîmées ou IndexedDB en erreur : « illisible »', async () => {
    const session = new StockageMemoire()
    session.setItem('fidelite:acces', '{pas du json')
    assert.equal((await creerCoffrePin(session, rangementMemoire()).lireDetaille()).statut, 'illisible')
    const enPanne: RangementCle = {
      lire: async () => {
        throw new DOMException('bloqué', 'InvalidStateError')
      },
      ecrire: async () => {},
      effacer: async () => {},
    }
    session.setItem('fidelite:acces', JSON.stringify({ iv: 'AAAA', donnees: 'AAAA' }))
    assert.deepEqual(await creerCoffrePin(session, enPanne).lireDetaille(), { statut: 'illisible', raison: 'InvalidStateError' })
  })

  test('IndexedDB qui ne répond jamais (Safari iOS) : relecture abandonnée à 5 s, « illisible / delai »', async (t) => {
    horlogeSimulee(t)
    const session = new StockageMemoire()
    session.setItem('fidelite:acces', JSON.stringify({ iv: 'AAAA', donnees: 'AAAA' }))
    const bloque: RangementCle = { lire: () => new Promise(() => {}), ecrire: async () => {}, effacer: async () => {} }
    let r: unknown = null
    void lireCoffreBorne(creerCoffrePin(session, bloque)).then((x) => (r = x))
    await avancer(t, DELAI_COFFRE_MS - 1)
    assert.equal(r, null)
    await avancer(t, 1)
    assert.deepEqual(r, { statut: 'illisible', raison: 'delai' })
  })

  test('store / caisse : coffre illisible → message explicite + « Réessayer », jamais d’effacement du cache', () => {
    const s = lire('src/store.tsx')
    const demarrer = s.slice(s.indexOf('const demarrer = useCallback('), s.indexOf('const relireAcces = '))
    assert.ok(demarrer.includes('const lu = await lireCoffreBorne(coffre)'))
    assert.ok(demarrer.includes("journaliserEchec('demarrage', new ErreurCoffre(lu.raison), journal)"))
    assert.ok(demarrer.includes('setVerrouillage({ message: MESSAGE_COFFRE_ILLISIBLE, coffre: true })'))
    assert.ok(!demarrer.includes('reinitialiser'), 'le cache local n’est pas effacé')
    assert.ok(demarrer.includes('setAccesPret(true)'))
    const v = lire('src/components/Verrou.tsx')
    assert.match(v, /verrouillage\.coffre && \([\s\S]*?onClick=\{\(\) => void relireAcces\(\)\}[\s\S]*?Réessayer/)
    const c = lire('src/pages/Caisse.tsx')
    assert.ok(c.includes('void lireCoffreBorne(coffre).then((r) => {'))
    assert.ok(c.includes('setErreurAcces(MESSAGE_COFFRE_ILLISIBLE)'))
  })
})

describe('P0-U5 : journal de diagnostic (sans PIN)', () => {
  const avecJournal = () => {
    const stockage = new StockageMemoire()
    const sorties: unknown[][] = []
    const o = { stockage, maintenant: () => new Date('2026-11-09T18:42:07Z'), enLigne: true, console: { warn: (...a: unknown[]) => void sorties.push(a) } }
    return { stockage, sorties, o }
  }

  test('chaque cause est distinguée : réseau / délai / 401 / coffre', () => {
    const { stockage, sorties, o } = avecJournal()
    journaliserEchec('deverrouillage', new ErreurApi(0, 'x'), o)
    journaliserEchec('deverrouillage', new ErreurDelai(), o)
    journaliserEchec('rechargement', new ErreurApi(401, 'Session expirée : déverrouillez à nouveau.'), o)
    journaliserEchec('demarrage', new ErreurCoffre('cle-absente'), o)
    const j = lireJournal(stockage)
    assert.deepEqual(
      j.map((e) => [e.etape, e.cause, e.statut]),
      [
        ['demarrage', 'coffre', undefined],
        ['rechargement', '401', 401],
        ['deverrouillage', 'timeout', undefined],
        ['deverrouillage', 'reseau', 0],
      ],
    )
    assert.equal(j[0].detail, 'cle-absente')
    assert.equal(j[3].message, MESSAGE_SERVEUR_INJOIGNABLE)
    assert.equal(j[3].date, '2026-11-09T18:42:07.000Z')
    assert.equal(sorties.length, 4, 'aussi en console')
    assert.equal(sorties[0][0], '[connexion] échec')
  })

  test('jamais de PIN, de code ni de jeton dans le journal', () => {
    const { stockage, sorties, o } = avecJournal()
    journaliserEchec('deverrouillage', new ErreurApi(401, 'PIN 482916 refusé pour v1.eyJhIjoxfQ.c2lnbmF0dXJl'), o)
    const brut = stockage.getItem(CLE_JOURNAL)!
    assert.ok(!brut.includes('482916'))
    assert.ok(!brut.includes('v1.eyJhIjoxfQ'))
    assert.ok(!JSON.stringify(sorties).includes('482916'))
    assert.equal(masquerSecrets('code 1234, tél 0612345678'), 'code ••••, tél ••••')
  })

  test('20 dernières entrées, la plus récente d’abord ; stockage cassé : console seule', () => {
    const { stockage, o } = avecJournal()
    for (let i = 0; i < 25; i++) journaliserEchec('rechargement', new ErreurApi(500 + (i % 3), `e${i}`), o)
    const j = lireJournal(stockage)
    assert.equal(j.length, TAILLE_JOURNAL)
    assert.equal(j[0].message, 'e24')
    const casse = { getItem: () => '{', setItem: () => { throw new Error('plein') } }
    assert.doesNotThrow(() => journaliserEchec('rechargement', new ErreurApi(0, 'x'), { ...o, stockage: casse }))
    assert.deepEqual(lireJournal(casse), [])
  })

  test('ligne lisible pour l’assistance : heure de Paris, étape, cause, statut HTTP, message', () => {
    const { o } = avecJournal()
    const e = journaliserEchec('deverrouillage', new ErreurApi(0, 'x'), { ...o, enLigne: false })
    assert.equal(ligneDiagnostic(e), `09/11 19:42:07 · deverrouillage · appareil hors ligne · HTTP 0 · hors ligne — ${MESSAGE_APPAREIL_HORS_LIGNE}`)
  })

  test('Verrou : « Détails pour l’assistance » liste les derniers échecs ; le rechargement ne journalise qu’un changement de cause', () => {
    const v = lire('src/components/Verrou.tsx')
    assert.ok(v.includes('Détails pour l’assistance'))
    assert.ok(v.includes('{ligneDiagnostic(e)}'))
    const s = lire('src/store.tsx')
    assert.ok(s.includes("if (causeJournalisee.current !== cause) {\n        causeJournalisee.current = cause\n        journaliserEchec('rechargement', err, journal)"))
  })
})

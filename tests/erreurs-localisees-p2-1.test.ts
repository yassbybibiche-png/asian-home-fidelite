// P2-1 — erreurs serveur localisées : code stable renvoyé par l'API (`{ erreur, code, details? }`), traduction
// côté client (`traduireErreur`, dictionnaire ERREURS_EN). Fonctions pures + vrai serveur HTTP sur une base
// SQLite temporaire, mode strict, horloge pilotée (comme tests/cycle-gain-r3.test.ts).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import type { Client, Tirage } from '../src/types.ts'
import { creerClientApi, ErreurApi } from '../src/data/api.ts'
import { activerCode, lancerTirage } from '../src/data/jeuApi.ts'
import { ERREURS_EN, traduireErreur } from '../src/lib/langue.ts'
import { instantParis, jourIsoParis, refusActivation } from '../src/lib/roulette.ts'
import { nomFichierExportClient } from '../src/lib/csv.ts'
import { lienCourtCarte } from '../src/lib/jetonCarte.ts'
import { codeEnBase } from './code-en-base.ts'

const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const CODE_EQUIPE = { 'X-Equipe-Code': '2468' }
const SECRET = 'secret-de-test-p2-1-erreurs-au-moins-32-caracteres-0123'
const LARGES = { inscriptionParIp: 1000, inscriptionParContact: 1000, ficheClientParIp: 1000, lectureParIp: 1000, lectureParCarte: 1000, tirageParIp: 1000, tirageParContact: 1000 }

/** Tirage gagné le mardi 10 novembre 2026 à 9 h, heure de Paris (même repère que cycle-gain-r3). */
const J = instantParis(2026, 11, 10, 9, 0)
const gain: Tirage = { id: 'ti-1', commerceId: AH, clientId: 'c', lot: 'Nems offerts', lotId: 'lot-nems', typeLot: 'lot', date: J.toISOString(), code: 'ABCD23' }
const le = (jour: number, h = 0, min = 0) => instantParis(2026, 11, 10 + jour, h, min)

describe('P2-1 : traduireErreur (dictionnaire ERREURS_EN)', () => {
  test('chaque code a sa traduction anglaise ; en français, le message du serveur est gardé tel quel', () => {
    const details = { utilisableLe: '2026-11-17', dernierJour: '2026-12-16' }
    for (const [code, en] of Object.entries(ERREURS_EN)) {
      const attendu = en.replace('{utilisableLe}', 'Tue, 17 Nov 2026').replace('{dernierJour}', 'Wed, 16 Dec 2026')
      assert.equal(traduireErreur(code, 'message du serveur', 'en', details), attendu, code)
      assert.equal(traduireErreur(code, 'message du serveur', 'fr', details), 'message du serveur', code)
    }
  })

  test('dates : « Tue, 17 Nov 2026 » / « Wed, 16 Dec 2026 » ; détail manquant → message du serveur (jamais de phrase à trou)', () => {
    assert.equal(
      traduireErreur('GAIN_TROP_TOT', 'Votre gain sera utilisable dès demain, mar. 17 nov. 2026, et jusqu’au mer. 16 déc. 2026.', 'en', { utilisableLe: '2026-11-17', dernierJour: '2026-12-16' }),
      'Your prize will be usable from tomorrow, Tue, 17 Nov 2026, until Wed, 16 Dec 2026.',
    )
    assert.equal(
      traduireErreur('GAIN_EXPIRE', 'Gain expiré le jeu. 10 déc. 2026 : il n’est plus utilisable.', 'en', { dernierJour: '2026-12-10' }),
      'Prize expired on Thu, 10 Dec 2026: it can no longer be used.',
    )
    const fr = 'Votre gain sera utilisable dès demain, mar. 17 nov. 2026, et jusqu’au mer. 16 déc. 2026.'
    assert.equal(traduireErreur('GAIN_TROP_TOT', fr, 'en', {}), fr, 'sans détails : repli sur le message du serveur')
    assert.equal(traduireErreur('GAIN_TROP_TOT', fr, 'en'), fr)
  })

  test('code inconnu ou absent : le message du serveur s’affiche tel quel, en français', () => {
    assert.equal(traduireErreur('CODE_FUTUR', 'Message en français.', 'en'), 'Message en français.')
    assert.equal(traduireErreur(undefined, 'Message en français.', 'en'), 'Message en français.')
  })
})

describe('P2-1 : refusActivation porte le code et les dates ISO (jour de Paris)', () => {
  test('trop tôt, expiré, déjà remis, sans lot, hérité : code + détails', () => {
    assert.deepEqual(refusActivation(gain, le(0, 12)), {
      statut: 409,
      message: 'Votre gain sera utilisable dès demain, mer. 11 nov. 2026, et jusqu’au jeu. 10 déc. 2026.',
      code: 'GAIN_TROP_TOT',
      details: { utilisableLe: '2026-11-11', dernierJour: '2026-12-10' },
    })
    assert.deepEqual(refusActivation(gain, le(31)), {
      statut: 410,
      message: 'Gain expiré le jeu. 10 déc. 2026 : il n’est plus utilisable.',
      code: 'GAIN_EXPIRE',
      details: { dernierJour: '2026-12-10' },
    })
    assert.deepEqual(refusActivation({ ...gain, remis: { le: '', par: { type: 'membre', nom: 'Mai' } } }, le(1)), {
      statut: 409,
      message: 'Ce gain a déjà été remis au comptoir.',
      code: 'GAIN_DEJA_REMIS',
    })
    assert.equal(refusActivation({ ...gain, typeLot: 'perdant' }, le(1))?.code, 'GAIN_SANS_LOT')
    assert.equal(refusActivation({ ...gain, code: undefined }, le(1))?.code, 'GAIN_SANS_LOT')
    assert.equal(refusActivation(gain, le(1)), null, 'utilisable : rien à refuser')
    // Hérité (sans typeLot) : direct au comptoir le jour J, expiré ensuite — avec le détail du dernier jour.
    assert.equal(refusActivation({ ...gain, typeLot: undefined }, le(0, 12))?.code, 'GAIN_HERITE_DIRECT')
    assert.deepEqual(refusActivation({ ...gain, typeLot: undefined }, le(1)), {
      statut: 410,
      message: 'Gain expiré le mar. 10 nov. 2026 (gain d’avant la nouvelle roue, valable le jour du tirage seulement).',
      code: 'GAIN_EXPIRE_ANCIENNE_REGLE',
      details: { dernierJour: '2026-11-10' },
    })
  })

  test('jourIsoParis : le même jour que jourEnClair, même sur un processus en UTC', () => {
    assert.equal(jourIsoParis(le(1)), '2026-11-11')
    assert.equal(jourIsoParis(le(30)), '2026-12-10')
  })
})

describe('P2-1 : ErreurApi porte le code et les détails (client HTTP, fetch simulée)', () => {
  function fauxFetch(statut: number, corps: unknown) {
    return async () => new Response(JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/json' } })
  }

  test('409 codée : code + détails lus ; 409 sans code : code absent ; 503 : hors ligne, sans code', async () => {
    const api = creerClientApi('https://api.exemple.fr/api/v1', fauxFetch(409, { erreur: 'Ce gain a déjà été remis au comptoir.', code: 'GAIN_DEJA_REMIS' }) as unknown as typeof fetch)
    await assert.rejects(api.carte('cl-1'), (e: unknown) => {
      assert.ok(e instanceof ErreurApi)
      assert.equal(e.statut, 409)
      assert.equal(e.message, 'Ce gain a déjà été remis au comptoir.')
      assert.equal(e.code, 'GAIN_DEJA_REMIS')
      return true
    })
    const apiDetails = creerClientApi(
      'https://api.exemple.fr/api/v1',
      fauxFetch(409, { erreur: 'x', code: 'GAIN_TROP_TOT', details: { utilisableLe: '2026-11-11', dernierJour: '2026-12-10' } }) as unknown as typeof fetch,
    )
    await assert.rejects(apiDetails.carte('cl-1'), (e: unknown) => {
      assert.ok(e instanceof ErreurApi)
      assert.deepEqual(e.details, { utilisableLe: '2026-11-11', dernierJour: '2026-12-10' })
      return true
    })
    const apiSansCode = creerClientApi('https://api.exemple.fr/api/v1', fauxFetch(409, { erreur: 'Refus.' }) as unknown as typeof fetch)
    await assert.rejects(apiSansCode.carte('cl-1'), (e: unknown) => {
      assert.ok(e instanceof ErreurApi)
      assert.equal(e.code, undefined)
      return true
    })
    const api503 = creerClientApi('https://api.exemple.fr/api/v1', fauxFetch(503, { erreur: 'x', code: 'QUELQUE_CHOSE' }) as unknown as typeof fetch)
    await assert.rejects(api503.carte('cl-1'), (e: unknown) => {
      assert.ok(e instanceof ErreurApi)
      assert.equal(e.statut, 0, '502/503/504 → injoignable')
      assert.equal(e.code, undefined, 'le corps de l’hébergeur ne porte pas de code')
      return true
    })
  })
})

describe('P2-1 : serveur HTTP — codes stables sur les parcours carte / gain / commande', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p2-1-'))
  const horloge = { t: le(0, 12) }
  let app: Awaited<ReturnType<typeof creerServeur>>
  let racine = ''
  let numeroIp = 0

  type Reponse = { statut: number; contenu: any; texte: string }
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}): Promise<Reponse> {
    const r = await fetch(`${racine}/api/v1${chemin}`, {
      method: methode,
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${++numeroIp % 250}`, ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    const texte = await r.text()
    let contenu: unknown = texte
    try {
      contenu = JSON.parse(texte)
    } catch {
      // Texte brut
    }
    return { statut: r.status, contenu, texte }
  }
  const bearer = (jeton: string) => ({ Authorization: `Bearer ${jeton}` })
  const activer = (tirageId: string, jeton: string) => api('POST', `/commerces/${AH}/tirages/${tirageId}/activer`, undefined, bearer(jeton))
  const gains = (code: string) => `/commerces/${AH}/caisse/gains/${code}`

  /** Joueur inscrit ; visite validée sauf si `visite: false` ; tirage joué (lot physique à 100 %). */
  async function joueur(contact: string, visite = true) {
    const ins = await api('POST', `/commerces/${AH}/clients`, { contact })
    assert.equal(ins.statut, 201, ins.texte)
    const { client, jeton } = ins.contenu as { client: Client; jeton: string }
    if (visite) assert.equal((await api('POST', `/commerces/${AH}/clients/${client.id}/visite`, undefined, PIN)).statut, 200)
    const t = await api('POST', `/commerces/${AH}/tirages`, {}, bearer(jeton))
    assert.equal(t.statut, 201, t.texte)
    return { client, jeton, tirageId: t.contenu.tirageId as string, code: codeEnBase(join(dossier, 'p2-1.db'), t.contenu.tirageId as string)! }
  }

  before(async () => {
    app = await creerServeur({
      fichierDb: join(dossier, 'p2-1.db'),
      adminPin: '98765432',
      pinInitial: '1234',
      version: 'test',
      secretSession: SECRET,
      authClient: 'stricte',
      derriereProxy: true,
      maintenant: () => horloge.t,
      limitesPubliques: LARGES,
    })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
    assert.equal((await api('PATCH', `/commerces/${AH}`, { lots: [{ libelle: 'Nems offerts', probabilite: 100 }] }, PIN)).statut, 200)
    // Membre d'équipe pour la remise en caisse (code 2468).
    assert.equal((await api('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)).statut, 201)
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('tirage sans visite validée (mode visite) : 409 JEU_NON_DISPONIBLE, message français inchangé', async () => {
    horloge.t = le(0, 12)
    assert.equal((await api('PATCH', `/commerces/${AH}`, { modeAccesRoue: 'visite' }, PIN)).statut, 200)
    const ins = await api('POST', `/commerces/${AH}/clients`, { contact: '0610000001' })
    assert.equal(ins.statut, 201, ins.texte)
    const { client, jeton } = ins.contenu as { client: Client; jeton: string }
    const t = await api('POST', `/commerces/${AH}/tirages`, {}, bearer(jeton))
    assert.equal(t.statut, 409)
    assert.equal(t.contenu.code, 'JEU_NON_DISPONIBLE')
    assert.equal(
      t.contenu.erreur,
      'Vous ne pouvez pas jouer pour le moment : faites valider votre visite du jour au comptoir — si vous avez déjà tourné la roue aujourd’hui, revenez lors de votre prochaine visite.',
    )
    // jeuApi porte le code jusqu'à la page : l'affichage anglais est possible.
    const apiClient = creerClientApi(`${racine}/api/v1`)
    const issue = await lancerTirage(apiClient, { id: AH, lots: [] }, '0610000001', undefined, jeton)
    assert.equal(issue.ok, false)
    assert.equal((issue as { code?: string }).code, 'JEU_NON_DISPONIBLE')
    assert.equal((issue as { refus?: boolean }).refus, true)
    assert.equal((await api('PATCH', `/commerces/${AH}`, { modeAccesRoue: 'libre' }, PIN)).statut, 200)
    void client
  })

  test('activation le jour J : 409 GAIN_TROP_TOT + dates ISO ; jeton forgé : 401 ACCES_CARTE_REFUSE ; tirage inconnu : 404 GAIN_INTROUVABLE', async () => {
    horloge.t = le(0, 12)
    const j = await joueur('0610000002')
    const tot = await activer(j.tirageId, j.jeton)
    assert.equal(tot.statut, 409)
    assert.equal(tot.contenu.code, 'GAIN_TROP_TOT')
    assert.deepEqual(tot.contenu.details, { utilisableLe: '2026-11-11', dernierJour: '2026-12-10' })
    const apiClient = creerClientApi(`${racine}/api/v1`)
    const issue = await activerCode(apiClient, { lire: () => ({ jeton: j.jeton, expireLe: '2099-01-01T00:00:00Z' }) }, { commerceId: AH, clientId: j.client.id, tirageId: j.tirageId })
    assert.equal(issue.ok, false)
    assert.equal((issue as { code?: string }).code, 'GAIN_TROP_TOT')
    assert.deepEqual((issue as { details?: unknown }).details, { utilisableLe: '2026-11-11', dernierJour: '2026-12-10' })
    const forge = await activer(j.tirageId, 'jeton-forge')
    assert.equal(forge.statut, 401)
    assert.equal(forge.contenu.code, 'ACCES_CARTE_REFUSE')
    const inconnu = await activer('ti-inexistant', j.jeton)
    assert.equal(inconnu.statut, 404)
    assert.equal(inconnu.contenu.code, 'GAIN_INTROUVABLE')
  })

  test('activation après remise en caisse : 409 GAIN_DEJA_REMIS', async () => {
    horloge.t = le(0, 12)
    const j = await joueur('0610000003')
    horloge.t = le(1, 12)
    const ok = await activer(j.tirageId, j.jeton)
    assert.equal(ok.statut, 200, ok.texte)
    assert.equal(ok.contenu.code, j.code)
    assert.equal((await api('POST', `${gains(j.code)}/remise`, undefined, CODE_EQUIPE)).statut, 200)
    const apres = await activer(j.tirageId, j.jeton)
    assert.equal(apres.statut, 409)
    assert.equal(apres.contenu.code, 'GAIN_DEJA_REMIS')
    assert.equal(apres.contenu.erreur, 'Ce gain a déjà été remis au comptoir.')
    horloge.t = le(0, 12)
  })

  test('carte inconnue : 404 CARTE_INTROUVABLE ; contact invalide : 400 CONTACT_INVALIDE', async () => {
    const carte = await api('GET', '/cartes/cl-inexistante-1234')
    assert.equal(carte.statut, 404)
    assert.equal(carte.contenu.code, 'CARTE_INTROUVABLE')
    const contact = await api('POST', `/commerces/${AH}/clients`, { contact: 'pas-un-contact' })
    assert.equal(contact.statut, 400)
    assert.equal(contact.contenu.code, 'CONTACT_INVALIDE')
  })

  test('commerce inactif : 409 COMMERCE_INACTIF sur la lecture de la carte, puis réactivé', async () => {
    const j = await joueur('0610000004')
    assert.equal((await api('PATCH', `/commerces/${AH}`, { actif: false }, PIN)).statut, 200)
    const carte = await api('GET', `/cartes/${j.client.id}`, undefined, bearer(j.jeton))
    assert.equal(carte.statut, 409)
    assert.equal(carte.contenu.code, 'COMMERCE_INACTIF')
    assert.equal((await api('PATCH', `/commerces/${AH}`, { actif: true }, PIN)).statut, 200)
  })

  test('commande à table : table inconnue 404 TABLE_INCONNUE, module désactivé 409 COMMANDE_DESACTIVEE, suivi inconnu 404 COMMANDE_INTROUVABLE', async () => {
    const p = await api('PATCH', `/commerces/${AH}`, { commande: { active: true, tables: [{ nom: 'Table 1' }] } }, PIN)
    assert.equal(p.statut, 200, p.texte)
    const jetonTable = (p.contenu.commerce.commande.tables as { jeton: string }[])[0].jeton
    const inconnue = await api('GET', `/commerces/${AH}/tables/jeton-inconnu`)
    assert.equal(inconnue.statut, 404)
    assert.equal(inconnue.contenu.code, 'TABLE_INCONNUE')
    const suivie = await api('GET', `/commerces/${AH}/commandes/cmd-inconnue`, undefined, { 'X-Secret-Commande': 'secret-inconnu' })
    assert.equal(suivie.statut, 404)
    assert.equal(suivie.contenu.code, 'COMMANDE_INTROUVABLE')
    assert.equal((await api('PATCH', `/commerces/${AH}`, { commande: { active: false, tables: [{ nom: 'Table 1', jeton: jetonTable }] } }, PIN)).statut, 200)
    const desactivee = await api('GET', `/commerces/${AH}/tables/${jetonTable}`)
    assert.equal(desactivee.statut, 409)
    assert.equal(desactivee.contenu.code, 'COMMANDE_DESACTIVEE')
  })
})

describe('P2-1 : bundle — les aides d’une ligne ne tirent plus les gros modules', () => {
  test('nomFichierExportClient et lienCourtCarte : même forme qu’avant, depuis leur nouvelle maison', () => {
    assert.equal(nomFichierExportClient('cl-abc'), 'donnees-cl-abc.csv')
    assert.equal(nomFichierExportClient('cl/a b'), 'donnees-cl_a_b.csv')
    assert.equal(lienCourtCarte('https://exemple.fr/', 'cl-abc'), 'https://exemple.fr/c/cl-abc')
    assert.equal(lienCourtCarte('https://exemple.fr', 'cl-abc'), 'https://exemple.fr/c/cl-abc')
  })

  test('CartePublique n’importe plus rgpd ni relances : ces modules restent hors du bundle initial', () => {
    const page = readFileSync(join(import.meta.dirname, '..', 'src/pages/CartePublique.tsx'), 'utf8')
    assert.doesNotMatch(page, /from '\.\.\/lib\/rgpd'/)
    assert.doesNotMatch(page, /from '\.\.\/lib\/relances'/)
  })
})

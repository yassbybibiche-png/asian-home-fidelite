// Expérience 10/10, lot 1 — Commande à table, côté SERVEUR : calcul du panier depuis le menu en base (logique pure),
// stockage en table `meta` (idempotence, index du jour, transitions par comparaison-et-échange), routes publiques et
// commerçant, configuration des tables (jetons générés, jamais régénérés), drapeau `commandeActive` de la fiche publique.
// Vrai serveur HTTP sur SQLite temporaire (horloge injectée). Concurrence : SQLite résout chaque appel en microtâche,
// deux requêtes HTTP ne s'entrelacent donc jamais ici → (1) le module est testé avec un stockage dont les lectures
// attendent une barrière (les deux transitions relisent la même valeur avant d'écrire), (2) le 409 HTTP est provoqué
// par un déclencheur SQLite qui ignore l'écriture conditionnelle (valeur « changée entre-temps »).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AddressInfo } from 'node:net'

import { creerServeur, LIMITE_COMMANDES_PAR_IP, TABLES_COMMANDE_MAX } from '../server/app.ts'
import { ouvrirStockage, type Stockage } from '../server/stockage.ts'
import { changerStatut, cleIdempotence, cleIndexCommandes, ConflitCommande, creerCommande, listerCommandes, TransitionInvalide } from '../server/commandes.ts'
import { calculerCommande, jourParis, transitionValide, STATUTS_COMMANDE } from '../src/lib/commande.ts'
import { commercePublic } from '../src/lib/vuePublique.ts'
import { validerMenu } from '../src/lib/menu.ts'
import { nouveauCommerce } from '../src/data/defaults.ts'
import type { Commande, Commerce, Menu, StatutCommande } from '../src/types.ts'

const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const ADMIN = { 'X-Admin-PIN': '98765432' }
/** Mardi 10/11/2026, 12:00 à Paris. */
const MIDI = new Date('2026-11-10T11:00:00Z')

const MENU: Pick<Menu, 'categories'> = {
  categories: [
    {
      id: 'cat-plats',
      nom: 'Plats',
      produits: [
        { id: 'p-pad', nom: 'Pad Thaï', prix: 1290, allergenes: [], options: [{ nom: 'Supplément crevettes', prix: 250 }, { nom: 'Œuf', prix: 100 }] },
        { id: 'p-riz', nom: 'Riz Thaï', prix: null, allergenes: [] },
        { id: 'p-bobun', nom: 'Bo Bun', prix: 1190, allergenes: [], indisponible: true },
        { id: 'p-nems', nom: 'Nems', prix: 650, allergenes: [] },
      ],
    },
  ],
}

describe('Commande à table : logique pure (src/lib/commande.ts)', () => {
  test('total recalculé depuis le menu : prix, noms et options relus, champs du navigateur ignorés', () => {
    const r = calculerCommande(MENU, [
      { produitId: 'p-nems', quantite: 2, prix: 1, prixUnitaire: 1, nom: 'Gratuit' },
      { produitId: 'p-pad', quantite: 1, options: ['Supplément crevettes', 'Œuf'], instructions: '  sans coriandre  ' },
    ])
    assert.ok(r.ok, JSON.stringify(r))
    assert.equal(r.total, 650 * 2 + 1290 + 250 + 100)
    assert.deepEqual(r.lignes[0], { produitId: 'p-nems', nom: 'Nems', prixUnitaire: 650, quantite: 2, options: [] })
    assert.deepEqual(r.lignes[1].options, [{ nom: 'Supplément crevettes', prix: 250 }, { nom: 'Œuf', prix: 100 }])
    assert.equal(r.lignes[1].instructions, 'sans coriandre')
  })

  test('refus typés avec un message en français', () => {
    const cas: [unknown, string, RegExp][] = [
      [[], 'panier_vide', /panier est vide/],
      ['p-nems', 'format', /liste/],
      [Array.from({ length: 31 }, () => ({ produitId: 'p-nems', quantite: 1 })), 'trop_de_lignes', /30 lignes/],
      [[{ produitId: 'p-inconnu', quantite: 1 }], 'produit_inconnu', /plus à la carte/],
      [[{ produitId: 'p-riz', quantite: 1 }], 'prix_absent', /Riz Thaï/],
      [[{ produitId: 'p-bobun', quantite: 1 }], 'indisponible', /Bo Bun.*plus disponible/],
      [[{ produitId: 'p-pad', quantite: 1, options: ['Fromage'] }], 'option_inconnue', /option non proposée/],
      [[{ produitId: 'p-nems', quantite: 1, options: ['Œuf'] }], 'option_inconnue', /Nems/],
      [[{ produitId: 'p-pad', quantite: 1, options: ['Œuf', 'Œuf'] }], 'option_inconnue', /deux fois/],
      [[{ produitId: 'p-nems', quantite: 0 }], 'quantite', /entre 1 et 20/],
      [[{ produitId: 'p-nems', quantite: 21 }], 'quantite', /entre 1 et 20/],
      [[{ produitId: 'p-nems', quantite: 1.5 }], 'quantite', /entre 1 et 20/],
      [[{ produitId: 'p-nems', quantite: '2' }], 'quantite', /entre 1 et 20/],
      [[{ produitId: 'p-nems', quantite: 1, instructions: 'x'.repeat(301) }], 'instructions', /300 caractères/],
    ]
    for (const [demande, code, message] of cas) {
      const r = calculerCommande(MENU, demande)
      assert.equal(r.ok, false, JSON.stringify(demande).slice(0, 80))
      if (!r.ok) {
        assert.equal(r.code, code, JSON.stringify(demande).slice(0, 80))
        assert.match(r.message, message)
      }
    }
    // Bornes acceptées : 30 lignes, quantité 20, instructions de 300 caractères.
    assert.ok(calculerCommande(MENU, Array.from({ length: 30 }, () => ({ produitId: 'p-nems', quantite: 20, instructions: 'x'.repeat(300) }))).ok)
    assert.equal(calculerCommande(undefined, [{ produitId: 'p-nems', quantite: 1 }]).ok, false)
  })

  test('transitions : recue → acceptee | refusee, acceptee → en_preparation → servie, rien d’autre', () => {
    const permises = new Set(['recue>acceptee', 'recue>refusee', 'acceptee>en_preparation', 'en_preparation>servie'])
    for (const de of STATUTS_COMMANDE) for (const vers of STATUTS_COMMANDE) assert.equal(transitionValide(de, vers), permises.has(`${de}>${vers}`), `${de} → ${vers}`)
  })

  test('jourParis réutilisé (relances) : jour à Paris, pas en UTC', () => {
    assert.equal(jourParis(new Date('2026-11-10T23:30:00Z')), '2026-11-11')
  })

  test('validerMenu garde indisponible (true seulement) et options valides ; refuse les options invalides', () => {
    const menu = validerMenu(MENU, AH, MIDI)
    const [pad, riz, bobun] = menu.categories[0].produits
    assert.deepEqual(pad.options, [{ nom: 'Supplément crevettes', prix: 250 }, { nom: 'Œuf', prix: 100 }])
    assert.equal(bobun.indisponible, true)
    assert.equal('indisponible' in riz || 'options' in riz, false)
    const unProduit = (p: Record<string, unknown>) => () => validerMenu({ categories: [{ nom: 'C', produits: [{ nom: 'P', prix: 100, ...p }] }] }, AH, MIDI)
    assert.equal('indisponible' in unProduit({ indisponible: false })().categories[0].produits[0], false)
    for (const p of [{ indisponible: 'oui' }, { options: 'x' }, { options: [{ nom: '', prix: 1 }] }, { options: [{ nom: 'A', prix: -1 }] }, { options: [{ nom: 'A', prix: 1.5 }] }, { options: [{ nom: 'A', prix: 1 }, { nom: 'a', prix: 2 }] }, { options: Array.from({ length: 11 }, (_, i) => ({ nom: `O${i}`, prix: 0 })) }]) {
      assert.throws(unProduit(p), undefined, JSON.stringify(p))
    }
  })

  test('commercePublic : commandeActive seulement si actif avec au moins une table, jamais les jetons', () => {
    const base = nouveauCommerce('Test', 'restaurant', '')
    assert.equal(base.commande, undefined, 'nouveau commerce : module absent')
    const fiche = (commande: Commerce['commande']) => commercePublic({ ...base, commande })
    assert.equal('commandeActive' in fiche(undefined), false)
    assert.equal('commandeActive' in fiche({ active: false, tables: [{ nom: 'T1', jeton: 'jeton-secret-aaaaaaaaaa' }] }), false)
    assert.equal('commandeActive' in fiche({ active: true, tables: [] }), false)
    const active = fiche({ active: true, tables: [{ nom: 'T1', jeton: 'jeton-secret-aaaaaaaaaa' }] })
    assert.equal(active.commandeActive, true)
    assert.doesNotMatch(JSON.stringify(active), /jeton-secret|"tables"/)
  })
})

describe('Commande à table : module server/commandes.ts (concurrence)', () => {
  const commande = (id: string, statut: StatutCommande = 'recue'): Commande => ({
    id, commerceId: AH, table: 'T1', lignes: [], total: 0, statut, creeLe: MIDI.toISOString(), majLe: MIDI.toISOString(), secret: `secret-${id}`,
  })
  /**
   * Stockage dont les `n` premières lectures `meta` répondent ensemble (valeur relue à l'arrivée, réponse retenue jusqu'à
   * la n-ième) : les deux opérations ont relu la même valeur avant que l'une écrive. Lectures suivantes : directes.
   */
  function avecBarriere(st: Stockage, n: number): Stockage {
    const attente: (() => void)[] = []
    let ouverte = false
    return {
      ...st,
      meta: async (cle: string) => {
        const v = await st.meta(cle)
        if (ouverte) return v
        await new Promise<void>((ok) => {
          attente.push(ok)
          if (attente.length === n) {
            ouverte = true
            attente.splice(0).forEach((f) => f())
          }
        })
        return v
      },
    }
  }

  test('deux transitions sur le même statut relu : une seule passe, l’autre ConflitCommande', async () => {
    const st = ouvrirStockage(':memory:')
    await creerCommande(st, commande('c1'), 'cle-c1-aaaa')
    const lent = avecBarriere(st, 2)
    const r = await Promise.allSettled([changerStatut(lent, AH, 'c1', 'acceptee', MIDI), changerStatut(lent, AH, 'c1', 'refusee', MIDI)])
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1, JSON.stringify(r))
    const echec = r.find((x) => x.status === 'rejected') as PromiseRejectedResult
    assert.ok(echec.reason instanceof ConflitCommande, String(echec.reason))
    const gagnant = (r.find((x) => x.status === 'fulfilled') as PromiseFulfilledResult<Commande>).value.statut
    assert.equal((await listerCommandes(st, AH, '2026-11-10'))[0].statut, gagnant)
    await assert.rejects(changerStatut(st, AH, 'c1', 'servie', MIDI), TransitionInvalide)
  })

  test('deux créations simultanées de commandes différentes : l’index du jour garde les deux (CAS + réessai)', async () => {
    const st = ouvrirStockage(':memory:')
    const lent = avecBarriere(st, 2)
    await Promise.all([creerCommande(lent, commande('a'), 'cle-a-aaaaaa'), creerCommande(lent, commande('b'), 'cle-b-aaaaaa')])
    assert.deepEqual(JSON.parse((await st.meta(cleIndexCommandes(AH, '2026-11-10')))!).sort(), ['a', 'b'])
  })

  test('même clé d’idempotence en simultané : une seule commande écrite, l’autre rend la première', async () => {
    const st = ouvrirStockage(':memory:')
    const r1 = await creerCommande(st, commande('x1'), 'cle-meme-aaaa')
    const r2 = await creerCommande(st, commande('x2'), 'cle-meme-aaaa')
    assert.equal(r1.doublon, false)
    assert.equal(r2.doublon, true)
    assert.equal(r2.commande.id, 'x1')
    assert.equal(await st.meta('commande:' + AH + ':x2'), undefined)
    assert.equal(await st.meta(cleIdempotence(AH, 'cle-meme-aaaa')), 'x1')
    assert.deepEqual(JSON.parse((await st.meta(cleIndexCommandes(AH, '2026-11-10')))!), ['x1'])
  })
})

describe('Commande à table : vrai serveur HTTP (SQLite)', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-commande-'))
  const fichierDb = join(dossier, 'commande.db')
  let app: Awaited<ReturnType<typeof creerServeur>>
  let base = ''
  let ip = 0
  let n = 0
  let B = ''
  const LIMITE_TEST = 30

  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.7.${Math.floor(++ip / 250)}.${ip % 250}`, ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    return { statut: r.status, contenu: await r.json() }
  }
  const etat = async (id = AH, pin = PIN) => (await api('GET', `/commerces/${id}/etat`, undefined, pin)).contenu.commerce as Commerce
  const fiche = async (id = AH) => (await api('GET', `/commerces/${id}`)).contenu.commerce as { commandeActive?: true }
  const cle = () => `cle-test-${++n}-aaaa`
  const jetonDe = async (nom: string, id = AH, pin = PIN) => (await etat(id, pin)).commande!.tables.find((t) => t.nom === nom)!.jeton
  async function commander(lignes: unknown, extra: Record<string, unknown> = {}, id = AH, table = 'Table 1', pin = PIN) {
    return api('POST', `/commerces/${id}/commandes`, { jetonTable: await jetonDe(table, id, pin), lignes, cleIdempotence: cle(), ...extra })
  }

  before(async () => {
    app = await creerServeur({ fichierDb, adminPin: '98765432', pinInitial: '1234', version: 'test', maintenant: () => MIDI, derriereProxy: true, limiteCommandesParIp: LIMITE_TEST })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
    const m = await api('PUT', `/commerces/${AH}/menu`, MENU, PIN)
    assert.equal(m.statut, 200, JSON.stringify(m.contenu))
    const b = await api('POST', '/commerces', { pin: '5678', nom: 'Commerce B', lienGoogle: '' }, ADMIN)
    assert.equal(b.statut, 201, JSON.stringify(b.contenu))
    B = b.contenu.commerce.id
    assert.equal(b.contenu.commerce.commande, undefined, 'nouveau commerce créé sans module commande')
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('module absent ou désactivé → 409 ; fiche publique sans commandeActive', async () => {
    assert.equal((await etat()).commande, undefined)
    const r = await api('POST', `/commerces/${AH}/commandes`, { jetonTable: 'x', lignes: [{ produitId: 'p-nems', quantite: 1 }], cleIdempotence: cle() })
    assert.equal(r.statut, 409)
    assert.equal(r.contenu.erreur, 'La commande en ligne n’est pas activée pour ce commerce.')
    assert.equal('commandeActive' in (await fiche()), false)
    // Désactivé avec des tables : même refus, même avec un vrai jeton.
    assert.equal((await api('PATCH', `/commerces/${AH}`, { commande: { active: false, tables: [{ nom: 'Table 1' }] } }, PIN)).statut, 200)
    const r2 = await commander([{ produitId: 'p-nems', quantite: 1 }])
    assert.equal(r2.statut, 409)
    assert.equal('commandeActive' in (await fiche()), false)
  })

  test('réglages : jetons générés à la sauvegarde, jamais régénérés, jamais choisis par le navigateur ; fiche publique', async () => {
    const avant = (await etat()).commande!
    const j1 = avant.tables[0].jeton
    assert.match(j1, /^[A-Za-z0-9_-]{16,}$/)
    const r = await api('PATCH', `/commerces/${AH}`, { commande: { active: true, tables: [{ nom: ' Table 1 ', jeton: j1 }, { nom: 'Terrasse' }, { nom: 'Bar', jeton: 'jeton-choisi-par-le-navigateur' }] } }, PIN)
    assert.equal(r.statut, 200, JSON.stringify(r.contenu))
    const tables = (await etat()).commande!.tables
    assert.deepEqual(tables.map((t) => t.nom), ['Table 1', 'Terrasse', 'Bar'])
    assert.equal(tables[0].jeton, j1, 'jeton existant conservé')
    for (const t of tables) assert.match(t.jeton, /^[A-Za-z0-9_-]{16,}$/)
    assert.notEqual(tables[2].jeton, 'jeton-choisi-par-le-navigateur')
    assert.equal(new Set(tables.map((t) => t.jeton)).size, 3)
    // Second enregistrement identique : aucun jeton ne change.
    assert.equal((await api('PATCH', `/commerces/${AH}`, { commande: { active: true, tables } }, PIN)).statut, 200)
    assert.deepEqual((await etat()).commande!.tables, tables)
    // Fiche publique : le drapeau seul, ni les tables ni les jetons.
    const f = await api('GET', `/commerces/${AH}`)
    assert.equal(f.contenu.commerce.commandeActive, true)
    for (const t of tables) assert.equal(JSON.stringify(f.contenu).includes(t.jeton), false)
    assert.equal(JSON.stringify((await api('GET', '/commerces')).contenu).includes(j1), false)
    assert.equal(JSON.stringify((await api('GET', `/commerces/${AH}/menu`)).contenu).includes(j1), false)
  })

  test('réglages : noms de tables en double, vides, trop longs, trop de tables, forme invalide → 400 sans rien écrire', async () => {
    const avant = (await etat()).commande
    for (const commande of [
      { active: true, tables: [{ nom: 'Table 1' }, { nom: ' table 1' }] },
      { active: true, tables: [{ nom: '   ' }] },
      { active: true, tables: [{ nom: 'x'.repeat(41) }] },
      { active: true, tables: Array.from({ length: TABLES_COMMANDE_MAX + 1 }, (_, i) => ({ nom: `T${i}` })) },
      { active: 'oui', tables: [] },
      { active: true },
      { active: true, tables: [], autre: 1 },
      'activée',
      null,
    ]) {
      const r = await api('PATCH', `/commerces/${AH}`, { commande }, PIN)
      assert.equal(r.statut, 400, JSON.stringify(commande).slice(0, 60))
    }
    assert.match((await api('PATCH', `/commerces/${AH}`, { commande: { active: true, tables: [{ nom: 'Table 1' }, { nom: 'TABLE 1' }] } }, PIN)).contenu.erreur, /en double/)
    assert.deepEqual((await etat()).commande, avant)
    // 50 tables : accepté (borne) ; puis retour aux tables de départ. Les jetons des tables supprimées entre-temps ne
    // sont plus connus du commerce : renvoyés par le navigateur, ils ne ressuscitent pas, de nouveaux sont tirés.
    assert.equal((await api('PATCH', `/commerces/${AH}`, { commande: { active: true, tables: Array.from({ length: TABLES_COMMANDE_MAX }, (_, i) => ({ nom: `T${i}` })) } }, PIN)).statut, 200)
    assert.equal((await api('PATCH', `/commerces/${AH}`, { commande: avant }, PIN)).statut, 200)
    const apres = (await etat()).commande!
    assert.deepEqual(apres.tables.map((t) => t.nom), avant!.tables.map((t) => t.nom))
    for (const [i, t] of apres.tables.entries()) assert.notEqual(t.jeton, avant!.tables[i].jeton)
    const ancien = await api('POST', `/commerces/${AH}/commandes`, { jetonTable: avant!.tables[0].jeton, lignes: [{ produitId: 'p-nems', quantite: 1 }], cleIdempotence: cle() })
    assert.equal(ancien.statut, 404, 'QR d’une table supprimée : plus valable')
  })

  test('jeton de table inconnu → 404 ; clé d’idempotence manquante → 400', async () => {
    const r = await api('POST', `/commerces/${AH}/commandes`, { jetonTable: 'jeton-inconnu-aaaaaaaaaa', lignes: [{ produitId: 'p-nems', quantite: 1 }], cleIdempotence: cle() })
    assert.equal(r.statut, 404)
    assert.match(r.contenu.erreur, /^Table introuvable/)
    assert.equal((await api('POST', `/commerces/${AH}/commandes`, { lignes: [{ produitId: 'p-nems', quantite: 1 }], cleIdempotence: cle() })).statut, 404)
    const sansCle = await api('POST', `/commerces/${AH}/commandes`, { jetonTable: await jetonDe('Table 1'), lignes: [{ produitId: 'p-nems', quantite: 1 }] })
    assert.equal(sansCle.statut, 400)
    assert.equal((await commander([{ produitId: 'p-nems', quantite: 1 }], { cleIdempotence: 'court' })).statut, 400)
  })

  test('prix envoyé par le client ignoré : total recalculé depuis le menu, commande « recue » avec un secret', async () => {
    const r = await commander([{ produitId: 'p-nems', quantite: 2, prix: 1, prixUnitaire: 1, nom: 'Gratuit' }], { total: 1, statut: 'servie', secret: 'choisi', instructions: ' Table près de la fenêtre ' })
    assert.equal(r.statut, 201, JSON.stringify(r.contenu))
    const c = r.contenu.commande as Commande
    assert.equal(c.total, 1300)
    assert.deepEqual(c.lignes, [{ produitId: 'p-nems', nom: 'Nems', prixUnitaire: 650, quantite: 2, options: [] }])
    assert.equal(c.statut, 'recue')
    assert.equal(c.table, 'Table 1')
    assert.equal(c.commerceId, AH)
    assert.equal(c.instructions, 'Table près de la fenêtre')
    assert.equal(c.creeLe, MIDI.toISOString())
    assert.equal('secret' in c, false, 'la commande renvoyée ne porte pas son secret')
    assert.match(r.contenu.secret, /^[A-Za-z0-9_-]{32}$/)
    assert.notEqual(r.contenu.secret, 'choisi')
  })

  test('refus : prix null, indisponible, option inconnue, quantités 0 et 21, panier vide, instructions trop longues → 400', async () => {
    const cas: [unknown, Record<string, unknown>, RegExp][] = [
      [[{ produitId: 'p-riz', quantite: 1 }], {}, /Riz Thaï/],
      [[{ produitId: 'p-bobun', quantite: 1 }], {}, /Bo Bun.*plus disponible/],
      [[{ produitId: 'p-pad', quantite: 1, options: ['Fromage'] }], {}, /option non proposée/],
      [[{ produitId: 'p-nems', quantite: 0 }], {}, /entre 1 et 20/],
      [[{ produitId: 'p-nems', quantite: 21 }], {}, /entre 1 et 20/],
      [[], {}, /panier est vide/],
      [[{ produitId: 'p-inconnu', quantite: 1 }], {}, /plus à la carte/],
      [[{ produitId: 'p-nems', quantite: 1 }], { instructions: 'x'.repeat(301) }, /300 caractères/],
    ]
    for (const [lignes, extra, message] of cas) {
      const r = await commander(lignes, extra)
      assert.equal(r.statut, 400, JSON.stringify(lignes))
      assert.match(r.contenu.erreur, message)
    }
  })

  test('option valide : le supplément entre dans le total', async () => {
    const r = await commander([{ produitId: 'p-pad', quantite: 2, options: ['Supplément crevettes'] }])
    assert.equal(r.statut, 201, JSON.stringify(r.contenu))
    assert.equal(r.contenu.commande.total, (1290 + 250) * 2)
    assert.deepEqual(r.contenu.commande.lignes[0].options, [{ nom: 'Supplément crevettes', prix: 250 }])
  })

  test('doublon de clé d’idempotence : même commande, une seule entrée d’index, pas de second secret', async () => {
    const jeton = await jetonDe('Terrasse')
    const corps = { jetonTable: jeton, lignes: [{ produitId: 'p-nems', quantite: 1 }], cleIdempotence: 'cle-doublon-aaaa' }
    const r1 = await api('POST', `/commerces/${AH}/commandes`, corps)
    assert.equal(r1.statut, 201)
    const r2 = await api('POST', `/commerces/${AH}/commandes`, { ...corps, lignes: [{ produitId: 'p-nems', quantite: 5 }] })
    assert.equal(r2.statut, 200)
    assert.equal(r2.contenu.doublon, true)
    assert.equal(r2.contenu.commande.id, r1.contenu.commande.id)
    assert.equal(r2.contenu.commande.total, 650, 'la commande d’origine, pas le second panier')
    assert.equal('secret' in r2.contenu, false)
    assert.equal('secret' in r2.contenu.commande, false)
    // Renvoi du même panier alors qu'il ne passerait plus (panier vide ici, plat passé en rupture en vrai) : la
    // commande déjà reçue, pas un refus — le client ne doit pas croire qu'elle n'est pas partie.
    const r3 = await api('POST', `/commerces/${AH}/commandes`, { ...corps, lignes: [] })
    assert.equal(r3.statut, 200, JSON.stringify(r3.contenu))
    assert.equal(r3.contenu.commande.id, r1.contenu.commande.id)
    assert.equal('secret' in r3.contenu, false)
    const liste = (await api('GET', `/commerces/${AH}/commandes`, undefined, PIN)).contenu.commandes as Commande[]
    assert.equal(liste.filter((c) => c.id === r1.contenu.commande.id).length, 1)
  })

  test('lecture publique : sans secret ou secret faux → 404, avec secret (en-tête ou paramètre) → 200 sans le champ secret', async () => {
    const r = await commander([{ produitId: 'p-nems', quantite: 1 }])
    const { id } = r.contenu.commande
    const secret = r.contenu.secret as string
    assert.equal((await api('GET', `/commerces/${AH}/commandes/${id}`)).statut, 404)
    assert.equal((await api('GET', `/commerces/${AH}/commandes/${id}`, undefined, { 'X-Secret-Commande': secret.slice(1) })).statut, 404)
    assert.equal((await api('GET', `/commerces/${AH}/commandes/${id}?secret=${'x'.repeat(32)}`)).statut, 404)
    const inexistante = await api('GET', `/commerces/${AH}/commandes/inexistante`, undefined, { 'X-Secret-Commande': secret })
    assert.equal(inexistante.statut, 404)
    assert.equal(inexistante.contenu.erreur, (await api('GET', `/commerces/${AH}/commandes/${id}`)).contenu.erreur, 'même refus : aucun oracle')
    for (const lu of [
      await api('GET', `/commerces/${AH}/commandes/${id}`, undefined, { 'X-Secret-Commande': secret }),
      await api('GET', `/commerces/${AH}/commandes/${id}?secret=${encodeURIComponent(secret)}`),
    ]) {
      assert.equal(lu.statut, 200)
      assert.equal(lu.contenu.commande.id, id)
      assert.equal('secret' in lu.contenu.commande, false)
      assert.equal(JSON.stringify(lu.contenu).includes(secret), false)
    }
  })

  test('liste commerçant : session exigée, jour de Paris par défaut, sans secrets, triée par création', async () => {
    assert.equal((await api('GET', `/commerces/${AH}/commandes`)).statut, 401)
    assert.equal((await api('GET', `/commerces/${AH}/commandes`, undefined, { 'X-Commerce-PIN': '0000' })).statut >= 400, true)
    const r = await api('GET', `/commerces/${AH}/commandes`, undefined, PIN)
    assert.equal(r.statut, 200)
    assert.equal(r.contenu.jour, '2026-11-10')
    const commandes = r.contenu.commandes as Commande[]
    assert.ok(commandes.length >= 4)
    for (const c of commandes) assert.equal('secret' in c, false)
    const dates = commandes.map((c) => c.creeLe)
    assert.deepEqual(dates, [...dates].sort())
    assert.deepEqual((await api('GET', `/commerces/${AH}/commandes?jour=2026-11-09`, undefined, PIN)).contenu.commandes, [])
    assert.equal((await api('GET', `/commerces/${AH}/commandes?jour=hier`, undefined, PIN)).statut, 400)
  })

  test('transitions : chemin complet OK, recue → servie refusé, refusee terminal, statut inconnu refusé, PIN exigé', async () => {
    const statut = (id: string, vers: unknown, entetes: Record<string, string> = PIN) => api('POST', `/commerces/${AH}/commandes/${id}/statut`, { vers }, entetes)
    const a = (await commander([{ produitId: 'p-nems', quantite: 1 }])).contenu.commande.id
    assert.equal((await statut(a, 'acceptee', {})).statut, 401)
    assert.equal((await statut(a, 'servie')).statut, 400, 'recue → servie')
    assert.equal((await statut(a, 'livree')).statut, 400)
    for (const vers of ['acceptee', 'en_preparation', 'servie']) {
      const r = await statut(a, vers)
      assert.equal(r.statut, 200, `${vers} : ${JSON.stringify(r.contenu)}`)
      assert.equal(r.contenu.commande.statut, vers)
      assert.equal('secret' in r.contenu.commande, false)
    }
    assert.equal((await statut(a, 'acceptee')).statut, 400, 'servie est terminal')
    const b = (await commander([{ produitId: 'p-nems', quantite: 1 }])).contenu.commande.id
    assert.equal((await statut(b, 'refusee')).statut, 200)
    for (const vers of ['acceptee', 'en_preparation', 'servie', 'recue']) assert.equal((await statut(b, vers)).statut, 400, `refusee → ${vers}`)
    assert.equal((await statut('inexistante', 'acceptee')).statut, 404)
  })

  test('conflit à l’écriture conditionnelle (valeur changée entre lecture et écriture) → 409, rien d’écrit', async () => {
    const r = await commander([{ produitId: 'p-nems', quantite: 1 }])
    const { id } = r.contenu.commande
    const cleMeta = `commande:${AH}:${id}`
    const db = new DatabaseSync(fichierDb)
    try {
      db.exec(`CREATE TRIGGER perdre_course BEFORE UPDATE ON meta WHEN OLD.cle = '${cleMeta}' BEGIN SELECT RAISE(IGNORE); END`)
      const c = await api('POST', `/commerces/${AH}/commandes/${id}/statut`, { vers: 'acceptee' }, PIN)
      assert.equal(c.statut, 409, JSON.stringify(c.contenu))
      db.exec('DROP TRIGGER perdre_course')
    } finally {
      db.close()
    }
    const lu = await api('GET', `/commerces/${AH}/commandes/${id}`, undefined, { 'X-Secret-Commande': r.contenu.secret })
    assert.equal(lu.contenu.commande.statut, 'recue')
    assert.equal((await api('POST', `/commerces/${AH}/commandes/${id}/statut`, { vers: 'acceptee' }, PIN)).statut, 200)
  })

  test('isolation : la commande du commerce A est introuvable depuis le commerce B (public et commerçant)', async () => {
    const PIN_B = { 'X-Commerce-PIN': '5678' }
    assert.equal((await api('PATCH', `/commerces/${B}`, { commande: { active: true, tables: [{ nom: 'Table 1' }] } }, PIN_B)).statut, 200)
    const r = await commander([{ produitId: 'p-nems', quantite: 1 }])
    const { id } = r.contenu.commande
    const secret = r.contenu.secret as string
    // Public : même secret, commerce B → 404.
    assert.equal((await api('GET', `/commerces/${B}/commandes/${id}`, undefined, { 'X-Secret-Commande': secret })).statut, 404)
    // Commerçant B : absente de sa liste, transition → 404, statut inchangé chez A.
    const listeB = (await api('GET', `/commerces/${B}/commandes`, undefined, PIN_B)).contenu.commandes as Commande[]
    assert.equal(listeB.some((c) => c.id === id), false)
    assert.equal((await api('POST', `/commerces/${B}/commandes/${id}/statut`, { vers: 'acceptee' }, PIN_B)).statut, 404)
    // PIN de B sur les commandes de A : refusé.
    assert.ok((await api('GET', `/commerces/${AH}/commandes`, undefined, PIN_B)).statut >= 400)
    assert.ok((await api('POST', `/commerces/${AH}/commandes/${id}/statut`, { vers: 'acceptee' }, PIN_B)).statut >= 400)
    assert.equal((await api('GET', `/commerces/${AH}/commandes/${id}`, undefined, { 'X-Secret-Commande': secret })).contenu.commande.statut, 'recue')
    // Le jeton d'une table de A ne vaut rien chez B (le menu de B est vide de toute façon : 404 avant le panier).
    const chezB = await api('POST', `/commerces/${B}/commandes`, { jetonTable: await jetonDe('Table 1'), lignes: [{ produitId: 'p-nems', quantite: 1 }], cleIdempotence: cle() })
    assert.equal(chezB.statut, 404)
    // Même clé d'idempotence dans deux commerces : deux commandes distinctes (les clés sont rangées par commerce).
    await api('PUT', `/commerces/${B}/menu`, MENU, PIN_B)
    const commune = 'cle-commune-aaaa'
    const rA = await api('POST', `/commerces/${AH}/commandes`, { jetonTable: await jetonDe('Table 1'), lignes: [{ produitId: 'p-nems', quantite: 1 }], cleIdempotence: commune })
    const rB = await api('POST', `/commerces/${B}/commandes`, { jetonTable: await jetonDe('Table 1', B, PIN_B), lignes: [{ produitId: 'p-nems', quantite: 1 }], cleIdempotence: commune })
    assert.equal(rA.statut, 201)
    assert.equal(rB.statut, 201)
    assert.notEqual(rA.contenu.commande.id, rB.contenu.commande.id)
    assert.equal(rB.contenu.commande.commerceId, B)
  })

  test(`limite par IP : ${LIMITE_COMMANDES_PAR_IP} commandes / min par défaut, 429 au-delà (seuil injecté en test)`, async () => {
    assert.equal(LIMITE_COMMANDES_PAR_IP, 10)
    const ipFixe = { 'X-Forwarded-For': '10.99.0.1' }
    const corps = { jetonTable: 'x', lignes: [], cleIdempotence: cle() }
    for (let i = 0; i < LIMITE_TEST; i++) assert.notEqual((await api('POST', `/commerces/${AH}/commandes`, corps, ipFixe)).statut, 429, `requête ${i + 1}`)
    const r = await api('POST', `/commerces/${AH}/commandes`, corps, ipFixe)
    assert.equal(r.statut, 429)
    // Une autre IP n'est pas touchée.
    assert.notEqual((await api('POST', `/commerces/${AH}/commandes`, corps)).statut, 429)
  })

  test('CORS : l’en-tête X-Secret-Commande est autorisé', async () => {
    const r = await fetch(base + `/commerces/${AH}/commandes/x`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' } })
    assert.match(r.headers.get('access-control-allow-headers') ?? '', /X-Secret-Commande/)
  })
})

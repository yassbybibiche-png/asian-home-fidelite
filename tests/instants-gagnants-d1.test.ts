// Roue v2 D1 — Instants gagnants : N instants par jour tirés dans les plages d'ouverture, générés paresseusement et
// persistés par le serveur (table `meta`) ; le 1er tirage dans les 5 minutes qui suivent un instant gagne son lot, sauf
// plafond / limite (instant consommé quand même, tirage normal). Jamais d'instant futur dans une réponse. Logique pure,
// puis vrai serveur HTTP sur SQLite temporaire (horloge et hasard du tirage injectés).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import {
  cleInstants,
  FENETRE_INSTANT_MS,
  genererInstants,
  INSTANTS_JOUR_MAX,
  instantEnCours,
  instantsPasses,
  PLAGES_OUVERTURE_DEFAUT,
  plagesOuverture,
  problemePlages,
  statutInstant,
  unionPlages,
} from '../src/lib/instants.ts'
import { aDesInstants, texteInstant } from '../src/lib/instantsTableau.ts'
import { lotPourEnvoi, problemeLot } from '../src/lib/reglagesRoue.ts'
import { instantParis } from '../src/lib/roulette.ts'
import type { Commerce, InstantsDuJour, Lot } from '../src/types.ts'

const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')
const JOUR = '2026-11-10'
/** Instant à Paris le 10/11/2026 (heure d'hiver, UTC+1). */
const paris = (h: number, m = 0, s = 0) => new Date(instantParis(2026, 11, 10, h, m).getTime() + s * 1000)
const heureParis = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso))

/** Hasard déterministe pour la génération (suite congruentielle), entier dans [0, n[. */
function hasardFixe(graine = 7) {
  let x = graine
  return (n: number) => {
    x = (x * 1103515245 + 12345) % 2 ** 31
    return x % n
  }
}

describe('D1 : logique pure (src/lib/instants.ts)', () => {
  const lots = [
    { id: 'lot-the', type: 'lot' as const, libelle: 'Thé glacé', instantsParJour: 3 },
    { id: 'lot-nems', type: 'lot' as const, libelle: 'Nems' },
    { id: 'lot-pts', type: 'points' as const, libelle: '+10 points', instantsParJour: 4 },
  ]

  test('plages : défaut = les deux services d’Asian Home ; liste vide explicite = aucune ; validation HH:MM, début < fin, 6 au plus', () => {
    assert.deepEqual(PLAGES_OUVERTURE_DEFAUT, [{ debut: '11:30', fin: '14:30' }, { debut: '18:30', fin: '23:30' }])
    assert.deepEqual(plagesOuverture({}), [...PLAGES_OUVERTURE_DEFAUT])
    assert.deepEqual(plagesOuverture({ plagesOuverture: [] }), [])
    assert.equal(problemePlages([{ debut: '11:30', fin: '14:30' }]), null)
    assert.equal(problemePlages([]), null)
    for (const mauvais of [
      'x', [{ debut: '11h30', fin: '14:30' }], [{ debut: '24:00', fin: '23:00' }], [{ debut: '14:30', fin: '11:30' }],
      [{ debut: '12:00', fin: '12:00' }], [{ debut: '22:00', fin: '01:00' }], [{ debut: '11:30' }], Array(7).fill({ debut: '10:00', fin: '11:00' }),
    ]) {
      assert.ok(problemePlages(mauvais), JSON.stringify(mauvais))
    }
    assert.deepEqual(unionPlages([{ debut: '18:00', fin: '20:00' }, { debut: '11:00', fin: '12:00' }, { debut: '19:00', fin: '21:00' }]), [[660, 720], [1080, 1260]])
  })

  test('génération : nombre exact par lot à instants, lots physiques seulement, tous dans la plage, triés, ids uniques', () => {
    const d = genererInstants(lots, [...PLAGES_OUVERTURE_DEFAUT], JOUR, hasardFixe())
    assert.equal(d.jour, JOUR)
    assert.equal(d.instants.length, 3, 'exactement 3 pour le Thé glacé ; aucun pour Nems (0) ni pour les points')
    assert.ok(d.instants.every((i) => i.lotId === 'lot-the' && i.lot === 'Thé glacé' && !i.consommePar))
    assert.equal(new Set(d.instants.map((i) => i.id)).size, 3)
    assert.deepEqual(d.instants.map((i) => i.heure), [...d.instants.map((i) => i.heure)].sort())
    // Beaucoup d'instants, hasard varié : tous dans 11:30–14:30 ou 18:30–23:30, heure de Paris, et les deux plages servies.
    const nombreux = genererInstants([{ ...lots[0], instantsParJour: INSTANTS_JOUR_MAX }, { id: 'b', type: 'lot', libelle: 'B', instantsParJour: 20 }], [...PLAGES_OUVERTURE_DEFAUT], JOUR, hasardFixe(42))
    assert.equal(nombreux.instants.length, 40)
    for (const i of nombreux.instants) {
      const h = heureParis(i.heure)
      assert.ok((h >= '11:30:00' && h < '14:30:00') || (h >= '18:30:00' && h < '23:30:00'), `${h} hors des plages`)
      assert.ok(i.heure.startsWith('2026-11-10'), i.heure)
    }
    assert.ok(nombreux.instants.some((i) => heureParis(i.heure) < '15:00') && nombreux.instants.some((i) => heureParis(i.heure) > '18:00'))
    // Bornes exactes : hasard 0 → début de la 1re plage ; hasard max → dernière seconde de la dernière.
    assert.equal(heureParis(genererInstants([lots[0]], [...PLAGES_OUVERTURE_DEFAUT], JOUR, () => 0).instants[0].heure), '11:30:00')
    assert.equal(heureParis(genererInstants([lots[0]], [...PLAGES_OUVERTURE_DEFAUT], JOUR, (n) => n - 1).instants[0].heure), '23:29:59')
    assert.equal(heureParis(genererInstants([lots[0]], [...PLAGES_OUVERTURE_DEFAUT], JOUR, () => 3 * 3600).instants[0].heure), '18:30:00', '1re seconde de la 2e plage')
    // Aucune plage : aucun instant. Jour d'été (UTC+2) : heure de Paris respectée.
    assert.equal(genererInstants(lots, [], JOUR, hasardFixe()).instants.length, 0)
    assert.equal(heureParis(genererInstants([lots[0]], [{ debut: '12:00', fin: '12:01' }], '2026-07-14', () => 0).instants[0].heure), '12:00:00')
    assert.equal(cleInstants(AH, JOUR), `instants:${AH}:${JOUR}`)
  })

  test('fenêtre de 5 minutes : avant → rien ; de l’heure à +4:59 → l’instant ; à +5:00 → rien ; consommé → rien', () => {
    const d: InstantsDuJour = { jour: JOUR, instants: [{ id: 'a', heure: paris(12).toISOString(), lotId: 'lot-the', lot: 'Thé glacé' }] }
    assert.equal(FENETRE_INSTANT_MS, 5 * 60 * 1000)
    assert.equal(instantEnCours(d, paris(11, 59, 59)), undefined)
    assert.equal(instantEnCours(d, paris(12))?.id, 'a')
    assert.equal(instantEnCours(d, paris(12, 4, 59))?.id, 'a')
    assert.equal(instantEnCours(d, paris(12, 5)), undefined)
    assert.equal(instantEnCours({ ...d, instants: [{ ...d.instants[0], consommePar: 'ti-x' }] }, paris(12, 1)), undefined)
    assert.deepEqual(instantsPasses(d, paris(11, 59)), [], 'un instant futur n’est jamais « passé »')
    assert.equal(instantsPasses(d, paris(12)).length, 1)
    assert.equal(statutInstant(d.instants[0], paris(12, 1)), 'enCours')
    assert.equal(statutInstant(d.instants[0], paris(12, 6)), 'sansGagnant')
    assert.equal(statutInstant({ ...d.instants[0], consommePar: 't', gagne: true }, paris(12, 6)), 'gagne')
    assert.equal(statutInstant({ ...d.instants[0], consommePar: 't', gagne: false }, paris(12, 6)), 'bloque')
  })

  test('tableau de bord et Réglages : textes, détection, validation et envoi du nombre d’instants', () => {
    const heure = paris(12, 4).toISOString()
    assert.equal(texteInstant({ heure, lot: 'Thé glacé', statut: 'gagne', gagnant: 'Lin' }), 'Instant 12:04 — gagné (Thé glacé) par Lin')
    assert.equal(texteInstant({ heure: paris(19, 37).toISOString(), lot: 'Thé glacé', statut: 'sansGagnant' }), 'Instant 19:37 — passé sans gagnant (Thé glacé)')
    assert.match(texteInstant({ heure, lot: 'Thé glacé', statut: 'bloque' }), /plafond du jour/)
    assert.ok(aDesInstants([{ type: 'lot', instantsParJour: 1 }]))
    assert.ok(!aDesInstants([{ type: 'lot', instantsParJour: 0 }, { type: 'points', instantsParJour: 2 }]))
    assert.equal(problemeLot({ type: 'lot', instantsParJour: 2 }), null)
    assert.match(problemeLot({ type: 'lot', instantsParJour: 21 }) ?? '', /instants gagnants/)
    assert.match(problemeLot({ type: 'lot', instantsParJour: 1.5 }) ?? '', /instants gagnants/)
    assert.equal(problemeLot({ type: 'points', points: 10, instantsParJour: 99 }), null, 'ignoré hors lot physique')
    const base: Lot = { id: 'l', type: 'lot', libelle: 'Thé', probabilite: 10 }
    assert.equal(lotPourEnvoi({ ...base, instantsParJour: 3 }).instantsParJour, 3)
    assert.equal('instantsParJour' in lotPourEnvoi({ ...base, instantsParJour: 0 }), false, '0 = désactivé, rien d’écrit')
    assert.equal('instantsParJour' in lotPourEnvoi({ ...base, type: 'points', points: 5, instantsParJour: 3 }), false)
  })

  test('sources : Réglages (case + nombre par lot, plages), store (envoi des plages), tableau de bord (route dédiée)', () => {
    const reglages = lire('src/pages/Reglages.tsx')
    assert.match(reglages, /id=\{`instants-\$\{i\}`\}/)
    assert.match(reglages, /Instant gagnant/)
    assert.match(reglages, /max=\{INSTANTS_JOUR_MAX\}/)
    assert.match(reglages, /const erreurPlages = problemePlages\(plages\)/)
    assert.match(reglages, /&& !erreurPlages/)
    assert.match(lire('src/store.tsx'), /\n\s+plagesOuverture: c\.plagesOuverture,\n/)
    assert.match(lire('src/pages/TableauDeBord.tsx'), /<InstantsGagnants \/>/)
    assert.match(lire('src/components/InstantsGagnants.tsx'), /\/instants-gagnants`/)
  })
})

describe('D1 : serveur (SQLite) — génération paresseuse, fenêtre, consommation unique, plafond, aucune fuite', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-d1-'))
  const fichierDb = join(dossier, 'd1.db')
  let app: Awaited<ReturnType<typeof creerServeur>>
  let base = ''
  let n = 0
  let ip = 0
  let horloge = paris(8)
  // 0,99 : le tirage pondéré donne toujours le DERNIER lot (Nems) — seul un instant peut donner le Thé glacé.
  const hasard = 0.99

  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.1.${Math.floor(++ip / 250)}.${ip % 250}`, ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    return { statut: r.status, contenu: await r.json(), brut: '' }
  }
  async function brut(chemin: string, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, { headers: { 'X-Forwarded-For': `10.2.${Math.floor(++ip / 250)}.${ip % 250}`, ...entetes } })
    return r.text()
  }
  const patch = async (corps: object) => {
    const r = await api('PATCH', `/commerces/${AH}`, corps, PIN)
    assert.equal(r.statut, 200, JSON.stringify(r.contenu))
    return r.contenu.commerce as Commerce
  }
  const nouveauContact = () => `06${String(30_000_000 + ++n).padStart(8, '0')}`
  const tirer = (contact = nouveauContact()) => api('POST', `/commerces/${AH}/tirages`, { contact, prenom: `Joueur${contact.slice(-3)}` })
  const instantsTableau = async () => {
    const r = await api('GET', `/commerces/${AH}/instants-gagnants`, undefined, PIN)
    assert.equal(r.statut, 200, JSON.stringify(r.contenu))
    return r.contenu.instants as { heure: string; lot: string; statut: string; gagnant?: string }[]
  }
  function sql<T>(f: (db: DatabaseSync) => T): T {
    const db = new DatabaseSync(fichierDb)
    try {
      return f(db)
    } finally {
      db.close()
    }
  }
  const lireInstants = () => {
    const l = sql((db) => db.prepare('SELECT valeur FROM meta WHERE cle = ?').get(cleInstants(AH, JOUR))) as { valeur: string } | undefined
    return l ? (JSON.parse(l.valeur) as InstantsDuJour) : undefined
  }
  /** Instants du jour posés directement en base (heures maîtrisées) : la génération a été testée à part. */
  const poserInstants = (heures: Date[]) =>
    sql((db) =>
      db.prepare('UPDATE meta SET valeur = ? WHERE cle = ?').run(
        JSON.stringify({ jour: JOUR, instants: heures.map((h, i) => ({ id: `ig-test-${i}`, heure: h.toISOString(), lotId: 'lot-the', lot: 'Thé glacé' })) }),
        cleInstants(AH, JOUR),
      ),
    )

  before(async () => {
    app = await creerServeur({ fichierDb, adminPin: '98765432', pinInitial: '1234', version: 'test', maintenant: () => horloge, alea: () => hasard, derriereProxy: true })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('réglages : instantsParJour (lot physique, 0 à 20) et plagesOuverture validés ; rien d’écrit en cas de refus', async () => {
    const avant = (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.commerce as Commerce
    assert.equal(avant.plagesOuverture, undefined, 'Asian Home : défaut (les deux services), rien d’écrit')
    for (const corps of [
      { lots: [{ type: 'lot', libelle: 'Thé glacé', probabilite: 10, instantsParJour: 21 }, { type: 'lot', libelle: 'Nems', probabilite: 90 }] },
      { lots: [{ type: 'lot', libelle: 'Thé glacé', probabilite: 10, instantsParJour: -1 }, { type: 'lot', libelle: 'Nems', probabilite: 90 }] },
      { lots: [{ type: 'lot', libelle: 'Thé glacé', probabilite: 10, instantsParJour: '2' }, { type: 'lot', libelle: 'Nems', probabilite: 90 }] },
      { plagesOuverture: [{ debut: '14:30', fin: '11:30' }] },
      { plagesOuverture: 'midi' },
    ]) {
      const r = await api('PATCH', `/commerces/${AH}`, corps, PIN)
      assert.equal(r.statut, 400, JSON.stringify(corps))
    }
    assert.deepEqual((await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.commerce, avant)
    const c = await patch({
      modeAccesRoue: 'libre',
      limiteGainsMois: 0,
      plagesOuverture: [{ debut: '11:30', fin: '14:30' }, { debut: '18:30', fin: '23:30', ignore: 'x' }],
      lots: [
        { id: 'lot-the', type: 'lot', libelle: 'Thé glacé', probabilite: 10, instantsParJour: 2 },
        { id: 'lot-nems', type: 'lot', libelle: 'Nems', probabilite: 90 },
        { id: 'lot-pts', type: 'points', points: 10, libelle: '+10 points', probabilite: 0, instantsParJour: 3 },
      ],
    })
    assert.deepEqual(c.plagesOuverture, [{ debut: '11:30', fin: '14:30' }, { debut: '18:30', fin: '23:30' }])
    assert.deepEqual(c.lots.map((l) => [l.id, l.instantsParJour ?? null]), [['lot-the', 2], ['lot-nems', null], ['lot-pts', null]], 'jamais sur une consolation')
  })

  test('génération paresseuse à la 1re utilisation du jour : 2 instants persistés dans la plage, stables ensuite', async () => {
    assert.equal(lireInstants(), undefined, 'rien avant la 1re utilisation')
    horloge = paris(8)
    assert.deepEqual(await instantsTableau(), [], 'ouverture du tableau de bord à 8 h : générés, aucun passé')
    const d = lireInstants()!
    assert.equal(d.instants.length, 2)
    for (const i of d.instants) {
      const h = heureParis(i.heure)
      assert.ok((h >= '11:30:00' && h < '14:30:00') || (h >= '18:30:00' && h < '23:30:00'), h)
      assert.equal(i.lotId, 'lot-the')
    }
    // Un tirage (hors fenêtre) ne régénère rien.
    assert.equal((await tirer()).statut, 201)
    assert.deepEqual(lireInstants(), d)
  })

  test('fenêtre : 1 min avant → tirage normal ; +6 min → normal ; dedans → le lot de l’instant, consommé une seule fois', async () => {
    poserInstants([paris(12), paris(19)])
    horloge = paris(11, 59)
    assert.equal((await tirer()).contenu.lot, 'Nems', 'avant l’heure')
    horloge = paris(12, 6)
    assert.equal((await tirer()).contenu.lot, 'Nems', 'plus de 5 minutes après')
    assert.equal(lireInstants()!.instants[0].consommePar, undefined, 'instant de 12 h passé sans gagnant')
    horloge = paris(19, 2)
    const gagnant = await tirer()
    assert.equal(gagnant.statut, 201)
    assert.equal(gagnant.contenu.lot, 'Thé glacé')
    assert.equal(gagnant.contenu.lotId, 'lot-the')
    assert.equal(gagnant.contenu.perdant, false)
    const i = lireInstants()!.instants[1]
    assert.equal(i.consommePar, gagnant.contenu.tirageId)
    assert.equal(i.gagne, true)
    horloge = paris(19, 3)
    assert.equal((await tirer()).contenu.lot, 'Nems', 'déjà consommé : tirage normal')
    const tableau = await instantsTableau()
    assert.deepEqual(tableau.map((x) => [heureParis(x.heure), x.statut]), [['12:00:00', 'sansGagnant'], ['19:00:00', 'gagne']])
    assert.match(tableau[1].gagnant ?? '', /^Joueur\d{3}$/, 'prénom du gagnant')
    assert.equal(tableau[0].gagnant, undefined)
  })

  test('double tirage simultané de deux clients dans la fenêtre : un seul gagne l’instant', async () => {
    poserInstants([paris(20)])
    horloge = paris(20, 1)
    const r = await Promise.all([tirer(), tirer(), tirer()])
    assert.ok(r.every((x) => x.statut === 201), JSON.stringify(r.map((x) => x.contenu)))
    assert.deepEqual(r.map((x) => x.contenu.lot).sort(), ['Nems', 'Nems', 'Thé glacé'])
    const i = lireInstants()!.instants[0]
    assert.equal(i.consommePar, r.find((x) => x.contenu.lot === 'Thé glacé')!.contenu.tirageId)
  })

  test('tirage qui échoue après la consommation : l’instant redevient gagnable', async () => {
    poserInstants([paris(20, 30)])
    horloge = paris(20, 31)
    sql((db) => db.exec("CREATE TRIGGER d1_panne BEFORE INSERT ON tirages BEGIN SELECT RAISE(ABORT, 'panne simulée'); END"))
    try {
      assert.equal((await tirer()).statut, 500)
    } finally {
      sql((db) => db.exec('DROP TRIGGER d1_panne'))
    }
    assert.equal(lireInstants()!.instants[0].consommePar, undefined)
    assert.equal((await tirer()).contenu.lot, 'Thé glacé')
  })

  test('le plafond prime : lot au plafond du jour → instant consommé (gagne: false), le client a le tirage normal', async () => {
    // Le Thé glacé est déjà sorti aujourd'hui (instants précédents) : plafond 1 → plafonné.
    await patch({
      lots: [
        { id: 'lot-the', type: 'lot', libelle: 'Thé glacé', probabilite: 10, instantsParJour: 2, plafondJour: 1 },
        { id: 'lot-nems', type: 'lot', libelle: 'Nems', probabilite: 90 },
      ],
    })
    poserInstants([paris(21)])
    horloge = paris(21, 2)
    const r = await tirer()
    assert.equal(r.contenu.lot, 'Nems')
    const i = lireInstants()!.instants[0]
    assert.equal(i.consommePar, r.contenu.tirageId, 'consommé par ce tirage')
    assert.equal(i.gagne, false)
    assert.deepEqual((await instantsTableau()).map((x) => x.statut), ['bloque'])
    // Limite mensuelle du client atteinte : même règle (plafond retiré, limite 1, client qui a déjà gagné un lot hier).
    await patch({
      limiteGainsMois: 1,
      lots: [
        { id: 'lot-the', type: 'lot', libelle: 'Thé glacé', probabilite: 10, instantsParJour: 2 },
        { id: 'lot-p', type: 'points', points: 5, libelle: '+5 points', probabilite: 90 },
      ],
    })
    const contact = nouveauContact()
    horloge = paris(9)
    const premier = await tirer(contact)
    assert.equal(premier.statut, 201)
    const clientId = ((await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.tirages as { id: string; clientId: string }[]).find((t) => t.id === premier.contenu.tirageId)!.clientId
    // Ce tirage du matin devient un lot physique gagné hier → limite 1 atteinte, et le client peut rejouer aujourd'hui.
    const hier = new Date(paris(9).getTime() - 86_400_000).toISOString()
    sql((db) => db.prepare('DELETE FROM tirages WHERE id = ?').run(premier.contenu.tirageId))
    sql((db) =>
      db.prepare('INSERT INTO tirages (id, commerce_id, client_id, date, donnees) VALUES (?, ?, ?, ?, ?)').run(
        'ti-hier-d1', AH, clientId, hier,
        JSON.stringify({ id: 'ti-hier-d1', commerceId: AH, clientId, lot: 'Thé glacé', lotId: 'lot-the', typeLot: 'lot', date: hier, code: 'ABCDEF' }),
      ),
    )
    poserInstants([paris(21, 30)])
    horloge = paris(21, 31)
    const limite = await tirer(contact)
    assert.equal(limite.statut, 201, JSON.stringify(limite.contenu))
    assert.equal(limite.contenu.lot, '+5 points', 'limite atteinte : consolation, pas le lot de l’instant')
    assert.equal(lireInstants()!.instants[0].gagne, false)
  })

  test('aucune fuite : vue publique, carte client, règlement, état commerçant sans instant futur ; révélé seulement une fois passé', async () => {
    await patch({ limiteGainsMois: 0, lots: [{ id: 'lot-the', type: 'lot', libelle: 'Thé glacé', probabilite: 10, instantsParJour: 2 }, { id: 'lot-nems', type: 'lot', libelle: 'Nems', probabilite: 90 }] })
    const futur = paris(22, 17, 41)
    poserInstants([futur])
    horloge = paris(22)
    const contact = nouveauContact()
    const joue = await tirer(contact)
    assert.equal(joue.contenu.lot, 'Nems')
    const marques = [futur.toISOString(), 'ig-test-0', 'instants:', '22:17', String(futur.getTime())]
    const reponses = {
      publique: await brut(`/commerces/${AH}`),
      liste: await brut('/commerces'),
      reglement: await brut(`/commerces/${AH}/reglement`),
      carte: await brut(`/cartes/${(await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.clients.at(-1).id}`),
      etat: await brut(`/commerces/${AH}/etat`, PIN),
      tableau: await brut(`/commerces/${AH}/instants-gagnants`, PIN),
      tirage: JSON.stringify(joue.contenu),
    }
    for (const [nom, texte] of Object.entries(reponses)) {
      for (const m of marques) assert.ok(!texte.includes(m), `${nom} contient ${m}`)
    }
    for (const nom of ['publique', 'liste', 'reglement', 'carte'] as const) {
      assert.ok(!reponses[nom].includes('instantsParJour'), `${nom} : réglage des instants publié`)
      assert.ok(!reponses[nom].includes('plagesOuverture'), `${nom} : plages publiées`)
    }
    assert.deepEqual(JSON.parse(reponses.tableau).instants, [], 'avant l’heure : rien, pas même le nombre')
    horloge = new Date(futur.getTime() + 30_000)
    assert.deepEqual((await instantsTableau()).map((x) => [x.heure, x.statut]), [[futur.toISOString(), 'enCours']])
    horloge = new Date(futur.getTime() + 6 * 60_000)
    assert.deepEqual((await instantsTableau()).map((x) => x.statut), ['sansGagnant'])
    assert.ok(!(await brut(`/commerces/${AH}/etat`, PIN)).includes(futur.toISOString()), 'l’état complet ne porte jamais les instants')
  })

  test('route des instants : gérant seulement', async () => {
    assert.equal((await api('GET', `/commerces/${AH}/instants-gagnants`)).statut, 401)
    assert.equal((await api('GET', `/commerces/${AH}/instants-gagnants`, undefined, { 'X-Commerce-PIN': '0000' })).statut, 401)
  })
})

// Roue v2, R7 — relance automatique « gain bientôt expiré » : lot physique de la roue non retiré qui expire (fin de
// J+30) dans moins de 72 h. Une seule relance par tirage (journal des envois : `tirageId`), consentement exigé, canal
// selon le contact, réglage `relancesAuto.gainExpire` (absent = activé). AUCUN appel réseau réel : prestataires simulés.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { ouvrirStockage } from '../server/stockage.ts'
import { modeleColonneEnvoi } from '../server/stockage-supabase.ts'
import { emailGainExpire, gainBientotExpire, gainsARelancer, relanceGainFaite, smsGainExpire } from '../src/lib/relanceGain.ts'
import { analyseSms, libelleModele } from '../src/lib/relances.ts'
import type { Client, EnvoiRelance, Tirage } from '../src/types.ts'

const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const SITE = 'https://asian-home-fidelite.onrender.com'
const JOUR = 24 * 3600_000
const MAINTENANT = new Date('2026-11-10T11:00:00Z')
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-r7-'))
after(() => rmSync(dossier, { recursive: true, force: true }))

let n = 0
/** Tirage v2 (type figé) daté de `jours` jours avant `MAINTENANT`. */
function tirage(clientId: string, jours: number, maj: Partial<Tirage> = {}): Tirage {
  n++
  return {
    id: `ti-r7-${n}`,
    commerceId: AH,
    clientId,
    lot: 'Un dessert offert',
    lotId: 'lot-dessert',
    typeLot: 'lot',
    date: new Date(MAINTENANT.getTime() - jours * JOUR).toISOString(),
    code: `R7C0D${n % 10}`,
    ...maj,
  }
}

describe('R7 — règle « gain bientôt expiré » (fonctions pures)', () => {
  test('lot physique v2 utilisable, expiration dans moins de 72 h : J+28 oui, J+10 et J+27 non, J+30 oui, J+31 expiré', () => {
    assert.equal(gainBientotExpire(tirage('c', 28), MAINTENANT), true)
    assert.equal(gainBientotExpire(tirage('c', 30), MAINTENANT), true)
    assert.equal(gainBientotExpire(tirage('c', 10), MAINTENANT), false)
    // J+27 à 12 h (Paris) : fin de J+30 dans 84 h.
    assert.equal(gainBientotExpire(tirage('c', 27), MAINTENANT), false)
    assert.equal(gainBientotExpire(tirage('c', 31), MAINTENANT), false)
  })

  test('rien pour un gain remis, une consolation en points, un perdant ou un tirage hérité (ancienne règle)', () => {
    assert.equal(gainBientotExpire(tirage('c', 28, { remis: { le: MAINTENANT.toISOString(), par: 'Gérant' } }), MAINTENANT), false)
    assert.equal(gainBientotExpire(tirage('c', 28, { typeLot: 'points', lot: '+10 points' }), MAINTENANT), false)
    assert.equal(gainBientotExpire(tirage('c', 28, { typeLot: 'perdant', lot: 'Perdu' }), MAINTENANT), false)
    assert.equal(gainBientotExpire(tirage('c', 28, { typeLot: undefined }), MAINTENANT), false)
    assert.equal(gainBientotExpire(tirage('c', 28, { typeDeduit: true }), MAINTENANT), false)
  })

  test('une seule relance par tirage : envoyée, en cours, incertaine ou simulée (test) compte ; refus et erreur non', () => {
    const t = tirage('c', 28)
    const e = (statut: EnvoiRelance['statut'], tirageId = t.id): Pick<EnvoiRelance, 'modele' | 'statut' | 'tirageId'> => ({ modele: 'gainExpire', statut, tirageId })
    for (const s of ['envoye', 'en_cours', 'incertain', 'test'] as const) assert.equal(relanceGainFaite(t.id, [e(s)]), true, s)
    for (const s of ['refuse', 'erreur', 'non_branche'] as const) assert.equal(relanceGainFaite(t.id, [e(s)]), false, s)
    assert.equal(relanceGainFaite(t.id, [e('envoye', 'autre-tirage')]), false)
    assert.equal(relanceGainFaite(t.id, [{ modele: 'libre', statut: 'envoye' }]), false)
    // Plusieurs gains : l'expiration la plus proche d'abord, ceux déjà relancés écartés.
    const proche = tirage('c', 30)
    assert.deepEqual(gainsARelancer([t, proche], [], MAINTENANT).map((x) => x.id), [proche.id, t.id])
    assert.deepEqual(gainsARelancer([t, proche], [e('envoye', proche.id)], MAINTENANT).map((x) => x.id), [t.id])
  })

  test('textes : lot, commerce, date d’expiration, comptoir ; SMS en alphabet GSM avec lien de désinscription', () => {
    const d = { client: { prenom: 'Lina' }, commerce: { nom: 'Asian Home Paris' }, tirage: tirage('c', 28) }
    const sms = smsGainExpire(d, `${SITE}/c/cl-1`, `${SITE}/d/cl-1/jeton`)
    assert.equal(sms, `Asian Home Paris : Lina, votre gain "Un dessert offert" expire le jeudi 12 novembre. Présentez votre carte au comptoir : ${SITE}/c/cl-1 STOP : ${SITE}/d/cl-1/jeton`)
    assert.equal(analyseSms(sms).gsm7, true)
    assert.match(smsGainExpire({ ...d, client: { prenom: '' } }, 'L'), /^Asian Home Paris : Votre gain/)
    const mail = emailGainExpire(d, { carte: `${SITE}/#/carte/cl-1`, desinscription: `${SITE}/#/desinscription/cl-1/jeton` })
    assert.equal(mail.sujet, 'Asian Home Paris : votre gain expire bientôt')
    assert.match(mail.texte, /^Bonjour Lina,/)
    assert.match(mail.texte, /Votre gain « Un dessert offert » chez Asian Home Paris expire le jeudi 12 novembre : présentez votre carte au comptoir/)
    assert.match(mail.texte, /Pour ne plus en recevoir : https:\/\/.+\/#\/desinscription\/cl-1\/jeton$/)
    assert.equal(libelleModele('gainExpire'), 'Gain bientôt expiré')
  })

  test('Supabase sans migration : le modèle `gainExpire` est rangé sous `libre` dans la colonne (CHECK de 0007)', () => {
    assert.equal(modeleColonneEnvoi('gainExpire'), 'libre')
    for (const m of ['bienvenue', 'proche', 'inactif', 'anniversaire', 'libre'] as const) assert.equal(modeleColonneEnvoi(m), m)
  })
})

// ---------- Serveur (SQLite) ----------

async function demarrer(nom: string, o: { modeTest?: boolean; emailSandbox?: boolean } = {}) {
  const horloge = { t: MAINTENANT }
  const appels: { url: string; corps: string }[] = []
  /**
   * `panne.mode` : `refus` → le prestataire répond 400 (refus confirmé, relance en `erreur`) ; `reseau` → la requête
   * part puis la connexion tombe (TypeError) ; `5xx` → 500 ; `corps` → 201 au corps illisible (revue Codex 2 R7, F2).
   */
  const panne: { mode?: 'refus' | 'reseau' | '5xx' | 'corps' } = {}
  const fetch = (async (url: string, init: RequestInit) => {
    appels.push({ url, corps: String(init.body) })
    if (panne.mode === 'refus') return new Response(JSON.stringify({ message: 'numéro invalide' }), { status: 400 })
    if (panne.mode === '5xx') return new Response(JSON.stringify({ message: 'panne simulée' }), { status: 500 })
    if (panne.mode === 'reseau') throw new TypeError('fetch failed')
    if (panne.mode === 'corps') return new Response('<html>pas du JSON', { status: 201 })
    return new Response(JSON.stringify({ sid: `SM${appels.length}`, messageId: `<m${appels.length}@brevo>` }), { status: 201 })
  }) as unknown as typeof globalThis.fetch
  const fichierDb = join(dossier, nom)
  const app = await creerServeur({
    fichierDb,
    adminPin: ADMIN,
    pinInitial: '1234',
    version: 'test',
    urlPublique: SITE,
    maintenant: () => horloge.t,
    limitesPubliques: { inscriptionParIp: 1000, inscriptionParContact: 1000, ficheClientParIp: 1000, lectureParIp: 1000 },
    notifications: o.emailSandbox
      ? { brevo: { cleApi: 'cle-test', expediteurEmail: 'contact@exemple.fr', expediteurNom: 'Asian Home Paris', bacASable: true }, modeTest: true, fetch }
      : o.modeTest
        ? { brevoSms: { cleApi: 'cle-test', expediteurSms: 'ASIANHOME', modeTest: true }, modeTest: true, fetch }
        : { twilio: { accountSid: 'ACtest', authToken: 'jeton-twilio-test', expediteur: '+33700000000' }, fetch },
  })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
  async function api(methode: string, chemin: string, corps?: unknown) {
    const r = await globalThis.fetch(`${racine}/api/v1${chemin}`, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...PIN },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    return { statut: r.status, contenu: await r.json() }
  }
  const inscrire = async (prenom: string, contact: string, consentementRelance: boolean) =>
    (await api('POST', `/commerces/${AH}/clients`, { prenom, contact, consentementRelance })).contenu.client as Client
  /** Écrit le tirage directement en base, comme l'aurait fait la roue il y a quelques jours. */
  function ajouterTirage(t: Tirage) {
    const st = ouvrirStockage(fichierDb)
    st.ajouterTirage(t)
    st.fermer()
  }
  /** Ouverture du tableau de bord (déclenche la tournée), puis attente de la fin de la tournée. */
  async function tournee() {
    await api('GET', `/commerces/${AH}/etat`)
    await app.relancesEnCours()
  }
  const envoisAuto = async () =>
    ((await api('GET', `/commerces/${AH}/envois`)).contenu.envois as EnvoiRelance[]).filter((e) => e.declencheur === 'auto')
  /** Accès direct à la base (comme une autre requête du serveur), fermé après `f`. */
  function base<T>(f: (st: ReturnType<typeof ouvrirStockage>) => T): T {
    const st = ouvrirStockage(fichierDb)
    try {
      return f(st)
    } finally {
      st.fermer()
    }
  }
  return { app, api, inscrire, ajouterTirage, tournee, envoisAuto, appels, horloge, panne, base }
}

describe('R7 — tournée automatique « gain bientôt expiré »', () => {
  test('mode test, réglage par défaut (activé) : gain à J+28 → relance « test » ; J+10, remis, sans consentement → rien ; pas de doublon le lendemain', async () => {
    const s = await demarrer('r7-test.db', { modeTest: true })
    try {
      const lina = await inscrire(s, 'Lina', '0611111111', true)
      const marc = await inscrire(s, 'Marc', '0622222222', true)
      const sans = await inscrire(s, 'Sans', '0633333333', false)
      const remis = await inscrire(s, 'Remi', '0644444444', true)
      const aRelancer = tirage(lina.id, 28)
      s.ajouterTirage(aRelancer)
      s.ajouterTirage(tirage(marc.id, 10))
      s.ajouterTirage(tirage(sans.id, 28))
      s.ajouterTirage(tirage(remis.id, 28, { remis: { le: new Date(MAINTENANT.getTime() - JOUR).toISOString(), par: 'Gérant' } }))

      // Aucun réglage enregistré : la règle est active par défaut.
      assert.equal((await s.api('GET', `/commerces/${AH}/etat`)).contenu.commerce.relancesAuto, undefined)
      await s.tournee()
      const e = await s.envoisAuto()
      assert.deepEqual(
        e.map((x) => [x.clientId, x.modele, x.tirageId, x.statut, x.canal, x.auteur]),
        [[lina.id, 'gainExpire', aRelancer.id, 'test', 'sms', 'Automatique']],
      )
      assert.equal(s.appels.length, 0, 'mode test : aucun appel réseau')

      // 2e passage du moteur, le lendemain (gain à J+29, toujours dans les 72 h) : pas de doublon.
      s.horloge.t = new Date(MAINTENANT.getTime() + JOUR)
      await s.tournee()
      assert.equal((await s.envoisAuto()).length, 1)
    } finally {
      await s.app.fermer()
    }
  })

  test('avec prestataire simulé : SMS envoyé avec le lot et la date, une fois par tirage ; un 2e gain du même client part à la tournée suivante', async () => {
    const s = await demarrer('r7-sms.db')
    try {
      const lina = await inscrire(s, 'Lina', '0611111111', true)
      const premier = tirage(lina.id, 30, { lot: 'Un thé glacé' })
      const second = tirage(lina.id, 28)
      s.ajouterTirage(premier)
      s.ajouterTirage(second)
      await s.tournee()
      assert.equal(s.appels.length, 1, 'une seule relance automatique par client et par tournée')
      const corps = new URLSearchParams(s.appels[0].corps).get('Body')!
      assert.match(corps, /^Asian Home Paris : Lina, votre gain "Un thé glacé" expire le mardi 10 novembre\. Présentez votre carte au comptoir : https:\/\/.+\/c\/.+ STOP : https:\/\/.+\/d\//)
      assert.deepEqual((await s.envoisAuto()).map((x) => [x.tirageId, x.statut]), [[premier.id, 'envoye']])

      // Même jour à Paris (18 h) : la tournée est faite.
      s.horloge.t = new Date(MAINTENANT.getTime() + 6 * 3600_000)
      await s.tournee()
      assert.equal(s.appels.length, 1)
      s.horloge.t = new Date(MAINTENANT.getTime() + JOUR)
      await s.tournee()
      assert.equal(s.appels.length, 2)
      assert.match(new URLSearchParams(s.appels[1].corps).get('Body')!, /"Un dessert offert" expire le jeudi 12 novembre/)
      s.horloge.t = new Date(MAINTENANT.getTime() + 2 * JOUR)
      await s.tournee()
      assert.equal(s.appels.length, 2, 'chaque gain relancé une seule fois')
    } finally {
      await s.app.fermer()
    }
  })

  test('réglage : validé, `gainExpire: false` coupe la relance ; le réactiver dans la journée relance la tournée', async () => {
    const s = await demarrer('r7-reglage.db')
    try {
      assert.equal((await s.api('PATCH', `/commerces/${AH}`, { relancesAuto: { gainExpire: 'oui' } })).statut, 400)
      const coupe = await s.api('PATCH', `/commerces/${AH}`, { relancesAuto: { inactif: false, anniversaire: false, gainExpire: false } })
      assert.deepEqual(coupe.contenu.commerce.relancesAuto, { inactif: false, anniversaire: false, gainExpire: false })
      assert.equal(JSON.stringify((await s.api('GET', `/commerces/${AH}`)).contenu).includes('gainExpire'), false, 'jamais exposé publiquement')
      const lina = await inscrire(s, 'Lina', '0611111111', true)
      s.ajouterTirage(tirage(lina.id, 28))
      await s.tournee()
      assert.equal(s.appels.length, 0)

      await s.api('PATCH', `/commerces/${AH}`, { relancesAuto: { inactif: false, anniversaire: false, gainExpire: true } })
      await s.tournee()
      assert.equal(s.appels.length, 1)
      assert.deepEqual((await s.envoisAuto()).map((x) => x.modele), ['gainExpire'])

      // La tournée « gain seul » du jour est faite ; activer la relance des inactifs le même jour lance la sienne.
      const ines = await inscrire(s, 'Ines', '0655555555', true)
      const il40 = new Date(MAINTENANT.getTime() - 40 * JOUR).toISOString()
      const st = ouvrirStockage(join(dossier, 'r7-reglage.db'))
      st.majClient({ ...st.client(AH, ines.id)!, derniereVisite: il40, visites: [il40] })
      st.fermer()
      await s.tournee()
      assert.equal(s.appels.length, 1)
      await s.api('PATCH', `/commerces/${AH}`, { relancesAuto: { inactif: true, anniversaire: false } })
      await s.tournee()
      assert.deepEqual((await s.envoisAuto()).map((x) => [x.modele, x.clientId]).sort(), [['gainExpire', lina.id], ['inactif', ines.id]].sort())
    } finally {
      await s.app.fermer()
    }
  })

  test('l’anniversaire du jour passe avant ; le gain part à la tournée du lendemain', async () => {
    const s = await demarrer('r7-ordre.db')
    try {
      const adam = await inscrire(s, 'Adam', '0611111111', true)
      const st = ouvrirStockage(join(dossier, 'r7-ordre.db'))
      st.majClient({ ...st.client(AH, adam.id)!, anniversaire: '11-10' })
      st.fermer()
      s.ajouterTirage(tirage(adam.id, 28))
      await s.api('PATCH', `/commerces/${AH}`, { relancesAuto: { inactif: false, anniversaire: true } })
      await s.tournee()
      assert.deepEqual((await s.envoisAuto()).map((x) => x.modele), ['anniversaire'])
      s.horloge.t = new Date(MAINTENANT.getTime() + JOUR)
      await s.tournee()
      assert.deepEqual((await s.envoisAuto()).map((x) => x.modele).sort(), ['anniversaire', 'gainExpire'])
    } finally {
      await s.app.fermer()
    }
  })
})

// ---------- Revue Codex R7 (SQLite) : réclamation par tirage, pas de fenêtre de lecture, échec après réclamation, mode test ----------

describe('R7 revue Codex — une seule relance par gain, sans fenêtre de lecture', () => {
  test('F1 : marqueur perdu + 60 tentatives plus récentes → toujours pas de doublon (relecture par tirageId)', async () => {
    const s = await demarrer('r7-f1.db')
    try {
      const lina = await inscrire(s, 'Lina', '0611111111', true)
      const gain = tirage(lina.id, 28)
      s.ajouterTirage(gain)
      await s.tournee()
      assert.equal(s.appels.length, 1)
      assert.ok(s.base((st) => st.tirage(AH, gain.id))!.relanceGainLe, 'tirage réclamé avant l’envoi')

      s.base((st) => {
        // Activation lue AVANT la réclamation : la comparaison-échange la refuse (2e revue F1), le marqueur survit.
        const reclame = st.tirage(AH, gain.id)!
        assert.equal(st.majTirageSi({ ...gain, activeLe: new Date(MAINTENANT.getTime() + 3600_000).toISOString() }, gain), false)
        assert.equal(st.tirage(AH, gain.id)!.relanceGainLe, reclame.relanceGainLe)
        // Marqueur perdu quand même (écriture hors de l'app, restauration…) : la relecture des envois reste la garde.
        const { relanceGainLe: _, ...perdu } = reclame
        assert.equal(st.majTirageSi(perdu, reclame), true)
        assert.equal(st.tirage(AH, gain.id)!.relanceGainLe, undefined)
        // 60 tentatives plus récentes pour ce client : la trace de la relance du gain sort des 50 derniers envois.
        for (let i = 0; i < 60; i++) {
          const date = new Date(MAINTENANT.getTime() + 2 * 3600_000 + i * 1000).toISOString()
          st.ajouterEnvoi({ id: `en-f1-${i}`, commerceId: AH, clientId: lina.id, clientPrenom: 'Lina', date, jour: '2026-11-10', modele: 'libre', canal: 'sms', statut: 'erreur', declencheur: 'manuel', auteur: 'Gérant' })
        }
        assert.equal(st.envois(AH, 50, lina.id).some((e) => e.tirageId === gain.id), false, 'hors de la fenêtre des 50')
      })

      for (const jours of [1, 2]) {
        s.horloge.t = new Date(MAINTENANT.getTime() + jours * JOUR)
        await s.tournee()
      }
      assert.equal(s.appels.length, 1, 'aucun 2e SMS pour le même gain')
      assert.deepEqual((await s.envoisAuto()).map((x) => [x.modele, x.tirageId]), [['gainExpire', gain.id]])
    } finally {
      await s.app.fermer()
    }
  })

  test('F2 (stockage SQLite) : réclamation conditionnelle — une seule passe, ni la remise ni l’activation ne sont effacées ni bloquées', async () => {
    const s = await demarrer('r7-f2-stockage.db')
    try {
      const lina = await inscrire(s, 'Lina', '0611111111', true)
      const g = tirage(lina.id, 28)
      s.ajouterTirage(g)
      s.base((st) => {
        const a = { ...g, relanceGainLe: '2026-11-10T11:00:00.000Z' }
        assert.equal(st.majTirageSi(a, g), true)
        assert.equal(st.majTirageSi({ ...g, relanceGainLe: '2026-11-10T11:00:01.000Z' }, g), false, 'déjà réclamé : la 2e réclamation échoue')
        assert.equal(st.tirage(AH, g.id)!.relanceGainLe, a.relanceGainLe)
        assert.deepEqual(gainsARelancer([st.tirage(AH, g.id)!], [], MAINTENANT), [], 'un tirage réclamé n’est plus présélectionné')
        // Libération : seulement avec NOTRE horodatage.
        assert.equal(st.majTirageSi(g, { relanceGainLe: '2026-11-10T09:00:00.000Z' }), false)
        assert.equal(st.majTirageSi(g, a), true)
        assert.equal(st.tirage(AH, g.id)!.relanceGainLe, undefined)

        // Activation APRÈS réclamation (lecture fraîche) : acceptée, garde le marqueur ; une écriture partie d'une lecture
        // antérieure à l'activation (libération comprise) n'écrit rien — l'app relit et réapplique son patch.
        assert.equal(st.majTirageSi(a, g), true)
        const activeLe = new Date(MAINTENANT.getTime() + 60_000).toISOString()
        assert.equal(st.majTirageSi({ ...st.tirage(AH, g.id)!, activeLe }, st.tirage(AH, g.id)!), true)
        assert.equal(st.majTirageSi(g, a), false, 'activeLe a changé : rien écrit')
        assert.deepEqual([st.tirage(AH, g.id)!.activeLe, st.tirage(AH, g.id)!.relanceGainLe], [activeLe, a.relanceGainLe])

        // Remise en caisse APRÈS réclamation : acceptée ; ensuite aucune réclamation ne peut réécrire le tirage remis.
        const remis = { le: MAINTENANT.toISOString(), par: 'Gérant' as const }
        assert.equal(st.marquerTirageRemis({ ...st.tirage(AH, g.id)!, remis }), true)
        assert.equal(st.majTirageSi({ ...g, activeLe, relanceGainLe: 'x' }, { activeLe, relanceGainLe: a.relanceGainLe }), false)
        assert.equal(st.majTirageSi({ ...g, activeLe }, { activeLe, relanceGainLe: a.relanceGainLe }), false)
        assert.deepEqual(st.tirage(AH, g.id)!.remis, remis)
      })
    } finally {
      await s.app.fermer()
    }
  })

  test('refus 4xx du prestataire APRÈS réclamation : marqueur retiré, nouvel essai à la tournée suivante ; envoyé → marqueur gardé, plus rien', async () => {
    const s = await demarrer('r7-echec.db')
    try {
      const lina = await inscrire(s, 'Lina', '0611111111', true)
      const gain = tirage(lina.id, 28)
      s.ajouterTirage(gain)
      s.panne.mode = 'refus'
      await s.tournee()
      assert.deepEqual((await s.envoisAuto()).map((x) => x.statut), ['erreur'])
      assert.equal(s.base((st) => st.tirage(AH, gain.id))!.relanceGainLe, undefined, 'rien de parti : réclamation libérée')

      s.panne.mode = undefined
      s.horloge.t = new Date(MAINTENANT.getTime() + JOUR)
      await s.tournee()
      assert.equal(s.appels.length, 2)
      assert.deepEqual((await s.envoisAuto()).map((x) => x.statut), ['envoye', 'erreur'])
      assert.ok(s.base((st) => st.tirage(AH, gain.id))!.relanceGainLe)

      s.horloge.t = new Date(MAINTENANT.getTime() + 2 * JOUR)
      await s.tournee()
      assert.equal(s.appels.length, 2)
    } finally {
      await s.app.fermer()
    }
  })

  test('2e revue F2 : coupure réseau, 5xx ou corps illisible APRÈS émission → `incertain`, marqueur gardé, jamais renvoyé automatiquement', async () => {
    for (const mode of ['reseau', '5xx', 'corps'] as const) {
      const s = await demarrer(`r7b-f2-${mode}.db`)
      try {
        const lina = await inscrire(s, 'Lina', '0611111111', true)
        const gain = tirage(lina.id, 28)
        s.ajouterTirage(gain)
        s.panne.mode = mode
        await s.tournee()
        assert.equal(s.appels.length, 1, mode)
        const [e] = await s.envoisAuto()
        assert.deepEqual([e.statut, e.tirageId], ['incertain', gain.id], mode)
        assert.match(e.raison!, /peut-être parti/)
        assert.ok(s.base((st) => st.tirage(AH, gain.id))!.relanceGainLe, `${mode} : peut-être parti → marqueur conservé`)

        s.panne.mode = undefined
        for (const jours of [1, 2]) {
          s.horloge.t = new Date(MAINTENANT.getTime() + jours * JOUR)
          await s.tournee()
        }
        assert.equal(s.appels.length, 1, `${mode} : aucun renvoi automatique`)
      } finally {
        await s.app.fermer()
      }
    }
  })

  test('F4 (hérité) : mode test, relance de gain par e-mail = appel Brevo avec X-Sib-Sandbox (rien livré), journal « test », une seule fois', async () => {
    const s = await demarrer('r7-sandbox.db', { emailSandbox: true })
    try {
      const marc = await inscrire(s, 'Marc', 'marc@exemple.fr', true)
      const gain = tirage(marc.id, 28)
      s.ajouterTirage(gain)
      await s.tournee()
      assert.equal(s.appels.length, 1)
      assert.equal(s.appels[0].url, 'https://api.brevo.com/v3/smtp/email')
      const corps = JSON.parse(s.appels[0].corps)
      assert.equal(corps.headers['X-Sib-Sandbox'], 'drop', 'même chemin que toutes les relances e-mail en mode test (P1-B7)')
      assert.equal(corps.subject, 'Asian Home Paris : votre gain expire bientôt')
      assert.deepEqual((await s.envoisAuto()).map((x) => [x.modele, x.canal, x.statut, x.tirageId]), [['gainExpire', 'email', 'test', gain.id]])
      s.horloge.t = new Date(MAINTENANT.getTime() + JOUR)
      await s.tournee()
      assert.equal(s.appels.length, 1, 'la simulation compte : pas rejouée à chaque tournée')
    } finally {
      await s.app.fermer()
    }
  })
})

function inscrire(s: Awaited<ReturnType<typeof demarrer>>, prenom: string, contact: string, consentementRelance: boolean) {
  return s.inscrire(prenom, contact, consentementRelance)
}

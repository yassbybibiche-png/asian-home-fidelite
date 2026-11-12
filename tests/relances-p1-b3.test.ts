// P1-B3 — Relances SMS / e-mail de bout en bout : consentement explicite, désinscription par lien (SMS : P1-B9, lien
// court /d/… — « répondez STOP » est impossible avec l'expéditeur alphanumérique Brevo), journal des
// envois (table `envois`), modèles, anti-doublon du jour, relances automatiques. AUCUN appel réseau réel : les
// prestataires sont simulés (fetch injecté) ou absents (501). Supabase (avec / sans migration 0007) : supabase.test.ts.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, type OptionsServeur } from '../server/app.ts'
import { ouvrirStockage } from '../server/stockage.ts'
import { signatureTwilio } from '../server/notifications/twilio.ts'
import {
  analyseSms,
  anniversaireAujourdhui,
  canalDuClient,
  emailRelance,
  estMotStop,
  inactifARelancer,
  jourParis,
  lienCourtCarte,
  lienCourtDesinscription,
  mentionDesinscriptionSms,
  MODELES_RELANCE,
  modelesSuggeres,
  relanceAutoDue,
  smsRelance,
} from '../src/lib/relances.ts'
import { nouveauClient } from '../src/lib/fidelite.ts'
import { nouveauCommerce } from '../src/data/defaults.ts'
import type { Client, EntreeJournal, EnvoiRelance } from '../src/types.ts'

const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const SITE = 'https://asian-home-fidelite.onrender.com'
const JOUR = 24 * 3600_000
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p1-b3-'))
after(() => rmSync(dossier, { recursive: true, force: true }))

// ---------- Modèles (fonctions pures) ----------

describe('Modèles de relance : 4 modèles, SMS avec lien de désinscription, e-mail avec objet + corps', () => {
  const commerce = { nom: 'Asian Home Paris', recompense: 'Un plat offert au 10e repas', seuilTampons: 10 }
  const lien = lienCourtCarte(SITE, 'cl-mhs8k2a1-ab12')
  const lienDesinscription = lienCourtDesinscription(SITE, 'cl-mhs8k2a1-ab12', 'jeton-test-32-caracteres-0123')

  test('les 4 modèles demandés existent', () => {
    assert.deepEqual(MODELES_RELANCE.map((m) => m.modele), ['bienvenue', 'proche', 'inactif', 'anniversaire'])
  })

  test('SMS : nom du commerce, lien vers la carte, mention STOP = lien de désinscription (P1-B9) ; alphabet GSM, 2 segments max', () => {
    assert.equal(lien, `${SITE}/c/cl-mhs8k2a1-ab12`)
    assert.equal(lienDesinscription, `${SITE}/d/cl-mhs8k2a1-ab12/jeton-test-32-caracteres-0123`)
    assert.equal(mentionDesinscriptionSms(lienDesinscription), `STOP : ${lienDesinscription}`)
    for (const prenom of ['Lina', '', 'Jean-Christophe']) {
      for (const { modele } of MODELES_RELANCE) {
        for (const tampons of [3, 8, 9, 10]) {
          const t = smsRelance(modele, { client: { prenom, tampons }, commerce }, lien, '', lienDesinscription)
          assert.ok(t.startsWith('Asian Home Paris : '), t)
          assert.ok(t.includes(lien), t)
          assert.ok(t.endsWith(mentionDesinscriptionSms(lienDesinscription)), t)
          assert.match(mentionDesinscriptionSms(lienDesinscription), /STOP/)
          // Le texte ne promet plus de réponse STOP : aucun « répondez STOP » nulle part.
          assert.doesNotMatch(t, /répondez STOP/i, t)
          if (prenom) assert.ok(t.includes(prenom), t)
          const a = analyseSms(t)
          assert.equal(a.gsm7, true, `hors alphabet GSM : ${t}`)
          // Le lien de désinscription allonge le SMS : 2 segments (facturés 2 SMS) au lieu d'1.
          assert.ok(a.caracteres <= 320 && a.segments <= 2, `${a.caracteres} car., ${a.segments} segments : ${t}`)
        }
      }
    }
  })

  test('SMS sans lien de désinscription : repli honnête, jamais « répondez STOP »', () => {
    assert.equal(mentionDesinscriptionSms(''), 'STOP : désinscription auprès du commerce')
    assert.doesNotMatch(smsRelance('bienvenue', { client: { prenom: 'Lina', tampons: 0 }, commerce }, lien), /répondez STOP/i)
  })

  test('SMS « récompense proche » : 8 → plus que 2, 9 → plus que 1 (singulier), 10 → la récompense attend', () => {
    const sms = (tampons: number) => smsRelance('proche', { client: { prenom: 'Lina', tampons }, commerce }, lien)
    assert.match(sms(8), /plus que 2 tampons avant votre récompense/)
    assert.match(sms(9), /plus que 1 tampon avant votre récompense/)
    assert.match(sms(10), /votre récompense vous attend/)
  })

  test('message libre : précédé du nom du commerce, mention de désinscription par lien ajoutée', () => {
    assert.equal(
      smsRelance('libre', { client: { prenom: 'Lina', tampons: 1 }, commerce }, lien, ' Ce soir, -10 % ! ', lienDesinscription),
      `Asian Home Paris : Ce soir, -10 % ! ${mentionDesinscriptionSms(lienDesinscription)}`,
    )
  })

  test('e-mail : objet + corps vouvoyés, nom du commerce, lien vers la carte, lien de désinscription en pied', () => {
    const liens = { carte: `${SITE}/#/carte/cl-1`, desinscription: `${SITE}/#/desinscription/cl-1/jeton` }
    const objets = new Set<string>()
    for (const { modele } of MODELES_RELANCE) {
      const e = emailRelance(modele, { client: { prenom: 'Lina', tampons: 8 }, commerce }, liens)
      assert.ok(e.sujet.includes('Asian Home Paris'), e.sujet)
      objets.add(e.sujet)
      assert.ok(e.texte.startsWith('Bonjour Lina,\n\n'))
      assert.ok(e.texte.includes('Asian Home Paris'))
      assert.match(e.texte, /\bvous\b|\bvotre\b/i)
      assert.doesNotMatch(e.texte, /\b(tu|ton|ta|tes)\b/i, 'vouvoiement')
      assert.ok(e.texte.includes(`Votre carte de fidélité : ${liens.carte}`))
      assert.ok(e.texte.endsWith(`Pour ne plus en recevoir : ${liens.desinscription}`))
    }
    assert.equal(objets.size, 4, 'un objet par modèle')
    assert.ok(emailRelance('bienvenue', { client: { prenom: '', tampons: 0 }, commerce }, liens).texte.startsWith('Bonjour,\n\n'), 'sans prénom')
    assert.match(emailRelance('proche', { client: { prenom: 'Lina', tampons: 9 }, commerce }, liens).texte, /Plus que 1 tampon avant votre récompense : Un plat offert au 10e repas/)
  })

  test('longueur des SMS : Unicode détecté (70 car.), extension GSM comptée double', () => {
    assert.deepEqual(analyseSms('Bonjour'), { caracteres: 7, gsm7: true, segments: 1 })
    assert.equal(analyseSms('L’équipe').gsm7, false, 'apostrophe typographique = Unicode')
    assert.equal(analyseSms('x'.repeat(71) + 'ê').segments, 2)
    assert.equal(analyseSms('€').caracteres, 2)
    assert.equal(analyseSms('a'.repeat(161)).segments, 2)
  })

  test('canal selon le contact : téléphone → SMS, e-mail → e-mail', () => {
    assert.equal(canalDuClient({ telephone: '0612345678' }), 'sms')
    assert.equal(canalDuClient({ email: 'a@b.fr' }), 'email')
    assert.equal(canalDuClient({}), null)
  })

  test('mots STOP : insensibles à la casse et aux accents, 1er mot du message ; un autre mot ne désinscrit pas', () => {
    for (const m of ['STOP', 'stop', ' Stop. ', 'stop merci', 'ARRÊT', 'arret', 'Désinscription', 'désinscrire', 'Unsubscribe', 'STOPALL']) assert.equal(estMotStop(m), true, m)
    for (const m of ['Bonjour', 'je ne veux pas arrêter', 'STOPPER', 'top', '', 'OK merci']) assert.equal(estMotStop(m), false, m)
  })

  test('règles : inactif entre 30 et 120 jours, anniversaire à Paris (29/02 fêté le 28 hors bissextile), une fois par absence / par an', () => {
    const t = new Date('2026-11-10T10:00:00Z')
    const visite = (jours: number) => new Date(t.getTime() - jours * JOUR).toISOString()
    assert.equal(inactifARelancer({ derniereVisite: null }, t), false)
    assert.equal(inactifARelancer({ derniereVisite: visite(29) }, t), false)
    assert.equal(inactifARelancer({ derniereVisite: visite(30) }, t), true)
    assert.equal(inactifARelancer({ derniereVisite: visite(119) }, t), true)
    assert.equal(inactifARelancer({ derniereVisite: visite(120) }, t), false)
    assert.equal(anniversaireAujourdhui({ anniversaire: '11-10' }, t), true)
    assert.equal(anniversaireAujourdhui({ anniversaire: '11-10' }, new Date('2026-11-09T23:30:00Z')), true, '00:30 à Paris le 10')
    assert.equal(anniversaireAujourdhui({ anniversaire: '02-29' }, new Date('2027-02-28T12:00:00Z')), true)
    assert.equal(anniversaireAujourdhui({ anniversaire: '02-29' }, new Date('2028-02-28T12:00:00Z')), false)
    assert.equal(jourParis(new Date('2026-07-01T22:30:00Z')), '2026-07-02')

    const commerce = nouveauCommerce('Chez Lin', 'restaurant', '')
    const client: Client = { ...nouveauClient(commerce.id, 'Lina', { telephone: '0612345678' }, t), derniereVisite: visite(40), visites: [visite(40)], anniversaire: '11-10' }
    const env = (modele: EnvoiRelance['modele'], statut: EnvoiRelance['statut'], date: Date) => ({ modele, statut, date: date.toISOString(), jour: jourParis(date) })
    assert.equal(relanceAutoDue('inactif', client, [], t), true)
    assert.equal(relanceAutoDue('inactif', client, [env('inactif', 'envoye', new Date(t.getTime() - 5 * JOUR))], t), false, 'déjà relancé depuis la dernière visite')
    assert.equal(relanceAutoDue('inactif', client, [env('inactif', 'envoye', new Date(t.getTime() - 50 * JOUR))], t), true, 'relance d’une absence précédente')
    assert.equal(relanceAutoDue('inactif', client, [env('inactif', 'erreur', new Date(t.getTime() - JOUR))], t), true, 'une erreur ne compte pas')
    assert.equal(relanceAutoDue('anniversaire', client, [], t), true)
    assert.equal(relanceAutoDue('anniversaire', client, [env('anniversaire', 'envoye', t)], t), false)
    assert.deepEqual(modelesSuggeres(client, commerce, t), ['anniversaire', 'inactif'])
  })
})

// ---------- Serveur (SQLite) ----------

interface OptionsTest {
  /** Prestataires simulés ; absent = rien de configuré (501). */
  twilio?: boolean
  brevo?: boolean
  /** SMS via Brevo (même clé API que l'e-mail) : prioritaire sur Twilio quand il est configuré. */
  brevoSms?: boolean
  /** Mode test (`BREVO_MODE_TEST=1`) : e-mail en sandbox Brevo, SMS simulé, journal statut `test`. */
  modeTest?: boolean
  /** Réponse du prestataire simulé (statut HTTP). */
  statutPrestataire?: () => number
}

async function demarrer(nom: string, o: OptionsTest = {}, options: Partial<OptionsServeur> = {}) {
  const horloge = { t: new Date('2026-11-10T11:00:00Z') }
  const appels: { url: string; corps: string; entetes: Record<string, string> }[] = []
  const fetch = (async (url: string, init: RequestInit) => {
    appels.push({ url, corps: String(init.body), entetes: init.headers as Record<string, string> })
    const statut = o.statutPrestataire?.() ?? 201
    return new Response(JSON.stringify({ sid: `SM${appels.length}`, messageId: `<m${appels.length}@brevo>` }), { status: statut })
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
    notifications: {
      ...(o.twilio ? { twilio: { accountSid: 'ACtest', authToken: 'jeton-twilio-test', expediteur: '+33700000000', ...(o.modeTest ? { modeTest: true } : {}) } } : {}),
      ...(o.brevo ? { brevo: { cleApi: 'cle-test', expediteurEmail: 'contact@exemple.fr', expediteurNom: 'Asian Home Paris', ...(o.modeTest ? { bacASable: true } : {}) } } : {}),
      ...(o.brevoSms ? { brevoSms: { cleApi: 'cle-test', expediteurSms: 'ASIANHOME', ...(o.modeTest ? { modeTest: true } : {}) } } : {}),
      ...(o.modeTest ? { modeTest: true } : {}),
      fetch,
    },
    ...options,
  })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await globalThis.fetch(`${racine}/api/v1${chemin}`, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    const type = r.headers.get('content-type') ?? ''
    return { statut: r.status, type, contenu: type.includes('json') ? await r.json() : await r.text() }
  }
  /** Webhook Twilio signé (ou non) : corps formulaire, comme Twilio. */
  async function stop(params: Record<string, string>, signature?: string) {
    const corps = new URLSearchParams(params)
    const chemin = `/api/v1/commerces/${AH}/stop-sms`
    const r = await globalThis.fetch(racine + chemin, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Twilio-Signature': signature ?? signatureTwilio('jeton-twilio-test', SITE + chemin, corps),
      },
      body: corps.toString(),
    })
    return { statut: r.status, type: r.headers.get('content-type') ?? '', texte: await r.text() }
  }
  const client = async (id: string) => ((await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.clients as Client[]).find((c) => c.id === id)!
  const envois = async (clientId?: string) => (await api('GET', `/commerces/${AH}/envois${clientId ? `?client=${clientId}` : ''}`, undefined, PIN)).contenu.envois as EnvoiRelance[]
  const journal = async () => (await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.journal as EntreeJournal[]
  /** Écrit directement en base (dernière visite, anniversaire…), comme le ferait l'historique réel. */
  function modifier(id: string, maj: Partial<Client>) {
    const st = ouvrirStockage(fichierDb)
    st.majClient({ ...st.client(AH, id)!, ...maj })
    st.fermer()
  }
  return { app, api, stop, client, envois, journal, modifier, appels, horloge, racine }
}

describe('Consentement explicite aux relances', () => {
  test('inscription publique : sans case → pas de consentement ; case cochée → consentement daté (origine « inscription »)', async () => {
    const s = await demarrer('consentement-public.db')
    try {
      const sans = await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0611111111' })
      assert.equal(sans.statut, 201)
      assert.equal(sans.contenu.client.consentementRelance, undefined)
      const avec = await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Marc', contact: 'marc@exemple.fr', consentementRelance: true })
      assert.equal(avec.statut, 201)
      const marc = await s.client(avec.contenu.client.id)
      assert.equal(marc.consentementRelance, true)
      assert.equal(marc.consentementRelanceOrigine, 'inscription')
      assert.equal(marc.consentementRelanceLe, s.horloge.t.toISOString())
      assert.equal((await s.client(sans.contenu.client.id)).consentementRelance, undefined)
      // Case explicitement décochée : pas de consentement.
      const non = await s.api('POST', `/commerces/${AH}/clients`, { contact: '0622222222', consentementRelance: false })
      assert.equal((await s.client(non.contenu.client.id)).consentementRelance, undefined)
      // Valeur non booléenne : refusée.
      assert.equal((await s.api('POST', `/commerces/${AH}/clients`, { contact: '0633333333', consentementRelance: 'oui' })).statut, 400)
    } finally {
      await s.app.fermer()
    }
  })

  test('client déjà inscrit : cocher la case en se ré-identifiant ne le réabonne pas (après un STOP, par exemple)', async () => {
    const s = await demarrer('consentement-existant.db')
    try {
      const c = (await s.api('POST', `/commerces/${AH}/clients`, { contact: '0611111111' })).contenu.client as Client
      const encore = await s.api('POST', `/commerces/${AH}/clients`, { contact: '06 11 11 11 11', consentementRelance: true })
      // P2-S13 — oracle fermé (changement de contrat) : même statut 201 et même forme que la création,
      // sans `existant` et sans jeton.
      assert.equal(encore.statut, 201)
      assert.equal('existant' in encore.contenu, false)
      assert.equal(encore.contenu.jeton, undefined)
      assert.equal((await s.client(c.id)).consentementRelance, undefined)
    } finally {
      await s.app.fermer()
    }
  })

  test('commerçant : inscription en caisse avec la case, puis retrait / ajout sur la fiche (journalisés)', async () => {
    const s = await demarrer('consentement-commercant.db')
    try {
      const c = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0611111111', consentementRelance: true }, PIN)).contenu.client as Client
      assert.equal(c.consentementRelance, true)
      const retrait = await s.api('PATCH', `/commerces/${AH}/clients/${c.id}`, { consentementRelance: false }, PIN)
      assert.equal(retrait.statut, 200)
      assert.equal(retrait.contenu.client.consentementRelance, false)
      assert.equal(retrait.contenu.client.consentementRelanceOrigine, 'commercant')
      s.horloge.t = new Date(s.horloge.t.getTime() + 60_000)
      const ajout = await s.api('PATCH', `/commerces/${AH}/clients/${c.id}`, { consentementRelance: true }, PIN)
      assert.equal(ajout.contenu.client.consentementRelance, true)
      // Même valeur : rien ne change (ni date, ni journal).
      await s.api('PATCH', `/commerces/${AH}/clients/${c.id}`, { consentementRelance: true }, PIN)
      const j = (await s.journal()).filter((e) => e.action === 'consentement')
      assert.deepEqual(j.map((e) => e.details), [
        'Consentement aux relances SMS / e-mail enregistré par le commerce',
        'Consentement aux relances SMS / e-mail retiré par le commerce',
      ])
      assert.ok(j.every((e) => e.clientId === c.id && e.auteur.nom === 'Gérant'))
      assert.equal((await s.api('PATCH', `/commerces/${AH}/clients/${c.id}`, { consentementRelance: 'non' }, PIN)).statut, 400)
      assert.equal((await s.api('PATCH', `/commerces/${AH}/clients/${c.id}`, { consentementRelance: false })).statut, 401)
      // Les autres champs de la fiche restent modifiables avec / sans le consentement.
      const anniv = await s.api('PATCH', `/commerces/${AH}/clients/${c.id}`, { anniversaire: '03-21' }, PIN)
      assert.deepEqual([anniv.contenu.client.anniversaire, anniv.contenu.client.consentementRelance], ['03-21', true])
    } finally {
      await s.app.fermer()
    }
  })
})

describe('STOP par SMS (webhook Twilio)', () => {
  test('sans Twilio configuré : 501 honnête, aucun consentement modifié', async () => {
    const s = await demarrer('stop-sans.db')
    try {
      const c = (await s.api('POST', `/commerces/${AH}/clients`, { contact: '0611111111', consentementRelance: true }, PIN)).contenu.client as Client
      const r = await s.stop({ From: '+33611111111', Body: 'STOP' }, 'x')
      assert.equal(r.statut, 501)
      assert.match(JSON.parse(r.texte).erreur, /à brancher.*Aucun consentement n’a été modifié/)
      assert.equal((await s.client(c.id)).consentementRelance, true)
    } finally {
      await s.app.fermer()
    }
  })

  test('avec Twilio : « Stop » retire le consentement du client de ce numéro (journalisé) ; autre mot : rien ; signature fausse : 403', async () => {
    const s = await demarrer('stop-avec.db', { twilio: true })
    try {
      const lina = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '06 11 11 11 11', consentementRelance: true }, PIN)).contenu.client as Client
      const marc = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Marc', contact: '0622222222', consentementRelance: true }, PIN)).contenu.client as Client

      assert.equal((await s.stop({ From: '+33611111111', Body: 'STOP' }, 'signature-fausse')).statut, 403)
      assert.equal((await s.stop({ From: '+33611111111', Body: 'STOP' }, '')).statut, 403)
      assert.equal((await s.client(lina.id)).consentementRelance, true, 'rien sans signature valide')

      const autre = await s.stop({ From: '+33611111111', Body: 'Merci pour le repas !', To: '+33700000000' })
      assert.equal(autre.statut, 200)
      assert.equal((await s.client(lina.id)).consentementRelance, true, 'un autre mot ne désinscrit pas')

      const r = await s.stop({ From: '+33611111111', Body: 'Stop', To: '+33700000000', MessageSid: 'SMx' })
      assert.equal(r.statut, 200)
      assert.match(r.type, /text\/xml/)
      assert.equal(r.texte, '<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
      const apres = await s.client(lina.id)
      assert.deepEqual([apres.consentementRelance, apres.consentementRelanceOrigine], [false, 'stop-sms'])
      assert.equal((await s.client(marc.id)).consentementRelance, true, 'seul ce numéro')
      const j = (await s.journal()).filter((e) => e.action === 'consentement')
      assert.deepEqual(j.map((e) => [e.clientId, e.auteur.type, e.details]), [[lina.id, 'client', 'Consentement aux relances retiré : réponse STOP par SMS']])

      // Variante accentuée, numéro au format 0033 ; numéro inconnu : 200 sans effet.
      assert.equal((await s.stop({ From: '0033622222222', Body: 'ARRÊT' })).statut, 200)
      assert.equal((await s.client(marc.id)).consentementRelance, false)
      assert.equal((await s.stop({ From: '+33699999999', Body: 'STOP' })).statut, 200)
      // Après le STOP, la relance est refusée (409).
      assert.equal((await s.api('POST', `/commerces/${AH}/clients/${lina.id}/relance`, { modele: 'inactif' }, PIN)).statut, 409)
    } finally {
      await s.app.fermer()
    }
  })
})

describe('Relance (route commerçant) et journal des envois', () => {
  test('sans clés : 501 clair pour SMS et e-mail, tentative journalisée (non_branche), aucun appel réseau', async () => {
    const s = await demarrer('relance-sans.db')
    try {
      const sms = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0611111111', consentementRelance: true }, PIN)).contenu.client as Client
      const mail = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Marc', contact: 'marc@exemple.fr', consentementRelance: true }, PIN)).contenu.client as Client
      const r1 = await s.api('POST', `/commerces/${AH}/clients/${sms.id}/relance`, { modele: 'bienvenue' }, PIN)
      const r2 = await s.api('POST', `/commerces/${AH}/clients/${mail.id}/relance`, { modele: 'anniversaire' }, PIN)
      for (const r of [r1, r2]) {
        assert.equal(r.statut, 501)
        assert.match(r.contenu.erreur, /à brancher : aucun prestataire n’est configuré sur ce serveur\. Rien n’a été envoyé\./)
      }
      assert.equal(s.appels.length, 0)
      const e = await s.envois()
      assert.deepEqual(e.map((x) => [x.clientId, x.modele, x.canal, x.statut, x.declencheur]), [
        [mail.id, 'anniversaire', 'email', 'non_branche', 'manuel'],
        [sms.id, 'bienvenue', 'sms', 'non_branche', 'manuel'],
      ])
      assert.ok(e.every((x) => x.auteur === 'Gérant' && /Rien n’a été envoyé/.test(x.raison!)))
      assert.equal((await s.api('POST', `/commerces/${AH}/clients/${sms.id}/relance`, { modele: 'pigeon' }, PIN)).statut, 400)
      assert.equal((await s.api('POST', `/commerces/${AH}/clients/${sms.id}/relance`, { modele: 'inactif', message: 'x' }, PIN)).statut, 400)
      assert.equal((await s.api('POST', `/commerces/${AH}/clients/${sms.id}/relance`, { modele: 'inactif' })).statut, 401)
      assert.equal((await s.api('GET', `/commerces/${AH}/envois`)).statut, 401)
      assert.equal((await s.api('GET', '/sante')).contenu.migrations.relances, true)
    } finally {
      await s.app.fermer()
    }
  })

  test('SMS simulé : refus 409 sans consentement journalisé, envoi journalisé, anti-doublon du jour, jour suivant de nouveau possible', async () => {
    const s = await demarrer('relance-sms.db', { twilio: true })
    try {
      const lina = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0611111111', consentementRelance: true }, PIN)).contenu.client as Client
      const marc = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Marc', contact: '0622222222' }, PIN)).contenu.client as Client

      const refus = await s.api('POST', `/commerces/${AH}/clients/${marc.id}/relance`, { modele: 'proche' }, PIN)
      assert.equal(refus.statut, 409)
      assert.match(refus.contenu.erreur, /consentement/)

      const ok = await s.api('POST', `/commerces/${AH}/clients/${lina.id}/relance`, { modele: 'proche' }, PIN)
      assert.equal(ok.statut, 200)
      assert.deepEqual([ok.contenu.canal, ok.contenu.modele, ok.contenu.id, ok.contenu.envoi.statut], ['sms', 'proche', 'SM1', 'envoye'])
      assert.equal(s.appels.length, 1)
      const corps = new URLSearchParams(s.appels[0].corps)
      assert.equal(corps.get('To'), '+33611111111')
      // P1-B9 : le SMS porte le lien court de désinscription (jeton HMAC, 32 car.), pas « répondez STOP ».
      const body = corps.get('Body')!
      assert.ok(body.startsWith(`Asian Home Paris : Lina, plus que 10 tampons avant votre récompense ! ${SITE}/c/${lina.id} STOP : ${SITE}/d/${lina.id}/`), body)
      assert.doesNotMatch(body, /répondez STOP/i)
      const jetonSms = /\/d\/[^/]+\/([A-Za-z0-9_-]{32})$/.exec(body)![1]

      const doublon = await s.api('POST', `/commerces/${AH}/clients/${lina.id}/relance`, { modele: 'proche' }, PIN)
      assert.equal(doublon.statut, 409)
      assert.match(doublon.contenu.erreur, /déjà été envoyée à ce client aujourd’hui/)
      assert.equal(s.appels.length, 1, 'jamais deux fois la même relance le même jour')
      // Un autre modèle le même jour reste possible.
      assert.equal((await s.api('POST', `/commerces/${AH}/clients/${lina.id}/relance`, { modele: 'inactif' }, PIN)).statut, 200)
      // Lendemain (à Paris) : la même relance peut repartir.
      s.horloge.t = new Date('2026-11-11T08:00:00Z')
      assert.equal((await s.api('POST', `/commerces/${AH}/clients/${lina.id}/relance`, { modele: 'proche' }, PIN)).statut, 200)
      assert.equal(s.appels.length, 3)

      const e = await s.envois()
      assert.deepEqual(e.map((x) => [x.clientPrenom, x.modele, x.canal, x.statut, x.jour]), [
        ['Lina', 'proche', 'sms', 'envoye', '2026-11-11'],
        ['Lina', 'inactif', 'sms', 'envoye', '2026-11-10'],
        ['Lina', 'proche', 'sms', 'refuse', '2026-11-10'],
        ['Lina', 'proche', 'sms', 'envoye', '2026-11-10'],
        ['Marc', 'proche', 'sms', 'refuse', '2026-11-10'],
      ])
      assert.equal(e[3].idPrestataire, 'SM1')
      assert.deepEqual((await s.envois(marc.id)).map((x) => x.statut), ['refuse'], 'filtre ?client=')
      assert.doesNotMatch(JSON.stringify(e), /0611111111|\+3361/, 'jamais le numéro dans le journal')
      const etat = (await s.api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu
      assert.equal(etat.envois.length, 5, '/etat fournit le journal des envois')
    } finally {
      await s.app.fermer()
    }
  })

  test('prestataire en erreur (refus 4xx) : 502, statut « erreur » journalisé, nouvel essai possible le même jour', async () => {
    let statut = 400
    const s = await demarrer('relance-erreur.db', { twilio: true, statutPrestataire: () => statut })
    try {
      const c = (await s.api('POST', `/commerces/${AH}/clients`, { contact: '0611111111', consentementRelance: true }, PIN)).contenu.client as Client
      const r = await s.api('POST', `/commerces/${AH}/clients/${c.id}/relance`, { modele: 'bienvenue' }, PIN)
      assert.equal(r.statut, 502)
      assert.match(r.contenu.erreur, /Twilio a refusé l’envoi \(HTTP 400\)/)
      assert.doesNotMatch(r.contenu.erreur, /jeton-twilio-test|ACtest/, 'aucun secret dans le message')
      statut = 201
      assert.equal((await s.api('POST', `/commerces/${AH}/clients/${c.id}/relance`, { modele: 'bienvenue' }, PIN)).statut, 200)
      assert.deepEqual((await s.envois()).map((x) => x.statut), ['envoye', 'erreur'])
      // SMS sans prénom : « bienvenue ! ».
      assert.match(new URLSearchParams(s.appels[1].corps).get('Body')!, /^Asian Home Paris : bienvenue ! Votre carte de fidélité : /)
    } finally {
      await s.app.fermer()
    }
  })

  test('e-mail simulé : objet + corps, lien de désinscription (page + One-Click) qui retire le consentement', async () => {
    const s = await demarrer('relance-email.db', { brevo: true })
    try {
      const c = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Marc', contact: 'marc@exemple.fr', consentementRelance: true }, PIN)).contenu.client as Client
      // Canal par défaut = celui du contact (e-mail) ; demander un SMS à un client sans téléphone : 409 (Twilio absent : 501 d'abord).
      const r = await s.api('POST', `/commerces/${AH}/clients/${c.id}/relance`, { modele: 'anniversaire' }, PIN)
      assert.equal(r.statut, 200)
      assert.equal(r.contenu.canal, 'email')
      const brevo = JSON.parse(s.appels[0].corps)
      assert.equal(brevo.subject, 'Joyeux anniversaire de la part de Asian Home Paris')
      assert.match(brevo.textContent, /^Bonjour Marc,\n\nToute l’équipe de Asian Home Paris vous souhaite un très joyeux anniversaire/)
      assert.ok(brevo.textContent.includes(`Votre carte de fidélité : ${SITE}/#/carte/${c.id}`))
      const lien = /Pour ne plus en recevoir : (\S+)$/.exec(brevo.textContent)![1]
      const [, idLien, jeton] = /#\/desinscription\/([^/]+)\/([^/]+)$/.exec(lien)!
      assert.equal(idLien, c.id)
      assert.equal(brevo.headers['List-Unsubscribe'], `<${SITE}/api/v1/desinscription/${c.id}/${jeton}>`)
      assert.equal(brevo.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')

      assert.equal((await s.api('POST', `/desinscription/${c.id}/${'x'.repeat(jeton.length)}`)).statut, 404, 'jeton faux')
      assert.equal((await s.api('POST', `/desinscription/${c.id}/court`)).statut, 404)
      assert.equal((await s.client(c.id)).consentementRelance, true)
      // One-Click (RFC 8058) : corps formulaire, pas JSON — il n'est pas lu.
      const oneClick = await globalThis.fetch(`${s.racine}/api/v1/desinscription/${c.id}/${jeton}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      })
      assert.equal(oneClick.status, 200)
      assert.deepEqual(await oneClick.json(), { ok: true, commerce: 'Asian Home Paris' })
      const apres = await s.client(c.id)
      assert.deepEqual([apres.consentementRelance, apres.consentementRelanceOrigine], [false, 'lien-email'])
      assert.equal((await s.api('POST', `/desinscription/${c.id}/${jeton}`)).statut, 200, 'idempotent')
      assert.equal((await s.journal()).filter((e) => e.action === 'consentement').length, 1)
      assert.equal((await s.api('POST', `/commerces/${AH}/clients/${c.id}/relance`, { modele: 'inactif' }, PIN)).statut, 409, 'plus de relance après désinscription')
      assert.equal((await s.api('POST', `/commerces/${AH}/clients/${c.id}/relance`, { modele: 'inactif', canal: 'sms' }, PIN)).statut, 501)
    } finally {
      await s.app.fermer()
    }
    // Le lien reste valable après un redémarrage (secret gardé en base, pas en mémoire).
    const s2 = await demarrer('relance-email.db', { brevo: true })
    try {
      const c = (await s2.api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.clients[0] as Client
      await s2.api('PATCH', `/commerces/${AH}/clients/${c.id}`, { consentementRelance: true }, PIN)
      s2.horloge.t = new Date('2026-11-12T10:00:00Z')
      await s2.api('POST', `/commerces/${AH}/clients/${c.id}/relance`, { modele: 'inactif' }, PIN)
      const lien = /#\/desinscription\/[^/]+\/(\S+)$/.exec(JSON.parse(s2.appels[0].corps).textContent)![1]
      assert.equal((await s2.api('POST', `/desinscription/${c.id}/${lien}`)).statut, 200)
    } finally {
      await s2.app.fermer()
    }
  })

  test('lien court des SMS : /c/<id> redirige vers la carte', async () => {
    const s = await demarrer('lien-court.db')
    try {
      const r = await globalThis.fetch(`${s.racine}/c/cl-abc-123`, { redirect: 'manual' })
      assert.equal(r.status, 302)
      assert.equal(r.headers.get('location'), '/#/carte/cl-abc-123')
      assert.equal((await globalThis.fetch(`${s.racine}/c/<script>`, { redirect: 'manual' })).status, 404)
    } finally {
      await s.app.fermer()
    }
  })

  test('lien court de désinscription des SMS (P1-B9) : /d/<id>/<jeton> redirige vers la page de désinscription', async () => {
    const s = await demarrer('lien-court-desinscription.db')
    try {
      const jeton = 'a'.repeat(32)
      const r = await globalThis.fetch(`${s.racine}/d/cl-abc-123/${jeton}`, { redirect: 'manual' })
      assert.equal(r.status, 302)
      assert.equal(r.headers.get('location'), `/#/desinscription/cl-abc-123/${jeton}`)
      // Formats invalides : pas de redirection (le jeton n'est pas vérifié ici, c'est la page qui appelle l'API).
      assert.equal((await globalThis.fetch(`${s.racine}/d/cl-abc-123/court`, { redirect: 'manual' })).status, 404)
      assert.equal((await globalThis.fetch(`${s.racine}/d/cl-abc-123/${'a'.repeat(32)}?x=1`, { redirect: 'manual' })).status, 302)
    } finally {
      await s.app.fermer()
    }
  })
})

describe('Relances automatiques (inactif 30 jours, anniversaire) à l’ouverture du tableau de bord', () => {
  test('réglage validé, désactivé par défaut, jamais exposé publiquement', async () => {
    const s = await demarrer('auto-reglage.db')
    try {
      assert.equal((await s.api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.commerce.relancesAuto, undefined)
      assert.equal((await s.api('PATCH', `/commerces/${AH}`, { relancesAuto: { inactif: 'oui' } }, PIN)).statut, 400)
      assert.equal((await s.api('PATCH', `/commerces/${AH}`, { relancesAuto: { pigeon: true } }, PIN)).statut, 400)
      const ok = await s.api('PATCH', `/commerces/${AH}`, { relancesAuto: { inactif: true } }, PIN)
      assert.deepEqual(ok.contenu.commerce.relancesAuto, { inactif: true, anniversaire: false })
      assert.equal(JSON.stringify((await s.api('GET', `/commerces/${AH}`)).contenu).includes('relancesAuto'), false)
    } finally {
      await s.app.fermer()
    }
  })

  test('avec Twilio simulé : consentants seulement, 1 fois par absence / par an, une tournée par jour', async () => {
    const s = await demarrer('auto-sms.db', { twilio: true })
    try {
      const t = s.horloge.t
      const il = (jours: number) => new Date(t.getTime() - jours * JOUR).toISOString()
      const inscrire = async (prenom: string, contact: string, consentementRelance: boolean, maj: Partial<Client>) => {
        const c = (await s.api('POST', `/commerces/${AH}/clients`, { prenom, contact, consentementRelance }, PIN)).contenu.client as Client
        s.modifier(c.id, maj)
        return c
      }
      const inactif = await inscrire('Ines', '0611111111', true, { derniereVisite: il(40), visites: [il(40)], tampons: 1 })
      const anniv = await inscrire('Adam', '0622222222', true, { derniereVisite: il(3), visites: [il(3)], anniversaire: '11-10' })
      await inscrire('Sans', '0633333333', false, { derniereVisite: il(40), visites: [il(40)] })
      await inscrire('Perdu', '0644444444', true, { derniereVisite: il(200), visites: [il(200)] })
      await inscrire('Fidele', '0655555555', true, { derniereVisite: il(2), visites: [il(2)] })

      // Désactivé : rien.
      await s.api('GET', `/commerces/${AH}/etat`, undefined, PIN)
      await s.app.relancesEnCours()
      assert.equal(s.appels.length, 0)

      await s.api('PATCH', `/commerces/${AH}`, { relancesAuto: { inactif: true, anniversaire: true } }, PIN)
      await s.api('GET', `/commerces/${AH}/etat`, undefined, PIN)
      await s.app.relancesEnCours()
      const e = (await s.envois()).filter((x) => x.declencheur === 'auto')
      assert.deepEqual(e.map((x) => [x.clientId, x.modele, x.statut, x.auteur]).sort(), [
        [anniv.id, 'anniversaire', 'envoye', 'Automatique'],
        [inactif.id, 'inactif', 'envoye', 'Automatique'],
      ].sort())
      assert.equal(s.appels.length, 2)
      const corps = s.appels.map((a) => new URLSearchParams(a.corps).get('Body')!)
      assert.ok(corps.some((b) => /joyeux anniversaire Adam/.test(b)))
      assert.ok(corps.some((b) => /Ines, vous nous manquez/.test(b)))

      // Même jour : pas de 2e tournée.
      await s.api('GET', `/commerces/${AH}/etat`, undefined, PIN)
      await s.app.relancesEnCours()
      assert.equal(s.appels.length, 2)
      // Lendemain : l'inactif a déjà été relancé pour cette absence, l'anniversaire est passé.
      s.horloge.t = new Date(t.getTime() + JOUR)
      await s.api('GET', `/commerces/${AH}/etat`, undefined, PIN)
      await s.app.relancesEnCours()
      assert.equal(s.appels.length, 2)
    } finally {
      await s.app.fermer()
    }
  })

  test('sans prestataire : aucune tournée, aucune ligne 501 en série', async () => {
    const s = await demarrer('auto-sans.db')
    try {
      const c = (await s.api('POST', `/commerces/${AH}/clients`, { contact: '0611111111', consentementRelance: true }, PIN)).contenu.client as Client
      s.modifier(c.id, { derniereVisite: new Date(s.horloge.t.getTime() - 40 * JOUR).toISOString() })
      await s.api('PATCH', `/commerces/${AH}`, { relancesAuto: { inactif: true, anniversaire: true } }, PIN)
      await s.api('GET', `/commerces/${AH}/etat`, undefined, PIN)
      await s.app.relancesEnCours()
      assert.deepEqual(await s.envois(), [])
      assert.equal(s.appels.length, 0)
    } finally {
      await s.app.fermer()
    }
  })
})

describe('SMS via Brevo (prioritaire sur Twilio) — lot « Brancher Brevo »', () => {
  test('relance SMS de bout en bout via Brevo : requête JSON, journal, /sante sms true', async () => {
    const s = await demarrer('brevo-sms.db', { brevoSms: true })
    try {
      assert.deepEqual((await s.api('GET', '/sante')).contenu.integrations, { googleWallet: false, appleWallet: 'en_suspens', googleBusinessProfile: false, sms: true, email: false, smsPrestataire: 'Brevo' })
      const lina = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0611111111', consentementRelance: true }, PIN)).contenu.client as Client
      const ok = await s.api('POST', `/commerces/${AH}/clients/${lina.id}/relance`, { modele: 'proche' }, PIN)
      assert.equal(ok.statut, 200)
      assert.deepEqual([ok.contenu.canal, ok.contenu.modele, ok.contenu.id, ok.contenu.envoi.statut], ['sms', 'proche', '<m1@brevo>', 'envoye'])
      assert.equal(s.appels.length, 1)
      assert.equal(s.appels[0].url, 'https://api.brevo.com/v3/transactionalSMS/send')
      assert.equal(s.appels[0].entetes['api-key'], 'cle-test')
      const corps = JSON.parse(s.appels[0].corps)
      assert.equal(corps.sender, 'ASIANHOME')
      assert.equal(corps.recipient, '+33611111111')
      assert.equal(corps.type, 'transactional')
      assert.equal(corps.tag, 'fidelite')
      // P1-B9 : le SMS Brevo porte le lien court de désinscription, jamais « répondez STOP » (pas de réponse possible).
      assert.doesNotMatch(corps.content, /répondez STOP/i, corps.content)
      const lienSms = new RegExp(`^Asian Home Paris : Lina, plus que 10 tampons avant votre récompense ! ${SITE}/c/${lina.id} STOP : (${SITE}/d/${lina.id}/[A-Za-z0-9_-]{32})$`).exec(corps.content)?.[1]
      assert.ok(lienSms, corps.content)
      assert.deepEqual((await s.envois()).map((x) => [x.canal, x.statut, x.idPrestataire]), [['sms', 'envoye', '<m1@brevo>']])
      // De bout en bout : le lien du SMS désinscrit (même jeton HMAC que les e-mails), puis plus de relance.
      const jetonSms = lienSms.split('/').at(-1)!
      // Le lien court redirige bien vers la page de désinscription (le retrait lui-même n'a lieu qu'au clic, testé
      // côté page dans relances-ui-p1-b3 : aucun retrait automatique à l'ouverture du lien).
      const redirection = await globalThis.fetch(`${s.racine}/d/${lina.id}/${jetonSms}`, { redirect: 'manual' })
      assert.equal(redirection.status, 302)
      assert.equal(redirection.headers.get('location'), `/#/desinscription/${lina.id}/${jetonSms}`)
      assert.equal((await s.api('POST', `/desinscription/${lina.id}/${jetonSms}`)).statut, 200)
      assert.equal((await s.client(lina.id)).consentementRelance, false)
      assert.equal((await s.api('POST', `/commerces/${AH}/clients/${lina.id}/relance`, { modele: 'inactif' }, PIN)).statut, 409, 'plus de relance après désinscription par le lien du SMS')
    } finally {
      await s.app.fermer()
    }
  })

  test('Brevo SMS prioritaire sur Twilio quand les deux sont configurés ; Twilio en repli sinon', async () => {
    const deux = await demarrer('brevo-prioritaire.db', { brevoSms: true, twilio: true })
    try {
      const c = (await deux.api('POST', `/commerces/${AH}/clients`, { contact: '0611111111', consentementRelance: true }, PIN)).contenu.client as Client
      assert.equal((await deux.api('POST', `/commerces/${AH}/clients/${c.id}/relance`, { modele: 'bienvenue' }, PIN)).statut, 200)
      assert.equal(deux.appels.length, 1)
      assert.equal(deux.appels[0].url, 'https://api.brevo.com/v3/transactionalSMS/send')
    } finally {
      await deux.app.fermer()
    }
    const repli = await demarrer('brevo-repli.db', { brevo: true, twilio: true })
    try {
      const c = (await repli.api('POST', `/commerces/${AH}/clients`, { contact: '0611111111', consentementRelance: true }, PIN)).contenu.client as Client
      assert.equal((await repli.api('POST', `/commerces/${AH}/clients/${c.id}/relance`, { modele: 'bienvenue' }, PIN)).statut, 200)
      assert.equal(repli.appels.length, 1)
      assert.match(repli.appels[0].url, /api\.twilio\.com/)
    } finally {
      await repli.app.fermer()
    }
  })

  test('Brevo SMS en erreur (refus 4xx) : 502, statut « erreur » journalisé, aucun secret dans le message', async () => {
    let statut = 400
    const s = await demarrer('brevo-erreur.db', { brevoSms: true, statutPrestataire: () => statut })
    try {
      const c = (await s.api('POST', `/commerces/${AH}/clients`, { contact: '0611111111', consentementRelance: true }, PIN)).contenu.client as Client
      const r = await s.api('POST', `/commerces/${AH}/clients/${c.id}/relance`, { modele: 'bienvenue' }, PIN)
      assert.equal(r.statut, 502)
      assert.match(r.contenu.erreur, /Brevo a refusé l’envoi \(HTTP 400\)/)
      assert.doesNotMatch(r.contenu.erreur, /cle-test/, 'aucun secret dans le message')
      statut = 201
      assert.equal((await s.api('POST', `/commerces/${AH}/clients/${c.id}/relance`, { modele: 'bienvenue' }, PIN)).statut, 200)
      assert.deepEqual((await s.envois()).map((x) => x.statut), ['envoye', 'erreur'])
    } finally {
      await s.app.fermer()
    }
  })

  test('stop-sms avec SMS Brevo : 501 explicite (pas de réponse possible), consentement intact', async () => {
    const s = await demarrer('brevo-stop.db', { brevoSms: true })
    try {
      const c = (await s.api('POST', `/commerces/${AH}/clients`, { contact: '0611111111', consentementRelance: true }, PIN)).contenu.client as Client
      const r = await s.stop({ From: '+33611111111', Body: 'STOP' })
      assert.equal(r.statut, 501)
      assert.match(JSON.parse(r.texte).erreur, /Brevo.*pas de réponse possible.*Aucun consentement n’a été modifié/)
      assert.equal((await s.client(c.id)).consentementRelance, true)
    } finally {
      await s.app.fermer()
    }
  })
})

describe('Mode test Brevo (`BREVO_MODE_TEST=1`, consigne du 10/11/2026 : aucun envoi réel)', () => {
  test('SMS simulé : 200, `envoye: false, test: true`, aucun appel réseau, journal statut « test », /sante modeTest', async () => {
    const s = await demarrer('brevo-test-sms.db', { brevoSms: true, modeTest: true })
    try {
      assert.deepEqual((await s.api('GET', '/sante')).contenu.integrations, { googleWallet: false, appleWallet: 'en_suspens', googleBusinessProfile: false, sms: true, email: false, smsPrestataire: 'Brevo', modeTest: true })
      const lina = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0611111111', consentementRelance: true }, PIN)).contenu.client as Client
      const ok = await s.api('POST', `/commerces/${AH}/clients/${lina.id}/relance`, { modele: 'proche' }, PIN)
      assert.equal(ok.statut, 200)
      assert.deepEqual([ok.contenu.envoye, ok.contenu.test, ok.contenu.canal, ok.contenu.modele, ok.contenu.id], [false, true, 'sms', 'proche', 'test'])
      assert.match(ok.contenu.envoi.raison, /rien envoyé/)
      assert.equal(s.appels.length, 0, 'aucun appel réseau en mode test')
      assert.deepEqual((await s.envois()).map((x) => [x.canal, x.statut, x.idPrestataire]), [['sms', 'test', 'test']])
      // La simulation n'occupe pas le créneau anti-doublon du jour (index partiel sur en_cours / envoye) : une 2e
      // simulation passe, et un vrai envoi resterait possible le même jour une fois le mode test coupé.
      assert.equal((await s.api('POST', `/commerces/${AH}/clients/${lina.id}/relance`, { modele: 'proche' }, PIN)).statut, 200)
      assert.deepEqual((await s.envois()).map((x) => x.statut), ['test', 'test'])
    } finally {
      await s.app.fermer()
    }
  })

  test('e-mail en sandbox Brevo : appel réel simulé avec X-Sib-Sandbox, journal « test », rien livré', async () => {
    const s = await demarrer('brevo-test-email.db', { brevo: true, modeTest: true })
    try {
      const c = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Marc', contact: 'marc@exemple.fr', consentementRelance: true }, PIN)).contenu.client as Client
      const ok = await s.api('POST', `/commerces/${AH}/clients/${c.id}/relance`, { modele: 'anniversaire' }, PIN)
      assert.equal(ok.statut, 200)
      assert.deepEqual([ok.contenu.envoye, ok.contenu.test, ok.contenu.canal], [false, true, 'email'])
      assert.equal(s.appels.length, 1)
      assert.equal(s.appels[0].url, 'https://api.brevo.com/v3/smtp/email')
      const corps = JSON.parse(s.appels[0].corps)
      assert.equal(corps.headers['X-Sib-Sandbox'], 'drop')
      assert.ok(corps.headers['List-Unsubscribe'].includes('/api/v1/desinscription/'), 'List-Unsubscribe conservé en sandbox')
      assert.deepEqual((await s.envois()).map((x) => [x.canal, x.statut]), [['email', 'test']])
    } finally {
      await s.app.fermer()
    }
  })

  test('repli Twilio aussi simulé en mode test (aucun vrai SMS par la porte de derrière)', async () => {
    const s = await demarrer('brevo-test-twilio.db', { twilio: true, modeTest: true })
    try {
      const c = (await s.api('POST', `/commerces/${AH}/clients`, { contact: '0611111111', consentementRelance: true }, PIN)).contenu.client as Client
      const ok = await s.api('POST', `/commerces/${AH}/clients/${c.id}/relance`, { modele: 'bienvenue' }, PIN)
      assert.equal(ok.statut, 200)
      assert.deepEqual([ok.contenu.envoye, ok.contenu.test], [false, true])
      assert.equal(s.appels.length, 0)
      assert.deepEqual((await s.envois()).map((x) => [x.canal, x.statut]), [['sms', 'test']])
    } finally {
      await s.app.fermer()
    }
  })

  test('tournée automatique en mode test : relances simulées, journal « test », aucun appel', async () => {
    const s = await demarrer('brevo-test-auto.db', { brevoSms: true, modeTest: true })
    try {
      const c = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Ines', contact: '0611111111', consentementRelance: true }, PIN)).contenu.client as Client
      s.modifier(c.id, { derniereVisite: new Date(s.horloge.t.getTime() - 40 * JOUR).toISOString(), visites: [new Date(s.horloge.t.getTime() - 40 * JOUR).toISOString()] })
      await s.api('PATCH', `/commerces/${AH}`, { relancesAuto: { inactif: true } }, PIN)
      await s.api('GET', `/commerces/${AH}/etat`, undefined, PIN)
      await s.app.relancesEnCours()
      assert.deepEqual((await s.envois()).map((x) => [x.modele, x.statut, x.declencheur]), [['inactif', 'test', 'auto']])
      assert.equal(s.appels.length, 0)
    } finally {
      await s.app.fermer()
    }
  })
})

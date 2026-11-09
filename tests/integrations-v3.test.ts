// V3 : intégrations « prêtes à brancher » — Google Wallet (charge utile non signée, 501 sans config),
// Apple Wallet en suspens (aucun code de pass), SMS / e-mail (501 sans prestataire, aucun envoi réel),
// avis Google (0 avis fictif en production, étiquette démo), textes de l'UI.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, type OptionsServeur } from '../server/app.ts'
import { ouvrirStockage } from '../server/stockage.ts'
import { ISSUER_PLACEHOLDER, payloadGoogleWallet } from '../server/wallet.ts'
import { configDepuisEnv, creerNotifications } from '../server/notifications/index.ts'
import { nouveauCommerce } from '../src/data/defaults.ts'
import { nouveauClient, validerVisite } from '../src/lib/fidelite.ts'
import seed from '../src/data/seed.json' with { type: 'json' }
import * as textes from '../src/lib/integrations.ts'
import type { Client } from '../src/types.ts'

const ADMIN = '98765432'
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-v3-'))
after(() => rmSync(dossier, { recursive: true, force: true }))

async function demarrer(nom: string, options: Partial<OptionsServeur> = {}) {
  const fichierDb = join(dossier, nom)
  const app = creerServeur({ fichierDb, adminPin: ADMIN, pinInitial: '1234', version: 'test', ...options })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    const type = r.headers.get('content-type') ?? ''
    return { statut: r.status, contenu: type.includes('json') ? await r.json() : await r.text() }
  }
  const inscrire = async (contact: string) => (await api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact }, PIN)).contenu.client as Client
  return { app, api, inscrire, fichierDb }
}

describe('Google Wallet : charge utile non signée', () => {
  const commerce = { ...nouveauCommerce('Chez Lin', 'restaurant', ''), seuilTampons: 3, recompense: 'Un dessert offert' }
  let client = nouveauClient(commerce.id, 'Lina', { telephone: '06 12 34 56 78' })
  client = validerVisite(validerVisite(client, commerce), commerce)

  test('structure Generic pass : champs présents, prénom, tampons x/seuil, récompense, QR vers #/carte/:id', () => {
    const url = `https://exemple.fr/#/carte/${client.id}`
    const p = payloadGoogleWallet(commerce, client, url)
    assert.equal(p.signe, false)
    const [o] = p.genericObjects
    assert.equal(o.classId, p.genericClasses[0].id)
    assert.ok(o.id.startsWith(`${ISSUER_PLACEHOLDER}.`), 'issuer placeholder explicite')
    assert.equal(o.state, 'ACTIVE')
    assert.equal(o.cardTitle.defaultValue.value, 'Chez Lin')
    assert.equal(o.header.defaultValue.value, 'Lina')
    assert.deepEqual(
      o.textModulesData.map((t) => [t.id, t.body]),
      [['tampons', '2/3'], ['recompense', 'Un dessert offert']],
    )
    assert.deepEqual(o.barcode, { type: 'QR_CODE', value: url, alternateText: 'Lina' })
    assert.doesNotMatch(JSON.stringify(p), /06 12|0612|telephone|email/, 'jamais le contact du client dans le pass')
  })

  test('tampons plafonnés au seuil (carte pleine)', () => {
    const plein = { ...client, tampons: 5 }
    assert.equal(payloadGoogleWallet(commerce, plein, 'u').genericObjects[0].textModulesData[0].body, '3/3')
  })

  test('endpoint : 501 sans configuration (même avec le bon PIN), 401 sans PIN', async () => {
    const { app, api, inscrire } = await demarrer('wallet-sans.db')
    try {
      const c = await inscrire('0611111111')
      const r = await api('GET', `/commerces/${AH}/clients/${c.id}/pass.json`, undefined, PIN)
      assert.equal(r.statut, 501)
      assert.match(r.contenu.erreur, /à brancher/)
      assert.equal(r.contenu.payload, undefined, 'aucun pass renvoyé')
      assert.equal((await api('GET', `/commerces/${AH}/clients/${c.id}/pass.json`)).statut, 401)
      // Émetteur sans clé : toujours 501.
      const sante = await api('GET', '/sante')
      assert.deepEqual(sante.contenu.integrations, { googleWallet: false, appleWallet: 'en_suspens', googleBusinessProfile: false, sms: false, email: false })
    } finally {
      await app.fermer()
    }
  })

  test('endpoint configuré : charge utile renvoyée, explicitement NON signée', async () => {
    const { app, api, inscrire } = await demarrer('wallet-avec.db', {
      googleWallet: { issuerId: '3388000000000000000', fichierCleService: '/inexistant/cle.json' },
      urlPublique: 'https://fidelite.exemple/',
    })
    try {
      const c = await inscrire('0622222222')
      const r = await api('GET', `/commerces/${AH}/clients/${c.id}/pass.json`, undefined, PIN)
      assert.equal(r.statut, 200)
      assert.match(r.contenu.avertissement, /NON signée/)
      assert.equal(r.contenu.payload.signe, false)
      const o = r.contenu.payload.genericObjects[0]
      assert.ok(o.id.startsWith('3388000000000000000.'))
      assert.equal(o.barcode.value, `https://fidelite.exemple/#/carte/${c.id}`)
    } finally {
      await app.fermer()
    }
  })
})

describe('Apple Wallet : en suspens', () => {
  /** Tous les fichiers de code (pas la doc ni les tests). */
  function fichiersCode(d: string): string[] {
    return readdirSync(d).flatMap((n) => {
      const p = join(d, n)
      return statSync(p).isDirectory() ? fichiersCode(p) : /\.(ts|tsx|mjs|js)$/.test(n) ? [p] : []
    })
  }

  test('aucun code de génération ou de signature de pass Apple dans server/, src/, scripts/', () => {
    const racine = join(import.meta.dirname, '..')
    // Les scripts de preuve HTTP (scripts/preuve-*) appellent seulement l'URL d'un pass Apple pour montrer le 404 : exclus.
    const fichiers = ['server', 'src', 'scripts'].flatMap((d) => fichiersCode(join(racine, d))).filter((f) => !/[\\/]preuve-[^\\/]+$/.test(f))
    assert.ok(fichiers.length > 20)
    for (const f of fichiers) {
      const contenu = readFileSync(f, 'utf8')
      assert.doesNotMatch(contenu, /pkpass|vnd\.apple|passTypeIdentifier|manifest\.json|signpass|pkcs7/i, f)
    }
  })

  test('aucune route ne sert de pass Apple', async () => {
    const { app, api, inscrire } = await demarrer('apple.db')
    try {
      const c = await inscrire('0633333333')
      for (const chemin of [`/commerces/${AH}/clients/${c.id}/pass.pkpass`, `/commerces/${AH}/clients/${c.id}/pass`]) {
        const r = await api('GET', chemin, undefined, PIN)
        assert.equal(r.statut, 404, chemin)
      }
    } finally {
      await app.fermer()
    }
  })
})

describe('SMS / e-mail : branchements préparés, aucun envoi', () => {
  test('sans clé : 501 « à brancher » pour SMS et e-mail, aucun appel réseau', async () => {
    let appels = 0
    const { app, api, inscrire } = await demarrer('notif-sans.db', {
      notifications: { fetch: async () => (appels++, new Response('{}')) },
    })
    try {
      const c = await inscrire('0644444444')
      for (const canal of ['sms', 'email']) {
        const r = await api('POST', `/commerces/${AH}/clients/${c.id}/relance`, { canal }, PIN)
        assert.equal(r.statut, 501, canal)
        assert.match(r.contenu.erreur, /à brancher.*Rien n’a été envoyé/)
      }
      assert.equal((await api('POST', `/commerces/${AH}/clients/${c.id}/relance`, { canal: 'pigeon' }, PIN)).statut, 400)
      assert.equal((await api('POST', `/commerces/${AH}/clients/${c.id}/relance`, { canal: 'sms' })).statut, 401)
      assert.equal(appels, 0)
    } finally {
      await app.fermer()
    }
  })

  test('configuration lue dans l’environnement : incomplète = non configurée', () => {
    assert.deepEqual(creerNotifications(configDepuisEnv({})).statut(), { sms: false, email: false })
    assert.deepEqual(creerNotifications(configDepuisEnv({ TWILIO_ACCOUNT_SID: 'AC1', BREVO_API_KEY: 'k' })).statut(), { sms: false, email: false })
    const env = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: '+33700000000', BREVO_API_KEY: 'k', BREVO_SENDER_EMAIL: 'a@b.fr' }
    assert.deepEqual(creerNotifications(configDepuisEnv(env)).statut(), { sms: true, email: true })
  })

  test('avec prestataire (fetch simulé, aucune vraie clé) : refus sans consentement, puis requêtes Twilio / Brevo bien formées', async () => {
    const requetes: { url: string; init: RequestInit }[] = []
    const fauxFetch = (async (url: string, init: RequestInit) => {
      requetes.push({ url, init })
      return new Response(JSON.stringify({ sid: 'SM1', messageId: '<m1>' }), { status: 201 })
    }) as unknown as typeof fetch
    const { app, api, inscrire, fichierDb } = await demarrer('notif-avec.db', {
      notifications: {
        twilio: { accountSid: 'ACtest', authToken: 'jeton', expediteur: '+33700000000' },
        brevo: { cleApi: 'cle-test', expediteurEmail: 'contact@exemple.fr', expediteurNom: 'Asian Home Paris' },
        fetch: fauxFetch,
      },
    })
    try {
      const sms = await inscrire('06 55 55 55 55')
      const mail = await inscrire('lina@exemple.fr')
      // Pas de consentement : rien n'est envoyé.
      assert.equal((await api('POST', `/commerces/${AH}/clients/${sms.id}/relance`, { canal: 'sms' }, PIN)).statut, 409)
      assert.equal(requetes.length, 0)

      // Consentement posé directement en base (aucun écran ne le recueille encore).
      const st = ouvrirStockage(fichierDb)
      for (const c of [sms, mail]) st.majClient({ ...st.client(AH, c.id)!, consentementRelance: true })
      st.fermer()

      assert.equal((await api('POST', `/commerces/${AH}/clients/${sms.id}/relance`, { canal: 'email' }, PIN)).statut, 409, 'pas d’e-mail')
      const r = await api('POST', `/commerces/${AH}/clients/${sms.id}/relance`, { canal: 'sms' }, PIN)
      assert.equal(r.statut, 200)
      assert.deepEqual(r.contenu, { envoye: true, canal: 'sms', id: 'SM1' })
      const t = requetes[0]
      assert.equal(t.url, 'https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json')
      const corps = new URLSearchParams(String(t.init.body))
      assert.equal(corps.get('To'), '+33655555555')
      assert.equal(corps.get('From'), '+33700000000')
      assert.match(corps.get('Body')!, /^Bonjour Lina.*STOP/)

      const e = await api('POST', `/commerces/${AH}/clients/${mail.id}/relance`, { canal: 'email', message: 'Revenez nous voir !' }, PIN)
      assert.equal(e.statut, 200)
      const b = requetes[1]
      assert.equal(b.url, 'https://api.brevo.com/v3/smtp/email')
      assert.equal((b.init.headers as Record<string, string>)['api-key'], 'cle-test')
      const json = JSON.parse(String(b.init.body))
      assert.deepEqual(json.to, [{ email: 'lina@exemple.fr' }])
      assert.match(json.textContent, /^Revenez nous voir !\n\nPour ne plus recevoir/)
    } finally {
      await app.fermer()
    }
  })
})

describe('Avis Google : jamais de faux avis présentés comme réels', () => {
  test('production (DEMO=0) : Asian Home démarre avec 0 avis, aucun avis fictif du seed', async () => {
    const { app, api } = await demarrer('prod.db', { production: true })
    try {
      const etat = await api('GET', `/commerces/${AH}/etat`, undefined, PIN)
      assert.equal(etat.contenu.avis.length, 0)
      const auteursFictifs = (seed.avis as { auteur: string }[]).map((a) => a.auteur)
      assert.ok(auteursFictifs.length > 0)
      assert.ok(!auteursFictifs.some((a) => JSON.stringify(etat.contenu).includes(a)))
      assert.equal((await api('GET', '/sante')).contenu.integrations.googleBusinessProfile, false)
    } finally {
      await app.fermer()
    }
  })

  test('textes : démo étiquetée « avis simulés », production vide avec « Connectez Google Business Profile »', () => {
    assert.equal(textes.TEXTE_AVIS_DEMO, 'Démo — avis simulés, aucune connexion à Google')
    assert.match(textes.TEXTE_AVIS_VIDE_PRODUCTION, /^Connectez Google Business Profile pour importer vos avis/)
    assert.equal(textes.SCOPE_GOOGLE_BUSINESS, 'https://www.googleapis.com/auth/business.manage')
    assert.ok(textes.ETAPES_CONNEXION_GOOGLE.some((e) => e.includes(textes.SCOPE_GOOGLE_BUSINESS)))
  })

  test('la page Avis utilise ces textes (démo → badge, production → état vide + « Connecter Google »)', () => {
    const avis = readFileSync(join(import.meta.dirname, '../src/pages/Avis.tsx'), 'utf8')
    assert.match(avis, /estDemo \? \(\s*<BadgeDemo>\{TEXTE_AVIS_DEMO\}/)
    assert.match(avis, /avis\.length === 0 && !estDemo \? \(\s*<Vide>\{TEXTE_AVIS_VIDE_PRODUCTION\}/)
    assert.match(avis, /!estDemo && <ConnecterGoogle \/>/)
  })
})

describe('Textes : aucune promesse d’ajout ou d’envoi réel', () => {
  test('Wallet « à brancher » + lien vers la carte ; relances « à brancher » ; RGPD complet', () => {
    assert.equal(textes.LIBELLE_WALLET, 'Ajouter à Wallet — à brancher')
    assert.match(textes.EXPLICATION_WALLET, /aucun pass/)
    assert.equal(textes.MENTION_ENVOI, 'Envoi SMS/e-mail à brancher')
    const rgpd = textes.MENTIONS_RGPD.join(' ')
    for (const mot of [/prénom/, /téléphone ou e-mail/, /Finalité/, /Conservation/, /Export/, /suppression/, /Hébergement/, /Union européenne/]) assert.match(rgpd, mot)
  })
})

// V3 : intégrations « prêtes à brancher » — Google Wallet (charge utile non signée, 501 sans config),
// Apple Wallet en suspens (aucun code de pass), SMS / e-mail (501 sans prestataire, aucun envoi réel),
// avis Google (0 avis fictif en production, étiquette démo), textes de l'UI.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash, createVerify, generateKeyPairSync } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, type OptionsServeur } from '../server/app.ts'
import { ouvrirStockage } from '../server/stockage.ts'
import { enregistrerClasseGoogle, ISSUER_PLACEHOLDER, jetonAccesGoogle, payloadGoogleWallet } from '../server/wallet.ts'
import { appleWalletConfigure, construirePkpass, crc32, ErreurAppleNonConfigure, manifeste, passJsonApple, signatureCms, zip } from '../server/wallet-apple.ts'
import { execFileSync } from 'node:child_process'
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
  const app = await creerServeur({ fichierDb, adminPin: ADMIN, pinInitial: '1234', version: 'test', ...options })
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

  test('configuré mais clé illisible : 503, aucun pass généré', async () => {
    const { app, api, inscrire } = await demarrer('wallet-cle-absente.db', {
      googleWallet: { issuerId: '3388000000000000000', fichierCleService: '/inexistant/cle.json' },
    })
    try {
      const c = await inscrire('0622222220')
      const r = await api('GET', `/commerces/${AH}/clients/${c.id}/pass.json`, undefined, PIN)
      assert.equal(r.statut, 503)
      assert.match(r.contenu.erreur, /aucun pass généré/)
      assert.equal(r.contenu.urlEnregistrement, undefined)
    } finally {
      await app.fermer()
    }
  })

  test('configuré avec une clé de TEST (générée ici, pas un compte Google) : JWT RS256 signé et vérifiable', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const fichierCle = join(dossier, 'cle-test.json')
    writeFileSync(fichierCle, JSON.stringify({ client_email: 'test@projet-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }))
    const { app, api, inscrire } = await demarrer('wallet-avec.db', {
      googleWallet: { issuerId: '3388000000000000000', fichierCleService: fichierCle },
      urlPublique: 'https://fidelite.exemple/',
    })
    try {
      const c = await inscrire('0622222222')
      const r = await api('GET', `/commerces/${AH}/clients/${c.id}/pass.json`, undefined, PIN)
      assert.equal(r.statut, 200)
      assert.equal(r.contenu.signe, true)
      const jwt = String(r.contenu.urlEnregistrement).replace('https://pay.google.com/gp/v/save/', '')
      const [t, corps, sig] = jwt.split('.')
      assert.ok(createVerify('RSA-SHA256').update(`${t}.${corps}`).verify(publicKey, Buffer.from(sig, 'base64url')), 'signature RS256 valide')
      const claims = JSON.parse(Buffer.from(corps, 'base64url').toString())
      assert.equal(claims.aud, 'google')
      assert.equal(claims.typ, 'savetowallet')
      assert.equal(claims.iss, 'test@projet-test.iam.gserviceaccount.com')
      const o = claims.payload.genericObjects[0]
      assert.ok(o.id.startsWith('3388000000000000000.'))
      assert.equal(o.barcode.value, `https://fidelite.exemple/#/carte/${c.id}`)
      assert.doesNotMatch(JSON.stringify(claims), /0622222222|telephone/)
    } finally {
      await app.fermer()
    }
  })

  test('API REST Google Wallet (fetch simulé) : jeton OAuth JWT-bearer puis création de classe', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const cle = { client_email: 'test@x.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string }
    const appels: { url: string; init: RequestInit }[] = []
    const f = (async (url: string, init: RequestInit) => {
      appels.push({ url, init })
      return url.includes('oauth2') ? new Response(JSON.stringify({ access_token: 'jeton-test' })) : new Response('{}', { status: 409 })
    }) as unknown as typeof fetch
    const jeton = await jetonAccesGoogle(cle, f)
    assert.equal(jeton, 'jeton-test')
    assert.equal(new URLSearchParams(String(appels[0].init.body)).get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer')
    assert.equal(await enregistrerClasseGoogle({ ...nouveauCommerce('X', 'autre', ''), id: 'c-x' }, '33880', jeton, f), 'existante')
    assert.equal(appels[1].url, 'https://walletobjects.googleapis.com/walletobjects/v1/genericClass')
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

  // 09/11/2026 (mission Cartiz) : l'utilisateur demande le VRAI code de génération, qui doit refuser sans certificat.
  // Ce code vit uniquement dans server/wallet-apple.ts et n'est branché sur aucune route.
  test('code de pass Apple confiné à server/wallet-apple.ts, importé par aucun autre fichier', () => {
    const racine = join(import.meta.dirname, '..')
    const fichiers = ['server', 'src', 'scripts'].flatMap((d) => fichiersCode(join(racine, d))).filter((f) => !/[\\/]preuve-[^\\/]+$/.test(f))
    assert.ok(fichiers.length > 20)
    for (const f of fichiers) {
      if (f.endsWith(join('server', 'wallet-apple.ts'))) continue
      const contenu = readFileSync(f, 'utf8')
      assert.doesNotMatch(contenu, /from\s+['"][^'"]*wallet-apple|vnd\.apple|passTypeIdentifier|signpass|pkcs7|construirePkpass/i, f)
    }
  })

  test('sans certificat : construirePkpass refuse, rien n’est signé', () => {
    assert.equal(appleWalletConfigure(undefined), false)
    assert.equal(appleWalletConfigure({ passTypeIdentifier: 'pass.x', teamIdentifier: 'ABCDE12345' }), false)
    assert.throws(() => construirePkpass({ 'pass.json': Buffer.from('{}') }, undefined), ErreurAppleNonConfigure)
    assert.throws(() => construirePkpass({ 'pass.json': Buffer.from('{}') }, { passTypeIdentifier: 'pass.x', teamIdentifier: 'T' }), /aucun pass n’est signé/i)
  })

  test('signature CMS détachée acceptée par OpenSSL (certificat auto-signé de TEST, octets quelconques — pas un pass)', (t) => {
    const ossl = (args: string[]) => execFileSync('openssl', args, { stdio: 'pipe' })
    try {
      ossl(['version'])
    } catch {
      return t.skip('openssl absent de cette machine')
    }
    const d = mkdtempSync(join(dossier, 'cms-'))
    const [cle, cert, ca, caCle] = ['cle.pem', 'cert.pem', 'ca.pem', 'ca-cle.pem'].map((n) => join(d, n))
    ossl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', caCle, '-out', ca, '-days', '1', '-subj', '/CN=AC de test'])
    ossl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', cle, '-out', cert, '-days', '1', '-subj', '/CN=Signataire de test'])
    const contenu = Buffer.from('{"exemple.txt":"0123"}')
    const sig = signatureCms(contenu, readFileSync(cert, 'utf8'), readFileSync(cle, 'utf8'), readFileSync(ca, 'utf8'))
    writeFileSync(join(d, 'sig.der'), sig)
    writeFileSync(join(d, 'contenu'), contenu)
    // -noverify : on vérifie la signature et le condensat, pas la chaîne (certificats de test).
    ossl(['cms', '-verify', '-binary', '-noverify', '-inform', 'DER', '-in', join(d, 'sig.der'), '-content', join(d, 'contenu'), '-out', join(d, 'sortie')])
    writeFileSync(join(d, 'altere'), Buffer.from('{"exemple.txt":"9999"}'))
    assert.throws(() => ossl(['cms', '-verify', '-binary', '-noverify', '-inform', 'DER', '-in', join(d, 'sig.der'), '-content', join(d, 'altere'), '-out', join(d, 'sortie2')]))
  })

  test('pass.json (storeCard) et manifeste SHA-1 corrects ; zip relisible (CRC)', () => {
    const commerce = { ...nouveauCommerce('Chez Lin', 'restaurant', ''), seuilTampons: 4 }
    const client = { ...nouveauClient(commerce.id, 'Lina', { telephone: '0612345678' }), tampons: 2, points: 30 }
    const p = passJsonApple(commerce, client, 'https://x/#/carte/1', { passTypeIdentifier: 'pass.x', teamIdentifier: 'T' })
    assert.equal(p.storeCard.primaryFields[0].value, '2/4')
    assert.equal(p.backgroundColor, 'rgb(179, 38, 45)')
    assert.doesNotMatch(JSON.stringify(p), /0612345678/)
    const fichiers = { 'pass.json': Buffer.from(JSON.stringify(p)), 'icon.png': Buffer.from([1, 2, 3]) }
    assert.equal(manifeste(fichiers)['icon.png'], createHash('sha1').update(Buffer.from([1, 2, 3])).digest('hex'))
    const z = zip(fichiers)
    assert.equal(z.readUInt32LE(0), 0x04034b50)
    assert.equal(z.readUInt32LE(14), crc32(fichiers['pass.json']))
    assert.equal(z.readUInt32LE(z.length - 22), 0x06054b50)
    assert.equal(z.readUInt16LE(z.length - 22 + 10), 2)
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

      // Consentement posé directement en base (P1-B3 : aussi recueilli par les écrans, testé dans relances-p1-b3).
      const st = ouvrirStockage(fichierDb)
      for (const c of [sms, mail]) st.majClient({ ...st.client(AH, c.id)!, consentementRelance: true })
      st.fermer()

      assert.equal((await api('POST', `/commerces/${AH}/clients/${sms.id}/relance`, { canal: 'email' }, PIN)).statut, 409, 'pas d’e-mail')
      const r = await api('POST', `/commerces/${AH}/clients/${sms.id}/relance`, { canal: 'sms' }, PIN)
      assert.equal(r.statut, 200)
      assert.deepEqual([r.contenu.envoye, r.contenu.canal, r.contenu.modele, r.contenu.id, r.contenu.envoi.statut], [true, 'sms', 'inactif', 'SM1', 'envoye'])
      const t = requetes[0]
      assert.equal(t.url, 'https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json')
      const corps = new URLSearchParams(String(t.init.body))
      assert.equal(corps.get('To'), '+33655555555')
      assert.equal(corps.get('From'), '+33700000000')
      assert.match(corps.get('Body')!, /^Asian Home Paris : Lina, vous nous manquez.*STOP : répondez STOP$/)

      const e = await api('POST', `/commerces/${AH}/clients/${mail.id}/relance`, { canal: 'email', message: 'Revenez nous voir !' }, PIN)
      assert.equal(e.statut, 200)
      const b = requetes[1]
      assert.equal(b.url, 'https://api.brevo.com/v3/smtp/email')
      assert.equal((b.init.headers as Record<string, string>)['api-key'], 'cle-test')
      const json = JSON.parse(String(b.init.body))
      assert.deepEqual(json.to, [{ email: 'lina@exemple.fr' }])
      assert.match(json.textContent, /^Bonjour Lina,\n\nRevenez nous voir !\n\n[\s\S]*Pour ne plus en recevoir : http:\/\/127\.0\.0\.1:\d+\/#\/desinscription\//)
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
    // Mission Cartiz : « Carte Wallet : bientôt », encart d'information (plus de bouton « Ajouter »).
    assert.equal(textes.LIBELLE_WALLET, 'Carte Wallet : bientôt')
    assert.match(textes.EXPLICATION_WALLET, /Aucun pass/)
    assert.deepEqual(textes.ETATS_WALLET, ['Apple Wallet : en suspens.', 'Google Wallet : à brancher (aucun compte émetteur pour l’instant).'])
    const ui = readFileSync(join(import.meta.dirname, '../src/components/ui.tsx'), 'utf8')
    const encart = ui.slice(ui.indexOf('export function EncartWallet'), ui.indexOf('/** Mentions RGPD'))
    assert.doesNotMatch(encart, /<button/, 'aucun bouton qui prétendrait ajouter une carte')
    assert.doesNotMatch(readFileSync(join(import.meta.dirname, '../src/lib/integrations.ts'), 'utf8'), /Ajouter à (Apple|Google)? ?Wallet/)
    // P1-B3 : la relance est branchée, mais n'envoie rien sans prestataire configuré ni consentement.
    assert.match(textes.MENTION_ENVOI, /seulement si Twilio .* ou Brevo .* est configuré .* et que le client a consenti/)
    const rgpd = textes.MENTIONS_RGPD.join(' ')
    for (const mot of [/prénom/, /téléphone ou e-mail/, /Finalité/, /Conservation/, /Export/, /suppression/, /Hébergement/, /Union européenne/]) assert.match(rgpd, mot)
  })
})

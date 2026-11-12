// P1-C3 — Carte de fidélité + PWA : manifest et icônes, service worker (source, service HTTP, build), « Carte
// introuvable » avec message générique (audit F-12), lots en attente avec expiration, historique, animation des
// tampons, encart Wallet replié. AUCUN appel réseau réel : les prestataires SMS / e-mail sont simulés (fetch injecté).
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur, type OptionsServeur } from '../server/app.ts'
import { finDuJour, historiqueCarte, lotsEnAttente, messageRechercheCarte, tamponsNouveaux, texteExpiration, texteProgression, type LotHistorique } from '../src/lib/carte.ts'
import { doitEnregistrer, CHEMIN_SERVICE_WORKER } from '../src/lib/pwa.ts'
import { nouveauClient } from '../src/lib/fidelite.ts'
import type { Client } from '../src/types.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')
const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const SITE = 'https://asian-home-fidelite.onrender.com'
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p1-c3-'))
after(() => rmSync(dossier, { recursive: true, force: true }))

/** Largeur × hauteur lues dans l'en-tête IHDR d'un PNG. */
function taillePng(chemin: string): [number, number] {
  const o = readFileSync(join(RACINE, chemin))
  assert.equal(o.subarray(1, 4).toString('latin1'), 'PNG', `${chemin} n'est pas un PNG`)
  return [o.readUInt32BE(16), o.readUInt32BE(20)]
}

// ---------- Manifest et icônes ----------

describe('PWA : manifest et icônes', () => {
  const manifest = JSON.parse(lire('public/manifest.webmanifest'))

  test('manifest JSON valide : nom, nom court, démarrage, affichage autonome, couleurs #111111', () => {
    assert.equal(manifest.name, 'Asian Home Fidélité')
    assert.ok(manifest.short_name && manifest.short_name.length <= 12, 'nom court lisible sous l’icône')
    assert.equal(manifest.lang, 'fr')
    assert.equal(manifest.start_url, '/')
    assert.equal(manifest.scope, '/')
    assert.equal(manifest.display, 'standalone')
    assert.equal(manifest.theme_color, '#111111')
    assert.equal(manifest.background_color, '#111111')
  })

  test('icônes 192 et 512 (dont une maskable) : fichiers présents, PNG aux dimensions déclarées', () => {
    const tailles = manifest.icons.map((i: { sizes: string }) => i.sizes)
    assert.ok(tailles.includes('192x192') && tailles.includes('512x512'))
    assert.ok(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable'))
    for (const i of manifest.icons as { src: string; sizes: string; type: string }[]) {
      assert.equal(i.type, 'image/png')
      const [l, h] = taillePng(join('public', i.src))
      assert.equal(`${l}x${h}`, i.sizes, i.src)
    }
    assert.deepEqual(taillePng('public/icones/apple-touch-icon.png'), [180, 180])
  })

  test('index.html : lien vers le manifest, theme-color #111111, icône Apple', () => {
    const html = lire('index.html')
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest" \/>/)
    assert.match(html, /<meta name="theme-color" content="#111111" \/>/)
    assert.match(html, /<link rel="apple-touch-icon" href="\/icones\/apple-touch-icon\.png" \/>/)
  })
})

// ---------- Service worker ----------

describe('PWA : service worker', () => {
  const sw = lire('public/sw.js')

  test('enregistré par main.tsx via src/lib/pwa.ts, seulement en production, https / localhost et navigateur compatible', () => {
    assert.match(lire('src/main.tsx'), /enregistrerServiceWorker\(import\.meta\.env\.PROD\)/)
    assert.equal(CHEMIN_SERVICE_WORKER, '/sw.js')
    assert.match(lire('src/lib/pwa.ts'), /navigator\.serviceWorker\.register\(CHEMIN_SERVICE_WORKER, \{ scope: '\/' \}\)/)
    assert.equal(doitEnregistrer({ production: true, compatible: true, securise: true }), true)
    assert.equal(doitEnregistrer({ production: false, compatible: true, securise: true }), false, 'jamais en dev (Vite)')
    assert.equal(doitEnregistrer({ production: true, compatible: false, securise: true }), false)
    assert.equal(doitEnregistrer({ production: true, compatible: true, securise: false }), false)
  })

  test('JavaScript valide ; l’API (/api/…) et les requêtes non GET ne passent jamais par le cache (file hors ligne de la caisse)', () => {
    assert.doesNotThrow(() => new Function(sw))
    assert.match(sw, /if \(requete\.method !== 'GET'\) return/)
    assert.match(sw, /url\.origin !== self\.location\.origin \|\| url\.pathname\.startsWith\('\/api\/'\)\) return/)
    // Pages : réseau d'abord, puis l'app en cache, puis la page hors ligne.
    assert.match(sw, /caches\.match\('\/'\)\) \|\| \(await caches\.match\(PAGE_HORS_LIGNE\)\)/)
    // Les anciens caches sont supprimés à l'activation.
    assert.match(sw, /caches\.delete\(k\)/)
  })

  test('tous les fichiers préchargés existent dans public/ (sinon l’installation du service worker échoue)', () => {
    const liste = /const A_PRECHARGER = \[([^\]]+)\]/.exec(sw)![1]
    const fichiers = [...liste.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((f) => f !== '/')
    assert.ok(fichiers.length >= 4)
    for (const f of fichiers) assert.ok(existsSync(join(RACINE, 'public', f)), f)
    assert.match(liste, /PAGE_HORS_LIGNE/)
    assert.ok(existsSync(join(RACINE, 'public/hors-ligne.html')))
  })

  test('page hors ligne minimale : sans script ni style inline (CSP), feuille liée, bouton Réessayer', () => {
    const html = lire('public/hors-ligne.html')
    assert.doesNotMatch(html, /<script|<style|style="/)
    assert.match(html, /<link rel="stylesheet" href="\/hors-ligne\.css" \/>/)
    assert.match(html, /href="\/">Réessayer</)
    assert.ok(existsSync(join(RACINE, 'public/hors-ligne.css')))
  })

  test('survit au build Vite : copié tel quel dans dist/ (vérifié si dist/ existe)', (t) => {
    // dist/ absent ou d'avant P1-C3 (index.html sans manifest) : build périmé, rien à vérifier.
    if (!existsSync(join(RACINE, 'dist/index.html')) || !lire('dist/index.html').includes('manifest.webmanifest')) return t.skip('dist/ absent ou périmé : lancer npm run build')
    for (const f of ['sw.js', 'manifest.webmanifest', 'hors-ligne.html', 'hors-ligne.css', 'icones/icone-512.png']) assert.ok(existsSync(join(RACINE, 'dist', f)), f)
    assert.equal(lire('dist/sw.js'), sw)
    assert.match(lire('dist/index.html'), /<link rel="manifest" href="\/manifest\.webmanifest"/)
  })

  test('servi par le serveur : sw.js et manifest en no-cache, bons types MIME, CSP manifest-src / worker-src', async () => {
    const statique = mkdtempSync(join(dossier, 'dist-'))
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(statique, 'index.html'), '<!doctype html><title>x</title>')
    writeFileSync(join(statique, 'sw.js'), sw)
    writeFileSync(join(statique, 'manifest.webmanifest'), lire('public/manifest.webmanifest'))
    const s = await demarrer('statique.db', {}, { dossierStatique: statique })
    try {
      const js = await fetch(`${s.racine}/sw.js`)
      assert.equal(js.status, 200)
      assert.match(js.headers.get('content-type')!, /^text\/javascript/)
      assert.equal(js.headers.get('cache-control'), 'no-cache')
      const m = await fetch(`${s.racine}/manifest.webmanifest`)
      assert.equal(m.status, 200)
      assert.equal(m.headers.get('content-type'), 'application/manifest+json')
      assert.equal(m.headers.get('cache-control'), 'no-cache')
      const csp = js.headers.get('content-security-policy') ?? ''
      assert.match(csp, /manifest-src 'self'/)
      assert.match(csp, /worker-src 'self'/)
    } finally {
      await s.app.fermer()
    }
  })
})

// ---------- « Carte introuvable » : message générique (F-12) ----------

async function demarrer(nom: string, o: { twilio?: boolean; brevo?: boolean } = {}, options: Partial<OptionsServeur> = {}) {
  const horloge = { t: new Date(2026, 10, 10, 12, 0) }
  const appels: { url: string; corps: string }[] = []
  const fetchFaux = (async (url: string, init: RequestInit) => {
    appels.push({ url, corps: String(init.body) })
    return new Response(JSON.stringify({ sid: `SM${appels.length}`, messageId: `<m${appels.length}@brevo>` }), { status: 201 })
  }) as unknown as typeof globalThis.fetch
  const app = await creerServeur({
    fichierDb: join(dossier, nom),
    adminPin: '98765432',
    pinInitial: '1234',
    version: 'test',
    urlPublique: SITE,
    maintenant: () => horloge.t,
    limitesPubliques: { inscriptionParIp: 1000, inscriptionParContact: 1000, ficheClientParIp: 1000, lectureParIp: 1000, tirageParIp: 1000, tirageParContact: 1000 },
    notifications: {
      ...(o.twilio ? { twilio: { accountSid: 'ACtest', authToken: 'jeton-twilio-test', expediteur: '+33700000000' } } : {}),
      ...(o.brevo ? { brevo: { cleApi: 'cle-test', expediteurEmail: 'contact@exemple.fr', expediteurNom: 'Asian Home Paris' } } : {}),
      fetch: fetchFaux,
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
    return { statut: r.status, texte: await r.text() }
  }
  const json = async (methode: string, chemin: string, corps?: unknown, entetes?: Record<string, string>) => {
    const r = await api(methode, chemin, corps, entetes)
    return { statut: r.statut, contenu: JSON.parse(r.texte) }
  }
  return { app, api, json, appels, horloge, racine }
}

describe('« Carte introuvable » : retrouver sa carte sans révéler si le contact existe (audit F-12)', () => {
  test('sans prestataire : réponse identique (statut et corps, octet pour octet) pour un client et un inconnu ; rien n’est envoyé', async () => {
    const s = await demarrer('retrouver-sans.db')
    try {
      assert.equal((await s.json('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0611111111' }, PIN)).statut, 201)
      const connu = await s.api('POST', '/cartes/retrouver', { contact: '06 11 11 11 11' })
      const inconnu = await s.api('POST', '/cartes/retrouver', { contact: '0699999999' })
      const mail = await s.api('POST', '/cartes/retrouver', { contact: 'personne@exemple.fr' })
      assert.equal(connu.statut, 202)
      assert.deepEqual(connu, inconnu)
      assert.deepEqual(JSON.parse(connu.texte), { ok: true, envoi: false })
      assert.deepEqual(mail, connu)
      await s.app.relancesEnCours()
      assert.equal(s.appels.length, 0)
    } finally {
      await s.app.fermer()
    }
  })

  test('avec SMS : même réponse 202 pour tous ; seul un vrai client reçoit son lien court /c/<id>, après la réponse', async () => {
    const s = await demarrer('retrouver-sms.db', { twilio: true })
    try {
      const lina = (await s.json('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0611111111' }, PIN)).contenu.client as Client
      const connu = await s.api('POST', '/cartes/retrouver', { contact: '+33 6 11 11 11 11' })
      const inconnu = await s.api('POST', '/cartes/retrouver', { contact: '0699999999' })
      assert.equal(connu.statut, 202)
      assert.deepEqual(connu, inconnu)
      assert.deepEqual(JSON.parse(connu.texte), { ok: true, envoi: true })
      await s.app.relancesEnCours()
      assert.equal(s.appels.length, 1, 'aucun SMS pour un numéro inconnu')
      const corps = new URLSearchParams(s.appels[0].corps)
      assert.equal(corps.get('To'), '+33611111111')
      assert.equal(corps.get('Body'), `Asian Home Paris : votre carte de fidélité ${SITE}/c/${lina.id}`)
      // Canal e-mail sans Brevo : rien n'est cherché, réponse identique pour tous.
      assert.deepEqual(JSON.parse((await s.api('POST', '/cartes/retrouver', { contact: 'lina@exemple.fr' })).texte), { ok: true, envoi: false })
    } finally {
      await s.app.fermer()
    }
  })

  test('avec e-mail : lien #/carte/<id> ; 3 envois max par contact et par 24 h, la réponse ne change pas', async () => {
    const s = await demarrer('retrouver-email.db', { brevo: true })
    try {
      const marc = (await s.json('POST', `/commerces/${AH}/clients`, { prenom: 'Marc', contact: 'marc@exemple.fr' }, PIN)).contenu.client as Client
      const reponses = []
      for (let i = 0; i < 5; i++) reponses.push(await s.api('POST', '/cartes/retrouver', { contact: ' Marc@Exemple.fr ' }))
      assert.ok(reponses.every((r) => r.statut === 202 && r.texte === reponses[0].texte))
      await s.app.relancesEnCours()
      assert.equal(s.appels.length, 3)
      const brevo = JSON.parse(s.appels[0].corps)
      assert.equal(brevo.subject, 'Votre carte de fidélité Asian Home Paris')
      assert.ok(brevo.textContent.includes(`${SITE}/#/carte/${marc.id}`))
      // 24 h plus tard : de nouveau possible.
      s.horloge.t = new Date(s.horloge.t.getTime() + 24 * 3600_000 + 1000)
      await s.api('POST', '/cartes/retrouver', { contact: 'marc@exemple.fr' })
      await s.app.relancesEnCours()
      assert.equal(s.appels.length, 4)
    } finally {
      await s.app.fermer()
    }
  })

  test('contact illisible → 400 (format seulement) ; limite par IP → 429', async () => {
    const s = await demarrer('retrouver-limite.db', {}, { limitesPubliques: { ficheClientParIp: 2 } })
    try {
      assert.equal((await s.api('POST', '/cartes/retrouver', { contact: 'pas un contact' })).statut, 400)
      assert.equal((await s.api('POST', '/cartes/retrouver', { contact: '0611111111' })).statut, 202)
      assert.equal((await s.api('POST', '/cartes/retrouver', { contact: '0611111111' })).statut, 429)
    } finally {
      await s.app.fermer()
    }
  })

  test('front : message générique — jamais « aucune carte », « inconnu » ni « introuvable » pour ce contact', () => {
    for (const envoi of [true, false]) {
      const m = messageRechercheCarte(envoi)
      assert.doesNotMatch(m, /aucune carte|inconnu|introuvable|n’existe pas|pas de carte|trouvée/i)
      assert.match(m, /comptoir/)
    }
    assert.match(messageRechercheCarte(true), /^Si ce numéro ou cet e-mail correspond à une carte/)
    assert.match(messageRechercheCarte(false), /nous n’indiquons jamais si une carte existe/)
    const page = lire('src/pages/CartePublique.tsx')
    assert.match(page, /<RetrouverCarte api=\{api\} \/>/)
    assert.match(page, /setReponse\(messageRechercheCarte\(r\.envoi\)\)/)
    // La seule information lue dans la réponse est `envoi` (état du serveur).
    const bloc = page.slice(page.indexOf('function RetrouverCarte'))
    assert.doesNotMatch(bloc, /r\.(existe|trouve|client)/)
  })
})

// ---------- Lots en attente, expiration, historique ----------

describe('Carte : lots en attente avec expiration', () => {
  const midi = new Date(2026, 10, 10, 12, 0)
  const base = (): Client => ({ ...nouveauClient(AH, 'Lina', { telephone: '0611111111' }, new Date(2026, 9, 1)), id: 'cl-lina' })

  test('récompenses valables + gain de la roue du jour (code, valable jusqu’à minuit), les plus urgents d’abord ; expirées masquées', () => {
    const client: Client = {
      ...base(),
      recompensesEnAttente: [
        { id: 'r1', libelle: 'Plat offert', origine: 'palier', creeLe: '2026-11-01T10:00:00Z' },
        { id: 'r2', libelle: 'Dessert d’anniversaire', origine: 'anniversaire', creeLe: '2026-11-05T10:00:00Z', expireLe: new Date(2026, 10, 20).toISOString() },
        { id: 'r3', libelle: 'Ancien cadeau', origine: 'anniversaire', creeLe: '2026-10-01T10:00:00Z', expireLe: new Date(2026, 10, 9).toISOString() },
      ],
    }
    const lots = lotsEnAttente(client, { lot: 'Nems offerts', code: 'ABCD23' }, midi)
    assert.deepEqual(
      lots.map((l) => [l.libelle, l.origine, l.code ?? null]),
      [
        ['Nems offerts', 'roue', 'ABCD23'],
        ['Dessert d’anniversaire', 'anniversaire', null],
        ['Plat offert', 'palier', null],
      ],
    )
    assert.equal(lots[0].expireLe, finDuJour(midi).toISOString())
    assert.equal(lotsEnAttente(client, null, midi).length, 2, 'sans gain du jour')
    assert.equal(lotsEnAttente(base(), undefined, midi).length, 0)
  })

  test('texte d’expiration : aujourd’hui seulement / jusqu’au … / sans date limite', () => {
    assert.equal(texteExpiration(finDuJour(midi).toISOString(), midi), 'Valable aujourd’hui seulement')
    assert.equal(texteExpiration(new Date(2026, 10, 20).toISOString(), midi), 'Valable jusqu’au 20 nov.')
    assert.equal(texteExpiration(undefined, midi), 'Sans date limite')
  })

  test('la carte affiche les lots en attente avec leur code et leur expiration (CarteFidelite)', () => {
    const src = lire('src/components/CarteFidelite.tsx')
    assert.match(src, /const enAttente = lotsEnAttente\(client, gainDuJour, maintenant\)/)
    assert.match(src, /texteExpiration\(r\.expireLe, maintenant\)/)
    assert.match(src, /Code à montrer/)
    // Le gain du jour n'est passé que s'il n'est ni perdant ni déjà remis.
    assert.match(lire('src/pages/CartePublique.tsx'), /r\.jeu\.codeDuJour && r\.jeu\.lotDuJour && !r\.jeu\.remisDuJour/)
  })

  test('progression « Encore X repas avant votre plat offert » ; autre commerce : visites / récompense', () => {
    const resto = { type: 'restaurant' as const, recompense: 'Un plat offert au 10e repas' }
    assert.equal(texteProgression(3, resto), 'Encore 3 repas avant votre plat offert')
    assert.equal(texteProgression(1, resto), 'Encore 1 repas avant votre plat offert')
    assert.equal(texteProgression(0, resto), 'Carte complète')
    assert.equal(texteProgression(2, { type: 'boulangerie' as never, recompense: 'Une baguette' }), 'Encore 2 visites avant votre récompense')
  })

  test('animation : seuls les tampons gagnés depuis la dernière ouverture sur ce téléphone', () => {
    assert.deepEqual(tamponsNouveaux(null, 4), [], '1re ouverture : rien')
    assert.deepEqual(tamponsNouveaux(3, 4), [3])
    assert.deepEqual(tamponsNouveaux(2, 5), [2, 3, 4])
    assert.deepEqual(tamponsNouveaux(9, 0), [], 'récompense retirée : carte remise à zéro')
    assert.deepEqual(tamponsNouveaux(Number.NaN, 3), [])
    assert.match(lire('src/index.css'), /\.tampon-nouveau \{\s*animation: none;/, 'mouvement réduit respecté')
  })

  test('historique : visites, récompenses remises et lots de la roue, le plus récent d’abord', () => {
    const client: Client = {
      ...base(),
      visites: ['2026-11-01T12:00:00Z', '2026-11-08T12:00:00Z'],
      recompensesOffertes: [{ date: '2026-11-05T12:00:00Z', libelle: 'Plat offert' } as NonNullable<Client['recompensesOffertes']>[number]],
    }
    const lots: LotHistorique[] = [
      { lot: 'Nems offerts', date: '2026-11-09T12:00:00Z', statut: 'expire' },
      { lot: 'Thé glacé', date: '2026-11-03T12:00:00Z', statut: 'remis' },
    ]
    assert.deepEqual(
      historiqueCarte(client, lots).map((l) => l.libelle),
      ['Roue : Nems offerts (non retiré, expiré)', 'Visite validée (+1 tampon)', 'Récompense remise : Plat offert', 'Roue : Thé glacé (retiré)', 'Visite validée (+1 tampon)'],
    )
    assert.equal(historiqueCarte(client, lots, 2).length, 2)
  })

  test('serveur : GET /cartes/:id renvoie l’historique des lots (gagnants, statut du jour), jamais de code', async () => {
    const s = await demarrer('historique.db')
    try {
      assert.equal((await s.json('PATCH', `/commerces/${AH}`, { lots: [{ libelle: 'Nems offerts', probabilite: 100 }] }, PIN)).statut, 200)
      assert.equal((await s.json('POST', `/commerces/${AH}/equipe`, { nom: 'Mai', code: '2468' }, PIN)).statut, 201)
      const c = (await s.json('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: '0611111111' }, PIN)).contenu.client as Client
      const passage = await s.json('POST', `/commerces/${AH}/caisse/passage`, { clientId: c.id, actionId: `act-${c.id}` }, { 'X-Equipe-Code': '2468' })
      assert.equal(passage.statut, 200, JSON.stringify(passage.contenu))
      const tirage = (await s.json('POST', `/commerces/${AH}/tirages`, { contact: '0611111111' })).contenu as { tirageId: string; code?: string }
      // R3 (burn-on-reveal, décision du 12/11) : plus de code dans la réponse du tirage ; on le lit côté commerçant pour
      // vérifier qu'il n'apparaît nulle part sur la carte.
      assert.equal(tirage.code, undefined)
      const code = ((await s.json('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu as { tirages: { id: string; code: string }[] }).tirages.find((t) => t.id === tirage.tirageId)!.code
      const r = await s.json('GET', `/cartes/${c.id}`)
      // R3 : statut v2 — le jour du tirage, le gain est « enAttente » (utilisable dès demain).
      assert.deepEqual(r.contenu.historiqueLots, [{ lot: 'Nems offerts', date: s.horloge.t.toISOString(), statut: 'enAttente' }])
      assert.equal(r.contenu.jeu.codeDuJour, null, 'aucun code sans jeton')
      // Le lendemain : utilisable mais code non activé (« inactif ») ; après J+30 : expiré. Le code n'apparaît jamais.
      s.horloge.t = new Date(2026, 10, 11, 12, 0)
      const demain = await s.api('GET', `/cartes/${c.id}`)
      assert.equal(JSON.parse(demain.texte).historiqueLots[0].statut, 'inactif')
      assert.ok(!demain.texte.includes(code), 'aucun code sur la carte')
      s.horloge.t = new Date(2026, 11, 11, 12, 0)
      const j31 = await s.api('GET', `/cartes/${c.id}`)
      assert.equal(JSON.parse(j31.texte).historiqueLots[0].statut, 'expire')
      assert.ok(!j31.texte.includes(code), 'aucun code sur la carte')
    } finally {
      await s.app.fermer()
    }
  })
})

// ---------- Lien court, QR, Wallet ----------

describe('Carte : lien court, QR personnel, encart Wallet honnête', () => {
  test('lien court /c/<id> copiable et QR personnel sur la carte publique', () => {
    const page = lire('src/pages/CartePublique.tsx')
    assert.match(page, /lienCourt=\{lienCourtCarte\(window\.location\.origin, donnees\.client\.id\)\}/)
    assert.match(page, /<BoutonCopier texte=\{lien\} libelle=\{t\('Copier mon lien'\)\}/)
    assert.match(lire('src/components/CarteFidelite.tsx'), /<QrCode texte=\{urlAbsolue\('carte', client\.id\)\}/)
  })

  test('Wallet : encart replié en une ligne sur la carte, jamais de bouton « Ajouter » ; docs/WALLET.md explique ce qui manque', () => {
    assert.match(lire('src/pages/CartePublique.tsx'), /<EncartWallet demo=\{demo\} replie \/>/)
    const ui = lire('src/components/ui.tsx')
    const encart = ui.slice(ui.indexOf('export function EncartWallet'), ui.indexOf('export function EncartWallet') + 2000)
    assert.match(encart, /<details/)
    assert.doesNotMatch(encart, /Ajouter à|<button/)
    const doc = lire('docs/WALLET.md')
    assert.match(doc, /Aucun pass Wallet n'existe/)
    assert.match(doc, /GOOGLE_WALLET_ISSUER_ID/)
    assert.match(doc, /En suspens par décision de l'utilisateur/)
  })
})

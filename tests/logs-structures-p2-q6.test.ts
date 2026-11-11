// P2-Q6 — Logs structurés JSON : une ligne par requête HTTP (niveau, horodatage, route masquée,
// statut, durée), sans jamais logger de secret, de PIN, de jeton, de téléphone/e-mail brut ni
// d'identifiant de carte ou de client brut (empreinte SHA-256 tronquée, comme P2-S15).
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { cheminMasquePourErreur, empreinte, ligneRequete, niveauPourStatut, routeMasquee } from '../server/logs.ts'

const AH = 'c-asian-home-paris'
/** Commerces connus du serveur (seed) : seuls leurs identifiants restent en clair dans les logs. */
const CONNUS = new Set([AH])
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p2-q6-'))

async function demarrer(nom: string) {
  const horloge = { t: new Date('2023-01-10T12:00:00Z') }
  const app = await creerServeur({
    fichierDb: join(dossier, nom),
    adminPin: '98765432',
    pinInitial: '1234',
    version: 'test',
    secretSession: 'secret-de-test-p2-q6-au-moins-32-caracteres-0123456789',
    maintenant: () => horloge.t,
    limitesPubliques: { inscriptionParIp: 1000, inscriptionParContact: 1000, ficheClientParIp: 1000, lectureParIp: 1000, lectureParCarte: 1000, tirageParIp: 1000, tirageParContact: 1000 },
  })
  await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
  const racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(`${racine}/api/v1${chemin}`, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    return { statut: r.status, contenu: (await r.json()) as Record<string, any> }
  }
  return { app, api, racine }
}

/** Capture `console.info` pendant un bloc, puis restaure — ne garde que les lignes JSON (une ligne = un objet). */
function capturer() {
  const lignes: string[] = []
  const origine = console.info
  console.info = (...a: unknown[]) => {
    lignes.push(a.map(String).join(' '))
  }
  return {
    lignes: () => lignes.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as Record<string, unknown>),
    brutes: () => lignes,
    restaurer: () => {
      console.info = origine
    },
  }
}

async function attendreLignes(c: ReturnType<typeof capturer>, n: number, delaiMaxMs = 2000) {
  const debut = Date.now()
  while (c.lignes().length < n && Date.now() - debut < delaiMaxMs) {
    await new Promise((r) => setTimeout(r, 25))
  }
  return c.lignes()
}

describe('P2-Q6 : niveau et masquage (unitaires)', () => {
  test('niveauPourStatut : info < 400, avertissement 4xx, erreur 5xx', () => {
    assert.equal(niveauPourStatut(200), 'info')
    assert.equal(niveauPourStatut(301), 'info')
    assert.equal(niveauPourStatut(304), 'info')
    assert.equal(niveauPourStatut(400), 'avertissement')
    assert.equal(niveauPourStatut(401), 'avertissement')
    assert.equal(niveauPourStatut(404), 'avertissement')
    assert.equal(niveauPourStatut(429), 'avertissement')
    assert.equal(niveauPourStatut(500), 'erreur')
    assert.equal(niveauPourStatut(503), 'erreur')
  })

  test('routeMasquee : requête jetée, identifiants remplacés par leur empreinte, commerce public gardé', () => {
    const id = 'cl-abc123'
    const att = createHash('sha256').update(id).digest('hex').slice(0, 12)
    assert.equal(routeMasquee('/api/v1/sante'), '/api/v1/sante')
    assert.equal(routeMasquee(`/api/v1/cartes/${id}`), `/api/v1/cartes/${att}`)
    assert.equal(routeMasquee(`/api/v1/cartes/${id}?acces=jeton-secret`), `/api/v1/cartes/${att}`)
    assert.ok(!routeMasquee(`/api/v1/cartes/${id}?acces=jeton-secret`).includes('jeton-secret'))
    assert.equal(
      routeMasquee(`/api/v1/commerces/${AH}/clients/${id}/visite`, CONNUS),
      `/api/v1/commerces/${AH}/clients/${att}/visite`,
    )
    assert.equal(routeMasquee('/c/cl-xyz'), `/c/${createHash('sha256').update('cl-xyz').digest('hex').slice(0, 12)}`)
    const jeton = 'jeton-hmac-0123456789abcdef'
    const attJeton = createHash('sha256').update(jeton).digest('hex').slice(0, 12)
    assert.equal(routeMasquee(`/d/${id}/${jeton}`), `/d/${att}/${attJeton}`)
    assert.equal(
      routeMasquee(`/api/v1/commerces/${AH}/caisse/gains/ABC123`, CONNUS),
      `/api/v1/commerces/${AH}/caisse/gains/${createHash('sha256').update('ABC123').digest('hex').slice(0, 12)}`,
    )
  })

  test('routeMasquee : encodage invalide ne lève pas et ne laisse rien en clair', () => {
    const route = routeMasquee('/api/v1/cartes/%E0%A4%A')
    assert.ok(!route.includes('%E0%A4%A'))
    assert.match(route, /^\/api\/v1\/cartes\/[0-9a-f]{12}$/)
  })

  test('routeMasquee : normalisation comme le routeur (revue Codex P2-Q6 point 1)', () => {
    const id = 'cl-secret'
    const att = createHash('sha256').update(id).digest('hex').slice(0, 12)
    const jeton = 'jeton-secret'
    const attJeton = createHash('sha256').update(jeton).digest('hex').slice(0, 12)
    // Nom de route encodé : le routeur le décode avant de router, le masquage doit faire pareil.
    assert.equal(routeMasquee('/api/v1/%63artes/cl-secret'), `/api/v1/cartes/${att}`)
    // Segment vide : le routeur le supprime, il ne doit pas consommer la place de l'identifiant.
    assert.equal(routeMasquee('/api/v1/cartes//cl-secret'), `/api/v1/cartes/${att}`)
    assert.equal(routeMasquee('/api/v1/desinscription//cl-secret/jeton-secret'), `/api/v1/desinscription/${att}/${attJeton}`)
    // L'empreinte porte sur l'identifiant décodé (comme P2-S15), pas sur sa forme encodée.
    assert.equal(routeMasquee('/api/v1/cartes/%63l-secret'), `/api/v1/cartes/${att}`)
    // Racine et slash final : normalisés.
    assert.equal(routeMasquee('/'), '/')
    assert.equal(routeMasquee('/api/v1/sante/'), '/api/v1/sante')
  })

  test('routeMasquee : liste blanche — tout segment inconnu est masqué (revue Codex P2-Q6 point 2)', () => {
    const id = 'cl-secret'
    const att = createHash('sha256').update(id).digest('hex').slice(0, 12)
    // Un contact glissé après l'identifiant (chemin 404 forgé) ne reste jamais en clair.
    const email = 'alice@example.com'
    const attEmail = createHash('sha256').update(email).digest('hex').slice(0, 12)
    assert.equal(routeMasquee(`/api/v1/cartes/${id}/${email}`), `/api/v1/cartes/${att}/${attEmail}`)
    assert.equal(routeMasquee('/api/v1/cartes/cl-x/0612345678'), `/api/v1/cartes/${createHash('sha256').update('cl-x').digest('hex').slice(0, 12)}/${createHash('sha256').update('0612345678').digest('hex').slice(0, 12)}`)
    // Un segment en `c-…` hors place d'identifiant de commerce est masqué comme les autres.
    assert.equal(
      routeMasquee('/api/v1/cartes/cl-x/c-foo@example.com'),
      `/api/v1/cartes/${createHash('sha256').update('cl-x').digest('hex').slice(0, 12)}/${createHash('sha256').update('c-foo@example.com').digest('hex').slice(0, 12)}`,
    )
    // Chemin inconnu : chaque segment est masqué.
    assert.equal(
      routeMasquee('/n-importe-quoi'),
      `/${createHash('sha256').update('n-importe-quoi').digest('hex').slice(0, 12)}`,
    )
    // En revanche : identifiant de commerce à sa place, mot littéral à la place d'un identifiant.
    assert.equal(routeMasquee(`/api/v1/commerces/${AH}/etat`, CONNUS), `/api/v1/commerces/${AH}/etat`)
    assert.equal(routeMasquee(`/r/${AH}`, CONNUS), `/r/${AH}`)
    assert.equal(routeMasquee(`/menu/${AH}`, CONNUS), `/menu/${AH}`)
    assert.equal(routeMasquee('/api/v1/cartes/retrouver'), '/api/v1/cartes/retrouver')
    assert.equal(routeMasquee('/api/v1/sante/acces-client'), '/api/v1/sante/acces-client')
    // Un identifiant de commerce inconnu (pas en `c-…`) est masqué, pas gardé.
    assert.equal(routeMasquee('/api/v1/commerces/bistro-12/etat'), `/api/v1/commerces/${createHash('sha256').update('bistro-12').digest('hex').slice(0, 12)}/etat`)
  })

  test('routeMasquee : seul un commerce CONNU reste en clair (revue Codex P2-Q6 2e passe, point 1)', () => {
    // Un préfixe `c-…` ne prouve pas qu'un segment est un commerce public : un e-mail forgé doit être masqué.
    const email = 'c-alice@example.com'
    const attEmail = createHash('sha256').update(email).digest('hex').slice(0, 12)
    assert.equal(routeMasquee(`/api/v1/commerces/${email}/etat`, CONNUS), `/api/v1/commerces/${attEmail}/etat`)
    assert.equal(routeMasquee('/api/v1/commerces/c-alice%40example.com/etat', CONNUS), `/api/v1/commerces/${attEmail}/etat`)
    // Même après un `menu` rencontré dans un chemin inconnu : l'exception ne s'applique qu'aux connus.
    assert.equal(
      routeMasquee(`/api/v1/cartes/cl-x/menu/${email}`, CONNUS),
      `/api/v1/cartes/${createHash('sha256').update('cl-x').digest('hex').slice(0, 12)}/menu/${attEmail}`,
    )
    // Un commerce connu reste en clair à sa place, mais pas sans l'ensemble (défaut : tout est masqué).
    assert.equal(routeMasquee(`/api/v1/commerces/${AH}/etat`, CONNUS), `/api/v1/commerces/${AH}/etat`)
    assert.equal(
      routeMasquee(`/api/v1/commerces/${AH}/etat`),
      `/api/v1/commerces/${createHash('sha256').update(AH).digest('hex').slice(0, 12)}/etat`,
    )
  })

  test('cheminMasquePourErreur : même marche que les logs JSON, avec `…` (revue Codex P2-Q6 2e passe, point 2)', () => {
    // Un séparateur encodé à l'intérieur d'un segment ne doit pas casser de frontière : le masquage se
    // décide segment par segment, avant de réunir le chemin.
    assert.equal(cheminMasquePourErreur('/api/v1/cartes/%3Fcl-secret/%ZZ', CONNUS), '/api/v1/cartes/…/…')
    assert.equal(
      cheminMasquePourErreur('/api/v1/desinscription/cl%2Fsecret/jeton-secret/%ZZ', CONNUS),
      '/api/v1/desinscription/…/…/…',
    )
    assert.equal(
      cheminMasquePourErreur('/api/v1/cartes/cl-secret/alice%40example.com/%ZZ', CONNUS),
      '/api/v1/cartes/…/…/…',
    )
    assert.equal(
      cheminMasquePourErreur(`/api/v1/commerces/${AH}/caisse/gains/ABC123/%ZZ`, CONNUS),
      `/api/v1/commerces/${AH}/caisse/gains/…/…`,
    )
    assert.equal(cheminMasquePourErreur('/api/v1/cartes/cl-test%ZZ', CONNUS), '/api/v1/cartes/…')
    assert.equal(cheminMasquePourErreur(`/api/v1/commerces/${AH}/etat`, CONNUS), `/api/v1/commerces/${AH}/etat`)
  })

  test('ligneRequete : champs exigés, durée bornée à 0, horodatage ISO', () => {
    const ligne = ligneRequete({ methode: 'GET', pathname: '/api/v1/sante', statut: 200, dureeMs: 2.7, ip: '127.0.0.1' })
    assert.equal(ligne.type, 'requete')
    assert.equal(ligne.niveau, 'info')
    assert.equal(ligne.methode, 'GET')
    assert.equal(ligne.route, '/api/v1/sante')
    assert.equal(ligne.statut, 200)
    assert.equal(ligne.dureeMs, 2)
    assert.equal(ligne.ip, '127.0.0.1')
    assert.match(ligne.horodatage, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    assert.equal(ligneRequete({ methode: 'GET', pathname: '/', statut: 500, dureeMs: -5, ip: '?' }).dureeMs, 0)
    assert.equal(ligneRequete({ methode: 'GET', pathname: '/', statut: 500, dureeMs: 1, ip: '?' }).niveau, 'erreur')
  })
})

describe('P2-Q6 : une ligne JSON par requête, sans donnée sensible (intégration)', async () => {
  after(() => rmSync(dossier, { recursive: true, force: true }))

  test('format JSON, niveau par statut, route masquée, aucune donnée sensible', async () => {
    const s = await demarrer('logs.db')
    try {
      const telephone = '06 12 34 56 78'
      const email = 'lina@example.com'
      const jetonFaux = 'jeton-faux-0123456789abcdef'
      const pinFaux = '13579246'
      let id = ''
      let idEmail = ''
      const c = capturer()
      const erreurs: string[] = []
      const origineErreur = console.error
      console.error = (...a: unknown[]) => {
        erreurs.push(a.map(String).join(' '))
      }
      try {
        // Les inscriptions elles-mêmes sont dans la capture : le test prouve que le téléphone et
        // l'e-mail ne sont pas journalisés au moment où le serveur les reçoit (revue Codex P2-Q6 point 5).
        id = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: telephone })).contenu.client.id as string
        idEmail = (await s.api('POST', `/commerces/${AH}/clients`, { prenom: 'Lina', contact: email })).contenu.client.id as string
        assert.equal((await s.api('GET', '/sante')).statut, 200)
        assert.equal((await s.api('GET', `/cartes/${id}?acces=${jetonFaux}`)).statut, 200)
        assert.equal((await s.api('GET', '/cartes/cl-inexistant')).statut, 404)
        assert.equal((await s.api('POST', '/sessions', { role: 'admin', pin: pinFaux })).statut, 401)
      } finally {
        c.restaurer()
        console.error = origineErreur
      }
      const lignes = await attendreLignes(c, 6)
      assert.equal(lignes.length, 6, `6 requêtes → 6 lignes JSON (reçues : ${lignes.length})`)
      for (const ligne of lignes) {
        assert.equal(ligne.type, 'requete')
        assert.ok(['info', 'avertissement', 'erreur'].includes(ligne.niveau as string))
        assert.match(ligne.horodatage as string, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
        assert.equal(typeof ligne.methode, 'string')
        assert.equal(typeof ligne.route, 'string')
        assert.equal(typeof ligne.statut, 'number')
        assert.equal(typeof ligne.dureeMs, 'number')
        assert.ok((ligne.dureeMs as number) >= 0)
        assert.equal(ligne.ip, '127.0.0.1')
      }
      const parRoute = (route: string) => lignes.find((l) => l.route === route)
      const sante = parRoute('/api/v1/sante')
      assert.ok(sante, 'ligne /sante présente')
      assert.equal(sante.niveau, 'info')
      assert.equal(sante.statut, 200)
      assert.equal(sante.methode, 'GET')
      const carte = parRoute(`/api/v1/cartes/${empreinte(id)}`)
      assert.ok(carte, 'ligne carte présente, avec l’empreinte et non l’id')
      assert.equal(carte.statut, 200)
      const introuvable = parRoute(`/api/v1/cartes/${empreinte('cl-inexistant')}`)
      assert.ok(introuvable, 'ligne 404 présente, avec l’empreinte de l’id inconnu')
      assert.equal(introuvable.niveau, 'avertissement')
      assert.equal(introuvable.statut, 404)
      const session = parRoute('/api/v1/sessions')
      assert.ok(session, 'ligne session présente')
      assert.equal(session.niveau, 'avertissement')
      assert.equal(session.statut, 401)
      // Aucune donnée sensible, dans aucune ligne (brutes comprises : JSON + autres lignes console.info).
      // Les valeurs longues (id, téléphone, e-mail, jeton) contiennent des caractères hors hexadécimal
      // ou dépassent 12 caractères : elles ne peuvent pas apparaître par hasard dans une empreinte.
      for (const brute of c.brutes()) {
        assert.ok(!brute.includes(id), 'identifiant de carte jamais en clair dans les logs')
        assert.ok(!brute.includes(idEmail), 'identifiant de carte (e-mail) jamais en clair dans les logs')
        assert.ok(!brute.includes(telephone), 'téléphone jamais en clair dans les logs')
        assert.ok(!brute.includes('0612345678'), 'téléphone normalisé jamais en clair dans les logs')
        assert.ok(!brute.includes(email), 'e-mail jamais en clair dans les logs')
        assert.ok(!brute.includes(jetonFaux), 'jeton d’accès jamais en clair dans les logs')
      }
      // Le PIN est court et tout en chiffres : le chercher dans toute la ligne serait probabiliste
      // (une empreinte hexadécimale peut contenir la même suite par hasard). L'assertion est donc
      // déterministe et ciblée : seule la requête d'authentification porte le PIN, et sa ligne a la
      // route exacte `/api/v1/sessions` (vérifiée ci-dessus) — aucun champ de cette ligne ne le contient,
      // et le corps (où vit le PIN) n'est jamais sérialisé.
      assert.ok(session, 'ligne session présente (assertion PIN)')
      for (const valeur of Object.values(session)) {
        if (typeof valeur === 'string') assert.ok(!valeur.includes(pinFaux), `PIN dans un champ de la ligne session : ${JSON.stringify(session)}`)
      }
      // `console.error` non plus : aucune ligne d'erreur émise pendant ces requêtes ne contient de donnée sensible.
      for (const ligne of erreurs) {
        assert.ok(!ligne.includes(id) && !ligne.includes(idEmail), 'identifiant en clair dans console.error')
        assert.ok(!ligne.includes(telephone) && !ligne.includes(email), 'contact en clair dans console.error')
        assert.ok(!ligne.includes(jetonFaux), 'jeton en clair dans console.error')
        assert.ok(!ligne.includes(pinFaux), 'PIN en clair dans console.error')
      }
    } finally {
      await s.app.fermer()
    }
  })

  test('régression P2-Q6 : corps abandonné après une 413 (logo > 2 Mo) — réponse complète, ligne émise, pas de plantage', async () => {
    // Le corps trop lourd est rejeté avant d'être lu entièrement : le flux de la requête est abandonné
    // et `req.socket` peut valoir `null` au moment de `finish`. La première version du branchement
    // appelait `ipDe(req)` là : `TypeError` non attrapée dans l'écouteur → processus tué, corps vide.
    const s = await demarrer('logs-gros.db')
    try {
      const c = capturer()
      let statut = 0
      let texte = ''
      try {
        const r = await fetch(`${s.racine}/api/v1/commerces/${AH}/logo`, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/png', 'X-Commerce-PIN': '1234' },
          body: Buffer.alloc(2 * 1024 * 1024 + 1, 0),
        })
        statut = r.status
        texte = await r.text()
      } finally {
        c.restaurer()
      }
      assert.equal(statut, 413)
      assert.match(texte, /Logo trop lourd : 2 Mo maximum/)
      const lignes = await attendreLignes(c, 1)
      assert.equal(lignes.length, 1)
      assert.equal(lignes[0].route, `/api/v1/commerces/${AH}/logo`)
      assert.equal(lignes[0].statut, 413)
      assert.equal(lignes[0].niveau, 'avertissement')
      assert.equal(lignes[0].ip, '127.0.0.1')
    } finally {
      await s.app.fermer()
    }
  })

  test('émission simulée (revue Codex P2-Q6 point 9) : un vrai 500 émet une ligne de niveau erreur', async () => {
    // Le critère AUDIT.md P2-Q6 (« alerte reçue sur staging lors d'un 500 provoqué ») suppose un staging
    // et un canal d'alerte qui n'existent pas encore : ce test couvre la moitié réalisable ici, le signal
    // — une 500 réelle produit la ligne structurée qu'une alerte consommerait.
    const s = await demarrer('logs-500.db')
    try {
      const c = capturer()
      const erreurs: string[] = []
      const origineErreur = console.error
      console.error = (...a: unknown[]) => {
        erreurs.push(a.map(String).join(' '))
      }
      try {
        // Encodage invalide : decodeURIComponent lève dans le routeur (erreur non HTTP → 500).
        assert.equal((await s.api('GET', '/cartes/cl-test%ZZ')).statut, 500)
      } finally {
        c.restaurer()
        console.error = origineErreur
      }
      const lignes = await attendreLignes(c, 1)
      assert.equal(lignes.length, 1)
      assert.equal(lignes[0].route, `/api/v1/cartes/${empreinte('cl-test%ZZ')}`)
      assert.equal(lignes[0].statut, 500)
      assert.equal(lignes[0].niveau, 'erreur')
      // La ligne console.error du même 500 ne contient pas l'identifiant non plus (revue Codex P2-Q6 point 3).
      assert.ok(erreurs.length >= 1)
      assert.ok(erreurs.every((l) => !l.includes('cl-test')), `id en clair dans console.error : ${JSON.stringify(erreurs)}`)
      assert.ok(erreurs.some((l) => l.includes('/cartes/…')), `chemin masqué attendu, reçu : ${JSON.stringify(erreurs)}`)
    } finally {
      await s.app.fermer()
    }
  })

  test('régressions revue Codex 2e passe : commerce forgé et séparateurs encodés ne fuient ni en JSON ni en console.error', async () => {
    const s = await demarrer('logs-codex2.db')
    try {
      const c = capturer()
      const erreurs: string[] = []
      const origineErreur = console.error
      console.error = (...a: unknown[]) => {
        erreurs.push(a.map(String).join(' '))
      }
      try {
        // E-mail forgé en identifiant de commerce : 404 (fiche publique), l'e-mail doit être masqué.
        assert.equal((await s.api('GET', '/commerces/c-alice%40example.com')).statut, 404)
        // Séparateur encodé dans un segment : le décodage du routeur lève → 500.
        assert.equal((await s.api('GET', '/cartes/%3Fcl-secret/%ZZ')).statut, 500)
        assert.equal((await s.api('GET', '/desinscription/cl%2Fsecret/jeton-secret/%ZZ')).statut, 500)
      } finally {
        c.restaurer()
        console.error = origineErreur
      }
      const lignes = await attendreLignes(c, 3)
      assert.equal(lignes.length, 3)
      const parStatut = (statut: number) => lignes.filter((l) => l.statut === statut)
      const commerce = parStatut(404)[0]
      assert.ok(commerce, 'ligne 404 commerce forgé présente')
      assert.equal(commerce.route, `/api/v1/commerces/${empreinte('c-alice@example.com')}`)
      assert.equal(commerce.niveau, 'avertissement')
      const erreurs500 = parStatut(500)
      assert.equal(erreurs500.length, 2)
      assert.equal(erreurs500[0].route, `/api/v1/cartes/${empreinte('?cl-secret')}/${empreinte('%ZZ')}`)
      assert.equal(
        erreurs500[1].route,
        `/api/v1/desinscription/${empreinte('cl/secret')}/${empreinte('jeton-secret')}/${empreinte('%ZZ')}`,
      )
      for (const ligne of erreurs500) assert.equal(ligne.niveau, 'erreur')
      // `console.error` : exactement une ligne par 500 (la 404 n'en émet pas), avec le chemin masqué
      // exact — pas seulement l'absence de données sensibles (revue Codex P2-Q6 3e passe, point 4).
      assert.equal(erreurs.length, 2, `2 × 500 → 2 lignes console.error (reçues : ${erreurs.length})`)
      assert.ok(erreurs.some((l) => l.includes('/api/v1/cartes/…/…')), `chemin masqué cartes attendu, reçu : ${JSON.stringify(erreurs)}`)
      assert.ok(erreurs.some((l) => l.includes('/api/v1/desinscription/…/…/…')), `chemin masqué désinscription attendu, reçu : ${JSON.stringify(erreurs)}`)
      for (const brute of c.brutes()) {
        assert.ok(!brute.includes('alice@example.com'), 'e-mail forgé en clair dans les logs')
        assert.ok(!brute.includes('cl-secret'), 'identifiant en clair dans les logs')
        assert.ok(!brute.includes('jeton-secret'), 'jeton en clair dans les logs')
      }
      for (const ligne of erreurs) {
        assert.ok(!ligne.includes('alice@example.com'), 'e-mail forgé en clair dans console.error')
        assert.ok(!ligne.includes('cl-secret'), 'identifiant en clair dans console.error')
        assert.ok(!ligne.includes('jeton-secret'), 'jeton en clair dans console.error')
      }
    } finally {
      await s.app.fermer()
    }
  })

  test('registre des commerces connus (revue Codex P2-Q6 3e passe, point 5) : un commerce créé reste lisible dans les logs', async () => {
    const s = await demarrer('logs-registre.db')
    try {
      // Création par l'admin (X-Admin-PIN) : le nouvel identifiant est ajouté à l'ensemble connu.
      const cree = await s.api('POST', '/commerces', { pin: '1234', nom: 'Bistro Test', type: 'autre' }, { 'X-Admin-PIN': '98765432' })
      assert.equal(cree.statut, 201)
      const nouveauId = cree.contenu.commerce.id as string
      assert.match(nouveauId, /^c-/)
      const c = capturer()
      try {
        assert.equal((await s.api('GET', `/commerces/${nouveauId}`)).statut, 200)
      } finally {
        c.restaurer()
      }
      const lignes = await attendreLignes(c, 1)
      assert.equal(lignes.length, 1)
      assert.equal(lignes[0].route, `/api/v1/commerces/${nouveauId}`)
      assert.equal(lignes[0].statut, 200)
    } finally {
      await s.app.fermer()
    }
  })

  test('une requête hors API (page statique inconnue) est journalisée aussi', async () => {
    const s = await demarrer('logs-statique.db')
    try {
      const c = capturer()
      try {
        const r = await fetch(`${s.racine}/n-importe-quoi`)
        assert.equal(r.status, 404)
        await r.text()
      } finally {
        c.restaurer()
      }
      const lignes = await attendreLignes(c, 1)
      assert.equal(lignes.length, 1)
      assert.equal(lignes[0].route, `/${empreinte('n-importe-quoi')}`)
      assert.equal(lignes[0].statut, 404)
      assert.equal(lignes[0].niveau, 'avertissement')
    } finally {
      await s.app.fermer()
    }
  })
})

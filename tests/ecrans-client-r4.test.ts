// Roue v2 R4 — écrans client et règlement du jeu : bloc « À gagner aujourd’hui » + lien règlement (page de jeu), page
// #/reglement générée depuis la configuration (texte exact, variantes libre / visite, aucune promesse), bloc des gains
// sur la carte (en attente → « Utiliser mon gain » → code + compte à rebours de 10 minutes → réactivable), écran
// résultat v2. Fonctions pures, sources .tsx (node --test ne lit pas le JSX) et vrai serveur HTTP à horloge pilotée.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import type { Commerce } from '../src/types.ts'
import { creerClientApi } from '../src/data/api.ts'
import { activerCode } from '../src/data/jeuApi.ts'
import { nouveauCommerce } from '../src/data/defaults.ts'
import { lotsAGagner } from '../src/lib/lots.ts'
import { donneesReglement, reglementDuJeu, type DonneesReglement } from '../src/lib/reglement.ts'
import { compteARebours, jourMois, vueGain, type GainEnCours } from '../src/lib/carte.ts'
import { commercePublic } from '../src/lib/vuePublique.ts'
import { lireRoute, PAGES_PUBLIQUES } from '../src/router.ts'
import { estPageTraduite, traduire } from '../src/lib/langue.ts'
import { instantParis } from '../src/lib/roulette.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (f: string) => readFileSync(join(RACINE, f), 'utf8')
/** Corps d'une fonction de composant (jusqu'à la fonction suivante du fichier). */
function corps(source: string, nom: string): string {
  const debut = source.search(new RegExp(`function ${nom}\\b`))
  assert.ok(debut >= 0, `${nom} introuvable`)
  const suite = source.slice(debut + 1).search(/\n(?:export )?(?:default )?function /)
  return suite < 0 ? source.slice(debut) : source.slice(debut, debut + 1 + suite)
}

const LOTS: Commerce['lots'] = [
  { id: 'lot-nems', type: 'lot', libelle: 'Nems offerts', probabilite: 30, plafondJour: 5, coutCentimes: 120 } as Commerce['lots'][number],
  { id: 'lot-the', type: 'lot', libelle: ' Thé glacé ', probabilite: 20 },
  { id: 'lot-zero', type: 'lot', libelle: 'Lot à 0 %', probabilite: 0 },
  { id: 'lot-p', type: 'points', points: 10, libelle: '10 points offerts', probabilite: 40 },
  { id: 'lot-x', type: 'perdant', libelle: 'Dommage !', probabilite: 10 },
]

describe('R4 : « À gagner aujourd’hui » (page de jeu, avant le tirage)', () => {
  test('lots jouables dans l’ordre de la roue, consolation en points typée, jamais de secteur perdant ni de lot à 0 %', () => {
    assert.deepEqual(lotsAGagner(LOTS), [
      { libelle: 'Nems offerts', type: 'lot' },
      { libelle: 'Thé glacé', type: 'lot' },
      { libelle: '10 points offerts', type: 'points' },
    ])
    // Vue publique (secteurs du jour, plafonnés retirés par le serveur) : même lecture.
    const pub = commercePublic({ ...nouveauCommerce('Chez Lin', 'restaurant', ''), lots: LOTS }, new Set(['lot-nems']))
    assert.deepEqual(lotsAGagner(pub.lots).map((l) => l.libelle), ['Thé glacé', '10 points offerts'])
    // Config d'avant R1 (sans type) : ancienne règle du libellé.
    assert.deepEqual(lotsAGagner([{ libelle: 'Rouleau offert', probabilite: 50 }, { libelle: 'Pas de chance', probabilite: 50 }]), [{ libelle: 'Rouleau offert', type: 'lot' }])
  })

  test('bloc rendu dans le cadre du jeu : titre, lots, consolation annoncée, règles en une ligne, hasard, lien règlement', () => {
    const jouer = lire('src/pages/Jouer.tsx')
    const infos = corps(jouer, 'InfosJeu')
    assert.match(infos, /const lots = lotsAGagner\(commerce\.lots\)/)
    assert.match(infos, /\{t\('À gagner aujourd’hui'\)\}/)
    assert.match(infos, /l\.type === 'points' && <span className="text-sm text-gray-600"> · \{t\('consolation'\)\}<\/span>/)
    assert.match(infos, /\{t\('1 tirage par jour · gain utilisable dès demain, pendant 30 jours'\)\}/)
    assert.match(infos, /\{t\('Le résultat est tiré au hasard\.'\)\}/)
    assert.match(infos, /href=\{`#\/reglement\/\$\{commerce\.id\}`\}/)
    assert.match(infos, /\{t\('Règlement du jeu'\)\} →/)
    assert.match(corps(jouer, 'Cadre'), /\{children\}\n\s*\{infos && <InfosJeu commerce=\{commerce\} \/>\}/)
  })

  test('affiché avant le tirage dans les deux modes (sous l’écran d’attente en mode visite), jamais après', () => {
    const jouer = lire('src/pages/Jouer.tsx')
    assert.match(corps(jouer, 'PartieLocale'), /infos=\{etape === 'pret' && !dejaJoue\}/)
    assert.match(corps(jouer, 'PartieApi'), /infos=\{etape === 'pret' && jeu\?\.statut !== 'dejaJoue' && !accesPerdu\}/)
    // Pied : la règle d'accès suit le mode publié par le serveur (libre : plus de « visite validée »).
    assert.match(corps(jouer, 'PartieApi'), /modeAccesRoue\(commerce\) === 'libre'\n\s*\? t\('1 tirage par jour\. Tirage effectué par le serveur\.'\)/)
  })

  test('traductions anglaises des nouvelles chaînes', () => {
    assert.equal(traduire('À gagner aujourd’hui', 'en'), 'To win today')
    assert.equal(traduire('Règlement du jeu', 'en'), 'Game rules')
    assert.equal(traduire('Il expire dans {reste} — passé ce délai, réactivez-le ici.', 'en', { reste: '09:47' }), 'It expires in 09:47 — after that, reactivate it here.')
  })
})

describe('R4 : règlement du jeu (texte généré)', () => {
  const base: DonneesReglement = {
    commerceId: 'c-lin',
    nom: 'Chez Lin',
    coordonnees: '12 rue des Lilas, 75011 Paris',
    actif: true,
    modeAccesRoue: 'libre',
    limiteGainsMois: 4,
    dotations: lotsAGagner(LOTS),
    secteurPerdant: true,
  }
  const texte = (d: DonneesReglement) => {
    const r = reglementDuJeu(d)
    return [r.titre, ...r.sections.flatMap((s) => [s.titre, ...s.contenu.flat()])].join('\n')
  }

  test('contenu : nom, organisateur, lots, « gratuite », « hasard », 1 tirage par jour, J+1 / 30 jours / 10 minutes, avis jamais une condition', () => {
    const t = texte(base)
    assert.match(t, /^Règlement du jeu « La roue Chez Lin »/)
    assert.match(t, /organisé par Chez Lin \(12 rue des Lilas, 75011 Paris\)/)
    assert.match(t, /loterie publicitaire gratuite, fondée sur le hasard/)
    assert.match(t, /\nNems offerts\n/)
    assert.match(t, /\nThé glacé\n/)
    assert.match(t, /\n10 points offerts \(points de fidélité\)\n/)
    assert.doesNotMatch(t, /Dommage|Lot à 0 %/)
    assert.match(t, /Un seul tirage par personne et par jour\./)
    assert.match(t, /à partir du lendemain du tirage et pendant 30 jours/)
    assert.match(t, /pendant 10 minutes/)
    assert.match(t, /limité à 4 sur 30 jours glissants/)
    assert.match(t, /n’est jamais une condition pour jouer ni pour gagner/)
  })

  test('aucune promesse, aucune valeur inventée (pas de montant, ni probabilité, ni coût, ni plafond)', () => {
    const t = texte(base)
    assert.doesNotMatch(t, /garanti|à coup sûr|assuré|à tous les coups|100 ?%|chaque tirage gagne|forcément/i)
    assert.doesNotMatch(t, /€|\d+ ?%|centimes|probabilit|plafond/i)
    assert.match(t, /prix de vente habituel/)
  })

  test('variantes : mode libre (sans obligation d’achat) / mode visite (visite validée au comptoir, jeu gratuit)', () => {
    assert.match(texte(base), /sans obligation d’achat/)
    assert.doesNotMatch(texte(base), /visite validée/)
    const visite = texte({ ...base, modeAccesRoue: 'visite' })
    assert.match(visite, /se débloque après une visite validée au comptoir le jour même/)
    assert.match(visite, /jamais sur l’accès au jeu, qui reste gratuit/)
    assert.doesNotMatch(visite, /sans obligation d’achat/)
  })

  test('phrases conditionnelles : limite illimitée, sans points, sans secteur perdant, sans coordonnées', () => {
    const t = texte({ ...base, coordonnees: undefined, limiteGainsMois: 0, secteurPerdant: false, dotations: [{ libelle: 'Nems offerts', type: 'lot' }] })
    assert.match(t, /organisé par Chez Lin, ci-après/)
    assert.doesNotMatch(t, /glissants|points de fidélité|aucun lot\./)
  })

  test('données publiées : depuis la config complète (plafonnés compris), jamais probabilité / coût / plafond / points', () => {
    const c: Commerce = { ...nouveauCommerce('Chez Lin', 'restaurant', ''), lots: LOTS, modeAccesRoue: 'visite', limiteGainsMois: 2 }
    const d = donneesReglement(c)
    assert.deepEqual(Object.keys(d).sort(), ['actif', 'commerceId', 'dotations', 'limiteGainsMois', 'modeAccesRoue', 'nom', 'secteurPerdant'])
    assert.equal(d.dotations.length, 3)
    assert.equal(d.modeAccesRoue, 'visite')
    assert.equal(d.limiteGainsMois, 2)
    assert.doesNotMatch(JSON.stringify(d), /probabilite|cout|plafond|"points":/)
    // Défauts appliqués : mode absent = visite, limite absente = 4.
    const ancien = donneesReglement({ ...c, modeAccesRoue: undefined, limiteGainsMois: undefined })
    assert.equal(ancien.modeAccesRoue, 'visite')
    assert.equal(ancien.limiteGainsMois, 4)
  })

  test('route #/reglement/<id> : page publique traduite (chrome), différée, texte légal en français', () => {
    assert.deepEqual(lireRoute('#/reglement/c-lin'), { page: 'reglement', param: 'c-lin' })
    assert.ok(PAGES_PUBLIQUES.includes('reglement'))
    assert.ok(estPageTraduite('reglement'))
    const app = lire('src/App.tsx')
    assert.match(app, /reglement: \(\) => import\('\.\/pages\/Reglement'\)/)
    assert.match(app, /reglement: Reglement/)
    const page = lire('src/pages/Reglement.tsx')
    assert.match(page, /api\.reglement\(param\)/)
    assert.match(page, /donneesReglement\(local\)/)
    assert.match(page, /<section key=\{s\.titre\} className="carte space-y-2" lang="fr">/)
    assert.match(page, /href=\{`#\/jouer\/\$\{vue\.commerceId\}`\}/)
    // La page de jeu n'importe pas le texte du règlement (bundle initial, P2-Q2).
    assert.doesNotMatch(lire('src/pages/Jouer.tsx'), /lib\/reglement/)
  })
})

describe('R4 : bloc du gain sur la carte (maquettes §3)', () => {
  // Tirage le mardi 10/11/2026 à 12 h (Paris) : utilisable du 11/11 au 10/12 inclus.
  const le = (jour: number, h = 0, min = 0, s = 0) => new Date(instantParis(2026, 11, 10 + jour, h, min).getTime() + s * 1000)
  const g: GainEnCours = {
    tirageId: 'ti-1',
    lot: 'Nems offerts',
    date: le(0, 12).toISOString(),
    statut: 'enAttente',
    utilisableLe: le(1).toISOString(),
    expireLe: le(31).toISOString(),
    expireActivation: null,
  }

  test('en attente (jour du tirage) : fenêtre de dates, pas de bouton', () => {
    const v = vueGain(g, undefined, le(0, 15))
    assert.equal(v?.etat, 'enAttente')
    assert.ok(v?.etat === 'enAttente')
    assert.equal(jourMois(v.du), '11/11')
    assert.equal(jourMois(v.au), '10/12')
    assert.equal(jourMois(v.au, 'en-GB'), '10/12')
  })

  test('utilisable : bouton « Utiliser mon gain » ; expiré : plus de bloc ; gain d’avant la roue v2 : retrait direct', () => {
    assert.deepEqual(vueGain({ ...g, statut: 'inactif' }, undefined, le(1, 12)), { etat: 'aActiver', au: le(31, 0, 0, -0.001), reactiver: false })
    assert.equal(vueGain({ ...g, statut: 'inactif' }, undefined, le(31)), null)
    assert.deepEqual(vueGain({ ...g, statut: 'utilisable', utilisableLe: le(0).toISOString(), expireLe: le(1).toISOString() }, undefined, le(0, 15)), { etat: 'direct' })
    // Fenêtre en cours côté serveur mais code inconnu de ce téléphone (page rechargée) : nouvel appui.
    assert.equal(vueGain({ ...g, statut: 'utilisable', expireActivation: le(1, 12, 10).toISOString() }, undefined, le(1, 12, 2))?.etat, 'aActiver')
  })

  test('le bouton d’activation n’existe que dans l’état « à utiliser » (source de la carte)', () => {
    const bloc = corps(lire('src/pages/CartePublique.tsx'), 'GainsRoue')
    assert.equal(bloc.match(/data-utiliser-gain/g)?.length, 1)
    const enAttente = bloc.slice(bloc.indexOf("vue.etat === 'enAttente' ?"), bloc.indexOf("vue.etat === 'direct' ?"))
    const code = bloc.slice(bloc.indexOf("vue.etat === 'code' ?"), bloc.indexOf('data-utiliser-gain'))
    assert.match(enAttente, /Utilisable du \{du\} au \{au\}\./)
    assert.match(enAttente, /Le code s’affichera quand vous serez au comptoir\./)
    for (const [nom, partie] of [['enAttente', enAttente], ['code', code.slice(0, code.lastIndexOf(') : ('))]] as const) {
      assert.doesNotMatch(partie, /<button/, nom)
    }
    assert.match(bloc, /onClick=\{\(\) => void utiliser\(g\.tirageId\)\}/)
    assert.match(bloc, /await activerCode\(api, jetons, \{ commerceId, clientId, tirageId \}\)/)
    assert.match(bloc, /role="timer" data-compte-a-rebours/)
    assert.match(bloc, /compteARebours\(vue\.resteMs\)/)
    // La carte place le bloc juste sous la carte de fidélité, depuis `gainsEnCours` du serveur.
    const carte = lire('src/pages/CartePublique.tsx')
    assert.match(carte, /<CarteFidelite client=\{client\} commerce=\{commerce\} animer gainDuJour=\{gainDuJour\} \/>\n\s*\{gains\}/)
    assert.match(carte, /gains: r\.gainsEnCours \?\? \[\]/)
  })

  test('compte à rebours après activation (horloge simulée) : 10:00 → 09:47 → 00:01 → réactivation proposée', (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: le(1, 12) })
    const activation = { code: 'W63ADN', expireActivation: le(1, 12, 10).toISOString() }
    const inactif = { ...g, statut: 'inactif' as const }
    const vue = () => vueGain(inactif, activation, new Date())
    const affiche: string[] = []
    // Comme `useMaintenant` (CartePublique) : l'heure relue chaque seconde.
    const minuterie = setInterval(() => {
      const v = vue()
      affiche.push(v?.etat === 'code' ? compteARebours(v.resteMs) : `${v?.etat}`)
    }, 1000)
    let v = vue()
    assert.ok(v?.etat === 'code')
    assert.equal(v.code, 'W63ADN')
    assert.equal(compteARebours(v.resteMs), '10:00')
    t.mock.timers.tick(13_000)
    assert.equal(affiche.at(-1), '09:47')
    t.mock.timers.tick(9 * 60_000 + 46_000)
    assert.equal(affiche.at(-1), '00:01')
    t.mock.timers.tick(1000)
    assert.equal(affiche.at(-1), 'aActiver')
    v = vue()
    assert.ok(v?.etat === 'aActiver' && v.reactiver, 'code échu : « Utiliser mon gain » à nouveau, avec le message de réactivation')
    clearInterval(minuterie)
    assert.equal(compteARebours(-5), '00:00')
    assert.equal(compteARebours(61_001), '01:02')
  })
})

describe('R4 : écran résultat (maquettes §2)', () => {
  const resultat = corps(lire('src/pages/Jouer.tsx'), 'Resultat')

  test('gain physique : « dès demain et jusqu’au JJ/MM » (J+30) + comment l’utiliser, plus de « valable aujourd’hui »', () => {
    assert.match(resultat, /t\('À utiliser dès demain et jusqu’au \{date\} au comptoir\.', \{ date: jourMois\(dernierJourGain\(\{ date: date \?\? new Date\(\)\.toISOString\(\), typeLot: 'lot' \}\), localeDate\(langue\)\) \}\)/)
    assert.match(resultat, /\{t\(TEXTE_GAIN_ACTIVATION\)\}/)
    assert.doesNotMatch(resultat, /TEXTE_GAIN_SANS_CODE/)
  })

  test('consolation points : « Pas de lot cette fois », points ajoutés + nouveau solde, prochaine chance demain, confettis gardés', () => {
    assert.match(resultat, /consolation \? t\('Pas de lot cette fois\{prenom\}…', \{ prenom: virgulePrenom\(prenom\) \}\)/)
    assert.match(resultat, /points != null && solde != null \? t\('\+\{n\} points ajoutés à votre carte\. Elle compte \{total\} points\.', \{ n: points, total: solde \}\)/)
    assert.match(resultat, /\{t\('Prochaine chance demain !'\)\}/)
    assert.equal(traduire('+{n} points ajoutés à votre carte. Elle compte {total} points.', 'en', { n: 10, total: 60 }), '+10 points added to your card. It now has 60 points.')
    // Le serveur renvoie bien points + solde (R2) : passés à l'écran.
    assert.match(lire('src/pages/Jouer.tsx'), /date=\{gain\.date\} points=\{gain\.points\} solde=\{gain\.solde\} \/>/)
  })

  test('l’invitation à l’avis reste APRÈS le résultat et indépendante (jamais une condition)', () => {
    const api = corps(lire('src/pages/Jouer.tsx'), 'PartieApi')
    assert.ok(api.indexOf('<Resultat') < api.indexOf('<InvitationAvis'))
    assert.match(api, /\{joueur && \(etape === 'resultat' \|\| jeu\?\.statut === 'dejaJoue'\) && \(\n\s*<>\n\s*<InvitationAvis/)
    assert.doesNotMatch(resultat, /InvitationAvis|avis/i)
  })
})

describe('R4 : serveur — règlement public, mode publié, parcours carte → activation (horloge pilotée)', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-r4-'))
  const horloge = { t: instantParis(2026, 11, 10, 12) }
  let app: Awaited<ReturnType<typeof creerServeur>>
  let racine = ''
  const PIN = { 'X-Commerce-PIN': '1234' }
  const AH = 'c-asian-home-paris'

  async function http(methode: string, chemin: string, corpsJson?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(`${racine}/api/v1${chemin}`, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...entetes },
      ...(corpsJson !== undefined ? { body: JSON.stringify(corpsJson) } : {}),
    })
    const texte = await r.text()
    return { statut: r.status, contenu: texte ? JSON.parse(texte) : null, texte }
  }

  before(async () => {
    app = await creerServeur({
      fichierDb: join(dossier, 'r4.db'),
      adminPin: '98765432',
      pinInitial: '1234',
      version: 'test',
      secretSession: 'secret-de-test-r4-ecrans-client-au-moins-32-caracteres',
      authClient: 'stricte',
      derriereProxy: true,
      maintenant: () => horloge.t,
      limitesPubliques: { inscriptionParIp: 1000, inscriptionParContact: 1000, ficheClientParIp: 1000, lectureParIp: 1000, lectureParCarte: 1000, tirageParIp: 1000, tirageParContact: 1000 },
    })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
    // Commerce de test seulement : un lot physique à 100 % (déterministe), accès libre.
    const r = await http('PATCH', `/commerces/${AH}`, { modeAccesRoue: 'libre', limiteGainsMois: 0, lots: [{ libelle: 'Nems offerts', probabilite: 100, plafondJour: 50 }, { libelle: 'Dommage', type: 'perdant', probabilite: 0 }] }, PIN)
    assert.equal(r.statut, 200, r.texte)
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('GET /commerces/:id/reglement : public, données du règlement seulement ; 404 inconnu ; 405 hors GET', async () => {
    const api = creerClientApi(`${racine}/api/v1`)
    const d = await api.reglement(AH)
    assert.equal(d.nom, (await api.commerce(AH)).nom)
    assert.equal(d.modeAccesRoue, 'libre')
    assert.equal(d.limiteGainsMois, 0)
    assert.deepEqual(d.dotations, [{ libelle: 'Nems offerts', type: 'lot' }])
    const brut = await http('GET', `/commerces/${AH}/reglement`)
    assert.doesNotMatch(brut.texte, /probabilite|plafond|cout|pin|hash|reglesReponseAuto|eurosParPoint/i)
    assert.equal((await http('GET', '/commerces/c-inconnu/reglement')).statut, 404)
    assert.equal((await http('POST', `/commerces/${AH}/reglement`, {})).statut, 405)
    assert.match(reglementDuJeu(d).titre, /La roue /)
    // Le mode d'accès est publié dans la vue publique (page de jeu).
    assert.equal((await api.commerce(AH)).modeAccesRoue, 'libre')
  })

  test('tirage libre → carte : gain en attente (pas de bouton) → J+1 « Utiliser mon gain » → code + 10:00 → caisse « Gain à remettre »', async () => {
    horloge.t = instantParis(2026, 11, 10, 12)
    const ins = await http('POST', `/commerces/${AH}/clients`, { contact: '0610000401' })
    assert.equal(ins.statut, 201, ins.texte)
    const { client, jeton } = ins.contenu
    const bearer = { Authorization: `Bearer ${jeton}` }
    const tirage = await http('POST', `/commerces/${AH}/tirages`, {}, bearer)
    assert.equal(tirage.statut, 201, tirage.texte)
    assert.equal(tirage.contenu.lot, 'Nems offerts')

    const api = creerClientApi(`${racine}/api/v1`)
    const carteJ = await api.carte(client.id, jeton)
    const gainJ = carteJ.gainsEnCours![0]
    assert.equal(vueGain(gainJ, undefined, horloge.t)?.etat, 'enAttente')

    horloge.t = instantParis(2026, 11, 11, 18, 30)
    const gain = (await api.carte(client.id, jeton)).gainsEnCours![0]
    assert.deepEqual(vueGain(gain, undefined, horloge.t), { etat: 'aActiver', au: new Date(instantParis(2026, 12, 11).getTime() - 1), reactiver: false })
    const issue = await activerCode(api, { lire: () => ({ jeton, expireLe: '2099-01-01T00:00:00Z' }) }, { commerceId: AH, clientId: client.id, tirageId: gain.tirageId })
    assert.ok(issue.ok, JSON.stringify(issue))
    const vue = vueGain(gain, issue.activation, horloge.t)
    assert.ok(vue?.etat === 'code')
    assert.match(vue.code, /^[A-Z0-9]{6}$/)
    assert.equal(compteARebours(vue.resteMs), '10:00')
    assert.equal((await http('POST', '/commerces/' + AH + '/equipe', { nom: 'Mai', code: '2468' }, PIN)).statut, 201)
    const caisse = await http('GET', `/commerces/${AH}/caisse/gains/${vue.code}`, undefined, { 'X-Equipe-Code': '2468' })
    assert.equal(caisse.contenu.gain.statut, 'utilisable', caisse.texte)
  })
})

describe('R4 : GET /commerces/:id/reglement limité par IP (lectures publiques)', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-r4-ip-'))
  let app: Awaited<ReturnType<typeof creerServeur>>
  let racine = ''
  before(async () => {
    app = await creerServeur({ fichierDb: join(dossier, 'ip.db'), adminPin: '98765432', pinInitial: '1234', version: 'test', derriereProxy: true, limitesPubliques: { lectureParIp: 2 } })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    racine = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}`
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('au-delà du quota de lecture de l’IP : 429, même pour un commerce inconnu (avant toute lecture en base)', async () => {
    const lire = (id: string, ip: string) => fetch(`${racine}/api/v1/commerces/${id}/reglement`, { headers: { 'X-Forwarded-For': ip } }).then((r) => r.status)
    assert.deepEqual([await lire('c-asian-home-paris', '203.0.113.7'), await lire('c-asian-home-paris', '203.0.113.7'), await lire('c-asian-home-paris', '203.0.113.7')], [200, 200, 429])
    assert.equal(await lire('c-inconnu', '203.0.113.7'), 429)
    assert.equal(await lire('c-asian-home-paris', '203.0.113.8'), 200, 'autre IP : non bloquée')
  })
})

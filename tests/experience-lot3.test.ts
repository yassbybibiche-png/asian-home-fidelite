// Expérience 10/10, lot 3 — écran cuisine #/cuisine : logique pure (src/lib/cuisine.ts) testée directement ; la page
// (.tsx, non importable par node --test) vérifiée sur le source, comme les lots précédents : enregistrement (routeur,
// registre différé, navigation), appels directs sans méthode du client API, relecture 10 s page visible, conflit
// 400/404/409 = relecture silencieuse + note, module désactivé = écran explicatif. Le parcours réel (deux téléphones
// simulés) est couvert par tests-e2e/experience-commande.spec.ts.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  actionsCuisine,
  anciennete,
  commandesDeSection,
  heureCommande,
  INTERVALLE_CUISINE_MS,
  jourLisible,
  jourPrecedent,
  nouvellesCommandes,
  remplacerCommande,
  SECTIONS_CUISINE,
  type CommandeCuisine,
} from '../src/lib/cuisine.ts'
import { STATUTS_COMMANDE, transitionValide } from '../src/lib/commande.ts'
import { lireRoute, PAGES_PUBLIQUES } from '../src/router.ts'
import type { StatutCommande } from '../src/types.ts'

const lire = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

function commande(id: string, statut: StatutCommande, creeLe: string, table = 'Table 1'): CommandeCuisine {
  return { id, commerceId: 'c-a', table, lignes: [], total: 0, statut, creeLe, majLe: creeLe }
}

describe('Lot 3 — logique de l’écran cuisine (src/lib/cuisine.ts)', () => {
  test('sections : Nouvelles, Acceptées, En préparation, Servies (repliée), Refusées (discrète) — tous les statuts, une fois', () => {
    assert.deepEqual(
      SECTIONS_CUISINE.map((s) => [s.statut, s.titre]),
      [
        ['recue', 'Nouvelles'],
        ['acceptee', 'Acceptées'],
        ['en_preparation', 'En préparation'],
        ['servie', 'Servies'],
        ['refusee', 'Refusées'],
      ],
    )
    assert.deepEqual([...SECTIONS_CUISINE.map((s) => s.statut)].sort(), [...STATUTS_COMMANDE].sort())
    assert.equal(SECTIONS_CUISINE.find((s) => s.statut === 'servie')?.repliee, true)
    assert.equal(SECTIONS_CUISINE.find((s) => s.statut === 'refusee')?.discrete, true)
    assert.ok(SECTIONS_CUISINE.slice(0, 3).every((s) => !s.repliee && !s.discrete))
  })

  test('ordre : à faire = plus anciennes d’abord ; terminées = plus récentes d’abord', () => {
    const l = [
      commande('b', 'recue', '2026-11-13T11:10:00.000Z'),
      commande('a', 'recue', '2026-11-13T11:00:00.000Z'),
      commande('s1', 'servie', '2026-11-13T10:00:00.000Z'),
      commande('s2', 'servie', '2026-11-13T10:30:00.000Z'),
      commande('x', 'acceptee', '2026-11-13T09:00:00.000Z'),
    ]
    assert.deepEqual(commandesDeSection(l, 'recue').map((c) => c.id), ['a', 'b'])
    assert.deepEqual(commandesDeSection(l, 'servie').map((c) => c.id), ['s2', 's1'])
    assert.deepEqual(commandesDeSection(l, 'en_preparation'), [])
  })

  test('actions = exactement les transitions acceptées par le serveur (transitionValide), une principale par statut actif', () => {
    for (const de of STATUTS_COMMANDE) {
      const actions = actionsCuisine(de)
      for (const a of actions) assert.ok(transitionValide(de, a.vers), `${de} → ${a.vers}`)
      const attendues = STATUTS_COMMANDE.filter((v) => transitionValide(de, v))
      assert.deepEqual(actions.map((a) => a.vers).sort(), [...attendues].sort(), de)
      if (actions.length) assert.equal(actions.filter((a) => a.principale).length, 1, de)
    }
    assert.deepEqual(actionsCuisine('recue').map((a) => a.libelle), ['Accepter', 'Refuser'])
    assert.deepEqual(actionsCuisine('acceptee').map((a) => a.libelle), ['En préparation'])
    assert.deepEqual(actionsCuisine('en_preparation').map((a) => a.libelle), ['Servie'])
    assert.deepEqual(actionsCuisine('servie'), [])
    assert.deepEqual(actionsCuisine('refusee'), [])
  })

  test('ancienneté : à l’instant, minutes, heures ; jamais négative (horloge de l’appareil en retard)', () => {
    const t = Date.parse('2026-11-13T12:00:00.000Z')
    assert.equal(anciennete('2026-11-13T11:59:30.000Z', t), 'à l’instant')
    assert.equal(anciennete('2026-11-13T12:00:30.000Z', t), 'à l’instant')
    assert.equal(anciennete('2026-11-13T11:53:00.000Z', t), 'il y a 7 min')
    assert.equal(anciennete('2026-11-13T11:01:00.000Z', t), 'il y a 59 min')
    assert.equal(anciennete('2026-11-13T10:55:00.000Z', t), 'il y a 1 h 05')
  })

  test('heure de la commande à Paris, quel que soit le fuseau de l’appareil (hiver et été)', () => {
    assert.equal(heureCommande('2026-11-13T11:05:00.000Z'), '12:05')
    assert.equal(heureCommande('2026-07-01T11:05:00.000Z'), '13:05')
  })

  test('jour précédent calculé sur la date (fin de mois, d’année, février, lendemains de changement d’heure)', () => {
    assert.equal(jourPrecedent('2026-11-13'), '2026-11-12')
    assert.equal(jourPrecedent('2026-01-01'), '2025-12-31')
    assert.equal(jourPrecedent('2026-03-01'), '2026-02-28')
    assert.equal(jourPrecedent('2028-03-01'), '2028-02-29')
    assert.equal(jourPrecedent('2026-03-30'), '2026-03-29')
    assert.equal(jourPrecedent('2026-10-26'), '2026-10-25')
    assert.equal(jourLisible('2026-11-13'), 'vendredi 13 novembre')
  })

  test('« Nouveau » : rien au premier affichage ; puis les reçues apparues depuis, tant qu’elles sont reçues', () => {
    const a = commande('a', 'recue', '2026-11-13T11:00:00.000Z')
    const b = commande('b', 'recue', '2026-11-13T11:05:00.000Z')
    const c = commande('c', 'acceptee', '2026-11-13T11:06:00.000Z')
    // Premier affichage : tout est déjà dans « Nouvelles », rien n'est signalé.
    assert.deepEqual([...nouvellesCommandes([a], null, new Set())], [])
    // Relecture : b est arrivée (signalée) ; c aussi mais déjà acceptée ailleurs (pas signalée).
    const s1 = nouvellesCommandes([a, b, c], new Set(['a']), new Set())
    assert.deepEqual([...s1], ['b'])
    // Relecture suivante : b reste signalée tant qu'elle est reçue…
    assert.deepEqual([...nouvellesCommandes([a, b, c], new Set(['a', 'b', 'c']), s1)], ['b'])
    // … et ne l'est plus une fois acceptée.
    assert.deepEqual([...nouvellesCommandes([a, { ...b, statut: 'acceptee' }, c], new Set(['a', 'b', 'c']), s1)], [])
  })

  test('remplacerCommande : une seule commande remplacée, ordre conservé, liste d’origine intacte', () => {
    const l = [commande('a', 'recue', '2026-11-13T11:00:00.000Z'), commande('b', 'recue', '2026-11-13T11:05:00.000Z')]
    const r = remplacerCommande(l, { ...l[1], statut: 'acceptee' })
    assert.deepEqual(r.map((c) => [c.id, c.statut]), [['a', 'recue'], ['b', 'acceptee']])
    assert.equal(l[1].statut, 'recue')
  })

  test('relecture toutes les 10 s ; module sans import du bundle initial (types seulement)', () => {
    assert.equal(INTERVALLE_CUISINE_MS, 10_000)
    const src = lire('src/lib/cuisine.ts')
    for (const m of src.matchAll(/^import .*$/gm)) assert.match(m[0], /^import type /, m[0])
  })
})

describe('Lot 3 — page #/cuisine (source)', () => {
  const page = lire('src/pages/Cuisine.tsx')
  const app = lire('src/App.tsx')

  test('enregistrée : route, import différé, composant ; écran commerçant (PIN), pas une page publique', () => {
    assert.deepEqual(lireRoute('#/cuisine'), { page: 'cuisine', param: undefined })
    assert.ok(!PAGES_PUBLIQUES.includes('cuisine'))
    assert.match(app, /cuisine: \(\) => import\('\.\/pages\/Cuisine'\)/)
    assert.match(app, /const Cuisine = lazy\(IMPORTS\.cuisine\)/)
    assert.match(app, /cuisine: Cuisine,/)
    assert.doesNotMatch(app, /PAGES_PUBLIQUES_DIFFEREES: Page\[\] = \[[^\]]*'cuisine'/)
  })

  test('navigation : onglet bureau, écran Plus (mobile), lien des Réglages « Commande à table »', () => {
    assert.match(app, /\{ page: 'cuisine', libelle: 'Cuisine' \}/)
    assert.match(app, /PAGES_SOUS_PLUS: Page\[\] = \[[^\]]*'cuisine'/)
    assert.match(lire('src/pages/Plus.tsx'), /\{ page: 'cuisine', titre: 'Cuisine'/)
    assert.match(lire('src/components/ui.tsx'), /\n {2}cuisine: 'M/)
    const reglages = lire('src/components/ReglagesCommande.tsx')
    assert.match(reglages, /href="#\/cuisine"/)
    assert.doesNotMatch(reglages, /prochaine étape/)
  })

  test('appels directs (fetch + en-têtes de session), aucune méthode ajoutée au client API', () => {
    assert.match(page, /await fetch\(url, \{/)
    assert.match(page, /if \(a\.jeton\) return \{ 'X-Session': a\.jeton \}/)
    assert.match(page, /cache: 'no-store'/)
    assert.doesNotMatch(lire('src/data/api.ts'), /listerCommandes|statutCommande|commandesDuJour/)
    assert.match(page, /\$\{url\}\/\$\{encodeURIComponent\(c\.id\)\}\/statut/)
    assert.match(page, /\$\{url\}\?jour=\$\{jourPrecedent\(aujourdhui\.current!\)\}/)
  })

  test('relecture 10 s page visible + retour au premier plan, aujourd’hui seulement ; bouton « Actualiser »', () => {
    assert.match(page, /if \(choix !== 'aujourdhui'\) return/)
    assert.match(page, /if \(document\.visibilityState === 'visible'\) void charger\(\)/)
    assert.match(page, /window\.setInterval\(siVisible, INTERVALLE_CUISINE_MS\)/)
    assert.match(page, /document\.addEventListener\('visibilitychange', siVisible\)/)
    assert.match(page, /\{chargement \? 'Actualisation…' : 'Actualiser'\}/)
    // Réponses périmées ignorées (changement de jour, clic pendant une lecture).
    assert.match(page, /if \(n !== numero\.current\) return/)
  })

  test('transition : retour immédiat ; 400/404/409 = relecture + note discrète (pas d’alerte) ; autre échec = carte remise', () => {
    const changer = page.slice(page.indexOf('const changer = async'), page.indexOf('const commandes = liste?.commandes'))
    assert.ok(changer.length > 200)
    // Affichage immédiat : la carte change de section AVANT l'appel au serveur.
    assert.match(changer, /setListe\(\(l\) => l && \{ \.\.\.l, commandes: remplacerCommande\(l\.commandes, \{ \.\.\.c, statut: vers \}\) \}\)\s*const r = await appeler\(/)
    assert.match(changer, /r\.statut === 400 \|\| r\.statut === 404 \|\| r\.statut === 409\) \{\s*\/\/[^\n]*\n\s*setNote\([^)]*autre appareil[^)]*\)\s*void charger\(\)/)
    assert.doesNotMatch(changer, /setErreur/)
    assert.match(changer, /remplacerCommande\(l\.commandes, c\)/)
    assert.match(page, /role="status">\s*<span>\{note\}<\/span>/)
  })

  test('« Nouveau » visuel (pastille + bordure), sans son ; annonce polie pour les lecteurs d’écran', () => {
    assert.match(page, /nouvelle && <span [^>]*>Nouveau<\/span>/)
    assert.match(page, /\$\{nouvelle \? 'ring-4 ring-magenta-500' : ''\}/)
    assert.doesNotMatch(page, /<audio|new Audio|\.mp3|\.ogg|\.wav/)
    assert.match(page, /aria-live="polite"/)
  })

  test('cartes : table en très grand, heure, ancienneté, quantités, options, instructions surlignées, total ; boutons larges', () => {
    assert.match(page, /text-3xl[^"]*font-bold[^"]*">\{c\.table\}</)
    assert.match(page, /\{heureCommande\(c\.creeLe\)\}/)
    assert.match(page, /\{anciennete\(c\.creeLe, maintenant\)\}/)
    assert.match(page, /\{l\.quantite\} ×/)
    assert.match(page, /l\.options\.map\(\(o\) => o\.nom\)/)
    assert.match(page, /\{l\.instructions && <p className="[^"]*bg-amber-100/)
    assert.match(page, /\{c\.instructions && \(/)
    assert.match(page, /\{formaterPrix\(c\.total\)\}/)
    assert.match(page, /min-h-14 text-lg/)
    // Historique (hier) : lecture seule, aucune action.
    assert.match(page, /onAction=\{choix === 'aujourdhui' \? changer : undefined\}/)
  })

  test('module désactivé → explication + lien Réglages ; démo locale → explication ; erreur → message + « Réessayer »', () => {
    assert.match(page, /if \(!commerce\.commande\?\.active\) \{/)
    assert.match(page, /<a href="#\/reglages" className="bouton/)
    assert.match(page, /if \(mode !== 'api' \|\| !api \|\| !acces\) \{/)
    assert.match(page, /role="alert"/)
    assert.match(page, /onClick=\{\(\) => void charger\(\)\}>\s*Réessayer/)
    assert.match(page, /if \(r\.statut === 0\) return MESSAGE_HORS_LIGNE/)
  })

  test('écran commerçant en français du back-office : ni t(…), ni commutateur de langue', () => {
    assert.doesNotMatch(page, /useLangue|CommutateurLangue|enregistrerTraductions|\bt\('/)
  })
})

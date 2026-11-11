// P0-U4 — Fin du cul-de-sac avant validation : texte inversé (étapes numérotées), attente animée, déblocage visible,
// CTA pendant l'attente, vérification qui ne martèle pas le serveur et mode dégradé propre hors ligne.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  apresVerification,
  delaiProchaineVerification,
  doitVerifier,
  ETAPES_VALIDATION,
  INTERVALLE_MAX_MS,
  INTERVALLE_VERIFICATION_MS,
  INTRO_ATTENTE,
  MESSAGE_ATTENTE_HORS_LIGNE,
  MESSAGE_VISITE_VALIDEE,
  suivreVisite,
  TEXTE_ATTENTE,
  visiteVientDEtreValidee,
  type SuiviVisite,
} from '../src/lib/attenteVisite.ts'
import type { StatutJeu } from '../src/lib/roulette.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')

describe('P0-U4 : textes', () => {
  test('ordre inversé : 1. présenter la carte en caisse, 2. revenir ici (la roue se débloque seule)', () => {
    assert.deepEqual([...ETAPES_VALIDATION], ['Présentez votre carte de fidélité en caisse.', 'Revenez ici : la roue se débloque toute seule.'])
    assert.equal(INTRO_ATTENTE, 'Plus que deux petites étapes avant de tourner la roue :')
    assert.equal(TEXTE_ATTENTE, 'En attente de validation…')
    assert.equal(MESSAGE_VISITE_VALIDEE, 'Visite validée — à vous de jouer !')
    // Vouvoiement, pas de tutoiement.
    for (const t of [...ETAPES_VALIDATION, INTRO_ATTENTE, MESSAGE_ATTENTE_HORS_LIGNE]) assert.doesNotMatch(t, /\b(tu|ton|ta|tes|toi)\b/i)
  })

  test('hors ligne : message clair qui dit que la vérification reprendra seule', () => {
    assert.match(MESSAGE_ATTENTE_HORS_LIGNE, /^Connexion perdue/)
    assert.match(MESSAGE_ATTENTE_HORS_LIGNE, /réessayons automatiquement/)
  })

  test('#/jouer n’affiche plus l’ancien message « validez d’abord … au comptoir »', () => {
    const jouer = lire('src/pages/Jouer.tsx')
    assert.doesNotMatch(jouer, /validez d’abord/)
    assert.match(jouer, /\{ETAPES_VALIDATION\.map\(\(etape, i\) =>/)
    assert.match(jouer, /<ol className="space-y-2" aria-label=\{t\('Pour débloquer la roue'\)\}>/)
    assert.match(jouer, /\{i \+ 1\}/)
  })
})

describe('P0-U4 : rythme de vérification', () => {
  test('10 s tant que le serveur répond, puis 20 / 40 / 60 s (plafond) après des échecs', () => {
    assert.equal(INTERVALLE_VERIFICATION_MS, 10_000)
    assert.deepEqual([0, 1, 2, 3, 4, 50].map(delaiProchaineVerification), [10_000, 20_000, 40_000, 60_000, 60_000, INTERVALLE_MAX_MS])
    assert.equal(delaiProchaineVerification(-3), 10_000)
  })

  test('on ne vérifie en boucle que tant que la roue est verrouillée', () => {
    assert.equal(doitVerifier(undefined), true)
    assert.equal(doitVerifier(null), true)
    assert.equal(doitVerifier('sansVisite'), true)
    assert.equal(doitVerifier('pret'), false)
    assert.equal(doitVerifier('dejaJoue'), false)
  })

  test('boucle simulée : coupure réseau → espacement, retour → 10 s, validation en caisse → arrêt', () => {
    const reponses: (StatutJeu | null)[] = ['sansVisite', null, null, 'sansVisite', 'pret']
    let echecs = 0
    const delais: (number | null)[] = []
    for (const r of reponses) {
      const suite = apresVerification(r, echecs)
      echecs = suite.echecs
      delais.push(suite.delai)
    }
    assert.deepEqual(delais, [10_000, 20_000, 40_000, 10_000, null])
    assert.equal(echecs, 0)
    assert.deepEqual(apresVerification('dejaJoue', 2), { echecs: 0, delai: null })
  })
})

describe('P0-U4 : transition après validation', () => {
  const suivre = (statuts: (StatutJeu | null | undefined)[]) =>
    statuts.reduce<SuiviVisite>((s, statut) => suivreVisite(s, statut), { statut: undefined, validee: false })

  test('sans visite → prêt : la confirmation « Visite validée » s’affiche', () => {
    assert.equal(visiteVientDEtreValidee('sansVisite', 'pret'), true)
    assert.equal(suivre([undefined, 'sansVisite', 'sansVisite', 'pret']).validee, true)
  })

  test('déjà validé à l’arrivée, ou déjà joué : pas de confirmation', () => {
    assert.equal(suivre([undefined, 'pret']).validee, false)
    assert.equal(suivre(['sansVisite', 'dejaJoue']).validee, false)
    assert.equal(visiteVientDEtreValidee(undefined, 'pret'), false)
  })

  test('la confirmation reste affichée une fois vue (pas de clignotement si un statut intermédiaire passe)', () => {
    assert.equal(suivre(['sansVisite', 'pret', undefined, 'pret']).validee, true)
    const s: SuiviVisite = { statut: 'pret', validee: true }
    assert.equal(suivreVisite(s, 'pret'), s)
  })
})

describe('P0-U4 : écran d’attente (source)', () => {
  const jouer = lire('src/pages/Jouer.tsx')
  const css = lire('src/index.css')

  test('état d’attente animé et annoncé : role=status, aria-live, aria-busy, point pulsé', () => {
    assert.match(
      jouer,
      /<div className="hero-sombre flex items-center justify-center gap-3 rounded-xl px-4 py-3" role="status" aria-live="polite" aria-busy="true" data-attente="en-cours">\n\s*<span className="attente-pulse" aria-hidden \/>\n\s*<span className="font-semibold text-magenta-300">\{t\(TEXTE_ATTENTE\)\}<\/span>/,
    )
    assert.match(css, /@keyframes attente-halo/)
    assert.match(css, /@keyframes attente-point/)
    assert.match(css, /\.attente-pulse \{[^}]*animation: attente-point 1\.6s ease-in-out infinite;/)
    assert.match(css, /\.attente-pulse::after \{[^}]*animation: attente-halo 1\.6s ease-out infinite;/)
    // Mouvement réduit : animation coupée (pas de clignotement accéléré par la règle globale à 0,01 ms).
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n\s*\.attente-pulse,\n\s*\.attente-pulse::after \{\n\s*animation: none;/)
  })

  test('hors ligne : l’animation laisse place à une alerte claire + « Réessayer maintenant »', () => {
    assert.match(jouer, /\{horsLigne \? \(\n\s*<div className="[^"]*" role="alert" data-attente="hors-ligne">\n\s*<p>\{t\(MESSAGE_ATTENTE_HORS_LIGNE\)\}<\/p>/)
    assert.match(jouer, /Réessayer maintenant/)
    // Seule une erreur réseau (statut 0 ou exception hors ErreurApi) passe en mode hors ligne.
    assert.match(jouer, /setHorsLigne\(!\(e instanceof ErreurApi\) \|\| e\.horsLigne\)/)
    assert.match(jouer, /setHorsLigne\(false\)/)
  })

  test('chargement initial en échec : message + bouton Réessayer (jamais d’écran figé)', () => {
    assert.match(jouer, /<MessageErreur>\{message\}<\/MessageErreur>\n\s*<button className="bouton-secondaire w-full" onClick=\{\(\) => verifierMaintenant\.current\(\)\}>\n\s*\{t\('Réessayer'\)\}/)
  })

  test('CTA pendant l’attente : Voir ma carte (primaire), Voir le menu, Vérifier maintenant', () => {
    assert.match(jouer, /<a href=\{lienCarte\} className="bouton w-full">\n\s*\{t\('Voir ma carte de fidélité'\)\}/)
    assert.match(jouer, /<a href=\{lienMenu\} className="bouton-secondaire w-full">\n\s*\{t\('📖 Voir le menu en attendant'\)\}/)
    assert.match(jouer, /C’est validé \? Vérifier maintenant/)
    assert.match(jouer, /lienMenu=\{menuDisponible \? `#\/menu\/\$\{commerce\.id\}` : undefined\}/)
    // Menu toujours là chez Asian Home (vraie carte en repli), sinon selon la réponse du serveur.
    assert.match(jouer, /useState\(\(\) => estAsianHome\(commerce\)\)/)
    assert.match(jouer, /setMenuDisponible\(\(m\) => m \|\| !!r\.menuDisponible\)/)
  })

  test('transition visible : « Visite validée » au-dessus du bouton de la roue (mode API et démo)', () => {
    assert.match(jouer, /<p className="alerte-succes apparition text-center text-base" role="status" aria-live="polite" data-attente="validee">\n\s*✓ \{t\(MESSAGE_VISITE_VALIDEE\)\}/)
    assert.match(jouer, /\{visiteValidee && <VisiteValidee \/>\}\n\s*<MessageErreur>\{message\}<\/MessageErreur>\n\s*<button className="bouton w-full py-4 text-lg" onClick=\{\(\) => void tourner\(\)\}/)
    assert.match(jouer, /\{visiteValidee && etape === 'pret' && <VisiteValidee \/>\}/)
    assert.equal(jouer.match(/useVisiteValidee\(/g)?.length, 3) // définition + 2 modes
  })

  test('vérification : boucle setTimeout pilotée par apresVerification, reprise au focus / onglet / réseau', () => {
    assert.doesNotMatch(jouer, /setInterval\(/)
    assert.match(jouer, /const suite = apresVerification\(statut, echecs\)/)
    assert.match(jouer, /if \(suite\.delai !== null\) prochaine = window\.setTimeout\(siVisible, suite\.delai\)/)
    for (const evt of ["document.addEventListener('visibilitychange', siVisible)", "window.addEventListener('focus', siVisible)", "window.addEventListener('online', siVisible)"])
      assert.ok(jouer.includes(evt), evt)
    for (const evt of ["document.removeEventListener('visibilitychange', siVisible)", "window.removeEventListener('focus', siVisible)", "window.removeEventListener('online', siVisible)"])
      assert.ok(jouer.includes(evt), evt)
    // Pas de requêtes en parallèle (focus + minuterie) ni onglet caché.
    assert.match(jouer, /if \(enVol\) return/)
    assert.match(jouer, /if \(document\.visibilityState === 'visible'\) void verifier\(\)/)
  })

  test('règles inchangées : le jeu ne valide jamais de visite, tirage par le serveur', () => {
    assert.match(jouer, /\/\/ Pas de visite validée aujourd'hui ou déjà joué : rien ne se passe \(le jeu ne crée jamais de visite\)\./)
    assert.match(jouer, /const issue = await lancerTirage\(api, commerce, joueur\.contact, joueur\.prenom\)/)
    assert.doesNotMatch(jouer, /enregistrerPassage|validerVisite/)
  })
})

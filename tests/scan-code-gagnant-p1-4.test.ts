// P1-4 — Scan du code gagnant à la caisse : le code est affiché en QR sur le téléphone du client (GainsRoue),
// la caisse le scanne (vérification automatique à la lecture) ; la saisie manuelle reste le repli, caméra refusée
// ou non. Le QR n'encode que le code à 6 caractères : un QR d'autre chose (carte du client, QR vitrine) est refusé
// sans appel serveur. QR et panneau de scan sont des modules différés (jamais dans le bundle initial, plafond P2-Q2).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { normaliserCodeGagnant } from '../src/lib/roulette.ts'
import { TRADUCTIONS_EN } from '../src/lib/langue.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')

describe('P1-4 : QR du code gagnant sur la carte du client', () => {
  test('vue « code » : le code est aussi affiché en QR, avec sa légende', () => {
    const carte = lire('src/pages/CartePublique.tsx')
    // Le QR encode exactement le code affiché en texte (6 caractères, jamais un lien ni un identifiant).
    assert.match(carte, /<QrCodeGain code=\{vue\.code\} \/>/)
    assert.match(carte, /data-qr-code-gagnant/)
    const qr = lire('src/components/QrCodeGain.tsx')
    assert.match(qr, /<QrCode texte=\{code\}/)
    assert.match(qr, /t\('Ou présentez ce QR au comptoir\.'\)/)
    assert.match(qr, /t\('QR code du gain à présenter au comptoir'\)/)
  })

  test('QR chargé en différé (hors bundle initial) et protégé par une frontière locale', () => {
    const carte = lire('src/pages/CartePublique.tsx')
    assert.match(carte, /const QrCodeGain = lazy\(\(\) => import\('\.\.\/components\/QrCodeGain'\)/)
    assert.doesNotMatch(carte, /^import .*\bQrCodeGain\b.*from/m, 'QrCodeGain ne doit pas être importé statiquement (page critique, bundle initial plafonné)')
    assert.match(carte, /<Suspense fallback=\{<div className="h-40 w-40 bg-white"/)
    const qr = lire('src/components/QrCodeGain.tsx')
    assert.match(qr, /const QrCode = lazy\(\(\) => import\('\.\/QrCode'\)/)
    // Un import rejeté n'affiche qu'un repli sous le code : le code en texte reste lisible, la page reste debout.
    assert.match(qr, /<ErreurQr message=\{t\('QR indisponible/)
  })

  test('légende et titre du QR traduits en anglais', () => {
    assert.equal(TRADUCTIONS_EN['Ou présentez ce QR au comptoir.'], 'Or show this QR code at the counter.')
    assert.equal(TRADUCTIONS_EN['QR code du gain à présenter au comptoir'], 'QR code for your prize, to show at the counter')
    assert.equal(
      TRADUCTIONS_EN['QR indisponible — le code ci-dessus suffit, la caisse peut le saisir.'],
      'QR code unavailable — the code above is enough, the counter can type it in.',
    )
  })
})

describe('P1-4 : scanner du code gagnant en caisse', () => {
  test('section du code gagnant différée, bouton « Scanner le code » dedans', () => {
    const caisse = lire('src/pages/Caisse.tsx')
    assert.match(caisse, /const CodeGagnantCaisse = lazy\(\(\) => import\('\.\.\/components\/CodeGagnantCaisse'\)/)
    assert.doesNotMatch(caisse, /^import .*\bCodeGagnantCaisse\b.*from/m, 'CodeGagnantCaisse ne doit pas être importée statiquement (page critique, bundle initial plafonné)')
    assert.match(caisse, /<CodeGagnantCaisse onGain=\{onGain\} \/>/)
    const section = lire('src/components/CodeGagnantCaisse.tsx')
    assert.match(section, /📷 Scanner le code/)
    assert.match(section, /scannerGain \? \(/)
    assert.match(section, /const ScanCodeGagnant = lazy\(\(\) => import\('\.\/ScanCodeGagnant'\)/)
    assert.match(section, /<ScanCodeGagnant/)
    // Le repli manuel reste proposé depuis le panneau (saisie du code, pas du prénom).
    assert.match(section, /onSaisieManuelle=\{\(\) => \(setScannerGain\(false\), setTimeout\(\(\) => saisieRef\.current\?\.focus\(\), 0\)\)\}/)
  })

  test('code scanné : panneau refermé, saisie remplie, vérification tout de suite, sans frappe', () => {
    const section = lire('src/components/CodeGagnantCaisse.tsx')
    // Mémorisé : le panneau redémarre sa caméra à chaque changement d'onCode.
    assert.match(section, /const surCodeVerifie = useCallback\(\s*\(codeLu: string\)/)
    assert.match(section, /setScannerGain\(false\)/)
    assert.match(section, /setSaisi\(codeLu\)/)
    assert.match(section, /void appeler\('verifier', codeLu\)/)
    // Le repli saisie reste en place (champ + bouton Vérifier).
    assert.match(section, /id="caisse-code-gagnant"/)
    assert.match(section, /\{enCours \? '…' : 'Vérifier'\}/)
  })

  test('QR d’autre chose : refus explicite, sans appel serveur, nouveau scan possible', () => {
    const scan = lire('src/components/ScanCodeGagnant.tsx')
    assert.match(scan, /const code = normaliserCodeGagnant\(texte\)/)
    assert.match(scan, /Ce QR n’est pas un code gagnant : visez le QR affiché sous le code, sur le téléphone du client\./)
    assert.match(scan, /📷 Scanner à nouveau/)
    assert.match(scan, /⌨ Saisir le code/)
    // Le scanner du gain a son propre titre et sa propre consigne (pas ceux de la carte du client)…
    assert.match(scan, /titre="Scanner le code gagnant"/)
    assert.match(scan, /instruction="Visez le QR affiché sous le code, sur le téléphone du client\."/)
    // …et le même repli manuel que le scanner de carte.
    assert.match(scan, /libelleSaisieManuelle="⌨ Saisir le code"/)
    assert.match(scan, /<ScannerQr[\s\S]{0,500}?onSaisieManuelle=\{/)
  })

  test('un QR de carte ou de vitrine n’est pas un code gagnant (normalisation)', () => {
    assert.equal(normaliserCodeGagnant('https://app.example/carte/c-123'), null)
    assert.equal(normaliserCodeGagnant('ABC234'), 'ABC234')
    assert.equal(normaliserCodeGagnant('abc234'), 'ABC234')
  })
})

describe('P1-4 : ScannerQr paramétrable, repli carte inchangé', () => {
  test('titre, consigne et libellé de repli paramétrables ; défauts = scan de la carte', () => {
    const s = lire('src/components/ScannerQr.tsx')
    assert.match(s, /titre = 'Scanner la carte du client'/)
    assert.match(s, /instruction = 'Visez le QR code de la carte du client\.'/)
    assert.match(s, /<h2 className="titre-carte">\{titre\}<\/h2>/)
    assert.match(s, /\{pret \? instruction : 'Ouverture de la caméra…'}/)
  })

  test('caméra refusée : le bouton de repli manuel garde son libellé par défaut (garde-fou p1-c6)', () => {
    const s = lire('src/components/ScannerQr.tsx')
    const bloc = s.slice(s.indexOf('{erreur ? ('))
    assert.match(bloc.slice(0, bloc.indexOf(') : (')), /onSaisieManuelle[\s\S]*Saisir le prénom/)
  })
})

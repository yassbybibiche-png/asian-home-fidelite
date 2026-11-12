// Correction Codex point 11 — ScannerQr : un échec d'initialisation du décodeur (constructeur natif, import jsQR) ou des
// erreurs de détection en continu ne laissent plus la caméra ouverte sans lecture : repli natif → jsQR, puis erreur
// explicite (message + saisie manuelle) et arrêt du flux.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  creerDecodeur,
  creerLecteurQr,
  ErreurScanQr,
  MESSAGE_DECODEUR_INDISPONIBLE,
  MESSAGE_LECTURE_EN_ECHEC,
  SEUIL_ERREURS_DETECTION,
  type DependancesDecodeur,
  type FonctionJsQr,
} from '../src/lib/scanQr.ts'

const RACINE = join(import.meta.dirname, '..')
const source = (f: string) => readFileSync(join(RACINE, f), 'utf8')

const IMAGE = { donnees: new Uint8ClampedArray(4), largeur: 1, hauteur: 1 }

function dependances(o: { Natif?: DependancesDecodeur<string>['Natif']; jsQR?: FonctionJsQr | 'echec' } = {}) {
  let chargements = 0
  const d: DependancesDecodeur<string> = {
    Natif: o.Natif,
    chargerJsQr: async () => {
      chargements++
      if (o.jsQR === 'echec') throw new Error('Failed to fetch dynamically imported module')
      return o.jsQR ?? (() => ({ data: 'lu-par-jsqr' }))
    },
    source: () => 'video',
    image: () => IMAGE,
  }
  return { d, chargements: () => chargements }
}

class NatifQuiJette {
  constructor() {
    throw new TypeError('qr_code non pris en charge')
  }
  async detect() {
    return []
  }
}

class NatifEnEchec {
  static appels = 0
  async detect() {
    NatifEnEchec.appels++
    throw new Error('detect a échoué')
  }
}

class NatifQuiLit {
  async detect(s: string) {
    return [{ rawValue: `natif:${s}` }]
  }
}

describe('creerDecodeur : repli à l’initialisation', () => {
  test('détecteur natif dont le constructeur jette → jsQR est utilisé', async () => {
    const { d, chargements } = dependances({ Natif: NatifQuiJette as never })
    const dec = await creerDecodeur(d)
    assert.equal(dec.type, 'jsqr')
    assert.equal(chargements(), 1)
    assert.equal(await dec.lire(), 'lu-par-jsqr')
  })

  test('détecteur natif sain → natif, jsQR jamais chargé', async () => {
    const { d, chargements } = dependances({ Natif: NatifQuiLit as never })
    const dec = await creerDecodeur(d)
    assert.equal(dec.type, 'natif')
    assert.equal(await dec.lire(), 'natif:video')
    assert.equal(chargements(), 0)
  })

  test('natif absent + import jsQR qui échoue → ErreurScanQr explicite (pas un rejet silencieux)', async () => {
    const { d } = dependances({ jsQR: 'echec' })
    await assert.rejects(creerDecodeur(d), (e: unknown) => e instanceof ErreurScanQr && e.message === MESSAGE_DECODEUR_INDISPONIBLE)
    await assert.rejects(creerLecteurQr(d), ErreurScanQr)
  })

  test('natif qui jette + jsQR qui échoue → ErreurScanQr ; module sans fonction → ErreurScanQr', async () => {
    await assert.rejects(creerDecodeur(dependances({ Natif: NatifQuiJette as never, jsQR: 'echec' }).d), ErreurScanQr)
    const sansFonction = dependances()
    sansFonction.d.chargerJsQr = async () => ({}) as unknown as FonctionJsQr
    await assert.rejects(creerDecodeur(sansFonction.d), ErreurScanQr)
  })

  test('jsQR sans image prête → null (on réessaie), pas d’erreur', async () => {
    const { d } = dependances()
    d.image = () => null
    assert.equal(await (await creerDecodeur(d)).lire(), null)
  })
})

describe('creerLecteurQr : erreurs de détection consécutives', () => {
  test('erreurs répétées du natif au-delà du seuil → bascule sur jsQR, qui lit', async () => {
    NatifEnEchec.appels = 0
    const { d, chargements } = dependances({ Natif: NatifEnEchec as never })
    const l = await creerLecteurQr(d)
    assert.equal(l.type, 'natif')
    for (let i = 0; i < SEUIL_ERREURS_DETECTION; i++) assert.equal(await l.lire(), null)
    assert.equal(NatifEnEchec.appels, SEUIL_ERREURS_DETECTION)
    assert.equal(l.type, 'jsqr')
    assert.equal(chargements(), 1)
    assert.equal(await l.lire(), 'lu-par-jsqr')
    assert.equal(NatifEnEchec.appels, SEUIL_ERREURS_DETECTION, 'le natif n’est plus sollicité')
  })

  test('sous le seuil : pas de bascule ; un succès remet le compteur à zéro', async () => {
    let echoue = true
    let appels = 0
    class NatifIntermittent {
      async detect() {
        appels++
        if (echoue) throw new Error('instable')
        return []
      }
    }
    const { d, chargements } = dependances({ Natif: NatifIntermittent as never })
    const l = await creerLecteurQr(d)
    for (let i = 0; i < SEUIL_ERREURS_DETECTION - 1; i++) await l.lire()
    echoue = false
    assert.equal(await l.lire(), null) // succès (rien vu) : compteur remis à zéro
    echoue = true
    for (let i = 0; i < SEUIL_ERREURS_DETECTION - 1; i++) await l.lire()
    assert.equal(l.type, 'natif', 'jamais SEUIL erreurs consécutives')
    assert.equal(chargements(), 0)
    assert.equal(appels, 2 * SEUIL_ERREURS_DETECTION - 1)
  })

  test('erreurs persistantes après la bascule sur jsQR → ErreurScanQr (abandon)', async () => {
    const { d } = dependances({
      Natif: NatifEnEchec as never,
      jsQR: () => {
        throw new Error('jsQR a planté')
      },
    })
    const l = await creerLecteurQr(d)
    for (let i = 0; i < SEUIL_ERREURS_DETECTION; i++) assert.equal(await l.lire(), null)
    assert.equal(l.type, 'jsqr')
    for (let i = 0; i < SEUIL_ERREURS_DETECTION - 1; i++) assert.equal(await l.lire(), null)
    await assert.rejects(l.lire(), (e: unknown) => e instanceof ErreurScanQr && e.message === MESSAGE_LECTURE_EN_ECHEC)
  })

  test('déjà sur jsQR : erreurs au-delà du seuil → abandon direct', async () => {
    const { d, chargements } = dependances({
      jsQR: () => {
        throw new Error('jsQR a planté')
      },
    })
    const l = await creerLecteurQr(d)
    for (let i = 0; i < SEUIL_ERREURS_DETECTION - 1; i++) await l.lire()
    await assert.rejects(l.lire(), ErreurScanQr)
    assert.equal(chargements(), 1)
  })

  test('natif en échec continu et jsQR introuvable → abandon au seuil', async () => {
    const { d } = dependances({ Natif: NatifEnEchec as never, jsQR: 'echec' })
    const l = await creerLecteurQr(d)
    for (let i = 0; i < SEUIL_ERREURS_DETECTION - 1; i++) await l.lire()
    await assert.rejects(l.lire(), ErreurScanQr)
  })

  test('seuil raisonnable, messages en français avec recherche manuelle', () => {
    assert.ok(SEUIL_ERREURS_DETECTION >= 3 && SEUIL_ERREURS_DETECTION <= 50)
    for (const m of [MESSAGE_DECODEUR_INDISPONIBLE, MESSAGE_LECTURE_EN_ECHEC]) assert.match(m, /Utilisez la recherche manuelle\.$/)
  })
})

describe('ScannerQr.tsx utilise le mécanisme', () => {
  const s = source('src/components/ScannerQr.tsx')

  test('passe par creerLecteurQr, jsQR toujours chargé à la demande', () => {
    assert.match(s, /from '\.\.\/lib\/scanQr'/)
    assert.match(s, /await creerLecteurQr</)
    assert.match(s, /chargerJsQr: async \(\) => \(await import\('jsqr'\)\)\.default/)
    assert.doesNotMatch(s, /new Natif\(/, 'plus de construction hors try/catch dans le composant')
  })

  test('échec d’initialisation ou de lecture → abandonner() : flux coupé, erreur affichée', () => {
    const demarrer = s.slice(s.indexOf('async function demarrer('), s.indexOf('function abandonner('))
    assert.match(demarrer, /\} catch \(e\) \{\s*return abandonner\(e\)/)
    assert.equal(demarrer.match(/abandonner\(e\)/g)?.length, 2, 'initialisation ET boucle')
    const ab = s.slice(s.indexOf('function abandonner('), s.indexOf('void demarrer()'))
    assert.match(ab, /fini = true/)
    assert.match(ab, /clearTimeout\(minuterie\)/)
    assert.match(ab, /flux\?\.getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/)
    assert.match(ab, /setErreur\(/)
    // L'erreur affichée garde le bouton « Saisir le prénom » (bloc existant).
    assert.match(s, /\{erreur \? \([\s\S]*onSaisieManuelle[\s\S]*Saisir le prénom/)
  })
})

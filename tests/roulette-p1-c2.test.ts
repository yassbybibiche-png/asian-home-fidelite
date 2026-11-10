// P1-C2 — Roulette : rotation de 3 à 4 s, mouvement réduit respecté, vibration + confettis au gain, écran de gain
// (lot en gros, code, « valable aujourd'hui », garder ma carte), écran « perdu » positif, messages déjà joué / non validé.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  COURBE_ROTATION,
  DELAI_RESULTAT_REDUIT_MS,
  delaiResultat,
  detecterPlateforme,
  DUREE_ROTATION_MS,
  dureeConfettis,
  dureeRotation,
  estInstallee,
  etapesEcranAccueil,
  genererConfettis,
  MOTIF_VIBRATION_GAIN,
  MOTIF_VIBRATION_PERDU,
  NOMBRE_CONFETTIS,
  PAUSE_RESULTAT_MS,
  prefereMouvementReduit,
  REQUETE_MOUVEMENT_REDUIT,
  TEXTE_DEJA_JOUE,
  TEXTE_PERDU_PROCHAINE,
  TEXTE_PERDU_TAMPON,
  texteValidite,
  toursRotation,
  transitionRoue,
  vibrer,
} from '../src/lib/animationRoue.ts'
import { jourEnClair, rotationCible, secteurs, statutJeu } from '../src/lib/roulette.ts'
import type { Client, Tirage } from '../src/types.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')
const jouer = lire('src/pages/Jouer.tsx')
const roue = lire('src/components/Roue.tsx')
const css = lire('src/index.css')

/** Corps d'une fonction du fichier source (de sa déclaration à la suivante). */
function corpsDe(source: string, nom: string): string {
  const debut = source.search(new RegExp(`function ${nom}\\b`))
  assert.ok(debut >= 0, nom)
  const suite = source.slice(debut + 1).search(/\n(export )?function /)
  return suite < 0 ? source.slice(debut) : source.slice(debut, debut + 1 + suite)
}

/** Fausse fenêtre : `prefers-reduced-motion` et `display-mode` au choix. */
const fenetre = (reduit: boolean, standalone = false) => ({
  matchMedia: (q: string) => ({ matches: q === REQUETE_MOUVEMENT_REDUIT ? reduit : q === '(display-mode: standalone)' ? standalone : false }),
})

describe('P1-C2 : durée de l’animation', () => {
  test('rotation entre 3 et 4 s (et plus les 4,5 s d’avant)', () => {
    assert.ok(DUREE_ROTATION_MS >= 3000 && DUREE_ROTATION_MS <= 4000, String(DUREE_ROTATION_MS))
    assert.equal(dureeRotation(false), DUREE_ROTATION_MS)
    assert.doesNotMatch(roue + jouer, /4500/)
  })

  test('l’écran de résultat suit l’arrêt de la roue (rotation + petite pause, < 4,5 s)', () => {
    assert.equal(delaiResultat(false), DUREE_ROTATION_MS + PAUSE_RESULTAT_MS)
    assert.ok(delaiResultat(false) <= 4500)
    // Lot hors roue (serveur plus récent que la page) : rien ne tourne, résultat immédiat.
    assert.equal(delaiResultat(false, false), 0)
    assert.equal(delaiResultat(true, false), 0)
  })

  test('transition CSS de transform seul, décélération ; couche composée (60 fps)', () => {
    assert.equal(transitionRoue(false), `transform ${DUREE_ROTATION_MS}ms ${COURBE_ROTATION}`)
    assert.match(roue, /className="absolute inset-0 will-change-transform" style=\{\{ transform: `rotate\(\$\{rotation\}deg\)`, transition: transitionRoue\(reduit\) \}\}/)
    // Aucune animation image par image en JS : le navigateur interpole sur le compositeur.
    assert.doesNotMatch(roue + jouer, /requestAnimationFrame|setInterval\(/)
  })

  test('les deux modes (démo locale et API) utilisent la même durée', () => {
    assert.equal(jouer.match(/delaiResultat\(reduit/g)?.length, 2)
    assert.match(jouer, /delaiResultat\(reduit, !!issue\.secteur\)/)
    assert.doesNotMatch(jouer, /DUREE_ROTATION_MS \+ 200/)
  })
})

describe('P1-C2 : prefers-reduced-motion', () => {
  test('détection via matchMedia, prudente sans navigateur', () => {
    assert.equal(prefereMouvementReduit(fenetre(true)), true)
    assert.equal(prefereMouvementReduit(fenetre(false)), false)
    assert.equal(prefereMouvementReduit({}), false)
    assert.equal(prefereMouvementReduit(undefined), false)
    assert.equal(
      prefereMouvementReduit({
        matchMedia: () => {
          throw new Error('x')
        },
      }),
      false,
    )
  })

  test('mouvement réduit : pas de transition, aucun tour, résultat quasi immédiat', () => {
    assert.equal(transitionRoue(true), 'none')
    assert.equal(dureeRotation(true), 0)
    assert.equal(toursRotation(true), 0)
    assert.equal(toursRotation(false), 5)
    assert.equal(delaiResultat(true), DELAI_RESULTAT_REDUIT_MS)
    assert.ok(DELAI_RESULTAT_REDUIT_MS < 500)
  })

  test('sans tours, la roue s’arrête quand même sur le lot tiré', () => {
    const parts = secteurs([{ libelle: 'A' }, { libelle: 'B' }, { libelle: 'C' }, { libelle: 'D' }])
    for (const [i, s] of parts.entries()) {
      for (const depart of [0, 37, 725]) {
        const r = rotationCible(depart, s, 0.5, 0)
        assert.ok(r >= depart && r < depart + 360, `pas de tour complet (${r})`)
        // Pointeur en haut : l'angle de la roue sous le pointeur est (360 − r) mod 360.
        const sous = (((360 - r) % 360) + 360) % 360
        assert.ok(sous >= s.debut && sous < s.fin, `secteur ${i} sous le pointeur`)
      }
    }
  })

  test('la roue et la page suivent le réglage du téléphone en direct', () => {
    assert.match(roue, /export function useMouvementReduit\(\)/)
    assert.match(roue, /requete\.addEventListener\?\.\('change', suivre\)/)
    assert.match(jouer, /rotationCible\(r, secteur, Math\.random\(\), toursRotation\(reduit\)\)/)
    assert.match(jouer, /rotationCible\(r, issue\.secteur!, Math\.random\(\), toursRotation\(reduit\)\)/)
  })

  test('CSS : pas de confettis en mouvement réduit', () => {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.confettis \{\s*display: none;/)
  })
})

describe('P1-C2 : vibration et confettis', () => {
  test('vibration si l’API existe, jamais d’erreur sinon (iPhone)', () => {
    const appels: number[][] = []
    assert.equal(vibrer(MOTIF_VIBRATION_GAIN, { vibrate: (m) => (appels.push(m), true) }), true)
    assert.deepEqual(appels, [MOTIF_VIBRATION_GAIN])
    assert.equal(vibrer(MOTIF_VIBRATION_GAIN, {}), false)
    assert.equal(vibrer(MOTIF_VIBRATION_GAIN, undefined), false)
    assert.equal(
      vibrer(MOTIF_VIBRATION_GAIN, {
        vibrate: () => {
          throw new Error('bloqué')
        },
      }),
      false,
    )
    assert.ok(MOTIF_VIBRATION_GAIN.reduce((a, b) => a + b) < 500, 'vibration courte')
    assert.ok(MOTIF_VIBRATION_PERDU.length === 1)
  })

  test('vibration au moment où le résultat s’affiche', () => {
    assert.match(corpsDe(jouer, 'Resultat'), /useEffect\(\(\) => void vibrer\(perdu \? MOTIF_VIBRATION_PERDU : MOTIF_VIBRATION_GAIN\), \[perdu\]\)/)
  })

  test('confettis déterministes, légers et bornés dans le temps ; aucun en mouvement réduit', () => {
    let n = 0
    const alea = () => ((n = (n * 9301 + 49297) % 233280), n / 233280)
    const c = genererConfettis(false, NOMBRE_CONFETTIS, alea)
    assert.equal(c.length, NOMBRE_CONFETTIS)
    assert.ok(NOMBRE_CONFETTIS <= 60, 'léger')
    for (const x of c) {
      assert.ok(x.gauche >= 0 && x.gauche <= 100)
      assert.ok(x.delai >= 0 && x.duree >= 1000)
    }
    assert.ok(dureeConfettis(c) <= 3000)
    assert.deepEqual(genererConfettis(true), [])
    assert.equal(dureeConfettis([]), 0)
  })

  test('confettis au gain seulement, retirés du DOM après la chute, décoratifs', () => {
    const resultat = corpsDe(jouer, 'Resultat')
    const perdu = resultat.slice(resultat.indexOf('if (perdu)'), resultat.indexOf('data-resultat="gain"'))
    assert.doesNotMatch(perdu, /<Confettis/)
    assert.equal(resultat.match(/<Confettis \/>/g)?.length, 1)
    assert.match(resultat, /data-resultat="gain">\n\s*<Confettis \/>/)
    const confettis = corpsDe(jouer, 'Confettis')
    assert.match(confettis, /<div className="confettis" aria-hidden>/)
    assert.match(confettis, /dureeConfettis\(confettis\) \+ 100/)
    // Aucune dépendance ajoutée pour l'effet.
    const pkg = JSON.parse(lire('package.json'))
    assert.ok(!Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((d) => /confetti/i.test(d)))
    assert.match(css, /@keyframes confetti-chute/)
  })
})

describe('P1-C2 : écran de gain', () => {
  const maintenant = new Date(2026, 10, 10, 12)

  test('validité affichée : « Valable aujourd’hui » + date du jour (code vérifiable en caisse le jour même, P0-U3)', () => {
    assert.equal(texteValidite(maintenant), `Valable aujourd’hui, ${jourEnClair(maintenant)}`)
    assert.match(texteValidite(maintenant), /^Valable aujourd’hui, mar\. 10 nov\. 2026$/)
  })

  test('code en gros + validité + copie ; validité aussi sans code (démo locale)', () => {
    const code = corpsDe(jouer, 'CodeGagnant')
    assert.match(code, /font-mono text-4xl font-extrabold/)
    assert.match(code, /data-validite>\n\s*🗓️ \{texteValiditeLangue\(new Date\(\), langue, texteValidite\)\}/)
    assert.match(code, /<BoutonCopier texte=\{code\}/)
    const resultat = corpsDe(jouer, 'Resultat')
    assert.match(resultat, /font-titre text-4xl/)
    assert.equal(resultat.match(/texteValiditeLangue\(new Date\(\), langue, texteValidite\)/g)?.length, 1)
    assert.match(resultat, /\{code \? \(\n\s*<CodeGagnant code=\{code\} \/>/)
  })

  test('le code n’est montré que pour un gain (jamais pour un tirage perdant)', () => {
    assert.match(jouer, /code=\{gain\.perdant \? undefined : gain\.code\}/)
    const resultat = corpsDe(jouer, 'Resultat')
    const perdu = resultat.slice(resultat.indexOf('if (perdu)'), resultat.indexOf('data-resultat="gain"'))
    assert.doesNotMatch(perdu, /CodeGagnant|texteValidite/)
  })

  test('« garder ma carte » sur l’écran de gain et l’écran perdu ; « Voir ma carte » conservé', () => {
    const resultat = corpsDe(jouer, 'Resultat')
    assert.equal(resultat.match(/<GarderCarte lienCarte=\{lienCarte\} \/>/g)?.length, 2)
    assert.match(jouer, /lienCarte=\{`#\/carte\/\$\{joueur\.id\}`\}/)
    assert.match(jouer, /lienCarte=\{`#\/carte\/\$\{joueur\.clientId\}`\}/)
    assert.equal(jouer.match(/Voir ma carte de fidélité/g)?.length, 3) // attente + 2 modes après le tirage
    const garder = corpsDe(jouer, 'GarderCarte')
    assert.match(garder, /📲 Garder ma carte sur mon téléphone/)
    assert.match(garder, /aria-expanded=\{ouvert\}/)
    assert.match(garder, /if \(estInstallee\(\)\) return null/)
    // Pas de faux bouton Wallet : aucun pass n'existe encore.
    assert.doesNotMatch(garder, /Ajouter à Apple Wallet|Ajouter à Google Wallet/)
  })
})

describe('P1-C2 : garder ma carte (écran d’accueil)', () => {
  test('plateforme détectée', () => {
    assert.equal(detecterPlateforme('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'), 'ios')
    assert.equal(detecterPlateforme('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 5), 'ios') // iPadOS
    assert.equal(detecterPlateforme('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 0), 'autre')
    assert.equal(detecterPlateforme('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130 Mobile'), 'android')
    assert.equal(detecterPlateforme('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'autre')
  })

  test('instructions propres à chaque plateforme', () => {
    const ios = etapesEcranAccueil('ios').join(' ')
    assert.match(ios, /Safari/)
    assert.match(ios, /Partager/)
    assert.match(ios, /Sur l’écran d’accueil/)
    const android = etapesEcranAccueil('android').join(' ')
    assert.match(android, /Chrome/)
    assert.match(android, /⋮/)
    assert.match(android, /Ajouter à l’écran d’accueil/)
    assert.ok(etapesEcranAccueil('autre').length >= 2)
  })

  test('rien à proposer si la carte est déjà ouverte depuis l’écran d’accueil', () => {
    assert.equal(estInstallee(fenetre(false, true)), true)
    assert.equal(estInstallee({ navigator: { standalone: true } }), true)
    assert.equal(estInstallee(fenetre(false, false)), false)
    assert.equal(estInstallee(undefined), false)
  })
})

describe('P1-C2 : parcours perdu', () => {
  test('écran positif : tampon de la visite compté + prochaine chance', () => {
    assert.match(TEXTE_PERDU_TAMPON, /tampon/)
    assert.match(TEXTE_PERDU_PROCHAINE, /prochaine visite validée/)
    const resultat = corpsDe(jouer, 'Resultat')
    const perdu = resultat.slice(resultat.indexOf('if (perdu)'), resultat.indexOf('data-resultat="gain"'))
    assert.match(perdu, /data-resultat="perdu"/)
    assert.match(perdu, /mais votre visite compte !/)
    assert.match(perdu, /✓ \{t\(TEXTE_PERDU_TAMPON\)\}/)
    assert.match(perdu, /\{t\(TEXTE_PERDU_PROCHAINE\)\}/)
    assert.match(perdu, /role="status" aria-live="polite"/)
  })
})

describe('P1-C2 : déjà joué / visite non validée (1 tirage par jour inchangé)', () => {
  const jour = new Date(2026, 10, 10, 15)
  const client: Client = {
    id: 'c1',
    commerceId: 'm1',
    prenom: '',
    contact: '0600000000',
    tampons: 1,
    visites: [new Date(2026, 10, 10, 12).toISOString()],
    creeLe: new Date(2026, 10, 1).toISOString(),
  } as Client
  const tirage: Tirage = { id: 't1', commerceId: 'm1', clientId: 'c1', lot: 'Thé offert', date: new Date(2026, 10, 10, 12, 5).toISOString() }

  test('statuts : prêt, déjà joué, sans visite', () => {
    assert.equal(statutJeu(client, [], 'm1', jour), 'pret')
    assert.equal(statutJeu(client, [tirage], 'm1', jour), 'dejaJoue')
    assert.equal(statutJeu({ ...client, visites: [] }, [], 'm1', jour), 'sansVisite')
    // Lendemain : nouvelle chance seulement après une nouvelle visite validée.
    assert.equal(statutJeu(client, [tirage], 'm1', new Date(2026, 10, 11, 12)), 'sansVisite')
  })

  test('message déjà joué clair : 1 tirage par jour + prochaine chance', () => {
    assert.match(TEXTE_DEJA_JOUE, /1 tirage par personne et par jour/)
    assert.match(TEXTE_DEJA_JOUE, /prochaine visite validée/)
    const msg = corpsDe(jouer, 'MessageDejaJoue')
    assert.match(msg, /Vous avez déjà joué aujourd’hui\{prenom\} !', \{ prenom: virgulePrenom\(prenom\) \}/)
    assert.match(msg, /\{t\(TEXTE_DEJA_JOUE\)\}/)
    assert.match(msg, /code && <CodeGagnant code=\{code\} \/>/)
  })

  test('visite non validée : écran d’attente P0-U4 conservé dans les deux modes', () => {
    assert.match(jouer, /statut === 'sansVisite' \? \(\n\s*<MessageSansVisite/)
    assert.match(jouer, /jeu\.statut === 'sansVisite' \? \(\n\s*<>\n\s*<MessageSansVisite/)
  })

  test('le serveur reste seul juge du tirage en mode API', () => {
    assert.match(jouer, /const issue = await lancerTirage\(api, commerce, joueur\.contact, joueur\.prenom\)/)
    assert.match(jouer, /if \(!issue\.ok\) \{/)
  })
})

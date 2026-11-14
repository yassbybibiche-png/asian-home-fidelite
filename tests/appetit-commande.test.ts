// Menu Appétit, lot 2 — page commande à table : « Encore la même » (`reconstruirePanier`), demandes de service au
// panier (`ajouterService`), suggestion « À découvrir aussi » (`suggestionApres`) — logique pure de src/lib/panier.ts,
// testée directement ; fiche plat en feuille basse, vol vers le panier, rail Signatures, section « À votre service »
// vérifiés sur le source (node --test n'importe pas le .tsx), comme les lots précédents.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ajouter, ajouterService, cleLigne, LIGNES_MAX, lignesAEnvoyer, majInstructions, reconstruirePanier, suggestionApres, totalPanier, type LignePanier } from '../src/lib/panier.ts'
import { calculerCommande } from '../src/lib/commande.ts'
import { SERVICES_COMMANDE } from '../src/lib/servicesCommande.ts'
import type { LigneCommande, Menu, Produit } from '../src/types.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (f: string) => readFileSync(join(RACINE, f), 'utf8')

const PAD: Produit = { id: 'p-pad', nom: 'Pad Thaï', prix: 1290, allergenes: [], photo: '/visuels/pad.jpg', options: [{ nom: 'Supplément crevettes', prix: 250 }, { nom: 'Œuf', prix: 100 }] }
const NEMS: Produit = { id: 'p-nems', nom: 'Nems', prix: 650, allergenes: [] }
const RIZ: Produit = { id: 'p-riz', nom: 'Riz Thaï', prix: null, allergenes: [], photo: '/visuels/riz.jpg' }
const BOBUN: Produit = { id: 'p-bobun', nom: 'Bo Bun', prix: 1190, allergenes: [], indisponible: true, photo: '/visuels/bobun.jpg' }
const LOCLAC: Produit = { id: 'p-loclac', nom: 'Loc Lac', prix: 1490, allergenes: [], photo: '/visuels/loclac.jpg' }
const MENU: Pick<Menu, 'categories'> = { categories: [{ id: 'cat', nom: 'Plats', produits: [PAD, NEMS, RIZ, BOBUN, LOCLAC] }] }
const EAU = SERVICES_COMMANDE.find((s) => s.id === 'service-eau')!

/** Ligne d'une commande passée, telle que le serveur l'a figée (nom et prix d'ALORS). */
function ligne(l: Partial<LigneCommande> & Pick<LigneCommande, 'produitId' | 'nom'>): LigneCommande {
  return { prixUnitaire: 0, quantite: 1, options: [], ...l }
}

describe('Menu Appétit lot 2 : reconstruirePanier (« Encore la même »)', () => {
  test('plat repris au prix du menu COURANT, jamais à celui de l’ancienne commande', () => {
    const { panier, ignores } = reconstruirePanier([ligne({ produitId: 'p-nems', nom: 'Nems (ancien nom)', prixUnitaire: 500, quantite: 3 })], MENU, false)
    assert.deepEqual(ignores, [])
    assert.deepEqual(panier, ajouter([], NEMS, [], 3))
    assert.equal(panier[0].prix, 650)
    assert.equal(panier[0].nom, 'Nems', 'nom du menu courant')
    assert.equal(totalPanier(panier), 1950)
  })

  test('plat devenu indisponible, sans prix vérifié ou retiré du menu → ignores (nom de l’ancienne commande), rien de substitué', () => {
    const { panier, ignores } = reconstruirePanier(
      [
        ligne({ produitId: 'p-bobun', nom: 'Bo Bun', prixUnitaire: 1190 }),
        ligne({ produitId: 'p-riz', nom: 'Riz Thaï', prixUnitaire: 300 }),
        ligne({ produitId: 'p-disparu', nom: 'Plat retiré', prixUnitaire: 900 }),
        ligne({ produitId: 'p-nems', nom: 'Nems', prixUnitaire: 650 }),
      ],
      MENU,
      false,
    )
    assert.deepEqual(ignores, ['Bo Bun', 'Riz Thaï', 'Plat retiré'])
    assert.deepEqual(panier.map((l) => l.produitId), ['p-nems'])
  })

  test('services : repris (prix 0, nom canonique, sans option) si le module est actif, ignorés sinon', () => {
    const lignes = [ligne({ produitId: 'service-eau', nom: 'De l’eau', quantite: 2, service: true }), ligne({ produitId: 'p-nems', nom: 'Nems', prixUnitaire: 650 })]
    const actif = reconstruirePanier(lignes, MENU, true)
    assert.deepEqual(actif.ignores, [])
    assert.deepEqual(actif.panier[0], { cle: 'service-eau', produitId: 'service-eau', nom: 'De l’eau', prix: 0, quantite: 2, options: [] })
    const coupe = reconstruirePanier(lignes, MENU, false)
    assert.deepEqual(coupe.ignores, ['De l’eau'])
    assert.deepEqual(coupe.panier.map((l) => l.produitId), ['p-nems'])
    // Id « service-… » inventé : traité comme un plat inconnu.
    assert.deepEqual(reconstruirePanier([ligne({ produitId: 'service-champagne', nom: 'Champagne', service: true })], MENU, true).ignores, ['Champagne'])
  })

  test('options et instructions reprises (prix des options relus du menu) ; option disparue → ligne ignorée', () => {
    const { panier, ignores } = reconstruirePanier(
      [ligne({ produitId: 'p-pad', nom: 'Pad Thaï', prixUnitaire: 1100, quantite: 2, options: [{ nom: 'Œuf', prix: 50 }, { nom: 'Supplément crevettes', prix: 200 }], instructions: 'sans coriandre' })],
      MENU,
      false,
    )
    assert.deepEqual(ignores, [])
    const attendu = majInstructions(ajouter([], PAD, ['Supplément crevettes', 'Œuf'], 2), cleLigne('p-pad', PAD.options!), 'sans coriandre')
    assert.deepEqual(panier, attendu)
    assert.equal(totalPanier(panier), (1290 + 250 + 100) * 2)
    const disparue = reconstruirePanier([ligne({ produitId: 'p-pad', nom: 'Pad Thaï', options: [{ nom: 'Fromage', prix: 100 }] })], MENU, false)
    assert.deepEqual(disparue, { panier: [], ignores: ['Pad Thaï'] })
  })

  test('quantité bornée 1–20 ; doublons fusionnés (plafond 20) ; au-delà de 30 lignes → ignores', () => {
    assert.equal(reconstruirePanier([ligne({ produitId: 'p-nems', nom: 'Nems', quantite: 99 })], MENU, false).panier[0].quantite, 20)
    assert.equal(reconstruirePanier([ligne({ produitId: 'p-nems', nom: 'Nems', quantite: 0 })], MENU, false).panier[0].quantite, 1)
    const double = reconstruirePanier([ligne({ produitId: 'p-nems', nom: 'Nems', quantite: 15 }), ligne({ produitId: 'p-nems', nom: 'Nems', quantite: 15 })], MENU, false)
    assert.deepEqual(double.panier.map((l) => l.quantite), [20])
    const eau = reconstruirePanier([ligne({ produitId: 'service-eau', nom: 'De l’eau', quantite: 30, service: true })], MENU, true)
    assert.equal(eau.panier[0].quantite, 20)
    const beaucoup = Array.from({ length: 31 }, (_, i) => ({ ...NEMS, id: `n-${i}`, nom: `Plat ${i}` }))
    const menuLarge = { categories: [{ id: 'c', nom: 'C', produits: beaucoup }] }
    const r = reconstruirePanier(beaucoup.map((p) => ligne({ produitId: p.id, nom: p.nom })), menuLarge, false)
    assert.equal(r.panier.length, LIGNES_MAX)
    assert.deepEqual(r.ignores, ['Plat 30'])
  })

  test('panier repris = accepté tel quel par le calcul du serveur, même total', () => {
    const { panier } = reconstruirePanier(
      [ligne({ produitId: 'p-pad', nom: 'Pad Thaï', options: [{ nom: 'Œuf', prix: 100 }] }), ligne({ produitId: 'service-serveur', nom: 'Appeler le serveur', service: true }), ligne({ produitId: 'p-loclac', nom: 'Loc Lac', quantite: 2 })],
      MENU,
      true,
    )
    const serveur = calculerCommande(MENU, lignesAEnvoyer(panier), { services: true })
    assert.ok(serveur.ok)
    assert.equal(serveur.total, totalPanier(panier))
    assert.equal(serveur.total, 1290 + 100 + 1490 * 2)
  })
})

describe('Menu Appétit lot 2 : ajouterService et suggestionApres', () => {
  test('ajouterService : ligne à 0 € (clé = id), fusion bornée à 20, 30 lignes au plus ; envoyée sans prix ni option', () => {
    let p = ajouterService([], EAU)
    assert.deepEqual(p, [{ cle: 'service-eau', produitId: 'service-eau', nom: 'De l’eau', prix: 0, quantite: 1, options: [] }])
    p = ajouterService(p, EAU, 25)
    assert.equal(p.length, 1)
    assert.equal(p[0].quantite, 20)
    assert.equal(totalPanier(ajouter(p, NEMS)), 650, 'le total n’en bouge pas')
    assert.deepEqual(lignesAEnvoyer(p), [{ produitId: 'service-eau', quantite: 20 }])
    let plein: LignePanier[] = []
    for (let i = 0; i < LIGNES_MAX; i++) plein = ajouter(plein, { ...NEMS, id: `n-${i}` })
    assert.equal(ajouterService(plein, EAU).length, LIGNES_MAX)
  })

  test('suggestionApres : premier plat photographié commandable APRÈS le courant (en bouclant), jamais lui-même', () => {
    const plats = MENU.categories[0].produits
    // Après Pad Thaï : Nems (sans photo), Riz (sans prix), Bo Bun (indisponible) sont sautés.
    assert.equal(suggestionApres(plats, PAD)?.id, 'p-loclac')
    // Après Loc Lac (dernier) : on boucle sur Pad Thaï.
    assert.equal(suggestionApres(plats, LOCLAC)?.id, 'p-pad')
    assert.equal(suggestionApres(plats, NEMS)?.id, 'p-loclac')
    // Seul plat photographié commandable : aucune suggestion pour lui.
    assert.equal(suggestionApres([PAD, NEMS, RIZ], PAD), null)
    assert.equal(suggestionApres([], PAD), null)
    // Stable : même entrée, même réponse.
    assert.equal(suggestionApres(plats, PAD), suggestionApres(plats, PAD))
  })
})

describe('Menu Appétit lot 2 : Commande.tsx et volPanier.ts (source)', () => {
  const page = lire('src/pages/Commande.tsx')
  const vol = lire('src/lib/volPanier.ts')

  test('barre panier marquée pour le vol ; rail Signatures ; section « À votre service » ; « Encore la même »', () => {
    assert.match(page, /data-barre-panier>/)
    assert.match(page, /data-bouton-panier onClick/)
    assert.match(page, /\{signatures\.length > 0 && \(\s*<section [^>]*data-rail-signatures>/)
    assert.match(page, /const signatures = useMemo\(\(\) => plats\.filter\(\(p\) => p\.photo && estCommandable\(p\)\), \[plats\]\)/)
    assert.match(page, /\{donnees\.commerce\.servicesCommande && \(\s*<section [^>]*data-services>/)
    assert.match(page, /\{t\('À votre service'\)\}/)
    assert.match(page, /\{t\('La demande part en cuisine, comme une commande — c’est gratuit\.'\)\}/)
    assert.match(page, /\{SERVICES_COMMANDE\.map\(/)
    assert.match(page, /\{onRecommander && commande\.statut !== 'refusee' && commande\.lignes\.length > 0 && \(/)
    assert.match(page, /\{t\('Encore la même'\)\}/)
    assert.match(page, /reconstruirePanier\(suivi\.commande\.lignes, masquerPrixNonConfirmes\(donnees\.menu\), !!donnees\.commerce\.servicesCommande\)/)
  })

  test('fiche plat en feuille basse : dialogue modal nommé, Fermer + Échap + voile, montée coupée en mouvement réduit', () => {
    assert.match(page, /role="dialog"\s+aria-modal="true"\s+aria-label=\{p\.nom\}/)
    assert.match(page, /\{t\('Fermer'\)\}/)
    assert.match(page, /e\.key === 'Escape' && surFermeture\.current\(\)/)
    assert.match(page, /const \[mouvement\] = useState\(\(\) => !prefereMouvementReduit\(\)\)/)
    assert.match(page, /\$\{mouvement \? ' feuille-montee' : ''\}/)
    assert.match(page, /\{p\.photo && <img src=\{p\.photo\}/, 'grande photo seulement si le plat en a une')
    assert.match(page, /\{t\('À découvrir aussi'\)\}/)
    assert.match(page, /suggestion=\{suggestionApres\(plats, fiche\)\}/)
    assert.match(page, /ajouter\(avant, p, choix, quantite\)/)
  })

  test('reprise appliquée une seule fois (garde par identité) ; articles non repris signalés en note (role status)', () => {
    assert.match(page, /if \(!reprise \|\| repriseAppliquee\.current === reprise\) return/)
    assert.match(page, /setPanier\(reprise\.panier\)/)
    assert.match(page, /role="status">\s*\{t\('Certains articles ne sont plus disponibles et n’ont pas été repris : \{noms\}'/)
  })

  test('chaque service canonique a son nom traduit dans la page (helper à littéraux)', () => {
    for (const s of SERVICES_COMMANDE) {
      assert.ok(page.includes(`if (id === '${s.id}') return t('${s.nom}')`), s.id)
      assert.ok(page.includes(`'${s.nom}': '`), `traduction EN : ${s.nom}`)
    }
  })

  test('vol vers le panier : gardes mouvement réduit + barre absente, WAAPI 450 ms, pulsation 500 ms', () => {
    assert.match(vol, /if \(prefereMouvementReduit\(\) \|\| !source\) return/)
    assert.match(vol, /export function pulserPanier\(\): void \{\s*if \(prefereMouvementReduit\(\)\) return/)
    assert.match(vol, /if \(!barre\) return/)
    assert.match(vol, /const DUREE_VOL_MS = 450/)
    assert.match(vol, /easing: 'cubic-bezier\(0\.2, 0\.7, 0\.3, 1\)'/)
    assert.match(vol, /const DUREE_PULSE_MS = 500/)
    assert.match(lire('src/index.css'), /\.panier-pulse \[data-bouton-panier\] \{\s*animation: panier-pulse/)
    // Déclencheurs : ajout rapide (vignette), fiche (photo), service (pastille) ; stepper = pulsation seule.
    assert.match(page, /animerAjoutPanier\(e\.currentTarget, \{ image: p\.photoVignette \?\? p\.photo \}\)/)
    assert.match(page, /animerAjoutPanier\(boutonAjout\.current, \{ image: p\.photoVignette \?\? p\.photo \}\)/)
    assert.match(page, /setPanier\(\(pa\) => ajouterService\(pa, s\)\), animerAjoutPanier\(e\.currentTarget\)/)
    assert.match(page, /changerQuantite\(pa, simple\.cle, simple\.quantite \+ 1\)\), pulserPanier\(\)/)
  })
})

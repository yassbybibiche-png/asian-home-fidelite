// Expérience 10/10, lot 2 — écrans : accueil immersif #/bienvenue, menu v2 (mode Découverte), commande à table
// #/commande/<id>/<jetonTable> (panier, envoi idempotent, suivi), réglages « Commande à table », case « Indisponible »
// de l'éditeur de menu, et la route publique qui résout le jeton d'une table.
// Logique pure testée directement (src/lib/panier.ts, revelation.ts, defilementRail.ts, tablesCommande.ts) ; les
// .tsx sont vérifiés sur le source (node --test n'importe pas le .tsx), comme les lots précédents ; la route sur un
// vrai serveur HTTP (SQLite temporaire).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import {
  ajouter,
  changerQuantite,
  cleLigne,
  clesStockage,
  empreintePanier,
  estCommandable,
  estTerminee,
  ETAPES_SUIVI,
  INSTRUCTIONS_MAX,
  jetonAleatoire,
  LIGNES_MAX,
  lignesAEnvoyer,
  lirePanier,
  majInstructions,
  nombreArticles,
  preparerEnvoi,
  prixLigne,
  QUANTITE_MAX,
  retirer,
  totalPanier,
  type LignePanier,
} from '../src/lib/panier.ts'
import { preparerRevelations } from '../src/lib/revelation.ts'
import { pasRail } from '../src/lib/defilementRail.ts'
import { lienTable, NOM_TABLE_MAX, problemeTables, TABLES_MAX } from '../src/lib/tablesCommande.ts'
import { calculerCommande, LIMITES_COMMANDE, STATUTS_COMMANDE } from '../src/lib/commande.ts'
import { creerServeur, TABLES_COMMANDE_MAX } from '../server/app.ts'
import { estPageTraduite } from '../src/lib/langue.ts'
import { lireRoute, PAGES_PUBLIQUES } from '../src/router.ts'
import type { Commerce, Menu, Produit } from '../src/types.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')

const PAD: Produit = { id: 'p-pad', nom: 'Pad Thaï', prix: 1290, allergenes: [], options: [{ nom: 'Supplément crevettes', prix: 250 }, { nom: 'Œuf', prix: 100 }] }
const NEMS: Produit = { id: 'p-nems', nom: 'Nems', prix: 650, allergenes: [] }
const RIZ: Produit = { id: 'p-riz', nom: 'Riz Thaï', prix: null, allergenes: [] }
const BOBUN: Produit = { id: 'p-bobun', nom: 'Bo Bun', prix: 1190, allergenes: [], indisponible: true }
const MENU: Pick<Menu, 'categories'> = { categories: [{ id: 'cat', nom: 'Plats', produits: [PAD, NEMS, RIZ, BOBUN] }] }

describe('Lot 2 : panier (src/lib/panier.ts)', () => {
  test('bornes alignées sur le serveur (quantité 1–20, 30 lignes, 300 caractères)', () => {
    assert.equal(QUANTITE_MAX, LIMITES_COMMANDE.quantite)
    assert.equal(LIGNES_MAX, LIMITES_COMMANDE.lignes)
    assert.equal(INSTRUCTIONS_MAX, LIMITES_COMMANDE.instructions)
  })

  test('commandable = prix vérifié et pas indisponible ; sinon l’ajout ne change rien', () => {
    assert.ok(estCommandable(NEMS))
    assert.ok(!estCommandable(RIZ))
    assert.ok(!estCommandable(BOBUN))
    assert.deepEqual(ajouter([], RIZ), [])
    assert.deepEqual(ajouter([], BOBUN), [])
  })

  test('ajout : même produit + mêmes options = même ligne (ordre des cases ignoré) ; options différentes = autre ligne', () => {
    let p = ajouter([], PAD, ['Œuf', 'Supplément crevettes'])
    p = ajouter(p, PAD, ['Supplément crevettes', 'Œuf'])
    assert.equal(p.length, 1)
    assert.equal(p[0].quantite, 2)
    assert.equal(p[0].cle, cleLigne('p-pad', [{ nom: 'Œuf', prix: 100 }, { nom: 'Supplément crevettes', prix: 250 }]))
    p = ajouter(p, PAD)
    assert.equal(p.length, 2)
    // Option inconnue ou en double : ignorée (seules celles du produit, une fois).
    const q = ajouter([], PAD, ['Fromage', 'Œuf', 'Œuf'])
    assert.deepEqual(q[0].options, [{ nom: 'Œuf', prix: 100 }])
  })

  test('quantités bornées 1..20 (ajout, changement, valeurs aberrantes) ; suppression', () => {
    let p = ajouter([], NEMS, [], 25)
    assert.equal(p[0].quantite, 20)
    p = ajouter(p, NEMS)
    assert.equal(p[0].quantite, 20, 'plafond 20 en ajoutant à une ligne pleine')
    for (const [demande, attendu] of [[0, 1], [-3, 1], [21, 20], [7.8, 7], [Number.NaN, 1], [Infinity, 1]] as const) {
      assert.equal(changerQuantite(p, p[0].cle, demande)[0].quantite, attendu, String(demande))
    }
    p = ajouter(p, PAD, ['Œuf'])
    assert.equal(retirer(p, p[0].cle).length, 1)
    assert.equal(retirer(p, 'inconnue').length, 2)
  })

  test('30 lignes au plus : une 31e ligne n’est pas ajoutée, une ligne existante peut encore grossir', () => {
    let p: LignePanier[] = []
    for (let i = 0; i < 31; i++) p = ajouter(p, { ...NEMS, id: `n-${i}` })
    assert.equal(p.length, 30)
    p = ajouter(p, { ...NEMS, id: 'n-0' })
    assert.equal(p[0].quantite, 2)
  })

  test('totaux exacts en centimes, options comprises, et identiques au calcul du serveur', () => {
    let p = ajouter([], NEMS, [], 3)
    p = ajouter(p, PAD, ['Supplément crevettes', 'Œuf'], 2)
    p = ajouter(p, PAD)
    assert.equal(prixLigne(p[1]), (1290 + 250 + 100) * 2)
    assert.equal(totalPanier(p), 650 * 3 + (1290 + 350) * 2 + 1290)
    assert.equal(nombreArticles(p), 6)
    const serveur = calculerCommande(MENU, lignesAEnvoyer(p))
    assert.ok(serveur.ok)
    assert.equal(serveur.total, totalPanier(p))
    assert.equal(totalPanier([]), 0)
  })

  test('envoi : ids, quantités, noms d’options, instructions nettoyées — jamais un prix ni un nom de plat', () => {
    let p = ajouter([], PAD, ['Œuf'])
    p = majInstructions(p, p[0].cle, '  sans coriandre  ')
    p = ajouter(p, NEMS)
    p = majInstructions(p, p[1].cle, '   ')
    assert.deepEqual(lignesAEnvoyer(p), [{ produitId: 'p-pad', quantite: 1, options: ['Œuf'], instructions: 'sans coriandre' }, { produitId: 'p-nems', quantite: 1 }])
    assert.doesNotMatch(JSON.stringify(lignesAEnvoyer(p)), /prix|Pad Thaï|1290/)
    assert.equal(majInstructions(p, p[0].cle, 'x'.repeat(400))[0].instructions?.length, 300)
  })

  test('idempotence : même panier → même clé ET même secret ; panier changé → nouvelle paire, tirée avant l’envoi', () => {
    let n = 0
    const tirer = () => `jeton-${++n}-abcdefghijklmnop`
    const p = ajouter([], NEMS)
    const a = preparerEnvoi(null, empreintePanier(p, ''), tirer)
    assert.deepEqual([a.cleIdempotence, a.secret], ['jeton-1-abcdefghijklmnop', 'jeton-2-abcdefghijklmnop'])
    // Réponse perdue → nouvel essai, panier identique (instructions identiques à l'espace près) : même paire.
    assert.equal(preparerEnvoi(a, empreintePanier(p, '  '), tirer), a)
    // Quantité, instructions ou ligne changées : autre commande.
    for (const e of [empreintePanier(changerQuantite(p, p[0].cle, 2)), empreintePanier(p, 'vite svp'), empreintePanier(ajouter(p, PAD))]) {
      const b = preparerEnvoi(a, e, tirer)
      assert.notEqual(b.cleIdempotence, a.cleIdempotence)
      assert.notEqual(b.secret, a.secret)
    }
  })

  test('jeton aléatoire : 32 caractères URL-safe, accepté par les formats du serveur (clé 8–100, secret 16–100)', () => {
    const vus = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const j = jetonAleatoire()
      assert.match(j, /^[\w-]{32}$/)
      assert.match(j, /^[\w-]{16,100}$/)
      vus.add(j)
    }
    assert.equal(vus.size, 50)
    assert.equal(jetonAleatoire(3, (t) => t.fill(255)), '____')
  })

  test('panier relu du stockage : lignes mal formées ignorées, quantités rebornées, JSON cassé = vide', () => {
    const bon = ajouter([], NEMS, [], 2)
    assert.deepEqual(lirePanier(JSON.stringify(bon)), bon)
    assert.deepEqual(lirePanier('{cassé'), [])
    assert.deepEqual(lirePanier(null), [])
    assert.deepEqual(lirePanier('{"a":1}'), [])
    const relu = lirePanier(JSON.stringify([{ ...bon[0], quantite: 99 }, { cle: 1 }, null]))
    assert.equal(relu.length, 1)
    assert.equal(relu[0].quantite, 20)
  })

  test('suivi : étapes dans l’ordre du serveur, refusée à part ; terminé = servie ou refusée ; clés de stockage par commerce', () => {
    assert.deepEqual([...ETAPES_SUIVI], STATUTS_COMMANDE.filter((s) => s !== 'refusee'))
    assert.ok(estTerminee('servie') && estTerminee('refusee'))
    assert.ok(!estTerminee('recue') && !estTerminee('acceptee') && !estTerminee('en_preparation'))
    assert.equal(clesStockage.secret('c-a', 'cmd-1'), 'fideliz:commande:c-a:cmd-1')
    assert.notEqual(clesStockage.panier('c-a', 'j'), clesStockage.panier('c-b', 'j'))
    assert.notEqual(clesStockage.derniere('c-a', 'j1'), clesStockage.derniere('c-a', 'j2'))
  })
})

describe('Lot 2 : révélations au défilement (src/lib/revelation.ts)', () => {
  /** Élément minimal : classes + position verticale. */
  function element(top: number) {
    const classes = new Set<string>()
    return {
      top,
      classList: {
        add: (c: string) => void classes.add(c),
        contains: (c: string) => classes.has(c),
        replace: (a: string, b: string) => (classes.has(a) ? (classes.delete(a), classes.add(b), true) : false),
      },
      getBoundingClientRect: () => ({ top }),
      classes,
    }
  }
  function racine(elements: ReturnType<typeof element>[]) {
    return {
      querySelectorAll: (sel: string) =>
        sel === '.revelation-attente' ? elements.filter((e) => e.classes.has('revelation-attente')) : sel === '[data-revelation]' ? elements : [],
    } as unknown as ParentNode
  }
  class FauxObservateur {
    static dernier: FauxObservateur
    observes = new Set<unknown>()
    deconnecte = false
    rappel: (e: { isIntersecting: boolean; target: unknown }[]) => void
    constructor(rappel: (e: { isIntersecting: boolean; target: unknown }[]) => void) {
      this.rappel = rappel
      FauxObservateur.dernier = this
    }
    observe(e: unknown) {
      this.observes.add(e)
    }
    unobserve(e: unknown) {
      this.observes.delete(e)
    }
    disconnect() {
      this.deconnecte = true
    }
  }

  test('seuls les éléments sous l’écran sont masqués, puis révélés à leur entrée ; rien ne reste masqué au nettoyage', () => {
    const [visible, dessous, loin] = [element(100), element(900), element(2000)]
    const arreter = preparerRevelations(racine([visible, dessous, loin]), { Observateur: FauxObservateur as unknown as typeof IntersectionObserver, mouvementReduit: false, hauteurVue: 800 })
    assert.ok(!visible.classes.size, 'déjà à l’écran : jamais masqué')
    assert.ok(dessous.classes.has('revelation-attente') && loin.classes.has('revelation-attente'))
    FauxObservateur.dernier.rappel([{ isIntersecting: true, target: dessous }, { isIntersecting: false, target: loin }])
    assert.ok(dessous.classes.has('revelation-faite') && !dessous.classes.has('revelation-attente'))
    assert.ok(!FauxObservateur.dernier.observes.has(dessous))
    assert.ok(loin.classes.has('revelation-attente'))
    arreter()
    assert.ok(FauxObservateur.dernier.deconnecte)
    assert.ok(loin.classes.has('revelation-faite') && !loin.classes.has('revelation-attente'))
  })

  test('mouvement réduit ou navigateur sans IntersectionObserver : aucun masquage (contenu présent tel quel)', () => {
    for (const d of [
      { Observateur: FauxObservateur as unknown as typeof IntersectionObserver, mouvementReduit: true, hauteurVue: 800 },
      { Observateur: undefined, mouvementReduit: false, hauteurVue: 800 },
    ]) {
      const e = element(5000)
      preparerRevelations(racine([e]), d)()
      assert.equal(e.classes.size, 0)
    }
  })

  test('CSS : contenu visible par défaut (seule la classe posée par le script masque), transform / opacité seulement', () => {
    const css = lire('src/index.css')
    assert.match(css, /\.revelation-attente \{\s*opacity: 0;\s*transform: translateY\(18px\);\s*\}/)
    assert.doesNotMatch(css, /\[data-revelation\]\s*\{/, 'aucune règle ne masque [data-revelation] par défaut')
    const reduit = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    for (const c of ['.revelation-attente', '.cascade', '.indicateur-defilement', '.depliage', '.chevron-detail', '.revelation-faite']) assert.ok(reduit.includes(c), c)
  })
})

describe('Lot 2 : rail « En photos » (src/lib/defilementRail.ts)', () => {
  test('avance lentement, rebondit aux bords, reprend là où le client a fait défiler', () => {
    // 24 px/s : 100 ms → 2,4 px.
    let e = pasRail({ position: 0, sens: 1 }, 0, 500, 100)
    assert.deepEqual(e, { position: 2.4, sens: 1 })
    e = pasRail({ position: 499, sens: 1 }, 499, 500, 100)
    assert.deepEqual(e, { position: 500, sens: -1 })
    e = pasRail({ position: 1, sens: -1 }, 1, 500, 100)
    assert.deepEqual(e, { position: 0, sens: 1 })
    // Le client a fait défiler à la main jusqu'à 300 : on repart de là.
    assert.equal(pasRail({ position: 10, sens: 1 }, 300, 500, 0).position, 300)
    // Onglet revenu après longtemps : pas de saut (dt plafonné à 100 ms).
    assert.equal(pasRail({ position: 0, sens: 1 }, 0, 500, 60_000).position, 2.4)
    assert.deepEqual(pasRail({ position: 40, sens: -1 }, 40, 0, 16), { position: 0, sens: 1 })
  })

  test('MenuPublic : rail branché en mode Découverte, coupé en mouvement réduit, pause au toucher / survol / focus', () => {
    const menu = lire('src/pages/MenuPublic.tsx')
    assert.match(menu, /defilerRail\(rail\.current, prefereMouvementReduit\(\)\)/)
    assert.match(menu, /<div ref=\{rail\} className="flex gap-3 overflow-x-auto pb-1" data-rail-photos>/)
    const rail = lire('src/lib/defilementRail.ts')
    assert.match(rail, /if \(mouvementReduit \|\| typeof requestAnimationFrame === 'undefined'\) return \(\) => \{\}/)
    for (const ev of ['pointerenter', 'pointerdown', 'focusin', 'pointerleave', 'focusout']) assert.ok(rail.includes(`'${ev}'`), ev)
    assert.match(rail, /document\.visibilityState === 'visible'/)
  })
})

describe('Lot 2 : menu v2 (MenuPublic.tsx, source)', () => {
  const menu = lire('src/pages/MenuPublic.tsx')

  test('barre « commande à table » seulement si commandeActive, information sans ajout au panier', () => {
    assert.match(menu, /\{commerce\.commandeActive && \(\s*<p [^>]*role="note">\s*\{t\('Vous êtes à table \? Scannez le QR de votre table pour commander\.'\)\}/)
    assert.doesNotMatch(menu, /\bajouter\(|api\.commander|lib\/panier/)
  })

  test('révélations sur les cartes et les en-têtes « moment » ; nom en typographie logo sur la photo (h2 conservé)', () => {
    assert.match(menu, /preparerRevelations\(liste\.current, dependancesNavigateur\(\)\)/)
    assert.match(menu, /<li key=\{p\.id\} id=\{`plat-\$\{p\.id\}`\} className="[^"]*" data-revelation>/)
    assert.match(menu, /<div className=\{photo \? 'sr-only' : 'flex flex-wrap items-center gap-2'\}>\s*<h2 className="font-titre text-xl font-bold">\{c\.nom\}<\/h2>/)
    assert.match(menu, /<img src=\{photo\.src\} alt=\{photo\.alt\} loading="lazy" className="h-56 w-full object-cover" \/>/)
    assert.match(menu, /<span className="titre-logo text-2xl text-white">\{c\.nom\}<\/span>/)
  })

  test('chevron animé et fiche dépliée en hauteur + fondu ; lien discret vers l’accueil', () => {
    assert.match(menu, /<span aria-hidden="true" className="chevron-detail shrink-0 text-gray-400">/)
    assert.match(menu, /<div className="depliage border-t border-gray-100">/)
    assert.match(menu, /href=\{`#\/bienvenue\/\$\{encodeURIComponent\(commerce\.id\)\}`\}/)
    const css = lire('src/index.css')
    assert.match(css, /\[aria-expanded='true'\] > \.chevron-detail \{\s*transform: rotate\(180deg\);/)
    assert.match(css, /@keyframes depliage \{\s*from \{\s*grid-template-rows: 0fr;\s*opacity: 0;/)
  })
})

describe('Lot 2 : accueil #/bienvenue (Bienvenue.tsx, source)', () => {
  const page = lire('src/pages/Bienvenue.tsx')

  test('page différée, publique, sombre, traduite ; route lue', () => {
    assert.match(lire('src/App.tsx'), /bienvenue: \(\) => import\('\.\/pages\/Bienvenue'\)/)
    assert.ok(PAGES_PUBLIQUES.includes('bienvenue') && PAGES_PUBLIQUES.includes('commande'))
    assert.ok(estPageTraduite('bienvenue') && estPageTraduite('commande'))
    assert.deepEqual(lireRoute('#/bienvenue/c-asian-home-paris'), { page: 'bienvenue', param: 'c-asian-home-paris' })
    assert.deepEqual(lireRoute('#/commande/c-a/AbC_-12'), { page: 'commande', param: 'c-a', param2: 'AbC_-12' })
  })

  test('boutons : la carte toujours, « Commander à table » seulement si commandeActive (note, aucune fausse commande), la roue', () => {
    const actions = page.slice(page.indexOf('export function Actions('))
    assert.match(actions, /href=\{`#\/menu\/\$\{id\}`\}/)
    assert.match(actions, /href=\{`#\/jouer\/\$\{id\}`\}/)
    assert.match(actions, /\{commerce\.commandeActive && \(/)
    assert.match(actions, /\{t\('Scannez le QR code posé sur votre table pour commander\.'\)\}/)
    assert.doesNotMatch(actions, /#\/commande|api\./, 'aucun lien de commande sans jeton de table')
  })

  test('photos authentiques uniquement (VISUELS, bannière du commerce), moments réservés à Asian Home, aucun slogan inventé', () => {
    assert.match(page, /const photo = asianHome \? VISUELS\.heroPlats : banniereCommerce\(commerce\)/)
    assert.match(page, /const moments: Moment\[\] = asianHome/)
    for (const v of ['VISUELS.interieur', 'VISUELS.menuLocLac', 'VISUELS.cocktails']) assert.ok(page.includes(v), v)
    assert.doesNotMatch(page, /https?:\/\/(?!.*schema)/, 'aucune image distante')
    // Phrase sous le nom : celle du menu (donnée existante), et seulement pour Asian Home.
    assert.match(page, /\{asianHome && <p [^>]*>\{t\('Cuisine asiatique halal · Thaï, Japon, Vietnam, Chine'\)\}<\/p>\}/)
  })

  test('cascade + indicateur de défilement (coupés en mouvement réduit) ; révélations partagées avec le menu ; démo locale', () => {
    for (const c of ['cascade ', 'cascade cascade-2', 'cascade cascade-4', 'indicateur-defilement']) assert.ok(page.includes(c), c)
    assert.match(page, /preparerRevelations\(page\.current, dependancesNavigateur\(\)\)/)
    assert.match(page, /if \(!api\) return <MessagePublic titre="Bienvenue">\{MESSAGE_MODE_SERVEUR\}<\/MessagePublic>/)
    assert.match(page, /className=\{m\.ivoire \? 'moment-ivoire' : 'bg-nuit-950'\}/)
  })
})

describe('Lot 2 : commande à table (Commande.tsx, source)', () => {
  const page = lire('src/pages/Commande.tsx')

  test('mode Commande : aucune animation décorative sur le chemin d’action', () => {
    for (const motif of [/defilerRail/, /preparerRevelations/, /data-revelation/, /\bcascade\b/, /\bapparition\b/, /indicateur-defilement/]) assert.doesNotMatch(page, motif)
  })

  test('QR inconnu / sans jeton → écran clair ; module désactivé → message ; réseau → réessayer', () => {
    assert.match(page, /<MessagePublic titre="QR code invalide">Ce QR code n’est plus valide, demandez au personnel\.<\/MessagePublic>/)
    assert.match(page, /if \(!param \|\| !param2\) return <QrInvalide \/>/)
    assert.match(page, /e\.statut === 404 \? 'qr' : e instanceof ErreurApi && e\.statut === 409 \? 'indisponible' : 'horsLigne'/)
    assert.match(page, /<HorsLignePublic onReessayer=\{charger\} \/>/)
  })

  test('plat non commandable : badge honnête, aucun bouton d’ajout ; commandable : Ajouter puis − / + ; options en cases', () => {
    assert.match(page, /const commandable = estCommandable\(p\)/)
    assert.match(page, /\{!commandable \? \(/)
    assert.match(page, /\{t\('Indisponible'\)\}/)
    assert.match(page, /\{t\('Prix sur place'\)\}/)
    assert.match(page, /<span className="zone-case my-0">\s*<input\s+type="checkbox"\s+className="case-a-cocher"/)
    assert.match(page, /disabled=\{quantite >= QUANTITE_MAX\}/)
    assert.match(page, /'inline-flex h-11 w-11 /, 'boutons − / + de 44 px')
  })

  test('confirmation : une seule soumission ; clé + secret tirés et rangés AVANT l’envoi, réutilisés tant que le panier est identique', () => {
    const f = page.slice(page.indexOf('async function confirmer()'), page.indexOf('if (vue === \'panier\')'))
    assert.match(f, /if \(verrou\.current \|\| !panier\.length\) return/)
    const prep = f.indexOf('preparerEnvoi(precedent, empreintePanier(panier, instructions))')
    const range = f.indexOf('ecrire(cleEnvoi, JSON.stringify(envoi))')
    const envoi = f.indexOf('api.commander(')
    assert.ok(prep > 0 && prep < range && range < envoi, 'préparer → ranger → envoyer')
    assert.match(f, /cleIdempotence: envoi\.cleIdempotence,\s*secret: envoi\.secret,/)
    assert.match(f, /ecrire\(clesStockage\.secret\(commerceId, commande\.id\), envoi\.secret\)/)
    assert.match(page, /disabled=\{envoiEnCours\}/)
    // Refus du serveur : le panier se rouvre avec le message ; réseau : message honnête + réessayer.
    assert.match(f, /setVue\('panier'\)/)
    assert.match(page, /erreur\.reseau \? t\(MESSAGE_HORS_LIGNE\) : erreur\.message/)
  })

  test('suivi : aria-live poli, relu toutes les 10 s onglet visible seulement, arrêté quand terminé ; secret en sessionStorage', () => {
    assert.match(page, /const INTERVALLE_SUIVI_MS = 10_000/)
    assert.match(page, /setInterval\(\(\) => document\.visibilityState === 'visible' && relire\(\), INTERVALLE_SUIVI_MS\)/)
    assert.match(page, /if \(terminee\) return/)
    assert.match(page, /aria-live="polite"/)
    assert.match(page, /return sessionStorage/)
    assert.doesNotMatch(page, /localStorage/)
    assert.match(page, /const id = lire\(clesStockage\.derniere\(commerceId, jetonTable\)\)/)
  })

  test('client API : secret de suivi en en-tête X-Secret-Commande (jamais dans l’URL) ; résolution de la table', () => {
    const api = lire('src/data/api.ts')
    assert.match(api, /if \(options\.secret\) entetes\['X-Secret-Commande'\] = options\.secret/)
    assert.match(api, /\/commerces\/\$\{enc\(commerceId\)\}\/commandes\/\$\{enc\(commandeId\)\}`, \{ secret \}/)
    assert.doesNotMatch(api, /\?secret=/)
    assert.match(api, /\/commerces\/\$\{enc\(commerceId\)\}\/tables\/\$\{enc\(jeton\)\}/)
  })
})

describe('Lot 2 : réglages « Commande à table » et rupture au menu (source)', () => {
  const section = lire('src/components/ReglagesCommande.tsx')

  test('section présente dans l’onglet Commerce des Réglages ; interrupteur lié à l’état du store, défaut désactivé', () => {
    const reglages = lire('src/pages/Reglages.tsx')
    const panneau = reglages.slice(reglages.indexOf('id="reglages-commerce"'), reglages.indexOf('id="reglages-fidelite"'))
    assert.match(panneau, /<ReglagesCommande \/>/)
    assert.match(section, /const \{ commerce, mode, avecPin, recharger \} = useStore\(\)/)
    assert.match(section, /useState\(commerce\.commande \?\? \{ active: false, tables: \[\] \}\)/)
    assert.match(section, /<Interrupteur\s+actif=\{active\}/)
  })

  test('enregistrement : PATCH du seul champ commande, jetons jamais inventés, commerce relu puis store rechargé', () => {
    assert.match(section, /api\.majCommerce\(commerce\.id, a, \{ commande \}\)/)
    assert.match(section, /\.\.\.\(t\.jeton \? \{ jeton: t\.jeton \} : \{\}\)/)
    assert.doesNotMatch(section, /jetonAleatoire|getRandomValues|randomUUID/)
    assert.match(section, /const relue = r\.valeur\.commande/)
    assert.match(section, /void recharger\(\)/)
    // Entrée dans le champ : pas de soumission du formulaire des Réglages.
    assert.match(section, /e\.preventDefault\(\)\s*ajouterTable\(\)/)
  })

  test('QR par table vers #/commande/<id>/<jeton>, copie du lien, planche imprimable, lien vers l’écran cuisine', () => {
    assert.equal(lienTable('https://x.fr/', 'c-a', 'AbC_-1'), 'https://x.fr/#/commande/c-a/AbC_-1')
    assert.match(section, /<QrCode texte=\{lien\}/)
    assert.match(section, /<BoutonCopier texte=\{lien\} libelle="Copier le lien"/)
    assert.match(section, /onClick=\{\(\) => window\.print\(\)\}/)
    assert.match(section, /data-impression-qr/)
    assert.match(lire('src/index.css'), /@media print \{\s*body:has\(\[data-impression-qr\]\) \* \{\s*visibility: hidden;/)
    assert.match(section, /href="#\/cuisine"/)
  })

  test('noms de tables : mêmes règles que le serveur (vides, longueur, doublons sans casse, 50 tables)', () => {
    assert.equal(TABLES_MAX, TABLES_COMMANDE_MAX)
    assert.equal(NOM_TABLE_MAX, 40)
    assert.equal(problemeTables(['Table 1', 'Terrasse']), null)
    assert.match(problemeTables(['Table 1', '  ']) ?? '', /nom/)
    assert.match(problemeTables(['Table 1', 'TABLE 1 ']) ?? '', /unique/)
    assert.match(problemeTables(['x'.repeat(41)]) ?? '', /40 caractères/)
    assert.match(problemeTables(Array.from({ length: 51 }, (_, i) => `T${i}`)) ?? '', /50 tables/)
  })

  test('éditeur de menu : case « Indisponible » par produit (patron des cases), écrite seulement si cochée', () => {
    const carte = lire('src/pages/MenuCarte.tsx')
    assert.match(
      carte,
      /<span className="zone-case my-0">\s*<input type="checkbox" className="case-a-cocher" checked=\{!!produit\.indisponible\} onChange=\{\(e\) => maj\('indisponible', e\.target\.checked \|\| undefined\)\} \/>/,
    )
  })
})

describe('Lot 2 : GET /commerces/:id/tables/:jeton (vrai serveur HTTP)', () => {
  const AH = 'c-asian-home-paris'
  const PIN = { 'X-Commerce-PIN': '1234' }
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-lot2-'))
  let app: Awaited<ReturnType<typeof creerServeur>>
  let base = ''
  let ip = 0
  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.9.0.${++ip % 250}`, ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    return { statut: r.status, contenu: await r.json() }
  }
  const tables = async () => ((await api('GET', `/commerces/${AH}/etat`, undefined, PIN)).contenu.commerce as Commerce).commande!.tables

  before(async () => {
    app = await creerServeur({ fichierDb: join(dossier, 'lot2.db'), adminPin: '98765432', pinInitial: '1234', version: 'test', derriereProxy: true })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('module absent → 409 ; activé → nom de la table seulement ; jeton inconnu → 404 ; désactivé → 409', async () => {
    const absent = await api('GET', `/commerces/${AH}/tables/inconnu`)
    assert.equal(absent.statut, 409)
    assert.equal(absent.contenu.erreur, 'La commande en ligne n’est pas activée pour ce commerce.')
    assert.equal((await api('PATCH', `/commerces/${AH}`, { commande: { active: true, tables: [{ nom: 'Table 1' }, { nom: 'Terrasse' }] } }, PIN)).statut, 200)
    const [t1, t2] = await tables()
    const r = await api('GET', `/commerces/${AH}/tables/${t1.jeton}`)
    assert.equal(r.statut, 200)
    assert.deepEqual(r.contenu, { table: 'Table 1' }, 'ni jeton, ni autres tables')
    assert.doesNotMatch(JSON.stringify(r.contenu), new RegExp(t2.jeton))
    assert.equal((await api('GET', `/commerces/${AH}/tables/${t2.jeton}`)).contenu.table, 'Terrasse')
    const inconnu = await api('GET', `/commerces/${AH}/tables/${'x'.repeat(24)}`)
    assert.equal(inconnu.statut, 404)
    assert.match(inconnu.contenu.erreur, /Table introuvable/)
    assert.equal((await api('PATCH', `/commerces/${AH}`, { commande: { active: false, tables: [t1, t2] } }, PIN)).statut, 200)
    assert.equal((await api('GET', `/commerces/${AH}/tables/${t1.jeton}`)).statut, 409)
  })

  test('table supprimée : son QR répond 404 ; renommée : même QR, nouveau nom ; jeton d’un autre commerce : 404', async () => {
    const [t1, t2] = await tables()
    assert.equal((await api('PATCH', `/commerces/${AH}`, { commande: { active: true, tables: [{ nom: 'Salle 1', jeton: t1.jeton }] } }, PIN)).statut, 200)
    assert.deepEqual((await api('GET', `/commerces/${AH}/tables/${t1.jeton}`)).contenu, { table: 'Salle 1' })
    assert.equal((await api('GET', `/commerces/${AH}/tables/${t2.jeton}`)).statut, 404)
    const b = await api('POST', '/commerces', { pin: '5678', nom: 'Commerce B', lienGoogle: '' }, { 'X-Admin-PIN': '98765432' })
    assert.equal(b.statut, 201)
    const B = b.contenu.commerce.id
    assert.equal((await api('PATCH', `/commerces/${B}`, { commande: { active: true, tables: [{ nom: 'B1' }] } }, { 'X-Commerce-PIN': '5678' })).statut, 200)
    assert.equal((await api('GET', `/commerces/${B}/tables/${t1.jeton}`)).statut, 404)
    assert.equal((await api('GET', `/commerces/inconnu/tables/${t1.jeton}`)).statut, 404)
  })
})

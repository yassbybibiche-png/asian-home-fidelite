// Menu Appétit, lot 1 — demandes de service à 0 € (« Appeler le serveur », « De l’eau »…) : liste canonique définie
// côté serveur (src/lib/servicesCommande.ts), calcul du panier (src/lib/commande.ts), réglage `commande.services`,
// fiche publique `servicesCommande`, vrai serveur HTTP sur SQLite temporaire (horloge injectée).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { calculerCommande } from '../src/lib/commande.ts'
import { estIdService, serviceParId, SERVICES_COMMANDE } from '../src/lib/servicesCommande.ts'
import { commercePublic } from '../src/lib/vuePublique.ts'
import { nouveauCommerce } from '../src/data/defaults.ts'
import type { Commande, Commerce, Menu } from '../src/types.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (f: string) => readFileSync(join(RACINE, f), 'utf8')

const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const ADMIN = { 'X-Admin-PIN': '98765432' }
/** Mardi 10/11/2026, 12:00 à Paris. */
const MIDI = new Date('2026-11-10T11:00:00Z')

const MENU: Pick<Menu, 'categories'> = {
  categories: [
    {
      id: 'cat-plats',
      nom: 'Plats',
      produits: [
        { id: 'p-pad', nom: 'Pad Thaï', prix: 1290, allergenes: [], options: [{ nom: 'Œuf', prix: 100 }] },
        { id: 'p-nems', nom: 'Nems', prix: 650, allergenes: [] },
      ],
    },
  ],
}
const INCONNU = 'Un plat de votre panier n’est plus à la carte : retirez-le puis validez à nouveau.'

describe('Menu Appétit : liste canonique (src/lib/servicesCommande.ts)', () => {
  test('quatre services, ids et noms canoniques, liste figée', () => {
    assert.deepEqual(
      SERVICES_COMMANDE.map((s) => [s.id, s.nom]),
      [
        ['service-serveur', 'Appeler le serveur'],
        ['service-eau', 'De l’eau'],
        ['service-baguettes', 'Des baguettes'],
        ['service-addition', 'L’addition'],
      ],
    )
    assert.ok(Object.isFrozen(SERVICES_COMMANDE) && SERVICES_COMMANDE.every((s) => Object.isFrozen(s)))
    assert.equal(serviceParId('service-eau')?.nom, 'De l’eau')
    for (const id of ['service-pizza', 'SERVICE-EAU', '', 42, null, undefined, { id: 'service-eau' }]) {
      assert.equal(serviceParId(id), undefined, String(id))
      assert.equal(estIdService(id), false, String(id))
    }
    assert.equal(estIdService('service-addition'), true)
  })
})

describe('Menu Appétit : calculerCommande avec demandes de service', () => {
  test('(a) acceptée avec services: true → prix 0, nom canonique, service: true, total des plats seuls', () => {
    const r = calculerCommande(MENU, [
      { produitId: 'p-nems', quantite: 2 },
      { produitId: 'service-eau', quantite: 3, nom: 'Champagne', prixUnitaire: 9900, prix: 9900, instructions: ' pétillante ' },
    ], { services: true })
    assert.ok(r.ok, JSON.stringify(r))
    assert.equal(r.total, 650 * 2)
    assert.deepEqual(r.lignes[1], { produitId: 'service-eau', nom: 'De l’eau', prixUnitaire: 0, quantite: 3, options: [], service: true, instructions: 'pétillante' })
    assert.equal('service' in r.lignes[0], false, 'un plat n’est jamais marqué service')
  })

  test('(b) refusée produit_inconnu (même message qu’un plat inconnu) sans l’option ou avec services: false', () => {
    const plat = calculerCommande(MENU, [{ produitId: 'p-inconnu', quantite: 1 }])
    assert.equal(plat.ok, false)
    for (const options of [undefined, {}, { services: false }]) {
      const r = calculerCommande(MENU, [{ produitId: 'service-serveur', quantite: 1 }], options)
      assert.equal(r.ok, false, JSON.stringify(options))
      if (!r.ok && !plat.ok) {
        assert.equal(r.code, 'produit_inconnu')
        assert.equal(r.message, INCONNU)
        assert.equal(r.message, plat.message, 'aucun oracle : on ne révèle pas que l’id existe')
      }
    }
  })

  test('(c) id inventé « service-pizza » refusé même avec services: true', () => {
    const r = calculerCommande(MENU, [{ produitId: 'service-pizza', quantite: 1, prixUnitaire: 0 }], { services: true })
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.code, 'produit_inconnu')
      assert.equal(r.message, INCONNU)
    }
  })

  test('(d) service avec options refusé option_inconnue ; quantité 1–20 comme un plat', () => {
    for (const opts of [['Œuf'], ['']]) {
      const r = calculerCommande(MENU, [{ produitId: 'service-baguettes', quantite: 1, options: opts }], { services: true })
      assert.equal(r.ok, false)
      if (!r.ok) {
        assert.equal(r.code, 'option_inconnue')
        assert.match(r.message, /Des baguettes.*option non proposée/)
      }
    }
    assert.ok(calculerCommande(MENU, [{ produitId: 'service-baguettes', quantite: 1, options: [] }], { services: true }).ok, 'liste vide acceptée')
    for (const quantite of [0, 21, 1.5, '2']) {
      const r = calculerCommande(MENU, [{ produitId: 'service-eau', quantite }], { services: true })
      assert.equal(r.ok, false, String(quantite))
      if (!r.ok) assert.equal(r.code, 'quantite')
    }
    assert.ok(calculerCommande(MENU, [{ produitId: 'service-eau', quantite: 20 }], { services: true }).ok)
    const longues = calculerCommande(MENU, [{ produitId: 'service-eau', quantite: 1, instructions: 'x'.repeat(301) }], { services: true })
    assert.equal(longues.ok || longues.code, 'instructions')
  })

  test('(e) commande composée uniquement de demandes de service : valide, total 0', () => {
    const r = calculerCommande(undefined, [
      { produitId: 'service-serveur', quantite: 1 },
      { produitId: 'service-addition', quantite: 1 },
    ], { services: true })
    assert.ok(r.ok, JSON.stringify(r))
    assert.equal(r.total, 0)
    assert.deepEqual(r.lignes.map((l) => [l.nom, l.prixUnitaire, l.service]), [['Appeler le serveur', 0, true], ['L’addition', 0, true]])
  })

  test('(f) un plat reste facturé à son prix de base malgré un prix 0 envoyé ou service: true accolé', () => {
    // Le cas général « prix envoyé ignoré » est déjà couvert par commande-serveur-experience.test.ts (test 1) ;
    // ici : avec le module services actif, rien ne transforme un plat en ligne à 0.
    const r = calculerCommande(MENU, [{ produitId: 'p-pad', quantite: 1, prix: 0, prixUnitaire: 0, service: true, options: ['Œuf'] }], { services: true })
    assert.ok(r.ok, JSON.stringify(r))
    assert.equal(r.total, 1290 + 100)
    assert.deepEqual(r.lignes[0], { produitId: 'p-pad', nom: 'Pad Thaï', prixUnitaire: 1290, quantite: 1, options: [{ nom: 'Œuf', prix: 100 }] })
  })

  test('appels existants (deux paramètres) : comportement inchangé pour les plats', () => {
    const r = calculerCommande(MENU, [{ produitId: 'p-nems', quantite: 1 }])
    assert.ok(r.ok)
    assert.equal(r.total, 650)
  })
})

describe('Menu Appétit : fiche publique servicesCommande', () => {
  test('publiée seulement si active, au moins une table et services vrai — jamais les jetons', () => {
    const base = nouveauCommerce('Test', 'restaurant', '')
    const fiche = (commande: Commerce['commande']) => commercePublic({ ...base, commande })
    const T = [{ nom: 'T1', jeton: 'jeton-secret-aaaaaaaaaa' }]
    assert.equal('servicesCommande' in fiche(undefined), false)
    assert.equal('servicesCommande' in fiche({ active: true, tables: T }), false, 'absent = désactivé')
    assert.equal('servicesCommande' in fiche({ active: true, tables: T, services: false }), false)
    assert.equal('servicesCommande' in fiche({ active: false, tables: T, services: true }), false)
    assert.equal('servicesCommande' in fiche({ active: true, tables: [], services: true }), false)
    const ok = fiche({ active: true, tables: T, services: true })
    assert.equal(ok.servicesCommande, true)
    assert.equal(ok.commandeActive, true)
    assert.doesNotMatch(JSON.stringify(ok), /jeton-secret|"tables"|"services"/)
  })
})

describe('Menu Appétit : vrai serveur HTTP (SQLite)', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'fidelite-appetit-'))
  const fichierDb = join(dossier, 'appetit.db')
  let app: Awaited<ReturnType<typeof creerServeur>>
  let base = ''
  let ip = 0
  let n = 0
  let B = ''
  const PIN_B = { 'X-Commerce-PIN': '5678' }

  async function api(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.8.${Math.floor(++ip / 250)}.${ip % 250}`, ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
    return { statut: r.status, contenu: await r.json() }
  }
  const etat = async (id = AH, pin = PIN) => (await api('GET', `/commerces/${id}/etat`, undefined, pin)).contenu.commerce as Commerce
  async function commander(lignes: unknown, id = AH, pin = PIN) {
    const jeton = (await etat(id, pin)).commande!.tables[0].jeton
    return api('POST', `/commerces/${id}/commandes`, { jetonTable: jeton, lignes, cleIdempotence: `cle-appetit-${++n}-aaaa`, secret: `secret-appetit-${++n}-aaaaaaaa` })
  }

  before(async () => {
    app = await creerServeur({ fichierDb, adminPin: '98765432', pinInitial: '1234', version: 'test', maintenant: () => MIDI, derriereProxy: true, limiteCommandesParIp: 30 })
    await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
    assert.equal((await api('PUT', `/commerces/${AH}/menu`, MENU, PIN)).statut, 200)
    const b = await api('POST', '/commerces', { pin: '5678', nom: 'Commerce B', lienGoogle: '' }, ADMIN)
    assert.equal(b.statut, 201, JSON.stringify(b.contenu))
    B = b.contenu.commerce.id
    assert.equal((await api('PUT', `/commerces/${B}/menu`, MENU, PIN_B)).statut, 200)
  })
  after(async () => {
    await app.fermer()
    rmSync(dossier, { recursive: true, force: true })
  })

  test('réglage commande.services : booléen optionnel, renvoyé s’il est présent, refusé s’il n’est pas booléen', async () => {
    const r = await api('PATCH', `/commerces/${AH}`, { commande: { active: true, services: true, tables: [{ nom: 'Table 1' }] } }, PIN)
    assert.equal(r.statut, 200, JSON.stringify(r.contenu))
    assert.equal((await etat()).commande!.services, true)
    assert.equal((await api('GET', `/commerces/${AH}`)).contenu.commerce.servicesCommande, true)
    for (const services of ['oui', 1, null]) {
      const k = await api('PATCH', `/commerces/${AH}`, { commande: { active: true, services, tables: [{ nom: 'Table 1' }] } }, PIN)
      assert.equal(k.statut, 400, String(services))
      assert.match(k.contenu.erreur, /commande\.services/)
    }
    assert.equal((await etat()).commande!.services, true, 'rien d’écrit après un refus')
    // Commerce B : module actif SANS services (clé absente → absente de la config, fiche sans drapeau).
    assert.equal((await api('PATCH', `/commerces/${B}`, { commande: { active: true, tables: [{ nom: 'Table 1' }] } }, PIN_B)).statut, 200)
    assert.equal('services' in (await etat(B, PIN_B)).commande!, false)
    assert.equal('servicesCommande' in (await api('GET', `/commerces/${B}`)).contenu.commerce, false)
  })

  test('commerce avec services : plat + service-eau → 201, total du plat seul ; la cuisine voit service: true', async () => {
    const r = await commander([{ produitId: 'p-pad', quantite: 1 }, { produitId: 'service-eau', quantite: 2, prixUnitaire: 500 }])
    assert.equal(r.statut, 201, JSON.stringify(r.contenu))
    const c = r.contenu.commande as Commande
    assert.equal(c.total, 1290)
    assert.deepEqual(c.lignes[1], { produitId: 'service-eau', nom: 'De l’eau', prixUnitaire: 0, quantite: 2, options: [], service: true })
    assert.equal((await api('GET', `/commerces/${AH}/commandes`)).statut, 401, 'liste cuisine : session exigée')
    const liste = (await api('GET', `/commerces/${AH}/commandes`, undefined, PIN)).contenu.commandes as Commande[]
    const lue = liste.find((x) => x.id === c.id)!
    assert.equal(lue.lignes[1].service, true)
    assert.equal(lue.lignes[1].prixUnitaire, 0)
    assert.equal('service' in lue.lignes[0], false)
    // Commande 100 % services : acceptée.
    const seule = await commander([{ produitId: 'service-addition', quantite: 1 }])
    assert.equal(seule.statut, 201, JSON.stringify(seule.contenu))
    assert.equal(seule.contenu.commande.total, 0)
    // Id inventé : refusé comme un plat inconnu.
    const pizza = await commander([{ produitId: 'service-pizza', quantite: 1 }])
    assert.equal(pizza.statut, 400)
    assert.equal(pizza.contenu.erreur, INCONNU)
  })

  test('commerce sans services : le même POST → 400 avec le message d’un plat inconnu', async () => {
    const r = await commander([{ produitId: 'p-pad', quantite: 1 }, { produitId: 'service-eau', quantite: 2 }], B, PIN_B)
    assert.equal(r.statut, 400, JSON.stringify(r.contenu))
    assert.equal(r.contenu.erreur, INCONNU)
    const liste = (await api('GET', `/commerces/${B}/commandes`, undefined, PIN_B)).contenu.commandes as Commande[]
    assert.equal(liste.length, 0, 'rien d’écrit')
    // Services désactivés explicitement chez AH : même refus.
    assert.equal((await api('PATCH', `/commerces/${AH}`, { commande: { ...(await etat()).commande!, services: false } }, PIN)).statut, 200)
    assert.equal((await commander([{ produitId: 'service-serveur', quantite: 1 }])).statut, 400)
    assert.equal('servicesCommande' in (await api('GET', `/commerces/${AH}`)).contenu.commerce, false)
  })
})

describe('Menu Appétit : sources', () => {
  test('servicesCommande.ts : les 4 ids, aucun import autre que des types', () => {
    const src = lire('src/lib/servicesCommande.ts')
    for (const id of ['service-serveur', 'service-eau', 'service-baguettes', 'service-addition']) assert.match(src, new RegExp(`id: '${id}'`))
    for (const m of src.matchAll(/^import .*$/gm)) assert.match(m[0], /^import type /, m[0])
  })

  test('vuePublique.ts conditionne servicesCommande à commande.services (et à la commande active avec tables)', () => {
    assert.match(lire('src/lib/vuePublique.ts'), /c\.commande\?\.active && c\.commande\.services && c\.commande\.tables\.length \? \{ servicesCommande: true as const \}/)
  })

  test('serveur : services passé à calculerCommande depuis la config du commerce', () => {
    assert.match(lire('server/app.ts'), /calculerCommande\(await st\.menu\(id\), corps\.lignes, \{ services: !!config\.services \}\)/)
  })

  test('ReglagesCommande.tsx envoie services dans l’objet commande, le relit, interrupteur visible si actif', () => {
    const src = lire('src/components/ReglagesCommande.tsx')
    assert.match(src, /const commande = \{ active, services, tables:/)
    assert.match(src, /api\.majCommerce\(commerce\.id, a, \{ commande \}\)/)
    assert.match(src, /useState\(enregistree\.services === true\)/)
    assert.match(src, /setServices\(relue\.services === true\)/)
    assert.match(src, /\{active && \(\s*<Interrupteur\s+actif=\{services\}/)
    assert.match(src, /libelle="Demandes de service à 0 €"/)
  })

  test('Cuisine.tsx : pastille « Service » sur une ligne de service', () => {
    assert.match(lire('src/pages/Cuisine.tsx'), /\{l\.service && <span [^>]*>Service<\/span>\}/)
  })
})

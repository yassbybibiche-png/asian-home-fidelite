// P1-C7 — Écrans commerçant (finitions) : les 8 window.confirm() restants (AUDIT §7 — en réalité 10
// hors démo au moment du lot) sont remplacés par la modale <Confirmation> ; Réglages est découpé en
// 6 onglets (un seul formulaire, aucun réglage supprimé) ; la pagination Clients (livrée en P1-C6)
// est vérifiée en non-régression. Seule exception : la réinitialisation de la démo (Admin.tsx).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { recapitulatif } from '../src/lib/ecransCommercant.ts'

const RACINE = join(import.meta.dirname, '..')
const source = (f: string) => readFileSync(join(RACINE, f), 'utf8')

function fichiersSrc(dossier: string): string[] {
  const sortis: string[] = []
  for (const e of readdirSync(join(RACINE, dossier), { withFileTypes: true })) {
    const chemin = join(dossier, e.name)
    if (e.isDirectory()) sortis.push(...fichiersSrc(chemin))
    else if (/\.(ts|tsx)$/.test(e.name)) sortis.push(chemin)
  }
  return sortis
}

describe('P1-C7 : 0 window.confirm() hors démo (sources TypeScript)', () => {
  test('aucun window.confirm dans src/, sauf UNE occurrence : la réinitialisation de la démo (Admin.tsx)', () => {
    const fautifs: string[] = []
    for (const f of fichiersSrc('src')) {
      if (source(f).includes('window.confirm')) fautifs.push(f)
    }
    assert.deepEqual(fautifs, ['src/pages/Admin.tsx'], `window.confirm restant : ${fautifs}`)
    const admin = source('src/pages/Admin.tsx')
    assert.equal(admin.match(/window\.confirm/g)?.length, 1, 'une seule occurrence, celle de la démo')
    assert.match(admin, /Réinitialiser la démo \?/)
  })

  test('chaque site remplacé rend <Confirmation> et n’agit que sur confirmation', () => {
    const cas: [fichier: string, motifs: RegExp[]][] = [
      ['src/pages/FicheClient.tsx', [/setDemande\(\{ type: 'echange', recompense: r \}\)/, /setDemande\(\{ type: 'consentement', valeur: !consenti \}\)/, /setDemande\(\{ type: 'rattrapage-refus'/, /<Confirmation recap=\{recapitulatif\(demande, client, commerce\)\}/]],
      ['src/pages/Equipe.tsx', [/setDemande\(true\)/, /<Confirmation recap=\{recapRetrait\}/, /onConfirmer=\{\(\) => void supprimer\(\)\}/]],
      ['src/pages/Avis.tsx', [/setDemande\(true\)/, /<Confirmation recap=\{recapDeconnexion\}/, /onConfirmer=\{\(\) => void deconnecter\(\)\}/]],
      ['src/pages/Messages.tsx', [/setDemande\(true\)/, /<Confirmation recap=\{recapDepot\}/, /onConfirmer=\{\(\) => void deposer\(\)\}/]],
      ['src/pages/MenuCarte.tsx', [/setRemplacement\(\{/, /<Confirmation recap=\{recapRemplacement\}/, /onConfirmer=\{\(\) => appliquerRemplacement\(remplacement\.nouvelles\)\}/, /<Confirmation[\s\S]*?Supprimer la catégorie/]],
      ['src/pages/CartePublique.tsx', [/setDemande\(true\)/, /onConfirmer=\{\(\) => void confirmerSuppression\(\)\}/, /onConfirmer=\{\(\) => void agir\(\)\}/]],
    ]
    for (const [f, motifs] of cas) {
      const s = source(f)
      for (const m of motifs) assert.match(s, m, `${f} : ${m}`)
      assert.match(s, /import \{ Confirmation \} from '\.\.\/components\/Confirmation'/)
    }
  })
})

describe('P1-C7 : récapitulatifs de la modale (fiche client)', () => {
  const client = { prenom: 'Lætitia', tampons: 7, points: 180 }
  const commerce = { seuilTampons: 10, recompense: 'Un plat offert' }

  test('consentement : donner (avec mise en garde) / retirer', () => {
    const donner = recapitulatif({ type: 'consentement', valeur: true }, client, commerce)
    assert.equal(donner.titre, 'Le client accepte les relances ?')
    assert.deepEqual(Object.fromEntries(donner.lignes), { Client: 'Lætitia', Relances: 'SMS ou e-mail' })
    assert.equal(donner.confirmer, 'Enregistrer le consentement')
    assert.match(donner.avertissement!, /Ne cochez que si le client vous l’a dit/)
    const retirer = recapitulatif({ type: 'consentement', valeur: false }, client, commerce)
    assert.equal(retirer.titre, 'Retirer le consentement ?')
    assert.equal(retirer.confirmer, 'Retirer le consentement')
    assert.match(retirer.avertissement!, /Plus aucune relance ne lui sera envoyée/)
  })

  test('refus de rattrapage : visite + montant, sans crédit', () => {
    const r = recapitulatif({ type: 'rattrapage-refus', id: 'd1', date: '10/11/2026', montant: '23,50 €' }, client, commerce)
    assert.equal(r.titre, 'Refuser cette visite oubliée ?')
    assert.deepEqual(Object.fromEntries(r.lignes), { Client: 'Lætitia', Visite: '10/11/2026', Montant: '23,50 €' })
    assert.equal(r.confirmer, 'Refuser la visite')
    assert.match(r.avertissement!, /sans crédit de tampon ni de points/)
  })
})

describe('P1-C7 : Réglages découpés en 6 onglets, un seul formulaire', () => {
  const s = source('src/pages/Reglages.tsx')

  test('6 onglets (tablist, tab, tabpanel) ; 9 fieldsets, aucun réglage supprimé', () => {
    assert.match(s, /role="tablist" aria-label="Sections des réglages"/)
    assert.match(s, /ONGLETS_REGLAGES: \{ id: OngletReglages; libelle: string \}\[\] = \[/)
    for (const [id, libelle] of [['commerce', 'Commerce'], ['fidelite', 'Fidélité'], ['roulette', 'Roulette'], ['messages', 'Messages'], ['carte', 'Carte'], ['donnees', 'Données']] as const) {
      assert.ok(s.includes(`{ id: '${id}', libelle: '${libelle}' }`), id)
      assert.ok(s.includes(`id="reglages-${id}"`), `panneau ${id}`)
      assert.match(s, new RegExp(`aria-controls=\\{\\\`reglages-\\$\\{o\\.id\\}\\\`\\}`))
    }
    assert.equal(s.match(/role="tabpanel" aria-labelledby=/g)?.length, 6)
    assert.equal(s.match(/<fieldset/g)?.length, 9)
    for (const legende of ['Le commerce', 'Fidélité', 'Programme de fidélité', 'Points', 'Roulette', 'Messages automatiques', 'Réponses aux avis', 'Apparence de la carte', 'Données personnelles']) {
      assert.ok(s.includes(`<legend className="sr-only">${legende}</legend>`), legende)
    }
  })

  test('chaque panneau contient exactement ses fieldsets (légendes par panneau)', () => {
    const attendues: Record<string, string[]> = {
      commerce: ['Le commerce'],
      fidelite: ['Fidélité', 'Programme de fidélité', 'Points'],
      roulette: ['Roulette'],
      messages: ['Messages automatiques', 'Réponses aux avis'],
      carte: ['Apparence de la carte'],
      donnees: ['Données personnelles'],
    }
    const ids = Object.keys(attendues)
    for (const [i, id] of ids.entries()) {
      const debut = s.indexOf(`id="reglages-${id}"`)
      assert.ok(debut > 0, `panneau ${id}`)
      const fin = i + 1 < ids.length ? s.indexOf(`id="reglages-${ids[i + 1]}"`) : s.length
      const panneau = s.slice(debut, fin)
      const legendes = [...panneau.matchAll(/<legend className="sr-only">([^<]+)<\/legend>/g)].map((m) => m[1])
      assert.deepEqual(legendes, attendues[id], `panneau ${id}`)
    }
  })

  test('inventaire des champs inchangé : 26 input/select/textarea, comme avant la découpe', () => {
    // Roue v2 R6 (décision utilisateur du 12/11/2026, brief R6) : +4 champs dans l'onglet Roulette — type du lot
    // (select), points, plafond par jour, mode d'accès (radio) ; la limite de gains passe par `Nombre`, déjà compté.
    assert.equal(s.match(/<(input|select|textarea)[\s>]/g)?.length, 26 + 4)
  })

  test('validation native : champ invalide dans un onglet masqué → bascule sur son onglet puis focus', () => {
    assert.match(s, /<form onSubmit=\{enregistrer\} onInvalid=\{revelerChampInvalide\}/)
    const f = s.slice(s.indexOf('function revelerChampInvalide('), s.indexOf('async function enregistrer('))
    assert.match(f, /closest\('\[role="tabpanel"\]'\)/)
    assert.match(f, /setOnglet\(id\)/)
    assert.match(f, /setTimeout\(\(\) => champ\.focus\(\), 0\)/)
  })

  test('navigation clavier des onglets : roving tabindex, flèches, Début/Fin', () => {
    assert.match(s, /onKeyDown=\{naviguerOnglets\}/)
    assert.match(s, /tabIndex=\{onglet === o\.id \? 0 : -1\}/)
    const f = s.slice(s.indexOf('function naviguerOnglets('), s.indexOf('function revelerChampInvalide('))
    for (const touche of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) assert.ok(f.includes(`'${touche}'`), touche)
    assert.match(f, /setTimeout\(\(\) => document\.getElementById\(`onglet-\$\{id\}`\)\?\.focus\(\), 0\)/)
  })

  test('ordre thématique : Points après Programme, Réponses aux avis après Messages automatiques', () => {
    assert.ok(s.indexOf('Programme de fidélité</legend>') < s.indexOf('Points</legend>'))
    assert.ok(s.indexOf('Points</legend>') < s.indexOf('Roulette</legend>'))
    assert.ok(s.indexOf('Messages automatiques</legend>') < s.indexOf('Réponses aux avis</legend>'))
    assert.ok(s.indexOf('Réponses aux avis</legend>') < s.indexOf('Apparence de la carte</legend>'))
  })

  test('un seul formulaire, un seul bouton Enregistrer, onglet Commerce par défaut', () => {
    assert.equal(s.match(/<form onSubmit=\{enregistrer\}/g)?.length, 1)
    assert.equal(s.match(/type="submit"/g)?.length, 1)
    assert.match(s, /useState<OngletReglages>\('commerce'\)/)
    assert.match(s, /hidden=\{onglet !== '/)
  })
})

describe('P1-C7 : pagination Clients (P1-C6) en non-régression', () => {
  test('« Charger plus » au-delà de 50, remise à 50 sur recherche / filtre', () => {
    const s = source('src/pages/Clients.tsx')
    assert.match(s, /page\.visibles\.map\(/)
    assert.match(s, /Charger \{page\.prochain\} de plus/)
    assert.match(s, /useEffect\(\(\) => setNbAffiches\(TAILLE_PAGE_CLIENTS\), \[recherche, filtre\]\)/)
  })
})

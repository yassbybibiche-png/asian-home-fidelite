// Invitation à l'avis : 5 étoiles pré-remplies DANS l'app, ajustables d'un tap, puis lien Google direct inchangé.
// Google ne permet pas de pré-sélectionner une note : on vérifie aussi qu'aucun texte ne prétend le contraire.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import seed from '../src/data/seed.json' with { type: 'json' }
import {
  NOTE_PAR_DEFAUT,
  TEXTE_CONFIRMATION_GOOGLE,
  TEXTE_INVITATION,
  choisirNote,
  etoilesRemplies,
  libelleBoutonAvis,
  lienAvisGoogle,
} from '../src/lib/invitationAvis.ts'

const PLACE_ID = 'ChIJAV70Kqxt5kcRnhPY0L6yaf0'
const source = (chemin: string) => readFileSync(join(import.meta.dirname, '..', 'src', chemin), 'utf8')

describe('Étoiles pré-remplies dans l’app', () => {
  test('par défaut : 5 étoiles remplies', () => {
    assert.equal(NOTE_PAR_DEFAUT, 5)
    assert.deepEqual(etoilesRemplies(NOTE_PAR_DEFAUT), [true, true, true, true, true])
    assert.equal(libelleBoutonAvis(NOTE_PAR_DEFAUT), 'Laisser un avis 5★ sur Google')
  })

  test('tap sur la 3e étoile → 3 étoiles sélectionnées, puis retour à 5', () => {
    const note = choisirNote(3)
    assert.equal(note, 3)
    assert.deepEqual(etoilesRemplies(note), [true, true, true, false, false])
    assert.equal(etoilesRemplies(note).filter(Boolean).length, 3)
    assert.equal(libelleBoutonAvis(note), 'Laisser un avis 3★ sur Google')
    assert.equal(etoilesRemplies(choisirNote(5)).filter(Boolean).length, 5)
  })

  test('note toujours entre 1 et 5', () => {
    assert.equal(choisirNote(1), 1)
    assert.equal(choisirNote(0), 1)
    assert.equal(choisirNote(9), 5)
    assert.equal(choisirNote(Number.NaN), 5)
  })

  test('le composant démarre à NOTE_PAR_DEFAUT et chaque étoile appelle choisirNote(i + 1)', () => {
    const code = source('components/InvitationAvis.tsx')
    assert.match(code, /useState\(NOTE_PAR_DEFAUT\)/)
    assert.match(code, /onClick=\{\(\) => onChange\(choisirNote\(i \+ 1\)\)\}/)
    assert.match(code, /etoilesRemplies\(note\)\.map/)
    assert.match(code, /role="radiogroup"/)
  })
})

describe('Lien Google direct, inchangé', () => {
  const asianHome = seed.commerces[0]

  test('Asian Home Paris : lien writereview avec son Place ID, sans paramètre ajouté', () => {
    const lien = lienAvisGoogle(asianHome)
    assert.equal(lien, `https://search.google.com/local/writereview?placeid=${PLACE_ID}`)
    assert.equal(lien, asianHome.lienGoogle, 'identique au lien du seed')
    assert.ok(lien!.includes(PLACE_ID))
    assert.deepEqual([...new URL(lien!).searchParams.keys()], ['placeid'], 'aucun paramètre de note inventé')
  })

  test('le lien ne dépend pas de la note choisie ; lien absent ou invalide → pas de bouton', () => {
    for (const n of [1, 3, 5]) assert.equal(lienAvisGoogle(asianHome), asianHome.lienGoogle, String(n))
    assert.equal(lienAvisGoogle({ lienGoogle: '' }), null)
    assert.equal(lienAvisGoogle({ lienGoogle: 'javascript:alert(1)' }), null)
    assert.equal(lienAvisGoogle({ lienGoogle: ' https://g.page/r/x/review ' }), 'https://g.page/r/x/review')
  })

  test('le bouton pointe exactement sur ce lien (href={lien}), sans construire d’URL', () => {
    const code = source('components/InvitationAvis.tsx')
    assert.match(code, /const lien = lienAvisGoogle\(commerce\)/)
    assert.match(code, /href=\{lien\}/)
    assert.doesNotMatch(code, /href=\{`/)
    assert.doesNotMatch(source('lib/invitationAvis.ts') + code, /[?&](rating|stars|note|etoiles)=/i)
  })
})

describe('Textes honnêtes et invitation partout', () => {
  test('aucun texte ne dit que les étoiles sont envoyées ou pré-remplies sur Google', () => {
    assert.equal(TEXTE_INVITATION, 'Votre avis compte — touchez une étoile pour ajuster, puis laissez votre avis sur Google.')
    assert.match(TEXTE_CONFIRMATION_GOOGLE, /sélectionnez-y vos étoiles/)
    const textes = source('lib/invitationAvis.ts') + source('components/InvitationAvis.tsx') + source('pages/Avis.tsx')
    assert.doesNotMatch(textes, /(étoiles|note)[^.]{0,40}(envoyée|transmise|déjà (cochée|remplie|sélectionnée)s? sur Google)/i)
    assert.doesNotMatch(textes, /Google (ouvrira|s’ouvrira|s'ouvrira) avec/i)
  })

  test('page de jeu et page Avis utilisent la même invitation ; jamais conditionnée au lot', () => {
    const jouer = source('pages/Jouer.tsx')
    assert.match(jouer, /import \{ InvitationAvis \} from '\.\.\/components\/InvitationAvis'/)
    // P1-C4 : message privé (note basse) et retour vers la carte branchés dans les deux modes.
    assert.equal(jouer.match(/<InvitationAvis commerce=\{commerce\} onMessagePrive=\{messagePrive\} lienCarte=\{carte\} \/>/g)?.length, 2, 'modes local et API')
    assert.doesNotMatch(jouer, /function InvitationAvis/)
    // Affichée après le résultat ou le tirage du jour, gagnant comme perdant.
    assert.match(jouer, /\(etape === 'resultat' \|\| dejaJoue\) && \(\s*<>\s*<InvitationAvis/)
    assert.match(jouer, /\(etape === 'resultat' \|\| jeu\?\.statut === 'dejaJoue'\) && \(\s*<>\s*<InvitationAvis/)
    assert.match(source('pages/Avis.tsx'), /<InvitationAvis commerce=\{commerce\} \/>/)
    assert.match(source('components/InvitationAvis.tsx'), /Le lot n’est pas conditionné à l’avis/)
  })
})

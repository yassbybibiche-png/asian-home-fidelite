// P2-4 — État des relances impossible à mal lire (écran Messages) : bandeau permanent en mode test, juste
// au-dessus des interrupteurs, et déclencheur réel (« à l'ouverture du tableau de bord ») dans la phrase de
// chaque relance automatique. Les .tsx ne sont pas importables par `node --test` : comportement vérifié sur
// la source, logique dans src/lib/integrations.ts.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { etatRelances } from '../src/lib/integrations.ts'

const source = (f: string) => readFileSync(join(import.meta.dirname, '..', f), 'utf8')
const messages = () => source('src/pages/Messages.tsx')
/** Bloc `<fieldset>…</fieldset>` des relances automatiques. */
const champRelancesAuto = () => {
  const s = messages()
  const debut = s.indexOf('<fieldset')
  const fin = s.indexOf('</fieldset>', debut)
  assert.ok(debut >= 0 && fin > debut, 'fieldset des relances automatiques introuvable')
  return s.slice(debut, fin)
}

describe('P2-4 : bandeau permanent en mode test', () => {
  test('le bandeau dit que rien ne part réellement, et ne s’affiche que si /sante dit modeTest', () => {
    const s = messages()
    assert.match(s, /Mode test : aucun SMS\/e-mail ne part réellement\./, 'formulation de l’audit')
    assert.match(s, /Les relances sont simulées \(e-mail en sandbox Brevo, SMS simulé\) et tracées « Test — rien envoyé » dans le journal\./)
    // Affichage conditionné à l’état réel lu sur /sante (jamais un texte en dur sans condition).
    assert.match(s, /\{statut\?\.modeTest && \(/, 'bandeau conditionné à statut.modeTest')
    assert.match(s, /modeTest: !!s\.integrations\?\.modeTest/, 'modeTest lu sur /sante')
    assert.match(s, /data-bandeau-mode-test/, 'repère stable pour l’E2E')
    assert.match(s, /role="status"/, 'bandeau annoncé aux lecteurs d’écran')
  })

  test('le bandeau est au-dessus des interrupteurs (avant le fieldset)', () => {
    const s = messages()
    const bandeau = s.indexOf('data-bandeau-mode-test')
    const fieldset = s.indexOf('<fieldset')
    assert.ok(bandeau >= 0 && fieldset > bandeau, 'bandeau avant le fieldset des interrupteurs')
  })

  test('la ligne détaillée « Mode test Brevo actif » reste dans la liste d’état (le bandeau est l’alerte, pas le détail)', () => {
    assert.match(etatRelances({ sms: true, email: true, migration: true, modeTest: true }).join('\n'), /Mode test Brevo actif : aucun SMS \/ e-mail réel ne part/)
    assert.doesNotMatch(etatRelances({ sms: true, email: true, migration: true }).join('\n'), /Mode test/)
  })
})

describe('P2-4 (audit 15/11, volet B) : un seul état, le vrai, par configuration', () => {
  test('configuration réelle observée (sms+email configurés, mode test) : plus aucun « envois réels possibles »', () => {
    const lignes = etatRelances({ sms: true, email: true, migration: true, modeTest: true })
    const tout = lignes.join('\n')
    assert.doesNotMatch(tout, /envois réels possibles/, 'la contradiction relevée par l’audit ne doit plus exister')
    assert.match(lignes[0], /SMS : Brevo configuré, mais mode test actif — aucun SMS réel n’est envoyé/)
    assert.match(lignes[1], /E-mail : Brevo configuré, mais mode test actif — aucun e-mail réel n’est envoyé/)
    assert.match(lignes[2], /Mode test Brevo actif : aucun SMS \/ e-mail réel ne part/)
    assert.equal(lignes.length, 3)
  })

  test('matrice des configurations : jamais « possibles » et « aucun ne part » en même temps', () => {
    for (const sms of [false, true])
      for (const email of [false, true])
        for (const modeTest of [false, true])
          for (const migration of [true, false]) {
            const tout = etatRelances({ sms, email, modeTest, migration }).join('\n')
            const possibles = tout.includes('envois réels possibles')
            const rienNePart = tout.includes('aucun SMS / e-mail réel ne part')
            assert.ok(!(possibles && rienNePart), `contradiction pour sms=${sms} email=${email} modeTest=${modeTest} migration=${migration}`)
            // « Envois réels possibles » seulement si le canal est branché ET hors mode test.
            if (modeTest) assert.ok(!possibles, `mode test : rien de « possible » (sms=${sms} email=${email})`)
            if (!sms) assert.match(tout, /aucun SMS n’est envoyé/)
            if (!email) assert.match(tout, /aucun e-mail n’est envoyé/)
            if (migration === false) assert.match(tout, /migration 0007 non appliquée/)
          }
  })

  test('hors mode test, canaux branchés : « envois réels possibles » reste dit, sans ligne mode test', () => {
    const lignes = etatRelances({ sms: true, email: true, migration: true, modeTest: false })
    assert.deepEqual(lignes, ['SMS : Brevo configuré — envois réels possibles.', 'E-mail : Brevo configuré — envois réels possibles.'])
  })

  test('configuration mixte en mode test : SMS en mode test, e-mail non branché — chaque ligne dit son vrai état', () => {
    const lignes = etatRelances({ sms: true, email: false, migration: true, modeTest: true })
    assert.match(lignes[0], /mode test actif — aucun SMS réel/)
    assert.match(lignes[1], /E-mail : non branché/)
  })
})

describe('P2-4 : déclencheur réel dans la phrase de chaque relance automatique', () => {
  test('chaque interrupteur dit « envoi à l’ouverture du tableau de bord, une fois par jour »', () => {
    const champ = champRelancesAuto()
    assert.equal(champ.match(/à l’ouverture du tableau de bord/g)?.length, 3, 'une mention par relance (inactif, anniversaire, gain expiré)')
    assert.equal(champ.match(/envoi à l’ouverture du tableau de bord, une fois par jour/g)?.length, 3)
    // Chaque libellé porte la mention dans sa propre phrase (pas seulement la légende du groupe).
    for (const label of [...champ.matchAll(/<span>([^<]*à l’ouverture du tableau de bord[^<]*)<\/span>/g)]) {
      assert.match(label[1], /« Vous nous manquez »|Message d’anniversaire|« Votre gain expire bientôt »/)
    }
  })

  test('la légende ne porte plus seule le déclencheur : elle nomme le groupe, les libellés portent le déclencheur', () => {
    const champ = champRelancesAuto()
    assert.match(champ, /<legend className="etiquette">Relances automatiques<\/legend>/)
    assert.doesNotMatch(champ, /Relances automatiques \(à l’ouverture du tableau de bord/)
  })

  test('les trois relances sont toujours là (inactif 30 jours, anniversaire, gain 72 h)', () => {
    const champ = champRelancesAuto()
    assert.match(champ, /inactifs depuis 30 jours/)
    assert.match(champ, /Message d’anniversaire \(si la date est renseignée\)/)
    assert.match(champ, /72 h avant son expiration \(une fois par gain\)/)
  })
})

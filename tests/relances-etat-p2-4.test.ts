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

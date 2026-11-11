// P0-D1 (correctif 404) — `GET /api/v1/commerces/<id-client>` → 404 à chaque transition
// #/jouer → #/carte (clic « Voir ma carte » après un gain), mesuré 5/5 passes par P0-U0.
// Cause : JouerApi se re-rend une fois avec le nouveau `param` (identifiant client) avant
// d'être démonté — les abonnements useRoute() d'App et de JouerApi ne se mettent pas à jour
// dans le même rendu. Correctif : JouerApi ne charge le commerce que si la page est 'jouer'.
// La preuve comportementale est le test E2E (tests-e2e/scan-gain-carte.spec.ts : aucune
// requête échouée sur le parcours complet) ; ce fichier verrouille la garde dans le source.
// Revue Codex P0-D1, point 5 : une réponse arrivée après jouer/A → jouer/B ne doit pas
// écraser le commerce B (demandeEnCours), et l'ancien commerce ne reste pas affiché pendant
// le chargement du nouveau.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')

describe('P0-D1 : plus de 404 jouer → carte', () => {
  const jouer = lire('src/pages/Jouer.tsx')

  test('JouerApi lit la page courante, pas seulement le paramètre', () => {
    assert.match(jouer, /function JouerApi\(\{ api \}: \{ api: ClientApi \}\) \{\n  const \{ page, param \} = useRoute\(\)/)
  })

  test('le chargement du commerce est gardé par page === \'jouer\' (retour silencieux sinon)', () => {
    const corps = jouer.slice(jouer.indexOf('function JouerApi'))
    const charger = corps.slice(0, corps.indexOf('useEffect(charger'))
    assert.match(charger, /if \(page !== 'jouer'\) return/)
    // La garde précède tout appel réseau : aucun api.commerce avant elle dans charger.
    assert.ok(charger.indexOf("if (page !== 'jouer') return") < charger.indexOf('api.commerce(demande)'))
  })

  test('un seul appel api.commerce(demande) dans Jouer.tsx, dans charger uniquement', () => {
    assert.equal(jouer.split('api.commerce(').length - 1, 1)
  })

  test('réponse obsolète ignorée : demandeEnCours comparé avant setCommerce/setErreur', () => {
    const corps = jouer.slice(jouer.indexOf('function JouerApi'))
    const charger = corps.slice(0, corps.indexOf('useEffect(charger'))
    assert.match(charger, /demandeEnCours\.current = demande/)
    assert.match(charger, /if \(demandeEnCours\.current === demande\) setCommerce\(c\)/)
    assert.match(charger, /if \(demandeEnCours\.current === demande\) setErreur\(/)
  })

  test('changement de commerce : l’ancien n’est plus affiché pendant le chargement du nouveau', () => {
    const corps = jouer.slice(jouer.indexOf('function JouerApi'))
    const charger = corps.slice(0, corps.indexOf('useEffect(charger'))
    assert.match(charger, /if \(demandeEnCours\.current !== param\) setCommerce\(null\)/)
  })
})

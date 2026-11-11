// P1-B3 — côté écrans : case de consentement (jamais pré-cochée, envoyée seulement si cochée), retrait sur la fiche,
// journal des envois dans Messages, page #/desinscription, textes honnêtes (rien ne part sans prestataire configuré).
// Les .tsx ne sont pas importables par `node --test` : comportement vérifié sur la source, logique dans src/lib.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { creerClientApi } from '../src/data/api.ts'
import { etatRelances, MENTION_ENVOI, MENTIONS_RGPD } from '../src/lib/integrations.ts'
import { libelleStatutEnvoi } from '../src/lib/relances.ts'
import { lireRoute, PAGES_PUBLIQUES } from '../src/router.ts'

const source = (f: string) => readFileSync(join(import.meta.dirname, '..', f), 'utf8')

/** Faux fetch : garde les corps envoyés, répond 201. */
function fauxFetch() {
  const corps: unknown[] = []
  const f = (async (_url: string, init?: RequestInit) => {
    corps.push(init?.body ? JSON.parse(String(init.body)) : undefined)
    return new Response(JSON.stringify({ client: { id: 'cl-1', prenom: 'Marie' }, existant: false, ok: true, commerce: 'Asian Home' }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  return { f, corps }
}

describe('Consentement : case non pré-cochée, envoyée seulement si cochée', () => {
  test('client API : `consentementRelance` absent par défaut, `true` seulement si la case est cochée (public et caisse)', async () => {
    const { f, corps } = fauxFetch()
    const api = creerClientApi('/api/v1', f)
    await api.inscrirePublic('c-1', 'Marie', '0612345678')
    await api.inscrirePublic('c-1', 'Marie', '0612345678', undefined, false)
    await api.inscrirePublic('c-1', 'Marie', '0612345678', undefined, true)
    const acces = { role: 'commercant', commerceId: 'c-1', pin: '1234' } as unknown as Parameters<typeof api.inscrire>[1]
    await api.inscrire('c-1', acces, 'Marie', '0612345678')
    await api.inscrire('c-1', acces, 'Marie', '0612345678', undefined, true)
    assert.deepEqual(
      corps.map((c) => (c as Record<string, unknown>).consentementRelance),
      [undefined, undefined, true, undefined, true],
    )
  })

  test('page de jeu et inscription en caisse : une case à cocher, état initial `false`, transmise à l’inscription', () => {
    for (const f of ['src/pages/Jouer.tsx', 'src/pages/Clients.tsx']) {
      const s = source(f)
      assert.match(s, /const \[consentement, setConsentement\] = useState\(false\)/, `${f} : case non pré-cochée`)
      assert.match(s, /type="checkbox"[^>]*checked=\{consentement\}/, `${f} : case liée à l’état`)
      assert.doesNotMatch(s, /defaultChecked/, `${f} : jamais pré-cochée`)
      assert.match(s, /SMS ou e-mail \(désinscription à tout moment\)/, `${f} : une ligne claire`)
    }
    const jouer = source('src/pages/Jouer.tsx')
    // P1-C1 : le prénom n'est plus demandé avant le tirage → inscription avec un prénom vide.
    assert.match(jouer, /inscrireClient\(commerce\.id, '', contactSaisi, consentementRelance\)/)
    assert.match(jouer, /api\.inscrirePublic\(commerce\.id, '', contactSaisi, parrain, consentementRelance\)/)
    assert.match(source('src/pages/Clients.tsx'), /inscrireClient\(commerce\.id, prenom, contactSaisi, consentement\)/)
  })

  test('fiche client : poser / retirer le consentement (confirmation), relance par modèle, envois du client', () => {
    const s = source('src/pages/FicheClient.tsx')
    assert.match(s, /api\.majClient\(commerce\.id, a, client\.id, \{ consentementRelance: valeur \}\)/)
    assert.match(s, /Retirer le consentement/)
    // P1-C7 : plus de window.confirm — la demande passe par la modale <Confirmation> (récapitulatif « consentement »),
    // branchée sur changerConsentement dans le composant Relances (pas seulement « quelque part » dans le fichier).
    assert.doesNotMatch(s, /window\.confirm/)
    assert.match(s, /setDemande\(\{ type: 'consentement', valeur: !consenti \}\)/)
    const relances = s.slice(s.indexOf('function Relances('), s.indexOf('function Rattrapages('))
    assert.match(relances, /<Confirmation recap=\{recapitulatif\(demande, client, commerce\)\} enCours=\{enCours\} onConfirmer=\{\(\) => void changerConsentement\(\)\}/)
    assert.match(relances, /async function changerConsentement\(\) \{/)
    const changer = relances.slice(relances.indexOf('async function changerConsentement()'), relances.indexOf('async function relancer()'))
    assert.ok(changer.indexOf('const d = demande') < changer.indexOf('api.majClient('), 'majClient seulement après lecture de la demande confirmée')
    assert.equal(relances.match(/api\.majClient\(/g)?.length, 1, 'un seul appel majClient dans Relances')
    assert.match(s, /api\.relancer\(commerce\.id, a, client\.id, \{ modele \}\)/)
    assert.match(s, /<JournalEnvois envois=\{duClient\}/)
    // Mode test : l'annonce dit explicitement que rien n'a été envoyé.
    assert.match(s, /Mode test — rien envoyé/)
    // La relance n'est proposée qu'avec consentement et un contact.
    assert.match(s, /\{consenti && canal && \(/)
  })
})

describe('Journal des envois (écran Messages)', () => {
  test('qui / quand / modèle / canal / statut affichés ; état des prestataires lu sur /sante', () => {
    const s = source('src/pages/Messages.tsx')
    for (const m of [/e\.clientPrenom/, /dateRelative\(e\.date\)/, /libelleModele\(e\.modele\)/, /e\.canal === 'sms'/, /libelleStatutEnvoi\(e\.statut\)/]) assert.match(s, m)
    assert.match(s, /api\.sante\(\)/)
    assert.match(s, /etatRelances\(statut\)/)
    assert.match(s, /relancesAuto: \{ \.\.\.regles, \[cle\]: valeur \}/)
  })

  test('statuts : seul « envoyé » dit qu’un message est parti', () => {
    assert.equal(libelleStatutEnvoi('envoye'), 'Envoyé')
    for (const s of ['refuse', 'erreur', 'non_branche'] as const) assert.match(libelleStatutEnvoi(s), /rien envoyé|non envoyé/)
    assert.match(libelleStatutEnvoi('non_branche'), /501/)
    assert.match(libelleStatutEnvoi('en_cours'), /non confirmé/)
  })
})

describe('Textes honnêtes : rien ne part sans prestataire configuré', () => {
  test('état des relances selon /sante', () => {
    assert.deepEqual(etatRelances({ sms: false, email: false, migration: true }), [
      'SMS : non branché (Brevo non configuré — Twilio accepté en repli) — aucun SMS n’est envoyé.',
      'E-mail : non branché (Brevo non configuré) — aucun e-mail n’est envoyé.',
    ])
    assert.match(etatRelances({ sms: true, email: false, migration: true })[0], /Brevo configuré/)
    assert.match(etatRelances({ sms: true, email: true, migration: false }).at(-1)!, /migration 0007 non appliquée/)
    assert.match(etatRelances(null)[0], /inconnu/)
    // Mode test : ligne explicite, aucun envoi réel possible.
    assert.match(etatRelances({ sms: true, email: true, migration: true, modeTest: true }).at(-1)!, /Mode test Brevo actif/)
    assert.equal(libelleStatutEnvoi('test'), 'Test — rien envoyé')
  })

  test('mentions : consentement, STOP, lien e-mail ; plus de « aucun écran ne le recueille »', () => {
    assert.match(MENTION_ENVOI, /consenti/)
    const rgpd = MENTIONS_RGPD.join(' ')
    assert.match(rgpd, /case non pré-cochée/)
    assert.match(rgpd, /STOP/)
    assert.match(rgpd, /Aucun envoi tant qu’aucun prestataire n’est configuré/)
    assert.doesNotMatch(source('src/types.ts'), /Aucun écran ne le recueille/)
    const readme = source('server/README.md')
    assert.doesNotMatch(readme, /aucun écran ne le recueille encore/)
    assert.doesNotMatch(readme, /relance` \| commerçant \| \*\*V3, à brancher/)
  })
})

describe('Page #/desinscription/<clientId>/<jeton>', () => {
  test('route publique à deux paramètres, page reliée à l’API, retrait seulement au clic', () => {
    assert.ok(PAGES_PUBLIQUES.includes('desinscription'))
    assert.deepEqual(lireRoute('#/desinscription/cl-abc/JETON_x-1'), { page: 'desinscription', param: 'cl-abc', param2: 'JETON_x-1' })
    assert.deepEqual(lireRoute('#/client/cl-abc'), { page: 'client', param: 'cl-abc' })
    assert.match(source('src/App.tsx'), /desinscription: Desinscription/)
    const page = source('src/pages/Desinscription.tsx')
    assert.match(page, /api!\.desinscrire\(clientId!, jeton!\)/)
    assert.match(page, /onClick=\{\(\) => void confirmer\(\)\}/)
    assert.doesNotMatch(page, /useEffect/, 'aucun retrait automatique à l’ouverture du lien')
  })

  test('le client API appelle la route publique du serveur', async () => {
    const urls: string[] = []
    const f = (async (url: string) => {
      urls.push(url)
      return new Response(JSON.stringify({ ok: true, commerce: 'Asian Home' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
    const r = await creerClientApi('/api/v1', f).desinscrire('cl-1', 'abc')
    assert.deepEqual(r, { ok: true, commerce: 'Asian Home' })
    assert.match(urls[0], /\/api\/v1\/desinscription\/cl-1\/abc$/)
  })
})

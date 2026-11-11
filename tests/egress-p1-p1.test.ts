// P1-P1 — Egress / polling : mesure locale + non-régression du rechargement.
// Le rechargement périodique du store télécharge tout l'état (`GET /commerces` + `GET /etat` pour chaque commerce
// accessible) : à 10 s, la projection dépassait les 5 Go/mois gratuits de Supabase (voir le test de mesure ci-dessous).
// Le lot passe l'intervalle à 30 s (rechargement sur action, au retour au premier plan et au retour du réseau
// conservés) ; la roue garde sa propre vérification espacée de 10 s (`INTERVALLE_VERIFICATION_MS`, attenteVisite.ts).
//
// Deux mesures, en vrais octets UTF-8 (`arrayBuffer().byteLength` — pas la longueur de chaîne UTF-16) :
// - HTTP (Node → navigateur) : ce que le store télécharge à chaque rechargement ;
// - PostgREST (Supabase → Node) : ce que le serveur lit en base pour servir `/etat`, reconstruit depuis les lignes
//   stockées avec les colonnes exactes sélectionnées dans `server/stockage-supabase.ts` (`commerces` et `clients` :
//   `id,version,donnees` ; `tirages`, `avis`, `journal`, `envois` : `donnees`). C'est un proxy de l'egress Supabase,
//   pas la mesure du dashboard : gzip, en-têtes et autres lectures (sessions, `/cartes`, tirages…) ne sont pas
//   comptés, et un 2e onglet double le rechargement périodique.
// Mesure Supabase réelle (dashboard) : NON MESURÉE ici — pas d'accès navigateur à cette VM. Le chiffre exact reste
// à lire dans le dashboard (Database → Usage / ou Settings → Usage) par l'agent parent.
// Aucun appel réseau réel : serveur local + base SQLite temporaire.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'

import { creerServeur } from '../server/app.ts'
import { ouvrirStockage } from '../server/stockage.ts'
import { appliquerInscription } from '../src/lib/programme.ts'
import { nouveauClient } from '../src/lib/fidelite.ts'
import type { EntreeJournal } from '../src/types.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')
const octets = (s: string) => Buffer.byteLength(s, 'utf8')

const AH = 'c-asian-home-paris'
const PIN = { 'X-Commerce-PIN': '1234' }
const dossier = mkdtempSync(join(tmpdir(), 'fidelite-p1-p1-'))
after(() => rmSync(dossier, { recursive: true, force: true }))

/** Hypothèse de l'AUDIT (étape 0) : onglet marchand visible 12 h/j, 30 jours par mois, UN seul onglet. */
const HEURES_VISIBLES_PAR_JOUR = 12
const JOURS_PAR_MOIS = 30
const PLAFOND_EGRESS_OCTETS = 5_000_000_000
const polls = (intervalleS: number) => (HEURES_VISIBLES_PAR_JOUR * 3600 * JOURS_PAR_MOIS) / intervalleS

describe('P1-P1 : intervalle de rechargement 30 s (non-régression)', () => {
  test('store : intervalle 30 s, minuterie + rechargements sur événement et après action conservés', () => {
    const store = lire('src/store.tsx')
    assert.match(store, /export const INTERVALLE_RECHARGEMENT_MS = 30_000/)
    assert.doesNotMatch(store, /INTERVALLE_RECHARGEMENT_MS = 10_000/)
    assert.match(store, /window\.setInterval\(siVisible, INTERVALLE_RECHARGEMENT_MS\)/)
    assert.match(store, /document\.addEventListener\('visibilitychange', siVisible\)/)
    assert.match(store, /window\.addEventListener\('focus', siVisible\)/)
    assert.match(store, /window\.addEventListener\('online', siVisible\)/)
    // Après chaque action réussie, l'état est rechargé (le serveur fait foi) — le 30 s n'est que la cadence de fond.
    assert.match(store, /Toute action passe par le serveur avec le PIN, puis l'état est rechargé/)
    assert.match(store, /const r = await f\(a\)\n\s+await recharger\(\)/)
  })

  test('roue : la vérification d’attente reste espacée de 10 s après réponse (déblocage inchangé par le lot)', () => {
    const attente = lire('src/lib/attenteVisite.ts')
    assert.match(attente, /export const INTERVALLE_VERIFICATION_MS = 10_000/)
    assert.match(attente, /export const INTERVALLE_MAX_MS = 60_000/)
  })
})

describe('P1-P1 : mesure locale de l’egress projeté', () => {
  test('150 clients, 100 visites, journal 100 entrées : projections HTTP et PostgREST à 30 s < 5 Go/mois', async () => {
    const fichierDb = join(dossier, 'egress.db')
    const horloge = { t: new Date(2026, 10, 9, 12, 0) }
    const app = await creerServeur({ fichierDb, adminPin: '98765432', pinInitial: '1234', version: 'test', maintenant: () => horloge.t })
    try {
      await new Promise<void>((ok) => app.serveur.listen(0, '127.0.0.1', ok))
      const base = `http://127.0.0.1:${(app.serveur.address() as AddressInfo).port}/api/v1`
      // Ensemencement direct en base (rapide, sans 150 allers-retours HTTP) : clients comme après inscription.
      const st = ouvrirStockage(fichierDb)
      const commerce = st.commerce(AH)!
      const ensemencer = (jusqua: number) => {
        for (let i = st.clients(AH).length; i < jusqua; i++) {
          const jour = new Date(2026, 10, 9 + (i % 10), 12, 0)
          let c = appliquerInscription(nouveauClient(AH, `Client${i}`, { telephone: `06${String(10000000 + i).padStart(8, '0')}` }, jour), commerce)
          if (i < 100) c = { ...c, tampons: 1, visites: [jour.toISOString()], derniereVisite: jour.toISOString() }
          st.ajouterClient(c)
        }
        for (let j = st.journal(AH, 1000).length; j < 100; j++) {
          const jour = new Date(2026, 10, 9 + (j % 10), 12, 0)
          const e: EntreeJournal = {
            id: `jr-mes-${j}`,
            commerceId: AH,
            date: jour.toISOString(),
            action: 'passage',
            auteur: { type: 'membre', nom: 'Mai' },
            clientId: 'x',
            clientPrenom: 'Client',
            details: `+1 tampon (1/10) · ${'x'.repeat(40)}`,
          }
          st.ajouterJournal(e)
        }
      }
      // Octets PostgREST pour UN rechargement /etat : lignes lues avec les colonnes sélectionnées par le serveur.
      const octetsPostgrest = () => {
        const lignes = {
          commerces: [{ id: commerce.id, version: 1, donnees: commerce }],
          clients: st.clients(AH).map((c) => ({ id: c.id, version: 1, donnees: c })),
          tirages: st.tirages(AH).map((t) => ({ donnees: t })),
          avis: st.avis(AH).map((a) => ({ donnees: a })),
          journal: st.journal(AH, 200).map((e) => ({ donnees: e })),
          envois: [],
        }
        return Object.values(lignes).reduce((n, rows) => n + octets(JSON.stringify(rows)), 0)
      }
      const tailleHttp = async (chemin: string, entetes: Record<string, string> = {}) => {
        const r = await fetch(base + chemin, { headers: entetes })
        assert.equal(r.status, 200, chemin)
        return (await r.arrayBuffer()).byteLength
      }
      // Mesure à deux volumes (150 puis 300 clients) : la pente, pas un seul échantillon, dit où passe le seuil 5 Go.
      const mesurer = async (n: number) => {
        ensemencer(n)
        const http = (await tailleHttp(`/commerces/${AH}/etat`, PIN)) + (await tailleHttp('/commerces'))
        return { http, postgrest: octetsPostgrest() }
      }
      const m150 = await mesurer(150)
      const m300 = await mesurer(300)
      st.fermer()

      // Garde-fous : le rechargement reste dans le même ordre de grandeur (sinon, re-mesurer et mettre à jour l'AUDIT).
      assert.ok(m150.http > 10_000 && m150.http < 100_000, `rechargement 150 clients : ${m150.http} o`)
      assert.ok(m150.postgrest > m150.http, 'PostgREST (enveloppes) ≥ HTTP servi')
      assert.ok(m300.http > m150.http && m300.postgrest > m150.postgrest, 'la taille croît avec le nombre de clients')
      const projection = (parRechargement: number) => (polls(30) * parRechargement) / 1e9
      assert.ok(
        projection(m150.http) < 5 && projection(m150.postgrest) < 5,
        `projection 30 s, 150 clients : HTTP ${projection(m150.http).toFixed(2)} Go/mois, PostgREST ${projection(m150.postgrest).toFixed(2)} Go/mois (≥ 5 Go attendus sous le plafond)`,
      )
      assert.ok(projection(m150.http) * 3 > 5, 'à 10 s, la même mesure dépassait 5 Go : le 30 s divise bien par 3')
      // Échelle (documentée dans l'AUDIT, pas assertée comme un plafond) : pente PostgREST entre les deux volumes.
      const pente = (m300.postgrest - m150.postgrest) / 150
      assert.ok(pente > 0, `pente PostgREST par client : ${pente.toFixed(0)} o`)
    } finally {
      await app.fermer()
    }
  })
})

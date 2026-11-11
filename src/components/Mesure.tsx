// Tableau de bord — mesure (P2-Q3) : coût des lots, séries, comparaison au mois précédent, entonnoir anonyme, test A/B,
// export CSV. Toute la logique est dans `src/lib/mesure.ts` (testée) ; ce fichier ne fait qu'afficher.
import { useEffect, useMemo, useState } from 'react'
import { useDonneesCommerce, useStore } from '../store'
import type { CompteurEvenement } from '../types'
import {
  ajouterJours,
  comparaisonMoisPrecedent,
  coutsParLot,
  DEFINITION_DISTRIBUE,
  DEFINITION_GAGNE,
  entonnoir,
  finPeriode,
  formaterEuros,
  JOURS_RETOUR,
  jourParis,
  libellePeriode,
  MIN_SCANS_VARIANTE,
  nomFichierMesures,
  resultatsAccroche,
  retourApresGain,
  serie,
  serieEnCsv,
  tauxParticipation,
  texteVariation,
  totaux,
  debutPeriode,
  type Granularite,
  type PointSerie,
  type Totaux,
} from '../lib/mesure'
import { telecharger, Vide } from './ui'

const GRANULARITES: { valeur: Granularite; libelle: string; courante: string }[] = [
  { valeur: 'jour', libelle: 'Jour', courante: 'Aujourd’hui' },
  { valeur: 'semaine', libelle: 'Semaine', courante: 'Cette semaine' },
  { valeur: 'mois', libelle: 'Mois', courante: 'Ce mois-ci' },
]

type Etat = { compteurs: CompteurEvenement[]; migration: boolean } | 'local' | 'erreur' | null

/** Compteurs anonymes du serveur (lecture seule : appel direct, pas `avecPin` qui rechargerait tout l'état). */
function useCompteurs(): Etat {
  const { mode, api, acces, commerce } = useStore()
  const [etat, setEtat] = useState<Etat>(null)
  useEffect(() => {
    if (mode !== 'api' || !api || !acces) return setEtat('local')
    let actif = true
    api.mesures(commerce.id, acces).then(
      (r) => actif && setEtat({ compteurs: r.compteurs, migration: r.migration }),
      () => actif && setEtat('erreur'),
    )
    return () => {
      actif = false
    }
  }, [mode, api, acces, commerce.id])
  return mode !== 'api' ? 'local' : etat
}

/** Une série en barres verticales (une seule couleur : une seule mesure par graphique, pas de légende nécessaire). */
function Barres({ titre, points, valeur, format }: { titre: string; points: PointSerie[]; valeur: (p: PointSerie) => number; format: (n: number) => string }) {
  const max = Math.max(0, ...points.map(valeur))
  const total = points.reduce((s, p) => s + valeur(p), 0)
  const dernier = points.at(-1)
  return (
    <figure className="carte">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="surtitre">{titre}</span>
        <span className="text-sm text-gray-600 tabular-nums">total {format(total)}</span>
      </figcaption>
      <div
        className="mt-2 flex h-24 items-end gap-0.5 border-b border-gray-200"
        role="img"
        aria-label={`${titre} : total ${format(total)}, maximum ${format(max)}${dernier ? `, période en cours ${format(valeur(dernier))}` : ''}`}
      >
        {points.map((p) => {
          const v = valeur(p)
          const pct = max ? Math.max(v ? 4 : 0, Math.round((v / max) * 100)) : 0
          return (
            <div key={p.debut} className="group relative flex h-full min-w-0 flex-1 items-end" title={`${p.libelle} : ${format(v)}`}>
              <div className="w-full rounded-t bg-magenta-500 group-last:bg-magenta-700" style={{ height: `${pct}%` }} />
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex justify-between text-sm text-gray-600">
        <span>{points[0]?.libelle}</span>
        <span>{dernier?.libelle}</span>
      </div>
    </figure>
  )
}

function LigneComparaison({ libelle, courant, precedent, format = String }: { libelle: string; courant: number; precedent: number; format?: (n: number) => string }) {
  return (
    <tr>
      <th scope="row" className="py-1.5 pr-2 text-left font-medium">
        {libelle}
      </th>
      <td className="px-2 text-right tabular-nums">{format(courant)}</td>
      <td className="px-2 text-right text-gray-600 tabular-nums">{format(precedent)}</td>
      <td className="pl-2 text-right font-semibold tabular-nums">{texteVariation(courant, precedent)}</td>
    </tr>
  )
}

const pct = (n: number | null) => (n === null ? '—' : `${n} %`)
const nombre = (n: number) => n.toLocaleString('fr-FR')

export function Mesure() {
  const { commerce, clients, tirages } = useDonneesCommerce()
  const etat = useCompteurs()
  const [g, setG] = useState<Granularite>('jour')
  const aujourdhui = jourParis(new Date())
  const compteurs = useMemo(() => (etat && typeof etat === 'object' ? etat.compteurs : []), [etat])
  const donnees = useMemo(() => ({ clients, tirages, lots: commerce.lots, compteurs }), [clients, tirages, commerce.lots, compteurs])
  const points = useMemo(() => serie(donnees, g, aujourdhui), [donnees, g, aujourdhui])
  const comparaison = useMemo(() => comparaisonMoisPrecedent(donnees, aujourdhui), [donnees, aujourdhui])
  const debut = debutPeriode(aujourdhui, g)
  const courant: Totaux = points.at(-1) ?? totaux(donnees, debut, aujourdhui)
  const lots = coutsParLot(tirages, commerce.lots, debut, aujourdhui)
  const etapes = entonnoir(courant)
  // Retour après gain : gains d'il y a 30 à 120 jours (fenêtre de 30 jours close).
  const retour = retourApresGain(clients, tirages, ajouterJours(aujourdhui, -(JOURS_RETOUR + 90)), aujourdhui, aujourdhui)
  const ab = resultatsAccroche(compteurs, commerce.testsAB?.accroche, aujourdhui)
  const libelleCourant = GRANULARITES.find((x) => x.valeur === g)!.courante
  const { precedent } = comparaison
  const c = comparaison.courant.totaux
  const p = precedent.totaux
  const intervalle = (d: string, f: string) => `${Number(d.slice(8))}–${libellePeriode(f, 'jour').replace(/^\S+ /, '')}`

  return (
    <section className="space-y-4" aria-labelledby="titre-mesure">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="titre-mesure" className="titre-carte">
          Mesure
        </h2>
        <div className="flex gap-2">
          <div className="flex rounded-xl bg-white p-1 ring-1 ring-gray-200" role="group" aria-label="Regrouper par">
            {GRANULARITES.map((x) => (
              <button
                key={x.valeur}
                type="button"
                aria-pressed={g === x.valeur}
                className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${g === x.valeur ? 'bg-magenta-600 text-white' : 'text-gray-700'}`}
                onClick={() => setG(x.valeur)}
              >
                {x.libelle}
              </button>
            ))}
          </div>
          <button type="button" className="bouton-secondaire min-h-11 px-3 text-sm" onClick={() => telecharger(nomFichierMesures(commerce.id, g, aujourdhui), serieEnCsv(points, g))}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Barres titre={`Visites par ${g}`} points={points} valeur={(x) => x.visites} format={nombre} />
        <Barres titre={`Tirages par ${g}`} points={points} valeur={(x) => x.tirages} format={nombre} />
        <Barres titre={`Gains par ${g}`} points={points} valeur={(x) => x.gains} format={nombre} />
        <Barres titre={`Coût distribué par ${g}`} points={points} valeur={(x) => x.coutDistribues} format={formaterEuros} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="carte">
          <h3 className="surtitre">Coût des lots · {libelleCourant.toLowerCase()}</h3>
          <p className="mt-1 text-3xl font-extrabold tracking-tight tabular-nums">{formaterEuros(courant.coutDistribues)}</p>
          <p className="text-sm text-gray-600">
            distribués ({courant.distribues}) · gagnés ({courant.gains}) : {formaterEuros(courant.coutGagnes)}
          </p>
          {lots.length === 0 ? (
            <p className="mt-2 text-gray-600">Aucun lot gagné sur la période.</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead className="text-gray-600">
                <tr>
                  <th scope="col" className="py-1 text-left font-medium">
                    Lot
                  </th>
                  <th scope="col" className="text-right font-medium">
                    Unité
                  </th>
                  <th scope="col" className="text-right font-medium">
                    Gagnés
                  </th>
                  <th scope="col" className="text-right font-medium">
                    Distribués
                  </th>
                  <th scope="col" className="text-right font-medium">
                    Coût distribué
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lots.map((l) => (
                  <tr key={l.lot}>
                    <th scope="row" className="py-1.5 pr-2 text-left font-medium">
                      {l.lot}
                    </th>
                    <td className="text-right tabular-nums">{l.coutUnitaire === null ? 'non renseigné' : formaterEuros(l.coutUnitaire)}</td>
                    <td className="text-right tabular-nums">{l.gagnes}</td>
                    <td className="text-right tabular-nums">{l.distribues}</td>
                    <td className="text-right tabular-nums">{formaterEuros(l.coutDistribues)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {courant.gainsSansCout > 0 && (
            <p className="mt-2 text-sm text-amber-800">
              {courant.gainsSansCout} gain{courant.gainsSansCout > 1 ? 's' : ''} sans coût renseigné : le total est un minimum. Renseignez le coût de chaque lot dans{' '}
              <a href="#/reglages" className="lien">
                Réglages
              </a>
              .
            </p>
          )}
          <p className="mt-2 text-sm text-gray-600">
            {DEFINITION_GAGNE} {DEFINITION_DISTRIBUE} Coût unitaire actuel appliqué à tout l’historique.
          </p>
        </div>

        <div className="carte">
          <h3 className="surtitre">Ce mois-ci vs le mois précédent (à date)</h3>
          <table className="mt-2 w-full text-sm">
            <thead className="text-gray-600">
              <tr>
                <th scope="col" className="py-1 text-left font-medium">
                  Indicateur
                </th>
                <th scope="col" className="px-2 text-right font-medium">
                  {intervalle(comparaison.courant.debut, comparaison.courant.fin)}
                </th>
                <th scope="col" className="px-2 text-right font-medium">
                  {intervalle(precedent.debut, precedent.fin)}
                </th>
                <th scope="col" className="pl-2 text-right font-medium">
                  Écart
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <LigneComparaison libelle="Visites" courant={c.visites} precedent={p.visites} />
              <LigneComparaison libelle="Tirages" courant={c.tirages} precedent={p.tirages} />
              <LigneComparaison libelle="Gains" courant={c.gains} precedent={p.gains} />
              <LigneComparaison libelle="Lots distribués" courant={c.distribues} precedent={p.distribues} />
              <LigneComparaison libelle="Coût distribué" courant={c.coutDistribues} precedent={p.coutDistribues} format={formaterEuros} />
              <LigneComparaison libelle="Pages de jeu ouvertes" courant={c.evenements.scan} precedent={p.evenements.scan} />
              <LigneComparaison libelle="Clics vers Google" courant={c.evenements.clicGoogle} precedent={p.evenements.clicGoogle} />
            </tbody>
          </table>
          <p className="mt-2 text-sm text-gray-600">Même nombre de jours de part et d’autre : du 1er à aujourd’hui, contre du 1er au même jour du mois précédent.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="carte">
          <h3 className="surtitre">Entonnoir anonyme · {libelleCourant.toLowerCase()}</h3>
          {etat === 'local' ? (
            <p className="mt-2 text-gray-600">Disponible avec le serveur : la démo locale ne compte pas les pages ouvertes ni les clics.</p>
          ) : etat === 'erreur' ? (
            <p className="mt-2 text-gray-600">Compteurs indisponibles pour le moment (serveur injoignable).</p>
          ) : etat === null ? (
            <p className="mt-2 text-gray-600">Chargement des compteurs…</p>
          ) : !etat.migration ? (
            <p className="mt-2 text-gray-600">Pas encore activé : la migration 0008 (compteurs anonymes) est à appliquer sur la base. Le jeu fonctionne sans.</p>
          ) : (
            <ol className="mt-2 space-y-2">
              {etapes.map((e) => (
                <li key={e.cle} className="flex items-baseline justify-between gap-3">
                  <span>{e.libelle}</span>
                  <span className="shrink-0 tabular-nums">
                    <strong>{nombre(e.n)}</strong>
                    {e.tauxEtape !== null && <span className="text-gray-600"> · {e.tauxEtape} %</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <dl className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt>Participation (tirages / visites validées)</dt>
              <dd className="font-semibold tabular-nums">{pct(tauxParticipation(courant))}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>
                Retour après gain ({JOURS_RETOUR} j) · {retour.gains} gain{retour.gains > 1 ? 's' : ''} de 30 à 120 jours
              </dt>
              <dd className="font-semibold tabular-nums">{pct(retour.taux)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-sm text-gray-600">
            Compteurs sans aucune identité (un nombre par jour). Retour après gain : part des gagnants revenus faire valider une visite dans les {JOURS_RETOUR} jours suivant leur gain (jour du gain exclu).
          </p>
        </div>

        <div className="carte">
          <h3 className="surtitre">Test A/B · phrase d’accroche</h3>
          {!ab ? (
            <Vide>Aucun test en cours. Activez-le dans Réglages → Lots de la roulette (protocole : docs/TESTS-AB.md).</Vide>
          ) : (
            <>
              <p className="mt-1 text-sm text-gray-600">
                Du {libellePeriode(ab.depuis, 'jour')} au {libellePeriode(ab.jusqua, 'jour')}
                {commerce.testsAB?.accroche?.actif ? ' (en cours)' : ' (arrêté)'} · A = « gagnez un cadeau », B = cite un lot, un jour sur deux.
              </p>
              <table className="mt-2 w-full text-sm">
                <thead className="text-gray-600">
                  <tr>
                    <th scope="col" className="py-1 text-left font-medium">
                      Variante
                    </th>
                    <th scope="col" className="text-right font-medium">
                      Jours
                    </th>
                    <th scope="col" className="text-right font-medium">
                      Pages ouvertes
                    </th>
                    <th scope="col" className="text-right font-medium">
                      Tirages
                    </th>
                    <th scope="col" className="text-right font-medium">
                      Taux
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(['A', 'B'] as const).map((v) => (
                    <tr key={v}>
                      <th scope="row" className="py-1.5 text-left font-medium">
                        {v}
                      </th>
                      <td className="text-right tabular-nums">{ab[v].jours}</td>
                      <td className="text-right tabular-nums">{ab[v].scans}</td>
                      <td className="text-right tabular-nums">{ab[v].tirages}</td>
                      <td className="text-right tabular-nums">{pct(ab[v].taux)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-sm text-gray-600">
                {!ab.assezDeDonnees
                  ? `Pas encore assez de données pour conclure (au moins ${MIN_SCANS_VARIANTE} pages ouvertes par variante).`
                  : ab.significatif
                    ? 'Écart significatif (seuil 95 %) : la variante au meilleur taux peut être gardée.'
                    : 'Pas d’écart significatif (seuil 95 %) : les deux phrases se valent pour l’instant.'}
              </p>
            </>
          )}
        </div>
      </div>

      <details className="carte">
        <summary className="cursor-pointer font-semibold">Tableau des chiffres par {g}</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-gray-600">
              <tr>
                {['Période', 'Visites', 'Tirages', 'Gains', 'Distribués', 'Coût distribué', 'Pages ouvertes', 'Clics Google'].map((h) => (
                  <th key={h} scope="col" className="py-1 pr-2 text-right font-medium first:text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[...points].reverse().map((x) => (
                <tr key={x.debut}>
                  <th scope="row" className="py-1 pr-2 text-left font-medium">
                    {x.libelle}
                    {x.fin !== finPeriode(x.debut, g) && ' (en cours)'}
                  </th>
                  <td className="pr-2 text-right tabular-nums">{x.visites}</td>
                  <td className="pr-2 text-right tabular-nums">{x.tirages}</td>
                  <td className="pr-2 text-right tabular-nums">{x.gains}</td>
                  <td className="pr-2 text-right tabular-nums">{x.distribues}</td>
                  <td className="pr-2 text-right tabular-nums">{formaterEuros(x.coutDistribues)}</td>
                  <td className="pr-2 text-right tabular-nums">{x.evenements.scan}</td>
                  <td className="pr-2 text-right tabular-nums">{x.evenements.clicGoogle}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

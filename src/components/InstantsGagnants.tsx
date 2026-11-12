// Tableau de bord — instants gagnants du jour (D1) : seulement ceux DÉJÀ PASSÉS, que le serveur est seul à connaître
// (`GET …/instants-gagnants`) ; les instants à venir ne quittent jamais le serveur. Appel direct (pas une méthode de
// `creerClientApi`, ni import de `entetesAcces` : le bundle initial est au plafond — chaque export lu par un chunk
// paresseux y coûte des octets). En-têtes : mêmes règles que `entetesAcces` (src/data/api.ts) pour un accès gérant.
import { useEffect, useState } from 'react'
import { useStore } from '../store'
import type { Acces } from '../data/api'
import { aDesInstants, texteInstant, type InstantPasse } from '../lib/instantsTableau'

/** Session si elle existe, sinon le PIN en en-tête (serveur sans sessions) — comme `entetesAcces`. */
function entetesGerant(a: Acces): Record<string, string> {
  if (a.jeton) return { 'X-Session': a.jeton }
  if (a.pin === undefined) return {}
  return a.role === 'admin' ? { 'X-Admin-PIN': a.pin } : { 'X-Commerce-PIN': a.pin }
}

export function InstantsGagnants() {
  const { mode, api, acces, commerce } = useStore()
  const actifs = aDesInstants(commerce.lots)
  const [instants, setInstants] = useState<InstantPasse[] | 'erreur' | null>(null)
  useEffect(() => {
    if (mode !== 'api' || !api || !acces || !actifs) return
    let actif = true
    fetch(`${api.base}/commerces/${encodeURIComponent(commerce.id)}/instants-gagnants`, { headers: entetesGerant(acces), cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ instants: InstantPasse[] }>) : Promise.reject(new Error(String(r.status)))))
      .then(
        (r) => actif && setInstants(r.instants),
        () => actif && setInstants('erreur'),
      )
    return () => {
      actif = false
    }
  }, [mode, api, acces, commerce.id, actifs])
  if (mode !== 'api' || !actifs) return null
  return (
    <section className="carte space-y-2" aria-labelledby="instants-titre">
      <h2 id="instants-titre" className="titre-carte">Instants gagnants du jour</h2>
      <p className="text-sm text-gray-600">Affichés une fois leur heure passée, jamais avant.</p>
      {instants === null ? (
        <p className="text-sm text-gray-600">Chargement…</p>
      ) : instants === 'erreur' ? (
        <p className="text-sm text-red-700">Instants indisponibles pour le moment.</p>
      ) : instants.length ? (
        <ul className="space-y-1 text-sm">
          {instants.map((i) => (
            <li key={i.heure + i.lot}>{texteInstant(i)}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-600">Aucun instant passé pour l’instant aujourd’hui.</p>
      )}
    </section>
  )
}

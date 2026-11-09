import { useState } from 'react'
import { useDonneesCommerce } from '../store'
import { estActif } from '../lib/stats'
import { dateRelative } from '../lib/format'
import { EnTete, Vide } from '../components/ui'

type Filtre = 'tous' | 'actifs' | 'inactifs'

export default function Clients() {
  const { commerce, clients } = useDonneesCommerce()
  const [recherche, setRecherche] = useState('')
  const [filtre, setFiltre] = useState<Filtre>('tous')

  const q = recherche.trim().toLowerCase()
  const liste = clients
    .filter((c) => (filtre === 'tous' ? true : filtre === 'actifs' ? estActif(c) : !estActif(c)))
    .filter((c) => !q || [c.prenom, c.telephone, c.email].some((v) => v?.toLowerCase().includes(q)))
    .sort((a, b) => b.derniereVisite.localeCompare(a.derniereVisite))

  const nbInactifs = clients.filter((c) => !estActif(c)).length

  return (
    <div>
      <EnTete titre="Clients" sousTitre={`${clients.length} clients · récompense : ${commerce.recompense}`} />

      <input className="champ" type="search" placeholder="Rechercher un prénom, un téléphone…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />

      <div className="mt-3 mb-4 flex gap-2" role="tablist">
        {(
          [
            ['tous', `Tous (${clients.length})`],
            ['actifs', `Actifs (${clients.length - nbInactifs})`],
            ['inactifs', `Inactifs 30 j+ (${nbInactifs})`],
          ] as [Filtre, string][]
        ).map(([valeur, libelle]) => (
          <button
            key={valeur}
            role="tab"
            aria-selected={filtre === valeur}
            onClick={() => setFiltre(valeur)}
            className={`min-h-10 rounded-full px-4 text-sm font-semibold ${filtre === valeur ? 'bg-marque-500 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-300'}`}
          >
            {libelle}
          </button>
        ))}
      </div>

      {liste.length === 0 ? (
        <Vide>Aucun client ne correspond.</Vide>
      ) : (
        <ul className="space-y-2">
          {liste.map((c) => {
            const pct = Math.min(100, Math.round((c.tampons / commerce.seuilTampons) * 100))
            const actif = estActif(c)
            return (
              <li key={c.id} className="carte">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-semibold">{c.prenom}</span>
                      {!actif && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-600">inactif</span>}
                    </div>
                    <div className="truncate text-sm text-gray-500">{c.telephone ?? c.email}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-bold">
                      {c.tampons}/{commerce.seuilTampons}
                    </div>
                    <div className="text-xs text-gray-500">tampons</div>
                  </div>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-gray-100" aria-hidden>
                  <div className="h-full rounded-full bg-marque-500" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-2 flex justify-between text-xs text-gray-500">
                  <span>Dernière visite : {dateRelative(c.derniereVisite)}</span>
                  <span>
                    {c.visites.length} visite{c.visites.length > 1 ? 's' : ''}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

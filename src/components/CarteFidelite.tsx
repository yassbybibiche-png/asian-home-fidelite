import type { Client, Commerce } from '../types'
import { recompenseDebloquee, tamponsAffiches } from '../lib/fidelite'
import { dateRelative } from '../lib/format'
import { urlAbsolue } from '../router'
import { LogoCommerce, QrCode } from './ui'

/** La carte telle que le client la voit sur son téléphone (aussi affichée dans la fiche commerçant). */
export function CarteFidelite({ client, commerce }: { client: Client; commerce: Commerce }) {
  const tampons = tamponsAffiches(client, commerce)
  const pct = Math.round((tampons / commerce.seuilTampons) * 100)
  const debloquee = recompenseDebloquee(client, commerce)

  return (
    <section className="carte overflow-hidden p-0">
      <div className="flex items-center gap-3 bg-marque-500 px-4 py-3 text-white">
        <LogoCommerce commerce={commerce} taille="sm" />
        <div className="min-w-0">
          <div className="truncate font-bold">{commerce.nom}</div>
          <div className="text-sm text-marque-100">Carte de fidélité de {client.prenom}</div>
        </div>
      </div>

      <div className="p-4">
        <div className="flex justify-center">
          <QrCode texte={urlAbsolue('carte', client.id)} className="h-44 w-44" titre={`QR code personnel de ${client.prenom}`} />
        </div>
        <p className="mt-1 text-center text-xs text-gray-500">À présenter en caisse pour valider votre visite</p>

        <div className="mt-4 flex items-baseline justify-between">
          <span className="text-2xl font-extrabold">
            {tampons}/{commerce.seuilTampons} <span className="text-base font-semibold text-gray-600">tampons</span>
          </span>
          <span className="text-sm font-semibold text-marque-600">{pct} %</span>
        </div>
        <div
          className="mt-2 h-3 overflow-hidden rounded-full bg-gray-100"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={commerce.seuilTampons}
          aria-valuenow={tampons}
          aria-label="Progression vers la récompense"
        >
          <div className="h-full rounded-full bg-marque-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-hidden>
          {Array.from({ length: commerce.seuilTampons }, (_, i) => (
            <li
              key={i}
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                i < tampons ? 'bg-marque-500 text-white' : 'bg-gray-100 text-gray-400 ring-1 ring-gray-200'
              }`}
            >
              {i < tampons ? '✓' : i + 1}
            </li>
          ))}
        </ul>

        <p className={`mt-4 rounded-xl p-3 text-sm ${debloquee ? 'bg-green-50 font-semibold text-green-800 ring-1 ring-green-200' : 'bg-gray-50 text-gray-700'}`}>
          {debloquee ? `🎉 Récompense débloquée : ${commerce.recompense}` : `Objectif : ${commerce.recompense}`}
        </p>
        <p className="mt-2 text-sm text-gray-500">
          Dernière visite : {client.visites.length ? dateRelative(client.derniereVisite) : 'aucune pour l’instant'}
        </p>
      </div>
    </section>
  )
}

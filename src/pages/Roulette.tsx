import { useDonneesCommerce } from '../store'
import { dateRelative } from '../lib/format'
import { EnTete, Icone } from '../components/ui'

export default function Roulette() {
  const { commerce, tirages, clients } = useDonneesCommerce()
  const prenom = (id: string) => clients.find((c) => c.id === id)?.prenom ?? 'Client'

  return (
    <div className="space-y-5">
      <EnTete titre="Roulette" sousTitre="Le client scanne le QR code, tourne la roue et gagne un lot." />

      <section className="carte flex flex-col items-center px-6 py-10 text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-marque-50 text-marque-500">
          <Icone nom="roulette" className="h-12 w-12" />
        </span>
        <h2 className="mt-4 text-xl font-bold">Bientôt disponible</h2>
        <p className="mt-2 max-w-sm text-gray-600">
          La roulette animée, le QR code imprimable et la page publique client arrivent dans la prochaine version. Vos lots sont déjà prêts.
        </p>
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-lg font-bold">Lots configurés</h2>
          <a href="#/reglages" className="font-semibold text-marque-600">
            Modifier
          </a>
        </div>
        <ul className="carte divide-y divide-gray-100 py-1">
          {commerce.lots.map((lot, i) => (
            <li key={i} className="py-2.5">
              🎁 {lot}
            </li>
          ))}
        </ul>
      </section>

      {tirages.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-bold">Gains récents</h2>
          <ul className="carte divide-y divide-gray-100 py-1">
            {tirages.slice(0, 8).map((t) => (
              <li key={t.id} className="flex justify-between gap-3 py-2.5">
                <span>
                  <span className="font-semibold">{prenom(t.clientId)}</span> — {t.lot}
                </span>
                <span className="shrink-0 text-sm text-gray-500">{dateRelative(t.date)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

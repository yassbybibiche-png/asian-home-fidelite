import { useDonneesCommerce } from '../store'
import { urlQrJeu } from '../router'
import { dateRelative } from '../lib/format'
import { lotsJouables, totalProbabilites } from '../lib/roulette'
import { BoutonCopier, EnTete, QrCode, Vide } from '../components/ui'

export default function Roulette() {
  const { commerce, tirages, clients } = useDonneesCommerce()
  const prenom = (id: string) => clients.find((c) => c.id === id)?.prenom ?? 'Client'
  const total = totalProbabilites(commerce.lots)
  const url = urlQrJeu(commerce.id)

  return (
    <div className="space-y-5">
      <EnTete titre="Roulette" sousTitre="Après une visite validée au comptoir, le client scanne le QR code et tourne la roue. 1 participation par visite, 1 tirage par jour." />

      <section className="carte flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
        <a href="#/qr" aria-label="Agrandir le QR vitrine">
          <span className="block rounded-2xl bg-white p-2 ring-1 ring-gray-200">
            <QrCode texte={url} className="h-36 w-36" titre={`QR code de la roulette de ${commerce.nom}`} />
          </span>
        </a>
        <div className="w-full min-w-0 space-y-2">
          <p className="text-sm text-gray-600">Ce QR code est unique à votre commerce. Il ouvre la page de jeu :</p>
          <p className="truncate rounded-lg bg-gray-50 px-3 py-2 font-mono text-sm text-gray-700">{url}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <a href="#/qr" className="bouton">
              QR vitrine à imprimer
            </a>
            <a href={`#/jouer/${commerce.id}`} className="bouton-secondaire">
              Ouvrir la page client
            </a>
          </div>
          <BoutonCopier texte={url} libelle="Copier le lien de la page de jeu" className="bouton-secondaire w-full" />
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="titre-carte">Lots configurés</h2>
          <a href="#/reglages" className="lien">
            Modifier
          </a>
        </div>
        <ul className="carte divide-y divide-gray-100 py-1">
          {lotsJouables(commerce.lots).map((lot, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-2.5">
              <span>🎁 {lot.libelle}</span>
              <span className="shrink-0 rounded-full bg-magenta-500/10 px-2.5 py-0.5 text-sm font-semibold text-magenta-700 tabular-nums">
                {Math.round((lot.probabilite / total) * 100)} %
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="titre-carte mb-2">Gains récents</h2>
        {tirages.length === 0 ? (
          <Vide>Aucun tirage pour l’instant.</Vide>
        ) : (
          <ul className="carte divide-y divide-gray-100 py-1">
            {tirages.slice(0, 8).map((t) => (
              <li key={t.id} className="flex justify-between gap-3 py-2.5">
                <span>
                  <span className="font-semibold">{prenom(t.clientId)}</span> — {t.lot}
                  {t.code && <span className="block font-mono text-sm text-gray-600">code {t.code}</span>}
                </span>
                <span className="shrink-0 text-sm text-gray-600">{dateRelative(t.date)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

import type { Client, Commerce } from '../types'
import { recompenseDebloquee, tamponsAffiches } from '../lib/fidelite'
import { eurosParPoint, soldePoints } from '../lib/points'
import { assombrir, estCouleur } from '../lib/apparence'
import { banniereCommerce, VISUELS } from '../lib/visuels'
import { dateRelative } from '../lib/format'
import { urlAbsolue } from '../router'
import { LogoCommerce, QrCode } from './ui'

/** Colonnes de la grille de tampons : rangées régulières (5 pour 10 tampons, 4 pour 8…). */
function colonnes(seuil: number): string {
  if (seuil % 5 === 0 || seuil > 12) return 'grid-cols-5'
  if (seuil % 4 === 0) return 'grid-cols-4'
  if (seuil % 3 === 0) return 'grid-cols-3'
  return 'grid-cols-5'
}

export function libelleTaux(commerce: Pick<Commerce, 'eurosParPoint'>): string {
  const e = eurosParPoint(commerce)
  return e === 1 ? '1 point par euro dépensé' : `1 point tous les ${e.toLocaleString('fr-FR')} € dépensés`
}

/** La carte telle que le client la voit sur son téléphone (aussi affichée dans la fiche commerçant). */
export function CarteFidelite({ client, commerce, sansQr = false }: { client: Client; commerce: Commerce; sansQr?: boolean }) {
  const tampons = tamponsAffiches(client, commerce)
  const pct = Math.round((tampons / commerce.seuilTampons) * 100)
  const debloquee = recompenseDebloquee(client, commerce)
  const restants = Math.max(0, commerce.seuilTampons - tampons)
  const { couleur, fond } = commerce.apparence ?? {}
  // Bannière configurée par le commerçant, sinon le vrai plateau de plats pour Asian Home.
  const banniere = banniereCommerce(commerce)
  // Couleurs personnalisées (Réglages → Apparence, contraste vérifié) ; sinon la charte par défaut (classes ci-dessous).
  const styleBandeau = estCouleur(couleur) ? { background: `linear-gradient(135deg, ${couleur}, ${assombrir(couleur)})` } : undefined
  const points = soldePoints(client)

  return (
    <section className="overflow-hidden rounded-3xl bg-white shadow-relief ring-1 ring-gray-900/5" style={estCouleur(fond) ? { backgroundColor: fond } : undefined}>
      {banniere && (
        <img
          src={banniere}
          alt={banniere === VISUELS.heroPlats ? 'Plateau de plats d’Asian Home Paris vu de dessus : sushis, makis, saumon, nouilles, riz et dessert à la mangue' : ''}
          className="h-24 w-full object-cover"
        />
      )}
      {/* Recto : bandeau laque façon carte physique. */}
      <div
        className={`relative overflow-hidden px-5 pt-5 pb-6 text-white ${styleBandeau ? '' : 'bg-gradient-to-br from-marque-500 via-marque-600 to-marque-800'}`}
        style={styleBandeau}
      >
        <div className="pointer-events-none absolute -top-16 -right-12 h-44 w-44 rounded-full border-[18px] border-white/10" aria-hidden />
        <div className="relative flex items-center gap-3">
          <LogoCommerce commerce={commerce} taille="md" />
          <div className="min-w-0">
            <div className="truncate font-titre text-lg font-bold">{commerce.nom}</div>
            <div className="text-sm text-white">Carte de fidélité</div>
          </div>
        </div>
        <div className="relative mt-5 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs tracking-[0.14em] text-white uppercase">Titulaire</div>
            <div className="truncate text-xl font-semibold">{client.prenom}</div>
          </div>
          <div className="flex shrink-0 gap-4 text-right">
            <div>
              <div className="text-3xl leading-none font-extrabold">
                {tampons}
                <span className="text-lg font-semibold text-white">/{commerce.seuilTampons}</span>
              </div>
              <div className="text-xs text-white">tampons</div>
            </div>
            <div>
              <div className="text-3xl leading-none font-extrabold tabular-nums">{points}</div>
              <div className="text-xs text-white">point{points > 1 ? 's' : ''}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="p-5">
        <ul className={`grid ${colonnes(commerce.seuilTampons)} justify-items-center gap-2.5`} aria-hidden>
          {Array.from({ length: commerce.seuilTampons }, (_, i) => {
            const plein = i < tampons
            const dernier = i === commerce.seuilTampons - 1
            return (
              <li
                key={i}
                className={`flex aspect-square w-full max-w-12 items-center justify-center rounded-full text-sm font-bold ${
                  plein
                    ? 'bg-marque-500 text-white shadow-[inset_0_-2px_0_rgb(0_0_0/0.15)]'
                    : dernier
                      ? 'border-2 border-dashed border-or-500 bg-amber-50 text-amber-800'
                      : 'border-2 border-dashed border-gray-300 text-gray-500'
                }`}
              >
                {plein ? '✓' : dernier ? '🎁' : i + 1}
              </li>
            )
          })}
        </ul>

        <div
          className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={commerce.seuilTampons}
          aria-valuenow={tampons}
          aria-label="Progression vers la récompense"
        >
          <div className="h-full rounded-full bg-gradient-to-r from-marque-500 to-marque-600 transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1.5 flex justify-between text-sm text-gray-600">
          <span>{debloquee ? 'Carte complète' : `Encore ${restants} tampon${restants > 1 ? 's' : ''}`}</span>
          <span className="font-semibold text-marque-600">{pct} %</span>
        </p>

        {debloquee ? (
          <div className="apparition mt-4 rounded-2xl bg-gradient-to-br from-amber-50 to-amber-100 p-4 text-amber-900 ring-2 ring-or-500" role="status">
            <p className="surtitre text-amber-800">Récompense en attente</p>
            <p className="mt-1 text-lg font-bold">🎉 {commerce.recompense}</p>
            <p className="mt-1 text-sm">À demander au comptoir.</p>
          </div>
        ) : (
          <p className="mt-4 rounded-xl bg-gray-50 p-3 text-sm text-gray-700 ring-1 ring-gray-900/5">
            <span className="font-semibold">Objectif :</span> {commerce.recompense}
          </p>
        )}

        {!!commerce.catalogue?.length && (
          <div className="mt-4">
            <p className="surtitre">Vos points · {libelleTaux(commerce)}</p>
            <ul className="mt-1.5 space-y-1.5">
              {commerce.catalogue.map((r) => {
                const ok = points >= r.cout
                return (
                  <li key={r.id} className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm ring-1 ${ok ? 'bg-green-50 text-green-900 ring-green-200' : 'bg-gray-50 text-gray-700 ring-gray-900/5'}`}>
                    <span className="min-w-0">
                      <span className="font-semibold">{r.nom}</span>
                      {r.description && <span className="block text-xs">{r.description}</span>}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{ok ? '✓ ' : ''}{r.cout} pts</span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {!sansQr && (
          <div className="mt-5 flex flex-col items-center border-t border-dashed border-gray-200 pt-5">
            <div className="rounded-2xl bg-white p-2 ring-1 ring-gray-200">
              <QrCode texte={urlAbsolue('carte', client.id)} className="h-40 w-40" titre={`QR code personnel de ${client.prenom}`} />
            </div>
            <p className="mt-2 text-center text-sm text-gray-600">À présenter en caisse pour valider votre visite</p>
            <p className="mt-1 text-xs text-gray-600">
              Dernière visite : {client.derniereVisite ? dateRelative(client.derniereVisite) : 'aucune pour l’instant'}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

import { useStore } from '../store'
import { urlQrJeu } from '../router'
import { LogoCommerce, QrCode } from '../components/ui'
import { NOM_APP } from '../data/defaults'

/** QR grand format, affichable en caisse ou imprimable (étiquettes de table, adhésif vitrine). */
export default function QrVitrine() {
  const { commerce, mode } = useStore()
  const url = urlQrJeu(commerce.id)

  return (
    <div className="space-y-4">
      <a href="#/roulette" className="lien no-underline print:hidden">
        ‹ Roulette
      </a>

      <section className="carte relative mx-auto flex max-w-lg flex-col items-center overflow-hidden px-6 pt-10 pb-8 text-center print:shadow-none print:ring-0">
        <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-magenta-700 via-magenta-500 to-magenta-700" aria-hidden />
        <LogoCommerce commerce={commerce} taille="lg" />
        <h1 className="mt-3 font-titre text-3xl font-bold tracking-tight">{commerce.nom}</h1>
        <p className="mt-2 text-xl font-semibold text-magenta-700">Scannez, tournez la roue, gagnez !</p>
        <div className="mt-5 w-full max-w-80 rounded-3xl border-4 border-magenta-500 p-3">
          <QrCode texte={url} className="aspect-square w-full" titre={`QR code de la roulette de ${commerce.nom}`} />
        </div>
        <p className="mt-4 text-gray-700">1 tirage par personne et par jour · sans obligation d’achat ni d’avis</p>
        {commerce.coordonnees && <p className="mt-3 text-sm text-gray-600">{commerce.coordonnees}</p>}
        <p className="mt-2 font-titre text-sm font-bold text-magenta-700">{NOM_APP}</p>
      </section>

      <div className="mx-auto grid max-w-lg gap-2 print:hidden">
        <button className="bouton" onClick={() => window.print()}>
          Imprimer
        </button>
        <a href={`#/jouer/${commerce.id}`} className="bouton-secondaire">
          Tester la page client
        </a>
        <p className="text-center text-sm break-all text-gray-600">{url}</p>
        <p className="text-center text-sm text-gray-600">
          {mode === 'local'
            ? 'Démo : le QR pointe vers l’adresse actuelle de l’app. Hébergée en ligne, la même page servira telle quelle.'
            : 'Le QR pointe vers l’adresse actuelle de l’app : imprimez-le depuis l’adresse publique définitive (pas depuis localhost). Chaque scan est compté, même si la page ne se charge pas.'}
        </p>
      </div>
    </div>
  )
}

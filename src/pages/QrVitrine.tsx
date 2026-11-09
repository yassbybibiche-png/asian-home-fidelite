import { useStore } from '../store'
import { urlAbsolue } from '../router'
import { LogoCommerce, QrCode } from '../components/ui'
import { NOM_APP } from '../data/defaults'

/** QR grand format, affichable en caisse ou imprimable (étiquettes de table, adhésif vitrine). */
export default function QrVitrine() {
  const { commerce, mode } = useStore()
  const url = urlAbsolue('jouer', commerce.id)

  return (
    <div className="space-y-4">
      <a href="#/roulette" className="inline-flex min-h-11 items-center font-semibold text-marque-600 print:hidden">
        ‹ Roulette
      </a>

      <section className="carte mx-auto flex max-w-lg flex-col items-center px-6 py-8 text-center print:shadow-none print:ring-0">
        <LogoCommerce commerce={commerce} taille="lg" />
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">{commerce.nom}</h1>
        <p className="mt-2 text-xl font-semibold text-marque-600">Scannez, tournez la roue, gagnez !</p>
        <QrCode texte={url} className="mt-5 aspect-square w-full max-w-80" titre={`QR code de la roulette de ${commerce.nom}`} />
        <p className="mt-4 text-gray-700">1 tirage par personne et par jour · sans obligation d’achat ni d’avis</p>
        {commerce.coordonnees && <p className="mt-3 text-sm text-gray-600">{commerce.coordonnees}</p>}
        <p className="mt-2 text-sm font-bold text-marque-500">{NOM_APP}</p>
      </section>

      <div className="mx-auto grid max-w-lg gap-2 print:hidden">
        <button className="bouton" onClick={() => window.print()}>
          Imprimer
        </button>
        <a href={`#/jouer/${commerce.id}`} className="bouton-secondaire">
          Tester la page client
        </a>
        <p className="text-center text-xs break-all text-gray-500">{url}</p>
        <p className="text-center text-xs text-gray-500">
          {mode === 'local'
            ? 'Démo : le QR pointe vers l’adresse actuelle de l’app. Hébergée en ligne, la même page servira telle quelle.'
            : 'Le QR pointe vers l’adresse actuelle de l’app : imprimez-le depuis l’adresse publique définitive (pas depuis localhost).'}
        </p>
      </div>
    </div>
  )
}

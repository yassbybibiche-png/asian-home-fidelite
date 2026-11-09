import { useState } from 'react'
import { useDonneesCommerce } from '../store'
import { noteMoyenne } from '../lib/stats'
import { dateRelative } from '../lib/format'
import { BadgeDemo, EnTete, Etoiles, Vide } from '../components/ui'

type Filtre = 'tous' | 'sansReponse' | 'negatifs'

export default function AvisPage() {
  const { commerce, avis } = useDonneesCommerce()
  const [filtre, setFiltre] = useState<Filtre>('tous')
  const moyenne = noteMoyenne(avis)

  const liste = avis.filter((a) => (filtre === 'sansReponse' ? !a.reponse : filtre === 'negatifs' ? a.note <= 3 : true))

  return (
    <div>
      <EnTete
        titre="Avis Google"
        sousTitre={
          moyenne === null ? 'Aucun avis' : `${moyenne.toLocaleString('fr-FR')} ★ de moyenne · ${avis.length} avis · ${avis.filter((a) => !a.reponse).length} sans réponse`
        }
      />

      <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-gray-600">
        <BadgeDemo>Avis de démonstration</BadgeDemo>
        L’API Google n’est pas branchée ; les modèles de réponse arrivent dans la prochaine version.
      </p>

      {commerce.lienGoogle && (
        <a href={commerce.lienGoogle} target="_blank" rel="noreferrer" className="bouton-secondaire mb-4 w-full">
          Ouvrir la fiche Google ↗
        </a>
      )}

      <div className="mb-4 flex gap-2 overflow-x-auto">
        {(
          [
            ['tous', 'Tous'],
            ['sansReponse', 'Sans réponse'],
            ['negatifs', '3★ et moins'],
          ] as [Filtre, string][]
        ).map(([valeur, libelle]) => (
          <button
            key={valeur}
            onClick={() => setFiltre(valeur)}
            className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold ${filtre === valeur ? 'bg-marque-500 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-300'}`}
          >
            {libelle}
          </button>
        ))}
      </div>

      {liste.length === 0 ? (
        <Vide>Aucun avis dans cette catégorie.</Vide>
      ) : (
        <ul className="space-y-3">
          {liste.map((a) => (
            <li key={a.id} className="carte">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{a.auteur}</span>
                <Etoiles note={a.note} />
              </div>
              <p className="mt-0.5 text-xs text-gray-500">{dateRelative(a.date)}</p>
              <p className="mt-2 text-gray-800">{a.texte || <em className="text-gray-400">Note sans commentaire</em>}</p>
              {a.reponse ? (
                <div className="mt-3 rounded-xl bg-gray-50 p-3 text-sm">
                  <span className="font-semibold text-gray-700">Votre réponse</span>
                  <p className="mt-1 text-gray-700">{a.reponse}</p>
                </div>
              ) : (
                <p className="mt-3 text-sm font-semibold text-marque-600">En attente de réponse</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

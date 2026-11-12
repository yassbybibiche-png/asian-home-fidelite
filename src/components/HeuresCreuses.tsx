// Réglages → Roulette, heures creuses (roue v2, D2, maquettes §5) : case « Heures creuses seulement » d'un lot et
// éditeur des créneaux (jours + début–fin, heure de Paris). Importé par Réglages seulement (page différée).
import type { CreneauCreux } from '../types'
import { CRENEAUX_MAX, JOURS_CRENEAU } from '../lib/creneaux'

/** Case d'un lot : tirable (et visible sur la roue) seulement pendant un créneau heures creuses. */
export function CaseHeuresCreuses({ coche, desactive, onChange }: { coche: boolean; desactive: boolean; onChange(v: boolean): void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
      <span className="zone-case">
        <input type="checkbox" className="case-a-cocher" disabled={desactive} checked={coche} onChange={(e) => onChange(e.target.checked)} />
      </span>
      Heures creuses seulement
    </label>
  )
}

/** Créneau proposé à l'ajout : après-midi en semaine. */
const CRENEAU_DEFAUT: CreneauCreux = { jours: [1, 2, 3, 4, 5], debut: '15:00', fin: '18:00' }

/** Liste des créneaux heures creuses : jours (cases), début et fin ; `erreur` = `problemeCreneaux` du brouillon. */
export function CreneauxCreux({ creneaux, erreur, onChange }: { creneaux: CreneauCreux[]; erreur: string | null; onChange(v: CreneauCreux[]): void }) {
  const maj = (i: number, c: CreneauCreux | null) => onChange(c ? creneaux.map((x, j) => (j === i ? c : x)) : creneaux.filter((_, j) => j !== i))
  return (
    <div className="space-y-2">
      <p className="etiquette">Créneaux heures creuses</p>
      <p className="text-sm text-gray-600">
        Heures de Paris, début inclus, fin exclue. Pendant un créneau, les lots « Heures creuses seulement » entrent dans la roue (et dans « À gagner aujourd’hui ») et une consolation en points tirée est doublée ; le reste du temps, ces lots ne sortent pas, comme un lot à 0 %.
      </p>
      <ul className="space-y-3">
        {creneaux.map((c, i) => (
          <li key={i} className="space-y-2 rounded-xl p-3 ring-1 ring-gray-200">
            <fieldset className="flex flex-wrap gap-x-3">
              <legend className="sr-only">Jours du créneau {i + 1}</legend>
              {JOURS_CRENEAU.map((j) => (
                <label key={j.valeur} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                  <span className="zone-case">
                    <input
                      type="checkbox"
                      className="case-a-cocher"
                      checked={c.jours.includes(j.valeur)}
                      onChange={(e) => maj(i, { ...c, jours: e.target.checked ? [...c.jours, j.valeur] : c.jours.filter((x) => x !== j.valeur) })}
                    />
                  </span>
                  {j.court}
                </label>
              ))}
            </fieldset>
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`creneau-debut-${i}`}>
                Début du créneau {i + 1}
              </label>
              <input id={`creneau-debut-${i}`} className="champ w-32" type="time" value={c.debut} onChange={(e) => maj(i, { ...c, debut: e.target.value })} />
              <span aria-hidden="true">–</span>
              <label className="sr-only" htmlFor={`creneau-fin-${i}`}>
                Fin du créneau {i + 1}
              </label>
              <input id={`creneau-fin-${i}`} className="champ w-32" type="time" value={c.fin} onChange={(e) => maj(i, { ...c, fin: e.target.value })} />
              <button type="button" className="min-h-11 text-sm font-semibold text-red-800 underline" onClick={() => maj(i, null)}>
                Retirer
              </button>
            </div>
          </li>
        ))}
      </ul>
      {creneaux.length < CRENEAUX_MAX && (
        <button type="button" className="bouton-secondaire w-full" onClick={() => onChange([...creneaux, { ...CRENEAU_DEFAUT, jours: [...CRENEAU_DEFAUT.jours] }])}>
          + Ajouter un créneau
        </button>
      )}
      {erreur ? (
        <p className="text-sm font-medium text-red-700">Créneaux heures creuses : {erreur}</p>
      ) : (
        !creneaux.length && <p className="text-sm text-gray-600">Aucun créneau : les lots « Heures creuses seulement » ne sortent jamais.</p>
      )}
    </div>
  )
}

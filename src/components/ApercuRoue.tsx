import { useEffect, useRef, useState } from 'react'
import type { Lot } from '../types'
import { rotationCible } from '../lib/roulette'
import { delaiResultat, toursRotation } from '../lib/animationRoue'
import { texteTirageDeTest, tirageDeTest } from '../lib/reglagesRoue'
import { ContexteRoue, Roue, useMouvementReduit } from './Roue'

/**
 * Aperçu de la roue dans Réglages → Roulette (R6) : la roue du brouillon (secteurs proportionnels aux chances, vue
 * commerçant) et un tirage de TEST — tiré dans le navigateur (`tirageDeTest`), animé comme la vraie roue, jamais envoyé :
 * ce composant ne reçoit ni le store ni l'API, il ne peut rien enregistrer.
 */
export function ApercuRoue({ lots, couleur, initiale }: { lots: Lot[]; couleur?: string; initiale?: string }) {
  const [rotation, setRotation] = useState(0)
  const [etape, setEtape] = useState<'pret' | 'rotation' | 'resultat'>('pret')
  const [tire, setTire] = useState<Lot | null>(null)
  const minuterie = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(minuterie.current), [])
  const reduit = useMouvementReduit()
  const possible = tirageDeTest(lots, 0) !== null

  function lancer() {
    const t = tirageDeTest(lots)
    if (!t || etape === 'rotation') return
    window.clearTimeout(minuterie.current)
    setTire(t.lot)
    setRotation((r) => rotationCible(r, t.secteur, Math.random(), toursRotation(reduit)))
    setEtape('rotation')
    minuterie.current = window.setTimeout(() => setEtape('resultat'), delaiResultat(reduit))
  }

  const fete = etape === 'resultat' ? tire?.type : undefined
  return (
    <div className="space-y-3" data-apercu-roue>
      <div className="rounded-2xl bg-nuit-950 px-4 py-6">
        <ContexteRoue.Provider value={{ couleur, initiale, fete }}>
          <Roue lots={lots} rotation={rotation} />
        </ContexteRoue.Provider>
      </div>
      {etape !== 'pret' && (
        <p className="rounded-xl bg-amber-100 px-3 py-2 text-center text-sm font-semibold text-amber-900" data-bandeau-test>
          Tirage de test — rien n’est enregistré
        </p>
      )}
      <p className="min-h-6 text-center text-base font-semibold text-gray-900" aria-live="polite" data-resultat-test>
        {etape === 'rotation' ? 'La roue tourne…' : etape === 'resultat' && tire ? texteTirageDeTest(tire) : ''}
      </p>
      <button type="button" className="bouton-secondaire w-full" onClick={lancer} disabled={!possible || etape === 'rotation'}>
        🎡 Lancer un tirage de test
      </button>
    </div>
  )
}

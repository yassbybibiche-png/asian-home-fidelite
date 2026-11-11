import { useSyncExternalStore } from 'react'
import { lireRoute } from '../router'
import { estPageTraduite, LIBELLES_LANGUE, lireLangue, memoriserLangue, traduire, type Langue } from '../lib/langue'

// Langue des pages clientes (P2-Q1) : choix mémorisé sur le téléphone, appliqué sur #/jouer, #/carte,
// #/menu, #/desinscription et #/confidentialite ; ailleurs (back-office, caisse, aperçus commerçant)
// tout reste en français. #/desinscription et #/confidentialite n'ont pas de commutateur : elles
// appliquent la langue mémorisée sur les autres pages clientes.
const abonnes = new Set<() => void>()

function stockage(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

function abonner(rappel: () => void) {
  abonnes.add(rappel)
  window.addEventListener('hashchange', rappel)
  window.addEventListener('storage', rappel)
  return () => {
    abonnes.delete(rappel)
    window.removeEventListener('hashchange', rappel)
    window.removeEventListener('storage', rappel)
  }
}

function langueCourante(): Langue {
  return estPageTraduite(lireRoute().page) ? lireLangue(stockage()) : 'fr'
}

export function changerLangue(langue: Langue) {
  memoriserLangue(stockage(), langue)
  document.documentElement.lang = langue
  abonnes.forEach((r) => r())
}

/** Langue affichée et traduction des chaînes : `t(texteFrancais, { x })`. */
export function useLangue(): { langue: Langue; t: (fr: string, valeurs?: Record<string, string | number>) => string } {
  const langue = useSyncExternalStore(abonner, langueCourante, () => (typeof window === 'undefined' ? 'fr' : langueCourante()))
  return { langue, t: (fr, valeurs) => traduire(fr, langue, valeurs) }
}

/** Commutateur FR / EN des pages clientes : deux boutons (aria-pressed), chaque langue nommée dans sa langue. */
export function CommutateurLangue({ sombre = false }: { sombre?: boolean }) {
  const { langue, t } = useLangue()
  return (
    <div className="flex justify-end" role="group" aria-label={t('Langue')} data-commutateur-langue>
      {(['fr', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={langue === l}
          aria-label={LIBELLES_LANGUE[l].long}
          onClick={() => changerLangue(l)}
          className={`min-h-11 min-w-11 px-2 text-base font-bold underline-offset-4 aria-pressed:underline ${sombre ? 'text-white aria-pressed:text-magenta-300' : 'text-gray-700 aria-pressed:text-magenta-700'}`}
        >
          {LIBELLES_LANGUE[l].court}
        </button>
      ))}
    </div>
  )
}

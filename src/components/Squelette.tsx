import type { ReactNode } from 'react'

/**
 * Squelettes de chargement (P0-U1) : la forme grisée de l'écran à venir, à la place d'un « Chargement… » en texte.
 * Purement visuels : aucun appel réseau, aucun état — chaque page garde sa logique de chargement et ses messages d'erreur.
 */

/** Forme grise qui pulse (décor : ignorée des lecteurs d'écran). `sombre` : sur un fond nocturne (.hero-sombre). */
export function Bloc({ className = '', sombre = false }: { className?: string; sombre?: boolean }) {
  return <div aria-hidden className={`animate-pulse ${sombre ? 'bg-white/15' : 'bg-gray-200'} ${className}`} />
}

/** Conteneur d'un écran en chargement : annoncé aux lecteurs d'écran (role="status", aria-busy), texte lisible sous les formes. */
export function Squelette({ libelle, className = '', children }: { libelle: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" data-squelette className={className}>
      {children}
      <p className="text-center text-sm text-gray-600">{libelle}</p>
    </div>
  )
}

/** En-tête nocturne grisé (logo + nom), commun au jeu et au menu. */
function EnTeteSombre() {
  return (
    <div className="hero-sombre -mx-4 flex flex-col items-center gap-3 rounded-b-3xl px-4 pt-6 pb-8 shadow-relief">
      <Bloc sombre className="h-16 w-16 rounded-xl" />
      <Bloc sombre className="h-6 w-48 rounded-lg" />
      <Bloc sombre className="h-4 w-56 rounded-lg" />
    </div>
  )
}

/** #/jouer : en-tête, roue et carte grisées. */
export function SqueletteJeu({ libelle }: { libelle: string }) {
  return (
    <Squelette libelle={libelle} className="mx-auto max-w-md space-y-5 px-4 pt-6 pb-10">
      <EnTeteSombre />
      <div className="hero-sombre -mx-1 rounded-3xl px-2 py-4 ring-1 ring-magenta-400/30">
        <Bloc sombre className="mx-auto aspect-square w-full max-w-80 rounded-full" />
      </div>
      <div className="carte space-y-3">
        <Bloc className="h-5 w-2/3 rounded-lg" />
        <Bloc className="h-12 w-full rounded-xl" />
        <Bloc className="h-12 w-full rounded-xl" />
      </div>
    </Squelette>
  )
}

/** #/carte : carte de fidélité (tampons) et boutons grisés. */
export function SqueletteCarte({ libelle }: { libelle: string }) {
  return (
    <Squelette libelle={libelle} className="mx-auto max-w-md space-y-4 px-4 pt-6 pb-10">
      <div className="carte space-y-4 rounded-3xl">
        <div className="flex items-center gap-3">
          <Bloc className="h-11 w-11 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Bloc className="h-5 w-1/2 rounded-lg" />
            <Bloc className="h-4 w-1/3 rounded-lg" />
          </div>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: 10 }, (_, i) => (
            <Bloc key={i} className="aspect-square w-full max-w-12 justify-self-center rounded-full" />
          ))}
        </div>
        <Bloc className="mx-auto h-32 w-32 rounded-xl" />
      </div>
      <Bloc className="h-12 w-full rounded-xl" />
      <Bloc className="h-12 w-full rounded-xl" />
    </Squelette>
  )
}

/** #/menu : en-tête, recherche, catégories et plats grisés. */
export function SqueletteMenu({ libelle }: { libelle: string }) {
  return (
    <Squelette libelle={libelle} className="mx-auto max-w-md space-y-5 px-4 pt-6 pb-10">
      <EnTeteSombre />
      <Bloc className="h-12 w-full rounded-xl" />
      <div className="flex gap-2 overflow-hidden">
        {['w-16', 'w-24', 'w-20', 'w-24'].map((largeur, i) => (
          <Bloc key={i} className={`h-11 shrink-0 rounded-full ${largeur}`} />
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="carte flex gap-3">
          <Bloc className="h-20 w-20 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2 pt-1">
            <Bloc className="h-5 w-3/4 rounded-lg" />
            <Bloc className="h-4 w-full rounded-lg" />
            <Bloc className="h-4 w-1/3 rounded-lg" />
          </div>
        </div>
      ))}
    </Squelette>
  )
}

/** #/caisse : en-tête, bandeau d'état, scanner/recherche et liste de clients grisés. */
export function SqueletteCaisse({ libelle }: { libelle: string }) {
  return (
    <Squelette libelle={libelle} className="mx-auto max-w-xl space-y-4 px-4 pt-4 pb-10">
      <div className="flex items-center gap-3">
        <Bloc className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Bloc className="h-5 w-1/2 rounded-lg" />
          <Bloc className="h-4 w-1/3 rounded-lg" />
        </div>
      </div>
      <Bloc className="h-10 w-full rounded-xl" />
      <div className="carte space-y-3">
        <Bloc className="h-12 w-full rounded-xl" />
        <Bloc className="h-12 w-full rounded-xl" />
      </div>
      {[0, 1, 2].map((i) => (
        <Bloc key={i} className="h-16 w-full rounded-xl" />
      ))}
    </Squelette>
  )
}

/** Pages commerçant (mode API), le temps de relire l'accès mémorisé : en-tête et quelques cartes grisés. */
export function SqueletteCommercant({ libelle }: { libelle: string }) {
  return (
    <Squelette libelle={libelle}>
      <div className="hero-sombre flex items-center gap-3 px-4 py-2">
        <Bloc sombre className="h-9 w-9 rounded-xl" />
        <Bloc sombre className="h-5 w-40 rounded-lg" />
      </div>
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-5">
        <Bloc className="h-8 w-1/2 rounded-lg" />
        <Bloc className="h-28 w-full rounded-2xl" />
        <Bloc className="h-28 w-full rounded-2xl" />
      </div>
    </Squelette>
  )
}

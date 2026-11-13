import { useCallback, useEffect, useState } from 'react'
import { MESSAGE_MODE_SERVEUR, useStore } from '../store'
import { urlQrJeu, useRoute } from '../router'
import type { CommercePublic } from '../types'
import { ErreurApi } from '../data/api'
import { QrCode } from '../components/QrCode'
import { THEME } from '../theme'
import { HorsLignePublic, MessagePublic } from './Jouer'

/** Données rechargées toutes les minutes (fiche, plats photographiés, derniers gains). */
export const RECHARGEMENT_MS = 60_000
/** Une vue (roue, gains, plats) toutes les 12 s. */
export const ROTATION_MS = 12_000
/** Fondu d'un plat au suivant, dans la vue « Plats ». */
export const FONDU_PLATS_MS = 6_000

type Vue = 'roue' | 'gains' | 'plats'
interface Plat {
  nom: string
  photo: string
}
interface Donnees {
  commerce: CommercePublic
  plats: Plat[]
  gains: { prenom: string; lot: string }[]
}

/**
 * Minuteur qui ne tourne pas onglet masqué (`document.hidden`) : l'écran éteint ou l'onglet en arrière-plan ne
 * relance ni chargement ni rotation. Nettoyé au démontage.
 */
function useCycle(ms: number, action: () => void) {
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) action()
    }, ms)
    return () => clearInterval(id)
  }, [ms, action])
}

/**
 * Écran vitrine #/vitrine/<commerceId> (recommandation R4) : TV en salle, plein écran, sans aucun clic. Trois vues en
 * rotation (roue et lots du jour, derniers gains en prénoms seuls, plats photographiés du menu), QR « Scannez pour
 * jouer » toujours visible. Lecture seule : fiche publique, menu public, derniers gains.
 */
export default function Vitrine() {
  const { api } = useStore()
  const { param } = useRoute()
  const [donnees, setDonnees] = useState<Donnees | null>(null)
  const [erreur, setErreur] = useState<'introuvable' | 'horsLigne' | null>(null)
  const [tour, setTour] = useState(0)
  const [plat, setPlat] = useState(0)

  const charger = useCallback(() => {
    if (!api || !param) return
    Promise.all([
      api.commerce(param),
      // Menu et gains secondaires : une panne n'empêche pas l'écran de tourner (listes vides).
      api.menu(param).then(
        (r) => r.menu.categories.flatMap((c) => c.produits.flatMap((p) => (p.photo ? [{ nom: p.nom, photo: p.photo }] : []))).slice(0, 12),
        () => [],
      ),
      api.derniersGains(param).catch(() => []),
    ]).then(
      ([commerce, plats, gains]) => (setDonnees({ commerce, plats, gains }), setErreur(null)),
      (e) => setErreur(e instanceof ErreurApi && e.statut === 404 ? 'introuvable' : 'horsLigne'),
    )
  }, [api, param])
  useEffect(charger, [charger])
  useCycle(RECHARGEMENT_MS, charger)
  useCycle(ROTATION_MS, useCallback(() => setTour((n) => n + 1), []))
  useCycle(FONDU_PLATS_MS, useCallback(() => setPlat((n) => n + 1), []))

  if (!api) return <MessagePublic titre="Page indisponible">{MESSAGE_MODE_SERVEUR}</MessagePublic>
  if (!param || erreur === 'introuvable') return <MessagePublic titre="Page indisponible">Ce lien ne correspond à aucun commerce.</MessagePublic>
  if (erreur === 'horsLigne' && !donnees) return <HorsLignePublic onReessayer={charger} />
  if (!donnees) return <div className="fixed inset-0 bg-nuit-950" aria-busy="true" />
  const { commerce, plats, gains } = donnees
  if (!commerce.actif) return <MessagePublic titre="Page indisponible">Ce commerce n’est plus disponible.</MessagePublic>

  const accent = /^#[0-9a-f]{6}$/i.test(commerce.apparence?.couleur ?? '') ? commerce.apparence!.couleur! : THEME.magenta400
  const vues: Vue[] = plats.length ? ['roue', 'gains', 'plats'] : ['roue', 'gains']
  const active = vues[tour % vues.length]
  // Mouvement réduit : roue immobile et changements instantanés (les vues défilent quand même).
  const reduit = matchMedia('(prefers-reduced-motion: reduce)').matches
  const fondu = reduit ? '' : ' transition-opacity duration-1000'
  const visible = (v: Vue) => `absolute inset-0${fondu} ${active === v ? 'opacity-100' : 'opacity-0'}`
  // Contenu centré, à l'écart du nom (haut) et du QR (coin bas droit).
  const centre = 'flex flex-col items-center justify-center px-[18vw] pt-28 pb-16'

  return (
    <div className="vitrine fixed inset-0 cursor-none overflow-hidden bg-nuit-950 text-white" style={{ borderTop: `0.75rem solid ${accent}` }}>
      <p className="absolute inset-x-0 top-8 z-10 text-center text-3xl font-semibold tracking-wide text-white/80">{commerce.nom}</p>

      <section className={`${visible('roue')} ${centre}`} aria-hidden={active !== 'roue'}>
        <h1 className="titre-logo text-center text-8xl">{commerce.nom}</h1>
        <RoueVitrine lots={commerce.lots} accent={accent} tourne={!reduit} />
        <ul className="mt-10 flex max-w-6xl flex-wrap justify-center gap-x-12 gap-y-4 text-5xl font-bold">
          {commerce.lots.map((l) => (
            <li key={l.id}>{l.libelle}</li>
          ))}
        </ul>
      </section>

      <section className={`${visible('gains')} ${centre}`} aria-hidden={active !== 'gains'}>
        <h2 className="titre-logo text-center text-7xl">Ils ont gagné chez nous</h2>
        {gains.length ? (
          <ul className="mt-12 space-y-6 text-center text-6xl">
            {gains.map((g, i) => (
              <li key={i}>
                <strong className="font-extrabold">{g.prenom}</strong>
                <span className="text-white/85"> · {g.lot}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-12 max-w-5xl text-center text-6xl font-semibold">Les premiers gains du jour arrivent… à vous de jouer !</p>
        )}
      </section>

      {plats.length > 0 && (
        <section className={visible('plats')} aria-hidden={active !== 'plats'}>
          {plats.map((p, i) => (
            <figure key={p.photo} className={`absolute inset-0${fondu} ${i === plat % plats.length ? 'opacity-100' : 'opacity-0'}`}>
              <img src={p.photo} alt="" className="h-full w-full object-cover" />
              <figcaption className="absolute inset-x-0 bottom-0 bg-linear-to-t from-nuit-950 via-nuit-950/70 to-transparent px-16 pt-40 pb-16 text-8xl font-extrabold">
                {p.nom}
              </figcaption>
            </figure>
          ))}
        </section>
      )}

      {/* Permanent : QR vers la page de jeu (redirection courte comptée, comme le QR vitrine imprimé). Îlot clair
          (data-surface-claire) : le fond blanc du QR, zone de silence, n'est pas assombri par .page-client. */}
      <div className="absolute right-8 bottom-8 z-10 flex flex-col items-center gap-3 rounded-3xl bg-nuit-900 p-5 ring-1 ring-white/15">
        <div data-surface-claire>
          <QrCode texte={urlQrJeu(commerce.id)} className="h-56 w-56 rounded-xl" titre="QR code pour jouer" />
        </div>
        <p className="text-3xl font-bold">Scannez pour jouer</p>
      </div>
    </div>
  )
}

/** Roue décorative : un secteur par lot (dégradé conique), un tour complet en 60 s, `transform` seul. */
function RoueVitrine({ lots, accent, tourne }: { lots: CommercePublic['lots']; accent: string; tourne: boolean }) {
  const n = Math.max(lots.length, 1)
  const couleurs = [accent, THEME.surface2]
  // Nombre impair de secteurs : le dernier prend une 3e teinte, jamais deux secteurs voisins de même couleur.
  const secteurs = Array.from({ length: n }, (_, i) => `${n % 2 && i === n - 1 && n > 1 ? THEME.surface : couleurs[i % 2]} ${(i * 360) / n}deg ${((i + 1) * 360) / n}deg`)
  return (
    <div
      className={`mt-8 aspect-square h-[34vh] rounded-full ring-8 ring-white/15 ${tourne ? 'vitrine-roue' : ''}`}
      style={{ backgroundImage: `conic-gradient(${secteurs.join(', ')})` }}
      aria-hidden="true"
    />
  )
}

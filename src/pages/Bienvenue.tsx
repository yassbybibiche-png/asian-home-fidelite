import { useCallback, useEffect, useRef, useState } from 'react'
import { MESSAGE_MODE_SERVEUR, useStore } from '../store'
import { useRoute } from '../router'
import type { CommercePublic } from '../types'
import { ErreurApi } from '../data/api'
import { LogoCommerce, PiedPublic } from '../components/ui'
import { Bloc, Squelette } from '../components/Squelette'
import { banniereCommerce, estAsianHome, VISUELS } from '../lib/visuels'
import { enregistrerTraductions } from '../lib/langue'
import { dependancesNavigateur, preparerRevelations } from '../lib/revelation'
import { prefereMouvementReduit } from '../lib/menuClient'
import { HorsLignePublic, MessagePublic } from './Jouer'
import { useLangue } from '../components/Langue'

/** Traductions de cette page différée : hors du dictionnaire initial (P2-Q1, bundle P2-Q2). */
enregistrerTraductions({
  'Bienvenue': 'Welcome',
  'Bienvenue chez': 'Welcome to',
  'Un instant, la page arrive.': 'One moment, the page is on its way.',
  'Ce lien ne correspond à aucun commerce.': 'This link does not match any business.',
  'Page indisponible': 'Page unavailable',
  'Ce commerce n’est plus disponible.': 'This business is no longer available.',
  'Découvrir la carte': 'Discover the menu',
  'Commander à table': 'Order at your table',
  'Scannez le QR code posé sur votre table pour commander.': 'Scan the QR code on your table to order.',
  'Jouer et gagner': 'Play and win',
  'Voir la suite': 'See more',
  'La salle': 'The dining room',
  'Plafond d’ombrelles, tables dressées.': 'A ceiling of parasols, tables set.',
  'Plat signature : riz rouge, bœuf caramélisé, œuf, salade.': 'Signature dish: red rice, caramelised beef, egg, salad.',
  'Cocktails': 'Cocktails',
  'Cocktails signature : Kohsamui, Tokyo et Piña Colada.': 'Signature cocktails: Kohsamui, Tokyo and Piña Colada.',
  'À bientôt à table.': 'See you soon at the table.',
})

/**
 * Accueil immersif #/bienvenue/<commerceId> (Expérience 10/10, lot 2) : photo authentique plein écran, nom en
 * typographie logo, puis les 3 « moments » d'Asian Home (salle, plat emblématique, cocktails) ; boutons vers la carte,
 * la commande à table (si activée) et la roue. Démo locale : message « mode serveur », comme #/menu.
 */
export default function Bienvenue() {
  const { api } = useStore()
  const { param } = useRoute()
  const { t } = useLangue()
  const [commerce, setCommerce] = useState<CommercePublic | null>(null)
  const [erreur, setErreur] = useState<'introuvable' | 'horsLigne' | null>(null)

  const charger = useCallback(() => {
    if (!api || !param) return
    api.commerce(param).then(
      (c) => (setCommerce(c), setErreur(null)),
      (e) => setErreur(e instanceof ErreurApi && e.statut === 404 ? 'introuvable' : 'horsLigne'),
    )
  }, [api, param])
  useEffect(charger, [charger])

  if (!api) return <MessagePublic titre="Bienvenue">{MESSAGE_MODE_SERVEUR}</MessagePublic>
  if (!param || erreur === 'introuvable') return <MessagePublic titre="Bienvenue">Ce lien ne correspond à aucun commerce.</MessagePublic>
  if (erreur === 'horsLigne' && !commerce) return <HorsLignePublic onReessayer={charger} />
  if (!commerce)
    return (
      <Squelette libelle={t('Un instant, la page arrive.')} className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-end gap-4 px-6 pb-16">
        <Bloc sombre className="h-16 w-16 rounded-xl" />
        <Bloc sombre className="h-10 w-3/4 rounded-lg" />
        <Bloc sombre className="h-14 w-full rounded-xl" />
      </Squelette>
    )
  if (!commerce.actif) return <MessagePublic titre="Page indisponible">Ce commerce n’est plus disponible.</MessagePublic>
  return <Accueil commerce={commerce} />
}

interface Moment {
  id: string
  /** Nom de section, affiché en très grand. */
  titre: string
  texte: string
  src: string
  petit?: string
  alt: string
  ivoire: boolean
}

function Accueil({ commerce }: { commerce: CommercePublic }) {
  const { t } = useLangue()
  const asianHome = estAsianHome(commerce)
  // Photo plein cadre : le plateau de plats d'Asian Home, sinon la bannière renseignée par le commerce, sinon le seul
  // fond nocturne (jamais une image d'ailleurs).
  const photo = asianHome ? VISUELS.heroPlats : banniereCommerce(commerce)
  // Les 3 « moments », pour Asian Home seulement (ses photos authentiques, provenance dans public/visuels/SOURCES.md) :
  // textes repris des légendes et de la carte officielle (le Loc Lac est un plat signature) — rien d'inventé. Les
  // noms de plats ne sont jamais traduits.
  const moments: Moment[] = asianHome
    ? [
        { id: 'salle', titre: t('La salle'), texte: t('Plafond d’ombrelles, tables dressées.'), src: VISUELS.interieur, petit: VISUELS.interieurPetit, alt: 'Salle d’Asian Home Paris : plafond d’ombrelles, tables dressées, sans personne', ivoire: false },
        { id: 'loc-lac', titre: 'Loc Lac', texte: t('Plat signature : riz rouge, bœuf caramélisé, œuf, salade.'), src: VISUELS.menuLocLac, petit: VISUELS.menuLocLacPetit, alt: 'Loc Lac : bœuf caramélisé, riz rouge, œuf au plat', ivoire: true },
        { id: 'cocktails', titre: t('Cocktails'), texte: t('Cocktails signature : Kohsamui, Tokyo et Piña Colada.'), src: VISUELS.cocktails, alt: 'Cocktails signature : Kohsamui, Tokyo et Piña Colada', ivoire: false },
      ]
    : []
  const page = useRef<HTMLDivElement>(null)
  useEffect(() => (page.current ? preparerRevelations(page.current, dependancesNavigateur()) : undefined), [])

  return (
    <div ref={page}>
      <section className="hero-sombre relative flex min-h-dvh flex-col justify-end overflow-hidden" aria-labelledby="bienvenue-titre">
        <FondHeros photo={photo} />
        <div className="relative mx-auto w-full max-w-md px-6 pt-16 pb-8 text-center">
          <div className="cascade flex justify-center">
            <LogoCommerce commerce={commerce} taille="lg" />
          </div>
          <p className="cascade cascade-2 surtitre-sombre mt-5">{t('Bienvenue chez')}</p>
          <h1 id="bienvenue-titre" className="cascade cascade-2 titre-magenta mt-2 text-4xl">
            {commerce.nom}
          </h1>
          {/* Phrase factuelle : le type de cuisine quand la donnée existe (celle du menu d'Asian Home), sinon rien. */}
          {asianHome && <p className="cascade cascade-3 mt-3 text-base text-white/85">{t('Cuisine asiatique halal · Thaï, Japon, Vietnam, Chine')}</p>}
          <div className="cascade cascade-4 mt-8">
            <Actions commerce={commerce} />
          </div>
          {moments.length > 0 && (
            <button
              type="button"
              className="cascade cascade-5 mx-auto mt-6 flex h-11 w-11 items-center justify-center rounded-full text-2xl text-white/80"
              aria-label={t('Voir la suite')}
              onClick={() => document.getElementById('moments')?.scrollIntoView({ behavior: prefereMouvementReduit() ? 'auto' : 'smooth' })}
            >
              <span aria-hidden="true" className="indicateur-defilement">
                ⌄
              </span>
            </button>
          )}
        </div>
      </section>

      {moments.length > 0 && (
        <div id="moments">
          {/* Un moment = un univers : nom de section en très grand, grande photo, texte court ; fonds nuit / ivoire alternés. */}
          {moments.map((m) => (
            <section key={m.id} className={m.ivoire ? 'moment-ivoire' : 'bg-nuit-950'} aria-labelledby={`moment-${m.id}`}>
              <div className="mx-auto max-w-md px-5 py-14" data-revelation>
                <h2 id={`moment-${m.id}`} className="titre-logo text-5xl">
                  {m.titre}
                </h2>
                <picture className="mt-6 block overflow-hidden rounded-3xl shadow-relief">
                  {m.petit && <source srcSet={m.petit} type="image/webp" />}
                  <img src={m.src} alt={m.alt} loading="lazy" className="h-80 w-full object-cover" />
                </picture>
                <p className="mt-5 text-lg">{m.texte}</p>
              </div>
            </section>
          ))}
          <section className="hero-sombre px-6 py-14 text-center" aria-labelledby="bienvenue-fin">
            <div className="mx-auto max-w-md" data-revelation>
              <h2 id="bienvenue-fin" className="titre-magenta text-2xl">
                {t('À bientôt à table.')}
              </h2>
              <div className="mt-6">
                <Actions commerce={commerce} />
              </div>
            </div>
          </section>
        </div>
      )}

      <div className="mx-auto max-w-md space-y-3 px-4 pt-6 pb-10">
        {commerce.coordonnees && <p className="text-center text-sm text-gray-600">{commerce.coordonnees}</p>}
        <PiedPublic commerceId={commerce.id} />
      </div>
    </div>
  )
}

/** Photo plein cadre (décorative : le titre dit où l'on est) sous un voile nuit dégradé, plus dense en bas. */
function FondHeros({ photo }: { photo: string }) {
  return (
    <>
      {photo && <img src={photo} alt="" fetchPriority="high" className="absolute inset-0 h-full w-full object-cover" />}
      <span aria-hidden="true" className="absolute inset-0 bg-linear-to-b from-nuit-950/35 via-nuit-950/60 to-nuit-950" />
    </>
  )
}

/**
 * « Découvrir la carte » toujours ; « Commander à table » seulement si le module est activé (fiche publique) — sans
 * QR de table, il n'ouvre qu'une note (aucune commande sans table) ; « Jouer et gagner » : la roue existante.
 */
export function Actions({ commerce }: { commerce: Pick<CommercePublic, 'id' | 'commandeActive'> }) {
  const { t } = useLangue()
  const [note, setNote] = useState(false)
  const id = encodeURIComponent(commerce.id)
  return (
    <div className="grid gap-3">
      <a href={`#/menu/${id}`} className="bouton w-full text-lg">
        {t('Découvrir la carte')}
      </a>
      {commerce.commandeActive && (
        <>
          <button type="button" className="bouton-secondaire w-full" aria-expanded={note} onClick={() => setNote(!note)}>
            {t('Commander à table')}
          </button>
          {note && (
            <p className="rounded-2xl bg-nuit-900 px-4 py-3 text-base text-white ring-1 ring-magenta-400/40" role="note">
              {t('Scannez le QR code posé sur votre table pour commander.')}
            </p>
          )}
        </>
      )}
      <a href={`#/jouer/${id}`} className="bouton-secondaire w-full">
        {t('Jouer et gagner')}
      </a>
    </div>
  )
}

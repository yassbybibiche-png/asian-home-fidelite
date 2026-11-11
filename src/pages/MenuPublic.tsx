import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MESSAGE_MODE_SERVEUR, useStore } from '../store'
import { useRoute } from '../router'
import type { CommercePublic, Menu } from '../types'
import { ErreurApi } from '../data/api'
import { formaterPrix } from '../lib/points'
import { bandeauPrixManquants, filtrerMenu, libelleAllergenes } from '../lib/menu'
import { badgesPlat, boutonsMenu, categorieEffective, categorieMidi, estHeureMenuMidi, LIBELLES_BADGES, MENTION_BADGE_DEDUIT } from '../lib/menuClient'
import { LogoCommerce, PiedPublic } from '../components/ui'
import { SqueletteMenu } from '../components/Squelette'
import { estAsianHome, photoCategorie, VISUELS } from '../lib/visuels'
import { estSignature, masquerPrixNonConfirmes, menuReelAsianHome } from '../data/menu-reel'
import { HorsLignePublic, MessagePublic } from './Jouer'
import { CommutateurLangue, useLangue } from '../components/Langue'

/** Page publique #/menu/<commerceId> (QR du menu, lien depuis la carte de fidélité). */
export default function MenuPublic() {
  const { api } = useStore()
  const { param } = useRoute()
  const [donnees, setDonnees] = useState<{ menu: Menu; commerce: CommercePublic } | null>(null)
  const [erreur, setErreur] = useState<'introuvable' | 'inactif' | 'horsLigne' | null>(null)
  const [recherche, setRecherche] = useState('')
  const [categorie, setCategorie] = useState<string>('toutes')
  const [ouvert, setOuvert] = useState<string | null>(null)
  const { t } = useLangue()

  const charger = useCallback(() => {
    if (!api || !param) return
    api.menu(param).then(
      (r) => (setDonnees(r), setErreur(null)),
      (e) => setErreur(e instanceof ErreurApi && e.statut === 404 ? 'introuvable' : e instanceof ErreurApi && e.statut === 409 ? 'inactif' : 'horsLigne'),
    )
  }, [api, param])
  useEffect(charger, [charger])

  if (!api) return <MessagePublic titre="Menu">{MESSAGE_MODE_SERVEUR}</MessagePublic>
  if (!param || erreur === 'introuvable') return <MessagePublic titre="Menu introuvable">Ce lien ne correspond à aucun commerce.</MessagePublic>
  if (erreur === 'inactif') return <MessagePublic titre="Menu indisponible">Le menu de ce commerce n’est plus disponible.</MessagePublic>
  if (erreur === 'horsLigne' && !donnees) return <HorsLignePublic onReessayer={charger} />
  if (!donnees) return <SqueletteMenu libelle={t('Un instant, le menu arrive.')} />

  return <MenuAffiche menu={donnees.menu} commerce={donnees.commerce} recherche={recherche} setRecherche={setRecherche} categorie={categorie} setCategorie={setCategorie} ouvert={ouvert} setOuvert={setOuvert} />
}

/** Heure courante, rafraîchie chaque minute (bandeau « Menu Midi »). */
function useMaintenant(): Date {
  const [maintenant, setMaintenant] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setMaintenant(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  return maintenant
}

export function MenuAffiche({
  menu,
  commerce,
  recherche,
  setRecherche,
  categorie,
  setCategorie,
  ouvert,
  setOuvert,
}: {
  menu: Menu
  commerce: CommercePublic
  recherche: string
  setRecherche: (s: string) => void
  categorie: string
  setCategorie: (s: string) => void
  ouvert: string | null
  setOuvert: (s: string | null) => void
}) {
  // Menu enregistré vide chez Asian Home : on affiche la carte officielle du restaurant
  // (relevée le 10/11/2026, avec ses prix ; 5 plats restent « Prix sur place » : les 3 hors carte
  // + 2 prix imprimés non confirmés masqués, P1-M1).
  // Dès que le commerçant enregistre son propre menu, c'est le sien qui s'affiche.
  const menuEnregistre = menu.categories.some((c) => c.produits.length > 0)
  const asianHome = estAsianHome(commerce)
  const repliReel = !menuEnregistre && asianHome
  // P1-M1 : les prix imprimés non confirmés sont masqués quel que soit le menu affiché
  // (carte de repli ou menu enregistré avant le lot) — jamais 8,90 € / 100,00 € sans confirmation.
  const menuAffiche = useMemo(() => masquerPrixNonConfirmes(repliReel ? menuReelAsianHome() : menu), [repliReel, menu])
  const bandeauPrix = useMemo(() => bandeauPrixManquants(menuAffiche), [menuAffiche])
  const categories = useMemo(
    () => filtrerMenu(menuAffiche.categories.filter((c) => c.produits.length), recherche),
    [menuAffiche, recherche],
  )
  // La recherche ne réinitialise pas l'onglet choisi : s'il n'a plus de plat correspondant, on montre tout.
  const active = categorieEffective(categories, categorie)
  const visibles = active === 'toutes' ? categories : categories.filter((c) => c.id === active)
  const total = visibles.reduce((s, c) => s + c.produits.length, 0)
  const boutons = boutonsMenu(commerce, asianHome)
  const maintenant = useMaintenant()
  const midi = useMemo(() => categorieMidi(menuAffiche.categories.filter((c) => c.produits.length)), [menuAffiche])
  const bandeauMidi = !!midi && estHeureMenuMidi(maintenant)
  const avecBadges = visibles.some((c) => c.produits.some((p) => badgesPlat(p).length))
  // Interface traduite (P2-Q1) ; les noms de plats et de catégories restent ceux du restaurant.
  const { t } = useLangue()

  // Indicateur de l'onglet actif : en « Toutes », la catégorie dont la section est à l'écran (suivi au défilement).
  const [enVue, setEnVue] = useState<string | null>(null)
  const nav = useRef<HTMLElement>(null)
  useEffect(() => {
    if (active !== 'toutes' || typeof IntersectionObserver === 'undefined') return setEnVue(null)
    const sections = [...document.querySelectorAll<HTMLElement>('section[data-categorie]')]
    const obs = new IntersectionObserver(
      (entrees) => {
        const premiere = entrees.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (premiere) setEnVue((premiere.target as HTMLElement).dataset.categorie ?? null)
      },
      // Bande juste sous les onglets collants : la section qui la traverse est « en vue ».
      { rootMargin: '-140px 0px -60% 0px' },
    )
    sections.forEach((s) => obs.observe(s))
    return () => obs.disconnect()
  }, [active, visibles.length, recherche])
  const ongletIndique = active === 'toutes' ? enVue : active
  // L'onglet indiqué reste visible dans la barre (défilement horizontal).
  useEffect(() => {
    nav.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [ongletIndique])

  /** Choisit un onglet ; `defiler` : ramène le début de la liste à l'écran (toujours depuis le bandeau, sinon si on l'a dépassé). */
  function choisir(id: string, defiler = false) {
    setCategorie(id)
    setOuvert(null)
    const liste = document.getElementById('liste-menu')
    if (liste && (defiler || liste.getBoundingClientRect().top < 0)) liste.scrollIntoView({ block: 'start' })
  }

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 pt-6 pb-10">
      <header className="hero-sombre -mx-4 rounded-b-3xl px-4 pt-2 pb-6 text-center shadow-relief">
        <CommutateurLangue sombre />
        <div className="flex justify-center">
          <LogoCommerce commerce={commerce} taille="lg" />
        </div>
        <p className="surtitre-sombre mt-3">{t('Menu')}</p>
        <h1 className="titre-magenta mt-1 text-2xl">{commerce.nom}</h1>
        <p className="mt-1 text-sm text-white/80">{t('Cuisine asiatique halal · Thaï, Japon, Vietnam, Chine')}</p>
      </header>

      {boutons.length > 0 && (
        <nav className="flex flex-wrap justify-center gap-2" aria-label={t('Contacter le restaurant')}>
          {boutons.map((b) => (
            <a key={b.id} href={b.href} className="bouton-secondaire min-h-11 px-4 py-2 text-sm" {...(b.externe ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
              {b.libelle}
            </a>
          ))}
        </nav>
      )}

      {/* Bandeau « Menu Midi » : seulement du lundi au vendredi, 11h30–14h30, heure de Paris. */}
      {bandeauMidi && midi && (
        <div className="apparition flex items-center gap-3 rounded-2xl bg-magenta-400/15 p-4 ring-1 ring-magenta-400/50" role="note">
          <span className="text-2xl" aria-hidden="true">
            🍱
          </span>
          <p className="min-w-0 flex-1 text-sm">
            <span className="block font-bold">{t('C’est l’heure du Menu Midi !')}</span>
            {t('Formules du lundi au vendredi, jusqu’à 14h30.')}
          </p>
          <button type="button" className="bouton shrink-0 min-h-11 px-4 py-2 text-sm" onClick={() => (setRecherche(''), choisir(midi.id, true))}>
            {t('Voir')}
          </button>
        </div>
      )}

      {asianHome && (
        <img
          src={VISUELS.tableSushis}
          alt="Table dressée chez Asian Home Paris : bao buns, plateau de sushis et cocktails"
          className="h-56 w-full rounded-3xl object-cover shadow-relief ring-1 ring-gray-900/5"
        />
      )}

      {bandeauPrix && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">{bandeauPrix}</p>}

      {categories.length === 0 && !recherche ? (
        <MessagePublic titre="Menu à venir">Le commerce n’a pas encore publié son menu.</MessagePublic>
      ) : (
        <>
          {/* Recherche + onglets collants : restent en haut de l'écran pendant le défilement. */}
          <div className="sticky top-0 z-20 -mx-4 space-y-2 bg-fond/95 px-4 pt-2 pb-2 shadow-[0_6px_12px_-10px_rgb(17_24_39/0.25)] backdrop-blur">
            <div role="search">
              <label className="sr-only" htmlFor="recherche-plat">
                {t('Rechercher un plat')}
              </label>
              <input
                id="recherche-plat"
                type="search"
                className="champ"
                placeholder={t('🔍 Rechercher un plat… (ex : dynamite, maki)')}
                value={recherche}
                onChange={(e) => (setRecherche(e.target.value), setOuvert(null))}
              />
            </div>

            <nav ref={nav} className="flex gap-2 overflow-x-auto pb-1" aria-label={t('Catégories')}>
              <OngletCategorie libelle={t('Toutes')} choisi={active === 'toutes'} indique={active === 'toutes' && !enVue} onClick={() => choisir('toutes')} />
              {categories.map((c) => (
                <OngletCategorie key={c.id} libelle={c.nom} choisi={active === c.id} indique={ongletIndique === c.id} onClick={() => choisir(c.id)} />
              ))}
            </nav>
          </div>

          {total === 0 ? (
            <p className="carte text-center text-gray-600" role="status">
              {t('Aucun plat ne correspond à « {recherche} ».', { recherche })}
            </p>
          ) : (
            <>
              <p id="liste-menu" className="scroll-mt-36 text-sm text-gray-600" role="status">
                {t(total > 1 ? '{n} plats' : '{n} plat', { n: total })}
                {recherche ? t(' pour « {recherche} »', { recherche }) : ''}
              </p>
              {visibles.map((c) => {
                const photo = photoCategorie(c.nom)
                return (
                  <section key={c.id} id={`m-${c.id}`} data-categorie={c.id} className="scroll-mt-36 space-y-2">
                    <h2 className="font-titre text-xl font-bold">{c.nom}</h2>
                    {photo && <img src={photo.src} alt={photo.alt} loading="lazy" className="h-32 w-full rounded-2xl object-cover" />}
                    <ul className="space-y-2">
                      {c.produits.map((p) => {
                        const detail = ouvert === p.id
                        const signature = estSignature(p.nom)
                        const badges = badgesPlat(p)
                        return (
                          <li key={p.id} className="overflow-hidden rounded-2xl bg-white shadow-douce ring-1 ring-gray-900/5">
                            <button
                              type="button"
                              className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left active:bg-gray-50"
                              aria-expanded={detail}
                              onClick={() => setOuvert(detail ? null : p.id)}
                            >
                              {(p.photoVignette ?? p.photo) && (
                                <img src={p.photoVignette ?? p.photo} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold">{p.nom}</span>
                                  {/* Pastilles (étiquettes décoratives) : text-xs, 12,75 px, exception documentée (P2-Q1). */}
                                  {signature && (
                                    <span className="rounded-full bg-magenta-500 px-2 py-0.5 text-xs font-bold tracking-wide text-white uppercase">★ Signature</span>
                                  )}
                                  {badges.map((b) => (
                                    <span key={b} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700" title={`Déduit de la description — ${MENTION_BADGE_DEDUIT}`}>
                                      {LIBELLES_BADGES[b]}*<span className="sr-only"> ({MENTION_BADGE_DEDUIT})</span>
                                    </span>
                                  ))}
                                </span>
                                {p.description && !detail && <span className="mt-0.5 line-clamp-2 block text-sm text-gray-700">{p.description}</span>}
                              </span>
                              {p.prix == null ? (
                                <span className="shrink-0 text-sm text-gray-600 italic">{t('Prix sur place')}</span>
                              ) : (
                                <span className="shrink-0 font-semibold text-magenta-700 tabular-nums">{formaterPrix(p.prix)}</span>
                              )}
                            </button>
                            {detail && (
                              <div className="apparition space-y-3 border-t border-gray-100 px-4 py-3">
                                {p.photo && <img src={p.photo} alt={t('Photo du plat : {nom}', { nom: p.nom })} loading="lazy" className="h-44 w-full rounded-2xl object-cover" />}
                                {p.description ? (
                                  <p className="text-sm text-gray-700">{p.description}</p>
                                ) : (
                                  <p className="text-sm text-gray-600 italic">{t('Description à venir — demandez conseil à l’équipe.')}</p>
                                )}
                                <p className="text-sm">
                                  <span className="font-semibold">{t('Prix :')} </span>
                                  {p.prix == null ? <span className="text-gray-600 italic">{t('sur place')}</span> : <span className="font-semibold text-magenta-700 tabular-nums">{formaterPrix(p.prix)}</span>}
                                </p>
                                {badges.length > 0 && (
                                  <p className="text-sm text-gray-600">
                                    {badges.map((b) => LIBELLES_BADGES[b]).join(' · ')} — {MENTION_BADGE_DEDUIT} auprès de l’équipe.
                                  </p>
                                )}
                                {/* P1-M2 : la ligne allergènes est toujours affichée — la liste si elle est
                                    renseignée, sinon la mention explicite « demander en caisse ». */}
                                <p className="text-sm text-gray-600">{t(libelleAllergenes(p))}</p>
                                {signature && <p className="text-sm font-semibold text-magenta-700">{t('★ Plat signature — l’un des best-sellers du restaurant.')}</p>}
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )
              })}
            </>
          )}
        </>
      )}
      {avecBadges && <p className="text-center text-sm text-gray-600">* 🌶 / 🌱 : déduit du nom ou de la description du plat, {MENTION_BADGE_DEDUIT} auprès de l’équipe.</p>}
      {commerce.coordonnees && <p className="text-center text-sm text-gray-600">{commerce.coordonnees}</p>}
      <p className="text-center text-sm text-gray-600">{t('Allergènes : demandez conseil à l’équipe en cas de doute.')}</p>
      <PiedPublic commerceId={commerce.id} />
    </div>
  )
}

/** Onglet de catégorie : `choisi` = filtre appliqué (aria-pressed), `indique` = barre sous l'onglet (catégorie à l'écran). */
function OngletCategorie({ libelle, choisi, indique, onClick }: { libelle: string; choisi: boolean; indique: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`puce relative whitespace-nowrap ${indique ? 'after:absolute after:inset-x-4 after:-bottom-0.5 after:h-1 after:rounded-full after:bg-magenta-400' : ''}`}
      aria-pressed={choisi}
      aria-current={indique ? 'true' : undefined}
      onClick={onClick}
    >
      {libelle}
    </button>
  )
}

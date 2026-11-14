import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { MESSAGE_MODE_SERVEUR, useStore } from '../store'
import { useRoute } from '../router'
import type { CommercePublic, Menu, Produit } from '../types'
import { ErreurApi } from '../data/api'
import { formaterPrix } from '../lib/points'
import { bandeauPrixManquants, filtrerMenu, LIBELLE_ALLERGENES_ABSENTS } from '../lib/menu'
import { badgesPlat, boutonsMenu, categorieEffective, categorieMidi, estHeureMenuMidi, LIBELLES_BADGES, MENTION_BADGE_DEDUIT, photoCartePlat, prefereMouvementReduit } from '../lib/menuClient'
import { LogoCommerce, PiedPublic } from '../components/ui'
import { SqueletteMenu } from '../components/Squelette'
import { estAsianHome, photoCategorie, VISUELS } from '../lib/visuels'
import { estSignature, masquerPrixNonConfirmes, menuReelAsianHome, retirerPhotosDetachees } from '../data/menu-reel'
import { enregistrerTraductions } from '../lib/langue'
import { HorsLignePublic, MessagePublic } from './Jouer'
import { CommutateurLangue, useLangue } from '../components/Langue'
import { dependancesNavigateur, preparerRevelations } from '../lib/revelation'
import { defilerRail } from '../lib/defilementRail'
import { animerRailVivant } from '../lib/railVivant'
import { activerParallaxe } from '../lib/parallaxe'
import { motsUniques } from '../lib/bandeau'
import { BandeauDefilant } from '../components/BandeauDefilant'
import { croiserCouches, universCategorie, type Couches } from '../lib/univers'
import { motsTitre, plusLongMot } from '../lib/titreCinetique'
import { platStar } from '../lib/platStar'

/** Traductions des badges de cette page différée : hors du dictionnaire initial (P2-Q1, bundle P2-Q2). */
enregistrerTraductions({
  '🌶 Épicé': '🌶 Spicy',
  '🌶 Option épicée': '🌶 Spicy option',
  '🌱 Végétarien': '🌱 Vegetarian',
  '🌱 Option végétarienne': '🌱 Vegetarian option',
  'Ce lien ne correspond à aucun commerce.': 'This link does not match any business.',
})

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
  // P1-M1 + P1-M3 : les prix imprimés non confirmés sont masqués et les photos détachées retirées,
  // quel que soit le menu affiché (carte de repli ou menu enregistré avant le lot) — jamais 8,90 € /
  // 100,00 € sans confirmation, jamais la photo makis partagée sur un plat nommé.
  const menuAffiche = useMemo(() => retirerPhotosDetachees(masquerPrixNonConfirmes(repliReel ? menuReelAsianHome() : menu)), [repliReel, menu])
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
  // Rail « En photos » : les plats photographiés de toute la carte (liste complète, hors recherche et onglet).
  const platsPhoto = useMemo(
    () => menuAffiche.categories.flatMap((c) => c.produits.filter((p) => p.photo).map((p) => ({ categorieId: c.id, p }))),
    [menuAffiche],
  )
  // Interface traduite (P2-Q1) ; les noms de plats et de catégories restent ceux du restaurant.
  const { langue, t } = useLangue()

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
  // Univers par catégorie (boucle animations, cycle 1) : l'ambiance suit l'onglet indiqué — la section à l'écran
  // en « Toutes », la catégorie filtrée sinon ; univers 0 (magenta) en haut de page. Rang pris sur la carte
  // complète (hors recherche) : une catégorie garde toujours le même univers.
  const idsCategories = useMemo(() => menuAffiche.categories.filter((c) => c.produits.length).map((c) => c.id), [menuAffiche])
  const univers = universCategorie(idsCategories, ongletIndique)
  // Menu v2 (Expérience 10/10) : rail « En photos » qui défile seul, lentement (pause au toucher / survol / focus,
  // jamais en mouvement réduit), et cartes qui se révèlent au défilement (contenu visible par défaut).
  const rail = useRef<HTMLDivElement>(null)
  const avecRail = recherche === '' && platsPhoto.length >= 2
  useEffect(() => (avecRail && rail.current ? defilerRail(rail.current, prefereMouvementReduit()) : undefined), [avecRail])
  // Rail vivant (cycle 4) : la tuile au centre grandit et s'éclaire ; pilote seul, la position reste à defilerRail.
  useEffect(() => (avecRail && rail.current ? animerRailVivant(rail.current, prefereMouvementReduit()) : undefined), [avecRail])
  const liste = useRef<HTMLDivElement>(null)
  useEffect(() => (liste.current ? preparerRevelations(liste.current, dependancesNavigateur()) : undefined), [active, recherche, visibles.length])
  // Parallaxe des photos d'en-tête de catégorie (cycle 3) : les cibles sont relues à chaque image, la liste peut changer.
  useEffect(() => (liste.current ? activerParallaxe(liste.current, prefereMouvementReduit()) : undefined), [total === 0])
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

  /** Depuis le rail : onglet « Toutes » (la carte du plat est visible quelle que soit sa catégorie),
      fiche du plat ouverte, puis défilement jusqu'à sa carte. */
  function allerAuPlat(_categorieId: string, platId: string) {
    setCategorie('toutes')
    setOuvert(platId)
    setTimeout(() => document.getElementById(`plat-${platId}`)?.scrollIntoView({ behavior: prefereMouvementReduit() ? 'auto' : 'smooth', block: 'center' }), 80)
  }

  return (
    <>
    <AmbianceUnivers univers={univers} />
    <div className="relative z-[1] mx-auto max-w-md space-y-5 px-4 pt-6 pb-10">
      <header className="hero-sombre -mx-4 rounded-b-3xl px-4 pt-2 pb-6 text-center shadow-relief">
        <CommutateurLangue sombre />
        <div className="flex justify-center">
          <LogoCommerce commerce={commerce} taille="lg" />
        </div>
        <p className="surtitre-sombre mt-3">{t('Menu')}</p>
        <h1 className="titre-magenta mt-1 text-2xl">{commerce.nom}</h1>
        <p className="mt-1 text-sm text-white/80">{t('Cuisine asiatique halal · Thaï, Japon, Vietnam, Chine')}</p>
      </header>

      {/* Commande à table activée : simple information (le panier n'existe qu'en mode Commande, via le QR de la table). */}
      {commerce.commandeActive && (
        <p className="rounded-2xl bg-nuit-900 px-4 py-3 text-center text-sm text-white ring-1 ring-magenta-400/40" role="note">
          {t('Vous êtes à table ? Scannez le QR de votre table pour commander.')}
        </p>
      )}

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
        <picture className="block">
          <source srcSet={VISUELS.tableSushisPetit} type="image/webp" />
          <img
            src={VISUELS.tableSushis}
            alt="Table dressée chez Asian Home Paris : bao buns, plateau de sushis et cocktails"
            className="h-56 w-full rounded-3xl object-cover shadow-relief ring-1 ring-gray-900/5"
          />
        </picture>
      )}

      {bandeauPrix && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">{bandeauPrix}</p>}

      {/* Bandeau défilant décoratif (le rail juste dessous nomme les mêmes plats) : noms des plats photographiés, jamais traduits. */}
      {avecRail && <BandeauDefilant mots={motsUniques(platsPhoto.map(({ p }) => p.nom))} className="-mx-4" />}

      {avecRail && (
        <section aria-label={t('En photos')} className="space-y-2">
          <p className="font-titre text-lg font-bold">{t('En photos')}</p>
          <div ref={rail} className="flex gap-3 overflow-x-auto pb-1" data-rail-photos>
            {platsPhoto.map(({ categorieId, p }) => (
              <button
                key={p.id}
                type="button"
                onClick={() => allerAuPlat(categorieId, p.id)}
                aria-label={t('Voir le plat : {nom}', { nom: p.nom })}
                className="w-36 shrink-0 py-2 text-left transition-transform active:scale-[0.97]"
              >
                {/* Conteneur interne (cycle 4) : porte l'échelle du rail vivant, le bouton garde son enfoncement tactile. */}
                <span className="block overflow-hidden rounded-2xl bg-white shadow-douce ring-1 ring-gray-900/5" data-rail-vivant>
                  <img src={photoCartePlat(p)} alt="" loading="lazy" className="h-24 w-full object-cover" />
                  <span className="block px-3 py-2">
                    <span className="block truncate text-sm font-semibold">{p.nom}</span>
                    <span className="block text-sm font-semibold text-magenta-700 tabular-nums">{p.prix == null ? t('Prix sur place') : formaterPrix(p.prix)}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

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
            <div ref={liste} className="space-y-5">
              <p id="liste-menu" className="scroll-mt-36 text-sm text-gray-600" role="status">
                {t(total > 1 ? '{n} plats' : '{n} plat', { n: total })}
                {recherche ? t(' pour « {recherche} »', { recherche }) : ''}
              </p>
              {visibles.map((c) => {
                const photo = photoCategorie(c.nom)
                // Cycle 3 : plat-star plein cadre (photo du plat lui-même), jamais pendant une recherche.
                const star = recherche ? null : platStar(c)
                return (
                  <section key={c.id} id={`m-${c.id}`} data-categorie={c.id} data-univers-actif={ongletIndique === c.id || undefined} className="apparition scroll-mt-36 space-y-2">
                    {/* Avec une photo, la catégorie devient un « moment » : le nom en typographie logo sur la photo
                        (le titre h2 reste dans le document pour les lecteurs d'écran et le plan de la page). */}
                    <div className={photo ? 'sr-only' : 'flex flex-wrap items-center gap-2'}>
                      <h2 className="font-titre text-xl font-bold">{c.nom}</h2>
                      {/* Sans photo (cycle 2) : calque décoratif posé exactement sur le h2 (rendu transparent par le CSS),
                          qui révèle le nom mot à mot à taille inchangée — le h2 reste le titre lu. */}
                      {!photo && (
                        <span aria-hidden="true" className="titre-calque font-titre text-xl font-bold" data-revelation>
                          <MotsReveles nom={c.nom} />
                        </span>
                      )}
                      {bandeauMidi && midi && c.id === midi.id && (
                        <span className="rounded-full bg-magenta-500 px-2 py-0.5 text-xs font-bold tracking-wide text-white uppercase">{t('🍱 Menu Midi')}</span>
                      )}
                    </div>
                    {photo && (
                      <div className="relative h-56 overflow-hidden rounded-3xl shadow-relief" data-revelation>
                        {/* Parallaxe (±28 px) : la photo déborde de 32 px en haut et en bas du cadre ; zoom lent (ken burns). */}
                        <div className="cadre-parallaxe ken-burns absolute inset-x-0 -inset-y-8" data-parallaxe>
                          <picture className="block">
                            <source srcSet={photo.srcPetit} type="image/webp" />
                            <img src={photo.src} alt={photo.alt} loading="lazy" className="h-56 w-full object-cover" />
                          </picture>
                        </div>
                        <span aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-nuit-950/90 via-nuit-950/25 to-transparent" />
                        {/* Cycle 2 : mot fantôme géant en creux qui dérive lentement derrière le titre (décor recadré par le cadre). */}
                        <span aria-hidden="true" className="titre-fantome">
                          <span className="titre-logo text-2xl text-white">{c.nom}</span>
                        </span>
                        <span aria-hidden="true" className="titre-cadre absolute inset-x-5 bottom-4 flex flex-wrap items-end gap-2">
                          {/* Titre géant révélé mot à mot (taille réglée sur le plus long mot : jamais tronqué). */}
                          <span className="titre-geant text-white" style={{ '--lettres': plusLongMot(c.nom) } as CSSProperties}>
                            <MotsReveles nom={c.nom} />
                          </span>
                          {bandeauMidi && midi && c.id === midi.id && (
                            <span className="rounded-full bg-magenta-500 px-2 py-0.5 text-xs font-bold tracking-wide text-white uppercase">{t('🍱 Menu Midi')}</span>
                          )}
                        </span>
                      </div>
                    )}
                    {star && <PlatStar plat={star} voir={() => allerAuPlat(c.id, star.id)} />}
                    <ul className="cartes-echelonnees space-y-2">
                      {c.produits.map((p) => {
                        const detail = ouvert === p.id
                        const signature = estSignature(p.nom)
                        const badges = badgesPlat(p)
                        return (
                          <li key={p.id} id={`plat-${p.id}`} className="overflow-hidden rounded-3xl bg-white shadow-douce ring-1 ring-gray-900/5" data-revelation>
                            {p.photo && (
                              <button
                                type="button"
                                className="relative block w-full transition-transform active:scale-[0.99]"
                                aria-expanded={detail}
                                aria-label={t('Voir le plat : {nom}', { nom: p.nom })}
                                onClick={() => setOuvert(detail ? null : p.id)}
                              >
                                <img src={photoCartePlat(p)} alt="" loading="lazy" className="h-44 w-full object-cover" />
                                <span className="absolute right-3 bottom-3 rounded-full bg-nuit-950/85 px-3 py-1 font-semibold text-white tabular-nums backdrop-blur">
                                  {p.prix == null ? <span className="text-sm italic">{t('Prix sur place')}</span> : formaterPrix(p.prix)}
                                </span>
                              </button>
                            )}
                            <button
                              type="button"
                              className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-transform active:scale-[0.99] active:bg-gray-50"
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
                                    <span className="rounded-full bg-magenta-500 px-2 py-0.5 text-xs font-bold tracking-wide text-white uppercase">{t('★ Signature')}</span>
                                  )}
                                  {badges.map((b) => (
                                    <span key={b} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700" title={t('Déduit de la description — {mention}', { mention: t(MENTION_BADGE_DEDUIT) })}>
                                      {t(LIBELLES_BADGES[b])}*<span className="sr-only"> ({t(MENTION_BADGE_DEDUIT)})</span>
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
                              <span aria-hidden="true" className="chevron-detail shrink-0 text-gray-400">
                                ▾
                              </span>
                            </button>
                            {detail && (
                              <div className="depliage border-t border-gray-100">
                              <div>
                              <div className="space-y-3 px-4 py-3">
                                {p.photo && <img src={p.photo} alt={t('Photo du plat : {nom}', { nom: p.nom })} loading="lazy" className="h-56 w-full rounded-2xl object-cover" />}
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
                                    {langue === 'en'
                                      ? t('{labels} — {mention} — ask the team.', {
                                          labels: badges.map((b) => t(LIBELLES_BADGES[b])).join(' · '),
                                          mention: t(MENTION_BADGE_DEDUIT),
                                        })
                                      : // Branche FR conservée telle quelle : menu-client-p1-c5.test.ts:246 épingle
                                        // littéralement `{MENTION_BADGE_DEDUIT} auprès de l’équipe`.
                                        `${badges.map((b) => t(LIBELLES_BADGES[b])).join(' · ')} — ${MENTION_BADGE_DEDUIT} auprès de l’équipe.`}
                                  </p>
                                )}
                                {/* P1-M2 : la ligne allergènes est toujours affichée — la liste si elle est
                                    renseignée (préfixe traduit), sinon la mention explicite « demander en caisse ». */}
                                {p.allergenes.length > 0 ? (
                                  <p className="text-sm text-gray-600">{t('Allergènes :')} {p.allergenes.join(', ')}</p>
                                ) : (
                                  <p className="text-sm text-gray-600">{t(LIBELLE_ALLERGENES_ABSENTS)}</p>
                                )}
                                {signature && <p className="text-sm font-semibold text-magenta-700">{t('★ Plat signature — l’un des best-sellers du restaurant.')}</p>}
                              </div>
                              </div>
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )
              })}
            </div>
          )}
        </>
      )}
      {avecBadges && <p className="text-center text-sm text-gray-600">{t('* 🌶 / 🌱 : déduit du nom ou de la description du plat, {mention} auprès de l’équipe.', { mention: t(MENTION_BADGE_DEDUIT) })}</p>}
      {commerce.coordonnees && <p className="text-center text-sm text-gray-600">{commerce.coordonnees}</p>}
      <p className="text-center text-sm text-gray-600">{t('Allergènes : demandez conseil à l’équipe en cas de doute.')}</p>
      <p className="text-center">
        <a href={`#/bienvenue/${encodeURIComponent(commerce.id)}`} className="lien">
          {t('Découvrir le restaurant')}
        </a>
      </p>
      <PiedPublic commerceId={commerce.id} />
    </div>
    </>
  )
}

/** Plat-star plein cadre (cycle 3) : la photo du plat en très grand entre l'en-tête de sa catégorie et la liste, qui vit au
    défilement (parallaxe + zoom lent des en-têtes) ; nom révélé mot à mot, description, prix. Hauteur fixée par `.plat-star`. */
function PlatStar({ plat, voir }: { plat: Produit; voir: () => void }) {
  const { t } = useLangue()
  return (
    <div className="plat-star" data-revelation data-plat-star>
      <button
        type="button"
        onClick={voir}
        aria-label={t('Voir le plat : {nom}', { nom: plat.nom })}
        className="relative block size-full overflow-hidden rounded-3xl text-left shadow-relief transition-transform active:scale-[0.98]"
      >
        {/* Parallaxe (±28 px) : la photo déborde de 32 px en haut et en bas du cadre ; zoom lent (ken burns). */}
        <span className="cadre-parallaxe ken-burns absolute inset-x-0 -inset-y-8" data-parallaxe>
          <img src={plat.photo} alt="" loading="lazy" className="w-full object-cover" />
        </span>
        <span aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-nuit-950/95 via-nuit-950/35 to-transparent" />
        <span className="titre-cadre absolute inset-x-5 bottom-5 flex flex-col items-start gap-2">
          {estSignature(plat.nom) && (
            <span className="rounded-full bg-magenta-500 px-2 py-0.5 text-xs font-bold tracking-wide text-white uppercase">{t('★ Signature')}</span>
          )}
          <span className="titre-geant text-white" style={{ '--lettres': plusLongMot(plat.nom) } as CSSProperties}>
            <MotsReveles nom={plat.nom} />
          </span>
          {plat.description && <span className="line-clamp-3 text-sm text-white/85">{plat.description}</span>}
          <span className="rounded-full bg-nuit-950/85 px-3 py-1 font-semibold text-white tabular-nums backdrop-blur">
            {plat.prix == null ? <span className="text-sm italic">{t('Prix sur place')}</span> : formaterPrix(plat.prix)}
          </span>
        </span>
      </button>
    </div>
  )
}

/** Couche d'ambiance fixe derrière le menu Découverte : deux calques d'univers qui se croisent en opacité (~900 ms). */
function AmbianceUnivers({ univers }: { univers: number }) {
  const [couches, setCouches] = useState<Couches>({ a: univers, b: univers, devant: 'a' })
  useEffect(() => setCouches((c) => croiserCouches(c, univers)), [univers])
  return (
    <div aria-hidden="true" className="ambiance-univers" data-ambiance>
      <div className={`ambiance-couche univers-${couches.a}`} data-visible={couches.devant === 'a'} />
      <div className={`ambiance-couche univers-${couches.b}`} data-visible={couches.devant === 'b'} />
    </div>
  )
}

/** Nom de catégorie mot à mot (cycle 2) : chaque mot monte depuis son masque quand l'en-tête est révélé
    (`.revelation-attente` → `.revelation-faite`, src/lib/revelation.ts) ; visible d'emblée sinon. */
function MotsReveles({ nom }: { nom: string }) {
  return motsTitre(nom).map((mot, i) => (
    <Fragment key={i}>
      {i > 0 && ' '}
      <span className="mot-masque">
        <span className="mot">{mot}</span>
      </span>
    </Fragment>
  ))
}

/** Onglet de catégorie : `choisi` = filtre appliqué (aria-pressed), `indique` = barre sous l'onglet (catégorie à l'écran). */
function OngletCategorie({ libelle, choisi, indique, onClick }: { libelle: string; choisi: boolean; indique: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`puce relative whitespace-nowrap active:scale-95 ${indique ? 'after:absolute after:inset-x-4 after:-bottom-0.5 after:h-1 after:rounded-full after:bg-magenta-400' : ''}`}
      aria-pressed={choisi}
      aria-current={indique ? 'true' : undefined}
      onClick={onClick}
    >
      {libelle}
    </button>
  )
}

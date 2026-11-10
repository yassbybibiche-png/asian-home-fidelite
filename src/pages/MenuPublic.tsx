import { useCallback, useEffect, useMemo, useState } from 'react'
import { MESSAGE_MODE_SERVEUR, useStore } from '../store'
import { useRoute } from '../router'
import type { CommercePublic, Menu } from '../types'
import { ErreurApi } from '../data/api'
import { formaterPrix } from '../lib/points'
import { bandeauPrixManquants, filtrerMenu } from '../lib/menu'
import { LogoCommerce, PiedPublic } from '../components/ui'
import { SqueletteMenu } from '../components/Squelette'
import { estAsianHome, photoCategorie, VISUELS } from '../lib/visuels'
import { estSignature, menuReelAsianHome } from '../data/menu-reel'
import { HorsLignePublic, MessagePublic } from './Jouer'

/** Page publique #/menu/<commerceId> (QR du menu, lien depuis la carte de fidélité). */
export default function MenuPublic() {
  const { api } = useStore()
  const { param } = useRoute()
  const [donnees, setDonnees] = useState<{ menu: Menu; commerce: CommercePublic } | null>(null)
  const [erreur, setErreur] = useState<'introuvable' | 'inactif' | 'horsLigne' | null>(null)
  const [recherche, setRecherche] = useState('')
  const [categorie, setCategorie] = useState<string>('toutes')
  const [ouvert, setOuvert] = useState<string | null>(null)

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
  if (!donnees) return <SqueletteMenu libelle="Un instant, le menu arrive." />

  return <MenuAffiche menu={donnees.menu} commerce={donnees.commerce} recherche={recherche} setRecherche={setRecherche} categorie={categorie} setCategorie={setCategorie} ouvert={ouvert} setOuvert={setOuvert} />
}

function MenuAffiche({
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
  // (relevée le 10/11/2026, avec ses prix ; les 3 plats hors carte restent « Prix sur place »).
  // Dès que le commerçant enregistre son propre menu, c'est le sien qui s'affiche.
  const menuEnregistre = menu.categories.some((c) => c.produits.length > 0)
  const repliReel = !menuEnregistre && estAsianHome(commerce)
  const menuAffiche = useMemo(() => (repliReel ? menuReelAsianHome() : menu), [repliReel, menu])
  const bandeauPrix = useMemo(() => bandeauPrixManquants(menuAffiche), [menuAffiche])
  const categories = useMemo(
    () => filtrerMenu(menuAffiche.categories.filter((c) => c.produits.length), recherche),
    [menuAffiche, recherche],
  )
  const visibles = categorie === 'toutes' ? categories : categories.filter((c) => c.id === categorie)
  const total = useMemo(() => categories.reduce((s, c) => s + c.produits.length, 0), [categories])

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 pt-6 pb-10">
      <header className="hero-sombre -mx-4 rounded-b-3xl px-4 pt-6 pb-6 text-center shadow-relief">
        <div className="flex justify-center">
          <LogoCommerce commerce={commerce} taille="lg" />
        </div>
        <p className="surtitre-sombre mt-3">Menu</p>
        <h1 className="titre-or mt-1 text-2xl">{commerce.nom}</h1>
        <p className="mt-1 text-sm text-white/70">Cuisine asiatique halal · Thaï, Japon, Vietnam, Chine</p>
      </header>

      {estAsianHome(commerce) && (
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
          <div role="search">
            <label className="sr-only" htmlFor="recherche-plat">
              Rechercher un plat
            </label>
            <input
              id="recherche-plat"
              type="search"
              className="champ"
              placeholder="🔍 Rechercher un plat… (ex : dynamite, maki)"
              value={recherche}
              onChange={(e) => (setRecherche(e.target.value), setCategorie('toutes'), setOuvert(null))}
            />
          </div>

          <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Catégories">
            <button type="button" className="puce" aria-pressed={categorie === 'toutes'} onClick={() => setCategorie('toutes')}>
              Toutes
            </button>
            {categories.map((c) => (
              <button key={c.id} type="button" className="puce shrink-0 whitespace-nowrap" aria-pressed={categorie === c.id} onClick={() => setCategorie(c.id)}>
                {c.nom}
              </button>
            ))}
          </nav>

          {total === 0 ? (
            <p className="carte text-center text-gray-600" role="status">
              Aucun plat ne correspond à « {recherche} ».
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-600" role="status">
                {total} plat{total > 1 ? 's' : ''}
                {recherche ? ` pour « ${recherche} »` : ''}
              </p>
              {visibles.map((c) => {
                const photo = photoCategorie(c.nom)
                return (
                  <section key={c.id} id={`m-${c.id}`} className="space-y-2">
                    <h2 className="font-titre text-xl font-bold">{c.nom}</h2>
                    {photo && <img src={photo.src} alt={photo.alt} loading="lazy" className="h-32 w-full rounded-2xl object-cover" />}
                    <ul className="space-y-2">
                      {c.produits.map((p) => {
                        const detail = ouvert === p.id
                        const signature = estSignature(p.nom)
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
                                  {signature && (
                                    <span className="rounded-full bg-marque-500 px-2 py-0.5 text-[11px] font-bold tracking-wide text-white uppercase">★ Signature</span>
                                  )}
                                </span>
                                {p.description && !detail && <span className="mt-0.5 line-clamp-2 block text-sm text-gray-700">{p.description}</span>}
                              </span>
                              {p.prix == null ? (
                                <span className="shrink-0 text-sm text-gray-500 italic">Prix sur place</span>
                              ) : (
                                <span className="shrink-0 font-semibold text-marque-700 tabular-nums">{formaterPrix(p.prix)}</span>
                              )}
                            </button>
                            {detail && (
                              <div className="apparition space-y-3 border-t border-gray-100 px-4 py-3">
                                {p.photo && <img src={p.photo} alt={`Photo du plat : ${p.nom}`} loading="lazy" className="h-44 w-full rounded-2xl object-cover" />}
                                {p.description ? (
                                  <p className="text-sm text-gray-700">{p.description}</p>
                                ) : (
                                  <p className="text-sm text-gray-500 italic">Description à venir — demandez conseil à l’équipe.</p>
                                )}
                                <p className="text-sm">
                                  <span className="font-semibold">Prix : </span>
                                  {p.prix == null ? <span className="text-gray-500 italic">sur place</span> : <span className="font-semibold text-marque-700 tabular-nums">{formaterPrix(p.prix)}</span>}
                                </p>
                                {p.allergenes.length > 0 && <p className="text-sm text-gray-600">Allergènes : {p.allergenes.join(', ')}</p>}
                                {signature && <p className="text-sm font-semibold text-marque-700">★ Plat signature — l’un des best-sellers du restaurant.</p>}
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
      {commerce.coordonnees && <p className="text-center text-sm text-gray-600">{commerce.coordonnees}</p>}
      <p className="text-center text-xs text-gray-600">Allergènes : demandez conseil à l’équipe en cas de doute.</p>
      <PiedPublic commerceId={commerce.id} />
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { MESSAGE_MODE_SERVEUR, useStore } from '../store'
import { useRoute } from '../router'
import type { Commerce, Menu } from '../types'
import { ErreurApi } from '../data/api'
import { formaterPrix } from '../lib/points'
import { LogoCommerce } from '../components/ui'
import { estAsianHome, photoCategorie, VISUELS } from '../lib/visuels'
import { HorsLignePublic, MessagePublic } from './Jouer'

/** Page publique #/menu/<commerceId> (QR du menu, lien depuis la carte de fidélité). */
export default function MenuPublic() {
  const { api } = useStore()
  const { param } = useRoute()
  const [donnees, setDonnees] = useState<{ menu: Menu; commerce: Commerce } | null>(null)
  const [erreur, setErreur] = useState<'introuvable' | 'inactif' | 'horsLigne' | null>(null)

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
  if (!donnees) return <MessagePublic titre="Chargement…">Un instant, le menu arrive.</MessagePublic>

  const { menu, commerce } = donnees
  const categories = menu.categories.filter((c) => c.produits.length)
  return (
    <div className="mx-auto max-w-md space-y-5 px-4 pt-6 pb-10">
      {estAsianHome(commerce) && (
        <img
          src={VISUELS.tableSushis}
          alt="Table dressée chez Asian Home Paris : bao buns, plateau de sushis et cocktails"
          className="h-56 w-full rounded-3xl object-cover shadow-relief ring-1 ring-gray-900/5"
        />
      )}
      <header className="flex items-center gap-3">
        <LogoCommerce commerce={commerce} taille="lg" />
        <div className="min-w-0">
          <p className="surtitre">Menu</p>
          <h1 className="truncate font-titre text-2xl font-bold">{commerce.nom}</h1>
        </div>
      </header>
      {categories.length > 1 && (
        <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Catégories">
          {categories.map((c) => (
            <a key={c.id} href={`#/menu/${commerce.id}`} onClick={(e) => (e.preventDefault(), document.getElementById(`m-${c.id}`)?.scrollIntoView({ behavior: 'smooth' }))} className="puce shrink-0 whitespace-nowrap">
              {c.nom}
            </a>
          ))}
        </nav>
      )}
      {categories.length === 0 ? (
        <MessagePublic titre="Menu à venir">Le commerce n’a pas encore publié son menu.</MessagePublic>
      ) : (
        categories.map((c) => {
          const photo = photoCategorie(c.nom)
          return (
            <section key={c.id} id={`m-${c.id}`} className="space-y-2">
              <h2 className="font-titre text-xl font-bold">{c.nom}</h2>
              {photo && <img src={photo.src} alt={photo.alt} loading="lazy" className="h-32 w-full rounded-2xl object-cover" />}
              <ul className="space-y-2">
              {c.produits.map((p) => (
                <li key={p.id} className="carte flex gap-3">
                  {p.photo && <img src={p.photo} alt="" loading="lazy" className="h-20 w-20 shrink-0 rounded-xl object-cover" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="font-semibold">{p.nom}</h3>
                      <span className="shrink-0 font-semibold text-marque-700 tabular-nums">{formaterPrix(p.prix)}</span>
                    </div>
                    {p.description && <p className="text-sm text-gray-700">{p.description}</p>}
                    {p.allergenes.length > 0 && <p className="mt-1 text-xs text-gray-600">Allergènes : {p.allergenes.join(', ')}</p>}
                  </div>
                </li>
              ))}
              </ul>
            </section>
          )
        })
      )}
      {commerce.coordonnees && <p className="text-center text-sm text-gray-600">{commerce.coordonnees}</p>}
      <p className="text-center text-xs text-gray-600">Allergènes : demandez conseil à l’équipe en cas de doute.</p>
    </div>
  )
}

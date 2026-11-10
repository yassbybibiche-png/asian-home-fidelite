import { useEffect, useState } from 'react'
import { MESSAGE_MODE_SERVEUR, messageErreur, useAction, useStore } from '../store'
import { urlAbsolue } from '../router'
import type { CategorieMenu, Produit } from '../types'
import { ALLERGENES, LIMITES_MENU } from '../lib/menu'
import { analyserMontant } from '../lib/points'
import { BoutonCopier, EnTete, MessageErreur, QrCode, Vide } from '../components/ui'
import { estAsianHome } from '../lib/visuels'
import { COMPTE_PLATS_REELS, menuReelAsianHome } from '../data/menu-reel'

type ProduitEdite = Omit<Produit, 'prix'> & { prix: string }
type CategorieEditee = Omit<CategorieMenu, 'produits'> & { produits: ProduitEdite[] }

const idLocal = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const versEdition = (cats: CategorieMenu[]): CategorieEditee[] =>
  cats.map((c) => ({ ...c, produits: c.produits.map((p) => ({ ...p, prix: p.prix == null ? '' : (p.prix / 100).toFixed(2).replace('.', ',') })) }))

/** Photo choisie sur l'appareil → JPEG redimensionné (≤ 480 px) et compressé sous 60 Ko. */
async function compresserPhoto(fichier: File): Promise<string> {
  const image = await createImageBitmap(fichier)
  const echelle = Math.min(1, 480 / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(image.width * echelle)
  canvas.height = Math.round(image.height * echelle)
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
  for (const qualite of [0.8, 0.65, 0.5, 0.35]) {
    const url = canvas.toDataURL('image/jpeg', qualite)
    if (url.length <= LIMITES_MENU.photoOctets * 1.3) return url
  }
  throw new Error('Photo trop lourde même compressée : choisissez une image plus petite.')
}

/** Menu digital : catégories, produits, prix, photo, allergènes ; page publique + QR vitrine du menu. */
export default function MenuCarte() {
  const { mode, api, commerce, avecPin } = useStore()
  const [categories, setCategories] = useState<CategorieEditee[] | null>(null)
  const [erreurChargement, setErreurChargement] = useState<string | null>(null)
  const { executer, enCours, erreur } = useAction()
  const [enregistre, setEnregistre] = useState(false)
  const lien = urlAbsolue('menu', commerce.id)

  useEffect(() => {
    if (!api) return
    api.menu(commerce.id).then(
      (r) => setCategories(versEdition(r.menu.categories)),
      (e) => setErreurChargement(messageErreur(e)),
    )
  }, [api, commerce.id])

  if (mode === 'local') {
    return (
      <div>
        <EnTete titre="Menu" />
        <Vide>{MESSAGE_MODE_SERVEUR}</Vide>
      </div>
    )
  }
  if (!categories) return erreurChargement ? <MessageErreur>{erreurChargement}</MessageErreur> : <p className="text-gray-600">Chargement du menu…</p>

  const majCat = (i: number, c: CategorieEditee | null) => {
    setEnregistre(false)
    setCategories((cs) => (c ? cs!.map((x, j) => (j === i ? c : x)) : cs!.filter((_, j) => j !== i)))
  }
  const prixInvalide = categories.some((c) => c.produits.some((p) => p.prix.trim() && analyserMontant(p.prix) === null))

  async function enregistrer() {
    const menu = {
      categories: categories!.map((c) => ({ ...c, produits: c.produits.map((p) => ({ ...p, prix: p.prix.trim() ? (analyserMontant(p.prix) ?? 0) : null })) })),
    }
    const r = await executer(() => avecPin((a, cli) => cli.majMenu(commerce.id, a, menu)))
    if (r.ok) {
      setCategories(versEdition(r.valeur.categories))
      setEnregistre(true)
    }
  }

  return (
    <div className="space-y-5">
      <EnTete titre="Menu" sousTitre="Votre carte en ligne : visible par les clients depuis leur carte de fidélité et le QR du menu." />

      <section className="carte space-y-3">
        <h2 className="titre-carte">QR code du menu</h2>
        <div className="flex justify-center">
          <div className="rounded-2xl bg-white p-2 ring-2 ring-marque-500">
            <QrCode texte={lien} className="h-40 w-40" titre="QR code du menu" />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <a href={`#/menu/${commerce.id}`} className="bouton-secondaire w-full">
            Voir le menu public ↗
          </a>
          <BoutonCopier texte={lien} libelle="Copier le lien du menu" className="bouton-secondaire w-full" />
        </div>
      </section>

      {estAsianHome(commerce) && (
        <section className="carte space-y-2">
          <h2 className="titre-carte">Vraie carte du restaurant</h2>
          <p className="text-sm text-gray-700">
            Charge les {COMPTE_PLATS_REELS} plats réels d’Asian Home (relevés sur Uber Eats) dans l’éditeur ci-dessous, avec leurs photos. Les prix
            n’ont pas pu être vérifiés : ils restent vides et s’affichent « Prix sur place » tant que vous ne les renseignez pas.
          </p>
          <button
            type="button"
            className="bouton-secondaire w-full"
            onClick={() => {
              const existants = categories.some((c) => c.produits.length > 0)
              if (existants && !window.confirm('Remplacer le menu actuel par la vraie carte du restaurant (39 plats) ? Les modifications non enregistrées seront perdues.')) return
              setEnregistre(false)
              setCategories(versEdition(menuReelAsianHome().categories))
            }}
          >
            📖 Charger la vraie carte d’Asian Home ({COMPTE_PLATS_REELS} plats)
          </button>
          <p className="text-xs text-gray-600">Pensez à « Enregistrer le menu » ensuite : la carte devient votre menu publié, modifiable à tout moment.</p>
        </section>
      )}

      {categories.map((c, i) => (
        <EditeurCategorie key={c.id} categorie={c} onChange={(x) => majCat(i, x)} />
      ))}

      <button
        type="button"
        className="bouton-secondaire w-full"
        disabled={categories.length >= LIMITES_MENU.categories}
        onClick={() => (setEnregistre(false), setCategories((cs) => [...cs!, { id: idLocal('cat'), nom: '', produits: [] }]))}
      >
        + Ajouter une catégorie
      </button>

      <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 space-y-2 md:bottom-4">
        <MessageErreur>{erreur && `Menu non enregistré : ${erreur}`}</MessageErreur>
        {prixInvalide && <MessageErreur>Chaque prix renseigné doit être valide (ex : 6,50). Un prix vide s’affiche « Prix sur place ».</MessageErreur>}
        <button className="bouton w-full shadow-lg" disabled={enCours || prixInvalide} onClick={() => void enregistrer()}>
          {enCours ? 'Enregistrement…' : enregistre ? '✓ Menu enregistré' : 'Enregistrer le menu'}
        </button>
      </div>
    </div>
  )
}

function EditeurCategorie({ categorie, onChange }: { categorie: CategorieEditee; onChange(c: CategorieEditee | null): void }) {
  const majProduit = (i: number, p: ProduitEdite | null) =>
    onChange({ ...categorie, produits: p ? categorie.produits.map((x, j) => (j === i ? p : x)) : categorie.produits.filter((_, j) => j !== i) })
  return (
    <fieldset className="carte space-y-3">
      <legend className="sr-only">Catégorie {categorie.nom}</legend>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label className="etiquette" htmlFor={`cat-${categorie.id}`}>
            Catégorie
          </label>
          <input id={`cat-${categorie.id}`} className="champ" placeholder="ex : Entrées" maxLength={60} value={categorie.nom} onChange={(e) => onChange({ ...categorie, nom: e.target.value })} />
        </div>
        <button
          type="button"
          className="h-12 shrink-0 rounded-xl px-3 text-sm font-semibold text-red-800 ring-1 ring-red-200"
          onClick={() => window.confirm(`Supprimer la catégorie « ${categorie.nom || 'sans nom'} » et ses produits ?`) && onChange(null)}
        >
          Supprimer
        </button>
      </div>
      <ul className="space-y-3">
        {categorie.produits.map((p, i) => (
          <EditeurProduit key={p.id} produit={p} onChange={(x) => majProduit(i, x)} />
        ))}
      </ul>
      <button
        type="button"
        className="bouton-secondaire w-full"
        onClick={() => onChange({ ...categorie, produits: [...categorie.produits, { id: idLocal('p'), nom: '', prix: '', allergenes: [] }] })}
      >
        + Ajouter un produit
      </button>
    </fieldset>
  )
}

function EditeurProduit({ produit, onChange }: { produit: ProduitEdite; onChange(p: ProduitEdite | null): void }) {
  const [erreurPhoto, setErreurPhoto] = useState<string | null>(null)
  const maj = <K extends keyof ProduitEdite>(k: K, v: ProduitEdite[K]) => onChange({ ...produit, [k]: v })
  const id = produit.id
  return (
    <li className="space-y-2 rounded-xl bg-gray-50 p-3 ring-1 ring-gray-900/5">
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <label className="etiquette" htmlFor={`nom-${id}`}>
            Produit
          </label>
          <input id={`nom-${id}`} className="champ" maxLength={80} value={produit.nom} onChange={(e) => maj('nom', e.target.value)} />
        </div>
        <div className="w-28 shrink-0">
          <label className="etiquette" htmlFor={`prix-${id}`}>
            Prix (€) — vide = sur place
          </label>
          <input id={`prix-${id}`} className="champ text-right" inputMode="decimal" placeholder="6,50" value={produit.prix} onChange={(e) => maj('prix', e.target.value)} />
        </div>
      </div>
      <div>
        <label className="etiquette" htmlFor={`desc-${id}`}>
          Description (optionnelle)
        </label>
        <input id={`desc-${id}`} className="champ" maxLength={300} value={produit.description ?? ''} onChange={(e) => maj('description', e.target.value)} />
      </div>
      <div>
        <label className="etiquette" htmlFor={`photo-${id}`}>
          Photo : adresse https://… ou image de l’appareil
        </label>
        <div className="flex items-center gap-2">
          {produit.photo && <img src={produit.photo} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />}
          <input
            id={`photo-${id}`}
            className="champ min-w-0"
            placeholder="https://…"
            value={produit.photo?.startsWith('data:') ? '(image importée)' : (produit.photo ?? '')}
            onChange={(e) => maj('photo', e.target.value)}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <label className="bouton-secondaire min-h-11 cursor-pointer text-sm">
            Choisir une image
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                try {
                  setErreurPhoto(null)
                  maj('photo', await compresserPhoto(f))
                } catch (err) {
                  setErreurPhoto(messageErreur(err))
                }
              }}
            />
          </label>
          {produit.photo && (
            <button type="button" className="min-h-11 px-2 text-sm font-semibold text-gray-700 underline" onClick={() => maj('photo', undefined)}>
              Retirer la photo
            </button>
          )}
        </div>
        <MessageErreur>{erreurPhoto}</MessageErreur>
      </div>
      <details>
        <summary className="min-h-11 cursor-pointer py-2 font-medium">Allergènes ({produit.allergenes.length})</summary>
        <div className="grid grid-cols-2 gap-1">
          {ALLERGENES.map((a) => (
            <label key={a} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={produit.allergenes.includes(a)}
                onChange={(e) => maj('allergenes', e.target.checked ? [...produit.allergenes, a] : produit.allergenes.filter((x) => x !== a))}
              />
              {a}
            </label>
          ))}
        </div>
      </details>
      <button type="button" className="min-h-11 text-sm font-semibold text-red-800 underline" onClick={() => onChange(null)}>
        Supprimer ce produit
      </button>
    </li>
  )
}

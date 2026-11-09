// Menu digital : validation partagée (le serveur refuse tout menu invalide, le front affiche les mêmes erreurs).
import type { CategorieMenu, Menu, Produit } from '../types'

/** Les 14 allergènes à déclarer (règlement UE 1169/2011). */
export const ALLERGENES = [
  'Gluten',
  'Crustacés',
  'Œufs',
  'Poissons',
  'Arachides',
  'Soja',
  'Lait',
  'Fruits à coque',
  'Céleri',
  'Moutarde',
  'Sésame',
  'Sulfites',
  'Lupin',
  'Mollusques',
]

export const LIMITES_MENU = { categories: 20, produits: 60, photoOctets: 60_000 }

const PHOTO = /^(https:\/\/\S{1,500}|data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+)$/

export class ErreurMenu extends Error {}

function chaine(v: unknown, champ: string, max: number, requis = false): string {
  if (v == null) v = ''
  if (typeof v !== 'string') throw new ErreurMenu(`« ${champ} » doit être un texte.`)
  const s = v.trim()
  if (requis && !s) throw new ErreurMenu(`« ${champ} » est obligatoire.`)
  if (s.length > max) throw new ErreurMenu(`« ${champ} » est trop long (${max} caractères maximum).`)
  return s
}

/** Valide et normalise un menu reçu (JSON). Lève ErreurMenu avec un message en français. */
export function validerMenu(brut: unknown, commerceId: string, maintenant: Date): Menu {
  const o = (brut ?? {}) as { categories?: unknown }
  if (!Array.isArray(o.categories) || o.categories.length > LIMITES_MENU.categories) throw new ErreurMenu(`« categories » : liste de ${LIMITES_MENU.categories} catégories maximum.`)
  let total = 0
  const ids = new Set<string>()
  const id = (v: unknown, prefixe: string, i: number) => {
    const s = typeof v === 'string' && /^[\w-]{1,60}$/.test(v) ? v : `${prefixe}-${i}-${Math.random().toString(36).slice(2, 8)}`
    if (ids.has(s)) throw new ErreurMenu('Identifiant en double dans le menu.')
    ids.add(s)
    return s
  }
  const categories: CategorieMenu[] = o.categories.map((c: unknown, i) => {
    const cat = (c ?? {}) as Record<string, unknown>
    const nomCat = chaine(cat.nom, `catégorie n° ${i + 1}`, 60, true)
    if (!Array.isArray(cat.produits)) throw new ErreurMenu(`Catégorie « ${nomCat} » : « produits » doit être une liste.`)
    total += cat.produits.length
    if (total > LIMITES_MENU.produits) throw new ErreurMenu(`${LIMITES_MENU.produits} produits maximum dans le menu.`)
    const produits: Produit[] = cat.produits.map((p: unknown, j) => {
      const pr = (p ?? {}) as Record<string, unknown>
      const nom = chaine(pr.nom, `produit n° ${j + 1} de « ${nomCat} »`, 80, true)
      const prix = pr.prix
      if (typeof prix !== 'number' || !Number.isInteger(prix) || prix < 0 || prix > 1_000_000) throw new ErreurMenu(`« ${nom} » : prix invalide.`)
      const photo = chaine(pr.photo, `photo de « ${nom} »`, LIMITES_MENU.photoOctets * 1.4)
      if (photo && !PHOTO.test(photo)) throw new ErreurMenu(`« ${nom} » : photo = adresse https://… ou image JPEG / PNG / WebP.`)
      if (photo.startsWith('data:') && photo.length > LIMITES_MENU.photoOctets * 1.37) throw new ErreurMenu(`« ${nom} » : photo trop lourde (60 Ko maximum après compression).`)
      const allergenes = Array.isArray(pr.allergenes) ? pr.allergenes : []
      if (!allergenes.every((a) => ALLERGENES.includes(a as string))) throw new ErreurMenu(`« ${nom} » : allergène inconnu.`)
      const produit: Produit = { id: id(pr.id, 'p', j), nom, prix, allergenes: ALLERGENES.filter((a) => allergenes.includes(a)) }
      const description = chaine(pr.description, `description de « ${nom} »`, 300)
      if (description) produit.description = description
      if (photo) produit.photo = photo
      return produit
    })
    return { id: id(cat.id, 'cat', i), nom: nomCat, produits }
  })
  return { commerceId, categories, majLe: maintenant.toISOString() }
}

export const menuVide = (commerceId: string): Menu => ({ commerceId, categories: [], majLe: '' })

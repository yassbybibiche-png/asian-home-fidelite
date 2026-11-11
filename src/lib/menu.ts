// Menu digital : validation partagée (le serveur refuse tout menu invalide, le front affiche les mêmes erreurs).
import type { CategorieMenu, Menu, Produit } from '../types'
import { sansAccents } from './recherche.ts'
import { celluleCsv } from './csv.ts'

/** Prix non vérifié : affiché tel quel, jamais remplacé par un montant inventé. */
export const LIBELLE_PRIX_ABSENT = 'Prix sur place'

/**
 * Mention affichée pour un plat dont les allergènes ne sont pas renseignés (P1-M2) : explicite,
 * pour ne jamais laisser croire que le plat est sans allergène. Tant que le commerçant n'a fourni
 * aucun allergène, les 81 plats affichent cette mention.
 */
export const LIBELLE_ALLERGENES_ABSENTS = 'Allergènes : demander en caisse'

/** Libellé allergènes d'un plat : la liste si elle est renseignée, sinon la mention explicite. */
export function libelleAllergenes(produit: Pick<Produit, 'allergenes'>): string {
  return produit.allergenes.length > 0 ? `Allergènes : ${produit.allergenes.join(', ')}` : LIBELLE_ALLERGENES_ABSENTS
}

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

// 120 produits : la carte officielle d'Asian Home compte 81 plats (78 tarifés + 3 hors carte),
// l'ancienne limite de 60 la refusait ; marge pour les ajouts du commerçant.
export const LIMITES_MENU = { categories: 20, produits: 120, photoOctets: 60_000 }

const PHOTO = /^(https:\/\/\S{1,500}|data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+|\/visuels\/[\w\-]+\.(?:jpg|jpeg|png|webp))$/

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
      const prixBrut = pr.prix
      // Prix absent (null / absent) = prix non vérifié, affiché « Prix sur place » — jamais 0 € inventé.
      const prix = prixBrut == null ? null : prixBrut
      if (prix !== null && (typeof prix !== 'number' || !Number.isInteger(prix) || prix < 0 || prix > 1_000_000)) throw new ErreurMenu(`« ${nom} » : prix invalide.`)
      const image = (v: unknown, champ: string) => {
        const s = chaine(v, `${champ} de « ${nom} »`, LIMITES_MENU.photoOctets * 1.4)
        if (s && !PHOTO.test(s)) throw new ErreurMenu(`« ${nom} » : ${champ} = adresse https://…, image JPEG / PNG / WebP, ou visuel local /visuels/…`)
        if (s.startsWith('data:') && s.length > LIMITES_MENU.photoOctets * 1.37) throw new ErreurMenu(`« ${nom} » : ${champ} trop lourde (60 Ko maximum après compression).`)
        return s
      }
      const photo = image(pr.photo, 'photo')
      const photoVignette = image(pr.photoVignette, 'vignette')
      // Visuel local : doit exister dans public/visuels/ (vérifié par les tests, pas ici — le serveur n'a pas accès au bundle front).
      const allergenes = Array.isArray(pr.allergenes) ? pr.allergenes : []
      if (!allergenes.every((a) => ALLERGENES.includes(a as string))) throw new ErreurMenu(`« ${nom} » : allergène inconnu.`)
      const produit: Produit = { id: id(pr.id, 'p', j), nom, prix, allergenes: ALLERGENES.filter((a) => allergenes.includes(a)) }
      const description = chaine(pr.description, `description de « ${nom} »`, 300)
      if (description) produit.description = description
      if (photo) produit.photo = photo
      if (photoVignette) produit.photoVignette = photoVignette
      return produit
    })
    return { id: id(cat.id, 'cat', i), nom: nomCat, produits }
  })
  return { commerceId, categories, majLe: maintenant.toISOString() }
}

export const menuVide = (commerceId: string): Menu => ({ commerceId, categories: [], majLe: '' })

/** Vrai si le plat correspond à la recherche (nom ou description, insensible aux accents et à la casse). */
export function correspondPlat(produit: Pick<Produit, 'nom' | 'description'>, saisie: string): boolean {
  const q = sansAccents(saisie.trim())
  if (!q) return true
  return sansAccents(produit.nom).includes(q) || sansAccents(produit.description ?? '').includes(q)
}

/** Catégories filtrées par recherche : seules les catégories avec au moins un plat correspondant restent. */
export function filtrerMenu(categories: CategorieMenu[], saisie: string): CategorieMenu[] {
  if (!saisie.trim()) return categories
  return categories
    .map((c) => ({ ...c, produits: c.produits.filter((p) => correspondPlat(p, saisie)) }))
    .filter((c) => c.produits.length > 0)
}

/** Nombre de plats d'un menu. */
export function compterPlats(menu: Pick<Menu, 'categories'>): number {
  return menu.categories.reduce((s, c) => s + c.produits.length, 0)
}

/**
 * Bandeau du menu public : seulement si au moins un plat affiché est sans prix
 * (repli ou menu enregistré partiel) ; null si tous les prix sont renseignés.
 */
export function bandeauPrixManquants(menu: Pick<Menu, 'categories'>): string | null {
  const plats = menu.categories.flatMap((c) => c.produits)
  const sansPrix = plats.filter((p) => p.prix == null).length
  if (!sansPrix) return null
  return sansPrix === plats.length
    ? 'Carte du restaurant — les prix ne sont pas encore renseignés dans l’app : ils sont affichés sur place.'
    : 'Certains prix ne sont pas encore renseignés dans l’app : ils sont indiqués « Prix sur place ».'
}

// ---------- Import / export CSV du menu ----------
// Ici plutôt que dans csv.ts : l'import réutilise les règles de validerMenu (ErreurMenu,
// ALLERGENES, LIMITES_MENU) ; csv.ts ne fournit que l'encodage d'une cellule.

export const COLONNES_CSV_MENU = ['categorie', 'nom', 'prix', 'description', 'photo', 'allergenes'] as const
/**
 * Colonne optionnelle (lot P1-B2), en dernière position : exportée seulement si un plat a une vignette
 * — un menu sans vignette garde exactement le format B1. À l'import, colonne absente = pas de vignette.
 */
export const COLONNE_CSV_VIGNETTE = 'photo_vignette'
type ColonneCsv = (typeof COLONNES_CSV_MENU)[number] | typeof COLONNE_CSV_VIGNETTE

/** Prix en centimes → « 6,50 » (vide = prix null), même format que l'éditeur. */
export const prixEnTexte = (prix: number | null): string => (prix == null ? '' : (prix / 100).toFixed(2).replace('.', ','))

/** Menu → CSV « à la française » (séparateur ;, BOM UTF-8), une ligne par plat. */
export function menuEnCsv(menu: Pick<Menu, 'categories'>): string {
  const vignettes = menu.categories.some((c) => c.produits.some((p) => p.photoVignette))
  const lignes = menu.categories.flatMap((c) =>
    c.produits.map((p) =>
      [c.nom, p.nom, prixEnTexte(p.prix), p.description ?? '', p.photo ?? '', p.allergenes.join('|'), ...(vignettes ? [p.photoVignette ?? ''] : [])].map(celluleCsv).join(';'),
    ),
  )
  const entete = [...COLONNES_CSV_MENU, ...(vignettes ? [COLONNE_CSV_VIGNETTE] : [])]
  return '﻿' + [entete.join(';'), ...lignes].join('\r\n') + '\r\n'
}

/** Nom du fichier de sauvegarde / d'export : menu-avant-remplacement-AAAA-MM-JJ.csv (date locale). */
export function nomFichierMenuCsv(date: Date): string {
  const d = (n: number) => String(n).padStart(2, '0')
  return `menu-avant-remplacement-${date.getFullYear()}-${d(date.getMonth() + 1)}-${d(date.getDate())}.csv`
}

/** Découpe un CSV (guillemets doublés, retours ligne dans les champs guillemetés) ; chaque ligne garde son numéro (1 = première). */
function lireCsv(texte: string, sep: string): { ligne: number; cellules: string[] }[] {
  const lignes: { ligne: number; cellules: string[] }[] = []
  let cellules: string[] = []
  let cellule = ''
  let guillemets = false
  let ligne = 1
  let debut = 1
  const finCellule = () => (cellules.push(cellule), (cellule = ''))
  const finLigne = () => (finCellule(), lignes.push({ ligne: debut, cellules }), (cellules = []))
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i]
    if (guillemets) {
      if (c === '"' && texte[i + 1] === '"') (cellule += '"'), i++
      else if (c === '"') guillemets = false
      else {
        if (c === '\n') ligne++
        cellule += c
      }
    } else if (c === '"' && cellule === '') guillemets = true
    else if (c === sep) finCellule()
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i++
      finLigne()
      debut = ++ligne
    } else cellule += c
  }
  if (guillemets) throw new ErreurMenu(`Ligne ${debut} : guillemet ouvert jamais refermé.`)
  if (cellule !== '' || cellules.length) finLigne()
  return lignes
}

/** « 6,50 », « 6.50 », « 6 », « 6,50 € » → centimes ; vide → null ; sinon undefined (invalide). */
function prixDepuisTexte(s: string): number | null | undefined {
  const t = s.replace(/\s|€/g, '')
  if (!t) return null
  const m = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(t)
  if (!m) return undefined
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}

/** Annule la neutralisation anti-formule de celluleCsv (« '=… » → « =… »). */
const sansApostropheFormule = (s: string) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s)

/**
 * CSV (export de menuEnCsv, ou fichier Excel en ; ou en ,) → Menu validé.
 * Mêmes règles que validerMenu ; erreurs en français avec le numéro de ligne. Lève ErreurMenu.
 */
export function menuDepuisCsv(texte: string, commerceId: string, maintenant: Date): Menu {
  const brut = texte.replace(/^﻿/, '')
  const sep = brut.includes(';') ? ';' : ','
  const lignes = lireCsv(brut, sep).filter((l) => l.cellules.some((c) => c.trim()))
  if (!lignes.length) throw new ErreurMenu('Fichier vide : aucune ligne à importer.')
  const [entete, ...donnees] = lignes
  const noms = entete.cellules.map((c) => sansAccents(c.trim().toLowerCase()))
  const col = Object.fromEntries([...COLONNES_CSV_MENU, COLONNE_CSV_VIGNETTE].map((k) => [k, noms.indexOf(k)])) as Record<ColonneCsv, number>
  if (col.categorie < 0 || col.nom < 0) throw new ErreurMenu(`Ligne ${entete.ligne} : en-tête attendu « ${COLONNES_CSV_MENU.join(';')} ».`)
  if (!donnees.length) throw new ErreurMenu('Aucun plat dans le fichier (seulement l’en-tête).')

  const categories: { id: string; nom: string; produits: unknown[] }[] = []
  let total = 0
  for (const { ligne, cellules } of donnees) {
    const val = (k: ColonneCsv) => (col[k] < 0 ? '' : sansApostropheFormule((cellules[col[k]] ?? '').trim()))
    const erreur = (m: string) => new ErreurMenu(`Ligne ${ligne} : ${m}`)
    const nomCat = val('categorie')
    const nom = val('nom')
    if (!nomCat) throw erreur('la catégorie est obligatoire.')
    if (!nom) throw erreur('le nom du plat est obligatoire.')
    const prix = prixDepuisTexte(val('prix'))
    if (prix === undefined) throw erreur(`prix « ${val('prix')} » invalide (ex : 6,50 ; vide = « ${LIBELLE_PRIX_ABSENT} »).`)
    if (prix !== null && prix > 1_000_000) throw erreur('prix trop élevé (10 000 € maximum).')
    const allergenes: string[] = []
    for (const a of val('allergenes').split('|').map((x) => x.trim()).filter(Boolean)) {
      const connu = ALLERGENES.find((x) => sansAccents(x.toLowerCase()) === sansAccents(a.toLowerCase()))
      if (!connu) throw erreur(`allergène inconnu « ${a} » (liste : ${ALLERGENES.join(', ')}).`)
      allergenes.push(connu)
    }
    const produit = { nom, prix, description: val('description'), photo: val('photo'), photoVignette: val(COLONNE_CSV_VIGNETTE), allergenes }
    // Règles de forme (longueurs, photo) : celles de validerMenu, ramenées à la ligne fautive.
    try {
      validerMenu({ categories: [{ nom: nomCat, produits: [produit] }] }, commerceId, maintenant)
    } catch (e) {
      if (e instanceof ErreurMenu) throw erreur(e.message)
      throw e
    }
    let cat = categories.find((c) => c.nom === nomCat)
    if (!cat) {
      if (categories.length >= LIMITES_MENU.categories) throw erreur(`${LIMITES_MENU.categories} catégories maximum dans le menu.`)
      cat = { id: `csv-c${categories.length + 1}`, nom: nomCat, produits: [] }
      categories.push(cat)
    }
    if (++total > LIMITES_MENU.produits) throw erreur(`${LIMITES_MENU.produits} produits maximum dans le menu.`)
    cat.produits.push({ ...produit, id: `${cat.id}-p${cat.produits.length + 1}` })
  }
  return validerMenu({ categories }, commerceId, maintenant)
}

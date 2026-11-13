// Commande à table (Expérience 10/10) : calcul du panier et cycle de vie d'une commande, logique pure partagée.
// Le navigateur n'envoie que des identifiants de produits, des quantités et des noms d'options : noms et prix sont
// TOUJOURS relus du menu enregistré (un prix envoyé par le client n'est jamais lu).
import type { LigneCommande, Menu, OptionProduit, Produit, StatutCommande } from '../types'

/** Jour à Paris (AAAA-MM-JJ) : celui des relances, réutilisé pour l'index des commandes du jour. */
export { jourParis } from './relances.ts'

export const LIMITES_COMMANDE = { lignes: 30, quantite: 20, instructions: 300 }

export const STATUTS_COMMANDE: readonly StatutCommande[] = ['recue', 'acceptee', 'refusee', 'en_preparation', 'servie']

export type CodeErreurCommande =
  | 'format'
  | 'panier_vide'
  | 'trop_de_lignes'
  | 'produit_inconnu'
  | 'prix_absent'
  | 'indisponible'
  | 'option_inconnue'
  | 'quantite'
  | 'instructions'

export interface ErreurCalculCommande {
  ok: false
  code: CodeErreurCommande
  message: string
}

export type ResultatCommande = { ok: true; lignes: LigneCommande[]; total: number } | ErreurCalculCommande

/** Ligne demandée par le navigateur (tout autre champ, prix compris, est ignoré). */
export interface DemandeLigne {
  produitId: string
  quantite: number
  options?: string[]
  instructions?: string
}

const refus = (code: CodeErreurCommande, message: string): ErreurCalculCommande => ({ ok: false, code, message })

/**
 * Instructions libres (ligne ou commande) : texte, espaces autour retirés, 300 caractères au plus ; vide = absentes.
 * Renvoie le texte nettoyé, `undefined` (absentes) ou une erreur.
 */
export function lireInstructions(v: unknown, quoi = 'Les instructions'): string | undefined | ErreurCalculCommande {
  if (v == null) return undefined
  if (typeof v !== 'string') return refus('format', `${quoi} doivent être un texte.`)
  const s = v.trim()
  if (s.length > LIMITES_COMMANDE.instructions) return refus('instructions', `${quoi} sont trop longues (${LIMITES_COMMANDE.instructions} caractères maximum).`)
  return s || undefined
}

const estErreur = (v: unknown): v is ErreurCalculCommande => typeof v === 'object' && v !== null && (v as { ok?: unknown }).ok === false

/**
 * Lignes et total (centimes) d'une commande, calculés depuis le MENU enregistré. Refus (message en français) : panier
 * vide ou de plus de 30 lignes, produit inconnu, sans prix vérifié (`prix: null`) ou `indisponible`, option qui n'est
 * pas proposée pour ce produit (comparée par nom exact) ou en double, quantité hors 1–20, instructions > 300 caractères.
 */
export function calculerCommande(menu: Pick<Menu, 'categories'> | undefined, demande: unknown): ResultatCommande {
  if (!Array.isArray(demande)) return refus('format', 'Le panier doit être une liste de plats.')
  if (!demande.length) return refus('panier_vide', 'Votre panier est vide : ajoutez au moins un plat.')
  if (demande.length > LIMITES_COMMANDE.lignes) return refus('trop_de_lignes', `Une commande compte ${LIMITES_COMMANDE.lignes} lignes au plus : passez le reste dans une seconde commande.`)
  const produits = new Map<string, Produit>()
  for (const c of menu?.categories ?? []) for (const p of c.produits) produits.set(p.id, p)
  const lignes: LigneCommande[] = []
  let total = 0
  for (const brut of demande) {
    const d = (brut ?? {}) as Partial<Record<keyof DemandeLigne, unknown>>
    const produit = typeof d.produitId === 'string' ? produits.get(d.produitId) : undefined
    if (!produit) return refus('produit_inconnu', 'Un plat de votre panier n’est plus à la carte : retirez-le puis validez à nouveau.')
    if (produit.prix === null) return refus('prix_absent', `« ${produit.nom} » n’a pas de prix en ligne : commandez-le directement auprès du personnel.`)
    if (produit.indisponible) return refus('indisponible', `« ${produit.nom} » n’est plus disponible pour le moment : retirez-le de votre panier.`)
    const q = d.quantite
    if (typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > LIMITES_COMMANDE.quantite) {
      return refus('quantite', `« ${produit.nom} » : la quantité doit être comprise entre 1 et ${LIMITES_COMMANDE.quantite}.`)
    }
    if (d.options != null && !Array.isArray(d.options)) return refus('format', `« ${produit.nom} » : les options doivent être une liste.`)
    const options: OptionProduit[] = []
    for (const nom of (d.options ?? []) as unknown[]) {
      const option = typeof nom === 'string' ? produit.options?.find((o) => o.nom === nom) : undefined
      if (!option) return refus('option_inconnue', `« ${produit.nom} » : option non proposée${typeof nom === 'string' ? ` (« ${nom.slice(0, 40)} »)` : ''}.`)
      if (options.some((o) => o.nom === option.nom)) return refus('option_inconnue', `« ${produit.nom} » : l’option « ${option.nom} » est choisie deux fois.`)
      options.push({ nom: option.nom, prix: option.prix })
    }
    const instructions = lireInstructions(d.instructions, `« ${produit.nom} » : les instructions`)
    if (estErreur(instructions)) return instructions
    const ligne: LigneCommande = { produitId: produit.id, nom: produit.nom, prixUnitaire: produit.prix, quantite: q, options }
    if (instructions) ligne.instructions = instructions
    lignes.push(ligne)
    total += (produit.prix + options.reduce((s, o) => s + o.prix, 0)) * q
  }
  return { ok: true, lignes, total }
}

const TRANSITIONS: Record<StatutCommande, readonly StatutCommande[]> = {
  recue: ['acceptee', 'refusee'],
  acceptee: ['en_preparation'],
  en_preparation: ['servie'],
  refusee: [],
  servie: [],
}

/** Seules transitions permises : recue → acceptee | refusee, acceptee → en_preparation, en_preparation → servie. */
export function transitionValide(de: StatutCommande, vers: StatutCommande): boolean {
  return TRANSITIONS[de]?.includes(vers) ?? false
}

export const estStatutCommande = (v: unknown): v is StatutCommande => typeof v === 'string' && (STATUTS_COMMANDE as readonly string[]).includes(v)

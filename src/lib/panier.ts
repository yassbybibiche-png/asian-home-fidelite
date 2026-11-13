// Panier de la commande à table (Expérience 10/10, lot 2) : logique pure, testée sans React
// (tests/experience-lot2.test.ts). La page est src/pages/Commande.tsx.
// Montants en centimes. Le serveur recalcule TOUT depuis le menu en base (src/lib/commande.ts) : ce total n'est
// qu'un affichage ; le panier n'envoie que des identifiants, des quantités, des noms d'options et des instructions.
// Pas d'import de commande.ts ici : il réexporte `jourParis` de relances.ts, qui tirerait la fidélité dans le
// fichier de la page.
import type { OptionProduit, Produit } from '../types'

/** Quantité par ligne : 1 à 20, comme le serveur (`LIMITES_COMMANDE.quantite`, vérifié par le test). */
export const QUANTITE_MIN = 1
export const QUANTITE_MAX = 20
/** Lignes par commande et longueur des instructions : mêmes bornes que le serveur. */
export const LIGNES_MAX = 30
export const INSTRUCTIONS_MAX = 300

export interface LignePanier {
  /** Produit + options choisies : deux ajouts identiques s'additionnent, des options différentes font deux lignes. */
  cle: string
  produitId: string
  nom: string
  /** Prix du produit seul, en centimes (affichage : le serveur relit le sien). */
  prix: number
  quantite: number
  options: OptionProduit[]
  instructions?: string
}

/** Ligne telle que l'attend POST /commerces/:id/commandes (même forme que `DemandeLigne`, src/lib/commande.ts). */
export interface LigneEnvoyee {
  produitId: string
  quantite: number
  options?: string[]
  instructions?: string
}

/** Un plat ne se commande en ligne que s'il a un prix vérifié et n'est pas marqué indisponible. */
export function estCommandable(p: Pick<Produit, 'prix' | 'indisponible'>): p is Pick<Produit, 'indisponible'> & { prix: number } {
  return typeof p.prix === 'number' && !p.indisponible
}

export const borner = (q: number) => Math.min(QUANTITE_MAX, Math.max(QUANTITE_MIN, Math.trunc(Number.isFinite(q) ? q : QUANTITE_MIN)))

/** Clé de ligne : options triées par nom (l'ordre des cases cochées ne compte pas). */
export function cleLigne(produitId: string, options: readonly OptionProduit[] = []): string {
  return [produitId, ...options.map((o) => o.nom).sort()].join('|')
}

/**
 * Ajoute `quantite` d'un produit commandable avec ces options (seulement celles que le produit propose, chacune une
 * fois). Même produit + mêmes options : la quantité de la ligne existante augmente (plafonnée à 20). Produit non
 * commandable, ou panier déjà à 30 lignes pour une nouvelle ligne : panier inchangé.
 */
export function ajouter(panier: readonly LignePanier[], produit: Pick<Produit, 'id' | 'nom' | 'prix' | 'indisponible' | 'options'>, choix: readonly string[] = [], quantite = 1): LignePanier[] {
  if (!estCommandable(produit)) return [...panier]
  const options = (produit.options ?? []).filter((o, i, t) => choix.includes(o.nom) && t.findIndex((x) => x.nom === o.nom) === i)
  const cle = cleLigne(produit.id, options)
  if (panier.some((l) => l.cle === cle)) return panier.map((l) => (l.cle === cle ? { ...l, quantite: borner(l.quantite + quantite) } : l))
  if (panier.length >= LIGNES_MAX) return [...panier]
  return [...panier, { cle, produitId: produit.id, nom: produit.nom, prix: produit.prix, quantite: borner(quantite), options: options.map((o) => ({ nom: o.nom, prix: o.prix })) }]
}

/** Nouvelle quantité, bornée à 1–20 (retirer une ligne passe par `retirer`). */
export function changerQuantite(panier: readonly LignePanier[], cle: string, quantite: number): LignePanier[] {
  return panier.map((l) => (l.cle === cle ? { ...l, quantite: borner(quantite) } : l))
}

export function retirer(panier: readonly LignePanier[], cle: string): LignePanier[] {
  return panier.filter((l) => l.cle !== cle)
}

/** Instructions d'une ligne (« sans coriandre ») : 300 caractères au plus, vide = aucune. */
export function majInstructions(panier: readonly LignePanier[], cle: string, texte: string): LignePanier[] {
  const t = texte.slice(0, INSTRUCTIONS_MAX)
  return panier.map((l) => (l.cle === cle ? { ...l, instructions: t || undefined } : l))
}

/** Prix d'une unité (produit + options) et de la ligne, en centimes. */
export const prixUnitaire = (l: Pick<LignePanier, 'prix' | 'options'>) => l.prix + l.options.reduce((s, o) => s + o.prix, 0)
export const prixLigne = (l: Pick<LignePanier, 'prix' | 'options' | 'quantite'>) => prixUnitaire(l) * l.quantite

export function totalPanier(panier: readonly LignePanier[]): number {
  return panier.reduce((s, l) => s + prixLigne(l), 0)
}

export function nombreArticles(panier: readonly LignePanier[]): number {
  return panier.reduce((s, l) => s + l.quantite, 0)
}

/**
 * Lignes à envoyer : ids, quantités, noms d'options, instructions nettoyées — jamais un prix ni un nom de plat.
 * Un plat passé en rupture depuis l'ajout part quand même : c'est le serveur qui refuse, avec le nom du plat, et le
 * panier se rouvre sur son message.
 */
export function lignesAEnvoyer(panier: readonly LignePanier[]): LigneEnvoyee[] {
  return panier.map((l) => {
    const ligne: LigneEnvoyee = { produitId: l.produitId, quantite: l.quantite }
    if (l.options.length) ligne.options = l.options.map((o) => o.nom)
    const instructions = l.instructions?.trim()
    if (instructions) ligne.instructions = instructions
    return ligne
  })
}

/**
 * Empreinte de ce qui part au serveur (lignes + instructions générales) : tant qu'elle ne change pas, le nouvel
 * essai garde la même clé d'idempotence et le même secret (une réponse perdue retrouve la même commande et son
 * suivi) ; dès qu'elle change, c'est une autre commande, avec une nouvelle clé et un nouveau secret.
 */
export function empreintePanier(panier: readonly LignePanier[], instructions = ''): string {
  return JSON.stringify([lignesAEnvoyer(panier), instructions.trim()])
}

/** Jeton aléatoire URL-safe (base64url), `octets` octets tirés par `crypto.getRandomValues` : 24 → 32 caractères. */
export function jetonAleatoire(octets = 24, alea: (t: Uint8Array<ArrayBuffer>) => Uint8Array = (t) => crypto.getRandomValues(t)): string {
  const t = alea(new Uint8Array(octets))
  let binaire = ''
  for (const o of t) binaire += String.fromCharCode(o)
  return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface EnvoiEnCours {
  empreinte: string
  cleIdempotence: string
  secret: string
}

/**
 * Clé d'idempotence et secret de suivi pour ce panier : ceux de l'envoi précédent si le panier n'a pas changé
 * (nouvel essai), sinon une nouvelle paire — tirée AVANT le premier envoi.
 */
export function preparerEnvoi(precedent: EnvoiEnCours | null | undefined, empreinte: string, tirer: () => string = () => jetonAleatoire()): EnvoiEnCours {
  if (precedent && precedent.empreinte === empreinte) return precedent
  return { empreinte, cleIdempotence: tirer(), secret: tirer() }
}

/** Panier relu du stockage de session : lignes mal formées ignorées, quantités rebornées. */
export function lirePanier(brut: string | null): LignePanier[] {
  try {
    const v: unknown = brut ? JSON.parse(brut) : []
    if (!Array.isArray(v)) return []
    return v
      .filter(
        (l): l is LignePanier =>
          !!l && typeof l.cle === 'string' && typeof l.produitId === 'string' && typeof l.nom === 'string' && Number.isInteger(l.prix) && Array.isArray(l.options),
      )
      .slice(0, LIGNES_MAX)
      .map((l) => ({ ...l, quantite: borner(l.quantite) }))
  } catch {
    return []
  }
}

/** Statuts expliqués au client, dans l'ordre du parcours ; `refusee` à part (message d'excuse générique). */
export const ETAPES_SUIVI = ['recue', 'acceptee', 'en_preparation', 'servie'] as const

/** Suivi terminé : plus de relecture périodique. */
export const estTerminee = (statut: string) => statut === 'servie' || statut === 'refusee'

/** Clés du stockage de session (par commerce + table pour le panier, par commerce + commande pour le secret). */
export const clesStockage = {
  panier: (commerceId: string, jetonTable: string) => `fideliz:panier:${commerceId}:${jetonTable}`,
  envoi: (commerceId: string, jetonTable: string) => `fideliz:envoi-commande:${commerceId}:${jetonTable}`,
  /** Dernière commande passée depuis cette table sur ce téléphone (pour reprendre le suivi après rechargement). */
  derniere: (commerceId: string, jetonTable: string) => `fideliz:derniere-commande:${commerceId}:${jetonTable}`,
  secret: (commerceId: string, commandeId: string) => `fideliz:commande:${commerceId}:${commandeId}`,
}

// Écrans commerçant (P1-C6) — logique pure des écrans Caisse, Clients, Messages et Avis (testable sans React).
import type { Client, Commerce, RecompenseEnAttente, RecompensePoints } from '../types'
import { nomAffiche } from './inscriptionJeu.ts'
import { soldePoints } from './points.ts'

// ---------- Caisse : aide « encore X tampon(s) » ----------

/** Ce qu'il manque avant la récompense principale ; `texte` s'affiche au-dessus du bouton « Valider une récompense ». */
export function aideTampons(client: Pick<Client, 'tampons'>, commerce: Pick<Commerce, 'seuilTampons' | 'recompense'>): { debloquee: boolean; manque: number; texte: string } {
  const manque = Math.max(0, commerce.seuilTampons - client.tampons)
  if (!manque) return { debloquee: true, manque, texte: `Récompense débloquée : « ${commerce.recompense} ».` }
  return {
    debloquee: false,
    manque,
    texte: `Encore ${manque} tampon${manque > 1 ? 's' : ''} avant « ${commerce.recompense} » (${client.tampons}/${commerce.seuilTampons}).`,
  }
}

// ---------- Caisse : récapitulatif de la modale de confirmation (remplace la boîte native) ----------

export interface Recapitulatif {
  titre: string
  lignes: [libelle: string, valeur: string][]
  confirmer: string
  avertissement?: string
}

export type DemandeConfirmation =
  | { type: 'echange'; recompense: Pick<RecompensePoints, 'id' | 'nom' | 'cout'> }
  | { type: 'recompense' }
  | { type: 'attente'; attente: Pick<RecompenseEnAttente, 'id' | 'libelle'> }
  | { type: 'reserve' }

export function recapitulatif(
  d: DemandeConfirmation,
  client: Pick<Client, 'prenom' | 'tampons' | 'points'>,
  commerce: Pick<Commerce, 'seuilTampons' | 'recompense'>,
): Recapitulatif {
  const qui = nomAffiche(client.prenom)
  switch (d.type) {
    case 'echange': {
      const solde = soldePoints(client)
      return {
        titre: 'Échanger des points ?',
        lignes: [
          ['Client', qui],
          ['Récompense', d.recompense.nom],
          ['Coût', `${d.recompense.cout} points`],
          ['Solde', `${solde} → ${solde - d.recompense.cout} points`],
        ],
        confirmer: `Échanger ${d.recompense.cout} points`,
        avertissement: 'Les points sont retirés de la carte du client.',
      }
    }
    case 'recompense':
      return {
        titre: 'Remettre la récompense ?',
        lignes: [
          ['Client', qui],
          ['Récompense', commerce.recompense],
          ['Tampons', `${client.tampons} → ${Math.max(0, client.tampons - commerce.seuilTampons)}`],
        ],
        confirmer: 'Remettre la récompense',
        avertissement: `La carte repart pour ${commerce.seuilTampons} tampons (l’excédent est conservé).`,
      }
    case 'attente':
      return { titre: 'Remettre la récompense ?', lignes: [['Client', qui], ['Récompense', d.attente.libelle]], confirmer: 'Remettre la récompense' }
    case 'reserve':
      return { titre: 'Utiliser le plat en réserve ?', lignes: [['Client', qui], ['Récompense', 'Plat en réserve']], confirmer: 'Utiliser le plat en réserve' }
  }
}

// ---------- Clients : pagination « Charger plus » ----------

export const TAILLE_PAGE_CLIENTS = 50

export function pageClients<T>(liste: T[], nbAffiches: number): { visibles: T[]; restants: number; prochain: number } {
  const visibles = liste.slice(0, Math.max(TAILLE_PAGE_CLIENTS, nbAffiches))
  const restants = liste.length - visibles.length
  return { visibles, restants, prochain: Math.min(TAILLE_PAGE_CLIENTS, restants) }
}

// ---------- Messages : texte + contacts copiés en un seul tap ----------

export function texteEtContacts(texte: string, contacts: string[]): string {
  const liste = contacts.filter(Boolean)
  return `${texte.trim()}\n\n— Destinataires (${liste.length}) :\n${liste.join(', ')}`
}

// ---------- Avis : « Connecter Google » replié une fois lu (localStorage) ----------

export const cleGoogleLu = (commerceId: string) => `fidelite:avis:google-lu:v1:${commerceId}`

type Stockage = Pick<Storage, 'getItem' | 'setItem'>

export function googleDejaLu(stockage: Stockage | null, commerceId: string): boolean {
  try {
    return stockage?.getItem(cleGoogleLu(commerceId)) === '1'
  } catch {
    return false
  }
}

export function marquerGoogleLu(stockage: Stockage | null, commerceId: string): void {
  try {
    stockage?.setItem(cleGoogleLu(commerceId), '1')
  } catch {
    // stockage plein ou bloqué : le bloc se rouvrira, rien de grave
  }
}

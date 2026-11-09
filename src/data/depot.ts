// Couche de persistance. L'UI ne parle qu'à l'interface `Depot` : pour brancher
// une vraie base plus tard, il suffit d'écrire une autre implémentation.
import type { Donnees, Etat } from '../types'
import seed from './seed.json'

export interface Depot {
  charger(): Etat
  enregistrer(etat: Etat): void
  reinitialiser(): Etat
}

const CLE = 'fideliz:etat:v1'

/**
 * Les dates du seed sont figées autour de `dateReference`. On les décale pour que
 * la démo paraisse toujours récente (« visites ce mois », clients actifs…).
 */
function seedRecale(maintenant = Date.now()): Etat {
  const decalage = maintenant - new Date(seed.dateReference).getTime()
  const recale = (iso: string) => new Date(new Date(iso).getTime() + decalage).toISOString()
  const d = seed as unknown as Donnees
  return {
    commerces: d.commerces.map((c) => ({ ...c, creeLe: recale(c.creeLe) })),
    clients: d.clients.map((c) => ({
      ...c,
      visites: c.visites.map(recale),
      derniereVisite: recale(c.derniereVisite),
      creeLe: recale(c.creeLe),
    })),
    tirages: d.tirages.map((t) => ({ ...t, date: recale(t.date) })),
    avis: d.avis.map((a) => ({ ...a, date: recale(a.date) })),
    commerceActifId: d.commerces[0].id,
  }
}

function estEtatValide(x: unknown): x is Etat {
  const e = x as Etat
  return !!e && Array.isArray(e.commerces) && Array.isArray(e.clients) && Array.isArray(e.tirages) && Array.isArray(e.avis) && typeof e.commerceActifId === 'string'
}

export const depotLocal: Depot = {
  charger() {
    try {
      const brut = localStorage.getItem(CLE)
      if (brut) {
        const etat: unknown = JSON.parse(brut)
        if (estEtatValide(etat)) return etat
      }
    } catch {
      // Données illisibles : on repart du seed.
    }
    const etat = seedRecale()
    this.enregistrer(etat)
    return etat
  },
  enregistrer(etat) {
    try {
      localStorage.setItem(CLE, JSON.stringify(etat))
    } catch {
      // Stockage plein ou désactivé (navigation privée) : l'app reste utilisable en mémoire.
    }
  },
  reinitialiser() {
    const etat = seedRecale()
    this.enregistrer(etat)
    return etat
  },
}

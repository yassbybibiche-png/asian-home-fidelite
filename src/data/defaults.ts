import type { Commerce, TypeCommerce } from '../types'

export const TYPES_COMMERCE: { valeur: TypeCommerce; libelle: string }[] = [
  { valeur: 'restaurant', libelle: 'Restaurant' },
  { valeur: 'salon', libelle: 'Salon (coiffure, beauté…)' },
  { valeur: 'boutique', libelle: 'Boutique' },
  { valeur: 'boulangerie', libelle: 'Boulangerie' },
  { valeur: 'garage', libelle: 'Garage' },
  { valeur: 'autre', libelle: 'Autre' },
]

export function libelleType(type: TypeCommerce): string {
  return TYPES_COMMERCE.find((t) => t.valeur === type)?.libelle.replace(/ \(.*\)$/, '') ?? 'Autre'
}

/** Valeurs par défaut identiques pour tous les secteurs : rien de sur-mesure. */
export function nouveauCommerce(nom: string, type: TypeCommerce, lienGoogle: string): Commerce {
  return {
    id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    nom: nom.trim(),
    type,
    logo: '',
    lienGoogle: lienGoogle.trim(),
    recompense: 'Une récompense offerte au 10e passage',
    seuilTampons: 10,
    lots: ['-10 % sur le prochain passage', 'Un petit cadeau offert', '-5 % sur le prochain passage', 'Pas de chance, à la prochaine !'],
    reglesReponseAuto: { auto5Etoiles: true, auto4Etoiles: false, brouillonAutres: true },
    actif: true,
    creeLe: new Date().toISOString(),
  }
}

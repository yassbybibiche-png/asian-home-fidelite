import type { Commerce, TypeCommerce } from '../types'

/** Nom du produit (marque de l'utilisateur), affiché dans l'en-tête et sur le QR vitrine. */
export const NOM_APP = 'Asian Home Fidélité'

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
    // Libellés ≤ 12 caractères : lisibles en entier sur la roue (src/lib/roue.ts). Roue v2 (R1) : id + type explicites
    // (ids fixes, uniques dans la liste et identiques pour tous les secteurs, comme ceux du catalogue ci-dessous) ;
    // plus de lot perdant par défaut — consolation de 10 points à la place de « Dommage ! » (même probabilité).
    lots: [
      { id: 'lot-remise-10', type: 'lot', libelle: 'Remise 10 %', probabilite: 20 },
      { id: 'lot-petit-cadeau', type: 'lot', libelle: 'Petit cadeau', probabilite: 20 },
      { id: 'lot-remise-5', type: 'lot', libelle: 'Remise 5 %', probabilite: 30 },
      { id: 'lot-10-points', type: 'points', points: 10, libelle: '+10 points', probabilite: 30 },
    ],
    // Roue v2 (R2) : accès libre (1 tirage par jour dès l'identification) pour les NOUVEAUX commerces ; une config
    // existante sans ce champ reste en 'visite'. Limite de gains et plafonds : défauts effectifs (4 / 30 jours, aucun).
    modeAccesRoue: 'libre',
    reglesReponseAuto: { auto5Etoiles: true, auto4Etoiles: false, brouillonAutres: true },
    // Catalogue d'échange de points pré-rempli (ids stables, conformes à `catalogue()` de server/app.ts).
    catalogue: [
      { id: 'boisson-offerte', nom: 'Boisson offerte', cout: 100 },
      { id: 'dessert-offert', nom: 'Dessert offert', cout: 150 },
      { id: 'remise-10', nom: 'Remise 10 %', cout: 250 },
    ],
    actif: true,
    creeLe: new Date().toISOString(),
  }
}

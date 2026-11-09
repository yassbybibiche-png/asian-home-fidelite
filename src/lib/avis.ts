// Modèles de réponse aux avis et règles d'automatisation (logique pure).
import type { Avis, Commerce, StatutAvis } from '../types'

export type CleModele = 'cinq' | 'quatre' | 'negatif' | 'sansTexte'

export const MODELES: { cle: CleModele; libelle: string }[] = [
  { cle: 'cinq', libelle: '5★ chaleureux' },
  { cle: 'quatre', libelle: '4★' },
  { cle: 'negatif', libelle: 'Avis négatif' },
  { cle: 'sansTexte', libelle: 'Sans texte' },
]

/** « Sophie M. » → « Sophie ». */
function prenomAuteur(auteur: string): string {
  return auteur.trim().split(/\s+/)[0] || 'à vous'
}

export function texteModele(cle: CleModele, avis: Pick<Avis, 'auteur'>, commerce: Pick<Commerce, 'nom'>): string {
  const p = prenomAuteur(avis.auteur)
  switch (cle) {
    case 'cinq':
      return `Merci beaucoup ${p} pour ce superbe avis ! Toute l’équipe de ${commerce.nom} est ravie que vous ayez passé un bon moment. À très bientôt !`
    case 'quatre':
      return `Merci ${p} pour votre retour ! Nous sommes heureux que l’expérience vous ait plu, et nous prenons note de vos remarques pour faire encore mieux. Au plaisir de vous revoir chez ${commerce.nom}.`
    case 'negatif':
      return `Bonjour ${p}, merci d’avoir pris le temps de nous écrire. Nous sommes sincèrement désolés que votre expérience n’ait pas été à la hauteur. Nous prenons votre retour très au sérieux et nous allons en parler en équipe. N’hésitez pas à nous contacter directement pour que nous puissions en parler et arranger les choses.`
    case 'sansTexte':
      return `Merci ${p} pour votre note ! Toute l’équipe de ${commerce.nom} vous remercie et espère vous revoir très vite.`
  }
}

/** Le modèle le plus adapté à un avis. */
export function modeleSuggere(avis: Pick<Avis, 'note' | 'texte'>): CleModele {
  if (avis.note <= 3) return 'negatif'
  if (!avis.texte.trim()) return 'sansTexte'
  return avis.note === 5 ? 'cinq' : 'quatre'
}

export function statutAvis(avis: Avis): StatutAvis {
  if (avis.reponse) return 'repondu'
  if (avis.brouillon) return 'brouillon'
  return 'sansReponse'
}

/**
 * Applique les interrupteurs de Réglages à un avis sans réponse ni brouillon :
 * réponse auto (5★ / 4★) ou brouillon proposé pour les autres.
 * Une réponse ou un brouillon existant (humain ou non) n'est jamais écrasé.
 */
export function appliquerRegles(avis: Avis, commerce: Commerce): Avis {
  if (avis.reponse || avis.brouillon) return avis
  const r = commerce.reglesReponseAuto
  const texte = texteModele(modeleSuggere(avis), avis, commerce)
  if ((avis.note === 5 && r.auto5Etoiles) || (avis.note === 4 && r.auto4Etoiles)) {
    return { ...avis, reponse: texte, reponseAuto: true }
  }
  if (r.brouillonAutres) return { ...avis, brouillon: texte }
  return avis
}

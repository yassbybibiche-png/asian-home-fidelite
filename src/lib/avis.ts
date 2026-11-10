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
 * Avis importé de Google : règles d'import (`appliquerReglesImport`, seule la 5★ prépare une réponse auto).
 */
export function appliquerRegles(avis: Avis, commerce: Commerce): Avis {
  if (avis.reponse || avis.brouillon) return avis
  if (avis.source === 'google') return appliquerReglesImport(avis, commerce)
  const r = commerce.reglesReponseAuto
  const texte = texteModele(modeleSuggere(avis), avis, commerce)
  if ((avis.note === 5 && r.auto5Etoiles) || (avis.note === 4 && r.auto4Etoiles)) {
    return { ...avis, reponse: texte, reponseAuto: true }
  }
  if (r.brouillonAutres) return { ...avis, brouillon: texte }
  return avis
}

// ---------- Google Business Profile (P1-B4) ----------

export const LIBELLE_SOURCE: Record<'google' | 'manuel', string> = { google: 'Google', manuel: 'Saisi à la main' }

export const sourceAvis = (a: Pick<Avis, 'source'>): 'google' | 'manuel' => a.source ?? 'manuel'

const NOTES: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }

/** Avis de l'API Google v4, réduit aux champs utiles (voir server/google-business.ts). */
export interface AvisGoogle {
  name: string
  reviewer?: { displayName?: string; isAnonymous?: boolean }
  starRating?: string
  comment?: string
  createTime?: string
  updateTime?: string
  reviewReply?: { comment?: string; updateTime?: string }
}

/** Identifiant local stable d'un avis Google : deux imports du même avis donnent le même id. */
export function idAvisGoogle(nom: string): string {
  // FNV-1a 64 bits en hexadécimal : pas de dépendance à node:crypto (module partagé avec le front).
  let h = 0xcbf29ce484222325n
  for (const c of new TextEncoder().encode(nom)) h = BigInt.asUintN(64, (h ^ BigInt(c)) * 0x100000001b3n)
  return `av-g-${h.toString(16).padStart(16, '0')}`
}

/** Avis Google → avis de l'app (note manquante ou inconnue : null, l'avis est ignoré). */
export function avisDepuisGoogle(g: AvisGoogle, commerceId: string): Avis | null {
  const note = NOTES[g.starRating ?? '']
  if (!note || !g.name) return null
  const date = new Date(g.createTime ?? g.updateTime ?? '')
  const a: Avis = {
    id: idAvisGoogle(g.name),
    commerceId,
    auteur: (g.reviewer?.isAnonymous ? '' : g.reviewer?.displayName?.trim().slice(0, 60)) || 'Client Google',
    note,
    texte: (g.comment ?? '').trim().slice(0, 4000),
    date: Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString(),
    source: 'google',
    googleId: g.name,
  }
  const rep = g.reviewReply?.comment?.trim()
  if (rep) {
    a.reponse = rep
    a.reponseAuto = false
    a.reponsePublieeLe = g.reviewReply?.updateTime ?? a.date
  }
  return a
}

/**
 * Règles appliquées à un avis IMPORTÉ de Google : seule la règle 5★ prépare une réponse automatique (publiable) ;
 * tout le reste (4★ compris, même avec la règle 4★) devient un brouillon à valider à la main avant publication.
 * Une réponse ou un brouillon existant n'est jamais écrasé.
 */
export function appliquerReglesImport(avis: Avis, commerce: Commerce): Avis {
  if (avis.reponse || avis.brouillon) return avis
  const r = commerce.reglesReponseAuto
  const texte = texteModele(modeleSuggere(avis), avis, commerce)
  if (avis.note === 5 && r.auto5Etoiles) return { ...avis, reponse: texte, reponseAuto: true }
  if (r.brouillonAutres || (avis.note === 4 && r.auto4Etoiles)) return { ...avis, brouillon: texte }
  return avis
}

/**
 * Fusion d'un import Google avec les avis en base. Déduplication par identifiant Google (un même avis importé deux
 * fois = une seule ligne). Avis déjà connu : texte / note / auteur mis à jour depuis Google (le client a pu modifier son
 * avis), réponse et brouillon locaux conservés. Les avis saisis à la main ne sont jamais touchés.
 */
export function fusionnerImport(existants: Avis[], google: AvisGoogle[], commerce: Commerce): { nouveaux: Avis[]; modifies: Avis[]; ignores: number } {
  const parGoogleId = new Map(existants.filter((a) => a.googleId).map((a) => [a.googleId!, a]))
  const parId = new Map(existants.map((a) => [a.id, a]))
  const nouveaux: Avis[] = []
  const modifies: Avis[] = []
  const vus = new Set<string>()
  let ignores = 0
  for (const g of google) {
    const importe = avisDepuisGoogle(g, commerce.id)
    if (!importe || vus.has(importe.googleId!)) {
      ignores++
      continue
    }
    vus.add(importe.googleId!)
    const avant = parGoogleId.get(importe.googleId!) ?? parId.get(importe.id)
    if (!avant) {
      nouveaux.push(appliquerReglesImport(importe, commerce))
      continue
    }
    if (avant.source !== 'google') {
      ignores++
      continue
    }
    const maj: Avis = { ...avant, auteur: importe.auteur, note: importe.note, texte: importe.texte }
    // Réponse publiée sur Google (par l'app ou ailleurs) alors qu'on n'avait rien : on la reprend.
    if (!maj.reponse && importe.reponse) {
      maj.reponse = importe.reponse
      maj.reponseAuto = false
      maj.reponsePublieeLe = importe.reponsePublieeLe
      delete maj.brouillon
    }
    if (JSON.stringify(maj) !== JSON.stringify(avant)) modifies.push(maj)
  }
  return { nouveaux, modifies, ignores }
}

/**
 * Publication d'une réponse sur Google : autorisée seulement pour un avis importé de Google, avec une réponse
 * validée à la main (« Marquer comme répondu ») ou préparée par la règle auto 5★ ENCORE active. Un brouillon, ou une
 * réponse auto hors règle 5★ (règle 4★, règle désactivée depuis), exige une validation manuelle.
 */
export function refusPublication(avis: Avis, commerce: Pick<Commerce, 'reglesReponseAuto'>): string | null {
  if (avis.source !== 'google' || !avis.googleId) return 'Avis saisi à la main : il n’existe pas dans Google Business via l’API, rien à publier (copiez la réponse vous-même sur Google).'
  if (!avis.reponse?.trim()) {
    return avis.brouillon
      ? 'Brouillon non validé : relisez-le et validez-le (« Marquer comme répondu ») avant de le publier sur Google.'
      : 'Aucune réponse à publier : rédigez et validez d’abord une réponse.'
  }
  if (avis.reponseAuto && !(avis.note === 5 && commerce.reglesReponseAuto.auto5Etoiles)) {
    return 'Réponse automatique hors règle 5★ : validez-la à la main (« Marquer comme répondu ») avant de la publier.'
  }
  return null
}

/** Publication automatique à l'import : uniquement la réponse auto des 5★, si la règle est active. */
export const publicationAutomatique = (avis: Avis, commerce: Pick<Commerce, 'reglesReponseAuto'>) =>
  !!avis.reponseAuto && !avis.reponsePublieeLe && refusPublication(avis, commerce) === null

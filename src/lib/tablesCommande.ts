// Tables de la commande à table, côté Réglages (Expérience 10/10, lot 2) : mêmes règles que le serveur
// (`configCommande`, server/app.ts) pour prévenir avant l'envoi ; le serveur reste seul juge (400 sinon). Les jetons
// des QR sont tirés par le serveur : l'écran ne fait que renvoyer celui d'une table existante.

/** 40 caractères par nom, 50 tables : `TABLES_COMMANDE_MAX` et la borne du serveur (vérifiées par le test). */
export const NOM_TABLE_MAX = 40
export const TABLES_MAX = 50

/** Problème d'une liste de noms (espaces de bord ignorés, majuscules ignorées pour les doublons), ou null. */
export function problemeTables(noms: readonly string[]): string | null {
  if (noms.length > TABLES_MAX) return `${TABLES_MAX} tables au maximum.`
  const vus = new Set<string>()
  for (const brut of noms) {
    const nom = brut.trim()
    if (!nom) return 'Chaque table doit avoir un nom.'
    if (nom.length > NOM_TABLE_MAX) return `« ${nom.slice(0, 20)}… » : ${NOM_TABLE_MAX} caractères au maximum.`
    const cle = nom.toLocaleLowerCase('fr')
    if (vus.has(cle)) return `Deux tables s’appellent « ${nom} » : chaque nom doit être unique.`
    vus.add(cle)
  }
  return null
}

/** Lien encodé dans le QR d'une table : la page #/commande/<commerceId>/<jeton> (`base` = origine + chemin de l'app). */
export function lienTable(base: string, commerceId: string, jeton: string): string {
  return `${base}#/commande/${encodeURIComponent(commerceId)}/${encodeURIComponent(jeton)}`
}

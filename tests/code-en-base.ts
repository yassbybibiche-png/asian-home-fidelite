// Lecture du code gagnant d'un tirage DIRECTEMENT dans la base SQLite d'un serveur de test. Depuis la revue Codex R3
// (F1), aucune réponse de l'API ne sert le code hors activation par le titulaire — pas même l'état commerçant (/etat) :
// les tests qui ont besoin du code (saisie en caisse, vérification qu'il ne fuit nulle part) le lisent ici.
import { DatabaseSync } from 'node:sqlite'

/** Le code du tirage, ou undefined (tirage sans code : perdant, consolation). */
export function codeEnBase(fichierDb: string, tirageId: string): string | undefined {
  const db = new DatabaseSync(fichierDb, { readOnly: true })
  try {
    const ligne = db.prepare("SELECT json_extract(donnees, '$.code') AS code FROM tirages WHERE id = ?").get(tirageId) as { code: string | null } | undefined
    return ligne?.code ?? undefined
  } finally {
    db.close()
  }
}

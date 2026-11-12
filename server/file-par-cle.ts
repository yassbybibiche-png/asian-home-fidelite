// File d'attente asynchrone par clé (roue v2, revue Codex R2 point 1) : les sections passées sous la même clé
// s'exécutent une par une, dans l'ordre d'arrivée ; des clés différentes ne s'attendent jamais.
//
// HYPOTHÈSE : une seule instance du serveur (déploiement réel : un seul service Render). Le verrou vit dans la mémoire
// du processus — deux instances ne se verraient pas. Passer à plusieurs instances demanderait un verrou en base
// (fonction SQL / advisory lock), pas ce module.

export type FileParCle = <T>(cle: string, fn: () => Promise<T>) => Promise<T>

export function creerFileParCle(): FileParCle {
  // Dernier maillon de chaque file : la section suivante attend sa fin (succès ou échec). Supprimé quand la file se
  // vide, la carte ne grossit pas avec le nombre de commerces.
  const queues = new Map<string, Promise<void>>()
  return async function sous<T>(cle: string, fn: () => Promise<T>): Promise<T> {
    const precedent = queues.get(cle) ?? Promise.resolve()
    const tour = precedent.then(fn)
    const fin = tour.then(
      () => undefined,
      () => undefined,
    )
    queues.set(cle, fin)
    try {
      return await tour
    } finally {
      if (queues.get(cle) === fin) queues.delete(cle)
    }
  }
}

// Demandes de service à 0 € (Menu Appétit, lot 1) : « Appeler le serveur », « De l’eau »… envoyées depuis la page
// commande comme des lignes à prix 0. La liste est définie ICI, jamais par le navigateur : le serveur
// (`calculerCommande`, src/lib/commande.ts) n'accepte que ces identifiants, avec ces noms.
// Aucun import autre que des types : ce fichier est partagé par commande.ts, panier.ts et le front (voir l'avertissement
// en tête de panier.ts : pas de chaîne d'imports qui tire la fidélité).

export interface ServiceCommande {
  readonly id: string
  readonly nom: string
  readonly icone: string
}

export const SERVICES_COMMANDE: readonly ServiceCommande[] = Object.freeze([
  Object.freeze({ id: 'service-serveur', nom: 'Appeler le serveur', icone: '🛎️' }),
  Object.freeze({ id: 'service-eau', nom: 'De l’eau', icone: '💧' }),
  Object.freeze({ id: 'service-baguettes', nom: 'Des baguettes', icone: '🥢' }),
  Object.freeze({ id: 'service-addition', nom: 'L’addition', icone: '🧾' }),
])

/** Service de la liste canonique pour cet identifiant, `undefined` sinon (un id « service-… » inventé compris). */
export const serviceParId = (id: unknown): ServiceCommande | undefined => (typeof id === 'string' ? SERVICES_COMMANDE.find((s) => s.id === id) : undefined)

export const estIdService = (id: unknown): boolean => serviceParId(id) !== undefined

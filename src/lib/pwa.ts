// PWA (P1-C3) : enregistrement du service worker `public/sw.js` (copié tel quel dans dist/ par Vite).
// Seulement sur le build de production : en développement (Vite), un service worker garderait d'anciens fichiers.

export const CHEMIN_SERVICE_WORKER = '/sw.js'

/** Conditions d'enregistrement : build de production, navigateur compatible, contexte sécurisé (https ou localhost). */
export function doitEnregistrer(o: { production: boolean; compatible: boolean; securise: boolean }): boolean {
  return o.production && o.compatible && o.securise
}

export function enregistrerServiceWorker(production: boolean): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return
  if (!doitEnregistrer({ production, compatible: 'serviceWorker' in navigator, securise: window.isSecureContext })) return
  // Après le chargement : le service worker ne ralentit pas le premier affichage.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(CHEMIN_SERVICE_WORKER, { scope: '/' }).catch(() => {
      // Échec sans gravité : l'app marche comme avant, simplement sans cache hors ligne.
    })
  })
}

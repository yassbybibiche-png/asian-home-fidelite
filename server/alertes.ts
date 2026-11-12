// Item E — Alerte e-mail sur rafale d'erreurs 5xx. Alimentée depuis le même point d'accroche que les logs
// structurés (P2-Q6 : `res.on('finish')` de `server/app.ts`, juste après `journaliserRequete`), sans changer
// le format des lignes de log.
// - Compteur glissant des réponses 5xx sur 15 minutes ; au-delà de 10 (à partir de la 11e) → UN e-mail à
//   l'exploitant (`ALERTE_EMAIL`), via l'adaptateur e-mail existant (Brevo, même délai `DELAI_PRESTATAIRE_MS`).
// - Au plus 1 alerte LIVRÉE par heure (y compris livrée en mode test) : le compteur continue, l'envoi est
//   plafonné à partir de l'horodatage de la livraison. Un envoi échoué (rejet du prestataire) ou impossible
//   (aucun prestataire) ne consomme pas ce plafond : nouvelle tentative possible 5 minutes plus tard
//   (`DELAI_REPRISE_ALERTE_5XX_MS`), tant que le seuil reste dépassé. Une seule tentative à la fois.
// - `ALERTE_EMAIL` absente ou vide : module inactif (aucun compteur, aucun envoi, aucune ligne).
// - Mode test Brevo (`BREVO_MODE_TEST=1`) : même chemin que les relances (e-mail en sandbox Brevo, rien livré),
//   et une ligne `[alerte-5xx]` le dit. Aucun prestataire e-mail : ligne « non envoyée », jamais d'exception.
// - Envoi asynchrone (fire-and-forget, erreur capturée) : ne retarde ni ne fait échouer la réponse en cours.
// Contenu : nombre de 5xx, fenêtre, quelques routes MASQUÉES (`routeMasquee`, comme les logs), horodatage.
// L'adresse du destinataire n'est jamais écrite dans les logs.
import type { Notifications } from './notifications/index.ts'

export const FENETRE_ALERTE_5XX_MS = 15 * 60_000
/** Alerte au-delà de ce nombre de 5xx dans la fenêtre (> 10, donc à la 11e). */
export const SEUIL_ALERTE_5XX = 10
/** Plafond : au plus 1 alerte livrée par intervalle. */
export const INTERVALLE_ALERTES_5XX_MS = 3600_000
/** Après un échec d'envoi (ou sans prestataire), délai avant une nouvelle tentative. */
export const DELAI_REPRISE_ALERTE_5XX_MS = 5 * 60_000
/** Routes citées dans l'e-mail (les plus fréquentes). */
const ROUTES_CITEES = 5
/** Borne mémoire : au-delà, les plus anciennes erreurs sont oubliées (le seuil reste largement dépassé). */
const ERREURS_MAX = 5000

export interface Alertes5xx {
  actif: boolean
  /** À appeler pour chaque réponse terminée ; `route` est un chemin DÉJÀ masqué (calculé seulement si utile). */
  enregistrer(statut: number, route: () => string): void
}

export function creerAlertes5xx(o: {
  destinataire?: string
  notifications: Pick<Notifications, 'envoyer' | 'statut' | 'modeTest'>
  maintenant: () => Date
}): Alertes5xx {
  const destinataire = o.destinataire?.trim()
  if (!destinataire) return { actif: false, enregistrer: () => {} }
  const erreurs: { t: number; route: string }[] = []
  /** Horodatage de la dernière alerte livrée (point de départ du plafond d'une heure). */
  let derniereLivraison = -Infinity
  /** Pas de nouvelle tentative avant cet instant (posé après un échec). */
  let repriseApres = -Infinity
  let enCours = false

  function envoyer(t: number) {
    const nb = erreurs.length
    const parRoute = new Map<string, number>()
    for (const e of erreurs) parRoute.set(e.route, (parRoute.get(e.route) ?? 0) + 1)
    const routes = [...parRoute].sort((a, b) => b[1] - a[1]).slice(0, ROUTES_CITEES)
    const debut = new Date(t - FENETRE_ALERTE_5XX_MS).toISOString()
    const fin = new Date(t).toISOString()
    const texte = [
      `${nb} réponses en erreur serveur (5xx) en ${FENETRE_ALERTE_5XX_MS / 60_000} minutes (seuil : plus de ${SEUIL_ALERTE_5XX}).`,
      `Fenêtre : ${debut} → ${fin} (UTC).`,
      '',
      'Routes les plus touchées (chemins masqués comme dans les logs) :',
      ...routes.map(([route, n]) => `- ${route} : ${n}`),
      '',
      `Horodatage de l'alerte : ${fin}.`,
      'Au plus une alerte par heure : les erreurs suivantes ne déclenchent pas de nouvel e-mail avant une heure.',
      'Détail : logs structurés du service (lignes "niveau":"erreur").',
    ].join('\n')
    const resume = `${nb} réponses 5xx en 15 min`
    if (!o.notifications.statut().email) {
      repriseApres = t + DELAI_REPRISE_ALERTE_5XX_MS
      console.warn(`[alerte-5xx] alerte non envoyée (aucun prestataire e-mail configuré) : ${resume}`)
      return
    }
    // Fire-and-forget : jamais attendu par la requête en cours, toute erreur est capturée.
    enCours = true
    Promise.resolve()
      .then(() => o.notifications.envoyer('email', { destinataire: destinataire!, sujet: `[Alerte] ${nb} erreurs serveur (5xx) en 15 min`, texte }))
      .then(
        (r) => {
          derniereLivraison = o.maintenant().getTime()
          console.info(r.test ? `[alerte-5xx] mode test : alerte simulée, rien envoyé (${resume})` : `[alerte-5xx] alerte envoyée (${resume})`)
        },
        (e) => {
          repriseApres = o.maintenant().getTime() + DELAI_REPRISE_ALERTE_5XX_MS
          console.warn(`[alerte-5xx] alerte non envoyée : ${e instanceof Error ? e.message : e} (${resume})`)
        },
      )
      .catch(() => {})
      .finally(() => (enCours = false))
  }

  return {
    actif: true,
    enregistrer(statut, route) {
      try {
        if (statut < 500) return
        const t = o.maintenant().getTime()
        erreurs.push({ t, route: route() })
        while (erreurs.length && (erreurs[0].t <= t - FENETRE_ALERTE_5XX_MS || erreurs.length > ERREURS_MAX)) erreurs.shift()
        if (erreurs.length > SEUIL_ALERTE_5XX && !enCours && t >= repriseApres && t - derniereLivraison >= INTERVALLE_ALERTES_5XX_MS) {
          envoyer(t)
        }
      } catch {
        // L'alerte ne doit jamais faire échouer une requête.
      }
    },
  }
}

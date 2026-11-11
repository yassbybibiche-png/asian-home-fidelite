// Jeton client d'une carte (P0-S7), rangé sur le téléphone du client : la preuve que ce téléphone est celui du
// titulaire de la carte. Délivré par le serveur à l'inscription, contre un lien d'accès (comptoir, « Retrouver ma
// carte ») ou, pour une carte à ancien identifiant, pendant la période de grâce. Logique pure, stockage injectable.

export interface JetonCarte {
  jeton: string
  /** Date ISO d'expiration donnée par le serveur. */
  expireLe: string
}

type Stockage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Le serveur donne 30 jours ; la page le renouvelle quand il en reste moins de 15 (carte ouverte au moins 1 fois / 15 j). */
export const RENOUVELER_AVANT_MS = 15 * 24 * 3600_000

const cle = (clientId: string) => `fidelite:jeton-carte:${clientId}`

/** Repli quand le stockage du navigateur est indisponible (navigation privée stricte) : le jeton vaut pour cet onglet. */
const repli = new Map<string, JetonCarte>()

export function memoireJetons(s: Stockage | null, maintenant: () => Date = () => new Date()) {
  function effacer(clientId: string) {
    repli.delete(clientId)
    try {
      s?.removeItem(cle(clientId))
    } catch {
      // Stockage indisponible : rien à effacer.
    }
  }
  return {
    /** Jeton encore valable de cette carte sur ce téléphone ; expiré ou illisible : effacé, null. */
    lire(clientId: string): JetonCarte | null {
      let j: Partial<JetonCarte> | null = null
      try {
        const brut = s?.getItem(cle(clientId))
        j = brut ? (JSON.parse(brut) as Partial<JetonCarte>) : null
      } catch {
        j = null
      }
      j ??= repli.get(clientId) ?? null
      if (!j || typeof j.jeton !== 'string' || typeof j.expireLe !== 'string') return null
      if (!(Date.parse(j.expireLe) > maintenant().getTime())) {
        effacer(clientId)
        return null
      }
      return { jeton: j.jeton, expireLe: j.expireLe }
    },
    /** Range le jeton reçu ; null = l'oublier (refusé par le serveur, révoqué). */
    ecrire(clientId: string, j: JetonCarte | null) {
      if (!j) return effacer(clientId)
      try {
        if (!s) throw new Error('stockage indisponible')
        s.setItem(cle(clientId), JSON.stringify({ jeton: j.jeton, expireLe: j.expireLe }))
        repli.delete(clientId)
      } catch {
        repli.set(clientId, { jeton: j.jeton, expireLe: j.expireLe })
      }
    },
    aRenouveler(j: JetonCarte): boolean {
      return Date.parse(j.expireLe) - maintenant().getTime() < RENOUVELER_AVANT_MS
    },
  }
}

/** Identifiant de la carte dans le paramètre de route (`<id>` ou `<id>?acces=…`). */
export function idCarteDuParam(param: string | undefined): string | undefined {
  const id = param?.split('?')[0]
  return id || undefined
}

/** Lien d'accès à usage unique dans l'adresse (`#/carte/<id>?acces=<lien>`) ; null sinon. */
export function lienAccesDuHash(hash: string): string | null {
  return /[?&]acces=([\w.-]{1,2048})/.exec(hash)?.[1] ?? null
}

/** Adresse sans le lien d'accès (déjà échangé : rien ne doit rester dans l'historique ni dans un favori). */
export function hashSansLienAcces(hash: string): string {
  return hash.replace(/[?&]acces=[\w.-]{1,2048}/, '')
}

// Caisse (P1-C6) — « code déjà vu » : mode dégradé hors ligne, sans affaiblir la vérification serveur.
//
// Quand un code équipe a été vérifié EN LIGNE par le serveur, la caisse en garde une empreinte (PBKDF2 salé), valable
// jusqu'à la fin de la journée (heure de Paris) sur cet appareil. Si le réseau est coupé au déverrouillage suivant,
// ce même code ouvre la caisse en MODE DÉGRADÉ, affiché comme tel :
// • rien n'est vérifié par le serveur à ce moment-là : les actions partent en file d'attente (jamais comptées deux fois :
//   chaque action garde son identifiant) ;
// • au retour du réseau, le code est envoyé au serveur avec chaque action (X-Equipe-Code) et revérifié : refusé →
//   actions gardées, caisse reverrouillée, empreintes effacées ;
// • en ligne, le serveur vérifie toujours le code : ce module ne sert JAMAIS quand le serveur répond.
// Les codes gardés ici ne sont jamais en clair. Limite honnête : un code à 4 chiffres reste devinable par quelqu'un qui
// lit le stockage de l'appareil (10 000 essais) ; c'est pourquoi l'empreinte expire le jour même et ne donne accès
// qu'aux actions en file, toutes revérifiées par le serveur.
import { jourParis } from './relances.ts'

type Stockage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const ITERATIONS_CODE_DU_JOUR = 100_000
/** Membres différents ayant ouvert la caisse dans la journée sur cet appareil. */
export const MAX_CODES_DU_JOUR = 30

interface Memoire {
  jour: string
  empreintes: { sel: string; h: string }[]
}

const enBase64 = (o: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(o)))
const deBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export function creerCodesDuJour(stockage: Stockage | null, cle: string, subtle: SubtleCrypto | null | undefined = globalThis.crypto?.subtle) {
  const disponible = !!(stockage && subtle)

  async function empreinte(code: string, sel: Uint8Array): Promise<string> {
    const base = await subtle!.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits'])
    const bits = await subtle!.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sel as BufferSource, iterations: ITERATIONS_CODE_DU_JOUR }, base, 256)
    return enBase64(bits)
  }

  /** Mémoire du jour seulement ; celle d'un autre jour (ou illisible) est effacée. */
  function lire(maintenant: Date): Memoire | null {
    if (!disponible) return null
    try {
      const brut = stockage!.getItem(cle)
      if (!brut) return null
      const m = JSON.parse(brut) as Memoire
      if (m.jour === jourParis(maintenant) && Array.isArray(m.empreintes)) return m
    } catch {
      // illisible : effacée ci-dessous
    }
    stockage!.removeItem(cle)
    return null
  }

  return {
    disponible,
    /** À appeler seulement APRÈS une vérification réussie par le serveur. */
    async memoriser(code: string, maintenant = new Date()): Promise<void> {
      if (!disponible || !/^\d{4}$/.test(code)) return
      try {
        const m = lire(maintenant) ?? { jour: jourParis(maintenant), empreintes: [] }
        for (const e of m.empreintes) if ((await empreinte(code, deBase64(e.sel))) === e.h) return
        const sel = globalThis.crypto.getRandomValues(new Uint8Array(16))
        m.empreintes = [...m.empreintes, { sel: enBase64(sel), h: await empreinte(code, sel) }].slice(-MAX_CODES_DU_JOUR)
        stockage!.setItem(cle, JSON.stringify(m))
      } catch {
        // stockage plein ou WebCrypto indisponible : pas de mode dégradé, rien d'autre ne change
      }
    },
    /** Ce code a-t-il été vérifié en ligne aujourd'hui sur cet appareil ? (hors ligne seulement) */
    async dejaVu(code: string, maintenant = new Date()): Promise<boolean> {
      if (!/^\d{4}$/.test(code)) return false
      const m = lire(maintenant)
      if (!m) return false
      try {
        for (const e of m.empreintes) if ((await empreinte(code, deBase64(e.sel))) === e.h) return true
      } catch {
        return false
      }
      return false
    },
    /** Code refusé par le serveur (changé, membre retiré) : plus aucun mode dégradé jusqu'à la prochaine vérification. */
    oublier(): void {
      try {
        stockage?.removeItem(cle)
      } catch {
        // rien à faire
      }
    },
  }
}

export const MESSAGE_MODE_DEGRADE =
  'Mode dégradé (hors ligne) : code reconnu sur cet appareil (vérifié en ligne aujourd’hui), pas encore revérifié par le serveur. Les actions restent en attente et seront vérifiées au retour du réseau.'

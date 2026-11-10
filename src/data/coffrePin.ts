// Mémorise l'accès pour la durée de l'onglet (sessionStorage), JAMAIS en clair :
// sessionStorage ne contient que l'accès chiffré (AES-GCM) ; la clé est une CryptoKey NON exportable,
// rangée dans IndexedDB (elle ne peut pas être lue, seulement utilisée par cette page).
// Fermer l'onglet efface l'accès chiffré ; « Verrouiller » efface l'accès chiffré ET la clé.
//
// Deux formes acceptées (toute autre forme est rejetée à la lecture) :
// • { jeton } : jeton de session (P0-S1) — le cas normal, le PIN / code n'est plus gardé du tout ;
// • { pin } : PIN (ou code équipe, pour la caisse) — repli quand le serveur ne délivre pas de session.
//
// Limite honnête : un script exécuté dans la page (faille XSS) pourrait utiliser la clé pour déchiffrer.
// Sans WebCrypto (page servie en http:// hors localhost) ou sans IndexedDB, rien n'est mémorisé :
// l'accès reste en mémoire et sera redemandé au prochain rechargement.
import type { Acces, AccesEquipe } from './api'

/** Ce que le coffre sait garder : accès gérant / admin (PIN ou jeton), ou session équipe de la caisse. */
export type ContenuCoffre = Acces | AccesEquipe

/** `raison` : pour le journal de diagnostic uniquement (jamais le contenu). */
export type LectureCoffre = { statut: 'vide' } | { statut: 'ok'; contenu: ContenuCoffre } | { statut: 'illisible'; raison: string }

type Stockage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface RangementCle {
  lire(): Promise<CryptoKey | null>
  ecrire(cle: CryptoKey): Promise<void>
  effacer(): Promise<void>
}

const enBase64 = (o: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(o instanceof Uint8Array ? o : new Uint8Array(o))))
const deBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

const JETON = /^v1\.[\w-]+\.[\w-]+$/

function estContenu(x: unknown): x is ContenuCoffre {
  if (!x || typeof x !== 'object') return false
  const a = x as Record<string, unknown>
  const roleOk = a.role === 'admin' || ((a.role === 'commerce' || a.role === 'equipe') && typeof a.commerceId === 'string')
  if (!roleOk) return false
  const avecPin = typeof a.pin === 'string' && /^\d{4,12}$/.test(a.pin)
  const avecJeton = typeof a.jeton === 'string' && JETON.test(a.jeton)
  // Exactement une preuve ; le PIN ne vaut que pour commerce / admin.
  if (avecPin) return a.jeton === undefined && a.role !== 'equipe'
  return avecJeton && a.pin === undefined
}

export function creerCoffrePin(
  session: Stockage | null,
  rangement: RangementCle | null,
  subtle: SubtleCrypto | null | undefined = globalThis.crypto?.subtle,
  /** Clé de session (la caisse a la sienne, distincte du PIN du gérant). */
  CLE_SESSION = 'fidelite:acces',
) {
  const disponible = !!(session && rangement && subtle)

  async function cle(creer: boolean): Promise<CryptoKey | null> {
    const existante = await rangement!.lire()
    if (existante || !creer) return existante
    const neuve = await subtle!.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    await rangement!.ecrire(neuve)
    return neuve
  }

  /**
   * Comme `lire`, mais distingue « rien de mémorisé » (cas normal) d'un accès mémorisé illisible
   * (clé IndexedDB perdue ou inaccessible, données abîmées) : ce dernier cas doit être expliqué, pas ignoré.
   * Rien n'est effacé ici (un nouveau déverrouillage réécrit l'accès).
   */
  async function lireDetaille(): Promise<LectureCoffre> {
    if (!disponible) return { statut: 'vide' }
    try {
      const brut = session!.getItem(CLE_SESSION)
      if (!brut) return { statut: 'vide' }
      const { iv, donnees } = JSON.parse(brut) as { iv: string; donnees: string }
      const k = await cle(false)
      if (!k) return { statut: 'illisible', raison: 'cle-absente' }
      const clair = await subtle!.decrypt({ name: 'AES-GCM', iv: deBase64(iv) }, k, deBase64(donnees))
      const acces: unknown = JSON.parse(new TextDecoder().decode(clair))
      return estContenu(acces) ? { statut: 'ok', contenu: acces } : { statut: 'illisible', raison: 'contenu-invalide' }
    } catch (e) {
      return { statut: 'illisible', raison: e instanceof Error && e.name ? e.name : 'erreur' }
    }
  }

  return {
    disponible,
    async memoriser(acces: ContenuCoffre): Promise<boolean> {
      if (!disponible || !estContenu(acces)) return false
      try {
        const k = await cle(true)
        const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
        const chiffre = await subtle!.encrypt({ name: 'AES-GCM', iv }, k!, new TextEncoder().encode(JSON.stringify(acces)))
        session!.setItem(CLE_SESSION, JSON.stringify({ iv: enBase64(iv), donnees: enBase64(chiffre) }))
        return true
      } catch {
        return false
      }
    },
    async lire(): Promise<ContenuCoffre | null> {
      const r = await lireDetaille()
      return r.statut === 'ok' ? r.contenu : null
    },
    lireDetaille,
    async oublier(): Promise<void> {
      try {
        session?.removeItem(CLE_SESSION)
        await rangement?.effacer()
      } catch {
        // déjà effacé
      }
    },
  }
}

export type CoffrePin = ReturnType<typeof creerCoffrePin>

/** Rangement de la clé dans IndexedDB (navigateur). Null si IndexedDB est indisponible. */
export function rangementIndexedDb(nom = 'pin'): RangementCle | null {
  if (typeof indexedDB === 'undefined') return null
  const ouvrir = () =>
    new Promise<IDBDatabase>((ok, ko) => {
      const r = indexedDB.open('fidelite-cles', 1)
      r.onupgradeneeded = () => r.result.createObjectStore('cles')
      r.onsuccess = () => ok(r.result)
      r.onerror = () => ko(r.error)
    })
  const operation = <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest) =>
    ouvrir().then(
      (db) =>
        new Promise<T>((ok, ko) => {
          const r = f(db.transaction('cles', mode).objectStore('cles'))
          r.onsuccess = () => (db.close(), ok(r.result as T))
          r.onerror = () => (db.close(), ko(r.error))
        }),
    )
  return {
    lire: async () => (await operation<CryptoKey | undefined>('readonly', (s) => s.get(nom))) ?? null,
    ecrire: async (cle) => void (await operation('readwrite', (s) => s.put(cle, nom))),
    effacer: async () => void (await operation('readwrite', (s) => s.delete(nom))),
  }
}

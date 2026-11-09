// Mémorise le PIN pour la durée de l'onglet (sessionStorage), JAMAIS en clair :
// sessionStorage ne contient que le PIN chiffré (AES-GCM) ; la clé est une CryptoKey NON exportable,
// rangée dans IndexedDB (elle ne peut pas être lue, seulement utilisée par cette page).
// Fermer l'onglet efface le PIN chiffré ; « Verrouiller » efface le PIN chiffré ET la clé.
//
// Limite honnête : un script exécuté dans la page (faille XSS) pourrait utiliser la clé pour déchiffrer.
// Sans WebCrypto (page servie en http:// hors localhost) ou sans IndexedDB, rien n'est mémorisé :
// le PIN reste en mémoire et sera redemandé au prochain rechargement.
import type { Acces } from './api'

type Stockage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface RangementCle {
  lire(): Promise<CryptoKey | null>
  ecrire(cle: CryptoKey): Promise<void>
  effacer(): Promise<void>
}

const enBase64 = (o: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(o instanceof Uint8Array ? o : new Uint8Array(o))))
const deBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

function estAcces(x: unknown): x is Acces {
  const a = x as Acces
  return !!a && typeof a.pin === 'string' && /^\d{4,12}$/.test(a.pin) && (a.role === 'admin' || (a.role === 'commerce' && typeof a.commerceId === 'string'))
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

  return {
    disponible,
    async memoriser(acces: Acces): Promise<boolean> {
      if (!disponible) return false
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
    async lire(): Promise<Acces | null> {
      if (!disponible) return null
      try {
        const brut = session!.getItem(CLE_SESSION)
        if (!brut) return null
        const { iv, donnees } = JSON.parse(brut) as { iv: string; donnees: string }
        const k = await cle(false)
        if (!k) return null
        const clair = await subtle!.decrypt({ name: 'AES-GCM', iv: deBase64(iv) }, k, deBase64(donnees))
        const acces: unknown = JSON.parse(new TextDecoder().decode(clair))
        return estAcces(acces) ? acces : null
      } catch {
        return null
      }
    },
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

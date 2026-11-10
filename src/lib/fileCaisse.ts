// File d'attente hors ligne de la page caisse (logique pure : stockage et envoi injectés, testable sans navigateur).
// Une action faite sans réseau est rangée dans le localStorage avec un identifiant unique ; à la reconnexion elle est
// envoyée au serveur, qui la reconnaît (idempotence) : rejouer une action déjà reçue ne donne JAMAIS un 2e tampon.
// Le serveur reste seul juge : une action refusée (déjà un passage ce jour-là, solde insuffisant…) est retirée de la
// file et affichée comme refusée — jamais comptée comme réussie.

type Stockage = Pick<Storage, 'getItem' | 'setItem'>

export type TypeActionCaisse = 'passage' | 'recompense' | 'echange' | 'attente' | 'reserve'

export interface ActionCaisse {
  id: string
  type: TypeActionCaisse
  commerceId: string
  clientId: string
  /** Pour l'affichage seulement. */
  clientPrenom: string
  montantCentimes?: number
  recompenseId?: string
  /** Heure réelle de l'action (le serveur l'accepte si elle date de moins de 72 h). */
  faitLe: string
}

export interface ActionRefusee {
  action: ActionCaisse
  erreur: string
}

export interface EtatFile {
  attente: ActionCaisse[]
  refusees: ActionRefusee[]
}

/** Résultat d'un envoi : `reseau` = serveur injoignable (on garde l'action), `refus` = refus définitif du serveur. */
export type Envoi = { ok: true } | { ok: false; reseau: true } | { ok: false; reseau: false; erreur: string }

export function creerFileCaisse(stockage: Stockage | null, cle: string) {
  let memoire: EtatFile = { attente: [], refusees: [] }
  let enCours: Promise<EtatFile> | null = null

  function lire(): EtatFile {
    try {
      const brut = stockage?.getItem(cle)
      if (!brut) return memoire
      const e = JSON.parse(brut) as EtatFile
      return Array.isArray(e.attente) && Array.isArray(e.refusees) ? e : memoire
    } catch {
      return memoire
    }
  }

  function ecrire(e: EtatFile) {
    memoire = e
    try {
      stockage?.setItem(cle, JSON.stringify(e))
    } catch {
      // Stockage plein ou désactivé : la file reste en mémoire (perdue si l'onglet est fermé).
    }
  }

  return {
    lire,
    ajouter(a: ActionCaisse): EtatFile {
      const e = lire()
      const suivant = { ...e, attente: [...e.attente.filter((x) => x.id !== a.id), a] }
      ecrire(suivant)
      return suivant
    },
    oublierRefusees(): EtatFile {
      const suivant = { ...lire(), refusees: [] }
      ecrire(suivant)
      return suivant
    },
    /** Envoie les actions en attente dans l'ordre ; s'arrête au premier problème réseau. Un seul envoi à la fois. */
    synchroniser(envoyer: (a: ActionCaisse) => Promise<Envoi>): Promise<EtatFile> {
      if (enCours) return enCours
      const envoyerTout = async () => {
        for (;;) {
          const e = lire()
          const a = e.attente[0]
          if (!a) return e
          const r = await envoyer(a)
          if (!r.ok && r.reseau) return e
          const apres = lire()
          ecrire({
            attente: apres.attente.filter((x) => x.id !== a.id),
            refusees: r.ok ? apres.refusees : [...apres.refusees, { action: a, erreur: r.erreur }],
          })
        }
      }
      // `.finally` est toujours asynchrone : la remise à null passe APRÈS l'affectation, même quand la file est vide
      // (un `try/finally` dans la fonction s'exécutait avant, et la synchronisation restait « en cours » pour toujours).
      enCours = envoyerTout().finally(() => {
        enCours = null
      })
      return enCours
    },
  }
}

export type FileCaisse = ReturnType<typeof creerFileCaisse>

export function nouvelIdAction(): string {
  const c = globalThis.crypto
  return `act-${c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`
}

/** Identifiant client lu dans un QR de carte (« …#/carte/<id> ») ou saisi tel quel. */
export function clientIdDepuisQr(texte: string): string | null {
  const t = texte.trim()
  const m = /#\/carte\/([^/?#\s]+)/.exec(t)
  if (m) return decodeURIComponent(m[1])
  return /^cl-[\w-]+$/.test(t) ? t : null
}

export function libelleFile(e: EtatFile, enLigne: boolean): string {
  const n = e.attente.length
  if (n) return `${n} action${n > 1 ? 's' : ''} en attente${enLigne ? ' — synchronisation…' : ' (hors ligne)'}`
  return enLigne ? 'Synchronisé' : 'Hors ligne — les actions seront gardées sur cet appareil'
}

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { MESSAGE_MODE_SERVEUR, messageErreur, useStore } from '../store'
import { useRoute } from '../router'
import type { Client, Commerce, EntreeJournal } from '../types'
import { ErreurApi, type ClientApi } from '../data/api'
import { creerCoffrePin, rangementIndexedDb } from '../data/coffrePin'
import { recompenseDebloquee, tamponsAffiches } from '../lib/fidelite'
import { analyserMontant, formaterPrix, passageCeJour, pointsPourMontant, soldePoints } from '../lib/points'
import { correspondRecherche } from '../lib/recherche'
import { clientIdDepuisQr, creerFileCaisse, libelleFile, nouvelIdAction, type ActionCaisse, type EtatFile, type Envoi, type TypeActionCaisse } from '../lib/fileCaisse'
import { LogoCommerce, MessageErreur } from '../components/ui'
import { ScannerQr } from '../components/ScannerQr'
import { MessagePublic } from './Jouer'

/** Page caisse #/caisse/<commerceId> : tablette du comptoir, déverrouillée par le code équipe (4 chiffres). */
export default function Caisse() {
  const { api } = useStore()
  const { param } = useRoute()
  if (!api) return <MessagePublic titre="Caisse">{MESSAGE_MODE_SERVEUR}</MessagePublic>
  if (!param) return <MessagePublic titre="Caisse">Lien incomplet : ouvrez la caisse depuis le tableau de bord (Équipe → « Ouvrir la caisse »).</MessagePublic>
  return <CaisseApi key={param} api={api} commerceId={param} />
}

function stockage(type: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    return window[type]
  } catch {
    return null
  }
}

interface Cache {
  commerce: Commerce
  clients: Client[]
  auteur: EntreeJournal['auteur']
  synchroLe: string
}

const LIBELLES: Record<TypeActionCaisse, string> = { passage: 'Passage', recompense: 'Récompense', echange: 'Échange de points' }

function CaisseApi({ api, commerceId }: { api: ClientApi; commerceId: string }) {
  const coffre = useMemo(() => creerCoffrePin(stockage('sessionStorage'), rangementIndexedDb('caisse'), globalThis.crypto?.subtle, 'fidelite:caisse'), [])
  const file = useMemo(() => creerFileCaisse(stockage('localStorage'), `fidelite:caisse:file:v1:${commerceId}`), [commerceId])
  const cleCache = `fidelite:caisse:cache:v1:${commerceId}`

  const [code, setCode] = useState<string | null>(null)
  const [pret, setPret] = useState(false)
  const [donnees, setDonnees] = useState<Cache | null>(null)
  const [enLigne, setEnLigne] = useState(true)
  const [etatFile, setEtatFile] = useState<EtatFile>(() => file.lire())
  const [erreurAcces, setErreurAcces] = useState<string | null>(null)
  const codeRef = useRef<string | null>(null)
  const reponses = useRef(new Map<string, Client>())

  const ecrireCache = useCallback(
    (c: Cache | null) => {
      setDonnees(c)
      try {
        if (c) stockage('localStorage')?.setItem(cleCache, JSON.stringify(c))
        else stockage('localStorage')?.removeItem(cleCache)
      } catch {
        // stockage plein : données gardées en mémoire
      }
    },
    [cleCache],
  )

  const charger = useCallback(
    async (c = codeRef.current) => {
      if (!c) return
      try {
        const r = await api.caisse(commerceId, { code: c })
        ecrireCache({ commerce: r.commerce, clients: r.clients, auteur: r.auteur, synchroLe: new Date().toISOString() })
        setEnLigne(true)
        setErreurAcces(null)
      } catch (e) {
        if (e instanceof ErreurApi && e.horsLigne) setEnLigne(false)
        else if (e instanceof ErreurApi && e.statut === 401) {
          codeRef.current = null
          setCode(null)
          await coffre.oublier()
          setErreurAcces('Code équipe refusé (il a peut-être été changé) : saisissez-le à nouveau.')
        } else setErreurAcces(messageErreur(e))
      }
    },
    [api, coffre, commerceId, ecrireCache],
  )

  const envoyer = useCallback(
    async (a: ActionCaisse): Promise<Envoi> => {
      const c = codeRef.current
      if (!c) return { ok: false, reseau: true }
      try {
        const r = await api.actionCaisse(commerceId, { code: c }, a.type, {
          clientId: a.clientId,
          actionId: a.id,
          faitLe: a.faitLe,
          ...(a.montantCentimes ? { montantCentimes: a.montantCentimes } : {}),
          ...(a.recompenseId ? { recompenseId: a.recompenseId } : {}),
        })
        reponses.current.set(a.id, r.client)
        return { ok: true }
      } catch (e) {
        // Réseau coupé, ou code changé entre-temps : l'action reste en file (rien n'est perdu ni compté).
        if (e instanceof ErreurApi && (e.horsLigne || e.statut === 401 || e.statut === 429)) {
          if (e.horsLigne) setEnLigne(false)
          return { ok: false, reseau: true }
        }
        return { ok: false, reseau: false, erreur: messageErreur(e) }
      }
    },
    [api, commerceId],
  )

  const synchroniser = useCallback(async () => {
    const e = await file.synchroniser(envoyer)
    setEtatFile(e)
    if (!e.attente.length) await charger()
    return e
  }, [charger, envoyer, file])

  // Démarrage : code mémorisé (chiffré) pour cet onglet ? Données en cache affichées tout de suite (hors ligne).
  useEffect(() => {
    try {
      const brut = stockage('localStorage')?.getItem(cleCache)
      if (brut) setDonnees(JSON.parse(brut) as Cache)
    } catch {
      // cache illisible : ignoré
    }
    void coffre.lire().then((a) => {
      if (a && a.role === 'commerce' && a.commerceId === commerceId) {
        codeRef.current = a.pin
        setCode(a.pin)
        void synchroniser()
      }
      setPret(true)
    })
  }, [cleCache, coffre, commerceId, synchroniser])

  // Retour du réseau, et toutes les 15 s tant que des actions attendent.
  useEffect(() => {
    if (!code) return
    const surLigne = () => {
      setEnLigne(true)
      void synchroniser()
    }
    const horsLigne = () => setEnLigne(false)
    window.addEventListener('online', surLigne)
    window.addEventListener('offline', horsLigne)
    const minuterie = window.setInterval(() => {
      if (file.lire().attente.length) void synchroniser()
      else if (document.visibilityState === 'visible') void charger()
    }, 15_000)
    return () => {
      window.removeEventListener('online', surLigne)
      window.removeEventListener('offline', horsLigne)
      window.clearInterval(minuterie)
    }
  }, [charger, code, file, synchroniser])

  async function deverrouiller(saisi: string) {
    setErreurAcces(null)
    try {
      const r = await api.caisse(commerceId, { code: saisi })
      codeRef.current = saisi
      setCode(saisi)
      ecrireCache({ commerce: r.commerce, clients: r.clients, auteur: r.auteur, synchroLe: new Date().toISOString() })
      setEnLigne(true)
      await coffre.memoriser({ role: 'commerce', commerceId, pin: saisi })
      void synchroniser()
    } catch (e) {
      setErreurAcces(e instanceof ErreurApi && e.horsLigne ? 'Serveur injoignable : le code équipe doit être vérifié en ligne une première fois.' : messageErreur(e))
    }
  }

  async function verrouiller() {
    codeRef.current = null
    setCode(null)
    await coffre.oublier()
  }

  /** Toute action passe par la file : envoyée tout de suite si possible, gardée sinon (même identifiant → jamais comptée deux fois). */
  async function agir(type: TypeActionCaisse, client: Client, extra: { montantCentimes?: number; recompenseId?: string } = {}) {
    const a: ActionCaisse = { id: nouvelIdAction(), type, commerceId, clientId: client.id, clientPrenom: client.prenom, faitLe: new Date().toISOString(), ...extra }
    setEtatFile(file.ajouter(a))
    const e = await synchroniser()
    const refus = e.refusees.find((r) => r.action.id === a.id)
    const apres = reponses.current.get(a.id)
    if (refus) return { statut: 'refus' as const, message: refus.erreur }
    if (e.attente.some((x) => x.id === a.id)) return { statut: 'attente' as const, message: `${LIBELLES[type]} gardé sur cet appareil (hors ligne) : il sera envoyé au retour du réseau.` }
    return { statut: 'ok' as const, client: apres }
  }

  if (!pret) return <p className="px-4 py-16 text-center text-gray-600" role="status">Chargement…</p>
  if (!code) return <Deverrouillage commerce={donnees?.commerce} erreur={erreurAcces} onCode={deverrouiller} attente={etatFile.attente.length} />
  if (!donnees) return <MessagePublic titre="Caisse">{enLigne ? 'Chargement des clients…' : 'Hors ligne et aucune donnée en mémoire sur cet appareil.'}</MessagePublic>

  return (
    <Comptoir
      donnees={donnees}
      enLigne={enLigne}
      etatFile={etatFile}
      erreurAcces={erreurAcces}
      onAgir={agir}
      onClientMaj={(c) => ecrireCache({ ...donnees, clients: donnees.clients.map((x) => (x.id === c.id ? c : x)) })}
      onOublierRefus={() => setEtatFile(file.oublierRefusees())}
      onSynchroniser={() => void synchroniser()}
      onVerrouiller={() => void verrouiller()}
    />
  )
}

function Deverrouillage({ commerce, erreur, onCode, attente }: { commerce?: Commerce; erreur: string | null; onCode(c: string): Promise<void>; attente: number }) {
  const [saisi, setSaisi] = useState('')
  const [enCours, setEnCours] = useState(false)
  async function envoyer(e: FormEvent) {
    e.preventDefault()
    if (!/^\d{4}$/.test(saisi) || enCours) return
    setEnCours(true)
    await onCode(saisi)
    setEnCours(false)
    setSaisi('')
  }
  return (
    <div className="mx-auto max-w-sm space-y-4 px-4 py-10">
      <div className="text-center">
        {commerce && (
          <div className="mb-2 flex justify-center">
            <LogoCommerce commerce={commerce} taille="lg" />
          </div>
        )}
        <h1 className="font-titre text-[1.75rem] font-bold tracking-tight">Caisse</h1>
        <p className="mt-1 text-gray-600">{commerce ? commerce.nom : 'Saisissez votre code équipe.'}</p>
      </div>
      <form onSubmit={envoyer} className="carte space-y-4">
        <div>
          <label className="etiquette" htmlFor="code-equipe">
            Votre code équipe (4 chiffres)
          </label>
          <input
            id="code-equipe"
            className="champ text-center text-2xl tracking-[0.6em]"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={saisi}
            onChange={(e) => setSaisi(e.target.value.replace(/\D/g, ''))}
            aria-invalid={!!erreur}
          />
        </div>
        <MessageErreur>{erreur}</MessageErreur>
        <button type="submit" className="bouton w-full" disabled={!/^\d{4}$/.test(saisi) || enCours}>
          {enCours ? 'Vérification…' : 'Ouvrir la caisse'}
        </button>
        {attente > 0 && <p className="text-sm text-amber-900">{attente} action{attente > 1 ? 's' : ''} en attente sur cet appareil : elles seront envoyées après le déverrouillage.</p>}
        <p className="text-xs text-gray-600">Le code identifie l’auteur de chaque passage dans le journal. Il est créé par le gérant (Plus → Équipe).</p>
      </form>
    </div>
  )
}

type Resultat = { statut: 'ok'; client?: Client } | { statut: 'refus' | 'attente'; message: string }

function Comptoir({
  donnees,
  enLigne,
  etatFile,
  erreurAcces,
  onAgir,
  onClientMaj,
  onOublierRefus,
  onSynchroniser,
  onVerrouiller,
}: {
  donnees: Cache
  enLigne: boolean
  etatFile: EtatFile
  erreurAcces: string | null
  onAgir(type: TypeActionCaisse, c: Client, extra?: { montantCentimes?: number; recompenseId?: string }): Promise<Resultat>
  onClientMaj(c: Client): void
  onOublierRefus(): void
  onSynchroniser(): void
  onVerrouiller(): void
}) {
  const { commerce, clients, auteur } = donnees
  const [recherche, setRecherche] = useState('')
  const [choisiId, setChoisiId] = useState<string | null>(null)
  const [scanner, setScanner] = useState(false)
  const [montant, setMontant] = useState('')
  const [enCours, setEnCours] = useState(false)
  const [annonce, setAnnonce] = useState<{ type: 'ok' | 'attente' | 'refus'; texte: string } | null>(null)
  const choisi = clients.find((c) => c.id === choisiId) ?? null
  const resultats = recherche.trim() ? clients.filter((c) => correspondRecherche(c, recherche)).slice(0, 8) : []
  const centimes = analyserMontant(montant)
  const enAttente = (c: Client) => etatFile.attente.filter((a) => a.clientId === c.id).length

  const surQr = useCallback(
    (texte: string) => {
      setScanner(false)
      const id = clientIdDepuisQr(texte)
      const c = id && clients.find((x) => x.id === id)
      if (c) {
        setChoisiId(c.id)
        setAnnonce(null)
      } else setAnnonce({ type: 'refus', texte: 'QR non reconnu : ce n’est pas une carte de ce commerce. Cherchez le client par son prénom ou son numéro.' })
    },
    [clients],
  )

  async function agir(type: TypeActionCaisse, extra: { montantCentimes?: number; recompenseId?: string } = {}) {
    if (!choisi || enCours) return
    setEnCours(true)
    setAnnonce(null)
    const r = await onAgir(type, choisi, extra)
    setEnCours(false)
    if (r.statut !== 'ok') return setAnnonce({ type: r.statut, texte: r.message })
    if (r.client) onClientMaj(r.client)
    const c = r.client ?? choisi
    const gagnes = soldePoints(c) - soldePoints(choisi)
    setAnnonce({
      type: 'ok',
      texte:
        type === 'passage'
          ? `✓ Passage enregistré pour ${c.prenom} : +1 tampon (${tamponsAffiches(c, commerce)}/${commerce.seuilTampons})${gagnes > 0 ? `, +${gagnes} point${gagnes > 1 ? 's' : ''}` : ''}.`
          : type === 'recompense'
            ? `🎁 Récompense remise à ${c.prenom} : ${commerce.recompense}.`
            : `✓ Échange enregistré pour ${c.prenom} — nouveau solde : ${soldePoints(c)} points.`,
    })
    if (type === 'passage') setMontant('')
  }

  const statut = libelleFile(etatFile, enLigne)

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 pt-4 pb-10">
      <header className="flex items-center gap-3">
        <LogoCommerce commerce={commerce} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-titre text-xl font-bold">Caisse · {commerce.nom}</h1>
          <p className="text-sm text-gray-600">Connecté : {auteur.nom}</p>
        </div>
        <button className="min-h-11 shrink-0 rounded-xl px-3 text-sm font-semibold text-gray-700 ring-1 ring-gray-300 active:bg-gray-100" onClick={onVerrouiller}>
          🔒 Verrouiller
        </button>
      </header>

      <div
        className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm ring-1 ${
          etatFile.attente.length ? 'bg-amber-50 text-amber-900 ring-amber-200' : enLigne ? 'bg-green-50 text-green-900 ring-green-200' : 'bg-gray-800 text-white ring-gray-800'
        }`}
        role="status"
      >
        <span>
          {etatFile.attente.length ? '⏳' : enLigne ? '✓' : '⚠'} {statut}
        </span>
        {etatFile.attente.length > 0 && (
          <button className="min-h-11 shrink-0 px-1 font-semibold underline" onClick={onSynchroniser}>
            Réessayer
          </button>
        )}
      </div>
      <MessageErreur>{erreurAcces}</MessageErreur>

      {etatFile.refusees.length > 0 && (
        <section className="rounded-xl bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-200" role="alert">
          <p className="font-semibold">Actions refusées par le serveur (non comptées) :</p>
          <ul className="mt-1 list-disc pl-5">
            {etatFile.refusees.map((r) => (
              <li key={r.action.id}>
                {LIBELLES[r.action.type]} · {r.action.clientPrenom} : {r.erreur}
              </li>
            ))}
          </ul>
          <button className="mt-1 min-h-11 font-semibold underline" onClick={onOublierRefus}>
            J’ai compris
          </button>
        </section>
      )}

      {scanner ? (
        <ScannerQr onLu={surQr} onFermer={() => setScanner(false)} />
      ) : (
        <section className="carte space-y-3">
          <button className="bouton w-full" onClick={() => setScanner(true)}>
            📷 Scanner la carte du client
          </button>
          <div>
            <label className="etiquette" htmlFor="caisse-recherche">
              Ou chercher : prénom, téléphone ou e-mail
            </label>
            <input id="caisse-recherche" className="champ" type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)} autoComplete="off" />
          </div>
          {resultats.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {resultats.map((c) => (
                <li key={c.id}>
                  <button
                    className="flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left"
                    onClick={() => {
                      setChoisiId(c.id)
                      setRecherche('')
                      setAnnonce(null)
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold">{c.prenom}</span>
                      <span className="block truncate text-sm text-gray-600">{c.telephone ?? c.email}</span>
                    </span>
                    <span className="shrink-0 text-sm text-gray-700 tabular-nums">
                      {tamponsAffiches(c, commerce)}/{commerce.seuilTampons} · {soldePoints(c)} pts
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {recherche.trim() && !resultats.length && <p className="text-sm text-gray-600">Aucun client trouvé. Inscription : depuis la page de jeu (QR vitrine) ou Clients.</p>}
        </section>
      )}

      {choisi && (
        <section className="carte space-y-4" aria-label={`Client : ${choisi.prenom}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-bold">{choisi.prenom}</h2>
              <p className="truncate text-sm text-gray-600">{choisi.telephone ?? choisi.email}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xl font-extrabold tabular-nums">
                {tamponsAffiches(choisi, commerce)}/{commerce.seuilTampons} <span className="text-sm font-semibold text-gray-600">tampons</span>
              </p>
              <p className="text-xl font-extrabold tabular-nums">
                {soldePoints(choisi)} <span className="text-sm font-semibold text-gray-600">points</span>
              </p>
            </div>
          </div>
          {passageCeJour(choisi, new Date()) && <p className="rounded-xl bg-gray-50 p-2 text-sm text-gray-700">Déjà un passage aujourd’hui : 1 tampon par jour maximum.</p>}
          {enAttente(choisi) > 0 && <p className="text-sm text-amber-900">{enAttente(choisi)} action(s) en attente d’envoi pour ce client.</p>}

          <div>
            <label className="etiquette" htmlFor="caisse-montant">
              Montant dépensé (optionnel)
            </label>
            <div className="relative">
              <input id="caisse-montant" className="champ pr-10" inputMode="decimal" placeholder="ex : 23,50" value={montant} onChange={(e) => setMontant(e.target.value)} />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-gray-600">€</span>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              {centimes === null ? 'Montant invalide (ex : 23,50).' : centimes > 0 ? `${formaterPrix(centimes)} → +${pointsPourMontant(centimes, commerce)} point(s)` : 'Sans montant : 1 tampon, pas de points.'}
            </p>
          </div>

          <button className="bouton min-h-16 w-full text-lg" disabled={enCours || centimes === null} onClick={() => void agir('passage', centimes ? { montantCentimes: centimes } : {})}>
            ＋ Ajouter un passage
          </button>
          <button
            className="bouton min-h-16 w-full bg-green-700 text-lg hover:bg-green-800 active:bg-green-900"
            disabled={enCours || !recompenseDebloquee(choisi, commerce)}
            onClick={() => void agir('recompense')}
          >
            🎁 Valider une récompense
          </button>
          {!recompenseDebloquee(choisi, commerce) && <p className="-mt-2 text-sm text-gray-600">Récompense « {commerce.recompense} » : au {commerce.seuilTampons}e tampon.</p>}

          {!!commerce.catalogue?.length && (
            <div>
              <p className="etiquette">Échanger des points</p>
              <ul className="space-y-2">
                {commerce.catalogue.map((r) => (
                  <li key={r.id}>
                    <button
                      className="bouton-secondaire min-h-12 w-full justify-between"
                      disabled={enCours || soldePoints(choisi) < r.cout}
                      onClick={() => {
                        if (window.confirm(`Échanger ${r.cout} points de ${choisi.prenom} contre « ${r.nom} » ?`)) void agir('echange', { recompenseId: r.id })
                      }}
                    >
                      <span>{r.nom}</span>
                      <span className="tabular-nums">{r.cout} pts</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {annonce && (
            <p
              className={annonce.type === 'ok' ? 'alerte-succes apparition' : annonce.type === 'attente' ? 'rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200' : 'rounded-xl bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-200'}
              role={annonce.type === 'refus' ? 'alert' : 'status'}
            >
              {annonce.type === 'refus' ? `Rien n’a été enregistré : ${annonce.texte}` : annonce.texte}
            </p>
          )}
        </section>
      )}
      {!choisi && annonce && <MessageErreur>{annonce.texte}</MessageErreur>}
      <p className="text-center text-xs text-gray-600">Données du {new Date(donnees.synchroLe).toLocaleString('fr-FR')} · chaque action est tracée au nom de {auteur.nom}.</p>
    </div>
  )
}

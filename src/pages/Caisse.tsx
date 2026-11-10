import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { MESSAGE_MODE_SERVEUR, messageErreur, useStore } from '../store'
import { useRoute } from '../router'
import type { Client, Commerce, EntreeJournal } from '../types'
import { echangerContreSession, ErreurApi, type AccesCaisse, type ClientApi, type GainCaisse } from '../data/api'
import { messageGain, normaliserCodeGagnant } from '../lib/roulette'
import { creerCoffrePin, rangementIndexedDb } from '../data/coffrePin'
import { ErreurCoffre, journaliserEchec, lireCoffreBorne, MESSAGE_COFFRE_ILLISIBLE } from '../lib/connexion'
import { tamponsAffiches } from '../lib/fidelite'
import { creerCodesDuJour, MESSAGE_MODE_DEGRADE } from '../lib/codeDuJour'
import { aideTampons, recapitulatif, type DemandeConfirmation } from '../lib/ecransCommercant'
import { Confirmation } from '../components/Confirmation'
import { analyserMontant, formaterPrix, passageCeJour, pointsPourMontant, soldePoints } from '../lib/points'
import { niveauClient, reserveUtilisable } from '../lib/programme'
import { correspondRecherche } from '../lib/recherche'
import { nomAffiche } from '../lib/inscriptionJeu'
import { clientIdDepuisQr, creerFileCaisse, libelleFile, nouvelIdAction, type ActionCaisse, type EtatFile, type Envoi, type TypeActionCaisse } from '../lib/fileCaisse'
import { LogoCommerce, MessageErreur } from '../components/ui'
import { ScannerQr } from '../components/ScannerQr'
import { SqueletteCaisse } from '../components/Squelette'
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

const LIBELLES: Record<TypeActionCaisse, string> = { passage: 'Passage', recompense: 'Récompense', echange: 'Échange de points', attente: 'Récompense en attente', reserve: 'Plat en réserve' }

function CaisseApi({ api, commerceId }: { api: ClientApi; commerceId: string }) {
  const coffre = useMemo(() => creerCoffrePin(stockage('sessionStorage'), rangementIndexedDb('caisse'), globalThis.crypto?.subtle, 'fidelite:caisse'), [])
  const file = useMemo(() => creerFileCaisse(stockage('localStorage'), `fidelite:caisse:file:v1:${commerceId}`), [commerceId])
  // Codes vérifiés en ligne aujourd'hui sur cet appareil (empreintes) : seul usage, le mode dégradé hors ligne.
  const codesDuJour = useMemo(() => creerCodesDuJour(stockage('localStorage'), `fidelite:caisse:codes-du-jour:v1:${commerceId}`), [commerceId])
  const cleCache = `fidelite:caisse:cache:v1:${commerceId}`

  // Accès de la caisse : session équipe (jeton, cas normal) ou code équipe (repli : serveur sans sessions).
  // Hors ligne, l'accès mémorisé reste utilisable tel quel : les actions vont dans la file, rien n'est vérifié
  // localement ; un jeton expiré entre-temps sera refusé au retour du réseau (actions gardées, code redemandé).
  const [acces, setAcces] = useState<AccesCaisse | null>(null)
  const [pret, setPret] = useState(false)
  const [donnees, setDonnees] = useState<Cache | null>(null)
  const [enLigne, setEnLigne] = useState(true)
  const [etatFile, setEtatFile] = useState<EtatFile>(() => file.lire())
  const [erreurAcces, setErreurAcces] = useState<string | null>(null)
  // Mode dégradé : ouverte hors ligne avec un « code déjà vu », pas encore revérifié par le serveur.
  const [degrade, setDegrade] = useState(false)
  const degradeRef = useRef(false)
  const accesRef = useRef<AccesCaisse | null>(null)
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
    async (a = accesRef.current) => {
      if (!a) return
      try {
        const r = await api.caisse(commerceId, a)
        ecrireCache({ commerce: r.commerce, clients: r.clients, auteur: r.auteur, synchroLe: new Date().toISOString() })
        setEnLigne(true)
        setErreurAcces(null)
        // Fin du mode dégradé : le serveur vient d'accepter le code (mémorisé comme un déverrouillage en ligne).
        if (degradeRef.current && 'code' in a) {
          degradeRef.current = false
          setDegrade(false)
          void codesDuJour.memoriser(a.code)
          await coffre.memoriser({ role: 'commerce', commerceId, pin: a.code })
        }
      } catch (e) {
        if (e instanceof ErreurApi && e.horsLigne) setEnLigne(false)
        else if (e instanceof ErreurApi && e.statut === 401) {
          degradeRef.current = false
          setDegrade(false)
          accesRef.current = null
          setAcces(null)
          await coffre.oublier()
          if ('code' in a) codesDuJour.oublier()
          setErreurAcces(
            'jeton' in a ? 'Session de caisse expirée ou fermée : saisissez votre code équipe.' : 'Code équipe refusé (il a peut-être été changé) : saisissez-le à nouveau.',
          )
        } else setErreurAcces(messageErreur(e))
      }
    },
    [api, codesDuJour, coffre, commerceId, ecrireCache],
  )

  const envoyer = useCallback(
    async (a: ActionCaisse): Promise<Envoi> => {
      const c = accesRef.current
      if (!c) return { ok: false, reseau: true }
      try {
        const r = await api.actionCaisse(commerceId, c, a.type, {
          clientId: a.clientId,
          actionId: a.id,
          faitLe: a.faitLe,
          ...(a.montantCentimes ? { montantCentimes: a.montantCentimes } : {}),
          ...(a.recompenseId ? { recompenseId: a.recompenseId } : {}),
        })
        reponses.current.set(a.id, r.client)
        return { ok: true }
      } catch (e) {
        // Réseau coupé, code changé ou session expirée entre-temps : l'action reste en file (rien n'est perdu ni compté).
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
    // Mode dégradé : le code est d'abord revérifié par le serveur (refusé → caisse reverrouillée, actions gardées en file).
    if (degradeRef.current) {
      await charger()
      if (degradeRef.current || !accesRef.current) {
        const e = file.lire()
        setEtatFile(e)
        return e
      }
    }
    const e = await file.synchroniser(envoyer)
    setEtatFile(e)
    if (!e.attente.length) await charger()
    return e
  }, [charger, envoyer, file])

  // Démarrage : session (ou code, en repli) mémorisée chiffrée pour cet onglet ? Données en cache affichées tout de suite (hors ligne).
  useEffect(() => {
    try {
      const brut = stockage('localStorage')?.getItem(cleCache)
      if (brut) setDonnees(JSON.parse(brut) as Cache)
    } catch {
      // cache illisible : ignoré
    }
    // Relecture bornée (un IndexedDB bloqué ne fige plus « Ouverture de la caisse… ») ; illisible = expliqué, pas ignoré.
    void lireCoffreBorne(coffre).then((r) => {
      if (r.statut === 'illisible') {
        journaliserEchec('caisse', new ErreurCoffre(r.raison), { stockage: stockage('localStorage') })
        setErreurAcces(MESSAGE_COFFRE_ILLISIBLE)
      }
      const lu = r.statut === 'ok' ? r.contenu : null
      // Session équipe (jeton) ; ou code équipe chiffré (repli, et format d'avant les sessions : { role: 'commerce', pin: code }).
      const a: AccesCaisse | null =
        !lu || lu.role === 'admin' || lu.commerceId !== commerceId ? null : lu.role === 'equipe' ? lu : lu.pin ? { code: lu.pin } : null
      if (a) {
        accesRef.current = a
        setAcces(a)
        void synchroniser()
      }
      setPret(true)
    })
  }, [cleCache, coffre, commerceId, synchroniser])

  // Retour du réseau, et toutes les 15 s tant que des actions attendent.
  useEffect(() => {
    if (!acces) return
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
  }, [acces, charger, file, synchroniser])

  async function deverrouiller(saisi: string) {
    setErreurAcces(null)
    try {
      // Le code part une fois (POST /sessions) contre un jeton de 12 h ; serveur sans sessions : repli sur le code, comme avant.
      const s = await echangerContreSession(api, { role: 'equipe', commerceId, code: saisi })
      const a: AccesCaisse = s ? { role: 'equipe', commerceId, jeton: s.jeton, expireLe: s.expireLe, membreNom: s.membreNom } : { code: saisi }
      const r = await api.caisse(commerceId, a)
      accesRef.current = a
      setAcces(a)
      ecrireCache({ commerce: r.commerce, clients: r.clients, auteur: r.auteur, synchroLe: new Date().toISOString() })
      setEnLigne(true)
      await coffre.memoriser('jeton' in a ? a : { role: 'commerce', commerceId, pin: saisi })
      // Vérifié par le serveur à l'instant : empreinte gardée pour la journée (mode dégradé si le réseau tombe ensuite).
      void codesDuJour.memoriser(saisi)
      void synchroniser()
    } catch (e) {
      journaliserEchec('caisse', e, { stockage: stockage('localStorage') })
      const horsLigne = e instanceof ErreurApi && e.horsLigne
      // Hors ligne seulement : un code déjà vérifié en ligne aujourd'hui sur cet appareil ouvre la caisse en mode dégradé.
      if (horsLigne && donnees && (await codesDuJour.dejaVu(saisi))) {
        const a: AccesCaisse = { code: saisi }
        accesRef.current = a
        degradeRef.current = true
        setDegrade(true)
        setEnLigne(false)
        setAcces(a)
        return
      }
      setErreurAcces(horsLigne ? 'Serveur injoignable : le code équipe doit être vérifié en ligne une première fois aujourd’hui sur cet appareil.' : messageErreur(e))
    }
  }

  async function verrouiller() {
    const a = accesRef.current
    // Révocation côté serveur, sans attendre (hors ligne : le jeton expirera seul).
    if (a && 'jeton' in a && a.jeton) void api.fermerSession(a.jeton).catch(() => {})
    accesRef.current = null
    degradeRef.current = false
    setDegrade(false)
    setAcces(null)
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

  if (!pret) return <SqueletteCaisse libelle="Ouverture de la caisse…" />
  if (!acces) return <Deverrouillage commerce={donnees?.commerce} erreur={erreurAcces} onCode={deverrouiller} attente={etatFile.attente.length} />
  if (!donnees) return enLigne ? <SqueletteCaisse libelle="Chargement des clients…" /> : <MessagePublic titre="Caisse">Hors ligne et aucune donnée en mémoire sur cet appareil.</MessagePublic>

  /** Code gagnant de la roue : toujours en ligne (jamais mis en file : la remise doit être vérifiée par le serveur). */
  async function gain(quoi: 'verifier' | 'remettre', code: string): Promise<GainCaisse> {
    const a = accesRef.current
    if (!a) throw new Error('Caisse verrouillée : saisissez votre code équipe.')
    try {
      return await (quoi === 'verifier' ? api.verifierGain(commerceId, a, code) : api.remettreGain(commerceId, a, code))
    } catch (e) {
      if (e instanceof ErreurApi && e.horsLigne) {
        setEnLigne(false)
        throw new ErreurApi(0, 'Hors ligne : un code gagnant ne peut être vérifié qu’avec le réseau. Réessayez dans un instant.')
      }
      throw e
    }
  }

  return (
    <Comptoir
      donnees={donnees}
      enLigne={enLigne}
      degrade={degrade}
      etatFile={etatFile}
      erreurAcces={erreurAcces}
      onGain={gain}
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
  degrade,
  etatFile,
  erreurAcces,
  onGain,
  onAgir,
  onClientMaj,
  onOublierRefus,
  onSynchroniser,
  onVerrouiller,
}: {
  donnees: Cache
  enLigne: boolean
  degrade: boolean
  etatFile: EtatFile
  erreurAcces: string | null
  onGain(quoi: 'verifier' | 'remettre', code: string): Promise<GainCaisse>
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
  // Échange de points / récompense : confirmé dans une modale avec récapitulatif (plus de boîte native du navigateur).
  const [demande, setDemande] = useState<DemandeConfirmation | null>(null)
  const rechercheRef = useRef<HTMLInputElement>(null)
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
          ? `✓ Passage enregistré pour ${nomAffiche(c.prenom)} : +1 tampon (${tamponsAffiches(c, commerce)}/${commerce.seuilTampons})${gagnes > 0 ? `, +${gagnes} point${gagnes > 1 ? 's' : ''}` : ''}.`
          : type === 'recompense'
            ? `🎁 Récompense remise à ${nomAffiche(c.prenom)} : ${commerce.recompense}.`
            : type === 'attente'
              ? `🎁 Récompense remise à ${nomAffiche(c.prenom)}.`
              : type === 'reserve'
                ? `🍜 Plat en réserve utilisé par ${nomAffiche(c.prenom)}.`
                : `✓ Échange enregistré pour ${nomAffiche(c.prenom)} — nouveau solde : ${soldePoints(c)} points.`,
    })
    if (type === 'passage') setMontant('')
  }

  function confirmer() {
    const d = demande
    setDemande(null)
    if (!d) return
    if (d.type === 'echange') void agir('echange', { recompenseId: d.recompense.id })
    else if (d.type === 'attente') void agir('attente', { recompenseId: d.attente.id })
    else void agir(d.type)
  }

  const statut = libelleFile(etatFile, enLigne)

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 pt-4 pb-10">
      <header className="flex items-center gap-3">
        <LogoCommerce commerce={commerce} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-titre text-xl font-bold">Caisse · {commerce.nom}</h1>
          <p className="text-sm text-gray-600">{degrade ? 'Connecté : code reconnu sur cet appareil (nom vérifié au retour du réseau)' : `Connecté : ${auteur.nom}`}</p>
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
      {degrade && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900 ring-2 ring-amber-400" role="status" data-mode-degrade>
          ⚠ {MESSAGE_MODE_DEGRADE}
        </p>
      )}
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
        <ScannerQr onLu={surQr} onFermer={() => setScanner(false)} onSaisieManuelle={() => (setScanner(false), setTimeout(() => rechercheRef.current?.focus(), 0))} />
      ) : (
        <section className="carte space-y-3">
          <button className="bouton w-full" onClick={() => setScanner(true)}>
            📷 Scanner la carte du client
          </button>
          <div>
            <label className="etiquette" htmlFor="caisse-recherche">
              Ou chercher : prénom, téléphone ou e-mail
            </label>
            <input ref={rechercheRef} id="caisse-recherche" className="champ" type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)} autoComplete="off" />
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
                      <span className="block font-semibold">{nomAffiche(c.prenom)}</span>
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

      <CodeGagnantCaisse onGain={onGain} />

      {choisi && (
        <section className="carte space-y-4" aria-label={`Client : ${nomAffiche(choisi.prenom)}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-bold">{nomAffiche(choisi.prenom)}</h2>
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
          {(() => {
            const niveau = niveauClient(choisi, commerce)
            const reserve = reserveUtilisable(choisi, new Date())
            const rattrapages = (choisi.demandesRattrapage ?? []).filter((d) => d.statut === 'en_attente')
            return (
              <>
                {niveau.nom !== 'Membre' && (
                  <p className="rounded-xl bg-amber-50 p-2 text-sm text-amber-900 ring-1 ring-amber-200">
                    {niveau.nom === 'VIP' ? '👑 VIP' : `⭐ ${niveau.nom}`} — points ×{niveau.multiplicateur}
                  </p>
                )}
                {(choisi.recompensesEnAttente ?? []).length > 0 && (
                  <div>
                    <p className="etiquette">Récompenses à remettre</p>
                    <ul className="space-y-2">
                      {(choisi.recompensesEnAttente ?? []).map((r) => (
                        <li key={r.id}>
                          <button className="bouton min-h-12 w-full justify-between bg-green-700 hover:bg-green-800 active:bg-green-900" disabled={enCours} onClick={() => setDemande({ type: 'attente', attente: r })}>
                            <span>🎁 {r.libelle}</span>
                            <span className="text-sm">{r.origine === 'palier' ? 'Palier' : r.origine === 'defi' ? 'Défi' : 'Anniversaire'}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {reserve && (
                  <button className="bouton min-h-12 w-full justify-between bg-green-700 hover:bg-green-800 active:bg-green-900" disabled={enCours} onClick={() => setDemande({ type: 'reserve' })}>
                    <span>🍜 Plat en réserve</span>
                    <span className="text-sm">avant le {new Date(reserve.expireLe).toLocaleDateString('fr-FR')}</span>
                  </button>
                )}
                {rattrapages.length > 0 && (
                  <p className="rounded-xl bg-amber-50 p-2 text-sm text-amber-900 ring-1 ring-amber-200">
                    {rattrapages.length} visite{rattrapages.length > 1 ? 's' : ''} oubliée{rattrapages.length > 1 ? 's' : ''} signalée{rattrapages.length > 1 ? 's' : ''} — à valider depuis la fiche client (PIN gérant).
                  </p>
                )}
              </>
            )
          })()}

          <div>
            <label className="etiquette" htmlFor="caisse-montant">
              Montant dépensé (optionnel)
            </label>
            <div className="relative">
              <input id="caisse-montant" className="champ pr-10" inputMode="decimal" placeholder="ex : 23,50" value={montant} onChange={(e) => setMontant(e.target.value)} />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-gray-600">€</span>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              {centimes === null
                ? 'Montant invalide (ex : 23,50).'
                : centimes > 0
                  ? `${formaterPrix(centimes)} → +${Math.round(pointsPourMontant(centimes, commerce) * niveauClient(choisi, commerce).multiplicateur)} point(s)${niveauClient(choisi, commerce).multiplicateur > 1 ? ` (${niveauClient(choisi, commerce).nom} ×${niveauClient(choisi, commerce).multiplicateur})` : ''}`
                  : 'Sans montant : 1 tampon, pas de points.'}
            </p>
          </div>

          <button className="bouton min-h-16 w-full text-lg" disabled={enCours || centimes === null} onClick={() => void agir('passage', centimes ? { montantCentimes: centimes } : {})}>
            ＋ Ajouter un passage
          </button>
          {(() => {
            // Aide AU-DESSUS du bouton : ce qu'il manque, et pourquoi le bouton est désactivé.
            const aide = aideTampons(choisi, commerce)
            return (
              <div className="space-y-1">
                <p id="caisse-aide-tampons" className={`text-sm ${aide.debloquee ? 'font-semibold text-green-800' : 'text-gray-700'}`} data-aide-tampons>
                  {aide.debloquee ? '🎉' : '⏳'} {aide.texte}
                </p>
                <button
                  className="bouton min-h-16 w-full bg-green-700 text-lg hover:bg-green-800 active:bg-green-900"
                  disabled={enCours || !aide.debloquee}
                  aria-describedby="caisse-aide-tampons"
                  onClick={() => setDemande({ type: 'recompense' })}
                >
                  🎁 Valider une récompense
                </button>
                {!aide.debloquee && <p className="text-xs text-gray-600">Bouton actif au {commerce.seuilTampons}e tampon.</p>}
              </div>
            )
          })()}

          {!!commerce.catalogue?.length && (
            <div>
              <p className="etiquette">Échanger des points</p>
              <ul className="space-y-2">
                {commerce.catalogue.map((r) => (
                  <li key={r.id}>
                    <button
                      className="bouton-secondaire min-h-12 w-full justify-between"
                      disabled={enCours || soldePoints(choisi) < r.cout}
                      onClick={() => setDemande({ type: 'echange', recompense: r })}
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
          {demande && <Confirmation recap={recapitulatif(demande, choisi, commerce)} enCours={enCours} onConfirmer={confirmer} onAnnuler={() => setDemande(null)} />}
        </section>
      )}
      {!choisi && annonce && <MessageErreur>{annonce.texte}</MessageErreur>}
      <p className="text-center text-xs text-gray-600">Données du {new Date(donnees.synchroLe).toLocaleString('fr-FR')} · chaque action est tracée au nom de {auteur.nom}.</p>
    </div>
  )
}

/** Code gagnant de la roue (P0-U3) : le client le montre, l'équipe le saisit, vérifie le lot puis le marque remis. */
function CodeGagnantCaisse({ onGain }: { onGain(quoi: 'verifier' | 'remettre', code: string): Promise<GainCaisse> }) {
  const [saisi, setSaisi] = useState('')
  const [gain, setGain] = useState<GainCaisse | null>(null)
  const [remisIci, setRemisIci] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  const code = normaliserCodeGagnant(saisi)

  async function appeler(quoi: 'verifier' | 'remettre', c: string) {
    setEnCours(true)
    setErreur(null)
    try {
      setGain(await onGain(quoi, c))
      setRemisIci(quoi === 'remettre')
    } catch (e) {
      setErreur(messageErreur(e))
      // Remise refusée (déjà remise par une autre caisse entre-temps…) : on réaffiche l'état à jour du code.
      if (quoi === 'remettre' && e instanceof ErreurApi && (e.statut === 409 || e.statut === 410)) {
        setGain(await onGain('verifier', c).catch(() => null))
      } else setGain(null)
    } finally {
      setEnCours(false)
    }
  }

  function verifier(e: FormEvent) {
    e.preventDefault()
    if (!code || enCours) return
    void appeler('verifier', code)
  }

  const date = gain && new Date(gain.date)
  return (
    <section className="carte space-y-3" aria-labelledby="caisse-gain-titre">
      <h2 id="caisse-gain-titre" className="titre-carte">
        🎡 Code gagnant de la roue
      </h2>
      <form onSubmit={verifier} className="flex gap-2">
        <label className="sr-only" htmlFor="caisse-code-gagnant">
          Code gagnant (6 caractères)
        </label>
        <input
          id="caisse-code-gagnant"
          className="champ min-w-0 flex-1 text-center font-mono text-xl tracking-[0.3em] uppercase"
          placeholder="ABC234"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={11}
          value={saisi}
          onChange={(e) => {
            setSaisi(e.target.value.toUpperCase())
            setGain(null)
            setErreur(null)
          }}
          aria-invalid={!!erreur}
          aria-describedby="caisse-code-aide"
        />
        <button type="submit" className="bouton shrink-0" disabled={!code || enCours}>
          {enCours ? '…' : 'Vérifier'}
        </button>
      </form>
      <p id="caisse-code-aide" className="text-xs text-gray-600">
        6 lettres ou chiffres, affichés sur le téléphone du client. Majuscules et espaces sans importance. Valable le jour du tirage seulement.
      </p>
      <MessageErreur>{erreur}</MessageErreur>
      {gain && date && (
        <div className="space-y-2 rounded-xl bg-gray-50 p-3 ring-1 ring-gray-200">
          <p className="font-titre text-2xl font-bold">{gain.lot}</p>
          <p className="text-sm text-gray-700">
            {gain.client ? <strong>{nomAffiche(gain.client.prenom)}</strong> : 'Client supprimé'} · tiré le {date.toLocaleDateString('fr-FR')} à{' '}
            {date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · code <span className="font-mono">{gain.code}</span>
          </p>
          {gain.statut === 'valable' ? (
            <button className="bouton min-h-14 w-full bg-green-700 text-lg hover:bg-green-800 active:bg-green-900" disabled={enCours} onClick={() => void appeler('remettre', gain.code)}>
              🎁 Marquer remis
            </button>
          ) : remisIci ? (
            <p className="alerte-succes apparition" role="status">
              ✓ Lot remis{gain.client ? ` à ${nomAffiche(gain.client.prenom)}` : ''} : {gain.lot}. Le code ne pourra plus resservir.
            </p>
          ) : (
            !erreur && (
              <p className="rounded-xl bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-200" role="alert">
                {messageGain(gain)}
              </p>
            )
          )}
        </div>
      )}
    </section>
  )
}

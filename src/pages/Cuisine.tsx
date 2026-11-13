// Écran cuisine #/cuisine (Expérience 10/10, lot 3) : commandes à table du jour, par statut, avec les seules actions
// permises. Écran commerçant (PIN), en français du back-office. Appels directs (`fetch(api.base + …)`), comme
// InstantsGagnants : aucune méthode ajoutée au client API, l'écran ne coûte rien au bundle initial.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import type { Acces } from '../data/api'
import { MESSAGE_HORS_LIGNE } from '../data/api'
import type { StatutCommande } from '../types'
import { EnTete } from '../components/ui'
import { formaterPrix } from '../lib/points'
import {
  actionsCuisine,
  anciennete,
  commandesDeSection,
  heureCommande,
  INTERVALLE_CUISINE_MS,
  jourLisible,
  jourPrecedent,
  nouvellesCommandes,
  remplacerCommande,
  SECTIONS_CUISINE,
  type CommandeCuisine,
  type SectionCuisine,
} from '../lib/cuisine'

/** Session si elle existe, sinon le PIN en en-tête (serveur sans sessions) — mêmes règles que `entetesAcces`. */
function entetesGerant(a: Acces): Record<string, string> {
  if (a.jeton) return { 'X-Session': a.jeton }
  if (a.pin === undefined) return {}
  return a.role === 'admin' ? { 'X-Admin-PIN': a.pin } : { 'X-Commerce-PIN': a.pin }
}

/** Réponse lue : statut HTTP (0 = serveur injoignable) et corps JSON (ou vide). */
type Reponse = { statut: number; corps: { erreur?: string; jour?: string; commandes?: CommandeCuisine[]; commande?: CommandeCuisine } }

async function appeler(url: string, acces: Acces, vers?: StatutCommande): Promise<Reponse> {
  try {
    const r = await fetch(url, {
      method: vers ? 'POST' : 'GET',
      headers: vers ? { ...entetesGerant(acces), 'Content-Type': 'application/json' } : entetesGerant(acces),
      body: vers ? JSON.stringify({ vers }) : undefined,
      cache: 'no-store',
    })
    // 502–504 : hébergeur joignable, serveur de l'app arrêté ou en réveil → traité comme hors ligne.
    if (r.status >= 502 && r.status <= 504) return { statut: 0, corps: {} }
    return { statut: r.status, corps: await r.json().catch(() => ({})) }
  } catch {
    return { statut: 0, corps: {} }
  }
}

function messageErreur(r: Reponse): string {
  if (r.statut === 0) return MESSAGE_HORS_LIGNE
  if (r.statut === 401 || r.statut === 403) return 'Session expirée : verrouillez puis rouvrez l’espace avec le PIN.'
  return r.corps.erreur ?? `Erreur du serveur (${r.statut}).`
}

export default function Cuisine() {
  const { mode, api, acces, commerce } = useStore()

  if (mode !== 'api' || !api || !acces) {
    return (
      <div className="space-y-5">
        <EnTete titre="Cuisine" />
        <section className="carte space-y-2">
          <h2 className="titre-carte">L’écran cuisine fonctionne avec le serveur</h2>
          <p className="text-gray-700">En démo locale, aucune commande à table n’est reçue : il n’y a rien à afficher ici.</p>
        </section>
      </div>
    )
  }

  if (!commerce.commande?.active) {
    return (
      <div className="space-y-5">
        <EnTete titre="Cuisine" />
        <section className="carte space-y-3">
          <h2 className="titre-carte">La commande à table n’est pas activée</h2>
          <p className="text-gray-700">
            Cet écran affiche les commandes que vos clients envoient depuis le QR code de leur table. Activez « Commande à table » et ajoutez vos tables dans les Réglages
            (onglet Commerce) : les commandes arriveront ici.
          </p>
          <a href="#/reglages" className="bouton w-full sm:w-auto">
            Ouvrir les Réglages
          </a>
        </section>
      </div>
    )
  }

  return <EcranCuisine key={commerce.id} base={api.base} commerceId={commerce.id} acces={acces} sansTable={!commerce.commande.tables.length} />
}

type Choix = 'aujourdhui' | 'hier'

function EcranCuisine({ base, commerceId, acces, sansTable }: { base: string; commerceId: string; acces: Acces; sansTable: boolean }) {
  const url = `${base}/commerces/${encodeURIComponent(commerceId)}/commandes`
  const [choix, setChoix] = useState<Choix>('aujourdhui')
  const [liste, setListe] = useState<{ jour: string; commandes: CommandeCuisine[] } | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [chargement, setChargement] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [enCours, setEnCours] = useState<ReadonlySet<string>>(new Set())
  const [signalees, setSignalees] = useState<ReadonlySet<string>>(new Set())
  const [maintenant, setMaintenant] = useState(Date.now)
  const [majA, setMajA] = useState<number | null>(null)
  // Jour « aujourd'hui » selon le serveur (Paris), base de « hier » : l'horloge de l'appareil n'entre pas en jeu.
  const aujourdhui = useRef<string | null>(null)
  // Commandes déjà affichées (null avant le premier affichage du jour) et numéro de la dernière lecture lancée.
  const deja = useRef<Set<string> | null>(null)
  const signaleesRef = useRef(signalees)
  const numero = useRef(0)

  const charger = useCallback(async () => {
    const hier = choix === 'hier' && aujourdhui.current
    const n = ++numero.current
    setChargement(true)
    const r = await appeler(hier ? `${url}?jour=${jourPrecedent(aujourdhui.current!)}` : url, acces)
    if (n !== numero.current) return
    setChargement(false)
    if (r.statut !== 200 || !r.corps.jour || !Array.isArray(r.corps.commandes)) {
      setErreur(messageErreur(r))
      return
    }
    const { jour, commandes } = r.corps as { jour: string; commandes: CommandeCuisine[] }
    if (!hier) {
      aujourdhui.current = jour
      const nouv = nouvellesCommandes(commandes, deja.current, signaleesRef.current)
      deja.current = new Set(commandes.map((c) => c.id))
      signaleesRef.current = nouv
      setSignalees(nouv)
    }
    setErreur(null)
    setListe({ jour, commandes })
    setMajA(Date.now())
    setMaintenant(Date.now())
  }, [choix, url, acces])

  // Lecture au chargement et au changement de jour ; relecture toutes les 10 s et au retour au premier plan
  // (aujourd'hui seulement, page visible seulement) : l'historique d'hier ne bouge plus.
  useEffect(() => {
    void charger()
    if (choix !== 'aujourdhui') return
    const siVisible = () => {
      if (document.visibilityState === 'visible') void charger()
    }
    const minuterie = window.setInterval(siVisible, INTERVALLE_CUISINE_MS)
    document.addEventListener('visibilitychange', siVisible)
    return () => {
      window.clearInterval(minuterie)
      document.removeEventListener('visibilitychange', siVisible)
    }
  }, [choix, charger])

  // « il y a X min » avance même sans nouvelle lecture.
  useEffect(() => {
    const minuterie = window.setInterval(() => setMaintenant(Date.now()), 30_000)
    return () => window.clearInterval(minuterie)
  }, [])

  const changer = async (c: CommandeCuisine, vers: StatutCommande) => {
    if (enCours.has(c.id)) return
    setEnCours((s) => new Set(s).add(c.id))
    setNote(null)
    // Une lecture lancée avant ce clic rapporterait l'ancien statut : sa réponse sera ignorée.
    ++numero.current
    setChargement(false)
    // Retour visuel immédiat : la carte passe dans sa nouvelle section avant la réponse.
    setListe((l) => l && { ...l, commandes: remplacerCommande(l.commandes, { ...c, statut: vers }) })
    const r = await appeler(`${url}/${encodeURIComponent(c.id)}/statut`, acces, vers)
    setEnCours((s) => {
      const t = new Set(s)
      t.delete(c.id)
      return t
    })
    if (r.statut === 200 && r.corps.commande) {
      const maj = r.corps.commande
      setListe((l) => l && { ...l, commandes: remplacerCommande(l.commandes, maj) })
    } else if (r.statut === 400 || r.statut === 404 || r.statut === 409) {
      // Un autre membre de l'équipe vient de faire la transition : on relit, sans erreur bloquante.
      setNote(`${c.table} : commande déjà mise à jour sur un autre appareil. Liste actualisée.`)
      void charger()
    } else {
      setListe((l) => l && { ...l, commandes: remplacerCommande(l.commandes, c) })
      setNote(`${c.table} : action non enregistrée. ${messageErreur(r)}`)
    }
  }

  const commandes = liste?.commandes ?? []
  const nbNouvelles = commandes.filter((c) => signalees.has(c.id) && c.statut === 'recue').length
  const aFaire = commandes.filter((c) => c.statut === 'recue' || c.statut === 'acceptee' || c.statut === 'en_preparation').length

  return (
    <div className="space-y-5">
      <EnTete
        titre="Cuisine"
        sousTitre={liste ? `${choix === 'hier' ? 'Hier' : 'Aujourd’hui'}, ${jourLisible(liste.jour)} · ${commandes.length} commande${commandes.length > 1 ? 's' : ''}` : 'Commandes à table du jour'}
        action={
          <button type="button" className="bouton-secondaire shrink-0" onClick={() => void charger()} disabled={chargement} aria-busy={chargement}>
            {chargement ? 'Actualisation…' : 'Actualiser'}
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl bg-gray-100 p-1" role="group" aria-label="Jour affiché">
          {(['aujourdhui', 'hier'] as const).map((j) => (
            <button
              key={j}
              type="button"
              aria-pressed={choix === j}
              disabled={j === 'hier' && !aujourdhui.current}
              onClick={() => setChoix(j)}
              className={`min-h-11 rounded-lg px-4 font-semibold transition-colors ${choix === j ? 'bg-white text-gray-900 shadow-douce' : 'text-gray-700'}`}
            >
              {j === 'hier' ? 'Hier' : 'Aujourd’hui'}
            </button>
          ))}
        </div>
        {majA && (
          <p className="text-sm text-gray-600">
            Mis à jour à {new Date(majA).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            {choix === 'aujourdhui' ? ' · relu toutes les 10 s' : ''}
          </p>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {nbNouvelles ? `${nbNouvelles} nouvelle${nbNouvelles > 1 ? 's' : ''} commande${nbNouvelles > 1 ? 's' : ''}` : ''}
      </p>

      {sansTable && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          Aucune table n’est configurée : ajoutez-en dans les Réglages pour imprimer leurs QR codes.{' '}
          <a href="#/reglages" className="font-semibold underline">
            Réglages
          </a>
        </p>
      )}

      {erreur && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-nuit-900 px-3 py-2 text-sm text-white ring-1 ring-white/10" role="alert">
          <span>
            {erreur}
            {liste ? ' Commandes affichées telles qu’au dernier chargement.' : ''}
          </span>
          <button type="button" className="min-h-11 shrink-0 px-1 font-semibold underline" onClick={() => void charger()}>
            Réessayer
          </button>
        </div>
      )}

      {note && (
        <p className="flex items-center justify-between gap-3 rounded-xl bg-gray-100 px-3 py-2 text-sm text-gray-700" role="status">
          <span>{note}</span>
          <button type="button" className="min-h-11 shrink-0 px-1 font-semibold underline" onClick={() => setNote(null)}>
            OK
          </button>
        </p>
      )}

      {!liste && !erreur && <p className="text-gray-600">Chargement des commandes…</p>}

      {liste && !commandes.length && (
        <p className="rounded-2xl border border-dashed border-gray-300 bg-white/60 p-6 text-center text-gray-600">
          {choix === 'hier' ? 'Aucune commande à table hier.' : 'Aucune commande pour l’instant. Les nouvelles s’affichent ici d’elles-mêmes.'}
        </p>
      )}

      {liste && commandes.length > 0 && choix === 'aujourdhui' && !aFaire && <p className="text-gray-700">Tout est servi : rien en attente.</p>}

      {liste &&
        SECTIONS_CUISINE.map((s) => (
          <SectionCommandes
            key={s.statut}
            section={s}
            commandes={commandesDeSection(commandes, s.statut)}
            signalees={signalees}
            enCours={enCours}
            maintenant={maintenant}
            onAction={choix === 'aujourdhui' ? changer : undefined}
          />
        ))}
    </div>
  )
}

function SectionCommandes({
  section,
  commandes,
  signalees,
  enCours,
  maintenant,
  onAction,
}: {
  section: SectionCuisine
  commandes: CommandeCuisine[]
  signalees: ReadonlySet<string>
  enCours: ReadonlySet<string>
  maintenant: number
  onAction?: (c: CommandeCuisine, vers: StatutCommande) => void
}) {
  if (!commandes.length) return null
  const cartes = (
    <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
      {commandes.map((c) => (
        <CarteCommande key={c.id} commande={c} nouvelle={signalees.has(c.id) && c.statut === 'recue'} envoi={enCours.has(c.id)} maintenant={maintenant} onAction={onAction} />
      ))}
    </div>
  )
  const titre = `${section.titre} (${commandes.length})`
  // Servies : repliées (le service continue, elles ne gênent pas) ; refusées : discrètes, repliées aussi.
  if (section.repliee || section.discrete) {
    return (
      <details className={`rounded-2xl ${section.discrete ? 'opacity-80' : ''}`}>
        <summary className={`flex min-h-11 cursor-pointer items-center font-semibold ${section.discrete ? 'text-sm text-gray-600' : 'text-lg text-gray-800'}`}>{titre}</summary>
        <div className="mt-3">{cartes}</div>
      </details>
    )
  }
  return (
    <section className="space-y-3" aria-label={section.titre}>
      <h2 className="font-titre text-xl font-bold text-gray-900">{titre}</h2>
      {cartes}
    </section>
  )
}

function CarteCommande({
  commande: c,
  nouvelle,
  envoi,
  maintenant,
  onAction,
}: {
  commande: CommandeCuisine
  nouvelle: boolean
  envoi: boolean
  maintenant: number
  onAction?: (c: CommandeCuisine, vers: StatutCommande) => void
}) {
  const actions = onAction ? actionsCuisine(c.statut) : []
  return (
    <article className={`carte flex flex-col gap-3 ${nouvelle ? 'ring-4 ring-magenta-500' : ''}`} aria-label={`${c.table}, commande de ${heureCommande(c.creeLe)}`} data-commande={c.id}>
      <div className="flex items-start justify-between gap-3">
        {/* Nom de la table tel que saisi dans les Réglages (« Table 4 », « Terrasse 2 ») : lisible de loin. */}
        <p className="min-w-0 font-titre text-3xl leading-tight font-bold break-words text-gray-900">{c.table}</p>
        <div className="shrink-0 text-right">
          {nouvelle && <span className="mb-1 inline-block rounded-full bg-magenta-500 px-3 py-1 text-sm font-bold text-white">Nouveau</span>}
          <p className="text-lg font-semibold tabular-nums">{heureCommande(c.creeLe)}</p>
          <p className="text-sm text-gray-600">{anciennete(c.creeLe, maintenant)}</p>
        </div>
      </div>

      <ul className="divide-y divide-gray-100">
        {c.lignes.map((l, i) => (
          <li key={i} className="py-2">
            <p className="flex items-baseline gap-2 text-lg">
              <span className="font-bold tabular-nums">{l.quantite} ×</span>
              <span className="min-w-0 flex-1 font-semibold break-words">{l.nom}</span>
            </p>
            {l.options.length > 0 && <p className="pl-8 text-gray-700">+ {l.options.map((o) => o.nom).join(', ')}</p>}
            {l.instructions && <p className="mt-1 ml-8 rounded-lg bg-amber-100 px-2 py-1 font-semibold text-amber-900 ring-1 ring-amber-400">« {l.instructions} »</p>}
          </li>
        ))}
      </ul>

      {c.instructions && (
        <p className="rounded-lg bg-amber-100 px-3 py-2 font-semibold text-amber-900 ring-1 ring-amber-400">
          <span className="block text-sm font-bold">Pour toute la commande</span>« {c.instructions} »
        </p>
      )}

      <p className="flex justify-between border-t border-gray-100 pt-2 font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formaterPrix(c.total)}</span>
      </p>

      {actions.length > 0 && (
        <div className="flex gap-3">
          {actions.map((a) => (
            <button
              key={a.vers}
              type="button"
              disabled={envoi}
              onClick={() => onAction!(c, a.vers)}
              className={`${a.principale ? 'bouton flex-1' : 'bouton-secondaire'} min-h-14 text-lg`}
            >
              {a.libelle}
            </button>
          ))}
        </div>
      )}
      {envoi && (
        <p className="text-sm text-gray-600" role="status">
          Envoi…
        </p>
      )}
    </article>
  )
}

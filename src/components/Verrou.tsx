import { useEffect, useState, type FormEvent } from 'react'
import { useStore } from '../store'
import { NOM_APP } from '../data/defaults'
import { ErreurApi } from '../data/api'
import { DELAI_ACCES_MS, DELAI_INDICE_REVEIL_MS, echecReessayable, ligneDiagnostic, lireJournal, MESSAGE_DELAI_DEPASSE, MESSAGE_REVEIL_EN_COURS, messageEchec } from '../lib/connexion'
import { BadgeDemo, LogoCommerce } from './ui'

/** Vrai quand `actif` dure depuis plus de `ms` (retombe à faux dès que `actif` redevient faux). */
export function useDepasse(actif: boolean, ms: number): boolean {
  const [depasse, setDepasse] = useState(false)
  useEffect(() => {
    setDepasse(false)
    if (!actif) return
    const minuterie = setTimeout(() => setDepasse(true), ms)
    return () => clearTimeout(minuterie)
  }, [actif, ms])
  return actif && depasse
}

function journalLocal() {
  try {
    return lireJournal(window.localStorage)
  } catch {
    return []
  }
}

/**
 * Mode API : écran de déverrouillage des pages commerçant. PIN commerce (4-6 chiffres) ou PIN admin.
 * Le PIN n'est jamais affiché (champ masqué) ; il est échangé contre un jeton de session (gardé chiffré pour la durée
 * de l'onglet) — ou, si le serveur n'ouvre pas de session, mémorisé chiffré comme avant.
 *
 * P0-U5 : un serveur injoignable (ou qui se réveille) n'est jamais présenté comme un PIN faux ; le PIN est alors
 * gardé et « Réessayer » relance la même tentative. Un verrouillage subi (session expirée…) reste expliqué.
 */
export function Verrou() {
  const { etat, deverrouiller, recharger, relireAcces, connexion, erreurConnexion, verrouillage } = useStore()
  const [role, setRole] = useState<'commerce' | 'admin'>(verrouillage?.role === 'admin' ? 'admin' : 'commerce')
  const [commerceId, setCommerceId] = useState(etat.commerceActifId || '')
  const [pin, setPin] = useState('')
  const [enCours, setEnCours] = useState(false)
  const [echec, setEchec] = useState<unknown>(null)
  const [journal, setJournal] = useState(journalLocal)
  const choisi = etat.commerces.find((c) => c.id === commerceId) ?? etat.commerces[0]
  const pinValide = role === 'admin' ? /^\d{4,12}$/.test(pin) : /^\d{4,6}$/.test(pin)
  const reveil = useDepasse(enCours, DELAI_INDICE_REVEIL_MS)
  const listeLente = useDepasse(etat.commerces.length === 0 && connexion === 'chargement', DELAI_ACCES_MS)

  async function tenter() {
    if (!pinValide || (role === 'commerce' && !choisi)) return
    setEnCours(true)
    setEchec(null)
    try {
      await deverrouiller(role === 'admin' ? { role: 'admin', pin } : { role: 'commerce', commerceId: choisi!.id, pin })
    } catch (e) {
      setEchec(e)
      // PIN refusé (401) ou bloqué (429) : à ressaisir. Serveur injoignable / délai : PIN gardé pour « Réessayer ».
      if (!echecReessayable(e)) setPin('')
      setJournal(journalLocal())
    } finally {
      setEnCours(false)
    }
  }

  function envoyer(e: FormEvent) {
    e.preventDefault()
    void tenter()
  }

  const messageFormulaire = echec ? messageEchec(echec) : null
  const reessayer = !!echec && echecReessayable(echec) && pinValide

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-10">
      <div className="text-center">
        <p className="font-titre text-lg font-bold text-magenta-700">{NOM_APP}</p>
        <h1 className="mt-2 font-titre text-[1.75rem] font-bold tracking-tight">Espace commerçant</h1>
        <p className="mt-1 text-gray-600">Saisissez le PIN de votre commerce pour ouvrir votre tableau de bord.</p>
      </div>

      {verrouillage && (
        <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200" role="alert" data-verrouillage>
          {verrouillage.message}
          {verrouillage.coffre && (
            <button type="button" className="ml-2 min-h-11 font-semibold underline" onClick={() => void relireAcces()}>
              Réessayer
            </button>
          )}
        </div>
      )}

      {erreurConnexion && (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200" role="alert">
          {erreurConnexion}
          {connexion === 'horsLigne' && (
            <button type="button" className="ml-2 min-h-11 font-semibold underline" onClick={() => void recharger()}>
              Réessayer
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Type d’accès">
        {(
          [
            ['commerce', 'Mon commerce'],
            ['admin', 'Admin (tous)'],
          ] as const
        ).map(([valeur, libelle]) => (
          <button
            key={valeur}
            type="button"
            role="tab"
            aria-selected={role === valeur}
            onClick={() => (setRole(valeur), setPin(''), setEchec(null))}
            className="puce"
          >
            {libelle}
          </button>
        ))}
      </div>

      <form onSubmit={envoyer} className="carte space-y-4">
        {role === 'commerce' &&
          (etat.commerces.length === 0 ? (
            listeLente ? (
              <p className="text-sm text-red-800" role="alert">
                {MESSAGE_DELAI_DEPASSE}
                <button type="button" className="ml-2 min-h-11 font-semibold underline" onClick={() => void recharger()}>
                  Réessayer
                </button>
              </p>
            ) : (
              <p className="text-sm text-gray-600">{connexion === 'chargement' ? 'Chargement de la liste des commerces…' : 'Liste des commerces indisponible.'}</p>
            )
          ) : (
            <div>
              <label className="etiquette" htmlFor="verrou-commerce">
                Commerce
              </label>
              <div className="flex items-center gap-3">
                {choisi && <LogoCommerce commerce={choisi} />}
                <select id="verrou-commerce" className="champ" value={choisi?.id ?? ''} onChange={(e) => setCommerceId(e.target.value)}>
                  {etat.commerces.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nom}
                      {c.demo ? ' (démo)' : ''}
                      {c.actif ? '' : ' (inactif)'}
                    </option>
                  ))}
                </select>
              </div>
              {choisi?.demo && (
                <p className="mt-1 text-sm text-gray-600">
                  <BadgeDemo /> Commerce de démonstration : données fictives.
                </p>
              )}
            </div>
          ))}
        <div>
          <label className="etiquette" htmlFor="verrou-pin">
            {role === 'admin' ? 'PIN admin' : 'PIN du commerce (4 à 6 chiffres)'}
          </label>
          <input
            id="verrou-pin"
            className="champ tracking-[0.4em]"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={role === 'admin' ? 12 : 6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            aria-invalid={!!echec && echec instanceof ErreurApi && echec.statut === 401}
            aria-describedby={messageFormulaire ? 'verrou-erreur' : undefined}
          />
          {messageFormulaire && (
            <p id="verrou-erreur" className="mt-1 text-sm text-red-700" role="alert">
              {messageFormulaire}
              {reessayer && (
                <button type="button" className="ml-2 min-h-11 font-semibold underline" onClick={() => void tenter()} disabled={enCours}>
                  Réessayer
                </button>
              )}
            </p>
          )}
        </div>
        <button type="submit" className="bouton w-full" disabled={!pinValide || enCours || (role === 'commerce' && !choisi)}>
          {enCours ? 'Vérification…' : 'Déverrouiller'}
        </button>
        {reveil && (
          <p className="text-sm text-gray-600" role="status">
            {MESSAGE_REVEIL_EN_COURS}
          </p>
        )}
        <p className="text-sm text-gray-600">
          Le PIN est vérifié une fois puis remplacé par une session de 8 h, gardée chiffrée tant que cet onglet est ouvert. « Verrouiller » ferme la
          session et efface les données clients gardées sur cet appareil.
        </p>
      </form>

      {journal.length > 0 && (
        <details className="text-sm text-gray-600">
          <summary className="min-h-11 cursor-pointer py-3">Détails pour l’assistance ({journal.length})</summary>
          <p className="mb-1">Derniers échecs de connexion sur cet appareil (aucun PIN n’y figure). Une capture d’écran suffit.</p>
          <ul className="space-y-1 break-words">
            {journal.slice(0, 5).map((e, i) => (
              <li key={i}>{ligneDiagnostic(e)}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

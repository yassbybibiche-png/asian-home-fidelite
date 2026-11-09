import { useState, type FormEvent } from 'react'
import { useAction, useStore } from '../store'
import { NOM_APP } from '../data/defaults'
import { BadgeDemo, LogoCommerce } from './ui'

/**
 * Mode API : écran de déverrouillage des pages commerçant. PIN commerce (4-6 chiffres) ou PIN admin.
 * Le PIN n'est jamais affiché (champ masqué) ; il est mémorisé chiffré pour la durée de l'onglet.
 */
export function Verrou() {
  const { etat, deverrouiller, recharger, connexion, erreurConnexion } = useStore()
  const [role, setRole] = useState<'commerce' | 'admin'>('commerce')
  const [commerceId, setCommerceId] = useState(etat.commerceActifId || '')
  const [pin, setPin] = useState('')
  const { executer, enCours, erreur } = useAction()
  const choisi = etat.commerces.find((c) => c.id === commerceId) ?? etat.commerces[0]
  const pinValide = role === 'admin' ? /^\d{4,12}$/.test(pin) : /^\d{4,6}$/.test(pin)

  async function envoyer(e: FormEvent) {
    e.preventDefault()
    if (!pinValide || (role === 'commerce' && !choisi)) return
    const r = await executer(() => deverrouiller(role === 'admin' ? { role: 'admin', pin } : { role: 'commerce', commerceId: choisi!.id, pin }))
    if (!r.ok) setPin('')
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-10">
      <div className="text-center">
        <p className="text-lg font-extrabold text-marque-500">{NOM_APP}</p>
        <h1 className="mt-2 text-2xl font-bold">Espace commerçant</h1>
        <p className="mt-1 text-gray-600">Saisissez le PIN de votre commerce pour ouvrir votre tableau de bord.</p>
      </div>

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
            onClick={() => (setRole(valeur), setPin(''))}
            className={`min-h-11 rounded-full px-4 text-sm font-semibold ${role === valeur ? 'bg-marque-500 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-300'}`}
          >
            {libelle}
          </button>
        ))}
      </div>

      <form onSubmit={envoyer} className="carte space-y-4">
        {role === 'commerce' &&
          (etat.commerces.length === 0 ? (
            <p className="text-sm text-gray-600">{connexion === 'chargement' ? 'Chargement de la liste des commerces…' : 'Liste des commerces indisponible.'}</p>
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
                <p className="mt-1 text-sm text-gray-500">
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
            aria-invalid={!!erreur}
            aria-describedby={erreur ? 'verrou-erreur' : undefined}
          />
          {erreur && (
            <p id="verrou-erreur" className="mt-1 text-sm text-red-600" role="alert">
              {erreur}
            </p>
          )}
        </div>
        <button type="submit" className="bouton w-full" disabled={!pinValide || enCours || (role === 'commerce' && !choisi)}>
          {enCours ? 'Vérification…' : 'Déverrouiller'}
        </button>
        <p className="text-xs text-gray-500">
          Le PIN reste mémorisé tant que cet onglet est ouvert (chiffré, jamais en clair). « Verrouiller » l’efface, ainsi que les données clients gardées
          sur cet appareil.
        </p>
      </form>
    </div>
  )
}

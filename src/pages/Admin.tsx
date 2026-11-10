import { useMemo, useState, type FormEvent } from 'react'
import { useAction, useStore } from '../store'
import type { TypeCommerce } from '../types'
import { TYPES_COMMERCE, libelleType } from '../data/defaults'
import { BadgeDemo, EnTete, LogoCommerce, MessageErreur } from '../components/ui'

export default function Admin() {
  const { etat, commerce: commerceActif, choisirCommerce, basculerActif, reinitialiserDemo, mode, acces, verrouiller } = useStore()
  const [formulaireOuvert, setFormulaireOuvert] = useState(false)
  const [pinOuvert, setPinOuvert] = useState<string | null>(null)
  const { executer, enCours, erreur } = useAction()

  // Comptes par commerce calculés en un seul passage.
  const comptes = useMemo(() => {
    const m = new Map<string, { clients: number; avis: number }>()
    for (const c of etat.commerces) m.set(c.id, { clients: 0, avis: 0 })
    for (const c of etat.clients) {
      const x = m.get(c.commerceId)
      if (x) x.clients++
    }
    for (const a of etat.avis) {
      const x = m.get(a.commerceId)
      if (x) x.avis++
    }
    return m
  }, [etat])

  const nbActifs = etat.commerces.filter((c) => c.actif).length

  function reinitialiser() {
    if (window.confirm('Réinitialiser la démo ? Toutes vos modifications seront remplacées par les 3 commerces d’exemple.')) {
      reinitialiserDemo()
      setFormulaireOuvert(false)
    }
  }

  // Mode API : l'admin multi-commerces demande le PIN admin (le PIN d'un commerce ne suffit pas).
  if (mode === 'api' && acces?.role !== 'admin') {
    return (
      <div className="space-y-5">
        <EnTete titre="Admin" sousTitre="Tous les commerces : création, activation, PIN." />
        <section className="carte space-y-3">
          <p className="text-gray-700">Cette page est réservée à l’admin. Le PIN de votre commerce n’y donne pas accès.</p>
          <button className="bouton-secondaire w-full" onClick={() => void verrouiller()}>
            Verrouiller et saisir le PIN admin
          </button>
        </section>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <EnTete
        titre="Admin"
        sousTitre={`${etat.commerces.length} commerce${etat.commerces.length > 1 ? 's' : ''} · ${nbActifs} actif${nbActifs > 1 ? 's' : ''}`}
        action={mode === 'local' ? <BadgeDemo /> : undefined}
      />
      <MessageErreur>{erreur}</MessageErreur>

      {formulaireOuvert ? (
        <FormulaireAjout onFermer={() => setFormulaireOuvert(false)} />
      ) : (
        <button className="bouton w-full" onClick={() => setFormulaireOuvert(true)}>
          + Ajouter un commerce
        </button>
      )}

      <ul className="space-y-3">
        {etat.commerces.map((c) => {
          const n = comptes.get(c.id) ?? { clients: 0, avis: 0 }
          const affiche = c.id === commerceActif.id
          return (
            <li key={c.id} className={`carte ${affiche ? 'ring-2 ring-marque-500' : ''}`}>
              <div className="flex items-start gap-3">
                <LogoCommerce commerce={c} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{c.nom}</p>
                  <p className="flex items-center gap-2 text-sm text-gray-600">
                    {libelleType(c.type)}
                    {mode === 'api' && c.demo && <BadgeDemo />}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    c.actif ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'
                  }`}
                >
                  {c.actif ? 'Actif' : 'Inactif'}
                </span>
              </div>
              <p className="mt-2 text-sm text-gray-600">
                <strong className="text-gray-900">{n.clients}</strong> client{n.clients > 1 ? 's' : ''} ·{' '}
                <strong className="text-gray-900">{n.avis}</strong> avis
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {affiche ? (
                  <a href="#/accueil" className="bouton-secondaire px-3 text-sm">
                    Affiché ✓
                  </a>
                ) : (
                  <button className="bouton-secondaire px-3 text-sm" onClick={() => choisirCommerce(c.id)}>
                    Afficher
                  </button>
                )}
                <button className="bouton-secondaire px-3 text-sm" disabled={enCours} onClick={() => void executer(() => basculerActif(c.id))}>
                  {c.actif ? 'Désactiver' : 'Activer'}
                </button>
              </div>
              {mode === 'api' &&
                (pinOuvert === c.id ? (
                  <FormulairePin commerceId={c.id} onFermer={() => setPinOuvert(null)} />
                ) : (
                  <button className="mt-2 min-h-11 w-full text-sm font-semibold text-gray-600 underline" onClick={() => setPinOuvert(c.id)}>
                    Changer le PIN de ce commerce
                  </button>
                ))}
            </li>
          )
        })}
      </ul>

      {mode === 'local' && (
      <section className="carte">
        <h2 className="titre-carte">Démo</h2>
        <p className="mt-1 text-sm text-gray-600">
          Les données sont enregistrées dans ce navigateur uniquement. La réinitialisation restaure les 3 commerces d’exemple.
        </p>
        <button className="bouton-secondaire mt-3 w-full text-red-700" onClick={reinitialiser}>
          Réinitialiser la démo
        </button>
      </section>
      )}
    </div>
  )
}

const PIN_COMMERCE = /^\d{4,6}$/

/** Champ PIN masqué (jamais affiché en clair). */
function ChampPin({ id, libelle, valeur, onChange }: { id: string; libelle: string; valeur: string; onChange(v: string): void }) {
  return (
    <div>
      <label className="etiquette" htmlFor={id}>
        {libelle}
      </label>
      <input
        id={id}
        className="champ tracking-[0.4em]"
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        maxLength={6}
        value={valeur}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      />
    </div>
  )
}

/** PIN perdu ou à changer : l'admin le remplace (le serveur ne garde qu'une empreinte). */
function FormulairePin({ commerceId, onFermer }: { commerceId: string; onFermer(): void }) {
  const { changerPin } = useStore()
  const [pin, setPin] = useState('')
  const [fait, setFait] = useState(false)
  const { executer, enCours, erreur } = useAction()

  async function envoyer(e: FormEvent) {
    e.preventDefault()
    if (!PIN_COMMERCE.test(pin)) return
    if ((await executer(() => changerPin(commerceId, pin))).ok) {
      setPin('')
      setFait(true)
    }
  }

  return (
    <form onSubmit={envoyer} className="mt-3 space-y-2 border-t border-gray-100 pt-3">
      <ChampPin id={`pin-${commerceId}`} libelle="Nouveau PIN (4 à 6 chiffres)" valeur={pin} onChange={(v) => (setPin(v), setFait(false))} />
      {pin && !PIN_COMMERCE.test(pin) && <p className="text-sm text-red-700">Le PIN doit contenir 4 à 6 chiffres.</p>}
      <MessageErreur>{erreur && `PIN non changé : ${erreur}`}</MessageErreur>
      {fait && (
        <p className="alerte-succes" role="status">
          ✓ PIN changé. Communiquez-le au commerçant.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="bouton-secondaire" onClick={onFermer}>
          Fermer
        </button>
        <button type="submit" className="bouton" disabled={!PIN_COMMERCE.test(pin) || enCours}>
          {enCours ? 'Envoi…' : 'Changer'}
        </button>
      </div>
    </form>
  )
}

function FormulaireAjout({ onFermer }: { onFermer: () => void }) {
  const { creerCommerce, mode } = useStore()
  const [nom, setNom] = useState('')
  const [type, setType] = useState<TypeCommerce>('restaurant')
  const [lienGoogle, setLienGoogle] = useState('')
  const [pin, setPin] = useState('')
  const [essaye, setEssaye] = useState(false)
  const { executer, enCours, erreur } = useAction()
  const avecPin = mode === 'api'
  const lienValide = !lienGoogle.trim() || /^https?:\/\/\S+$/i.test(lienGoogle.trim())
  const valide = !!nom.trim() && lienValide && (!avecPin || PIN_COMMERCE.test(pin))

  async function ajouter(e: FormEvent) {
    e.preventDefault()
    setEssaye(true)
    if (!valide || enCours) return
    // Mode API : commerce + PIN créés en une seule requête. Le nouveau commerce devient le commerce affiché ;
    // le reste se règle dans Réglages.
    const r = await executer(() => creerCommerce({ nom: nom.trim(), type, lienGoogle: lienGoogle.trim(), ...(avecPin ? { pin } : {}) }))
    if (!r.ok) return
    onFermer()
    window.location.hash = '/reglages'
  }

  return (
    <form onSubmit={ajouter} className="carte space-y-4">
      <h2 className="titre-carte">Nouveau commerce</h2>
      <div>
        <label className="etiquette" htmlFor="nouveau-nom">
          Nom du commerce
        </label>
        <input id="nouveau-nom" className="champ" value={nom} onChange={(e) => setNom(e.target.value)} required autoFocus />
      </div>
      <div>
        <label className="etiquette" htmlFor="nouveau-type">
          Type de commerce
        </label>
        <select id="nouveau-type" className="champ" value={type} onChange={(e) => setType(e.target.value as TypeCommerce)}>
          {TYPES_COMMERCE.map((t) => (
            <option key={t.valeur} value={t.valeur}>
              {t.libelle}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="etiquette" htmlFor="nouveau-google">
          Lien vers la fiche Google (optionnel)
        </label>
        <input
          id="nouveau-google"
          className="champ"
          type="url"
          inputMode="url"
          placeholder="https://g.page/r/…/review"
          value={lienGoogle}
          onChange={(e) => setLienGoogle(e.target.value)}
        />
        {essaye && !lienValide && <p className="mt-1 text-sm text-red-700">Le lien doit commencer par https:// (ou laissez vide).</p>}
      </div>
      {avecPin && (
        <div>
          <ChampPin id="nouveau-pin" libelle="PIN du commerçant (4 à 6 chiffres)" valeur={pin} onChange={setPin} />
          {essaye && !PIN_COMMERCE.test(pin) ? (
            <p className="mt-1 text-sm text-red-700">Le PIN doit contenir 4 à 6 chiffres.</p>
          ) : (
            <p className="mt-1 text-sm text-gray-600">À donner au commerçant : il lui ouvre son tableau de bord (et seulement le sien).</p>
          )}
        </div>
      )}
      <p className="text-sm text-gray-600">
        Récompense (10 tampons), lots de la roulette et réponses auto sont pré-remplis : vous pourrez les ajuster ensuite dans Réglages.
      </p>
      <MessageErreur>{erreur && `Commerce non créé : ${erreur}`}</MessageErreur>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="bouton-secondaire" onClick={onFermer}>
          Annuler
        </button>
        <button type="submit" className="bouton" disabled={!nom.trim() || enCours}>
          {enCours ? 'Création…' : 'Créer'}
        </button>
      </div>
    </form>
  )
}

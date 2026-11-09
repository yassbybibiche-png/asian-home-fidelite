import { useMemo, useState, type FormEvent } from 'react'
import { useStore } from '../store'
import type { TypeCommerce } from '../types'
import { TYPES_COMMERCE, libelleType, nouveauCommerce } from '../data/defaults'
import { BadgeDemo, EnTete, LogoCommerce } from '../components/ui'

export default function Admin() {
  const { etat, commerce: commerceActif, choisirCommerce, basculerActif, reinitialiserDemo } = useStore()
  const [formulaireOuvert, setFormulaireOuvert] = useState(false)

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

  return (
    <div className="space-y-5">
      <EnTete
        titre="Admin"
        sousTitre={`${etat.commerces.length} commerce${etat.commerces.length > 1 ? 's' : ''} · ${nbActifs} actif${nbActifs > 1 ? 's' : ''}`}
        action={<BadgeDemo />}
      />

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
                  <p className="text-sm text-gray-500">{libelleType(c.type)}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    c.actif ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'
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
                <button className="bouton-secondaire px-3 text-sm" onClick={() => basculerActif(c.id)}>
                  {c.actif ? 'Désactiver' : 'Activer'}
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      <section className="carte">
        <h2 className="font-bold">Démo</h2>
        <p className="mt-1 text-sm text-gray-600">
          Les données sont enregistrées dans ce navigateur uniquement. La réinitialisation restaure les 3 commerces d’exemple.
        </p>
        <button className="bouton-secondaire mt-3 w-full text-red-700" onClick={reinitialiser}>
          Réinitialiser la démo
        </button>
      </section>
    </div>
  )
}

function FormulaireAjout({ onFermer }: { onFermer: () => void }) {
  const { ajouterCommerce } = useStore()
  const [nom, setNom] = useState('')
  const [type, setType] = useState<TypeCommerce>('restaurant')
  const [lienGoogle, setLienGoogle] = useState('')

  function ajouter(e: FormEvent) {
    e.preventDefault()
    if (!nom.trim()) return
    // Le nouveau commerce devient le commerce affiché ; le reste se règle dans Réglages.
    ajouterCommerce(nouveauCommerce(nom, type, lienGoogle))
    onFermer()
    window.location.hash = '/reglages'
  }

  return (
    <form onSubmit={ajouter} className="carte space-y-4">
      <h2 className="text-lg font-bold">Nouveau commerce</h2>
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
      </div>
      <p className="text-sm text-gray-500">
        Récompense (10 tampons), lots de la roulette et réponses auto sont pré-remplis : vous pourrez les ajuster ensuite dans Réglages.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="bouton-secondaire" onClick={onFermer}>
          Annuler
        </button>
        <button type="submit" className="bouton" disabled={!nom.trim()}>
          Créer
        </button>
      </div>
    </form>
  )
}

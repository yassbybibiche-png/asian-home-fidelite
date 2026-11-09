import { useState, type FormEvent } from 'react'
import { useStore } from '../store'
import type { Commerce, TypeCommerce } from '../types'
import { TYPES_COMMERCE } from '../data/defaults'
import { EnTete, Interrupteur, LogoCommerce } from '../components/ui'

export default function Reglages() {
  const { commerce } = useStore()
  // `key` : le brouillon repart de zéro quand on change de commerce.
  return <FormulaireReglages key={commerce.id} commerce={commerce} />
}

function FormulaireReglages({ commerce }: { commerce: Commerce }) {
  const { majCommerce } = useStore()
  const [brouillon, setBrouillon] = useState<Commerce>(commerce)
  const [lotsTexte, setLotsTexte] = useState(commerce.lots.join('\n'))
  const [enregistre, setEnregistre] = useState(false)

  const lots = lotsTexte
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const nomValide = brouillon.nom.trim().length > 0
  const seuilValide = Number.isInteger(brouillon.seuilTampons) && brouillon.seuilTampons >= 2 && brouillon.seuilTampons <= 50
  const valide = nomValide && seuilValide && lots.length >= 2

  function maj<K extends keyof Commerce>(champ: K, valeur: Commerce[K]) {
    setBrouillon((b) => ({ ...b, [champ]: valeur }))
    setEnregistre(false)
  }

  function enregistrer(e: FormEvent) {
    e.preventDefault()
    if (!valide) return
    majCommerce({ ...brouillon, nom: brouillon.nom.trim(), lienGoogle: brouillon.lienGoogle.trim(), logo: brouillon.logo?.trim(), lots })
    setEnregistre(true)
  }

  return (
    <form onSubmit={enregistrer} className="space-y-6">
      <EnTete titre="Réglages" sousTitre="Tout se règle ici, en un seul formulaire." />

      <fieldset className="carte space-y-4">
        <legend className="sr-only">Le commerce</legend>
        <h2 className="text-lg font-bold">Le commerce</h2>
        <div>
          <label className="etiquette" htmlFor="nom">
            Nom du commerce
          </label>
          <input id="nom" className="champ" value={brouillon.nom} onChange={(e) => maj('nom', e.target.value)} required />
        </div>
        <div>
          <label className="etiquette" htmlFor="type">
            Type de commerce
          </label>
          <select id="type" className="champ" value={brouillon.type} onChange={(e) => maj('type', e.target.value as TypeCommerce)}>
            {TYPES_COMMERCE.map((t) => (
              <option key={t.valeur} value={t.valeur}>
                {t.libelle}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="etiquette" htmlFor="logo">
            Logo (optionnel)
          </label>
          <div className="flex items-center gap-3">
            <LogoCommerce commerce={brouillon} />
            <input
              id="logo"
              className="champ"
              placeholder="URL d’image (https://…) ou initiales"
              value={brouillon.logo ?? ''}
              onChange={(e) => maj('logo', e.target.value)}
            />
          </div>
          <p className="mt-1 text-sm text-gray-500">Laissez vide pour utiliser les initiales du nom.</p>
        </div>
        <div>
          <label className="etiquette" htmlFor="google">
            Lien vers la fiche Google (avis)
          </label>
          <input
            id="google"
            className="champ"
            type="url"
            inputMode="url"
            placeholder="https://g.page/r/…/review"
            value={brouillon.lienGoogle}
            onChange={(e) => maj('lienGoogle', e.target.value)}
          />
        </div>
      </fieldset>

      <fieldset className="carte space-y-4">
        <legend className="sr-only">Fidélité</legend>
        <h2 className="text-lg font-bold">Carte de fidélité</h2>
        <div>
          <label className="etiquette" htmlFor="recompense">
            Récompense
          </label>
          <input
            id="recompense"
            className="champ"
            placeholder="ex : 10e visite offerte, -10 % après 8 tampons…"
            value={brouillon.recompense}
            onChange={(e) => maj('recompense', e.target.value)}
          />
        </div>
        <div>
          <label className="etiquette" htmlFor="seuil">
            Nombre de tampons pour la récompense
          </label>
          <input
            id="seuil"
            className="champ"
            type="number"
            inputMode="numeric"
            min={2}
            max={50}
            value={Number.isNaN(brouillon.seuilTampons) ? '' : brouillon.seuilTampons}
            onChange={(e) => maj('seuilTampons', e.target.valueAsNumber)}
          />
          {!seuilValide && <p className="mt-1 text-sm text-red-600">Entre 2 et 50 tampons.</p>}
        </div>
      </fieldset>

      <fieldset className="carte space-y-2">
        <legend className="sr-only">Roulette</legend>
        <h2 className="text-lg font-bold">Lots de la roulette</h2>
        <label className="etiquette" htmlFor="lots">
          Un lot par ligne (chaque lot a la même chance de sortir)
        </label>
        <textarea id="lots" className="champ min-h-36" value={lotsTexte} onChange={(e) => (setLotsTexte(e.target.value), setEnregistre(false))} />
        <p className={`text-sm ${lots.length >= 2 ? 'text-gray-500' : 'text-red-600'}`}>
          {lots.length} lot{lots.length > 1 ? 's' : ''} {lots.length < 2 && '— il en faut au moins 2'}
        </p>
      </fieldset>

      <fieldset className="carte divide-y divide-gray-100">
        <legend className="sr-only">Réponses aux avis</legend>
        <h2 className="pb-2 text-lg font-bold">Réponses automatiques aux avis</h2>
        <Interrupteur
          libelle="Répondre automatiquement aux avis 5★"
          aide="La réponse type est publiée sans validation."
          actif={brouillon.reglesReponseAuto.auto5Etoiles}
          onChange={(v) => maj('reglesReponseAuto', { ...brouillon.reglesReponseAuto, auto5Etoiles: v })}
        />
        <Interrupteur
          libelle="Répondre automatiquement aux avis 4★"
          actif={brouillon.reglesReponseAuto.auto4Etoiles}
          onChange={(v) => maj('reglesReponseAuto', { ...brouillon.reglesReponseAuto, auto4Etoiles: v })}
        />
        <Interrupteur
          libelle="Préparer un brouillon pour les autres avis"
          aide="Vous relisez et validez avant publication."
          actif={brouillon.reglesReponseAuto.brouillonAutres}
          onChange={(v) => maj('reglesReponseAuto', { ...brouillon.reglesReponseAuto, brouillonAutres: v })}
        />
        <p className="pt-2 text-sm text-gray-500">Démo : aucune réponse n’est réellement publiée sur Google.</p>
      </fieldset>

      <div className="sticky bottom-20 z-10 md:bottom-4">
        <button type="submit" className="bouton w-full shadow-lg" disabled={!valide}>
          {enregistre ? '✓ Enregistré' : 'Enregistrer'}
        </button>
      </div>
    </form>
  )
}

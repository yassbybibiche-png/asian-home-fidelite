import { useState, type FormEvent } from 'react'
import { useStore } from '../store'
import type { Commerce, Lot, TypeCommerce } from '../types'
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
  const [lotsEdites, setLotsEdites] = useState<Lot[]>(commerce.lots)
  const [enregistre, setEnregistre] = useState(false)

  const lots = lotsEdites.map((l) => ({ ...l, libelle: l.libelle.trim() })).filter((l) => l.libelle)
  const probasValides = lots.every((l) => Number.isFinite(l.probabilite) && l.probabilite >= 0 && l.probabilite <= 100)
  const total = lots.reduce((s, l) => s + (Number.isFinite(l.probabilite) ? l.probabilite : 0), 0)
  const nomValide = brouillon.nom.trim().length > 0
  const seuilValide = Number.isInteger(brouillon.seuilTampons) && brouillon.seuilTampons >= 2 && brouillon.seuilTampons <= 50
  const valide = nomValide && seuilValide && lots.length >= 2 && probasValides && total > 0

  function maj<K extends keyof Commerce>(champ: K, valeur: Commerce[K]) {
    setBrouillon((b) => ({ ...b, [champ]: valeur }))
    setEnregistre(false)
  }

  function majLot(i: number, lot: Lot | null) {
    setLotsEdites((ls) => (lot ? ls.map((l, j) => (j === i ? lot : l)) : ls.filter((_, j) => j !== i)))
    setEnregistre(false)
  }

  function enregistrer(e: FormEvent) {
    e.preventDefault()
    if (!valide) return
    majCommerce({
      ...brouillon,
      nom: brouillon.nom.trim(),
      lienGoogle: brouillon.lienGoogle.trim(),
      logo: brouillon.logo?.trim(),
      coordonnees: brouillon.coordonnees?.trim() || undefined,
      lots,
    })
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
        <div>
          <label className="etiquette" htmlFor="coordonnees">
            Adresse, téléphone, horaires (optionnel)
          </label>
          <textarea
            id="coordonnees"
            className="champ min-h-24"
            placeholder="ex : 12 rue de la Paix, 75002 Paris · 01 23 45 67 89 · du mardi au samedi 9h-19h"
            value={brouillon.coordonnees ?? ''}
            onChange={(e) => maj('coordonnees', e.target.value)}
          />
          <p className="mt-1 text-sm text-gray-500">Affiché aux clients sur la page de jeu et sur leur carte.</p>
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
        <p className="text-sm text-gray-500">Texte libre + chance de sortir (en %). Un lot « Pas de chance » est possible.</p>
        <ul className="space-y-2">
          {lotsEdites.map((lot, i) => (
            // Téléphone : libellé sur toute la largeur, chance et suppression en dessous.
            <li key={i} className="flex flex-wrap items-center gap-2 border-b border-gray-100 pb-2 last:border-0 sm:flex-nowrap sm:border-0 sm:pb-0">
              <label className="sr-only" htmlFor={`lot-${i}`}>
                Lot {i + 1}
              </label>
              <input
                id={`lot-${i}`}
                className="champ w-full min-w-0 sm:w-auto sm:flex-1"
                placeholder="ex : Café offert"
                value={lot.libelle}
                onChange={(e) => majLot(i, { ...lot, libelle: e.target.value })}
              />
              <label className="sr-only" htmlFor={`proba-${i}`}>
                Chance du lot {i + 1} en %
              </label>
              <div className="relative min-w-0 flex-1 sm:w-24 sm:flex-none">
                <input
                  id={`proba-${i}`}
                  className="champ pr-8 text-right"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  value={Number.isNaN(lot.probabilite) ? '' : lot.probabilite}
                  onChange={(e) => majLot(i, { ...lot, probabilite: e.target.valueAsNumber })}
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-gray-500">%</span>
              </div>
              <button
                type="button"
                className="h-12 w-12 shrink-0 rounded-xl text-xl text-gray-500 ring-1 ring-gray-300 active:bg-gray-100"
                aria-label={`Supprimer le lot ${i + 1}`}
                onClick={() => majLot(i, null)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="bouton-secondaire w-full"
          onClick={() => (setLotsEdites((ls) => [...ls, { libelle: '', probabilite: 10 }]), setEnregistre(false))}
        >
          + Ajouter un lot
        </button>
        <p className={`text-sm ${lots.length >= 2 && probasValides && total > 0 ? 'text-gray-500' : 'text-red-600'}`}>
          {lots.length} lot{lots.length > 1 ? 's' : ''} · total {total} %
          {lots.length < 2
            ? ' — il en faut au moins 2'
            : !probasValides
              ? ' — chaque chance doit être entre 0 et 100 %'
              : total <= 0
                ? ' — au moins un lot doit avoir une chance > 0'
                : total !== 100
                  ? ' — le total ne fait pas 100 % : les chances seront recalculées au prorata'
                  : ''}
        </p>
      </fieldset>

      <fieldset className="carte divide-y divide-gray-100">
        <legend className="sr-only">Réponses aux avis</legend>
        <h2 className="pb-2 text-lg font-bold">Réponses automatiques aux avis</h2>
        <Interrupteur
          libelle="Répondre automatiquement aux 5★"
          aide="La réponse modèle est appliquée aussitôt, marquée « auto »."
          actif={brouillon.reglesReponseAuto.auto5Etoiles}
          onChange={(v) => maj('reglesReponseAuto', { ...brouillon.reglesReponseAuto, auto5Etoiles: v })}
        />
        <Interrupteur
          libelle="Répondre automatiquement aux avis 4★"
          actif={brouillon.reglesReponseAuto.auto4Etoiles}
          onChange={(v) => maj('reglesReponseAuto', { ...brouillon.reglesReponseAuto, auto4Etoiles: v })}
        />
        <Interrupteur
          libelle="Proposer un brouillon pour les autres"
          aide="Vous relisez et validez avant de marquer comme répondu."
          actif={brouillon.reglesReponseAuto.brouillonAutres}
          onChange={(v) => maj('reglesReponseAuto', { ...brouillon.reglesReponseAuto, brouillonAutres: v })}
        />
        <p className="pt-2 text-sm text-gray-500">
          Les règles s’appliquent aux nouveaux avis et, à l’enregistrement, aux avis encore sans réponse ni brouillon (un brouillon existant n’est jamais remplacé). Démo : aucune réponse n’est réellement
          publiée sur Google.
        </p>
      </fieldset>

      {/* Au-dessus de la barre d'onglets (64 px + zone de sécurité de l'iPhone). */}
      <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 md:bottom-4">
        <button type="submit" className="bouton w-full shadow-lg" disabled={!valide}>
          {enregistre ? '✓ Enregistré' : 'Enregistrer'}
        </button>
      </div>
    </form>
  )
}

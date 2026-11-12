import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { useAction, useStore } from '../store'
import type { Client, Commerce, ConfigProgramme, Lot, Palier, RecompensePoints, TypeCommerce } from '../types'
import { TYPES_COMMERCE } from '../data/defaults'
import { EnTete, Interrupteur, MessageErreur } from '../components/ui'
import { ChampLogo } from '../components/ChampLogo'
import { CarteFidelite, libelleTaux } from '../components/CarteFidelite'
import { EUROS_PAR_POINT_DEFAUT } from '../lib/points'
import { reglesVides, TYPES_MESSAGES } from '../lib/messages'
import { COULEUR_DEFAUT, FOND_DEFAUT, problemesApparence } from '../lib/apparence'
import { JOURS_SEMAINE, PALIERS_DEFAUT } from '../lib/programme'
import { compteurLibelle, MAX_CARACTERES_ROUE } from '../lib/roue'
import { CONSERVATION_DEFAUT_MOIS, CONSERVATION_MAX_MOIS, CONSERVATION_MIN_MOIS, libelleDuree } from '../lib/rgpd'
import { basculerAccroche, coutLotValide, formaterEuros, jourParis } from '../lib/mesure'
import { formaterParJour, JOURS_MOYENNE_TIRAGES, JOURS_PROJECTION, simulerCout, type SimulationCout } from '../lib/coutRoue'
import { libellesEnDouble, normaliserLots, nouvelIdLot } from '../lib/lots'
import { LIMITE_GAINS_MOIS_DEFAUT, LIMITE_GAINS_MOIS_MAX, modeAccesRoue } from '../lib/roulette'
import { CHOIX_TYPE_LOT, lotPourEnvoi, problemeLot } from '../lib/reglagesRoue'
import { ApercuRoue } from '../components/ApercuRoue'
import type { ModeAccesRoue, PlageOuverture, TypeLot } from '../types'
import { INSTANTS_JOUR_MAX, PLAGES_MAX, plagesOuverture, problemePlages } from '../lib/instants'
import { lotsDuCreneau, problemeCreneaux } from '../lib/creneaux'
import { CaseHeuresCreuses, CreneauxCreux } from '../components/HeuresCreuses'

/** Accès à la roue (R6) : les deux modes du serveur, dans l'ordre affiché. */
const MODES_ACCES: { valeur: ModeAccesRoue; libelle: string; aide: string }[] = [
  { valeur: 'libre', libelle: 'Libre — 1 tirage par jour', aide: 'Le client joue dès qu’il s’est identifié, une fois par jour.' },
  { valeur: 'visite', libelle: 'Après visite validée au comptoir', aide: 'Il faut en plus une visite validée par vous ou votre équipe le jour même.' },
]

/** Client fictif de l'aperçu (jamais enregistré). */
const APERCU_CLIENT: Client = { id: 'apercu', commerceId: '', prenom: 'Aperçu', tampons: 3, points: 42, visites: [], derniereVisite: null, creeLe: '2026-01-01T00:00:00.000Z' }

/** Champ nombre du formulaire programme (vide = valeur par défaut du serveur). */
function Nombre({ id, libelle, valeur, defaut, min, max, step = 1, aide, onChange }: { id: string; libelle: string; valeur?: number; defaut: number; min: number; max: number; step?: number; aide?: string; onChange(v: number): void }) {
  return (
    <div>
      <label className="etiquette" htmlFor={id}>
        {libelle}
      </label>
      <input
        id={id}
        className="champ"
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={valeur ?? defaut}
        onChange={(e) => {
          const v = e.target.valueAsNumber
          if (!Number.isNaN(v)) onChange(v)
        }}
      />
      {aide && <p className="mt-1 text-sm text-gray-600">{aide}</p>}
    </div>
  )
}

/** Sous chaque libellé de lot : place disponible sur la roue (alerte douce au-delà, le libellé sera abrégé). */
function CompteurLibelle({ id, libelle }: { id: string; libelle: string }) {
  const c = compteurLibelle(libelle)
  return (
    <p id={id} className={`mt-1 text-sm ${c.depasse ? 'font-medium text-red-700' : 'text-gray-600'}`} data-compteur-lot>
      {c.texte}
      {c.depasse && ' — raccourcissez pour un affichage complet sur la roue (il sera abrégé, mais reste complet dans la liste sous la roue).'}
    </p>
  )
}

/**
 * Simulateur de coût (D3, maquettes §5) : coût attendu par tirage, tirages/jour récents, projection mensuelle et pire
 * cas borné par les plafonds. Un lot physique sans coût → « coût partiel » + la liste des lots concernés.
 */
function SimulateurCout({ simulation: s }: { simulation: SimulationCout }) {
  const euros = (c: number) => formaterEuros(Math.round(c))
  return (
    <section className="carte space-y-2" aria-labelledby="simulateur-cout-titre" aria-live="polite">
      <h2 id="simulateur-cout-titre" className="titre-carte">Simulateur de coût</h2>
      <p>
        Coût attendu par tirage : <strong className="tabular-nums">{euros(s.centimes)}</strong>
        {s.partiel && <span className="font-medium text-amber-800"> (coût partiel)</span>}
      </p>
      <p>
        Tirages/jour ({JOURS_MOYENNE_TIRAGES} derniers jours) : <strong className="tabular-nums">{formaterParJour(s.tiragesParJour)}</strong> → projection mensuelle ≈{' '}
        <strong className="tabular-nums">{euros(s.projectionMois)}</strong>
      </p>
      <p className="text-sm text-gray-700">
        {s.pireCasJour !== null
          ? `Pire cas permis par les plafonds : ${euros(s.pireCasJour)} par jour (≈ ${euros(s.pireCasJour * JOURS_PROJECTION)} sur ${JOURS_PROJECTION} jours)${s.bornePlafonds ? ' — vos plafonds bornent la projection.' : '.'}`
          : s.sansPlafond.length
            ? `Pas de pire cas : sans plafond par jour, le coût n’est pas borné (${s.sansPlafond.join(', ')}).`
            : 'Pas de pire cas tant qu’un lot physique n’a pas de coût renseigné.'}
      </p>
      {s.partiel && (
        <p className="text-sm font-medium text-amber-800">
          Coût non renseigné pour : {s.lotsSansCout.join(', ')}. Le coût affiché est un minimum : rien n’est estimé à leur place.
        </p>
      )}
      <p className="text-sm text-gray-600">
        Coût par tirage = somme des chances (ramenées à 100 %) × coût unitaire des lots physiques ; points et « perdu » ne coûtent rien. Recalculé à chaque modification, avant l’enregistrement.
      </p>
    </section>
  )
}

type OngletReglages = 'commerce' | 'fidelite' | 'roulette' | 'messages' | 'carte' | 'donnees'

/** Découpe P1-C7 : 6 onglets, un seul formulaire — aucun réglage supprimé, 2 fieldsets déplacés pour des onglets thématiques contigus (« Points » après « Programme », « Réponses aux avis » après « Messages automatiques »). */
const ONGLETS_REGLAGES: { id: OngletReglages; libelle: string }[] = [
  { id: 'commerce', libelle: 'Commerce' },
  { id: 'fidelite', libelle: 'Fidélité' },
  { id: 'roulette', libelle: 'Roulette' },
  { id: 'messages', libelle: 'Messages' },
  { id: 'carte', libelle: 'Carte' },
  { id: 'donnees', libelle: 'Données' },
]

export default function Reglages() {
  const { commerce } = useStore()
  // `key` : le brouillon repart de zéro quand on change de commerce.
  return <FormulaireReglages key={commerce.id} commerce={commerce} />
}

function FormulaireReglages({ commerce }: { commerce: Commerce }) {
  const { majCommerce, estDemo, etat } = useStore()
  const { executer, enCours, erreur } = useAction()
  const [brouillon, setBrouillon] = useState<Commerce>(commerce)
  // R1 : lots normalisés dès l'ouverture (id + type résolus) → toujours écrits, et un lot renommé garde son id.
  const [lotsEdites, setLotsEdites] = useState<Lot[]>(() => normaliserLots(commerce.lots))
  const [enregistre, setEnregistre] = useState(false)
  const [onglet, setOnglet] = useState<OngletReglages>('commerce')

  const lots = lotsEdites.map((l) => ({ ...l, libelle: l.libelle.trim() })).filter((l) => l.libelle)
  const probasValides = lots.every((l) => Number.isFinite(l.probabilite) && l.probabilite >= 0 && l.probabilite <= 100)
  // Coût unitaire des lots (P2-Q3) : facultatif, 0 à 1 000 € ; sert au tableau de bord, jamais montré aux clients.
  const coutsValides = lots.every((l) => coutLotValide(l.coutCentimes))
  const total = lots.reduce((s, l) => s + (Number.isFinite(l.probabilite) ? l.probabilite : 0), 0)
  // R1 : libellés uniques (casse et espaces ignorés), points entiers bornés pour une consolation — comme le serveur.
  const doublons = libellesEnDouble(lots)
  // R6 : montant d'un lot « points », plafond par jour d'un lot physique (`problemeLot`, mêmes bornes que le serveur).
  const champsTypeValides = lots.every((l) => !problemeLot(l))
  const lotEnErreur = lots.find((l) => problemeLot(l))
  // Règles du jeu (R2/R6) : limite de lots gagnés par client sur 30 jours, 0 = illimité, absente = 4.
  const limiteGains = brouillon.limiteGainsMois ?? LIMITE_GAINS_MOIS_DEFAUT
  const limiteValide = Number.isInteger(limiteGains) && limiteGains >= 0 && limiteGains <= LIMITE_GAINS_MOIS_MAX
  // Plages d'ouverture (D1) : absentes = défaut (les deux services) ; mêmes règles que le serveur (`problemePlages`).
  const plages = plagesOuverture(brouillon)
  const erreurPlages = problemePlages(plages)
  // Heures creuses (D2) : créneaux validés comme le serveur ; hors créneau, la roue doit garder au moins un lot jouable.
  const creneaux = brouillon.creneauxCreux ?? []
  const erreurCreneaux = problemeCreneaux(creneaux)
  const horsCreux = lotsDuCreneau(lots, false).some((l) => Number.isFinite(l.probabilite) && l.probabilite > 0)
  const nomValide = brouillon.nom.trim().length > 0
  const seuilValide = Number.isInteger(brouillon.seuilTampons) && brouillon.seuilTampons >= 2 && brouillon.seuilTampons <= 50
  const [catalogue, setCatalogue] = useState<RecompensePoints[]>(commerce.catalogue ?? [])
  const taux = brouillon.eurosParPoint ?? EUROS_PAR_POINT_DEFAUT
  const tauxValide = Number.isFinite(taux) && taux >= 0.1 && taux <= 1000
  const catalogueValide = catalogue.every((r) => r.nom.trim() && Number.isInteger(r.cout) && r.cout >= 1)
  // Programme de fidélité (benchmark 09/11/2026) : chaque bloc est optionnel, les défauts s'appliquent sinon.
  const [programme, setProgramme] = useState<ConfigProgramme>(commerce.programme ?? {})
  function majBloc(bloc: keyof ConfigProgramme, patch: Record<string, unknown>) {
    setProgramme((p) => ({ ...p, [bloc]: { ...((p[bloc] as Record<string, unknown> | undefined) ?? {}), ...patch } }))
    setEnregistre(false)
  }
  const apparence = brouillon.apparence ?? {}
  const problemes = problemesApparence(apparence)
  // Durée de conservation RGPD (P1-B6), en mois ; absente = 3 ans.
  const conservation = brouillon.conservationMois ?? CONSERVATION_DEFAUT_MOIS
  const conservationValide = Number.isInteger(conservation) && conservation >= CONSERVATION_MIN_MOIS && conservation <= CONSERVATION_MAX_MOIS
  // Liens de commande (P1-C5) : vides ou en https (le serveur refuse le reste).
  const liensCommandeValides = [brouillon.lienDeliveroo, brouillon.lienUberEats].every((l) => !l?.trim() || /^https:\/\/\S+$/i.test(l.trim()))
  const lotsValides = lots.length >= 2 && probasValides && coutsValides && champsTypeValides && !doublons.length && total > 0 && horsCreux
  const valide = nomValide && seuilValide && lotsValides && limiteValide && tauxValide && catalogueValide && !problemes.length && conservationValide && liensCommandeValides && !erreurPlages && !erreurCreneaux

  function maj<K extends keyof Commerce>(champ: K, valeur: Commerce[K]) {
    setBrouillon((b) => ({ ...b, [champ]: valeur }))
    setEnregistre(false)
  }

  /** Navigation clavier des onglets (P1-C7) : flèches, Début/Fin — le focus suit l'onglet actif (roving tabindex). */
  function naviguerOnglets(e: KeyboardEvent<HTMLDivElement>) {
    const i = ONGLETS_REGLAGES.findIndex((o) => o.id === onglet)
    let suivant: number | null = null
    if (e.key === 'ArrowRight') suivant = (i + 1) % ONGLETS_REGLAGES.length
    else if (e.key === 'ArrowLeft') suivant = (i - 1 + ONGLETS_REGLAGES.length) % ONGLETS_REGLAGES.length
    else if (e.key === 'Home') suivant = 0
    else if (e.key === 'End') suivant = ONGLETS_REGLAGES.length - 1
    if (suivant === null) return
    e.preventDefault()
    const id = ONGLETS_REGLAGES[suivant].id
    setOnglet(id)
    setTimeout(() => document.getElementById(`onglet-${id}`)?.focus(), 0)
  }

  /** Validation native (required, type=url, min/max) : un champ invalide dans un onglet masqué bloquerait
      l'enregistrement sans rien montrer — on bascule sur son onglet puis on le focalise (P1-C7). */
  function revelerChampInvalide(e: FormEvent) {
    const champ = e.target as HTMLElement
    const panneau = champ.closest('[role="tabpanel"]')
    if (!panneau) return
    const id = panneau.id.replace('reglages-', '') as OngletReglages
    if (id === onglet) return
    e.preventDefault()
    setOnglet(id)
    setTimeout(() => champ.focus(), 0)
  }

  function majLot(i: number, lot: Lot | null) {
    setLotsEdites((ls) => (lot ? ls.map((l, j) => (j === i ? lot : l)) : ls.filter((_, j) => j !== i)))
    setEnregistre(false)
  }

  function majPlage(i: number, plage: PlageOuverture | null) {
    maj('plagesOuverture', plage ? plages.map((p, j) => (j === i ? plage : p)) : plages.filter((_, j) => j !== i))
  }

  async function enregistrer(e: FormEvent) {
    e.preventDefault()
    if (!valide || enCours) return
    const r = await executer(() =>
      majCommerce({
      ...brouillon,
      nom: brouillon.nom.trim(),
      lienGoogle: brouillon.lienGoogle.trim(),
      coordonnees: brouillon.coordonnees?.trim() || undefined,
      lienDeliveroo: brouillon.lienDeliveroo?.trim() || undefined,
      lienUberEats: brouillon.lienUberEats?.trim() || undefined,
      lots: lots.map(lotPourEnvoi),
      eurosParPoint: taux,
      catalogue: catalogue.map((r) => ({ ...r, nom: r.nom.trim(), description: r.description?.trim() || undefined })),
      messagesAuto: brouillon.messagesAuto ?? reglesVides(),
      apparence: Object.fromEntries(Object.entries(apparence).filter(([, v]) => v)),
      programme,
      }),
    )
    // « ✓ Enregistré » seulement si le serveur (ou la démo locale) a bien pris les réglages.
    setEnregistre(r.ok)
  }

  return (
    <form onSubmit={enregistrer} onInvalid={revelerChampInvalide} className="space-y-6">
      <EnTete titre="Réglages" sousTitre="Tout se règle ici, en un seul formulaire, par section." />

      <div role="tablist" aria-label="Sections des réglages" className="flex flex-wrap gap-2" onKeyDown={naviguerOnglets}>
        {ONGLETS_REGLAGES.map((o) => (
          <button
            key={o.id}
            type="button"
            role="tab"
            id={`onglet-${o.id}`}
            aria-selected={onglet === o.id}
            aria-controls={`reglages-${o.id}`}
            tabIndex={onglet === o.id ? 0 : -1}
            onClick={() => setOnglet(o.id)}
            className={onglet === o.id ? 'puce min-h-11 bg-magenta-700 font-semibold text-white' : 'puce min-h-11'}
          >
            {o.libelle}
          </button>
        ))}
      </div>

      <div id="reglages-commerce" role="tabpanel" aria-labelledby="onglet-commerce" hidden={onglet !== 'commerce'} className="space-y-6">
      <fieldset className="carte space-y-4">
        <legend className="sr-only">Le commerce</legend>
        <h2 className="titre-carte">Le commerce</h2>
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
        {/* Logo (P1-B5) : envoyé à part, tout de suite ; le brouillon suit sans être marqué « à enregistrer ». */}
        <ChampLogo commerce={brouillon} onChange={(logo) => setBrouillon((b) => ({ ...b, logo }))} />
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
          <p className="mt-1 text-sm text-gray-600">Affiché aux clients sur la page de jeu et sur leur carte.</p>
        </div>
        {/* Liens de commande (P1-C5) : bouton « Commander » du menu public, affiché seulement si le lien est renseigné. */}
        <div>
          <label className="etiquette" htmlFor="deliveroo">
            Lien Deliveroo (optionnel)
          </label>
          <input
            id="deliveroo"
            className="champ"
            type="url"
            inputMode="url"
            placeholder="https://deliveroo.fr/menu/…"
            value={brouillon.lienDeliveroo ?? ''}
            onChange={(e) => maj('lienDeliveroo', e.target.value)}
          />
        </div>
        <div>
          <label className="etiquette" htmlFor="ubereats">
            Lien Uber Eats (optionnel)
          </label>
          <input
            id="ubereats"
            className="champ"
            type="url"
            inputMode="url"
            placeholder="https://www.ubereats.com/fr/store/…"
            value={brouillon.lienUberEats ?? ''}
            onChange={(e) => maj('lienUberEats', e.target.value)}
          />
          {liensCommandeValides ? (
            <p className="mt-1 text-sm text-gray-600">Vide = pas de bouton « Commander » sur le menu client.</p>
          ) : (
            <p className="mt-1 text-sm font-semibold text-red-700">Les liens de commande doivent commencer par https://</p>
          )}
        </div>
      </fieldset>
      </div>

      <div id="reglages-fidelite" role="tabpanel" aria-labelledby="onglet-fidelite" hidden={onglet !== 'fidelite'} className="space-y-6">
      <fieldset className="carte space-y-4">
        <legend className="sr-only">Fidélité</legend>
        <h2 className="titre-carte">Carte de fidélité</h2>
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
          {!seuilValide && <p className="mt-1 text-sm text-red-700">Entre 2 et 50 tampons.</p>}
        </div>
      </fieldset>
      <fieldset className="carte space-y-4">
        <legend className="sr-only">Programme de fidélité</legend>
        <h2 className="titre-carte">Programme de fidélité</h2>
        <p className="text-sm text-gray-600">Chaque nouveauté s’active ou se règle ici. Rien n’est coché = les valeurs par défaut s’appliquent (paliers 3 / 6 / 10 visites, parrainage 50 points chacun, 50 points de bienvenue, défi 3 visites en 14 jours, Habitué 10 visites ×1,5, VIP 25 visites ×2).</p>

        <div className="space-y-3 border-t border-gray-100 pt-3">
          <Interrupteur libelle="Paliers intermédiaires" aide="Petites récompenses avant la récompense principale (par défaut : 3 visites, 6 visites)." actif={programme.paliers?.actif ?? true} onChange={(v) => majBloc('paliers', { actif: v })} />
          {(programme.paliers?.liste ?? PALIERS_DEFAUT).map((palier, i) => (
            <div key={i} className="flex gap-2">
              <div className="w-24 shrink-0">
                <label className="etiquette" htmlFor={`palier-seuil-${i}`}>
                  Visites
                </label>
                <input
                  id={`palier-seuil-${i}`}
                  className="champ text-right"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={49}
                  value={palier.seuil}
                  onChange={(e) => {
                    const liste = [...(programme.paliers?.liste ?? PALIERS_DEFAUT)]
                    const v = e.target.valueAsNumber
                    if (!Number.isNaN(v)) liste[i] = { ...liste[i], seuil: v }
                    majBloc('paliers', { liste })
                  }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <label className="etiquette" htmlFor={`palier-libelle-${i}`}>
                  Récompense du palier
                </label>
                <input
                  id={`palier-libelle-${i}`}
                  className="champ"
                  maxLength={80}
                  value={palier.libelle}
                  onChange={(e) => {
                    const liste = [...(programme.paliers?.liste ?? PALIERS_DEFAUT)]
                    liste[i] = { ...liste[i], libelle: e.target.value }
                    majBloc('paliers', { liste })
                  }}
                />
              </div>
              <button
                type="button"
                className="mt-6 h-12 w-12 shrink-0 rounded-xl bg-white text-xl text-gray-600 ring-1 ring-gray-300 hover:text-red-700"
                aria-label={`Supprimer le palier ${i + 1}`}
                onClick={() => majBloc('paliers', { liste: (programme.paliers?.liste ?? PALIERS_DEFAUT).filter((_, j) => j !== i) })}
              >
                ×
              </button>
            </div>
          ))}
          {(programme.paliers?.liste ?? PALIERS_DEFAUT).length < 5 && (
            <button
              type="button"
              className="bouton-secondaire w-full"
              onClick={() => majBloc('paliers', { liste: [...(programme.paliers?.liste ?? PALIERS_DEFAUT), { seuil: 8, libelle: 'Dessert offert' } as Palier] })}
            >
              + Ajouter un palier
            </button>
          )}
          <p className="text-sm text-gray-600">Un palier égal au seuil de la carte principale n’est pas ajouté : la récompense principale le couvre déjà.</p>
        </div>

        <div className="space-y-3 border-t border-gray-100 pt-3">
          <Interrupteur libelle="Parrainage (les deux gagnent)" aide="Code unique par client, partageable. Les points sont versés après la 1re visite du filleul — jamais à l’inscription." actif={programme.parrainage?.actif ?? true} onChange={(v) => majBloc('parrainage', { actif: v })} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Nombre id="pr-parrain" libelle="Points du parrain" valeur={programme.parrainage?.pointsParrain} defaut={50} min={0} max={500} onChange={(v) => majBloc('parrainage', { pointsParrain: v })} />
            <Nombre id="pr-filleul" libelle="Points du filleul" valeur={programme.parrainage?.pointsFilleul} defaut={50} min={0} max={500} onChange={(v) => majBloc('parrainage', { pointsFilleul: v })} />
            <Nombre id="pr-plafond" libelle="Plafond / an" valeur={programme.parrainage?.plafondAn} defaut={12} min={1} max={100} aide="Anti-abus." onChange={(v) => majBloc('parrainage', { plafondAn: v })} />
          </div>
        </div>

        <div className="space-y-3 border-t border-gray-100 pt-3">
          <Interrupteur libelle="Points de bienvenue" aide="Crédités à l’inscription, pour amorcer le compteur." actif={programme.bienvenue?.actif ?? true} onChange={(v) => majBloc('bienvenue', { actif: v })} />
          <Nombre id="bw-points" libelle="Points offerts à l’inscription" valeur={programme.bienvenue?.points} defaut={50} min={0} max={500} onChange={(v) => majBloc('bienvenue', { points: v })} />
        </div>

        <div className="space-y-3 border-t border-gray-100 pt-3">
          <Interrupteur libelle="Défi court (un seul à la fois)" aide="Objectif visible avec date limite : la progression s’affiche sur la carte du client." actif={programme.defi?.actif ?? true} onChange={(v) => majBloc('defi', { actif: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Nombre id="defi-visites" libelle="Visites à faire" valeur={programme.defi?.visites} defaut={3} min={2} max={10} onChange={(v) => majBloc('defi', { visites: v })} />
            <Nombre id="defi-jours" libelle="En combien de jours" valeur={programme.defi?.jours} defaut={14} min={3} max={60} onChange={(v) => majBloc('defi', { jours: v })} />
          </div>
          <div>
            <label className="etiquette" htmlFor="defi-recompense">
              Récompense du défi
            </label>
            <input id="defi-recompense" className="champ" maxLength={80} value={programme.defi?.recompense ?? 'Plat offert'} onChange={(e) => majBloc('defi', { recompense: e.target.value })} />
          </div>
        </div>

        <div className="space-y-3 border-t border-gray-100 pt-3">
          <Interrupteur libelle="Niveaux (2 maximum)" aide="Habitué puis VIP. Le VIP doit rester rare : seuil haut, affiché comme tel sur la carte." actif={programme.niveaux?.actif ?? true} onChange={(v) => majBloc('niveaux', { actif: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Nombre id="niv-hab-seuil" libelle="Habitué : visites" valeur={programme.niveaux?.habitueSeuil} defaut={10} min={2} max={100} onChange={(v) => majBloc('niveaux', { habitueSeuil: v })} />
            <Nombre id="niv-hab-mult" libelle="Habitué : points ×" valeur={programme.niveaux?.habitueMultiplicateur} defaut={1.5} min={1} max={3} step={0.5} onChange={(v) => majBloc('niveaux', { habitueMultiplicateur: v })} />
            <Nombre id="niv-vip-seuil" libelle="VIP : visites" valeur={programme.niveaux?.vipSeuil} defaut={25} min={3} max={200} onChange={(v) => majBloc('niveaux', { vipSeuil: v })} />
            <Nombre id="niv-vip-mult" libelle="VIP : points ×" valeur={programme.niveaux?.vipMultiplicateur} defaut={2} min={1} max={3} step={0.5} onChange={(v) => majBloc('niveaux', { vipMultiplicateur: v })} />
          </div>
        </div>

        <div className="space-y-3 border-t border-gray-100 pt-3">
          <Interrupteur libelle="Relance win-back en 3 temps" aide="Rappel doux à 45 j (sans remise), offre à 60 j (produit offert), dernière chance à 90 j puis arrêt. La séquence s’arrête dès le retour du client." actif={programme.winback?.actif ?? true} onChange={(v) => majBloc('winback', { actif: v })} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Nombre id="wb-rappel" libelle="Rappel doux (jours)" valeur={programme.winback?.rappelJours} defaut={45} min={7} max={180} onChange={(v) => majBloc('winback', { rappelJours: v })} />
            <Nombre id="wb-offre" libelle="Offre (jours)" valeur={programme.winback?.offreJours} defaut={60} min={8} max={240} onChange={(v) => majBloc('winback', { offreJours: v })} />
            <Nombre id="wb-derniere" libelle="Dernière chance (jours)" valeur={programme.winback?.derniereJours} defaut={90} min={9} max={300} onChange={(v) => majBloc('winback', { derniereJours: v })} />
          </div>
          <div>
            <label className="etiquette" htmlFor="wb-offre-texte">
              Offre win-back (produit offert, pas un %)
            </label>
            <input id="wb-offre-texte" className="champ" maxLength={80} value={programme.winback?.offre ?? 'Produit offert'} onChange={(e) => majBloc('winback', { offre: e.target.value })} />
          </div>
        </div>

        <div className="space-y-3 border-t border-gray-100 pt-3">
          <Interrupteur libelle="Anniversaire amélioré" aide="Envoi à J-7 + jour J, récompense valable 7 à 30 jours (14 par défaut, 30 pour les VIP, dessert offert — plat signature pour les VIP). Date collectée après la 2e visite, jamais à l’inscription." actif={programme.anniversaire?.actif ?? true} onChange={(v) => majBloc('anniversaire', { actif: v })} />
          <Nombre id="ann-validite" libelle="Validité de la récompense (jours)" valeur={programme.anniversaire?.validiteJours} defaut={14} min={7} max={30} onChange={(v) => majBloc('anniversaire', { validiteJours: v })} />
          <Interrupteur libelle="Demi-anniversaire (boisson offerte, 6 mois après)" actif={programme.anniversaire?.demiAnniversaire ?? true} onChange={(v) => majBloc('anniversaire', { demiAnniversaire: v })} />
          <Interrupteur libelle="Anniversaire d’adhésion (1 an après l’inscription)" actif={programme.anniversaire?.adhesion ?? true} onChange={(v) => majBloc('anniversaire', { adhesion: v })} />
        </div>

        <div className="space-y-3 border-t border-gray-100 pt-3">
          <Interrupteur libelle="Offre hebdomadaire récurrente" aide="1 offre membres, 1 jour fixe par semaine : affichée sur la carte client." actif={programme.offreHebdo?.actif ?? true} onChange={(v) => majBloc('offreHebdo', { actif: v })} />
          <div>
            <label className="etiquette" htmlFor="oh-jour">
              Jour de la semaine
            </label>
            <select id="oh-jour" className="champ" value={programme.offreHebdo?.jour ?? 2} onChange={(e) => majBloc('offreHebdo', { jour: Number(e.target.value) })}>
              {JOURS_SEMAINE.map((j, i) => (
                <option key={j} value={i}>
                  {j}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="etiquette" htmlFor="oh-libelle">
                Offre
              </label>
              <input id="oh-libelle" className="champ" maxLength={80} value={programme.offreHebdo?.libelle ?? 'Boisson offerte'} onChange={(e) => majBloc('offreHebdo', { libelle: e.target.value })} />
            </div>
            <div>
              <label className="etiquette" htmlFor="oh-condition">
                Condition
              </label>
              <input id="oh-condition" className="champ" maxLength={80} value={programme.offreHebdo?.condition ?? 'dès 15 €'} onChange={(e) => majBloc('offreHebdo', { condition: e.target.value })} />
            </div>
          </div>
        </div>

        <div className="space-y-3 border-t border-gray-100 pt-3">
          <Interrupteur libelle="Plat en réserve" aide="Après une commande au-dessus du seuil, le client gagne un plat offert à utiliser sous 30 jours — 1 fois par trimestre maximum. Opération limitée : désactivez-la quand vous voulez." actif={programme.reserve?.actif ?? true} onChange={(v) => majBloc('reserve', { actif: v })} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Nombre id="res-montant" libelle="Commande minimum (€)" valeur={programme.reserve?.montantMinCentimes != null ? programme.reserve.montantMinCentimes / 100 : undefined} defaut={25} min={5} max={1000} step={5} onChange={(v) => majBloc('reserve', { montantMinCentimes: Math.round(v * 100) })} />
            <Nombre id="res-validite" libelle="Validité (jours)" valeur={programme.reserve?.validiteJours} defaut={30} min={7} max={90} onChange={(v) => majBloc('reserve', { validiteJours: v })} />
            <Nombre id="res-trimestre" libelle="Max / trimestre" valeur={programme.reserve?.parTrimestre} defaut={1} min={1} max={4} onChange={(v) => majBloc('reserve', { parTrimestre: v })} />
          </div>
        </div>

        <div className="space-y-3 border-t border-gray-100 pt-3">
          <Interrupteur libelle="Rattrapage des visites oubliées" aide="Le client signale « j’ai oublié de scanner » depuis sa carte ; vous validez ou refusez depuis la caisse ou la fiche client." actif={programme.rattrapage?.actif ?? true} onChange={(v) => majBloc('rattrapage', { actif: v })} />
          <Nombre id="rt-delai" libelle="Délai de signalement (jours)" valeur={programme.rattrapage?.delaiJours} defaut={30} min={7} max={90} onChange={(v) => majBloc('rattrapage', { delaiJours: v })} />
        </div>
      </fieldset>
      <fieldset className="carte space-y-3">
        <legend className="sr-only">Points</legend>
        <h2 className="titre-carte">Points et récompenses à points</h2>
        <div>
          <label className="etiquette" htmlFor="taux">
            Euros dépensés pour 1 point
          </label>
          <input
            id="taux"
            className="champ"
            type="number"
            inputMode="decimal"
            min={0.1}
            step={0.1}
            value={Number.isNaN(taux) ? '' : taux}
            onChange={(e) => maj('eurosParPoint', e.target.valueAsNumber)}
          />
          <p className={`mt-1 text-sm ${tauxValide ? 'text-gray-600' : 'text-red-700'}`}>
            {tauxValide ? `${libelleTaux({ eurosParPoint: taux })} (saisi en caisse avec le montant).` : 'Entre 0,10 et 1 000 €.'}
          </p>
        </div>
        <ul className="space-y-3">
          {catalogue.map((r, i) => (
            <li key={r.id} className="space-y-2 rounded-xl bg-gray-50 p-3 ring-1 ring-gray-900/5">
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <label className="etiquette" htmlFor={`rp-nom-${i}`}>
                    Récompense
                  </label>
                  <input
                    id={`rp-nom-${i}`}
                    className="champ"
                    maxLength={80}
                    placeholder="ex : 4 nems offerts"
                    value={r.nom}
                    onChange={(e) => (setCatalogue((c) => c.map((x, j) => (j === i ? { ...x, nom: e.target.value } : x))), setEnregistre(false))}
                  />
                </div>
                <div className="w-28 shrink-0">
                  <label className="etiquette" htmlFor={`rp-cout-${i}`}>
                    Coût (pts)
                  </label>
                  <input
                    id={`rp-cout-${i}`}
                    className="champ text-right"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={Number.isNaN(r.cout) ? '' : r.cout}
                    onChange={(e) => (setCatalogue((c) => c.map((x, j) => (j === i ? { ...x, cout: e.target.valueAsNumber } : x))), setEnregistre(false))}
                  />
                </div>
              </div>
              <label className="etiquette" htmlFor={`rp-desc-${i}`}>
                Description (optionnelle)
              </label>
              <input
                id={`rp-desc-${i}`}
                className="champ"
                maxLength={200}
                value={r.description ?? ''}
                onChange={(e) => (setCatalogue((c) => c.map((x, j) => (j === i ? { ...x, description: e.target.value } : x))), setEnregistre(false))}
              />
              <button type="button" className="min-h-11 text-sm font-semibold text-red-800 underline" onClick={() => (setCatalogue((c) => c.filter((_, j) => j !== i)), setEnregistre(false))}>
                Retirer cette récompense
              </button>
            </li>
          ))}
        </ul>
        {!catalogueValide && <p className="text-sm text-red-700">Chaque récompense doit avoir un nom et un coût entier ≥ 1 point.</p>}
        <button
          type="button"
          className="bouton-secondaire w-full"
          onClick={() => (setCatalogue((c) => [...c, { id: `rp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, nom: '', cout: 50 }]), setEnregistre(false))}
        >
          + Ajouter une récompense à points
        </button>
      </fieldset>
      </div>

      <div id="reglages-roulette" role="tabpanel" aria-labelledby="onglet-roulette" hidden={onglet !== 'roulette'} className="space-y-6">
      <fieldset className="carte space-y-2">
        <legend className="sr-only">Roulette</legend>
        <h2 className="titre-carte">Lots de la roulette</h2>
        <p className="text-sm text-gray-600">
          Texte libre + chance de sortir (en %) + coût pour vous (€, facultatif : matière et emballage d’un lot, sert au coût des lots du tableau de bord, jamais montré aux clients). Type de chaque lot : « Lot physique » (à retirer au comptoir, plafond par jour possible), « Points » (consolation créditée sur la carte : indiquez le nombre de points) ou « Perdu ». Chaque libellé doit être différent. Visez {MAX_CARACTERES_ROUE} caractères au plus : le libellé tient alors en entier sur la roue ; la liste des lots sous la roue l’affiche toujours en entier.
        </p>
        <ul className="space-y-3">
          {lotsEdites.map((lot, i) => {
            const type: TypeLot = lot.type ?? 'lot'
            // Erreur affichée sous le lot (R6) : seulement pour un lot gardé à l'envoi (libellé non vide).
            // Ligne exclue de l'envoi : ses champs chiffrés sont désactivés, leur validation native ne bloque plus l'enregistrement.
            const exclu = !lot.libelle.trim()
            const erreurLot = exclu ? null : problemeLot(lot) ?? (lots.filter((l) => libellesEnDouble([l, lot]).length).length > 1 ? 'libellé déjà utilisé par un autre lot' : null)
            return (
            // Téléphone : libellé sur toute la largeur, chance et suppression en dessous ; type, points et plafond ensuite.
            <li key={i} className="space-y-2 border-b border-gray-100 pb-3 last:border-0">
              <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:items-start">
              <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                <label className="sr-only" htmlFor={`lot-${i}`}>
                  Lot {i + 1}
                </label>
                <input
                  id={`lot-${i}`}
                  className="champ w-full min-w-0"
                  placeholder="ex : Café offert"
                  value={lot.libelle}
                  aria-describedby={`lot-${i}-compteur`}
                  onChange={(e) => majLot(i, { ...lot, libelle: e.target.value })}
                />
                <CompteurLibelle id={`lot-${i}-compteur`} libelle={lot.libelle} />
              </div>
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
                  disabled={exclu}
                  value={Number.isNaN(lot.probabilite) ? '' : lot.probabilite}
                  onChange={(e) => majLot(i, { ...lot, probabilite: e.target.valueAsNumber })}
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-gray-600">%</span>
              </div>
              <label className="sr-only" htmlFor={`cout-${i}`}>
                Coût du lot {i + 1} en euros
              </label>
              <div className="relative min-w-0 flex-1 sm:w-28 sm:flex-none">
                <input
                  id={`cout-${i}`}
                  className="champ pr-8 text-right"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={1000}
                  step={0.01}
                  placeholder="coût"
                  disabled={exclu}
                  value={lot.coutCentimes === undefined ? '' : lot.coutCentimes / 100}
                  onChange={(e) => majLot(i, { ...lot, coutCentimes: e.target.value === '' ? undefined : Math.round(e.target.valueAsNumber * 100) })}
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-gray-600">€</span>
              </div>
              <button
                type="button"
                className="h-12 w-12 shrink-0 rounded-xl bg-white text-xl text-gray-600 ring-1 ring-gray-300 transition hover:text-red-700 hover:ring-red-200 active:bg-gray-100"
                aria-label={`Supprimer le lot ${i + 1}`}
                onClick={() => majLot(i, null)}
              >
                ×
              </button>
              </div>
              {/* Largeurs minimales (min-w-36 / min-w-32) : avec les cases « Heures creuses » et « Instant gagnant » sur la même
                  ligne, un champ en `min-w-0` était écrasé sous son propre padding et débordait de l'écran du téléphone
                  (page plus large que l'écran, vue dézoomée, clics décalés) ; il passe maintenant à la ligne. */}
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={`type-${i}`}>
                  Type du lot {i + 1}
                </label>
                <select
                  id={`type-${i}`}
                  className="champ min-w-36 flex-1 sm:w-44 sm:flex-none"
                  value={type}
                  onChange={(e) => majLot(i, { ...lot, type: e.target.value as TypeLot })}
                >
                  {CHOIX_TYPE_LOT.map((c) => (
                    <option key={c.valeur} value={c.valeur}>
                      {c.libelle}
                    </option>
                  ))}
                </select>
                {/* Heures creuses (D2) : tout type de lot ; décochée = rien d'écrit (toujours tirable). */}
                <CaseHeuresCreuses coche={!!lot.heuresCreuses} desactive={exclu} onChange={(v) => majLot(i, { ...lot, heuresCreuses: v || undefined })} />
                {type === 'points' && (
                  <>
                    <label className="sr-only" htmlFor={`points-${i}`}>
                      Points offerts par le lot {i + 1}
                    </label>
                    <div className="relative min-w-32 flex-1 sm:w-36 sm:flex-none">
                      <input
                        id={`points-${i}`}
                        className="champ pr-12 text-right"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={10000}
                        placeholder="nombre"
                        disabled={exclu}
                        aria-invalid={!!erreurLot && erreurLot.includes('points')}
                        value={lot.points === undefined || Number.isNaN(lot.points) ? '' : lot.points}
                        onChange={(e) => majLot(i, { ...lot, points: e.target.value === '' ? undefined : e.target.valueAsNumber })}
                      />
                      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-gray-600">pts</span>
                    </div>
                  </>
                )}
                {type === 'lot' && (
                  <>
                    <label className="sr-only" htmlFor={`plafond-${i}`}>
                      Plafond par jour du lot {i + 1}
                    </label>
                    <div className="relative min-w-32 flex-1 sm:w-44 sm:flex-none">
                      <input
                        id={`plafond-${i}`}
                        className="champ pr-16 text-right"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={10000}
                        placeholder="illimité"
                        disabled={exclu}
                        aria-invalid={!!erreurLot && erreurLot.includes('plafond')}
                        value={lot.plafondJour === undefined || Number.isNaN(lot.plafondJour) ? '' : lot.plafondJour}
                        onChange={(e) => majLot(i, { ...lot, plafondJour: e.target.value === '' ? undefined : e.target.valueAsNumber })}
                      />
                      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-gray-600">/ jour</span>
                    </div>
                    {/* Instants gagnants (D1) : case cochée = au moins 1 instant par jour, tiré dans les plages d'ouverture. */}
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                      <span className="zone-case">
                        <input
                          type="checkbox"
                          className="case-a-cocher"
                          disabled={exclu}
                          checked={lot.instantsParJour !== undefined}
                          onChange={(e) => majLot(i, { ...lot, instantsParJour: e.target.checked ? 1 : undefined })}
                        />
                      </span>
                      Instant gagnant
                    </label>
                    {lot.instantsParJour !== undefined && (
                      <>
                        <label className="sr-only" htmlFor={`instants-${i}`}>
                          Instants gagnants par jour du lot {i + 1}
                        </label>
                        <div className="relative min-w-32 flex-1 sm:w-40 sm:flex-none">
                          <input
                            id={`instants-${i}`}
                            className="champ pr-20 text-right"
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={INSTANTS_JOUR_MAX}
                            disabled={exclu}
                            aria-invalid={!!erreurLot && erreurLot.includes('instants')}
                            value={Number.isNaN(lot.instantsParJour) ? '' : lot.instantsParJour}
                            onChange={(e) => majLot(i, { ...lot, instantsParJour: e.target.value === '' ? 0 : e.target.valueAsNumber })}
                          />
                          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-gray-600">/ jour</span>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
              {erreurLot && (
                <p className="text-sm font-medium text-red-700">
                  Lot {i + 1} : {erreurLot}
                </p>
              )}
            </li>
            )
          })}
        </ul>
        <button
          type="button"
          className="bouton-secondaire w-full"
          onClick={() => (setLotsEdites((ls) => [...ls, { id: nouvelIdLot(), type: 'lot', libelle: '', probabilite: 10 }]), setEnregistre(false))}
        >
          + Ajouter un lot
        </button>
        <p className={`text-sm ${lotsValides ? 'text-gray-600' : 'text-red-700'}`}>
          {lots.length} lot{lots.length > 1 ? 's' : ''} · total {total} %
          {lots.length < 2
            ? ' — il en faut au moins 2'
            : !probasValides
              ? ' — chaque chance doit être entre 0 et 100 %'
              : !coutsValides
                ? ' — chaque coût doit être entre 0 et 1 000 €'
                : doublons.length
                  ? ` — libellé en double : ${doublons.join(', ')}`
                  : lotEnErreur
                    ? ` — « ${lotEnErreur.libelle} » : ${problemeLot(lotEnErreur)}`
                    : total <= 0
                      ? ' — au moins un lot doit avoir une chance > 0'
                      : !horsCreux
                        ? ' — il faut au moins un lot jouable hors heures creuses (sinon la roue serait vide hors créneau)'
                        : total !== 100
                          ? ' — le total ne fait pas 100 % : les chances seront recalculées au prorata'
                          : ''}
        </p>
        <Interrupteur
          libelle="Test A/B : phrase d’accroche de la page de jeu"
          aide="Un jour sur deux, la phrase sous votre nom cite un lot (« Tournez la roue : Nems offerts à gagner ! ») au lieu de « Tournez la roue et gagnez un cadeau ! ». Résultats dans le tableau de bord. Aucune donnée client en plus."
          actif={!!brouillon.testsAB?.accroche?.actif}
          onChange={(v) => maj('testsAB', { ...brouillon.testsAB, accroche: basculerAccroche(brouillon.testsAB?.accroche, v, jourParis(new Date())) })}
        />
      </fieldset>
      {/* Simulateur de coût (D3) : recalculé à chaque frappe sur le brouillon des lots, avant tout enregistrement. */}
      <SimulateurCout simulation={simulerCout(lots, etat.tirages.filter((t) => t.commerceId === commerce.id))} />
      {/* Règles du jeu (R6) : section du même formulaire, sans fieldset — les radios forment leur propre groupe nommé. */}
      <section className="carte space-y-4" aria-labelledby="regles-jeu-titre">
        <h2 id="regles-jeu-titre" className="titre-carte">Règles du jeu</h2>
        <div role="radiogroup" aria-labelledby="acces-roue-titre" className="space-y-2">
          <p id="acces-roue-titre" className="etiquette">Accès à la roue</p>
          {MODES_ACCES.map((m) => (
            <label key={m.valeur} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-gray-200 has-[:checked]:ring-2 has-[:checked]:ring-magenta-700">
              <input
                type="radio"
                name="modeAccesRoue"
                className="mt-0.5 h-5 w-5 shrink-0 accent-magenta-700"
                value={m.valeur}
                checked={modeAccesRoue(brouillon) === m.valeur}
                onChange={() => maj('modeAccesRoue', m.valeur)}
              />
              <span>
                <span className="block font-semibold">{m.libelle}</span>
                <span className="block text-sm text-gray-600">{m.aide}</span>
              </span>
            </label>
          ))}
        </div>
        <Nombre
          id="limiteGainsMois"
          libelle="Limite de gains par client (lots par mois)"
          valeur={brouillon.limiteGainsMois}
          defaut={LIMITE_GAINS_MOIS_DEFAUT}
          min={0}
          max={LIMITE_GAINS_MOIS_MAX}
          aide={`${limiteValide ? (limiteGains === 0 ? 'Illimité' : `${limiteGains} lot${limiteGains > 1 ? 's' : ''} physique${limiteGains > 1 ? 's' : ''} au plus par client sur 30 jours`) : `entre 0 et ${LIMITE_GAINS_MOIS_MAX}`} — 0 = illimité, ${LIMITE_GAINS_MOIS_DEFAUT} par défaut. Au-delà, la roue ne donne plus que des points ou « perdu » à ce client.`}
          onChange={(v) => maj('limiteGainsMois', v)}
        />
        {/* Plages d'ouverture (D1) : les instants gagnants du jour sont tirés au hasard dans ces créneaux. */}
        <div className="space-y-2">
          <p className="etiquette">Plages d’ouverture (instants gagnants)</p>
          <p className="text-sm text-gray-600">
            Heures de Paris. Les instants gagnants de chaque jour sont tirés au hasard dans ces créneaux ; le premier client qui joue dans les 5 minutes suivant un instant gagne le lot (sauf plafond du jour ou limite de gains atteints). Les instants à venir restent secrets, même pour vous : le tableau de bord ne les montre qu’une fois passés.
          </p>
          <ul className="space-y-2">
            {plages.map((p, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={`plage-debut-${i}`}>
                  Début de la plage {i + 1}
                </label>
                <input id={`plage-debut-${i}`} className="champ w-32" type="time" value={p.debut} onChange={(e) => majPlage(i, { ...p, debut: e.target.value })} />
                <span aria-hidden="true">–</span>
                <label className="sr-only" htmlFor={`plage-fin-${i}`}>
                  Fin de la plage {i + 1}
                </label>
                <input id={`plage-fin-${i}`} className="champ w-32" type="time" value={p.fin} onChange={(e) => majPlage(i, { ...p, fin: e.target.value })} />
                <button type="button" className="min-h-11 text-sm font-semibold text-red-800 underline" onClick={() => majPlage(i, null)}>
                  Retirer
                </button>
              </li>
            ))}
          </ul>
          {plages.length < PLAGES_MAX && (
            <button type="button" className="bouton-secondaire w-full" onClick={() => maj('plagesOuverture', [...plages, { debut: '12:00', fin: '14:00' }])}>
              + Ajouter une plage
            </button>
          )}
          {erreurPlages ? <p className="text-sm font-medium text-red-700">Plages d’ouverture : {erreurPlages.replace(/^plages d’ouverture : /, '')}</p> : !plages.length && <p className="text-sm text-gray-600">Aucune plage : aucun instant gagnant ne sera tiré.</p>}
        </div>
        {/* Créneaux heures creuses (D2) : composant à part (cases des jours, début et fin de chaque créneau). */}
        <CreneauxCreux creneaux={creneaux} erreur={erreurCreneaux} onChange={(v) => maj('creneauxCreux', v)} />
      </section>
      {/* Aperçu (R6) : roue du brouillon, tirage de test dans le navigateur — rien n'est enregistré. */}
      <section className="carte space-y-3" aria-labelledby="apercu-roue-titre">
        <h2 id="apercu-roue-titre" className="titre-carte">Aperçu de la roue</h2>
        <p className="text-sm text-gray-600">
          Votre roue telle que configurée ci-dessus (même non enregistrée) : la taille de chaque secteur suit sa chance. Le tirage de test suit les mêmes chances, sans plafond ni limite, et ne crée aucun tirage.
        </p>
        <ApercuRoue lots={lots} couleur={apparence.couleur} initiale={brouillon.nom.trim()[0]?.toUpperCase()} />
      </section>
      </div>

      <div id="reglages-messages" role="tabpanel" aria-labelledby="onglet-messages" hidden={onglet !== 'messages'} className="space-y-6">
      <fieldset className="carte space-y-1">
        <legend className="sr-only">Messages automatiques</legend>
        <h2 className="titre-carte pb-1">Messages automatiques</h2>
        <p className="pb-1 text-sm text-gray-600">Affichés dans l’espace client (sur sa carte) et proposés à copier dans Messages. Aucun SMS ni e-mail n’est envoyé.</p>
        {TYPES_MESSAGES.map((t) => (
          <label key={t.type} className="flex min-h-12 cursor-pointer items-start gap-3 py-1.5">
            <span className="zone-case">
              <input
                type="checkbox"
                className="case-a-cocher"
                checked={!!brouillon.messagesAuto?.[t.type]}
                onChange={(e) => maj('messagesAuto', { ...(brouillon.messagesAuto ?? reglesVides()), [t.type]: e.target.checked })}
              />
            </span>
            <span>
              <span className="block font-medium">{t.libelle}</span>
              <span className="block text-sm text-gray-600">{t.aide}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="carte divide-y divide-gray-100">
        <legend className="sr-only">Réponses aux avis</legend>
        <h2 className="titre-carte pb-2">Réponses automatiques aux avis</h2>
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
        <p className="pt-2 text-sm text-gray-600">
          Les règles s’appliquent aux nouveaux avis et, à l’enregistrement, aux avis encore sans réponse ni brouillon (un brouillon existant n’est jamais remplacé). {estDemo ? 'Démo : a' : 'A'}ucune réponse n’est réellement
          publiée sur Google.
        </p>
      </fieldset>
      </div>

      <div id="reglages-carte" role="tabpanel" aria-labelledby="onglet-carte" hidden={onglet !== 'carte'} className="space-y-6">
      <fieldset className="carte space-y-3">
        <legend className="sr-only">Apparence de la carte</legend>
        <h2 className="titre-carte">Apparence de la carte</h2>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ['couleur', 'Couleur principale', COULEUR_DEFAUT],
              ['fond', 'Fond de la carte', FOND_DEFAUT],
            ] as const
          ).map(([k, libelle, defaut]) => (
            <div key={k}>
              <label className="etiquette" htmlFor={`app-${k}`}>
                {libelle}
              </label>
              <input
                id={`app-${k}`}
                type="color"
                className="h-12 w-full cursor-pointer rounded-xl ring-1 ring-gray-300"
                value={apparence[k] ?? defaut}
                onChange={(e) => maj('apparence', { ...apparence, [k]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <div>
          <label className="etiquette" htmlFor="app-banniere">
            Bannière (adresse https d’une image, optionnelle)
          </label>
          <input id="app-banniere" className="champ" inputMode="url" placeholder="https://…" value={apparence.banniere ?? ''} onChange={(e) => maj('apparence', { ...apparence, banniere: e.target.value.trim() })} />
        </div>
        <p className="text-sm text-gray-600">Logo : section « Le commerce » plus haut (envoi d’une image PNG, JPEG ou WebP). Les couleurs trop claires ou trop foncées sont refusées (lisibilité ≥ 4,5:1).</p>
        {problemes.map((p) => (
          <MessageErreur key={p}>{p}</MessageErreur>
        ))}
        {(apparence.couleur || apparence.fond || apparence.banniere) && (
          <button type="button" className="min-h-11 text-sm font-semibold text-gray-700 underline" onClick={() => maj('apparence', {})}>
            Revenir à la charte par défaut
          </button>
        )}
        <div>
          <p className="surtitre mb-2">Aperçu en direct</p>
          <CarteFidelite
            commerce={{ ...brouillon, apparence, catalogue, eurosParPoint: taux }}
            client={{ ...APERCU_CLIENT, commerceId: brouillon.id, tampons: Math.max(0, Math.min(3, brouillon.seuilTampons - 1)) }}
            sansQr
          />
        </div>
      </fieldset>
      </div>

      <div id="reglages-donnees" role="tabpanel" aria-labelledby="onglet-donnees" hidden={onglet !== 'donnees'} className="space-y-6">
      <fieldset className="carte space-y-3">
        <legend className="sr-only">Données personnelles</legend>
        <h2 className="titre-carte">Données personnelles (RGPD)</h2>
        <Nombre
          id="conservationMois"
          libelle="Durée de conservation après la dernière visite (en mois)"
          valeur={brouillon.conservationMois}
          defaut={CONSERVATION_DEFAUT_MOIS}
          min={CONSERVATION_MIN_MOIS}
          max={CONSERVATION_MAX_MOIS}
          aide={`${conservationValide ? libelleDuree(conservation) : `entre ${CONSERVATION_MIN_MOIS} et ${CONSERVATION_MAX_MOIS} mois`} — par défaut 3 ans (36 mois). Au-delà, la carte apparaît dans « Clients » comme à purger ; rien n’est supprimé sans votre confirmation. Durée reprise dans la politique de confidentialité.`}
          onChange={(v) => maj('conservationMois', v)}
        />
      </fieldset>
      </div>

      {/* Au-dessus de la barre d'onglets (64 px + zone de sécurité de l'iPhone). */}
      <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 space-y-2 md:bottom-4">
        <MessageErreur>{erreur && `Réglages non enregistrés : ${erreur}`}</MessageErreur>
        <button type="submit" className="bouton w-full shadow-lg" disabled={!valide || enCours}>
          {enCours ? 'Enregistrement…' : enregistre ? '✓ Enregistré' : 'Enregistrer'}
        </button>
      </div>
    </form>
  )
}

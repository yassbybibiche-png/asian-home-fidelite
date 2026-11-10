import type { Client, Commerce, CommercePublic } from '../types'
import { recompenseDebloquee, tamponsAffiches } from '../lib/fidelite'
import { eurosParPoint, soldePoints } from '../lib/points'
import { configDefi, configOffreHebdo, configParrainage, niveauClient, offreHebdoDuJour, prochainPalier, reserveUtilisable, JOURS_SEMAINE } from '../lib/programme'
import { assombrir, estCouleur } from '../lib/apparence'
import { banniereCommerce, VISUELS } from '../lib/visuels'
import { dateRelative } from '../lib/format'
import { urlAbsolue } from '../router'
import { cleTamponsVus, lotsEnAttente, tamponsNouveaux, texteExpiration, texteProgression, type GainDuJour } from '../lib/carte'
import { LogoCommerce, QrCode } from './ui'
import { useEffect, useState } from 'react'

/**
 * Tampons gagnés depuis la dernière ouverture de la carte sur ce téléphone (P1-C3), à animer. La valeur vue est
 * mémorisée à chaque affichage ; un tampon ajouté pendant que la page est ouverte (rechargement au retour) s'anime aussi.
 */
function useTamponsNouveaux(clientId: string, tampons: number, actif: boolean): number[] {
  const [nouveaux, setNouveaux] = useState<number[]>([])
  useEffect(() => {
    if (!actif) return
    const cle = cleTamponsVus(clientId)
    let vus: number | null = null
    try {
      const v = localStorage.getItem(cle)
      vus = v === null ? null : Number(v)
      localStorage.setItem(cle, String(tampons))
    } catch {
      // Stockage indisponible (navigation privée stricte) : pas d'animation, la carte reste juste.
    }
    const n = tamponsNouveaux(vus, tampons)
    // Jamais remis à vide ici : en StrictMode l'effet tourne deux fois, la 2e lecture ne doit pas effacer l'animation.
    if (n.length) setNouveaux(n)
  }, [actif, clientId, tampons])
  return nouveaux
}

const dateCourte = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })

/** Colonnes de la grille de tampons : rangées régulières (5 pour 10 tampons, 4 pour 8…). */
function colonnes(seuil: number): string {
  if (seuil % 5 === 0 || seuil > 12) return 'grid-cols-5'
  if (seuil % 4 === 0) return 'grid-cols-4'
  if (seuil % 3 === 0) return 'grid-cols-3'
  return 'grid-cols-5'
}

export function libelleTaux(commerce: Pick<Commerce, 'eurosParPoint'>): string {
  const e = eurosParPoint(commerce)
  return e === 1 ? '1 point par euro dépensé' : `1 point tous les ${e.toLocaleString('fr-FR')} € dépensés`
}

/**
 * La carte telle que le client la voit sur son téléphone (aussi affichée dans la fiche commerçant).
 * Ne lit que des champs de la vue publique (`CommercePublic`) : le taux de points (`eurosParPoint`) n'en fait plus
 * partie (P0-S3) et n'est donc plus affiché ici — le commerçant le voit dans Réglages et en caisse.
 */
export function CarteFidelite({
  client,
  commerce,
  sansQr = false,
  animer = false,
  gainDuJour,
}: {
  client: Client
  commerce: Commerce | CommercePublic
  sansQr?: boolean
  /** Page publique du client : anime les tampons gagnés depuis sa dernière ouverture (pas dans la fiche commerçant). */
  animer?: boolean
  /** Gain de la roue du jour pas encore retiré : listé avec les récompenses à retirer (valable aujourd'hui seulement). */
  gainDuJour?: GainDuJour | null
}) {
  const tampons = tamponsAffiches(client, commerce)
  const nouveaux = useTamponsNouveaux(client.id, tampons, animer)
  const pct = Math.round((tampons / commerce.seuilTampons) * 100)
  const debloquee = recompenseDebloquee(client, commerce)
  const restants = Math.max(0, commerce.seuilTampons - tampons)
  const { couleur, fond } = commerce.apparence ?? {}
  // Bannière configurée par le commerçant, sinon le vrai plateau de plats pour Asian Home.
  const banniere = banniereCommerce(commerce)
  // Couleurs personnalisées (Réglages → Apparence, contraste vérifié) ; sinon la charte par défaut (classes ci-dessous).
  const styleBandeau = estCouleur(couleur) ? { background: `linear-gradient(135deg, ${couleur}, ${assombrir(couleur)})` } : undefined
  const points = soldePoints(client)
  // ---- Programme de fidélité (benchmark 09/11/2026) : tout est calculé côté serveur, affiché ici. ----
  const maintenant = new Date()
  const niveau = niveauClient(client, commerce)
  const palier = prochainPalier(client, commerce)
  const enAttente = lotsEnAttente(client, gainDuJour, maintenant)
  const defi = client.defi && configDefi(commerce).actif ? client.defi : undefined
  const defiProgression = defi ? client.visites.filter((v) => new Date(v).getTime() >= new Date(defi.debut).getTime()).length : 0
  const reserve = reserveUtilisable(client, maintenant)
  const offreHebdo = configOffreHebdo(commerce)
  const offreAujourdhui = offreHebdoDuJour(commerce, maintenant)
  const parrainage = configParrainage(commerce)
  const lienParrainage = client.codeParrainage ? `${urlAbsolue('jouer', commerce.id)}?parrain=${client.codeParrainage}` : ''
  const [copie, setCopie] = useState(false)
  async function copierLien() {
    try {
      await navigator.clipboard.writeText(lienParrainage)
      setCopie(true)
      setTimeout(() => setCopie(false), 2000)
    } catch {
      // Presse-papiers indisponible : le lien reste sélectionnable ci-dessous.
    }
  }

  return (
    <section className="overflow-hidden rounded-3xl bg-white shadow-relief ring-1 ring-gray-900/5" style={estCouleur(fond) ? { backgroundColor: fond } : undefined}>
      {banniere && (
        <img
          src={banniere}
          alt={banniere === VISUELS.heroPlats ? 'Plateau de plats d’Asian Home Paris vu de dessus : sushis, makis, saumon, nouilles, riz et dessert à la mangue' : ''}
          className="h-24 w-full object-cover"
        />
      )}
      {/* Recto : bandeau nocturne (noir + laque profonde, filet doré) façon carte physique. */}
      <div
        className={`relative overflow-hidden px-5 pt-5 pb-6 text-white ${styleBandeau ? '' : 'bg-gradient-to-br from-nuit-950 via-[#2a1216] to-marque-800 ring-1 ring-or-400/40 ring-inset'}`}
        style={styleBandeau}
      >
        <div className="pointer-events-none absolute -top-16 -right-12 h-44 w-44 rounded-full border-[18px] border-or-400/20" aria-hidden />
        <div className="relative flex items-center gap-3">
          <LogoCommerce commerce={commerce} taille="md" />
          <div className="min-w-0">
            <div className="truncate font-titre text-lg font-bold tracking-[0.08em] uppercase">{commerce.nom}</div>
            <div className="text-sm text-or-300">Carte de fidélité</div>
          </div>
        </div>
        <div className="relative mt-5 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs tracking-[0.14em] text-white uppercase">Titulaire</div>
            <div className="truncate text-xl font-semibold">{client.prenom}</div>
          </div>
          <div className="flex shrink-0 gap-4 text-right">
            <div>
              <div className="text-3xl leading-none font-extrabold">
                {tampons}
                <span className="text-lg font-semibold text-white">/{commerce.seuilTampons}</span>
              </div>
              <div className="text-xs text-white">tampons</div>
            </div>
            <div>
              <div className="text-3xl leading-none font-extrabold tabular-nums">{points}</div>
              <div className="text-xs text-white">point{points > 1 ? 's' : ''}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="p-5">
        <ul className={`grid ${colonnes(commerce.seuilTampons)} justify-items-center gap-2.5`} aria-hidden>
          {Array.from({ length: commerce.seuilTampons }, (_, i) => {
            const plein = i < tampons
            const dernier = i === commerce.seuilTampons - 1
            const rang = nouveaux.indexOf(i)
            return (
              <li
                key={i}
                style={rang > 0 ? { animationDelay: `${rang * 150}ms` } : undefined}
                className={`flex aspect-square w-full max-w-12 items-center justify-center rounded-full text-sm font-bold ${rang >= 0 && plein ? 'tampon-nouveau ' : ''}${
                  plein
                    ? 'bg-marque-500 text-white shadow-[inset_0_-2px_0_rgb(0_0_0/0.15)]'
                    : dernier
                      ? 'border-2 border-dashed border-or-500 bg-amber-50 text-amber-800'
                      : 'border-2 border-dashed border-gray-300 text-gray-500'
                }`}
              >
                {plein ? '✓' : dernier ? '🎁' : i + 1}
              </li>
            )
          })}
        </ul>

        <div
          className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={commerce.seuilTampons}
          aria-valuenow={tampons}
          aria-label="Progression vers la récompense"
        >
          <div className="h-full rounded-full bg-gradient-to-r from-marque-500 via-marque-600 to-or-400 transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1.5 flex justify-between text-sm text-gray-600">
          <span>{debloquee ? 'Carte complète' : texteProgression(restants, commerce)}</span>
          <span className="font-semibold text-marque-600">{pct} %</span>
        </p>
        {nouveaux.length > 0 && (
          <p className="apparition mt-2 text-center text-sm font-semibold text-marque-700" role="status">
            ✨ +{nouveaux.length} tampon{nouveaux.length > 1 ? 's' : ''} depuis votre dernière ouverture de la carte
          </p>
        )}

        {debloquee ? (
          <div className="apparition mt-4 rounded-2xl bg-gradient-to-br from-amber-50 to-amber-100 p-4 text-amber-900 ring-2 ring-or-500" role="status">
            <p className="surtitre text-amber-800">Récompense en attente</p>
            <p className="mt-1 text-lg font-bold">🎉 {commerce.recompense}</p>
            <p className="mt-1 text-sm">À demander au comptoir.</p>
          </div>
        ) : (
          <p className="mt-4 rounded-xl bg-gray-50 p-3 text-sm text-gray-700 ring-1 ring-gray-900/5">
            <span className="font-semibold">Objectif :</span> {commerce.recompense}
          </p>
        )}

        {/* Programme : niveau, prochain palier, défi, récompenses en attente, réserve, offre hebdo, parrainage. */}
        {niveau.nom !== 'Membre' && (
          <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
            <span className="font-bold">{niveau.nom === 'VIP' ? '👑 VIP — nos clients les plus fidèles' : `⭐ ${niveau.nom}`}</span>
            <span className="block text-xs">{niveau.avantages}</span>
          </p>
        )}
        {palier && (
          <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-200">
            <span className="font-semibold">Plus que {palier.restantes} visite{palier.restantes > 1 ? 's' : ''} avant : </span>
            {palier.palier.libelle}
          </p>
        )}
        {defi && (
          <div className="mt-4 rounded-xl bg-gray-50 p-3 ring-1 ring-gray-900/5">
            <p className="text-sm font-semibold text-gray-900">
              🎯 Défi : {defiProgression}/{defi.objectif} visites en {defi.jours} jours
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200" role="progressbar" aria-valuemin={0} aria-valuemax={defi.objectif} aria-valuenow={defiProgression} aria-label="Progression du défi">
              <div className="h-full rounded-full bg-marque-500" style={{ width: `${Math.round((defiProgression / defi.objectif) * 100)}%` }} />
            </div>
            <p className="mt-1 text-sm text-gray-700">
              {defi.objectif - defiProgression > 0 ? `Plus que ${defi.objectif - defiProgression} visite${defi.objectif - defiProgression > 1 ? 's' : ''} → ${defi.recompense}` : `${defi.recompense} gagné !`}
            </p>
          </div>
        )}
        {enAttente.length > 0 && (
          <div className="mt-4 rounded-2xl bg-gradient-to-br from-amber-50 to-amber-100 p-4 text-amber-900 ring-2 ring-or-500" role="status">
            <p className="surtitre text-amber-800">À retirer au comptoir</p>
            <ul className="mt-1 space-y-1.5">
              {enAttente.map((r) => (
                <li key={r.id} className="text-sm">
                  <span className="font-bold">
                    {r.origine === 'roue' ? '🎡' : '🎁'} {r.libelle}
                  </span>
                  {r.code && (
                    <span className="block text-xs">
                      Code à montrer : <span className="font-mono font-bold tracking-widest">{r.code}</span>
                    </span>
                  )}
                  <span className="block text-xs">{texteExpiration(r.expireLe, maintenant)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {reserve && (
          <p className="mt-4 rounded-xl bg-green-50 p-3 text-sm text-green-900 ring-1 ring-green-200">
            <span className="font-semibold">🍜 Plat en réserve</span> — un plat offert à utiliser avant le {dateCourte(reserve.expireLe)}.
          </p>
        )}
        {offreHebdo.actif && (
          <p className="mt-4 rounded-xl bg-gray-50 p-3 text-sm text-gray-700 ring-1 ring-gray-900/5">
            {offreAujourdhui ? (
              <>
                <span className="font-semibold">Aujourd’hui, membres : </span>
                {offreAujourdhui.libelle}
                {offreAujourdhui.condition ? ` ${offreAujourdhui.condition}` : ''}
              </>
            ) : (
              <>
                <span className="font-semibold">Tous les {JOURS_SEMAINE[offreHebdo.jour]}s, membres : </span>
                {offreHebdo.libelle}
                {offreHebdo.condition ? ` ${offreHebdo.condition}` : ''}
              </>
            )}
          </p>
        )}
        {parrainage.actif && client.codeParrainage && (
          <div className="mt-4 rounded-xl bg-gray-50 p-3 ring-1 ring-gray-900/5">
            <p className="text-sm font-semibold text-gray-900">👥 Parrainez un ami, vous gagnez chacun {parrainage.pointsFilleul} points</p>
            <p className="mt-1 text-sm text-gray-700">
              Votre code : <span className="font-mono font-bold text-marque-700">{client.codeParrainage}</span> — votre ami le saisit à son inscription, vous gagnez vos points à sa 1re visite.
            </p>
            <button type="button" className="bouton-secondaire mt-2 w-full" onClick={() => void copierLien()}>
              {copie ? '✓ Lien copié !' : 'Copier mon lien de parrainage'}
            </button>
          </div>
        )}

        {!!commerce.catalogue?.length && (
          <div className="mt-4">
            <p className="surtitre">Vos points</p>
            <ul className="mt-1.5 space-y-1.5">
              {commerce.catalogue.map((r, i) => {
                const ok = points >= r.cout
                return (
                  <li key={i} className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm ring-1 ${ok ? 'bg-green-50 text-green-900 ring-green-200' : 'bg-gray-50 text-gray-700 ring-gray-900/5'}`}>
                    <span className="min-w-0">
                      <span className="font-semibold">{r.nom}</span>
                      {r.description && <span className="block text-xs">{r.description}</span>}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{ok ? '✓ ' : ''}{r.cout} pts</span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {!sansQr && (
          <div className="mt-5 flex flex-col items-center border-t border-dashed border-gray-200 pt-5">
            <div className="rounded-2xl bg-white p-2 ring-1 ring-gray-200">
              <QrCode texte={urlAbsolue('carte', client.id)} className="h-40 w-40" titre={`QR code personnel de ${client.prenom}`} />
            </div>
            <p className="mt-2 text-center text-sm text-gray-600">À présenter en caisse pour valider votre visite</p>
            <p className="mt-1 text-xs text-gray-600">
              Dernière visite : {client.derniereVisite ? dateRelative(client.derniereVisite) : 'aucune pour l’instant'}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

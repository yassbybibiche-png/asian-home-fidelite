import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useRoute } from '../router'
import type { CommercePublic } from '../types'
import { ErreurApi } from '../data/api'
import { politiqueConfidentialite, type Prestataires } from '../lib/rgpd'
import { commercePublic } from '../lib/vuePublique'
import { SqueletteCarte } from '../components/Squelette'
import { LogoCommerce } from '../components/ui'
import { HorsLignePublic, MessagePublic } from './Jouer'

/**
 * Page publique #/confidentialite/<commerceId> (P1-B6) : politique de confidentialité du commerce, liée depuis le
 * formulaire d'inscription, le pied des pages client et les écrans Plus / Offre. Texte : `politiqueConfidentialite`.
 * Les prestataires d'envoi ne sont nommés que s'ils sont configurés sur le serveur (GET /sante).
 */
export default function Confidentialite() {
  const { api, etat } = useStore()
  const { param } = useRoute()
  const [donnees, setDonnees] = useState<{ commerce: CommercePublic; prestataires: Prestataires | null } | null>(null)
  const [erreur, setErreur] = useState<'introuvable' | 'horsLigne' | null>(null)
  const [essai, setEssai] = useState(0)

  useEffect(() => {
    if (!api) return
    if (!param) return setErreur('introuvable')
    let annule = false
    Promise.all([api.commerce(param), api.sante().catch(() => null)]).then(
      ([commerce, sante]) => {
        if (annule) return
        const i = sante?.integrations
        setDonnees({ commerce, prestataires: sante ? { sms: !!i?.sms, email: !!i?.email, googleWallet: !!i?.googleWallet } : null })
        setErreur(null)
      },
      (e) => !annule && setErreur(e instanceof ErreurApi && e.statut === 404 ? 'introuvable' : 'horsLigne'),
    )
    return () => {
      annule = true
    }
  }, [api, param, essai])

  // Démo locale : rien n'est envoyé, aucun prestataire.
  const local = !api ? etat.commerces.find((c) => c.id === param) : undefined
  const vue = api ? donnees : local ? { commerce: commercePublic(local), prestataires: {} } : null

  if ((!api && !local) || erreur === 'introuvable') return <MessagePublic titre="Commerce introuvable">Ce lien ne correspond à aucun commerce.</MessagePublic>
  if (erreur === 'horsLigne' && !vue) return <HorsLignePublic onReessayer={() => setEssai((n) => n + 1)} />
  if (!vue) return <SqueletteCarte libelle="Chargement de la politique de confidentialité." />

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 pt-6 pb-10">
      <header className="flex items-center gap-3">
        <LogoCommerce commerce={vue.commerce} />
        <div className="min-w-0">
          <h1 className="font-titre text-2xl font-bold leading-tight">Politique de confidentialité</h1>
          <p className="truncate text-sm text-gray-600">{vue.commerce.nom} — carte de fidélité</p>
        </div>
      </header>
      {politiqueConfidentialite(vue.commerce, vue.prestataires).map((s) => (
        <section key={s.titre} className="carte space-y-2">
          <h2 className="titre-carte">{s.titre}</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
            {s.lignes.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      ))}
      <button type="button" className="bouton-secondaire w-full" onClick={() => window.history.back()}>
        ‹ Retour
      </button>
    </div>
  )
}

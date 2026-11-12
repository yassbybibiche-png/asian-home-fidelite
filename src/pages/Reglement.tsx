import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useRoute } from '../router'
import { ErreurApi } from '../data/api'
import { donneesReglement, reglementDuJeu, type DonneesReglement } from '../lib/reglement'
import { enregistrerTraductions } from '../lib/langue'
import { SqueletteCarte } from '../components/Squelette'
import { LienConfidentialite } from '../components/ui'
import { useLangue } from '../components/Langue'
import { HorsLignePublic, MessagePublic } from './Jouer'

/** Traductions de cette page différée : hors du dictionnaire initial (P2-Q1, bundle P2-Q2). */
enregistrerTraductions({
  'Chargement du règlement du jeu.': 'Loading the game rules.',
  'Texte officiel du jeu.': 'Official rules of the game. In case of discrepancy, the French version prevails.',
  '🎡 Retour au jeu': '🎡 Back to the game',
  'Commerce introuvable': 'Business not found',
  'Ce lien ne correspond à aucun commerce.': 'This link does not match any business.',
})

/**
 * Page publique #/reglement/<commerceId> (roue v2, R4) : règlement du jeu généré depuis la configuration du commerce
 * (`reglementDuJeu`, src/lib/reglement.ts) — mode d'accès, lots actifs, limite de gains. Liée depuis la page de jeu,
 * avant le tirage. Texte dans la langue active du client (revue Codex R4, F3) ; la version française fait foi.
 */
export default function Reglement() {
  const { api, etat } = useStore()
  const { param } = useRoute()
  const { langue, t } = useLangue()
  const [donnees, setDonnees] = useState<DonneesReglement | null>(null)
  const [erreur, setErreur] = useState<'introuvable' | 'horsLigne' | null>(null)
  const [essai, setEssai] = useState(0)

  useEffect(() => {
    if (!api) return
    if (!param) return setErreur('introuvable')
    let annule = false
    api.reglement(param).then(
      (r) => {
        if (annule) return
        setDonnees(r)
        setErreur(null)
      },
      (e) => !annule && setErreur(e instanceof ErreurApi && e.statut === 404 ? 'introuvable' : 'horsLigne'),
    )
    return () => {
      annule = true
    }
  }, [api, param, essai])

  // Démo locale : généré depuis le commerce de ce navigateur.
  const local = !api ? etat.commerces.find((c) => c.id === param) : undefined
  const vue = api ? donnees : local ? donneesReglement(local) : null

  if ((!api && !local) || erreur === 'introuvable') return <MessagePublic titre="Commerce introuvable">Ce lien ne correspond à aucun commerce.</MessagePublic>
  if (erreur === 'horsLigne' && !vue) return <HorsLignePublic onReessayer={() => setEssai((n) => n + 1)} />
  if (!vue) return <SqueletteCarte libelle={t('Chargement du règlement du jeu.')} />
  if (!vue.actif) return <MessagePublic titre={vue.nom}>Le jeu de ce commerce n’est plus disponible.</MessagePublic>

  const reglement = reglementDuJeu(vue, langue)
  return (
    <div className="mx-auto max-w-md space-y-4 px-4 pt-6 pb-10" data-reglement>
      <header className="hero-sombre rounded-3xl px-5 py-6 text-center shadow-relief">
        <p className="font-semibold text-magenta-300">{t('Règlement du jeu')}</p>
        <h1 className="titre-magenta mt-1 text-2xl" lang={langue}>
          {reglement.titre}
        </h1>
        <p className="mt-2 text-sm text-white/70">{t('Texte officiel du jeu.')}</p>
      </header>
      {reglement.sections.map((s) => (
        <section key={s.titre} className="carte space-y-2" lang={langue}>
          <h2 className="titre-carte">{s.titre}</h2>
          {s.contenu.map((bloc, i) =>
            typeof bloc === 'string' ? (
              <p key={i} className="text-sm text-gray-700">
                {bloc}
              </p>
            ) : (
              <ul key={i} className="list-disc space-y-1 pl-5 text-sm text-gray-700">
                {bloc.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            ),
          )}
        </section>
      ))}
      <p className="text-center text-sm text-gray-600">
        <LienConfidentialite commerceId={vue.commerceId} />
      </p>
      <a href={`#/jouer/${vue.commerceId}`} className="bouton w-full">
        {t('🎡 Retour au jeu')}
      </a>
    </div>
  )
}

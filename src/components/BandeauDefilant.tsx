/**
 * Bandeau défilant continu (marquee CSS, Expérience cycle 3) — importé UNIQUEMENT par les pages différées Bienvenue et
 * MenuPublic (hors bundle initial). Piste `max-content` contenant deux fois exactement la même liste ; l'animation
 * `translateX(0 → -50 %)` boucle donc sans couture. La seconde copie est masquée aux lecteurs d'écran (tout le bandeau
 * sans `libelle` : purement décoratif) ; pause au survol et au focus, arrêt complet en mouvement réduit (src/index.css).
 */
export function BandeauDefilant({ mots, libelle, className = '' }: { mots: string[]; libelle?: string; className?: string }) {
  if (mots.length === 0) return null
  return (
    <div className={`bandeau-defilant overflow-hidden bg-nuit-950 py-4 text-white ${className}`} aria-hidden={libelle ? undefined : 'true'}>
      <div className="bandeau-piste">
        {[0, 1].map((copie) => (
          <ul key={copie} className="bandeau-moitie titre-logo text-lg" aria-label={copie ? undefined : libelle} aria-hidden={copie ? 'true' : undefined}>
            {mots.map((m, i) => (
              <li key={i}>
                {m}
                <span aria-hidden="true" className="bandeau-etoile">
                  ✦
                </span>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  )
}

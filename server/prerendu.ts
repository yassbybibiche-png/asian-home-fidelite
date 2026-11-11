// Prérendu des pages publiques (P2-Q4) : la SPA vit dans le fragment (#/menu, #/jouer), invisible des moteurs de
// recherche — il n'y a qu'une seule page indexable, `/`. Ce module rend le menu d'un commerce en HTML statique
// (titre, description, Open Graph et JSON-LD `Menu` propres à la page), servi par le serveur à `/menu/<commerceId>`.
// Aucun contenu inventé : plats et prix viennent du menu affiché (menu enregistré, ou carte réelle d'Asian Home en
// repli — même règle que la page publique `#/menu`, cf. `menuAffichePour`) ; les prix non confirmés sont masqués
// comme dans le menu public (`masquerPrixNonConfirmes`) ; un menu vide donne une page honnête, sans plat inventé.
// Les photos ne sont pas intégrées (les menus enregistrés peuvent contenir des images en base64, trop lourdes ici).
// HTML volontairement sans style : un `<style>` en ligne serait bloqué par la CSP (`style-src 'self'`) ; les robots
// n'en ont pas besoin et la page reste lisible pour un humain. Tout texte venu du commerçant est échappé.
import type { Commerce, Menu } from '../src/types.ts'
import { masquerPrixNonConfirmes, menuReelAsianHome } from '../src/data/menu-reel.ts'
import { estAsianHome, logoCommerce } from '../src/lib/visuels.ts'
import { libelleAllergenes } from '../src/lib/menu.ts'

/** Échappement HTML (texte et valeurs d'attribut) : tout ce qui vient du commerçant passe par là. */
export function echapperHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * Menu à afficher pour un commerce : le menu enregistré dès qu'il contient un plat, sinon la carte réelle pour
 * Asian Home (repli de la page publique), sinon le menu enregistré (vide). Prix non confirmés masqués, comme dans
 * la page publique. Ne modifie pas le menu d'origine.
 */
export function menuAffichePour(commerce: Pick<Commerce, 'id' | 'nom'>, menuStocke: Menu): Menu {
  const enregistre = menuStocke.categories.some((c) => c.produits.length > 0)
  const base = !enregistre && estAsianHome(commerce) ? menuReelAsianHome() : menuStocke
  return masquerPrixNonConfirmes(base)
}

/** Prix en euros (« 12,50 € »), ou « Prix sur place » quand le prix est inconnu / non confirmé. */
const prixAffiche = (prix: number | null) => (prix === null ? 'Prix sur place' : `${(prix / 100).toFixed(2).replace('.', ',')} €`)

/** Image Open Graph : logo du commerce s'il est adressable en absolu (chemin local ou adresse http). */
function imageOg(commerce: Commerce, site: string): string {
  const logo = logoCommerce(commerce)
  if (logo.startsWith('/')) return `${site}${logo}`
  if (logo.startsWith('http://') || logo.startsWith('https://')) return logo
  return ''
}

/**
 * Page HTML complète du menu d'un commerce (200). `site` = adresse publique (PUBLIC_URL, sinon Host) : les robots
 * et les aperçus de liens exigent des adresses absolues. Le JSON-LD `Menu` reprend les mêmes plats et prix que le
 * corps de la page (aucun prix masqué n'y figure) ; `suitableForDiet: HalalDiet` seulement pour Asian Home
 * (seul commerce dont le halal est attesté dans le code).
 */
export function pageMenuPrerendue(commerce: Commerce, menu: Menu, site: string): string {
  const url = `${site}/menu/${commerce.id}`
  const categories = menu.categories.filter((c) => c.produits.length > 0)
  const total = categories.reduce((n, c) => n + c.produits.length, 0)
  const halal = estAsianHome(commerce)
  const titre = `Menu — ${commerce.nom}`
  const description =
    total > 0
      ? `Menu de ${commerce.nom} : ${total} plat${total > 1 ? 's' : ''} en ${categories.length} catégorie${categories.length > 1 ? 's' : ''}.${halal ? ' Cuisine asiatique halal.' : ''}`
      : `Menu de ${commerce.nom} : consultez le menu dans l'application.`
  const image = imageOg(commerce, site)
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Menu',
    name: titre,
    url,
    inLanguage: 'fr',
    ...(total > 0
      ? {
          hasMenuSection: categories.map((c) => ({
            '@type': 'MenuSection',
            name: c.nom,
            hasMenuItem: c.produits.map((p) => ({
              '@type': 'MenuItem',
              name: p.nom,
              ...(p.description ? { description: p.description } : {}),
              ...(halal ? { suitableForDiet: 'https://schema.org/HalalDiet' } : {}),
              ...(p.prix !== null ? { offers: { '@type': 'Offer', price: (p.prix / 100).toFixed(2), priceCurrency: 'EUR' } } : {}),
            })),
          })),
        }
      : {}),
  }
  // JSON.stringify n'échappe pas `<` : un nom de plat contenant `</script>` casserait le bloc — on neutralise `<`.
  const ldJson = JSON.stringify(ld).replace(/</g, '\\u003c')
  const corps =
    total > 0
      ? categories
          .map(
            (c) =>
              `<section>\n<h2>${echapperHtml(c.nom)}</h2>\n<ul>\n${c.produits
                .map(
                  (p) =>
                    `<li><strong>${echapperHtml(p.nom)}</strong>${p.description ? ` — ${echapperHtml(p.description)}` : ''} — ${prixAffiche(p.prix)}<br><small>${echapperHtml(libelleAllergenes(p))}</small></li>`,
                )
                .join('\n')}\n</ul>\n</section>`,
          )
          .join('\n')
      : `<p>Le menu sera bientôt en ligne — consultez-le dans l’application.</p>`
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${echapperHtml(titre)}</title>
<meta name="description" content="${echapperHtml(description)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${echapperHtml(url)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${echapperHtml(titre)}">
<meta property="og:description" content="${echapperHtml(description)}">
<meta property="og:url" content="${echapperHtml(url)}">
<meta property="og:site_name" content="${echapperHtml(commerce.nom)}">
${image ? `<meta property="og:image" content="${echapperHtml(image)}">\n` : ''}<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${echapperHtml(titre)}">
<meta name="twitter:description" content="${echapperHtml(description)}">
<script type="application/ld+json">${ldJson}</script>
</head>
<body>
<main>
<h1>${echapperHtml(titre)}</h1>
${commerce.coordonnees ? `<p>${echapperHtml(commerce.coordonnees)}</p>\n` : ''}${corps}
<p><a href="/#/menu/${echapperHtml(commerce.id)}">Voir le menu interactif</a> · <a href="/">Accueil</a></p>
</main>
</body>
</html>
`
}

/** Commerce en pause (200, noindex) : le menu public affiche « indisponible », le prérendu dit la même chose. */
export function pageMenuIndisponible(commerce: Pick<Commerce, 'id' | 'nom'>, site: string): string {
  const titre = `Menu indisponible — ${commerce.nom}`
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${echapperHtml(titre)}</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="${echapperHtml(`${site}/menu/${commerce.id}`)}">
</head>
<body>
<main>
<h1>${echapperHtml(titre)}</h1>
<p>Le menu de ce commerce n’est plus disponible.</p>
<p><a href="/">Accueil</a></p>
</main>
</body>
</html>
`
}

/** Adresse inconnue (404, noindex) : le menu n'existe pas, on ne renvoie pas la SPA en 200 (soft 404). */
export function pageNonTrouvee(site: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Page introuvable</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="${echapperHtml(site)}/">
</head>
<body>
<main>
<h1>Page introuvable</h1>
<p>Cette page n’existe pas (ou plus).</p>
<p><a href="/">Accueil</a></p>
</main>
</body>
</html>
`
}

# SEO — ce qui est en place et ses limites (P2-Q4, 10/11/2026)

## En place

Tout est dans `index.html` (servi tel quel par le serveur, lisible sans JavaScript par les robots et les aperçus de
liens WhatsApp / Facebook / X) et dans `public/` :

| Élément | Où | Contenu |
| --- | --- | --- |
| `<title>` + `meta description` | index.html | Nom, « restaurant asiatique halal », adresse, horaires |
| `meta robots` | index.html | `index, follow` |
| `link rel="canonical"` | index.html | `https://asian-home-fidelite.onrender.com/` |
| Open Graph | index.html | `og:type restaurant.restaurant`, title, description, url, locale `fr_FR`, image `visuels/hero-plats.jpg` (1024×683, photo de la page Facebook du restaurant, voir `public/visuels/SOURCES.md`) |
| Twitter Card | index.html | `summary_large_image`, même image |
| Favicon | `public/favicon.ico` (16/32/48), `public/icones/favicon-32.png` | Générés depuis `public/visuels/logo.png` ; l'icône 192 px et l'icône Apple (P1-C3) restent |
| Données structurées | index.html, bloc `application/ld+json` | `Restaurant` : nom, adresse, téléphone, horaires (tous les jours 11h30-14h30 et 18h30-23h30), cuisines, halal, lien du menu, Instagram |
| `robots.txt` | public/ | Tout autorisé sauf `/api/`, lien vers le sitemap |
| `sitemap.xml` | public/ | `/`, `/menu/c-asian-home-paris` (adresse prérendue P2-Q4 — plus de fragment : Google ignore tout ce qui suit « # » ; la page de jeu n'est pas listée, elle n'est pas prérendable) |

Faits du JSON-LD : **uniquement** ceux déjà présents dans le code (seed `coordonnees`, `CONTACT_ASIAN_HOME` de
`src/lib/menuClient.ts`, sous-titre de `MenuPublic.tsx`). Volontairement absents : coordonnées GPS, gamme de prix,
note / avis agrégés, réservation, e-mail — rien de tout cela n'est connu de façon vérifiée. `tests/seo-p2-q4.test.ts`
recoupe chaque fait avec sa source et échoue si l'une de ces clés apparaît.

**CSP** : le bloc JSON-LD est un bloc de *données* (type non JavaScript) : le navigateur ne l'exécute jamais, la
directive `script-src 'self'` ne s'y applique pas (spécification HTML, « prepare the script element » : un type non
JavaScript s'arrête avant le contrôle CSP). Les garde-fous P0-S4 / P0-U1 l'acceptent comme seule exception, à
condition que son contenu soit du JSON valide.

## Limite principale : routeur par fragment (`#/…`)

L'app est une SPA dont les pages sont dans le **fragment** de l'adresse (`/#/menu`, `/#/jouer`, `/#/carte/…`). Le
fragment n'est jamais envoyé au serveur et Google l'ignore pour l'indexation : pour un moteur de recherche, **il n'y a
qu'une page**, `/`. Conséquences :

- les balises ci-dessus valent pour toutes les routes à la fois (même titre, même description, même aperçu de lien
  pour `#/menu` et `#/jouer`) ; il est impossible, sans serveur ou prérendu, de donner un aperçu différent par page,
  car les robots des réseaux sociaux n'exécutent pas le JavaScript ;
- le contenu du menu (plats, prix) est construit par le JavaScript : Google peut l'afficher en rendant la page, mais
  sans garantie ni délai, et toujours rattaché à `/` ;
- toute adresse inconnue (`/n-importe-quoi`) renvoie `index.html` en 200 (pas de 404) : Google peut la classer en
  « soft 404 ». Sans conséquence tant qu'aucun lien externe ne pointe vers de telles adresses.

Pour un restaurant de quartier, l'essentiel du référencement local passe de toute façon par la **fiche Google
Business Profile** (adresse, horaires, avis, photos, lien vers le site) — c'est elle qui apparaît dans Maps et dans
le panneau de droite. Le site sert surtout de destination à ce lien et aux QR.

## Prérendu du menu — FAIT (P2-Q4, lot « prérendu »)

Le menu a désormais une vraie adresse indexable : **`/menu/<commerceId>`** (ex. `/menu/c-asian-home-paris`), servie
par le serveur (`server/app.ts`, avant le statique ; rendu dans `server/prerendu.ts`, tests
`tests/prerendu-p2-q4.test.ts`) :

- **Contenu** : titre, description, canonical et Open Graph propres à la page ; JSON-LD `Menu` (`MenuSection` /
  `MenuItem`, prix en EUR, `suitableForDiet: HalalDiet` seulement pour Asian Home) ; corps de page = catégories,
  plats, descriptions, prix (« Prix sur place » quand le prix est inconnu ou non confirmé) et allergènes.
- **Source des données** : même règle que la page publique `#/menu` — menu enregistré dès qu'il contient un plat,
  sinon la carte réelle d'Asian Home en repli, sinon une page honnête sans plat inventé. Prix non confirmés masqués
  comme dans le menu public (`masquerPrixNonConfirmes`). Photos non intégrées (base64 trop lourdes).
- **Fraîcheur** : rendu à la demande, cache serveur 5 min par commerce (`Cache-Control: public, max-age=300`,
  ETag faible → 304) ; un changement de menu met 5 min à apparaître ici. Limite par IP comme les autres lectures
  publiques.
- **Cas particuliers** : commerce en pause → page « Menu indisponible » (200, `noindex`, comme le menu public) ;
  commerce inconnu ou `/menu` sans id → 404 (pas la SPA en 200 : pas de soft 404).
- **Sécurité** : tout texte venu du commerçant est échappé (corps ET JSON-LD — un `</script>` dans un nom de plat
  est neutralisé) ; page sans style en ligne (la CSP `style-src 'self'` l'interdirait).
- **Sitemap et JSON-LD** : `public/sitemap.xml` liste `/` et `/menu/c-asian-home-paris` (plus de fragment) ;
  `hasMenu` de `index.html` pointe vers l'adresse prérendue.

## Ce qui n'est pas prérendu (et pourquoi)

- **`#/jouer` (page de jeu)** : elle exige une visite validée au comptoir (et un jeton client) ; une page statique
  « Tournez la roue » serait trompeuse (le client ne peut pas jouer sans passer en caisse) et ne serait de toute
  façon pas listée utilement. Le QR vitrine pointe vers la redirection courte `/r/<commerceId>` (P2-Q3, comptage du
  scan), pas vers une page indexable.
- **Passer au routage par chemin** (`/menu`, `/jouer`, `/carte/…` au lieu de `#/…`) : le serveur sait déjà renvoyer
  `index.html` pour toute adresse inconnue, mais il faut changer `useRoute` et tous les liens, garder une redirection
  des anciennes adresses `#/…` (QR imprimés !), et injecter côté serveur des balises par route. Plus de travail et
  plus de risque de régression — le prérendu du menu couvre le besoin (c'est la seule page publique au contenu
  indexable).
- **SSR complet** (framework type Next / Remix) : disproportionné ici.

Avant tout cela : déclarer le site dans **Google Search Console** (après le choix du domaine, voir
`docs/DOMAINE.md`), soumettre `sitemap.xml` et mesurer : si les recherches « asian home pré saint gervais » mènent
déjà à la fiche Google, le prérendu n'apporte presque rien.

## Changer d'adresse (domaine à soi)

L'adresse absolue `https://asian-home-fidelite.onrender.com` est écrite dans `index.html`, `public/robots.txt` et
`public/sitemap.xml` (les robots et les aperçus de liens exigent des adresses absolues). Démarche complète :
`docs/DOMAINE.md`, étape 5.

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
| `sitemap.xml` | public/ | `/`, `/#/menu`, `/#/jouer` |

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
- les entrées `#/menu` et `#/jouer` du sitemap sont ramenées à `/` (listées pour documenter les pages publiques,
  sans effet d'indexation propre) ;
- le contenu du menu (plats, prix) est construit par le JavaScript : Google peut l'afficher en rendant la page, mais
  sans garantie ni délai, et toujours rattaché à `/` ;
- toute adresse inconnue (`/n-importe-quoi`) renvoie `index.html` en 200 (pas de 404) : Google peut la classer en
  « soft 404 ». Sans conséquence tant qu'aucun lien externe ne pointe vers de telles adresses.

Pour un restaurant de quartier, l'essentiel du référencement local passe de toute façon par la **fiche Google
Business Profile** (adresse, horaires, avis, photos, lien vers le site) — c'est elle qui apparaît dans Maps et dans
le panneau de droite. Le site sert surtout de destination à ce lien et aux QR.

## Ce qu'il faudrait pour aller plus loin (NON fait)

Par ordre d'effort croissant :

1. **Pages statiques prérendues pour les pages publiques** : générer au build `dist/menu/index.html` (HTML du menu
   rendu côté serveur avec `renderToString`, ses propres titre / description / og:*, et un JSON-LD `Menu` /
   `MenuItem` avec `suitableForDiet: HalalDiet`) ; le serveur sert ce fichier à `/menu`. L'app reste en hash-router,
   `/menu` est juste une porte d'entrée indexable qui renvoie vers `/#/menu` pour l'interactif. Point d'attention : le
   menu vit en base (Réglages) → soit prérendu à chaque déploiement (menu figé jusqu'au suivant), soit rendu par le
   serveur à la demande avec cache.
2. **Passer au routage par chemin** (`/menu`, `/jouer`, `/carte/…` au lieu de `#/…`) : le serveur sait déjà renvoyer
   `index.html` pour toute adresse inconnue, mais il faut changer `useRoute` et tous les liens, garder une redirection
   des anciennes adresses `#/…` (QR imprimés !), et injecter côté serveur des balises par route. Plus de travail et
   plus de risque de régression.
3. **SSR complet** (framework type Next / Remix) : disproportionné ici.

Avant tout cela : déclarer le site dans **Google Search Console** (après le choix du domaine, voir
`docs/DOMAINE.md`), soumettre `sitemap.xml` et mesurer : si les recherches « asian home pré saint gervais » mènent
déjà à la fiche Google, le prérendu n'apporte presque rien.

## Changer d'adresse (domaine à soi)

L'adresse absolue `https://asian-home-fidelite.onrender.com` est écrite dans `index.html`, `public/robots.txt` et
`public/sitemap.xml` (les robots et les aperçus de liens exigent des adresses absolues). Démarche complète :
`docs/DOMAINE.md`, étape 5.

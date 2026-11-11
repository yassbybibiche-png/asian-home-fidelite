# Photos des plats — inventaire exact (P1-M3, préparation, 11/11/2026)

Préparation seulement : photographier ou récupérer les plats sans photo est impossible sans les
photos du restaurant. **Aucune photo fournie par le commerçant** (`assets/source/photos/` ne
contient que son `README.md`, aucune image) et **aucune photo client Google n'est utilisée**.
Ce fichier est la liste exacte à fournir au commerçant. Règle appliquée partout : jamais une photo
sur un plat qu'elle ne montre pas — un plat sans photo reste sans photo.

## Compte vérifié (11/11/2026, `src/data/menu-reel.ts`)

| | Nombre |
|---|---|
| Plats au total | 81 |
| **Avec photo vérifiée** | **11** |
| **Sans photo** | **70** |

Vérifié par `tests/photos-manquantes-p1-m3.test.ts` (comptage + liste exacte + poids + présence de
ce fichier). Les 18 WebP du PDF (9 plats × fiche + vignette) sont couvertes par
`tests/photos-menu.test.ts`.

## Plats avec photo (11) — toutes vérifiées une par une

| Plat | Fichier (fiche) | Poids | Vignette |
|---|---|---|---|
| Poke Bowl | `menu-poke-bowl.webp` (203×132, petite photo du PDF, qualité limitée) | 4 156 o | 2 958 o |
| Dynamite | `menu-dynamite.webp` | 24 014 o | 6 580 o |
| Mi Prat | `menu-mi-prat.webp` | 21 354 o | 6 168 o |
| Pad Thaï | `menu-pad-thai.webp` | 21 806 o | 6 308 o |
| Crousti Poulet | `menu-crousti-poulet.webp` | 18 926 o | 5 888 o |
| Khao Prat | `menu-khao-prat.webp` | 14 190 o | 4 644 o |
| Curry Vert | `menu-curry-vert.webp` | 13 648 o | 3 830 o |
| Tigre qui pleure | `menu-tigre-qui-pleure.webp` | 23 382 o | 6 740 o |
| Bo Bun | `menu-bo-bun.webp` | 13 360 o | 3 954 o |
| Loc Lac | `menu-loc-lac.jpg` (1 109×720) | 156 543 o | — |
| Mango Stick | `menu-mango-sticky-rice.jpg` | 61 360 o | — |

Total fiches des plats : 372 739 o (≈ 364 Ko) ; vignettes : 47 070 o (≈ 46 Ko). Chaque fiche
pèse ≤ 250 Ko. Provenance : les 9 WebP sont recadrées du PDF officiel de la carte, chacune
**légendée du nom du plat par le restaurant** (`scripts/extraire-photos-menu.py`,
`public/visuels/SOURCES.md`) ; Loc Lac et Mango Stick viennent de la galerie du restaurant
(lacarte.menu). Aucune autre photo du PDF n'était exploitable (voir « Pourquoi pas de photo »).

## Plats sans photo (70) — à fournir par le commerçant

### Salades & accompagnements (6)
Choux · Edamame · Wakame · Soupe Miso · Riz Nature · Riz Thaï

### California x6 — option Crispy +0,50 € (7)
California Saumon Avocat · California Saumon Cheese · California Thon Cuit Mayo Avocat Concombre ·
California Poulet Avocat · California Veggie Avocat Concombre · California Crevettes Tempura Avocat ·
California Foie Gras Figue Amande

### Maki Green x6 (6)
Maki Green Saumon Avocat Menthe Coriandre · Maki Green Thon Avocat Menthe Coriandre ·
Maki Green Saumon Cheese · Maki Green Avocat Cheese · Maki Green Tempura Avocat Mayo Menthe Coriandre ·
Maki Green Crevettes Tempura Avocat Sauce Curry

### Maki Black x6 (6)
Maki Black Saumon · Maki Black Avocat · Maki Black Thon · Maki Black Cheese ·
Maki Black Saumon Cheese · Maki Black Concombre

### Maki Neige x6 (4)
Maki Neige Saumon Cheese · Maki Neige Saumon Avocat · Maki Neige Avocat Cheese ·
Maki Neige Thon Cuit Avocat Mayo

### Maki Pink x6 (5)
Maki Pink Cheese · Maki Pink Avocat Cheese · Maki Pink Concombre Cheese ·
Maki Pink Saumon Mi-Cuit Cheese Oignon Frit · Maki Pink Avocat Cheese Tomate Séchée

### Sashimi (4)
Sashimi Saumon 6 pièces · Sashimi Saumon 12 pièces · Sashimi Thon 6 pièces · Sashimi Thon 12 pièces

### Sushi x2 (4)
Sushi Saumon x2 · Sushi Thon x2 · Sushi Saumon Avocat x2 · Sushi Saumon Mi-Cuit x2

### Entrées thaï (8)
Gyoza Crevette ou Légume x4 · Nems au Poulet x4 · Crevettes Tempura x4 ·
Bœuf au Fromage Fait Maison x2 · Boulettes de Poulet Fait Maison x2 ·
Brochette de Poulet Fait Maison x2 · Tartare Saumon Avocat · Love Bao

### Menu Midi (lundi au vendredi) (4)
Midi Asian · Asian Love · Banh Mi · Menu Enfant

### Spécialités du chef (3)
8 Maki Tiger · 8 Maki Chicken Dragon · 6 Maki Gold

### Desserts (2)
Tiramisu · Dessert du jour

### Boissons (8)
Evian / San Pellegrino · Soda · Asian Drink · Calypso · Bubble Tea · Piña Colada ·
Cocktail Kohsamui · Cocktail Tokyo

### Hors carte (prix à confirmer) (3)
Thaï-sty Krusty · Bœuf Basilic · Boisson 33cl

## Pourquoi pas de photo (quand on le sait)

- **Love Bao** : la photo du PDF montre un bol de brochettes/fritures, pas des bao — légende douteuse.
- **Tiramisu** : la photo du PDF montre deux bocaux, impossible de dire lequel est le tiramisu.
- **8 Maki Tiger / 8 Maki Chicken Dragon** : la photo partagée `menu-makis.jpg` a été **détachée
  en P1-M3** — contribution client sur lacarte.menu (pas une photo fournie par le restaurant), un
  seul rouleau pour deux plats différents, impossible de dire lequel elle montre. 2 photos
  distinctes à fournir (ou confirmation du plat montré par la photo existante).
- **6 Maki Gold** : aucune photo dans le PDF ni ailleurs.
- **Boissons** : les photos du PDF ne sont attribuables à aucune boisson précise (la catégorie
  garde la photo d'ambiance `cocktails.jpg`).
- **Variantes makis / california / sashimi / sushi** (28 plats) : seules des icônes minuscules dans
  le PDF, inexploitables.
- **Tous les autres plats** (salades, entrées hors Dynamite, menu midi, dessert du jour, hors carte) :
  aucune photo dans le PDF ni dans les galeries du restaurant consultées.

## Fichiers gardés mais rattachés à aucun plat (ne pas utiliser sans confirmation)

| Fichier | Poids | Statut |
|---|---|---|
| `menu-makis.jpg` | 36 010 o | Détachée en P1-M3 (voir ci-dessus) |
| `menu-nouilles-crevettes.jpg` | 186 927 o | Identification seulement « probable » (Mi Prat ou Pad Thaï crevettes) — en attente de confirmation du commerçant |
| `menu-plat-riz.jpg` | 38 642 o | Plat thaï non identifié — photo d'ambiance de catégorie uniquement, jamais d'un plat nommé |

## Ce que le commerçant doit fournir (et comment)

1. **Photos des 70 plats ci-dessus** — photos du restaurant uniquement (prises par l'équipe ou
   fournies par le commerçant), jamais de photos de clients (Google, avis…) ni de banque d'images.
   Une photo par plat, qui montre bien CE plat. Priorité suggérée : les 2 spécialités sans photo
   (8 Maki Tiger, 8 Maki Chicken Dragon), Love Bao, puis les entrées et les variantes makis /
   california les plus vendues.
2. **Dépôt** : `assets/source/photos/`, nom `plat-<nom-du-plat>.jpg` (minuscules, tirets, sans
   accents — ex. `plat-love-bao.jpg`), voir son `README.md`.
3. **Rattachement** (côté développement, après vérification visuelle) : conversion en WebP dans
   `public/visuels/` (fiche ≤ 720 px de large, vignette 192 px), renseignement de `photo` /
   `photoVignette` du plat dans `src/data/menu-reel.ts`, source documentée dans
   `public/visuels/SOURCES.md`. En cas de doute sur le plat montré : ne pas rattacher.
4. **Confirmations attendues aussi** : le plat montré par `menu-nouilles-crevettes.jpg`
   (Mi Prat ? Pad Thaï crevettes ? autre ?) et par `menu-makis.jpg` (Tiger ? Chicken Dragon ?).

# Carte officielle — Asian Home Paris (relevée le 10/11/2026)

Remplace [MENU-REEL.md](MENU-REEL.md) (ancien menu de 39 plats sans prix, source Uber Eats).

## Source

- **Carte officielle du restaurant**, publiée sur Heyzine — PDF de 6 pages :
  `https://cdnm.heyzine.com/files/uploaded/64e5dc5d723c717e149bb6d08eb6fee86589eb69.pdf`.
- Relevée et lue le **10/11/2026** : **78 lignes tarifées**, prix confirmés visuellement sur le PDF.
- Code : `src/data/menu-reel.ts` → `menuReelAsianHome()` (16 catégories, **81 plats** = 78 de la carte
  + 3 plats hors carte gardés de l'ancien menu). C'est le **menu de repli public** : tant que le menu
  enregistré du commerce est vide (cas de la production au 10/11), `#/menu` affiche cette carte.
  Côté commerçant, `#/menuCarte` → « 📖 Charger la carte officielle d'Asian Home » la met dans
  l'éditeur, puis « Enregistrer le menu » la publie.
- Ancien menu sauvegardé avant remplacement : `docs/menu-39-plats-avant-import-2026-11-10.csv`
  (généré depuis `git show 8964f79:src/data/menu-reel.ts`, pas retapé).

## Contenu (prix en euros)

| # | Catégorie | Plats |
|---|---|---|
| 1 | Salades & accompagnements | Choux 2,50 · Edamame 4,00 · Wakame 4,00 · Soupe Miso 2,50 · Riz Nature 2,50 · Riz Thaï **8,90 ⚠** |
| 2 | California x6 — option Crispy +0,50 € | Saumon Avocat · Saumon Cheese · Thon Cuit Mayo Avocat Concombre · Poulet Avocat · Veggie Avocat Concombre · Crevettes Tempura Avocat — 6,50 ; Foie Gras Figue Amande 7,00 |
| 3 | Maki Green x6 | 6 variantes — 6,90 |
| 4 | Maki Black x6 | 6 variantes — 6,00 |
| 5 | Maki Neige x6 | 4 variantes — 6,50 |
| 6 | Maki Pink x6 | 5 variantes — 6,90 |
| 7 | Sashimi | Saumon 6 p. 7,00 · Saumon 12 p. 13,90 · Thon 6 p. 8,00 · Thon 12 p. 14,50 (cru ou épicé) |
| 8 | Sushi x2 | Saumon · Thon · Saumon Avocat · Saumon Mi-Cuit — 4,50 |
| 9 | Poke Bowl | Poke Bowl 14,50 (bases et garnitures dans la description) |
| 10 | Entrées thaï | Gyoza Crevette ou Légume x4 6,90 · Nems au Poulet x4 6,90 · Crevettes Tempura x4 6,90 · Bœuf au Fromage Fait Maison x2 4,90 · Boulettes de Poulet Fait Maison x2 4,90 · Brochette de Poulet Fait Maison x2 4,90 · Tartare Saumon Avocat 8,90 · Dynamite 8,90 · Love Bao 9,90 |
| 11 | Plats thaï | Mi Prat 13,90 · Pad Thaï 13,90 · Crousti Poulet 14,90 · Khao Prat 13,90 · Curry Vert 13,90 · Tigre qui pleure 15,90 · Loc Lac 14,90 · Bo Bun 13,90 |
| 12 | Menu Midi (lundi au vendredi) | Midi Asian 13,90 · Asian Love 13,90 · Banh Mi 9,90 · Menu Enfant 9,90 |
| 13 | Spécialités du chef | 8 Maki Tiger 13,90 · 8 Maki Chicken Dragon 13,90 · 6 Maki Gold **100,00 ⚠** |
| 14 | Desserts | Mango Stick · Tiramisu · Dessert du jour — 8,90 |
| 15 | Boissons | Evian / San Pellegrino 2,90 · Soda 3,50 · Asian Drink 3,90 · Calypso 3,90 · Bubble Tea 5,00 · Piña Colada 7,50 · Cocktail Kohsamui 7,50 · Cocktail Tokyo 7,50 |
| 16 | Hors carte (prix à confirmer) | Thaï-sty Krusty · Bœuf Basilic · Boisson 33cl — sans prix (« Prix sur place ») |

Noms complets et descriptions exactes : `src/data/menu-reel.ts` (vérifiés un par un par `tests/menu-reel.test.ts`).
Descriptions = texte de la carte uniquement ; Dynamite et les 3 plats hors carte gardent leur description Uber Eats.
Aucune description inventée (ex. 6 Maki Gold, Dessert du jour, Choux : sans description).

## ⚠ 2 prix à confirmer par le commerçant (importés tels qu'imprimés, non corrigés)

1. **Riz Thaï 8,90 €** (p. 2) — incohérent avec Riz Nature 2,50 €, mais c'est le prix imprimé
   (un avis client citait déjà une « portion de riz à 8 € »).
2. **6 Maki Gold 100,00 €** (p. 6, sans description) — environ 15× les autres makis : probable
   coquille pour 10,00 €. Affiché 100,00 € tant que le commerçant ne l'a pas corrigé dans `#/menuCarte`.

## 3 plats gardés hors carte

Présents dans l'ancien menu, absents de la carte officielle : **Thaï-sty Krusty** (chevauchement
probable avec Crousti Poulet), **Bœuf Basilic**, **Boisson 33cl** (probablement Soda ou Evian).
Regroupés dans « Hors carte (prix à confirmer) », sans prix : le commerçant décide de les tarifer
ou de les supprimer. Les 6 libellés génériques de l'ancien menu (California par 6, Maki Pink/Black/
Green/Neige par 6, Sushi par 2) sont remplacés par les variantes détaillées de la carte.

## Libellés unifiés sur la carte officielle

Duo Love Bao → Love Bao · Brochettes bœuf fromage → Bœuf au Fromage Fait Maison x2 ·
Nemus au poulet x4 → Nems au Poulet x4 · 8 Maki Dragon → 8 Maki Chicken Dragon ·
Sashimi par 6 → Sashimi Saumon 6 pièces · Sashimi Thon par 6 → Sashimi Thon 6 pièces ·
Gyoza crevette x4 → Gyoza Crevette ou Légume x4 · Cocktail Koh Samui → Cocktail Kohsamui ·
Pad Thai → Pad Thaï · Crevettes tempura → Crevettes Tempura x4 · Tartare Saumon, Avocat → Tartare Saumon Avocat.
(« Loc Lac Boeuf » sur la carte reste « Loc Lac » dans l'app.) Les plats repris gardent leur id `reel-cN-pM`.

Badges « ★ Signature » : Dynamite, Thaï-sty Krusty, Love Bao, Loc Lac, 8 Maki Chicken Dragon, 8 Maki Tiger.

## Formules modélisées comme des produits

Menu Midi (4 formules) et Poke Bowl (base + garnitures au choix) sont des **produits simples avec
description** : la composition, le soda offert et l'accompagnement au choix sont écrits dans la
description. Choix délibéré : pas d'extension du modèle `Produit` (options, suppléments) dans ce lot —
le menu public, la validation serveur, le CSV et l'éditeur restent inchangés. L'option Crispy
(+0,50 €) des California est indiquée dans le nom de la catégorie.

## Allergènes

**Aucun allergène n'est indiqué sur la carte officielle** : tous les plats ont `allergenes: []`.
Rien n'est inventé ; le pied de page de `#/menu` (« Allergènes : demandez conseil à l'équipe en cas
de doute. ») reste affiché. À compléter par le commerçant (éditeur ou CSV).

## Photos

Inchangées dans ce lot (les photos du PDF arrivent avec le lot B2) : Loc Lac → `menu-loc-lac.jpg`,
Mango Stick → `menu-mango-sticky-rice.jpg`, 8 Maki Tiger et 8 Maki Chicken Dragon → `menu-makis.jpg`,
Mi Prat → `menu-nouilles-crevettes.jpg` (identification probable, à remplacer en B2).

## Import / export CSV (`#/menuCarte`)

Format « à la française » (s'ouvre tel quel dans Excel) : séparateur `;`, BOM UTF-8, une ligne par plat.

| Colonne | Contenu |
|---|---|
| `categorie` | nom de la catégorie (obligatoire ; les catégories sont créées dans l'ordre d'apparition) |
| `nom` | nom du plat (obligatoire) |
| `prix` | euros : `6,50` ou `6.50` (aussi `6`, `6,50 €`) ; **vide = « Prix sur place »** ; 0 à 10 000 € |
| `description` | texte libre (300 caractères max) |
| `photo` | `https://…`, `/visuels/….jpg` ou vide |
| `allergenes` | parmi les 14 allergènes UE, séparés par `\|` (ex. `Gluten\|Soja`) |

Exemple :

```
categorie;nom;prix;description;photo;allergenes
Sashimi;Sashimi Saumon 6 pièces;7,00;Cru ou épicé.;;
Plats thaï;Loc Lac;14,90;Riz rouge, bœuf caramélisé, œuf, salade.;/visuels/menu-loc-lac.jpg;
Hors carte (prix à confirmer);Bœuf Basilic;;Bœuf mariné façon thaï, légumes, basilic, riz nature.;;
```

- Import : guillemets `""` et retours à la ligne entre guillemets gérés ; un fichier sans aucun `;`
  est lu avec `,` comme séparateur (export Excel « CSV virgule »). Lignes vides ignorées. Toute erreur
  est signalée avec son numéro de ligne (« Ligne 12 : allergène inconnu… ») et l'éditeur n'est pas modifié.
- Avant tout remplacement du contenu de l'éditeur (carte officielle ou import), le menu en cours est
  **téléchargé automatiquement** en `menu-avant-remplacement-AAAA-MM-JJ.csv`, puis une confirmation est demandée.
- L'import ne publie rien : seul « Enregistrer le menu » publie (PUT menu).
- Export : anti-injection de formules (`=`, `+`, `-`, `@` en tête → préfixe `'`, retiré à l'import).
- Limite du menu relevée de 60 à **120 produits** (20 catégories) — validation partagée front + serveur.

## Infos commerce (vérifiées sur la carte)

11 rue André Joineau, 93310 Le Pré-Saint-Gervais · 07 82 97 48 01 · 7 j/7 11h30–14h30 et 18h30–23h30 ·
Halal · Instagram / Snapchat @AsianHomeParis · Livraison Deliveroo et Uber Eats · https://linktr.ee/asianhomefrance

**Reste à faire** : Deliveroo, Uber Eats et le linktr.ee n'apparaissent toujours pas dans l'app
(aucun lien de commande dans le code). Les liens exacts de commande ne sont pas inventés : à fournir
par le commerçant.

# Visuels — provenance (photos réelles d'Asian Home Paris uniquement)

Récupérés le 09/11/2026. Aucune banque d'images générique, aucune photo d'un autre restaurant.
Les fichiers sont servis localement par l'app (pas de hotlink).

| Fichier | Contenu | Source |
|---|---|---|
| `logo.png` (600×600) | Logo officiel ASIAN HOUSE (chapeau conique, blanc sur noir) | Page Facebook Asian House Paris (fb.com, photo 424198893163205) |
| `hero-plats.jpg` (1024×683) | Plateau de plats vu de dessus : sushis, makis, saumon, nouilles, riz, dessert mangue | Page Facebook Asian House Paris (photo 424198889829872) |
| `table-sushis.jpg` (2268×4032) | Table dressée : bao buns, plateau de sushis, cocktails, gobelet « ASIAN HOME » | Instagram @asianhomeparis — affiche du reel C0mvZW_iQ24 |
| `cocktails.jpg` (640×1136) | Cocktails signature Koh Samui / Tokyo / Piña Colada (texte de la publication inclus dans l'image) | Instagram @asianhomeparis — affiche du reel DY2lhwmIIN1 |
| `interieur.jpg` (675×900, converti depuis WebP) | Salle du restaurant : plafond d'ombrelles, tables dressées, sans personne | Galerie du restaurant sur desicorner.fr (page Asian Home Paris) |
| `sushis-ardoise.jpg` (614×408) | Rouleau de sushis sur ardoise, filigrane « ASIAN HOME » | Galerie du restaurant sur lacarte.menu (Asian Home Paris) |

## Écartés (et pourquoi)
- `ig-plat-decouverte.jpg` (post Instagram DCxJgxusyvd) : montre une personne identifiable dans la salle — non utilisé.
- Photo de profil Instagram (240×240) : photo d'une personne, basse résolution — non utilisée.
- Photo Google Maps « SARAH » : prénom écrit en sauce + personne partiellement visible — non utilisée.
- Photo Google Maps « L'élite » : montre un autre restaurant (L'élite Restaurant-Lounge) — rejetée.
- Doublon : la photo Google Maps du plateau est un recadrage de `hero-plats.jpg` — non retenue.

## Limites
- Instagram n'a pas pu être parcouru directement (pas de tâche navigateur disponible pour ce sous-agent ; profil vérifié : @asianhomeparis, 14 103 abonnés, compte business). Les visuels Instagram viennent de la galerie du lieu (places) et des affiches de reels.
- La fiche Google Maps du restaurant n'a fourni que 5 médias ; les autres photos viennent des galeries du restaurant sur Facebook, lacarte.menu et desicorner.fr.

---

## Ajout du 10/11/2026 — photos du menu (galerie lacarte.menu du restaurant)

Récupérées le 10/11/2026 depuis la galerie du restaurant sur lacarte.menu
(page « Asian Home Paris à Le Pré-Saint-Gervais »). Chaque image a été
examinée visuellement avant utilisation. Aucune banque d'images, aucune
photo d'un autre restaurant, aucune personne identifiable.

| Fichier | Contenu | Source |
|---|---|---|
| `menu-makis.jpg` (614×408) | Rouleau de makis (dragon/tiger) sur ardoise noire, filigrane « ASIAN HOME » au chapeau conique | Galerie lacarte.menu, photo 34229454 (contribution client sur la page du restaurant) |
| `menu-loc-lac.jpg` (1109×720) | Loc Lac : bœuf caramélisé, riz rouge, œuf au plat, salade, rosace de tomate | Galerie lacarte.menu, photo 122145160 |
| `menu-nouilles-crevettes.jpg` (1140×720) | Nouilles sautées aux crevettes, bol bleu, tomate en rosace, baguettes | Galerie lacarte.menu, photo 122145184 |
| `menu-mango-sticky-rice.jpg` (411×412) | Mango sticky rice : mangue et riz gluant coco | Galerie lacarte.menu, photo 95703556 |
| `menu-plat-riz.jpg` (424×408) | Plat thaï non identifié précisément : bol de riz + bol de soupe en grès, rose de gingembre — photo d'ambiance, non rattachée à un plat précis | Galerie lacarte.menu, photo 36412305 |
| `interieur-salon.jpg` (320×240) | Coin salon : fauteuils velours bleu nuit, rideaux violets, tableau oiseau tropical, sans personne | Galerie lacarte.menu, photo 58544655 (image du restaurant) |

Notes :
- `menu-loc-lac.jpg` (207 Ko) et `menu-nouilles-crevettes.jpg` (303 Ko)
  ont été recompressées avec PIL (qualité 88 / 80) : 157 Ko et 187 Ko.
  Les autres sont servies telles que téléchargées (toutes ≤ 250 Ko).
- `menu-nouilles-crevettes.jpg` est rattachée à « Mi Prat » dans
  `docs/menu-reel.json` (identification probable : nouilles sautées aux
  crevettes) — elle conviendrait aussi au Pad Thai crevettes.
- Le QR code de la carte sur lacarte.menu a été décodé (zxing-cpp) : il
  renvoie simplement vers la page lacarte.menu du restaurant, pas vers
  une carte avec prix.

## Écartés le 10/11/2026 (et pourquoi)
- Galerie lacarte.menu, photo 122145343 : Dynamite servies en coupes dorées,
  mais une personne partiellement visible (buste, mains) — non utilisée.
- Galerie lacarte.menu, photo 123634914 : table de plats (dynamite, nems,
  pad thaï), mais bustes/bras de clients visibles — non utilisée.
- Galerie lacarte.menu, photo 95703534 : carte « FRIDAY SPECIALS » en
  anglais avec prix en $ — manifestement un autre restaurant (USA) — rejetée.
- Galerie lacarte.menu, photo 123003854 : croissants et pains au chocolat —
  autre commerce (boulangerie) — rejetée.
- Galerie lacarte.menu, photo 58445215 : assiettes (légumes grillés,
  beignet) d'allure européenne, provenance incertaine — non utilisée.
- Galerie lacarte.menu, photo 87110580 : banquettes marron, décor incohérent
  avec la salle actuelle — provenance incertaine — non utilisée.
- Galerie lacarte.menu, photo 59286319 : sushis sur table, 320×240,
  redondante avec `menu-makis.jpg` et `sushis-ardoise.jpg` — non retenue.

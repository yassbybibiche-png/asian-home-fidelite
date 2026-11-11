# Visuels — provenance (photos réelles d'Asian Home Paris uniquement)

Récupérés le 09/11/2026. Aucune banque d'images générique, aucune photo d'un autre restaurant.
Les fichiers sont servis localement par l'app (pas de hotlink).

| Fichier | Contenu | Source |
|---|---|---|
| `logo.png` (600×600) | Logo officiel ASIAN HOUSE (chapeau conique, blanc sur noir) | Page Facebook Asian House Paris (fb.com, photo 424198893163205) |
| `logo-petit.webp` (192×192, 4 900 o) | Même logo, réduit pour l'écran de chargement (affiché à 96×96) et pour le logo du commerce dans l'app (affiché 64×64, `LogoCommerce` — boucle t5) — dérivé de `logo.png` par redimensionnement (Pillow, WebP q80), boucle t2 | Dérivé de `logo.png` ci-dessus, pas une nouvelle source |
| `hero-plats.jpg` (1024×683) | Plateau de plats vu de dessus : sushis, makis, saumon, nouilles, riz, dessert mangue | Page Facebook Asian House Paris (photo 424198889829872) |
| `hero-plats-petit.webp` (720×480, 75 588 o) | Même plateau, réduit pour la bannière de la carte (affichée ~390×96) — dérivé de `hero-plats.jpg` par redimensionnement (Pillow, WebP q75), boucle t6 | Dérivé de `hero-plats.jpg` ci-dessus, pas une nouvelle source |
| `table-sushis.jpg` (788×1400 sur disque — original Instagram 2268×4032) | Table dressée : bao buns, plateau de sushis, cocktails, gobelet « ASIAN HOME » | Instagram @asianhomeparis — affiche du reel C0mvZW_iQ24 |
| `table-sushis-petit.webp` (720×1279, 95 494 o) | Même table dressée, réduite pour l'en-tête du menu et de la carte (affichée ~390×224 / ~390×320) — dérivé de `table-sushis.jpg` par redimensionnement (Pillow, WebP q75), boucle t4 | Dérivé de `table-sushis.jpg` ci-dessus, pas une nouvelle source |
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
| `menu-makis.jpg` (614×408) | Rouleau de makis (dragon/tiger) sur ardoise noire, filigrane « ASIAN HOME » au chapeau conique | Galerie lacarte.menu, photo 34229454 (contribution client sur la page du restaurant) — **non rattachée à aucun plat depuis P1-M3 (11/11/2026)** : un seul rouleau pour deux plats différents, impossible de dire lequel elle montre ; voir `docs/PHOTOS-MANQUANTES.md` |
| `menu-loc-lac.jpg` (1109×720) | Loc Lac : bœuf caramélisé, riz rouge, œuf au plat, salade, rosace de tomate | Galerie lacarte.menu, photo 122145160 |
| `menu-nouilles-crevettes.jpg` (1140×720) | Nouilles sautées aux crevettes, bol bleu, tomate en rosace, baguettes | Galerie lacarte.menu, photo 122145184 |
| `menu-mango-sticky-rice.jpg` (411×412) | Mango sticky rice : mangue et riz gluant coco | Galerie lacarte.menu, photo 95703556 |
| `menu-plat-riz.jpg` (424×408) | Plat thaï non identifié précisément : bol de riz + bol de soupe en grès, rose de gingembre — photo d'ambiance, non rattachée à un plat précis | Galerie lacarte.menu, photo 36412305 |
| `interieur-salon.jpg` (320×240) | Coin salon : fauteuils velours bleu nuit, rideaux violets, tableau oiseau tropical, sans personne | Galerie lacarte.menu, photo 58544655 (image du restaurant) |

Notes :
- `menu-loc-lac.jpg` (207 Ko) et `menu-nouilles-crevettes.jpg` (303 Ko)
  ont été recompressées avec PIL (qualité 88 / 80) : 157 Ko et 187 Ko.
  Les autres sont servies telles que téléchargées (toutes ≤ 250 Ko).
- `menu-nouilles-crevettes.jpg` était rattachée à « Mi Prat » dans
  `docs/menu-reel.json` (identification probable : nouilles sautées aux
  crevettes) — elle conviendrait aussi au Pad Thai crevettes. **Depuis le
  lot P1-B2, elle n'est rattachée à AUCUN plat** (voir plus bas) ; le fichier
  est gardé au cas où le commerçant confirme le plat qu'elle montre.
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

---

## Ajout du 10/11/2026 (lot P1-B2) — photos du PDF officiel de la carte

**Source** : carte officielle du restaurant publiée sur Heyzine —
`https://cdnm.heyzine.com/files/uploaded/64e5dc5d723c717e149bb6d08eb6fee86589eb69.pdf`,
récupérée le **10/11/2026** (HTTP 200, 709 Ko, PDF 1.7), versionnée dans
`assets/source/menu.pdf`. **6 pages scannées** : chaque page est une seule image
JPEG 887×1241 px (150 ppp ; la page 3 fait 886 px de large), sans texte extractible.

**Méthode** : `pdfimages -j` (images de pages telles quelles, sans
rééchantillonnage) puis recadrage PIL à **4 px à l'intérieur** du cadre blanc de
chaque photo — script rejouable `python3 scripts/extraire-photos-menu.py`.
Chaque recadrage a été vérifié à l'œil : il montre le plat **légendé par le
restaurant lui-même** sous la photo. Formats : fiche `menu-<slug>.webp` (largeur
native, jamais agrandie, ≤ 720 px, WebP q80) + vignette `menu-<slug>-vignette.webp`
(192 px de large, WebP q75).

Cadres en pixels de la page (bords extérieurs du cadre blanc, x0,y0 → x1,y1) :

| Plat | Fiche | Vignette | Page | Cadre |
|---|---|---|---|---|
| Poke Bowl | `menu-poke-bowl.webp` (203×132, 4 Ko) | `menu-poke-bowl-vignette.webp` (192×125) | 2 | 626,1054 → 837,1194 — petite photo dans le PDF, qualité limitée |
| Dynamite | `menu-dynamite.webp` (341×225, 24 Ko) | `menu-dynamite-vignette.webp` | 3 | 64,332 → 413,565 |
| Mi Prat | `menu-mi-prat.webp` (340×223, 21 Ko) | `menu-mi-prat-vignette.webp` | 3 | 64,759 → 412,990 |
| Pad Thaï | `menu-pad-thai.webp` (340×223, 22 Ko) | `menu-pad-thai-vignette.webp` | 3 | 472,759 → 820,990 |
| Crousti Poulet | `menu-crousti-poulet.webp` (340×224, 19 Ko) | `menu-crousti-poulet-vignette.webp` | 4 | 65,88 → 413,320 |
| Khao Prat | `menu-khao-prat.webp` (339×223, 14 Ko) | `menu-khao-prat-vignette.webp` | 4 | 473,89 → 820,320 |
| Curry Vert | `menu-curry-vert.webp` (340×223, 14 Ko) | `menu-curry-vert-vignette.webp` | 4 | 66,452 → 414,683 |
| Tigre qui pleure | `menu-tigre-qui-pleure.webp` (339×223, 23 Ko) | `menu-tigre-qui-pleure-vignette.webp` | 4 | 473,453 → 820,684 |
| Bo Bun | `menu-bo-bun.webp` (341×224, 13 Ko) | `menu-bo-bun-vignette.webp` | 4 | 472,818 → 821,1050 |

**Mi Prat** : la photo légendée « MI PRAT » du PDF **remplace**
`menu-nouilles-crevettes.jpg` (identification seulement probable). Ce dernier
fichier reste ici, rattaché à aucun plat.

### Photos existantes conservées (et pourquoi)
- **Loc Lac** → `menu-loc-lac.jpg` (1109×720, vraie photo déjà vérifiée) : le PDF
  (p. 4, 65,818 → 413,1049) montre le même plat en plus basse résolution — non extrait.
- **Mango Stick** → `menu-mango-sticky-rice.jpg` (vérifiée) : le PDF (p. 6,
  160,683 → 426,860) montre aussi le plat mais n'apporte rien — non extrait.
- **8 Maki Tiger / 8 Maki Chicken Dragon** : SANS photo depuis P1-M3 (11/11/2026) — la photo
  partagée `menu-makis.jpg` a été détachée : contribution client (lacarte.menu, pas une photo
  fournie par le restaurant), un seul rouleau pour deux plats différents, impossible de dire
  lequel elle montre. Le fichier est gardé, non rattaché, en attendant 2 photos distinctes du
  commerçant (voir `docs/PHOTOS-MANQUANTES.md`).

### Photos du PDF NON rattachées (et pourquoi)
- **Love Bao** (p. 3, en haut à droite) : la photo montre un bol de
  brochettes/fritures avec fleurs, **pas des bao buns** — légende douteuse du PDF
  lui-même : aucune photo.
- **Spécialités** (p. 6, 144,237 → 432,428 et 451,236 → 739,427) : impossible de
  distinguer 8 Maki Tiger de 8 Maki Chicken Dragon : aucune des deux n'est rattachée.
- **Tiramisu** (p. 6, 443,683 → 709,860) : **deux** bocaux (tiramisu probable + dessert
  à la fraise), impossible de dire lequel est le tiramisu : aucune photo.
- **Boissons** (p. 6, cocktails + tumbler) : boisson précise non identifiable :
  aucune photo sur un plat nommé (la catégorie garde `cocktails.jpg`).
- **Variantes makis / california / sashimi / sushi** (p. 2) : icônes minuscules,
  inexploitables : aucune photo.
- **Couverture** (p. 1, table dressée) : ambiance, déjà couverte par
  `hero-plats.jpg` / `table-sushis.jpg` : non extraite.
- **6 Maki Gold** : aucune photo dans le PDF.

Rappel : **aucune photo prise par des clients sur Google** n'est utilisée. Les
photos futures du commerçant se déposent dans `assets/source/photos/`
(voir son README) et se rattachent à la main après vérification visuelle.

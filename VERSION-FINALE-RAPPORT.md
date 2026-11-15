# Version ultime finale — rapport de mission (15/11/2026)

Ordre de l'utilisateur (15/11) : « Met moi a jour la version ultime final » =
déployer en production (1) le menu Appétit (construit sur staging, rapport
`MENU-APPETIT-RAPPORT.md`) et (2) les photos d'illustration étiquetées pour les
70 plats sans photo (décision explicite du 14/11, principe validé sur la page
de test : pastille magenta « Photo d'illustration » sur l'image, mention
complète en fiche, vraies photos seules dans le rail Signatures).

**Résultat : les deux sont en production, preuves ci-dessous.** Branche
`version-finale/illustrations` (depuis `appetit/menu`) ; production = `master`
`2b7748d` ; staging = `autonome/integration` `0cf0f91`. Discipline tenue :
Claude Code a produit le code (séquentiel), le coordinateur a relu le diff
ligne à ligne, relancé la suite complète lui-même et mené ses propres
mutations. Codex indisponible jusqu'au 16/11 — aucune validation fictive ;
rattrapage possible ensuite.

---

## Étape 1 — Les 70 illustrations

Un visuel par plat sans photo réelle (les 11 photographiés intacts), généré
le 15/11/2026 d'après le nom et la description officielle du plat. Direction
artistique unique et constante : évocation du plat sur céramique sombre et
fond ardoise noire, lumière latérale douce et dramatique, angle 45°, aucun
texte, aucune personne, aucun logo, aucun prix.

Inventaire (id produit = nom du fichier) :
- Salades/riz (6) : reel-c1-p1 Choux, reel-o-edamame, reel-o-wakame,
  reel-c1-p2 Soupe Miso, reel-c1-p3 Riz Nature, reel-c1-p5 Riz Thaï.
- California (7) : reel-o-california-saumon-avocat, -saumon-cheese,
  -thon-cuit, -poulet-avocat, -veggie, -crevettes-tempura, -foie-gras.
- Green (6) : reel-o-green-saumon-avocat, -thon-avocat, -saumon-cheese,
  -avocat-cheese, -tempura, -crevettes-tempura.
- Black (6) : reel-o-black-saumon, -avocat, -thon, -cheese, -saumon-cheese,
  -concombre.
- Neige (4) : reel-o-neige-saumon-cheese, -saumon-avocat, -avocat-cheese,
  -thon-cuit.
- Pink (5) : reel-o-pink-cheese, -avocat-cheese, -concombre-cheese,
  -saumon-mi-cuit, -tomate-sechee.
- Sashimi (4) : reel-c4-p6, reel-o-sashimi-saumon-12, reel-c4-p7,
  reel-o-sashimi-thon-12.
- Sushi (4) : reel-o-sushi-saumon, -thon, -saumon-avocat, -saumon-mi-cuit.
- Entrées thaï (8) : reel-c2-p6 Gyoza, reel-c2-p5 Nems Poulet, reel-c2-p7
  Crevettes Tempura, reel-c2-p4 Bœuf au Fromage, reel-o-boulettes-poulet,
  reel-o-brochette-poulet, reel-c1-p4 Tartare Saumon Avocat, reel-c2-p3 Love Bao.
- Midi (4) : reel-o-midi-asian, -asian-love, -banh-mi, -enfant.
- Spécialités (3) : reel-c4-p10 Maki Tiger, reel-c4-p9 Maki Chicken Dragon,
  reel-o-maki-gold.
- Desserts (2) : reel-c6-p2 Tiramisu, reel-o-dessert-du-jour.
- Boissons (8) : reel-o-eau, reel-o-soda, reel-c7-p2 Asian Drink,
  reel-o-calypso, reel-o-bubble-tea, reel-c7-p5 Piña Colada, reel-c7-p3
  Cocktail Kohsamui, reel-c7-p4 Cocktail Tokyo.
- Hors carte (3) : reel-c2-p1 Thaï-sty Krusty, reel-c3-p9 Bœuf Basilic,
  reel-c7-p1 Boisson 33cl.

**Contrôle qualité unitaire** (planches contact étiquetées, lecture visuelle
de chaque image contre son plat — famille et ingrédient vedette) : 75
générations, **5 rejetées et régénérées** : brochette poulet et dessert du
jour (dérive « aquarelle » aux bords du cadre), pink avocat cheese (avocat lu
comme concombre, quasi-doublon du concombre cheese), sushi saumon avocat
(nigiri disproportionnés), sushi saumon mi-cuit (bords peints). Les 70
retenues sont cohérentes et d'un style homogène.

**Fichiers** : `public/visuels/illustrations/<id>.webp` (fiche 800 px, WebP
q80, ~50 Ko) et `<id>-vignette.webp` (384 px, q78, ~15 Ko) — 140 fichiers,
4 590 926 o au total, chargement paresseux en place. Provenance consignée
dans `public/visuels/SOURCES.md` (générées le 15/11, étiquetées dans l'UI, ne
représentent pas le plat servi). Aucune image de banque utilisée.

## Étape 2 — Intégration app

- **Modèle** : champ séparé `illustration?` / `illustrationVignette?` sur
  `Produit` (jamais `photo`), table `ILLUSTRATIONS` (nom exact → id) et
  fonction pure `avecIllustrations` dans `src/data/menu-reel.ts`, sur le
  patron des vraies photos : rattachée par nom, elle survit à un
  ré-enregistrement du menu par le commerçant ; appliquée après
  `masquerPrixNonConfirmes` + `retirerPhotosDetachees` dans `MenuPublic.tsx`
  et `Commande.tsx`. **La vraie photo gagne toujours** (illustration posée
  seulement si `!p.photo`) ; le serveur ne voit jamais ces champs.
- **Affichage** : carte/ligne d'un plat illustré = image + pastille magenta
  « Photo d'illustration » permanente (sur la grande image ; en chip sous le
  nom dans la ligne de commande 64 px, où elle serait illisible) ; fiche du
  plat illustré = mention complète « Cette image évoque le plat ; la
  présentation servie peut différer. » ; mention globale honnête en pied de
  menu. Vraies photos : aucun marquage. **Rail « ★ Signatures », plat-star et
  héros de catégorie : vraies photos uniquement** (filtres sur `p.photo`
  inchangés). Rythme homogène : un plat illustré passe en carte image. Aucun
  texte marketing du type « 81 photos ».
- **Écarts assumés et justifiés** (rapport de lot
  `node_modules/.cache/version-finale/RAPPORT-LOT.md`) :
  1. La table est construite depuis `menuReelAsianHome()` : `docs/menu-reel.json`
     est l'ancien menu (39 plats, sans ids) — écart de source, pas de périmètre ;
     les 70 ids correspondent exactement aux 140 fichiers livrés (testé).
  2. Pastille en `text-xs` au lieu de `text-[11px]` : le test d'accessibilité
     P2-Q1 interdit toute taille arbitraire < 16 px ; `text-xs` est l'exception
     documentée des pastilles.
  3. Budget bundle : +393 o initiaux (3 clés i18n au dictionnaire central),
     rattrapés par le déplacement des deux chaînes d'alerte répétées vers
     `.alerte-ambre` / `.alerte-verte` dans `index.css` (−376 o, rendu
     identique, fond conservé dans le TSX pour la règle `.page-client`).
  4. Conséquence du brief : sur la carte d'Asian Home, les 81 plats ont une
     image — les lignes typographiques numérotées ne s'y affichent plus (le
     code reste pour tout menu ayant des plats sans image).
- **Adaptation de registre (une seule, signalée)** : `tests/appetit-menu.test.ts`
  épingle `if (!p.photo)` → `if (!p.photo && !p.illustration)` ; le corps de
  la branche typo reste sans `<img`, l'invariant du test est préservé.
- **Portes (relancées par le coordinateur)** :
  - Suite complète : **1843/1843, 0 échec** (dont 19 tests nouveaux du lot) ;
    typechecks front (`tsc -p .`) et serveur verts.
  - Mutations du coordinateur sur les gardes neuves : **3/3 détectées**
    (illustration écrasant une vraie photo → rouge ; rail Signatures ouvert
    aux illustrations → rouge ; pastille de carte retirée → rouge). La
    session de production avait aussi détecté ses 3 mutations.
  - Bundle initial **484 369 o ≤ 484 422 o** (marge 53 o) ; **32 chunks**
    inchangés ; `/visuels/illustrations/` absent des 4 fichiers initiaux,
    présent uniquement dans le chunk lazy `menu-reel` (11 847 o).
  - Labo A/B (Pixel 7 émulé, Slow 4G, CPU ×4, serveur E2E local, 2 paires
    encadrées, témoin #/jouer) : menu FCP 808/732 → 736/728 ms, LCP
    2780/2620 → 2708/2796 ms (variance ±160 ms sur l'avant seul ; témoin
    stable), CLS 0 → 0. **Aucune régression attribuable.** Mesures de
    laboratoire, pas un appareil réel.

## Étape 3 — Staging

- Fusion `--no-ff` dans `autonome/integration` (`0cf0f91`) via clone
  temporaire. Conflits résolus : imports de `Commande.tsx` (les deux côtés
  conservés) ; README/SCORES pris côté intégration puis totaux corrigés
  depuis la suite fusionnée observée (**1951 tests, 131 fichiers** — seul
  échec initial : le compteur documentaire, corrigé dans la fusion).
- Déploiement vérifié : nouvel asset, chunk `menu-reel` distant de **11 847 o
  à l'octet près** comme le build local, marqueur `/visuels/illustrations/`
  présent, fichier illustration servi en `image/webp` (HTTP 200).
- **Contrôle visuel** (DOM + captures, Pixel 7 émulé) : **81/81 plats rendus,
  140 images d'illustration (en-tête + vignette), 70 pastilles visibles,
  rail Signatures = 11 images dont 0 illustration**, mention de pied de menu
  présente, fiche d'un plat illustré avec mention complète. Note de méthode :
  Chromium ne traverse pas le proxy de cette VM vers Render — le visuel a été
  fait en local sur l'arbre fusionné exact, nourri du **menu réel servi par
  l'API staging** ; les preuves distantes sont l'asset, le chunk, le fichier
  servi et la commande ci-dessous.
- **Commande staging complète** par les vraies routes : Pad Thaï (vraie
  photo) 13,90 € + California Saumon Avocat (illustré) 6,50 € + « De l'eau »
  (service) 0 € = **20,40 €**, Table 3, commande `5d755009-f1db-4532-bc15-16d63478e43b`
  menée recue → acceptee → en_preparation → **servie** ; **0 commande en
  attente** à la fin.

## Étape 4 — Production

- **Sauvegarde complète d'abord** : `GET /admin/sauvegarde` →
  `~/workspace/sauvegardes-asian-home/sauvegarde-prod-2026-11-15-version-finale.json.gz`
  (commerces 1, clients 4, tirages 6, menus 1, journal 7, meta 14 ; archive
  **non chiffrée** — `SAUVEGARDE_CLE_CHIFFREMENT` toujours absente de l'env
  production, point ouvert inchangé).
- **Fusion master ciblée** : `2b7748d` = fusion `--no-ff` de
  `version-finale/illustrations` seule (Appétit + illustrations) ; arbre
  fusionné **identique** à la branche testée (diff = 0) ; aucun chantier
  d'intégration embarqué. Push → déploiement vérifié : asset
  `index-D1s-jATX.js` → `index-DpKEgdGx.js`, santé 200, illustration servie
  en `image/webp`.
- **Activation `commande.services = true`** pour Asian Home production
  (patron lecture → sauvegarde de l'état avant → PATCH → diff strict) :
  PATCH 200, `services: true`, **tables 1–8 et jetons strictement inchangés**,
  aucune dérive sur le reste du commerce.
- **Vérifications live** : menu production contrôlé comme le staging (81
  plats, 140 images d'illustration, 70 pastilles, rail 11 vraies photos / 0
  illustration, mentions présentes — contrôle local sur l'arbre master
  fusionné nourri du menu production réel, même réserve de méthode que pour
  le staging) ; page commande Table 1 reconnue par son jeton.
- **UNE commande TEST de production** : Pad Thaï 13,90 € + California Saumon
  Avocat 6,50 € + « De l'eau » 0 € = **20,40 €**, Table 1, instructions
  « TEST — ne pas préparer », commande `35b4a12c-f9f1-41e2-a0b6-b88fc7ea0c93`
  menée recue → acceptee → en_preparation → **servie** par les vraies
  routes ; **0 commande en attente** à la fin ; aucune autre donnée touchée
  (la ligne de service acceptée prouve au passage l'activation des demandes
  à 0 € en production).

## Restes et limites (inchangés, à connaître)

- Vérification sur un vrai téléphone (375–390 px) toujours jamais faite :
  toutes les mesures et captures sont en Pixel 7 émulé / laboratoire.
- `SAUVEGARDE_CLE_CHIFFREMENT` à poser un jour dans l'env production.
- Relecture Codex de rattrapage possible à partir du 16/11 (quota).
- Le chantier « produit » d'`autonome/integration` (cycles 1–14, post-audit)
  reste déployé en staging seulement — non concerné par cette mission.
- Rollback si besoin : `scripts/rollback-render.mjs` (service production
  `srv-dbouf5ec6qcc738q4sig`, commit cible `c5ce0d5` pour revenir à l'état
  d'avant la version finale).

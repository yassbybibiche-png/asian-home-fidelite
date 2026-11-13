# Expérience 10/10 — journal de chantier

Mission « Asian Home Experience » (master prompt de l'utilisateur, 13/11/2026) : accueil
immersif, menu premium v2 (modes Découverte / Commande), module de commande à table
complet (QR par table, panier, écran cuisine), animations haut de gamme utiles.
**Staging exclusivement** — branche `experience/accueil-commande` → `autonome/integration`.
Production (`master` 608752f) intouchée. Aucune dépense, aucun envoi réel, module
commande **désactivé par défaut** (interrupteur par commerce).

Organisation : Claude Code = Engineering Lead ; critique produit/design = critique
structurée écrite à chaque cycle (10 questions du master prompt) par le coordinateur,
puis relecture finale par l'assistant principal. **Codex indisponible (quota jusqu'au
16/11)** : aucune validation fictive — remplacé par relecture ligne à ligne des diffs +
contre-épreuves par mutation, comme les missions précédentes.

Base de départ vérifiée le 13/11/2026 : `autonome/integration` propre, **1570/1570 tests
verts** (371 suites, relance complète du coordinateur avant tout code).

---

## Étape 0 — Audit de la référence (ciaokombucha.com)

**Outil réellement disponible pour cet audit : lecture du texte et de la structure de la
page d'accueil** (contenu + inventaire des images). Aucun navigateur interactif n'est
disponible pour ce sous-agent : les animations exactes (valeurs de parallaxe, états au
survol, métriques de performance mobile, gestes tactiles) **n'ont pas été observées
directement** et ne sont pas prétendues. Ce qui suit distingue l'observé de l'inféré.

Observé (structure de la page d'accueil) :
- Un héros avec images de fond en couches (2 visuels de fond dédiés) et les produits en avant.
- Un **carrousel / bandeau défilant des saveurs** : chaque visuel produit est répété 3 fois
  dans le flux (patron classique du marquee infini).
- **Une section immersive par saveur** (10 saveurs) : un très grand visuel produit (AVIF,
  CDN), le nom de la saveur en titre fort, un texte sensoriel court (3-4 lignes), une
  identité couleur propre à chaque saveur.
- Hiérarchie typographique extrême : noms de saveurs en très grand, textes courts, aucun
  encombrement fonctionnel sur la partie vitrine.
- FAQ en accordéon et capture e-mail en fin de page.
- Images en AVIF servies par un CDN (format moderne, poids maîtrisé pour des visuels géants).

Inféré (patrons connus de ce type de site Webflow, cohérents avec la structure — NON
mesurés ici) : révélations au défilement, éléments flottants, transitions de couleur d'une
section-saveur à l'autre, micro-réactions au survol. L'utilisateur caractérise lui-même le
site comme « très animé » ; c'est sa référence d'ambition, pas une mesure.

**Principes transposables retenus (aucune copie de code, de graphisme ou de marque)** :
1. **Un moment = un univers** : une section immersive par catégorie (grande photo, nom en
   très grand, texte court) plutôt qu'une liste uniforme. → En-têtes de catégorie du menu
   v2 en « moment » plein largeur, nom en typographie logo.
2. **Le mouvement vient de la répétition des visuels** (marquee) → le rail « En photos »
   du menu gagne un défilement lent automatique en mode Découverte (pausable au toucher,
   coupé si `prefers-reduced-motion`).
3. **Typographie d'affiche** : les noms portent la page, les textes restent courts.
4. **Transitions de fond entre sections** : alternance de fonds subtils d'une catégorie à
   l'autre — chez nous, uniquement dans la DA Asian Home (noir/ivoire/magenta), jamais les
   couleurs des saveurs Ciao.
5. **Micro-interactions partout où la main passe** : pression des boutons, retour visuel
   immédiat après ajout au panier.
6. **Le spectaculaire reste léger** : visuels géants mais formats modernes et chargement
   paresseux ; chez nous, budget mesuré (voir SCORES.md) et mode Commande sans décor.

## Étape 0 — Audit de l'identité Asian Home (depuis le projet, rien d'inventé)

- **Logo** : `public/visuels/logo.png` — logo officiel « ASIAN HOUSE » (chapeau conique,
  blanc sur noir), source Facebook du restaurant (voir `public/visuels/SOURCES.md`).
  Le logo dit ASIAN HOUSE alors que le commerce s'appelle Asian Home Paris : fait existant,
  conservé tel quel.
- **Couleurs officielles du code** (`src/index.css`) : nuit 950 `#111111` (noir du logo et
  des ardoises), nuit 900 `#1b1b22`, nuit 800 `#26262e` ; magenta 300 `#ff4d6d`, 400
  `#ff2e9a`, 500 `#d1006f`, 600 `#c4007a`, 700 `#a1005e`, 900 `#2a0a1e`. Registre nocturne
  noir + magenta, halos magenta/violet sur les héros sombres (`.hero-sombre`).
- **Typographie identitaire** : « titre façon logo » — serif, capitales espacées, magenta
  clair sur fond sombre (`index.css`, contraste 5,49:1). C'est elle qui porte l'accueil.
- **Photos authentiques** (provenance complète dans `public/visuels/SOURCES.md`) :
  11 plats vérifiés (Poke Bowl, Dynamite, Mi Prat, Pad Thaï, Crousti Poulet, Khao Prat,
  Curry Vert, Tigre qui pleure, Bo Bun — légendés par le restaurant dans son PDF officiel —
  + Loc Lac et Mango Stick) ; photos de catégories (sushis sur ardoise, cocktails signature,
  plat thaï, mango sticky rice) ; ambiances (plateau de plats vu de dessus `hero-plats`,
  table dressée `table-sushis`, salle aux ombrelles, salon). 70 plats sans photo : jamais
  d'image générée présentée comme authentique — présentation graphique à la place.
- **Noms et prix** : menu officiel importé (81 plats, 16 catégories) ; 2 prix non vérifiés
  (Riz Thaï, Maki Gold) stockés `prix: null` et affichés « Prix sur place » → **exclus de la
  commande** (le serveur refuse un produit sans prix vérifié ; l'UI n'affiche pas d'ajout).
- **Options produit** : les données n'ont AUCUNE option tarifée par produit (seuls des
  badges déduits : « option épicée », « option végétarienne »). Le module commande prévoit
  le mécanisme (`Produit.options?: { nom, prix }[]`, validé côté serveur) mais **aucune
  option n'est inventée** : l'étape « options » n'apparaît que pour un produit qui en a.

## Étape 0 — Décisions d'architecture (module commande)

- **Aucune migration** : les tests épinglent exactement 15 tables et les migrations
  0001–0010 (`tests/sauvegarde-p0-s5.test.ts`). Les commandes vivent dans la table `meta`
  (patrons déjà éprouvés : instants gagnants) : `commande:<commerce>:<id>` (JSON),
  index du jour `commandes:<commerce>:<jour>` (liste d'ids), idempotence
  `commande-idem:<commerce>:<clé>` posée par `insererMetaSiAbsente`, transitions d'état
  par comparaison-et-échange (`majMetaSi`, comme `majTirageSi`).
- **Configuration dans le JSON du commerce** : `commande?: { active: boolean, tables:
  { nom, jeton }[] }` — absent = module désactivé. Le **jeton de table** (aléatoire,
  généré côté serveur) est ce qu'encode le QR : connaître le nom d'une table ne suffit pas
  pour commander « depuis » elle (anti-falsification proportionnée à un prototype ; le
  commerçant peut régénérer un jeton). La fiche publique n'expose que `commandeActive`.
- **Suivi client** : chaque commande reçoit un secret propre (comme le jeton de carte) ;
  l'état n'est lisible qu'avec ce secret. Le téléphone le conserve en stockage local.
- **Prix** : le serveur relit le menu en base et recalcule tout (prix, options) ; le panier
  du client n'envoie que des identifiants et des quantités. Produit absent, sans prix ou
  `indisponible` → commande refusée avec un message clair (500 ou 4xx lu par le client —
  jamais 502–504, cf. leçon item D).
- **États** : `recue → acceptee | refusee → en_preparation → servie`. Transitions
  commerçant derrière le PIN (session commerçant), atomiques (CAS).
- **Routes** : `#/bienvenue/<commerceId>` (accueil immersif public, page différée) ;
  `#/commande/<commerceId>/<jetonTable>` (le menu en mode Commande + panier + suivi,
  page différée) ; `#/cuisine` (écran commerçant derrière PIN, page différée). Le menu
  public `#/menu/<id>` reste le mode Découverte ; ses boutons d'ajout n'existent que dans
  le contexte commande. Polling cuisine et suivi : patrons existants (pause si page
  cachée), 10 s.
- **Bundle** : tout le nouveau code client part en chunks différés ; le bundle initial
  reste sous le plafond épinglé de 484 422 o.
- **Adaptations de tests** : uniquement celles strictement imposées par les nouvelles
  routes/pages (registres de routes et de chunks), listées exactement dans ce journal le
  cas échéant, avec contre-épreuves. Aucun autre test existant modifié.

---

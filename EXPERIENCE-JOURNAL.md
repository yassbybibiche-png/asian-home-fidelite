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

## Cycle 1 — construit (lots 1, 1b, 2, 3)

- **Lot 1 (serveur)** : types commande, `src/lib/commande.ts` (calcul du panier relu du
  menu en base, transitions), `server/commandes.ts` (stockage `meta`, CAS, idempotence),
  4 routes + résolution publique de table, jetons de table générés à la sauvegarde,
  `commandeActive` sur la fiche publique. Écarts documentés : insert-if-absent =
  `majMetaSi(cle, undefined, …)` ; limite d'envoi en constante séparée (test épinglé) ;
  `validerMenu` apprend `indisponible`/`options`. 32 mutations testées.
- **Lot 1b (reprise)** : le secret de suivi est **généré par le client** avant l'envoi
  (trouvé en relecture coordinateur : une réponse 201 perdue rendait le suivi à jamais
  illisible). Doublon d'idempotence + même secret → suivi lisible. 1597 tests.
- **Lot 2 (écrans client + réglages)** : `#/bienvenue` immersif, menu v2 (marquee du rail
  « En photos », révélations au défilement via `src/lib/revelation.ts`, en-têtes
  « moment », dépliage fluide), `#/commande` (mode Commande : panier `src/lib/panier.ts`,
  options seulement si les données en ont, suivi à polling 10 s, reprise après
  rechargement), Réglages « Commande à table » (composant séparé `ReglagesCommande` :
  activation, tables, QR par table, planche imprimable), case « Indisponible » dans
  l'éditeur de menu. Bundle initial 483 644 o.
- **Lot 3 (cuisine + E2E + mesures)** : `#/cuisine` (sections par statut, actions à
  grands boutons, conflit multi-appareils relu en silence, pastille « Nouveau »,
  historique hier), E2E « deux téléphones » (deux contextes Chromium, **étiquetée
  simulation**) 3 tests + parcours complet vert, mesures de laboratoire : menu v2 sans
  régression (FCP ≈ 676 ms, LCP ≈ 2 424–2 476 ms), `#/bienvenue` LCP ≈ 1,9 s,
  `#/commande` premier bouton « Ajouter » ≈ 1,98 s, **CLS mesuré 0** partout.
- **Totaux cycle 1 : 1651/1651 tests unitaires, E2E 12/12, bundle initial 483 925 o
  (plafond 484 422 o, marge 497 o).**
- Adaptations de tests existants (registres imposés, chacune avec contre-épreuve) :
  `tests/corps-sombres-p1-d2.test.ts:23-24`, `tests/performance-bundle-p2-q2.test.ts:33`
  (pages différées : Bienvenue, Commande, puis Cuisine). Aucun autre test existant modifié.

## Cycle 1 — critique (10 questions, coordinateur)

1. **Visuellement meilleur ?** Oui, démontré par captures locales (Pixel 7 simulé) :
   accueil immersif nouveau, menu en « moments », rail photos vivant. NON démontré sur
   appareil réel ni par un humain sur le staging.
2. **Parcours client plus simple ?** Le parcours commande est minimal (scanner → ajouter
   → panier → confirmer → suivi) et prouvé en E2E. Friction restante : un client
   anglophone arrivant par le QR ne peut pas changer la langue sur `#/bienvenue` et
   `#/commande` (test existant réserve le commutateur à 3 pages ; les pages suivent la
   langue choisie ailleurs et tout est traduit).
3. **Animations fluides ?** CLS mesuré à 0 et aucun débordement ; MAIS les animations
   elles-mêmes n'ont jamais été vues en mouvement : les captures des lots 2–3 sont en
   `prefers-reduced-motion`. Fluidité réelle = **à vérifier** (cycle 2 : captures avec
   animations activées).
4. **Menu plus agréable à explorer ?** Oui : marquee, révélations, en-têtes photo en
   typographie logo, dépliage sans saut ; mesures identiques à la v1 dans la variance.
   Les 70 plats sans photo gardent une présentation graphique sobre — assumé, pas un défaut
   corrigeable sans le restaurant.
5. **Commande plus rapide ?** Fonction nouvelle (pas d'« avant ») : premier bouton
   « Ajouter » à ≈ 1,98 s en laboratoire Slow 4G, 4 gestes pour commander, aucun effet
   décoratif sur le chemin d'action (mode Commande tenu).
6. **Performances préservées ?** Oui : bundle sous le plafond (marge 497 o — faible,
   toute retouche front du cycle 2 sera mesurée avant/après), FCP/LCP du menu stables.
7. **Identité Asian Home respectée ?** Oui : aucune couleur, image ou graphisme de la
   référence ; DA nuit/magenta, typographie logo, photos authentiques uniquement.
8. **Régression introduite ?** Aucune détectée : suite complète verte à chaque lot,
   E2E complet 12/12 relancé deux fois, mesures du menu inchangées. Une instabilité
   connue a resurgi une fois (`cartiz.test.ts`, passé seul et aux relances) : sans lien
   avec ce chantier, déjà consignée les 11–12/11.
9. **Qu'est-ce qui empêche encore l'excellence ?** (a) animations non vues en mouvement ;
   (b) pas de purge : les commandes (et leurs secrets) s'accumulent dans `meta` et dans
   les sauvegardes ; (c) onglet « Cuisine » visible même module désactivé ; (d) écran
   Réglages « Commande à table » jamais capturé connecté (vérifié par tests seulement) ;
   (e) commutateur de langue (bloqué par un test existant — hors périmètre sans
   autorisation) ; (f) Asian Home doit enregistrer son menu pour que la commande ait des
   plats (action commerçant, pas du code).
10. **Plus de valeur au cycle suivant ?** Dans l'ordre : purge des commandes anciennes
    (hygiène + sauvegardes, petit et testable) ; captures AVEC animations + corrections
    des défauts vus ; capture des Réglages commande connecté ; masquage de l'onglet
    Cuisine si le budget bundle le permet (sinon abandon documenté).

---

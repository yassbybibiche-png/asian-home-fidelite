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

## Cycle 2 — construit (lot 4 + micro-lot 5)

- **Purge des commandes** (lot 4) : conservation 30 jours, purge opportuniste à la
  création (au plus une fois/24 h par commerce, jamais bloquante), entrée d'index de
  purge écrite à la création ; les clés d'idempotence orphelines (commande disparue)
  sont désormais traitées comme libres au lieu d'un 409 éternel ; ordre d'écriture
  durci (commande avant sa clé). 9 tests, 12 mutations détectées.
- **Onglet « Cuisine » masqué** quand le module est désactivé (barre bureau + écran
  Plus) ; `#/cuisine` reste atteignable par URL avec son écran explicatif. Bundle :
  483 925 → 484 018 o.
- **Animations vues en mouvement** (lot 4, captures Playwright SANS mouvement réduit) :
  cascade de l'accueil complète et propre dans tous les cas de défilement ; marquee du
  rail « En photos » ≈ 56 px en 2 s ; fondu de catégorie au défilement complet ; page
  commande **identique octet pour octet à 2 s d'intervalle** (aucune animation
  décorative — prouvé, pas seulement affirmé). Réglages commande et cuisine capturés
  connectés pour la première fois ; aucun défaut visuel concret vu.
- **Micro-lot 5** : piège des deux « Enregistrer » levé — aide permanente en tête de la
  section commande + avertissement persistant « modifiée, pas encore enregistrée » qui
  contredit le faux retour de la barre générale. Bundle inchangé.
- **Totaux finaux : 1666/1666 tests unitaires, E2E 12/12 (relancé au lot 4), bundle
  initial 484 018 o (plafond 484 422 o, marge 404 o), CLS mesuré 0 (cycle 1).**

## Cycle 2 — critique (10 questions, coordinateur)

1. **Visuellement meilleur ?** À périmètre visuel constant (cycle d'hygiène et de
   preuve) ; le doute du cycle 1 est levé : les animations existent en mouvement et
   sont propres — en laboratoire, sur Pixel 7 simulé.
2. **Parcours client plus simple ?** Inchangé côté client ; côté commerçant, oui :
   onglet cuisine pertinent seulement quand le module vit, et fin du faux retour
   d'enregistrement des tables.
3. **Animations fluides ?** Mouvement constaté et régulier sur captures espacées ;
   **images/seconde non mesurées** (environnement sans écran) — la fluidité sur
   appareil réel reste « à vérifier » lors de la validation sur staging.
4. **Menu plus agréable ?** Inchangé ce cycle (traité au cycle 1, mesures stables).
5. **Commande plus rapide ?** Inchangé ; la purge et les finitions ne touchent pas le
   chemin d'action.
6. **Performances préservées ?** Oui : bundle 484 018 o sous le plafond ; aucun
   changement sur les pages publiques clientes hors chunks différés.
7. **Identité respectée ?** Oui : aucun apport visuel extérieur ce cycle.
8. **Régression ?** Aucune : suite complète verte à chaque lot (1663 puis 1666),
   E2E 12/12 au lot 4, mutations toutes détectées (12/12 au lot 4).
9. **Qu'est-ce qui empêche encore l'excellence ?** Des points hors code ou bloqués,
   pas des défauts du code livré : commutateur FR/EN sur les nouvelles pages (test
   existant — autorisation requise) ; 70 plats sans photo (restaurant) ; menu d'Asian
   Home à enregistrer par le commerçant avant activation ; validation humaine sur
   appareil réel ; quelques lignes `meta` d'idempotence pré-cycle 2 devenues
   orphelines (leur commande n'existe plus, elles sont traitées comme libres —
   volume négligeable, non supprimées faute de balayage possible des clés).
10. **Plus de valeur ensuite ?** La validation de l'utilisateur sur le staging, puis
    l'activation réelle chez Asian Home (menu enregistré, tables créées, QR imprimés,
    essai en salle). Côté code, les gains pertinents et vérifiables **plafonnent** :
    **arrêt de la boucle après le cycle 2**, conformément au master prompt.

---

---

# Cycle 3 — Animations « niveau Ciao », descriptifs complets, activation (13/11, soir)

Déclencheur : retour de l'utilisateur sur le staging — « Je ne retrouve pas les animations de Ciao Kombucha du
tout — active-moi la commande et remplis tous les descriptifs correctement, je veux que tout soit bien animé. »
Branche `experience/cycle3-animations-activation` (base `autonome/integration`, 1666/1666 au départ). Production
intouchée pendant les lots 1 à 3 ; le lot 4 (déploiement + activation production) fait l'objet d'une autorisation
explicite séparée, reçue le 13/11 à 20:47, et d'une section dédiée ci-dessous.

## Lot 1 — Passe animations sur les surfaces Découverte (#/bienvenue, #/menu)

Commit 935e774. Périmètre strict : Bienvenue.tsx, MenuPublic.tsx, src/index.css, nouveaux modules
`src/lib/parallaxe.ts`, `src/lib/bandeau.ts`, `src/components/BandeauDefilant.tsx` (importés uniquement par les
deux pages différées) et `tests/experience-cycle3.test.ts` (+15 tests, **aucun test existant adapté**). Commande,
Cuisine, Jouer et écrans commerçant : inchangés.

Ajouts : deux bandeaux défilants continus sur l'accueil (plats signatures, 36 s linéaire, piste dupliquée sans
couture, pause au survol ; familles de la carte avant la section finale, sens inverse) et un sur le menu (noms des
plats photographiés, avant le rail) ; deux pastilles photo flottantes aux coins du héros (lévitation ±8 px, 6 s et
7,5 s) ; ken burns 16 s (scale 1 → 1,07) sur les photos « moment » et les en-têtes de catégorie ; parallaxe léger
(±28 px, force 0,12, rAF + écouteur passif, cadres avec marge) sur le héros et les en-têtes photo ; titres
« moment » qui glissent en scène avec leur révélation ; cartes plats révélées en cascade (60 → 240 ms selon le
rang, en CSS `:nth-child` pour ne pas casser la forme du `<li>` épinglée par les tests) ; micro-interactions
(onglets `active:scale-95`, carte plat `active:scale-[0.99]`, boutons de l'accueil enfoncés à 0,96 via la classe
locale `presse`). Mouvement réduit : tout est coupé (bloc `prefers-reduced-motion` étendu, parallaxe inactif) —
vérifié au navigateur : 0 animation sur l'accueil en `reduce`.

**Preuves (coordinateur, même protocole que le cycle 1 — Pixel 7 simulé, Slow 4G + CPU ×4, 2 passes, même
session)** : mesures labo avant → après. Menu : FCP 696/672 → 692/692 ms ; LCP 2428/2396 → 2440/2368 ms ; CLS 0
des deux côtés. Accueil : FCP 668/668 → 720/716 ms (+~50 ms : les deux vignettes du héros et le bandeau entrent
dans le premier écran) ; LCP 1864/1884 → 1920/1932 ms (≤ 2,5 s). Page Commande (témoin non touché) : stable à
la mesure près. Bundle initial : 484 018 → **484 017 o** (plafond 484 422) — tout le nouveau JS vit dans les
chunks différés. Captures avant/après (même script, animations activées) : animations Web Animations en cours
7 → 14 sur l'accueil (ajouts : flottement ×2, bandeau-defilement ×2, ken-burns ×3), 16 → 27 sur le menu ; rail
photos toujours à +56 px/2 s ; largeur document 412/412 partout (aucun débordement). Critique du coordinateur :
diff relu ligne à ligne ; 3 mutations (borne du parallaxe retirée, `.bandeau-piste` hors du bloc mouvement
réduit, durée du bandeau 36 s → 10 s) **toutes détectées** par les nouveaux tests, fichiers restaurés. Points
faibles assumés : le bandeau du menu se fond dans le fond nuit (il se lit par sa typographie) ; pastilles du
héros non capturées sur écran de moins de 600 px de haut ; fluidité (images/seconde) toujours non mesurée dans
cet environnement ; Playwright juge les en-têtes animés « instables » pour ses clics (effet d'outil, pas
d'utilisateur — la suite E2E reste 12/12).

## Lot 2 — Carte officielle + 81 descriptifs (staging)

Avant : le menu **enregistré** du commerce Asian Home de staging comptait 81 plats mais 32 descriptions
seulement (le public affichait le repli). Payload construit depuis `menuReelAsianHome()` (16 catégories,
81 plats) + `node_modules/.cache/cycle3/descriptions.json` : un texte par plat, ≤ 300 caractères (limite de
`validerMenu`), rédigé **uniquement** à partir du nom du plat et de la composition standard qu'il désigne —
aucun ingrédient ajouté au-delà du nom, aucune affirmation d'allergène, aucun nom ni prix touché (contrôle
automatisé avant envoi : 81/81 présents, 0 texte > 300 car.). Le modèle de données n'a **pas** de champ de
description EN (grep `descriptionEn` : 0 occurrence dans src/ et server/) → français seulement. Les textes déjà
riches de la carte (Dynamite, Poke Bowl, Love Bao, spécialités…) sont repris tels quels ; les talons (« 4
pièces. », « Fait maison. », « Cru ou épicé. ») sont remplacés par des descriptions complètes.

**Incident, rapporté tel quel** : les deux premiers PUT ont dépassé les délais clients (300 s en fetch, 600 s en
curl) sans aboutir — vérifié par GET après chaque échec (toujours 32 descriptions, aucune écriture partielle).
Bissection : le même payload complet est accepté en 1,3 s par un commerce jetable créé pour le diagnostic
(« Probe Cycle3 », `c-mwfe1fnk-uf6q`, toujours présent sur le staging, commande inactive) ; PATCH Asian Home :
200 en 2,0 s ; PUT du menu alors enregistré (contenu inchangé) : 200 en 0,9 s. Le PUT réel a ensuite réussi en
moins de 3 s. Cause exacte non établie — l'hypothèse la plus cohérente est un état transitoire de l'instance
fraîchement redéployée, la première requête étant restée bloquée côté serveur (la création du commerce probe,
concurrente, a elle-même pris 55,6 s avant de redevenir instantanée). **Vérification finale : GET public —
81 plats, 81/81 descriptions non vides, 0 dérive nom/prix par rapport à la carte officielle.**

## Lot 3 — Activation de la commande (staging) et parcours complet réel

PATCH commerçant : `commande.active = true`, tables « Table 1 » à « Table 8 » créées, jetons générés par le
serveur (conservés dans `node_modules/.cache/cycle3/tables-staging.json`). Fiche publique : `commandeActive =
true` ; résolution publique du jeton de la Table 3 : 200 `{ table: "Table 3" }`.

Parcours de bout en bout **sur le staging déployé** (API, mêmes appels que l'écran cuisine et la page de
commande) : POST commande sur la Table 3 (1× Pad Thaï avec instruction « Peu épicé, sans arachide. » + 2× Bubble
Tea, instruction générale « Commande de démonstration (cycle 3). ») → **201**, commande
`6fe3713f-1681-44f8-8cf9-77f1ed4137bd`, total **2 390 centimes** (13,90 € + 2 × 5,00 €, recalculé par le
serveur depuis le menu enregistré). Renvoi de la même clé d'idempotence → `doublon: true`, même identifiant
(aucune commande en double). Liste cuisine (PIN commerçant) : la commande est visible, statut `recue`,
instructions présentes. Transitions commerçant `acceptee` → `en_preparation` → `servie` : 200 à chaque fois, et
le suivi client (secret de commande) reflète chaque statut dans la foulée. Aucune commande créée ailleurs que
sur le staging ; le staging reste en état de démo prête (une commande de démonstration servie, visible en
cuisine du jour).

---

## Lot 4 — Déploiement et activation en PRODUCTION (autorisation explicite de l'utilisateur, 13/11 20:47)

Ordre imposé : sauvegarde d'abord, fusion master, menu + descriptifs, activation, UNE commande test contrôlée.

**1. Sauvegarde production (avant tout changement).** `GET /admin/sauvegarde` (admin) : 200 en 2,4 s, archive
`asian-home-sauvegarde` v1 du 13/11/2026 19:50 UTC, **non chiffrée** (la clé de chiffrement n'est pas posée dans
l'environnement production — le serveur l'a signalé ; archive conservée hors dépôt, dans
`node_modules/.cache/cycle3/sauvegarde-prod-avant-lot4.json.gz`, 5 372 octets). Comptages vérifiés, compteurs
cohérents avec les lignes (0 incohérence) : meta 3, commerces 1, clients 4, tirages 4, avis 0, equipe 0,
journal 5, menus 1, parrainages 0, demandes_rattrapage 1, sessions_revoquees 0, tentatives_auth 0, envois 0,
evenements_jour 3, compteurs_publics 0 — **22 lignes au total**.

**2. Fusion et déploiement.** `autonome/integration` fusionnée (`--no-ff`) dans `master` : `608752f → 71b3d42`,
push ; l'arbre déployé est identique à l'octet près à l'arbre testé (diff integration ↔ master : 0 fichier).
Render a redéployé : nouvel asset **`index-BuSbPAP7.js`** — le même hachage que le staging (construction
déterministe du même arbre). Santé : 200, Supabase, migrations 4/4, Brevo en mode test. Contrôles sans
régression sur les données publiques existantes : fiche commerce 200, menu public 200 (81 plats, encore 32
descriptions à ce stade), règlement du jeu 200, carte d'un client existant 200. La route cuisine répond
désormais 200 (0 commande) là où elle valait 404 avant la fusion.

**3. Menu et descriptifs (production).** Même payload que le staging (même fichier, descriptifs identiques).
Le premier PUT a dépassé 240 s sans aboutir (état revérifié : 32 descriptions, rien d'écrit) — même signature
que l'incident du lot 2 ; la même séquence de déblocage (PATCH sans effet 1,2 s, PUT du menu actuel 0,7 s) a
rétabli des écritures immédiates, puis le PUT réel : **200, vérification 81 plats / 81/81 descriptions /
0 dérive nom-prix**. Les prix non confirmés (Riz Thaï, Maki Gold) restent `null` → « Prix sur place », comme en
staging ; rien n'a été tranché à leur place.

**4. Activation (production).** PATCH : `commande.active = true`, tables « Table 1 » à « Table 8 » (+ table
« TEST » temporaire, voir §5) ; fiche publique `commandeActive = true`. Après l'essai, la table TEST a été
retirée par un second PATCH renvoyant les jetons des tables 1 à 8 (**préservés à l'identique**, vérifié) :
configuration finale = module actif + tables 1 à 8, ancien jeton TEST en 404.

**5. Commande test unique — ÉCHEC PARTIEL, rapporté tel quel.** Une seule commande créée, sur la table TEST :
`01c587bf-5457-43a9-9a2d-dffa44fa0da5`, 1× Pad Thaï, total **1 390 centimes** recalculé par le serveur,
instructions « TEST — ne pas préparer », visible en cuisine au statut `recue`. **La transition
`recue → acceptee` renvoie 409** (« La commande vient d'être modifiée par ailleurs ») — deux essais espacés,
même résultat ; la commande reste donc `recue`, seule commande du jour en cuisine, étiquetée TEST. Diagnostic
mené sans forcer : la commande est unique et sa donnée intègre (dump meta : 8 lignes, aucune cle en double) ;
la valeur stockée (373 caractères) est **structurellement identique** à une commande jumelle créée sur le
staging pour le diagnostic (même plat, mêmes instructions avec tiret cadratin) qui, elle, enchaîne les trois
transitions en 200. Le défaut est donc spécifique à l'environnement production : l'UPDATE conditionnel du CAS
(`majMetaSi` : `update … eq('valeur', <valeur lue>)` via PostgREST) n'y matche aucune ligne, alors que la
lecture de la même valeur réussit. Cause racine non identifiable de l'extérieur — pistes à vérifier dans le
tableau de bord Supabase du projet production (type exact de la colonne `meta.valeur` et son histoire depuis la
0001, version de PostgREST, journaux PostgREST au moment d'une transition). **Aucun contournement appliqué**
(pas d'écriture directe en base, pas de nouvel essai en boucle) conformément à la règle « ne force jamais ».
Conséquence concrète : en production, une commande client peut être CRÉÉE et lue (cuisine, suivi) mais ses
transitions de statut échouent pour l'instant ; le parcours complet reste prouvé de bout en bout sur le staging
(lot 3) et en E2E locale. À corriger avant l'usage en salle ; la commande TEST se fermera (acceptée →
préparation → servie) dès le correctif en place.

---

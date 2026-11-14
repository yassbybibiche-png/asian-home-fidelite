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

**6. FIX-409 — corrigé et prouvé le soir même (13/11).** Diagnostic par élimination sur données réelles :
les valeurs production et staging, comparées octet par octet, sont deux chaînes canoniques de 373
caractères ; avec une colonne `text`, l'UPDATE conditionnel ne peut pas matcher 0 ligne sans écriture
concurrente (exclue). Cause : dans le projet Supabase de **production**, `meta.valeur` est `jsonb` (projet
créé le 09/11 avant la 0001 actuelle, qui la définit en `text` ; le projet test, créé le 11/11, est en
`text`) — PostgREST y convertit le littéral du filtre `eq` en jsonb : le texte JSON relu devient un objet,
jamais égal à la chaîne stockée. Correctif code seul, sans migration (`majMetaSi`, adaptateur Supabase) :
0 ligne ou 22P02 → relecture ; si la valeur est toujours celle attendue, réessai avec la forme
JSON-encodée de la chaîne ; sinon conflit réel, `false`. Le faux PostgREST apprend le mode
`metaValeurJsonb` ; sans correctif, le 409 exact de production se reproduit en local ; 3 mutations de
contre-épreuve détectées ; suite complète **1684/1684**. Déployé (staging vérifié sans régression, puis
production `69e2143`) ; sauvegarde ciblée avant écriture ; la commande TEST est passée
`recue → acceptee → en_preparation → servie` par les vraies routes (200/200/200) — **le parcours commande
complet est prouvé en production**, 0 commande en attente. Détail : `FIX-409-RAPPORT.md`.

---
## 7. Recommandations 1, 3, 4 (13/11 au soir) — instants + heures creuses actifs, jeu par table, écran vitrine

Extension validée par l'utilisateur à 21:09, dans la foulée du FIX-409, déploiement production autorisé.
Détail complet : `RECOMMANDATIONS-RAPPORT.md`. En résumé :

- **R1** : le règlement généré couvre désormais les instants gagnants et les heures creuses (paragraphes
  FR/EN conditionnels en section 4, aucune fuite des réglages — 6 tests). Puis activation en production,
  répétée d'abord sur le staging, avec sauvegarde et diff strict avant/après : lot « Mochi offert »
  `instantsParJour: 2`, lot « Thé glacé maison offert » `heuresCreuses: true`, créneaux lundi–jeudi
  15:00–18:00. Probabilités et plafonds (10) inchangés, vérifiés par le diff. Fiche publique un vendredi
  soir : le lot heures creuses est absent de la roue et `bonusCreux` absent — comportement conçu.
- **R3** : `#/jouer/<id>/<jetonTable>` — le serveur résout la table depuis le jeton (jamais un nom du
  client), le tirage porte `table`, pastille « 🍽 table » sur la page de jeu, lien « Jouer et gagner »
  depuis la page de commande, bouton « Copier le lien du jeu » dans les Réglages, carte « Parties par
  table (aujourd'hui) » au tableau de bord. 12 tests ; vérifié en réel sur le staging (tirage stocké
  `table: 'Table 3'`, jeton inconnu ignoré). Bundle initial : 484 379 o, marge tombée à 43 o.
- **R4** : `#/vitrine/<commerceId>` — TV en salle : vues Roue / Gains / Plats en rotation 12 s, données
  rechargées toutes les 60 s, QR « Scannez pour jouer » permanent, nouvel endpoint public
  `GET /commerces/:id/derniers-gains` (8 derniers lots physiques sur 30 jours, `{ prenom, lot }`
  seulement). 8 tests ; les deux seules adaptations de registres autorisées (pages sombres, pages
  différées). Bundle ramené à 484 259 o (marge 163 o) par déplacement de classes d'App.tsx vers le CSS.
  Captures 1920×1080 relues (un QR assombri par le thème sombre a été corrigé). En production,
  l'endpoint rend déjà les vrais gains (« Thé glacé maison offert », prénoms seuls).

Suite finale : **1710/1710** (114 fichiers). Aucune probabilité, aucune règle, aucun prix touchés ;
aucun envoi réel ; aucune dépense.

---
## 8. Boucle animations (13/11 au soir) — Découverte (#/bienvenue, #/menu)

Ordre de l'utilisateur (21:11) : Claude Code à fond sur les animations, en boucle ; consigne
additionnelle (21:36) : s'inspirer des meilleurs concurrents. Rapport de boucle tenu dans
`ANIMATIONS-BOUCLE-RAPPORT.md` ; vidéos dans `captures-animations/`.

### Inspiration concurrents (passe préalable au cycle 1)

Catalogue complet dans `ANIMATIONS-BOUCLE-RAPPORT.md` (méthode : pages publiques par extraction de
texte + documentation des éditeurs ; le mouvement n'est pas observable par extraction — limite
assumée, comme pour Ciao). En résumé : Ciao (univers par saveur), Drimify (roue 3D cinématique,
geste et révélation), menus « vivants » Menu.AI/CartaNova (une animation par plat), Socialshaker
(habillage par thème), Hey Pongo (actes numérotés), Fideliz (rail à défilement), SpinLocal/SpinDine
(parcours en étapes, révélation), Qualifio (roue décorative d'accueil). Principes uniquement.

Manques chez nous, par visibilité : (1) aucune transition d'univers par catégorie dans le menu ;
(2) titres de catégorie statiques ; (3) rail photos sans inertie ; (4) pas de plat-star plein cadre
au défilement ; (5) aucune transition de page. Vidéo de l'état actuel : `captures-animations/avant.webm`.

### Cycle 1 — « Univers par catégorie » (menu Découverte) — référence : Ciao Kombucha

Signature : l'ambiance du menu change avec la famille de plats affichée. Deux calques fixes derrière
le contenu se croisent en opacité (900 ms) ; 6 univers sombres (magenta de base, braise, vert nuit,
bleu encre, ambre, prune) attribués par rang de catégorie (stable, hors recherche) ; l'en-tête de la
catégorie active se pose (scale 1,04 → 1) et sa photo zoome très lentement (20 s) tant qu'elle est
active. Branche `anim/cycle1-univers` (749b60a) ; logique pure dans `src/lib/univers.ts`, palettes en
CSS. Vidéos : `captures-animations/avant.webm` → `captures-animations/cycle1.webm`.

Critique aux 10 questions :
1. **La signature est-elle visible dès le premier défilement ?** En vidéo, oui : la teinte de fond
   fond d'un univers à l'autre au passage des catégories. En capture fixe, elle est discrète — les
   cartes couvrent presque tout l'écran, les halos vivent aux bords.
2. **Le mouvement sert-il le contenu ?** Oui : il signale le changement de famille avant même qu'on
   lise le titre, et il ne distrait pas de la lecture des plats.
3. **L'identité est-elle intacte ?** Oui : noir dominant partout, univers 0 = magenta de la maison,
   aucune couleur de texte touchée.
4. **Performance ?** Bundle initial inchangé (484 259 o), CSS +1 969 o. FCP menu 692–704 ms ; CLS 0
   (mesuré, animations actives et mouvement réduit) ; LCP 2 368–2 524 ms au calme — l'élément LCP est
   la photo du héros, intacte : c'est le niveau de la baseline (2,4–2,6 s selon la charge, déjà
   frontalier avant la boucle), le cycle ne le dégrade pas.
5. **Mouvement réduit ?** Tout est coupé (fondu instantané, ni pose ni zoom), couvert par les tests
   et vérifié en Chromium.
6. **Charge mentale ?** Aucune interaction ajoutée ; le défilement reste le seul geste.
7. **Le gain est-il net par rapport à l'avant ?** Réel mais modéré : la page « respire » d'une
   famille à l'autre, sans le plein cadre photo de Ciao. DA menu Découverte : 8,6 → 8,9/10 (pas plus :
   l'intensité n'y est pas encore).
8. **La référence est-elle atteinte ?** Le principe Ciao (un univers par famille) est là ; son
   intensité (visuel géant qui EST l'univers) reste le manque n°1.
9. **Risques ?** Contraste : halos ≤ 0,46 d'opacité, le texte le plus faible garde ≥ 4,5:1 sur la
   teinte la plus claire (ambre) — documenté dans le CSS. Le ken burns permanent des en-têtes inactifs
   du menu est retiré (seul l'actif zoome) : moins de mouvement parasite, choix assumé.
10. **Que manque-t-il encore ?** Des titres de catégorie à la hauteur de l'ambition (typo géante
    cinétique) et un plat-star plein cadre. → Cycle 2 : typographie cinétique des « moments ».

### Cycle 2 — « Typographie cinétique des moments » (menu Découverte) — références : Ciao Kombucha, Drimify

Signature : les titres des en-têtes « moment » deviennent géants et entrent en scène. Titre en
`clamp(2,6 rem, 13 vw, 4,6 rem)` plafonné par le plus long mot (`--lettres` + `cqw` : aucun mot ne
déborde), révélé mot à mot depuis un masque (`translateY(130 %) → 0`, 0,7 s, 70 ms d'écart) par le
mécanisme `data-revelation` existant (aucun nouvel observateur) ; mot fantôme géant en creux
(contour blanc 38 %) qui dérive lentement (20 s) derrière le titre — il reprend la ligne
`titre-logo` épinglée par les tests, qui change de rôle sans changer de texte. En-têtes sans photo :
calque mot à mot à taille inchangée posé sur le h2 (transparent via `:has()`, repli = h2 visible).
Cadre h-56 inchangé. Branche `anim/cycle2-typo` (278e0d9) ; logique pure dans
`src/lib/titreCinetique.ts`. Vidéos : `captures-animations/cycle1.webm` → `cycle2.webm`.
Relecture coordinateur : diff lu ligne à ligne, suite relancée en entier (1736/1736), typechecks
front et serveur, 2 mutations de contre-épreuve détectées (masque à 0 %, fantôme renommé).

Critique aux 10 questions :
1. **La signature est-elle visible dès le premier défilement ?** Oui : le premier « moment »
   (Entrées thaï, Maki…) affiche un titre de ~54 px qui monte mot à mot, fantôme en creux au-dessus.
   En capture fixe, le saut de taille est évident (24 px → ~54 px) ; le mouvement se juge en vidéo.
2. **Le mouvement sert-il le contenu ?** Oui : la révélation orchestre l'arrivée de chaque famille,
   dans le même esprit que le fondu d'univers du cycle 1 ; le fantôme reste un décor (contour seul,
   jamais de remplissage) et ne concurrence pas le titre.
3. **L'identité est-elle intacte ?** Oui : serif maison (`font-titre`), blanc sur photo, noir et
   magenta inchangés ; aucun nom, prix ou texte de plat touché ; le h2 sémantique est intact.
4. **Performance ?** Bundle initial inchangé (484 259 o, le nouveau module vit dans le morceau
   différé du menu) ; CSS +~2 Ko. A/B même fenêtre : FCP menu 692–700 → 712–716 ms, LCP
   2412–2432 → 2440–2448 ms — le témoin `#/jouer`, intouché, dérive du même ordre dans la même
   fenêtre : bruit de charge, pas de régression attribuable. CLS 0 mesuré, mouvement normal et réduit.
5. **Mouvement réduit ?** Tout est coupé : mots affichés d'emblée, fantôme immobile ; bloc du cycle
   placé avant le dernier bloc `prefers-reduced-motion` (garde épinglée par les tests) ; vérifié en
   Chromium.
6. **Charge mentale ?** Aucune interaction ajoutée ; la révélation se joue une fois par en-tête.
   Les en-têtes déjà à l'écran au chargement ne s'animent pas (patron existant des révélations,
   assumé : pas de clignotement).
7. **Le gain est-il net par rapport à l'avant ?** Net, et supérieur à celui du cycle 1 : le manque
   n°1 (l'intensité) est traité sur les moments photo. DA menu Découverte : 8,9 → **9,2/10**. Pas
   plus : le cadre reste à 224 px (pas le plein cadre de Ciao), les catégories sans photo gardent un
   en-tête compact, et le plat-star manque toujours.
8. **La référence est-elle atteinte ?** Le principe typographique de Ciao (immense, mis en scène)
   est là, à l'échelle d'un cadre de liste ; son plein écran reste à conquérir.
9. **Risques ?** Le fantôme en contour blanc s'efface sur les photos claires (décor : acceptable) ;
   le plafonnement par `cqw` repose sur un facteur de chasse de 0,8 vérifié en capture sur les pires
   cas (« Boissons », « Desserts », « Maki Neige x6 » : aucun mot tronqué ni débordant, page à
   412 px) ; le calque sans photo dépend de `:has()` (repli propre : le h2 seul).
10. **Que manque-t-il encore ?** Le plat-star plein cadre qui vit au scroll. → Cycle 3 : un moment
    plat-star (photo réelle d'un plat photographié en très grand, zoom lent / parallaxe au
    défilement), sans jamais présenter une image générée comme un plat.

### Cycle 3 — « Plat-star plein cadre » (menu Découverte) — référence : Ciao Kombucha (le produit est l'univers)

1. **Problème qui justifie le changement ?** Les cycles 1 et 2 ont habillé les catégories
   (univers, typo géante) mais aucun PLAT n'occupait l'écran : chez la référence, c'est le
   produit lui-même, en très grand, qui porte l'émotion — et nos photos de plats restaient
   cantonnées aux vignettes des cartes.
2. **Qu'est-ce qui change à l'écran ?** Chaque catégorie dont un plat photographié supporte le
   plein cadre reçoit, entre son en-tête et sa liste, un bloc de 62 vh : la photo du plat
   lui-même en plein cadre (parallaxe + zoom lent de la catégorie active, « plongée »
   scale 1,14 → 1 à la révélation via la propriété `scale`, sans conflit avec le `transform`
   de parallaxe), son nom en titre géant révélé mot à mot, description, pastille prix — tout
   le bloc est un bouton qui mène à la fiche du plat. Sur la carte réelle : **Loc Lac** (Plats
   thaï, signature, photo 1109×720) et **Mango Stick** (Desserts, 411×412).
3. **Plus beau ?** Oui, nettement, là où il s'applique : le bloc Loc Lac est le moment le plus
   fort de la boucle jusqu'ici — image nette (agrandissement ×0,72), couleurs pleines, nom
   géant. DA menu Découverte 9,2 → **9,4/10**. Pas plus haut : la couverture est fine (2
   catégories sur 16) pour une raison qui n'est pas du design mais de la matière (question 10).
4. **Plus rapide ?** Mesures dans le bruit (FCP 712–716 ms, LCP 2500–2512 ms contre témoin
   `#/jouer` dérivant autant ; l'élément LCP reste la photo d'en-tête ; les photos stars sont
   chargées paresseusement au défilement). Bundle initial inchangé (484 259 o) ; CLS 0.
5. **Plus accessible ?** Bloc = vrai bouton libellé « Voir le plat : {nom} » ; masqué pendant
   une recherche ; mouvement réduit statique (parallaxe coupée, plongée annulée, contenu
   visible d'emblée) ; la liste de cartes en dessous reste le chemin principal.
6. **Plus crédible ?** La photo est celle du plat nommé — jamais une image d'ambiance déguisée.
   Et le cycle a refusé deux stars plutôt que de les afficher floues (question 7) : la
   crédibilité du plein cadre tient à sa netteté.
7. **Cohérent avec la DA ?** Vocabulaire strictement repris : univers (cycle 1), titre géant et
   masques (cycle 2), parallaxe et ken burns existants, pastilles signature/prix des cartes.
   Nouveauté du cycle, décidée en relecture coordinateur après captures : un **seuil de
   résolution** (`src/lib/platStar.ts`) — une photo n'est éligible que si son agrandissement
   au cadre (recadrage `object-cover` au ratio 0,731, cadre 380×520) reste ≤ ×1,5. Mesuré sur
   les fichiers : Dynamite ×2,31, Poke Bowl ×3,94 et les 7 photos extraites du PDF (×2,3)
   écartées ; Loc Lac ×0,72 et Mango Stick ×1,26 conservées. Une photo de dimensions
   inconnues (commerçant) est éligible par défaut. Un test revérifie les dimensions réelles
   des fichiers contre la table.
8. **Trop complexe ?** Un composant, une fonction pure, 22 lignes de CSS. Le seuil ajoute une
   table de dimensions — assumée et testée contre les fichiers eux-mêmes.
9. **Risques ?** Le doublon star/carte (Poke Bowl) a disparu avec le seuil. Restent : deux
   moments forts mais éloignés dans un long défilement ; la hauteur 62 vh est constante,
   y compris pour une photo presque carrée (Mango : rendu correct en capture). Contre-épreuves
   du coordinateur : seuil porté à ×99 → 6 tests rouges ; classe `.plat-star` renommée →
   2 tests rouges ; suite complète revérifiée 1759/1759.
10. **Que manque-t-il encore ?** Deux choses, par ordre : (a) la MATIÈRE — 9 photos de plats
    sur 11 font ~340 px (extraites du PDF du menu) : le jour où le restaurant fournit des
    photos plus grandes, 9 catégories gagneront leur star sans une ligne de code (le seuil
    les admettra tout seul) ; c'est le même chantier « photos » déjà ouvert côté restaurant.
    (b) Le rail « En photos » de l'accueil est encore un défilement sec sans inertie ni vie →
    cycle 4 : rail vivant (inertie, zoom au centre façon Fideliz, tuiles qui respirent).

### Cycle 4 — « Rail En photos vivant » (menu Découverte) — référence : Fideliz (rail photos vivant)

1. **Problème qui justifie le changement ?** Le rail « En photos » défilait déjà tout seul
   (aller-retour lent, Expérience lot 2) mais restait plat : tuiles identiques en taille et en
   lumière, aucun point focal — l'œil ne savait pas où se poser.
2. **Qu'est-ce qui change à l'écran ?** La tuile la plus proche du centre du rail grandit
   (échelle jusqu'à 1,05) et sa photo passe à pleine luminosité ; les voisines s'atténuent
   progressivement (luminosité jusqu'à 0,82 à une tuile et demie, courbe en cosinus). Le focus
   suit le défilement, automatique comme manuel. Mathématique pure + pilote rAF dans
   `src/lib/railVivant.ts` : actif seulement rail à l'écran, images sautées si le rail n'a pas
   bougé, écritures seulement si la valeur arrondie change, jamais de `scrollLeft` touché
   (`defilerRail` reste le seul conducteur). L'échelle vit sur un conteneur interne de la
   tuile : l'enfoncement tactile du bouton (0,97) se compose avec elle au lieu de l'écraser.
3. **Plus beau ?** Oui, mais c'est le gain le plus discret de la boucle : en capture fixe, un
   « projecteur doux » (tuile centrale ~4 px plus large, franchement plus lumineuse, voisines
   atténuées d'environ 15 %) ; en mouvement, le focus qui glisse se lit nettement mieux.
   Amplitude volontairement retenue : assombrir davantage (0,75) ou grossir plus (1,08)
   rendrait la majorité des photos de plats moins appétissantes pour éclairer une seule
   tuile — la nourriture ne se met pas en pénombre. DA menu Découverte 9,4 → **9,5/10**.
4. **Plus rapide ?** Aucune régression mesurée au-delà du bruit (A/B alterné après/avant :
   FCP 712–884 ms des deux côtés, LCP dominé par la photo d'en-tête et ses valeurs aberrantes
   des deux côtés, témoin `#/jouer` équivalent). Bundle initial inchangé (484 259 o) ;
   CLS 0 — le rail gagne 16 px de hauteur dès le premier rendu (rembourrage anti-rognage de
   l'échelle), donc rien ne bouge après coup.
5. **Plus accessible ?** Ordre de lecture et libellés inchangés, aucune tuile dupliquée ;
   mouvement réduit : pilote inactif, aucune échelle ni filtre posés (vérifié en Chromium).
6. **Plus crédible ?** Les tuiles restent les vraies photos des plats nommés ; l'effet ne
   maquille rien, il hiérarchise.
7. **Cohérent avec la DA ?** Le rail vit désormais au même titre que le bandeau défilant
   juste au-dessus et les univers derrière : la page d'accueil du menu n'a plus de zone morte.
8. **Trop complexe ?** Un module, un effet, un conteneur interne par tuile ; le pilote
   s'arrête hors écran. Contre-épreuves : Claude Code a cassé le pilote de 4 façons pendant
   le développement (garde d'écriture, saut d'image, garde mouvement réduit, arrêt hors
   écran) — ses 12 tests les attrapent toutes ; mutation du coordinateur (amplitude 0,05 →
   0) : 2 tests rouges ; suite complète revérifiée 1771/1771.
9. **Risques ?** Effet subtil en fixe — assumé (question 3). Le pilote écrit transform/filter
   sur 11 tuiles au plus, seulement quand le rail bouge à l'écran : coût négligeable, vérifié
   sans effet sur les mesures.
10. **Que manque-t-il encore ?** Le dernier manque du catalogue d'inspiration : les
    transitions ENTRE pages (accueil ↔ menu en coupe sèche). → Cycle 5 : entrée en scène des
    navigations internes — avec une contrainte dure : jamais au premier chargement (le QR
    d'une table ouvre directement le menu ; son LCP ne doit pas bouger).

### Cycle 5 — « Transitions de navigation » (Découverte) — références : Ciao, Drimify (navigation fluide)

1. **Problème qui justifie le changement ?** Tout l'intérieur des pages vivait (cycles 1 à 4),
   mais le passage accueil ↔ menu restait une coupe sèche : le clic « Découvrir la carte »
   téléportait le client dans le menu, sans continuité.
2. **Qu'est-ce qui change à l'écran ?** Après une navigation interne, la page entrante monte
   de 14 px en fondant (0,28 s, courbe du projet) ; le changement d'onglet du menu rejoue la
   même entrée sur la liste en 0,18 s (jamais sur la frappe dans la recherche). Mécanisme :
   le routeur pose une classe `navigue` sur `<html>` au premier `hashchange`
   (`src/router.ts`) et le CSS n'anime que sous cette classe — l'événement ne se déclenchant
   jamais au chargement, **le premier affichage n'est jamais animé, par construction**. Au
   menu, la cible est le contenu qui suit le calque d'ambiance (`.ambiance-univers + div`,
   la ligne du conteneur étant épinglée par un test du cycle 1) : la couche fixe d'univers
   reste hors de l'animation.
3. **Plus beau ?** La coupe sèche disparaît ; le parcours accueil → menu → catégorie devient
   un enchaînement. Gain réel mais de politesse, pas de spectacle : DA Découverte (menu)
   9,5 → **9,6/10**. C'est le dernier manque du catalogue d'inspiration initial.
4. **Plus rapide ?** Le chargement direct (QR de table) est inchangé par construction —
   preuve par le contrôle navigateur (aucune animation démarrée, aucune classe posée en
   ouverture directe) plutôt que par les mesures du jour, prises dans une fenêtre très
   chargée (FCP 1,1–1,9 s des DEUX côtés, témoin `#/jouer` équivalent : bruit, cité comme
   tel). CLS 0. Bundle initial 484 259 → **484 328 o** (+69 o : la classe du routeur) —
   plafond respecté mais marge réduite à 94 o, point de vigilance pour tout futur cycle.
5. **Plus accessible ?** Page entrante cliquable pendant sa montée (aucun overlay) ;
   mouvement réduit : coupes franches partout (bloc placé avant le dernier bloc
   `prefers-reduced-motion`) ; aucun contenu masqué par défaut.
6. **Plus crédible ?** La transition ne retient ni ne déguise rien : 0,28 s, jamais au
   premier chargement, jamais sur les pages d'action (Commande, Cuisine, Jeu hors
   périmètre).
7. **Cohérent avec la DA ?** Même courbe et même vocabulaire que les révélations existantes ;
   la montée de 14 px fait écho au `translateY` des masques du cycle 2.
8. **Trop complexe ?** Une classe, deux keyframes déjà mutualisées, un petit module
   (`entreeScene.ts`) pour l'onglet. Contre-épreuves : 5 auto-mutations attrapées pendant le
   développement ; mutation du coordinateur (retrait de la garde `.navigue`) : 1 test
   rouge ; suite complète revérifiée 1784/1784 (un premier passage avait échoué sur le test
   du cycle 5 parce que la mutation du coordinateur a chevauché la course de la suite —
   rerun sur arbre propre : 1784/1784).
9. **Risques / écarts assumés ?** Deux, signalés par le développement et arbitrés : (a) au
   tout premier passage vers le menu, le SQUELETTE de chargement apparaît en coupe sèche
   avant que le contenu n'entre en scène — le squelette est partagé avec Commande (hors
   périmètre) et l'animer créerait deux montées successives ; (b) observation PRÉEXISTANTE,
   hors cycle : `#/menu` s'ouvre défilé d'environ 393 px (effet `scrollIntoView` des
   onglets, antérieur à la boucle) — inchangé par le cycle, à traiter séparément si
   l'utilisateur le souhaite.
10. **Que manque-t-il encore ?** Le catalogue d'inspiration initial est épuisé (univers,
    typo, plat-star, rail, transitions). Avant de conclure, la règle de la boucle impose une
    passe d'inspiration fraîche ; si elle ne dégage pas de signature nouvelle à gain net
    plausible sous les portes dures, la boucle s'arrête : les plafonds restants sont
    documentés au rapport (résolution des photos sources, marge de bundle, pas de WebGL
    sous les portes de performance).


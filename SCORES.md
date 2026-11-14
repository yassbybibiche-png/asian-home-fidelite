# SCORES — Mesure initiale avant refonte (P0-U0)

Référence avant/après pour la boucle d'amélioration continue (AUDIT.md §7, P1-U1).
Mesuré le **11/11/2026** sur le commit de `autonome/integration` qui contient P0-S10
(`de63457` + lot P0-U0). **À mettre à jour à chaque lot** — le test
`tests/scores-p0-u0.test.ts` vérifie que les chiffres de bundle ci-dessous correspondent
à un build frais à 5 % près.

**Re-mesure P0-D1 (11/11/2026 ~07:16 UTC, 1 passe)** : thème noir+magenta + correctif
404 en place — captures dans `node_modules/.cache/mesure-p0-d1/` (`jouer.png`, `gain.png`,
`carte.png`, `caisse.png`, `menu.png`, `tableau-de-bord.png`, `clients.png`,
`roulette.png`, `reglages.png`), résultats dans `resultats.json` du même dossier.
Erreurs console : **0** (le 404 jouer → carte a disparu). Les temps de cette passe ne
sont PAS retenus : `npm test` tournait en parallèle sur la même VM (1,5 CPU partagé),
les temps sont donc gonflés (premier affichage `#/jouer` 6,06 s, LCP 6,03 s,
validation caisse 14,9 s) et non comparables aux 5 passes P0-U0.

**Re-mesure P1-D2 (11/11/2026 ~08:00 UTC, 1 passe)** : corps sombres côté client —
captures dans `node_modules/.cache/mesure-p1-d2/` (mêmes 9 écrans + captures
richesse `roue-8-lots.png`, `gain-8-lots.png`, `carte-couleur-perso.png`,
`menu-reel.png`, `menu-reel-complet.png`), résultats dans `resultats.json` du même
dossier. Erreurs console : **0**, 0 requête échouée. Une 1re passe (~07:59 UTC) a
révélé 2 régressions de contraste par les captures (corps de carte sombre, carte de
gain claire) — corrigées avant cette 2e passe (voir § DA après P1-D2).

**Re-mesure P1-U1 (11/11/2026 ~08:45 UTC, 2 passes)** : même protocole que P0-U0
(script `scripts/mesurer-scores.mjs`, Pixel 7, Slow 4G + CPU ×4, serveur local),
sortie `--sortie node_modules/.cache/mesure-p1-u1/resultats-passe<N>.json` (captures
dans le même dossier, 9 écrans, écrasées par la passe 2 — les 2 JSON gardent les
chiffres des 2 passes) ; Lighthouse 2 passes
(`lighthouse-passe1.json`, `lighthouse-passe2.json`). **Aucun changement de code
dans ce lot** : c'est une mesure après refonte, à comparer à P0-U0 (avant refonte)
et à P1-D2 (1 passe). Résultat : temps, taps et DA quasi identiques à P1-D2 —
premier affichage 4 043–4 241 ms, parcours scan → lot 8 727–9 155 ms d'étapes
(taps identiques : client 4 clics + 1 saisie, caisse 3 clics + 2 saisies),
Lighthouse 79/79, 0 erreur console, DA moyenne 8,0/10 inchangée. Le détail chiffré
est dans les sections ci-dessous (« Re-mesure P1-U1 » sous chaque métrique).

**Re-mesure P2-Q2 (11/11/2026 ~11:36 UTC, 2 passes)** : compression gzip/brotli
côté serveur (`server/app.ts`, `envoyerCorps`) + bundle initial sous le seuil de 80 %
(bouché en P2-Q1) — même protocole que P1-U1 (script `scripts/mesurer-scores.mjs`,
Pixel 7, Slow 4G + CPU ×4, serveur local), sortie
`--sortie node_modules/.cache/mesure-p2-q2/resultats-passe<N>.json` (captures dans le
même dossier, 9 écrans, écrasées par la passe 2) ; Lighthouse 2 passes
(`lighthouse-passe1.json`, `lighthouse-passe2.json`). **Premier affichage `#/jouer`
2 285–2 428 ms et LCP 2 272–2 368 ms : les deux seuils sont atteints pour la première
fois** (voir § Temps de premier affichage et § Lighthouse). Aucun changement visuel
dans ce lot : notes DA inchangées (8,0/10), 0 erreur console, 0 requête échouée.
Le détail chiffré est dans les sections ci-dessous (« Re-mesure P2-Q2 » sous chaque
métrique).

## Protocole

- **Appareil simulé** : Pixel 7 (Playwright), `reducedMotion: reduce`, service workers bloqués.
- **Réseau** : Slow 4G (1,6 Mbps down / 750 kbps up, latence 150 ms) + CPU ralenti ×4
  (mêmes réglages que le preset « Slow 4G » de Lighthouse), appliqués à **chaque**
  page mesurée (client, caisse, back-office) via CDP.
- **Serveur** : `tests-e2e/serveur.ts` en local (`http://127.0.0.1:4321`), base SQLite
  temporaire, commerce de test créé par API (lot « Nems offerts » à 100 %, membre
  d'équipe Camille, code `2468`). Jamais la production. Garde-fous : le port doit
  être libre avant le lancement (sinon la mesure s'arrête au lieu de se brancher
  sur un serveur déjà présent), `VITE_API_URL` est forcé à `/` pour le serveur
  enfant, et toute requête navigateur hors de l'origine locale fait échouer la passe.
- **Script** : `node scripts/mesurer-scores.mjs` (5 passes le 11/11/2026, ~06:28 /
  ~06:30 / ~06:36 / ~06:46 / ~06:47 UTC). Les passes 1–3 avaient deux biais
  corrigés aux passes 4–5 : la caisse n'était pas ralentie (validation sous-estimée)
  et le LCP était lu trop tôt ou périmé (voir ci-dessous) — **seules les passes 4–5
  sont retenues pour le LCP et la validation en caisse**. Captures dans
  `node_modules/.cache/mesure-p0-u0/` (`jouer.png`, `gain.png`, `carte.png`,
  `caisse.png`, `menu.png`, `tableau-de-bord.png`, `clients.png`,
  `roulette.png`, `reglages.png`) — les captures back-office ne sont prises que si
  le déverrouillage a réussi (sinon la passe est marquée invalide pour le back-office).
- **LCP** : observateur posé avant la navigation, lecture après 2 s de stabilisation
  (le dernier candidat peut arriver après l'élément attendu), élément LCP enregistré.
  La navigation par hash ne crée pas de nouveau document : le LCP d'une page
  atteinte par hash n'est pas une mesure par page fiable (aucune nouvelle entrée si
  le plus grand élément ne change pas) — le menu est donc aussi mesuré par
  chargement direct (nouveau document).
- **Lighthouse** : `node scripts/mesurer-lighthouse.mjs` (Lighthouse 13.6.0, devDependency
  épinglée, mobile par défaut, serveur E2E local), page `#/jouer` seulement.
  Méthode distincte du script Playwright : Lighthouse applique son propre throttling
  simulé (Moto G Power), pas le ralentissement CDP direct — les deux mesures ne sont
  pas interchangeables.
- **Limites honnêtes** : mesures locales, pas la production Render (le délai à froid
  d'environ 60 s du plan gratuit en veille n'est **pas mesuré**, c'est une estimation).
  Le commerce de test n'a ni logo (bloc initiales « M1 ») ni menu : la capture du menu
  montre l'état vide (« Menu à venir »), pas le vrai menu 81 plats d'Asian Home.
  Pas de mesure sur téléphone réel — à remplacer par la mesure téléphone
  (protocole : même parcours sur le staging, chronomètre + comptage des taps à la main).

## Protocole téléphone réel (P1-U1 — non exécuté sur cette VM, à faire sur staging)

Pas de téléphone réel accessible depuis cette VM ; les mesures disponibles utilisent
un navigateur simulé piloté par Playwright. Pour la mesure téléphone demandée par
l'AUDIT §7, sur le staging (jamais la production) :

1. Téléphone Android ou iPhone, écran 375 px de large, réseau 4G (désactiver le Wi-Fi),
   cache et données du navigateur effacés avant la passe à froid.
2. À froid : ouvrir le QR (ou le lien `#/jouer/<id>`) et chronométrer jusqu'au titre
   visible, puis jusqu'au gain affiché ; noter chaque tap (1 tap = 1 toucher,
   1 champ rempli = 1 saisie) et chaque seconde d'attente humaine entre le scan
   client et la validation en caisse.
3. À chaud : refaire le même parcours sur le même téléphone et le même navigateur,
   sans effacer le cache, avec un second compte de test (le cache du téléphone n'est
   réchauffé que sur le téléphone qui a servi à la passe à froid).
4. Noter séparément : premier affichage, inscription, validation caisse, vérification,
   tirage, ouverture de la carte — mêmes étapes que le script local, pour comparer.
5. Relever les erreurs console via le navigateur distant (Chrome DevTools USB) ou,
   à défaut, noter tout écran blanc / blocage visible.

## Bundle (build frais, mode par défaut, 13/11/2026 — Expérience 10/10 lot 3)

Définition unique : **JS initial non gzipé** = script d'entrée de `index.html` +
ses imports statiques (méthode `fichiersInitiaux` de
`tests/performance-bundle-p2-q2.test.ts`, pas les `import()` dynamiques) ;
**CSS** = la feuille de `dist/assets` ; **total** = JS initial + CSS.
**Les chiffres de cette section sont les chiffres courants** : le test
`tests/scores-p0-u0.test.ts` lit la PREMIÈRE occurrence de chaque chiffre et la
compare à un build frais à 5 % près (chunks : égalité stricte). La section de
référence P1-U1 est conservée verbatim juste après (titre et chiffres), comme
archive historique — le test `tests/mesure-p1-u1.test.ts` y lit ses chiffres
figés ; elle ne doit pas être modifiée.

- JS initial non gzipé : 484259 o (472,9 Ko) — `index-DFmCUAA0.js` 371198 o +
  `ui-DpOMk5ax.js` 104092 o + `jsx-runtime-C3cWAN_r.js` 8243 o +
  `rolldown-runtime-XKyaHtl9.js` 726 o.
- CSS non gzipé : 95986 o (93,7 Ko) — `index-CNWKfiZU.css`.
- Total initial : 580245 o (566,6 Ko).
- JS total (tous chunks) : 927865 o (906,1 Ko) ; 32 chunks ; plus gros chunk : 371198 o
  (limite test : 500 000 o — respectée).
- Recommandation R4 écran vitrine (13/11/2026) : JS initial 484379 o → 484259 o (−120 o). Coût de la vitrine
  +272 o (page `vitrine` au routeur, import différé, registres des pages publiques différées et sombres, méthode
  `derniersGains` du client API) ; récupéré 402 o en déplaçant en `@apply` (`src/index.css`, rendu identique) les
  classes de l'en-tête, du cadre, du bandeau hors ligne et de la barre basse d'App.tsx (plafond 484422 o inchangé,
  marge 163 o). Nouveau fichier différé : `Vitrine` (~4,4 Ko). CSS +3 815 o (règles `@apply` et classes de la vitrine).
- Expérience 10/10 lot 3 (13/11/2026) : JS initial 483644 o → 483925 o (+281 o : page `cuisine` au routeur et au
  registre des pages différées, onglet « Cuisine » de la navigation bureau, entrée sous « Plus », icône ; plafond
  484422 o, marge 497 o). Nouveau fichier différé : `Cuisine` 11 544 o (appels directs, aucune méthode ajoutée au
  client API). `Plus` 4 179 → 4 276 o. CSS +458 o.
- Expérience 10/10 lot 2 (13/11/2026) : JS initial 482531 o → 483644 o (+1 113 o : 3 méthodes du client API de la
  commande à table, 2 pages au routeur et au registre des pages différées, 2 chaînes du menu au dictionnaire initial ;
  plafond 484422 o, marge 778 o). Nouveaux fichiers différés : `Bienvenue` 6 642 o, `Commande` 20 807 o,
  `revelation` 2 935 o (partagé accueil / menu). CSS +5 840 o (animations, révélations, planche d'impression).
- **Plafond du JS initial relevé (déblocage, décision utilisateur du 12/11/2026)** : ancien
  plafond 481376 o (80 % de 601720 o) → nouveau plafond `PLAFOND_BUNDLE_INITIAL` = 484422 o
  dans `tests/performance-bundle-p2-q2.test.ts` (taille mesurée 482374 o + 2048 o de marge,
  ≈ 2 Ko). Le dépassement de l'ancien plafond (+998 o) vient des trois chantiers du déblocage
  (prénom à l'inscription, badge heures creuses, bouton « Voir le menu »). Voir DEBLOCAGE-RAPPORT.md.
- Roue v2 R-t1 (polish visuel) : JS initial 481373 o (après D2, a3e2290) → 481283 o (−90 o ;
  plafond 481376 o, marge 93 o). Les classes utilitaires du pointeur, du titre et des pastilles
  de la légende sont passées en CSS (−200 o de JS), ce qui paie le retournement des libellés de
  gauche et `styleLegende` (teintes du commerce sur la légende). CSS 78932 o → 82135 o (+3 203 o,
  replis `color-mix` générés compris).
- Roue v2 R5+R8 (son, couleur du commerce, roue premium) : JS initial 479360 o → 481300 o
  (+1 940 o) — plafond P2-Q2 481376 o (< 80 % de 601720 o) respecté avec **76 o de marge
  seulement** : le prochain lot qui ajoute du code au premier affichage de #/jouer devra
  d'abord découper (ex. bloc « À gagner aujourd’hui », « Garder ma carte »). Le décor
  premium (anneau, reflet, moyeu, ampoules, rayons, pointeur) est en CSS (+5 843 o de CSS,
  hors plafond JS) ; la synthèse sonore est un chunk à la demande, `sonRoue-*.js` 1278 o
  (+1 chunk), chargé au clic « Tourner ». Mesure « avant » (R4 + revue Codex, 4db69b4) :
  479360 o ; la valeur 478582 o ci-dessous date de R4 avant sa revue Codex.
- Roue v2 (12/11/2026) : après R3 (mesuré au commit f1bf0fd, build frais) JS initial
  470200 o, CSS 71129 o, total 541329 o, JS total 813761 o, 24 chunks, plus gros
  360485 o — soit +15 843 o de JS initial pour R1–R3 (types de lots, moteur v2, cycle
  du gain) depuis la mesure t10 ci-dessous. R4 (écrans client + règlement) : JS
  initial 478582 o (+8 382 o, +1,8 % vs R3 — bloc « À gagner aujourd’hui », écran
  résultat v2, gains et compte à rebours sur la carte, ~25 traductions), total
  549711 o ; 25 chunks (+1 : page différée `Reglement-*.js`, 6958 o — le texte du
  règlement reste hors du bundle initial). Seuil P2-Q2 (< 80 % de 601720 o) : respecté.
- Différé (boucle t1) : `QrCode-D610mFEe.js` 21182 o (`qrcode-generator` + composant),
  chargé à la demande par la carte de fidélité ; `jsx-runtime-CkXRJ162.js` est un
  nouveau fichier partagé sorti par le découpage (runtime JSX, auparavant dans `ui-*.js`).
- Repères historiques : avant P2-Q2 601720 o ; après P2-Q2 450,2 Ko (JS initial).
  Le JS initial a repris ~10 Ko depuis (lots P0-S10 et suivants). Après P0-D1 :
  JS initial 472531 o, CSS 65273 o, total 537804 o — le CSS gagne 4750 o avec les
  règles `.page-client` de P1-D2 (+7,3 %), le JS initial +184 o (+0,04 %).
  Après P1-D2 : JS initial 472715 o, CSS 70023 o, total 542738 o.
  Après P1-U1 (re-mesure, aucun changement de code dans ce lot) : JS initial 472745 o
  (+30 o, +0,01 %), CSS 70664 o (+641 o, +0,9 %), total +671 o vs P1-D2 — cause non
  établie (les lots P0-S11, P1-M2 et P1-M3 sont passés entre les deux mesures, sans
  isolation du bundle par lot). Boucle t0 (baseline, aucun changement de code) :
  JS initial 481332 o, CSS 70766 o, total 552098 o, JS total 801321 o, 22 chunks,
  plus gros 353163 o. Boucle t1 (QR différé) : JS initial 453028 o (−28 304 o,
  −5,9 % vs t0), total 523794 o, JS total 803160 o (+1 839 o — enrobage `lazy` +
  frontière `ErreurQr` + 2 libellés traduits + fichier partagé), 24 chunks, plus
  gros 354742 o (+1 579 o — enrobage `lazy` dans `index-*.js`). Boucle t4 (héros
  WebP) : JS initial 453181 o (+153 o, +0,03 % vs t1 — enrobage `<picture>`
  dans CartePublique + constante `VISUELS.tableSushisPetit`), total 523947 o,
  JS total 803414 o (+254 o), 24 chunks, plus gros 354843 o. Boucle t5 (logo
  du commerce en WebP) : JS initial 453485 o (+304 o, +0,07 % vs t4 — branche
  `<picture>` dans `LogoCommerce` + constante `LOGO_DEFAUT_PETIT`), total
  524251 o, JS total 803736 o (+322 o), 24 chunks, plus gros 354861 o. Boucle t6 (bannière
  de la carte en WebP) : JS initial 453667 o (+182 o, +0,04 % vs t5 — enrobage
  `<picture>` dans `CarteFidelite` + constante `VISUELS.heroPlatsPetit`),
  total 524433 o, JS total 803918 o (+182 o), 24 chunks, plus gros 354995 o. Boucle t7 (bannière
  recadrée) : bundle IDENTIQUE à t6 (JS initial 453667 o, total 524433 o, 24 chunks,
  mêmes noms de chunks — actif seul, aucun JS ; build frais vérifié). Boucle t9 (héros
  recadré) : bundle IDENTIQUE à t6 (JS initial 453667 o, total 524433 o, 24 chunks,
  mêmes noms de chunks — actif seul, aucun JS ; build frais vérifié). Boucle t10 (photos
  paresseuses en WebP) : JS initial 454357 o (+690 o, +0,15 % vs t9 — 6 entrées
  `VISUELS` + `<picture>` dans `CartePublique`/`MenuPublic` + `srcPetit` dans
  `photoCategorie`), total 525123 o, JS total 804719 o (+801 o), 24 chunks,
  plus gros 355234 o. Le bundle documenté ici provient d'un build frais
  distinct de celui servi aux deux passes Playwright (le serveur E2E construit
  son propre bundle).
- Avertissements de build : 0 (aucun « chunk > 500 kB », aucune erreur).

## Bundle (build frais, mode par défaut, 11/11/2026 — après P1-U1)

Définition unique : **JS initial non gzipé** = script d'entrée de `index.html` +
ses imports statiques (méthode `fichiersInitiaux` de
`tests/performance-bundle-p2-q2.test.ts`, pas les `import()` dynamiques) ;
**CSS** = la feuille de `dist/assets` ; **total** = JS initial + CSS.

- JS initial non gzipé : 472745 o (461,6 Ko) — `index-TM4EXuNe.js` 349378 o +
  `ui-DKQTem2F.js` 122768 o + `rolldown-runtime-WkwZ5CU-.js` 599 o.
- CSS non gzipé : 70664 o (69,0 Ko) — `index-DfTpbo0F.css`.
- Total initial : 543409 o (530,7 Ko).
- JS total (tous chunks) : 782164 o (763,8 Ko) ; 22 chunks ; plus gros chunk : 349378 o
  (limite test : 500 000 o — respectée).
- Repères historiques : avant P2-Q2 601720 o ; après P2-Q2 450,2 Ko (JS initial).
  Le JS initial a repris ~10 Ko depuis (lots P0-S10 et suivants). Après P0-D1 :
  JS initial 472531 o, CSS 65273 o, total 537804 o — le CSS gagne 4750 o avec les
  règles `.page-client` de P1-D2 (+7,3 %), le JS initial +184 o (+0,04 %).
  Après P1-D2 : JS initial 472715 o, CSS 70023 o, total 542738 o.
  Après P1-U1 (re-mesure, aucun changement de code dans ce lot) : JS initial 472745 o
  (+30 o, +0,01 %), CSS 70664 o (+641 o, +0,9 %), total +671 o vs P1-D2 — cause non
  établie (les lots P0-S11, P1-M2 et P1-M3 sont passés entre les deux mesures, sans
  isolation du bundle par lot). Le bundle documenté ici provient d'un build frais
  distinct de celui servi aux deux passes Playwright (le serveur E2E construit
  son propre bundle).
- Avertissements de build : 0 (aucun « chunk > 500 kB », aucune erreur).

### Après P2-Q2 (build frais, 11/11/2026 ~11:36 UTC)

- JS initial non gzipé : 480934 o (470,0 Ko) — `index-r19-LNJr.js` 352857 o +
  `ui-Ch5rodkR.js` 127478 o + `rolldown-runtime-WkwZ5CU-.js` 599 o.
- CSS non gzipé : 70722 o (69,1 Ko) — `index-CQ6c7ax-.css`.
- Total initial : 551656 o (538,7 Ko).
- JS total (tous chunks) : 797175 o (778,5 Ko) ; 22 chunks ; plus gros chunk : 352857 o
  (limite test : 500 000 o — respectée).
- **Compressé (serveur, P2-Q2)** : JS initial 480 934 o → brotli 143 901 o (29,9 %),
  gzip 152 485 o (31,7 %) ; CSS 70 722 o → brotli 10 857 o ; total initial 551 656 o →
  brotli 154 758 o (28,0 %). Tous les assets JS+CSS du build : 867 897 o → brotli
  253 375 o (29,2 %), gzip 274 049 o (31,6 %). Le chunk initial (352 857 o) → brotli
  102 097 o ; `index.html` (6 097 o) → brotli 2 032 o.
- Évolution vs P1-U1 : JS initial 480934 o (+8 189 o, dont +1 828 o entre P1-U1 et la
  base P2-Q1 — lots P0-S11, P1-M2, P1-M3 — et +6 361 o nets pour P2-Q1 : dictionnaire
  EN + code, après les déplacements hors bundle initial qui ont économisé 2 241 o) ;
  CSS 70722 o (+58 o) ; JS total 797175 o (+15 011 o vs P1-U1 : 782164 o — les chunks
  différés portent la même croissance, cause non isolée par lot). Le bundle documenté
  ici provient d'un build frais distinct de celui servi aux deux passes Playwright
  (le serveur E2E construit son propre bundle).
- Avertissements de build : 0 (aucun « chunk > 500 kB », aucune erreur).

## Couverture de tests

Suite verte : **1736/1736** (`npm test`, typechecks inclus — 1090 après P2-Q2, +73 tests
P2-Q3 à P2-Q6, +3 tests boucle t1, +4 tests boucle t2, +1 test SW boucle t2, +4 tests boucle t4, +1 test auto (nouvelle entrée VISUELS), +4 tests boucle t5, +3 tests boucle t6, +1 test auto (nouvelle entrée VISUELS), +10 tests boucle t10, +6 tests auto (nouvelles entrées VISUELS), +4 tests correction Codex point 5, +13 tests correction Codex point 11, +8 tests correction Codex point 6, +5 tests correction Codex point 9, +15 tests correction Codex point 10, +4 tests correction Codex point 2, +7 tests correction Codex point 4, +6 tests correction Codex point 7, +3 tests correction Codex point 8, +9 tests revue Codex finale, +2 tests correction Codex point 1, +2 tests correction Codex point 3, +8 tests revue Codex finale points 1-3, +5 tests item B catalogue par défaut, +4 tests auto item C (2 vignettes de galerie : fichiers WebP et entrées VISUELS), +13 tests item D sauvegarde téléchargeable par l'admin, +12 tests item E alerte e-mail sur rafale de 5xx, +6 tests revue Codex nov12 (1/2) délai propre de la sauvegarde, +7 tests revue Codex nov12 (2/2) reprise après échec d'une alerte 5xx, +21 tests roue v2 R1 lots structurés (id + type), +1 test revue Codex R1 (écriture sans type), +17 tests roue v2 R2 moteur de tirage (accès libre, plafonds, limite mensuelle, consolation points), +11 tests revue Codex R2 (tirages sérialisés par commerce, crédit de consolation exactement-une-fois, journée des plafonds à Paris, rattrapage des lotId), +12 tests roue v2 R3 cycle de vie du gain (J+1 à J+30, code burn-on-reveal 10 min), +12 tests revue Codex R3 (code seulement par l'activation, bornes en jours de Paris, anciens tirages sous l'ancienne règle, remise conditionnelle à l'heure de l'écriture ; 2 tests R3 remplacés), +20 tests roue v2 R4 écrans client (lots du jour, règlement généré, gains sur la carte et compte à rebours, écran résultat v2, route publique du règlement), +6 tests revue Codex R4 (compte à rebours sur l'heure du serveur, carte rafraîchie aux bornes de statut, règlement bilingue), +21 tests roue v2 R5+R8 (préférence son par appareil, AudioContext seulement dans le geste et synthèse chargée à la demande, tics depuis l’angle animé et aucun tic en mouvement réduit, couleur du commerce lisible sur toute couleur acceptée, décor premium sur couches fixes animé en opacity/transform seulement, célébration allégée pour des points), +5 tests revue Codex R5+R8 (couper le son tait aussi les notes déjà programmées, mouvement réduit activé en cours de rotation, réactivation du son pendant une partie lancée en muet), +15 tests roue v2 R6 Réglages → Roulette (type / points / plafond par lot, refus front d'un lot « points » sans montant, règles du jeu envoyées et relues, tirage de test de l'aperçu sans réseau ni tirage enregistré), +9 tests roue v2 R7 relance « gain bientôt expiré » (72 h avant la fin de J+30, une fois par tirage, mode test compris, consentement exigé, réglage actif par défaut), +1 test revue Codex R6 (ligne de lot exclue de l'envoi), +8 tests revue Codex R7 (réclamation atomique par tirage, pas de doublon au-delà de 50 envois, statut revérifié avant envoi, échec après réclamation retenté, sandbox e-mail hérité, collision `libre` / gain tracée), +14 tests roue v2 D1 instants gagnants (génération paresseuse persistée dans les plages d'ouverture, fenêtre de 5 min, consommation unique sous concurrence, plafond et limite prioritaires, instant rendu si le tirage échoue, aucun instant futur dans une réponse), +4 tests revue Codex 2 R7 (activation appliquée sur la ligne fraîche sans effacer la réclamation, issue ambiguë après émission = incertain, libération malgré une activation concurrente, expiration revérifiée après la réclamation), +8 tests revue Codex D1 (restitution d'un instant réessayée sur le document frais avec incohérence journalisée en dernier recours, instant préservé quand seul le client est à sa limite, aucun instant dans l'heure inexistante du passage à l'heure d'été), +14 tests roue v2 D3 simulateur de coût et KPI des gains (coût attendu = Σ chance normalisée × coût, coût partiel listé, projection et pire cas des plafonds sans NaN, taux d'utilisation = remis ÷ (remis + expirés) sur tirages v2, bornes identiques à `cycleGain` heure par heure), +12 tests roue v2 D2 créneaux heures creuses (matrice jours / heures avec début inclus et fin exclue en heure de Paris, lot creux absent hors créneau même avec le hasard forcé, consolation doublée et tracée pendant le créneau, `bonusCreux` présent / absent dans la fiche publique, réglages validés ; +1 dans cout-kpi-d3 : règle « lot physique » de la carte des gains réécrite hors bundle initial, égale à `typeTirage`), +6 tests boucle roue v2 R-t1 polish visuel (libellés de gauche retournés, teintes du commerce sur la légende et le cadre avec titre ≥ 4,5:1 pour toute couleur acceptée, émoji du bouton « Tourner » remplacé à l'affichage par un signe CSS sans toucher au libellé), +5 tests revue Codex P1 (relance inactif / anniversaire `incertain` jamais renvoyée même au-delà de 50 envois plus récents, lecture par modèle sans plafond sous SQLite et Supabase), +3 tests déblocage A prénom optionnel dès l'inscription (créé avec prénom, sans prénom, jamais écrasé à la ré-inscription), +1 test déblocage B badge « Bonus heures creuses actif » sur la page de jeu, +3 tests déblocage C bouton « Voir le menu » dans le parcours de jeu et sur la vue limitée de la carte, +1 test déblocage C-bis `menuDisponible` dans la fiche publique GET /commerces/:id, +6 tests menu visuel (photo des grandes cartes et variante WebP du Loc Lac, rail « En photos » dans la source), +1 test auto (nouvelle entrée VISUELS), +24 tests Expérience 10/10 lot 1 commande à table côté serveur (panier recalculé depuis le menu, refus typés, transitions et comparaison-et-échange, idempotence, secret de suivi, isolation entre commerces, jetons de table), +3 tests Expérience lot 1b secret de suivi tiré par le navigateur (format refusé → 400, suivi avec le secret du client seulement, reprise après réponse 201 perdue), +36 tests Expérience lot 2 écrans (panier : bornes, totaux égaux au calcul du serveur, idempotence clé + secret ; révélations au défilement et rail « En photos » ; accueil, menu v2, commande, réglages et case « Indisponible » sur le source ; route publique GET /commerces/:id/tables/:jeton), +18 tests Expérience lot 3 écran cuisine (sections et ordre, actions = transitions du serveur, ancienneté, heure de Paris, jour précédent, pastille « Nouveau » ; enregistrement, navigation, relecture 10 s page visible, conflit = note discrète + relecture, sur le source), +9 tests Expérience lot 4 purge des commandes anciennes (J-31 purgée avec idempotence, index et entrée de purge, J-30 et hier intacts, purge rejouée sans effet, clé orpheline d'avant le lot réutilisable, une fois par 24 h, création jamais bloquée par une purge en échec), +3 tests Expérience lot 4 onglet « Cuisine » masqué module désactivé (bureau, écran Plus, #/cuisine atteignable, sur le source), +3 tests Expérience lot 5 Réglages « Commande à table » (aide en tête de section : la barre générale n'enregistre pas la section, bouton propre et son retour, avertissement « pas encore enregistrée », sur le source), +15 tests Expérience cycle 3 lot 1 animations des surfaces Découverte (parallaxe borné et nettoyé, coupé en mouvement réduit ; bandeaux défilants à deux copies avec mots tirés de la carte réelle ; pastilles flottantes, ken burns, titres « moment » et cartes en cascade, micro-interactions et bloc mouvement réduit, sur le source), +3 tests FIX-409 CAS meta sur colonne `meta.valeur` jsonb (adaptateur : valeur JSON, « nombre » et UUID sous les deux types de colonne, conflit réel toujours refusé ; commande complète sur HTTP en mode jsonb : création puis les trois transitions), +6 tests recommandations R1 règlement (instants gagnants et heures creuses couverts par le règlement généré), +12 tests recommandations R3 jeu par table (tirage rattaché à la table par le jeton, parties par table au tableau de bord), +8 tests recommandations R4 écran vitrine (route publique, derniers gains en prénoms seuls, rotation des vues), +11 tests boucle animations cycle 1 univers par catégorie (attribution par rang en cycle de 6, calques croisés, couche d'ambiance absente de la Commande, palettes sombres, titre posé et zoom lent de la catégorie active, mouvement réduit, sur le source), +15 tests boucle animations cycle 2 typographie cinétique (découpage du nom en mots, titre géant révélé mot à mot plafonné par le plus long mot, mot fantôme en creux qui dérive, calque mot à mot sur les en-têtes sans photo, h2 inchangé, mouvement réduit, sur le source) ; voir `JOURNAL.md`, `MENU-VISUEL-RAPPORT.md`, `EXPERIENCE-JOURNAL.md` et `FIX-409-RAPPORT.md`).

- Couverture globale : 97,90 % lignes / 91,49 % branches / 93,06 % fonctions
  (`node --test --experimental-test-coverage`, suite verte, 11/11/2026 —
  était 97,89 % / 91,48 % / 93,06 % après P1-U1).
- Fichiers les plus faibles : `pwa.ts` 55,00 %, `router.ts` 83,52 %, `points.ts` 83,75 %
  (inchangés) ; `ecransCommercant.ts` 100,00 % lignes / branches / fonctions.

## Erreurs console

- **1 erreur, reproductible 5/5 passes** : `GET /api/v1/commerces/<id-client>` → **404**,
  au moment du clic « Voir ma carte de fidélité » après un gain (transition
  `#/jouer` → `#/carte`). Journal des requêtes (passe 4) : le 404 part dans la même
  seconde que le `GET /cartes/<id-client>` (200) qui charge la carte.
- Cause élucidée (pile d'appel + hash au moment de l'appel) : `JouerApi`
  (`src/pages/Jouer.tsx:422`, `api.commerce(param)`) se re-rend une fois avec le
  nouveau `param` (l'identifiant client) avant d'être démonté — les deux abonnements
  `useRoute()` (App et JouerApi) ne se mettent pas à jour dans le même rendu.
  Chargement direct de `#/carte/<id>` : pas de 404 (vérifié).
- Impact : aucun visible (la carte s'affiche, le gain est bien enregistré) ; une
  requête 404 en console à chaque gain suivi de « Voir ma carte ». **À corriger
  dans un lot ultérieur — pas dans ce lot de mesure.**
- Aucune autre erreur console, aucune requête échouée, aucun `pageerror` sur les
  5 passes (pages client, caisse, back-office — collecteurs identiques sur les trois).

**Re-mesure P0-D1 (11/11/2026 ~07:16 UTC, 1 passe, `node_modules/.cache/mesure-p0-d1/`) :
0 erreur console, 0 requête échouée** — le correctif (`JouerApi` ne charge le commerce
que si `page === 'jouer'`) fait disparaître le 404. Confirmé aussi par le test E2E
`tests-e2e/scan-gain-carte.spec.ts` (aucune requête ≥ 400 sur le parcours complet ;
sans le correctif, ce même test échoue — contrôle négatif vérifié).

**Captures complémentaires (revue Codex P0-D1, point 6 — même dossier, script
`captures-richesse.mjs`)** : commerce à 8 lots + vrai menu Asian Home (81 plats) +
apparence personnalisée `#d1006f` — `roue-8-lots.png`, `gain-8-lots.png`,
`carte-couleur-perso.png`, `menu-reel.png`, `menu-reel-complet.png` (0 erreur console,
0 requête échouée). La roue à 8 secteurs alterne correctement les 6 couleurs du thème,
libellés tous lisibles ; le bandeau personnalisé magenta affiche bien le sous-titre
en blanc (correctif point 1) ; le vrai menu rend 81 plats avec prix magenta.

**Re-mesure P1-D2 (11/11/2026 ~08:00 UTC, 1 passe, `node_modules/.cache/mesure-p1-d2/`,
2e passe après correctifs) : 0 erreur console, 0 requête échouée.** Temps de cette
passe : premier affichage `#/jouer` 4251 ms (LCP 4224 ms, élément `p.titre-carte`),
navigation 152 / 3673 / 3675 ms ; parcours scan → lot : inscription 1039 ms,
validation caisse 6711 ms, vérification 302 ms, tirage 520 ms (total étapes 8572 ms,
taps identiques : client 4 clics + 1 saisie, caisse 3 clics + 2 saisies) ; ouverture
de la carte 791 ms ; premier affichage `#/menu` 987 ms par hash, 1799 ms en
chargement direct (LCP 1796 ms). Temps proches des passes 4–5 (premier affichage
4020–4238 ms, LCP 4056–4176 ms ; 2e passe P1-D2 : 4251 ms et 4224 ms, légèrement
au-dessus) — comparaison non concluante sur une seule passe ; échantillon
insuffisant pour conclure à une amélioration, une régression ou une stabilité. Captures richesse (même dossier, script
copié de P0-D1) : 0 erreur console, 0 requête échouée ; roue à 8 secteurs lisible
sur fond sombre, vrai menu 81 plats en fiches sombres, carte couleur perso ivoire
(`#fbf8f3`) avec bandeau `#d1006f` inchangée.

**Re-mesure P1-U1 (11/11/2026 ~08:45 UTC, 2 passes, `node_modules/.cache/mesure-p1-u1/`,
`resultats-passe1.json` + `resultats-passe2.json`) : 0 erreur console, 0 requête
échouée, sur les 2 passes.** Temps des 2 passes : premier affichage `#/jouer`
4 241 / 4 043 ms (LCP 4 224 / 4 016 ms, élément `p.titre-carte`) ; parcours
scan → lot 8 727 / 9 155 ms d'étapes (taps identiques) ; ouverture de la carte
559 / 515 ms ; premier affichage `#/menu` 964 / 905 ms par hash, 1 379 / 1 382 ms
en chargement direct (LCP 1 368 / 1 388 ms). Temps proches de P1-D2 (1 passe,
4 251 ms / 4 224 ms ; parcours 8 572 ms) — échantillon insuffisant pour conclure
à une amélioration, une régression ou une stabilité ; les écarts observés peuvent
relever de la variabilité de mesure. Captures : 9 écrans, passe 2 (la passe 1 n'a gardé
que son JSON).

**Re-mesure boucle t0 (11/11/2026 ~14:35 UTC, 2 passes, `node_modules/.cache/mesure-boucle-t0/`,
`resultats-passe<N>.json`) : 0 erreur console, 0 requête échouée, sur les 2 passes.**
Temps des 2 passes : premier affichage `#/jouer` 2 261 / 2 197 ms (LCP 2 248 /
2 148 ms, élément `p.titre-carte`) ; parcours scan → lot 6 664 / 7 343 ms
d'étapes (taps identiques) ; ouverture de la carte 592 / 699 ms ; premier
affichage `#/menu` 983 / 903 ms par hash, 1 531 / 1 326 ms en chargement direct
(LCP 1 508 / 1 308 ms). Captures : 9 écrans, passe 2 (la passe 1 n'a gardé que
son JSON).

**Re-mesure boucle t1 (11/11/2026 ~14:52–14:54 UTC, 3 passes, `node_modules/.cache/mesure-boucle-t1/`,
`resultats-passe<N>.json`) : 0 erreur console, 0 requête échouée, sur les 3 passes.**
Temps des 3 passes : premier affichage `#/jouer` 2 355 / 2 232 / 2 235 ms (LCP
2 340 / 2 220 / 2 224 ms, élément `p.titre-carte`) ; parcours scan → lot 7 213 /
6 971 / 6 987 ms d'étapes (taps identiques) ; ouverture de la carte 600 / 622 /
691 ms ; premier affichage `#/menu` 911 / 927 / 977 ms par hash, 1 502 / 2 082 /
1 491 ms en chargement direct (LCP 1 504 / 1 708 / 1 412 ms). Le chunk
`QrCode-*.js` est bien chargé (HTTP 200) à chaque ouverture de la carte
(journal des requêtes des 3 passes) — le QR s'affiche, avec le repli
« Chargement du QR code… » pendant le chargement. Captures : 9 écrans, passe 3
(les passes 1–2 n'ont gardé que leur JSON).

**Re-mesure boucle t2 (11/11/2026 ~15:15–15:17 UTC, 2 passes, `node_modules/.cache/mesure-boucle-t2/`,
`resultats-passe<N>.json`) : 0 erreur console, 0 requête échouée, sur les 2 passes.**
Temps des 2 passes : premier affichage `#/jouer` 2 078 / 1 861 ms (LCP
2 028 / 1 812 ms, élément `p.titre-carte`) ; parcours scan → lot 6 141 /
6 277 ms d'étapes (taps identiques) ; ouverture de la carte 581 / 520 ms ;
premier affichage `#/menu` 898 / 902 ms par hash, 1 565 / 1 503 ms en
chargement direct (LCP 1 512 / 1 568 ms). Le journal des requêtes des 2 passes
montre `GET /visuels/logo-petit.webp` (HTTP 200) et plus aucun `logo.png` sur
`#/jouer` — le logo léger est bien celui qui est servi. Captures : 9 écrans,
passe 2 (la passe 1 n'a gardé que son JSON).

**Re-mesure boucle t4 (11/11/2026 ~16:00–16:10 UTC, 2 passes, `node_modules/.cache/mesure-boucle-t4/`,
`resultats-passe<N>.json`) : 0 erreur console, 0 requête échouée, sur les 2 passes.**
Temps des 2 passes : premier affichage `#/jouer` 1 896 / 1 895 ms (LCP
1 872 / 1 844 ms, élément `p.titre-carte`) ; parcours scan → lot 6 738 /
6 854 ms d'étapes (taps identiques) ; ouverture de la carte 616 / 684 ms ;
premier affichage `#/menu` 900 / 895 ms par hash, 1 610 / 1 773 ms en
chargement direct (LCP 1 496 / 1 716 ms). Le héros du menu n'apparaît pas
dans ces passes (commerce générique, sans visuels) : son gain est mesuré
par la mesure ponctuelle (voir § Temps de premier affichage, « Re-mesure
boucle t4 — menu Asian Home »). Captures : 9 écrans, passe 2 (la passe 1
n'a gardé que son JSON).

**Re-mesure boucle t5 (11/11/2026 ~16:15–16:20 UTC, 2 passes, `node_modules/.cache/mesure-boucle-t5/`,
`resultats-passe<N>.json`) : 0 erreur console, 0 requête échouée, sur les 2 passes.**
Temps des 2 passes : premier affichage `#/jouer` 1 894 / 1 883 ms (LCP
1 880 / 1 828 ms, élément `p.titre-carte`) ; parcours scan → lot 6 753 /
6 534 ms d'étapes (taps identiques) ; ouverture de la carte 786 / 484 ms ;
premier affichage `#/menu` 936 / 920 ms par hash, 1 690 / 1 706 ms en
chargement direct (LCP 1 628 / 1 680 ms). Le logo du commerce n'apparaît
pas dans ces passes (commerce générique, sans logo) : son gain est mesuré
par la mesure ponctuelle (voir § Temps de premier affichage, « Re-mesure
boucle t5 — pages Asian Home »). Captures : 9 écrans, passe 2 (la passe 1
n'a gardé que son JSON).

**Re-mesure boucle t6 (11/11/2026 ~16:35–16:40 UTC, 2 passes, `node_modules/.cache/mesure-boucle-t6/`,
`resultats-passe<N>.json`) : 0 erreur console, 0 requête échouée, sur les 2 passes.**
Temps des 2 passes : premier affichage `#/jouer` 1 881 / 1 817 ms (LCP
1 868 / 1 800 ms, élément `p.titre-carte`) ; parcours scan → lot 6 396 /
6 577 ms d'étapes (taps identiques) ; ouverture de la carte 513 / 602 ms ;
premier affichage `#/menu` 916 / 902 ms par hash, 1 618 / 1 681 ms en
chargement direct (LCP 1 604 / 1 672 ms). La bannière de la
carte n'apparaît pas dans ces passes (commerce générique, sans bannière) :
son gain est mesuré par la mesure ponctuelle (voir § Temps de premier
affichage, « Re-mesure boucle t6 — carte Asian Home »). Captures : 9 écrans,
passe 2 (la passe 1 n'a gardé que son JSON).

**Re-mesure boucle t7 (11/11/2026 ~17:00–17:05 UTC, 2 passes, `node_modules/.cache/mesure-boucle-t7/`,
`resultats-passe<N>.json`) : 0 erreur console, 0 requête échouée, sur les 2 passes.**
Temps des 2 passes : premier affichage `#/jouer` 1 820 / 1 825 ms (LCP
1 808 / 1 804 ms, élément `p.titre-carte`) ; parcours scan → lot 6 512 /
6 457 ms d'étapes (taps identiques) ; ouverture de la carte 640 / 688 ms ;
premier affichage `#/menu` 914 / 907 ms par hash, 1 522 / 1 683 ms en
chargement direct (LCP 1 528 / 1 596 ms). La bannière de la carte
n'apparaît pas dans ces passes (commerce générique, sans bannière) : son
gain est mesuré par la mesure ponctuelle (voir § Temps de premier
affichage, « Re-mesure boucle t7 — carte Asian Home »). Captures : 9 écrans,
passe 2 (la passe 1 n'a gardé que son JSON).

**Re-mesure boucle t9 (11/11/2026 ~17:15–17:20 UTC, 2 passes, `node_modules/.cache/mesure-boucle-t9/`,
`resultats-passe<N>.json`) : 0 erreur console, 0 requête échouée, sur les 2 passes.**
Temps des 2 passes : premier affichage `#/jouer` 1 894 / 1 882 ms (LCP
1 872 / 1 832 ms, élément `p.titre-carte`) ; parcours scan → lot 6 853 /
6 696 ms d'étapes (taps identiques) ; ouverture de la carte 607 / 619 ms ;
premier affichage `#/menu` 864 / 992 ms par hash, 1 703 / 1 717 ms en
chargement direct (LCP 1 672 / 1 700 ms). Le héros du menu n'apparaît pas
dans ces passes (commerce générique, sans visuels) : son gain est mesuré
par la mesure ponctuelle (voir § Temps de premier affichage, « Re-mesure
boucle t9 — menu Asian Home »). Captures : 9 écrans, passe 2 (la passe 1
n'a gardé que son JSON).

**Re-mesure boucle t10 (11/11/2026 ~17:25–17:30 UTC, 2 passes, `node_modules/.cache/mesure-boucle-t10/`,
`resultats-passe<N>.json`) : 0 erreur console, 0 requête échouée, sur les 2 passes.**
Temps des 2 passes : premier affichage `#/jouer` 1 874 / 1 888 ms (LCP
1 812 / 1 868 ms, élément `p.titre-carte`) ; parcours scan → lot 6 553 /
6 574 ms d'étapes (taps identiques) ; ouverture de la carte 680 / 663 ms ;
premier affichage `#/menu` 981 / 915 ms par hash, 1 519 / 1 967 ms en
chargement direct (LCP 1 496 / 1 668 ms — passe 2 isolée, bruit). Les
photos paresseuses n'apparaissent pas dans ces passes (elles ne sont pas
dans le chargement initial) : leur gain est mesuré par la mesure
ponctuelle (voir § Temps de premier affichage, « Re-mesure boucle t10 —
photos paresseuses »). Captures : 9 écrans, passe 2 (la passe 1 n'a gardé
que son JSON).

## npm audit

**Non mesurable sur cette VM** : `npm audit` retourne 403 `policy_denied` sur
`registry.npmjs.org/-/npm/v1/security/audits/quick` (politique réseau de la VM).
À mesurer ailleurs (poste de développement ou CI) avant de conclure.
Re-tenté le 11/11/2026 (P1-U1) : même 403, inchangé.

## Temps de premier affichage (4G simulée)

| Page | Passe 1 | Passe 2 | Passe 3 | Passe 4 | Passe 5 |
| --- | --- | --- | --- | --- | --- |
| `#/jouer` — premier affichage (titre visible) | 4167 ms | 4057 ms | 4020 ms | 4238 ms | 4073 ms |
| `#/jouer` — navigation : réponse / DOM prêt / chargé | — | 153 / 3508 / 3510 ms | 152 / 3503 / 3503 ms | 161 / 3609 / 3611 ms | 154 / 3513 / 3514 ms |
| `#/jouer` — LCP (méthode corrigée, passes 4–5) | — | — | — | 4176 ms | 4056 ms |
| `#/menu` — premier affichage (par hash) | 897 ms | 874 ms | 996 ms | — | 1004 ms |
| `#/menu` — premier affichage (chargement direct) | — | — | — | — | 1697 ms |
| `#/menu` — LCP (chargement direct) | — | — | — | — | 1632 ms |

- Les 5 premiers affichages de `#/jouer` dépassent le seuil de 4 s : **seuil non atteint**.
- LCP de `#/jouer` (passes 4–5, lecture après 2 s de stabilisation) : **4,06–4,18 s**,
  élément `p.titre-carte` (le nom du commerce en doré). Les valeurs des passes 1–3
  (1,8–4,0 s) ne sont pas retenues : lecture trop tôt, avant le dernier candidat LCP.
- LCP du menu par navigation hash : **aucune nouvelle entrée** (0 sur les passes 4–5) —
  non mesurable par cette méthode ; par chargement direct : **1632 ms** (élément
  `p.text-center`, le texte « Menu à venir »). Les valeurs 4032/4040 ms des passes 2–3
  étaient la valeur périmée de `#/jouer`, pas celle du menu.
- Délai à froid Render (~60 s, plan gratuit en veille) : **non mesuré** (estimation).

### Re-mesure P1-U1 (11/11/2026 ~08:45 UTC, 2 passes)

| Page | Passe 1 | Passe 2 |
| --- | --- | --- |
| `#/jouer` — premier affichage (titre visible) | 4241 ms | 4043 ms |
| `#/jouer` — navigation : réponse / DOM prêt / chargé | 157 / 3625 / 3627 ms | 152 / 3537 / 3539 ms |
| `#/jouer` — LCP | 4224 ms (`p.titre-carte`) | 4016 ms (`p.titre-carte`) |
| `#/menu` — premier affichage (par hash) | 964 ms | 905 ms |
| `#/menu` — premier affichage (chargement direct) | 1379 ms | 1382 ms |
| `#/menu` — LCP (chargement direct) | 1368 ms (`p.text-center`) | 1388 ms (`p.text-center`) |

- Premier affichage `#/jouer` : 4 043–4 241 ms — **seuil < 4 s toujours non atteint**
  (4,02–4,24 s à P0-U0, 4 251 ms à P1-D2) ; la passe 2 (4 043 ms) frôle le seuil
  sans le passer. LCP `#/jouer` : 4 016–4 224 ms, toujours > 2,5 s.
- Menu par hash : LCP sans nouvelle entrée (0, comme aux passes 4–5) ; par chargement
  direct : 1 368–1 388 ms (était 1 632 ms à P0-U0, 1 796 ms à P1-D2 — échantillon
  insuffisant pour conclure à une amélioration ; les écarts peuvent relever de la
  variabilité de mesure).
- Délai à froid Render (~60 s) : **toujours non mesuré** (estimation) ; à froid
  téléphone réel : **non mesuré** (pas de téléphone sur cette VM — protocole
  documenté plus haut, à exécuter sur staging).

### Re-mesure P2-Q2 (11/11/2026 ~11:36 UTC, 2 passes)

| Page | Passe 1 | Passe 2 |
| --- | --- | --- |
| `#/jouer` — premier affichage (titre visible) | 2428 ms | 2285 ms |
| `#/jouer` — navigation : réponse / DOM prêt / chargé | 159 / 1777 / 1778 ms | 155 / 1711 / 1712 ms |
| `#/jouer` — LCP | 2368 ms (`p.titre-carte`) | 2272 ms (`p.titre-carte`) |
| `#/menu` — premier affichage (par hash) | 930 ms | 1092 ms |
| `#/menu` — premier affichage (chargement direct) | 1764 ms | 1765 ms |
| `#/menu` — LCP (chargement direct) | 1684 ms (`p.text-center`) | 1780 ms (`p.text-center`) |

- Premier affichage `#/jouer` : 2 285–2 428 ms — **seuil < 4 s ATTEINT pour la
  première fois** (4 043–4 241 ms à P1-U1) ; le gain vient de la compression : le
  JS initial (480 934 o) arrive en brotli à 143 901 o, soit ~1,7 s de moins à
  télécharger en Slow 4G (1,6 Mbps). LCP `#/jouer` : 2 272–2 368 ms — **seuil
  < 2,5 s ATTEINT** (4 016–4 224 ms à P1-U1). Les deux passes sont cohérentes
  (écart 143 ms / 96 ms) ; le gain est attribué à la compression, pas à la
  variabilité — l'écart avec P1-U1 (~1,8 s) dépasse largement la variabilité
  observée entre passes (~0,2 s).
- Menu par hash : LCP sans nouvelle entrée (0, comme avant) ; par chargement
  direct : 1 684–1 780 ms (était 1 368–1 388 ms à P1-U1 — en hausse de ~0,4 s,
  cause non établie : le menu direct charge le chunk MenuPublic + menu-reel,
  échantillon de 2 passes insuffisant pour conclure ; le premier affichage direct
  est lui aussi en hausse : 1 764–1 765 ms contre 1 379–1 382 ms).
- Délai à froid Render (~60 s) : **toujours non mesuré** (estimation) ; à froid
  téléphone réel : **non mesuré** (pas de téléphone sur cette VM — protocole
  documenté plus haut, à exécuter sur staging).

### Re-mesure boucle t0 (11/11/2026 ~14:35 UTC, 2 passes)

| Page | Passe 1 | Passe 2 |
| --- | --- | --- |
| `#/jouer` — premier affichage (titre visible) | 2261 ms | 2197 ms |
| `#/jouer` — navigation : réponse / DOM prêt / chargé | 158 / 1736 / 1737 ms | 154 / 1706 / 1707 ms |
| `#/jouer` — LCP | 2248 ms (`p.titre-carte`) | 2148 ms (`p.titre-carte`) |
| `#/menu` — premier affichage (par hash) | 983 ms | 903 ms |
| `#/menu` — premier affichage (chargement direct) | 1531 ms | 1326 ms |
| `#/menu` — LCP (chargement direct) | 1508 ms (`p.text-center`) | 1308 ms (`p.text-center`) |

- Premier affichage `#/jouer` : 2 197–2 261 ms — **seuil < 4 s atteint**
  (2 285–2 428 ms à P2-Q2) ; LCP `#/jouer` : 2 148–2 248 ms — **seuil < 2,5 s
  atteint**. Écarts avec P2-Q2 (~0,15 s) dans le bruit de mesure.
- Délai à froid Render (~60 s) : **toujours non mesuré** (estimation) ; à froid
  téléphone réel : **non mesuré** (pas de téléphone sur cette VM — protocole
  documenté plus haut, à exécuter sur staging).

### Re-mesure boucle t1 (11/11/2026 ~14:52–14:54 UTC, 3 passes)

| Page | Passe 1 | Passe 2 | Passe 3 |
| --- | --- | --- | --- |
| `#/jouer` — premier affichage (titre visible) | 2355 ms | 2232 ms | 2235 ms |
| `#/jouer` — navigation : réponse / DOM prêt / chargé | 158 / 1755 / 1756 ms | 152 / 1689 / 1690 ms | 160 / 1683 / 1685 ms |
| `#/jouer` — LCP | 2340 ms (`p.titre-carte`) | 2220 ms (`p.titre-carte`) | 2224 ms (`p.titre-carte`) |
| `#/menu` — premier affichage (par hash) | 911 ms | 927 ms | 977 ms |
| `#/menu` — premier affichage (chargement direct) | 1502 ms | 2082 ms | 1491 ms |
| `#/menu` — LCP (chargement direct) | 1504 ms (`p.text-center`) | 1708 ms (`p.text-center`) | 1412 ms (`p.text-center`) |

- Premier affichage `#/jouer` : 2 232–2 355 ms — **seuil < 4 s atteint** ;
  LCP `#/jouer` : 2 220–2 340 ms — **seuil < 2,5 s atteint**. Écarts avec t0
  (+35 / +94 ms à la passe 1, +35 / +72 ms à la passe 2) dans le bruit de
  mesure (± ~0,2 s) ; la 3e passe (2 235 / 2 224 ms) confirme l'absence de
  régression systématique.
- Menu direct, passe 2 : 2 082 ms (LCP 1 708 ms) — valeur isolée, les passes 1
  et 3 sont à 1 502 / 1 491 ms (LCP 1 504 / 1 412 ms) : bruit de mesure sur
  cette VM partagée, pas un effet du tour (le menu ne touche pas au QR).
- Délai à froid Render (~60 s) : **toujours non mesuré** (estimation) ; à froid
  téléphone réel : **non mesuré** (pas de téléphone sur cette VM — protocole
  documenté plus haut, à exécuter sur staging).

### Re-mesure boucle t2 (11/11/2026 ~15:15–15:17 UTC, 2 passes)

| Page | Passe 1 | Passe 2 |
| --- | --- | --- |
| `#/jouer` — premier affichage (titre visible) | 2078 ms | 1861 ms |
| `#/jouer` — navigation : réponse / DOM prêt / chargé | 159 / 1434 / 1436 ms | 154 / 1311 / 1313 ms |
| `#/jouer` — LCP | 2028 ms (`p.titre-carte`) | 1812 ms (`p.titre-carte`) |
| `#/menu` — premier affichage (par hash) | 898 ms | 902 ms |
| `#/menu` — premier affichage (chargement direct) | 1565 ms | 1503 ms |
| `#/menu` — LCP (chargement direct) | 1512 ms (`p.text-center`) | 1568 ms (`p.text-center`) |

- Premier affichage `#/jouer` : 1 861–2 078 ms — **gain −154 à −494 ms sur
  les 2 passes** vs t1 (2 232–2 355 ms), moyenne 1 970 ms contre 2 274 ms
  (−304 ms) : au-delà du bruit (± ~0,2 s). LCP `#/jouer` : 1 812–2 028 ms
  (−192 à −528 ms, moyenne −341 ms). Le logo léger pèse 4,9 Ko contre
  74,5 Ko : −69,5 Ko sur le chemin critique, en concurrence avec le JS sur
  la 4G lente — le gain est cohérent avec l'hypothèse du tour.
- La validation en caisse gagne aussi (4 331 / 4 421 ms contre 4 731–5 123 ms
  à t1) : chaque chargement de page affiche l'écran de chargement, donc le
  logo léger profite aussi à la caisse — le gain du parcours (−~860 ms) est
  cohérent, pas un artefact.

### Re-mesure boucle t4 (11/11/2026 ~16:00–16:10 UTC, 2 passes)

| Page | Passe 1 | Passe 2 |
| --- | --- | --- |
| `#/jouer` — premier affichage (titre visible) | 1896 ms | 1895 ms |
| `#/jouer` — navigation : réponse / DOM prêt / chargé | 154 / 1336 / 1337 ms | 152 / 1349 / 1351 ms |
| `#/jouer` — LCP | 1872 ms (`p.titre-carte`) | 1844 ms (`p.titre-carte`) |
| `#/menu` — premier affichage (par hash) | 900 ms | 895 ms |
| `#/menu` — premier affichage (chargement direct) | 1610 ms | 1773 ms |
| `#/menu` — LCP (chargement direct) | 1496 ms (`p.text-center`) | 1716 ms (`p.text-center`) |

- Premier affichage `#/jouer` : 1 895–1 896 ms — **plat vs t2** (1 861–2 078 ms,
  dans le bruit) ; LCP `#/jouer` : 1 844–1 872 ms (t2 : 1 812–2 028 ms) ;
  menu direct 1 610 / 1 773 ms (t2 : 1 565 / 1 503 ms — passe 2 isolée, bruit).
  Le tour ne touche pas au chemin `#/jouer` : aucune régression attendue, aucune
  observée au-delà du bruit.

### Re-mesure boucle t5 (11/11/2026 ~16:15–16:20 UTC, 2 passes)

| Page | Passe 1 | Passe 2 |
| --- | --- | --- |
| `#/jouer` — premier affichage (titre visible) | 1894 ms | 1883 ms |
| `#/jouer` — navigation : réponse / DOM prêt / chargé | 152 / 1332 / 1333 ms | 152 / 1324 / 1325 ms |
| `#/jouer` — LCP | 1880 ms (`p.titre-carte`) | 1828 ms (`p.titre-carte`) |
| `#/menu` — premier affichage (par hash) | 936 ms | 920 ms |
| `#/menu` — premier affichage (chargement direct) | 1690 ms | 1706 ms |
| `#/menu` — LCP (chargement direct) | 1628 ms (`p.text-center`) | 1680 ms (`p.text-center`) |

- Premier affichage `#/jouer` : 1 883–1 894 ms — **plat vs t4** (1 895–1 896 ms) ;
  LCP `#/jouer` : 1 828–1 880 ms (t4 : 1 844–1 872 ms) ; menu direct
  1 690 / 1 706 ms (t4 : 1 610 / 1 773 ms) ; menu hash 936 / 920 ms (t4 :
  900 / 895 ms). Le tour ne touche pas au chemin standard (commerce
  générique, sans logo) : aucune régression attendue, aucune observée
  au-delà du bruit. Le gain du tour est sur les pages Asian Home (mesure
  ponctuelle ci-dessous).

### Re-mesure boucle t6 (11/11/2026 ~16:35–16:40 UTC, 2 passes)

| Page | Passe 1 | Passe 2 |
| --- | --- | --- |
| `#/jouer` — premier affichage (titre visible) | 1881 ms | 1817 ms |
| `#/jouer` — navigation : réponse / DOM prêt / chargé | 153 / 1340 / 1341 ms | 152 / 1318 / 1320 ms |
| `#/jouer` — LCP | 1868 ms (`p.titre-carte`) | 1800 ms (`p.titre-carte`) |
| `#/menu` — premier affichage (par hash) | 916 ms | 902 ms |
| `#/menu` — premier affichage (chargement direct) | 1618 ms | 1681 ms |
| `#/menu` — LCP (chargement direct) | 1604 ms (`p.text-center`) | 1672 ms (`p.text-center`) |

- Premier affichage `#/jouer` : 1 817–1 881 ms — **plat vs t5** (1 883–1 894 ms) ;
  LCP `#/jouer` : 1 800–1 868 ms (t5 : 1 828–1 880 ms) ; menu direct
  1 618 / 1 681 ms (t5 : 1 690 / 1 706 ms) ; menu hash 916 / 902 ms (t5 :
  936 / 920 ms). Le tour ne touche pas au chemin standard (commerce
  générique, sans bannière) : aucune régression attendue, aucune observée
  au-delà du bruit. Le gain du tour est sur la carte Asian Home (mesure
  ponctuelle ci-dessous).

### Re-mesure boucle t7 (11/11/2026 ~17:00–17:05 UTC, 2 passes)

| Page | Passe 1 | Passe 2 |
| --- | --- | --- |
| `#/jouer` — premier affichage (titre visible) | 1820 ms | 1825 ms |
| `#/jouer` — navigation : réponse / DOM prêt / chargé | 152 / 1328 / 1330 ms | 152 / 1309 / 1310 ms |
| `#/jouer` — LCP | 1808 ms (`p.titre-carte`) | 1804 ms (`p.titre-carte`) |
| `#/menu` — premier affichage (par hash) | 914 ms | 907 ms |
| `#/menu` — premier affichage (chargement direct) | 1522 ms | 1683 ms |
| `#/menu` — LCP (chargement direct) | 1528 ms (`p.text-center`) | 1596 ms (`p.text-center`) |

- Premier affichage `#/jouer` : 1 820–1 825 ms — **plat vs t6** (1 817–1 881 ms) ;
  LCP `#/jouer` : 1 804–1 808 ms (t6 : 1 800–1 868 ms) ; menu direct
  1 522 / 1 683 ms (t6 : 1 618 / 1 681 ms) ; menu hash 914 / 907 ms (t6 :
  916 / 902 ms). Le tour ne touche à aucun JS (bundle identique) : aucune
  régression attendue, aucune observée au-delà du bruit.

### Re-mesure boucle t9 (11/11/2026 ~17:15–17:20 UTC, 2 passes)

| Page | Passe 1 | Passe 2 |
| --- | --- | --- |
| `#/jouer` — premier affichage (titre visible) | 1894 ms | 1882 ms |
| `#/jouer` — navigation : réponse / DOM prêt / chargé | 153 / 1347 / 1350 ms | 153 / 1342 / 1344 ms |
| `#/jouer` — LCP | 1872 ms (`p.titre-carte`) | 1832 ms (`p.titre-carte`) |
| `#/menu` — premier affichage (par hash) | 864 ms | 992 ms |
| `#/menu` — premier affichage (chargement direct) | 1703 ms | 1717 ms |
| `#/menu` — LCP (chargement direct) | 1672 ms (`p.text-center`) | 1700 ms (`p.text-center`) |

- Premier affichage `#/jouer` : 1 882–1 894 ms — **plat vs t7** (1 820–1 825 ms,
  dans le bruit) ; LCP `#/jouer` : 1 832–1 872 ms (t7 : 1 804–1 808 ms) ;
  menu direct 1 703 / 1 717 ms (t7 : 1 522 / 1 683 ms) ; menu hash 864 / 992 ms
  (t7 : 914 / 907 ms — passe 2 isolée, bruit). Le tour ne touche à aucun JS
  (bundle identique) : aucune régression attendue, aucune observée au-delà
  du bruit. Le gain du tour est sur le menu Asian Home (mesure ponctuelle
  ci-dessous).

### Re-mesure boucle t10 (11/11/2026 ~17:25–17:30 UTC, 2 passes)

| Page | Passe 1 | Passe 2 |
| --- | --- | --- |
| `#/jouer` — premier affichage (titre visible) | 1874 ms | 1888 ms |
| `#/jouer` — navigation : réponse / DOM prêt / chargé | 152 / 1306 / 1308 ms | 154 / 1336 / 1337 ms |
| `#/jouer` — LCP | 1812 ms (`p.titre-carte`) | 1868 ms (`p.titre-carte`) |
| `#/menu` — premier affichage (par hash) | 981 ms | 915 ms |
| `#/menu` — premier affichage (chargement direct) | 1519 ms | 1967 ms |
| `#/menu` — LCP (chargement direct) | 1496 ms (`p.text-center`) | 1668 ms (`p.text-center`) |

- Premier affichage `#/jouer` : 1 874–1 888 ms — **plat vs t9** (1 882–1 894 ms) ;
  LCP `#/jouer` : 1 812–1 868 ms (t9 : 1 832–1 872 ms) ; menu direct
  1 519 / 1 967 ms (t9 : 1 703 / 1 717 ms — passe 2 isolée, bruit) ; menu hash
  981 / 915 ms (t9 : 864 / 992 ms). Le tour ne touche pas au chemin initial
  (photos paresseuses, hors chargement initial) : aucune régression attendue,
  aucune observée au-delà du bruit. Le gain du tour est sur le défilement
  (mesure ponctuelle ci-dessous).

### Re-mesure boucle t4 — menu Asian Home (mesure ponctuelle, 11/11/2026 ~15:45–16:30 UTC)

Le protocole standard utilise un commerce générique, sans visuels : le héros
du menu n'y apparaît pas. Mesure ponctuelle, même protocole par ailleurs
(Pixel 7, Slow 4G + CPU ×4, serveur E2E local, service workers bloqués,
cache désactivé, navigateur relancé par passe — script versionné
`scripts/mesurer-menu-asian-home.mjs`), commerce nommé « Asian Home Paris »
(`estAsianHome` reconnaît le nom) : la page `#/menu` affiche alors le héros,
comme pour le vrai restaurant. LCP `#/menu` (élément : la photo d'en-tête
elle-même, `h-56 w-full rounded-3xl object-cover...`) :
**avant 3 428 / 3 376 ms** (héros JPEG 1 949 → 3 404 ms, 196 289 o transférés)
**→ après 3 076 / 2 892 ms** (WebP 2 065 → 3 044 ms, 95 794 o transférés ;
plus aucun `table-sushis.jpg` dans le journal) — **moyenne 3 402 → 2 984 ms
(−418 ms, 2 passes sur 2)**. Confirmation avec le script versionné
(`className="block"` appliqué) : 2 912 / 2 960 ms (moyenne des 4 passes
après : 2 960 ms, −442 ms). Résultat observé sur 2 passes (+ 2 de
confirmation), pas un gain garanti en production ; la mesure ne couvre ni
le SW actif ni une visite chaude.

### Re-mesure boucle t5 — pages Asian Home (mesure ponctuelle, 11/11/2026 ~16:00–16:25 UTC)

Même script (`scripts/mesurer-menu-asian-home.mjs`, étendu au tour 5 pour
mesurer aussi `#/jouer` — page neuve par mesure, une navigation par hash ne
rechargeant pas le document) : LCP `#/menu` **avant 2 892 / 2 908 ms →
après 2 572 / 2 588 ms (moyenne −320 ms, 2 passes sur 2)** — le héros WebP
finit à 2 537 / 2 548 ms (était 2 860 / 2 876 ms) et `logo.png` a disparu
du journal ; gain compatible avec une moindre concurrence réseau (le logo
74 Ko et le héros 95 Ko partaient en parallèle sur le même tuyau 4G),
pas une preuve du temps de tuyau exact. LCP `#/jouer` : 1 744 / 1 648 ms
→ 1 740 / 1 648 ms (**plat**, attendu : le logo n'est pas le LCP —
`p.titre-carte` — et finit après lui) ; `logo.png` a disparu du journal
(seul `logo-petit.webp` de l'écran de chargement subsiste).

### Re-mesure boucle t6 — carte Asian Home (mesure ponctuelle, 11/11/2026 ~16:30–17:00 UTC)

Script versionné `scripts/mesurer-carte-asian-home.mjs` (commerce
« Asian Home Paris », parcours complet inscription → caisse → tirage →
gain → carte, Pixel 7, Slow 4G + CPU ×4, SW bloqués, cache désactivé,
navigateur relancé par passe). Deux mesures : (1) la transition réelle
(clic « Voir ma carte » depuis `#/jouer` → héros et bannière
chargés/décodés/affichés, `currentSrc` relevé) ; (2) le chargement direct
(nouvelle page du même contexte, jeton dans le localStorage) pour le LCP
classique — le LCP d'une navigation par hash n'est pas mesurable.
**Avant** (ABAB, code t5) : transition — héros affiché 1 531 / 1 604 ms
(moyenne 1 568 ms), bannière affichée 1 919 / 1 921 ms (moyenne 1 920 ms),
`currentSrc` = `hero-plats.jpg` ; LCP direct 3 464 / 3 308 ms et
3 432 / 3 192 ms (moyenne des 4 passes 3 349 ms, élément `img.h-80` =
le héros, pas la bannière) ; bannière JPEG 2 226 → 3 775 ms (177 669 o).
**Après** (3 runs, 6 passes) : transition — héros affiché 1 432 / 1 365 ms
puis 1 375 / 1 345 ms (moyenne ~1 379 ms, **−~190 ms**), bannière affichée
1 439 / 1 372 ms puis 1 382 / 1 351 ms (moyenne ~1 386 ms, **−~530 ms**),
`currentSrc` = `hero-plats-petit.webp` ; LCP direct 3 208 / 3 092 ms,
3 220 / 3 208 ms, 3 204 / 3 224 ms (moyenne des 6 passes ~3 176 ms,
**−~170 ms** vs 3 349 ms) ; bannière WebP 2 176 → 3 075 ms (75 888 o),
plus aucun `hero-plats.jpg` dans le journal ; chargement direct de la
carte 2 503 / 2 284 ms puis 2 425 / 2 409 ms puis 2 416 / 2 487 ms (était
2 656 / 2 480 ms et 2 658 / 2 404 ms). Le gain se transpose donc au
parcours réel (transition par hash), pas seulement au chargement direct —
c'est le point que la revue Codex t6 demandait de démontrer. 0 erreur
console (écouteurs aussi sur la page carte), 0 requête échouée.

### Re-mesure boucle t7 — carte Asian Home (mesure ponctuelle, 11/11/2026 ~16:50–17:10 UTC)

Même script (`scripts/mesurer-carte-asian-home.mjs`, clés renommées
`herosChargeApresClicMs` / `banniereChargeeApresClicMs` — la mesure attend
`img.complete`, donc « chargée », pas « affichée » ; le libellé « affichée »
des docs du tour 6 désignait déjà cette même mesure).
**Avant** (variante 720×480, 2 passes) : transition — héros chargé
1 394 / 1 399 ms (moyenne 1 397 ms), bannière chargée 1 400 / 1 409 ms
(moyenne 1 405 ms) ; LCP direct 3 124 / 3 200 ms (moyenne 3 162 ms) ;
chargement direct 2 415 / 2 413 ms.
**Après** (variante 720×180, 4 passes, 2 runs) : transition — héros chargé
1 164 / 1 201 ms puis 1 153 / 1 120 ms (moyenne 1 160 ms, **−237 ms**),
bannière chargée 1 172 / 1 208 ms puis 1 160 / 1 125 ms (moyenne 1 166 ms,
**−239 ms**) ; LCP direct 3 004 / 2 884 ms puis 3 116 / 3 004 ms (moyenne
3 002 ms, **−160 ms**) ; chargement direct 2 422 / 2 303 ms puis
2 593 / 2 571 ms (plat). Les 4 passes après sont sous les 2 passes avant
sur les deux métriques de transition (après max 1 201 ms < avant min
1 394 ms pour le héros ; après max 1 208 ms < avant min 1 400 ms pour la
bannière) — séparation nette. Les 48 206 o économisés valent ~230 ms au
débit configuré (1,6 Mibit/s) : les gains observés sont plausibles.
Réserve : gain observé à froid, sans garantie statistique (deux séries
successives, trois métriques corrélées) ; le cache n'a pas biaisé la
mesure (SW bloqués, cache désactivé) mais un habitué peut conserver
l'ancienne variante temporairement (SW : cache à la demande + fraîcheur
HTTP 1 h — sans régression visuelle significative, le rendu est très
proche ; une URL versionnée serait nécessaire pour une adoption immédiate).
0 erreur console, 0 requête échouée.

### Re-mesure boucle t9 — menu Asian Home (mesure ponctuelle, 11/11/2026 ~17:10–17:15 UTC)

Même script (`scripts/mesurer-menu-asian-home.mjs`, commerce
« Asian Home Paris », Pixel 7, Slow 4G + CPU ×4, SW bloqués, cache
désactivé) : LCP `#/menu` **avant 2 540 / 2 492 ms → après 2 324 / 2 252 ms
(moyenne 2 516 → 2 288 ms, −228 ms, 2 passes sur 2)** — le héros WebP
finit à 2 296 / 2 226 ms (était 2 510 / 2 454 ms), 51 702 o transférés
(51 402 o sur disque : `transferSize` ajoute forfaitairement 300 o au
corps encodé) ; plus aucun `table-sushis.jpg` dans le journal (déjà le
cas au tour 4). Les 44 092 o économisés valent ~220 ms à 1,6 Mbit/s :
le gain observé est plausible, encore indicatif (2 passes). LCP `#/jouer`
(en même temps) : 1 684 / 1 704 ms → 1 648 / 1 672 ms (plat, attendu :
le héros n'est pas sur `#/jouer`). Le cache n'a pas biaisé la mesure
(SW bloqués, cache désactivé) mais un habitué peut conserver l'ancienne
variante temporairement (SW : cache à la demande — la fraîcheur HTTP
d'1 h ne borne pas sa persistance, notamment hors ligne — sans régression
visuelle significative, le rendu est très proche).

### Re-mesure boucle t10 — photos paresseuses (mesure ponctuelle, 11/11/2026 ~17:20–17:45 UTC)

Script versionné `scripts/mesurer-photos-paresseuses.mjs` (commerce
« Asian Home Paris », Pixel 7, Slow 4G + CPU ×4, SW bloqués, cache
désactivé, navigateur relancé par passe ; carte : parcours complet puis
défilement jusqu'à la section « Le restaurant » ; menu : chargement
direct puis défilement ; les timeouts ne sont pas masqués ; les latences
indépendantes sont les durées de téléchargement du journal (fin − debut),
les délais scroll → chargé sont ceux du parcours, cumulatifs). État avant
scroll vérifié : `currentSrc` vide, images non complètes — le lazy loading
attend bien le défilement (pas de préchargement anticipé).
**Avant** (JPEG, 2 passes, script corrigé — ABAB) : durées de
téléchargement — interieur 1 116 / 1 156 ms (131 081 o), salon 549 / 569 ms
(22 060 o), sushis-ardoise 585 / 560 ms (30 079 o), cocktails 980 / 975 ms
(69 083 o), menu-plat-riz 563 / 590 ms (38 942 o), menu-mango 918 / 875 ms
(61 660 o — la même requête sert la photo de catégorie ET la photo du
plat « Mango Stick ») ; délais scroll → chargé — carte 1 141 / 1 195 ms
et 1 150 / 1 200 ms, menu 1 016 / 1 067 ms, 1 105 / 1 172 ms,
1 786 / 1 864 ms, 1 899 / 1 893 ms.
**Après** (WebP, 4 passes, 2 runs) : durées — interieur-petit 631 / 629 ms
puis 417 / 617 ms (moyenne 574 ms, **−562 ms**), salon-petit 293 / 292 ms
puis 291 / 302 ms (moyenne 295 ms, **−264 ms**), sushis-ardoise-petit
280 / 252 ms puis 249 / 283 ms (moyenne 266 ms, **−307 ms**),
cocktails-petit 368 / 384 ms puis 381 / 391 ms (moyenne 381 ms,
**−597 ms**), menu-plat-riz-petit 412 / 362 ms puis 363 / 364 ms (moyenne
375 ms, **−202 ms**), menu-mango-petit 355 / 384 ms puis 374 / 361 ms
(moyenne 369 ms, **−528 ms**) ; `currentSrc` = les 6 variantes WebP.
Total des 6 photos : 352 905 o → 86 338 o (**−267 Ko**). Le JPEG
menu-mango-sticky-rice.jpg (61 660 o) se télécharge TOUJOURS (645–718 ms)
— c'est la photo du plat « Mango Stick » (vignette 64×64), pas la photo
de catégorie : candidat t11 (vignette carrée WebP).
0 erreur console (écouteurs aussi sur la page carte du parcours), 0 requête
échouée.

## Lighthouse (mobile, local, `#/jouer`, 11/11/2026)

- **Score performance : 81** (2e passe, script versionné ; 76 à la 1re passe —
  le score varie de ±5 d'une passe à l'autre : TBT 360 → 230 ms, Speed Index 1,2 → 1,1 s)
- First Contentful Paint : 1,1 s
- Largest Contentful Paint : 4,5 s
- Total Blocking Time : 230 ms
- Cumulative Layout Shift : 0
- Speed Index : 1,1 s
- Time to Interactive : 4,5 s

Cohérent avec les mesures Playwright (premier affichage ~4,1 s, LCP ~4,1 s). Le point
faible est le LCP (~4,5 s). Mesuré sur `#/jouer` seulement (page critique) ; pas de
mesure Lighthouse sur téléphone réel.

### Re-mesure P1-U1 (11/11/2026, 2 passes)

- **Score performance : 79** (score identique sur les deux passes — était 81 à P0-U0,
  76 à la 1re passe P0-U0 ; écart observé de 5 points entre les deux passes P0-U0,
  pas une incertitude « ±5 » — échantillon insuffisant pour conclure à une
  régression ; 16 points sous le seuil ≥ 95)
- First Contentful Paint : 1,1 s (2 passes)
- Largest Contentful Paint : 4,6 s (2 passes)
- Total Blocking Time : 240 / 270 ms
- Cumulative Layout Shift : 0 (2 passes)
- Speed Index : 1,1 s (2 passes)
- Time to Interactive : 4,7 / 4,8 s

Cohérent avec les mesures Playwright P1-U1 (premier affichage 4,0–4,2 s,
LCP 4,0–4,2 s). Le point faible reste le LCP (~4,6 s). Seuil ≥ 95 toujours loin.

### Re-mesure P2-Q2 (11/11/2026, 2 passes)

- **Score performance : 73 / 81** (était 79/79 à P1-U1, 81/76 à P0-U0 ; écart de
  8 points entre les deux passes — variabilité de mesure sur cette VM partagée,
  voir l'avertissement Lighthouse « slower CPU than expected » ; 14 à 22 points
  sous le seuil ≥ 95)
- First Contentful Paint : 0,8 s (2 passes, était 1,1 s)
- Largest Contentful Paint : 3,2 / 2,6 s (était 4,6 s)
- Total Blocking Time : 840 / 660 ms (était 240 / 270 ms — **en hausse**)
- Cumulative Layout Shift : 0 (2 passes)
- Speed Index : 1,4 / 1,1 s (était 1,1 s)
- Time to Interactive : 3,3 / 3,0 s (était 4,7 / 4,8 s)

Cohérent avec les mesures Playwright P2-Q2 pour le LCP (2,3 s en Slow 4G CDP,
2,6–3,2 s en throttling simulé Lighthouse — les deux méthodes ne sont pas
interchangeables, voir § Protocole). **Le score ≥ 95 n'est toujours pas atteint** :
le LCP et le TTI s'améliorent nettement (LCP 4,6 → 2,6–3,2 s, TTI 4,7/4,8 →
3,0/3,3 s) mais le TBT augmente (240/270 → 660/840 ms) et plafonne le score.
Cause du TBT non établie : le JS arrive plus tôt (compression), donc le travail
de la file principale se concentre dans la fenêtre mesurée au lieu d'être étalé
par les attentes réseau — hypothèse, non vérifiée ; la calibration CPU de
Lighthouse sur cette VM partagée (1,5 CPU) est aussi mise en cause par
l'avertissement de l'outil. Le TBT est le prochain levier (découpage du JS
initial, report du travail hors du chemin critique), hors périmètre P2-Q2.

### Re-mesure boucle t0 (11/11/2026, 2 passes)

- **Score performance : 77 / 81** (était 73 / 81 à P2-Q2, 79/79 à P1-U1 ;
  écart de 4 points entre les deux passes — variabilité de mesure sur cette VM
  partagée ; 14 à 18 points sous le seuil ≥ 95)
- First Contentful Paint : 0,8 s (2 passes)
- Largest Contentful Paint : 2,5 / 2,7 s (était 3,2 / 2,6 s à P2-Q2)
- Total Blocking Time : 910 / 630 ms (était 840 / 660 ms à P2-Q2 — **toujours
  en hausse vs P1-U1**, 240 / 270 ms)
- Cumulative Layout Shift : 0 (2 passes)
- Speed Index : 1,4 / 1,1 s
- Time to Interactive : 2,8 s (2 passes, était 3,3 / 3,0 s)

Détail (`lighthouse-passe<N>.json`, passe 1) : `mainthread-work-breakdown`
Other 1 086 ms, Script Evaluation 580 ms, Style & Layout 572 ms, Parse HTML &
CSS 114 ms ; `bootup-time` : `index-*.js` 610 ms dont 558 ms de scripting ;
`unused-javascript` : `index-*.js` gaspille 62 KiB sur 102 KiB transférés
(61 % inutilisé sur `#/jouer` — code de la caisse et de la carte) ; 11 tâches
longues dont l'évaluation de `index-*.js` (294 ms) et des tâches
« Unattributable » / document (119–258 ms, rendu React + réponse API). Le
TBT reste le levier n° 1 de la boucle (tour 1 : sortie de `qrcode-generator`
du bundle initial, ~21 Ko minifiés).

### Re-mesure boucle t1 (11/11/2026, 2 passes)

- **Score performance : 80 / 85** (était 77 / 81 à t0, 73 / 81 à P2-Q2 ;
  +3 / +4 points — dans le bruit inter-passes (± 5), mais en hausse sur les
  2 passes ; 10 à 15 points sous le seuil ≥ 95)
- First Contentful Paint : 0,8 s (2 passes)
- Largest Contentful Paint : 2,9 / 2,8 s (était 2,5 / 2,7 s à t0 — en hausse
  de ~0,2 s, dans le bruit ; le LCP Playwright Slow 4G, lui, est plat :
  2 340 / 2 220 / 2 224 ms contre 2 248 / 2 148 ms à t0)
- Total Blocking Time : 620 / 450 ms (était 910 / 630 ms à t0 — **en baisse
  sur les 2 passes**, −290 / −180 ms)
- Cumulative Layout Shift : 0 (2 passes)
- Speed Index : 1,2 / 1,0 s
- Time to Interactive : 2,9 s (2 passes, était 2,8 s)

Détail (`lighthouse-passe<N>.json`, passe 1) : `mainthread-work-breakdown`
Other 763 ms, Script Evaluation 660 ms, Style & Layout 469 ms, Parse HTML &
CSS 11 ms ; `unused-javascript` : `index-*.js` gaspille toujours 61 KiB
(62 KiB sur 102 KiB transférés à t0 — le gaspillage restant est le code de la
caisse et de la carte, épinglé statique par P2-Q2, pas le QR). Le TBT baisse
mais reste le levier n° 1 : le prochain tour devra attaquer le travail de la
file principale elle-même (Style & Layout 469–556 ms, Other 757–763 ms),
pas seulement le poids du JS.

### Re-mesure boucle t2 (11/11/2026, 2 passes)

- **Score performance : 84 / 81** (était 80 / 85 à t1 — plat, dans le bruit
  inter-passes (± 5) ; 11 à 14 points sous le seuil ≥ 95)
- First Contentful Paint : 0,8 s (2 passes)
- Largest Contentful Paint : 2,3 / 2,2 s (était 2,9 / 2,8 s à t1 — en baisse
  de ~0,6 s sur les 2 passes, cohérent avec le LCP Playwright)
- Total Blocking Time : 590 / 720 ms (était 620 / 450 ms à t1 — mixte :
  −30 ms passe 1, +270 ms passe 2, dans la plage observée 450–910 ms ;
  aucun gain établi)
- Cumulative Layout Shift : 0 (2 passes)
- Speed Index : 1,1 / 1,1 s
- Time to Interactive : 2,6 / 2,8 s (était 2,9 s à t1)

Détail : le tour ne touche pas au JS (bundle inchangé) — le score Lighthouse
plat est attendu ; le gain est sur les octets transférés avant le premier
affichage, visible sur le LCP des deux outils. Le TBT reste le levier n° 1.

### Re-mesure boucle t4 (11/11/2026, 2 passes officielles + ABAB)

- **Score performance : 78 / 76** (était 84 / 81 à t2 ; 11 à 14 points sous le
  seuil ≥ 95 — moyenne des 7 passes t4 : 77,3)
- First Contentful Paint : 0,8 s (2 passes)
- Largest Contentful Paint : 2,5 / 2,4 s (était 2,3 / 2,2 s à t2)
- Total Blocking Time : 850 / 1 030 ms (était 590 / 720 ms à t2 — en hausse
  sur les 2 passes, au-delà du bruit affiché ± ~150 ms)
- Cumulative Layout Shift : 0 (2 passes)
- Speed Index : 1,2 / 1,1 s
- Time to Interactive : 2,6 / 2,7 s (était 2,6 / 2,8 s à t2)

Réserve (ABAB, voir `BOUCLE.md`) : le tour ne touche pas au code de `#/jouer`
(bundle +153 o, aucune page `#/jouer` modifiée) et les mesures Playwright
`#/jouer` sont plates — pourtant les 7 passes Lighthouse t4 (78/76/75/81/77/
74/80, TBT 680–1 030 ms) sont en moyenne sous t2 (84/81, TBT 590/720 ms).
ABAB dans la même fenêtre : SANS le tour 81/82 (TBT 650/670 ms), AVEC le tour
79/80 (TBT 750/810 ms) — effet propre du tour ≈ −2 points / +~100 ms de TBT,
dans le bruit, mais le signal défavorable est conservé ici tel quel (pas
effacé). Hypothèse écartée par mesure : le préchargement SW du héros
(95 Ko) n'est PAS la cause — avec préchargement 78/76/75, sans 81/77/74/80 ;
le héros n'est donc pas préchargé (décision documentée : photo de contenu,
comme les photos de plats). Le TBT reste le levier n° 1 ; à re-vérifier à la
prochaine baseline.

### Re-mesure boucle t5 (11/11/2026, 2 passes)

- **Score performance : 78 / 80** (était 78 / 76 à t4 ; 15 à 17 points sous le
  seuil ≥ 95)
- First Contentful Paint : 0,8 s (2 passes)
- Largest Contentful Paint : 2,3 / 2,5 s (était 2,5 / 2,4 s à t4)
- Total Blocking Time : 860 / 700 ms (était 850 / 1 030 ms à t4 — plat, dans
  le bruit ± ~150 ms)
- Cumulative Layout Shift : 0 (2 passes)
- Speed Index : 1,3 / 1,1 s
- Time to Interactive : 3,0 / 2,7 s (était 2,6 / 2,7 s à t4)

**Plat vs t4** (2 passes, dans le bruit) — attendu : le tour ne touche pas au
chemin `#/jouer` du commerce générique. Le TBT reste le levier n° 1.

### Re-mesure boucle t6 (11/11/2026, 2 passes)

- **Score performance : 78 / 79** (était 78 / 80 à t5 ; 16 à 17 points sous le
  seuil ≥ 95)
- First Contentful Paint : 0,8 s (2 passes)
- Largest Contentful Paint : 2,7 / 2,4 s (était 2,3 / 2,5 s à t5)
- Total Blocking Time : 740 / 770 ms (était 860 / 700 ms à t5 — plat, dans
  le bruit ± ~150 ms)
- Cumulative Layout Shift : 0 (2 passes)
- Speed Index : 1,2 / 1,1 s
- Time to Interactive : 2,9 / 2,8 s (était 3,0 / 2,7 s à t5)

**Plat vs t5** (2 passes, dans le bruit) — attendu : le tour ne touche pas au
chemin `#/jouer` du commerce générique. Le TBT reste le levier n° 1.

### Re-mesure boucle t7 (11/11/2026, 2 passes)

- **Score performance : 80 / 81** (était 78 / 79 à t6 ; 14 à 15 points sous le
  seuil ≥ 95)
- First Contentful Paint : 0,8 s (2 passes)
- Largest Contentful Paint : 2,6 / 2,5 s (était 2,7 / 2,4 s à t6)
- Total Blocking Time : 710 / 670 ms (était 740 / 770 ms à t6 — plat, dans
  le bruit ± ~150 ms)
- Cumulative Layout Shift : 0 (2 passes)
- Speed Index : 1,2 / 1,1 s
- Time to Interactive : 2,8 / 2,6 s (était 2,9 / 2,8 s à t6)

**Plat vs t6** (2 passes, dans le bruit) — attendu : le tour ne touche à
aucun JS. Le TBT reste le levier n° 1.

### Re-mesure boucle t9 (11/11/2026, 2 passes)

- **Score performance : 78 / 86** (était 80 / 81 à t7 ; 9 à 17 points sous le
  seuil ≥ 95 — le 86 est la meilleure passe observée depuis t0, TBT 490 ms)
- First Contentful Paint : 0,8 s (2 passes)
- Largest Contentful Paint : 2,6 / 2,2 s (était 2,6 / 2,5 s à t7)
- Total Blocking Time : 780 / 490 ms (était 710 / 670 ms à t7 — passe 2
  basse, bruit ; la moyenne 635 ms est sous celle de t7, 690 ms)
- Cumulative Layout Shift : 0 (2 passes)
- Speed Index : 1,2 / 1,1 s
- Time to Interactive : 2,7 / 2,4 s (était 2,8 / 2,6 s à t7)

**Plat vs t7** (2 passes, dans le bruit — une passe haute à 86) — attendu :
le tour ne touche à aucun JS. Le TBT reste le levier n° 1.

### Re-mesure boucle t10 (11/11/2026, 2 passes)

- **Score performance : 78 / 78** (était 78 / 86 à t9 ; 17 points sous le
  seuil ≥ 95 — le 86 de t9 était une passe isolée, pas une tendance)
- First Contentful Paint : 0,8 s (2 passes)
- Largest Contentful Paint : 2,3 / 2,5 s (était 2,6 / 2,2 s à t9)
- Total Blocking Time : 890 / 850 ms (était 780 / 490 ms à t9 — plat, dans
  le bruit ± ~150 ms ; la moyenne 870 ms est au-dessus de celle de t9,
  635 ms — variance hôte, pas un effet du tour, qui ne touche pas au JS
  du chemin `#/jouer`)
- Cumulative Layout Shift : 0 (2 passes)
- Speed Index : 1,2 / 1,1 s
- Time to Interactive : 2,6 / 2,6 s (était 2,7 / 2,4 s à t9)

**Plat vs t9** (2 passes, dans le bruit) — attendu : le tour ne touche pas
au chemin `#/jouer` initial. Le TBT reste le levier n° 1.

## Parcours scan → lot (à chaud, 4G simulée)

Étapes mesurées (script, sans l'attente humaine entre le scan client et la
validation en caisse — le vrai temps humain est plus long) :

| Étape | Passe 1 | Passe 2 | Passe 3 | Passe 4 | Passe 5 |
| --- | --- | --- | --- | --- | --- |
| Inscription (saisie téléphone + « C'est parti ») | 585 ms | 1069 ms | 1087 ms | 1004 ms | 985 ms |
| Validation en caisse (code équipe + recherche + passage) | 1517 ms | 1609 ms | 1061 ms | 6822 ms | 7891 ms |
| Vérification côté client (« C'est validé ? ») | 280 ms | 286 ms | 259 ms | 295 ms | 394 ms |
| Tirage (clic roue → gain affiché) | 889 ms | 888 ms | 900 ms | 908 ms | 1016 ms |
| **Total des étapes** | **3271 ms** | **3852 ms** | **3307 ms** | **9029 ms** | **10286 ms** |

- Les passes 1–3 ne ralentissaient pas la caisse : leur validation (1,1–1,6 s) est
  sous-estimée. Passes 4–5 (caisse en Slow 4G + CPU ×4, comme le client) :
  **validation 6,8–7,9 s** — c'est elle qui domine le parcours.
- **Taps** (identiques sur les 5 passes) : client **4 clics + 1 saisie** ;
  caisse **3 clics + 2 saisies**.
- Ouverture de la carte après le gain : 468 / 488 / 805 / 670 / 980 ms.
- **Menu → commande et réservation : n'existent pas dans l'app** (commande avec
  paiement écartée par décision, pas de réservation) — aucun parcours à mesurer,
  rien n'est inventé ici.

### Re-mesure P1-U1 (11/11/2026 ~08:45 UTC, 2 passes, même protocole)

| Étape | Passe 1 | Passe 2 |
| --- | --- | --- |
| Inscription (saisie téléphone + « C'est parti ») | 1054 ms | 994 ms |
| Validation en caisse (code équipe + recherche + passage) | 6720 ms | 6926 ms |
| Vérification côté client (« C'est validé ? ») | 366 ms | 312 ms |
| Tirage (clic roue → gain affiché) | 587 ms | 923 ms |
| **Total des étapes** | **8727 ms** | **9155 ms** |

- Arithmétique : passe 1, 1 054 + 6 720 + 366 + 587 = 8 727 ms ; passe 2,
  994 + 6 926 + 312 + 923 = 9 155 ms.
- **Taps identiques** aux 5 passes P0-U0 et à P1-D2 : client **4 clics + 1 saisie** ;
  caisse **3 clics + 2 saisies**. La validation en caisse domine toujours le parcours
  (6,7–6,9 s, caisse en Slow 4G + CPU ×4 comme le client).
- Ouverture de la carte après le gain : 559 / 515 ms.
- Tirage 587 → 923 ms entre les 2 passes (+57 %) : variabilité de mesure, échantillon
  trop petit pour conclure à une amélioration ou une régression.
- **Parcours < 30 s à chaud : étapes scriptées sous 30 s, vérifié** (8,7–9,2 s) ;
  le critère complet avec gestes et attente humains **n'est pas vérifié**
  (pas de téléphone réel — protocole documenté plus haut). Le temps humain réel
  (le client attend que la caisse valide) s'ajoute : **non mesuré**.
  À froid (Render en veille ~60 s + cache vide) : **non mesuré**,
  estimation seulement.

### Re-mesure P2-Q2 (11/11/2026 ~11:36 UTC, 2 passes, même protocole)

| Étape | Passe 1 | Passe 2 | Écart vs P1-U1 (passe 1 / passe 2) |
| --- | --- | --- | --- |
| Inscription (saisie téléphone + « C'est parti ») | 1056 ms | 1035 ms | +2 / +41 ms |
| Validation en caisse (code équipe + recherche + passage) | 4985 ms | 5033 ms | −1 735 / −1 893 ms |
| Vérification côté client (« C'est validé ? ») | 388 ms | 305 ms | +22 / −7 ms |
| Tirage (clic roue → gain affiché) | 559 ms | 581 ms | −28 / −342 ms |
| **Total des étapes** | **6988 ms** | **6954 ms** | **−1 739 / −2 201 ms** |

- Arithmétique : passe 1, 1 056 + 4 985 + 388 + 559 = 6 988 ms ; passe 2,
  1 035 + 5 033 + 305 + 581 = 6 954 ms.
- **Taps identiques** aux passes précédentes : client **4 clics + 1 saisie** ;
  caisse **3 clics + 2 saisies**. La validation en caisse domine toujours le parcours
  (5,0 s, caisse en Slow 4G + CPU ×4 comme le client) mais descend de 6,7–6,9 s à
  5,0 s — la caisse charge le même bundle initial, comprimé.
- Ouverture de la carte après le gain : 710 / 622 ms (était 559 / 515 ms — en hausse
  de ~0,15 s, cause non établie, échantillon insuffisant).
- **Parcours < 30 s à chaud : étapes scriptées sous 30 s, vérifié** (6,9–7,0 s) ;
  le critère complet avec gestes et attente humains **n'est pas vérifié**
  (pas de téléphone réel — protocole documenté plus haut). Le temps humain réel
  (le client attend que la caisse valide) s'ajoute : **non mesuré**.
  À froid (Render en veille ~60 s + cache vide) : **non mesuré**,
  estimation seulement.

### Re-mesure boucle t0 (11/11/2026 ~14:35 UTC, 2 passes, même protocole)

| Étape | Passe 1 | Passe 2 | Écart vs P2-Q2 (passe 1 / passe 2) |
| --- | --- | --- | --- |
| Inscription (saisie téléphone + « C'est parti ») | 993 ms | 992 ms | −63 / −43 ms |
| Validation en caisse (code équipe + recherche + passage) | 4861 ms | 5125 ms | −124 / +92 ms |
| Vérification côté client (« C'est validé ? ») | 320 ms | 304 ms | −68 / −1 ms |
| Tirage (clic roue → gain affiché) | 490 ms | 922 ms | −69 / +341 ms |
| **Total des étapes** | **6664 ms** | **7343 ms** | **−324 / +389 ms** |

- Arithmétique : passe 1, 993 + 4 861 + 320 + 490 = 6 664 ms ; passe 2,
  992 + 5 125 + 304 + 922 = 7 343 ms.
- **Taps identiques** aux passes précédentes : client **4 clics + 1 saisie** ;
  caisse **3 clics + 2 saisies**. La validation en caisse domine toujours le parcours
  (4,9–5,1 s, caisse en Slow 4G + CPU ×4 comme le client).
- Ouverture de la carte après le gain : 592 / 699 ms (était 710 / 622 ms — dans
  le bruit de mesure).
- **Parcours < 30 s à chaud : étapes scriptées sous 30 s, vérifié** (6,7–7,3 s) ;
  le critère complet avec gestes et attente humains **n'est pas vérifié**
  (pas de téléphone réel — protocole documenté plus haut). Le temps humain réel
  (le client attend que la caisse valide) s'ajoute : **non mesuré**.
  À froid (Render en veille ~60 s + cache vide) : **non mesuré**,
  estimation seulement.

### Re-mesure boucle t1 (11/11/2026 ~14:52–14:54 UTC, 3 passes, même protocole)

| Étape | Passe 1 | Passe 2 | Passe 3 |
| --- | --- | --- | --- |
| Inscription (saisie téléphone + « C'est parti ») | 1024 ms | 1010 ms | 1023 ms |
| Validation en caisse (code équipe + recherche + passage) | 4904 ms | 4731 ms | 5123 ms |
| Vérification côté client (« C'est validé ? ») | 371 ms | 306 ms | 313 ms |
| Tirage (clic roue → gain affiché) | 914 ms | 924 ms | 528 ms |
| **Total des étapes** | **7213 ms** | **6971 ms** | **6987 ms** |

- Arithmétique : passe 1, 1 024 + 4 904 + 371 + 914 = 7 213 ms ; passe 2,
  1 010 + 4 731 + 306 + 924 = 6 971 ms ; passe 3,
  1 023 + 5 123 + 313 + 528 = 6 987 ms.
- **Taps identiques** aux passes précédentes : client **4 clics + 1 saisie** ;
  caisse **3 clics + 2 saisies**. La validation en caisse domine toujours le parcours
  (4,7–5,1 s, caisse en Slow 4G + CPU ×4 comme le client).
- Ouverture de la carte après le gain : 600 / 622 / 691 ms (était 592 / 699 ms
  à t0 — **sans régression** : le chunk `QrCode-*.js` (21 Ko) se charge en
  parallèle de l'appel API de la carte, le QR apparaît sans délai mesurable).
- **Parcours < 30 s à chaud : étapes scriptées sous 30 s, vérifié** (7,0–7,2 s) ;
  le critère complet avec gestes et attente humains **n'est pas vérifié**
  (pas de téléphone réel — protocole documenté plus haut). Le temps humain réel
  (le client attend que la caisse valide) s'ajoute : **non mesuré**.
  À froid (Render en veille ~60 s + cache vide) : **non mesuré**,
  estimation seulement.

### Re-mesure boucle t2 (11/11/2026 ~15:15–15:17 UTC, 2 passes, même protocole)

| Étape | Passe 1 | Passe 2 |
| --- | --- | --- |
| Inscription (saisie téléphone + « C'est parti ») | 1016 ms | 995 ms |
| Validation en caisse (code équipe + recherche + passage) | 4331 ms | 4421 ms |
| Vérification côté client (« C'est validé ? ») | 302 ms | 302 ms |
| Tirage (clic roue → gain affiché) | 492 ms | 559 ms |
| **Total des étapes** | **6141 ms** | **6277 ms** |

- Arithmétique : passe 1, 1 016 + 4 331 + 302 + 492 = 6 141 ms ; passe 2,
  995 + 4 421 + 302 + 559 = 6 277 ms.
- **Taps identiques** aux passes précédentes : client **4 clics + 1 saisie** ;
  caisse **3 clics + 2 saisies**.
- Ouverture de la carte après le gain : 581 / 520 ms (était 600 / 622 / 691 ms
  à t1 — **sans régression**).
- **Parcours < 30 s à chaud : étapes scriptées sous 30 s, vérifié** (6,1–6,3 s) ;
  le critère complet avec gestes et attente humains **n'est pas vérifié**
  (pas de téléphone réel — protocole documenté plus haut). Le temps humain réel
  (le client attend que la caisse valide) s'ajoute : **non mesuré**.
  À froid (Render en veille ~60 s + cache vide) : **non mesuré**,
  estimation seulement.

### Re-mesure boucle t4 (11/11/2026 ~16:00–16:10 UTC, 2 passes, même protocole)

| Étape | Passe 1 | Passe 2 |
| --- | --- | --- |
| Inscription (saisie téléphone + « C'est parti ») | 1004 ms | 1027 ms |
| Validation en caisse (code équipe + recherche + passage) | 4834 ms | 4606 ms |
| Vérification côté client (« C'est validé ? ») | 369 ms | 293 ms |
| Tirage (clic roue → gain affiché) | 531 ms | 928 ms |
| **Total des étapes** | **6738 ms** | **6854 ms** |

- Arithmétique : passe 1, 1 004 + 4 834 + 369 + 531 = 6 738 ms ; passe 2,
  1 027 + 4 606 + 293 + 928 = 6 854 ms.
- **Taps identiques** aux passes précédentes : client **4 clics + 1 saisie** ;
  caisse **3 clics + 2 saisies**.
- Ouverture de la carte après le gain : 616 / 684 ms (était 581 / 520 ms à t2 —
  dans la plage observée 520–699 ms depuis t0).
- La validation en caisse (4 606–4 834 ms) est dans la plage historique
  (4 331–5 123 ms depuis t1) ; le tirage passe 2 (928 ms) est une valeur
  isolée (528–924 ms depuis t1) : bruit de mesure, pas un effet du tour
  (le tour ne touche pas au parcours).
- **Parcours < 30 s à chaud : étapes scriptées sous 30 s, vérifié** (6,7–6,9 s) ;
  le critère complet avec gestes et attente humains **n'est pas vérifié**
  (pas de téléphone réel — protocole documenté plus haut). Le temps humain réel
  (le client attend que la caisse valide) s'ajoute : **non mesuré**.
  À froid (Render en veille ~60 s + cache vide) : **non mesuré**,
  estimation seulement.

### Re-mesure boucle t5 (11/11/2026 ~16:15–16:20 UTC, 2 passes, même protocole)

| Étape | Passe 1 | Passe 2 |
| --- | --- | --- |
| Inscription (saisie téléphone + « C'est parti ») | 1032 ms | 994 ms |
| Validation en caisse (code équipe + recherche + passage) | 4883 ms | 4638 ms |
| Vérification côté client (« C'est validé ? ») | 323 ms | 359 ms |
| Tirage (clic roue → gain affiché) | 515 ms | 543 ms |
| **Total des étapes** | **6753 ms** | **6534 ms** |

- Arithmétique : passe 1, 1 032 + 4 883 + 323 + 515 = 6 753 ms ; passe 2,
  994 + 4 638 + 359 + 543 = 6 534 ms.
- **Taps identiques** aux passes précédentes : client **4 clics + 1 saisie** ;
  caisse **3 clics + 2 saisies**.
- Ouverture de la carte après le gain : 786 / 484 ms (était 616 / 684 ms à t4 —
  passe 1 isolée, dans la plage observée 484–786 ms depuis t0).
- La validation en caisse (4 638–4 883 ms) est dans la plage historique
  (4 331–5 123 ms depuis t1) ; le tour ne touche pas au parcours.
- **Parcours < 30 s à chaud : étapes scriptées sous 30 s, vérifié** (6,5–6,8 s) ;
  le critère complet avec gestes et attente humains **n'est pas vérifié**
  (pas de téléphone réel — protocole documenté plus haut). Le temps humain réel
  (le client attend que la caisse valide) s'ajoute : **non mesuré**.
  À froid (Render en veille ~60 s + cache vide) : **non mesuré**,
  estimation seulement.

### Re-mesure boucle t6 (11/11/2026 ~16:35–16:40 UTC, 2 passes, même protocole)

| Étape | Passe 1 | Passe 2 |
| --- | --- | --- |
| Inscription (saisie téléphone + « C'est parti ») | 1021 ms | 1011 ms |
| Validation en caisse (code équipe + recherche + passage) | 4459 ms | 4828 ms |
| Vérification côté client (« C'est validé ? ») | 398 ms | 294 ms |
| Tirage (clic roue → gain affiché) | 518 ms | 444 ms |
| **Total des étapes** | **6396 ms** | **6577 ms** |

- Arithmétique : passe 1, 1 021 + 4 459 + 398 + 518 = 6 396 ms ; passe 2,
  1 011 + 4 828 + 294 + 444 = 6 577 ms.
- **Taps identiques** aux passes précédentes : client **4 clics + 1 saisie** ;
  caisse **3 clics + 2 saisies**.
- Ouverture de la carte après le gain : 513 / 602 ms (était 786 / 484 ms à t5 —
  dans la plage observée 451–786 ms depuis t0 ; la mesure ponctuelle t6 donne
  500–597 ms sur la transition réelle, cohérent).
- La validation en caisse (4 459–4 828 ms) est dans la plage historique
  (4 331–5 123 ms depuis t1) ; le tour ne touche pas au parcours.
- **Parcours < 30 s à chaud : étapes scriptées sous 30 s, vérifié** (6,4–6,6 s) ;
  le critère complet avec gestes et attente humains **n'est pas vérifié**
  (pas de téléphone réel — protocole documenté plus haut). Le temps humain réel
  (le client attend que la caisse valide) s'ajoute : **non mesuré**.
  À froid (Render en veille ~60 s + cache vide) : **non mesuré**,
  estimation seulement.

### Re-mesure boucle t7 (11/11/2026 ~17:00–17:05 UTC, 2 passes, même protocole)

| Étape | Passe 1 | Passe 2 |
| --- | --- | --- |
| Inscription (saisie téléphone + « C'est parti ») | 1005 ms | 1032 ms |
| Validation en caisse (code équipe + recherche + passage) | 4706 ms | 4560 ms |
| Vérification côté client (« C'est validé ? ») | 300 ms | 327 ms |
| Tirage (clic roue → gain affiché) | 501 ms | 538 ms |
| **Total des étapes** | **6512 ms** | **6457 ms** |

- Arithmétique : passe 1, 1 005 + 4 706 + 300 + 501 = 6 512 ms ; passe 2,
  1 032 + 4 560 + 327 + 538 = 6 457 ms.
- **Taps identiques** aux passes précédentes : client **4 clics + 1 saisie** ;
  caisse **3 clics + 2 saisies**.
- Ouverture de la carte après le gain : 640 / 688 ms (était 513 / 602 ms à t6 —
  dans la plage observée 427–786 ms depuis t0 ; la mesure ponctuelle t7 donne
  427–535 ms sur la transition réelle, cohérent).
- La validation en caisse (4 560–4 706 ms) est dans la plage historique
  (4 331–5 123 ms depuis t1) ; le tour ne touche pas au parcours.
- **Parcours < 30 s à chaud : étapes scriptées sous 30 s, vérifié** (6,5–6,5 s) ;
  le critère complet avec gestes et attente humains **n'est pas vérifié**
  (pas de téléphone réel — protocole documenté plus haut). Le temps humain réel
  (le client attend que la caisse valide) s'ajoute : **non mesuré**.
  À froid (Render en veille ~60 s + cache vide) : **non mesuré**,
  estimation seulement.

### Re-mesure boucle t9 (11/11/2026 ~17:15–17:20 UTC, 2 passes, même protocole)

| Étape | Passe 1 | Passe 2 |
| --- | --- | --- |
| Inscription (saisie téléphone + « C'est parti ») | 1044 ms | 1007 ms |
| Validation en caisse (code équipe + recherche + passage) | 4490 ms | 4628 ms |
| Vérification côté client (« C'est validé ? ») | 331 ms | 461 ms |
| Tirage (clic roue → gain affiché) | 988 ms | 600 ms |
| **Total des étapes** | **6853 ms** | **6696 ms** |

- Arithmétique : passe 1, 1 044 + 4 490 + 331 + 988 = 6 853 ms ; passe 2,
  1 007 + 4 628 + 461 + 600 = 6 696 ms.
- **Taps identiques** aux passes précédentes : client **4 clics + 1 saisie** ;
  caisse **3 clics + 2 saisies**.
- Ouverture de la carte après le gain : 607 / 619 ms (était 640 / 688 ms à t7 —
  dans la plage observée 427–786 ms depuis t0).
- La validation en caisse (4 490–4 628 ms) est dans la plage historique
  (4 331–5 123 ms depuis t1) ; le tirage passe 1 (988 ms) est une valeur
  isolée (444–988 ms depuis t1) : bruit de mesure, pas un effet du tour
  (le tour ne touche pas au parcours).
- **Parcours < 30 s à chaud : étapes scriptées sous 30 s, vérifié** (6,7–6,9 s) ;
  le critère complet avec gestes et attente humains **n'est pas vérifié**
  (pas de téléphone réel — protocole documenté plus haut). Le temps humain réel
  (le client attend que la caisse valide) s'ajoute : **non mesuré**.
  À froid (Render en veille ~60 s + cache vide) : **non mesuré**,
  estimation seulement.

### Re-mesure boucle t10 (11/11/2026 ~17:25–17:30 UTC, 2 passes, même protocole)

| Étape | Passe 1 | Passe 2 |
| --- | --- | --- |
| Inscription (saisie téléphone + « C'est parti ») | 1011 ms | 1055 ms |
| Validation en caisse (code équipe + recherche + passage) | 4534 ms | 4611 ms |
| Vérification côté client (« C'est validé ? ») | 329 ms | 327 ms |
| Tirage (clic roue → gain affiché) | 679 ms | 581 ms |
| **Total des étapes** | **6553 ms** | **6574 ms** |

- Arithmétique : passe 1, 1 011 + 4 534 + 329 + 679 = 6 553 ms ; passe 2,
  1 055 + 4 611 + 327 + 581 = 6 574 ms.
- **Taps identiques** aux passes précédentes : client **4 clics + 1 saisie** ;
  caisse **3 clics + 2 saisies**.
- Ouverture de la carte après le gain : 680 / 663 ms (était 607 / 619 ms à t9 —
  dans la plage observée 427–786 ms depuis t0).
- La validation en caisse (4 534–4 611 ms) est dans la plage historique
  (4 331–5 123 ms depuis t1) ; le tour ne touche pas au parcours.
- **Parcours < 30 s à chaud : étapes scriptées sous 30 s, vérifié** (6,6–6,6 s) ;
  le critère complet avec gestes et attente humains **n'est pas vérifié**
  (pas de téléphone réel — protocole documenté plus haut). Le temps humain réel
  (le client attend que la caisse valide) s'ajoute : **non mesuré**.
  À froid (Render en veille ~60 s + cache vide) : **non mesuré**,
  estimation seulement.


## Cohérence DA /10 par écran (cible : NOIR + MAGENTA, registre de la carte)

Noté sur les captures Pixel 7 du 11/11/2026 (commerce de test, sans logo ni menu).

| Écran | Note | Justification (une ligne) |
| --- | --- | --- |
| Jouer | 7/10 | En-tête noir/doré + roue rouge laque réussis ; fond de page clair, bloc initiales « M1 » sans logo, libellé de lot vertical peu lisible. |
| Carte | 7/10 | En-tête noir/doré réussi, tampons clairs ; corps ivoire, encart jaune pâle « À retirer au comptoir » hors registre. |
| Caisse | 6/10 | Boutons rouge/vert contrastés, lisible au comptoir ; fond clair, bouton « Vérifier » gris terne, aucun noir ni magenta. |
| Menu public | 6/10 | En-tête noir/doré réussi ; commerce de test sans menu (état vide mesuré, pas le vrai menu), fond clair. |
| Tableau de bord | 6/10 | En-tête noir, cartes à liseré rouge, chiffres lisibles ; fond clair, pas de magenta, serif/sans-serif mélangés. |
| Clients | 6/10 | Même registre clair, bouton rouge, onglets lisibles ; pas de noir ni de magenta. |
| Roulette (back-office) | 6/10 | QR net, bouton rouge ; fond clair, aucune identité nocturne. |
| Réglages | 5/10 | Formulaire clair et complet mais le plus éloigné : tout en gris/blanc, bouton « Enregistrer » gris-bleu, alors que l'aide dit « l'app est noire et dorée ». |

**Moyenne : 6,1/10.** Le registre nocturne existe déjà sur les en-têtes des pages
clientes (noir + doré + rouge laque) mais le fond de page reste clair/ivoire et le
magenta est absent partout.

## Cohérence DA /10 par écran — après P0-D1 (re-mesure 11/11/2026 ~07:16 UTC, 1 passe)

Noté sur les captures Pixel 7 de `node_modules/.cache/mesure-p0-d1/` (même commerce
de test, sans logo ni menu — mêmes limites que la mesure initiale).

| Écran | Note | Justification (une ligne) |
| --- | --- | --- |
| Jouer | 8/10 | Héros noir+magenta et roue entièrement magenta réussis ; roue à 8 secteurs validée (`roue-8-lots.png` : 6 couleurs alternées, libellés lisibles) ; corps de page encore clair, bloc initiales « M1 » sans logo. |
| Carte | 8/10 | Bandeau noir→magenta, tampon posé et progression magenta, encart « À retirer au comptoir » rose pâle ; bandeau personnalisé `#d1006f` validé (`carte-couleur-perso.png` : sous-titre blanc lisible) ; corps ivoire, encart palier rouge conservé. |
| Caisse | 7/10 | Bouton primaire magenta bien visible, vert de validation conservé ; écran sinon clair, en-tête noir hors de la capture. |
| Menu public | 8/10 | Héros noir+magenta réussi, pilule « Toutes » et prix magenta ; vrai menu validé (`menu-reel.png` : 81 plats, recherche, catégories) ; fond clair. |
| Tableau de bord | 8/10 | En-tête noir, liserés magenta sur chaque carte, navigation mobile magenta ; fond clair, serif/sans-serif mélangés. |
| Clients | 8/10 | Bouton primaire, pilule sélectionnée, progression et navigation magenta ; fond clair. |
| Roulette (back-office) | 7/10 | QR net, bouton primaire magenta, navigation magenta ; fond clair, formulaire inchangé. |
| Réglages | 7/10 | Bouton « Enregistrer » magenta, logo magenta, aide « noire et magenta » à jour ; formulaire toujours gris/blanc. |

**Moyenne : 7,6/10 (était 6,1/10).** Le magenta est désormais présent sur tous les
écrans, le doré a disparu, les contrastes sont AA — mais la cible ≥ 9/10 n'est pas
atteinte : les corps de page restent clairs/ivoire par choix (lisibilité de travail
côté commerçant, AUDIT §6.3) et le commerce de test n'a ni logo ni vrai menu. Aller
plus loin demanderait des corps sombres côté client et/ou le vrai contenu Asian Home —
hors périmètre de P0-D1, à trancher en P1.

## Cohérence DA /10 par écran — après P1-D2 (re-mesure 11/11/2026 ~08:00 UTC, 1 passe)

Noté sur les captures Pixel 7 de `node_modules/.cache/mesure-p1-d2/` (même commerce
de test, sans logo ; vrai menu et carte couleur perso en captures richesse).

| Écran | Note | Justification (une ligne) |
| --- | --- | --- |
| Jouer | 9/10 | Corps sombre cohérent, roue 8 secteurs lisible (`roue-8-lots.png`), champ sombre et carte de gain sombre ; bloc initiales « M1 » sans logo. |
| Carte | 9/10 | Page sombre, carte objet clair ivoire/blanc posée dessus, tampons et progression lisibles ; carte couleur perso validée (`carte-couleur-perso.png` : fond ivoire, bandeau `#d1006f`). |
| Caisse | 7/10 | Inchangée (comptoir clair, hors périmètre P1-D2) ; bouton primaire magenta, vert de validation conservé. |
| Menu public | 9/10 | Fiches plats sombres, prix magenta, recherche sombre ; îlot d'alerte ambre conservé ; vrai menu validé (`menu-reel.png` : 81 plats). |
| Tableau de bord | 8/10 | Inchangé ; en-tête noir, liserés magenta, navigation mobile magenta. |
| Clients | 8/10 | Inchangé ; bouton primaire, pilule sélectionnée, progression et navigation magenta. |
| Roulette (back-office) | 7/10 | Inchangée ; QR net, bouton primaire magenta, navigation magenta. |
| Réglages | 7/10 | Inchangé ; bouton « Enregistrer » magenta, logo magenta, formulaire gris/blanc. |

**Moyenne : 8,0/10 (était 7,6/10).** Les trois écrans client sont à 9/10 ; la cible
globale ≥ 9/10 n'est pas atteinte parce que les écrans commerçant (7–8/10) restent
clairs par choix du lot (lisibilité de travail) — un lot commerçant serait nécessaire
pour aller plus loin. Deux régressions de contraste ont été trouvées par les captures
de la 1re passe et corrigées avant la 2e : le corps de la carte de fidélité devenait
sombre avec des textes restaurés en gris foncé (la règle descendant
`[data-surface-claire] .bg-white` ne couvrait pas la section elle-même — règle
accolée ajoutée), et la carte de gain gardait son dégradé clair avec des textes
passés en blanc (dégradé sombre ajouté en CSS). La revue Codex a trouvé 3 autres
cas limites, corrigés sans nouvelle capture (règles + contrastes testés) : bouton
secondaire de parrainage dans l'îlot clair, lien magenta clair dans les alertes
claires (3,31:1 sur ambre-50 → magenta foncé), bordure rouge du champ invalide
écrasée par la bordure sombre. Temps proches de P0-D1 (1 passe, comparaison non
concluante) ; 0 erreur console, 0 requête échouée. Le bundle initial dépasse le
seuil strict « pas de régression vs 535857 o » de 1,28 % : l'écart est le CSS des
règles P1-D2 elles-mêmes (+4 750 o ; JS initial +0,04 %) — accepté et documenté,
pas nié.

## Cohérence DA /10 par écran — après P1-U1 (re-mesure 11/11/2026 ~08:45 UTC, 2 passes)

Noté sur les captures Pixel 7 de `node_modules/.cache/mesure-p1-u1/` (passe 2 ;
même commerce de test, sans logo ni menu — mêmes limites que la mesure initiale).
Aucun changement de code entre P1-D2 et P1-U1 : les notes sont re-vérifiées, pas
re-calculées sur une nouveauté.

| Écran | Note | Justification (une ligne) |
| --- | --- | --- |
| Jouer | 9/10 | Corps sombre cohérent, roue magenta, champ sombre et carte de gain sombre ; bloc initiales « M1 » sans logo, libellé de lot vertical sur la roue à 2 lots. |
| Carte | 9/10 | Page sombre, carte objet clair ivoire/blanc posée dessus, tampons et progression lisibles ; encart palier rouge conservé. |
| Caisse | 7/10 | Inchangée (comptoir clair, hors périmètre P1-D2) ; bouton primaire magenta, vert de validation conservé, bouton « Vérifier » gris terne. |
| Menu public | 9/10 | Héros noir+magenta, état vide sombre lisible ; commerce de test sans menu (pas le vrai menu 81 plats). |
| Tableau de bord | 8/10 | Inchangé ; en-tête noir, liserés magenta, navigation mobile magenta ; fond clair, serif/sans-serif mélangés. |
| Clients | 8/10 | Inchangé ; bouton primaire, pilule sélectionnée, progression et navigation magenta ; fond clair. |
| Roulette (back-office) | 7/10 | Inchangée ; QR net, bouton primaire magenta, navigation magenta ; fond clair, formulaire inchangé. |
| Réglages | 7/10 | Inchangé ; bouton « Enregistrer » magenta, logo magenta, formulaire gris/blanc, une seule longue page (découpe prévue au lot P1-C7). |

**Moyenne : 8,0/10 (inchangée depuis P1-D2).** Les trois écrans client sont à 9/10 ;
la cible globale ≥ 9/10 n'est pas atteinte parce que les écrans commerçant (7–8/10)
restent clairs par choix (lisibilité de travail) — le lot P1-C7 (finitions écrans
commerçant) est le prochain levier, sans toucher aux corps sombres côté client.

## Seuils de réussite (définis avant la refonte)

| Parcours / métrique | Seuil | Référence antérieure (lot précisé par métrique) | Après P1-U1 (11/11/2026, 2 passes) | Après P2-Q2 (11/11/2026, 2 passes) | Après boucle t0 (11/11/2026, 2 passes) | Après boucle t1 (11/11/2026, 3 passes) |
| --- | --- | --- | --- | --- | --- | --- |
| Scan → lot, à chaud (gestes humains inclus) | < 30 s (critère AUDIT P1-U1) | P0-U0 : ~9,0–10,3 s d'étapes scriptées (hors attente humaine) | Étapes scriptées : 8,7–9,2 s, sous 30 s ; critère avec gestes et attente humains : non vérifié | Étapes scriptées : 6,9–7,0 s, sous 30 s ; critère avec gestes et attente humains : non vérifié | Étapes scriptées : 6,7–7,3 s, sous 30 s ; critère avec gestes et attente humains : non vérifié | Étapes scriptées : 7,0–7,2 s, sous 30 s ; critère avec gestes et attente humains : non vérifié |
| Premier affichage `#/jouer` en Slow 4G | < 4 s | P0-U0 : 4,02–4,24 s (seuil non atteint) | 4,04–4,24 s (seuil non atteint) | **2,29–2,43 s (seuil atteint)** | **2,20–2,26 s (seuil atteint)** | **2,23–2,36 s (seuil atteint)** |
| LCP `#/jouer` | < 2,5 s | P0-U0 : 4,06–4,18 s | 4,02–4,22 s | **2,27–2,37 s (seuil atteint, méthode Playwright Slow 4G)** ; 2,6–3,2 s en Lighthouse (throttling simulé, non interchangeable) | **2,15–2,25 s (seuil atteint, méthode Playwright Slow 4G)** ; 2,5–2,7 s en Lighthouse (throttling simulé, non interchangeable) | **2,22–2,34 s (seuil atteint, méthode Playwright Slow 4G)** ; 2,8–2,9 s en Lighthouse (throttling simulé, non interchangeable) |
| Lighthouse mobile `#/jouer` | ≥ 95 (critère d'arrêt de la boucle) | P0-U0 : 81 (76 à la 1re passe) | 79 (score identique sur les deux passes) | 73 / 81 (seuil non atteint ; LCP 2,6–3,2 s, TBT 660–840 ms en hausse) | 77 / 81 (seuil non atteint ; LCP 2,5–2,7 s, TBT 630–910 ms en hausse) | 80 / 85 (seuil non atteint ; LCP 2,8–2,9 s, TBT 450–620 ms en baisse) |
| Erreurs console | 0 | P0-D1 : 0 erreur, 0 requête échouée — seuil atteint | 0 erreur, 0 requête échouée (2 passes — seuil atteint) | 0 erreur, 0 requête échouée (2 passes — seuil atteint) | 0 erreur, 0 requête échouée (2 passes — seuil atteint) | 0 erreur, 0 requête échouée (3 passes — seuil atteint) |
| Bundle initial (JS + CSS, non gzipé) | pas de régression vs 535857 o | P1-D2 : 542738 o (+1,28 % vs 535857 o — seuil strict dépassé : +4 750 o de CSS, ce sont les règles P1-D2 elles-mêmes ; JS initial +184 o (+0,04 %) ; écart accepté et documenté, voir § DA après P1-D2) | 543409 o (+1,41 % vs 535857 o ; +671 o vs P1-D2, cause non établie ; écart accepté et documenté, voir § Bundle) | 551656 o (+2,95 % vs 535857 o ; +8 247 o vs P1-U1 : JS initial +8 189 o — dont +6 361 o nets P2-Q1, dictionnaire EN + code, et +1 828 o des lots P0-S11/P1-M2/P1-M3 — et CSS +58 o ; le non-gzipé croît mais le servi compressé chute : total initial brotli 154 758 o ; écart accepté et documenté, voir § Bundle) | 552098 o (+3,03 % vs 535857 o ; +442 o vs P2-Q2 : JS initial +398 o, CSS +44 o — lots P2-Q3 à P2-Q6, cause non isolée par lot ; écart accepté et documenté, voir § Bundle) | 523794 o (−2,25 % vs 535857 o ; −28 304 o vs t0 : JS initial −28 304 o — QR différé — et CSS inchangé ; seuil strict repassé sous la référence ; voir § Bundle) |
| Note DA moyenne | ≥ 9/10 | P1-D2 : 8,0/10 (était 7,6/10 après P0-D1, 6,1/10 à P0-U0 — écrans client 9/10, écrans commerçant 7–8/10 inchangés, voir § DA après P1-D2) | 8,0/10 (inchangée — écrans client 9/10, écrans commerçant 7–8/10, voir § DA après P1-U1) | 8,0/10 (inchangée — aucun changement visuel dans ce lot) | 8,0/10 (inchangée — baseline de la boucle, aucun changement visuel) | 8,0/10 (inchangée — repli « Chargement du QR code… » dans la carte, pas de changement visuel durable) |

Ce lot (P2-Q2) démontre une amélioration réelle sur les temps (premier affichage et
LCP sous leurs seuils en Slow 4G Playwright, parcours 8,7–9,2 → 6,9–7,0 s) mais ne
valide pas encore le critère d'arrêt de la boucle (Lighthouse 73/81 < 95, TBT en
hausse) ni le critère P1-U1 sur téléphone réel. La règle ci-dessous concerne les
lots de modification issus de la boucle.

Un tour de la boucle d'amélioration ne fusionne que s'il améliore au moins une
de ces métriques sans régresser les autres (AUDIT.md §7, boucle continue).

## Cohérence DA /10 — écran de jeu après roue v2 R5+R8 (re-mesure 12/11/2026 ~14:00 UTC, 1 passe)

Méthode identique aux notations précédentes : captures Playwright Pixel 7 (Chromium, build API,
serveur E2E local), commerce de test 6 lots en accès libre, magenta par défaut ET couleur de
commerce `#3b2d8f` ; roue au repos, en rotation (2 instants), à l'arrêt sur le gain, rayons
ouverts. Captures avant/après : `node_modules/.cache/boucle-roue/captures-R58-avant/` et
`captures-R58-apres/` (non versionnées).

| Écran | Avant | Après | Justification |
| --- | --- | --- | --- |
| Jouer (roue) | 9/10 | **9,5/10** | Roue « casino » réussie : anneau en relief (reflet haut, ombre basse, filet), 16 ampoules en poursuite pendant la rotation, brillant bombé et ombre interne du moyeu, filets nets, moyeu à initiale serif, pointeur goutte qui rebondit, rayons discrets au gain, couleur du commerce reprise par la roue et la légende ; reste visible : libellés de la moitié gauche à l'envers au repos, légende et cadre restés magenta sur une couleur perso, émoji 🎡 multicolore du bouton « Tourner », libellés abrégés (« Dessert… », règle des 12 caractères). |

Cible 10/10 **non atteinte** : note non gonflée ; ce qui manque est listé dans `BOUCLE.md`
(roue v2 R5+R8).

## Cohérence DA /10 — écran de jeu après roue v2 R-t1 polish visuel (re-mesure 12/11/2026 ~17:40 UTC, 1 passe)

Même méthode et même harnais que R5+R8 (Playwright Pixel 7, build API, serveur E2E local,
6 lots en accès libre, magenta par défaut ET couleur de commerce `#3b2d8f`). Captures :
`node_modules/.cache/boucle-roue/captures-polish1-avant/` et `captures-polish1-apres/`
(non versionnées).

| Écran | Avant | Après | Justification |
| --- | --- | --- | --- |
| Jouer (roue) | 9,5/10 | **9,7/10** | Corrigé et visible sur les captures : libellés de la moitié gauche lisibles au repos (« Café offert », « Dommage », « 10 points… » ne sont plus tête en bas) ; sur `#3b2d8f`, le cadre (filet, halo, fond bas), le titre « À gagner » et l'anneau des pastilles prennent la teinte du commerce (plus aucun magenta dans le cadre de la roue) ; émoji 🎡 multicolore remplacé par un signe de roue blanc dessiné en CSS ; titre « À gagner » corail (#ff4d6d) ramené au magenta clair de la roue en mode par défaut. Reste visible, d'où pas 10 : sur une couleur de commerce, le bouton « Tourner » reste magenta (fond blanc-sur-teinte non garanti ≥ 4,5:1 pour toute couleur, et hors de portée des variables sans JS initial) ; libellés abrégés (« Dessert… », règle des 12 caractères) ; numéros de secteur (roues > 8 lots) non retournés en bas de roue. |

Cible 10/10 **non atteinte** : note non gonflée ; détail dans `BOUCLE.md` (R-t1).

## Menu visuel — mesures avant/après (13/11/2026)

Page `#/menu` d'Asian Home (menu de repli réel, 81 plats), protocole identique avant et
après : `scripts/mesurer-menu-asian-home.mjs` (Playwright Pixel 7, Slow 4G, CPU ×4,
2 passes) et mesure du poids visuel après défilement complet aller-retour (script de
mission, SW bloqués, cache désactivé). Branche `menu/visuel-interactif`.

| Mesure | Avant | Après | Lecture |
| --- | --- | --- | --- |
| FCP menu (2 passes) | 1 188 / 1 192 ms | 700 / 680 ms | pas de régression (variance inter-runs forte sur cette VM) |
| LCP menu (2 passes) | 4 496 / 4 796 ms (héros) | 2 572 / 2 356 ms (héros) | pas de régression |
| Visuels avant tout défilement | 56 902 o (logo + héros) | 177 096 o | +120 194 o : les 7 premières photos du rail « En photos », paresseuses (`loading="lazy"`), situées juste sous le bandeau prix — elles entrent dans la marge de préchargement du navigateur |
| Poids visuel après défilement complet | 164 150 o (17 fichiers) | 424 316 o (28 fichiers) | +260 166 o : les 11 fiches photo en grande taille chargées au fil du défilement (avant : vignettes seules dans la liste, fiches seulement à l'ouverture d'un détail) — c'est le gain visuel lui-même, jamais bloquant |
| Bundle JS initial | 482 374 o | 482 531 o | plafond épinglé 484 422 o inchangé ; la page menu reste un chunk différé |

Détail construit et mesures complètes : `MENU-VISUEL-RAPPORT.md`. Aucun prix ni aucune
donnée du menu n'a changé ; inventaire photos inchangé (11 plats avec photo vérifiée,
70 sans — extension Instagram/Google/linktr.ee du 13/11/2026 : 0 nouvelle photo,
voir `public/visuels/SOURCES.md`).

## Expérience 10/10 — mesures de laboratoire locales (13/11/2026, lot 3)

**Mesures de laboratoire locales, pas des p75 terrain.** Même protocole que le menu visuel
(`scripts/mesurer-menu-asian-home.mjs`) : serveur E2E local (SQLite temporaire), commerce créé sous le nom
« Asian Home Paris », Chromium Pixel 7, Slow 4G (150 ms, 1,6 Mbit/s) + CPU ×4, cache désactivé, service workers
bloqués, une page neuve par mesure, navigateur relancé à chaque passe, 3 s d'attente après `load`. Script de la
mesure : `node_modules/.cache/experience/mesure-lot3.mjs` (ajoute le CLS et un repère « contenu utile » = premier
instant où l'élément propre à la page est dans le DOM). `#/commande` : second commerce avec le menu réel enregistré
et la commande activée (la page ne lit que le menu enregistré).

| Page | Mesure | Avant | Après (3 passes) | Lecture |
| --- | --- | --- | --- | --- |
| `#/menu` | FCP | v1, rapport menu visuel : 700 / 680 ms ; v1 remesurée ce jour : 676 / 688 / 680 ms | v2 : 672 / 676 / 676 ms | aucune régression |
| `#/menu` | LCP (héros) | v1, rapport : 2 572 / 2 356 ms ; v1 ce jour : 2 432 / 2 372 / 2 408 ms | v2 : 2 440 / 2 424 / 2 476 ms | écart ≤ 70 ms, dans la variance de la VM |
| `#/menu` | contenu utile (1re catégorie) | v1 ce jour : 2 004 / 1 953 / 1 987 ms | v2 : 1 940 / 1 998 / 1 977 ms | identique |
| `#/bienvenue` | FCP / LCP (titre) | page nouvelle | 668 / 676 / 668 ms ; 1 892 / 1 940 / 1 900 ms | — |
| `#/commande` | FCP | page nouvelle | 664 / 704 / 676 ms | — |
| `#/commande` | LCP | page nouvelle | = FCP (logo de l'écran de chargement) | les lignes du menu sont plus petites que ce logo : le LCP ne dit rien ici, voir la ligne suivante |
| `#/commande` | contenu utile (1er bouton « Ajouter ») | page nouvelle | 1 970 / 1 980 / 1 982 ms | — |
| toutes | CLS (layout-shift, sans entrée récente) | v1 menu : 0 | 0 au chargement sur les 3 pages ; 0 sur `#/menu` après défilement complet aller-retour | mesuré par PerformanceObserver dans Chromium ; aucun décalage |
| toutes | débordement horizontal | — | 412 = 412 px sur les 3 pages et sur `#/cuisine` | — |

v1 remesurée ce jour = `src/pages/MenuPublic.tsx` du commit précédant `aef6f17` (seul fichier du menu v2), même
build et même session que la v2 : c'est la comparaison la plus juste ; les chiffres du rapport menu visuel sont
rappelés tels quels. L'écran cuisine (`#/cuisine`, derrière le PIN) n'est pas mesuré : chunk différé de 11 544 o,
aucun visuel.

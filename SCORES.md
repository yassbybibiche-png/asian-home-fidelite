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

Suite verte : **1163/1163** (`npm test`, typechecks inclus — 1090 après P2-Q2, +73 tests
P2-Q3 à P2-Q6 ; voir `JOURNAL.md`).

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

**Re-mesure P2-Q2 (11/11/2026 ~11:36 UTC, 2 passes, `node_modules/.cache/mesure-p2-q2/`,
`resultats-passe1.json` + `resultats-passe2.json`) : 0 erreur console, 0 requête
échouée, sur les 2 passes.** Temps des 2 passes : premier affichage `#/jouer`
2 428 / 2 285 ms (LCP 2 368 / 2 272 ms, élément `p.titre-carte`) ; parcours
scan → lot 6 988 / 6 954 ms d'étapes (taps identiques) ; ouverture de la carte
710 / 622 ms ; premier affichage `#/menu` 930 / 1 092 ms par hash, 1 764 / 1 765 ms
en chargement direct (LCP 1 684 / 1 780 ms). Captures : 9 écrans, passe 2 (la passe 1
n'a gardé que son JSON).

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

| Parcours / métrique | Seuil | Référence antérieure (lot précisé par métrique) | Après P1-U1 (11/11/2026, 2 passes) | Après P2-Q2 (11/11/2026, 2 passes) |
| --- | --- | --- | --- | --- |
| Scan → lot, à chaud (gestes humains inclus) | < 30 s (critère AUDIT P1-U1) | P0-U0 : ~9,0–10,3 s d'étapes scriptées (hors attente humaine) | Étapes scriptées : 8,7–9,2 s, sous 30 s ; critère avec gestes et attente humains : non vérifié | Étapes scriptées : 6,9–7,0 s, sous 30 s ; critère avec gestes et attente humains : non vérifié |
| Premier affichage `#/jouer` en Slow 4G | < 4 s | P0-U0 : 4,02–4,24 s (seuil non atteint) | 4,04–4,24 s (seuil non atteint) | **2,29–2,43 s (seuil atteint)** |
| LCP `#/jouer` | < 2,5 s | P0-U0 : 4,06–4,18 s | 4,02–4,22 s | **2,27–2,37 s (seuil atteint, méthode Playwright Slow 4G)** ; 2,6–3,2 s en Lighthouse (throttling simulé, non interchangeable) |
| Lighthouse mobile `#/jouer` | ≥ 95 (critère d'arrêt de la boucle) | P0-U0 : 81 (76 à la 1re passe) | 79 (score identique sur les deux passes) | 73 / 81 (seuil non atteint ; LCP 2,6–3,2 s, TBT 660–840 ms en hausse) |
| Erreurs console | 0 | P0-D1 : 0 erreur, 0 requête échouée — seuil atteint | 0 erreur, 0 requête échouée (2 passes — seuil atteint) | 0 erreur, 0 requête échouée (2 passes — seuil atteint) |
| Bundle initial (JS + CSS, non gzipé) | pas de régression vs 535857 o | P1-D2 : 542738 o (+1,28 % vs 535857 o — seuil strict dépassé : +4 750 o de CSS, ce sont les règles P1-D2 elles-mêmes ; JS initial +184 o (+0,04 %) ; écart accepté et documenté, voir § DA après P1-D2) | 543409 o (+1,41 % vs 535857 o ; +671 o vs P1-D2, cause non établie ; écart accepté et documenté, voir § Bundle) | 551656 o (+2,95 % vs 535857 o ; +8 247 o vs P1-U1 : JS initial +8 189 o — dont +6 361 o nets P2-Q1, dictionnaire EN + code, et +1 828 o des lots P0-S11/P1-M2/P1-M3 — et CSS +58 o ; le non-gzipé croît mais le servi compressé chute : total initial brotli 154 758 o ; écart accepté et documenté, voir § Bundle) |
| Note DA moyenne | ≥ 9/10 | P1-D2 : 8,0/10 (était 7,6/10 après P0-D1, 6,1/10 à P0-U0 — écrans client 9/10, écrans commerçant 7–8/10 inchangés, voir § DA après P1-D2) | 8,0/10 (inchangée — écrans client 9/10, écrans commerçant 7–8/10, voir § DA après P1-U1) | 8,0/10 (inchangée — aucun changement visuel dans ce lot) |

Ce lot (P2-Q2) démontre une amélioration réelle sur les temps (premier affichage et
LCP sous leurs seuils en Slow 4G Playwright, parcours 8,7–9,2 → 6,9–7,0 s) mais ne
valide pas encore le critère d'arrêt de la boucle (Lighthouse 73/81 < 95, TBT en
hausse) ni le critère P1-U1 sur téléphone réel. La règle ci-dessous concerne les
lots de modification issus de la boucle.

Un tour de la boucle d'amélioration ne fusionne que s'il améliore au moins une
de ces métriques sans régresser les autres (AUDIT.md §7, boucle continue).

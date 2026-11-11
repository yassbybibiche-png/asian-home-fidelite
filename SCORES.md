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

## Bundle (build frais, mode par défaut, 11/11/2026 — après P0-D1)

Définition unique : **JS initial non gzipé** = script d'entrée de `index.html` +
ses imports statiques (méthode `fichiersInitiaux` de
`tests/performance-bundle-p2-q2.test.ts`, pas les `import()` dynamiques) ;
**CSS** = la feuille de `dist/assets` ; **total** = JS initial + CSS.

- JS initial non gzipé : 472428 o (461,4 Ko) — `index-CkC0YEsb.js` 349193 o +
  `ui-D9uK5kXs.js` 122636 o + `rolldown-runtime-WkwZ5CU-.js` 599 o.
- CSS non gzipé : 64672 o (63,2 Ko) — `index-DQdUu_ya.css`.
- Total initial : 537100 o (524,5 Ko).
- JS total (tous chunks) : 780638 o (762,3 Ko) ; 22 chunks ; plus gros chunk : 349193 o
  (limite test : 500 000 o — respectée).
- Repères historiques : avant P2-Q2 601720 o ; après P2-Q2 450,2 Ko (JS initial).
  Le JS initial a repris ~10 Ko depuis (lots P0-S10 et suivants).
- Avertissements de build : 0 (aucun « chunk > 500 kB », aucune erreur).

## Couverture de tests

Suite verte : **968/968** (`npm test`, typechecks inclus — 950 avant P0-D1, +15 thème, +3 correctif 404).

- Couverture globale : 97,84 % lignes / 91,43 % branches / 92,92 % fonctions
  (`node --test --experimental-test-coverage`, suite verte, 11/11/2026).
- Fichiers les plus faibles : `pwa.ts` 55,00 %, `router.ts` 83,52 %, `points.ts` 83,75 %.

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

## npm audit

**Non mesurable sur cette VM** : `npm audit` retourne 403 `policy_denied` sur
`registry.npmjs.org/-/npm/v1/security/audits/quick` (politique réseau de la VM).
À mesurer ailleurs (poste de développement ou CI) avant de conclure.

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
| Jouer | 8/10 | Héros noir+magenta et roue entièrement magenta réussis ; corps de page encore clair, bloc initiales « M1 » sans logo, roue à 1 secteur = disque magenta uni. |
| Carte | 8/10 | Bandeau noir→magenta, tampon posé et progression magenta, encart « À retirer au comptoir » rose pâle ; corps ivoire, encart palier rouge conservé. |
| Caisse | 7/10 | Bouton primaire magenta bien visible, vert de validation conservé ; écran sinon clair, en-tête noir hors de la capture. |
| Menu public | 7/10 | Héros noir+magenta réussi, lien magenta ; commerce de test sans menu (état vide mesuré, pas le vrai menu), fond clair. |
| Tableau de bord | 8/10 | En-tête noir, liserés magenta sur chaque carte, navigation mobile magenta ; fond clair, serif/sans-serif mélangés. |
| Clients | 8/10 | Bouton primaire, pilule sélectionnée, progression et navigation magenta ; fond clair. |
| Roulette (back-office) | 7/10 | QR net, bouton primaire magenta, navigation magenta ; fond clair, formulaire inchangé. |
| Réglages | 7/10 | Bouton « Enregistrer » magenta, logo magenta, aide « noire et magenta » à jour ; formulaire toujours gris/blanc. |

**Moyenne : 7,5/10 (était 6,1/10).** Le magenta est désormais présent sur tous les
écrans, le doré a disparu, les contrastes sont AA — mais la cible ≥ 9/10 n'est pas
atteinte : les corps de page restent clairs/ivoire par choix (lisibilité de travail
côté commerçant, AUDIT §6.3) et le commerce de test n'a ni logo ni vrai menu. Aller
plus loin demanderait des corps sombres côté client et/ou le vrai contenu Asian Home —
hors périmètre de P0-D1, à trancher en P1.

## Seuils de réussite (définis avant la refonte)

| Parcours / métrique | Seuil | Mesure initiale |
| --- | --- | --- |
| Scan → lot, à chaud (gestes humains inclus) | < 30 s (critère AUDIT P1-U1) | ~9,0–10,3 s d'étapes scriptées (hors attente humaine) |
| Premier affichage `#/jouer` en Slow 4G | < 4 s | 4,02–4,24 s (seuil non atteint) |
| LCP `#/jouer` | < 2,5 s | 4,06–4,18 s |
| Lighthouse mobile `#/jouer` | ≥ 95 (critère d'arrêt de la boucle) | 81 (76 à la 1re passe) |
| Erreurs console | 0 | 0 (re-mesure P0-D1 : 0 erreur, 0 requête échouée — seuil atteint) |
| Bundle initial (JS + CSS, non gzipé) | pas de régression vs 535857 o | 537100 o (+0,23 % — pas de régression) |
| Note DA moyenne | ≥ 9/10 | 7,5/10 (était 6,1/10 — seuil non atteint, voir § DA après P0-D1) |

Un tour de la boucle d'amélioration ne fusionne que s'il améliore au moins une
de ces métriques sans régresser les autres (AUDIT.md §7, boucle continue).

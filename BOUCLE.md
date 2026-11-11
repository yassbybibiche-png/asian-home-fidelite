# BOUCLE — Amélioration continue (après les lots P0/P1/P2)

Décidée par l'utilisateur le 10/11/2026 ~22h15, après le plan appliqué et les tests
verts. Règles exactes, méthode de mesure, journal des tours. Le détail chiffré de
chaque tour vit dans `SCORES.md` ; la liste des changements fusionnés, avec
justification et mesure avant/après, vit dans `CHANGELOG.md`.

## Règles (non négociables, consignes utilisateur 10/11 ~22h14-22h15)

- Production https://asian-home-fidelite.onrender.com, master `4862968` — **jamais
  touchée** : ni master ni production. Tout se fait sur des branches
  `autonome/boucle-t<N>-<sujet>`, fusionnées `--no-ff` dans `autonome/integration`
  et poussées.
- Aucun secret dans le code/commits ; aucun envoi réel (SMS/e-mail/réponse Google)
  ni paiement réel ; tests verts avant le tour suivant.
- Ne jamais modifier un test pour le faire passer. Si un tour casse un test, le
  tour est annulé — sauf si le test lui-même est prouvé faux : preuve documentée
  ici et validation par Codex avant toute touche.
- Ne supprimer aucune fonction ; ne toucher ni aux probabilités des lots, ni aux
  prix, ni aux textes légaux (les signaler).
- DA NOIR + MAGENTA.
- **Un seul changement par tour**, sur branche dédiée.
- **Fusion seulement si MIEUX sans régression** : un score qui s'améliore, aucun
  qui se dégrade au-delà du bruit de mesure. En cas de doute, refaire la mesure
  une 2e fois avant de décider. Un tour sans gain mesurable = tour annulé, branche
  supprimée, noté dans le journal ci-dessous.
- **Revue Codex 5 points max par tour fusionné** (lecture seule,
  `~/.local/bin/codex exec "..." < /dev/null` avec `timeout 600` — stdin fermé
  obligatoire ; si Codex atteint une limite d'usage, réessayer jusqu'à 3 fois).
  Corriger ce qui est fondé, noter ce qui est ignoré et pourquoi.
- **Regard neuf toutes les 5 itérations** : relecture critique des hypothèses (ce
  qu'on mesure est-il encore le bon levier ?).
- **ARRÊT** à la première condition atteinte : 3 tours consécutifs sans gain
  mesurable, OU 25 tours, OU Lighthouse ≥ 95 + scan → lot < 30 s + DA ≥ 9.
  Ne pas dépasser 25 tours. 3 tours sans gain = arrêt propre, pas un échec.

## Méthode de mesure (identique avant et après chaque tour)

- **Scripts** : `node scripts/mesurer-scores.mjs` (2 passes, ports distincts,
  sorties `node_modules/.cache/mesure-boucle-t<N>/resultats-passe<N>.json`) et
  `node scripts/mesurer-lighthouse.mjs` (2 passes,
  `lighthouse-passe<N>.json`). Protocole : Pixel 7, Slow 4G + CPU ×4, serveur
  E2E local (voir `SCORES.md` § Protocole).
- **Bundle** : build frais `npm run build`, tailles lues dans `dist/assets` avec
  la définition de `tests/performance-bundle-p2-q2.test.ts` (JS initial = entrée
  + imports statiques ; CSS = feuille de `dist/assets`).
- **Tests** : `npm test` complet (typechecks inclus) + E2E
  (`npm run test:e2e` quand le tour touche un parcours).
- **Bruit de mesure** (observé) : premier affichage ± ~0,2 s entre passes,
  Lighthouse ± 5 points d'une passe à l'autre, TBT ± ~150 ms. Un gain inférieur
  à ces marges n'est pas un gain : refaire la mesure avant de décider.
- **SCORES.md mis à jour à chaque tour** (figures du haut de § Bundle = build
  frais courant — le test `tests/scores-p0-u0.test.ts` lit la PREMIÈRE occurrence
  de chaque chiffre et la compare à un build frais à 5 % près ; toute nouvelle
  section de bundle va donc APRÈS la section de référence, jamais avant).
- **Compteurs de tests** : `README.md` (`**N tests`, `N fichiers, suite verte`)
  et `SCORES.md` (`**N/N**`) doivent rester cohérents — le test
  `tests/documentation-p2-q5.test.ts` les recoupe.

## Leviers connus en attente (à vérifier par mesure, pas à croire sur parole)

- Lighthouse TBT en hausse de 660–840 ms après P2-Q2/Q3/Q4 (cause inconnue).
- Premier affichage ~2,3–2,4 s vs cible < 2 s.
- DA 8,0/10 vs ≥ 9 (écrans commerçant restés clairs par choix — ne pas les
  assombrir sans raison mesurée).
- Marge bundle très fine : JS initial 481 332 o à t0, à 44 o sous la limite
  `INITIAL_AVANT × 0,8` (481 376 o) du test P2-Q2 — toute croissance du JS
  initial casse ce test.
- `npm audit` retourne 403 `policy_denied` sur cette VM (le noter, ne pas le
  contourner).
- Réveil à froid Render ~60 s jamais mesuré ; aucun rendu réel 375/390 px vérifié
  sur téléphone.

## Leviers examinés et ÉCARTÉS (ne pas les reproposer sans fait nouveau)

- **Caisse et CartePublique en `React.lazy` hors bundle initial** : écarté. Le
  test `tests/performance-bundle-p2-q2.test.ts` épingle les imports statiques de
  Jouer/CartePublique/Caisse et exige le code de la caisse dans le bundle initial
  servi par le cache du service worker (caisse hors ligne après une seule visite
  en ligne). Ce n'est pas un test faux : c'est une décision produit (comptoir
  hors ligne). Le découpage doit donc passer par les dépendances partagées, pas
  par les pages elles-mêmes.
- **Logo `/visuels/logo.png` (600×600, 74 Ko) → WebP** : écarté en l'état. Le
  fichier est une fixture de tests (`tests/logo-p1-b5.test.ts`,
  `tests/supabase.test.ts` : vrai PNG 600×600 pour valider l'upload) et le test
  `tests/chargement-p0-u1.test.ts` épingle le chemin dans l'écran de chargement
  et l'existence du fichier. Une variante optimisée séparée reste envisageable
  (nouveau fichier, `logo.png` intact) — à mesurer comme un tour à part entière.
  → Retenu comme tour 2 sous forme `<picture>` (source WebP + repli PNG) :
  le test P0-U1 continue de passer sans modification (il lit la balise `<img>`
  de repli), `logo.png` reste intact partout ailleurs.
- **`seed.json` en import dynamique (délocaliser le seed du bundle initial)**
  : examiné et ÉCARTÉ (boucle t2). Le seed (27 Ko de sources) n'est parcouru
  qu'en mode local (`seedRecale`, `depot.ts`) ; en mode API il ne coûte que
  son transfert (~6–8 Ko brotli) et son analyse (~quelques ms) — le rendre
  asynchrone ferait passer `seedRecale` en async et se propagerait au store
  et aux tests, pour un gain attendu < 50 ms. Pas de fait nouveau sans mesure.

## Journal des tours

### Tour 2 — `autonome/boucle-t2-logo-chargement` (fusionné)

Sujet : l'écran de chargement (`index.html`, affiché avant le JS) charge
`/visuels/logo.png` (600×600, 74 451 o) affiché à 96×96 — 31 % des octets du
premier affichage, en concurrence avec le JS sur la 4G lente. Nouveau fichier
`public/visuels/logo-petit.webp` (192×192, WebP q80, ~4,9 Ko, généré depuis le
vrai logo par Pillow) servi en premier via `<picture>` (repli PNG inchangé) ;
ajouté au préchargement du service worker ; documenté dans
`public/visuels/SOURCES.md`. `logo.png` reste intact (logo du commerce, repli,
fixtures de tests). Hypothèse : premier affichage −~0,2–0,3 s en Slow 4G,
LCP en baisse, Lighthouse +1–3 points, TBT plat. Vérification : le journal des
requêtes de la mesure t2 doit montrer `logo-petit.webp` et plus `logo.png` sur
`#/jouer`. Résultat mesuré (voir SCORES.md § « Re-mesure boucle t2 ») :
premier affichage 2 355/2 232/2 235 → 2 078/1 861 ms (moyenne −304 ms), LCP
2 340/2 220/2 224 → 2 028/1 812 ms (moyenne −341 ms), parcours 7 213/6 971/
6 987 → 6 141/6 277 ms (la validation en caisse gagne aussi : chaque
chargement de page affiche l'écran de chargement) ; Lighthouse 80/85 → 84/81
(plat, bruit), LCP Lighthouse 2,9/2,8 → 2,3/2,2 s, TBT 620/450 → 590/720 ms
(mixte, aucun gain établi) ; bundle inchangé (pas de JS) ; 0 erreur console,
0 requête échouée ; journal des requêtes : `logo-petit.webp` servi, plus
aucun `logo.png` sur `#/jouer`. **Tests épinglés** : `photos-menu.test.ts:68`
(filtre `menu-` — preuve ci-dessous, revue Codex t2 point 3 : légitime) et
`mesure-p1-u1.test.ts:27` (extraction bornée à la sous-section — preuve
ci-dessous, revue Codex ciblée : légitime, aucune assertion retirée).
**Revue Codex t2 (5 points)** : 1. défaut hors ligne du SW — `fichier()` ne
consultait que `CACHE_FICHIERS`, le préchargement (`CACHE_APP`) n'était pas
servi hors ligne → repli `caches.match` ajouté + test de régression (vérifié :
échoue sans le correctif, passe avec) ; 2. `<picture>` correct, mais le PNG
n'est pas un repli en cas d'échec de chargement → commentaire du test corrigé
(repli = format, pas hors ligne) ; 3. correction du test menu légitime
(appliquée) ; 4. lecture des dimensions WebP fragile mais correcte pour ce
fichier → assertions chunk `VP8 ` + signature de trame ajoutées ; 5. mentions
« suite verte » anticipées dans README/SCORES → corrigées après le passage
réel (1171/1171).
**Décision : FUSIONNÉ** — premier affichage et LCP en baisse sur les
2 passes au-delà du bruit, parcours en baisse, Lighthouse plat, aucune
régression au-delà du bruit.

### Test épinglé par le tour 2 — preuve et validation Codex requise

Le tour 2 casse `tests/photos-menu.test.ts:68`, qui liste tous les `.webp` de
`public/visuels/` et exige l'égalité stricte avec les 18 fichiers du menu :
`assert.deepEqual(presents.sort(), [...FICHIERS].sort())`. Preuve que le test
est faux dans sa prémisse, pas dans son exigence :
- l'exigence (« exactement les 18 `menu-*.webp` attendus, aucun autre ») est
  intacte : `logo-petit.webp` n'est pas un `menu-*.webp` (ni par son nom, ni
  par son rôle — variante du logo pour l'écran de chargement) ;
- seule sa prémisse (« tout `.webp` du dossier est une photo de menu ») est
  caduque depuis l'ajout d'un logo dérivé dans le même dossier ;
- la correction proposée (une ligne : filtrer `f.startsWith('menu-')` avant
  la comparaison) conserve exactement l'exigence — le nom du test lui-même
  (« aucun autre menu-*.webp que les 18 attendus ») décrit le filtre.
Séquence réelle : preuve documentée ici, puis revue Codex du tour (validation
demandée), puis correction appliquée.

### Second test épinglé par le tour 2 — preuve et validation Codex requise

La mise à jour de `SCORES.md` pour le tour 2 casse `tests/mesure-p1-u1.test.ts:27`
(« parcours scan → lot P1-U1 » : `5 lignes attendues (4 étapes + total), lues : 10`).
Preuve que le test est faux dans sa prémisse, pas dans son exigence :
- l'exigence (« l'arithmétique du tableau P1-U1 : 4 étapes + total re-calculé,
  totaux < 30 s ») est intacte : le tableau P1-U1 lui-même n'a pas bougé ;
- sa prémisse (« une seule table 2 passes entre le titre P1-U1 et
  `## Cohérence DA` ») est caduque : l'extraction
  `split('### Re-mesure P1-U1 …')[1].split('## Cohérence DA')[0]` englobe
  TOUTES les sous-sections du parcours (P2-Q2, t0, t1, t2) ; elle ne passait
  jusque-là que parce que les tables P2-Q2/t0 utilisent un format qui ne
  correspond pas à la regex (`\d+ ms` sans espace) — la table t2, en nombres
  pleins comme P1-U1, fait passer le compte à 10 lignes ;
- la correction proposée (une ligne : borner l'extraction à la prochaine
  sous-section, `split('### Re-mesure')[0]` après le titre P1-U1) conserve
  exactement l'exigence — elle ne lit plus que le tableau P1-U1 — et rend le
  test robuste aux tours suivants.
Séquence réelle : preuve documentée ici, puis revue Codex ciblée (validation
demandée), puis correction appliquée.

## Baseline t0 (11/11/2026 ~14:35 UTC, HEAD `7395522`, `autonome/integration`)

Mesure de référence avant le tour 1 (même protocole que P2-Q2, 2 passes) —
détail dans `SCORES.md` (§ « Re-mesure boucle t0 » sous chaque métrique) et
`node_modules/.cache/mesure-boucle-t0/` :

| Métrique | Passe 1 | Passe 2 |
| --- | --- | --- |
| Premier affichage `#/jouer` (Slow 4G) | 2 261 ms | 2 197 ms |
| LCP `#/jouer` (`p.titre-carte`) | 2 248 ms | 2 148 ms |
| Parcours scan → lot (étapes) | 6 664 ms | 7 343 ms |
| Ouverture carte après gain | 592 ms | 699 ms |
| Menu direct (premier affichage / LCP) | 1 531 / 1 508 ms | 1 326 / 1 308 ms |
| Lighthouse mobile `#/jouer` | 77 (TBT 910 ms, LCP 2,5 s) | 81 (TBT 630 ms, LCP 2,7 s) |
| Erreurs console / requêtes échouées | 0 / 0 | 0 / 0 |
| Bundle initial (build frais) | JS 481 332 o, CSS 70 766 o, total 552 098 o ; JS total 801 321 o, 22 chunks, plus gros 353 163 o | — |
| Tests | 1163/1163 | — |

Analyse t0 (détail Lighthouse, `lighthouse-passe<N>.json`) : le TBT domine
(630–910 ms) ; `mainthread-work-breakdown` : Other 730–1 086 ms, Script
Evaluation 482–580 ms, Style & Layout 572–695 ms ; `unused-javascript` :
`index-*.js` gaspille 62 KiB sur 102 KiB transférés (61 % inutilisé sur
`#/jouer` — code de la caisse et de la carte) ; tâches longues : évaluation
de `index-*.js` 241–294 ms + tâches « Unattributable » et document
(119–258 ms, rendu React + réponse API). Le premier levier retenu pour le
tour 1 est donc la sortie de `qrcode-generator` (~52 Ko de sources, dans
`ui-*.js` via `components/ui.tsx`) du bundle initial : un seul consommateur
dans le graphe initial, `CarteFidelite` (QR de la carte), qui peut le charger
en différé sans toucher aux pages épinglées. Mesuré : `qrcode.mjs` minifié
= 21 233 o (7 653 o gzip) — la réduction attendue du JS initial est donc
d'environ 21 Ko. Build après le tour : JS initial 452 343 o (−28 989 o,
−6,0 % vs t0), `QrCode-*.js` différé 21 182 o, 24 chunks (le découpage sort
aussi `jsx-runtime-*.js` du `ui-*.js`), JS total 802 475 o (+1 154 o —
enrobage `lazy` + fichier partagé), plus gros chunk 354 246 o.

### Test épinglé par le tour 1 — preuve et validation Codex requise

Le tour 1 casse `tests/corps-sombres-p1-d2.test.ts:44`, qui lit
`src/components/ui.tsx` pour vérifier que le QR garde son fond blanc (zone
de silence) : `assert.match(lire('src/components/ui.tsx'),
/className=\{`\$\{className\} bg-white`\}/)`. Preuve que le test est faux
dans sa prémisse, pas dans son exigence :
- l'exigence (« le svg du QR porte `bg-white` ») est intacte : la ligne est
  reprise **verbatim** dans `src/components/QrCode.tsx` (même composant,
  mêmes props, même rendu) ;
- seule sa prémisse d'emplacement (« le QR vit dans `ui.tsx` ») est caduque,
  puisque le déménagement est précisément le changement du tour ;
- aucun comportement n'a changé : le QR s'affiche toujours, avec le même fond
  blanc, dans l'îlot clair (vérifié par la capture `carte.png` de la mesure
  t1 et par l'E2E `scan-gain-carte`).
La correction proposée (une ligne : lire `src/components/QrCode.tsx` au lieu
de `src/components/ui.tsx`) ne touche donc ni à l'exigence ni au seuil — elle
met à jour l'emplacement lu. Séquence réelle : preuve documentée ici, puis
revue Codex du tour (point 3 : « légitime ; aucune raison d'annuler le tour »),
puis correction appliquée.

## Journal des tours

### Tour 1 — `autonome/boucle-t1-qrcode-differe` (fusionné)

Sujet : sortir `qrcode-generator` du bundle initial — `QrCode` déménage de
`components/ui.tsx` vers `components/QrCode.tsx`, chargé en différé
(`React.lazy` + `Suspense`) dans `CarteFidelite` (seul consommateur du graphe
initial) ; les pages différées (Equipe, MenuCarte, FicheClient, QrVitrine,
Roulette) importent le nouveau module directement. Les lignes JSX
`<QrCode texte={…} />` sont conservées à l'identique (tests
`carte-pwa-p1-c3` et `auth-client-p0-s7` les épinglent). Hypothèse : JS initial
−~21 Ko minifiés, TBT −~50–150 ms, Lighthouse +1–3 points, sans régression
(ouverture carte : le QR apparaît après le chargement du chunk, ~100 ms en
Slow 4G, après le gain — pas dans le chemin scan → lot). Résultat mesuré
(voir SCORES.md § « Re-mesure boucle t1 ») : JS initial −28 304 o (−5,9 %) ;
Lighthouse 77/81 → 80/85, TBT 910/630 → 620/450 ms ; premier affichage,
LCP et parcours plats (bruit de mesure, confirmé par une 3e passe) ;
ouverture carte 600/622/691 ms (3 passes) sans régression. **Test épinglé** :
le tour casse `corps-sombres-p1-d2.test.ts:44` (prémisse d'emplacement
caduque, exigence intacte — preuve ci-dessus ; revue Codex point 3 : mise à
jour légitime, correction d'une ligne appliquée après validation).
**Revue Codex t1 (5 points)** : 1. `Suspense` ne traite pas un import rejeté
→ frontière locale `ErreurQr` ajoutée (la carte reste visible, seule la case
du QR affiche un repli) ; 2. repli annoncé comme un QR utilisable → remplacé
par `role="status"` + « Chargement du QR code… » (traduit EN) ; 3. mise à jour
du test épinglé légitime (appliquée) ; 4. QR hors ligne : suit désormais la
règle des pages différées (disponible hors ligne après une première ouverture
en ligne, pas avant — documenté, pas de préchargement ajouté pour ne pas
fausser les mesures du tour) ; 5. incohérence de documentation (affirmations
anticipées) → libellés corrigés, résultats actualisés après exécution réelle.
**Décision : FUSIONNÉ** — bundle −5,9 %, TBT en baisse sur les 2 passes,
Lighthouse en hausse sur les 2 passes, aucune régression au-delà du bruit.

### Tour 2 — `autonome/boucle-t2-logo-chargement` (fusionné)

Sujet : l'écran de chargement chargeait `/visuels/logo.png` (600×600,
74 451 o) affiché à 96×96 — 31 % des octets du premier affichage. Nouveau
`public/visuels/logo-petit.webp` (192×192, WebP q80, 4 900 o, dérivé du vrai
logo par Pillow) servi en premier via `<picture>` (repli PNG inchangé) ;
ajouté au préchargement du service worker ; documenté dans
`public/visuels/SOURCES.md`. Hypothèse : premier affichage −~0,2–0,3 s en
Slow 4G, LCP en baisse, Lighthouse +1–3 points, TBT plat. Résultat mesuré
(voir SCORES.md § « Re-mesure boucle t2 ») : premier affichage
2 355/2 232/2 235 → 2 078/1 861 ms (moyenne −304 ms), LCP 2 340/2 220/2 224 →
2 028/1 812 ms (moyenne −341 ms), parcours 7 213/6 971/6 987 → 6 141/6 277 ms
(la validation en caisse gagne aussi : chaque chargement de page affiche
l'écran de chargement) ; Lighthouse 80/85 → 84/81 (plat, bruit), LCP
Lighthouse 2,9/2,8 → 2,3/2,2 s, TBT 620/450 → 590/720 ms (mixte) ; bundle
inchangé ; 0 erreur console, 0 requête échouée ; journal des requêtes :
`logo-petit.webp` servi, plus aucun `logo.png` sur `#/jouer`.
**Tests épinglés** : `photos-menu.test.ts:68` (filtre `menu-` — preuve
ci-dessus, revue Codex t2 point 3 : légitime) et `mesure-p1-u1.test.ts:27`
(extraction bornée à la sous-section — preuve ci-dessus, revue Codex ciblée :
légitime, aucune assertion retirée).
**Revue Codex t2 (5 points)** : 1. défaut hors ligne du SW — `fichier()` ne
consultait que `CACHE_FICHIERS` → repli `caches.match` ajouté + test de
régression (vérifié : échoue sans le correctif, passe avec) ; 2. `<picture>`
correct, PNG pas un repli en cas d'échec de chargement → commentaire du test
corrigé ; 3. correction du test menu légitime (appliquée) ; 4. lecture des
dimensions WebP fragile mais correcte → assertions chunk `VP8 ` + signature
ajoutées ; 5. mentions « suite verte » anticipées → corrigées après le passage
réel (1171/1171).
**Décision : FUSIONNÉ** — premier affichage et LCP en baisse sur les
2 passes au-delà du bruit, parcours en baisse, Lighthouse plat, aucune
régression au-delà du bruit.

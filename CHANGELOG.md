# CHANGELOG — Asian Home Fidélité (branche `autonome/integration`)

Chaque changement fusionné, avec justification et mesure avant/après. Les lots
P0/P1/P2 sont détaillés dans `JOURNAL.md` ; ce fichier ne reprend que leur
bilan et, ensuite, chaque tour de la boucle d'amélioration continue
(`BOUCLE.md`).

## Lots P0/P1/P2 (terminés le 11/11/2026, HEAD `7395522`, tests 1163/1163)

Audit + 5 vagues livrés le 10–11/11/2026 (master 29a47f9, puis P0-S11 à P2-Q6
sur `autonome/integration`) : P0 sécurité (PIN scrypt, sessions HMAC, anti-abus,
vue publique minimale, CSP/HSTS/CORS), P0 UX comptoir, menu officiel importé
(16 catégories, 81 plats, 78 avec prix), relances SMS/e-mail via Brevo (mode
test), Google Business préparé sans compte, logo upload, RGPD, PWA, FR/EN,
bundle 601,7 → 450,2 Ko (JS initial), dashboard enrichi + entonnoir, SEO/OG.
État à la fin des lots : premier affichage `#/jouer` 2,29–2,43 s, LCP
2,27–2,37 s, parcours scan → lot 6,9–7,0 s, Lighthouse 73/81, DA 8,0/10,
0 erreur console. Détail : `JOURNAL.md`, mesures : `SCORES.md`.

## Boucle d'amélioration continue

### t7 — Bannière de la carte recadrée au ratio d'affichage (11/11/2026, fusionné)

Même fichier `public/visuels/hero-plats-petit.webp`, recadré : 720×480,
75 588 o → **720×180, 27 382 o** (recadrage centré 1024×256 de
`hero-plats.jpg` puis redimensionnement 720×180, Pillow, WebP q75, −64 %) —
l'`object-cover` jetait ~63 % des pixels de la variante 720×480 (bande
visible 720×177) pour l'affichage 390×96 ; le rendu est très proche, avec
des différences de redimensionnement et de compression (vérifié visuellement
sur planche de comparaison avant le changement). Aucun changement de code
(le `<picture>` du tour 6 sert le même fichier) ; seuls changent l'actif,
son commentaire dans `src/lib/visuels.ts`, sa ligne dans
`public/visuels/SOURCES.md`, et le test `tests/boucle-t6-banniere.test.ts`
(dimensions 720×480 → 720×180, plafond < 120 Ko → < 60 Ko — mise à jour
validée par la revue Codex t7, preuve dans `BOUCLE.md` ; la validation est
intervenue après la modification du test, avant la fusion — l'ordre strict
« avant toute touche » n'a pas été respecté, consigné honnêtement ici).
Mesures (ponctuelle, `scripts/mesurer-carte-asian-home.mjs` — clés renommées
`herosChargeApresClicMs` / `banniereChargeeApresClicMs`, la mesure attend
`img.complete`, donc « chargée ») : transition — héros chargé 1 394/1 399 →
1 164/1 201 ms puis 1 153/1 120 ms (moyenne 1 397 → 1 160 ms, **−237 ms**),
bannière chargée 1 400/1 409 → 1 172/1 208 ms puis 1 160/1 125 ms (moyenne
1 405 → 1 166 ms, **−239 ms**) ; LCP direct 3 124/3 200 → 3 004/2 884 ms
puis 3 116/3 004 ms (moyenne 3 162 → 3 002 ms, **−160 ms**) ; les 4 passes
après sont sous les 2 passes avant sur les deux métriques de transition
(séparation nette) ; les 48 206 o économisés valent ~230 ms à 1,6 Mibit/s.
Mesures standard (2 passes) : premier affichage 1 820/1 825 ms, LCP
1 808/1 804 ms, parcours 6 512/6 457 ms (plats) ; Lighthouse 80/81
(TBT 710/670 ms) contre 78/79 à t6 (plat). Bundle : IDENTIQUE à t6
(453 667 o — actif seul, aucun JS) ; 0 erreur console. Tests 1184/1184
(inchangés), E2E 3/3. Revue Codex t7 (5 points) : fusion justifiée après
corrections documentaires (« ~80 % » → « ~63 % », « affichée » → « chargée »,
validation du test consignée honnêtement) ; un habitué peut conserver
l'ancienne variante temporairement (SW + fraîcheur HTTP 1 h — sans
régression visuelle significative) ; prochain tour : profiler les longues
tâches du TBT. Compteur de tours sans gain : **0**.

### t6 — Bannière de la carte en WebP léger (11/11/2026, fusionné)

Nouveau `public/visuels/hero-plats-petit.webp` (720×480, WebP q75,
75 588 o, dérivé du vrai `hero-plats.jpg` 1024×683, 177 369 o par Pillow,
−57 %) servi en premier via `<picture className="block">` dans
`src/components/CarteFidelite.tsx` (bannière `h-24` de la carte), le JPEG
restant le repli ; le `<source>` WebP n'est rendu que si la bannière est
celle par défaut (`banniere === VISUELS.heroPlats`) — une bannière
configurée par le commerçant garde sa balise `<img>` simple (le
`<picture>` reste, sans `<source>`) ; constante `VISUELS.heroPlatsPetit`
dans `src/lib/visuels.ts` ; documenté dans `public/visuels/SOURCES.md`.
`hero-plats.jpg` reste intact partout. La bannière n'est PAS l'élément LCP
de `#/carte` (c'est le héros `h-80`) : son gain passe par la concurrence
réseau — elle partage le tuyau 4G avec le héros.
Mesures (ponctuelle, nouveau script versionné
`scripts/mesurer-carte-asian-home.mjs` — parcours complet, 2 mesures :
transition réelle + chargement direct) : transition réelle — héros affiché
1 531/1 604 → 1 432/1 365 ms puis 1 375/1 345 ms (moyenne ~1 379 ms,
**−~190 ms**), bannière affichée 1 919/1 921 → 1 439/1 372 ms puis
1 382/1 351 ms (moyenne ~1 386 ms, **−~530 ms**), `currentSrc` =
`hero-plats-petit.webp` ; LCP direct 3 349 ms (moyenne 4 passes avant) →
~3 176 ms (moyenne 6 passes après, **−~170 ms**) ; chargement direct
2 656/2 480 ms → 2 503/2 284 ms puis 2 425/2 409 ms puis 2 416/2 487 ms.
Mesures standard (2 passes) : premier affichage 1 881/1 817 ms, LCP
1 868/1 800 ms, parcours 6 396/6 577 ms (plats, commerce générique sans
bannière) ; Lighthouse 78/79 (TBT 740/770 ms) contre 78/80 à t5 (plat).
Bundle : JS initial 453 485 → 453 667 o (+182 o, +0,04 %), CSS inchangé,
24 chunks ; 0 erreur console (écouteurs aussi sur la page carte). Tests
1180 → 1184/1184 (+3 `tests/boucle-t6-banniere.test.ts`, +1 test auto
dans `tests/visuels.test.ts`), E2E 3/3. Revue Codex t6 (5 points) : fusion
justifiée ; `<picture>` systématique fondé ; 720 px q75 défendable (une
variante recadrée 720×180 au ratio de la bannière mériterait un essai —
candidat t7) ; script corrigé (écouteurs sur la page carte, en-tête,
mesure de la transition réelle + ABAB) ; gain formulé avec sa réserve
(direct seulement sans la transition réelle — levée par l'ABAB). Compteur
de tours sans gain : **0**.

### t5 — Logo du commerce en WebP léger (11/11/2026, fusionné) — REGARD NEUF

Regard neuf (toutes les 5 itérations) : le protocole standard mesure
`#/jouer` avec un commerce générique sans visuels — le logo du commerce
(74 Ko) n'y apparaît jamais, alors que pour le vrai restaurant il est
affiché 64×64 sur `#/jouer`, `#/menu`, `#/carte` et en caisse. Le tour 5
applique le regard neuf : `LogoCommerce` (`src/components/ui.tsx`) sert
désormais la variante `logo-petit.webp` (192×192, WebP q80, 4 900 o, créée
au tour 2) en premier via `<picture className="block shrink-0">`, le PNG
600×600 (74 Ko) restant le repli — seulement quand `logo === VISUELS.logo`
(logo par défaut) ; un logo téléversé (branche `estLogoTeleverse`, img
simple `bg-nuit-950 object-contain`, inchangée) ou renseigné par le
commerçant garde sa balise `<img>` simple. Constante `LOGO_DEFAUT_PETIT`
dans `src/lib/visuels.ts`, hors de `VISUELS` (le test `visuels.test.ts`
exige > 10 000 o par entrée) ; documenté dans `public/visuels/SOURCES.md`.
Mesures (ponctuelle, `scripts/mesurer-menu-asian-home.mjs` étendu à
`#/jouer` — page neuve par mesure, une navigation par hash ne rechargeant
pas le document) : LCP `#/menu` Asian Home **2 892/2 908 → 2 572/2 588 ms
(moyenne −320 ms, 2 passes sur 2)** — gain compatible avec une moindre
concurrence réseau (logo 74 Ko et héros 95 Ko partaient en parallèle) ;
LCP `#/jouer` 1 744/1 648 → 1 740/1 648 ms (plat, attendu : le logo n'est
pas le LCP) ; `logo.png` a disparu du journal des deux pages. Mesures
standard (2 passes) : premier affichage 1 894/1 883 ms, LCP 1 880/1 828 ms,
parcours 6 753/6 534 ms (plats, commerce générique sans logo) ; Lighthouse
78/80 (TBT 860/700 ms) contre 78/76 à t4 (plat). Bundle : JS initial
453 181 → 453 485 o (+304 o, +0,07 %), CSS inchangé, 24 chunks ; 0 erreur
console. Tests 1176 → 1180/1180 (+4 `tests/boucle-t5-logo-commerce.test.ts`),
E2E 3/3. Revue Codex t5 (5 points) : fusion justifiée ; `<picture>` et
égalité stricte fondés ; constante hors VISUELS acceptable (à terme,
l'intégrer avec une validation adaptée aux petits fichiers) ; gain formulé
comme « compatible avec une moindre concurrence réseau » ; garde
anti-écrasement ajoutée aux scripts de mesure (voir ci-dessous). Compteur
de tours sans gain : **0** (le tour 5 a gagné).
Incident de mesure (tour 5) : un lancement de `mesurer-scores.mjs` sans
`--sortie` a écrasé `node_modules/.cache/mesure-p0-u0/resultats.json` +
9 captures P0-U0 (archive brute non versionnée ; chiffres conservés dans
`SCORES.md`, passe t5 récupérée comme passe 1). Correctif appliqué :
les deux scripts (`mesurer-scores.mjs`, `mesurer-lighthouse.mjs`)
refusent désormais d'écraser leur sortie par défaut sans `--sortie`
explicite. Règle ajoutée : toujours passer `--sortie` ; toute décision
Lighthouse contestée exige un ABAB ou 3+ passes.

### t4 — Héros du menu optimisé (11/11/2026, fusionné)

Nouveau `public/visuels/table-sushis-petit.webp` (720×1279, WebP q75,
95 494 o, dérivé du vrai `table-sushis.jpg` 788×1400, 195 989 o par Pillow,
−51 %) servi en premier via `<picture className="block">` (repli JPEG
inchangé) dans `src/pages/MenuPublic.tsx` (héros du menu, `h-56`) ET
`src/pages/CartePublique.tsx` (bannière de la carte, `h-80`) — même visuel,
même motif, un seul changement ; constante `VISUELS.tableSushisPetit`
ajoutée dans `src/lib/visuels.ts` ; documenté dans
`public/visuels/SOURCES.md` (dimensions corrigées : `table-sushis.jpg` est
788×1400 sur disque, l'original Instagram 2268×4032). `table-sushis.jpg`
reste intact partout (repli, OG, SOURCES.md). Le héros n'est PAS préchargé
par le service worker (95 Ko — seuls les petits visuels de marque sont
préchargés ; les photos de contenu sont mises en cache à la première
visite, comme les photos de plats) ; hors ligne, le héros peut manquer s'il
n'a pas déjà été mis en cache. Le préchargement n'a pas été retenu : avec
préchargement Lighthouse 78/76/75 (TBT 850–1 030 ms), sans 81/77/74/80 —
mais les séries sont trop petites et dispersées pour établir que le
préchargement augmente le TBT (revue Codex t4).
Mesures (2 passes Playwright standard + 2 passes Lighthouse officielles +
mesure ponctuelle, même protocole) : LCP `#/menu` Asian Home
**3 428/3 376 ms → 3 076/2 892 ms** (moyenne −418 ms, 2 passes sur 2 ; +
2 passes de confirmation 2 912/2 960 ms) — script versionné
`scripts/mesurer-menu-asian-home.mjs` (commerce « Asian Home Paris », SW
bloqués, cache désactivé) ; `#/jouer` plat (premier affichage 1 896/1 895 ms,
LCP 1 872/1 844 ms, parcours 6 738/6 854 ms, ouverture carte 616/684 ms) ;
Lighthouse 84/81 → **78/76** (TBT 590/720 → 850/1 030 ms) — réserve ABAB
conservée dans `SCORES.md` : sans le tour 81/82 (TBT 650/670 ms), avec le
tour 79/80 (TBT 750/810 ms) dans la même fenêtre ; effet propre ≈ −2 points,
dans le bruit, signal conservé tel quel. Bundle : JS initial 453 028 →
453 181 o (+153 o, +0,03 %), CSS 70 766 o inchangé, total 523 794 →
523 947 o, 24 chunks ; 0 erreur console, 0 requête échouée. Tests 1171 →
1176/1176 (+4 `tests/boucle-t4-hero.test.ts`, +1 test auto dans
`tests/visuels.test.ts` — une entrée `VISUELS` = un test). E2E 3/3. Revue
Codex t4 (5 points) : fusion raisonnable après une petite correction
(`className="block"` sur les deux `<picture>` — l'élément inline perdait
la marge verticale `space-y-*` du parent ; hauteur 1279 épinglée dans le
test ; dimensions `table-sushis.jpg` corrigées dans SOURCES.md ; script de
mesure versionné) ; aucun motif d'annulation. Compteur de tours sans gain :
reste à 1 (t3).

### t1 — QR code différé hors du bundle initial (11/11/2026, fusionné)

`QrCode` déménage de `components/ui.tsx` vers `components/QrCode.tsx` ;
`CarteFidelite` le charge en différé (`React.lazy` + `Suspense`, repli
« Chargement du QR code… » annoncé `role="status"`, frontière locale
`ErreurQr` si l'import est rejeté) ; les pages différées (Equipe, MenuCarte,
FicheClient, QrVitrine, Roulette) importent le nouveau module. Jouer,
CartePublique et Caisse restent statiques (décision P2-Q2 : caisse hors
ligne). Justification : `qrcode-generator` (~21 Ko minifiés) ne servait que
la carte ; le bundle initial repasse sous le seuil P2-Q2.
Avant → après (3 passes Playwright + 2 Lighthouse, même protocole) : JS
initial 481 332 → 453 028 o (−28 304 o, −5,9 %), total initial 552 098 →
523 794 o, JS total 801 321 → 803 160 o (+1 839 o — enrobage `lazy` +
frontière + libellés), 24 chunks ; Lighthouse 77/81 → 80/85, TBT 910/630 →
620/450 ms ; premier affichage 2 261/2 197 → 2 355/2 232/2 235 ms, LCP
2 248/2 148 → 2 340/2 220/2 224 ms, parcours 6 664/7 343 → 7 213/6 971/
6 987 ms (plats, bruit de mesure) ; ouverture carte 592/699 → 600/622/
691 ms (chunk chargé en parallèle de l'API, sans délai mesurable) ;
0 erreur console, 0 requête échouée. Tests 1163 → 1166/1166 (+3
`tests/boucle-t1-qrcode.test.ts`), E2E 3/3. Revue Codex 5 points : 3 fondés
corrigés (frontière locale, repli annoncé, mise à jour du test épinglé —
`corps-sombres-p1-d2.test.ts:44` lisait l'ancien emplacement, exigence
inchangée, preuve dans `BOUCLE.md`), 1 fondé documenté (QR hors ligne :
règle des pages différées), 1 fondé corrigé (libellés anticipés).
Détail : `BOUCLE.md`, `SCORES.md` (§ « Re-mesure boucle t1 »).

### t2 — Logo de chargement optimisé (11/11/2026, fusionné)

Nouveau `public/visuels/logo-petit.webp` (192×192, WebP q80, 4 900 o, dérivé
du vrai logo par Pillow) servi en premier via `<picture>` dans `index.html`
(repli `logo.png` inchangé, navigateurs sans WebP) ; ajouté au préchargement
du service worker — avec correctif : `fichier()` ne consultait que
`CACHE_FICHIERS`, les fichiers préchargés (`CACHE_APP`) n'étaient pas servis
hors ligne (repli `caches.match` ajouté, test de régression dans
`performance-bundle-p2-q2.test.ts`, vérifié : échoue sans le correctif) ;
documenté dans `public/visuels/SOURCES.md`. Justification : le logo PNG
(74 451 o, affiché à 96×96) pesait 31 % des octets du premier affichage, en
concurrence avec le JS sur la 4G lente.
Avant → après (2 passes Playwright + 2 Lighthouse, même protocole) : premier
affichage 2 355/2 232/2 235 → 2 078/1 861 ms (moyenne −304 ms), LCP
2 340/2 220/2 224 → 2 028/1 812 ms (moyenne −341 ms), parcours
7 213/6 971/6 987 → 6 141/6 277 ms, ouverture carte 600/622/691 → 581/520 ms ;
Lighthouse 80/85 → 84/81 (plat), LCP Lighthouse 2,9/2,8 → 2,3/2,2 s, TBT
620/450 → 590/720 ms (mixte) ; bundle inchangé ; 0 erreur console,
0 requête échouée. Tests 1166 → 1171/1171 (+4 `tests/boucle-t2-logo.test.ts`,
+1 test SW), E2E 3/3. Revue Codex 5 points : 4 fondés corrigés (repli SW hors
ligne, commentaire de repli, dimensions WebP, mentions anticipées) + 1 fondé
validant la correction du test épinglé `photos-menu.test.ts:68` ; second test
épinglé `mesure-p1-u1.test.ts:27` corrigé après preuve et revue Codex ciblée
(extraction bornée à la sous-section, exigence inchangée).
Détail : `BOUCLE.md`, `SCORES.md` (§ « Re-mesure boucle t2 »).

### t0 — Baseline (11/11/2026, HEAD `7395522`)

Pas un changement : re-mesure de référence avant le tour 1 (2 passes
Playwright + 2 passes Lighthouse, même protocole que P2-Q2).
Premier affichage 2 261 / 2 197 ms, LCP 2 248 / 2 148 ms, parcours
6 664 / 7 343 ms, Lighthouse 77 / 81 (TBT 910 / 630 ms), bundle initial
JS 481 332 o + CSS 70 766 o = 552 098 o, 0 erreur console. Voir `BOUCLE.md`
et `SCORES.md` (§ « Re-mesure boucle t0 »).

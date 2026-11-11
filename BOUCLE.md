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
d'environ 21 Ko.

## Journal des tours

### Tour 1 — `autonome/boucle-t1-qrcode-differe` (en cours)

Sujet : sortir `qrcode-generator` du bundle initial — `QrCode` déménage de
`components/ui.tsx` vers `components/QrCode.tsx`, chargé en différé
(`React.lazy` + `Suspense`) dans `CarteFidelite` (seul consommateur du graphe
initial) ; les pages différées (Equipe, MenuCarte, FicheClient, QrVitrine,
Roulette) importent le nouveau module directement. Les lignes JSX
`<QrCode texte={…} />` sont conservées à l'identique (tests
`carte-pwa-p1-c3` et `auth-client-p0-s7` les épinglent). Hypothèse : JS initial
−~21 Ko minifiés, TBT −~50–150 ms, Lighthouse +1–3 points, sans régression
(ouverture carte : le QR apparaît après le chargement du chunk, ~100 ms en
Slow 4G, après le gain — pas dans le chemin scan → lot).

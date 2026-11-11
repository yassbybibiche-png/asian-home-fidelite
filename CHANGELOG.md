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

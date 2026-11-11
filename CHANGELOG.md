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

### t0 — Baseline (11/11/2026, HEAD `7395522`)

Pas un changement : re-mesure de référence avant le tour 1 (2 passes
Playwright + 2 passes Lighthouse, même protocole que P2-Q2).
Premier affichage 2 261 / 2 197 ms, LCP 2 248 / 2 148 ms, parcours
6 664 / 7 343 ms, Lighthouse 77 / 81 (TBT 910 / 630 ms), bundle initial
JS 481 332 o + CSS 70 766 o = 552 098 o, 0 erreur console. Voir `BOUCLE.md`
et `SCORES.md` (§ « Re-mesure boucle t0 »).

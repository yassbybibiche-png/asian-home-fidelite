# Phase FIX-A — Majeurs 1 et 2 (logique fidélité)

Tu travailles dans le dépôt `~/workspace/fideliz-claude/` (app web Vite + React 19 + TypeScript + Tailwind, « Asian Home Fidélité »).
Contexte à lire avant tout : `~/workspace/fideliz-test-codex/RAPPORT-CODEX.md` (paragraphes MAJEUR 1 et MAJEUR 2), `src/lib/fidelite.ts`, `tests/logique.test.ts`, `tests/seed.test.ts`, `scripts/generer-seed.mjs`.
Règles intangibles : marque toujours Asian Home Paris, jamais Fideliz ; offre toujours « Gratuit », jamais 90 € / 500 € ; ne rien publier, ne rien pousser sur GitHub, ne créer aucun dépôt, ne dépenser rien. Travaille seul, sans poser de question.

## MAJEUR 1 — Tampons perdus sur carte pleine
Problème : 11 visites, seuil 10 → après récompense la carte retombe à 0 au lieu de 1. Cause : `validerVisite` plafonne les tampons au seuil, puis `offrirRecompense` remet à zéro.
Règle : 1 visite = 1 tampon, jamais de visite perdue. L'excédent est conservé sur la nouvelle carte.
Correction à appliquer :
- `validerVisite` ne plafonne PLUS `tampons` (tampons = nombre de visites depuis la dernière récompense). `tamponsAffiches` continue de plafonner l'affichage au seuil.
- `offrirRecompense` : si `tampons >= seuil`, `tampons -= seuil` (pas 0) et la récompense est enregistrée. Si `tampons` reste >= seuil après ça, la récompense reste débloquée (offrable à nouveau).
- Mettre à jour le test existant « carte pleine » qui affirmait l'ancien plafonnement, et AJOUTER un test de non-régression : 11 visites, seuil 10 → tampons 11, affichés 10, récompense débloquée ; après `offrirRecompense`, tampons = 1 et 1 récompense enregistrée. Ajouter aussi le cas 21 visites, seuil 10 → après 1 récompense, tampons = 11 (encore débloquée).
- Vérifier la cohérence du seed : l'invariant devient `tampons = visites − seuil × nombre de récompenses offertes` (ou moins si carte non pleine). Si `src/data/seed.json` devient incohérent, régénère-le avec `npm run seed` (ou corrige le générateur) et vérifie que `tests/seed.test.ts` reste vert.

## MAJEUR 2 — Doublon client par préfixe international
Problème : `0033612345678` n'est pas reconnu comme `06 12 34 56 78` ; `cleContact` ne normalise que le préfixe `33` sur 11 chiffres.
Correction à appliquer :
- `cleContact` (et `analyserContact` si besoin) normalise TOUS les formats français vers une seule clé : `06 12 34 56 78`, `0612345678`, `+33 6 12 34 56 78`, `+33612345678`, `0033 6 12 34 56 78`, `0033612345678`, avec espaces / points / tirets / parenthèses → tous donnent la clé `0612345678`. E-mail : minuscules, sans espaces (inchangé). Les numéros non français (autre longueur) gardent leurs chiffres tels quels.
- Vérifie qu'aucun autre endroit du code ne compare des téléphones sans passer par `cleContact` (grep `telephone` dans `src/`).
- AJOUTER des tests de non-régression : chaque format ci-dessus retrouve le même client via `trouverClientParContact`, et un second `inscrireClient` avec un format différent ne crée pas de doublon (au niveau de la logique testable ; si la déduplication à l'inscription vit dans `store.tsx`, corrige-la aussi et dis-le).

## Vérification et livraison
1. `npm test` : tous verts — donne le nombre exact de tests (avant : 19).
2. `npm run build` OK.
3. Mets à jour `JOURNAL.md` (ce qui a été corrigé, fichiers touchés, tests ajoutés).
4. Commit : `git add -A && git commit -m "Fix majeurs 1-2 : report des tampons excédentaires + normalisation téléphones FR"` (ou message équivalent). N'inclus rien hors du dépôt.
5. Réponds avec un résumé court : pour chaque bug, corrigé ou non + preuve (nom des tests ajoutés, résultat `npm test`, résultat `npm run build`). Signale honnêtement ce qui resterait ouvert.

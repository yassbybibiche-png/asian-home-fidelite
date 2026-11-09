# Phase FIX-B — Majeur 3 + Mineur 1 (roulette liée à la visite, clients actifs)

Tu travailles dans le dépôt `~/workspace/fideliz-claude/` (app web Vite + React 19 + TypeScript + Tailwind, « Asian Home Fidélité »).
Contexte à lire avant tout : `~/workspace/fideliz-test-codex/RAPPORT-CODEX.md` (MAJEUR 3, MINEUR 1), `src/pages/Jouer.tsx`, `src/lib/roulette.ts`, `src/lib/stats.ts`, `src/lib/fidelite.ts`, `src/pages/Clients.tsx`, `src/components/CarteFidelite.tsx`, `src/data/depot.ts`, `src/types.ts`, `tests/logique.test.ts`.
Règles intangibles : marque toujours Asian Home Paris, jamais Fideliz ; offre toujours « Gratuit » ; ne rien publier, ne rien pousser sur GitHub, ne créer aucun dépôt, ne dépenser rien. Travaille seul, sans poser de question.
État : la phase FIX-A (majeurs 1-2) est censée être déjà appliquée et commitée — vérifie par `git log --oneline -3` et lis le code actuel avant de toucher quoi que ce soit ; ne refais pas FIX-A.

## MAJEUR 3 — Roulette jouable sans aucune visite
Problème : `Jouer.tsx` ne vérifie que joueur / étape / tirage du jour. Un inscrit sans visite peut tourner et gagner. Le brief exige « 1 participation par visite ».
Correction à appliquer :
- Pour tourner, le joueur doit avoir une visite enregistrée LE JOUR MÊME (même jour calendaire local) dans ce commerce. Sinon : bouton « Tourner la roue » désactivé/absent et message clair affiché, ex. : « Pour jouer, validez d'abord votre visite du jour au comptoir. » + lien vers sa carte.
- Jouer ne crée JAMAIS de visite par lui-même (pas d'auto-validation côté joueur, sinon la règle ne vaut rien).
- Dans la démo, le parcours reste testable depuis le même navigateur : le commerçant valide la visite via Clients → « Valider une visite », puis le client joue. Mets à jour le README (parcours de test de la roulette) en conséquence.
- AJOUTER des tests de non-régression dans la logique pure (nouvelle fonction helper testable, ex. `peutJouer(client, tirages, commerceId, maintenant)` dans `src/lib/roulette.ts` ou équivalent, utilisée par `Jouer.tsx`) : client sans visite → ne peut pas jouer ; client avec visite aujourd'hui → peut jouer (si pas déjà joué) ; visite hier seulement → ne peut pas jouer ; déjà joué aujourd'hui → ne peut pas rejouer.
- Vérifier que le seed reste cohérent (les tirages du seed sont bien des jours de visite) et que `tests/seed.test.ts` reste vert.

## MINEUR 1 — Compteur « Clients actifs » trompeur
Problème : `nouveauClient` met `derniereVisite` à la date d'inscription, donc un client sans aucune visite compte comme actif, et apparaît dans « À relancer ».
Correction à appliquer :
- Un client sans visite n'est NI actif NI à relancer : `estActif` retourne false sans visite, et la liste « À relancer » ne contient que des clients avec au moins une visite et sans visite depuis plus de 30 jours.
- Implémentation au choix le plus simple et le moins risqué : soit `derniereVisite: string | null` dans `Client` (mettre à jour TOUS les usages : `stats.ts`, `Clients.tsx` tri et libellés, `CarteFidelite.tsx`, `depot.ts` migration des anciennes données stockées, seed), soit garder une chaîne vide comme sentinelle — choisis, mais traite TOUS les usages et ne laisse aucun `localeCompare` / `new Date('')` casser.
- AJOUTER des tests : nouveau client sans visite → `estActif` false, pas dans les inactifs à relancer ; après 1 visite → actif ; 31 jours sans visite → inactif et à relancer.
- Vérifier que le libellé du dashboard (« venus ces 30 derniers jours ») correspond désormais au calcul.

## Vérification et livraison
1. `npm test` : tous verts — donne le nombre exact de tests.
2. `npm run build` OK.
3. Mets à jour `JOURNAL.md` et le README (parcours de test roulette).
4. Commit : `git add -A && git commit -m "Fix majeur 3 + mineur 1 : roulette liée à la visite du jour, actifs = visiteurs"` (ou message équivalent).
5. Réponds avec un résumé court : pour chaque bug, corrigé ou non + preuve (tests ajoutés, `npm test`, `npm run build`). Signale honnêtement ce qui resterait ouvert.

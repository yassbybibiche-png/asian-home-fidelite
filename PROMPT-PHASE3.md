# PHASE 3 — Fideliz : finition, tests, README, vérification

Tu travailles dans `~/workspace/fideliz-claude/`. Lis `BRIEF.md`, `PLAN.md` et
`JOURNAL.md`. Ne reconstruis rien : finis et vérifie.

## À faire
1. **Tests de base** : ajoute des tests simples (ex. Vitest ou un script node)
   qui vérifient au moins : création d'un commerce, inscription d'un client,
   +1 tampon et progression, tirage roulette (1/jour max), réponse à un avis.
   `npm test` doit passer. Si Vitest complique le build, un script de test simple
   en node sur la logique pure (hors React) suffit — dis-le dans le README.
2. **Relecture mobile-first** : vérifie que chaque écran est lisible/utilisable sur
   téléphone (pas de débordement horizontal, boutons >= 44 px, textes lisibles).
   Corrige les écrans qui débordent.
3. **Cohérence des données** : les 3 commerces seed ont des clients, visites, avis
   et tirages cohérents (dates récentes, tampons cohérents avec les visites).
   Le reset démo (bouton « Réinitialiser la démo » dans Admin) restaure le seed.
4. **README.md complet** : comment lancer (`npm install`, `npm run dev`, `npm run build`),
   comment tester la démo depuis un téléphone (parcours en 5 étapes max),
   tableau honnête réel vs simulé (Google Reviews API : simulé ; Wallet : simulé ;
   SMS/email : simulé ; paiements : absents), limites pour une vraie mise en production
   (backend, auth, vraie API Google, vrais passes Wallet, hébergement, RGPD).
5. **Vérification finale** : `npm install && npm run build` vert, `npm test` vert.
   Lance `npm run preview` et vérifie avec curl que la page répond (200) et que
   le HTML de base est servi. Note les résultats dans JOURNAL.md.
6. **Commits** : `git add -A && git commit -m "Phase 3 : tests + README + vérification"`.

## Règles strictes
- Aucune clé API réelle, aucun envoi réel, rien publié, rien poussé, rien dépensé.
- Ne pose aucune question : tranche toi-même, consigne dans JOURNAL.md.
- Sois honnête dans le README et ton résumé final : ce qui marche vraiment, ce qui
  est simulé, ce qui manque pour la production. Ne sur-vends rien.

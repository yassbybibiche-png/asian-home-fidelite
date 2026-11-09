# PLAN — Fideliz (app web, 1 produit, tous commerces)

Principe : le plus simple possible pour scaler. Un seul produit, un seul parcours,
onboarding commerce ~2 min, zéro sur-mesure par secteur, multi-commerces dès le départ.

## Stack
- Vite + React + TypeScript + Tailwind, app web statique, mobile-first, UI en français.
- Aucun backend : persistance localStorage, données seed en JSON.
- Aucune clé API réelle, aucun paiement réel, aucun envoi réel (tout simulé, étiqueté « démo »).

## Phases (Claude Code, CLI non-interactif, commit après chaque phase qui marche)
1. **Squelette + socle** : projet Vite/React/TS/Tailwind, modèle de données
   (Commerce, Client, Visite/Tampon, Lot, Tirage, Avis), seed 3 commerces
   (restaurant, salon de coiffure, boutique), navigation mobile-first,
   sélecteur de commerce, Dashboard commerçant, Réglages commerce (1 formulaire),
   page Offre (90 € TTC/mois, 12 mois, 500 € mise en place), Admin multi-commerces
   (liste + ajout commerce en 1 formulaire court).
2. **Les 3 modules** : (a) carte fidélité digitale — inscription 10 s, QR personnel,
   bouton Wallet simulé, tampons, progression, récompense, relances inactifs 30 j ;
   (b) roulette QR — QR unique par commerce, page publique, roulette animée,
   lots configurables, 1 tirage/client/jour, invitation avis Google après le jeu,
   lot jamais conditionné à l'avis ; (c) avis Google — liste avis démo, modèles de
   réponse (5★, 4★, négatif, sans texte), réponse auto réglable par interrupteur.
3. **Finition + vérification** : tests de base (création commerce, inscription client,
   tampon, tirage roulette, réponse à un avis), README (lancer, tester, réel vs simulé),
   `npm run build` vert, preuve de fonctionnement (captures ou curl sur le preview).

## Règles
- Rien publié, rien poussé sur GitHub, aucun dépôt créé, aucune dépense.
- Commits locaux après chaque fonctionnalité qui marche.
- Tout ce qui est simulé (API Google, Wallet, SMS/email) étiqueté dans l'UI et le README.
- JOURNAL.md tenu à jour à chaque phase.

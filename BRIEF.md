# BRIEF — Fideliz : app de fidélité pour TOUS les commerces

## Source
Fiche commerciale Fideliz (photo IMG_5363.png, fournie par l'utilisateur le 09/11/2026).
Offre : **90 € TTC / mois, 12 mois d'engagement, 500 € TTC de mise en place**.
Mise en place comprend : 2 500 flyers (sacs à emporter et livraison), étiquettes de table avec QR code, adhésif vitrine 100 × 70 cm.

## Principe directeur (décision utilisateur 09/11 ~02h53)
**Le plus simple possible pour scaler sur TOUS les commerces** — pas seulement les restaurants.
- Un seul produit, un seul parcours, zéro développement sur mesure par commerce.
- Onboarding d'un nouveau commerce en ~2 minutes : nom, type de commerce, logo (optionnel), lien Google, récompense fidélité, lots de la roulette. C'est tout.
- Aucune logique métier spécifique à un secteur. Ce qui marche pour un restaurant doit marcher tel quel pour une boutique, un salon de coiffure, une boulangerie, un garage, etc.
- Multi-commerces dès le départ : 1 compte = 1 commerce, et un tableau admin/commercial qui liste tous les commerces (nom, type, statut actif/inactif, nombre de clients, avis).
- Déploiement simple : app web statique, aucune infra par commerce, données en local (localStorage) pour la démo, code prêt à brancher sur une vraie base plus tard sans réécrire l'UI.

## Les 3 fonctionnalités (issues de la fiche, génériques)
### 1. Carte de fidélité digitale
- Inscription client en 10 secondes : prénom + téléphone ou email.
- Carte conservée sur le téléphone (QR code personnel + bouton « Ajouter à Wallet » simulé : Apple Wallet / Google Wallet — génération de vrai pass NON incluse, à marquer comme simulé).
- Tampons / points : 1 visite = 1 tampon (bouton « Valider une visite » côté commerçant, avec code/QR). Récompense configurable (ex : « 10e visite offerte », « -10 % après 8 tampons »).
- Progression visible vers la récompense (« 6/10 tampons »).
- Relance des clients inactifs : liste des clients sans visite depuis 30 jours, avec message type prêt à copier.
- Objectif affiché dans la fiche : faire revenir le client plus souvent.

### 2. Roulette par QR code et avis Google
- QR code unique par commerce (affichable / imprimable : étiquette de table + vitrine).
- Page publique du QR (mobile) : le client scanne, tourne la roulette animée, gagne un lot configurable (ex : dessert offert, -10 %, boisson offerte — lots en texte libre, probabilités simples).
- 1 participation par visite (anti-abus simple : 1 tirage par client et par jour).
- Après le jeu, invitation à partager son expérience sur Google, indépendamment du jeu (le lot n'est PAS conditionné à l'avis).
- Objectif : créer du lien et développer la visibilité.

### 3. Réponses aux avis Google
- Lien fiche Google configurable par commerce.
- Liste des avis (données démo), note, texte, date.
- Réponses proposées (modèles prêts : 5★, 4★, avis négatif, avis sans texte).
- Automatisation simple selon réglages : ex. réponse auto pour les 5★, brouillon à valider pour les autres. Réglage par interrupteur, pas de règles complexes.
- Objectif : gagner du temps et soigner l'image en ligne.

## Autres écrans (simples)
- **Dashboard commerçant** : 4 chiffres (clients actifs, visites ce mois, avis ce mois, taux de retour), liste clients, derniers avis, derniers gains roulette.
- **Réglages commerce** : nom, type, logo, lien Google, récompense, seuil de tampons, lots de la roulette, règles de réponse auto. Un seul formulaire.
- **Page Offre** : reprend la fiche — 90 € TTC/mois, 12 mois, 500 € mise en place et son contenu (flyers, étiquettes, adhésif).
- **Admin multi-commerces** : liste des commerces, ajout d'un commerce en 1 formulaire court, statut.
- **Démo** : 3 commerces types pré-remplis (ex : restaurant, salon de coiffure, boutique) avec clients, visites et avis réalistes, pour montrer que ça scale sans changer le produit.

## Contraintes techniques
- App web, interface **en français, mobile-first** (l'utilisateur n'a que son téléphone : tout doit être utilisable et lisible sur téléphone).
- Stack simple et standard : Vite + React + TypeScript + Tailwind (ou équivalent simple). Pas de backend obligatoire pour la démo : persistance localStorage, données seed en JSON.
- Aucune clé API réelle, aucun paiement réel, aucun envoi SMS/email réel. Tout ce qui est simulé doit être étiqueté « démo / simulé » dans l'UI et dans le README (Google Reviews API, Apple/Google Wallet, envois).
- Build reproductible : `npm install && npm run build` doit passer. Tests de base (au moins : build, création commerce, inscription client, tampon, tirage roulette, réponse à un avis).
- Commits après chaque fonctionnalité qui marche. README : comment lancer, comment tester la démo, ce qui est réel vs simulé, limites honnêtes.
- Ne rien publier, ne rien pousser sur GitHub, ne créer aucun dépôt, ne dépenser rien sans OK explicite de l'utilisateur.

## Livrables attendus
- Code complet dans `~/workspace/fideliz-claude/` (ce dossier).
- `README.md`, `PLAN.md`, `JOURNAL.md` (avancement).
- App lançable en local + captures ou preuve de fonctionnement de chaque module.
- Rapport final honnête : ce qui marche vraiment, ce qui est simulé, ce qui manque pour une mise en production réelle.

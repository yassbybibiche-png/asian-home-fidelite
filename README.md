# Asian Home Fidélité

App web de fidélité pour commerces : **carte de fidélité digitale**, **roulette par QR code** avec
invitation à laisser un avis Google, et **aide aux réponses aux avis Google**. Interface en français,
pensée d'abord pour le téléphone.

Le commerce vitrine est **Asian Home Paris** (11 rue André Joineau, 93310 Le Pré-Saint-Gervais). Deux
autres commerces fictifs (un salon de coiffure, une boutique) montrent que le même produit fonctionne
pour tous les secteurs, sans aucun réglage propre à un secteur.

> **C'est une démo.** Il n'y a pas de serveur : tout est stocké dans le navigateur. Rien n'est envoyé,
> rien n'est publié, aucun paiement. Les clients, avis et tirages d'Asian Home Paris sont **fictifs**
> (seules les coordonnées publiques du restaurant sont réelles).

## Lancer

Prérequis : Node.js ≥ 23.6 (testé avec Node 24) et npm.

```bash
npm install        # dépendances
npm run dev        # serveur de développement → http://localhost:5173
npm run build      # vérification TypeScript + build de production dans dist/
npm run preview    # sert dist/ → http://localhost:4173
npm test           # tests de la logique métier (voir plus bas)
npm run seed       # régénère src/data/seed.json (déterministe)
```

`dist/` est un site statique : il peut être déposé tel quel sur n'importe quel hébergement statique.
(Aucun hébergement n'a été fait.)

## Tester la démo depuis un téléphone

Le téléphone doit pouvoir joindre l'app : soit l'ordinateur qui la lance est sur le même Wi-Fi
(`npm run dev -- --host`, puis ouvrir `http://<adresse-IP-de-l-ordinateur>:5173` sur le téléphone),
soit l'app est hébergée quelque part (pas fait pour l'instant).

1. **Accueil** : le tableau de bord d'Asian Home Paris s'affiche (4 chiffres, derniers avis, derniers gains).
   Le sélecteur en haut permet de passer aux 2 autres commerces.
2. **Clients** → « + Inscrire un client » (prénom + téléphone ou e-mail), puis « Valider une visite (+1) » :
   la progression passe à 1/10. Karim a une carte pleine : ouvrez sa fiche → « Offrir la récompense ».
   L'onglet « À relancer » liste les clients absents depuis 30 jours, avec un message à copier.
3. **Roulette** → « Ouvrir la page client » : entrez un prénom et un numéro, tournez la roue.
   Un 2e essai le même jour est refusé. Après le jeu, l'invitation à laisser un avis Google s'affiche
   (le lot ne dépend pas de l'avis).
4. **Avis** → « + Simuler un nouvel avis » en 5★ : la réponse automatique s'applique. Sur un avis négatif,
   « Relire et valider le brouillon » → « Marquer comme répondu ».
5. **Plus → Admin** : ajoutez un commerce en 1 formulaire (nom, type, lien Google), puis « Réinitialiser
   la démo » pour revenir aux données de départ.

Attention : les données sont propres à **chaque navigateur**. Un QR code scanné depuis un autre téléphone
ouvre une copie séparée de la démo ; les tirages faits là-bas ne remontent pas chez le commerçant. Pour
une démo cohérente, faites tout sur le même téléphone.

## Ce qui est réel, ce qui est simulé

| Élément | État |
|---|---|
| Carte de fidélité (inscription, tampons, progression, récompense, historique) | **Réel** dans l'app, stocké dans le navigateur (localStorage) |
| QR code personnel du client et QR code unique du commerce | **Réel** : générés localement (lib `qrcode-generator`), scannables |
| Roulette (tirage pondéré, roue animée, 1 tirage par client et par jour) | **Réel** dans l'app ; l'anti-abus repose sur le téléphone/e-mail saisi et ne vaut que dans ce navigateur |
| Relance des clients inactifs (30 jours) | Liste et message **réels** ; l'**envoi** est à faire soi-même (copier-coller) |
| Lien « Laisser un avis Google » | **Réel** (ouvre le lien configuré) ; pour Asian Home Paris c'est une recherche Google Maps, pas encore le lien direct « laisser un avis » |
| Avis Google affichés | **Simulés** : données de démo, aucune connexion à Google |
| Réponses aux avis (modèles, réponse auto, brouillons) | Logique **réelle**, mais **rien n'est publié** sur Google (simulé) |
| Apple Wallet / Google Wallet | **Simulé** : le bouton explique qu'aucun pass n'est créé |
| SMS / e-mail | **Simulés / absents** : rien n'est envoyé |
| Paiements | **Absents** (l'offre affichée est gratuite, aucune souscription) |
| Comptes / connexion | **Absents** : tout le monde voit tout, admin compris |
| Kit de lancement (flyers, étiquettes, adhésif vitrine) | Décrit dans l'offre ; le QR est généré, mais **l'impression n'est pas faite** |

## Tests

`npm test` lance le lanceur de tests intégré à Node (`node --test`) sur `tests/*.test.ts` (23 tests).
Pas de Vitest : Node exécute le TypeScript directement, ça évite une dépendance et ne touche pas au build.

Les tests portent sur la **logique pure** (hors React) :

- création d'un commerce (formulaire court, mêmes réglages par défaut pour tous les secteurs) ;
- inscription d'un client (téléphone ou e-mail, pas de doublon quel que soit le format : 06…, +33…, 0033…) ;
- 1 visite = 1 tampon, progression, affichage plafonné au seuil, récompense offerte avec report des tampons excédentaires ;
- roulette : tirage pondéré, roue qui s'arrête dans le bon secteur, 1 tirage par client et par jour ;
- avis : choix du modèle, réponse auto aux 5★, brouillons, réponse existante jamais écrasée ;
- cohérence du seed (dates récentes et jamais futures, tampons = visites − récompenses, tirages un jour
  de visite) et « Réinitialiser la démo » (avec un localStorage simulé).

**Non testé automatiquement** : l'interface React (clics, rendu, animation de la roue). Aucun navigateur
n'était disponible dans l'environnement de développement : le rendu sur téléphone a été relu dans le code,
pas vérifié à l'écran.

## Limites pour une vraie mise en production

- **Backend et base de données** : indispensable. Aujourd'hui tout est dans le navigateur, donc le QR scanné
  par un client ne parle pas à l'écran du commerçant. Le code passe par une interface `Depot`
  (`src/data/depot.ts`) : il faut en écrire une version qui appelle une API.
- **Authentification** : comptes commerçants (1 compte = 1 commerce), rôle admin séparé, et une vraie
  validation des visites (scan du QR client par le commerçant, ou code) au lieu d'un simple bouton.
- **Anti-abus côté serveur** : la limite de 1 tirage par jour se contourne en changeant de numéro ou de
  navigateur. Il faut vérifier côté serveur (et idéalement le téléphone, par SMS).
- **Vraie API Google** : lire les avis et publier les réponses passe par l'API Google Business Profile
  (compte Google du commerce, OAuth, accès à demander à Google). Récupérer aussi le vrai lien « laisser
  un avis » de chaque fiche.
- **Vrais passes Wallet** : Apple Wallet exige un compte Apple Developer payant et des passes signés ;
  Google Wallet exige un compte émetteur et une API. Il faut aussi les mettre à jour à chaque tampon.
- **Envois SMS / e-mail** : prestataire d'envoi, consentement marketing explicite, lien de désinscription.
- **Hébergement** : site statique + API + base, nom de domaine, HTTPS, sauvegardes.
- **RGPD** : on collecte prénom + téléphone/e-mail. Il faut une politique de confidentialité, une base légale
  et un consentement pour les relances, des durées de conservation, l'export et la suppression sur demande,
  un registre des traitements et un hébergement dans l'UE de préférence.
- **Jeu-concours** : vérifier les règles applicables à une roulette promotionnelle (règlement, conditions,
  pas d'obligation d'achat).
- **Images et marque** : le logo est aujourd'hui en initiales ; prévoir l'envoi d'un vrai logo.

## Structure

```
src/lib/        logique pure testée (fidelite, roulette, avis, stats)
src/data/       seed.json, valeurs par défaut, persistance (Depot)
src/pages/      écrans (tableau de bord, clients, roulette, avis, réglages, offre, admin, pages publiques)
scripts/        générateur du seed
tests/          tests node --test
```

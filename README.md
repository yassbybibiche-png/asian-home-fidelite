# Asian Home Fidélité

App web de fidélité pour commerces : **carte de fidélité digitale**, **roulette par QR code** avec
invitation à laisser un avis Google, et **aide aux réponses aux avis Google**. Interface en français,
pensée d'abord pour le téléphone.

Le commerce vitrine est **Asian Home Paris** (11 rue André Joineau, 93310 Le Pré-Saint-Gervais). Deux
autres commerces fictifs (un salon de coiffure, une boutique) montrent que le même produit fonctionne
pour tous les secteurs, sans aucun réglage propre à un secteur.

> **Deux modes** (choisis à la compilation par la variable `VITE_API_URL`) :
> - **Démo locale** (par défaut, `VITE_API_URL` absente) : tout est stocké dans le navigateur, avec des clients, avis et
>   tirages **fictifs** ; bandeau « Démo locale — données sur cet appareil seulement » sur chaque écran commerçant.
> - **Mode API** (`VITE_API_URL` définie) : données **réelles et partagées** sur le serveur `server/` — le comptoir et le
>   téléphone du client voient la même carte, le tirage est fait par le serveur, accès commerçant par PIN.
>   Avec `DEMO=0` (défaut du serveur), Asian Home Paris démarre **vide** (0 client, 0 avis, 0 tirage).
>
> Dans les deux modes : rien n'est publié sur Google, aucun SMS / e-mail n'est envoyé, aucun paiement.

## Lancer

Prérequis : Node.js ≥ 23.6 (testé avec Node 24) et npm.

```bash
npm install        # dépendances
npm run dev        # serveur de développement → http://localhost:5173
npm run build      # vérification TypeScript + build de production dans dist/
npm run preview    # sert dist/ → http://localhost:4173
npm test           # tests de la logique métier (voir plus bas)
npm run seed       # régénère src/data/seed.json (déterministe)
npm run serveur    # backend partagé (API /api/v1, SQLite) → http://localhost:3001/api/v1/sante
npm run build:api  # build du front en MODE API, servi par le serveur lui-même (VITE_API_URL=/, cf. .env.api)
```

**Backend partagé** : `server/` (Node 24, zéro dépendance, `node:sqlite`). Variables, API, PIN,
déploiement et limites : voir [`server/README.md`](server/README.md).

### Mode API (données partagées) en local

```bash
npm run build:api   # front compilé en mode API dans dist/
npm run serveur     # sert l'API ET le front → http://localhost:3001/
```

Ouvrir `http://localhost:3001/` : écran « Espace commerçant ». PIN de développement (serveur lancé sans variable) :
commerce Asian Home Paris `1234`, admin `000000` — **jamais en production** (voir `server/README.md`).
Variante avec le serveur de dev Vite : `VITE_API_URL=http://localhost:3001 npm run dev` (le serveur autorise le CORS).

**Fonctionnement en mode API**

- Au démarrage : les dernières données connues (cache du navigateur) s'affichent tout de suite, puis l'app charge
  le serveur ; rechargement toutes les **10 s** (page visible), au retour au premier plan et après chaque action.
- **Conflits : le serveur fait foi.** Chaque chargement remplace entièrement les données locales. Aucune action n'est
  appliquée « en local d'abord » : si le serveur ne répond pas, l'action est refusée avec le message « Serveur
  injoignable — vérifiez la connexion » (jamais de fausse réussite) et un bandeau « Hors ligne — dernières données
  connues (heure) » s'affiche. Pas de file d'attente hors ligne : à refaire une fois la connexion revenue.
- **PIN** : écran de déverrouillage par commerce (PIN 4-6 chiffres) ou PIN admin (tous les commerces + page Admin).
  Le PIN n'est jamais affiché ; il est mémorisé **pour la durée de l'onglet** (sessionStorage), **chiffré** (AES-GCM,
  clé WebCrypto non exportable rangée dans IndexedDB). « 🔒 Verrouiller » efface le PIN, la clé et les données
  clients gardées sur l'appareil. Sans WebCrypto (page en `http://` hors localhost), le PIN n'est pas mémorisé.
- **Page de jeu** `#/jouer/:id` : le client s'identifie (prénom + téléphone/e-mail), puis le **serveur** vérifie la
  visite du jour et le tirage du jour et tire le lot (`POST /tirages`) ; le navigateur ne fait qu'animer la roue
  jusqu'au lot reçu et affiche le **code gagnant** à montrer au comptoir (le commerçant voit le même code dans
  Roulette / Tableau de bord / fiche client). La roue se débloque toute seule dès que la visite est validée au comptoir.
- **Onboarding** : Admin → « + Ajouter un commerce » crée le commerce **et** son PIN en une seule étape, puis ouvre Réglages.

`dist/` est un site statique : il peut être déposé tel quel sur n'importe quel hébergement statique.
(Aucun hébergement n'a été fait.)

## Tester la démo locale depuis un téléphone

Le téléphone doit pouvoir joindre l'app : soit l'ordinateur qui la lance est sur le même Wi-Fi
(`npm run dev -- --host`, puis ouvrir `http://<adresse-IP-de-l-ordinateur>:5173` sur le téléphone),
soit l'app est hébergée quelque part (pas fait pour l'instant).

1. **Accueil** : le tableau de bord d'Asian Home Paris s'affiche (4 chiffres, derniers avis, derniers gains).
   Le sélecteur en haut permet de passer aux 2 autres commerces.
2. **Clients** → « + Inscrire un client » (prénom + téléphone ou e-mail), puis « Valider une visite (+1) » :
   la progression passe à 1/10. Karim a une carte pleine : ouvrez sa fiche → « Offrir la récompense ».
   L'onglet « À relancer » liste les clients déjà venus mais absents depuis plus de 30 jours, avec un message
   à copier. Un inscrit sans aucune visite n'est ni « actif » ni « à relancer ».
3. **Roulette** (1 participation = 1 visite validée le jour même) :
   1. **Clients** → inscrivez un client (ou prenez un client existant) et cliquez « Valider une visite (+1) »
      — c'est le geste du commerçant au comptoir.
   2. **Roulette** → « Ouvrir la page client » : entrez le même prénom et le même numéro, tournez la roue.
   3. Sans visite validée aujourd'hui, la roue ne se lance pas : « Pour jouer, validez d'abord votre visite
      du jour au comptoir. » + lien vers la carte (essayez avec un numéro jamais validé). La page de jeu
      ne crée jamais de visite elle-même.
   4. Un 2e essai le même jour est refusé. Après le jeu, l'invitation à laisser un avis Google s'affiche
      (le lot ne dépend pas de l'avis).
   La page de jeu peut rester ouverte dans un autre onglet : la visite validée côté commerçant la débloque
   aussitôt (même navigateur uniquement).
4. **Avis** → « + Simuler un nouvel avis » en 5★ : la réponse automatique s'applique. Sur un avis négatif,
   « Relire et valider le brouillon » → « Marquer comme répondu ».
5. **Plus → Admin** : ajoutez un commerce en 1 formulaire (nom, type, lien Google), puis « Réinitialiser
   la démo » pour revenir aux données de départ.

Attention (démo locale uniquement) : les données sont propres à **chaque navigateur**. Un QR code scanné depuis
un autre téléphone ouvre une copie séparée de la démo ; les tirages faits là-bas ne remontent pas chez le
commerçant. Pour une démo cohérente, faites tout sur le même téléphone — ou utilisez le **mode API**, où ce
problème n'existe plus.

## Ce qui est réel / ce qui reste à brancher

| Élément | Mode API (serveur) | Démo locale |
|---|---|---|
| Données (clients, tampons, tirages, avis) | **Réelles et partagées** (SQLite sur le serveur) ; le comptoir et le téléphone du client voient la même chose | Fictives, dans ce navigateur (localStorage) |
| Carte de fidélité (inscription, tampons, récompense, historique) | **Réel**, décidé par le serveur | Réel dans l'app, local |
| Anti-doublon client (06…, +33…, 0033…, e-mail) | **Réel**, côté serveur (+ contrainte SQL) | Réel, local |
| Roulette (1 participation par visite validée le jour même, 1 tirage par jour, lot tiré) | **Réel côté serveur** (`POST /tirages`), code gagnant à 6 caractères vérifiable au comptoir | Tirage dans le navigateur, ne vaut que pour ce navigateur |
| Accès commerçant | **PIN par commerce** + PIN admin (anti-bruteforce) — pas de vrais comptes | Aucun : tout le monde voit tout |
| Recherche clients | Réelle : téléphone dans tous les formats, prénoms sans accents | idem |
| Export CSV des clients | **Réel** : téléchargé depuis le serveur (`/export.csv`, PIN) | Généré dans le navigateur (même format) |
| Relance des clients inactifs (30 jours) | Liste et message **réels** ; l'**envoi** est à faire soi-même (bouton Copier) | idem |
| QR codes (vitrine, carte personnelle) | **Réels**, générés localement ; à imprimer depuis l'adresse publique définitive | Réels, pointent vers ce navigateur |
| Lien « Laisser un avis Google » | **Réel** (lien direct pour Asian Home Paris, repris du linktr.ee officiel du restaurant) | idem |
| Avis Google | **Pas de connexion à Google** : avis saisis à la main (« + Saisir un avis reçu ») | Avis fictifs |
| Réponses aux avis (modèles, réponse auto, brouillons) | Logique réelle, **rien n'est publié sur Google** (à copier soi-même) | idem, étiqueté démo |
| Apple Wallet / Google Wallet | **Pas disponible** (le bouton le dit) | Simulé (le bouton le dit) |
| SMS / e-mail | **Absents** : rien n'est envoyé | idem |
| Paiements | **Absents** | idem |
| Hébergement | **Pas fait** : rien n'est déployé (voir `server/README.md`, l'offre gratuite de Render ne convient pas au vrai restaurant) | — |
| Kit de lancement (flyers, étiquettes, adhésif) | Décrit dans l'offre ; QR généré, **impression non faite** | idem |

Badge « Démo » : en mode API, il n'apparaît **que** sur les commerces venant du seed de démonstration (`DEMO=1`,
`demo: true`) ; Asian Home Paris (réel) n'en a jamais. En démo locale, il est affiché partout.

## Tests

`npm test` lance le lanceur de tests intégré à Node (`node --test`) sur `tests/*.test.ts` (81 tests : 36 de logique,
21 du serveur dans `tests/serveur.test.ts`, 24 du front V2 dans `tests/front-v2.test.ts`).
Pas de Vitest : Node exécute le TypeScript directement, ça évite une dépendance et ne touche pas au build.

Les tests portent sur la **logique pure** (hors React) :

- création d'un commerce (formulaire court, mêmes réglages par défaut pour tous les secteurs) ;
- inscription d'un client (téléphone ou e-mail, pas de doublon quel que soit le format : 06…, +33…, 0033…) ;
- 1 visite = 1 tampon, progression, affichage plafonné au seuil, récompense offerte avec report des tampons excédentaires ;
- roulette : tirage pondéré, roue qui s'arrête dans le bon secteur, 1 tirage par client et par jour,
  jeu refusé sans visite validée le jour même (ni la veille, ni dans un autre commerce) ;
- clients actifs / à relancer : un inscrit sans visite n'est ni l'un ni l'autre, actif = visite dans les 30 derniers jours ;
- avis : choix du modèle, réponse auto aux 5★, brouillons, réponse ou brouillon existant jamais écrasé,
  modèle négatif sans affirmation d'envoi ; lien direct d'avis Google d'Asian Home Paris (et migration de l'ancien lien Maps) ;
- cohérence du seed (dates récentes et jamais futures, tampons = visites − récompenses, tirages un jour
  de visite) et « Réinitialiser la démo » (avec un localStorage simulé) ;
- serveur (vrai HTTP sur port éphémère, base SQLite temporaire) : PIN admin / commerçant, déduplication,
  visite, récompense, tirage refusé sans visite / 2e fois / avec un autre format du numéro, export CSV,
  persistance après redémarrage, `DEMO=1`, anti-bruteforce (429) ; carte publique `GET /cartes/:id` (sans contact
  ni code gagnant) ; et le **client HTTP du front** contre le vrai serveur (création → inscription → visite → tirage →
  refus → CSV) ;
- front V2 (sans serveur, `fetch` simulé) : recherche normalisée (`0612345678` retrouve « 06 12 34 56 78 », +33,
  0033, points, tirets, prénoms sans accents), contenu du CSV (BOM, `;`, anti-formule, guillemets) et BOM conservé
  au téléchargement, bascule local / API (`VITE_API_URL`), dépôt API (PIN d'un commerce = ses données seulement,
  serveur qui fait foi sur le cache, hors ligne, « Verrouiller » efface), tirage via l'API simulée (refus sans visite,
  lot du serveur et secteur de la roue, 2e tirage refusé, serveur injoignable sans faux résultat, le navigateur
  n'envoie jamais de lot), PIN mémorisé chiffré (jamais en clair, clé non exportable, effacé au verrouillage).

**Non testé automatiquement** : l'interface React (clics, rendu, animation de la roue). Aucun navigateur n'a pu
être lancé dans l'environnement de développement (téléchargement de Chromium refusé par le réseau) : chaque écran
a été **rendu en HTML côté serveur** (mode local, sans erreur), mais le rendu sur téléphone n'a pas été vu à l'écran.

## Limites pour une vraie mise en production

- **Hébergement du serveur** : fait en local seulement. Rien n'est déployé ; l'offre gratuite de Render efface
  la base à chaque mise en veille (voir `server/README.md`) — un hébergement payant avec disque est à valider.
- **Authentification** : un PIN par commerce (partagé par l'équipe) + un PIN admin ; pas de vrais comptes ni de
  journal « qui a fait quoi ». La validation d'une visite reste un bouton (pas de scan du QR client par le commerçant).
- **Anti-abus** : vérifié côté serveur (1 tirage par client et par jour, visite du jour obligatoire), mais le
  téléphone n'est pas vérifié (pas de SMS) : quelqu'un qui connaît le numéro d'un client voit son prénom et ses tampons.
- **Hors ligne** : pas de file d'attente ; une action faite sans réseau est refusée et doit être refaite.
- **Vraie API Google** : lire les avis et publier les réponses passe par l'API Google Business Profile
  (compte Google du commerce, OAuth, accès à demander à Google). Récupérer aussi le vrai lien « laisser
  un avis » de chaque fiche (fait pour Asian Home Paris ; les 2 autres commerces de démo ont des liens fictifs).
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
src/lib/        logique pure testée (fidelite, roulette, avis, stats, recherche, csv)
src/data/       seed.json, valeurs par défaut, persistance locale (depot), mode API : client HTTP (api),
                dépôt API + cache (depotApi), PIN chiffré (coffrePin), tirage serveur (jeuApi)
src/store.tsx   état de l'app : StoreLocal (démo) ou StoreApi (serveur), choisi par VITE_API_URL
src/pages/      écrans (tableau de bord, clients, roulette, avis, réglages, offre, admin, pages publiques)
server/         backend partagé (API /api/v1, SQLite) — voir server/README.md
scripts/        générateur du seed
tests/          tests node --test
```

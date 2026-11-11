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
> Dans les deux modes : rien n'est publié ni importé depuis Google, aucun SMS / e-mail n'est envoyé, aucun pass Wallet
> n'est créé, aucun paiement. Ces intégrations sont **préparées mais « à brancher »** (V3) : voir plus bas.

## Lancer

Prérequis : Node.js ≥ 23.6 (testé avec Node 24) et npm.

```bash
npm install        # dépendances
npm run dev        # serveur de développement → http://localhost:5173
npm run build      # vérification TypeScript + build de production dans dist/
npm run preview    # sert dist/ → http://localhost:4173
npm test           # tests de la logique métier (voir plus bas)
npm run test:e2e   # parcours complet dans un vrai Chromium (Playwright, serveur local + SQLite temporaire)
npm run seed       # régénère src/data/seed.json (déterministe)
npm run serveur    # backend partagé (API /api/v1, SQLite) → http://localhost:3001/api/v1/sante
npm run build:api  # build du front en MODE API, servi par le serveur lui-même (VITE_API_URL=/, cf. .env.api)
```

**Backend partagé** : `server/` (Node 24, `node:sqlite` en local, Supabase en production). Variables, API, PIN,
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
| Données (clients, tampons, tirages, avis) | **Réelles et partagées** sur le serveur ; le comptoir et le téléphone du client voient la même chose. Base : SQLite en local ; en production **Supabase** (prêt, voir ligne suivante) | Fictives, dans ce navigateur (localStorage) |
| Base de production Supabase | **Prête, projet PAS créé** : schéma + RLS + adaptateur ; migration **exécutée sur un vrai Postgres local** (PGlite, PostgreSQL 18.6) mais **jamais sur Supabase** ; procédure pas à pas dans `server/README.md` | — |
| Carte de fidélité (inscription, tampons, récompense, historique) | **Réel**, décidé par le serveur | Réel dans l'app, local |
| Anti-doublon client (06…, +33…, 0033…, e-mail) | **Réel**, côté serveur (+ contrainte SQL) | Réel, local |
| Roulette (1 participation par visite validée le jour même, 1 tirage par jour, lot tiré) | **Réel côté serveur** (`POST /tirages`), code gagnant à 6 caractères vérifiable au comptoir | Tirage dans le navigateur, ne vaut que pour ce navigateur |
| Accès commerçant | **PIN par commerce** + PIN admin (anti-bruteforce) — pas de vrais comptes | Aucun : tout le monde voit tout |
| Recherche clients | Réelle : téléphone dans tous les formats, prénoms sans accents | idem |
| Export CSV des clients | **Réel** : téléchargé depuis le serveur (`/export.csv`, PIN) | Généré dans le navigateur (même format) |
| Relance des clients inactifs (30 jours) | Liste et message **réels** ; l'**envoi** est à faire soi-même (bouton Copier). UI : « Envoi SMS/e-mail à brancher » | idem |
| QR codes (vitrine, carte personnelle) | **Réels**, générés localement ; à imprimer depuis l'adresse publique définitive | Réels, pointent vers ce navigateur |
| Lien « Laisser un avis Google » | **Réel** (lien direct pour Asian Home Paris, repris du linktr.ee officiel du restaurant) | idem |
| Avis Google | **À brancher** : aucune connexion à Google, aucun import. Asian Home démarre avec **0 avis** et le message « Connectez Google Business Profile pour importer vos avis » + section « Connecter Google » (étapes). Saisie manuelle possible (« + Saisir un avis reçu ») | Avis fictifs, étiquetés « Démo — avis simulés, aucune connexion à Google » |
| Réponses aux avis (modèles, réponse auto, brouillons) | Logique réelle, **rien n'est publié sur Google** (à copier soi-même ; « Répondu » = marqué par le commerçant) | idem, étiqueté démo |
| Caisse (`#/caisse/<commerceId>`) | **Réel** : code équipe à 4 chiffres, scan du QR client (caméra ; `BarcodeDetector` ou `jsqr` chargé à la demande) + recherche manuelle, « Ajouter un passage » (1 tampon / jour + points selon le montant), « Valider une récompense », échange de points. **File hors ligne** (localStorage) envoyée au retour du réseau, sans double comptage (identifiant d'action) | Non disponible (message) |
| Points + catalogue | **Réel**, calculé et stocké par le serveur (1 point / € par défaut, réglable) ; échanges tracés (solde avant / après, auteur) | Réglages seulement |
| Équipe + journal d'audit | **Réel** : membres + codes hachés, chaque passage / récompense / échange tracé (qui, quel client, quand), visible dans le tableau de bord | Non disponible |
| Messages automatiques + messagerie | **Réel dans l'app** : bienvenue, plus que 2 tampons, récompense, relance 30 j, anniversaire, demande d'avis (5★ pré-remplies) → boîte de réception sur la carte du client + texte à copier ; message ciblé (tous / inactifs / proches / nouveaux). **Aucun SMS / e-mail envoyé** | Non disponible |
| Menu digital (`#/menu/<commerceId>`) | **Réel** : catégories, produits, prix, photo (URL ou image compressée), allergènes ; QR du menu ; lien depuis la carte | Non disponible |
| Apparence de la carte | **Réel** : couleurs (contraste ≥ 4,5:1 vérifié), bannière, logo, aperçu en direct ; charte par défaut inchangée | idem |
| Apple Wallet | **En suspens** (décision du 09/11/2026) : code `.pkpass` prêt (`server/wallet-apple.ts`) mais branché nulle part, refuse sans certificat ; aucun pass | idem |
| Google Wallet | **À brancher** : génération réelle (JWT signé) derrière la configuration ; `pass.json` répond 501 (pas de compte émetteur). Côté client : encart « Carte Wallet : bientôt », aucun bouton d'ajout | idem, étiqueté démo |
| SMS / e-mail | **À brancher** : adaptateurs Twilio / Brevo prêts côté serveur, mais aucune clé → 501, **rien n'est envoyé** | Rien n'est envoyé |
| Paiements | **Absents** | idem |
| Hébergement | **Pas fait**, rien n'est déployé. Retenu : serveur Node sur **Render Free** (Frankfurt) + base **Supabase Free** (Central EU Frankfurt) = 0 € ; la veille Render ne perd plus de données (elles sont chez Supabase) | — |
| Limites du gratuit (vérifiées le 09/11/2026) | Supabase : 500 Mo de base, 5 Go d'egress/mois, 2 projets, **pause après 7 jours d'inactivité**, **aucune sauvegarde** ; Render : veille après 15 min, ~1 min de réveil, 750 h/mois. Détails et sources ci-dessous | — |
| Kit de lancement (flyers, étiquettes, adhésif) | Décrit dans l'offre ; QR généré, **impression non faite** | idem |

### Mise en ligne gratuite : Supabase + Render (résumé — procédure exacte dans `server/README.md`)

Rien n'a été créé ni déployé. Ce que vous aurez à cliquer :
1. **Supabase** : compte → *New project* « asian-home-fidelite », mot de passe de base noté à part (≠ clés API), région
   **Central EU (Frankfurt)**, plan **Free**.
2. **SQL Editor** : exécuter `supabase/migrations/0001_schema_initial.sql` puis `0002_rls.sql` ; vérifier 5 tables avec RLS.
3. Récupérer `SUPABASE_URL` (bouton *Connect*) et la clé secrète `sb_secret_…` (*Settings → API Keys*) — libellés d'après la
   doc du 09/11/2026, à confirmer à l'écran.
4. **GitHub** : dépôt privé, pousser le code. **Render** : *New → Blueprint* → choisir le dépôt → le fichier `render.yaml`
   (S3) règle tout seul Frankfurt, Free, build `npm ci && npm run build:api`, start `npm run serveur`, `NODE_VERSION=24` →
   saisir les 4 secrets demandés (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PIN`, `PIN_ASIAN_HOME`) →
   **Deploy Blueprint**.
5. Vérifier `https://<nom>.onrender.com/api/v1/sante` → `"stockage":"supabase"`, puis refaire le parcours sur un commerce
   de test (inscription → visite → tirage → 2e tirage refusé → export CSV) et le supprimer.

**Limites du gratuit, lues sur les pages officielles le 09/11/2026** ([supabase.com/pricing](https://supabase.com/pricing),
[Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing),
[Backups](https://supabase.com/docs/guides/platform/backups), [render.com/docs/free](https://render.com/docs/free)) :
- Supabase Free : 2 projets actifs, **500 Mo** de base, **5 Go** d'egress (+ 5 Go en cache) par mois, **pause après 7 jours de
  faible activité** (e-mail d'avertissement avant ; réactivation manuelle « Resume project » dans le dashboard, durée non
  indiquée ; réactivable jusqu'à 1 an — un ancien changelog disait 90 jours), **aucune sauvegarde** (export CSV régulier).
- Supabase Pro (à partir de 25 $/mois) : plus de pause, sauvegardes quotidiennes gardées 7 jours, 8 Go, 250 Go d'egress.
- Render Free : veille après **15 min** sans visite, réveil **~1 min** (le premier client attend), 750 h/mois.
- ⚠️ Egress à surveiller : l'écran commerçant recharge tout toutes les 10 s ; estimation ~8 Go/mois (non compressé) avec
  100 clients et une tablette ouverte 12 h/jour. Négligeable au lancement ; à contrôler dans *Usage* après 1-2 semaines.
- S1 n'avait noté aucun chiffre du gratuit ; les emplacements des clés notés en S1 (« Project Settings → API ») étaient périmés.
- Données à migrer : **aucune** pour Asian Home (production vide) ; aucun outil d'import automatique n'existe.

### Identifiants et comptes encore nécessaires (aucun n'a été créé)

| Quoi | Pour | Qui le fournit |
|---|---|---|
| Accès à la fiche **Google Business Profile** (compte Google propriétaire ou gestionnaire) + consentement OAuth | Importer les avis, publier les réponses | **Client** (le restaurant) |
| Projet Google Cloud approuvé pour les API Business Profile + identifiant OAuth (scope `business.manage`) | idem | **Utilisateur** (éditeur de l'app) |
| Compte **Apple Developer** (99 $/an), Pass Type ID, certificat + clé de signature | Apple Wallet — **en suspens**, à activer sur décision explicite | **Utilisateur** |
| Compte **émetteur Google Wallet** + API Google Wallet activée + clé de compte de service | Google Wallet | **Utilisateur** |
| Compte **prestataire SMS** (Twilio) et/ou **e-mail** (Brevo) + clés API + expéditeur validé | Relances automatiques | **Utilisateur** (le client donne son accord pour l'envoi en son nom) |
| Compte **Supabase** (plan Free) + projet en région Central EU (Frankfurt) | Base de production | **Utilisateur** (0 € ; Pro 25 $/mois seulement si décidé) |
| Dépôt **GitHub privé** + compte **Render** (Free Web Service, Frankfurt) | Hébergement du serveur Node | **Utilisateur** (0 €) |
| **Nom de domaine** (+ HTTPS) | Adresse définitive des QR imprimés | **Utilisateur**, ou le **client** s'il veut son propre domaine |
| Consentement des clients finaux aux relances (case à cocher à ajouter) | RGPD, avant tout envoi | Recueilli par le **client** au comptoir / dans l'app |

### Envoi SMS / e-mail : à brancher

- **Prestataires recommandés** (les plus simples à brancher, adaptateurs déjà écrits) : **Twilio** pour les SMS, **Brevo**
  (ex-Sendinblue, société française) pour les e-mails. SendGrid est une alternative pour l'e-mail (adaptateur non écrit).
  **Prix : à vérifier sur le site du prestataire** (non vérifiés ici, aucun prix inventé).
- **Variables d'environnement** : `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (SMS) ; `BREVO_API_KEY`,
  `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` (e-mail). Aucune n'est configurée : la route `relance` répond 501.
- **RGPD** : consentement marketing explicite et préalable du client (champ `consentementRelance`, aucun écran ne le recueille
  encore → le serveur refuse tout envoi), lien de désinscription dans chaque message (SMS : « STOP : <lien court /d/…> » ;
  e-mail : lien en pied), pas d'envoi la nuit ni le dimanche (bonnes pratiques à respecter).
- Le front reste en **copier-coller** : aucun bouton « Envoyer » n'existe tant qu'aucun prestataire n'est branché.

### Données personnelles (RGPD) — affiché aussi dans Plus et Offre

Politique complète : page publique `#/confidentialite/<commerceId>` (P1-B6), liée depuis l'inscription et le pied des
pages client. Détails techniques (cascade, purge) : `server/README.md`, « RGPD (P1-B6) ».

- **Données collectées** : prénom + téléphone ou e-mail du client, ses visites, tampons, points, récompenses et gains de la
  roulette ; anniversaire et plat préféré seulement s'il les donne.
- **Finalité** : la carte de fidélité et la roulette du commerce. Aucune revente, aucune publicité tierce.
- **Relances** : uniquement avec consentement explicite (case non pré-cochée) ; STOP, lien de désinscription.
- **Conservation** : 3 ans après la dernière visite par défaut (réglable de 6 mois à 10 ans dans Réglages). L'écran Clients
  liste à l'avance les cartes à purger ; la purge est confirmée par le commerçant (jamais automatique) et journalisée.
- **Droits** : export (CSV individuel) et suppression depuis la fiche client (bouton « Supprimer ce client… », cascade
  journalisée) ; le client peut aussi télécharger ses données et demander la suppression depuis sa carte.
- **Hébergement** : serveur Render Frankfurt ; base Supabase, région à confirmer (Central EU Frankfurt prévue).
- Restent à rédiger : registre des traitements, règlement de la roulette.

Badge « Démo » : en mode API, il n'apparaît **que** sur les commerces venant du seed de démonstration (`DEMO=1`,
`demo: true`) ; Asian Home Paris (réel) n'en a jamais. En démo locale, il est affiché partout.

## Tests

`npm test` lance le lanceur de tests intégré à Node (`node --test`) sur `tests/*.test.ts` (124 tests : 36 de logique,
21 du serveur dans `tests/serveur.test.ts`, 24 du front V2 dans `tests/front-v2.test.ts`, 13 des intégrations V3 dans
`tests/integrations-v3.test.ts`, 16 du stockage Supabase dans `tests/supabase.test.ts`, 9 de la migration SQL exécutée
sur Postgres dans `tests/migration-pglite.test.ts`, 5 du Blueprint Render dans `tests/render-yaml.test.ts`).
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
  n'envoie jamais de lot), PIN mémorisé chiffré (jamais en clair, clé non exportable, effacé au verrouillage) ;
- intégrations V3 : charge utile Google Wallet (champs, tampons x/seuil plafonnés, QR vers `#/carte/:id`, jamais le contact),
  `pass.json` → 501 sans config et « NON signée » avec config ; aucun code de pass Apple dans `server/`, `src/`, `scripts/` et
  aucune route Apple ; relances SMS / e-mail → 501 sans clé (aucun appel réseau), refus sans consentement, requêtes Twilio /
  Brevo bien formées (avec un `fetch` simulé, **jamais contre les vrais services**) ; production : 0 avis, aucun avis du seed ;
  textes « à brancher », démo « avis simulés », bloc RGPD ;
- Supabase (S1, **sans vrai projet** : client officiel `@supabase/supabase-js` branché sur un faux PostgREST en mémoire) :
  requêtes envoyées (tables, colonnes, filtres, tri), déduplication par `cleContact` refusée par la contrainte unique,
  2e tirage du jour refusé par l'index unique (jour à Paris), double tirage / double visite / double inscription
  simultanés, choix SQLite / Supabase selon les variables d'environnement, parcours complet du serveur sur Supabase avec
  les mêmes fonctions métier, migration SQL (contraintes, RLS sans policy), `.env.example` sans vraie clé ;
- migration SQL (S2) **exécutée par un vrai Postgres** (PGlite = PostgreSQL 18.6 en WebAssembly, en mémoire, sans réseau) :
  0001 + 0002 passent et sont rejouables, 5 tables avec RLS et aucune policy, anon / authenticated refusés, index
  « 1 tirage par jour à Paris » accepté et vérifié autour de minuit (heure d'hiver et d'été), anti-doublon, contraintes,
  cascade, trigger `version`. Ce n'est **pas** Supabase : à rejouer dans le SQL Editor du vrai projet.

Preuve HTTP manuelle (V2 + V3) : `npm run serveur` puis `node scripts/preuve-http-v3.mjs` — sortie dans `PREUVE-HTTP-V3.txt`.

### Test de bout en bout (navigateur)

`npm run test:e2e` (Playwright, **hors de `npm test`** : il exige le navigateur) joue le parcours principal dans un vrai
Chromium (profil téléphone Pixel 7) : `tests-e2e/scan-gain-carte.spec.ts`.

1. Une seule fois par machine : `npx playwright install chromium` (téléchargement ~320 Mo).
2. `npm run test:e2e` : `tests-e2e/serveur.ts` compile le front en mode API, puis démarre la vraie API sur
   `127.0.0.1:4317` (`E2E_PORT` pour changer) avec une **base SQLite temporaire**, effacée à l'arrêt. Aucune variable
   `SUPABASE_*` n'est lue, aucune URL distante : le test ne touche **jamais** la production.

Parcours : commerce neuf + membre d'équipe (API, PIN admin de développement) → `#/jouer/<id>` (scan du QR vitrine) →
inscription au téléphone → roue verrouillée → caisse `#/caisse/<id>` sur un 2e appareil (code équipe, recherche, « Ajouter
un passage ») → la roue se débloque → tirage par le serveur → gain + code → code vérifié puis « Marquer remis » en caisse
→ carte de fidélité à 1 tampon. Le lot est gagnant à 100 % dans ce commerce de test (résultat déterministe).
Traces en cas d'échec : `node_modules/.cache/playwright-resultats/` (`npx playwright show-trace <fichier>`).

**Non testé automatiquement** : le reste de l'interface React (écrans du gérant, animation de la roue, rendu visuel).
Le test E2E vérifie le parcours, pas l'apparence.

## Limites pour une vraie mise en production

- **Hébergement du serveur** : fait en local seulement. Rien n'est déployé. Choix : **Supabase Free** (base) + **Render Free**
  (serveur) — schéma, RLS, adaptateur et procédure prêts (S1 + S2), migration exécutée sur un Postgres local (PGlite),
  **projet pas encore créé** et jamais testé contre un vrai Supabase (voir `server/README.md`, « Supabase »).
- **Authentification** : un PIN par commerce (partagé par l'équipe) + un PIN admin ; pas de vrais comptes ni de
  journal « qui a fait quoi ». La validation d'une visite reste un bouton (pas de scan du QR client par le commerçant).
- **Anti-abus** : vérifié côté serveur (1 tirage par client et par jour, visite du jour obligatoire), mais le
  téléphone n'est pas vérifié (pas de SMS) : quelqu'un qui connaît le numéro d'un client voit son prénom et ses tampons.
- **Hors ligne** : pas de file d'attente ; une action faite sans réseau est refusée et doit être refaite.
- **Vraie API Google** : lire les avis et publier les réponses passe par l'API Google Business Profile
  (étapes exactes dans l'app, page Avis → « Connecter Google », et `server/README.md`). Le lien direct « laisser un avis »
  reste le moyen réel de collecter des avis (fait pour Asian Home Paris ; les 2 commerces de démo ont des liens fictifs).
- **Vrais passes Wallet** : Apple Wallet **en suspens** (Apple Developer 99 $/an, Pass Type ID, certificat de signature,
  clé privée, service web de mise à jour des passes — à activer sur décision explicite) ; Google Wallet : compte émetteur,
  API activée, clé de service, puis signature JWT et mise à jour à chaque tampon (non développées).
- **Envois SMS / e-mail** : adaptateurs prêts, sans clé ; écran de consentement et vrai lien de désinscription à faire.
- **Hébergement** : site statique + API + base, nom de domaine, HTTPS, sauvegardes.
- **RGPD** : bloc d'information ajouté (Plus, Offre, ci-dessus). Restent : politique de confidentialité, recueil du
  consentement aux relances, bouton de suppression d'un client, registre des traitements, durée de conservation à fixer.
- **Jeu-concours** : vérifier les règles applicables à une roulette promotionnelle (règlement, conditions,
  pas d'obligation d'achat).
- **Images et marque** : le logo est aujourd'hui en initiales ; prévoir l'envoi d'un vrai logo.

## Structure

```
src/lib/        logique pure testée (fidelite, roulette, avis, stats, recherche, csv) + textes « à brancher » / RGPD (integrations)
src/data/       seed.json, valeurs par défaut, persistance locale (depot), mode API : client HTTP (api),
                dépôt API + cache (depotApi), PIN chiffré (coffrePin), tirage serveur (jeuApi)
src/store.tsx   état de l'app : StoreLocal (démo) ou StoreApi (serveur), choisi par VITE_API_URL
src/pages/      écrans (tableau de bord, clients, roulette, avis, réglages, offre, admin, pages publiques)
server/         backend partagé (API /api/v1, SQLite en local ou Supabase en production) — voir server/README.md
supabase/       migrations SQL Supabase (schéma, contraintes, RLS)
scripts/        générateur du seed, preuves HTTP (preuve-http-v3.mjs)
tests/          tests node --test
```

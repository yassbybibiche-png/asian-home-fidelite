# Serveur Asian Home Fidélité (`server/`)

Backend partagé : le commerçant (tablette / téléphone au comptoir) et le client qui scanne le QR
voient enfin **les mêmes données**. Une seule instance Node pour tous les commerces.

- Node 24, **zéro dépendance npm** : `node:http`, `node:sqlite`, `node:crypto`.
- TypeScript exécuté directement par Node 24 (suppression des types intégrée, comme `npm test`) : pas de compilation.
- Les règles métier ne sont **pas dupliquées** : le serveur importe `src/lib/fidelite.ts`, `roulette.ts`,
  `avis.ts`, `src/data/defaults.ts` et `seed.json` — exactement le code testé du front.

| Fichier | Rôle |
|---|---|
| `server/index.ts` | Point d'entrée (`npm run serveur`) : variables d'environnement, fuseau, démarrage. |
| `server/app.ts` | Routes `/api/v1`, PIN, anti-bruteforce, validation, CSV, service du front compilé. |
| `server/stockage.ts` | Base SQLite (schéma + requêtes). |
| `tests/serveur.test.ts` | Tests HTTP réels (port éphémère, base temporaire, `fetch`), lancés par `npm test`. |

## Choix de la base : `node:sqlite` (retenu)

`node:sqlite` est utilisable dans Node 24.22 (vérifié par le test « node:sqlite est utilisable dans ce Node »,
aucun avertissement « expérimental » au démarrage). Il est donc retenu ; le repli « fichier JSON + rename
atomique » prévu en secours **n'a pas été écrit** (inutile ici).

- Un seul fichier : `data/fidelite.db` (+ `-wal` / `-shm` pendant le fonctionnement, mode WAL). Le dossier `data/` est dans `.gitignore`.
- Chaque objet est rangé tel quel en JSON (forme de `src/types.ts`) ; à côté, quelques colonnes indexées pour les recherches.
- Anti-doublon client garanti deux fois : recherche par `cleContact` (0033 / +33 / 06…, e-mail en minuscules) **et**
  contrainte d'unicité SQL `(commerce, cleContact)`.
- Toutes les écritures sensibles (inscription, visite, récompense, tirage) se font dans une transaction ;
  Node traitant les requêtes une par une sur un seul fil, deux tirages simultanés du même client ne peuvent pas passer.

## Démarrer en local

```bash
npm install          # uniquement pour le front ; le serveur n'a besoin de rien
npm run build        # optionnel : le serveur sert alors aussi le front (dist/) sur le même port
npm run serveur      # → http://localhost:3001/api/v1/sante
```

En développement, sans aucune variable : PIN admin `000000`, PIN commerçant d'Asian Home Paris `1234`
(un avertissement s'affiche au démarrage). **Ces PIN de développement ne sont jamais acceptables en production** :
en production, le serveur refuse de démarrer sans `ADMIN_PIN`.

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3001` | Port HTTP. |
| `ADMIN_PIN` | dev : `000000` ; **production : obligatoire** | PIN admin (création de commerces, accès à tous les commerces, réinitialisation d'un PIN). En production : 8 à 12 chiffres, pas tous identiques, sinon refus de démarrer. |
| `PIN_ASIAN_HOME` | dev : `1234` ; **production : obligatoire au 1er démarrage** | PIN commerçant (4 à 6 chiffres) donné à Asian Home Paris lors de la création de la base. Ignoré ensuite (le changer via `PUT /pin`). |
| `NODE_ENV` | — | `production` active le mode production. Sur Render, la variable `RENDER` (posée par Render) l'active aussi. |
| `DB_FILE` | `data/fidelite.db` | Chemin du fichier SQLite. |
| `DEMO` | `0` | `1` = ajoute aussi les 2 commerces de démo (Atelier Coiff' Camille, Maison Lila) avec leurs données fictives, marqués `demo: true`. |
| `TZ` | `Europe/Paris` | Fuseau utilisé pour « visite du jour » / « 1 tirage par jour ». Forcé à Paris si absent (les hébergeurs sont souvent en UTC). |
| `TRUST_PROXY` | `0` (`1` d'office sur Render) | Lire l'IP du client dans `X-Forwarded-For` (indispensable derrière un équilibreur, sinon l'anti-bruteforce compterait tout le monde comme une seule IP). |
| `CORS_ORIGIN` | `*` | Origine autorisée pour un front hébergé ailleurs (ex. `https://mon-front.example`). |
| `STATIC_DIR` | `dist` | Dossier du front compilé servi sur `/` (s'il contient `index.html`). |

## Données au premier démarrage (migration)

- Base vide → création d'**Asian Home Paris uniquement**, avec ses vraies informations (seed : 11 rue André Joineau,
  93310 Le Pré-Saint-Gervais · 07 82 97 48 01 · @asianhomeparis · lien d'avis direct
  `https://search.google.com/local/writereview?placeid=ChIJAV70Kqxt5kcRnhPY0L6yaf0` · lots nems / thé glacé / mochi / -10 %),
  identifiant `c-asian-home-paris` (les QR déjà imprimés restent valables), **0 client, 0 avis, 0 tirage** :
  les données fictives du seed ne sont jamais reprises pour le vrai commerce.
- `DEMO=1` → les 2 autres commerces de démo sont ajoutés (une seule fois), étiquetés `demo: true`, avec leurs
  clients / avis / tirages fictifs (dates recalées). PIN commerçant de ces commerces : `PIN_ASIAN_HOME` ou `1234`.
- Les données du navigateur (localStorage) ne sont **pas** importées : c'étaient des données de démo.

## API (`/api/v1`, JSON)

Erreurs : toujours `{ "erreur": "message en français" }` — 400 validation, 401 PIN manquant / faux,
404 inconnu, 409 règle métier refusée, 413 corps trop gros, 429 trop de PIN faux.

| Méthode et chemin | Accès | Effet |
|---|---|---|
| `GET /sante` | public | `{ ok, version, mode, stockage, demo }` |
| `GET /commerces` | public | Fiches publiques (jamais de PIN ni de hash). |
| `GET /commerces/:id` | public | Une fiche publique. |
| `POST /commerces` | admin | `{ nom, type, lienGoogle?, pin, …réglages? }` → crée le commerce (défauts de `nouveauCommerce`). |
| `PATCH /commerces/:id` | commerçant | Réglages : `nom, type, logo, lienGoogle, coordonnees, recompense, seuilTampons, lots, reglesReponseAuto, actif`. Tout autre champ → 400. Réapplique les règles d'avis (comme le front). |
| `PUT /commerces/:id/pin` | commerçant ou admin | `{ pin }` : change le PIN (PIN perdu → l'admin le réinitialise). |
| `GET /commerces/:id/etat` | commerçant | `{ commerce, clients, tirages, avis }`. |
| `POST /commerces/:id/clients` | public ou commerçant | `{ prenom, contact }` → inscrit ou retrouve (201 / 200 + `existant`). En public : réponse sans téléphone ni e-mail, commerce actif requis. Un PIN fourni est toujours vérifié. |
| `POST /commerces/:id/clients/:clientId/visite` | commerçant | `validerVisite` (1 tampon). |
| `POST /commerces/:id/clients/:clientId/recompense` | commerçant | `offrirRecompense` (report de l'excédent) ; 409 si pas encore débloquée. |
| `POST /commerces/:id/tirages` | **public** | `{ contact, prenom? }` → retrouve / crée le client, vérifie **côté serveur** la visite du jour et le tirage du jour (409 sinon), tire le lot côté serveur, l'enregistre → `{ lot, code, date, perdant }`. |
| `POST /commerces/:id/avis` | commerçant | `{ auteur, note 1-5, texte?, date? }` (saisie manuelle / simulation) + `appliquerRegles`. |
| `PATCH /commerces/:id/avis/:avisId` | commerçant | `{ reponse?: texte \| null, brouillon?: texte \| null }` puis `appliquerRegles` (un brouillon supprimé peut donc être reproposé si la règle « brouillon » est active). |
| `GET /commerces/:id/export.csv` | commerçant | Clients en CSV (UTF-8 avec BOM, séparateur `;` pour Excel FR) : `prenom;telephone;email;tampons;visites;derniereVisite;creeLe`. |

Accès « commerçant » = en-tête `X-Commerce-PIN` du commerce, **ou** `X-Admin-PIN` (l'admin ouvre tous les commerces).

Exemple :

```bash
curl -s -X POST localhost:3001/api/v1/commerces -H 'X-Admin-PIN: 000000' -H 'Content-Type: application/json' \
  -d '{"nom":"Chez Lin","type":"restaurant","pin":"4321"}'
curl -s -X POST localhost:3001/api/v1/commerces/c-asian-home-paris/tirages -H 'Content-Type: application/json' \
  -d '{"contact":"06 12 34 56 78"}'          # → 409 tant que la visite du jour n'est pas validée
```

## Sécurité (minimale, assumée)

- PIN commerçant : 4 à 6 chiffres, stocké en **SHA-256 + sel aléatoire** (jamais en clair, jamais renvoyé),
  comparaison à temps constant.
- **Anti-bruteforce** (en mémoire) : 10 PIN faux en 10 minutes depuis la même IP → 429 pendant 10 minutes,
  même avec le bon PIN. Remis à zéro à chaque redémarrage du serveur. Les routes publiques ne sont pas bloquées.
- Limite honnête : un PIN de 4 à 6 chiffres haché en SHA-256 se retrouve en quelques secondes **si le fichier de base fuit**.
  La protection repose sur le fait que le fichier n'est accessible qu'au serveur, et en ligne sur l'anti-bruteforce.
- Le tirage est entièrement décidé par le serveur : le navigateur n'envoie qu'un contact, jamais un lot.
- HTTPS : fourni par l'hébergeur (Render le fait d'office). Ne pas exposer le serveur en HTTP simple sur Internet (les PIN passent dans les en-têtes).

## Déployer (aucun déploiement n'a été fait)

### Render « Free Web Service » — 0 €, **pour tester seulement**

Prérequis : le code sur un dépôt GitHub (privé possible) — **à faire par vous**, rien n'a été poussé.

1. render.com → **Sign up** (connexion avec GitHub).
2. **New +** → **Web Service** → choisir le dépôt.
3. Réglages :
   - **Language / Runtime** : Node
   - **Build Command** : `npm ci && npm run build`
   - **Start Command** : `npm run serveur`
   - **Instance Type** : **Free**
4. **Environment Variables** (bouton « Add Environment Variable ») :
   - `NODE_VERSION` = `24`
   - `ADMIN_PIN` = un PIN de 8 à 12 chiffres choisi par vous (gardez-le pour vous)
   - `PIN_ASIAN_HOME` = le PIN 4-6 chiffres que vous donnerez au restaurant
   - (`PORT` est fourni par Render ; `TZ`, `TRUST_PROXY` et le mode production sont réglés automatiquement.)
5. **Create Web Service** → attendre « Live » → ouvrir `https://<nom>.onrender.com/api/v1/sante`.
   Le front compilé est servi à la même adresse (`https://<nom>.onrender.com/`).

**Coût : 0 €.** Limites de l'offre gratuite (doc Render, vérifiée le 09/11/2026 — à revérifier sur
render.com/pricing avant de déployer) :
- mise en **veille après 15 min sans visite**, environ **1 minute** pour se réveiller à la requête suivante ;
- 750 h d'instance gratuites par mois et par espace de travail ;
- **disque éphémère, pas de disque persistant possible** : le fichier SQLite est **effacé à chaque mise en veille,
  redémarrage ou redéploiement**. Concrètement, sur l'offre gratuite, les cartes de fidélité disparaissent
  après chaque période calme de 15 minutes.

⚠️ **Conséquence honnête : l'offre gratuite ne convient PAS au vrai restaurant.** Un export CSV régulier ne suffit pas
à la rendre utilisable : il permet de garder une trace, mais il n'existe pas (encore) de réimport, et les pertes
arriveraient plusieurs fois par jour. Utilisez-la uniquement pour essayer le parcours.

### Pour Asian Home Paris en vrai (payant — à valider par vous avant toute dépense)

Même procédure, avec **Instance Type : Starter** (à partir de 7 $/mois) + **Disks → Add Disk** :
Mount Path `/var/data`, taille 1 Go (0,25 $/Go/mois), et la variable `DB_FILE` = `/var/data/fidelite.db`.
Total indicatif ≈ 7,25 $/mois : pas de veille, données conservées entre les redémarrages.

### Sauvegarde / export

- `GET /api/v1/commerces/:id/export.csv` (PIN) : liste des clients, à télécharger régulièrement (ouvrable dans Excel).
- Sauvegarde complète : copier le fichier `data/fidelite.db` serveur arrêté (ou `sqlite3 fidelite.db ".backup copie.db"`).
  Sur Render avec disque : la plateforme annonce des instantanés quotidiens du disque (à vérifier dans le tableau de bord).
- Pas encore de route de sauvegarde complète ni d'import (tirages, avis, historique) : voir « Limites ».

## Limites honnêtes

- 1 seule instance (SQLite est un fichier local) : pas de répartition sur plusieurs serveurs.
- Anti-bruteforce et blocages en mémoire : remis à zéro au redémarrage.
- Pas de comptes utilisateurs : un PIN par commerce, partagé par l'équipe ; pas de journal « qui a fait quoi ».
- Le client se reconnaît par son téléphone / e-mail sans vérification (pas de SMS de confirmation) : quelqu'un qui
  connaît le numéro d'un client voit son prénom et ses tampons, et peut jouer à sa place s'il a une visite validée ce jour-là.
- Pas de route d'import, pas de suppression de client (RGPD : à faire à la main dans la base pour l'instant).
- Le code serveur n'est pas vérifié par `tsc` (pas de `@types/node` installé, pour ne rien ajouter) : il est couvert par les tests HTTP.
- Le front n'utilise pas encore cette API (bascule prévue en V2).

## Migration future (non faite, rien n'a été créé)

Supabase ou Firebase seraient la voie suivante quand :
- un commerce dépasse **quelques centaines de clients actifs** ou qu'il y a **beaucoup de commerces** (plusieurs instances, sauvegardes gérées) ;
- on a besoin de **temps réel** (le comptoir voit le tirage au moment où il a lieu, sans rechargement) ;
- on veut de vrais **comptes** (e-mail / mot de passe par employé) au lieu d'un PIN.

Migration prévue simple : la forme des données (`src/types.ts`) ne change pas ; il faudrait réécrire `server/stockage.ts`
(ou remplacer le serveur par des fonctions Supabase) en gardant les mêmes routes, et importer les données depuis `fidelite.db`.

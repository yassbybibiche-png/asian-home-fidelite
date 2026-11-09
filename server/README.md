# Serveur Asian Home Fidélité (`server/`)

Backend partagé : le commerçant (tablette / téléphone au comptoir) et le client qui scanne le QR
voient enfin **les mêmes données**. Une seule instance Node pour tous les commerces.

- Node 24 : `node:http`, `node:sqlite`, `node:crypto` ; une seule dépendance npm, `@supabase/supabase-js`, utilisée
  uniquement quand Supabase est configuré (phase S1).
- TypeScript exécuté directement par Node 24 (suppression des types intégrée, comme `npm test`) : pas de compilation.
- Les règles métier ne sont **pas dupliquées** : le serveur importe `src/lib/fidelite.ts`, `roulette.ts`,
  `avis.ts`, `src/data/defaults.ts` et `seed.json` — exactement le code testé du front.

| Fichier | Rôle |
|---|---|
| `server/index.ts` | Point d'entrée (`npm run serveur`) : variables d'environnement, fuseau, démarrage. |
| `server/app.ts` | Routes `/api/v1`, PIN, anti-bruteforce, validation, service du front compilé (CSV : `src/lib/csv.ts`, partagé avec le front depuis la V2). |
| `server/stockage.ts` | Base SQLite (schéma + requêtes) et contrat `Stockage` commun aux deux bases. |
| `server/stockage-supabase.ts` | **S1** : même contrat sur Supabase (API REST PostgREST, clé service_role). |
| `supabase/migrations/` | **S1** : schéma Postgres (`0001_schema_initial.sql`) et RLS (`0002_rls.sql`). |
| `server/wallet.ts`, `server/notifications/` | **V3** : intégrations préparées, inactives (voir « Intégrations préparées »). |
| `tests/serveur.test.ts` | Tests HTTP réels (port éphémère, base temporaire, `fetch`), lancés par `npm test`. |
| `tests/migration-pglite.test.ts` | **S2** : la migration Supabase exécutée par un vrai Postgres local (PGlite, WebAssembly). |
| `render.yaml` (racine) | **S3** : Blueprint Render du serveur (Free, Frankfurt, build / start, `NODE_VERSION`, 4 secrets `sync: false`). Validé par `tests/render-yaml.test.ts`. |

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
npm run build:api    # optionnel : le serveur sert alors aussi le front en mode API (dist/) sur le même port
                     # (`npm run build` seul produirait la démo locale, qui n'utilise pas le serveur)
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
| `PUBLIC_URL` | — (déduit de l'en-tête `Host`) | **V3.** Adresse publique du site (`https://…`), encodée dans le QR des passes Google Wallet. |
| `SUPABASE_URL` | — | **S1.** URL du projet Supabase (`https://<projet>.supabase.co`). Avec la suivante : stockage Supabase au lieu de SQLite. |
| `SUPABASE_SERVICE_ROLE_KEY` | — | **S1. Secret serveur.** Clé service_role / `sb_secret_…`. Voir « Supabase » ci-dessous. |
| `GOOGLE_WALLET_ISSUER_ID` | — | **V3, non configuré.** Identifiant émetteur Google Wallet. |
| `GOOGLE_WALLET_SERVICE_ACCOUNT_FILE` | — | **V3, non configuré.** Chemin du fichier JSON de la clé du compte de service Google. Les deux variables Google Wallet sont nécessaires, sinon `pass.json` répond 501. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | — | **V3, non configuré.** SMS via Twilio (`TWILIO_FROM` = numéro expéditeur `+33…` ou identifiant de Messaging Service `MG…`). Les trois sont nécessaires, sinon 501. |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | — | **V3, non configuré.** E-mail via Brevo (adresse expéditrice à valider chez Brevo ; nom optionnel). Clé + adresse nécessaires, sinon 501. |

## Supabase (phases S1 + S2) — prêt, projet PAS encore créé

Base de production retenue : **Supabase gratuit** ; le serveur Node, lui, tourne sur **Render Free** (Supabase n'héberge pas
`server/`) — procédure complète dans « Mise en production : Supabase + Render » plus bas. Aucun compte, aucun projet, aucune
clé n'existe encore : rien n'a été testé contre un vrai Supabase. Ce qui a été vérifié : l'adaptateur contre un faux PostgREST
(`tests/supabase.test.ts`) et, depuis S2, **la migration SQL exécutée par un vrai moteur Postgres local** (PGlite, voir
« Validation de la migration »).

**Choix du stockage** (au démarrage) : `SUPABASE_URL` **et** `SUPABASE_SERVICE_ROLE_KEY` définies → Supabase ; aucune des deux →
SQLite (`DB_FILE`), exactement comme avant ; une seule des deux → refus de démarrer (pour ne jamais écrire par erreur dans un
SQLite éphémère). `GET /api/v1/sante` indique `"stockage": "sqlite"` ou `"supabase"`. `npm run serveur` lit aussi un fichier
`.env` s'il existe (modèle : `.env.example` à la racine ; `.env` est ignoré par git).

**Variables** (modèle `.env.example`, placeholders seulement) :

| Variable | Où la trouver (dashboard Supabase) | Règle |
|---|---|---|
| `SUPABASE_URL` | Bouton **Connect** du projet → *Project URL* (`https://<ref>.supabase.co`) | Pas secrète, mais à mettre dans l'environnement du serveur. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Settings → API Keys** → clé secrète `sb_secret_…` (recommandée) ; à défaut, sur la même page, l'ancienne clé *service_role* (« legacy ») | **Serveur uniquement.** Contourne la RLS : jamais dans le navigateur, jamais dans une variable `VITE_…`, jamais commitée, jamais affichée dans un log (le serveur n'affiche que l'hôte du projet). |
| ~~`SUPABASE_ANON_KEY`~~ | — | **Pas utilisée** : le navigateur ne parle jamais à Supabase (tout passe par `/api/v1`), et la RLS ne lui ouvre rien. |

Emplacements **corrigés en S2** d'après la page officielle [« API keys »](https://supabase.com/docs/guides/api/api-keys), lue
le 09/11/2026 : toutes les clés sont dans *Settings → API Keys* (« il n'y a plus de page Settings → API séparée ») et l'URL
du projet est dans la fenêtre *Connect*. S1 indiquait « Project Settings → API » : **c'était l'ancien emplacement**. La même
page annonce l'abandon des clés legacy `anon` / `service_role` « d'ici fin 2026 » → prendre la clé `sb_secret_…` (la variable
garde son nom `SUPABASE_SERVICE_ROLE_KEY` ; la doc montre `createClient(url, cléSecrète)` côté serveur, comme ici, et la clé
secrète correspond au rôle `service_role`, qui contourne la RLS). Libellés exacts **à confirmer à l'écran** à la création.

**Schéma** (`supabase/migrations/0001_schema_initial.sql`, rejouable) : tables `meta`, `commerces`, `clients`, `tirages`, `avis` ;
objets métier en JSONB `donnees` (forme de `src/types.ts`, inchangée) ; colonnes `commerce_id`, `client_id`, `cle_contact`, `date`
(timestamptz) ; PIN en `pin_hash` + `pin_sel` (SHA-256 + sel, jamais en clair) ; unique `(commerce_id, cle_contact)` ;
index `tirages (commerce_id, client_id)` et `avis (commerce_id, date)` ; **index unique 1 tirage par client et par jour**
`(commerce_id, client_id, jour à Europe/Paris)` ; colonne `version` incrémentée par trigger (verrou optimiste).

**RLS** (`0002_rls.sql`) : activée sur les 5 tables, **aucune policy** ; droits de `anon` / `authenticated` retirés. Seul le
serveur (service_role, qui contourne la RLS) lit et écrit ; c'est lui qui applique PIN et règles métier.

**Transactions — limite honnête.** Le client JS passe par l'API REST : **pas de transaction sur plusieurs requêtes**. Sous
Supabase, `transaction()` n'est donc pas « tout ou rien » ; chaque écriture est atomique seule, et les cas sensibles sont
protégés par la base :
- inscription : contrainte unique (commerce, contact) — une double inscription simultanée donne un seul client ;
- tirage : index unique (client, jour à Paris) — un double tirage simultané est **rejeté par la base** (409), pas seulement
  par le test applicatif ;
- visite / récompense / modification d'avis : écriture conditionnée à la `version` lue — une double validation simultanée
  donne une réussite et un 409 « réessayez », jamais un tampon perdu en silence ;
- non couvert : une suite d'écritures coupée au milieu n'est pas annulée (ex. `PATCH /commerces/:id` peut enregistrer les
  réglages puis échouer sur la réévaluation d'un avis ; le relancer suffit). Le premier démarrage est rejouable.
- l'index du tirage du jour suppose le fuseau Europe/Paris (celui que le serveur force) : à changer avec lui.

Sous SQLite, rien ne change : vraies transactions (`BEGIN IMMEDIATE`), passées une par une.

### Limites de l'offre gratuite Supabase (vérifiées le 09/11/2026)

Lues sur les pages officielles (aucun chiffre de mémoire) : [supabase.com/pricing](https://supabase.com/pricing),
[Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing),
[Backups](https://supabase.com/docs/guides/platform/backups). À relire avant de créer le projet : elles peuvent changer.

| Point | Free (0 $) | Pro (à partir de 25 $/mois) |
|---|---|---|
| Projets actifs | **2** par organisation (il n'en faut qu'un : tous les commerces partagent la même base) | pas de plafond affiché |
| Taille de base | **500 Mo** | 8 Go de disque par projet |
| Egress (données sortant de Supabase) | **5 Go** + 5 Go « cached egress » / mois | 250 Go + 250 Go |
| Stockage de fichiers | 1 Go (non utilisé ici) | 100 Go |
| Mise en pause | **après 1 semaine d'inactivité** (« faible activité sur 7 jours ») | **jamais** (« Projects on paid plans aren't paused for inactivity ») |
| Sauvegardes | **aucune** (la doc conseille aux projets gratuits d'exporter eux-mêmes leurs données) | quotidiennes, **7 jours** gardés ; PITR en option payante |
| Journaux | 1 jour | 7 jours |
| Support | communauté | e-mail |
| Inclus | — | 10 $/mois de crédits de calcul (= une instance Micro) |

**Mise en pause (page « Project Pausing »)** : Supabase met en pause un projet gratuit qui montre une faible activité sur
7 jours ; « quelques requêtes par jour à la base sur la semaine écoulée suffisent en général ». Les requêtes du serveur (chaque
client qui scanne, chaque écran commerçant ouvert) comptent comme activité : un restaurant ouvert tous les jours ne devrait pas
être mis en pause ; **le risque, c'est une fermeture d'une semaine ou plus (congés)**. Un e-mail d'avertissement arrive
~1 semaine avant, un autre à la mise en pause. Pendant la pause, la base ne répond plus : le serveur renvoie des erreurs et
l'app affiche « Serveur injoignable ». Réactivation : dashboard → organisation → projet → **Resume project** → confirmer ; le
projet « revient à son état précédent, données et configuration comprises ». Durée de la réactivation : **non indiquée par la
doc** (compter quelques minutes, non garanti). Délai pour réactiver : **1 an** après la pause d'après la page actuelle —
⚠️ un changelog Supabase de 2024 parlait de **90 jours** ; la page actuelle fait foi, mais ne pas laisser traîner.

**Écarts avec S1** : S1 n'avait écrit **aucun chiffre** sur le gratuit (rien à contredire) ; en revanche les emplacements des
clés notés en S1 étaient périmés (voir « Variables » ci-dessus), et le délai de restauration trouvé (1 an) diffère de l'ancien
chiffre de 90 jours qu'on trouve encore en ligne.

**Egress — point à surveiller (estimation, pas une mesure).** Le front en mode API recharge **tout l'état** du commerce
toutes les 10 s tant qu'un écran commerçant est visible (`INTERVALLE_RECHARGEMENT_MS`, `src/store.tsx`), et le serveur relit
alors clients, tirages et avis dans Supabase. Tailles mesurées sur le seed : ~430 octets par client, ~210 par tirage, ~265 par
avis. Avec 100 clients et 100 tirages, ~65 Ko par rechargement ; une tablette ouverte 12 h/jour = ~4 300 rechargements/jour
≈ 280 Mo/jour ≈ **8 Go/mois avant compression** — au-dessus des 5 Go. Le `fetch` de Node demande des réponses compressées
(gzip) ; si l'API Supabase compresse et facture les octets compressés, le volume serait plusieurs fois plus faible —
**non vérifié** (les pages lues ne le disent pas). Au lancement (0 client) c'est négligeable. **À faire** : regarder l'usage d'egress dans
le dashboard Supabase (page Usage) après 1 à 2 semaines ; s'il approche 5 Go, passer l'intervalle à 30 ou 60 s (une
constante) ou fermer l'écran commerçant quand il ne sert pas.

**Taille de base** : quelques centaines d'octets par client, tirage ou avis → 500 Mo représentent des centaines de milliers
d'enregistrements ; pas un sujet pour un restaurant.

### Validation de la migration (S2) — exécutée sur Postgres local, PAS sur Supabase

Pas de Postgres installé dans l'environnement de développement (ni `psql`, ni `postgres`, ni `pg_ctl`). Solution trouvée :
**PGlite** (`@electric-sql/pglite` 0.5.15, dépendance de **dev** uniquement), le vrai moteur Postgres (**PostgreSQL 18.6**)
compilé en WebAssembly, lancé en mémoire par `npm test` (`tests/migration-pglite.test.ts`, 9 tests). Vérifié :
- `0001` puis `0002` s'exécutent sans erreur, et **une 2e fois** sans erreur (rejouables) ;
- les 5 tables existent, RLS activée sur chacune, aucune policy ; `anon` / `authenticated` n'ont aucun droit (requête →
  « permission denied ») ; `service_role` lit ;
- l'**index « 1 tirage par jour à Paris »** est accepté par Postgres (l'hypothèse ouverte en S1 est levée) et fonctionne :
  2e tirage à 23 h 30 heure de Paris refusé (23505), tirage à 0 h 30 le lendemain accepté, heure d'été comprise ;
- anti-doublon `(commerce, contact)`, contraintes `id = donnees.id`, clés étrangères, cascade à la suppression d'un
  commerce, trigger `version` (+1) et UPDATE conditionné à une version périmée → 0 ligne, upsert de `meta`.

**Pas vérifié** : l'exécution sur le vrai projet Supabase (version de Postgres du projet possiblement différente — pas de
fonction propre à la v18 dans la migration —, rôles et droits par défaut créés par Supabase et non par le test, passage par
PostgREST). À confirmer à l'étape b de la procédure ci-dessous.

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
| `GET /sante` | public | `{ ok, version, mode, stockage, demo, integrations }` — `integrations` (V3) : `{ googleWallet, appleWallet: 'en_suspens', googleBusinessProfile, sms, email }`, chacun `false` tant que rien n'est configuré. |
| `GET /commerces` | public | Fiches publiques (jamais de PIN ni de hash). |
| `GET /commerces/:id` | public | Une fiche publique. |
| `GET /cartes/:clientId` | public | **Ajout V2** (page `#/carte/:clientId` et état de la roue) : `{ client (sans téléphone ni e-mail), commerce (fiche publique), jeu: { statut: 'pret' \| 'sansVisite' \| 'dejaJoue', lotDuJour } }`. Jamais de code gagnant. 404 inconnue, 409 commerce inactif. |
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
| `GET /commerces/:id/clients/:clientId/pass.json` | commerçant | **V3, à brancher.** **501** tant que `GOOGLE_WALLET_ISSUER_ID` + `GOOGLE_WALLET_SERVICE_ACCOUNT_FILE` sont absents (cas actuel). Configuré : `{ avertissement, payload }`, charge utile **non signée** d'un Generic pass (prénom, tampons x/seuil, récompense, QR vers `#/carte/:clientId`) — pas un pass utilisable. |
| `POST /commerces/:id/clients/:clientId/relance` | commerçant | **V3, à brancher.** `{ canal: 'sms' \| 'email', message? }`. **501** sans prestataire (cas actuel), rien n'est envoyé. Configuré : 409 si le client n'a pas `consentementRelance: true` (aucun écran ne le recueille encore) ou n'a pas le contact demandé ; sinon envoi du message de relance + mention de désinscription. |

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
- Limite honnête : un PIN de 4 à 6 chiffres haché en SHA-256 se retrouve en quelques secondes **si la base fuit** (fichier
  SQLite, ou table `commerces` / clé secrète Supabase). La protection repose sur le fait que la base n'est accessible qu'au
  serveur (RLS + clé secrète uniquement chez Render), et en ligne sur l'anti-bruteforce.
- Le tirage est entièrement décidé par le serveur : le navigateur n'envoie qu'un contact, jamais un lot.
- HTTPS : fourni par l'hébergeur (Render le fait d'office). Ne pas exposer le serveur en HTTP simple sur Internet (les PIN passent dans les en-têtes).

## Mise en production : Supabase (base) + Render Free (serveur) — aucun déploiement n'a été fait

**Pourquoi deux services.** Supabase héberge la **base** (Postgres), pas le serveur Node `server/` (routes, PIN, tirage).
Il faut donc aussi un hébergeur pour `server/`. Retenu : **Render « Free Web Service »** (0 €). Depuis que les données sont
chez Supabase, le gros défaut de Render Free (disque effacé à chaque mise en veille) **ne fait plus rien perdre** : le serveur
ne garde rien sur son disque. Il reste un effet visible : la mise en veille.

**Render Free** (doc officielle [render.com/docs/free](https://render.com/docs/free), lue le 09/11/2026) :
- mise en **veille après 15 min sans trafic entrant** ; réveil « about one minute » à la requête suivante (le navigateur
  affiche une page d'attente) → le **premier client du service peut attendre ~1 min** ; les suivants, non ;
- **750 h** d'instance gratuites par mois et par espace de travail (un service allumé en permanence = 744 h max : ça
  tient pour UN service) ; au-delà, les services gratuits sont suspendus jusqu'au mois suivant ;
- disque éphémère (sans importance ici), une seule instance, ports SMTP sortants bloqués (sans importance : Brevo passe par
  HTTPS) ; Render peut suspendre un service gratuit au trafic sortant anormalement élevé.
- Régions Render ([render.com/docs/regions](https://render.com/docs/regions)) : Oregon, Ohio, Virginia, **Frankfurt**,
  Singapore ; **la région ne peut pas être changée après création**. La page ne dit pas si l'offre Free existe dans toutes
  les régions → à constater au moment de créer le service.

**Région** : **Frankfurt** pour Render (seule région UE) et **Central EU (Frankfurt) — `eu-central-1`** pour Supabase.
Chaque requête de l'app fait plusieurs allers-retours serveur → base les uns après les autres : les mettre dans la **même
ville** compte plus que la distance au client. Paris (`eu-west-3`) serait aussi dans l'UE, mais ajouterait un trajet
Frankfurt ↔ Paris à chaque aller-retour. Éviter le choix générique « Europe » (il peut tomber à Londres ou Zurich, hors UE,
dit la doc [Regions](https://supabase.com/docs/guides/platform/regions)) : choisir la région précise.

**Autres options, en une phrase** : Render Starter (7 $/mois) supprime la veille de 15 min si le délai du matin gêne ;
Render Starter + disque 1 Go (≈ 7,25 $/mois, `DB_FILE=/var/data/fidelite.db`, sans les variables Supabase) reste possible
si Supabase ne convenait pas ; les hébergeurs « serverless » (Vercel, Netlify…) obligeraient à réécrire le serveur en
fonctions — écartés.

### Procédure pas à pas (à faire par vous ; tout est faisable depuis un ordinateur, la plupart depuis un téléphone)

Les libellés de boutons Supabase (étapes a à c) viennent de la doc lue le 09/11/2026, pas d'un écran réel : **à confirmer à
l'écran**. Ceux de Render (étape d) ont été relus le 09/11/2026 dans [Blueprint spec](https://render.com/docs/blueprint-spec)
et [Infrastructure as Code](https://render.com/docs/infrastructure-as-code). Ceux de l'app (étape e) sont vérifiés dans le code.

**a. Créer le projet Supabase**
1. supabase.com → **Start your project** / **Sign up** : adresse e-mail + mot de passe (ou connexion GitHub). Une
   organisation est créée (plan **Free**).
2. **New project** :
   - *Name* : `asian-home-fidelite` ;
   - *Database Password* : bouton « Generate a password », **à noter dans un gestionnaire de mots de passe**. C'est le mot
     de passe de la base Postgres, **différent des clés API** ; l'app ne s'en sert pas (utile seulement pour un `pg_dump`) ;
   - *Region* : **Central EU (Frankfurt)** (voir « Région » ci-dessus) ;
   - plan / instance : **Free** — ne rien activer de payant.
   → **Create new project**.

**b. Créer les tables** (attendre que le projet soit prêt, quelques minutes)
1. Menu de gauche → **SQL Editor** → **New query**.
2. Copier **tout** le contenu de `supabase/migrations/0001_schema_initial.sql` → **Run** → « Success. No rows returned ».
3. Nouvelle requête, même chose avec `supabase/migrations/0002_rls.sql` → **Run**. **Dans cet ordre** (0002 modifie les
   tables créées par 0001). Les deux fichiers sont rejouables : une erreur → corriger et relancer sans risque.
4. Vérifier, dans une nouvelle requête :
   ```sql
   select relname as table_, relrowsecurity as rls
   from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1;
   ```
   Attendu : **5 lignes** `avis`, `clients`, `commerces`, `meta`, `tirages`, toutes avec `rls = true`. Le **Table Editor**
   doit aussi afficher les 5 tables (sans badge d'avertissement « RLS disabled »). Si Supabase propose d'ajouter des
   policies : **ne pas en ajouter** (c'est voulu, voir `0002_rls.sql`).

**c. Récupérer les 2 variables** (libellés d'après la doc du 09/11/2026 — **à confirmer à l'écran**)
- `SUPABASE_URL` : bouton **Connect** en haut du projet → *Project URL* (`https://<ref>.supabase.co`).
- `SUPABASE_SERVICE_ROLE_KEY` : **Settings → API Keys** → section des clés **secrètes** → clé `sb_secret_…` (créer une clé
  secrète si aucune n'existe ; « Reveal » / copier). Si seule l'ancienne clé `service_role` est proposée, elle marche aussi.
- **Ne jamais** prendre la clé *publishable* / `anon` (elle n'ouvre rien ici), ne jamais coller la clé secrète ailleurs que
  dans Render (ni e-mail, ni message, ni fichier du dépôt).

**d. Mettre le serveur en ligne sur Render**
1. Mettre le code sur un **dépôt GitHub privé** : github.com → **New repository** → *Private* → puis, depuis le dossier du
   projet, `git remote add origin …` et `git push -u origin master` (à faire par vous ; rien n'a été poussé).
   Vérifier que `.env` n'est **pas** dans le dépôt (il est dans `.gitignore`).
   `render.yaml` (racine du dépôt) doit faire partie du push : c'est lui qui décrit le service.
2. render.com → **Sign up** (connexion avec GitHub, pour que Render voie le dépôt privé).
3. **Blueprint** (recommandé, phase S3) : dashboard Render → **New** → **Blueprint** → dans la liste des dépôts, **Connect**
   sur le dépôt (autoriser l'accès au dépôt privé si Render le demande) → *Blueprint Name* : `asian-home-fidelite` ;
   *Branch* : `master` (celle que vous avez poussée) ; *Blueprint Path* : laisser vide (`render.yaml` est à la racine).
   Render lit `render.yaml` et affiche ce qu'il va créer : **1 service web** `asian-home-fidelite`, Node, **Free**,
   **Frankfurt**, build `npm ci && npm run build:api` (front en mode API, servi à la même adresse que l'API), start
   `npm run serveur`, contrôle de santé `/api/v1/sante`, `NODE_VERSION=24`. Si le fichier contient une erreur, la page
   l'affiche à la place (il est validé par `npm test`, donc ça ne devrait pas arriver).
4. Render demande alors les **4 secrets** (`sync: false` dans `render.yaml` ; ils ne sont **jamais** dans le dépôt) :
   - `SUPABASE_URL` = l'URL de l'étape c (`https://<ref>.supabase.co`)
   - `SUPABASE_SERVICE_ROLE_KEY` = la clé secrète de l'étape c (`sb_secret_…`)
   - `ADMIN_PIN` = un PIN de **8 à 12 chiffres**, pas tous identiques, choisi par vous (gardez-le pour vous)
   - `PIN_ASIAN_HOME` = le PIN **4 à 6 chiffres** que vous donnerez au restaurant (lu au **premier** démarrage seulement ;
     ensuite on le change dans l'app)
   Puis **Deploy Blueprint** (libellé de la doc Render du 09/11/2026 ; le brief disait « Apply » — prendre le bouton de
   validation affiché). Rien d'autre à saisir : `PORT`, `RENDER` et `NODE_ENV=production` (au démarrage seulement, pas au
   build — donc `npm ci` installe bien TypeScript et Vite) sont posés par Render ; `TZ`, `TRUST_PROXY` et le mode production
   sont réglés par le serveur. **Ne pas** ajouter `DEMO` ni `DB_FILE`.
   ⚠️ Render ne demande ces secrets **qu'à la création** du Blueprint. Pour en corriger un plus tard : service →
   **Environment** → modifier → enregistrer (Render redéploie ; sinon **Manual Deploy**). Si Render réclame une carte
   bancaire ou propose un plan payant : **ne pas valider** — vérifier que le plan affiché est bien *Free* (à confirmer à l'écran).
   *Sans Blueprint* (secours) : **New** → **Web Service** → même dépôt → Language **Node**, Branch `master`, Region
   **Frankfurt**, les mêmes Build / Start Commands, Instance Type **Free**, et les 5 variables (`NODE_VERSION=24` + les 4
   secrets) dans *Environment Variables* → **Create Web Service**.
5. Attendre « Live » (premier build : quelques minutes). Journaux attendus : « mode production · base Supabase
   <ref>.supabase.co » — l'hôte seulement, jamais la clé. Le serveur refuse de démarrer (et le déploiement échoue au
   contrôle de santé) si `ADMIN_PIN` est trop court, si une seule des 2 variables Supabase est saisie, ou si
   `PIN_ASIAN_HOME` manque alors que la base est neuve : le message est dans les journaux.
6. Ouvrir `https://<nom>.onrender.com/api/v1/sante` → attendu : `"stockage":"supabase"`, `"mode":"production"`,
   `"demo":false`. Si `"sqlite"` : une variable manque ou est mal nommée. Si le service refuse de démarrer : lire les
   journaux (variable Supabase seule, PIN admin trop court…).
7. Dans Supabase → Table Editor → `commerces` : **1 ligne** `c-asian-home-paris` ; `clients`, `tirages`, `avis` vides ;
   `meta` : 1 ligne `initialise`. C'est ce que fait le code (`initialiser`, `server/app.ts`) sur une base neuve : seul le
   1er commerce du seed (Asian Home Paris : coordonnées, lien d'avis direct, lots), `demo: false`, PIN haché, **sans** les
   clients / avis / tirages fictifs ; les commerces de démo seulement avec `DEMO=1` — vérifié par le test « S3 : base
   Supabase neuve en production » (`tests/supabase.test.ts`).

**e. Refaire le parcours de base contre le vrai projet** (sur un commerce de test, pour ne pas salir Asian Home)
1. `https://<nom>.onrender.com/` (1re ouverture : jusqu'à ~1 min, réveil Render) → onglet **Admin (tous)** → PIN admin →
   **Déverrouiller** → Plus → Admin → **+ Ajouter un commerce** « Test S2 » (PIN `4321`) → **Créer** (le commerce test
   devient le commerce affiché).
2. Clients → **+ Inscrire un client** (votre prénom + votre numéro) ; réinscrire le même numéro au format `+33 6…` →
   le même client est retrouvé (pas de doublon).
3. Roulette → **Copier le lien de la page de jeu** (ou scanner le QR) et l'ouvrir **sur votre téléphone**, entrer le même
   numéro → « Pour jouer, validez d'abord votre visite du jour au comptoir. »
4. Sur l'écran commerçant : Clients → **Valider une visite (+1)** → la roue du téléphone se débloque (≤ 10 s) → tourner → un lot et
   un **code** ; le même code apparaît côté commerçant (Tableau de bord / Roulette).
5. Retourner sur la page de jeu → **2e tirage refusé** (« déjà tourné la roue »).
6. Clients → **Exporter (CSV)** → le fichier s'ouvre dans Excel avec les accents corrects.
7. Contrôle côté base : Supabase → Table Editor → `clients` et `tirages` contiennent bien les lignes du commerce test.
8. Nettoyage : SQL Editor → `delete from public.commerces where donnees ->> 'nom' = 'Test S2';` (clients, tirages et avis
   du commerce test partent avec, par cascade — vérifié sur Postgres local). **Ne jamais** lancer cette commande avec un
   autre nom.

**f. Mise en pause du projet gratuit, et quand passer au Pro**
- Pause après **7 jours de faible activité** (voir « Limites de l'offre gratuite ») : e-mail d'avertissement ~1 semaine avant.
  Avant une fermeture d'une semaine ou plus, ouvrir l'app (ou le dashboard Supabase) tous les 2-3 jours suffit.
- Si le projet est en pause : l'app affiche « Serveur injoignable ». Dashboard Supabase → organisation → projet →
  **Resume project** → confirmer ; attendre la fin (durée non précisée par la doc) ; l'app refonctionne sans rien changer
  chez Render (même URL, mêmes clés). Délai maximal pour réactiver : 1 an (page actuelle).
- **Passer au Pro (à partir de 25 $/mois, page pricing du 09/11/2026)** quand : le restaurant ne doit **jamais** tomber pour
  inactivité, on veut des **sauvegardes quotidiennes** (7 jours gardés — le gratuit n'en a **aucune**), ou l'usage approche
  500 Mo de base / 5 Go d'egress (page Usage du dashboard). Le Pro enlève la mise en pause, ajoute les sauvegardes,
  8 Go de disque, 250 Go d'egress, support e-mail, 10 $ de crédits de calcul inclus. **Dépense à valider par vous.**
- Sans Pro, sauvegarde = **export CSV régulier** (Clients → Exporter), et pour une sauvegarde complète
  `pg_dump` ou `supabase db dump` (CLI Supabase) avec le mot de passe de base de l'étape a.

**g. Données SQLite existantes**
- **Rien à migrer pour le vrai restaurant** : Asian Home Paris n'a jamais été en production ; sa base réelle est vide
  (0 client, 0 avis, 0 tirage) et le serveur la recrée tout seul sur Supabase au premier démarrage (étape d.7).
- La base de dev locale `data/fidelite.db` ne contient que des essais (commerces « Preuve V2 / V3 », données fictives) :
  **ne pas la reprendre**.
- S'il fallait un jour reprendre une vraie base SQLite : **il n'existe pas d'outil d'import automatique** dans ce projet.
  Deux voies : (1) exporter le CSV des clients de chaque commerce et réinscrire les clients (perd l'historique : tampons,
  visites, tirages) ; (2) écrire un petit script qui ouvre `fidelite.db` avec `ouvrirStockage` (SQLite) et réécrit chaque
  commerce / client / tirage / avis avec `ouvrirStockageSupabase` — même contrat `Stockage`, mêmes objets ; les PIN se
  recopient tels quels (hash + sel). Script **non écrit** : à faire et à tester sur un projet Supabase vide avant usage.

### Sauvegarde / export

- `GET /api/v1/commerces/:id/export.csv` (PIN) : liste des clients, à télécharger régulièrement (ouvrable dans Excel).
- Supabase Free : **aucune sauvegarde automatique** → CSV régulier + `pg_dump` / `supabase db dump` si besoin (voir f).
- SQLite (dev / Render Starter + disque) : copier le fichier `data/fidelite.db` serveur arrêté (ou
  `sqlite3 fidelite.db ".backup copie.db"`).
- Pas encore de route de sauvegarde complète ni d'import (tirages, avis, historique) : voir « Limites ».

## Limites honnêtes

- SQLite : 1 seule instance (fichier local). Sous Supabase, plusieurs instances partagent la base, mais l'anti-bruteforce
  reste en mémoire par instance.
- Anti-bruteforce et blocages en mémoire : remis à zéro au redémarrage.
- Pas de comptes utilisateurs : un PIN par commerce, partagé par l'équipe ; pas de journal « qui a fait quoi ».
- Le client se reconnaît par son téléphone / e-mail sans vérification (pas de SMS de confirmation) : quelqu'un qui
  connaît le numéro d'un client voit son prénom et ses tampons, et peut jouer à sa place s'il a une visite validée ce jour-là.
- Pas de route d'import, pas de suppression de client (RGPD : à faire à la main dans la base pour l'instant).
- Le code serveur n'est pas vérifié par `tsc` (pas de `@types/node` installé, pour ne rien ajouter) : il est couvert par les tests HTTP.
- Le front en mode API (V2) recharge tout l'état toutes les 10 s : avec le PIN admin, une requête `/etat` par
  commerce. Suffisant pour quelques commerces ; au-delà, prévoir une route agrégée ou un rechargement incrémental.
- `GET /cartes/:clientId` (V2) parcourt les commerces pour trouver le client (pas d'index par identifiant seul) :
  sans importance à cette échelle.

## Intégrations préparées (V3) — rien n'est branché, aucun compte créé

| Fichier | Rôle |
|---|---|
| `server/wallet.ts` | Charge utile Google Wallet « Generic pass » (non signée). |
| `server/notifications/index.ts` | Interface d'envoi (`creerNotifications`) : 501 « à brancher » sans clé. |
| `server/notifications/twilio.ts` | Adaptateur SMS Twilio (API REST Messages). |
| `server/notifications/brevo.ts` | Adaptateur e-mail Brevo (API `v3/smtp/email`). |

Le code des adaptateurs n'a **jamais** été exécuté contre Twilio, Brevo ou Google : il n'est testé qu'avec un `fetch`
simulé (`tests/integrations-v3.test.ts`). Avant la mise en service, un essai réel sera nécessaire.

### Apple Wallet — EN SUSPENS (décision du 09/11/2026), à activer sur décision explicite

Aucun endpoint, aucune signature, aucun code de pass Apple (un test le vérifie). Ce qu'il faudrait le jour où c'est décidé :
- un compte **Apple Developer Program** (99 $/an, au nom de l'éditeur de l'app) ;
- un **Pass Type ID** (`pass.<domaine>.fidelite`) créé dans ce compte ;
- le **certificat de signature** de ce Pass Type ID + sa **clé privée**, et le certificat intermédiaire Apple (WWDR) ;
- un endpoint qui génère et **signe** le pass, et le **service web de mise à jour des passes** (enregistrement des appareils,
  notifications push APNs à chaque tampon) — sans lui, le pass ne se met pas à jour.

### Google Wallet — architecture prête, sans compte

Prérequis exacts (aucun n'existe aujourd'hui) :
1. un **compte émetteur** Google Wallet (console Google Pay & Wallet) → `GOOGLE_WALLET_ISSUER_ID` ;
2. un projet Google Cloud avec l'**API Google Wallet activée** ;
3. un **compte de service** avec sa **clé JSON** (scope `https://www.googleapis.com/auth/wallet_object.issuer` — de mémoire, à vérifier dans la doc Google Wallet), autorisé
   sur le compte émetteur → `GOOGLE_WALLET_SERVICE_ACCOUNT_FILE` ;
4. Google exige l'approbation du compte émetteur avant la publication des passes (mode démo / production — à vérifier dans la console) ;
5. **reste à développer** : signer le JWT « Save to Google Wallet » (`aud: google`, `typ: savetowallet`) avec la clé, créer la
   classe, et mettre l'objet à jour à chaque tampon via l'API.

### Google Business Profile (avis) — à brancher

Aucun appel à Google. Il faudra : le compte Google qui gère la fiche du commerce ; un projet Google Cloud **approuvé** par
Google pour les API Business Profile (formulaire de demande d'accès) ; activer les API (dont *Google My Business API*) ;
un identifiant OAuth 2.0 avec le scope `https://www.googleapis.com/auth/business.manage` (doc Google « Basic setup »,
vérifiée le 09/11/2026) ; le consentement du commerce ; puis lire les avis
(`GET https://mybusiness.googleapis.com/v4/accounts/*/locations/*/reviews`) et publier les réponses — non développé.

### SMS / e-mail — à brancher

Variables : voir le tableau ci-dessus. Garde-fous déjà codés : 501 sans prestataire ; jamais d'envoi sans
`consentementRelance: true` ; mention de désinscription ajoutée à chaque message (« STOP » en SMS, réponse « désinscription »
en e-mail — un vrai lien de désinscription géré par le prestataire reste à prévoir).

## Migration future (écrite avant S1 — Supabase est désormais préparé et la procédure écrite, voir plus haut)

Supabase ou Firebase seraient la voie suivante quand :
- un commerce dépasse **quelques centaines de clients actifs** ou qu'il y a **beaucoup de commerces** (plusieurs instances, sauvegardes gérées) ;
- on a besoin de **temps réel** (le comptoir voit le tirage au moment où il a lieu, sans rechargement) ;
- on veut de vrais **comptes** (e-mail / mot de passe par employé) au lieu d'un PIN.

Migration prévue simple : la forme des données (`src/types.ts`) ne change pas ; il faudrait réécrire `server/stockage.ts`
(ou remplacer le serveur par des fonctions Supabase) en gardant les mêmes routes, et importer les données depuis `fidelite.db`.

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
| `server/wallet.ts` | **V3** : Google Wallet préparé, inactif (voir « Intégrations préparées »). |
| `server/notifications/` | **P1-B3** : relances SMS (Twilio) / e-mail (Brevo) branchées de bout en bout ; aucun envoi sans clés (501). Voir « SMS / e-mail ». |
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
| `SESSION_SECRET` | dev : secret éphémère (avertissement) ; **production : à créer** | **P0-S1.** Secret de signature (HMAC-SHA256) des jetons de session, 32 caractères minimum (ex. `openssl rand -base64 48`). Absente en production : le serveur **démarre quand même** (avertissement dans les journaux), `POST /sessions` répond 503 et le front reste sur le PIN en en-tête. Trop courte en production : refus de démarrer. La changer ferme toutes les sessions ouvertes. |
| `NODE_ENV` | — | `production` active le mode production. Sur Render, la variable `RENDER` (posée par Render) l'active aussi. |
| `DB_FILE` | `data/fidelite.db` | Chemin du fichier SQLite. |
| `DEMO` | `0` | `1` = ajoute aussi les 2 commerces de démo (Atelier Coiff' Camille, Maison Lila) avec leurs données fictives, marqués `demo: true`. |
| `TZ` | `Europe/Paris` | Fuseau utilisé pour « visite du jour » / « 1 tirage par jour ». Forcé à Paris si absent (les hébergeurs sont souvent en UTC). |
| `TRUST_PROXY` | `0` (`1` d'office sur Render) | Lire l'IP du client dans `X-Forwarded-For` (indispensable derrière un équilibreur, sinon l'anti-bruteforce compterait tout le monde comme une seule IP). |
| `CORS_ORIGIN` | `*` (avertissement au démarrage) ; **production : à créer** | **P0-S4.** Origine exacte autorisée à appeler l'API depuis un autre site, ex. `https://asian-home-fidelite.onrender.com` (protocole + hôte [+ port], sans chemin ; un `/` final est toléré). Comparaison stricte : toute autre origine ne reçoit aucun `Access-Control-Allow-Origin` (jamais de reflet), les requêtes sans `Origin` (curl, même origine) passent. Valeur qui n'est pas une origine → refus de démarrer. Absente en production : le serveur **démarre quand même** (avertissement) — le front servi par ce serveur est à la même origine, le CORS ne le concerne pas. Voir « En-têtes HTTP ». |
| `STATIC_DIR` | `dist` | Dossier du front compilé servi sur `/` (s'il contient `index.html`). |
| `PUBLIC_URL` | — (déduit de l'en-tête `Host`) | **V3.** Adresse publique du site (`https://…`), encodée dans le QR des passes Google Wallet, et (P1-B3) dans les liens des SMS / e-mails de relance et l'URL signée du webhook Twilio STOP — à renseigner avant d'activer Twilio. |
| `SUPABASE_URL` | — | **S1.** URL du projet Supabase (`https://<projet>.supabase.co`). Avec la suivante : stockage Supabase au lieu de SQLite. |
| `SUPABASE_SERVICE_ROLE_KEY` | — | **S1. Secret serveur.** Clé service_role / `sb_secret_…`. Voir « Supabase » ci-dessous. |
| `GOOGLE_WALLET_ISSUER_ID` | — | **V3, non configuré.** Identifiant émetteur Google Wallet. |
| `GOOGLE_WALLET_SERVICE_ACCOUNT_FILE` | — | **V3, non configuré.** Chemin du fichier JSON de la clé du compte de service Google. Les deux variables Google Wallet sont nécessaires, sinon `pass.json` répond 501. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | — | **P1-B3, non configuré.** SMS via Twilio (`TWILIO_FROM` = numéro expéditeur `+33…` ou identifiant de Messaging Service `MG…`). Les trois sont nécessaires, sinon 501. |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | — | **P1-B3, non configuré.** E-mail via Brevo (adresse expéditrice à valider chez Brevo ; nom optionnel). Clé + adresse nécessaires, sinon 501. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | — | **P1-B4, non configuré. `GOOGLE_CLIENT_SECRET` = secret serveur.** Identifiants OAuth 2.0 (application Web) du projet Google Cloud approuvé pour les API Business Profile. Les deux sont nécessaires, sinon les routes Google répondent 501. Voir `docs/GOOGLE-BUSINESS.md`. |
| `GOOGLE_REDIRECT_URI` | `PUBLIC_URL` (ou adresse du serveur) + `/api/v1/commerces/<id>/google/callback` | **P1-B4.** URI de redirection déclarée chez Google, à l'identique. |
| `GOOGLE_BUSINESS_LOCATION` | — (fiche trouvée à l'import) | **P1-B4, facultatif.** `accounts/<n°>/locations/<n°>` si le compte gère plusieurs fiches et que l'app ne trouve pas la bonne. |

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
(timestamptz) ; PIN en `pin_hash` + `pin_sel` (scrypt + sel depuis P0-S1, SHA-256 + sel avant ; jamais en clair) ; unique `(commerce_id, cle_contact)` ;
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
404 inconnu, 409 règle métier refusée, 413 corps trop gros, 429 trop de PIN faux ou trop de requêtes publiques
(avec `Retry-After`, voir « Anti-abus »).

| Méthode et chemin | Accès | Effet |
|---|---|---|
| `POST /sessions` | PIN / code dans le corps | **P0-S1.** `{ role: 'commerce', commerceId, pin }`, `{ role: 'admin', pin }` ou `{ role: 'equipe', commerceId, code }` → 201 `{ jeton, role, commerceId?, membreNom?, expireLe }`. Même anti-bruteforce que les en-têtes (401 / 429), re-hachage scrypt au passage. 503 si `SESSION_SECRET` absente. |
| `DELETE /sessions` | `X-Session` | **P0-S1.** Révoque le jeton (« Verrouiller ») → `{ ok: true }` ; idempotent ; 401 si jeton absent ou falsifié. |
| `GET /sante` | public | `{ ok, version, mode, stockage, demo, integrations }` — `integrations` (V3) : `{ googleWallet, appleWallet: 'en_suspens', googleBusinessProfile, sms, email }`, chacun `false` tant que rien n'est configuré. `migrations` : `{ cartiz, programme, relances }` — `relances` = migration 0007 (table `envois`) appliquée. |
| `GET /commerces` | public | Fiches publiques (jamais de PIN ni de hash). |
| `GET /commerces/:id` | public | Une fiche publique. |
| `GET /cartes/:clientId` | public | **Ajout V2** (page `#/carte/:clientId` et état de la roue) : `{ client (sans téléphone ni e-mail), commerce (fiche publique), jeu: { statut: 'pret' \| 'sansVisite' \| 'dejaJoue', lotDuJour, codeDuJour, remisDuJour } }`. P0-U3 : `codeDuJour` = code gagnant du tirage **du jour** de ce client (null si perdant ou pas de tirage), re-servi à son titulaire (autre téléphone, cache vidé) ; aucune autre route publique ne renvoie de code. 404 inconnue, 409 commerce inactif. |
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
| `GET /commerces/:id/clients/:clientId/pass.json` | commerçant | **Google Wallet, à brancher.** **501** tant que `GOOGLE_WALLET_ISSUER_ID` + `GOOGLE_WALLET_SERVICE_ACCOUNT_FILE` sont absents (cas actuel, aucun pass généré). Clé illisible : 503. Configuré : `{ signe: true, urlEnregistrement }` (JWT signé, voir plus bas). |
| `GET /commerces/:id/google` | commerçant | **P1-B4.** `{ configure, connecte, connecteLe?, fiche? }` — jamais de jeton. `configure: false` tant que `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` manquent. |
| `GET /commerces/:id/google/auth` | commerçant | **P1-B4.** 302 vers l'écran de consentement Google (scope `business.manage`, `access_type=offline`, `prompt=consent`, `state` signé à usage unique, 10 min) ; `?format=json` → `{ url }` (utilisé par le front). **501** sans configuration. |
| `GET /commerces/:id/google/callback` | public (retour de Google) | **P1-B4.** Vérifie le `state`, échange le `code` contre les jetons (rangés chiffrés dans `meta`, jamais renvoyés), puis 302 vers `/#/avis/google-connecte` (refus sur Google : `/#/avis/google-refuse`). 400 state absent / falsifié / déjà utilisé / d'un autre commerce. **501** sans configuration. |
| `POST /commerces/:id/google/deconnecter` | commerçant | **P1-B4.** Révocation chez Google (best-effort) + jetons effacés → `{ ok, revoque }`. **501** sans configuration. |
| `POST /commerces/:id/google/import-avis` | commerçant | **P1-B4.** Importe les avis de la fiche (déduplication par identifiant Google ; avis manuels et brouillons préservés ; règles appliquées) et publie d'office la seule réponse auto 5★ des avis postés après la connexion (règle active) → `{ importes, misAJour, ignores, publiees, echecsPublication, avis }`. **501** sans configuration, 409 non connecté / fiche introuvable, 502 refus de Google. Journalisé (action `avisGoogle`). |
| `POST /commerces/:id/avis/:avisId/publier-reponse` | commerçant | **P1-B4.** Publie `reponse` sur Google (`PUT …/reviews/{r}/reply`) → `{ avis }` avec `reponsePublieeLe`. **409** si l'avis est saisi à la main, n'a qu'un brouillon (non validé), ou a une réponse auto hors règle 5★ active : rien n'est envoyé. **501** sans configuration. Journalisé. |
| `GET /cartes/:clientId` (complément) | public | Génère à l'ouverture les messages dus (relance 30 j, anniversaire) si ces règles sont actives ; renvoie aussi `menuDisponible`. Jamais `actionsTraitees` ni `clesMessages`. |
| `POST /cartes/:clientId/lus` | public | Marque les messages de la carte comme lus. |
| `PATCH /commerces/:id` (complément) | commerçant | Aussi : `eurosParPoint` (0,10 à 1 000), `catalogue` (`[{ id?, nom, cout, description? }]`, 30 max), `messagesAuto` (`{ bienvenue, recompense, presque, inactif, anniversaire, avis }`), `apparence` (`{ couleur?, fond?, banniere? }`, refus si contraste < 4,5:1 ou bannière non https). |
| `GET /commerces/:id/caisse` | code équipe ou commerçant | `X-Equipe-Code: <4 chiffres>` → `{ auteur, commerce, clients }` (401 si code faux, compte dans l'anti-bruteforce). |
| `POST /commerces/:id/caisse/passage` | code équipe ou commerçant | `{ clientId, actionId, faitLe?, montantCentimes? }` → 1 tampon + points ; **409 si déjà un passage ce jour-là** ; `actionId` déjà reçu → `dejaTraite: true`, rien n'est recompté ; `faitLe` accepté s'il date de < 72 h (file hors ligne). Journalisé. |
| `POST /commerces/:id/caisse/recompense` | idem | `{ clientId, actionId, faitLe? }` → récompense tampons (409 avant le seuil). Journalisé. |
| `POST /commerces/:id/caisse/echange` | idem | `{ clientId, recompenseId, actionId, faitLe? }` → échange de points (409 solde insuffisant), tracé `{ soldeAvant, soldeApres, auteur }`, idempotent. Journalisé. |
| `GET /commerces/:id/caisse/gains/:code` | idem (code équipe, session équipe ou commerçant) | **P0-U3.** Code gagnant de la roue (6 car., casse / espaces / tirets ignorés) → `{ gain: { code, lot, date, statut: 'valable' \| 'remis' \| 'perdant' \| 'expire', client: { id, prenom } \| null, remis: { le, par } \| null } }`. Jamais le contact du client. 400 format, 404 code inconnu. Lecture seule. |
| `POST /commerces/:id/caisse/gains/:code/remise` | idem | **P0-U3.** Marque le gain « remis » (`tirages.donnees.remis = { le, par: auteur }`) → `{ gain }`. **409 déjà remis** (avec date et auteur de la remise) **ou tirage perdant**, **410 expiré** (tirage d'un autre jour), 404 inconnu. Un code = une remise, garanti par un UPDATE conditionnel (`… AND donnees->remis IS NULL`) : deux caisses simultanées → 200 + 409. Journalisé (action `gain`). Sans migration. |
| `POST /commerces/:id/clients/:clientId/visite` / `recompense` (complément) | commerçant **ou code équipe** | Inchangés côté règles ; désormais journalisés (auteur « Gérant » ou membre). La règle « 1 tampon par jour » n'est appliquée que par la route caisse (comportement historique conservé ici). |
| `PATCH /commerces/:id/clients/:clientId` | commerçant | `{ anniversaire?: "MM-JJ" \| "", platPrefere?, consentementRelance?: boolean }`. **P1-B3** : `consentementRelance` pose / retire le consentement aux relances (bouton de la fiche client), avec `consentementRelanceLe` + `consentementRelanceOrigine: 'commercant'`, journalisé (action `consentement`). |
| `GET` / `POST /commerces/:id/equipe`, `PATCH` / `DELETE /commerces/:id/equipe/:membreId` | commerçant | Membres `{ nom, code }` ; code de 4 chiffres, unique dans l'équipe (409), stocké haché + salé, **jamais renvoyé ni journalisé**. |
| `GET /commerces/:id/messages` | commerçant | 100 derniers messages (auto + ciblés) avec prénom et contact, pour copier le texte. |
| `POST /commerces/:id/messages` | commerçant | `{ cible: 'tous' \| 'inactifs' \| 'proches' \| 'nouveaux', texte }` → déposé dans l'espace client des clients ciblés. **Aucun SMS / e-mail.** |
| `GET /commerces/:id/menu` | public | `{ menu, commerce }` (menu vide si jamais enregistré ; 409 si commerce inactif). |
| `PUT /commerces/:id/menu` | commerçant | `{ categories: [{ nom, produits: [{ nom, prix (centimes), description?, photo? (https ou JPEG/PNG/WebP ≤ 60 Ko), allergenes[] }] }] }` (20 catégories / 60 produits max, corps ≤ 3 Mo). |
| `GET /commerces/:id/etat` (complément) | commerçant | Aussi `membres` (sans code) et `journal` (200 dernières actions). Les clients n'y ont plus leur boîte de réception (egress). |
| `POST /commerces/:id/clients` (complément P1-B3) | public ou commerçant | `consentementRelance: true` seulement si la case « offres par SMS ou e-mail » (jamais pré-cochée, page de jeu et inscription en caisse) est cochée ; absent = pas de consentement. Ignoré pour un client **déjà inscrit** (personne ne peut réabonner un numéro après un STOP en se ré-identifiant). |
| `POST /commerces/:id/clients/:clientId/relance` | commerçant | **P1-B3.** `{ modele?: 'bienvenue' \| 'proche' \| 'inactif' \| 'anniversaire', canal?: 'sms' \| 'email', message? }` (modèle **ou** message libre ; canal par défaut : téléphone → SMS, sinon e-mail). **501** sans prestataire pour ce canal (cas actuel : rien n'est envoyé) ; **409** sans consentement, sans contact pour ce canal, ou même modèle déjà envoyé à ce client aujourd'hui (Paris) ; **503** migration 0007 absente (pas d'envoi sans anti-doublon) ; **502** prestataire en erreur ; 200 `{ envoye, canal, modele, envoi }`. Chaque tentative, même refusée, est journalisée dans `envois`. |
| `GET /commerces/:id/envois` | commerçant | **P1-B3.** Journal des relances (200 dernières, `?client=<id>` pour un client) → `{ envois: [{ clientPrenom, date, modele, canal, statut, declencheur, auteur, raison? }], migration }`. Aussi dans `GET …/etat` (`envois`). Jamais le téléphone, l'e-mail ni le texte. |
| `POST /commerces/:id/stop-sms` | public (signature Twilio) | **P1-B3.** Webhook Twilio « A message comes in » : `Body` = STOP / ARRET / DESINSCRIPTION… (casse et accents ignorés, 1er mot) → consentement du client de ce numéro (`From`) retiré, journalisé ; autre mot : rien. **501** sans Twilio configuré, **403** si `X-Twilio-Signature` est fausse. Répond un TwiML vide. |
| `POST /desinscription/:clientId/:jeton` | public (jeton HMAC) | **P1-B3.** Lien de désinscription des e-mails (page `#/desinscription/<clientId>/<jeton>`, bouton « Me désinscrire ») et One-Click `List-Unsubscribe-Post`. Jeton = HMAC du commerce + client (secret tiré une fois, gardé dans `meta`). Idempotent → `{ ok, commerce }` ; 404 lien invalide. |
| `GET /c/:clientId` (hors `/api`) | public | **P1-B3.** Lien court des SMS → 302 vers `/#/carte/<clientId>`. |
| `PATCH /commerces/:id` (complément P1-B3) | commerçant | `relancesAuto: { inactif, anniversaire }` (désactivées par défaut ; case dans l'écran Messages). Tournée lancée en arrière-plan à l'ouverture du tableau de bord (`GET …/etat`), une fois par commerce et par jour : clients consentants seulement, une relance auto par client et par tournée, une fois par absence (inactif 30-120 j) / par an (anniversaire). Rien sans prestataire ni migration 0007. |

Accès « commerçant » = en-tête `X-Session` (jeton `commerce` de ce commerce ou `admin`), **ou** en repli `X-Commerce-PIN`
du commerce, **ou** `X-Admin-PIN` (l'admin ouvre tous les commerces).
Accès « code équipe » = `X-Session` (jeton `equipe` de ce commerce) **ou** en repli `X-Equipe-Code` (4 chiffres d'un membre).
`X-Session`, s'il est présent, décide seul : jeton falsifié / expiré / révoqué → 401 ; valide mais hors de sa portée (autre
commerce, session équipe sur une route gérant, session commerce sur une route admin) → 403. Le PIN en en-tête reste
accepté pour la compatibilité (à déprécier quand tous les clients auront basculé).

### Jetons de session (P0-S1)

- Forme : `v1.<base64url(JSON)>.<base64url(HMAC-SHA256(SESSION_SECRET, <base64url(JSON)>))>`, contenu
  `{ jti (uuid), role, commerceId?, membreId?, nom?, exp (secondes unix) }`. Signé, **pas chiffré** : rien de secret dedans
  (ni PIN ni code). Vérification de la signature à temps constant, puis expiration, puis révocation.
- Durées : gérant et admin 8 h, équipe (caisse) 12 h. Pas de renouvellement : à l'expiration, le front redemande le PIN / code.
- Révocation : `DELETE /sessions` → mémoire du processus + table `sessions_revoquees` (migration 0005 : `jti`, `expire_le`) ;
  les révocations expirées sont supprimées au passage. Sans la table (0005 pas appliquée) : révocation en mémoire
  seulement (perdue au redémarrage — le jeton expire de toute façon), aucune erreur. Un « non révoqué » lu en base est
  gardé 5 min en mémoire (Render = 1 instance, et toute révocation passe d'abord par la mémoire).
- Membre retiré de l'équipe → sa session tombe aussitôt (le membre est relu à chaque requête). Limite : changer un PIN
  ou un code ne ferme **pas** les sessions déjà ouvertes (elles expirent en 8 h / 12 h ; « Verrouiller » les ferme).
- Front : le PIN / code n'est envoyé qu'à `POST /sessions` ; le jeton est gardé dans le coffre chiffré de l'onglet
  (`src/data/coffrePin.ts`). 503 / ancien serveur / réseau → repli transparent sur le PIN en en-tête, comme avant.

### Migration 0005 (révocation des sessions) — à appliquer en production

Facultative pour que tout marche (le serveur tolère son absence), nécessaire pour que « Verrouiller » survive à un
redémarrage du serveur. Supabase → **SQL Editor** → coller `supabase/migrations/0005_sessions_revoquees.sql` → **Run**
(rejouable). Vérifier : `select relname, relrowsecurity from pg_class where relname = 'sessions_revoquees';` → 1 ligne,
`true`. Annulation : `0005_sessions_revoquees.down.sql` (supprime la table ; sans effet sur les données métier).

### Migration 0003 (modules caisse / points / équipe / messages / menu) — à appliquer en production

La base Supabase en ligne ne se met pas à jour toute seule. Tant que `0003_cartiz.sql` n'est pas exécutée, les nouvelles
routes qui touchent `equipe`, `journal` ou `menus` répondent 500 (table absente) — **et les routes historiques qui écrivent
désormais dans le journal (visite, récompense, caisse) aussi**. À faire une fois, dans l'ordre :
1. supabase.com → projet **asian-home-fidelite** → **SQL Editor** → *New query* ;
2. coller tout le contenu de `supabase/migrations/0003_cartiz.sql` → **Run** (rejouable : sans risque si exécuté deux fois) ;
3. vérifier : `select relname, relrowsecurity from pg_class where relname in ('equipe','journal','menus');` → 3 lignes, `true` ;
4. aucune redéploiement Render nécessaire (le code est déjà en ligne) ; tester `#/equipe` puis la caisse.

Exemple :

```bash
curl -s -X POST localhost:3001/api/v1/commerces -H 'X-Admin-PIN: 000000' -H 'Content-Type: application/json' \
  -d '{"nom":"Chez Lin","type":"restaurant","pin":"4321"}'
curl -s -X POST localhost:3001/api/v1/commerces/c-asian-home-paris/tirages -H 'Content-Type: application/json' \
  -d '{"contact":"06 12 34 56 78"}'          # → 409 tant que la visite du jour n'est pas validée
```

## Sécurité (minimale, assumée)

- PIN commerçant (4 à 6 chiffres), PIN admin et codes équipe : hachés en **scrypt** (`node:crypto`, aucune dépendance) —
  sel aléatoire 16 octets, N = 16384, r = 8, p = 1, clé de 64 octets, maxmem 64 Mo (≈ 46 ms par vérification) ; jamais en
  clair, jamais renvoyés ; comparaison à temps constant. Le PIN admin (variable d'environnement) est haché en mémoire au démarrage.
- **Format du hash, sans colonne en plus** (P0-S1) : le format est encodé dans la valeur de `pin_hash` / `code_hash`
  elle-même, pour éviter une migration de schéma. `scrypt$v1$<128 hex>` = scrypt (format actuel) ; 64 caractères hexadécimaux
  nus = ancien SHA-256(`<sel>:<PIN>`) à 1 itération. Les deux sont acceptés (`pinCorrect`, `server/app.ts`) ; un hash
  ancien format est **re-haché en scrypt au premier accès réussi** (en-tête ou `POST /sessions`) et réécrit en base, au
  mieux : un échec d'écriture est journalisé et ne fait jamais échouer l'accès (réessayé au suivant). Un PIN jamais
  utilisé reste en SHA-256 jusqu'à son prochain usage. `v1` permettra de changer les paramètres plus tard sans ambiguïté.
- **Sessions** : le PIN n'est plus envoyé à chaque requête par le front, seulement échangé une fois contre un jeton
  court (voir « Jetons de session » plus haut).
- **Anti-bruteforce des PIN / codes** (P0-S2, persistant) : voir « Anti-abus » juste après.
- **Routes publiques limitées** (P0-S2) : voir « Anti-abus » juste après.

### Anti-abus (P0-S2, audit F-04 / F-06)

**PIN et codes faux** — chaque échec (PIN admin, PIN commerce, code équipe ; en-têtes et `POST /sessions` confondus)
compte sur deux compteurs, rangés dans la table `tentatives_auth` (migration 0006) :

| Compteur | Seuil | Effet |
|---|---|---|
| `ip:<ip>` (tous secrets confondus) | 10 échecs sans pause de 10 min | cette IP : 429 + `Retry-After` sur tout PIN / code, même bon |
| `cible:<commerceId>` / `cible:admin` (toutes IP) | 50 échecs sans pause de 10 min | plus aucun PIN / code accepté pour ce commerce (ou l'admin), d'où qu'il vienne |

- Blocage de 10 min, **doublé à chaque nouvelle série** sans pause (20, 40 min…), plafonné à 24 h. Un accès réussi remet
  à zéro le compteur de l'IP, pas celui de la cible (une attaque distribuée en cours reste comptée).
- **Persistant** : la base fait foi, le blocage survit à un redémarrage ou un réveil Render. Le serveur garde un cache
  en mémoire devant (1 instance). Les lignes inactives depuis 7 jours sont supprimées au passage.
- Pourquoi un compteur par cible : 10 essais / IP ne suffisent pas contre un PIN à 4 chiffres attaqué depuis beaucoup
  d'IP. Avec 50 essais puis 10, 20, 40 min… de blocage, le nombre d'essais par jour reste très faible. **Contrepartie
  assumée** : un attaquant peut empêcher un commerce d'ouvrir une *nouvelle* session pendant le blocage ; les sessions
  déjà ouvertes (tablette, caisse) continuent de marcher.
- **Journal** : la table (clé, type de secret visé, nombre d'échecs, fin de blocage, dernier échec) et les logs Render :
  `[securite] échec <portée> : ip:… n/10, cible:… n/50` à chaque échec, `[securite] BLOCAGE …` à chaque blocage. **Jamais
  de PIN, de code ni de contact.** L'IP est journalisée (nécessaire pour l'enquête) ; elle disparaît de la table après 7 jours.
- Table absente (0006 pas appliquée sous Supabase) ou base indisponible : comptage **en mémoire** (comme avant P0-S2, perdu
  au redémarrage), un avertissement dans les logs, jamais de 500.

**Routes publiques** — compteurs en mémoire par fenêtre fixe d'une minute (perdus au redémarrage, sans gravité à cette
échelle) ; au-delà : 429 + `Retry-After` (secondes). Seuils dans `LIMITES_PUBLIQUES` (`server/app.ts`) :

| Seuil | Valeur / min | Routes | Pourquoi cette valeur |
|---|---|---|---|
| `lectureParIp` | 120 | `GET /cartes/:id`, `POST /cartes/:id/lus`, `GET /commerces`, `GET /commerces/:id`, `GET /commerces/:id/menu` | plusieurs clients sur le wifi du restaurant (même IP), pages qui se rafraîchissent |
| `lectureParCarte` | 30 | `GET /cartes/:id` + `POST /cartes/:id/lus` | une carte ouverte se recharge toutes les 10 s (6 / min) ; marge ×5 |
| `inscriptionParIp` | 10 | `POST /commerces/:id/clients` sans PIN | une tablée qui s'inscrit d'un coup ; bloque l'inscription en masse |
| `inscriptionParContact` | 5 | idem, par numéro / e-mail normalisé dans ce commerce | une personne ne s'inscrit qu'une fois ; freine l'énumération (F-12) |
| `tirageParIp` | 20 | `POST /commerces/:id/tirages` | 1 tirage / jour / client ; laisse une salle pleine jouer |
| `tirageParContact` | 5 | idem, par contact | réessais légitimes (réseau), pas plus |
| `ficheClientParIp` | 10 | `POST …/clients/:id/profil`, `POST …/clients/:id/rattrapage` (demande du client) | rares par nature |
| `sessionParIp` | 30 | `POST /sessions` | borne le coût scrypt ; toute l'équipe ouvre sa session depuis le même wifi en début de service |

Les routes authentifiées (gérant, caisse, admin) ne sont **pas** limitées : la file hors ligne de la caisse doit pouvoir
tout rejouer d'un coup. L'IP est celle de `X-Forwarded-For` derrière Render (`TRUST_PROXY`) ; si Render ne réécrit pas
cet en-tête, un attaquant peut la falsifier (non vérifié, audit F-06) : les compteurs par carte, par contact et par
cible tiennent quand même.

### Migration 0006 (anti-bruteforce persistant) — à appliquer en production

Facultative pour que tout marche (le serveur tolère son absence), nécessaire pour que les blocages survivent à un
redémarrage. Supabase → **SQL Editor** → coller `supabase/migrations/0006_tentatives_auth.sql` → **Run** (rejouable).
Vérifier : `select relname, relrowsecurity from pg_class where relname = 'tentatives_auth';` → 1 ligne, `true`.
Aucun redéploiement nécessaire. Annulation : `0006_tentatives_auth.down.sql` (supprime la table : blocages en cours levés,
sans effet sur les données métier).
- Limite honnête : scrypt coûte ≈ 46 ms par essai (mesuré le 10/11/2026 sur la machine de dev) contre quelques µs pour
  l'ancien SHA-256, mais un PIN de 4 chiffres n'a que 10 000 valeurs : **si la base fuit**, il reste trouvable (≈ 8 min
  de calcul par PIN sur un cœur, au lieu d'une fraction de seconde). La protection principale reste que la base n'est
  accessible qu'au serveur (RLS + clé secrète uniquement chez Render).
- Le tirage est entièrement décidé par le serveur : le navigateur n'envoie qu'un contact, jamais un lot.
- HTTPS : fourni par l'hébergeur (Render le fait d'office). Ne pas exposer le serveur en HTTP simple sur Internet (jetons et PIN passent dans les en-têtes).

### En-têtes HTTP (P0-S4, audit F-08)

**Sur toutes les réponses** (API JSON, CSV, erreurs, 304, front statique, preflight `OPTIONS`) — `ENTETES_SECURITE` dans
`server/app.ts`, justification directive par directive en commentaire :

| En-tête | Valeur |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; media-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (pas de `preload` : sous-domaine onrender.com, à décider avec un domaine à soi) |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `same-origin` |
| `Permissions-Policy` | `camera=(self), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()` |

- **Seul assouplissement de la CSP : `img-src data: https:`** — photos du menu importées en base64 (`data:image/…`) et
  logo / bannière / photos saisis comme adresse `https://…` quelconque par le commerçant. Pas de `'unsafe-inline'` : le
  build Vite ne contient ni script ni `<style>` inline, et les `style={…}` de React passent par le CSSOM (non bloqué).
- `camera=(self)` : le scan du QR client à la caisse (`getUserMedia`). Le QR affiché est un `<svg>` généré localement.
- `connect-src 'self'` suppose le front servi par ce serveur avec `VITE_API_URL=/` (`npm run build:api`). Un front servi
  ailleurs reçoit les en-têtes de son propre hébergeur.

**CORS** (`CORS_ORIGIN`) : définie → seule cette origine exacte reçoit `Access-Control-Allow-Origin` (+ `Vary: Origin`),
y compris au preflight ; une autre origine ne reçoit aucun en-tête CORS (le navigateur bloque la réponse) ; une requête
sans `Origin` est servie normalement. Absente → `*` comme avant, avec avertissement. En production le front est servi
**par ce même serveur** : c'est la même origine, le CORS ne s'applique pas à lui — `CORS_ORIGIN` sert à fermer l'API aux
*autres* sites. Valeur à mettre sur Render : `https://asian-home-fidelite.onrender.com` (à remplacer par le domaine
personnalisé le jour où il existe).

**Cache** :

| Réponse | `Cache-Control` |
|---|---|
| API JSON (succès et erreurs), export CSV | `no-store` |
| `dist/assets/*` (nom avec hash Vite) | `public, max-age=31536000, immutable` ; un asset absent → 404 (pas index.html) |
| `index.html` (et toute route du front) | `no-cache` (revérifié à chaque fois : un déploiement est pris au rechargement) |
| autres fichiers (`/visuels/*.jpg`…) | `public, max-age=3600` |

Tous les fichiers statiques ont un `ETag` faible (taille + date de modification) : `If-None-Match` correspondant → 304.

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
4. Render demande alors les **secrets** (`sync: false` dans `render.yaml` ; ils ne sont **jamais** dans le dépôt) :
   - `SUPABASE_URL` = l'URL de l'étape c (`https://<ref>.supabase.co`)
   - `SUPABASE_SERVICE_ROLE_KEY` = la clé secrète de l'étape c (`sb_secret_…`)
   - `ADMIN_PIN` = un PIN de **8 à 12 chiffres**, pas tous identiques, choisi par vous (gardez-le pour vous)
   - `PIN_ASIAN_HOME` = le PIN **4 à 6 chiffres** que vous donnerez au restaurant (lu au **premier** démarrage seulement ;
     ensuite on le change dans l'app)
   - `SESSION_SECRET` (P0-S1, 5e secret) = une chaîne aléatoire d'au moins 32 caractères (`openssl rand -base64 48`).
     Service **déjà créé** : Render ne la demande pas — l'ajouter à la main dans **Environment** (voir ⚠️ ci-dessous).
   Puis **Deploy Blueprint** (libellé de la doc Render du 09/11/2026 ; le brief disait « Apply » — prendre le bouton de
   validation affiché). Rien d'autre à saisir : `PORT`, `RENDER` et `NODE_ENV=production` (au démarrage seulement, pas au
   build — donc `npm ci` installe bien TypeScript et Vite) sont posés par Render ; `TZ`, `TRUST_PROXY` et le mode production
   sont réglés par le serveur. **Ne pas** ajouter `DEMO` ni `DB_FILE`.
   ⚠️ Render ne demande ces secrets **qu'à la création** du Blueprint. Pour en corriger un plus tard : service →
   **Environment** → modifier → enregistrer (Render redéploie ; sinon **Manual Deploy**). Si Render réclame une carte
   bancaire ou propose un plan payant : **ne pas valider** — vérifier que le plan affiché est bien *Free* (à confirmer à l'écran).
   *Sans Blueprint* (secours) : **New** → **Web Service** → même dépôt → Language **Node**, Branch `master`, Region
   **Frankfurt**, les mêmes Build / Start Commands, Instance Type **Free**, et les 6 variables (`NODE_VERSION=24` + les 5
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

- SQLite : 1 seule instance (fichier local). Sous Supabase, plusieurs instances partagent la base ; l'anti-bruteforce
  y est relu au premier usage de chaque clé puis gardé en cache par instance (prévu pour 1 instance Render).
- Limitation des routes publiques : en mémoire, remise à zéro au redémarrage (fenêtres d'une minute). Pas de CAPTCHA.
- Pas de comptes utilisateurs : un PIN par commerce, partagé par l'équipe ; pas de journal « qui a fait quoi ».
- Le client se reconnaît par son téléphone / e-mail sans vérification (pas de SMS de confirmation) : quelqu'un qui
  connaît le numéro d'un client voit son prénom et ses tampons, et peut jouer à sa place s'il a une visite validée ce jour-là.
- Pas de route d'import, pas de suppression de client (RGPD : à faire à la main dans la base pour l'instant).
- Le code serveur n'est pas vérifié par `tsc` (pas de `@types/node` installé, pour ne rien ajouter) : il est couvert par les tests HTTP.
- Le front en mode API (V2) recharge tout l'état toutes les 10 s : avec le PIN admin, une requête `/etat` par
  commerce. Suffisant pour quelques commerces ; au-delà, prévoir une route agrégée ou un rechargement incrémental.
- `GET /cartes/:clientId` (V2) parcourt les commerces pour trouver le client (pas d'index par identifiant seul) :
  sans importance à cette échelle.

## Intégrations préparées (V3) — aucun compte créé ; relances SMS / e-mail branchées en P1-B3 (sans clés)

| Fichier | Rôle |
|---|---|
| `server/wallet.ts` | Google Wallet « Generic pass » : JWT signé RS256, OAuth compte de service, création de classe (inactif sans configuration). |
| `server/wallet-apple.ts` | Apple Wallet `.pkpass` (manifeste, signature CMS, zip) — en suspens, branché sur aucune route. |
| `server/notifications/index.ts` | Interface d'envoi (`creerNotifications`) : 501 « à brancher » sans clé. |
| `server/notifications/twilio.ts` | Adaptateur SMS Twilio (API REST Messages). |
| `server/notifications/brevo.ts` | Adaptateur e-mail Brevo (API `v3/smtp/email`). |

Le code des adaptateurs n'a **jamais** été exécuté contre Twilio, Brevo ou Google : il n'est testé qu'avec un `fetch`
simulé (`tests/integrations-v3.test.ts`). Avant la mise en service, un essai réel sera nécessaire.

### Apple Wallet — EN SUSPENS (décision du 09/11/2026), code prêt mais NON branché

Depuis le 09/11/2026 (mission « Cartiz »), `server/wallet-apple.ts` contient le **vrai code** de fabrication d'un `.pkpass`
(pass.json « storeCard », `manifest.json` = SHA-1 de chaque fichier, signature PKCS #7 / CMS détachée SHA-256/RSA avec le
certificat signataire + WWDR, archive zip), sans dépendance. **Il n'est importé par aucune route** : `…/pass.pkpass` → 404,
`/sante` → `appleWallet: "en_suspens"`. Sans certificat, `construirePkpass` lève `ErreurAppleNonConfigure` : rien n'est signé.
La signature CMS a été vérifiée par `openssl cms -verify` sur des octets quelconques avec un certificat **auto-signé de test**
(test automatique) — jamais avec un certificat Apple, et aucun pass n'a été produit ni installé sur un iPhone.

Pour activer (sur décision explicite de l'utilisateur seulement) :
1. un compte **Apple Developer Program** (99 $/an) au nom de l'éditeur → **Team ID** (10 caractères) ;
2. un **Pass Type ID** (`pass.<domaine>.fidelite`) créé dans *Certificates, Identifiers & Profiles* ;
3. le **certificat** de ce Pass Type ID (fichier `.cer` converti en PEM) + sa **clé privée** (PEM, mot de passe éventuel) ;
4. le **certificat intermédiaire Apple WWDR** (PEM) ;
5. des images `icon.png` / `logo.png` (+ @2x) ;
6. côté code : une route qui appelle `passJsonApple` + `construirePkpass` avec ces fichiers (lus depuis des « secret files »
   Render), servie en `application/vnd.apple.pkpass` ; puis le **service web de mise à jour** (enregistrement des appareils,
   push APNs à chaque tampon) — sans lui le pass ne se met pas à jour. Ces deux parties ne sont pas écrites.
7. Le test « code de pass Apple confiné à server/wallet-apple.ts » devra être adapté à ce moment-là.

### Google Wallet — génération réelle derrière la configuration, sans compte

`server/wallet.ts` : classe + objet « Generic pass », **JWT « Save to Google Wallet » signé RS256** avec la clé du compte de
service (`aud: google`, `typ: savetowallet`, `origins`) → lien `https://pay.google.com/gp/v/save/<jwt>` ; jeton OAuth du compte
de service (flux JWT-bearer, scope `wallet_object.issuer`) et création de la classe via `walletobjects/v1/genericClass`.
Route `GET …/clients/:clientId/pass.json` : **501** sans configuration (cas actuel : aucun pass généré), **503** si la clé
est illisible, sinon `{ signe: true, urlEnregistrement }`. Testé uniquement avec une clé RSA **générée par le test** (aucun
compte Google) et un `fetch` simulé : le JWT est vérifié avec la clé publique, l'acceptation par Google ne l'est pas.

Pour activer :
1. un **compte émetteur** Google Wallet (console Google Pay & Wallet) → `GOOGLE_WALLET_ISSUER_ID` ;
2. un projet Google Cloud avec l'**API Google Wallet** activée ;
3. un **compte de service** + sa **clé JSON**, ajouté comme utilisateur du compte émetteur dans la console →
   fichier déposé comme *Secret File* Render, chemin dans `GOOGLE_WALLET_SERVICE_ACCOUNT_FILE` ;
4. l'approbation du compte émetteur par Google pour la publication (mode démo / production, dans la console) ;
5. puis : bouton « Ajouter à Google Wallet » côté client (aujourd'hui volontairement absent : encart « Carte Wallet :
   bientôt ») et mise à jour de l'objet à chaque tampon (non écrite). Noms de champs à revérifier dans la doc au moment
   de l'activation.

### Google Business Profile (avis) — développé (P1-B4), à brancher

OAuth, import des avis et publication des réponses sont écrits (`server/google-business.ts`) et testés contre un Google
**simulé** ; ils n'ont **jamais** été exécutés contre Google (aucun projet Cloud, aucune approbation, aucune clé). Sans
`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`, toutes les routes `…/google/*` et `publier-reponse` répondent **501** et
aucun appel n'est fait. Démarche complète (projet Cloud, formulaire « Application for Basic API Access », API à activer,
identifiants OAuth, variables Render, test) : **`docs/GOOGLE-BUSINESS.md`**.

Choix de stockage des jetons : table `meta` (clé `google_business:<commerce>`), comme `secret_desinscription` — aucune
migration à appliquer, table déjà fermée à `anon` / `authenticated` (RLS, 0002). Valeur chiffrée en AES-256-GCM avec une
clé dérivée de `GOOGLE_CLIENT_SECRET` : une copie de la base seule ne livre pas le refresh token. Le client secret reste
dans la variable d'environnement et ne transite jamais par le front.

### SMS / e-mail — relances branchées (P1-B3), en attente des clés

**État réel (10/11/2026)** : tout le parcours est codé et testé contre des prestataires **simulés** ; aucune clé Twilio ni
Brevo n'existe, donc en production **rien ne part** : la route relance répond 501 et la tentative est journalisée
« non branché ». Le code d'appel n'a jamais été exécuté contre le vrai Twilio ni le vrai Brevo.

- **Consentement** : case NON pré-cochée, une ligne, à l'inscription publique (`#/jouer`) et en caisse (écran Clients) ;
  modifiable sur la fiche client (« Le client accepte les relances » / « Retirer le consentement »). Stocké sur le client
  (`consentementRelance`, `consentementRelanceLe`, `consentementRelanceOrigine` : `inscription`, `commercant`, `stop-sms`,
  `lien-email`) — preuve datée, sans migration. Tout changement est journalisé (action `consentement`).
- **Modèles** (`src/lib/relances.ts`, fonctions pures) : bienvenue, récompense proche (8-9 tampons sur 10, ou carte pleine),
  inactif 30 jours, anniversaire. SMS en alphabet GSM ≤ 160 caractères (1 SMS facturé), nom du commerce, lien court `/c/<id>`,
  mention « STOP ». E-mail : objet + corps vouvoyés, lien vers la carte, lien de désinscription en pied.
- **STOP (SMS)** : webhook `POST /api/v1/commerces/<id>/stop-sms`, signé par Twilio. **Choix** : désinscription traitée par
  l'app (pas seulement par la liste d'opposition native de Twilio) pour que le consentement de la fiche reflète le STOP.
  Selon le pays et le type d'expéditeur, Twilio peut aussi gérer ses propres mots-clés STOP (à vérifier à l'activation).
- **Désinscription (e-mail)** : **Choix** : lien de l'app (`#/desinscription/<clientId>/<jeton HMAC>`, retrait au clic,
  pas à l'ouverture — un antivirus qui suit les liens ne désinscrit personne) + en-têtes `List-Unsubscribe` /
  `List-Unsubscribe-Post` (bouton « Se désabonner » de Gmail…). Brevo n'ajoute pas de lien de désinscription aux e-mails
  transactionnels (`v3/smtp/email`), d'où la route de l'app.
- **Journal des envois** : **Choix** : table dédiée `envois` (migration 0007) plutôt que le `journal` existant — il faut un
  index unique (commerce, client, modèle, jour) pour l'anti-doublon tenu par la base (deux clics simultanés n'envoient
  qu'une fois), des statuts mis à jour après l'appel au prestataire (`en_cours` → `envoye` / `erreur`), et le `journal`
  d'audit est en ajout seul. Lecture : écran **Messages** (« Journal des envois ») et fiche client (« Envois à ce client »).
- **Relances automatiques** (inactif, anniversaire) : cases dans l'écran Messages, désactivées par défaut ; tournée à
  l'ouverture du tableau de bord du gérant (pas de tâche planifiée : Render Free endort le serveur). Une tournée par jour.

**Pour activer (à faire par l'utilisateur, comptes payants — rien n'a été créé) :**
1. Appliquer la migration 0007 (ci-dessous) — sans elle, aucun envoi ne part (503).
2. Renseigner `PUBLIC_URL` (ex. `https://asian-home-fidelite.onrender.com`).
3. SMS : compte Twilio, numéro ou Messaging Service expéditeur → `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` ;
   dans la console Twilio, numéro → *Messaging* → « A message comes in » : Webhook `POST`
   `<PUBLIC_URL>/api/v1/commerces/<id du commerce>/stop-sms`.
4. E-mail : compte Brevo, adresse expéditrice validée (domaine authentifié SPF/DKIM conseillé) → `BREVO_API_KEY`,
   `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`.
5. Vérifier `/api/v1/sante` → `integrations.sms` / `email` à `true`, `migrations.relances` à `true` ; puis un essai réel
   sur un client test consentant (son propre numéro), et un STOP en réponse.

### Migration 0007 (journal des envois de relances) — à appliquer avant tout envoi réel

Supabase → **SQL Editor** → coller `supabase/migrations/0007_relances.sql` → **Run** (rejouable). Vérifier :
`/api/v1/sante` → `"migrations": { …, "relances": true }` (relu au plus toutes les 60 s). Sans elle : journal des envois
vide, refus non tracés, aucun envoi réel (503). Annulation : `0007_relances.down.sql` (supprime la table `envois` ; le
consentement, stocké sur les clients, est conservé).

## Migration future (écrite avant S1 — Supabase est désormais préparé et la procédure écrite, voir plus haut)

Supabase ou Firebase seraient la voie suivante quand :
- un commerce dépasse **quelques centaines de clients actifs** ou qu'il y a **beaucoup de commerces** (plusieurs instances, sauvegardes gérées) ;
- on a besoin de **temps réel** (le comptoir voit le tirage au moment où il a lieu, sans rechargement) ;
- on veut de vrais **comptes** (e-mail / mot de passe par employé) au lieu d'un PIN.

Migration prévue simple : la forme des données (`src/types.ts`) ne change pas ; il faudrait réécrire `server/stockage.ts`
(ou remplacer le serveur par des fonctions Supabase) en gardant les mêmes routes, et importer les données depuis `fidelite.db`.

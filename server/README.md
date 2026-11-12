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
| `server/logs.ts` | **P2-Q6** : logs structurés JSON — une ligne par réponse terminée (niveau, horodatage, route masquée, statut, durée) ; jamais de secret, PIN, jeton, téléphone/e-mail brut ni identifiant de carte ou de client brut (empreinte SHA-256). Voir « Logs structurés et alertes ». |
| `server/alertes.ts` | **Item E** : alerte e-mail sur rafale de 5xx (> 10 en 15 min, 1 livrée par heure max, reprise 5 min après un échec), inactive sans `ALERTE_EMAIL`. Voir « Logs structurés et alertes ». |
| `server/stockage.ts` | Base SQLite (schéma + requêtes) et contrat `Stockage` commun aux deux bases. |
| `server/stockage-supabase.ts` | **S1** : même contrat sur Supabase (API REST PostgREST, clé service_role). |
| `supabase/migrations/` | **S1** : schéma Postgres (`0001_schema_initial.sql`) et RLS (`0002_rls.sql`). |
| `server/wallet.ts` | **V3** : Google Wallet préparé, inactif (voir « Intégrations préparées »). |
| `server/notifications/` | **P1-B3** : relances SMS / e-mail branchées de bout en bout ; **lot « Brancher Brevo »** : SMS via Brevo (Twilio en repli), e-mail via Brevo ; **compte Brevo créé le 11/11/2026, 5 variables Render posées, mode test actif (`BREVO_MODE_TEST=1`) — aucun envoi réel**. Voir « SMS / e-mail » et `docs/BREVO.md`. |
| `tests/serveur.test.ts` | Tests HTTP réels (port éphémère, base temporaire, `fetch`), lancés par `npm test`. |
| `tests/migration-pglite.test.ts` | **S2** : la migration Supabase exécutée par un vrai Postgres local (PGlite, WebAssembly). |
| `render.yaml` (racine) | **S3** : Blueprint Render du serveur (Free, Frankfurt, build / start, `NODE_VERSION`, 5 secrets + `CORS_ORIGIN` `sync: false`). Validé par `tests/render-yaml.test.ts`. |

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

### Vérification des types (P0-S21)

Node exécute le serveur en supprimant les types **sans les vérifier** (même chose pour `npm test`), et `npm run build`
(`tsc -p .`) ne couvre que `src/`. Le serveur se vérifie donc à part :

```bash
npm run typecheck:server   # = tsc -p tsconfig.server.json
```

`tsconfig.server.json` étend `tsconfig.json` (mêmes règles : `strict`, `noUnusedLocals`, `noUnusedParameters`) avec les
types Node (`@types/node` 24, dépendance de dev) au lieu de `vite/client`, et `lib: ["ES2022"]` sans le DOM (les `fetch`,
`URL`, `Response`… viennent des types Node). Il inclut `server/` et, par les imports, les fichiers de `src/` partagés
(`src/lib/*.ts`, `src/types.ts`, `src/data/*`, `seed.json`). La vérification est branchée dans `npm test` (elle tourne
avant les tests) : une erreur de type serveur fait échouer `npm test`. Elle n'est pas branchée dans `npm run build` /
`build:api` (build Render) — décision volontaire, à trancher à la fusion.

En développement, sans aucune variable : PIN admin `000000`, PIN commerçant d'Asian Home Paris `1234`
(un avertissement s'affiche au démarrage). **Ces PIN de développement ne sont jamais acceptables en production** :
en production, le serveur refuse de démarrer sans `ADMIN_PIN`.

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3001` | Port HTTP. |
| `ADMIN_PIN` | dev : `000000` ; **production : obligatoire** | PIN admin (création de commerces, accès à tous les commerces, réinitialisation d'un PIN). En production : 8 à 12 chiffres, pas tous identiques, sinon refus de démarrer. |
| `PIN_ASIAN_HOME` | dev : `1234` ; **production : obligatoire au 1er démarrage** | PIN commerçant (4 à 6 chiffres) donné à Asian Home Paris lors de la création de la base. Ignoré ensuite (le changer via `PUT /pin`). |
| `SESSION_SECRET` | dev : secret éphémère (avertissement) ; **production : obligatoire** | **P0-S1.** Secret de signature (HMAC-SHA256) des jetons de session et des jetons client (P0-S7), 32 caractères minimum (ex. `openssl rand -base64 48`). Absente ou trop courte en production : **refus de démarrer** (correction Codex point 1 ; avant, le serveur démarrait sans jetons). La changer ferme toutes les sessions ouvertes. |
| `AUTH_CLIENT` | production : `stricte` (imposé) ; dev : `transition` | **P0-S7.** Accès des clients à leur carte (voir « Accès client aux cartes »). `stricte` = jeton client exigé pour la carte complète, le tirage, le profil, les messages, le rattrapage, les droits RGPD ; `transition` = jetons émis et vérifiés, mais l'accès d'avant P0-S7 (lien ou contact seuls) reste admis — **refusé en production** (refus de démarrer, correction Codex point 1). `stricte` sans `SESSION_SECRET` → refus de démarrer ; autre valeur → refus de démarrer. |
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
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | — | **P1-B3, non configuré.** SMS via Twilio (`TWILIO_FROM` = numéro expéditeur `+33…` ou identifiant de Messaging Service `MG…`). Les trois sont nécessaires, sinon 501. **Depuis le lot « Brancher Brevo » : Twilio n'est plus que le repli SMS** (utilisé seulement si Brevo SMS n'est pas configuré). |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `BREVO_SMS_SENDER` | — | **P1-B3 + lot « Brancher Brevo », non configuré.** E-mail via Brevo (adresse expéditrice à valider chez Brevo ; nom optionnel) **et SMS via Brevo** (`BREVO_SMS_SENDER` = nom d'expéditeur alphanumérique, 11 caractères max, ex. `ASIANHOME`). Clé + adresse nécessaires pour l'e-mail, clé + expéditeur SMS pour le SMS, sinon 501. Procédure complète : `docs/BREVO.md`. |
| `BREVO_MODE_TEST` | `0` | **Lot « Brancher Brevo », consigne du 10/11/2026 : aucun envoi réel pendant le développement.** `1` = mode test : e-mail en sandbox Brevo (`X-Sib-Sandbox: drop`, rien livré), SMS simulé (aucun appel réseau, Twilio aussi simulé), journal des envois avec le statut `test` (« Test — rien envoyé »), `/sante` → `integrations.modeTest: true`. **À retirer pour envoyer pour de vrai** (plus tard, avec accord explicite — voir `docs/BREVO.md` §5). |
| `ALERTE_EMAIL` | — (alerte désactivée) | **Item E.** Adresse de l'exploitant qui reçoit l'alerte e-mail sur rafale de 5xx : plus de 10 réponses 5xx en 15 minutes glissantes → 1 e-mail, au plus 1 livré par heure (nouvelle tentative 5 min après un échec), via l'adaptateur e-mail Brevo (suit `BREVO_MODE_TEST`). Absente ou vide = aucun compteur, aucun envoi. Voir « Alerte e-mail sur rafale de 5xx ». |
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
SQLite éphémère). **En production (`NODE_ENV=production` ou `RENDER`), aucune des deux → refus de démarrer aussi (P0-S9) :**
`[serveur] En production, Supabase est obligatoire…` — plus de bascule silencieuse vers un SQLite vide (sur Render, le
fichier est perdu à chaque redéploiement ou réveil). Hors production, SQLite reste le défaut. `GET /api/v1/sante` indique
`"stockage": "sqlite"` ou `"supabase"` — et, si SQLite en production (démarrage par un autre chemin),
`"alerteStockage"` avec le message explicite. `npm run serveur` lit aussi un fichier `.env` s'il existe (modèle :
`.env.example` à la racine ; `.env` est ignoré par git).

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

**Egress — mesuré (P1-P1, 11/11/2026), pas une estimation.** Le front en mode API recharge **tout l'état** du commerce
toutes les 30 s tant qu'un écran commerçant est visible (`INTERVALLE_RECHARGEMENT_MS`, `src/store.tsx`), et le serveur relit
alors clients, tirages et avis dans Supabase. Tailles mesurées sur le seed : ~430 octets par client, ~210 par tirage, ~265 par
avis. Mesure locale (vrais octets UTF-8, `tests/egress-p1-p1.test.ts`, 150 clients / 100 visites / journal 100 entrées,
1 onglet visible 12 h/j, 30 j) : HTTP `/etat` 69 210 o + `/commerces` 1 088 o = 70 298 o par rechargement →
**3,04 Go/mois côté navigateur, 3,50 Go/mois côté PostgREST** (lignes lues avec les colonnes sélectionnées —
proxy de l'egress Supabase, pas la mesure dashboard) à 30 s — **sous les 5 Go gratuits**. À 300 clients :
4,68 Go HTTP / 5,60 Go PostgREST — **seuil 5 Go côté PostgREST vers ~257 clients** : un rechargement différentiel
deviendra alors nécessaire (non fait : il exigerait un point de reprise côté serveur). La compression P2-Q2
(gzip/brotli, voir « Compression des réponses ») réduit le flux serveur → navigateur, **pas** l'egress
Supabase → serveur. La minuterie caisse 15 s (`GET /caisse`, 240 o) ne pèse que 0,02 Go/mois ; un 2e onglet
double le rechargement périodique. **Reste : l'egress réel dans le dashboard Supabase** (Database → Usage ou
Settings → Usage — non lu : pas d'accès navigateur sur la VM de développement).

**Taille de base** : quelques centaines d'octets par client, tirage ou avis → 500 Mo représentent des centaines de milliers
d'enregistrements ; pas un sujet pour un restaurant.

**Plafond PostgREST — pagination serveur (P0-S18).** PostgREST plafonne une réponse à **1 000 lignes** par défaut : une
lecture de liste sans `.range()` s'arrête silencieusement à 1 000 lignes. Toutes les lectures de listes passent donc par
`lirePages` (`server/stockage-supabase.ts`, pages de 1 000 lignes, tri déterministe obligatoire sinon une ligne peut être
lue deux fois ou jamais) : `commerces()`, `clients()`, `tirages()`, `tiragesClient()`, `tiragesParCode()`, `avis()`,
`membres()` (et déjà `compteursEvenements()`). Les lectures d'une seule ligne et celles à limite explicite (`journal`,
`envois`) ne paginent pas. Conséquence : `GET …/etat`, l'export CSV et les statistiques (`src/lib/stats.ts`) sont complets
au-delà de 1 000 clients / tirages / avis — l'écran Clients affiche déjà la liste par pages de 50 (« Charger plus »).
Résiduel : le bilan de `supprimerClient` compte les lignes supprimées renvoyées par PostgREST (plafonné à 1 000 par
table) — la suppression elle-même n'est pas plafonnée, seul le chiffre du journal peut être un minimum si un client
avait plus de 1 000 tirages. Les lectures ne sont pas « snapshot » : une écriture concurrente pendant une lecture
paginée (fenêtre < 1 s) peut dupliquer ou omettre une ligne — les stats et l'export tolèrent une ligne de plus ou de
moins, et la pagination par curseur n'a pas été jugée utile (revue Codex P0-S18 point 2).

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
| `GET /sante` | public | `{ ok, version, mode, stockage, demo, integrations }` — `integrations` (V3) : `{ googleWallet, appleWallet: 'en_suspens', googleBusinessProfile, sms, email }`, chacun `false` tant que rien n'est configuré ; `smsPrestataire: 'Brevo' \| 'Twilio'` présent seulement si `sms` est `true` (nom du prestataire SMS effectif, pour la page de confidentialité) ; `modeTest: true` présent seulement si `BREVO_MODE_TEST=1` (aucun envoi réel). `migrations` : `{ cartiz, programme, relances, mesure }` — `relances` = migration 0007 (table `envois`), `mesure` = migration 0008 (table `evenements_jour`). Les migrations 0009 (auth client) et 0010 (compteurs publics) ne figurent pas dans `/sante` : 0009 se vérifie par `GET /api/v1/sante/acces-client` → `migration: true`, 0010 par `select count(*) from public.compteurs_publics;` sans erreur (voir « Migration 0009 » / « Migration 0010 »). |
| `GET /commerces` | public | Fiches publiques (jamais de PIN ni de hash). |
| `GET /commerces/:id` | public | Une fiche publique. |
| `GET /cartes/:clientId` | public | **Ajout V2** (page `#/carte/:clientId` et état de la roue) : `{ client (sans téléphone ni e-mail), commerce (fiche publique), jeu: { statut: 'pret' \| 'sansVisite' \| 'dejaJoue', lotDuJour, codeDuJour, remisDuJour } }`. **Roue v2 R3 : `codeDuJour` vaut toujours null** (champ gardé pour les pages d'avant R3) — le code n'est servi que par `POST …/tirages/:tirageId/activer` (titulaire, jeton client). Vue complète : `gainsEnCours` = gains non terminaux du client `[{ tirageId, lot, date, statut: 'enAttente' \| 'inactif' \| 'utilisable', utilisableLe, expireLe, expireActivation }]`, sans code (le plus ancien d'abord). 404 inconnue, 409 commerce inactif. P1-C3 : `historiqueLots` = lots gagnés à la roue (20 derniers, perdants exclus) `{ lot, date, statut }` (statut v2 R3 : `'enAttente' \| 'inactif' \| 'utilisable' \| 'remis' \| 'expire'`), **sans aucun code**. |
| `POST /cartes/retrouver` | public | **P1-C3** (« Carte introuvable », audit F-12). `{ contact }` → **toujours 202 `{ ok: true, envoi }`**, que le contact ait une carte ou non ; `envoi` = un prestataire est configuré pour ce canal (Brevo pour un numéro comme pour un e-mail, Twilio en repli pour un numéro — état du serveur, déjà public dans `/sante`). Si `envoi`, la recherche et l'envoi du lien (`/c/<id>` en SMS, `#/carte/<id>` en e-mail) se font **après** la réponse (le temps de réponse ne trahit rien) ; 3 envois max par contact et par 24 h. Sans prestataire : rien n'est cherché ni envoyé. 400 si le contact est illisible ; limite `ficheClientParIp`. |
| `POST /commerces` | admin | `{ nom, type, lienGoogle?, pin, …réglages? }` → crée le commerce (défauts de `nouveauCommerce`). |
| `PATCH /commerces/:id` | commerçant | Réglages : `nom, type, logo, lienGoogle, coordonnees, recompense, seuilTampons, lots, reglesReponseAuto, actif`. Tout autre champ → 400. Réapplique les règles d'avis (comme le front). |
| `PUT /commerces/:id/logo` | commerçant | **P1-B5.** Corps = le fichier brut (pas de JSON). PNG / JPEG / WebP lus dans les octets (le `Content-Type` est ignoré) ; 2 Mo max (413), 100 à 4 096 px de côté, autre format (GIF, SVG, texte…) → 400 avec message clair. Rangé dans `meta` (clé `logo:<id>`, aucune migration) ; `logo` du commerce = `/api/v1/commerces/:id/logo?v=<empreinte>` → `{ commerce, logo: { type, largeur, hauteur, octets } }`. Le front (Réglages) réduit l'image à 512 px en WebP avant l'envoi. |
| `GET /commerces/:id/logo` | public | **P1-B5.** L'image envoyée, avec son type ; `ETag` (304) ; cache 1 an si `?v=` = version actuelle, 5 min sinon. 404 sans logo envoyé (le front affiche alors `public/visuels/logo.png` pour Asian Home, les initiales sinon). Gardée en mémoire après la 1re lecture. |
| `DELETE /commerces/:id/logo` | commerçant | **P1-B5.** « Revenir au logo par défaut » : `logo` vidé, image effacée de `meta` → `{ commerce }`. Idempotent. |
| `PUT /commerces/:id/pin` | commerçant ou admin | `{ pin }` : change le PIN (PIN perdu → l'admin le réinitialise). |
| `GET /commerces/:id/etat` | commerçant | `{ commerce, clients, tirages, avis }`. **Revue Codex R3 : `tirages` sans `code`** (le code ne circule que par l'activation du titulaire ; le tableau de bord n'affiche que lot, client, statut). |
| `POST /commerces/:id/clients` | public ou commerçant | `{ prenom, contact }` → inscrit ou retrouve. **P2-S13 (signaux uniformisés) : en public, même statut 201 et même forme `{ client }`, sans `existant` (nouvelle carte : + `jeton` ; carte existante : pas de jeton, « Retrouver ma carte » / comptoir ; mode strict : 409 sans donnée). Résiduels : la présence du jeton distingue création et reprise, et la carte renvoyée permet de lire `jeu.statut` sans jeton en mode transition (fermé en mode strict).** Avec PIN : 201 / 200 + `existant` (le personnel voit déjà les clients). En public : réponse sans téléphone ni e-mail, commerce actif requis. Un PIN fourni est toujours vérifié. |
| `POST /commerces/:id/clients/:clientId/visite` | commerçant | `validerVisite` (1 tampon). |
| `POST /commerces/:id/clients/:clientId/recompense` | commerçant | `offrirRecompense` (report de l'excédent) ; 409 si pas encore débloquée. |
| `POST /commerces/:id/tirages` | **public** | `{ contact, prenom? }` → retrouve / crée le client, vérifie **côté serveur** la visite du jour et le tirage du jour, tire le lot côté serveur, l'enregistre → `{ tirageId, lot, lotId, type, date, perdant }` (**roue v2 R3 : plus jamais de `code` dans cette réponse** — le gain ne s'utilise qu'à partir du lendemain et son code n'est servi que par `POST …/tirages/:tirageId/activer` ; `tirageId` sert à cette activation) (roue v2 R1 : `lotId` = id du lot tiré — la page de jeu retrouve le secteur par cet id, jamais par le libellé ; `type` = `'lot' \| 'points' \| 'perdant'` ; `perdant` = rien à retirer au comptoir, donc vrai aussi pour une consolation en points). Le tirage enregistré fige `lotId` et `typeLot`. **Roue v2 R2** : `modeAccesRoue` du commerce — `'libre'` (défaut des nouveaux commerces) = prêt dès l'identification, `'visite'` (champ absent : configs d'avant R2) = visite du jour exigée ; ensemble tirable du jour = sans les lots `'lot'` ayant atteint leur `plafondJour` aujourd'hui (tous clients), et sans AUCUN lot `'lot'` si le client a déjà gagné `limiteGainsMois` lots physiques sur 30 jours glissants (défaut 4, 0 = illimité) — points / perdant jamais retirés (repli consolation), probabilités renormalisées au prorata ; tout parti (que des lots physiques plafonnés) → 409 « Tous les lots du jour sont partis ». Consolation `'points'` : tirage enregistré d'abord (index unique client + jour), puis points crédités au client dans la même transaction ; réponse `+ { points, solde }`, **aucun code** (un perdant garde le sien, vérifiable en caisse). Les fiches publiques (`GET /commerces`, `/commerces/:id`, `/menu`, `/cartes/:id`) omettent les lots plafonnés du jour (tirages du jour lus seulement si un lot a un plafond). **Revue Codex R2** : comptage des plafonds → choix du lot → insertion → crédit sérialisés PAR COMMERCE dans le processus (les autres commerces ne s’attendent pas) — **limite : une seule instance** (Render aujourd’hui), le verrou est en mémoire ; journée des plafonds = jour calendaire **à Paris** (comme l’index unique des tirages) ; crédit des points en échec après l’insertion → tirage supprimé (compensation) et **500** « vos points n’ont pas pu être crédités… vous pouvez retenter » (suppression elle aussi en échec : 500 qui le dit + ligne JSON `incoherence` en log) ; écrire les lots (PATCH) rattache les tirages d’avant R1 sans `lotId` au lot de même libellé (espaces de bord + casse), s’il est unique. **P2-S13 : refus 409 à message UNIQUE, identique sans visite ou déjà joué (la raison précise reste visible par le titulaire via `jeu.statut` de `GET /cartes/:id`).** |
| `GET /commerces/:id/reglement` | public | **Roue v2 R4** (page `#/reglement/:id`) : `{ reglement: { commerceId, nom, coordonnees?, actif, modeAccesRoue, limiteGainsMois, dotations: [{ libelle, type: 'lot' \| 'points' }], secteurPerdant } }` — lots ACTIFS (plafonnés du jour compris : le règlement décrit la dotation), défauts appliqués (mode absent = `'visite'`, limite absente = 4, 0 = illimité). Jamais les probabilités, coûts, plafonds ni montants de points. Limité par IP comme la fiche (`lectureParIp`, avant toute lecture). 404 inconnu, 405 hors GET. Depuis R4, la fiche publique porte aussi `modeAccesRoue` (effectif). |
| `POST /commerces/:id/tirages/:tirageId/activer` | **titulaire** (jeton client, P0-S7 — jamais par contact, même en transition) | **Roue v2 R3 — burn-on-reveal, « Utiliser mon gain ».** Pose `activeLe = maintenant` sur le tirage (écriture conditionnelle `… AND donnees->remis IS NULL`, comme la remise) → `{ tirageId, lot, code, activeLe, expireActivation }` (`activeLe` + 10 min). **Seule route qui sert un code gagnant au client.** Chaque appel écrase l'activation précédente (le client ré-appuie une fois la fenêtre échue). Refus : **409** le jour du tirage (« utilisable dès demain »), déjà remis, perdant / consolation, **tirage d'avant la roue v2 du jour même** (il se retire directement au comptoir) ; **410** après J+30 — ou dès le lendemain pour un tirage d'avant la roue v2 ; jours comptés **à Paris** (revue Codex R3) ; **404** tirage inconnu de CETTE carte (même réponse pour le tirage d'un autre client) ; **401** sans jeton valable ; **503** sans `SESSION_SECRET`. Sans migration (`activeLe` vit dans `tirages.donnees`). |
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
| `GET /commerces/:id/caisse` | code équipe ou commerçant | **P0-S14 (vue minimale).** `X-Equipe-Code: <4 chiffres>` → `{ auteur, commerce, clients, total, page, limite }` (401 si code faux, compte dans l'anti-bruteforce). Sans `?q=` : `clients` est **vide** — plus jamais la liste des clients ni le journal. Avec `?q=<prénom, téléphone ou e-mail>&page=&limite=` (limite 1–50, défaut 20) : seuls les clients correspondants, paginés côté serveur ; `total` = tous les correspondants. `commerce` est réduit à ce que le comptoir affiche et calcule (nom, logo, seuil, récompense, catalogue, taux de points, niveaux) : jamais les lots (probabilités) ni les réglages internes. |
| `GET /commerces/:id/caisse/clients/:clientId` | code équipe ou commerçant | **P0-S14.** Fiche d'un seul client à la demande (scan QR, sélection) → `{ client }` (contact et soldes, sans messages ni données techniques). 404 si inconnu. |
| `POST /commerces/:id/caisse/passage` | code équipe ou commerçant | `{ clientId, actionId, faitLe?, montantCentimes? }` → 1 tampon + points ; **409 si déjà un passage ce jour-là** ; `actionId` déjà reçu → `dejaTraite: true`, rien n'est recompté ; `faitLe` accepté s'il date de < 72 h (file hors ligne). Journalisé. |
| `POST /commerces/:id/caisse/recompense` | idem | `{ clientId, actionId, faitLe? }` → récompense tampons (409 avant le seuil). Journalisé. |
| `POST /commerces/:id/caisse/echange` | idem | `{ clientId, recompenseId, actionId, faitLe? }` → échange de points (409 solde insuffisant), tracé `{ soldeAvant, soldeApres, auteur }`, idempotent. Journalisé. |
| `GET /commerces/:id/caisse/gains/:code` | idem (code équipe, session équipe ou commerçant) | **P0-U3.** Code gagnant de la roue (6 car., casse / espaces / tirets ignorés) → `{ gain: { code, lot, date, statut, client: { id, prenom } \| null, remis: { le, par } \| null } }` — **statut v2 (roue v2 R3)** : `'enAttente'` (le jour du tirage), `'inactif'` (utilisable de J+1 à J+30 mais code non activé, ou activé il y a 10 min ou plus), `'utilisable'` (activé il y a moins de 10 min : à remettre), `'remis'`, `'expire'` (après J+30), `'perdant'`, `'consolation'` ; messages : `messageGain` (src/lib/roulette.ts) (R1 : `consolation` = lot de type « points », rien à remettre ; le statut vient du type figé du tirage, plus du libellé). Jamais le contact du client. 400 format, 404 code inconnu. Lecture seule. |
| `POST /commerces/:id/caisse/gains/:code/remise` | idem | **P0-U3.** Marque le gain « remis » (`tirages.donnees.remis = { le, par: auteur }`) → `{ gain }`. **Roue v2 R3 : acceptée seulement si le statut est `'utilisable'`** (J+1 à J+30 ET code activé il y a moins de 10 min). **409 pas encore utilisable / code non activé ou fenêtre échue / déjà remis** (avec date et auteur de la remise) **/ tirage perdant / consolation en points**, **410 expiré** (après J+30), 404 inconnu. **Revue Codex R3** : jours J / J+1 / J+30 = jours calendaires **de Paris** (`numeroJourParis`), quel que soit le fuseau du processus ; l'heure de vérité est celle de l'**écriture** (statut re-vérifié après la lecture, et l'UPDATE exige `donnees->>activeLe > écriture − 10 min` : fenêtre échue entre-temps → 409 message d'activation). **Tirages d'avant la roue v2** (sans `typeLot`, ou `typeLot` posé par le rattachement R1 : `typeDeduit`) : ANCIENNE règle — remis directement (sans activation ni fenêtre) le jour du tirage seulement, expirés ensuite (410), jamais activables ; `gain.ancienneRegle: true`. Un code = une remise, garanti par un UPDATE conditionnel (`… AND donnees->remis IS NULL`) : deux caisses simultanées → 200 + 409. Journalisé (action `gain`). Sans migration. |
| `POST /commerces/:id/clients/:clientId/visite` / `recompense` (complément) | commerçant **ou code équipe** | Inchangés côté règles ; désormais journalisés (auteur « Gérant » ou membre). La règle « 1 tampon par jour » n'est appliquée que par la route caisse (comportement historique conservé ici). |
| `PATCH /commerces/:id/clients/:clientId` | commerçant | `{ anniversaire?: "MM-JJ" \| "", platPrefere?, consentementRelance?: boolean }`. **P1-B3** : `consentementRelance` pose / retire le consentement aux relances (bouton de la fiche client), avec `consentementRelanceLe` + `consentementRelanceOrigine: 'commercant'`, journalisé (action `consentement`). |
| `GET` / `POST /commerces/:id/equipe`, `PATCH` / `DELETE /commerces/:id/equipe/:membreId` | commerçant | Membres `{ nom, code }` ; code de 4 chiffres, unique dans l'équipe (409), stocké haché + salé, **jamais renvoyé ni journalisé**. |
| `GET /commerces/:id/messages` | commerçant | 100 derniers messages (auto + ciblés) avec prénom et contact, pour copier le texte. |
| `POST /commerces/:id/messages` | commerçant | `{ cible: 'tous' \| 'inactifs' \| 'proches' \| 'nouveaux', texte }` → déposé dans l'espace client des clients ciblés. **Aucun SMS / e-mail.** |
| `GET /commerces/:id/menu` | public | `{ menu, commerce }` (menu vide si jamais enregistré ; 409 si commerce inactif). |
| `PUT /commerces/:id/menu` | commerçant | `{ categories: [{ nom, produits: [{ nom, prix (centimes), description?, photo? (https ou JPEG/PNG/WebP ≤ 60 Ko), allergenes[] }] }] }` (20 catégories / 60 produits max, corps ≤ 3 Mo). |
| `GET /commerces/:id/etat` (complément) | commerçant | Aussi `membres` (sans code) et `journal` (200 dernières actions). Les clients n'y ont plus leur boîte de réception (egress). |
| `POST /commerces/:id/clients` (complément P1-B3) | public ou commerçant | `consentementRelance: true` seulement si la case « offres par SMS ou e-mail » (jamais pré-cochée, page de jeu et inscription en caisse) est cochée ; absent = pas de consentement. Ignoré pour un client **déjà inscrit** (personne ne peut réabonner un numéro après un STOP en se ré-identifiant). |
| `POST /commerces/:id/clients` (complément P1-C1) | public ou commerçant | Prénom **optionnel des deux côtés** (`prenom` absent ou `""`) ; seul le téléphone ou l'e-mail est obligatoire. La page de jeu n'envoie plus de prénom : il est demandé après le tirage (route suivante). |
| `POST /commerces/:id/clients/:clientId/prenom` | public (carte + contact) | **P1-C1.** `{ prenom, contact }` → `{ client }` (carte publique, sans contact). Prénom demandé sur l'écran de gain, **seulement si la carte n'en a pas** : **409** si elle en a déjà un (personne ne renomme la carte d'un autre), **403** si le contact ne correspond pas à la carte (même contrôle que les routes RGPD), 400 vide / > 40 car., 404 carte inconnue. Ne touche ni au tirage ni au jeu du jour. Limite `ficheClientParIp`. |
| `POST /commerces/:id/clients/:clientId/message-prive` | public (carte + contact) | **P1-C4.** `{ contact, note, texte }` → **201** `{ ok, message: { id, creeLe } }` (ni carte ni contact dans la réponse). Proposé sur l'écran de gain quand le client choisit **3★ ou moins** dans l'app, avant le lien Google (qui reste affiché). Stocké dans `clients.donnees.messagesPrives` (aucune migration), visible par le commerce dans `GET …/etat` (écran #/avis), **jamais renvoyé par `GET /cartes/:id`**, **jamais expédié** (ni SMS ni e-mail). **403** contact différent, 400 note hors 1–5 entier / texte vide / > 1000 car., 404 carte inconnue, **429** au-delà de 3 messages par carte et par jour (20 conservés au plus). Limite `ficheClientParIp` par IP **et** par carte. Effacé avec la fiche (RGPD) et inclus dans l'export individuel. |
| `POST /commerces/:id/clients/:clientId/relance` | commerçant | **P1-B3.** `{ modele?: 'bienvenue' \| 'proche' \| 'inactif' \| 'anniversaire', canal?: 'sms' \| 'email', message? }` (modèle **ou** message libre ; canal par défaut : téléphone → SMS, sinon e-mail). **501** sans prestataire pour ce canal (sans prestataire configuré — en production Brevo est configuré, en mode test : rien de réel ne part) ; **409** sans consentement, sans contact pour ce canal, ou même modèle déjà envoyé à ce client aujourd'hui (Paris) ; **503** migration 0007 absente (pas d'envoi sans anti-doublon) ; **502** prestataire en erreur ; 200 `{ envoye, canal, modele, envoi }`. Chaque tentative, même refusée, est journalisée dans `envois`. |
| `GET /commerces/:id/envois` | commerçant | **P1-B3.** Journal des relances (200 dernières, `?client=<id>` pour un client) → `{ envois: [{ clientPrenom, date, modele, canal, statut, declencheur, auteur, raison? }], migration }`. Aussi dans `GET …/etat` (`envois`). Jamais le téléphone, l'e-mail ni le texte. |
| `POST /commerces/:id/stop-sms` | public (signature Twilio) | **P1-B3.** Webhook Twilio « A message comes in » : `Body` = STOP / ARRET / DESINSCRIPTION… (casse et accents ignorés, 1er mot) → consentement du client de ce numéro (`From`) retiré, journalisé ; autre mot : rien. **501** sans Twilio configuré, **403** si `X-Twilio-Signature` est fausse. Répond un TwiML vide. **SMS via Brevo → 501 aussi** (expéditeur alphanumérique : pas de réponse possible ; voir « SMS / e-mail » et `docs/BREVO.md` §6). |
| `POST /desinscription/:clientId/:jeton` | public (jeton HMAC) | **P1-B3.** Lien de désinscription des e-mails (page `#/desinscription/<clientId>/<jeton>`, bouton « Me désinscrire ») et One-Click `List-Unsubscribe-Post`. Jeton = HMAC du commerce + client (secret tiré une fois, gardé dans `meta`). Idempotent → `{ ok, commerce }` ; 404 lien invalide. |
| `GET /c/:clientId` (hors `/api`) | public | **P1-B3.** Lien court des SMS → 302 vers `/#/carte/<clientId>`. |
| `GET /d/:clientId/:jeton` (hors `/api`) | public | **P1-B9.** Lien court de désinscription des SMS de relance → 302 vers `/#/desinscription/<clientId>/<jeton>` (le jeton n'est pas vérifié ici : c'est la page qui appelle `POST /api/v1/desinscription/…` après un clic de confirmation). |
| `GET /commerces/:id/clients/:clientId/export.csv` | commerçant | **P1-B6.** Toutes les données de CE client en CSV (même format que l'export global : `;`, BOM, anti-injection) : profil, contact, tampons, points, visites, récompenses, échanges, tirages (lot, statut du gain, remise — **jamais le code**, revue Codex R3 ; idem pour l'export du titulaire `POST /cartes/:id/donnees`), rattrapages, consentement (date, origine), messages, relances. Une ligne par donnée : `rubrique;date;libelle;valeur`. Rien d'un autre client (le parrain n'apparaît que par « oui »), jamais de PIN / hash / code équipe ni d'identifiant technique. Journalisé (action `rgpd`). |
| `DELETE /commerces/:id/clients/:clientId` | commerçant (pas l'équipe) | **P1-B6.** Corps obligatoire `{ "confirmation": "SUPPRIMER" }` (400 sinon). Suppression définitive avec la **cascade** décrite dans « RGPD » ci-dessous → `{ ok, bilan: { client, tirages, journal, parrainages, rattrapages, envois } }`. Journalisé SANS prénom, contact ni identifiant (qui, quand, motif, combien). 404 client inconnu. |
| `GET /commerces/:id/purge` | commerçant | **P1-B6.** Avertissement avant purge → `{ conservationMois, maintenant, clients: [{ id, prenom, derniereActivite, purgeLe, statut: 'due' \| 'bientot', protection? }] }` : clients dont la date de purge (dernière visite, à défaut inscription, + durée) est passée ou tombe dans les 30 jours. `protection` = raison de ne PAS purger (exclu par le commerce, récompense en attente valable, plat en réserve valable, visite oubliée en attente). |
| `POST /commerces/:id/purge` | commerçant | **P1-B6.** `{ clientIds: [...] }` (ceux affichés par le GET) → supprime, avec la cascade, ceux qui sont **encore** purgeables au moment de l'appel (revérifié ici : revenu entre-temps, exclu, protégé → ignoré) → `{ supprimes, ignores, clientsSupprimes }`. Une entrée de journal par purge : auteur, date, durée, nombre de clients et de lignes supprimées (sans prénom). 400 liste absente / vide. |
| `PATCH /commerces/:id/clients/:clientId` (complément P1-B6) | commerçant | `exclusPurge: boolean` : exclut le client de la purge de conservation (ou l'y remet). Journalisé (action `rgpd`). |
| `PATCH /commerces/:id` (complément P1-B6) | commerçant | `conservationMois` : durée de conservation après la dernière visite, entier de 6 à 120 (400 sinon) ; absent = 36 (3 ans). Publiée dans la fiche publique (`conservationMois` effectif) pour la page de confidentialité. |
| `POST /cartes/:clientId/donnees` | public (lien de la carte + contact) | **P1-B6.** « Recevoir mes données » depuis la carte : `{ contact }` = téléphone ou e-mail de l'inscription (mêmes normalisations : 06… / +33… / 0033…, e-mail sans casse) → le CSV de l'export individuel. **403** contact différent, 404 carte inconnue. Limité par IP et par carte (`ficheClientParIp`). Marche même si le commerce est désactivé. Journalisé. |
| `POST /cartes/:clientId/suppression` | public (lien de la carte + contact) | **P1-B6.** « Demander la suppression » : `{ contact }` → `demandeSuppressionLe` posé sur le client (idempotent), journalisé → `{ ok, demandeSuppressionLe, commerce }`. La suppression elle-même est faite par le commerçant (fiche client, `DELETE` ci-dessus) : il remet d'abord une éventuelle récompense en attente. 403 / 404 comme ci-dessus. |
| `POST /commerces/:id/evenements` | **public** | **P2-Q3 — mesure anonyme.** Corps `{ type: 'scan' \| 'clicGoogle' }` et **rien d'autre** (tout autre champ → 400, pour qu'aucune identité ne puisse être envoyée) → **202** `{ ok, compte }`. `scan` = page de jeu ouverte (QR ou lien, une fois par onglet), `clicGoogle` = tap sur le bouton d'avis Google de la page de jeu. +1 sur le compteur (commerce, jour à Paris, type) de la table `evenements_jour` (migration 0008) : ni client, ni contact, ni IP, ni heure. `compte: false` si la migration manque ou si le commerce est en pause (rien n'est compté, jamais d'erreur visible). Limite `evenementParIp`. `tirage` et `gain` ne sont pas acceptés ici : le serveur les compte lui-même après chaque `POST …/tirages` réussi (un échec de comptage n'affecte jamais le tirage). |
| `GET /commerces/:id/mesures` | commerçant | **P2-Q3.** `?depuis=AAAA-MM-JJ` (défaut et minimum : 400 jours) → `{ compteurs: [{ jour, type, n }], migration, depuis, aujourdhui }`. Sans migration 0008 : `compteurs: []`, `migration: false`. Les coûts, séries et comparaisons sont calculés par le tableau de bord (`src/lib/mesure.ts`) à partir de `…/etat`. |
| `PATCH /commerces/:id` (complément P2-Q3) | commerçant | `lots[].coutCentimes` : coût unitaire du lot pour le commerce, entier de 0 à 100 000 centimes, facultatif (jamais publié aux clients). `testsAB: { accroche: { actif } }` : test A/B de la phrase d'accroche de la page de jeu (`docs/TESTS-AB.md`) ; `depuis` / `jusqua` sont posés par le serveur (jour à Paris) à l'activation / l'arrêt ; la fiche publique ne reçoit que `testAccroche: true` pendant le test. |
| `PATCH /commerces/:id` (complément roue v2 R1) | commerçant | `lots[]` : `id` (gardé s'il est valable — `[\w-]{1,60}` — et unique, sinon généré par le serveur, aléatoire ; un lot renommé garde son id), `type` (`'lot' \| 'points' \| 'perdant'`, 400 sinon ; absent = déduit de l'ancien libellé pour les clients d'avant R1), `points` (entier 1 à 10 000, exigé si `type: 'points'`). Libellés uniques, casse et espaces ignorés → 400 « Libellé de lot en double ». Chaque lot écrit porte toujours `id` et `type`. Fiche publique : `lots: [{ id, libelle, type }]` (jouables seulement, jamais probabilité, coût ni montant de points). Config d'avant R1 sans id : id déduit, stable, de la position et du libellé (`normaliserLots`, src/lib/lots.ts), figé à la première écriture. |
| `PATCH /commerces/:id` (complément P1-B3) | commerçant | `relancesAuto: { inactif, anniversaire }` (désactivées par défaut ; case dans l'écran Messages). Tournée lancée en arrière-plan à l'ouverture du tableau de bord (`GET …/etat`), une fois par commerce et par jour : clients consentants seulement, une relance auto par client et par tournée, une fois par absence (inactif 30-120 j) / par an (anniversaire). Rien sans prestataire ni migration 0007. |

Accès « commerçant » = en-tête `X-Session` (jeton `commerce` de ce commerce ou `admin`), **ou** en repli `X-Commerce-PIN`
du commerce, **ou** `X-Admin-PIN` (l'admin ouvre tous les commerces).
Accès « code équipe » = `X-Session` (jeton `equipe` de ce commerce) **ou** en repli `X-Equipe-Code` (4 chiffres d'un membre).
`X-Session`, s'il est présent, décide seul : jeton falsifié / expiré / révoqué → 401 ; valide mais hors de sa portée (autre
commerce, session équipe sur une route gérant, session commerce sur une route admin) → 403. Le PIN en en-tête reste
accepté pour la compatibilité (à déprécier quand tous les clients auront basculé).

### Jetons de session (P0-S1)

- Forme : `v1.<base64url(JSON)>.<base64url(HMAC-SHA256(SESSION_SECRET, <base64url(JSON)>))>`, contenu
  `{ jti (uuid), role, commerceId?, membreId?, nom?, vp?, exp (secondes unix) }` — `vp` (rôle `commerce` seulement) :
  version du PIN du commerce à l'émission (absente = 0, jetons émis avant son introduction). Signé, **pas chiffré** : rien
  de secret dedans (ni PIN ni code). Vérification de la signature à temps constant, puis expiration, puis révocation,
  puis (rôle `commerce`) `vp` comparé à la version courante du PIN (`meta`, clé `version_pin:<commerce>`).
- Durées : gérant et admin 8 h, équipe (caisse) 12 h. Pas de renouvellement : à l'expiration, le front redemande le PIN / code.
- Révocation : `DELETE /sessions` → mémoire du processus + table `sessions_revoquees` (migration 0005 : `jti`, `expire_le`) ;
  les révocations expirées sont supprimées au passage. Sans la table (0005 pas appliquée) : révocation en mémoire
  seulement (perdue au redémarrage — le jeton expire de toute façon), aucune erreur. Un « non révoqué » lu en base est
  gardé 5 min en mémoire (Render = 1 instance, et toute révocation passe d'abord par la mémoire).
- Membre retiré de l'équipe → sa session tombe aussitôt (le membre est relu à chaque requête).
- Changer le **PIN commerce** (`PUT /commerces/<id>/pin`) ferme aussitôt toutes les sessions `commerce` de CE commerce
  (version + 1 → `vp` périmé → 401), après un redémarrage aussi ; ni les autres commerces, ni les sessions admin ou
  équipe. Rotation dans une transaction, écritures conditionnelles : détails et limites (Supabase sans transaction
  multi-requêtes, cache mémoire à plusieurs instances) dans `docs/SECURITE.md` § 4. Limite : changer le **PIN admin**
  (`ADMIN_PIN`) ou un **code équipe** ne ferme **pas** les sessions déjà ouvertes (elles expirent en 8 h / 12 h ;
  « Verrouiller » les ferme ; rotation de `SESSION_SECRET` pour tout fermer).
- Front : le PIN / code n'est envoyé qu'à `POST /sessions` ; le jeton est gardé dans le coffre chiffré de l'onglet
  (`src/data/coffrePin.ts`). 503 / ancien serveur / réseau → repli transparent sur le PIN en en-tête, comme avant.

### Migration 0005 (révocation des sessions) — à appliquer en production

Facultative pour que tout marche (le serveur tolère son absence), nécessaire pour que « Verrouiller » survive à un
redémarrage du serveur. Supabase → **SQL Editor** → coller `supabase/migrations/0005_sessions_revoquees.sql` → **Run**
(rejouable). Vérifier : `select relname, relrowsecurity from pg_class where relname = 'sessions_revoquees';` → 1 ligne,
`true`. Annulation : `0005_sessions_revoquees.down.sql` (supprime la table ; sans effet sur les données métier).

### Accès client aux cartes (P0-S7, audit F-03)

Avant P0-S7, connaître l'identifiant d'une carte (`cl-<horodatage base36>-<4 caractères>`, prévisible) suffisait à la
lire en entier, à la modifier et à jouer à sa place ; connaître un téléphone suffisait à reprendre la carte (inscription)
et à tirer la roue à la place du client. Désormais :

- **Identifiant imprévisible** : `cl-` + UUID v4 (`nouvelIdClient`, `src/lib/fidelite.ts`), tiré **par le serveur** à la
  création. Les cartes existantes gardent leur identifiant (aucune donnée réécrite) : voir « période de grâce ».
- **Jeton client** (`Authorization: Bearer <jeton>`) : même format et même secret que les sessions
  (`v1.<base64url(JSON)>.<HMAC-SHA256(SESSION_SECRET)>`), contenu `{ typ: 'client', jti, cid (carte), com (commerce),
  ver, exp }` — jamais accepté comme session, ni l'inverse (`typ` ≠ `role`). **30 jours**, renouvelé par la page
  (`POST /cartes/:id/jeton` avec le jeton) dès qu'il reste moins de 15 jours. Rangé dans le `localStorage` du téléphone
  (`src/lib/jetonCarte.ts`, repli en mémoire si le stockage est bloqué).
- **1re preuve = le téléphone qui s'inscrit** : `POST /commerces/:id/clients` (public) renvoie le jeton de la NOUVELLE
  carte. Un contact **déjà inscrit** sans preuve → **409** « ce contact a déjà une carte ici » : ni la carte, ni son
  identifiant, ni jeton, rien de modifié, aucun doublon (compté comme échec d'accès). Limite assumée : cette réponse dit
  qu'un contact a une carte dans CE commerce — inhérent à une inscription sans code à usage unique (SMS / e-mail non
  branchés), bornée par les limites par IP / par contact et par l'anti-bruteforce.
- **Autres preuves** : **lien d'accès** à usage unique (`typ: 'lien'`, échangé par `POST /cartes/:id/jeton { lien }`) —
  au comptoir (fiche client → « Afficher le QR d'accès à sa carte », équipe ou gérant, **15 min**, journalisé) ou dans le
  message « Retrouver ma carte » (**24 h**, seulement si un prestataire SMS / e-mail est branché ; jamais renvoyé à
  l'écran du demandeur). Usage unique : son `jti` est rangé dans `sessions_revoquees` (0005) ; en plus, pendant
  l'échange, le `jti` est **réservé en mémoire** (`reserverPendant`, test et réservation synchrones) : deux échanges
  simultanés du même lien → un seul jeton, l'autre 401. **Limite** : cette réservation ne vaut que pour UNE instance
  (Render aujourd'hui) ; avec plusieurs instances, la fenêtre entre « déjà révoqué ? » et « révoquer » (allers-retours
  Supabase) reviendrait — il faudrait alors une consommation atomique en base (insertion conditionnelle du `jti`).
  Comptoir : « Générer un nouveau lien d'accès » remplace le QR affiché ; l'ancien lien n'est pas révoqué (il faudrait
  révoquer toute la carte) mais reste à usage unique et tombe à son expiration (15 min).
- **Ce que le jeton protège** (mode strict ; 401 uniforme sinon, que la carte existe ou non) : `GET /cartes/:id` en vue
  **complète** (sans jeton : vue **limitée** = tampons + jeu du jour, sans prénom, messages, historique, demandes ni
  contact) et, dans tous les modes, le **code gagnant** : depuis la roue v2 R3, servi UNIQUEMENT par
  `POST …/tirages/:tirageId/activer` au titulaire authentifié (jeton exigé même en transition), 10 minutes à la fois ;
  `jeu.codeDuJour` vaut toujours null et la réponse du tirage ne porte plus de code.
  `POST /cartes/:id/lus`, `/donnees` et `/suppression` (jeton **et** contact), `…/clients/:id/profil`, `…/rattrapage`
  (demande du client), `…/prenom`, `…/message-prive`, et **`POST …/tirages`** (le joueur est la carte du jeton ; le
  contact du corps n'est plus lu — la règle « 1 tirage par jour après visite validée » est inchangée).
- **Révocation** : version d'accès par carte dans `meta` (`acces_client:<commerce>:<client>`, absente = 0) ; tout jeton
  ou lien d'une version antérieure est refusé. `POST /cartes/:id/revocation` (le client, avec son jeton : « Déconnecter
  tous mes appareils ») et `POST /commerces/:id/clients/:id/revocation-acces` (gérant). La version est supprimée avec la
  carte (RGPD). Choisi plutôt qu'une table : pas de nouvelle table à sauvegarder (14 tables inchangées), `meta` est
  déjà sauvegardée et lisible par service_role seul.
- **Anti-bruteforce** : jeton falsifié / d'une autre carte / d'un autre commerce, lien invalide, identifiant inconnu,
  contact déjà inscrit → échec compté dans `tentatives_auth` (portée `client`, clé `client-ip:<ip>`) : **30 échecs
  sans pause de 10 min → IP bloquée** (429, 10 min doublés à chaque série, 24 h max), persistant (migration 0009).
  Compteur séparé de celui des PIN : des clients sur le wifi du restaurant ne bloquent pas la tablette du gérant.
  Jeton expiré ou révoqué : 401 sans compter (usure normale).
- **Période de grâce des anciennes cartes** : jusqu'au **10/02/2027 00:00 (Paris)** — `GRACE_ANCIENS_ID_JUSQU_AU`,
  `server/app.ts` (90 jours après le déploiement prévu le 12/11/2026 ; décaler la constante si le déploiement glisse).
  Jusque-là, l'ancien lien / QR / lien court ouvre la vue limitée **et** donne un jeton sans autre preuve (la page le
  demande seule : migration transparente au 1er accès) ; un bandeau prévient que l'ancien lien seul cessera d'ouvrir la
  carte. Après : l'ancien identifiant seul → 404 (comme une carte inconnue), plus de jeton ; un jeton obtenu avant
  reste valable jusqu'à son expiration (et se renouvelle) ; sinon lien d'accès du comptoir ou « Retrouver ma carte ».
  Les nouveaux identifiants n'ont jamais eu cette faculté. **Une ancienne carte révoquée au moins une fois** (version
  d'accès > 0, par le client ou le commerce) **perd la grâce tout de suite** : son ancien lien seul → 401 ; elle ne se
  rouvre que par un lien d'accès (comptoir, « Retrouver ma carte ») — sinon la révocation se contournerait en
  rechargeant la page.
- **Liens courts** `/c/<id>` (SMS de relance) : redirection inchangée vers `#/carte/<id>` (vue limitée sans jeton) ;
  `/c/<id>?a=<lien d'accès>` (SMS « Retrouver ma carte ») → `#/carte/<id>?acces=<lien>`, échangé puis retiré de l'adresse.
- **Modes** (`AUTH_CLIENT`) : `stricte` en production (imposé : `transition` y est refusé au démarrage) ; `transition` = tout ce qui précède est émis et un jeton présent
  est toujours vérifié, mais l'accès d'avant P0-S7 reste admis (lien seul = vue complète, contact seul = tirage, contact
  existant = carte renvoyée **sans** jeton). Utile le temps d'un déploiement (anciens fronts en cache) ; les appels sans
  jeton sont comptés : `GET /api/v1/sante/acces-client` → `{ mode, jetons, migration, graceAnciensLiensJusquAu,
  accesSansJeton }` (route à part : le contenu de `/sante` est figé). Les tests historiques tournent dans ce mode.
  **Résiduel P0-S19 (revue Codex, points 1–2) :** en transition, un contact seul suffit encore à obtenir des codes —
  `POST /cartes/:id/donnees` (export RGPD, contact seul) liste les codes de tous les tirages du client (depuis R3,
  `POST …/tirages` n'en renvoie plus ; et la remise exige de toute façon l'activation par le titulaire). En production le mode est toujours `stricte` (`SESSION_SECRET`
  obligatoire) : ces deux routes y exigent le jeton, et aucun code ne sort sans authentification.

### Migration 0009 (portée « client » de l'anti-bruteforce, P0-S7) — à appliquer en production

**Avant toute migration : une sauvegarde.** `node --env-file=.env scripts/sauvegarde-base.mjs` (voir « Sauvegarde /
export » et `docs/SAUVEGARDE.md`) — à lancer par l'opérateur, jamais par un lot automatique.
Puis Supabase → **SQL Editor** → coller `supabase/migrations/0009_auth_client.sql` → **Run** (rejouable). Elle élargit la
contrainte `portee` de `tentatives_auth` (0006) à `'client'` et crée le marqueur `auth_client_active()` (lecture seule,
service_role seul). Aucune table, aucune donnée client. Vérifier : `GET /api/v1/sante/acces-client` → `migration: true`.
Sans elle, tout marche, mais les échecs d'accès client sont comptés **en mémoire seulement** (perdus au redémarrage ;
avertissement `[securite]` dans les journaux). Annulation : `0009_auth_client.down.sql` (retire les seuls compteurs
de portée `client`, remet la contrainte d'origine, garde les versions d'accès).

### Migration 0010 (compteurs publics persistants, P0-S20) — à appliquer en production

**Avant toute migration : une sauvegarde.** `node --env-file=.env scripts/sauvegarde-base.mjs` (voir « Sauvegarde /
export » et `docs/SAUVEGARDE.md`) — à lancer par l'opérateur, jamais par un lot automatique. **Ne pas appliquer sans
cette sauvegarde : la procédure a été testée sur Postgres local (PGlite, `tests/migration-pglite.test.ts`), pas sur la
base de production — aucune migration n'est appliquée par ce lot, ni en production, ni ailleurs.**
Puis Supabase → **SQL Editor** → coller `supabase/migrations/0010_compteurs_publics.sql` → **Run** (rejouable). Elle
crée la table `compteurs_publics` (`cle`, `debut`, `n` ; RLS activée, seul `service_role` y a droit ; la clé reprend
l'identifiant déjà utilisé par l'anti-bruteforce — IP, contact, identifiant de carte — sans nom ni contenu client).
Vérifier : `select count(*) from public.compteurs_publics;` → 0 ligne, sans erreur (et les logs Render ne montrent
plus l'avertissement `[securite] compteurs publics comptés en mémoire seulement` au démarrage). Sans elle, tout
marche, mais les compteurs des routes publiques sont **en mémoire seulement** (perdus au redémarrage ; avertissement
`[securite]` dès le démarrage). La sauvegarde exigée avant la migration n'échoue pas pour autant : `compteurs_publics`
est une table **optionnelle** de la sauvegarde (compteurs éphémères d'une minute) — exportée vide tant que la migration
n'est pas appliquée, et un ancien export à 14 tables se restaure sans elle. Annulation :
`0010_compteurs_publics.down.sql` (supprime la table : les compteurs en cours sont perdus — ce ne sont que des
fenêtres d'une minute — sans effet sur les données métier). La sauvegarde couvre désormais **15 tables** (la 0010
ajoute `compteurs_publics` aux 14 de P0-S5).

### Migration 0003 (modules caisse / points / équipe / messages / menu) — à appliquer en production

La base Supabase en ligne ne se met pas à jour toute seule. Depuis P0-S11, **le serveur refuse de démarrer** en Supabase
tant que `0003_cartiz.sql` (journal d'audit) ou `0004_programme.sql` (traces du programme) n'est pas exécutée : message
explicite nommant la migration (voir « Atomicité (P0-S11) »). Sauvegarde d'abord (`node --env-file=.env
scripts/sauvegarde-base.mjs`). À faire une fois, dans l'ordre :
1. supabase.com → projet **asian-home-fidelite** → **SQL Editor** → *New query* ;
2. coller tout le contenu de `supabase/migrations/0003_cartiz.sql` → **Run** (rejouable : sans risque si exécuté deux fois) ;
3. vérifier : `select relname, relrowsecurity from pg_class where relname in ('equipe','journal','menus');` → 3 lignes, `true` ;
4. aucune redéploiement Render nécessaire (le code est déjà en ligne) ; tester `#/equipe` puis la caisse.

Exemple :

```bash
curl -s -X POST localhost:3001/api/v1/commerces -H 'X-Admin-PIN: 000000' -H 'Content-Type: application/json' \
  -d '{"nom":"Chez Lin","type":"restaurant","pin":"4321"}'
curl -s -X POST localhost:3001/api/v1/commerces/c-asian-home-paris/tirages -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <jeton reçu à l’inscription>' -d '{}'   # → 409 tant que la visite du jour n'est pas validée
                                                                    #   (sans jeton : 401 en mode strict)
```

## Atomicité (P0-S11, audit F-10)

**SQLite** : rien à faire, rien de changé. `transaction` = `BEGIN IMMEDIATE … COMMIT` (tout ou rien), et les
transactions passent une par une (file d'attente, `server/stockage.ts`) : aucune autre requête ne s'intercale.

**Supabase** : PostgREST n'offre **pas** de transaction sur plusieurs requêtes HTTP. `transaction` y garde seulement les
versions lues (une carte par requête) ; chaque écriture est atomique à elle seule, et les écritures sensibles sont
protégées par la base elle-même :

| Écriture | Protection | Effet d'un conflit |
| --- | --- | --- |
| Réglages du commerce (PATCH), logo (PUT / DELETE) — **nouveau P0-S11** | verrou optimiste : commerce relu DANS la transaction, `UPDATE … WHERE id = ? AND version = <lue>` | 0 ligne → 409 « Modification simultanée : réessayez. » ; rien n'est écrasé en silence |
| Visite, récompense, caisse, avis | même verrou optimiste (clients, avis) | 409 « réessayez », aucun tampon perdu ni compté deux fois |
| Inscription | contrainte unique `(commerce_id, cle_contact)` | le 2e INSERT est refusé, le serveur relit le client existant |
| Tirage | index unique `(commerce_id, client_id, jour à Paris)` | 2e tirage du jour refusé (409) |
| Remise d'un gain | `UPDATE … WHERE donnees->remis IS NULL AND donnees->>activeLe > (écriture − 10 min)` | 2e remise refusée (409 « déjà remis ») ; fenêtre échue entre lecture et écriture → 409 |
| Caisse (file hors ligne) | `actionId` idempotent mémorisé dans le client | un rejeu répond `dejaTraite`, rien n'est recompté |

`version` est incrémentée par le trigger `incrementer_version` (0001, recréé par la 0003 pour la base live qui ne
l'avait pas). Hors `transaction`, ou si la ligne n'a pas été relue dedans, `majCommerce` / `majClient` / `majAvis`
écrivent sans condition (comportement d'avant) : les routes relisent donc la ligne dans la transaction.

**Ordre d'écriture : métier, puis journal.** Le fait (client, commerce, parrain) est écrit d'abord ; l'entrée de journal
et les traces d'audit ensuite. Pourquoi : une interruption entre les deux peut **perdre une entrée de journal**, mais
jamais créer un journal mensonger (action tracée mais pas faite) ni compter deux fois. P0-S11 a remis dans cet ordre
les trois routes qui ne le respectaient pas : le parrainage (parrain + journal + trace étaient écrits AVANT le filleul :
un conflit sur le filleul laissait le parrain crédité, et un nouvel essai pouvait le créditer une 2e fois), la caisse
(journal « parrainage ») et la décision de rattrapage (journal écrit avant le client).

**Reprise du crédit parrain (revue Codex P0-S11).** Le filleul étant écrit d'abord (`parrainagePaye: true`), un 409 sur
le parrain ne pouvait plus être réparé par un nouvel essai (la caisse répond `dejaTraite`, le rattrapage est déjà
traité) : deux premières visites simultanées de deux filleuls du même parrain perdaient un crédit. `ecrire()` réessaie
donc **une fois** le crédit du parrain sur `ErreurConflit` : parrain relu frais dans la même transaction, parrainage
recalculé (plafond annuel compris), puis crédit + journal + trace réécrits. Seul le 409 du crédit parrain est repris ;
journal et trace ne sont jamais rejoués après un crédit réussi. Parrain disparu entre-temps → erreur d'origine ; plafond
atteint entre-temps → pas de crédit, trace écrite avec `pointsParrain: 0`. `ecrire()` renvoie le texte FINAL du journal
du passage (revue Codex, 2e passe) : si la reprise recalcule le crédit (plafond atteint entre-temps), le journal dit
ce qui a vraiment été crédité, pas le calcul initial. **Fenêtre résiduelle** : deux conflits successifs sur la ligne
du parrain dans la même requête → l'erreur remonte : filleul marqué payé, crédit parrain perdu, visible par le 409
renvoyé à l'opérateur (à corriger à la main sur la fiche du parrain).

**Logo refusé : image restaurée (revue Codex P0-S11, 2e passe).** Chaque envoi écrit un blob immuable
`logo:<id>:<version>` en plus du pointeur `logo:<id>` : l'adresse `?v=<version>` retrouve toujours ses propres
octets, même si un autre envoi a écrasé le pointeur entre-temps. Le PUT prend un instantané du logo avant d'écrire
et, en cas d'échec, remet le pointeur sur l'image que l'adresse désigne (l'ancienne si un PATCH a gagné, celle du
PUT gagnant sinon, lue dans son blob versionné) ; son propre blob est supprimé au mieux s'il n'est désigné par
aucune adresse ; l'erreur d'origine est toujours celle renvoyée. Le DELETE ne vide le pointeur que s'il contient
encore l'image que ce DELETE a remplacée (adresse lue DANS la transaction) et ne supprime le blob correspondant
que si l'adresse courante ne le désigne plus. Le GET sans version sert le pointeur, ou à défaut l'image désignée
par la fiche du commerce — un pointeur effacé par une suppression arrivée entre-temps ne casse plus l'adresse
gagnante. Une vieille adresse `?v=` ne sert plus les octets d'un nouvel envoi : 404, pas une mauvaise image.
**Fenêtres résiduelles** : la suppression d'un blob orphelin reste une vérification-puis-écriture (un envoi des
mêmes octets qui gagnerait exactement entre les deux laisserait une adresse sans blob, réparable par un nouvel
envoi) ; les blobs remplacés restent en `meta` tant qu'aucun nouvel envoi ne les nettoie (une ligne par ancien logo).

**Garde au démarrage.** Sous Supabase, `creerServeur` refuse de démarrer si la migration `0003_cartiz.sql` (journal)
ou `0004_programme.sql` (parrainages, demandes de rattrapage) manque — erreur explicite nommant la migration et la
sauvegarde. `ajouterJournal`, `ajouterParrainage` et `ajouterDemandeRattrapage` ne masquent plus leur absence
(`ErreurMigrationManquante` remonte, plus de `console.warn` qui continue). Les migrations 0005 à 0009 gardent leur repli
documenté (mémoire, lecture vide, 503). SQLite crée tout son schéma : pas de garde.

**Aucune migration pour ce lot** : colonne `version` + trigger (0001), table `journal` (0003), index unique des tirages
(0001) existent déjà. **Avant toute migration** (ici : appliquer la 0003 / 0004 si ce n'est pas fait), une sauvegarde
par l'opérateur : `node --env-file=.env scripts/sauvegarde-base.mjs` (ou `npm run sauvegarde`, aide : `--aide`,
procédure : `docs/SAUVEGARDE.md`). Jamais lancée par un lot automatique contre la production.

**Ce qui reste NON atomique (compensation, pas transaction).**
- Une suite d'écritures interrompue entre deux requêtes HTTP (panne réseau, crash Render) n'est pas annulée : ex. le
  PATCH d'un commerce enregistre les réglages puis échoue sur un des avis réévalués ; un parrain peut ne pas être
  crédité si l'écriture du filleul a réussi juste avant la panne ; le logo (fichier puis adresse) garde l'ancien affiché.
- **Journal en panne après écriture métier (revue Codex, 2e passe — non corrigé).** L'erreur remonte (plus de silence),
  mais rien n'est restauré : une caisse rejouée répond `dejaTraite` sans recréer la trace, une visite historique
  rejouée peut ajouter un 2e tampon. Le corriger demande un journal rejouable / une boîte d'envoi durable — nouveau lot,
  pas une compensation.
- **PATCH réglages + avis partiels (revue Codex, 2e passe — non corrigé).** Le commerce est écrit avant les avis, dans
  la même `transaction` (atomique sous SQLite, pas sous Supabase) : un conflit sur un avis laisse les nouveaux réglages
  et les premiers avis modifiés, puis 409. Même remède que ci-dessus (reprise durable), hors périmètre du lot.
- Compensation choisie : ordre métier-puis-journal, verrous optimistes, contraintes uniques, `actionId` idempotent.
- Écartée : une fonction RPC transactionnelle générique. Elle réécrirait toute la logique métier (programme,
  parrainage, niveaux…) en PL/pgSQL — double implémentation, risque de divergence avec `src/lib/` — pour un gain nul sur
  les conflits réellement observés (simultanéité), déjà tranchés par la base.
- Hors périmètre : la route visite historique (`POST /clients/:id/visite`) n'a pas de garde « 1 tampon par jour »
  (audit F-11, lot P1-S12). Deux visites **séquentielles** le même jour restent possibles ; seule la **simultanéité**
  est tranchée par le verrou optimiste.

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

**Routes publiques** — compteurs par fenêtre fixe d'une minute (P0-S20 : **persistants**, voir ci-dessous) ; au-delà :
429 + `Retry-After` (secondes). Seuils dans `LIMITES_PUBLIQUES` (`server/app.ts`) :

| Seuil | Valeur / min | Routes | Pourquoi cette valeur |
|---|---|---|---|
| `lectureParIp` | 120 | `GET /cartes/:id`, `POST /cartes/:id/lus`, `GET /commerces`, `GET /commerces/:id`, `GET /commerces/:id/menu` | plusieurs clients sur le wifi du restaurant (même IP), pages qui se rafraîchissent |
| `lectureParCarte` | 30 | `GET /cartes/:id` + `POST /cartes/:id/lus` | la page de jeu en attente de validation vérifie le statut toutes les 10 s (6 / min, `INTERVALLE_VERIFICATION_MS`, `src/lib/attenteVisite.ts`) ; la carte publique, elle, se recharge au montage et au retour au premier plan, pas périodiquement ; marge ×5 sur le pire cas |
| `inscriptionParIp` | 10 | `POST /commerces/:id/clients` sans PIN | une tablée qui s'inscrit d'un coup ; bloque l'inscription en masse |
| `inscriptionParContact` | 5 | idem, par numéro / e-mail normalisé dans ce commerce | une personne ne s'inscrit qu'une fois ; freine l'énumération (F-12) |
| `tirageParIp` | 20 | `POST /commerces/:id/tirages` | 1 tirage / jour / client ; laisse une salle pleine jouer |
| `tirageParContact` | 5 | idem, par contact | réessais légitimes (réseau), pas plus |
| `ficheClientParIp` | 10 | `POST …/clients/:id/profil`, `POST …/clients/:id/rattrapage` (demande du client), `POST …/clients/:id/prenom` (P1-C1), `POST …/clients/:id/message-prive` (P1-C4, par IP **et** par carte) ; P1-B6 : `POST /cartes/:id/donnees` et `…/suppression` (par IP **et** par carte) ; P1-C3 : `POST /cartes/retrouver` (par IP) | rares par nature |
| `sessionParIp` | 30 | `POST /sessions` | borne le coût scrypt ; toute l'équipe ouvre sa session depuis le même wifi en début de service |
| `evenementParIp` | 30 | `POST /commerces/:id/evenements` (P2-Q3) | une page de jeu en envoie 1 ou 2 ; au-delà, l'événement n'est simplement pas compté |

Les routes authentifiées (gérant, caisse, admin) ne sont **pas** limitées : la file hors ligne de la caisse doit pouvoir
tout rejouer d'un coup. L'IP est celle de `X-Forwarded-For` derrière Render (`TRUST_PROXY`) ; si Render ne réécrit pas
cet en-tête, un attaquant peut la falsifier (non vérifié, audit F-06) : les compteurs par carte, par contact et par
cible tiennent quand même.

**Journal des lectures sensibles (P2-S15)** — un échantillon des lectures `GET /cartes/:id` et
`GET /commerces` (liste) est journalisé (stdout, `console.info`, préfixe `[lecture-sensible]`) pour détecter
une énumération (F-12) :

| Ligne | Quand |
|---|---|
| `[lecture-sensible] carte id=<empreinte> ip=… statut=…` | chaque lecture de carte échantillonnée (200, 401, 404, 429…) |
| `[lecture-sensible] commerces ip=… statut=… nb=…` | chaque lecture de la liste des commerces échantillonnée |

- **Échantillonnage (volume)** : `journalLectures: { taux }` dans `creerServeur` (défaut **0,1** : 1 lecture
  sur 10) ; 0 = rien, 1 = tout (tests) ; un taux non fini (`NaN`) retombe sur le défaut. À 0,1, une rafale
  de 100 sondages laisse ~10 lignes — assez pour la détecter, sans noyer les logs en trafic normal (la page
  de jeu en attente de validation vérifie le statut toutes les 10 s : 6 lectures/min → ~0,6 ligne/min à 0,1 ;
  la carte publique se recharge au montage et au retour au premier plan, pas périodiquement).
  En moyenne, moins d'1 ligne/min par carte active.
  **Plafond : 600 lignes/min** (option `plafond`) — au-delà, les lignes sont comptées puis résumées en une
  seule ligne à la minute suivante (`plafond … lignes/min atteint : N ligne(s) supprimée(s)`) : l'attaque
  reste visible par son volume. Pour enquêter sur une attaque en cours, monter le taux (redéploiement) ou
  s'appuyer sur les lignes `[securite] BLOCAGE` (non échantillonnées ; les 429, elles, ne sont pas
  journalisées systématiquement).
- **Détection** : dans les logs Render, chercher beaucoup d'`id=` distincts depuis une même `ip=` sur une
  courte période, et/ou une majorité de `statut=404` (sondage d'identifiants inexistants) — un client
  légitime relit toujours la MÊME carte (même empreinte) et obtient 200. Exemple de rafale : 20
  identifiants distincts, 20 × 404, même IP (test `tests/journal-lectures-p2-s15.test.ts`).
- **Vie privée** : l'identifiant de carte n'est JAMAIS écrit en clair dans ces lignes — empreinte SHA-256
  tronquée à 12 car. hex. (48 bits : assez pour compter les identifiants distincts). C'est une
  **pseudonymisation, pas une anonymisation** : le hash sans sel permet de vérifier des identifiants
  candidats (notamment les anciens identifiants prévisibles) — il ne révèle rien à qui ne connaît pas
  l'identifiant, mais ne résiste pas à une recherche par dictionnaire (un HMAC avec secret dédié serait
  l'étape suivante si cette résistance devenait requise). Les identifiants sont aussi masqués dans les
  logs d'erreur internes (`console.error`, chemins `/cartes/…`, `/desinscription/…`, `/clients/…`). Seule
  l'IP est en clair (nécessaire pour l'enquête, comme dans les lignes `[securite]`). Aucun prénom, contact,
  code gagnant ni contenu client dans ces lignes.
- **Limites honnêtes** : l'échantillonnage est aléatoire par lecture (`Math.random`) — une rafale de moins
  de ~30 sondages peut ne laisser aucune ligne à 0,1 ; les lectures réussies d'un client légitime sont
  échantillonnées comme les autres (pas de distinction succès/échec). Les journaux Render Free ont une
  rétention limitée : en cas d'incident, exporter les logs vite.

**Persistance des compteurs publics (P0-S20, migration 0010)** — la limitation reste appliquée **en mémoire** (aucune
latence ajoutée à la requête) ; un compteur n'est écrit en base qu'à partir de la **moitié de son seuil**
(`SEUIL_PERSISTANCE_COMPTEURS = 1/2`, `server/app.ts`), en arrière-plan, sans jamais bloquer la requête. En trafic
normal : **zéro écriture** — la page de jeu en attente vérifie le statut toutes les 10 s (6 lectures/min),
sous la moitié du seuil de 30 (`lectureParCarte`, 15) ; les écrans commerçant rechargent l'état toutes les
30 s via le store (2 lectures/min sur `GET …/etat`, autre compteur). Une ligne = 73 à 92 octets de JSON (mesuré, clé + horodatage + nombre) ; un compteur chaud
ou bloqué, lui, survit à un redémarrage ou un réveil Render (rechargé au démarrage, fenêtres passées ignorées). Les
écritures par clé et par fenêtre sont **bornées** : le compteur sature à son seuil (une requête déjà bloquée ne
ré-écrit pas — au plus `seuil − seuil/2 + 1` écritures par clé et par minute) et **sérialisées par clé** (une écriture
ancienne ne peut pas écraser un blocage plus récent). Les lignes dont la fenêtre est passée sont supprimées à chaque
écriture et au démarrage. La clé reprend l'identifiant déjà utilisé par l'anti-bruteforce (`tentatives_auth`, 0006) :
IP, contact normalisé (téléphone ou e-mail en clair), identifiant de carte — sans nom, sans code gagnant, sans contenu
client. **Limites honnêtes :** une seule instance (Render aujourd'hui) — à plusieurs instances, chaque instance
garderait ses propres compteurs en mémoire et la base ne servirait qu'au redémarrage, pas à la limitation distribuée,
et l'écriture d'une autre instance peut encore ramener un compteur en arrière. Table absente (0010 pas appliquée) ou
base indisponible : comptage **en mémoire** (perdu au redémarrage), avec un avertissement `[securite]` **dès le
démarrage**, jamais de 500. La persistance en base a été préférée à la documentation seule parce que le coût mesuré est
négligeable en trafic normal (zéro écriture) et borné en attaque (voir la borne ci-dessus, la 429 arrêtant ensuite le
compteur).

### Logs structurés et alertes (P2-Q6)

**Une ligne JSON par réponse terminée** (`server/logs.ts`, `journaliserRequete`, branché au centre du gestionnaire
HTTP — `res.on('finish')`, donc une ligne par réponse envoyée, quel que soit le chemin de sortie : succès, erreur,
304, redirection, page statique). Une connexion interrompue avant la fin de la réponse ne produit aucune ligne
(son statut serait inconnu). Émise sur stdout (`console.info`, comme les lignes `[securite]` et
`[lecture-sensible]`) :

```json
{"type":"requete","niveau":"info","horodatage":"2026-11-11T13:00:00.000Z","methode":"GET","route":"/api/v1/sante","statut":200,"dureeMs":3,"ip":"127.0.0.1"}
```

| Champ | Contenu |
|---|---|
| `type` | Toujours `"requete"` (distingue ces lignes des futures lignes structurées). |
| `niveau` | `"info"` (statut < 400), `"avertissement"` (4xx), `"erreur"` (5xx). |
| `horodatage` | ISO 8601, horloge réelle du serveur (pas l'horloge injectable des tests). |
| `methode`, `route` | Méthode HTTP ; chemin **masqué** (voir ci-dessous), sans requête. |
| `statut` | Statut HTTP envoyé. |
| `dureeMs` | Millisecondes entre la réception de la requête et l'envoi de la réponse (entier ≥ 0). |
| `ip` | IP vue par le serveur (déjà journalisée par les lignes `[securite]`, nécessaire pour enquêter sur une rafale). |

**Ce qui n'y figure jamais** : aucun secret, PIN, jeton, téléphone ou e-mail brut, aucun identifiant de carte
ou de client brut, aucun code gagnant, aucun en-tête ni corps. La requête (`?…`) est jetée : elle peut porter
un jeton d'accès (`?acces=…`) ou un contact (`?q=…`). Dans le chemin, seuls restent en clair les mots
littéraux des routes (relevés du routeur : `sante`, `commerces`, `cartes`, `clients`, `caisse`, `gains`, …)
et l'identifiant d'un commerce CONNU du serveur (ensemble chargé au démarrage, après la création du commerce
seed, et complété à chaque création de commerce), mais seulement à sa place (après `commerces`, `r` ou
`menu`) : un préfixe `c-…` ne prouve pas qu'un segment est un commerce public (un e-mail forgé
`c-alice@example.com` dans un chemin 404 est masqué). Tout autre segment est remplacé par son empreinte SHA-256 tronquée (12 car. hex., même
procédé que P2-S15) : identifiant de carte ou de client, jeton, code gagnant — et n'importe quel segment
inconnu (téléphone, e-mail, secret glissé dans un chemin 404 forgé). La liste blanche échoue en sécurité :
oublier un mot littéral ne fait que rendre une ligne moins lisible, jamais fuiter. Le chemin est normalisé
comme le routeur avant d'être masqué (segments vides supprimés, décodage par segment) : un nom encodé
(`/api/v1/%63artes/<id>`) ou un segment vide (`/api/v1/cartes//<id>`) ne contourne pas le masquage. La
journalisation ne fait jamais échouer une requête (écriture en `try/catch`, comme P2-S15) : l'IP est lue à
la réception, quand le socket existe encore — au moment de `finish`, il peut déjà être détruit (corps
abandonné après une 413, par exemple) et `req.socket` vaut `null` (`ipDe` se replie alors sur `'?'`).

**Volume.** Une ligne par réponse, petite (environ 150 à 220 octets — une ligne caisse représentative atteint
207 octets) : de l'ordre de quelques milliers de lignes par jour pour un restaurant, davantage si plusieurs
pages restent ouvertes (le store recharge toutes les 30 s, soit une requête par page ouverte). Sans
échantillonnage — en trafic normal, un 500 n'est pas manqué par un tirage au sort. (Le journal
`[lecture-sensible]`, lui, reste échantillonné à 0,1 : il sert à détecter une énumération, pas à compter
les erreurs.)

**Lire les logs.** En local : stdout du serveur. En production : dashboard Render → service → **Logs**.
La rétention dépend du forfait du workspace : **7 jours en Hobby (l'offre gratuite)**, 14 jours en Pro,
30 jours en Scale / Enterprise — et Render supprime les lignes au-delà de **6 000 lignes/minute/instance**
([docs Render](https://render.com/docs/logging), vérifié le 11/11/2026). En cas d'incident, exporter les logs
vite ; sous une rafale au-delà de 6 000 lignes/min, des lignes peuvent manquer. Exemples (`jq`, une ligne
JSON par ligne) — attention, stdout mélange les lignes JSON et les lignes texte (`[securite]`,
`[lecture-sensible]`, `[serveur]`) : ne garder que les lignes JSON avant `jq`, sinon `jq` échoue sur la
première ligne texte :

```sh
# Toutes les erreurs 5xx, les plus récentes d'abord
grep '^{' logs.txt | jq -s -c 'sort_by(.horodatage) | reverse | .[] | select(.niveau == "erreur")'
# 429 par IP sur la dernière heure (rafale ?)
grep '^{' logs.txt | jq -r 'select(.statut == 429 and .horodatage > (now - 3600 | todate)) | .ip' | sort | uniq -c | sort -rn | head
# 401 sur /sessions par IP (tentatives de PIN)
grep '^{' logs.txt | jq -r 'select(.statut == 401 and .route == "/api/v1/sessions") | .ip' | sort | uniq -c | sort -rn | head
# Requêtes les plus lentes
grep '^{' logs.txt | jq -s 'sort_by(-.dureeMs) | .[0:10] | .[] | "\(.dureeMs)ms \(.methode) \(.route) \(.statut)"'
```

**Alertes à surveiller.** Lot P2-Q6 : logs + procédure ci-dessous. Depuis l'item E (12/11/2026), une
**alerte e-mail sur rafale de 5xx** existe, désactivée tant que `ALERTE_EMAIL` n'est pas définie (voir
le paragraphe suivant) ; aucun autre canal (SMS, webhook, PagerDuty) n'est branché. Une 500 réelle émet
une ligne de niveau `erreur` (`tests/logs-structures-p2-q6.test.ts`, « émission simulée »). Le critère
AUDIT.md « alerte reçue sur staging lors d'un 500 provoqué » reste non vérifié en conditions réelles : pas
de staging (`docs/DEPLOIEMENT.md` §6) et Brevo en mode test.

**Alerte e-mail sur rafale de 5xx (item E, `server/alertes.ts`).** Alimentée au même point d'accroche que
les logs JSON (`res.on('finish')`, juste après `journaliserRequete`, sans changer le format des lignes).
- **Seuil** : plus de 10 réponses 5xx (donc à la 11e) dans une **fenêtre glissante de 15 minutes**.
- **Plafond** : au plus **1 alerte livrée par heure** (livrée = envoi accepté par le prestataire, y compris
  en mode test), compté à partir de la livraison ; le compteur continue, seul l'envoi est plafonné. Après
  une heure, une rafale toujours au-dessus du seuil redéclenche une alerte.
- **Reprise après échec** : un envoi refusé par le prestataire (ou délai dépassé), ou impossible faute de
  prestataire, ne consomme pas le plafond : nouvelle tentative possible **5 minutes** plus tard
  (`DELAI_REPRISE_ALERTE_5XX_MS`) si le seuil est toujours dépassé. Une seule tentative à la fois ; une
  ligne `[alerte-5xx]` par tentative (une rafale instantanée n'en produit donc qu'une).
- **Destinataire** : `ALERTE_EMAIL`. Absente ou vide = module inactif (aucun compteur, aucun envoi).
- **Envoi** : adaptateur e-mail existant (Brevo, expéditeur `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME`,
  délai 10 s de `server/notifications/delai.ts`), en tâche de fond : la réponse HTTP en cours n'attend
  jamais l'envoi et une erreur d'envoi ne la fait jamais échouer.
- **Contenu** : nombre de 5xx dans la fenêtre, bornes de la fenêtre (UTC), les 5 routes les plus touchées
  (chemins **masqués** comme dans les logs : `routeMasquee`), horodatage. Jamais de corps, d'en-tête, de
  requête `?…` ni d'identifiant brut.
- **Mode test** (`BREVO_MODE_TEST=1`) : même chemin que les relances — e-mail en sandbox Brevo
  (`X-Sib-Sandbox: drop`, rien livré) — et une ligne `[alerte-5xx] mode test : alerte simulée, rien
  envoyé (…)`. Sans prestataire e-mail configuré : ligne `[alerte-5xx] alerte non envoyée (aucun
  prestataire e-mail configuré)`, aucune exception. Envoi réel : `[alerte-5xx] alerte envoyée (…)` ;
  refus ou délai dépassé : `[alerte-5xx] alerte non envoyée : <raison>`. L'adresse du destinataire n'est
  jamais écrite dans les logs.
- **Limites** : compteur en mémoire, par instance (remis à zéro au redémarrage / réveil Render) ; borné à
  5 000 erreurs mémorisées.
- Tests : `tests/alertes-5xx-ameliorations.test.ts`, `tests/revue-codex-nov12-alertes.test.ts` (reprise).

| Signal | Ce que ça veut dire | Que faire |
|---|---|---|
| `niveau: "erreur"` (5xx), même une seule ligne | Bug serveur (exception non HTTP, base en panne, migration manquante…) | Noter `horodatage` + `route`, reproduire en local / staging, corriger ; une 5xx sur `POST …/tirages` ou `POST …/caisse/passage` est prioritaire (un client au comptoir). |
| Beaucoup de `statut: 429` depuis une même `ip` en quelques minutes | Rafale : attaque, ou un client légitime qui martèle (page restée ouverte, boucle) | Croiser avec les lignes `[securite] BLOCAGE` (même IP ?) ; si c'est le wifi du restaurant, vérifier qu'aucun commerçant n'est bloqué par ses propres erreurs de PIN (le blocage se lève seul, 10 min doublées à chaque série, 24 h max). |
| Beaucoup de `statut: 401` sur `/api/v1/sessions` depuis une même `ip` | Tentatives de PIN / code (brute-force) | Croiser avec `[securite] échec …` / `BLOCAGE` ; rien à faire si le blocage tient (c'est son rôle) ; si un commerçant légitime est bloqué, attendre la fin du blocage (ou le lever en base, voir « Migration 0006 »). |
| Beaucoup de `statut: 401` sur `/api/v1/cartes/<empreinte>` depuis une même `ip` | Tentatives d'accès à des cartes (jetons falsifiés, liens expirés) | Croiser avec `[lecture-sensible]` (beaucoup d'empreintes distinctes + 404 = sondage, P2-S15) ; en mode `stricte`, c'est le comportement attendu (401 uniforme). |
| Beaucoup de `statut: 404` sur `/api/v1/cartes/<empreinte>` | Sondage d'identifiants (énumération F-12) | Voir « Journal des lectures sensibles » (détection par empreintes distinctes + 404 depuis une même IP). |
| `dureeMs` élevé (> 1 000 ms) sur une route, répété | Lenteur (base, Supabase, réveil Render) | Vérifier si c'est le premier appel après une veille Render (~1 min, normal en Free) ou une lenteur durable (dashboard Supabase, taille de base). |

**Routine recommandée (pas une automatisation).** À chaque signalement d'incident (« ça ne marche pas »,
« je suis bloqué ») : ouvrir les logs Render sur la fenêtre du signalement et filtrer `niveau == "erreur"`
puis `statut == 429` / `401` pour l'IP concernée. Une fois par semaine : un coup d'œil aux 5xx (une seule
ligne suffit à justifier une correction). **Ce qui n'est pas branché** : aucune alerte automatique autre
que l'e-mail sur rafale de 5xx (ci-dessus, inactif sans `ALERTE_EMAIL`), aucun transfert des logs hors
Render, aucune rétention longue — les logs Render Free sont éphémères ; une alerte sur une 500 isolée ou
un webhook sur blocage resteraient à brancher sur ces lignes, sans toucher à leur format.

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
| `sw.js`, `manifest.webmanifest` (PWA, P1-C3) | `no-cache` (un nouveau service worker est pris au prochain chargement) |
| autres fichiers (`/visuels/*.jpg`…) | `public, max-age=3600` |
| `robots.txt`, `sitemap.xml` (`application/xml`), `favicon.ico` (P2-Q4, `docs/SEO.md`) | `public, max-age=3600` (comme les autres fichiers ; absents, ces adresses renvoyaient `index.html`) |

Tous les fichiers statiques ont un `ETag` faible (taille + date de modification) : `If-None-Match` correspondant → 304.

### Compression des réponses (P2-Q2)

Le serveur compresse lui-même ses réponses (`server/app.ts`, `preparerCorps` / `envoyerCorps`, `node:zlib`) — il ne
dépend pas du proxy Render (non vérifié) :

- **Codages** : brotli (qualité 5, préféré à qualité égale) ou gzip (niveau 6), selon `Accept-Encoding` (RFC 9110 :
  l'explicite prime sur le joker `*`, `q=0` = refusé, `q>1` ramené à 1, casse ignorée). Sans `Accept-Encoding`
  (service worker hors ligne, `fetch` des tests) : réponse d'identité.
- **Seuil** : 1 024 octets — en dessous, la compression coûte plus qu'elle ne rapporte (en-têtes + CPU).
  **Types compressibles seulement** : texte (`text/*`, `application/json`, `application/manifest+json`,
  `application/xml`, `image/svg+xml`) — images et polices déjà compressées ne le sont pas.
- **Cache** : les variantes compressées des **fichiers statiques** sont gardées en mémoire (clé = chemin absolu +
  ETag, 128 entrées max, vidage complet au-delà — un déploiement ≈ 25 fichiers) ; les réponses **JSON / CSV** sont
  recompressées à chaque fois (corps différent à chaque requête).
- **`Vary: Accept-Encoding`** ajouté (fusionné avec `Vary: Origin` du CORS, jamais remplacé) ; `Content-Encoding`
  et `Content-Length` (du corps compressé) sont posés. Testé : `tests/compression-p2-q2.test.ts` (choix du codage,
  seuil, types, cache, `Vary`).
- **Portée** : la compression réduit le flux **serveur → navigateur**, pas l'egress Supabase → serveur (voir
  « Egress — mesuré ») : c'est le volume PostgREST qui compte pour les 5 Go gratuits.

### Page menu prérendue et lien court QR (hors `/api`)

| Méthode et chemin | Accès | Effet |
|---|---|---|
| `GET /r/:commerceId` | public | **P2-Q3.** Lien court du QR vitrine → 302 vers `/?via=qr#/jouer/<id>`. Le scan est compté **avant** la redirection (compteur anonyme `scan`, migration 0008), même si la page de jeu ne se charge jamais. Commerce inconnu ou en pause : redirection sans compteur. Limite par IP (dépassée : redirection sans comptage, jamais d'erreur). HEAD : sonde, pas comptée. `?via=qr` dit à la page de ne pas re-signaler le scan (sinon double comptage). |
| `GET /menu/:commerceId` | public | **P2-Q4.** Page menu prérendue (HTML statique, `server/prerendu.ts`) : titre, description, canonical et Open Graph propres à la page, JSON-LD `Menu` (`MenuSection` / `MenuItem`, prix en EUR), plats, descriptions, prix (« Prix sur place » si non confirmé) et allergènes. Cache 5 min (`public, max-age=300`, ETag faible → 304). Commerce en pause → page « Menu indisponible » (200, `noindex`). Commerce inconnu ou `/menu` sans id → 404 (pas la SPA en 200 : pas de soft 404). Tout texte venu du commerçant est échappé (corps ET JSON-LD). Limite par IP comme les autres lectures publiques. Détail : `docs/SEO.md`. |

## Mise en production : Supabase (base) + Render Free (serveur) — en production depuis le 09/11/2026

**Staging et retour arrière : voir `docs/DEPLOIEMENT.md` (P0-S10)** — 2e service `asian-home-fidelite-staging`
(branche `autonome/integration`, base Supabase de test séparée), retour arrière en une commande
(`scripts/rollback-render.mjs`), compatibilité des migrations 0001–0010, procédure après écritures partielles.

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
   Puis, dans l'ordre, `0003_cartiz.sql` à `0010_compteurs_publics.sql` (chacun : coller → **Run**). Pour la
   production actuelle, 0001–0008 sont déjà appliquées (10/11/2026) et **0009–0010 restent à appliquer à la mise en
   production finale** (voir `docs/DEPLOIEMENT.md` § 5) ; pour un nouveau projet ou le staging, appliquer les dix.
4. Vérifier, dans une nouvelle requête :
   ```sql
   select relname as table_, relrowsecurity as rls
   from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1;
   ```
   Attendu : **15 lignes** (`avis`, `clients`, `commerces`, `compteurs_publics`, `demandes_rattrapage`, `envois`,
   `equipe`, `evenements_jour`, `journal`, `menus`, `meta`, `parrainages`, `sessions_revoquees`, `tentatives_auth`,
   `tirages`), toutes avec `rls = true` — **14 lignes** si seules 0001–0008 ont été appliquées (`compteurs_publics`
   manque : c'est la 0010), 5 lignes seulement (`avis`, `clients`, `commerces`, `meta`, `tirages`)
   si seules 0001–0002 ont été appliquées. Le **Table Editor**
   doit aussi afficher les tables (sans badge d'avertissement « RLS disabled »). Si Supabase propose d'ajouter des
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
     Service **déjà créé** : Render ne la demande pas — l'ajouter à la main dans **Environment** (voir ⚠️ ci-dessous) ; sans elle, le serveur refuse de démarrer.
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
4. Sur l'écran commerçant : Clients → **Valider une visite (+1)** → la roue du téléphone se débloque (la page de jeu
   vérifie le statut toutes les 10 s tant que la roue est verrouillée — en général quelques secondes) → tourner → un lot et
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
- Sans Pro, sauvegarde complète = **`npm run sauvegarde`** (P0-S5, les 15 tables via l'API, chiffrée) : voir
  « Sauvegarde / export » et `docs/SAUVEGARDE.md`. En complément possible : `pg_dump` ou `supabase db dump` (CLI
  Supabase) avec le mot de passe de base de l'étape a.

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
- Supabase Free : **aucune sauvegarde automatique** côté Supabase. **Sauvegarde complète (P0-S5)** :
  `node --env-file=.env scripts/sauvegarde-base.mjs` (ou `npm run sauvegarde`, variables déjà exportées) exporte les 15 tables (toutes lignes, toutes
  colonnes) via PostgREST + clé service_role, en `sauvegardes/asian-home-<horodatage>.json.gz` (gitignoré), chiffré
  AES-256-GCM si `SAUVEGARDE_CLE_CHIFFREMENT` est définie, rétention 30 jours / 30 fichiers ; échec → `ERREUR SAUVEGARDE`,
  sortie 1, aucun fichier. Vérification : `npm run restaurer -- <fichier> --cible pglite --verifier` (base locale
  jetable ; Supabase refusé). Procédure complète, RPO 24 h / RTO 1–2 h, copie hors VM, restauration manuelle vers
  Supabase et limites : **`docs/SAUVEGARDE.md`**.
- **`GET /api/v1/admin/sauvegarde`** (admin seulement : session admin ou X-Admin-PIN ; session commerce / équipe → 403)
  — bouton « Télécharger une sauvegarde » de l'écran Admin, routine quotidienne recommandée (12/11/2026). Même export,
  même `.json.gz`, même nom horodaté et même chiffrement que le script (lecture Supabase partagée : `lireTablePostgrest`
  de `server/sauvegarde.ts`, via `Stockage.lireTableSauvegarde`) ; chiffré si `SAUVEGARDE_CLE_CHIFFREMENT` est définie
  sur le service (clé invalide = refus de démarrer), sinon en clair + `[sauvegarde] AVERTISSEMENT` dans le journal.
  Table métier absente ou illisible → 500 `ERREUR SAUVEGARDE — …`, aucune archive. Fonctionne aussi sous SQLite (dev).
- SQLite (dev / Render Starter + disque) : copier le fichier `data/fidelite.db` serveur arrêté (ou
  `sqlite3 fidelite.db ".backup copie.db"`) — le script ci-dessus ne lit que Supabase (la route admin lit les deux).
- Pas de route d'**import** ni de restauration automatique vers Supabase (manuelle, `docs/SAUVEGARDE.md` § 8).

## RGPD (P1-B6)

**Page publique** `#/confidentialite/<commerceId>` (texte : `politiqueConfidentialite`, `src/lib/rgpd.ts`) : responsable du
traitement (le commerce et ses coordonnées), données collectées, finalité, aucune revente, prestataires nommés seulement
s'ils sont configurés (Twilio / Brevo / Google Wallet, lus dans `GET /sante`), durée de conservation configurée, droits et
marche à suivre, hébergement. Liens : formulaire d'inscription (page de jeu), pied des pages client (jeu, carte, menu),
écrans Plus / Offre. Mentions courtes alignées : `MENTIONS_RGPD` (`src/lib/integrations.ts`).

**Hébergement.** Serveur : Render, région **Frankfurt** (vérifié : `render.yaml`, `region: frankfurt`). Base : Supabase,
**région à confirmer** — la procédure plus bas fait choisir *Central EU (Frankfurt)*, mais la région du projet réel n'est
déclarée nulle part dans le code ni dans la configuration du dépôt (l'URL `https://<ref>.supabase.co` ne la contient pas).
À vérifier dans le dashboard Supabase (*Project Settings → General*), puis corriger `HEBERGEMENT_BASE` dans `src/lib/rgpd.ts`.

**Cascade de la suppression d'un client** (`supprimerClientCascade` dans `app.ts`, `Stockage.supprimerClient`) :

| Donnée | Effet |
|---|---|
| ligne `clients` | supprimée (avec ce qu'elle contient : contact, tampons, points, visites, récompenses, échanges, **messages** de la boîte de réception, **demandes de rattrapage**, consentement) |
| `tirages` | tous ceux du client (`client_id`) |
| `journal` | toutes les entrées rattachées au client (`donnees->>clientId`) |
| `parrainages` | les traces où il est **parrain ou filleul** |
| `demandes_rattrapage` | les traces d'audit du client (0004) |
| `envois` | son journal de relances SMS / e-mail (0007) |
| autres clients | ses **filleuls** perdent leur `parrainId` vers lui (un filleul pas encore récompensé perd ce bonus) ; rien d'autre ne change |
| compteurs du commerce | statistiques, coûts des lots et séries du tableau de bord sont recalculés depuis les clients et tirages restants. Seuls les compteurs **anonymes** `evenements_jour` (P2-Q3, 0008 : un nombre par jour et par type, sans aucun lien avec un client) ne bougent pas — ils ne contiennent rien de lui |

Ordre : dépendances d'abord, client en dernier (sous Supabase, sans transaction, une suppression interrompue se rejoue).
Tables d'une migration non appliquée : rien à supprimer, comptées 0 (jamais de 500). Après suppression : `GET /cartes/:id`
→ 404, l'export global ne contient plus le client, et son téléphone / e-mail ne retrouve plus aucune carte (une nouvelle
inscription crée une carte vierge). Trace : une entrée `rgpd` « Client supprimé (motif) avec N tirage(s)… » sans prénom,
contact ni identifiant. **Limite** : le texte d'une entrée de journal d'un AUTRE client peut citer son prénom (ex. passage
du filleul « +50 points pour Alice (filleul) et +50 points pour Bob (parrain) ») ; ces entrées appartiennent à l'autre
client et ne sont pas réécrites.

**Flux de la demande du client** : depuis sa carte (« Mes données personnelles »), il confirme son téléphone / e-mail ;
« Recevoir mes données » télécharge son CSV ; « Demander la suppression » enregistre la demande (`demandeSuppressionLe`).
Le commerçant la voit dans Clients (encadré « demandes de suppression ») et sur la fiche client, exporte si besoin, puis
« Supprimer ce client… » → saisie de `SUPPRIMER` → `DELETE`. Choix : la suppression reste une décision du commerçant
(récompense en attente à remettre, litige), jamais automatique depuis un lien public.

**Durée de conservation et purge** : `conservationMois` (Réglages, 6 à 120, défaut 36) après la dernière visite (à défaut
l'inscription). Déclenchement réel : **aucune tâche planifiée** (Render Free n'exécute rien sans requête). L'écran Clients
appelle `GET …/purge` à chaque ouverture et affiche l'avertissement (cartes dues ou dues sous 30 jours, date prévue,
protection, bouton « Exclure ») ; la purge n'a lieu que quand le gérant clique « Purger N clients… » et tape `PURGER`
(`POST …/purge`). Jamais purgés : client exclu, récompense en attente encore valable, plat en réserve valable, visite
oubliée en attente de décision. Chaque purge est journalisée (auteur, date, durée, nombre de clients et de lignes).
**Rappel périodique (P1-G1)** : le tableau de bord affiche le même résumé (`resumeRappelPurge`, `src/lib/rgpd.ts` —
cartes à purger maintenant / dans moins de 30 jours, avec le lien vers Clients) à chaque ouverture, en mode API
seulement — calculé depuis les clients chargés dans le navigateur. Une carte protégée au-delà de la conservation
n'y apparaît pas (elle reste listée dans Clients avec sa protection) ; l'écran Clients (`GET …/purge`, relu à
chaque ouverture) reste la liste de référence. **Purge automatique refusée explicitement (P1-G1)** : aucune suppression planifiée, à l'ouverture de l'état
ou par minuteur — la suppression reste un geste du commerçant, avec la cascade ci-dessus.

## Limites honnêtes

- SQLite : 1 seule instance (fichier local). Sous Supabase, plusieurs instances partagent la base ; l'anti-bruteforce
  y est relu au premier usage de chaque clé puis gardé en cache par instance (prévu pour 1 instance Render).
- Limitation des routes publiques : en mémoire, compteurs chauds ou bloqués persistés en base (P0-S20, migration 0010)
  et rechargés au redémarrage ; fenêtres d'une minute. Pas de CAPTCHA.
- Pas de comptes utilisateurs nominatifs : un PIN par commerce, partagé par l'équipe ; le **journal d'audit**
  (table `journal`, migration 0003) trace qui (gérant ou membre d'équipe) a fait quoi et quand.
- Le client se reconnaît par son téléphone / e-mail sans vérification (pas de SMS de confirmation) : en mode
  `transition`, quelqu'un qui connaît le numéro d'un client voit son prénom et ses tampons, et peut jouer à sa
  place s'il a une visite validée ce jour-là. En mode `stricte` (production), un jeton client est exigé : le
  numéro seul ne suffit plus (voir « Accès client aux cartes »).
- Pas de route d'import. Suppression d'un client et purge de conservation : voir « RGPD (P1-B6) » (aucune purge
  planifiée autonome : rien ne tourne sur Render Free sans requête).
- Le code serveur est vérifié par `tsc` (`npm run typecheck:server`, `tsconfig.server.json` + `@types/node`, P0-S21) ; il est couvert aussi par les tests HTTP.
- Le front en mode API (V2) recharge tout l'état toutes les 30 s : avec le PIN admin, une requête `/etat` par
  commerce. Suffisant pour quelques commerces ; au-delà, prévoir une route agrégée ou un rechargement incrémental.
- `GET /cartes/:clientId` (V2) parcourt les commerces pour trouver le client (pas d'index par identifiant seul) :
  sans importance à cette échelle.

## Intégrations préparées (V3) — compte Brevo créé le 11/11/2026 (mode test) ; Google / Wallet : aucun compte

| Fichier | Rôle |
|---|---|
| `server/wallet.ts` | Google Wallet « Generic pass » : JWT signé RS256, OAuth compte de service, création de classe (inactif sans configuration). |
| `server/wallet-apple.ts` | Apple Wallet `.pkpass` (manifeste, signature CMS, zip) — en suspens, branché sur aucune route. |
| `server/notifications/index.ts` | Interface d'envoi (`creerNotifications`) : 501 « à brancher » sans clé. |
| `server/notifications/twilio.ts` | Adaptateur SMS Twilio (API REST Messages) — **repli SMS** depuis le lot « Brancher Brevo ». |
| `server/notifications/brevo.ts` | Adaptateurs Brevo : e-mail (API `v3/smtp/email`) **et SMS (API `v3/transactionalSMS/send`)**. |

Le code des adaptateurs n'a **jamais** été exécuté contre Twilio, Brevo ou Google : il n'est testé qu'avec un `fetch`
simulé (`tests/integrations-v3.test.ts`, `tests/brevo-sms.test.ts`). Avant la mise en service, un essai réel sera nécessaire.

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

### SMS / e-mail — relances branchées (P1-B3), SMS via Brevo (lot « Brancher Brevo »), compte créé le 11/11/2026, mode test actif

**État réel (11/11/2026)** : tout le parcours est codé et testé contre des prestataires **simulés** ; le
**compte Brevo a été créé et activé le 11/11 au matin** (clé API v3 « Asian Home Fidelite », expéditeur
« Asian Home Paris » validé, expéditeur SMS `ASIANHOME`), les **5 variables Render
sont posées** (`BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `BREVO_SMS_SENDER`,
`BREVO_MODE_TEST=1`), déploiement « Live » le 11/11 à 08h18 ; `/sante` vérifié à 08h18 :
`integrations.sms: true, email: true, smsPrestataire: 'Brevo', modeTest: true`. **Aucun envoi réel fait**
(mode test : e-mail en sandbox Brevo, SMS simulé). Twilio reste le repli SMS, **non configuré**.
**Non re-vérifié dans ce lot** (lecture de `/sante` en production en délai dépassé, probablement le réveil
Render — à re-vérifier au prochain passage). Le code d'appel n'a jamais été exécuté contre le vrai Twilio
ni le vrai Brevo en envoi réel. **Fournisseur choisi : Brevo** (SMS + e-mail, une seule clé API) ; Twilio
n'est plus que le repli SMS si Brevo SMS n'est pas configuré. Procédure complète de mise en service et
recette réelle (accord explicite requis) : **`docs/BREVO.md`** (compte, clé API, expéditeurs, coûts, test).

**Mode test (consigne du 10/11/2026 : aucun envoi réel pendant le développement)** : `BREVO_MODE_TEST=1` —
e-mail en sandbox Brevo (`X-Sib-Sandbox: drop` : Brevo valide la requête et répond 201 + `messageId`, rien livré,
rien journalisé chez Brevo), SMS simulé (Brevo ne propose pas de sandbox SMS : aucun appel réseau), Twilio simulé
lui aussi ; journal des envois avec le statut `test` (« Test — rien envoyé »), route relance → 200
`{ envoye: false, test: true }`, `/sante` → `integrations.modeTest: true`, écran Messages : ligne « Mode test
Brevo actif ». La simulation n'occupe pas le créneau anti-doublon du jour : un vrai envoi reste possible le même
jour une fois le mode test coupé. **Retirer la variable pour envoyer pour de vrai** (plus tard, avec accord
explicite — voir `docs/BREVO.md` §5).

- **Consentement** : case NON pré-cochée, une ligne, à l'inscription publique (`#/jouer`) et en caisse (écran Clients) ;
  modifiable sur la fiche client (« Le client accepte les relances » / « Retirer le consentement »). Stocké sur le client
  (`consentementRelance`, `consentementRelanceLe`, `consentementRelanceOrigine` : `inscription`, `commercant`, `stop-sms`,
  `lien-email`) — preuve datée, sans migration. Tout changement est journalisé (action `consentement`).
- **Modèles** (`src/lib/relances.ts`, fonctions pures) : bienvenue, récompense proche (8-9 tampons sur 10, ou carte pleine),
  inactif 30 jours, anniversaire. SMS en alphabet GSM, nom du commerce, lien court `/c/<id>`, mention
  « STOP : <lien court de désinscription `/d/<id>/<jeton>`> » (P1-B9 — « répondez STOP » est impossible avec
  l'expéditeur alphanumérique Brevo ; la plupart des SMS font 2 segments, facturés 2 SMS). E-mail : objet + corps
  vouvoyés, lien vers la carte, lien de désinscription en pied.
- **STOP (SMS)** : webhook `POST /api/v1/commerces/<id>/stop-sms`, signé par Twilio — **seulement quand les SMS
  partent via Twilio**. **Choix** : désinscription traitée par l'app (pas seulement par la liste d'opposition native
  de Twilio) pour que le consentement de la fiche reflète le STOP. Selon le pays et le type d'expéditeur, Twilio peut
  aussi gérer ses propres mots-clés STOP (à vérifier à l'activation). **SMS via Brevo : pas de réponse STOP possible**
  (expéditeur alphanumérique `ASIANHOME`, pas de numéro destinataire) ; Brevo gère sa propre liste noire quand une
  réponse est possible, et la route `stop-sms` répond 501 — le consentement se retire alors par le lien de
  désinscription porté par chaque SMS (P1-B9, `STOP : <lien court /d/…>` → page `#/desinscription`, même jeton HMAC
  que les e-mails), depuis la fiche client, ou auprès du commerçant (voir `docs/BREVO.md` §6).
- **Désinscription (e-mail et SMS)** : **Choix** : lien de l'app (`#/desinscription/<clientId>/<jeton HMAC>`, retrait au clic,
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
3. SMS + e-mail : compte Brevo → `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` (optionnel),
   `BREVO_SMS_SENDER` (ex. `ASIANHOME`) — procédure complète : `docs/BREVO.md`. Crédits SMS à acheter
   (~0,045 € HT / SMS vers la France).
4. Repli SMS (facultatif) : compte Twilio, numéro ou Messaging Service expéditeur → `TWILIO_ACCOUNT_SID`,
   `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` ; dans la console Twilio, numéro → *Messaging* → « A message comes in » :
   Webhook `POST` `<PUBLIC_URL>/api/v1/commerces/<id du commerce>/stop-sms`. Utilisé seulement si Brevo SMS
   n'est pas configuré.
5. Vérifier `/api/v1/sante` → `integrations.sms` / `email` à `true`, `migrations.relances` à `true` ; puis vérifier
   en **mode test** (`BREVO_MODE_TEST=1` : e-mail en sandbox Brevo, SMS simulé, journal « Test — rien envoyé » —
   voir `docs/BREVO.md` §5). **Aucun essai réel pendant le développement** : le test d'envoi réel se fait plus
   tard, hors développement, avec l'accord explicite de l'utilisateur (retirer `BREVO_MODE_TEST`, puis
   `docs/BREVO.md` §5 B).

### Migration 0007 (journal des envois de relances) — à appliquer avant tout envoi réel

Supabase → **SQL Editor** → coller `supabase/migrations/0007_relances.sql` → **Run** (rejouable). Vérifier :
`/api/v1/sante` → `"migrations": { …, "relances": true }` (relu au plus toutes les 60 s). Sans elle : journal des envois
vide, refus non tracés, aucun envoi réel (503). Annulation : `0007_relances.down.sql` (supprime la table `envois` ; le
consentement, stocké sur les clients, est conservé).

### Migration 0008 (mesure anonyme du tableau de bord, P2-Q3) — à appliquer pour l'entonnoir

Supabase → **SQL Editor** → coller `supabase/migrations/0008_mesure.sql` → **Run** (rejouable). Vérifier :
`/api/v1/sante` → `"migrations": { …, "mesure": true }` (relu au plus toutes les 60 s). Elle crée la table
`evenements_jour` (commerce, jour, type, nombre — **aucune identité**) et la fonction `incrementer_evenement` (incrément
atomique, exécutable par `service_role` seulement), RLS sans policy comme les autres tables. Sans elle : rien n'est compté,
l'entonnoir et le test A/B du tableau de bord restent vides (avec un message), **le jeu et le tirage ne changent pas** ;
coûts des lots, séries visites / tirages / gains et comparaison au mois précédent marchent (ils viennent des tirages et des
visites déjà en base). Annulation : `0008_mesure.down.sql` (supprime les compteurs et la fonction ; aucune donnée client).

## Migration future — OBSOLÈTE (Supabase est la base de production depuis le 09/11/2026)

Ce qui suit décrivait la voie suivante **avant** S1 — elle a eu lieu : Supabase est désormais la base de
production (`server/stockage-supabase.ts`), pas une migration future. Ce qui resterait, un jour, si les besoins
dépassent l'architecture actuelle :

- un commerce dépasse **quelques centaines de clients actifs** ou qu'il y a **beaucoup de commerces** (plusieurs instances, sauvegardes gérées) ;
- on a besoin de **temps réel** (le comptoir voit le tirage au moment où il a lieu, sans rechargement) ;
- on veut de vrais **comptes** (e-mail / mot de passe par employé) au lieu d'un PIN.

La forme des données (`src/types.ts`) ne changerait pas ; il faudrait alors réécrire `server/stockage.ts`
(ou remplacer le serveur par des fonctions Supabase) en gardant les mêmes routes, et importer les données
depuis `fidelite.db` (SQLite de dev — la base de production, elle, est déjà chez Supabase).

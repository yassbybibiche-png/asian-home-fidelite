# Déploiement : staging, production et retour arrière (P0-S10, 11/11/2026)

Référence : `render.yaml` (Blueprint Render, 2 services), `scripts/rollback-render.mjs` (retour arrière en
une commande), `server/README.md` (« Mise en production », procédure de création du service de production).
Règle d'or du cycle autonome : **staging d'abord, production à la toute fin, après E2E verts** — et **aucun
déploiement ne se fait depuis cette VM** (pas de navigateur ici) : les étapes « dashboard » ci-dessous sont à
faire par l'opérateur, depuis un navigateur.

## 1. Les deux services

| | Production | Staging |
|---|---|---|
| Service Render | `asian-home-fidelite` | `asian-home-fidelite-staging` |
| Branche suivie | `master` | `autonome/integration` |
| URL | `https://asian-home-fidelite.onrender.com` | `https://asian-home-fidelite-staging.onrender.com` |
| Base Supabase | Projet de production (migrations 0001–0008 appliquées ; 0009–0010 à la mise en production finale) | **Projet de test séparé, jamais la production** (migrations 0001–0010 appliquées : le staging teste le code tel qu'il tournera en production après la dernière migration) |
| Plan / région | Free / Frankfurt | Free / Frankfurt |
| Build / start / santé | `npm ci && npm run build:api` / `npm run serveur` / `/api/v1/sante` | identiques (voir `render.yaml`) |

Les deux services ont les **mêmes noms de variables**, mais des **valeurs différentes** (saisies dans le
dashboard, jamais dans le dépôt) : `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` du projet de test pour le
staging, **PINs de test différents de la production** (`ADMIN_PIN`, `PIN_ASIAN_HOME`), `SESSION_SECRET`
régénéré (`openssl rand -base64 48`), `CORS_ORIGIN` = l'URL du staging (sans `/` final).

**Coût et quota Free.** Render Free donne 750 h d'instance par mois et par espace de travail, tous services
gratuits réunis. Un service allumé en permanence consomme ~744 h : à deux, le quota ne tient pas si les deux
tournent sans arrêt. En pratique les deux services **dorment après 15 min sans trafic** (réveil ~1 min) et le
staging ne sert qu'aux tests : le quota tient. Surveiller le premier mois ; si Render suspend un service pour
quota, c'est le **staging** qu'on laisse suspendu, jamais la production. Alternative si le staging doit rester
éveillé : Render Starter (7 $/mois) pour le staging seulement.

**Règle de branche.** Un push sur `autonome/integration` redéploie le staging automatiquement (c'est voulu).
Ne jamais pointer le staging sur `master`, ni la production sur `autonome/integration` : un push sur la
mauvaise branche déploierait le mauvais code au mauvais endroit, sans confirmation.

## 2. Créer le staging (navigateur requis — non fait sur cette VM)

Prérequis : le Blueprint de production existe déjà (service `asian-home-fidelite` créé depuis `render.yaml`) ;
la branche `autonome/integration` est poussée sur GitHub (elle l'est : les fusions de chaque lot y sont
poussées).

1. **Projet Supabase de test.** supabase.com → **New project** → nom `asian-home-fidelite-test`, région
   **Central EU (Frankfurt)**, plan **Free**. Ne rien activer de payant. Dans **SQL Editor**, appliquer
   **dans l'ordre** `supabase/migrations/0001_schema_initial.sql` à `0010_compteurs_publics.sql`
   (chacun : coller tout le contenu → **Run** → « Success »). Vérifier ensuite les 15 tables avec
   `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1;`
   (attendu : **15 lignes** `avis`, `clients`, `commerces`, `compteurs_publics`, `demandes_rattrapage`, `envois`,
   `equipe`, `evenements_jour`, `journal`, `menus`, `meta`, `parrainages`, `sessions_revoquees`,
   `tentatives_auth`, `tirages` — la sauvegarde en couvre 15 aussi, dont `compteurs_publics` en optionnelle,
   `server/sauvegarde.ts`).
   Récupérer `SUPABASE_URL` (**Connect** → *Project URL*) et `SUPABASE_SERVICE_ROLE_KEY` (**Settings → API
   Keys** → clé secrète `sb_secret_…`). **Ne jamais** prendre la clé *publishable* / `anon`.
2. **Ajouter le service au Blueprint existant.** Dashboard Render → Blueprint `asian-home-fidelite` →
   **Sync** (ou **Update**) : Render lit le `render.yaml` de `master` (qui décrit désormais 2 services) et
   propose de créer `asian-home-fidelite-staging`. Vérifier que la liste affiche bien **2 services** et que
   le staging porte la branche `autonome/integration`, puis valider. (Variante : **New → Blueprint** sur le
   dépôt, branche `autonome/integration` — Render créerait alors les 2 services d'un coup ; ne pas le faire
   si le Blueprint de production existe déjà, on aurait 2 productions.)
3. **Saisir les variables du staging** (Render les demande à la création, `sync: false` dans `render.yaml`) :
   les 2 variables du projet de test, `ADMIN_PIN` (8 à 12 chiffres, **différent de la production**),
   `PIN_ASIAN_HOME` (4 à 6 chiffres, **différent de la production**), `SESSION_SECRET` (régénéré),
   `CORS_ORIGIN` = `https://asian-home-fidelite-staging.onrender.com`. Ne pas ajouter `DEMO` ni `DB_FILE`.
4. **Attendre « Live »**, puis vérifier : `https://asian-home-fidelite-staging.onrender.com/api/v1/sante`
   → attendu `"stockage":"supabase"`, `"mode":"production"`, `"demo":false`, `migrations` toutes à `true`
   (0009 et 0010 comprises — le staging a les 10 migrations, la production pas encore).
   Dans Supabase (projet de test) → Table Editor → `commerces` : **1 ligne** `c-asian-home-paris` ;
   `meta` : 1 ligne `initialise`. C'est le seed du 1er démarrage (`initialiser`, `server/app.ts`).
5. **Parcours de base sur le staging** (données de test uniquement, jamais de vrais clients) :
   `server/README.md` § « Mise en production », étape e (commerce de test, inscription, visite, tirage,
   2e tirage refusé, export CSV), en remplaçant l'URL par celle du staging. Nettoyer ensuite le commerce de
   test (SQL donné à l'étape e).

Après la création, noter les identifiants Render (dashboard → service → **Settings** → ID `srv-…`) : ils
servent à la commande de retour arrière (§ 3). La clé API Render (**Account Settings → API Keys** → créer,
copier une fois) sert à la même commande ; elle ne se met **jamais** dans le dépôt ni dans un message.

## 3. Retour arrière en une commande

### 3.1 La commande exacte

```sh
RENDER_API_KEY=<clé-api-render> node scripts/rollback-render.mjs \
  --service <staging|production> --service-id srv-… --commit <sha-40-complet> --executer
```

- `--service` : on nomme explicitement le service visé (`staging` ou `production`) — pas de valeur par défaut,
  pas de retour arrière « par habitude ».
- `--service-id` : l'identifiant Render du service (`srv-…`, dashboard → Settings). Repli possible par la
  variable `RENDER_SERVICE_ID`.
- `--commit` : le SHA **complet** (40 caractères, `git rev-parse HEAD~1` ou `git log --oneline -5`) du commit
  à redéployer — en général le commit déployé juste avant celui qui pose problème. Un SHA court est refusé.
- **Sans `--executer`, le script ne fait rien** : il vérifie que le commit existe dans le dépôt local et
  affiche la commande `curl` exacte (clé référencée par `$RENDER_API_KEY`, jamais en clair). C'est le mode
  à utiliser pour préparer, relire, puis exécuter.
- La commande équivalente (ce que le script envoie, endpoint « Trigger deploy » de l'API Render,
  `api-docs.render.com/reference/create-deploy`, vérifié le 11/11/2026) :

```sh
curl --fail-with-body --silent --show-error --request POST \
  'https://api.render.com/v1/services/<service-id>/deploys' \
  --header "Authorization: Bearer $RENDER_API_KEY" \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json' \
  --data '{"commitId":"<sha-40-complet>"}'
```

Variante manuelle (sans API) : dashboard Render → service → **Deploys** → le déploiement du commit précédent
→ **Redeploy**. Même effet, pas de clé API nécessaire.

### 3.2 Ce que fait le retour arrière

Render reconstruit le commit demandé (`npm ci && npm run build:api`) et le déploie ; le contrôle de santé
(`/api/v1/sante`) doit passer avant la bascule. L'ancien code reste en ligne tant que le nouveau build n'est
pas prêt : **un build qui échoue ne remplace pas la version en cours**.

### 3.3 Ce qu'il ne fait PAS (revue Codex, point 12)

Redéployer le commit précédent **ne restaure ni le schéma, ni les données, ni la configuration** :

- **Schéma** : les migrations appliquées restent appliquées. C'est voulu et sans danger ici : chaque
  migration 0001–0010 est compatible avec l'ancien code et le nouveau (§ 5). On n'annule **jamais** une
  migration juste parce que le code revient en arrière — l'annulation (`.down.sql`, § 5) ne se fait que si
  le § 4 l'exige, et toujours après sauvegarde.
- **Données** : les écritures faites par le code déployé restent en base. Voir § 4 si le déploiement a
  déjà écrit avant l'échec.
- **Configuration** : un redéploiement ne touche pas à **Environment**. Si l'incident vient d'une variable
  (mauvaise `SUPABASE_URL`, `SESSION_SECRET` changée…), le retour arrière ne répare rien : il faut corriger
  la variable dans le dashboard (Render redéploie alors).
- **Auto-déploiement** : redéployer un commit via l'API **ne désactive pas** l'auto-déploiement (dit par la
  doc Render). Le retour arrière est une mesure d'urgence : ensuite, **consolider dans Git** — `git revert`
  du commit fautif sur la branche du service, puis push (le push redéploie la branche réparée). Sans ça, la
  branche et le code déployé divergent, et le prochain déploiement automatique remettrait le commit fautif.

### 3.4 Vérifier après le retour arrière

1. Attendre « Live » dans le dashboard Render (build + contrôle de santé).
2. `GET /api/v1/sante` → `"stockage":"supabase"`, `"mode":"production"`, pas d'`alerteStockage`, et le
   `commit` / la version affichée correspondent au commit redéployé (si le champ est présent).
3. Parcours de base (`server/README.md` § e, abrégé) : ouvrir le front, se connecter en commerçant, valider
   une visite, un tirage, vérifier que le code gagnant s'affiche des deux côtés.
4. Consigner dans `JOURNAL.md` : heure, service, commit quitté, commit redéployé, cause, vérifications.

## 4. Procédure après écritures partielles

Cas : le déploiement a servi du trafic (quelques minutes ou plus) avant qu'on juge qu'il faut revenir en
arrière. Il a donc **déjà écrit en base**. Ne pas redéployer l'ancien code à l'aveugle : suivre l'ordre.

1. **Figer l'état — sauvegarde immédiate.** `node scripts/sauvegarde-base.mjs` (docs/SAUVEGARDE.md,
   variables `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` **du service concerné** — staging ou production,
   ne pas les confondre). Sans sauvegarde, aucune réparation n'est rattrapable.
2. **Identifier ce que le nouveau code a écrit.** Dans Supabase → SQL Editor (projet concerné), horodater
   avec l'heure du déploiement (logs Render) :
   ```sql
   select count(*) from public.journal where date >= '<heure-deploiement>';
   select count(*) from public.tirages where date >= '<heure-deploiement>';
   select count(*) from public.clients where donnees ->> 'creeLe' >= '<heure-deploiement>';
   select count(*) from public.envois where date >= '<heure-deploiement>';
   ```
   Le `journal` dit qui a fait quoi (membre, client, action) ; les `tirages` et les `clients` créés disent
   si des visites ont été validées et des lots gagnés pendant la fenêtre.
3. **Décider, cas par cas — pour les migrations 0001–0010, garder est le cas normal.**
   - **Nouvelles clés dans les JSONB existants** (`clients.donnees`, `commerces.donnees` : programme,
     parrainage, paliers…) : l'ancien code **ignore les clés inconnues**. Rien à faire, on garde.
   - **Lignes dans les nouvelles tables** (`equipe`, `journal`, `menus`, `parrainages`,
     `demandes_rattrapage`, `sessions_revoquees`, `tentatives_auth`, `envois`, `evenements_jour`,
     `compteurs_publics`) : l'ancien code **ne les lit jamais**. Rien à faire, on garde — sauf les deux
     cas ci-dessous.
   - **Une relance bloquée en `en_cours`** (`envois`) : l'index unique anti-doublon empêche de renvoyer la
     même relance au même client le même jour tant que la ligne reste `en_cours`. Si le déploiement a
     planté entre la réservation et l'envoi, la relance est coincée. Réparation, **avec l'opérateur, une
     seule ligne à la fois** :
     ```sql
     update public.envois set statut = 'erreur' where id = '<id>' and statut = 'en_cours';
     ```
     puis relancer la relance depuis l'app (elle recréera sa réservation). Ne jamais supprimer la ligne :
     le journal des envois est la preuve de ce qui a (ou n'a pas) été envoyé.
   - **Un blocage anti-bruteforce en cours** (`tentatives_auth`, `bloque_jusqu_a` futur) : l'ancien code
     compte en mémoire et ignore la table — le blocage serait levé par le retour arrière. Si le blocage
     visait une vraie attaque, le garder est préférable : ne pas annuler la migration ; attendre sa fin
     (quelques minutes) ou le lever explicitement (`delete from public.tentatives_auth where cle = '…';`)
     **seulement** si c'est un faux positif avéré (commerçant bloqué par ses propres erreurs de PIN).
   - **Données corrompues** (lignes incohérentes, JSONB invalide, contrainte violée) : ne pas réparer à la
     main ligne par ligne. Restaurer la sauvegarde du § 4.1 (`node scripts/restaurer-base.mjs`,
     docs/SAUVEGARDE.md) — c'est le seul retour arrière des données. Prévenir le commerçant : les
     écritures faites entre la sauvegarde et la restauration sont perdues.
4. **Ensuite seulement, retour arrière du code** (§ 3), puis vérifications (§ 3.4).
5. **Ne jamais annuler une migration sur la production sans sauvegarde**, et ne jamais annuler 0001–0004
   (pas de `.down.sql` : le retour arrière du schéma, c'est la restauration de sauvegarde). Les
   `.down.sql` de 0005–0010 ne suppriment que des données auxiliaires (révocations, compteurs, journal des
   envois, compteurs anonymes) — jamais de données métier — et la 0009 garde les versions d'accès des
   cartes (`meta`, clés `acces_client:…`) pour qu'une ré-application retrouve l'état.

## 5. Compatibilité des migrations 0001–0010 (vérifiée une par une, 11/11/2026)

Règle vérifiée : chaque migration « up » est **additive seulement** — aucune ne supprime une table, une
colonne ou une ligne, ne renomme rien (test `tests/deploiement-p0-s10.test.ts`). Conséquence dans les deux
sens :

- **Ancien code sur nouveau schéma** : l'ancien code ne connaît pas les nouvelles tables/fonctions et ne
  les lit jamais ; les contraintes élargies (0009) acceptent toujours les valeurs qu'il écrit ; les clés
  JSONB nouvelles sont ignorées.
- **Nouveau code sur ancien schéma** (migration pas encore appliquée) : le serveur **fonctionne quand même**,
  en mode dégradé documenté dans l'en-tête de chaque migration (`ErreurMigrationManquante`) — sauf 0003 et
  0004, exigées au démarrage sous Supabase (`exigerMigrationsAudit`, `server/app.ts`) : sans elles, le
  serveur refuse de démarrer plutôt que d'écrire un fait métier sans sa trace d'audit.

| Migration | Nature | Ancien code sur nouveau schéma | Nouveau code sur ancien schéma | Annulation |
|---|---|---|---|---|
| 0001 `schema_initial` | Crée `meta`, `commerces`, `clients`, `tirages`, `avis` + trigger de version | — (base de tout le reste) | — | Pas de `.down.sql` : restauration de sauvegarde |
| 0002 `rls` | RLS + droits seulement, aucune donnée | `service_role` contourne RLS (`BYPASSRLS`) : inchangé | — | Pas de `.down.sql` : restauration de sauvegarde |
| 0003 `cartiz` | Crée `equipe`, `journal`, `menus` ; recrée `incrementer_version()` à l'identique | Ignore les nouvelles tables ; points/messages dans les JSONB existants, clés ignorées | **Démarrage refusé** (`exigerMigrationsAudit`) — appliquer avant le code | Pas de `.down.sql` : restauration de sauvegarde |
| 0004 `programme` | Crée `parrainages`, `demandes_rattrapage` ; état du programme dans les JSONB, défauts côté serveur | Ignore les nouvelles tables ; commerce sans configuration → défauts | **Démarrage refusé** (`exigerMigrationsAudit`) — appliquer avant le code | Pas de `.down.sql` : restauration de sauvegarde |
| 0005 `sessions_revoquees` | Crée `sessions_revoquees` (jetons révoqués avant expiration) | Révocation en mémoire, jetons expirant seuls (8 h / 12 h) | Révocation en mémoire | `.down.sql` : table supprimée, révocations perdues (jetons expirent de toute façon) |
| 0006 `tentatives_auth` | Crée `tentatives_auth` (compteurs d'échecs PIN/codes) | Comptage en mémoire | Comptage en mémoire | `.down.sql` : table supprimée, blocages en cours levés |
| 0007 `relances` | Crée `envois` + index unique anti-doublon | Ne connaît pas le journal | Journal lu vide, **aucun envoi réel (503)** — pas d'envoi sans anti-doublon | `.down.sql` : journal supprimé (aucune donnée client), envois bloqués (503) jusqu'à ré-application |
| 0008 `mesure` | Crée `evenements_jour` + fonction `incrementer_evenement` | Ne compte rien | Événements ignorés, entonnoir vide | `.down.sql` : compteurs anonymes supprimés |
| 0009 `auth_client` | Élargit le CHECK de `tentatives_auth` (`'client'` ajouté) + fonction `auth_client_active()` + clés `meta` `acces_client:…` ; **aucune table créée** | Écrit seulement `admin` / `commerce` / `equipe` : toujours valides sous la contrainte élargie ; ignore les clés `meta` | Échecs d'accès client comptés en mémoire | `.down.sql` : supprime les compteurs `client`, remet le CHECK d'origine, **garde** les versions d'accès des cartes |
| 0010 `compteurs_publics` | Crée `compteurs_publics` (fenêtres d'une minute) | Ignore la table | Compteurs en mémoire + avertissement au démarrage | `.down.sql` : table supprimée, compteurs en cours perdus (fenêtres d'une minute) |

**Ordre de déploiement (à respecter) :** (1) sauvegarde (`scripts/sauvegarde-base.mjs`), (2) appliquer les
migrations **dans l'ordre** dans le SQL Editor, (3) vérifier `/api/v1/sante` → `migrations` (clés
`cartiz`, `programme`, `relances`, `mesure`, `authClient`…), (4) déployer le code (push sur la branche du
service). **Ordre inverse au retour arrière :** (1) sauvegarde, (2) redéployer l'ancien code (§ 3), (3) ne
toucher au schéma que si le § 4 l'exige, (4) vérifier (§ 3.4).

## 6. Limites honnêtes

- Le retour arrière ne couvre que le code : schéma, données et configuration demandent les procédures des
  § 4–5, pas une commande.
- Render Free dort après 15 min : le premier appel après une veille attend ~1 min (staging comme production).
  Ce n'est pas une panne — ne pas relancer un déploiement pour ça.
- Une seule instance par service : pas de bascule sans coupure, pas de déploiement « bleu/vert ».
- Supabase gratuit : pas de restauration à un instant donné (PITR) — la sauvegarde, c'est
  `scripts/sauvegarde-base.mjs` (docs/SAUVEGARDE.md), à lancer **avant** chaque migration et chaque retour
  arrière après écritures.
- La création du staging et la première vérification « Live » n'ont **pas** été faites sur cette VM (pas de
  navigateur) : elles restent à faire par l'opérateur (§ 2). Le `render.yaml` est validé par
  `tests/render-yaml.test.ts` + `tests/deploiement-p0-s10.test.ts`, la commande de retour arrière est testée
  en simulation (jamais d'appel réel), la compatibilité des migrations est vérifiée par les tests — mais
  **rien de tout cela ne prouve que le service de staging existe** : la preuve, c'est le `GET /api/v1/sante`
  du § 2, étape 4.

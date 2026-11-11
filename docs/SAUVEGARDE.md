# Sauvegarde et restauration de la base (P0-S5, 11/11/2026)

Supabase Free ne fait **aucune sauvegarde** : si la base est perdue (suppression du projet, erreur de manipulation,
projet en pause jamais réactivé…), clients, tampons, tirages et avis sont perdus. Ce lot ajoute la solution gratuite
la plus robuste possible avec les accès disponibles : un **export complet des 14 tables par l'API (PostgREST)**, avec
la clé `service_role`, compressé et chiffré, et une **restauration vérifiée sur un Postgres local (PGlite)**.

Code : `server/sauvegarde.ts` (logique pure), `scripts/sauvegarde-base.mjs`, `scripts/restaurer-base.mjs`.
Tests : `tests/sauvegarde-p0-s5.test.ts` (export → restauration → comparaison ligne à ligne, CLI de bout en bout).

## 1. Ce que la sauvegarde couvre

- **Les 14 tables** des migrations 0001 à 0008, **toutes les lignes, toutes les colonnes** : `meta`, `commerces`,
  `clients`, `tirages`, `avis`, `equipe`, `journal`, `menus`, `parrainages`, `demandes_rattrapage`,
  `sessions_revoquees`, `tentatives_auth`, `envois`, `evenements_jour`.
- Y compris `pin_hash` / `pin_sel` (PIN commerçant), `code_hash` / `code_sel` (codes équipe), les secrets serveur
  rangés dans `meta` (ex. `secret_desinscription`, jetons Google chiffrés), les téléphones et e-mails des clients.
  → **Le fichier de sauvegarde est sensible** : à chiffrer (§ 4) et à traiter comme une donnée personnelle.
- **Jamais de sauvegarde incomplète** : si une seule table manque (migration non appliquée) ou ne se lit pas, le script
  s'arrête avec `ERREUR SAUVEGARDE — table « … » absente…` et **n'écrit aucun fichier**. Le fichier est d'abord écrit en
  `.tmp` puis renommé : jamais de fichier final tronqué.

## 2. Ce qu'elle NE couvre PAS (limites honnêtes)

- **Le schéma** (tables, index, contraintes, triggers, RLS, policies, droits) : la source du schéma, ce sont les
  migrations du dépôt `supabase/migrations/0001…0008` (rejouées avant toute restauration).
- **La configuration Supabase** : Auth, Storage, clés API, réglages du projet, variables Render. À noter à part.
- **Pas d'instantané cohérent** : PostgREST lit table par table (pas de transaction commune). Une écriture pendant la
  sauvegarde peut donner, par exemple, un tirage dont le client n'est pas dans le fichier. Conséquence : la restauration
  échoue **bruyamment** (clé étrangère, transaction annulée), jamais en silence. Parade : sauvegarder **restaurant fermé**
  (la nuit), et vérifier chaque sauvegarde par une restauration PGlite (§ 6).
- **La restauration testée l'est sur PGlite** (Postgres en WebAssembly, local) : elle prouve que le fichier contient
  toutes les données et qu'elles se rechargent dans le schéma des migrations, avec leurs contraintes. Elle **ne valide
  PAS** la restauration complète d'un environnement Supabase (PostgREST, rôles réels, version de Postgres différente,
  limites du SQL Editor). Une restauration réelle sur un **projet Supabase de test** reste **à planifier** (non faite
  dans ce lot).
- **Pas de dump SQL natif** : le mot de passe Postgres du projet n'est pas enregistré et `pg_dump` n'est pas installé
  sur la VM. Sans ce mot de passe, `pg_dump` / `supabase db dump` sont impossibles. Si le mot de passe est un jour
  récupéré (Dashboard → Project Settings → Database → Reset database password), un `pg_dump` mensuel en complément
  serait un plus (schéma + données dans un format standard).
- **Pas d'alerte automatique** (e-mail / SMS) en cas d'échec : voir § 7.

## 3. Objectifs de reprise (RPO / RTO)

| | Valeur | Condition |
|---|---|---|
| **RPO** (perte de données maximale) | **24 h** | une sauvegarde **par jour**, lancée par l'opérateur (manuellement ou planifiée, § 5). Sans exécution, le RPO grandit d'autant. |
| **RTO** (durée de remise en service) | **1 à 2 h, estimé** | restauration **manuelle** (§ 8) : estimation, jamais chronométrée sur un vrai projet Supabase. |
| **Rétention** | **30 jours / 30 fichiers** | un fichier est gardé s'il a ≤ 30 jours **ou** s'il est parmi les 30 plus récents. |

## 4. Chiffrement

- **AES-256-GCM** (`node:crypto`), clé maîtresse de **32 octets = 64 caractères hexadécimaux** dans
  `SAUVEGARDE_CLE_CHIFFREMENT`. Générer une fois : `openssl rand -hex 32`.
- Chaque fichier a sa propre clé dérivée (HKDF-SHA256, sel aléatoire) et son IV aléatoire ; le tag GCM détecte toute
  altération. Format : `asian-home-chiffre:v1:` + base64(sel 16 o | IV 12 o | tag 16 o | données), le tout gzippé.
- La clé n'est **jamais** commitée, jamais affichée (même tronquée) ni écrite dans un log. Elle doit être conservée
  **hors de la VM** (gestionnaire de mots de passe du commerçant / coffre) : **sans elle, les sauvegardes sont
  illisibles**, et la perdre en même temps que la VM rendrait toutes les copies inutiles.
- Sans clé : le script écrit en clair avec `AVERTISSEMENT — sauvegarde non chiffrée`. `--sans-chiffrement` force le clair
  même si une clé est définie (avertissement explicite) — à réserver au débogage.

## 5. Faire une sauvegarde

Prérequis : Node 24, `npm install` fait, et les variables suivantes (les mêmes que celles du serveur sur Render, plus
la clé de chiffrement). Le script **ne lit pas `.env` tout seul** : passer `--env-file`.

```sh
# .env (jamais commité) : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SAUVEGARDE_CLE_CHIFFREMENT (voir .env.example)
node --env-file=.env scripts/sauvegarde-base.mjs            # ou : npm run sauvegarde (variables déjà exportées)
node --env-file=.env scripts/sauvegarde-base.mjs --dir /chemin/vers/dossier
node scripts/sauvegarde-base.mjs --aide
```

Sortie attendue :

```
SAUVEGARDE OK — …/sauvegardes/asian-home-2026-11-12T030000.json.gz — 1234 lignes (meta 3, commerces 1, clients 210, …) — chiffrée AES-256-GCM
Rétention — supprimé : asian-home-2026-10-10T030000.json.gz
```

- Fichier : `asian-home-AAAA-MM-JJTHHMMSS.json.gz` (heure **UTC**), dans `SAUVEGARDE_DIR` (défaut `<dépôt>/sauvegardes/`,
  gitignoré), droits `600`.
- Lecture page par page (1 000 lignes, plafond PostgREST), triée sur la clé de chaque table, jusqu'à épuisement.
- La rétention ne touche **que** les fichiers au nom `asian-home-<horodatage>.json.gz` du dossier ; jamais autre chose.

**Planifier (quotidien, à faire par l'opérateur)** — rien n'est planifié par ce lot. Exemple sur une machine allumée la
nuit (crontab, 3 h du matin, restaurant fermé) :

```
0 3 * * * cd /chemin/fideliz-claude && node --env-file=.env scripts/sauvegarde-base.mjs >> sauvegardes/sauvegarde.log 2>&1
```

**Copie hors VM obligatoire.** Une sauvegarde qui reste sur la même machine que l'outil disparaît avec elle. Après
chaque sauvegarde (au minimum chaque semaine) : télécharger le fichier **chiffré** vers le poste du commerçant ou un
coffre (cloud personnel, clé USB rangée), **jamais dans le dépôt git**. Garder la clé de chiffrement ailleurs que les
fichiers.

## 6. Vérifier une sauvegarde (restauration PGlite, sans risque)

```sh
SAUVEGARDE_CLE_CHIFFREMENT=… node scripts/restaurer-base.mjs sauvegardes/asian-home-2026-11-12T030000.json.gz --cible pglite --verifier
```

Le script : décompresse, déchiffre (clé requise si le fichier est chiffré), valide (refus si une table manque), crée une
base PGlite **en mémoire**, recrée les rôles Supabase (`anon`, `authenticated`, `service_role` BYPASSRLS), rejoue les
migrations `0001…0008` (les `.down.sql` sont ignorés), puis insère toutes les lignes **dans une seule transaction**
(une erreur → tout est annulé, sortie 1). `--verifier` recompte chaque table dans la base et compare au fichier.

```
RESTAURATION OK (PGlite en mémoire) — sauvegarde du 2026-11-12T03:00:00.000Z — 1234 lignes
  meta                 3
  …
VÉRIFICATION OK — compteurs de la base = compteurs du fichier, pour les 14 tables.
```

- `--fichier <dossier>` : base PGlite persistante (doit être vide), pour l'explorer ensuite.
- Détails techniques : les colonnes `ordre` (identity) gardent leurs valeurs (OVERRIDING SYSTEM VALUE) et la séquence
  est recalée au-delà ; la restauration s'exécute en tant que propriétaire des tables, que la RLS ne filtre pas (aucune
  table n'est en FORCE ROW LEVEL SECURITY) : rien n'est désactivé, le schéma restauré est identique.
- **Toute cible autre que `pglite` est refusée** (Supabase, URL Postgres) : aucune écriture automatique vers la
  production n'existe dans ce lot.

## 7. Alertes d'échec

En cas d'échec : `ERREUR SAUVEGARDE — <cause>` sur la sortie d'erreur et **code de sortie 1**, aucun fichier écrit.
**Aucune alerte automatique** (e-mail / SMS) n'est branchée : l'opérateur doit **lire le log après chaque exécution**
(ou vérifier qu'un nouveau fichier du jour existe). À brancher plus tard (ex. e-mail via Brevo quand il sera en
service, ou alerte du planificateur sur code de sortie non nul).

## 8. Restaurer vers Supabase (procédure MANUELLE, non automatisée, non testée sur un vrai projet)

Volontairement non automatisée : une erreur de cible écraserait la production. À faire calmement, à deux si possible.

1. **Geler les écritures** : suspendre le service Render (Dashboard Render → service → *Suspend*) pour qu'aucune
   inscription n'arrive pendant la restauration.
2. **Choisir la cible** : projet Supabase **vide** (nouveau projet, ou projet de test pour un exercice). Ne restaurer
   par-dessus la production existante que si elle est perdue/corrompue, et après une sauvegarde de son état actuel.
3. **Schéma** : SQL Editor → exécuter `supabase/migrations/0001…0008` dans l'ordre (sans les `.down.sql`).
4. **Vérifier le fichier** d'abord avec le § 6 (`--verifier`) : il doit passer.
5. **Obtenir le JSON en clair** (sur un poste sûr, jamais dans le dépôt) : gunzip, puis déchiffrement avec
   `dechiffrerSauvegarde` de `server/sauvegarde.ts` (ex. petit script `node` qui lit le fichier, appelle la fonction avec
   la clé et écrit le JSON dans un dossier hors dépôt). Effacer ce fichier en clair à la fin.
6. **Insérer table par table, dans l'ordre** `meta, commerces, clients, tirages, avis, equipe, journal, menus,
   parrainages, demandes_rattrapage, sessions_revoquees, tentatives_auth, envois, evenements_jour`, avec, pour chaque
   table, le tableau `tables.<nom>` du JSON collé à la place de `<JSON>` (par paquets si le SQL Editor refuse un texte trop
   long) :

   ```sql
   insert into public.clients (id, ordre, commerce_id, cle_contact, donnees, version) overriding system value
   select id, ordre, commerce_id, cle_contact, donnees, version
   from jsonb_populate_recordset(null::public.clients, '<JSON>'::jsonb)
   on conflict (id) do update set commerce_id = excluded.commerce_id, cle_contact = excluded.cle_contact,
     donnees = excluded.donnees, version = excluded.version;
   ```

   Clés de conflit : `id` sauf `meta` et `tentatives_auth` (`cle`), `menus` (`commerce_id`), `sessions_revoquees`
   (`jti`), `evenements_jour` (`commerce_id, jour, type`). `overriding system value` seulement pour les tables avec
   `ordre` (`commerces`, `clients`, `equipe`), et jamais `ordre` dans le `update set`. C'est exactement le SQL généré
   par `ecrireTableSql` (`server/sauvegarde.ts`), testé sur PGlite.
7. **Recaler les séquences** : pour `commerces`, `clients`, `equipe` :
   `select setval(pg_get_serial_sequence('public.clients', 'ordre'), coalesce((select max(ordre) from public.clients), 0) + 1, false);`
8. **Contrôler** : `select count(*)` de chaque table = `compteurs` du fichier.
9. Si c'est un **nouveau projet** : mettre `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` à jour sur Render. Relancer le
   service, ouvrir `/sante` (migrations toutes `true`), tester une connexion commerçant et une carte client.

Estimation : 1 à 2 h (RTO), selon la taille et l'aisance avec le SQL Editor.

## 9. Décisions ouvertes (à trancher par l'utilisateur)

- **Supabase Pro (à partir de 25 $/mois)** : sauvegardes quotidiennes gérées (7 jours) + PITR en option, plus de mise en
  pause. **Non acheté dans ce lot.** Recommandé dès que la base contient de vrais clients, en complément (pas en
  remplacement) de cette sauvegarde indépendante hors Supabase.
- **Mot de passe Postgres** du projet (pour `pg_dump`) : non enregistré ; à récupérer/réinitialiser si l'on veut un
  dump SQL natif en complément.
- **Planification** et **copie hors VM** : à mettre en place par l'opérateur (§ 5) ; **alerte d'échec** à brancher (§ 7).
- **Exercice de restauration réelle** sur un projet Supabase de test : à planifier (§ 2).

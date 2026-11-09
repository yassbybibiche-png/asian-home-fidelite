# PHASE SUPABASE S1 — Schéma, migration SQL, RLS, adaptateur stockage

Tu travailles dans le dossier `~/workspace/fideliz-claude/` (c'est ton répertoire de travail, ne sors pas de ce dossier). Lis d'abord `README.md`, `server/README.md`, `JOURNAL.md`, `src/types.ts` et `server/stockage.ts` en entier.

## Contexte
- Backend actuel : `server/` Node 24, zéro dépendance, `node:sqlite`, API `/api/v1`, PIN commerçant/admin, tests 94/94. L'utilisateur a choisi **Supabase gratuit** (au lieu de Render Starter payant) comme backend partagé de production.
- Marque : Asian Home Paris, gratuit, aucune marque ni prix Fideliz. **Apple Developer EN SUSPENS — ne touche à rien côté Apple, ne demande rien.**
- Règles strictes : ne crée AUCUN compte Supabase, AUCUN projet, AUCUNE ressource facturable, ne dépense rien, ne pousse rien sur GitHub, ne publie rien. Aucune vraie clé, même de test, dans le code ou les logs. Ne pose aucune question : tranche les détails et note tes choix dans JOURNAL.md.

## Ce que tu construis dans cette phase
1. **Schéma Postgres Supabase** dans `supabase/migrations/0001_schema_initial.sql` (fichier SQL complet et rejouable, idempotent autant que possible : `CREATE TABLE IF NOT EXISTS`, etc.) :
   - Tables équivalentes au modèle actuel : `meta`, `commerces`, `clients`, `tirages`, `avis` — avec les mêmes champs que `src/types.ts` (Commerce, Client, Tirage, Avis) + colonnes indexées utiles (`commerce_id`, `cle_contact`, `date`).
   - Les objets métier restent rangés en JSONB (`donnees`) comme en SQLite, pour ne pas changer la forme des données ; colonnes à côté pour les recherches et l'unicité.
   - Contrainte d'unicité `(commerce_id, cle_contact)` sur `clients` (anti-doublon 0033 / +33 / 06, e-mail en minuscules — même règle `cleContact` que `src/lib/fidelite.ts`).
   - Index : tirages par (commerce_id, client_id), avis par commerce_id.
   - PIN : `pin_hash` + `pin_sel` sur `commerces` (SHA-256 + sel, jamais en clair).
2. **RLS (Row Level Security)** dans la même migration (ou `0002_rls.sql`) : RLS activée sur toutes les tables. Politique minimale et sensée, documentée en commentaire SQL : le serveur utilise la clé **service_role** (contourne RLS, c'est le serveur qui applique les règles métier et les PIN) ; aucune lecture publique directe sans clé ; la clé **anon** ne doit donner accès à rien par défaut sur ces tables (aucune policy permissive pour `anon`/`authenticated` sur les données clients). Si tu ajoutes une policy, justifie-la en commentaire.
3. **Adaptateur Supabase** :
   - Nouveau module `server/stockage-supabase.ts` qui implémente **exactement la même interface** que `ouvrirStockage` dans `server/stockage.ts` (mêmes méthodes : meta, commerces, commerce, pin, ajouterCommerce, majCommerce, majPin, clients, client, clientParContact, ajouterClient, majClient, tirages, tiragesClient, ajouterTirage, avis, unAvis, ajouterAvis, majAvis, transaction, fermer). Le serveur ne doit pas avoir à changer de logique métier.
   - Utilise le client officiel Supabase JS (`@supabase/supabase-js`) via REST (PostgREST) — **pas** de connexion Postgres directe depuis le serveur (pas de `pg`), pour rester simple et compatible avec l'hébergement du serveur.
   - `transaction` : Postgres via REST n'a pas de transaction multi-requêtes simple — implémente-la honnêtement : si une vraie transaction n'est pas possible via le client JS, documente-le dans le code et dans le README, et rends chaque opération atomique au niveau requête (insert/update unique) ; les écritures sensibles actuelles (inscription, visite, récompense, tirage) doivent rester sûres : en particulier le tirage doit rester unique par client et par jour — appuie-toi sur une contrainte d'unicité en base pour le tirage du jour (ex. index unique sur (commerce_id, client_id, date du jour)) afin qu'un double tirage simultané soit rejeté par la base, pas seulement par un test applicatif. Si tu ne peux pas garantir cela, dis-le explicitement dans JOURNAL.md et README.
   - Sélection du stockage : dans `server/index.ts` / `server/app.ts`, choisir Supabase **seulement** quand les variables d'environnement Supabase sont présentes, sinon SQLite local (fallback dev/tests, comportement actuel inchangé). Le champ `stockage` de `GET /api/v1/sante` doit refléter le stockage actif (`sqlite` ou `supabase`).
4. **Variables d'environnement** : fichier `.env.example` à la racine (et documenté dans `server/README.md`) avec EXACTEMENT les variables Supabase à remplir :
   - `SUPABASE_URL` (URL du projet, ex. `https://xxxx.supabase.co`)
   - `SUPABASE_SERVICE_ROLE_KEY` (clé service_role, **serveur uniquement, JAMAIS dans le navigateur, JAMAIS dans le front**)
   - `SUPABASE_ANON_KEY` seulement si tu en as réellement besoin côté serveur (précise à quoi elle sert ; sinon ne l'inclus pas, ou marque-la optionnelle avec son usage exact). Précise pour chaque variable : où la trouver dans le dashboard Supabase (Settings → API), et qu'elle ne doit jamais être commitée.
   - Aucune valeur réelle dans `.env.example` (que des placeholders).
5. **Dépendances** : ajoute `@supabase/supabase-js` via `npm install` (version épinglée dans package.json). Vérifie que `npm test` et `npm run build` passent toujours.

## Tests (obligatoires)
- Ajoute `tests/supabase.test.ts` : tests de la couche Supabase **sans vrai projet** (client Supabase simulé / faux transport `fetch` injecté, fidèle au contrat PostgREST) qui prouvent : mapping des requêtes (bonnes tables/colonnes/filtres), déduplication par `cleContact`, unicité tirage du jour rejetée par la base (contrainte), sélection sqlite vs supabase selon les variables d'environnement, et que les règles métier (1 visite = 1 tampon avec report, roulette = visite du jour obligatoire) ne sont pas modifiées (réutilise les fonctions pures existantes, ne les duplique pas).
- Si un vrai projet Supabase de test est impossible sans compte, écris-le noir sur blanc dans JOURNAL.md et dans le rapport de fin — ne prétends pas avoir testé contre le vrai Supabase.
- À la fin : `npm install`, `npm test` (doit rester vert — indique le nouveau total), `npm run build` (corrige jusqu'à ce que ça passe), puis `git add -A && git commit -m "Supabase S1 : schéma + migration + RLS + adaptateur stockage (SQLite en fallback)"`.
- Mets à jour JOURNAL.md avec ce que tu as fait, les choix tranchés, et ce qui reste (procédure de création du projet, à faire en S2).
- Résume à la fin : fichiers créés/modifiés, tests (total et nouveaux), build OK ou non, limites honnêtes (notamment transaction / unicité tirage).

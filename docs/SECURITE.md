# Sécurité — inventaire et rotation des secrets (P2-S17)

> **Aucune valeur secrète réelle dans ce document** (ni PIN, ni clé, ni jeton) — seulement des
> procédures et des exemples de génération. Les valeurs de test (`1234`, …) citées dans
> `tests/rotation-secrets-p2-s17.test.ts` sont des valeurs de test, pas des secrets de production.
> **Aucune rotation réelle n'est faite par ce document** : chaque procédure est une suite d'actions
> manuelles (dashboard Render / Supabase / Brevo, ou API), à faire dans un créneau creux, commerçant
> prévenu, sauvegarde à jour (voir `docs/SAUVEGARDE.md`).

## 0. Deux choses différentes (revue Codex du plan, point 10)

- **Neutralisation du secret** : changer le secret — l'ancienne valeur ne fonctionne plus. C'est ce qui
  protège. Une rotation est une neutralisation.
- **Nettoyage de l'historique** : purger le secret de l'historique Git — cela ne neutralise **rien** à
  lui seul : tant que le secret n'est pas changé, l'ancienne valeur reste valable, même purgée de Git.
  Le nettoyage ne sert qu'après (ou avec) la neutralisation, pour que la valeur ne soit plus lisible
  dans le dépôt.

**Règle d'or** : un secret ne vit jamais dans le code ni dans un commit. Les variables Render sont
`sync: false` (`render.yaml`) : leurs valeurs ne sont pas dans le repo. Si un secret apparaît dans un
commit, le traiter comme **divulgué** : le neutraliser d'abord (rotation), puis nettoyer l'historique
(§ 4) — jamais l'inverse, jamais l'un sans l'autre.

**Règle Render (vaut pour toutes les procédures ci-dessous)** : les variables sont lues au démarrage
du serveur — changer une valeur ne suffit pas, il faut un **nouveau déploiement** : dans le dashboard
Render → service → **Environment**, choisir **« Save and deploy »** (le build existant suffit : les
secrets sont lus à l'exécution, pas au build — pas besoin de « Save, rebuild, and deploy »), attendre
que le déploiement soit **Live**, puis vérifier. **« Save only » ne déploie pas** (la valeur ne sera
utilisée qu'au prochain déploiement) et un simple **Restart** reprend les variables du déploiement
courant — ni l'un ni l'autre n'active la nouvelle valeur (doc Render « Environment Variables and
Secrets », vérifiée le 11/11/2026).

## 1. Inventaire des secrets

| Secret | Où il vit | Ce qu'il protège / signe | Lu quand | Rotation (§) |
|---|---|---|---|---|
| `SESSION_SECRET` | Variable Render (prod) ; `secretSession` en test | Jetons de session gérant/admin/équipe (HMAC, 8 h / 12 h) + jetons client + liens d'accès aux cartes | Au démarrage du serveur | § 2 |
| `SUPABASE_SERVICE_ROLE_KEY` | Variable Render + `.env` local (scripts) | Accès `service_role` à toute la base Supabase (contourne RLS) | Au démarrage du serveur ; à chaque exécution de `scripts/sauvegarde-base.mjs` | § 3 |
| `ADMIN_PIN` | Variable Render | PIN admin (création de commerces, réinitialisation des PIN) ; 4–12 chiffres, prod : ≥ 8, pas tous identiques (`server/index.ts`) | Au démarrage du serveur | § 4 |
| PIN commerce | Stocké : `pin_hash` scrypt (`commerces`) | Accès gérant (sessions, `X-Commerce-PIN`) | À chaque vérification (base) | § 4 |
| `PIN_ASIAN_HOME` | Variable Render | **Initialisation seulement** : PIN du commerce Asian Home à la création de la base vide (`server/index.ts`, `server/app.ts:839`) | À la 1re initialisation d'une base vide | § 4 (piège) |
| Codes équipe | Stockés : `code_hash` scrypt (`equipe`) | Accès équipe (sessions 12 h, caisse) | À chaque vérification (base) | § 5 |
| `GOOGLE_CLIENT_SECRET` | Variable Render | Dérive la clé AES-256-GCM des jetons Google Business stockés en `meta` (`google_business:<commerce>`) | Au démarrage (valeur capturée, utilisée à chaque opération) | § 6 |
| `BREVO_API_KEY` | Variable Render | Envois SMS / e-mail via Brevo | Au démarrage (valeur capturée, utilisée à chaque opération) | § 6 |
| `secret_desinscription` | Table `meta` (généré une fois, jamais en variable) | Liens de désinscription (HMAC commerce + client) | À chaque lien vérifié (valeur mémorisée par instance) | § 6 |
| `SUPABASE_URL` | Variable Render | Adresse de la base — **pas un secret**, mais va de pair avec la clé ci-dessus | Au démarrage | — |

**Non affectés par une rotation de `SESSION_SECRET`** (vérifié dans le code) : le PIN commerce (scrypt,
indépendant), les codes équipe (scrypt), les liens de désinscription (`secret_desinscription` en `meta`,
`server/app.ts`), les jetons Google Business (clé dérivée de `GOOGLE_CLIENT_SECRET`,
`server/google-business.ts`), les données clients.

**Générer un secret** (jamais à la main, jamais un mot) : `openssl rand -base64 48` (≥ 32 caractères
pour `SESSION_SECRET`, exigés en production — `server/index.ts` refuse un secret plus court).

## 2. Rotation de `SESSION_SECRET` — déconnexion de toutes les sessions

**Effet** : immédiat au redémarrage — **toutes** les sessions gérant/admin/équipe, **tous** les jetons
client et **tous** les liens d'accès (comptoir, « Retrouver ma carte ») deviennent invalides (signature
HMAC). Le serveur ne lit qu'un seul secret : il n'y a **pas de période de chevauchement** (ancien et
nouveau valables ensemble) — la rotation est atomique au redémarrage, avec déconnexion générale
assumée. Prévenir le commerçant avant.

**Procédure** (dashboard Render, service `asian-home-fidelite`) :

1. Générer le nouveau secret (`openssl rand -base64 48`) et le noter dans le coffre (pas dans un
   e-mail, pas dans un chat).
2. Render → service → **Environment** → `SESSION_SECRET` → nouvelle valeur → **« Save and deploy »**
   (règle Render, § 0) → attendre le déploiement **Live**.
3. Garder l'ancien secret 24 h dans le coffre (retour arrière possible : remettre l'ancienne valeur),
   puis le détruire.
4. **Vérifications** (juste après le redémarrage) :
   - `GET /api/v1/sante` → 200.
   - Ouvrir une session avec le PIN (`POST /api/v1/sessions`, rôle `commerce`) → **201**, puis
     `GET /api/v1/commerces/<id>/etat` avec le nouveau jeton → 200.
   - Ancien jeton de session → **401** sur `GET /api/v1/commerces/<id>/etat` ; ancien jeton client →
     **401** sur `GET /api/v1/cartes/<clientId>` avec `Authorization: Bearer <ancien jeton>` (pas sur
     `/etat` : cette route exige une authentification gérant/admin, le jeton client y serait refusé
     de toute façon).
   - Côté client : la carte rouvre avec un lien neuf (« Retrouver ma carte » ou comptoir) ; un lien
     émis avant la rotation → 401.
5. **Retour arrière** : remettre l'ancien `SESSION_SECRET` (coffre) → redémarrage → les anciens jetons
   non expirés redeviennent valables. Ne fonctionne que tant que l'ancien secret est conservé.

**Test local de la procédure** (fait dans ce lot, serveur de test SQLite — pas de staging, voir § 8) :
`tests/rotation-secrets-p2-s17.test.ts` — serveur avec secret A, session ouverte, puis même base
rouverte avec secret B : anciens jetons (gérant, admin, équipe, client) → 401, nouvelle session avec
le PIN (inchangé) → 201, état métier conservé (même commerce, même client, mêmes champs), retour
arrière vérifié (ancien secret remis → ancien jeton revit).

**Quand la faire** : secret divulgué ou soupçonné de l'être ; départ d'une personne ayant eu accès à
Render ; périodiquement (au moins 1 fois / an) ; après une rotation de `SESSION_SECRET`, **ne pas**
oublier que les liens d'accès clients émis avant sont morts — le comptoir doit réémettre des liens aux
clients qui se reconnectent sur un nouveau téléphone.

## 3. Rotation de `SUPABASE_SERVICE_ROLE_KEY`

**Effet** : l'ancienne clé ne fonctionne plus (dès sa révocation côté Supabase) ; l'app lit la clé au
démarrage — **un redémarrage est obligatoire** pour prendre la nouvelle valeur. Aucune donnée
touchée, aucune session touchée (les sessions dépendent de `SESSION_SECRET`, pas de cette clé).

**Procédure** — deux parcours selon le format de la clé (l'app accepte les deux :
`server/stockage-supabase.ts` — « Clé service_role (ou clé secrète `sb_secret_…`) ») :

**A. Nouveau format (`sb_secret_…`, à préférer)** — Supabase Dashboard → projet → **Settings → API**
→ créer une nouvelle clé secrète `service_role` (`sb_secret_…`), puis :

1. Render → service → **Environment** → `SUPABASE_SERVICE_ROLE_KEY` → nouvelle valeur → **« Save and
   deploy »** (règle Render, § 0) → attendre **Live**. Mettre à jour aussi le `.env` local utilisé par
   `scripts/sauvegarde-base.mjs` (sinon la prochaine sauvegarde échoue).
2. **Vérifications** : `GET /api/v1/sante` → `stockage: "supabase"`, `migrations` toutes à `true` ;
   `GET /api/v1/commerces/<id>/etat` (gérant) → 200 ; lancer `scripts/sauvegarde-base.mjs` → sauvegarde
   OK (elle utilise la nouvelle clé).
3. Désactiver / supprimer l'ancienne clé côté Supabase — seulement après l'étape 2 — puis vérifier
   qu'elle est bien refusée : `curl <SUPABASE_URL>/rest/v1/ -H "apikey: <ancienne clé>" -H
   "Authorization: Bearer <ancienne clé>"` → **401**. **Retour arrière** : remettre l'ancienne valeur
   sur Render (tant qu'elle n'est pas révoquée) → « Save and deploy ».

**B. Ancien format (clé legacy JWT `service_role`)** — une clé legacy ne se régénère pas
indépendamment : la rotation passe par le **JWT secret** (Supabase Dashboard → Settings → API → JWT
secret → régénérer), ce qui invalide **toutes** les clés legacy, `anon` comprise. Préférer le parcours
A (migrer vers `sb_secret_…`) quand le dashboard le permet ; sinon, appliquer le parcours A avec la
nouvelle clé issue du JWT secret régénéré, et vérifier en plus que les usages de la clé `anon` (s'il y
en a — l'app n'en utilise pas côté serveur) sont migrés. Vérifications identiques (étapes 2–3 du
parcours A).

**Non testé localement dans ce lot** : la clé n'est pas validée par le faux PostgREST des tests, et il
n'y a pas de projet Supabase de test ici — procédure à tester sur staging (§ 8). Ce qui est testable
sans Supabase : le refus de démarrer en production sans la clé (`server/index.ts`, P0-S9).

**Si la clé fuit** : elle contourne RLS — lecture/écriture de **toutes** les tables (clients, contacts,
tirages, journal). Rotation immédiate (§ ci-dessus) + vérification dans les logs Supabase (requêtes
inhabituelles) + prévention du commerçant ; si des données clients ont pu être lues, prévenir les
personnes concernées (RGPD, chapitre « RGPD » de `server/README.md`).

## 4. Rotation des PIN — et le piège `PIN_ASIAN_HOME`

### PIN commerce (le PIN du restaurant)

**Procédure** (la seule qui change le PIN enregistré) : gérant authentifié → `PUT
/api/v1/commerces/<id>/pin` avec `{ pin: "<nouveau PIN, 4 à 6 chiffres>" }` (route dans
`server/app.ts`, `pinNeuf`) — ou l'écran Réglages, qui appelle cette route. Effet immédiat : l'ancien
PIN → 401, le nouveau ouvre une session → 201. Le hash scrypt est réécrit en base ; l'ancien hash ne sert plus.

**Nuance à ne pas rater** (correction Codex point 3) : changer le PIN **invalide immédiatement toutes
les sessions de rôle « commerce » de CE commerce** — et seulement celles-là. Le jeton gérant porte la
version du PIN à l'émission (champ `vp`), comparée à chaque requête à la version stockée dans `meta`
(clé `version_pin:<commerce>`, absente = 0) ; `PUT /pin` l'incrémente, une session antérieure →
**401** (« le code du commerce a changé »). Les sessions **admin** et **équipe** ne sont **pas**
touchées (elles ne dépendent pas du PIN commerce), ni celles des autres commerces. La version vit en
base : elle tient après un redémarrage. Si la compromission peut inclure une session admin ou équipe
en cours, **combiner avec une rotation de `SESSION_SECRET` (§ 2)** — c'est elle qui révoque tout,
immédiatement. (La révocation unitaire existe aussi : `DELETE /api/v1/sessions` pour sa propre
session, et `POST /commerces/<id>/clients/<clientId>/revocation-acces` côté client.)

**`PIN_ASIAN_HOME` ne sert qu'à l'initialisation.** Changer la variable sur Render **ne remplace pas**
le PIN enregistré (il n'est lu qu'à la création d'une base vide, `server/app.ts:839`). Après un
`PUT /pin`, mettre la variable à jour quand même, pour cohérence — mais ce n'est pas elle qui fait la
rotation. (Revue Codex du plan, point 10.)

### `ADMIN_PIN`

Variable Render uniquement, lue au démarrage (`server/index.ts`, 4–12 chiffres, prod : ≥ 8, pas tous
identiques). Rotation : nouvelle valeur sur Render → **« Save and deploy »** (règle Render, § 0) →
vérifier `POST /api/v1/sessions` (rôle `admin`, nouveau PIN) → **201**, ancien PIN → 401. Même nuance
que ci-dessus, pour les sessions admin uniquement : la version de PIN ne concerne que le PIN commerce,
donc les sessions admin en cours (8 h) ne sont pas invalidées par le changement de `ADMIN_PIN` seul —
combiner avec § 2 si nécessaire.

### PIN dans l'historique Git (P0-S6, F-01)

Les PIN de production sont dans l'historique Git (commit `eedc463`, vérifié par `git log -S` — valeurs
non reproduites ici). **Risque accepté par l'utilisateur le 09/11/2026 (« laisse comme ça ») : ne rien
faire sans son OK explicite.**

Si OK un jour, dans cet ordre — **neutralisation d'abord, nettoyage ensuite** :

1. **Neutraliser** : changer les PIN (commerce via `PUT /pin`, admin via Render) **et** tourner
   `SESSION_SECRET` (§ 2, pour invalider les sessions ouvertes avec les anciens PIN). Vérifier que les
   anciens PIN → 401.
2. **Nettoyer** : purger les valeurs de tout l'historique (`git filter-repo` ou BFG, sur un clone
   miroir), puis **force-push** sur toutes les branches partagées ; chaque clone doit être re-créé
   (un clone ancien réintroduirait les valeurs au prochain push). Vérifier : `git log -S <valeur>`
   ne doit plus rien trouver — sans jamais écrire la valeur dans un document partagé.
3. Sans l'étape 1, l'étape 2 ne sert à rien (l'ancien PIN resterait valable) ; sans l'étape 2,
   l'étape 1 suffit à protéger l'accès, mais la valeur reste lisible par quiconque a le dépôt.

## 5. Rotation des codes équipe

Gérant authentifié → `PATCH /api/v1/commerces/<id>/equipe/<membreId>` avec `{ code: "<nouveau code
4 chiffres>" }` (ou `DELETE` le membre puis recréer). Effet immédiat (hash scrypt réécrit) ; le code
n'est jamais renvoyé ni journalisé en clair. Nuance (différente du PIN commerce, § 4 : pas de version de code
équipe) : les sessions équipe en cours (12 h) ne sont pas invalidées par le changement du code seul — combiner avec § 2 si une session
équipe est compromise. Précision : **supprimer puis recréer** le membre, lui, invalide ses sessions
(le membre n'existe plus : la session ne vaut plus rien, `server/app.ts`) — contrairement au simple
changement de code. Le réaffichage unique d'un code (`POST …/equipe/<id>/reaffichage`, PIN gérant
re-vérifié) n'est pas une rotation : il montre le code saisi par l'appareil, une seule fois.

## 6. Autres secrets

- **`BREVO_API_KEY`** : Brevo Dashboard → **Settings → API Keys** → créer une clé, puis Render →
  `BREVO_API_KEY` → **« Save and deploy »** (règle Render, § 0). Vérifier `GET /api/v1/sante` →
  `integrations.sms: true, email: true`, prestataire `Brevo` — ces booléens reflètent seulement la
  configuration locale, **ils ne valident pas la clé** : avant de révoquer l'ancienne clé, faire un
  envoi e-mail **sandbox Brevo** authentifié (`X-Sib-Sandbox: drop`, 201 + `messageId`, rien livré —
  procédure dans `docs/BREVO.md` § 5) ; le SMS en mode test est simulé sans appel réseau et ne valide
  pas la clé. Révoquer l'ancienne clé côté Brevo après vérification.
- **`GOOGLE_CLIENT_SECRET`** : Google Cloud Console → identifiants OAuth → régénérer le secret, puis
  Render → `GOOGLE_CLIENT_SECRET` → **« Save and deploy »** (règle Render, § 0). **Effet** : les jetons
  Google Business stockés en `meta` deviennent illisibles (clé AES dérivée du secret,
  `server/google-business.ts`) → le commerçant doit **reconnecter Google** (les anciens jetons ne
  servaient plus). Ne tourner que si le secret a fuité ou si la connexion Google doit être refaite.
- **`secret_desinscription`** (table `meta`, pas une variable) : pas de rotation prévue — pour
  invalider tous les liens de désinscription émis, supprimer la clé `secret_desinscription` de `meta`
  (elle est régénérée au prochain usage) **et redémarrer toutes les instances** : le secret est
  mémorisé par instance pour toute sa durée de vie (`server/app.ts`) — sans redémarrage, les anciens
  liens restent utilisables sur l'instance qui l'a déjà chargé. Vérifier : ancien lien → 404, nouveau
  lien fonctionnel.

## 7. En cas de fuite (procédure incident)

1. **Contenir** : rotation du secret concerné (§ 2–§ 6) — d'abord neutraliser, ensuite enquêter.
2. **Vérifier** : logs Render (`[lecture-sensible]` P2-S15 — rafale d'identifiants, `[securite]`
   BLOCAGE), journal de l'app (`GET /commerces/<id>/etat` → journal), logs Supabase (requêtes
   inhabituelles avec la clé `service_role`).
3. **Prévenir** : le commerçant immédiatement ; les clients concernés si des données clients ont pu
   être lues (RGPD).
4. **Ne pas effacer les preuves** avant l'enquête (logs, journal) ; noter l'heure de la rotation et ce
   qui a été vérifié.

## 8. Ce qui a été testé — et ce qui ne l'a pas été

**Testé localement dans ce lot** (serveur de test, base SQLite temporaire —
`tests/rotation-secrets-p2-s17.test.ts`, aucune variable Render touchée, aucun secret réel touché) :

- Rotation `SESSION_SECRET` : même base rouverte avec un nouveau secret — anciens jetons gérant,
  admin, équipe et client → 401, nouvelle session avec le PIN (inchangé) → 201, état métier conservé
  (même commerce, même client avec les mêmes champs : prénom, tampons, points), et retour arrière
  vérifié (l'ancien secret remis rouvre les anciens jetons non expirés). Non testés : les liens
  d'accès émis avant la rotation, les sessions déjà ouvertes côté navigateur du commerçant.
- Rotation PIN commerce (`PUT /pin`) : ancien PIN → 401, nouveau PIN → 201, **et** la session commerce ouverte
  avant le changement → 401 après (la nuance du § 4, vérifiée, pas supposée — aussi par
  `tests/correction-codex-point3.test.ts`).

**Statut du lot : validation staging restante** (critère `AUDIT.md` § 7 « 1 rotation testée sur
staging » non satisfait par les tests SQLite locaux — ils prouvent le mécanisme, pas la procédure en
conditions réelles). À conserver explicitement lors du suivi du lot.

**Reste à tester sur staging** — le staging n'existe pas encore (création navigateur côté agent
parent) :

- Rotation `SUPABASE_SERVICE_ROLE_KEY` contre le vrai Supabase (vérifier `/sante` + `/etat` +
  sauvegarde avec la nouvelle clé).
- Rotation `SESSION_SECRET` en conditions réelles : prévenir le commerçant, vérifier la reconnexion
  gérant + équipe + un client (lien neuf), mesurer le temps de coupure.
- Rotation `ADMIN_PIN` et `BREVO_API_KEY` en conditions réelles (même vérifications).
- Purge de l'historique Git (P0-S6) — seulement si l'utilisateur donne son OK.

## 9. Check-list avant toute rotation en production

- [ ] Sauvegarde à jour (`docs/SAUVEGARDE.md`) et vérifiée.
- [ ] Créneau creux choisi, commerçant prévenu (déconnexion générale pour § 2).
- [ ] Nouveau secret généré (`openssl rand -base64 48`) et rangé dans le coffre.
- [ ] Une seule rotation à la fois (pour savoir ce qui a cassé, si ça casse).
- [ ] Vérifications du § concerné faites et notées (heure, qui, résultat).
- [ ] Ancien secret conservé 24 h dans le coffre (retour arrière), puis détruit.
- [ ] Si le secret était dans Git : étape de nettoyage (§ 4, P0-S6) planifiée, avec l'OK utilisateur.

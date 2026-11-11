# AUDIT — Asian Home Fidélité — ÉTAPE 1 (MODE AUTONOME) — 10/11/2026

> **Statut : audit uniquement, lecture seule.** Un seul fichier écrit : celui-ci (`AUDIT.md`, racine du repo).
> Aucun autre fichier modifié, aucun commit, aucun push, rien touché en production.
>
> **Repo audité :** `~/workspace/fideliz-claude/`, HEAD `29a47f9` au début de l'audit. **Pendant l'audit,
> le travail Brevo de l'agent parallèle a été commité** (HEAD désormais `4862968` « Brancher Brevo : SMS via
> Brevo (Twilio en repli) + mode test ») — je n'ai rien touché à ces fichiers. **Les chiffres « 798/798 »
> correspondent donc au HEAD actuel, pas au HEAD 29a47f9 (788/788).**
>
> **Tests exécutés par moi pendant l'audit :** `npm test` → **798 tests, 0 échec** (~72 s). `npx tsc` non relancé
> (le JOURNAL du lot Brevo l'atteste propre ; à re-vérifier après commit de ce travail).
>
> **Production vérifiée en lecture le 10/11 ~22h15 CET :**
> `GET https://asian-home-fidelite.onrender.com/api/v1/sante` →
> `{"ok":true,"version":"0.1.0","mode":"production","stockage":"supabase","demo":false,"integrations":{"googleWallet":false,"appleWallet":"en_suspens","googleBusinessProfile":false,"sms":false,"email":false},"migrations":{"cartiz":true,"programme":true,"relances":true,"mesure":true}}`
> (donc : **Brevo non branché en production** — `sms`/`email` à `false` — malgré le code écrit en local).
> Page d'accueil en ligne lue via `browser.open` : écran de chargement inline affiché (« Chargement… » +
> « Connexion lente : merci de patienter quelques secondes. »), logo servi, HTTP 200 en ~1,2 s (service réveillé
> au moment de la lecture — **pas un test à froid**).
>
> **Consolide l'étape 0** (`docs/AUDIT-2026-11-10.md`, 312 lignes, HEAD `4ca83b6`, tests 235/235 à l'époque) :
> ses constats sont repris ci-dessous **seulement quand je les ai re-vérifiés dans le code actuel** ; les lots
> qu'elle proposait et qui ont été livrés depuis sont marqués LIVRÉ (avec la preuve lue) ; ce qui reste ouvert
> est repris dans le plan § 7. `docs/AUDIT-2026-11-10.md` reste la référence historique — ne pas le supprimer.
>
> **Méthode et honnêteté des constats :** lecture intégrale du code (serveur 2 827 lignes, front ~19 400 lignes
> hors `node_modules`), migrations 0001–0008, `render.yaml`, `dist/` construit, pages en ligne en lecture texte.
> Chaque constat est marqué **OBSERVÉ** (code lu / page lue / commande exécutée) ou **DÉDUIT** (calculé depuis le
> code, à confirmer sur téléphone réel). **Rendu réel 375/390 px sur téléphone jamais vérifié** : aucun navigateur
> sur cette VM, aucune capture possible — les constats « mobile » du § 2 sont donc des lectures de code
> (classes Tailwind, tailles en px) et des lectures texte des pages en ligne, pas des observations visuelles.
> La SPA ne rend rien côté serveur : `browser.open` ne voit que l'écran de chargement inline, jamais les écrans
> applicatifs.
>
> **Ce que je n'ai pas pu vérifier :** voir § 9 (liste exhaustive).

---

## Revue Codex du plan (10/11/2026) — intégrée le 11/11/2026

> **Source :** revue Codex du plan exécutée le 10/11/2026 en lecture seule (aucun fichier modifié),
> texte complet dans `/tmp/codex-revue-plan.txt`. Les 15 points ont été confrontés au code par Codex
> (citations fichier/ligne reprises ci-dessous) et **tous les 15 sont intégrés** dans cet audit :
> aucun point écarté. Les corrections factuelles qu'ils entraînent sont marquées
> « **CORRIGÉ (revue Codex, point N)** » à l'endroit concerné ; les nouveaux lots sont signalés
> « nouveau (revue Codex, point N) » dans le plan § 7.

| # | Point Codex (source) | Traitement |
|---|---|---|
| 1 | Priorités mal ordonnées : l'authentification client (S7), l'intégrité des écritures (S11) et la minimisation des données équipe (S14) doivent passer AVANT le thème (D1) et les photos. | **Intégré** — plan § 7 réordonné : P0-S7, P0-S11 et P0-S14 (promus P1 → P0) passent avant P0-D1 ; résumé § 0 mis à jour. |
| 2 | Plafond Supabase oublié : les lectures `clients()` et `tirages()` ne paginent pas (`server/stockage-supabase.ts:137`) — au-delà du plafond PostgREST, listes, exports et stats incomplets. | **Intégré** — nouveau lot P0-S18 (pagination serveur + écrans) ; nouveau risque R-11 (§ 3). |
| 3 | Erreur d'inventaire : le handler public renvoie `codeDuJour` (`server/app.ts:1663`) — la carte publique révèle donc un code gagnant. | **Intégré** — affirmation contraire corrigée aux § 1.3, § 2.2 et Annexe ; nouveau lot P0-S19 (retirer `codeDuJour` de la vue publique, ou le servir seulement au client authentifié concerné) ; nouveau risque R-10 (§ 3). |
| 4 | Périmètre d'authentification incomplet : P0-S7 doit aussi couvrir inscription d'un contact existant, tirage, récupération de carte et messages privés — pas seulement profil/rattrapage/suppression. | **Intégré** — périmètre de P0-S7 élargi (§ 7). |
| 5 | Migration des identifiants non prévue : passer à `randomUUID()` ne sécurise pas les cartes existantes. | **Intégré** — ajouté à P0-S7 : traitement des anciens liens, QR imprimés, liens courts et récupération, avec expiration et révocation des preuves d'accès. |
| 6 | Correction : les limites publiques utilisent des compteurs mémoire ; seule la protection contre les échecs d'authentification persiste en base. | **Intégré** — affirmations contraires corrigées aux § 1.2 et § 3 (F-04) ; nouveau lot P0-S20 (persistance des compteurs ou documentation explicite de la limite). |
| 7 | Désinscription SMS trompeuse : les messages disent « répondez STOP » alors que l'expéditeur alphanumérique Brevo ne reçoit aucune réponse (`server/notifications/brevo.ts:90-96`, `src/lib/relances.ts:42`). | **Intégré** — § 5 n° 6 corrigé ; nouveau lot P1-B9 : mécanisme de désinscription utilisable (lien) avant toute activation SMS, et correction du texte. |
| 8 | Validation Brevo contradictoire : séparer validation simulée (mode test) et recette réelle autorisée, avec destinataires définis. | **Intégré** — lot P1-B7 corrigé en conséquence (§ 7). |
| 9 | Google Business compté deux fois : les fonctions et routes existent déjà (`server/google-business.ts:229`) — le reste est configuration, approbation et recette réelle. | **Intégré** — inventaire « non développé » corrigé au § 5 n° 4 ; estimation du lot P1-B8 réduite de 16–24 h à 6–10 h. |
| 10 | Rotation des PIN mal définie : distinguer neutralisation du secret et nettoyage de l'historique ; `PIN_ASIAN_HOME` ne sert qu'à l'initialisation (changer la variable ne remplace pas le PIN enregistré) ; prévoir l'invalidation des sessions existantes. | **Intégré** — lots P0-S6 et P2-S17 précisés (§ 7) ; risque R-08 complété (§ 3). |
| 11 | Sauvegarde insuffisamment spécifiée : ajouter rétention, stockage indépendant, chiffrement, alertes d'échec, perte de données maximale (RPO) et délai de reprise (RTO) ; une restauration PGlite seule ne valide pas la restauration complète d'un environnement Supabase. | **Intégré** — lot P0-S5 complété (§ 7). |
| 12 | Rollback limité au code : redéployer le commit précédent ne restaure ni schéma, ni données, ni configuration. | **Intégré** — lot P0-S10 complété : compatibilité des migrations (chaque migration compatible avec l'ancien code et le nouveau) et procédure après écritures partielles ; risque R-02 complété (§ 3) ; note ajoutée au lot P0-S11 (ex-P1-S11, compensation ≠ transaction atomique). |
| 13 | Contrôle TypeScript serveur oublié : `tsconfig.json` n'inclut que `src`. | **Intégré** — nouveau lot P0-S21 (vérification des types du serveur, `tsc` sur `server/` ou `tsconfig` dédié), à exécuter à chaque lot ; nouveau risque R-12 (§ 3) ; item ajouté au § 9. |
| 14 | Architecture du thème contradictoire : définir UNE source effective du thème ; distinguer couleurs d'interface et couleurs configurables par commerce ; supprimer la contradiction « ancien thème sélectionnable » vs « zéro ancienne couleur » (décision : bascule complète, sans cohabitation). | **Intégré** — § 6.4 corrigé : `src/theme.ts` = source effective unique, `@theme` n'en est que le miroir ; bascule complète sans cohabitation. |
| 15 | Recette placée trop tard : ajouter une mesure initiale AVANT toute refonte (SCORES.md : parcours scan → lot en secondes/taps, bundle, Lighthouse si mesurable). | **Intégré** — nouveau lot P0-U0 (mesure initiale, avant toute refonte) ; note ajoutée au § 2.4 (le comptage DÉDUIT doit être remplacé par cette mesure). |

---

## 0. Résumé exécutif

**L'app est en bon état et largement au-dessus de l'étape 0.** Les 5 vagues livrées le 10/11 sont réelles et
vérifiées dans le code : PIN en scrypt + sessions HMAC 8 h/12 h + révocation persistante, anti-abus persistant
en base, vue publique minimale en liste blanche, CSP/HSTS/CORS stricts, fin de la page blanche, roue lisible
(12 caractères max), code gagnant vérifiable en caisse, menu officiel importé (16 catégories, 81 plats,
78 avec prix), relances préparées (Brevo choisi, code écrit — **mais pas encore branché en production**),
RGPD (export, suppression cascade, conservation 3 ans), PWA, FR/EN, bundle découpé (601,7 → ~450 Ko annoncés ;
mesuré : chunk initial 338 Ko + CSS 64 Ko, voir § 1.6), dashboard + entonnoir, SEO/OG.

**Les 5 problèmes les plus graves (détail § 7, lots P0) :**

1. **Aucune sauvegarde de la base de production** (Supabase Free : aucune sauvegarde, pause après 7 j
   d'inactivité). Une perte de base = perte totale (clients, tampons, tirages, journal). Seul filet actuel :
   export CSV manuel. — *Lot P0-S5, inchangé depuis l'étape 0.*
2. **PIN de production dans l'historique Git** (commit `eedc463`, confirmé présent par `git log -S` ; valeurs
   non reproduites ici). Risque accepté par l'utilisateur le 09/11 (« laisse comme ça ») — **ne rien faire
   sans son OK explicite**. — *Lot P0-S6, décision utilisateur en attente.*
3. **Aucune authentification client** : connaître un `clientId` suffit pour voir la carte, marquer les
   messages lus, compléter le profil, demander un rattrapage. L'ID reste prévisible
   (`cl-<timestamp ms base36>-<4 car. base36>`, `src/lib/fidelite.ts:37`, OBSERVÉ) — ~1,7 M de combinaisons
   par milliseconde. Le téléphone/e-mail n'est toujours pas vérifié (pas de SMS). **CORRIGÉ (revue Codex,
   point 3) :** la carte publique re-sert même le code gagnant du jour (`GET /cartes/:id`,
   `server/app.ts:1663`) — l'impact d'un `clientId` divulgué dépasse donc la consultation des tampons.
   — *Lot P0-S7 (périmètre élargi, voir § 7) + nouveau lot P0-S19 (retirer `codeDuJour` de la vue publique).*
4. **Intégrité des écritures et minimisation des données équipe** : transactions Supabase non atomiques
   (suites d'écritures interrompues non annulées) et `majCommerce` sans verrou optimiste (F-10) ;
   `GET /caisse` renvoie toujours le commerce brut + tous les clients (tél/e-mail) + journal à n'importe
   quel membre de l'équipe (F-13). — *Lots P0-S11 et P0-S14, promus P1 → P0 par la revue Codex (point 1) :
   ils passent avant le thème et les photos.*
5. **Render Free s'endort** (veille après 15 min, réveil ~1 min) : le 1er scan à froid d'un client aboutit
   toujours à l'écran « Chargement… / Connexion lente » pendant ~60 s. L'écran de chargement inline (P0-U1)
   atténue mais ne résout pas : le parcours < 30 s reste impossible à froid. — *Lot P0-U6, décision
   budgétaire (plan payant ~7 $/mois, prix à vérifier) ou keep-alive (non garanti).*

**DA actuelle ≠ DA décidée** (ne figure plus dans les 5 problèmes les plus graves — revue Codex,
point 1) : l'app est toujours noir + **doré** (`#c9a227`) + rouge laque, alors que l'utilisateur a décidé
le 10/11 ~22h14 **NOIR + MAGENTA** (le doré est remplacé ; le rouge laque ne reste qu'en accent secondaire
si cohérent). Le doré est en dur dans ~30 occurrences (`index.css`, composants, `titre-or`,
`attente-pulse`, `tampon-nouveau`) — sans fichier de thème unique, le changement sera dispersé et
régressera. — *Lot P0-D1, préalable à toute livraison visuelle, mais il ne passe plus avant la sécurité :
il vient après P0-S7, P0-S11 et P0-S14.*

**Le reste est du P1/P2, pas du bloquant :** menu quasi complet mais **0 allergène renseigné** et **~67 plats
sur 81 sans photo** ; Google Business (**CORRIGÉ, revue Codex point 9 :** les fonctions d'import des avis
et de publication des réponses existent déjà — `server/google-business.ts:229,283` — il reste
configuration, approbation et recette réelle, pas un développement de 16–24 h), Wallets / domaine / liens
de commande toujours non branchés (tous désactivés proprement par réglage, 501 explicites, rien de faux) ;
~200 occurrences de texte < 16 px persistantes (systémique, P2) ; `window.confirm()` natif encore présent
sur 8 écrans ; aucune mesure Lighthouse réelle (pas de `SCORES.md` dans le repo malgré la boucle
d'amélioration continue décidée le 10/11 ~22h15).

**Ordre recommandé (revue Codex, point 1) :** P0-S21 (contrôle TypeScript serveur, transversal — à mettre
en place avant le 1er lot de code, puis à chaque lot) ; puis P0-S5 (sauvegarde) — sans elle tout le reste
travaille sur une base non sauvegardée ; puis **P0-S7 (auth client) → P0-S11 (atomicité) → P0-S14 (vue
caisse minimale) → P0-S18 (pagination) → P0-S19 (codeDuJour hors vue publique) → P0-S20 (compteurs
persistants)** ; puis P0-S9/P0-S10 (garde-fous déploiement) ; puis P0-U0 (mesure initiale, avant toute
refonte) ; puis seulement P0-D1 (thème noir+magenta isolé, car il touche tous les écrans et doit précéder
les retouches visuelles) ; puis P0-U6 ; P0-S6 attend la décision utilisateur. Ensuite P1 menu/photos ;
puis P1 parcours client ; puis P1 fonctions de vente (Brevo en production, Google Business) ; puis P2.

---

## 1. Ce qui a été lu — stack, base, API, déploiement, tests, performance

### 1.1 Stack exacte (OBSERVÉ, `package.json`, `vite.config.ts`, `tsconfig.json`)

| Couche | Choix | Version / détail |
|---|---|---|
| Front | React 19 + TypeScript + Tailwind CSS 4 + Vite | `react 19.3.1`, `tailwindcss 4.3.5`, `vite 8.3.6`, `typescript 7.0.2` (type-stripping Node, pas de Vitest) |
| Routeur | Hash-router maison (`src/router.ts`, `src/App.tsx` 350 lignes) | Routes `#/jouer`, `#/carte`, `#/menu`, `#/roulette`, `#/caisse`, `#/clients`, `#/qr`, `#/avis`, `#/equipe`, `#/menuCarte`, `#/messages`, `#/reglages`, `#/confidentialite`, `#/desinscription`, `#/admin`, `#/offre`, `#/plus` |
| QR | `qrcode-generator` (génération), `jsqr` 1.4.0 (scan, chargé à la demande, 130 Ko) | Scan caméra via `BarcodeDetector` ou `jsqr` |
| Back | Node 24 **sans dépendance** (`server/`, `node:http` + `node:crypto` + `node:sqlite` en local) | `server/app.ts` **2 827 lignes** (routeur monolithique, fonction `router` ligne 1630), `server/index.ts` 113 lignes |
| Base prod | Supabase (Postgres) via `@supabase/supabase-js` 2.119.0 | `server/stockage-supabase.ts` 353 lignes ; fallback SQLite local `server/stockage.ts` 416 lignes |
| PWA | Manifest + service worker (`public/sw.js`, `public/manifest.webmanifest`) | Cache `no-cache` + ETag sur les statiques (re-vérifiés à chaque chargement) |
| Tests | `node --test` natif sur `tests/*.test.ts` + Playwright E2E | **798 tests, 0 échec** (exécuté par moi, ~72 s) ; E2E 1/1 non relancé par moi (voir § 9) |
| Déploiement | Render Free, Francfort, Blueprint `render.yaml` | Build `npm ci && npm run build:api`, start `npm run serveur`, health check `/api/v1/sante` |

**Points d'attention (OBSERVÉ) :**
- `server/app.ts` (2 827 lignes) est un monolithe : toute l'API, l'auth, les limites, le routeur et les
  intégrations y vivent. C'est lisible mais c'est le fichier à plus haut risque de régression — chaque lot
  qui le touche doit être couvert par les tests serveur existants (ils le sont largement, voir § 1.5).
- `README.md` est **partiellement obsolète** : il dit encore « Base de production Supabase : projet PAS créé »
  et « Hébergement : pas fait, rien n'est déployé » alors que la production est en ligne depuis le 09/11.
  Le `server/README.md` a été mis à jour par les vagues, le `README.md` racine non. (Lot P2-Q5, 1 h.)
- `dist/` présent dans le repo (2,5 Mo, construit le 10/11 21h05) — il est servi par Render depuis le build,
  pas depuis le repo ; sa présence ne gêne pas mais il ne doit pas être confondu avec la source.

### 1.2 Schéma base de données — migrations 0001–0008 (OBSERVÉ)

Toutes appliquées en production (vérifié via `/sante` : `migrations {cartiz, programme, relances, mesure}` à
`true`). 14 tables, JSONB `donnees` + colonnes de recherche.

| Migration | Tables | Points clés (OBSERVÉ) |
|---|---|---|
| 0001 | `meta`, `commerces` (`id` PK, `ordre` identity, `pin_hash`, `pin_sel`, `version`), `clients` (UNIQUE `(commerce_id, cle_contact)`), `tirages` (index unique 1 tirage/jour, jour à Paris), `avis` | Trigger `incrementer_version()` ; tout le métier en JSONB |
| 0002 | — | RLS activée sur les 5 tables, **AUCUNE policy**, `revoke all … from anon, authenticated`, `grant … to service_role` |
| 0003 (Cartiz) | `equipe` (`code_hash`/`code_sel`), `journal`, `menus` | RLS + mêmes revoke/grant |
| 0004 (programme) | `parrainages` (CHECK `parrain_id <> filleul_id`), `demandes_rattrapage` | RLS + mêmes revoke/grant |
| 0005 | `sessions_revoquees` (+ index sur `expire_le`) | Révocation des jetons persistante ; **a un script DOWN** (nouveauté : 0005–0008 ont des `.down.sql`, 0001–0004 n'en ont pas) |
| 0006 | `tentatives_auth` (+ index sur `derniere_tentative`) | Anti-bruteforce persistant (IP + cible) |
| 0007 (relances) | `envois` (index unique 1 envoi/jour par modèle+client) | Journal des envois Brevo/Twilio |
| 0008 (mesure) | `evenements_jour` | Compteurs d'entonnoir anonymes (scan, tirage, gain, clic Google) |

**Faits vérifiés :**
- PIN : **scrypt** désormais (`scrypt$v1$<128 hex>`, N=16384, r=8, p=1, sel 64 o — `server/app.ts:171-183`) ;
  ancien format SHA-256 1 itération **toujours accepté** mais re-haché en scrypt au 1er accès réussi
  (migration transparente, best-effort). F-02 de l'étape 0 = **LIVRÉ**.
- Sessions : jetons `v1.<base64url(JSON)>.<HMAC-SHA256(SESSION_SECRET)>`, signés non chiffrés, durées
  **commerce/admin 8 h, équipe 12 h** (`DUREE_SESSION_S`, ligne 223). Révocation en base (0005) + repli
  mémoire si la table manque. `POST /sessions` (échange PIN → jeton), `DELETE /sessions` (révocation).
  **Si `SESSION_SECRET` absente en production, le serveur démarre quand même** et `POST /sessions` répond
  503 — le PIN en en-tête reste alors utilisé (dégradation silencieuse voulue, mais à surveiller : la
  variable est posée sur Render depuis le 10/11 ~19h42 selon la mémoire — **non vérifiable depuis ici**,
  `/sante` ne l'expose pas, et c'est normal).
- Anti-abus public (`LIMITES_PUBLIQUES`, lignes 75-99) : lectures 120/min/IP, 30/min/carte ;
  inscriptions 10/min/IP, 5/min/contact ; tirages 20/min/IP, 5/min/contact ; fiches 10/min/IP ;
  `POST /sessions` 30/min/IP. **CORRIGÉ (revue Codex, point 6) :** ces limites utilisent des
  **compteurs en mémoire** (`creerCompteursPublics`, `server/app.ts:876`) — remises à zéro à chaque
  redémarrage du serveur (donc à chaque réveil Render) et non partagées entre instances. **Seule la
  protection contre les échecs d'authentification persiste en base** (`tentatives_auth`, migration 0006).
  F-04 de l'étape 0 = **LIVRÉ partiellement** (limites en place, mais non persistantes — lot P0-S20) ;
  seuils non calibrés en conditions réelles (voir § 3, R-07).
- **Limites connues du schéma (OBSERVÉ) :**
  - Aucun chiffrement applicatif au repos (dépend du chiffrement Supabase) ; tél/e-mail en clair en JSONB.
  - SQLite local : ni index unique 1 tirage/jour, ni FK, ni colonne `version` — l'anti-double-tirage y
    repose sur la sérialisation des transactions (écart dev/prod assumé, documenté).
  - Transactions Supabase non atomiques (suites d'écritures interrompues non annulées) — F-10 étape 0,
    **toujours ouvert**.
  - `majCommerce` sans verrou optimiste côté Supabase (écrasement silencieux en concurrence) — **toujours ouvert**.
  - Journal/traces parrainage-rattrapage silencieusement perdus si migration absente (`console.warn`) — **toujours ouvert**.

### 1.3 Routes API `/api/v1` — inventaire (OBSERVÉ, routeur `server/app.ts:1630+`)

Le routeur est une fonction unique sans framework : dispatch sur `ressource / id / sous / sousId / action`.
J'ai reconstruit l'inventaire depuis les conditions de dispatch (`sous ∈ {avis, caisse, clients, donnees,
envois, equipe, etat, evenements, export.csv, google, logo, lus, menu, messages, mesures, pin, purge,
stop-sms, suppression, tirages}`, `action ∈ {export.csv, message-prive, pass.json, prenom, profil,
publier-reponse, rattrapage, reaffichage, recompense, relance, remise, visite}`) — **je n'ai pas relu
chaque branche une par une** : le tableau ci-dessous est donc un inventaire de dispatch, pas une
relecture ligne à ligne de chaque handler.

| Groupe | Routes (méthode × chemin) | Auth | Données / effet |
|---|---|---|---|
| Santé | `GET /sante` | publique | `{ok, version, mode, stockage, demo, integrations, migrations}` — fingerprinting minimal (version 0.1.0 exposée) |
| Sessions | `POST /sessions`, `DELETE /sessions` | PIN/code en corps | Échange PIN → jeton HMAC ; révocation |
| Cartes publiques | `GET /cartes/:id`, `POST /cartes/retrouver`, `POST /cartes/:id/lus`, `POST /cartes/:id/donnees`, `POST /cartes/:id/suppression` | **publique, sans auth** (voir § 3, F-03) | **CORRIGÉ (revue Codex, point 3) :** carte sans contact, **mais `GET /cartes/:id` re-sert le code gagnant du jour** (`codeDuJour`, `server/app.ts:1663`) — l'affirmation « sans code gagnant » de l'audit initial était fausse. Marquage lus ; export RGPD ; demande de suppression. Correctif : lot P0-S19. |
| Commerces publics | `GET /commerces`, `GET /commerces/:id`, `GET /commerces/:id/menu` | publique | **Vue publique minimale en liste blanche** (`src/lib/vuePublique.ts`) : probabilités des lots, `reglesReponseAuto`, `eurosParPoint`, `messagesAuto`, `creeLe` retirés. F-05 étape 0 = **LIVRÉ**. Conservés (affichés au client) : catalogue (nom+coût+description), paliers/niveaux/offre/parrainage-filleul, apparence, `conservationMois` |
| Inscription / jeu | `POST /commerces/:id/clients`, `POST /commerces/:id/tirages`, `POST /commerces/:id/clients/:id/profil`, `POST …/rattrapage`, `POST …/message-prive` | publique OU commerçant | Inscription (oracle `existant`, voir § 3) ; tirage décidé serveur, 409 différenciés (`sansVisite` / `dejaJoue`) ; profil après 2e visite ; demande de rattrapage |
| Admin | `POST /commerces` | `X-Admin-PIN` ou session admin | Crée un commerce + PIN |
| Commerçant | `PATCH /commerces/:id`, `GET /commerces/:id/etat`, `PUT /commerces/:id/pin`, `GET /commerces/:id/export.csv`, `PUT /commerces/:id/menu`, `GET /commerces/:id/logo` (+ upload logo), `GET /commerces/:id/mesures`, `GET /commerces/:id/evenements`, `GET /commerces/:id/envois` | session commerce / PIN commerce / admin | `etat` = commerce brut + **tous les clients (tél/e-mail inclus)** + tirages + avis + membres + journal (200). `PUT /pin` : seule route sans appel HTTP en test (étape 0, toujours vrai — à couvrir) |
| Équipe | `GET/POST /commerces/:id/equipe`, `PATCH/DELETE /commerces/:id/equipe/:membreId`, `POST …/equipe/:id/reaffichage` | commerçant | Membres, code jamais renvoyé ; réaffichage du code avec PIN gérant |
| Caisse | `GET /commerces/:id/caisse`, `POST …/caisse/{passage, recompense, echange, attente, reserve}`, `POST …/clients/:id/visite`, `POST …/clients/:id/recompense`, `POST …/code` (vérification + remise, P0-U3) | équipe (session/code 4 chiffres) ou commerçant | Tampon + points, idempotent via `actionId`, `faitLe` accepté si < 72 h ; **la route historique `visite` n'applique toujours pas « 1 tampon/jour »** (seule la caisse l'applique) — F-11 étape 0, **toujours ouvert** |
| Clients (commerçant) | `PATCH /commerces/:id/clients/:id`, `POST …/rattrapage/:demandeId`, `POST …/purge` | commerçant | Anniversaire/plat préféré ; valider/refuser rattrapage ; purge RGPD |
| Messages / avis | `GET/POST /commerces/:id/messages`, `POST /commerces/:id/avis`, `PATCH /commerces/:id/avis/:id`, `POST …/avis/:id/publier-reponse` | commerçant | 100 derniers messages avec contact ; dépôt ciblé ; `publier-reponse` → 501 sans Google Business |
| Relances | `POST /commerces/:id/clients/:id/relance`, `POST /commerces/:id/stop-sms`, `GET /c/:clientId` (lien court → `#/carte/:id`) | commerçant (relance) | 501 sans prestataire ; 409 sans consentement / déjà envoyée aujourd'hui ; Brevo choisi (voir § 5) |
| Wallet | `GET /commerces/:id/clients/:id/pass.json` | commerçant | 501 sans compte émetteur Google Wallet |
| Google | `GET/POST …/google/*` (connexion, import avis) | commerçant | 501 sans `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` |
| Désinscription | `POST /desinscription` | jeton HMAC en corps | Retrait du consentement relance |

**Validation d'entrées (OBSERVÉ) :** listes blanches de champs (`PATCH /commerces/:id` : champ inconnu → 400),
corps limités (menu ≤ 3 Mo), `Cache-Control: no-store` sur l'API, erreurs 500 génériques, PIN/hash jamais
renvoyés, codes équipe jamais journalisés. **Non vérifié en profondeur :** chaque handler (taille du
routeur) — une relecture handler par handler reste à faire dans un lot P0-S8 (voir § 7).

### 1.4 Déploiement Render (OBSERVÉ, `render.yaml` + `server/index.ts`)

- 1 service web, plan **free**, région **frankfurt**, Node 24, build `npm ci && npm run build:api`,
  start `npm run serveur`, health check `/api/v1/sante`.
- Secrets `sync: false` : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PIN`, `PIN_ASIAN_HOME`,
  `SESSION_SECRET`, `CORS_ORIGIN`. **Aucun secret dans le repo** (vérifié : `render.yaml` sans valeur).
- Garde-fous au démarrage (OBSERVÉ, `server/index.ts`) : `ADMIN_PIN` obligatoire en production (8 chiffres
  min, pas tous identiques) ; `SESSION_SECRET` ≥ 32 car. si posée ; `CORS_ORIGIN` absente → CORS `*` avec
  avertissement (le front servi par le même service n'est pas concerné, même origine).
- **Bascule silencieuse** : si les variables Supabase manquent, le serveur bascule sur **SQLite éphémère**
  (sauf si une seule des deux est posée → refus de démarrer). En production Render, une suppression
  accidentelle de `SUPABASE_URL` ferait donc repartir l'app **vide** sans erreur visible côté client.
  (Lot P0-S9 : refuser de démarrer en production sans Supabase, ou `/sante` en alerte.)
- En-têtes de sécurité : CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy présents
  (1 occurrence chacun dans `server/app.ts`, OBSERVÉ). F-08 étape 0 (aucun en-tête) = **LIVRÉ**.
- Statiques : `Cache-Control: no-cache` + ETag → 304 (re-vérifiés à chaque chargement ; un nouveau
  déploiement est pris dès le rechargement). Pas de `max-age` long — chaque visite retélécharge les
  en-têtes, pas les corps (304). Correct, perfectible (voir § 1.6).
- **Aucune sauvegarde, aucun staging, aucun rollback en une commande** : pas de service de staging Render,
  pas de procédure de retour arrière documentée (la décision MODE AUTONOME l'exige : staging séparé +
  retour arrière en une commande — **à créer**, lot P0-S10).
- Logs : 11 `console.*` dans `server/app.ts` (erreurs 500 + blocages sécurité en `console.warn`). Aucun
  log structuré, aucune alerte (ni mail, ni webhook) sur les blocages ou les 500. (Lot P2-Q6.)

### 1.5 Tests existants — couverture et trous (OBSERVÉ, exécution + lecture des noms)

- **798 tests, 0 échec** (exécuté par moi). Répartition par fichier (35 fichiers `tests/*.test.ts`) :
  logique métier, serveur HTTP réel (SQLite temporaire), Supabase simulé (faux PostgREST), migration SQL
  sur vrai Postgres (PGlite 18.6), front V2 (fetch simulé), intégrations V3, sécurité S1–S4, Cartiz,
  programme, relances (dont 10 nouveaux tests Brevo, commit `4862968`), RGPD, menu officiel, photos, bundle,
  SEO, render.yaml, E2E Playwright **hors** `npm test` (1/1, non relancé par moi — voir § 9).
- **Ce qui est bien couvert (OBSERVÉ) :** déduplication contact (tous formats), 1 tirage/jour (y compris
  autour de minuit, heure d'hiver/été), tirage pondéré + secteur de roue, anti-bruteforce (429), sessions +
  révocation, vue publique minimale, CSP, consentement relance non pré-coché, RGPD (export/suppression/
  conservation), menu officiel (81 plats, prix, photos PDF), bundle (seuils de taille), SEO/OG.
- **Ce qui n'est PAS testé (OBSERVÉ, par lecture des fichiers de tests et de l'étape 0) :**
  - `PUT /commerces/:id/pin` : **seule route sans appel HTTP en test** (toujours vrai).
  - Le reste de l'interface React (écrans du gérant, animation de la roue, rendu visuel) — seul l'E2E
    couvre le parcours scan → gain → carte.
  - Aucun test de charge / de seuils de rate limiting en conditions réelles (wifi du restaurant partagé).
  - Aucun test de la bascule silencieuse SQLite (variables Supabase manquantes).
  - Aucun test de restauration de sauvegarde (il n'y a pas de sauvegarde).
  - Aucun test visuel / capture mobile (aucun navigateur sur la VM).
  - Les tests ne couvrent pas d'envoi réel Brevo côté **production** (aucun envoi réel, voir § 5).

### 1.6 Bundle et performance (OBSERVÉ, `dist/` construit le 10/11 21h05)

| Asset | Taille (non gzipée) | Note |
|---|---|---|
| `index-*.js` (chunk initial) | **337 881 o** | React + app ; les pages sont en `React.lazy` (chunks séparés visibles : `Admin`, `Avis`, `Clients`, `Reglages` 32 Ko, `TableauDeBord`, `ui` 118 Ko, `MenuPublic`, `MenuCarte`…) |
| `index-*.css` | 63 606 o | Tailwind 4 |
| `jsQR-*.js` (différé) | 129 986 o | Chargé à la demande (scan) — correct |
| `menu-reel-*.js` | 13 666 o | Menu officiel en chunk séparé — correct |
| **Total `dist/`** | **2,5 Mo** (dont visuels) | — |

- L'étape 0 mesurait un bundle unique de 463 Ko ; les vagues ont découpé (annonce 601,7 → 450,2 Ko au
  total). **Je ne peux pas confirmer le « 450,2 Ko »** : je mesure 338 Ko de JS initial + 64 Ko de CSS
  (402 Ko) + chunks à la demande. L'ordre de grandeur est cohérent, le chiffre exact dépend de la
  définition (gzip ? total ? initial ?). À figer dans `SCORES.md` avec une définition unique.
- **Pas de compression dans le code** (aucun middleware gzip/br) — compression éventuelle par le proxy
  Render, **non vérifiable depuis ici**.
- **Polling 10 s → 30 s (P1-P1, LIVRÉ 11/11/2026)** : le front recharge tout l'état toutes les 30 s (page visible) + au retour au premier
  plan + après chaque action (`src/store.tsx`, `INTERVALLE_RECHARGEMENT_MS = 30_000`). Mesure locale en vrais octets UTF-8
  (`tests/egress-p1-p1.test.ts`, 150 clients / 100 visites / journal 100 entrées, 1 onglet visible 12 h/j, 30 j) : HTTP
  `/etat` 69 210 o + `/commerces` 1 088 o = 70 298 o par rechargement → **9,11 Go/mois à 10 s, 3,04 Go/mois à 30 s** ;
  côté PostgREST (lignes lues avec les colonnes sélectionnées : `id,version,donnees` pour clients, `donnees` pour tirages /
  journal — proxy de l'egress Supabase, pas la mesure dashboard) : 81 037 o par rechargement → **3,50 Go/mois à 30 s**,
  sous les 5 Go gratuits. Mesure à 300 clients : 4,68 Go HTTP / 5,60 Go PostgREST à 30 s — seuil 5 Go côté PostgREST vers
  ~257 clients (pente mesurée sur deux volumes, 324 o/client) : un rechargement différentiel restera à prévoir à ce volume.
  Exclusions : un 2e onglet double le rechargement périodique ; la minuterie caisse 15 s (`GET /caisse`, 240 o) ne pèse que
  0,02 Go/mois. La roue garde sa propre vérification espacée de 10 s après chaque réponse (`INTERVALLE_VERIFICATION_MS`,
  recul jusqu'à 60 s après échecs, hors latence) : déblocage inchangé par le lot. **Reste : l'egress réel dans le dashboard
  Supabase** (pas d'accès navigateur sur cette VM).
- Premier affichage : écran de chargement inline en CSS pur (`index.html`, `src/chargement.css`) + logo +
  message « Connexion lente » — P0-U1 **LIVRÉ**. Mais à froid (Render endormi), le JS met ~60 s à arriver :
  l'écran inline ne fait qu'attendre poliment. Voir § 2, écran « Toutes ».

---

## 2. Parcours mobile 375 px — écran par écran (lecture du code + pages en ligne)

**Rappel de méthode :** aucun rendu réel vérifié. Les constats ci-dessous sont des lectures de code
(classes Tailwind → géométrie DÉDUITE) et des lectures texte des pages en ligne (qui ne montrent que
l'écran de chargement, la SPA étant 100 % JS). Les largeurs/hauteurs en px sont calculées, pas mesurées.

**Ce qui est bon partout (OBSERVÉ, à ne pas casser) :** boutons/champs `min-h-12` (48 px) presque partout ;
`viewport-fit=cover` + `safe-area-inset-bottom` ; `text-sm` relevé à 16 px (0,941 rem) pour le contenu ;
vouvoiement constant ; états vides soignés ; messages d'erreur `role="alert"` ; squelettes de chargement
(`src/components/Squelette.tsx`) ; `prefers-reduced-motion` respecté (roue à 0 ms, pas de confettis) ;
focus visible 3 px.

### 2.1 Toutes les pages — premier chargement (P0)

| Problème | Preuve (OBSERVÉ) | Correction | Impact |
|---|---|---|---|
| Render Free endormi ≈ 1 min : le 1er scan à froid affiche « Chargement… / Connexion lente » ~60 s | `render.yaml` plan `free` ; page en ligne lue à chaud (200 en 1,2 s) — **le cas à froid n'a pas été observé**, il est DÉDUIT de la doc Render + de l'étape 0 | Plan Render payant (prix exact à vérifier, sources tierces ~7 $/mois) OU keep-alive (non garanti, consomme les 750 h gratuites) OU écran d'attente avec progression honnête (« Le serveur se réveille, ~1 min ») | **P0** — tue le parcours < 30 s au 1er client du jour |
| Aucun contenu utile avant le JS (SPA sans SSR) | `browser.open` de `/` ne retourne que l'écran de chargement | Prérendu statique des pages publiques (`#/menu`, `#/jouer`) ou à minima métadonnées servies | P1 — SEO + partage de lien |

### 2.2 Parcours client

**#/jouer (inscription + roue + gain)** — `src/pages/Jouer.tsx` 932 lignes, `src/components/Roue.tsx`,
`src/lib/roue.ts`, `src/lib/animationRoue.ts`.

| Problème | Preuve | Correction | Impact |
|---|---|---|---|
| Roue : libellés désormais limités à 12 car. (`MAX_CARACTERES_ROUE = 12`, OBSERVÉ) avec compteur « X/12 caractères » dans Réglages — P0-U2 étape 0 **LIVRÉ**. Reste : police ~15 px à 375 px (DÉDUIT, `roue.ts:7`) sur des secteurs étroits ; les libellés longs restent tronqués par conception | `src/lib/roue.ts:10,44,96` | Légende sous la roue avec les libellés entiers (option déjà prévue : affichage `libelle`/`numero`/rien) | P1 — lisibilité résiduelle |
| Rotation 3,6 s (`DUREE_ROTATION_MS = 3600`, OBSERVÉ — l'étape 0 mesurait 4,5 s, amélioré) + pause résultat ; confettis CSS 60 fps, vibration | `src/lib/animationRoue.ts:6` | Ne pas allonger ; garder | OK |
| Code gagnant : **re-servi par l'API** (`Jouer.tsx:536,590` : `codeDuJour` relu) et **vérifiable en caisse** (`Caisse.tsx:671+` : champ « Code gagnant (6 caractères) », vérification + « Marquer remis ») — P0-U3 **LIVRÉ** pour la caisse. Validité « jour du tirage » affichée (`Jouer.tsx:818`). **CORRIGÉ (revue Codex, point 3) :** cette re-serve passe par le handler public `GET /cartes/:id` (`server/app.ts:1663`) : quiconque connaît un `clientId` obtient le code gagnant du jour sans authentification — c'est une fuite, pas seulement une commodité pour le titulaire. | OBSERVÉ | Retirer `codeDuJour` de la vue publique, ou ne le servir qu'au client authentifié concerné (lot P0-S19) | **P0 — fuite** |
| Cul-de-sac avant validation : texte inversé + état « en attente de validation… » animé (point doré pulsant, `attente-pulse`) — P0-U4 **LIVRÉ**. Reste : le point pulsant est **doré** (`bg-or-400`) — il deviendra magenta au lot D1 | `src/index.css` | Changer la couleur dans le thème, pas le comportement | P1 (DA) |
| Inscription : 1 seul champ obligatoire (téléphone OU e-mail), clavier adapté, « Continuer en tant que… » = 1 tap pour le client connu ; prénom demandé après le tirage côté client mais **obligatoire côté commerçant** — incohérence P1-C1 **toujours ouverte** | `src/pages/Jouer.tsx`, `src/pages/Clients.tsx` | Aligner : prénom optionnel partout | P2 |
| Consentement relance : case **non pré-cochée**, une ligne — LIVRÉ (P1-B3). Vérifier qu'elle reste visible sans scroll sur petit écran | `src/lib/relances.ts`, tests | — | OK |
| `text-xs` : **0 occurrence** dans `Jouer.tsx` (OBSERVÉ, grep) — bon | — | — | OK |

**#/carte (carte de fidélité)** — `src/pages/CartePublique.tsx` 510 lignes, `src/components/CarteFidelite.tsx`.

| Problème | Preuve | Correction | Impact |
|---|---|---|---|
| Hero + photos : bannière `hero-plats.jpg` en eager ; la carte (tampons/QR) est sous ~700 px de scroll à 375 px (étape 0, DÉDUIT — **non re-mesuré**, le code a changé depuis) | `src/lib/visuels.ts:79` | Hero `h-48` + `loading=lazy` sauf logo ; mesurer réellement | P1 — à re-vérifier sur téléphone |
| Encart Wallet « Carte Wallet : bientôt » = un bloc entier pour annoncer une absence (toujours présent, `src/lib/integrations.ts:4` `LIBELLE_WALLET`) | OBSERVÉ | Replier en une ligne tant que rien n'est branché | P1 |
| Formulaires programme (anniversaire + rattrapage) affichés d'emblée avant les CTA Roue/Menu (étape 0 — **non re-vérifié ligne à ligne**) | — | Replier en `<details>` fermés | P1 |
| Messages marqués lus dès l'ouverture (badge fantôme) — étape 0, **non re-vérifié** | — | Marquer lu au scroll / après 3 s | P2 |
| Suppression de carte : `window.confirm()` natif (`CartePublique.tsx:407`) | OBSERVÉ | Modale custom `<Confirmation>` | P2 |

**#/menu (menu public)** — `src/pages/MenuPublic.tsx` 311 lignes.

| Problème | Preuve | Correction | Impact |
|---|---|---|---|
| **Prix désormais affichés** (78/81 plats, voir § 4) — P1-B1 **LIVRÉ**. Reste : 3 plats « Prix sur place » (voir § 4) | `src/data/menu-reel.ts` | Prix à confirmer (voir § 8) | P1 |
| **0 allergène renseigné** (voir § 4) ; pied de page « demandez conseil à l'équipe » | OBSERVÉ | Saisie des allergènes (lot P1-M2) | P1 — obligation d'information |
| **~67 plats sur 81 sans photo** (voir § 4) | OBSERVÉ | Photos (lot P1-M3) | P1 |
| Boutons commander Deliveroo/Uber Eats : **codés mais absents** (liens vides en production — `src/lib/menuClient.ts:95-109` : affichés seulement si renseignés, jamais inventés — bon) | OBSERVÉ | Liens à demander (voir § 8) | P1 |
| Recherche réinitialise catégorie + plat ouvert à chaque frappe ; catégories en scroll horizontal sans indicateur (étape 0 — **non re-vérifié**) | — | Ne pas réinitialiser la catégorie | P2 |
| `text-xs` : 3 occurrences (OBSERVÉ) ; badge Signature `text-[11px]` 11 px (étape 0, **non re-vérifié**) | grep | Badge ≥ 12 px | P2 |

**#/roulette (page commerçant)** — `src/pages/Roulette.tsx` 77 lignes : renvoie vers `#/jouer`, affiche
le code du jour. Pas de friction propre identifiée par lecture ; à tester sur téléphone.

### 2.3 Espace commerçant

**Tableau de bord** — `src/pages/TableauDeBord.tsx` 239 lignes + `src/components/Mesure.tsx` 389 lignes.
12 chiffres en grilles `grid-cols-2` (mobile) / `md:grid-cols-4` (OBSERVÉ) ; coût des lots désormais
totalisé (`coutsParLot`, gains sans coût signalés « le total est un minimum » — P2-Q3 **LIVRÉ**, sous
réserve du coût unitaire renseigné, voir § 8). Entonnoir anonyme (scan → tirage → gain → clic Google)
alimenté par `evenements_jour` (migration 0008). Reste : densité mobile (6 chiffres clés suffiraient) ;
`text-xs` aides 12,75 px.

**#/caisse** — `src/pages/Caisse.tsx` 764 lignes. Points vérifiés (OBSERVÉ) :
- Champ « Code gagnant (6 caractères) » + vérification + remise (P0-U3 LIVRÉ) ; mode dégradé hors ligne
  « code déjà vu » (`src/lib/codeDuJour.ts:69,93`) — le matin, 1re vérification en ligne requise.
- File hors ligne (`src/lib/fileCaisse.ts`) avec `actionId` idempotent — le bug « passages restés dans la
  file, jamais envoyés » a été corrigé (commit `1abb028`, E2E 1/1).
- **Restent :** `window.confirm()` natif pour les échanges/récompenses (à remplacer par `<Confirmation>`,
  composant existant) ; bouton « Valider une récompense » désactivé sans explication (aide « encore X
  tampon(s) » à ajouter) ; scanner : pas de bouton « Saisir le prénom » visible si caméra refusée
  (recherche manuelle en dessous, hors écran) ; `text-xs` : 0 occurrence (OBSERVÉ, bon).

**#/clients** — `src/pages/Clients.tsx` 455 lignes. Liste non paginée (étape 0 — **non re-vérifié**) ;
export CSV en 2e CTA pleine largeur ; prénom obligatoire côté commerçant (incohérence, voir #/jouer) ;
`window.confirm()` pour les échanges de points (`FicheClient.tsx:49,125,221`).

**#/reglages** — `src/pages/Reglages.tsx` 721 lignes. **Amélioré depuis l'étape 0 :** les grilles
`grid-cols-3` sont devenues `grid-cols-1 sm:grid-cols-3` (lignes 320, 358, 410, OBSERVÉ) — la friction
majeure est corrigée. **Restent :** formulaire-fleuve (8 fieldsets, ~40 champs, un seul bouton Enregistrer)
— découpe en sous-pages toujours à faire (P1-C6) ; compteur « X/12 caractères » présent (bon) ;
sélecteur d'apparence (couleur/fond/bannière) avec contrôle de contraste — **c'est le point d'ancrage du
thème noir+magenta** (voir § 6).

**#/avis** — `src/pages/Avis.tsx` 499 lignes. Aucun avis importé, aucune réponse publiée (Google non
branché — voir § 5) ; éditeur de brouillons à recopier à la main ; `window.confirm()` pour déconnecter
Google (`Avis.tsx:256`) ; 2 `<details>` + règles + filtres avant la liste (~2 écrans de scroll).

**#/equipe** — `src/pages/Equipe.tsx` 248 lignes. Bouton « réafficher le code une fois » avec PIN gérant
**livré** (route `reaffichage`, OBSERVÉ) ; `window.confirm()` pour retirer un membre (`Equipe.tsx:146`).

**#/messages** — `src/pages/Messages.tsx` 254 lignes. **Friction majeure persistante :** aucun envoi réel
(Brevo non branché en prod) — copier le texte + copier les contacts séparément, puis envoyer ailleurs ;
le commerçant croit avoir « envoyé » (le libellé doit préciser la portée du dépôt — partiellement fait
dans le travail Brevo (commit `4862968`). `window.confirm()` pour déposer un message (`Messages.tsx:147`).

**#/menuCarte** — `src/pages/MenuCarte.tsx` 348 lignes. Bouton « Charger la carte officielle » avec
**sauvegarde auto du brouillon en CSV avant remplacement** (OBSERVÉ, `MenuCarte.tsx:86` — le risque
d'écrasement de l'étape 0 est couvert) ; import/export CSV (colonnes `categorie;nom;prix;description;
photo;allergenes`) ; `window.confirm()` pour supprimer une catégorie (`MenuCarte.tsx:218`).

**#/qr (vitrine)** — `src/pages/QrVitrine.tsx` 46 lignes. Aucune consigne de taille d'impression ni test
de scannabilité (étape 0, non re-vérifié) ; URL en `text-xs break-all`.

**#/admin** — `src/pages/Admin.tsx` 283 lignes. En mode démo local, tout est accessible sans PIN ;
bouton « Réinitialiser la démo » destructeur à 1 tap + `window.confirm()` (`Admin.tsx:31`) — exiger le
mot « RÉINITIALISER » tapé (P2, démo seulement).

### 2.4 Comptage des taps — parcours comptoir (DÉDUIT du code, non mesuré sur téléphone)

Client nouveau, visite du jour, caisse déverrouillée : **~7–8 taps + 1 saisie** (scan QR → inscription
2 taps + saisie → caisse 3 taps → « Tourner la roue » 1 tap → « Voir ma carte » 1 tap), 2 allers-retours
téléphone↔comptoir, ~10 s d'attente de déblocage + 3,6 s de rotation → **~25–35 s réelles à chaud,
hors file d'attente** (légèrement mieux que les 30–45 s de l'étape 0, grâce à la rotation raccourcie).
Caisse verrouillée : +5 taps. Client connu : inscription = 1 tap. **À froid (Render endormi) : +~60 s —
l'objectif < 30 s est alors impossible.** Ce comptage est DÉDUIT ; il doit être mesuré sur téléphone
réel (lot P1-U1, protocole dans `SCORES.md` à créer). **Revue Codex, point 15 :** cette mesure doit être
faite **AVANT toute refonte** (nouveau lot P0-U0, mesure initiale) — mesurée après, elle ne fournit plus
aucune référence avant/après ; les critères observables sont à définir avant les changements.

### 2.5 Textes < 16 px et zones tactiles (OBSERVÉ par grep)

- `text-xs` : **18 occurrences** dans `src/` (contre ~200 occurrences < 16 px comptées à l'étape 0 tous
  formats confondus — la mesure n'est pas comparable : l'étape 0 comptait `text-xs` + `text-sm` +
  `text-[11px]` ; `text-sm` vaut désormais 16 px par le thème, donc le résidu réel est `text-xs` +
  `text-[11px]`). Les 18 `text-xs` restants sont des étiquettes/pastilles/surtitres — conformes à la règle
  posée dans `index.css` (« réservé aux étiquettes et micro-textes décoratifs »), **sauf** les aides et
  les URL (voir § 2.3).
- `text-[11px]` : badge Signature (à vérifier), `text-[10px]` : non compté séparément.
- Zones tactiles : interrupteurs Réglages 32 px et cases 20–24 px signalés à l'étape 0 — **non re-vérifiés** ;
  les cases à cocher ont désormais une zone de 44×44 px (`.zone-case`, OBSERVÉ dans `index.css`).
- **Contraste gris-500 :** `#6b7280` sur `#f7f5f2` = **4,44:1** (calculé par moi, voir § 6) — **sous les
  4,5:1 AA**, de 0,06 point. À corriger en assombrissant le gris de texte (lot P2-Q1).
- **Écart de mesure :** le commentaire CSS affirme que l'or `#c9a227` sur `#111111` vaut « ≈ 8,9:1 » ;
  **mon calcul donne 7,81:1** (voir § 6). Toujours AA, mais le chiffre du commentaire est faux — à
  corriger quand on touche au thème (ne pas inventer de ratios : les recalculer).

---

## 3. Sécurité restante — ce que le P0 n'a pas couvert

L'étape 0 listait F-01 à F-16. **Statut re-vérifié :**

| # | Gravité | Faille (étape 0) | Statut 10/11 (OBSERVÉ) |
|---|---|---|---|
| F-01 | Critique | PIN prod dans l'historique Git (`eedc463`) | **TOUJOURS OUVERT** — confirmé présent par `git log -S`. Risque accepté par l'utilisateur le 09/11. Ne rien faire sans son OK. Voir lot P0-S6. |
| F-02 | Critique | PIN SHA-256 1 itération | **LIVRÉ** — scrypt N=16384 + re-hachage transparent. |
| F-03 | Haute | Aucune auth client, `clientId` prévisible | **TOUJOURS OUVERT** — `cl-<ts base36>-<4 car.>` inchangé (`src/lib/fidelite.ts:37`) ; routes cartes publiques sans auth. Nouveau lot P0-S7. |
| F-04 | Haute | Aucun rate limiting public | **LIVRÉ partiellement — CORRIGÉ (revue Codex, point 6)** — limites par IP/contact/carte **en mémoire** (`server/app.ts:876`), remises à zéro au redémarrage ; seule la protection contre les échecs d'authentification persiste en base (0006). Seuils non calibrés en réel. Lot P0-S20. |
| F-05 | Haute | Exposition publique de la config commerciale | **LIVRÉ** — liste blanche `vuePublique.ts`. |
| F-06 | Haute | Anti-bruteforce en mémoire, remis à zéro au réveil | **LIVRÉ** — persistant en base (`tentatives_auth`, 0006), blocage IP + cible (attaque distribuée). |
| F-07 | Haute | Aucune sauvegarde | **TOUJOURS OUVERT** — voir § 0, problème n° 1. Lot P0-S5. |
| F-08 | Moyenne | Aucun en-tête de sécurité, CORS `*` | **LIVRÉ** — CSP/HSTS/X-Frame/X-CTO/Referrer ; CORS strict si `CORS_ORIGIN` posée (posée sur Render le 10/11 ~19h42 selon la mémoire — non vérifiable ici). |
| F-09 | Moyenne | PIN envoyé à chaque requête, sans session | **LIVRÉ** — sessions HMAC 8 h/12 h + révocation. Le PIN en en-tête reste accepté en repli (si `SESSION_SECRET` absente → 503 sur `/sessions`). |
| F-10 | Moyenne | Transactions Supabase non atomiques, `majCommerce` sans verrou, journal perdu si migration absente | **LIVRÉ par P0-S11 (11/11/2026)** — verrou optimiste sur `majCommerce` (PATCH réglages, logo), journal / traces programme jamais avalés + démarrage Supabase refusé sans 0003 / 0004, ordre métier-puis-journal rétabli (parrainage, caisse, rattrapage). **Nuance : compensation, pas transaction** — une suite d'écritures interrompue entre deux requêtes PostgREST n'est toujours pas annulée (voir `server/README.md` « Atomicité (P0-S11) »). |
| F-11 | Moyenne | Route `visite` sans garde « 1 tampon/jour » | **LIVRÉ (P1-S12, 11/11/2026)** — même garde que la caisse (`passageAvecProgramme`), route gardée (passage rapide sans achat), boutons désactivés côté front, jour calendaire explicite à Paris des deux côtés. |
| F-12 | Moyenne | Oracles d'énumération (`existant`, 409 différenciés, 404 vs 409) | **TOUJOURS OUVERT** — les 409 différenciés (`sansVisite`/`dejaJoue`) sont un choix produit (message client utile) ; l'oracle `existant` sur `POST /clients` demeure. Lot P2-S13 (uniformiser les messages). |
| F-13 | Moyenne | Code équipe 4 chiffres partagé → `GET /caisse` donne tous les clients + journal | **PARTIELLEMENT OUVERT** — le code est désormais scrypt + sessions équipe 12 h + anti-bruteforce persistant, mais `GET /caisse` renvoie toujours le commerce brut + tous les clients (tél/e-mail) + journal à n'importe quel membre. Lot P0-S14 (vue caisse minimale, promu P1 → P0, revue Codex point 1). |
| F-14 | Faible | Fuite via `/sante` + 404-avant-401 | **TOUJOURS OUVERT, faible** — `/sante` expose version/mode/stockage/migrations/intégrations (fingerprinting assumé, utile au diagnostic). |
| F-15 | Faible | Bug 503 au lieu de 401 si 0003 absente | **Non re-vérifié** (0003 appliquée en prod ; cas théorique). |
| F-16 | Faible | Polling 10 s → ~8 Go/mois d'egress (estimation non mesurée) | **LIVRÉ (P1-P1, 11/11/2026, mesuré localement, en octets UTF-8)** — intervalle 10 s → 30 s : HTTP `/etat` 69 210 o + `/commerces` 1 088 o = 70 298 o par rechargement (150 clients, 100 visites, journal 100 entrées, `tests/egress-p1-p1.test.ts`) → **9,11 Go/mois à 10 s, 3,04 Go/mois à 30 s** (1 onglet visible 12 h/j, 30 j) ; côté PostgREST (proxy : lignes lues, colonnes sélectionnées) 81 037 o → **3,50 Go/mois à 30 s**, sous les 5 Go gratuits ; à 300 clients 5,60 Go PostgREST — seuil 5 Go vers ~257 clients (pente sur deux volumes, 324 o/client : un rechargement différentiel restera à prévoir à ce volume). **Reste à mesurer : l'egress réel dans le dashboard Supabase** (pas d'accès navigateur sur cette VM). |

**Nouveaux risques identifiés à l'étape 1 (OBSERVÉ) :**

- **R-01 — Bascule silencieuse SQLite en production** (§ 1.4) : variables Supabase manquantes → app vide
  sans erreur. Gravité : haute (perte apparente de toutes les données). Lot P0-S9.
- **R-02 — Aucun staging, aucun rollback** (§ 1.4) : chaque déploiement Render va droit en production.
  La décision MODE AUTONOME exige un staging séparé + retour arrière en une commande. **Revue Codex,
  point 12 :** redéployer le commit précédent ne restaure ni schéma, ni données, ni configuration — le
  « rollback en une commande » ne couvre que le code. Lot P0-S10 (compatibilité des migrations +
  procédure après écritures partielles).
- **R-03 — `ADMIN_PIN` de développement `000000` et PIN commerce `1234`** en dur comme valeurs par défaut
  hors production (`server/index.ts`) : correct en local, mais **tout démarrage hors Render sans variables
  expose ces PIN** — ne jamais lancer le serveur en mode démo sur un hôte exposé. Documenté, pas un bug.
- **R-04 — Jetons de session signés, non chiffrés** : le contenu (rôle, commerce, expiration) est lisible
  par qui possède le jeton — acceptable (pas de donnée sensible dedans, vérifié par lecture du code de
  `lireJeton`), mais à ne pas enrichir sans chiffrement.
- **R-05 — Aucune journalisation des accès en lecture** : `GET /cartes/:id` et `GET /commerces` ne sont
  pas journalisés — une énumération de cartes ne laisserait aucune trace (seuls les échecs d'auth le sont).
  Lot P2-S15 (journal des lectures sensibles, échantillonné).
- **R-06 — RGPD : purge non automatique.** La conservation (3 ans par défaut, réglable 6 mois–10 ans) est
  appliquée **manuellement** : l'écran Clients liste les cartes à purger, le commerçant confirme — **rien
  ne purge seul**. Conforme au texte affiché, mais la purge dépend d'un geste humain régulier. Lot P1-G1
  (rappel périodique) ou accepter explicitement.
- **R-07 — Seuils de rate limiting non calibrés en réel** : 10 inscriptions/min/IP — un restaurant avec
  30 clients sur le même wifi 4G en soirée pourrait déclencher des 429. Aucun retour terrain. Lot P1-S16
  (journal des 429 + ajustement après 2 semaines d'usage réel).
- **R-08 — Rotation des secrets : aucune procédure.** `SESSION_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`,
  `ADMIN_PIN`, `PIN_ASIAN_HOME` : pas de rotation planifiée, pas de procédure documentée (que faire si la
  clé service_role fuit ?). **Revue Codex, point 10 :** distinguer neutralisation du secret (changer le
  PIN / la clé — l'ancien secret ne fonctionne plus) et nettoyage de l'historique (purger le secret de
  Git — ne neutralise rien à lui seul) ; noter que **`PIN_ASIAN_HOME` ne sert qu'à l'initialisation**
  (changer la variable ne remplace pas le PIN déjà enregistré — il faut `PUT /pin` ou une rotation
  explicite) ; prévoir l'invalidation des sessions existantes lors d'une rotation. Lots P0-S6 / P2-S17.
- **R-09 — Logs applicatifs** : 11 `console.*`, pas d'alerte sur 500/blocages. Une attaque ou une panne ne
  serait vue que dans les logs Render, consultés manuellement. Lot P2-Q6.
- **R-10 — Code gagnant publiquement accessible (revue Codex, point 3)** : `GET /cartes/:id` re-sert
  `codeDuJour` (`server/app.ts:1663`) sans authentification — un `clientId` divulgué donne le code gagnant
  du jour, utilisable en caisse avant son titulaire. Gravité : haute. Lot P0-S19.
- **R-11 — Plafond PostgREST non paginé (revue Codex, point 2)** : `clients()` et `tirages()` dans
  `server/stockage-supabase.ts:137` ne paginent pas — au-delà du plafond PostgREST, listes, exports CSV
  et statistiques sont silencieusement incomplets. Paginer l'écran Clients ne suffit pas : c'est la
  lecture serveur qu'il faut paginer. Lot P0-S18.
- **R-12 — Aucun contrôle TypeScript du serveur (revue Codex, point 13)** : `tsconfig.json` n'inclut que
  `src` — le serveur (`server/`, ~2 800 lignes, fortement modifié par plusieurs lots) n'est jamais
  vérifié par `tsc` ; les tests HTTP ne remplacent pas cette vérification. Lot P0-S21 (à chaque lot).

---

## 4. Menu actuel vs carte officielle (OBSERVÉ, `src/data/menu-reel.ts` + `docs/MENU-OFFICIEL-2026-11-10.md`)

Le menu officiel a été importé (lot P1-B1 **LIVRÉ**) : **16 catégories, 81 plats** (`menuReelAsianHome()`),
dont 78 de la carte officielle + 3 hors carte gardés. C'est le menu de repli public tant que le menu
enregistré du commerce est vide (cas de la production au 10/11 — **non vérifié en base**, le menu
enregistré du commerce en production n'est pas lisible depuis ici ; `#/menuCarte` → « Charger la carte
officielle » la publie côté commerçant).

| Vérification | Résultat (OBSERVÉ) |
|---|---|
| Plats avec prix | **78/81** (prix en centimes, ex. Riz Thaï 890, Maki Gold 10000) |
| Plats sans prix (`prix: null`) | **3** : **Thaï-sty Krusty**, **Bœuf Basilic**, **Boisson 33cl** — tous en catégorie « Hors carte (prix à confirmer) ». Affichés « Prix sur place ». |
| Allergènes renseignés | **0/81** — tous les plats ont `allergenes: []`. Le code valide les allergènes contre une liste (`ALLERGENES`, `src/lib/menu.ts:78-80`) mais aucun n'est saisi. Pied de page `#/menu` : « Allergènes : demandez conseil à l'équipe en cas de doute. » |
| Photos | **9 plats avec photo PDF WebP** (`PHOTOS_PDF` : pokeBowl, dynamite, miPrat, padThai, croustiPoulet, khaoPrat, curryVert, tigreQuiPleure, boBun — vignette + pleine) **+ 5 JPG anciennes** (loc-lac, makis, mango-sticky-rice, nouilles-crevettes, plat-riz — dont `menu-makis.jpg` partagée par 2 plats). **Soit ~13–14 plats avec photo sur 81, ~67 sans photo.** (Comptage par références de fichiers ; les appels `plat()` multilignes rendent le comptage ligne à ligne imprécis — à confirmer par un test de comptage.) |
| Descriptions | 77/81 lignes avec une description (4e argument non vide) ; 1 description vide comptée ; les descriptions viennent de la carte / Uber Eats selon le plat. |
| Badges Signature | **6** : Dynamite, Thaï-sty Krusty, Love Bao, Loc Lac, 8 Maki Chicken Dragon, 8 Maki Tiger (`PLATS_SIGNATURE`). |
| Catégories | 16 : Salades & accompagnements, California x6 — option Crispy +0,50 €, Maki Green/Black/Neige/Pink x6, Sashimi, Sushi x2, Poke Bowl, Entrées thaï, Plats thaï, Menu Midi (lundi au vendredi), Spécialités du chef, Desserts, Boissons, Hors carte (prix à confirmer). |
| Formules | Menu Midi (4 formules : Midi Asian 13,90, Asian Love 13,90, Banh Mi 9,90, Menu Enfant 9,90 — soda offert + accompagnement au choix) et Poke Bowl (bases + 8 garnitures) sont représentés **comme des produits avec description**, pas comme des formules composables — choix assumé, documenté dans l'étape 0, **toujours d'actualité**. |
| Variantes makis/california | Modélisées en produits distincts (7 California, 6 Green, 6 Black, 4 Neige, 5 Pink, 4 Sashimi, 4 Sushi) — l'étape 0 comptait ~55 lignes absentes ; **désormais présentes**. |

**Les 2 prix À VÉRIFIER (toujours ouverts, § 8) :**
1. **Riz Thaï 8,90 €** — incohérent avec Riz Nature 2,50 € ; un avis client cité dans `docs/MENU-REEL.md`
   se plaignait déjà d'une « portion de riz à 8 € » — plausible mais à confirmer.
2. **6 Maki Gold 100,00 €** — ~15× le prix des autres makis (6,00–6,90 €) et des spécialités (13,90 €) ;
   probable coquille pour 10,00 € — **à vérifier impérativement avant tout affichage** (il est affiché
   aujourd'hui à 100,00 € dans le menu public si le menu de repli est servi).

**Plats hors carte (3) :** Thaï-sty Krusty (chevauchement probable avec Crousti Poulet 14,90 — fusion ou
renommage à valider), Bœuf Basilic (aucun équivalent sur la carte — servi encore ?), Boisson 33cl
(équivalents probables : Soda 3,50 ou Evian/San Pellegrino 2,90 — à remplacer par les boissons détaillées).

**Photos manquantes par catégorie (DÉDUIT du comptage) :** toutes les variantes California/Maki (28 plats),
Sashimi/Sushi (8), Entrées thaï hors Dynamite, Desserts hors Mango Stick, Boissons (8), Menu Midi (4).
Seuls les plats thaï principaux et le Poke Bowl sont illustrés. Les photos du PDF Heyzine ont été extraites
(18 WebP annoncées — 9 plats × 2 tailles) ; **aucune autre photo du PDF n'est exploitable** (les autres
images du PDF sont des légendes douteuses — ex. Love Bao — ou des photos d'ambiance, non des plats).

---

## 5. Ce qui n'est pas encore développé / désactivé par réglage (OBSERVÉ)

Inventaire exhaustif des 501 / 404 / « bientôt » / « à brancher » dans le code et dans `/sante`
(état au 10/11 ~22h15, **production** — le code Brevo commité (`4862968`) ne change rien à la production
tant qu'il n'est ni déployé ni configuré sur Render).

| # | Fonctionnalité | État en production (OBSERVÉ) | Ce qu'il faut pour brancher |
|---|---|---|---|
| 1 | **Relances SMS / e-mail (Brevo)** | Route `relance` → **501** (`/sante` : `sms: false, email: false`). Code **écrit, testé et commité le 10/11 au soir** (commit `4862968`, `server/notifications/brevo.ts`, `docs/BREVO.md`, `tests/brevo-sms.test.ts`, 798/798). **Aucun compte Brevo, aucune clé, aucun envoi réel.** | Compte Brevo + clé API + expéditeur e-mail validé + expéditeur SMS (`BREVO_SMS_SENDER`, ≤ 11 car., ex. `ASIANHOME`) + 4 variables Render (`BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `BREVO_SMS_SENDER`) + achat de crédits SMS + test e-mail réel vers yassbybibiche@gmail.com (procédure `docs/BREVO.md` §3–5). Coûts relevés le 10/11 : e-mail gratuit 300/j, SMS France ~0,045 € HT **à confirmer sur la page tarifs**. Twilio reste en repli SMS si Brevo SMS absent. |
| 2 | **Google Wallet** | `pass.json` → **501** ; aucun pass généré ; encart client « Carte Wallet : bientôt », aucun bouton d'ajout | Compte émetteur Google Wallet → `GOOGLE_WALLET_ISSUER_ID` ; projet Google Cloud + API Google Wallet activée ; compte de service + clé JSON (Secret File Render) ; approbation Google ; **mise à jour de l'objet à chaque tampon (non écrite)** |
| 3 | **Apple Wallet** | **En suspens** (décision utilisateur 09/11) ; code `.pkpass` réel prêt (`server/wallet-apple.ts`) mais **branché sur aucune route → 404** ; `/sante` : `en_suspens` ; jamais testé avec un vrai certificat | Décision explicite de l'utilisateur ; compte **Apple Developer Program 99 $/an** ; Team ID ; Pass Type ID ; certificat Pass Type + clé privée PEM ; certificat WWDR ; images icon/logo (+@2x) ; **route + service web de mise à jour (APNs) à écrire** |
| 4 | **Google Business Profile (avis)** | Aucun appel à Google ; avis saisis à la main, réponses à copier sur Google ; `publier-reponse` → 501 ; `/sante` : `googleBusinessProfile: false` | Compte Google propriétaire/gestionnaire de la fiche ; projet Google Cloud **approuvé par Google** pour les API Business Profile (formulaire, examen, délai inconnu) ; OAuth 2.0 scope `business.manage` ; **CORRIGÉ (revue Codex, point 9) : import des avis + publication des réponses DÉJÀ DÉVELOPPÉS** — fonctions `listerAvisGoogle` / `publierReponseGoogle` (`server/google-business.ts:229,283`) et routes `google/*` existantes ; l'affirmation « non développés » de l'audit initial était fausse. Reste : configuration, approbation Google, recette réelle. (Le lien « écrire un avis » direct **est** configuré : `placeid=ChIJAV70Kqxt5kcRnhPY0L6yaf0`.) |
| 5 | **SMS Twilio (repli)** | Adaptateur codé, jamais exécuté contre Twilio ; 501 si Brevo absent et Twilio absent | Compte Twilio + `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`. Coût à vérifier. |
| 6 | **Consentement relance** | **Recueilli** (case non pré-cochée, consentement daté, retrait possible) — LIVRÉ. **CORRIGÉ (revue Codex, point 7) :** le texte de chaque SMS, `MENTION_STOP_SMS = 'STOP : répondez STOP'` (`src/lib/relances.ts:42`), est **trompeur** : avec l'expéditeur alphanumérique Brevo, le client ne peut pas répondre au SMS et Brevo ne reçoit aucun STOP (`server/notifications/brevo.ts:90-96`). Le code n'est donc pas « déjà fait » côté SMS : il manque un mécanisme de désinscription utilisable (lien dans chaque SMS). La route `stop-sms` répond 501 explicite quand les SMS partent via Brevo (webhook réservé à Twilio). E-mails : lien de désinscription existant (`#/desinscription/<client>/<jeton HMAC>` + en-têtes `List-Unsubscribe`). | **Lot P1-B9 : LIVRÉ (11/11/2026)** — lien court `/d/<client>/<jeton HMAC>` dans chaque SMS (`STOP : <lien>`), même jeton que les e-mails, désinscription de bout en bout testée ; textes visibles corrigés. |
| 7 | **Suppression d'un client (RGPD)** | **LIVRÉ** — bouton « Supprimer ce client… » (fiche client) + demande depuis la carte (`POST /cartes/:id/suppression`), cascade journalisée, export CSV individuel | — |
| 8 | **Mise à jour des passes Wallet à chaque tampon** | Non écrite (Google : objet non mis à jour ; Apple : service web + push APNs non écrits) | Développement au moment du branchement Wallet (lots 2–3) |
| 9 | **Sauvegarde complète / import** | Pas de route de sauvegarde complète ni d'import ; seul l'export CSV clients existe | Lot P0-S5 (voir § 7) |
| 10 | **Domaine personnalisé** | `https://asian-home-fidelite.onrender.com`, aucun domaine propre ; SEO/OG livrés (P2-Q4) mais la SPA hash-router reste faiblement indexable | Nom de domaine (~5,99 € 1re année OVH, rien acheté) + DNS + certificat (Render gère le certificat) + mise à jour des QR imprimés |
| 11 | **Liens Deliveroo / Uber Eats** | Codés (`lienDeliveroo`, `lienUberEats` dans `Commerce` + `boutonsMenu`), **vides en production** — aucun lien inventé (bon) | Liens à demander (voir § 8) |
| 12 | **Paiements** | Absents (aucun code, aucun 501 — simplement non développés) | Décision produit (hors périmètre actuel ; écarté par l'utilisateur) |
| 13 | **Géolocalisation / commande avec paiement / points contre avis Google** | Écartés par l'utilisateur (points contre avis interdits par Google) | — |

**Autres « pas encore » (OBSERVÉ) :** aucun `TODO`/`FIXME`/`XXX`/`HACK` dans `src/` ni `server/` (grep) ;
`server/README.md` dit encore par endroits que Supabase n'est « pas encore créé » (obsolète, voir § 1.1) ;
le mode démo local simule avis/SMS/e-mail/Wallet (étiqueté « Démo — … ») ; `SCORES.md` (boucle
d'amélioration continue décidée le 10/11 ~22h15) **n'existe pas dans le repo** — à créer avant le 1er tour
de la boucle.

---

## 6. Design system NOIR + MAGENTA — proposition (décision utilisateur 10/11 ~22h14)

**Décision :** la DA devient **NOIR + MAGENTA, comme la carte du restaurant**. Le doré `#c9a227` est
**remplacé** ; le rouge laque `#B3262D` reste en accent secondaire **seulement si cohérent**, sinon il est
remplacé proprement. La DA doit être **isolée derrière une configuration** pour que l'utilisateur puisse
la changer.

### 6.1 Ce qui existe aujourd'hui (OBSERVÉ)

- Le thème vit dans **`src/index.css` `@theme`** (couleurs `marque-*`, `or-*`, `nuit-*`, `neon-500`,
  `fond`, typographies, ombres) + **classes composants** (`.bouton`, `.bouton-secondaire`, `.carte`,
  `.hero-sombre`, `.titre-or`, `.puce-sombre`, `.puce`, `.attente-pulse`, `.tampon-nouveau`, `.surtitre-sombre`).
- L'apparence **par commerce** (`src/lib/apparence.ts` : `couleur`/`fond`/`bannière`, contrôle de contraste
  ≥ 4,5:1, défauts `COULEUR_DEFAUT = #b3262d`, `FOND_DEFAUT = #fbf8f3`) ne couvre que la **carte de
  fidélité**, pas l'app entière.
- Le doré est en dur dans **~30 occurrences** (`or-400`/`or-300` dans `index.css`, `Roue.tsx`,
  `Jouer.tsx`, `CarteFidelite.tsx`, `TableauDeBord.tsx`…) + des hex en dur (`#5e1317` dans le dégradé
  de la roue, `#111111`/`#1b1b22` dans `.hero-sombre`). **Il n'y a pas de fichier de thème unique.**
- Le magenta existe déjà comme **décor uniquement** : `--color-neon-500: #ff4d6d` (« lumière rose/magenta
  du soir — décor uniquement, jamais en texte », `index.css:20`) et `--color-violet-nuit: #3b2d8f`.
  La carte du restaurant (Heyzine) est noire + magenta — **la teinte magenta exacte de la carte n'a pas
  été relevée** (le PDF n'a pas été relu par moi ; voir § 9) : les valeurs ci-dessous sont des choix
  vérifiés par le calcul de contraste, pas un relevé de la carte.

### 6.2 Palette proposée — contrastes calculés par moi (formule WCAG, script Python, OBSERVÉ)

| Rôle | Valeur | Contraste (calculé) | Usage |
|---|---|---|---|
| Fond principal (client) | `#111111` noir | blanc dessus 18,9:1 | Fonds d'écrans client, héros |
| Surface | `#1B1B22` noir bleuté | blanc dessus ~17:1 | Cartes sur fond noir |
| Surface 2 | `#26262E` | blanc dessus ~15:1 | Cartes secondaires, champs sombres |
| Fond clair (commerçant) | `#F7F5F2` ivoire (conservé) | texte `#111827` dessus ~15:1 | Back-office (lisibilité de travail) |
| **Magenta texte sur noir** | `#FF2E9A` | **5,49:1** sur `#111111` ✅ AA | Titres, surtitres, liens, prix en avant sur fond noir |
| **Magenta texte sur noir (doux)** | `#FF4D6D` (existant `neon-500`) | **5,88:1** sur `#111111` ✅ AA | Accents secondaires, halos, décor texte |
| **Magenta bouton (fond) + texte blanc** | `#D1006F` | blanc dessus **5,33:1** ✅ AA | Bouton primaire sur fond noir ET sur fond clair |
| **Magenta bouton foncé + texte blanc** | `#C4007A` | blanc dessus **5,79:1** ✅ AA | Variante bouton (hover/pressed) |
| Magenta profond + texte blanc | `#A1005E` | blanc dessus **7,84:1** ✅ AAA | Petits textes blancs sur pastille magenta |
| **À ÉVITER en texte blanc sur fond** | `#E6007E` | blanc dessus **4,50:1** (limite exacte) ⚠️ | Ne pas utiliser comme fond de bouton (marge nulle) ; `#EC008C` blanc dessus 4,25:1 ❌ |
| **À ÉVITER en texte sur noir** | `#D1006F` / `#C4007A` | 3,54:1 / 3,26:1 sur `#111111` ❌ | Ces magentas foncés ne sont lisibles que comme **fonds** (texte blanc dessus), jamais comme texte sur noir |
| Rouge laque (accent secondaire) | `#B3262D` (conservé) | blanc dessus **6,5:1** ✅ AA | **Erreurs, danger, suppression** uniquement — plus jamais comme couleur principale ni comme « marque » |
| Doré | `#C9A227` | **7,81:1** sur `#111111` (mesuré — le commentaire CSS dit 8,9:1, **faux**, à corriger) | **SUPPRIMÉ** de la DA (remplacé par magenta) ; ne subsiste nulle part, sauf si l'utilisateur le réclame comme 3e accent |
| Texte atténué sur clair | `#5F6B7A` (au lieu de `#6B7280`) | ≥ 4,5:1 sur `#F7F5F2` ✅ | Remplace `gray-500` (#6b7280 = **4,44:1**, sous AA de 0,06) |
| Succès / info | verts/bleus existants (conservés) | — | Ne pas magenta-ifier les états (succès ≠ marque) |

**Règle de lisibilité (à graver dans le thème) :** sur fond noir, le magenta **clair** (`#FF2E9A`,
`#FF4D6D`) sert de **texte** ; sur fond clair ou noir, le magenta **foncé** (`#D1006F`, `#C4007A`)
sert de **fond de bouton** (texte blanc). Jamais l'inverse. Un seul magenta par rôle, pas de dégradé
magenta→rose dans les textes (le dégradé reste décoratif, en fond uniquement).

### 6.3 Typographies et composants (conservés, sauf couleurs)

- **Typographies inchangées :** titres serif (`font-titre` : Palatino/Georgia, capitales espacées,
  façon logo « ASIAN HOUSE ») ; texte `system-ui` ; base 17 px, `text-sm` = 16 px, `text-xs` réservé
  aux étiquettes. Le changement de DA ne touche pas la typographie (décision à confirmer par
  l'utilisateur si besoin).
- **Boutons :** primaire = fond `#D1006F`, texte blanc, hover `#C4007A`, pressed `#A1005E` ; secondaire =
  contour `ring-white/30` sur noir / `border-gray-300` sur clair, texte assorti ; désactivé = gris
  (jamais magenta pâle). Hauteur min 48 px conservée.
- **Cartes :** fond `#1B1B22` sur écrans client (texte blanc, surtitre magenta `#FF2E9A`) ; fond blanc
  sur back-office clair (titre noir, accent magenta foncé).
- **Roue :** secteurs alternés noir `#111111` / magenta profond `#A1005E` (ou noir + `#26262E` avec
  bordure magenta) ; libellés blancs 15 px, max 12 car. ; centre + pointeur magenta `#FF2E9A` ;
  dégradé `#5e1317` (rouge sombre) **supprimé** → dégradé magenta sombre `#2A0A1E`.
- **Tampons :** tampon posé = cercle magenta `#FF2E9A` sur fond noir (contour actuel doré `box-shadow:
  0 0 0 3px var(--color-or-400)` → magenta) ; tampon vide = contour `white/25`.
- **Héros sombres (`.hero-sombre`) :** fond `linear-gradient(160deg, #111111, #1B1B22, #2A0A1E)` +
  halos magenta (`rgb(255 46 154 / 0,25)`) et violet (`rgb(59 45 143 / 0,35)`, conservé) ; le halo
  rouge `rgb(255 77 109 / 0,22)` devient magenta ; titre `.titre-or` → `.titre-magenta`
  (`#FF2E9A`, capitales espacées, serif).
- **Focus clavier :** `outline 3px #FF2E9A` sur fond noir, `#C4007A` sur fond clair (au lieu de
  `marque-200` rouge pâle).
- **Logo :** inchangé (blanc sur noir, déjà cohérent avec la DA noire).

### 6.4 Isolation derrière une configuration (comment faire)

1. **UNE source effective du thème : `src/theme.ts`** (nouveau) — **CORRIGÉ (revue Codex, point 14) :**
   l'audit initial exigeait de modifier `theme.ts` **et** `@theme`, ce qui contredisait la « source
   unique » promise. Décision tranchée : **`theme.ts` génère les tokens** (palette, rôles, rayons,
   durées) et en est la seule source de vérité ; **`src/index.css` `@theme` ne fait que les consommer**
   (il déclare les tokens Tailwind correspondants, sans valeur de couleur propre — un miroir, pas une
   2e source). Un test (`tests/theme.test.ts`, nouveau) vérifie la cohérence `theme.ts` ↔ `@theme` et
   échoue si un hex `#…` apparaît dans `src/pages/` ou `src/components/` hors `theme.ts`/`index.css`
   (même mécanisme que les gardes existantes qui interdisent `window.confirm` ou `useState(true)` par
   regex). **Distinction :** les couleurs d'**interface** (globales, toute l'app) vivent dans `theme.ts` ;
   les couleurs **configurables par commerce** (`src/lib/apparence.ts` : `couleur`/`fond`/`bannière`)
   ne couvrent que la **carte de fidélité** — ce sont deux couches différentes, pas deux thèmes.
2. **Tokens sémantiques, pas de couleurs brutes :** les composants utilisent `bg-marque` (primaire),
   `text-accent` (magenta clair sur noir), `bg-surface`, `text-atténué` — jamais `#D1006F` directement.
   Changer de DA = changer `theme.ts` + `@theme`, pas 30 fichiers.
3. **Apparence par commerce conservée** (`src/lib/apparence.ts`) : `couleur`/`fond`/`bannière` restent
   configurables par commerce, mais leurs **défauts** deviennent magenta/noir (`COULEUR_DEFAUT =
   #D1006F`, `FOND_DEFAUT = #111111` côté client) et le contrôle de contraste (≥ 4,5:1) s'applique
   toujours. Un commerce qui veut une autre couleur le peut — l'utilisateur peut donc changer la DA
   commerce par commerce depuis Réglages, sans code.
4. **Bascule complète, sans cohabitation (revue Codex, point 14) :** l'audit initial prévoyait à la
   fois un ancien thème sélectionnable et « zéro ancienne couleur » — contradiction supprimée. Décision
   tranchée : **le lot D1 remplace le doré par le magenta partout, en une fois** ; l'ancien thème
   (noir+doré) n'est **pas** sélectionnable, ni pendant ni après la transition — aucune variable
   `VITE_THEME`, aucun réglage `theme` dans les `defaults`, aucune cohabitation des deux thèmes en
   production. Ce qui reste configurable par commerce, c'est `apparence.ts` (couleur/fond/bannière de la
   carte de fidélité, défauts magenta/noir), pas le thème de l'app.
5. **Preuves visuelles :** captures 375 px de chaque écran avant/après (le lot D1 doit produire les
   captures — sans navigateur sur cette VM, c'est un agent avec navigateur ou le téléphone de
   l'utilisateur qui les fera ; voir § 9).

---

## 7. Plan priorisé P0 / P1 / P2 (avec estimations et risques)

Estimations = développement + tests + revue + captures mobile, en **heures** (ordre de grandeur, à
confirmer au démarrage de chaque lot). Règle MODE AUTONOME : une branche + une PR par lot, revue Codex
après chaque lot, staging d'abord, production à la toute fin après E2E verts, retour arrière en une
commande, aucun envoi réel ni paiement réel pendant le développement.

### P0 — Sécurité et fondations (bloquant avant toute ouverture large)

| Lot | Objectif | Fichiers concernés | Tests à ajouter | Critère de fin | Est. | Risques |
|---|---|---|---|---|---|---|
| Lot | Objectif | Fichiers concernés | Tests à ajouter | Critère de fin | Est. | Risques |
|---|---|---|---|---|---|---|
| **P0-S21 — Contrôle TypeScript serveur** *(nouveau, revue Codex point 13 — transversal, à mettre en place avant le 1er lot de code, puis à chaque lot)* | `tsconfig.json` n'inclut que `src` : le serveur (`server/`, ~2 800 lignes) n'est jamais vérifié par `tsc`. Ajouter la vérification des types du serveur (`tsc` sur `server/` ou `tsconfig` dédié) et l'exécuter à chaque lot | `tsconfig.json` (ou `tsconfig.server.json` nouveau), `server/` | `npx tsc` serveur vert en CI / à chaque lot | 0 erreur de type serveur, contrôle rejoué à chaque lot | 2–3 h (+ garde à chaque lot) | Les tests HTTP ne remplacent pas cette vérification — un lot peut être vert en tests et faux en types |
| **P0-S5 — Sauvegarde réelle** | Sauvegarde quotidienne testée par restauration : Supabase Pro (sauvegardes quotidiennes 7 j) **ou** `pg_dump` planifié + export CSV régulier documenté + procédure de restauration écrite et **testée** (pas seulement un dump). **Revue Codex, point 11 — spécification complétée :** rétention (combien de sauvegardes conservées, combien de temps), stockage indépendant (hors Supabase / hors Render), chiffrement (au repos et en transit), alertes en cas d'échec de sauvegarde, perte de données maximale acceptée (RPO) et délai de reprise maximal (RTO) à fixer avec l'utilisateur. **Une restauration sur PGlite seule ne valide pas la restauration complète d'un environnement Supabase** : la restauration testée doit couvrir schéma + données + RLS + configuration (projet Supabase de test ou restauration réelle simulée). | `server/README.md` (procédure), cron/sauvegarde (nouveau), `docs/SAUVEGARDE.md` (nouveau) | Test de restauration sur base jetable (projet Supabase de test ; PGlite insuffisant seul) | Restauration réussie depuis la sauvegarde, procédure écrite, 1re sauvegarde vérifiée, RPO/RTO fixés et documentés | 6–10 h (+ coût Pro 25 $/mois si choisi, à confirmer) | Sans sauvegarde, tout le reste travaille sur une base non sauvegardée ; la restauration non testée = pas de sauvegarde |
| **P0-S7 — Auth client minimale** *(périmètre élargi, revue Codex points 4–5)* | Un `clientId` seul ne suffit plus : code à usage unique (6 chiffres, SMS/e-mail) **ou** lien magique HMAC par contact pour les actions sensibles. **Périmètre complété (point 4) :** profil, rattrapage, suppression **+ inscription d'un contact existant, tirage, récupération de carte et messages privés** — protéger uniquement profil/rattrapage/suppression laisserait des contournements. Lecture de carte limitée (sans historique détaillé sans auth). **Migration des identifiants (point 5) :** passer à `randomUUID()` (ou 128 bits) pour les nouvelles cartes ne sécurise pas les cartes existantes — traiter les anciens liens, les QR imprimés, les liens courts (`/c/<id>`) et la récupération, avec expiration et révocation des preuves d'accès. | `server/app.ts` (routes `cartes/*`), `src/lib/fidelite.ts` (ID non prévisible : `crypto.randomUUID` ou 128 bits), `src/pages/Jouer.tsx`, `src/pages/CartePublique.tsx`, migration si besoin | Tests d'énumération (ID deviné → 401/404 uniforme), tests du code à usage unique, tests de migration des anciens liens (ancien lien expiré/révoqué → refus, nouveau lien → OK) | Énumération impossible, actions sensibles exigent la preuve du contact, anciens liens traités (expiration/révocation) | 16–24 h | Friction au comptoir si mal conçu (le code ne doit pas allonger le parcours < 30 s) ; dépend du prestataire SMS/e-mail pour le code (sinon lien magique e-mail d'abord) ; QR imprimés à réimprimer ou à faire expirer proprement |
| **P0-S11 — Atomicité Supabase** *(promu P1 → P0, revue Codex point 1)* — **LIVRÉ le 11/11/2026** (compensation documentée, pas de transaction multi-requêtes : `server/README.md` « Atomicité (P0-S11) » dit ce qui reste non atomique ; aucune migration ; caisse hors ligne / `actionId` intacte) | Transactions atomiques côté Supabase (ou compensation documentée) ; verrou optimiste sur `majCommerce` ; journal jamais perdu silencieusement (erreur explicite si migration absente). **Revue Codex, point 12 :** une « compensation documentée » n'offre pas les garanties d'une transaction atomique — le lot doit dire explicitement ce qui reste non atomique et ce que la compensation couvre. | `server/stockage-supabase.ts`, `server/app.ts` | Tests de double écriture simultanée, test de migration absente → erreur | Double tirage/double visite simultanés impossibles, journal garanti ou erreur | 8–12 h | Risque de casser la caisse hors ligne (file + `actionId`) |
| **P0-S14 — Vue caisse minimale** *(promu P1 → P0, revue Codex point 1)* | `GET /caisse` ne renvoie plus tous les clients + journal : recherche paginée côté serveur, fiche client à la demande | `server/app.ts` (route `caisse`), `src/pages/Caisse.tsx` | Tests : un membre ne voit que le client recherché | Données clients minimisées pour l'équipe | 6–10 h | Ne pas casser le scan QR + recherche manuelle |
| **P0-S18 — Pagination serveur Supabase** *(nouveau, revue Codex point 2)* | Les lectures `clients()` et `tirages()` ne paginent pas (`server/stockage-supabase.ts:137`) : au-delà du plafond PostgREST, listes, exports et statistiques sont silencieusement incomplets. Paginer côté serveur (par pages, `.range()`) toutes les lectures de listes, et adapter les écrans/exports/stats qui les consomment. Paginer l'écran Clients seul ne suffit pas. | `server/stockage-supabase.ts`, `server/app.ts`, `src/pages/Clients.tsx`, `src/lib/stats.ts`, exports CSV | Test de lecture au-delà du plafond (jeu de données > 1 000 lignes) | Listes, exports et stats complets au-delà du plafond PostgREST | 4–6 h | Volume de données en test (jeu de > 1 000 lignes à générer) |
| **P0-S19 — Code gagnant hors vue publique** *(nouveau, revue Codex point 3)* | `GET /cartes/:id` re-sert le code gagnant du jour (`server/app.ts:1663`) sans authentification. Retirer `codeDuJour` de la réponse publique, ou ne le servir qu'au client authentifié concerné (après P0-S7) — la vérification en caisse (`POST …/code`) reste, elle, inchangée. | `server/app.ts` (handler `GET /cartes/:id`), `src/pages/Jouer.tsx` | Test : `GET /cartes/:id` sans auth ne contient plus `codeDuJour` ; le titulaire authentifié le reçoit (si l'option retenue est la 2e) | Aucun code gagnant accessible sans authentification | 2–3 h | Ne pas casser l'affichage du gain au titulaire légitime (autre téléphone, cache vidé — le cas d'usage P0-U3) |
| **P0-S20 — Persistance des compteurs publics** *(nouveau, revue Codex point 6)* | Les limites publiques (`LIMITES_PUBLIQUES`) utilisent des compteurs en mémoire (`server/app.ts:876`) : remises à zéro au redémarrage, non partagées entre instances. Persister les compteurs en base (même mécanisme que `tentatives_auth`, migration 0006) **ou** documenter explicitement la limite (protection remise à zéro à chaque réveil Render, inefficace contre une attaque distribuée/multi-instances). | `server/app.ts` (compteurs), migration si persistance en base, tests | Test de redémarrage : les compteurs survivent (si persistance choisie) | Compteurs persistants, ou limite documentée et acceptée explicitement | 3–5 h | Persistance en base = écritures supplémentaires sur chaque requête publique (coût/egress à mesurer) |
| **P0-S6 — PIN en historique Git** | **Décision utilisateur requise** (risque accepté le 09/11). Si OK : changer les 2 PIN **et** purger l'historique (réécriture + force-push + rotation des clones), sinon le changement seul ne suffit pas. **Revue Codex, point 10 — à distinguer :** neutralisation du secret (changer le PIN : l'ancien ne fonctionne plus) ≠ nettoyage de l'historique (purger le PIN de Git : ne neutralise rien à lui seul, l'ancien PIN reste valable tant qu'il n'est pas changé). **Noter que `PIN_ASIAN_HOME` ne sert qu'à l'initialisation** (changer la variable ne remplace pas le PIN déjà enregistré — il faut `PUT /pin` ou une rotation explicite). Prévoir l'invalidation des sessions existantes lors d'une rotation. | Historique Git, `render.yaml` (variables), tous les clones | Vérification `git log -S` vide après purge | PIN absents de tout l'historique, nouveaux PIN en place sur Render, sessions anciennes invalidées | 4 h si décidé | Force-push sur `master` = tous les clones à re-synchroniser ; Render à redéployer |
| **P0-S9 — Refuser SQLite en production** | En production, démarrer sans Supabase = erreur au lieu d'une bascule silencieuse vers SQLite vide ; `/sante` signale le stockage effectif (déjà fait) + alerte si SQLite en prod | `server/index.ts`, `server/app.ts` (`/sante`) | Test de démarrage sans variables Supabase en `NODE_ENV=production` → refus | Démarrage refusé, message explicite | 2–3 h | Ne pas casser le dev local (SQLite reste le défaut hors production) |
| **P0-S10 — Staging + rollback** | Service Render de staging séparé (branche dédiée) + procédure de retour arrière en une commande (redéploiement du commit précédent) documentée et **testée**. **Revue Codex, point 12 — rollback limité au code :** redéployer le commit précédent ne restaure ni schéma, ni données, ni configuration. Ajouter au lot : **compatibilité des migrations** (chaque migration doit être compatible avec l'ancien code et le nouveau, pour qu'un retour arrière reste possible) et **procédure après écritures partielles** (que faire si le déploiement a déjà écrit en base avant l'échec). | `render.yaml` (2e service), `docs/DEPLOIEMENT.md` (nouveau) | Déploiement staging + rollback testé | Staging en ligne, rollback exécuté une fois avec succès | 6–8 h (+ coût Render staging si plan payant) | Staging sur Supabase : base de test séparée obligatoire (jamais la prod) |
| **P0-U0 — Mesure initiale avant refonte** *(nouveau, revue Codex point 15)* | Mesurer **AVANT toute refonte** (SCORES.md) : parcours scan → lot en secondes/taps (à chaud et à froid), bundle, Lighthouse si mesurable — pour garder une référence avant/après. Définir les critères observables **avant** les changements (seuils de réussite par parcours, pas seulement des captures). | `SCORES.md` (nouveau), protocole de mesure | — (mesure, pas du code) | `SCORES.md` rempli avec des mesures réelles **avant** le 1er lot de refonte | 2–3 h | Exige un téléphone + un navigateur (pas faisable sur cette VM) ; le délai à froid (~60 s) reste une estimation non mesurée, pas une certitude — le mesurer ici |
| **P0-D1 — Thème noir+magenta isolé** *(recule après la sécurité, revue Codex point 1)* | Remplacer le doré par le magenta (§ 6) dans **un seul fichier de thème** + tokens ; aucun hex en dur hors thème ; garde par test. **Source effective unique : `src/theme.ts`** (génère les tokens) ; `@theme` ne fait que les consommer (voir § 6.4 corrigé). **Bascule complète, sans cohabitation** : l'ancien thème noir+doré n'est pas sélectionnable. | `src/theme.ts` (nouveau), `src/index.css`, `src/lib/apparence.ts`, `src/lib/defaults.ts`, tous les `*.tsx` qui utilisent `or-*` (~30 occurrences), `tests/theme.test.ts` (nouveau) | Test de garde (pas de hex hors thème), tests de contraste (ratios recalculés, dont la correction 7,81:1), captures 375 px avant/après de chaque écran | Tous les écrans en noir+magenta, 0 occurrence `or-400`/`#c9a227`, contrastes AA vérifiés, captures jointes à la PR | 8–12 h | Touche tous les écrans — faire **avant** les retouches visuelles P1, sinon double travail ; régression visuelle sans captures |
| **P0-U6 — Réveil Render** | Décision budgétaire : plan Render payant (prix exact à vérifier sur render.com/pricing) **ou** keep-alive documenté comme non garanti **ou** écran d'attente honnête (« Le serveur se réveille, ~1 min ») avec progression | `render.yaml` (plan), `index.html` / `src/chargement.css` (message), `docs/DEPLOIEMENT.md` | Mesure du temps à froid avant/après | Parcours < 30 s **à froid** mesuré, ou décision explicite documentée | 2–4 h (+ ~7 $/mois si plan payant, à vérifier) | Le keep-alive consomme les 750 h gratuites et n'est pas garanti ; le plan payant est le seul correctif certain |

### P1 — Menu, photos, parcours client, fonctions de vente

> P1-S11 et P1-S14 sont promus en P0 (revue Codex, point 1) — voir le tableau P0 ci-dessus.

| Lot | Objectif | Fichiers concernés | Tests à ajouter | Critère de fin | Est. | Risques |
|---|---|---|---|---|---|---|
| **P1-M1 — Prix à vérifier + hors carte** | Confirmer Riz Thaï 8,90 € et Maki Gold 100,00 € (voir § 8) ; trancher les 3 plats hors carte (fusion Thaï-sty Krusty/Crousti Poulet, Bœuf Basilic, Boisson 33cl) | `src/data/menu-reel.ts`, `docs/MENU-OFFICIEL-2026-11-10.md` | Tests du menu mis à jour (prix, libellés) | 0 plat « à vérifier », 0 plat sans prix sauf décision explicite | 2–3 h (+ attente réponse commerçant) | **Ne pas afficher 100,00 € sans confirmation** |
| **P1-M2 — Allergènes** | Renseigner les allergènes des 81 plats (liste `ALLERGENES` existante, affichage existant) ; à défaut, mention par plat « allergènes : demander en caisse » explicite | `src/data/menu-reel.ts`, `src/pages/MenuPublic.tsx`, `src/pages/MenuCarte.tsx` | Test : chaque plat a une liste d'allergènes (même vide explicite) ou la mention | 81/81 plats avec allergènes renseignés ou mention explicite | 4–6 h (+ données commerçant) | Données à obtenir du commerçant (voir § 8) ; ne pas inventer d'allergènes |
| **P1-M3 — Photos des plats** | Photographier / récupérer les ~67 plats sans photo (photos du restaurant, jamais de photos clients Google) ; recadrer en WebP + vignettes ; associer plat par plat | `public/visuels/`, `src/lib/visuels.ts`, `src/data/menu-reel.ts`, `scripts/extraire-photos-menu.py` | Test de comptage des photos (X/81 avec photo), test de taille/poids des images | ≥ 60/81 plats avec photo, poids total maîtrisé, 0 photo non vérifiée | 8–16 h (+ séance photo ou envoi des photos par le commerçant) | Qualité/association plat↔photo à valider une par une ; ne pas utiliser de photo qui ne montre pas CE plat |
| **P1-U1 — Mesure du parcours comptoir** | Mesurer réellement (téléphone, 375 px) : taps + secondes scan → lot, à chaud et à froid ; créer `SCORES.md` (Lighthouse mobile, bundle, taps/secondes, couverture, `npm audit`, note DA /10 par écran) | `SCORES.md` (nouveau), protocole de mesure | — (mesure, pas du code) | `SCORES.md` rempli avec des mesures réelles, parcours < 30 s à chaud vérifié ou écart chiffré | 3–4 h | Exige un téléphone + un navigateur (pas faisable sur cette VM) |
| **P1-C7 — Écrans commerçant (finitions)** | Remplacer les 8 `window.confirm()` par `<Confirmation>` ; aide « encore X tampon(s) » sur le bouton récompense ; bouton « Saisir le prénom » visible si caméra refusée ; découper Réglages en sous-pages ; pagination Clients au-delà de 50 | `src/pages/Caisse.tsx`, `FicheClient.tsx`, `Equipe.tsx`, `Avis.tsx`, `Messages.tsx`, `MenuCarte.tsx`, `CartePublique.tsx`, `Admin.tsx`, `Reglages.tsx`, `Clients.tsx`, `src/components/Confirmation.tsx` | Tests de non-régression (garde `window.confirm` interdite hors démo) | 0 `window.confirm()` hors démo, Réglages découpé, Clients paginé | 10–16 h | Réglages = 8 fieldsets, ~40 champs — découpe à valider avec le commerçant |
| **P1-B7 — Brevo en production** *(corrigé, revue Codex point 8)* | Déployer sur staging, créer le compte Brevo, poser les 4 variables Render. **Séparer deux validations : (a) validation simulée** — mode test (`BREVO_MODE_TEST=1`) : aucun envoi réel, on vérifie le code, le journal des envois et `/sante` sans livraison ; **(b) recette réelle autorisée** — hors mode test, vers des destinataires définis et consentants (e-mail de bienvenue vers yassbybibiche@gmail.com, puis 1 SMS de test vers un numéro autorisé) : on vérifie la réception réelle et le journal. Ne pas exiger de messages « réellement reçus » en mode test (contradiction de l'audit initial : le mode test empêche la livraison). | Code commité (`4862968`), `docs/BREVO.md`, Render | Tests existants (798) + validation simulée documentée + recette réelle autorisée documentée | `/sante` : `sms: true, email: true, smsPrestataire: 'Brevo'` **en production**, 1 e-mail + 1 SMS réels reçus (recette autorisée) et journalisés | 4–6 h (+ achat de crédits SMS, ~0,045 €/SMS à confirmer) | **Aucun envoi réel vers un vrai client pendant le test** (MODE TEST uniquement pour la validation simulée ; recette réelle limitée aux destinataires définis) ; expéditeur SMS ≤ 11 car. ; e-mail expéditeur à valider chez Brevo |
| **P1-B9 — Désinscription SMS utilisable** *(nouveau, revue Codex point 7 — avant toute activation SMS)* | Le texte `STOP : répondez STOP` (`src/lib/relances.ts:42`) est trompeur : l'expéditeur alphanumérique Brevo ne reçoit aucune réponse (`server/notifications/brevo.ts:90-96`). Ajouter un mécanisme de désinscription **utilisable** (lien de désinscription dans chaque SMS, comme pour les e-mails) et corriger le texte du SMS. Bloquant avant toute activation SMS. | `src/lib/relances.ts`, `server/notifications/brevo.ts`, `server/app.ts` (route de désinscription), `src/pages/Desinscription.tsx` | Tests : chaque SMS contient un lien de désinscription fonctionnel ; le texte ne promet plus de réponse STOP | Désinscription par lien testée de bout en bout, texte corrigé | 3–5 h | Aucun SMS marketing sans désinscription utilisable |
| **P1-B8 — Google Business (configuration + recette)** *(corrigé, revue Codex point 9 : estimation réduite)* | Configurer (projet Cloud, OAuth, demande d'approbation Google) et recetter l'import des avis + la publication des réponses — **fonctions et routes DÉJÀ écrites** (`listerAvisGoogle` / `publierReponseGoogle`, `server/google-business.ts:229,283`, routes `google/*`) ; ne rien publier sans le compte du restaurant. L'audit initial comptait ce travail deux fois (16–24 h de « préparation » pour du code existant). | `server/google-business.ts`, `server/app.ts` (routes `google/*`), `docs/GOOGLE-BUSINESS.md`, `src/pages/Avis.tsx` | Tests avec Google simulé (fetch injecté, jamais contre Google) + recette réelle (import + 1 réponse de test) | Configuration posée, approbation demandée, import + publication recettés sur la vraie fiche | 6–10 h (+ délai d'approbation Google, inconnu) | Approbation Google incertaine ; compte Google du restaurant requis |
| **P1-S12 — Garde « 1 tampon/jour » sur `visite`** | Appliquer la règle aussi à la route historique `visite` (ou la supprimer si la caisse suffit) | `server/app.ts` (route `visite`), tests serveur | Test : 2e tampon le même jour via `visite` → refus | Règle uniforme sur toutes les routes | 2–3 h | Comportement historique : vérifier qu'aucun flux légitime ne crédite 2 tampons/jour |
| **P1-P1 — Egress / polling** | Mesurer l'egress réel Supabase (dashboard), puis rechargement différentiel ou intervalle allongé (10 s → 30 s + rechargement sur action) | `src/store.tsx`, `server/app.ts` | Test de non-régression du rechargement | Egress < 5 Go/mois projeté, déblocage de la roue toujours < 10 s | 4–6 h | Ne pas casser le déblocage de la roue (poll 10 s actuel) |
| **P1-G1 — RGPD : rappel de purge** | Rappel périodique (dashboard) des cartes à purger ; à défaut, purge automatique documentée comme refusée explicitement | `src/pages/Clients.tsx`, `src/lib/rgpd.ts` | Test de la liste de purge | Aucune carte au-delà de la conservation sans rappel visible | 3–4 h | Suppression = cascade à respecter (tirages, journal, parrainages) |

### P2 — Qualité, performance, mesure

| Lot | Objectif | Fichiers concernés | Tests à ajouter | Critère de fin | Est. | Risques |
|---|---|---|---|---|---|---|
| **P2-Q1 — Accessibilité / textes** | Gris de texte `#6B7280` → `#5F6B7A` (4,44 → ≥ 4,5:1) ; badges ≥ 12 px ; interrupteurs 44 px ; anglais complet (vérifier `TRADUCTIONS_EN` : 203 lignes, couverture à mesurer) ; vouvoiement vérifié | `src/index.css`, composants, `src/lib/langue.ts` | Test de contraste automatisé (couleurs du thème), test de couverture EN (chaque `t('…')` traduit) | 0 texte < 4,5:1, 0 texte de contenu < 16 px, EN 100 % | 12–20 h | Refonte typographique = revue écran par écran |
| **P2-Q2 — Performance** | Compression (gzip/br) côté serveur ou vérification du proxy Render ; `Cache-Control: max-age` long sur les assets hashés ; premier affichage < 2 s en 4G (mesuré) | `server/app.ts` (statiques), `vite.config.ts` | Test de bundle (seuils existants, à figer dans `SCORES.md`) | LCP < 2,5 s en 4G simulée, bundle initial défini et mesuré | 8–12 h | Ne pas casser le chargement hors ligne de la caisse |
| **P2-Q3 — Mesure / A/B** | Entonnoir complet (scans QR comptés — aujourd'hui le scan n'est compté que si la page se charge) ; 2 tests A/B (`docs/TESTS-AB.md` : protocole manuel du test 2 à outiller) | `src/lib/mesure.ts`, `src/components/Mesure.tsx`, `server/app.ts` (`evenements`) | Tests des compteurs | Entonnoir scan → retour mesurable, 1er test A/B lancé | 8–12 h | Mesure = nouvelles écritures en base ; vie privée : entonnoir anonyme uniquement |
| **P2-Q4 — Domaine + SEO** | Domaine `.fr` (~5,99 € 1re année OVH) + DNS + certificat Render + mise à jour des QR imprimés ; prérendu des pages publiques (SEO réel sur SPA hash) | `render.yaml`, `public/robots.txt`, `public/sitemap.xml`, `index.html`, QR vitrine | Tests SEO existants (origine identique dans les 3 fichiers) | Domaine en ligne, QR réimprimés, pages publiques indexables | 6–10 h (+ 5,99 €/an) | QR imprimés à réimprimer ; SEO réel sur SPA hash = prérendu ou pages statiques |
| **P2-S13 — Oracles d'énumération** | Uniformiser les messages (`existant`, 409 `sansVisite`/`dejaJoue`, 404 vs 409) pour ne plus révéler l'existence d'un client ni son statut de visite | `server/app.ts`, `src/pages/Jouer.tsx` | Tests d'oracle (réponses indistinguables) | Aucune information d'existence/statut déductible des réponses | 4–6 h | Ne pas dégrader les messages utiles au client légitime |
| **P2-S15 — Journal des lectures sensibles** | Journaliser (échantillonné) les lectures `GET /cartes/:id` et `GET /commerces` pour détecter une énumération | `server/app.ts` | Test de journalisation | Énumération détectable dans les logs | 3–4 h | Volume de logs (échantillonnage obligatoire) |
| **P2-S17 — Rotation des secrets** *(précisé, revue Codex point 10)* | Procédure documentée : rotation `SESSION_SECRET` (révocation des sessions + invalidation des sessions existantes), `SUPABASE_SERVICE_ROLE_KEY`, PIN (lien avec P0-S6) — distinguer neutralisation du secret et nettoyage de l'historique ; noter que `PIN_ASIAN_HOME` ne sert qu'à l'initialisation (changer la variable ne remplace pas le PIN enregistré). | `docs/SECURITE.md` (nouveau) | — | Procédure écrite, 1 rotation testée sur staging | 3–4 h | Rotation `SESSION_SECRET` = déconnexion de toutes les sessions |
| **P2-Q5 — Documentation** | Mettre à jour `README.md` (Supabase « PAS créé », « rien déployé » — obsolètes) + `server/README.md` (vérifier chaque affirmation) | `README.md`, `server/README.md` | — | 0 affirmation fausse dans les README | 2–3 h | — |
| **P2-Q6 — Alertes / logs** | Log structuré + alerte (mail/webhook) sur 500, blocages auth, 429 en rafale | `server/app.ts`, `server/index.ts` | Test d'émission d'alerte (simulée) | Alerte reçue sur staging lors d'un 500 provoqué | 6–8 h | Coût / bruit d'alertes à calibrer |
| **P2-S16 — Calibration des seuils** | Après 2 semaines d'usage réel : journal des 429, ajustement des `LIMITES_PUBLIQUES` (wifi partagé du restaurant) | `server/app.ts` (limites), dashboard Supabase | — | 0 faux positif 429 en service, seuils documentés | 2 h (après 2 semaines) | Attendre les données réelles |

**Ordre d'exécution recommandé (revue Codex, point 1) :** P0-S21 (transversal, avant le 1er lot de code,
puis à chaque lot) → P0-S5 → P0-S7 → P0-S11 → P0-S14 → P0-S18 → P0-S19 → P0-S20 → P0-S9 → P0-S10 →
P0-U0 (mesure initiale, avant toute refonte) → P0-D1 → P0-U6 (décision) → P1-M1/M2/M3 (menu+photos) →
P1-U1 (mesure après refonte, à comparer à P0-U0) → P1-C7 (écrans commerçant) → P1-B9 (désinscription SMS,
avant toute activation SMS) → P1-B7 (Brevo prod) → P1-B8 (Google Business) → P1-S12/P1 → P2 (Q1, Q2, Q3,
Q4, puis S13/S15/S17/Q5/Q6/S16).
**P0-S6 (PIN Git) attend la décision explicite de l'utilisateur — ne pas le planifier sans son OK.**

---

## 8. Infos manquantes à demander à l'utilisateur (et si le développement peut avancer sans elles)

| # | Info manquante | Développement possible sans elle ? | Lot concerné |
|---|---|---|---|
| 1 | **Sauvegarde :** Supabase Pro (25 $/mois) ou `pg_dump` planifié ? Mot de passe de base Postgres (pour `pg_dump`) | **Non pour la donnée, oui pour le code** : la procédure et les tests peuvent être écrits sans la décision, mais aucune sauvegarde réelle n'existe tant qu'elle n'est pas tranchée | P0-S5 |
| 2 | **PIN en historique Git :** OK pour changer les 2 PIN + purger l'historique (force-push) ? | **Oui** : tout le reste avance ; ce lot attend la décision | P0-S6 |
| 3 | **Réveil Render :** plan payant (~7 $/mois, prix à vérifier) accepté ? | **Oui** : l'écran d'attente honnête peut être livré sans la décision ; le parcours < 30 s à froid, non | P0-U6 |
| 4 | **DA noir+magenta :** teinte magenta exacte de la carte du restaurant (relevé du PDF Heyzine) ? Le rouge laque reste-t-il en accent secondaire (erreurs/danger) ou est-il supprimé partout ? | **Oui** : la palette proposée (§ 6.2, contrastes vérifiés) permet de démarrer ; ajuster la teinte ensuite = 1 changement dans `theme.ts` | P0-D1 |
| 5 | **Prix à vérifier :** Riz Thaï 8,90 € ? 6 Maki Gold 100,00 € (coquille pour 10,00 € ?) ? | **Non pour l'affichage** : ne pas afficher 100,00 € sans confirmation — masquer le prix (« Prix sur place ») en attendant | P1-M1 |
| 6 | **Plats hors carte :** Thaï-sty Krusty = Crousti Poulet (fusionner) ? Bœuf Basilic toujours servi ? Boisson 33cl = Soda 3,50 / Evian 2,90 (remplacer) ? | **Oui** : les 3 plats restent en « Hors carte (prix à confirmer) » en attendant | P1-M1 |
| 7 | **Allergènes** de chaque plat (81 plats, aujourd'hui 0 renseigné) | **Oui** : le code et l'affichage existent ; la saisie attend les données | P1-M2 |
| 8 | **Photos des plats** (~67 plats sans photo) : le restaurant fournit-il ses photos, ou séance photo à organiser ? | **Oui** : l'app fonctionne sans photo ; l'association attend les fichiers | P1-M3 |
| 9 | **Brevo :** compte créé ? Clé API ? Expéditeur e-mail validé ? Expéditeur SMS choisi (≤ 11 car.) ? Crédits SMS achetés ? | **Non pour la production** : le code est écrit, mais aucun envoi réel sans compte + clés + variables Render. Le développement (staging, tests) avance sans | P1-B7 |
| 10 | **Google Business :** compte Google propriétaire/gestionnaire de la fiche + accord pour lancer la demande d'approbation Google ? | **Oui** : le code d'import/publication existe déjà ; restent configuration, approbation et recette réelle (revue Codex, point 9) | P1-B8 |
| 11 | **Google Wallet :** compte émetteur à créer ? (décision + accès console Google Pay & Wallet) | **Oui** : le code 501 reste propre en attendant ; la génération, non | § 5 n° 2 |
| 12 | **Apple Wallet :** la suspension est-elle levée ? (99 $/an + compte Developer) | **Oui** : le code `.pkpass` existe, la route reste à écrire quand la décision tombe | § 5 n° 3 |
| 13 | **Domaine :** nom de domaine `.fr` souhaité (lequel ?) | **Oui** : tout avance sur `onrender.com` ; les QR imprimés devront être réimprimés après | P2-Q4 |
| 14 | **Liens Deliveroo et Uber Eats** du restaurant (+ confirmation du linktr.ee/asianhomefrance) | **Oui** : les boutons s'affichent dès que les liens sont renseignés dans Réglages | § 5 n° 11 |
| 15 | **Coût unitaire des lots** (pour le total des coûts distribués — aujourd'hui « gains sans coût » = total affiché comme un minimum) | **Oui** : le dashboard affiche « non renseigné » en attendant ; le total devient exact dès la saisie | § 2.3 (Tableau de bord) |
| 16 | **Capacité de la salle / solution de paiement** | **Non applicable** : pas de réservation de table ni de paiement dans l'app (hors périmètre décidé) — à confirmer seulement si le périmètre change | — |
| 17 | **Bug de connexion du 09/11 :** message exact vu sur son téléphone | **Partiellement résolu** : la cause la plus probable (message 401 effacé par le rechargement auto 10 s) a été corrigée dans les vagues ; sans le message exact, impossible de confirmer à 100 % | (suivi — ne pas rouvrir sans le message exact) |
| 18 | **Staging :** accord pour un 2e service Render (staging) + une base Supabase de test ? | **Oui** : la procédure peut être écrite sans ; le déploiement staging attend la création | P0-S10 |

---

## 9. Ce que je n'ai pas pu vérifier (limites honnêtes de cet audit)

1. **Rendu réel 375/390 px sur téléphone : jamais vérifié.** Aucun navigateur sur cette VM, aucune capture
   possible. Tous les constats « mobile » sont des lectures de code (classes Tailwind → géométrie DÉDUITE)
   et des lectures texte des pages en ligne (qui ne montrent que l'écran de chargement, la SPA étant 100 %
   JS). Les frictions visuelles (textes tronqués, scroll, zones tactiles, contrastes perçus) doivent être
   confirmées sur téléphone réel (lot P1-U1).
2. **Le cas à froid Render (réveil ~1 min) : non observé.** La page en ligne a répondu en ~1,2 s (service
   réveillé). Le délai de ~60 s est DÉDUIT de la doc Render + de l'étape 0.
3. **L'E2E Playwright (1/1) : non relancé.** `npm run test:e2e` exige Chromium ; non exécuté pendant cet
   audit (temps + téléchargement). Le parcours scan → gain → carte est attesté par les commits `493d125` /
   `498b73b` et le JOURNAL, pas par une exécution de ma part.
4. **La base de production elle-même : non lue.** Je n'ai ni accès Supabase ni les secrets. L'état des
   migrations vient de `/sante` (lu en ligne) ; le contenu (menu enregistré du commerce, clients, coûts
   des lots, `SESSION_SECRET`/`CORS_ORIGIN` posées ou non) est **inconnu de moi**.
5. **Le PDF Heyzine de la carte officielle : non relu.** L'étape 0 avait déjà échoué à le lire
   (`browser.open` : « no extractable content ») ; je ne l'ai pas retenté. La teinte magenta exacte de la
   carte n'est donc pas relevée — la palette du § 6 est un choix vérifié par le calcul, pas un relevé.
6. **Chaque handler de `server/app.ts` : non relu ligne à ligne.** L'inventaire des routes (§ 1.3) est
   reconstruit depuis le dispatch ; une relecture handler par handler reste à faire (lot P0-S8 implicite —
   je ne l'ai pas numéroté dans le plan car il se fait lot par lot, en touchant chaque route).
7. **Les écrans commerçant après les vagues : partiellement re-vérifiés.** Les constats de l'étape 0 que je
   n'ai pas re-lus sont marqués « non re-vérifié » dans le § 2 (ex. : formulaires programme sur `#/carte`,
   recherche qui réinitialise la catégorie sur `#/menu`, badge 11 px, interrupteurs 32 px). Ils restent
   plausibles mais ne sont pas des observations de cette étape.
8. **L'egress Supabase réel : mesuré localement (P1-P1, 11/11/2026), pas dans le dashboard.** Projections locales
   (1 onglet, 12 h/j) : HTTP 3,04 Go/mois et PostgREST ~3,50 Go/mois à 30 s (150 clients,
   `tests/egress-p1-p1.test.ts`) ; à 300 clients le proxy PostgREST passe à 5,60 Go/mois. Le chiffre dashboard
   Supabase reste à lire (pas d'accès navigateur sur cette VM).
9. **Les prix Render/Supabase/Brevo/Twilio/Google/Apple : non vérifiés sur les sites des prestataires.**
   Les chiffres cités (Render ~7 $/mois, Supabase Pro 25 $/mois, Brevo SMS ~0,045 €, Apple Developer
   99 $/an, domaine ~5,99 €) viennent du repo et de la mémoire — **à confirmer sur les pages tarifs
   avant toute décision budgétaire**.
10. **Le travail Brevo : lu mais non audité en profondeur.** Je l'ai constaté (commit `4862968` intervenu
    pendant mon audit) et noté son état (§ 5 n° 1) sans toucher à ses fichiers, comme demandé. Sa revue
    complète appartient à l'agent qui le porte / à la revue Codex du lot.
11. **`npx tsc -p .` et `npm run build` : non relancés par moi** (le JOURNAL du lot Brevo les atteste
    propres sur l'arbre en cours ; à re-vérifier après commit).
12. **Aucun test de charge, aucun test de sécurité offensif** (pas de tentative d'énumération, de
    brute-force ou d'injection contre la production — volontairement : audit en lecture seule).
13. **Contrôle TypeScript serveur : jamais exécuté (revue Codex, point 13).** `tsconfig.json` n'inclut
    que `src` — `npx tsc -p .` ne vérifie pas `server/` ; le serveur n'a donc jamais été contrôlé en
    types. Lot P0-S21.

---

## Annexe — Constats de l'étape 0 : table de consolidation

| Constat étape 0 | Statut à l'étape 1 |
|---|---|
| P0-S1 PIN scrypt + sessions | **LIVRÉ** (§ 1.2) |
| P0-S2 Anti-abus persistant | **LIVRÉ** (§ 1.2) |
| P0-S3 Vue publique minimale | **LIVRÉ** (§ 1.3) |
| P0-S4 Durcissement HTTP | **LIVRÉ** (§ 1.4) |
| P0-S5 Sauvegarde | **TOUJOURS OUVERT** → P0-S5 (§ 7) |
| P0-S6 PIN en historique Git | **TOUJOURS OUVERT, décision utilisateur** → P0-S6 (§ 7) |
| P0-U1 Fin de la page blanche | **LIVRÉ** (écran inline + squelettes) — reste le réveil Render → P0-U6 |
| P0-U2 Roue lisible | **LIVRÉ** (12 car. + compteur) |
| P0-U3 Code gagnant vérifiable | **LIVRÉ pour la caisse, CORRIGÉ pour la vue publique (revue Codex, point 3)** (champ caisse + re-serve API — mais la re-serve passe par le handler public `GET /cartes/:id`, `server/app.ts:1663` : c'est une fuite, lot P0-S19) |
| P0-U4 Fin du cul-de-sac | **LIVRÉ** (texte inversé + attente animée) |
| P0-U5 Bug connexion 09/11 | **Expliqué et corrigé** (message 401 effacé par le rechargement auto 10 s) — confirmation à 100 % impossible sans le message exact (§ 8 n° 17) |
| P1-B1 Menu officiel | **LIVRÉ** (81 plats, 78 prix) — restent prix à vérifier, allergènes, photos (§ 4) |
| P1-B2 Photos du PDF | **LIVRÉ partiellement** (9 plats WebP) — ~67 plats sans photo (§ 4) |
| P1-B3 Relances SMS/e-mail | **Code écrit (Brevo choisi), non branché en prod** → P1-B7 (§ 5) |
| P1-B4 Avis Google | **Préparé sans compte** → P1-B8 (§ 5) |
| P1-B5 Logo | **LIVRÉ** (upload + route logo) |
| P1-B6 RGPD | **LIVRÉ** (page confidentialité, export, suppression, conservation) — purge manuelle (§ 3, R-06) |
| P1-C1 Entrée QR → jeu | **LIVRÉ sauf** incohérence prénom obligatoire côté commerçant |
| P1-C2 Roulette | **LIVRÉ** (3,6 s, confettis, validité, invitation avis) |
| P1-C3 Carte + PWA | **LIVRÉ** (PWA, tampons, historique) — Wallet toujours « bientôt » |
| P1-C4 Avis côté client | **LIVRÉ** (demande après gain, message privé si note basse) |
| P1-C5 Menu client | **LIVRÉ sauf** liens Deliveroo/Uber Eats (vides) et allergènes |
| P1-C6 Écrans commerçant | **Partiellement livré** (réaffichage code équipe, grilles Réglages, sauvegarde CSV avant remplacement du menu) — restent `window.confirm()` × 8, découpe Réglages, pagination Clients → P1-C7 |
| P2-Q1 Identité & accessibilité | **Partiellement livré** (`text-sm` = 16 px, zones de cases 44 px, FR/EN) — restent gris 4,44:1, badges 11 px, EN à mesurer → P2-Q1 |
| P2-Q2 Performance | **LIVRÉ partiellement** (bundle découpé, `no-cache`+ETag) — restent compression, `max-age`, mesure 4G → P2-Q2 |
| P2-Q3 Dashboard & mesure | **LIVRÉ** (coûts, entonnoir anonyme, tests A/B documentés) — reste le scan QR non compté |
| P2-Q4 Domaine & SEO | **LIVRÉ sauf domaine** (SEO/OG en place, aucun domaine acheté) → P2-Q4 |

---

*Audit rédigé le 10/11/2026, lecture seule. Référence historique : `docs/AUDIT-2026-11-10.md` (étape 0).*
*Vérifications exécutées : `npm test` 798/798 ; `GET /sante` en production ; `browser.open` de la page d'accueil en ligne ; lecture du code, des migrations 0001–0008, de `render.yaml`, de `dist/` et des docs.*

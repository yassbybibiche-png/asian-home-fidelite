# Brancher Google Business Profile (avis Google)

Ce guide explique, pas à pas, comment permettre à l’app d’**importer les avis Google** du restaurant et d’**y publier les
réponses**. Côté app, tout est prêt (lot P1-B4) ; ce qui manque se fait chez Google, avec le compte du commerce.

> **Aujourd’hui (10/11/2026) : rien n’est branché.** Aucun projet Google Cloud, aucune demande d’accès, aucune clé.
> Tant que les variables ci-dessous ne sont pas renseignées sur Render, l’écran Avis reste en mode « à brancher » :
> les avis se recopient à la main et les réponses se collent à la main sur Google. Aucun appel n’est fait à Google.

## État au 11/11/2026 (lot P1-B8)

- **Code vérifié contre un Google simulé** (`tests/avis-google-p1-b4.test.ts`, `tests/google-business-p1-b8.test.ts`,
  fetch injecté, jamais contre Google) : OAuth, import (déduplication, brouillons préservés, auto 5★ seule
  publiée d'office), publication après validation manuelle, déconnexion.
- **Garde-fous ajoutés (P1-B8)** : réponse vide → 400 « Réponse vide… » (fonction `publierReponseGoogle` ;
  via la route, le refus est un 409 « brouillon non validé », `refusPublication`) ; réponse > **4 096 octets**
  (limite Google, pas des caractères — vérifié le 11/11/2026) → 400 explicite (l'app plafonne déjà ses
  réponses à 2 000 caractères, front + route PATCH avis) ; identifiant d'avis mal formé (`?`, `#`, `..`
  refusés) → 400 ; fiche invalide dans `listerAvisGoogle` → 409 ; `GOOGLE_BUSINESS_LOCATION`
  mal renseignée → **409 explicite** à l'import, avant tout appel à Google (même le rafraîchissement du
  jeton) — elle n'est plus ignorée silencieusement.
- **Configuration, approbation et recette réelle : « attend le compte ».** Aucun projet Google Cloud, aucune
  demande d'accès, aucune clé — la procédure complète est ci-dessous (§ étapes 1–7 + recette) ; elle exige le
  compte Google propriétaire/gestionnaire de la fiche et l'accord du restaurant. **Rien n'est publié sans ce compte.**

## Recette réelle (à faire avec le compte du restaurant — « attend le compte »)

Pré-requis : étapes 1–6 ci-dessous terminées (projet approuvé par Google, API activées, variables Render posées,
`/sante` → `"googleBusinessProfile": true`).

1. **Connexion** : écran **Avis** → **Connecter Google** → choisir le compte propriétaire/gestionnaire de la
   fiche, accepter. Attendu : l'écran affiche « Google est connecté » ; le journal note
   « Google Business Profile connecté ».
2. **Import** : **avant le premier import de recette, désactiver la règle « réponse auto aux 5★ »**
   (**Réglages** → réponses aux avis) : sinon, l'import publie d'office les réponses auto des avis 5★
   postés après la connexion — la recette ne doit publier qu'une seule réponse, relue (étape 3). Puis
   **Importer les avis Google**. Attendu : bilan « N nouvel(s) avis, … » ; chaque avis importé
   porte la source « Google » ; importer deux fois ne crée **aucun doublon** ; les avis saisis à la main et
   les brouillons en cours sont intacts ; une réponse déjà présente sur Google est reprise telle quelle.
   Réactiver la règle ensuite si le commerce la veut.
3. **Réponse de test (1 seule)** : sur un avis importé, relire le brouillon, « Marquer comme répondu », puis
   **Publier sur Google**. Attendu : la réponse apparaît sur la fiche Google (à vérifier sur Google) ;
   l'écran affiche « Réponse publiée sur Google … ». Ne publier **qu'une seule réponse de test**, relue —
   les anciens 5★ gardent leur réponse préparée, publiable d'un tap (la règle auto désactivée à l'étape 2
   empêche toute publication en rafale à l'import).
4. **Déconnexion (optionnel, pour vérifier la réversibilité)** : **Déconnecter Google** → la révocation est
   demandée chez Google (**best-effort** : confirmée seulement si l'écran l'indique — la route répond
   `revoque: false` si Google ne confirme pas) et les jetons sont effacés dans tous les cas ; les avis
   importés restent dans l'app ; l'import suivant répond 409 « Google n'est pas connecté ».
5. Si l'import répond « accès aux API Business Profile non accordé » ou « quota dépassé » : la demande de
   l'étape 2 n'est pas (encore) approuvée, ou les API de l'étape 3 ne sont pas activées (quotas à 0
   requête/minute = pas approuvé, 300 = approuvé).

Légende : ✅ = vérifié dans la documentation officielle de Google le 10/11/2026 · ⚠️ **à vérifier** = non vérifié (à
confirmer au moment de la démarche, Google change régulièrement ses écrans).

---

## Ce qu’il faut avant de commencer

- Le **compte Google propriétaire ou gestionnaire** de la fiche Google d’Asian Home Paris. C’est avec ce compte que
  se feront la demande d’accès et la connexion depuis l’app.
- Conditions posées par Google pour obtenir l’accès aux API ✅ : la fiche doit être **validée et active depuis plus de
  60 jours**, et le commerce doit avoir **un site web qui correspond à la fiche**.
- Un accès au tableau de bord **Render** du service `asian-home-fidelite` (pour les variables d’environnement).

Coût : l’usage des API Business Profile ⚠️ **à vérifier** (aucun tarif n’apparaît sur les pages consultées ; Google Cloud
peut demander un compte de facturation pour certains projets).

---

## Étape 1 — Créer le projet Google Cloud

1. Ouvrir <https://console.cloud.google.com/> avec le compte propriétaire/gestionnaire de la fiche.
2. Créer un projet (par exemple « Asian Home Fidélité »).
3. Noter le **numéro de projet** (Project Number) : il est affiché sur le tableau de bord du projet, carte « Project
   info » ✅. Il sera demandé dans le formulaire de l’étape 2.

## Étape 2 — Demander l’accès aux API Business Profile (examen par Google)

Les API Business Profile ne sont **pas ouvertes à tous** : Google examine chaque demande.

1. Ouvrir le formulaire de contact des API Google Business Profile (page Google « Prerequisites » :
   <https://developers.google.com/my-business/content/prereqs>) et choisir l’option
   **« Application for Basic API Access »** ✅.
2. Remplir le formulaire avec une adresse e-mail **propriétaire ou gestionnaire de la fiche** ✅ et le numéro de projet.
3. Attendre l’e-mail de réponse de Google ✅.

**Délai : inconnu.** Google ne donne pas de délai sur la page consultée (plusieurs jours à plusieurs semaines selon les
retours publics — ⚠️ **à vérifier**, rien d’officiel).

Comment savoir si la demande est acceptée ✅ : dans la console Google Cloud, quotas des API Business Profile :
**0 requête/minute = pas encore approuvé**, **300 requêtes/minute = approuvé**. En cas de refus, relire les conditions
avant de redemander.

## Étape 3 — Activer les API

Dans la console Google Cloud (menu « API et services » → « Bibliothèque »), activer les API Business Profile. La page
Google « Basic setup » ✅ (<https://developers.google.com/my-business/content/basic-setup>) en liste sept :

| API (nom exact dans la console) | Utile pour l’app ? |
| --- | --- |
| **Google My Business API** | **Oui** — lire les avis et y répondre (API v4 `accounts.locations.reviews`) |
| **My Business Account Management API** | **Oui** — lister les comptes du propriétaire |
| **My Business Business Information API** | **Oui** — trouver la fiche du restaurant |
| My Business Lodging API | Non (hôtellerie) |
| My Business Place Actions API | Non |
| My Business Notifications API | Non (pas utilisé pour l’instant) |
| My Business Verifications API | Non |

Activer au minimum les trois API marquées « Oui » (activer les sept ne gêne pas).

## Étape 4 — Écran de consentement OAuth

Dans « API et services » → « Écran de consentement OAuth » :

- Type d’utilisateurs : **Externe** (sauf si le compte appartient à une organisation Google Workspace) ⚠️ **à vérifier**
  selon le compte.
- Nom de l’application : « Asian Home Fidélité » ; adresse e-mail d’assistance : celle du commerce.
- Domaine autorisé : `onrender.com` (ou le domaine propre du commerce s’il y en a un) ⚠️ **à vérifier**.
- Ajouter le scope : `https://www.googleapis.com/auth/business.manage` ✅ (c’est le seul scope utilisé par l’app).
- Tant que l’application est « en test », ajouter le compte propriétaire de la fiche dans les **utilisateurs test**.
  ⚠️ **À vérifier** : en mode test, Google peut faire expirer le refresh token au bout de quelques jours ; publier
  l’application (et passer, si Google l’exige pour ce scope, une **vérification de l’application**) peut être nécessaire
  pour une connexion durable. Si l’app demande de « reconnecter Google » régulièrement, c’est la cause probable.

## Étape 5 — Créer les identifiants OAuth 2.0

« API et services » → « Identifiants » → « Créer des identifiants » → **ID client OAuth** :

- Type d’application : **Application Web**.
- **URI de redirection autorisés** : ajouter exactement

  ```
  https://asian-home-fidelite.onrender.com/api/v1/commerces/c-asian-home-paris/google/callback
  ```

  (adapter le domaine si l’app est servie ailleurs ; le chemin est toujours
  `/api/v1/commerces/<identifiant du commerce>/google/callback`).
- Valider : Google affiche un **ID client** et un **code secret du client**. Le code secret ne doit **jamais** être
  envoyé par e-mail, mis dans le code, ni collé ailleurs que dans Render.

## Étape 6 — Renseigner les variables sur Render

Render → service `asian-home-fidelite` → « Environment » → ajouter :

| Variable | Valeur | Obligatoire |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | l’ID client de l’étape 5 | oui |
| `GOOGLE_CLIENT_SECRET` | le code secret du client de l’étape 5 | oui |
| `GOOGLE_REDIRECT_URI` | l’URI de redirection déclarée à l’étape 5, à l’identique | conseillé (sinon : `PUBLIC_URL` ou l’adresse du serveur + le chemin callback) |
| `GOOGLE_BUSINESS_LOCATION` | `accounts/<n°>/locations/<n°>` | seulement si l’app ne trouve pas la fiche seule (voir plus bas) |

Enregistrer : Render redéploie. Vérification : `https://asian-home-fidelite.onrender.com/api/v1/sante` doit afficher
`"googleBusinessProfile": true`.

## Étape 7 — Connecter Google depuis l’app et tester

1. Ouvrir l’app, déverrouiller avec le PIN gérant, aller sur **Avis**. Le bloc « Connecter Google » affiche
   « à connecter ».
2. Appuyer sur **Connecter Google**, choisir le **compte propriétaire ou gestionnaire** de la fiche, accepter.
   L’app revient sur l’écran Avis avec « Google est connecté ».
3. Appuyer sur **Importer les avis Google**. L’app affiche le bilan (« N nouvel(s) avis, … »). Chaque avis porte sa
   source : « Google » ou « Saisi à la main ».
4. Tester une réponse sur un avis importé : relire le brouillon, « Marquer comme répondu », puis **Publier sur Google**.
   Vérifier sur la fiche Google que la réponse apparaît.

Si l’import répond « accès aux API Business Profile non accordé » ou « quota dépassé » : la demande de l’étape 2 n’est
pas (encore) approuvée, ou les API de l’étape 3 ne sont pas activées.

---

## Ce que fait l’app (et ce qu’elle ne fait pas)

- **Jetons OAuth** : rangés **uniquement côté serveur**, dans la table `meta` de Supabase (lisible par la seule clé
  `service_role`), **chiffrés** (AES-256-GCM, clé dérivée du code secret du client). Ils ne sont jamais envoyés au
  navigateur. Le code secret du client ne vit que dans la variable Render. Changer le code secret oblige à reconnecter
  Google (les anciens jetons deviennent illisibles).
- **Import** : déduplication par identifiant Google (importer deux fois ne crée pas de doublon). Les avis saisis à la
  main et les brouillons en cours ne sont jamais écrasés ; si un client modifie son avis sur Google, le texte et la note
  sont mis à jour à l’import suivant. Une réponse déjà présente sur Google est reprise telle quelle.
- **Réponses (règles de Réglages)** :
  - avis **5★** avec la règle « réponse auto aux 5★ » : réponse automatique préparée ; **publiée d’office seulement
    pour les avis postés après la connexion Google** (le premier import ne répond pas en rafale à tout l’historique :
    les anciens 5★ gardent leur réponse préparée, publiable d’un tap) ;
  - **tous les autres avis** (4★ compris, même avec la règle 4★) : **brouillon à relire et valider** (« Marquer comme
    répondu »), puis « Publier sur Google ». Rien n’est publié sans validation manuelle hors règle 5★.
- **Fiche Google** : l’app la trouve seule si le compte n’en gère qu’une, ou si son `placeId` correspond au lien
  « écrire un avis » configuré (`placeid=ChIJAV70Kqxt5kcRnhPY0L6yaf0`). ⚠️ **À vérifier** sur un vrai compte : le champ
  `metadata.placeId` renvoyé par l’API Business Information n’a pas pu être confirmé dans la documentation. Si l’import
  répond « plusieurs fiches… », renseigner `GOOGLE_BUSINESS_LOCATION`.
- **Déconnecter Google** : révoque l’accès chez Google puis efface les jetons ; les avis importés restent dans l’app.
- **Pas encore fait** : import automatique (il faut appuyer sur « Importer ») ; suppression d’une réponse sur Google
  (vider la réponse dans l’app ne la retire pas de Google) ; notifications en temps réel des nouveaux avis.

## Points d’API utilisés (pour un développeur)

| Usage | Appel | Vérifié |
| --- | --- | --- |
| Consentement | `https://accounts.google.com/o/oauth2/v2/auth` (`access_type=offline`, `prompt=consent`, `state` signé) | ✅ |
| Jetons / rafraîchissement | `POST https://oauth2.googleapis.com/token` (`authorization_code`, `refresh_token`) | ✅ (paramètres du rafraîchissement : forme standard OAuth, non relue en entier) |
| Révocation | `POST https://oauth2.googleapis.com/revoke` (`token=…`) | ✅ |
| Comptes | `GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts` | ✅ |
| Fiches | `GET https://mybusinessbusinessinformation.googleapis.com/v1/accounts/*/locations?readMask=name,title,metadata` | ✅ (sauf `metadata.placeId` ⚠️) |
| Avis | `GET https://mybusiness.googleapis.com/v4/accounts/{a}/locations/{l}/reviews` (50 par page, `nextPageToken`) | ✅ |
| Réponse | `PUT https://mybusiness.googleapis.com/v4/accounts/{a}/locations/{l}/reviews/{r}/reply` `{ "comment": … }` | ✅ |

Routes de l’app : voir `server/README.md` (section Google Business Profile). Code : `server/google-business.ts`,
`src/lib/avis.ts`, `src/pages/Avis.tsx` (réponse plafonnée à 2 000 caractères côté front) ;
tests : `tests/avis-google-p1-b4.test.ts` et `tests/google-business-p1-b8.test.ts` (Google simulé, aucun appel réel).

# Brevo — mise en service des relances SMS / e-mail (lot « Brancher Brevo », 10/11/2026)

Brevo est le **fournisseur choisi** pour les relances (SMS + e-mail) de l'app Asian Home Fidélité.
Un seul compte, une seule clé API, deux canaux. Twilio reste en repli pour les SMS **seulement si**
Brevo SMS n'est pas configuré (il n'est plus le prestataire par défaut).

**État réel (11/11/2026)** : le code est écrit et testé contre un Brevo **simulé** (`fetch` injecté,
`tests/brevo-sms.test.ts`, `tests/relances-p1-b3.test.ts`). **Le compte Brevo a été créé et activé le 11/11
au matin** (e-mail + mot de passe, lien de confirmation cliqué, téléphone vérifié par SMS, identité vérifiée
par e-mail) ; **clé API v3 « Asian Home Fidelite » créée** (accès Complet, expire 11/11/2027, 2FA non
activée) ; **expéditeur « Asian Home Paris » validé** (Brevo déconseille le
freemail Gmail pour la délivrabilité, pas de DKIM/DMARC) ; **expéditeur SMS `ASIANHOME`** ; les **5
variables Render sont posées** (dont `BREVO_MODE_TEST=1`), déploiement « Live » le 11/11 à 08h18 ;
`/sante` vérifié à 08h18 : `sms: true, email: true, smsPrestataire: 'Brevo', modeTest: true`.
**Aucun envoi réel n'a jamais eu lieu** (mode test : e-mail en sandbox Brevo, SMS simulé).
**Non re-vérifié dans ce lot** (lecture de `/sante` en production en délai dépassé, probablement le réveil
Render — à re-vérifier au prochain passage).

**État au 11/11/2026 (après activation, lot P2-Q5) :**
- **Validation simulée vérifiée de bout en bout (lot P1-B7**, `tests/brevo-production-p1-b7.test.ts`, sans clé ni
  réseau) : les 5 variables lues depuis l'environnement ; `/sante` combiné `sms: true, email: true,
  smsPrestataire: 'Brevo', modeTest: true` ; relance bienvenue e-mail (sandbox Brevo, en-tête
  `X-Sib-Sandbox: drop`, journal statut `test`) puis SMS (simulé, zéro appel réseau, journal `test`).
- **Compte Brevo créé et activé** (voir « État réel » ci-dessus) ; **les 5 variables Render sont posées** ;
  `/sante` en production vérifié à 08h18 : `sms: true, email: true, smsPrestataire: 'Brevo', modeTest: true`
  (non re-vérifié dans ce lot — voir ci-dessus).
- **Recette réelle (§5 B) : « attend l'accord explicite de l'utilisateur »** — aucun envoi réel fait ;
  pré-requis restants : crédits SMS achetés (§2 : tarif à confirmer dans le compte) et destinataires définis.
- **Tarif SMS :** la page Brevo affichait le 11/11 un tarif **à partir de 0,073 €/SMS** (signalé par
  l'agent parent, **à confirmer** au moment de l'achat, contre ~0,045 €/SMS estimé le 10/11) — vérifier
  le montant exact dans le compte avant d'acheter des crédits (§2).

**Consigne du 10/11/2026 ~22h14 (mode autonome) : AUCUN envoi réel de SMS, d'e-mail ou de réponse
Google, et aucun paiement réel, pendant le développement — mode test uniquement.** La vérification du
branchement se fait donc sans rien livrer (voir §5) : e-mail en **sandbox Brevo** (`X-Sib-Sandbox:
drop`, 201 + `messageId`, rien livré), SMS **simulé** (Brevo ne propose pas de sandbox SMS) et tracé
dans le journal avec le statut explicite `test` (« Test — rien envoyé »). Le test d'envoi réel se fera
plus tard, hors développement, avec l'accord explicite de l'utilisateur (§5, partie B).

## 1. Ce que le code fait (pour vérifier avant d'acheter)

| Canal | Route API Brevo | Variables Render |
|---|---|---|
| E-mail | `POST https://api.brevo.com/v3/smtp/email` | `BREVO_API_KEY` + `BREVO_SENDER_EMAIL` (+ `BREVO_SENDER_NAME` optionnel) |
| SMS | `POST https://api.brevo.com/v3/transactionalSMS/send` | `BREVO_API_KEY` + `BREVO_SMS_SENDER` (ex. `ASIANHOME`) |

- **E-mail** : expéditeur `{ nom, email }`, destinataire, objet, corps texte ; en-têtes
  `List-Unsubscribe` / `List-Unsubscribe-Post` ajoutés par l'app (bouton « Se désabonner » des
  messageries) ; le lien de désinscription de l'app (`#/desinscription/<client>/<jeton HMAC>`) est
  dans le pied de chaque e-mail. Brevo n'ajoute pas de lien de désinscription aux e-mails
  transactionnels : c'est la route de l'app qui retire le consentement.
- **SMS** : corps JSON `{ sender, recipient, content, type: 'transactional', tag: 'fidelite' }`.
  Réponse `{ messageId: <nombre> }`, rangée dans le journal des envois (`envois.idPrestataire`).
  Expéditeur : lettres et chiffres seulement, **11 caractères maximum** (ou 12 à 15 chiffres pour
  un expéditeur numérique) — un nom invalide (espace, tiret, trop long) = SMS Brevo **non configuré**
  (`/sante` → `sms: false`, relance SMS → 501).
- **Route SMS utilisée** : `/v3/transactionalSMS/send` (route actuelle de la doc Brevo, lue le
  10/11/2026 — [référence API](https://developers.brevo.com/reference/send-async-transactional-sms)) ;
  l'ancienne route `/v3/transactionalSMS/sms` est dépréciée.
- **Mention STOP** : chaque SMS de relance se termine par « STOP : <lien court de désinscription `/d/<id>/<jeton>`> »
  (P1-B9 — le mot STOP est conservé, mention obligatoire en France pour un SMS marketing, mais il ne promet plus de
  réponse : le lien, qui ouvre la page `#/desinscription` (retrait au clic), est le seul mécanisme utilisable avec
  l'expéditeur alphanumérique Brevo). Brevo **bascule automatiquement** un SMS
  transactionnel en `marketing` quand son contenu porte un code STOP (doc Brevo) : les relances
  sont donc traitées comme du marketing côté Brevo, ce qui est leur vraie nature. SMS en alphabet GSM, la plupart
  font 2 segments : 2 SMS facturés par relance (vérifié par les tests).
- **Priorité** : si `BREVO_SMS_SENDER` est posé → SMS via Brevo ; sinon, si Twilio est configuré →
  SMS via Twilio ; sinon → 501. L'e-mail passe toujours par Brevo.
- **Mode test (`BREVO_MODE_TEST=1`, voir §5)** : tant que cette variable vaut `1`, **aucun SMS /
  e-mail réel ne part, même avec de vraies clés** — l'e-mail passe par le sandbox Brevo
  (`X-Sib-Sandbox: drop`), le SMS est simulé (aucun appel réseau ; Twilio aussi est simulé s'il
  est le repli). Chaque tentative est tracée dans le journal des envois avec le statut `test`
  (« Test — rien envoyé », libellé `Test — rien envoyé` dans l'écran Messages) et la route relance
  répond 200 `{ envoye: false, test: true }`. `/sante` signale le mode test
  (`integrations.modeTest: true`) et l'écran Messages l'affiche. La simulation n'occupe **pas** le
  créneau anti-doublon du jour (index partiel sur `en_cours` / `envoye`) : un vrai envoi reste
  possible le même jour une fois le mode test coupé. **Retirer la variable pour envoyer pour de
  vrai** (redéploiement Render).
- **Consentement** : aucun envoi sans `consentementRelance: true` sur la fiche client (case jamais
  pré-cochée, retrait possible à tout moment) ; anti-doublon 1 relance par modèle, par client et
  par jour (table `envois`, migration 0007) ; chaque tentative, même refusée, est journalisée.

## 2. Coûts (relevés le 10/11/2026 — à confirmer sur la page tarifs au moment de l'achat)

| Poste | Coût |
|---|---|
| Compte Brevo gratuit | 0 € — **300 e-mails / jour** inclus (transactionnels + marketing). Suffisant pour les relances d'un restaurant. |
| SMS vers la France | **~0,045 € HT / SMS** (4,5 crédits ; 100 crédits = 1,00 €). Crédits prépayés, sans abonnement, sans expiration annoncée. |
| SMS de test à la création | 20 SMS offerts à l'inscription selon plusieurs comparatifs — **à vérifier dans le compte**. |

Sources : page tarifs Brevo (`brevo.com/pricing`, onglet SMS, calculatrice pay-as-you-go) via ses
relevés publics du 24–29/10/2026 (France : 4,5 crédits/SMS, 1 000 SMS = 49,05 $). Les tarifs
peuvent changer : **vérifier le montant exact dans le compte Brevo avant d'acheter des crédits**.
Estimation d'usage : quelques dizaines de relances par mois au lancement → quelques euros par mois.

## 3. Mise en service pas à pas (navigateur, ~15 min)

### Étape A — Compte Brevo

1. Aller sur [brevo.com](https://www.brevo.com) → **« S'inscrire gratuitement »** (plan gratuit,
   aucune carte bancaire demandée pour le gratuit).
2. Renseigner l'e-mail du commerce (de préférence une adresse du restaurant, ex.
   `contact@asianhomeparis.fr` si elle existe, sinon l'adresse habituelle), le mot de passe, le nom
   du commerce (« Asian Home Paris »).
3. Confirmer l'e-mail de validation reçu de Brevo.

### Étape B — Clé API

1. Dans le tableau de bord Brevo : **Settings** (⚙️, en bas à gauche) → **SMTP & API** → onglet
   **API Keys** → **Generate a new API key**.
2. Nommer la clé (ex. `asian-home-fidelite-prod`), copier la valeur affichée **une seule fois**
   (Brevo ne la remontre plus ensuite).
3. C'est la valeur de `BREVO_API_KEY` (voir §4). **Ne jamais la mettre dans le code, dans Git,
   ni dans un message** : uniquement dans les variables Render.

### Étape C — Expéditeur e-mail (à valider chez Brevo)

1. **Settings → Senders** (ou **Senders & IP** selon la version du tableau de bord) → **Add a
   sender** : nom « Asian Home Paris », adresse e-mail du commerce.
2. Cliquer le lien de validation reçu à cette adresse.
3. **Recommandé** (pas obligatoire pour démarrer) : authentifier le domaine du commerce (SPF/DKIM)
   depuis la même page — sinon les e-mails risquent davantage le dossier spam.
4. L'adresse validée est la valeur de `BREVO_SENDER_EMAIL` ; le nom affiché, celui de
   `BREVO_SENDER_NAME` (optionnel, défaut « Asian Home Fidélité »).

### Étape D — Expéditeur SMS

1. Aucune validation préalable n'est demandée par Brevo pour un expéditeur alphanumérique : le nom
   est envoyé tel quel à chaque SMS (`sender` de l'API).
2. Choisir `ASIANHOME` (9 caractères, lettres seules — dans la limite de 11, voir §1).
3. C'est la valeur de `BREVO_SMS_SENDER`.
4. **Acheter des crédits SMS** (onglet SMS / crédits du tableau de bord) : un pack de 100 SMS
   (~4,50 € HT) suffit pour démarrer. Sans crédits, Brevo refuse l'envoi (la route répond 502 et
   le journal des envois marque l'essai « erreur »).

### Étape E — Variables Render (5 variables, voir §4)

1. [dashboard Render](https://dashboard.render.com) → service `asian-home-fidelite` →
   **Environment** → ajouter les 5 variables (voir §4) → **Save Changes** (le service redéploie).
   **Fait le 11/11/2026** (déploiement « Live » à 08h18).
2. Aucune variable dans `render.yaml` : les secrets sont posés à la main dans le dashboard
   (ils y sont déjà, `sync: false`).

### Étape F — Vérifications en mode test (aucun envoi réel — voir §5)

1. `GET https://asian-home-fidelite.onrender.com/api/v1/sante` → `integrations: { sms: true,
   email: true, modeTest: true }` (tant que `BREVO_MODE_TEST=1` est posée) et
   `migrations.relances: true` (migration 0007 déjà appliquée le 10/11/2026 ;
   si `false`, l'appliquer d'abord — voir `server/README.md`, « Migration 0007 »).
2. Suivre la procédure de vérification du §5 (sandbox e-mail, SMS simulé, journal « test »).
3. **Aucun e-mail ni SMS réel n'est envoyé à cette étape, même pas l'e-mail de test** : le test
   réel se fait plus tard, hors développement, avec l'accord explicite de l'utilisateur (§5, partie B).

## 4. Variables d'environnement Render — liste exacte

| Variable | Valeur | Obligatoire |
|---|---|---|
| `BREVO_API_KEY` | Clé API générée à l'étape B (chaîne `xkeysib-…`) | Oui (SMS + e-mail) |
| `BREVO_SENDER_EMAIL` | Adresse expéditrice validée à l'étape C | Oui (e-mail) |
| `BREVO_SENDER_NAME` | Nom affiché, ex. `Asian Home Paris` | Non (défaut « Asian Home Fidélité ») |
| `BREVO_SMS_SENDER` | Nom d'expéditeur SMS, ex. `ASIANHOME` | Oui (SMS) |
| `BREVO_MODE_TEST` | `1` = mode test : aucun envoi réel (e-mail en sandbox Brevo, SMS simulé, journal « test »). **À poser pendant le développement, à retirer pour envoyer pour de vrai.** | Non — mais obligatoire tant que la consigne « mode test uniquement » s'applique |

Sans `BREVO_SMS_SENDER` : l'e-mail marche, le SMS répond 501. Sans `BREVO_SENDER_EMAIL` :
l'e-mail répond 501, le SMS marche (si `BREVO_SMS_SENDER` est posé). Twilio
(`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`) n'est **plus nécessaire** : il ne sert
que de repli si Brevo SMS est absent. Ne pas supprimer les variables Twilio si elles existent
déjà — elles ne gênent pas, Brevo reste prioritaire.

## 5. Vérification en mode test uniquement (aucun envoi réel) — puis test réel, plus tard

### A. Mode test (développement — c'est la seule vérification autorisée pour l'instant)

Prérequis : variables de l'étape E posées, **dont `BREVO_MODE_TEST=1`**.

1. **Tests automatisés** (sans clé, sans réseau) : `npm test` — les adaptateurs Brevo sont testés
   avec un `fetch` injecté (`tests/brevo-sms.test.ts`, `tests/relances-p1-b3.test.ts`) : requête
   Brevo bien formée, en-tête sandbox, simulation SMS sans appel, journal tracé.
2. **Serveur local** : `BREVO_API_KEY=<vraie clé> BREVO_SENDER_EMAIL=… BREVO_SMS_SENDER=ASIANHOME
   BREVO_MODE_TEST=1 npm run serveur` → `/api/v1/sante` : `integrations { sms: true, email: true,
   smsPrestataire: 'Brevo', modeTest: true }` ; le démarrage journalise
   `[serveur] MODE TEST Brevo actif…`.
3. **E-mail en sandbox Brevo** : dans l'app (écran **Clients**, PIN commerçant), créer un client
   test avec un e-mail, **cocher** la case « offres par SMS ou e-mail », puis fiche du client →
   **Relance** → modèle **bienvenue** → canal **e-mail** → Envoyer. Attendus : réponse 200
   `{ envoye: false, test: true, canal: 'email' }`, annonce « ✓ Mode test — rien envoyé »,
   **aucun e-mail reçu** (Brevo a validé la requête — 201 + `messageId` — sans rien livrer),
   journal des envois (**Messages** → « Journal des envois ») : ligne « bienvenue / e-mail /
   Test — rien envoyé ».
4. **SMS simulé** : même client test avec un numéro, canal **sms** → réponse 200
   `{ envoye: false, test: true, canal: 'sms' }`, **aucun SMS reçu, aucun appel réseau vers
   Brevo** (Brevo ne propose pas de sandbox SMS), journal : ligne « bienvenue / sms /
   Test — rien envoyé ». La simulation n'occupe pas le créneau anti-doublon du jour : un vrai
   envoi restera possible le même jour une fois le mode test coupé.
5. **STOP / désinscription** : le lien de désinscription d'un e-mail de test ne peut pas être
   vérifié en sandbox (rien n'est livré) — il est couvert par les tests automatisés (jeton HMAC,
   retrait au clic, idempotent). Le retrait du consentement sur la fiche client reste vérifiable
   à la main, sans envoi.
6. **Supprimer le client test** ensuite (fiche client → « Supprimer ce client ») pour ne laisser
   aucune donnée de test en production.

### B. Test réel (plus tard, hors développement, avec l'accord explicite de l'utilisateur)

**Ne pas faire pendant le développement.** Quand l'utilisateur donne son accord explicite :

**Pré-requis (à cocher avant de retirer le mode test) :**
- [x] Compte Brevo créé, clé API `BREVO_API_KEY` posée dans Render (fait le 11/11/2026, étape B).
- [x] Expéditeur e-mail validé chez Brevo, `BREVO_SENDER_EMAIL` posée (fait le 11/11/2026, étape C).
- [ ] Expéditeur SMS `ASIANHOME` posé (`BREVO_SMS_SENDER`) et **crédits SMS achetés** (sans crédits,
  Brevo refuse l'envoi — 502, journal « erreur »). Tarif à confirmer dans le compte (§2 : ~0,045 €/SMS
  estimé le 10/11, à partir de 0,073 €/SMS affiché le 11/11). **Achat de crédits non confirmé** (à vérifier
  dans le tableau de bord Brevo avant la recette SMS).
- [ ] Destinataires définis et consentants : e-mail `yassbybibiche@gmail.com` (l'utilisateur), puis
  1 SMS vers **son propre numéro** (celui vérifié chez Brevo) — **aucun vrai client** ne reçoit quoi
  que ce soit pendant cette recette.

1. Retirer `BREVO_MODE_TEST` des variables Render (redéploiement), vérifier `/sante` :
   `integrations.modeTest` absent, `sms: true, email: true`.
2. Créer un client test « Yassine Test » avec l'e-mail `yassbybibiche@gmail.com`, **cocher** la case
   « offres par SMS ou e-mail » (consentement explicite — jamais pré-cochée, y compris pour un test).
3. Fiche du client → **Relance** → modèle **bienvenue** → canal **e-mail** → Envoyer.
4. Attendus : réponse 200 `{ envoye: true, canal: 'email', modele: 'bienvenue' }` ; e-mail reçu
   sur `yassbybibiche@gmail.com` (objet « Bienvenue à Asian Home Paris », lien de la carte, lien
   de désinscription en pied) ; journal des envois (**Messages** → « Journal des envois ») :
   ligne « bienvenue / e-mail / Envoyé ».
5. Rejouer la même relance le même jour → **409** (« déjà été envoyée à ce client aujourd’hui »).
6. SMS : **un deuxième client test** (« Yassine Test SMS ») avec son propre numéro, canal **sms**,
   modèle **bienvenue** → SMS reçu signé `ASIANHOME`, avec le lien court `/c/<id>` et la mention STOP ;
   journal : ligne « bienvenue / sms / Envoyé ». **Ne pas réutiliser le client de l'étape 2 le même jour :**
   l'anti-doublon (1 relance par modèle, par client et par jour) ne distingue pas le canal — un SMS
   « bienvenue » au même client le même jour que l'e-mail répondrait 409, comme à l'étape 5.
7. Cliquer le lien de désinscription de l'e-mail → page de désinscription → bouton
   « Me désinscrire » → le consentement du client test passe à `false` (fiche client) et toute
   relance suivante répond 409.
8. **Supprimer les deux clients test** ensuite (fiche client → « Supprimer ce client ») pour ne laisser
   aucune donnée de test en production.

## 6. STOP et désinscription — limites connues (lire avant d'activer)

- **SMS Brevo, pas de réponse STOP possible** : l'expéditeur est alphanumérique (`ASIANHOME`),
  le client ne peut pas répondre au SMS (il n'y a pas de numéro destinataire). Brevo met en
  liste noire les contacts qui répondent STOP **quand une réponse est possible** (expéditeur
  numérique), mais ce n'est pas le cas ici. Conséquence : **le consentement de l'app est la
  seule source de vérité** — un client qui veut arrêter les SMS clique le lien de désinscription
  porté par chaque SMS (`STOP : <lien court /d/…>`, P1-B9, même jeton HMAC que les e-mails), le dit
  au commerçant (qui retire le consentement sur la fiche), clique le lien de désinscription d'un
  e-mail, ou demande la suppression de sa carte. La route `POST /commerces/:id/stop-sms` répond
  **501** quand les SMS partent via Brevo (elle reste réservée au webhook Twilio, avec signature).
- **La mention STOP reste dans le texte** (obligation française pour un SMS marketing) et fait
  basculer le message en `marketing` côté Brevo (voir §1).
- **E-mail** : désinscription par le lien de l'app (retrait au clic, pas à l'ouverture — un
  antivirus qui suit les liens ne désinscrit personne) + bouton natif « Se désabonner » des
  messageries (`List-Unsubscribe` / One-Click). Brevo n'ajoute pas de lien de désinscription aux
  e-mails transactionnels.
- **Après un STOP / une désinscription**, se ré-inscrire en cochant la case ne réabonne **pas**
  un client déjà inscrit : seul le commerçant peut remettre le consentement sur la fiche.

## 7. Dépannage

| Symptôme | Cause probable | À faire |
|---|---|---|
| `/sante` → `sms: false` | `BREVO_SMS_SENDER` absent ou invalide (espace, > 11 car.) | Vérifier la variable Render (pas d'espace, ≤ 11 car. alphanumériques) puis redéployer. |
| `/sante` → `email: false` | `BREVO_SENDER_EMAIL` absent | Vérifier la variable Render. |
| Relance → 200 `{ envoye: false, test: true }`, journal « Test — rien envoyé » | **Normal en mode test** (`BREVO_MODE_TEST=1`) : rien n'a été livré, c'est le but. Pour envoyer pour de vrai : retirer la variable (voir §4) — plus tard, avec accord explicite (§5 B). |
| Relance → 501 « à brancher » | Prestataire du canal non configuré | Voir les deux lignes ci-dessus. |
| Relance → 502 « Brevo a refusé l’envoi (HTTP 401) » | Clé API fausse ou révoquée | Régénérer une clé (étape B) et la reposer dans Render. |
| Relance → 502 « Brevo a refusé l’envoi (HTTP 400) » | Expéditeur rejeté par Brevo (e-mail non validé, nom SMS invalide) | Valider l'expéditeur e-mail (étape C) ; vérifier `BREVO_SMS_SENDER`. |
| Relance → 502 (autre HTTP) | Crédits SMS épuisés, compte suspendu, destinataire invalide | Tableau de bord Brevo (crédits, journaux transactionnels) ; le journal des envois de l'app garde la trace (« erreur »). |
| Relance → 409 « déjà été envoyée aujourd’hui » | Anti-doublon normal | Attendre le lendemain (heure de Paris) ou choisir un autre modèle. |
| Relance → 409 « pas donné son consentement » | Client non consentant (ou désinscrit) | Ne **jamais** forcer : reposer le consentement sur la fiche, avec l'accord du client. |
| Relance → 503 | Migration 0007 absente | Appliquer `supabase/migrations/0007_relances.sql` (voir `server/README.md`). |
| E-mail en spam | Domaine non authentifié (SPF/DKIM) | Authentifier le domaine (étape C). |

## 8. Fichiers concernés

- `server/notifications/brevo.ts` : adaptateurs e-mail (`adaptateurBrevo`, sandbox `X-Sib-Sandbox`
  en mode test) et SMS (`adaptateurBrevoSms`, simulé en mode test ; `configBrevoSms`,
  `expediteurSmsValide`).
- `server/notifications/twilio.ts` : inchangé comme prestataire — repli SMS si Brevo SMS absent ;
  simulé lui aussi en mode test (aucun vrai SMS par la porte de derrière).
- `server/notifications/index.ts` : `configDepuisEnv` (lit les 5 variables, dont `BREVO_MODE_TEST`),
  priorité SMS Brevo > Twilio, `prestataire(canal)`, `modeTest`.
- `server/app.ts` : route `stop-sms` → 501 explicite quand les SMS partent via Brevo ; `relancer()`
  → statut `test` en mode test ; route relance → `{ envoye, test }` ; `/sante` → `smsPrestataire`,
  `modeTest`.
- `server/index.ts` : avertissement de démarrage quand le mode test est actif.
- `src/types.ts` : `StatutEnvoi` += `'test'` ; `src/lib/relances.ts` : libellé « Test — rien envoyé » ;
  `src/lib/integrations.ts` : ligne « Mode test Brevo actif » dans `etatRelances` ;
  `src/data/api.ts` : `relancer()` → `{ envoye, test? }` ; `src/pages/FicheClient.tsx` : annonce
  « ✓ Mode test — rien envoyé » ; `src/pages/Messages.tsx` : `modeTest` lu sur `/sante`.
- `tests/brevo-sms.test.ts`, `tests/relances-p1-b3.test.ts` (describe « SMS via Brevo » et
  « Mode test Brevo »), `tests/integrations-v3.test.ts`, `tests/relances-ui-p1-b3.test.ts`,
  `tests/rgpd-p1-b6.test.ts`.
- `server/README.md` (§ « SMS / e-mail », variables) et `src/lib/integrations.ts` (textes affichés).

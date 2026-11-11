# JOURNAL — Fideliz

## 11/11/2026 — P1-B8 « Google Business (configuration + recette) » (AUDIT.md §7, revue Codex point 9)
- **Ce lot ne crée ni projet Cloud, ni clé, ni publication réelle.** Les fonctions et routes existaient déjà
  (P1-B4) ; le lot ajoute des garde-fous côté code, vérifie le code contre un Google simulé et documente la
  configuration + la recette réelle, qui attendent le compte Google du restaurant.
- **Garde-fous** (`server/google-business.ts`, `server/app.ts`, `src/pages/Avis.tsx`) : réponse vide → 400
  (helper ; 409 « brouillon non validé » via la route) ; réponse > **4 096 octets** (limite Google, vérifiée
  le 11/11/2026 dans la référence API — pas des caractères) → 400 ; identifiant d'avis / fiche mal formés
  (`?`, `#`, `..` refusés) → 400 / 409 ; `GOOGLE_BUSINESS_LOCATION` mal renseignée → **409 explicite** à
  l'import, **avant tout appel à Google** (même le rafraîchissement du jeton) ; champ de réponse plafonné
  à 2 000 caractères côté front (comme la route PATCH avis).
- **Tests** (`tests/google-business-p1-b8.test.ts`, 10 tests, Google simulé, jamais contre Google) : gardes
  unitaires (dont multi-octets aux frontières : 1 400 × « 漢 » = 4 200 octets refusés, 2 048 × « é » =
  4 096 octets acceptés), `emplacementAImporter`, import serveur avec `GOOGLE_BUSINESS_LOCATION` invalide
  (409, zéro appel à Google même jeton expiré) puis valable (1 avis importé), écran + doc.
- **docs/GOOGLE-BUSINESS.md** : état au 11/11/2026 ; recette réelle en 5 étapes (connexion, import, 1 réponse
  de test, déconnexion optionnelle, diagnostic 403/quota) marquée **« attend le compte »** ; consigne ajoutée
  : **désactiver la règle auto 5★ avant le premier import de recette** (sinon l'import publie d'office les
  réponses auto des 5★ postés après la connexion) ; révocation présentée comme best-effort.
- **Revue Codex (7 points, `/tmp/p1-b8-revue-codex.md`) — 6 fondés, corrigés :** 1. [Majeur] limite en
  octets, pas en caractères (vérifié dans la référence Google) → `Buffer.byteLength`, messages/doc/tests
  corrigés. 2. [Majeur] recette « une seule réponse » non garantie (auto 5★ à l'import) → désactivation de
  la règle documentée dans la recette. 3. [Mineur] regex acceptant `?`, `#`, `..` → segments restreints
  (`[A-Za-z0-9][A-Za-z0-9._-]*`, 1er caractère alphanumérique). 4. [Mineur] révocation présentée comme
  certaine → best-effort explicité. 5. [Remarque] « réponse vide → 400 » = helper, pas la route (409) →
  précisé dans la doc. 6. [Remarque] `accesGoogle` (rafraîchissement) précédait la validation → validation
  déplacée avant tout appel Google + test jeton expiré. Point 7 (remarque : statuts cohérents, front,
  aucun appel réel) : rien à corriger.
- **Tests : 1056 → 1066 (+10)**, suite verte, `npx tsc -p .` propre, typecheck serveur inclus dans
  `npm test`. Aucun test existant modifié, aucun secret, aucun appel réel à Google.
- **Non vérifié (attend le compte Google du restaurant + son accord) :** projet Cloud, OAuth, approbation
  Google, variables Render, import réel + 1 réponse de test sur la vraie fiche (procédure § « Recette
  réelle » de docs/GOOGLE-BUSINESS.md).

## 11/11/2026 — P1-B7 « Brevo en production » (AUDIT.md §7, revue Codex point 8)
- **Ce lot ne crée ni compte Brevo, ni clé, ni envoi réel.** Le code Brevo existait déjà (commit `4862968`) ;
  le lot vérifie la validation **simulée** de bout en bout et documente la recette réelle autorisée.
- **Validation simulée vérifiée** (`tests/brevo-production-p1-b7.test.ts`, 5 tests, sans clé ni réseau) :
  les 5 variables Render lues depuis l'environnement (`configDepuisEnv` : clé, expéditeurs, drapeaux
  `bacASable` / `modeTest`) ; serveur branché avec cette même configuration ; `/sante` combiné
  `{ sms: true, email: true, smsPrestataire: 'Brevo', modeTest: true }` ; relance bienvenue e-mail
  (sandbox Brevo, `X-Sib-Sandbox: drop`, journal statut `test`) puis SMS (simulé, zéro appel réseau,
  journal `test`) ; la simulation répétée repasse (le statut `test` n'occupe pas le créneau anti-doublon).
- **docs/BREVO.md** : état au 11/11/2026 (compte en cours de création côté agent parent — création annoncée
  par l'agent parent, non vérifiée ici ; **clés attendues**) ; pré-requis à cocher avant la recette réelle
  (§5 B : clé, expéditeur e-mail validé, crédits SMS achetés, destinataires définis) ; tarif SMS : page
  Brevo affichant à partir de 0,073 €/SMS le 11/11 (signalé par l'agent parent, **à confirmer** au moment
  de l'achat, contre ~0,045 € estimé le 10/11).
- **Revue Codex (6 points, `/tmp/p1-b7-revue-codex.md`) — 4 fondés, corrigés :** 1. [Mineur] valeurs de
  `configDepuisEnv` non assertées, serveur de test configuré à la main → valeurs assertées + serveur
  branché via `configDepuisEnv(ENV_COMPLET)`. 3. [Remarque] répétition de simulation absente du scénario
  → répétition SMS ajoutée (200, journal `test`). 4. [Mineur] **procédure §5 B fausse** : après un e-mail
  « bienvenue » réel, un SMS « bienvenue » au même client le même jour répond 409 — l'index unique
  `envois_un_par_jour (commerce, client, modèle, jour)` ignore le canal (vérifié : migration 0007) →
  recette SMS déplacée sur un **deuxième client test**, avec l'explication dans la doc. 5. [Remarque]
  « compte en cours de création » → précisé « création annoncée par l'agent parent, non vérifiée ici ».
  Points 2 et 6 (remarques : assertions fondées, aucun risque d'envoi réel) : rien à corriger.
- **Tests : 1051 → 1056 (+5)**, suite verte, `npx tsc -p .` propre, typecheck serveur inclus dans
  `npm test`. Aucun test existant modifié, aucun secret, aucun envoi réel.
- **Non vérifié (attend les clés + l'accord explicite de l'utilisateur) :** `/sante` en production
  (`sms: true, email: true, smsPrestataire: 'Brevo'`) ; recette réelle §5 B (1 e-mail vers
  yassbybibiche@gmail.com, puis 1 SMS vers le numéro de l'utilisateur, sur deux clients test distincts).

## 11/11/2026 — P1-P1 « Egress / polling » (AUDIT.md §7, F-16)
- **Décision (intervalle allongé, pas de différentiel) :** le rechargement périodique du store passe de 10 s à 30 s
  (`INTERVALLE_RECHARGEMENT_MS`, `src/store.tsx`) ; rechargement sur action, au retour au premier plan et au retour du
  réseau conservés. Un rechargement différentiel n'est pas fait dans ce lot : il exige un point de reprise côté serveur
  (version/horodatage par ligne) et le seuil mesuré laisse de la marge à l'échelle actuelle (voir ci-dessous).
- **Mesure locale (vrais octets UTF-8, `tests/egress-p1-p1.test.ts`, 150 clients / 100 visites / journal 100 entrées,
  1 onglet visible 12 h/j, 30 j) :** HTTP `/etat` 69 210 o + `/commerces` 1 088 o = 70 298 o par rechargement →
  **9,11 Go/mois à 10 s, 3,04 Go/mois à 30 s** ; côté PostgREST (lignes lues avec les colonnes sélectionnées dans
  `server/stockage-supabase.ts` — `id,version,donnees` pour clients, `donnees` pour tirages/journal — proxy de l'egress
  Supabase, pas la mesure dashboard) : 81 037 o → **3,50 Go/mois à 30 s**, sous les 5 Go gratuits. À 300 clients :
  4,68 Go HTTP / 5,60 Go PostgREST à 30 s — **seuil 5 Go côté PostgREST vers ~257 clients** (pente mesurée sur deux
  volumes, 324 o/client) : le différentiel deviendra nécessaire à ce volume. La minuterie caisse 15 s (`GET /caisse`,
  240 o) ne pèse que 0,02 Go/mois ; un 2e onglet double le rechargement périodique. **Reste : l'egress réel dans le
  dashboard Supabase** (pas d'accès navigateur sur cette VM — à lire par l'agent parent, Database → Usage ou
  Settings → Usage).
- **Roue :** la boucle Jouer (`INTERVALLE_VERIFICATION_MS`, `attenteVisite.ts`) est indépendante du store et inchangée —
  vérification espacée de 10 s après chaque réponse réussie (hors latence réseau ; recul jusqu'à 60 s après échecs), donc
  déblocage inchangé par le lot. Le critère « déblocage toujours < 10 s » de l'AUDIT est approximatif en ce sens (il
  l'était déjà avant le lot) : la garantie exacte est l'espacement de 10 s après réponse.
- **Revue Codex (7 points, `/tmp/p1-p1-revue-codex.md`) — tous fondés, corrigés :**
  1. [Majeur] La mesure comptait des caractères UTF-16, pas des octets (accents sous-estimés) → `arrayBuffer().byteLength`
     partout ; chiffres publiés recalculés (74 169 o → 70 298 o HTTP, 9,61 → 9,11 Go à 10 s, 3,20 → 3,04 Go à 30 s).
  2. [Majeur] La taille HTTP mesure le flux Node → navigateur, pas Supabase → Node → mesure PostgREST ajoutée
     (enveloppes `id,version,donnees`, 3,50 Go/mois à 30 s) + libellé précisé dans le test et l'AUDIT.
  3. [Majeur] Le « < 5 Go » ne valait que pour le scénario périodique 1 onglet → exclusions explicitées (2e onglet,
     caisse 15 s mesurée à 0,02 Go/mois, actions/focus non comptés) ; le critère global reste à démontrer par le dashboard.
  4. [Mineur] « Déblocage toujours < 10 s » faux à la lettre (10 s après la réponse + latence) → libellé corrigé
     (store, AUDIT) : espacement de 10 s après réponse réussie.
  5. [Mineur] Seuil « ~234 clients » extrapolé d'un seul échantillon → mesure à deux volumes (150 et 300 clients) dans
     le test, seuil recalculé ~257 clients côté PostgREST.
  6. [Mineur] Le test ne vérifiait pas les tailles citées dans l'AUDIT → garde-fous ajoutés (rechargement 10 Ko–100 Ko,
     PostgREST ≥ HTTP, croissance avec le volume, 10 s > 5 Go) ; les chiffres exacts restent documentés ici et dans
     l'AUDIT.
  7. [Mineur] Commentaire `store.tsx` (~12 Go) incohérent avec l'AUDIT (9,61 Go) → harmonisé sur les chiffres corrigés
     (9,11 Go à 10 s / 3,04 Go HTTP à 30 s, 3,50 Go PostgREST).
  Aucun secret, aucun envoi réel introduit (confirmé par la revue).
- **Tests : 1048 → 1051 (+3, `tests/egress-p1-p1.test.ts` : constante 30 s + événements + action, roue à 10 s,
  mesure live)**, suite verte, typechecks inclus dans `npm test`. Aucun test existant modifié.
- **Non vérifié.** Egress réel dashboard Supabase (voir ci-dessus) ; aucun test sur téléphone réel ; l'hypothèse
  « onglet visible 12 h/j » est celle de l'AUDIT étape 0, non relevée.

## 11/11/2026 — P1-S12 « Garde 1 tampon/jour sur `visite` » (AUDIT.md §7, F-11)
- **Décision (gardée, pas supprimée) :** la route historique `POST /commerces/:id/clients/:id/visite` reste — c'est le
  passage rapide sans achat des écrans FicheClient (« Valider une visite (+1 tampon) ») et Clients (« Valider une
  visite (+1) »), distinct de l'écran caisse (code équipe + montant). La caisse avec montant 0 donnerait le même
  résultat, mais supprimer la route retirerait un geste commerçant existant (`api.visite`, utilisé par les deux écrans).
- **Garde :** la branche `visite` de `server/app.ts` appelle désormais `passageAvecProgramme()` (la même fonction que la
  caisse), 409 « 1 tampon par jour maximum » sinon — refus avant toute écriture (client, parrainage, journal). Import
  `appliquerVisiteProgramme` retiré de `app.ts` (plus utilisé). Front : bouton désactivé + avertissement « Déjà un
  passage aujourd’hui : 1 tampon par jour maximum. » sur FicheClient ET Clients (même texte que la caisse).
- **Découverte en testant :** le test « journal d'audit » de `cartiz.test.ts` s'appuyait sans le savoir sur le bug — la
  `visite` du gérant y créditait un 2e tampon le même jour (Lina avait déjà un passage le 11, action hors ligne
  rejouée `faitLe` 11h30). La visite d'audit est déplacée au lendemain (12). C'est la preuve que le bug était réel.
- **Montages de tests adaptés (6 échecs initiaux, horloges figées, aucune assertion métier affaiblie) :** les visites
  accumulées le même jour sont étalées d'un jour par visite — `serveur.test.ts` (« récompense » : 10/11/12, « le
  lendemain » devient le 13 ; CSV inchangé `;2;5;`), `programme.test.ts` (« niveaux » : 10 visites du 9 au 18,
  passage le 19 ; « profil progressif » : 2e visite le lendemain), `auth-client-p0-s7.test.ts` (2e visite +24 h,
  jeton valable 30 jours), `supabase.test.ts` (« parcours » : visites 9/10/11, `horloge` du describe en `let`,
  restaurée en `finally` ; le double-`visite` simultané reste [200, 409] « réessayez » via le verrou optimiste).
- **Revue Codex (2 points, `/tmp/p1-s12-revue-codex.md`) — tous deux fondés, corrigés :**
  1. [Majeur] `passageCeJour` (front) comparait les jours dans le fuseau du navigateur, la garde serveur à Paris
     (`server/index.ts` force `TZ=Europe/Paris`) — bouton désactivé à la mauvaise heure hors fuseau parisien.
     → nouveau comparateur partagé `memeJourParis()` (`src/lib/points.ts`, jours `Europe/Paris` explicites via
     `Intl`), utilisé par `passageCeJour` (front + `enregistrerPassage`) et par la garde serveur (`passageAvecProgramme`
     et `rattrapageRecevable` dans `programme.ts`, qui ne dépendent plus du TZ du processus) ; test ajouté.
  2. [Mineur] Liste Clients : bouton désactivé sans explication → même avertissement que la caisse et la fiche.
- **Tests : 1046 → 1048 (+2 : garde `visite` de bout en bout dans `cartiz.test.ts`, jours Paris dans le même
  fichier)**, suite verte, typechecks inclus dans `npm test`.

## 11/11/2026 — P1-B9 « Désinscription SMS utilisable » (AUDIT.md §7, revue Codex point 7 — BLOQUANT avant toute activation SMS)
- **Contexte :** chaque SMS de relance se terminait par `STOP : répondez STOP`, alors que l'expéditeur alphanumérique
  Brevo (`ASIANHOME`) ne reçoit aucune réponse — texte trompeur, aucun mécanisme de désinscription utilisable par SMS.
  La route de désinscription HMAC existait déjà (POST `/api/v1/desinscription/<client>/<jeton>`, retrait au clic depuis
  `#/desinscription/…`, idempotente, limitée par IP) : elle est réutilisée telle quelle, sans modification du jeton.
- **Mécanisme (lien, pas de réponse) :** `smsRelance()` prend désormais le lien de désinscription en 5e paramètre et se
  termine par `STOP : <lien>` (`mentionDesinscriptionSms()`, `src/lib/relances.ts`) — le mot STOP est conservé (mention
  légale des SMS marketing) mais ne promet plus de réponse. Lien court `GET /d/<client>/<jeton>` → 302 vers
  `/#/desinscription/<client>/<jeton>` (`server/app.ts`, à côté du `/c/` existant ; jeton non vérifié à la redirection,
  c'est la page qui appelle l'API après clic — même forme que `/c/`). Le serveur (`relancer()`) calcule le jeton une fois
  et le sert aux deux canaux : SMS (lien court `/d/…`) et e-mail (lien long + `List-Unsubscribe`, inchangés).
  `MENTION_STOP_SMS` supprimée (remplacée par `mentionDesinscriptionSms()` + `lienCourtDesinscription()`).
- **Textes corrigés au même endroit (même promesse trompeuse) :** page Désinscription (lien invalide : plus de
  « ou répondre STOP à un SMS »), `Messages.tsx` (écran commerçant), `MENTIONS_RGPD` (`integrations.ts`) et politique de
  confidentialité (`rgpd.ts`) — tous disent désormais « lien de désinscription dans chaque SMS et chaque e-mail ».
  Message 501 de `stop-sms` (Brevo) et commentaires `brevo.ts` mis à jour ; doc `docs/BREVO.md` (§1, §6),
  `server/README.md` (§ relances) et `README.md` (§ RGPD) alignés. Origine stockée `lien-email` conservée pour les
  retraits par lien (la route ne distingue pas SMS/e-mail, le jeton est le même) — dit ici, pas de nouvelle origine.
- **Coût (conséquence assumée, documentée) :** le lien allonge le SMS — la plupart des relances SMS font désormais
  **2 segments (2 SMS facturés)** au lieu d'1 ; alphabet GSM 7 bits conservé (jeton base64url : seuls `-` et `_`, tous
  deux GSM). Repli sans lien (appel direct de `smsRelance()` sans passer par le serveur) : « STOP : désinscription
  auprès du commerce » — honnête, jamais « répondez STOP ».
- **Tests : 1044 → 1046 (+2, `tests/relances-p1-b3.test.ts`)**, suite verte, typechecks inclus dans `npm test`.
  Nouveaux : redirection `/d/` (302, formats invalides → 404) ; SMS sans lien → repli honnête. Bout en bout (Brevo,
  prestataire simulé) : contenu SMS exact avec lien court, redirection `/d/` du jeton réel, POST désinscription → 200,
  consentement `false`, relance suivante → 409. **5 assertions existantes adaptées (changement de spec — le lot
  remplace le texte qu'elles épinglaient) :** `relances-p1-b3.test.ts` (SMS purs : 1 segment → ≤ 2 ; message libre ;
  corps Twilio et Brevo), `integrations-v3.test.ts:297` (corps SMS), `relances-ui-p1-b3.test.ts` (mention RGPD).
  Aucun autre test modifié ; aucune fonction existante supprimée.
- **Revue Codex (1 point, mineur, `/tmp/p1-b9-revue-codex.md`) :** le test « de bout en bout » n'ouvrait pas le lien
  réel ni ne comparait explicitement les jetons SMS/e-mail. **Traité en partie :** redirection `/d/` du jeton réel
  vérifiée dans le test (302 + Location exacte) ; le retrait au clic (pas à l'ouverture) est déjà couvert côté page
  (`relances-ui-p1-b3`, pas de `useEffect`, retrait sur `onClick`) ; l'égalité des jetons SMS/e-mail tient par
  construction (une seule fonction `jetonDesinscription()`, les deux branches vérifiées indépendamment contre la même
  route POST) — pas de parcours navigateur ajouté (le repo n'a pas de harnais de rendu pour cette page). Aucun défaut
  bloquant ou majeur ; HMAC inchangé, redirection interne filtrée, GSM conservé, aucun secret ni envoi réel.

## 11/11/2026 — P1-C7 « Écrans commerçant (finitions) » (AUDIT.md §7)
- **Contexte :** l'AUDIT listait pour P1-C7 : 8 `window.confirm()`, aide « encore X tampons »,
  bouton « Saisir le prénom » si caméra refusée, découpe Réglages, pagination Clients.
  Vérification faite au début du lot : l'aide tampons, le repli « Saisir le prénom » et la
  pagination Clients (« Charger plus » au-delà de 50) étaient **déjà livrés en P1-C6**
  (tests `ecrans-commercant-p1-c6.test.ts`) — rien à refaire, vérifiés en non-régression.
  Restait : **10 `window.confirm()` hors démo** (l'AUDIT en comptait 8 — 2 de plus trouvés :
  suppression de catégorie dans MenuCarte, déconnexion des appareils dans CartePublique) +
  la découpe Réglages (9 fieldsets, pas 8).
- **Remplacements (10, tous par `<Confirmation>`, modale `dialog` déjà utilisée à la caisse) :**
  FicheClient ×3 (échange de points — récapitulatif « echange » réutilisé ; consentement
  relances — nouveau type « consentement » ; refus de visite oubliée — nouveau type
  « rattrapage-refus »), Equipe (retrait d'un membre), Avis (déconnexion Google), Messages
  (dépôt du message ciblé), MenuCarte ×2 (remplacement du menu — la sauvegarde CSV part
  **avant** la modale, le remplacement n'a lieu que sur confirmation ou éditeur vide ;
  suppression de catégorie), CartePublique ×2 (demande de suppression RGPD, déconnexion de
  tous les appareils). Seul `window.confirm()` restant : la réinitialisation de la **démo**
  (Admin.tsx, 1 occurrence). `Caisse.tsx` : branche `else` restreinte aux 4 variantes
  caisse (les 2 nouveaux types sont réservés à la fiche client — exigé par `tsc`).
- **Réglages découpés en 6 onglets** (Commerce, Fidélité, Roulette, Messages, Carte, Données),
  **un seul formulaire, un seul bouton Enregistrer** : 9 fieldsets conservés, 26 champs
  (input/select/textarea) inchangés — 2 fieldsets déplacés pour des onglets thématiques
  contigus (« Points » après « Programme », « Réponses aux avis » après « Messages
  automatiques »). Onglets accessibles : `tablist`/`tab`/`tabpanel` + `aria-controls`,
  roving tabindex, flèches/Début/Fin ; validation native : un champ invalide dans un onglet
  masqué bascule sur son onglet puis est focalisé (`onInvalid`, revue Codex point 1).
- **Évolution rédactionnelle (revue Codex point 7, documentée) :** les récapitulatifs ne
  reprennent pas mot pour mot les anciens confirms — le prénom figure dans la ligne
  « Client » du récapitulatif (pas dans le titre), et le refus de rattrapage ajoute
  l'avertissement « classée sans crédit de tampon ni de points » (conséquence réelle,
  implicite avant). Aucun prix, probabilité ni texte légal touché.
- **Tests : 1032 → 1044 (+12, `tests/ecrans-commercant-p1-c7.test.ts`)**, suite verte,
  `npx tsc -p .` propre (typecheck serveur inclus dans `npm test`). Couverture :
  97,90 % / 91,49 % / 93,06 % ; `ecransCommercant.ts` 100 %. **2 tests existants adaptés
  (propriété conservée, mécanisme changé — le lot remplace l'implémentation qu'ils
  épinglaient) :** `menu-officiel.test.ts` (ordre CSV → modale → remplacement ; `return`
  critique et 3 occurrences d'`appliquerRemplacement` vérifiés) et
  `relances-ui-p1-b3.test.ts` (confirmation branchée sur `changerConsentement` dans le
  composant Relances, un seul `majClient`). Aucun autre test modifié.
- **Revue Codex (9 points, `/tmp/codex-revue-p1-c7.txt`, diff `/tmp/codex-p1-c7.diff`) —
  verdict initial « bloquant », tous traités :**
  1. [Fondé, bloquant] Validation native bloquée dans un onglet masqué (`lienGoogle`
     `type="url"`, `nom` required) → `onInvalid` : bascule sur l'onglet du champ puis
     focus ; test ajouté.
  2. [Fondé] Navigation clavier des onglets incomplète → roving tabindex + flèches /
     Début / Fin avec déplacement du focus ; test ajouté.
  3. [Fondé, partiellement] Tests par fragments ne prouvant pas « agit seulement après
     confirmation » → resserrement au plus près du mécanisme (Relances scopée au
     composant, `majClient` unique après lecture de la demande ; MenuCarte : `return` +
     comptage des appels) ; un test comportemental avec API espionnée demanderait un
     harnais de rendu que le repo n'a pas pour ces pages — non fait, dit ici.
  4. [Fondé] Test Menu affaibli → `return` critique + 3 occurrences
     d'`appliquerRemplacement` vérifiés (définition + éditeur vide + confirmation).
  5. [Fondé] Test Relances trop large → scopé au composant Relances, `majClient`
     unique et après lecture de la demande.
  6. [Fondé] Ordre/inventaire Réglages insuffisamment testés → légendes exactes par
     panneau + inventaire 26 champs vérifiés (26 avant comme après).
  7. [Remarque] Récapitulatifs reformulés → évolution documentée ci-dessus.
  8. [Fondé] Exception Admin trop large → exactement 1 occurrence, celle de la démo.
  9. [Fondé, aucune correction] Aucun défaut d'exécution dans les 10 remplacements ;
     correctif Caisse et imports validés.
- **Non vérifié :** rendu visuel des modales et des onglets sur téléphone réel (vérification
  par tests + `tsc` seulement) ; test comportemental avec API espionnée (voir point 3) ;
  découpe des onglets à valider avec le commerçant (AUDIT §7) ; rien touché en production.

## 11/11/2026 — P1-U1 « Mesure du parcours comptoir » (AUDIT.md §7)
- **Contexte :** re-mesure après refonte (noir+magenta, corps sombres), même protocole que
  P0-U0 : `scripts/mesurer-scores.mjs` (Pixel 7, Slow 4G + CPU ×4, serveur local),
  2 passes + Lighthouse 2 passes (`node_modules/.cache/mesure-p1-u1/`,
  `resultats-passe1.json`, `resultats-passe2.json`, `lighthouse-passe1.json`,
  `lighthouse-passe2.json`, 9 captures passe 2). **Aucun changement de code de
  production dans ce lot** — SCORES.md + 5 tests de cohérence seulement.
- **Résultats (2 passes) :** premier affichage `#/jouer` 4 241 / 4 043 ms (LCP 4 224 /
  4 016 ms, `p.titre-carte`) — seuil < 4 s toujours non atteint ; parcours scan → lot
  8 727 / 9 155 ms d'étapes (inscription 1 054 / 994, validation caisse 6 720 / 6 926,
  vérification 366 / 312, tirage 587 / 923 ms), taps identiques (client 4 clics +
  1 saisie, caisse 3 clics + 2 saisies) ; Lighthouse 79 (score identique sur les
  deux passes ; FCP 1,1 s, LCP 4,6 s, TBT 240 / 270 ms, CLS 0, SI 1,1 s, TTI 4,7 /
  4,8 s) — était 81 à P0-U0, 16 points sous le seuil ≥ 95 ; 0 erreur console,
  0 requête échouée (2 passes) ; bundle frais JS initial 472745 o + CSS 70664 o =
  543409 o (22 chunks, plus gros 349378 o) ; couverture 97,89 % / 91,48 % / 93,06 % ;
  DA moyenne **8,0/10 inchangée** (client 9/10 ×3, commerçant 7–8/10).
- **Critère < 30 s à chaud : étapes scriptées sous 30 s, vérifié** (8,7–9,2 s) ; le
  critère complet avec gestes et attente humains **n'est pas vérifié** (pas de
  téléphone réel sur cette VM — protocole téléphone documenté dans SCORES.md,
  § « Protocole téléphone réel », à exécuter sur staging). À froid Render (~60 s) :
  non mesuré (estimation). `npm audit` re-tenté : même 403 `policy_denied`, non
  mesurable sur cette VM.
- **Tests : 1027 → 1032 (+5, `tests/mesure-p1-u1.test.ts` — totaux du parcours et
  moyenne DA re-calculés depuis les tableaux du document, pas des constantes)**,
  suite verte, `npx tsc -p .` propre (typecheck serveur inclus dans `npm test`).
  Aucun test existant modifié.
- **Revue Codex (10 points, `/tmp/codex-revue-p1-u1.txt`, diff
  `/tmp/codex-p1-u1.diff`) — verdict « corrections mineures », toutes traitées :**
  1. [Fondé, aucune correction] Arithmétique exacte vérifiée (parcours, bundle, DA).
  2. [Fondé] « 2 passes identiques » → « score identique sur les deux passes »
     (les métriques TBT/TTI diffèrent).
  3. [Fondé] Seuil « vérifié » avec gestes humains inclus → reformulé : étapes
     scriptées sous 30 s, vérifié ; critère complet non vérifié (test adapté).
  4. [Fondé] Écart bundle (+641 o CSS) attribué aux hashes sans preuve → « cause
     non établie » (lots P0-S11/P1-M2/P1-M3 entre les deux mesures, non isolés) +
     build documenté distinct de celui servi aux passes Playwright.
  5. [Fondé] « Aucun écart significatif » sans statistique → « échantillon
     insuffisant pour conclure » ; « ±5 » → écart observé de 5 points entre les
     deux passes P0-U0 ; tirage 587 → 923 ms noté comme variabilité.
  6. [Fondé] Test additionnant des constantes → totaux et moyenne DA désormais
     extraits des tableaux de SCORES.md et re-calculés.
  7. [Fondé, aucune correction] Test P0-U0 reste cohérent (premières occurrences).
  8. [Fondé] Colonne « Mesure initiale » mélangeant P0-U0/P0-D1/P1-D2 → renommée
     « Référence antérieure (lot précisé par métrique) », lot annoté par cellule.
  9. [Fondé] Protocole téléphone contradictoire (à chaud sur « autre téléphone »
     au cache non réchauffé) → même téléphone, même navigateur, 2e compte de test ;
     « pas de navigateur pilotable » → navigateur simulé Playwright.
  10. [Fondé] Règle de fusion (amélioration exigée) incompatible avec un lot de
      mesure → note ajoutée : ce lot documente une re-mesure.
- **Non vérifié :** téléphone réel (375 px, 4G, à chaud et à froid) ; délai à froid
  Render ; `npm audit` ; rien touché en production.

## 11/11/2026 — P1-M3 « Photos des plats » — PRÉPARATION SEULEMENT (AUDIT.md §7)
- **Contexte :** le lot complet est impossible sans les photos du restaurant — aucune photo
  fournie (`assets/source/photos/` ne contient que son `README.md`), jamais de photos clients
  Google. Ce lot vérifie et consolide l'existant et produit l'inventaire exact à fournir au
  commerçant : `docs/PHOTOS-MANQUANTES.md`.
- **Inventaire vérifié (script + tests) :** 81 plats — **11 avec photo vérifiée, 70 sans photo**.
  Avec photo : 9 WebP du PDF officiel (légendées par le restaurant) + Loc Lac + Mango Stick.
  Fiches des plats : 372 739 o au total, chacune ≤ 250 Ko ; vignettes : 47 070 o.
  Sans photo : liste exacte des 70 noms par catégorie dans `docs/PHOTOS-MANQUANTES.md`, avec les
  raisons connues (Love Bao : légende PDF douteuse ; Tiramisu : deux bocaux ; 6 Maki Gold : aucune
  photo ; boissons : non attribuables ; variantes makis/california/sashimi/sushi : 36 plats,
  icônes minuscules) et le mode de dépôt (`assets/source/photos/`, `plat-<nom>.jpg`).
- **Correction — photo détachée :** `menu-makis.jpg` (partagée entre 8 Maki Tiger et 8 Maki
  Chicken Dragon, contribution client sur lacarte.menu, impossible de dire quel plat elle montre)
  a été **détachée des deux plats** (`src/data/menu-reel.ts`) : 13 → 11 plats photographiés,
  68 → 70 sans photo. Le fichier est gardé, non rattaché, en attendant 2 photos distinctes du
  commerçant (ou sa confirmation du plat montré). Les 2 autres fichiers non rattachés
  (`menu-nouilles-crevettes.jpg`, `menu-plat-riz.jpg`) restent tels quels, documentés.
  `public/visuels/SOURCES.md` et `docs/MENU-OFFICIEL-2026-11-10.md` mis à jour.
- **Tests : 1018 → 1027 (+9, `tests/photos-manquantes-p1-m3.test.ts` + correctifs revue)**,
  suite verte, `npx tsc -p .` propre (typecheck serveur inclus dans `npm test`). Couverture :
  comptes 11/70/81 + listes exactes, chaque photo existe et pèse ≤ 250 Ko, total fiches ≤ 400 Ko,
  aucune photo partagée entre plats, les 3 fichiers non rattachés le restent, aucune image en
  attente dans `assets/source/photos/`, doc cohérente avec le code (noms, comptes, poids).
- **Revue Codex (3 points, `/tmp/codex-revue-p1-m3.txt`) — tous traités :**
  1. [Fondé] Le détachement ne couvrait que la carte de repli ; un menu enregistré avant le lot
     avec `menu-makis.jpg` l'affichait encore → `retirerPhotosDetachees()` appliqué dans `#/menu`
     à tout menu affiché (même pattern que le masque des prix P1-M1) ; testé.
  2. [Fondé] « Variantes makis / california / sashimi / sushi (28 plats) » faux : 36 plats
     (7+6+6+4+5+4+4) → corrigé dans le doc (le total 70 restait exact).
  3. [Fondé] « Les 2 spécialités sans photo » : en réalité 3 (avec 6 Maki Gold) → priorité
     reformulée dans le doc.
- **Attent le commerçant :** les photos des 70 plats (liste exacte dans `docs/PHOTOS-MANQUANTES.md`),
  en priorité les 3 spécialités sans photo, Love Bao, puis entrées et variantes ; confirmations
  du plat montré par `menu-nouilles-crevettes.jpg` et `menu-makis.jpg`.
- **Non vérifié :** rendu visuel réel des photos sur téléphone (vérification par en-têtes/tailles
  seulement) ; rien touché en production.

## 11/11/2026 — P1-M2 « Allergènes » (AUDIT.md §7)
- **Contexte :** le commerçant n'a fourni AUCUN allergène (0/81 renseigné) : rien n'est inventé.
  Chaque fiche de plat dépliée affiche désormais la mention explicite « Allergènes : demander en
  caisse » tant que la liste est vide ; dès qu'une liste est renseignée, c'est elle qui s'affiche.
  Le pied de page général (« demandez conseil à l'équipe en cas de doute ») reste affiché.
- **Code :** `src/lib/menu.ts` — `LIBELLE_ALLERGENES_ABSENTS` + `libelleAllergenes()` (liste ou
  mention) ; `src/pages/MenuPublic.tsx` — ligne allergènes toujours affichée dans la fiche dépliée
  (préfixe traduit séparément, mention traduite) ; `src/lib/langue.ts` — traduction EN de la mention.
  Saisie commerçant inchangée (elle existait) : cases à cocher des 14 allergènes UE par plat dans
  `#/menuCarte`, colonne `allergenes` (séparés par `|`) à l'import/export CSV.
- **Comptes vérifiés :** **81/81 plats avec allergènes renseignés ou mention explicite**
  (0 liste renseignée, 81 mentions explicites). Aucun allergène inventé.
- **Tests : 1008 → 1018 (+10, `tests/allergenes-p1-m2.test.ts`)**, suite verte, `npx tsc -p .`
  propre (typecheck serveur inclus dans `npm test`). Couverture : 81/81, libellé, traduction EN,
  validation (allergène inconnu refusé), aller-retour CSV avec liste et sans, source `#/menu` et
  `#/menuCarte`, et aller-retour serveur PUT → GET public des allergènes (`tests/cartiz.test.ts`,
  ordre normalisé selon `ALLERGENES`).
- **Revue Codex (2 points, `/tmp/codex-revue-p1-m2.txt`) — tous traités :**
  1. [Fondé] `t(libelleAllergenes(p))` faisait retomber le préfixe en français en anglais quand la
     liste était renseignée (chaîne complète absente du dictionnaire) → forme conditionnelle :
     `t('Allergènes :')` + liste, sinon `t(LIBELLE_ALLERGENES_ABSENTS)` ; testé (préfixe EN).
  2. [Remarque fondée] Le test des cases à cocher n'était que du source → ajout d'une assertion
     serveur (PUT menu avec allergènes → GET public les relit) ; le clic de case lui-même reste
     vérifié par source (pas de moteur de rendu React dans le repo — même pattern que les tests
     photos). L'échec de `menu-client-p1-c5` signalé par Codex « sans diagnostic » ne se reproduit
     pas (110/110 ciblés, 1018/1018 complets).
- **Attent le commerçant :** les allergènes des 81 plats (à saisir dans `#/menuCarte` ou par CSV).
- **Non vérifié :** rendu visuel réel sur téléphone ; rien touché en production.

## 11/11/2026 — P1-M1 « Prix à vérifier + hors carte » (AUDIT.md §7)
- **Contexte :** le commerçant n'a confirmé ni Riz Thaï 8,90 € ni 6 Maki Gold 100,00 € (valeurs
  imprimées sur la carte, §8 n° 5). Les deux prix sont donc **masqués** (`prix: null`, « Prix sur
  place ») au lieu d'être affichés ; les 3 plats hors carte restent sans prix, sans fusion décidée
  seule (Thaï-sty Krusty / Crousti Poulet, Bœuf Basilic, Boisson 33cl = décisions commerçant).
- **Code :** `src/data/menu-reel.ts` — Riz Thaï et 6 Maki Gold à `null` ; nouvelle constante
  `PRIX_A_CONFIRMER` (valeurs imprimées + motif, référence uniquement, jamais affichée dans le menu
  public) ; nouveaux helpers `estPrixNonConfirme()` et `masquerPrixNonConfirmes(menu)`.
  `src/pages/MenuPublic.tsx` applique le masque au menu affiché, repli comme menu enregistré.
  `src/pages/MenuCarte.tsx` : texte commerçant précisé (valeurs imprimées visibles côté commerçant
  uniquement, pour confirmation/correction ; si le prix confirmé est exactement la valeur imprimée,
  prévenir l'équipe — elle reste masquée tant que `PRIX_A_CONFIRMER` n'est pas mise à jour).
  `docs/MENU-OFFICIEL-2026-11-10.md` mis à jour (76 prix affichés, 5 sans prix).
- **Comptes vérifiés :** 81 plats, **76 prix affichés, 5 sans prix** (Riz Thaï, 6 Maki Gold,
  Thaï-sty Krusty, Bœuf Basilic, Boisson 33cl), somme des prix affichés **597,40 €**
  (706,30 € imprimés − 8,90 € − 100,00 €). Aucun autre plat/prix touché.
- **Tests : 1006 → 1008 (+2, `tests/menu-reel.test.ts` : masque sur menu enregistré ancien,
  application du masque dans `#/menu`)**, suite verte, `npx tsc -p .` propre (typecheck serveur
  inclus dans `npm test`). Tests existants mis à jour vers le nouvel état attendu (CARTE, total,
  5 sans prix, `tests/cartiz.test.ts` : aller-retour serveur du menu officiel) — aucun test affaibli.
- **Revue Codex (3 points, `/tmp/codex-revue-p1-m1.txt`) — tous traités :**
  1. [Artefact, ignoré] « Diff vide » : la revue a tourné avant le commit, sur des modifications
     non commitées — résolu par le commit lui-même.
  2. [Fondé] Menu enregistré avant le lot avec les anciens montants restait affiché → correctif :
     `masquerPrixNonConfirmes()` appliqué dans `#/menu` à tout menu affiché (repli ou enregistré) ;
     un prix corrigé (ex. 10,00 €) n'est pas masqué ; testé.
  3. [Fondé] « Jamais affichées dans l'app » factuellement faux (valeurs visibles dans
     `#/menuCarte`, protégée par PIN) → libellés corrigés en « jamais affichées dans le menu public ».
- **Attent le commerçant :** confirmer Riz Thaï (8,90 € imprimés ?) et 6 Maki Gold (100,00 € imprimés,
  probable coquille pour 10,00 € ?) ; trancher les 3 plats hors carte (fusion Thaï-sty Krusty /
  Crousti Poulet ? Bœuf Basilic toujours servi ? Boisson 33cl à remplacer par Soda / Evian ?).
- **Non vérifié :** menu enregistré en production (non lisible depuis ici ; l'audit du 10/11 le
  disait vide — le masque d'affichage couvre le cas où il ne le serait plus) ; rien touché en production.

## 09/11/2026 — Programme de fidélité (benchmark concurrents, 11 nouveautés)
- Benchmark lu avant de coder : `~/workspace/benchmark-fidelite-restaurant-2026-11-09.md`,
  `~/workspace/benchmark-fidelite-restaurant/benchmark-fidelite-chaines-2026-11-09.md`,
  `~/workspace/benchmark-cx-fidelite-restaurant-asian-home.md`.
- Nouvelle logique pure `src/lib/programme.ts` (défauts + règles), état en JSONB existant
  (`commerces.donnees.programme`, `clients.donnees`) : aucune nouvelle colonne. Toutes les
  règles métier sont décidées côté serveur (`server/app.ts`), jamais seulement côté front.
- **1. Paliers bas** : défaut 3 visites (« Boisson, nems ou dessert offert ») et 6 visites
  (« Accompagnement offert ») en plus du seuil 10 existant ; configurables (max 5) ; progression
  « plus que N visite(s) » sur la carte client ; récompense en attente à remettre au comptoir
  (action caisse `attente`).
- **2. Parrainage bilatéral** : code `AH-XXXXXX` par client (lien/QR partageable, bouton copier),
  50 points chacun à la 1re visite du filleul (configurable), un seul parrain par filleul, un
  seul gain par nouveau client, plafond 12/an (configurable) ; tracé dans le journal (`parrainage`)
  et la table d'audit `parrainages` (migration 0004).
- **3. Points de bienvenue** : 50 points à l'inscription (défaut, configurable), affichés dès la
  création de la carte. Les tests existants ont été recalés (passage 23 → 73 points, etc.).
- **4. Défis courts** : un seul actif à la fois, défaut « 3 visites en 14 jours = Plat offert »,
  progression visible, récompense automatique, historique des défis réussis.
- **5. Niveaux (2 max)** : Habitué à 10 visites (points ×1,5, anniversaire +7 jours), VIP à 25
  visites (points ×2, plat signature à l'anniversaire, avant-première plat du mois) ; seuils et
  multiplicateurs configurables ; multiplicateurs appliqués côté serveur ; VIP affiché comme rare.
- **6. Win-back recalibré** : remplace « inactif 30 j » par 45 j (rappel doux, sans remise),
  60 j (produit offert), 90 j (dernière chance), puis ARRÊT (sunset, rien après 120 j) ; la
  séquence s'arrête au retour du client ; délais et offre configurables ; messages dans la boîte
  de réception in-app + texte à copier (SMS/e-mail toujours 501, rien envoyé).
- **7. Anniversaire amélioré** : valable 14 jours par défaut (configurable 7–30), envoi à J-7 +
  jour J, dessert offert (plat signature pour les VIP, valable 30 jours), demi-anniversaire
  (boisson offerte), anniversaire d'adhésion (1 an) ; date de naissance collectée APRÈS la 2e
  visite seulement (profil progressif, 1 question à la fois), jamais à l'inscription.
- **8. Offre hebdomadaire** : 1 offre membres sur 1 jour fixe, défaut mardi « Boisson offerte
  dès 15 € » ; affichée sur la carte client et dans les messages.
- **9. Rattrapage visite oubliée** : le client signale (date + montant/ticket) depuis sa carte,
  le commerçant valide ou refuse depuis la fiche client (PIN) ; validation = 1 visite + points,
  journalisé ; recevable 30 jours, pas de doublon le même jour ; la dernière visite ne régresse
  pas sur une visite antidatée.
- **10. Inscription simplifiée** : téléphone seul obligatoire, prénom optionnel, aucun mot de
  passe ; normalisation des numéros français et déduplication (`cleContact`) inchangées.
- **11. Plat en réserve** : après une commande ≥ 25 € (configurable), plat offert « en réserve »
  valable 30 jours, 1 par trimestre maximum ; activable/désactivable ; remise au comptoir
  (action caisse `reserve`).
- Réglages : nouveau fieldset « Programme de fidélité » (chaque bloc activable/désactivable et
  configurable) ; un commerce sans configuration voit les défauts s'appliquer sans rien casser.
  Tableau de bord : section programme (parrainages réussis, VIP, rattrapages en attente, défis).
- **Migration 0004** (`supabase/migrations/0004_programme.sql`, rejouable, testée via PGlite) :
  2 tables d'audit seulement (`parrainages`, `demandes_rattrapage`, RLS, sans policy,
  `service_role` seul, cascade à la suppression du commerce, check `parrain_id <> filleul_id`).
  **À APPLIQUER EN PRODUCTION** (SQL Editor Supabase, comme la 0003) : tant qu'elle n'est pas
  appliquée, le serveur fonctionne mais ignore les traces d'audit (`/sante` → `migrations.programme`).
- **Écarts volontaires du benchmark (documentés)** : aucune récompense de points contre un avis
  Google (Google interdit les avis incités) — la demande d'avis reste sans récompense ; pas de
  géolocalisation/push de proximité, pas de commande en ligne avec paiement, pas d'abonnement
  payant, pas de 3e niveau, pas d'expiration des points à 6 mois (12 mois d'inactivité gardés).
- **Limites connues** : mode local (démo) : le passage local n'applique pas le programme
  (paliers/défi/réserve non appliqués en démo, serveur seul) ; rattrapage décidable seulement
  depuis la fiche client (PIN gérant), pas depuis la caisse (code équipe) ; rendu 390 px réel
  sur téléphone jamais vérifié.
- Tests : `tests/programme.test.ts` (logique pure + serveur HTTP : parrainage anti-abus,
  paliers, défi, niveaux, win-back, anniversaire, réserve, rattrapage, profil, réglages) ;
  test PGlite 0004 ; faux PostgREST : tables 0004 + option `sans0004` ; tests existants recalés
  (points de bienvenue, win-back 45 j, `defi`/`depenseCentimes` dans le `deepEqual` parcours).
  **npm test : 215/215. npm run build et build:api : OK.**

## 09/11/2026 ~02h54 — Lancement
- Brief reçu (~/workspace/fideliz-claude/BRIEF.md). Principe utilisateur : le plus
  simple possible pour scaler sur TOUS les commerces, onboarding ~2 min.
- Coordinateur : phases 1-2-3 avec Claude Code CLI (~/.local/bin/claude, v2.1.309),
  mode non-interactif, commits locaux, rien publié.
- PLAN.md créé.

## 09/11/2026 — Phase 1 terminée (squelette + socle)
- Le build échouait : `App.tsx` importait `pages/Offre`, `pages/Admin`, `pages/Plus` inexistantes. Créées :
  - **Offre** : 90 € TTC/mois, engagement 12 mois, mise en place 500 € TTC (2 500 flyers,
    étiquettes de table QR, adhésif vitrine 100 × 70 cm), fonctionnalités incluses,
    total 1re année (1 580 € TTC), mention « Démo — aucune souscription réelle ».
  - **Admin** : liste des commerces (logo, nom, type, statut actif/inactif, nb clients, nb avis),
    bouton « Afficher » (bascule du commerce actif), Activer/Désactiver, ajout en 1 formulaire
    court (nom + type + lien Google optionnel ; le reste via `nouveauCommerce()` : 10 tampons,
    4 lots génériques, auto-réponse 5★ + brouillons), bouton « Réinitialiser la démo » (avec
    confirmation, restaure le seed recalé).
  - **Plus** : carte « QR code vitrine » du commerce actif, liens Réglages / Offre / Admin,
    bloc « À propos de cette démo » listant ce qui est simulé.
- Choix tranchés :
  - Après création d'un commerce → il devient le commerce affiché et on ouvre Réglages
    (pour finir l'onboarding de ~2 min).
  - QR vitrine : pas de génération dans cette phase (aucune lib QR installée) ; la carte
    l'annonce honnêtement et renvoie vers la Roulette. La génération arrive en phase 2.
  - Lien Google optionnel à la création (on peut l'ajouter plus tard dans Réglages).
- Navigation vérifiée : les 8 pages du type `Page` (router.ts) ont un composant dans
  `COMPOSANTS` ; desktop = 7 onglets, mobile = 5 (Accueil, Clients, Roulette, Avis, Plus),
  Réglages/Offre/Admin accessibles via Plus.
- `npm run build` : OK (tsc + vite, JS 273 kB / 82 kB gzip). `npm run preview` + curl → HTTP 200.
- Commit local « Phase 1 : squelette + socle Fideliz ». Rien poussé.

### Reste pour la phase 2
- Carte fidélité : inscription client 10 s, QR personnel, bouton Wallet simulé, « Valider une
  visite » (tampon), progression/récompense, relance inactifs 30 j avec message à copier.
- Roulette : QR unique par commerce (affichable/imprimable, à brancher aussi sur la carte
  « QR vitrine » de Plus), page publique client, roue animée, 1 tirage/client/jour,
  invitation avis Google non conditionnée.
- Avis : modèles de réponse (5★, 4★, négatif, sans texte), application des règles auto.
- Phase 3 : tests de base, README, preuves de fonctionnement.

## 09/11/2026 — Phase 2 terminée (fidélité + roulette + avis)
### Ajouté
- Dépendance : `qrcode-generator` (MIT, 0 dépendance, génération locale en SVG, aucun appel réseau).
- Logique pure (sans React, testable en phase 3) : `src/lib/fidelite.ts`, `src/lib/roulette.ts`, `src/lib/avis.ts`.
- Routes hash avec paramètre : `#/client/<id>` (fiche commerçant), `#/carte/<id>` (carte publique du client),
  `#/qr` (QR vitrine), `#/jouer/<commerceId>` (roulette publique). Les pages publiques s'affichent sans
  en-tête ni navigation commerçant.
- **Fidélité** : bouton « + Inscrire un client » (prénom + téléphone OU e-mail), fiche client (carte avec
  QR personnel, tampons x/y, barre + pastilles, objectif, dernière visite), « Valider une visite » dans la
  liste et la fiche, « Offrir la récompense » quand le seuil est atteint, historique (visites, récompenses,
  gains roulette), bouton Wallet simulé, onglet « À relancer » avec message prêt à copier.
- **Roulette** : QR unique par commerce (page Roulette + page `#/qr` grand format imprimable, aussi
  depuis Plus), page publique avec roue SVG animée, tirage pondéré, 1 tirage/client/jour, invitation avis
  Google après le jeu avec la mention « Le lot n'est pas conditionné à l'avis… », historique complet
  dépliable dans le Tableau de bord.
- **Avis** : statut (sans réponse / brouillon / répondu + badge « auto »), 4 modèles en 1 tap, texte
  éditable, « Garder en brouillon », « Marquer comme répondu », « Simuler un nouvel avis », badge
  « Démo — avis simulés, aucune connexion à Google ».

### Décisions tranchées
- Lots : `string[]` → `{ libelle, probabilite }[]`. Si le total ≠ 100 %, chances recalculées au prorata
  (affiché dans Réglages). Les secteurs de la roue sont proportionnels aux chances (pas de roue « truquée »
  visuellement). Les anciennes données localStorage sont migrées (chances égales). Seed régénéré : seuls
  les lots changent.
- Inscription = 0 tampon, aucune visite ; la date d'inscription sert de « dernier passage » pour les relances.
  Contact déjà connu dans ce commerce → on retrouve le client existant (pas de doublon).
- Carte pleine : une nouvelle visite est enregistrée mais les tampons restent plafonnés au seuil jusqu'à
  « Offrir la récompense » (remise à zéro + trace de la récompense).
- QR personnel : encode l'URL de la carte publique `#/carte/<clientId>`.
- « Choisir son profil » sur la page publique : pas de liste des clients (vie privée). Le client est
  reconnu par son téléphone/e-mail, et le téléphone mémorise le dernier profil (« Continuer en tant que… »).
- Tirage enregistré dès le lancement de la roue (recharger pendant l'animation ne permet pas de rejouer).
  « Aujourd'hui » = jour calendaire local.
- Lots perdants (« Pas de chance… ») détectés par mots-clés pour afficher « Pas cette fois ».
- Règles d'avis : appliquées à chaque nouvel avis, et à l'enregistrement des Réglages aux avis encore sans
  réponse (« appliquée aussitôt »). Le seed n'est pas modifié au chargement : les 5★ sans réponse
  représentent l'historique d'avant Fideliz ; un bouton « Appliquer les règles à N avis en attente » est
  proposé sur la page Avis. L'interrupteur 4★ de la phase 1 est conservé.
- Commerce désactivé : pages publiques (jeu et carte) bloquées avec un message.

### Vérifications
- `npm run build` : OK (tsc + vite, JS 329 kB / 99 kB gzip). `npm run preview` + curl → HTTP 200.
- Script node ponctuel (hors dépôt) sur la logique pure : contact, dédoublonnage, tampons plafonnés,
  récompense, message de relance, tirage pondéré, roue qui s'arrête dans le bon secteur, 1 tirage/jour,
  réponse auto 5★ et brouillon → tout OK. À transformer en vrais tests `npm test` en phase 3.
- Non vérifié : rendu dans un vrai navigateur (aucun navigateur accessible depuis cette session).

### Limites honnêtes
- Tout est dans le localStorage d'UN navigateur : un QR scanné depuis un autre téléphone voit sa propre
  copie du seed (un commerce créé dans la démo y est « inconnu ») et ses tirages ne remontent pas chez le
  commerçant. Il faudra un backend. Pour la démo, tester sur le même appareil.
- Wallet, avis Google, réponses publiées, envois de relance : simulés / manuels (copier-coller).

## 09/11/2026 — Phase 3 terminée (finition, tests, README, vérification)
### Décision principale : application du BRIEF mis à jour
Le BRIEF avait été modifié pendant la phase 2 (marque Asian Home Paris, version GRATUITE, pas de marque
Fideliz dans le produit) mais l'app affichait encore « Fideliz » et 90 €/mois + 500 €. Corrigé :
- Nom du produit : **Asian Home Fidélité** (constante `NOM_APP`, `src/data/defaults.ts`) dans l'en-tête,
  le titre de la page, l'offre, Plus et le QR vitrine. Plus aucune occurrence de « Fideliz », « 90 € »
  ou « 500 € » dans `src/`, `dist/` ni `index.html` (vérifié par grep). Le nom du dossier et du dépôt
  reste `fideliz-claude` (interne, pas visible).
- Couleurs : orange → rouge laque sobre (#b3262d, contraste blanc ≈ 6,8:1), aussi dans la roue.
- Offre : « Gratuit, sans engagement, sans frais de mise en place » + kit de lancement (2 500 flyers,
  étiquettes QR, adhésif 100 × 70) sans prix, en précisant que l'impression n'est pas incluse.
- Seed : « Le Bistrot des Halles » remplacé par **Asian Home Paris** (commerce affiché par défaut) avec
  ses vraies coordonnées publiques du BRIEF, des lots adaptés (nems, thé glacé, mochi, -10 %) et des visites
  pendant ses services (midi/soir). Clients, avis et tirages restent FICTIFS, et c'est écrit dans l'UI
  (Plus) et le README. Salon et boutique fictifs conservés.
- Nouveau champ optionnel générique `coordonnees` (texte libre, dans Réglages) affiché sur la page de jeu,
  la carte client et le QR vitrine. Aucune logique propre à un secteur.
- Lien Google d'Asian Home : lien public de recherche Google Maps (je ne connais pas le vrai lien
  « laisser un avis » ; il s'obtient depuis la fiche Google Business Profile).
- Clé localStorage `fideliz:etat:v1` → `fidelite:etat:v2` : un téléphone qui avait l'ancienne démo charge
  le nouveau seed (les anciennes données de démo ne sont pas reprises : choix assumé).

### Cohérence des données (seed régénéré, `npm run seed`)
- Avant : `tampons = visites % seuil` sans trace de récompense (ex. 16 visites, seuil 8 → 0 tampon et
  aucune récompense), des dates « aujourd'hui » pouvaient être dans le futur, et les tirages tombaient
  sur des jours sans visite.
- Maintenant : mêmes règles que l'app (récompense offerte à la visite qui suit la carte pleine, trace dans
  `recompensesOffertes`), tampons toujours dans [1, seuil], 1 client par commerce avec carte pleine
  (récompense à offrir), dates jamais dans le futur, tirages quelques minutes après une vraie visite du
  client (≤ 25 j), 1 par client et par jour, lot tiré selon les probabilités.
- Bug corrigé dans `depot.ts` : les dates de `recompensesOffertes` n'étaient pas recalées au chargement.
- Reset démo : `depotLocal.reinitialiser()` restaure le seed recalé — couvert par un test.

### Relecture mobile-first (dans le code, pas à l'écran)
- Aucun navigateur disponible dans cette session (pas de chromium/firefox) : relecture du code de chaque
  écran à 320-375 px de large. Corrigé :
  - Barre du bas + zone de sécurité de l'iPhone : le contenu (`pb-24`) et le bouton « Enregistrer »
    collant de Réglages (`bottom-20`) pouvaient passer sous la barre → marges calculées avec
    `env(safe-area-inset-bottom)`.
  - Réglages, lignes de lots : sur téléphone, champ du lot réduit à ~95 px → libellé sur toute la largeur,
    chance + suppression en dessous.
  - Long e-mail ou URL saisi par l'utilisateur : `overflow-wrap: anywhere` sur `body` pour éviter tout
    débordement horizontal.
  - Cibles tactiles < 44 px : liens « Tout voir », « Modifier », « modifier » (Avis) et bouton « Gérer »
    (bandeau commerce désactivé) passés à 44 px min.
  - Déjà conformes : boutons `.bouton` 48 px, onglets du bas 64 px, puces de filtre 44 px, champs 48 px,
    police de base 17 px.
- Reste non vérifié visuellement : rendu réel sur un vrai téléphone.

### Tests
- `npm test` = `node --test "tests/*.test.ts"` (Node 24 exécute le TypeScript, pas de Vitest ajouté :
  aucune nouvelle dépendance, build intact). 19 tests : création commerce, inscription client, +1 tampon /
  progression / récompense, roulette (pondération, secteur, 1 tirage/jour), réponses aux avis, cohérence du
  seed, reset démo. Interface React non testée.
- `depot.ts` importe désormais le JSON avec `with { type: 'json' }` (compris par Vite, tsc et Node).

### Vérification finale (09/11/2026)
- `npm install` : OK. `npm run build` : OK (tsc + vite, JS 330 kB / 99 kB gzip, CSS 32 kB).
- `npm test` : 19/19 OK.
- `npm run preview` (port 4173) + curl : `/` → HTTP 200 `text/html`, HTML de base servi (titre
  « Asian Home Fidélité… », `<div id="root">`, script du bundle) ; `/assets/index-*.js` → HTTP 200
  `text/javascript` (330 kB). Serveur arrêté ensuite.
- Rien publié, rien poussé, aucune clé, aucun envoi, aucune dépense.

## 09/11/2026 — Vérification coordinateur (fin de mission)
- Re-vérifié moi-même après la phase 3 : `npm install` OK, `npm test` 19/19 OK,
  `npm run build` OK (tsc + vite, JS 330 kB / 99 kB gzip), `npm run preview` + curl → HTTP 200.
- `git log` : 3 commits (phases 1-2-3), aucun remote → rien poussé, rien publié.
- BRIEF mis à jour par le parent pendant la phase 2 (clarification utilisateur
  ~03h10-03h13) : pas de marque Fideliz, version GRATUITE, brandée Asian Home Paris.
  L'app livrée suit ce BRIEF mis à jour.
- Non vérifié : rendu réel dans un navigateur / sur téléphone (aucun navigateur
  dans cette session ; relecture mobile dans le code seulement). Aucune capture d'écran.
- Point ouvert pour le test téléphone de l'utilisateur : `dist/` est prêt à héberger
  en statique, mais aucun hébergement n'a été fait.

## 09/11/2026 — Phase FIX-A : majeurs 1 et 2 de l'audit Codex
- **MAJEUR 1 (tampons perdus sur carte pleine) — corrigé.** `validerVisite` ne plafonne plus
  `tampons` (= visites depuis la dernière récompense) ; `tamponsAffiches` plafonne toujours l'affichage.
  `offrirRecompense` retire `seuil` tampons au lieu de remettre à 0 : l'excédent passe sur la nouvelle
  carte (encore débloquée s'il reste ≥ seuil). Message caisse adapté (« N tampon(s) reporté(s) sur la
  nouvelle carte »). Invariant : `tampons = visites − seuil × récompenses offertes`.
  Seed : déjà conforme (récompense remise à la visite suivant la carte pleine) ; `npm run seed` régénère
  un fichier identique. Seuls les commentaires du générateur / du test seed ont changé.
- **MAJEUR 2 (doublon par préfixe international) — corrigé.** `cleContact` ramène tout numéro français
  à `0XXXXXXXXX` : `06…`, `+33 6…`, `0033 6…`, `+33 (0)6…`, avec espaces / points / tirets / parenthèses.
  Numéros étrangers : chiffres conservés. E-mail inchangé. La déduplication de `inscrireClient`
  (`store.tsx`) passe déjà par `trouverClientParContact` → corrigée par le même changement.
  Grep `telephone` dans `src/` : aucune autre comparaison d'identité ; seule la recherche texte de
  `Clients.tsx` compare la saisie brute (filtre d'affichage, pas de dédup — laissée en l'état).
- Fichiers : `src/lib/fidelite.ts`, `src/pages/FicheClient.tsx`, `src/types.ts` (commentaire),
  `tests/logique.test.ts`, `tests/seed.test.ts` (commentaire), `scripts/generer-seed.mjs` (commentaire), `README.md`.
- Tests : test « carte pleine » réécrit (tampons 4, affichés 2) ; ajoutés « 11 visites, seuil 10 »,
  « 21 visites, seuil 10 », « tous les formats français… même client », « réinscription avec un autre
  format → pas de doublon ». `npm test` : 23/23 OK (avant : 19). `npm run build` : OK.
- Hors périmètre, toujours ouverts : MAJEUR 3 (roulette sans visite) et les mineurs (phases FIX-B/C).

## 09/11/2026 — Phase FIX-B : majeur 3 et mineur 1 de l'audit Codex
- **MAJEUR 3 (roulette jouable sans visite) — corrigé.** Nouvelles fonctions pures dans `src/lib/roulette.ts` :
  `aVisiteDuJour`, `statutJeu` (`'pret' | 'sansVisite' | 'dejaJoue'`) et `peutJouer`. `Jouer.tsx` les utilise
  à l'affichage ET dans `tourner()` : sans visite validée le jour même (jour calendaire local) dans ce
  commerce, pas de bouton « Tourner la roue », message « Pour jouer, validez d'abord votre visite du jour au
  comptoir. » + lien vers la carte. La page de jeu ne crée jamais de visite. Sous-titre de la page Roulette
  commerçant mis à jour. `store.tsx` écoute l'événement `storage` : une visite validée dans l'onglet commerçant
  débloque la roue ouverte dans un autre onglet du même navigateur.
  Seed : inchangé ; `tests/seed.test.ts` vérifiait déjà que chaque tirage tombe un jour de visite (vert).
- **MINEUR 1 (« Clients actifs » trompeur) — corrigé.** `Client.derniereVisite: string | null` (null tant
  qu'aucune visite) ; `nouveauClient` met null. `estActif` = visite il y a ≤ 30 j (en millisecondes, plus
  d'arrondi au jour : 30 j + 23 h n'est plus actif) ; nouveau `estARelancer` = au moins une visite et plus
  d'actif. Usages traités : `stats.ts`, `Clients.tsx` (filtres, compteurs, tri sans `localeCompare` sur null,
  badge « inactif », libellés), `CarteFidelite.tsx`, `depot.ts` (`seedRecale` + `migrer` qui recalcule
  `derniereVisite = dernière visite ou null` pour les données déjà stockées). Le libellé du tableau de bord
  « venus ces 30 derniers jours » correspond désormais au calcul.
- Tests ajoutés (10) : sans visite / visite aujourd'hui / visite hier / déjà joué (même avec 2e visite) /
  visite dans un autre commerce / vérification sans création de visite ; nouveau client ni actif ni à relancer
  (même inscrit il y a 90 j) ; après 1 visite → actif ; 30 j pile actif, 30 j + 1 h et 31 j → à relancer ;
  migration des anciennes données. `npm test` : 33/33 OK (avant : 23). `npm run build` : OK.
- Non vérifié : rendu réel dans un navigateur (pas de test UI dans cette phase). Limite de fond inchangée :
  sans backend, la règle repose sur les données de ce navigateur (le commerçant et le joueur doivent partager
  le même navigateur pour la démo).
- Hors périmètre, toujours ouverts : mineurs 2 à 6 (phase FIX-C).

## 09/11/2026 — Phase FIX-C : mineurs 2 à 6 + préservation des brouillons humains
- **MINEUR 2 (lien avis Google indirect) — corrigé, lien direct TROUVÉ.** Source : le linktr.ee officiel
  du restaurant (https://linktr.ee/asianhomefrance), bouton « Tres important ! Laissez nous un avis » →
  `https://g.page/r/CZ4T2NC-smn9EAE/review`. Redirections suivies avec curl (aucune session Google) :
  302 → `…/review/` → 302 → `https://search.google.com/local/writereview?placeid=ChIJAV70Kqxt5kcRnhPY0L6yaf0&source=g.page.m._&laa=merchant-review-solicitation`.
  Place ID non inventé : il vient du lien publié par le restaurant lui-même. Mis dans `seed.json` (forme courte
  `writereview?placeid=…`) ; `defaults.ts` ne contenait pas ce lien. `migrer` (`depot.ts`) remplace l'ancien lien
  Maps exact dans les données déjà stockées (un lien saisi par le commerçant n'est jamais touché). Libellés gardés.
  Non vérifié : l'affichage final du formulaire dans un navigateur connecté à Google (aucune ouverture Google faite).
- **MINEUR 3 — corrigé.** `Avis.tsx` : « Réponse automatique préparée (démo — rien n'est publié sur Google) ».
  Grep publié/publiée/transmis/envoyé dans `src/` : il ne reste que des négations (Plus, Réglages) ; commentaire
  de `types.ts` corrigé.
- **MINEUR 4 — corrigé.** Modèle négatif : « Nous prenons votre retour très au sérieux et nous allons en parler en équipe. »
- **MINEUR 5 — corrigé (CSS, sans capture).** `BadgeDemo` : `shrink-0 whitespace-nowrap` ; `EnTete` : bloc titre en `min-w-0`.
  Classes présentes dans le CSS compilé. Capture 390 px NON faite : aucun navigateur headless accessible depuis la session.
- **MINEUR 6 — corrigé.** « Note sans commentaire » (Avis, Tableau de bord) : `text-gray-400` (2,60:1) → `text-gray-500`
  (4,84:1 sur blanc, calcul OKLCH → sRGB → luminance WCAG). Placeholders non touchés.
- **Réserve brouillon humain — corrigée.** `appliquerRegles` ne touche plus un avis qui a une réponse OU un brouillon ;
  `store.tsx` (`avecReglesAppliquees`, `ajouterAvis`) passe par cette fonction → même règle à la réapplication des
  réglages. Texte d'aide des Réglages mis à jour.
- Tests ajoutés (3) : brouillon 5★ + auto5 conservé (et 4★ + auto4) ; modèle négatif sans « transmis » / « envoyé » ;
  lien direct Asian Home + migration. `npm test` : 36/36 OK (avant : 33). `npm run build` : OK.

## 09/11/2026 — Phase V1 : backend partagé + API + PIN commerçant
- **Fait.** `server/` : Node 24, zéro dépendance npm (`node:http`, `node:sqlite`, `node:crypto`), TypeScript exécuté
  directement par Node. `npm run serveur` → port `PORT` (défaut 3001), `GET /api/v1/sante` répond (vérifié avec curl :
  `{"ok":true,"version":"0.1.0","mode":"developpement","stockage":"sqlite","demo":false}`). Le serveur sert aussi `dist/`
  s'il existe (HTTP 200 vérifié sur `/`).
- **Base : `node:sqlite` retenu** (utilisable dans Node 24.22, prouvé par un test) → `data/fidelite.db`, ajouté au `.gitignore`.
  Repli JSON non écrit (inutile). Anti-doublon : `cleContact` + contrainte d'unicité SQL.
- **Règles métier non dupliquées** : le serveur importe `src/lib/fidelite.ts`, `roulette.ts`, `avis.ts`, `src/data/defaults.ts`,
  `seed.json`. Seul ajout aux types partagés : `Commerce.demo?` et `Tirage.code?` (optionnels, front inchangé).
- **API /api/v1** : toutes les routes demandées + `GET /commerces/:id` (fiche publique) et `PUT /commerces/:id/pin` (changer /
  réinitialiser un PIN). Tirage 100 % serveur (visite du jour + 1 tirage/jour vérifiés, lot tiré, code gagnant 6 caractères).
  Erreurs JSON en français (400/401/404/409/413/429).
- **Auth** : PIN commerçant 4-6 chiffres en SHA-256 + sel, jamais renvoyé ; `X-Commerce-PIN` ; `X-Admin-PIN` (variable `ADMIN_PIN`,
  `000000` en dev uniquement, refus de démarrer en production sans PIN admin ≥ 8 chiffres). Anti-bruteforce en mémoire :
  10 PIN faux / 10 min / IP → 429 pendant 10 min.
- **Migration** : base neuve = Asian Home Paris seul (vraies coordonnées, lien d'avis direct, lots), 0 client / avis / tirage ;
  les 2 commerces de démo seulement avec `DEMO=1`, marqués `demo: true`. Fuseau forcé à Europe/Paris (jour calendaire du jeu).
- **Tests** : `tests/serveur.test.ts`, 19 tests HTTP réels (port éphémère, base temporaire). `npm test` : **55/55 OK** (avant : 36).
  `npm run build` : OK.
- **Déploiement** : rien déployé, rien poussé, aucun compte créé. `server/README.md` décrit Render Free (0 €) et dit honnêtement
  qu'il **ne convient pas au vrai restaurant** : disque effacé à chaque mise en veille (15 min sans trafic) / redémarrage
  (doc Render vérifiée le 09/11). Option réelle : Starter + disque 1 Go ≈ 7,25 $/mois — **à valider par l'utilisateur**.
- **Restes ouverts** : front pas encore branché (V2) ; pas d'import ni de sauvegarde complète par l'API ; pas de suppression
  de client (RGPD) ; code serveur non vérifié par `tsc` (pas de `@types/node`, couvert par les tests HTTP) ; un PIN court haché
  reste vulnérable si le fichier de base fuit ; pas de vérification du numéro du client (SMS).

## 09/11/2026 — Phase V2 : front sur données partagées + optimisations
- **Bascule (fait).** `VITE_API_URL` absente → démo locale inchangée (localStorage, bandeau « Démo locale — données sur cet
  appareil seulement » sur chaque écran commerçant). Définie → mode API : `src/data/api.ts` (client HTTP, `fetch` injectable),
  `src/data/depotApi.ts` (mêmes méthodes de lecture que `Depot` sur un cache localStorage + `chargerServeur` asynchrone),
  `src/store.tsx` scindé en `StoreLocal` / `StoreApi`. Cache affiché d'abord, puis serveur ; rechargement 10 s (page visible),
  `visibilitychange` / `focus` / `online`, et après chaque action. **Conflit : le serveur fait foi** (chaque chargement remplace
  tout ; aucune action appliquée en local avant la réponse ; pas de file hors ligne) — documenté dans README et `depotApi.ts`.
  Hors ligne : bandeau « Hors ligne — dernières données connues (heure) … Serveur injoignable — vérifiez la connexion » ;
  toute action échouée affiche son erreur et **aucun « ✓ »** (inscription, visite, récompense, réglages, avis, PIN, création).
  `npm run build:api` (`.env.api`, `VITE_API_URL=/`) : front servi par le serveur à la même adresse ; Render : build command mise à jour.
- **Jeu public** : `#/jouer/:id` en mode API passe par `POST /tirages` (lot tiré par le serveur ; le navigateur n'envoie que
  contact + prénom et anime la roue jusqu'au lot reçu, `src/data/jeuApi.ts`). Code gagnant affiché + « Copier le code » ;
  le commerçant voit le même code (Tableau de bord, Roulette, fiche client). La roue se débloque seule quand la visite est validée.
- **PIN** : écran « Espace commerçant » (`src/components/Verrou.tsx`) : commerce + PIN 4-6 chiffres, ou PIN admin. Champ masqué,
  jamais affiché. Mémorisé pour l'onglet en sessionStorage **chiffré** (AES-GCM, clé non exportable dans IndexedDB,
  `src/data/coffrePin.ts`) ; « 🔒 Verrouiller » efface PIN, clé et cache clients. Limite : une faille XSS pourrait utiliser la clé ;
  sans WebCrypto (http:// hors localhost) le PIN n'est pas mémorisé. Page Admin réservée au PIN admin ; « Changer le PIN » par commerce.
- **Onboarding** : Admin → « + Ajouter un commerce » = 4 champs (nom, type pré-rempli « Restaurant », lien Google optionnel,
  PIN) → 1 requête `POST /commerces` (commerce + PIN) → ouvre Réglages du nouveau commerce. Clics sur téléphone, admin déjà
  déverrouillé : Plus (1) → Admin (2) → « + Ajouter un commerce » (3) → « Créer » (4), avec 2 saisies obligatoires (nom, PIN).
  Déverrouillage admin avant : onglet « Admin (tous) » + PIN + « Déverrouiller » (2 taps). **Chronométrage réel non fait**
  (aucun navigateur) : pas de durée inventée.
- **Serveur (modifié, documenté, testé)** : (1) **manque V1 trouvé** : la page publique `#/carte/:clientId` n'avait aucune route
  pour lire une carte sans PIN → ajout `GET /api/v1/cartes/:clientId` (carte sans téléphone/e-mail, statut du jeu du jour, lot du
  jour, jamais le code gagnant ; 404 / 409 inactif). (2) `clientsEnCsv` déplacé tel quel dans `src/lib/csv.ts` (partagé avec
  l'export local). Aucune règle métier modifiée.
- **Bug trouvé côté front (corrigé + test)** : `Response.text()` retire le BOM UTF-8 → le CSV téléchargé depuis l'API aurait
  perdu ses accents dans Excel. Lecture en `TextDecoder('utf-8', { ignoreBOM: true })` ; tests « BOM conservé » (simulé + vrai serveur).
- **Bug de dépôt git trouvé** : `.gitignore` contenait `data/`, ce qui ignorait aussi `src/data/` (nouveaux fichiers non suivis).
  Remplacé par `/data/`.
- **Optimisations** : recherche Clients via `src/lib/recherche.ts` (même règle que `cleContact` : 06 / +33 / 0033 / (0) /
  espaces / points / tirets, numéros partiels ; prénoms sans accents ; champ désormais étiqueté). « Exporter (CSV) » sur Clients
  (API : `/export.csv` avec PIN ; local : généré, même format). Copier : `copier()` utilisé partout où l'on copie — message de
  relance (existant), **lien de la page de jeu** (ajouté, Roulette), **code gagnant** (ajouté) ; retour « ✓ Copié » /
  « Copie impossible : sélectionnez le texte » ; repli `execCommand` désormais protégé (une exception = échec affiché, pas de faux ✓).
  Le QR lui-même est une image SVG (rien à copier ; le lien à côté l'est). Formulaires : tous les champs ont un label
  (y compris recherche et PIN), erreurs en français, nouveaux boutons ≥ 44 px (`min-h-11` / `.bouton` 48 px).
- **Production vs démo** : mode API + `DEMO=0` → Asian Home Paris vide (test serveur « base neuve » : Asian Home seul,
  `demo: false`, 0 client / avis / tirage ; `/sante` du serveur lancé : `"demo":false`).
  Badge « Démo » en mode API seulement si `commerce.demo` (seed `DEMO=1`) : en-tête, Admin, jeu, carte, Avis, Offre, Plus,
  Wallet, Tableau de bord. Textes sans « démo » pour le vrai commerce (« + Saisir un avis reçu », « Pas encore disponible »…).
  Démo locale : bandeau « Démo locale » présent sur les 10 écrans commerçant du rendu HTML (pages publiques : badge en pied de page).
- **Tests** : `tests/front-v2.test.ts` (24, sans serveur, `fetch` simulé) + 2 tests dans `tests/serveur.test.ts` (client du front
  contre le vrai serveur, carte publique). `npm test` : **81/81 OK** (avant : 55). `npm run build` : OK. `npm run build:api` : OK.
  `npm run preview` + curl → HTTP 200.
- **Test HTTP réel** (`npm run serveur` + `npm run preview`, curl une commande à la fois) : créer commerce + PIN (201) → inscrire
  (201) → tirage sans visite (409) → visite (200) → tirage serveur (201, lot + code) → 2e tirage, autre format du numéro (409) →
  export CSV (200, BOM `ef bb bf`) ; sans PIN (401). Sortie complète : `PREUVE-HTTP-V2.txt`. Le serveur sert aussi le front API
  (`/` → 200). `scripts/preuve-http-v2.sh` reprend ces appels mais **n'a pas été exécuté** comme script (bash refusé dans la session).
  Le commerce « Preuve V2 Chez Lin » est resté dans la base de dev locale `data/fidelite.db` (non versionnée).
- **Perf mobile** : JS 363 kB / **109 kB gzip** (V1 : 330 / 99 ; +10 kB gzip pour le mode API), CSS 32,8 kB / 6,5 kB gzip,
  HTML 0,5 kB. **Aucun appel réseau externe au chargement** : grep des URL dans `dist/` → seulement l'espace de noms SVG (w3.org),
  des liens cliquables (Google, `g.page` en placeholder), des URL de messages d'erreur React et un commentaire Tailwind ; ni
  Google Fonts ni CDN (police système). Logo = initiales (une URL d'image n'est chargée que si le commerçant en saisit une).
  Le seed de démo (27 Ko) reste dans le bundle en mode API (chargement à la demande possible plus tard).
- **Rendu 390 px : NON vérifié visuellement.** Aucun navigateur lançable (chromium / firefox / chrome refusés ou absents). Essai
  unique d'installation légère : `npm install --no-save playwright-core` OK, puis `playwright-core install chromium-headless-shell`
  → « Download failure » (réseau) ; paquet retiré. Aucune capture n'a été faite. Vérification de repli : les 12 écrans rendus en HTML
  avec `react-dom/server` (bundle SSR Vite temporaire hors dépôt), mode local : **12/12 sans erreur**. Le CSS du badge Démo
  (`shrink-0 whitespace-nowrap`) est inchangé ; nouveau bouton « 🔒 Verrouiller » en `shrink-0` à côté du sélecteur (`min-w-0`).
- **Restes ouverts** : rendu réel sur téléphone et parcours cliqué en mode API non vus à l'écran ; pas de file d'attente hors ligne ;
  rechargement complet toutes les 10 s (1 requête `/etat` par commerce pour l'admin) ; le cache clients reste dans le navigateur
  tant qu'on ne verrouille pas (fermer l'onglet ne l'efface pas) ; contact du joueur gardé sur son propre téléphone pour rejouer ;
  `VITE_API_URL=http://localhost:3001 npm run dev` documenté mais non essayé ; hébergement toujours à décider (aucune dépense).

## 09/11/2026 — Phase V3 : intégrations prêtes à brancher (sans tricher) + vérification finale
- **Apple Wallet : EN SUSPENS** (décision utilisateur 09/11 13h27). Aucun endpoint, aucune signature, aucun compte, rien demandé
  à personne. Prérequis documentés seulement (README + `server/README.md`, « à activer sur décision explicite »). Test : aucun code
  de pass Apple dans `server/`, `src/`, `scripts/` (recherche `pkpass`, `vnd.apple`, `passTypeIdentifier`, `signpass`, `pkcs7`…),
  et `…/pass.pkpass` → 404. (Le scan exclut `scripts/preuve-*`, qui appelle seulement cette URL pour montrer le 404 — trouvé
  quand le test a échoué après l'ajout du script de preuve.)
- **Google Wallet : architecture seule.** `server/wallet.ts` (charge utile Generic pass NON signée : `cardTitle` = commerce,
  `header` = prénom, `textModulesData` tampons x/seuil plafonnés + récompense, `barcode` QR_CODE vers `<site>/#/carte/:id`,
  émetteur `ISSUER_ID_A_FOURNIR` par défaut, jamais le téléphone / e-mail). Route `GET …/clients/:clientId/pass.json` (PIN) :
  **501** sans `GOOGLE_WALLET_ISSUER_ID` + `GOOGLE_WALLET_SERVICE_ACCOUNT_FILE` ; configurée, renvoie la charge utile avec
  « NON signée » (signature JWT non écrite). Champs vérifiés dans la référence REST GenericObject / Barcode (09/11) ; la valeur
  `QR_CODE` et le scope `wallet_object.issuer` viennent de ma mémoire (non affichés sur les pages lues) → marqués « à vérifier ».
- **Front Wallet** : bouton « Ajouter à Wallet — à brancher » (fiche client + carte publique), explication honnête et, dans la
  fiche, lien « Ouvrir la carte publique (QR) ». Plus aucun libellé « Apple / Google » promettant un ajout.
- **Avis Google** : en mode API hors démo, page Avis vide avec « Connectez Google Business Profile pour importer vos avis. »
  + section dépliable « Connecter Google — à brancher » (6 étapes, scope `https://www.googleapis.com/auth/business.manage`
  **vérifié** dans la doc Google « Basic setup » le 09/11 ; lecture des avis `GET mybusiness.googleapis.com/v4/{accounts/*/locations/*}/reviews`,
  vérifiée ; accès aux API soumis à approbation par formulaire). Aucun appel à Google. Le lien direct (placeid
  ChIJAV70Kqxt5kcRnhPY0L6yaf0) reste proposé. Démo : badge « Démo — avis simulés, aucune connexion à Google » (déjà présent, vérifié par test).
- **SMS / e-mail** : `server/notifications/` (`index.ts` interface + `twilio.ts` + `brevo.ts`). Sans clé → 501 « à brancher… Rien
  n’a été envoyé ». Route `POST …/clients/:clientId/relance` (PIN). Garde-fou ajouté : même configuré, **refus (409) sans
  `consentementRelance: true`** (nouveau champ optionnel de `Client`, qu'aucun écran ne recueille encore) ; mention STOP /
  désinscription ajoutée au message. Aucune clé configurée, aucun message envoyé ; adaptateurs testés uniquement avec un `fetch`
  simulé. Front : relances toujours en copier-coller + « Envoi SMS/e-mail à brancher ». `/sante` expose `integrations` (tout à false).
- **RGPD** : bloc « Données personnelles (RGPD) » dans Plus et Offre (`src/lib/integrations.ts`) + README.
- **Formulations corrigées** : Offre (« Aide aux réponses… à copier sur Google ; connexion directe à brancher », relance = message
  à copier), Plus (Wallet / avis / relances « à brancher »), bouton « Ouvrir le lien Google » (c'est le lien d'avis, pas la fiche),
  README (tableau réel / à brancher, en-tête, limites, tests).
- **Tests** : `tests/integrations-v3.test.ts` (13). `npm test` : **94/94 OK** (avant : 81). `npm run build` : OK (JS 366,6 kB /
  110,6 kB gzip, CSS 32,9 kB). `npm run build:api` : OK ; les 5 nouveaux textes sont dans le bundle (grep).
- **Parcours HTTP refait après V3** (`npm run serveur` + `node scripts/preuve-http-v3.mjs`, sortie dans `PREUVE-HTTP-V3.txt`) :
  santé 200 → création 201 → inscription 201 → tirage sans visite 409 → visite 200 → tirage 201 (lot + code) → 2e tirage autre
  format 409 → carte publique 200 → CSV 200 (BOM `efbbbf`) → CSV sans PIN 401 → pass.json 501 → pass.pkpass 404 → relance SMS 501
  → relance e-mail 501 → Asian Home : 0 avis, 0 client, 0 tirage, `demo=false`. Le serveur sert le front API : `/` → 200.
  `npm run preview` (après `npm run build`) + curl → 200 `text/html`. 2 commerces « Preuve V3 … » restent dans la base de dev
  locale `data/fidelite.db` (non versionnée).
- **Rendu 390 px : NON vérifié.** Tentative : aucun navigateur sur le PATH (chromium, chrome, firefox, wkhtmltoimage absents) ;
  le téléchargement Playwright avait échoué en V2 (réseau) → pas de nouvel essai. Aucune capture. Pas de rendu SSR refait en V3.
- **Restes ouverts / non vérifiés** : signature des passes Google et mise à jour à chaque tampon ; import des avis / publication
  des réponses ; écran de consentement aux relances et vrai lien de désinscription ; bouton « Envoyer » côté front (le front
  ignore `/sante.integrations`) ; bouton de suppression d'un client (RGPD) ; adaptateurs Twilio / Brevo jamais essayés en vrai ;
  rendu téléphone ; hébergement et domaine.
- **Identifiants encore nécessaires** (liste exacte + qui les fournit : README, « Identifiants et comptes encore nécessaires ») :
  Google Business Profile (client + utilisateur), Apple Developer (utilisateur — en suspens), Google Wallet émetteur
  (utilisateur), prestataire SMS / e-mail (utilisateur), hébergement backend (utilisateur), nom de domaine (utilisateur ou client).
- Rien publié, rien poussé, aucune dépense, aucun compte créé, aucune clé configurée, aucun message envoyé.

## 09/11/2026 — Phase Supabase S1 : schéma, migration SQL, RLS, adaptateur stockage (SQLite en fallback)
- **Aucun compte Supabase, aucun projet, aucune clé, rien de facturable, rien poussé.** Donc **aucun test contre un vrai
  Supabase / Postgres** : la couche est testée avec le client officiel `@supabase/supabase-js` branché sur un **faux PostgREST
  en mémoire** (transport `fetch` injecté) qui reproduit le contrat HTTP et les contraintes de la migration. Le SQL n'a
  jamais été exécuté par un vrai Postgres (pas de Postgres dans la VM) : seule sa forme est vérifiée par les tests.
- **Ajouté** : `supabase/migrations/0001_schema_initial.sql` (tables `meta`, `commerces`, `clients`, `tirages`, `avis`, JSONB
  `donnees` + colonnes indexées, `pin_hash` / `pin_sel`, unique `(commerce_id, cle_contact)`, index tirages / avis, **index
  unique 1 tirage par client et par jour à Paris**, colonne `version` + trigger), `0002_rls.sql` (RLS sur les 5 tables, aucune
  policy, droits anon / authenticated retirés), `server/stockage-supabase.ts`, `.env.example`, `tests/supabase.test.ts` (15).
  Dépendance : `@supabase/supabase-js` **2.119.0** (épinglée).
- **Modifié** : `server/stockage.ts` (interface `Stockage` commune, `ErreurConflit`, transaction acceptant des `await` avec file
  d'attente), `server/app.ts` (`await` sur chaque appel au stockage, `creerServeur` devient async, choix Supabase / SQLite,
  `/sante.stockage` = stockage actif, conflits → 409), `server/index.ts` (`configSupabaseDepuisEnv`), `npm run serveur` lit un
  `.env` facultatif (`--env-file-if-exists`), `.gitignore` (`.env`), 2 tests existants adaptés à `creerServeur` async
  (`await`, `assert.rejects`), README + `server/README.md`.
- **Choix tranchés** :
  - Le contrat SQLite était synchrone ; Supabase ne peut pas l'être. Plutôt qu'un cache mémoire (faux sous plusieurs
    instances), même interface avec des valeurs « T ou Promise<T> » : SQLite reste synchrone (le test V3 qui l'ouvre directement
    marche sans changement), le serveur `await` tout. Aucune règle métier touchée : mêmes fonctions de `src/lib/`.
  - **Transaction Supabase : pas de vraie transaction** (REST). Remplacée par : contraintes uniques (inscription, tirage du
    jour) + verrou optimiste par `version` sur clients / avis lus dans la transaction (AsyncLocalStorage). Double visite
    simultanée → 1 réussite + 1 409 « réessayez » (aucun tampon perdu en silence). **Non garanti** : une suite d'écritures
    coupée au milieu n'est pas annulée (ex. PATCH commerce puis réévaluation des avis).
  - Tirage du jour : unicité **en base** sur `(commerce_id, client_id, (date at time zone 'Europe/Paris')::date)` ; le serveur
    transforme le refus en 409 « déjà tourné la roue ». Testé avec deux requêtes réellement simultanées (barrière dans le faux
    PostgREST) : les deux lectures ne voient rien, c'est la contrainte qui refuse le 2e INSERT. Hypothèse non vérifiée sur un vrai
    Postgres : l'expression `timestamptz at time zone 'Europe/Paris'` est acceptée dans un index (fonction immuable) — à
    confirmer en S2 à l'exécution de la migration.
  - `SUPABASE_ANON_KEY` **non incluse** (inutile : le navigateur ne parle jamais à Supabase). Une seule des deux variables
    Supabase → refus de démarrer (plutôt qu'un repli silencieux sur un SQLite éphémère).
  - Initialisation rendue rejouable (commerce déjà présent ou doublon ignoré), nécessaire sans transaction.
  - `ordre` (identité) remplace le `rowid` SQLite pour garder l'ordre d'insertion ; `date` en `timestamptz`.
- **Tests** : `npm test` **109/109** (avant : 94 ; +15 dans `tests/supabase.test.ts`). `npm run build` : OK (bundle front inchangé,
  366,6 kB / 110,6 kB gzip — le client Supabase n'est pas dans le front). `npm run serveur` sans variables : `/sante` →
  `"stockage":"sqlite"`.
- **Reste (S2)** : créer le projet Supabase gratuit (région UE) — par l'utilisateur ; SQL Editor → exécuter `0001` puis `0002` ;
  vérifier dans le dashboard l'emplacement exact des clés (legacy service_role ou `sb_secret_…`) ; poser `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` chez l'hébergeur du serveur ; `/sante` → `supabase` ; refaire le parcours HTTP
  (`scripts/preuve-http-v3.mjs`) contre le vrai projet, dont le double tirage simultané ; décider de l'hébergement du serveur
  Node lui-même ; import éventuel d'un `fidelite.db`. Apple : toujours en suspens, rien touché.

## 09/11/2026 — Phase Supabase S2 : procédure exacte, hébergement du serveur, vérification
- **Toujours aucun compte, aucun projet, aucune clé, rien poussé, rien dépensé.** Rien n'a été exécuté contre Supabase.
- **Limites du gratuit vérifiées sur les pages officielles (09/11/2026)** — supabase.com/pricing, docs « Project Pausing »
  (`/docs/guides/platform/free-project-pausing`), « Backups », « API keys », « Regions » ; render.com/docs/free et /docs/regions.
  Toutes ouvertes avec succès (sauf `/docs/guides/platform/billing-on-free` → 404, non utilisée). Chiffres : Supabase Free =
  2 projets actifs, 500 Mo de base, 5 Go egress + 5 Go cached, 1 Go fichiers, pause après 7 jours de faible activité (e-mail
  ~1 semaine avant, « Resume project » dans le dashboard, durée non indiquée, restaurable 1 an), aucune sauvegarde, journaux
  1 jour ; Pro à partir de 25 $/mois = pas de pause, sauvegardes quotidiennes 7 jours, 8 Go, 250 Go egress, 10 $ de crédits.
  Render Free = veille après 15 min, réveil ~1 min, 750 h/mois, disque éphémère, Frankfurt seule région UE (région non
  modifiable ensuite ; la page ne dit pas si Free existe partout).
- **Écarts trouvés** : S1 n'avait noté aucun chiffre du gratuit. En revanche les emplacements des clés de S1 (et du brief :
  « Project Settings → API ») sont **périmés** : la doc actuelle dit *Settings → API Keys* (plus de page « API » séparée) et
  URL dans la fenêtre *Connect* ; clés legacy `anon` / `service_role` abandonnées « d'ici fin 2026 » → procédure basée sur la
  clé `sb_secret_…` (nom de variable inchangé). Restauration d'un projet en pause : 1 an selon la page actuelle, 90 jours selon
  un changelog de 2024 — la page actuelle est retenue, l'écart est signalé. Libellés à confirmer à l'écran.
- **Migration SQL validée sur un vrai Postgres local.** Pas de `psql` / `postgres` dans la VM. Choix : **PGlite 0.5.15**
  (`@electric-sql/pglite`, épinglé, **devDependency** — aucun impact sur le serveur ni le bundle front) = PostgreSQL **18.6** en
  WebAssembly. `tests/migration-pglite.test.ts` (9 tests) : 0001 + 0002 passent et sont rejouables, 5 tables + RLS sans
  policy, anon / authenticated → 42501, **index « 1 tirage par jour à Paris » accepté par Postgres** (hypothèse ouverte en S1
  levée) et vérifié autour de minuit en heure d'hiver et d'été, anti-doublon, CHECK, FK, cascade, trigger `version`, upsert
  meta. Les rôles Supabase sont recréés dans le test (pas leurs droits par défaut). **Non vérifié** : la version de Postgres
  du vrai projet, PostgREST, les droits par défaut Supabase → à confirmer à l'étape b.
- **Hébergement du serveur : Render Free Web Service** (Frankfurt) + Supabase **Central EU (Frankfurt)** `eu-central-1`.
  Choix de Frankfurt plutôt que Paris pour Supabase : Render n'a que Frankfurt en UE et chaque requête de l'app enchaîne
  plusieurs allers-retours serveur ↔ base → même ville. La veille Render ne perd plus de données. Alternatives en une phrase
  (Render Starter 7 $ sans veille ; Starter + disque si Supabase ne convient pas ; serverless écarté = réécriture).
- **Procédure a → g écrite** dans `server/README.md` (« Mise en production : Supabase + Render ») et résumée dans le README :
  compte + projet, SQL Editor + requête de vérification RLS, clés, dépôt GitHub privé + Render (build / start / variables),
  `/sante` → `supabase`, parcours sur un commerce « Test S2 » puis suppression par SQL (cascade), pause / Pro, migration.
- **Migration des données** : rien à migrer (Asian Home vide en production ; `data/fidelite.db` = essais V2/V3). Aucun outil
  d'import n'existe ; deux voies décrites (CSV + réinscription, ou script SQLite → Supabase via le contrat `Stockage`, non écrit).
- **Risque trouvé : egress.** Le front recharge tout l'état toutes les 10 s ; tailles mesurées sur le seed (~430 o/client,
  ~210 o/tirage, ~265 o/avis) → ~8 Go/mois non compressés avec 100 clients et une tablette ouverte 12 h/jour, au-dessus des
  5 Go. Effet de la compression gzip sur le décompte Supabase **non vérifié**. Rien changé dans le code (hors périmètre) :
  documenté avec le remède (intervalle à 30-60 s, `INTERVALLE_RECHARGEMENT_MS`) et le contrôle à faire (page Usage).
- **Autres fichiers** : `.env.example` (libellés corrigés, toujours 2 variables placeholder), `server/README.md` (sections
  Supabase, Limites, Validation, Mise en production, Sauvegarde ; l'ancienne section « Render Free SQLite » est remplacée),
  `README.md` (tableau réel / à brancher, résumé de mise en ligne, comptes nécessaires, tests).
- **Tests** : `npm test` **118/118** (avant : 109 ; +9). `npm run build` : OK (JS 366,6 kB / 110,6 kB gzip, inchangé).
- Apple : en suspens, rien touché.

## 09/11/2026 — Phase Supabase S3 : render.yaml + vérification finale de la procédure
- **Toujours aucun compte, aucun projet, aucune clé, rien poussé, rien dépensé, rien déployé.**
- **`render.yaml` (racine)** : 1 service `web` `asian-home-fidelite`, `runtime: node`, `plan: free`, `region: frankfurt`,
  build `npm ci && npm run build:api`, start `npm run serveur`, `healthCheckPath: /api/v1/sante`, `NODE_VERSION="24"`, et
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PIN`, `PIN_ASIAN_HOME` en `sync: false` (aucune valeur). Pas de `branch`
  (celle choisie à la création). Noms de champs vérifiés le 09/11 dans la doc officielle *Blueprint spec* (`runtime` remplace
  `env`, déprécié ; `free` et `frankfurt` valides ; `sync: false` demandé **seulement à la création** du Blueprint).
  YAML validé par PyYAML 6.0.1 (contrôle manuel) et par le test.
- **Vérifié dans la doc Render (09/11)** : parcours *New > Blueprint* → **Connect** sur le dépôt → nom + branche → aperçu →
  **Deploy Blueprint** (le brief disait « Apply » : libellé corrigé) ; `RENDER=true` posé partout ; `NODE_ENV=production`
  posé **au runtime seulement** → `npm ci` installe bien les devDependencies (TypeScript, Vite) au build ; précédence
  `NODE_VERSION` > `.node-version` > `.nvmrc` > `engines`.
- **Seed de production vérifié dans le code** (`initialiser`, `server/app.ts`) : base neuve → seul `seed.commerces[0]`
  (Asian Home Paris réel), `demo: false`, PIN haché, 0 client / avis / tirage ; démo seulement si `DEMO=1` ; en production
  sans `PIN_ASIAN_HOME` → refus de démarrer sans rien écrire. Le test Supabase existant ne vérifiait que `clients` vide et
  pas le mode production → **nouveau test** « S3 : base Supabase neuve en production » (tirages / avis / meta, `demo: false`,
  lien d'avis, `/sante` = supabase / production / demo false, refus sans PIN).
- **Procédure relue de bout en bout** (`server/README.md`) — corrigé : étape d réécrite autour du Blueprint (formulaire manuel
  gardé en secours), secrets à corriger plus tard via *Environment*, garde-fou « plan Free, pas de carte », messages des
  journaux en cas de refus de démarrer ; étape d.7 relie le résultat attendu au code et au test ; étape e : libellés
  vérifiés dans le code (« Déverrouiller » manquait, « Inscrire » → « + Inscrire un client », « Copier le lien de la page de
  jeu », message exact de la page de jeu, réveil ~1 min) ; note générale : libellés Supabase **à confirmer à l'écran** (doc
  seulement), Render relus dans la doc, app vérifiés dans le code. README : résumé étape 4 → Blueprint.
- **Tests** : `tests/render-yaml.test.ts` (5) — mini-lecteur YAML strict sans dépendance (refuse tabulations, flow, ancres,
  clés en double, indentation incohérente), structure exacte attendue, 4 secrets sans valeur, aucune clé / URL Supabase /
  nombre ≥ 4 chiffres hors commentaires, cohérence avec `package.json`, `.env.api`, lockfile et variables lues par le serveur.
  `npm test` **124/124** (avant : 118 ; +5 render, +1 Supabase). `npm run build` : OK (366,6 kB / 110,6 kB gzip, inchangé) ;
  `npm run build:api` : OK.
- **Non vérifié** : aucun écran Render / Supabase réel vu (pas de compte) ; affichage exact du formulaire des secrets Render ;
  disponibilité du plan Free en Frankfurt (la doc accepte `plan: free` + `region: frankfurt`, sans le garantir par région).
- Apple : en suspens, rien touché.

## 09/11/2026 — Tentative de déploiement A à Z (coordinateur déploiement)
- Consigne utilisateur : « Fais tout de a a z » — déployer sans qu'il ait à faire les clics.
- **Re-vérifié avant déploiement : `npm test` 124/124, 0 échec (relancé à l'instant). Code prêt, branche `master`, `git status` propre.**
- **SSH réparé (bloquant trouvé sur la VM) :** `~/.ssh/known_hosts` n'existait plus (VM remplacée) → `git ls-remote` échouait « Host key verification failed » même sur le repo X existant. Clés hôtes GitHub reprises de la doc officielle (docs.github.com, empreintes vérifiées : Ed25519 `SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU`, ECDSA `p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM`, RSA `uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s`) et écrites dans `/home/hatch/.ssh/known_hosts`. Piège : le shell tourne en root avec HOME=/home/hatch mais ssh cherche known_hosts dans /root/.ssh — il faut `-o UserKnownHostsFile=/home/hatch/.ssh/known_hosts` dans GIT_SSH_COMMAND. Après correctif : `ls-remote` sur X OK (HEAD 81716f7, main, tags v0.1.0/v0.1.1).
- **BLOQUÉ étape 1 — GitHub :** repo `yassbybibiche-png/asian-home-fidelite` inexistant (API publique : 404 ; `ls-remote` SSH : « Repository not found » — la clé est acceptée, c'est bien l'absence du repo). Aucun token GitHub sur la VM (`gh auth status` : non connecté, `~/.config/gh/` absent, aucun login en coffre pour github.com / supabase.com / render.com). La création d'un repo exige l'API GitHub avec token — SSH seul ne peut pas créer de repo. Remote `origin` ajouté en préparation (ssh://git@ssh.github.com:443/yassbybibiche-png/asian-home-fidelite.git) — le push marchera dès que le repo vide existera.
- **BLOQUÉ étapes 2-3 — Supabase + Render :** aucun compte ni token sur la VM (pas de CLI supabase/render, aucun login en coffre). Création du projet Supabase et déploiement Render exigent une session connectée (compte Supabase, compte Render relié à GitHub). Rien créé, rien dépensé, aucun compte inventé, aucun mot de passe deviné.
- **Ce qu'il reste à faire côté utilisateur (3 clics, dans l'ordre) :** 1) github.com/new → repo PRIVÉ `asian-home-fidelite` (vide, sans README) sur yassbybibiche-png ; 2) ensuite le push, la création du projet Supabase, les migrations et le Blueprint Render peuvent être relancés depuis la VM sans autre intervention ; 3) les 4 secrets Render seront à saisir à ce moment-là (PIN choisis alors, jamais stockés en clair avant).
- Apple Developer : en suspens, rien touché.

## 09/11/2026 — Déploiement en production TERMINÉ (URL en ligne)
- Dépôt GitHub privé `yassbybibiche-png/asian-home-fidelite` créé par l'utilisateur ~15h48, code poussé ~15h50 (14 commits, master, HEAD c41f236).
- Supabase créé ~16h21 (tâche navigateur, connexion e-mail yassbybibiche@gmail.com — GitHub a rejeté les identifiants enregistrés) : projet gratuit `asian-home-fidelite`, Central EU Frankfurt (eu-central-1, Nano), Healthy, dashboard /project/ixxanfxtzrzoskhvdfgp. **Anomalie : la 1re tâche a exécuté un ancien schéma normalisé** (commerces commerce_id uuid/nom/ville, 3 policies publiques, pas de `donnees`) au lieu des migrations du dépôt — cause non établie, les fichiers du dépôt étaient corrects.
- Render : compte créé (GitHub OAuth OK, e-mail vérifié via lien Gmail), Blueprint déployé, build OK, mais serveur en « Exited with status 1 » (`column commerces.donnees does not exist`). Autorisation utilisateur obtenue ~18h42 (« Oui, corrige le schéma et redéploie »).
- Correction (2e tâche navigateur, ~18h45-19h05) : DROP des 5 tables (vides, aucune donnée perdue), réexécution 0001 puis 0002, vérification 5 tables RLS true ; 2 écarts rencontrés : (1) 1re tentative 0001 : erreur syntaxe index tirages (`(date …)::date` hors parenthèses) corrigée sur place — le fichier du dépôt contient déjà la forme corrigée `((date …)::date)` ; (2) `column commerces.ordre does not exist` après redéploiement, corrigé par ajout manuel `ordre bigint generated by default as identity` sur commerces/clients — le fichier du dépôt définit déjà `ordre bigint generated always as identity` (écart `always` vs `by default` sans effet, le serveur ne fournit jamais `ordre`). La base live est donc équivalente aux migrations du dépôt.
- Redéploiement Render dep-dbp0gt59fdbs73dn3hjg « Live » ~18h53 (master c41f236). **/sante vérifié par l'assistant : {"ok":true,"version":"0.1.0","mode":"production","stockage":"supabase","demo":false}** ; page d'accueil en ligne vérifiée (Espace commerçant, PIN).
- Parcours test complet sur commerce « Test S2 » (créé puis supprimé) : inscription + déduplication +33/06 OK, visite 1/10, roue débloquée, tirage gagné « -5 % » code P4PAVQ, 2e tirage refusé, export CSV 141 o. État final : commerces 1 (Asian Home Paris), clients 0, tirages 0, avis 0, meta 3. 0 € dépensé, aucune carte.
- PIN admin et PIN restaurant : générés par l'assistant, transmis à l'utilisateur à la livraison (valeurs retirées de ce journal le 09/11/2026 — ne jamais les écrire dans le dépôt).
- Limites connues : « Gains récents » côté commerçant vide tant que la page n'est pas rechargée (cache 10 s) ; Apple Wallet en suspens ; Google Wallet / Google Business / SMS / e-mail non branchés (501) ; pause Supabase gratuite après 7 jours d'inactivité.
- **URL de production : https://asian-home-fidelite.onrender.com**

## 09/11/2026 — Visuel pro + invitation à l'avis avec 5 étoiles pré-remplies (dans l'app)
- **Limite Google (ne pas contourner)** : le lien `writereview?placeid=…` ne permet pas de pré-sélectionner une note ; les
  5 étoiles pré-remplies n'existent que DANS l'app, le client confirme ses étoiles sur Google. Lien Asian Home inchangé
  (Place ID `ChIJAV70Kqxt5kcRnhPY0L6yaf0`), aucun paramètre ajouté.
- **Invitation à l'avis** (`src/components/InvitationAvis.tsx` + logique pure `src/lib/invitationAvis.ts`) : 5 étoiles dorées
  remplies par défaut (radiogroup, cibles 48 px), un tap sur l'étoile n → note n (1 à 5), libellé « n/5 · Excellent… »,
  bouton « Laisser un avis n★ sur Google ↗ » = lien Google du commerce tel quel. Texte : « Votre avis compte — touchez une
  étoile pour ajuster, puis laissez votre avis sur Google. » ; après le tap : « sélectionnez-y vos étoiles et publiez ».
  Toujours après le tirage (gagnant ou perdant, ou déjà joué), jamais conditionnée au lot. Utilisée sur la page de jeu
  (modes local et API, remplace l'ancienne invitation) et en aperçu repliable sur la page Avis.
- **Visuel, écran par écran** (fonctionnalités et flux inchangés) :
  - Thème (`index.css`) : fond ivoire, titres serif système, ombres douces, `.carte` arrondie, boutons avec états nets
    (pression, focus clavier, désactivé gris lisible), pilules de filtre `.puce`, `.lien`, `.alerte-succes`, animation
    d'apparition (désactivée si « réduire les animations »). Texte secondaire passé en gris-600 / rouge-700 (≥ 4,5:1).
  - En-tête / navigation : barre translucide, onglet actif en pastille laque ; titres de page en serif.
  - Tableau de bord : KPI avec surtitre + liseré laque, 3 actions rapides (valider une visite, QR vitrine, avis).
  - Clients : pilules, badge « récompense », barre dorée quand la carte est pleine. Fiche client : historique en tuiles.
  - Carte de fidélité : bandeau laque façon carte physique (titulaire, x/10), grille de tampons alignée (cadeau sur le
    dernier), progression « encore n tampons », récompense en attente encadrée d'or, QR en pied de carte.
  - Roue : anneau laque fixe à perles dorées, secteurs laque / ivoire / encre / or, moyeu doré, pointeur ; seule la
    couche des secteurs tourne (même animation 4,5 s). Page de jeu : en-tête centré, résultat gagnant doré, code en
    cadre pointillé.
  - Avis, Réglages, Admin, Plus, Offre, QR vitrine (cadre laque autour du QR), carte publique (bouton roue en primaire),
    écran PIN : titres, contrastes et pilules harmonisés.
- **Tests** : `tests/invitation-avis.test.ts` (+9 : 5 étoiles par défaut, tap 3 → 3 sélectionnées, bornes, lien = seed
  avec Place ID et seul paramètre `placeid`, textes honnêtes, même invitation sur Jouer/Avis). `npm test` **133/133**
  (avant : 124). `npm run build` et `build:api` : OK (373,9 kB / 112,7 kB gzip). Rendu SSR des composants vérifié
  (5 étoiles cochées, href exact, 10 tampons, 5 secteurs).
- Commit `ec51d20` (code + tests) ; ce journal en commit séparé.
- **Non vérifié** : rendu visuel réel à 390 px sur téléphone (aucun navigateur sur la VM).

## 09/11/2026 — Modules « Cartiz » sous la marque Asian Home (caisse, points, équipe, messages, menu, dashboard, Wallet préparé)
- **A. Caisse** `#/caisse/<commerceId>` (`src/pages/Caisse.tsx`) : déverrouillée par un **code équipe à 4 chiffres** (mémorisé chiffré
  pour l'onglet, comme le PIN). Scan QR : `getUserMedia` + `BarcodeDetector` natif, sinon **`jsqr` 1.4.0** (nouvelle dépendance,
  chargée à la demande dans un morceau séparé de 47 Ko gzip, jamais téléchargé si le navigateur lit déjà les QR) ; recherche manuelle
  (prénom / téléphone / e-mail) toujours visible. Gros boutons « Ajouter un passage » (+ montant optionnel → points) et « Valider une
  récompense », échange de points. **File hors ligne** (`src/lib/fileCaisse.ts`, localStorage) : toute action reçoit un identifiant
  unique, est envoyée tout de suite si possible, gardée sinon, renvoyée au retour du réseau (`online`, toutes les 15 s) ; le serveur
  la reconnaît (`actionsTraitees` du client) → **jamais de 2e tampon** en rejouant ; une action refusée (déjà un passage ce jour-là,
  solde insuffisant…) sort de la file et s'affiche « refusée, non comptée ». État visible : « 2 actions en attente », « Synchronisé ».
  **Règle 1 tampon / jour appliquée par la route caisse** ; l'ancienne route `…/visite` (fiche client) garde son comportement.
- **B. Points + catalogue** (`src/lib/points.ts`) : 1 point / € par défaut, réglable (`eurosParPoint`, ex. 2 → 1 point / 2 €), calculé
  et stocké **par le serveur** (`points`, `depenseCentimes` dans `donnees`). Catalogue composable dans Réglages (nom, coût,
  description). Échange tracé (`echangesPoints` : qui, quand, quoi, solde avant / après) + idempotent + verrou optimiste existant.
  La carte affiche tampons ET points, et le catalogue (✓ quand le solde suffit).
- **C. Équipe** (`#/equipe`) : membres + code 4 chiffres, unique dans l'équipe, **haché + salé** dans une table à part, jamais renvoyé ni
  journalisé (contrainte SQL `equipe_sans_code`). **Journal d'audit** (table `journal`) : passage / récompense / échange / équipe /
  menu / message, avec auteur (membre ou « Gérant »), client, date ; visible dans le tableau de bord.
- **D. Messages** (`src/lib/messages.ts`, `#/messages`) : 6 règles à cocher dans Réglages (bienvenue, plus que 2 tampons, récompense,
  relance 30 j, anniversaire, demande d'avis). Générés par le serveur à l'inscription, au passage et **à l'ouverture de la carte**
  (relance, anniversaire — pas de tâche planifiée : Render Free s'endort), une seule fois chacun. Boîte de réception sur la carte du
  client (la demande d'avis y affiche l'`InvitationAvis` 5★ existante, texte « libre et sans contrepartie »). Messagerie : ciblage
  tous / inactifs / proches / nouveaux, texte + contacts à copier, dépôt dans l'espace client. **SMS / e-mail toujours en 501, rien envoyé.**
  Anniversaire saisi par le gérant dans la fiche client (JJ/MM).
- **E. Menu** (`#/menuCarte` édition, `#/menu/<commerceId>` public) : catégories, produits, prix (centimes), photo https ou image
  compressée dans le navigateur (≤ 480 px, ≤ 60 Ko), 14 allergènes UE ; QR du menu ; bouton « Voir le menu » sur la carte client.
- **F. Dashboard + apparence** : cartes émises, passages (total + 30 j), récompenses données (tampons + échanges), points en cours,
  5 clients les plus fidèles, journal. Réglages → apparence : couleur principale, fond, bannière https, **aperçu en direct** de la carte ;
  contraste ≥ 4,5:1 vérifié (front + refus 400 côté serveur). Sans réglage : charte inchangée (rouge laque, ivoire, serif).
- **G. Wallet** : **Apple** — `server/wallet-apple.ts` (pass.json storeCard, manifeste SHA-1, signature CMS détachée, zip, sans dépendance),
  branché sur **aucune** route (`pass.pkpass` → 404, `/sante` → `en_suspens`), refuse sans certificat. Signature CMS vérifiée par
  `openssl cms -verify` avec un certificat auto-signé de test sur des octets quelconques (aucun pass produit). **Google** — JWT
  « savetowallet » signé RS256, OAuth compte de service, création de classe ; route `pass.json` toujours **501** sans configuration
  (503 si clé illisible). Client : encart « Carte Wallet : bientôt » (Apple en suspens, Google à brancher), **plus aucun bouton**.
  2 tests V3 réécrits en conséquence (l'ancien test « aucun code Apple » encodait la décision précédente).
- **Migration `supabase/migrations/0003_cartiz.sql`** (tables `equipe`, `journal`, `menus`, RLS sans policy, droits service_role
  seulement, rejouable) — exécutée sur PGlite (Postgres 18.6) dans les tests, **PAS appliquée sur Supabase** (pas d'accès navigateur).
  **Garde-fou** : tant qu'elle manque, le serveur continue de servir l'existant (lectures vides, journal ignoré avec avertissement),
  les nouveautés répondent **503 « appliquez la migration 0003 »**, et `/sante` expose `migrations.cartiz` (false → true après).
- **Sécurité / hygiène** : les 2 PIN de production figuraient en clair dans ce journal (entrée « Déploiement en production ») : valeurs
  retirées. Elles restent dans l'historique git du dépôt privé (pas de réécriture d'historique sans accord).
- **Tests** : `tests/cartiz.test.ts` (29), + Supabase (2 : parcours Cartiz, production avant migration), + PGlite (1 : 0003), + Wallet
  (V3 : +5, dont 2 anciens réécrits). `npm test` **170/170** (avant : 133). `npm run build` / `build:api` : OK (JS 432,8 kB / 128,7 kB gzip
  + jsQR à part). Rendu SSR vérifié (carte personnalisée / par défaut, encart Wallet sans bouton, Réglages, tableau de bord, pages en
  mode local, aucun « Fideliz » ni prix).
- **Non vérifié** : rendu réel à 390 px, caméra et scan QR sur un vrai téléphone, comportement hors ligne réel du navigateur (seule la
  logique de file est testée), compression de photo (canvas) — aucun navigateur sur la VM.

## 09/11/2026 — Correctif migration 0003 Cartiz : rendue autonome (échec en production)
- Échec vérifié (tâche navigateur ~20h36) : exécution verbatim de `supabase/migrations/0003_cartiz.sql` dans le SQL Editor →
  « ERROR: 42883: function public.incrementer_version() does not exist », 0 ligne, transaction annulée, aucune des
  3 tables (equipe, journal, menus) créée. `/sante` : `"migrations":{"cartiz":false}`. Production existante non affectée.
- Cause : la base live n'a jamais reçu l'intégralité de la 0001 du dépôt (fonction + triggers de version absents — la 1re
  tâche navigateur avait exécuté un ancien schéma normalisé sans `donnees`, la 2e avait dû ajouter manuellement la colonne
  `ordre` que la 0001 définit pourtant). Les fichiers du dépôt sont corrects ; c'est la base live qui diverge.
- Correctif (fichier `0003_cartiz.sql` uniquement, rien d'autre) : la 0003 est désormais AUTONOME — en tête, définition
  `CREATE OR REPLACE FUNCTION public.incrementer_version()` (corps identique à 0001 : `new.version := old.version + 1`,
  `search_path` vide, `revoke` comme en 0001), puis (re)création idempotente (`DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`)
  des triggers de version sur commerces / clients / avis, avant les tables equipe / journal / menus et leurs propres triggers.
  Le reste de 0003 (tables, index, RLS sans policy) est inchangé.
- Tests (PGlite, vrai Postgres en mémoire) : 3 nouveaux tests — la 0003 corrigée passe SEULE sur une base simulant l'état
  live (tables 0001 sans la section « version », donc sans fonction ni triggers), rejouable, recrée fonction + 5 triggers
  (commerces, clients, avis, equipe, menus) et les triggers incrémentent bien `version` (verrou optimiste vérifié sur les
  3 tables). Chaîne complète 0001 → 0002 → 0003 toujours vérifiée par les tests existants. `npm test` **173/173** (170 avant,
  +3), `npm run build` et `build:api` OK.
- Réapplication en production (à faire par tâche navigateur, fichier corrigé) : Supabase → SQL Editor du projet
  asian-home-fidelite → exécuter `supabase/migrations/0003_cartiz.sql` verbatim (branche master, commit ci-dessous).
  Vérifications attendues : « Success. No rows returned », tables equipe / journal / menus présentes avec RLS = true,
  fonction `incrementer_version()` présente, triggers commerces/clients/avis/equipe/menus présents, puis `/sante` :
  `"migrations":{"cartiz":true}` (et redéploiement Render non nécessaire — aucun code serveur modifié, seule la migration SQL).

## 09/11/2026 — Vraies photos d'Asian Home Paris intégrées (visuels locaux)
- Photos déjà dans le repo (`public/visuels/`, provenance dans `SOURCES.md` — Facebook, Instagram @asianhomeparis,
  desicorner.fr, lacarte.menu ; aucune banque d'images, aucun hotlink). Le dossier `public/` n'était pas versionné : ajouté.
- Optimisation mobile (PIL, qualité 82, progressif) : table-sushis.jpg 2268×4032 / 753 Ko → 788×1400 / 196 Ko ;
  hero-plats.jpg 1024×683 / 173 Ko ; interieur.jpg 675×900 / 131 Ko ; cocktails.jpg 640×1136 / 69 Ko ;
  sushis-ardoise.jpg 614×408 / 30 Ko ; logo.png 600×600 / 74 Ko inchangé. Tous ≤ 250 Ko, intégrité vérifiée (PIL).
- Nouveau `src/lib/visuels.ts` : chemins locaux, repli pour Asian Home uniquement (id stable `c-asian-home-paris`,
  vérifié en production via GET /api/v1/commerces — logo et bannière vides côté base). Le logo / la bannière
  renseignés par le commerçant priment toujours sur le repli ; aucune donnée ni backend touchés (ni server/,
  ni migration, ni PIN). `photoCategorie()` n'associe une photo qu'à une catégorie qu'elle montre vraiment
  (Sushis/Makis → sushis-ardoise, Boissons/Cocktails → cocktails) ; les autres catégories n'ont pas de photo.
- Emplacements : `LogoCommerce` accepte désormais les chemins locaux `/…` et affiche le logo blanc-sur-noir sur
  fond sombre (`bg-gray-950`) — en-tête commerçant, carte de fidélité, pages Jouer / QR vitrine / Menu ;
  `CarteFidelite` : bannière = hero-plats.jpg ; page publique `#/carte` : couverture table-sushis.jpg (h-80)
  + section « Le restaurant » avec interieur.jpg ; page `#/menu` : couverture table-sushis.jpg (h-56) +
  illustration de catégorie (h-32) quand applicable. Alt descriptifs sur chaque photo ; images `w-full`
  dans des conteneurs `max-w-md` (pas de débordement à 390 px). Seed : logo Asian Home → `/visuels/logo.png`.
- Tests : `tests/visuels.test.ts` (+13) — existence + poids ≤ 250 Ko de chaque fichier référencé, pas de hotlink,
  repli Asian Home / autre commerce / primauté du réglage commerçant, mapping catégories. `npm test` **186/186**
  (173 avant). `npm run build` OK (dist/visuels/ : 6 fichiers). Aperçu local : page 200, 6/6 images 200.
- Correctif en cours de route : le mot « Supabase » dans un commentaire de `visuels.ts` cassait
  `tests/supabase.test.ts:629` (le front ne doit pas mentionner Supabase) — commentaires reformulés.
- Déploiement : push master → Render auto-déploie ; vérifié en ligne : /sante, accueil 200, images /visuels/* 200.
- **Non vérifié** : rendu réel à 390 px sur un vrai téléphone (aucun navigateur sur la VM) ; le menu de
  production est vide (0 catégorie via GET /menu) donc les illustrations de catégories ne sont visibles que
  quand le commerçant remplira le menu ; le tableau de bord commerçant n'a pas de visuel hero (outil interne).

## 10/11/2026 — DA Instagram + vrai menu + interactivité (refonte sombre, menu réel, recherche/filtres)
- **DA (docs/DA-INSTAGRAM.md, relevé 10/11)** : registre nocturne du lieu — noir + doré + lumières rose/violet — introduit
  en en-têtes, héros et carte de fidélité, rouge laque #b3262d conservé comme accent. Codes hex hors #b3262d = ESTIMÉS
  (aucune charte publiée) : noir #111111, doré #c9a227, rose #ff4d6d, bleu-violet #3b2d8f — marqués [ESTIMÉ] dans
  `src/index.css` et utilisés comme directions, jamais comme valeurs certifiées. Nouvelles classes `.hero-sombre`
  (dégradé noir + halos rose/violet), `.titre-or` (serif, capitales espacées, doré — façon logo ASIAN HOUSE),
  `.surtitre-sombre`, `.puce-sombre`. Contrastes vérifiés par tests (WCAG, voir ci-dessous).
- **Où** : en-tête commerçant sombre (`src/App.tsx`, nom doré, onglet actif souligné or) ; héros sombres des pages
  publiques `#/jouer` (logo + titre or + panneau roue sombre) et `#/menu` ; `CarteFidelite` : bandeau dégradé
  noir → laque profonde, filet doré, « Carte de fidélité » en or clair, progression des tampons laque → or.
  Corps ivoire inchangé (lisibilité), navigation mobile inchangée, aucune régression des modules existants.
- **Vrai menu (`src/data/menu-reel.ts`, généré depuis `docs/menu-reel.json` par `/tmp/generer-menu-reel.mjs`)** :
  7 catégories, 39 plats, noms et descriptions exacts (Uber Eats, crawls 01/09 et 21/10/2026).
  **AUCUN PRIX VÉRIFIÉ** : les 39 plats sont à `prix: null` et s'affichent « Prix sur place » — jamais de montant
  inventé. Modèle changé en ce sens : `Produit.prix: number | null` (`src/types.ts`), `validerMenu` accepte null
  (et les photos locales `/visuels/…`, regex étendue), `formaterPrix(null)` = « Prix sur place »,
  éditeur commerçant : prix optionnel (vide = sur place). Aucun allergène indiqué nulle part (listes vides).
  Tiramisu : cité dans des avis, absent de la carte Uber Eats — affiché sans description inventée, à confirmer
  sur place. Mi Prat ← `menu-nouilles-crevettes.jpg` : identification PROBABLE (notée dans le code et la doc).
- **Mise en production du menu** : deux voies, sans PIN touché (PIN commerçant/admin inconnus de l'agent, jamais
  dans le dépôt). (1) **Repli public** : tant que le menu enregistré est vide, `#/menu` affiche la vraie carte
  (avec la mention honnête « les prix ne sont pas encore renseignés : ils sont affichés sur place ») ; dès que
  le commerçant enregistre son menu, c'est le sien qui s'affiche. (2) **Adoption commerçant** : bouton
  « Charger la vraie carte d'Asian Home (39 plats) » dans Menu → pré-remplit l'éditeur (photos incluses),
  le commerçant complète les prix et Enregistre (PIN habituel). Le menu reste modifiable depuis le dashboard.
  **Reste à faire côté utilisateur/parent** : ouvrir le Menu commerçant (PIN), charger la vraie carte, renseigner
  les prix relevés sur place, Enregistrer — ou laisser le repli public en place. Les prix ne peuvent pas être
  remplis par l'agent (aucun prix vérifié en ligne ; cf. docs/MENU-REEL.md).
- **Photos** : 6 nouvelles dans `public/visuels/` (commitées ici ; sources dans `SOURCES.md`, galerie lacarte.menu).
  Rattachements : `menu-makis.jpg` → 8 Maki Dragon / 8 Maki Tiger ; `menu-loc-lac.jpg` → Loc Lac ;
  `menu-nouilles-crevettes.jpg` → Mi Prat (probable) ; `menu-mango-sticky-rice.jpg` → Mango Stick ;
  `menu-plat-riz.jpg` → photo d'ambiance de la catégorie « Côté thaï » uniquement, jamais d'un plat nommé ;
  `interieur-salon.jpg` → section « Le restaurant » de `#/carte`. Catégories « Desserts » → mango sticky rice.
  `CartePublique` : lien « Voir le menu » visible pour Asian Home même sans menu enregistré (repli réel).
- **Interactivité (`src/pages/MenuPublic.tsx`)** : recherche de plat (nom + description, insensible aux accents/casse),
  filtres par catégorie (pilules, « Toutes » + 7), compteur de résultats, fiche plat au tap (photo grande,
  description, prix ou « Prix sur place », allergènes quand ils existent, badge ★ Signature sur Dynamite,
  Thaï-sty Krusty, Duo Love Bao, Loc Lac, 8 Maki Dragon, 8 Maki Tiger), animations sobres existantes conservées
  (apparition, progression des tampons, rotation de la roue). Touch targets ≥ 44 px, pas de débordement (max-w-md).
- **Tests** : `tests/menu-reel.test.ts` (+13) — exactitude vs JSON (7/39, noms, descriptions, Tiramisu sans
  description), aucun prix (39 × null, « Prix sur place »), photos existantes ≤ 250 Ko et bien rattachées,
  menu-plat-riz jamais sur un plat nommé, signatures, recherche/filtres, contrastes ≥ 4,5:1
  (blanc/noir, or/noir, or clair/noir, blanc/laque, laque foncée/ivoire, encre/or clair, amber-800/blanc et /amber-100) ;
  `tests/cartiz.test.ts` (+1) : PUT menu à prix null → GET public relit null + photo locale, URL hors /visuels/ refusée ;
  `tests/visuels.test.ts` : catégories thaï/desserts illustrées. `npm test` **235/235**, `npm run build` OK.
- **Vérification locale avant push** : `vite preview` : accueil 200, 12/12 photos 200 ; serveur local SQLite
  (base temporaire, PIN dev 1234) : PUT menu réel 200 → GET public 7 catégories / 39 plats, prix tous null,
  5 photos rattachées, front servi 200, photo 200. Le rendu 390 px réel sur téléphone reste non vérifié
  (aucun navigateur sur la VM).
- **Déploiement** : push master `3ba8f8a` → Render auto-déploie ; vérifié en ligne ~06h54 : /sante
  (production / supabase / demo false, migrations cartiz + programme true), accueil 200, nouveau bundle
  `index-BTQW53Pc.js` servi (contient la vraie carte : « Thaï-sty Krusty », « 8 Maki Dragon », « Prix sur place »),
  CSS avec `.hero-sombre`, 6/6 nouvelles photos 200. Le menu enregistré en base reste vide (GET /menu :
  0 catégorie) — c'est le repli public qui affiche les 39 plats sur #/menu en attendant que le commerçant
  enregistre son menu avec les prix. Rendu visuel réel à 390 px sur téléphone non vérifié (pas de navigateur
  sur la VM) : le repli et l'interactivité sont couverts par les tests + le serveur local, pas par un rendu.

## 10/11/2026 — Brancher Brevo (SMS + e-mail, lot « Brancher Brevo »)
- **Fournisseur choisi : Brevo** (SMS + e-mail, une seule clé API). L'adaptateur e-mail existait déjà
  (`server/notifications/brevo.ts`, `v3/smtp/email`) et était bien branché de bout en bout (route relance →
  journal `envois` → `/sante email`) : vérifié, rien à corriger de ce côté.
- **SMS via Brevo (nouveau)** : `adaptateurBrevoSms` (`server/notifications/brevo.ts`) —
  `POST https://api.brevo.com/v3/transactionalSMS/send` (route actuelle de la doc Brevo, lue le 10/11/2026 ;
  l'ancienne `/v3/transactionalSMS/sms` nommée dans le brief est dépréciée), corps
  `{ sender, recipient, content, type: 'transactional', tag: 'fidelite' }`, réponse `{ messageId: <nombre> }`.
  Variables : `BREVO_API_KEY` (même clé que l'e-mail) + `BREVO_SMS_SENDER` (ex. `ASIANHOME`, alphanumérique
  1–11 car. ou numérique 12–15 chiffres, validé par `expediteurSmsValide` ; invalide = SMS non configuré, 501).
- **Priorité SMS** (`server/notifications/index.ts`) : Brevo SMS si configuré, sinon Twilio en repli, sinon 501.
  `configDepuisEnv` lit les 4 variables Brevo. Nouveau `prestataire(canal)` ; `/sante` renvoie en plus
  `smsPrestataire: 'Brevo' | 'Twilio'` quand le SMS est configuré (la page de confidentialité nomme ainsi le
  bon sous-traitant : `src/lib/rgpd.ts`, `src/pages/Confidentialite.tsx`).
- **STOP** : la mention STOP en fin de SMS fait basculer le message en `marketing` côté Brevo (doc Brevo) ;
  avec un expéditeur alphanumérique le client ne peut pas répondre au SMS — pas de webhook Brevo branché,
  la route `stop-sms` répond 501 explicite quand les SMS partent via Brevo (Twilio inchangé). Le consentement
  de l'app reste la source de vérité (retrait sur la fiche client, lien de désinscription des e-mails, ou
  auprès du commerçant). Limite documentée dans `docs/BREVO.md` §6 et `server/README.md`.
- **Textes du front mis à jour** (`src/lib/integrations.ts` : `MENTION_ENVOI`, `etatRelances`,
  `MENTIONS_RGPD` ; `src/lib/rgpd.ts` : page de confidentialité ; `src/pages/Messages.tsx`,
  `src/pages/Plus.tsx`) : Brevo nommé pour les SMS, Twilio en repli ; désinscription par « réponse STOP au SMS
  quand il vient d'un numéro ».
- **Docs** : `docs/BREVO.md` (compte gratuit, clé API, validation de l'expéditeur e-mail, expéditeur SMS,
  coûts relevés le 10/11/2026 — e-mail gratuit 300/j, SMS France ~0,045 € HT à confirmer sur la page tarifs —,
  4 variables Render exactes, procédure de test : e-mail de bienvenue vers yassbybibiche@gmail.com, journal des
  envois, `/sante`, dépannage) ; `server/README.md` (§ « SMS / e-mail », variables, routes `/cartes/retrouver`,
  `/stop-sms`, `/sante`) ; `.env.example` (bloc Brevo commenté). `render.yaml` **non touché** (secrets posés à
  la main dans Render).
- **Mode test (consigne du 10/11/2026 ~22h14 : AUCUN envoi réel pendant le développement)** : `BREVO_MODE_TEST=1`
  — e-mail en sandbox Brevo (`X-Sib-Sandbox: drop`, doc « Using sandbox mode » lue le 10/11/2026 : 201 +
  `messageId`, rien livré, rien journalisé chez Brevo), SMS simulé (Brevo ne propose pas de sandbox SMS :
  aucun appel réseau), Twilio simulé lui aussi (aucun vrai SMS par la porte de derrière). Journal des envois
  avec le nouveau statut `test` (« Test — rien envoyé », `src/types.ts`, `libelleStatutEnvoi`), route relance →
  200 `{ envoye: false, test: true }`, `/sante` → `integrations.modeTest: true`, écran Messages : ligne
  « Mode test Brevo actif », fiche client : annonce « ✓ Mode test — rien envoyé », avertissement au démarrage
  du serveur. La simulation n'occupe pas le créneau anti-doublon du jour (index partiel sur `en_cours` /
  `envoye`, vérifié par un test qui a d'abord échoué sur l'hypothèse inverse) : un vrai envoi reste possible
  le même jour une fois le mode test coupé. Tests : `tests/brevo-sms.test.ts` (sandbox, simulation, config),
  `tests/relances-p1-b3.test.ts` (describe « Mode test Brevo » : SMS simulé, e-mail sandbox, repli Twilio
  simulé, tournée auto simulée, `/sante`), `tests/relances-ui-p1-b3.test.ts` (ligne mode test, libellé).
- **Règles dures respectées** : aucun envoi sans consentement, **aucun envoi réel du tout (ni SMS, ni e-mail,
  même pas l'e-mail de test à yassbybibiche@gmail.com)**, aucun secret dans le code ni dans Git, aucun appel
  réseau réel dans les tests (`fetch` injecté), tirage serveur et « 1 tirage/jour après visite validée » intacts
  (suite complète verte).
- **Tests** : `tests/brevo-sms.test.ts` (nouveau, 7 tests : config, expéditeur, requête, `messageId` numérique,
  erreurs, priorité Brevo > Twilio) + 4 tests de bout en bout dans `tests/relances-p1-b3.test.ts` (relance SMS
  Brevo, priorité, repli Twilio, erreur 502, `stop-sms` 501 Brevo, `/sante`) + mises à jour
  (`integrations-v3`, `relances-ui-p1-b3`, `rgpd-p1-b6`). `npm test` **798/798** (788 avant, +10),
  `npx tsc -p .` propre, `npm run build` OK.
- **Vérification locale avant push** : serveur local avec fausses variables Brevo → `/sante`
  `integrations { sms: true, email: true, smsPrestataire: 'Brevo' }`, migrations toutes `true`.
- **Non vérifié** : aucun envoi réel (aucun compte Brevo, aucune clé) ; appel direct à `api.brevo.com`
  depuis la VM impossible (timeout réseau sortant, 60 s) — la route `/transactionalSMS/send` et le sandbox
  e-mail viennent de la doc officielle Brevo lue le 10/11/2026, pas d'un appel réel. **Reste à faire côté
  navigateur** : compte Brevo, clé API, validation de l'expéditeur e-mail, achat de crédits SMS,
  5 variables Render (dont `BREVO_MODE_TEST=1` tant que la consigne « mode test uniquement » s'applique),
  vérification en mode test (voir `docs/BREVO.md` §5 A). Le test d'envoi réel se fera plus tard, hors
  développement, avec l'accord explicite de l'utilisateur (`docs/BREVO.md` §5 B).

## 11/11/2026 — P0-S21 : contrôle TypeScript du serveur (AUDIT.md § P0-S21, revue Codex point 13)
- **Constat** : `tsconfig.json` n'inclut que `src/` ; `server/` (~4 600 lignes) n'était jamais vérifié par `tsc`
  (Node et `npm test` suppriment les types sans les contrôler).
- **Config** : nouveau `tsconfig.server.json`, qui étend `tsconfig.json` et ne change que `types: ["node"]` (au lieu
  de `vite/client`), `lib: ["ES2022"]` (sans DOM : le serveur n'en a pas besoin, `fetch` / `URL` / `Response` /
  `Buffer` viennent de `@types/node`, aucun conflit) et `include: ["server"]`. Les fichiers partagés importés
  (`src/types.ts`, `src/lib/*.ts`, `src/data/*`, `seed.json`) sont vérifiés au passage, sans DOM : ils passent.
  **Aucune règle assouplie** : `strict`, `noUnusedLocals`, `noUnusedParameters` gardés. `tsconfig.json` et le
  script `build` inchangés.
- **Dépendance** : `@types/node` `^24.19.2` en `devDependencies` (`npm install --save-dev @types/node@^24`, réseau OK).
- **Script** : `npm run typecheck:server` (= `tsc -p tsconfig.server.json`).
- **Erreurs trouvées : 2**, toutes deux `TS2345` dans `server/app.ts` (routes `POST …/clients` et `POST …/tirages`) :
  `corps.parrain` (`unknown`, corps JSON non validé) passé au paramètre `parrainCode?: string` de
  `inscrireOuRetrouver`. **Pas un vrai bug** : la fonction teste déjà `typeof parrainCode === 'string'` avant
  usage (une valeur non-chaîne est ignorée). Correction de type seule : paramètre élargi à `parrainCode?: unknown`,
  comportement identique. Aucune erreur dans `server/notifications/` (fichiers Brevo non touchés).
- **Qualité** : `npm test` 806/806 (806 avant, aucun test ajouté ni modifié), `npm run build` OK,
  `npm run typecheck:server` propre (et il échoue bien sur les 2 erreurs avant correction).
- **Limites** : la vérification n'est pas branchée dans `npm run build` / `build:api` (build Render) — décision
  volontaire, à trancher à la fusion ; `tests/`, `scripts/` et `tests-e2e/` ne sont toujours pas vérifiés par `tsc`.
- **Revue Codex du code (11/11/2026, `/tmp/codex-revue-p0-s21.txt`)** : aucun bug fonctionnel introduit ;
  2 remarques, toutes deux traitées : [P2] contrôle facultatif → `typecheck:server` branché dans `npm test`
  (il tourne avant les tests, ~1 s, et fait échouer `npm test` en cas d'erreur de type serveur) ; [P3] ligne
  obsolète de `server/README.md` (§ Limites honnêtes) affirmant que le serveur n'était pas vérifié par `tsc` →
  corrigée. Le `build` Render n'est pas touché (choix explicite, voir ci-dessus).

## 11/11/2026 — P0-S5 : sauvegarde complète de la base (Supabase Free n'en fait aucune)
- **Constat** : Supabase Free = aucune sauvegarde ; une perte de base = perte de tous les clients / tampons / tirages.
  Accès disponibles : `SUPABASE_URL` + clé service_role (PostgREST) ; pas de mot de passe Postgres, pas de `pg_dump`,
  pas d'accès réseau à la production depuis la VM.
- **Fait** : `server/sauvegarde.ts` (logique pure : 14 tables dans l'ordre des clés étrangères avec clé de conflit,
  export qui ÉCHOUE si une table manque, validation, restauration qui refuse un fichier incomplet, adaptateurs SQL
  lecture / upsert via `jsonb_populate_recordset`, AES-256-GCM avec clé de fichier HKDF + sel + IV aléatoires,
  rétention pure) ; `scripts/sauvegarde-base.mjs` (PostgREST paginé par 1 000, compteur exact vérifié à chaque page, gzip, chiffrement si clé, écriture
  `.tmp` unique puis lien atomique, rétention, `SAUVEGARDE OK` / `ERREUR SAUVEGARDE` + sortie 1, aucun secret affiché) ;
  `scripts/restaurer-base.mjs` (PGlite seulement, migrations 0001–0008 sans `.down.sql`, une transaction, base cible
  vide exigée, `--verifier` ; toute cible Supabase / Postgres refusée sans afficher le DSN). Le `.mjs` importe
  directement le `.ts` (type-stripping Node 24) : vérifié, pas de duplication. `npm run sauvegarde` / `npm run restaurer`.- **Choix RLS** : rôles Supabase recréés avant les migrations (comme `tests/migration-pglite.test.ts`), restauration en
  propriétaire des tables (non filtré par la RLS, aucune table en FORCE) → rien à désactiver. Colonnes `ordre` (identity)
  réinsérées telles quelles (OVERRIDING SYSTEM VALUE) puis séquence recalée.
- **Tests** : `tests/sauvegarde-p0-s5.test.ts`, **21 tests** — export depuis une PGlite remplie (≥ 1 ligne dans les
  14 tables) → restauration dans une 2e PGlite → compteurs égaux, client / tirage / avis identiques, relecture
  complète identique ligne à ligne ; base restaurée fonctionnelle (ordre, 1 tirage/jour) ; table absente → erreur nommée
  (export et restauration) ; chiffrement (aller-retour, mauvaise clé, altération, clé invalide) ; rétention (limites) ;
  CLI de bout en bout contre un faux PostgREST local (1 501 lignes de journal → pagination, chiffré, puis
  `restaurer-base.mjs --verifier`), `--aide`, variables absentes, table absente → aucun fichier, rétention sur disque.
  `npm test` **827/827** (806 avant, +21), typecheck serveur inclus, `npm run build` OK.
- **Revue Codex (6 points, tous corrigés, +3 tests → 830/830)** : [P1] export tronqué si le plafond PostgREST est
  < 1 000 → chaque page demande désormais le compteur exact (`count: 'exact'`) et l'export est refusé si le total lu
  diffère du compteur ; [P1] ligne perdue par pagination par décalage si suppression concurrente → même compteur
  vérifié à chaque page (il doit rester identique, sinon refus) + doc corrigée (l'affirmation « la restauration
  échoue bruyamment, jamais en silence » surestimait les contraintes : une ligne supprimée entre deux pages ne
  viole aucune clé étrangère) ; [P1] procédure de restauration Supabase (§ 8) cassée par les apostrophes
  (`'<JSON>'`) → JSON collé entre délimiteurs dollar `$sauvegarde$…$sauvegarde$` ; [P2] `--verifier` après commit →
  recompte désormais DANS la transaction (un écart annule la restauration) ; [P2] migrations rejouées avant le
  contrôle de cible vide → la cible déjà initialisée est refusée AVANT toute migration ; [P2] deux sauvegardes
  dans la même seconde → écriture `.tmp` unique par processus + lien atomique (`linkSync`, EEXIST = refus explicite).
- **RPO / RTO** : RPO 24 h si sauvegarde quotidienne (lancée par l'opérateur : rien n'est planifié par ce lot) ;
  RTO estimé 1–2 h (restauration manuelle vers Supabase, `docs/SAUVEGARDE.md` § 8). Rétention 30 jours / 30 fichiers.
- **Limites** : jamais exécuté contre la vraie base (consigne + pas d'accès réseau) ; PostgREST ne donne pas
  d'instantané cohérent entre tables (sauvegarder restaurant fermé ; une écriture concurrente est détectée par le
  compteur exact et fait refuser l'export, jamais de fichier tronqué) ; schéma / RLS / config Supabase non sauvegardés (source = migrations) ; restauration validée sur PGlite
  seulement, pas sur un projet Supabase ; pas d'alerte automatique d'échec ; copie hors VM à faire par l'opérateur.
- **Décisions en attente (utilisateur)** : Supabase Pro 25 $/mois (sauvegardes quotidiennes 7 j) non acheté ;
  mot de passe Postgres pour un `pg_dump` en complément ; planification + copie hors VM ; exercice de restauration
  réelle sur un projet Supabase de test. Docs : `docs/SAUVEGARDE.md`, `server/README.md` § Sauvegarde / export,
  `.env.example` (variables `SAUVEGARDE_*` commentées : `tests/supabase.test.ts` n'y autorise que 2 variables actives).

## 11/11/2026 — P0-S7 : authentification client élargie (AUDIT.md § P0-S7, revue Codex points 4 et 5, audit F-03)
- **Constat** : l'identifiant d'une carte (`cl-<horodatage base36>-<4 car.>`, `src/lib/fidelite.ts`) suffisait à la
  lire en entier (messages, historique), à la modifier (prénom, profil, rattrapage, lus, message privé, demande de
  suppression avec le contact) ; le téléphone seul suffisait à reprendre la carte (inscription publique → carte
  existante renvoyée) et à jouer à la place du client (`POST /tirages` avec le contact → code gagnant).
- **Mécanisme retenu** : jeton client signé HMAC, même format et même `SESSION_SECRET` que les sessions P0-S1, contenu
  `{ typ, jti, cid, com, ver, exp }` (`typ` ≠ `role` : jamais confondu avec une session). En-tête
  `Authorization: Bearer`. 30 jours, renouvelé par la page sous 15 jours. 1re preuve = le téléphone qui s'inscrit (le
  serveur tire l'identifiant et renvoie le jeton de la NOUVELLE carte) ; preuves de remplacement sans SMS : **lien
  d'accès à usage unique** montré en QR au comptoir (fiche client, 15 min, journalisé) ou envoyé par « Retrouver ma
  carte » quand un prestataire est branché (24 h). Révocation : version d'accès par carte dans `meta`
  (`acces_client:<commerce>:<client>`), incrémentée par le client (« Déconnecter tous mes appareils ») ou le gérant ;
  usage unique des liens par `sessions_revoquees` (0005). Choix `meta` plutôt qu'une table : rien de neuf à
  sauvegarder (14 tables), lisible par service_role seul, supprimée avec la carte (RGPD).
- **Périmètre couvert** (mode strict) : vue complète de `GET /cartes/:id` (sans jeton : vue limitée = tampons + jeu du
  jour ; `codeDuJour` inchangé, P0-S19 pourra s'appuyer sur `acces.jeton`), lus, profil, rattrapage (client), prénom,
  message privé, données / suppression RGPD (jeton ET contact), tirage (le joueur = la carte du jeton, contact du
  corps ignoré ; « 1 tirage / jour après visite validée » inchangé, testé), inscription d'un contact existant (409
  sans carte ni identifiant, rien de modifié, aucun doublon), récupération (202 identique, lien d'accès seulement dans
  le message au titulaire), liens courts `/c/<id>` (vue limitée ; `?a=` transmis). 401 uniforme que la carte existe
  ou non ; échecs comptés dans `tentatives_auth` (portée `client`, clé `client-ip:<ip>`, 30 → blocage, séparé des PIN).
- **Identifiants** : `cl-` + UUID v4 (`nouvelIdClient`, repli `getRandomValues` hors contexte sécurisé). Anciennes
  cartes NON réécrites (aucune donnée modifiée) : **grâce jusqu'au 10/02/2027 00:00 Paris**
  (`GRACE_ANCIENS_ID_JUSQU_AU`, 90 j après un déploiement supposé le 12/11/2026 — à décaler s'il glisse) : l'ancien
  lien seul ouvre la vue limitée et donne un jeton (la page le demande seule, une fois par affichage), bandeau sur la
  carte ; après, ancien lien seul → 404 comme une carte inconnue (un jeton déjà obtenu reste valable).
- **Migration 0009** (`0009_auth_client.sql` + `.down.sql`) : contrainte `tentatives_auth.portee` élargie à `client`,
  marqueur `auth_client_active()` (service_role seul) lu par `GET /sante/acces-client` ; RLS / revoke / grant comme
  0005–0008. Testée aller / retour / rejeu sur PGlite. Sans elle : échecs client comptés en mémoire (comme sans 0006).
  À appliquer APRÈS une sauvegarde (`scripts/sauvegarde-base.mjs`, documenté, **non exécuté**).
- **Modes** (`AUTH_CLIENT`, `server/index.ts`) : `stricte` par défaut en production **si `SESSION_SECRET` existe**,
  sinon `transition` avec avertissement ; `creerServeur` sans option = `transition` (jetons émis et vérifiés, accès
  d'avant P0-S7 admis et compté dans `GET /sante/acces-client`). **Pourquoi ce défaut** : les suites existantes
  (≈ 15 fichiers : tirage par contact seul, réinscription publique qui renvoie la carte, lecture par identifiant)
  encodent exactement le comportement que le lot supprime, et la consigne interdit de modifier un test existant ;
  elles tournent donc en mode transition (inchangées et vertes), le mode strict est couvert par les nouveaux tests et
  par l'E2E. À trancher par l'orchestrateur : basculer ces suites en strict (modifier leurs appels) puis rendre
  `stricte` le défaut de `creerServeur`.
- **Front** : `src/lib/jetonCarte.ts` (jeton rangé par carte, expiration, repli mémoire), `avecJetonClient` /
  `assurerJetonClient` (`src/data/jeuApi.ts`) : la page de jeu et la carte appellent l'API au travers d'une API qui
  ajoute le jeton (les lignes `lancerTirage(api, …)` / `api.prenomCarte(…)` figées par `entree-qr-p1-c1` restent
  identiques). Carte : vue limitée, échange du `?acces=` puis retrait de l'adresse, bandeau de grâce, « Sécurité de
  ma carte ». Fiche client (gérant) : « Afficher le QR d'accès à sa carte », « Révoquer tous ses accès… ». Journal :
  action `acces`. Chaînes client traduites (EN).
- **Tests** : avant **830/830**. Après : **863/863** — `+33` dans `tests/auth-client-p0-s7.test.ts`
  (refus sans preuve uniforme, preuve OK, expirée, falsifiée / autre carte / autre commerce / lien en Bearer, révoquée
  par le client puis le commerce, lien comptoir 15 min / usage unique, renouvellement, ancien lien pendant puis après
  la grâce, contact existant sans reprise, tirage sans / avec jeton et 1 / jour, récupération sans oracle avec lien
  d'accès, 30 échecs → 429 persistant au redémarrage, énumération, mode transition, strict sans secret refusé,
  migration 0009 PGlite aller / retour / rejeu / droits, stockage Supabase sans / avec 0009, logique front).
  **Le KO** : `tests/sauvegarde-p0-s5.test.ts:95` fige la liste des migrations à `0001…0008` ; toute migration 0009
  (exigée par le brief) le fait échouer, et aucun changement de code applicatif ne peut le satisfaire sans exclure
  la 0009 de la restauration (ce qui serait un vrai bug). **Corrigé après le commit principal, commit séparé
  « P0-S7 — Revue : liste des migrations du test de sauvegarde étendue à 0009 »** : la liste figée est un
  inventaire des migrations existantes, pas une assertion de comportement — l'ajout de `'0009'` la met à jour
  avec l'inventaire réel (la restauration couvre bien la 0009, vérifié par le test lui-même). `npm test` repassé
  vert **863/863** après cette ligne.
  `/sante` a ses clés figées (`securite-s1`) → état de l'accès client sur `GET /sante/acces-client` ; la ligne
  « hors ligne » de `CartePublique` est figée (`chargement-p0-u1`) → gardée telle quelle.
- **E2E** (`npm run test:e2e`, Chromium) : **2/2**. `tests-e2e/serveur.ts` passe en `authClient: 'stricte'` (helper,
  rendu plus exigeant, pas plus permissif) : le parcours existant scan → inscription → visite → tirage → gain → carte
  passe avec le jeton obtenu par la page. Nouveau `tests-e2e/acces-carte-p0-s7.spec.ts` (vue limitée sur un autre
  appareil, QR d'accès → carte complète, lien retiré de l'adresse, 2e usage refusé) — il a trouvé un vrai défaut,
  corrigé : un `?acces=` arrivé sur une carte déjà ouverte (même onglet) n'était pas lu.
- **Vérifications** : `npm test` (typecheck serveur inclus) **863/863** après correction du pin (862/863 avant),
  `npx tsc -p .` OK, `npm run build` OK, E2E 2/2.
- **Non vérifié / limites** : rien contre Supabase réel (0009 non appliquée, PGlite seulement) ni en production ;
  aucun SMS / e-mail réel ; `SESSION_SECRET` présent sur Render **non vérifié** — absent, la production resterait en
  `transition` (avertissement au démarrage) : à vérifier avant de compter sur P0-S7 ; la caisse (code équipe) peut
  appeler la route du QR d'accès mais seul l'écran fiche client (gérant) a le bouton ; l'inscription révèle toujours
  qu'un contact a une carte dans CE commerce (409), sans code à usage unique (prestataire SMS / e-mail non branché) ;
  un jeton volé sur le téléphone reste valable jusqu'à révocation / expiration ; deux échanges simultanés du même lien
  d'accès peuvent tous deux réussir (fenêtre de quelques ms) — **corrigé ci-dessous (revue Codex, point 2)** ; rendu
  de la vue limitée vérifié dans Chromium seulement (pas sur un vrai téléphone).
- **Revue Codex (5 points, tous fondés, tous corrigés)** :
  1. *[P1] Révocation contournée pendant la grâce* — `POST /cartes/:id/jeton` sans preuve délivrait un jeton à la
     nouvelle version d'une ancienne carte révoquée. Correction (`server/app.ts`) : la branche « grâce » refuse (401
     uniforme) dès que la version d'accès de la carte est > 0 ; une carte révoquée ne se rouvre que par un lien d'accès
     (comptoir, « Retrouver ma carte »). `server/README.md` mis à jour.
  2. *[P1] Lien à usage unique échangeable deux fois en concurrence* — `estRevoquee` et `revoquer` séparés par des
     `await`. Correction : `reserverPendant` (exportée, `server/app.ts`) — `Set` des `jti` en cours d'échange, testé
     et marqué de façon synchrone avant le 1er `await`, libéré en `finally` ; 2e échange concurrent → 401. La révocation
     en base reste la garde durable. Limite documentée (`server/README.md`) : une seule instance (Render) ; à plusieurs
     instances, il faudrait une consommation atomique en base. NB : avec SQLite, la course ne se produit pas (tout se
     résout en microtâches) — elle demande la latence réseau de Supabase ; elle est donc reproduite par un test
     unitaire à stockage lent (échoue sans réservation : les deux échanges passent), plus un test HTTP 4 × concurrent.
  3. *[P1] Carte récupérée : impossible de rejouer* — la page de jeu ne connaissait pas la carte récupérée → ressaisie
     du contact → 409. Correction : `memoriserJoueurCarte` (`src/data/jeuApi.ts`), appelée par `CartePublique` quand
     la carte s'affiche EN ENTIER avec le jeton de ce téléphone : elle devient le joueur mémorisé de son commerce
     (contact vide — le serveur ne le lit plus quand le jeton est là ; la dernière carte ouverte ainsi l'emporte,
     « Ce n'est pas moi » reste possible). Le tirage passe par l'API enveloppée existante (`avecJetonClient`) : lignes
     figées de `Jouer.tsx` (`lancerTirage(api, commerce, joueur.contact, joueur.prenom)`) inchangées.
  4. *[P2] Jeton expiré : roue puis 401 sans issue* — `lancerTirage` signale `accesRefuse` sur 401 (champ ajouté
     seulement dans ce cas : le `deepEqual` de `front-v2` reste vrai) ; `Jouer` oublie le jeton et affiche
     `AccesCartePerdu` (message clair + lien « Retrouver ma carte » vers `#/carte/<id>`, dont la vue limitée porte le
     formulaire). Chaînes traduites (EN). Serveur inchangé (401 reste 401).
  5. *[P2] QR d'accès non régénérable* — `FicheClient.tsx` : bouton « Générer un nouveau lien d'accès » sous le QR
     affiché. Choix documenté dans le code : l'ancien lien n'est pas révoqué (le serveur ne sait révoquer que la carte
     entière), il reste à usage unique et expire à 15 min.
- **Tests revue Codex** : avant **863/863** (+ E2E 2/2). Après : **870/870** (`npm test`, typecheck serveur inclus) —
  `+7` dans `tests/auth-client-p0-s7.test.ts` (« P0-S7 — revue Codex ») : grâce perdue après révocation client puis
  commerce (vérifié en échec sans la correction : 201 au lieu de 401) ; réservation synchrone à stockage lent ; 4
  échanges HTTP simultanés → 1 seul 201 ; parcours QR comptoir → mémorisation → tirage 201 sans réinscription ;
  règles de `memoriserJoueurCarte` ; jeton expiré → 401 + `accesRefuse` ; lecture du code (Jouer / FicheClient).
  E2E **3/3** : nouveau test dans `tests-e2e/acces-carte-p0-s7.spec.ts` (QR du comptoir sur un nouveau téléphone →
  « Tourner la roue du jour » → « Continuer avec ma carte » → gain ; puis accès retiré par le commerce → message
  « Votre carte n'est plus ouverte sur ce téléphone » + « Retrouver ma carte ») — vérifié en échec sans la correction
  du point 3 (timeout sur « Continuer »). Aucun test existant modifié. `npx tsc -p .` OK, `npm run build` OK.
  Un `npm test` intermédiaire a eu 1 échec sur `avis-google-p1-b4` (« règle auto 4★ », 7,4 s, sans lien avec ce lot) :
  28/28 seul, puis 870/870 sur deux exécutions complètes → instabilité de charge, pas une régression.
- **Non vérifié (revue Codex)** : la course du point 2 contre un vrai Supabase (simulée par stockage lent) ; le cas
  multi-instance ; le bouton de la fiche client n'est vérifié que par lecture de code (pas d'E2E du back-office).

## 11/11/2026 — P0-S11 : atomicité des écritures Supabase (AUDIT.md § P0-S11, audit F-10, revue Codex points 1 et 12)
- **Mécanisme retenu : compensation, pas transaction.** PostgREST n'a pas de transaction multi-requêtes ; une fonction
  RPC transactionnelle générique a été écartée (toute la logique métier réécrite en PL/pgSQL = double implémentation,
  risque de divergence avec `src/lib/`, aucun gain sur les conflits observés, qui sont des simultanéités déjà
  tranchables par la base). Détail : `server/README.md` « Atomicité (P0-S11) » et en-tête de `server/stockage-supabase.ts`.
- **A. Verrou optimiste sur `majCommerce`** : `commerces()` / `commerce()` lisent `id,version,donnees` (la version est
  mémorisée dans la transaction en cours), `majVersionnee` généralisée à `commerces`. Route PATCH /commerces/:id : le
  commerce est relu DANS la transaction avant `appliquerReglages` (même comportement : réglages + règles réappliquées
  aux avis en attente, dans la même transaction). Logo PUT / DELETE : `majCommerce` dans une transaction avec relecture
  fraîche ; ordre inchangé (PUT : fichier puis adresse ; DELETE : adresse puis fichier). Hors transaction : écriture
  inconditionnelle (inchangé). SQLite : rien de changé (BEGIN IMMEDIATE + file d'attente) — documenté dans `stockage.ts`.
- **B. Journal jamais perdu en silence** : `ajouterJournal`, `ajouterParrainage`, `ajouterDemandeRattrapage` ne font
  plus `console.warn` + continuer ; `ErreurMigrationManquante` remonte. `creerServeur` (après `initialiser`, qui ne
  journalise rien) refuse de démarrer sous Supabase sans `0003_cartiz.sql` ou `0004_programme.sql` : message nommant
  la migration et `scripts/sauvegarde-base.mjs`. Pas de garde sous SQLite. Aucune autre suite n'utilise
  `sans0003` / `sans0004` (grep `tests/`) ; les tests P0-U3 (sans0005 / sans0006) restent verts.
- **Écart au brief (ajout)** : l'ordre « métier puis journal » à documenter n'était PAS respecté partout. Corrigé :
  `reglerParrainage` écrivait le parrain, son journal et la trace 0004 AVANT le filleul — un conflit (409) sur le
  filleul laissait le parrain crédité, et un nouvel essai pouvait le créditer une 2e fois. Il renvoie maintenant
  `ecrire()`, appelé après l'écriture du filleul (visite, caisse, rattrapage). La caisse écrivait le journal
  « parrainage » avant le client, et la décision de rattrapage son journal avant le client : remis après.
  Pas de test dédié à cet ordre (l'entrelacement fautif n'est pas reproductible de façon déterministe avec la barrière
  du faux PostgREST) ; les tests de parrainage existants restent verts.
- **C. Aucune migration** : `version` + trigger `incrementer_version` (0001, recréés par la 0003), `journal` (0003),
  index unique des tirages (0001). Liste figée 0001…0009 du test de sauvegarde inchangée.
- **Tests** : avant **870/870**. Après : **875/875** (`npm test`, typecheck serveur inclus), `npm run build` et
  `npx tsc -p .` OK. `+5` dans `tests/supabase.test.ts` : 2 PATCH simultanés → [200, 409] « réessayez », version
  initiale + 1, une seule valeur retenue, garde `version=eq.<lue>` dans les deux requêtes ; PATCH + PUT logo
  simultanés → jamais de mélange ; démarrage refusé sans 0003 (`/0003_cartiz/`) et sans 0004 (`/0004_programme/`),
  accepté sans 0005…0008 ; stockage seul : `majCommerce` conditionné dans une transaction / inconditionnel hors ;
  `ajouterJournal` sans 0003 et `ajouterParrainage` / `ajouterDemandeRattrapage` sans 0004 → ErreurMigrationManquante.
  Les 3 tests de verrou échouent sans le correctif (vérifié : verrou retiré → 3 échecs ; relecture dans la transaction
  retirée → le test PATCH échoue). Écart : la barrière est posée sur les **PATCH** `commerces`, pas sur les GET comme
  suggéré — avant la lecture dans la transaction, la route lit déjà le commerce et le PIN, puis hache (scrypt) : une
  barrière GET ne rend pas le test déterministe ; la barrière PATCH garantit que les deux requêtes ont relu la même
  version avant d'écrire.
- **Deux tests existants mis à jour (justifiés en commentaire P0-S11)** : « production AVANT la migration 0003 » →
  le démarrage est désormais refusé (message `0003_cartiz.sql` + sauvegarde), la 2e partie (après migration : /sante
  `cartiz: true`) est gardée ; « suppression sans migrations » → ne garde que `sans0007` (le bilan reste identique).
  Non-régression citée (inchangés, verts) : double tirage simultané, double visite, double inscription, idempotence
  caisse (`actionId`, rejeu `dejaTraite`, journal length 2 dans le test Cartiz), remise de gain unique (P0-U3).
- **Ce qui reste non atomique** : suite d'écritures interrompue entre deux requêtes (panne réseau / crash) — réglages
  écrits puis échec sur un avis réévalué, filleul écrit mais parrain pas crédité ; une entrée de journal peut se perdre
  ainsi (jamais un journal mensonger). Hors périmètre : la route visite historique n'a pas de garde « 1 tampon / jour »
  (F-11, lot P1-S12) — deux visites séquentielles le même jour restent possibles.
- **Conséquence production** : si la base live n'a pas la 0003 ou la 0004, le prochain déploiement refusera de
  démarrer (en principe, Render garde alors l'ancienne version en ligne — non vérifié). À vérifier AVANT de déployer : `GET /api/v1/sante` →
  `migrations.cartiz` et `migrations.programme` à `true` ; sinon sauvegarde puis migrations. **Vérifié le 11/11/2026**
  (GET public `https://asian-home-fidelite.onrender.com/api/v1/sante`) : `cartiz: true`, `programme: true` → la garde
  ne bloquera pas le déploiement.
- **Non vérifié** : contre un vrai Postgres / Supabase (faux PostgREST seulement) ; le comportement de Render si un
  démarrage est refusé.

## 11/11/2026 — P0-S11 : correctif revue Codex (crédit parrain repris sur conflit, logo refusé restauré)
- **Point 1 [P1] — parrainage définitivement incomplet.** Depuis P0-S11 le filleul (`parrainagePaye: true`) est écrit
  avant le parrain. Deux premières visites simultanées de deux filleuls du même parrain : les deux filleuls passaient,
  un seul crédit parrain aussi — l'autre `majClient(parrain)` faisait 409, et aucun nouvel essai ne pouvait le réparer
  (`parrainageDu` renvoie null pour un filleul payé ; caisse `dejaTraite` ; rattrapage déjà traité). Correctif dans
  `reglerParrainage().ecrire()` : sur `ErreurConflit` du seul crédit parrain, une reprise — parrain relu frais
  (`st.client`, nouvelle version mémorisée dans la transaction), `parrainageDu` recalculé, texte + trace reconstruits,
  crédit + journal + trace réécrits. Toute autre erreur remonte sans reprise ; un crédit réussi n'est jamais rejoué.
  Parrain disparu → erreur d'origine ; plafond atteint entre-temps → pas de crédit, trace `pointsParrain: 0`. Ordre
  filleul-puis-parrain inchangé. Le texte du journal du passage (côté filleul, déjà calculé) n'est pas recalculé.
- **Point 2 [P2] — logo refusé mais image remplacée.** `ecrireLogo` remplaçait les octets avant l'UPDATE conditionnel :
  un PUT en 409 laissait la nouvelle image derrière l'ancienne adresse. Correctif (PUT seulement) : instantané
  `lireLogo` avant l'écriture ; en cas d'échec de la transaction, restauration au mieux si le logo stocké a encore la
  `version` de cet envoi (try/catch interne qui ne masque jamais l'erreur d'origine), puis l'erreur remonte.
- **Tests** : avant **875/875**, après **876/876** (`npm test`), `npm run build` et `npx tsc -p .` OK. `+1` test
  (`tests/supabase.test.ts`) : deux filleuls du même parrain, premières visites simultanées (barrière PATCH `clients`)
  → [200, 200], parrain à 50 + 50 + 50, 2 `parrainagesGagnes`, 2 traces `parrainages` à 50, 2 journaux « parrainage »
  du parrain, filleuls `parrainagePaye`. Test de course PATCH + PUT logo renforcé : 404 avant la course ; après, GET
  brut du logo → 200 + octets identiques si le PUT a gagné, 404 et `meta` vide s'il a reçu 409. Vérifié : reprise
  retirée → le nouveau test échoue ([200, 409]) ; restauration retirée → le test logo échoue (6/6 exécutions, le PUT
  perd la course de façon stable avec la barrière).
- **Résiduels** (documentés dans `server/README.md` § Atomicité) : deux conflits successifs sur le parrain dans la même
  requête → 409, filleul payé, crédit parrain perdu (à corriger à la main) ; deux envois de logo simultanés d'images
  différentes → un seul gagne l'adresse, octets cohérents sauf entrelacement extrême entre vérification et restauration.
  Non couverts par un test : le cas « plafond atteint pendant la reprise », « parrain supprimé pendant la reprise » et
  le double conflit.

## 11/11/2026 — P0-S11 : 2e passe revue Codex (blobs logo versionnés, DELETE conditionnel, texte parrainage final)
- **Contexte.** Le correctif de la 1re passe a été commité entre-temps par le coordinateur (`d48be12`, déjà poussé).
  2e revue Codex du diff complet (`/tmp/codex-revue-p0-s11.txt`, 7 points). Incident d'outillage : `codex exec` restait
  bloqué sans sortie quand le prompt est passé en argument et stdin laissé ouvert (« Reading additional input from
  stdin... ») — relancé avec `< /dev/null`, réponse en 46 s. Leçon notée dans `AGENTS.md`.
- **Point 2 [P1] — deux PUT logo restauraient une image qui ne correspond pas au gagnant (CORRIGÉ).** Le correctif de
  la 1re passe ne demandait qu'un entrelacement extrême ; en fait deux PUT qui prennent le même instantané suffisent :
  le perdant restaure l'ancien logo derrière l'adresse du gagnant. Correctif : chaque envoi écrit un blob immuable
  `logo:<id>:<version>` en plus du pointeur ; le GET `?v=` sert le blob de CETTE version ; en cas de 409 le pointeur
  est remis sur l'image que l'adresse désigne (ancienne si un PATCH a gagné, celle du PUT gagnant sinon, lue dans son
  blob) ; le blob de l'envoi refusé est supprimé au mieux s'il n'est désigné par aucune adresse ; le blob remplacé est
  nettoyé au mieux après un PUT accepté. Le GET sans version sert le pointeur, ou à défaut l'image désignée par la
  fiche du commerce.
- **Point 3 [P1] — DELETE logo pouvait effacer un PUT pourtant réussi (CORRIGÉ).** Le DELETE vidait le fichier après
  l'UPDATE : un PUT arrivé entre-temps gagnait l'adresse puis voyait ses octets effacés. Correctif : l'adresse
  remplacée est lue DANS la transaction ; le pointeur n'est vidé que s'il contient encore cette image, et le blob
  correspondant n'est supprimé que si l'adresse courante ne le désigne plus.
- **Point 5 [P2] — journal de parrainage potentiellement mensonger après reprise (CORRIGÉ).** Si le parrain atteignait
  son plafond entre le calcul initial et la reprise, la trace était corrigée (0 point) mais le journal du passage
  gardait « +50 points pour le parrain ». Correctif : `ecrire()` renvoie le texte FINAL ; les 3 appelants (visite,
  caisse, rattrapage) l'utilisent pour le journal du passage et l'entrée « parrainage ».
- **Points 1, 4, 6 (DOCUMENTÉS, non corrigés).** 1 — double conflit parrain dans la même requête : déjà résiduel
  documenté, demande une reprise durable (hors périmètre). 4 — journal en panne après écriture métier (caisse
  `dejaTraite` sans trace, visite historique rejouée = 2e tampon) : demande un journal rejouable / boîte d'envoi,
  nouveau lot. 6 — PATCH réglages + avis partiels sous Supabase : même remède. Détail dans `server/README.md`
  § Atomicité (« Ce qui reste NON atomique »).
- **Tests** : avant **876/876**, après **879/879** (`npm test`, typecheck serveur inclus), `npx tsc -p .` OK. `+3` tests
  (`tests/supabase.test.ts`) : deux PUT logo simultanés d'images différentes (barrière GET `meta` pour forcer les deux
  instantanés) → [200, 409], adresse gagnante = octets gagnants (avec et sans `?v=`) ; PUT pendant un DELETE (effacement
  retardé par un `fetch` enveloppé) → l'envoi gagnant survit, 200 + octets identiques ; plafond 1 parrainage, deux
  filleuls simultanés → traces [0, 50], un journal de passage « +50 pour le parrain », l'autre « parrain au plafond
  annuel, rien pour ». Contrôles négatifs : sans les blobs versionnés, les 2 tests logo échouent (10/10 et 3/3) ;
  sans le texte final, le test plafond échoue (2 passages annoncent +50). Le test PUT/PUT avec la seule barrière PATCH
  ne discriminait pas l'ancien code (l'ancien `ancien` du perdant était déjà l'image gagnante) — d'où la barrière GET
  `meta`. Incident en cours de route : une édition a brièvement remplacé 3 lignes du test par du code serveur, réparée
  aussitôt (test relu, suite verte) ; un revert de contrôle négatif oublié a été détecté par `grep` et restauré depuis
  `/tmp/app.ts.fixed` avant la suite finale.
- **Résiduels** (documentés dans `server/README.md` § Atomicité) : suppression d'un blob orphelin = vérification puis
  écriture (un envoi des mêmes octets qui gagnerait exactement entre les deux laisserait une adresse sans blob,
  réparable par un nouvel envoi) ; blobs remplacés conservés en `meta` (une ligne par ancien logo). Le pointeur seul
  ne fait plus foi pour les lectures : le GET sans version se replie sur l'image désignée par la fiche.

## 11/11/2026 — P0-S14 : Vue caisse minimale (AUDIT.md §7, F-13)
- **Contexte.** `GET /caisse` renvoyait le commerce brut + tous les clients (tél/e-mail) + journal à n'importe quel
  membre de l'équipe. Désormais : sans `?q=`, aucun client ; avec `?q=`, seuls les clients correspondants, paginés
  côté serveur ; fiche client à la demande (scan QR / sélection) ; commerce réduit à ce que le comptoir affiche et
  calcule ; plus de journal servi en caisse.
- **Serveur (`server/app.ts`).** `GET /commerces/:id/caisse?q=&page=&limite=` (limite 1–50, défaut 20 ; `q` ≤ 80 car.,
  400 sinon) → `{ auteur, commerce, clients, total, page, limite }` ; recherche par prénom (sans accents), téléphone
  (+33/0033/06, tous formats) ou e-mail via `correspondRecherche` (même règle que le front). `GET
  /commerces/:id/caisse/clients/:clientId` → `{ client }`, 404 si inconnu. `commerceCaisse` (type `CommerceCaisse`,
  `src/types.ts`) : id, nom, logo, seuilTampons, recompense, catalogue, eurosParPoint, programme — jamais les lots
  (probabilités) ni les réglages internes (réponses auto, messages auto, relances, tests A/B, conservation, dates,
  liens). La recherche filtre côté serveur sur tous les clients du commerce (lecture paginée complète, P0-S18) : ce
  qui est minimisé, c'est ce qui quitte le serveur vers la tablette, pas le travail du serveur. `GET …/etat`
  (gérant) est inchangé : liste complète + journal.
- **Front (`src/pages/Caisse.tsx`, `src/data/api.ts`).** `api.caisse(commerceId, acces, { q, page, limite })`,
  `api.clientCaisse(commerceId, acces, clientId)`. Recherche différée 300 ms, ≥ 2 caractères, 8 par page, « Voir
  plus » ; scan QR = fiche à la demande ; fiche du client sélectionné rafraîchie à chaque synchro (15 s). Cache
  local : seulement les clients déjà vus sur cet appareil (recherche, scan, actions) — jamais la liste ; hors ligne,
  la recherche se replie sur ces clients connus (message explicite) et le scan d'un client jamais vu reste impossible.
- **Tests** : avant **879/879**, après **887/887** (`npm test`, typecheck serveur inclus), `npx tsc -p .` et
  `npm run build` OK. `+8` tests (`tests/caisse-p0-s14.test.ts`) : ouverture sans recherche (aucun client, commerce
  minimal, pas de journal), recherche par prénom (seul le client cherché), accents / +33 / e-mail, pagination
  (12 correspondants, pages de 5 sans recouvrement ni perte), fiche à la demande (401/404), paramètres invalides
  (400), parcours recherche → fiche → passage ; messages privés (voir revue Codex point 1). Adaptations au nouveau
  contrat (pas d'affaiblissement) dans `tests/cartiz.test.ts` : lecture du solde via la fiche, recherche `?q=Lina`,
  assertion « sans recherche, aucun client ».
- **Revue Codex** du diff (`/tmp/codex-revue-p0-s14.txt`, 7 points, tous corrigés, aucun ignoré) :
  1. [P1] `clientCaisse` exposait `messagesPrives` — `clientCaisseEquipe` (recherche, fiche, réponses d'actions) ;
     `clientCaisse` inchangé pour le gérant (GET …/etat, page Avis) — test : message privé absent en caisse, présent
     dans …/etat. La suggestion « liste blanche des champs » n'est pas reprise telle quelle : le comptoir a besoin de
     presque toute la carte (visites, récompenses en attente, rattrapages, réserve) et les champs restants
     (anniversaire, plat préféré, historique d'échanges) appartiennent à la carte servie ; seule la fuite nommée
     (messages privés) est retirée.
  2. [P1] ancien cache v1 (liste complète) survivait — clé cache v2 + suppression de la v1 au démarrage.
  3. [P1] retrait d'une fiche sur 404 inopérant (fusion) — `persisterCache` (écriture sans fusion) pour les retraits.
  4. [P1] scan réutilisant une fiche périmée — `ficheClient` interroge le serveur d'abord en ligne, cache seulement
     hors ligne, 404 → retrait des clients connus.
  5. [P2] effacer la recherche n'invalidait pas la requête en cours — compteur incrémenté en tête d'effet.
  6. [P2] « Voir plus » mélangeait deux recherches — garde de génération + verrou pendant le chargement.
  7. [P2] erreurs du scan / « Voir plus » non traitées, recherche masquant les erreurs — `.catch` + annonce,
     try/catch, `erreurRecherche` affichée distinctement de « Aucun client trouvé ».
  Incident : `codex exec` refusait de démarrer hors du repo (« Not inside a trusted directory ») — lancé avec
  `workdir` = repo. Codex n'a pas pu écrire son rapport (sandbox lecture seule) : texte complet dans
  `/tmp/codex-revue-p0-s14.txt` (retranscrit depuis sa sortie).
- **Incident de suite (flaky, hors lot).** La 2e suite complète après correctifs : 886/887, 1 échec
  `securite-s4` « définie et valide → démarre sans avertissement CORS » (timeout 23 s au démarrage du serveur en
  sous-processus, « ni démarré ni arrêté »). `server/index.ts` et CORS ne sont pas touchés par ce lot ; le test
  passe seul en 2,3 s (24/24) et passait dans la 1re suite complète (886/886) — surcharge de la VM pendant la suite.
  Suite relancée pour un vert propre avant commit.
- **Résiduels.** La route historique `POST /clients/:id/visite` (gérant OU équipe, `clientCaisse`) sert encore
  `messagesPrives` à un membre — hors périmètre S14 (route partagée, la fiche gérant en dépend via …/etat) ; à
  traiter si la vue équipe/gérant est un jour séparée sur cette route. Le cache local garde les fiches vues
  indéfiniment (par appareil, équipe seulement) ; aucune purge automatique. La recherche filtre en mémoire côté
  serveur (pas de filtre PostgREST sur le JSONB) : acceptable pour un commerce, à revoir si la base grossit
  beaucoup. Les correctifs front (points 2–7) ne sont pas couverts par un test automatisé (pas de navigateur sur la
  VM) : relus + typecheckés, à vérifier sur tablette réelle au premier usage.

## 11/11/2026 — P0-S18 : Pagination serveur Supabase (AUDIT.md §7, revue Codex point 2)
- **Contexte.** Les lectures `clients()` et `tirages()` ne paginaient pas : au-delà du plafond PostgREST (1 000 lignes
  par réponse), listes, exports et statistiques étaient silencieusement incomplets.
- **Stockage (`server/stockage-supabase.ts`).** Nouveau `lirePages` / `lireLignesPages` : boucle `.range()` par pages
  de 1 000 lignes, dernière page (< 1 000) arrêtant la boucle, versions mémorisées pour le verrou optimiste comme
  dans `lire`. Convertis : `commerces()`, `clients()`, `tirages()`, `tiragesClient()`, `tiragesParCode()`, `avis()`,
  `membres()` (et déjà `compteursEvenements()`). `tiragesClient()` gagne un tri explicite (date croissante, même ordre
  que l'ancienne lecture sans tri) : sans tri déterministe, les pages ne seraient pas stables. Inchangés : lectures
  d'une seule ligne (`eq('id', …)`, `clientParContact`), `journal` / `envois` (limite explicite du caller). Aucun
  changement dans `server/app.ts`, `src/pages/Clients.tsx` ni `src/lib/stats.ts` : ils reçoivent désormais des listes
  complètes — l'écran Clients paginait déjà l'affichage (50 par 50, « Charger plus »), l'export CSV et les stats
  n'avaient pas de plafond propre.
- **Tests** : avant **887/887**, après **891/891** (`npm test`, typecheck serveur inclus), `npx tsc -p .` et
  `npm run build` OK. `+4` tests (`tests/supabase.test.ts`, describe P0-S18) : 1 200 clients / tirages / avis lus en
  entier (offsets `['0', '1000']`, `limit=1000` prouvés par requête) ; 1 050 tirages d'un seul client (ordre stable,
  séquence complète vérifiée) ; 1 001 tirages à la même date, à cheval sur la frontière (aucun doublon, départage
  par `id`) ; /etat + statistiques (`cartesEmises`, `passagesTotal`) + export CSV complets à 1 050 clients
  (1 051 lignes CSV).
- **Contrôle négatif (2 passages).** Avec l'ancien stockage (sans pagination) restauré temporairement : d'abord
  seuls les 2 premiers tests échouaient (le 3e passait : le faux PostgREST ne simulait pas le plafond) ; après le
  correctif du point 4 ci-dessous, les 4 tests échouent — ils discriminent tous la régression. Restauration vérifiée
  : 45/45 ensuite.
- **Revue Codex** (2 P1, 2 P2, 0 P0 ; texte complet `/tmp/codex-revue-p0-s18.txt`, diff
  `/tmp/codex-p0-s18.diff`) : 1. [P1, corrigé] tri non déterministe à dates égales → départage par `id` ajouté aux
  4 lectures triées par date (`tirages`, `tiragesClient`, `tiragesParCode`, `avis`) ; assertion d'ordre existante
  mise à jour (`date.desc,id.asc`) et nouveau test « dates identiques à la frontière » (1 001 tirages, même date,
  semés en ordre inverse, séquence complète vérifiée). 2. [P1, non corrigé — documenté] les offsets dérivent si une
  écriture concurrente s'insère avant la page en cours (doublon ou omission possible) : la pagination par curseur
  demanderait de restructurer toutes les lectures de listes, pour un risque négligeable ici (fenêtre de < 1 s, stats
  et exports tolèrent une ligne de plus ou de moins ; le critère du lot — listes complètes au-delà du plafond en
  conditions normales — est rempli) ; consigné comme résiduel dans `server/README.md`. 3. [P2, corrigé] le test
  « ordre stable » ne vérifiait pas le tri (semis dans l'ordre chronologique) → semis en ordre inverse + séquence
  complète des ids vérifiée. 4. [P2, corrigé] le test HTTP ne discriminait pas → le faux PostgREST plafonne
  désormais à 1 000 lignes même sans `limit`, comme le vrai (max-rows par défaut) ; le contrôle négatif le prouve.
- **Résiduels** (documentés dans `server/README.md`, § Supabase) : le bilan de `supprimerClient` compte les lignes
  supprimées renvoyées par PostgREST (plafonné à 1 000 par table) — la suppression elle-même n'est pas plafonnée,
  seul le chiffre du journal peut être un minimum si un client avait plus de 1 000 tirages. La recherche caisse
  (P0-S14) filtre en mémoire côté serveur après lecture paginée complète : acceptable pour un commerce.

## 11/11/2026 — P0-S19 : Code gagnant hors vue publique (AUDIT.md §7, revue Codex point 3)
- **Contexte.** `GET /cartes/:id` re-servait le code gagnant du jour à quiconque connaissait un `clientId` (sans
  authentification). **Option retenue : la 2e** — le code n'est servi qu'au titulaire authentifié (jeton client valable
  de CETTE carte, `Authorization: Bearer`), jamais retiré de la réponse : le cas d'usage P0-U3 survit (voir ci-dessous).
- **Serveur (`server/app.ts`, handler `GET /cartes/:id`).** `jeu.codeDuJour = charge && code && !perdant ? code : null`
  — `charge` = jeton client accepté par `jetonClient`. Sans jeton : null, **même en vue complète (mode transition)** ;
  le lot du jour reste affiché, seul le code est conditionné. Tirage perdant : null, même avec jeton. Vérification en
  caisse (`GET /caisse/gains/:code`, `POST …/remise`) inchangée ; la réponse du tirage lui-même (`POST …/tirages`)
  rend toujours son code au joueur qui vient de jouer (c'est son propre résultat, après visite validée).
- **Front : aucun changement de comportement.** `Jouer.tsx` et `CartePublique.tsx` assuraient déjà le jeton avant
  `api.carte` (P0-S7 : `assurerJetonClient`, repli mémoire du gain venant d'être tiré) ; seuls les commentaires ont été
  mis à jour (`Jouer.tsx`, `src/data/api.ts`, `src/lib/carte.ts`). Titulaire légitime sur un autre téléphone / au
  cache vidé : lien d'accès du comptoir (15 min) ou « Retrouver ma carte » (24 h) → `POST /cartes/:id/jeton` → jeton
  → `GET` avec jeton → code ; testé de bout en bout (lien fabriqué avec le secret, comme la fiche client).
- **Tests** : avant **891/891**, après **901/901** (`npm test`, typecheck serveur inclus), `npx tsc -p .` et
  `npm run build` OK. `+10` tests (`tests/code-gagnant-p0-s19.test.ts`) : sans jeton en strict (vue limitée, code
  null, texte brut sans code), avec jeton (code servi), jeton d'une autre carte / falsifié (401, aucun code), lien
  d'accès → jeton → code (usage unique vérifié), perdant (null même avec jeton), remise en caisse (code + `remisDuJour`
  avec jeton, null sans), 2e tirage (409 sans code), mode transition (vue complète sans jeton mais code null ; avec
  jeton : code), sans `SESSION_SECRET` (GET null, `/jeton` 503), strict : tirage et export RGPD sans jeton → 401
  (export du titulaire avec jeton + contact : 200, CSV avec son code). Adaptations au nouveau contrat (pas
  d'affaiblissement) dans 4 tests existants : `code-gagnant-p0-u3` (le test « autre téléphone / cache vidé » exige
  désormais null sans jeton), `serveur.test.ts`, `securite-s3.test.ts`, `carte-pwa-p1-c3.test.ts` (client du front sans
  jeton → null).
- **Incident de suite (flaky, hors lot).** 1re suite complète : 900/901, 1 échec `securite-s4` « définie et valide →
  démarre sans avertissement CORS » (timeout 20 s au démarrage du serveur en sous-processus, même incident que P0-S14)
  ; `server/index.ts` et CORS ne sont pas touchés par ce lot ; le test passe seul en 2,3 s (24/24). Suite relancée
  pour un vert propre avant commit.
- **Revue Codex** (texte complet `/tmp/codex-revue-p0-s19.txt`, diff `/tmp/codex-p0-s19.diff`) : 4 points.
  1. [P0, fondé — verrouillé en strict, documenté] Export RGPD (`POST /cartes/:id/donnees`, `src/lib/rgpd.ts:146`
     liste `(code …)` de tous les tirages) sans jeton en transition : CSV avec les codes. 2. [P0, fondé — idem]
     `POST …/tirages` par contact seul en transition renvoie le code du tirage. Les deux sont le mode transition
     lui-même (accès d'avant P0-S7 admis par conception) : les corriger ici aurait été changer la sémantique de la
     transition lot par lot ; le correctif cohérent est le mode `stricte`, déjà le défaut en production dès que
     `SESSION_SECRET` existe. Ajouté : test strict (tirage + export sans jeton → 401, aucun code) et mention du résiduel
     dans `server/README.md` (§ Accès client, « Modes » + table des routes).
  3. [P1, fondé — documenté, non corrigé] Anciennes cartes : un jeton s'obtient sans autre preuve pendant la période
     de grâce P0-S7 (jusqu'au 10/02/2027), donc connaître un ancien identifiant suffit encore. Exception de migration
     explicite de P0-S7, à échéance ; la retirer ici casserait la migration des cartes existantes.
  4. [P1, fondé — documenté + test] Sans `SESSION_SECRET` (transition, dev seulement), aucun jeton ne peut être émis :
     le titulaire ne relit plus son code côté serveur (repli : réponse de son tirage + mémoire du téléphone dans
     `Jouer.tsx`). En production la variable est posée (Render, depuis le 10/11) ; test ajouté (GET null, `/jeton` 503).
- **Résiduels.** En mode transition, un contact seul suffit encore à obtenir des codes (points 1–2 ci-dessus) — la
  production est en `stricte` par défaut ; surveiller `GET /sante/acces-client → accesSansJeton` avant tout passage en
  strict forcé. Le front ne prouve pas à lui seul le parcours titulaire authentifié (pas de navigateur sur la VM) :
  relu + typechecké, à vérifier sur téléphone réel (lien comptoir → code affiché).

## 11/11/2026 — P0-S20 : Persistance des compteurs publics (AUDIT.md §7, revue Codex point 6)

- **Choix : persistance en base (pas documentation seule).** Justifié par la mesure : une ligne de compteur = 73
  octets de JSON (clé courte `lecture:198.51.100.23`) à 92 octets (clé longue
  `inscription:c-asian-home-paris:0612345678`) ; clé max 45 car. (`carte:cl-<UUID>`). En trafic normal : zéro écriture
  (une page rechargée toutes les 10 s fait 6 lectures/min pour un seuil de 30). Seuil de persistance = moitié du seuil
  (`SEUIL_PERSISTANCE_COMPTEURS = 1/2`, exporté depuis `server/app.ts`) : seuls les compteurs « chauds » (≥
  ceil(max/2)) ou bloqués sont persistés ; un compteur froid ne peut pas provoquer de 429 juste après un redémarrage.
  La limitation reste appliquée **en mémoire** (aucune latence ajoutée) ; les écritures sont en arrière-plan, sans
  bloquer la requête.
- **Migration 0010 (et non 0009).** Le brief disait 0009, mais 0009 est déjà la migration P0-S7 (auth client) : la
  nouvelle migration est `supabase/migrations/0010_compteurs_publics.sql` (+ `.down.sql`, rejouable). Table
  `compteurs_publics` (`cle` PK, `debut` timestamptz, `n` ≥ 0 ; index sur `debut` ; RLS activée, aucune policy, seul
  `service_role` y a droit). **La migration n'est PAS appliquée en production par ce lot** — procédure dans
  `server/README.md` (§ Migration 0010) : sauvegarde AVANT (par l'opérateur, jamais par un lot automatique), puis SQL
  Editor ; vérification `select count(*) from public.compteurs_publics;` → 0 ligne.
- **Implémentation.** `server/stockage.ts` : type `CompteurPublic`, méthodes `compteursPublics()`,
  `enregistrerCompteurPublic(c, purgerAvant)` (purge puis upsert), `purgerCompteursPublics(avant)`, `schemaCompteursPublics()`
  (SQLite : table + index + prepared statements). `server/stockage-supabase.ts` : lecture **paginée**
  (`lireLignesPages`, tri `cle` — PostgREST plafonne à 1 000 lignes), upsert `onConflict: 'cle'`, purge `lt('debut', …)`,
  mapping `ErreurMigrationManquante` (0009→0010 via `TABLES_0010`). `server/app.ts` : `creerCompteursPublics` réécrit
  (saturation à `max`, écritures sérialisées par clé, voir revue Codex) ; `restaurer()` au démarrage de `creerServeur`
  (après les helpers de schéma — pas de TDZ, les `async function schema*` sont hissées ; aucune requête servie avant la
  fin de `creerServeur` de toute façon) : fenêtres valides seulement, table absente → avertissement `[securite]` dès le
  démarrage + purge des lignes périmées, jamais de 500. `server/sauvegarde.ts` : 15 tables (ajout `compteurs_publics`,
  **optionnelle** — voir revue Codex point 5) ; `scripts/restaurer-base.mjs` normalise la table optionnelle absente
  (ancien export) avant les contrôles de compteurs et `--verifier`.
- **Tests : 901 → 917 (+16), `npm test` vert, `npx tsc -p.` vert, `npm run build` vert.** Nouveaux :
  `tests/compteurs-publics-p0-s20.test.ts` (5, HTTP SQLite : seuil de persistance = 1/2 ; compteur chaud survit ;
  blocage survit + compteur saturé n'écrit plus ; compteur froid perdu sans conséquence ; fenêtre expirée ignorée),
  `tests/supabase.test.ts` (5, describe P0-S20 : stockage upsert/lecture/purge ; lecture paginée au-delà de 1 000
  lignes ; sans migration 0010 ; HTTP redémarrage Supabase + avertissement dès le démarrage ; écriture ancienne
  retardée n'annule pas un blocage récent), `tests/migration-pglite.test.ts` (1, 0010 : rejouable, RLS fermée, upsert,
  purge, DOWN), `tests/sauvegarde-p0-s5.test.ts` (5 : 15 tables + migrations 0001–0010 ; export avec `compteurs_publics`
  absente → vide ; ancien export 14 tables restauré ; `compteurs_publics` mal formé refusé ; CLI ancien export avec et
  sans `--verifier`). Contrôles négatifs vérifiés (chaque test discriminant échoue sans sa correction) : sans
  `restaurer()` (2 tests de redémarrage), sans saturation (ligne en base > max), sans sérialisation par clé (upsert
  retardé → n = 2 final), sans table optionnelle (export refusé ; restauration TypeError), sans validation stricte
  (table mal formée acceptée).
- **Revue Codex n° 1** (texte `/tmp/codex-revue-p0-s20.txt`, diff `/tmp/codex-p0-s20.diff`) : 0 P0, 6 points, tous
  fondés et **tous corrigés** (diff des corrections `/tmp/codex-p0-s20-corrections.diff`) :
  1. [P1] Écritures non bornées après blocage (100 appels, seuil 30 → 86 persistances : `f.n++` sans plafond, persistance
     avant le 429). Corrigé : compteur saturé à `max`, refus avant toute écriture — au plus `seuil − seuil/2 + 1`
     écritures par clé et par minute ; test (ligne en base reste à n = 3 après 429 répétés).
  2. [P1] Données personnelles dans `cle` (IP, contact en clair via `cleContact`, identifiant de carte) — l'affirmation
     « aucune donnée client » était fausse. Corrigé : documentation et commentaires rectifiés partout (migration,
     README, tests) — la clé reprend l'identifiant déjà utilisé par l'anti-bruteforce (`tentatives_auth`, 0006), sans
     nom ni code gagnant ni contenu client ; purge des lignes périmées au démarrage en plus de chaque écriture.
     Pseudonymisation HMAC non retenue : elle casserait la restauration par clé (la clé lue en base doit correspondre
     à la clé en mémoire), pour la même classe de données que `tentatives_auth` déjà acceptée.
  3. [P1] Restauration tronquée à 1 000 compteurs (lecture non paginée, plafond PostgREST). Corrigé : lecture paginée
     via `lireLignesPages` (P0-S18) + tri déterministe par `cle` ; test à 1 001 lignes.
  4. [P1] Une écriture ancienne peut annuler un blocage récent (écritures concurrentes en arrière-plan, ordre
     d'arrivée non garanti — l'écart n'était pas « d'une unité » comme annoncé). Corrigé : file d'écritures par clé
     (`Map files`, chaîne de promesses, nettoyage après résolution, rejet absorbé sans bloquer la suite) ; test avec
     upsert retardé de 150 ms (final n = 3).
  5. [P1] Sauvegarde préalable impossible (15e table obligatoire → l'export avant migration échouait justement parce
     que la table n'existait pas encore ; anciens exports à 14 tables non restaurables). Corrigé : `compteurs_publics`
     devient `optionnelle` dans `TABLES_SAUVEGARDE` (exportée vide si absente, ancien export restauré vide) — la règle
     « jamais de sauvegarde incomplète » reste entière pour les 14 tables métier ; tests unitaires + CLI.
  6. [P2] Absence de migration silencieuse au démarrage (`ouVide` masquait l'absence, avertissement seulement au
     premier compteur chaud). Corrigé : `restaurer()` vérifie `schemaPresente()` d'abord et avertit dès le démarrage ;
     test (capture de `console.warn` au démarrage sans migration).
- **Revue Codex n° 2** (corrections seules, `/tmp/codex-revue-p0-s20-corrections.txt`) : 2 points, tous fondés et
  **tous corrigés** :
  1. [P1] Ancien export sans `compteurs_publics` : `scripts/restaurer-base.mjs` lisait `sauvegarde.tables[nom].length`
     → TypeError dans la transaction (idem `--verifier`, compteur absent). Corrigé : normalisation de la table
     optionnelle absente à `[]` / `0` après validation, avant les contrôles ; test CLI d'ancien export avec et sans
     `--verifier`. Au passage : le message `VÉRIFICATION OK … pour les 14 tables` du script disait encore 14 → 15.
  2. [P2] Tables optionnelles entièrement exclues de la validation, même présentes mais mal formées
     (`compteurs_publics: {corrompu: true}` accepté puis traité comme zéro ligne). Corrigé : `validerSauvegarde`
     n'excuse que l'absence — présente mais non-tableau, la table est refusée comme les autres ; test.
  La 2e revue confirme par ailleurs : saturation correcte, file par clé nettoyée, pagination triée, tables métier
  toujours obligatoires, restauration après initialisation des variables de schéma (pas de TDZ).
- **Incident de suite (flaky, hors lot, 3e occurrence après P0-S14 et P0-S19).** Une suite complète intermédiaire a
  échoué sur `securite-s4` « définie et valide → démarre sans avertissement CORS » (timeout 20 s au démarrage du
  serveur en sous-processus) ; le test passe seul, `server/index.ts` et CORS ne sont pas touchés par ce lot. La suite
  finale est verte en une passe (917/917) — aucun contournement appliqué.
- **Note de travail (à ne pas reproduire).** Deux `muse.edit` avec `old_text` trop court (`})` seul) ont remplacé la
  première occurrence du fichier au lieu de la cible (ligne 34 de `supabase.test.ts` corrompue, puis test CLI
  modifié au mauvais endroit) : réparé à chaque fois par script ciblé + vérification `git diff` ; désormais, tout
  `old_text` doit contenir assez de contexte unique pour ne correspondre qu'à un seul endroit.
- **Résiduels.** Une seule instance (Render) : à plusieurs instances, chaque instance garderait ses compteurs en
  mémoire et l'écriture d'une autre instance peut encore ramener un compteur en arrière (documenté, README §
  Anti-abus) — la base ne sert qu'au redémarrage, pas à la limitation distribuée. La migration 0010 reste **à
  appliquer en production** (sauvegarde d'abord, SQL Editor) ; sans elle, tout marche en mémoire seulement, avec
  l'avertissement dès le démarrage. Le repli mémoire sans migration et le parcours de redémarrage ne sont prouvés que
  par tests automatisés (pas de navigateur sur la VM) : vérifier les logs Render après application de la 0010
  (disparition de l'avertissement).

## 11/11/2026 — P0-S9 : Refuser SQLite en production (AUDIT.md §7)

- **Garde dans `server/index.ts` seulement** (le seul lanceur de production, `npm run serveur`) : après
  `configSupabaseDepuisEnv(env)`, si production (`NODE_ENV=production` ou `RENDER`) et pas de Supabase →
  `arreter('En production, Supabase est obligatoire : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définies
  (refus de démarrer sur SQLite vide).')` (sortie 1, message explicite). Une seule des deux variables reste refusée
  comme avant (demi-configuration). Hors production, SQLite reste le défaut (développement local, tests). La garde est
  placée avant `creerServeur` : aucune ouverture SQLite n'a lieu en production.
- **`/sante` (`server/app.ts`)** : clé conditionnelle `alerteStockage` (message explicite en français) uniquement quand
  `stockage === 'sqlite'` ET `o.production` — elle n'apparaît jamais en dev, donc le test figé des clés de `/sante`
  (`tests/securite-s1.test.ts:291`) reste vert. La garde rend ce cas quasi impossible (démarrage refusé avant) ; l'alerte
  est une défense en profondeur pour un démarrage par un autre chemin.
- **4 tests spawn existants adaptés (vrai changement de contrat, pas un affaiblissement — cf. précédent P0-S19).**
  Ils lançaient `server/index.ts` en production (RENDER=1) sans Supabase et attendaient un démarrage : la garde les
  aurait fait échouer sur le refus Supabase avant leur assertion. Ils fournissent désormais un faux Supabase HTTP
  (`tests/faux-supabase-http.ts`, nouveau helper partagé — lectures → `[]`, écritures → ligne écrite, juste de quoi
  laisser `initialiser` et `exigerMigrationsAudit` passer ; il ne simule pas une base, limite explicite) et gardent
  leurs assertions d'origine : S1 « SESSION_SECRET absente en production → démarrage QUAND MÊME, avec avertissement »
  (renommé « … (Supabase configuré, P0-S9) »), S4 « CORS_ORIGIN absente / valide / invalide » (`lancer` devenu asynchrone,
  faux fermé dans chaque `finally`).
- **Tests : 917 → 924 (+7), `npm test` vert, `npx tsc -p.` vert, `npm run build` vert.** Nouveaux
  (`tests/refus-sqlite-p0-s9.test.ts`) : spawn production sans Supabase → refus code 1 + message (NODE_ENV et RENDER) ;
  production AVEC Supabase (faux HTTP) → démarre ; développement sans Supabase → démarre ; une seule variable Supabase
  → refus demi-configuration ; `/sante` unitaire : SQLite + production → `alerteStockage` ; SQLite + développement →
  pas de clé, clés de `/sante` inchangées. Contrôle négatif vérifié : sans la garde, les 2 tests de refus échouent
  (5 passent). Point d'attention : la ligne `mode …` du `listen` arrive après la ligne `/api/v1/sante` qui déclenche
  la fin d'attente — les tests de démarrage positif attendent le motif par polling (`attendre`, 5 s) au lieu d'une
  lecture immédiate (course corrigée pendant le lot, pas un flaky de suite).
- **Docs.** `server/README.md` : § « Choix du stockage » (refus P0-S9 + `alerteStockage`) et § « Limites honnêtes »
  (la mention « limitation des routes publiques : en mémoire, remise à zéro au redémarrage » était périmée depuis P0-S20
  — compteurs chauds persistés et rechargés, fenêtres d'une minute).
- **Revue Codex** (`/tmp/codex-revue-p0-s9.txt`, diff `/tmp/codex-p0-s9.diff`) : **0 point** — garde bien placée et
  couvrant les deux cas de production, message actionnable, `alerteStockage` conditionnelle correcte, tests S1/S4 non
  affaiblis, faux HTTP suffisant pour le démarrage, aucun secret ni changement hors production. Revue statique
  uniquement (tests non exécutés dans sa sandbox).
- **Résiduels.** La garde ne protège que le lanceur `server/index.ts` : un démarrage direct de `creerServeur` avec
  SQLite en production reste possible par code (c'est le cas couvert par `alerteStockage`). Le déploiement Render
  actuel n'est pas touché par ce lot (aucun redéploiement) : si les variables Supabase venaient à manquer sur Render,
  le prochain déploiement refuserait de démarrer au lieu de servir une base vide — c'est le comportement voulu, à
  vérifier côté opérateur (variables présentes depuis le 10/11).

## 11/11/2026 — P0-S10 : Staging + rollback (AUDIT.md §7, revue Codex point 12)

- **`render.yaml` : 2e service `asian-home-fidelite-staging`** (branche `autonome/integration`, mêmes
  build/start/santé/variables que la production, valeurs différentes au dashboard). La production ne suit
  que `master`. Base Supabase de TEST séparée obligatoire (jamais la production) ; PINs de test et
  `SESSION_SECRET` différents de la production.
- **`docs/DEPLOIEMENT.md` (nouveau)** : création du staging (§ 2), retour arrière en une commande (§ 3),
  compatibilité des migrations 0001–0010 vérifiée une par une (§ 5), procédure après écritures partielles
  (§ 4). Endpoint vérifié dans la doc officielle Render (`api-docs.render.com/reference/create-deploy`,
  lu le 11/11/2026) : `POST /v1/services/{serviceId}/deploys` avec `{ "commitId": "<sha-40>" }`.
- **`scripts/rollback-render.mjs` (nouveau)** : simulation par défaut (affiche la commande curl exacte),
  `--executer` pour envoyer ; valide `--service` (staging/production), `--service-id` (`srv-…`) et SHA-40 ;
  vérifie que le commit existe localement ; **ne touche jamais à la base**. La clé API (`RENDER_API_KEY`)
  n'est jamais affichée.
- **Compatibilité des migrations** : chaque migration « up » est additive seulement (aucun `DROP TABLE` /
  `DROP COLUMN` / renommage / `DELETE` — testé) ; ancien code sur nouveau schéma (nouvelles tables
  ignorées, CHECK 0009 élargi) et nouveau code sur ancien schéma (dégradation `ErreurMigrationManquante`,
  sauf 0003/0004 exigées au démarrage par `exigerMigrationsAudit`). `.down.sql` pour 0005–0010 seulement
  (0001–0004 : retour = restauration de sauvegarde). Corrigé en cours de lot : la base à 10 migrations a
  **15 tables**, pas 14 (la sauvegarde en couvre 15 dont `compteurs_publics` en optionnelle).
- **Tests : 924 → 941 (+17), `npm test` vert, `npx tsc -p .` vert, `npm run build` vert.** Nouveaux
  (`tests/deploiement-p0-s10.test.ts`, 19 tests) : 2 services, commande de retour arrière (URL, corps,
  curl, refus des valeurs ambigües, simulation, garde-fou cible contre un faux serveur Render),
  migrations additives + `.down.sql` + tolérance aux migrations absentes, contenu de la doc.
  `tests/render-yaml.test.ts` adapté — **changement de contrat, pas un affaiblissement** (comme P0-S9) :
  1 → 2 services, toutes les assertions de la production gardées, nouvelles assertions pour le staging.
  Contrôle négatif : le test de la doc échouait `ENOENT` avant sa création ; le test du garde-fou cible
  refuse bien un identifiant de production avec le libellé staging.
- **Revue Codex** (`/tmp/codex-revue-p0-s10.txt`, diff `/tmp/codex-p0-s10.diff`) : **verdict initial
  « bloquant », 8 points, tous corrigés** (commit de correction sur la branche du lot) :
  1. [P1, fondé] Le libellé `--service` ne protégeait pas la cible → le script relit désormais le
     service chez Render (`GET /v1/services/{id}`) avant tout POST et refuse si son nom ne correspond
     pas au libellé ; testé contre un faux serveur Render (concordant → POST envoyé, discordant → refusé
     sans POST). Incident de test trouvé et corrigé : `spawnSync` + serveur dans le même processus =
     interblocage (la boucle d'événements bloquée ne peut pas répondre) → `spawn` asynchrone ; et
     `fetch` (undici) garde des sockets en keep-alive → `process.exit()` explicite en fin de script.
  2. [P1, fondé] La sauvegarde ne « fige » pas les écritures → le § 4 commence désormais par suspendre
     le service (Suspend Service) et note que l'export PostgREST n'est pas un instantané transactionnel.
  3. [P1, fondé] La restauration proposée reprenait les données corrompues + `restaurer-base.mjs` ne
     restaure que vers PGlite → distinction sauvegarde de conservation (après incident, preuve) /
     sauvegarde saine (avant déploiement, à restaurer), procédure manuelle Supabase (docs/SAUVEGARDE.md
     § 8).
  4. [P1, fondé] Débloquer une relance `en_cours` pouvait doubler un envoi (message accepté par le
     prestataire, statut final non écrit — cas prévu par `server/app.ts`) → vérification des traces du
     prestataire d'abord, blocage gardé si livraison incertaine, déblocage seulement si non-livraison
     confirmée, avec `statut` + `donnees` (statut + raison) mis à jour ensemble.
  5. [P1, fondé] Quota Free : Render suspend **tous** les services Free si les 750 h sont épuisées
     (`render.com/docs/free`, vérifié le 11/11/2026) → garantie « le quota tient » retirée ; suspension
     préventive du staging, surveillance Billing, ou Starter.
  6. [P2, fondé] La variante dashboard n'a pas le « même effet » → voies API (reconstruction, config
     actuelle, auto-déploiements maintenus) et dashboard (artefact réutilisé, réglages du déploiement
     cible pour le rollback seulement, auto-déploiements désactivés, Free : 2 déploiements les plus
     récents seulement) documentées séparément (`render.com/docs/rollbacks`, vérifié le 11/11/2026).
  7. [P2, fondé] « Ancien code » non défini → portée écrite au § 5 (retours entre commits récents
     seulement ; contrôles statiques, pas une preuve d'exécution — la preuve, c'est staging + `/sante`).
  8. [P2, fondé] `/sante.migrations` n'expose que `{ cartiz, programme, relances, mesure }` → 0009 via
     `GET /api/v1/sante/acces-client` (`migration`), 0010 via SQL direct ; corrigé aussi au § 2 et à
     l'ordre de déploiement. Au passage : `/sante.version` est la version du paquet, pas le SHA — le
     commit déployé se vérifie dans le dashboard (Deploys), pas via `/sante`.
  La sandbox Codex n'a pas pu exécuter la suite P0-S10 (`spawnSync git` → EPERM) : ce n'est pas un défaut
  imputé au diff — la suite est verte ici (941/941).
- **Résiduels / non vérifié.** Le service de staging n'est **pas créé** (pas de navigateur sur cette VM) :
  création + première vérification « Live » + parcours de base à faire par l'opérateur (docs/DEPLOIEMENT.md
  § 2). Rien ne prouve que le service existe tant que le `GET /api/v1/sante` du § 2, étape 4, n'a pas été
  fait. La commande de retour arrière n'a jamais été exécutée pour de vrai (simulation + faux serveur
  local seulement) : le premier vrai retour arrière devra être fait sur le staging d'abord.

## 11/11/2026 — P0-U0 : Mesure initiale avant refonte (AUDIT.md §7, revue Codex point 15)

- **Branche** `autonome/p0-u0-mesure-initiale` (depuis `autonome/integration` `de63457`) ;
  commit `2bf30ca` ; fusion `--no-ff` `8a78ecc` dans `autonome/integration` ; les deux
  branches poussées sur origin ; `git status` propre.
- **Tests : 944/944 → 950/950** (219 suites), `npx tsc -p .` vert, `npm run build` vert
  (0 avertissement). Nouveau : `tests/scores-p0-u0.test.ts` (6 tests) — SCORES.md contient
  les sections attendues (titres Markdown) et ses chiffres de bundle correspondent à un
  build frais à 5 % près (JS initial, CSS, total, JS total, chunks, plus gros chunk),
  avec vérification de l'arithmétique exacte JS + CSS = total.
- **Fichiers** : `SCORES.md` (nouveau, référence avant/après) ; `scripts/mesurer-scores.mjs`
  (nouveau, Playwright Pixel 7, Slow 4G + CPU ×4, serveur E2E local) ;
  `scripts/mesurer-lighthouse.mjs` (nouveau, Lighthouse 13.6.0 épinglé en devDependency) ;
  `package.json` + `package-lock.json` (ajout `lighthouse` 13.6.0 exact ; aucune
  dépendance existante modifiée — le lock ne fait qu'ajouter l'arbre Lighthouse).
- **Mesures (11/11/2026, 5 passes Playwright + 2 passes Lighthouse, serveur local)** :
  bundle initial 535857 o (JS 471651 + CSS 64206) ; couverture 97,84 % lignes / 91,43 %
  branches / 92,92 % fonctions ; Lighthouse mobile `#/jouer` 81 (76 à la 1re passe,
  variance ±5) ; premier affichage `#/jouer` 4,02–4,24 s (seuil < 4 s **non atteint**) ;
  LCP jouer 4,06–4,18 s (élément `p.titre-carte`) ; scan → lot ~9,0–10,3 s d'étapes
  (caisse ralentie 6,8–7,9 s) ; taps client 4 clics + 1 saisie, caisse 3 clics + 2 saisies ;
  DA moyenne 6,1/10 (Jouer 7, Carte 7, Caisse 6, Menu 6, Tableau de bord 6, Clients 6,
  Roulette 6, Réglages 5). Menu → commande et réservation n'existent pas (dit
  explicitement). Délai à froid Render (~60 s) non mesuré ; `npm audit` non mesurable
  sur cette VM (403 `policy_denied`).
- **1 erreur console, reproductible 5/5** : `GET /api/v1/commerces/<id-client>` → 404 à
  chaque transition jouer → carte. Cause élucidée (pile d'appel + hash au moment de
  l'appel + chargement direct sans 404) : `JouerApi` (`src/pages/Jouer.tsx:422`,
  `api.commerce(param)`) se re-rend une fois avec le nouveau `param` (identifiant
  client) avant d'être démonté — les deux abonnements `useRoute()` (App et JouerApi)
  ne se mettent pas à jour dans le même rendu. Aucun impact visible. **À corriger dans
  un lot ultérieur — pas dans ce lot de mesure.**
- **Revue Codex** (`/tmp/codex-revue-p0-u0.txt`, diff `/tmp/codex-p0-u0.diff`) : **10 points,
  tous corrigés** (scripts réécrits, re-mesure complète passes 4–5, Lighthouse relancé
  avec le script versionné) :
  1. [Bloquant, fondé] LCP lu trop tôt / périmé sur navigation hash → stabilisation 2 s
     avant lecture, élément LCP enregistré, menu mesuré aussi par chargement direct
     (LCP menu par hash : aucune nouvelle entrée ; direct : 1632 ms). Les valeurs
     4032/4040 ms des passes 2–3 étaient la valeur périmée de `#/jouer`.
  2. [Bloquant, fondé] Caisse non ralentie (CDP seulement sur le client) → même
     ralentissement sur chaque page ; validation caisse corrigée de ~1,1–1,6 s à 6,8–7,9 s.
  3. [Fondé] `VITE_API_URL` hérité → forcé à `/` pour le serveur enfant + garde-fou
     (toute requête hors origine locale fait échouer la passe).
  4. [Fondé] Captures back-office « réussies » après échec du déverrouillage → fail-fast
     + attente du titre de chaque écran ; déverrouillage OK aux passes 4–5.
  5. [Fondé] Port non vérifié → refus de se brancher sur un serveur déjà présent
     (port libre exigé) + surveillance `error`/`exit` du serveur enfant.
  6. [Fondé] Faux positifs dans la cohérence des chiffres → arithmétique exacte
     JS + CSS = total + vérification JS total / chunks / plus gros chunk.
  7. [Fondé] Requêtes échouées non collectées sur caisse/back-office → mêmes collecteurs
     partagés sur toutes les pages.
  8. [Fondé] Lighthouse non reproductible (script en cache, chemins absolus) →
     `scripts/mesurer-lighthouse.mjs` versionné + `lighthouse` 13.6.0 épinglé ;
     méthodes Playwright (CDP direct) et Lighthouse (throttling simulé) documentées
     comme distinctes.
  9. [Fondé] Options CLI cassées (`--port` ignoré, `--sortie` buggué) → `parseArgs`
     + validation du port.
  10. [Fondé] Sections acceptées par simple mention → ancrage sur les titres Markdown
      et seuils vérifiés dans le tableau. Plus la remarque de clôture : « à la limite »
      remplacé par « seuil non atteint » (les 5 premiers affichages dépassent 4 s).
  Vérifications de Codex confirmées : 471651 + 64206 = 535857 o, totaux d'étapes
  corrects, moyenne DA 6,125 → 6,1.
- **Résiduels / non vérifié.** Pas de mesure sur téléphone réel (Lighthouse et parcours
  à refaire sur le staging, protocole dans SCORES.md) ; le vrai menu 81 plats et le vrai
  logo n'ont pas été mesurés (commerce de test sans logo ni menu) ; délai à froid Render
  non mesuré ; `npm audit` à mesurer hors de cette VM. Le 404 jouer → carte est un
  défaut réel à corriger dans un lot ultérieur (piste : garder `page === 'jouer'` dans
  `JouerApi` ou unifier l'abonnement `useRoute`).

## 11/11/2026 — P0-D1 : Thème noir+magenta isolé + correctif 404 (AUDIT.md §6–§7, revue Codex point 14)

Branche `autonome/p0-d1-theme-magenta` → fusion `--no-ff` dans `autonome/integration`
(`0e1a10f`, poussée). Commits : `63596c9` (thème), `473a122` (correctif 404 +
re-mesure), `15b72ad` (correctifs revue Codex). Production non touchée, rien déployé,
rien sur master. Tests 950 → **974/974**, typechecks serveur + front verts,
E2E scan→gain→carte 1/1, erreurs console 0, bundle 537804 o (+0,36 % vs référence
P0-U0), DA 6,1 → **7,6/10** (cible ≥ 9 non atteinte — voir « Point ouvert »).

- **Palette retenue (AUDIT §6.2, ratios recalculés par script Python, confirmés par
  Codex par recalcul indépendant)** : fond `#111111`, surface `#1B1B22`, surface 2
  `#26262E`, fond clair `#F7F5F2` ; texte magenta sur noir `#FF2E9A` 5,49:1,
  `#FF4D6D` 5,88:1 ; fond de bouton (texte blanc) `#D1006F` 5,33:1, `#C4007A` 5,79:1,
  `#A1005E` 7,84:1 ; laque `#B3262D` blanc dessus 6,5:1. Règles négatives assertées :
  `#D1006F`/`#C4007A` sur `#111111` 3,54:1/3,26:1, `#FF2E9A` sur `#F7F5F2` 3,16:1,
  blanc sur `#FF2E9A` 3,44:1 ; texte d'accent sur fond clair = `#A1005E` 7,21:1 ou
  `#C4007A` 5,32:1. Cas limite : `#FF4D6D` sur gris-800 `#1F2937` (bandeau « commerce
  désactivé », App.tsx) = 4,57:1, juste au-dessus d'AA. Ancien commentaire CSS
  « or #c9a227 sur #111111 ≈ 8,9:1 » faux : vrai calcul 7,81:1.
- **Décisions** : laque conservée **uniquement** comme réserve danger/erreur (échelle
  `marque-*` définie, zéro usage dans les composants ; les erreurs actuelles utilisent
  déjà `red-*`) ; `FOND_DEFAUT` reste ivoire `#fbf8f3` — l'AUDIT §6.4.3 proposait
  `#111111`, rejeté : le fond est le corps de la carte rendu avec du texte foncé,
  `#111111` échouerait au propre contrôle `problemesApparence` et rendrait la carte
  illisible ; le noir par défaut est porté par le bandeau/héros, pas par
  `apparence.fond`. `amber-*` conservé comme sémantique d'alerte/étoiles (pas comme DA)
  — désormais verrouillé par une garde explicite (classes autorisées listées, étoiles
  limitées à InvitationAvis/ui/Avis). Étoile SVG `stroke="currentColor"`. Tampons
  pleins `bg-magenta-500` (blanc 5,33:1) — **écart à l'AUDIT §6.3** : le cercle
  `#FF2E9A` + coche blanche qu'il propose vaut 3,44:1, donc contraire à WCAG.
  Roue : secteurs `['#a1005e', '#111111', '#ff2e9a', '#fbf3e4', '#26262e',
  '#fdf3f2']`, `couleurTexte('#ff2e9a') = '#111111'` (5,49:1) ; confettis magenta.
  `.bouton` primaire magenta, `.lien` magenta-700, focus `magenta-400`,
  `.titre-or` → `.titre-magenta`, `.puce-sombre` pressed magenta.
- **Isolation** : `src/theme.ts` source unique ; `@theme` miroir exact (vérifié par
  test, ensemble des tokens comparé) ; `chargement.css` / `hors-ligne.css` reprennent
  des valeurs du thème ; halos et ombre du bouton en `color-mix()` sur les tokens
  (jamais de rgb() d'une couleur du thème hors theme.ts — garde ajoutée).
  Garde par test : aucun hex dans `src/**/*.ts(x)` sauf `theme.ts`, zéro
  `or-300|or-400|or-500|#c9a227|#d4a73c|#f2d48a|titre-or|neon-500`, zéro usage
  `marque-*` dans les `.tsx`, `text-magenta-300/400` seulement sur fond sombre prouvé.
- **Tests existants modifiés** (changement de spec, assertions de même force
  re-pointées sur magenta, rien affaibli) : `identite-accessibilite-p2-q1`,
  `menu-reel`, `roue-p0-u2`, `attente-visite-p0-u4`, `menu-client-p1-c5`,
  `chargement-p0-u1`, `integrations-v3` (fond du pass Wallet `rgb(179, 38, 45)` →
  `rgb(209, 0, 111)`).
- **Incidents** : imports `from '../theme'` sans extension `.ts` → `ERR_MODULE_NOT_FOUND`
  (3 fichiers) ; ré-export `COULEURS_CONFETTIS` seul sans liaison locale dans
  `animationRoue.ts` → `ReferenceError` ; `tsc` `roue.ts(34,28)` (Set inféré trop
  étroit) → `Set<string>` ; `#fff` 3 chiffres dans `.hero-sombre` → `#ffffff`.
  Coquille dans le message du commit 1 : « FOND_DEFAUT reste ivoire #fff8f3 » au lieu
  de `#fbf8f3` (code correct, message seul — non amendé).
- **Correctif 404** (`473a122`) : `GET /api/v1/commerces/<id-client>` → 404 à chaque
  transition `#/jouer` → `#/carte` (mesuré 5/5 par P0-U0). Cause : `JouerApi` se
  re-rendait une fois avec le nouveau `param` (identifiant client) avant d'être
  démonté. Correctif : garde `page === 'jouer'` avant tout appel réseau (retour
  silencieux) + `demandeEnCours` (revue Codex) : réponse obsolète ignorée après
  jouer/A → jouer/B, ancien commerce effacé pendant le chargement du nouveau.
  Preuves : `tests/jouer-404-p0-d1.test.ts` (5 tests), E2E avec assertion zéro
  requête ≥ 400 (1/1) ; **contrôle négatif** : sans le correctif (stash de
  `Jouer.tsx` seul), l'E2E échoue. Re-mesure (`node_modules/.cache/mesure-p0-d1/`,
  1 passe) : 0 erreur console, 0 requête échouée. Les temps de cette passe ne sont
  pas retenus (`npm test` tournait en parallèle sur la même VM).
- **Captures 375 px** (`node_modules/.cache/mesure-p0-d1/`) : 9 écrans de la passe
  standard + 5 complémentaires (script `captures-richesse.mjs`) : roue à 8 lots
  (6 couleurs alternées, libellés lisibles), vrai menu 81 plats (prix magenta),
  carte à bandeau personnalisé `#d1006f` (sous-titre blanc lisible). DA : Jouer 8,
  Carte 8, Caisse 7, Menu 8, Tableau de bord 8, Clients 8, Roulette 7, Réglages 7.
- **Revue Codex** (`/tmp/codex-revue-p0-d1.txt`, diff `/tmp/codex-p0-d1.diff`) :
  **7 points** — ratios confirmés exacts à deux décimales par recalcul indépendant ;
  adaptations des anciens tests confirmées légitimes ; aucun secret, envoi réel,
  changement de prix/probabilités/textes légaux :
  1. [Bloquant, fondé, CORRIGÉ] Magenta clair sur bandeau personnalisé (1,66:1 sur
     `#d1006f`) → sous-titre blanc, test de propriété (blanc ≥ 4,5:1 sur tout
     `assombrir(couleur)` validée), validé visuellement par `carte-couleur-perso.png`.
  2. [Bloquant, fondé, CORRIGÉ partiellement] `theme.ts` pas la seule source
     effective (copie manuelle + rgb() dans les halos) → halos/ombre en `color-mix()`
     sur les tokens + garde anti-rgb(). **Génération du CSS depuis theme.ts
     ÉCARTÉE** : les feuilles avant-JS (chargement/hors-ligne) ne peuvent pas
     consommer de tokens TS au chargement, et le test du miroir exact bloque déjà
     toute dérive — le coût d'un générateur n'apporte rien à l'utilisateur.
  3. [Bloquant, fondé, NON CORRIGÉ — décision parent, voir « Point ouvert »]
     Corps sombres côté client (AUDIT §6.2/§6.3) reportés comme « hors périmètre ».
  4. [Fondé, CORRIGÉ] Doré subsistant (étoiles amber) → gardé par convention
     (note/5) et sémantique d'alerte, mais verrouillé par une garde explicite.
  5. [Fondé, CORRIGÉ] Cycle des requêtes incomplet (réponses obsolètes jouer/A →
     jouer/B) → `demandeEnCours` + effacement de l'ancien commerce. Annulation
     réelle (AbortSignal) hors périmètre : l'API ne le supporte pas ; `setState`
     après démontage est un no-op (React 18+).
  6. [Fondé, CORRIGÉ] Captures 1 secteur / menu vide → captures complémentaires
     (8 lots, vrai menu, couleur perso).
  7. [Remarque] Adaptations des anciens tests légitimes ; l'EROFS vu par Codex sur
     `menu-client-p1-c5` venait de son bac à sable en lecture seule — suite
     complète re-vérifiée ici : 974/974.
- **Point ouvert — décision parent requise.** L'AUDIT §6.2 (« Fond principal
  (client) `#111111` ») et §6.3 (« Cartes : fond `#1B1B22` sur écrans client »)
  demandent des corps sombres côté client ; P0-D1 les a laissés clairs/ivoire
  (DA 7,6/10, cible ≥ 9 non atteinte). C'est une refonte visuelle à part entière
  (Jouer, Carte, Menu : fonds, cartes, champs, contrastes à re-vérifier), hors
  mandat de P0-D1 (isolation du thème + substitution magenta). Trancher : lot P1
  « surfaces sombres client » dédié, ou accepter les corps clairs comme périmètre
  définitif (et abaisser la cible DA). Le back-office reste clair dans les deux cas
  (AUDIT §6.2, lisibilité de travail).
- **Résiduels / non vérifié.** Pas de mesure sur téléphone réel (Lighthouse et
  parcours à refaire sur le staging) ; le vrai logo Asian Home n'a pas été mesuré
  (commerce de test sans logo) ; délai à froid Render non mesuré ; `npm audit` à
  mesurer hors de cette VM.

## 11/11/2026 — P0-U6 « Réveil Render » (écran d'attente honnête, décision documentée)
- **Décision (coordinateur, mode autonome : option la moins chère, isolée derrière une configuration).**
  Ni plan payant acheté, ni keep-alive : écran d'attente honnête + option payante documentée et
  isolée en commentaire dans `render.yaml` (plan `free` inchangé sur les deux services). Le
  keep-alive est écarté (docs/DEPLOIEMENT.md § 7.4) : il consommerait les 750 h gratuites partagées
  (production + staging éveillés = ~1 488 h/mois pour un mois de 31 jours, 1 440 h pour 30 jours —
  près du double du quota, suspension de tous les services Free à épuisement) et n'est pas garanti
  (Render peut redémarrer un service Free à tout moment).
- **Livré (`9647a1f`, puis correctifs revue Codex `8ba0ea9`).** `index.html` : après 6 s sans JS,
  message conditionnel « Le chargement prend plus de temps que prévu. Après une période sans visite,
  le serveur peut mettre environ 1 minute à se réveiller — merci de patienter. » ; après 2 minutes,
  proposition de recharger. `src/chargement.css` : indicateur indéterminé (segment magenta qui va et
  vient — il signale l'attente, il ne mesure rien) ; mouvement réduit : barre masquée, texte conservé.
  `docs/DEPLOIEMENT.md` § 7 : décision complète, option payante, rejet du keep-alive, mesure à froid.
- **Dit explicitement : le parcours < 30 s à froid reste impossible.** L'écran ne le rend pas
  possible, il l'explique. Le seul correctif certain est le plan payant.
- **Prix Render : environ 7 $/mois (Starter, 512 Mo, 0,5 CPU, toujours allumé) — INDICATIF, pas
  « vérifié ».** La page render.com/pricing (consultée le 11/11/2026) est à rendu JS : son tableau
  des tarifs n'était pas lisible en lecture texte ; le montant est corroboré par 5 sources tierces
  concordantes nommées avec liens dans docs/DEPLOIEMENT.md § 7.3 (kuberns, budgetforge, cloudpicked,
  agentdeals, bex.co) + la vérification déjà consignée au § 1 — à confirmer dans le dashboard Render
  avant tout achat. Le comportement de veille (15 min, réveil ~1 min, 750 h) vient lui de la doc
  officielle render.com/docs/free, lue en texte intégral le 11/11/2026. Le message de commit
  `9647a1f` dit encore « prix vérifié » : formulation corrigée dans § 7.3 et dans ce JOURNAL, pas
  dans l'historique (branche non poussée au moment du correctif, mais deux commits conservés pour
  tracer la revue).
- **Revue Codex** (`/tmp/codex-revue-p0-u6.txt`, diff `/tmp/codex-p0-u6.diff`) : **7 points** —
  1. [Bloquant, fondé, CORRIGÉ] Limite architecturale : pendant le réveil, Render affiche SA
     propre page de chargement — notre écran n'est servi qu'une fois le serveur réveillé ; il
     n'accompagne donc pas le réveil lui-même. Documenté dans § 7.1 (ne pas sur-vendre l'écran) ;
     une page servie indépendamment du service endormi reste hors périmètre, non décidée.
  2. [Fondé, CORRIGÉ] Message affirmatif (« le serveur se réveille », « la première fois ») →
     conditionnel (la cause n'est pas connue après 6 s ; le réveil se reproduit après chaque inactivité).
  3. [Fondé, CORRIGÉ] Barre déterminée 60 s → indicateur indéterminé (une barre à 100 % sur un
     chargement bloqué affirmait une mesure inexistante).
  4. [Fondé, CORRIGÉ] Prix « vérifié » → indicatif, sources nommées, « à confirmer dans le
     dashboard avant tout achat », répercuté dans render.yaml.
  5. [Remarque, CORRIGÉ] Arithmétique précisée (744 h = 31 jours, 720 h = 30 jours) ; équivalence
     redémarrage = réveil retirée (durée documentée pour la sortie de veille seulement).
  6. [Fondé, CORRIGÉ partiellement] Tests renforcés (propriétés CSS vérifiées dans leur règle,
     plan free rattaché à chaque service par découpage — sans importer le mini-lecteur, qui
     exécuterait ses tests deux fois). Pas de contrôle comportemental des délais : pas de navigateur
     sur cette VM — reste à observer sur le staging (§ 7.5).
  7. [Remarque] CSP, mouvement réduit, YAML : rien à corriger.
- **Tests : 974 → 988 (+14, `tests/reveil-render-p0-u6.test.ts`), suite verte, `npx tsc -p .`
  propre, typecheck serveur inclus dans `npm test`.** Aucun test existant modifié. Incident en
  cours de route : une ligne de commentaire `render.yaml` avait perdu son `#` (mini-lecteur YAML
  refusant le fichier) — corrigée avant le commit ; puis mon premier balisage (div imbriquée dans
  le loader) cassait la regex du test P0-U1 existant — résolu sans toucher au test, en passant la
  barre en un seul élément (fond animé).
- **Non vérifié.** Aucune mesure à froid réelle (pas de navigateur sur cette VM, production non
  touchée — ni réveil forcé, ni mesure) ; la durée « environ 1 minute » est la durée documentée
  par Render, pas une mesure locale. Mesure simulée locale non retenue (un démarrage local ne
  simule pas le réveil Render). Protocole de mesure à froid sur le staging : docs/DEPLOIEMENT.md
  § 7.5 (observer séparément la page Render puis l'écran applicatif).

## 11/11/2026 — P1-D2 « Corps sombres côté client » (AUDIT.md §6.2/§6.3, suite de P0-D1)
- **Périmètre (coordinateur, ne pas rouvrir).** Corps sombres (fond `#111111`, cartes `#1B1B22`)
  sur les pages client **#/jouer, #/carte, #/menu** uniquement — #/roulette est une page
  commerçant (configuration de la roue, onglets back-office), pas une page client ; #/caisse reste
  claire (comptoir), #/desinscription et #/confidentialite restent claires (lecture longue).
  Bascule centralisée dans `src/App.tsx` (branche publique, squelettes et erreurs inclus) ;
  règles `.page-client` en fin de `src/index.css`, correspondances centralisées dans
  `src/theme.ts` (`PAGE_CLIENT_SOMBRE`) — 0 hex hors thème.
- **Livré.** `src/theme.ts` : table des correspondances + ratios documentés ; `src/index.css` :
  bloc `.page-client` (fond nuit-950, cartes nuit-900, champs surface2, textes gris-200/300/400,
  magenta-400 en accent, alertes sémantiques non converties) ; `src/components/CarteFidelite.tsx` :
  `data-surface-claire` sur la section — la carte reste un objet clair (fond configurable par
  commerce, défaut ivoire ; le noir n'est pas un fond de carte valide, cf. `src/lib/apparence.ts`).
  Note d'étoiles en **blanc** (pas de token ambre dans `index.css` : la garde P0-D1 réserve
  l'ambre aux alertes et aux étoiles, et les étoiles gardent leur couleur ambre).
- **Écart à la spec tampon de l'AUDIT §6.3, conservé depuis P0-D1.** Cercle `#ff2e9a` + coche
  blanche = 3,44:1, sous le seuil AA du texte courant (4,5:1) ; la coche est un indicateur
  graphique (seuil non-texte 3:1), mais le tampon est traité comme texte par prudence : le
  tampon posé garde blanc sur magenta bouton `#d1006f` (5,33:1). Limite connue : magenta clair
  `#ff2e9a` en texte = 4,37:1 sur surface2 `#26262e` — jamais utilisé sur les champs. Contrastes
  recalculés avec `contraste()` du repo (blanc/noir 18,88 ; gris-200/noir 15,25 ; gris-400/surface
  6,74 ; magenta-400/surface 4,98 ; erreur red-300 9,95 ; ok green-300 13,45 ; placeholder blanc
  65 % sur surface2 7,18).
- **Deux régressions trouvées par les captures de la 1re passe, corrigées avant la 2e.**
  1. Le corps de la carte de fidélité devenait sombre avec des textes restaurés en gris foncé
     (illisible) : `[data-surface-claire] .bg-white` ne cible que les descendants — la section
     porte `bg-white` ET l'attribut, il faut la règle accolée
     `[data-surface-claire].bg-white` (test ajouté).
  2. La carte de gain gardait son dégradé clair (magenta pâle → blanc) avec des textes passés
     en blanc : le seul dégradé clair côté client devient sombre en CSS
     (`[data-resultat='gain']`, teinte magenta en haut, nuit en bas — test ajouté).
  Vérifié visuellement sur la 2e passe : carte blanche lisible sur page sombre, gain sombre
  lisible, menu réel 81 plats en fiches sombres, carte couleur perso ivoire + bandeau `#d1006f`
  inchangée, écrans commerçant inchangés (caisse, tableau de bord, clients, roulette, réglages).
- **Revue Codex** (`/tmp/codex-revue-p1-d2.txt`, diff `/tmp/codex-p1-d2.diff`) : **7 points,
  tous CORRIGÉS** —
  1. [Fondé] Bouton secondaire de parrainage dans l'îlot clair (texte blanc sur carte blanche,
     invisible) → restauration `.bouton-secondaire` (+ survol) dans `[data-surface-claire]`.
  2. [Fondé] Lien « Réessayer maintenant » magenta clair dans l'alerte ambre (3,31:1 sur
     ambre-50) → magenta foncé dans les alertes claires (7,56/7,49/7,17:1).
  3. [Fondé] Vue d'erreur de chargement hors `.page-client` (elle remplaçait le conteneur) →
     bascule déplacée sur `<main>`, autour de la frontière d'erreur (markup `<Suspense>` exigé
     par le test performance-bundle inchangé).
  4. [Fondé] Bordure rouge `aria-invalid` du champ écrasée par la bordure sombre → règles
     explicites `[aria-invalid='true']` + focus (rouge clair, 5,43:1 sur surface2, anneau rouge).
  5. [Fondé] SCORES.md concluait « pas de régression » pour un bundle à +1,28 % vs le seuil
     535857 o → libellé corrigé : seuil strict dépassé, écart = le CSS des règles P1-D2
     elles-mêmes, accepté et documenté.
  6. [Remarque] « Aucune régression de temps » sur une seule passe → « temps proches,
     comparaison non concluante ».
  7. [Remarque] Bas du dégradé de gain = nuit-900, donc blanc 17,12:1 et non 18,88:1
     (nuit-950) → commentaire et test corrigés ; précision WCAG sur la coche du tampon
     (indicateur graphique, seuil 3:1 — le choix conservateur est maintenu).
  Les 3 correctifs CSS de la revue (points 1, 2, 4) sont vérifiés par règles + contrastes
  testés, pas par capture (parrainage non actif sur les commerces de mesure, alerte
  hors-ligne et champ invalide non déclenchés par le script de mesure).
- **SCORES.md.** DA : écrans client 9/10 (jouer, carte, menu public), moyenne **8,0/10**
  (était 7,6/10) — la cible ≥ 9/10 n'est pas atteinte : les écrans commerçant (7–8/10)
  restent clairs par choix du lot ; un lot commerçant serait nécessaire. Bundle (build frais) :
  JS initial 472715 o (+184 o), CSS 70023 o (+4 750 o, +7,3 % — règles `.page-client`),
  total initial 542738 o, JS total 780925 o, 22 chunks, plus gros 349423 o. Temps (2e passe,
  1 passe, Slow 4G) : premier affichage `#/jouer` 4251 ms, LCP 4224 ms ; parcours scan → lot
  8572 ms d'étapes (taps identiques) ; temps proches de P0-D1 (1 passe, comparaison non
  concluante) ; 0 erreur console, 0 requête échouée. Le bundle initial dépasse le seuil strict
  « pas de régression vs 535857 o » de 1,28 % (CSS des règles P1-D2, JS initial +0,04 %) —
  écart accepté et documenté dans SCORES.md.
- **Tests : 988 → 1006 (+18, `tests/corps-sombres-p1-d2.test.ts` — 16 initiaux + 2 correctifs
  revue Codex), suite verte,
  `npx tsc -p .` propre, typecheck serveur inclus dans `npm test`.** Aucun test existant
  modifié. Incident en cours de route : mes commentaires contenaient des hex (`App.tsx`) et
  des `amber-NNN` nus (`theme.ts`, `index.css`) — la garde `theme.test.ts` scanne aussi les
  commentaires ; réécrits en toutes lettres (« ambre »), sans contourner la règle.
- **Non vérifié.** Pas de mesure sur téléphone réel (captures Pixel 7 simulé seulement) ;
  pas de mesure à froid Render (lot P0-U6) ; `npm audit` non mesurable sur cette VM
  (403 `policy_denied` sur le registry).

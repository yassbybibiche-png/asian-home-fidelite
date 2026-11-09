# JOURNAL — Fideliz

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

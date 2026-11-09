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

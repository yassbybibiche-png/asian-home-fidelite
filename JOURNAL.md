# JOURNAL — Fideliz

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

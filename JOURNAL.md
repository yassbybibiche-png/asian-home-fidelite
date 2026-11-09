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

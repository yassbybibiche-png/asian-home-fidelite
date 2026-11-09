# PHASE 2 — Fideliz : les 3 modules (fidélité, roulette, avis)

Tu travailles dans `~/workspace/fideliz-claude/`. Lis `BRIEF.md`, `PLAN.md` et
`JOURNAL.md` avant de commencer. Ne recommence pas le squelette : complète le code existant.

## Module 1 — Carte de fidélité digitale
- Inscription client en 10 secondes : prénom + téléphone OU email (un seul suffit).
  Après inscription, le client apparaît dans la liste du commerce actif.
- Fiche client : QR code personnel affiché (tu peux générer le QR en SVG/canvas avec
  une petite librairie, ex. `qrcode` ou un encodage simple — pas d'appel réseau),
  nombre de tampons, progression visible vers la récompense (ex. « 6/10 tampons »,
  barre de progression), date de dernière visite.
- Bouton commerçant « Valider une visite » (+1 tampon) sur la fiche client et dans
  la liste. Quand le seuil est atteint : récompense débloquée, bouton « Offrir la
  récompense » qui remet les tampons à zéro et enregistre la récompense offerte.
- Bouton « Ajouter à Wallet » (Apple Wallet / Google Wallet) : **simulé** —
  affiche clairement « Démo — génération de vrai pass non incluse » (pas de fausse
  promesse, pas d'appel réseau).
- Relances inactifs : onglet/section « À relancer » = clients sans visite depuis
  30 jours, avec un message type prêt à copier (« Bonjour [prénom], ça fait un moment…
  ») et un bouton copier.

## Module 2 — Roulette par QR code + avis Google
- QR code unique par commerce (page « QR vitrine » : QR grand format affichable /
  imprimable, avec nom du commerce). Le QR encode l'URL de la page roulette du commerce
  (URL fictive locale, ex. `#/jouer/<commerceId>` — la navigation par hash suffit).
- Page publique `#/jouer/<commerceId>` : pas besoin d'être connecté commerçant.
  Le client saisit son prénom + téléphone/email (ou choisit son profil s'il existe),
  tourne la roulette animée (roue en CSS/canvas avec les lots du commerce, animation
  de rotation + résultat), gagne un lot.
- Anti-abus simple : 1 tirage par client et par jour (vérifié sur les tirages
  enregistrés en localStorage, message clair si déjà joué aujourd'hui).
- Lots configurables depuis Réglages (texte libre + probabilité simple, ex. 30 %).
- Après le jeu, invitation à partager son expérience sur Google : bouton « Laisser
  un avis Google » (lien Google du commerce, nouvelle fenêtre) + texte explicite
  « Le lot n'est pas conditionné à l'avis — gagnez d'abord, avis libre ensuite ».
- Historique des gains visible dans le Tableau de bord.

## Module 3 — Réponses aux avis Google
- Liste des avis du commerce actif (données seed + avis ajoutés via la démo) :
  auteur, note (étoiles), texte, date, statut (sans réponse / brouillon / répondu).
- Pour chaque avis : modèles de réponse prêts en 1 tap (5★ chaleureux, 4★, avis
  négatif empathique, avis sans texte), texte éditable, bouton « Marquer comme répondu ».
- Réglages d'automatisation (interrupteurs simples, dans Réglages) :
  « Répondre automatiquement aux 5★ » (réponse modèle appliquée aussitôt, marquée
  « auto »), « Proposer un brouillon pour les autres ». Pas de règles complexes.
- Badge « Démo — avis simulés, aucune connexion à Google » visible sur l'écran.

## Règles strictes
- Aucune clé API réelle, aucun envoi réel. Tout local (localStorage).
- Ne crée aucun dépôt GitHub, ne pousse rien, ne publie rien, ne dépense rien.
- Ne pose aucune question : tranche toi-même, consigne dans JOURNAL.md.
- À la fin : `npm install` (si nouvelle dépendance), `npm run build` (corrige
  jusqu'à ce que ça passe), `git add -A && git commit -m "Phase 2 : fidélité + roulette + avis"`.
- Mets à jour JOURNAL.md. Résume : ce qui marche, ce qui est simulé, comment tester
  chaque module (parcours exact, en 2-3 phrases par module).

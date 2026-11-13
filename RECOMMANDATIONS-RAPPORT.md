# Recommandations 1, 3, 4 — Rapport

_Extension validée par l'utilisateur le 13/11 à 21:09 (idées n°1, 3 et 4 de la liste de concepts du 13/11 08:20), déploiement production autorisé. Suite de la mission FIX-409 (voir `FIX-409-RAPPORT.md`). Claude Code produit, relecture ligne à ligne par l'assistant (Codex indisponible jusqu'au 16/11). Aucun envoi réel, aucune dépense, aucune probabilité de lot modifiée._

## Lot R1 — Instants gagnants + heures creuses ACTIVÉS en production

### Partie code — le règlement généré couvre les deux mécaniques (préalable posé dès la roue v2)

Avant ce lot, `src/lib/reglement.ts` ne disait rien des instants gagnants (D1) ni des heures creuses (D2) : les activer sans texte de règlement aurait violé la condition posée à la refonte de la roue. Le générateur expose maintenant, **seulement quand la mécanique est configurée pour le commerce** :

- `DonneesReglement.instantsGagnants` : un item par lot physique avec `instantsParJour > 0` (`{ lot, parJour }`) — jamais les heures tirées, jamais `instantsParJour` ni `plagesOuverture` dans les données publiées (fuite testée) ;
- `DonneesReglement.heuresCreuses` : `{ lots, creneaux }` quand des créneaux existent ET qu'au moins un lot est marqué.

Paragraphes FR/EN en section 4 (Dotations), après le paragraphe quotas/stocks, structure de blocs strictement parallèle (parité testée) et règles de sobriété respectées (ni prix, ni pourcentage, ni mot de promesse). Exemples produits avec la configuration réelle d'Asian Home :

- FR : « Instants gagnants — chaque jour, 2 instants sont tirés au hasard pendant les horaires d'ouverture, sans être annoncés à l'avance : le premier tirage effectué dans les 5 minutes qui suivent l'un de ces instants remporte le lot « Mochi offert » (un seul lot par instant). »
- FR : « Heures creuses — pendant les créneaux du lundi au jeudi de 15 h à 18 h (heure de Paris), le lot « Thé glacé maison offert » entre dans la roue et les points de fidélité attribués en consolation sont doublés. »

Tests : 6 ajoutés dans `tests/ecrans-client-r4.test.ts` (aucun test existant modifié) ; suite complète **1690/1690**, typechecks front et serveur verts. Branche `reco/r1-reglement` (`b6c2038`), fusions `--no-ff` dans `autonome/integration` (`fcc2e16`) puis `master` (`05f7360`), déploiement production vérifié (santé OK, asset `index-DgMOdWxu.js`).

### Partie données — paramètres exacts posés en production (Asian Home, `c-asian-home-paris`)

Posés par `PATCH /commerces/c-asian-home-paris` (script `node_modules/.cache/reco/activation-r1.mjs`, répété d'abord sur le staging) :

- lot **« Mochi offert »** : `instantsParJour: 2` (2 instants gagnants par jour, générés dans les plages d'ouverture — le commerce n'a pas de `plagesOuverture` propre, les services par défaut 11:30–14:30 / 18:30–23:30 s'appliquent) ;
- lot **« Thé glacé maison offert »** : `heuresCreuses: true` ;
- commerce : `creneauxCreux: [{ jours: [1, 2, 3, 4], debut: '15:00', fin: '18:00' }]` (lundi à jeudi, 15 h 00 – 18 h 00, heure de Paris).

**Aucune dérive** : le script compare l'état complet du commerce avant/après (sauvegarde `activation-r1-prod-avant-*.json`) — probabilités inchangées (Nems 20 %, Thé glacé 25 %, Mochi 15 %, −10 % 10 %, points 30 %), plafonds journaliers inchangés (10 sur les 4 lots physiques), aucun autre champ touché. Sur le staging, la même écriture a en plus normalisé les anciens lots de démonstration (ids stables et `type` explicites écrits par le validateur roue v2) — normalisation documentée du serveur, sans effet sur les réglages.

### Vérifications en production

- `GET /commerces/c-asian-home-paris/reglement` : `instantsGagnants = [{ lot: 'Mochi offert', parJour: 2 }]`, `heuresCreuses = { lots: ['Thé glacé maison offert'], creneaux: [lun–jeu 15:00–18:00] }`, aucune fuite (`instantsParJour`, `plagesOuverture` absents) ; texte généré par le code de la page : paragraphes présents (voir citations ci-dessus).
- Fiche publique du jeu un vendredi ~22 h (hors créneau) : lots servis = Nems offerts, Mochi offert, −10 % sur l'addition, points — le lot heures creuses est absent de la roue et `bonusCreux` est absent, comme conçu (D2) ; pendant un créneau (lun–jeu 15 h–18 h), le lot réapparaît et le badge « Bonus heures creuses actif » s'affiche.
- Consolation doublée pendant les créneaux et consommation des instants : mécaniques D1/D2 déjà couvertes par leurs suites (`instants-gagnants-d1`, `heures-creuses-d2`) ; le correctif FIX-409 a par ailleurs réparé en production le CAS `meta` dont dépend la consommation des instants.

Page du règlement : https://asian-home-fidelite.onrender.com/#/reglement/c-asian-home-paris

## Lot R3 — QR par table pour le jeu

Le QR imprimé sur chaque table ne servait qu'à commander ; il sert maintenant aussi à jouer, et le tirage retient la table d'origine.

- **Lien** : `#/jouer/<commerceId>/<jetonTable>` (le routeur lisait déjà le second paramètre). Les Réglages → Commande à table offrent, par table, un bouton « Copier le lien du jeu » à côté de « Copier le lien » (commande) ; la page de commande d'une table affiche aussi un lien « 🎡 Jouer et gagner » vers le jeu de la même table.
- **Serveur** (`POST /commerces/:id/tirages`) : le corps peut porter `jetonTable` ; le nom de la table est résolu **côté serveur** parmi les tables configurées du commerce — indépendamment de l'interrupteur commande (un QR reste valable pour jouer même commande éteinte). Jeton inconnu, absent ou non textuel : tirage normal, sans table, **jamais d'erreur**, et jamais un nom venu du navigateur. Le tirage porte alors `table: '<nom>'` (`Tirage.table?`, absent sinon). Tirage 100 % serveur et règle 1×/jour inchangés ; la réponse publique ne change pas.
- **Page de jeu** : le jeton de l'URL accompagne le tirage (via l'adaptateur d'API existant, sans toucher aux appels épinglés par les tests) ; le nom de la table s'affiche en pastille discrète « 🍽 <table> » dans l'en-tête, résolu par la route publique existante ; échec de résolution (QR inconnu, commande éteinte pour l'affichage du nom) : rien ne s'affiche et la partie se joue normalement — le serveur, lui, rattache quand même la table au tirage.
- **Commerçant** : le tableau de bord affiche une carte « Parties par table (aujourd'hui) » (jour de Paris, helper pur `compterPartiesParTable` dans `src/lib/stats.ts`, testé aux bornes de minuit été/hiver), seulement quand au moins une partie du jour vient d'une table.

Tests : 12 ajoutés (`tests/jeu-table-r3.test.ts`, nouveau fichier — serveur HTTP : jeton valide → table stockée, jeton inconnu + faux nom → aucune table, sans jeton → aucune table ; helper ; routeur ; sources). Suite complète **1702/1702**, 113 fichiers. Branche `reco/r3-jeu-table` (`b918a46`), fusions dans `autonome/integration` (`4adcc7f`) puis `master` (`c4251f2`).

**Point de vigilance bundle** : la page de jeu fait partie du bundle initial ; le lot y a ajouté le strict nécessaire et récupéré des octets en déplaçant deux jeux de classes Tailwind vers `src/index.css` (rendu identique). Mesure finale : **484 379 o / plafond 484 422 o — marge de 43 o**. Tout ajout futur au bundle initial devra d'abord récupérer des octets (technique CSS) ou passer en différé.

**Vérification staging** (script `node_modules/.cache/reco/verif-r3-staging.mjs`) : route publique du nom → « Table 3 » ; inscription + visite validée (le commerce staging est en mode « visite validée ») puis tirage avec le jeton de la Table 3 → tirage stocké avec `table: 'Table 3'` ; tirage avec un jeton inconnu → tirage normal, **aucune** table. En production : déploiement vérifié (santé OK, route publique du nom de la Table 1 répond « Table 1 ») — aucun tirage de test créé en production (pas de fausse donnée client) ; le chemin serveur est prouvé par les tests et le staging, le commerce production est en mode libre.

## Lot R4 — Écran vitrine / mode TV

Nouvelle page publique `#/vitrine/<commerceId>`, pensée pour une TV en salle : aucun clic, curseur masqué, très grandes typographies, fond nuit avec la couleur d'apparence du commerce en accent.

- **Rotation automatique** des vues toutes les 12 s (fondu 1 s) : **Roue** (nom du commerce en très grand, roue décorative en dégradé conique reprenant les lots du jour — un tour en 60 s — et les lots en grande liste), **Gains** (« Ils ont gagné chez nous », prénoms et lots en très grand ; phrase d'attente si aucun gain), **Plats** (les plats photographiés du menu en plein cadre, fondu toutes les 6 s, nom en surimpression — vue sautée s'il n'y a aucune photo). **QR « Scannez pour jouer » permanent** en coin (vers le lien court du jeu), nom du commerce en haut. **Rechargement des données toutes les 60 s** ; les minuteurs ne tournent pas onglet masqué et sont nettoyés au démontage. `prefers-reduced-motion` : roue immobile, changements instantanés.
- **Nouvel endpoint public** `GET /commerces/:id/derniers-gains` (limité par IP comme la fiche) : les 8 derniers lots physiques gagnés sur 30 jours, du plus récent au plus ancien, sous la forme `{ prenom, lot }` **uniquement** — ni contact, ni code de gain, ni date, ni identifiant ; un gain sans prénom est omis ; 404 si le commerce est inconnu. Lecture bornée (au plus 40 clients lus, une fois chacun).
- **Accès commerçant** : Réglages → onglet Carte, bloc « Écran vitrine (TV) » avec l'adresse complète et le bouton « Ouvrir l'écran vitrine » (nouvel onglet).
- Page en **français direct** (aucune garde n'exige la traduction d'une nouvelle page publique ; les états d'erreur réutilisent des libellés déjà traduits).

Tests : 8 ajoutés (`tests/vitrine-r4.test.ts`, nouveau fichier — routeur ; endpoint : sélection, ordre, plafond 8, exclusions points/perdants/sans-prénom/> 30 jours, JSON sans champ interdit, 404/405 ; sources). Suite complète **1710/1710**, 114 fichiers. Branche `reco/r4-vitrine` (`63249fd`), fusions dans `autonome/integration` (`8239ea0`) puis `master` (`4158bee`).

**Adaptations de registres (les deux seules, autorisées par le mandat)** : `corps-sombres-p1-d2` (la vitrine rejoint les pages sombres) et `performance-bundle-p2-q2` (la vitrine rejoint les pages différées) — même précédent que Bienvenue/Commande/Cuisine pendant Experience. Aucun autre test existant modifié.

**Bundle** : la page est un chunk différé ; l'enregistrement coûtait +272 o sur un bundle déjà à 43 o de marge — récupérés par le déplacement des classes de l'en-tête, du cadre, du bandeau hors-ligne et de la barre mobile d'`App.tsx` vers `src/index.css` (rendu identique). Mesure finale : **484 259 o**, marge portée à 163 o, plafond inchangé.

**Vérifications** : captures Playwright 1920×1080 des trois vues (normales et mouvement réduit) relu par l'assistant — elles ont révélé et fait corriger un vrai bug : le fond blanc du QR était assombri par le thème des pages sombres (QR illisible), corrigé par la surface claire dédiée. Sur le **staging**, l'endpoint a rendu en réel le gain de la vérification R3 : `{ "gains": [{ "prenom": "Vérif", "lot": "Nems offerts" }] }` (les tirages « Dommage ! » correctement exclus). En **production** : déploiement vérifié (santé OK, endpoint 200, page servie).

**Lien production : https://asian-home-fidelite.onrender.com/#/vitrine/c-asian-home-paris** — à ouvrir en plein écran sur la TV du restaurant (l'adresse est aussi dans Réglages → Carte).

## Récapitulatif de l'extension

| Lot | État | Preuve principale |
|---|---|---|
| R1 — Instants gagnants + heures creuses | **Actif en production** | règlement public à jour ; Mochi 2 instants/jour ; Thé glacé en heures creuses lun–jeu 15 h–18 h ; diff avant/après sans dérive |
| R3 — Jeu depuis le QR de table | **En production** | staging : tirage stocké `table: 'Table 3'`, jeton inconnu ignoré ; prod : route publique des tables vérifiée |
| R4 — Écran vitrine TV | **En production** | endpoint vérifié en réel sur staging ; captures 1920×1080 relues ; lien ci-dessus |

Suite complète finale : **1710/1710** (114 fichiers), typechecks front et serveur verts, bundle initial 484 259 o sous le plafond de 484 422 o. Aucune probabilité de lot, aucune règle de fidélité, aucun prix touchés ; aucun envoi réel ; aucune dépense. Relecture Codex : toujours en attente de son retour de quota (16/11) — relectures ligne à ligne de l'assistant et contre-épreuves par les suites, comme pour les lots précédents.

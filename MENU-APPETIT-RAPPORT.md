# Menu Appétit — rapport de mission (14/11/2026)

**État : TERMINÉ sur staging, production NON touchée.** La grammaire des menus gagnants (recherche
`~/workspace/research_notes/menus-interactifs-mondiaux-20261114-1213/report.md`, prototype validé par
l'utilisateur le 14/11) est intégrée aux composants existants — rien n'a été reconstruit.
Branche `appetit/menu` (depuis master `c5ce0d5`), fusionnée `--no-ff` dans `autonome/integration`
(fusion `b9524ea`) pour le seul déploiement staging. **Aucune fusion master, aucune écriture
production** (vérifié en fin de mission : master toujours à `c5ce0d5`, fiche publique production
sans `servicesCommande`).

Coordination : Claude Code a produit en 3 lots séquentiels ; le coordinateur a relu chaque diff
ligne à ligne, relancé la suite complète après chaque lot et fait des contre-épreuves par mutation.
Codex indisponible jusqu'au 16/11 — aucune validation fictive ; relecture Codex de rattrapage possible.

## Ce qui a été construit, point par point

1. **Ajout en un toucher + stepper en place** — La page commande avait déjà le stepper sur les lignes
   simples ; il est conservé et généralisé (lignes de catégorie, rail Signatures, services) avec les
   quantités lues depuis le panier existant, sans duplication d'état. Sur `#/menu` Découverte (page
   sans panier par conception), pas de stepper : voir « Écarts ».
2. **Barre panier collante** — Existante sur `#/commande` (visible dès 1 article, total recalculé) ;
   elle reçoit les ancres `data-barre-panier` / `data-bouton-panier` pour l'animation. Aucune barre
   ajoutée en découverte pure.
3. **Micro-animation d'ajout** — Nouveau `src/lib/volPanier.ts` : la vignette du plat (ou une pastille
   « + ») vole vers la barre en 450 ms (WAAPI), puis le bouton panier pulse (500 ms). Stepper +/− :
   pulsation seule. Tout est coupé par `prefers-reduced-motion` (garde lue avant tout effet) et sans
   barre présente. Rien d'autre n'a été animé en mode Commande.
4. **Rail « Signatures »** — Sur `#/menu`, le rail « En photos » devient « ★ Signatures » (titre
   visible ; l'aria-label historique « En photos », épinglé par les tests, est conservé) : mêmes 11
   vraies photos, même défilement lent et rail vivant des cycles animations, pastille « ★ Signature »
   sur les tuiles concernées sans changer leur taille. Sur `#/commande`, un rail Signatures sans
   défilement automatique (mode commande sobre) permet l'ajout rapide et ouvre la fiche.
5. **Héros par catégorie** — Audit complet sur la carte réelle (16 catégories) : chaque catégorie qui
   avait déjà une vraie photo l'utilise déjà (`photoCategorie`), les autres gardent l'univers coloré
   du cycle 1 ; **aucune vraie photo de catégorie inutilisée n'existe** → aucun branchement forcé, et
   l'élargissement de la règle de mots-clés (ex. « California ») n'a pas été fait (ce serait changer
   une règle, pas brancher une photo). Cycles animations 1–5 intacts (voir tests).
6. **Lignes typographiques** — Les 70 plats sans photo de `#/menu` sont désormais des lignes dessinées :
   numéro continu sur toute la carte (1 à 81, calculé sur la carte complète — un plat garde son
   numéro quel que soit le filtre de recherche, vérifié en navigateur), nom en `font-titre`, pastilles
   conservées, pointillés, prix en magenta-300 grand gras (contraste calculé ≥ 4,06:1 au pire halo,
   texte « large » AA), description tronquée à 2 lignes, même fiche dépliée au toucher que les cartes
   photo. Aucune case vide, aucun placeholder. Les deux rythmes cohabitent dans l'unique liste par
   catégorie, dans l'ordre de la carte (contrainte d'un test du cycle animations 3 — voir « Écarts »).
7. **Demandes de service à 0 €** — Liste canonique définie côté code partagé
   (`src/lib/servicesCommande.ts` : Appeler le serveur, De l'eau, Des baguettes, L'addition), jamais
   par le navigateur. `calculerCommande` (serveur) n'accepte que ces ids, nom canonique, prix figé à
   0, aucune option ; module coupé → **même refus qu'un plat inconnu** (aucune fuite d'existence).
   Réglage `commande.services` (défaut : absent = désactivé, y compris pour les futurs commerces),
   interrupteur dans les Réglages, publié au client via `servicesCommande` seulement si commande
   active + services + au moins une table. Section « À votre service » sur `#/commande`, lignes
   « Service » / « — » au panier et au suivi, pastille « Service » en cuisine, mêmes statuts que les
   plats. Contre-épreuves : voir « Mutations ».
8. **Fiche plat en feuille basse** (`#/commande`) — Remplace l'expansion en ligne : grande photo si
   elle existe (jamais de substitution), description, options (markup épinglé conservé), note,
   quantité, bouton d'ajout collant avec prix total ; voile, Échap, focus initial et rendu du focus.
   Suggestion unique « À découvrir aussi » : premier plat photographié et commandable après le plat
   courant dans l'ordre du menu (déterministe, aucune statistique) ; le toucher bascule la feuille.
9. **« Encore la même »** — Bouton au suivi (sauf commande refusée) : `reconstruirePanier` rebâtit le
   panier aux **prix du menu courant** depuis les lignes stockées ; plat disparu, devenu non
   commandable ou dont une option n'existe plus → signalé dans `ignores` (note ambre au panier),
   jamais substitué ; services repris seulement si le module est actif. L'envoi repart dans le flux
   existant : la clé d'idempotence précédente a été soldée et effacée à la première commande, une
   nouvelle paire est donc tirée (raisonnement vérifié dans les notes du lot 2, confirmé par le test
   E2E : 2 commandes distinctes).

## Tests et contre-épreuves (chiffres relancés par le coordinateur)

| Étape | Suite complète (npm test) | Typechecks |
|---|---|---|
| Avant (master `c5ce0d5`) | 1784/1784 (boucle animations) | — |
| Lot 1 (services, socle) | **1801/1801** | tsc + serveur OK |
| Lot 2 (page commande) | **1814/1814** | tsc + serveur OK |
| Lot 3 (menu Découverte) | **1824/1824, 122 fichiers** | tsc + serveur OK |

Nouveaux fichiers : `tests/appetit-services.test.ts` (17), `tests/appetit-commande.test.ts` (13),
`tests/appetit-menu.test.ts` (10). Aucun test existant modifié. Le lot 2 a aussi été vérifié en vrai
Chromium (Pixel 7) par la session productrice : fiche, suggestion, rail, service, panier, commande,
« Encore la même » avec plat devenu indisponible, vol WAAPI présent — aucune erreur console.
Un échec isolé de `ecrans-commercant-p1-c6` a été observé une fois pendant le lot 2 (test déjà
connu comme instable), vert seul et dans les courses complètes du coordinateur.

**Mutations du coordinateur (toutes détectées, fichiers restaurés)** :
- porte `servicesActifs` retirée de `calculerCommande` → les 2 tests de sécurité services rougissent
  (unité + HTTP « commerce sans services ») ;
- porte `servicesActifs` retirée de `reconstruirePanier` → le test « services ignorés si module
  coupé » rougit ;
- condition `p.photo` retirée de `suggestionApres` → le test de suggestion rougit ;
- numérotation recalculée par catégorie dans `numerosPlats` → les 2 tests de continuité rougissent.

## Bundle et mesures labo

- **JS initial : 484 352 o ≤ plafond 484 422 o** (mesure du coordinateur, `mesure-bundle.mjs` :
  entrée 371 198 + chunks initiaux) ; CSS 104 215 o ; **32 chunks** (nombre épinglé respecté) ; le
  gros des lots vit dans les chunks différés Commande/MenuPublic.
- Script officiel `scripts/mesurer-scores.mjs` : son étape « scan → tirage » échoue
  (`[data-attente="en-cours"]` jamais visible) **à l'identique sur master et sur la branche** —
  panne préexistante de l'environnement du jour, sans rapport avec ce chantier (le flux jeu n'est
  pas touché). Mesures refaites avec un harnais dédié (même protocole SCORES : Pixel 7, Slow 4G,
  CPU ×4, carte réelle injectée par API, témoin `#/jouer`, couples avant/après alternés) :
  - FCP menu : avant {1 216 ; 1 440 ms}, après {1 232 ; 1 612 ms} — écart dans le bruit de charge
    (le témoin `#/jouer` varie de ±25 % dans la même fenêtre) ;
  - LCP menu : avant {6 912 ; 11 056 ms}, après {6 828 ; 8 312 ms} — après ≤ avant sur les deux
    couples, même élément LCP (photo de plat) ;
  - **CLS : 0 partout** (avant comme après).
  Les valeurs absolues de cette fenêtre sont gonflées par la charge de la VM pour les deux versions
  (témoin compris) : la conclusion portée est « aucune régression attribuable à Appétit », pas un
  chiffre absolu.

## Preuve staging (obligatoire — faite le 14/11/2026)

- Déploiement : push `autonome/integration` `5fd855a → b9524ea` ; nouvel asset servi vérifié
  (`index-CGPWMS2p.js`) ; chunk Commande servi contient « votre service », chunk MenuPublic contient
  « Signatures », CSS servie contient `ligne-typo`.
- Activation **staging uniquement** : PATCH de la config commande d'Asian Home staging avec
  `services: true`, les 8 tables et leurs jetons réémis à l'identique (contrôle avant/après :
  jetons inchangés) ; fiche publique staging : `servicesCommande: true`. Production : non fait.
- Commande de preuve (Table 3 staging, jeton connu) : `POST /commandes` →
  **HTTP 201**, commande `e7be0e72-2915-49f8-8ec7-8053b1936f1e`, 3 lignes —
  Pad Thaï (plat photographié) 1 390, Edamame (plat sans photo) 400,
  **« De l'eau » 0 avec `service: true`** — total **1 790** (17,90 €, le service n'ajoute rien).
- Cuisine : la commande est retrouvée dans la liste du jour (PIN commerçant) avec ses 3 lignes et le
  drapeau service ; transitions par les vraies routes : `acceptee` → `en_preparation` → `servie`,
  état final relu : **servie**.

## Écarts au brief et au prototype (assumés, documentés)

1. `#/menu` n'a pas de mode commande dans l'app actuelle (aucun jeton de table n'y arrive) : la
   barre panier et le stepper y sont donc sans objet — la garde du point 2 (« pas de fausse barre en
   découverte ») est respectée par construction. Les points 4, 5, 6 y sont pleinement livrés.
2. Lignes typographiques dans la même `<ul>` que les cartes photo (une seule liste par catégorie,
   ordre de la carte) au lieu de deux blocs séparés : un test du cycle animations 3 épingle la
   structure ; les deux rythmes restent visuellement distincts et ne se mélangent pas dans une même
   ligne.
3. `prefereMouvementReduit` recopié en une ligne dans `volPanier.ts` plutôt qu'importé de
   `menuClient.ts` : l'import créait un chunk partagé de plus (32 → 33) et +41 o d'initial, ce que
   les portes interdisent. Même règle, un seul comportement.
4. La traduction « Signatures », partagée entre `#/menu` et `#/commande`, vit dans le dictionnaire
   central `TRADUCTIONS_EN` (deux tests épinglés interdisaient le bloc différé pour cette page) :
   +24 o de JS initial, dans le plafond.
5. `reconstruirePanier` reçoit le menu « prix non confirmés masqués » (celui affiché par la page) :
   un plat affiché « Prix sur place » n'est pas repris en silence.
6. Prototype : ni le classement « les plus commandés » (aucune donnée réelle — activable le jour où
   le volume de commandes existera, la structure de données le permet déjà), ni le moteur de
   tournées (Asian Home est à la carte ; idée produit Komeback), ni aucune image de substitution
   n'ont été repris — conformément au hors-périmètre.

## Reste à faire (hors de ce chantier)

- **Production : en attente du mot de l'utilisateur** après sa revue du staging
  (https://asian-home-fidelite-staging.onrender.com — menu `#/menu/c-asian-home-paris`, commande via
  le QR Table 3 staging). La fusion master + l'activation de `commande.services` pour Asian Home en
  production seront alors deux gestes séparés et vérifiés.
- Relecture Codex de rattrapage après le 16/11 (diffs des 3 lots).
- Le levier n°1 reste la photographie des ~70 plats sans photo : chaque nouvelle vraie photo
  alimente automatiquement le rail Signatures, les héros et les plat-stars.

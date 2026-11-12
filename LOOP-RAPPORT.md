# Boucle d'amélioration « roue v2 » — rapport final (12/11/2026)

Branche de la boucle : `boucle/roue-v2`, fusionnée dans `autonome/integration`.
Base de départ : `autonome/integration` @ a46eac2 (tests 1333/1333). Production et master : NON touchés.
Chaque lot : Claude Code (production), revue Codex du diff, correctifs, suite complète verte avant commit.

## Phase 1 — Refonte de la roue (modèle décidé le 12/11)

| Point du mandat | Lot | Commit(s) | Preuve |
|---|---|---|---|
| 2. Types de lots structurés | R1 | 4a4112a, 802fcf2 | types lot/points/perdant, ids stables, libellés uniques validés serveur, tirage par id ; 1355 tests |
| 1, 3, 6, 7. Accès libre, consolation points, plafonds/jour, limite mensuelle | R2 | 6643d0a, 9065f4c | modeAccesRoue (défaut libre pour les nouveaux commerces, inchangé pour les existants), plafondJour, limiteGainsMois (défaut 4), consolation créditée en transaction ; 1383 tests |
| 4, 5. Gain J+1→J+30, code burn-on-reveal 10 min | R3 | edd19f5, f1bf0fd | statuts enAttente/utilisable/remis/expiré en jours parisiens, activation serveur, code servi uniquement par l'activation ; 1407 tests |
| 8. Écrans client + règlement | R4 | da8463b, 4db69b4 | « À gagner aujourd'hui », page #/reglement générée (FR/EN), gain sur la carte avec activation et compte à rebours synchronisé serveur ; 1433 tests |
| 10, 11. Son WebAudio + couleur du commerce + roue premium | R5+R8 | ad2de24, f9268b9 | tics/motif WebAudio chargés au clic, bouton on/off mémorisé, palette dérivée de la couleur du commerce (contrastes vérifiés sur toutes les couleurs acceptées), anneau profond, poursuite lumineuse, sheen, rebond du pointeur ; 1459 tests |
| 2/6/7 côté UI + 9. Réglages Roulette + aperçu/tirage de test | R6 | b7dc14f, bbbc4bc | sélecteur de type, plafond, mode d'accès, limite, aperçu sans aucun appel réseau ; bug corrigé : mode/limite n'étaient jamais envoyés par le store ; 1484 tests |
| 12. Relance « gain bientôt expiré » | R7 | edc8d56, ef78382, fb71688, 81127d3 | < 72 h, une par gain, réclamation atomique par tirage, erreurs ambiguës = incertain (jamais de renvoi, même au-delà de 50 envois) ; mode test Brevo inchangé (en-tête sandbox, aucun envoi réel) ; 1555 tests |
| Item A. Prénom à l'inscription | — | BLOQUÉ, voir § Item A | autorisation reçue pour relances-ui-p1-b3, mais un second test épinglé (entree-qr-p1-c1) interdit le champ avant tirage : décision utilisateur supplémentaire requise |

## Phase 2 — Différenciateurs

| Point | Lot | Commit(s) | Preuve |
|---|---|---|---|
| 13. Instants gagnants | D1 | 3a106d7, 1b9f139 | instants crypto dans les plages d'ouverture (défaut Asian Home 11h30–14h30 / 18h30–23h30, réglable), générés à la 1re utilisation du jour, fenêtre 5 min, jamais exposés avant l'heure (route commerçant : instants passés seulement), plafond du lot consomme l'instant, limite du client le préserve, génération hors heure inexistante (changement d'heure) ; 1518 tests |
| 15. Simulateur de coût + KPI d'utilisation | D3 | dc801dd | coût attendu/tirage = Σ(probabilité normalisée × coût unitaire), projection mensuelle (moyenne des tirages/jour sur 14 j), carte « Gains de la roue » : taux d'utilisation = remis ÷ (remis + expirés) sur 30 j, en attente, expirés et leur valeur ; 1532 tests |
| 14. Heures creuses | D2 | a3e2290 | créneaux jours+heures par commerce, lots marqués exclus hors créneau (roue publique incluse), consolation doublée pendant le créneau (montant stocké + pointsDoubles), drapeau public bonusCreux ; 1544 tests. **Écart : le badge client « Bonus heures creuses actif » n'est PAS affiché** — il coûtait +308 o de JS initial pour une marge de 3 o sous le plafond épinglé de 481 376 o ; le drapeau est servi, le badge se branche dès que le plafond est relevé ou le code du jeu découpé. Le mode démo local ignore aussi les créneaux (tirage serveur non concerné). |

## Phase 3 — Tours de boucle

- **R-t1 polish visuel roue** (a11f05a, captures avant/après : node_modules/.cache/boucle-roue/captures-polish1-avant/ et -apres/) : libellés de la moitié gauche retournés (lisibles au repos), couleur du commerce étendue au cadre, à la légende et à l'anneau du bouton son (contrastes ≥ 4,5:1, y compris couleurs quasi noires), émoji 🎡 du bouton « Tourner » remplacé à l'écran par un signe dessiné en CSS, titre de légende ramené dans la palette. Bundle JS initial même réduit (481 373 → 481 283 o).
- **Correctif E2E** (06b3cf1) : la vérification finale a attrapé une vraie régression tactile — les champs ajoutés par D1/D2 écrasaient la rangée des lots (flex), la page Réglages dépassait l'écran (441 px) et les clics tombaient à côté sur mobile. Corrigé par des largeurs minimales (les champs passent à la ligne). Trouvé par la suite E2E, pas par les tests unitaires.
- **Note DA de l'écran de jeu : 9/10 (avant la boucle) → 9,5/10 (R5+R8) → 9,7/10 (R-t1). La cible 10/10 n'est PAS atteinte.** Ce qui manque encore, franchement : (1) avec une couleur de commerce personnalisée, le bouton « Tourner » et l'en-tête de page restent magenta (hors du cadre qui porte la couleur ; les peindre exigerait du JS initial au-delà du plafond ou une garantie de contraste impossible pour toute couleur) ; (2) les libellés longs restent tronqués (« Dessert… ») par la règle épinglée des 12 caractères ; (3) les numéros de secteur (roues à plus de 8 lots) ne sont pas retournés en bas de roue ; (4) les perles lumineuses de l'anneau dépassent encore légèrement la largeur d'écran (425 px au lieu de 412, sans bloquer les clics — correctif dédié à prévoir).

## Item A — prénom à l'inscription : DÉCISION REQUISE

L'autorisation du 12/11 14h23 visait tests/relances-ui-p1-b3.test.ts (~l.56). En exécutant, un SECOND verrou est apparu, non couvert par l'autorisation : tests/entree-qr-p1-c1.test.ts (règle P1-C1 « le prénom n'est ni demandé ni envoyé avant le tirage ») :
- l.95 : le formulaire d'entrée contient exactement 2 champs (contact + consentement) ;
- l.112 : le formulaire ne doit contenir ni `prenom`, ni `Prénom`, ni `given-name` ;
- l.113 : la signature d'envoi est épinglée sans prénom.

Contourner la regex aurait trahi la règle : le chantier s'est arrêté sans rien modifier (rapport détaillé : node_modules/.cache/itemA/rapport-itemA.md). Vérifié au passage : le serveur n'écrase jamais un prénom existant (la ré-inscription renvoie le client sans le modifier), et le prénom demandé après le tirage existe déjà.
Pour débloquer : (1) autoriser la modification de ces 3 lignes d'entree-qr-p1-c1 (abandon de la règle « prénom après le tirage seulement ») ; (2) trancher le plafond du bundle JS initial (481 376 o, marge actuelle 93 o — un champ de plus dans Jouer.tsx le dépasserait probablement : relever le plafond ou sortir un module du chargement initial).

## Modifications de tests existants (liste exacte)

1. R3 (revue Codex) : le test épinglé des exports CSV (code-gagnant-p0-s19) — l'export ne contient plus le code du gain, remplacé par le texte de statut ; conséquence directe du burn-on-reveal (point 5 du mandat).
2. R6 : tests/ecrans-commercant-p1-c7 — compteur de champs de Réglages 26 → 30 (les 4 champs imposés par le brief : type, points, plafond, mode d'accès).
3. R7 correctif 2 : 5 tests simulaient un refus prestataire par un HTTP 500 ; ils utilisent un 400 (un 500 est désormais « incertain » par conception, revue Codex) : relances-p1-b3, correction-codex-point9, correction-codex-point10, revue, relance-gain-r7. Intention conservée.
4. D1 : ecrans-commercant-p1-c7 — champs 30 → 34 (case + nombre d'instants, début/fin de plage) ; reglages-roulette-r6 — `instants` ajouté à la liste des champs désactivés d'une ligne au libellé vide.
5. D1 correctif : dans instants-gagnants-d1, l'assertion « le plafond prime » vérifiait l'ancienne règle de consommation pour un client limité ; elle vérifie la règle corrigée (instant préservé).
Aucune autre modification de test existant. L'adaptation de relances-ui-p1-b3 (item A) n'a PAS été faite (chantier arrêté avant, voir § Item A). Les champs D2 vivent dans un composant séparé : le compteur ecrans-commercant-p1-c7 ne les voit pas et n'a pas été modifié (à harmoniser si l'équipe préfère le comptage exhaustif).

## Chiffres finaux

- Tests unitaires/intégration : 1333 (base) → **1555/1555** (suite complète verte sur l'arbre final, typecheck serveur + `tsc -p .` inclus). README.md et SCORES.md à jour (1555, 104 fichiers).
- E2E locale (Playwright, Chromium) : **5/5**, dont le parcours nouveau modèle complet : scan → lots du jour + règlement → tirage libre → gain en attente → lendemain simulé (base de test du serveur E2E) → activation → code → remise en caisse ; et Réglages → Roulette (enregistrement, champs relus, tirage de test jamais enregistré).
- Bundle JS initial : 481 283 o / plafond 481 376 o (marge 93 o : tout ajout côté jeu exige un découpage préalable).
- DA écran de jeu : 9,7/10 (cible 10 — voir phase 3).
- Aucune migration SQL, aucun envoi réel (Brevo en mode test partout), aucun PIN touché, probabilités et prix des commerces inchangés.

## Limites connues (assumées, documentées dans le code)

- Concurrence multi-instances : écritures conditionnelles + sérialisation par commerce supposent une instance unique (hypothèse Render actuelle) ; sous Supabase, la borne des 10 minutes de la remise est calculée côté serveur juste avant l'écriture (une borne par l'horloge Postgres exigerait une migration).
- Supabase, colonne envois.modele (CHECK de la migration 0007) : la relance de gain partage la valeur `libre` → un message libre manuel OU une relance de gain par client et par jour sous Supabase ; le refus est journalisé (motif `collision_libre_gain`) et la relance repart à la tournée suivante.
- La sauvegarde admin exporte la table meta, donc les instants gagnants du jour à venir (accès admin uniquement ; la sauvegarde contient déjà des secrets).
- Le règlement généré ne mentionne pas encore les instants gagnants ni les heures creuses (hors créneau, ces lots n'y figurent pas) : compléter le règlement avant d'activer D1/D2 pour un commerce réel.
- Les champs Réglages ajoutés par D1/D2 ont rendu la page plus dense ; un débordement résiduel de 13 px vient des perles de la roue (voir phase 3, point 4).
- Tests instables observés une fois chacun puis verts aux repasses : « Cartiz sous Supabase : équipe… » (R2) et « Réafficher le code une fois » (ecrans-commercant-p1-c6, pendant R7 correctif 2). Cause non identifiée.

## Branches

- `boucle/roue-v2` : pointe finale 06b3cf1 (+ le présent rapport), fusionnée dans `autonome/integration` par merge --no-ff ; les deux branches sont poussées.
- Incident d'atelier : une tentative de parallélisation (3 worktrees, sessions Claude Code simultanées) a échoué — les sessions se neutralisent sur cette VM ; retour au séquentiel intégral, aucun travail perdu (les branches filles étaient vides). Trois runs ont aussi été tués par des arrêts du runtime (R3, R5+R8, R7 correctif 1) et repris depuis l'arbre sans perte.

## PRÊT POUR LA PRODUCTION : OUI, sous conditions

Ce qui serait déployé : `autonome/integration` après fusion de cette boucle (le nouveau modèle de roue complet : accès libre configurable, lots structurés, consolation points, gains J+1→J+30 à code de 10 minutes, plafonds, limite mensuelle, règlement généré, son et roue premium, relance d'expiration, instants gagnants, heures creuses, simulateur de coût et KPI d'utilisation), suite 1555/1555 et E2E 5/5.
Conditions avant déploiement :
1. Sauvegarde Supabase de production (à la charge du coordinateur principal, comme prévu).
2. Ne PAS basculer le réglage `modeAccesRoue` d'Asian Home en production sans décision explicite (staging seulement, conformément au mandat) ; le défaut « libre » ne s'applique qu'aux nouveaux commerces.
3. Compléter le règlement généré (instants gagnants) avant d'activer D1 pour un commerce réel.
4. Item A (prénom) et badge heures creuses : en attente des décisions listées ci-dessus ; ni l'un ni l'autre ne bloque le déploiement du reste.

# Expérience 10/10 — rapport final

Mission « Asian Home Experience » (master prompt de l'utilisateur, 13/11/2026), exécutée
sur **staging exclusivement**. Production (`master` 608752f) **intouchée** — aucune fusion
vers `master`. Trace complète : `EXPERIENCE-JOURNAL.md` (audits, critiques des cycles 1
et 2 aux 10 questions). Travail : branche `experience/accueil-commande`, fusionnée
`--no-ff` dans `autonome/integration` (**7864397**), branches poussées, staging
redéployé et vérifié (nouveau bundle servi, `/api/v1/sante` OK).

Organisation tenue : Claude Code = Engineering Lead (5 lots) ; critique produit/design
écrite par le coordinateur à chaque cycle ; **Codex indisponible (quota jusqu'au
16/11)** — aucune validation fictive : relectures ligne à ligne du coordinateur +
contre-épreuves par mutation à chaque lot (32 + 3 + 16 + 18 + 12 vérifiées, toutes
détectées après correction des assertions trop lâches).

## Ce qui a été livré

1. **Accueil immersif** — `#/bienvenue/<commerceId>` : héros plein cadre sur photo
   authentique, typographie « logo » (serif, capitales espacées), cascade d'apparitions
   maîtrisée, trois « moments » photo, boutons « Découvrir la carte », « Commander à
   table » (visible seulement si le module est actif ; sans jeton de table, une note
   explique le QR de table) et « Jouer et gagner ».
2. **Menu premium v2** (mode Découverte) : marquee lent du rail « En photos » (pause au
   toucher, coupé si mouvement réduit), révélations au défilement, en-têtes de catégorie
   en « moment » (nom en typographie logo sur la photo), dépliage fluide des fiches,
   micro-interactions — sans toucher ni aux prix, ni à la recherche, ni au scroll-spy.
3. **Module commande à table complet** (interrupteur par commerce, **désactivé par
   défaut**) : QR par table à **jeton secret** généré par le serveur ; parcours client
   `#/commande/<commerceId>/<jetonTable>` (mode Commande, zéro animation décorative) :
   menu, quantités, options **seulement si les données en portent** (aucune inventée),
   instructions par ligne et générales, panier, confirmation protégée par
   `cleIdempotence` + **secret généré par le client** (reprise propre après une réponse
   perdue), suivi du statut par polling 10 s avec reprise après rechargement.
   Sécurité serveur : prix et noms toujours relus du menu en base, produit inconnu /
   sans prix vérifié / indisponible refusé, table falsifiée rejetée, transitions
   d'état par comparaison-et-échange, isolation entre commerces, limite d'envois par IP.
   Stockage sans migration (table `meta`) — les tests épinglent 15 tables et les
   migrations 0001–0010.
4. **Écran cuisine** — `#/cuisine` (PIN commerçant) : commandes du jour par statut
   (Nouvelles / Acceptées / En préparation / Servies / Refusées), table en très grand,
   instructions surlignées, grandes cibles tactiles, conflits multi-appareils relus en
   silence, pastille « Nouveau », historique d'hier en lecture seule, polling 10 s.
   Onglet masqué quand le module est désactivé.
5. **Réglages « Commande à table »** : activation, tables et leurs QR (copie du lien,
   planche imprimable), case « Indisponible » par plat dans l'éditeur de menu, aide
   permanente levant la confusion entre les deux boutons d'enregistrement.
6. **Purge** : commandes de plus de 30 jours supprimées (opportuniste, jamais
   bloquante), clés d'idempotence orphelines rendues réutilisables.

Aucune fonctionnalité existante dégradée (carte, tampons, points, roue, parrainage,
relances, multi-commerces) ; aucune règle de fidélité modifiée ; aucun envoi réel ;
aucune dépense. Sur le staging, le module est désactivé pour Asian Home : aucune
commande de test ne peut parvenir au restaurant réel.

## Résultats des tests

- **Tests unitaires : 1666/1666 verts** (111 fichiers, typechecks front + serveur
  inclus) — base de départ 1570, soit +96 tests, tous relancés en suite complète à
  chaque lot.
- **E2E : 12/12** (9 anciens + 3 nouveaux) — le nouveau parcours
  `tests-e2e/experience-commande.spec.ts` fait jouer deux contextes Chromium isolés
  (client et cuisine) contre le même serveur : **simulation « deux téléphones »,
  étiquetée comme telle**, pas deux appareils réels.
- Une instabilité préexistante a resurgi une fois (`cartiz.test.ts`, lot 2 ; passé
  seul et aux relances complètes) — déjà consignée les 11–12/11, sans lien avec ce
  chantier.

## Performances (mesures de laboratoire locales — jamais des p75 terrain)

Protocole de la mission menu visuel (Pixel 7 simulé, Slow 4G, CPU ×4, navigateur
relancé à chaque passe ; détail dans `SCORES.md`) :

| Page | Avant | Après |
|---|---|---|
| Menu FCP | 676–688 ms (v1 remesurée) | 672–676 ms |
| Menu LCP | 2 372–2 432 ms (v1 remesurée) | 2 424–2 476 ms |
| Accueil `#/bienvenue` | — (nouveau) | FCP ≈ 670 ms, LCP ≈ 1 900 ms |
| Commande `#/commande` | — (nouveau) | FCP ≈ 680 ms, premier « Ajouter » ≈ 1 975 ms |
| CLS (toutes pages, menu après défilement complet) | — | **0 mesuré** |

Bundle initial : **484 018 o**, sous le plafond épinglé de 484 422 o (marge 404 o) ;
tout le nouveau code client est en chunks différés (Bienvenue, Commande, Cuisine…).

## Problèmes détectés et corrigés (sélection)

- **Suivi illisible après une réponse perdue** (relecture lot 1) : le secret est
  désormais généré par le client avant l'envoi — doublon + même secret = suivi lisible.
- **Faux retour d'enregistrement** dans Réglages (capture connectée, lot 4) : aide
  permanente + avertissement « modifiée, pas encore enregistrée » (micro-lot 5).
- « Table Table 4 » redondant (cuisine et commande), statut « En préparation » coupé,
  cartes cuisine étirées sur tablette : vus sur captures, corrigés.
- Clé d'idempotence orpheline = 409 éternel : traitée comme libre (lot 4).
- Assertions de mutation trop lâches (×3) : renforcées jusqu'à détection.

## Adaptations de tests existants (registres imposés par les nouvelles pages)

- `tests/corps-sombres-p1-d2.test.ts:23-24` (pages sombres : Bienvenue, Commande) ;
- `tests/performance-bundle-p2-q2.test.ts:33` (pages différées : Bienvenue, Commande,
  Cuisine). Chacune minimale, avec contre-épreuve (retirer la page fait échouer le
  test). Aucun autre test existant modifié ; les tests des lots 1b/2 adaptés sont ceux
  créés par cette mission.

## Améliorations restantes (hors boucle — la boucle s'arrête, gains plafonnés)

- **Validation humaine sur appareil réel** (fluidité des animations non mesurée en
  images/seconde ; captures = Pixel 7 simulé) : à faire sur le staging ci-dessous.
- **Activation réelle chez Asian Home** (décision commerçant/utilisateur) : enregistrer
  le menu officiel dans l'éditeur (la commande lit le menu enregistré, pas le repli
  public), créer les tables dans Réglages → Commande à table, imprimer les QR, activer
  l'interrupteur. Tant que ce n'est pas fait, la page commande affiche « Menu à venir ».
- **Commutateur FR/EN absent** de `#/bienvenue` et `#/commande` : un test existant le
  réserve à 3 pages clientes ; les pages suivent la langue choisie ailleurs et toutes
  leurs chaînes sont traduites. Déblocage = autorisation de modifier ce test.
- **70 plats sans photo** : le menu et l'accueil portent 11 photos vérifiées ; le reste
  attend les photos du restaurant (aucune image générée présentée comme authentique).
- Relecture Codex de rattrapage possible après le 16/11 sur
  `608752f..autonome/integration`.
- Lignes `meta` d'idempotence antérieures au cycle 2 devenues orphelines : traitées
  comme libres, volume négligeable, non balayées (l'interface de stockage n'énumère
  pas les clés).

## Liens de staging pour validation (service gratuit : réveil ~1 min possible)

- Accueil immersif : https://asian-home-fidelite-staging.onrender.com/#/bienvenue/c-asian-home-paris
- Menu premium : https://asian-home-fidelite-staging.onrender.com/#/menu/c-asian-home-paris
- Commande : via Réglages → Commande à table (activer le module sur le commerce de
  test ou Asian Home staging, créer une table, scanner son QR) — PIN commerçant du
  staging requis.
- Cuisine : https://asian-home-fidelite-staging.onrender.com/#/cuisine (PIN commerçant
  du staging).
- Santé vérifiée après redéploiement : `/api/v1/sante` OK (Supabase, migrations 4/4,
  aucun envoi possible sur le staging).

**Production : non touchée. Aucune fusion vers `master` sans autorisation explicite.**

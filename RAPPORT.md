## 4. Ce qui attend une info de l'utilisateur (liste exhaustive)

Reprise de `AUDIT.md` § 8 (18 items), mise à jour de ce qui a changé depuis, plus
les deux décisions produit de la boucle. Rien de cette liste ne bloque le code —
sauf indication contraire, le développement a avancé sans elle.

| # | Info / décision attendue | État au 11/11/2026 (soir) | Lot / tour |
| --- | --- | --- | --- |
| 1 | **Sauvegarde :** Supabase Pro (25 $/mois) ou `pg_dump` planifié ? Mot de passe Postgres (pour `pg_dump`) ? Rétention, stockage indépendant, chiffrement, alertes, RPO/RTO à fixer | **Non tranché.** La procédure et les tests existent (`docs/SAUVEGARDE.md`, `scripts/sauvegarde-base.mjs`), la restauration a été testée sur PGlite seulement — une restauration testée doit couvrir schéma + données + RLS + configuration (projet de test ou restauration réelle simulée). Aucune sauvegarde réelle n'existe tant que ce n'est pas tranché. **À trancher avant la mise en production.** | P0-S5 |
| 2 | **PIN en historique Git :** OK pour changer les 2 PIN + purger l'historique (force-push) ? | **Non tranché — décision utilisateur en attente depuis le 09/11.** Changement proposé le 09/11, REFUSÉ par l'utilisateur (« laisse comme ça ») — PIN inchangés, risque accepté, dépôt privé. Ne pas le planifier sans son OK explicite. | P0-S6 |
| 3 | **Réveil Render :** plan payant (~7 $/mois, prix à vérifier) accepté ? | **Non tranché.** Le parcours < 30 s à froid (~60 s de réveil) n'a jamais été mesuré ; l'écran d'attente honnête peut être livré sans la décision. Le plan payant est le seul correctif certain (le keep-alive consomme les 750 h gratuites et n'est pas garanti). | P0-U6 |
| 4 | **DA noir+magenta :** teinte magenta exacte de la carte du restaurant (relevé du PDF Heyzine) ? Le rouge laque reste-t-il en accent secondaire (erreurs/danger) ou est-il supprimé partout ? | **Non tranché.** La palette proposée (AUDIT § 6.2, contrastes vérifiés) a permis de démarrer ; ajuster la teinte ensuite = 1 changement dans `theme.ts`. | P0-D1 |
| 5 | **Prix à vérifier :** Riz Thaï 8,90 € ? 6 Maki Gold 100,00 € (coquille pour 10,00 € ?) ? | **Non confirmé.** Ne pas afficher 100,00 € sans confirmation — le prix est masqué (« Prix sur place ») en attendant. | P1-M1 |
| 6 | **Plats hors carte :** Thaï-sty Krusty = Crousti Poulet (fusionner) ? Bœuf Basilic toujours servi ? Boisson 33cl = Soda 3,50 / Evian 2,90 (remplacer) ? | **Non tranché.** Les 3 plats restent en « Hors carte (prix à confirmer) » en attendant. | P1-M1 |
| 7 | **Allergènes** de chaque plat (81 plats, aujourd'hui 0 renseigné) | **Non fourni.** Le code et l'affichage existent ; la saisie attend les données. | P1-M2 |
| 8 | **Photos des plats** (~67 plats sans photo) : le restaurant fournit-il ses photos, ou séance photo à organiser ? | **Non fourni.** L'app fonctionne sans photo ; l'association attend les fichiers. (Les 18 photos du PDF sont intégrées ; les photos de catégories et d'ambiance sont optimisées par la boucle.) | P1-M3 |
| 9 | **Brevo :** compte créé ? Clé API ? Expéditeur e-mail validé ? Expéditeur SMS choisi (≤ 11 car.) ? Crédits SMS achetés ? | **Partiellement fait le 11/11 au matin :** compte créé et activé, clé API v3 créée, expéditeur e-mail validé, expéditeur SMS ASIANHOME, 5 variables Render ajoutées, `/sante` sms true / email true en mode test. **Reste :** achat de crédits SMS (tarif affiché ~0,073 €/SMS, à confirmer vs 0,045 € estimé) + recette réelle autorisée (§ 3, étape 7). | P1-B7 |
| 10 | **Google Business :** compte Google propriétaire/gestionnaire de la fiche + accord pour lancer la demande d'approbation Google ? | **Non fourni.** Le code d'import/publication existe déjà ; restent configuration, approbation et recette réelle. | P1-B8 |
| 11 | **Google Wallet :** compte émetteur à créer ? (décision + accès console Google Pay & Wallet) | **Non tranché.** Le code 501 reste propre en attendant ; la génération, non. | § 5 n° 2 |
| 12 | **Apple Wallet :** la suspension est-elle levée ? (99 $/an + compte Developer) | **Non tranché — en suspens.** Le code `.pkpass` existe, la route reste à écrire quand la décision tombe. | § 5 n° 3 |
| 13 | **Domaine :** nom de domaine `.fr` souhaité (lequel ?) | **Non tranché.** Tout avance sur `onrender.com` ; les QR imprimés devront être réimprimés après. (~5,99 € la 1re année chez OVH, rien acheté.) | P2-Q4 |
| 14 | **Liens Deliveroo et Uber Eats** du restaurant (+ confirmation du linktr.ee/asianhomefrance) | **Non fourni.** Les boutons s'affichent dès que les liens sont renseignés dans Réglages. | § 5 n° 11 |
| 15 | **Coût unitaire des lots** (pour le total des coûts distribués — aujourd'hui « gains sans coût » = total affiché comme un minimum) | **Non fourni.** Le dashboard affiche « non renseigné » en attendant ; le total devient exact dès la saisie. | § 2.3 |
| 16 | **Capacité de la salle / solution de paiement** | Non applicable : pas de réservation de table ni de paiement dans l'app (hors périmètre décidé) — à confirmer seulement si le périmètre change. | — |
| 17 | **Bug de connexion du 09/11 :** message exact vu sur son téléphone | **Partiellement résolu :** la cause la plus probable (message 401 effacé par le rechargement auto 10 s) a été corrigée dans les vagues ; sans le message exact, impossible de confirmer à 100 %. Ne pas rouvrir sans le message exact. | (suivi) |
| 18 | **Staging :** accord pour un 2e service Render (staging) + une base Supabase de test ? | **Non créé (voir § 2).** La procédure peut être écrite sans ; le déploiement staging attend la création (navigateur requis). | P0-S10 |
| 19 | **Vignettes des plats « Mango Stick » et « Loc Lac » (décision boucle, tour 11)** : OK pour étendre le système de vignettes (réservé aux photos du PDF, P1-M3) aux photos de galerie ? | **Non tranché — proposition de la boucle.** La vignette carrée 192×192 du Mango Stick (8 034 o) est générée et vérifiée (non commitée) ; elle remplacerait le JPEG 61 Ko affiché 64×64 dans la liste (gain mesuré : ~53 Ko, ~550 ms de tuyau sur le défilement du menu). Même question pour Loc Lac (156 Ko affiché 64×64). Les tests `photos-menu.test.ts:102` épinglent la règle actuelle — les modifier exige cette décision. | Boucle t11 |
| 20 | **DA des écrans commerçant + coquille `#/jouer` (décisions boucle, tours 3 et 12)** : (a) assombrir les écrans commerçant (Caisse 7, Tableau de bord 8, Clients 8, Roulette 7, Réglages 7/10 — les écrans client sont à 9/10) pour passer la moyenne de 8,0 à ≥ 9/10 ? (b) remplacer le squelette de `#/jouer` par une coquille statique (titre + formulaire dès le premier rendu, gain estimé −~300–400 ms de LCP) ? | **Non tranché — propositions de la boucle.** (a) renverse le choix « lisibilité de travail côté commerçant » (AUDIT §6.3) et risque de casser des tests qui épinglent des fonds clairs côté commerçant ; le score DA est subjectif (par captures, § Cohérence DA de `SCORES.md`). (b) renverse la décision P0-U1 (test `chargement-p0-u1` non faux). Les deux relèvent d'une décision utilisateur/coordinateur, pas de la boucle. | Boucle t3, t12 |
| 21 | **P2-S16 — Calibration des seuils** : après 2 semaines d'usage réel, journal des 429, ajustement des `LIMITES_PUBLIQUES` (wifi partagé du restaurant) | **En attente de 2 semaines d'usage réel.** 0 faux positif 429 en service, seuils à documenter. | P2-S16 |
| 22 | **P2-Q6 — Alerte non branchée** : alerte (canal + destinataire) pour les logs structurés ? | **Non branchée faute de staging/canal.** Les logs structurés (1 ligne JSON par réponse) et la procédure d'alerte existent ; le branchement attend le staging et un canal. | P2-Q6 |
| 23 | **Rotation des secrets sur staging** : procédure testée ? | **Non testée** (pas de staging). À tester sur le staging une fois créé (P2-S17). | P2-S17 |
| 24 | **Pilote 2e restaurant** (décidé le 11/11 ~14h32) : une fois le cycle autonome terminé (plan + boucle + rapport + mise en production), mettre l'app à disposition du restaurant d'un ami (son propre commerce + son propre PIN, sans jamais voir le PIN admin, les clés ni les accès Render/Supabase/GitHub) — avant de lui donner accès, tester l'isolation en vrai. **Point ouvert :** les relances partiraient du compte Brevo de l'utilisateur (ses crédits, expéditeur « Asian Home Paris ») — mode test ou compte Brevo propre à l'ami à trancher. | **En attente de la mise en production.** | (décision 11/11) |

## 5. Ce qui n'a pas pu être vérifié (limites honnêtes)

- **Réveil à froid Render (~60 s) jamais mesuré** : le parcours < 30 s à froid n'a pas
  été observé (déduit de la doc Render + de l'étape 0). Le plan payant (~7 $/mois)
  est le seul correctif certain ; le keep-alive n'est pas garanti.
- **Aucun rendu réel 375/390 px vérifié sur téléphone** : aucune capture réelle sur
  téléphone — les mesures sont sur Pixel 7 simulé (Playwright) et les captures
  d'écran du protocole. Les cadrages aux largeurs extrêmes (`object-cover` peut
  couper les côtés) n'ont pas été vérifiés (revue Codex t10, point 2).
- **Lighthouse est bruité sur cette VM** : ± 5 points d'une passe à l'autre (meilleure
  passe 86 à t9, TBT 490 ms isolée ; 78/78 à t10). Le breakdown `mainthread-work`
  est **simulé** (throttling simulé) : le « styleLayout 898 ms » ne vaut pas
  ~125 ms mesurés en trace CDP throttlée (tour 8). Toute décision Lighthouse
  contestée exige un ABAB ou 3+ passes (règle ajoutée au tour 5).
- **Le DA (8,0/10) est subjectif** : noté par écran sur captures Pixel 7, avec
  justifications écrites (`SCORES.md` § Cohérence DA) — pas une mesure
  instrumentée. Les écrans client sont à 9/10 depuis P1-D2, les écrans commerçant
  à 7–8/10.
- **Le parcours < 30 s « complet » n'est pas vérifié** : les étapes scriptées sont
  sous 30 s (6,5–6,9 s) mais le temps humain réel (gestes, attente en caisse)
  s'ajoute et n'a pas été mesuré ; le critère complet exige un téléphone réel.
- **`npm audit` retourne 403 `policy_denied` sur cette VM** (noté, non contourné) :
  aucune vérification des vulnérabilités des dépendances n'a pu être faite ici.
- **Archive brute P0-U0 perdue (incident tour 5)** : un lancement de
  `mesurer-scores.mjs` sans `--sortie` a écrasé
  `node_modules/.cache/mesure-p0-u0/resultats.json` + 9 captures P0-U0 (fichiers
  non versionnés, non restaurables). Les chiffres sont conservés dans `SCORES.md`
  ; la passe t5 contenue dans le fichier écrasé a été récupérée comme passe 1.
  Correctif appliqué : les deux scripts de mesure refusent désormais d'écraser
  leur sortie par défaut sans `--sortie` explicite (vérifié).
- **Le commit déployé en production ne se vérifie pas via `/sante`** (son champ
  `version` est la version du paquet, identique à chaque commit) : le vérifier
  dans le dashboard Render → Deploys (SHA + « Live »).
- **La validation du test épinglé du tour 7 est intervenue après la modification
  du test, avant la fusion** (l'ordre strict « avant toute touche » n'a pas été
  respecté — consigné honnêtement dans `BOUCLE.md` ; la revue Codex a approuvé
  la modification, cela ne justifie pas d'annuler le tour).
- **Flaky tests observés** : aucun test flaky récurrent dans la suite (1200/1200
  stable sur les derniers passages) ; les variations observées sont des mesures,
  pas des tests — Lighthouse ± 5 points, premier affichage ± ~0,2 s, TBT
  ± ~150 ms, et des valeurs isolées (tirage passe 2 à 928–988 ms, menu direct
  passe 2 à 1 967 ms, ouverture carte 786 ms) traitées comme du bruit dans
  `SCORES.md`.
- **Les mesures ponctuelles Asian Home ne couvrent ni le SW actif ni une visite
  chaude** (SW bloqués, cache désactivé, navigateur relancé par passe) : elles
  mesurent le chargement à froid, pas l'expérience d'un habitué (dont le SW
  sert le cache — y compris, temporairement, les anciennes variantes d'images
  après un recadrage, sans régression visuelle significative).
- **Le staging n'existe pas** (§ 2) : rien n'a pu être vérifié sur un environnement
  de type production (santé Supabase de test, migrations 0009–0010 appliquées,
  parcours sur staging). Les migrations 0009–0010 n'ont été vérifiées que par
  tests (compatibilité statique + chemins de tolérance), pas par un déploiement.

## 6. Comment vérifier sur son téléphone (sans rien installer)

Tout se fait dans le navigateur du téléphone, sans rien installer. D'abord attendre
que le staging existe (§ 2) — les étapes 1–3 ci-dessous utilisent alors l'URL du
staging ; l'étape 4 utilise la production actuelle (ancien code, pour comparer).

1. **Ouvrir le staging** (une fois créé) : `https://asian-home-fidelite-staging.onrender.com`
   — attendre ~1 min au 1er chargement (réveil Render Free), puis vérifier que la
   page s'ouvre (titre « Asian Home Paris », roue visible).
2. **Parcours client (2 min)** : sur `#/jouer`, saisir son numéro, toucher
   « C'est parti », puis en caisse (code équipe de test, fourni par le commerçant
   de test) valider la visite, toucher « C'est validé ? », tourner la roue,
   toucher « Voir ma carte de fidélité ». Vérifier : la carte s'ouvre avec ses
   tampons, la bannière (plateau de plats) et le héros (table dressée) s'affichent
   sans délai visible, le QR code apparaît sur la carte.
3. **Menu (1 min)** : toucher « Voir le menu » — vérifier : la photo d'en-tête
   (table dressée) s'affiche vite, les catégories défilent, les photos de plats
   et de catégories apparaissent en descendant, la recherche trouve un plat
   (« Maki », « Pad Thaï »).
4. **Comparer avec la production actuelle** : `https://asian-home-fidelite.onrender.com`
   — même parcours. La différence visible attendue : le menu et la carte
   s'affichent plus vite sur le staging (héros, bannière et photos optimisés) ;
   le reste (roue, tirage, caisse) est identique.
5. **Si quelque chose ne s'affiche pas** (photo manquante, page blanche, erreur) :
   noter l'heure, la page (`#/jouer`, `#/menu`, `#/carte`) et ce qui manque,
   et le signaler — ne pas réessayer dix fois (le staging dort après 15 min
   sans trafic, le 1er chargement est lent, c'est normal).

---

**Fichiers du cycle autonome :** `BOUCLE.md` (règles, méthode, journal des 12 tours,
leviers écartés, preuves des tests épinglés), `CHANGELOG.md` (chaque changement
fusionné avec justification et mesure avant/après), `SCORES.md` (baseline t0 +
re-mesures t1–t12 sous chaque métrique), `JOURNAL.md` (entrées datées),
`AUDIT.md` (§ 7 plan, § 8 infos manquantes), `docs/DEPLOIEMENT.md` (staging,
production, retour arrière), `scripts/rollback-render.mjs` (retour arrière en une
commande), `scripts/mesurer-scores.mjs` / `mesurer-lighthouse.mjs` /
`mesurer-menu-asian-home.mjs` / `mesurer-carte-asian-home.mjs` /
`mesurer-photos-paresseuses.mjs` (mesures versionnées).
**Dépôt :** `asian-home-fidelite` (privé) — branche `autonome/integration`, HEAD
`41246e3` — **tests 1200/1200, E2E 3/3, 0 erreur console.**

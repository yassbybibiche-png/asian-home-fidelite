# Hygiène des branches (P3-4)

Règle consignée par le cycle produit 13 (15/11/2026) et valable pour toute
boucle qui travaille dans ce dépôt.

## Règle « base master + worktree séparé »

- Tout cycle part de `master` vérifié (`master` = `origin/master`, contrôlé par
  `ls-remote` sur un fetch frais), dans un **worktree Git dédié**, sur une
  branche de cycle nommée `produit/cycle-<K>` (ou le nom du chantier).
- **Jamais** de travail dans la copie principale quand un autre chantier y est
  en vol (branches `anim/*`, `appetit/menu`, …), jamais de commit dans la
  copie principale depuis une boucle, jamais de fusion vers `master` dans la
  boucle produit : le staging est `autonome/integration`, la production
  (`master`) ne bouge que sur décision explicite du fondateur.
- Fichiers interdits dans la boucle produit tant que la boucle animations
  occupe la copie principale : `src/pages/MenuPublic.tsx` et les libs
  d'animation du menu (`railVivant` et assimilées). Si une correction exige
  l'un de ces fichiers, passer à la correction suivante et le signaler.

## Critère de suppression d'une branche fusionnée

Une branche ne se supprime que si **toutes** ces conditions sont vérifiées,
sur un fetch frais :

1. sa pointe locale est un ancêtre de `master`
   (`git merge-base --is-ancestor <branche> master`) ;
2. si elle existe sur `origin`, sa pointe distante est **identique** à la pointe
   locale et ancêtre de `origin/master`
   (`git merge-base --is-ancestor origin/<branche> origin/master`) ;
3. elle n'est extraite dans **aucun worktree** (`git worktree list`) ;
4. elle ne fait pas partie des branches protégées (ci-dessous).

Suppression sûre : `git branch -d <branche>` refuse une branche non
fusionnée ; la suppression distante se fait ensuite par
`git push origin --delete <branche>`, une branche à la fois, avec vérification
`ls-remote` après le lot. Le contenu n'est jamais perdu : chaque pointe
supprimée reste joignable depuis `master`, et elle est consignée ci-dessous
avec son SHA — une branche se recrée par `git branch <nom> <sha>`.

## Branches protégées (jamais supprimées par cette boucle)

- `master` — production.
- `autonome/integration` — branche de staging (en avance sur `master`).
- Toute branche extraite dans un worktree (ex. `produit/cycle-<K>`,
  `appetit/menu`).
- Toute branche non fusionnée dans `master`.

## Suppressions du 15/11/2026 (cycle produit 13)

78 branches fusionnées supprimées, après vérification branche par branche
selon le critère ci-dessus (inventaire complet avec SHA dans
`~/workspace/komeback/com-experts/INVENTAIRE-BRANCHES-P3-4.json`, hors dépôt).

Tête de liste : `fix/409-meta-cas` — pointe `35a3e4b` (« FIX-409 : CAS meta
fiable même si meta.valeur est jsonb »), fusionnée par `60e6a58` (« Fusion
fix/409-meta-cas »), supprimée en local **et** sur `origin` (pointe distante
identique `35a3e4b`, ancêtre de `origin/master` vérifié avant suppression).

Après suppression : 15 branches locales restantes (`master`,
`autonome/integration`, `appetit/menu`, `produit/cycle-1` à `produit/cycle-12`
— plus `produit/cycle-13`, la branche de ce cycle, créée avant les
suppressions pour porter ce document)
et 3 branches distantes restantes (`master`, `autonome/integration`,
`produit/cycle-8` — seule branche `produit/cycle-*` poussée sur `origin`,
non fusionnée dans `master`, donc conservée ; `appetit/menu` n'existe
qu'en local). Les 77 autres branches supprimées avaient une contrepartie
`origin` identique, supprimée elle aussi ; `brevo-branchement` n'existait
qu'en local.

### Liste complète (78)

- `anim/cycle1-univers` — pointe `abae3e7` (origin identique)
- `anim/cycle2-typo` — pointe `cd3da00` (origin identique)
- `anim/cycle3-plat-star` — pointe `07ae192` (origin identique)
- `anim/cycle4-rail` — pointe `625643f` (origin identique)
- `anim/cycle5-transitions` — pointe `1a201a4` (origin identique)
- `autonome/p0-d1-theme-magenta` — pointe `15b72ad` (origin identique)
- `autonome/p0-s10-staging-rollback` — pointe `1b8fcd1` (origin identique)
- `autonome/p0-s11-atomicite` — pointe `78f4d23` (origin identique)
- `autonome/p0-s14-vue-caisse` — pointe `9f7ecdb` (origin identique)
- `autonome/p0-s18-pagination` — pointe `b25b252` (origin identique)
- `autonome/p0-s19-code-gagnant` — pointe `d2ed31d` (origin identique)
- `autonome/p0-s20-compteurs` — pointe `bd82830` (origin identique)
- `autonome/p0-s21-tsc-serveur` — pointe `7dc8c32` (origin identique)
- `autonome/p0-s5-sauvegarde` — pointe `4d27a7e` (origin identique)
- `autonome/p0-s7-auth-client` — pointe `d268c90` (origin identique)
- `autonome/p0-s9-refus-sqlite` — pointe `c9f11c0` (origin identique)
- `autonome/p0-u0-mesure-initiale` — pointe `2bf30ca` (origin identique)
- `autonome/p0-u6-reveil-render` — pointe `73a7f72` (origin identique)
- `autonome/p1-b7-brevo-production` — pointe `47c196d` (origin identique)
- `autonome/p1-b8-google-business` — pointe `ccdfa49` (origin identique)
- `autonome/p1-b9-desinscription-sms` — pointe `9631cc6` (origin identique)
- `autonome/p1-c7-ecrans-commercant` — pointe `18cb34a` (origin identique)
- `autonome/p1-d2-corps-sombres` — pointe `a58ced7` (origin identique)
- `autonome/p1-g1-rappel-purge` — pointe `eccdad6` (origin identique)
- `autonome/p1-m1-prix-hors-carte` — pointe `d4282e8` (origin identique)
- `autonome/p1-m2-allergenes` — pointe `e7fce65` (origin identique)
- `autonome/p1-m3-photos-preparation` — pointe `2067b20` (origin identique)
- `autonome/p1-p1-egress-polling` — pointe `db05ea3` (origin identique)
- `autonome/p1-s12-tampon-jour-visite` — pointe `c2f537a` (origin identique)
- `autonome/p1-u1-mesure-apres-refonte` — pointe `62595d3` (origin identique)
- `autonome/p2-q1-accessibilite` — pointe `3e522a6` (origin identique)
- `autonome/p2-q2-performance` — pointe `1ad77e8` (origin identique)
- `autonome/p2-q3-mesure-ab` — pointe `b3d1bbe` (origin identique)
- `autonome/p2-q4-domaine-seo` — pointe `d6ef303` (origin identique)
- `autonome/p2-q5-documentation` — pointe `277f9b3` (origin identique)
- `autonome/p2-q6-logs` — pointe `46851d3` (origin identique)
- `autonome/p2-s13-oracles` — pointe `1092e96` (origin identique)
- `autonome/p2-s15-journal-lectures` — pointe `95ac9df` (origin identique)
- `autonome/p2-s17-rotation-secrets` — pointe `98c9d1a` (origin identique)
- `boucle/roue-v2` — pointe `f2856f7` (origin identique)
- `brevo-branchement` — pointe `b8d2464` (locale seule)
- `corrections/codex-11-points` — pointe `ea456c7` (origin identique)
- `corrections/points-1-3` — pointe `1f415ae` (origin identique)
- `deblocage/trois-chantiers` — pointe `f1f5376` (origin identique)
- `e2e-playwright-scan-gain-carte` — pointe `493d125` (origin identique)
- `experience/accueil-commande` — pointe `7b2e1e3` (origin identique)
- `experience/cycle3-animations-activation` — pointe `d3c0121` (origin identique)
- `fix/409-meta-cas` — pointe `35a3e4b` (origin identique)
- `menu/visuel-interactif` — pointe `a3d57b6` (origin identique)
- `p0-s1-pin-scrypt-sessions` — pointe `7d36739` (origin identique)
- `p0-s2-anti-abus-persistant` — pointe `24757e3` (origin identique)
- `p0-s3-vue-publique-minimale` — pointe `34dceb3` (origin identique)
- `p0-s4-durcissement-http` — pointe `883f275` (origin identique)
- `p0-u1-fin-page-blanche` — pointe `de8dba8` (origin identique)
- `p0-u2-roue-lisible` — pointe `1db99b3` (origin identique)
- `p0-u3-code-gagnant-caisse` — pointe `ff2d941` (origin identique)
- `p0-u4-cul-de-sac-validation` — pointe `01ca265` (origin identique)
- `p0-u5-bug-connexion` — pointe `336fe7e` (origin identique)
- `p1-b1-menu-officiel` — pointe `9ccf620` (origin identique)
- `p1-b2-photos-menu` — pointe `7b1b7b4` (origin identique)
- `p1-b3-relances` — pointe `81256fa` (origin identique)
- `p1-b4-avis-google` — pointe `f796e3f` (origin identique)
- `p1-b5-logo` — pointe `d997022` (origin identique)
- `p1-b6-rgpd` — pointe `cdfad16` (origin identique)
- `p1-c1-entree-qr-jeu` — pointe `2415853` (origin identique)
- `p1-c2-roulette` — pointe `09507ff` (origin identique)
- `p1-c3-carte-pwa` — pointe `f1d3700` (origin identique)
- `p1-c4-avis-client` — pointe `061f2a9` (origin identique)
- `p1-c5-menu-client` — pointe `bc25eb8` (origin identique)
- `p1-c6-ecrans-commercant` — pointe `2d3cae8` (origin identique)
- `p2-q1-identite-accessibilite` — pointe `efe55fd` (origin identique)
- `p2-q2-performance-bundle` — pointe `fdcacfc` (origin identique)
- `p2-q3-dashboard-mesure` — pointe `9d33be6` (origin identique)
- `p2-q4-domaine-seo` — pointe `6ec5744` (origin identique)
- `reco/r1-reglement` — pointe `b6c2038` (origin identique)
- `reco/r3-jeu-table` — pointe `b918a46` (origin identique)
- `reco/r4-vitrine` — pointe `63249fd` (origin identique)
- `vagues/ameliorations-nov12` — pointe `10d7ba7` (origin identique)

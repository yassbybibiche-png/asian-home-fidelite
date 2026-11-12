# BOUCLE — Amélioration continue (après les lots P0/P1/P2)

Décidée par l'utilisateur le 10/11/2026 ~22h15, après le plan appliqué et les tests
verts. Règles exactes, méthode de mesure, journal des tours. Le détail chiffré de
chaque tour vit dans `SCORES.md` ; la liste des changements fusionnés, avec
justification et mesure avant/après, vit dans `CHANGELOG.md`.

## Règles (non négociables, consignes utilisateur 10/11 ~22h14-22h15)

- Production https://asian-home-fidelite.onrender.com, master `4862968` — **jamais
  touchée** : ni master ni production. Tout se fait sur des branches
  `autonome/boucle-t<N>-<sujet>`, fusionnées `--no-ff` dans `autonome/integration`
  et poussées.
- Aucun secret dans le code/commits ; aucun envoi réel (SMS/e-mail/réponse Google)
  ni paiement réel ; tests verts avant le tour suivant.
- Ne jamais modifier un test pour le faire passer. Si un tour casse un test, le
  tour est annulé — sauf si le test lui-même est prouvé faux : preuve documentée
  ici et validation par Codex avant toute touche.
- Ne supprimer aucune fonction ; ne toucher ni aux probabilités des lots, ni aux
  prix, ni aux textes légaux (les signaler).
- DA NOIR + MAGENTA.
- **Un seul changement par tour**, sur branche dédiée.
- **Fusion seulement si MIEUX sans régression** : un score qui s'améliore, aucun
  qui se dégrade au-delà du bruit de mesure. En cas de doute, refaire la mesure
  une 2e fois avant de décider. Un tour sans gain mesurable = tour annulé, branche
  supprimée, noté dans le journal ci-dessous.
- **Revue Codex 5 points max par tour fusionné** (lecture seule,
  `~/.local/bin/codex exec "..." < /dev/null` avec `timeout 600` — stdin fermé
  obligatoire ; si Codex atteint une limite d'usage, réessayer jusqu'à 3 fois).
  Corriger ce qui est fondé, noter ce qui est ignoré et pourquoi.
- **Regard neuf toutes les 5 itérations** : relecture critique des hypothèses (ce
  qu'on mesure est-il encore le bon levier ?).
- **ARRÊT** à la première condition atteinte : 3 tours consécutifs sans gain
  mesurable, OU 25 tours, OU Lighthouse ≥ 95 + scan → lot < 30 s + DA ≥ 9.
  Ne pas dépasser 25 tours. 3 tours sans gain = arrêt propre, pas un échec.

## Méthode de mesure (identique avant et après chaque tour)

- **Scripts** : `node scripts/mesurer-scores.mjs` (2 passes, ports distincts,
  sorties `node_modules/.cache/mesure-boucle-t<N>/resultats-passe<N>.json`) et
  `node scripts/mesurer-lighthouse.mjs` (2 passes,
  `lighthouse-passe<N>.json`). Protocole : Pixel 7, Slow 4G + CPU ×4, serveur
  E2E local (voir `SCORES.md` § Protocole).
- **Bundle** : build frais `npm run build`, tailles lues dans `dist/assets` avec
  la définition de `tests/performance-bundle-p2-q2.test.ts` (JS initial = entrée
  + imports statiques ; CSS = feuille de `dist/assets`).
- **Tests** : `npm test` complet (typechecks inclus) + E2E
  (`npm run test:e2e` quand le tour touche un parcours).
- **Bruit de mesure** (observé) : premier affichage ± ~0,2 s entre passes,
  Lighthouse ± 5 points d'une passe à l'autre, TBT ± ~150 ms. Un gain inférieur
  à ces marges n'est pas un gain : refaire la mesure avant de décider.
- **SCORES.md mis à jour à chaque tour** (figures du haut de § Bundle = build
  frais courant — le test `tests/scores-p0-u0.test.ts` lit la PREMIÈRE occurrence
  de chaque chiffre et la compare à un build frais à 5 % près ; toute nouvelle
  section de bundle va donc APRÈS la section de référence, jamais avant).
- **Compteurs de tests** : `README.md` (`**N tests`, `N fichiers, suite verte`)
  et `SCORES.md` (`**N/N**`) doivent rester cohérents — le test
  `tests/documentation-p2-q5.test.ts` les recoupe.

## Leviers connus en attente (à vérifier par mesure, pas à croire sur parole)

- Lighthouse TBT en hausse de 660–840 ms après P2-Q2/Q3/Q4 (cause inconnue).
- Premier affichage ~2,3–2,4 s vs cible < 2 s.
- DA 8,0/10 vs ≥ 9 (écrans commerçant restés clairs par choix — ne pas les
  assombrir sans raison mesurée).
- Marge bundle très fine : JS initial 481 332 o à t0, à 44 o sous la limite
  `INITIAL_AVANT × 0,8` (481 376 o) du test P2-Q2 — toute croissance du JS
  initial casse ce test.
- `npm audit` retourne 403 `policy_denied` sur cette VM (le noter, ne pas le
  contourner).
- Réveil à froid Render ~60 s jamais mesuré ; aucun rendu réel 375/390 px vérifié
  sur téléphone.
- Variante recadrée de la bannière de la carte (~720×180, ratio d'affichage
  390×96) : l'`object-cover` jette beaucoup de pixels de la variante 720×480 —
  candidat t7 (revue Codex t6, point 3).
- **TBT : profilage des longues tâches (tour 8, ANNULÉ — voir journal)** :
  trace Chrome + profil CPU : 89,5 % `(idle)` (attente réseau), fonctions
  diffuses (top 1,9 %), plus grosse tâche 167 ms (montage React), plus gros
  layout 73 ms (rendu post-API) ; le « styleLayout 898 ms » de Lighthouse
  est un artefact du throttling simulé (coût réel ~125 ms). Aucun levier
  au-dessus du bruit : le découpage des dépendances partagées ne réduit pas
  le travail initial (Codex t7, point 5) ; la sortie de Caisse/CartePublique
  du bundle initial reste écartée (P2-Q2).
- **Vignette WebP pour la photo du plat « Mango Stick » (tour 11, ANNULÉ —
  voir journal)** : la photo du plat (`menu-mango-sticky-rice.jpg`, 61 Ko,
  affichée 64×64 en vignette dans la liste) coûte 645–718 ms sur le
  défilement du menu ; une vignette carrée 192×192 (8 034 o, Pillow,
  recadrage centré, q75 — générée et vérifiée, non commitée) la remplacerait
  dans la liste, la photo complète restant pour le détail. Écarté : les
  tests `photos-menu.test.ts:102` (« Loc Lac et Mango Stick gardent leur
  photo existante, sans vignette ») et la règle de nommage des vignettes
  (`.webp` → `-vignette.webp`) épinglent la décision P1-M3 (vignettes
  réservées aux photos du PDF) — ce n'est pas un test faux, c'est une
  décision produit à trancher par l'utilisateur (proposée dans `RAPPORT.md`).
- **Regard neuf — tour 12 (voir journal)** : après 11 tours, les leviers
  mesurables sont épuisés — il ne reste que des décisions produit (DA,
  vignettes P1-M3). Voir la section « Regard neuf — tour 12 ».

## Regard neuf — tour 5 (11/11/2026, tous les 5 tours)

Relecture critique des hypothèses, avant de choisir le changement du tour 5 :
1. **Le protocole standard sous-mesure l'expérience Asian Home réelle.**
   Commerce générique sans visuels : ni le logo du commerce (74 Ko sur
   `#/jouer`, `#/menu`, `#/carte`, caisse) ni le héros du menu n'y
   apparaissent. Les tours 2 et 4 ont mesuré leurs gains hors protocole
   (écran de chargement / mesure ponctuelle). La mesure ponctuelle
   versionnée (`scripts/mesurer-menu-asian-home.mjs`) devient le complément
   officiel pour les visuels Asian Home ; étendue au tour 5 à `#/jouer`
   (page neuve par mesure — une navigation par hash ne recharge pas le
   document, pas de nouvelle entrée navigation, pas de nouveau FCP/LCP).
2. **Lighthouse est trop bruité sur cette VM pour des décisions à 2 passes.**
   9 passes t4 (74–81) contre 2 passes t2 (84/81) ; l'ABAB a été nécessaire
   pour trancher. Règle ajoutée : toute décision Lighthouse contestée exige
   un ABAB (stash/rebuild) ou 3+ passes.
3. **Le TBT reste le levier n° 1** (590–1 030 ms) et le JS initial le chemin
   critique (tour 3) — aucun levier au-dessus du bruit trouvé en t3. Le
   prochain levier structurel serait le découpage des dépendances partagées
   (pas les pages, P2-Q2) — à investiguer si les visuels ne suffisent plus.
4. **DA 8,0/10** : les écrans commerçant restent clairs. Un tour DA
   (assombrir) serait un changement visuel/productif sans métrique
   objective — il exige d'abord une grille d'évaluation DA reproductible ;
   différé, proposé dans `RAPPORT.md` (pas un tour de boucle sans métrique).
5. **Le logo du commerce est le dernier visuel lourd non optimisé** : 74 Ko
   pour un affichage 64×64, présent sur toutes les pages client du vrai
   restaurant — le changement du tour 5. Après lui, tous les visuels
   Asian Home servis sur les pages client sont des variantes légères
   (logo 4,9 Ko, héros 95 Ko) ; il ne reste que les photos de plats
   (déjà WebP, vignettes 192 px) et `hero-plats.jpg` (bannière de la
   carte, 1024×683 — à mesurer si elle devient le LCP d'une page).

## Regard neuf — tour 12 (11/11/2026, tous les 5 tours — dû à t10, rattrapé)

Relecture critique après 11 tours (7 fusions, 3 annulations, 1 regard neuf) :
1. **Bilan chiffré (t0 → t10, même protocole)** : JS initial 481 332 → 454 357 o
   (−5,6 %) ; premier affichage `#/jouer` 2 261/2 197 → 1 874/1 888 ms
   (cible < 2 s : **atteinte**) ; LCP `#/jouer` 2 248/2 148 → 1 812/1 868 ms ;
   parcours scan → lot 6 664/7 343 → 6 553/6 574 ms (cible < 30 s : **atteinte**,
   étapes scriptées) ; Lighthouse 77/81 → 78/78 (meilleure passe 86, t9) —
   cible ≥ 95 : **non atteinte** ; LCP menu Asian Home 3 428/3 376 → 2 324/2 252 ms
   (−1 080 ms) ; LCP carte Asian Home 3 464/3 308 → ~3 002 ms (direct) ;
   photos paresseuses −267 Ko (−202 à −597 ms de téléchargement) ; DA 8,0/10
   (cible ≥ 9 : **non atteinte**) ; tests 1163 → 1200/1200, E2E 3/3.
2. **Le protocole mesure-t-il encore le bon levier ?** Oui pour les pages
   client (les mesures ponctuelles Asian Home couvrent désormais les trois
   pages : menu, carte, jouer) ; non pour le TBT (le breakdown Lighthouse
   est simulé — le coût réel est ~800 ms de travail, 89,5 % idle — et les
   scores varient de ±5 points d'une passe à l'autre sur cette VM : le
   Lighthouse n'est plus un juge fiable à 2 passes, l'ABAB ou 3+ passes
   sont requis, règle ajoutée au tour 5).
3. **Que reste-t-il de mesurable et sûr ?** Rien : tous les visuels des pages
   client sont des variantes légères et recadrées (logo 4,9 Ko, héros 51 Ko,
   bannière 27 Ko, paresseuses ~83 Ko) ; le bundle est sous le seuil P2-Q2
   (le découpage des pages est épinglé, celui des dépendances ne réduit pas
   le travail initial — tour 8) ; le TBT est diffus (tour 8) ; le `seed.json`,
   le beacon et le préchargement SW sont écartés (tour 3) ; les photos
   `menu-loc-lac.jpg` / `menu-nouilles-crevettes.jpg` ne sont pas
   téléchargées (aucune priorité) ; les photos de plats du PDF sont déjà
   à la bonne taille (≤ 720 px, vignettes 192 px).
4. **Que reste-t-il tout court ?** Deux décisions produit, pas des tours de
   boucle : (a) **DA 8,0 → ≥ 9** — assombrir les écrans commerçant
   (Caisse 7, Tableau de bord 8, Clients 8, Roulette 7, Réglages 7/10 ;
   les écrans client sont à 9/10 depuis P1-D2). Le score DA est établi
   par la même méthode par captures (SCORES.md § Cohérence DA) — il est
   subjectif mais documenté par écran ; assombrir 5 écrans est un gros
   changement visuel qui renverse le choix « lisibilité de travail côté
   commerçant » (AUDIT §6.3) et risque de casser des tests qui épinglent
   des fonds clairs côté commerçant. (b) **Vignettes P1-M3** (Mango Stick
   61 Ko + Loc Lac 156 Ko affichés 64×64 dans la liste) — la règle
   « vignettes réservées aux photos du PDF » est épinglée par les tests
   (tour 11, annulé).
5. **Conclusion du regard neuf** : la boucle a épuisé ses leviers
   mesurables. Les deux items restants relèvent de l'utilisateur / du
   coordinateur (proposés dans `RAPPORT.md`). Le tour 12 n'apporte donc
   aucun changement — il est annulé, comme les tours 3, 8 et 11.
   Tours sans gain consécutifs après t12 : **2** (t11, t12). La condition
   d'arrêt formelle (3 tours consécutifs sans gain) n'est pas atteinte,
   mais lancer un tour 13 sans levier identifié serait mécanique : la
   boucle s'arrête ici sur le constat du regard neuf, et le `RAPPORT.md`
   final consigne l'état, les deux décisions produit en attente et la
   procédure de déploiement. (Si le coordinateur tranche l'une des deux
   décisions, la boucle pourra reprendre à t13 sur ce levier.)

## Leviers examinés et ÉCARTÉS (ne pas les reproposer sans fait nouveau)

- **Caisse et CartePublique en `React.lazy` hors bundle initial** : écarté. Le
  test `tests/performance-bundle-p2-q2.test.ts` épingle les imports statiques de
  Jouer/CartePublique/Caisse et exige le code de la caisse dans le bundle initial
  servi par le cache du service worker (caisse hors ligne après une seule visite
  en ligne). Ce n'est pas un test faux : c'est une décision produit (comptoir
  hors ligne). Le découpage doit donc passer par les dépendances partagées, pas
  par les pages elles-mêmes.
- **Logo `/visuels/logo.png` (600×600, 74 Ko) → WebP** : écarté en l'état. Le
  fichier est une fixture de tests (`tests/logo-p1-b5.test.ts`,
  `tests/supabase.test.ts` : vrai PNG 600×600 pour valider l'upload) et le test
  `tests/chargement-p0-u1.test.ts` épingle le chemin dans l'écran de chargement
  et l'existence du fichier. Une variante optimisée séparée reste envisageable
  (nouveau fichier, `logo.png` intact) — à mesurer comme un tour à part entière.
  → Retenu comme tour 2 sous forme `<picture>` (source WebP + repli PNG) :
  le test P0-U1 continue de passer sans modification (il lit la balise `<img>`
  de repli), `logo.png` reste intact partout ailleurs.
- **`seed.json` en import dynamique (délocaliser le seed du bundle initial)**
  : examiné et ÉCARTÉ (boucle t2). Le seed (27 Ko de sources) n'est parcouru
  qu'en mode local (`seedRecale`, `depot.ts`) ; en mode API il ne coûte que
  son transfert (~6–8 Ko brotli) et son analyse (~quelques ms) — le rendre
  asynchrone ferait passer `seedRecale` en async et se propagerait au store
  et aux tests, pour un gain attendu < 50 ms. Pas de fait nouveau sans mesure.
  Confirmé par la chronologie du tour 3 : le seed vit dans `ui-*.js`, qui
  finit de se télécharger à 809 ms contre 1 152 ms pour `index-*.js` — il est
  hors du chemin critique ; le retirer ne déplacerait pas le LCP (gain
  résiduel ~10 ms d'analyse). Écart définitif en mode API.
- **Coquille statique de `#/jouer` au lieu du squelette** : examiné et ÉCARTÉ
  (boucle t3). L'idée : rendre le titre (`p.titre-carte`, élément LCP) et le
  formulaire dès le premier rendu, avant le retour de l'API commerce
  (chronologie t3 : API 1 476 → 1 638 ms, LCP 1 844 ms — gain estimé
  −~300–400 ms de LCP). Écarté : le test `tests/chargement-p0-u1.test.ts`
  épingle la ligne exacte `<SqueletteJeu libelle={t('Un instant, la roue
  arrive.')} />` dans `src/pages/Jouer.tsx` et la pureté du squelette (aucun
  état/effet/appel, un seul import de type) — ce test n'est pas faux, il
  consigne une décision P0-U1 délibérée (squelettes sur les 4 écrans, pas de
  texte « Chargement… » nu). Remplacer le squelette par une coquille serait
  un changement produit, pas une correction : il relève d'une décision
  utilisateur/coordinateur, pas de la boucle. Proposé dans `RAPPORT.md`.
- **Lecture anticipée du coffre / fetch commerce plus tôt** : examiné et
  ÉCARTÉ (boucle t3). Le fetch commerce démarre à 1 476 ms, après le montage
  React et la lecture du coffre chiffré (`lireCoffreBorne`, IndexedDB) dans
  `demarrer()` — la démarrer au niveau module ne gagnerait que ~50–100 ms
  (sous le bruit de mesure ± ~0,2 s) en touchant le chemin de démarrage
  sécurisé (accès + gardes de concurrence P0-S7/P0-S11). Gain insuffisant
  pour le risque.
- **Beacon `evenements` (POST P2-Q3, mesure anonyme)** : examiné et ÉCARTÉ
  (boucle t3). Il part à 1 811 ms, après le LCP (1 844 ms), 325 o, terminé à
  1 990 ms — TTI 2,6–2,8 s : aucun effet sur LCP, TBT ou TTI. Le différer ne
  changerait rien de mesurable.

## Journal des tours

### Tour 2 — `autonome/boucle-t2-logo-chargement` (fusionné)

Sujet : l'écran de chargement (`index.html`, affiché avant le JS) charge
`/visuels/logo.png` (600×600, 74 451 o) affiché à 96×96 — 31 % des octets du
premier affichage, en concurrence avec le JS sur la 4G lente. Nouveau fichier
`public/visuels/logo-petit.webp` (192×192, WebP q80, ~4,9 Ko, généré depuis le
vrai logo par Pillow) servi en premier via `<picture>` (repli PNG inchangé) ;
ajouté au préchargement du service worker ; documenté dans
`public/visuels/SOURCES.md`. `logo.png` reste intact (logo du commerce, repli,
fixtures de tests). Hypothèse : premier affichage −~0,2–0,3 s en Slow 4G,
LCP en baisse, Lighthouse +1–3 points, TBT plat. Vérification : le journal des
requêtes de la mesure t2 doit montrer `logo-petit.webp` et plus `logo.png` sur
`#/jouer`. Résultat mesuré (voir SCORES.md § « Re-mesure boucle t2 ») :
premier affichage 2 355/2 232/2 235 → 2 078/1 861 ms (moyenne −304 ms), LCP
2 340/2 220/2 224 → 2 028/1 812 ms (moyenne −341 ms), parcours 7 213/6 971/
6 987 → 6 141/6 277 ms (la validation en caisse gagne aussi : chaque
chargement de page affiche l'écran de chargement) ; Lighthouse 80/85 → 84/81
(plat, bruit), LCP Lighthouse 2,9/2,8 → 2,3/2,2 s, TBT 620/450 → 590/720 ms
(mixte, aucun gain établi) ; bundle inchangé (pas de JS) ; 0 erreur console,
0 requête échouée ; journal des requêtes : `logo-petit.webp` servi, plus
aucun `logo.png` sur `#/jouer`. **Tests épinglés** : `photos-menu.test.ts:68`
(filtre `menu-` — preuve ci-dessous, revue Codex t2 point 3 : légitime) et
`mesure-p1-u1.test.ts:27` (extraction bornée à la sous-section — preuve
ci-dessous, revue Codex ciblée : légitime, aucune assertion retirée).
**Revue Codex t2 (5 points)** : 1. défaut hors ligne du SW — `fichier()` ne
consultait que `CACHE_FICHIERS`, le préchargement (`CACHE_APP`) n'était pas
servi hors ligne → repli `caches.match` ajouté + test de régression (vérifié :
échoue sans le correctif, passe avec) ; 2. `<picture>` correct, mais le PNG
n'est pas un repli en cas d'échec de chargement → commentaire du test corrigé
(repli = format, pas hors ligne) ; 3. correction du test menu légitime
(appliquée) ; 4. lecture des dimensions WebP fragile mais correcte pour ce
fichier → assertions chunk `VP8 ` + signature de trame ajoutées ; 5. mentions
« suite verte » anticipées dans README/SCORES → corrigées après le passage
réel (1171/1171).
**Décision : FUSIONNÉ** — premier affichage et LCP en baisse sur les
2 passes au-delà du bruit, parcours en baisse, Lighthouse plat, aucune
régression au-delà du bruit.

### Tour 3 — `autonome/boucle-t3-tbt` (annulé — aucun levier au-dessus du bruit)

Sujet : le TBT reste le levier n° 1 (Lighthouse 590/720 ms, `styleLayout`
634 ms + `scriptEvaluation` 611 ms, passe 1 t2). Investigation sans
changement de code — chronologie d'une passe (`node_modules/.cache/profil-t3/chronologie.mjs`,
même protocole Slow 4G + CPU ×4) : FCP 648 ms ; `index-*.js` 220 → 1 152 ms
(932 ms, 103 Ko transférés — le chemin critique) ; `ui-*.js` 220 → 809 ms ;
CSS 222 → 602 ms ; DOM prêt / chargé 1 346 / 1 347 ms ; API commerce
1 476 → 1 638 ms (162 ms) ; LCP 1 844 ms (`p.titre-carte`) — rendu +
peinture après l'API ≈ 200 ms. Analyse des chunks (build avec sourcemaps,
`node_modules/.cache/analyse-chunks/dist`) : JS initial 453 Ko =
`index-*.js` 354 785 o (React+ReactDOM ~moitié + App + Jouer/Caisse/
CartePublique épinglées par P2-Q2) + `ui-*.js` 97 727 o (store, router, API,
`seed.json`) + runtimes ; les 61 KiB `unused-javascript` de Lighthouse sont
le code Caisse + CartePublique, épinglés par P2-Q2 (caisse hors ligne après
une seule visite — décision produit, pas un test faux). Graphe d'imports
vérifié : chaque module de l'entrée est importé par Jouer, Caisse ou
CartePublique (ou `main.tsx`/`api.ts`/store) — aucun poids mort. DOM :
117 nœuds seulement ; la roue tourne en `transform` composité (60 fps, sans
repeindre) — pas la cause du style/layout. Leviers examinés et écartés
(détail § « Leviers examinés et ÉCARTÉS ») : coquille statique au lieu du
squelette (gain estimé −~300–400 ms de LCP, mais renverse la décision
P0-U1 — test `chargement-p0-u1` non faux, décision produit à trancher par
l'utilisateur) ; lecture anticipée du coffre (~50–100 ms, sous le bruit,
chemin de démarrage sécurisé) ; `seed.json` dynamique (~0 ms sur le LCP,
hors chemin critique — confirmé par mesure) ; beacon `evenements`
(post-LCP, sans effet).
**Décision : ANNULÉ** — aucun changement tenté : tous les leviers
restants sont sous le bruit de mesure (± ~0,2 s) ou bloqués par une
décision produit délibérée. Tours sans gain consécutifs : **1**.
Branche `autonome/boucle-t3-tbt` supprimée sans fusion.

### Test épinglé par le tour 2 — preuve et validation Codex requise

Le tour 2 casse `tests/photos-menu.test.ts:68`, qui liste tous les `.webp` de
`public/visuels/` et exige l'égalité stricte avec les 18 fichiers du menu :
`assert.deepEqual(presents.sort(), [...FICHIERS].sort())`. Preuve que le test
est faux dans sa prémisse, pas dans son exigence :
- l'exigence (« exactement les 18 `menu-*.webp` attendus, aucun autre ») est
  intacte : `logo-petit.webp` n'est pas un `menu-*.webp` (ni par son nom, ni
  par son rôle — variante du logo pour l'écran de chargement) ;
- seule sa prémisse (« tout `.webp` du dossier est une photo de menu ») est
  caduque depuis l'ajout d'un logo dérivé dans le même dossier ;
- la correction proposée (une ligne : filtrer `f.startsWith('menu-')` avant
  la comparaison) conserve exactement l'exigence — le nom du test lui-même
  (« aucun autre menu-*.webp que les 18 attendus ») décrit le filtre.
Séquence réelle : preuve documentée ici, puis revue Codex du tour (validation
demandée), puis correction appliquée.

### Second test épinglé par le tour 2 — preuve et validation Codex requise

La mise à jour de `SCORES.md` pour le tour 2 casse `tests/mesure-p1-u1.test.ts:27`
(« parcours scan → lot P1-U1 » : `5 lignes attendues (4 étapes + total), lues : 10`).
Preuve que le test est faux dans sa prémisse, pas dans son exigence :
- l'exigence (« l'arithmétique du tableau P1-U1 : 4 étapes + total re-calculé,
  totaux < 30 s ») est intacte : le tableau P1-U1 lui-même n'a pas bougé ;
- sa prémisse (« une seule table 2 passes entre le titre P1-U1 et
  `## Cohérence DA` ») est caduque : l'extraction
  `split('### Re-mesure P1-U1 …')[1].split('## Cohérence DA')[0]` englobe
  TOUTES les sous-sections du parcours (P2-Q2, t0, t1, t2) ; elle ne passait
  jusque-là que parce que les tables P2-Q2/t0 utilisent un format qui ne
  correspond pas à la regex (`\d+ ms` sans espace) — la table t2, en nombres
  pleins comme P1-U1, fait passer le compte à 10 lignes ;
- la correction proposée (une ligne : borner l'extraction à la prochaine
  sous-section, `split('### Re-mesure')[0]` après le titre P1-U1) conserve
  exactement l'exigence — elle ne lit plus que le tableau P1-U1 — et rend le
  test robuste aux tours suivants.
Séquence réelle : preuve documentée ici, puis revue Codex ciblée (validation
demandée), puis correction appliquée.

### Test épinglé par le tour 7 — preuve et validation Codex requise

Le remplacement de la variante `hero-plats-petit.webp` (720×480, 75 588 o)
par sa version recadrée au ratio d'affichage (720×180, 27 382 o) casse
`tests/boucle-t6-banniere.test.ts` (« WebP 720 px de large valide, < 120 Ko » :
`hauteur 480 attendue, lue : 180` ; taille 27 382 o < 120 000 o, passe).
Preuve que le test n'est pas faux dans son exigence, mais que son assertion
de dimensions épingle l'ancien actif :
- l'exigence (« la variante est un WebP valide, aux dimensions attendues,
  sous un plafond de poids ») est intacte : le fichier est le même
  (`hero-plats-petit.webp`), le même rôle (bannière de la carte), la même
  source (`hero-plats.jpg`) ; seul son recadrage change, délibérément
  (boucle t7, candidat noté par la revue Codex t6 point 3) ;
- le rendu est quasi identique : l'`object-cover` recadrait déjà la variante
  720×480 au centre (bande 720×177) pour l'affichage 390×96 — vérifié
  visuellement sur planche de comparaison (original + recadrage, lus avant
  le changement) ;
- la correction (dimensions 720×180, plafond < 60 Ko au lieu de < 120 Ko)
  RESSERRE le test au lieu de l'assouplir : la borne de poids est divisée
  par deux, et les dimensions épinglées sont celles du nouvel actif
  délibéré — aucune assertion n'est retirée, aucune exigence affaiblie.
Séquence réelle : preuve documentée ici, puis revue Codex du tour
(validation demandée sur ce point précis), puis fusion seulement si la
revue valide.

### Test épinglé par le tour 9 — preuve et validation Codex requise

Le remplacement de la variante `table-sushis-petit.webp` (720×1279,
95 494 o) par sa version recadrée à la bande visible de la carte (720×590,
51 402 o) casse `tests/boucle-t4-hero.test.ts` (« WebP valide 720 px de
large » : `hauteur 1279 attendue, lue : 590` ; taille 51 402 o < 120 000 o,
passe ; 51 402 o < 195 989 o / 1,5, passe).
Preuve que le test n'est pas faux dans son exigence, mais que son assertion
de dimensions épingle l'ancien actif :
- l'exigence (« la variante est un WebP valide, aux dimensions attendues,
  nettement plus léger que le JPEG ») est intacte : le fichier est le même
  (`table-sushis-petit.webp`), le même rôle (héros du menu + de la carte),
  la même source (`table-sushis.jpg`) ; seul son recadrage change,
  délibérément (boucle t9, même motif que le tour 7 pour la bannière) ;
- le rendu est très proche sur les deux pages : le menu montre le centre
  720×413 de la nouvelle bande (identique à ce qu'il montrait de l'ancienne),
  la carte la montre entière (identique à ce qu'elle montrait) — vérifié
  visuellement sur planche de comparaison des bandes avant le changement ;
- la correction (dimensions 720×590, plafond < 60 Ko au lieu de < 120 Ko,
  « ~2× » → « ~4× plus léger ») RESSERRE le test au lieu de l'assouplir :
  la borne de poids est divisée par deux, et les dimensions épinglées sont
  celles du nouvel actif délibéré — aucune assertion n'est retirée, aucune
  exigence affaiblie (le contrôle relatif « au moins 1,5× plus léger que le
  JPEG » est conservé tel quel).
Séquence réelle : preuve documentée ici, puis revue Codex du tour
(validation demandée sur ce point précis), puis fusion seulement si la
revue valide.

### Test épinglé par le tour 10 — preuve et validation Codex requise

L'ajout de 6 variantes WebP à `VISUELS` casse `tests/visuels.test.ts`
(« existe et pèse ≤ 250 Ko » : `interieur-salon-petit.webp : 5 560 o,
fichier suspect (trop petit)` et `menu-plat-riz-petit.webp : 6 586 o,
fichier suspect (trop petit)` — la garde exige `taille > 10_000`).
Preuve que le test n'est pas faux dans son exigence, mais que sa garde
« > 10 000 o » repose sur une prémisse caduque :
- l'exigence (« chaque fichier de `VISUELS` existe, est un vrai visuel
  non corrompu, et pèse ≤ 250 Ko ») est intacte : les deux fichiers sont
  des WebP valides (RIFF/WEBP/VP8 + dimensions vérifiées par les autres
  assertions du même test et par le nouveau test `boucle-t10`), rendus
  par le navigateur dans la mesure ponctuelle (journal des requêtes +
  `img.complete`) ;
- la prémisse (« tout fichier < 10 000 o est suspect ») est fausse pour
  des variantes légitimes et petites : 320×157 et 424×139 recadrées au
  ratio d'affichage ne peuvent pas peser 10 Ko en WebP q75 sans
  gonflement artificiel (qualité poussée sans gain visuel) — le
  précédent t5 (`LOGO_DEFAUT_PETIT` hors `VISUELS` pour 4 900 o) montrait
  déjà que le seuil ne convient pas aux petites variantes ;
- la correction proposée (garde `> 10_000` → `> 3_000`) conserve
  l'intention : un fichier vide ou minuscule échoue toujours — et
  l'absence de troncature est vérifiée autrement que par la taille :
  décodage intégral des 6 variantes par Pillow (`Image.load()`,
  vérifié le 11/11/2026 : 6/6 OK) + rendu par le navigateur dans la
  mesure ponctuelle (journal des requêtes + `img.complete`) ; aucune
  assertion n'est retirée, seul le seuil change ; l'alternative
  (2 constantes séparées hors `VISUELS` pour 2 fichiers sur 6) éclaterait
  un même motif sur deux mécanismes pour un seuil arbitraire.
Séquence réelle : preuve documentée ici, puis revue Codex du tour
(validation demandée sur ce point précis), puis fusion seulement si la
revue valide.

### Second test épinglé par le tour 10 — preuve et validation Codex requise

L'extension de l'interface `PhotoCategorie` (`srcPetit` ajouté, boucle t10)
casse `tests/visuels.test.ts:74` (« Sushis → rouleau sur ardoise… » :
`deepEqual` attend `{ src, alt }`, reçoit `{ src, srcPetit, alt }`).
Preuve que le test n'est pas faux dans son exigence, mais qu'il épingle la
forme exacte du retour :
- l'exigence (« chaque catégorie connue renvoie la bonne photo et le bon
  libellé, aucune photo inventée ») est intacte : `src` et `alt` sont
  inchangés ; seul un champ s'ajoute, délibérément (la variante WebP) ;
- la correction (ajouter `srcPetit` aux deux objets attendus du
  `deepEqual`) ne retire aucune assertion et n'affaiblit aucune exigence
  — les deux autres tests du même `describe` (qui lisent `?.src`)
  passent sans modification.
Séquence réelle : preuve documentée ici, puis revue Codex du tour
(validation demandée sur ce point précis), puis fusion seulement si la
revue valide.

### Troisième test épinglé par le tour 10 — preuve et validation Codex requise

L'ajout de 2 variantes `menu-*-petit.webp` casse
`tests/photos-menu.test.ts` (« aucun autre menu-*.webp que les 18
attendus » : 20 fichiers lus au lieu de 18).
Preuve que le test n'est pas faux dans son exigence, mais que sa prémisse
(« tout `menu-*.webp` du dossier est une photo de plat du PDF ») est
caduque depuis t10 — même motif que le tour 2 (`logo-petit.webp`,
déjà filtré par le préfixe) :
- l'exigence (« exactement les 18 photos de plats du PDF, aucun autre »)
  est intacte : les 2 nouveaux fichiers ne sont pas des photos de plats
  (ce sont des variantes de photos de catégories, dérivées de JPEG de
  galerie, pas de l'extraction PDF) ;
- la correction proposée (une condition : exclure `*-petit.webp` du
  filtre) conserve exactement l'exigence — les 18 photos de plats doivent
  toujours exister et aucun autre `menu-*.webp` non-variante ne peut
  apparaître ; le suffixe `-petit.webp` marque les variantes, comme
  `logo-petit.webp` déjà exclu par le préfixe au tour 2.
Séquence réelle : preuve documentée ici, puis revue Codex du tour
(validation demandée sur ce point précis), puis fusion seulement si la
revue valide.

## Baseline t0 (11/11/2026 ~14:35 UTC, HEAD `7395522`, `autonome/integration`)

Mesure de référence avant le tour 1 (même protocole que P2-Q2, 2 passes) —
détail dans `SCORES.md` (§ « Re-mesure boucle t0 » sous chaque métrique) et
`node_modules/.cache/mesure-boucle-t0/` :

| Métrique | Passe 1 | Passe 2 |
| --- | --- | --- |
| Premier affichage `#/jouer` (Slow 4G) | 2 261 ms | 2 197 ms |
| LCP `#/jouer` (`p.titre-carte`) | 2 248 ms | 2 148 ms |
| Parcours scan → lot (étapes) | 6 664 ms | 7 343 ms |
| Ouverture carte après gain | 592 ms | 699 ms |
| Menu direct (premier affichage / LCP) | 1 531 / 1 508 ms | 1 326 / 1 308 ms |
| Lighthouse mobile `#/jouer` | 77 (TBT 910 ms, LCP 2,5 s) | 81 (TBT 630 ms, LCP 2,7 s) |
| Erreurs console / requêtes échouées | 0 / 0 | 0 / 0 |
| Bundle initial (build frais) | JS 481 332 o, CSS 70 766 o, total 552 098 o ; JS total 801 321 o, 22 chunks, plus gros 353 163 o | — |
| Tests | 1163/1163 | — |

Analyse t0 (détail Lighthouse, `lighthouse-passe<N>.json`) : le TBT domine
(630–910 ms) ; `mainthread-work-breakdown` : Other 730–1 086 ms, Script
Evaluation 482–580 ms, Style & Layout 572–695 ms ; `unused-javascript` :
`index-*.js` gaspille 62 KiB sur 102 KiB transférés (61 % inutilisé sur
`#/jouer` — code de la caisse et de la carte) ; tâches longues : évaluation
de `index-*.js` 241–294 ms + tâches « Unattributable » et document
(119–258 ms, rendu React + réponse API). Le premier levier retenu pour le
tour 1 est donc la sortie de `qrcode-generator` (~52 Ko de sources, dans
`ui-*.js` via `components/ui.tsx`) du bundle initial : un seul consommateur
dans le graphe initial, `CarteFidelite` (QR de la carte), qui peut le charger
en différé sans toucher aux pages épinglées. Mesuré : `qrcode.mjs` minifié
= 21 233 o (7 653 o gzip) — la réduction attendue du JS initial est donc
d'environ 21 Ko. Build après le tour : JS initial 452 343 o (−28 989 o,
−6,0 % vs t0), `QrCode-*.js` différé 21 182 o, 24 chunks (le découpage sort
aussi `jsx-runtime-*.js` du `ui-*.js`), JS total 802 475 o (+1 154 o —
enrobage `lazy` + fichier partagé), plus gros chunk 354 246 o.

### Test épinglé par le tour 1 — preuve et validation Codex requise

Le tour 1 casse `tests/corps-sombres-p1-d2.test.ts:44`, qui lit
`src/components/ui.tsx` pour vérifier que le QR garde son fond blanc (zone
de silence) : `assert.match(lire('src/components/ui.tsx'),
/className=\{`\$\{className\} bg-white`\}/)`. Preuve que le test est faux
dans sa prémisse, pas dans son exigence :
- l'exigence (« le svg du QR porte `bg-white` ») est intacte : la ligne est
  reprise **verbatim** dans `src/components/QrCode.tsx` (même composant,
  mêmes props, même rendu) ;
- seule sa prémisse d'emplacement (« le QR vit dans `ui.tsx` ») est caduque,
  puisque le déménagement est précisément le changement du tour ;
- aucun comportement n'a changé : le QR s'affiche toujours, avec le même fond
  blanc, dans l'îlot clair (vérifié par la capture `carte.png` de la mesure
  t1 et par l'E2E `scan-gain-carte`).
La correction proposée (une ligne : lire `src/components/QrCode.tsx` au lieu
de `src/components/ui.tsx`) ne touche donc ni à l'exigence ni au seuil — elle
met à jour l'emplacement lu. Séquence réelle : preuve documentée ici, puis
revue Codex du tour (point 3 : « légitime ; aucune raison d'annuler le tour »),
puis correction appliquée.

## Journal des tours

### Tour 1 — `autonome/boucle-t1-qrcode-differe` (fusionné)

Sujet : sortir `qrcode-generator` du bundle initial — `QrCode` déménage de
`components/ui.tsx` vers `components/QrCode.tsx`, chargé en différé
(`React.lazy` + `Suspense`) dans `CarteFidelite` (seul consommateur du graphe
initial) ; les pages différées (Equipe, MenuCarte, FicheClient, QrVitrine,
Roulette) importent le nouveau module directement. Les lignes JSX
`<QrCode texte={…} />` sont conservées à l'identique (tests
`carte-pwa-p1-c3` et `auth-client-p0-s7` les épinglent). Hypothèse : JS initial
−~21 Ko minifiés, TBT −~50–150 ms, Lighthouse +1–3 points, sans régression
(ouverture carte : le QR apparaît après le chargement du chunk, ~100 ms en
Slow 4G, après le gain — pas dans le chemin scan → lot). Résultat mesuré
(voir SCORES.md § « Re-mesure boucle t1 ») : JS initial −28 304 o (−5,9 %) ;
Lighthouse 77/81 → 80/85, TBT 910/630 → 620/450 ms ; premier affichage,
LCP et parcours plats (bruit de mesure, confirmé par une 3e passe) ;
ouverture carte 600/622/691 ms (3 passes) sans régression. **Test épinglé** :
le tour casse `corps-sombres-p1-d2.test.ts:44` (prémisse d'emplacement
caduque, exigence intacte — preuve ci-dessus ; revue Codex point 3 : mise à
jour légitime, correction d'une ligne appliquée après validation).
**Revue Codex t1 (5 points)** : 1. `Suspense` ne traite pas un import rejeté
→ frontière locale `ErreurQr` ajoutée (la carte reste visible, seule la case
du QR affiche un repli) ; 2. repli annoncé comme un QR utilisable → remplacé
par `role="status"` + « Chargement du QR code… » (traduit EN) ; 3. mise à jour
du test épinglé légitime (appliquée) ; 4. QR hors ligne : suit désormais la
règle des pages différées (disponible hors ligne après une première ouverture
en ligne, pas avant — documenté, pas de préchargement ajouté pour ne pas
fausser les mesures du tour) ; 5. incohérence de documentation (affirmations
anticipées) → libellés corrigés, résultats actualisés après exécution réelle.
**Décision : FUSIONNÉ** — bundle −5,9 %, TBT en baisse sur les 2 passes,
Lighthouse en hausse sur les 2 passes, aucune régression au-delà du bruit.

### Tour 2 — `autonome/boucle-t2-logo-chargement` (fusionné)

Sujet : l'écran de chargement chargeait `/visuels/logo.png` (600×600,
74 451 o) affiché à 96×96 — 31 % des octets du premier affichage. Nouveau
`public/visuels/logo-petit.webp` (192×192, WebP q80, 4 900 o, dérivé du vrai
logo par Pillow) servi en premier via `<picture>` (repli PNG inchangé) ;
ajouté au préchargement du service worker ; documenté dans
`public/visuels/SOURCES.md`. Hypothèse : premier affichage −~0,2–0,3 s en
Slow 4G, LCP en baisse, Lighthouse +1–3 points, TBT plat. Résultat mesuré
(voir SCORES.md § « Re-mesure boucle t2 ») : premier affichage
2 355/2 232/2 235 → 2 078/1 861 ms (moyenne −304 ms), LCP 2 340/2 220/2 224 →
2 028/1 812 ms (moyenne −341 ms), parcours 7 213/6 971/6 987 → 6 141/6 277 ms
(la validation en caisse gagne aussi : chaque chargement de page affiche
l'écran de chargement) ; Lighthouse 80/85 → 84/81 (plat, bruit), LCP
Lighthouse 2,9/2,8 → 2,3/2,2 s, TBT 620/450 → 590/720 ms (mixte) ; bundle
inchangé ; 0 erreur console, 0 requête échouée ; journal des requêtes :
`logo-petit.webp` servi, plus aucun `logo.png` sur `#/jouer`.
**Tests épinglés** : `photos-menu.test.ts:68` (filtre `menu-` — preuve
ci-dessus, revue Codex t2 point 3 : légitime) et `mesure-p1-u1.test.ts:27`
(extraction bornée à la sous-section — preuve ci-dessus, revue Codex ciblée :
légitime, aucune assertion retirée).
**Revue Codex t2 (5 points)** : 1. défaut hors ligne du SW — `fichier()` ne
consultait que `CACHE_FICHIERS` → repli `caches.match` ajouté + test de
régression (vérifié : échoue sans le correctif, passe avec) ; 2. `<picture>`
correct, PNG pas un repli en cas d'échec de chargement → commentaire du test
corrigé ; 3. correction du test menu légitime (appliquée) ; 4. lecture des
dimensions WebP fragile mais correcte → assertions chunk `VP8 ` + signature
ajoutées ; 5. mentions « suite verte » anticipées → corrigées après le passage
réel (1171/1171).
**Décision : FUSIONNÉ** — premier affichage et LCP en baisse sur les
2 passes au-delà du bruit, parcours en baisse, Lighthouse plat, aucune
régression au-delà du bruit.

### Tour 3 — `autonome/boucle-t3-tbt` (annulé — aucun levier au-dessus du bruit)

Sujet : le TBT reste le levier n° 1 (Lighthouse 590/720 ms). Investigation
sans changement de code — chronologie d'une passe
(`node_modules/.cache/profil-t3/chronologie.mjs`) : FCP 648 ms ;
`index-*.js` 220 → 1 152 ms (932 ms, 103 Ko transférés — le chemin critique) ;
`ui-*.js` 220 → 809 ms ; DOM prêt 1 346 ms ; API commerce 1 476 → 1 638 ms ;
LCP 1 844 ms. Analyse des chunks (build avec sourcemaps) : JS initial
453 Ko = `index-*.js` 354 785 o (React+ReactDOM ~moitié + pages épinglées
P2-Q2) + `ui-*.js` 97 727 o (store, `seed.json`) + runtimes ; les 61 KiB
`unused-javascript` sont le code Caisse + CartePublique, épinglés par P2-Q2.
Graphe d'imports vérifié : aucun poids mort dans l'entrée. DOM 117 nœuds ;
roue en `transform` composité — pas la cause du style/layout. Leviers
écartés (détail § « Leviers examinés et ÉCARTÉS ») : coquille statique au
lieu du squelette (gain estimé −~300–400 ms de LCP, mais renverse la
décision P0-U1 — décision produit à trancher par l'utilisateur, proposée
dans `RAPPORT.md`) ; lecture anticipée du coffre (~50–100 ms, sous le
bruit, chemin de démarrage sécurisé) ; `seed.json` dynamique (~0 ms sur le
LCP, hors chemin critique — confirmé par mesure) ; beacon `evenements`
(post-LCP, sans effet).
**Décision : ANNULÉ** — aucun changement tenté. Tours sans gain
consécutifs : **1**. Branche supprimée sans fusion.

### Tour 4 — `autonome/boucle-t4-menu-images` (fusionné)

Sujet : la photo d'en-tête du vrai menu (`table-sushis.jpg`, 788×1400,
195 989 o, affichée ~390×224 en `object-cover`) est l'élément LCP de
`#/menu` pour Asian Home — mesuré 1 949 → 3 404 ms de transfert à froid.
Changement : nouveau `public/visuels/table-sushis-petit.webp` (720×1279,
WebP q75, 95 494 o, Pillow, −51 %) servi en premier via `<picture>` (repli
JPEG inchangé) dans `MenuPublic.tsx` (héros, `h-56`) ET `CartePublique.tsx`
(bannière, `h-80`) — même visuel, même motif, un seul changement ;
constante `VISUELS.tableSushisPetit` dans `src/lib/visuels.ts` ; documenté
dans `public/visuels/SOURCES.md`. `table-sushis.jpg` reste intact partout.
Le héros n'est PAS préchargé dans le SW : 95 Ko, seuls les petits visuels
de marque sont préchargés ; les photos de contenu sont mises en cache à la
première visite, comme les photos de plats (`public/sw.js` identique à t2,
aucune modification nette). Hors ligne, le héros peut manquer s'il n'a pas
déjà été mis en cache par une visite en ligne (ou après éviction) — après
mise en cache, il reste disponible ; dégradation acceptable pour une photo
d'ambiance. Justification du non-préchargement par Lighthouse non démontrée
(séries trop petites et dispersées — revue Codex t4) ; la décision repose
sur la cohérence avec les photos de plats, pas sur le TBT.
Mesure ponctuelle (le protocole standard utilise un commerce générique, sans
visuels : le héros n'y apparaît pas) — script `node_modules/.cache/profil-t4/
mesurer-menu-asian-home.mjs`, commerce nommé « Asian Home Paris », Pixel 7,
Slow 4G + CPU ×4, SW bloqués, cache désactivé, navigateur relancé par passe :
**LCP menu 3 428 / 3 376 ms → 3 076 / 2 892 ms** (moyenne 3 402 → 2 984 ms,
−418 ms, 2 passes sur 2 ; héros WebP 2 065 → 3 044 ms, 95 794 o transférés ;
plus aucun `table-sushis.jpg` dans le journal). Sans le blocage des SW, le SW
intercepte les images (`transferSize: 0`) et masque leur coût réseau réel —
c'est pourquoi le protocole standard bloque les SW. Confirmation avec le
script versionné (`scripts/mesurer-menu-asian-home.mjs`) : 2 912 / 2 960 ms.
Mesures standard (2 passes) : premier affichage `#/jouer` 1 896 / 1 895 ms ;
LCP 1 872 / 1 844 ms ; parcours 6 738 / 6 854 ms ; ouverture carte 616 / 684 ms ;
menu direct 1 610 / 1 773 ms ; menu hash 900 / 895 ms ; 0 erreur console,
0 requête échouée. Lighthouse t4 (9 passes) : 78, 76, 75, 81, 77, 74, 80, 79,
80 (moyenne 77,8 ; TBT 680–1 030 ms) contre t2 : 84/81 (TBT 590/720). ABAB
décisif : `git stash -u` (code t4 retiré), rebuild, Lighthouse **81 (TBT
670 ms) / 82 (TBT 650 ms)** ; `git stash pop`, rebuild, **79 (TBT 810 ms) /
80 (TBT 750 ms)** dans la même fenêtre. Différence propre au tour ≈ 1–2
points, ~100 ms de TBT — dans le bruit (±5 points, ±150 ms). Le creux des
premières passes (74–76) était de la variance hôte (VM partagée 1,5 CPU) +
petit échantillon à t2 (2 passes). Aucun processus parasite trouvé
(`ps aux` : seul le daemon hatch, 5,2 % CPU ; aucun port 43xx en écoute).
Bundle : JS initial 453 028 → 453 181 o (+153 o, +0,03 %), CSS 70 766 o
inchangé, total 523 794 → 523 947 o, 24 chunks.
Tests : suite complète **1176/1176** (1171 + 4 `tests/boucle-t4-hero.test.ts`
+ 1 test auto : `tests/visuels.test.ts` génère un test par entrée `VISUELS`,
et le tour ajoute `tableSushisPetit` — écart de compteur corrigé en cours de
tour : README/SCORES annonçaient 1175, la suite réelle était 1176 ; le test
`documentation-p2-q5` ne recoupe que README vs SCORES et le nombre de
fichiers, pas le total absolu — le compteur doit être vérifié à chaque tour).
E2E 3/3. Le test P1-C5 (`menu-client-p1-c5.test.ts:235`) passe SANS
modification : la regex lit toujours la balise `<img>` de repli.
Revue Codex t4 (5 points) : 1. `<picture>` fondés, avec `className="block"`
à ajouter sur les deux `<picture>` — **corrigé** (l'élément inline perdait
la marge verticale `space-y-*` du parent) ; hauteur 1279 épinglée dans le
test — **corrigé** ; le test « WebP valide » surpromet (pas de décodage
complet) — **noté** : le décodage est prouvé par la mesure (le WebP est
l'élément LCP dans les 4 passes après) ; 2. non-préchargement fondé,
justification Lighthouse non démontrée — **corrigé dans la documentation**
(précision hors ligne : manque seulement s'il n'a pas déjà été mis en
cache) ; 3. mesure ponctuelle fondée comme preuve ciblée à froid —
**corrigé** : script versionné dans `scripts/mesurer-menu-asian-home.mjs`
(au lieu de `node_modules/.cache` seul) ; gain formulé comme résultat
observé sur 2 passes (+2 de confirmation), pas comme gain garanti en
production ; la mesure ne couvre ni le SW actif ni une visite chaude ;
4. fusion malgré Lighthouse fondée, avec incertitude explicite — le signal
ABAB défavorable (−2 points, TBT 660 → 780 ms) est **conservé tel quel**
dans `SCORES.md`, pas effacé ; une annulation exigerait une régression
reproductible mieux établie ; 5. 720 px q75 fondé (1,85 px source / px CSS
à 390 px ; 480 px = 1,23) — **gardé** ; `SOURCES.md` indiquait encore
2268×4032 pour le JPEG livré en 788×1400 — **corrigé**.
**Décision : FUSIONNÉ** (gain menu LCP −418 ms moyen, 2/2 passes, bien
au-delà du bruit ; `#/jouer` Playwright plat ; effet propre du tour sur
Lighthouse ≈ 0–2 points d'après l'ABAB ; bundle +0,03 % ; 0 erreur).
Tours sans gain consécutifs : **1** (t3).

### Tour 5 — `autonome/boucle-t5-logo-commerce` (fusionné) — REGARD NEUF

Sujet (regard neuf, § dédié ci-dessus) : le protocole standard ne voit
jamais le logo du commerce (74 Ko, affiché 64×64 sur toutes les pages
client du vrai restaurant). Changement : `LogoCommerce`
(`src/components/ui.tsx`) sert la variante `logo-petit.webp` (192×192,
WebP q80, 4 900 o, créée au tour 2) en premier via `<picture
className="block shrink-0">`, le PNG 600×600 restant le repli — seulement
quand `logo === VISUELS.logo` (logo par défaut) ; un logo téléversé
(branche `estLogoTeleverse`, img simple `bg-nuit-950 object-contain`,
inchangée) ou renseigné par le commerçant garde sa balise `<img>` simple.
Constante `LOGO_DEFAUT_PETIT` dans `src/lib/visuels.ts`, hors de `VISUELS`
(le test `visuels.test.ts` exige > 10 000 o par entrée) ; documenté dans
`public/visuels/SOURCES.md`. `logo.png` reste intact partout.
Mesure ponctuelle (`scripts/mesurer-menu-asian-home.mjs`, étendu au tour 5
à `#/jouer` — page neuve par mesure, une navigation par hash ne recharge
pas le document) : **LCP `#/menu` 2 892 / 2 908 ms → 2 572 / 2 588 ms
(moyenne −320 ms, 2 passes sur 2)** — le héros WebP finit à 2 537 /
2 548 ms (était 2 860 / 2 876 ms), `logo.png` a disparu du journal ; gain
compatible avec une moindre concurrence réseau (le logo 74 Ko et le héros
95 Ko partaient en parallèle sur le même tuyau 4G), pas une preuve du temps
de tuyau exact. LCP `#/jouer` : 1 744 / 1 648 ms → 1 740 / 1 648 ms
(**plat**, attendu : le logo n'est pas le LCP — `p.titre-carte` — et finit
après lui). Mesures standard (2 passes) : premier affichage `#/jouer`
1 894 / 1 883 ms ; LCP 1 880 / 1 828 ms ; parcours 6 753 / 6 534 ms ;
ouverture carte 786 / 484 ms ; menu direct 1 690 / 1 706 ms ; menu hash
936 / 920 ms ; 0 erreur console, 0 requête échouée. Lighthouse t5 :
78 / 80 (TBT 860 / 700 ms, LCP 2,3 / 2,5 s) contre 78/76 à t4 — plat.
Bundle : JS initial 453 181 → 453 485 o (+304 o, +0,07 %), CSS 70 766 o
inchangé, total 523 947 → 524 251 o, 24 chunks.
Tests : suite complète **1180/1180** (1176 + 4 `tests/boucle-t5-logo-commerce.test.ts`),
73 fichiers ; E2E 3/3. Compteurs corrigés en cours de tour : README/SCORES
annonçaient 72 fichiers (le test `documentation-p2-q5` l'a signalé) ; la
ligne SCORES « +73 tests P2-Q3 à P2-Q6 » a failli être réécrite en +77
par erreur — l'arithmétique de la ligne de couverture doit être vérifiée
à chaque tour (1090 + 73 + 3 + 4 + 1 + 4 + 1 + 4 = 1180).
Incident de mesure (tour 5) : un lancement de `mesurer-scores.mjs` SANS
`--sortie` a écrasé `node_modules/.cache/mesure-p0-u0/resultats.json` +
9 captures P0-U0 (archive brute non versionnée — ses chiffres sont
conservés dans `SCORES.md`, la passe t5 contenue dans le fichier écrasé a
été récupérée comme passe 1, `mesure-boucle-t5/resultats-passe1.json` ;
`lighthouse-jouer.json` et `resultats-3/4/5.json` du même dossier ont
survécu, noms différents). Correctif appliqué (revue Codex t5, point 5) :
`mesurer-scores.mjs` et `mesurer-lighthouse.mjs` refusent désormais
d'écraser leur sortie par défaut sans `--sortie` explicite (vérifié :
les deux refusent, archives intactes). Règle : toujours passer `--sortie`.
Revue Codex t5 (5 points) : 1. `<picture className="block shrink-0">`
fondé — le `shrink-0` doit être sur le `<picture>` (élément flex), celui
de l'`<img>` est superflu dans cette branche — **gardé tel quel**
(inoffensif, cohérent avec les autres branches ; le test épingle la
classe exacte) ; `block` redondant en flex mais utile ailleurs —
**gardé** ; 2. égalité stricte `logo === VISUELS.logo` fondée, ne pas
élargir à `estLogoLocal()` — un autre `/visuels/...` garde son image
propre ; amélioration facultative (vérification du rendu avec un autre
logo local) **notée, non appliquée** (le test regex couvre la condition) ;
3. constante hors `VISUELS` acceptable — **noté pour plus tard** :
l'intégrer avec une validation adaptée aux petits fichiers, sans abaisser
indistinctement la garde de tous les visuels ; 4. fusion justifiée, avec
réserve d'interprétation — le même contexte conserve le stockage et peut
réutiliser des connexions (routes pas totalement indépendantes), protocole
comparable avant/après ; gain formulé « compatible avec une moindre
concurrence réseau » — **appliqué dans SCORES.md/CHANGELOG.md/BOUCLE.md** ;
5. incident fondé — garde anti-écrasement **appliquée aux deux scripts**,
perte des données brutes P0-U0 documentée ici, chiffres conservés dans
`SCORES.md` distingués des brutes perdues ; captures P0-U0 également
remplacées (même dossier).
**Décision : FUSIONNÉ** (gain menu LCP −320 ms, 2/2 passes, bien au-delà
du bruit ; `#/jouer` plat comme attendu ; standard et Lighthouse plats ;
bundle +0,07 % ; 0 erreur). Tours sans gain consécutifs : **0**.

### Tour 6 — `autonome/boucle-t6-banniere-carte` (fusionné)

Sujet : la bannière de la carte (`hero-plats.jpg`, 1024×683, 177 369 o,
affichée 390×96 en `object-cover`, `h-24`) partage le tuyau 4G avec le
héros de la carte (`table-sushis-petit.webp`, élément LCP de `#/carte`).
Changement : nouveau `public/visuels/hero-plats-petit.webp` (720×480,
WebP q75, 75 588 o, Pillow, −57 %) servi en premier via `<picture
className="block">` dans `CarteFidelite.tsx`, le JPEG restant le repli ;
le `<source>` WebP n'est rendu que si `banniere === VISUELS.heroPlats`
(bannière par défaut) — une bannière configurée par le commerçant garde
sa balise `<img>` simple (le `<picture>` reste, sans `<source>`) ;
constante `VISUELS.heroPlatsPetit` dans `src/lib/visuels.ts` ; documenté
dans `public/visuels/SOURCES.md`. `hero-plats.jpg` reste intact partout.
Mesure ponctuelle (nouveau script versionné
`scripts/mesurer-carte-asian-home.mjs`, commerce « Asian Home Paris »,
parcours complet, Pixel 7, Slow 4G + CPU ×4, SW bloqués, cache désactivé,
navigateur relancé par passe) : deux mesures — (1) la transition réelle
(clic « Voir ma carte » depuis `#/jouer` → héros et bannière
chargés/décodés/affichés, `currentSrc` relevé) ; (2) le chargement direct
(nouvelle page du même contexte, jeton dans le localStorage) pour le LCP
classique (le LCP d'une navigation par hash n'est pas mesurable — comme
pour `#/menu` dans le protocole standard, où le LCP par hash est null).
Première version du script : LCP par hash null (attendu, cf. standard) +
crash en passe 2 (même téléphone deux fois sur le même commerce : la
seconde inscription ne repasse pas par `[data-attente="en-cours"]`) +
`href` lu après le clic (le lien n'existe plus une fois sur la carte) —
corrigés : téléphone différent par passe, `href` lu avant le clic,
mesure directe dans une nouvelle page du même contexte.
**Avant** (ABAB, `git stash -u` des fichiers du tour, rebuild) :
transition — héros 1 531 / 1 604 ms (moyenne 1 568 ms), bannière 1 919 /
1 921 ms (moyenne 1 920 ms), `currentSrc` = `hero-plats.jpg` ; LCP
direct 3 464 / 3 308 ms et 3 432 / 3 192 ms (moyenne des 4 passes
3 349 ms, élément `img.h-80` = le héros, pas la bannière) ; bannière JPEG
2 226 → 3 775 ms (177 669 o).
**Après** (3 runs, 6 passes) : transition — héros 1 432 / 1 365 ms puis
1 375 / 1 345 ms (moyenne ~1 379 ms, **−~190 ms**), bannière 1 439 /
1 372 ms puis 1 382 / 1 351 ms (moyenne ~1 386 ms, **−~530 ms**),
`currentSrc` = `hero-plats-petit.webp` ; LCP direct 3 208 / 3 092 ms,
3 220 / 3 208 ms, 3 204 / 3 224 ms (moyenne des 6 passes ~3 176 ms,
**−~170 ms**) ; chargement direct 2 503 / 2 284 ms puis 2 425 / 2 409 ms
puis 2 416 / 2 487 ms (était 2 656 / 2 480 ms et 2 658 / 2 404 ms).
Le gain se transpose donc au parcours réel (transition par hash), pas
seulement au chargement direct — c'est le point que la revue Codex t6
demandait de démontrer (point 2, levé par l'ABAB).
Mesures standard (2 passes) : premier affichage `#/jouer` 1 881 / 1 817 ms ;
LCP 1 868 / 1 800 ms ; parcours 6 396 / 6 577 ms ; ouverture carte 513 / 602 ms ;
menu direct 1 618 / 1 681 ms ; 0 erreur console, 0 requête échouée.
Lighthouse t6 : 78 / 79 (TBT 740 / 770 ms, LCP 2,7 / 2,4 s) contre 78/80 à t5
— plat. Bundle : JS initial 453 485 → 453 667 o (+182 o, +0,04 %),
CSS 70 766 o inchangé, total 524 251 → 524 433 o, 24 chunks.
Tests : suite complète **1184/1184** (1180 + 3 `tests/boucle-t6-banniere.test.ts`
+ 1 test auto : `tests/visuels.test.ts` génère un test par entrée `VISUELS`,
et le tour ajoute `heroPlatsPetit`), 74 fichiers ; E2E 3/3.
Revue Codex t6 (5 points) : 1. `<picture>` systématique fondé (zéro
`<source>` autorisé, reset Tailwind : l'img est déjà en bloc) — **aucune
correction** ; 2. mesure par chargement direct valable seulement pour le
chargement direct — **corrigé par l'ABAB** : mesure de la transition réelle
ajoutée (clic → héros/bannière affichés) + passes avant/après alternées
(stash/rebuild) — le gain se transpose au parcours réel (héros −~190 ms,
bannière −~530 ms) ; 3. 720 px q75 fondé (1,85 px source / px CSS) —
**gardé** ; variante recadrée au ratio de la bannière (~720×180) **notée
comme candidat t7** (l'`object-cover` jette beaucoup de pixels téléchargés) ;
4. script partiellement fondé — **corrigé** : écouteurs d'erreurs ajoutés
sur `pageCarte` (console/pageerror/requestfailed/HTTP ≥ 400) avant son
`goto`, en-tête corrigé (transition réelle + chargement direct) ; 5. fusion
justifiée, conclusion de performance limitée — **noté** : ~102 Ko économisés
pour +182 o de JS ; aucun risque fonctionnel dans `Reglages`/`FicheClient`
(même condition, même repli, mêmes dimensions) ; contrôle navigateur
`currentSrc` **fait** (relevé dans la transition réelle, pas seulement
dans le journal).
**Décision : FUSIONNÉ** (gain transition réelle héros −~190 ms et bannière
−~530 ms, LCP direct −~170 ms, 2/2 passes dans chaque run ; standard et
Lighthouse plats ; bundle +0,04 % ; 0 erreur). Tours sans gain
consécutifs : **0**.

### Tour 7 — `autonome/boucle-t7-banniere-recadree` (fusionné)

Sujet (candidat noté par la revue Codex t6, point 3) : la variante 720×480
de la bannière est affichée 390×96 en `object-cover` — ~63 % de ses pixels
sont jetés (bande visible 720×177). Changement : même fichier
`public/visuels/hero-plats-petit.webp`, recadré au ratio d'affichage —
720×480, 75 588 o → **720×180, 27 382 o** (recadrage centré 1024×256 de
`hero-plats.jpg` puis redimensionnement 720×180, Pillow, WebP q75, −64 %).
Aucun changement de code (le `<picture>` du tour 6 sert le même fichier) ;
seuls changent l'actif, son commentaire dans `src/lib/visuels.ts`, sa ligne
dans `public/visuels/SOURCES.md`, et le test `tests/boucle-t6-banniere.test.ts`
(dimensions 720×480 → 720×180, plafond < 120 Ko → < 60 Ko).
Vérification visuelle avant le changement (planche de comparaison original
+ recadrage, lue) : la bande centrale garde l'ardoise de sushis/makis, le
dessert mangue à gauche, le plat à l'œuf à droite ; elle perd le haut (bol
de riz, rose de tomate) et le bas (nouilles, brochettes, saumon) — le rendu
est très proche, avec des différences de redimensionnement et de compression
(l'identité stricte n'est pas revendiquée). À toute largeur ≥ 360 px, la
bande visible est la même qu'avant (le ratio 4:1 du fichier couvre les
ratios d'affichage 3,75:1 à 4,67:1).
Mesure ponctuelle (`scripts/mesurer-carte-asian-home.mjs`) :
**avant** (720×480, 2 passes) : transition — héros chargé 1 394 / 1 399 ms
(moyenne 1 397 ms), bannière chargée 1 400 / 1 409 ms (moyenne 1 405 ms) ;
LCP direct 3 124 / 3 200 ms (moyenne 3 162 ms) ; chargement direct
2 415 / 2 413 ms.
**Après** (720×180, 4 passes, 2 runs) : transition — héros chargé 1 164 /
1 201 ms puis 1 153 / 1 120 ms (moyenne 1 160 ms, **−237 ms**), bannière
chargée 1 172 / 1 208 ms puis 1 160 / 1 125 ms (moyenne 1 166 ms,
**−239 ms**) ; LCP direct 3 004 / 2 884 ms puis 3 116 / 3 004 ms (moyenne
3 002 ms, **−160 ms**) ; chargement direct 2 422 / 2 303 ms puis
2 593 / 2 571 ms (plat). Les 4 passes après sont sous les 2 passes avant
sur les deux métriques de transition (après max 1 201 ms < avant min
1 394 ms pour le héros ; après max 1 208 ms < avant min 1 400 ms pour la
bannière) — séparation nette. Les 48 206 o économisés valent ~230 ms au
débit configuré (1,6 Mibit/s) : les gains observés sont plausibles.
Réserve : gain observé à froid, sans garantie statistique (deux séries
successives, trois métriques corrélées).
Mesures standard (2 passes) : premier affichage `#/jouer` 1 820 / 1 825 ms ;
LCP 1 808 / 1 804 ms ; parcours 6 512 / 6 457 ms ; ouverture carte 640 / 688 ms ;
menu direct 1 522 / 1 683 ms ; 0 erreur console, 0 requête échouée.
Lighthouse t7 : 80 / 81 (TBT 710 / 670 ms, LCP 2,6 / 2,5 s) contre 78/79 à t6
— plat, dans le bruit. Bundle : IDENTIQUE à t6 (JS initial 453 667 o, total
524 433 o, 24 chunks, mêmes noms de chunks — build frais vérifié).
Tests : suite complète **1184/1184** (inchangés — le tour ne crée ni ne
retire de test, il met à jour les dimensions épinglées par le test t6) ;
E2E 3/3. Incident mineur en cours de tour : la mise à jour de la ligne
SOURCES.md a supprimé la phrase « bannière de la carte » que le test
`boucle-t6-banniere` recherche (`sources.includes`) — corrigée en
remettant la phrase exacte (le test ne porte pas sur le fond, mais la
formulation de la documentation doit rester stable).
Revue Codex t7 (5 points) : 1. modification du test **approuvée** —
l'assertion `480` figeait une caractéristique de l'ancien actif, sans
exigence fonctionnelle de conserver cette hauteur ; le plafond de poids
est renforcé — **correction documentaire appliquée** : la validation est
intervenue après la modification du test, avant la fusion (l'ordre strict
« avant toute touche » n'a pas été respecté — consigné honnêtement ici,
cela ne justifie pas d'annuler le tour) ; 2. recadrage centré fondé —
**corrigé** : « ~80 % » → « ~63 % » (bande visible 720×177) dans
`visuels.ts`, le test et SOURCES.md (« quasi identique » → « très proche ») ;
largeur mobile étroite vérifiée (ratio 4:1 couvre 3,75:1 à 4,67:1) ;
3. gain cohérent, précision causale limitée — **appliqué** : gain présenté
comme observé à froid, sans garantie statistique ; « affichée » → « chargée »
(clés du script renommées `herosChargeApresClicMs` /
`banniereChargeeApresClicMs`, en-tête corrigé ; le libellé « affichée » des
docs du tour 6 désignait déjà cette même mesure `img.complete`) ;
4. risque de cache réel fondé (SW : cache à la demande + fraîcheur HTTP 1 h —
un habitué peut conserver l'ancienne variante temporairement, sans
régression visuelle significative) — **noté, non corrigé** : une URL
versionnée serait nécessaire pour une adoption immédiate (hors périmètre
du tour) ; les mesures ne sont pas biaisées (SW bloqués, cache désactivé) ;
5. fusion justifiée après corrections documentaires — prochain tour :
**profiler les longues tâches du TBT**, puis différer les dépendances
coûteuses identifiées (créer des chunks partagés supplémentaires sans
réduire le travail initial ne garantit aucun gain).
**Décision : FUSIONNÉ** (gains transition −237/−239 ms et LCP direct −160 ms,
séparation nette sur les deux métriques de transition ; standard et
Lighthouse plats ; bundle inchangé ; 0 erreur). Tours sans gain
consécutifs : **0**.

### Tour 9 — `autonome/boucle-t9-heros-recadre` (fusionné)

Sujet (même motif que le tour 7, pour le héros) : la variante 720×1279 du
héros est affichée 390×224 (menu) et 390×320 (carte) en `object-cover` —
l'`object-cover` recadrait déjà au centre, donc seule la bande visible
sert. Changement : même fichier `public/visuels/table-sushis-petit.webp`,
recadré à la bande visible de la carte — 720×1279, 95 494 o → **720×590,
51 402 o** (recadrage centré, Pillow, WebP q75, −46 %). Aucun changement
de code (le `<picture>` du tour 4 sert le même fichier) ; seuls changent
l'actif, son commentaire dans `src/lib/visuels.ts`, sa ligne dans
`public/visuels/SOURCES.md`, et le test `tests/boucle-t4-hero.test.ts`
(dimensions 720×1279 → 720×590, plafond < 120 Ko → < 60 Ko,
« ~2× » → « ~4× plus léger »).
Vérification visuelle avant le changement (planche de comparaison des
bandes, lue) : bande menu 720×413 (verre cocktail champignon, ardoise de
sushis, bao buns) et bande carte 720×590 (ajoute la coupe cocktail et le
gobelet ASIAN HOME) — le menu montre approximativement le centre 720×413
de la nouvelle bande à ~390 px, la carte approximativement la bande
entière ; les bandes varient avec la largeur (max-w-md, px-4, hauteurs
fixes — sur écran étroit, l'ancienne image pouvait montrer davantage de
contenu vertical) ; le rendu est très proche, pas strictement identique.
Mesure ponctuelle (`scripts/mesurer-menu-asian-home.mjs`) :
**LCP `#/menu` 2 540 / 2 492 ms → 2 324 / 2 252 ms (moyenne 2 516 →
2 288 ms, −228 ms, 2 passes sur 2)** — le héros WebP finit à 2 296 /
2 226 ms (était 2 510 / 2 454 ms), 51 702 o transférés (51 402 o sur
disque : `transferSize` ajoute forfaitairement 300 o au corps encodé —
précision Codex t9, point 3) ; les 44 092 o économisés valent ~220 ms à
1,6 Mbit/s : le gain observé est plausible, encore indicatif (2 passes).
LCP `#/jouer` (en même temps) : 1 684 / 1 704 ms → 1 648 / 1 672 ms
(plat, attendu). Mesures standard (2 passes) : premier affichage `#/jouer`
1 894 / 1 882 ms ; LCP 1 872 / 1 832 ms ; parcours 6 853 / 6 696 ms ;
ouverture carte 607 / 619 ms ; menu direct 1 703 / 1 717 ms ; 0 erreur
console, 0 requête échouée. Lighthouse t9 : 78 / 86 (TBT 780 / 490 ms,
LCP 2,6 / 2,2 s) contre 80/81 à t7 — plat, dans le bruit (le 86 est la
meilleure passe observée depuis t0, TBT 490 ms). Bundle : IDENTIQUE à t6
(JS initial 453 667 o, total 524 433 o, 24 chunks, mêmes noms de chunks —
build frais vérifié).
Tests : suite complète **1184/1184** (inchangés — le tour ne crée ni ne
retire de test, il met à jour les dimensions épinglées par le test t4) ;
E2E 3/3.
Revue Codex t9 (5 points) : 1. modification du test **approuvée** —
l'assertion 1279 décrivait l'ancien actif, pas une exigence fonctionnelle ;
le plafond est renforcé — **correction rédactionnelle appliquée** : le
commentaire disait « servi en premier via menu » (phrase coupée par
l'édition) — rétabli « via `<picture>` sur le menu » ; 2. recadrage à
720×590 fondé à la largeur de référence, formulation trop absolue —
**corrigé** : « bande entière / identique » → « approximativement, à cette
largeur » dans `visuels.ts`, SOURCES.md et le test (le choix 720×413
obligerait la carte à agrandir davantage et couper les côtés) ; 3. gain
cohérent, encore indicatif — **noté** : +300 o de `transferSize` normaux
(forfaitaires, pas des en-têtes mesurés) ; 4. conserver l'URL acceptable —
**noté** : le SW sert le cache puis actualise ; la fraîcheur HTTP d'1 h ne
borne pas la persistance dans le cache SW (notamment hors ligne) — ce
délai ne compromet que l'arrivée du gain de poids ; aucun versionnement
nécessaire pour ce tour ; 5. fusion favorable — ensuite : DA si les
irritants sont identifiés, TBT si une tâche précise devient attribuable ;
les photos paresseuses sont un levier secondaire de transfert au
défilement (`loading="lazy"` ne garantit toutefois pas qu'elles attendent
ce défilement) ; aucun motif pour relancer une optimisation diffuse du
tour 8.
Incident de documentation en cours de tour : un edit de SCORES.md avec
un `old_text` ambigu (« 0 erreur console, 0 requête échouée. ») a remplacé
la PREMIÈRE occurrence (paragraphe P2-Q2, ligne 48) au lieu de celle du
tour 7 — la sous-section t9 s'est retrouvée insérée au milieu du
paragraphe P2-Q2. Corrigé en retirant le bloc mal placé et en le
réinsérant au bon endroit (ancre unique : « une URL versionnée serait
nécessaire pour une adoption immédiate »). Leçon (à ajouter à la
discipline d'édition) : ne jamais utiliser un `old_text` qui apparaît
plusieurs fois — toujours un contexte unique d'au moins 2 lignes.
**Décision : FUSIONNÉ** (gain LCP menu −228 ms moyen, 2/2 passes ; `#/jouer`
plat comme attendu ; standard et Lighthouse plats ; bundle inchangé ;
0 erreur). Tours sans gain consécutifs : **0**.

### Tour 10 — `autonome/boucle-t10-photos-paresseuses` (fusionné)

Sujet : les 6 photos d'ambiance / de catégories (`loading="lazy"`, sous le
pli) sont encore des JPEG lourds (~350 Ko au total). Changement : 6 variantes
WebP recadrées approximativement au ratio d'affichage (Pillow, q75) servies
en premier via `<picture className="block">`, le JPEG restant le repli —
carte : `interieur.jpg` (675×900, 131 Ko) → `interieur-petit.webp`
(675×443, 36 914 o), `interieur-salon.jpg` (320×240, 22 Ko) →
`interieur-salon-petit.webp` (320×157, 5 560 o) ; menu (`photoCategorie`,
interface étendue avec `srcPetit`) : `sushis-ardoise.jpg` (614×408, 30 Ko)
→ 614×201, 11 090 o ; `cocktails.jpg` (640×1136, 69 Ko) → 640×210,
12 334 o ; `menu-plat-riz.jpg` (424×408, 39 Ko) → 424×139, 6 586 o ;
`menu-mango-sticky-rice.jpg` (411×412, 61 Ko) → 411×134, 12 054 o.
Total ~350 Ko → ~83 Ko (**−267 Ko**). 6 entrées `VISUELS` ajoutées ;
documenté dans `public/visuels/SOURCES.md` ; JPEG intacts partout.
Mesure ponctuelle (nouveau script versionné
`scripts/mesurer-photos-paresseuses.mjs`, commerce « Asian Home Paris »,
Pixel 7, Slow 4G + CPU ×4, SW bloqués, cache désactivé, navigateur relancé
par passe ; carte : parcours complet puis défilement ; menu : chargement
direct puis défilement) : durées de téléchargement du journal (fin − debut,
indépendantes) — **avant** (ABAB, script corrigé) : interieur 1 116 /
1 156 ms, salon 549 / 569 ms, sushis-ardoise 585 / 560 ms, cocktails
980 / 975 ms, menu-plat-riz 563 / 590 ms, menu-mango 918 / 875 ms ;
**après** (4 passes, 2 runs) : interieur-petit 631 / 629 ms puis 417 /
617 ms (moyenne 574 ms, **−562 ms**), salon-petit 293 / 292 ms puis 291 /
302 ms (moyenne 295 ms, **−264 ms**), sushis-ardoise-petit 280 / 252 ms
puis 249 / 283 ms (moyenne 266 ms, **−307 ms**), cocktails-petit 368 /
384 ms puis 381 / 391 ms (moyenne 381 ms, **−597 ms**),
menu-plat-riz-petit 412 / 362 ms puis 363 / 364 ms (moyenne 375 ms,
**−202 ms**), menu-mango-petit 355 / 384 ms puis 374 / 361 ms (moyenne
369 ms, **−528 ms**) ; `currentSrc` = les 6 variantes WebP ; état avant
scroll vérifié (`currentSrc` vide, images non complètes — le lazy loading
attend bien le défilement). Les délais scroll → chargé (cumulatifs, ceux
du parcours) baissent aussi : carte ~1 150 → ~620 ms, menu ~1 100–1 900 →
~800–1 500 ms. Le JPEG `menu-mango-sticky-rice.jpg` (61 660 o) se
télécharge TOUJOURS (645–718 ms) — c'est la photo du plat « Mango Stick »
(`src/data/menu-reel.ts:285`, vignette 64×64), pas la photo de catégorie :
candidat t11 (vignette carrée WebP via `photoVignette`, la photo complète
restant pour le détail).
Mesures standard (2 passes) : premier affichage `#/jouer` 1 874 / 1 888 ms ;
LCP 1 812 / 1 868 ms ; parcours 6 553 / 6 574 ms ; ouverture carte 680 / 663 ms ;
menu direct 1 519 / 1 967 ms ; 0 erreur console, 0 requête échouée.
Lighthouse t10 : 78 / 78 (TBT 890 / 850 ms, LCP 2,3 / 2,5 s) contre 78/86 à t9
— plat. Bundle : JS initial 453 667 → 454 357 o (+690 o, +0,15 % — 6 entrées
`VISUELS` + `<picture>` + `srcPetit`), CSS 70 766 o inchangé, total
524 433 → 525 123 o, 24 chunks.
Tests : suite complète **1200/1200** (1184 + 10 `tests/boucle-t10-photos-paresseuses.test.ts`
+ 6 tests auto : `tests/visuels.test.ts` génère un test par entrée `VISUELS`),
75 fichiers ; E2E 3/3.
Revue Codex t10 (5 points) : 1. les trois adaptations de tests **validées** —
les fichiers valides de 5 560 et 6 586 o réfutent le seuil universel de
10 000 o ; `srcPetit` dans les `deepEqual` vérifie le nouveau contrat ;
exclure les variantes du catalogue des 18 photos PDF est cohérent —
**corrigé** : l'affirmation « 3 000 o + en-têtes garantissent l'absence de
troncature » est retirée de `BOUCLE.md` (remplacée par le décodage intégral
Pillow, 6/6 OK, + le rendu navigateur) ; le filtre exclut tout futur
`*-petit.webp` — **noté** : l'idéal serait d'exclure les variantes
déclarées explicitement (le suffixe `-petit.webp` est la convention
déclarée de toutes les variantes, conservée) ; 2. recadrages fondés,
mise en page préservée — **corrigé** : les ratios documentés ne
correspondaient pas exactement aux dimensions CSS réelles (racine 17 px,
marges, padding `.carte`) — « affichée ~390×256 » → « h-64, ~390 px de
large » (et idem pour les 5 autres) ; cadrages à vérifier aux largeurs
extrêmes (`object-cover` peut encore couper les côtés) — **noté pour le
rapport final** ; 3. gain valable, preuve temporelle partiellement fondée —
**corrigé avant confirmation** : timeouts non masqués, durées indépendantes
du journal + `currentSrc` + état avant scroll, ABAB (stash/rebuild) avec
le script corrigé — les chiffres rapportés sont les durées de
téléchargement, pas les délais cumulatifs du parcours ; 4. Mango Stick =
meilleur candidat t11 — **retenu** (`photoVignette`, déjà utilisée par le
composant) ; les JPEG loc-lac et nouilles (non téléchargés) n'ont aucune
priorité ; 5. fusion favorable sous réserve des corrections ci-dessus —
« tous les visuels optimisés » **non revendiqué** (Mango Stick subsiste) ;
ensuite : DA, puis TBT seulement avec un levier identifié.
Incident de documentation en cours de tour : la sous-section Parcours t10
s'est insérée après t4 au lieu d'après t9 (un `old_text` ambigu — le
paragraphe de clôture « 6,7–6,9 s » apparaît deux fois). Corrigée en
déplaçant le bloc au bon endroit par script (ancre : fin de la section t9).
**Décision : FUSIONNÉ** (gains de téléchargement −202 à −597 ms sur les 6
photos, 2/2 passes avant et 4/4 après ; standard et Lighthouse plats ;
bundle +0,15 % ; 0 erreur). Tours sans gain consécutifs : **0**.

### Tour 11 — `autonome/boucle-t11-vignette-mango` (annulé — décision produit, tests épinglés non faux)

Sujet (candidat noté par la revue Codex t10, point 4) : la photo du plat
« Mango Stick » (`menu-mango-sticky-rice.jpg`, 61 360 o) est affichée en
vignette 64×64 dans la liste du menu (`MenuPublic.tsx:256-257`,
`p.photoVignette ?? p.photo`) — la mesure ponctuelle du tour 10 montre
qu'elle se télécharge en 645–718 ms sur le défilement du menu (4 passes),
en plus de sa variante de catégorie (12 054 o). La vignette carrée
192×192 (WebP q75, 8 034 o, Pillow, recadrage centré — comme les
vignettes PDF ≤ 192 px) a été générée et vérifiée (décodage intégral OK),
mais NON commitée : le tour est annulé avant tout changement.
Pourquoi : deux tests épinglent la règle P1-M3 — `tests/photos-menu.test.ts:102`
(« Loc Lac et Mango Stick gardent leur photo existante, sans vignette » :
`de('Mango Stick').photoVignette === undefined`) et la règle de nommage
(« aucune vignette sans photo, et une vignette n'est jamais celle d'un
autre plat » : `p.photoVignette === p.photo.replace(/\.webp$/, '-vignette.webp')`
— la règle suppose des photos `.webp`, la photo du Mango Stick est un
`.jpg`). Ces tests ne sont pas faux : ils consignent une décision
délibérée (vignettes réservées aux photos extraites du PDF, P1-M3).
Les étendre aux photos de galerie serait un changement de règle, pas une
correction — il relève d'une décision utilisateur/coordinateur, pas de la
boucle (même motif que la coquille statique du tour 3, renvoyée au
`RAPPORT.md`). La variante de contournement (dériver la vignette dans le
composant sans toucher aux données) a été écartée : elle contournerait
la règle sans la changer, et exposerait un risque 404 sans filet.
Mesure (tour 10, script `mesurer-photos-paresseuses.mjs`, 4 passes) :
la photo du plat se télécharge en 645–718 ms (moyenne ~659 ms) sur le
défilement du menu ; la vignette (8 034 o) la remplacerait dans la liste,
la photo complète restant pour le détail (`MenuPublic.tsx:282`, `p.photo`).
Gain estimé : ~53 Ko et ~550 ms de tuyau sur le défilement du menu.
**Décision : ANNULÉ** — aucun changement tenté. Tours sans gain
consécutifs : **1**. Branche supprimée sans fusion ; seul `BOUCLE.md`
fusionné (doc).

### Tour 12 — `autonome/boucle-t12-regard-neuf` (annulé — leviers épuisés, regard neuf)

Sujet (regard neuf, dû à t10, rattrapé — § dédié ci-dessus) : après 11
tours, relecture critique des hypothèses et des leviers restants. Bilan
chiffré t0 → t10 : JS initial 481 332 → 454 357 o (−5,6 %) ; premier
affichage 2 261/2 197 → 1 874/1 888 ms (cible < 2 s atteinte) ; LCP
`#/jouer` 2 248/2 148 → 1 812/1 868 ms ; parcours 6 664/7 343 → 6 553/
6 574 ms (cible < 30 s atteinte, étapes scriptées) ; Lighthouse 77/81 →
78/78 (meilleure passe 86) — cible ≥ 95 non atteinte ; LCP menu
3 428/3 376 → 2 324/2 252 ms (−1 080 ms) ; LCP carte ~3 002 ms (direct) ;
photos paresseuses −267 Ko ; DA 8,0/10 (cible ≥ 9 non atteinte) ; tests
1163 → 1200/1200, E2E 3/3. Leviers restants examinés : DA (assombrir les
écrans commerçant — décision produit, score subjectif par captures,
risque de casser des tests de fonds clairs) ; vignettes P1-M3 (tour 11,
annulé — décision produit) ; TBT (diffus, tour 8) ; photos
`menu-loc-lac.jpg` / `menu-nouilles-crevettes.jpg` (non téléchargées,
aucune priorité) ; photos de plats du PDF (déjà à la bonne taille).
Conclusion : aucun levier mesurable et sûr ne reste — la boucle s'arrête
ici sur le constat du regard neuf (la condition formelle des 3 tours
consécutifs sans gain n'est pas atteinte : 2 après t12 — lancer un tour
13 sans levier identifié serait mécanique). Les deux décisions produit
sont proposées dans `RAPPORT.md`.
**Décision : ANNULÉ** — aucun changement tenté. Tours sans gain
consécutifs : **2** (t11, t12). Branche supprimée sans fusion ; seul
`BOUCLE.md` fusionné (doc). La boucle s'arrête ici ; le `RAPPORT.md`
final suit.

### Tour 8 — `autonome/boucle-t8-tbt-longues-taches` (annulé — aucun levier au-dessus du bruit)

Sujet (recommandation Codex t7, point 5) : profiler les longues tâches du
TBT (Lighthouse t7 passe 1 : 710 ms, `mainthread-work-breakdown` 2,3 s dont
styleLayout 898 ms, scriptEvaluation 673 ms, other 486 ms ; 13 longues
tâches, plus grosse 346 ms à 995 ms). Investigation sans changement de code
— trace Chrome (`node_modules/.cache/profil-t8/tracer.mjs`, API Playwright
`startTracing`, catégories `devtools.timeline` + `disabled-by-default-
devtools.timeline` + `blink.user_timing` + `disabled-by-default-v8.cpu_profiler`,
commerce générique, Pixel 7, Slow 4G + CPU ×4, SW bloqués, cache désactivé)
+ profil CPU :
- Timeline : RunTask 665 ms (3 311 événements), Layout 92 ms (4 événements,
  plus gros 73 ms à 1 580 ms — le rendu post-API), UpdateLayoutTree 33 ms
  (14 événements), Paint 8 ms, ParseHTML 5 ms, ParseAuthorStyleSheet 5 ms —
  **travail total du thread principal ~800 ms** ; plus grosse tâche unique
  167 ms à 1 127 ms (montage React) ; seconde 94 ms à 1 567 ms (rendu
  post-API) ; FunctionCall `te` (minifié, React) 41 ms × 2.
- Profil CPU (15 820 échantillons, 229 fonctions) : **89,5 % `(idle)`**
  (attente réseau), `(program)` 5,2 %, puis fonctions diffuses — top 1,9 %
  (anonyme, `ui-*.js`), 0,3 %, 0,2 %, … ; aucune fonction au-dessus de 2 %.
- Écart avec Lighthouse : le « styleLayout 898 ms » du breakdown est un
  artefact du throttling SIMULÉ de Lighthouse (durées multipliées) — le
  coût réel mesuré en trace CDP throttlée est Layout 92 ms + UpdateLayoutTree
  33 ms ≈ 125 ms. Le TBT Lighthouse (710 ms) est lui aussi simulé ; le TBT
  réel de la trace est ~350–400 ms (tâches > 50 ms : 167 + 94 + 73 + …).
Leviers examinés et écartés (détail § « Leviers examinés et ÉCARTÉS ») :
découpage des dépendances partagées en chunks supplémentaires (ne réduit pas
le travail initial — Codex t7) ; sortie de Caisse/CartePublique du bundle
initial (déjà écartée, P2-Q2 — les 61 KiB `unused-javascript` sont le code
épinglé) ; réduction de la tâche de montage (167 ms, diffuse, pas de
hotspot) ; réduction du layout post-API (73 ms pour 117 nœuds, ~18 ms non
throttlé — normal). Aucun changement tenté : le TBT est (a) dominé par
l'attente réseau (89,5 % idle), (b) diffus (top fonction 1,9 %), (c) fait
de tâches inhérentes au rendu initial.
**Décision : ANNULÉ** — aucun changement tenté. Tours sans gain
consécutifs : **1**. Branche supprimée sans fusion ; seul `BOUCLE.md`
fusionné (doc). Scripts de diagnostic conservés :
`node_modules/.cache/profil-t8/tracer.mjs`, `trace.json`, `trace-cpu.json`.

### Roue v2 R5+R8 — son, couleur du commerce, roue premium (12/11/2026) — écart à la cible DA

Note DA de l'écran de jeu : 9/10 → **9,5/10** (captures Pixel 7 avant/après, `SCORES.md`
§ « écran de jeu après roue v2 R5+R8 »). Cible 10/10 (mandat utilisateur 12/11 09h44)
**non atteinte** — ce qui manque, à traiter en PHASE 3 (polish visuel) :
1. Libellés de la moitié gauche de la roue à l'envers au repos (orientation radiale
   unique) : retourner le texte des secteurs dont le milieu est entre 180° et 360° —
   à arbitrer, la roue tourne et l'orientation au repos dépend de l'arrêt précédent.
2. Couleur de commerce : la roue et les pastilles de la légende la prennent, mais le
   cadre (`ring-magenta-400/30`, ligne épinglée par `roue-p0-u2`/`theme`), le titre
   « À gagner » et l'anneau des pastilles restent magenta.
3. Bouton « 🎡 Tourner la roue » : émoji multicolore hors registre noir + magenta
   (libellé épinglé par plusieurs tests et traduit — à changer avec eux).
4. Libellés abrégés sur la roue (« Dessert… », « 10 points… ») : règle des 12
   caractères voulue (légende complète dessous), mais visible.
5. Budget : JS initial à 76 o du plafond P2-Q2 (481300 / 481376 o) — tout polish qui
   ajoute du JS au premier affichage de #/jouer impose d'abord un découpage.

### Roue v2 R-t1 — polish visuel de la roue (12/11/2026, branche `boucle/roue-v2`)

**Hypothèse.** Les quatre défauts visibles listés ci-dessus (libellés de gauche à l'envers,
cadre/légende magenta sur une couleur perso, émoji 🎡, un détail d'harmonie) sont ce qui
sépare l'écran de jeu (9,5/10) d'un 10/10. Contrainte : JS initial au plafond (481373 /
481376 o après D2) → CSS d'abord.

**Changements.**
1. *Libellés de gauche* : le libellé d'un secteur dont le milieu est > 180° tourne de +90°
   au lieu de −90° (`Roue.tsx`), soit un retournement sur l'axe du secteur, autour de son
   centre. Géométrie, correspondance secteur/résultat, police et règle des 12 caractères
   inchangées. Technique SVG (attribut `transform`) et non CSS : une rotation CSS sur un
   `<text>` s'applique *avant* l'attribut, autour de l'origine de la roue — elle aurait
   envoyé le libellé dans le secteur opposé.
2. *Couleur du commerce* : la ligne du cadre (`hero-sombre … ring-magenta-400/30`) et le
   conteneur de `Cadre` sont épinglés à l'identique (`roue-p0-u2`, `theme`) et les clés de
   `teintesRoue` aussi (`roue-premium-r58`) ; un enveloppeur `style` dans `Jouer.tsx` coûtait
   +71 o. Retenu : la racine de `LegendeRoue` porte `styleLegende(couleur)` (teintes de la
   roue + `--roue-texte`) ; en CSS, son titre et l'anneau des pastilles lisent ces variables,
   et sous `@supports selector(:has(a))` le cadre devient positionné, perd son fond et son
   anneau, et la légende le repeint par `::before` (même dégradé nocturne, halo, filet et
   fond bas à la teinte du commerce) + `::after` pour l'anneau du bouton son allumé. Sans
   `:has()`, rendu d'avant. `--roue-texte` = teinte claire, éclaircie de moitié si < 4,5:1 sur
   nuit 900 (le test a d'abord échoué : `#000000` donnait 2,73:1 avec la teinte claire seule).
   Par défaut : magenta 400, inchangé.
3. *Émoji 🎡* : le libellé `t('🎡 Tourner la roue{prenom} !')` est épinglé (entree-qr-p1-c1,
   identite-accessibilite-p2-q1) et l'E2E le cherche par son nom → texte et nom accessible
   inchangés. Première tentative, une police d'un glyphe (U+1F3A1, `unicode-range`) : bloquée
   par `securite-s4`, qui interdit tout `@font-face` dans `src/` ; pas contournée par un
   fichier dans `public/`. Retenu : les trois boutons « Tourner » (`bouton w-full py-4
   text-lg`, uniquement dans Jouer.tsx) passent en `display: block` (requis par
   `::first-letter`), et `:enabled::first-letter` (seul l'état actif porte l'émoji) a une taille
   de police nulle et dessine dans sa boîte un signe de roue à la couleur du texte : anneau
   (bordure), trois diamètres (six rayons), moyeu.
4. *Détail relevé sur les captures avant* : le titre « À gagner » de la légende était corail
   (`magenta-300` #ff4d6d), seule teinte hors palette de la roue à l'écran ; il prend
   désormais la teinte claire de la roue (magenta 400 par défaut, 5,49:1 sur le noir).
   NB : le brief citait « À gagner aujourd'hui » ; sur les captures avant, ce titre (carte
   sous le bouton) est blanc, pas magenta — le titre magenta était celui de la légende.

**Budget.** Les classes utilitaires du pointeur (`absolute top-0 left-1/2 …`), du titre et
des pastilles de la légende sont passées en `@apply` dans index.css : −200 o de JS, ce qui
paie les points 1 et 2. JS initial 481373 → **481283 o** (plafond 481376, marge 93 o) ; CSS
78932 → 82135 o.

**Note DA écran de jeu : 9,5 → 9,7/10** (SCORES.md, table de fin), point par point :
+ libellés de gauche lisibles au repos (captures `*-1-repos`, `*-0-page`) ;
+ sur `#3b2d8f`, plus aucun magenta dans le cadre de la roue (filet, halo, titre, anneaux) ;
+ signe de roue blanc monochrome à la place de l'émoji multicolore ;
+ titre de légende harmonisé avec la roue en mode magenta.
Pas 10, ce qui reste visible : (a) sur une couleur de commerce, le bouton « Tourner » reste
magenta, en dehors du cadre et donc des variables (le teinter exige du JS initial ou un
blanc-sur-teinte non garanti ≥ 4,5:1 pour toute couleur) ; (b) libellés abrégés (« Dessert… »,
« 10 points… ») par la règle des 12 caractères ; (c) les numéros de secteur (roues > 8 lots)
ne sont pas retournés en bas de roue ; (d) l'en-tête du jeu (nom, accroche) reste magenta
sur une couleur perso (hors brief). Après rotation, l'orientation dépend de l'arrêt : le
retournement vaut pour la roue au repos.

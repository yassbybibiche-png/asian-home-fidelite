# Boucle animations — Découverte (#/bienvenue, #/menu)

_Ordre de l'utilisateur du 13/11 21:11 (« Mets Claude Code à fond sur les animations, en boucle »), complété à 21:36 : « Inspire-toi des meilleurs concurrents. » Surfaces : accueil `#/bienvenue` et menu mode Découverte uniquement — Commande et Cuisine intacts. Portes dures à chaque cycle : tests complets verts, FCP menu ≤ ~800 ms, LCP ≤ 2,5 s, CLS 0 (protocole SCORES.md), bundle initial sous 484 422 o, `prefers-reduced-motion` tout coupé, aucune donnée/prix/règle touchée. Vidéo de défilement avant/après à chaque cycle (`captures-animations/`). Critique aux 10 questions dans `EXPERIENCE-JOURNAL.md` (§8). Arrêt : 2 cycles consécutifs sans gain visuel net, précédés d'une passe d'inspiration fraîche._

## Étape 0 — État actuel en vidéo

`captures-animations/avant.webm` (~45 s, Pixel 7 simulé, build courant servi en local par le serveur E2E) : accueil puis menu en défilement lent programmé. Constat à l'image : l'accueil vit (ken burns, pastilles flottantes, marquees), le menu est beau mais **son ambiance ne change jamais** — fond noir uniforme du premier au dernier plat, titres de catégorie statiques, aucun univers par famille de plats. C'est l'écart n°1 face à la référence.

## Passe d'inspiration concurrents (13/11 au soir, avant le cycle 1)

_Méthode et limite : pages publiques consultées par extraction de texte et documentation produit des éditeurs (13/11) ; le mouvement lui-même n'est pas observable par extraction — même limite que l'analyse Ciao du cycle Experience. Principes uniquement : aucune copie de code, de graphisme ou de marque._

| Référence | Signatures observables | Transposable chez Asian Home | Non transposable |
|---|---|---|---|
| **Ciao Kombucha** (référence de l'utilisateur) | Un univers par saveur : couleur dominante + énorme visuel produit répété, sections plein écran, typographie immense, mouvement permanent | **Univers par catégorie** : l'ambiance du menu change par famille de plats ; visuel-star plein cadre ; typo géante | Son poids (assets vidéo, WebGL) ; son identité (la nôtre : noir + magenta, photos réelles) |
| **Drimify** | Roue 3D « cinématique » : lancement au doigt (swipe/drag) avec inertie, angles de caméra, séquences de gain/perte animées, écrans intermédiaires | Le sens du **geste** et de la **révélation orchestrée** : entrées de sections mises en scène, enchaînements plutôt que changements secs | La 3D temps réel (coût batterie/perf sur mobile d'entrée de gamme) |
| **Menu.AI / CartaNova / MegaComanda** (menus « vivants ») | Une animation ou une vidéo **par plat** ; cartes animées (vapeur, zoom au toucher) ; le plat est le héros de l'écran | Micro-vie propre aux plats photographiés (respiration/zoom lent différencié), plat-star mis en avant | Vidéos IA par plat : nous n'avons que 11 photos réelles et aucune vidéo — et aucune image générée ne sera présentée comme un plat réel |
| **Socialshaker** | Campagnes habillées par thème/saison, page entière aux couleurs de l'opération | Habillage d'ambiance par section (dégradés d'univers) plutôt que page monochrome | Les thèmes saisonniers jetables (calendrier de l'Avent…) : hors identité permanente du restaurant |
| **Hey Pongo** | Site en actes modulaires, chiffres mis en avant, marqueurs visuels forts | Actes numérotés dans le menu (01 · Entrées, 02 · Plats…) ; pastilles/prix qui « pop » à l'apparition | Leur charte (jaune/noir) et le propos B2B |
| **Fideliz** | Rail horizontal d'écrans réels numérotés (« faites glisser »), comparaisons avant/après | Rail photos à défilement **inertiel** et vivant (le nôtre existe, il est sage) | Le propos (app opticien) |
| **SpinLocal / SpinDine** | Démo jouable intégrée à la page, parcours en 4 étapes numérotées, code qui se révèle au moment de l'usage | Étapes de lecture numérotées ; sens du « moment de révélation » | La démo de roue (notre jeu est une vraie page, pas une démo) |
| **Qualifio** | Roue de simulation décorative dès l'écran d'accueil, écrans de sortie travaillés | Une présence de la roue en mouvement d'ambiance (accueil) | Les campagnes à formulaire |
| **Zerosix / Obypay / KazUp** | Fidélité d'abord, jeu en module ; présentations sobres, peu de signatures d'animation publiques | — (contre-exemple : la sobriété seule ne crée pas l'envie que l'utilisateur demande) | — |

### Manques relevés chez nous, par ordre de visibilité

1. **Aucune transition d'univers par catégorie** (Ciao) — le fond/l'ambiance du menu ne change jamais. → **Cycle 1**
2. Typographie des titres de catégorie statique — pas de typo cinétique géante (Ciao/Drimify). → **Cycle 2**
3. Le rail « En photos » n'a ni inertie ni vie propre (Fideliz).
4. Pas de plat-star plein cadre qui suit le défilement (Ciao/Menu vivant).
5. Aucune transition entre pages (changement de route sec).

## Cycles

### Cycle 1 — « Univers par catégorie » (menu Découverte) — référence : Ciao Kombucha

L'ambiance du menu change avec la famille de plats affichée : deux calques fixes derrière le contenu se croisent en opacité (900 ms), 6 univers sombres (magenta de base, braise, vert nuit, bleu encre, ambre, prune) attribués par rang de catégorie — stable pour une catégorie, y compris via les onglets filtrés ; l'en-tête de la catégorie active se pose (scale 1,04 → 1) et sa photo zoome très lentement (20 s) tant qu'elle est active. Mode Commande intact (autre page). Branche `anim/cycle1-univers` (`749b60a`), 11 tests ajoutés, suite **1721/1721** (115 fichiers).

Mesures (protocole SCORES.md, avant/après alternés puis confirmées au calme) : bundle initial **inchangé** 484 259 o (CSS +1 969 o) ; FCP menu 692–704 ms ; LCP 2 368–2 524 ms au calme — élément LCP = photo du héros, intacte : niveau de la baseline pré-boucle (déjà frontalière à ~2,5 s selon la charge), **aucune régression du cycle** ; CLS **0**. Mouvement réduit : tout coupé, testé et vérifié en Chromium.

Vidéos : `captures-animations/avant.webm` → `captures-animations/cycle1.webm`. **Verdict de la critique (détail au journal §8) : gain réel mais modéré** — la teinte fond visiblement d'une famille à l'autre en défilement, mais les cartes couvrent l'écran et les halos restent aux bords ; DA menu Découverte 8,6 → **8,9/10**. Le manque n°1 devient l'intensité : titres de catégorie encore modestes et pas de plat-star plein cadre → cycle 2.

### Cycle 2 — « Typographie cinétique des moments » (menu Découverte) — références : Ciao Kombucha (typo immense), Drimify (révélation orchestrée)

Les titres des en-têtes « moment » deviennent géants et entrent en scène : taille fluide `clamp(2,6 rem, 13 vw, 4,6 rem)` plafonnée par le plus long mot (`--lettres` + unité `cqw`, aucun mot tronqué ni débordant), révélation **mot à mot** depuis un masque (`translateY(130 %) → 0`, 0,7 s, 70 ms d'écart) par le mécanisme de révélation existant (aucun nouvel observateur, jouée une fois par en-tête). Derrière le titre, un **mot fantôme** géant en creux (contour blanc 38 %) dérive lentement (20 s, transform seul) — il reprend la ligne `titre-logo` épinglée par les tests, changée de rôle sans changer de texte. En-têtes sans photo : même révélation mot à mot à taille inchangée, en calque posé sur le h2 (transparent via `:has()`, repli propre sans `:has()`). Cadre photo inchangé (h-56). Branche `anim/cycle2-typo` (`278e0d9`), logique pure dans `src/lib/titreCinetique.ts`, 15 tests ajoutés, suite **1736/1736** (116 fichiers, revérifiée par le coordinateur, typechecks front + serveur, 2 mutations de contre-épreuve détectées).

Mesures (protocole SCORES.md, A/B même fenêtre) : bundle initial **inchangé** 484 259 o (plafond 484 422) ; FCP menu 692–700 → 712–716 ms et LCP 2412–2432 → 2440–2448 ms, avec le témoin `#/jouer` (intouché) dérivant du même ordre dans la même fenêtre — écart attribué au bruit de charge, pas de régression ; CLS **0** (mouvement normal et réduit) ; mouvement réduit : titres affichés d'emblée, fantôme immobile, vérifié en Chromium ; aucun débordement (page à 412 px, pires cas « Boissons », « Desserts », « Maki Neige x6 » vérifiés en capture).

Vidéos : `captures-animations/cycle1.webm` → `captures-animations/cycle2.webm`. **Verdict de la critique (détail au journal §8) : gain net, supérieur au cycle 1** — le manque n°1 (l'intensité) est traité sur les moments photo ; DA menu Découverte 8,9 → **9,2/10**. Restes : le cadre reste à 224 px (pas le plein cadre de Ciao) et il n'y a toujours pas de plat-star → cycle 3 : moment plat-star plein cadre qui vit au scroll (photo réelle uniquement).

### Cycle 3 — « Plat-star plein cadre » (menu Découverte) — référence : Ciao Kombucha (le produit est l'univers)

Chaque catégorie éligible reçoit un bloc de 62 vh entre son en-tête et sa liste : la photo du plat lui-même en plein cadre (parallaxe + zoom lent, « plongée » `scale` 1,14 → 1 à la révélation), nom en titre géant révélé mot à mot, description, prix ; le bloc entier est un bouton vers la fiche du plat. Choix pur dans `src/lib/platStar.ts` (signature photographiée d'abord). **Arbitrage du cycle, décidé en relecture sur captures** : un plein cadre flou détruit l'effet premium — un seuil de résolution écarte les photos dont l'agrandissement au cadre dépasse ×1,5 (Dynamite ×2,31, Poke Bowl ×3,94, photos PDF ×2,3 écartées ; photo inconnue éligible par défaut ; table vérifiée par un test qui relit les fichiers). Sur la carte réelle : **Loc Lac** (Plats thaï) et **Mango Stick** (Desserts) gardent leur star ; Entrées thaï et Poke Bowl restent sans bloc (le doublon Poke Bowl disparaît au passage). Branche `anim/cycle3-plat-star` (`1ad8c2f` + ajustement `43bd732`), 23 tests dans `tests/animations-cycle3.test.ts`, suite **1759/1759** (117 fichiers, revérifiée par le coordinateur, typecheck front, 2 mutations de contre-épreuve détectées).

Mesures (protocole SCORES.md, A/B même fenêtre) : bundle initial **inchangé** 484 259 o ; FCP menu 712–716 ms, LCP 2500–2512 ms (bruit, témoin `#/jouer` dérivant autant ; l'élément LCP reste la photo d'en-tête, les stars chargent au défilement) ; CLS **0**.

Vidéos : `captures-animations/cycle2.webm` → `captures-animations/cycle3.webm`. **Verdict de la critique (détail au journal §8) : gain net, le moment le plus fort de la boucle là où il s'applique** ; DA menu Découverte 9,2 → **9,4/10**. Plafond honnête : la couverture (2/16 catégories) est limitée par la résolution des photos sources (9/11 à ~340 px), pas par le design — des photos plus grandes du restaurant débloqueraient 9 stars sans code. Suite → cycle 4 : le rail « En photos » de l'accueil, encore sec (inertie + vie, référence Fideliz).

### Cycle 4 — « Rail En photos vivant » (menu Découverte) — référence : Fideliz (rail photos vivant et inertiel)

La tuile la plus proche du centre du rail devient le point focal : échelle jusqu'à 1,05 et photo à pleine luminosité, atténuation progressive des voisines (luminosité jusqu'à 0,82 à 1,5 tuile, courbe cosinus) — le focus suit le défilement automatique existant comme le défilement manuel. Pilote rAF dans `src/lib/railVivant.ts` (mathématique pure testée) : actif seulement rail visible, aucune écriture si rien n'a bougé, `scrollLeft` jamais touché ; l'échelle vit sur un conteneur interne de la tuile pour composer avec l'enfoncement tactile du bouton. Mouvement réduit : pilote inactif. Branche `anim/cycle4-rail` (`ef27792`), 12 tests dans `tests/animations-cycle4.test.ts` (dont 4 auto-mutations du pilote attrapées pendant le développement + 1 mutation du coordinateur), suite **1771/1771** (118 fichiers, revérifiée par le coordinateur, typecheck front).

Mesures (protocole SCORES.md, A/B alterné même fenêtre) : bundle initial **inchangé** 484 259 o ; FCP/LCP dans le bruit des deux côtés (témoin `#/jouer` équivalent) ; CLS **0** (la hauteur du rail inclut dès le premier rendu le rembourrage qui absorbe l'échelle).

Vidéos : `captures-animations/cycle3.webm` → `captures-animations/cycle4.webm`. **Verdict de la critique (détail au journal §8) : gain net mais le plus discret de la boucle** — un projecteur doux, lisible surtout en mouvement ; amplitude volontairement retenue pour ne pas mettre les photos de plats en pénombre ; DA menu Découverte 9,4 → **9,5/10**. Suite → cycle 5 : les transitions entre pages (dernier manque du catalogue : accueil ↔ menu en coupe sèche), jamais au premier chargement.

### Cycle 5 — « Transitions de navigation » (Découverte) — références : Ciao, Drimify (navigation fluide)

Les navigations internes accueil ↔ menu entrent en scène (montée 14 px + fondu, 0,28 s ; changement d'onglet du menu : même entrée sur la liste en 0,18 s, jamais pendant la recherche). Mécanisme à preuve structurelle : le routeur pose la classe `navigue` sur `<html>` au premier `hashchange` et le CSS n'anime que sous cette classe — **le premier chargement n'est jamais animé, par construction** (vérifié en navigateur : ouverture directe sur `#/menu` = aucune animation, aucune classe). Cible menu : le contenu après le calque d'ambiance (la ligne du conteneur est épinglée par un test du cycle 1 ; la couche fixe d'univers reste hors animation). Mouvement réduit : coupes franches. Branche `anim/cycle5-transitions` (`2fa19e9`), 13 tests dans `tests/animations-cycle5.test.ts` (5 auto-mutations attrapées au développement + mutation du coordinateur sur la garde `.navigue`), suite **1784/1784** (119 fichiers, revérifiée par le coordinateur sur arbre propre, typecheck front).

Mesures : fenêtre de mesure très chargée (FCP 1,1–1,9 s des deux côtés en A/B alterné, témoin `#/jouer` équivalent — bruit, aucune conclusion tirée des chronos) ; la porte « premier chargement inchangé » est tenue par la construction + le contrôle navigateur. Bundle initial 484 259 → **484 328 o** (+69 o, plafond 484 422 : marge restante 94 o — point de vigilance). CLS **0**. Écarts assumés : squelette de premier chargement en coupe sèche (partagé avec Commande, hors périmètre) ; observation préexistante hors cycle : `#/menu` s'ouvre défilé d'environ 393 px (effet onglets antérieur à la boucle), inchangé.

Vidéos : `captures-animations/cycle4.webm` → `captures-animations/cycle5.webm`. **Verdict de la critique (détail au journal §8) : gain net de politesse** — la coupe sèche disparaît du parcours Découverte ; DA menu Découverte 9,5 → **9,6/10**. Le catalogue d'inspiration initial est épuisé → passe d'inspiration fraîche, puis bilan final de la boucle ci-dessous.

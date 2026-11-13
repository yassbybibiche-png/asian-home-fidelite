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
2. Typographie des titres de catégorie statique — pas de typo cinétique géante (Ciao/Drimify).
3. Le rail « En photos » n'a ni inertie ni vie propre (Fideliz).
4. Pas de plat-star plein cadre qui suit le défilement (Ciao/Menu vivant).
5. Aucune transition entre pages (changement de route sec).

## Cycles

### Cycle 1 — « Univers par catégorie » (menu Découverte) — référence : Ciao Kombucha

L'ambiance du menu change avec la famille de plats affichée : deux calques fixes derrière le contenu se croisent en opacité (900 ms), 6 univers sombres (magenta de base, braise, vert nuit, bleu encre, ambre, prune) attribués par rang de catégorie — stable pour une catégorie, y compris via les onglets filtrés ; l'en-tête de la catégorie active se pose (scale 1,04 → 1) et sa photo zoome très lentement (20 s) tant qu'elle est active. Mode Commande intact (autre page). Branche `anim/cycle1-univers` (`749b60a`), 11 tests ajoutés, suite **1721/1721** (115 fichiers).

Mesures (protocole SCORES.md, avant/après alternés puis confirmées au calme) : bundle initial **inchangé** 484 259 o (CSS +1 969 o) ; FCP menu 692–704 ms ; LCP 2 368–2 524 ms au calme — élément LCP = photo du héros, intacte : niveau de la baseline pré-boucle (déjà frontalière à ~2,5 s selon la charge), **aucune régression du cycle** ; CLS **0**. Mouvement réduit : tout coupé, testé et vérifié en Chromium.

Vidéos : `captures-animations/avant.webm` → `captures-animations/cycle1.webm`. **Verdict de la critique (détail au journal §8) : gain réel mais modéré** — la teinte fond visiblement d'une famille à l'autre en défilement, mais les cartes couvrent l'écran et les halos restent aux bords ; DA menu Découverte 8,6 → **8,9/10**. Le manque n°1 devient l'intensité : titres de catégorie encore modestes et pas de plat-star plein cadre → cycle 2.

# MENU VISUEL — Rapport de mission (13/11/2026)

Demande de l'utilisateur : « je veux vraiment un menu limite interactif, que ça donne
envie au client, que ce soit visuel » — puis extension le même matin : « Récupère les
photos d'Instagram, de Google, etc., retravaille-les de façon pro. »

Page concernée : le menu public `#/menu/<slug>` (chunk différé `MenuPublic`, hors
bundle initial). DA noir + magenta conservée. **Aucun prix ni aucune donnée du menu
n'a été modifié. Aucun envoi réel, aucune dépense. Production NON touchée** :
l'utilisateur valide le visuel sur staging d'abord.

---

## 1. Étape 0 — Inventaire photos (avant tout design)

### PDF officiel — rejeu intégral des 6 pages

Les 6 pages ont été ré-extraites (`pdfimages -j`) et examinées une par une : la page 5
« MENU MIDI » est **texte seul** ; les pages 2, 3, 4 et 6 confirment l'inventaire du
10/11/2026. **11 plats avec photo vérifiée** (Poke Bowl, Dynamite, Mi Prat, Pad Thaï,
Crousti Poulet, Khao Prat, Curry Vert, Tigre qui pleure, Bo Bun, Loc Lac, Mango Stick),
**70 sans photo**. Aucune photo supplémentaire n'est rattachable sans risque d'erreur
(« Spécialités » non légendées individuellement, bocaux desserts indiscernables,
boissons non identifiables, photo « Love Bao » contredite par sa légende).

### Extension — Instagram, fiche Google, linktr.ee (13/11/2026)

| Source | Examinées | Rattachées à un plat | Ambiance | Écartées et pourquoi |
| --- | --- | --- | --- | --- |
| linktr.ee/asianhomefrance | 3 visuels pleine taille | 0 | 0 | 3 : logo du restaurant (avatar), logo + 5 étoiles du lien d'avis, logo d'une marque tierce de livraison — aucune photo de plat ; la seule autre image est la vignette du PDF déjà source des photos actuelles |
| Instagram @asianhomeparis (direct) | 0 | 0 | 0 | **Accès public bloqué sans connexion** : page profil (mur de connexion), API publique du profil (réponse vide), page « embed » d'une publication (coquille bloquée), lecture de page externe (métadonnées seules). Aucun contournement tenté ; seuls les médias relayés par la galerie de la fiche (ci-dessous) sont accessibles |
| Fiche Google (galerie via connecteur Places, sources Google/Facebook/Instagram agrégées) | 5 médias (plafond de la galerie ; source TripAdvisor : 0) | 0 | 0 nouvelle (les 2 affiches de reels sont déjà en place : table dressée, cocktails) | 1 doublon (photo Facebook 474696354 = le plateau déjà servi en `hero-plats.jpg`), 1 logo déjà possédé (Facebook 310145732), 1 personne identifiable au premier plan (Instagram 468303134, publication DCxJgxusyvd — écartée comme le 09/11/2026) |

**Bilan de l'extension : 0 nouvelle photo récupérée, 0 nouveau rattachement.**
Détail et provenance de chaque photo dans `public/visuels/SOURCES.md` (section
« Extension du 13/11/2026 »). Le retravail « pro » porte donc sur le stock existant :
variante WebP légère du Loc Lac créée pour les grandes cartes
(`menu-loc-lac-petit.webp`, 720×467, 40 670 o contre 156 543 o pour le JPEG, qui reste
la photo du détail déplié) ; les 9 fiches PDF étaient déjà en WebP optimisé et leurs
vignettes en 192 px. Aucune correction lumière nécessaire (photos du PDF déjà
lumineuses). Règle absolue tenue : **aucune photo générée ou de stock, aucune photo
d'un autre établissement, aucune photo avec personne identifiable** ; un plat sans
vraie photo reste sans photo et le design le porte.

## 2. Ce qui a été construit

Dans `src/pages/MenuPublic.tsx` (page différée), `src/lib/menuClient.ts` et
`src/lib/langue.ts` — structure, onglets collants, suivi de la catégorie active au
scroll (IntersectionObserver), recherche et fiches dépliées existants **conservés** :

- **Rail « En photos »** : sous le bandeau prix, les 11 plats photographiés de toute la
  carte en cartes horizontales défilantes (photo, nom, prix). Un toucher bascule sur
  l'onglet « Toutes », ouvre la fiche du plat et défile en douceur jusqu'à sa carte
  (défilement instantané si l'appareil demande un mouvement réduit). Masqué pendant
  une recherche.
- **Grandes cartes plats** : chaque plat photographié reçoit une grande photo
  (hauteur 176 px, coins arrondis 24 px) en tête de carte, avec le prix en pastille
  sombre sur la photo ; la ligne existante (vignette, nom, badges déduits, prix,
  chevron ▾/▴ qui rend l'ouverture visible) est inchangée dessous. La photo du détail
  déplié passe de 176 à 224 px.
- **En-têtes de catégorie enrichis** : photo de catégorie en 176 px (au lieu de 128),
  coins 24 px et ombre portée ; la catégorie du midi reçoit la pastille
  **« 🍱 Menu Midi »** à côté de son titre pendant les heures du menu midi (le bandeau
  midi existant est conservé). Apparition en fondu des sections et des cartes
  (animation existante, coupée si mouvement réduit).
- **Helpers purs testés** : `photoCartePlat` (fiche du plat, sauf le Loc Lac servi en
  variante WebP légère sur les cartes) et `prefereMouvementReduit`, dans
  `src/lib/menuClient.ts`.
- **Bilingue** : 3 nouvelles chaînes passées par `t()` et traduites dans
  `TRADUCTIONS_EN` (« En photos », « Voir le plat : {nom} », « 🍱 Menu Midi ») —
  garde P2-Q1 verte. Aucun attribut inventé : pas de « populaire / épicé /
  végétarien » ajouté (seuls les badges déduits existants, signalés comme tels).
  Appels à l'action conservés (Appeler, Itinéraire, Instagram), pied public et retour
  parcours inchangés.

## 3. Tests — une seule adaptation, autorisée par le brief

- **Adaptation unique** (`tests/photos-menu.test.ts`) : l'assertion d'affichage ne
  visait plus le bon élément depuis l'arrivée des grandes cartes — le regex de la
  photo de liste devient celui de la grande carte (`photoCartePlat(p)`, `h-44 w-full`),
  titre du test ajusté. L'assertion sur la fiche dépliée est **inchangée**, aucun
  autre test touché.
- **Nouveaux tests** : `tests/menu-visuel.test.ts` (6 tests : mapping Loc Lac et
  cas limites de `photoCartePlat`, fichier dérivé livré et borné, présence du rail
  dans la source) et `tests-e2e/menu-visuel.spec.ts` (1 parcours : rail → fiche
  ouverte, onglet « Desserts », recherche, retour depuis un item du rail).
- **Contre-épreuves par mutation** (relecture Codex indisponible, voir §4) :
  `photoCartePlat` ramené à `p.photo` → le test Loc Lac échoue ; suppression de la
  traduction « En photos » → la garde P2-Q1 échoue ; rail masqué (seuil à 99) → la
  spec E2E échoue. Fichiers restaurés après chaque épreuve.

## 4. Revue — remplacement de Codex (quota)

La relecture Codex est **indisponible (quota atteint jusqu'au 16/11)**. Elle a été
remplacée, comme au déblocage de la nuit, par : relecture **ligne à ligne** du diff
complet par le coordinateur (chaque snippet épinglé par les tests vérifié présent à
l'identique dans `MenuPublic.tsx`), les 3 contre-épreuves par mutation du §3, et la
relance **intégrale** de la suite par le coordinateur après le commit de production
(la session de production n'avait relancé que 3 fichiers après sa correction de
compteur).

## 5. Vérifications

- `npm test` : **1570/1570** (relance complète du coordinateur, typechecks inclus).
- `npx tsc -p .` et `npm run build` : OK. E2E locale : **9/9** (8 existantes + le
  nouveau parcours menu).
- Bundle JS initial : **482 531 o**, plafond épinglé **484 422 o inchangé** — la page
  menu reste un chunk différé, rien n'a été ajouté au bundle initial au-delà du bruit
  de build.
- Contrôle visuel du coordinateur : captures Playwright Pixel 7 du build local
  (même code que staging) lues une par une — rail lisible et appétissant, grandes
  cartes avec pastille prix, bannières de catégorie, fiches texte sobres avec
  chevrons, aucun débordement horizontal (412 px = 412 px), aucun prix modifié
  (Poke Bowl 14,50 €, Dynamite 8,90 €… conformes aux données).

## 6. Mesures avant/après (détail dans SCORES.md)

Protocole identique avant et après (`scripts/mesurer-menu-asian-home.mjs`, Pixel 7,
Slow 4G, CPU ×4, 2 passes ; poids visuel après défilement complet aller-retour) :

| Mesure | Avant | Après |
| --- | --- | --- |
| FCP menu | 1 188 / 1 192 ms | 700 / 680 ms |
| LCP menu (héros) | 4 496 / 4 796 ms | 2 572 / 2 356 ms |
| Visuels avant défilement | 56 902 o | 177 096 o (+120 194 o : 7 premières photos du rail, paresseuses, sous le bandeau) |
| Poids visuel après défilement complet | 164 150 o (17 fichiers) | 424 316 o (28 fichiers) |

Le surcoût est le gain visuel lui-même : les fiches photo en grande taille, chargées
**paresseusement au fil du défilement** (avant, la liste ne chargeait que les
vignettes). Aucun affichage initial n'est bloqué par ces images ; FCP/LCP mesurés
sans régression (variance inter-runs forte sur cette VM, chiffres donnés tels quels).

## 7. Branches et staging

- Branche `menu/visuel-interactif` : commit de production `45c86c3` + finalisation
  coordinateur `a3d57b6` (mesures SCORES, inventaire étendu SOURCES) — **poussée**.
- Fusion `--no-ff` dans `autonome/integration` : `4a8946d` — **poussée**.
- **Staging vérifié** (https://asian-home-fidelite-staging.onrender.com) :
  `/api/v1/sante` 200 (Supabase, migrations OK) ; fiche publique du commerce présente ;
  le chunk `MenuPublic` servi contient le rail (« En photos », « Voir le plat »,
  « Menu Midi », ancres `plat-`), le chunk partagé contient la variante Loc Lac et la
  traduction « In pictures » ; `/visuels/menu-loc-lac-petit.webp` servi (200,
  40 670 o). Limite consignée : Chromium depuis cette VM ne traverse pas le proxy de
  sortie du bac à sable (3 tentatives, `ERR_TUNNEL_CONNECTION_FAILED`) — pas de
  capture d'écran *de staging* ; le contrôle visuel a été fait sur le même code en
  local (§5) et la validation finale se fait sur le téléphone de l'utilisateur.
- **Production : NON déployée** (master toujours à `608752f`).

## PRÊT POUR VALIDATION SUR STAGING : **OUI**

À valider par l'utilisateur sur son téléphone :
https://asian-home-fidelite-staging.onrender.com/#/menu/c-asian-home-paris
(réveil ~1 min possible si le service dort).

## Ce qui manquerait pour la production

1. **La validation visuelle de l'utilisateur sur staging** (seul blocage).
2. Ensuite : fusion `autonome/integration` → `master` + push (déploiement Render
   automatique), contrôle `/sante` production et de la page menu publique.
   Aucune migration, aucun réglage, aucun prix ni donnée à changer.

Points d'attention connus : la fiche du Mango Stick reste un JPEG de 61 660 o
(candidate à une variante WebP comme le Loc Lac, non faite pour ne pas rouvrir les
compteurs) ; 70 plats restent sans photo réelle — la liste `docs/PHOTOS-MANQUANTES.md`
attend les photos du restaurant (demande déjà préparée, à transmettre par
l'utilisateur).

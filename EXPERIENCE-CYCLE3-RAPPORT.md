# Expérience — Cycle 3 : rapport (animations niveau Ciao, descriptifs, activation staging puis production)

Mission du 13/11/2026 (soir), suite au retour de l'utilisateur sur le staging : « Je ne retrouve pas les
animations de Ciao Kombucha du tout — active-moi la commande et remplis tous les descriptifs correctement, je
veux que tout soit bien animé. » Puis, à 20:47, autorisation explicite d'enchaîner sur la production (lot 4).
Branche `experience/cycle3-animations-activation` ; tests **1681/1681** (revérifiés par le coordinateur),
E2E **12/12**. Détail par lot : `EXPERIENCE-JOURNAL.md`, section « Cycle 3 ».

## Lot 1 — Animations « niveau Ciao » sur les surfaces Découverte (#/bienvenue, #/menu)

Ajouts (commit 935e774 ; Commande, Cuisine, Jouer et commerçant inchangés ; tout est coupé en
`prefers-reduced-motion`, vérifié au navigateur : 0 animation sur l'accueil en mode réduit) :

- **Bandeaux défilants continus** : plats signatures puis familles de la carte sur l'accueil (36 s, boucle sans
  couture, pause au survol, second bandeau en sens inverse) ; noms des plats photographiés sur le menu.
- **Éléments flottants** : deux pastilles photo (Loc Lac, Mango Stick) qui lévitent aux coins du héros (±8 px,
  6 s / 7,5 s).
- **Ken burns** 16 s sur les photos « moment » et les en-têtes de catégorie ; **parallaxe léger** (±28 px) sur
  le héros et ces en-têtes ; titres « moment » qui glissent en scène ; cartes plats révélées en cascade
  (60 → 240 ms) ; micro-interactions tactiles (onglets, cartes, boutons de l'accueil).

Mesures labo avant → après (protocole SCORES.md, Pixel 7 simulé, Slow 4G + CPU ×4, même session, 2 passes) :

| Surface | FCP avant | FCP après | LCP avant | LCP après | CLS |
|---|---|---|---|---|---|
| Menu | 696/672 ms | 692/692 ms | 2428/2396 ms | 2440/2368 ms | 0 → 0 |
| Accueil | 668/668 ms | 720/716 ms | 1864/1884 ms | 1920/1932 ms | 0 → 0 |

Le premier affichage ne se dégrade pas (menu inchangé ; accueil +~50 ms, sous les cibles ~800 ms / 2,5 s).
Bundle JS initial : 484 018 → **484 017 o** (plafond 484 422) — les animations vivent dans les chunks différés.
Captures Pixel 7 avant/après (animations activées) : animations en cours 7 → 14 sur l'accueil, 16 → 27 sur le
menu ; aucun débordement (412/412). Nouveaux tests : 15, aucun test existant adapté ; 3 mutations de
contre-épreuve toutes détectées.

## Lot 2 — Descriptifs complets : 81/81 (staging puis production)

La carte officielle (16 catégories, 81 plats, depuis `menuReelAsianHome()`) a été **enregistrée** dans le
commerce Asian Home (la commande lit désormais le menu enregistré, pas le repli public), avec une description
pour **chaque** plat : 81/81 descriptions non vides, vérifiées par GET après écriture, **0 dérive** sur les noms
et les prix. Règles respectées : texte fondé uniquement sur le nom du plat et sa composition standard, aucun
ingrédient inventé, aucune affirmation d'allergène ; le modèle de données n'a pas de champ EN (français
seulement) ; les deux prix non confirmés (Riz Thaï, Maki Gold) restent affichés « Prix sur place ». Source des
textes (à réutiliser telle quelle) : `node_modules/.cache/cycle3/descriptions.json` +
`payload-menu.json`. Incident à connaître : les premiers PUT menu (staging puis production) ont dépassé les
délais sans écrire (état revérifié à chaque fois), puis tout est rentré dans l'ordre après un PATCH sans effet
+ un PUT du menu inchangé — cause exacte non établie (état transitoire post-déploiement, première requête
bloquée côté serveur) ; la procédure de déblocage est dans le journal.

## Lot 3 — Activation de la commande sur le STAGING + parcours complet réel

Interrupteur « Commande à table » activé pour Asian Home (staging), tables **1 à 8** créées avec leurs jetons.
Parcours prouvé sur le staging déployé : commande sur la Table 3 (Pad Thaï + 2× Bubble Tea, total 23,90 €
recalculé par le serveur) → visible en cuisine (`recue`) → `acceptee` → `en_preparation` → `servie`, suivi
client cohérent à chaque étape ; renvoi de la même clé d'idempotence = `doublon`, aucune commande en double.
Le staging est en état de démo prête.

## Lot 4 — Production (autorisation du 13/11 20:47)

1. **Sauvegarde d'abord** : export complet via `GET /admin/sauvegarde`, 22 lignes, compteurs vérifiés
   cohérents (clients 4, tirages 4, commerces 1, menus 1…) ; archive conservée hors dépôt
   (`node_modules/.cache/cycle3/sauvegarde-prod-avant-lot4.json.gz`). Note : l'archive part **non chiffrée**
   (clé de chiffrement absente de l'environnement production) — à poser un jour (variable
   `SAUVEGARDE_CLE_CHIFFREMENT`).
2. **Déploiement** : `autonome/integration` → `master` (**71b3d42**), arbre identique à l'arbre testé ;
   asset servi `index-BuSbPAP7.js` (même hachage que le staging) ; santé 200, migrations 4/4 ; aucune
   régression (fiche, menu, règlement du jeu, carte d'un client existant : 200).
3. **Menu + descriptifs en production** : 81/81 descriptions, 0 dérive nom/prix (même contrôle qu'en staging).
4. **Activation en production** : module actif, tables **1 à 8** créées (jetons générés par le serveur ; la
   table temporaire « TEST » de l'essai a été retirée ensuite, jetons des tables 1 à 8 préservés).
5. **Commande test unique — échec partiel, sans fard** : une commande TEST (1× Pad Thaï, 13,90 €, instructions
   « TEST — ne pas préparer ») a été créée et est visible en cuisine, mais **ses transitions de statut
   renvoient 409 en production** (« modifiée par ailleurs ») alors que la même commande, au caractère près,
   transite en 200 sur le staging. Le défaut est spécifique à l'environnement production (UPDATE conditionnel
   du CAS sur la table `meta` via PostgREST : 0 ligne matchée ; donnée intègre, aucun doublon). Rien n'a été
   forcé : la commande TEST reste donc `recue` en cuisine du jour, seule commande présente, clairement
   étiquetée. **À faire avant l'usage en salle** : vérifier dans le tableau de bord Supabase production le
   type de la colonne `meta.valeur` (et les journaux PostgREST lors d'une transition), corriger, puis fermer la
   commande TEST (acceptée → préparation → servie). Le parcours complet, lui, est prouvé en staging (lot 3).

## Liens prêts à montrer

**Production** (https://asian-home-fidelite.onrender.com) :
- Accueil : https://asian-home-fidelite.onrender.com/#/bienvenue/c-asian-home-paris
- Menu : https://asian-home-fidelite.onrender.com/#/menu/c-asian-home-paris
- Commander (Table 1) : https://asian-home-fidelite.onrender.com/#/commande/c-asian-home-paris/ZEQrrF3gRNlGxSeE1aUNOnJd
- Cuisine : https://asian-home-fidelite.onrender.com/#/cuisine/c-asian-home-paris

**Staging** (https://asian-home-fidelite-staging.onrender.com) :
- Accueil : https://asian-home-fidelite-staging.onrender.com/#/bienvenue/c-asian-home-paris
- Menu : https://asian-home-fidelite-staging.onrender.com/#/menu/c-asian-home-paris
- Commander (Table 3) : https://asian-home-fidelite-staging.onrender.com/#/commande/c-asian-home-paris/cj7UiQICBVbbcc2f2ESlEud-
- Cuisine : https://asian-home-fidelite-staging.onrender.com/#/cuisine/c-asian-home-paris

## Ce qu'il reste à faire (côté restaurant / décisions)

- **Corriger le 409 des transitions en production** (voir lot 4 §5) avant d'utiliser la commande en salle ;
  la commande TEST se ferme ensuite en trois clics dans l'écran cuisine.
- Dans Réglages → « Commande à table » : ajuster les tables réelles (noms/nombre) si besoin et **imprimer les
  QR** des tables (planche d'impression intégrée).
- Confirmer les prix du **Riz Thaï (8,90 € ?)** et des **Maki Gold (100,00 € ?)** : tant qu'ils ne le sont pas,
  ces plats restent « Prix sur place » et non commandables.
- Poser `SAUVEGARDE_CLE_CHIFFREMENT` dans l'environnement production pour chiffrer les sauvegardes.
- Sur le staging : un commerce jetable « Probe Cycle3 » (créé pour le diagnostic du lot 2, commande inactive)
  subsiste ; sans effet sur la démo.

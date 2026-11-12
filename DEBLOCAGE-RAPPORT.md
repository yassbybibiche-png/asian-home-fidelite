# Rapport — Mission « DÉBLOCAGE » (12/11/2026, au soir)

Autorisation de l'utilisateur, 12/11/2026 à 23h36 : « Tout débloquer : le test (3 lignes) + relever un peu le
plafond JS ». Trois chantiers bloqués par des tests épinglés et par le plafond du bundle initial ont été livrés
sur la branche `deblocage/trois-chantiers`, fusionnée dans `autonome/integration`. **Production non touchée**
(master reste à 29d8cad) ; staging redéployé depuis `autonome/integration`.

État final : **tests 1563/1563 verts** (typechecks inclus), **E2E locale 8/8** (5 anciennes + 3 nouveaux
parcours), `npx tsc -p .` vert. Aucun envoi réel (Brevo reste en mode test), aucune dépense, aucune connexion
Google.

⚠️ **Écart de processus, dit franchement** : la relecture Codex de chaque diff n'a pas pu avoir lieu — le CLI
Codex a atteint son quota (« You've hit your usage limit… try again at Nov 16th, 2026 ») dès la première
tentative. Chaque lot a donc été relu ligne à ligne par le coordinateur (diffs complets relus : Jouer.tsx,
CartePublique.tsx, vuePublique.ts, server/app.ts), en plus des contre-épreuves par mutation de chaque lot.
Une relecture Codex de rattrapage reste possible après le 16/11 sur le diff `b65e0b8..autonome/integration`.

---

## Chantier 1 — Item A : prénom optionnel dès l'inscription

**Fait.** Le formulaire d'entrée de la page de jeu (`Identification`, src/pages/Jouer.tsx) propose un champ
« Votre prénom (optionnel) » (id `j-prenom`, `autoComplete="given-name"`, `maxLength={40}`, **jamais
`required`**, aucune validation bloquante : l'envoi ne dépend toujours que du contact). Le prénom saisi
(trimé) est transmis par `onEnvoyer(contactSaisi, prenomSaisi, consentementRelance)` aux deux modes :
`inscrireClient(commerce.id, prenomSaisi, …)` en local, `api.inscrirePublic(commerce.id, prenomSaisi, …)` en
API. **Aucun changement serveur n'était nécessaire** : la route d'inscription lisait déjà `corps.prenom` et
`inscrireOuRetrouver` le stocke pour un nouveau client ; un client existant est renvoyé tel quel — **un
prénom existant n'est jamais écrasé** (prouvé par un test : ré-inscription avec « Pirate » → le prénom reste
« Mai »). En aval, tout existait déjà : la carte, les écrans de résultat (« Bravo Linh… »), les messages
utilisent le prénom quand il existe, et `DemandePrenom` ne s'affiche plus après le tirage que si le client n'a
toujours pas de prénom.

**Preuves.**
- 3 tests serveur ajoutés (inscription avec prénom → stocké ; sans prénom → `''` ; ré-inscription → jamais écrasé).
- Contre-épreuves : `required` ajouté temporairement à l'input → le test source modifié échoue (« le prénom
  n'est jamais obligatoire ») ; `git stash` de Jouer.tsx → les tests source échouent, les tests serveur restent
  verts (le serveur était déjà prêt).
- E2E (parcours a) : inscription avec prénom « Linh » → bouton « Tourner la roue, Linh ! », résultat
  personnalisé, pas de demande de prénom après le tirage ; second téléphone sans prénom → le parcours continue
  et la demande post-tirage s'affiche.
- Coût bundle : ≈ +0,3 Ko de JS initial (481 605 o après le lot).

**Changements de tests (exactement).**
- `tests/entree-qr-p1-c1.test.ts` — les 3 lignes autorisées : en-tête l.2 (règle reformulée : prénom proposé
  dès l'inscription, toujours optionnel, redemandé après le tirage s'il manque) ; l.95 → comptage d'inputs
  2 → 3 et message adapté ; le test de l.110 réécrit (titre + l.112-113 remplacées par : champ `j-prenom`
  présent, `given-name`, absence de `required`, garde d'envoi inchangée, nouvelle signature `onEnvoyer`).
  Toutes les autres assertions du fichier (DemandePrenom ×2, blocs post-résultat, `api.prenomCarte`,
  `lancerTirage` exact) sont inchangées. + 3 tests serveur ajoutés dans le même fichier.
- `tests/relances-ui-p1-b3.test.ts` l.55 et l.56 : regex des deux appels d'inscription, `''` → `prenomSaisi`
  (directement imposé par le changement d'appel ; fichier débloqué par l'utilisateur dès le 12/11 14h23) ;
  commentaire l.54 devenu obsolète corrigé dans le commit de suivi 022f624.
- README.md / SCORES.md : total de tests 1555 → 1558 (compteur imposé par `documentation-p2-q5`).

## Chantier 2 — Plafond du bundle JS initial relevé du strict nécessaire

**Mesures** (build frais, méthode `mesure-bundle.mjs` — celle des tests) :
- Départ de la branche (= `autonome/integration` b65e0b8) : JS initial **481 283 o** ; ancien plafond
  effectif **481 376 o** (formule `INITIAL_AVANT_OCTETS * 0.8` de P2-Q2), marge 93 o.
- Après les trois chantiers : JS initial **482 374 o** (index 370 542 + ui 102 990 + jsx-runtime 8 243 +
  rolldown-runtime 599), CSS 82 282 o, total initial 564 656 o, JS total 860 956 o, 26 chunks.
  Dépassement réel de l'ancien plafond : 998 o seulement.
- **Nouveau plafond : 484 422 o** = 482 374 + 2 048 (~2 Ko de marge), relevé de 3 046 o par rapport à
  l'ancien. Aucun refactor de découpage du chargement (hors périmètre de la mission).

**Changement de test (le plafond lui-même).** `tests/performance-bundle-p2-q2.test.ts` : la formule
`octets < INITIAL_AVANT_OCTETS * 0.8` est remplacée par la constante documentée
`PLAFOND_BUNDLE_INITIAL = 484_422` (commentaire : décision utilisateur du 12/11/2026, ancien plafond
481 376 o, renvoi à ce rapport). `INITIAL_AVANT_OCTETS` et toutes les autres assertions sont inchangés.
SCORES.md § Bundle : chiffres canoniques mis à jour depuis la même mesure (JS + CSS = total, exact) et
paragraphe plafond ajouté (ancien → nouveau, mesure, décision).

## Chantier 3a — Badge « Bonus heures creuses actif »

**Fait.** Le drapeau `bonusCreux` était déjà servi par la fiche publique pendant un créneau (D2) ; seul
l'affichage manquait. `InfosJeu` (Jouer.tsx) rend désormais, sous « À gagner aujourd'hui » et seulement si
la fiche porte le drapeau (garde `'bonusCreux' in commerce && commerce.bonusCreux`, nécessaire car
`CommerceJeu = Commerce | CommercePublic`) : une pastille verte « ⏰ Bonus heures creuses actif »
(t('…') + traduction EN ajoutée). Hors créneau : rien ne change.

**Preuves.** Test source ajouté dans `tests/heures-creuses-d2.test.ts` (badge conditionné dans le corps
d'`InfosJeu` + traduction) ; contre-épreuve : bloc retiré → le test échoue. E2E (parcours b) : créneau
00:00–23:59 tous les jours + lot heures creuses → badge visible en vrai navigateur (limite connue : la
minute 23:59 à Paris est hors créneau, fin exclue). Coût bundle : +343 o. Total de tests 1558 → 1559.

## Chantier 3b — Bouton « Voir le menu » sur la page de jeu et la carte client

**Fait.** Constat de départ (vérifié en production le 12/11 au soir) : le menu public (#/menu/&lt;slug&gt;,
81 plats) n'était proposé par aucun lien du parcours client normal.
- **Page de jeu** : lien `📖 Voir le menu` → `#/menu/${commerce.id}` (chaîne et traduction existantes,
  classe `bouton-secondaire`) ajouté en fin de cadre des deux modes, visible à tous les écrans du parcours
  (identification, roue, résultat) : en API quand `menuDisponible && jeu?.statut !== 'sansVisite'` (l'écran
  d'attente garde son propre lien « … en attendant », pas de doublon) ; en local quand `estAsianHome(commerce)`.
- **Carte client** : le bouton existait dans la vue complète ; le lot a trouvé et corrigé un vrai manque —
  la **vue limitée** (carte ouverte depuis un lien court SMS, sans le jeton du téléphone) ne l'affichait pas
  alors que le serveur envoie `menuDisponible` dans cette réponse. La règle est maintenant calculée une fois
  et transmise aux deux vues ; `VueLimitee` rend le même bouton. Vue locale (démo) : pas de bouton, le menu
  n'y existe pas (message « mode serveur ») — choix assumé.
- **Correctif C-bis (trouvé par l'E2E, pas par les tests unitaires)** : en mode API, `menuDisponible`
  démarrait à `estAsianHome(commerce)` et ne devenait vrai qu'après l'identification du joueur — pour tout
  autre commerce qu'Asian Home, le bouton était donc absent avant l'inscription. La fiche publique
  `GET /commerces/:id` publie maintenant `menuDisponible: true` quand le commerce a un menu avec au moins un
  produit (même calcul que les routes carte ; patron `bonusCreux` : clé absente sinon, fiche toujours
  expurgée — ni probabilités ni créneaux). Piège évité au passage : `fichePublique` passé en `.map(...)`
  aurait reçu l'index du tableau comme booléen (repéré par `typecheck:server`, couvert par le nouveau test).

**Preuves.** 3 tests source ajoutés (`tests/ecrans-client-r4.test.ts`, describe « Déblocage C ») + 1 test
serveur (fiche : absente sans menu, absente si menu vide, `true` avec un produit, fiche par ailleurs
identique, liste sans drapeau) ; contre-épreuves par mutation (lien retiré de chaque Partie → échec ;
condition remplacée par `true` → échec ; bouton retiré de `VueLimitee` → échec ; drapeau retiré de la fiche
→ échec ; `.map(fichePublique)` restauré → échec). E2E (parcours c) : commerce générique + menu d'un plat →
bouton visible **avant** l'inscription, clic → page menu avec le plat, bouton aussi présent sur la carte du
client. Coût bundle : +384 o (lot C) + 42 o (C-bis). Total de tests 1559 → 1563.

**Changements de tests (exactement).**
- `tests/menu-client-p1-c5.test.ts` : +1 test (fiche publique, ci-dessus), fichier existant, aucun test modifié.
- `tests/ecrans-client-r4.test.ts` : le test « Déblocage C » sur l'initialisation de `menuDisponible` mis à
  jour pour la règle C-bis (fiche d'abord, repli `estAsianHome`) — test créé par cette même mission.
- `tests/attente-visite-p0-u4.test.ts` l.138-139 : commentaire + regex de l'ancien initialiseur
  `useState(() => estAsianHome(commerce))` remplacés par le nouvel initialiseur exact. Modification
  directement imposée par le chantier 3b (la ligne épinglait le littéral que C-bis devait changer ; la
  session C-bis s'est arrêtée plutôt que de la modifier sans autorisation, le coordinateur l'a appliquée et
  vérifiée : les 70 tests des trois fichiers concernés passent).

## État des branches et livraison

- Branche `deblocage/trois-chantiers` : 05a29e2 (A), 022f624 (A suivi), acf4cfe (B), d945c1d (C), 57a33fd
  (C-bis), cce628b (D) + ce rapport.
- Fusion `--no-ff` dans `autonome/integration`, les deux branches poussées ; staging vérifié sain après
  redéploiement (`/api/v1/sante`).
- `master` et la production : **non touchés**.

## PRÊT POUR LA PRODUCTION : oui

Sous une seule réserve, écrite noir sur blanc : la relecture Codex n'a pas eu lieu (quota Codex atteint
jusqu'au 16/11/2026) ; elle a été remplacée par la relecture des diffs par le coordinateur et les
contre-épreuves de chaque lot. Tout le reste est vert : suite complète 1563/1563, E2E locale 8/8 incluant
les trois nouveaux parcours, staging sain. Le déploiement production reste une décision séparée (sauvegarde
avant, comme d'habitude).

Point mineur connu, assumé : en mode local/démo, le lien menu de `PartieLocale` mène à la page menu qui
affiche le message « disponible avec le serveur » (le menu n'existe pas hors mode API) — sans aucun impact
en production, qui tourne en mode API.

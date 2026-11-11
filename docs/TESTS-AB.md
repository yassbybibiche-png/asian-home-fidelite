# Tests A/B — Asian Home Fidélité (lot P2-Q3, 10/11/2026)

Deux tests simples. Le **test 1 est outillé** dans l'app (répartition automatique + compteurs + résultats dans le
tableau de bord). Le **test 2 n'est PAS automatisé** : c'est un **protocole manuel** à lancer par le gérant, mesuré avec
les chiffres et l'export CSV du tableau de bord.

Règle commune : **aucune identité**. Aucun identifiant de client, de téléphone ou d'appareil n'est utilisé pour répartir
ou pour mesurer ; rien n'est stocké sur le téléphone du client pour ces tests.

---

## Test 1 — Accroche : « gagnez un cadeau » ou le nom d'un lot ? (outillé)

**Question.** Sur la page de jeu (après le scan du QR), la phrase sous le nom du restaurant donne-t-elle plus envie de
jouer si elle cite un vrai lot ?

| Variante | Phrase affichée (FR / EN) |
|---|---|
| **A** (générique, actuelle) | « Tournez la roue et gagnez un cadeau ! » / « Spin the wheel and win a gift! » |
| **B** (libellé du lot) | « Tournez la roue : *Nems offerts* à gagner ! » / « Spin the wheel: *Nems offerts* to win! » — le 1er lot gagnant de la roue (jamais un « Dommage ! ») |

**Répartition (mécanisme).** Par **jour**, pas par client : `varianteDuJour(jour)` (`src/lib/mesure.ts`) donne A les
jours pairs et B les jours impairs (jours comptés depuis le 1er janvier 1970, jour calendaire à Paris). Tous les clients
d'une même journée voient la même phrase.
- Pourquoi par jour : aucun identifiant, aucun cookie, aucun hasard à mémoriser ; un client qui revient le même jour voit
  la même phrase ; le serveur et le téléphone calculent la même variante sans échanger quoi que ce soit.
- Une semaine a 7 jours (impair) : chaque jour de la semaine **alterne** de variante d'une semaine à l'autre (le samedi
  n'est pas toujours B). Sur 2 semaines complètes, chaque variante a eu chaque jour de la semaine une fois.

**Mesure.** Compteurs anonymes par jour (table `evenements_jour`, migration 0008) : `scan` = QR scanné — compté par la
redirection courte `/r/<commerceId>` du serveur, **même si la page de jeu ne se charge jamais** (réseau coupé, serveur
endormi) — ou page de jeu ouverte directement (lien partagé, parrainage), signalée une fois par onglet ; `tirage` =
tirage enregistré par le serveur. **Indicateur** : tirages ÷ scans, par variante.

**Lancer / arrêter.** Réglages → *Lots de la roulette* → interrupteur « Test A/B : phrase d'accroche de la page de jeu ».
Le serveur note le jour de début (et le jour d'arrêt) ; ces dates ne viennent jamais du navigateur. Réactiver = nouveau
test qui repart de zéro. Pendant le test, la fiche publique du commerce ne contient que `testAccroche: true`.

**Lire le résultat.** Tableau de bord → *Mesure* → « Test A/B · phrase d'accroche » : jours, pages ouvertes, tirages et
taux de chaque variante.
- Moins de **100 pages ouvertes par variante** : « pas encore assez de données » — ne rien conclure.
- Au-delà : test z de deux proportions au seuil de 95 %. « Écart significatif » → garder la meilleure phrase (arrêter le
  test ; pour garder B en permanence il faudra une petite modification du code, la phrase par défaut restant A).
- **Durée conseillée** : au moins **4 semaines** (chaque variante voit chaque jour de la semaine au moins 2 fois).

**Limites honnêtes.**
- Le taux est par *page ouverte*, pas par *personne* : une même personne peut ouvrir la page deux fois (deux onglets,
  deux téléphones). Le test z suppose des essais indépendants : c'est une approximation, suffisante pour trancher un écart
  net, pas pour un écart de 1 ou 2 points.
- Un jour exceptionnel (fête, pluie, groupe) pèse sur une seule variante. D'où la durée minimale de 4 semaines.
- Il faut une **visite validée au comptoir** pour jouer : le taux dépend aussi du rythme de la caisse, identique pour A et B.
- Sans la migration 0008 appliquée sur la base, rien n'est compté (le tableau de bord le dit) : appliquer la 0008 avant
  d'activer le test.

---

## Test 2 — Offre de la semaine : le mardi ou le jeudi ? (protocole MANUEL, non automatisé)

**Question.** L'offre de la semaine (Réglages → programme → *Offre de la semaine*) attire-t-elle plus de visites le
**mardi** ou le **jeudi** ?

**Pourquoi manuel.** Une offre de jour ne peut pas être répartie entre clients le même jour (elle est affichée à tous,
en vitrine comme sur la carte) : on compare des **semaines** entières, ce que l'app ne bascule pas toute seule. Le
jour de l'offre ne se change donc pas automatiquement ; en revanche **la comparaison est outillée** : le tableau de
bord (Mesure → « Test A/B · offre de la semaine », `comparerOffreSemaine` dans `src/lib/mesure-offre.ts`) calcule, pour
deux périodes de 4 semaines choisies par le gérant, les visites par jour de semaine et la variation nette — plus
besoin d'exporter le CSV à la main pour comparer.

**Protocole.**
1. **Semaines 1 à 4 — offre le mardi.** Réglages → *Offre de la semaine* : jour = mardi, même libellé et même condition
   pendant toute la durée.
2. **Semaines 5 à 8 — offre le jeudi.** Changer seulement le jour (mardi → jeudi). Libellé et condition identiques.
3. Ne pas lancer d'autre opération (SMS, réseaux sociaux, test 1…) pendant ces 8 semaines, ou la noter.
4. **Mesurer** : Tableau de bord → *Mesure* → **Test A/B · offre de la semaine** : saisir le lundi de début de chaque
   période de 4 semaines (par défaut, les deux derniers blocs de 4 semaines). Le tableau donne les visites de chaque
   jour de semaine pour les deux périodes, et la variation nette. (Repli : **Export CSV** de la vue « Jour », colonne
   `visites`, une ligne par jour ; exporter à la fin de chaque période de 4 semaines : la vue « jour » couvre les 30
   derniers jours.)
5. **Comparer** :
   - visites des 4 mardis avec offre ÷ visites moyennes des mardis des 4 semaines précédant le test (base) ;
   - même calcul pour les 4 jeudis avec offre ;
   - et les autres jours de la semaine, pour vérifier que l'offre ne fait pas que *déplacer* des visites (si le mercredi
     baisse quand l'offre est le mardi, le gain net est plus faible).
6. **Décider** : garder le jour dont la hausse **nette** (jour de l'offre + autres jours) est la plus forte. Écart
   inférieur à ~10 % sur 4 semaines : considérer les deux jours équivalents (trop peu de visites pour trancher).

**Limites honnêtes.** Les deux périodes ne sont pas simultanées (saison, vacances scolaires, météo changent entre les
semaines 1–4 et 5–8) ; la comparaison à la base de chaque jour atténue ce biais sans l'annuler. Idéalement, refaire
l'ordre inverse (jeudi puis mardi) sur les 8 semaines suivantes.

---

## Ce qui est mesuré, et ce qui ne l'est pas

| Mesure | Source | Identité ? |
|---|---|---|
| Pages de jeu ouvertes, tirages, gains, clics vers l'avis Google | compteurs du serveur (`evenements_jour`, un nombre par jour et par type) — `scan` est compté à la redirection `/r/` du QR, même si la page ne se charge pas | **aucune** |
| Visites, tirages, gains, lots distribués, coût des lots | données déjà en base (tampons, tirages) | déjà existantes, rien de nouveau collecté |
| Retour après gain | tirages + visites déjà en base, calculé dans le tableau de bord | idem |
| Avis réellement publiés sur Google | **non mesuré** (Google ne le dit pas) ; seul le clic vers Google est compté | — |

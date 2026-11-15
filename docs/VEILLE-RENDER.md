# Veille Render — protocole d'observation des démarrages à froid (P3-5)

## Le problème (rappel de l'audit produit §1)

Le plan Render Free endort le service après ~15 min sans appel. Le premier appel ensuite attend le réveil
du conteneur (l'écran d'attente honnête dit « environ 1 minute »). Un premier scan de QR en début de service
peut donc coûter ~1 minute d'attente au client debout au comptoir. Ce n'est pas un bug, c'est un arbitrage
argent/expérience — et il n'a jamais été tranché avec des données. Ce document est le protocole de mesure
qui doit précéder toute décision.

## Ce qui est mesuré (depuis le 15/11/2026, cycle produit 14 ; protocole corrigé le 15/11/2026 après l'audit expert)

- **Par qui :** le navigateur du client — le serveur ne peut pas mesurer ce délai lui-même (il ne voit la
  requête qu'une fois le conteneur réveillé). Voir `src/lib/demarrageAFroid.ts`.
- **Quoi :** la durée de l'**épisode de réveil** — du premier appel resté sans réponse (délai client expiré
  ou réseau coupé) à la première réponse reçue pour le même commerce. C'est l'attente réellement subie par
  le client, réessais compris (`tenterPendant`, toutes les 3 s, 30 s au plus, puis réessai manuel). Un appel
  lent mais réussi du premier coup est compté avec sa durée propre. La durée propre de chaque appel est
  figée par le client API **avant** le chargement différé du module de mesure.
  *(Avant la correction, la mesure prenait la durée d'un seul appel — plafonnée par le délai client de
  10 s — augmentée du temps de chargement du module : la tranche « 30 s ou plus » n'était atteignable que
  par ce biais, et la balise partait avec un abandon à 5 s vers un serveur encore endormi, garde marquée
  avant l'envoi et sans renvoi : des démarrages à froid réels pouvaient n'être ni comptés, ni livrés.)*
- **Seuil :** une attente de **10 s ou plus** compte comme démarrage à froid probable (la latence normale
  est très inférieure ; le délai client par défaut est lui-même de 10 s).
- **Tranches :** `froid10a30s` (10 à 30 s) et `froidPlus30s` (30 s ou plus, proche de la minute annoncée).
- **Compteur :** un nombre par jour, sans aucune identité (même table anonyme que `scan`, migration 0008 +
  **0011** qui élargit le CHECK). Aucun délai exact n'est stocké, seule la tranche.
- **Livraison :** la balise est déposée dans une **file persistée** (sur le téléphone) puis livrée sans
  délai d'abandon artificiel ; la livraison est retentée à chaque appel public réussi — donc aussi à la
  visite suivante. Si la page se ferme pendant un réveil, un envoi `sendBeacon` signale l'attente déjà
  subie. Limite : un épisode jamais fermé, sur un navigateur sans `sendBeacon` et sans visite suivante,
  n'est pas compté.
- **Déduplication :** au plus **un événement par quart d'heure et par navigateur** — la garde n'est marquée
  qu'après une livraison confirmée par le serveur, et une balise encore en file vaut signalement du réveil
  en cours.
- **Périmètre :** seuls les appels publics sur un chemin `/commerces/<id>/…` (l'entrée par QR, `#/jouer/<id>`).
  Les appels marchands/équipe (tableau de bord, caisse, réglages) sont exclus ; les ouvertures directes de
  carte (`/cartes/<id>`) ne sont **pas comptées** (pas d'identifiant de commerce dans le chemin) — les chiffres
  sont donc un **minimum** : un client qui rouvre sa carte après une veille n'apparaît pas.
- **Lecture :** tableau de bord → section « Démarrages à froid » (par période jour / semaine / mois).

## Ce qui n'est PAS décidé

**Rien n'est décidé par ce cycle.** La bascule vers un plan payant (ou le statu quo) se décide après
**2 semaines de données réelles**, par le fondateur, chiffres en main. Le prix du plan Starter n'est affirmé
nulle part dans ce dépôt : il sera vérifié sur la page Render au moment de décider (les tarifs changent, un
chiffre recopié ici serait faux dans 2 semaines).

## Règle de décision (à appliquer avec les chiffres, pas avant)

À la fin des 2 semaines, lire la section « Démarrages à froid » du tableau de bord (période : mois en cours)
et comparer aux scans (`scan`, même période) :

- **Si plusieurs clients par semaine attendent plus de 30 s au premier scan** (tranche `froidPlus30s`
  régulière, y compris en heures de service) : le plan payant se justifie — le coût est celui d'un client qui
  repart sans jouer, répété chaque matin de service.
- **Si les démarrages à froid restent rares** (quelques-uns par mois, surtout hors service ou la nuit) : le
  statu quo tient — le plan Free suffit, l'écran d'attente honnête fait son travail.
- **Si le compteur reste à 0 alors que des clients signalent des attentes** : vérifier d'abord que la
  migration **0011 est appliquée** sur la base (voir ci-dessous) avant de conclure quoi que ce soit — un 0
  peut être une migration manquante, pas une absence de démarrages à froid.

La décision, sa date et les chiffres qui l'ont motivée seront consignés ici (section « Décision » ci-dessous)
et dans le journal de la boucle produit.

## Décision

**En attente.** Période d'observation : 2 semaines à compter de la mise en production du code du cycle 14
(la mesure sur le staging ne compte pas : le staging n'a pas de clients réels).

## Application de la migration 0011

Dans Supabase → SQL Editor, **dans l'ordre** `supabase/migrations/0001_schema_initial.sql` à
`0011_mesure_froid.sql` pour une base neuve ; pour une base existante (staging, production), appliquer
seulement `0011_mesure_froid.sql` (après 0008, déjà appliquée). Vérification :

```sql
select pg_get_constraintdef(oid) from pg_constraint where conname = 'evenements_jour_type_check';
```

Attendu : `CHECK (type IN ('scan', 'tirage', 'gain', 'clicGoogle', 'froid10a30s', 'froidPlus30s'))`.

Tant que la migration n'est pas appliquée, le serveur fonctionne : les balises sont refusées par la
contrainte et ignorées (un avertissement « événement non compté » apparaît dans les logs Render), le jeu et
l'entonnoir sont inchangés.

## Contexte : une observation ponctuelle, pas une mesure

Le 15/11/2026 vers 03h35, une première requête sur le staging (endormi) a pris ~44 s au total avant de
répondre (requête d'index + `/api/v1/sante` ensuite immédiate). C'est cohérent avec la minute annoncée, mais
ce n'est qu'**une observation, n = 1, pas une mesure client** : elle ne compte dans aucun total et ne justifie
aucune décision. C'est précisément pour remplacer ce genre d'anecdote par des chiffres que cette mesure existe.

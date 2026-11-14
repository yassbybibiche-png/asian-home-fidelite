# Mode d'accès à la roue — détermination, état d'Asian Home, mesure de l'attente

P3-1 de l'AUDIT-PRODUIT.md, cycle produit 10 (14/11/2026). Ce document dit comment le mode
d'accès effectif se détermine, quel est le mode d'Asian Home d'après les sources lisibles
ici, comment confirmer la valeur de production, et comment mesurer l'attente réelle des
clients en mode `visite` avant de décider d'un changement.

## 1. Le mode effectif : une règle, pas une devinette

- Champ `modeAccesRoue` du commerce : `'libre'` ou `'visite'`.
- Règle (`modeAccesRoue`, `src/lib/roulette.ts`) : seul `'libre'` **explicite** ouvre la roue
  sans visite. **Absent = `'visite'`** (configs d'avant R2). Le serveur et le client appliquent
  la même fonction ; la fiche publique (`commercePublic`, `src/lib/vuePublique.ts`) expose le
  mode effectif, et le règlement généré (`src/lib/reglement.ts`) décline sa section 2 selon
  le mode.
- Nouveaux commerces (`nouveauCommerce`, `src/data/defaults.ts`) : `'libre'` explicite.
- Réglages > Règles du jeu (`src/pages/Reglages.tsx`) : les deux modes sont des radios, et
  un récapitulatif en clair (`resumeModeAcces`, `src/lib/reglagesRoue.ts`, `data-recap-mode-acces`)
  dit le mode effectif et sa conséquence pour le client — y compris quand le réglage n'a
  jamais été choisi (le mode par défaut s'applique alors, et le récapitulatif le dit).

| Mode | Ce que vit le client qui scanne le QR |
| --- | --- |
| `libre` | Il joue dès qu'il s'est identifié, 1 tirage par jour. Pied de page : « 1 tirage par jour. Tirage effectué par le serveur. » |
| `visite` | Il voit l'écran d'attente (`MessageSansVisite`, `src/pages/Jouer.tsx` : « Pour débloquer la roue », étapes de validation, revérification toutes les 10 s — la roue se débloque seule dès que la visite est validée). Sans validation au comptoir le jour même, il ne peut pas jouer. Pied de page : « 1 participation par visite validée au comptoir, 1 tirage par jour. » |

## 2. Asian Home : état vérifié et limite de la vérification

**Vérifié dans le code et la graine** (`src/data/seed.json`, commerce `c-asian-home-paris`) :
le commerce semé n'a **aucune clé `modeAccesRoue`** — donc mode effectif `'visite'` au moment
de l'initialisation du serveur (la graine n'est copiée qu'à la première initialisation ;
ensuite, seule une modification dans Réglages change la valeur en direct).

**Non vérifiable depuis cette VM** : la valeur **actuelle en production**. Le commerçant (ou
l'équipe) a pu la changer dans Réglages depuis l'initialisation, et la base de production
n'est pas lisible d'ici. La valeur de production reste donc **« présumée `visite`, non confirmée »**
tant qu'une des deux confirmations ci-dessous n'a pas été faite.

**Confirmer la valeur de production (au choix) :**

1. **Dans le produit** : ouvrir Réglages > Règles du jeu sur la production — le
   récapitulatif affiche le mode effectif en clair (« Mode actuel : … ») et précise si le
   réglage n'a jamais été choisi.
2. **Dans Supabase** (dashboard, projet de production, éditeur SQL — table `commerces`,
   colonne JSONB `donnees`, voir `server/stockage-supabase.ts`) :
   ```sql
   select donnees->>'modeAccesRoue' as mode_acces_roue
   from commerces
   where id = 'c-asian-home-paris';
   ```
   `NULL` = jamais choisi → effectif `'visite'`. `'libre'` / `'visite'` = valeur enregistrée.

## 3. Mesurer l'attente réelle (si le mode confirmé est `visite`)

L'audit demande de mesurer le temps entre scan et validation avant de décider. Les données
existent déjà : chaque client porte `creeLe` (identification) et `visites[]` (visites
validées, dates ISO). L'instrument est `delaiValidationVisite` (`src/lib/roulette.ts`) :
minutes entre `creeLe` et la première visite validée **le même jour calendaire** ; `null`
quand il n'y a rien à mesurer (aucune visite ce jour-là, client identifié un autre jour,
ou visite antérieure à l'identification).

**Extraction depuis la production** (même projet Supabase, table `clients`, `donnees` JSONB) :
```sql
select donnees->>'creeLe' as identifie_le,
       donnees->'visites' as visites
from clients
where donnees->>'commerceId' = 'c-asian-home-paris';
```
Puis appliquer la règle de `delaiValidationVisite` à chaque ligne (première visite du même
jour que `creeLe`, en minutes) et regarder la médiane et le pire cas sur une semaine de
service.

**État honnête : aucune mesure réelle à ce jour.** Aucune donnée de production n'est lisible
depuis cette VM ; la mesure reste à faire sur les données ci-dessus.

**Repère de décision (à trancher avec le commerçant, pas dans ce document) :** si la
médiane dépasse ~10 minutes, ou si des clients restent bloqués sans validation (aucune
visite le jour de leur identification), le mode `visite` coûte des parties — basculer en
`libre` se fait en un clic dans Réglages > Règles du jeu (radio « Libre », Enregistrer) :
le serveur relit le mode à chaque statut de jeu, sans migration ni déploiement.

## 4. Changer le mode

Réglages > Règles du jeu > « Accès à la roue », choisir le mode, Enregistrer. Le PATCH
envoie `modeAccesRoue` (validation serveur : `'libre'` ou `'visite'`, sinon 400 —
`server/app.ts`). Effet immédiat sur les statuts de jeu suivants ; les gains déjà attribués
ne sont pas touchés.

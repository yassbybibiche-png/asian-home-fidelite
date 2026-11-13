# FIX-409 — rapport : transitions de commande bloquées en production

Mission du 13/11/2026 (soir), suite du cycle 3 (lot 4, §5 du journal) : la commande TEST de production
(`01c587bf-5457-43a9-9a2d-dffa44fa0da5`, 1× Pad Thaï 13,90 €, « TEST — ne pas préparer ») refusait toutes ses
transitions — 409 « modifiée par ailleurs » — alors que sa jumelle transitait en 200 sur le staging.
**Corrigé, déployé et prouvé en production le même soir.**

## Cause racine (établie par élimination, sur données réelles, en lecture seule)

- Les deux valeurs (production bloquée / staging fluide) ont été comparées octet par octet via les
  sauvegardes des deux environnements : **deux chaînes JSON canoniques de 373 caractères**, mêmes caractères
  non-ASCII (ï, —, é), aucun doublon de clé (dump meta production : 8 lignes). La donnée est intègre et la
  valeur relue est strictement identique à la valeur stockée des deux côtés.
- Avec une colonne `text`, `UPDATE … WHERE valeur = <valeur relue>` ne peut pas matcher 0 ligne sans écriture
  concurrente — exclue (deux essais espacés, aucun autre écrivain, valeur inchangée avant/après). Les INSERT,
  eux, fonctionnent en production (la commande a été créée, index et idempotence posés), et les lectures aussi.
- Le seul écart compatible avec tous les faits : **dans le projet Supabase de production, `meta.valeur` est
  `jsonb`** (projet créé le 09/11, initialisé à 17:53 UTC, avant que la migration 0001 du dépôt ne la définisse
  en `text` ; le projet test, créé le 11/11 depuis la 0001 finale, est en `text`). Sur une colonne jsonb,
  PostgREST convertit le littéral du filtre `eq` en jsonb : le texte JSON relu devient un **objet**, jamais
  égal à la **chaîne** jsonb stockée → 0 ligne → 409 ; et un texte non-JSON (UUID d'idempotence, date) serait
  rejeté en 22P02. Même code, même client, même forme de donnée — seul le type de colonne diffère.
- Confirmation directe du type : à faire dans le tableau de bord Supabase du projet production
  (`select data_type from information_schema.columns where table_name = 'meta' and column_name = 'valeur';`)
  — inaccessible depuis cette VM (aucune clé de service ni session dashboard), et **inutile au correctif**,
  qui est sûr sous les deux types (ci-dessous). La preuve de production (transitions en 200 sur les mêmes
  données qui donnaient 409) valide le mécanisme : seul le repli « forme encodée » a pu matcher.

## Correctif (code seul, aucune migration) — `server/stockage-supabase.ts`, `majMetaSi`

1. Tentative nominale inchangée : `UPDATE … eq('cle', …).eq('valeur', attendue)` — une requête, atomique.
2. Si 0 ligne **ou** erreur 22P02 : **relecture** de la ligne. Si la valeur en base n'est plus exactement
   `attendue`, le conflit est réel → `false` (jamais d'écriture aveugle).
3. Si elle est toujours `attendue` : réessai avec `eq('valeur', JSON.stringify(attendue))` — la forme
   JSON-encodée de la chaîne, qui est l'égalité jsonb d'une chaîne. Sur une colonne `text`, cette forme ne
   peut pas matcher une autre valeur que celle confirmée par la relecture (l'encodage est toujours plus long
   que la chaîne) : la sémantique du CAS est préservée dans les deux mondes.

Périmètre d'impact : tous les CAS sur `meta` bénéficient du correctif (transitions et index des commandes,
consommation des instants gagnants, version de PIN, reprise d'idempotence) — tous souffraient du même défaut
en production ; seuls les INSERT (créations) fonctionnaient.

## Preuves

- **Reproduction locale** : le faux PostgREST des tests apprend le mode `metaValeurJsonb` (conversion du
  littéral, 22P02). Sans correctif : création 201 puis transition `acceptee` → **409 avec le message exact de
  production**. Avec correctif : les 3 nouveaux tests passent (adaptateur sous les deux types de colonne —
  valeur JSON, « nombre », UUID, conflit réel toujours refusé — et commande complète sur HTTP en mode jsonb).
- **Contre-épreuves par mutation** (3/3 détectées) : retrait du repli → 2 tests jsonb rouges ; repli sans
  encodage JSON → 2 rouges ; retrait de la branche 22P02 → le cas UUID rouge.
- **Suite complète : 1684/1684** (typecheck serveur inclus) ; compteurs README/SCORES mis à jour.
- **Staging** (fusion `60e6a58` sur `autonome/integration`, poussée) : santé OK ; commande neuve (Table 3)
  menée de bout en bout — 201 puis 200/200/200. Aucune régression sur le projet en `text`.
- **Production** (fusion `69e2143` sur `master`, poussée) : santé OK (production, supabase, migrations 4/4).
  Sauvegarde ciblée avant écriture (archive `GET /admin/sauvegarde`, 8 lignes meta, commande TEST présente —
  conservée hors dépôt dans `node_modules/.cache/fix409/`). Puis, par les vraies routes (PIN commerçant) :
  `recue → acceptee` **200**, `→ en_preparation` **200**, `→ servie` **200**. Contrôle final : 1 commande au
  jour, la TEST en `servie`, **0 commande en attente**. Aucune autre commande créée, aucune autre donnée
  touchée.

## État final

- Le parcours commande complet est prouvé **en production** (création lot 4 + transitions ce soir) : le
  module peut être utilisé en salle.
- Reste (hors périmètre, signalé) : confirmer un jour le type de `meta.valeur` dans le dashboard du projet
  production ; si elle est bien jsonb, un `ALTER TABLE … TYPE text` la ramènerait à la 0001 — le correctif
  code rend cette opération optionnelle et non urgente. Archive de sauvegarde toujours non chiffrée
  (`SAUVEGARDE_CLE_CHIFFREMENT` à poser, déjà signalé au cycle 3).

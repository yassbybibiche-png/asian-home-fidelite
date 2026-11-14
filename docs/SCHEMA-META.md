# Table `meta` — type de `valeur` et règle d'écriture (P2-5)

État arrêté le 14/11/2026 (cycle produit 9). La divergence de schéma n'est **pas confirmée directement** :
la requête ci-dessous reste à faire passer par l'utilisateur dans le tableau de bord Supabase du projet
**production** (SQL Editor) :

```sql
select data_type from information_schema.columns where table_name = 'meta' and column_name = 'valeur';
```

## Les faits

- La migration `supabase/migrations/0001_schema_initial.sql` définit `meta.valeur` en **`text`**.
- Le projet Supabase **staging** (créé le 11/11/2026 depuis la 0001 finale) est en `text`.
- Le projet Supabase **production** est **présumé `jsonb`** : projet créé le 09/11/2026, initialisé à 17:53 UTC,
  avant que la 0001 ne fige `valeur` en `text`. Preuve indirecte seulement : lors du FIX-409 (13/11/2026),
  les transitions de commande donnaient 409 en production et 200 sur le staging avec des données octet pour
  octet identiques, et seul le repli « forme JSON-encodée » a fait matcher l'UPDATE conditionnel —
  voir `FIX-409-RAPPORT.md`. Si la requête ci-dessus confirme `jsonb`, un
  `ALTER TABLE public.meta ALTER COLUMN valeur TYPE text` ramènerait la production à la 0001 ; cette
  opération est **optionnelle et non urgente** : le correctif code ci-dessous est sûr sous les deux types.
- Conséquence de la divergence : le staging ne peut pas reproduire un bug de CAS production. La couverture
  repose sur le faux PostgREST des tests en mode `metaValeurJsonb` (`tests/supabase.test.ts`) : conversion du
  littéral de filtre en jsonb, erreur 22P02 sur les textes non-JSON, égalité par la forme JSON-encodée.

## La règle (imposée par `tests/meta-cas-p2-5.test.ts`)

**Toute écriture conditionnelle sur `meta` passe par `majMetaSi`** (comparaison-et-échange sur la valeur
lue, avec le repli FIX-409 : 0 ligne ou 22P02 → relecture → réessai avec la forme JSON-encodée si la valeur
est inchangée). `majMeta` est un upsert « dernier écrit gagne » : il ne sert qu'aux écritures listées
ci-dessous, jamais à une lecture-modification-écriture. Le seul `UPDATE` sur `meta` dans tout `server/` est
celui de `majMetaSi` (`server/stockage-supabase.ts`).

## Inventaire des clés (revue systématique du 14/11/2026)

| Clé | Écriture | Classement |
|---|---|---|
| `initialise` | `majMeta` au démarrage (`server/app.ts`) | Écriture unique, idempotente (même sens si deux démarrages se croisent) |
| `demo` | `majMeta` au démarrage | Idem |
| `secret_desinscription` | `majMeta` à la première lecture | Écriture unique : vol unique en mémoire (`secretDesinscription ??=`, promesse partagée) |
| `google_business:<commerce>` | `majMeta` (`ecrireJetonsGoogle`) | Écriture unique par commerce ; dernier écrit gagne entre deux jeux de jetons **valides** (la rotation côté Google borne le risque : un rafraîchissement concurrent sur d'anciens jetons échoue chez Google avant d'écrire) |
| `logo:<commerce>`, `logo:<commerce>:<version>` | `majMeta` (dépôt du logo) | Écriture unique par commerce ; le pointeur est écrit après les données versionnées, il désigne toujours une version existante |
| `version_pin:<commerce>` | `majMetaSi` (rotation du PIN, en transaction) | CAS |
| `acces_client:<commerce>:<client>` | `majMetaSi` avec réessai (révocation, `server/app.ts`) | CAS — corrigé par le cycle produit 9 : l'ancienne écriture inconditionnelle perdait une révocation sur deux révocations simultanées de la même carte |
| `commande:<commerce>:<id>` | `majMetaSi` (création, `server/commandes.ts`) | CAS (insertion seulement si absente) |
| `commandes:<commerce>:<jour>` | `majMetaSi` avec réessai (index du jour) | CAS |
| `commande-idem:<commerce>:<cle>` | `majMetaSi` (idempotence) | CAS |
| `commandes-purge:<commerce>:<jour>` | `majMetaSi` avec réessai (entrée de purge) | CAS |
| `commandes-purge-faite:<commerce>` | `majMeta` (horodatage de dernière purge) | Horodatage : deux purges concurrentes écrivent toutes deux « maintenant », sans effet |
| `instants:<commerce>:<jour>` | `majMetaSi` (génération et consommation des instants gagnants) | CAS |
| suppressions (`supprimerMeta`) | `DELETE` (purge, idempotence orpheline, suppression RGPD de la version d'accès) | Pas de CAS : une suppression concurrente est sans effet |

Règle de maintenance : toute nouvelle clé `meta` ou tout nouvel appel à `majMeta` doit entrer dans ce tableau
et faire passer le test `tests/meta-cas-p2-5.test.ts` (compteur d'appels `majMeta` et garde-fou source).

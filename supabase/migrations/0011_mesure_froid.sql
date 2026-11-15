-- Asian Home Fidélité — mesure des démarrages à froid : tranches `froid10a30s` / `froidPlus30s` (P3-5, 15/11/2026).
-- À exécuter APRÈS 0008, dans Supabase → SQL Editor. Rejouable (drop constraint if exists + add constraint).
-- Annulation : 0011_mesure_froid.down.sql.
--
-- Élargit seulement le CHECK de `evenements_jour.type` : aucune table créée, aucune fonction touchée, RLS
-- inchangée. Tant que cette migration n'est pas appliquée, le serveur fonctionne : les balises de démarrage à
-- froid sont refusées par la contrainte et ignorées (compteur non incrémenté), le jeu et l'entonnoir sont
-- inchangés. Le tableau de bord le dit : un compteur à 0 alors que des clients attendent, c'est cette
-- migration manquante (protocole : docs/VEILLE-RENDER.md).
--
-- Vérification après application (SQL Editor) :
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'evenements_jour_type_check';
-- attendu : CHECK (type IN ('scan', 'tirage', 'gain', 'clicGoogle', 'froid10a30s', 'froidPlus30s')).

alter table public.evenements_jour drop constraint if exists evenements_jour_type_check;

alter table public.evenements_jour
  add constraint evenements_jour_type_check check (type in ('scan', 'tirage', 'gain', 'clicGoogle', 'froid10a30s', 'froidPlus30s'));

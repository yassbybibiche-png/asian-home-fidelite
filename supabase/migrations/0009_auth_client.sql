-- Asian Home Fidélité — authentification client (P0-S7, 11/11/2026, audit F-03).
-- À exécuter APRÈS 0001 à 0008, dans Supabase → SQL Editor. Rejouable (IF EXISTS / OR REPLACE).
-- Annulation : 0009_auth_client.down.sql. Faire une sauvegarde AVANT (scripts/sauvegarde-base.mjs, server/README.md).
--
-- Ce que P0-S7 range en base, et où :
-- • échecs d'accès client (jeton falsifié, carte d'un autre, lien d'accès invalide, identifiant deviné…) : dans
--   `tentatives_auth` (0006), portée `client`, clé `client-ip:<ip>`. Cette migration élargit la contrainte de la 0006,
--   qui n'acceptait que 'admin' / 'commerce' / 'equipe'. Aucune nouvelle table, aucune donnée client.
-- • version d'accès de chaque carte (révocation de tous ses jetons) : table `meta` existante, clé
--   `acces_client:<commerce>:<client>` → entier. Pas de colonne en plus : la sauvegarde (14 tables) la couvre déjà.
-- • liens d'accès à usage unique déjà utilisés : `sessions_revoquees` (0005), par identifiant de jeton (`jti`).
-- Tant que cette migration n'est pas appliquée, le serveur fonctionne : les échecs d'accès client sont comptés en
-- mémoire seulement (perdus au redémarrage), comme les PIN sans la 0006.

alter table public.tentatives_auth drop constraint if exists tentatives_auth_portee_check;
alter table public.tentatives_auth
  add constraint tentatives_auth_portee_check check (portee in ('admin', 'commerce', 'equipe', 'client'));

-- Marqueur lu par le serveur (GET /api/v1/sante → `authClient.migration`) : aucune donnée, aucun effet de bord.
create or replace function public.auth_client_active() returns boolean
  language sql
  stable
  set search_path = ''
as $$ select true $$;

-- Postgres donne EXECUTE à PUBLIC par défaut : retiré, seul service_role l'appelle (comme incrementer_evenement, 0008).
revoke execute on function public.auth_client_active() from public, anon, authenticated;
grant execute on function public.auth_client_active() to service_role;

-- ---------- RLS : même modèle que 0002 à 0008 (RLS activée, AUCUNE policy, seul service_role a des droits) ----------
alter table public.tentatives_auth enable row level security;

revoke all on table public.tentatives_auth from anon, authenticated;
grant select, insert, update, delete on table public.tentatives_auth to service_role;

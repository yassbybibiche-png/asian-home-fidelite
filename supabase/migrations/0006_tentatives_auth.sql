-- Asian Home Fidélité — anti-bruteforce persistant des PIN / codes équipe (P0-S2, 10/11/2026, audit F-06).
-- À exécuter APRÈS 0001 à 0005, dans Supabase → SQL Editor. Rejouable (IF NOT EXISTS).
-- Annulation : 0006_tentatives_auth.down.sql.
--
-- Un compteur d'échecs par clé : `ip:<ip>` (tous secrets confondus) ou `cible:<commerceId>` / `cible:admin` (toutes IP
-- confondues, contre l'attaque distribuée). Le serveur y relit le blocage en cours après un redémarrage ou un réveil
-- Render. Aucun PIN, aucun code, aucun contact client : la clé, le type de secret visé (`portee`), le nombre d'échecs,
-- la fin du blocage et la date du dernier échec. Le serveur supprime au passage les lignes inactives depuis 7 jours.
-- Tant que cette migration n'est pas appliquée, le serveur fonctionne : les échecs sont alors comptés en mémoire
-- (perdus au redémarrage, comme avant P0-S2).

create table if not exists public.tentatives_auth (
  cle                text primary key,
  portee             text not null check (portee in ('admin', 'commerce', 'equipe')),
  echecs             integer not null check (echecs >= 0),
  bloque_jusqu_a     timestamptz,
  derniere_tentative timestamptz not null
);
create index if not exists tentatives_auth_derniere on public.tentatives_auth (derniere_tentative);

-- ---------- RLS : même modèle que 0002 à 0005 (RLS activée, AUCUNE policy, seul service_role a des droits) ----------
alter table public.tentatives_auth enable row level security;

revoke all on table public.tentatives_auth from anon, authenticated;
grant select, insert, update, delete on table public.tentatives_auth to service_role;

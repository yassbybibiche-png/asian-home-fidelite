-- Asian Home Fidélité — révocation des jetons de session (P0-S1, 10/11/2026).
-- À exécuter APRÈS 0001 à 0004, dans Supabase → SQL Editor. Rejouable (IF NOT EXISTS).
-- Annulation : 0005_sessions_revoquees.down.sql.
--
-- Les jetons de session (POST /api/v1/sessions) sont signés par le serveur (SESSION_SECRET) et expirent seuls
-- (8 h gérant / admin, 12 h équipe). Cette table ne garde que les jetons fermés AVANT leur expiration
-- (« Verrouiller ») : identifiant du jeton (`jti`, uuid) + fin de validité. Aucun PIN, aucun jeton complet.
-- Le serveur supprime au passage les lignes déjà expirées. Tant que cette migration n'est pas appliquée,
-- le serveur fonctionne : la révocation reste alors en mémoire (perdue à un redémarrage — le jeton expire de toute façon).

create table if not exists public.sessions_revoquees (
  jti       text primary key,
  expire_le timestamptz not null
);
create index if not exists sessions_revoquees_expire_le on public.sessions_revoquees (expire_le);

-- ---------- RLS : même modèle que 0002 / 0003 / 0004 (RLS activée, AUCUNE policy, seul service_role a des droits) ----------
alter table public.sessions_revoquees enable row level security;

revoke all on table public.sessions_revoquees from anon, authenticated;
grant select, insert, update, delete on table public.sessions_revoquees to service_role;

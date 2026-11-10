-- Asian Home Fidélité — mesure anonyme : compteurs d'événements par jour (P2-Q3, 10/11/2026).
-- À exécuter APRÈS 0001 à 0007, dans Supabase → SQL Editor. Rejouable (IF NOT EXISTS / OR REPLACE).
-- Annulation : 0008_mesure.down.sql.
--
-- Un compteur par (commerce, jour à Paris, type d'événement) : `scan` (ouverture de la page de jeu), `tirage`, `gain`,
-- `clicGoogle` (tap sur le bouton d'avis Google). AUCUNE identité : pas de client, pas de contact, pas d'IP, pas
-- d'appareil, pas d'heure — seulement un nombre par jour. Rien à supprimer lors d'une demande RGPD d'un client.
--
-- L'incrément passe par la fonction `incrementer_evenement` (insert … on conflict do update set n = n + 1) : atomique,
-- deux événements simultanés ne se perdent pas. Elle est réservée à service_role (le serveur), comme les tables.
--
-- Tant que cette migration n'est pas appliquée, le serveur fonctionne : les événements sont ignorés (rien n'est
-- compté), le tableau de bord affiche l'entonnoir vide avec « migration 0008 à appliquer ». Le tirage n'en dépend pas.

create table if not exists public.evenements_jour (
  commerce_id text not null references public.commerces (id) on delete cascade,
  jour        date not null,                               -- jour à Paris, calculé par le serveur
  type        text not null check (type in ('scan', 'tirage', 'gain', 'clicGoogle')),
  n           integer not null default 0 check (n >= 0),
  primary key (commerce_id, jour, type)
);

create or replace function public.incrementer_evenement(p_commerce_id text, p_jour date, p_type text)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.evenements_jour (commerce_id, jour, type, n) values (p_commerce_id, p_jour, p_type, 1)
  on conflict (commerce_id, jour, type) do update set n = public.evenements_jour.n + 1;
$$;

-- ---------- RLS : même modèle que 0002 à 0007 (RLS activée, AUCUNE policy, seul service_role a des droits) ----------
alter table public.evenements_jour enable row level security;

revoke all on table public.evenements_jour from anon, authenticated;
grant select, insert, update, delete on table public.evenements_jour to service_role;

-- Postgres donne EXECUTE à PUBLIC sur toute nouvelle fonction : retiré, puis rendu au seul service_role.
revoke all on function public.incrementer_evenement(text, date, text) from public, anon, authenticated;
grant execute on function public.incrementer_evenement(text, date, text) to service_role;

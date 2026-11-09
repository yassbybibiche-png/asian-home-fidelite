-- Asian Home Fidélité — modules caisse / points / équipe / messages / menu (09/11/2026).
-- À exécuter APRÈS 0001_schema_initial.sql et 0002_rls.sql, dans Supabase → SQL Editor. Rejouable (IF NOT EXISTS).
--
-- AUTONOME depuis le correctif du 09/11/2026 (voir section ci-dessous) : la 0003 ne dépend plus de la 0001.
-- En production, la base live n'avait jamais reçu l'intégralité de la 0001 (fonction incrementer_version()
-- et triggers de version absents — 1re exécution d'un ancien schéma, puis ajout manuel de la colonne `ordre`),
-- et la 0003 a échoué avec « function public.incrementer_version() does not exist » (42883).
--
-- Ce qui ne demande PAS de nouvelle table : points, échanges, messages et anniversaire du client vivent dans
-- `clients.donnees` (JSONB, comme les tampons) ; taux de points, catalogue, règles de messages et apparence de la carte
-- dans `commerces.donnees`. Seuls l'équipe, le journal d'audit et le menu ont leur table.

-- ---------- autonomie : fonction de version + triggers manquants éventuels (correctif 09/11/2026) ----------
-- Corps identique à celui de 0001. CREATE OR REPLACE : sans effet si la fonction existe déjà avec le même corps.
-- Les triggers commerces / clients / avis sont recréés de façon idempotente (DROP IF EXISTS + CREATE) : si la base
-- live ne les a pas, la concurrence optimiste du serveur (UPDATE … WHERE version = lue) est affaiblie sans eux.
create or replace function public.incrementer_version() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.version := old.version + 1;
  return new;
end
$$;
revoke all on function public.incrementer_version() from public, anon, authenticated;

drop trigger if exists commerces_version on public.commerces;
create trigger commerces_version before update on public.commerces
  for each row execute function public.incrementer_version();
drop trigger if exists clients_version on public.clients;
create trigger clients_version before update on public.clients
  for each row execute function public.incrementer_version();
drop trigger if exists avis_version on public.avis;
create trigger avis_version before update on public.avis
  for each row execute function public.incrementer_version();

-- ---------- équipe : membres + code à 4 chiffres (haché + salé par le serveur, jamais en clair) ----------
create table if not exists public.equipe (
  id          text primary key,
  ordre       bigint generated always as identity,
  commerce_id text not null references public.commerces (id) on delete cascade,
  donnees     jsonb not null,                            -- MembreEquipe (id, commerceId, nom, creeLe) — SANS le code
  code_hash   text not null,
  code_sel    text not null,
  version     integer not null default 1,
  constraint equipe_donnees_id check (donnees ->> 'id' = id and donnees ->> 'commerceId' = commerce_id),
  constraint equipe_sans_code check (not (donnees ? 'code'))
);
create index if not exists equipe_commerce on public.equipe (commerce_id);

-- ---------- journal d'audit : qui (membre / gérant), quel client, quelle action, quand ----------
create table if not exists public.journal (
  id          text primary key,
  commerce_id text not null references public.commerces (id) on delete cascade,
  date        timestamptz not null,
  donnees     jsonb not null,                            -- EntreeJournal
  constraint journal_donnees_id check (donnees ->> 'id' = id and donnees ->> 'commerceId' = commerce_id)
);
create index if not exists journal_commerce on public.journal (commerce_id, date desc);

-- ---------- menu digital : un menu par commerce ----------
create table if not exists public.menus (
  commerce_id text primary key references public.commerces (id) on delete cascade,
  donnees     jsonb not null,                            -- Menu (catégories, produits, prix en centimes, photos, allergènes)
  version     integer not null default 1,
  constraint menus_donnees_id check (donnees ->> 'commerceId' = commerce_id)
);

drop trigger if exists equipe_version on public.equipe;
create trigger equipe_version before update on public.equipe
  for each row execute function public.incrementer_version();
drop trigger if exists menus_version on public.menus;
create trigger menus_version before update on public.menus
  for each row execute function public.incrementer_version();

-- ---------- RLS : même modèle que 0002 (RLS activée, AUCUNE policy, seul service_role a des droits) ----------
alter table public.equipe  enable row level security;
alter table public.journal enable row level security;
alter table public.menus   enable row level security;

revoke all on table public.equipe, public.journal, public.menus from anon, authenticated;
grant select, insert, update, delete on table public.equipe, public.journal, public.menus to service_role;

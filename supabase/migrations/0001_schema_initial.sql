-- Asian Home Fidélité — schéma Postgres pour Supabase (phase S1).
-- Équivalent du schéma SQLite de `server/stockage.ts` : chaque objet métier reste rangé tel quel en JSONB
-- (`donnees`, forme de `src/types.ts`) ; les colonnes à côté servent aux recherches et aux contraintes.
-- Rejouable : CREATE … IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- À exécuter dans Supabase → SQL Editor (ou `supabase db push`), AVANT `0002_rls.sql`.

-- ---------- meta : drapeaux d'initialisation (« initialise », « demo ») ----------
create table if not exists public.meta (
  cle    text primary key,
  valeur text not null
);

-- ---------- commerces ----------
-- PIN commerçant : SHA-256 + sel aléatoire (calculés par le serveur), jamais en clair, jamais dans `donnees`.
create table if not exists public.commerces (
  id       text primary key,
  ordre    bigint generated always as identity,          -- ordre d'insertion (SQLite : rowid)
  donnees  jsonb not null,                               -- Commerce
  pin_hash text not null,
  pin_sel  text not null,
  version  integer not null default 1,                   -- incrémentée à chaque UPDATE (trigger plus bas)
  constraint commerces_donnees_id check (donnees ->> 'id' = id)
);

-- ---------- clients ----------
-- `cle_contact` = cleContact() de `src/lib/fidelite.ts`, calculée par le serveur (0033 / +33 / 06… → 06…,
-- e-mail en minuscules). L'unicité (commerce, contact) est garantie PAR LA BASE : anti-doublon même en cas
-- de double inscription simultanée.
create table if not exists public.clients (
  id          text primary key,
  ordre       bigint generated always as identity,
  commerce_id text not null references public.commerces (id) on delete cascade,
  cle_contact text not null,
  donnees     jsonb not null,                            -- Client
  version     integer not null default 1,                -- verrou optimiste (visite / récompense simultanées)
  constraint clients_commerce_contact_unique unique (commerce_id, cle_contact),
  constraint clients_donnees_id check (donnees ->> 'id' = id and donnees ->> 'commerceId' = commerce_id)
);

-- ---------- tirages (roulette) ----------
create table if not exists public.tirages (
  id          text primary key,
  commerce_id text not null references public.commerces (id) on delete cascade,
  client_id   text not null references public.clients (id) on delete cascade,
  date        timestamptz not null,
  donnees     jsonb not null,                            -- Tirage
  constraint tirages_donnees_id check (donnees ->> 'id' = id and donnees ->> 'clientId' = client_id)
);
create index if not exists tirages_client on public.tirages (commerce_id, client_id);

-- 1 tirage par client et par jour, GARANTI PAR LA BASE : un 2e tirage le même jour (heure de Paris), même envoyé
-- au même instant par deux requêtes, est rejeté (erreur 23505 → 409 côté serveur).
-- Le jour est calculé en Europe/Paris, comme le serveur (TZ=Europe/Paris forcé dans server/index.ts).
-- Si un jour le fuseau du serveur change, il faut changer aussi cet index.
create unique index if not exists tirages_un_par_jour
  on public.tirages (commerce_id, client_id, ((date at time zone 'Europe/Paris')::date));

-- ---------- avis ----------
create table if not exists public.avis (
  id          text primary key,
  commerce_id text not null references public.commerces (id) on delete cascade,
  date        timestamptz not null,
  donnees     jsonb not null,                            -- Avis
  version     integer not null default 1,
  constraint avis_donnees_id check (donnees ->> 'id' = id)
);
create index if not exists avis_commerce on public.avis (commerce_id, date desc);

-- ---------- version : +1 à chaque modification ----------
-- Le serveur relit `version` puis écrit « … WHERE id = ? AND version = <lue> » : si une autre requête a modifié
-- la ligne entre-temps, 0 ligne modifiée → conflit (409, « réessayez ») au lieu d'écraser son écriture.
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

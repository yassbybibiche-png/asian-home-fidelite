-- Asian Home Fidélité — programme de fidélité, traces d'audit (09/11/2026).
-- À exécuter APRÈS 0001, 0002 et 0003, dans Supabase → SQL Editor. Rejouable (IF NOT EXISTS).
--
-- Ce que la 0004 NE fait PAS : le programme lui-même (paliers, parrainage, niveaux, défis, réserve,
-- rattrapage, offre hebdomadaire, win-back, anniversaire) ne demande AUCUNE nouvelle colonne :
-- la configuration vit dans `commerces.donnees` (`programme`, tout optionnel, défauts côté serveur)
-- et l'état de chaque client dans `clients.donnees` (code de parrainage, paliers, défi, réserve,
-- récompenses en attente, demandes de rattrapage). Un commerce existant sans configuration voit
-- les défauts s'appliquer sans rien casser, et le serveur n'a pas besoin de ces tables pour fonctionner.
--
-- Ce que la 0004 FAIT : deux tables d'audit (même modèle que `journal` en 0003) pour tracer ce qui
-- doit pouvoir être contrôlé après coup — qui a parrainé qui (anti-abus : un seul parrain par filleul,
-- plafond annuel) et quelles visites oubliées ont été signalées. Le serveur écrit dedans au mieux
-- (erreur ignorée tant que la migration n'est pas appliquée, comme pour le journal) ; l'état de
-- référence reste le JSONB, jamais ces tables.

-- ---------- parrainages : un parrainage réussi = 1re visite du filleul ----------
create table if not exists public.parrainages (
  id          text primary key,
  commerce_id text not null references public.commerces (id) on delete cascade,
  parrain_id  text not null,
  filleul_id  text not null,
  date        timestamptz not null,
  donnees     jsonb not null,                            -- Parrainage (id, commerceId, parrainId, filleulId, date, pointsParrain, pointsFilleul)
  constraint parrainages_donnees_id check (donnees ->> 'id' = id and donnees ->> 'commerceId' = commerce_id),
  constraint parrainages_pas_auto_parrainage check (parrain_id <> filleul_id)
);
create index if not exists parrainages_commerce on public.parrainages (commerce_id, date desc);
create index if not exists parrainages_filleul on public.parrainages (filleul_id);

-- ---------- demandes_rattrapage : visites oubliées signalées par les clients ----------
create table if not exists public.demandes_rattrapage (
  id          text primary key,
  commerce_id text not null references public.commerces (id) on delete cascade,
  client_id   text not null,
  date        timestamptz not null,                     -- date de la visite oubliée
  donnees     jsonb not null,                            -- DemandeRattrapage (id, date, montantCentimes, ticket?, statut, creeLe, decideLe?)
  constraint rattrapages_donnees_id check (donnees ->> 'id' = id)
);
create index if not exists rattrapages_commerce on public.demandes_rattrapage (commerce_id, date desc);
create index if not exists rattrapages_client on public.demandes_rattrapage (client_id);

-- ---------- RLS : même modèle que 0002 / 0003 (RLS activée, AUCUNE policy, seul service_role a des droits) ----------
alter table public.parrainages        enable row level security;
alter table public.demandes_rattrapage enable row level security;

revoke all on table public.parrainages, public.demandes_rattrapage from anon, authenticated;
grant select, insert, update, delete on table public.parrainages, public.demandes_rattrapage to service_role;

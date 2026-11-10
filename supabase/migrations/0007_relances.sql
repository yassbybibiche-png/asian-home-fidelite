-- Asian Home Fidélité — journal des envois de relances SMS / e-mail (P1-B3, 10/11/2026).
-- À exécuter APRÈS 0001 à 0006, dans Supabase → SQL Editor. Rejouable (IF NOT EXISTS).
-- Annulation : 0007_relances.down.sql.
--
-- Une ligne par tentative de relance (manuelle ou automatique) : qui (client), quand, quel modèle, quel canal, quel
-- statut (en_cours / envoye / refuse / erreur / non_branche) et pourquoi. Jamais le téléphone, l'e-mail ni le texte du
-- message. Le consentement lui-même reste sur le client (`clients.donnees.consentementRelance`), sans migration.
--
-- Anti-doublon tenu par la base : index unique (commerce, client, modèle, jour à Paris) sur les lignes `en_cours` /
-- `envoye`. Le serveur RÉSERVE la ligne (`en_cours`) avant d'appeler le prestataire : deux clics simultanés, ou deux
-- relances automatiques concurrentes, ne peuvent pas envoyer deux fois la même relance au même client le même jour.
-- Les refus et les erreurs ne bloquent rien (un envoi en erreur peut être retenté).
--
-- Tant que cette migration n'est pas appliquée, le serveur fonctionne : le journal des envois se lit vide, les refus
-- (409 / 501) ne sont pas tracés, et AUCUN envoi réel ne part (503 explicite) — pas d'envoi sans anti-doublon.

create table if not exists public.envois (
  id          text primary key,
  commerce_id text not null references public.commerces (id) on delete cascade,
  client_id   text not null,
  modele      text not null check (modele in ('bienvenue', 'proche', 'inactif', 'anniversaire', 'libre')),
  canal       text not null check (canal in ('sms', 'email')),
  statut      text not null check (statut in ('en_cours', 'envoye', 'refuse', 'erreur', 'non_branche')),
  jour        date not null,                              -- jour à Paris, calculé par le serveur
  date        timestamptz not null,
  donnees     jsonb not null,                             -- EnvoiRelance (src/types.ts)
  constraint envois_donnees_id check (donnees ->> 'id' = id and donnees ->> 'commerceId' = commerce_id)
);
create unique index if not exists envois_un_par_jour
  on public.envois (commerce_id, client_id, modele, jour) where statut in ('en_cours', 'envoye');
create index if not exists envois_commerce on public.envois (commerce_id, date desc);
create index if not exists envois_client on public.envois (commerce_id, client_id, date desc);

-- ---------- RLS : même modèle que 0002 à 0006 (RLS activée, AUCUNE policy, seul service_role a des droits) ----------
alter table public.envois enable row level security;

revoke all on table public.envois from anon, authenticated;
grant select, insert, update, delete on table public.envois to service_role;

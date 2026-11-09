-- Asian Home Fidélité — Row Level Security (phase S1). À exécuter après 0001_schema_initial.sql. Rejouable.
--
-- Modèle d'accès retenu :
-- • Seul le serveur Node (`server/`) parle à la base, avec la clé **service_role** (ou la clé secrète `sb_secret_…`).
--   Ce rôle a l'attribut BYPASSRLS : il n'est pas filtré par RLS. C'est le SERVEUR qui applique les règles métier
--   (PIN commerçant / admin, 1 visite = 1 tampon, visite du jour obligatoire pour jouer…).
-- • Le navigateur ne parle JAMAIS directement à Supabase : il passe par l'API /api/v1 du serveur.
-- • Les rôles `anon` (clé publique / publishable) et `authenticated` n'ont accès à RIEN :
--   RLS activée + AUCUNE policy = tout refusé (lecture comme écriture), et leurs droits SQL sont en plus retirés
--   (double barrière : même une policy ajoutée par erreur plus tard ne suffirait pas à ouvrir les données).
-- • Aucune policy n'est créée dans ce fichier, volontairement. Toute policy ajoutée plus tard doit être justifiée
--   ici en commentaire (et ne jamais ouvrir `clients` : téléphones / e-mails = données personnelles).

alter table public.meta      enable row level security;
alter table public.commerces enable row level security;
alter table public.clients   enable row level security;
alter table public.tirages   enable row level security;
alter table public.avis      enable row level security;

-- Retire les droits que Supabase accorde par défaut à anon / authenticated sur les nouvelles tables de `public`.
revoke all on table public.meta, public.commerces, public.clients, public.tirages, public.avis from anon, authenticated;

-- Droits nécessaires au serveur (déjà accordés par défaut sur Supabase ; répétés pour être explicites).
grant select, insert, update, delete on table public.meta, public.commerces, public.clients, public.tirages, public.avis to service_role;

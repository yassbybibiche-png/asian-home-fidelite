-- Annulation de 0009_auth_client.sql (P0-S7). Rejouable.
-- Supprime seulement les COMPTEURS d'échecs de portée `client` (anti-bruteforce, aucune donnée client : une clé
-- `client-ip:<ip>`, un nombre d'échecs, des dates), sans quoi la contrainte d'origine de la 0006 ne pourrait pas être
-- remise. Les versions d'accès des cartes (`meta`, clés `acces_client:…`) sont GARDÉES : une ré-application de la 0009
-- les retrouve telles quelles (aucun jeton révoqué ne redevient valable).
-- Après cette annulation, un serveur P0-S7 continue de marcher : échecs d'accès client comptés en mémoire seulement.

delete from public.tentatives_auth where portee = 'client';

alter table public.tentatives_auth drop constraint if exists tentatives_auth_portee_check;
alter table public.tentatives_auth
  add constraint tentatives_auth_portee_check check (portee in ('admin', 'commerce', 'equipe'));

drop function if exists public.auth_client_active();

-- Annulation de 0011_mesure_froid : remet le CHECK d'origine (4 types : scan, tirage, gain, clicGoogle).
-- Rejouable (drop constraint if exists + add constraint).
--
-- Refusé par Postgres tant qu'il reste des compteurs `froid10a30s` / `froidPlus30s` : supprimer d'abord ces
-- lignes (compteurs anonymes par jour, rien d'autre n'est touché — voir docs/VEILLE-RENDER.md).

alter table public.evenements_jour drop constraint if exists evenements_jour_type_check;

alter table public.evenements_jour
  add constraint evenements_jour_type_check check (type in ('scan', 'tirage', 'gain', 'clicGoogle'));

-- Annulation de 0010_compteurs_publics.sql (P0-S20) : supprime la table des compteurs publics.
-- Rejouable. Les compteurs en cours sont perdus (ils ne sont que des fenêtres d'une minute) ; le serveur repart
-- alors en mémoire seulement, comme avant P0-S20. Sans effet sur les données métier.
drop table if exists public.compteurs_publics;

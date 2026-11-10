-- Annule 0008_mesure.sql. Seuls les compteurs anonymes disparaissent (aucune donnée client). Le serveur repasse en
-- « migration manquante » : événements ignorés, entonnoir vide, jusqu'à la ré-application de la 0008.
drop function if exists public.incrementer_evenement(text, date, text);
drop table if exists public.evenements_jour;

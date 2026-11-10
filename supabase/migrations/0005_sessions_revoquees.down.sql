-- Annule 0005_sessions_revoquees.sql. Sans danger pour les données métier : seules les révocations de jetons
-- disparaissent (le serveur repasse en révocation en mémoire ; les jetons expirent de toute façon en 8 h / 12 h).
drop table if exists public.sessions_revoquees;

-- Annule 0006_tentatives_auth.sql. Sans danger pour les données métier : seuls les compteurs d'échecs de PIN
-- disparaissent (blocages en cours levés ; le serveur repasse en comptage en mémoire, perdu à chaque redémarrage).
drop table if exists public.tentatives_auth;

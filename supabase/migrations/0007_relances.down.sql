-- Annule 0007_relances.sql. Seul le journal des envois disparaît (aucune donnée client : le consentement est dans
-- `clients.donnees`). Le serveur repasse alors en « migration manquante » : plus aucun envoi réel (503) jusqu'à la
-- ré-application de la 0007.
drop table if exists public.envois;

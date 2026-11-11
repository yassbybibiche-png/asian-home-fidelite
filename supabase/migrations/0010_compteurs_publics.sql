-- Asian Home Fidélité — persistance des compteurs des routes publiques (P0-S20, 11/11/2026, audit F-04, revue Codex point 6).
-- À exécuter APRÈS 0001 à 0009, dans Supabase → SQL Editor. Rejouable (IF NOT EXISTS).
-- Annulation : 0010_compteurs_publics.down.sql. Faire une sauvegarde AVANT (scripts/sauvegarde-base.mjs, server/README.md).
--
-- Ce que P0-S20 range en base, et où : les compteurs des limites publiques (`LIMITES_PUBLIQUES`, `server/app.ts`) —
-- une ligne par clé (`lecture:<ip>`, `carte:<id>`, `inscription:<commerce>:<contact>`, …) avec le début de sa fenêtre
-- d'une minute et son nombre de requêtes. Le serveur les relit au démarrage : un blocage (ou un compteur chaud)
-- survit à un redémarrage ou à un réveil Render. La clé reprend l'identifiant déjà utilisé par l'anti-bruteforce
-- (`tentatives_auth`, 0006) : IP, contact normalisé (téléphone ou e-mail en clair), identifiant de carte — sans nom,
-- sans code gagnant, sans contenu client. Les lignes dont la fenêtre est passée sont supprimées à chaque écriture
-- et au démarrage (purge opportuniste) : aucune ne traîne au-delà de sa minute.
--
-- Coût (mesuré, voir JOURNAL.md P0-S20) : une ligne = 73 à 92 octets de JSON ; le serveur ne persiste qu'un compteur
-- « chaud » (au moins la moitié de son seuil — en trafic normal : zéro écriture, une page qui se recharge toutes les
-- 10 s fait 6 lectures/min pour un seuil de 30). Les écritures ne bloquent jamais la requête (en mémoire d'abord,
-- persistance en arrière-plan, compteur saturé à son seuil, écritures sérialisées par clé) ; la table absente ne fait
-- que revenir à la mémoire, avec un avertissement dès le démarrage.
-- Limite honnête : une seule instance (Render aujourd'hui) — à plusieurs instances, chaque instance garderait ses
-- propres compteurs en mémoire et la base ne ferait que les recharger au redémarrage ; ce n'est pas une limitation
-- distribuée, et l'écriture d'une autre instance peut encore ramener un compteur en arrière. Voir server/README.md
-- (« Anti-abus »).
--
-- Tant que cette migration n'est pas appliquée, le serveur fonctionne : les compteurs sont alors en mémoire seulement
-- (perdus au redémarrage, comme avant P0-S20).

create table if not exists public.compteurs_publics (
  cle   text primary key,                     -- clé du compteur (`<catégorie>:<ip | carte | contact>`, comme en mémoire)
  debut timestamptz not null,                -- début de la fenêtre d'une minute comptée
  n     integer not null check (n >= 0)      -- requêtes dans cette fenêtre
);
create index if not exists compteurs_publics_debut on public.compteurs_publics (debut);

-- ---------- RLS : même modèle que 0002 à 0009 (RLS activée, AUCUNE policy, seul service_role a des droits) ----------
alter table public.compteurs_publics enable row level security;

revoke all on table public.compteurs_publics from anon, authenticated;
grant select, insert, update, delete on table public.compteurs_publics to service_role;

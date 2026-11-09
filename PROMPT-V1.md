# PROMPT V1 — Version finale : backend partagé + API + PIN commerçant

## Contexte
App « Asian Home Fidélité » dans ~/workspace/fideliz-claude/ (Vite + React 19 + TS + Tailwind, 36 tests, README/JOURNAL/BRIEF à lire avant tout). Le client Asian Home Paris est SIGNÉ : ce n'est plus une démo. Blocage n°1 : tout est en localStorage, par navigateur — le commerçant et le client qui scanne le QR ne voient pas les mêmes données. Cette phase construit le backend partagé. Rien d'autre ne change dans l'UI dans cette phase (le front bascule en V2).

## Choix technique imposé (le plus simple qui résout le problème)
- Backend minimal dans `server/` : Node 24, ZÉRO dépendance externe (stdlib uniquement), 1 seule instance pour tous les commerces, pas d'infra par commerce.
- Stockage : essaie d'abord `node:sqlite` (Node 24, fichier unique `data/fidelite.db`, jamais commité — ajoute-le au .gitignore). Si `node:sqlite` n'est pas utilisable dans ce Node (à prouver par un test), replie-toi sur un fichier JSON avec écritures atomiques (fichier tmp + rename) + verrou en mémoire dans le processus. Documente le choix retenu et pourquoi dans `server/README.md`. Ne pas ajouter de dépendance npm pour la base.
- Réutilise la logique pure existante (`src/lib/fidelite.ts`, `roulette.ts`, `avis.ts`, `stats.ts`) côté serveur — ne duplique pas les règles métier (tampons, report, normalisation contact, 1 tirage/jour, visite du jour). Le serveur TypeScript doit tourner avec Node 24 directement (comme les tests `node --test`) ou être compilé par `tsc` ; ne pas casser `npm run build` du front.
- NE CRÉE AUCUN compte, AUCUNE ressource payante, AUCUN service tiers. Pas de Supabase/Firebase dans cette phase : documente-les seulement comme voie de migration future dans `server/README.md` (quand dépasser quelques centaines de clients par commerce / besoin de realtime).

## API à construire (REST, JSON, préfixe /api/v1)
- `GET /api/v1/sante` → `{ ok: true, version, mode }`.
- `GET /api/v1/commerces` → liste publique (id, nom, type, actif, lienGoogle, coordonnees, recompense, seuilTampons, lots, reglesReponseAuto) — JAMAIS les hash PIN.
- `POST /api/v1/commerces` (PIN admin, voir auth) → crée un commerce + définit son PIN commerçant (4 à 6 chiffres). Réutilise `nouveauCommerce` / les défauts existants.
- `GET /api/v1/commerces/:id/etat` (PIN commerçant) → état complet de ce commerce (clients, tirages, avis).
- `POST /api/v1/commerces/:id/clients` (PIN commerçant OU contact public pour l'auto-inscription depuis la page de jeu — voir ci-dessous) → inscrit ou retrouve le client (déduplication par `cleContact`, déjà existante).
- `POST /api/v1/commerces/:id/clients/:clientId/visite` (PIN commerçant) → `validerVisite` côté serveur.
- `POST /api/v1/commerces/:id/clients/:clientId/recompense` (PIN commerçant) → `offrirRecompense` côté serveur.
- `POST /api/v1/commerces/:id/tirages` (PUBLIC, sans PIN) → body `{ contact, prenom? }` : le serveur retrouve/crée le client, VÉRIFIE côté serveur `aVisiteDuJour` + `tirageDuJour` (refus 409 avec message clair sinon), tire le lot côté serveur (`tirerLot`), enregistre le tirage, retourne `{ lot, code }`. Aucun tirage ne doit pouvoir être forgé depuis le navigateur.
- `PATCH /api/v1/commerces/:id` (PIN commerçant) → réglages (nom, lienGoogle, récompense, seuil, lots, règles auto, actif).
- `POST /api/v1/commerces/:id/avis` (PIN commerçant, pour l'ajout manuel / simulation) et `PATCH /api/v1/commerces/:id/avis/:avisId` (PIN commerçant) → applique `appliquerRegles` côté serveur.
- `GET /api/v1/commerces/:id/export.csv` (PIN commerçant) → clients du commerce en CSV (prenom, telephone, email, tampons, visites, derniereVisite, creeLe), encodage UTF-8 avec BOM.
- Toutes les erreurs en JSON `{ erreur: "message clair en français" }` avec les bons codes (400 validation, 401 PIN manquant/faux, 404 inconnu, 409 règle métier refusée).

## Authentification minimale (pas de système lourd)
- PIN commerçant par commerce : 4 à 6 chiffres, stocké côté serveur en hash SHA-256 + sel (jamais en clair, jamais renvoyé). Défini à la création du commerce. Header `X-Commerce-PIN`.
- PIN admin : lu dans la variable d'environnement `ADMIN_PIN` (défaut en développement : documenté dans server/README.md, avec l'avertissement de le changer en production ; jamais de PIN par défaut en production documenté comme acceptable).
- Limite simple anti-bruteforce : après 10 PIN faux en 10 minutes depuis la même IP, 429 pendant 10 minutes (en mémoire, documenté).
- Migration des données : au premier démarrage, le serveur initialise la base avec le commerce Asian Home Paris UNIQUEMENT (coordonnées réelles du seed : 11 rue André Joineau, 93310 Le Pré-Saint-Gervais, 07 82 97 48 01, @asianhomeparis, lien avis direct `https://search.google.com/local/writereview?placeid=ChIJAV70Kqxt5kcRnhPY0L6yaf0`, lots nems/thé/mochi/-10%), SANS les clients/avis/tirages fictifs du seed démo. Les 2 autres commerces de démo ne sont créés que si `DEMO=1` (et alors étiquetés démo). Documente ce comportement.

## Tests (obligatoires, avant de dire que c'est fait)
- Nouveaux tests `tests/serveur.test.ts` (node --test) : démarrer le serveur sur un port éphémère avec une base temporaire, puis avec `fetch` : santé ; création commerce (admin) ; PIN faux → 401 ; inscription + déduplication 0033/+33/06 ; visite → tampon ; récompense avec report ; tirage sans visite → 409 ; tirage avec visite → lot + 2e tirage → 409 ; tirage avec un autre numéro du même client → 409 (anti-doublon) ; export CSV ; persistance après redémarrage du serveur (données retrouvées).
- `npm test` doit rester vert (anciens + nouveaux), `npm run build` OK.
- `npm run serveur` (nouveau script) : démarre le serveur sur `PORT` (défaut 3001) ; `GET /api/v1/sante` doit répondre.

## Livrables de cette phase
- `server/` (code + `server/README.md` : choix base, variables d'environnement exactes, comment démarrer, comment déployer gratuitement — voir ci-dessous, sauvegarde/export, limites honnêtes).
- `server/README.md` doit contenir la procédure de déploiement la plus simple, sans rien créer : 1 instance Node gratuite/peu chère (ex : Render « Free Web Service » ou équivalent — donne les étapes exactes, ce qu'il faut cliquer/créer, et le coût : 0 € sur l'offre gratuite, avec ses limites : veille/endormissement, disque éphémère → export CSV régulier obligatoire). Ne déploie rien toi-même.
- Commit local après vérification. Rien publié, rien poussé sur GitHub, aucune dépense.
- JOURNAL.md : entrée V1 avec ce qui est fait, tests, et ce qui reste ouvert.

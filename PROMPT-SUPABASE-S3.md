# PHASE SUPABASE S3 — Configuration de déploiement déclarative (render.yaml)

Tu travailles dans le dossier `~/workspace/fideliz-claude/` (c'est ton répertoire de travail, ne sors pas de ce dossier). Lis d'abord `server/README.md` (sections Supabase et « Mise en production : Supabase + Render ») et `JOURNAL.md` en entier.

## Contexte
- S1 (`dd162af`) et S2 (`7471459`) sont faites : adaptateur Supabase, migrations, procédure complète. Tests 118/118, build OK.
- Marque : Asian Home Paris, gratuit, aucune marque ni prix Fideliz. **Apple Developer EN SUSPENS — ne touche à rien côté Apple.**
- Règles strictes : ne crée AUCUN compte, AUCUN projet, AUCUNE ressource facturable, ne dépense rien, ne pousse rien sur GitHub, ne publie rien. Aucune vraie clé dans le code ou les logs. Ne pose aucune question.

## Ce que tu fais dans cette phase (petite phase, sois précis)
1. **Crée `render.yaml`** (Blueprint Render, à la racine du dépôt) pour le serveur Node, conforme à la procédure S2 : service web Free, région Frankfurt, `buildCommand: npm ci && npm run build:api`, `startCommand: npm run serveur`, `NODE_VERSION=24`, et les variables d'environnement en `sync: false` (à saisir dans le dashboard Render, jamais de valeur en dur) : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PIN`, `PIN_ASIAN_HOME`. Aucune valeur réelle, aucun secret dans le fichier. Vérifie la syntaxe YAML (le fichier doit être du YAML valide) et documente dans `server/README.md` comment l'utiliser (Render → New → Blueprint → choisir le dépôt → saisir les 4 secrets → Apply).
2. **Vérifie que rien d'autre ne manque pour « il n'y a plus qu'à coller les clés et lancer »** : relis la procédure S2 de bout en bout et corrige toute étape floue, tout libellé de dashboard qui serait périmé ou non vérifié (marque-le « à confirmer à l'écran » si tu ne peux pas le vérifier), et assure-toi que le seed de production (Asian Home vide, 0 client/avis/tirage) est bien ce que le serveur crée sur une base Supabase neuve (vérifie le code, pas seulement la doc).
3. **Tests** : si possible, ajoute un test qui valide le `render.yaml` (YAML valide, commandes et variables attendues présentes, aucun secret en dur). `npm test` doit rester vert, `npm run build` OK.
4. À la fin : `npm test`, `npm run build`, puis `git add -A && git commit -m "Supabase S3 : render.yaml + vérification finale de la procédure"`. Mets à jour JOURNAL.md.
- Résume à la fin : fichiers créés/modifiés, tests, build OK ou non, et ce qui reste à faire côté utilisateur (les clics, dans l'ordre).

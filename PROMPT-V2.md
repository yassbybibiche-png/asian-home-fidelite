# PROMPT V2 — Version finale : front sur données partagées + optimisation maximale

## Contexte
Lire avant tout : ~/workspace/fideliz-claude/README.md, JOURNAL.md (entrée V1 : backend `server/` + API `/api/v1` + PIN), `server/README.md`. La V1 a construit le backend partagé. Cette phase bascule le FRONT sur les données partagées et optimise tout le reste. Ne pas toucher aux règles métier (déjà testées) sauf si un bug est trouvé — alors ajoute un test de non-régression.

## 1. Bascule sur le backend (priorité)
- Nouveau dépôt `depotApi` (dans `src/data/depot.ts` ou nouveau fichier) implémentant la même interface `Depot` côté lecture, avec chargement ASYNC : `VITE_API_URL` (variable d'environnement Vite) pointe vers le serveur ; si elle est absente → mode local actuel (localStorage, étiqueté dans l'UI « Démo locale — données sur cet appareil seulement »).
- `store.tsx` devient asynchrone : état initial = cache localStorage (dernières données connues, étiqueté « hors ligne » si le serveur ne répond pas), puis chargement depuis l'API, puis rechargement périodique (toutes les 10 s) + au retour au premier plan (`visibilitychange`/`focus`) + après chaque action. Conflit : le serveur fait foi (dernier état serveur écrase le cache local) ; documente ce choix.
- Toutes les actions commerçant (inscrire, visite, récompense, réglages, avis, ajout commerce) passent par l'API avec le PIN commerçant ; la page de jeu publique (`#/jouer/:id`) passe par `POST /tirages` (le tirage est tiré côté serveur, jamais dans le navigateur). Garde un comportement gracieux hors ligne : message clair « Serveur injoignable — vérifiez la connexion », aucune fausse réussite.
- Saisie du PIN : écran de déverrouillage simple par commerce (PIN 4-6 chiffres, mémorisé dans ce navigateur via sessionStorage — pas localStorage persistant — avec bouton « Verrouiller » / « Changer de commerce »). Le PIN n'est jamais affiché ni stocké en clair. L'admin multi-commerces demande le PIN admin.
- Onboarding commerce en 2 minutes : le formulaire de création (Admin) doit, en mode API, créer le commerce + définir son PIN en une seule étape, puis ouvrir Réglages. Chronomètre la procédure dans le JOURNAL (nombre de champs, nombre de clics).

## 2. Optimisations demandées
- Recherche Clients : normalise la saisie comme `cleContact` (0033/+33/06/espaces/points/tirets) ET insensible aux accents pour les prénoms. Taper `0612345678` doit retrouver « 06 12 34 56 78 ». Test à ajouter.
- Export CSV : bouton « Exporter (CSV) » sur la page Clients (mode API : téléchargement depuis `/export.csv` ; mode local : génération depuis l'état). Test : contenu CSV vérifié.
- Boutons Copier : vérifiés sur chaque usage existant (message de relance, QR/lien de la page de jeu, code gagnant). `copier()` existe déjà (ui.tsx) avec repli : vérifie qu'il est utilisé partout où on copie, et qu'un retour visuel (« ✓ Copié » / « Copie impossible ») s'affiche. Ne pas prétendre que la copie a réussi si elle a échoué.
- Performance mobile : vérifie la taille du build (`dist/`), aucun appel réseau externe au chargement (pas de Google Fonts ni CDN — tout doit être local), images/logo en initiales (pas de ressource externe). Note les chiffres dans le JOURNAL.
- Rendu 390 px : vérifie le badge « Démo » (déjà corrigé en CSS) et les 10 écrans sur 390×844 — par capture si un navigateur headless est disponible (cherche chromium/firefox/playwright déjà présents ; si aucun, essaie UNE fois une installation légère et documente le résultat ; sinon liste honnêtement comme non vérifié visuellement, sans inventer de capture).
- Formulaires : tous les champs avec label, messages d'erreur en français, boutons ≥ 44 px (déjà en grande partie fait — vérifie, ne régresse pas).

## 3. Mode production vs démo (critique pour le client signé)
- Mode API + `DEMO=0` (défaut serveur) : Asian Home Paris démarre VIDE (0 client, 0 avis, 0 tirage). Aucune donnée fictive ne doit apparaître comme réelle. Le badge « Démo » n'apparaît que si les données viennent du seed démo.
- Mode local / `DEMO=1` : seed démo actuel, avec le bandeau « Démo » explicite partout (déjà en place — vérifie qu'il n'a pas disparu).
- README.md : section « Ce qui est réel / ce qui reste à brancher » mise à jour avec la nouvelle réalité (données partagées réelles en mode API, ce qui reste simulé).

## Tests (obligatoires)
- Ajoute des tests pour chaque nouveau comportement critique : normalisation de la recherche, export CSV (contenu), bascule local/API (dépôt API mocké — ne pas appeler un vrai serveur dans `npm test`), règles de tirage via API mockée.
- `npm test` vert, `npm run build` OK, `npm run preview` + curl HTTP 200.
- Test HTTP réel : `npm run serveur` (V1) + `npm run preview` puis, avec curl, le parcours complet : créer commerce (admin) → inscrire client → valider visite → tirer (tirage serveur) → 2e tirage refusé → export CSV. Consigne la sortie curl dans le JOURNAL (ou un fichier de preuve).

## Livrables de cette phase
- Code front + `server/` inchangé sauf bug trouvé (alors documenté + testé).
- Commit local après vérification. Rien publié, rien poussé, aucune dépense.
- JOURNAL.md : entrée V2 (tests, chiffres perf, captures si faites, restes ouverts).

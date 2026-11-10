# Photos déposées par le commerçant

Dossier de dépôt des photos de plats fournies par Asian Home (photos du restaurant uniquement).

- **Uniquement des photos du restaurant** (prises par l'équipe ou fournies par le commerçant) —
  jamais de photos de clients (Google, avis…), jamais de banque d'images.
- Nom : `plat-<nom-du-plat>.jpg` (minuscules, tirets, sans accents — ex : `plat-love-bao.jpg`).
- `scripts/extraire-photos-menu.py` ne touche PAS à ce dossier (il ne traite que `assets/source/menu.pdf`).
- Rattachement **à la main**, après vérification visuelle que la photo montre bien le plat :
  convertir en WebP dans `public/visuels/` (fiche ≤ 720 px de large, vignette ≤ 192 px), puis renseigner
  `photo` / `photoVignette` du plat dans `src/data/menu-reel.ts` et documenter la source dans
  `public/visuels/SOURCES.md`. En cas de doute sur le plat montré : ne pas rattacher.

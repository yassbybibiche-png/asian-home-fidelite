# PHASE 1 (suite) — Fideliz : finir le squelette, build vert, commit

Tu travailles dans `~/workspace/fideliz-claude/`. Lis `BRIEF.md`, `PLAN.md`,
`JOURNAL.md` et `PROMPT-PHASE1.md`. Le squelette existe déjà (Vite + React 19 +
TS + Tailwind 4, pages TableauDeBord, Clients, Roulette, Avis, Reglages).
**Le build échoue** : `src/App.tsx` importe `./pages/Offre`, `./pages/Admin` et
`./pages/Plus` qui n'existent pas encore.

## À faire (uniquement ceci)
1. Crée les 3 pages manquantes, en français, mobile-first, cohérentes avec le
   code existant (même store localStorage, mêmes composants UI) :
   - **Offre** (`src/pages/Offre.tsx`) : 90 € TTC/mois, 12 mois d'engagement,
     500 € TTC de mise en place + contenu (2 500 flyers, étiquettes de table QR,
     adhésif vitrine 100 × 70 cm). Mention « Démo — aucune souscription réelle ».
   - **Admin** (`src/pages/Admin.tsx`) : liste des commerces (nom, type, statut
     actif/inactif, nombre de clients, nombre d'avis), ajout d'un commerce en
     1 formulaire court (nom + type + lien Google, valeurs par défaut sensées),
     bascule de commerce actif, activation/désactivation, bouton
     « Réinitialiser la démo » (restaure le seed).
   - **Plus** (`src/pages/Plus.tsx`) : page simple qui regroupe les liens restants
     (QR vitrine du commerce actif, Offre, Admin, À propos / ce qui est simulé).
2. Vérifie que la navigation (App.tsx / router.ts) mène bien à toutes les pages.
3. Lance `npm run build` et corrige toutes les erreurs jusqu'à ce qu'il passe.
   Lance aussi `npm run preview` en arrière-plan et vérifie avec curl que la page
   répond (code 200) ; arrête le preview ensuite.
4. `git add -A && git commit -m "Phase 1 : squelette + socle Fideliz"`.
5. Mets à jour JOURNAL.md (phase 1 terminée, build OK, ce qui reste pour la phase 2).

## Règles strictes
- Aucune clé API réelle, aucun envoi réel. Tout local (localStorage).
- Ne crée aucun dépôt GitHub, ne pousse rien, ne publie rien, ne dépense rien.
- Ne pose aucune question : tranche toi-même, consigne dans JOURNAL.md.
- Résume à la fin : fichiers créés, build OK ou non, comment lancer (`npm run dev`).

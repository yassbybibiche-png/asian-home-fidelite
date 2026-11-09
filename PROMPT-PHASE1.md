# PHASE 1 — Fideliz : squelette + socle (app web, 1 produit, tous commerces)

Tu travailles dans le dossier `~/workspace/fideliz-claude/` (c'est ton répertoire de
travail, ne sors pas de ce dossier). Lis d'abord `BRIEF.md` et `PLAN.md` en entier.

## Ce que tu construis dans cette phase
Une app web statique, **en français, mobile-first** (priorité téléphone), avec :
- Stack : Vite + React + TypeScript + Tailwind. `npm install && npm run build` doit passer.
- Modèle de données (types TypeScript + persistance localStorage, seed en JSON) :
  Commerce { id, nom, type, logo?, lienGoogle, recompense, seuilTampons, lots[], reglesReponseAuto },
  Client { id, commerceId, prenom, telephone/email, tampons, derniereVisite, creeLe },
  Tirage { id, commerceId, clientId, lot, date }, Avis { id, commerceId, auteur, note, texte, date, reponse? }.
- Seed réaliste de **3 commerces** : un restaurant, un salon de coiffure, une boutique
  (noms français plausibles, chacun ~8-12 clients avec tampons et visites variées,
  ~5-8 avis, quelques tirages roulette).
- Navigation simple (barre de navigation bas de page sur mobile, onglets) :
  **Tableau de bord** (4 chiffres : clients actifs, visites ce mois, avis ce mois,
  taux de retour + derniers avis + derniers gains roulette), **Clients** (liste simple),
  **Roulette** (page d'attente — le jeu arrive en phase 2, mets un écran "bientôt" propre),
  **Avis**, **Réglages**, **Offre**, **Admin**.
- **Réglages commerce** : un seul formulaire (nom, type de commerce — liste libre :
  restaurant, salon, boutique, boulangerie, garage, autre —, logo optionnel en URL ou
  initiales, lien Google, récompense fidélité en texte libre, seuil de tampons,
  lots de la roulette en texte libre, interrupteurs réponse auto). Sauvegarde en localStorage.
- **Page Offre** : reprend la fiche — 90 € TTC/mois, 12 mois d'engagement,
  500 € TTC de mise en place et son contenu (2 500 flyers, étiquettes de table QR,
  adhésif vitrine 100 × 70 cm). Mention « Démo — aucune souscription réelle ».
- **Admin multi-commerces** : liste des commerces (nom, type, statut actif/inactif,
  nombre de clients, nombre d'avis), ajout d'un commerce en 1 formulaire court
  (nom + type + lien Google, le reste avec des valeurs par défaut sensées),
  bascule de commerce actif, activation/désactivation.
- Sélecteur de commerce en haut de l'app (on change de commerce en 1 tap).
- Design : sobre, orange comme la fiche Fideliz (#FF5A00 environ) + blanc/gris,
  gros boutons adaptés au tactile, textes lisibles sur téléphone.

## Règles strictes
- Aucune clé API réelle, aucun paiement, aucun envoi SMS/email. Tout est local (localStorage).
- Ne crée aucun dépôt GitHub, ne pousse rien, ne publie rien, ne dépense rien.
- Ne pose aucune question : tranche les détails toi-même et note tes choix dans JOURNAL.md.
- À la fin : `npm install`, `npm run build` (corrige jusqu'à ce que ça passe),
  puis `git add -A && git commit -m "Phase 1 : squelette + socle Fideliz"`.
- Mets à jour JOURNAL.md avec ce que tu as fait et ce qui reste.
- Résume à la fin : fichiers créés, build OK ou non, comment lancer (`npm run dev`).

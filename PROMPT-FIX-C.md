# Phase FIX-C — Mineurs 2 à 6 + préservation des brouillons humains

Tu travailles dans le dépôt `~/workspace/fideliz-claude/` (app web Vite + React 19 + TypeScript + Tailwind, « Asian Home Fidélité »).
Contexte à lire avant tout : `~/workspace/fideliz-test-codex/RAPPORT-CODEX.md` (MINEURS 2 à 6 + réserve brouillon 5★), `src/data/seed.json` (champ `lienGoogle` d'Asian Home Paris), `src/pages/Avis.tsx`, `src/lib/avis.ts`, `src/components/ui.tsx` (`BadgeDemo`), `src/pages/Offre.tsx`, `src/pages/TableauDeBord.tsx`, `src/store.tsx`, `tests/logique.test.ts`.
Règles intangibles : marque toujours Asian Home Paris, jamais Fideliz ; offre toujours « Gratuit » ; ne rien publier, ne rien pousser sur GitHub, ne créer aucun dépôt, ne dépenser rien. Travaille seul, sans poser de question.
État : les phases FIX-A et FIX-B sont censées être déjà appliquées et commitées — vérifie par `git log --oneline -5` et lis le code actuel avant de toucher quoi que ce soit ; ne refais pas FIX-A / FIX-B.

## MINEUR 2 — Lien avis Google indirect
Problème : `lienGoogle` d'Asian Home Paris est une recherche Google Maps (`/maps/search/?api=1&query=...`), pas le lien direct pour laisser un avis, alors que les libellés disent « Laisser un avis Google » / « Ouvrir la fiche Google ».
- Cherche le vrai lien direct « laisser un avis » : format `https://search.google.com/local/writereview?placeid=<PLACE_ID_GOOGLE>` — il faut le Place ID Google (commençant par `ChIJ...`) de l'établissement. Essaie de le retrouver depuis les sources publiques du restaurant (sa fiche Google, son site / linktr.ee https://linktr.ee/asianhomefrance). N'INVENTE JAMAIS un Place ID : si tu ne trouves pas de Place ID vérifiable, NE mets PAS de lien writereview.
- Si le lien direct est trouvé et vérifiable : mets-le dans le seed (et dans les valeurs par défaut si le même lien y figure) et garde les libellés.
- Si introuvable : garde un lien Maps mais RENOMME les libellés honnêtement partout (« Voir la fiche Google » pour la fiche, et dans l'invitation après jeu : « Voir la fiche Google pour laisser un avis » ou équivalent — jamais « Laisser un avis Google » si le lien n'ouvre pas directement le formulaire). Documente le choix dans le README et le JOURNAL (lien direct non retrouvé, à récupérer depuis la fiche Google Business du restaurant).

## MINEUR 3 — « Réponse publiée automatiquement » alors que rien n'est publié
Dans `Avis.tsx`, remplacer le libellé par une formulation honnête, ex. : « Réponse automatique préparée (démo — rien n'est publié sur Google) ». Vérifie qu'aucun autre libellé de l'app n'affirme une publication réelle (grep « publié » / « publiée » dans `src/`).

## MINEUR 4 — Modèle d'avis négatif affirmant une transmission non réalisée
Dans `avis.ts`, retirer « Votre retour a été transmis à toute l'équipe » (aucun envoi n'existe). Remplacer par une formulation sans affirmation d'envoi, ex. : « Nous prenons votre retour très au sérieux et nous allons en parler en équipe. » Ajouter un test qui vérifie que le modèle négatif ne contient ni « transmis » ni « envoyé ».

## MINEUR 5 — Badge « Démo » coupé sur l'offre mobile
Sur mobile 390 px, le badge « Démo » dans l'en-tête de la page Offre est coupé (« Dém » + « o »). Corriger : `BadgeDemo` ne doit jamais rétrécir (`shrink-0`, `whitespace-nowrap`) et l'en-tête (`EnTete`) doit laisser la place au badge (titre en `min-w-0`). Vérifie visuellement le rendu à 390 px de large (capture d'écran si un navigateur headless est disponible, sinon vérifie le CSS et dis-le).

## MINEUR 6 — Contraste insuffisant « Note sans commentaire »
`text-gray-400` (≈ 2,6:1 sur blanc) sur « Note sans commentaire » (`Avis.tsx`, `TableauDeBord.tsx`). Passer à une couleur atteignant au moins 4,5:1 sur blanc (ex. `text-gray-500`, ≈ 4,8:1 — vérifie le ratio et indique-le). Ne touche pas aux placeholders de champs (contexte différent).

## Réserve — brouillon humain 5★ écrasé par la réponse auto
Dans `appliquerRegles` (`avis.ts`) : si un avis a déjà un brouillon humain, la réponse auto ne doit JAMAIS l'écraser — le brouillon est préservé (la réponse auto ne s'applique qu'aux avis sans brouillon ni réponse). Applique la même règle dans `store.tsx` (`avecReglesAppliquees` / réapplication des règles au changement de réglages). AJOUTER un test : avis 5★ avec brouillon humain + auto5 activé → le brouillon est conservé, aucune réponse auto.

## Vérification et livraison
1. `npm test` : tous verts — donne le nombre exact de tests.
2. `npm run build` OK.
3. Mets à jour `JOURNAL.md` (dont : lien Google direct trouvé ou non, et pourquoi) et le README si un libellé / parcours change.
4. Commit : `git add -A && git commit -m "Fix mineurs 2-6 + préservation des brouillons humains"` (ou message équivalent).
5. Réponds avec un résumé court : pour chaque point (mineurs 2, 3, 4, 5, 6 + réserve), corrigé ou non + preuve (tests ajoutés, `npm test`, `npm run build`, capture 390 px si faite). Signale honnêtement ce qui resterait ouvert (notamment le lien Google direct si introuvable).

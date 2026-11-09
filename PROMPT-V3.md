# PROMPT V3 — Version finale : intégrations réelles (prêtes à brancher, sans tricher) + vérification finale

## Contexte
Lire avant tout : README.md, JOURNAL.md (entrées V1 + V2), `server/README.md`. V1 = backend partagé + API + PIN. V2 = front sur données partagées + optimisations. Cette phase prépare les intégrations réelles et fait la vérification finale. NE JAMAIS prétendre qu'une intégration fonctionne alors qu'elle n'est pas branchée : tout ce qui reste simulé reste étiqueté « à brancher » dans l'UI et le README.

## 1. Wallet — APPLE EN SUSPENS (décision utilisateur 09/11 13h27 : « Laisse Apple developer en suspens »)
- **Apple Wallet : EN SUSPENS, ne pas poursuivre.** Aucun endpoint de génération de pass Apple, aucune signature de pass, aucune création de compte, aucune dépense, et ne pas demander le compte Apple Developer à l'utilisateur ou au client. Le bouton Wallet existant (ui.tsx) RESTE simulé et étiqueté comme tel, exactement comme avant. Documente seulement l'architecture prête si besoin (ce qu'il faudrait : compte Apple Developer 99 $/an, Pass Type ID, certificat de signature, clé privée, endpoint de mise à jour des passes) dans `server/README.md` et README.md, en précisant « en suspens — à activer sur décision explicite ».
- **Google Wallet : architecture prête seulement, sans compte.** Côté serveur (`server/`), ajoute `GET /api/v1/commerces/:id/clients/:clientId/pass.json` (PIN commerçant) qui retourne la charge utile NON SIGNÉE du pass Google Wallet « Generic pass » équivalent (issuer placeholder explicite, prénom, tampons x/seuil, récompense, QR vers `#/carte/:id`). Le endpoint doit répondre 501 avec un message clair TANT QUE la configuration est absente — ne jamais renvoyer un pass en prétendant qu'il est réel. Ne crée aucun compte émetteur Google Wallet.
- Côté front, le bouton Wallet existant devient : « Ajouter à Wallet — à brancher » avec une explication honnête + un lien vers la carte publique (QR) en attendant. Aucun bouton ne doit promettre un ajout réel.
- Tests : structure du payload Google (champs présents, tampons corrects, QR correct), 501 sans config, et un test qui vérifie qu'aucun pass Apple (`.pkpass`) n'est généré (aucun code de signature Apple ne doit exister).
- `server/README.md` + README.md : prérequis EXACTS à lister (Apple — en suspens : voir ci-dessus ; Google : compte Google Wallet émetteur, clé de service, API activée). Ne crée aucun de ces comptes.

## 2. Avis Google — réel, sans faux avis
- Ne jamais afficher de faux avis comme réels : en mode production (API, DEMO=0), la page Avis d'Asian Home démarre VIDE avec l'explication « Connectez Google Business Profile pour importer vos avis » (pas d'avis fictifs).
- Ajoute une page/section « Connecter Google » (Réglages ou Avis) qui explique les étapes exactes : compte Google du commerce, API Google Business Profile à activer, OAuth (scopes exacts à lister : `business.manage` — vérifie les scopes actuels dans la doc et cite-les), consentement, puis import. Sans identifiants, l'écran affiche « à brancher » et rien n'est importé. Aucun appel Google réel sans identifiants.
- Le lien direct « laisser un avis » (déjà en place, placeid ChIJAV70Kqxt5kcRnhPY0L6yaf0) reste le moyen réel de collecter des avis en attendant.
- Tests : en mode production, 0 avis fictif ; en mode démo, les avis sont étiquetés « Démo — avis simulés » (déjà fait — vérifie).

## 3. SMS / e-mail — branchements préparés, aucun envoi prétendu
- Côté serveur, une interface d'envoi `server/notifications/` avec deux adaptateurs STUB (Twilio/SMS et Brevo ou SendGrid/e-mail) : sans clé configurée, l'appel retourne 501 « à brancher » et n'envoie rien. Avec clé (variables d'environnement documentées), le code est prêt — mais ne configure AUCUNE clé, n'envoie AUCUN message réel dans cette phase.
- Côté front, les relances restent « copier-coller » tant qu'aucun prestataire n'est configuré, avec la mention « Envoi SMS/e-mail à brancher ». Le message de relance existant est conservé.
- README.md : prestataires recommandés (le plus simple, prix indicatifs publics si tu les connais — sinon « à vérifier sur le site du prestataire », ne pas inventer de prix), consentement marketing et lien de désinscription à prévoir (RGPD), variables d'environnement exactes.

## 4. Vérification finale
- Rejoue TOUT : `npm test` (doit être vert, note le nombre total), `npm run build` OK, parcours HTTP complet avec curl (V2) refait après V3, `npm run preview` + curl HTTP 200.
- Rendu 390 px : nouvelle tentative de capture (même consigne que V2 : cherche un navigateur headless, une tentative raisonnable, sinon liste honnêtement).
- Relis le README : chaque affirmation « réel » doit être vraie en mode API, chaque « simulé / à brancher » doit être étiqueté dans l'UI. Corrige toute formulation trompeuse trouvée (ex : ne plus jamais dire « publié » pour une réponse non publiée).
- RGPD / mentions : ajoute dans l'UI (Plus / Offre) et le README un bloc court : données collectées (prénom + téléphone/e-mail), finalité (fidélité), conservation, export/suppression sur demande au commerçant, hébergement (à préciser selon le déploiement choisi : UE de préférence).

## Livrables de cette phase
- Code + tests + README.md et JOURNAL.md à jour (section « Ce qui est réel / ce qui reste à brancher » avec la LISTE EXACTE des identifiants/comptes encore nécessaires : Google Business Profile, Apple Developer, Google Wallet émetteur, prestataire SMS/e-mail, hébergement backend, nom de domaine — avec, pour chacun, qui doit le fournir : utilisateur ou client).
- Commit local après vérification. Rien publié, rien poussé sur GitHub, aucune dépense, aucun compte créé.
- JOURNAL.md : entrée V3 avec tests, preuves, et la liste des restes ouverts / non vérifiés.

# Wallet Apple / Google — état au 10/11/2026 (P1-C3)

**Aucun pass Wallet n'existe.** Rien n'est simulé : la carte publique (`#/carte/<id>`) affiche un encart replié
« Carte Wallet : bientôt » (une ligne, détail au toucher), sans bouton d'ajout. En attendant, le client garde sa carte
avec la **PWA** (« Ajouter à l'écran d'accueil » : manifest + service worker, lot P1-C3) et son **lien court** `/c/<id>`.

## Pourquoi ce n'est pas faisable aujourd'hui

| Wallet | Blocage | Code dans le repo |
| --- | --- | --- |
| Apple Wallet | **En suspens par décision de l'utilisateur (09/11/2026).** Exige un compte Apple Developer payant. | `server/wallet-apple.ts` : fabrication réelle d'un `.pkpass` (manifeste SHA-1, signature CMS, zip), **branchée sur aucune route** (404) ; refuse sans certificat. Jamais testé avec un vrai certificat. |
| Google Wallet | **Aucun compte émetteur Google Wallet.** | `server/wallet.ts` : charge utile « Generic pass » + JWT signé RS256 ; `GET /commerces/:id/clients/:clientId/pass.json` répond **501** tant que la configuration manque. Aucun appel réel à Google n'a été fait. |

## Ce qu'il faudrait pour brancher

### Google Wallet
1. Compte **émetteur** dans la console Google Pay & Wallet → identifiant émetteur → variable `GOOGLE_WALLET_ISSUER_ID`.
2. Projet Google Cloud avec l'**API Google Wallet** activée.
3. **Compte de service** + clé JSON, déposée en *Secret File* sur Render → `GOOGLE_WALLET_SERVICE_ACCOUNT_FILE`.
4. Approbation de Google pour publier les passes (passage du mode démo au mode production de l'émetteur).
5. Développement restant (non écrit) :
   - bouton « Ajouter à Google Wallet » sur la carte publique (aujourd'hui volontairement absent) — route publique à
     créer, la route `pass.json` actuelle est réservée au commerçant ;
   - **mise à jour de l'objet du pass à chaque tampon** (API REST `genericObject`), sinon le pass reste figé.
6. Coût : à vérifier sur la documentation Google au moment de l'activation.

### Apple Wallet (si la suspension est levée)
1. Décision explicite de l'utilisateur.
2. Compte **Apple Developer Program — 99 $/an** ; Team ID → `APPLE_TEAM_ID`.
3. **Pass Type ID** → `APPLE_PASS_TYPE_ID` ; certificat Pass Type + clé privée PEM → `APPLE_PASS_CERTIFICATE` (+ clé,
   *Secret Files*) ; certificat intermédiaire **Apple WWDR** → `APPLE_WWDR_CERTIFICATE`.
4. Images `icon.png` / `logo.png` (+ `@2x`) — les icônes PWA de `public/icones/` peuvent servir de base.
5. Développement restant (non écrit) : route publique `…/pass.pkpass`, **service web de mise à jour** des passes
   (enregistrement des appareils, `passesUpdatedSince`) et **push APNs** à chaque tampon.

Voir aussi : `server/README.md` (« Apple Wallet — EN SUSPENS », variables d'environnement) et `docs/AUDIT-2026-11-10.md` § d.

Aucune valeur secrète ne figure dans ce fichier.

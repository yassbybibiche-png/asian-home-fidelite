# Domaine personnalisé — proposition et démarche (P2-Q4, 10/11/2026)

> **Rien n'a été acheté ni configuré.** Ce document propose la solution la moins chère et décrit les étapes ; la
> décision et l'achat reviennent au restaurant. Les prix ont été relevés le 10/11/2026 (sources en bas) et **changent
> souvent** : revérifier sur la page du bureau d'enregistrement au moment d'acheter.

Aujourd'hui l'app est servie à `https://asian-home-fidelite.onrender.com` (sous-domaine gratuit de Render, certificat
HTTPS inclus). Un domaine à soi (ex. `asianhome.fr`) n'est **pas nécessaire** pour que l'app marche ; il apporte une
adresse plus courte et plus crédible sur les QR, les affiches et la fiche Google, et une adresse qui ne dépend pas de
l'hébergeur (changer d'hébergeur un jour sans réimprimer les QR).

## Comparatif (prix par an, relevés le 10/11/2026)

| Option | 1re année | Renouvellement | Remarques |
| --- | --- | --- | --- |
| **`.fr` chez OVHcloud** | ≈ 4,99 € HT (≈ 5,99 € TTC) | ≈ 7,79 € HT (≈ 9,35 € TTC) | Relevé de tiers (blogs datés 31/08 et 24/10/2026), page officielle non lue (délai dépassé) — **à vérifier**. DNS OVH gratuit. Le `.fr` (AFNIC) exige un titulaire résidant / établi dans l'UE : c'est le cas du restaurant. |
| `.com` chez Cloudflare Registrar | ≈ 10,46 $ avant le 01/11/2026, ≈ 11,17 $ après | idem (prix coûtant, sans marge) | Prix coûtant officiel ; chiffres exacts de costgoat.com (20/10/2026) — **à vérifier**. Impose le DNS Cloudflare. **Ne vend pas le `.fr`** (absent de la liste officielle des extensions). |
| `.com` chez Namecheap | ≈ 6,79 à 9,58 $ (promo) | ≈ 13,98 à 14,78 $ | Agrégateurs (domainoffer.net, vendr.com), **à vérifier**. |
| `.com` chez OVHcloud | ≈ 7,99 € HT | ≈ 13,49 à 14,29 € HT | Blogs, chiffres divergents — **à vérifier**. |
| Domaine personnalisé sur **Render** | 0 € | 0 € | Le plan Hobby inclut **2 domaines personnalisés** (0,25 $/mois au-delà) ; certificat TLS créé et renouvelé automatiquement (doc Render). Render ajoute et redirige automatiquement la forme `www` / racine ; savoir si elle compte comme 2e domaine est **à vérifier** dans le tableau de bord (2 domaines inclus suffisent de toute façon). |

**Recommandation : un `.fr` chez OVHcloud + domaine personnalisé gratuit sur Render, soit ≈ 6 € TTC la 1re année puis
≈ 9,35 € TTC/an.** Le `.fr` est le moins cher à l'usage, parle à une clientèle locale et n'est de toute façon pas
proposé par Cloudflare. Si un `.com` est préféré, Cloudflare Registrar est le moins cher au renouvellement (prix
coûtant, ≈ 10 €/an).

Pièges à éviter : les prix « 1re année » d'appel (renouvellement souvent 2 à 3× plus cher), les options payantes
proposées au panier (hébergement web, e-mail, « SSL » — inutiles ici : Render fournit le certificat), la protection
« Whois » payante (inutile pour un `.fr` : l'AFNIC masque déjà les données des particuliers ; pour une société les
coordonnées sont publiques de toute façon).

## Démarche pas à pas (exemple `asianhome.fr`, à adapter)

1. **Choisir et vérifier le nom** sur ovhcloud.com (disponibilité). Commander **le domaine seul**, sans hébergement.
   Titulaire : le restaurant (raison sociale / SIRET), avec une adresse e-mail qu'il consulte (alertes d'expiration).
   Activer le **renouvellement automatique**.
2. **Render → service web → Settings → Custom Domains → Add** : saisir `asianhome.fr`. Render ajoute aussi
   `www.asianhome.fr` et redirige l'une vers l'autre ; il affiche les enregistrements DNS attendus.
3. **OVH → Domaines → Zone DNS** :
   - supprimer les enregistrements `A` / `AAAA` par défaut d'OVH (page de parking) sur la racine et sur `www` — Render
     demande explicitement de retirer tout `AAAA` (il ne sert qu'en IPv4) ;
   - racine : `A` → `216.24.57.1` (valeur donnée par la doc Render pour les DNS sans ALIAS/ANAME ; reprendre celle
     affichée par Render si elle diffère) ;
   - `www` : `CNAME` → `asian-home-fidelite.onrender.com.`
   - désactiver toute « redirection web » OVH sur le domaine (elle entre en conflit avec ces enregistrements).
4. **Attendre la propagation** (quelques minutes à quelques heures), vérifier avec `dig asianhome.fr` /
   `dig www.asianhome.fr` ou dnschecker.org, puis cliquer **Verify** dans Render. Le certificat HTTPS est émis
   automatiquement.
5. **Mettre l'app à l'heure du nouveau domaine** (un commit + variables Render) :
   - `index.html` (canonical, `og:url`, `og:image`, `twitter:image`, JSON-LD `url` / `logo` / `image` / `hasMenu`),
     `public/robots.txt` (ligne `Sitemap:`) et `public/sitemap.xml` (`<loc>`) : remplacer
     `https://asian-home-fidelite.onrender.com` par `https://asianhome.fr` — `tests/seo-p2-q4.test.ts` vérifie qu'une
     seule adresse est utilisée dans ces trois fichiers (adapter sa constante `SITE` et son motif `onrender.com`) ;
   - variables d'environnement Render : `CORS_ORIGIN=https://asianhome.fr`, `PUBLIC_URL=https://asianhome.fr`
     (liens des SMS / e-mails, QR des passes Wallet, webhook Twilio STOP → mettre à jour l'URL du webhook chez Twilio),
     et `GOOGLE_REDIRECT_URI` si elle est renseignée (+ la déclarer à l'identique dans la console Google Cloud) ;
   - `Strict-Transport-Security` : `preload` reste désactivé (server/app.ts) — ne l'activer qu'après réflexion, c'est
     difficilement réversible.
6. **Ce qui continue de marcher** : l'adresse `asian-home-fidelite.onrender.com` reste active chez Render, donc les QR
   et cartes déjà imprimés / installés fonctionnent toujours. Les QR générés par l'app utilisent l'adresse de la page
   ouverte (`window.location.origin`) : ouverts depuis le nouveau domaine, ils l'encodent. Les cartes enregistrées sur
   l'écran d'accueil (PWA) et les données locales (`localStorage`) sont **liées à l'adresse** : un client qui passe au
   nouveau domaine retrouve sa carte via le serveur (lien de sa carte), pas via le stockage local.
7. **Après la bascule** : mettre le nouveau site dans la fiche Google Business Profile (champ « Site web »),
   Instagram (bio) et linktr.ee ; ajouter le domaine dans Google Search Console (validation par enregistrement DNS
   `TXT` chez OVH) et y soumettre `https://asianhome.fr/sitemap.xml`.

Coût total estimé : **≈ 6 € TTC la première année, ≈ 9,35 € TTC les suivantes** (à vérifier), Render et le
certificat restant gratuits.

## Sources (consultées le 10/11/2026)

- Render — Custom domains : https://render.com/docs/custom-domains (2 domaines inclus en Hobby, 0,25 $/mois au-delà,
  TLS automatique, redirection www ↔ racine automatique).
- Render — Configuring DNS for other providers : https://render.com/docs/configure-other-dns (`A 216.24.57.1`,
  `CNAME` vers `<service>.onrender.com`, retirer les `AAAA`).
- Cloudflare Registrar : https://www.cloudflare.com/products/registrar/ (prix coûtant) ; extensions :
  https://www.cloudflare.com/tld-policies/ (`.com` oui, `.fr` non).
- Prix `.com` Cloudflare (hausse Verisign 10,26 → 10,97 $) : https://costgoat.com/compare/domains/com
- Prix OVH `.fr` / `.com` (relevés tiers) : https://ibrahimkamara.com/blog/nom-de-domaine-ovh ,
  https://hackceleration.com/fr/labs/meilleur/nom-de-domaine — page officielle à vérifier :
  https://www.ovhcloud.com/fr/domains/tld/fr/
- Prix Namecheap `.com` : https://domainoffer.net/tld/com/namecheap , https://www.vendr.com/marketplace/namecheap

Voir aussi `docs/SEO.md` (balises en place et limites du routeur par fragment).

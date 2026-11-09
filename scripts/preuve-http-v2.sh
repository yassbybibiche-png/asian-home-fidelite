#!/usr/bin/env bash
# Parcours HTTP réel (V2), avec curl : `npm run serveur` (port 3001) et `npm run preview` (port 4173) doivent tourner.
# Usage : bash scripts/preuve-http-v2.sh > preuves/http-v2.txt
# PIN admin de développement « 000000 » (serveur lancé sans ADMIN_PIN). Crée un commerce de test « Preuve V2 … ».
# Note (09/11/2026) : ce script n'a PAS été lancé tel quel pendant la phase V2 (les scripts bash étaient refusés
# dans la session) ; les mêmes appels curl ont été lancés un par un — sortie réelle : PREUVE-HTTP-V2.txt.
set -u
API=${API:-http://localhost:3001/api/v1}
FRONT=${FRONT:-http://localhost:4173}
ADMIN=${ADMIN:-000000}
J='Content-Type: application/json'

etape() { printf '\n### %s\n' "$*"; }
montre() { printf '$ %s\n' "$*"; }

echo "Preuve HTTP V2 — $(date -Iseconds)"

etape "Front compilé (npm run preview)"
montre "curl -s -o /dev/null -w '%{http_code}' $FRONT/"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' "$FRONT/"

etape "Santé du serveur"
montre "curl -s $API/sante"
curl -s "$API/sante"; echo

etape "1. Créer un commerce (PIN admin) avec son PIN commerçant, en une requête"
NOM="Preuve V2 $(date +%H%M%S)"
montre "curl -s -X POST $API/commerces -H 'X-Admin-PIN: ******' -d '{\"nom\":\"$NOM\",\"type\":\"restaurant\",\"pin\":\"4321\"}'"
R=$(curl -s -w '\nHTTP %{http_code}' -X POST "$API/commerces" -H "X-Admin-PIN: $ADMIN" -H "$J" -d "{\"nom\":\"$NOM\",\"type\":\"restaurant\",\"pin\":\"4321\"}")
echo "$R" | cut -c1-300
ID=$(echo "$R" | head -1 | sed -E 's/.*"id":"([^"]+)".*/\1/')
echo "→ commerce $ID"

etape "2. Inscrire un client (PIN commerçant)"
montre "curl -s -X POST $API/commerces/$ID/clients -H 'X-Commerce-PIN: ****' -d '{\"prenom\":\"Linh\",\"contact\":\"06 12 34 56 78\"}'"
R=$(curl -s -w '\nHTTP %{http_code}' -X POST "$API/commerces/$ID/clients" -H 'X-Commerce-PIN: 4321' -H "$J" -d '{"prenom":"Linh","contact":"06 12 34 56 78"}')
echo "$R"
CL=$(echo "$R" | head -1 | sed -E 's/.*"client":\{"id":"([^"]+)".*/\1/')
echo "→ client $CL"

etape "2b. Tirage AVANT la visite → refusé (409)"
montre "curl -s -X POST $API/commerces/$ID/tirages -d '{\"contact\":\"0612345678\"}'"
curl -s -w '\nHTTP %{http_code}\n' -X POST "$API/commerces/$ID/tirages" -H "$J" -d '{"contact":"0612345678"}'

etape "2c. Carte publique (ajout V2) : statut du jeu, sans téléphone"
montre "curl -s $API/cartes/$CL"
curl -s -w '\nHTTP %{http_code}\n' "$API/cartes/$CL"

etape "3. Valider la visite (PIN commerçant)"
montre "curl -s -X POST $API/commerces/$ID/clients/$CL/visite -H 'X-Commerce-PIN: ****'"
curl -s -w '\nHTTP %{http_code}\n' -X POST "$API/commerces/$ID/clients/$CL/visite" -H 'X-Commerce-PIN: 4321'

etape "4. Tirer (tirage fait par le serveur, public, autre format du même numéro)"
montre "curl -s -X POST $API/commerces/$ID/tirages -d '{\"contact\":\"+33 6 12 34 56 78\",\"prenom\":\"Linh\"}'"
curl -s -w '\nHTTP %{http_code}\n' -X POST "$API/commerces/$ID/tirages" -H "$J" -d '{"contact":"+33 6 12 34 56 78","prenom":"Linh"}'

etape "5. 2e tirage le même jour → refusé (409)"
montre "curl -s -X POST $API/commerces/$ID/tirages -d '{\"contact\":\"0033612345678\"}'"
curl -s -w '\nHTTP %{http_code}\n' -X POST "$API/commerces/$ID/tirages" -H "$J" -d '{"contact":"0033612345678"}'

etape "5b. Carte publique après le tirage"
curl -s -w '\nHTTP %{http_code}\n' "$API/cartes/$CL"

etape "6. Export CSV (PIN commerçant) — octets de tête (BOM EF BB BF) puis contenu"
montre "curl -s $API/commerces/$ID/export.csv -H 'X-Commerce-PIN: ****'"
curl -s "$API/commerces/$ID/export.csv" -H 'X-Commerce-PIN: 4321' | head -c 3 | od -An -tx1
curl -s -D - "$API/commerces/$ID/export.csv" -H 'X-Commerce-PIN: 4321' | grep -iv '^\(date\|connection\|keep-alive\|access-control\)'

etape "6b. Export CSV sans PIN → 401"
curl -s -w '\nHTTP %{http_code}\n' "$API/commerces/$ID/export.csv"

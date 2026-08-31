#!/bin/bash
# Relais hebdomadaire du feed produits — REPLI tant que le WAF de bordet.fr bloque les IP serveur.
#
# Le CSV n'est PAS téléchargeable depuis les Edge Functions (Cloudflare renvoie 403 aux IP de
# datacenter). Ce script tourne donc depuis un poste en IP résidentielle : il télécharge le feed,
# le compresse et le POUSSE tel quel (octets cp1252) à la fonction `sync-products`, qui garde toute
# l'intelligence (comparaison d'empreintes, embeddings ciblés, purge des fiches retirées).
#
# Dès qu'Oxatis autorisera l'accès serveur, ce script devient inutile : le cron Supabase suffira.
#
# Installation d'un lancement automatique le lundi : voir docs/DEPLOIEMENT.md
# Lancement manuel :  bash scripts/sync_feed_push.sh

set -uo pipefail

PROJECT_REF="yyzfuqebakvgecekfqcw"
FN_URL="https://${PROJECT_REF}.supabase.co/functions/v1/sync-products"
FEED_URL="https://www.bordet.fr/Data/doofinder-all/fr/Oxatis-fr-bordet-38902.csv"
KEY_FILE="${BORDET_KEY_FILE:-/Users/danzin/Downloads/REPOSITORY/BORDET/supabase_key.txt}"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
MAX_ROUNDS=25
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# --- 1. Téléchargement du feed (IP résidentielle : passe le WAF) ---
log "Téléchargement du feed…"
CODE=$(curl -s -o "$TMP/feed.csv" -w '%{http_code}' --max-time 300 "$FEED_URL" \
        -H "User-Agent: $UA" -H "Accept: text/csv,*/*;q=0.8" -H "Accept-Language: fr-FR,fr;q=0.9")
SIZE=$(wc -c < "$TMP/feed.csv" | tr -d ' ')
if [ "$CODE" != "200" ] || [ "$SIZE" -lt 1000000 ]; then
  log "ÉCHEC téléchargement : HTTP $CODE, $SIZE octets — on n'envoie rien (un feed tronqué fausserait la synchro)."
  exit 1
fi
head -c 400 "$TMP/feed.csv" | grep -q '"id";"title"' || { log "ÉCHEC : le fichier reçu n'est pas le CSV Doofinder attendu."; exit 1; }
log "Feed OK : $SIZE octets."
gzip -c "$TMP/feed.csv" > "$TMP/feed.csv.gz"
log "Compressé : $(wc -c < "$TMP/feed.csv.gz" | tr -d ' ') octets."

# --- 2. Jeton d'appel : la fonction accepte la clé service_role (fichier local) ---
TOKEN=""
for T in $(grep -oE 'eyJ[A-Za-z0-9._-]+' "$KEY_FILE" 2>/dev/null); do
  P=$(curl -s -X POST "$FN_URL" -H "Content-Type: application/json" -H "Authorization: Bearer $T" -d '{"ping":true}')
  echo "$P" | grep -q unauthorized || { TOKEN="$T"; break; }
done
[ -n "$TOKEN" ] || { log "ÉCHEC : aucune clé valide dans $KEY_FILE"; exit 1; }

# --- 3. Envoi, puis rebouclage tant qu'il reste des fiches à traiter ---
# (une invocation traite un lot borné ; le diff est recalculé à chaque passage, donc c'est repris tout seul)
for i in $(seq 1 "$MAX_ROUNDS"); do
  R=$(curl -s -X POST "$FN_URL" --max-time 900 \
        -H "Content-Type: application/gzip" -H "Authorization: Bearer $TOKEN" \
        --data-binary "@$TMP/feed.csv.gz")
  log "passe $i : $R"
  echo "$R" | grep -q '"status":"ok"' && { log "Synchronisation terminée."; exit 0; }
  echo "$R" | grep -q '"status":"partial"' || { log "ÉCHEC : réponse inattendue, arrêt."; exit 1; }
done
log "Arrêt après $MAX_ROUNDS passes — il reste du travail, relancer."
exit 1

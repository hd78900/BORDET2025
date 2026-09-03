#!/usr/bin/env python3
"""
Ré-ingestion du corpus PRODUITS depuis le feed Doofinder d'Oxatis (catalogue complet, variantes incluses).

Pipeline : télécharge le CSV -> décode cp1252 -> nettoie (entités HTML, préfixe "Tout savoir…", tabulations)
-> construit le `content` (nom, marque, prix, dispo, description, lien) + metadata -> envoie par lots à
l'Edge Function `ingest-documents` (action `bulk`) qui embedde (clé Mistral serveur) et upsert idempotent
par `source_uid = product:<url>` (écrase proprement les produits déjà présents).

Prérequis : la fonction `ingest-documents` déployée AVEC l'action `bulk`. Compte ADMIN Bordet.

Usage :
  export BORDET_ADMIN_EMAIL="florent.staes@bordet.fr"
  export BORDET_ADMIN_PASSWORD="********"          # sinon demandé de façon masquée
  python3 scripts/ingest_products_feed.py --dry-run --limit 5     # aperçu, aucun envoi
  python3 scripts/ingest_products_feed.py --limit 50              # test réel sur 50 produits
  python3 scripts/ingest_products_feed.py                         # chargement complet (~5500)

Options : --limit N (n premiers produits) · --batch N (taille de lot, défaut 100) · --dry-run · --feed URL
"""
import argparse, csv, io, html, re, json, os, sys, time, getpass, ssl, urllib.request, urllib.error

# CA bundle explicite : les Python python.org sur macOS n'ont pas les certificats système
# (sinon "CERTIFICATE_VERIFY_FAILED"). On s'appuie sur certifi si dispo.
try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    SSL_CTX = ssl.create_default_context()

FEED_URL = "https://www.bordet.fr/Data/doofinder-all/fr/Oxatis-fr-bordet-38902.csv"
SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL", "https://yyzfuqebakvgecekfqcw.supabase.co")
ANON_KEY = os.environ.get("VITE_SUPABASE_ANON_KEY",
    # clé anon PUBLIQUE (présente dans le front) — pas un secret
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5emZ1cWViYWt2Z2VjZWtmcWN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzkxMTY2OTUsImV4cCI6MjA1NDY5MjY5NX0.1AEAitZgXkLZkGobQxTh1FA8_1SeGfqhMuWjyMAiHDI")
BOT_ID = "bot1"
AVAIL = {"in stock": "En stock", "out of stock": "En rupture", "preorder": "En précommande"}

def norm_ws(s):
    return re.sub(r"[ \t]+", " ", (s or "").replace("\xa0", " ")).strip()

def clean_desc(s, title):
    s = html.unescape(s or "").replace("\t", " ").replace("\xa0", " ")
    # retire le préfixe "Tout savoir sur l'article <titre>" : le titre est collé à la description
    # (« ergotsChacun… ») -> on reconstruit le motif à partir des MOTS du titre, tolérant aux espaces.
    words = norm_ws(title).split()
    if words:
        pat = r"^\s*Tout savoir sur l'article\s+" + r"\s+".join(re.escape(w) for w in words) + r"\s*"
        s = re.sub(pat, "", s, count=1, flags=re.I)
    # lead-in générique restant : « Tout savoir sur l'article … » non apparié, ou « Tout savoir sur … »
    # (certaines fiches ré-emploient le nom du produit après, ex. « …sur le combiné d'affûtage Tormek T-8 »)
    s = re.sub(r"^\s*Tout savoir sur (?:l'article\s+)?", "", s, count=1, flags=re.I)
    s = re.sub(r"[ ]{2,}", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()

def _num(v):
    s = (v or "").replace("\xa0", "").replace(" ", "").replace(",", ".")
    try:
        return round(float(s), 2)
    except ValueError:
        return None

# Dans ce feed, `sale_price` porte le prix COURANT de toutes les fiches ; les rares fiches qui
# portent AUSSI un `price` sont celles EN PROMOTION (price = prix barré, sale_price = prix remisé).
# Doit rester aligné sur supabase/functions/sync-products/index.ts, sinon un rechargement manuel
# réécrirait tout le catalogue en perdant les promotions.
def parse_price(r):
    p = _num(r.get("sale_price"))
    return p if p is not None else _num(r.get("price"))

def parse_list_price(r):
    lst, cur = _num(r.get("price")), _num(r.get("sale_price"))
    return lst if (lst is not None and cur is not None and lst > cur) else None

def build_row(r):
    title = norm_ws(r.get("title"))
    link = (r.get("link") or "").strip()
    if not title or not link:
        return None
    url = "https://www.bordet.fr/" + link.lstrip("/")
    brand = (r.get("brand") or "").strip()
    desc = clean_desc(r.get("longDescription"), title)
    price = parse_price(r)
    avail = AVAIL.get((r.get("availability") or "").strip().lower(), (r.get("availability") or "").strip() or None)
    content = title + (f" ({brand})" if brand else "")
    if desc:
        content += f" : {desc}"
    if price is not None:
        content += "\nPrix : " + f"{price:.2f}".replace(".", ",") + " € TTC"
        list_price = parse_list_price(r)
        if list_price is not None:
            pct = round((1 - price / list_price) * 100)
            content += " — EN PROMOTION : au lieu de " + f"{list_price:.2f}".replace(".", ",") + " € TTC"
            if pct > 0:
                content += f", soit -{pct} %"
    if avail:
        content += f" — Disponibilité : {avail}"
    content += f"\nLien : {url}"
    src_uid = f"product:{url}"
    meta = {"source_type": "product", "source": "feed", "title": title, "url": url,
            "brand": brand or None, "sku": (r.get("sku") or "").strip() or None,
            "ean": (r.get("ean") or "").strip() or None, "price": price, "currency": "EUR",
            **({"list_price": parse_list_price(r), "on_promo": True} if parse_list_price(r) is not None else {}),
            "availability": avail, "category": (r.get("product type") or "").strip() or None,
            "image": (r.get("image link") or "").strip() or None,
            "item_group_id": (r.get("item_group_id") or "").strip() or None,
            "source_uid": src_uid, "added_via": "feed", "model": "mistral-embed"}
    return {"source_uid": src_uid, "content": content, "metadata": meta}

def http(method, url, headers, body=None, timeout=180):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as resp:
            return resp.status, json.loads(resp.read() or "null")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}

def login(email, password):
    s, d = http("POST", f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                {"apikey": ANON_KEY, "Content-Type": "application/json"},
                {"email": email, "password": password})
    tok = (d or {}).get("access_token")
    if not tok:
        sys.exit(f"Login échoué (HTTP {s}) : {json.dumps(d)[:200]}")
    return tok

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--batch", type=int, default=100)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--feed", default=FEED_URL)
    args = ap.parse_args()

    print(f"Téléchargement du feed : {args.feed}")
    # UA navigateur : bordet.fr (Oxatis) renvoie 403 aux clients "non navigateur"
    feed_req = urllib.request.Request(args.feed, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/csv,*/*;q=0.8", "Accept-Language": "fr-FR,fr;q=0.9"})
    with urllib.request.urlopen(feed_req, timeout=120, context=SSL_CTX) as r:
        raw = r.read()
    rows = list(csv.DictReader(io.StringIO(raw.decode("cp1252", errors="replace")), delimiter=";"))
    built = [b for b in (build_row(r) for r in rows) if b]
    if args.limit:
        built = built[:args.limit]
    print(f"{len(rows)} lignes CSV -> {len(built)} produits préparés"
          + (f" (limité à {args.limit})" if args.limit else ""))

    if args.dry_run:
        for b in built[:3]:
            print("\n" + "=" * 70 + f"\n{b['source_uid']}\n--- content ---\n{b['content'][:600]}")
        print(f"\n[DRY-RUN] {len(built)} produits prêts, aucun envoi.")
        return

    email = os.environ.get("BORDET_ADMIN_EMAIL") or input("Email admin Bordet : ").strip()
    password = os.environ.get("BORDET_ADMIN_PASSWORD") or getpass.getpass("Mot de passe : ")
    token = login(email, password)
    H = {"Authorization": f"Bearer {token}", "apikey": ANON_KEY, "Content-Type": "application/json"}
    url = f"{SUPABASE_URL}/functions/v1/ingest-documents"

    done = fails = 0
    for i in range(0, len(built), args.batch):
        batch = built[i:i + args.batch]
        for attempt in range(4):
            s, d = http("POST", url, H, {"action": "bulk", "rows": batch, "bot_id": BOT_ID})
            if s == 200 and (d or {}).get("ok"):
                done += d.get("upserted", len(batch)); break
            if s in (429, 500, 502, 503, 504):
                time.sleep(2 * (attempt + 1)); continue
            print(f"  lot {i}-{i+len(batch)} ERREUR {s}: {json.dumps(d)[:160]}"); fails += len(batch); break
        else:
            fails += len(batch)
        print(f"  …{done}/{len(built)} upserted (échecs {fails})")
    print(f"\nTERMINÉ : {done} produits ingérés, {fails} échecs.")

if __name__ == "__main__":
    main()

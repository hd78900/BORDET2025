# Architecture technique

Documentation technique de l'assistant Bordet : modèle de données, pipeline RAG, edge functions et sécurité.

## Sommaire
- [Vue d'ensemble](#vue-densemble)
- [Modèle de données](#modèle-de-données)
- [Pipeline RAG (chat)](#pipeline-rag-chat)
- [Edge Function : mistral-proxy](#edge-function--mistral-proxy)
- [Edge Function : ingest-documents](#edge-function--ingest-documents)
- [Edge Function : analytics](#edge-function--analytics)
- [Anti-hallucination](#anti-hallucination)
- [Visibilité du contenu (public vs marketing)](#visibilité-du-contenu-public-vs-marketing)
- [Sécurité](#sécurité)

---

## Vue d'ensemble

Trois briques Supabase Edge Functions (Deno) portent toute la logique serveur ; le frontend React n'est qu'un client.

| Fonction | Rôle | Auth | Écrit en base |
|---|---|---|---|
| `mistral-proxy` | RAG serveur : chat du widget public + back-office | anon (public) ou JWT | `chat_logs`, budget tokens |
| `ingest-documents` | Ajout/gestion de la base de connaissances | JWT **admin** | `documents` (service_role) |
| `analytics` | Digest IA des conversations + purge RGPD | JWT **admin** | `chat_logs` (service_role) |

Le corpus vectoriel (`bot_id = 'bot1'`) contient ~3 000 chunks : fiches **produits** (1 fiche = 1 chunk), **articles** de blog (fenêtres de 500–800 tokens), **ouvrages** (extraits de livres) et **catalogues** synthétiques par catégorie. Embeddings : **`mistral-embed`, 1024 dimensions, distance cosinus**.

---

## Modèle de données

### `documents` — corpus vectoriel
| Colonne | Type | Note |
|---|---|---|
| `id` | bigserial | PK |
| `bot_id` | text | tenant (`bot1`) |
| `content` | text | **le corps lu par le RAG** ; l'URL y est répétée (« Lien : … » / « Source : … ») pour rester citable |
| `metadata` | jsonb | `source_type`, `title`, `url`, `source_group`, `content_hash`, `raw_body` (chunk 0), `added_via`… |
| `embedding` | vector(1024) | `mistral-embed` |
| `source_uid` | text | clé stable ; **index unique `(bot_id, source_uid)`** (upsert idempotent) |
| `created_at` | timestamptz | |

`metadata.source_type` ∈ `product | article | book | catalog | manual`. Voir [Visibilité](#visibilité-du-contenu-public-vs-marketing).

### RPC de recherche (SECURITY DEFINER)
- **`match_documents(query_embedding, match_count, filter_bot_id)`** — recherche vectorielle simple, bornée, livres exclus pour l'anon.
- **`match_documents_hybrid(query_embedding, query_text, match_count, filter_bot_id, include_books)`** — **recherche hybride** : fusion **RRF (k=60)** d'un rang vectoriel et d'un rang lexical plein-texte français (`plainto_tsquery` en **OU**). Corrige le rappel des produits que le vecteur seul rate (marques diverses, essences de bois nommées). `include_books` n'est vrai qu'en mode marketing (admin authentifié).

### Autres tables
| Table | Rôle |
|---|---|
| `widget_settings` (id=1) | prompts éditables (`client_prompt`, `marketing_prompt`), `chat_model`, kill-switch `proxy_enabled`, titre/message du widget |
| `chat_logs` | journal des échanges (analytics) — voir [analytics](#edge-function--analytics) |
| `daily_token_budget` | circuit-breaker de coût (1 ligne/jour) |
| `user_profiles` | comptes (`is_admin`) |
| `user_bot_access` | droits par bot pour les non-admins |
| `chat_messages` | historique de chat côté back-office authentifié |

---

## Pipeline RAG (chat)

Endpoint : `POST /mistral-proxy/chat`, corps `{ message, mode, history, conversation_id? }`.

1. **Identité & mode** — `mode` ∈ `client | marketing`. `marketing` n'est effectif que si l'appelant est **authentifié** (JWT `role=authenticated`). Le modèle est **forcé côté serveur** : `mistral-medium` (client) / `mistral-large` (marketing), ou le `chat_model` configuré (OpenRouter).
2. **Réservation budget** — `reserve_token_budget` (atomique) ; si le plafond quotidien est atteint ou le kill-switch actif → `503`.
3. **Double retrieval multi-tour** — on embed **le message seul** ET **une requête history-aware** (derniers tours), puis on fusionne en interleave. Évite qu'un sujet précédent dilue la nouvelle question.
4. **Recherche hybride** — `match_documents_hybrid` (fallback `match_documents`), `MATCH_COUNT = 15`, `include_books = marketing`.
5. **Aucun contexte → réponse cannée** — si rien ne remonte, on renvoie un message « pas d'information » **sans appeler le LLM** (jamais de réponse libre).
6. **Assemblage serveur** — prompt (lu dans `widget_settings`, fallback constantes) + contexte étiqueté par chunk : `[PRODUIT — Nom](url)`, `[GUIDE — Titre](url)`, `[EXTRAIT DE LIVRE …]`.
7. **Génération** — via OpenRouter (si `chat_model` contient `/`) ou Mistral. Température 0,1, `max_tokens` bornés.
8. **Sanitization** — `sanitizeUrls` (voir [Anti-hallucination](#anti-hallucination)).
9. **Log** — insertion dans `chat_logs` (best-effort, jamais bloquant) + réconciliation du budget réel.

---

## Edge Function : mistral-proxy

Point d'entrée unique du chat (public + admin). Endpoints :

| Méthode / chemin | Rôle |
|---|---|
| `GET /models` | liste des modèles exposés |
| `POST /chat` | RAG serveur (voir pipeline ci-dessus) |
| `POST /embeddings` | embedding d'une **string unique** (usage interne ; array rejeté) |

Garde-fous : allowlist d'origine (CORS strict), taille de corps bornée, `MAX_USER_CHARS`, historique borné, plafond `DAILY_TOKEN_CAP` (10 M/jour), kill-switch. **Banc d'essai** : un admin authentifié peut forcer `body.model` parmi une allowlist restreinte (le widget public ne le peut jamais → modèle prod intact).

---

## Edge Function : ingest-documents

Gestion de la base de connaissances depuis le back-office. **Auth : `auth.getUser(token)` + `user_profiles.is_admin`** (validation réelle du JWT, indépendante du flag `verify_jwt`). Toutes les écritures se font en **service_role** ; les embeddings via Mistral. Aucun secret n'atteint le navigateur.

Corps : `POST { action, ... }`.

| Action | Entrée | Effet |
|---|---|---|
| `upsert` | `{ type, title, url?, body, brand?, price?, sku?, availability?, force? }` | chunk + injecte l'URL dans `content` + embed + **remplacement idempotent** (delete par `source_group` puis `upsert on_conflict`) |
| `crawl` | `{ url, preview? }` | récupère une page bordet.fr via **Jina** ; `preview:true` renvoie le contenu extrait **sans écrire** (relecture), sinon ingère |
| `clean` | `{ text }` | **nettoyage IA** (mistral-medium, T° 0) : formatage seulement (retire menus/nav/en-têtes, recolle les césures) — **ne modifie aucun chiffre/prix/référence** |
| `get` | `{ source_group }` | renvoie le texte source (`metadata.raw_body`) pour relecture/édition |
| `list` | `{}` | sources ajoutées via l'UI, groupées (champs ciblés, léger) |
| `delete` | `{ source_group }` | supprime tous les chunks d'une source |

**Chunking** : porté depuis `ingest/build_documents.py` (fenêtres 500–800 tokens, léger chevauchement). **Gardes d'ingestion** (block = `400`, warn = `409 {warnings, need_confirm}` → l'UI confirme et renvoie `force:true`) :

- **A. Doublon exact** — `metadata.content_hash` (SHA-1 du corps normalisé) → refus si déjà présent, même sous un autre titre.
- **B. Quasi-doublon sémantique** — sondes vectorielles (1er/milieu/dernier chunk) via `match_documents_hybrid` : ≥ 0,97 refus, 0,90–0,97 avertissement.
- **C. Qualité texte** — trop court, encodage cassé (mojibake) → refus ; ligne répétée → avertissement.
- **D. Cohérence catalogue** — URL morte (HEAD) → avertissement ; prix `€` détecté hors fiche produit → avertissement.

**Crawl** : bordet.fr (plateforme Oxatis) bloque en `403` les IP de datacenter → la récupération passe par le **lecteur Jina** (`r.jina.ai`, mode `X-Return-Format: html`), non bloqué, qui renvoie la page complète (dont `<script id="productData">`). Le HTML est ensuite converti en texte propre (`htmlToText` : décode les entités, `<br>/<li>/<p>` → sauts de ligne/puces, retire les balises), puis passé au nettoyage IA côté front.

---

## Edge Function : analytics

**Auth admin** (idem `ingest-documents`). Modèle « lazy digest » : **pas de cron** — le dashboard appelle `{ action: 'digest' }` à l'ouverture et boucle tant qu'il reste des conversations à traiter. Coût uniquement quand quelqu'un regarde.

Action `digest` :
1. **Purge RGPD** — supprime les `chat_logs` de plus de **90 jours**.
2. **Classification** — les conversations non analysées (posées depuis > 10 min) sont classées par un modèle **économique** (`openai/gpt-5.4-nano` via OpenRouter, fallback `mistral-small`) : `topic` (affûtage, tournage, scies…), `intent` (achat, conseil-technique, commande-sav…), `outcome` (répondu, sans-réponse, insatisfait). Heuristique dure : `no_info ⇒ sans-reponse`.

Le dashboard lit ensuite `chat_logs` **en direct** (RLS `authenticated + is_admin`) pour agréger KPIs, thèmes, produits cités et questions sans réponse.

### Journalisation (`chat_logs`)
Le `mistral-proxy` insère **chaque échange** — **y compris le widget public anonyme** (qui n'était pas journalisé auparavant). Champs notables : `conversation_id`, `origin` (widget/backoffice/playground), `mode`, `model`, `question`, `answer`, `no_info`, `match_count`, `top_similarity`, `sources_cited` (URLs bordet.fr de la réponse), tokens, `latency_ms`, puis `topic`/`intent`/`outcome` (remplis par le digest). **Aucun IP ni identifiant client.**

---

## Anti-hallucination

Trois lignes de défense, toutes **déterministes et côté serveur** :

1. **L'URL est dans le `content`** des chunks (produits/articles) → le modèle la recopie au lieu de l'inventer.
2. **`sanitizeUrls(response, matches)`** (dans `mistral-proxy`) : après génération,
   - toute URL absente des chunks récupérés est **supprimée** ; les liens sont réécrits vers le **vrai titre** du produit ;
   - tout **prix `€`** absent du contexte est neutralisé (« voir le prix sur la fiche produit ») ;
   - toute **référence** (5–7 chiffres) absente du contexte est neutralisée.
3. **Prompt strict** : interdiction d'énoncer un produit/prix/spec non présent littéralement dans le contexte, de citer un concurrent, ou d'affirmer une portée exhaustive.

---

## Visibilité du contenu (public vs marketing)

Il n'y a **qu'une seule base** (`documents`). La visibilité tient à **un seul critère** : `metadata.source_type` **`book` vs le reste**.

```
match_documents_hybrid(...) WHERE source_type <> 'book' OR include_books
```

Le proxy passe `include_books = (mode marketing ET admin authentifié)`.

| `source_type` | Widget public / client | Mode marketing (admin) |
|---|---|---|
| `product`, `article`, `catalog`, `manual` | ✅ | ✅ |
| `book` | ❌ | ✅ |

À l'ajout : **Coller** = sélecteur de type ; **Crawl** = déduit de l'URL (public) ; **PDF** = bascule Public/Marketing (`manual`/`book`).

---

## Sécurité

Durcissement « P0 » appliqué et vérifié en production :

- **RLS fermée** : `DROP POLICY select_documents_anon` + `REVOKE ALL ON documents FROM anon`. La lecture ne passe que par des RPC `SECURITY DEFINER` bornées (`search_path=''`, opérateur `OPERATOR(public.<=>)` pour pgvector).
- **Proxy durci** : modèle forcé serveur, température 0,1, tailles bornées, `/embeddings` string unique, **allowlist d'origine**.
- **Circuit-breaker de coût** : `daily_token_budget` + `reserve_token_budget`/`reconcile_token_budget` (SECURITY DEFINER, réservation atomique pré-appel). Seule mesure qui borne la dépense même après fuite de tout token.
- **Rate-limit par utilisateur** : `rate_limits` + `consume_rate_limit` (fenêtres fixes atomiques). Par **IP hachée** (8 msg/min et 150/jour en anonyme ; 30/min et 1500/jour authentifié) et par **conversation** (40/jour). Vérifié **avant** tout appel payant ; réponse `429`. Fail-open (le plafond global reste le filet). Aucune IP stockée en clair (hash salé, RGPD). La consommation du jour est visible dans `/analytics` (jauge budget).
- **Kill-switch** : `widget_settings.proxy_enabled = false` → `503`.
- **Auth admin serveur** : `ingest-documents` et `analytics` valident le JWT via `auth.getUser` puis vérifient `is_admin` — la protection n'est pas seulement dans l'UI.
- **Prompts éditables** en base (effet immédiat, sans redéploiement) ; les filtres déterministes restent serveur (non altérables par le prompt).
- **RGPD** : purge des transcripts > 90 jours, aucun identifiant client stocké.

**Pistes P1/P2 restantes** (nécessitent des comptes tiers) : rate-limit token-based (Upstash Redis), Cloudflare + Worker devant l'Edge Function, Turnstile→JWT éphémère, modération entrée/sortie, monitoring/alertes.

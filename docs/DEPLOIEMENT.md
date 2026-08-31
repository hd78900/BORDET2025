# Déploiement & exploitation

Procédures pour déployer et maintenir l'assistant Bordet (Supabase + Netlify).

## Sommaire
- [Prérequis](#prérequis)
- [1. Base de données (SQL)](#1-base-de-données-sql)
- [2. Secrets & variables](#2-secrets--variables)
- [3. Edge Functions](#3-edge-functions)
- [4. Frontend (Netlify)](#4-frontend-netlify)
- [Recette](#recette)
- [Exploitation courante](#exploitation-courante)
- [Dépannage](#dépannage)

---

## Prérequis

- Un projet **Supabase** avec l'extension `pgvector` disponible.
- La **CLI Supabase** installée et authentifiée (`supabase login`).
- Un compte **Netlify** relié au dépôt GitHub (auto-deploy sur `main`).
- Des clés **Mistral** et **OpenRouter**.

Dans les commandes ci-dessous, remplacez `$PROJECT_REF` par la référence de votre projet Supabase.

```bash
export PROJECT_REF=xxxxxxxxxxxxxxxxxxxx
```

---

## 1. Base de données (SQL)

Appliquez les migrations du dossier `supabase/migrations/` (schéma, RPC, RLS, durcissement). Deux options :

- **Dashboard Supabase → SQL Editor** : coller/exécuter les scripts (méthode utilisée en production pour le durcissement et les RPC).
- **CLI** : `supabase db push` (si l'historique de migration est cohérent).

Scripts clés à connaître :
- création de `documents` + `pgvector` + RPC `match_documents` ;
- durcissement P0 (RLS fermée, circuit-breaker, kill-switch) ;
- `match_documents_hybrid` (recherche hybride + gating livres) ;
- `chat_logs` (analytics) ;
- `20260706120000_ensure_source_uid_for_ingest.sql` — colonne `source_uid` + index unique **(prérequis de l'upsert de `ingest-documents`)**.

> Les scripts sont **idempotents** (`IF NOT EXISTS`, `CREATE OR REPLACE`) : rejouables sans risque.

---

## 2. Secrets & variables

### Secrets Supabase (Edge Functions)
```bash
supabase secrets set MISTRAL_API_KEY=...      --project-ref $PROJECT_REF
supabase secrets set OPENROUTER_API_KEY=...   --project-ref $PROJECT_REF
# optionnel (quotas crawl) :
supabase secrets set JINA_API_KEY=...         --project-ref $PROJECT_REF
```
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` et `SUPABASE_ANON_KEY` sont **auto-injectés** dans les fonctions.

### Variables Netlify (build front)
Dans **Netlify → Site settings → Environment variables** :
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

> Les `VITE_*` sont **inlinées au build** : après changement, redéployer le site.

---

## 3. Edge Functions

```bash
supabase functions deploy mistral-proxy     --project-ref $PROJECT_REF
supabase functions deploy ingest-documents  --project-ref $PROJECT_REF
supabase functions deploy analytics         --project-ref $PROJECT_REF
supabase functions deploy widget-status     --project-ref $PROJECT_REF
```

Notes :
- L'auth admin de `ingest-documents` et `analytics` est vérifiée **dans le code** (`auth.getUser` + `is_admin`) → le flag `verify_jwt` par défaut convient.
- Un `WARNING: Docker is not running` est **sans effet** (le bundling passe par l'API).

---

## 4. Frontend (Netlify)

Le front se déploie **automatiquement** à chaque push sur `main` :

```bash
git add -A
git commit -m "…"
git push origin main
```

Netlify lance `npm run build` puis publie. Le fichier `public/_redirects` (`/* /index.html 200`) est **requis** pour que les routes profondes (`/widget/:botId`, `/settings`…) fonctionnent en SPA.

---

## Recette

Après un déploiement complet :

1. **Widget public** — poser une question couverte par le corpus → réponse citant des produits avec liens ; question hors-sujet → message « pas d'information ».
2. **Back-office** — se connecter en admin, recharger la page (F5) → **rester connecté**.
3. **Base de connaissances** — ajouter une note (Coller / PDF / Crawl) → relecture → *Ajouter* → la retrouver dans **Gérer** ; tester le doublon (même texte) → refus.
4. **Analytics** — après quelques conversations, ouvrir `/analytics` → KPIs et thèmes se remplissent (la classification IA tourne à l'ouverture).

---

## Synchronisation hebdomadaire du catalogue

Le catalogue produits est ré-alimenté automatiquement depuis le **feed Doofinder d'Oxatis**
(`https://www.bordet.fr/Data/doofinder-all/fr/Oxatis-fr-bordet-38902.csv`, 5 492 fiches) par
l'Edge Function **`sync-products`**, déclenchée par `pg_cron` **chaque lundi à 03:00 UTC**.

**Fonctionnement.** La fonction télécharge le CSV (cp1252), reconstruit chaque fiche exactement comme
`scripts/ingest_products_feed.py`, puis compare une **empreinte SHA-256** du contenu avec celle déjà
en base (RPC `product_feed_fingerprints`). Seules les fiches **nouvelles ou modifiées** sont
ré-embeddées : une semaine sans changement coûte 0 embedding et s'exécute en ~2,5 s.
Les fiches disparues du feed sont supprimées — **uniquement** celles portant `added_via = 'feed'`,
jamais le contenu ajouté à la main via la Base de connaissances.

**Garde-fous.** Purge bloquée si le feed revient anormalement petit (< 3 000 lignes) ; validation que
la réponse est bien le CSV attendu (et non une page d'erreur en HTTP 200) ; exécution bornée à 480
fiches par invocation avec auto-relance (le diff étant recalculé à chaque passage, une interruption
se reprend d'elle-même).

**Suivi.** Table `product_sync_runs` (lecture admin) : `select * from product_sync_runs order by started_at desc limit 10;`

### ⚠️ Repli temporaire : le feed est bloqué côté serveur

La protection **Cloudflare de bordet.fr renvoie 403 à toute IP de datacenter** (vérifié : IP de sortie
AWS `13.39.50.71`, cinq profils d'en-têtes testés, même page d'erreur à chaque fois). La fonction ne
peut donc pas télécharger le feed elle-même pour l'instant, et le cron du lundi échoue.

En attendant qu'Oxatis ouvre l'accès (demande d'exception WAF sur `/Data/doofinder-all/*`), un poste
en **IP résidentielle** relaie le fichier : `scripts/sync_feed_push.sh` télécharge le CSV, le compresse
et le **pousse** à la fonction (qui accepte un corps `application/gzip`), laquelle garde toute son
intelligence. Lancement automatique le lundi 9h30 via `scripts/fr.bordet.sync-products.plist` :

```bash
cp scripts/fr.bordet.sync-products.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/fr.bordet.sync-products.plist
# journal : ~/Library/Logs/bordet-sync-products.log
```

**Le jour où Oxatis aura ouvert l'accès**, le cron du lundi 3h00 réussira tout seul (`product_sync_runs`
affichera un `status = ok` à cette heure-là) : il suffira alors de retirer le relais avec
`launchctl unload ~/Library/LaunchAgents/fr.bordet.sync-products.plist`. Aucun code à modifier.

---

## Exploitation courante

| Besoin | Action |
|---|---|
| **Changer le modèle de chat** | mettre à jour `widget_settings.chat_model` (identifiant OpenRouter). Aucun redéploiement. |
| **Modifier un prompt** | back-office → Paramètres (effet immédiat). |
| **Couper le chatbot** (kill-switch) | `widget_settings.proxy_enabled = false` → le proxy renvoie `503`. |
| **Ajuster le plafond de coût** | constante `DAILY_TOKEN_CAP` dans `mistral-proxy` (puis redéployer). |
| **Après modif d'une Edge Function** | `supabase functions deploy <nom> --project-ref $PROJECT_REF`. |
| **Après modif du front** | `git push origin main` (Netlify redéploie). |
| **Forcer une synchro catalogue** | `bash scripts/sync_feed_push.sh` (ou appeler `sync-products` avec `{"dry_run":true}` pour un essai à blanc). |

---

## Dépannage

| Symptôme | Cause probable / remède |
|---|---|
| Widget : page blanche, `supabaseUrl is required` | `VITE_*` manquantes dans Netlify → les définir puis redéployer. |
| Routes profondes en 404 | `public/_redirects` absent. |
| Chat : `503 Service très demandé` | plafond de tokens atteint **ou** kill-switch actif. |
| Ingestion : `400 contenu identique déjà présent` | garde anti-doublon (comportement normal). |
| Synchro : `feed HTTP 403` | blocage Cloudflare des IP serveur → utiliser le relais `scripts/sync_feed_push.sh` (voir ci-dessus). |
| Synchro : `changed` proche du catalogue entier | les empreintes ne parviennent pas à la fonction — vérifier que `product_feed_fingerprints` renvoie bien un `jsonb` (une TABLE serait tronquée à ~1 000 lignes par PostgREST). |
| Ingestion : `400 lecture de la page impossible / 403` | le crawl passe par Jina ; si Jina est saturé (`429`), réessayer. |
| Édition « Gérer » : contenu vide | source ajoutée avant l'activation de `raw_body` → ré-ajouter le contenu. |
| Déconnexion au rechargement | vérifier la présence du flag `initializing` (session restaurée avant redirection). |

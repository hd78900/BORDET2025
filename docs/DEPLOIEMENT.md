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

## Exploitation courante

| Besoin | Action |
|---|---|
| **Changer le modèle de chat** | mettre à jour `widget_settings.chat_model` (identifiant OpenRouter). Aucun redéploiement. |
| **Modifier un prompt** | back-office → Paramètres (effet immédiat). |
| **Couper le chatbot** (kill-switch) | `widget_settings.proxy_enabled = false` → le proxy renvoie `503`. |
| **Ajuster le plafond de coût** | constante `DAILY_TOKEN_CAP` dans `mistral-proxy` (puis redéployer). |
| **Après modif d'une Edge Function** | `supabase functions deploy <nom> --project-ref $PROJECT_REF`. |
| **Après modif du front** | `git push origin main` (Netlify redéploie). |

---

## Dépannage

| Symptôme | Cause probable / remède |
|---|---|
| Widget : page blanche, `supabaseUrl is required` | `VITE_*` manquantes dans Netlify → les définir puis redéployer. |
| Routes profondes en 404 | `public/_redirects` absent. |
| Chat : `503 Service très demandé` | plafond de tokens atteint **ou** kill-switch actif. |
| Ingestion : `400 contenu identique déjà présent` | garde anti-doublon (comportement normal). |
| Ingestion : `400 lecture de la page impossible / 403` | le crawl passe par Jina ; si Jina est saturé (`429`), réessayer. |
| Édition « Gérer » : contenu vide | source ajoutée avant l'activation de `raw_body` → ré-ajouter le contenu. |
| Déconnexion au rechargement | vérifier la présence du flag `initializing` (session restaurée avant redirection). |

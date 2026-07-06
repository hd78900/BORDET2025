# Déploiement — fonction d'ajout de contenu (base vecto) depuis l'interface

Feature admin « Base de connaissances » : ajouter du contenu dans `documents` (coller du texte,
importer un PDF, crawler une URL bordet.fr) + lister / éditer / supprimer, sans jamais exposer
`service_role` ni la clé Mistral au navigateur.

## Pièces livrées
- **Edge Function** `supabase/functions/ingest-documents/` — embed (Mistral) + écriture (service_role), garde admin (`getUser` + `is_admin`).
- **Proxy** `supabase/functions/mistral-proxy/` — 1 ligne modifiée : le libellé du contexte lit `metadata.source_type` quand l'URL ne tranche pas (contenu manuel/PDF sans URL → GUIDE au lieu de LIVRE). Corpus historique inchangé.
- **Front** : page `src/pages/Knowledge.tsx` (route `/knowledge`, admin), lien nav (Layout), API `src/lib/ingest.ts`, dépendance `pdfjs-dist` (extraction PDF côté navigateur, lazy-loadée).
- **SQL** `supabase/migrations/20260706120000_ensure_source_uid_for_ingest.sql` — garantit la colonne `source_uid` + index (idempotent).

## Étapes (une seule fois)

### 1. SQL (Supabase → SQL Editor → Run)
Colle le contenu de `supabase/migrations/20260706120000_ensure_source_uid_for_ingest.sql`.
(Idempotent : sans effet si déjà appliqué via `ingest/sql/01`.)

### 2. Déployer les Edge Functions
```bash
# secrets déjà en place (MISTRAL_API_KEY ; SUPABASE_URL/SERVICE_ROLE auto-injectés). Aucun nouveau secret.
supabase functions deploy ingest-documents --project-ref yyzfuqebakvgecekfqcw
supabase functions deploy mistral-proxy    --project-ref yyzfuqebakvgecekfqcw   # redéploie le labeler
```
> L'auth est validée DANS la fonction (`auth.getUser` + `is_admin`), donc le flag `verify_jwt`
> n'a pas d'importance ; le défaut convient. Ne PAS définir d'`INGEST_SECRET` (plus utilisé).

### 3. Front (Netlify, auto-deploy sur push `main`)
```bash
git add -A && git commit -m "feat: ajout de contenu à la base vecto depuis l'interface (admin)"
git push origin main
```
`pdfjs-dist` est déjà dans `package.json` → `npm install` au build Netlify. Aucune variable d'env nouvelle.

## Test de recette
1. Se connecter en **admin** → menu **Base de connaissances** (icône base de données).
2. **Coller du texte** : type « Note / FAQ », un titre, un corps → *Ajouter* → doit afficher « N chunks ».
3. **PDF** : choisir un PDF texte → le texte s'extrait dans le navigateur → *Ajouter*.
4. **Crawl** : coller une URL `…-c2x<id>` (produit) ou `…-c1200x<id>` (blog) → *Importer l'URL*.
5. Onglet **Gérer** : la source apparaît → *Éditer* (recoller = écrasement, même titre) / *Supprimer*.
6. Poser au chatbot une question couverte par le nouveau contenu → il doit le citer.

## Notes
- **Visibilité** : type `book` = « marketing/admin seulement » (gating `include_books` existant) ; les autres types sont visibles côté widget public.
- **Citabilité des liens** : seules les URLs `https://www.bordet.fr/…` survivent à `sanitizeUrls`. Un contenu manuel avec une URL externe verra cette URL retirée des réponses (le texte, lui, est utilisé).
- **Idempotence** : ré-ajouter la même source (même URL, ou même type+titre pour une note) remplace ses chunks (delete+insert).

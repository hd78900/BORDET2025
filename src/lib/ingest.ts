// Client de la base de connaissances (admin) : appelle l'Edge Function `ingest-documents`.
// Les écritures passent TOUJOURS par la fonction (service_role + clé Mistral côté serveur).
// La lecture/liste peut se faire côté client (RLS: authenticated peut SELECT documents),
// mais on passe par la fonction pour regrouper proprement et rester cohérent.
import { supabase } from './supabase';
import * as pdfjsLib from 'pdfjs-dist';
// worker pdf.js servi localement par Vite (pas de CDN)
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const INGEST_URL = `${SUPABASE_URL}/functions/v1/ingest-documents`;

export type IngestType = 'product' | 'article' | 'book' | 'manual';

export interface KnowledgeSource {
  source_group: string;
  title: string;
  source_type: IngestType;
  url: string | null;
  added_at: string;
  added_by: string;
  n_chunks: number;
}

export interface UpsertInput {
  type: IngestType;
  title: string;
  body: string;
  url?: string;
  brand?: string;
  price?: number | null;
  sku?: string;
  availability?: string;
}

async function call<T>(payload: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Session admin requise.');
  const res = await fetch(INGEST_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Erreur ${res.status}`);
  return data as T;
}

export function ingestUpsert(input: UpsertInput) {
  return call<{ ok: true; source_group: string; chunks: number; title: string; type: IngestType; url: string | null }>({
    action: 'upsert', ...input,
  });
}

export function ingestCrawl(url: string) {
  return call<{ ok: true; source_group: string; chunks: number; title: string; type: IngestType; url: string | null }>({
    action: 'crawl', url,
  });
}

export function ingestList() {
  return call<{ ok: true; sources: KnowledgeSource[] }>({ action: 'list' }).then((r) => r.sources);
}

export function ingestDelete(source_group: string) {
  return call<{ ok: true; deleted: number }>({ action: 'delete', source_group });
}

// --- extraction du texte d'un PDF, côté navigateur (le PDF ne quitte pas le poste) ---
export async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const parts: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // reconstitue les lignes : items séparés par espace, saut de page = double retour
    const pageText = (content.items as Array<{ str?: string }>).map((it) => it.str ?? '').join(' ');
    parts.push(pageText.replace(/[ \t]{2,}/g, ' ').trim());
  }
  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

// estimation locale du nombre de chunks (aperçu avant envoi) — miroir de la fonction serveur
export function previewChunkCount(type: IngestType, body: string): number {
  if (type === 'product') return 1;
  const est = (s: string) => Math.max(1, Math.ceil(s.length / 4) + Math.floor(s.length / 14));
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let windows = 0, curTok = 0, has = false;
  for (const para of paras) {
    const pt = est(para);
    if (pt > 800) { if (has) { windows++; curTok = 0; has = false; } windows += Math.ceil(pt / 800); continue; }
    if (curTok + pt > 800 && curTok >= 500) { windows++; curTok = 0; }
    curTok += pt; has = true;
  }
  if (has) windows++;
  return Math.max(1, windows);
}

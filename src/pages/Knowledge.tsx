import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Database, FileText, Link2, Upload, Trash2, RefreshCw, Plus, Check, X, Pencil, Loader2, AlertCircle, Sparkles,
} from 'lucide-react';
import {
  ingestUpsert, ingestCrawl, ingestList, ingestDelete, ingestClean, ingestGet, extractPdfText, previewChunkCount,
  IngestNeedsConfirm, type IngestType, type KnowledgeSource, type UpsertInput,
} from '../lib/ingest';

type Tab = 'add' | 'manage';
type Mode = 'paste' | 'pdf' | 'crawl';

const TYPE_LABELS: Record<IngestType, string> = {
  manual: 'Note / FAQ — visible public',
  article: 'Guide / Article — visible public',
  product: 'Fiche produit — visible public (URL requise)',
  book: 'Document interne / Livre — marketing seulement',
};

const emptyForm: UpsertInput = { type: 'manual', title: '', body: '', url: '', brand: '', price: null, sku: '', availability: '' };

export default function Knowledge() {
  const [tab, setTab] = useState<Tab>('add');
  const [mode, setMode] = useState<Mode>('paste');
  const [form, setForm] = useState<UpsertInput>(emptyForm);
  const [crawlUrl, setCrawlUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [pdfMarketingOnly, setPdfMarketingOnly] = useState(false);   // false = public (manual), true = marketing (book)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [listBusy, setListBusy] = useState(false);

  const set = (patch: Partial<UpsertInput>) => setForm((f) => ({ ...f, ...patch }));
  const chunkPreview = useMemo(() => previewChunkCount(form.type, form.body), [form.type, form.body]);

  // pré-remplissage depuis Analytics (« question sans réponse » -> nouveau contenu)
  const location = useLocation();
  useEffect(() => {
    const pf = (location.state as { prefill?: { title?: string } } | null)?.prefill;
    if (pf?.title) {
      setTab('add'); setMode('paste');
      setForm((f) => ({ ...f, type: 'manual', title: pf.title! }));
      setMsg({ kind: 'ok', text: 'Sujet importé depuis Analytics — rédigez le contenu qui répond à cette question, puis ajoutez.' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadList = async () => {
    setListBusy(true);
    try { setSources(await ingestList()); }
    catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }); }
    finally { setListBusy(false); }
  };
  useEffect(() => { loadList(); }, []);

  const resetForm = () => { setForm(emptyForm); setMode('paste'); };

  // Les gardes serveur peuvent répondre « confirmation requise » (doublon possible, lien mort,
  // prix hors fiche…) : on affiche les avertissements et on ré-envoie avec force si l'admin assume.
  const confirmWarnings = (w: string[]) =>
    confirm(`⚠️ Avertissements :\n\n- ${w.join('\n- ')}\n\nAjouter quand même ?`);

  const submitUpsert = async (force = false) => {
    setBusy(true); setMsg(null);
    try {
      const payload: UpsertInput = {
        ...form,
        title: form.title.trim(),
        url: form.url?.trim() || undefined,
        body: form.body,
        price: form.type === 'product' ? (form.price ?? null) : null,
      };
      if (!payload.title) throw new Error('Titre requis.');
      if (payload.type === 'product' && !payload.url) throw new Error('Une fiche produit nécessite une URL.');
      if (payload.type !== 'product' && !payload.body.trim()) throw new Error('Le corps est vide.');
      const r = await ingestUpsert(payload, force);
      setMsg({ kind: 'ok', text: `« ${r.title} » ajouté (${r.chunks} chunk${r.chunks > 1 ? 's' : ''}).` });
      resetForm();
      loadList();
    } catch (e) {
      if (e instanceof IngestNeedsConfirm) {
        setBusy(false);
        if (confirmWarnings(e.warnings)) return submitUpsert(true);
        setMsg({ kind: 'err', text: 'Ajout annulé.' });
        return;
      }
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
    finally { setBusy(false); }
  };

  const submitCrawl = async (force = false) => {
    setBusy(true); setMsg(null);
    try {
      const r = await ingestCrawl(crawlUrl.trim(), force);
      setMsg({ kind: 'ok', text: `« ${r.title} » importé depuis l'URL (${r.chunks} chunk${r.chunks > 1 ? 's' : ''}).` });
      setCrawlUrl('');
      loadList();
    } catch (e) {
      if (e instanceof IngestNeedsConfirm) {
        setBusy(false);
        if (confirmWarnings(e.warnings)) return submitCrawl(true);
        setMsg({ kind: 'err', text: 'Import annulé.' });
        return;
      }
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
    finally { setBusy(false); }
  };

  const runClean = async () => {
    if (!form.body.trim() || cleaning) return;
    setCleaning(true); setMsg(null);
    try {
      const cleaned = await ingestClean(form.body);
      set({ body: cleaned });
      setMsg({ kind: 'ok', text: 'Texte nettoyé par l\'IA (formatage uniquement, aucun chiffre modifié) — relisez avant d\'ajouter.' });
    } catch (e) { setMsg({ kind: 'err', text: `Nettoyage indisponible (${e instanceof Error ? e.message : e}) — texte inchangé.` }); }
    finally { setCleaning(false); }
  };

  // Import PDF « en un geste » : extraction -> nettoyage IA -> ajout auto (titre = nom du fichier),
  // aucun champ à remplir. Le résultat est relisible / renommable / supprimable dans l'onglet « Gérer ».
  const addPdfContent = async (title: string, body: string, type: IngestType, force = false): Promise<void> => {
    try {
      const r = await ingestUpsert({ type, title, body }, force);
      const where = type === 'book' ? 'marketing seulement' : 'public';
      setMsg({ kind: 'ok', text: `« ${r.title} » importé (${r.chunks} chunk${r.chunks > 1 ? 's' : ''}, ${where}) — relisez-le dans l'onglet « Gérer » (crayon).` });
      loadList();
    } catch (e) {
      if (e instanceof IngestNeedsConfirm) {
        if (confirmWarnings(e.warnings)) return addPdfContent(title, body, type, true);
        setMsg({ kind: 'err', text: 'Import annulé.' });
        return;
      }
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const onPickPdf = async (file: File | undefined) => {
    if (!file) return;
    const type: IngestType = pdfMarketingOnly ? 'book' : 'manual';
    const title = file.name.replace(/\.pdf$/i, '').trim() || 'Document PDF';
    setPdfBusy(true);
    setMsg({ kind: 'ok', text: `« ${title} » — extraction du texte…` });
    let text = '';
    try {
      text = await extractPdfText(file);
      if (!text.trim()) throw new Error("Aucun texte extrait (PDF scanné/image ?). Pas d'OCR : utilisez « Coller du texte ».");
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
      setPdfBusy(false);
      return;
    }
    setPdfBusy(false);
    // nettoyage IA automatique (si indisponible, on garde le texte brut)
    setCleaning(true);
    setMsg({ kind: 'ok', text: `« ${title} » — texte extrait, nettoyage IA…` });
    let cleaned = text;
    try { cleaned = await ingestClean(text); } catch { /* fallback texte brut */ }
    setCleaning(false);
    // ajout automatique
    setBusy(true);
    setMsg({ kind: 'ok', text: `« ${title} » — ajout à la base…` });
    await addPdfContent(title, cleaned, type);
    setBusy(false);
  };

  const editSource = async (s: KnowledgeSource) => {
    setTab('add'); setMode('paste');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setBusy(true);
    setMsg({ kind: 'ok', text: `Chargement de « ${s.title} »…` });
    try {
      const c = await ingestGet(s.source_group);
      setForm({
        type: c.type, title: c.title, url: c.url || '', body: c.body || '',
        brand: c.brand || '', sku: c.sku || '', price: c.price ?? null, availability: c.availability || '',
      });
      setMsg({ kind: 'ok', text: `« ${c.title} » chargé — modifiez le contenu puis « Ajouter à la base » (garder le même titre = écrasement).` });
    } catch (e) {
      setMsg({ kind: 'err', text: `Chargement impossible : ${e instanceof Error ? e.message : String(e)}` });
    } finally { setBusy(false); }
  };

  const removeSource = async (s: KnowledgeSource) => {
    if (!confirm(`Supprimer « ${s.title} » (${s.n_chunks} chunk${s.n_chunks > 1 ? 's' : ''}) ?`)) return;
    setMsg(null);
    try { const r = await ingestDelete(s.source_group); setMsg({ kind: 'ok', text: `Supprimé (${r.deleted} chunk${r.deleted > 1 ? 's' : ''}).` }); loadList(); }
    catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }); }
  };

  const ModeBtn = ({ m, icon: Icon, label }: { m: Mode; icon: any; label: string }) => (
    <button onClick={() => setMode(m)}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border ${mode === m ? 'bg-red-950 text-white border-red-950' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>
      <Icon className="h-4 w-4" /> {label}
    </button>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Database className="h-7 w-7 text-red-950" />
        <h1 className="text-2xl font-bold text-gray-900">Base de connaissances</h1>
      </div>

      <div className="flex gap-2 mb-6 border-b border-gray-200">
        {(['add', 'manage'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === t ? 'border-red-950 text-red-950' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t === 'add' ? 'Ajouter du contenu' : `Gérer (${sources.length})`}
          </button>
        ))}
      </div>

      {msg && (
        <div className={`flex items-start gap-2 mb-4 px-4 py-3 rounded-lg text-sm ${msg.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {msg.kind === 'ok' ? <Check className="h-4 w-4 mt-0.5 shrink-0" /> : <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />}
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="ml-auto"><X className="h-4 w-4" /></button>
        </div>
      )}

      {tab === 'add' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex flex-wrap gap-2 mb-6">
            <ModeBtn m="paste" icon={FileText} label="Coller du texte" />
            <ModeBtn m="pdf" icon={Upload} label="Importer un PDF" />
            <ModeBtn m="crawl" icon={Link2} label="Crawl d'une URL bordet.fr" />
          </div>

          {mode === 'crawl' ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">Collez l'URL d'une fiche produit (…-c2x…) ou d'un article (…-c1200x…). Le contenu est récupéré, découpé et embarqué automatiquement.</p>
              <input value={crawlUrl} onChange={(e) => setCrawlUrl(e.target.value)}
                placeholder="https://www.bordet.fr/...-c2x1234"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <button onClick={() => submitCrawl()} disabled={busy || !crawlUrl.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-red-950 text-white rounded-lg text-sm font-medium hover:bg-red-800 disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Importer l'URL
              </button>
            </div>
          ) : mode === 'pdf' ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">
                Déposez un PDF : le texte est extrait dans votre navigateur, nettoyé par l'IA, puis <strong>ajouté automatiquement</strong> (titre = nom du fichier). Rien d'autre à remplir.
              </p>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-500">Visible par :</span>
                <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                  <button type="button" disabled={pdfBusy || cleaning || busy} onClick={() => setPdfMarketingOnly(false)}
                    className={`px-3 py-1.5 ${!pdfMarketingOnly ? 'bg-red-950 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'} disabled:opacity-50`}>
                    Public (widget)
                  </button>
                  <button type="button" disabled={pdfBusy || cleaning || busy} onClick={() => setPdfMarketingOnly(true)}
                    className={`px-3 py-1.5 ${pdfMarketingOnly ? 'bg-red-950 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'} disabled:opacity-50`}>
                    Marketing seulement
                  </button>
                </div>
              </div>
              <label className={`flex flex-col items-center justify-center gap-2 px-4 py-10 border-2 border-dashed border-gray-300 rounded-lg ${(pdfBusy || cleaning || busy) ? 'opacity-60' : 'cursor-pointer hover:bg-gray-50'}`}>
                {(pdfBusy || cleaning || busy)
                  ? <Loader2 className="h-6 w-6 animate-spin text-red-950" />
                  : <Upload className="h-6 w-6 text-gray-400" />}
                <span className="text-sm text-gray-600 text-center">
                  {pdfBusy ? 'Extraction du texte…' : cleaning ? 'Nettoyage IA…' : busy ? 'Ajout à la base…' : 'Choisir un fichier PDF'}
                </span>
                <input type="file" accept="application/pdf" className="hidden" disabled={pdfBusy || cleaning || busy}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onPickPdf(f); }} />
              </label>
              <p className="text-xs text-gray-400">
                {pdfMarketingOnly
                  ? 'Marketing seulement : interrogeable uniquement en mode marketing (admin), jamais par le widget public.'
                  : 'Public : le contenu pourra être utilisé dans les réponses du widget client.'}
                {' '}Relisez / renommez / supprimez dans l'onglet « Gérer ». PDF scannés (images) non pris en charge : pas d'OCR.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type de contenu</label>
                <select value={form.type} onChange={(e) => set({ type: e.target.value as IngestType })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {(Object.keys(TYPE_LABELS) as IngestType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Titre</label>
                <input value={form.title} onChange={(e) => set({ title: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Titre du contenu" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  URL {form.type === 'product' ? '(requise)' : '(optionnelle — bordet.fr pour être citable)'}
                </label>
                <input value={form.url} onChange={(e) => set({ url: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="https://www.bordet.fr/..." />
              </div>

              {form.type === 'product' && (
                <div className="grid grid-cols-2 gap-4">
                  <input value={form.brand} onChange={(e) => set({ brand: e.target.value })} placeholder="Marque" className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  <input value={form.sku} onChange={(e) => set({ sku: e.target.value })} placeholder="Référence (SKU)" className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  <input type="number" step="0.01" value={form.price ?? ''} onChange={(e) => set({ price: e.target.value ? Number(e.target.value) : null })} placeholder="Prix € TTC" className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  <input value={form.availability} onChange={(e) => set({ availability: e.target.value })} placeholder="Disponibilité" className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">
                    {form.type === 'product' ? 'Description' : 'Contenu'}
                  </label>
                  <div className="flex items-center gap-3">
                    {form.type !== 'product' && form.body.trim() && (
                      <span className="text-xs text-gray-400">≈ {chunkPreview} chunk{chunkPreview > 1 ? 's' : ''}</span>
                    )}
                    {form.type !== 'product' && form.body.trim() && (
                      <button type="button" onClick={runClean} disabled={cleaning}
                        className="flex items-center gap-1 text-xs font-medium text-red-950 hover:text-red-800 disabled:opacity-50"
                        title="Nettoyage de formatage par mistral-medium (aucun chiffre/mot modifié)">
                        {cleaning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {cleaning ? 'Nettoyage…' : "Nettoyer avec l'IA"}
                      </button>
                    )}
                  </div>
                </div>
                <textarea value={form.body} onChange={(e) => set({ body: e.target.value })} rows={8}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder="Contenu à ingérer…" />
              </div>

              <div className="flex gap-2">
                <button onClick={() => submitUpsert()} disabled={busy || cleaning}
                  className="flex items-center gap-2 px-4 py-2 bg-red-950 text-white rounded-lg text-sm font-medium hover:bg-red-800 disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Ajouter à la base
                </button>
                <button onClick={resetForm} className="px-4 py-2 text-gray-600 text-sm hover:text-gray-900">Réinitialiser</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'manage' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <span className="text-sm text-gray-500">Contenus ajoutés depuis l'interface</span>
            <button onClick={loadList} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
              <RefreshCw className={`h-4 w-4 ${listBusy ? 'animate-spin' : ''}`} /> Rafraîchir
            </button>
          </div>
          {sources.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-gray-400">{listBusy ? 'Chargement…' : 'Aucun contenu ajouté via l\'interface pour le moment.'}</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {sources.map((s) => (
                <li key={s.source_group} className="flex items-center gap-3 px-6 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{s.title || s.source_group}</p>
                    <p className="text-xs text-gray-400">
                      {s.source_type} · {s.n_chunks} chunk{s.n_chunks > 1 ? 's' : ''}
                      {s.added_at ? ` · ${new Date(s.added_at).toLocaleDateString('fr-FR')}` : ''}
                      {s.url ? <> · <a href={s.url} target="_blank" rel="noreferrer" className="text-red-950 hover:underline">lien</a></> : ''}
                    </p>
                  </div>
                  <button onClick={() => editSource(s)} title="Éditer" className="p-2 text-gray-400 hover:text-red-950"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => removeSource(s)} title="Supprimer" className="p-2 text-gray-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

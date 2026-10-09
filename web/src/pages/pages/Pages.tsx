import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";
import { Toggle, inputClass } from "../../components/session/Panel";
import { formatDateTimeLagos } from "../../lib/format";

interface Page {
  id: number;
  title: string;
  title_fr: string | null;
  slug: string;
  body_html: string;
  body_html_fr: string | null;
  seo_title: string | null;
  seo_meta_description: string | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

interface FormState {
  title: string;
  title_fr: string;
  body_html: string;
  seo_title: string;
  seo_meta_description: string;
  is_published: boolean;
}

const EMPTY_FORM: FormState = { title: "", title_fr: "", body_html: "", seo_title: "", seo_meta_description: "", is_published: false };

function pageToForm(p: Page): FormState {
  return {
    title: p.title,
    title_fr: p.title_fr ?? "",
    body_html: p.body_html,
    seo_title: p.seo_title ?? "",
    seo_meta_description: p.seo_meta_description ?? "",
    is_published: p.is_published,
  };
}

function PageSlideOver({ page, onClose, onSaved }: { page: Page | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(page ? pageToForm(page) : EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    const title = form.title.trim();
    const body_html = form.body_html.trim();
    if (!title) { setErr("A title is required."); return; }
    if (!body_html) { setErr("A body is required."); return; }

    setBusy(true);
    setErr(null);
    const payload = {
      title,
      title_fr: form.title_fr.trim() || null,
      body_html,
      seo_title: form.seo_title.trim() || null,
      seo_meta_description: form.seo_meta_description.trim() || null,
      is_published: form.is_published,
    };
    try {
      if (page) {
        await api(`/pages/${page.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await api("/pages", { method: "POST", body: JSON.stringify(payload) });
      }
      toast(`Page ${page ? "updated" : "created"}.`);
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Failed to save page.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-slate-800 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">{page ? "Edit Page" : "Add Page"}</h2>
          <button onClick={onClose} className="text-xl leading-none text-slate-500 hover:text-slate-300">×</button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Title</label>
              <input type="text" value={form.title} onChange={(e) => set("title", e.target.value)} className={inputClass} maxLength={200} placeholder="e.g. Terms of Service" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Title (French)</label>
              <input type="text" value={form.title_fr} onChange={(e) => set("title_fr", e.target.value)} className={inputClass} maxLength={200} placeholder="Optional" />
            </div>
          </div>

          {page && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-500">
              URL: <span className="font-mono text-slate-400">/p/{page.slug}</span> — set once at creation, never changes on rename, so an already-shared link keeps working.
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs text-slate-400">Body (HTML)</label>
            <textarea value={form.body_html} onChange={(e) => set("body_html", e.target.value)} className={`${inputClass} min-h-[200px] font-mono text-xs`} placeholder="<p>Last updated January 2026…</p>" />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">SEO title</label>
            <input type="text" value={form.seo_title} onChange={(e) => set("seo_title", e.target.value)} className={inputClass} maxLength={200} placeholder="Optional — defaults to the page title" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">SEO meta description</label>
            <textarea value={form.seo_meta_description} onChange={(e) => set("seo_meta_description", e.target.value)} className={`${inputClass} min-h-[60px]`} maxLength={300} placeholder="Optional" />
          </div>

          <Toggle label="Published" description="Unpublished pages 404 on the public site, regardless of how the link was reached." checked={form.is_published} onChange={(v) => set("is_published", v)} />

          {err && <p className="text-sm text-red-400">{err}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Saving…" : page ? "Save changes" : "Create page"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Pages() {
  const { toast } = useToast();
  const [pages, setPages] = useState<Page[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [editing, setEditing] = useState<Page | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api<{ pages: Page[] }>("/pages")
      .then((res) => { setPages(res.pages); setLoading(false); })
      .catch((err) => {
        setError(err.message ?? "Failed to load pages.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(page: Page) {
    if (!confirm(`Delete "${page.title}"?`)) return;
    setDeletingId(page.id);
    try {
      await api(`/pages/${page.id}`, { method: "DELETE" });
      setPages((prev) => prev?.filter((p) => p.id !== page.id) ?? null);
      toast("Page deleted.");
    } catch (e: any) {
      toast(e.message ?? "Failed to delete page.", "error");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (error) return <ErrorState message={error} correlationId={correlationId} onRetry={load} />;

  return (
    <div className="space-y-5">
      {editing && (
        <PageSlideOver
          page={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Pages</h1>
          <p className="mt-1 text-sm text-slate-500">Static pages and landing pages — About, Terms, Privacy, and one-off marketing pages, reached at /p/:slug.</p>
        </div>
        <button onClick={() => setEditing("new")} className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
          <Icon name="file" className="h-4 w-4" />
          Add Page
        </button>
      </div>

      {!pages?.length ? (
        <EmptyState
          icon={<Icon name="file" className="h-6 w-6" />}
          heading="No pages yet"
          explanation="A published page is reachable at /p/:slug on the public site."
          actionLabel="Add Page"
          onAction={() => setEditing("new")}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">URL</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {pages.map((p) => (
                  <tr key={p.id} className="group hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-medium text-slate-100">{p.title}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">/p/{p.slug}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDateTimeLagos(p.updated_at)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${p.is_published ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" : "border-slate-700 bg-slate-800 text-slate-500"}`}>
                        {p.is_published ? "Published" : "Draft"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setEditing(p)} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200">Edit</button>
                        <button onClick={() => handleDelete(p)} disabled={deletingId === p.id} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-900/30 hover:text-red-400 disabled:opacity-50">
                          {deletingId === p.id ? "…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

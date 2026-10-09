import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";
import { ContentPicker } from "../../components/ContentPicker";
import { Toggle, inputClass, selectClass } from "../../components/session/Panel";
import { formatCount } from "../../lib/format";

interface Faq {
  id: number;
  question: string | null;
  answer_html: string | null;
  scope: "global" | "content" | null;
  content_id: number | null;
  category: string | null;
  display_order: number | null;
  is_published: boolean;
  views: number;
  helpful_yes: number;
  helpful_no: number;
}

interface FormState {
  question: string;
  answer_html: string;
  scope: "global" | "content";
  content_id: string;
  category: string;
  display_order: string;
  is_published: boolean;
}

const EMPTY_FORM: FormState = {
  question: "",
  answer_html: "",
  scope: "global",
  content_id: "",
  category: "",
  display_order: "",
  is_published: false,
};

function faqToForm(f: Faq): FormState {
  return {
    question: f.question ?? "",
    answer_html: f.answer_html ?? "",
    scope: f.scope ?? "global",
    content_id: f.content_id != null ? String(f.content_id) : "",
    category: f.category ?? "",
    display_order: f.display_order != null ? String(f.display_order) : "",
    is_published: f.is_published,
  };
}

function FaqSlideOver({ faq, onClose, onSaved }: { faq: Faq | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(faq ? faqToForm(faq) : EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    const question = form.question.trim();
    const answer = form.answer_html.trim();
    if (!question) { setErr("A question is required."); return; }
    if (!answer) { setErr("An answer is required."); return; }
    if (form.scope === "content" && !form.content_id.trim()) { setErr("Pick which content item this FAQ belongs to, or switch scope to Global."); return; }

    setBusy(true);
    setErr(null);
    const payload = {
      question,
      answer_html: answer,
      scope: form.scope,
      content_id: form.scope === "content" ? Number(form.content_id) || null : null,
      category: form.category.trim() || null,
      display_order: form.display_order.trim() ? Number(form.display_order) : null,
      is_published: form.is_published,
    };
    try {
      if (faq) {
        await api(`/faqs/${faq.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await api("/faqs", { method: "POST", body: JSON.stringify(payload) });
      }
      toast(`FAQ ${faq ? "updated" : "created"}.`);
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Failed to save FAQ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-slate-800 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">{faq ? "Edit FAQ" : "Add FAQ"}</h2>
          <button onClick={onClose} className="text-xl leading-none text-slate-500 hover:text-slate-300">×</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Question</label>
            <input type="text" value={form.question} onChange={(e) => set("question", e.target.value)} className={inputClass} maxLength={300} placeholder="e.g. How do I cancel my subscription?" />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Answer (HTML)</label>
            <textarea value={form.answer_html} onChange={(e) => set("answer_html", e.target.value)} className={`${inputClass} min-h-[120px] font-mono text-xs`} placeholder="<p>Go to Account → Subscriptions…</p>" />
            <p className="mt-1 text-xs text-slate-600">Rendered as raw HTML on the public FAQ page — there's no rich-text editor here yet, so basic tags (&lt;p&gt;, &lt;a&gt;, &lt;strong&gt;) are typed by hand.</p>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Scope</label>
            <select value={form.scope} onChange={(e) => { set("scope", e.target.value as FormState["scope"]); set("content_id", ""); }} className={selectClass}>
              <option value="global">Global — shown on the public FAQ page</option>
              <option value="content">One piece of content — shown on its detail page</option>
            </select>
          </div>

          {form.scope === "content" && (
            <div>
              <label className="mb-1 block text-xs text-slate-400">Content</label>
              <ContentPicker value={form.content_id ? Number(form.content_id) : null} onChange={(id) => set("content_id", id != null ? String(id) : "")} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Category</label>
              <input type="text" value={form.category} onChange={(e) => set("category", e.target.value)} className={inputClass} maxLength={60} placeholder="Optional grouping" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Display order</label>
              <input type="number" value={form.display_order} onChange={(e) => set("display_order", e.target.value)} className={inputClass} placeholder="Lower shows first" />
            </div>
          </div>

          <Toggle label="Published" description="Unpublished FAQs are visible here but never appear on the public site." checked={form.is_published} onChange={(v) => set("is_published", v)} />

          {faq && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-500">
              {formatCount(faq.views)} view{faq.views === 1 ? "" : "s"} · {formatCount(faq.helpful_yes)} found it helpful · {formatCount(faq.helpful_no)} didn't — saving here doesn't reset these.
            </div>
          )}

          {err && <p className="text-sm text-red-400">{err}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Saving…" : faq ? "Save changes" : "Create FAQ"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Faqs() {
  const { toast } = useToast();
  const [faqs, setFaqs] = useState<Faq[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [editing, setEditing] = useState<Faq | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api<{ faqs: Faq[] }>("/faqs")
      .then((res) => { setFaqs(res.faqs); setLoading(false); })
      .catch((err) => {
        setError(err.message ?? "Failed to load FAQs.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(faq: Faq) {
    if (!confirm(`Delete "${faq.question}"?`)) return;
    setDeletingId(faq.id);
    try {
      await api(`/faqs/${faq.id}`, { method: "DELETE" });
      setFaqs((prev) => prev?.filter((f) => f.id !== faq.id) ?? null);
      toast("FAQ deleted.");
    } catch (e: any) {
      toast(e.message ?? "Failed to delete FAQ.", "error");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (error) return <ErrorState message={error} correlationId={correlationId} onRetry={load} />;

  return (
    <div className="space-y-5">
      {editing && (
        <FaqSlideOver
          faq={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">FAQs</h1>
          <p className="mt-1 text-sm text-slate-500">Global questions on the public FAQ page, or scoped to one piece of content's detail page.</p>
        </div>
        <button onClick={() => setEditing("new")} className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
          <Icon name="question" className="h-4 w-4" />
          Add FAQ
        </button>
      </div>

      {!faqs?.length ? (
        <EmptyState
          icon={<Icon name="question" className="h-6 w-6" />}
          heading="No FAQs yet"
          explanation="Add a question to show on the public FAQ page or on a specific content item's detail page."
          actionLabel="Add FAQ"
          onAction={() => setEditing("new")}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Question</th>
                  <th className="px-4 py-3 font-medium">Scope</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Views</th>
                  <th className="px-4 py-3 font-medium">Helpful</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {faqs.map((f) => (
                  <tr key={f.id} className="group hover:bg-slate-800/40">
                    <td className="max-w-xs truncate px-4 py-3 font-medium text-slate-100">{f.question}</td>
                    <td className="px-4 py-3 text-slate-500">{f.scope === "content" ? `Content #${f.content_id}` : "Global"}</td>
                    <td className="px-4 py-3 text-slate-500">{f.category ?? "—"}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-400">{formatCount(f.views)}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-400">{formatCount(f.helpful_yes)} / {formatCount(f.helpful_no)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${f.is_published ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" : "border-slate-700 bg-slate-800 text-slate-500"}`}>
                        {f.is_published ? "Published" : "Draft"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setEditing(f)} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200">Edit</button>
                        <button onClick={() => handleDelete(f)} disabled={deletingId === f.id} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-900/30 hover:text-red-400 disabled:opacity-50">
                          {deletingId === f.id ? "…" : "Delete"}
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

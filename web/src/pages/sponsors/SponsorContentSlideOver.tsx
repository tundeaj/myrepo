import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { inputClass, selectClass } from "../../components/session/Panel";
import { formatNaira } from "../../lib/format";

/**
 * A sponsor's own content-sponsorship campaigns — content_sponsors has
 * existed in the schema since the beginning (content_id, sponsor_id,
 * sponsorship_ngn, placement, message, starts_at/ends_at), but Sponsors.tsx
 * previously only managed the sponsor entity itself; there was nowhere to
 * actually LINK a sponsor to a session or course. This slide-over opens from
 * a sponsor's row on the Sponsors page and is that missing surface — search
 * to link, edit a link's terms in place, or remove it.
 *
 * A sponsorship is deliberately viewed from the sponsor's side, not the
 * content editor's: an admin managing what a sponsor is paying for wants to
 * see every placement it runs across, in one place, the same reasoning
 * routes/contentSponsors.ts's own doc comment states.
 */

interface ContentStub {
  id: number;
  title: string | null;
  slug: string;
  content_type: string;
  status: string;
}

interface Link {
  id: number;
  content_id: number;
  sponsor_id: number;
  sponsorship_ngn: string | number | null;
  placement: string | null;
  message: string | null;
  starts_at: string | null;
  ends_at: string | null;
  content: ContentStub | null;
}

interface SearchResult {
  id: number;
  title: string | null;
  slug: string;
  content_type: string;
  status: string;
}

const PLACEMENT_LABEL: Record<string, string> = {
  session_page: "Session/course page",
  player: "Player",
  hero: "Hero banner",
  pre_session: "Pre-session",
};

function toDateInput(v: string | null): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

interface FormState {
  content: { id: number; title: string | null } | null;
  placement: string;
  sponsorship_ngn: string;
  message: string;
  starts_at: string;
  ends_at: string;
}

const EMPTY_FORM: FormState = { content: null, placement: "", sponsorship_ngn: "", message: "", starts_at: "", ends_at: "" };

export function SponsorContentSlideOver({
  sponsorId,
  sponsorName,
  onClose,
}: {
  sponsorId: number;
  sponsorName: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [links, setLinks] = useState<Link[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api<{ links: Link[] }>(`/content-sponsors?sponsor_id=${sponsorId}`)
      .then((res) => {
        setLinks(res.links);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message ?? "Failed to load content links.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, [sponsorId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(() => {
      api<{ items: SearchResult[] }>(`/content-search?q=${encodeURIComponent(query)}`)
        .then((res) => setResults(res.items))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startAdd(item: SearchResult) {
    setEditingId(null);
    setForm({ content: { id: item.id, title: item.title }, placement: "", sponsorship_ngn: "", message: "", starts_at: "", ends_at: "" });
    setFormErr(null);
    setQuery("");
    setResults([]);
  }

  function startEdit(link: Link) {
    setEditingId(link.id);
    setForm({
      content: link.content ? { id: link.content.id, title: link.content.title } : { id: link.content_id, title: null },
      placement: link.placement ?? "",
      sponsorship_ngn: link.sponsorship_ngn == null ? "" : String(link.sponsorship_ngn),
      message: link.message ?? "",
      starts_at: toDateInput(link.starts_at),
      ends_at: toDateInput(link.ends_at),
    });
    setFormErr(null);
  }

  function cancelForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormErr(null);
  }

  async function submit() {
    if (!form.content) return;
    const amount = form.sponsorship_ngn.trim();
    if (amount && !Number.isFinite(Number(amount))) {
      setFormErr("Enter a valid amount.");
      return;
    }

    setSaving(true);
    setFormErr(null);
    const payload = {
      placement: form.placement || null,
      sponsorship_ngn: amount ? Number(amount) : null,
      message: form.message.trim() || null,
      starts_at: form.starts_at || null,
      ends_at: form.ends_at || null,
    };
    try {
      if (editingId) {
        await api(`/content-sponsors/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
        toast("Sponsorship updated.");
      } else {
        await api("/content-sponsors", {
          method: "POST",
          body: JSON.stringify({ ...payload, content_id: form.content.id, sponsor_id: sponsorId }),
        });
        toast(`Linked to "${form.content.title ?? "that content"}".`);
      }
      cancelForm();
      load();
    } catch (e: any) {
      setFormErr(e.message ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(link: Link) {
    if (!confirm(`Remove this sponsorship from "${link.content?.title ?? "that content"}"?`)) return;
    setDeletingId(link.id);
    try {
      await api(`/content-sponsors/${link.id}`, { method: "DELETE" });
      setLinks((prev) => prev?.filter((l) => l.id !== link.id) ?? null);
      toast("Sponsorship removed.");
    } catch (e: any) {
      toast(e.message ?? "Failed to remove.", "error");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-slate-800 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Content sponsorships</h2>
            <p className="mt-0.5 text-xs text-slate-500">{sponsorName ?? "This sponsor"}'s campaigns, across every session and course.</p>
          </div>
          <button onClick={onClose} className="text-xl leading-none text-slate-500 hover:text-slate-300">×</button>
        </div>

        {!editingId && (
          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium text-slate-400">Link to a session or course</label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title or slug…"
              className={inputClass}
            />
            {searching && <p className="mt-2 text-xs text-slate-600">Searching…</p>}
            {!searching && results.length > 0 && (
              <div className="mt-2 max-h-48 divide-y divide-slate-800 overflow-y-auto rounded-lg border border-slate-800">
                {results.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => startAdd(r)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-800/60"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-200">{r.title ?? `Untitled #${r.id}`}</p>
                      <p className="text-xs capitalize text-slate-600">{r.content_type} · {r.status.replace(/_/g, " ")}</p>
                    </div>
                    <span className="shrink-0 text-xs text-brand">Choose</span>
                  </button>
                ))}
              </div>
            )}
            {!searching && query.trim() && results.length === 0 && <p className="mt-2 text-xs text-slate-600">No matches.</p>}
          </div>
        )}

        {form.content && (
          <div className="mb-5 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium text-slate-100">
                {editingId ? "Edit sponsorship" : "New sponsorship"} — {form.content.title ?? `Untitled #${form.content.id}`}
              </p>
              <button onClick={cancelForm} className="text-xs text-slate-500 hover:text-slate-300">Cancel</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Placement</label>
                <select value={form.placement} onChange={(e) => set("placement", e.target.value)} className={selectClass}>
                  <option value="">Unspecified</option>
                  {Object.entries(PLACEMENT_LABEL).map(([v, label]) => (
                    <option key={v} value={v}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Sponsorship amount ₦</label>
                <input type="number" min="0" step="1" value={form.sponsorship_ngn} onChange={(e) => set("sponsorship_ngn", e.target.value)} className={inputClass} placeholder="Optional" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Starts</label>
                <input type="date" value={form.starts_at} onChange={(e) => set("starts_at", e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Ends</label>
                <input type="date" value={form.ends_at} onChange={(e) => set("ends_at", e.target.value)} className={inputClass} />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-slate-400">Message</label>
                <input
                  type="text"
                  value={form.message}
                  onChange={(e) => set("message", e.target.value)}
                  className={inputClass}
                  maxLength={300}
                  placeholder="Optional — e.g. a sponsor tagline shown alongside the placement"
                />
              </div>
            </div>
            {formErr && <p className="mt-3 text-sm text-red-400">{formErr}</p>}
            <div className="mt-4 flex justify-end">
              <button onClick={submit} disabled={saving} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
                {saving ? "Saving…" : editingId ? "Save changes" : "Link sponsor"}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-800/60" />)}
          </div>
        ) : error ? (
          <p className="text-sm text-red-400">{error}{correlationId ? ` (ref: ${correlationId})` : ""}</p>
        ) : !links?.length ? (
          <p className="rounded-lg border border-dashed border-slate-800 px-4 py-6 text-center text-sm text-slate-500">
            No content linked yet. Search above to sponsor a session or course.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-800">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-3 py-2 font-medium">Content</th>
                  <th className="px-3 py-2 font-medium">Placement</th>
                  <th className="px-3 py-2 font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Window</th>
                  <th className="px-3 py-2 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {links.map((l) => (
                  <tr key={l.id} className="group hover:bg-slate-800/40">
                    <td className="px-3 py-2 text-slate-200">{l.content?.title ?? `Untitled #${l.content_id}`}</td>
                    <td className="px-3 py-2 text-slate-400">{l.placement ? PLACEMENT_LABEL[l.placement] ?? l.placement : "—"}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-400">{l.sponsorship_ngn == null ? "—" : formatNaira(l.sponsorship_ngn)}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {l.starts_at || l.ends_at
                        ? `${l.starts_at ? new Date(l.starts_at).toLocaleDateString() : "…"} – ${l.ends_at ? new Date(l.ends_at).toLocaleDateString() : "…"}`
                        : "Always"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => startEdit(l)} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200">Edit</button>
                        <button
                          onClick={() => remove(l)}
                          disabled={deletingId === l.id}
                          className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-900/30 hover:text-red-400 disabled:opacity-50"
                        >
                          {deletingId === l.id ? "…" : "Remove"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

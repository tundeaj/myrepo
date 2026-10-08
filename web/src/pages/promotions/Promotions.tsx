import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";
import { Toggle, inputClass } from "../../components/session/Panel";
import { formatDateTimeLagos } from "../../lib/format";

interface Promotion {
  id: number;
  headline: string;
  body: string | null;
  link_url: string | null;
  link_label: string | null;
  display_order: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

interface FormState {
  headline: string;
  body: string;
  link_url: string;
  link_label: string;
  display_order: string;
  is_active: boolean;
  starts_at: string;
  ends_at: string;
}

const EMPTY_FORM: FormState = { headline: "", body: "", link_url: "", link_label: "", display_order: "0", is_active: true, starts_at: "", ends_at: "" };

/** <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" with no timezone
 *  suffix; the API returns a full ISO string. Same round-trip every other
 *  admin datetime field in this codebase (Coupons' valid_from/valid_until)
 *  already uses. */
function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function promotionToForm(p: Promotion): FormState {
  return {
    headline: p.headline,
    body: p.body ?? "",
    link_url: p.link_url ?? "",
    link_label: p.link_label ?? "",
    display_order: String(p.display_order),
    is_active: p.is_active,
    starts_at: toDatetimeLocal(p.starts_at),
    ends_at: toDatetimeLocal(p.ends_at),
  };
}

function isCurrentlyActive(p: Promotion): boolean {
  if (!p.is_active) return false;
  const now = Date.now();
  if (p.starts_at && new Date(p.starts_at).getTime() > now) return false;
  if (p.ends_at && new Date(p.ends_at).getTime() < now) return false;
  return true;
}

function PromotionSlideOver({ promotion, onClose, onSaved }: { promotion: Promotion | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(promotion ? promotionToForm(promotion) : EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    const headline = form.headline.trim();
    if (!headline) { setErr("A headline is required."); return; }

    setBusy(true);
    setErr(null);
    const payload = {
      headline,
      body: form.body.trim() || null,
      link_url: form.link_url.trim() || null,
      link_label: form.link_label.trim() || null,
      display_order: Number(form.display_order) || 0,
      is_active: form.is_active,
      starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
    };
    try {
      if (promotion) {
        await api(`/promotions/${promotion.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await api("/promotions", { method: "POST", body: JSON.stringify(payload) });
      }
      toast(`Promotion ${promotion ? "updated" : "created"}.`);
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Failed to save promotion.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-slate-800 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">{promotion ? "Edit Promotion" : "Add Promotion"}</h2>
          <button onClick={onClose} className="text-xl leading-none text-slate-500 hover:text-slate-300">×</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Headline</label>
            <input type="text" value={form.headline} onChange={(e) => set("headline", e.target.value)} className={inputClass} maxLength={200} placeholder="e.g. 20% off every course this week" />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Body</label>
            <textarea value={form.body} onChange={(e) => set("body", e.target.value)} className={`${inputClass} min-h-[70px]`} maxLength={400} placeholder="Optional, shown alongside the headline" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Link URL</label>
              <input type="text" value={form.link_url} onChange={(e) => set("link_url", e.target.value)} className={inputClass} maxLength={500} placeholder="Optional" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Link label</label>
              <input type="text" value={form.link_label} onChange={(e) => set("link_label", e.target.value)} className={inputClass} maxLength={60} placeholder="e.g. Learn more" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Starts</label>
              <input type="datetime-local" value={form.starts_at} onChange={(e) => set("starts_at", e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Ends</label>
              <input type="datetime-local" value={form.ends_at} onChange={(e) => set("ends_at", e.target.value)} className={inputClass} />
            </div>
          </div>
          <p className="text-xs text-slate-600">Leave either blank for open-ended. With more than one promotion active at once, the lowest display order wins.</p>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Display order</label>
            <input type="number" value={form.display_order} onChange={(e) => set("display_order", e.target.value)} className={inputClass} placeholder="Lower shows first" />
          </div>

          <Toggle label="Active" description="Inactive promotions never show on the public site, regardless of their date window." checked={form.is_active} onChange={(v) => set("is_active", v)} />

          {err && <p className="text-sm text-red-400">{err}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Saving…" : promotion ? "Save changes" : "Create promotion"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Promotions() {
  const { toast } = useToast();
  const [promotions, setPromotions] = useState<Promotion[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [editing, setEditing] = useState<Promotion | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api<{ promotions: Promotion[] }>("/promotions")
      .then((res) => { setPromotions(res.promotions); setLoading(false); })
      .catch((err) => {
        setError(err.message ?? "Failed to load promotions.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(promotion: Promotion) {
    if (!confirm(`Delete "${promotion.headline}"?`)) return;
    setDeletingId(promotion.id);
    try {
      await api(`/promotions/${promotion.id}`, { method: "DELETE" });
      setPromotions((prev) => prev?.filter((p) => p.id !== promotion.id) ?? null);
      toast("Promotion deleted.");
    } catch (e: any) {
      toast(e.message ?? "Failed to delete promotion.", "error");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (error) return <ErrorState message={error} correlationId={correlationId} onRetry={load} />;

  return (
    <div className="space-y-5">
      {editing && (
        <PromotionSlideOver
          promotion={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Promotions</h1>
          <p className="mt-1 text-sm text-slate-500">Site-wide promo banners on the public homepage — the platform's own first-party marketing, separate from Coupons and sponsor placements.</p>
        </div>
        <button onClick={() => setEditing("new")} className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
          <Icon name="megaphoneOutline" className="h-4 w-4" />
          Add Promotion
        </button>
      </div>

      {!promotions?.length ? (
        <EmptyState
          icon={<Icon name="megaphoneOutline" className="h-6 w-6" />}
          heading="No promotions yet"
          explanation="A promotion shows as a banner on the public homepage while it's active and inside its date window."
          actionLabel="Add Promotion"
          onAction={() => setEditing("new")}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Headline</th>
                  <th className="px-4 py-3 font-medium">Window</th>
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {promotions.map((p) => (
                  <tr key={p.id} className="group hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-medium text-slate-100">{p.headline}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {p.starts_at ? formatDateTimeLagos(p.starts_at) : "Any time"} – {p.ends_at ? formatDateTimeLagos(p.ends_at) : "open-ended"}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-400">{p.display_order}</td>
                    <td className="px-4 py-3">
                      {isCurrentlyActive(p) ? (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">Live now</span>
                      ) : p.is_active ? (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">Active, outside window</span>
                      ) : (
                        <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-500">Inactive</span>
                      )}
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

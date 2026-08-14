import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";
import { Toggle, inputClass, selectClass } from "../../components/session/Panel";
import { formatNaira, formatCount, formatDateTimeLagos } from "../../lib/format";

interface Coupon {
  id: number;
  code: string;
  discount_type: "percent" | "fixed" | null;
  discount_value: string | number | null;
  applies_to: "all" | "content" | "plan" | null;
  target_id: number | null;
  max_redemptions: number | null;
  redemption_count: number;
  valid_from: string | null;
  valid_until: string | null;
  min_order_ngn: string | number | null;
  is_active: boolean;
  is_redeemable_now: boolean;
}

interface Plan {
  id: number;
  name: string | null;
}

interface FormState {
  code: string;
  discount_type: "percent" | "fixed";
  discount_value: string;
  applies_to: "all" | "content" | "plan";
  target_id: string;
  max_redemptions: string;
  valid_from: string;
  valid_until: string;
  min_order_ngn: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  code: "",
  discount_type: "percent",
  discount_value: "10",
  applies_to: "all",
  target_id: "",
  max_redemptions: "",
  valid_from: "",
  valid_until: "",
  min_order_ngn: "",
  is_active: true,
};

/** <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" with no timezone
 *  suffix; the API returns a full ISO string. Round-tripping through the
 *  browser's own Date parsing keeps this in the viewer's local time, same as
 *  every other admin datetime field in this codebase. */
function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function couponToForm(c: Coupon): FormState {
  return {
    code: c.code,
    discount_type: c.discount_type ?? "percent",
    discount_value: c.discount_value != null ? String(c.discount_value) : "0",
    applies_to: c.applies_to ?? "all",
    target_id: c.target_id != null ? String(c.target_id) : "",
    max_redemptions: c.max_redemptions != null ? String(c.max_redemptions) : "",
    valid_from: toDatetimeLocal(c.valid_from),
    valid_until: toDatetimeLocal(c.valid_until),
    min_order_ngn: c.min_order_ngn != null ? String(c.min_order_ngn) : "",
    is_active: c.is_active,
  };
}

/** Mirrors applyCoupon()'s own rejection order (server/src/routes/checkout.ts)
 *  so what the admin sees here is the same story a shopper would actually
 *  hit — not a status the two sides could quietly drift apart on. */
function couponStatus(c: Coupon): { label: string; tone: "green" | "gray" | "amber" | "blue" } {
  if (!c.is_active) return { label: "Inactive", tone: "gray" };
  const now = new Date();
  if (c.valid_from && new Date(c.valid_from) > now) return { label: "Scheduled", tone: "blue" };
  if (c.valid_until && new Date(c.valid_until) < now) return { label: "Expired", tone: "amber" };
  if (c.max_redemptions != null && c.redemption_count >= c.max_redemptions) return { label: "Fully redeemed", tone: "amber" };
  return { label: "Active", tone: "green" };
}

const TONE_CLASS: Record<string, string> = {
  green: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300",
  gray: "bg-slate-800 border-slate-700 text-slate-500",
  amber: "bg-amber-500/15 border-amber-500/30 text-amber-300",
  blue: "bg-blue-500/15 border-blue-500/30 text-blue-300",
};

function describeCoupon(form: FormState): string {
  const value = Number(form.discount_value) || 0;
  const discount = form.discount_type === "percent" ? `${value}% off` : `${formatNaira(value)} off`;
  const scope = form.applies_to === "all" ? "any purchase" : form.applies_to === "plan" ? "one plan" : "one piece of content";
  const min = Number(form.min_order_ngn) > 0 ? `, orders of ${formatNaira(form.min_order_ngn)}+` : "";
  const cap = form.max_redemptions ? `, ${form.max_redemptions} use${Number(form.max_redemptions) === 1 ? "" : "s"} max` : ", unlimited uses";
  const window = form.valid_from || form.valid_until ? ", limited-time" : ", no expiry";
  return `${discount} ${scope}${min}${cap}${window}.`;
}

function CouponSlideOver({ coupon, onClose, onSaved }: { coupon: Coupon | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(coupon ? couponToForm(coupon) : EMPTY_FORM);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  useEffect(() => {
    if (form.applies_to !== "plan" || plans) return;
    api<{ plans: Plan[] }>("/plans")
      .then((res) => setPlans(res.plans))
      .catch(() => setPlans([])); // a failed fetch falls back to manual ID entry below, not a dead end
  }, [form.applies_to, plans]);

  async function save() {
    const code = form.code.trim();
    if (!code) { setErr("A code is required."); return; }
    const discountValue = Number(form.discount_value);
    if (!Number.isFinite(discountValue) || discountValue < 0) { setErr("Discount must be zero or a positive number."); return; }
    if (form.discount_type === "percent" && discountValue > 100) { setErr("A percentage discount can't exceed 100."); return; }
    if (form.applies_to !== "all" && !form.target_id.trim()) {
      setErr(`Pick which ${form.applies_to} this coupon applies to, or switch to "All items".`);
      return;
    }

    setBusy(true);
    setErr(null);
    const payload = {
      code,
      discount_type: form.discount_type,
      discount_value: discountValue,
      applies_to: form.applies_to,
      target_id: form.applies_to === "all" ? null : Number(form.target_id) || null,
      max_redemptions: form.max_redemptions.trim() ? Number(form.max_redemptions) : null,
      valid_from: form.valid_from || null,
      valid_until: form.valid_until || null,
      min_order_ngn: form.min_order_ngn.trim() ? Number(form.min_order_ngn) : null,
      is_active: form.is_active,
    };
    try {
      if (coupon) {
        await api(`/coupons/${coupon.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await api("/coupons", { method: "POST", body: JSON.stringify(payload) });
      }
      toast(`Coupon ${coupon ? "updated" : "created"}.`);
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Failed to save coupon.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-slate-800 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">{coupon ? "Edit Coupon" : "Add Coupon"}</h2>
          <button onClick={onClose} className="text-xl leading-none text-slate-500 hover:text-slate-300">×</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Code</label>
            <input
              type="text"
              value={form.code}
              onChange={(e) => set("code", e.target.value.toUpperCase())}
              className={`${inputClass} font-mono uppercase tracking-wide`}
              placeholder="e.g. LAUNCH20"
              maxLength={40}
            />
            <p className="mt-1 text-xs text-slate-600">Shown uppercase for readability — shoppers can type it in any case.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Discount type</label>
              <select value={form.discount_type} onChange={(e) => set("discount_type", e.target.value as "percent" | "fixed")} className={selectClass}>
                <option value="percent">Percentage</option>
                <option value="fixed">Fixed amount (₦)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">{form.discount_type === "percent" ? "Discount %" : "Discount ₦"}</label>
              <input
                type="number"
                min={0}
                max={form.discount_type === "percent" ? 100 : undefined}
                value={form.discount_value}
                onChange={(e) => set("discount_value", e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Applies to</label>
            <select
              value={form.applies_to}
              onChange={(e) => { set("applies_to", e.target.value as FormState["applies_to"]); set("target_id", ""); }}
              className={selectClass}
            >
              <option value="all">All items</option>
              <option value="plan">One subscription plan</option>
              <option value="content">One piece of content</option>
            </select>
          </div>

          {form.applies_to === "plan" && (
            <div>
              <label className="mb-1 block text-xs text-slate-400">Plan</label>
              {plans === null ? (
                <Skeleton className="h-9 w-full" />
              ) : plans.length > 0 ? (
                <select value={form.target_id} onChange={(e) => set("target_id", e.target.value)} className={selectClass}>
                  <option value="">Select a plan…</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>{p.name ?? `Plan #${p.id}`}</option>
                  ))}
                </select>
              ) : (
                <input type="number" min={1} value={form.target_id} onChange={(e) => set("target_id", e.target.value)} className={inputClass} placeholder="Plan ID" />
              )}
            </div>
          )}

          {form.applies_to === "content" && (
            <div>
              <label className="mb-1 block text-xs text-slate-400">Content ID</label>
              <input type="number" min={1} value={form.target_id} onChange={(e) => set("target_id", e.target.value)} className={inputClass} placeholder="e.g. 42" />
              <p className="mt-1 text-xs text-slate-600">Find the ID in the URL when editing that session or course — a search picker isn't built yet.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Max redemptions</label>
              <input type="number" min={1} value={form.max_redemptions} onChange={(e) => set("max_redemptions", e.target.value)} className={inputClass} placeholder="Unlimited" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Minimum order ₦</label>
              <input type="number" min={0} value={form.min_order_ngn} onChange={(e) => set("min_order_ngn", e.target.value)} className={inputClass} placeholder="No minimum" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Valid from</label>
              <input type="datetime-local" value={form.valid_from} onChange={(e) => set("valid_from", e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Valid until</label>
              <input type="datetime-local" value={form.valid_until} onChange={(e) => set("valid_until", e.target.value)} className={inputClass} />
            </div>
          </div>

          <Toggle label="Active" description="Inactive coupons are refused at checkout but keep their redemption history." checked={form.is_active} onChange={(v) => set("is_active", v)} />

          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
            <span className="text-slate-500">Summary — </span>{describeCoupon(form)}
          </div>

          {err && <p className="text-sm text-red-400">{err}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Saving…" : coupon ? "Save changes" : "Create coupon"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Coupons() {
  const { toast } = useToast();
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [editing, setEditing] = useState<Coupon | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api<{ coupons: Coupon[] }>("/coupons")
      .then((res) => { setCoupons(res.coupons); setLoading(false); })
      .catch((err) => {
        setError(err.message ?? "Failed to load coupons.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(coupon: Coupon) {
    if (!confirm(`Delete "${coupon.code}"?`)) return;
    setDeletingId(coupon.id);
    try {
      await api(`/coupons/${coupon.id}`, { method: "DELETE" });
      setCoupons((prev) => prev?.filter((c) => c.id !== coupon.id) ?? null);
      toast("Coupon deleted.");
    } catch (e: any) {
      if (e.status === 409) {
        if (confirm(`${e.message}\n\nDeactivate instead?`)) {
          try {
            await api(`/coupons/${coupon.id}`, {
              method: "PUT",
              body: JSON.stringify({ ...coupon, discount_value: Number(coupon.discount_value), min_order_ngn: coupon.min_order_ngn != null ? Number(coupon.min_order_ngn) : null, is_active: false }),
            });
            load();
            toast("Coupon deactivated.");
          } catch (e2: any) {
            toast(e2.message ?? "Failed to deactivate.", "error");
          }
        }
      } else {
        toast(e.message ?? "Failed to delete coupon.", "error");
      }
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (error) return <ErrorState message={error} correlationId={correlationId} onRetry={load} />;

  return (
    <div className="space-y-5">
      {editing && (
        <CouponSlideOver
          coupon={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Coupons</h1>
          <p className="mt-1 text-sm text-slate-500">Discount codes for checkout — one-time purchases and subscriptions.</p>
        </div>
        <button onClick={() => setEditing("new")} className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
          <Icon name="tag" className="h-4 w-4" />
          Add Coupon
        </button>
      </div>

      {!coupons?.length ? (
        <EmptyState
          icon={<Icon name="tag" className="h-6 w-6" />}
          heading="No coupons yet"
          explanation="Create a code to run a discount on a purchase or a subscription plan."
          actionLabel="Add Coupon"
          onAction={() => setEditing("new")}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Code</th>
                  <th className="px-4 py-3 font-medium">Discount</th>
                  <th className="px-4 py-3 font-medium">Applies to</th>
                  <th className="px-4 py-3 font-medium">Redemptions</th>
                  <th className="px-4 py-3 font-medium">Window</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {coupons.map((c) => {
                  const status = couponStatus(c);
                  return (
                    <tr key={c.id} className="group hover:bg-slate-800/40">
                      <td className="px-4 py-3 font-mono font-medium text-slate-100">{c.code}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-300">
                        {c.discount_type === "percent" ? `${Number(c.discount_value)}%` : formatNaira(c.discount_value)}
                      </td>
                      <td className="px-4 py-3 text-slate-500 capitalize">
                        {c.applies_to === "all" ? "All items" : `${c.applies_to} #${c.target_id}`}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-400">
                        {formatCount(c.redemption_count)}{c.max_redemptions != null ? ` / ${formatCount(c.max_redemptions)}` : ""}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {c.valid_from || c.valid_until
                          ? `${c.valid_from ? formatDateTimeLagos(c.valid_from) : "—"} → ${c.valid_until ? formatDateTimeLagos(c.valid_until) : "—"}`
                          : "No expiry"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${TONE_CLASS[status.tone]}`}>{status.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setEditing(c)} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200">Edit</button>
                          <button onClick={() => handleDelete(c)} disabled={deletingId === c.id} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-900/30 hover:text-red-400 disabled:opacity-50">
                            {deletingId === c.id ? "…" : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

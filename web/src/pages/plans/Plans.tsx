import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";
import { Toggle, inputClass, selectClass } from "../../components/session/Panel";
import { formatCount, formatNaira, formatUsd } from "../../lib/format";

interface Plan {
  id: number;
  name: string | null;
  price_ngn: string | number | null;
  price_usd: string | number | null;
  billing_interval: "monthly" | "annual";
  features: string | null;
  max_concurrent_streams: number;
  seat_count: number;
  is_team_plan: boolean;
  is_active: boolean;
  subscriber_count: number;
}

interface FormState {
  name: string;
  price_ngn: string;
  /** Independent USD figure for Stripe checkout — optional, and not derived
   *  from price_ngn. Leaving it blank means no Stripe "Subscribe" option for
   *  this plan, Paystack only. */
  price_usd: string;
  billing_interval: "monthly" | "annual";
  features: string;
  max_concurrent_streams: string;
  seat_count: string;
  is_team_plan: boolean;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  price_ngn: "",
  price_usd: "",
  billing_interval: "monthly",
  features: "",
  max_concurrent_streams: "1",
  seat_count: "1",
  is_team_plan: false,
  is_active: true,
};

function planToForm(p: Plan): FormState {
  return {
    name: p.name ?? "",
    price_ngn: p.price_ngn != null ? String(p.price_ngn) : "0",
    price_usd: p.price_usd != null ? String(p.price_usd) : "",
    billing_interval: p.billing_interval,
    features: p.features ?? "",
    max_concurrent_streams: String(p.max_concurrent_streams),
    seat_count: String(p.seat_count),
    is_team_plan: p.is_team_plan,
    is_active: p.is_active,
  };
}

// ─── Pricing preview — renders exactly what the public pricing page shows ────

function PricingPreview({ form }: { form: FormState }) {
  const price = Number(form.price_ngn) || 0;
  const features = form.features
    .replace(/<[^>]+>/g, "\n")
    .split(/\n|<li>/)
    .map((f) => f.trim())
    .filter(Boolean);

  return (
    <div className="rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 p-6">
      <p className="text-sm font-semibold text-slate-100">{form.name || "Plan name"}</p>
      <p className="mt-3 text-3xl font-bold text-slate-100">
        {price === 0 ? "Free" : formatNaira(price)}
        {price > 0 && <span className="text-sm font-normal text-slate-500"> / {form.billing_interval === "monthly" ? "month" : "year"}</span>}
      </p>
      {form.price_usd.trim() && Number(form.price_usd) > 0 && (
        <p className="mt-0.5 text-sm text-slate-500">
          or {formatUsd(Number(form.price_usd))} / {form.billing_interval === "monthly" ? "month" : "year"} via card
        </p>
      )}
      {form.is_team_plan && (
        <span className="mt-2 inline-block rounded-full bg-blue-500/15 border border-blue-500/30 px-2 py-0.5 text-xs text-blue-300">
          Team plan · {form.seat_count} seat{Number(form.seat_count) === 1 ? "" : "s"}
        </span>
      )}
      <ul className="mt-4 space-y-2">
        {features.length ? features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
            <span className="mt-0.5 text-emerald-400">✓</span>
            {f}
          </li>
        )) : (
          <li className="text-sm text-slate-600">Add description bullets to preview them here.</li>
        )}
        <li className="flex items-start gap-2 text-sm text-slate-400">
          <span className="mt-0.5 text-emerald-400">✓</span>
          {form.max_concurrent_streams} concurrent stream{Number(form.max_concurrent_streams) === 1 ? "" : "s"}
        </li>
      </ul>
      <button disabled className="mt-5 w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white opacity-90">
        {price === 0 ? "Get started free" : "Subscribe"}
      </button>
    </div>
  );
}

function PlanSlideOver({ plan, onClose, onSaved }: { plan: Plan | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(plan ? planToForm(plan) : EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    if (!form.name.trim()) { setErr("Plan name is required."); return; }
    const price = Number(form.price_ngn);
    if (!Number.isFinite(price) || price < 0) { setErr("Price must be zero or a positive number."); return; }

    setBusy(true);
    setErr(null);
    const payload = {
      name: form.name.trim(),
      price_ngn: price,
      price_usd: form.price_usd.trim() ? Number(form.price_usd) : null,
      billing_interval: form.billing_interval,
      features: form.features.trim() || null,
      max_concurrent_streams: Number(form.max_concurrent_streams) || 1,
      seat_count: Number(form.seat_count) || 1,
      is_team_plan: form.is_team_plan,
      is_active: form.is_active,
    };
    try {
      if (plan) {
        await api(`/plans/${plan.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await api("/plans", { method: "POST", body: JSON.stringify(payload) });
      }
      toast(`Plan ${plan ? "updated" : "created"}.`);
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Failed to save plan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-3xl flex-col overflow-y-auto border-l border-slate-800 bg-slate-900 shadow-2xl lg:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Form */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-100">{plan ? "Edit Plan" : "Add Plan"}</h2>
            <button onClick={onClose} className="text-xl leading-none text-slate-500 hover:text-slate-300">×</button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Plan name</label>
              <input type="text" value={form.name} onChange={(e) => set("name", e.target.value)} className={inputClass} placeholder="e.g. Pro" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Price ₦</label>
                <input type="number" min={0} value={form.price_ngn} onChange={(e) => set("price_ngn", e.target.value)} className={inputClass} placeholder="0" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Billing interval</label>
                <select value={form.billing_interval} onChange={(e) => set("billing_interval", e.target.value as "monthly" | "annual")} className={selectClass}>
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Price $</label>
                <input type="number" min={0} value={form.price_usd} onChange={(e) => set("price_usd", e.target.value)} className={inputClass} placeholder="Optional" />
                <p className="mt-1 text-xs text-slate-600">Optional — enables a Stripe checkout option alongside Paystack.</p>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-400">Description (what's included)</label>
              <textarea
                rows={5}
                value={form.features}
                onChange={(e) => set("features", e.target.value)}
                className={inputClass}
                placeholder={"One line per feature, e.g.\nUnlimited live sessions\nHD replays\nCertificates of completion"}
              />
              <p className="mt-1 text-xs text-slate-600">Shown on the public pricing page — one bullet per line.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Max concurrent streams</label>
                <input type="number" min={1} value={form.max_concurrent_streams} onChange={(e) => set("max_concurrent_streams", e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Seat count</label>
                <input type="number" min={1} value={form.seat_count} onChange={(e) => set("seat_count", e.target.value)} disabled={!form.is_team_plan} className={inputClass} />
              </div>
            </div>

            <Toggle label="Team plan" description="Allows multiple seats under one subscription." checked={form.is_team_plan} onChange={(v) => set("is_team_plan", v)} />
            <Toggle label="Active" description="Inactive plans are hidden from the pricing page but keep existing subscribers." checked={form.is_active} onChange={(v) => set("is_active", v)} />

            {err && <p className="text-sm text-red-400">{err}</p>}
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
            <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
              {busy ? "Saving…" : plan ? "Save changes" : "Create plan"}
            </button>
          </div>
        </div>

        {/* Live pricing preview */}
        <div className="w-full flex-shrink-0 border-t border-slate-800 bg-slate-950/60 p-6 lg:w-80 lg:border-l lg:border-t-0">
          <p className="mb-3 text-xs font-medium text-slate-500">Pricing page preview</p>
          <PricingPreview form={form} />
        </div>
      </div>
    </div>
  );
}

export function Plans() {
  const { toast } = useToast();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [editingPlan, setEditingPlan] = useState<Plan | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [seedingFree, setSeedingFree] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api<{ plans: Plan[] }>("/plans")
      .then((res) => { setPlans(res.plans); setLoading(false); })
      .catch((err) => {
        setError(err.message ?? "Failed to load plans.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(plan: Plan) {
    if (!confirm(`Delete "${plan.name}"?`)) return;
    setDeletingId(plan.id);
    try {
      await api(`/plans/${plan.id}`, { method: "DELETE" });
      setPlans((prev) => prev?.filter((p) => p.id !== plan.id) ?? null);
      toast("Plan deleted.");
    } catch (e: any) {
      if (e.status === 409) {
        if (confirm(`${e.message}\n\nDeactivate instead?`)) {
          try {
            await api(`/plans/${plan.id}`, {
              method: "PUT",
              body: JSON.stringify({
                ...plan,
                price_ngn: Number(plan.price_ngn),
                price_usd: plan.price_usd != null ? Number(plan.price_usd) : null,
                is_active: false,
              }),
            });
            load();
            toast("Plan deactivated.");
          } catch (e2: any) {
            toast(e2.message ?? "Failed to deactivate.", "error");
          }
        }
      } else {
        toast(e.message ?? "Failed to delete plan.", "error");
      }
    } finally {
      setDeletingId(null);
    }
  }

  async function seedFreePlan() {
    setSeedingFree(true);
    try {
      const res = await api<{ created: boolean }>("/plans/seed-free", { method: "POST" });
      toast(res.created ? "Free plan created." : "A Free plan already exists.");
      load();
    } catch (e: any) {
      toast(e.message ?? "Failed to seed free plan.", "error");
    } finally {
      setSeedingFree(false);
    }
  }

  if (loading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (error) return <ErrorState message={error} correlationId={correlationId} onRetry={load} />;

  return (
    <div className="space-y-5">
      {editingPlan && (
        <PlanSlideOver
          plan={editingPlan === "new" ? null : editingPlan}
          onClose={() => setEditingPlan(null)}
          onSaved={() => { setEditingPlan(null); load(); }}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Plans</h1>
          <p className="mt-1 text-sm text-slate-500">This sets the revenue architecture of the platform — take care.</p>
        </div>
        <div className="flex gap-2">
          {!plans?.some((p) => p.name === "Free") && (
            <button onClick={seedFreePlan} disabled={seedingFree} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50">
              {seedingFree ? "Adding…" : "Add a free plan"}
            </button>
          )}
          <button onClick={() => setEditingPlan("new")} className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
            <Icon name="wallet" className="h-4 w-4" />
            Add Plan
          </button>
        </div>
      </div>

      {!plans?.length ? (
        <EmptyState
          icon={<Icon name="wallet" className="h-6 w-6" />}
          heading="No plans yet"
          explanation="Create a plan so visitors can subscribe. Free tiers help with acquisition — Pro tiers drive revenue."
          actionLabel="Add Plan"
          onAction={() => setEditingPlan("new")}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-4 py-3 font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">Interval</th>
                  <th className="px-4 py-3 font-medium">Streams</th>
                  <th className="px-4 py-3 font-medium">Subscribers</th>
                  <th className="px-4 py-3 font-medium">Active</th>
                  <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {plans.map((p) => (
                  <tr key={p.id} className="group hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-100">{p.name}</p>
                      {p.is_team_plan && <span className="text-xs text-blue-400">Team · {p.seat_count} seats</span>}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-300">
                      {Number(p.price_ngn) === 0 ? "Free" : formatNaira(p.price_ngn)}
                      {p.price_usd != null && Number(p.price_usd) > 0 && (
                        <span className="ml-1.5 text-xs text-slate-500">/ {formatUsd(p.price_usd)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 capitalize">{p.billing_interval}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-400">{p.max_concurrent_streams}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-400">{formatCount(p.subscriber_count)}</td>
                    <td className="px-4 py-3">
                      {p.is_active ? (
                        <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-xs text-emerald-300">Active</span>
                      ) : (
                        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-500">Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setEditingPlan(p)} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200">Edit</button>
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

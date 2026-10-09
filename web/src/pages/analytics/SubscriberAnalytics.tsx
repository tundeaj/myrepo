import { useState, useEffect } from "react";
import { CartesianGrid, Legend, Line, LineChart, Pie, PieChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, getToken } from "../../lib/api";
import { useApi } from "../../hooks/useApi";
import { useToast } from "../../components/Toast";
import { StatTile } from "../../components/StatTile";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";
import { formatCount, formatDateTimeLagos } from "../../lib/format";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface StatsResponse { total_active: number; new_today: number; cancelled_this_month: number; }
interface GrowthPoint { month: string; active: number; new: number; cancelled: number; }
interface BreakdownRow { status: string; count: number; }

interface Subscriber {
  id: number;
  user: { id: number; name: string; email: string } | null;
  plan: { id: number; name: string | null; billing_interval: string } | null;
  start_date: string;
  current_period_end: string | null;
  signed_in_device: string | null;
  status: string;
}
interface ListResponse {
  subscribers: Subscriber[];
  meta: { total: number; page: number; per_page: number; pages: number };
}
interface Plan { id: number; name: string | null; }

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  paused: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
  past_due: "bg-orange-500/15 text-orange-300 border border-orange-500/30",
  cancelled: "bg-slate-800 text-slate-400",
  expired: "bg-slate-800 text-slate-500",
};

const DONUT_COLORS: Record<string, string> = {
  active: "#10b981",
  paused: "#f59e0b",
  past_due: "#f97316",
  cancelled: "#475569",
  expired: "#334155",
};

function monthLabel(m: string): string {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-NG", { month: "short" });
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export function SubscriberAnalytics() {
  const { toast } = useToast();
  const stats = useApi<StatsResponse>("/analytics/subscribers/stats");
  const growth = useApi<{ series: GrowthPoint[] }>("/analytics/subscribers/growth");
  const breakdown = useApi<{ breakdown: BreakdownRow[] }>("/analytics/subscribers/status-breakdown");

  const [plans, setPlans] = useState<Plan[]>([]);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [planId, setPlanId] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api<{ plans: Plan[] }>("/plans").then((res) => setPlans(res.plans)).catch(() => setPlans([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), per_page: "25" });
    if (planId) params.set("plan_id", planId);
    if (status) params.set("status", status);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    api<ListResponse>(`/analytics/subscribers?${params}`)
      .then((res) => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message ?? "Failed to load subscribers.");
          setCorrelationId(err.correlationId);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [page, planId, status, from, to, reloadKey]);

  async function cancelSub(sub: Subscriber) {
    if (!confirm(`Cancel ${sub.user?.name ?? "this subscriber"}'s subscription?`)) return;
    setCancellingId(sub.id);
    try {
      await api(`/analytics/subscribers/${sub.id}/cancel`, { method: "POST" });
      setData((prev) => prev ? { ...prev, subscribers: prev.subscribers.map((s) => (s.id === sub.id ? { ...s, status: "cancelled" } : s)) } : prev);
      toast("Subscription cancelled.");
    } catch (e: any) {
      toast(e.message ?? "Failed to cancel.", "error");
    } finally {
      setCancellingId(null);
    }
  }

  function exportCsv() {
    setExporting(true);
    const params = new URLSearchParams();
    if (planId) params.set("plan_id", planId);
    if (status) params.set("status", status);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const token = getToken();
    fetch(`/api/analytics/subscribers/export-csv?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `subscribers-${Date.now()}.csv`; a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => toast("Export failed.", "error"))
      .finally(() => setExporting(false));
  }

  const meta = data?.meta;
  const donutTotal = breakdown.data?.breakdown.reduce((s, b) => s + b.count, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Subscriber Analytics</h1>
        <p className="mt-1 text-sm text-slate-500">Subscription growth, health and the current subscriber list.</p>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Total active subscriptions" value={stats.loading ? "…" : formatCount(stats.data?.total_active ?? 0)} />
        <StatTile label="New today" value={stats.loading ? "…" : formatCount(stats.data?.new_today ?? 0)} tone="good" />
        <StatTile label="Cancelled this month" value={stats.loading ? "…" : formatCount(stats.data?.cancelled_this_month ?? 0)} tone={stats.data?.cancelled_this_month ? "warn" : "neutral"} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Growth line chart */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 lg:col-span-2">
          <p className="mb-4 text-xs font-medium text-slate-400">Subscription growth (12 months)</p>
          {growth.loading ? (
            <Skeleton className="h-56 w-full" />
          ) : growth.error ? (
            <ErrorState message={growth.error} onRetry={growth.retry} />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={(growth.data?.series ?? []).map((s) => ({ ...s, label: monthLabel(s.month) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#94a3b8" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="active" name="Active" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="new" name="New" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="cancelled" name="Cancelled" stroke="#ef4444" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Status donut */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <p className="mb-4 text-xs font-medium text-slate-400">Subscription status</p>
          {breakdown.loading ? (
            <Skeleton className="h-56 w-full" />
          ) : !donutTotal ? (
            <div className="flex h-56 items-center justify-center text-sm text-slate-600">No subscriptions yet.</div>
          ) : (
            <>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={breakdown.data!.breakdown.filter((b) => b.count > 0)}
                      dataKey="count"
                      nameKey="status"
                      innerRadius={40}
                      outerRadius={65}
                      paddingAngle={2}
                    >
                      {breakdown.data!.breakdown.filter((b) => b.count > 0).map((b) => (
                        <Cell key={b.status} fill={DONUT_COLORS[b.status] ?? "#64748b"} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {breakdown.data!.breakdown.filter((b) => b.count > 0).map((b) => (
                  <div key={b.status} className="flex items-center gap-1.5 text-xs">
                    <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: DONUT_COLORS[b.status] }} />
                    <span className="text-slate-400 capitalize">{b.status.replace(/_/g, " ")}</span>
                    <span className="ml-auto tabular-nums text-slate-500">{formatCount(b.count)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={planId} onChange={(e) => { setPlanId(e.target.value); setPage(1); }} className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none">
          <option value="">All plans</option>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="past_due">Past due</option>
          <option value="cancelled">Cancelled</option>
          <option value="expired">Expired</option>
        </select>
        <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none" />
        <span className="text-xs text-slate-600">to</span>
        <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none" />
        <button onClick={exportCsv} disabled={exporting} className="ml-auto flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-400 hover:border-slate-600 hover:text-slate-200 disabled:opacity-50">
          <Icon name="file" className="h-4 w-4" />
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      {/* Subscriber list */}
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : error ? (
        <ErrorState message={error} correlationId={correlationId} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : !data?.subscribers.length ? (
        <EmptyState icon={<Icon name="users" className="h-6 w-6" />} heading="No subscribers found" explanation="Try changing your filters." variant="filtered" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-4 py-3 font-medium">Interval</th>
                  <th className="px-4 py-3 font-medium">Start date</th>
                  <th className="px-4 py-3 font-medium">Period end</th>
                  <th className="px-4 py-3 font-medium">Device</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {data.subscribers.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-100">{s.user?.name ?? "—"}</p>
                      <p className="text-xs text-slate-600">{s.user?.email ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{s.plan?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500 capitalize">{s.plan?.billing_interval ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{formatDateTimeLagos(s.start_date)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{s.current_period_end ? formatDateTimeLagos(s.current_period_end) : "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{s.signed_in_device ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[s.status] ?? "bg-slate-800 text-slate-400"}`}>
                        {s.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {s.status !== "cancelled" && (
                          <button onClick={() => cancelSub(s)} disabled={cancellingId === s.id} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-900/30 hover:text-red-400 disabled:opacity-50">
                            {cancellingId === s.id ? "…" : "Cancel"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {meta && meta.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">Page {meta.page} of {meta.pages} · {formatCount(meta.total)} subscribers</p>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-600 disabled:opacity-40">← Previous</button>
            <button disabled={page === meta.pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-600 disabled:opacity-40">Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useApi } from "../../hooks/useApi";
import { Icon } from "../../components/Icon";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { formatCount, formatNaira, formatDateTimeLagos } from "../../lib/format";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface EarningsResponse {
  monthly: { month: string; earned_ngn: number }[];
  per_content: {
    content_id: number;
    title: string;
    content_type: string;
    registrations: number;
    attendance: number;
    avg_rating: number;
    rating_count: number;
    earned_ngn: number;
  }[];
  payouts: {
    id: number;
    gross_ngn: number;
    wht_amount_ngn: number;
    net_ngn: number;
    status: string;
    paid_at: string | null;
    payment_reference: string | null;
    statement_url: string | null;
  }[];
}

function monthLabel(m: string): string {
  const [y, mo] = m.split("-");
  const date = new Date(Number(y), Number(mo) - 1, 1);
  return date.toLocaleDateString("en-NG", { month: "short" });
}

const PAYOUT_STATUS_STYLES: Record<string, string> = {
  paid: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  pending: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
  processing: "bg-blue-500/15 text-blue-300 border border-blue-500/30",
  failed: "bg-red-500/15 text-red-300 border border-red-500/30",
};

// ─── Main page ─────────────────────────────────────────────────────────────────

export function Earnings() {
  const { data, loading, error, correlationId, retry } = useApi<EarningsResponse>("/portal/earnings");

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (error) return <ErrorState message={error} correlationId={correlationId ?? undefined} onRetry={retry} />;

  const monthly = data?.monthly ?? [];
  const perContent = data?.per_content ?? [];
  const payouts = data?.payouts ?? [];
  const total12mo = monthly.reduce((s, m) => s + m.earned_ngn, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Earnings</h1>
        <p className="text-sm text-slate-500">{formatNaira(total12mo)} earned in the last 12 months</p>
      </div>

      {/* 12-month bar chart */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <p className="mb-4 text-xs font-medium text-slate-400">Monthly earnings (₦)</p>
        {monthly.every((m) => m.earned_ngn === 0) ? (
          <p className="py-8 text-center text-sm text-slate-600">No earnings recorded yet.</p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly.map((m) => ({ ...m, label: monthLabel(m.month) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fill: "#64748b", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => (v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
                />
                <Tooltip
                  cursor={{ fill: "rgba(148,163,184,0.06)" }}
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#94a3b8" }}
                  formatter={(value: number) => [formatNaira(value), "Earned"]}
                />
                <Bar dataKey="earned_ngn" fill="#e50914" radius={[3, 3, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Per-content table */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Per content</h2>
        {!perContent.length ? (
          <EmptyState
            icon={<Icon name="wallet" className="h-6 w-6" />}
            heading="No content earnings yet"
            explanation="Once your content generates revenue, the breakdown will appear here."
            variant="filtered"
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-800">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-800">
                  <tr className="text-left text-xs text-slate-500">
                    <th className="px-4 py-3 font-medium">Content</th>
                    <th className="px-4 py-3 font-medium">Registrations</th>
                    <th className="px-4 py-3 font-medium">Attendance</th>
                    <th className="px-4 py-3 font-medium">Rating</th>
                    <th className="px-4 py-3 font-medium text-right">Earnings</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                  {perContent.map((c) => (
                    <tr key={c.content_id} className="hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-100">{c.title}</p>
                        <p className="text-xs text-slate-600 capitalize">{c.content_type === "webinar" ? "Live session" : c.content_type}</p>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-400">{formatCount(c.registrations)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-400">{formatCount(c.attendance)}</td>
                      <td className="px-4 py-3 text-slate-400">
                        {c.rating_count > 0 ? (
                          <span>★ {c.avg_rating.toFixed(1)} <span className="text-slate-600">({formatCount(c.rating_count)})</span></span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-100">{formatNaira(c.earned_ngn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Payment history */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Payment history</h2>
        {!payouts.length ? (
          <p className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 px-4 py-6 text-center text-sm text-slate-500">
            No payouts yet. Payouts run monthly once your payout details are verified.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-800">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-800">
                  <tr className="text-left text-xs text-slate-500">
                    <th className="px-4 py-3 font-medium">Gross</th>
                    <th className="px-4 py-3 font-medium">WHT</th>
                    <th className="px-4 py-3 font-medium">Net</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Paid</th>
                    <th className="px-4 py-3 font-medium">Reference</th>
                    <th className="px-4 py-3 font-medium"><span className="sr-only">Statement</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                  {payouts.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-800/40">
                      <td className="px-4 py-3 tabular-nums text-slate-400">{formatNaira(p.gross_ngn)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-500">{p.wht_amount_ngn ? `−${formatNaira(p.wht_amount_ngn)}` : "—"}</td>
                      <td className="px-4 py-3 font-medium tabular-nums text-slate-100">{formatNaira(p.net_ngn)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PAYOUT_STATUS_STYLES[p.status] ?? "bg-slate-800 text-slate-400"}`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{p.paid_at ? formatDateTimeLagos(p.paid_at) : "—"}</td>
                      <td className="px-4 py-3 text-xs font-mono text-slate-500">{p.payment_reference ?? "—"}</td>
                      <td className="px-4 py-3 text-right">
                        {p.statement_url ? (
                          <a href={p.statement_url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand hover:underline">
                            Statement
                          </a>
                        ) : (
                          <span className="text-xs text-slate-700">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

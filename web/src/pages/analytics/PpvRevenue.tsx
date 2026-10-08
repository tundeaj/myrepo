import { useState } from "react";
import { useApi } from "../../hooks/useApi";
import { StatTile } from "../../components/StatTile";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";
import { formatCount, formatNaira, formatUsd } from "../../lib/format";

interface PpvStats { total_orders: number; gross_ngn: number; gross_usd: number; }
interface PpvContentRow {
  content_id: number;
  title: string | null;
  orders: number;
  gross_ngn: number;
  gross_usd: number;
  speaker_earned_ngn: number;
  speaker_paid_ngn: number;
}
interface PpvPayload { range_days: number; stats: PpvStats; top_content: PpvContentRow[]; }

/**
 * Real pay-per-view revenue — `Order` rows with order_type: 'direct' and a
 * content_id, i.e. an individual content purchase rather than a plan
 * subscription — cross-referenced with the speaker's real accrued/paid
 * share from EarningLine. `ContentUsage.revenue_ngn` looked like the
 * obvious source but is entirely dead schema (nothing writes to it); this
 * reads from Order/EarningLine instead. See routes/ppvRevenue.ts.
 */
export function PpvRevenue() {
  const [range, setRange] = useState("30");
  const { data, loading, error, retry } = useApi<PpvPayload>(`/analytics/ppv-revenue?range=${range}`, [range]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">PPV &amp; Revenue Analytics</h1>
          <p className="mt-1 text-sm text-slate-500">Real revenue from individual content purchases — NGN and USD tracked separately, never combined.</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-slate-800 p-1">
          {["7", "30", "90"].map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded px-3 py-1 text-xs ${range === r ? "bg-slate-800 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={retry} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile label="PPV orders" value={loading ? "…" : formatCount(data?.stats.total_orders ?? 0)} />
            <StatTile label="Gross revenue (₦)" value={loading ? "…" : formatNaira(data?.stats.gross_ngn ?? 0)} tone="good" />
            <StatTile label="Gross revenue ($)" value={loading ? "…" : formatUsd(data?.stats.gross_usd ?? 0)} />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
            <p className="mb-4 text-xs font-medium text-slate-400">Revenue by content</p>
            {loading ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : !data?.top_content.length ? (
              <EmptyState icon={<Icon name="chart" className="h-6 w-6" />} heading="No PPV purchases yet" explanation="Individual content purchases will appear here, broken down per item." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500">
                      <th className="pb-2 font-medium">Content</th>
                      <th className="pb-2 font-medium">Orders</th>
                      <th className="pb-2 font-medium">Gross (₦)</th>
                      <th className="pb-2 font-medium">Gross ($)</th>
                      <th className="pb-2 font-medium">Speaker earned</th>
                      <th className="pb-2 font-medium">Speaker paid</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {data.top_content.map((c) => (
                      <tr key={c.content_id}>
                        <td className="max-w-[220px] truncate py-2 text-slate-300">{c.title ?? `#${c.content_id}`}</td>
                        <td className="py-2 tabular-nums text-slate-400">{formatCount(c.orders)}</td>
                        <td className="py-2 tabular-nums text-slate-100 font-medium">{formatNaira(c.gross_ngn)}</td>
                        <td className="py-2 tabular-nums text-slate-400">{c.gross_usd ? formatUsd(c.gross_usd) : "—"}</td>
                        <td className="py-2 tabular-nums text-slate-400">{formatNaira(c.speaker_earned_ngn)}</td>
                        <td className="py-2 tabular-nums text-slate-500">{formatNaira(c.speaker_paid_ngn)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

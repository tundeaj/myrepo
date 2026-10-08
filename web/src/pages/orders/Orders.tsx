import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { selectClass, inputClass } from "../../components/session/Panel";
import { formatNaira, formatUsd, formatCount, formatDateTimeLagos } from "../../lib/format";

interface Order {
  id: number;
  buyer: { id: number; name: string; email: string } | null;
  item: { type: "content" | "plan"; id: number; title: string | null } | null;
  amount: number;
  currency: string;
  status: "pending" | "paid" | "failed" | "refunded";
  order_type: "direct" | "corporate_invoice";
  payment_provider: "paystack" | "stripe";
  invoice_requested: boolean;
  created_at: string;
}
interface ListResponse { orders: Order[]; meta: { total: number; page: number; per_page: number; pages: number }; }

const STATUS_STYLES: Record<Order["status"], string> = {
  pending: "bg-slate-800 text-slate-400",
  paid: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  failed: "bg-red-500/15 text-red-300 border border-red-500/30",
  refunded: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
};
const ORDER_TYPE_LABELS: Record<Order["order_type"], string> = { direct: "Direct", corporate_invoice: "Corporate invoice" };

function formatAmount(order: Order): string {
  return order.currency === "USD" ? formatUsd(order.amount) : formatNaira(order.amount);
}

/**
 * The "Orders" half of this page — every checkout transaction, any
 * order_type, read-only (a financial record isn't edited here, same call
 * Invoices and Subscriber Analytics both already make for their own lists).
 * "Subscriptions" already has a real admin surface — list/filter/cancel/CSV
 * export — at /admin/analytics/subscribers; this page links there rather
 * than duplicating it.
 */
export function Orders() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [orderType, setOrderType] = useState("");
  const [status, setStatus] = useState("");
  const [provider, setProvider] = useState("");
  const [search, setSearch] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(() => setReloadKey((k) => k + 1), []);

  // One debounce covers every filter, not just search — harmless for a
  // select (nobody notices 250ms on a click) and it keeps this to a single
  // effect instead of two effects racing to trigger the same fetch.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const t = setTimeout(() => {
      const params = new URLSearchParams({ page: String(page), per_page: "25" });
      if (orderType) params.set("order_type", orderType);
      if (status) params.set("status", status);
      if (provider) params.set("payment_provider", provider);
      if (search.trim()) params.set("search", search.trim());
      api<ListResponse>(`/orders?${params}`)
        .then((res) => { if (!cancelled) { setData(res); setLoading(false); } })
        .catch((err) => {
          if (!cancelled) {
            setError(err.message ?? "Failed to load orders.");
            setCorrelationId(err.correlationId);
            setLoading(false);
          }
        });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [page, orderType, status, provider, search, reloadKey]);

  const meta = data?.meta;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Subscriptions &amp; Orders</h1>
          <p className="mt-1 text-sm text-slate-500">{loading ? "Loading…" : `${formatCount(meta?.total ?? 0)} order${meta?.total === 1 ? "" : "s"}`} — every checkout transaction, content purchases and plan subscriptions alike.</p>
        </div>
        <Link to="/admin/analytics/subscribers" className="flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">
          <Icon name="credit" className="h-4 w-4" />
          View Subscriptions
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by buyer name or email…"
          className={`${inputClass} max-w-xs`}
        />
        <select value={orderType} onChange={(e) => { setOrderType(e.target.value); setPage(1); }} className={selectClass}>
          <option value="">All types</option>
          <option value="direct">Direct</option>
          <option value="corporate_invoice">Corporate invoice</option>
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={selectClass}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="failed">Failed</option>
          <option value="refunded">Refunded</option>
        </select>
        <select value={provider} onChange={(e) => { setProvider(e.target.value); setPage(1); }} className={selectClass}>
          <option value="">All providers</option>
          <option value="paystack">Paystack</option>
          <option value="stripe">Stripe</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : error ? (
        <ErrorState message={error} correlationId={correlationId} onRetry={load} />
      ) : !data?.orders.length ? (
        <EmptyState icon={<Icon name="credit" className="h-6 w-6" />} heading="No orders match these filters" explanation="Every checkout transaction — content purchases and plan subscriptions — will show up here." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Buyer</th>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {data.orders.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <p className="text-slate-300">{o.buyer?.name ?? "—"}</p>
                      <p className="text-xs text-slate-600">{o.buyer?.email}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 max-w-[160px] truncate">{o.item?.title ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{ORDER_TYPE_LABELS[o.order_type]}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-100 font-medium">{formatAmount(o)}</td>
                    <td className="px-4 py-3 text-xs capitalize text-slate-500">{o.payment_provider}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[o.status]}`}>{o.status}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{formatDateTimeLagos(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {meta && meta.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">Page {meta.page} of {meta.pages} · {formatCount(meta.total)} orders</p>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-600 disabled:opacity-40">← Previous</button>
            <button disabled={page === meta.pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-600 disabled:opacity-40">Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}

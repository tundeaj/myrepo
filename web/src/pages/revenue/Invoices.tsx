import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";
import { inputClass, selectClass } from "../../components/session/Panel";
import { formatCount, formatNaira, formatDateTimeLagos } from "../../lib/format";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Invoice {
  id: number;
  invoice_number: string | null;
  company_name: string | null;
  buyer: { id: number; name: string; email: string } | null;
  amount_ngn: number;
  item: { type: "content" | "plan"; id: number; title: string | null } | null;
  requested_date: string;
  due_date: string | null;
  invoice_url: string | null;
  display_status: "pending" | "sent" | "paid" | "overdue";
}
interface ListResponse { invoices: Invoice[]; meta: { total: number; page: number; per_page: number; pages: number }; }
interface ContentOption { id: number; title: string; }
interface PlanOption { id: number; name: string | null; }

const STATUS_STYLES: Record<Invoice["display_status"], string> = {
  pending: "bg-slate-800 text-slate-400",
  sent: "bg-blue-500/15 text-blue-300 border border-blue-500/30",
  paid: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  overdue: "bg-red-500/15 text-red-300 border border-red-500/30",
};
const STATUS_LABELS: Record<Invoice["display_status"], string> = { pending: "Pending", sent: "Sent", paid: "Paid", overdue: "Overdue" };

// ─── Create invoice modal ──────────────────────────────────────────────────────

function CreateInvoiceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [buyerEmail, setBuyerEmail] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [itemType, setItemType] = useState<"content" | "plan">("plan");
  const [contentQuery, setContentQuery] = useState("");
  const [contentResults, setContentResults] = useState<{ id: number; title: string }[]>([]);
  const [contentId, setContentId] = useState<number | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [planId, setPlanId] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ plans: PlanOption[] }>("/plans").then((res) => setPlans(res.plans)).catch(() => setPlans([]));
  }, []);

  useEffect(() => {
    if (itemType !== "content" || !contentQuery.trim()) { setContentResults([]); return; }
    const t = setTimeout(() => {
      api<{ courses: { id: number; title: string }[] }>(`/courses?q=${encodeURIComponent(contentQuery)}&per_page=8`)
        .then((res) => setContentResults(res.courses))
        .catch(() => setContentResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [contentQuery, itemType]);

  async function submit() {
    setErr(null);
    if (!buyerEmail.trim()) { setErr("Buyer email is required."); return; }
    if (itemType === "content" && !contentId) { setErr("Select content for this invoice."); return; }
    if (itemType === "plan" && !planId) { setErr("Select a plan for this invoice."); return; }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) { setErr("Enter a valid amount."); return; }
    if (!dueDate) { setErr("Due date is required."); return; }

    setBusy(true);
    try {
      await api("/invoices", {
        method: "POST",
        body: JSON.stringify({
          buyer_email: buyerEmail.trim(),
          buyer_name: buyerName.trim() || undefined,
          company_name: companyName.trim() || undefined,
          content_id: itemType === "content" ? contentId : undefined,
          plan_id: itemType === "plan" ? Number(planId) : undefined,
          amount_ngn: amt,
          due_date: dueDate,
          notes: notes.trim() || undefined,
        }),
      });
      onCreated();
    } catch (e: any) {
      setErr(e.message ?? "Failed to create invoice.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-sm font-semibold text-slate-100">Create Invoice</h2>
        <p className="mb-4 text-xs text-slate-500">Generates a PDF and emails it to the buyer immediately.</p>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Buyer email</label>
              <input type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} className={inputClass} placeholder="buyer@company.com" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Buyer name</label>
              <input type="text" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className={inputClass} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Company name</label>
            <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={inputClass} />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Invoice for</label>
            <div className="flex rounded-lg border border-slate-800 overflow-hidden">
              <button type="button" onClick={() => setItemType("plan")} className={`flex-1 py-2 text-xs font-medium ${itemType === "plan" ? "bg-slate-800 text-slate-100" : "text-slate-500"}`}>Plan / subscription</button>
              <button type="button" onClick={() => setItemType("content")} className={`flex-1 py-2 text-xs font-medium border-l border-slate-800 ${itemType === "content" ? "bg-slate-800 text-slate-100" : "text-slate-500"}`}>Content</button>
            </div>
          </div>

          {itemType === "plan" ? (
            <div>
              <label className="mb-1 block text-xs text-slate-400">Plan</label>
              <select value={planId} onChange={(e) => setPlanId(e.target.value)} className={selectClass}>
                <option value="">Select a plan…</option>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs text-slate-400">Content</label>
              {contentId ? (
                <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
                  <span className="text-sm text-slate-200">{contentResults.find((c) => c.id === contentId)?.title ?? `#${contentId}`}</span>
                  <button type="button" onClick={() => setContentId(null)} className="text-xs text-slate-500 hover:text-red-400">Change</button>
                </div>
              ) : (
                <>
                  <input type="text" value={contentQuery} onChange={(e) => setContentQuery(e.target.value)} placeholder="Search courses…" className={inputClass} />
                  {contentResults.length > 0 && (
                    <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-slate-800 divide-y divide-slate-800">
                      {contentResults.map((c) => (
                        <button key={c.id} type="button" onClick={() => setContentId(c.id)} className="block w-full px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-800">
                          {c.title}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Amount ₦</label>
              <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Due date</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Line-item notes (optional)</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
          </div>

          {err && <p className="text-sm text-red-400">{err}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button onClick={submit} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Creating…" : "Create & Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export function Invoices() {
  const { toast } = useToast();
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), per_page: "25" });
    if (status) params.set("status", status);
    api<ListResponse>(`/invoices?${params}`)
      .then((res) => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message ?? "Failed to load invoices.");
          setCorrelationId(err.correlationId);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [page, status, reloadKey]);

  async function confirmPayment(inv: Invoice) {
    if (!confirm(`Mark invoice ${inv.invoice_number} as paid? This grants access immediately.`)) return;
    setConfirmingId(inv.id);
    try {
      await api(`/invoices/${inv.id}/confirm-payment`, { method: "POST" });
      toast("Payment confirmed — access granted.");
      load();
    } catch (e: any) {
      toast(e.message ?? "Failed to confirm payment.", "error");
    } finally {
      setConfirmingId(null);
    }
  }

  const meta = data?.meta;

  return (
    <div className="space-y-5">
      {creating && <CreateInvoiceModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); toast("Invoice created and sent."); load(); }} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Corporate Invoices</h1>
          <p className="mt-1 text-sm text-slate-500">{loading ? "Loading…" : `${formatCount(meta?.total ?? 0)} invoice${meta?.total === 1 ? "" : "s"}`}</p>
        </div>
        <button onClick={() => setCreating(true)} className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
          <Icon name="file" className="h-4 w-4" />
          Create Invoice
        </button>
      </div>

      <div className="flex items-center gap-3">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none">
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="sent">Sent</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : error ? (
        <ErrorState message={error} correlationId={correlationId} onRetry={load} />
      ) : !data?.invoices.length ? (
        <EmptyState icon={<Icon name="file" className="h-6 w-6" />} heading="No invoices yet" explanation="Create an invoice for a corporate buyer to get started." actionLabel="Create Invoice" onAction={() => setCreating(true)} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Invoice #</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Buyer</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Due</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {data.invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{inv.invoice_number}</td>
                    <td className="px-4 py-3 text-slate-300">{inv.company_name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <p className="text-slate-300">{inv.buyer?.name ?? "—"}</p>
                      <p className="text-xs text-slate-600">{inv.buyer?.email}</p>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-100 font-medium">{formatNaira(inv.amount_ngn)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 max-w-[160px] truncate">{inv.item?.title ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{inv.due_date ? formatDateTimeLagos(inv.due_date) : "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[inv.display_status]}`}>{STATUS_LABELS[inv.display_status]}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {inv.invoice_url && (
                          <a href={inv.invoice_url} target="_blank" rel="noopener noreferrer" className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200">PDF</a>
                        )}
                        {inv.display_status !== "paid" && (
                          <button onClick={() => confirmPayment(inv)} disabled={confirmingId === inv.id} className="rounded px-2 py-1 text-xs text-emerald-400 hover:bg-emerald-900/30 disabled:opacity-50">
                            {confirmingId === inv.id ? "…" : "Confirm paid"}
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
          <p className="text-xs text-slate-500">Page {meta.page} of {meta.pages} · {formatCount(meta.total)} invoices</p>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-600 disabled:opacity-40">← Previous</button>
            <button disabled={page === meta.pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-600 disabled:opacity-40">Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}

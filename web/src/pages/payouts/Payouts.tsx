import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";
import { formatNaira, formatCount } from "../../lib/format";

interface PayoutRun {
  id: number;
  period_month: string | null;
  status: "draft" | "approved" | "processing" | "complete" | "failed";
  total_gross_ngn: number;
  total_wht_ngn: number;
  total_net_ngn: number;
  approved_at: string | null;
  completed_at: string | null;
  line_count: number;
}

interface PayoutLine {
  id: number;
  speaker_id: number;
  speaker_name: string;
  payout_ready: boolean;
  gross_ngn: number;
  commission_ngn: number;
  wht_amount_ngn: number;
  net_ngn: number;
  status: "pending" | "approved" | "paid" | "failed";
  payment_reference: string | null;
  failure_reason: string | null;
}

interface PreviewSpeaker {
  speaker_id: number;
  speaker_name: string;
  payout_ready: boolean;
  gross_ngn: number;
  commission_ngn: number;
  wht_amount_ngn: number;
  net_ngn: number;
}

const RUN_STATUS_STYLES: Record<PayoutRun["status"], string> = {
  draft: "bg-slate-800 text-slate-400",
  approved: "bg-blue-500/15 text-blue-300 border border-blue-500/30",
  processing: "bg-amber-500/15 text-amber-300 border border-amber-500/30 animate-pulse",
  complete: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  failed: "bg-red-500/15 text-red-300 border border-red-500/30",
};
const RUN_STATUS_LABELS: Record<PayoutRun["status"], string> = {
  draft: "Draft", approved: "Approved", processing: "Processing", complete: "Complete", failed: "Needs attention",
};

const LINE_STATUS_STYLES: Record<PayoutLine["status"], string> = {
  pending: "bg-slate-800 text-slate-400",
  approved: "bg-blue-500/15 text-blue-300 border border-blue-500/30",
  paid: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  failed: "bg-red-500/15 text-red-300 border border-red-500/30",
};

// ─── Subscription revenue accrual ──────────────────────────────────────────
//
// A manually-triggered admin tool, not a scheduled job — this app has no
// scheduler. Every number here comes from real watch-time data
// (PlaybackSession) and the plan's current price standing in for what a
// subscriber actually paid this period — see lib/earnings.ts's own module
// doc for the full reasoning. Off by default
// (monetisation.subscription_accrual_enabled) until an admin reads that and
// opts in from Settings.

interface AccrualContentShare {
  content_id: number;
  title: string | null;
  watch_seconds: number;
  share_of_period_amount_ngn: number;
  already_accrued: boolean;
}

interface AccrualSubscriber {
  subscription_id: number;
  user_id: number;
  subscriber_name: string;
  plan_name: string | null;
  period_amount_ngn: number;
  content: AccrualContentShare[];
}

function previousMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatWatchTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function SubscriptionAccrualModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [periodMonth, setPeriodMonth] = useState(previousMonth());
  const [preview, setPreview] = useState<{ enabled: boolean; subscribers: AccrualSubscriber[]; total_ngn: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped_already_accrued: number; skipped_no_credited_speakers: number; total_ngn: number } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    setResult(null);
    api<typeof preview>(`/payouts/subscription-accrual-preview?period_month=${periodMonth}`)
      .then((res) => { setPreview(res); setLoading(false); })
      .catch((e) => { setErr(e.message ?? "Failed to load preview."); setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodMonth]);

  useEffect(() => { load(); }, [load]);

  const runnableCount = preview?.subscribers.reduce((n, s) => n + s.content.filter((c) => !c.already_accrued).length, 0) ?? 0;

  async function run() {
    if (!confirm(`Accrue subscription revenue for ${periodMonth}? This will create ${runnableCount} earning line${runnableCount === 1 ? "" : "s"} that feed into the normal payout pipeline.`)) return;
    setRunning(true);
    try {
      const res = await api<{ created: number; skipped_already_accrued: number; skipped_no_credited_speakers: number; total_ngn: number }>("/payouts/subscription-accrual", {
        method: "POST",
        body: JSON.stringify({ period_month: periodMonth }),
      });
      setResult(res);
      toast(`Accrued ₦${res.total_ngn.toLocaleString()} across ${res.created} earning line${res.created === 1 ? "" : "s"}.`);
    } catch (e: any) {
      toast(e.message ?? "Accrual run failed.", "error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">Subscription Revenue Accrual</h2>
          <button onClick={onClose} className="text-xl leading-none text-slate-500 hover:text-slate-300">×</button>
        </div>

        <p className="mb-4 text-xs text-slate-500">
          Divides each subscriber's period payment across what they actually watched, weighted by watch time, then splits each content item's share across its credited speakers — the same revenue_share_pct split direct sales use. This app has no per-period renewal billing record, so a plan's current price stands in for what was actually charged.
        </p>

        <div className="mb-4 flex items-center gap-3">
          <label className="text-xs text-slate-400">Period</label>
          <input
            type="month"
            value={periodMonth}
            onChange={(e) => setPeriodMonth(e.target.value)}
            className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-brand focus:outline-none"
          />
        </div>

        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : err ? (
          <p className="text-sm text-red-400">{err}</p>
        ) : !preview ? null : (
          <>
            {!preview.enabled && (
              <div className="mb-4 rounded-lg border border-amber-700/40 bg-amber-900/20 p-3 text-xs text-amber-300">
                Subscription accrual is turned off. This preview still works, but Run is disabled until it's enabled in Settings → Monetisation.
              </div>
            )}

            {result && (
              <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
                Done — {result.created} earning line{result.created === 1 ? "" : "s"} created (₦{result.total_ngn.toLocaleString()}), {result.skipped_already_accrued} already accrued, {result.skipped_no_credited_speakers} had no credited speakers.
              </div>
            )}

            {!preview.subscribers.length ? (
              <p className="text-sm text-slate-500">No qualifying subscriber watch time found for {periodMonth}.</p>
            ) : (
              <div className="space-y-4">
                {preview.subscribers.map((s) => (
                  <div key={s.subscription_id} className="rounded-lg border border-slate-800 p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-200">{s.subscriber_name}</span>
                      <span className="text-slate-500">{s.plan_name ?? "—"} · {formatNaira(s.period_amount_ngn)}</span>
                    </div>
                    <div className="mt-2 space-y-1">
                      {s.content.map((c) => (
                        <div key={c.content_id} className="flex items-center justify-between text-xs">
                          <span className="truncate text-slate-400">{c.title ?? `Content #${c.content_id}`} — {formatWatchTime(c.watch_seconds)}</span>
                          <span className={c.already_accrued ? "text-slate-600" : "text-slate-300"}>
                            {formatNaira(c.share_of_period_amount_ngn)}{c.already_accrued ? " (already accrued)" : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-slate-800 pt-3 text-sm">
                  <span className="text-slate-400">Total</span>
                  <span className="font-medium text-slate-100">{formatNaira(preview.total_ngn)}</span>
                </div>
              </div>
            )}
          </>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Close</button>
          <button
            onClick={run}
            disabled={running || loading || !preview?.enabled || runnableCount === 0}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "Running…" : `Run Accrual (${runnableCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Create-run preview modal ───────────────────────────────────────────────

function CreateRunModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [preview, setPreview] = useState<{ speakers: PreviewSpeaker[]; total_net_ngn: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ speakers: PreviewSpeaker[]; total_net_ngn: number }>("/payouts/eligible-preview")
      .then((res) => { setPreview(res); setLoading(false); })
      .catch((e) => { setErr(e.message ?? "Failed to load preview."); setLoading(false); });
  }, []);

  async function create() {
    setCreating(true);
    setErr(null);
    try {
      await api("/payouts/runs", { method: "POST" });
      onCreated();
    } catch (e: any) {
      setErr(e.message ?? "Failed to create payout run.");
    } finally {
      setCreating(false);
    }
  }

  const notReady = preview?.speakers.filter((s) => !s.payout_ready) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-sm font-semibold text-slate-100">Create Payout Run</h2>
        <p className="mb-4 text-xs text-slate-500">
          Claims every earning that's cleared its holdback window. Nothing is paid until this run is approved AND processed — this step only computes numbers.
        </p>

        {loading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : !preview || preview.speakers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-800 px-4 py-6 text-center text-sm text-slate-500">
            Nothing is payable right now — everything is still within its holdback window, or already claimed by another run.
          </p>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border border-slate-800">
              <table className="w-full text-xs">
                <thead className="border-b border-slate-800 bg-slate-950/60">
                  <tr className="text-left text-slate-500">
                    <th className="px-3 py-2 font-medium">Speaker</th>
                    <th className="px-3 py-2 font-medium text-right">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {preview.speakers.map((s) => (
                    <tr key={s.speaker_id}>
                      <td className="px-3 py-2 text-slate-300">
                        {s.speaker_name}
                        {!s.payout_ready && <span className="ml-2 text-amber-400">⚠ no bank details</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-100">{formatNaira(s.net_ngn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-right text-sm font-semibold text-slate-100">Total: {formatNaira(preview.total_net_ngn)}</p>
            {notReady.length > 0 && (
              <p className="mt-2 text-xs text-amber-400">
                {notReady.length} speaker{notReady.length === 1 ? "" : "s"} without verified bank details will be included but will fail at the Process step until they finish payout setup.
              </p>
            )}
          </>
        )}

        {err && <p className="mt-3 text-sm text-red-400">{err}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          {preview && preview.speakers.length > 0 && (
            <button onClick={create} disabled={creating} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
              {creating ? "Creating…" : "Create draft run"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Run detail slide-over ──────────────────────────────────────────────────

function RunDetail({ runId, onClose, onChanged }: { runId: number; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const [data, setData] = useState<{ run: PayoutRun; lines: PayoutLine[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api<{ run: PayoutRun; lines: PayoutLine[] }>(`/payouts/runs/${runId}`)
      .then((res) => { setData(res); setLoading(false); })
      .catch((e) => { toast(e.message ?? "Failed to load run.", "error"); setLoading(false); });
  }, [runId, toast]);

  useEffect(() => { load(); }, [load]);

  async function act(action: "cancel" | "approve" | "process", confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true);
    try {
      await api(`/payouts/runs/${runId}/${action}`, { method: "POST" });
      toast(action === "cancel" ? "Run cancelled." : action === "approve" ? "Run approved." : "Run processed.");
      if (action === "cancel") { onChanged(); onClose(); return; }
      load();
      onChanged();
    } catch (e: any) {
      toast(e.message ?? `Failed to ${action} run.`, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-slate-800 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">Payout Run {data ? `#${data.run.id}` : ""}</h2>
          <button onClick={onClose} className="text-xl leading-none text-slate-500 hover:text-slate-300">×</button>
        </div>

        {loading || !data ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RUN_STATUS_STYLES[data.run.status]}`}>{RUN_STATUS_LABELS[data.run.status]}</span>
              <span className="text-xs text-slate-500">{data.run.period_month ?? "—"} · {formatCount(data.lines.length)} speaker{data.lines.length === 1 ? "" : "s"}</span>
            </div>

            <div className="mb-4 grid grid-cols-3 gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-center text-xs">
              <div><p className="text-slate-500">Gross</p><p className="mt-1 font-semibold text-slate-100">{formatNaira(data.run.total_gross_ngn)}</p></div>
              <div><p className="text-slate-500">WHT</p><p className="mt-1 font-semibold text-slate-100">{formatNaira(data.run.total_wht_ngn)}</p></div>
              <div><p className="text-slate-500">Net</p><p className="mt-1 font-semibold text-emerald-400">{formatNaira(data.run.total_net_ngn)}</p></div>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-800">
              <table className="w-full text-xs">
                <thead className="border-b border-slate-800 bg-slate-950/60">
                  <tr className="text-left text-slate-500">
                    <th className="px-3 py-2 font-medium">Speaker</th>
                    <th className="px-3 py-2 font-medium text-right">Net</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {data.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-3 py-2 text-slate-300">
                        {l.speaker_name}
                        {!l.payout_ready && data.run.status !== "complete" && <span className="ml-2 text-amber-400">⚠ no bank details</span>}
                        {l.failure_reason && <p className="mt-0.5 text-red-400">{l.failure_reason}</p>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-100">{formatNaira(l.net_ngn)}</td>
                      <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 ${LINE_STATUS_STYLES[l.status]}`}>{l.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data.run.status === "failed" && (
              <p className="mt-3 text-xs text-slate-500">
                Failed lines' earnings were released, not lost — fix the issue (usually missing bank details) and they'll be picked up automatically the next time a run is created.
              </p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              {data.run.status === "draft" && (
                <>
                  <button onClick={() => act("cancel", "Cancel this draft run? Its claimed earnings return to the pool.")} disabled={busy} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-red-400 disabled:opacity-50">
                    Cancel run
                  </button>
                  <button onClick={() => act("approve")} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
                    {busy ? "…" : "Approve"}
                  </button>
                </>
              )}
              {data.run.status === "approved" && (
                <button
                  onClick={() => act("process", `Process this run and send ${formatNaira(data.run.total_net_ngn)} to ${data.lines.length} speaker${data.lines.length === 1 ? "" : "s"}? This sends real transfers and can't be undone.`)}
                  disabled={busy}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {busy ? "Processing…" : "Process — send payments"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function Payouts() {
  const [runs, setRuns] = useState<PayoutRun[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [accruing, setAccruing] = useState(false);
  const [openRunId, setOpenRunId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api<{ runs: PayoutRun[] }>("/payouts/runs")
      .then((res) => { setRuns(res.runs); setLoading(false); })
      .catch((err) => {
        setError(err.message ?? "Failed to load payout runs.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (error) return <ErrorState message={error} correlationId={correlationId} onRetry={load} />;

  return (
    <div className="space-y-5">
      {creating && <CreateRunModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />}
      {accruing && <SubscriptionAccrualModal onClose={() => setAccruing(false)} />}
      {openRunId != null && <RunDetail runId={openRunId} onClose={() => setOpenRunId(null)} onChanged={load} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Payouts</h1>
          <p className="mt-1 text-sm text-slate-500">Instructor earnings, aggregated into runs and paid out via Paystack transfer.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setAccruing(true)} className="flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800">
            <Icon name="chart" className="h-4 w-4" />
            Subscription Accrual
          </button>
          <button onClick={() => setCreating(true)} className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
            <Icon name="credit" className="h-4 w-4" />
            Create Payout Run
          </button>
        </div>
      </div>

      {!runs?.length ? (
        <EmptyState
          icon={<Icon name="credit" className="h-6 w-6" />}
          heading="No payout runs yet"
          explanation="Create a run to pay out instructor earnings that have cleared their holdback window."
          actionLabel="Create Payout Run"
          onAction={() => setCreating(true)}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Run</th>
                  <th className="px-4 py-3 font-medium">Period</th>
                  <th className="px-4 py-3 font-medium">Speakers</th>
                  <th className="px-4 py-3 font-medium">Gross</th>
                  <th className="px-4 py-3 font-medium">WHT</th>
                  <th className="px-4 py-3 font-medium">Net</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {runs.map((r) => (
                  <tr key={r.id} onClick={() => setOpenRunId(r.id)} className="cursor-pointer hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">#{r.id}</td>
                    <td className="px-4 py-3 text-slate-300">{r.period_month ?? "—"}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-400">{formatCount(r.line_count)}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-300">{formatNaira(r.total_gross_ngn)}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-400">{formatNaira(r.total_wht_ngn)}</td>
                    <td className="px-4 py-3 tabular-nums font-medium text-slate-100">{formatNaira(r.total_net_ngn)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RUN_STATUS_STYLES[r.status]}`}>{RUN_STATUS_LABELS[r.status]}</span>
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

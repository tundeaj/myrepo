import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { Icon } from "../../components/Icon";
import { StatusBadge } from "../../components/StatusBadge";
import type { ContentStatus } from "../../components/StatusBadge";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { formatCount, formatDateTimeLagos } from "../../lib/format";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ReviewContent {
  id: number;
  title: string;
  content_type: string;
  status: ContentStatus;
  access_level: string;
  short_description: string | null;
  master_image_url: string | null;
  scheduled_start_at: string | null;
  price_ngn: string | number | null;
  language: string;
}

interface ReviewItem {
  id: number;
  content_id: number | null;
  submitted_at: string;
  days_waiting: number;
  content: ReviewContent | null;
  submitter: { id: number; full_name: string | null; email: string } | null;
}

interface ListResponse {
  items: ReviewItem[];
  meta: { total: number; page: number; per_page: number; pages: number };
}

type Decision = "approved" | "changes_requested" | "rejected";

// ─── Decision modal ────────────────────────────────────────────────────────────

function DecisionModal({
  item,
  decision,
  onClose,
  onDone,
}: {
  item: ReviewItem;
  decision: Decision;
  onClose: () => void;
  onDone: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needsNotes = decision !== "approved";
  const titles: Record<Decision, string> = {
    approved: "Approve & publish",
    changes_requested: "Request changes",
    rejected: "Reject content",
  };

  async function submit() {
    if (needsNotes && !notes.trim()) {
      setErr(decision === "rejected"
        ? "A rejection reason is required — the instructor will see it."
        : "A note describing the required changes is required — the instructor will see it.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api(`/instructors/review-queue/${item.id}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision, notes: notes.trim() || undefined }),
      });
      onDone();
    } catch (e: any) {
      setErr(e.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-sm font-semibold text-slate-100">{titles[decision]}</h2>
        <p className="mb-4 text-sm text-slate-400">{item.content?.title ?? "Untitled content"}</p>

        {decision === "approved" ? (
          <p className="mb-4 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-400">
            The content will be published immediately and the instructor will be notified.
          </p>
        ) : (
          <div className="mb-4">
            <label className="mb-1 block text-xs text-slate-400">
              {decision === "rejected"
                ? "Rejection reason (required — sent to the instructor)"
                : "What needs to change? (required — sent to the instructor; content returns to draft)"}
            </label>
            <textarea
              autoFocus
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
              placeholder={decision === "rejected" ? "e.g. This topic conflicts with our content policy…" : "e.g. Please add a clearer session description and a cover image…"}
            />
          </div>
        )}

        {err && <p className="mb-3 text-sm text-red-400">{err}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button
            onClick={submit}
            disabled={busy}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
              decision === "rejected" ? "bg-red-600 hover:bg-red-500" : "bg-brand hover:bg-brand-dark"
            }`}
          >
            {busy ? "Working…" : titles[decision]}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Review drawer (read-only content record) ─────────────────────────────────

function ContentDrawer({
  item,
  onClose,
  onDecision,
}: {
  item: ReviewItem;
  onClose: () => void;
  onDecision: (d: Decision) => void;
}) {
  const c = item.content;

  function Row({ label, value }: { label: string; value: string | null }) {
    return (
      <div>
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="mt-0.5 text-sm text-slate-200">{value || "—"}</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="h-full w-full max-w-lg overflow-y-auto border-l border-slate-800 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100">{c?.title ?? "Untitled"}</h2>
            {c && <div className="mt-1"><StatusBadge status={c.status} /></div>}
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
        </div>

        {c?.master_image_url && (
          <img src={c.master_image_url} alt="" className="mb-4 aspect-video w-full rounded-lg object-cover" />
        )}

        <div className="space-y-4">
          <Row label="Type" value={c?.content_type ?? null} />
          <Row label="Access level" value={c?.access_level?.replace(/_/g, " ") ?? null} />
          <Row label="Description" value={c?.short_description ?? null} />
          <Row label="Scheduled" value={c?.scheduled_start_at ? formatDateTimeLagos(c.scheduled_start_at) : null} />
          <Row label="Language" value={c?.language ?? null} />
          <Row label="Submitted by" value={item.submitter ? `${item.submitter.full_name ?? item.submitter.email}` : null} />
          <Row label="Submitted" value={formatDateTimeLagos(item.submitted_at)} />
          <div>
            <p className="text-xs font-medium text-slate-500">Waiting</p>
            <p className={`mt-0.5 text-sm font-medium ${item.days_waiting >= 3 ? "text-amber-400" : "text-slate-200"}`}>
              {item.days_waiting === 0 ? "Less than a day" : `${item.days_waiting} day${item.days_waiting === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2 border-t border-slate-800 pt-4">
          <button onClick={() => onDecision("approved")}
            className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-dark">
            Approve & publish
          </button>
          <button onClick={() => onDecision("changes_requested")}
            className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-800">
            Request changes
          </button>
          <button onClick={() => onDecision("rejected")}
            className="rounded-lg border border-red-900/50 px-4 py-2.5 text-sm text-red-400 hover:bg-red-950/40">
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export function ReviewQueue() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [drawerItem, setDrawerItem] = useState<ReviewItem | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<ListResponse>(`/instructors/review-queue?page=${page}&per_page=25`)
      .then((res) => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message ?? "Failed to load review queue.");
          setCorrelationId(err.correlationId);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [page, reloadKey]);

  const meta = data?.meta;

  return (
    <div className="space-y-5">
      {drawerItem && decision && (
        <DecisionModal
          item={drawerItem}
          decision={decision}
          onClose={() => setDecision(null)}
          onDone={() => { setDecision(null); setDrawerItem(null); reload(); }}
        />
      )}
      {drawerItem && !decision && (
        <ContentDrawer item={drawerItem} onClose={() => setDrawerItem(null)} onDecision={setDecision} />
      )}

      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Review Queue</h1>
        <p className="text-sm text-slate-500">
          {loading ? "Loading…" : `${formatCount(meta?.total ?? 0)} item${meta?.total === 1 ? "" : "s"} awaiting review`}
        </p>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : error ? (
        <ErrorState message={error} correlationId={correlationId} onRetry={reload} />
      ) : !data?.items.length ? (
        <EmptyState
          icon={<Icon name="eye" className="h-6 w-6" />}
          heading="Queue is clear"
          explanation="Content submitted for review by instructors will appear here."
          variant="filtered"
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Content</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Submitted by</th>
                  <th className="px-4 py-3 font-medium">Submitted</th>
                  <th className="px-4 py-3 font-medium">Waiting</th>
                  <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {data.items.map((item) => (
                  <tr key={item.id} className="group hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {item.content?.master_image_url ? (
                          <img src={item.content.master_image_url} alt="" className="h-10 w-16 flex-shrink-0 rounded object-cover" />
                        ) : (
                          <div className="flex h-10 w-16 flex-shrink-0 items-center justify-center rounded bg-slate-800 text-slate-600">
                            <Icon name="video" className="h-4 w-4" />
                          </div>
                        )}
                        <span className="font-medium text-slate-100">{item.content?.title ?? "Untitled"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 capitalize">{item.content?.content_type ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {item.submitter ? (item.submitter.full_name ?? item.submitter.email) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{formatDateTimeLagos(item.submitted_at)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium tabular-nums ${item.days_waiting >= 3 ? "text-amber-400" : "text-slate-400"}`}>
                        {item.days_waiting === 0 ? "<1 day" : `${item.days_waiting}d`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setDrawerItem(item)}
                        className="rounded px-2.5 py-1 text-xs text-brand hover:bg-brand/10">
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {meta && meta.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">Page {meta.page} of {meta.pages} · {formatCount(meta.total)} items</p>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-600 disabled:opacity-40">← Previous</button>
            <button disabled={page === meta.pages} onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-600 disabled:opacity-40">Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}

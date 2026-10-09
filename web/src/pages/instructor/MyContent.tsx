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

interface ContentRow {
  id: number;
  title: string;
  content_type: string;
  status: ContentStatus;
  access_level: string;
  price_ngn: string | number | null;
  master_image_url: string | null;
  scheduled_start_at: string | null;
  updated_at: string;
  review: { decision: string; notes: string | null; reviewed_at: string | null } | null;
}

interface ListResponse {
  content: ContentRow[];
  auto_approve: boolean;
  meta: { total: number; page: number; per_page: number; pages: number };
}

const TYPE_FILTERS = [
  { value: "", label: "All types" },
  { value: "webinar", label: "Sessions" },
  { value: "course", label: "Courses" },
  { value: "video", label: "Videos" },
];

// ─── Main page ─────────────────────────────────────────────────────────────────

export function MyContent() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [type, setType] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [submittingId, setSubmittingId] = useState<number | null>(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), per_page: "25" });
    if (type) params.set("content_type", type);
    api<ListResponse>(`/portal/content?${params}`)
      .then((res) => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message ?? "Failed to load your content.");
          setCorrelationId(err.correlationId);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [page, type, reloadKey]);

  async function submitForReview(row: ContentRow) {
    const label = data?.auto_approve ? "Publish" : "Submit for review";
    if (!confirm(`${label} "${row.title}"?`)) return;
    setSubmittingId(row.id);
    try {
      const res = await api<{ published: boolean }>(`/portal/content/${row.id}/submit-for-review`, { method: "POST" });
      alert(res.published
        ? "Published! Your content is now live."
        : "Submitted. Our review team will assess it — you'll be notified either way, with a note.");
      reload();
    } catch (e: any) {
      alert(e.message ?? "Failed to submit.");
    } finally {
      setSubmittingId(null);
    }
  }

  const meta = data?.meta;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">My Content</h1>
          <p className="text-sm text-slate-500">
            {loading ? "Loading…" : `${formatCount(meta?.total ?? 0)} item${meta?.total === 1 ? "" : "s"}`}
          </p>
        </div>
        <select
          value={type}
          onChange={(e) => { setType(e.target.value); setPage(1); }}
          className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
        >
          {TYPE_FILTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Read-only pricing note */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-xs text-slate-500">
        Access level and pricing are set by the platform team when your content is approved.
        If you'd like a change, contact support — these fields are read-only in the portal.
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : error ? (
        <ErrorState message={error} correlationId={correlationId} onRetry={reload} />
      ) : !data?.content.length ? (
        <EmptyState
          icon={<Icon name="video" className="h-6 w-6" />}
          heading="No content yet"
          explanation="Content you're attached to as a speaker or instructor will appear here. The platform team can help you get your first session scheduled."
          variant="filtered"
        />
      ) : (
        <div className="space-y-3">
          {data.content.map((row) => (
            <div key={row.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="flex flex-wrap items-start gap-4">
                {row.master_image_url ? (
                  <img src={row.master_image_url} alt="" className="h-14 w-24 flex-shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-14 w-24 flex-shrink-0 items-center justify-center rounded-lg bg-slate-800 text-slate-600">
                    <Icon name="video" className="h-5 w-5" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold text-slate-100">{row.title}</h2>
                    <StatusBadge status={row.status} />
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 capitalize">
                    {row.content_type === "webinar" ? "Live session" : row.content_type}
                    {row.scheduled_start_at ? ` · ${formatDateTimeLagos(row.scheduled_start_at)}` : ""}
                    {" · "}
                    <span className="capitalize">{row.access_level.replace(/_/g, " ")}</span>
                    <span className="text-slate-600"> (read-only)</span>
                  </p>

                  {/* Review status — the note is ALWAYS shown, never a bare status */}
                  {row.review && row.review.decision !== "pending" && row.review.notes && (
                    <div className={`mt-2 rounded-lg border px-3 py-2 text-xs ${
                      row.review.decision === "approved"
                        ? "border-emerald-800/40 bg-emerald-950/30 text-emerald-300"
                        : row.review.decision === "changes_requested"
                          ? "border-amber-800/40 bg-amber-950/30 text-amber-300"
                          : "border-red-900/40 bg-red-950/30 text-red-300"
                    }`}>
                      <p className="font-medium">
                        {row.review.decision === "approved" ? "Approved"
                          : row.review.decision === "changes_requested" ? "Changes requested"
                          : "Not approved"}
                        {row.review.reviewed_at ? ` · ${formatDateTimeLagos(row.review.reviewed_at)}` : ""}
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap opacity-90">{row.review.notes}</p>
                    </div>
                  )}
                  {row.review?.decision === "pending" && (
                    <p className="mt-2 text-xs text-blue-300">⏳ Awaiting review — we'll notify you with a note either way.</p>
                  )}
                </div>

                {/* Submit for review — replaces Publish unless auto_approve */}
                {row.status === "draft" && (
                  <button
                    onClick={() => submitForReview(row)}
                    disabled={submittingId === row.id}
                    className="rounded-lg bg-brand px-3.5 py-2 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                  >
                    {submittingId === row.id
                      ? "Submitting…"
                      : data.auto_approve ? "Publish" : "Submit for review"}
                  </button>
                )}
              </div>
            </div>
          ))}
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

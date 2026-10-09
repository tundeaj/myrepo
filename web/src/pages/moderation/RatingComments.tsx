import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";
import { formatDateTimeLagos } from "../../lib/format";

type Status = "pending" | "approved" | "rejected";

interface ModeratedRating {
  id: number;
  score: number;
  comment: string | null;
  comment_fr: string | null;
  created_at: string;
  reviewer: string;
  content_title: string;
  content_slug: string | null;
}

const TABS: Status[] = ["pending", "approved", "rejected"];

/**
 * Only meaningful under content_policy.rating_comments_mode =
 * "review_required" (Settings → Content Policy → Rating comments) — under
 * "hidden" or "auto_publish" there's nothing here that needs a human
 * decision, but the queue itself still works the same either way, so no
 * special-casing based on the current mode.
 */
export function RatingComments() {
  const { toast } = useToast();
  const [status, setStatus] = useState<Status>("pending");
  const [ratings, setRatings] = useState<ModeratedRating[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [actingId, setActingId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkActing, setBulkActing] = useState(false);
  const [frDrafts, setFrDrafts] = useState<Record<number, string>>({});
  const [frSavingId, setFrSavingId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    api<{ ratings: ModeratedRating[] }>(`/ratings-moderation?status=${status}`)
      .then((res) => { setRatings(res.ratings); setLoading(false); })
      .catch((err) => {
        setError(err.message ?? "Failed to load comments.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, [status]);

  useEffect(() => { load(); }, [load]);

  async function act(rating: ModeratedRating, next: "approved" | "rejected") {
    setActingId(rating.id);
    try {
      await api(`/ratings-moderation/${rating.id}`, { method: "PUT", body: JSON.stringify({ status: next }) });
      setRatings((prev) => prev?.filter((r) => r.id !== rating.id) ?? null);
      setSelected((prev) => { const next = new Set(prev); next.delete(rating.id); return next; });
      toast(next === "approved" ? "Comment approved." : "Comment rejected.");
    } catch (e: any) {
      toast(e.message ?? "Failed to update.", "error");
    } finally {
      setActingId(null);
    }
  }

  function toggleSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = ratings != null && ratings.length > 0 && selected.size === ratings.length;

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(ratings?.map((r) => r.id) ?? []));
  }

  async function bulkAct(next: "approved" | "rejected") {
    const ids = [...selected];
    if (!ids.length) return;
    setBulkActing(true);
    try {
      const res = await api<{ ratings: { id: number }[]; failed: { id: number; error: string }[] }>(
        "/ratings-moderation/bulk",
        { method: "POST", body: JSON.stringify({ ids, status: next }) },
      );
      const succeededIds = new Set(res.ratings.map((r) => r.id));
      setRatings((prev) => prev?.filter((r) => !succeededIds.has(r.id)) ?? null);
      setSelected((prev) => { const remaining = new Set(prev); for (const id of succeededIds) remaining.delete(id); return remaining; });
      const verb = next === "approved" ? "approved" : "rejected";
      if (res.failed.length) {
        toast(`${succeededIds.size} ${verb}, ${res.failed.length} failed.`, succeededIds.size ? "info" : "error");
      } else {
        toast(`${succeededIds.size} comment${succeededIds.size === 1 ? "" : "s"} ${verb}.`);
      }
    } catch (e: any) {
      toast(e.message ?? "Bulk update failed.", "error");
    } finally {
      setBulkActing(false);
    }
  }

  // comment_fr is orthogonal to the approve/reject decision — this never
  // sends a status, so it never touches comment_status or sends a
  // moderation-notification email (see PUT /ratings-moderation/:id).
  async function saveFr(rating: ModeratedRating) {
    const draft = frDrafts[rating.id] ?? rating.comment_fr ?? "";
    setFrSavingId(rating.id);
    try {
      const res = await api<{ rating: ModeratedRating }>(`/ratings-moderation/${rating.id}`, {
        method: "PUT",
        body: JSON.stringify({ comment_fr: draft.trim() || null }),
      });
      setRatings((prev) => prev?.map((r) => (r.id === rating.id ? { ...r, comment_fr: res.rating.comment_fr } : r)) ?? null);
      setFrDrafts((prev) => { const next = { ...prev }; delete next[rating.id]; return next; });
      toast(draft.trim() ? "French translation saved." : "French translation cleared.");
    } catch (e: any) {
      toast(e.message ?? "Failed to save translation.", "error");
    } finally {
      setFrSavingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Rating Comments</h1>
        <p className="mt-1 text-sm text-slate-500">
          Written comments left alongside a star rating. Only relevant when Settings → Content Policy → Rating comments is set to
          "Held for admin approval" — approving or rejecting a comment never changes the score it's attached to.
        </p>
      </div>

      <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setStatus(t)}
            className={`rounded-full border px-3 py-1 text-xs capitalize ${status === t ? "border-brand bg-brand/15 text-brand" : "border-slate-800 text-slate-500 hover:text-slate-300"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : error ? (
        <ErrorState message={error} correlationId={correlationId} onRetry={load} />
      ) : !ratings?.length ? (
        <EmptyState icon={<Icon name="shield" className="h-6 w-6" />} heading={`No ${status} comments`} explanation={status === "pending" ? "Nothing is waiting for review." : `Nothing has been ${status} yet.`} />
      ) : (
        <div className="space-y-3">
          {status === "pending" && (
            <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-2.5">
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900" />
                {selected.size > 0 ? `${selected.size} selected` : "Select all"}
              </label>
              {selected.size > 0 && (
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={() => bulkAct("approved")}
                    disabled={bulkActing}
                    className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    Approve {selected.size}
                  </button>
                  <button
                    onClick={() => bulkAct("rejected")}
                    disabled={bulkActing}
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                  >
                    Reject {selected.size}
                  </button>
                </div>
              )}
            </div>
          )}
          {ratings.map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-800 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 gap-3">
                  {status === "pending" && (
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleSelected(r.id)}
                      className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-slate-700 bg-slate-900"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-amber-400">{"★".repeat(r.score)}{"☆".repeat(5 - r.score)}</span>
                      <span className="text-slate-500">{r.reviewer}</span>
                      <span className="text-slate-700">·</span>
                      <span className="truncate text-slate-500">{r.content_title}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-300">{r.comment}</p>
                    <p className="mt-2 text-xs text-slate-600">{formatDateTimeLagos(r.created_at)}</p>

                    <div className="mt-3 flex items-start gap-2">
                      <textarea
                        value={frDrafts[r.id] ?? r.comment_fr ?? ""}
                        onChange={(e) => setFrDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                        placeholder="French translation (optional) — not yet shown publicly, there's no language switcher on the site"
                        rows={2}
                        className="w-full min-w-0 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-300 placeholder:text-slate-600"
                      />
                      <button
                        onClick={() => saveFr(r)}
                        disabled={frSavingId === r.id || (frDrafts[r.id] ?? r.comment_fr ?? "") === (r.comment_fr ?? "")}
                        className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-40"
                      >
                        Save FR
                      </button>
                    </div>
                  </div>
                </div>
                {status === "pending" && (
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => act(r, "approved")}
                      disabled={actingId === r.id}
                      className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => act(r, "rejected")}
                      disabled={actingId === r.id}
                      className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

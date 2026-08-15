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

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
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
      toast(next === "approved" ? "Comment approved." : "Comment rejected.");
    } catch (e: any) {
      toast(e.message ?? "Failed to update.", "error");
    } finally {
      setActingId(null);
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
          {ratings.map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-800 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-amber-400">{"★".repeat(r.score)}{"☆".repeat(5 - r.score)}</span>
                    <span className="text-slate-500">{r.reviewer}</span>
                    <span className="text-slate-700">·</span>
                    <span className="truncate text-slate-500">{r.content_title}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-300">{r.comment}</p>
                  <p className="mt-2 text-xs text-slate-600">{formatDateTimeLagos(r.created_at)}</p>
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

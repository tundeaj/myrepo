import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import { Icon } from "../../components/Icon";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { formatCount } from "../../lib/format";

// ─── Instructor media library — server returns ONLY the signed-in user's uploads.

interface MediaAsset {
  id: number;
  title: string | null;
  asset_type: string;
  source_type: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  file_size_mb: number | null;
  transcode_status: string;
  created_at: string;
}

interface ListResponse {
  assets: MediaAsset[];
  meta: { total: number; page: number; per_page: number; pages: number };
}

function formatDur(s: number | null): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

const STATUS_STYLES: Record<string, string> = {
  ready: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  pending: "bg-slate-700/60 text-slate-400 border border-slate-600",
  processing: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
  failed: "bg-red-500/15 text-red-300 border border-red-500/30",
};

export function MyMedia() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), per_page: "24" });
    if (debouncedQ) params.set("q", debouncedQ);
    api<ListResponse>(`/portal/media?${params}`)
      .then((res) => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message ?? "Failed to load your media.");
          setCorrelationId(err.correlationId);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [page, debouncedQ]);

  const meta = data?.meta;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Media Library</h1>
        <p className="text-sm text-slate-500">
          {loading ? "Loading…" : `${formatCount(meta?.total ?? 0)} upload${meta?.total === 1 ? "" : "s"} — yours only`}
        </p>
      </div>

      <div className="relative max-w-sm">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your media…"
          className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-9 pr-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
        />
        <Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-video w-full rounded-xl" />)}
        </div>
      ) : error ? (
        <ErrorState message={error} correlationId={correlationId} onRetry={() => setPage((p) => p)} />
      ) : !data?.assets.length ? (
        <EmptyState
          icon={<Icon name="upload" className="h-6 w-6" />}
          heading="No media yet"
          explanation={debouncedQ ? "Nothing matches your search." : "Videos you upload for your sessions and courses will appear here."}
          variant="filtered"
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {data.assets.map((a) => (
            <div key={a.id} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
              <div className="relative aspect-video bg-slate-950">
                {a.thumbnail_url ? (
                  <img src={a.thumbnail_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-700">
                    <Icon name="video" className="h-8 w-8" />
                  </div>
                )}
                {a.duration_seconds != null && (
                  <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-xs font-mono text-white">
                    {formatDur(a.duration_seconds)}
                  </span>
                )}
              </div>
              <div className="px-3 py-2.5">
                <p className="truncate text-xs font-medium text-slate-200">{a.title || `Asset #${a.id}`}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500 capitalize">{a.asset_type}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[a.transcode_status] ?? "bg-slate-800 text-slate-400"}`}>
                    {a.transcode_status}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {meta && meta.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">Page {meta.page} of {meta.pages} · {formatCount(meta.total)} uploads</p>
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

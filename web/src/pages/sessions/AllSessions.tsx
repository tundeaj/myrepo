import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { StatusBadge } from "../../components/StatusBadge";
import type { ContentStatus } from "../../components/StatusBadge";
import { Icon } from "../../components/Icon";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { formatDateTimeLagos, formatRelative, formatCount } from "../../lib/format";

interface SessionRow {
  id: number;
  title: string;
  slug: string;
  status: ContentStatus;
  scheduled_start_at: string | null;
  timezone: string;
  registration_count: number;
  capacity: number | null;
  access_level: string;
  session_format: string | null;
  is_featured: boolean;
}

interface ListResponse {
  sessions: SessionRow[];
  meta: { total: number; page: number; per_page: number; pages: number };
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "scheduled", label: "Scheduled" },
  { value: "registration_open", label: "Registration open" },
  { value: "starting_soon", label: "Starting soon" },
  { value: "live", label: "Live" },
  { value: "ended", label: "Ended" },
  { value: "replay_ready", label: "Replay ready" },
  { value: "archived", label: "Archived" },
];

export function AllSessions() {
  const navigate = useNavigate();
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Fetch whenever filters/page change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ page: String(page), per_page: "25" });
    if (debouncedQ) params.set("q", debouncedQ);
    if (status) params.set("status", status);

    api<ListResponse>(`/sessions?${params}`)
      .then((res) => {
        if (!cancelled) { setData(res); setLoading(false); }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message ?? "Failed to load sessions.");
          setCorrelationId(err.correlationId);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [page, debouncedQ, status]);

  async function handleDelete(session: SessionRow) {
    if (!confirm(`Delete "${session.title}"? This cannot be undone.`)) return;
    setDeletingId(session.id);
    try {
      await api(`/sessions/${session.id}`, { method: "DELETE" });
      setData((prev) =>
        prev
          ? {
              ...prev,
              sessions: prev.sessions.filter((s) => s.id !== session.id),
              meta: { ...prev.meta, total: prev.meta.total - 1 },
            }
          : prev,
      );
    } catch (err: any) {
      alert(err.message ?? "Failed to delete session.");
    } finally {
      setDeletingId(null);
    }
  }

  const meta = data?.meta;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Live Sessions</h1>
          <p className="text-sm text-slate-500">
            {loading ? "Loading…" : `${formatCount(meta?.total ?? 0)} session${meta?.total === 1 ? "" : "s"}`}
          </p>
        </div>
        <button
          onClick={() => navigate("/admin/sessions/new")}
          className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
        >
          <Icon name="video" className="h-4 w-4" />
          Add Session
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <input
            type="text"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search sessions…"
            className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-9 pr-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
          />
          <Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error} correlationId={correlationId} onRetry={() => setPage((p) => p)} />
      ) : !data?.sessions.length ? (
        <EmptyState
          icon={<Icon name="video" className="h-6 w-6" />}
          heading="No sessions yet"
          explanation={debouncedQ || status ? "Try changing your filters." : "Create your first live session to get started."}
          actionLabel={!debouncedQ && !status ? "Add Session" : undefined}
          onAction={!debouncedQ && !status ? () => navigate("/admin/sessions/new") : undefined}
          variant={debouncedQ || status ? "filtered" : "create"}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800">
              <tr className="text-left text-xs text-slate-500">
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Start</th>
                <th className="px-4 py-3 font-medium">Registrations</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Format</th>
                <th className="px-4 py-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-900/20">
              {data.sessions.map((s) => (
                <tr key={s.id} className="group hover:bg-slate-800/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navigate(`/admin/sessions/${s.id}/edit`)}
                        className="font-medium text-slate-100 hover:text-brand"
                      >
                        {s.title}
                      </button>
                      {s.is_featured && (
                        <span className="rounded-full bg-brand/20 px-1.5 py-0.5 text-xs text-brand">
                          Featured
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600">/sessions/{s.slug}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {s.scheduled_start_at ? (
                      <>
                        <div>{formatDateTimeLagos(s.scheduled_start_at)}</div>
                        <div className="text-xs text-slate-600">{formatRelative(s.scheduled_start_at)}</div>
                      </>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-300">
                    {formatCount(s.registration_count)}
                    {s.capacity ? ` / ${formatCount(s.capacity)}` : ""}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-500 capitalize">
                    {s.session_format ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => navigate(`/admin/sessions/${s.id}/edit`)}
                        className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(s)}
                        disabled={deletingId === s.id}
                        className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-900/30 hover:text-red-400 disabled:opacity-50"
                      >
                        {deletingId === s.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {meta && meta.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Page {meta.page} of {meta.pages} · {formatCount(meta.total)} sessions
          </p>
          <div className="flex gap-2">
            <button
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-600 disabled:opacity-40"
            >
              ← Previous
            </button>
            <button
              disabled={page === meta.pages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-600 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

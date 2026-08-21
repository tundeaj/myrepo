import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { Icon } from "../../components/Icon";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { formatCount, formatNaira } from "../../lib/format";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Instructor {
  id: number;
  full_name: string;
  organisation: string | null;
  title: string | null;
  master_image_url: string | null;
  commission_pct: string | number;
  is_active: boolean;
  auto_approve: boolean;
  payout_verified: boolean;
  stats: {
    sessions: number;
    learners: number;
    avg_rating: number | null;
    earnings_period_ngn: number;
  };
}

interface ListResponse {
  instructors: Instructor[];
  meta: { total: number; page: number; per_page: number; pages: number };
}

// ─── Commission modal ──────────────────────────────────────────────────────────

function CommissionModal({
  instructor,
  onClose,
  onSaved,
}: {
  instructor: Instructor;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pct, setPct] = useState(String(Number(instructor.commission_pct) || 0));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const n = Number(pct);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      setErr("Commission must be between 0 and 100.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api(`/instructors/${instructor.id}`, {
        method: "PUT",
        body: JSON.stringify({ commission_pct: n }),
      });
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Failed to save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-sm font-semibold text-slate-100">Adjust commission</h2>
        <p className="mb-4 text-sm text-slate-400">{instructor.full_name}</p>
        <label className="mb-1 block text-xs text-slate-400">Platform commission %</label>
        <div className="relative">
          <input
            autoFocus
            type="number"
            min={0}
            max={100}
            step="0.5"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 pr-8 text-sm text-slate-100 focus:border-brand focus:outline-none"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">%</span>
        </div>
        <p className="mt-1.5 text-xs text-slate-600">The instructor keeps {100 - (Number(pct) || 0)}% of attributable revenue.</p>
        {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button onClick={save} disabled={busy}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export function AllInstructors() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [commissionFor, setCommissionFor] = useState<Instructor | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), per_page: "12" });
    if (debouncedQ) params.set("q", debouncedQ);
    api<ListResponse>(`/instructors?${params}`)
      .then((res) => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message ?? "Failed to load instructors.");
          setCorrelationId(err.correlationId);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [page, debouncedQ, reloadKey]);

  async function toggleActive(inst: Instructor) {
    const verb = inst.is_active ? "Deactivate" : "Reactivate";
    if (!confirm(`${verb} ${inst.full_name}? ${inst.is_active ? "Their content stays live but they lose portal access." : ""}`)) return;
    setTogglingId(inst.id);
    try {
      await api(`/instructors/${inst.id}`, {
        method: "PUT",
        body: JSON.stringify({ is_active: !inst.is_active }),
      });
      reload();
    } catch (e: any) {
      alert(e.message ?? "Failed to update.");
    } finally {
      setTogglingId(null);
    }
  }

  const meta = data?.meta;

  return (
    <div className="space-y-5">
      {commissionFor && (
        <CommissionModal
          instructor={commissionFor}
          onClose={() => setCommissionFor(null)}
          onSaved={() => { setCommissionFor(null); reload(); }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Instructors</h1>
          <p className="text-sm text-slate-500">
            {loading ? "Loading…" : `${formatCount(meta?.total ?? 0)} instructor${meta?.total === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search instructors…"
          className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-9 pr-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
        />
        <Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}
        </div>
      ) : error ? (
        <ErrorState message={error} correlationId={correlationId} onRetry={reload} />
      ) : !data?.instructors.length ? (
        <EmptyState
          icon={<Icon name="mic" className="h-6 w-6" />}
          heading="No instructors yet"
          explanation={debouncedQ ? "No instructors match your search." : "Approve instructor applications to see instructors here."}
          variant="filtered"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.instructors.map((inst) => (
            <div key={inst.id} className={`rounded-xl border bg-slate-900/60 p-4 ${inst.is_active ? "border-slate-800" : "border-slate-800 opacity-60"}`}>
              {/* Head */}
              <div className="flex items-start gap-3">
                {inst.master_image_url ? (
                  <img src={inst.master_image_url} alt="" className="h-12 w-12 rounded-full object-cover" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-sm font-semibold text-slate-400">
                    {inst.full_name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-100">{inst.full_name}</p>
                  <p className="truncate text-xs text-slate-500">{inst.organisation || inst.title || "—"}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {inst.payout_verified ? (
                      <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                        Payout verified
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                        ⚠ Payout details missing
                      </span>
                    )}
                    {!inst.is_active && (
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">Deactivated</span>
                    )}
                    {inst.auto_approve && (
                      <span className="rounded-full bg-blue-500/15 border border-blue-500/30 px-2 py-0.5 text-[11px] text-blue-300">Auto-approve</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="mt-4 grid grid-cols-4 gap-2 border-t border-slate-800 pt-3 text-center">
                <div>
                  <p className="text-sm font-semibold tabular-nums text-slate-100">{formatCount(inst.stats.sessions)}</p>
                  <p className="text-[11px] text-slate-500">Sessions</p>
                </div>
                <div>
                  <p className="text-sm font-semibold tabular-nums text-slate-100">{formatCount(inst.stats.learners)}</p>
                  <p className="text-[11px] text-slate-500">Learners</p>
                </div>
                <div>
                  <p className="text-sm font-semibold tabular-nums text-slate-100">{inst.stats.avg_rating ?? "—"}</p>
                  <p className="text-[11px] text-slate-500">Rating</p>
                </div>
                <div>
                  <p className="text-sm font-semibold tabular-nums text-slate-100">{formatNaira(inst.stats.earnings_period_ngn)}</p>
                  <p className="text-[11px] text-slate-500">This period</p>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-3 flex items-center gap-2 border-t border-slate-800 pt-3">
                <span className="text-xs text-slate-500">Commission: <span className="font-medium text-slate-300">{Number(inst.commission_pct)}%</span></span>
                <div className="ml-auto flex gap-1">
                  <button
                    onClick={() => setCommissionFor(inst)}
                    className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  >
                    Adjust
                  </button>
                  <button
                    onClick={() => toggleActive(inst)}
                    disabled={togglingId === inst.id}
                    className={`rounded px-2 py-1 text-xs disabled:opacity-50 ${
                      inst.is_active
                        ? "text-slate-400 hover:bg-red-900/30 hover:text-red-400"
                        : "text-emerald-400 hover:bg-emerald-900/30"
                    }`}
                  >
                    {togglingId === inst.id ? "…" : inst.is_active ? "Deactivate" : "Reactivate"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {meta && meta.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">Page {meta.page} of {meta.pages} · {formatCount(meta.total)} instructors</p>
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

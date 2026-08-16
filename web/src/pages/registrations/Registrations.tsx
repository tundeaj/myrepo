import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";
import { ContentPicker } from "../../components/ContentPicker";

type Status = "confirmed" | "waitlisted" | "cancelled";

interface RegistrationRow {
  id: number;
  status: Status;
  registered_at: string;
  user: { id: number; email: string; full_name: string | null } | null;
  content: { id: number; title: string | null; slug: string; content_type: string; scheduled_start_at: string | null } | null;
  attendance: { attended: boolean; watch_seconds: number } | null;
}

const STATUSES: Status[] = ["confirmed", "waitlisted", "cancelled"];

const STATUS_LABEL: Record<Status, string> = {
  confirmed: "Confirmed",
  waitlisted: "Waitlisted",
  cancelled: "Cancelled",
};

const STATUS_STYLE: Record<Status, string> = {
  confirmed: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  waitlisted: "border-amber-500/30 bg-amber-500/15 text-amber-300",
  cancelled: "border-slate-700 bg-slate-800 text-slate-500",
};

function formatWatchTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

export function Registrations() {
  const { toast } = useToast();
  const [rows, setRows] = useState<RegistrationRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | "">("");
  const [contentFilter, setContentFilter] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (statusFilter) params.set("status", statusFilter);
    if (contentFilter) params.set("content_id", String(contentFilter));
    api<{ registrations: RegistrationRow[] }>(`/registrations-admin?${params.toString()}`)
      .then((res) => { setRows(res.registrations); setLoading(false); })
      .catch((err) => {
        setError(err.message ?? "Failed to load registrations.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, [search, statusFilter, contentFilter]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function changeStatus(row: RegistrationRow, status: Status) {
    if (status === row.status) return;
    if (status === "cancelled" && !confirm(`Cancel ${row.user?.email ?? "this registrant"}'s registration for ${row.content?.title ?? "this session"}?`)) return;
    setSavingId(row.id);
    try {
      const res = await api<{ registration: { id: number; status: Status } }>(`/registrations-admin/${row.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, status: res.registration.status } : r)) ?? null);
      toast(`Marked ${STATUS_LABEL[status].toLowerCase()}.`);
    } catch (e: any) {
      toast(e.message ?? "Failed to update registration.", "error");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Registrations</h1>
        <p className="mt-1 text-sm text-slate-500">Who's signed up for a session — confirm from the waitlist, or cancel on someone's behalf.</p>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by registrant name or email…"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-brand"
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as Status | "")} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 outline-none focus:border-brand">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <div className="w-64">
          <ContentPicker value={contentFilter} onChange={setContentFilter} />
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : error ? (
        <ErrorState message={error} correlationId={correlationId} onRetry={load} />
      ) : !rows?.length ? (
        <EmptyState icon={<Icon name="ticket" className="h-6 w-6" />} heading="No registrations match" explanation="Try clearing the search or filters." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Registrant</th>
                  <th className="px-4 py-3 font-medium">Session</th>
                  <th className="px-4 py-3 font-medium">Registered</th>
                  <th className="px-4 py-3 font-medium">Attendance</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {rows.map((r) => (
                  <tr key={r.id} className="group hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-100">{r.user?.full_name || r.user?.email || "(deleted account)"}</div>
                      {r.user?.full_name && <div className="text-xs text-slate-500">{r.user.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{r.content?.title ?? "(deleted content)"}</td>
                    <td className="px-4 py-3 text-slate-500">{new Date(r.registered_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {r.attendance ? (r.attendance.attended ? `Attended · ${formatWatchTime(r.attendance.watch_seconds)}` : "No-show") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {r.status === "waitlisted" && (
                          <button onClick={() => changeStatus(r, "confirmed")} disabled={savingId === r.id} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-emerald-900/30 hover:text-emerald-400 disabled:opacity-50">
                            {savingId === r.id ? "…" : "Confirm"}
                          </button>
                        )}
                        {r.status !== "cancelled" && (
                          <button onClick={() => changeStatus(r, "cancelled")} disabled={savingId === r.id} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-900/30 hover:text-red-400 disabled:opacity-50">
                            {savingId === r.id ? "…" : "Cancel"}
                          </button>
                        )}
                        {r.status === "cancelled" && (
                          <button onClick={() => changeStatus(r, "confirmed")} disabled={savingId === r.id} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-emerald-900/30 hover:text-emerald-400 disabled:opacity-50">
                            {savingId === r.id ? "…" : "Restore"}
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
    </div>
  );
}

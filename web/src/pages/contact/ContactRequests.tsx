import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";
import { inputClass, selectClass } from "../../components/session/Panel";
import { formatDateTimeLagos } from "../../lib/format";

type Status = "new" | "in_progress" | "quoted" | "won" | "lost" | "closed";

interface ContactRequest {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  enquiry_type: string | null;
  message: string | null;
  source_page: string | null;
  status: Status;
  assigned_to: number | null;
  notes: string | null;
  created_at: string;
  responded_at: string | null;
}

interface Teammate {
  id: number;
  full_name: string | null;
  email: string;
  role: "instructor" | "admin" | "super_admin";
}

const STATUSES: Status[] = ["new", "in_progress", "quoted", "won", "lost", "closed"];

const STATUS_TONE: Record<Status, string> = {
  new: "border-blue-500/30 bg-blue-500/15 text-blue-300",
  in_progress: "border-amber-500/30 bg-amber-500/15 text-amber-300",
  quoted: "border-violet-500/30 bg-violet-500/15 text-violet-300",
  won: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  lost: "border-slate-700 bg-slate-800 text-slate-500",
  closed: "border-slate-700 bg-slate-800 text-slate-500",
};

function TriagePanel({
  request,
  teammates,
  onClose,
  onSaved,
}: {
  request: ContactRequest;
  teammates: Teammate[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState<Status>(request.status);
  const [assignedTo, setAssignedTo] = useState<string>(request.assigned_to != null ? String(request.assigned_to) : "");
  // The request's own current assignee might have since been deactivated or
  // had their role dropped to viewer — still shown as the selected option
  // (so the panel doesn't silently blank out who it WAS assigned to), just
  // not offered again if changed away from.
  const currentAssignee = request.assigned_to != null ? teammates.find((t) => t.id === request.assigned_to) : undefined;
  const assigneeOptions = currentAssignee || request.assigned_to == null
    ? teammates
    : [{ id: request.assigned_to, full_name: null, email: `User #${request.assigned_to}`, role: "admin" as const }, ...teammates];
  const [notes, setNotes] = useState(request.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/contact-requests/${request.id}`, {
        method: "PUT",
        body: JSON.stringify({ status, assigned_to: assignedTo.trim() ? Number(assignedTo) : null, notes: notes.trim() || null }),
      });
      toast("Contact request updated.");
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Failed to save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-slate-800 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">{request.name ?? `Contact #${request.id}`}</h2>
          <button onClick={onClose} className="text-xl leading-none text-slate-500 hover:text-slate-300">×</button>
        </div>

        <div className="space-y-4 text-sm">
          <div className="space-y-1 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            {request.email && <p className="text-slate-300">{request.email}</p>}
            {request.phone && <p className="text-slate-300">{request.phone}</p>}
            {request.company && <p className="text-slate-500">{request.company}</p>}
            {request.enquiry_type && <p className="text-xs capitalize text-slate-600">{request.enquiry_type.replace(/_/g, " ")}</p>}
            {request.source_page && <p className="text-xs text-slate-600">from {request.source_page}</p>}
            <p className="text-xs text-slate-600">Submitted {formatDateTimeLagos(request.created_at)}</p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-slate-300">{request.message}</div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className={selectClass}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Assigned to</label>
            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className={selectClass}>
              <option value="">Unassigned</option>
              {assigneeOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name ?? t.email} — {t.role.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Internal notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputClass} min-h-[100px]`} placeholder="Not visible to the requester." />
          </div>

          {request.responded_at && (
            <p className="text-xs text-slate-600">First responded to {formatDateTimeLagos(request.responded_at)}.</p>
          )}

          {err && <p className="text-sm text-red-400">{err}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ContactRequests() {
  const { toast } = useToast();
  const [requests, setRequests] = useState<ContactRequest[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [editing, setEditing] = useState<ContactRequest | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [allUsers, setAllUsers] = useState<{ id: number; full_name: string | null; email: string; role: string; is_active: boolean }[]>([]);

  // Loaded once — the same GET /users Users admin itself uses, filtered
  // client-side to real, currently-active staff. A "teammate" here is
  // anyone who isn't a plain viewer; the server enforces the identical rule
  // on save, so this list can never offer something the API would refuse.
  useEffect(() => {
    api<{ users: typeof allUsers }>("/users")
      .then((res) => setAllUsers(res.users))
      .catch(() => {}); // non-fatal — the picker just falls back to "Unassigned" only
  }, []);

  const teammates: Teammate[] = useMemo(
    () =>
      allUsers
        .filter((u): u is typeof u & { role: "instructor" | "admin" | "super_admin" } => u.role !== "viewer" && u.is_active)
        .map((u) => ({ id: u.id, full_name: u.full_name, email: u.email, role: u.role })),
    [allUsers],
  );

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api<{ requests: ContactRequest[] }>(`/contact-requests${statusFilter !== "all" ? `?status=${statusFilter}` : ""}`)
      .then((res) => { setRequests(res.requests); setLoading(false); })
      .catch((err) => {
        setError(err.message ?? "Failed to load contact requests.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(request: ContactRequest) {
    if (!confirm(`Delete this request from ${request.name ?? request.email ?? "this sender"}?`)) return;
    setDeletingId(request.id);
    try {
      await api(`/contact-requests/${request.id}`, { method: "DELETE" });
      setRequests((prev) => prev?.filter((r) => r.id !== request.id) ?? null);
      toast("Deleted.");
    } catch (e: any) {
      toast(e.message ?? "Failed to delete.", "error");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-5">
      {editing && (
        <TriagePanel request={editing} teammates={teammates} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}

      <div>
        <h1 className="text-lg font-semibold text-slate-100">Contact Requests</h1>
        <p className="mt-1 text-sm text-slate-500">Submissions from the public contact form.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["all", ...STATUSES] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full border px-3 py-1 text-xs capitalize ${statusFilter === s ? "border-brand bg-brand/15 text-brand" : "border-slate-800 text-slate-500 hover:text-slate-300"}`}
          >
            {s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : error ? (
        <ErrorState message={error} correlationId={correlationId} onRetry={load} />
      ) : !requests?.length ? (
        <EmptyState
          icon={<Icon name="mail" className="h-6 w-6" />}
          heading="No contact requests"
          explanation={statusFilter === "all" ? "Nothing's come in through the public contact form yet." : `No requests with status "${statusFilter.replace(/_/g, " ")}".`}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">From</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Message</th>
                  <th className="px-4 py-3 font-medium">Submitted</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {requests.map((r) => (
                  <tr key={r.id} className="group cursor-pointer hover:bg-slate-800/40" onClick={() => setEditing(r)}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-100">{r.name ?? "—"}</div>
                      <div className="text-xs text-slate-500">{r.email ?? r.phone ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-xs capitalize text-slate-500">{r.enquiry_type?.replace(/_/g, " ") ?? "—"}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-slate-400">{r.message}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDateTimeLagos(r.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs capitalize ${STATUS_TONE[r.status]}`}>{r.status.replace(/_/g, " ")}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(r); }}
                        disabled={deletingId === r.id}
                        className="rounded px-2 py-1 text-xs text-slate-400 opacity-0 hover:bg-red-900/30 hover:text-red-400 group-hover:opacity-100 disabled:opacity-50"
                      >
                        {deletingId === r.id ? "…" : "Delete"}
                      </button>
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

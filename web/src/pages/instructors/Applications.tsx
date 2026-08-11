import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { Icon } from "../../components/Icon";
import { StatTile } from "../../components/StatTile";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { formatCount, formatDateTimeLagos } from "../../lib/format";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Application {
  id: number;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  expertise_areas: string | null;
  proposed_topics: string | null;
  linkedin_url: string | null;
  sample_video_url: string | null;
  audience_size: string | null;
  status: "pending" | "under_review" | "approved" | "rejected";
  rejection_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
}

interface ListResponse {
  applications: Application[];
  stats: { pending_total: number; pending_today: number; pending_week: number; pending_month: number };
  meta: { total: number; page: number; per_page: number; pages: number };
}

const STATUS_STYLES: Record<Application["status"], string> = {
  pending: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
  under_review: "bg-blue-500/15 text-blue-300 border border-blue-500/30",
  approved: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  rejected: "bg-red-500/15 text-red-300 border border-red-500/30",
};

const STATUS_LABELS: Record<Application["status"], string> = {
  pending: "Pending",
  under_review: "More info requested",
  approved: "Approved",
  rejected: "Rejected",
};

// ─── Action modal (approve confirmation / request info / reject) ──────────────

type ActionKind = "approve" | "request-info" | "reject";

function ActionModal({
  kind,
  application,
  onClose,
  onDone,
}: {
  kind: ActionKind;
  application: Application;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [createdList, setCreatedList] = useState<string[] | null>(null);

  const needsNote = kind !== "approve";

  async function submit() {
    if (needsNote && !note.trim()) {
      setErr(kind === "reject" ? "A rejection reason is required." : "A note explaining what's needed is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (kind === "approve") {
        const res = await api<{ created: string[] }>(`/instructors/applications/${application.id}/approve`, {
          method: "POST",
        });
        setCreatedList(res.created);
      } else if (kind === "request-info") {
        await api(`/instructors/applications/${application.id}/request-info`, {
          method: "POST",
          body: JSON.stringify({ note: note.trim() }),
        });
        onDone();
      } else {
        await api(`/instructors/applications/${application.id}/reject`, {
          method: "POST",
          body: JSON.stringify({ reason: note.trim() }),
        });
        onDone();
      }
    } catch (e: any) {
      setErr(e.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const titles: Record<ActionKind, string> = {
    approve: "Approve application",
    "request-info": "Request more information",
    reject: "Reject application",
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-sm font-semibold text-slate-100">{titles[kind]}</h2>
        <p className="mb-4 text-sm text-slate-400">
          {application.full_name ?? "This applicant"} · {application.email ?? "no email"}
        </p>

        {kind === "approve" && !createdList && (
          <div className="mb-4 rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
            <p className="mb-2 font-medium text-slate-200">Approving will:</p>
            <ul className="list-disc space-y-1 pl-4 text-slate-400">
              <li>Create a speaker profile for {application.full_name ?? "the applicant"}</li>
              <li>Upgrade their user account to the instructor role (if an account with {application.email ?? "their email"} exists)</li>
              <li>Notify them that they can access the instructor dashboard</li>
            </ul>
          </div>
        )}

        {kind === "approve" && createdList && (
          <div className="mb-4 rounded-lg border border-emerald-800/40 bg-emerald-950/30 p-4 text-sm">
            <p className="mb-2 font-medium text-emerald-200">Approved. What happened:</p>
            <ul className="list-disc space-y-1 pl-4 text-emerald-300/80">
              {createdList.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </div>
        )}

        {needsNote && (
          <div className="mb-4">
            <label className="mb-1 block text-xs text-slate-400">
              {kind === "reject" ? "Reason (required — sent to the applicant)" : "What do you need from them? (required — sent to the applicant)"}
            </label>
            <textarea
              autoFocus
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
              placeholder={kind === "reject" ? "e.g. We're not accepting applications in this topic area right now…" : "e.g. Please share a link to a recorded talk or workshop…"}
            />
          </div>
        )}

        {err && <p className="mb-3 text-sm text-red-400">{err}</p>}

        <div className="flex justify-end gap-2">
          {createdList ? (
            <button
              type="button"
              onClick={onDone}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
            >
              Done
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                  kind === "reject" ? "bg-red-600 hover:bg-red-500" : "bg-brand hover:bg-brand-dark"
                }`}
              >
                {busy ? "Working…" : titles[kind]}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Review drawer ─────────────────────────────────────────────────────────────

function ReviewDrawer({
  application,
  onClose,
  onAction,
}: {
  application: Application;
  onClose: () => void;
  onAction: (kind: ActionKind) => void;
}) {
  const isActionable = application.status === "pending" || application.status === "under_review";

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
      <div
        className="h-full w-full max-w-lg overflow-y-auto border-l border-slate-800 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100">{application.full_name ?? "Applicant"}</h2>
            <span className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[application.status]}`}>
              {STATUS_LABELS[application.status]}
            </span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
        </div>

        <div className="space-y-4">
          <Row label="Email" value={application.email} />
          <Row label="Phone" value={application.phone} />
          <Row label="Expertise areas" value={application.expertise_areas} />
          <Row label="Audience size" value={application.audience_size} />
          <div>
            <p className="text-xs font-medium text-slate-500">Proposed topics</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-200">{application.proposed_topics || "—"}</p>
          </div>
          {application.linkedin_url && (
            <div>
              <p className="text-xs font-medium text-slate-500">LinkedIn</p>
              <a href={application.linkedin_url} target="_blank" rel="noopener noreferrer" className="mt-0.5 block truncate text-sm text-brand hover:underline">
                {application.linkedin_url}
              </a>
            </div>
          )}

          {/* Sample video preview */}
          {application.sample_video_url && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-500">Sample video</p>
              <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
                {/youtube\.com|youtu\.be|vimeo\.com/.test(application.sample_video_url) ? (
                  <iframe
                    src={application.sample_video_url.replace("watch?v=", "embed/")}
                    className="aspect-video w-full"
                    title="Sample video"
                    allowFullScreen
                  />
                ) : (
                  <a
                    href={application.sample_video_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-3 text-sm text-brand hover:underline"
                  >
                    <Icon name="play" className="h-4 w-4" />
                    Open sample video
                  </a>
                )}
              </div>
            </div>
          )}

          <Row label="Applied" value={formatDateTimeLagos(application.created_at)} />

          {application.rejection_reason && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <p className="text-xs font-medium text-slate-500">
                {application.status === "rejected" ? "Rejection reason" : "Reviewer note"}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{application.rejection_reason}</p>
            </div>
          )}
        </div>

        {isActionable && (
          <div className="mt-6 flex flex-col gap-2 border-t border-slate-800 pt-4">
            <button
              onClick={() => onAction("approve")}
              className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-dark"
            >
              Approve
            </button>
            <button
              onClick={() => onAction("request-info")}
              className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-800"
            >
              Request more info
            </button>
            <button
              onClick={() => onAction("reject")}
              className="rounded-lg border border-red-900/50 px-4 py-2.5 text-sm text-red-400 hover:bg-red-950/40"
            >
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

const FILTER_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "under_review", label: "More info requested" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

export function Applications() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [drawerApp, setDrawerApp] = useState<Application | null>(null);
  const [action, setAction] = useState<ActionKind | null>(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), per_page: "25" });
    if (status) params.set("status", status);
    api<ListResponse>(`/instructors/applications?${params}`)
      .then((res) => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message ?? "Failed to load applications.");
          setCorrelationId(err.correlationId);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [page, status, reloadKey]);

  const stats = data?.stats;
  const meta = data?.meta;

  return (
    <div className="space-y-5">
      {/* Modals */}
      {drawerApp && action && (
        <ActionModal
          kind={action}
          application={drawerApp}
          onClose={() => setAction(null)}
          onDone={() => { setAction(null); setDrawerApp(null); reload(); }}
        />
      )}
      {drawerApp && !action && (
        <ReviewDrawer
          application={drawerApp}
          onClose={() => setDrawerApp(null)}
          onAction={setAction}
        />
      )}

      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Instructor Applications</h1>
        <p className="text-sm text-slate-500">Review people applying to teach on the platform</p>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Pending total" value={formatCount(stats?.pending_total ?? 0)} tone={stats?.pending_total ? "warn" : "neutral"} />
        <StatTile label="Today" value={formatCount(stats?.pending_today ?? 0)} />
        <StatTile label="This week" value={formatCount(stats?.pending_week ?? 0)} />
        <StatTile label="This month" value={formatCount(stats?.pending_month ?? 0)} />
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
        >
          {FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : error ? (
        <ErrorState message={error} correlationId={correlationId} onRetry={reload} />
      ) : !data?.applications.length ? (
        <EmptyState
          icon={<Icon name="clipboard" className="h-6 w-6" />}
          heading="No applications"
          explanation={status ? "No applications match this filter." : "New instructor applications will appear here."}
          variant="filtered"
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Expertise</th>
                  <th className="px-4 py-3 font-medium">Audience</th>
                  <th className="px-4 py-3 font-medium">Applied</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {data.applications.map((a) => (
                  <tr key={a.id} className="group hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-medium text-slate-100">{a.full_name ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{a.email ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-400 max-w-[200px] truncate">{a.expertise_areas ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{a.audience_size ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{formatDateTimeLagos(a.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_STYLES[a.status]}`}>
                        {STATUS_LABELS[a.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setDrawerApp(a)}
                        className="rounded px-2.5 py-1 text-xs text-brand hover:bg-brand/10"
                      >
                        View
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
          <p className="text-xs text-slate-500">Page {meta.page} of {meta.pages} · {formatCount(meta.total)} applications</p>
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

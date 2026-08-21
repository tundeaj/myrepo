import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import { Icon } from "../../components/Icon";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { formatCount, formatPct, formatDateTimeLagos } from "../../lib/format";

// ─── Learner privacy: the API returns name + progress ONLY. No email, phone,
// or order values ever reach this page. Announcements go through the platform.

interface LearnerRow {
  registration_id: number;
  learner_name: string;
  content_title: string;
  content_id: number;
  registered_at: string;
  attended: boolean;
  watch_seconds: number;
  completion_pct: number | null;
}

interface ListResponse {
  learners: LearnerRow[];
  meta: { total: number; page: number; per_page: number; pages: number };
}

interface ContentOption {
  id: number;
  title: string;
}

function formatWatch(s: number): string {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── Announce modal — platform-mediated; the instructor never sees contacts ───

function AnnounceModal({
  contentOptions,
  onClose,
}: {
  contentOptions: ContentOption[];
  onClose: () => void;
}) {
  const [contentId, setContentId] = useState<string>(contentOptions[0] ? String(contentOptions[0].id) : "");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);

  async function send() {
    if (!contentId) { setErr("Select which content to announce to."); return; }
    if (!title.trim() || !message.trim()) { setErr("A subject and message are both required."); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await api<{ recipients: number }>("/portal/learners/announce", {
        method: "POST",
        body: JSON.stringify({ content_id: Number(contentId), title: title.trim(), message: message.trim() }),
      });
      setSent(res.recipients);
    } catch (e: any) {
      setErr(e.message ?? "Failed to send.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-sm font-semibold text-slate-100">Announce to all learners</h2>
        <p className="mb-4 text-xs text-slate-500">
          The platform delivers this to every confirmed registrant. You never see their contact details.
        </p>

        {sent !== null ? (
          <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/30 p-4 text-sm text-emerald-300">
            Sent to {formatCount(sent)} learner{sent === 1 ? "" : "s"}.
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Content</label>
              <select
                value={contentId}
                onChange={(e) => setContentId(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
              >
                {contentOptions.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Subject</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
                placeholder="e.g. Session materials now available"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Message</label>
              <textarea
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={5000}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
              />
            </div>
            {err && <p className="text-sm text-red-400">{err}</p>}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">
            {sent !== null ? "Close" : "Cancel"}
          </button>
          {sent === null && (
            <button onClick={send} disabled={busy}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
              {busy ? "Sending…" : "Send announcement"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export function MyLearners() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [contentOptions, setContentOptions] = useState<ContentOption[]>([]);
  const [announceOpen, setAnnounceOpen] = useState(false);

  useEffect(() => {
    // Content options for the announce modal
    api<{ content: { id: number; title: string }[] }>("/portal/content?per_page=50")
      .then((res) => setContentOptions(res.content.map((c) => ({ id: c.id, title: c.title }))))
      .catch(() => setContentOptions([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<ListResponse>(`/portal/learners?page=${page}&per_page=25`)
      .then((res) => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message ?? "Failed to load learners.");
          setCorrelationId(err.correlationId);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [page]);

  const meta = data?.meta;

  return (
    <div className="space-y-5">
      {announceOpen && <AnnounceModal contentOptions={contentOptions} onClose={() => setAnnounceOpen(false)} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Learners</h1>
          <p className="text-sm text-slate-500">
            {loading ? "Loading…" : `${formatCount(meta?.total ?? 0)} registration${meta?.total === 1 ? "" : "s"} across your content`}
          </p>
        </div>
        <button
          onClick={() => setAnnounceOpen(true)}
          disabled={!contentOptions.length}
          className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        >
          <Icon name="megaphone" className="h-4 w-4" />
          Announce to all
        </button>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-xs text-slate-500">
        For learner privacy, only names and progress are shown. Use "Announce to all" to reach your learners —
        the platform handles delivery.
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : error ? (
        <ErrorState message={error} correlationId={correlationId} onRetry={() => setPage((p) => p)} />
      ) : !data?.learners.length ? (
        <EmptyState
          icon={<Icon name="users" className="h-6 w-6" />}
          heading="No learners yet"
          explanation="Registrations for your sessions and courses will appear here."
          variant="filtered"
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Learner</th>
                  <th className="px-4 py-3 font-medium">Content</th>
                  <th className="px-4 py-3 font-medium">Registered</th>
                  <th className="px-4 py-3 font-medium">Attended</th>
                  <th className="px-4 py-3 font-medium">Watch time</th>
                  <th className="px-4 py-3 font-medium">Completion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {data.learners.map((l) => (
                  <tr key={l.registration_id} className="hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-medium text-slate-100">{l.learner_name}</td>
                    <td className="px-4 py-3 text-xs text-slate-400 max-w-[220px] truncate">{l.content_title}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{formatDateTimeLagos(l.registered_at)}</td>
                    <td className="px-4 py-3">
                      {l.attended ? (
                        <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-xs text-emerald-300">Yes</span>
                      ) : (
                        <span className="text-xs text-slate-600">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-slate-400">{formatWatch(l.watch_seconds)}</td>
                    <td className="px-4 py-3 text-xs tabular-nums text-slate-400">{formatPct(l.completion_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {meta && meta.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">Page {meta.page} of {meta.pages} · {formatCount(meta.total)} registrations</p>
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

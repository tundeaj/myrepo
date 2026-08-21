export type ContentStatus =
  | "draft"
  | "scheduled"
  | "pending_review"
  | "registration_open"
  | "starting_soon"
  | "live"
  | "ended"
  | "processing"
  | "replay_ready"
  | "archived";

const LABELS: Record<ContentStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  pending_review: "Pending review",
  registration_open: "Registration open",
  starting_soon: "Starting soon",
  live: "Live",
  ended: "Ended",
  processing: "Processing",
  replay_ready: "Replay ready",
  archived: "Archived",
};

// Colours exactly as specified in PROMPT 02 — used everywhere a content_items.status
// (or equivalent) is rendered, so a session's state reads identically across the console.
const STYLES: Record<ContentStatus, string> = {
  draft: "bg-slate-800 text-slate-300 border border-slate-700",
  scheduled: "bg-blue-500/15 text-blue-300 border border-blue-500/30",
  pending_review: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
  registration_open: "bg-indigo-500/15 text-indigo-300 border border-indigo-500/30",
  starting_soon: "bg-amber-500/15 text-amber-300 border border-amber-500/30 animate-pulse",
  live: "bg-red-500/15 text-red-300 border border-red-500/30",
  ended: "bg-slate-700/40 text-slate-300 border border-slate-600",
  processing: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
  replay_ready: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  archived: "bg-transparent text-slate-500 border border-slate-700",
};

export function StatusBadge({ status }: { status: ContentStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}>
      {status === "live" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />}
      {status === "processing" && (
        <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-amber-300 border-t-transparent" />
      )}
      {LABELS[status]}
    </span>
  );
}

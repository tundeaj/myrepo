import { useMemo } from "react";
import { useApi } from "../../hooks/useApi";
import { Icon } from "../../components/Icon";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { formatDateTimeLagos } from "../../lib/format";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ScheduleSession {
  id: number;
  title: string;
  scheduled_start_at: string | null;
  scheduled_duration_minutes: number | null;
  status: string;
  slug: string;
}

// ─── .ics generation (client-side download) ───────────────────────────────────
// Contains ONLY the session title, time and join link — no personal data.

function buildIcs(session: ScheduleSession): string {
  const start = session.scheduled_start_at ? new Date(session.scheduled_start_at) : new Date();
  const end = new Date(start.getTime() + (session.scheduled_duration_minutes ?? 60) * 60000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Webinarflix//Instructor Schedule//EN",
    "BEGIN:VEVENT",
    `UID:webinarflix-session-${session.id}@webinarflix`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${session.title.replace(/([,;\\])/g, "\\$1")}`,
    `URL:${window.location.origin}/sessions/${session.slug}`,
    `DESCRIPTION:Join link: ${window.location.origin}/sessions/${session.slug}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function downloadIcs(session: ScheduleSession) {
  const blob = new Blob([buildIcs(session)], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${session.slug || `session-${session.id}`}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Grouping helpers ─────────────────────────────────────────────────────────

function dayKey(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(0, 10);
}

function dayLabel(key: string): string {
  const d = new Date(`${key}T12:00:00`);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  const isSame = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (isSame(d, today)) return "Today";
  if (isSame(d, tomorrow)) return "Tomorrow";
  return d.toLocaleDateString("en-NG", { weekday: "long", day: "2-digit", month: "short" });
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export function Schedule() {
  const { data, loading, error, correlationId, retry } = useApi<{ sessions: ScheduleSession[] }>("/portal/schedule");

  const grouped = useMemo(() => {
    const sessions = (data?.sessions ?? []).filter((s) => s.scheduled_start_at);
    const map = new Map<string, ScheduleSession[]>();
    for (const s of sessions) {
      const key = dayKey(s.scheduled_start_at!);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }
  if (error) return <ErrorState message={error} correlationId={correlationId ?? undefined} onRetry={retry} />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Schedule</h1>
        <p className="text-sm text-slate-500">Your upcoming sessions over the next four weeks</p>
      </div>

      {!grouped.length ? (
        <EmptyState
          icon={<Icon name="bell" className="h-6 w-6" />}
          heading="Nothing scheduled"
          explanation="Sessions scheduled in the next four weeks will appear here, grouped by day."
          variant="filtered"
        />
      ) : (
        <div className="space-y-6">
          {grouped.map(([key, sessions]) => (
            <div key={key}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{dayLabel(key)}</h2>
              <div className="space-y-2">
                {sessions.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                      <Icon name="video" className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-100">{s.title}</p>
                      <p className="text-xs text-slate-500">
                        {formatDateTimeLagos(s.scheduled_start_at)}
                        {s.scheduled_duration_minutes ? ` · ${s.scheduled_duration_minutes} min` : ""}
                      </p>
                    </div>
                    <button
                      onClick={() => downloadIcs(s)}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                      title="Download .ics — works with Google Calendar, Outlook and Apple Calendar"
                    >
                      <Icon name="bell" className="h-3.5 w-3.5" />
                      Add to calendar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-600">
        "Add to calendar" downloads an .ics file that works with Google Calendar, Outlook and Apple Calendar.
        The file contains only the session title, time and join link.
      </p>
    </div>
  );
}

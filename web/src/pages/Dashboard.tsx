import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { SetupChecklist } from "../components/SetupChecklist";
import { StatTile } from "../components/StatTile";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { Skeleton, SkeletonCard, SkeletonRows } from "../components/Skeleton";
import { StatusBadge, type ContentStatus } from "../components/StatusBadge";
import { Icon } from "../components/Icon";
import { formatCount, formatDateTimeLagos, formatNaira, formatPct, formatRelative } from "../lib/format";

interface StatsResponse {
  sessionsThisWeek: { count: number; registrations: number };
  showUpRate30d: { attended: number; registered: number; pct: number | null };
  activeSubscriptions: { count: number; mrrNgn: number };
  grossMarginThisMonth: { revenueNgn: number; marginNgn: number; pct: number | null };
}

interface SeriesResponse {
  series: { month: string; registered: number; paying: number }[];
}

interface SessionRow {
  id: number;
  title: string;
  slug: string;
  status: ContentStatus;
  scheduled_start_at: string | null;
  timezone: string;
  registration_count: number;
  capacity: number | null;
}

interface AttendanceRow {
  id: number;
  title: string;
  slug: string;
  attendance: number;
  registered: number;
  showUpPct: number | null;
}

export function Dashboard() {
  const stats = useApi<StatsResponse>("/dashboard/stats");
  const series = useApi<SeriesResponse>("/dashboard/registered-vs-paying");
  const nextSessions = useApi<{ sessions: SessionRow[] }>("/dashboard/next-sessions");
  const topAttendance = useApi<{ sessions: AttendanceRow[] }>("/dashboard/top-attendance");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Dashboard</h1>
        <p className="text-sm text-slate-500">Everything running on Webinarflix, at a glance.</p>
      </div>

      {/* Row 0 — Setup checklist */}
      <SetupChecklist category="platform" />

      {/* Row 1 — Stat tiles */}
      <StatsRow stats={stats} />

      {/* Row 2 — Registered vs Paying chart */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-sm font-semibold text-slate-100">Registered vs Paying Users</h2>
        <p className="text-xs text-slate-500">Monthly, last 12 months</p>
        <div className="mt-4 h-72">
          {series.loading ? (
            <Skeleton className="h-full w-full" />
          ) : series.error ? (
            <ErrorState message={series.error} correlationId={series.correlationId} onRetry={series.retry} />
          ) : !series.data?.series.some((s) => s.registered > 0 || s.paying > 0) ? (
            <EmptyState
              icon={<Icon name="chart" className="h-6 w-6" />}
              heading="No user activity yet"
              explanation="Once people register and subscribe, this chart tracks registered vs paying users month by month."
              variant="filtered"
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series.data?.series ?? []} margin={{ left: 4, right: 12, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="month" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis yAxisId="left" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis yAxisId="right" orientation="right" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#e2e8f0" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="left" type="monotone" dataKey="registered" name="Registered" stroke="#818cf8" strokeWidth={2} dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="paying" name="Paying" stroke="#34d399" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Row 3 — Two tables */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <NextSessionsTable state={nextSessions} />
        <TopAttendanceTable state={topAttendance} />
      </div>
    </div>
  );
}

function StatsRow({ stats }: { stats: ReturnType<typeof useApi<StatsResponse>> }) {
  if (stats.loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }
  if (stats.error || !stats.data) {
    return <ErrorState message={stats.error ?? "Couldn't load dashboard stats."} correlationId={stats.correlationId} onRetry={stats.retry} />;
  }

  const d = stats.data;
  const showUpTone = d.showUpRate30d.pct !== null && d.showUpRate30d.pct < 0.5 ? "warn" : "neutral";
  const marginPct = d.grossMarginThisMonth.pct;
  const marginTone = marginPct === null ? "neutral" : marginPct > 0.6 ? "good" : marginPct >= 0.3 ? "warn" : "bad";

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        label="Sessions this week"
        value={formatCount(d.sessionsThisWeek.count)}
        sublabel={`${formatCount(d.sessionsThisWeek.registrations)} registrations`}
        icon={<Icon name="video" className="h-4 w-4 text-slate-600" />}
      />
      <StatTile
        label="Show-up rate (30 days)"
        value={formatPct(d.showUpRate30d.pct)}
        sublabel={`${formatCount(d.showUpRate30d.attended)} of ${formatCount(d.showUpRate30d.registered)} attended`}
        tone={showUpTone}
        icon={<Icon name="ticket" className="h-4 w-4 text-slate-600" />}
      />
      <StatTile
        label="Active subscriptions"
        value={formatCount(d.activeSubscriptions.count)}
        sublabel={`${formatNaira(d.activeSubscriptions.mrrNgn)} MRR`}
        icon={<Icon name="wallet" className="h-4 w-4 text-slate-600" />}
      />
      <StatTile
        label="Gross margin this month"
        value={marginPct === null ? "—" : formatPct(marginPct)}
        sublabel={`${formatNaira(d.grossMarginThisMonth.marginNgn)} of ${formatNaira(d.grossMarginThisMonth.revenueNgn)} revenue`}
        tone={marginTone}
        icon={<Icon name="chart" className="h-4 w-4 text-slate-600" />}
      />
    </div>
  );
}

function NextSessionsTable({ state }: { state: ReturnType<typeof useApi<{ sessions: SessionRow[] }>> }) {
  const navigate = useNavigate();
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <h2 className="text-sm font-semibold text-slate-100">Next 5 sessions</h2>
      <div className="mt-4">
        {state.loading ? (
          <SkeletonRows rows={5} cols={3} />
        ) : state.error ? (
          <ErrorState message={state.error} correlationId={state.correlationId} onRetry={state.retry} />
        ) : !state.data?.sessions.length ? (
          <EmptyState
            icon={<Icon name="video" className="h-6 w-6" />}
            heading="No upcoming sessions"
            explanation="Schedule a session and it will show up here as soon as it's live on the calendar."
            actionLabel="Schedule a session"
            onAction={() => navigate("/admin/sessions/new")}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="pb-2 font-medium">Title</th>
                <th className="pb-2 font-medium">Start time</th>
                <th className="pb-2 font-medium">Registrations</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {state.data.sessions.map((s) => (
                <tr key={s.id}>
                  <td className="py-2.5 pr-2 font-medium text-slate-200">{s.title}</td>
                  <td className="py-2.5 pr-2 text-slate-400">
                    <div>{formatDateTimeLagos(s.scheduled_start_at)}</div>
                    <div className="text-xs text-slate-600">{formatRelative(s.scheduled_start_at)}</div>
                  </td>
                  <td className="py-2.5 pr-2 tabular-nums text-slate-300">
                    {formatCount(s.registration_count)}
                    {s.capacity ? ` / ${formatCount(s.capacity)}` : ""}
                  </td>
                  <td className="py-2.5">
                    <StatusBadge status={s.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function TopAttendanceTable({ state }: { state: ReturnType<typeof useApi<{ sessions: AttendanceRow[] }>> }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <h2 className="text-sm font-semibold text-slate-100">Top 5 by attendance (last 30 days)</h2>
      <div className="mt-4">
        {state.loading ? (
          <SkeletonRows rows={5} cols={3} />
        ) : state.error ? (
          <ErrorState message={state.error} correlationId={state.correlationId} onRetry={state.retry} />
        ) : !state.data?.sessions.length ? (
          <EmptyState
            icon={<Icon name="chart" className="h-6 w-6" />}
            heading="No sessions have ended yet"
            explanation="Once sessions finish in the last 30 days, the best-attended ones will rank here."
            variant="filtered"
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="pb-2 font-medium">Title</th>
                <th className="pb-2 font-medium">Attendance</th>
                <th className="pb-2 font-medium">Show-up %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {state.data.sessions.map((s) => (
                <tr key={s.id}>
                  <td className="py-2.5 pr-2 font-medium text-slate-200">{s.title}</td>
                  <td className="py-2.5 pr-2 tabular-nums text-slate-300">
                    {formatCount(s.attendance)} / {formatCount(s.registered)}
                  </td>
                  <td className="py-2.5 tabular-nums text-slate-300">{formatPct(s.showUpPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

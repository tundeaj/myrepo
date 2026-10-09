import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../../hooks/useApi";
import { StatTile } from "../../components/StatTile";
import { SetupChecklist } from "../../components/SetupChecklist";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { formatCount, formatNaira, formatPct, formatDateTimeLagos } from "../../lib/format";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Overview {
  tiles: {
    upcoming_sessions: number;
    registrations_this_month: number;
    avg_show_up_rate: number | null;
    earnings_period_ngn: number;
  };
  next_session: {
    id: number;
    title: string;
    scheduled_start_at: string | null;
    registrations: number;
    status: string;
  } | null;
  setup_steps: any[];
}

// ─── Countdown ─────────────────────────────────────────────────────────────────

function useCountdown(target: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!target) return null;
  const diff = new Date(target).getTime() - now;
  if (Number.isNaN(diff)) return null;
  return diff;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "Starting now";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

const GO_LIVE_WINDOW_MS = 30 * 60 * 1000; // Go Live appears T-30min

// ─── Main page ─────────────────────────────────────────────────────────────────

export function InstructorDashboard() {
  const navigate = useNavigate();
  const { data, loading, error, correlationId, retry } = useApi<Overview>("/portal/overview");
  const countdown = useCountdown(data?.next_session?.scheduled_start_at ?? null);

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error) return <ErrorState message={error} correlationId={correlationId ?? undefined} onRetry={retry} />;

  const tiles = data?.tiles;
  const next = data?.next_session;
  const canGoLive = countdown !== null && countdown <= GO_LIVE_WINDOW_MS;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Instructor Dashboard</h1>
        <p className="text-sm text-slate-500">Your teaching at a glance</p>
      </div>

      {/* Setup checklist (reused from Prompt 02, instructor category) */}
      <SetupChecklist category="instructor" steps={data?.setup_steps ?? []} />

      {/* Tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Upcoming sessions" value={formatCount(tiles?.upcoming_sessions ?? 0)} />
        <StatTile label="Registrations this month" value={formatCount(tiles?.registrations_this_month ?? 0)} />
        <StatTile label="Avg show-up rate" value={formatPct(tiles?.avg_show_up_rate)} />
        <StatTile label="Earnings this period" value={formatNaira(tiles?.earnings_period_ngn ?? 0)} tone="good" />
      </div>

      {/* Next session card */}
      {next ? (
        <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-900/40 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Your next session</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-100">{next.title}</h2>
              <p className="mt-0.5 text-sm text-slate-400">
                {formatDateTimeLagos(next.scheduled_start_at)} · {formatCount(next.registrations)} registered
              </p>
            </div>
            <div className="flex items-center gap-4">
              {countdown !== null && countdown > 0 && (
                <div className="text-right">
                  <p className="text-xs text-slate-500">Starts in</p>
                  <p className="text-lg font-semibold tabular-nums text-slate-100">{formatCountdown(countdown)}</p>
                </div>
              )}
              {canGoLive && (
                <button
                  onClick={() => navigate(`/instructor/content`)}
                  className="flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-500"
                >
                  <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                  Go Live
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-5 text-center">
          <p className="text-sm text-slate-400">No upcoming sessions scheduled.</p>
          <button onClick={() => navigate("/instructor/content")} className="mt-2 text-sm font-medium text-brand hover:underline">
            View your content →
          </button>
        </div>
      )}
    </div>
  );
}

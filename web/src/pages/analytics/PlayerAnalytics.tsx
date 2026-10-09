import { useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useApi } from "../../hooks/useApi";
import { StatTile } from "../../components/StatTile";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";
import { formatCount, formatPct } from "../../lib/format";

interface PlayerStats {
  total_sessions: number;
  avg_completion_pct: number;
  avg_watch_seconds: number;
  avg_quality_changes: number;
  avg_buffering_seconds: number;
  total_buffering_events: number;
}
interface DeviceRow { device_type: string; count: number; }
interface TopContentRow { content_id: number; title: string | null; sessions: number; avg_completion_pct: number; total_watch_seconds: number; }
interface PlayerPayload { range_days: number; stats: PlayerStats; device_breakdown: DeviceRow[]; top_content: TopContentRow[]; }

const DEVICE_COLORS: Record<string, string> = {
  desktop: "#3b82f6",
  mobile: "#10b981",
  tablet: "#f59e0b",
  tv: "#a855f7",
  unknown: "#475569",
};

function formatMinutes(seconds: number): string {
  const mins = Math.round(seconds / 60);
  return mins > 0 ? `${mins}m` : `${Math.round(seconds)}s`;
}

/**
 * Aggregates real PlaybackSession telemetry — the fields Player.tsx actually
 * reports on every heartbeat (watch_seconds, completion_pct, buffering,
 * quality_changes, device_type). Deliberately does NOT show a device OS/
 * browser/location/bitrate breakdown — those columns exist on the schema but
 * nothing writes to them yet; faking that breakdown from empty data would be
 * worse than not showing it. See routes/playerAnalytics.ts for the full
 * scope note.
 */
export function PlayerAnalytics() {
  const [range, setRange] = useState("30");
  const { data, loading, error, retry } = useApi<PlayerPayload>(`/analytics/player?range=${range}`, [range]);

  const deviceTotal = data?.device_breakdown.reduce((sum, d) => sum + d.count, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Player Analytics</h1>
          <p className="mt-1 text-sm text-slate-500">Real playback telemetry — completion, buffering, device mix — from every session's own heartbeat.</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-slate-800 p-1">
          {["7", "30", "90"].map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded px-3 py-1 text-xs ${range === r ? "bg-slate-800 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={retry} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile label="Sessions" value={loading ? "…" : formatCount(data?.stats.total_sessions ?? 0)} />
            <StatTile label="Avg completion" value={loading ? "…" : formatPct((data?.stats.avg_completion_pct ?? 0) / 100, 1)} tone="good" />
            <StatTile label="Avg watch time" value={loading ? "…" : formatMinutes(data?.stats.avg_watch_seconds ?? 0)} />
            <StatTile label="Buffering events" value={loading ? "…" : formatCount(data?.stats.total_buffering_events ?? 0)} tone={data?.stats.total_buffering_events ? "warn" : "neutral"} />
            <StatTile label="Avg quality changes" value={loading ? "…" : (data?.stats.avg_quality_changes ?? 0).toFixed(1)} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
              <p className="mb-4 text-xs font-medium text-slate-400">Device mix</p>
              {loading ? (
                <Skeleton className="h-48 w-full" />
              ) : !deviceTotal ? (
                <div className="flex h-48 items-center justify-center text-sm text-slate-600">No sessions in this range.</div>
              ) : (
                <>
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={data!.device_breakdown} dataKey="count" nameKey="device_type" innerRadius={40} outerRadius={65} paddingAngle={2}>
                          {data!.device_breakdown.map((d) => (
                            <Cell key={d.device_type} fill={DEVICE_COLORS[d.device_type] ?? "#64748b"} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    {data!.device_breakdown.map((d) => (
                      <div key={d.device_type} className="flex items-center gap-1.5 text-xs">
                        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: DEVICE_COLORS[d.device_type] ?? "#64748b" }} />
                        <span className="text-slate-400 capitalize">{d.device_type}</span>
                        <span className="ml-auto tabular-nums text-slate-500">{formatCount(d.count)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 lg:col-span-2">
              <p className="mb-4 text-xs font-medium text-slate-400">Top content by sessions</p>
              {loading ? (
                <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : !data?.top_content.length ? (
                <EmptyState icon={<Icon name="chart" className="h-6 w-6" />} heading="No playback activity yet" explanation="Sessions will appear here as viewers watch." />
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500">
                      <th className="pb-2 font-medium">Content</th>
                      <th className="pb-2 font-medium">Sessions</th>
                      <th className="pb-2 font-medium">Avg completion</th>
                      <th className="pb-2 font-medium">Total watch time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {data.top_content.map((c) => (
                      <tr key={c.content_id}>
                        <td className="max-w-[220px] truncate py-2 text-slate-300">{c.title ?? `#${c.content_id}`}</td>
                        <td className="py-2 tabular-nums text-slate-400">{formatCount(c.sessions)}</td>
                        <td className="py-2 tabular-nums text-slate-400">{formatPct(c.avg_completion_pct / 100, 1)}</td>
                        <td className="py-2 tabular-nums text-slate-400">{formatMinutes(c.total_watch_seconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

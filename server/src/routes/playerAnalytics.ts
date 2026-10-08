import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { daysAgo } from "../lib/dates.js";
import type { Request, Response, NextFunction } from "express";

/**
 * `/admin/analytics/player` was a `PlaceholderPage` with zero schema
 * reference — "a future analytics prompt." Investigating found
 * `PlaybackSession` already carries real, currently-written telemetry:
 * `device_type` (set at session creation) and `watch_seconds`/
 * `completion_pct`/`buffering_events`/`buffering_seconds`/
 * `quality_changes`/`playback_speed` (all updated on every real heartbeat
 * from `Player.tsx` — see routes/playback.ts). The schema also carries
 * `os`/`browser`/`country`/`region`/`network_type`/`avg_bitrate_kbps`/
 * `load_time_ms`/`error_code` columns, but nothing anywhere ever writes to
 * them — no real data exists there yet. Checked with the user: aggregate
 * only the fields that are genuinely populated today; a device/location/
 * network breakdown would need new client-side instrumentation first; it
 * isn't faked here.
 */
export const playerAnalyticsRouter = Router();

const RANGE_DAYS: Record<string, number> = { "7": 7, "30": 30, "90": 90 };

playerAnalyticsRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rangeParam = typeof req.query.range === "string" ? req.query.range : "30";
    if (!(rangeParam in RANGE_DAYS)) throw new ApiError(400, "Invalid range — use 7, 30, or 90.");
    const since = daysAgo(RANGE_DAYS[rangeParam]);
    const where = { started_at: { gte: since } };

    const [agg, deviceGroups, topContentRaw] = await Promise.all([
      prisma.playbackSession.aggregate({
        where,
        _count: { _all: true },
        _avg: { completion_pct: true, watch_seconds: true, quality_changes: true, buffering_seconds: true },
        _sum: { buffering_events: true },
      }),
      prisma.playbackSession.groupBy({ by: ["device_type"], where, _count: { _all: true } }),
      prisma.playbackSession.groupBy({
        by: ["content_id"],
        where: { ...where, content_id: { not: null } },
        _count: { _all: true },
        _avg: { completion_pct: true },
        _sum: { watch_seconds: true },
        // Ties on session count break toward the newest content (highest
        // id) — a deterministic order an admin reads as "freshest first,"
        // and one that doesn't depend on whatever arbitrary order Postgres
        // would otherwise return equally-ranked rows in.
        orderBy: [{ _count: { content_id: "desc" } }, { content_id: "desc" }],
        take: 10,
      }),
    ]);

    const contentIds = topContentRaw.map((r) => r.content_id).filter((id): id is number => id != null);
    const contents = contentIds.length
      ? await prisma.contentItem.findMany({ where: { id: { in: contentIds } }, select: { id: true, title: true } })
      : [];
    const titleById = new Map(contents.map((c) => [c.id, c.title]));

    res.json({
      range_days: RANGE_DAYS[rangeParam],
      stats: {
        total_sessions: agg._count._all,
        avg_completion_pct: agg._avg.completion_pct != null ? Number(agg._avg.completion_pct) : 0,
        avg_watch_seconds: agg._avg.watch_seconds ?? 0,
        avg_quality_changes: agg._avg.quality_changes ?? 0,
        avg_buffering_seconds: agg._avg.buffering_seconds ?? 0,
        total_buffering_events: agg._sum.buffering_events ?? 0,
      },
      device_breakdown: deviceGroups.map((g) => ({ device_type: g.device_type ?? "unknown", count: g._count._all })),
      top_content: topContentRaw.map((r) => ({
        content_id: r.content_id,
        title: r.content_id != null ? (titleById.get(r.content_id) ?? null) : null,
        sessions: r._count._all,
        avg_completion_pct: r._avg.completion_pct != null ? Number(r._avg.completion_pct) : 0,
        total_watch_seconds: r._sum.watch_seconds ?? 0,
      })),
    });
  } catch (err) {
    next(err);
  }
});

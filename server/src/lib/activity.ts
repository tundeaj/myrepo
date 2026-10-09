import { prisma } from "./prisma.js";

/**
 * Real recent watch-activity ranking — the one signal this codebase trusts
 * for "popular right now" (content_items.view_count exists in the schema
 * but nothing has ever incremented it; checked before this was written).
 * Merges the same two real signals lib/earnings.ts's subscription-accrual
 * already merges for the same reason: PlaybackSession for native playback,
 * MeetingAttendance for Zoom/Teams/Google Meet/Jitsi — one measured, one
 * credited, both real.
 *
 * Originally inline in routes/trending.ts's GET /suggestions (recently
 * popular, not yet trending); extracted so the Discovery "algorithm-driven"
 * hero mode (homepageCache.ts's buildHero) can rank by the exact same
 * signal instead of a second, divergent one. Suggestions excludes
 * already-trending ids; the hero's algorithmic mode passes none — ranking
 * the whole eligible catalogue IS the point there.
 */

export const DEFAULT_ACTIVITY_WINDOW_DAYS = 7;

export interface ActivityRank {
  id: number;
  activity: number;
}

export async function recentActivityRanking(options: {
  excludeIds?: Set<number>;
  windowDays?: number;
} = {}): Promise<ActivityRank[]> {
  const windowDays = options.windowDays ?? DEFAULT_ACTIVITY_WINDOW_DAYS;
  const excludeIds = options.excludeIds ?? new Set<number>();
  const since = new Date(Date.now() - windowDays * 86_400_000);

  const [playbackCounts, attendanceCounts] = await Promise.all([
    prisma.playbackSession.groupBy({
      by: ["content_id"],
      where: { content_id: { not: null }, started_at: { gte: since } },
      _count: { _all: true },
    }),
    prisma.meetingAttendance.groupBy({
      by: ["content_id"],
      where: { joined_at: { gte: since } },
      _count: { _all: true },
    }),
  ]);

  const activity = new Map<number, number>();
  for (const row of playbackCounts) {
    if (row.content_id == null || excludeIds.has(row.content_id)) continue;
    activity.set(row.content_id, (activity.get(row.content_id) ?? 0) + row._count._all);
  }
  for (const row of attendanceCounts) {
    if (excludeIds.has(row.content_id)) continue;
    activity.set(row.content_id, (activity.get(row.content_id) ?? 0) + row._count._all);
  }

  return [...activity.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({ id, activity: count }));
}

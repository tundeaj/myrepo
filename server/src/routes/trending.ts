import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { rebuildAllCaches, VISIBLE_STATUSES } from "../lib/homepageCache.js";
import { syncHeroTrending } from "../lib/trending.js";
import type { Request, Response, NextFunction } from "express";

/**
 * The hero carousel's trending list — which content shows in the rotating,
 * teaser-playing hero banner on the public homepage (Hero.tsx), and in what
 * order. `show_in_hero` and the rotation/teaser mechanics themselves already
 * existed (see homepageCache.ts's buildHero, live since the homepage
 * engine); what was missing was any admin control over WHICH items and in
 * WHAT ORDER, short of a checkbox in the session/course editor with no
 * ordering at all — every flagged item tied at the same position and fell
 * back to scheduled_start_at, an admin could never promote one item over
 * another. This is that control surface.
 *
 * Position is `ContentItem.hero_display_order`, ascending. This router is
 * the primary place show_in_hero is flipped, but not the only one — the
 * session/course editor's own "Show in Hero" checkbox can too, so the actual
 * ordering invariant (append on join, re-compact on leave) lives in
 * lib/trending.ts's syncHeroTrending(), shared by both. Promote/demote (only
 * meaningful from here — the editor has no equivalent) swap a position with
 * its immediate neighbour directly. Every mutation rebuilds the homepage
 * cache so the change is live immediately rather than waiting out the cache
 * TTL — same pattern as routes/layout.ts's row builder.
 *
 * Deliberately NOT gated on content status here — an admin can queue up a
 * still-draft or not-yet-open session for the hero ahead of time. The public
 * hero (buildHero, via visibleWhere) is the actual gate: a trending item
 * that isn't yet publicly visible simply doesn't render there until it is,
 * same discipline as every other admin-side flag in this codebase.
 *
 * GET /suggestions is the one read-only, non-authoritative addition: a
 * ranked nudge toward what's recently popular but not yet on the list, not
 * a second way to BE on the list — adding a suggestion goes through the
 * exact same POST / as the search box.
 */
export const trendingRouter = Router();

const TRENDING_SELECT = {
  id: true,
  title: true,
  slug: true,
  content_type: true,
  status: true,
  master_image_url: true,
  focal_x: true,
  focal_y: true,
  scheduled_start_at: true,
  hero_display_order: true,
} as const;

async function orderedTrending() {
  return prisma.contentItem.findMany({
    where: { show_in_hero: true },
    orderBy: [{ hero_display_order: "asc" }, { id: "asc" }],
    select: TRENDING_SELECT,
  });
}

// Best-effort: a stale cache for up to its TTL is a real but minor
// consequence, and must never be the reason a trending-list edit itself
// fails or rolls back.
function refreshHomepageCache() {
  rebuildAllCaches().catch((err) => console.error("[trending] homepage cache rebuild failed:", err));
}

// ─── GET / — the trending list, in display order ──────────────────────────────

trendingRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await orderedTrending();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// ─── GET /suggestions — what's recently popular but not yet trending ──────────
//
// A light-touch nudge, not a second ranking system: content_items.view_count
// exists in the schema but nothing in this codebase has ever incremented it
// (checked before building this) — using it here would rank everything by
// zero. What IS real and populated is watch activity: PlaybackSession for
// native content, MeetingAttendance for Zoom/Teams/Meet/Jitsi (see
// lib/earnings.ts's own subscription-accrual merge of exactly these two
// signals for the same reason — one measured, one credited, both real).
// Recency window is fixed, not a Settings Hub field — "light touch" means
// one honest default, not a new admin-configurable surface for a nudge an
// admin can already override by hand.

const SUGGEST_WINDOW_DAYS = 7;
const SUGGEST_LIMIT = 8;

trendingRouter.get("/suggestions", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const since = new Date(Date.now() - SUGGEST_WINDOW_DAYS * 86_400_000);

    const [playbackCounts, attendanceCounts, alreadyTrending] = await Promise.all([
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
      prisma.contentItem.findMany({ where: { show_in_hero: true }, select: { id: true } }),
    ]);

    const trendingIds = new Set(alreadyTrending.map((r) => r.id));
    const activity = new Map<number, number>();
    for (const row of playbackCounts) {
      if (row.content_id == null || trendingIds.has(row.content_id)) continue;
      activity.set(row.content_id, (activity.get(row.content_id) ?? 0) + row._count._all);
    }
    for (const row of attendanceCounts) {
      if (trendingIds.has(row.content_id)) continue;
      activity.set(row.content_id, (activity.get(row.content_id) ?? 0) + row._count._all);
    }

    const rankedIds = [...activity.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, SUGGEST_LIMIT)
      .map(([id]) => id);

    if (!rankedIds.length) return res.json({ suggestions: [], window_days: SUGGEST_WINDOW_DAYS });

    // Same gate the public hero itself uses (visibleWhere) — a suggestion
    // that isn't currently publishable isn't a real "add this" candidate,
    // even if it racked up activity before being pulled back to draft.
    const content = await prisma.contentItem.findMany({
      where: { id: { in: rankedIds }, is_active: true, status: { in: [...VISIBLE_STATUSES] } },
      select: { id: true, title: true, slug: true, content_type: true, status: true, master_image_url: true },
    });
    const byId = new Map(content.map((c) => [c.id, c]));

    const suggestions = rankedIds
      .filter((id) => byId.has(id))
      .map((id) => ({ ...byId.get(id)!, recent_activity: activity.get(id)! }));

    res.json({ suggestions, window_days: SUGGEST_WINDOW_DAYS });
  } catch (err) {
    next(err);
  }
});

// ─── POST / — add an item to the end of the trending list ─────────────────────

const AddSchema = z.object({ content_id: z.number().int().positive() });

trendingRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = AddSchema.parse(req.body);
    const content = await prisma.contentItem.findUnique({
      where: { id: body.content_id },
      select: { id: true, show_in_hero: true },
    });
    if (!content) throw new ApiError(404, "That item isn't available.");
    if (content.show_in_hero) throw new ApiError(409, "That's already on the trending list.");

    await prisma.contentItem.update({ where: { id: content.id }, data: { show_in_hero: true } });
    await syncHeroTrending(content.id, false, true);

    const updated = await prisma.contentItem.findUniqueOrThrow({ where: { id: content.id }, select: TRENDING_SELECT });
    res.status(201).json({ item: updated });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── DELETE /:id — remove from the trending list ───────────────────────────────

trendingRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid content id.");

    const content = await prisma.contentItem.findUnique({ where: { id }, select: { id: true, show_in_hero: true } });
    if (!content || !content.show_in_hero) throw new ApiError(404, "That isn't on the trending list.");

    await prisma.contentItem.update({ where: { id }, data: { show_in_hero: false } });
    await syncHeroTrending(id, true, false);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── POST /:id/promote and /:id/demote — swap with an adjacent neighbour ──────

async function reorder(contentId: number, direction: "promote" | "demote") {
  const list = await orderedTrending();
  const index = list.findIndex((r) => r.id === contentId);
  if (index === -1) throw new ApiError(404, "That isn't on the trending list.");

  const neighbourIndex = direction === "promote" ? index - 1 : index + 1;
  if (neighbourIndex < 0 || neighbourIndex >= list.length) {
    throw new ApiError(409, direction === "promote" ? "Already at the top of the trending list." : "Already at the bottom of the trending list.");
  }

  const a = list[index];
  const b = list[neighbourIndex];
  await prisma.$transaction([
    prisma.contentItem.update({ where: { id: a.id }, data: { hero_display_order: b.hero_display_order } }),
    prisma.contentItem.update({ where: { id: b.id }, data: { hero_display_order: a.hero_display_order } }),
  ]);

  refreshHomepageCache();
  return orderedTrending();
}

trendingRouter.post("/:id/promote", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid content id.");
    res.json({ items: await reorder(id, "promote") });
  } catch (err) {
    next(err);
  }
});

trendingRouter.post("/:id/demote", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid content id.");
    res.json({ items: await reorder(id, "demote") });
  } catch (err) {
    next(err);
  }
});

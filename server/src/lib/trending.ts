import { prisma } from "./prisma.js";
import { rebuildAllCaches } from "./homepageCache.js";

/**
 * Keeps ContentItem.hero_display_order consistent regardless of WHICH admin
 * surface flips show_in_hero — the dedicated Trending page
 * (routes/trending.ts) or the plain "Show in Hero" checkbox already living
 * in the session/course editor (routes/sessions.ts, routes/courses.ts).
 * Without this, the checkbox would silently jump an item to
 * hero_display_order 0 — ahead of anything the Trending page had
 * deliberately ordered — the exact promote/demote control this feature
 * exists to give an admin, undermined by a second, uncoordinated entry
 * point. Every write path that can flip the flag routes through here.
 *
 * Called AFTER the caller's own write has already landed show_in_hero
 * itself — this only reacts to a false→true or true→false transition
 * (`wasShown`/`isShown`), and is a no-op otherwise: a session saved again
 * with the box already ticked must not get bumped to the bottom of the
 * rotation on every unrelated edit that happens to re-submit `true`.
 */
export async function syncHeroTrending(contentId: number, wasShown: boolean, isShown: boolean): Promise<void> {
  if (wasShown === isShown) return;

  if (isShown) {
    // Joining: append to the end (lowest priority) — same "add" semantics as
    // routes/trending.ts's POST, so an admin always has to deliberately
    // promote a newly-flagged item, never finds it's jumped the queue.
    const top = await prisma.contentItem.aggregate({
      where: { show_in_hero: true },
      _max: { hero_display_order: true },
    });
    await prisma.contentItem.update({
      where: { id: contentId },
      data: { hero_display_order: (top._max.hero_display_order ?? 0) + 1 },
    });
  } else {
    // Leaving: reset this row and re-compact everyone still trending to a
    // contiguous 1..N, so gaps never accumulate regardless of which route
    // removed an item.
    const remaining = await prisma.contentItem.findMany({
      where: { show_in_hero: true },
      orderBy: [{ hero_display_order: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    await prisma.$transaction([
      prisma.contentItem.update({ where: { id: contentId }, data: { hero_display_order: 0 } }),
      ...remaining.map((row, i) => prisma.contentItem.update({ where: { id: row.id }, data: { hero_display_order: i + 1 } })),
    ]);
  }

  // Awaited, unlike most cache-touching side effects in this codebase — a
  // trending edit is a rare, deliberate admin action (not a per-checkout or
  // per-registration hot path), so paying the rebuild's cost synchronously
  // is cheap, and it's the only way to actually keep the promise that a
  // promote/demote/add/remove is live "within moments" rather than racing
  // the homepage cache's own TTL. Still never fails the caller's own save —
  // a stale cache for a few minutes is a real but recoverable consequence.
  try {
    await rebuildAllCaches();
  } catch (err) {
    console.error("[trending] homepage cache rebuild failed:", err);
  }
}

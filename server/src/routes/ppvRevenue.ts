import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { daysAgo } from "../lib/dates.js";
import type { Request, Response, NextFunction } from "express";

/**
 * `/admin/analytics/ppv-revenue` was a `PlaceholderPage` with zero schema
 * reference — same "a future analytics prompt" note as Player Analytics.
 * Investigating found real, already-populated revenue data: `Order` rows
 * with `order_type: 'direct'` and a `content_id` set ARE individual
 * (pay-per-view) content purchases, and `EarningLine` already tracks the
 * speaker's real accrued/payable/paid share of each one via `order_id`.
 * `ContentUsage.revenue_ngn`/`margin_ngn` looked like an obvious fit but
 * turned out to be entirely dead schema — nothing anywhere ever writes to
 * it — so this reads from `Order`/`EarningLine` directly instead, the same
 * real-data-only principle Subscriber Analytics and Player Analytics both
 * already apply.
 *
 * NGN and USD are summed separately, never combined — same "a USD price is
 * always independent of its NGN counterpart" invariant already enforced
 * everywhere else a price crosses this currency boundary.
 */
export const ppvRevenueRouter = Router();

const RANGE_DAYS: Record<string, number> = { "7": 7, "30": 30, "90": 90 };

ppvRevenueRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rangeParam = typeof req.query.range === "string" ? req.query.range : "30";
    if (!(rangeParam in RANGE_DAYS)) throw new ApiError(400, "Invalid range — use 7, 30, or 90.");
    const since = daysAgo(RANGE_DAYS[rangeParam]);

    const ppvWhere = {
      order_type: "direct" as const,
      content_id: { not: null },
      status: "paid" as const,
      created_at: { gte: since },
    };

    const [ngnAgg, usdAgg, byContent] = await Promise.all([
      prisma.order.aggregate({ where: { ...ppvWhere, currency: "NGN" }, _count: { _all: true }, _sum: { amount_ngn: true } }),
      prisma.order.aggregate({ where: { ...ppvWhere, currency: "USD" }, _count: { _all: true }, _sum: { amount_ngn: true } }),
      prisma.order.groupBy({
        by: ["content_id", "currency"],
        where: ppvWhere,
        _count: { _all: true },
        _sum: { amount_ngn: true },
        orderBy: { _sum: { amount_ngn: "desc" } },
        take: 20,
      }),
    ]);

    const contentIds = [...new Set(byContent.map((r) => r.content_id).filter((id): id is number => id != null))];
    const [contents, earningRows] = await Promise.all([
      contentIds.length ? prisma.contentItem.findMany({ where: { id: { in: contentIds } }, select: { id: true, title: true } }) : Promise.resolve([]),
      contentIds.length
        ? prisma.earningLine.groupBy({
            by: ["content_id", "status"],
            where: { content_id: { in: contentIds }, order_id: { not: null } },
            _sum: { earned_ngn: true },
          })
        : Promise.resolve([]),
    ]);
    const titleById = new Map(contents.map((c) => [c.id, c.title]));

    const earnedByContent = new Map<number, { total: number; paid: number }>();
    for (const row of earningRows) {
      if (row.content_id == null) continue;
      const entry = earnedByContent.get(row.content_id) ?? { total: 0, paid: 0 };
      const amount = row._sum.earned_ngn != null ? Number(row._sum.earned_ngn) : 0;
      if (row.status !== "reversed") entry.total += amount;
      if (row.status === "paid") entry.paid += amount;
      earnedByContent.set(row.content_id, entry);
    }

    // Merge NGN/USD rows for the same content into one row per content_id —
    // groupBy above is per (content_id, currency), but the admin table shows
    // one row per content with both currencies broken out, never combined.
    const merged = new Map<number, { content_id: number; title: string | null; orders: number; gross_ngn: number; gross_usd: number }>();
    for (const row of byContent) {
      if (row.content_id == null) continue;
      const entry = merged.get(row.content_id) ?? { content_id: row.content_id, title: titleById.get(row.content_id) ?? null, orders: 0, gross_ngn: 0, gross_usd: 0 };
      entry.orders += row._count._all;
      const amount = row._sum.amount_ngn != null ? Number(row._sum.amount_ngn) : 0;
      if (row.currency === "USD") entry.gross_usd += amount;
      else entry.gross_ngn += amount;
      merged.set(row.content_id, entry);
    }

    res.json({
      range_days: RANGE_DAYS[rangeParam],
      stats: {
        total_orders: ngnAgg._count._all + usdAgg._count._all,
        gross_ngn: ngnAgg._sum.amount_ngn != null ? Number(ngnAgg._sum.amount_ngn) : 0,
        gross_usd: usdAgg._sum.amount_ngn != null ? Number(usdAgg._sum.amount_ngn) : 0,
      },
      top_content: [...merged.values()]
        .sort((a, b) => b.gross_ngn - a.gross_ngn)
        .map((c) => ({
          ...c,
          speaker_earned_ngn: earnedByContent.get(c.content_id)?.total ?? 0,
          speaker_paid_ngn: earnedByContent.get(c.content_id)?.paid ?? 0,
        })),
    });
  } catch (err) {
    next(err);
  }
});

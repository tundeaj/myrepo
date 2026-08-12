import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { lastNMonths } from "../lib/dates.js";
import type { Request, Response, NextFunction } from "express";

export const subscriberAnalyticsRouter = Router();

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function startOfMonth(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// ─── GET /analytics/subscribers/stats — three stat tiles ─────────────────────

subscriberAnalyticsRouter.get("/stats", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [totalActive, newToday, cancelledThisMonth] = await Promise.all([
      prisma.subscription.count({ where: { status: "active" } }),
      prisma.subscription.count({ where: { created_at: { gte: startOfToday() } } }),
      prisma.subscription.count({ where: { cancelled_at: { gte: startOfMonth() } } }),
    ]);
    res.json({ total_active: totalActive, new_today: newToday, cancelled_this_month: cancelledThisMonth });
  } catch (err) {
    next(err);
  }
});

// ─── GET /analytics/subscribers/growth — 12-month active/new/cancelled series ─

subscriberAnalyticsRouter.get("/growth", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const months = lastNMonths(12);
    const series = await Promise.all(
      months.map(async (m) => {
        const [active, newCount, cancelled] = await Promise.all([
          prisma.subscription.count({
            where: {
              created_at: { lt: m.end },
              OR: [{ cancelled_at: null }, { cancelled_at: { gte: m.end } }],
            },
          }),
          prisma.subscription.count({ where: { created_at: { gte: m.start, lt: m.end } } }),
          prisma.subscription.count({ where: { cancelled_at: { gte: m.start, lt: m.end } } }),
        ]);
        return { month: m.key, active, new: newCount, cancelled };
      }),
    );
    res.json({ series });
  } catch (err) {
    next(err);
  }
});

// ─── GET /analytics/subscribers/status-breakdown — donut ─────────────────────

subscriberAnalyticsRouter.get("/status-breakdown", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const statuses = ["active", "paused", "past_due", "cancelled", "expired"] as const;
    const counts = await Promise.all(statuses.map((status) => prisma.subscription.count({ where: { status } })));
    res.json({ breakdown: statuses.map((status, i) => ({ status, count: counts[i] })) });
  } catch (err) {
    next(err);
  }
});

// ─── GET /analytics/subscribers — filterable, paginated list ─────────────────

async function buildWhere(req: Request) {
  const plan_id = req.query.plan_id ? Number(req.query.plan_id) : undefined;
  const status = typeof req.query.status === "string" && req.query.status ? req.query.status : undefined;
  const from = typeof req.query.from === "string" && req.query.from ? new Date(req.query.from) : undefined;
  const to = typeof req.query.to === "string" && req.query.to ? new Date(req.query.to) : undefined;

  return {
    ...(plan_id ? { plan_id } : {}),
    ...(status ? { status } : {}),
    ...(from || to ? { created_at: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  } as Record<string, any>;
}

async function enrichSubscription(sub: { id: number; user_id: number; plan_id: number; status: string; current_period_end: Date | null; created_at: Date }) {
  const [user, plan, device] = await Promise.all([
    prisma.user.findFirst({ where: { id: sub.user_id }, select: { id: true, full_name: true, email: true } }),
    prisma.plan.findFirst({ where: { id: sub.plan_id }, select: { id: true, name: true, billing_interval: true } }),
    prisma.userDevice.findFirst({ where: { user_id: sub.user_id, is_active: true }, orderBy: { last_seen_at: "desc" } }),
  ]);
  const deviceLabel = device
    ? device.device_name || [device.browser, device.os].filter(Boolean).join(" on ") || device.device_type || "Unknown device"
    : null;

  return {
    id: sub.id,
    user: user ? { id: user.id, name: user.full_name ?? user.email, email: user.email } : null,
    plan: plan ? { id: plan.id, name: plan.name, billing_interval: plan.billing_interval } : null,
    start_date: sub.created_at,
    current_period_end: sub.current_period_end,
    signed_in_device: deviceLabel,
    status: sub.status,
  };
}

subscriberAnalyticsRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(50, Math.max(1, Number(req.query.per_page) || 25));
    const where = await buildWhere(req);

    const [subs, total] = await Promise.all([
      prisma.subscription.findMany({ where, orderBy: { created_at: "desc" }, skip: (page - 1) * perPage, take: perPage }),
      prisma.subscription.count({ where }),
    ]);

    const enriched = await Promise.all(subs.map(enrichSubscription));

    res.json({ subscribers: enriched, meta: { total, page, per_page: perPage, pages: Math.ceil(total / perPage) } });
  } catch (err) {
    next(err);
  }
});

// ─── GET /analytics/subscribers/export-csv ────────────────────────────────────

subscriberAnalyticsRouter.get("/export-csv", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const where = await buildWhere(req);
    const subs = await prisma.subscription.findMany({ where, orderBy: { created_at: "desc" }, take: 10000 });
    const enriched = await Promise.all(subs.map(enrichSubscription));

    const header = "id,name,email,plan,billing_interval,start_date,current_period_end,status";
    const rows = enriched.map((s) =>
      [
        s.id,
        `"${(s.user?.name ?? "").replace(/"/g, '""')}"`,
        s.user?.email ?? "",
        `"${(s.plan?.name ?? "").replace(/"/g, '""')}"`,
        s.plan?.billing_interval ?? "",
        s.start_date.toISOString(),
        s.current_period_end ? s.current_period_end.toISOString() : "",
        s.status,
      ].join(","),
    );

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="subscribers-${Date.now()}.csv"`);
    res.send([header, ...rows].join("\n"));
  } catch (err) {
    next(err);
  }
});

// ─── POST /analytics/subscribers/:id/cancel ───────────────────────────────────

subscriberAnalyticsRouter.post("/:id/cancel", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid subscription id");
    const existing = await prisma.subscription.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Subscription not found");
    if (existing.status === "cancelled") throw new ApiError(409, "This subscription is already cancelled.");

    const updated = await prisma.subscription.update({
      where: { id },
      data: { status: "cancelled", cancelled_at: new Date() },
    });
    res.json({ subscription: await enrichSubscription(updated) });
  } catch (err) {
    next(err);
  }
});

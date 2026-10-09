import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { serializeContentItem } from "../lib/serializers.js";
import { daysAgo, endOfWeek, lastNMonths, safeRatio, startOfWeek } from "../lib/dates.js";

export const dashboardRouter = Router();

// ─── Setup checklist — reusable across /admin (category=platform) and
// /instructor (category=instructor, built in a later prompt) ───
dashboardRouter.get("/setup-steps", async (req, res) => {
  const category = req.query.category === "instructor" ? "instructor" : "platform";
  const steps = await prisma.setupStep.findMany({
    where: { category },
    orderBy: { display_order: "asc" },
  });
  res.json({ steps });
});

// ─── Row 1: four stat tiles ───
dashboardRouter.get("/stats", async (_req, res) => {
  const now = new Date();
  const weekStart = startOfWeek(now);
  const weekEnd = endOfWeek(now);
  const thirtyDaysAgo = daysAgo(30, now);

  // Sessions this week
  const sessionsThisWeek = await prisma.contentItem.findMany({
    where: {
      content_type: "webinar",
      scheduled_start_at: { gte: weekStart, lt: weekEnd },
    },
    select: { id: true, registration_count: true },
  });
  const sessionsThisWeekCount = sessionsThisWeek.length;
  const sessionsThisWeekRegistrations = sessionsThisWeek.reduce((sum, s) => sum + s.registration_count, 0);

  // Show-up rate over the last 30 days, across ended sessions
  const endedRecently = await prisma.contentItem.findMany({
    where: { status: "ended", scheduled_start_at: { gte: thirtyDaysAgo } },
    select: { id: true },
  });
  const endedIds = endedRecently.map((c) => c.id);
  const registrationsForEnded = endedIds.length
    ? await prisma.registration.findMany({ where: { content_id: { in: endedIds } }, select: { id: true } })
    : [];
  const registrationIds = registrationsForEnded.map((r) => r.id);
  const attendedCount = registrationIds.length
    ? await prisma.attendance.count({ where: { registration_id: { in: registrationIds }, attended: true } })
    : 0;
  const showUpRate = safeRatio(attendedCount, registrationsForEnded.length);

  // Active subscriptions + MRR
  const activeSubs = await prisma.subscription.findMany({
    where: { status: "active" },
    select: { plan_id: true },
  });
  const planIds = [...new Set(activeSubs.map((s) => s.plan_id))];
  const plans = planIds.length ? await prisma.plan.findMany({ where: { id: { in: planIds } } }) : [];
  const planById = new Map(plans.map((p) => [p.id, p]));
  let mrrNgn = 0;
  for (const sub of activeSubs) {
    const plan = planById.get(sub.plan_id);
    if (!plan?.price_ngn) continue;
    const price = Number(plan.price_ngn);
    mrrNgn += plan.billing_interval === "annual" ? price / 12 : price;
  }

  // Gross margin this month — from content_usage, which prompt 08's cache job / a
  // future usage-rollup job populates. Zero rows this month is a legitimate empty state.
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const usageRows = await prisma.contentUsage.findMany({ where: { period_month: monthKey } });
  const revenueNgn = usageRows.reduce((sum, r) => sum + Number(r.revenue_ngn), 0);
  const marginNgn = usageRows.reduce((sum, r) => sum + Number(r.margin_ngn), 0);
  const marginPct = safeRatio(marginNgn, revenueNgn);

  res.json({
    sessionsThisWeek: { count: sessionsThisWeekCount, registrations: sessionsThisWeekRegistrations },
    showUpRate30d: { attended: attendedCount, registered: registrationsForEnded.length, pct: showUpRate },
    activeSubscriptions: { count: activeSubs.length, mrrNgn },
    grossMarginThisMonth: { revenueNgn, marginNgn, pct: marginPct },
  });
});

// ─── Row 2: Registered vs Paying Users, monthly, 12 months ───
dashboardRouter.get("/registered-vs-paying", async (_req, res) => {
  const months = lastNMonths(12);
  const series = [];
  for (const m of months) {
    const registered = await prisma.user.count({
      where: { created_at: { gte: m.start, lt: m.end } },
    });
    const payingSubs = await prisma.subscription.findMany({
      where: { created_at: { gte: m.start, lt: m.end } },
      select: { user_id: true },
    });
    const payingOrders = await prisma.order.findMany({
      where: { status: "paid", created_at: { gte: m.start, lt: m.end } },
      select: { user_id: true },
    });
    const payingUsers = new Set([...payingSubs.map((s) => s.user_id), ...payingOrders.map((o) => o.user_id)]);
    series.push({ month: m.key, registered, paying: payingUsers.size });
  }
  res.json({ series });
});

// ─── Row 3, table 1: next 5 sessions ───
dashboardRouter.get("/next-sessions", async (_req, res) => {
  const sessions = await prisma.contentItem.findMany({
    where: {
      content_type: "webinar",
      scheduled_start_at: { gte: new Date() },
      status: { in: ["scheduled", "registration_open", "starting_soon"] },
    },
    orderBy: { scheduled_start_at: "asc" },
    take: 5,
  });
  res.json({ sessions: sessions.map(serializeContentItem) });
});

// ─── Row 3, table 2: top 5 by attendance, last 30 days ───
dashboardRouter.get("/top-attendance", async (_req, res) => {
  const thirtyDaysAgo = daysAgo(30);
  const endedRecently = await prisma.contentItem.findMany({
    where: { status: "ended", scheduled_start_at: { gte: thirtyDaysAgo } },
    select: { id: true, title: true, slug: true },
  });

  const rows = await Promise.all(
    endedRecently.map(async (content) => {
      const registrations = await prisma.registration.findMany({
        where: { content_id: content.id },
        select: { id: true },
      });
      const registrationIds = registrations.map((r) => r.id);
      const attended = registrationIds.length
        ? await prisma.attendance.count({ where: { registration_id: { in: registrationIds }, attended: true } })
        : 0;
      return {
        id: content.id,
        title: content.title,
        slug: content.slug,
        attendance: attended,
        registered: registrations.length,
        showUpPct: safeRatio(attended, registrations.length),
      };
    })
  );

  rows.sort((a, b) => b.attendance - a.attendance);
  res.json({ sessions: rows.slice(0, 5) });
});

const searchSchema = z.object({ q: z.string().trim().min(1).max(120) });

dashboardRouter.get("/search", async (req, res) => {
  const parsed = searchSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.json({ sessions: [], users: [], speakers: [] });
  }
  const { q } = parsed.data;

  const [sessions, users, speakers] = await Promise.all([
    prisma.contentItem.findMany({
      where: { title: { contains: q, mode: "insensitive" } },
      select: { id: true, title: true, slug: true, content_type: true, status: true },
      take: 5,
    }),
    prisma.user.findMany({
      where: {
        OR: [{ full_name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }],
      },
      select: { id: true, full_name: true, email: true, role: true },
      take: 5,
    }),
    prisma.speaker.findMany({
      where: { full_name: { contains: q, mode: "insensitive" } },
      select: { id: true, full_name: true, slug: true, organisation: true },
      take: 5,
    }),
  ]);

  res.json({ sessions, users, speakers });
});

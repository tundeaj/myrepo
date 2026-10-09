import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import type { Request, Response, NextFunction } from "express";

export const plansRouter = Router();

// A subscription "counts" against a plan for deletion-blocking and the
// read-only subscriber count while it's still live or recoverable.
/** Subscription statuses that still grant access. Exported so lib/access.ts
 *  uses this exact definition rather than a second copy that can drift. */
export const LIVE_STATUSES = ["active", "past_due", "paused"] as const;

// GET /plans — list with read-only subscriber counts
plansRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const plans = await prisma.plan.findMany({ orderBy: [{ is_active: "desc" }, { price_ngn: "asc" }] });
    const enriched = await Promise.all(
      plans.map(async (plan) => {
        const subscriber_count = await prisma.subscription.count({
          where: { plan_id: plan.id, status: { in: [...LIVE_STATUSES] } },
        });
        return { ...plan, subscriber_count };
      }),
    );
    res.json({ plans: enriched });
  } catch (err) {
    next(err);
  }
});

// GET /plans/:id
plansRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid plan id");
    const plan = await prisma.plan.findFirst({ where: { id } });
    if (!plan) throw new ApiError(404, "Plan not found");
    const subscriber_count = await prisma.subscription.count({ where: { plan_id: id, status: { in: [...LIVE_STATUSES] } } });
    res.json({ plan: { ...plan, subscriber_count } });
  } catch (err) {
    next(err);
  }
});

const PlanSchema = z.object({
  name: z.string().min(1, "Plan name is required.").max(100),
  price_ngn: z.number().min(0, "Price can't be negative."),
  /** Independent USD figure for Stripe checkout — see Plan.price_usd's doc
   *  comment in schema.prisma. Optional: a plan with no price_usd set simply
   *  has no Stripe "Subscribe" option, Paystack only. */
  price_usd: z.number().min(0, "Price can't be negative.").nullable().optional(),
  billing_interval: z.enum(["monthly", "annual"]),
  features: z.string().max(10000).nullable().optional(),
  max_concurrent_streams: z.number().int().min(1).default(1),
  seat_count: z.number().int().min(1).default(1),
  is_team_plan: z.boolean().default(false),
  is_active: z.boolean().default(true),
});

// POST /plans — create
plansRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = PlanSchema.parse(req.body);
    const plan = await prisma.plan.create({
      data: {
        name: body.name,
        price_ngn: body.price_ngn,
        price_usd: body.price_usd ?? null,
        billing_interval: body.billing_interval,
        features: body.features ?? null,
        max_concurrent_streams: body.max_concurrent_streams,
        seat_count: body.seat_count,
        is_team_plan: body.is_team_plan,
        is_active: body.is_active,
      },
    });
    res.status(201).json({ plan: { ...plan, subscriber_count: 0 } });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// POST /plans/seed-free — shortcut: create a ₦0 active plan for the free tier
plansRouter.post("/seed-free", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.plan.findFirst({ where: { name: "Free" } });
    if (existing) return res.json({ plan: existing, created: false });

    const plan = await prisma.plan.create({
      data: {
        name: "Free",
        price_ngn: 0,
        billing_interval: "monthly",
        features: "<ul><li>Access to free and public content</li></ul>",
        max_concurrent_streams: 1,
        seat_count: 1,
        is_team_plan: false,
        is_active: true,
      },
    });
    res.status(201).json({ plan: { ...plan, subscriber_count: 0 }, created: true });
  } catch (err) {
    next(err);
  }
});

// PUT /plans/:id — update
plansRouter.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid plan id");
    const existing = await prisma.plan.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Plan not found");

    const body = PlanSchema.parse(req.body);
    const updated = await prisma.plan.update({
      where: { id },
      data: {
        name: body.name,
        price_ngn: body.price_ngn,
        price_usd: body.price_usd ?? null,
        billing_interval: body.billing_interval,
        features: body.features ?? null,
        max_concurrent_streams: body.max_concurrent_streams,
        seat_count: body.seat_count,
        is_team_plan: body.is_team_plan,
        is_active: body.is_active,
      },
    });
    const subscriber_count = await prisma.subscription.count({ where: { plan_id: id, status: { in: [...LIVE_STATUSES] } } });
    res.json({ plan: { ...updated, subscriber_count } });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// DELETE /plans/:id — blocked if any live subscriptions reference it
plansRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid plan id");
    const existing = await prisma.plan.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Plan not found");

    const activeCount = await prisma.subscription.count({ where: { plan_id: id, status: { in: [...LIVE_STATUSES] } } });
    if (activeCount > 0) {
      throw new ApiError(409, `This plan has ${activeCount} active subscriber${activeCount === 1 ? "" : "s"}. Deactivate it instead of deleting.`);
    }

    await prisma.plan.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

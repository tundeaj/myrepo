import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { rebuildAllCaches } from "../lib/homepageCache.js";
import type { Request, Response, NextFunction } from "express";

/**
 * Site-wide promo banners — the platform's own first-party marketing voice,
 * distinct from Coupons (discount codes a viewer redeems) and content-sponsor
 * linking (a paid third party's placement on a specific piece of content).
 * `/admin/promotions` was a PlaceholderPage with no schema behind it at all.
 *
 * Fully admin-gated here (mounted with requireAuth + requireAdmin, same as
 * Categories); the public side is read-only and comes entirely through
 * homepageCache.ts's buildActivePromotion(), never through this router.
 * Every write here awaits a homepage-cache rebuild for the same reason
 * contentSponsors.ts and trending.ts already do: the public homepage reads
 * from a cache table that only rebuilds on-demand when its own TTL has
 * expired, so a change here needs to be visible on the very next request,
 * not after some stale window.
 */
export const promotionsRouter = Router();

const PROMOTION_SELECT = {
  id: true,
  headline: true,
  body: true,
  link_url: true,
  link_label: true,
  display_order: true,
  is_active: true,
  starts_at: true,
  ends_at: true,
  created_at: true,
  updated_at: true,
} as const;

async function refreshHomepageCache() {
  try {
    await rebuildAllCaches();
  } catch (err) {
    console.error("[promotions] homepage cache rebuild failed:", err);
  }
}

// GET /promotions — every promotion, active or not, newest-window-first.
// The admin management page is the only caller; the public site never hits
// this router.
promotionsRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const promotions = await prisma.promotion.findMany({
      orderBy: [{ display_order: "asc" }, { id: "desc" }],
      select: PROMOTION_SELECT,
    });
    res.json({ promotions });
  } catch (err) {
    next(err);
  }
});

const FieldsSchema = z
  .object({
    headline: z.string().trim().min(1, "A headline is required.").max(200),
    body: z.string().trim().max(400).nullable().optional(),
    link_url: z.string().trim().max(500).nullable().optional(),
    link_label: z.string().trim().max(60).nullable().optional(),
    display_order: z.number().int().default(0),
    is_active: z.boolean().default(true),
    starts_at: z.string().nullable().optional(),
    ends_at: z.string().nullable().optional(),
  })
  .refine((b) => !b.starts_at || !Number.isNaN(new Date(b.starts_at).getTime()), { message: "Invalid start date.", path: ["starts_at"] })
  .refine((b) => !b.ends_at || !Number.isNaN(new Date(b.ends_at).getTime()), { message: "Invalid end date.", path: ["ends_at"] })
  .refine((b) => !b.starts_at || !b.ends_at || new Date(b.ends_at) > new Date(b.starts_at), {
    message: "The end date must be after the start date.",
    path: ["ends_at"],
  });

// POST /promotions
promotionsRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = FieldsSchema.parse(req.body);
    const promotion = await prisma.promotion.create({
      data: {
        headline: body.headline,
        body: body.body?.trim() || null,
        link_url: body.link_url?.trim() || null,
        link_label: body.link_label?.trim() || null,
        display_order: body.display_order,
        is_active: body.is_active,
        starts_at: body.starts_at ? new Date(body.starts_at) : null,
        ends_at: body.ends_at ? new Date(body.ends_at) : null,
      },
      select: PROMOTION_SELECT,
    });
    await refreshHomepageCache();
    res.status(201).json({ promotion });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// PUT /promotions/:id
promotionsRouter.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid promotion id");
    const existing = await prisma.promotion.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Promotion not found");

    const body = FieldsSchema.parse(req.body);
    const promotion = await prisma.promotion.update({
      where: { id },
      data: {
        headline: body.headline,
        body: body.body?.trim() || null,
        link_url: body.link_url?.trim() || null,
        link_label: body.link_label?.trim() || null,
        display_order: body.display_order,
        is_active: body.is_active,
        starts_at: body.starts_at ? new Date(body.starts_at) : null,
        ends_at: body.ends_at ? new Date(body.ends_at) : null,
      },
      select: PROMOTION_SELECT,
    });
    await refreshHomepageCache();
    res.json({ promotion });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// DELETE /promotions/:id — nothing else in the schema references a
// promotion (no join table, unlike Category/ContentCategory), so this is a
// real delete, same call FAQs and content-sponsor links already make for
// the same reason.
promotionsRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid promotion id");
    const existing = await prisma.promotion.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Promotion not found");
    await prisma.promotion.delete({ where: { id } });
    await refreshHomepageCache();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import type { Request, Response, NextFunction } from "express";

/**
 * Ads. `GET /ai/ads` (routes/ai.ts) already reads `prisma.ad.findMany` to
 * feed `AdvertisementPanel.tsx` — the pre-roll/mid-roll picker that's sat
 * on every session and course editor since Prompts 03/04, with nothing to
 * ever actually pick, because nothing could create an Ad row. This is that
 * write path. `/admin/ads` was still a PlaceholderPage.
 */
export const adsRouter = Router();

const AdSchema = z.object({
  name: z.string().trim().min(1, "A name is required.").max(150),
  ad_type: z.enum(["pre_roll", "mid_roll"]),
  video_url: z.string().trim().max(500).nullable().optional(),
  click_url: z.string().trim().max(500).nullable().optional(),
  duration_seconds: z.number().int().positive().nullable().optional(),
  advertiser_id: z.number().int().positive().nullable().optional(),
  is_active: z.boolean().default(true),
});

function toData(body: z.infer<typeof AdSchema>) {
  return {
    name: body.name,
    ad_type: body.ad_type,
    video_url: body.video_url?.trim() || null,
    click_url: body.click_url?.trim() || null,
    duration_seconds: body.duration_seconds ?? null,
    advertiser_id: body.advertiser_id ?? null,
    is_active: body.is_active,
  };
}

// GET /ads
adsRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const ads = await prisma.ad.findMany({ orderBy: [{ is_active: "desc" }, { id: "desc" }] });
    res.json({ ads });
  } catch (err) {
    next(err);
  }
});

// GET /ads/:id
adsRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid ad id");
    const ad = await prisma.ad.findFirst({ where: { id } });
    if (!ad) throw new ApiError(404, "Ad not found");
    res.json({ ad });
  } catch (err) {
    next(err);
  }
});

async function assertAdvertiserExists(advertiserId: number | null | undefined) {
  if (advertiserId == null) return;
  const advertiser = await prisma.advertiser.findUnique({ where: { id: advertiserId }, select: { id: true } });
  if (!advertiser) throw new ApiError(404, "That advertiser doesn't exist.");
}

// POST /ads
adsRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = AdSchema.parse(req.body);
    await assertAdvertiserExists(body.advertiser_id);
    const ad = await prisma.ad.create({ data: toData(body) });
    res.status(201).json({ ad });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// PUT /ads/:id
adsRouter.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid ad id");
    const existing = await prisma.ad.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Ad not found");

    const body = AdSchema.parse(req.body);
    await assertAdvertiserExists(body.advertiser_id);
    const ad = await prisma.ad.update({ where: { id }, data: toData(body) });
    res.json({ ad });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// DELETE /ads/:id — blocked while any content item still has this ad
// assigned as its pre-roll or mid-roll (ContentItem.pre_roll_ad_id /
// mid_roll_ad_id — no enforced FK, same as every other cross-model
// reference in this schema). Deactivating instead drops it out of
// AdvertisementPanel's own picker (GET /ai/ads only returns is_active
// ones) without leaving a session/course pointing at a dead ad id.
adsRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid ad id");
    const existing = await prisma.ad.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Ad not found");

    const inUse = await prisma.contentItem.count({ where: { OR: [{ pre_roll_ad_id: id }, { mid_roll_ad_id: id }] } });
    if (inUse > 0) {
      throw new ApiError(409, `${inUse} content item${inUse === 1 ? " has" : "s have"} this ad assigned as pre-roll or mid-roll. Deactivate it instead of deleting.`);
    }

    await prisma.ad.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

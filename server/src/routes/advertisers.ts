import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import type { Request, Response, NextFunction } from "express";

/**
 * Advertisers — companies buying ad placements on free-tier content (see
 * the model's own schema comment). Zero usage anywhere before this pass;
 * `/admin/advertisers` was still a PlaceholderPage. `Ad.advertiser_id`
 * links a creative asset back here for campaign attribution/reporting.
 */
export const advertisersRouter = Router();

const AdvertiserSchema = z.object({
  company_name: z.string().trim().min(1, "A company name is required.").max(150),
  contact_name: z.string().trim().max(150).nullable().optional(),
  contact_email: z.string().trim().max(190).nullable().optional(),
  contact_phone: z.string().trim().max(30).nullable().optional(),
  website_url: z.string().trim().max(300).nullable().optional(),
  logo_url: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(3000).nullable().optional(),
  is_active: z.boolean().default(true),
});

function toData(body: z.infer<typeof AdvertiserSchema>) {
  return {
    company_name: body.company_name,
    contact_name: body.contact_name?.trim() || null,
    contact_email: body.contact_email?.trim() || null,
    contact_phone: body.contact_phone?.trim() || null,
    website_url: body.website_url?.trim() || null,
    logo_url: body.logo_url?.trim() || null,
    notes: body.notes?.trim() || null,
    is_active: body.is_active,
  };
}

// GET /advertisers
advertisersRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const advertisers = await prisma.advertiser.findMany({ orderBy: [{ is_active: "desc" }, { company_name: "asc" }] });
    res.json({ advertisers });
  } catch (err) {
    next(err);
  }
});

// GET /advertisers/:id
advertisersRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid advertiser id");
    const advertiser = await prisma.advertiser.findFirst({ where: { id } });
    if (!advertiser) throw new ApiError(404, "Advertiser not found");
    res.json({ advertiser });
  } catch (err) {
    next(err);
  }
});

// POST /advertisers
advertisersRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = AdvertiserSchema.parse(req.body);
    const advertiser = await prisma.advertiser.create({ data: toData(body) });
    res.status(201).json({ advertiser });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// PUT /advertisers/:id
advertisersRouter.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid advertiser id");
    const existing = await prisma.advertiser.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Advertiser not found");

    const body = AdvertiserSchema.parse(req.body);
    const advertiser = await prisma.advertiser.update({ where: { id }, data: toData(body) });
    res.json({ advertiser });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// DELETE /advertisers/:id — blocked while any ad still references it (no
// enforced FK on ads.advertiser_id, so deleting would otherwise silently
// orphan that reference) — same "block, don't silently orphan" call
// Sponsors/Categories/Coupons/Plans already make.
advertisersRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid advertiser id");
    const existing = await prisma.advertiser.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Advertiser not found");

    const inUse = await prisma.ad.count({ where: { advertiser_id: id } });
    if (inUse > 0) {
      throw new ApiError(409, `${inUse} ad${inUse === 1 ? "" : "s"} still reference this advertiser. Deactivate it instead of deleting.`);
    }

    await prisma.advertiser.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
